/**
 * LA CONQUISTA — REGLAS PURAS DE TECNOLOGÍAS (Bloque C, D-16 a D-21)
 * Catálogo inmutable (balanceConfig.TECHNOLOGIES) separado del progreso por reino.
 * Las funciones puras no acceden a Convex; readCompletedTechnologyIds es el único
 * lector de base de datos y se mantiene aquí para que construcción, entrenamiento
 * y economía obtengan los modificadores desde una sola ruta.
 */
import type { ResourceType } from "./economyCalculations";
import {
  RESEARCH,
  TECHNOLOGIES,
  HOSPITAL_RECOVERY_CAP,
  type TechnologyBalance,
  type TechnologyEffectKey,
} from "./balanceConfig";
import { checkBuildingRequirements } from "./buildingRules";

export type TechnologyStatus = "locked" | "available" | "researching" | "completed";

export const TECHNOLOGY_CATALOG: Readonly<Record<string, TechnologyBalance>> = Object.fromEntries(
  TECHNOLOGIES.map((technology) => [technology.id, technology])
);

export function getTechnology(id: string): TechnologyBalance | null {
  return TECHNOLOGY_CATALOG[id] ?? null;
}

export interface ResearchQueueEntry {
  technologyId: string;
  startedAt: number;
  durationMs: number;
  costs: Partial<Record<ResourceType, number>>;
}

/** [COMPLEMENTO §4] Ranuras de investigación: 1 base + supervisores, máximo 3. Sin sistema de supervisores → 1. */
export function researchSlots(supervisors: number = 0): number {
  const extra = Number.isInteger(supervisors) && supervisors > 0 ? supervisors : 0;
  return Math.min(RESEARCH.MAX_SLOTS, RESEARCH.BASE_SLOTS + extra);
}

/** Modificadores agregados de las tecnologías completadas. Idempotente: cada tecnología cuenta una vez. */
export interface TechnologyModifiers {
  agricultureProduction: number; // multiplicador (1,05 = +5 %)
  miningProduction: number; // multiplicador aplicado a madera, piedra y hierro
  storageCapacity: number; // multiplicador
  woundedRecoveryBonus: number; // puntos porcentuales adicionales (0,05 = +5 pp)
  espionageLevel: number; // 0, 1 o 2
  trainingDuration: number; // multiplicador (0,95 = −5 %)
  constructionDuration: number; // multiplicador (0,95 = −5 %)
  happinessBase: number; // puntos
  unlockedWeapons: string[];
  unlockedArmors: string[];
}

export function computeTechnologyModifiers(completedIds: ReadonlyArray<string>): TechnologyModifiers {
  const modifiers: TechnologyModifiers = {
    agricultureProduction: 1,
    miningProduction: 1,
    storageCapacity: 1,
    woundedRecoveryBonus: 0,
    espionageLevel: 0,
    trainingDuration: 1,
    constructionDuration: 1,
    happinessBase: 0,
    unlockedWeapons: [],
    unlockedArmors: [],
  };
  const seen = new Set<string>();
  for (const id of completedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const technology = TECHNOLOGY_CATALOG[id];
    if (!technology) continue;
    const { key, value } = technology.effect;
    switch (key as TechnologyEffectKey) {
      case "agricultureProduction": modifiers.agricultureProduction *= 1 + value; break;
      case "miningProduction": modifiers.miningProduction *= 1 + value; break;
      case "storageCapacity": modifiers.storageCapacity *= 1 + value; break;
      case "woundedRecovery": modifiers.woundedRecoveryBonus = Math.min(HOSPITAL_RECOVERY_CAP, modifiers.woundedRecoveryBonus + value); break;
      case "espionageAccuracy": modifiers.espionageLevel = Math.max(modifiers.espionageLevel, value); break;
      case "trainingDuration": modifiers.trainingDuration *= 1 + value; break;
      case "constructionDuration": modifiers.constructionDuration *= 1 + value; break;
      case "happinessBase": modifiers.happinessBase += value; break;
      case "unlockWeaponSteel": modifiers.unlockedWeapons.push("acero"); break;
      case "unlockWeaponAdvancedSteel": modifiers.unlockedWeapons.push("aceroAvanzado"); break;
      case "unlockArmorSteel": modifiers.unlockedArmors.push("acero"); break;
    }
  }
  modifiers.constructionDuration = Math.max(RESEARCH.CONSTRUCTION_MIN_DURATION_RATIO, modifiers.constructionDuration);
  return modifiers;
}

export function getConstructionDurationModifier(completedIds: ReadonlyArray<string>): number {
  return computeTechnologyModifiers(completedIds).constructionDuration;
}

/** Estado de una tecnología para un reino según progreso persistido, edificios y requisitos. */
export function evaluateTechnologyStatus(input: {
  technology: TechnologyBalance;
  completedIds: ReadonlySet<string>;
  researchingIds: ReadonlySet<string>;
  buildingLevels: Readonly<Record<string, number>>;
}): { status: TechnologyStatus; blockers: string[] } {
  const { technology, completedIds, researchingIds, buildingLevels } = input;
  if (completedIds.has(technology.id)) return { status: "completed", blockers: [] };
  if (researchingIds.has(technology.id)) return { status: "researching", blockers: [] };
  const blockers: string[] = [];
  if ((buildingLevels.universidad ?? 0) < technology.universityLevel) {
    blockers.push(`Universidad nivel ${technology.universityLevel}`);
  }
  const requirementCheck = checkBuildingRequirements(technology.buildingRequirements, buildingLevels);
  if (!requirementCheck.satisfied) blockers.push(requirementCheck.error);
  for (const requiredId of technology.technologyRequirements) {
    if (!completedIds.has(requiredId)) {
      blockers.push(`Requiere ${TECHNOLOGY_CATALOG[requiredId]?.name ?? requiredId}`);
    }
  }
  return { status: blockers.length === 0 ? "available" : "locked", blockers };
}

export interface ResearchPlan {
  technologyId: string;
  startedAt: number;
  durationMs: number;
  completesAt: number;
  costs: Partial<Record<ResourceType, number>>;
}

export function createResearchPlan(input: {
  technologyId: string;
  resources: Record<ResourceType, number>;
  completedIds: ReadonlyArray<string>;
  activeResearch: ReadonlyArray<ResearchQueueEntry>;
  buildingLevels: Readonly<Record<string, number>>;
  now: number;
  supervisors?: number;
}): { success: true; plan: ResearchPlan } | { success: false; error: string } {
  const technology = TECHNOLOGY_CATALOG[input.technologyId];
  if (!technology) return { success: false, error: `La tecnología '${input.technologyId}' no existe en el catálogo.` };
  if (!Number.isFinite(input.now) || input.now < 0) return { success: false, error: "Marca temporal inválida." };

  const completedIds = new Set(input.completedIds);
  const researchingIds = new Set(input.activeResearch.map((entry) => entry.technologyId));
  if (input.activeResearch.some((entry) =>
    !entry.technologyId || !Number.isFinite(entry.startedAt) || !Number.isFinite(entry.durationMs) || entry.durationMs <= 0
  )) {
    return { success: false, error: "La cola de investigación contiene una entrada incompleta; requiere conciliación." };
  }
  if (input.activeResearch.length >= researchSlots(input.supervisors)) {
    return { success: false, error: `No hay ranuras de investigación libres (máximo ${researchSlots(input.supervisors)}).` };
  }
  const evaluation = evaluateTechnologyStatus({ technology, completedIds, researchingIds, buildingLevels: input.buildingLevels });
  if (evaluation.status === "completed") return { success: false, error: `'${technology.name}' ya está investigada.` };
  if (evaluation.status === "researching") return { success: false, error: `'${technology.name}' ya se está investigando.` };
  if (evaluation.status === "locked") return { success: false, error: `Bloqueada: ${evaluation.blockers.join("; ")}.` };

  const costs: Partial<Record<ResourceType, number>> = {};
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    const cost = technology.costs[resource];
    const balance = input.resources[resource];
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(balance) || balance < 0) {
      return { success: false, error: `Coste o saldo inválido para '${resource}'.` };
    }
    if (cost > 0) {
      if (balance < cost) {
        return { success: false, error: `Recursos insuficientes: ${resource} requiere ${cost} y hay ${Math.floor(balance)}.` };
      }
      costs[resource] = cost;
    }
  }
  const durationMs = technology.durationSeconds * 1000;
  return {
    success: true,
    plan: { technologyId: technology.id, startedAt: input.now, durationMs, completesAt: input.now + durationMs, costs },
  };
}

export function researchProgress(entry: Pick<ResearchQueueEntry, "startedAt" | "durationMs">, serverTimeMs: number): number | null {
  if (!Number.isFinite(entry.startedAt) || !Number.isFinite(entry.durationMs) || entry.durationMs <= 0 || !Number.isFinite(serverTimeMs)) {
    return null;
  }
  return Math.max(0, Math.min(100, ((serverTimeMs - entry.startedAt) / entry.durationMs) * 100));
}

/** [COMPLEMENTO §4] Reembolso del 50 % al cancelar antes de completar. */
export function calculateResearchCancellationRefund(input: {
  entry: ResearchQueueEntry;
  serverTimeMs: number;
}): { success: true; refund: Partial<Record<ResourceType, number>> } | { success: false; error: string } {
  const progress = researchProgress(input.entry, input.serverTimeMs);
  if (progress === null) return { success: false, error: "La investigación no contiene marcas temporales válidas." };
  if (progress >= 100) return { success: false, error: "No se puede cancelar una investigación ya completada." };
  const refund: Partial<Record<ResourceType, number>> = {};
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    const paid = input.entry.costs[resource];
    if (paid === undefined) continue;
    if (!Number.isFinite(paid) || paid < 0) return { success: false, error: `El coste persistido de '${resource}' no es válido.` };
    const amount = Math.floor(paid * RESEARCH.CANCEL_REFUND_RATIO);
    if (amount > 0) refund[resource] = amount;
  }
  return { success: true, refund };
}

/** Lector de base de datos: identificadores de tecnologías completadas de un reino. */
export async function readCompletedTechnologyIds(ctx: { db: any }, kingdomId: unknown): Promise<string[]> {
  try {
    const docs: Array<{ technologyId?: string; status?: string }> = await ctx.db
      .query("technologyProgress")
      .withIndex("by_kingdom", (q: any) => q.eq("kingdomId", kingdomId))
      .collect();
    return docs
      .filter((doc) => doc.status === "completed" && typeof doc.technologyId === "string")
      .map((doc) => doc.technologyId as string);
  } catch {
    return [];
  }
}
