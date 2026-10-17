/**
 * LA CONQUISTA — ADAPTADOR DE DATOS DEL MOTOR ECONÓMICO
 * Módulo TypeScript puro sin dependencias de Convex ni de './_generated/server'.
 * Transforma los documentos relacionales de 'kingdoms', 'resources', 'population',
 * 'populationJobs' y 'Armyunits' en la estructura autoritativa que requiere 'simulateEconomicProgress'.
 * Reglas de diseño y restricciones aplicadas:
 * - P2: 86.400 segundos reales por año de juego.
 * - P3: 5 recursos oficiales (oro, madera, piedra, hierro, alimentos).
 * - P10: Inicialización en 2.000 habitantes aplicable al fundar nuevos reinos; los reinos
 *   existentes (como 'guest_g9ai8cz' con 1.000 hab.) conservan su censo sin alteración.
 * - P18: Factor de consumo militar de 1,05 aplicado exclusivamente a efectivos de tropa regular.
 * - 'foodTier': Se recibe como parámetro explícito; no se presupone persistido en la base de datos remota.
 * - Valida documentos nulos, datos incoherentes y cantidades negativas sin ocultar errores.
 */

import {
  type KingdomState,
  type KingdomResources,
  type WorkersDistribution,
  VALID_RESOURCE_TYPES,
  validateKingdomResources,
  simulateEconomicProgress,
} from "./economyCalculations";
import { calculateBuildingWorkerCapacity } from "./buildingRules";
import { UNITS } from "./balanceConfig";

/** Representaciones canónicas de los documentos del backend remoto */
export interface RemoteKingdomDoc {
  _id: string;
  name: string;
  userId: string;
  civilization?: string;
  castleName?: string;
  monarchName?: string;
  happiness?: number;
  militaryMorale?: number;
  taxPolicy?: string;
  taxRate?: number;
  foodTier?: string;
  createdAt?: number;
  updatedAt?: number;
  moraleEffects?: Array<{ amount: number; expiresAt: number }>;
}

export interface RemoteResourcesDoc {
  _id?: string;
  kingdomId: string;
  gold: number;
  wood: number;
  stone: number;
  iron: number;
  food: number;
  lastUpdated: number;
  settlementInitialized?: boolean;
  foodTier?: string;
}

export interface RemotePopulationDoc {
  _id?: string;
  kingdomId: string;
  total: number;
  capacity?: number;
  available: number;
  starving?: boolean;
  /** Segundos reales acumulados de déficit alimentario (D-48), persistidos por el servidor. */
  starvationSeconds?: number;
}

export interface RemotePopulationJobDoc {
  _id?: string;
  kingdomId: string;
  jobType: string;
  assignedCount: number;
}

/**
 * Oficios asignables desde la interfaz (P12, P13):
 * - productivos (recursos): agriculture, wood, stone, iron, gold;
 * - profesiones con efecto (M-07): medicine, religion, entertainment, bakery, construction;
 * - heredados sin efecto propio: mining, military, scholars (se conservan por compatibilidad).
 */
export const ASSIGNABLE_POPULATION_JOB_TYPES = [
  "agriculture",
  "wood",
  "stone",
  "iron",
  "gold",
  "medicine",
  "religion",
  "entertainment",
  "bakery",
  "construction",
  "mining",
  "military",
  "scholars",
] as const;

export type AssignablePopulationJobType = (typeof ASSIGNABLE_POPULATION_JOB_TYPES)[number];

export interface PopulationJobReassignmentResult {
  success: boolean;
  error?: string;
  jobType?: AssignablePopulationJobType;
  previousAssignedCount?: number;
  assignedCount?: number;
  available?: number;
  persistence?: {
    operation: "insert" | "update" | "delete" | "unchanged";
    jobId?: string;
  };
}

export function calculatePopulationJobReassignment(input: {
  populationTotal: number;
  available: number;
  populationJobs: RemotePopulationJobDoc[];
  jobType: string;
  assignedCount: number;
  kingdomId: string;
}): PopulationJobReassignmentResult {
  if (!ASSIGNABLE_POPULATION_JOB_TYPES.includes(input.jobType as AssignablePopulationJobType)) {
    return { success: false, error: `Tipo de oficio no válido: '${input.jobType}'.` };
  }
  if (!Number.isInteger(input.populationTotal) || input.populationTotal < 0) {
    return { success: false, error: "La población total persistida no es válida." };
  }
  if (!Number.isInteger(input.available) || input.available < 0) {
    return { success: false, error: "La población disponible persistida no es válida." };
  }
  if (!Number.isInteger(input.assignedCount) || input.assignedCount < 0) {
    return { success: false, error: "La asignación debe ser un entero no negativo." };
  }

  const seenJobTypes = new Set<string>();
  let totalAssigned = 0;
  let previousAssignedCount = 0;
  let matchingJobCount = 0;
  let matchingJobId: string | undefined;

  for (const job of input.populationJobs) {
    if (typeof job.jobType !== "string") {
      return { success: false, error: "Hay una asignación laboral sin tipo de oficio válido." };
    }
    const normalizedType = job.jobType.trim().toLowerCase();
    if (!normalizedType || job.kingdomId !== input.kingdomId) {
      return { success: false, error: "Hay una asignación laboral inválida o asociada a otro reino." };
    }
    if (seenJobTypes.has(normalizedType)) {
      return { success: false, error: `Hay asignaciones duplicadas para el oficio '${job.jobType}'.` };
    }
    seenJobTypes.add(normalizedType);
    if (!Number.isInteger(job.assignedCount) || job.assignedCount < 0) {
      return { success: false, error: `La asignación persistida de '${job.jobType}' no es válida.` };
    }

    totalAssigned += job.assignedCount;
    if (normalizedType === input.jobType) {
      previousAssignedCount = job.assignedCount;
      matchingJobCount++;
      matchingJobId = job._id;
    }
  }

  if (totalAssigned + input.available > input.populationTotal) {
    return { success: false, error: "Las asignaciones laborales exceden la población total persistida." };
  }
  if (matchingJobCount > 1) {
    return { success: false, error: `Hay asignaciones duplicadas para el oficio '${input.jobType}'.` };
  }

  const available = input.available + previousAssignedCount - input.assignedCount;
  if (available < 0) {
    return { success: false, error: "No hay suficientes habitantes disponibles para esta asignación." };
  }
  if (totalAssigned - previousAssignedCount + input.assignedCount + available > input.populationTotal) {
    return { success: false, error: "La reasignación excede la población total del reino." };
  }

  return {
    success: true,
    jobType: input.jobType as AssignablePopulationJobType,
    previousAssignedCount,
    assignedCount: input.assignedCount,
    available,
    persistence: previousAssignedCount === input.assignedCount
      ? { operation: "unchanged", jobId: matchingJobId }
      : input.assignedCount > 0
        ? matchingJobId
          ? { operation: "update", jobId: matchingJobId }
          : { operation: "insert" }
        : { operation: "delete", jobId: matchingJobId },
  };
}

export interface RemoteArmyUnitDoc {
  _id?: string;
  kingdomId: string;
  unitType: string;
  count: number;
  level?: number;   // Nivel militar P29 (1-5); ausente = 1
  wounded?: number; // Heridos P44, separados de los activos
}

export type ValidFoodTier = "minima" | "normal" | "abundante" | "excelente";
export const VALID_FOOD_TIERS: readonly ValidFoodTier[] = [
  "minima",
  "normal",
  "abundante",
  "excelente",
] as const;

export function isValidFoodTier(tier: string): tier is ValidFoodTier {
  return VALID_FOOD_TIERS.includes(tier as ValidFoodTier);
}

/**
 * Clasificación de unidades militares y tratamiento del consumo (P18, D-12).
 * - Infantería, caballería y arquería son tropa viva: consumen con el factor 1,05.
 * - Las máquinas de asedio no consumen raciones; sus operadores (5 por pieza,
 *   reservados de la población civil al entrenar) son personal militar y sí consumen.
 * - Los heridos siguen siendo personas: consumen como tropa.
 * - La tabla heredada 'Armyunits' usa unitType "regular", tratado como infantería.
 */
export interface MilitaryClassification {
  regularSoldiers: number; // Personas militares sujetas al factor 1,05 (tropa viva + operadores + heridos)
  siegeUnits: number;      // Máquinas de asedio (no consumen)
  siegeOperators: number;  // Operadores de las máquinas (incluidos en regularSoldiers)
  woundedSoldiers: number; // Heridos (incluidos en regularSoldiers)
  totalUnits: number;      // Unidades militares activas (tropa viva + máquinas)
}

export function classifyArmyUnits(
  armyUnits: RemoteArmyUnitDoc[] | undefined | null
): MilitaryClassification {
  if (!armyUnits || !Array.isArray(armyUnits)) {
    return { regularSoldiers: 0, siegeUnits: 0, siegeOperators: 0, woundedSoldiers: 0, totalUnits: 0 };
  }

  let livingActive = 0;
  let siegeUnits = 0;
  let wounded = 0;

  for (const unit of armyUnits) {
    if (typeof unit.count !== "number" || !Number.isInteger(unit.count) || unit.count < 0) {
      throw new Error(
        `Cantidad inválida en unidad militar '${unit.unitType}': debe ser un entero no negativo (recibido: ${unit.count}).`
      );
    }
    const unitWounded = (unit as { wounded?: number }).wounded;
    if (unitWounded !== undefined && (!Number.isInteger(unitWounded) || unitWounded < 0)) {
      throw new Error(`Heridos inválidos en unidad militar '${unit.unitType}': debe ser un entero no negativo.`);
    }

    const typeNormalized = (unit.unitType || "").toLowerCase().trim();
    if (typeNormalized === "asedio") {
      siegeUnits += unit.count;
      wounded += (unitWounded ?? 0) * UNITS.asedio.populationPerUnit;
    } else {
      livingActive += unit.count;
      wounded += unitWounded ?? 0;
    }
  }

  const siegeOperators = siegeUnits * UNITS.asedio.populationPerUnit;
  return {
    regularSoldiers: livingActive + siegeOperators + wounded,
    siegeUnits,
    siegeOperators,
    woundedSoldiers: wounded,
    totalUnits: livingActive + siegeUnits,
  };
}

export interface EconomicAdapterInput {
  kingdom: RemoteKingdomDoc | null | undefined;
  resources: RemoteResourcesDoc | null | undefined;
  population: RemotePopulationDoc | null | undefined;
  populationJobs: RemotePopulationJobDoc[] | null | undefined;
  armyUnits: RemoteArmyUnitDoc[] | null | undefined;
  buildings?: RemoteBuildingDoc[] | null | undefined;
  foodTier: string; // Parámetro explícito requerido
}

export interface EconomicAdapterResult {
  success: boolean;
  kingdomState?: KingdomState;
  militaryClassification?: MilitaryClassification;
  error?: string;
}

/**
 * Adapta y valida estrictamente los documentos relacionales remotos para el motor de cálculo.
 */
export function adaptRemoteDocumentsToEconomicState(
  input: EconomicAdapterInput
): EconomicAdapterResult {
  // 1. Validación de presencia obligatoria de documentos raíz
  if (!input.kingdom) {
    return { success: false, error: "Documento de reino ('kingdom') ausente o nulo." };
  }
  if (!input.resources) {
    return { success: false, error: "Documento de recursos ('resources') ausente o nulo." };
  }
  if (!input.population) {
    return { success: false, error: "Documento de población ('population') ausente o nulo." };
  }

  const { kingdom, resources, population, populationJobs = [], armyUnits = [], foodTier } = input;

  // 2. Validación de consistencia relacional (mismo kingdomId si está presente)
  const targetKingdomId = kingdom._id;
  if (resources.kingdomId && targetKingdomId && resources.kingdomId !== targetKingdomId) {
    return {
      success: false,
      error: `Inconsistencia relacional: resources.kingdomId (${resources.kingdomId}) no coincide con kingdom._id (${targetKingdomId}).`,
    };
  }
  if (population.kingdomId && targetKingdomId && population.kingdomId !== targetKingdomId) {
    return {
      success: false,
      error: `Inconsistencia relacional: population.kingdomId (${population.kingdomId}) no coincide con kingdom._id (${targetKingdomId}).`,
    };
  }
  if (input.buildings !== undefined && input.buildings !== null) {
    const seenBuildingTypes = new Set<string>();
    for (const building of input.buildings) {
      if (
        building.kingdomId !== targetKingdomId ||
        !building.buildingType.trim() ||
        !Number.isInteger(building.level) ||
        building.level < 1 ||
        building.level > 100
      ) {
        return { success: false, error: "Hay un edificio inválido o asociado a otro reino." };
      }
      if (seenBuildingTypes.has(building.buildingType)) {
        return { success: false, error: `Hay edificios duplicados de tipo '${building.buildingType}'.` };
      }
      seenBuildingTypes.add(building.buildingType);
    }
  }
  // 3. Validación del régimen alimentario explícito (P17)
  if (!isValidFoodTier(foodTier)) {
    return {
      success: false,
      error: `Régimen alimentario no válido: '${foodTier}'. Valores permitidos según P17: ${VALID_FOOD_TIERS.join(", ")}.`,
    };
  }

  // 4. Validación de recursos (P3, no negatividad, finitud y timestamp)
  if (typeof resources.lastUpdated !== "number" || !Number.isFinite(resources.lastUpdated) || resources.lastUpdated < 0) {
    return {
      success: false,
      error: `Marca temporal 'resources.lastUpdated' inválida (recibido: ${resources.lastUpdated}).`,
    };
  }

  const kingdomResources: KingdomResources = {
    gold: resources.gold,
    wood: resources.wood,
    stone: resources.stone,
    iron: resources.iron,
    food: resources.food,
  };

  const resValidation = validateKingdomResources(kingdomResources);
  if (!resValidation.valid) {
    return {
      success: false,
      error: `Validación de recursos fallida: ${resValidation.error}`,
    };
  }

  // 5. Validación demográfica y de enteros
  if (typeof population.total !== "number" || !Number.isInteger(population.total) || population.total < 0) {
    return {
      success: false,
      error: `Población total inválida en 'population.total': debe ser un entero no negativo (recibido: ${population.total}).`,
    };
  }
  if (typeof population.available !== "number" || !Number.isInteger(population.available) || population.available < 0) {
    return {
      success: false,
      error: `Mano de obra disponible inválida en 'population.available': debe ser un entero no negativo (recibido: ${population.available}).`,
    };
  }

  // 6. Clasificación militar y validación de tropas
  let military: MilitaryClassification;
  try {
    military = classifyArmyUnits(armyUnits);
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 7. Agregación de trabajadores por oficio (populationJobs)
  const workers: WorkersDistribution = {
    agriculture: 0,
    wood: 0,
    stone: 0,
    iron: 0,
    gold: 0,
    other: 0,
  };

  const jobCounts: Record<string, number> = {};
  if (populationJobs && Array.isArray(populationJobs)) {
    const seenJobTypes = new Set<string>();
    for (const job of populationJobs) {
      if (typeof job.jobType !== "string") {
        return { success: false, error: "Hay una asignación laboral sin tipo de oficio válido." };
      }
      if (typeof job.assignedCount !== "number" || !Number.isInteger(job.assignedCount) || job.assignedCount < 0) {
        return {
          success: false,
          error: `Cantidad inválida de trabajadores en '${job.jobType}': debe ser un entero no negativo (recibido: ${job.assignedCount}).`,
        };
      }

      const jobKey = (job.jobType || "").toLowerCase().trim();
      if (!jobKey || seenJobTypes.has(jobKey)) {
        return {
          success: false,
          error: `Hay un tipo de oficio vacío o duplicado en populationJobs ('${job.jobType}').`,
        };
      }
      if (job.kingdomId !== targetKingdomId) {
        return {
          success: false,
          error: `Inconsistencia relacional: populationJobs.kingdomId (${job.kingdomId}) no coincide con kingdom._id (${targetKingdomId}).`,
        };
      }
      seenJobTypes.add(jobKey);
      jobCounts[jobKey] = job.assignedCount;

      switch (jobKey) {
        case "agriculture":
          workers.agriculture += job.assignedCount;
          break;
        case "wood":
        case "forestry":
          workers.wood += job.assignedCount;
          break;
        case "stone":
        case "quarry":
          workers.stone += job.assignedCount;
          break;
        case "iron":
          workers.iron += job.assignedCount;
          break;
        case "gold":
          workers.gold += job.assignedCount;
          break;
        case "mining":
          // En el esquema remoto 'mining' puede englobar hierro y piedra; se asigna a other o proporcional
          workers.other += job.assignedCount;
          break;
        case "military":
          // TRABAJADORES ASIGNADOS A MILICIA/GUARNICIÓN
          // Son ciudadanos censados en 'populationJobs', diferentes a las tropas en 'Armyunits'.
          workers.other += job.assignedCount;
          break;
        default:
          workers.other += job.assignedCount;
          break;
      }
    }
  }

  // 8. Verificación de balance de población (no exceder el censo total)
  const totalAssignedJobs = Object.values(workers).reduce((sum, count) => sum + count, 0);
  if (totalAssignedJobs + population.available > population.total) {
    return {
      success: false,
      error: `Incoherencia demográfica: la suma de trabajadores asignados (${totalAssignedJobs}) más la mano libre (${population.available}) supera el censo total (${population.total}).`,
    };
  }

  // 9. Ensamblado del estado autoritativo para 'simulateEconomicProgress'
  const kingdomState: KingdomState = {
    userId: kingdom.userId,
    name: kingdom.name,
    population: population.total,
    regularSoldiers: military.regularSoldiers,
    workers,
    unassignedCivil: population.available,
    resources: kingdomResources,
    foodTier,
    lastUpdated: resources.lastUpdated,
    jobCounts,
    ...(input.buildings !== undefined
      ? {
          foodProductionWorkerLimit: input.buildings
            ? calculateBuildingWorkerCapacity(input.buildings, "granja")
            : null,
        }
      : {}),
    createdAt: kingdom.createdAt,
  };

  return {
    success: true,
    kingdomState,
    militaryClassification: military,
  };
}

/**
 * ============================================================================
 * ETAPA 1B: CONSULTA ECONÓMICA PROYECTADA (LÓGICA PURA)
 * ============================================================================
 * Función determinista y sin efectos secundarios (solo lectura, sin escrituras en DB).
 * Requisitos y garantías:
 * 1. Control de autorización estricto (P1): Comprueba que callerUserId coincida con kingdom.userId.
 * 2. Adaptación íntegra de documentos relacionales remotos mediante adaptRemoteDocumentsToEconomicState.
 * 3. Simulación continua según P2: respeta resources.lastUpdated y targetTime.
 * 4. Hora de referencia inyectable ('targetTime'): si se suministra, permite reproducibilidad exacta en pruebas.
 * 5. Casos límite temporales:
 *    - Si targetTime === lastUpdated: intervalo de 0s, recursos proyectados idénticos a los actuales.
 *    - Si targetTime < lastUpdated: clamp a 0s transcurridos (evita saltos al pasado).
 *    - Si targetTime > lastUpdated con déficit: detecta agotamiento exacto y tiempo en inanición (suelo en 0).
 * 6. Tratamiento explícito de foodTier (P17) y clasificación militar (P18, asedio segregado).
 */
export interface SimulatedKingdomResourcesInput {
  kingdom: RemoteKingdomDoc | null | undefined;
  resources: RemoteResourcesDoc | null | undefined;
  population: RemotePopulationDoc | null | undefined;
  populationJobs?: RemotePopulationJobDoc[] | null | undefined;
  armyUnits?: RemoteArmyUnitDoc[] | null | undefined;
  buildings?: RemoteBuildingDoc[] | null | undefined;
  foodTier: string; // Parámetro explícito requerido (P17)
  targetTime?: number; // Hora de referencia inyectable (ms UTC). Si se omite, Date.now()
  callerUserId?: string; // Identificador del usuario que solicita la consulta (P1)
  options?: {
    bypassAuthCheck?: boolean; // Permite omitir control de usuario en pruebas puras aisladas
  };
}

export interface SimulatedKingdomResourcesResult {
  success: boolean;
  error?: string;
  kingdomId?: string;
  userId?: string;
  targetTime?: number;
  lastUpdated?: number;
  elapsedSeconds?: number;
  simulatedResources?: KingdomResources;
  originalResources?: KingdomResources;
  productionAndConsumption?: {
    dailyFoodProduction: number;
    dailyFoodConsumption: number;
    dailyFoodNetSurplus: number;
    effectiveAgricultureWorkers: number;
  };
  foodProductionCapacityPending?: boolean;
  exhaustionMetrics?: {
    secondsToExhaustion: number | null;
    starvationSeconds: number;
    isStarving: boolean;
  };
  militaryClassification?: MilitaryClassification;
}

export function calculateSimulatedKingdomResources(
  input: SimulatedKingdomResourcesInput
): SimulatedKingdomResourcesResult {
  // 1. Verificación de autorización estricta (P1)
  if (!input.options?.bypassAuthCheck) {
    const cleanCaller = typeof input.callerUserId === "string" ? input.callerUserId.trim() : "";
    if (!cleanCaller) {
      return {
        success: false,
        error: "Autenticación requerida: No se proporcionó una identidad de usuario válida para consultar el reino.",
      };
    }
    if (!input.kingdom || input.kingdom.userId !== cleanCaller) {
      return {
        success: false,
        error: "No autorizado: el reino no pertenece al usuario autenticado.",
      };
    }
  }

  // 2. Adaptación y validación de los documentos relacionales
  const adapterResult = adaptRemoteDocumentsToEconomicState({
    kingdom: input.kingdom,
    resources: input.resources,
    population: input.population,
    populationJobs: input.populationJobs,
    armyUnits: input.armyUnits,
    buildings: input.buildings,
    foodTier: input.foodTier,
  });

  if (!adapterResult.success || !adapterResult.kingdomState) {
    return {
      success: false,
      error: adapterResult.error ?? "Fallo en la adaptación de documentos relacionales.",
    };
  }

  // 3. Validación de targetTime inyectable
  const targetTime = typeof input.targetTime === "number" ? input.targetTime : Date.now();
  if (!Number.isFinite(targetTime) || targetTime < 0) {
    return {
      success: false,
      error: `Marca temporal de consulta ('targetTime') inválida: debe ser un número finito no negativo (recibido: ${input.targetTime}).`,
    };
  }

  // 4. Ejecución autoritativa de la simulación continua (P2, P66, P67)
  const sim = simulateEconomicProgress(adapterResult.kingdomState, targetTime);

  return {
    success: true,
    kingdomId: input.kingdom!._id,
    userId: adapterResult.kingdomState.userId,
    targetTime,
    lastUpdated: adapterResult.kingdomState.lastUpdated,
    elapsedSeconds: sim.elapsedSeconds,
    simulatedResources: sim.updatedResources,
    originalResources: adapterResult.kingdomState.resources,
    productionAndConsumption: {
      dailyFoodProduction: sim.dailyFoodProduction,
      dailyFoodConsumption: sim.dailyFoodConsumption,
      dailyFoodNetSurplus: sim.dailyFoodNetSurplus,
      effectiveAgricultureWorkers: sim.effectiveAgricultureWorkers,
    },
    foodProductionCapacityPending: adapterResult.kingdomState.foodProductionWorkerLimit === null,
    exhaustionMetrics: {
      secondsToExhaustion: sim.secondsToExhaustion,
      starvationSeconds: sim.starvationSeconds,
      isStarving: sim.starvationSeconds > 0 || sim.updatedResources.food <= 0,
    },
    militaryClassification: adapterResult.militaryClassification,
  };
}

/**
 * ============================================================================
 * ETAPA 2: LIQUIDACIÓN ECONÓMICA PERSISTENTE AUTORITATIVA (LÓGICA PURA)
 * ============================================================================
 * Función determinista que calcula el resultado de la liquidación de recursos
 * sobre los documentos relacionales reales de Convex.
 *
 * Requisitos y salvaguardas aplicadas:
 * 1. P1: Valida propiedad y concordancia de identidad si se suministra callerUserId.
 * 2. P2: 86.400 segundos reales = 1 año de juego.
 * 3. P3: Solo se liquida la comida (el único recurso con producción/consumo aprobado).
 *    Madera, piedra, hierro y oro quedan rigurosamente inalterados.
 * 4. P17: Respeta foodTier oficial ("normal" por defecto si no está persistido).
 * 5. P18: Respeta factor militar de 1,05 en soldados regulares vivos.
 * 6. Primera inicialización: sincroniza lastUpdated al tiempo actual con delta 0.
 * 7. Procesa el intervalo completo desde lastUpdated, también tras periodos largos offline.
 * 8. No negatividad estricta: piso en 0 para comida, activando isStarving si se agota.
 */
export interface RemoteBuildingDoc {
  _id?: string;
  kingdomId: string;
  buildingType: string;
  level: number;
}

export interface SettlementInput {
  kingdom: RemoteKingdomDoc | null | undefined;
  resources: RemoteResourcesDoc | null | undefined;
  population: RemotePopulationDoc | null | undefined;
  populationJobs?: RemotePopulationJobDoc[] | null | undefined;
  armyUnits?: RemoteArmyUnitDoc[] | null | undefined;
  buildings?: RemoteBuildingDoc[] | null | undefined;
  currentServerTimeMs: number;
  options?: {
    isFirstInitialization?: boolean;
    callerUserId?: string;
    overrideFoodTier?: ValidFoodTier;
  };
}

export interface SettlementResult {
  success: boolean;
  error?: string;
  kingdomId?: string;
  userId?: string;
  updatedFood?: number;
  foodDelta?: number;
  isStarving?: boolean;
  starvationSeconds?: number;
  secondsToExhaustion?: number | null;
  elapsedSeconds?: number;
  effectiveTimeMs?: number;
  cappedInterval?: boolean;
  dailyNetSurplus?: number;
  appliedFoodTier?: string;
}

export function calculateSettlementProgress(input: SettlementInput): SettlementResult {
  // 1. Verificación obligatoria de presencia de documentos raíz
  if (!input.kingdom) {
    return { success: false, error: "Documento de reino ('kingdom') ausente o nulo." };
  }
  if (!input.resources) {
    return { success: false, error: "Documento de recursos ('resources') ausente o nulo." };
  }
  if (!input.population) {
    return { success: false, error: "Documento de población ('population') ausente o nulo." };
  }

  // 2. Control de autorización si se especifica callerUserId (P1)
  if (input.options?.callerUserId) {
    const cleanCaller = input.options.callerUserId.trim();
    if (input.kingdom.userId !== cleanCaller) {
      return {
        success: false,
        error: "No autorizado: el reino no pertenece al usuario autenticado.",
      };
    }
  }

  // 3. Resolución del régimen alimentario (P17, Req 8)
  // Soporta overrideFoodTier (para transiciones de régimen), valor persistido en kingdom o defecto "normal" (1.00)
  const rawTier =
    input.options?.overrideFoodTier ||
    (input.kingdom as any).foodTier ||
    (input.resources as any).foodTier;
  const foodTier: ValidFoodTier = isValidFoodTier(rawTier) ? rawTier : "normal";

  // 4. Adaptación y validación de los documentos relacionales
  const adapterResult = adaptRemoteDocumentsToEconomicState({
    kingdom: input.kingdom,
    resources: input.resources,
    population: input.population,
    populationJobs: input.populationJobs,
    armyUnits: input.armyUnits,
    buildings: input.buildings,
    foodTier,
  });

  if (!adapterResult.success || !adapterResult.kingdomState) {
    return {
      success: false,
      error: adapterResult.error ?? "Fallo en la adaptación de documentos relacionales.",
    };
  }

  const kingdomState = adapterResult.kingdomState;
  const now = input.currentServerTimeMs;

  if (!Number.isFinite(now) || now < 0) {
    return {
      success: false,
      error: `Marca temporal de servidor ('currentServerTimeMs') inválida (recibido: ${now}).`,
    };
  }

  // 5. Caso especial: Primera inicialización de salvaguarda (Req 2)
  // Establece una referencia temporal inicial sin alterar recursos ni adeudamiento histórico
  const isFirstInit =
    input.options?.isFirstInitialization === true ||
    (input.resources as any)?.settlementInitialized === false ||
    kingdomState.lastUpdated <= 0;

  if (isFirstInit) {
    return {
      success: true,
      kingdomId: input.kingdom._id,
      userId: kingdomState.userId,
      updatedFood: kingdomState.resources.food,
      foodDelta: 0,
      isStarving: kingdomState.resources.food <= 0,
      starvationSeconds: 0,
      secondsToExhaustion: null,
      elapsedSeconds: 0,
      effectiveTimeMs: now,
      cappedInterval: false,
      dailyNetSurplus: 0,
      appliedFoodTier: foodTier,
    };
  }

  // 6. Procesa todo el tiempo transcurrido; el cálculo es analítico y no iterativo.
  const effectiveTimeMs = now;
  const elapsedSeconds = Math.max(0, now - kingdomState.lastUpdated) / 1000;
  const cappedInterval = false;

  // 7. Simulación autoritativa del progreso (analítica exacta sin bucles)
  const sim = simulateEconomicProgress(kingdomState, effectiveTimeMs);
  const updatedFood = sim.updatedResources.food; // Garantizado >= 0
  const isStarving = sim.starvationSeconds > 0 || updatedFood <= 0;
  const foodDelta = updatedFood - kingdomState.resources.food;

  return {
    success: true,
    kingdomId: input.kingdom._id,
    userId: kingdomState.userId,
    updatedFood,
    foodDelta,
    isStarving,
    starvationSeconds: sim.starvationSeconds,
    secondsToExhaustion: sim.secondsToExhaustion,
    elapsedSeconds,
    effectiveTimeMs,
    cappedInterval,
    dailyNetSurplus: sim.dailyFoodNetSurplus,
    appliedFoodTier: foodTier,
  };
}

/**
 * Lógica pura de transición atómica de régimen alimentario (Req 6):
 * 1. Comprueba validez del nuevo régimen según P17.
 * 2. Liquida primero el intervalo transcurrido con el régimen vigente.
 * 3. Prepara la persistencia del nuevo régimen para regir a partir de esa marca temporal.
 */
export interface RegimeChangeInput {
  kingdom: RemoteKingdomDoc | null | undefined;
  resources: RemoteResourcesDoc | null | undefined;
  population: RemotePopulationDoc | null | undefined;
  populationJobs?: RemotePopulationJobDoc[] | null | undefined;
  armyUnits?: RemoteArmyUnitDoc[] | null | undefined;
  buildings?: RemoteBuildingDoc[] | null | undefined;
  newFoodTier: string;
  currentServerTimeMs: number;
  options?: {
    isFirstInitialization?: boolean;
    callerUserId?: string;
  };
}

export interface RegimeChangeResult {
  success: boolean;
  error?: string;
  kingdomId?: string;
  userId?: string;
  previousFoodTier?: ValidFoodTier;
  newFoodTier?: ValidFoodTier;
  settledFood?: number;
  foodDelta?: number;
  isStarving?: boolean;
  starvationSeconds?: number;
  elapsedSeconds?: number;
  timestamp?: number;
}

export function executeRegimeChangeTransition(input: RegimeChangeInput): RegimeChangeResult {
  if (!isValidFoodTier(input.newFoodTier)) {
    return {
      success: false,
      error: `Régimen alimentario inválido '${input.newFoodTier}'. Permitidos: ${VALID_FOOD_TIERS.join(", ")}.`,
    };
  }

  // 1. Identificar el régimen anterior (por defecto "normal" si no existía)
  const previousTier: ValidFoodTier = isValidFoodTier((input.kingdom as any)?.foodTier)
    ? (input.kingdom as any).foodTier
    : "normal";

  // 2. Liquidar el intervalo anterior usando el régimen previo
  const settlement = calculateSettlementProgress({
    kingdom: input.kingdom,
    resources: input.resources,
    population: input.population,
    populationJobs: input.populationJobs,
    armyUnits: input.armyUnits,
    buildings: input.buildings,
    currentServerTimeMs: input.currentServerTimeMs,
    options: {
      isFirstInitialization: input.options?.isFirstInitialization,
      callerUserId: input.options?.callerUserId,
      overrideFoodTier: previousTier,
    },
  });

  if (!settlement.success || settlement.updatedFood === undefined) {
    return {
      success: false,
      error: settlement.error ?? "Fallo al liquidar el intervalo previo al cambio de régimen.",
    };
  }

  return {
    success: true,
    kingdomId: input.kingdom?._id,
    userId: input.kingdom?.userId,
    previousFoodTier: previousTier,
    newFoodTier: input.newFoodTier,
    settledFood: settlement.updatedFood,
    foodDelta: settlement.foodDelta,
    isStarving: settlement.isStarving,
    starvationSeconds: settlement.starvationSeconds,
    elapsedSeconds: settlement.elapsedSeconds,
    timestamp: input.currentServerTimeMs,
  };
}
