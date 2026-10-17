/**
 * LA CONQUISTA — MOTOR ECONÓMICO BASE (CÁLCULOS PUROS Y VALIDACIONES)
 * Implementación desacoplada de la lógica matemática y reglas de validación.
 * Respeta la autoridad del servidor (P66, P67), equivalencia temporal (P2),
 * recursos principales (P3), censo inicial (P10) y factor militar de consumo (P18).
 */

// Constantes oficiales de la especificación maestra
export const SECONDS_PER_GAME_YEAR = 86400; // 1 día real (86.400 s) = 1 año de juego (OFICIAL, P2)
export const MILITARY_FOOD_FACTOR = 1.05; // Soldados regulares consumen exactamente 5% más (OFICIAL, P18)

// Tasas aprobadas para esta economía: 1 ración por habitante y 2 por agricultor/día real.
export const BASE_FOOD_CONSUMPTION_PER_DAY = 1.0;
export const BASE_AGRICULTURE_PRODUCTIVITY_PER_DAY = 2.0;

/**
 * Regímenes alimentarios: Los cuatro regímenes (mínima, normal, abundante, excelente)
 * están definidos conceptualmente en P17.
 * Valores oficiales aprobados en especificación:
 * - Mínima: 0,75
 * - Normal: 1,00
 * - Abundante: 1,10
 * - Excelente: 1,20
 */
export const DEFAULT_FOOD_TIER = "normal";
export const PROVISIONAL_DEFAULT_FOOD_TIER = DEFAULT_FOOD_TIER;

export const FOOD_TIER_FACTORS: Record<string, number> = {
  minima: 0.75,    // OFICIAL APROBADO: Factor 0,75
  normal: 1.00,    // OFICIAL APROBADO: Factor 1,00 (referencia base)
  abundante: 1.10, // OFICIAL APROBADO: Factor 1,10
  excelente: 1.20, // OFICIAL APROBADO: Factor 1,20
};

// Alias de retrocompatibilidad con importaciones existentes
export const PROVISIONAL_FOOD_TIER_FACTORS = FOOD_TIER_FACTORS;

// Los cinco recursos principales oficiales (OFICIAL, P3)
export const VALID_RESOURCE_TYPES = ["gold", "wood", "stone", "iron", "food"] as const;
export type ResourceType = (typeof VALID_RESOURCE_TYPES)[number];

export function isValidResourceType(resourceType: string): resourceType is ResourceType {
  return VALID_RESOURCE_TYPES.includes(resourceType as ResourceType);
}

export interface WorkersDistribution {
  agriculture: number;
  wood: number;
  stone: number;
  iron: number;
  gold: number;
  other: number;
}

export interface KingdomResources {
  gold: number;
  wood: number;
  stone: number;
  iron: number;
  food: number;
}

export interface KingdomState {
  userId: string;
  name: string;
  population: number;
  regularSoldiers: number;
  workers: WorkersDistribution;
  unassignedCivil: number;
  resources: KingdomResources;
  foodTier: "minima" | "normal" | "abundante" | "excelente";
  lastUpdated: number;
  foodProductionWorkerLimit?: number | null;
  /** Trabajadores por oficio tal como están persistidos (incluye profesiones sin producción, M-07). */
  jobCounts?: Record<string, number>;
  createdAt?: number;
}

// Configuración inicial de prueba acordada en Bloque 7.1
export const INITIAL_KINGDOM_CONFIG: Omit<KingdomState, "userId" | "name" | "lastUpdated" | "createdAt"> = {
  population: 2000, // OFICIAL (P10)
  regularSoldiers: 0, // Propuesta provisional: inicio 100% civil
  workers: {
    agriculture: 1100, // 55% de la población (superávit inicial)
    wood: 250,
    stone: 250,
    iron: 100,
    gold: 50,
    other: 0,
  },
  unassignedCivil: 250, // 12.5% de reserva civil libre
  resources: {
    gold: 500,
    wood: 1000,
    stone: 800,
    iron: 250,
    food: 2500, // Reserva inicial para cubrir arranque
  },
  foodTier: PROVISIONAL_DEFAULT_FOOD_TIER, // Régimen inicial provisional (decisión de diseño y balance)
};

/**
 * Valida la integridad estricta de la población (Bloque 1, P10).
 * Requisitos:
 * 1. Todos los valores deben ser números enteros (no fraccionarios).
 * 2. Ningún valor puede ser negativo.
 * 3. La suma de soldados regulares + todos los trabajadores + reserva libre debe ser exactamente igual a la población total.
 */
export function validatePopulationIntegrity(
  population: number,
  regularSoldiers: number,
  workers: WorkersDistribution,
  unassignedCivil: number
): { valid: boolean; error?: string } {
  if (!Number.isInteger(population) || population < 0) {
    return { valid: false, error: "La población debe ser un número entero no negativo." };
  }
  if (!Number.isInteger(regularSoldiers) || regularSoldiers < 0) {
    return { valid: false, error: "Los soldados regulares deben ser un número entero no negativo." };
  }
  if (!Number.isInteger(unassignedCivil) || unassignedCivil < 0) {
    return { valid: false, error: "La reserva civil libre debe ser un número entero no negativo." };
  }

  const workerEntries = Object.entries(workers) as [keyof WorkersDistribution, number][];
  for (const [key, count] of workerEntries) {
    if (!Number.isInteger(count) || count < 0) {
      return { valid: false, error: `La asignación de trabajadores en '${key}' debe ser un entero no negativo.` };
    }
  }

  const totalWorkers = workerEntries.reduce((sum, [, count]) => sum + count, 0);
  const totalAccounted = regularSoldiers + totalWorkers + unassignedCivil;

  if (totalAccounted !== population) {
    return {
      valid: false,
      error: `Inconsistencia demográfica: soldados (${regularSoldiers}) + trabajadores (${totalWorkers}) + reserva (${unassignedCivil}) = ${totalAccounted}, lo cual no coincide con la población total (${population}).`,
    };
  }

  return { valid: true };
}

/**
 * Valida que una estructura de recursos contenga los cinco recursos principales oficiales,
 * y que todos sean números finitos y no negativos (Bloque 3, 5 y 6).
 */
export function validateKingdomResources(resources: KingdomResources): { valid: boolean; error?: string } {
  if (!resources || typeof resources !== "object") {
    return { valid: false, error: "El objeto de recursos no es válido." };
  }

  for (const res of VALID_RESOURCE_TYPES) {
    const val = resources[res];
    if (typeof val !== "number" || !Number.isFinite(val) || Number.isNaN(val)) {
      return { valid: false, error: `El recurso '${res}' debe ser un número finito válido.` };
    }
    if (val < 0) {
      return { valid: false, error: `El recurso '${res}' no puede ser negativo (valor: ${val}).` };
    }
  }

  return { valid: true };
}

/**
 * Valida los parámetros de un gasto puntual (Bloque 5).
 */
export function validateSpendParameters(
  resourceType: string,
  amount: number,
  reason: string
): { valid: boolean; error?: string } {
  if (!isValidResourceType(resourceType)) {
    return { valid: false, error: `Tipo de recurso no válido: '${resourceType}'. Solo se permiten: ${VALID_RESOURCE_TYPES.join(", ")}.` };
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || Number.isNaN(amount) || amount <= 0) {
    return { valid: false, error: "El monto del gasto debe ser un número positivo finito." };
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { valid: false, error: "El motivo del gasto ('reason') es obligatorio y no puede estar vacío." };
  }

  return { valid: true };
}

/**
 * Evalúa la lógica pura de deduplicación de una transacción idempotente.
 * IDENTIDAD DE LA OPERACIÓN (Idempotencia estricta, Bloque 5):
 * Una operación idempotente queda unívocamente identificada por:
 *   1. Clave de idempotencia (`idempotencyKey`)
 *   2. Identificador de reino (`kingdomId`)
 *   3. Tipo de recurso (`resourceType`)
 *   4. Monto a descontar (`amount`)
 *   5. Motivo o concepto de la operación (`reason`) — obligatorio en transacción previa y en solicitud
 * COMPORTAMIENTO:
 * - Repetición idéntica (misma clave, mismo recurso, mismo monto, mismo motivo no vacío):
 *   Retorna `isDuplicate: true, matchesPayload: true`. NO descuenta recursos otra vez.
 * - Conflicto de idempotencia (misma clave con recurso, monto o motivo diferente, o motivo ausente/vacío):
 *   Retorna `isDuplicate: true, matchesPayload: false` con error explicativo. La operación debe ser RECHAZADA.
 * - Operación nueva:
 *   Retorna `isDuplicate: false, matchesPayload: false`.
 */
export function evaluateIdempotentTransaction(
  existingTx: { resourceType: string; amount: number; reason: string } | null | undefined,
  requestedResourceType: string,
  requestedAmount: number,
  requestedReason: string
): { isDuplicate: boolean; matchesPayload: boolean; error?: string } {
  if (!existingTx) {
    return { isDuplicate: false, matchesPayload: false };
  }

  const matchesResource = existingTx.resourceType === requestedResourceType;
  const matchesAmount = existingTx.amount === requestedAmount;

  // "reason" es obligatorio tanto en la transacción previa como en la solicitud.
  // Se rechaza si cualquiera de los motivos está ausente o vacío, o si no coinciden.
  const cleanExistingReason = typeof existingTx.reason === "string" ? existingTx.reason.trim() : "";
  const cleanRequestedReason = typeof requestedReason === "string" ? requestedReason.trim() : "";
  const hasBothReasons = cleanExistingReason.length > 0 && cleanRequestedReason.length > 0;
  const matchesReason = hasBothReasons && cleanExistingReason === cleanRequestedReason;

  const matchesPayload = matchesResource && matchesAmount && matchesReason;

  if (!matchesPayload) {
    const details: string[] = [];
    if (!matchesResource) {
      details.push(`recurso '${existingTx.resourceType}' vs '${requestedResourceType}'`);
    }
    if (!matchesAmount) {
      details.push(`monto ${existingTx.amount} vs ${requestedAmount}`);
    }
    if (!matchesReason) {
      if (!hasBothReasons) {
        details.push(
          `motivo obligatorio ausente o vacío (existente: '${cleanExistingReason}', solicitado: '${cleanRequestedReason}')`
        );
      } else {
        details.push(`motivo '${cleanExistingReason}' vs '${cleanRequestedReason}'`);
      }
    }
    return {
      isDuplicate: true,
      matchesPayload: false,
      error: `Conflicto de idempotencia: La clave ya fue registrada previamente con datos diferentes (${details.join(", ")}). Reutilización de clave prohibida.`,
    };
  }

  return { isDuplicate: true, matchesPayload: true };
}

/**
 * Simulación económica temporal continua asíncrona.
 * Modela la evolución de reservas según el tiempo transcurrido en el servidor.
 * Tratamiento de agotamiento de comida y tiempo transcurrido (Bloque 6):
 * - Impide saldos negativos de existencias (piso estricto en 0).
 * - En caso de déficit alimentario:
 *   * Si initialFood > theoreticalDeficit: reservas cubren el intervalo (secondsToExhaustion = null, starvationSeconds = 0).
 *   * Si initialFood === theoreticalDeficit (límite exacto al final): secondsToExhaustion = elapsedSeconds, starvationSeconds = 0, updatedFood = 0.
 *   * Si initialFood < theoreticalDeficit: secondsToExhaustion < elapsedSeconds, starvationSeconds = elapsedSeconds - secondsToExhaustion, updatedFood = 0.
 * PERSISTENCIA Y CONSULTA DEL TIEMPO SIN COMIDA:
 * - El motor actual calcula `starvationSeconds` y `secondsToExhaustion` DINÁMICAMENTE para el intervalo
 *   comprendido entre `lastUpdated` y la llamada actual (`currentServerTimeMs`).
 * - ALERTA DE ARQUITECTURA / DISEÑO PENDIENTE: Si el reino se sincroniza o modifica varias veces mientras
 *   las reservas de comida permanecen en 0, `lastUpdated` avanzará al instante de cada sincronización.
 *   Dado que la tabla `kingdoms` NO dispone actualmente de un campo acumulador persistente
 *   (por ejemplo `accumulatedStarvationSeconds` o `depletedSinceTimestamp`), el historial de tiempo
 *   sin comida acumulado en sincronizaciones anteriores NO QUEDA PERSISTIDO en la base de datos,
 *   sino que se limita al lapso transcurrido desde el último `lastUpdated`.
 *   Cualquier penalización o mecánica dependiente de inanición requerirá persistir dicho campo antes de activarse.
 */
export function simulateEconomicProgress(
  kingdom: {
    population: number;
    regularSoldiers: number;
    workers: WorkersDistribution;
    unassignedCivil: number;
    resources: KingdomResources;
    foodTier: string;
    lastUpdated: number;
    foodProductionWorkerLimit?: number | null;
  },
  currentServerTimeMs: number,
  /** Multiplicador de producción agrícola (tecnologías, terreno, productividad); 1 por defecto. */
  foodProductionMultiplier: number = 1,
  /** Multiplicador de consumo de alimentos (panadería, M-07); 1 por defecto. */
  foodConsumptionMultiplier: number = 1
) {
  // 1. Intervalo temporal en segundos reales validado por servidor (P66, P67)
  const elapsedMs = Math.max(0, currentServerTimeMs - kingdom.lastUpdated);
  const elapsedSeconds = elapsedMs / 1000;
  const timeFractionOfDay = elapsedSeconds / SECONDS_PER_GAME_YEAR;

  // 2. Factor de alimentación: "normal" como referencia provisional de cálculo (= 1.0); otros son propuestas de balance
  const tierFactor = PROVISIONAL_FOOD_TIER_FACTORS[kingdom.foodTier] ?? 1.0;

  // Los puestos laborales no son tropas: solo Armyunits recibe el recargo P18.
  const civilPopulation = Math.max(0, kingdom.population - kingdom.regularSoldiers);
  const regularSoldiers = Math.max(0, kingdom.regularSoldiers);

  // 4. Tasas de consumo diario (P18: soldados regulares consumen exactamente 1,05x)
  const consumptionMultiplier = Number.isFinite(foodConsumptionMultiplier) && foodConsumptionMultiplier > 0 ? foodConsumptionMultiplier : 1;
  const civilDailyConsumption = civilPopulation * BASE_FOOD_CONSUMPTION_PER_DAY * tierFactor * consumptionMultiplier;
  const militaryDailyConsumption = regularSoldiers * (BASE_FOOD_CONSUMPTION_PER_DAY * MILITARY_FOOD_FACTOR) * tierFactor * consumptionMultiplier;
  const totalDailyConsumption = civilDailyConsumption + militaryDailyConsumption;

  // La tasa aprobada se aplica por agricultor; falta un campo y fórmula aprobados para limitarla por edificios.
  const effectiveAgricultureWorkers = kingdom.foodProductionWorkerLimit === undefined
    ? kingdom.workers.agriculture
    : kingdom.foodProductionWorkerLimit === null
      ? 0
      : Math.min(kingdom.workers.agriculture, kingdom.foodProductionWorkerLimit);
  const safeMultiplier = Number.isFinite(foodProductionMultiplier) && foodProductionMultiplier >= 0 ? foodProductionMultiplier : 1;
  const totalDailyFoodProduction = effectiveAgricultureWorkers * BASE_AGRICULTURE_PRODUCTIVITY_PER_DAY * safeMultiplier;

  // 6. Superávit / déficit neto diario
  const netDailyFoodSurplus = totalDailyFoodProduction - totalDailyConsumption;

  // 7. Cálculo continuo de existencias y análisis de agotamiento (Bloque 6)
  const initialFood = Math.max(0, kingdom.resources.food);
  let updatedFood = initialFood;
  let secondsToExhaustion: number | null = null;
  let starvationSeconds = 0;

  if (netDailyFoodSurplus >= 0) {
    // Caso superávit: acumulación lineal continua sin riesgo de agotamiento
    updatedFood = initialFood + netDailyFoodSurplus * timeFractionOfDay;
  } else {
    // Caso déficit: las reservas se drenan a ritmo constante
    const deficitRatePerSecond = Math.abs(netDailyFoodSurplus) / SECONDS_PER_GAME_YEAR;
    const theoreticalTotalDeficit = deficitRatePerSecond * elapsedSeconds;

    if (initialFood > theoreticalTotalDeficit) {
      // Las existencias alcanzan para cubrir todo el intervalo con remanente positivo
      updatedFood = initialFood - theoreticalTotalDeficit;
      secondsToExhaustion = null;
      starvationSeconds = 0;
    } else {
      // Las existencias se agotan dentro del intervalo o exactamente en el instante final
      secondsToExhaustion = deficitRatePerSecond > 0 ? (initialFood / deficitRatePerSecond) : 0;
      starvationSeconds = Math.max(0, elapsedSeconds - secondsToExhaustion);
      updatedFood = 0; // Suelo estricto en 0: no permite saldos negativos
    }
  }

  return {
    elapsedSeconds,
    timeFractionOfDay,
    dailyFoodProduction: totalDailyFoodProduction,
    effectiveAgricultureWorkers,
    dailyFoodConsumption: totalDailyConsumption,
    dailyFoodNetSurplus: netDailyFoodSurplus,
    secondsToExhaustion,
    starvationSeconds,
    updatedResources: {
      ...kingdom.resources,
      food: Math.max(0, updatedFood),
    },
  };
}
