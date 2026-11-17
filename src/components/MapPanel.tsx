import { useMutation, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { Map as MapIcon, Flag, Compass, Clock, Sparkles, Crosshair } from 'lucide-react';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { JOB_LABELS, PanelSection, StatusMessages, UNIT_LABELS, cardClass, primaryButton, readOnlyNote, useActionState } from './shared';
import { TroopSelector, TroopSelection } from './TroopSelector';
import { MAP } from '../../convex/balanceConfig';
import { generateWorldCells, parseCellId } from '../../convex/territoryRules';

const getWorldMapCompactQuery = makeFunctionReference<"query">("territories:getWorldMapCompact");
const getKingdomTerritoriesQuery = makeFunctionReference<"query">("territories:getKingdomTerritories");
const claimFreeTerritoryMutation = makeFunctionReference<"mutation">("territories:claimFreeTerritory");
const ensureHomeTerritoryMutation = makeFunctionReference<"mutation">("territories:ensureMyHomeTerritory");
const startExplorationMutation = makeFunctionReference<"mutation">("territories:startExploration");
const startSpyExplorationMutation = makeFunctionReference<"mutation">("territories:startSpyExploration");
const cancelExplorationMutation = makeFunctionReference<"mutation">("territories:cancelExploration");
const resolveCompletedExplorationsMutation = makeFunctionReference<"mutation">("territories:resolveCompletedExplorations");
const launchAttackMutation = makeFunctionReference<"mutation">("army:launchAttack");
const getArmyStateQuery = makeFunctionReference<"query">("army:getArmyState");

interface WorldMapCell {
  cellId: string;
  q: number;
  r: number;
  terrain: string;
  ownerKingdomId: string | null;
  ownerName: string | null;
  ownerColor: string | null;
  isHome: boolean;
  state: "owned" | "explored" | "exploring" | "fog";
  canExplore: boolean;
  canConquer: boolean;
  explorationPlan: { distance: number; durationSeconds: number; costs: { gold: number; food: number } } | null;
  expedition: {
    expeditionId: string;
    progressPercent: number;
    completesAt: number;
    durationMs: number;
    distance: number;
    isSpyMission: boolean;
  } | null;
}

interface CompactWorldMapResponse {
  radius: number;
  worldSeed: number;
  generated: boolean;
  terrains: Record<string, { label: string; production: Record<string, number>; defense: number; commerce: number; marchMultiplier: number }>;
  totalCells: number;
  exploredCount: number;
  activeExpeditions: Array<{
    expeditionId: string;
    cellId: string;
    completesAt: number;
    durationMs: number;
    progressPercent: number;
    isSpyMission: boolean;
  }>;
  activeMarches?: Array<{
    marchId: string;
    cellId: string;
    targetQ: number;
    targetR: number;
    startedAt: number;
    durationMs: number;
    completesAt: number;
    progressPercent: number;
    isConquest: boolean;
    units: Array<{ unitType: string; level?: number; count: number }> | Record<string, number>;
  }>;
  kingdomLegend?: Array<{
    id: string;
    name: string;
    monarchName?: string;
    color: string;
    territoryCount: number;
  }>;
  pendingClaims: number;
  homeTerritoryId: string | null;
  visibleCells: WorldMapCell[];
}

interface KingdomTerritories {
  homeTerritoryId: string | null;
  pendingClaims: number;
  exploredCount: number;
  activeExpeditions: number;
  territories: Array<{ cellId: string; q: number; r: number; terrain: string; isHome: boolean }>;
  recentDiscoveries?: Array<{ cellId: string; discoveredAt: number; note: string }>;
}

const TERRAIN_COLORS: Record<string, string> = {
  llanura: '#8a9a3a',
  bosque: '#2f6b3a',
  colina: '#9c7b4a',
  montana: '#6e6a66',
  rio: '#2f6f9a',
  costa: '#3f8fb5',
  desconocido: '#18140f',
};

const HEX_SIZE = 14;
const SQRT3 = Math.sqrt(3);
const MIN_ZOOM = 0.22;
const MAX_ZOOM = 5.5;

const HEX_OFFSETS = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 180) * (60 * i - 30);
  return { dx: HEX_SIZE * Math.cos(angle), dy: HEX_SIZE * Math.sin(angle) };
});

function hexCenter(q: number, r: number): { x: number; y: number } {
  return { x: HEX_SIZE * SQRT3 * (q + r / 2), y: HEX_SIZE * 1.5 * r };
}

function pixelToHex(wx: number, wy: number): { q: number; r: number } {
  const qf = ((SQRT3 / 3) * wx - (1 / 3) * wy) / HEX_SIZE;
  const rf = ((2 / 3) * wy) / HEX_SIZE;
  const xf = qf;
  const zf = rf;
  const yf = -xf - zf;

  let rx = Math.round(xf);
  let ry = Math.round(yf);
  let rz = Math.round(zf);

  const dx = Math.abs(rx - xf);
  const dy = Math.abs(ry - yf);
  const dz = Math.abs(rz - zf);

  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  return { q: rx, r: rz };
}

function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function formatRemainingSeconds(completesAt: number, nowMs: number): string {
  const remainingSeconds = Math.max(0, Math.ceil((completesAt - nowMs) / 1000));
  const m = Math.floor(remainingSeconds / 60);
  const s = remainingSeconds % 60;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

function formatMarchUnits(units: Array<{ unitType: string; level?: number; count: number }> | Record<string, number> | undefined): string {
  if (!units) return '';
  if (Array.isArray(units)) {
    return units
      .filter((u) => (u.count ?? 0) > 0)
      .map((u) => `${UNIT_LABELS[u.unitType] ?? u.unitType}: ${u.count}`)
      .join(', ');
  }
  return Object.entries(units)
    .filter(([, c]) => (c ?? 0) > 0)
    .map(([u, c]) => `${UNIT_LABELS[u] ?? u}: ${c}`)
    .join(', ');
}

export function MapPanel(props: { kingdomId: string; isOwner: boolean; homeTerritoryId: string | null }) {
  const { kingdomId, isOwner } = props;
  const world = useQuery(getWorldMapCompactQuery, { kingdomId }) as CompactWorldMapResponse | undefined;
  const mine = useQuery(getKingdomTerritoriesQuery, { kingdomId }) as KingdomTerritories | undefined;
  const claim = useMutation(claimFreeTerritoryMutation);
  const ensureHome = useMutation(ensureHomeTerritoryMutation);
  const startExploration = useMutation(startExplorationMutation);
  const startSpyExploration = useMutation(startSpyExplorationMutation);
  const cancelExploration = useMutation(cancelExplorationMutation);
  const resolveExplorations = useMutation(resolveCompletedExplorationsMutation);
  const startMarch = useMutation(launchAttackMutation);
  const armyState = useQuery(getArmyStateQuery, { kingdomId });
  const action = useActionState();

  const [selected, setSelected] = useState<string | null>(null);
  const [hoveredCellId, setHoveredCellId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showTroopSelector, setShowTroopSelector] = useState(false);
  const [targetCellId, setTargetCellId] = useState<string | null>(null);
  const [selectedSpiesCount, setSelectedSpiesCount] = useState<number>(1);

  // Cámara en coordenadas del mundo (x, y) y factor de zoom
  const [camera, setCamera] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1.35 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const centeredKingdomRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({ width: 720, height: 500 });

  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    hasMoved: false,
    touchMode: null as 'pan' | 'pinch' | null,
    initialPinchDist: 0,
    initialZoom: 1.35,
  });

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const ownedCoords = mine?.territories ?? [];

  // Reconstrucción determinista única en memoria de las 7.651 celdas base del disco
  const baseCells = useMemo(() => {
    const r = world?.radius ?? MAP.RADIUS;
    const seed = world?.worldSeed ?? MAP.WORLD_SEED;
    return generateWorldCells(r, seed);
  }, [world?.radius, world?.worldSeed]);

  const effectiveCellMap = useMemo(() => {
    const map = new Map<string, WorldMapCell>();
    for (const genCell of baseCells) {
      map.set(genCell.cellId, {
        cellId: genCell.cellId,
        q: genCell.q,
        r: genCell.r,
        terrain: 'desconocido',
        ownerKingdomId: null,
        ownerName: null,
        ownerColor: null,
        isHome: false,
        state: 'fog',
        canExplore: false,
        canConquer: false,
        explorationPlan: null,
        expedition: null,
      });
    }
    if (world?.visibleCells) {
      for (const cell of world.visibleCells) {
        map.set(cell.cellId, cell);
      }
    }
    return map;
  }, [baseCells, world?.visibleCells]);

  // Celdas reclamables a distancia <= 2 cuando hay reclamaciones pendientes
  const claimableAdjacentIds = useMemo(() => {
    const ids = new Set<string>();
    if ((mine?.pendingClaims ?? 0) <= 0 || ownedCoords.length === 0) return ids;
    for (const cell of world?.visibleCells ?? []) {
      if (cell.state === 'explored' && !cell.ownerKingdomId) {
        const d = Math.min(...ownedCoords.map((t) => hexDistance(t, cell)));
        if (d <= 2) ids.add(cell.cellId);
      }
    }
    return ids;
  }, [world?.visibleCells, ownedCoords, mine?.pendingClaims]);

  const resolvedHomeId = props.homeTerritoryId ?? world?.homeTerritoryId ?? mine?.homeTerritoryId ?? null;

  const centerOnCellId = useCallback((cellIdStr: string | null, zoomLevel?: number) => {
    const coord = cellIdStr ? parseCellId(cellIdStr) : null;
    if (!coord) {
      setCamera((prev) => ({ x: 0, y: 0, zoom: zoomLevel ?? prev.zoom }));
      return;
    }
    const { x, y } = hexCenter(coord.q, coord.r);
    setCamera((prev) => ({ x, y, zoom: zoomLevel ?? prev.zoom }));
  }, []);

  // Auto-centrado inicial en la capital del reino al abrir el mapa o cambiar de reino
  useEffect(() => {
    if (!world) return;
    if (centeredKingdomRef.current === kingdomId) return;
    centeredKingdomRef.current = kingdomId;
    centerOnCellId(resolvedHomeId, 1.35);
    if (resolvedHomeId) {
      setSelected(resolvedHomeId);
    }
  }, [kingdomId, world, resolvedHomeId, centerOnCellId]);

  // Observador de tamaño del contenedor para DPR exacto
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateSize);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [world !== undefined]);

  // Zoom con rueda del ratón sin scroll de página ({ passive: false })
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      setCamera((prev) => {
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom * factor));
        const wx = prev.x + (mx - rect.width / 2) / prev.zoom;
        const wy = prev.y + (my - rect.height / 2) / prev.zoom;
        return {
          x: wx - (mx - rect.width / 2) / nextZoom,
          y: wy - (my - rect.height / 2) / nextZoom,
          zoom: nextZoom,
        };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [world !== undefined]);

  // Renderizador HTML5 <canvas> con frustum culling, DPR y nivel de detalle (LOD)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !world) return;
    let rafId = 0;

    rafId = window.requestAnimationFrame(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = viewportSize;
      const targetW = Math.max(1, Math.floor(width * dpr));
      const targetH = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0a0806';
      ctx.fillRect(0, 0, width, height);

      const { x: camX, y: camY, zoom } = camera;
      const radius = world.radius ?? MAP.RADIUS;
      const pixelRadius = HEX_SIZE * zoom;
      const showDetailIcons = pixelRadius >= 12;
      const showMajorIcons = pixelRadius >= 6.5;
      const drawFogStroke = pixelRadius >= 7.5;

      // Bounding box visible en coordenadas del mundo (frustum culling)
      const pad = HEX_SIZE * 2;
      const minWx = camX - width / (2 * zoom) - pad;
      const maxWx = camX + width / (2 * zoom) + pad;
      const minWy = camY - height / (2 * zoom) - pad;
      const maxWy = camY + height / (2 * zoom) + pad;

      const rMin = Math.max(-radius, Math.floor(minWy / (HEX_SIZE * 1.5)) - 1);
      const rMax = Math.min(radius, Math.ceil(maxWy / (HEX_SIZE * 1.5)) + 1);

      ctx.save();
      ctx.translate(width / 2 - camX * zoom, height / 2 - camY * zoom);
      ctx.scale(zoom, zoom);

      const drawCellPolygon = (cx: number, cy: number) => {
        ctx.beginPath();
        ctx.moveTo(cx + HEX_OFFSETS[0].dx, cy + HEX_OFFSETS[0].dy);
        for (let i = 1; i < 6; i++) {
          ctx.lineTo(cx + HEX_OFFSETS[i].dx, cy + HEX_OFFSETS[i].dy);
        }
        ctx.closePath();
      };

      // Pasada 1: rellenos base y bordes normales (solo hexágonos en viewport)
      const highlighted: Array<{ cell: WorldMapCell; cx: number; cy: number }> = [];

      for (let r = rMin; r <= rMax; r++) {
        const qMin = Math.max(-radius, -r - radius, Math.floor(minWx / (HEX_SIZE * SQRT3) - r / 2) - 1);
        const qMax = Math.min(radius, -r + radius, Math.ceil(maxWx / (HEX_SIZE * SQRT3) - r / 2) + 1);

        for (let q = qMin; q <= qMax; q++) {
          const id = `${q},${r}`;
          const cell = effectiveCellMap.get(id);
          if (!cell) continue;

          const cx = HEX_SIZE * SQRT3 * (q + r / 2);
          const cy = HEX_SIZE * 1.5 * r;

          const isSelected = selected === id;
          const isHovered = hoveredCellId === id;
          const isOwned = cell.state === 'owned';
          const isFog = cell.state === 'fog';
          const isExploring = cell.state === 'exploring';
          const isClaimable = claimableAdjacentIds.has(id);

          drawCellPolygon(cx, cy);

          if (isFog) {
            ctx.fillStyle = cell.canExplore ? '#19222b' : '#14100c';
            ctx.fill();
            if (drawFogStroke) {
              ctx.strokeStyle = '#221b14';
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          } else if (isExploring) {
            ctx.fillStyle = '#2b2113';
            ctx.fill();
          } else {
            ctx.fillStyle = TERRAIN_COLORS[cell.terrain] ?? '#555555';
            ctx.globalAlpha = isOwned ? 0.95 : cell.ownerKingdomId ? 0.72 : 0.86;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#1b160f';
            ctx.lineWidth = 0.65;
            ctx.stroke();
          }

          if (
            isSelected ||
            isHovered ||
            isOwned ||
            isExploring ||
            cell.canExplore ||
            cell.canConquer ||
            isClaimable ||
            Boolean(cell.ownerKingdomId)
          ) {
            highlighted.push({ cell, cx, cy });
          }
        }
      }

      // Pasada 2: bordes destacados, iconos y selección (encima de los vecinos)
      for (const { cell, cx, cy } of highlighted) {
        const isSelected = selected === cell.cellId;
        const isHovered = hoveredCellId === cell.cellId;
        const isOwned = cell.state === 'owned';
        const isFog = cell.state === 'fog';
        const isExploring = cell.state === 'exploring';
        const isClaimable = claimableAdjacentIds.has(cell.cellId);

        let stroke: string | null = null;
        let lineWidth = 1.4;
        let dashed = false;

        if (isSelected) {
          stroke = '#ffffff';
          lineWidth = 2.4;
        } else if (isOwned) {
          stroke = cell.ownerColor || '#d4af37';
          lineWidth = 1.8;
        } else if (isExploring) {
          stroke = '#f59e0b';
          lineWidth = 1.9;
          dashed = true;
        } else if (cell.canExplore) {
          stroke = '#0284c7';
          lineWidth = 1.3;
        } else if (cell.canConquer) {
          stroke = '#7dd3fc';
          lineWidth = 1.7;
        } else if (isClaimable) {
          stroke = '#7dd3fc';
          lineWidth = 1.4;
          dashed = true;
        } else if (cell.ownerKingdomId) {
          stroke = cell.ownerColor || '#c05050';
          lineWidth = 1.7;
        } else if (isHovered) {
          stroke = '#d4af37';
          lineWidth = 1.2;
        }

        if (stroke) {
          drawCellPolygon(cx, cy);
          ctx.save();
          if (dashed) ctx.setLineDash([3, 2]);
          ctx.strokeStyle = stroke;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
          ctx.restore();
        }

        if (showMajorIcons) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          if (cell.isHome) {
            ctx.font = 'bold 11px serif';
            ctx.fillStyle = cell.ownerColor || '#d4af37';
            ctx.fillText('♜', cx, cy + 0.5);
          } else if (isExploring) {
            ctx.font = '10px sans-serif';
            ctx.fillStyle = '#f59e0b';
            ctx.fillText('🧭', cx, cy + 0.5);
          } else if (showDetailIcons) {
            if (isOwned || cell.ownerKingdomId) {
              ctx.font = '10px sans-serif';
              ctx.fillStyle = cell.ownerColor || '#f0e8d4';
              ctx.fillText('⚑', cx, cy + 0.5);
            } else if (isFog && cell.canExplore) {
              ctx.font = '9px sans-serif';
              ctx.fillStyle = '#38bdf8';
              ctx.fillText('🔭', cx, cy + 0.5);
            }
          }
        }
      }

      ctx.restore();
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [world, effectiveCellMap, claimableAdjacentIds, camera, viewportSize, selected, hoveredCellId]);

  const screenToCell = useCallback(
    (clientX: number, clientY: number): WorldMapCell | null => {
      const el = containerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const cam = cameraRef.current;
      const wx = cam.x + (mx - rect.width / 2) / cam.zoom;
      const wy = cam.y + (my - rect.height / 2) / cam.zoom;
      const { q, r } = pixelToHex(wx, wy);
      return effectiveCellMap.get(`${q},${r}`) ?? null;
    },
    [effectiveCellMap]
  );

  const selectedCell = selected ? effectiveCellMap.get(selected) ?? null : null;
  const hoveredCell = hoveredCellId ? effectiveCellMap.get(hoveredCellId) ?? null : null;

  const selectedDistance =
    selectedCell && ownedCoords.length
      ? Math.min(...ownedCoords.map((t) => hexDistance(t, selectedCell)))
      : null;

  const canClaimSelected = Boolean(
    isOwner &&
      selectedCell &&
      selectedCell.state === 'explored' &&
      !selectedCell.ownerKingdomId &&
      (mine?.pendingClaims ?? 0) > 0 &&
      selectedDistance !== null &&
      selectedDistance <= 2
  );

  const handleStartSpyExploration = () => {
    if (!selectedCell) return;
    action.run('spy-explore', async () => {
      const result = await startSpyExploration({ kingdomId, cellId: selectedCell.cellId });
      if (result && (result as any).success === false) return result;
      return `Espía enviado a ${selectedCell.cellId}. Llegada estimada en ${Math.round((result as any).durationSeconds / 60)} min.`;
    });
  };

  const handleStartMarch = (cellId: string, composition: TroopSelection[]) => {
    action.run('march', async () => {
      const res = await startMarch({ kingdomId, cellId, units: composition });
      if (res && (res as any).success === false) return res;
      setSelected(null);
      setShowTroopSelector(false);
      setTargetCellId(null);
      return `Marcha militar enviada hacia ${(res as any).cellId}. Llegada estimada en ${Math.round((res as any).durationSeconds / 60)} min.`;
    });
  };

  const handleClaim = () => {
    if (!selectedCell || !world) return;
    action.run('claim', async () => {
      const result = await claim({ kingdomId, cellId: selectedCell.cellId });
      if (result && result.success === false) return result;
      setSelected(null);
      return `Territorio ${result.cellId} (${world.terrains[result.terrain]?.label ?? result.terrain}) anexionado a la corona; reclamaciones restantes: ${result.remainingClaims}.`;
    });
  };

  const handleStartExploration = (count?: number) => {
    if (!selectedCell) return;
    const spiesCount = count ?? selectedSpiesCount ?? 1;
    action.run('explore', async () => {
      const result = await startExploration({ kingdomId, cellId: selectedCell.cellId, spiesCount });
      if (result && (result as any).success === false) return result;
      return `Expedición enviada a ${result.cellId} con ${spiesCount} espía(s). Llegada estimada en ${Math.round((result as any).durationSeconds / 60)} min. Coste: ${(result as any).costs.gold} oro y ${(result as any).costs.food} alimentos.`;
    });
  };

  const handleCancelExploration = (expeditionId: string) => {
    action.run('cancel-explore', async () => {
      const result = await cancelExploration({ kingdomId, expeditionId: expeditionId as any });
      if (result && result.success === false) return result;
      return result.message || 'Expedición cancelada.';
    });
  };

  const handleResolveCompleted = () => {
    action.run('resolve-explore', async () => {
      const result = await resolveExplorations({ kingdomId });
      if (result && result.success === false) return result;
      return result.count > 0
        ? `Se completaron ${result.count} expedición(es) de exploración con éxito.`
        : 'No hay expediciones pendientes de consolidar.';
    });
  };

  const handleEnsureHome = () =>
    action.run('home', async () => {
      const result = await ensureHome({ kingdomId });
      if (result && result.success === false) return result;
      return `Territorio principal asignado en ${result.homeTerritoryId}.`;
    });

  if (!world) {
    return <p className="text-xs text-[#8e816d] italic p-4">Cartografiando el mundo y la niebla de guerra…</p>;
  }

  return (
    <div className="space-y-6">
      <PanelSection
        icon={<MapIcon className="w-4 h-4 text-[#d4af37]" />}
        title="Mapa del mundo y exploración"
        aside={
          <span className="flex items-center gap-3">
            <span>
              Explorado: {world.exploredCount}/{world.totalCells} ({world.totalCells > 0 ? Math.round((world.exploredCount / world.totalCells) * 100) : 0} %)
            </span>
            <span>·</span>
            <span className="text-[#d4af37]">{mine?.pendingClaims ?? 0} reclamación(es)</span>
          </span>
        }
      >
        {!world.generated && (
          <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded p-3">
            El mundo aún no se ha generado en el servidor: se crea al fundar el primer reino o al asignar un territorio principal.
          </p>
        )}

        {isOwner && !resolvedHomeId && (
          <div className="flex items-center gap-3 text-xs bg-[#18140f] p-3 rounded border border-amber-900/40">
            <span className="text-[#c7beac]">Este reino todavía no tiene territorio principal en el mapa.</span>
            <button type="button" className={primaryButton} disabled={action.busy !== null} onClick={handleEnsureHome}>
              {action.busy === 'home' ? 'Asignando…' : 'Asignar territorio principal'}
            </button>
          </div>
        )}

        {/* Panel de actividades y expediciones simultáneas en curso */}
        {((world.activeExpeditions && world.activeExpeditions.length > 0) ||
          (world.activeMarches && world.activeMarches.length > 0)) && (
          <div className="space-y-2.5 bg-[#120f0c] p-3 rounded-lg border border-[#2b2419]">
            <div className="flex items-center justify-between text-xs font-semibold text-[#e6ded0]">
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-400" />
                Misiones y desplazamientos activos ({(world.activeExpeditions?.length ?? 0) + (world.activeMarches?.length ?? 0)})
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {world.activeExpeditions?.map((exp) => (
                <div
                  key={exp.expeditionId}
                  className={`flex flex-col justify-between gap-2 text-xs border p-2.5 rounded-md ${
                    exp.isSpyMission ? 'bg-[#0f172a] border-sky-800/60' : 'bg-[#1a150e] border-amber-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-1.5">
                      <Compass
                        className={`w-3.5 h-3.5 animate-spin ${exp.isSpyMission ? 'text-sky-400' : 'text-amber-400'}`}
                        style={{ animationDuration: '6s' }}
                      />
                      <span className={exp.isSpyMission ? 'text-sky-300' : 'text-amber-300'}>
                        {exp.isSpyMission ? 'Espía infiltrándose en' : 'Expedición en marcha hacia'} {exp.cellId}
                      </span>
                    </span>
                    <span className="text-[10px] font-mono text-[#a89b88]">
                      ⏳ {formatRemainingSeconds(exp.completesAt, now)}
                    </span>
                  </div>

                  <div className="w-full bg-[#0e0b08] h-1.5 rounded overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${exp.isSpyMission ? 'bg-sky-500' : 'bg-amber-500'}`}
                      style={{ width: `${exp.progressPercent}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-[#a89b88]">Progreso: {exp.progressPercent} %</span>
                    <div className="flex items-center gap-1.5">
                      {now >= exp.completesAt && (
                        <button
                          type="button"
                          className="px-2 py-0.5 text-[10px] bg-emerald-800 hover:bg-emerald-700 text-white rounded font-medium cursor-pointer"
                          onClick={handleResolveCompleted}
                          disabled={action.busy !== null}
                        >
                          Consolidar hallazgo
                        </button>
                      )}
                      {isOwner && now < exp.completesAt && (
                        <button
                          type="button"
                          className="px-2 py-0.5 text-[10px] bg-[#331c17] hover:bg-[#4a241e] text-red-300 border border-red-900/40 rounded cursor-pointer"
                          onClick={() => handleCancelExploration(exp.expeditionId)}
                          disabled={action.busy !== null}
                        >
                          {exp.isSpyMission ? 'Cancelar misión (devuelve espía)' : 'Cancelar (50 % reembolso)'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {world.activeMarches?.map((march) => (
                <div
                  key={march.marchId}
                  className={`flex flex-col justify-between gap-2 text-xs border p-2.5 rounded-md ${
                    march.isConquest ? 'bg-[#142217] border-emerald-800/60' : 'bg-[#221414] border-red-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-1.5">
                      <span className={march.isConquest ? 'text-emerald-400' : 'text-red-400'}>
                        {march.isConquest ? '🏰 Marcha de conquista' : '⚔️ Ataque militar'} en marcha a {march.cellId}
                      </span>
                    </span>
                    <span className="text-[10px] font-mono text-[#a89b88]">
                      ⏳ {formatRemainingSeconds(march.completesAt, now)}
                    </span>
                  </div>

                  <div className="w-full bg-[#0e0b08] h-1.5 rounded overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${march.isConquest ? 'bg-emerald-500' : 'bg-red-500'}`}
                      style={{ width: `${march.progressPercent}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-[#a89b88]">
                    <span>Tropas: {formatMarchUnits(march.units)}</span>
                    <span>{march.progressPercent} % completado</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div
            ref={containerRef}
            className="lg:col-span-2 bg-[#0a0806] border border-[#2b2419] rounded-lg overflow-hidden relative cursor-grab active:cursor-grabbing select-none h-[500px] touch-none"
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              dragRef.current.isDragging = true;
              dragRef.current.startX = e.clientX;
              dragRef.current.startY = e.clientY;
              dragRef.current.hasMoved = false;
            }}
            onMouseMove={(e) => {
              if (e.buttons === 1 && dragRef.current.isDragging) {
                const dx = e.clientX - dragRef.current.startX;
                const dy = e.clientY - dragRef.current.startY;
                if (Math.hypot(dx, dy) > 5) {
                  dragRef.current.hasMoved = true;
                }
                if (dragRef.current.hasMoved) {
                  dragRef.current.startX = e.clientX;
                  dragRef.current.startY = e.clientY;
                  setCamera((prev) => ({
                    ...prev,
                    x: prev.x - dx / prev.zoom,
                    y: prev.y - dy / prev.zoom,
                  }));
                }
              } else {
                const hit = screenToCell(e.clientX, e.clientY);
                const nextHover = hit?.cellId ?? null;
                if (nextHover !== hoveredCellId) {
                  setHoveredCellId(nextHover);
                }
              }
            }}
            onMouseUp={(e) => {
              const wasClick = dragRef.current.isDragging && !dragRef.current.hasMoved;
              dragRef.current.isDragging = false;
              dragRef.current.hasMoved = false;
              if (wasClick) {
                const hit = screenToCell(e.clientX, e.clientY);
                if (hit) setSelected(hit.cellId);
              }
            }}
            onMouseLeave={() => {
              dragRef.current.isDragging = false;
              dragRef.current.hasMoved = false;
              if (hoveredCellId !== null) setHoveredCellId(null);
            }}
            onTouchStart={(e) => {
              if (e.touches.length === 1) {
                dragRef.current.touchMode = 'pan';
                dragRef.current.isDragging = true;
                dragRef.current.startX = e.touches[0].clientX;
                dragRef.current.startY = e.touches[0].clientY;
                dragRef.current.hasMoved = false;
              } else if (e.touches.length === 2) {
                dragRef.current.touchMode = 'pinch';
                dragRef.current.isDragging = false;
                dragRef.current.hasMoved = true;
                const dist = Math.hypot(
                  e.touches[0].clientX - e.touches[1].clientX,
                  e.touches[0].clientY - e.touches[1].clientY
                );
                dragRef.current.initialPinchDist = dist;
                dragRef.current.initialZoom = cameraRef.current.zoom;
              }
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 2 && dragRef.current.touchMode === 'pinch') {
                if (e.cancelable) e.preventDefault();
                const dist = Math.hypot(
                  e.touches[0].clientX - e.touches[1].clientX,
                  e.touches[0].clientY - e.touches[1].clientY
                );
                if (dragRef.current.initialPinchDist > 0) {
                  const scale = dist / dragRef.current.initialPinchDist;
                  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, dragRef.current.initialZoom * scale));
                  setCamera((prev) => ({ ...prev, zoom: nextZoom }));
                }
              } else if (e.touches.length === 1 && dragRef.current.touchMode === 'pan') {
                const dx = e.touches[0].clientX - dragRef.current.startX;
                const dy = e.touches[0].clientY - dragRef.current.startY;
                if (Math.hypot(dx, dy) > 6) {
                  dragRef.current.hasMoved = true;
                }
                if (dragRef.current.hasMoved) {
                  if (e.cancelable) e.preventDefault();
                  dragRef.current.startX = e.touches[0].clientX;
                  dragRef.current.startY = e.touches[0].clientY;
                  setCamera((prev) => ({
                    ...prev,
                    x: prev.x - dx / prev.zoom,
                    y: prev.y - dy / prev.zoom,
                  }));
                }
              }
            }}
            onTouchEnd={(e) => {
              if (e.touches.length === 0) {
                const wasTap = dragRef.current.touchMode === 'pan' && !dragRef.current.hasMoved;
                dragRef.current.isDragging = false;
                dragRef.current.touchMode = null;
                dragRef.current.hasMoved = false;
                if (wasTap && e.changedTouches.length > 0) {
                  const hit = screenToCell(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
                  if (hit) setSelected(hit.cellId);
                }
              } else if (e.touches.length === 1) {
                dragRef.current.touchMode = 'pan';
                dragRef.current.startX = e.touches[0].clientX;
                dragRef.current.startY = e.touches[0].clientY;
                dragRef.current.hasMoved = true;
              }
            }}
          >
            {/* Controles flotantes de Zoom, Centrado y Vista global */}
            <div
              className="absolute top-3 right-3 z-10 flex flex-col gap-1 bg-[#18140f]/90 border border-[#2b2419] p-1 rounded shadow-lg"
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center bg-[#241c14] hover:bg-[#33281d] text-[#e6ded0] rounded text-sm font-bold cursor-pointer transition"
                onClick={() => setCamera((prev) => ({ ...prev, zoom: Math.min(MAX_ZOOM, prev.zoom * 1.25) }))}
                title="Acercar (Zoom +)"
              >
                +
              </button>
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center bg-[#241c14] hover:bg-[#33281d] text-[#e6ded0] rounded text-sm font-bold cursor-pointer transition"
                onClick={() => setCamera((prev) => ({ ...prev, zoom: Math.max(MIN_ZOOM, prev.zoom * 0.8) }))}
                title="Alejar (Zoom -)"
              >
                -
              </button>
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center bg-[#241c14] hover:bg-[#33281d] text-[#d4af37] rounded cursor-pointer transition"
                onClick={() => {
                  centerOnCellId(resolvedHomeId, 1.45);
                  if (resolvedHomeId) setSelected(resolvedHomeId);
                }}
                title="Centrar en mi capital"
              >
                <Crosshair className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center bg-[#241c14] hover:bg-[#33281d] text-[#8e816d] hover:text-[#e6ded0] rounded text-[11px] cursor-pointer transition"
                onClick={() => setCamera({ x: 0, y: 0, zoom: 0.34 })}
                title="Vista completa del mundo"
              >
                ⌂
              </button>
            </div>

            {/* Indicador flotante de celda bajo el cursor */}
            {hoveredCell && (
              <div className="pointer-events-none absolute bottom-3 left-3 z-10 bg-[#14110d]/90 border border-[#2b2419] px-2.5 py-1 rounded text-[10px] text-[#e6ded0] shadow">
                <span className="font-mono text-[#d4af37] mr-1.5">[{hoveredCell.cellId}]</span>
                <span>
                  {hoveredCell.state === 'fog'
                    ? 'Niebla de guerra (Tierra incógnita)'
                    : `${world.terrains[hoveredCell.terrain]?.label ?? hoveredCell.terrain}${hoveredCell.ownerName ? ` · ${hoveredCell.ownerName}` : ''}`}
                </span>
              </div>
            )}

            <canvas
              ref={canvasRef}
              className="w-full h-full block"
              role="img"
              aria-label="Mapa hexagonal de La Conquista"
            />
          </div>

          <div className="space-y-3 text-[11px]">
            <div className={`${cardClass} space-y-2`}>
              <span className="font-semibold text-[#e6ded0] text-xs flex items-center justify-between">
                <span>Información del territorio</span>
                {selectedCell && <span className="text-[10px] text-[#8e816d] font-mono">[{selectedCell.cellId}]</span>}
              </span>

              {selectedCell ? (
                <div className="space-y-2">
                  {selectedCell.state === 'fog' && (
                    <div className="space-y-2 bg-[#14100c] p-2.5 rounded border border-[#2b2419]">
                      <div className="flex items-center gap-1.5 text-sky-400 font-medium">
                        <Compass className="w-3.5 h-3.5" />
                        <span>Niebla de guerra (Tierra incógnita)</span>
                      </div>
                      <p className="text-[#a89b88]">Este territorio no ha sido cartografiado.</p>
                      {selectedCell.canExplore ? (
                        <div className="pt-2 border-t border-[#261f14] space-y-3">
                          <div className="bg-[#0b0f19] p-2 rounded border border-sky-950 text-[11px] space-y-1">
                            <div className="flex justify-between items-center text-[#c7beac]">
                              <span>Espías totales del reino:</span>
                              <span className="font-bold text-[#e6ded0] font-mono">{(armyState?.spies?.active ?? 0) + (armyState?.spies?.busy ?? 0)}</span>
                            </div>
                            <div className="flex justify-between items-center text-[#c7beac]">
                              <span>Espías disponibles:</span>
                              <span className="font-bold text-emerald-400 font-mono">{armyState?.spies?.active ?? 0}</span>
                            </div>
                            <div className="flex justify-between items-center text-[#c7beac]">
                              <span>Espías en misión:</span>
                              <span className="font-bold text-amber-400 font-mono">{armyState?.spies?.busy ?? 0}</span>
                            </div>
                          </div>

                          {isOwner && (armyState?.spies?.active ?? 0) > 0 ? (
                            <div className="space-y-2.5 bg-[#121824] p-2.5 rounded border border-sky-900/40">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-sky-200">Composición de espías:</span>
                                <span className="text-[10px] text-sky-400 font-mono">Disp: {armyState!.spies!.active}</span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  className="w-8 h-7 bg-[#1e293b] hover:bg-[#334155] text-sky-200 rounded border border-sky-800 text-xs font-bold disabled:opacity-40 cursor-pointer flex items-center justify-center"
                                  disabled={selectedSpiesCount <= 1}
                                  onClick={() => setSelectedSpiesCount((prev) => Math.max(1, prev - 1))}
                                >
                                  -
                                </button>

                                <input
                                  type="number"
                                  min={1}
                                  max={armyState!.spies!.active}
                                  value={Math.min(armyState!.spies!.active, Math.max(1, selectedSpiesCount))}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value) || 1;
                                    setSelectedSpiesCount(Math.max(1, Math.min(armyState!.spies!.active, val)));
                                  }}
                                  className="w-14 bg-[#0f172a] text-center font-mono text-sky-100 font-bold border border-sky-700/60 rounded h-7 text-xs"
                                />

                                <button
                                  type="button"
                                  className="w-8 h-7 bg-[#1e293b] hover:bg-[#334155] text-sky-200 rounded border border-sky-800 text-xs font-bold disabled:opacity-40 cursor-pointer flex items-center justify-center"
                                  disabled={selectedSpiesCount >= armyState!.spies!.active}
                                  onClick={() => setSelectedSpiesCount((prev) => Math.min(armyState!.spies!.active, prev + 1))}
                                >
                                  +
                                </button>

                                <button
                                  type="button"
                                  className="px-2 h-7 bg-sky-950 hover:bg-sky-900 text-sky-300 rounded border border-sky-700 text-[10px] font-bold cursor-pointer ml-auto"
                                  onClick={() => setSelectedSpiesCount(armyState!.spies!.active)}
                                >
                                  Máx ({armyState!.spies!.active})
                                </button>
                              </div>

                              {selectedCell.explorationPlan && (
                                <div className="text-[10px] text-sky-300/90 pt-1.5 space-y-0.5 border-t border-sky-900/30">
                                  <div className="flex justify-between items-center">
                                    <span>Duración estimada:</span>
                                    <span className="font-mono font-bold text-sky-100">
                                      {Math.round((selectedCell.explorationPlan.durationSeconds / Math.sqrt(Math.min(armyState!.spies!.active, Math.max(1, selectedSpiesCount)))) / 60)} min
                                      {selectedSpiesCount > 1 && (
                                        <span className="text-emerald-400 ml-1 font-normal">(×{Math.sqrt(selectedSpiesCount).toFixed(2)})</span>
                                      )}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span>Provisiones requeridas:</span>
                                    <span className="font-mono text-amber-300">
                                      {selectedCell.explorationPlan.costs.gold} oro / {selectedCell.explorationPlan.costs.food} alimento
                                    </span>
                                  </div>
                                </div>
                              )}

                              <button
                                type="button"
                                className={`${primaryButton} w-full py-2 font-bold text-xs shadow-lg shadow-sky-950/40`}
                                disabled={action.busy !== null || (armyState?.spies?.active ?? 0) < 1}
                                onClick={() => handleStartExploration(Math.min(armyState!.spies!.active, Math.max(1, selectedSpiesCount)))}
                              >
                                {action.busy === 'explore'
                                  ? 'Enviando expedición…'
                                  : `Confirmar y enviar (${Math.min(armyState!.spies!.active, Math.max(1, selectedSpiesCount))} espía${selectedSpiesCount > 1 ? 's' : ''})`}
                              </button>
                            </div>
                          ) : (
                            <p className="text-amber-300 text-[10px] bg-amber-950/40 p-2.5 rounded border border-amber-900/50">
                              No tienes espías profesionales disponibles en tu reino ({(armyState?.spies?.busy ?? 0) > 0 ? `${armyState?.spies?.busy} en misión` : 'sin agentes reclutados'}). Recluta espías en el Cuartel para iniciar nuevas expediciones.
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-[#8e816d] italic pt-1 border-t border-[#261f14]">Para explorar, esta celda debe limitar con tus fronteras.</p>
                      )}
                    </div>
                  )}

                  {selectedCell.state === 'exploring' && selectedCell.expedition && (
                    <div className={`space-y-2 p-2.5 rounded border ${selectedCell.expedition.isSpyMission ? 'bg-[#0f172a] border-sky-800/60' : 'bg-[#1c160e] border-amber-800/60'}`}>
                      <div className={`flex items-center gap-1.5 font-medium ${selectedCell.expedition.isSpyMission ? 'text-sky-300' : 'text-amber-300'}`}>
                        {selectedCell.expedition.isSpyMission ? <Compass className="w-3.5 h-3.5 animate-pulse" /> : <Clock className="w-3.5 h-3.5" />}
                        <span>{selectedCell.expedition.isSpyMission ? 'Agente infiltrado' : 'Reconocimiento en curso'}</span>
                      </div>
                      <div className="w-full bg-[#0e0b08] h-2 rounded overflow-hidden">
                        <div
                          className={`${selectedCell.expedition.isSpyMission ? 'bg-sky-500' : 'bg-amber-500'} h-full transition-all duration-500`}
                          style={{ width: `${selectedCell.expedition.progressPercent}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-[#c7beac]">
                        <span>Progreso: {selectedCell.expedition.progressPercent} %</span>
                        <span>Restante: {formatRemainingSeconds(selectedCell.expedition.completesAt, now)}</span>
                      </div>
                      {isOwner && now < selectedCell.expedition.completesAt && (
                        <button
                          type="button"
                          className="w-full py-1 text-[10px] bg-[#331c17] hover:bg-[#4a241e] text-red-300 rounded border border-red-900/40 cursor-pointer"
                          disabled={action.busy !== null}
                          onClick={() => handleCancelExploration(selectedCell.expedition!.expeditionId)}
                        >
                          {selectedCell.expedition.isSpyMission
                            ? 'Cancelar misión (devuelve espía y 50 % costes)'
                            : 'Cancelar expedición (recuperar 50 % costes)'}
                        </button>
                      )}
                    </div>
                  )}

                  {(selectedCell.state === 'explored' || selectedCell.state === 'owned') && (
                    <div className="space-y-1.5 bg-[#14100c] p-2.5 rounded border border-[#2b2419]">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-3.5 h-3.5 rounded border border-[#1b160f]" style={{ backgroundColor: TERRAIN_COLORS[selectedCell.terrain] ?? '#555' }} />
                        <span className="font-semibold text-[#e6ded0] text-xs">{world.terrains[selectedCell.terrain]?.label ?? selectedCell.terrain}</span>
                        {selectedCell.state === 'owned' && (
                          <span className="text-amber-400 font-medium text-[10px]">
                            {selectedCell.isHome ? '👑 Capital' : '🏰 Posesión de la corona'}
                          </span>
                        )}
                      </div>
                      <p className="text-[#c7beac]">
                        {selectedCell.ownerName
                          ? `Gobernante: ${selectedCell.ownerName}${selectedCell.isHome ? ' (capital)' : ''}`
                          : 'Territorio libre · Sin soberano'}
                      </p>

                      {world.terrains[selectedCell.terrain] && (
                        <div className="text-[10px] text-[#a89b88] bg-[#0c0a08] p-1.5 rounded">
                          <span className="block text-[#c7beac] font-medium mb-0.5">Rendimiento comarcal:</span>
                          {Object.entries(world.terrains[selectedCell.terrain].production).map(([job, bonus]) => (
                            <span key={job} className="mr-2">+{Math.round(bonus * 100)} % {JOB_LABELS[job] ?? job}</span>
                          ))}
                          {world.terrains[selectedCell.terrain].defense > 0 && (
                            <span className="mr-2">+{Math.round(world.terrains[selectedCell.terrain].defense * 100)} % defensa</span>
                          )}
                          {world.terrains[selectedCell.terrain].marchMultiplier !== 1.0 && (
                            <span className="mr-2 text-amber-300">
                              ×{world.terrains[selectedCell.terrain].marchMultiplier.toFixed(2)} marcha ({world.terrains[selectedCell.terrain].marchMultiplier > 1 ? `+${Math.round((world.terrains[selectedCell.terrain].marchMultiplier - 1) * 100)} % tiempo y fatiga` : ''})
                            </span>
                          )}
                        </div>
                      )}

                      {isOwner && !selectedCell.ownerKingdomId && (
                        <div className="pt-2 border-t border-[#261f14] space-y-2">
                          {(mine?.pendingClaims ?? 0) > 0 && (
                            <button
                              type="button"
                              className={`${primaryButton} w-full`}
                              disabled={!canClaimSelected || action.busy !== null}
                              onClick={handleClaim}
                            >
                              {action.busy === 'claim'
                                ? 'Reclamando territorio…'
                                : canClaimSelected
                                ? 'Reclamar territorio libre'
                                : 'Demasiado lejos (máximo 2 hexágonos)'}
                            </button>
                          )}
                          {selectedCell.canConquer ? (
                            <button
                              type="button"
                              className={`${primaryButton} w-full`}
                              disabled={action.busy !== null || (armyState?.summary?.totalActive ?? 0) === 0}
                              onClick={() => {
                                setTargetCellId(selectedCell.cellId);
                                setShowTroopSelector(true);
                              }}
                            >
                              Conquistar territorio con ejército
                            </button>
                          ) : (
                            <div className="p-2 bg-[#1c1610] rounded border border-amber-900/20 text-[#8e816d] italic text-center">
                              No hay conexión directa con tus fronteras para la conquista militar.
                            </div>
                          )}
                        </div>
                      )}
                      {isOwner && selectedCell.ownerKingdomId && selectedCell.ownerKingdomId !== kingdomId && (
                        <div className="pt-2 border-t border-[#261f14] space-y-2">
                          <button
                            type="button"
                            className="w-full bg-red-900/60 hover:bg-red-800 text-red-100 py-1.5 rounded text-xs border border-red-800/40 transition disabled:opacity-50"
                            disabled={action.busy !== null || (armyState?.summary?.totalActive ?? 0) === 0}
                            onClick={() => {
                              setTargetCellId(selectedCell.cellId);
                              setShowTroopSelector(true);
                            }}
                          >
                            Lanzar ataque militar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {showTroopSelector && targetCellId && (
                    <TroopSelector
                      availableUnits={armyState?.units ?? []}
                      targetDetails={
                        selectedCell
                          ? {
                              cellId: selectedCell.cellId,
                              terrainLabel: world.terrains[selectedCell.terrain]?.label ?? selectedCell.terrain,
                              distance: selectedDistance ?? undefined,
                              terrainMultiplier: world.terrains[selectedCell.terrain]?.marchMultiplier,
                              resourceBonusLabel: world.terrains[selectedCell.terrain]?.production
                                ? Object.entries(world.terrains[selectedCell.terrain].production)
                                    .map(([j, v]) => `+${Math.round(v * 100)}% ${JOB_LABELS[j] ?? j}`)
                                    .join(', ')
                                : undefined,
                              isAttack: Boolean(selectedCell.ownerKingdomId && selectedCell.ownerKingdomId !== kingdomId),
                            }
                          : undefined
                      }
                      onConfirm={(comp) => handleStartMarch(targetCellId, comp)}
                      onCancel={() => setShowTroopSelector(false)}
                    />
                  )}
                </div>
              ) : (
                <p className="text-[#8e816d] italic">Selecciona un hexágono en el mapa para examinar su cartografía o enviar exploradores.</p>
              )}
            </div>

            {world.kingdomLegend && world.kingdomLegend.length > 0 && (
              <div className={`${cardClass} space-y-1.5`}>
                <span className="font-semibold text-[#e6ded0] text-xs flex items-center justify-between">
                  <span>Reinos del mundo ({world.kingdomLegend.length})</span>
                  <span className="text-[10px] text-[#8e816d]">Identidad de color</span>
                </span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {world.kingdomLegend.map((k) => (
                    <div key={k.id} className="flex items-center justify-between text-[11px] bg-[#120f0c] p-1.5 rounded border border-[#221c15]">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="w-3 h-3 rounded-full shrink-0 border border-[#000]/40 shadow-sm" style={{ backgroundColor: k.color }} />
                        <div className="truncate">
                          <span className="font-semibold text-[#e6ded0] truncate block">{k.name}</span>
                          {k.monarchName && <span className="text-[9px] text-[#8e816d] block truncate">Rey {k.monarchName}</span>}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-[#d4af37] shrink-0 ml-2 font-medium">
                        {k.territoryCount} {k.territoryCount === 1 ? 'provincia' : 'provincias'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!isOwner && <p className="text-[#8e816d] italic">{readOnlyNote}</p>}
          </div>
        </div>

        {/* SECCIÓN INFORMATIVA DEBAJO DEL MAPA */}
        <div className="mt-6 space-y-4 pt-4 border-t border-[#2b2419]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`${cardClass} space-y-2.5`}>
              <span className="font-semibold text-[#e6ded0] text-xs flex items-center justify-between border-b border-[#221c15] pb-2">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Descubrimientos de exploración ({mine?.recentDiscoveries?.length ?? 0})
                </span>
                <span className="text-[10px] text-[#8e816d] font-mono">Historial registrado</span>
              </span>

              {mine?.recentDiscoveries && mine.recentDiscoveries.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {mine.recentDiscoveries.slice().reverse().map((disc, idx) => {
                    const dateObj = disc.discoveredAt ? new Date(disc.discoveredAt) : null;
                    const dateFormatted = dateObj
                      ? dateObj.toLocaleDateString('es-ES', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Fecha no registrada';

                    return (
                      <div key={idx} className="bg-[#120f0c] p-2.5 rounded border border-[#221c15] text-[11px] text-[#c7beac] space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-amber-300 font-bold flex items-center gap-1">
                            <span>🧭</span> [{disc.cellId}]
                          </span>
                          <span className="text-[10px] text-[#8e816d] font-mono">{dateFormatted}</span>
                        </div>
                        <p className="text-[#a89b88] text-[10px] leading-relaxed">{disc.note}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[#8e816d] italic p-3 text-center bg-[#120f0c] rounded border border-[#221c15]">
                  No se han registrado descubrimientos de exploración en este reino.
                </p>
              )}
            </div>

            <div className="space-y-4">
              <div className={`${cardClass} space-y-2`}>
                <span className="font-semibold text-[#e6ded0] text-xs flex items-center justify-between border-b border-[#221c15] pb-2">
                  <span className="flex items-center gap-1.5">
                    <Flag className="w-4 h-4 text-[#d4af37]" />
                    Provincias de la corona ({mine?.territories?.length ?? 0})
                  </span>
                  <span className="text-[10px] text-[#d4af37]">Soberanía territorial</span>
                </span>
                {mine?.territories.length ? (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {mine.territories.map((t) => (
                      <button
                        type="button"
                        key={t.cellId}
                        onClick={() => {
                          setSelected(t.cellId);
                          centerOnCellId(t.cellId);
                        }}
                        className="w-full flex justify-between items-center text-[11px] text-[#c7beac] bg-[#120f0c] hover:bg-[#1a1510] p-2 rounded border border-[#221c15] cursor-pointer text-left transition"
                      >
                        <span className="font-mono">
                          [{t.cellId}] · <span className="text-[#e6ded0]">{world.terrains[t.terrain]?.label ?? t.terrain}</span>
                        </span>
                        <span className="text-[10px] text-amber-400 font-medium">
                          {t.isHome ? '👑 Capital' : '🏰 Provincia'}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#8e816d] italic">Sin territorios anexionados.</p>
                )}
              </div>

              <div className={`${cardClass} space-y-1.5`}>
                <span className="font-semibold text-[#e6ded0] text-xs block">Clave cartográfica del mapa</span>
                <div className="grid grid-cols-2 gap-2 text-[10px] pt-1">
                  <div className="flex items-center gap-1.5 text-[#c7beac]">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#120f0c] border border-[#272017]" />
                    <span>Niebla de guerra</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sky-400">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#120f0c] border border-sky-500" />
                    <span>Explorable (frontera)</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-amber-400">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#8a9a3a] border-2 border-amber-400" />
                    <span>Reino propio</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-red-400">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#555] border border-red-500" />
                    <span>Reino rival</span>
                  </div>
                </div>
                <p className="text-[#8e816d] text-[10px] pt-1 border-t border-[#221c15] mt-1">
                  Símbolos: ♜ Castillo capital · ⚑ Provincia · 🧭 Expedición en curso · 🔭 Frontera explorable.
                </p>
              </div>
            </div>
          </div>
        </div>
        <StatusMessages error={action.error} message={action.message} />
      </PanelSection>
    </div>
  );
}
