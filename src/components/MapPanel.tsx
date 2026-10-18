import React, { useMemo, useState, useEffect } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { Map as MapIcon, Flag, Compass, Clock, ShieldAlert, Sparkles, CheckCircle2 } from 'lucide-react';
import { JOB_LABELS, PanelSection, StatusMessages, cardClass, primaryButton, readOnlyNote, useActionState } from './shared';

const getWorldMapQuery = makeFunctionReference<"query">("territories:getWorldMap");
const getKingdomTerritoriesQuery = makeFunctionReference<"query">("territories:getKingdomTerritories");
const claimFreeTerritoryMutation = makeFunctionReference<"mutation">("territories:claimFreeTerritory");
const ensureMyHomeTerritoryMutation = makeFunctionReference<"mutation">("territories:ensureMyHomeTerritory");
const startExplorationMutation = makeFunctionReference<"mutation">("territories:startExploration");
const cancelExplorationMutation = makeFunctionReference<"mutation">("territories:cancelExploration");
const resolveCompletedExplorationsMutation = makeFunctionReference<"mutation">("territories:resolveCompletedExplorations");

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
  explorationPlan: { distance: number; durationSeconds: number; costs: { gold: number; food: number } } | null;
  expedition: {
    expeditionId: string;
    progressPercent: number;
    completesAt: number;
    durationMs: number;
    distance: number;
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
  const ensureHome = useMutation(ensureMyHomeTerritoryMutation);
  const startExploration = useMutation(startExplorationMutation);
  const cancelExploration = useMutation(cancelExplorationMutation);
  const resolveExplorations = useMutation(resolveCompletedExplorationsMutation);
  const action = useActionState();
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Ticker de 1s para actualizar las barras de tiempo de marcha
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const ownedIds = useMemo(() => new Set((mine?.territories ?? []).map((t) => t.cellId)), [mine]);
  const ownedCoords = mine?.territories ?? [];

  const viewBox = useMemo(() => {
    if (!world) return '0 0 100 100';
    const extent = HEX_SIZE * SQRT3 * (world.radius + 1.5);
    const vertical = HEX_SIZE * 1.5 * (world.radius + 1.5);
    return `${-extent} ${-vertical} ${extent * 2} ${vertical * 2}`;
  }, [world]);

  if (!world) {
    return <p className="text-xs text-[#8e816d] italic p-4">Cartografiando el mundo y la niebla de guerra…</p>;
  }

  const selectedCell = world.cells.find((c) => c.cellId === selected) ?? null;
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
    if (!selectedCell) return;
    action.run('claim', async () => {
      const result = await claim({ kingdomId, cellId: selectedCell.cellId });
      setSelected(null);
      return `Territorio ${result.cellId} (${world.terrains[result.terrain]?.label ?? result.terrain}) anexionado a la corona; reclamaciones restantes: ${result.remainingClaims}.`;
    });
  };

  const handleStartExploration = () => {
    if (!selectedCell) return;
    action.run('explore', async () => {
      const result = await startExploration({ kingdomId, cellId: selectedCell.cellId });
      return `Expedición enviada a ${result.cellId}. Llegada estimada en ${Math.round(result.durationSeconds / 60)} min. Coste: ${result.costs.gold} oro y ${result.costs.food} alimentos.`;
    });
  };

  const handleCancelExploration = (expeditionId: string) => {
    action.run('cancel-explore', async () => {
      const result = await cancelExploration({ kingdomId, expeditionId: expeditionId as any });
      return result.message;
    });
  };

  const handleResolveCompleted = () => {
    action.run('resolve-explore', async () => {
      const result = await resolveExplorations({ kingdomId });
      return result.count > 0
        ? `Se completaron ${result.count} expedición(es) de exploración con éxito.`
        : 'No hay expediciones pendientes de consolidar.';
    });
  };

  const handleEnsureHome = () =>
    action.run('home', async () => {
      const result = await ensureHome({ kingdomId });
      return result.success ? `Territorio principal asignado en ${result.homeTerritoryId}.` : 'No quedan celdas libres para asignar.';
    });

  const activeExpedition = world.activeExpeditions[0];

  return (
    <div className="space-y-6">
      <PanelSection
        icon={<MapIcon className="w-4 h-4 text-[#d4af37]" />}
        title="Mapa del mundo y exploración"
        aside={
          <span className="flex items-center gap-3">
            <span>Explorado: {world.exploredCount}/{world.totalCells} ({Math.round((world.exploredCount / world.totalCells) * 100)} %)</span>
            <span>·</span>
            <span className="text-[#d4af37]">{mine?.pendingClaims ?? 0} reclamación(es) (P49)</span>
          </span>
        }
      >
        {!world.generated && (
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
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-[#1a150e] border border-amber-800/60 p-3 rounded-lg">
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-amber-400 animate-spin" style={{ animationDuration: '6s' }} />
              <div>
                <span className="font-semibold text-amber-300">Expedición en marcha hacia {activeExpedition.cellId}</span>
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
              {isOwner && now < activeExpedition.completesAt && (
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
          {/* Mapa hexagonal SVG */}
          <div className="lg:col-span-2 bg-[#0a0806] border border-[#2b2419] rounded-lg p-2 overflow-hidden flex items-center justify-center">
            <svg viewBox={viewBox} className="w-full h-auto max-h-[72vh] select-none" role="img" aria-label="Mapa hexagonal de La Conquista">
              {world.cells.map((cell) => {
                const { x, y } = hexCenter(cell.q, cell.r);
                const isSelected = selected === cell.cellId;
                const isOwned = cell.state === 'owned';
                const isFog = cell.state === 'fog';
                const isExploring = cell.state === 'exploring';
                const isExplored = cell.state === 'explored';

                // Colores de borde y relleno
                let fill = isFog ? '#120f0c' : isExploring ? '#261e12' : (TERRAIN_COLORS[cell.terrain] ?? '#555');
                let fillOpacity = isFog ? 0.95 : isExploring ? 0.85 : isOwned ? 0.95 : cell.ownerKingdomId ? 0.6 : 0.85;

                let stroke = '#1b160f';
                let strokeWidth = 0.6;
                let strokeDasharray: string | undefined = undefined;

                if (isSelected) {
                  stroke = '#ffffff';
                  strokeWidth = 2.5;
                } else if (isOwned) {
                  stroke = '#d4af37'; // Borde dorado capital/posesión
                  strokeWidth = 1.8;
                } else if (isExploring) {
                  stroke = '#f59e0b';
                  strokeWidth = 2;
                  strokeDasharray = '3,2';
                } else if (cell.canExplore) {
                  stroke = '#0284c7'; // Celda explorable en frontera
                  strokeWidth = 1.4;
                } else if (isExplored && !cell.ownerKingdomId && (mine?.pendingClaims ?? 0) > 0 && selectedDistance !== null && selectedDistance <= 2) {
                  stroke = '#7dd3fc'; // Reclamable
                  strokeWidth = 1.6;
                } else if (cell.ownerKingdomId) {
                  stroke = '#c05050'; // Otro reino
                  strokeWidth = 1.4;
                }

                return (
                  <g key={cell.cellId} onClick={() => setSelected(cell.cellId)} className="cursor-pointer transition-opacity">
                    <polygon
                      points={hexPoints(x, y)}
                      fill={fill}
                      fillOpacity={fillOpacity}
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                      strokeDasharray={strokeDasharray}
                    >
                      <title>
                        {isFog
                          ? `${cell.cellId} · Niebla de guerra${cell.canExplore ? ' (Explorable)' : ''}`
                          : isExploring
                          ? `${cell.cellId} · Expedición en marcha`
                          : `${cell.cellId} · ${world.terrains[cell.terrain]?.label ?? cell.terrain}${cell.ownerName ? ` · ${cell.ownerName}${cell.isHome ? ' (capital)' : ''}` : ' · libre (P49)'}`}
                      </title>
                    </polygon>

                    {/* Iconos centrales */}
                    {isOwned && cell.isHome && (
                      <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fill="#d4af37" pointerEvents="none">♜</text>
                    )}
                    {isOwned && !cell.isHome && (
                      <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fill="#f0e8d4" pointerEvents="none">⚑</text>
                    )}
                    {isExploring && (
                      <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fill="#f59e0b" pointerEvents="none">🧭</text>
                    )}
                    {isFog && cell.canExplore && (
                      <text x={x} y={y + 3.5} textAnchor="middle" fontSize={9} fill="#38bdf8" pointerEvents="none">🔭</text>
                    )}
                    {isFog && !cell.canExplore && (
                      <text x={x} y={y + 3} textAnchor="middle" fontSize={8} fill="#2c241b" pointerEvents="none">·</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Barra lateral de datos y acciones */}
          <div className="space-y-3 text-[11px]">
            <div className={`${cardClass} space-y-2`}>
              <span className="font-semibold text-[#e6ded0] text-xs flex items-center justify-between">
                <span>Información del territorio</span>
                {selectedCell && (
                  <span className="text-[10px] text-[#8e816d] font-mono">[{selectedCell.cellId}]</span>
                )}
              </span>

              {selectedCell ? (
                <div className="space-y-2">
                  {/* Estado en Niebla de Guerra */}
                  {selectedCell.state === 'fog' && (
                    <div className="space-y-2 bg-[#14100c] p-2.5 rounded border border-[#2b2419]">
                      <div className="flex items-center gap-1.5 text-sky-400 font-medium">
                        <Compass className="w-3.5 h-3.5" />
                        <span>Niebla de guerra (Tierra incógnita)</span>
                      </div>
                      <p className="text-[#a89b88]">
                        Este territorio no ha sido cartografiado. Sus recursos, terreno y gobernantes permanecen ocultos a tus consejeros.
                      </p>

                      {selectedCell.canExplore ? (
                        <div className="pt-2 border-t border-[#261f14] space-y-2">
                          <p className="text-emerald-400 font-medium flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Celda limítrofe lista para exploración
                          </p>
                          <div className="grid grid-cols-2 gap-1 text-[10px] text-[#c7beac]">
                            <div>🪙 Coste oro: 30</div>
                            <div>🌾 Coste raciones: 40</div>
                            <div>👤 Explorador: 1 libre</div>
                            <div>⏳ Duración: {selectedCell.explorationPlan ? `${Math.round(selectedCell.explorationPlan.durationSeconds / 60)} min` : '30 min'}</div>
                          </div>
                          {isOwner && (
                            <button
                              type="button"
                              className={`${primaryButton} w-full mt-1 flex items-center justify-center gap-1.5`}
                              disabled={action.busy !== null || (world.activeExpeditions.length >= 1)}
                              onClick={handleStartExploration}
                            >
                              <Compass className="w-3.5 h-3.5" />
                              {action.busy === 'explore'
                                ? 'Enviando partida…'
                                : world.activeExpeditions.length >= 1
                                ? 'Expedición en curso (límite 1)'
                                : 'Enviar expedición de exploración (P22)'}
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="text-[#8e816d] italic pt-1 border-t border-[#261f14]">
                          Para explorar esta celda debes alcanzar primero una celda adyacente a tus fronteras cartografiadas.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Estado en Marcha de Exploración */}
                  {selectedCell.state === 'exploring' && selectedCell.expedition && (
                    <div className="space-y-2 bg-[#1c160e] p-2.5 rounded border border-amber-800/60">
                      <div className="flex items-center gap-1.5 text-amber-300 font-medium">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Expedición de reconocimiento en camino</span>
                      </div>
                      <div className="w-full bg-[#0e0b08] h-2 rounded overflow-hidden">
                        <div
                          className="bg-amber-500 h-full transition-all duration-500"
                          style={{ width: `${selectedCell.expedition.progressPercent}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-[#c7beac]">
                        <span>Progreso: {selectedCell.expedition.progressPercent} %</span>
                        <span>Restante: {formatRemainingSeconds(selectedCell.expedition.completesAt)}</span>
                      </div>
                      {isOwner && (
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

                  {/* Estado Explorado o Propio */}
                  {(selectedCell.state === 'explored' || selectedCell.state === 'owned') && (
                    <div className="space-y-1.5 bg-[#14100c] p-2.5 rounded border border-[#2b2419]">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-3.5 h-3.5 rounded border border-[#1b160f]"
                          style={{ backgroundColor: TERRAIN_COLORS[selectedCell.terrain] ?? '#555' }}
                        />
                        <span className="font-semibold text-[#e6ded0] text-xs">
                          {world.terrains[selectedCell.terrain]?.label ?? selectedCell.terrain}
                        </span>
                        {selectedCell.state === 'owned' && (
                          <span className="text-amber-400 font-medium text-[10px]">
                            {selectedCell.isHome ? '👑 Capital' : '🏰 Posesión de la corona'}
                          </span>
                        )}
                      </div>

                      <p className="text-[#c7beac]">
                        {selectedCell.ownerName
                          ? `Gobernante: ${selectedCell.ownerName}${selectedCell.isHome ? ' (capital)' : ''}`
                          : 'Territorio libre (P49) · Sin soberano'}
                      </p>

                      {/* Modificadores de terreno */}
                      {world.terrains[selectedCell.terrain] && (
                        <div className="text-[10px] text-[#a89b88] bg-[#0c0a08] p-1.5 rounded">
                          <span className="block text-[#c7beac] font-medium mb-0.5">Rendimiento comarcal (D-24):</span>
                          {Object.entries(world.terrains[selectedCell.terrain].production).map(([job, bonus]) => (
                            <span key={job} className="mr-2">+{Math.round(bonus * 100)} % {JOB_LABELS[job] ?? job}</span>
                          ))}
                          {world.terrains[selectedCell.terrain].defense > 0 && (
                            <span className="mr-2">+{Math.round(world.terrains[selectedCell.terrain].defense * 100)} % defensa</span>
                          )}
                        </div>
                      )}

                      {/* Reclamación de territorio libre */}
                      {isOwner && !selectedCell.ownerKingdomId && (
                        <div className="pt-2 border-t border-[#261f14]">
                          <button
                            type="button"
                            className={`${primaryButton} w-full`}
                            disabled={!canClaimSelected || action.busy !== null}
                            onClick={handleClaim}
                          >
                            {action.busy === 'claim'
                              ? 'Reclamando territorio…'
                              : (mine?.pendingClaims ?? 0) === 0
                              ? 'Sin reclamaciones (requiere victoria aplastante P47)'
                              : canClaimSelected
                              ? 'Reclamar territorio libre (P49)'
                              : 'Demasiado lejos (máximo 2 hexágonos)'}
                          </button>
                        </div>
                      )}
                    </div>
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
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {mine.recentDiscoveries.map((disc, idx) => (
                    <div key={idx} className="bg-[#120f0c] p-1.5 rounded border border-[#221c15] text-[10px] text-[#c7beac]">
                      <span className="font-mono text-amber-300 font-semibold mr-1">[{disc.cellId}]</span>
                      <span>{disc.note}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lista de provincias propias */}
            <div className={`${cardClass} space-y-1`}>
              <span className="font-semibold text-[#e6ded0] text-xs flex items-center gap-1.5">
                <Flag className="w-3.5 h-3.5 text-[#d4af37]" /> Provincias de la corona
              </span>
              {mine?.territories.length ? (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {mine.territories.map((t) => (
                    <div key={t.cellId} className="flex justify-between items-center text-[#c7beac] bg-[#120f0c] p-1.5 rounded border border-[#221c15]">
                      <span>{t.cellId} · {world.terrains[t.terrain]?.label ?? t.terrain}</span>
                      <span className="text-[10px] text-amber-400">{t.isHome ? '👑 Capital' : 'Provincia'}</span>
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
