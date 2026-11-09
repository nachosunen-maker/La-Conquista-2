import React, { useState, useMemo } from 'react';
import { primaryButton, cardClass } from './shared';

export interface TroopSelection {
  unitType: string;
  level: number;
  count: number;
}

export function TroopSelector({ 
  availableUnits, 
  onConfirm, 
  onCancel 
}: { 
  availableUnits: any[]; 
  onConfirm: (selection: TroopSelection[]) => void; 
  onCancel: () => void; 
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  const unitsToSelect = useMemo(() => {
    return availableUnits.filter(u => u.unitType !== 'espia' && u.count > 0);
  }, [availableUnits]);

  const handleCountChange = (id: string, count: number, max: number) => {
    setCounts(prev => ({ ...prev, [id]: Math.max(0, Math.min(count, max)) }));
  };

  const handleSubmit = () => {
    const selection = unitsToSelect
      .filter(u => (counts[`${u.unitType}-${u.level ?? 1}`] ?? 0) > 0)
      .map(u => ({
        unitType: u.unitType,
        level: u.level ?? 1,
        count: counts[`${u.unitType}-${u.level ?? 1}`]
      }));
    
    if (selection.reduce((sum, s) => sum + s.count, 0) > 0) {
      onConfirm(selection);
    }
  };

  const totalSelected = Object.values(counts).reduce((sum, c) => sum + c, 0);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className={`${cardClass} w-full max-w-sm space-y-4`}>
        <h3 className="font-serif text-amber-200 font-bold">Seleccionar tropas</h3>
        <div className="space-y-2">
          {unitsToSelect.map(u => {
            const id = `${u.unitType}-${u.level ?? 1}`;
            const max = u.count;
            const val = counts[id] ?? 0;
            return (
              <div key={id} className="flex items-center justify-between text-xs text-[#c7beac]">
                <span>{u.unitType} (Nvl {u.level ?? 1})</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="w-16 bg-[#100e0b] border border-[#3b3121] rounded px-1 py-0.5 text-right"
                    value={val}
                    onChange={(e) => handleCountChange(id, parseInt(e.target.value) || 0, max)}
                  />
                  <span>/ {max}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-xs font-medium text-amber-300">
          Total seleccionado: {totalSelected} tropas
        </div>
        <div className="flex gap-2">
          <button type="button" className={`${primaryButton} flex-1`} onClick={handleSubmit} disabled={totalSelected === 0}>
            Confirmar marcha
          </button>
          <button type="button" className="flex-1 bg-[#1a1510] border border-[#3b3121] rounded px-2 py-1 text-[11px] text-[#e6ded0]" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
