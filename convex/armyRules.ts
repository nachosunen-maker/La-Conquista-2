/**
 * LA CONQUISTA — REGLAS PURAS DEL EJÉRCITO Y ENTRENAMIENTO (Bloque B, D-08 a D-15)
 * Valores en balanceConfig.ts. Sin acceso a Convex.
 */
import type { ResourceType } from "./economyCalculations";
import {
  ARMORS,
  EQUIPMENT_UNLOCKS,
  MILITARY_LEVELS,
  STRATEGIES,
  TRAINING,
  UNITS,
  UNIT_TYPES,
  type ArmorTier,
  type MilitaryLevelBalance,
  type Strategy,
  type UnitType,
  type WeaponTier,
  TACTICAL_FORMATIONS,
  type TacticalFormation,
  MERCENARIES,
} from "./balanceConfig";
import { MAX_BUILDING_LEVEL, checkBuildingRequirements } from "./buildingRules";

export const VALID_UNIT_TYPES: readonly string[] = UNIT_TYPES;

export function isUnitType(value: string): value is UnitType {
  return (UNIT_TYPES as readonly string[]).includes(value);
}

export function normalizeUnitType(value: unknown): UnitType | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().trim();
  // Compatibilidad con la tabla heredada 'Armyunits' (unitType "regular").
  if (normalized === "regular") return "infanteria";
  return isUnitType(normalized) ? normalized : null;
}

export function validateMilitaryUnitInput(unitType: string, count: number): { success: boolean; error?: string } {
  if (!normalizeUnitType(unitType)) {
    return { success: false, error: `Tipo de unidad no admitido: '${unitType}'. Válidos: ${UNIT_TYPES.join(", ")}.` };
  }
  if (!Number.isInteger(count) || count < 0) {
    return { success: false, error: `Cantidad inválida: debe ser un número entero no negativo (recibido: ${count}).` };
  }
  return { success: true };
}

/** [COMPLEMENTO D-09] Colas: 1 con Cuartel ≥1, +1 por cada 3 niveles completos, máximo 4; 0 sin Cuartel. */
export function trainingQueueSlots(cuartelLevel: number): number {
  if (!Number.isInteger(cuartelLevel) || cuartelLevel < 1) return 0;
  return Math.min(TRAINING.MAX_QUEUES, TRAINING.BASE_QUEUES + Math.floor(cuartelLevel / TRAINING.LEVELS_PER_EXTRA_QUEUE));
}

export function getMilitaryLevel(level: number): MilitaryLevelBalance | null {
  return MILITARY_LEVELS.find((entry) => entry.level === level) ?? null;
}

/** Niveles militares cuyos requisitos de edificios (P23) cumple el reino. */
export function availableMilitaryLevels(buildingLevels: Readonly<Record<string, number>>): MilitaryLevelBalance[] {
  return MILITARY_LEVELS.filter((entry) => checkBuildingRequirements(entry.requirements, buildingLevels).satisfied);
}

export interface TrainingQueueEntry {
  unitType: string;
  count: number;
  level: number;
  startedAt: number;
  durationMs: number;
  costs: Partial<Record<ResourceType, number>>;
  populationReserved: number;
}

export interface TrainingPlan {
  unitType: UnitType;
  count: number;
  level: number;
  startedAt: number;
  durationMs: number;
  completesAt: number;
  costs: Partial<Record<ResourceType, number>>;
  populationReserved: number;
}

/** Coste total de un lote: coste unitario × cantidad (sin escalado por nivel: el Complemento no lo define). */
export function trainingCostsFor(unitType: UnitType, count: number): Record<ResourceType, number> {
  const unit = UNITS[unitType];
  return {
    gold: unit.costs.gold * count,
    wood: unit.costs.wood * count,
    stone: unit.costs.stone * count,
    iron: unit.costs.iron * count,
    food: unit.costs.food * count,
  };
}

/** [COMPLEMENTO §3] Duración de lote = duraciónPorUnidad × cantidad × modificador tecnológico (mínimo 50 %). */
export function trainingDurationMs(unitType: UnitType, count: number, durationModifier: number = 1): number | null {
  if (!Number.isInteger(count) || count < 1) return null;
  if (!Number.isFinite(durationModifier) || durationModifier <= 0) return null;
  const modifier = Math.max(TRAINING.MIN_DURATION_RATIO, durationModifier);
  const perUnit = UNITS[unitType].trainingSecondsPerUnit * 1000;
  return Math.ceil(perUnit * count * modifier);
}

export function createTrainingPlan(input: {
  unitType: string;
  count: number;
  level: number;
  resources: Record<ResourceType, number>;
  availableCivil: number;
  buildingLevels: Readonly<Record<string, number>>;
  activeTraining: ReadonlyArray<TrainingQueueEntry>;
  now: number;
  durationModifier?: number;
  /** [DECISIÓN 21-10-2026] Sobrecoste de la civilización para este tipo de unidad (1 = ninguno). */
  costModifier?: number;
}): { success: true; plan: TrainingPlan } | { success: false; error: string } {
  const unitType = normalizeUnitType(input.unitType);
  if (!unitType) return { success: false, error: `Tipo de unidad no admitido: '${input.unitType}'.` };
  if (!Number.isInteger(input.count) || input.count < 1) return { success: false, error: "La cantidad debe ser un entero positivo." };
  if (!Number.isFinite(input.now) || input.now < 0) return { success: false, error: "Marca temporal inválida." };
  const unit = UNITS[unitType];
  const militaryLevel = getMilitaryLevel(input.level);
  if (!militaryLevel) return { success: false, error: `Nivel militar inválido: ${input.level} (válidos 1-5, P29).` };

  if (input.activeTraining.some((entry) =>
    !entry.unitType || !Number.isInteger(entry.count) || entry.count < 1 ||
    !Number.isFinite(entry.startedAt) || !Number.isFinite(entry.durationMs) || entry.durationMs <= 0
  )) {
    return { success: false, error: "La cola de entrenamiento contiene un lote incompleto; requiere conciliación." };
  }
  const cuartelLevel = input.buildingLevels.cuartel ?? 0;
  const slots = trainingQueueSlots(cuartelLevel);
  if (slots === 0) return { success: false, error: "Se necesita un Cuartel para entrenar tropas." };
  if (input.activeTraining.length >= slots) {
    return { success: false, error: `Todas las colas de entrenamiento están ocupadas (${slots} con Cuartel nivel ${cuartelLevel}).` };
  }
  const unitRequirements = checkBuildingRequirements(unit.requirements, input.buildingLevels);
  if (!unitRequirements.satisfied) return { success: false, error: unitRequirements.error };
  const levelRequirements = checkBuildingRequirements(militaryLevel.requirements, input.buildingLevels);
  if (!levelRequirements.satisfied) {
    return { success: false, error: `Nivel ${militaryLevel.level} (${militaryLevel.name}) no disponible: ${levelRequirements.error}` };
  }

  // [MAESTRA P54 + decisión posterior] Solo población civil libre; nunca trabajadores productivos.
  const populationReserved = unit.populationPerUnit * input.count;
  if (!Number.isInteger(input.availableCivil) || input.availableCivil < 0) {
    return { success: false, error: "La reserva civil libre persistida no es válida." };
  }
  if (populationReserved > input.availableCivil) {
    return {
      success: false,
      error: `Población civil libre insuficiente: se necesitan ${populationReserved} y hay ${input.availableCivil}. Reasigna trabajadores antes de reclutar.`,
    };
  }

  const totalCosts = trainingCostsFor(unitType, input.count);
  const costModifier = Number.isFinite(input.costModifier) && (input.costModifier as number) > 0 ? (input.costModifier as number) : 1;
  const costs: Partial<Record<ResourceType, number>> = {};
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    const cost = Math.ceil(totalCosts[resource] * costModifier);
    const balance = input.resources[resource];
    if (!Number.isFinite(balance) || balance < 0) return { success: false, error: `Saldo inválido para '${resource}'.` };
    if (cost > 0) {
      if (balance < cost) {
        return { success: false, error: `Recursos insuficientes: ${resource} requiere ${cost} y hay ${Math.floor(balance)}.` };
      }
      costs[resource] = cost;
    }
  }
  const durationMs = trainingDurationMs(unitType, input.count, input.durationModifier ?? 1);
  if (durationMs === null) return { success: false, error: "No se pudo calcular la duración del entrenamiento." };

  return {
    success: true,
    plan: {
      unitType,
      count: input.count,
      level: militaryLevel.level,
      startedAt: input.now,
      durationMs,
      completesAt: input.now + durationMs,
      costs,
      populationReserved,
    },
  };
}

export function trainingProgress(entry: Pick<TrainingQueueEntry, "startedAt" | "durationMs">, serverTimeMs: number): number | null {
  if (!Number.isFinite(entry.startedAt) || !Number.isFinite(entry.durationMs) || entry.durationMs <= 0 || !Number.isFinite(serverTimeMs)) {
    return null;
  }
  return Math.max(0, Math.min(100, ((serverTimeMs - entry.startedAt) / entry.durationMs) * 100));
}

/** [COMPLEMENTO D-10] 50 % de recursos; la población reservada vuelve íntegra; un lote completado no se cancela. */
export function calculateTrainingCancellation(input: {
  entry: TrainingQueueEntry;
  serverTimeMs: number;
}): { success: true; refund: Partial<Record<ResourceType, number>>; populationReturned: number } | { success: false; error: string } {
  const progress = trainingProgress(input.entry, input.serverTimeMs);
  if (progress === null) return { success: false, error: "El lote no contiene marcas temporales válidas." };
  if (progress >= 100) return { success: false, error: "No se puede cancelar un lote ya completado." };
  if (!Number.isInteger(input.entry.populationReserved) || input.entry.populationReserved < 0) {
    return { success: false, error: "La población reservada del lote no es válida." };
  }
  const refund: Partial<Record<ResourceType, number>> = {};
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    const paid = input.entry.costs?.[resource];
    if (paid === undefined) continue;
    if (!Number.isFinite(paid) || paid < 0) return { success: false, error: `El coste persistido de '${resource}' no es válido.` };
    const amount = Math.floor(paid * TRAINING.CANCEL_REFUND_RATIO);
    if (amount > 0) refund[resource] = amount;
  }
  return { success: true, refund, populationReturned: input.entry.populationReserved };
}

/** Fusiona lotes completados en el inventario por (tipo, nivel) sin contar dos veces. */
export interface ArmyUnitRecord {
  unitType: string;
  level?: number;
  count: number;
  wounded?: number;
}

export function unitLevelOf(unit: Pick<ArmyUnitRecord, "level">): number {
  return Number.isInteger(unit.level) && (unit.level as number) >= 1 && (unit.level as number) <= 5 ? (unit.level as number) : 1;
}

export interface ArmySummary {
  totalActive: number;
  totalWounded: number;
  livingSoldiers: number; // tropa viva activa (consume raciones)
  siegeMachines: number;
  siegeOperators: number;
  byType: Record<UnitType, { active: number; wounded: number }>;
  trainingMultiplier: number; // media ponderada de P29
}

export function summarizeArmy(units: ReadonlyArray<ArmyUnitRecord>): ArmySummary {
  const byType: Record<UnitType, { active: number; wounded: number }> = {
    infanteria: { active: 0, wounded: 0 },
    arqueria: { active: 0, wounded: 0 },
    caballeria: { active: 0, wounded: 0 },
    asedio: { active: 0, wounded: 0 },
  };
  let weighted = 0;
  let totalActive = 0;
  let totalWounded = 0;
  for (const unit of units) {
    const type = normalizeUnitType(unit.unitType);
    if (!type) continue;
    const active = Number.isInteger(unit.count) && unit.count > 0 ? unit.count : 0;
    const wounded = Number.isInteger(unit.wounded) && (unit.wounded as number) > 0 ? (unit.wounded as number) : 0;
    byType[type].active += active;
    byType[type].wounded += wounded;
    totalActive += active;
    totalWounded += wounded;
    weighted += active * (getMilitaryLevel(unitLevelOf(unit))?.multiplier ?? 1);
  }
  const siegeMachines = byType.asedio.active;
  const siegeOperators = siegeMachines * UNITS.asedio.populationPerUnit;
  const livingSoldiers = totalActive - siegeMachines + siegeOperators;
  return {
    totalActive,
    totalWounded,
    livingSoldiers,
    siegeMachines,
    siegeOperators,
    byType,
    trainingMultiplier: totalActive > 0 ? weighted / totalActive : 1,
  };
}

// ----------------------------------------------------------------------------
// Equipamiento y estrategia (P30, P31, P35)
// ----------------------------------------------------------------------------
export function availableWeaponTiers(buildingLevels: Readonly<Record<string, number>>, unlockedByTechnology: ReadonlyArray<string>): WeaponTier[] {
  return EQUIPMENT_UNLOCKS.weapons
    .filter((entry) =>
      checkBuildingRequirements(entry.requirements, buildingLevels).satisfied &&
      (entry.technology === null || unlockedByTechnology.includes(entry.tier))
    )
    .map((entry) => entry.tier);
}

export function availableArmorTiers(buildingLevels: Readonly<Record<string, number>>, unlockedByTechnology: ReadonlyArray<string>): ArmorTier[] {
  return EQUIPMENT_UNLOCKS.armors
    .filter((entry) =>
      checkBuildingRequirements(entry.requirements, buildingLevels).satisfied &&
      (entry.technology === null || unlockedByTechnology.includes(entry.tier))
    )
    .map((entry) => entry.tier);
}

export function isWeaponTier(value: string): value is WeaponTier {
  return Object.hasOwn(WEAPON_KEYS, value);
}
const WEAPON_KEYS: Record<string, true> = Object.fromEntries(EQUIPMENT_UNLOCKS.weapons.map((w) => [w.tier, true]));
export function isArmorTier(value: string): value is ArmorTier {
  return Object.hasOwn(ARMORS, value);
}
export function isStrategy(value: string): value is Strategy {
  return Object.hasOwn(STRATEGIES, value);
}

export function isTacticalFormation(value: string): value is TacticalFormation {
  return Object.hasOwn(TACTICAL_FORMATIONS, value);
}

// ----------------------------------------------------------------------------
// Mercenarios por tipo (P53, decisión 21-10-2026)
// ----------------------------------------------------------------------------
export type MercenaryType = (typeof MERCENARIES.TYPES)[number];

export function getMercenaryType(id: string | null | undefined): MercenaryType | null {
  const wanted = id ?? MERCENARIES.DEFAULT_TYPE_ID;
  return MERCENARIES.TYPES.find((type) => type.id === wanted) ?? null;
}

/** Tipos contratables con el nivel de Taberna indicado (sin Taberna, ninguno). */
export function availableMercenaryTypes(tavernLevel: number): MercenaryType[] {
  return MERCENARIES.TYPES.filter((type) => tavernLevel >= type.minTavernLevel);
}

/** [DERIVADO] Fórmula de precio documentada en MERCENARIES.TYPES; sirve para auditar la tabla. */
export function derivedMercenaryPrice(unitType: UnitType, level: number): number {
  const anchor = MERCENARIES.GOLD_PER_UNIT;
  const anchorGold = UNITS[MERCENARIES.UNIT_TYPE].costs.gold;
  const anchorMultiplier = MILITARY_LEVELS.find((row) => row.level === MERCENARIES.LEVEL)?.multiplier ?? 1;
  const levelMultiplier = MILITARY_LEVELS.find((row) => row.level === level)?.multiplier ?? 1;
  const raw = anchor * (UNITS[unitType].costs.gold / anchorGold) * (levelMultiplier / anchorMultiplier);
  return Math.round(raw / 5) * 5;
}

export function validateMercenaryHire(input: {
  typeId: string | undefined;
  count: number;
  tavernLevel: number;
  activeMercenaries: number;
  gold: number;
}): { success: true; type: MercenaryType; cost: number } | { success: false; error: string } {
  if (!Number.isInteger(input.count) || input.count < 1) return { success: false, error: "La cantidad debe ser un entero positivo." };
  if (input.tavernLevel < 1) return { success: false, error: "Se necesita una Taberna para contratar mercenarios (P13, P53)." };
  const type = getMercenaryType(input.typeId);
  if (!type) return { success: false, error: `Tipo de mercenario desconocido: '${input.typeId}'.` };
  if (input.tavernLevel < type.minTavernLevel) {
    return { success: false, error: `${type.label} exige Taberna nivel ${type.minTavernLevel} (actual: ${input.tavernLevel}).` };
  }
  const maxActive = MERCENARIES.MAX_PER_TAVERN_LEVEL * input.tavernLevel;
  if (input.activeMercenaries + input.count > maxActive) {
    return { success: false, error: `La Taberna nivel ${input.tavernLevel} admite ${maxActive} mercenarios activos; hay ${input.activeMercenaries}.` };
  }
  const cost = type.goldPerUnit * input.count;
  if (input.gold < cost) {
    return { success: false, error: `Oro insuficiente: ${input.count} ${type.label} cuestan ${cost} y hay ${Math.floor(input.gold)}.` };
  }
  return { success: true, type, cost };
}

export function validateEquipmentSelection(input: {
  weaponTier: string;
  armorTier: string;
  strategy: string;
  buildingLevels: Readonly<Record<string, number>>;
  unlockedWeapons: ReadonlyArray<string>;
  unlockedArmors: ReadonlyArray<string>;
  tacticalFormation?: string;
}): { success: true; weaponTier: WeaponTier; armorTier: ArmorTier; strategy: Strategy; tacticalFormation?: TacticalFormation } | { success: false; error: string } {
  if (!isWeaponTier(input.weaponTier)) return { success: false, error: `Arma desconocida: '${input.weaponTier}'.` };
  if (!isArmorTier(input.armorTier)) return { success: false, error: `Armadura desconocida: '${input.armorTier}'.` };
  if (!isStrategy(input.strategy)) return { success: false, error: `Estrategia desconocida: '${input.strategy}'.` };
  if (input.tacticalFormation !== undefined && !isTacticalFormation(input.tacticalFormation)) {
    return { success: false, error: `Formación táctica desconocida: '${input.tacticalFormation}'. Válidas: ${Object.keys(TACTICAL_FORMATIONS).join(", ")}.` };
  }
  if (!availableWeaponTiers(input.buildingLevels, input.unlockedWeapons).includes(input.weaponTier)) {
    return { success: false, error: `El arma '${input.weaponTier}' no está desbloqueada (requiere Herrería o tecnología).` };
  }
  if (!availableArmorTiers(input.buildingLevels, input.unlockedArmors).includes(input.armorTier)) {
    return { success: false, error: `La armadura '${input.armorTier}' no está desbloqueada (requiere Herrería o tecnología).` };
  }
  return {
    success: true,
    weaponTier: input.weaponTier,
    armorTier: input.armorTier,
    strategy: input.strategy,
    tacticalFormation: input.tacticalFormation ? (input.tacticalFormation as TacticalFormation) : undefined,
  };
}

export function validateBuildingLevelMap(levels: Readonly<Record<string, number>>): boolean {
  return Object.values(levels).every((level) => Number.isInteger(level) && level >= 0 && level <= MAX_BUILDING_LEVEL);
}
