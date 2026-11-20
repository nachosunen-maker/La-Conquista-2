import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  Castle,
  Compass,
  Crosshair,
  Eye,
  Flag,
  Globe,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  Shield,
  Swords,
} from "lucide-react";
import { MAP, TERRAINS, type TerrainType } from "../../convex/balanceConfig";
import { parseCellId, type HexCoord } from "../../convex/territoryRules";
import {
  axialToPixel,
  BASE_HEX_SIZE,
  computeClaimableAdjacentIds,
  createCapitalCenteredCamera,
  DEFAULT_CAPITAL_ZOOM,
  getCachedStaticWorld,
  getPersistedCamera,
  MAX_ZOOM,
  MIN_ZOOM,
  setPersistedCamera,
  zoomCameraAtPoint,
  type CameraState,
} from "../map/hexMath";
import { MedievalMapRenderer, type RenderableMapCell, type RenderableMarch } from "../map/mapRenderer";
import { MEDIEVAL_TERRAIN_PALETTE } from "../map/terrainVisuals";
import { normalizeErrorMessage, StatusMessages } from "./shared";

const getWorldMapCompactQuery = makeFunctionReference<"query">("territories:getWorldMapCompact");
const getArmyStateQuery = makeFunctionReference<"query">("army:getArmyState");

const startExplorationMutation = makeFunctionReference<"mutation">("territories:startExploration");
const startSpyMissionMutation = makeFunctionReference<"mutation">("territories:startSpyMission");
const resolvePendingExplorationsMutation = makeFunctionReference<"mutation">("territories:resolvePendingExplorations");
const claimFreeTerritoryMutation = makeFunctionReference<"mutation">("territories:claimFreeTerritory");
const launchArmyMarchMutation = makeFunctionReference<"mutation">("army:launchArmyMarch");
const resolveArmyMarchMutation = makeFunctionReference<"mutation">("army:resolveArmyMarch");

interface ActiveExpeditionItem {
  expeditionId: string;
  cellId: string;
  completesAt: number;
  durationMs: number;
  progressPercent: number;
  isSpyMission: boolean;
}

interface ActiveMarchItem extends RenderableMarch {
  units: Array<{ unitType: string; level?: number; count: number }>;
}

interface RecentDiscoveryItem {
  cellId: string;
  discoveredAt: number;
  note: string;
}

interface CompactWorldMapResponse {
  radius: number;
  worldSeed: number;
  generated: boolean;
  totalCells: number;
  exploredCount: number;
  activeExpeditions: ActiveExpeditionItem[];
  activeMarches: ActiveMarchItem[];
  kingdomLegend: Array<{ id: string; name: string; monarchName?: string; color: string; territoryCount: number }>;
  pendingClaims: number;
  homeTerritoryId: string | null;
  visibleCells: RenderableMapCell[];
  recentDiscoveries?: RecentDiscoveryItem[];
}

interface ArmyStateSummary {
  spyCount?: number;
  army?: {
    totalActive?: number;
    byType?: Record<string, number>;
  };
}

const UNIT_LABELS: Record<string, string> = {
  infanteria: "Infantería",
  caballeria: "Caballería",
  arqueria: "Arquería",
  asedio: "Asedio",
};

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  }
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

/**
 * Subcomponente aislado para cuentas atrás activas.
 * Solo monta el temporizador de 1s cuando existen expediciones o marchas activas,
 * logrando 0 re-renders por minuto en estado inactivo.
 */
function ActiveActivitiesSection(props: {
  expeditions: ActiveExpeditionItem[];
  marches: ActiveMarchItem[];
  isOwner: boolean;
  busy: boolean;
  onFocusCell: (cellId: string) => void;
  onResolveExpeditions: () => void;
  onResolveMarch: (marchId: string) => void;
}) {
  const { expeditions, marches, isOwner, busy, onFocusCell, onResolveExpeditions, onResolveMarch } = props;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="bg-[#16120d] border border-[#2d251a] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 border-b border-[#251e15] pb-2">
        <h3 className="text-sm font-serif text-[#f3e6cb] tracking-wide flex items-center gap-2">
          <Compass className="w-4 h-4 text-[#d4af37]" />
          Operaciones en curso ({expeditions.length + marches.length})
        </h3>
        {isOwner && expeditions.some((e) => now >= e.completesAt) && (
          <button
            type="button"
            onClick={onResolveExpeditions}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-[#d4af37]/20 hover:bg-[#d4af37]/30 border border-[#d4af37]/50 text-xs font-medium text-[#f5df9c] transition-colors disabled:opacity-50"
          >
            Recoger informes
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {expeditions.map((exp) => {
          const remainingSec = Math.max(0, Math.ceil((exp.completesAt - now) / 1000));
          const pct = exp.durationMs > 0
            ? Math.min(100, Math.max(4, Math.round(((exp.durationMs - Math.max(0, exp.completesAt - now)) / exp.durationMs) * 100)))
            : 100;
          const ready = remainingSec === 0;
          return (
            <div
              key={exp.expeditionId}
              className="bg-[#110e0a] border border-[#2a2218] rounded-lg p-2.5 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => onFocusCell(exp.cellId)}
                  className="text-[#e7d8b9] hover:text-[#fbbf24] font-medium flex items-center gap-1.5 text-left"
                >
                  {exp.isSpyMission ? (
                    <Eye className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  ) : (
                    <Compass className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  )}
                  {exp.isSpyMission ? "Misión de espionaje" : "Exploración"} ({exp.cellId})
                </button>
                <span className="font-mono text-[#c5b593]">
                  {ready ? "Lista" : formatDuration(remainingSec)}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[#241d15] overflow-hidden">
                <div
                  className={exp.isSpyMission ? "h-full bg-purple-400 transition-all" : "h-full bg-sky-400 transition-all"}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}

        {marches.map((m) => {
          const remainingSec = Math.max(0, Math.ceil((m.completesAt - now) / 1000));
          const pct = m.durationMs > 0
            ? Math.min(100, Math.max(4, Math.round(((now - m.startedAt) / m.durationMs) * 100)))
            : 100;
          const ready = remainingSec === 0;
          return (
            <div
              key={m.marchId}
              className="bg-[#110e0a] border border-[#3a221c] rounded-lg p-2.5 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => onFocusCell(m.cellId)}
                  className="text-[#f3d1c6] hover:text-[#fbbf24] font-medium flex items-center gap-1.5 text-left"
                >
                  <Swords className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  {m.isConquest ? "Marcha de conquista" : "Marcha militar"} ({m.cellId})
                </button>
                {ready && isOwner ? (
                  <button
                    type="button"
                    onClick={() => onResolveMarch(m.marchId)}
                    disabled={busy}
                    className="px-2 py-0.5 rounded bg-red-900/50 hover:bg-red-800/60 border border-red-500/50 text-red-200 font-medium"
                  >
                    Resolver
                  </button>
                ) : (
                  <span className="font-mono text-[#d8b4a6]">
                    {ready ? "Llegada" : formatDuration(remainingSec)}
                  </span>
                )}
              </div>
              <div className="h-1.5 w-full rounded-full bg-[#241816] overflow-hidden">
                <div className="h-full bg-red-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MapPanel(props: { kingdomId: string; isOwner: boolean; homeTerritoryId: string | null }) {
  const { kingdomId, isOwner, homeTerritoryId } = props;

  // Solo 2 suscripciones reactivas (eliminada la suscripción duplicada a getKingdomTerritories)
  const world = useQuery(getWorldMapCompactQuery, { kingdomId }) as CompactWorldMapResponse | undefined;
  const armyState = useQuery(getArmyStateQuery, { kingdomId }) as ArmyStateSummary | undefined;

  const startExploration = useMutation(startExplorationMutation);
  const startSpyMission = useMutation(startSpyMissionMutation);
  const resolvePendingExplorations = useMutation(resolvePendingExplorationsMutation);
  const claimFreeTerritory = useMutation(claimFreeTerritoryMutation);
  const launchArmyMarch = useMutation(launchArmyMarchMutation);
  const resolveArmyMarch = useMutation(resolveArmyMarchMutation);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<MedievalMapRenderer | null>(null);
  const hoverHudRef = useRef<HTMLDivElement | null>(null);
  const zoomLabelRef = useRef<HTMLSpanElement | null>(null);

  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"info" | "provinces" | "chronicle">("info");

  // Estado del formulario de marcha militar
  const [marchUnits, setMarchUnits] = useState<Record<string, number>>({
    infanteria: 0,
    caballeria: 0,
    arqueria: 0,
    asedio: 0,
  });
  const [marchConquest, setMarchConquest] = useState(true);

  const radius = world?.radius ?? MAP.RADIUS;
  const worldSeed = world?.worldSeed ?? MAP.WORLD_SEED;
  const effectiveHomeId = world?.homeTerritoryId ?? homeTerritoryId;

  // Índice estático del disco completo (7.651 hexágonos): se construye UNA vez por sesión
  const staticWorld = useMemo(
    () => getCachedStaticWorld(radius, worldSeed, BASE_HEX_SIZE),
    [radius, worldSeed]
  );

  // Mapa ligero solo de celdas dinámicas visibles (0 asignaciones para celdas bajo niebla)
  const visibleById = useMemo(() => {
    const map = new Map<string, RenderableMapCell>();
    if (!world?.visibleCells) return map;
    for (let i = 0; i < world.visibleCells.length; i++) {
      const c = world.visibleCells[i];
      map.set(c.cellId, c);
    }
    return map;
  }, [world?.visibleCells]);

  const ownedCells = useMemo(() => {
    if (!world?.visibleCells) return [] as RenderableMapCell[];
    return world.visibleCells.filter((c) => c.state === "owned");
  }, [world?.visibleCells]);

  const ownedCoords = useMemo<HexCoord[]>(() => {
    const coords = ownedCells.map((c) => ({ q: c.q, r: c.r }));
    if (effectiveHomeId) {
      const hc = parseCellId(effectiveHomeId);
      if (hc && !coords.some((c) => c.q === hc.q && c.r === hc.r)) {
        coords.push(hc);
      }
    }
    return coords;
  }, [ownedCells, effectiveHomeId]);

  // Cálculo O(|T_owned|) por expansión local de radio 2 (en lugar de O(|V| * |T_owned|))
  const claimableAdjacentIds = useMemo(
    () => computeClaimableAdjacentIds(ownedCoords, visibleById, radius),
    [ownedCoords, visibleById, radius]
  );

  // Datos de la celda seleccionada (combinando overlay dinámico + fallback de niebla sin duplicar 7.651 objetos)
  const selectedCell = useMemo<RenderableMapCell | null>(() => {
    if (!selectedCellId) return null;
    const dynamic = visibleById.get(selectedCellId);
    if (dynamic) return dynamic;
    const coord = parseCellId(selectedCellId);
    if (!coord) return null;
    return {
      cellId: selectedCellId,
      q: coord.q,
      r: coord.r,
      terrain: "desconocido",
      ownerKingdomId: null,
      ownerName: null,
      ownerColor: null,
      isHome: false,
      state: "fog",
      canExplore: false,
      canConquer: false,
      explorationPlan: null,
      expedition: null,
    };
  }, [selectedCellId, visibleById]);

  const updateZoomBadge = useCallback((zoom: number) => {
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(zoom * 100)}%`;
    }
  }, []);

  const applyCamera = useCallback(
    (next: CameraState) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      renderer.setCamera(next);
      setPersistedCamera(kingdomId, next);
      updateZoomBadge(next.zoom);
    },
    [kingdomId, updateZoomBadge]
  );

  const centerOnCoord = useCallback(
    (coord: HexCoord, zoom?: number) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const current = renderer.getCamera();
      const pos = axialToPixel(coord.q, coord.r, BASE_HEX_SIZE);
      applyCamera({
        x: -pos.x,
        y: -pos.y,
        zoom: zoom ?? current.zoom,
      });
    },
    [applyCamera]
  );

  const centerOnCapital = useCallback(
    (resetZoom = true) => {
      const hc = effectiveHomeId ? parseCellId(effectiveHomeId) : null;
      const targetZoom = resetZoom ? DEFAULT_CAPITAL_ZOOM : rendererRef.current?.getCamera().zoom ?? DEFAULT_CAPITAL_ZOOM;
      const cam = createCapitalCenteredCamera(hc, targetZoom, BASE_HEX_SIZE);
      applyCamera(cam);
      if (effectiveHomeId) {
        setSelectedCellId(effectiveHomeId);
      }
    },
    [effectiveHomeId, applyCamera]
  );

  const centerOnCellId = useCallback(
    (id: string) => {
      const coord = parseCellId(id);
      if (!coord) return;
      const currentZoom = rendererRef.current?.getCamera().zoom ?? DEFAULT_CAPITAL_ZOOM;
      centerOnCoord(coord, Math.max(currentZoom, 1.0));
      setSelectedCellId(id);
      setSidebarTab("info");
    },
    [centerOnCoord]
  );

  // Referencia estable para leer el overlay dinámico desde manejadores de puntero sin re-registrar listeners
  const visibleByIdRef = useRef(visibleById);
  visibleByIdRef.current = visibleById;

  // Inicialización del motor Canvas 2D + ResizeObserver + cámara persistida o centrada en capital
  const initializedCameraRef = useRef<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const renderer = new MedievalMapRenderer(canvas, radius, worldSeed);
    rendererRef.current = renderer;

    const syncSize = () => {
      const rect = container.getBoundingClientRect();
      renderer.setViewport(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    syncSize();

    // Restaurar cámara persistida si el jugador vuelve de otra pestaña; si es primera apertura, centrar en capital
    const saved = getPersistedCamera(kingdomId);
    if (saved) {
      renderer.setCamera(saved);
      updateZoomBadge(saved.zoom);
      initializedCameraRef.current = kingdomId;
    } else if (effectiveHomeId) {
      const hc = parseCellId(effectiveHomeId);
      const initial = createCapitalCenteredCamera(hc, DEFAULT_CAPITAL_ZOOM, BASE_HEX_SIZE);
      renderer.setCamera(initial);
      setPersistedCamera(kingdomId, initial);
      updateZoomBadge(initial.zoom);
      initializedCameraRef.current = kingdomId;
    }

    const observer = new ResizeObserver(() => syncSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [kingdomId, radius, worldSeed, updateZoomBadge]);

  // Si homeTerritoryId llega tras el primer montaje y no había cámara guardada, centrar en capital una sola vez
  useEffect(() => {
    if (!effectiveHomeId || initializedCameraRef.current === kingdomId) return;
    const saved = getPersistedCamera(kingdomId);
    if (saved) {
      initializedCameraRef.current = kingdomId;
      return;
    }
    const hc = parseCellId(effectiveHomeId);
    const initial = createCapitalCenteredCamera(hc, DEFAULT_CAPITAL_ZOOM, BASE_HEX_SIZE);
    applyCamera(initial);
    initializedCameraRef.current = kingdomId;
  }, [effectiveHomeId, kingdomId, applyCamera]);

  // Sincronizar datos del servidor con la capa base del motor
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !world) return;
    renderer.setData({
      radius: world.radius,
      worldSeed: world.worldSeed,
      kingdomId,
      homeTerritoryId: effectiveHomeId,
      pendingClaims: world.pendingClaims,
      visibleCells: world.visibleCells,
      claimableAdjacentIds,
      activeMarches: world.activeMarches,
    });
  }, [world, kingdomId, effectiveHomeId, claimableAdjacentIds]);

  // Sincronizar selección con la capa dinámica O(1) (no redibuja la capa base)
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const coord = selectedCellId ? parseCellId(selectedCellId) : null;
    renderer.setSelectedCell(coord ? coord.q : null, coord ? coord.r : null);
  }, [selectedCellId]);

  // Interacción imperativa de ratón, rueda y gestos táctiles (0 re-renders en React durante pan/zoom/hover)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isDragging = false;
    let didDragMove = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragOriginCam: CameraState = { x: 0, y: 0, zoom: DEFAULT_CAPITAL_ZOOM };

    // Estado de pellizco táctil (pinch-to-zoom centrado en el punto medio real)
    let pinchStartDist = 0;
    let pinchStartZoom = DEFAULT_CAPITAL_ZOOM;
    let activeTouchId: number | null = null;

    const getCanvasLocalPoint = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top, width: rect.width, height: rect.height };
    };

    const updateHoverHud = (clientX: number, clientY: number) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const pt = getCanvasLocalPoint(clientX, clientY);
      const picked = renderer.pickCellAtScreen(pt.x, pt.y);
      if (!picked) {
        renderer.setHoveredCell(null, null);
        if (hoverHudRef.current) hoverHudRef.current.textContent = "Fuera del disco cartográfico";
        return;
      }
      renderer.setHoveredCell(picked.q, picked.r);
      if (hoverHudRef.current) {
        const dyn = visibleByIdRef.current.get(picked.cellId);
        if (!dyn || dyn.state === "fog") {
          hoverHudRef.current.textContent = `(${picked.q}, ${picked.r}) · Tierras inexploradas${dyn?.canExplore ? " · Explorable" : ""}`;
        } else if (dyn.state === "exploring") {
          hoverHudRef.current.textContent = `(${picked.q}, ${picked.r}) · Expedición en curso`;
        } else {
          const tInfo = dyn.terrain !== "desconocido" ? TERRAINS[dyn.terrain as TerrainType] : null;
          const ownerLabel = dyn.ownerName ? ` · ${dyn.ownerName}${dyn.isHome ? " (Capital)" : ""}` : " · Tierra libre";
          hoverHudRef.current.textContent = `(${picked.q}, ${picked.r}) · ${tInfo?.label ?? dyn.terrain}${ownerLabel}`;
        }
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const renderer = rendererRef.current;
      if (!renderer) return;
      isDragging = true;
      didDragMove = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragOriginCam = renderer.getCamera();
    };

    const onMouseMove = (e: MouseEvent) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      if (isDragging) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didDragMove = true;
        const nextCam: CameraState = {
          x: dragOriginCam.x + dx / dragOriginCam.zoom,
          y: dragOriginCam.y + dy / dragOriginCam.zoom,
          zoom: dragOriginCam.zoom,
        };
        applyCamera(nextCam);
        return;
      }
      updateHoverHud(e.clientX, e.clientY);
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!isDragging) return;
      isDragging = false;
      if (!didDragMove) {
        const renderer = rendererRef.current;
        if (!renderer) return;
        const pt = getCanvasLocalPoint(e.clientX, e.clientY);
        const picked = renderer.pickCellAtScreen(pt.x, pt.y);
        if (picked) {
          setSelectedCellId(picked.cellId);
          setSidebarTab("info");
        }
      }
    };

    const onMouseLeave = () => {
      isDragging = false;
      rendererRef.current?.setHoveredCell(null, null);
      if (hoverHudRef.current) hoverHudRef.current.textContent = "Desliza para explorar · Rueda para zoom";
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const renderer = rendererRef.current;
      if (!renderer) return;
      const pt = getCanvasLocalPoint(e.clientX, e.clientY);
      const current = renderer.getCamera();
      const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
      const next = zoomCameraAtPoint(current, pt.x, pt.y, { width: pt.width, height: pt.height }, current.zoom * factor);
      applyCamera(next);
    };

    const onTouchStart = (e: TouchEvent) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      if (e.touches.length === 1) {
        const t = e.touches[0];
        activeTouchId = t.identifier;
        isDragging = true;
        didDragMove = false;
        dragStartX = t.clientX;
        dragStartY = t.clientY;
        dragOriginCam = renderer.getCamera();
      } else if (e.touches.length === 2) {
        e.preventDefault();
        isDragging = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        pinchStartZoom = renderer.getCamera().zoom;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      if (e.touches.length === 1 && isDragging) {
        const t = Array.from(e.touches).find((item) => item.identifier === activeTouchId) ?? e.touches[0];
        const dx = t.clientX - dragStartX;
        const dy = t.clientY - dragStartY;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
          didDragMove = true;
          e.preventDefault();
        }
        applyCamera({
          x: dragOriginCam.x + dx / dragOriginCam.zoom,
          y: dragOriginCam.y + dy / dragOriginCam.zoom,
          zoom: dragOriginCam.zoom,
        });
      } else if (e.touches.length === 2 && pinchStartDist > 0) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const midX = (t1.clientX + t2.clientX) * 0.5;
        const midY = (t1.clientY + t2.clientY) * 0.5;
        const pt = getCanvasLocalPoint(midX, midY);
        const targetZoom = pinchStartZoom * (dist / pinchStartDist);
        const next = zoomCameraAtPoint(renderer.getCamera(), pt.x, pt.y, { width: pt.width, height: pt.height }, targetZoom);
        applyCamera(next);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0 && isDragging && !didDragMove && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        const renderer = rendererRef.current;
        if (renderer) {
          const pt = getCanvasLocalPoint(t.clientX, t.clientY);
          const picked = renderer.pickCellAtScreen(pt.x, pt.y);
          if (picked) {
            setSelectedCellId(picked.cellId);
            setSidebarTab("info");
          }
        }
      }
      if (e.touches.length < 2) pinchStartDist = 0;
      if (e.touches.length === 0) {
        isDragging = false;
        activeTouchId = null;
      }
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [applyCamera]);

  // Acciones de zoom por botón centradas en el centro del viewport
  const stepZoom = useCallback(
    (multiplier: number) => {
      const renderer = rendererRef.current;
      const container = containerRef.current;
      if (!renderer || !container) return;
      const rect = container.getBoundingClientRect();
      const current = renderer.getCamera();
      const next = zoomCameraAtPoint(
        current,
        rect.width * 0.5,
        rect.height * 0.5,
        { width: rect.width, height: rect.height },
        current.zoom * multiplier
      );
      applyCamera(next);
    },
    [applyCamera]
  );

  const showWorldOverview = useCallback(() => {
    applyCamera({ x: 0, y: 0, zoom: 0.3 });
  }, [applyCamera]);

  // Acciones de juego (todas autoritativas en servidor)
  const runAction = useCallback(async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const msg = await fn();
      setFeedback(msg);
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleStartExploration = useCallback(
    (cellId: string) =>
      runAction(async () => {
        await startExploration({ kingdomId, cellId });
        return `Expedición enviada hacia (${cellId}).`;
      }),
    [kingdomId, runAction, startExploration]
  );

  const handleStartSpyMission = useCallback(
    (cellId: string) =>
      runAction(async () => {
        await startSpyMission({ kingdomId, cellId });
        return `Espías despachados hacia (${cellId}).`;
      }),
    [kingdomId, runAction, startSpyMission]
  );

  const handleResolveExpeditions = useCallback(
    () =>
      runAction(async () => {
        const res = (await resolvePendingExplorations({ kingdomId })) as { resolved?: number } | undefined;
        return `Expediciones resueltas: ${res?.resolved ?? 0}.`;
      }),
    [kingdomId, resolvePendingExplorations, runAction]
  );

  const handleClaimFreeTerritory = useCallback(
    (cellId: string) =>
      runAction(async () => {
        await claimFreeTerritory({ kingdomId, cellId });
        return `Territorio (${cellId}) anexado a tu reino.`;
      }),
    [claimFreeTerritory, kingdomId, runAction]
  );

  const handleLaunchMarch = useCallback(
    (cellId: string) => {
      const units = Object.entries(marchUnits)
        .filter(([, count]) => count > 0)
        .map(([unitType, count]) => ({ unitType, count }));
      if (units.length === 0) {
        setError("Selecciona al menos una unidad para enviar la marcha.");
        return;
      }
      void runAction(async () => {
        await launchArmyMarch({
          kingdomId,
          targetCellId: cellId,
          units,
          isConquest: marchConquest,
        });
        setMarchUnits({ infanteria: 0, caballeria: 0, arqueria: 0, asedio: 0 });
        return `Marcha militar enviada hacia (${cellId}).`;
      });
    },
    [kingdomId, launchArmyMarch, marchConquest, marchUnits, runAction]
  );

  const handleResolveMarch = useCallback(
    (marchId: string) =>
      runAction(async () => {
        await resolveArmyMarch({ kingdomId, marchId });
        return "Marcha militar resuelta.";
      }),
    [kingdomId, resolveArmyMarch, runAction]
  );

  const availableSpies = armyState?.spyCount ?? 0;
  const availableArmyTotal = armyState?.army?.totalActive ?? 0;
  const availableByType = armyState?.army?.byType ?? {};
  const activeExpeditions = world?.activeExpeditions ?? [];
  const activeMarches = world?.activeMarches ?? [];
  const hasActiveActivities = activeExpeditions.length > 0 || activeMarches.length > 0;
  const recentDiscoveries = world?.recentDiscoveries ?? [];

  const selectedTerrainMeta =
    selectedCell && selectedCell.terrain !== "desconocido"
      ? TERRAINS[selectedCell.terrain as TerrainType]
      : null;

  const isSelectedClaimable =
    selectedCell !== null &&
    (world?.pendingClaims ?? 0) > 0 &&
    claimableAdjacentIds.has(selectedCell.cellId);

  return (
    <section className="space-y-4">
      {/* Cabecera cartográfica compacta */}
      <div className="bg-[#15110c] border border-[#2d2419] rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-serif text-[#f5e7c8] tracking-wide flex items-center gap-2">
            <Globe className="w-5 h-5 text-[#d4af37]" />
            Atlas de La Conquista
          </h2>
          <p className="text-xs text-[#b7a685] mt-0.5">
            {world ? (
              <>
                {world.exploredCount.toLocaleString("es-ES")} / {staticWorld.totalCells.toLocaleString("es-ES")} regiones cartografiadas ·{" "}
                {ownedCells.length} territorios propios · {availableSpies} espías · {availableArmyTotal} tropas disponibles
              </>
            ) : (
              "Cargando cartografía del mundo..."
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => centerOnCapital(true)}
            className="min-h-[44px] px-3.5 py-2 rounded-lg bg-[#d4af37]/20 hover:bg-[#d4af37]/30 border border-[#d4af37]/50 text-xs font-semibold text-[#fbe6a2] flex items-center gap-2 transition-colors"
          >
            <Castle className="w-4 h-4" />
            Ir a mi capital
          </button>
          <button
            type="button"
            onClick={showWorldOverview}
            className="min-h-[44px] px-3 py-2 rounded-lg bg-[#1d1710] hover:bg-[#271f16] border border-[#3a2f20] text-xs font-medium text-[#d9c8a6] flex items-center gap-1.5 transition-colors"
          >
            <Globe className="w-4 h-4 text-[#b7a685]" />
            Vista mundial
          </button>
          {isOwner && activeExpeditions.length > 0 && (
            <button
              type="button"
              onClick={handleResolveExpeditions}
              disabled={busy}
              className="min-h-[44px] px-3 py-2 rounded-lg bg-[#1c242b] hover:bg-[#23303a] border border-sky-500/40 text-xs font-medium text-sky-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Actualizar expediciones
            </button>
          )}
        </div>
      </div>

      {/* Aviso de reclamos gratuitos pendientes */}
      {isOwner && (world?.pendingClaims ?? 0) > 0 && (
        <div className="bg-[#231b0e] border border-[#d4af37]/50 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="text-xs text-[#f6e3aa] flex items-center gap-2">
            <Flag className="w-4 h-4 text-[#fbbf24] shrink-0" />
            <span>
              Tienes <strong>{world?.pendingClaims}</strong> reclamo(s) gratuito(s) de territorio. Los hexágonos resaltados en dorado discontinuo pueden anexarse sin combate.
            </span>
          </div>
          <span className="text-[11px] font-mono text-[#d4af37]">
            {claimableAdjacentIds.size} disponibles
          </span>
        </div>
      )}

      <StatusMessages error={error} message={feedback} />

      {/* Zona principal: lienzo cartográfico + panel lateral de órdenes */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Lienzo Canvas 2D ilustrado */}
        <div className="lg:col-span-8 bg-[#0e0c09] border border-[#2e2519] rounded-xl overflow-hidden shadow-lg relative">
          <div
            ref={containerRef}
            className="relative w-full h-[460px] sm:h-[560px] lg:h-[620px] select-none touch-none cursor-grab active:cursor-grabbing"
          >
            <canvas ref={canvasRef} className="block w-full h-full" />

            {/* Indicador de carga inicial */}
            {!world && (
              <div className="absolute inset-0 bg-[#0d0b08]/80 flex items-center justify-center">
                <div className="text-sm font-serif text-[#e5d4b0]">Trazando el mapa del reino...</div>
              </div>
            )}

            {/* Barra inferior de coordenadas / hover (actualizada por ref, 0 re-renders en React) */}
            <div className="absolute left-3 bottom-3 max-w-[calc(100%-6rem)] pointer-events-none">
              <div
                ref={hoverHudRef}
                className="px-3 py-1.5 rounded-lg bg-[#120e0a]/90 border border-[#3a2e1e] text-[11px] text-[#e7d8b9] backdrop-blur-xs truncate"
              >
                Desliza para explorar · Rueda para zoom
              </div>
            </div>

            {/* Controles táctiles de cámara (>= 44px para móvil) */}
            <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
              <button
                type="button"
                aria-label="Acercar mapa"
                onClick={() => stepZoom(1.25)}
                className="w-11 h-11 rounded-lg bg-[#15110c]/92 hover:bg-[#241d14] border border-[#3c3020] text-[#f3e6cb] flex items-center justify-center shadow-md transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Alejar mapa"
                onClick={() => stepZoom(0.8)}
                className="w-11 h-11 rounded-lg bg-[#15110c]/92 hover:bg-[#241d14] border border-[#3c3020] text-[#f3e6cb] flex items-center justify-center shadow-md transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Centrar en mi capital"
                onClick={() => centerOnCapital(false)}
                className="w-11 h-11 rounded-lg bg-[#1f180e]/92 hover:bg-[#2f2414] border border-[#d4af37]/50 text-[#fbbf24] flex items-center justify-center shadow-md transition-colors"
              >
                <Crosshair className="w-4 h-4" />
              </button>
              <div className="px-2 py-1 rounded bg-[#120e0a]/90 border border-[#2f2519] text-center">
                <span ref={zoomLabelRef} className="text-[10px] font-mono text-[#c9b793]">
                  {Math.round(DEFAULT_CAPITAL_ZOOM * 100)}%
                </span>
              </div>
            </div>
          </div>

          {/* Leyenda cartográfica limpia debajo del lienzo */}
          <div className="bg-[#14100b] border-t border-[#282016] px-4 py-2.5 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-[11px] text-[#c7b797]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {(Object.keys(MEDIEVAL_TERRAIN_PALETTE) as TerrainType[]).map((tKey) => {
                const pal = MEDIEVAL_TERRAIN_PALETTE[tKey];
                return (
                  <span key={tKey} className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-xs border border-black/40"
                      style={{ backgroundColor: pal.swatch }}
                    />
                    {pal.label}
                  </span>
                );
              })}
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs border border-[#3a3023] bg-[#1b1813]" />
                Niebla
              </span>
            </div>
            <span className="text-[#9e8d6c]">
              Zoom {Math.round(MIN_ZOOM * 100)}%–{Math.round(MAX_ZOOM * 100)}%
            </span>
          </div>
        </div>

        {/* Panel lateral derecho: Inspección, Provincias y Crónica */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-[#15110c] border border-[#2d2419] rounded-xl overflow-hidden">
            <div className="grid grid-cols-3 border-b border-[#271f15] bg-[#110e0a] text-xs font-medium">
              <button
                type="button"
                onClick={() => setSidebarTab("info")}
                className={`py-2.5 transition-colors ${
                  sidebarTab === "info"
                    ? "text-[#fbe6a2] border-b-2 border-[#d4af37] bg-[#19140e]"
                    : "text-[#9f8f71] hover:text-[#dfd0b0]"
                }`}
              >
                Territorio
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab("provinces")}
                className={`py-2.5 transition-colors ${
                  sidebarTab === "provinces"
                    ? "text-[#fbe6a2] border-b-2 border-[#d4af37] bg-[#19140e]"
                    : "text-[#9f8f71] hover:text-[#dfd0b0]"
                }`}
              >
                Dominios ({ownedCells.length})
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab("chronicle")}
                className={`py-2.5 transition-colors ${
                  sidebarTab === "chronicle"
                    ? "text-[#fbe6a2] border-b-2 border-[#d4af37] bg-[#19140e]"
                    : "text-[#9f8f71] hover:text-[#dfd0b0]"
                }`}
              >
                Crónica
              </button>
            </div>

            <div className="p-4 space-y-4 max-h-[560px] overflow-y-auto">
              {sidebarTab === "info" && (
                <>
                  {!selectedCell ? (
                    <div className="py-8 text-center space-y-2">
                      <MapPin className="w-7 h-7 text-[#7d6c4d] mx-auto" />
                      <p className="text-sm font-serif text-[#dfd0b0]">Selecciona un hexágono</p>
                      <p className="text-xs text-[#9e8e70]">
                        Pulsa sobre cualquier región del mapa para consultar su terreno, soberanía y órdenes disponibles.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Cabecera de la región seleccionada */}
                      <div className="flex items-start justify-between gap-2 border-b border-[#261e15] pb-3">
                        <div>
                          <div className="text-sm font-serif text-[#f5e7c8] flex items-center gap-2">
                            {selectedCell.isHome && <Castle className="w-4 h-4 text-[#fbbf24]" />}
                            {selectedTerrainMeta ? selectedTerrainMeta.label : "Región inexplorada"}
                          </div>
                          <div className="text-[11px] font-mono text-[#a69574] mt-0.5">
                            Coordenadas ({selectedCell.q}, {selectedCell.r})
                          </div>
                        </div>
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-[#211b13] border border-[#3a2f20] text-[#dfd0b0]">
                          {selectedCell.state === "owned"
                            ? selectedCell.isHome
                              ? "Tu capital"
                              : "Tu dominio"
                            : selectedCell.state === "exploring"
                            ? "Explorando"
                            : selectedCell.state === "explored"
                            ? selectedCell.ownerName
                              ? "Territorio rival"
                              : "Tierra libre"
                            : "Niebla"}
                        </span>
                      </div>

                      {/* Detalles del terreno */}
                      {selectedTerrainMeta && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="bg-[#110e0a] border border-[#261e15] rounded-lg p-2.5">
                            <div className="text-[#9c8c6d]">Defensa / Marcha</div>
                            <div className="text-[#f2e4c7] font-semibold mt-0.5 flex items-center gap-1">
                              <Shield className="w-3.5 h-3.5 text-[#d4af37]" />
                              +{Math.round(selectedTerrainMeta.defense * 100)}% · ×{selectedTerrainMeta.marchMultiplier.toFixed(2)}
                            </div>
                          </div>
                          <div className="bg-[#110e0a] border border-[#261e15] rounded-lg p-2.5">
                            <div className="text-[#9c8c6d]">Propietario</div>
                            <div className="text-[#f2e4c7] font-semibold mt-0.5 truncate">
                              {selectedCell.ownerName ?? "Sin reclamar"}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Exploración de celda fronteriza */}
                      {isOwner && selectedCell.state === "fog" && selectedCell.canExplore && (
                        <div className="bg-[#12100c] border border-[#342a1b] rounded-lg p-3 space-y-2.5">
                          <div className="text-xs font-semibold text-[#f3df9e]">Expedición de reconocimiento</div>
                          {selectedCell.explorationPlan && (
                            <div className="text-[11px] text-[#c3b290] space-y-0.5">
                              <div>Distancia: {selectedCell.explorationPlan.distance} hexágonos</div>
                              <div>Duración: {formatDuration(selectedCell.explorationPlan.durationSeconds)}</div>
                              <div>
                                Coste: {selectedCell.explorationPlan.costs.gold} oro · {selectedCell.explorationPlan.costs.food} comida
                              </div>
                            </div>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => handleStartExploration(selectedCell.cellId)}
                              disabled={busy || availableSpies < 1}
                              className="min-h-[40px] px-3 py-2 rounded-lg bg-[#d4af37]/20 hover:bg-[#d4af37]/30 border border-[#d4af37]/50 text-xs font-semibold text-[#fbe6a2] transition-colors disabled:opacity-45"
                            >
                              Explorar ({availableSpies} espías)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStartSpyMission(selectedCell.cellId)}
                              disabled={busy || availableSpies < 1}
                              className="min-h-[40px] px-3 py-2 rounded-lg bg-purple-950/50 hover:bg-purple-900/50 border border-purple-500/40 text-xs font-semibold text-purple-200 transition-colors disabled:opacity-45"
                            >
                              Misión espía
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Reclamo gratuito */}
                      {isOwner && isSelectedClaimable && (
                        <button
                          type="button"
                          onClick={() => handleClaimFreeTerritory(selectedCell.cellId)}
                          disabled={busy}
                          className="w-full min-h-[42px] px-3 py-2 rounded-lg bg-[#d4af37] hover:bg-[#e1be49] text-[#14100a] text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                        >
                          <Flag className="w-4 h-4" />
                          Reclamar territorio gratuitamente
                        </button>
                      )}

                      {/* Marcha militar sobre territorio explorado no propio */}
                      {isOwner && selectedCell.state === "explored" && (
                        <div className="bg-[#15100d] border border-[#3a241d] rounded-lg p-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-[#f3cfc3] flex items-center gap-1.5">
                              <Swords className="w-3.5 h-3.5 text-red-400" />
                              Enviar marcha militar
                            </span>
                            <span className="text-[11px] text-[#b89f94]">
                              {availableArmyTotal} disponibles
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {Object.entries(UNIT_LABELS).map(([uKey, uLabel]) => {
                              const maxAvail = availableByType[uKey] ?? 0;
                              return (
                                <label key={uKey} className="block text-[11px] text-[#c7b797]">
                                  <span className="flex justify-between">
                                    <span>{uLabel}</span>
                                    <span className="font-mono text-[#8f7f63]">{maxAvail}</span>
                                  </span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={maxAvail}
                                    value={marchUnits[uKey] ?? 0}
                                    onChange={(e) => {
                                      const val = Math.max(0, Math.min(maxAvail, Number(e.target.value) || 0));
                                      setMarchUnits((prev) => ({ ...prev, [uKey]: val }));
                                    }}
                                    className="mt-1 w-full px-2 py-1.5 rounded bg-[#0d0a08] border border-[#32271b] text-xs text-[#f3e6cb] font-mono"
                                  />
                                </label>
                              );
                            })}
                          </div>

                          <label className="flex items-center gap-2 text-xs text-[#dfd0b0] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={marchConquest}
                              onChange={(e) => setMarchConquest(e.target.checked)}
                              className="rounded border-[#4a3b28]"
                            />
                            Orden de conquista (anexar si vence)
                          </label>

                          <button
                            type="button"
                            onClick={() => handleLaunchMarch(selectedCell.cellId)}
                            disabled={busy || availableArmyTotal <= 0}
                            className="w-full min-h-[42px] px-3 py-2 rounded-lg bg-red-900/70 hover:bg-red-800/80 border border-red-500/50 text-xs font-semibold text-red-100 transition-colors disabled:opacity-45"
                          >
                            Despachar ejército hacia ({selectedCell.q}, {selectedCell.r})
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {sidebarTab === "provinces" && (
                <div className="space-y-2">
                  {ownedCells.length === 0 ? (
                    <p className="text-xs text-[#9e8e70] py-4 text-center">Aún no hay territorios registrados.</p>
                  ) : (
                    ownedCells.map((cell) => {
                      const tLabel =
                        cell.terrain !== "desconocido"
                          ? TERRAINS[cell.terrain as TerrainType]?.label ?? cell.terrain
                          : "Desconocido";
                      return (
                        <button
                          key={cell.cellId}
                          type="button"
                          onClick={() => centerOnCellId(cell.cellId)}
                          className="w-full text-left px-3 py-2 rounded-lg bg-[#110e0a] hover:bg-[#1c160f] border border-[#2a2218] flex items-center justify-between gap-2 transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {cell.isHome ? (
                              <Castle className="w-4 h-4 text-[#fbbf24] shrink-0" />
                            ) : (
                              <Flag className="w-3.5 h-3.5 text-[#b59c6b] shrink-0" />
                            )}
                            <span className="text-xs text-[#f2e4c7] font-medium truncate">
                              {cell.isHome ? "Capital" : tLabel} ({cell.cellId})
                            </span>
                          </div>
                          <span className="text-[11px] text-[#9e8e70] shrink-0">{tLabel}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              {sidebarTab === "chronicle" && (
                <div className="space-y-2">
                  {recentDiscoveries.length === 0 ? (
                    <p className="text-xs text-[#9e8e70] py-4 text-center">
                      Aún no se han registrado descubrimientos recientes.
                    </p>
                  ) : (
                    recentDiscoveries
                      .slice()
                      .reverse()
                      .map((disc, i) => (
                        <button
                          key={`${disc.cellId}-${i}`}
                          type="button"
                          onClick={() => centerOnCellId(disc.cellId)}
                          className="w-full text-left px-3 py-2 rounded-lg bg-[#110e0a] hover:bg-[#1c160f] border border-[#2a2218] transition-colors"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-mono text-[#e7d8b9]">({disc.cellId})</span>
                            <span className="text-[10px] text-[#8f7f63]">
                              {new Date(disc.discoveredAt).toLocaleDateString("es-ES")}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#b7a685] mt-0.5">{disc.note}</div>
                        </button>
                      ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Leyenda de reinos visibles (solo reinos revelados fuera de niebla) */}
          {world && world.kingdomLegend.length > 0 && (
            <div className="bg-[#15110c] border border-[#2d2419] rounded-xl p-4 space-y-2.5">
              <h3 className="text-xs font-serif uppercase tracking-wider text-[#cbb995]">
                Reinos avistados
              </h3>
              <div className="space-y-1.5">
                {world.kingdomLegend.map((k) => (
                  <div key={k.id} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-[#e9dbb9] truncate">
                      <span
                        className="w-3 h-3 rounded-xs border border-black/50 shrink-0"
                        style={{ backgroundColor: k.color }}
                      />
                      <span className="truncate">{k.name}</span>
                    </span>
                    <span className="font-mono text-[11px] text-[#a69574] shrink-0">
                      {k.territoryCount} {k.territoryCount === 1 ? "región" : "regiones"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Operaciones en curso: solo se monta (y ejecuta ticker de 1s) si hay expediciones o marchas activas */}
      {hasActiveActivities && (
        <ActiveActivitiesSection
          expeditions={activeExpeditions}
          marches={activeMarches}
          isOwner={isOwner}
          busy={busy}
          onFocusCell={centerOnCellId}
          onResolveExpeditions={handleResolveExpeditions}
          onResolveMarch={handleResolveMarch}
        />
      )}
    </section>
  );
}
