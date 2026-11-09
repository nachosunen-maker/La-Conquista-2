import { useMutation, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { Map as MapIcon, Flag, Compass, Clock, ShieldAlert, Sparkles, CheckCircle2 } from 'lucide-react';
import { useState, useMemo, useEffect, useRef } from 'react';
import { JOB_LABELS, PanelSection, StatusMessages, cardClass, primaryButton, readOnlyNote, useActionState } from './shared';
import { TroopSelector, TroopSelection } from './TroopSelector';
import { MAP } from '../../convex/balanceConfig';
import { generateWorldCells } from '../../convex/territoryRules';

const getWorldMapQuery = makeFunctionReference<"query">("territories:getWorldMap");
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

interface WorldMap {
  radius: number;
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
  pendingClaims: number;
  homeTerritoryId: string | null;
  cells: WorldMapCell[];
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

function hexCenter(q: number, r: number): { x: number; y: number } {
  return { x: HEX_SIZE * SQRT3 * (q + r / 2), y: HEX_SIZE * 1.5 * r };
}

function hexPoints(cx: number, cy: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    points.push(`${(cx + HEX_SIZE * Math.cos(angle)).toFixed(2)},${(cy + HEX_SIZE * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(' ');
}

function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function formatRemainingSeconds(completesAt: number): string {
  const remainingSeconds = Math.max(0, Math.ceil((completesAt - Date.now()) / 1000));
  const m = Math.floor(remainingSeconds / 60);
  const s = remainingSeconds % 60;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

export function MapPanel(props: { kingdomId: string; isOwner: boolean; homeTerritoryId: string | null }) {
  const { kingdomId, isOwner } = props;
  const world = useQuery(getWorldMapQuery, { kingdomId }) as WorldMap | undefined;
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
  const [now, setNow] = useState(Date.now());
  const [showTroopSelector, setShowTroopSelector] = useState(false);
  const [targetCellId, setTargetCellId] = useState<string | null>(null);
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    hasMoved: false,
    touchMode: null as 'pan' | 'pinch' | null,
    initialPinchDist: 0,
    initialZoom: 1,
  });

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

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

  const ownedCoords = mine?.territories ?? [];

  const effectiveWorld = useMemo<WorldMap | undefined>(() => {
    if (!world) return undefined;
    if (world.radius >= 50 && world.cells.length >= 7651) {
      return world;
    }
    const serverMap = new Map<string, WorldMapCell>();
    for (const c of world.cells) {
      serverMap.set(c.cellId, c);
    }
    const allCells = generateWorldCells(50, MAP.WORLD_SEED);
    const completedCells: WorldMapCell[] = allCells.map((genCell) => {
      const existing = serverMap.get(genCell.cellId);
      if (existing) return existing;
      return {
        cellId: genCell.cellId,
        q: genCell.q,
        r: genCell.r,
        terrain: genCell.terrain,
        ownerKingdomId: null,
        ownerName: null,
        isHome: false,
        state: "fog",
        canExplore: false,
        canConquer: false,
        explorationPlan: null,
        expedition: null,
      };
    });

    return {
      ...world,
      radius: 50,
      totalCells: 7651,
      cells: completedCells,
    };
  }, [world]);

  const viewBox = useMemo(() => {
    if (!effectiveWorld) return '0 0 100 100';
    const extent = HEX_SIZE * SQRT3 * (effectiveWorld.radius + 1.5);
    const vertical = HEX_SIZE * 1.5 * (effectiveWorld.radius + 1.5);
    return `${-extent} ${-vertical} ${extent * 2} ${vertical * 2}`;
  }, [effectiveWorld]);

  const selectedCell = effectiveWorld ? effectiveWorld.cells.find((c) => c.cellId === selected) ?? null : null;

  const selectedDistance = selectedCell && ownedCoords.length
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

  const handleClaim = () => {
    if (!selectedCell || !effectiveWorld) return;
    action.run('claim', async () => {
      const result = await claim({ kingdomId, cellId: selectedCell.cellId });
      if (result && result.success === false) return result;
      setSelected(null);
      return `Territorio ${result.cellId} (${effectiveWorld.terrains[result.terrain]?.label ?? result.terrain}) anexionado a la corona; reclamaciones restantes: ${result.remainingClaims}.`;
    });
  };

  const [selectedSpiesCount, setSelectedSpiesCount] = useState<number>(1);

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

  const activeExpedition = effectiveWorld?.activeExpeditions?.[0];

  const renderedHexes = useMemo(() => {
    if (!effectiveWorld) return null;
    return effectiveWorld.cells.map((cell) => {
      const { x, y } = hexCenter(cell.q, cell.r);
      const isSelected = selected === cell.cellId;
      const isOwned = cell.state === 'owned';
      const isFog = cell.state === 'fog';
      const isExploring = cell.state === 'exploring';
      const isExplored = cell.state === 'explored';

      const distanceToOwned = ownedCoords.length
        ? Math.min(...ownedCoords.map((t) => hexDistance(t, cell)))
        : null;

      let fill = isFog ? '#16120e' : isExploring ? '#261e12' : (TERRAIN_COLORS[cell.terrain] ?? '#555');
      let fillOpacity = isFog ? 0.92 : isExploring ? 0.85 : isOwned ? 0.95 : cell.ownerKingdomId ? 0.6 : 0.85;
      let stroke = isFog ? '#221b14' : '#1b160f';
      let strokeWidth = isFog ? 0.4 : 0.6;
      let strokeDasharray: string | undefined = undefined;

      if (isSelected) { stroke = '#ffffff'; strokeWidth = 2.5; }
      else if (isOwned) { stroke = '#d4af37'; strokeWidth = 1.8; }
      else if (isExploring) { stroke = '#f59e0b'; strokeWidth = 2; strokeDasharray = '3,2'; }
      else if (cell.canExplore) { stroke = '#0284c7'; strokeWidth = 1.4; }
      else if (cell.canConquer) { stroke = '#7dd3fc'; strokeWidth = 1.8; }
      else if (isExplored && !cell.ownerKingdomId && (mine?.pendingClaims ?? 0) > 0 && distanceToOwned !== null && distanceToOwned <= 2) { stroke = '#7dd3fc'; strokeWidth = 1.4; strokeDasharray = '2,1'; }
      else if (cell.ownerKingdomId) { stroke = '#c05050'; strokeWidth = 1.4; }

      return (
        <g 
          key={cell.cellId} 
          onClick={(e) => {
            e.stopPropagation();
            if (dragRef.current.hasMoved) {
              return;
            }
            setSelected(cell.cellId);
          }} 
          className="cursor-pointer transition-opacity"
        >
          <polygon points={hexPoints(x, y)} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray}>
            <title>{isFog ? `${cell.cellId} · Niebla de guerra (Tierra incógnita)` : `${cell.cellId} · ${effectiveWorld.terrains[cell.terrain]?.label ?? cell.terrain}`}</title>
          </polygon>
          {isOwned && cell.isHome && <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fill="#d4af37" pointerEvents="none">♜</text>}
          {isOwned && !cell.isHome && <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fill="#f0e8d4" pointerEvents="none">⚑</text>}
          {isExploring && <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fill="#f59e0b" pointerEvents="none">🧭</text>}
          {isFog && cell.canExplore && <text x={x} y={y + 3.5} textAnchor="middle" fontSize={9} fill="#38bdf8" pointerEvents="none">🔭</text>}
        </g>
      );
    });
  }, [effectiveWorld, selected, ownedCoords, mine?.pendingClaims]);

  if (!effectiveWorld) {
    return <p className="text-xs text-[#8e816d] italic p-4">Cartografiando el mundo y la niebla de guerra…</p>;
  }

  // Instrumentación en tiempo real de estados de celdas (calculada arriba)

  return (
    <div className="space-y-6">
      <PanelSection
        icon={<MapIcon className="w-4 h-4 text-[#d4af37]" />}
        title="Mapa del mundo y exploración"
        aside={
          <span className="flex items-center gap-3">
            <span>Explorado: {effectiveWorld.exploredCount}/{effectiveWorld.totalCells} ({effectiveWorld.totalCells > 0 ? Math.round((effectiveWorld.exploredCount / effectiveWorld.totalCells) * 100) : 0} %)</span>
            <span>·</span>
            <span className="text-[#d4af37]">{mine?.pendingClaims ?? 0} reclamación(es)</span>
          </span>
        }
      >
        {!effectiveWorld.generated && (
          <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded p-3">
            El mundo aún no se ha generado en el servidor: se crea al fundar el primer reino o al asignar un territorio principal.
          </p>
        )}

        {isOwner && !props.homeTerritoryId && (
          <div className="flex items-center gap-3 text-xs bg-[#18140f] p-3 rounded border border-amber-900/40">
            <span className="text-[#c7beac]">Este reino todavía no tiene territorio principal en el mapa.</span>
            <button type="button" className={primaryButton} disabled={action.busy !== null} onClick={handleEnsureHome}>
              {action.busy === 'home' ? 'Asignando…' : 'Asignar territorio principal'}
            </button>
          </div>
        )}

        {/* Banner de expedición activa */}
        {activeExpedition && (
          <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 text-xs border p-3 rounded-lg ${activeExpedition.isSpyMission ? 'bg-[#0f172a] border-sky-800/60' : 'bg-[#1a150e] border-amber-800/60'}`}>
            <div className="flex items-center gap-2">
              <Compass className={`w-4 h-4 animate-spin ${activeExpedition.isSpyMission ? 'text-sky-400' : 'text-amber-400'}`} style={{ animationDuration: '6s' }} />
              <div>
                <span className={`font-semibold ${activeExpedition.isSpyMission ? 'text-sky-300' : 'text-amber-300'}`}>
                    {activeExpedition.isSpyMission ? 'Agente infiltrándose en' : 'Expedición en marcha hacia'} {activeExpedition.cellId}
                </span>
                <span className="text-[#a89b88] ml-2">
                  ⏳ Restante: {formatRemainingSeconds(activeExpedition.completesAt)} ({activeExpedition.progressPercent} %)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {now >= activeExpedition.completesAt && (
                <button
                  type="button"
                  className="px-2.5 py-1 text-xs bg-emerald-800 hover:bg-emerald-700 text-white rounded font-medium cursor-pointer"
                  onClick={handleResolveCompleted}
                  disabled={action.busy !== null}
                >
                  Consolidar hallazgo
                </button>
              )}
              {isOwner && now < activeExpedition.completesAt && !activeExpedition.isSpyMission && (
                <button
                  type="button"
                  className="px-2.5 py-1 text-xs bg-[#331c17] hover:bg-[#4a241e] text-red-300 border border-red-900/40 rounded cursor-pointer"
                  onClick={() => handleCancelExploration(activeExpedition.expeditionId)}
                  disabled={action.busy !== null}
                >
                  Cancelar (recupera 50 %)
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div 
            className="lg:col-span-2 bg-[#0a0806] border border-[#2b2419] rounded-lg p-2 overflow-hidden flex items-center justify-center relative cursor-grab active:cursor-grabbing select-none h-[500px] touch-none"
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              dragRef.current.isDragging = true;
              dragRef.current.startX = e.clientX;
              dragRef.current.startY = e.clientY;
              dragRef.current.hasMoved = false;
            }}
            onMouseMove={(e) => {
              if (e.buttons !== 1 || !dragRef.current.isDragging) {
                dragRef.current.isDragging = false;
                return;
              }
              const dx = e.clientX - dragRef.current.startX;
              const dy = e.clientY - dragRef.current.startY;
              if (Math.hypot(dx, dy) > 8) {
                dragRef.current.hasMoved = true;
              }
              if (dragRef.current.hasMoved) {
                dragRef.current.startX = e.clientX;
                dragRef.current.startY = e.clientY;
                setMapPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
              }
            }}
            onMouseUp={() => {
              dragRef.current.isDragging = false;
              setTimeout(() => {
                dragRef.current.hasMoved = false;
              }, 120);
            }}
            onMouseLeave={() => {
              dragRef.current.isDragging = false;
              dragRef.current.hasMoved = false;
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
                dragRef.current.initialZoom = mapZoom;
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
                  setMapZoom(Math.max(0.2, Math.min(6.0, dragRef.current.initialZoom * scale)));
                }
              } else if (e.touches.length === 1 && dragRef.current.touchMode === 'pan') {
                const dx = e.touches[0].clientX - dragRef.current.startX;
                const dy = e.touches[0].clientY - dragRef.current.startY;
                if (Math.hypot(dx, dy) > 8) {
                  dragRef.current.hasMoved = true;
                }
                if (dragRef.current.hasMoved) {
                  if (e.cancelable) e.preventDefault();
                  dragRef.current.startX = e.touches[0].clientX;
                  dragRef.current.startY = e.touches[0].clientY;
                  setMapPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
                }
              }
            }}
            onTouchEnd={(e) => {
              if (e.touches.length === 0) {
                dragRef.current.isDragging = false;
                dragRef.current.touchMode = null;
                setTimeout(() => {
                  dragRef.current.hasMoved = false;
                }, 120);
              } else if (e.touches.length === 1) {
                dragRef.current.touchMode = 'pan';
                dragRef.current.startX = e.touches[0].clientX;
                dragRef.current.startY = e.touches[0].clientY;
                dragRef.current.hasMoved = true;
              }
            }}
            onWheel={(e) => {
              e.preventDefault();
              const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
              setMapZoom((prev) => Math.max(0.2, Math.min(6.0, prev * zoomFactor)));
            }}
          >
            {/* Controles flotantes de Zoom y Reset */}
            <div className="absolute top-3 right-3 z-10 flex flex-col gap-1 bg-[#18140f]/90 border border-[#2b2419] p-1 rounded shadow-lg">
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center bg-[#241c14] hover:bg-[#33281d] text-[#e6ded0] rounded text-sm font-bold cursor-pointer transition"
                onClick={() => setMapZoom((prev) => Math.min(6.0, prev * 1.25))}
                title="Acercar (Zoom +)"
              >
                +
              </button>
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center bg-[#241c14] hover:bg-[#33281d] text-[#e6ded0] rounded text-sm font-bold cursor-pointer transition"
                onClick={() => setMapZoom((prev) => Math.max(0.2, prev * 0.8))}
                title="Alejar (Zoom -)"
              >
                -
              </button>
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center bg-[#241c14] hover:bg-[#33281d] text-[#8e816d] hover:text-[#e6ded0] rounded text-[10px] cursor-pointer transition"
                onClick={() => { setMapZoom(1); setMapPan({ x: 0, y: 0 }); }}
                title="Restablecer vista"
              >
                ⌂
              </button>
            </div>

            <svg viewBox={viewBox} className="w-full h-full select-none" role="img" aria-label="Mapa hexagonal de La Conquista">
              <g transform={`translate(${mapPan.x}, ${mapPan.y}) scale(${mapZoom})`} style={{ transformOrigin: 'center center' }}>
                {renderedHexes}
              </g>
            </svg>
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
                          {/* Resumen numérico de espías del reino */}
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
                                <span className="font-semibold text-sky-200">
                                  Composición de espías:
                                </span>
                                <span className="text-[10px] text-sky-400 font-mono">
                                  Disp: {armyState!.spies!.active}
                                </span>
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
                        <span>Restante: {formatRemainingSeconds(selectedCell.expedition.completesAt)}</span>
                      </div>
                      {isOwner && !selectedCell.expedition.isSpyMission && (
                        <button
                          type="button"
                          className="w-full py-1 text-[10px] bg-[#331c17] hover:bg-[#4a241e] text-red-300 rounded border border-red-900/40 cursor-pointer"
                          disabled={action.busy !== null}
                          onClick={() => handleCancelExploration(selectedCell.expedition!.expeditionId)}
                        >
                          Cancelar expedición (recuperar 50 % costes)
                        </button>
                      )}
                    </div>
                  )}

                  {(selectedCell.state === 'explored' || selectedCell.state === 'owned') && (
                    <div className="space-y-1.5 bg-[#14100c] p-2.5 rounded border border-[#2b2419]">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-3.5 h-3.5 rounded border border-[#1b160f]" style={{ backgroundColor: TERRAIN_COLORS[selectedCell.terrain] ?? '#555' }} />
                        <span className="font-semibold text-[#e6ded0] text-xs">{effectiveWorld.terrains[selectedCell.terrain]?.label ?? selectedCell.terrain}</span>
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

                      {/* Rendimiento comarcal y modificadores de terreno */}
                      {effectiveWorld.terrains[selectedCell.terrain] && (
                        <div className="text-[10px] text-[#a89b88] bg-[#0c0a08] p-1.5 rounded">
                          <span className="block text-[#c7beac] font-medium mb-0.5">Rendimiento comarcal:</span>
                          {Object.entries(effectiveWorld.terrains[selectedCell.terrain].production).map(([job, bonus]) => (
                            <span key={job} className="mr-2">+{Math.round(bonus * 100)} % {JOB_LABELS[job] ?? job}</span>
                          ))}
                          {effectiveWorld.terrains[selectedCell.terrain].defense > 0 && (
                            <span className="mr-2">+{Math.round(effectiveWorld.terrains[selectedCell.terrain].defense * 100)} % defensa</span>
                          )}
                          {effectiveWorld.terrains[selectedCell.terrain].marchMultiplier !== 1.0 && (
                            <span className="mr-2 text-amber-300">
                              ×{effectiveWorld.terrains[selectedCell.terrain].marchMultiplier.toFixed(2)} marcha ({effectiveWorld.terrains[selectedCell.terrain].marchMultiplier > 1 ? `+${Math.round((effectiveWorld.terrains[selectedCell.terrain].marchMultiplier - 1) * 100)} % tiempo y fatiga` : ''})
                            </span>
                          )}
                        </div>
                      )}

                      {/* Reclamación de territorio libre o conquista */}
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
                            <button type="button" className={`${primaryButton} w-full`} disabled={action.busy !== null || (armyState?.summary?.totalActive ?? 0) === 0} onClick={() => { setTargetCellId(selectedCell.cellId); setShowTroopSelector(true); }}>
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
                          <button type="button" className="w-full bg-red-900/60 hover:bg-red-800 text-red-100 py-1.5 rounded text-xs border border-red-800/40 transition disabled:opacity-50" disabled={action.busy !== null || (armyState?.summary?.totalActive ?? 0) === 0} onClick={() => { setTargetCellId(selectedCell.cellId); setShowTroopSelector(true); }}>
                            Lanzar ataque militar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {showTroopSelector && targetCellId && (
                    <TroopSelector availableUnits={armyState?.units ?? []} onConfirm={(comp) => handleStartMarch(targetCellId, comp)} onCancel={() => setShowTroopSelector(false)} />
                  )}
                </div>
              ) : (
                <p className="text-[#8e816d] italic">Selecciona un hexágono en el mapa para examinar su cartografía o enviar exploradores.</p>
              )}
            </div>

            {/* Leyenda y clave de símbolos */}
            <div className={`${cardClass} space-y-1`}>
              <span className="font-semibold text-[#e6ded0] text-xs block">Leyenda cartográfica</span>
              <div className="grid grid-cols-2 gap-1.5 pt-1 text-[10px]">
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
              <p className="text-[#8e816d] text-[10px] pt-1">
                Iconos: ♜ Castillo capital · ⚑ Provincia · 🧭 Expedición en camino · 🔭 Celda fronteriza.
              </p>
            </div>

            {/* Descubrimientos recientes */}
            {mine?.recentDiscoveries && mine.recentDiscoveries.length > 0 && (
              <div className={`${cardClass} space-y-1.5`}>
                <span className="font-semibold text-[#e6ded0] text-xs flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Descubrimientos de exploración
                </span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {mine.recentDiscoveries.slice(-5).reverse().map((disc, idx) => {
                    const dateFormatted = disc.discoveredAt
                      ? new Date(disc.discoveredAt).toLocaleDateString('es-ES', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })
                      : null;
                    return (
                      <div key={idx} className="bg-[#120f0c] p-2 rounded border border-[#221c15] text-[10px] text-[#c7beac] space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-amber-300 font-semibold">[{disc.cellId}]</span>
                          {dateFormatted && (
                            <span className="text-[9px] text-[#8e816d] font-mono">{dateFormatted}</span>
                          )}
                        </div>
                        <p className="text-[#a89b88]">{disc.note}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Lista de provincias propias */}
            <div className={`${cardClass} space-y-1`}>
              <span className="font-semibold text-[#e6ded0] text-xs flex items-center gap-1.5">
                <Flag className="w-3.5 h-3.5 text-[#d4af37]" /> Provincias de la corona
              </span>
              {mine?.territories.length ? (
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {mine.territories.map((t) => (
                    <div key={t.cellId} className="flex justify-between items-center text-[#c7beac] bg-[#120f0c] p-1.5 rounded border border-[#221c15]">
                      <span>{t.cellId} · {effectiveWorld.terrains[t.terrain]?.label ?? t.terrain}</span>
                      <span className="text-[10px] text-amber-400 font-medium">{t.isHome ? '👑 Capital' : 'Provincia'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[#8e816d]">Sin territorios registrados.</p>
              )}
            </div>

            {!isOwner && <p className="text-[#8e816d] italic">{readOnlyNote}</p>}
          </div>
        </div>
        <StatusMessages error={action.error} message={action.message} />
      </PanelSection>
    </div>
  );
}
