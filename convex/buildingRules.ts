import type { ResourceType } from "./economyCalculations";

export interface BuildingRule {
  label: string;
  costs: Record<ResourceType, number> | null;
  baseDurationMs: number | null;
  residentialCapacityPerLevel: number | null;
  productiveWorkerCapacityPerLevel: number | null;
  progressionRequirements: Readonly<Record<string, number>> | null;
}

export type BuildingRules = Readonly<Record<string, BuildingRule>>;

export const BUILDING_RULES: BuildingRules = {
  castillo: { label: "Castillo", costs: null, baseDurationMs: null, residentialCapacityPerLevel: null, productiveWorkerCapacityPerLevel: null, progressionRequirements: null },
  granja: { label: "Granja", costs: null, baseDurationMs: null, residentialCapacityPerLevel: null, productiveWorkerCapacityPerLevel: null, progressionRequirements: null },
  aserradero: { label: "Aserradero", costs: null, baseDurationMs: null, residentialCapacityPerLevel: null, productiveWorkerCapacityPerLevel: null, progressionRequirements: null },
  cantera: { label: "Cantera", costs: null, baseDurationMs: null, residentialCapacityPerLevel: null, productiveWorkerCapacityPerLevel: null, progressionRequirements: null },
  minaHierro: { label: "Mina de hierro", costs: null, baseDurationMs: null, residentialCapacityPerLevel: null, productiveWorkerCapacityPerLevel: null, progressionRequirements: null },
  viviendas: { label: "Viviendas", costs: null, baseDurationMs: null, residentialCapacityPerLevel: null, productiveWorkerCapacityPerLevel: null, progressionRequirements: null },
  murallas: { label: "Murallas", costs: null, baseDurationMs: null, residentialCapacityPerLevel: null, productiveWorkerCapacityPerLevel: null, progressionRequirements: null },
  cuartel: { label: "Cuartel", costs: null, baseDurationMs: null, residentialCapacityPerLevel: null, productiveWorkerCapacityPerLevel: null, progressionRequirements: null },
  universidad: { label: "Universidad", costs: null, baseDurationMs: null, residentialCapacityPerLevel: null, productiveWorkerCapacityPerLevel: null, progressionRequirements: null },
  parlamento: { label: "Parlamento", costs: null, baseDurationMs: null, residentialCapacityPerLevel: null, productiveWorkerCapacityPerLevel: null, progressionRequirements: null },
  mercado: { label: "Mercado", costs: null, baseDurationMs: null, residentialCapacityPerLevel: null, productiveWorkerCapacityPerLevel: null, progressionRequirements: null },
};
export const BUILDING_PARAMETERS_PENDING = [
  "construction costs",
  "base construction durations",
  "residential capacity per building level",
  "productive building and worker-job mappings",
  "production rates beyond the separately approved agriculture rule",
] as const;
export const MAX_BUILDING_LEVEL = 100;
export const MAX_CONCURRENT_CONSTRUCTIONS = 2;
export const DURATION_INCREASE_PER_LEVEL = 0.01;

export interface ConstructionQueueEntry {
  buildingType: string;
  targetLevel: number;
  startedAt: number;
  durationMs: number;
  costs: Partial<Record<ResourceType, number>>;
}

export interface ConstructionPlan {
  targetLevel: number;
  startedAt: number;
  durationMs: number;
  completesAt: number;
  costs: Partial<Record<ResourceType, number>>;
}

export function durationForTargetLevel(baseDurationMs: number, targetLevel: number): number | null {
  if (
    !Number.isFinite(baseDurationMs) ||
    baseDurationMs <= 0 ||
    !Number.isInteger(targetLevel) ||
    targetLevel < 1 ||
    targetLevel > MAX_BUILDING_LEVEL
  ) {
    return null;
  }
  return Math.ceil(baseDurationMs * (1 + DURATION_INCREASE_PER_LEVEL) ** (targetLevel - 1));
}

export function calculateBuildingWorkerCapacity(
  buildings: ReadonlyArray<{ buildingType: string; level: number }>,
  buildingType: string
): number | null {
  const capacityPerLevel = BUILDING_RULES[buildingType]?.productiveWorkerCapacityPerLevel;
  if (capacityPerLevel === null || capacityPerLevel === undefined || !Number.isFinite(capacityPerLevel) || capacityPerLevel < 0) {
    return null;
  }
  const matching = buildings.filter((building) => building.buildingType === buildingType);
  if (matching.some((building) => !Number.isInteger(building.level) || building.level < 1 || building.level > MAX_BUILDING_LEVEL)) {
    return null;
  }
  return matching.reduce((total, building) => total + building.level * capacityPerLevel, 0);
}

export function calculateResidentialCapacity(
  buildings: ReadonlyArray<{ buildingType: string; level: number }>
): number | null {
  const capacityPerLevel = BUILDING_RULES.viviendas?.residentialCapacityPerLevel;
  if (capacityPerLevel === null || capacityPerLevel === undefined || !Number.isFinite(capacityPerLevel) || capacityPerLevel < 0) {
    return null;
  }
  const residences = buildings.filter((building) => building.buildingType === "viviendas");
  if (residences.some((building) => !Number.isInteger(building.level) || building.level < 1 || building.level > MAX_BUILDING_LEVEL)) {
    return null;
  }
  return residences.reduce((total, building) => total + building.level * capacityPerLevel, 0);
}

export function validateConstructionCompletion(input: {
  buildingType: string;
  targetLevel: number;
  existingLevels: number[];
}): { success: true; action: "insert" | "upgrade" } | { success: false; error: string } {
  if (!input.buildingType.trim() || !Number.isInteger(input.targetLevel) ||
    input.targetLevel < 1 || input.targetLevel > MAX_BUILDING_LEVEL) {
    return { success: false, error: "El destino de la construcción no es válido." };
  }
  if (input.existingLevels.length > 1) {
    return { success: false, error: `Hay registros duplicados del edificio '${input.buildingType}'.` };
  }
  if (input.existingLevels.length === 0) {
    return input.targetLevel === 1
      ? { success: true, action: "insert" }
      : { success: false, error: "No existe el edificio base necesario para completar esta mejora." };
  }
  const currentLevel = input.existingLevels[0];
  if (!Number.isInteger(currentLevel) || currentLevel < 1 || currentLevel >= MAX_BUILDING_LEVEL ||
    currentLevel + 1 !== input.targetLevel) {
    return { success: false, error: "El nivel actual ya no coincide con el objetivo de la construcción." };
  }
  return { success: true, action: "upgrade" };
}

export function createConstructionPlan(input: {
  buildingType: string;
  currentLevel: number;
  resources: Record<ResourceType, number>;
  activeConstructions: ConstructionQueueEntry[];
  buildingLevels: Readonly<Record<string, number>>;
  now: number;
  rule?: BuildingRule;
}): { success: true; plan: ConstructionPlan } | { success: false; error: string } {
  if (!input.buildingType.trim()) {
    return { success: false, error: "El tipo de edificio es obligatorio." };
  }
  if (!Number.isInteger(input.currentLevel) || input.currentLevel < 0 || input.currentLevel > MAX_BUILDING_LEVEL) {
    return { success: false, error: "El nivel persistido del edificio no es válido." };
  }
  if (input.currentLevel >= MAX_BUILDING_LEVEL) {
    return { success: false, error: `El nivel máximo permitido es ${MAX_BUILDING_LEVEL}.` };
  }
  if (input.activeConstructions.length >= MAX_CONCURRENT_CONSTRUCTIONS) {
    return { success: false, error: "Las dos ranuras de construcción ya están ocupadas." };
  }
  if (input.activeConstructions.some((item) => item.buildingType === input.buildingType)) {
    return { success: false, error: "Este edificio ya tiene una construcción en curso." };
  }
  if (input.activeConstructions.some((item) =>
    !Number.isInteger(item.targetLevel) ||
    item.targetLevel < 1 ||
    item.targetLevel > MAX_BUILDING_LEVEL ||
    !Number.isFinite(item.startedAt) ||
    !Number.isFinite(item.durationMs) ||
    item.durationMs <= 0 ||
    !item.buildingType
  )) {
    return { success: false, error: "La cola contiene una construcción heredada incompleta; requiere conciliación." };
  }
  if (!input.rule) {
    return { success: false, error: `El edificio '${input.buildingType}' no pertenece al catálogo configurado.` };
  }
  if (!input.rule.costs) {
    return { success: false, error: `Costes de '${input.buildingType}' pendientes de especificación oficial.` };
  }
  if (input.rule.progressionRequirements === null) {
    return { success: false, error: `Requisitos de progresión de '${input.buildingType}' pendientes de especificación oficial.` };
  }
  for (const [requiredType, requiredLevel] of Object.entries(input.rule.progressionRequirements)) {
    if (
      !requiredType.trim() ||
      !Number.isInteger(requiredLevel) ||
      requiredLevel < 1 ||
      requiredLevel > MAX_BUILDING_LEVEL
    ) {
      return { success: false, error: `El requisito de progresión para '${requiredType}' no es válido.` };
    }
    if ((input.buildingLevels[requiredType] ?? 0) < requiredLevel) {
      return {
        success: false,
        error: `Requisito incumplido: '${requiredType}' debe alcanzar el nivel ${requiredLevel}.`,
      };
    }
  }

  const costs: Partial<Record<ResourceType, number>> = {};
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    const cost = input.rule.costs[resource];
    const balance = input.resources[resource];
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(balance) || balance < 0) {
      return { success: false, error: `Coste o saldo inválido para '${resource}'.` };
    }
    if (cost > 0) {
      if (balance < cost) {
        return { success: false, error: `Recursos insuficientes: ${resource} requiere ${cost} y hay ${balance}.` };
      }
      costs[resource] = cost;
    }
  }

  const targetLevel = input.currentLevel + 1;
  const durationMs = durationForTargetLevel(input.rule.baseDurationMs ?? NaN, targetLevel);
  if (durationMs === null) {
    return { success: false, error: "La duración base de este edificio está pendiente o no es válida." };
  }
  const completesAt = input.now + durationMs;
  if (!Number.isFinite(input.now) || !Number.isFinite(completesAt) || completesAt <= input.now) {
    return { success: false, error: "La fecha de finalización calculada no es válida." };
  }

  return {
    success: true,
    plan: {
      targetLevel,
      startedAt: input.now,
      durationMs,
      completesAt,
      costs,
    },
  };
}

export function constructionProgress(
  construction: Pick<ConstructionQueueEntry, "startedAt" | "durationMs">,
  serverTimeMs: number
): number | null {
  if (
    !Number.isFinite(construction.startedAt) ||
    !Number.isFinite(construction.durationMs) ||
    construction.durationMs <= 0 ||
    !Number.isFinite(serverTimeMs)
  ) {
    return null;
  }
  return Math.max(0, Math.min(100, ((serverTimeMs - construction.startedAt) / construction.durationMs) * 100));
}

export function isConstructionDue(
  construction: Pick<ConstructionQueueEntry, "startedAt" | "durationMs">,
  serverTimeMs: number
): boolean {
  return constructionProgress(construction, serverTimeMs) === 100;
}

export function calculateConstructionCancellationRefund(input: {
  construction: ConstructionQueueEntry;
  serverTimeMs: number;
}): { success: true; refund: Partial<Record<ResourceType, number>> } | { success: false; error: string } {
  if (!input.construction.costs || typeof input.construction.costs !== "object") {
    return { success: false, error: "La construcción no contiene el coste persistido necesario para calcular el reembolso." };
  }
  const progress = constructionProgress(input.construction, input.serverTimeMs);
  if (progress === null) {
    return { success: false, error: "La construcción no contiene marcas temporales válidas." };
  }
  if (input.serverTimeMs < input.construction.startedAt) {
    return { success: false, error: "No se pueden cancelar construcciones que aún no han comenzado." };
  }
  if (progress >= 100) {
    return { success: false, error: "No se pueden cancelar construcciones ya finalizadas." };
  }

  const refund: Partial<Record<ResourceType, number>> = {};
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    const spent = input.construction.costs[resource] ?? 0;
    if (!Number.isFinite(spent) || spent < 0) {
      return { success: false, error: `El coste registrado para '${resource}' no es válido.` };
    }
    if (spent > 0) refund[resource] = spent * 0.5;
  }
  return { success: true, refund };
}
