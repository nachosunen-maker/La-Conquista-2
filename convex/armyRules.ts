/**
 * LA CONQUISTA — REGLAS PURAS DEL EJÉRCITO Y ENTRENAMIENTO (Bloque B, D-08 a D-15)
 * Valores en balanceConfig.ts. Sin acceso a Convex.
 */
import type { ResourceCosts } from "./balanceConfig";
import type { ResourceType } from "./economyCalculations";
import {
  ARMORS,
  EQUIPMENT_UNLOCKS,
  MILITARY_LEVELS,
  REGULAR_UNIT_TYPES,
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
  type MercenaryType,
  resourceNameSpanish,
} from "./balanceConfig";
import { MAX_BUILDING_LEVEL, checkBuildingRequirements } from "./buildingRules";
import { normalizeCivilizationId } from "./civilizationRules";

export const VALID_UNIT_TYPES: readonly string[] = REGULAR_UNIT_TYPES;

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

export function isSiegeUnit(unitType: UnitType): boolean {
  return unitType === "asedio" || (Boolean(UNITS[unitType]) && !UNITS[unitType].isLivingTroop);
}

export function getUnitCategory(unitType: UnitType): "infanteria" | "arqueria" | "caballeria" | "asedio" {
  if (unitType === "infanteria") return "infanteria";
  if (unitType === "arqueria") return "arqueria";
  if (unitType === "caballeria") return "caballeria";
  return "asedio";
}

/** Criterio único y canónico para identificar unidades espía en todo el backend (Paquete C). */
export function isSpyUnitDoc(unit: { unitType?: string | null; isSpy?: boolean } | null | undefined): boolean {
  if (!unit) return false;
  return Boolean(unit.isSpy) || normalizeUnitType(unit.unitType ?? "") === "espia";
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

export function unitBuildingRequirements(unitType: UnitType, civilization?: string | null): Readonly<Record<string, number>> {
  const normCiv = normalizeCivilizationId(civilization);
  if (unitType === "caballeria" && normCiv === "mongoles") {
    // [FASE 4] Los mongoles desbloquean la caballería exclusivamente con Cuartel Nivel 2 (sin exigir Establo ni Herrería)
    return { cuartel: 2 };
  }
  return UNITS[unitType].requirements;
}

export function validateGlobalArmyUpgrade(input: {
  currentLevel: number;
  targetLevel: number;
  buildingLevels: Readonly<Record<string, number>>;
  resources: Readonly<Record<ResourceType, number>>;
}): { success: true; levelInfo: MilitaryLevelBalance; costs: ResourceCosts } | { success: false; error: string } {
  const { currentLevel, targetLevel, buildingLevels, resources } = input;
  if (!Number.isInteger(targetLevel) || targetLevel < 2 || targetLevel > 5) {
    return { success: false, error: `Nivel militar objetivo inválido: ${targetLevel}. Rango permitido: 2-5.` };
  }
  if (targetLevel !== currentLevel + 1) {
    return { success: false, error: `El ascenso militar debe realizarse nivel a nivel (nivel actual: ${currentLevel}, nivel solicitado: ${targetLevel}).` };
  }
  const levelInfo = getMilitaryLevel(targetLevel);
  if (!levelInfo) return { success: false, error: `Definición no encontrada para nivel militar ${targetLevel}.` };

  const reqCheck = checkBuildingRequirements(levelInfo.requirements, buildingLevels);
  if (!reqCheck.satisfied) {
    return { success: false, error: `Requisitos de edificios no cumplidos para nivel ${targetLevel} (${levelInfo.name}): ${reqCheck.error}` };
  }

  for (const [res, cost] of Object.entries(levelInfo.costs) as [ResourceType, number][]) {
    if (cost > 0 && (resources[res] ?? 0) < cost) {
      return { success: false, error: `Recursos insuficientes para ascender al nivel ${targetLevel}: requiere ${cost} de ${resourceNameSpanish(res)} y hay ${Math.floor(resources[res] ?? 0)}.` };
    }
  }

  return { success: true, levelInfo, costs: levelInfo.costs };
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
  civilization?: string | null;
}): { success: true; plan: TrainingPlan } | { success: false; error: string } {
  const unitType = normalizeUnitType(input.unitType);
  if (!unitType) return { success: false, error: `Tipo de unidad no admitido: '${input.unitType}'.` };
  if (unitType === "espia") {
    return {
      success: false,
      error: "Los espías no se reclutan en formación militar ordinaria; utiliza la sección de Espionaje ('Instrucción de Agentes').",
    };
  }
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

  const reqs = unitBuildingRequirements(unitType, input.civilization);
  const unitRequirements = checkBuildingRequirements(reqs, input.buildingLevels);
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
        return { success: false, error: `Recursos insuficientes: ${resourceNameSpanish(resource)} requiere ${cost} y hay ${Math.floor(balance)}.` };
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

/** Plan exclusivo para reclutar espías desde 'Instrucción de Agentes' (incluye activos, ocupados en misión y en cola). */
export function createSpyRecruitmentPlan(input: {
  count: number;
  resources: Record<ResourceType, number>;
  availableCivil: number;
  buildingLevels: Readonly<Record<string, number>>;
  activeTraining: ReadonlyArray<TrainingQueueEntry>;
  activeSpies: number;
  woundedSpies?: number;
  busySpies: number;
  inQueueSpies: number;
  now: number;
  durationModifier?: number;
}): { success: true; plan: TrainingPlan; capacity: number; occupied: number } | { success: false; error: string } {
  if (!Number.isInteger(input.count) || input.count < 1) {
    return { success: false, error: "La cantidad de espías debe ser un entero positivo." };
  }
  if (!Number.isFinite(input.now) || input.now < 0) {
    return { success: false, error: "Marca temporal inválida." };
  }
  if (input.activeTraining.some((entry) =>
    !entry.unitType || !Number.isInteger(entry.count) || entry.count < 1 ||
    !Number.isFinite(entry.startedAt) || !Number.isFinite(entry.durationMs) || entry.durationMs <= 0
  )) {
    return { success: false, error: "La cola de entrenamiento contiene un lote incompleto; requiere conciliación." };
  }
  const cuartelLevel = input.buildingLevels.cuartel ?? 0;
  const reqCheck = checkBuildingRequirements(UNITS.espia.requirements, input.buildingLevels);
  if (!reqCheck.satisfied) {
    return { success: false, error: `Los espías requieren Cuartel nivel ${UNITS.espia.requirements.cuartel ?? 2}: ${reqCheck.error}` };
  }
  const slots = trainingQueueSlots(cuartelLevel);
  if (slots === 0 || input.activeTraining.length >= slots) {
    return { success: false, error: `Todas las colas de entrenamiento están ocupadas (${slots} con Cuartel nivel ${cuartelLevel}).` };
  }

  const capacity = Math.floor(cuartelLevel / 2);
  const woundedSpies = Math.max(0, input.woundedSpies ?? 0);
  const occupied = Math.max(0, input.activeSpies) + woundedSpies + Math.max(0, input.busySpies) + Math.max(0, input.inQueueSpies);
  if (occupied + input.count > capacity) {
    return {
      success: false,
      error: `Capacidad de espías excedida (capacidad: ${capacity}, activos: ${input.activeSpies}, heridos: ${woundedSpies}, en misión: ${input.busySpies}, en cola: ${input.inQueueSpies}, solicitado: ${input.count}).`,
    };
  }

  const populationReserved = UNITS.espia.populationPerUnit * input.count;
  if (!Number.isInteger(input.availableCivil) || input.availableCivil < 0) {
    return { success: false, error: "La reserva civil libre persistida no es válida." };
  }
  if (populationReserved > input.availableCivil) {
    return {
      success: false,
      error: `Población civil libre insuficiente: se necesitan ${populationReserved} y hay ${input.availableCivil}. Reasigna trabajadores antes de instruir espías.`,
    };
  }

  const totalCosts = trainingCostsFor("espia", input.count);
  const costs: Partial<Record<ResourceType, number>> = {};
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    const cost = totalCosts[resource];
    const balance = input.resources[resource];
    if (!Number.isFinite(balance) || balance < 0) return { success: false, error: `Saldo inválido para '${resource}'.` };
    if (cost > 0) {
      if (balance < cost) {
        return { success: false, error: `Recursos insuficientes: ${resourceNameSpanish(resource)} requiere ${cost} y hay ${Math.floor(balance)}.` };
      }
      costs[resource] = cost;
    }
  }

  const durationMs = trainingDurationMs("espia", input.count, input.durationModifier ?? 1);
  if (durationMs === null) return { success: false, error: "No se pudo calcular la duración de la instrucción de agentes." };

  return {
    success: true,
    capacity,
    occupied,
    plan: {
      unitType: "espia",
      count: input.count,
      level: 1,
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
    onagro_campana: { active: 0, wounded: 0 },
    carrobalista: { active: 0, wounded: 0 },
    espringarda_movil: { active: 0, wounded: 0 },
    trabuchet_traccion: { active: 0, wounded: 0 },
    arcuballista: { active: 0, wounded: 0 },
    fustibalo_campo: { active: 0, wounded: 0 },
    mangonel_tactico: { active: 0, wounded: 0 },
    carros_artillados: { active: 0, wounded: 0 },
    ariete_movil: { active: 0, wounded: 0 },
    torres_asalto: { active: 0, wounded: 0 },
    espia: { active: 0, wounded: 0 },
  };
  let weighted = 0;
  let totalActive = 0;
  let totalWounded = 0;
  let siegeMachines = 0;
  let siegeOperators = 0;
  for (const unit of units) {
    const active = Number.isInteger(unit.count) && unit.count > 0 ? unit.count : 0;
    const wounded = Number.isInteger(unit.wounded) && (unit.wounded as number) > 0 ? (unit.wounded as number) : 0;
    if (isSpyUnitDoc(unit)) {
      byType.espia.active += active;
      byType.espia.wounded += wounded;
      continue;
    }
    const type = normalizeUnitType(unit.unitType);
    if (!type) continue;
    byType[type].active += active;
    byType[type].wounded += wounded;
    totalActive += active;
    totalWounded += wounded;
    weighted += active * (getMilitaryLevel(unitLevelOf(unit))?.multiplier ?? 1);
    if (!UNITS[type].isLivingTroop) {
      siegeMachines += active;
      siegeOperators += active * UNITS[type].populationPerUnit;
    }
  }
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
const LEGACY_MERCENARY_IDS: Record<string, string> = {
  mesnada: "mesnada_sueldo",
  lanzonas_mesnada: "mesnada_sueldo",
  lanceros: "lanceros_sueldo",
  arqueros: "arqueros_fortuna",
  ballesteros_genoveses: "arqueros_fortuna",
  stradioti: "jinetes_fortuna",
  jinetes: "jinetes_fortuna",
  veteranos: "compania_veterana",
  almogavares: "compania_veterana",
  piqueros_suizos: "compania_veterana",
  guardia: "guardia_mercenaria",
  condottieri: "guardia_mercenaria",
  longbowmen_blanca: "arqueros_fortuna",
  landsknechte: "compania_veterana",
};

export function getMercenaryType(id: string | null | undefined): MercenaryType | null {
  if (id === null || id === undefined) {
    return MERCENARIES.TYPES.find((type) => type.id === MERCENARIES.DEFAULT_TYPE_ID) ?? null;
  }
  const raw = id.trim();
  if (!raw) return null;
  const wanted = LEGACY_MERCENARY_IDS[raw] ?? raw;
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
  mercenaryCostReduction?: number;
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
  const costBase = type.goldPerUnit * input.count;
  const cost = Math.max(0, Math.floor(costBase * (1 - (input.mercenaryCostReduction ?? 0))));
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

/**
 * ============================================================================
 * RECONCILIACIÓN DETERMINISTA DE INVENTARIO HEREDADO ('Armyunits') Y CANÓNICO ('armyUnits')
 * ============================================================================
 * Reglas de seguridad:
 * 1. Una marca `migrated: true` por sí sola NUNCA justifica eliminar ni omitir un registro antiguo.
 *    Un documento heredado L solo se considera representado en 'armyUnits' cuando existe un
 *    documento canónico verificable C del MISMO reino con correspondencia explícita:
 *    - C.migratedFromLegacyId === String(L._id)
 *    - C.migratedFromLegacyIds contiene String(L._id)
 *    - L.canonicalId o L.migratedToId coincide con String(C._id) de un documento existente del mismo reino.
 * 2. Nunca se descarta ni fusiona arbitrariamente un documento heredado por simple coincidencia
 *    de (unitType, level), ya que pueden existir registros legítimos independientes. Si coexiste
 *    un canónico del mismo tipo/nivel sin vínculo de procedencia, el documento heredado se
 *    migra preservando todos sus atributos y marcado con `migrationAmbiguous: true`.
 * 3. Clasificación obligatoria en tres estados para registros heredados:
 *    - `empty`: sin unidades válidas (`count <= 0 && wounded <= 0`), único caso elegible para borrado.
 *    - `valid`: tipo reconocido y normalizable; se migra preservando todos sus atributos.
 *    - `unrecognized`: contiene unidades/datos pero su tipo no es reconocible con seguridad; se
 *      conserva intacto en cuarentena sin convertirlo en infantería ni en espía, sin borrarlo y
 *      sin contabilizarlo en cálculos militares ni de espionaje.
 */
export interface RawArmyUnitDoc {
  _id?: unknown;
  _creationTime?: number;
  kingdomId?: unknown;
  unitType?: string | null;
  level?: number;
  count?: number;
  wounded?: number;
  recoveryProgress?: number;
  isMercenary?: boolean;
  mercenaryTypeId?: string;
  contractEndsAt?: number;
  isSpy?: boolean;
  migratedFromLegacyId?: string;
  migratedFromLegacyIds?: string[];
  migrationAmbiguous?: boolean;
  migrated?: boolean;
  migratedToId?: unknown;
  canonicalId?: unknown;
  legacy?: boolean;
}

export interface NormalizedLegacyPayload {
  unitType: UnitType;
  level: number;
  count: number;
  isSpy: boolean;
  wounded?: number;
  recoveryProgress?: number;
  isMercenary?: boolean;
  mercenaryTypeId?: string;
  contractEndsAt?: number;
}

export type LegacyDocClassification =
  | { status: "empty" }
  | { status: "valid"; payload: NormalizedLegacyPayload }
  | { status: "unrecognized"; rawUnitType: string | null; reason: string };

export type LegacyMigrationAction =
  | { kind: "delete_duplicate_legacy"; legacyId: unknown; matchedCanonicalId?: unknown }
  | { kind: "delete_empty_legacy"; legacyId: unknown }
  | {
      kind: "quarantine_unrecognized_legacy";
      legacyId: unknown;
      rawUnitType: string | null;
      reason: string;
    }
  | {
      kind: "insert_canonical";
      legacyId: unknown;
      ambiguous: boolean;
      payload: NormalizedLegacyPayload;
    };

function hasKingdomId(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return String(value).trim().length > 0;
}

function sameKingdom(a: unknown, b: unknown): boolean {
  if (!hasKingdomId(a) || !hasKingdomId(b)) return false;
  return String(a) === String(b);
}

const KNOWN_LEGACY_DOC_KEYS = new Set<string>([
  "_id",
  "_creationTime",
  "kingdomId",
  "unitType",
  "level",
  "count",
  "wounded",
  "recoveryProgress",
  "isMercenary",
  "mercenaryTypeId",
  "contractEndsAt",
  "isSpy",
  "migrated",
  "migratedToId",
  "canonicalId",
  "migratedFromLegacyId",
  "migratedFromLegacyIds",
  "migrationAmbiguous",
  "legacy",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateKnownLegacyFields(doc: RawArmyUnitDoc): string | null {
  if (doc._id !== undefined && !isNonEmptyString(doc._id)) {
    return `Valor de '_id' inválido (${String(doc._id)}). Conservado en cuarentena sin borrado.`;
  }
  if (doc._creationTime !== undefined) {
    if (typeof doc._creationTime !== "number" || !Number.isFinite(doc._creationTime) || doc._creationTime < 0) {
      return `Valor de '_creationTime' inválido (${String(doc._creationTime)}). Conservado en cuarentena sin borrado.`;
    }
  }
  if (doc.kingdomId !== undefined && !isNonEmptyString(doc.kingdomId)) {
    return `Valor de 'kingdomId' inválido (${String(doc.kingdomId)}). Conservado en cuarentena sin borrado.`;
  }

  let normalizedRawType: UnitType | null = null;
  if (doc.unitType !== undefined) {
    if (typeof doc.unitType !== "string") {
      return `Valor de 'unitType' inválido (${String(doc.unitType)}). Conservado en cuarentena sin borrado.`;
    }
    normalizedRawType = normalizeUnitType(doc.unitType);
    if (!normalizedRawType) {
      return `Tipo de unidad heredado no reconocido ('${doc.unitType}'). Conservado en cuarentena sin conversión ni borrado.`;
    }
  }

  if (doc.count !== undefined) {
    if (typeof doc.count !== "number" || !Number.isInteger(doc.count) || doc.count < 0) {
      return `Valor de 'count' inválido o no interpretable (${String(doc.count)}). Conservado en cuarentena sin borrado.`;
    }
  }
  if (doc.wounded !== undefined) {
    if (typeof doc.wounded !== "number" || !Number.isInteger(doc.wounded) || doc.wounded < 0) {
      return `Valor de 'wounded' inválido o no interpretable (${String(doc.wounded)}). Conservado en cuarentena sin borrado.`;
    }
  }
  if (doc.level !== undefined) {
    if (typeof doc.level !== "number" || !Number.isInteger(doc.level) || doc.level < 1 || doc.level > 5) {
      return `Valor de 'level' inválido o fuera de rango (${String(doc.level)}). Conservado en cuarentena sin borrado.`;
    }
  }
  if (doc.isSpy !== undefined && typeof doc.isSpy !== "boolean") {
    return `Valor de 'isSpy' inválido (${String(doc.isSpy)}). Conservado en cuarentena sin borrado.`;
  }
  if (doc.isMercenary !== undefined && typeof doc.isMercenary !== "boolean") {
    return `Valor de 'isMercenary' inválido (${String(doc.isMercenary)}). Conservado en cuarentena sin borrado.`;
  }
  if (doc.mercenaryTypeId !== undefined && !isNonEmptyString(doc.mercenaryTypeId)) {
    return `Valor de 'mercenaryTypeId' inválido (${String(doc.mercenaryTypeId)}). Conservado en cuarentena sin borrado.`;
  }
  if (doc.contractEndsAt !== undefined) {
    if (typeof doc.contractEndsAt !== "number" || !Number.isFinite(doc.contractEndsAt) || doc.contractEndsAt <= 0) {
      return `Valor de 'contractEndsAt' inválido (${String(doc.contractEndsAt)}). Conservado en cuarentena sin borrado.`;
    }
  }
  if (doc.recoveryProgress !== undefined) {
    if (
      typeof doc.recoveryProgress !== "number" ||
      !Number.isFinite(doc.recoveryProgress) ||
      doc.recoveryProgress < 0 ||
      doc.recoveryProgress >= 1
    ) {
      return `Valor de 'recoveryProgress' inválido o fuera de [0, 1) (${String(doc.recoveryProgress)}). Conservado en cuarentena sin borrado.`;
    }
  }
  if (doc.legacy !== undefined && typeof doc.legacy !== "boolean") {
    return `Valor de 'legacy' inválido (${String(doc.legacy)}). Conservado en cuarentena sin borrado.`;
  }
  if (doc.migrated !== undefined && typeof doc.migrated !== "boolean") {
    return `Valor de 'migrated' inválido (${String(doc.migrated)}). Conservado en cuarentena sin borrado.`;
  }
  if (doc.migratedToId !== undefined && !isNonEmptyString(doc.migratedToId)) {
    return `Valor de 'migratedToId' inválido (${String(doc.migratedToId)}). Conservado en cuarentena sin borrado.`;
  }
  if (doc.canonicalId !== undefined && !isNonEmptyString(doc.canonicalId)) {
    return `Valor de 'canonicalId' inválido (${String(doc.canonicalId)}). Conservado en cuarentena sin borrado.`;
  }
  if (doc.migratedFromLegacyId !== undefined && !isNonEmptyString(doc.migratedFromLegacyId)) {
    return `Valor de 'migratedFromLegacyId' inválido (${String(doc.migratedFromLegacyId)}). Conservado en cuarentena sin borrado.`;
  }
  if (doc.migratedFromLegacyIds !== undefined) {
    if (
      !Array.isArray(doc.migratedFromLegacyIds) ||
      !doc.migratedFromLegacyIds.every((id) => isNonEmptyString(id))
    ) {
      return `Valor de 'migratedFromLegacyIds' inválido (${String(doc.migratedFromLegacyIds)}). Conservado en cuarentena sin borrado.`;
    }
  }
  if (doc.migrationAmbiguous !== undefined && typeof doc.migrationAmbiguous !== "boolean") {
    return `Valor de 'migrationAmbiguous' inválido (${String(doc.migrationAmbiguous)}). Conservado en cuarentena sin borrado.`;
  }

  // Contradicciones semánticas entre campos conocidos
  if (normalizedRawType === "espia" && doc.isSpy === false) {
    return "Contradicción entre 'unitType: espia' e 'isSpy: false'. Conservado en cuarentena sin borrado.";
  }
  if (doc.isMercenary === true && (doc.isSpy === true || normalizedRawType === "espia")) {
    return "Contradicción entre 'isMercenary: true' y unidad espía. Conservado en cuarentena sin borrado.";
  }
  if ((doc.mercenaryTypeId !== undefined || doc.contractEndsAt !== undefined) && doc.isMercenary !== true) {
    return "Metadatos de contrato mercenario sin 'isMercenary: true'. Conservado en cuarentena sin borrado.";
  }

  // Atributos adicionales desconocidos: nunca descartar información ajena al esquema canónico
  for (const [key, val] of Object.entries(doc as Record<string, unknown>)) {
    if (!KNOWN_LEGACY_DOC_KEYS.has(key) && val !== undefined) {
      return `Atributo adicional desconocido '${key}' presente en el documento heredado. Conservado íntegro en cuarentena.`;
    }
  }

  return null;
}

function hasExtraRelevantAttributes(doc: RawArmyUnitDoc): boolean {
  if (doc.isMercenary === true) return true;
  if (doc.isSpy === true) return true;
  if (doc.mercenaryTypeId !== undefined) return true;
  if (doc.contractEndsAt !== undefined) return true;
  if (typeof doc.recoveryProgress === "number" && Number.isFinite(doc.recoveryProgress) && doc.recoveryProgress > 0) {
    return true;
  }
  if (doc.legacy === true) return true;
  if (doc.migrated === true) return true;
  if (doc.migratedToId !== undefined) return true;
  if (doc.canonicalId !== undefined) return true;
  if (doc.migratedFromLegacyId !== undefined) return true;
  if (Array.isArray(doc.migratedFromLegacyIds) && doc.migratedFromLegacyIds.length > 0) return true;
  if (doc.migrationAmbiguous === true) return true;
  for (const [key, val] of Object.entries(doc as Record<string, unknown>)) {
    if (!KNOWN_LEGACY_DOC_KEYS.has(key) && val !== undefined) {
      return true;
    }
  }
  return false;
}

interface CanonicalProvenanceIndex {
  canonicalById: Map<string, RawArmyUnitDoc>;
  canonicalByLegacyId: Map<string, RawArmyUnitDoc[]>;
  canonicalSignatureKeys: Set<string>;
}

function buildCanonicalProvenanceSets(canonical: ReadonlyArray<RawArmyUnitDoc>): CanonicalProvenanceIndex {
  const canonicalById = new Map<string, RawArmyUnitDoc>();
  const canonicalByLegacyId = new Map<string, RawArmyUnitDoc[]>();
  const canonicalSignatureKeys = new Set<string>();

  for (const doc of canonical) {
    if (doc._id !== undefined && doc._id !== null) {
      canonicalById.set(String(doc._id), doc);
    }
    if (typeof doc.migratedFromLegacyId === "string" && doc.migratedFromLegacyId.length > 0) {
      const list = canonicalByLegacyId.get(doc.migratedFromLegacyId) ?? [];
      list.push(doc);
      canonicalByLegacyId.set(doc.migratedFromLegacyId, list);
    }
    if (Array.isArray(doc.migratedFromLegacyIds)) {
      for (const id of doc.migratedFromLegacyIds) {
        if (typeof id === "string" && id.length > 0) {
          const list = canonicalByLegacyId.get(id) ?? [];
          list.push(doc);
          canonicalByLegacyId.set(id, list);
        }
      }
    }
    const normalizedRaw = normalizeUnitType(doc.unitType);
    if (normalizedRaw && hasKingdomId(doc.kingdomId)) {
      const isSpy = Boolean(doc.isSpy) || normalizedRaw === "espia";
      const unitType = isSpy ? "espia" : normalizedRaw;
      const level = unitLevelOf({ level: doc.level });
      const mercKey = doc.isMercenary ? `merc:${doc.mercenaryTypeId ?? ""}:${doc.contractEndsAt ?? ""}` : "std";
      canonicalSignatureKeys.add(`${String(doc.kingdomId)}|${unitType}|${level}|${isSpy ? "spy" : "reg"}|${mercKey}`);
    }
  }

  return { canonicalById, canonicalByLegacyId, canonicalSignatureKeys };
}

/**
 * Busca la correspondencia canónica verificable del mismo reino para un documento heredado.
 * Exige simultáneamente:
 * - Ambos documentos tienen `kingdomId` presente y coincidente.
 * - El documento canónico existe realmente en `canonical`.
 * - Existe un vínculo de procedencia verificable (`migratedFromLegacyId`, `migratedFromLegacyIds`,
 *   `migratedToId` o `canonicalId`).
 * Una marca `migrated: true` sin documento canónico existente del mismo reino NUNCA es válida.
 */
export function findVerifiedCanonicalMatch(
  legacyDoc: RawArmyUnitDoc,
  canonical: ReadonlyArray<RawArmyUnitDoc>,
  precomputed?: CanonicalProvenanceIndex
): RawArmyUnitDoc | null {
  if (!hasKingdomId(legacyDoc.kingdomId)) return null;
  const index = precomputed ?? buildCanonicalProvenanceSets(canonical);
  const legacyId = legacyDoc._id !== undefined && legacyDoc._id !== null ? String(legacyDoc._id) : null;

  if (legacyId) {
    const candidates = index.canonicalByLegacyId.get(legacyId);
    if (candidates) {
      const sameRealm = candidates.find((c) => sameKingdom(c.kingdomId, legacyDoc.kingdomId));
      if (sameRealm) return sameRealm;
    }
  }

  if (isNonEmptyString(legacyDoc.migratedToId)) {
    const target = index.canonicalById.get(legacyDoc.migratedToId);
    if (target && sameKingdom(target.kingdomId, legacyDoc.kingdomId)) {
      return target;
    }
  }

  if (isNonEmptyString(legacyDoc.canonicalId)) {
    const target = index.canonicalById.get(legacyDoc.canonicalId);
    if (target && sameKingdom(target.kingdomId, legacyDoc.kingdomId)) {
      return target;
    }
  }

  return null;
}

export function isLegacyDocRepresentedInCanonical(
  legacyDoc: RawArmyUnitDoc,
  canonical: ReadonlyArray<RawArmyUnitDoc>,
  precomputed?: CanonicalProvenanceIndex
): boolean {
  return findVerifiedCanonicalMatch(legacyDoc, canonical, precomputed) !== null;
}

/**
 * Clasifica conservadoramente un documento heredado de 'Armyunits' en uno de tres estados:
 * - `empty`: demostrado vacío (sin activos, sin heridos, sin atributos relevantes, sin datos de procedencia/herencia
 *   por conservar, sin campos adicionales desconocidos y con todos los campos presentes validados).
 * - `valid`: todos los campos presentes validados y coherentes, con unidades activas o heridas migrables.
 * - `unrecognized`: cualquier campo con tipo/valor inválido, contradicción, tipo desconocido, atributo adicional
 *   o metadato relevante sin cantidad interpretable -> cuarentena íntegra sin borrado ni conversión.
 */
export function classifyLegacyArmyUnitDoc(doc: RawArmyUnitDoc): LegacyDocClassification {
  const rawUnitType = typeof doc.unitType === "string" ? doc.unitType : null;

  // 1. Validación estricta de todos los campos conocidos, contradicciones y atributos adicionales.
  const validationError = validateKnownLegacyFields(doc);
  if (validationError !== null) {
    return {
      status: "unrecognized",
      rawUnitType,
      reason: validationError,
    };
  }

  const count = doc.count ?? 0;
  const wounded = doc.wounded ?? 0;
  const normalizedRawType = normalizeUnitType(doc.unitType);

  // 2. Registro sin unidades activas ni heridos: solo es 'empty' si no contiene ningún atributo relevante ni procedencia.
  if (count === 0 && wounded === 0) {
    if (hasExtraRelevantAttributes(doc)) {
      return {
        status: "unrecognized",
        rawUnitType,
        reason:
          "Registro sin cantidad activa pero con atributos relevantes o metadatos de procedencia/herencia que no deben perderse. Conservado en cuarentena.",
      };
    }
    return { status: "empty" };
  }

  // 3. Registro con unidades (count > 0 o wounded > 0): exige tipo reconocido.
  if (!normalizedRawType) {
    return {
      status: "unrecognized",
      rawUnitType,
      reason: `Tipo de unidad heredado no reconocido: '${rawUnitType ?? "(ausente)"}'. Conservado en cuarentena sin conversión ni borrado.`,
    };
  }

  const isSpy = Boolean(doc.isSpy) || normalizedRawType === "espia";
  const unitType: UnitType = isSpy ? "espia" : normalizedRawType;

  const payload: NormalizedLegacyPayload = {
    unitType,
    level: unitLevelOf({ level: doc.level }),
    count,
    isSpy,
  };
  if (wounded > 0) payload.wounded = wounded;
  if (typeof doc.recoveryProgress === "number" && Number.isFinite(doc.recoveryProgress) && doc.recoveryProgress > 0) {
    payload.recoveryProgress = doc.recoveryProgress;
  }
  if (doc.isMercenary) {
    payload.isMercenary = true;
    if (typeof doc.mercenaryTypeId === "string") payload.mercenaryTypeId = doc.mercenaryTypeId;
    if (typeof doc.contractEndsAt === "number" && Number.isFinite(doc.contractEndsAt)) {
      payload.contractEndsAt = doc.contractEndsAt;
    }
  }
  return { status: "valid", payload };
}

export function normalizeLegacyArmyUnitDoc(doc: RawArmyUnitDoc): NormalizedLegacyPayload | null {
  const classified = classifyLegacyArmyUnitDoc(doc);
  return classified.status === "valid" ? classified.payload : null;
}

/**
 * Vista de solo lectura determinista que combina 'armyUnits' y los registros de 'Armyunits'
 * válidos que todavía no tienen representación canónica verificable.
 * Los registros en cuarentena (`unrecognized`) no se contabilizan como tropas ni como espías.
 */
export function reconcileArmyUnitDocs<T extends RawArmyUnitDoc>(
  canonical: ReadonlyArray<T>,
  legacy: ReadonlyArray<RawArmyUnitDoc>
): T[] {
  const index = buildCanonicalProvenanceSets(canonical);
  const reconciledLegacy: RawArmyUnitDoc[] = [];

  for (const doc of legacy) {
    if (isLegacyDocRepresentedInCanonical(doc, canonical, index)) {
      continue;
    }
    const classified = classifyLegacyArmyUnitDoc(doc);
    if (classified.status !== "valid") continue;
    reconciledLegacy.push({
      ...doc,
      ...classified.payload,
      legacy: true,
    });
  }

  return [...canonical, ...(reconciledLegacy as T[])];
}

/**
 * Planifica de forma determinista la migración transaccional de 'Armyunits' hacia 'armyUnits'.
 */
export function planArmyUnitsMigration(
  canonical: ReadonlyArray<RawArmyUnitDoc>,
  legacy: ReadonlyArray<RawArmyUnitDoc>
): LegacyMigrationAction[] {
  const index = buildCanonicalProvenanceSets(canonical);
  const actions: LegacyMigrationAction[] = [];

  for (const doc of legacy) {
    // 1. Clasificar primero el documento heredado para evitar borrar registros inválidos/dudosos
    const classified = classifyLegacyArmyUnitDoc(doc);
    if (classified.status === "empty") {
      actions.push({ kind: "delete_empty_legacy", legacyId: doc._id });
      continue;
    }
    if (classified.status === "unrecognized") {
      actions.push({
        kind: "quarantine_unrecognized_legacy",
        legacyId: doc._id,
        rawUnitType: classified.rawUnitType,
        reason: classified.reason,
      });
      continue;
    }

    // 2. Solo si es 'valid', comprobar si existe correspondencia canónica verificable para deduplicar
    const verifiedMatch = findVerifiedCanonicalMatch(doc, canonical, index);
    if (verifiedMatch) {
      actions.push({ kind: "delete_duplicate_legacy", legacyId: doc._id, matchedCanonicalId: verifiedMatch._id });
      continue;
    }

    const { payload } = classified;
    const mercKey = payload.isMercenary ? `merc:${payload.mercenaryTypeId ?? ""}:${payload.contractEndsAt ?? ""}` : "std";
    const kKey = hasKingdomId(doc.kingdomId) ? String(doc.kingdomId) : null;
    const signatureKey = kKey ? `${kKey}|${payload.unitType}|${payload.level}|${payload.isSpy ? "spy" : "reg"}|${mercKey}` : null;
    const ambiguous = signatureKey ? index.canonicalSignatureKeys.has(signatureKey) : false;
    if (signatureKey) {
      index.canonicalSignatureKeys.add(signatureKey);
    }
    if (doc._id !== undefined && doc._id !== null && hasKingdomId(doc.kingdomId)) {
      const legacyIdStr = String(doc._id);
      const list = index.canonicalByLegacyId.get(legacyIdStr) ?? [];
      list.push({ kingdomId: doc.kingdomId, migratedFromLegacyId: legacyIdStr });
      index.canonicalByLegacyId.set(legacyIdStr, list);
    }
    actions.push({
      kind: "insert_canonical",
      legacyId: doc._id,
      ambiguous,
      payload,
    });
  }

  return actions;
}


