import React from 'react';
import { useMutation, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { GraduationCap, BookOpen } from 'lucide-react';
import {
  PanelSection,
  ProgressRow,
  StatusMessages,
  cardClass,
  formatCosts,
  formatRequirements,
  formatSecondsDuration,
  primaryButton,
  readOnlyNote,
  useActionState,
  useServerClock,
} from './shared';

const getTechnologiesQuery = makeFunctionReference<"query">("technologies:getTechnologies");
const researchTechnologyMutation = makeFunctionReference<"mutation">("technologies:researchTechnology");
const cancelResearchMutation = makeFunctionReference<"mutation">("technologies:cancelResearch");

interface TechnologiesState {
  serverTimeMs: number;
  writable: boolean;
  slots: number;
  slotsFree: number;
  modifiers: {
    agricultureProduction: number;
    miningProduction: number;
    storageCapacity: number;
    woundedRecoveryBonus: number;
    espionageLevel: number;
    trainingDuration: number;
    constructionDuration: number;
    happinessBase: number;
    unlockedWeapons: string[];
    unlockedArmors: string[];
    combatAttackBonus?: number;
    combatDefenseBonus?: number;
    marchSpeedBonus?: number;
    marchFatigueReduction?: number;
    foodConsumptionReduction?: number;
    woodProductionBonus?: number;
    stoneProductionBonus?: number;
    ironProductionBonus?: number;
    goldProductionBonus?: number;
    researchDuration?: number;
    constructionCost?: number;
    housingCapacityBonus?: number;
    taxToleranceReduction?: number;
    moraleBase?: number;
    unitEfficiencyInf?: number;
    unitEfficiencyArc?: number;
    unitEfficiencyCav?: number;
    unitEfficiencySiege?: number;
    mercenaryCostReduction?: number;
    woundedRateBonus?: number;
    fatigueAccrualReduction?: number;
    counterEspionage?: number;
    explorationSpeedBonus?: number;
    espionageCostReduction?: number;
    explorationCostReduction?: number;
  };
  researching: Array<{ _id: string; technologyId: string; name: string; startedAt?: number; durationMs?: number; costs?: Record<string, number>; progressPercent: number | null; completesAt: number | null }>;
  catalog: Array<{
    id: string;
    name: string;
    branch: string;
    universityLevel: number;
    costs: Record<string, number>;
    durationSeconds: number;
    bonifiedDurationSeconds: number;
    buildingRequirements: Record<string, number>;
    technologyRequirements: string[];
    effect: { key: string; value: number; description: string };
    secondaryEffects?: Array<{ key: string; value: number }>;
    status: 'locked' | 'available' | 'researching' | 'completed';
    blockers: string[];
  }>;
}

const BRANCH_ORDER = ['economica', 'civil', 'militar', 'inteligencia', 'civilizacion'] as const;

const BRANCH_LABELS: Record<string, string> = {
  economica: 'Económica',
  civil: 'Civil',
  militar: 'Militar',
  inteligencia: 'Inteligencia',
  civilizacion: 'Civilización',
};

const UNIVERSITY_TIER_LABELS: Record<number, string> = {
  1: 'Nivel 1 · Básico',
  2: 'Nivel 2 · Gremial',
  3: 'Nivel 3 · Académico',
  4: 'Nivel 4 · Doctrinal',
  5: 'Nivel 5 · Real',
  6: 'Nivel 6 · Avanzado',
  7: 'Nivel 7 · Superior',
  8: 'Nivel 8 · Maestría',
};

const STATUS_STYLES: Record<string, string> = {
  completed: 'text-emerald-300 border-emerald-800/60 bg-emerald-950/30',
  researching: 'text-amber-300 border-amber-800/60 bg-amber-950/30',
  available: 'text-[#d4af37] border-[#6e5520] bg-[#241a10]',
  locked: 'text-[#8e816d] border-[#2b2419] bg-[#100e0b]',
};

const STATUS_LABELS: Record<string, string> = {
  completed: 'investigada',
  researching: 'en curso',
  available: 'disponible',
  locked: 'bloqueada',
};

type BranchFilter = 'all' | (typeof BRANCH_ORDER)[number];
type StatusFilter = 'all' | 'available' | 'completed' | 'advanced';

export function UniversityPanel(props: { kingdomId: string; isOwner: boolean; buildingLabels: Record<string, string>; buildingLevels?: Record<string, number> }) {
  const { kingdomId, isOwner, buildingLabels } = props;
  const state = useQuery(getTechnologiesQuery, { kingdomId }) as TechnologiesState | undefined;
  const research = useMutation(researchTechnologyMutation);
  const cancel = useMutation(cancelResearchMutation);
  const serverNow = useServerClock(state?.serverTimeMs);
  const action = useActionState();
  const [branchFilter, setBranchFilter] = React.useState<BranchFilter>('all');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');

  if (!state) {
    return <p className="text-xs text-[#8e816d] italic p-4">Consultando la Universidad en el servidor…</p>;
  }
  const writable = isOwner && state.writable;
  const branchCounts = new Map<string, number>();
  for (const technology of state.catalog) {
    branchCounts.set(technology.branch, (branchCounts.get(technology.branch) ?? 0) + 1);
  }

  const filteredCatalog = state.catalog
    .filter((technology) => {
      if (branchFilter !== 'all' && technology.branch !== branchFilter) return false;
      if (statusFilter === 'available') return technology.status === 'available' || technology.status === 'researching';
      if (statusFilter === 'completed') return technology.status === 'completed';
      if (statusFilter === 'advanced') return technology.universityLevel >= 6;
      return true;
    })
    .slice()
    .sort((a, b) => a.universityLevel - b.universityLevel || a.name.localeCompare(b.name, 'es'));

  const byBranch = new Map<string, TechnologiesState['catalog']>();
  for (const technology of filteredCatalog) {
    const list = byBranch.get(technology.branch) ?? [];
    list.push(technology);
    byBranch.set(technology.branch, list);
  }
  const orderedBranches = [
    ...BRANCH_ORDER.filter((branch) => byBranch.has(branch)),
    ...[...byBranch.keys()].filter((branch) => !BRANCH_ORDER.includes(branch as (typeof BRANCH_ORDER)[number])),
  ];

  const technologyName = (id: string) => state.catalog.find((t) => t.id === id)?.name ?? id;

  const handleResearch = (technology: TechnologiesState['catalog'][number]) =>
    action.run(`research-${technology.id}`, async () => {
      const result = await research({ kingdomId, techType: technology.id });
      if (result && result.success === false) return result;
      return `Investigación de ${technology.name} iniciada; termina ${new Date(result.completesAt).toLocaleString('es-ES')}.`;
    });

  const handleCancel = (entry: TechnologiesState['researching'][number]) => {
    if (!window.confirm(`¿Cancelar la investigación de ${entry.name}? Se devuelve el 50 % del coste.`)) return;
    action.run(`cancel-${entry._id}`, async () => {
      const result = await cancel({ kingdomId, progressId: entry._id });
      if (result && result.success === false) return result;
      return `Investigación cancelada: ${formatCosts(result.refund)} devueltos.`;
    });
  };

  const m = state.modifiers;
  const activeEffects: string[] = [];
  if (m.agricultureProduction !== 1) activeEffects.push(`agricultura ×${m.agricultureProduction.toFixed(2)}`);
  if (m.miningProduction !== 1) activeEffects.push(`madera, piedra y hierro ×${m.miningProduction.toFixed(2)}`);
  if (m.storageCapacity !== 1) activeEffects.push(`almacenamiento ×${m.storageCapacity.toFixed(2)}`);
  if (m.woundedRecoveryBonus > 0) activeEffects.push(`recuperación de heridos +${Math.round(m.woundedRecoveryBonus * 100)} pp`);
  if (m.espionageLevel > 0) activeEffects.push(`espionaje nivel ${m.espionageLevel}`);
  if (m.trainingDuration !== 1) activeEffects.push(`entrenamiento ×${m.trainingDuration.toFixed(2)}`);
  if (m.constructionDuration !== 1) activeEffects.push(`construcción ×${m.constructionDuration.toFixed(2)}`);
  if (m.happinessBase > 0) activeEffects.push(`felicidad base +${m.happinessBase}`);
  if (m.combatAttackBonus && m.combatAttackBonus > 0) activeEffects.push(`ataque militar +${Math.round(m.combatAttackBonus * 100)} %`);
  if (m.combatDefenseBonus && m.combatDefenseBonus > 0) activeEffects.push(`defensa militar +${Math.round(m.combatDefenseBonus * 100)} %`);
  if (m.marchSpeedBonus && m.marchSpeedBonus > 0) activeEffects.push(`velocidad de marcha +${Math.round(m.marchSpeedBonus * 100)} %`);
  if (m.marchFatigueReduction && m.marchFatigueReduction > 0) activeEffects.push(`reducción fatiga −${Math.round(m.marchFatigueReduction * 100)} %`);
  if (m.foodConsumptionReduction && m.foodConsumptionReduction > 0) activeEffects.push(`consumo alimentos −${Math.round(m.foodConsumptionReduction * 100)} %`);
  if (m.woodProductionBonus && m.woodProductionBonus > 0) activeEffects.push(`madera +${Math.round(m.woodProductionBonus * 100)} %`);
  if (m.stoneProductionBonus && m.stoneProductionBonus > 0) activeEffects.push(`piedra +${Math.round(m.stoneProductionBonus * 100)} %`);
  if (m.ironProductionBonus && m.ironProductionBonus > 0) activeEffects.push(`hierro +${Math.round(m.ironProductionBonus * 100)} %`);
  if (m.goldProductionBonus && m.goldProductionBonus > 0) activeEffects.push(`oro +${Math.round(m.goldProductionBonus * 100)} %`);
  if (m.researchDuration && m.researchDuration !== 1) activeEffects.push(`duración investigación ×${m.researchDuration.toFixed(2)}`);
  if (m.constructionCost && m.constructionCost !== 1) activeEffects.push(`coste construcción ×${m.constructionCost.toFixed(2)}`);
  if (m.housingCapacityBonus && m.housingCapacityBonus > 0) activeEffects.push(`capacidad residencial +${Math.round(m.housingCapacityBonus * 100)} %`);
  if (m.taxToleranceReduction && m.taxToleranceReduction > 0) activeEffects.push(`tolerancia fiscal +${Math.round(m.taxToleranceReduction * 100)} %`);
  if (m.moraleBase && m.moraleBase > 0) activeEffects.push(`moral militar +${m.moraleBase} puntos`);
  if (m.unitEfficiencyInf && m.unitEfficiencyInf > 0) activeEffects.push(`eficacia infantería +${Math.round(m.unitEfficiencyInf * 100)} %`);
  if (m.unitEfficiencyArc && m.unitEfficiencyArc > 0) activeEffects.push(`eficacia arqueros +${Math.round(m.unitEfficiencyArc * 100)} %`);
  if (m.unitEfficiencyCav && m.unitEfficiencyCav > 0) activeEffects.push(`eficacia caballería +${Math.round(m.unitEfficiencyCav * 100)} %`);
  if (m.unitEfficiencySiege && m.unitEfficiencySiege > 0) activeEffects.push(`eficacia asedio +${Math.round(m.unitEfficiencySiege * 100)} %`);
  if (m.mercenaryCostReduction && m.mercenaryCostReduction > 0) activeEffects.push(`coste mercenarios −${Math.round(m.mercenaryCostReduction * 100)} %`);
  if (m.woundedRateBonus && m.woundedRateBonus > 0) activeEffects.push(`bajas que pasan a heridos +${Math.round(m.woundedRateBonus * 100)} %`);
  if (m.fatigueAccrualReduction && m.fatigueAccrualReduction > 0) activeEffects.push(`fatiga acumulada −${Math.round(m.fatigueAccrualReduction * 100)} %`);
  if (m.counterEspionage && m.counterEspionage > 0) activeEffects.push(`contrainteligencia +${Math.round(m.counterEspionage * 100)} %`);
  if (m.explorationSpeedBonus && m.explorationSpeedBonus > 0) activeEffects.push(`velocidad exploración +${Math.round(m.explorationSpeedBonus * 100)} %`);
  if (m.explorationCostReduction && m.explorationCostReduction > 0) activeEffects.push(`coste exploración −${Math.round(m.explorationCostReduction * 100)} %`);
  if (m.espionageCostReduction && m.espionageCostReduction > 0) activeEffects.push(`coste espionaje −${Math.round(m.espionageCostReduction * 100)} %`);
  if (m.unlockedWeapons.length) activeEffects.push(`armas: ${m.unlockedWeapons.join(', ')}`);
  if (m.unlockedArmors.length) activeEffects.push(`armaduras: ${m.unlockedArmors.join(', ')}`);

  return (
    <div className="space-y-6">
      <PanelSection
        icon={<GraduationCap className="w-4 h-4 text-sky-400" />}
        title="Investigación en curso"
        aside={<span>{state.slotsFree}/{state.slots} ranuras libres · ranuras de investigación disponibles</span>}
      >
        {state.researching.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {state.researching.map((entry) => (
              <ProgressRow
                key={entry._id}
                title={entry.name}
                subtitle={`Coste pagado: ${formatCosts(entry.costs)}`}
                startedAt={entry.startedAt}
                durationMs={entry.durationMs}
                serverTimeMs={serverNow}
                onCancel={writable ? () => handleCancel(entry) : undefined}
                cancelling={action.busy === `cancel-${entry._id}`}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">La Universidad no investiga nada en este momento.</p>
        )}
        <div className={`${cardClass} text-[11px] text-[#c7beac]`}>
          <span className="font-semibold text-[#e6ded0] block mb-1">Efectos activos de las tecnologías investigadas</span>
          {activeEffects.length ? activeEffects.join(' · ') : 'Ninguno todavía.'}
        </div>
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setBranchFilter('all')}
              className={`px-2.5 py-1 rounded border text-[11px] transition-colors ${branchFilter === 'all' ? 'border-[#d4af37] bg-[#2a1f10] text-[#f0e8d4]' : 'border-[#2b2419] bg-[#14110d] text-[#9b8e78] hover:text-[#e6ded0]'}`}
            >
              Todas ({state.catalog.length})
            </button>
            {BRANCH_ORDER.filter((b) => branchCounts.has(b)).map((branch) => (
              <button
                key={branch}
                type="button"
                onClick={() => setBranchFilter(branch)}
                className={`px-2.5 py-1 rounded border text-[11px] transition-colors ${branchFilter === branch ? 'border-[#d4af37] bg-[#2a1f10] text-[#f0e8d4]' : 'border-[#2b2419] bg-[#14110d] text-[#9b8e78] hover:text-[#e6ded0]'}`}
              >
                {BRANCH_LABELS[branch]} ({branchCounts.get(branch) ?? 0})
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-[#8e816d] mr-1">Filtro:</span>
            {(
              [
                ['all', 'Todo el árbol'],
                ['available', 'Disponibles / en curso'],
                ['completed', 'Investigadas'],
                ['advanced', 'Niveles 6–8 (Avanzado–Maestría)'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={`px-2 py-0.5 rounded border transition-colors ${statusFilter === value ? 'border-sky-600/80 bg-sky-950/40 text-sky-200' : 'border-[#2b2419] bg-[#14110d] text-[#8e816d] hover:text-[#c7beac]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <StatusMessages error={action.error} message={action.message} />
      </PanelSection>

      {orderedBranches.length === 0 ? (
        <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">
          No hay tecnologías que coincidan con el filtro seleccionado.
        </p>
      ) : (
        orderedBranches.map((branch) => {
          const technologies = byBranch.get(branch) ?? [];
          return (
            <PanelSection
              key={branch}
              icon={<BookOpen className="w-4 h-4 text-[#d4af37]" />}
              title={`Rama ${BRANCH_LABELS[branch] ?? branch}`}
              aside={<span>{technologies.length} tecnologías</span>}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {technologies.map((technology) => (
                  <div key={technology.id} className={`${cardClass} text-[11px] space-y-1.5`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-semibold text-[#f0e8d4] text-xs block">{technology.name}</span>
                        <span className={`text-[10px] ${technology.universityLevel >= 6 ? 'text-sky-300 font-medium' : 'text-[#9b8e78]'}`}>
                          {UNIVERSITY_TIER_LABELS[technology.universityLevel] ?? `Universidad nivel ${technology.universityLevel}`}
                        </span>
                      </div>
                      <span className={`px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider shrink-0 ${STATUS_STYLES[technology.status]}`}>
                        {STATUS_LABELS[technology.status]}
                      </span>
                    </div>
                    <p className="text-[#c7beac]"><strong className="text-[#e6ded0]">Efecto:</strong> {technology.effect.description}</p>
                    <p className="text-[#c7beac]"><strong className="text-[#e6ded0]">Coste:</strong> {formatCosts(technology.costs)} · <strong className="text-[#e6ded0]">Duración:</strong> {formatSecondsDuration(technology.bonifiedDurationSeconds || technology.durationSeconds)}</p>
                    <p className="text-[#8e816d]">
                      Universidad nivel {technology.universityLevel}
                      {Object.keys(technology.buildingRequirements).length ? ` · ${formatRequirements(technology.buildingRequirements, buildingLabels)}` : ''}
                      {technology.technologyRequirements.length ? ` · requiere ${technology.technologyRequirements.map(technologyName).join(', ')}` : ''}
                    </p>
                    {technology.status === 'locked' && technology.blockers.length > 0 && (
                      <p className="text-amber-300/90 font-medium"><strong className="text-amber-200">Falta para desbloquear:</strong> {technology.blockers.join('; ')}</p>
                    )}
                    {writable && technology.status === 'available' && (
                      <button
                        type="button"
                        className={primaryButton}
                        disabled={action.busy !== null || state.slotsFree === 0}
                        onClick={() => handleResearch(technology)}
                      >
                        {action.busy === `research-${technology.id}` ? 'Iniciando…' : state.slotsFree === 0 ? 'Sin ranura libre' : 'Investigar'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <StatusMessages error={action.error} message={action.message} />
            </PanelSection>
          );
        })
      )}
      {!writable && <p className="text-[11px] text-[#8e816d]">{readOnlyNote}</p>}
    </div>
  );
}
