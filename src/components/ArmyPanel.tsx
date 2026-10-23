import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { Swords, Shield, Users, Clock, Activity, Coins, Flag } from 'lucide-react';
import { UNIT_COUNTERS, COMBAT, TACTICAL_FORMATION_COUNTER_BONUS, TACTICAL_FORMATIONS } from '../../convex/balanceConfig';
import {
  PanelSection,
  ProgressRow,
  StatusMessages,
  UNIT_LABELS,
  cardClass,
  formatCosts,
  formatRequirements,
  formatSecondsDuration,
  inputClass,
  primaryButton,
  readOnlyNote,
  selectClass,
  useActionState,
  useServerClock,
} from './shared';

const getArmyStateQuery = makeFunctionReference<"query">("army:getArmyState");
const startTrainingMutation = makeFunctionReference<"mutation">("army:startTraining");
const cancelTrainingMutation = makeFunctionReference<"mutation">("army:cancelTraining");
const setArmyEquipmentMutation = makeFunctionReference<"mutation">("army:setArmyEquipment");
const hireMercenariesMutation = makeFunctionReference<"mutation">("army:hireMercenaries");
const setFormationMutation = makeFunctionReference<"mutation">("army:setFormation");
const setTacticalFormationMutation = makeFunctionReference<"mutation">("army:setTacticalFormation");

interface ArmyState {
  serverTimeMs: number;
  writable: boolean;
  units: Array<{ _id: string; unitType: string; level?: number; count: number; wounded?: number; legacy?: boolean; isMercenary?: boolean; contractEndsAt?: number }>;
  summary: {
    totalActive: number;
    totalWounded: number;
    livingSoldiers: number;
    siegeMachines: number;
    siegeOperators: number;
    byType: Record<string, { active: number; wounded: number }>;
    trainingMultiplier: number;
  };
  availableCivil: number | null;
  trainingQueue: Array<{
    _id: string;
    unitType?: string;
    count?: number;
    level?: number;
    startedAt?: number;
    durationMs?: number;
    populationReserved?: number;
    costs?: Record<string, number>;
    progressPercent: number | null;
    completesAt: number | null;
  }>;
  queueSlots: number;
  queueSlotsFree: number;
  militaryLevels: Array<{ level: number; name: string; multiplier: number; requirements: Record<string, number>; available: boolean }>;
  unitCatalog: Array<{
    unitType: string;
    label: string;
    costs: Record<string, number>;
    trainingSecondsPerUnit: number;
    populationPerUnit: number;
    isLivingTroop: boolean;
    requirements: Record<string, number>;
    attack: number;
    defense: number;
    speed: number;
    unitCosts: Record<string, number>;
    unitDurationMs: number | null;
    requirementsSatisfied: boolean;
  }>;
  trainingDurationModifier: number;
  formation: Partial<Record<string, number>>;
  mercenaries: {
    active: number;
    contracts: Array<{ count: number; contractEndsAt: number | null; typeId?: string; label?: string }>;
    types: Array<{ id: string; label: string; unitType: string; level: number; goldPerUnit: number; minTavernLevel: number; description: string; available: boolean }>;
    maxActive: number;
    goldPerUnit: number;
    salaryGoldPerDay: number;
    contractDays: number;
    unitType: string;
    level: number;
    tavernLevel: number;
  };
  equipment: {
    weaponTier: string;
    armorTier: string;
    strategy: string;
    fatigue: number;
    availableWeapons: string[];
    availableArmors: string[];
    weaponCatalog: Record<string, { label: string; multiplier: number }>;
    armorCatalog: Record<string, { label: string; multiplier: number }>;
    strategyCatalog: Record<string, { label: string; attack: number; defense: number; beats: string }>;
    tacticalFormation: string;
    tacticalFormationCatalog: Record<string, { label: string; attack: number; defense: number; beats: string | null; description: string }>;
    civilization: string | null;
    civilizationIdentity: { signatureUnit: { unitType: string; name: string; description: string }; uniqueBuilding: { buildingType: string; name: string } } | null;
    civilizationWeakness: string | null;
  };
}

export function ArmyPanel(props: { kingdomId: string; isOwner: boolean; buildingLabels: Record<string, string> }) {
  const { kingdomId, isOwner, buildingLabels } = props;
  const state = useQuery(getArmyStateQuery, { kingdomId }) as ArmyState | undefined;
  const startTraining = useMutation(startTrainingMutation);
  const cancelTraining = useMutation(cancelTrainingMutation);
  const setEquipment = useMutation(setArmyEquipmentMutation);
  const hireMercenaries = useMutation(hireMercenariesMutation);
  const setFormation = useMutation(setFormationMutation);
  const setTacticalFormation = useMutation(setTacticalFormationMutation);
  const serverNow = useServerClock(state?.serverTimeMs);
  const action = useActionState();

  const [unitType, setUnitType] = useState<string>('infanteria');
  const [count, setCount] = useState<number>(10);
  const [level, setLevel] = useState<number>(1);
  const [weaponTier, setWeaponTier] = useState<string | null>(null);
  const [armorTier, setArmorTier] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<string | null>(null);
  const [formationDraft, setFormationDraft] = useState<Record<string, number> | null>(null);
  const [tacticalDraft, setTacticalDraft] = useState<string | null>(null);
  const [mercenaryCount, setMercenaryCount] = useState<number>(10);
  const [mercenaryTypeId, setMercenaryTypeId] = useState<string | null>(null);

  if (!state) {
    return <p className="text-xs text-[#8e816d] italic p-4">Consultando el ejército en el servidor…</p>;
  }

  const writable = isOwner && state.writable;
  const selectedUnit = state.unitCatalog.find((u) => u.unitType === unitType) ?? state.unitCatalog[0];
  const selectedLevel = state.militaryLevels.find((l) => l.level === level);
  const safeCount = Number.isInteger(count) && count > 0 ? count : 0;
  const totalCosts: Record<string, number> = {};
  for (const [resource, value] of Object.entries(selectedUnit?.unitCosts ?? {})) totalCosts[resource] = value * safeCount;
  const batchDurationSeconds = selectedUnit?.unitDurationMs ? (selectedUnit.unitDurationMs * safeCount) / 1000 : null;
  const populationNeeded = (selectedUnit?.populationPerUnit ?? 0) * safeCount;

  const currentWeapon = weaponTier ?? state.equipment?.weaponTier ?? 'espadaHierro';
  const currentArmor = armorTier ?? state.equipment?.armorTier ?? 'cueroReforzado';
  const currentStrategy = strategy ?? state.equipment?.strategy ?? 'defensiva';
  const currentTactical = tacticalDraft ?? state.equipment?.tacticalFormation ?? 'equilibrada';
  const tacticalCatalog = state.equipment?.tacticalFormationCatalog ?? TACTICAL_FORMATIONS;
  const tacticalInfo = tacticalCatalog[currentTactical] ?? TACTICAL_FORMATIONS.equilibrada;
  const tacticalWeakAgainst = Object.entries(tacticalCatalog).find(([, info]) => info.beats === currentTactical)?.[1]?.label ?? null;
  const handleTactical = () =>
    action.run('tactical', async () => {
      const result = await setTacticalFormation({ kingdomId, tacticalFormation: currentTactical });
      setTacticalDraft(null);
      return `Formación ${result.label} guardada: ataque ×${result.attack}, defensa ×${result.defense}.`;
    });
  const equipmentChanged =
    currentWeapon !== state.equipment?.weaponTier || currentArmor !== state.equipment?.armorTier || currentStrategy !== state.equipment?.strategy;

  const handleTrain = () =>
    action.run('train', async () => {
      const result = await startTraining({ kingdomId, unitType, count: safeCount, level });
      return `Lote de ${result.count} ${UNIT_LABELS[result.unitType] ?? result.unitType} (nivel ${result.level}) encolado; termina ${new Date(result.completesAt).toLocaleString('es-ES')}.`;
    });

  const handleCancel = (trainingId: string, label: string) => {
    if (!window.confirm(`¿Cancelar ${label}? Se devuelve el 50 % de los recursos y toda la población reservada.`)) return;
    action.run(`cancel-${trainingId}`, async () => {
      const result = await cancelTraining({ kingdomId, trainingId });
      return `Lote cancelado: ${formatCosts(result.refund)} devueltos y ${result.populationReturned} civiles liberados.`;
    });
  };

  const FORMATION_TYPES = ['infanteria', 'arqueria', 'caballeria', 'asedio'] as const;
  const currentFormation: Record<string, number> = formationDraft ?? Object.fromEntries(
    FORMATION_TYPES.map((type) => [type, Math.round(((state.formation?.[type] ?? 1) as number) * 100)])
  );
  const formationChanged = formationDraft !== null && FORMATION_TYPES.some(
    (type) => Math.round(((state.formation?.[type] ?? 1) as number) * 100) !== currentFormation[type]
  );
  const committed = (type: string) => Math.round((state.summary.byType[type]?.active ?? 0) * (currentFormation[type] ?? 100) / 100);

  const handleFormation = () =>
    action.run('formation', async () => {
      const formation = Object.fromEntries(FORMATION_TYPES.map((type) => [type, (currentFormation[type] ?? 100) / 100]));
      await setFormation({ kingdomId, formation });
      setFormationDraft(null);
      return 'Formación guardada: se aplicará al congelar el próximo combate.';
    });

  const safeMercenaries = Number.isInteger(mercenaryCount) && mercenaryCount > 0 ? mercenaryCount : 0;
  const mercenaryTypes = state.mercenaries.types ?? [];
  const selectedMercenaryType =
    mercenaryTypes.find((type) => type.id === mercenaryTypeId && type.available) ??
    [...mercenaryTypes].reverse().find((type) => type.available) ??
    mercenaryTypes[0];
  const mercenaryCost = safeMercenaries * (selectedMercenaryType?.goldPerUnit ?? state.mercenaries.goldPerUnit);
  const mercenaryRoom = Math.max(0, state.mercenaries.maxActive - state.mercenaries.active);

  const handleHire = () =>
    action.run('hire', async () => {
      const result = await hireMercenaries({ kingdomId, count: safeMercenaries, typeId: selectedMercenaryType?.id });
      return `${result.count} ${result.label ?? 'mercenarios'} contratados por ${result.cost} oro; contrato hasta ${new Date(result.contractEndsAt).toLocaleString('es-ES')} sin salario diario.`;
    });

  const handleEquipment = () =>
    action.run('equipment', async () => {
      await setEquipment({ kingdomId, weaponTier: currentWeapon, armorTier: currentArmor, strategy: currentStrategy });
      setWeaponTier(null);
      setArmorTier(null);
      setStrategy(null);
      return 'Equipamiento y estrategia guardados en el servidor.';
    });

  return (
    <div className="space-y-6">
      <PanelSection
        icon={<Swords className="w-4 h-4 text-rose-400" />}
        title="Fuerzas militares"
        aside={<span>{state.summary.totalActive.toLocaleString('es-ES')} unidades activas · {state.summary.totalWounded.toLocaleString('es-ES')} heridos</span>}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className={cardClass}>
            <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider">Tropa viva</span>
            <span className="text-lg font-bold text-rose-300 font-serif">{state.summary.livingSoldiers.toLocaleString('es-ES')}</span>
            <span className="text-[10px] text-[#695d4c] block">incluye {state.summary.siegeOperators} operadores de asedio</span>
          </div>
          <div className={cardClass}>
            <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider">Máquinas de asedio</span>
            <span className="text-lg font-bold text-purple-300 font-serif">{state.summary.siegeMachines}</span>
            <span className="text-[10px] text-[#695d4c] block">no consumen raciones</span>
          </div>
          <div className={cardClass}>
            <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider">Entrenamiento medio</span>
            <span className="text-lg font-bold text-[#f5efe1] font-serif">×{state.summary.trainingMultiplier.toFixed(2)}</span>
            <span className="text-[10px] text-[#695d4c] block">multiplicador P29</span>
          </div>
          <div className={cardClass}>
            <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider">Fatiga</span>
            <span className="text-lg font-bold text-amber-300 font-serif">{state.equipment.fatigue}%</span>
            <span className="text-[10px] text-[#695d4c] block">se recupera 10/día con ración normal</span>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">Inventario por tipo y nivel</h3>
          {state.units.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {state.units.map((unit) => {
                const levelInfo = state.militaryLevels.find((l) => l.level === (unit.level ?? 1));
                return (
                  <div key={unit._id} className={`${cardClass} flex items-center justify-between text-xs`}>
                    <div>
                      <span className="font-semibold text-[#f0e8d4] block">{UNIT_LABELS[unit.unitType] ?? unit.unitType}{unit.isMercenary ? ' (mercenarios)' : ''}</span>
                      <span className="text-[10px] text-[#786c5a]">
                        Nivel {unit.level ?? 1} · {levelInfo?.name ?? 'Milicia'} (×{levelInfo?.multiplier ?? 1})
                        {unit.legacy ? ' · registro heredado' : ''}
                        {unit.isMercenary ? ` · mercenarios hasta ${unit.contractEndsAt ? new Date(unit.contractEndsAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : 'fin de contrato'}` : ''}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-base font-bold font-serif text-[#f4eedb]">{unit.count}</span>
                      {typeof unit.wounded === 'number' && unit.wounded > 0 && (
                        <span className="text-[10px] text-rose-300 block">{unit.wounded} heridos</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">Sin unidades registradas.</p>
          )}
        </div>
      </PanelSection>

      <PanelSection
        icon={<Users className="w-4 h-4 text-[#d4af37]" />}
        title="Entrenamiento"
        aside={<span>{state.queueSlotsFree}/{state.queueSlots} colas libres · {state.availableCivil ?? 'sin dato'} civiles libres</span>}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">Catálogo de unidades</h3>
            {state.unitCatalog.map((unit) => (
              <div key={unit.unitType} className={`${cardClass} text-[11px] space-y-1`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#f0e8d4]">{unit.label}</span>
                  <span className={unit.requirementsSatisfied ? 'text-emerald-300' : 'text-amber-300'}>
                    {unit.requirementsSatisfied ? 'disponible' : `requiere ${formatRequirements(unit.requirements, buildingLabels)}`}
                  </span>
                </div>
                <p className="text-[#c7beac]">
                  Coste por unidad: {formatCosts(unit.unitCosts)} · duración: {unit.unitDurationMs ? formatSecondsDuration(unit.unitDurationMs / 1000) : 'sin dato'} por unidad
                  {state.trainingDurationModifier !== 1 ? ` (modificador ×${state.trainingDurationModifier.toFixed(2)})` : ''}
                </p>
                <p className="text-[#8e816d]">
                  Población: {unit.populationPerUnit} {unit.isLivingTroop ? 'civil libre por unidad' : 'operadores por pieza'} · ataque {unit.attack} · defensa {unit.defense} · velocidad {unit.speed}
                </p>
              </div>
            ))}
            <div className={`${cardClass} text-[11px] space-y-1`}>
              <span className="font-semibold text-[#f0e8d4] block">Niveles militares (P23, P29)</span>
              {state.militaryLevels.map((l) => (
                <p key={l.level} className={l.available ? 'text-emerald-300' : 'text-[#8e816d]'}>
                  Nivel {l.level} {l.name} ×{l.multiplier} · {formatRequirements(l.requirements, buildingLabels)} {l.available ? '· disponible' : ''}
                </p>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">Nuevo lote</h3>
            {writable ? (
              <form
                className={`${cardClass} space-y-3 text-xs`}
                onSubmit={(e) => {
                  e.preventDefault();
                  handleTrain();
                }}
              >
                <label className="flex items-center justify-between gap-2">
                  <span className="text-[#a0937e]">Unidad</span>
                  <select className={selectClass} value={unitType} onChange={(e) => setUnitType(e.target.value)}>
                    {state.unitCatalog.map((u) => (
                      <option key={u.unitType} value={u.unitType}>{u.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-[#a0937e]">Cantidad</span>
                  <input className={`${inputClass} w-24 text-right`} type="number" min={1} step={1} value={count} onChange={(e) => setCount(Number(e.target.value))} />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-[#a0937e]">Nivel militar</span>
                  <select className={selectClass} value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                    {state.militaryLevels.filter((l) => l.available).map((l) => (
                      <option key={l.level} value={l.level}>Nivel {l.level} · {l.name} (×{l.multiplier})</option>
                    ))}
                  </select>
                </label>
                <div className="rounded border border-[#2b2419] bg-[#100e0b] p-2.5 text-[11px] text-[#c7beac] space-y-1">
                  <p><strong className="text-[#e6ded0]">Qué hace:</strong> entrena {safeCount} {selectedUnit?.label ?? ''} de nivel {level} ({selectedLevel?.name ?? ''}) y los incorpora al ejército al terminar.</p>
                  <p><strong className="text-[#e6ded0]">Cuánto cuesta:</strong> {formatCosts(totalCosts)} y {populationNeeded} habitantes de la reserva civil libre.</p>
                  <p><strong className="text-[#e6ded0]">Cuánto tarda:</strong> {batchDurationSeconds !== null ? formatSecondsDuration(batchDurationSeconds) : 'sin dato'} (lineal por unidad).</p>
                  <p><strong className="text-[#e6ded0]">Resultado:</strong> +{safeCount} unidades activas con eficacia ×{selectedLevel?.multiplier ?? 1}; cancelar devuelve el 50 % de recursos y toda la población.</p>
                </div>
                <button type="submit" className={primaryButton} disabled={action.busy !== null || state.queueSlotsFree === 0 || safeCount === 0}>
                  {action.busy === 'train' ? 'Encolando…' : state.queueSlotsFree === 0 ? 'Sin colas libres' : 'Entrenar'}
                </button>
              </form>
            ) : (
              <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">{readOnlyNote}</p>
            )}

            <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider pt-2">Colas en el servidor</h3>
            {state.trainingQueue.length > 0 ? state.trainingQueue.map((entry) => {
              const label = `${entry.count ?? '?'} ${UNIT_LABELS[entry.unitType ?? ''] ?? entry.unitType ?? 'unidades'} · nivel ${entry.level ?? 1}`;
              return (
                <ProgressRow
                  key={entry._id}
                  title={label}
                  subtitle={`Población reservada: ${entry.populationReserved ?? 0} · coste pagado: ${formatCosts(entry.costs)}`}
                  startedAt={entry.startedAt}
                  durationMs={entry.durationMs}
                  serverTimeMs={serverNow}
                  onCancel={writable ? () => handleCancel(entry._id, label) : undefined}
                  cancelling={action.busy === `cancel-${entry._id}`}
                />
              );
            }) : (
              <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">No hay lotes en entrenamiento.</p>
            )}
          </div>
        </div>
        <StatusMessages error={action.error} message={action.message} />
      </PanelSection>

      <PanelSection
        icon={<Coins className="w-4 h-4 text-[#d4af37]" />}
        title="Mercenarios (P53, Taberna)"
        aside={<span>{state.mercenaries.active}/{state.mercenaries.maxActive} activos · Taberna nivel {state.mercenaries.tavernLevel}</span>}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
          <div className={`${cardClass} space-y-1 text-[11px] text-[#c7beac]`}>
            <p><strong className="text-[#e6ded0]">Qué hace:</strong> contrata tropas a sueldo que se suman al ejército y al censo de inmediato, sin consumir población civil. Cada tipo exige un nivel de Taberna.</p>
            <p><strong className="text-[#e6ded0]">Cuánto cuesta:</strong> el precio del tipo por mercenario, pagado al contratar; sin salario diario.</p>
            <p><strong className="text-[#e6ded0]">Cuánto dura:</strong> contrato de {state.mercenaries.contractDays} días reales; al vencer desaparecen.</p>
            <p><strong className="text-[#e6ded0]">Límite:</strong> {state.mercenaries.maxActive} activos entre todos los tipos con la Taberna actual (50 por nivel). No generan natalidad.</p>
            <div className="pt-1 space-y-0.5">
              {mercenaryTypes.map((type) => (
                <p key={type.id} className={type.available ? 'text-emerald-300' : 'text-[#8e816d]'}>
                  {type.label}: {UNIT_LABELS[type.unitType] ?? type.unitType} nivel {type.level} · {type.goldPerUnit} oro · Taberna {type.minTavernLevel}{type.available ? '' : ' · bloqueado'}
                </p>
              ))}
            </div>
            {state.mercenaries.contracts.length > 0 && (
              <p className="text-[#8e816d]">
                Contratos: {state.mercenaries.contracts.map((c) => `${c.count} ${c.label ?? ''} hasta ${c.contractEndsAt ? new Date(c.contractEndsAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : 'sin fecha'}`).join(' · ')}
              </p>
            )}
          </div>
          {writable ? (
            <form
              className={`${cardClass} space-y-3`}
              onSubmit={(e) => {
                e.preventDefault();
                handleHire();
              }}
            >
              <label className="flex items-center justify-between gap-2">
                <span className="text-[#a0937e]">Tipo</span>
                <select className={selectClass} value={selectedMercenaryType?.id ?? ''} onChange={(e) => setMercenaryTypeId(e.target.value)} disabled={state.mercenaries.tavernLevel < 1}>
                  {mercenaryTypes.map((type) => (
                    <option key={type.id} value={type.id} disabled={!type.available}>
                      {type.label} · {type.goldPerUnit} oro{type.available ? '' : ` (Taberna ${type.minTavernLevel})`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-[#a0937e]">Mercenarios a contratar</span>
                <input className={`${inputClass} w-24 text-right`} type="number" min={1} max={Math.max(1, mercenaryRoom)} step={1} value={mercenaryCount} onChange={(e) => setMercenaryCount(Number(e.target.value))} disabled={state.mercenaries.tavernLevel < 1} />
              </label>
              <div className="rounded border border-[#2b2419] bg-[#100e0b] p-2.5 text-[11px] text-[#c7beac] space-y-1">
                <p><strong className="text-[#e6ded0]">Coste inmediato:</strong> {mercenaryCost.toLocaleString('es-ES')} oro.</p>
                <p><strong className="text-[#e6ded0]">Mantenimiento:</strong> solo alimentos durante {state.mercenaries.contractDays} días; sin salario.</p>
                <p><strong className="text-[#e6ded0]">Resultado:</strong> +{safeMercenaries} {selectedMercenaryType ? `${UNIT_LABELS[selectedMercenaryType.unitType] ?? selectedMercenaryType.unitType} de nivel ${selectedMercenaryType.level} (${selectedMercenaryType.label})` : 'mercenarios'} activos hasta el fin del contrato.</p>
              </div>
              {state.mercenaries.tavernLevel < 1 ? (
                <p className="text-amber-300 text-[11px]">Se necesita una Taberna para contratar mercenarios.</p>
              ) : mercenaryRoom === 0 ? (
                <p className="text-amber-300 text-[11px]">La Taberna no admite más mercenarios activos.</p>
              ) : null}
              <button type="submit" className={primaryButton} disabled={action.busy !== null || state.mercenaries.tavernLevel < 1 || safeMercenaries === 0 || safeMercenaries > mercenaryRoom}>
                {action.busy === 'hire' ? 'Contratando…' : 'Contratar'}
              </button>
            </form>
          ) : (
            <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">{readOnlyNote}</p>
          )}
        </div>
      </PanelSection>

      <PanelSection icon={<Flag className="w-4 h-4 text-sky-300" />} title="Formación de combate (P37)">
        <p className="text-[11px] text-[#c7beac]">
          Elige qué fracción de cada tipo participa en el próximo combate; el resto se queda en el reino y no sufre bajas.
          Matriz de contrapartidas: {Object.entries(UNIT_COUNTERS).map(([type, countered]) => `${UNIT_LABELS[type] ?? type} +${Math.round(COMBAT.FORMATION_COUNTER_BONUS * 100)} % contra ${UNIT_LABELS[countered] ?? countered}`).join(' · ')}.
          La formación se congela 15 minutos antes de cada batalla.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {FORMATION_TYPES.map((type) => (
            <label key={type} className={`${cardClass} space-y-1`}>
              <span className="flex items-center justify-between text-[#a0937e]">
                <span>{UNIT_LABELS[type] ?? type}</span>
                <span className="font-mono text-[#e6ded0]">{currentFormation[type] ?? 100} % · {committed(type)} de {state.summary.byType[type]?.active ?? 0}</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={currentFormation[type] ?? 100}
                disabled={!writable}
                onChange={(e) => setFormationDraft({ ...currentFormation, [type]: Number(e.target.value) })}
                className="w-full accent-[#d4af37]"
              />
            </label>
          ))}
        </div>
        {writable && (
          <button type="button" className={primaryButton} onClick={handleFormation} disabled={!formationChanged || action.busy !== null}>
            {action.busy === 'formation' ? 'Guardando…' : 'Guardar formación'}
          </button>
        )}

        <div className={`${cardClass} space-y-2 text-xs mt-3`}>
          <span className="font-semibold text-[#f0e8d4] block">Formación táctica (decisión 21-10-2026)</span>
          <p className="text-[11px] text-[#c7beac]">
            Cuatro formaciones que se suman a la estrategia y a la matriz entre tipos: cada una vence a otra y pierde contra otra; la equilibrada no tiene ventaja ni debilidad.
          </p>
          <label className="flex items-center justify-between gap-2">
            <span className="text-[#a0937e]">Formación</span>
            <select className={selectClass} value={currentTactical} disabled={!writable} onChange={(e) => setTacticalDraft(e.target.value)}>
              {Object.entries(tacticalCatalog).map(([id, info]) => (
                <option key={id} value={id}>{info.label} (ataque ×{info.attack}, defensa ×{info.defense})</option>
              ))}
            </select>
          </label>
          {tacticalInfo && (
            <div className="rounded border border-[#2b2419] bg-[#100e0b] p-2.5 text-[11px] text-[#c7beac] space-y-1">
              <p><strong className="text-[#e6ded0]">Qué hace:</strong> {tacticalInfo.description}</p>
              <p><strong className="text-[#e6ded0]">Cuánto cuesta:</strong> nada; cambiarla es gratis e inmediato.</p>
              <p><strong className="text-[#e6ded0]">Cuánto dura:</strong> hasta que la cambies; se congela 15 minutos antes de cada batalla.</p>
              <p><strong className="text-[#e6ded0]">Resultado:</strong> ataque ×{tacticalInfo.attack} y defensa ×{tacticalInfo.defense}; fuerte contra {tacticalInfo.beats ? tacticalCatalog[tacticalInfo.beats]?.label : 'ninguna'} (potencia ×{TACTICAL_FORMATION_COUNTER_BONUS}) y débil contra {tacticalWeakAgainst ?? 'ninguna'}.</p>
            </div>
          )}
          {writable && (
            <button type="button" className={primaryButton} onClick={handleTactical} disabled={currentTactical === (state.equipment?.tacticalFormation ?? 'equilibrada') || action.busy !== null}>
              {action.busy === 'tactical' ? 'Guardando…' : 'Guardar formación táctica'}
            </button>
          )}
        </div>
      </PanelSection>

      <PanelSection icon={<Shield className="w-4 h-4 text-emerald-400" />} title="Equipamiento y estrategia (P30, P31, P35)">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <label className={`${cardClass} space-y-1`}>
            <span className="text-[#a0937e] block">Armas</span>
            <select className={`${selectClass} w-full`} value={currentWeapon} disabled={!writable} onChange={(e) => setWeaponTier(e.target.value)}>
              {Object.entries(state.equipment?.weaponCatalog ?? {}).map(([tier, info]) => (
                <option key={tier} value={tier} disabled={!(state.equipment?.availableWeapons ?? []).includes(tier)}>
                  {info.label} (×{info.multiplier}){(state.equipment?.availableWeapons ?? []).includes(tier) ? '' : ' · bloqueada'}
                </option>
              ))}
            </select>
          </label>
          <label className={`${cardClass} space-y-1`}>
            <span className="text-[#a0937e] block">Armaduras</span>
            <select className={`${selectClass} w-full`} value={currentArmor} disabled={!writable} onChange={(e) => setArmorTier(e.target.value)}>
              {Object.entries(state.equipment?.armorCatalog ?? {}).map(([tier, info]) => (
                <option key={tier} value={tier} disabled={!(state.equipment?.availableArmors ?? []).includes(tier)}>
                  {info.label} (×{info.multiplier}){(state.equipment?.availableArmors ?? []).includes(tier) ? '' : ' · bloqueada'}
                </option>
              ))}
            </select>
          </label>
          <label className={`${cardClass} space-y-1`}>
            <span className="text-[#a0937e] block">Estrategia</span>
            <select className={`${selectClass} w-full`} value={currentStrategy} disabled={!writable} onChange={(e) => setStrategy(e.target.value)}>
              {Object.entries(state.equipment?.strategyCatalog ?? {}).map(([id, info]) => (
                <option key={id} value={id}>
                  {info.label} (ataque ×{info.attack}, defensa ×{info.defense}, contrarresta {(state.equipment?.strategyCatalog ?? {})[info.beats]?.label ?? info.beats})
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-[11px] text-[#8e816d] flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" />
          Las armas y armaduras se desbloquean con Herrería, Mina de hierro y tecnologías; el equipo se congela 15 minutos antes de cada batalla. Los nombres son los de tu civilización; los multiplicadores son iguales para todas (P30, P31).
        </p>
        {(state.equipment?.civilizationIdentity || state.equipment?.civilizationWeakness) && (
          <p className="text-[11px] text-[#c7beac]">
            {state.equipment?.civilizationIdentity && <>Tropa característica: <strong className="text-[#e6ded0]">{state.equipment.civilizationIdentity.signatureUnit.name}</strong> ({state.equipment.civilizationIdentity.signatureUnit.description}). </>}
            {state.equipment?.civilizationWeakness && <>Debilidad: <span className="text-rose-200">{state.equipment.civilizationWeakness}</span></>}
          </p>
        )}
        {writable && (
          <button type="button" className={primaryButton} onClick={handleEquipment} disabled={!equipmentChanged || action.busy !== null}>
            {action.busy === 'equipment' ? 'Guardando…' : 'Guardar equipamiento'}
          </button>
        )}
        <p className="text-[10px] text-[#615545] flex items-center gap-1.5">
          <Clock className="w-3 h-3" /> Hora del servidor: {new Date(serverNow).toLocaleTimeString('es-ES')}
        </p>
      </PanelSection>
    </div>
  );
}
