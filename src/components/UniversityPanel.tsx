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
    status: 'locked' | 'available' | 'researching' | 'completed';
    blockers: string[];
  }>;
}

const BRANCH_LABELS: Record<string, string> = {
  economica: 'Económica',
  civil: 'Civil',
  militar: 'Militar',
  inteligencia: 'Inteligencia',
  civilizacion: 'Civilización',
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

export function UniversityPanel(props: { kingdomId: string; isOwner: boolean; buildingLabels: Record<string, string>; buildingLevels?: Record<string, number> }) {
  const { kingdomId, isOwner, buildingLabels } = props;
  const buildingLevelOf = (type: string) => props.buildingLevels?.[type] ?? 0;
  const state = useQuery(getTechnologiesQuery, { kingdomId }) as TechnologiesState | undefined;
  const research = useMutation(researchTechnologyMutation);
  const cancel = useMutation(cancelResearchMutation);
  const serverNow = useServerClock(state?.serverTimeMs);
  const action = useActionState();

  if (!state) {
    return <p className="text-xs text-[#8e816d] italic p-4">Consultando la Universidad en el servidor…</p>;
  }
  const writable = isOwner && state.writable;
  const byBranch = new Map<string, TechnologiesState['catalog']>();
  for (const technology of state.catalog) {
    const list = byBranch.get(technology.branch) ?? [];
    list.push(technology);
    byBranch.set(technology.branch, list);
  }
  const technologyName = (id: string) => state.catalog.find((t) => t.id === id)?.name ?? id;

  const handleResearch = (technology: TechnologiesState['catalog'][number]) =>
    action.run(`research-${technology.id}`, async () => {
      const result = await research({ kingdomId, techType: technology.id });
      return `Investigación de ${technology.name} iniciada; termina ${new Date(result.completesAt).toLocaleString('es-ES')}.`;
    });

  const handleCancel = (entry: TechnologiesState['researching'][number]) => {
    if (!window.confirm(`¿Cancelar la investigación de ${entry.name}? Se devuelve el 50 % del coste.`)) return;
    action.run(`cancel-${entry._id}`, async () => {
      const result = await cancel({ kingdomId, progressId: entry._id });
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
  if (m.unlockedWeapons.length) activeEffects.push(`armas: ${m.unlockedWeapons.join(', ')}`);
  if (m.unlockedArmors.length) activeEffects.push(`armaduras: ${m.unlockedArmors.join(', ')}`);

  return (
    <div className="space-y-6">
      <PanelSection
        icon={<GraduationCap className="w-4 h-4 text-sky-400" />}
        title="Investigación en curso"
        aside={<span>{state.slotsFree}/{state.slots} ranuras libres · ranuras: {state.slots} (Universidad nivel {buildingLevelOf('universidad')}; nivel 3 da 2 y nivel 5 da 3)</span>}
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
        <StatusMessages error={action.error} message={action.message} />
      </PanelSection>

      {[...byBranch.entries()].map(([branch, technologies]) => (
        <PanelSection key={branch} icon={<BookOpen className="w-4 h-4 text-[#d4af37]" />} title={`Rama ${BRANCH_LABELS[branch] ?? branch}`}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {technologies.map((technology) => (
              <div key={technology.id} className={`${cardClass} text-[11px] space-y-1.5`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-[#f0e8d4] text-xs">{technology.name}</span>
                  <span className={`px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${STATUS_STYLES[technology.status]}`}>
                    {STATUS_LABELS[technology.status]}
                  </span>
                </div>
                <p className="text-[#c7beac]"><strong className="text-[#e6ded0]">Efecto:</strong> {technology.effect.description}</p>
                <p className="text-[#c7beac]"><strong className="text-[#e6ded0]">Coste:</strong> {formatCosts(technology.costs)} · <strong className="text-[#e6ded0]">duración:</strong> {formatSecondsDuration(technology.bonifiedDurationSeconds || technology.durationSeconds)}</p>
                <p className="text-[#8e816d]">
                  Universidad nivel {technology.universityLevel}
                  {Object.keys(technology.buildingRequirements).length ? ` · ${formatRequirements(technology.buildingRequirements, buildingLabels)}` : ''}
                  {technology.technologyRequirements.length ? ` · requiere ${technology.technologyRequirements.map(technologyName).join(', ')}` : ''}
                </p>
                {technology.status === 'locked' && technology.blockers.length > 0 && (
                  <p className="text-amber-300/90">Bloqueada: {technology.blockers.join('; ')}</p>
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
        </PanelSection>
      ))}
      {!writable && <p className="text-[11px] text-[#8e816d]">{readOnlyNote}</p>}
    </div>
  );
}
