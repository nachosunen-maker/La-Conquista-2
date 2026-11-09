import React, { useState, useMemo } from 'react';
import { primaryButton, cardClass } from './shared';

export interface TroopSelection {
  unitType: string;
  level: number;
  count: number;
}

const UNIT_LABELS: Record<string, string> = {
  infanteria: 'Infantería',
  arqueria: 'Arquería',
  caballeria: 'Caballería',
  asedio: 'Asedio',
};

interface TargetCellDetails {
  cellId: string;
  terrainLabel?: string;
  distance?: number;
  terrainMultiplier?: number;
  resourceBonusLabel?: string;
  isAttack?: boolean;
}

export function TroopSelector({
  availableUnits,
  targetDetails,
  onConfirm,
  onCancel,
}: {
  availableUnits: any[];
  targetDetails?: TargetCellDetails;
  onConfirm: (selection: TroopSelection[]) => void;
  onCancel: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  const unitsToSelect = useMemo(() => {
    return availableUnits.filter((u) => u.unitType !== 'espia' && u.count > 0);
  }, [availableUnits]);

  const handleCountChange = (id: string, count: number, max: number) => {
    setCounts((prev) => ({ ...prev, [id]: Math.max(0, Math.min(count, max)) }));
  };

  const handleSetMax = (id: string, max: number) => {
    setCounts((prev) => ({ ...prev, [id]: max }));
  };

  const handleSelectAll = () => {
    const next: Record<string, number> = {};
    for (const u of unitsToSelect) {
      const id = `${u.unitType}-${u.level ?? 1}`;
      next[id] = u.count;
    }
    setCounts(next);
  };

  const handleSubmit = () => {
    const selection = unitsToSelect
      .filter((u) => (counts[`${u.unitType}-${u.level ?? 1}`] ?? 0) > 0)
      .map((u) => ({
        unitType: u.unitType,
        level: u.level ?? 1,
        count: counts[`${u.unitType}-${u.level ?? 1}`],
      }));

    if (selection.reduce((sum, s) => sum + s.count, 0) > 0) {
      onConfirm(selection);
    }
  };

  const totalSelected = Object.values(counts).reduce((sum, c) => sum + c, 0);

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className={`${cardClass} w-full max-w-md space-y-4 border border-[#4a3b25] shadow-2xl bg-[#120e0a]`}>
        <div className="flex justify-between items-center border-b border-[#2b2419] pb-2">
          <div>
            <h3 className="font-serif text-[#f5e6c8] font-bold text-sm">
              {targetDetails?.isAttack ? '⚔️ Lanzar ataque militar' : '🏰 Despliegue de Conquista Militar'}
            </h3>
            {targetDetails && (
              <p className="text-[11px] text-amber-400 font-mono">
                Objetivo: {targetDetails.cellId} {targetDetails.terrainLabel ? `· ${targetDetails.terrainLabel}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            className="text-xs text-amber-400 hover:text-amber-300 font-medium cursor-pointer underline"
            onClick={handleSelectAll}
          >
            Seleccionar todo
          </button>
        </div>

        {targetDetails && (
          <div className="bg-[#0b0806] p-2.5 rounded border border-[#261f14] text-[11px] space-y-1">
            {targetDetails.distance !== undefined && (
              <div className="flex justify-between text-[#c7beac]">
                <span>Distancia al objetivo:</span>
                <span className="font-mono text-[#e6ded0]">{targetDetails.distance} hexágono(s)</span>
              </div>
            )}
            {targetDetails.terrainMultiplier !== undefined && targetDetails.terrainMultiplier !== 1.0 && (
              <div className="flex justify-between text-[#c7beac]">
                <span>Multiplicador de terreno:</span>
                <span className="font-mono text-amber-300">×{targetDetails.terrainMultiplier.toFixed(2)}</span>
              </div>
            )}
            {targetDetails.resourceBonusLabel && (
              <div className="flex justify-between text-[#c7beac]">
                <span>Bonificación por conquista:</span>
                <span className="font-mono text-emerald-400 font-semibold">{targetDetails.resourceBonusLabel}</span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
          {unitsToSelect.length === 0 ? (
            <p className="text-xs text-amber-300 italic p-2 bg-amber-950/30 rounded border border-amber-900/40">
              No dispones de tropas militares en la guarnición para marchar. Recluta infantería, arquería o caballería en el Cuartel.
            </p>
          ) : (
            unitsToSelect.map((u) => {
              const id = `${u.unitType}-${u.level ?? 1}`;
              const max = u.count;
              const val = counts[id] ?? 0;
              const label = UNIT_LABELS[u.unitType] ?? u.unitType;

              return (
                <div key={id} className="bg-[#18130e] p-2 rounded border border-[#2b2419] flex items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-[#e6ded0] text-xs block">{label}</span>
                    <span className="text-[10px] text-[#8e816d]">Nivel {u.level ?? 1} · Disp: {max}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="w-7 h-6 bg-[#261e14] hover:bg-[#382b1d] text-[#e6ded0] rounded border border-[#3d301f] text-xs font-bold cursor-pointer disabled:opacity-40"
                      disabled={val <= 0}
                      onClick={() => handleCountChange(id, val - 1, max)}
                    >
                      -
                    </button>

                    <input
                      type="number"
                      min={0}
                      max={max}
                      className="w-14 bg-[#0a0806] text-center font-mono text-[#e6ded0] font-bold border border-[#3b3121] rounded h-6 text-xs"
                      value={val}
                      onChange={(e) => handleCountChange(id, parseInt(e.target.value) || 0, max)}
                    />

                    <button
                      type="button"
                      className="w-7 h-6 bg-[#261e14] hover:bg-[#382b1d] text-[#e6ded0] rounded border border-[#3d301f] text-xs font-bold cursor-pointer disabled:opacity-40"
                      disabled={val >= max}
                      onClick={() => handleCountChange(id, val + 1, max)}
                    >
                      +
                    </button>

                    <button
                      type="button"
                      className="px-1.5 h-6 bg-amber-950/80 hover:bg-amber-900 text-amber-300 rounded border border-amber-800 text-[10px] font-bold cursor-pointer ml-1"
                      onClick={() => handleSetMax(id, max)}
                    >
                      Máx
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="text-xs font-semibold text-amber-300 flex justify-between items-center bg-[#0d0906] p-2 rounded border border-[#261f14]">
          <span>Total de efectivos seleccionados:</span>
          <span className="font-mono text-[#f5e6c8] text-sm">{totalSelected} tropas</span>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            className={`${primaryButton} flex-1 py-2 font-bold text-xs shadow-lg`}
            onClick={handleSubmit}
            disabled={totalSelected === 0}
          >
            {targetDetails?.isAttack ? 'Lanzar Ataque Militar' : 'Confirmar Conquista Militar'}
          </button>
          <button
            type="button"
            className="flex-1 bg-[#1a1510] hover:bg-[#282018] border border-[#3b3121] rounded px-3 py-2 text-xs text-[#e6ded0] cursor-pointer"
            onClick={onCancel}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

