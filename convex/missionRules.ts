/**
 * LA CONQUISTA — REGLAS PURAS DE MISIONES (sección 17 de CLAUDE.md, decisión 2026-10-21)
 * Progresivas por etapas, diarias (mismo conjunto para todos) y secretas (ocultas hasta cumplirse).
 * Sin acceso a Convex: el módulo missions.ts aplica estas reglas de forma atómica en el servidor.
 */
import {
  CIVILIZATIONS,
  MISSIONS,
  type MissionCondition,
  type MissionCounterKey,
  type MissionDefinition,
  type MissionReward,
  type MissionStage,
} from "./balanceConfig";

export const MISSION_COUNTER_KEYS: readonly MissionCounterKey[] = [
  "buildingsCompleted", "troopsTrained", "researchStarted", "researchCompleted", "battlesFought",
  "battlesWon", "crushingVictories", "challengesSent", "explorationsCompleted", "territoriesClaimed", "dailyBonusClaimed",
];

export type MissionCounters = Record<MissionCounterKey, number>;

export function emptyCounters(): MissionCounters {
  return Object.fromEntries(MISSION_COUNTER_KEYS.map((key) => [key, 0])) as MissionCounters;
}

export function normalizeCounters(raw: Partial<Record<string, number>> | null | undefined): MissionCounters {
  const counters = emptyCounters();
  for (const key of MISSION_COUNTER_KEYS) {
    const value = raw?.[key];
    counters[key] = Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : 0;
  }
  return counters;
}

/** Instantánea del reino sobre la que se evalúan las condiciones. */
export interface MissionSnapshot {
  buildingLevels: Readonly<Record<string, number>>;
  population: number;
  completedTechnologyIds: ReadonlyArray<string>;
  armySize: number;
  happiness: number;
  honor: number;
  resources: Readonly<Record<string, number>>;
  territoriesOwned: number;
  civilization?: string | null;
  lifetime: MissionCounters;
  daily: MissionCounters;
}

// ----------------------------------------------------------------------------
// Día de misiones diarias
// ----------------------------------------------------------------------------
/** Clave del día (AAAA-MM-DD) con el reinicio a la hora UTC configurada [DERIVADO]. */
export function dailyKeyFor(nowMs: number): string {
  const shifted = new Date(nowMs - MISSIONS.DAILY.RESET_UTC_HOUR * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

/** Instante (ms) del próximo reinicio diario. */
export function nextDailyResetAt(nowMs: number): number {
  const shifted = new Date(nowMs - MISSIONS.DAILY.RESET_UTC_HOUR * 3_600_000);
  const nextDay = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1);
  return nextDay + MISSIONS.DAILY.RESET_UTC_HOUR * 3_600_000;
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Mismo conjunto para todos los jugadores: selección determinista por fecha (sin adaptación por reino). */
export function selectDailyMissions(dayKey: string): MissionDefinition[] {
  const catalog = [...MISSIONS.DAILY.CATALOG];
  const chosen: MissionDefinition[] = [];
  let seed = hashString(dayKey);
  while (chosen.length < Math.min(MISSIONS.DAILY.PER_DAY, catalog.length)) {
    seed = hashString(`${dayKey}:${seed}`);
    const index = seed % catalog.length;
    chosen.push(catalog.splice(index, 1)[0]);
  }
  return chosen;
}

export function dailyMissionProgressId(missionId: string, dayKey: string): string {
  return `daily:${missionId}:${dayKey}`;
}

export function stageProgressId(stage: number): string {
  return `stage:${stage}`;
}

// ----------------------------------------------------------------------------
// Condiciones
// ----------------------------------------------------------------------------
/** Valor actual y objetivo de una condición (para mostrar progreso); null si no se puede medir. */
export function conditionProgress(condition: MissionCondition, snapshot: MissionSnapshot): { current: number; target: number } {
  const target = condition.value;
  switch (condition.type) {
    case "buildingLevel":
      return { current: snapshot.buildingLevels[condition.buildingType ?? ""] ?? 0, target };
    case "population":
      return { current: snapshot.population, target };
    case "technologiesCompleted":
      return { current: snapshot.completedTechnologyIds.length, target };
    case "technologyCompleted":
      return { current: snapshot.completedTechnologyIds.includes(condition.technologyId ?? "") ? 1 : 0, target: 1 };
    case "armySize":
      return { current: snapshot.armySize, target };
    case "happiness":
      return { current: snapshot.happiness, target };
    case "honor":
      return { current: snapshot.honor, target };
    case "resourceStock":
      return { current: snapshot.resources[condition.resource ?? ""] ?? 0, target };
    case "territoriesOwned":
      return { current: snapshot.territoriesOwned, target };
    case "lifetime":
      return { current: condition.counter ? snapshot.lifetime[condition.counter] : 0, target };
    case "daily":
      return { current: condition.counter ? snapshot.daily[condition.counter] : 0, target };
    default:
      return { current: 0, target };
  }
}

export function isConditionMet(condition: MissionCondition, snapshot: MissionSnapshot): boolean {
  const { current, target } = conditionProgress(condition, snapshot);
  return current >= target;
}

// ----------------------------------------------------------------------------
// Catálogo visible y evaluación
// ----------------------------------------------------------------------------
/** Secretas por civilización: una por civilización, misma recompensa; condición = su tecnología única. */
export function civilizationSecretMissions(): MissionDefinition[] {
  return CIVILIZATIONS.map((civ) => ({
    id: `x_civ_${civ.id}`,
    title: MISSIONS.SECRET_PER_CIVILIZATION_TITLES[civ.id] ?? `Legado de los ${civ.label}`,
    description: `Completar la tecnología única de los ${civ.label}.`,
    condition: { type: "technologyCompleted", technologyId: civ.uniqueTechnologyId, value: 1 },
    reward: MISSIONS.SECRET_PER_CIVILIZATION_REWARD,
    civilization: civ.id,
  }));
}

export function allSecretMissions(): MissionDefinition[] {
  return [...MISSIONS.SECRET, ...civilizationSecretMissions()];
}

/** Etapa en curso: la primera cuyas misiones no están todas completadas (null si todas lo están). */
export function currentStage(completedIds: ReadonlySet<string>): MissionStage | null {
  for (const stage of MISSIONS.STAGES) {
    if (!stage.missions.every((mission) => completedIds.has(mission.id))) return stage;
  }
  return null;
}

export interface MissionCompletion {
  progressId: string;
  mission: MissionDefinition;
  kind: "stage" | "daily" | "secret" | "stageReward";
  reward: MissionReward;
  stage?: number;
}

/**
 * Misiones recién cumplidas que aún no constan como completadas. Solo se evalúan la etapa en
 * curso (las futuras permanecen ocultas), las diarias del día y las secretas (las de civilización,
 * solo la propia). Si la etapa queda completa, se añade su premio final.
 */
export function evaluateMissions(snapshot: MissionSnapshot, completedIds: ReadonlySet<string>, dayKey: string): MissionCompletion[] {
  const completions: MissionCompletion[] = [];
  const done = new Set(completedIds);

  const stage = currentStage(done);
  if (stage) {
    for (const mission of stage.missions) {
      if (done.has(mission.id) || !isConditionMet(mission.condition, snapshot)) continue;
      completions.push({ progressId: mission.id, mission, kind: "stage", reward: mission.reward, stage: stage.stage });
      done.add(mission.id);
    }
    const stageId = stageProgressId(stage.stage);
    if (!done.has(stageId) && stage.missions.every((mission) => done.has(mission.id))) {
      completions.push({
        progressId: stageId,
        mission: { id: stageId, title: `Etapa ${stage.stage} completada: ${stage.title}`, description: "Premio final de la etapa.", condition: { type: "lifetime", value: 0 }, reward: stage.reward },
        kind: "stageReward",
        reward: stage.reward,
        stage: stage.stage,
      });
      done.add(stageId);
    }
  }

  for (const mission of selectDailyMissions(dayKey)) {
    const progressId = dailyMissionProgressId(mission.id, dayKey);
    if (done.has(progressId) || !isConditionMet(mission.condition, snapshot)) continue;
    completions.push({ progressId, mission, kind: "daily", reward: mission.reward });
    done.add(progressId);
  }

  for (const mission of allSecretMissions()) {
    if (mission.civilization && mission.civilization !== snapshot.civilization) continue;
    if (done.has(mission.id) || !isConditionMet(mission.condition, snapshot)) continue;
    completions.push({ progressId: mission.id, mission, kind: "secret", reward: mission.reward });
    done.add(mission.id);
  }

  return completions;
}

/** Texto breve de una recompensa para la celebración y el panel. */
export function describeReward(reward: MissionReward): string {
  const parts: string[] = [];
  const labels: Record<string, string> = { gold: "oro", wood: "madera", stone: "piedra", iron: "hierro", food: "alimentos" };
  for (const [resource, amount] of Object.entries(reward.resources ?? {})) if (amount) parts.push(`+${amount} ${labels[resource] ?? resource}`);
  if (reward.honor) parts.push(`+${reward.honor} honor`);
  if (reward.glory) parts.push(`+${reward.glory} gloria`);
  if (reward.troops) parts.push(`+${reward.troops.count} ${reward.troops.unitType} nivel ${reward.troops.level}`);
  if (reward.productionBonus) parts.push(`producción ×${reward.productionBonus.multiplier} durante ${reward.productionBonus.days} día(s)`);
  return parts.join(" · ") || "sin recompensa";
}

/** Multiplicador combinado de las bonificaciones temporales de producción vigentes. */
export function activeProductionBonusMultiplier(bonuses: ReadonlyArray<{ multiplier: number; expiresAt: number }> | null | undefined, nowMs: number): number {
  let multiplier = 1;
  for (const bonus of bonuses ?? []) {
    if (bonus.expiresAt > nowMs && Number.isFinite(bonus.multiplier) && bonus.multiplier > 0) multiplier *= bonus.multiplier;
  }
  return multiplier;
}
