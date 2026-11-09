import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { 
  Swords, 
  Shield, 
  Users, 
  Clock, 
  Activity, 
  Coins, 
  Flag, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  Filter, 
  Lock, 
  Target, 
  Castle, 
  Info, 
  Layers, 
  Award,
  TrendingUp,
  Heart,
  Compass
} from 'lucide-react';
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
const upgradeArmyLevelMutation = makeFunctionReference<"mutation">("army:upgradeArmyLevel");
const recruitSpyMutation = makeFunctionReference<"mutation">("army:recruitSpy");

interface ArmyState {
  serverTimeMs: number;
  writable: boolean;
  armyLevel: number;
  globalUpgradeInfo: {
    currentLevel: number;
    nextLevel: number;
    isMaxLevel: boolean;
    nextLevelInfo: {
      level: number;
      name: string;
      multiplier: number;
      foodMultiplier: number;
      requirements: Record<string, number>;
      costs: Record<string, number>;
      upgradeDurationSeconds: number;
    } | null;
    requirementsSatisfied: boolean;
    requirementError: string | null;
  };
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
  spies: {
    active: number;
    inQueue: number;
    capacity: number;
    cuartelLevel: number;
  };
}

type FilterCategory = 'todas' | 'infanteria' | 'arqueria' | 'caballeria' | 'asedio' | 'mercenarios';

export function ArmyPanel(props: { kingdomId: string; isOwner: boolean; buildingLabels: Record<string, string> }) {
  const { kingdomId, isOwner, buildingLabels } = props;
  const state = useQuery(getArmyStateQuery, { kingdomId }) as ArmyState | undefined;
  const startTraining = useMutation(startTrainingMutation);
  const cancelTraining = useMutation(cancelTrainingMutation);
  const setEquipment = useMutation(setArmyEquipmentMutation);
  const hireMercenaries = useMutation(hireMercenariesMutation);
  const setFormation = useMutation(setFormationMutation);
  const setTacticalFormation = useMutation(setTacticalFormationMutation);
  const upgradeArmyLevel = useMutation(upgradeArmyLevelMutation);
  const recruitSpy = useMutation(recruitSpyMutation);
  const serverNow = useServerClock(state?.serverTimeMs);
  const action = useActionState();

  // Estados locales para formularios y filtros
  const [unitType, setUnitType] = useState<string>('infanteria');
  const [count, setCount] = useState<number>(10);
  const [spyCount, setSpyCount] = useState<number>(1);

  const handleRecruitSpy = () => {
    action.run('recruit-spy', async () => {
        const result = await recruitSpy({ kingdomId, count: spyCount });
        if (result && (result as any).success === false) return result;
        return `Reclutamiento de ${spyCount} espía(s) iniciado.`;
    });
  };
  const [level, setLevel] = useState<number>(1);
  const [weaponTier, setWeaponTier] = useState<string | null>(null);
  const [armorTier, setArmorTier] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<string | null>(null);
  const [formationDraft, setFormationDraft] = useState<Record<string, number> | null>(null);
  const [tacticalDraft, setTacticalDraft] = useState<string | null>(null);
  const [mercenaryCount, setMercenaryCount] = useState<number>(10);
  const [mercenaryTypeId, setMercenaryTypeId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('todas');

  if (!state) {
    return (
      <div className="bg-[#14110d] border border-[#2b2419] rounded-xl p-6 text-center space-y-3 shadow-lg">
        <Clock className="w-6 h-6 text-[#d4af37] animate-spin mx-auto" />
        <p className="text-xs text-[#c7beac] font-serif uppercase tracking-wider">Consultando estado del ejército en Convex…</p>
      </div>
    );
  }

  const globalUpgradeInfo = state.globalUpgradeInfo ?? {
    currentLevel: state.armyLevel ?? 1,
    nextLevel: Math.min(5, (state.armyLevel ?? 1) + 1),
    isMaxLevel: (state.armyLevel ?? 1) >= 5,
    nextLevelInfo: null,
    requirementsSatisfied: false,
    requirementError: null,
  };

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

  const FORMATION_TYPES = ['infanteria', 'arqueria', 'caballeria', 'asedio'] as const;
  const currentFormation: Record<string, number> = formationDraft ?? Object.fromEntries(
    FORMATION_TYPES.map((type) => [type, Math.round(((state.formation?.[type] ?? 1) as number) * 100)])
  );
  const formationChanged = formationDraft !== null && FORMATION_TYPES.some(
    (type) => Math.round(((state.formation?.[type] ?? 1) as number) * 100) !== currentFormation[type]
  );
  const committed = (type: string) => Math.round((state.summary.byType[type]?.active ?? 0) * (currentFormation[type] ?? 100) / 100);

  const safeMercenaries = Number.isInteger(mercenaryCount) && mercenaryCount > 0 ? mercenaryCount : 0;
  const mercenaryTypes = state.mercenaries.types ?? [];
  const selectedMercenaryType =
    mercenaryTypes.find((type) => type.id === mercenaryTypeId && type.available) ??
    [...mercenaryTypes].reverse().find((type) => type.available) ??
    mercenaryTypes[0];
  const mercenaryCost = safeMercenaries * (selectedMercenaryType?.goldPerUnit ?? state.mercenaries?.goldPerUnit ?? 0);
  const mercenaryRoom = Math.max(0, (state.mercenaries?.maxActive ?? 0) - (state.mercenaries?.active ?? 0));

  const equipmentChanged =
    currentWeapon !== state.equipment?.weaponTier || currentArmor !== state.equipment?.armorTier || currentStrategy !== state.equipment?.strategy;

  // Manejadores de acciones
  const handleUpgradeArmyLevel = () => {
    if (!globalUpgradeInfo.nextLevel) return;
    action.run('upgrade-army-level', async () => {
      const res = await upgradeArmyLevel({ kingdomId, targetLevel: globalUpgradeInfo.nextLevel });
      if (res && res.success === false) return res;
      return `¡Ejército ascendido al Nivel ${res.armyLevel} (${res.levelName})! Daño ×${res.multiplier}. ${res.unitsUpgraded} unidades mejoradas.`;
    });
  };

  const handleTrain = () =>
    action.run('train', async () => {
      const result = await startTraining({ kingdomId, unitType, count: safeCount, level });
      if (result && result.success === false) return result;
      return `Lote de ${result.count} ${UNIT_LABELS[result.unitType] ?? result.unitType} (nivel ${result.level}) encolado; termina ${new Date(result.completesAt).toLocaleString('es-ES')}.`;
    });

  const handleCancel = (trainingId: string, label: string) => {
    if (!window.confirm(`¿Cancelar ${label}? Se devuelve el 50 % de los recursos y toda la población reservada.`)) return;
    action.run(`cancel-${trainingId}`, async () => {
      const result = await cancelTraining({ kingdomId, trainingId });
      if (result && result.success === false) return result;
      return `Lote cancelado: ${formatCosts(result.refund)} devueltos y ${result.populationReturned} civiles liberados.`;
    });
  };

  const handleHire = () =>
    action.run('hire', async () => {
      const result = await hireMercenaries({ kingdomId, count: safeMercenaries, typeId: selectedMercenaryType?.id });
      if (result && result.success === false) return result;
      return `${result.count} ${result.label ?? 'mercenarios'} contratados por ${result.cost} oro; contrato hasta ${new Date(result.contractEndsAt).toLocaleString('es-ES')} sin salario diario.`;
    });

  const handleFormation = () =>
    action.run('formation', async () => {
      const formation = Object.fromEntries(FORMATION_TYPES.map((type) => [type, (currentFormation[type] ?? 100) / 100]));
      await setFormation({ kingdomId, formation });
      setFormationDraft(null);
      return 'Formación guardada: se aplicará al congelar el próximo combate.';
    });

  const handleTactical = () =>
    action.run('tactical', async () => {
      const result = await setTacticalFormation({ kingdomId, tacticalFormation: currentTactical });
      if (result && result.success === false) return result;
      setTacticalDraft(null);
      return `Formación ${result.label} guardada: ataque ×${result.attack}, defensa ×${result.defense}.`;
    });

  const handleEquipment = () =>
    action.run('equipment', async () => {
      const res = await setEquipment({ kingdomId, weaponTier: currentWeapon, armorTier: currentArmor, strategy: currentStrategy });
      if (res && res.success === false) return res;
      setWeaponTier(null);
      setArmorTier(null);
      setStrategy(null);
      return 'Equipamiento y estrategia guardados en el servidor.';
    });

  // Filtrado de inventario
  const filteredUnits = state.units.filter((unit) => {
    if (activeFilter === 'todas') return true;
    if (activeFilter === 'mercenarios') return !!unit.isMercenary;
    return unit.unitType === activeFilter && !unit.isMercenary;
  });

  const currentLevelInfo = state.militaryLevels.find((l) => l.level === (state.armyLevel ?? 1));

  return (
    <div className="space-y-8">
      {/* ====================================================================
          SECCIÓN 1 — CUARTEL E INVENTARIO
          ==================================================================== */}
      <section className="bg-[#14110d] border border-[#2b2419] rounded-xl p-4 sm:p-6 shadow-md space-y-6">
        {/* Encabezado de la Sección 1 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#292218] pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#211a12] border border-[#d4af37]/40 rounded-lg text-[#d4af37]">
              <Castle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-serif font-bold text-[#f7f2e4] uppercase tracking-wider">
                Sección I — Cuartel e Inventario
              </h2>
              <p className="text-xs text-[#8e816d]">Resumen marcial, inventario de fuerzas y grado de ascenso global</p>
            </div>
          </div>
          <span className="text-xs font-serif font-semibold text-[#d4af37] bg-[#1d1710] px-3 py-1 rounded-full border border-[#3b301d] self-start sm:self-center">
            {state.summary.totalActive.toLocaleString('es-ES')} efectivos totales
          </span>
        </div>

        {/* A. Resumen General del Ejército */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-serif font-bold text-[#d4af37] uppercase tracking-wider">
            <Award className="w-4 h-4" />
            <span>Indicadores Generales de Combate</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className={cardClass}>
              <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider">Rango Militar</span>
              <span className="text-base font-bold text-amber-300 font-serif block">Nivel {state.armyLevel ?? 1}</span>
              <span className="text-[10px] text-[#695d4c] truncate block">{currentLevelInfo?.name ?? 'Milicia'}</span>
            </div>
            <div className={cardClass}>
              <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider">Tropa Viva</span>
              <span className="text-base font-bold text-rose-300 font-serif block">{state.summary.livingSoldiers.toLocaleString('es-ES')}</span>
              <span className="text-[10px] text-[#695d4c] truncate block">{state.summary.siegeOperators} op. de asedio</span>
            </div>
            <div className={cardClass}>
              <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider">Asedio</span>
              <span className="text-base font-bold text-purple-300 font-serif block">{state.summary.siegeMachines}</span>
              <span className="text-[10px] text-[#695d4c] truncate block">sin consumo raciones</span>
            </div>
            <div className={cardClass}>
              <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider">Heridos</span>
              <span className="text-base font-bold text-rose-400 font-serif block">{state.summary.totalWounded.toLocaleString('es-ES')}</span>
              <span className="text-[10px] text-[#695d4c] truncate block">bajas hospitalizadas</span>
            </div>
            <div className={cardClass}>
              <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider">Fatiga</span>
              <span className="text-base font-bold text-amber-400 font-serif block">{state.equipment?.fatigue ?? 0}%</span>
              <span className="text-[10px] text-[#695d4c] truncate block">-10%/día ración normal</span>
            </div>
            <div className={cardClass}>
              <span className="text-[10px] text-[#8e816d] block uppercase tracking-wider">Potencia Daño</span>
              <span className="text-base font-bold text-emerald-400 font-serif block">×{(currentLevelInfo?.multiplier ?? 1).toFixed(2)}</span>
              <span className="text-[10px] text-[#695d4c] truncate block">multiplicador base</span>
            </div>
          </div>
        </div>

        {/* B. Ascenso Global del Ejército */}
        <div className="bg-[#19140e] border border-[#3d3221] rounded-lg p-4 space-y-3 relative overflow-hidden shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#2b2316] pb-2.5">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#d4af37]" />
              <h3 className="text-xs font-serif font-bold text-[#f5efe1] uppercase tracking-wider">
                Ascenso Global del Ejército — (Nivel {state.armyLevel ?? 1} ➔ Nivel {globalUpgradeInfo.isMaxLevel ? 5 : globalUpgradeInfo.nextLevel})
              </h3>
            </div>
            <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded font-bold border ${globalUpgradeInfo.isMaxLevel ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800' : 'bg-[#292014] text-[#d4af37] border-[#473822]'}`}>
              {globalUpgradeInfo.isMaxLevel ? 'Élite Máxima' : `Siguiente: Nivel ${globalUpgradeInfo.nextLevel}`}
            </span>
          </div>

          <p className="text-[11px] text-[#a0937e] leading-relaxed">
            Incrementa el grado militar de todas las tropas del reino del nivel {state.armyLevel ?? 1} al {globalUpgradeInfo.isMaxLevel ? 5 : globalUpgradeInfo.nextLevel}. Aumenta el multiplicador de daño (+10% por nivel) y el consumo de raciones (+10% por nivel) de forma permanente.
          </p>

          {!globalUpgradeInfo.isMaxLevel && globalUpgradeInfo.nextLevelInfo && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px] bg-[#100e0b] border border-[#2b2419] rounded-lg p-3">
              <div>
                <span className="text-[#8e816d] block uppercase tracking-wider text-[9px] font-semibold">Beneficios</span>
                <span className="text-[#e6ded0] block font-bold mt-0.5">Daño ×{globalUpgradeInfo.nextLevelInfo.multiplier.toFixed(2)}</span>
                <span className="text-[#8e816d] block text-[10px]">Raciones ×{globalUpgradeInfo.nextLevelInfo.foodMultiplier.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[#8e816d] block uppercase tracking-wider text-[9px] font-semibold">Requisitos de Edificio</span>
                <span className="text-[#c7beac] block mt-0.5">
                  {formatRequirements(globalUpgradeInfo.nextLevelInfo.requirements, buildingLabels)}
                </span>
                {globalUpgradeInfo.requirementError && (
                  <span className="text-amber-300 font-semibold block text-[10px] mt-0.5">
                    🔒 {globalUpgradeInfo.requirementError}
                  </span>
                )}
              </div>
              <div>
                <span className="text-[#8e816d] block uppercase tracking-wider text-[9px] font-semibold">Costes de Recursos</span>
                <span className="text-[#d4af37] font-semibold block mt-0.5">
                  {formatCosts(globalUpgradeInfo.nextLevelInfo.costs)}
                </span>
              </div>
            </div>
          )}

          {writable && !globalUpgradeInfo.isMaxLevel && (
            <div className="pt-1 flex justify-end">
              <button
                type="button"
                className={`${primaryButton} w-full sm:w-auto font-bold px-4 py-1.5 shadow-md`}
                disabled={!globalUpgradeInfo.requirementsSatisfied || action.busy !== null}
                onClick={handleUpgradeArmyLevel}
              >
                {action.busy === 'upgrade-army-level' ? 'Ascendiendo ejército…' : `Ascender Ejército a Nivel ${globalUpgradeInfo.nextLevel}`}
              </button>
            </div>
          )}
        </div>

        {/* C. Inventario de Tropas con Filtros Visuales */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#292218] pb-2.5">
            <div className="flex items-center gap-2 text-xs font-serif font-bold text-[#d4af37] uppercase tracking-wider">
              <Layers className="w-4 h-4" />
              <span>Inventario de Tropas ({filteredUnits.length})</span>
            </div>

            {/* Filtros visuales */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-[#8e816d] flex items-center gap-1 mr-1 text-[10px] uppercase tracking-wider">
                <Filter className="w-3 h-3 text-[#d4af37]" /> Filtrar:
              </span>
              {(['todas', 'infanteria', 'arqueria', 'caballeria', 'asedio', 'mercenarios'] as FilterCategory[]).map((cat) => {
                const labelMap: Record<FilterCategory, string> = {
                  todas: 'Todas',
                  infanteria: 'Infantería',
                  arqueria: 'Arquería',
                  caballeria: 'Caballería',
                  asedio: 'Asedio',
                  mercenarios: 'Mercenarios',
                };
                const isActive = activeFilter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveFilter(cat)}
                    className={`px-2.5 py-1 rounded transition-colors text-[10px] font-semibold ${
                      isActive
                        ? 'bg-[#d4af37] text-[#110e0a] font-bold shadow-sm'
                        : 'bg-[#1b1610] text-[#a0937e] hover:bg-[#282018] hover:text-[#f0e8d4] border border-[#2d251a]'
                    }`}
                  >
                    {labelMap[cat]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tarjetas del Inventario */}
          {filteredUnits.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredUnits.map((unit) => {
                const levelInfo = state.militaryLevels.find((l) => l.level === (unit.level ?? 1));
                return (
                  <div
                    key={unit._id}
                    className={`${cardClass} space-y-2 relative border-l-2 ${
                      unit.isMercenary ? 'border-l-amber-500 bg-[#1b1610]' : 'border-l-rose-500/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-serif font-bold text-xs text-[#f0e8d4]">
                            {UNIT_LABELS[unit.unitType] ?? unit.unitType}
                          </span>
                          {unit.isMercenary && (
                            <span className="text-[9px] bg-amber-950 text-amber-300 border border-amber-800 px-1.5 py-0.2 rounded font-bold">
                              MERCENARIO
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-[#8e816d] block mt-0.5">
                          Nivel {unit.level ?? 1} · {levelInfo?.name ?? 'Milicia'} (×{levelInfo?.multiplier ?? 1})
                        </span>
                      </div>
                      <span className="text-lg font-bold font-serif text-[#f4eedb] bg-[#100e0b] px-2.5 py-0.5 rounded border border-[#262017]">
                        {unit.count}
                      </span>
                    </div>

                    <div className="text-[10px] text-[#786c5a] space-y-0.5 border-t border-[#231d14] pt-1.5">
                      {unit.isMercenary && unit.contractEndsAt && (
                        <span className="text-amber-300/90 block">
                          ⏳ Vence: {new Date(unit.contractEndsAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      )}
                      {typeof unit.wounded === 'number' && unit.wounded > 0 && (
                        <span className="text-rose-400 font-semibold block">
                          🚑 {unit.wounded} en enfermería
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-4 rounded-lg border border-[#2b2419] text-center">
              No hay unidades registradas en esta categoría del inventario.
            </p>
          )}
        </div>
      </section>

      {/* ====================================================================
          SECCIÓN 2 — RECLUTAMIENTO
          ==================================================================== */}
      <section className="bg-[#14110d] border border-[#2b2419] rounded-xl p-4 sm:p-6 shadow-md space-y-6">
        {/* Encabezado de la Sección 2 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#292218] pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#211a12] border border-[#d4af37]/40 rounded-lg text-[#d4af37]">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-serif font-bold text-[#f7f2e4] uppercase tracking-wider">
                Sección II — Reclutamiento
              </h2>
              <p className="text-xs text-[#8e816d]">Entrenamiento de tropas regulares y contratación a sueldo en la Taberna</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#d4af37]">
            <span className="bg-[#1d1710] px-2.5 py-1 rounded border border-[#3b301d]">
              {state.queueSlotsFree}/{state.queueSlots} colas libres
            </span>
            <span className="bg-[#1d1710] px-2.5 py-1 rounded border border-[#3b301d]">
              {state.availableCivil ?? 0} civiles libres
            </span>
          </div>
        </div>

        {/* A. Entrenamiento de Tropas */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-serif font-bold text-[#d4af37] uppercase tracking-wider border-b border-[#241e15] pb-2">
            <Swords className="w-4 h-4 text-rose-400" />
            <span>A. Entrenamiento de Tropas Regulares</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Columna Izquierda: Catálogo e Información de Niveles */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">Catálogo de Unidades</h4>
              <div className="space-y-2">
                {state.unitCatalog.map((unit) => (
                  <div key={unit.unitType} className={`${cardClass} text-[11px] space-y-1`}>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#f0e8d4] font-serif">{unit.label}</span>
                      <span className={`text-[10px] font-semibold ${unit.requirementsSatisfied ? 'text-emerald-300' : 'text-amber-400'}`}>
                        {unit.requirementsSatisfied ? '✔ Disponible' : `🔒 Requiere ${formatRequirements(unit.requirements, buildingLabels)}`}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-[#c7beac]">
                      <span>Coste: {formatCosts(unit.unitCosts)}</span>
                      <span>Duración: {unit.unitDurationMs ? formatSecondsDuration(unit.unitDurationMs / 1000) : '—'}/unidad</span>
                      <span>Población: {unit.populationPerUnit} {unit.isLivingTroop ? 'civil libre' : 'operadores'}</span>
                      <span>Stats: ⚔️ {unit.attack} · 🛡️ {unit.defense} · ⚡ {unit.speed}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className={`${cardClass} text-[11px] space-y-1.5`}>
                <span className="font-bold text-[#f0e8d4] font-serif block">Niveles Militares Disponibles</span>
                <div className="space-y-1">
                  {state.militaryLevels.map((l) => (
                    <div key={l.level} className="flex items-center justify-between text-[10px]">
                      <span className={l.available ? 'text-emerald-300 font-semibold' : 'text-[#786c5a]'}>
                        Nivel {l.level} · {l.name} (Daño ×{l.multiplier})
                      </span>
                      <span className="text-[#8e816d]">
                        {l.available ? 'Disponible' : formatRequirements(l.requirements, buildingLabels)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Columna Derecha: Formulario de Nuevo Lote y Colas en Servidor */}
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">Nuevo Lote de Entrenamiento</h4>
              {writable ? (
                <form
                  className={`${cardClass} space-y-3 text-xs`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleTrain();
                  }}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="space-y-1">
                      <span className="text-[#a0937e] block text-[11px]">Unidad</span>
                      <select className={`${selectClass} w-full`} value={unitType} onChange={(e) => setUnitType(e.target.value)}>
                        {state.unitCatalog.map((u) => (
                          <option key={u.unitType} value={u.unitType}>{u.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <span className="text-[#a0937e] block text-[11px]">Cantidad</span>
                      <input
                        className={`${inputClass} w-full text-right`}
                        type="number"
                        min={1}
                        step={1}
                        value={count}
                        onChange={(e) => setCount(Number(e.target.value))}
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[#a0937e] block text-[11px]">Nivel Militar</span>
                      <select className={`${selectClass} w-full`} value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                        {state.militaryLevels.filter((l) => l.available).map((l) => (
                          <option key={l.level} value={l.level}>Nivel {l.level} · {l.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {/* Resumen visual compacto */}
                  <div className="rounded-lg border border-[#2b2419] bg-[#100e0b] p-3 text-[11px] space-y-1 text-[#c7beac]">
                    <div className="flex justify-between border-b border-[#231d14] pb-1">
                      <span className="text-[#8e816d]">Coste total:</span>
                      <span className="font-semibold text-[#d4af37]">{formatCosts(totalCosts)}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#231d14] pb-1">
                      <span className="text-[#8e816d]">Población requerida:</span>
                      <span className="font-semibold text-[#e6ded0]">{populationNeeded} civiles libres</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8e816d]">Tiempo total de lote:</span>
                      <span className="font-semibold font-mono text-amber-300">
                        {batchDurationSeconds !== null ? formatSecondsDuration(batchDurationSeconds) : '—'}
                      </span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className={`${primaryButton} w-full font-bold py-1.5`}
                    disabled={action.busy !== null || state.queueSlotsFree === 0 || safeCount === 0}
                  >
                    {action.busy === 'train' ? 'Encolando…' : state.queueSlotsFree === 0 ? 'Sin colas libres' : 'Iniciar Entrenamiento'}
                  </button>
                </form>
              ) : (
                <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">{readOnlyNote}</p>
              )}

              {/* Colas Activas en el Servidor */}
              <div className="space-y-2 pt-1">
                <h4 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">Colas en Entrenamiento</h4>
                {state.trainingQueue.length > 0 ? (
                  state.trainingQueue.map((entry) => {
                    const label = `${entry.count ?? '?'} ${UNIT_LABELS[entry.unitType ?? ''] ?? entry.unitType ?? 'unidades'} · Nivel ${entry.level ?? 1}`;
                    return (
                      <ProgressRow
                        key={entry._id}
                        title={label}
                        subtitle={`Población: ${entry.populationReserved ?? 0} · Coste pagado: ${formatCosts(entry.costs)}`}
                        startedAt={entry.startedAt}
                        durationMs={entry.durationMs}
                        serverTimeMs={serverNow}
                        onCancel={writable ? () => handleCancel(entry._id, label) : undefined}
                        cancelling={action.busy === `cancel-${entry._id}`}
                      />
                    );
                  })
                ) : (
                  <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded-lg border border-[#2b2419] text-center">
                    No hay lotes en entrenamiento activo.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* B. Contratación de Mercenarios */}
        <div className="space-y-4 border-t border-[#292218] pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#241e15] pb-2">
            <div className="flex items-center gap-2 text-xs font-serif font-bold text-[#d4af37] uppercase tracking-wider">
              <Coins className="w-4 h-4 text-amber-400" />
              <span>B. Contratación de Mercenarios (Taberna)</span>
            </div>
            <span className="text-xs font-mono text-[#c7beac]">
              {state.mercenaries?.active ?? 0}/{state.mercenaries?.maxActive ?? 0} activos · Taberna Nivel {state.mercenaries?.tavernLevel ?? 0}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
            {/* Columna Izquierda: Reglas y Oferta de Mercenarios */}
            <div className="space-y-3">
              <div className={`${cardClass} space-y-1.5 text-[11px] text-[#c7beac]`}>
                <p><strong className="text-[#e6ded0]">Beneficio:</strong> Se integran de inmediato al censo y ejército sin requerir población civil libre.</p>
                <p><strong className="text-[#e6ded0]">Contrato:</strong> Duración de {state.mercenaries?.contractDays ?? 0} días reales sin salario diario. Al caducar desaparecen.</p>
                <p><strong className="text-[#e6ded0]">Capacidad:</strong> Máximo {state.mercenaries?.maxActive ?? 0} activos simultáneos con la Taberna actual (50 por nivel).</p>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-[#a89b84] uppercase tracking-wider block">Catálogo de Mercenarios</span>
                {mercenaryTypes.map((type) => (
                  <div
                    key={type.id}
                    className={`${cardClass} flex items-center justify-between text-[11px] ${type.available ? 'border-amber-900/40' : 'opacity-60'}`}
                  >
                    <div>
                      <span className="font-bold text-[#f0e8d4] block">{type.label}</span>
                      <span className="text-[10px] text-[#8e816d]">
                        {UNIT_LABELS[type.unitType] ?? type.unitType} Nivel {type.level} · Taberna Nivel {type.minTavernLevel}
                      </span>
                    </div>
                    <span className="font-bold text-amber-300">{type.goldPerUnit.toLocaleString('es-ES')} oro</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Columna Derecha: Formulario de Contratación */}
            <div className="space-y-3">
              {writable ? (
                <form
                  className={`${cardClass} space-y-3`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleHire();
                  }}
                >
                  <label className="space-y-1 block">
                    <span className="text-[#a0937e] text-[11px] block">Tipo de Mercenario</span>
                    <select
                      className={`${selectClass} w-full`}
                      value={selectedMercenaryType?.id ?? ''}
                      onChange={(e) => setMercenaryTypeId(e.target.value)}
                      disabled={(state.mercenaries?.tavernLevel ?? 0) < 1}
                    >
                      {mercenaryTypes.map((type) => (
                        <option key={type.id} value={type.id} disabled={!type.available}>
                          {type.label} · {type.goldPerUnit} oro {type.available ? '' : `(Taberna ${type.minTavernLevel})`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 block">
                    <span className="text-[#a0937e] text-[11px] block">Cantidad a Contratar</span>
                    <input
                      className={`${inputClass} w-full text-right`}
                      type="number"
                      min={1}
                      max={Math.max(1, mercenaryRoom)}
                      step={1}
                      value={mercenaryCount}
                      onChange={(e) => setMercenaryCount(Number(e.target.value))}
                      disabled={(state.mercenaries?.tavernLevel ?? 0) < 1}
                    />
                  </label>

                  <div className="rounded-lg border border-[#2b2419] bg-[#100e0b] p-3 text-[11px] space-y-1 text-[#c7beac]">
                    <div className="flex justify-between border-b border-[#231d14] pb-1">
                      <span className="text-[#8e816d]">Coste Inmediato:</span>
                      <span className="font-bold text-[#d4af37]">{mercenaryCost.toLocaleString('es-ES')} oro</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8e816d]">Duración del Contrato:</span>
                      <span className="font-semibold text-[#e6ded0]">{state.mercenaries.contractDays} días reales</span>
                    </div>
                  </div>

                  {(state.mercenaries?.tavernLevel ?? 0) < 1 ? (
                    <p className="text-amber-300 text-[11px]">🔒 Se necesita construir una Taberna para contratar mercenarios.</p>
                  ) : mercenaryRoom === 0 ? (
                    <p className="text-amber-300 text-[11px]">🔒 Capacidad máxima de la Taberna alcanzada.</p>
                  ) : null}

                  <button
                    type="submit"
                    className={`${primaryButton} w-full font-bold py-1.5`}
                    disabled={action.busy !== null || (state.mercenaries?.tavernLevel ?? 0) < 1 || safeMercenaries === 0 || safeMercenaries > mercenaryRoom}
                  >
                    {action.busy === 'hire' ? 'Contratando…' : 'Contratar Mercenarios'}
                  </button>
                </form>
              ) : (
                <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">{readOnlyNote}</p>
              )}
            </div>
          </div>
        </div>

        <StatusMessages error={action.error} message={action.message} />
      </section>
      
      {/* ====================================================================
          SECCIÓN ESPÍAS
          ==================================================================== */}
      <section className="bg-[#14110d] border border-[#2b2419] rounded-xl p-4 sm:p-6 shadow-md space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#292218] pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#211a12] border border-sky-500/40 rounded-lg text-sky-400">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-serif font-bold text-[#f7f2e4] uppercase tracking-wider">
                Sección — Espionaje y Sabotaje
              </h2>
              <p className="text-xs text-[#8e816d]">Gestión de agentes infiltrados y descubrimiento de fronteras</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-sky-400">
            <span className="bg-[#1d1710] px-2.5 py-1 rounded border border-sky-900/30">
              {state.spies?.active ?? 0} agentes activos
            </span>
            <span className="bg-[#1d1710] px-2.5 py-1 rounded border border-sky-900/30">
              {state.spies?.inQueue ?? 0} en instrucción
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
           <div className="space-y-3">
              <div className={`${cardClass} space-y-2 text-[11px] text-[#c7beac]`}>
                <p><strong className="text-[#e6ded0]">Capacidad Agentes:</strong> Limitada por el nivel del Cuartel (1 por cada 2 niveles).</p>
                <div className="flex justify-between items-center bg-[#0c0a08] p-2 rounded border border-[#2b2419]">
                  <span className="text-[#8e816d]">Nivel Cuartel:</span>
                  <span className="text-amber-400 font-bold">{state.spies?.cuartelLevel ?? 0}</span>
                </div>
                <div className="flex justify-between items-center bg-[#0c0a08] p-2 rounded border border-[#2b2419]">
                  <span className="text-[#8e816d]">Límite de Agentes:</span>
                  <span className="text-sky-400 font-bold">{state.spies?.capacity ?? 0}</span>
                </div>
              </div>
              <p className="text-[10px] text-[#8e816d] italic">
                * Los espías permiten descubrir territorios en el mapa sin mover al ejército y sin ocupar población civil permanentemente.
              </p>
           </div>

           <div className="space-y-4">
              <h4 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">Instrucción de Agentes</h4>
              {writable ? (
                <div className={`${cardClass} space-y-3 text-xs`}>
                   <div className="flex items-center gap-3">
                    <label className="flex-1 space-y-1">
                      <span className="text-[#a0937e] block text-[11px]">Cantidad</span>
                      <input
                        className={`${inputClass} w-full text-right`}
                        type="number"
                        min={1}
                        max={Math.max(0, (state.spies?.capacity ?? 0) - ((state.spies?.active ?? 0) + (state.spies?.inQueue ?? 0)))}
                        step={1}
                        value={spyCount}
                        onChange={(e) => setSpyCount(Number(e.target.value))}
                      />
                    </label>
                    <button
                      type="button"
                      className={`${primaryButton} self-end py-1.5 px-4 font-bold`}
                      disabled={action.busy === 'recruit-spy' || ((state.spies?.active ?? 0) + (state.spies?.inQueue ?? 0) + spyCount) > (state.spies?.capacity ?? 0) || spyCount <= 0}
                      onClick={handleRecruitSpy}
                    >
                      {action.busy === 'recruit-spy' ? 'Instruyendo…' : 'Instruir Agentes'}
                    </button>
                  </div>
                  {((state.spies?.active ?? 0) + (state.spies?.inQueue ?? 0)) >= (state.spies?.capacity ?? 0) && (
                    <p className="text-amber-300 text-[10px] bg-amber-950/20 p-2 rounded border border-amber-900/30">
                      Capacidad máxima de espías alcanzada para tu nivel de Cuartel actual.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">{readOnlyNote}</p>
              )}
           </div>
        </div>
      </section>

      {/* ====================================================================
          SECCIÓN 3 — TÁCTICA Y EQUIPAMIENTO
          ==================================================================== */}
      <section className="bg-[#14110d] border border-[#2b2419] rounded-xl p-4 sm:p-6 shadow-md space-y-6">
        {/* Encabezado de la Sección 3 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#292218] pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#211a12] border border-[#d4af37]/40 rounded-lg text-[#d4af37]">
              <Flag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-serif font-bold text-[#f7f2e4] uppercase tracking-wider">
                Sección III — Táctica y Equipamiento
              </h2>
              <p className="text-xs text-[#8e816d]">Participación de tropas, formación táctica marcial y equipamiento del ejército</p>
            </div>
          </div>
        </div>

        {/* A. Participación de Tropas (Sliders) */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#241e15] pb-2">
            <div className="flex items-center gap-2 text-xs font-serif font-bold text-[#d4af37] uppercase tracking-wider">
              <Target className="w-4 h-4 text-sky-400" />
              <span>A. Participación de Tropas en Combate</span>
            </div>
            <span className="text-[11px] text-[#8e816d]">Fracción desplegada vs reservada en guarnición</span>
          </div>

          <p className="text-[11px] text-[#c7beac] leading-relaxed">
            Ajusta qué porcentaje de cada cuerpo acude al campo de batalla. Las tropas no desplegadas permanecen seguras en el castillo. 
            Matriz de contrapartidas (+20% bonus): Infantería vence a Caballería, Caballería vence a Arquería, Arquería vence a Infantería. 
            <strong className="text-[#e6ded0]"> Las formaciones se congelan 15 minutos antes de cada batalla.</strong>
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {FORMATION_TYPES.map((type) => (
              <label key={type} className={`${cardClass} space-y-2`}>
                <div className="flex items-center justify-between text-[#a0937e]">
                  <span className="font-bold text-[#f0e8d4] font-serif">{UNIT_LABELS[type] ?? type}</span>
                  <span className="font-mono text-[#d4af37] font-bold">
                    {currentFormation[type] ?? 100}% ({committed(type)} / {state.summary.byType[type]?.active ?? 0})
                  </span>
                </div>
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
            <div className="flex justify-end pt-1">
              <button
                type="button"
                className={`${primaryButton} font-bold px-4 py-1.5`}
                onClick={handleFormation}
                disabled={!formationChanged || action.busy !== null}
              >
                {action.busy === 'formation' ? 'Guardando…' : 'Guardar Formación de Combate'}
              </button>
            </div>
          )}
        </div>

        {/* B. Formación Táctica */}
        <div className="space-y-4 border-t border-[#292218] pt-4">
          <div className="flex items-center gap-2 text-xs font-serif font-bold text-[#d4af37] uppercase tracking-wider border-b border-[#241e15] pb-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>B. Formación Táctica Marcial</span>
          </div>

          <div className="space-y-3">
            <label className="space-y-1 block">
              <span className="text-[#a0937e] text-[11px] block">Seleccionar Formación Táctica</span>
              <select
                className={`${selectClass} w-full`}
                value={currentTactical}
                disabled={!writable}
                onChange={(e) => setTacticalDraft(e.target.value)}
              >
                {Object.entries(tacticalCatalog).map(([id, info]) => (
                  <option key={id} value={id}>
                    {info.label} (Ataque ×{info.attack}, Defensa ×{info.defense})
                  </option>
                ))}
              </select>
            </label>

            {tacticalInfo && (
              <div className="rounded-lg border border-[#2b2419] bg-[#100e0b] p-3 text-[11px] text-[#c7beac] space-y-1">
                <p><strong className="text-[#e6ded0]">Descripción:</strong> {tacticalInfo.description}</p>
                <p>
                  <strong className="text-[#e6ded0]">Efectos:</strong> Ataque ×{tacticalInfo.attack} · Defensa ×{tacticalInfo.defense}. 
                  Fuerte contra: <span className="text-emerald-300">{tacticalInfo.beats ? tacticalCatalog[tacticalInfo.beats]?.label : 'Ninguna'}</span> · 
                  Débil contra: <span className="text-rose-300">{tacticalWeakAgainst ?? 'Ninguna'}</span>.
                </p>
              </div>
            )}

            {writable && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  className={`${primaryButton} font-bold px-4 py-1.5`}
                  onClick={handleTactical}
                  disabled={currentTactical === (state.equipment?.tacticalFormation ?? 'equilibrada') || action.busy !== null}
                >
                  {action.busy === 'tactical' ? 'Guardando…' : 'Guardar Formación Táctica'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* C. Equipamiento y Estrategia */}
        <div className="space-y-4 border-t border-[#292218] pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#241e15] pb-2">
            <div className="flex items-center gap-2 text-xs font-serif font-bold text-[#d4af37] uppercase tracking-wider">
              <Shield className="w-4 h-4 text-amber-400" />
              <span>C. Equipamiento y Estrategia de Guerra</span>
            </div>
            <span className="text-[10px] text-[#615545] flex items-center gap-1 font-mono">
              <Clock className="w-3 h-3 text-[#d4af37]" /> Hora servidor: {new Date(serverNow).toLocaleTimeString('es-ES')}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <label className={`${cardClass} space-y-1 block`}>
              <span className="text-[#a0937e] block text-[11px]">Armas Marciales</span>
              <select
                className={`${selectClass} w-full`}
                value={currentWeapon}
                disabled={!writable}
                onChange={(e) => setWeaponTier(e.target.value)}
              >
                {Object.entries(state.equipment?.weaponCatalog ?? {}).map(([tier, info]) => (
                  <option key={tier} value={tier} disabled={!(state.equipment?.availableWeapons ?? []).includes(tier)}>
                    {info.label} (×{info.multiplier}){(state.equipment?.availableWeapons ?? []).includes(tier) ? '' : ' 🔒 Bloqueada'}
                  </option>
                ))}
              </select>
            </label>

            <label className={`${cardClass} space-y-1 block`}>
              <span className="text-[#a0937e] block text-[11px]">Armaduras de Protección</span>
              <select
                className={`${selectClass} w-full`}
                value={currentArmor}
                disabled={!writable}
                onChange={(e) => setArmorTier(e.target.value)}
              >
                {Object.entries(state.equipment?.armorCatalog ?? {}).map(([tier, info]) => (
                  <option key={tier} value={tier} disabled={!(state.equipment?.availableArmors ?? []).includes(tier)}>
                    {info.label} (×{info.multiplier}){(state.equipment?.availableArmors ?? []).includes(tier) ? '' : ' 🔒 Bloqueada'}
                  </option>
                ))}
              </select>
            </label>

            <label className={`${cardClass} space-y-1 block`}>
              <span className="text-[#a0937e] block text-[11px]">Estrategia Militar</span>
              <select
                className={`${selectClass} w-full`}
                value={currentStrategy}
                disabled={!writable}
                onChange={(e) => setStrategy(e.target.value)}
              >
                {Object.entries(state.equipment?.strategyCatalog ?? {}).map(([id, info]) => (
                  <option key={id} value={id}>
                    {info.label} (Ataque ×{info.attack}, Defensa ×{info.defense})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {(state.equipment?.civilizationIdentity || state.equipment?.civilizationWeakness) && (
            <div className={`${cardClass} text-[11px] text-[#c7beac] space-y-1 bg-[#100e0b]`}>
              {state.equipment?.civilizationIdentity && (
                <p>
                  <strong className="text-[#e6ded0]">Tropa característica:</strong>{' '}
                  <span className="text-amber-300 font-semibold">{state.equipment.civilizationIdentity.signatureUnit.name}</span> —{' '}
                  {state.equipment.civilizationIdentity.signatureUnit.description}.
                </p>
              )}
              {state.equipment?.civilizationWeakness && (
                <p>
                  <strong className="text-[#e6ded0]">Debilidad de la civilización:</strong>{' '}
                  <span className="text-rose-300">{state.equipment.civilizationWeakness}</span>.
                </p>
              )}
            </div>
          )}

          {writable && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                className={`${primaryButton} font-bold px-4 py-1.5`}
                onClick={handleEquipment}
                disabled={!equipmentChanged || action.busy !== null}
              >
                {action.busy === 'equipment' ? 'Guardando…' : 'Guardar Equipamiento'}
              </button>
            </div>
          )}

          <StatusMessages error={action.error} message={action.message} />
        </div>
      </section>
    </div>
  );
}
