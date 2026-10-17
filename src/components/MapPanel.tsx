import React, { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { Map as MapIcon, Flag } from 'lucide-react';
import { JOB_LABELS, PanelSection, StatusMessages, cardClass, primaryButton, readOnlyNote, useActionState } from './shared';

const getWorldMapQuery = makeFunctionReference<"query">("territories:getWorldMap");
const getKingdomTerritoriesQuery = makeFunctionReference<"query">("territories:getKingdomTerritories");
const claimFreeTerritoryMutation = makeFunctionReference<"mutation">("territories:claimFreeTerritory");
const ensureMyHomeTerritoryMutation = makeFunctionReference<"mutation">("territories:ensureMyHomeTerritory");

interface WorldMap {
  radius: number;
  generated: boolean;
  terrains: Record<string, { label: string; production: Record<string, number>; defense: number; commerce: number; marchMultiplier: number }>;
  cells: Array<{ cellId: string; q: number; r: number; terrain: string; ownerKingdomId: string | null; ownerName: string | null; isHome: boolean }>;
}

interface KingdomTerritories {
  homeTerritoryId: string | null;
  pendingClaims: number;
  territories: Array<{ cellId: string; q: number; r: number; terrain: string; isHome: boolean }>;
}

const TERRAIN_COLORS: Record<string, string> = {
  llanura: '#8a9a3a',
  bosque: '#2f6b3a',
  colina: '#9c7b4a',
  montana: '#6e6a66',
  rio: '#2f6f9a',
  costa: '#3f8fb5',
};

const HEX_SIZE = 14;
const SQRT3 = Math.sqrt(3);

function hexCenter(q: number, r: number): { x: number; y: number } {
  // Orientación "pointy": x = tamaño × √3 × (q + r/2), y = tamaño × 3/2 × r
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

export function MapPanel(props: { kingdomId: string; isOwner: boolean; homeTerritoryId: string | null }) {
  const { kingdomId, isOwner } = props;
  const world = useQuery(getWorldMapQuery) as WorldMap | undefined;
  const mine = useQuery(getKingdomTerritoriesQuery, { kingdomId }) as KingdomTerritories | undefined;
  const claim = useMutation(claimFreeTerritoryMutation);
  const ensureHome = useMutation(ensureMyHomeTerritoryMutation);
  const action = useActionState();
  const [selected, setSelected] = useState<string | null>(null);

  const ownedIds = useMemo(() => new Set((mine?.territories ?? []).map((t) => t.cellId)), [mine]);
  const ownedCoords = mine?.territories ?? [];

  const viewBox = useMemo(() => {
    if (!world) return '0 0 100 100';
    const extent = HEX_SIZE * SQRT3 * (world.radius + 1.5);
    const vertical = HEX_SIZE * 1.5 * (world.radius + 1.5);
    return `${-extent} ${-vertical} ${extent * 2} ${vertical * 2}`;
  }, [world]);

  if (!world) {
    return <p className="text-xs text-[#8e816d] italic p-4">Cartografiando el mundo…</p>;
  }

  const selectedCell = world.cells.find((c) => c.cellId === selected) ?? null;
  const selectedDistance = selectedCell && ownedCoords.length
    ? Math.min(...ownedCoords.map((t) => hexDistance(t, selectedCell)))
    : null;
  const canClaimSelected = Boolean(
    isOwner && selectedCell && !selectedCell.ownerKingdomId && (mine?.pendingClaims ?? 0) > 0 && selectedDistance !== null && selectedDistance <= 2
  );

  const handleClaim = () => {
    if (!selectedCell) return;
    action.run('claim', async () => {
      const result = await claim({ kingdomId, cellId: selectedCell.cellId });
      setSelected(null);
      return `Territorio ${result.cellId} (${world.terrains[result.terrain]?.label ?? result.terrain}) incorporado al reino; reclamaciones restantes: ${result.remainingClaims}.`;
    });
  };

  const handleEnsureHome = () =>
    action.run('home', async () => {
      const result = await ensureHome({ kingdomId });
      return result.success ? `Territorio principal asignado en ${result.homeTerritoryId}.` : 'No quedan celdas libres para asignar.';
    });

  return (
    <div className="space-y-6">
      <PanelSection
        icon={<MapIcon className="w-4 h-4 text-[#d4af37]" />}
        title="Mapa del mundo"
        aside={<span>{world.cells.length} territorios · {ownedIds.size} propios · {mine?.pendingClaims ?? 0} reclamación(es) disponible(s)</span>}
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-[#0f0d0a] border border-[#2b2419] rounded-lg p-2 overflow-hidden">
            <svg viewBox={viewBox} className="w-full h-auto max-h-[70vh]" role="img" aria-label="Mapa hexagonal del mundo">
              {world.cells.map((cell) => {
                const { x, y } = hexCenter(cell.q, cell.r);
                const owned = ownedIds.has(cell.cellId);
                const isSelected = selected === cell.cellId;
                const claimable = Boolean(isOwner && !cell.ownerKingdomId && (mine?.pendingClaims ?? 0) > 0 && ownedCoords.length && Math.min(...ownedCoords.map((t) => hexDistance(t, cell))) <= 2);
                return (
                  <g key={cell.cellId} onClick={() => setSelected(cell.cellId)} className="cursor-pointer">
                    <polygon
                      points={hexPoints(x, y)}
                      fill={TERRAIN_COLORS[cell.terrain] ?? '#555'}
                      fillOpacity={cell.ownerKingdomId && !owned ? 0.55 : 0.9}
                      stroke={isSelected ? '#ffffff' : owned ? '#d4af37' : cell.ownerKingdomId ? '#c05050' : claimable ? '#7dd3fc' : '#1b160f'}
                      strokeWidth={isSelected ? 2.5 : owned || cell.ownerKingdomId || claimable ? 1.8 : 0.6}
                    >
                      <title>
                        {`${cell.cellId} · ${world.terrains[cell.terrain]?.label ?? cell.terrain}${cell.ownerName ? ` · ${cell.ownerName}${cell.isHome ? ' (capital)' : ''}` : ' · libre'}`}
                      </title>
                    </polygon>
                    {cell.isHome && (
                      <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fill={owned ? '#d4af37' : '#f0e8d4'} pointerEvents="none">♜</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="space-y-3 text-[11px]">
            <div className={`${cardClass} space-y-1`}>
              <span className="font-semibold text-[#e6ded0] text-xs block">Celda seleccionada</span>
              {selectedCell ? (
                <>
                  <p className="text-[#c7beac]">{selectedCell.cellId} · {world.terrains[selectedCell.terrain]?.label ?? selectedCell.terrain}</p>
                  <p className="text-[#c7beac]">
                    {selectedCell.ownerName ? `Propietario: ${selectedCell.ownerName}${selectedCell.isHome ? ' (territorio principal)' : ''}` : 'Territorio libre (P49)'}
                  </p>
                  {selectedDistance !== null && <p className="text-[#8e816d]">Distancia al territorio propio más cercano: {selectedDistance} hexágono(s)</p>}
                  {isOwner && !selectedCell.ownerKingdomId && (
                    <button type="button" className={primaryButton} disabled={!canClaimSelected || action.busy !== null} onClick={handleClaim}>
                      {action.busy === 'claim' ? 'Reclamando…' : (mine?.pendingClaims ?? 0) === 0 ? 'Sin reclamaciones (requiere victoria aplastante)' : canClaimSelected ? 'Reclamar territorio' : 'Demasiado lejos (máximo 2)'}
                    </button>
                  )}
                </>
              ) : (
                <p className="text-[#8e816d]">Toca o pulsa un hexágono para ver sus datos.</p>
              )}
            </div>
            <div className={`${cardClass} space-y-1`}>
              <span className="font-semibold text-[#e6ded0] text-xs block">Leyenda de terrenos (D-24)</span>
              {Object.entries(world.terrains).map(([id, terrain]) => {
                const bonuses = Object.entries(terrain.production).map(([job, bonus]) => `${JOB_LABELS[job] ?? job} +${Math.round(bonus * 100)} %`);
                if (terrain.defense) bonuses.push(`defensa +${Math.round(terrain.defense * 100)} %`);
                if (terrain.commerce) bonuses.push(`comercio +${Math.round(terrain.commerce * 100)} % (con puerto)`);
                return (
                  <p key={id} className="flex items-center gap-2 text-[#c7beac]">
                    <span className="inline-block w-3 h-3 rounded-sm border border-[#1b160f]" style={{ backgroundColor: TERRAIN_COLORS[id] ?? '#555' }} />
                    <span>{terrain.label}: {bonuses.length ? bonuses.join(', ') : 'sin modificadores'}</span>
                  </p>
                );
              })}
              <p className="text-[#8e816d] pt-1">Borde dorado: territorio propio · borde rojo: otro reino · borde azul: reclamable · ♜ territorio principal.</p>
            </div>
            <div className={`${cardClass} space-y-1`}>
              <span className="font-semibold text-[#e6ded0] text-xs flex items-center gap-1.5"><Flag className="w-3.5 h-3.5 text-[#d4af37]" /> Territorios del reino</span>
              {mine?.territories.length ? mine.territories.map((t) => (
                <p key={t.cellId} className="text-[#c7beac]">{t.cellId} · {world.terrains[t.terrain]?.label ?? t.terrain}{t.isHome ? ' · principal' : ''}</p>
              )) : <p className="text-[#8e816d]">Sin territorios registrados.</p>}
            </div>
            {!isOwner && <p className="text-[#8e816d] italic">{readOnlyNote}</p>}
          </div>
        </div>
        <StatusMessages error={action.error} message={action.message} />
      </PanelSection>
    </div>
  );
}
