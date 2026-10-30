/**
 * LA CONQUISTA — REGLAS MARCIALES Y REQUISITOS MILITARES (ESPECIFICACIÓN MAESTRA)
 * 
 * Basado en las reglas oficiales:
 * - P23: Requisitos estructurales por nivel de tropa:
 *   * Nivel 1 (Milicia): Requisito base (Castillo 1, Cuartel 1 si existe).
 *   * Nivel 2 (Entrenado): Castillo 2 + Barracones (Cuartel) 2.
 *   * Nivel 3 (Veterano): Castillo 4 + Barracones 3 + Universidad 2.
 *   * Nivel 4 (Profesional): Castillo 6 + Barracones 4 + Universidad 3.
 *   * Nivel 5 (Élite): Castillo 8 + Barracones 5 + Universidad 4 + Herrería 5.
 * - P28: Tipos de tropa principales (infantería, arqueros, caballería, asedio).
 * - P29: Multiplicadores de eficacia marcial:
 *   * Nivel 1 (Milicia): 100 % (1.00)
 *   * Nivel 2 (Entrenado): 115 % (1.15)
 *   * Nivel 3 (Veterano): 135 % (1.35)
 *   * Nivel 4 (Profesional): 160 % (1.60)
 *   * Nivel 5 (Élite): 190 % (1.90)
 * - P54: Reclutar ciudadanos sustrae temporalmente población civil libre.
 * - P18: Las tropas activas consumen un 5 % más de alimentos (factor 1,05).
 *   (Las tropas en entrenamiento NO se computan en regularSoldiers hasta finalizar).
 */

import type { ResourceType } from "./economyCalculations";
import { getCivilizationPassive, civilizationTrainingDurationMultiplier } from "./civilizationRules";
import { UNITS, UNIT_TYPES, type UnitType } from "./balanceConfig";

export const VALID_MILITARY_UNIT_TYPES = UNIT_TYPES;

export type MilitaryUnitType = UnitType;

export function isValidMilitaryUnitType(type: string): type is MilitaryUnitType {
  return (UNIT_TYPES as readonly string[]).includes(type);
}

export const MILITARY_TIER_EFFICIENCY: Readonly<Record<number, number>> = {
  1: 1.00, // Nivel 1 — Milicia: 100 % (P29)
  2: 1.15, // Nivel 2 — Entrenado: 115 % (P29)
  3: 1.35, // Nivel 3 — Veterano: 135 % (P29)
  4: 1.60, // Nivel 4 — Profesional: 160 % (P29)
  5: 1.90, // Nivel 5 — Élite: 190 % (P29)
};

export const MILITARY_TIER_NAMES: Readonly<Record<number, string>> = {
  1: "Milicia",
  2: "Entrenado",
  3: "Veterano",
  4: "Profesional",
  5: "Élite",
};

/**
 * Requisitos de progresión edilicia según P23 de la Especificación Maestra.
 */
export const MILITARY_PREREQUISITES_P23: Readonly<Record<number, Readonly<Record<string, number>>>> = {
  1: { castillo: 1 },
  2: { castillo: 2, cuartel: 2 },
  3: { castillo: 4, cuartel: 3, universidad: 2 },
  4: { castillo: 6, cuartel: 4, universidad: 3 },
  5: { castillo: 8, cuartel: 5, universidad: 4, herreria: 5 },
};

export const MAX_CONCURRENT_TRAINING_TASKS = 2; // Capacidad de dos levas simultáneas por cuartel

export interface MilitaryUnitRule {
  unitType: MilitaryUnitType;
  level: number;
  costsPerUnit: Record<ResourceType, number> | null;
  durationMsPerUnit: number | null;
  prerequisites: Readonly<Record<string, number>>;
}

export interface TrainingQueueEntry {
  kingdomId: string;
  unitType: string;
  count: number;
  level?: number;
  startedAt: number;
  durationMs: number;
  costs?: Partial<Record<ResourceType, number>>;
}

export interface TrainingPlan {
  unitType: MilitaryUnitType;
  level: number;
  count: number;
  startedAt: number;
  durationMs: number;
  completesAt: number;
  costs: Record<ResourceType, number>;
}

export const MILITARY_PARAMETERS_PENDING = [
  "costes oficiales por tipo de tropa y nivel",
  "tiempos base de entrenamiento por unidad y nivel",
  "penalizaciones exactas por cancelación de leva",
] as const;

/**
 * Reglas por defecto sin invención de costes o tiempos no aprobados.
 */
export const DEFAULT_MILITARY_RULES: Readonly<Record<string, MilitaryUnitRule>> = {
  "infanteria_1": { unitType: "infanteria", level: 1, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[1] },
  "infanteria_2": { unitType: "infanteria", level: 2, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[2] },
  "infanteria_3": { unitType: "infanteria", level: 3, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[3] },
  "infanteria_4": { unitType: "infanteria", level: 4, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[4] },
  "infanteria_5": { unitType: "infanteria", level: 5, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[5] },

  "arqueria_1": { unitType: "arqueria", level: 1, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[1] },
  "arqueria_2": { unitType: "arqueria", level: 2, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[2] },
  "arqueria_3": { unitType: "arqueria", level: 3, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[3] },
  "arqueria_4": { unitType: "arqueria", level: 4, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[4] },
  "arqueria_5": { unitType: "arqueria", level: 5, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[5] },

  "caballeria_1": { unitType: "caballeria", level: 1, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[1] },
  "caballeria_2": { unitType: "caballeria", level: 2, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[2] },
  "caballeria_3": { unitType: "caballeria", level: 3, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[3] },
  "caballeria_4": { unitType: "caballeria", level: 4, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[4] },
  "caballeria_5": { unitType: "caballeria", level: 5, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[5] },

  "asedio_1": { unitType: "asedio", level: 1, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[1] },
  "asedio_2": { unitType: "asedio", level: 2, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[2] },
  "asedio_3": { unitType: "asedio", level: 3, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[3] },
  "asedio_4": { unitType: "asedio", level: 4, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[4] },
  "asedio_5": { unitType: "asedio", level: 5, costsPerUnit: null, durationMsPerUnit: null, prerequisites: MILITARY_PREREQUISITES_P23[5] },
};

/**
 * Valida y crea el plan inmutable para una solicitud de entrenamiento militar.
 */
export function createTrainingPlan(input: {
  unitType: string;
  count: number;
  level?: number;
  resources: Record<ResourceType, number>;
  availableCivilians: number;
  activeTrainings: TrainingQueueEntry[];
  buildingLevels: Readonly<Record<string, number>>;
  now: number;
  customRule?: MilitaryUnitRule;
  civilization?: string;
}): { success: true; plan: TrainingPlan } | { success: false; error: string } {
  const normalizedType = (input.unitType || "").toLowerCase().trim();
  if (!isValidMilitaryUnitType(normalizedType)) {
    return {
      success: false,
      error: `Tipo de unidad no admitido: '${input.unitType}'. Tipos válidos: ${VALID_MILITARY_UNIT_TYPES.join(", ")}.`,
    };
  }

  if (!Number.isInteger(input.count) || input.count <= 0) {
    return {
      success: false,
      error: `La cantidad de tropas a reclutar debe ser un número entero positivo (recibido: ${input.count}).`,
    };
  }

  const level = input.level ?? 1;
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    return {
      success: false,
      error: `El nivel militar debe ser un número entero entre 1 (Milicia) y 5 (Élite) según P29 (recibido: ${level}).`,
    };
  }

  // 1. Validar cola de entrenamiento activa
  if (input.activeTrainings.length >= MAX_CONCURRENT_TRAINING_TASKS) {
    return {
      success: false,
      error: `Las ${MAX_CONCURRENT_TRAINING_TASKS} ranuras de entrenamiento militar ya están ocupadas en el cuartel.`,
    };
  }

  // 2. Validar disponibilidad de ciudadanos libres (P12, P13, P54)
  if (!Number.isInteger(input.availableCivilians) || input.availableCivilians < input.count) {
    return {
      success: false,
      error: `No hay suficientes ciudadanos libres disponibles para reclutar (disponibles: ${input.availableCivilians}, solicitados: ${input.count}).`,
    };
  }

  // 3. Resolver regla militar y requisitos
  const ruleKey = `${normalizedType}_${level}`;
  const rule = input.customRule ?? DEFAULT_MILITARY_RULES[ruleKey];
  if (!rule) {
    return {
      success: false,
      error: `No existe regla configurada para la unidad '${normalizedType}' de nivel ${level}.`,
    };
  }

  // 4. Validar requisitos estructurales P23
  const prerequisites = rule.prerequisites ?? MILITARY_PREREQUISITES_P23[level];
  for (const [buildingType, minLevel] of Object.entries(prerequisites)) {
    const currentBuildingLevel = input.buildingLevels[buildingType] ?? 0;
    if (currentBuildingLevel < minLevel) {
      return {
        success: false,
        error: `Requisito marcial incumplido (P23): '${buildingType}' debe alcanzar el nivel ${minLevel} para tropas nivel ${level} (nivel actual: ${currentBuildingLevel}).`,
      };
    }
  }

  // 5. Validar costes oficiales
  if (!rule.costsPerUnit) {
    return {
      success: false,
      error: `Costes de reclutamiento de '${normalizedType}' nivel ${level} pendientes de especificación oficial.`,
    };
  }

  // 6. Validar duración de entrenamiento
  if (rule.durationMsPerUnit === null || !Number.isFinite(rule.durationMsPerUnit) || rule.durationMsPerUnit <= 0) {
    return {
      success: false,
      error: `Duración de entrenamiento de '${normalizedType}' nivel ${level} pendiente de especificación oficial.`,
    };
  }

  // 7. Calcular costes totales y validar recursos
  const totalCosts: Record<ResourceType, number> = {
    gold: rule.costsPerUnit.gold * input.count,
    wood: rule.costsPerUnit.wood * input.count,
    stone: rule.costsPerUnit.stone * input.count,
    iron: rule.costsPerUnit.iron * input.count,
    food: rule.costsPerUnit.food * input.count,
  };

  const resourceTypes: ResourceType[] = ["gold", "wood", "stone", "iron", "food"];
  for (const res of resourceTypes) {
    const currentStock = input.resources[res] ?? 0;
    const required = totalCosts[res];
    if (currentStock < required) {
      return {
        success: false,
        error: `Recursos insuficientes: '${res}' requiere ${required} y el reino dispone de ${currentStock}.`,
      };
    }
  }

  const civUnitMultiplier = civilizationTrainingDurationMultiplier(normalizedType as UnitType, input.civilization);
  const totalDurationMs = Math.ceil(rule.durationMsPerUnit * input.count * civUnitMultiplier);

  return {
    success: true,
    plan: {
      unitType: normalizedType,
      level,
      count: input.count,
      startedAt: input.now,
      durationMs: totalDurationMs,
      completesAt: input.now + totalDurationMs,
      costs: totalCosts,
    },
  };
}

/**
 * Determina si una tarea de entrenamiento ha alcanzado su tiempo de finalización.
 */
export function isTrainingComplete(startedAt: number, durationMs: number, serverTimeMs: number): boolean {
  if (!Number.isFinite(startedAt) || !Number.isFinite(durationMs) || durationMs < 0 || !Number.isFinite(serverTimeMs)) {
    return false;
  }
  return serverTimeMs >= startedAt + durationMs;
}

/**
 * Calcula el porcentaje de avance de un adiestramiento (0 - 100).
 */
export function calculateTrainingProgressPercent(startedAt: number, durationMs: number, serverTimeMs: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(serverTimeMs)) {
    return 0;
  }
  const elapsed = serverTimeMs - startedAt;
  if (elapsed <= 0) return 0;
  if (elapsed >= durationMs) return 100;
  return Math.min(100, Math.max(0, Math.floor((elapsed / durationMs) * 100)));
}

/**
 * Determina la acción de incorporación de tropas a armyUnits:
 * - 'update': si ya existe un registro del reino y tipo de unidad, se incrementa.
 * - 'insert': si no existe, se inserta un nuevo documento.
 */
export function resolveArmyUnitsIncorporation(
  existingUnits: Array<{ unitType: string; count: number; _id?: any }>,
  unitType: string,
  count: number
): { action: "update"; existingId: any; nextCount: number } | { action: "insert"; nextCount: number } {
  const normalized = unitType.trim().toLowerCase();
  const found = existingUnits.find((u) => u.unitType.trim().toLowerCase() === normalized);
  if (found) {
    return {
      action: "update",
      existingId: found._id,
      nextCount: found.count + count,
    };
  }
  return {
    action: "insert",
    nextCount: count,
  };
}

/**
 * Determina si una unidad militar es tropa regular viva sujeta a raciones militares (P18).
 * La infantería, arquería y caballería son combatientes vivos.
 * El asedio (catapultas, arietes) son ingenios mecánicos y no incrementan regularSoldiers.
 */
export function isLivingRegularTroop(unitType: string): boolean {
  const norm = (unitType || "").trim().toLowerCase() as UnitType;
  const unit = UNITS[norm];
  return unit ? unit.isLivingTroop : true;
}

/**
 * Calcula el nuevo contador escalar de regularSoldiers tras la incorporación de tropas vivas.
 * Si se especifica unitType y corresponde a asedio, regularSoldiers se conserva intacto (P18).
 */
export function calculateNextRegularSoldiers(
  currentRegular: number,
  addedCount: number,
  unitType?: string
): number {
  const base = Number.isInteger(currentRegular) && currentRegular >= 0 ? currentRegular : 0;
  if (unitType && !isLivingRegularTroop(unitType)) {
    return base;
  }
  return base + (Number.isInteger(addedCount) && addedCount >= 0 ? addedCount : 0);
}


