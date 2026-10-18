/**
 * LA CONQUISTA — REGLAS PURAS DE EDIFICIOS Y CONSTRUCCIÓN (Bloque A, D-01 a D-07)
 * Todos los valores numéricos proceden de balanceConfig.ts. Este módulo solo
 * contiene lógica determinista, sin acceso a Convex.
 */
import type { ResourceType } from "./economyCalculations";
import { BUILDINGS, CONSTRUCTION, INITIAL_BUILDINGS, type ProductiveJob } from "./balanceConfig";

export interface BuildingRule {
  label: string;
  role: string;
  /** Coste del nivel 1; los niveles superiores se calculan con costsForTargetLevel. */
  costs: Record<ResourceType, number> | null;
  baseDurationMs: number | null;
  residentialCapacityPerLevel: number | null;
  productiveWorkerCapacityPerLevel: number | null;
  jobType: ProductiveJob | null;
  progressionRequirements: Readonly<Record<string, number>> | null;
}

export type BuildingRules = Readonly<Record<string, BuildingRule>>;

export const BUILDING_RULES: BuildingRules = Object.fromEntries(
  Object.entries(BUILDINGS).map(([type, balance]) => [
    type,
    {
      label: balance.label,
      role: balance.role,
      costs: { ...balance.baseCosts },
      baseDurationMs: balance.baseDurationSeconds * 1000,
      residentialCapacityPerLevel: balance.residentialCapacityPerLevel,
      productiveWorkerCapacityPerLevel: balance.workerCapacityPerLevel,
      jobType: balance.jobType,
      progressionRequirements: { ...balance.requirements },
    } satisfies BuildingRule,
  ])
);

/** Parámetros que siguen sin valor oficial. Vacío desde la aprobación del 17-10-2026. */
export const BUILDING_PARAMETERS_PENDING: readonly string[] = [];

export const MAX_BUILDING_LEVEL = CONSTRUCTION.MAX_LEVEL;
export const MAX_CONCURRENT_CONSTRUCTIONS = CONSTRUCTION.MAX_CONCURRENT;
export const DURATION_INCREASE_PER_LEVEL = CONSTRUCTION.DURATION_INCREASE_PER_LEVEL;
export const COST_GROWTH_PER_LEVEL = CONSTRUCTION.COST_GROWTH_PER_LEVEL;
export const CANCEL_REFUND_RATIO = CONSTRUCTION.CANCEL_REFUND_RATIO;
export const INITIAL_BUILDING_LEVELS = INITIAL_BUILDINGS;

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

/** [MAESTRA P22] Duración del nivel n = base × (1 + 0,01)^(n−1), redondeada hacia arriba. */
export function durationForTargetLevel(
  baseDurationMs: number,
  targetLevel: number,
  durationModifier: number = 1
): number | null {
  if (
    !Number.isFinite(baseDurationMs) ||
    baseDurationMs <= 0 ||
    !Number.isInteger(targetLevel) ||
    targetLevel < 1 ||
    targetLevel > MAX_BUILDING_LEVEL ||
    !Number.isFinite(durationModifier) ||
    durationModifier <= 0
  ) {
    return null;
  }
  return Math.ceil(baseDurationMs * (1 + DURATION_INCREASE_PER_LEVEL) ** (targetLevel - 1) * durationModifier);
}

/** [COMPLEMENTO D-02] coste(n) = redondear(base × 1,15^(n−1)). */
export function costsForTargetLevel(
  baseCosts: Record<ResourceType, number>,
  targetLevel: number
): Record<ResourceType, number> | null {
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > MAX_BUILDING_LEVEL) return null;
  const multiplier = (1 + COST_GROWTH_PER_LEVEL) ** (targetLevel - 1);
  const result = {} as Record<ResourceType, number>;
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    const base = baseCosts[resource];
    if (typeof base !== "number" || !Number.isFinite(base) || base < 0) return null;
    result[resource] = Math.round(base * multiplier);
  }
  return result;
}

function levelsByType(buildings: ReadonlyArray<{ buildingType: string; level: number }>): Record<string, number> | null {
  const levels: Record<string, number> = {};
  for (const building of buildings) {
    if (
      !building.buildingType.trim() ||
      !Number.isInteger(building.level) ||
      building.level < 1 ||
      building.level > MAX_BUILDING_LEVEL ||
      Object.hasOwn(levels, building.buildingType)
    ) {
      return null;
    }
    levels[building.buildingType] = building.level;
  }
  return levels;
}

/** [COMPLEMENTO D-03/D-47] Capacidad lineal: capacidadBase × nivel, sumando edificios del mismo oficio. */
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

/** Capacidad de trabajadores por oficio productivo sumando todos los edificios completados que lo habilitan. */
export function calculateJobCapacities(
  buildings: ReadonlyArray<{ buildingType: string; level: number }>
): Record<ProductiveJob, number> | null {
  const capacities: Record<ProductiveJob, number> = { agriculture: 0, wood: 0, stone: 0, iron: 0, gold: 0 };
  for (const building of buildings) {
    const rule = BUILDING_RULES[building.buildingType];
    if (!rule) continue; // Edificios desconocidos no aportan capacidad.
    if (!Number.isInteger(building.level) || building.level < 1 || building.level > MAX_BUILDING_LEVEL) return null;
    if (rule.jobType && rule.productiveWorkerCapacityPerLevel) {
      capacities[rule.jobType] += rule.productiveWorkerCapacityPerLevel * building.level;
    }
  }
  return capacities;
}

/** [COMPLEMENTO D-03] Capacidad residencial = suma de viviendas completadas × capacidad por nivel. */
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

/** Nivel de un edificio en una colección (0 si no existe). */
export function getBuildingLevel(
  buildings: ReadonlyArray<{ buildingType: string; level: number }>,
  buildingType: string
): number {
  return buildings.find((building) => building.buildingType === buildingType)?.level ?? 0;
}

/** Comprueba requisitos edificio → nivel mínimo contra los niveles persistidos. */
export function checkBuildingRequirements(
  requirements: Readonly<Record<string, number>>,
  buildingLevels: Readonly<Record<string, number>>
): { satisfied: true } | { satisfied: false; error: string } {
  for (const [requiredType, requiredLevel] of Object.entries(requirements)) {
    if (!requiredType.trim() || !Number.isInteger(requiredLevel) || requiredLevel < 1 || requiredLevel > MAX_BUILDING_LEVEL) {
      return { satisfied: false, error: `El requisito de progresión para '${requiredType}' no es válido.` };
    }
    if ((buildingLevels[requiredType] ?? 0) < requiredLevel) {
      const label = BUILDING_RULES[requiredType]?.label ?? requiredType;
      return { satisfied: false, error: `Requisito incumplido: '${label}' debe alcanzar el nivel ${requiredLevel}.` };
    }
  }
  return { satisfied: true };
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
  /** Multiplicador de duración por tecnologías (p. ej. 0,95); nunca por debajo del mínimo configurado. */
  durationModifier?: number;
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
  const requirementCheck = checkBuildingRequirements(input.rule.progressionRequirements, input.buildingLevels);
  if (!requirementCheck.satisfied) {
    return { success: false, error: requirementCheck.error };
  }

  const targetLevel = input.currentLevel + 1;

  // [COMPLEMENTO D-05] Ningún edificio supera el nivel del Castillo (el propio Castillo queda exento).
  if (CONSTRUCTION.CASTLE_CAPS_LEVELS && input.buildingType !== "castillo") {
    const castleLevel = input.buildingLevels.castillo ?? 0;
    if (targetLevel > castleLevel) {
      return {
        success: false,
        error: `El Castillo (nivel ${castleLevel}) limita la progresión: '${input.rule.label}' no puede superar su nivel.`,
      };
    }
  }

  const scaledCosts = costsForTargetLevel(input.rule.costs, targetLevel);
  if (!scaledCosts) {
    return { success: false, error: "No se pudo calcular el coste escalado del nivel objetivo." };
  }
  const costs: Partial<Record<ResourceType, number>> = {};
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    const cost = scaledCosts[resource];
    const balance = input.resources[resource];
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(balance) || balance < 0) {
      return { success: false, error: `Coste o saldo inválido para '${resource}'.` };
    }
    if (cost > 0) {
      if (balance < cost) {
        return { success: false, error: `Recursos insuficientes: ${resource} requiere ${cost} y hay ${Math.floor(balance)}.` };
      }
      costs[resource] = cost;
    }
  }

  const durationMs = durationForTargetLevel(input.rule.baseDurationMs ?? NaN, targetLevel, input.durationModifier ?? 1);
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

/** [COMPLEMENTO D-04] Reembolso fijo del 50 % de lo pagado, independiente del tiempo restante. */
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
    const paid = input.construction.costs[resource];
    if (paid === undefined) continue;
    if (typeof paid !== "number" || !Number.isFinite(paid) || paid < 0) {
      return { success: false, error: `El coste persistido de '${resource}' no es válido.` };
    }
    const amount = Math.floor(paid * CANCEL_REFUND_RATIO);
    if (amount > 0) refund[resource] = amount;
  }
  return { success: true, refund };
}

/** Catálogo serializable para la interfaz: coste y duración del siguiente nivel de cada edificio. */
export function describeCatalogForLevels(
  buildingLevels: Readonly<Record<string, number>>,
  durationModifier: number = 1
): Record<string, {
  label: string;
  role: string;
  currentLevel: number;
  nextLevel: number | null;
  nextCosts: Record<ResourceType, number> | null;
  nextDurationMs: number | null;
  requirements: Readonly<Record<string, number>>;
  requirementsSatisfied: boolean;
  castleCapSatisfied: boolean;
  residentialCapacityPerLevel: number;
  workerCapacityPerLevel: number;
  jobType: ProductiveJob | null;
}> {
  const result: ReturnType<typeof describeCatalogForLevels> = {};
  for (const [type, rule] of Object.entries(BUILDING_RULES)) {
    const currentLevel = buildingLevels[type] ?? 0;
    const nextLevel = currentLevel < MAX_BUILDING_LEVEL ? currentLevel + 1 : null;
    const requirementsSatisfied = rule.progressionRequirements
      ? checkBuildingRequirements(rule.progressionRequirements, buildingLevels).satisfied
      : false;
    const castleCapSatisfied = type === "castillo" || !CONSTRUCTION.CASTLE_CAPS_LEVELS
      ? true
      : nextLevel !== null && nextLevel <= (buildingLevels.castillo ?? 0);
    result[type] = {
      label: rule.label,
      role: rule.role,
      currentLevel,
      nextLevel,
      nextCosts: nextLevel !== null && rule.costs ? costsForTargetLevel(rule.costs, nextLevel) : null,
      nextDurationMs: nextLevel !== null && rule.baseDurationMs ? durationForTargetLevel(rule.baseDurationMs, nextLevel, durationModifier) : null,
      requirements: rule.progressionRequirements ?? {},
      requirementsSatisfied,
      castleCapSatisfied,
      residentialCapacityPerLevel: rule.residentialCapacityPerLevel ?? 0,
      workerCapacityPerLevel: rule.productiveWorkerCapacityPerLevel ?? 0,
      jobType: rule.jobType,
    };
  }
  return result;
}

/** Valida que una colección de edificios persistidos sea coherente (sin duplicados ni niveles inválidos). */
export function validateBuildingCollection(
  buildings: ReadonlyArray<{ buildingType: string; level: number }>
): { success: true; levels: Record<string, number> } | { success: false; error: string } {
  const levels = levelsByType(buildings);
  if (!levels) {
    return { success: false, error: "Los edificios persistidos contienen niveles inválidos o tipos duplicados; se requiere conciliación." };
  }
  return { success: true, levels };
}
