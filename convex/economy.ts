import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { insertInitialBuildings } from "./buildings";
import { isKingdomOwner } from "./kingdomAccess";
import {
  simulateEconomicProgress,
  validatePopulationIntegrity,
  validateKingdomResources,
  validateSpendParameters,
  evaluateIdempotentTransaction,
  INITIAL_KINGDOM_CONFIG,
  SECONDS_PER_GAME_YEAR,
  BASE_FOOD_CONSUMPTION_PER_DAY,
  BASE_AGRICULTURE_PRODUCTIVITY_PER_DAY,
  MILITARY_FOOD_FACTOR,
  PROVISIONAL_DEFAULT_FOOD_TIER,
  PROVISIONAL_FOOD_TIER_FACTORS,
  FOOD_TIER_FACTORS,
  VALID_RESOURCE_TYPES,
  type WorkersDistribution,
  type KingdomResources,
} from "./economyCalculations";
import {
  calculateSimulatedKingdomResources,
  calculateSettlementProgress,
  executeRegimeChangeTransition,
  calculatePopulationJobReassignment,
  adaptRemoteDocumentsToEconomicState,
  classifyArmyUnits,
  type SettlementResult,
  type RegimeChangeResult,
} from "./economyAdapter";

export {
  calculateSimulatedKingdomResources,
  calculateSettlementProgress,
  executeRegimeChangeTransition,
  type SettlementResult,
  type RegimeChangeResult,
  simulateEconomicProgress,
  validatePopulationIntegrity,
  validateKingdomResources,
  validateSpendParameters,
  evaluateIdempotentTransaction,
  INITIAL_KINGDOM_CONFIG,
  SECONDS_PER_GAME_YEAR,
  BASE_FOOD_CONSUMPTION_PER_DAY,
  BASE_AGRICULTURE_PRODUCTIVITY_PER_DAY,
  MILITARY_FOOD_FACTOR,
  PROVISIONAL_DEFAULT_FOOD_TIER,
  PROVISIONAL_FOOD_TIER_FACTORS,
  FOOD_TIER_FACTORS,
  VALID_RESOURCE_TYPES,
};

/**
 * ============================================================================
 * ESTADO Y LIMITACIONES REALES DE LA AUTENTICACIÓN EN CONVEX:
 * 1. El proveedor de autenticación oficial de Convex (ej. Clerk, Auth0 o JWT
 *    mediante auth.config.ts) AÚN NO HA SIDO CONFIGURADO en este entorno.
 * 2. Se han ELIMINADO por completo las identidades por defecto ("dev-user-default")
 *    y la posibilidad de aceptar un parámetro `userId` enviado por el cliente.
 * 3. Como consecuencia estricta: ninguna mutación o consulta sobre un reino podrá
 *    ejecutarse desde el cliente hasta que se configure formalmente el proveedor
 *    de autenticación, ya que `ctx.auth.getUserIdentity()` devolverá `null` y
 *    lanzará un error de autorización.
 * 4. EL SISTEMA NO DEBE PRESENTARSE COMO LISTO PARA PRODUCCIÓN NI CRIPTOGRÁFICAMENTE
 *    SEGURO hasta completar dicha configuración.
 * ============================================================================
 */
async function requireAuthenticatedUser(ctx: {
  auth: { getUserIdentity: () => Promise<any> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !identity.subject) {
    throw new Error(
      "Autenticación requerida: No se detectó una sesión autenticada en el servidor Convex. " +
      "El proveedor de autenticación (auth.config.ts) aún no está configurado. " +
      "Por estrictas razones de integridad y propiedad (P1), se prohíbe el uso de usuarios provisionales " +
      "o identidades no verificadas enviadas por el cliente."
    );
  }
  return identity.subject;
}

function isWorkersDistribution(value: unknown): value is WorkersDistribution {
  if (!value || typeof value !== "object") return false;
  const workers = value as Record<keyof WorkersDistribution, unknown>;
  return (["agriculture", "wood", "stone", "iron", "gold", "other"] as const).every(
    (job) => Number.isInteger(workers[job]) && (workers[job] as number) >= 0
  );
}

async function readRelationalKingdomState(ctx: any, kingdomId: any) {
  const resources = await ctx.db
    .query("resources" as any)
    .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
    .first();
  const population = await ctx.db
    .query("population" as any)
    .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
    .first();
  const populationJobs = await ctx.db
    .query("populationJobs" as any)
    .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
    .collect();
  const buildings = await ctx.db
    .query("buildings" as any)
    .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
    .collect();

  let armyUnits: any[];
  try {
    armyUnits = await ctx.db
      .query("Armyunits" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();
  } catch {
    armyUnits = await ctx.db
      .query("armyUnits" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();
  }

  return { resources, population, populationJobs, armyUnits, buildings };
}

export async function settleRelationalKingdomEconomy(
  ctx: any,
  kingdom: any,
  callerUserId: string,
  now: number
) {
  const state = await readRelationalKingdomState(ctx, kingdom._id);
  if (!state.resources) throw new Error("No existen recursos para el reino.");
  if (!state.population) throw new Error("No existe documento de población para el reino.");

  const settlement = calculateSettlementProgress({
    kingdom,
    ...state,
    currentServerTimeMs: now,
    options: {
      isFirstInitialization: state.resources.settlementInitialized !== true,
      callerUserId,
    },
  });
  if (!settlement.success || settlement.updatedFood === undefined) {
    throw new Error(settlement.error ?? "Fallo al liquidar la economía relacional.");
  }

  await ctx.db.patch(state.resources._id, {
    food: settlement.updatedFood,
    lastUpdated: settlement.effectiveTimeMs ?? now,
    settlementInitialized: true,
  });
  if (state.population.starving !== settlement.isStarving) {
    await ctx.db.patch(state.population._id, { starving: settlement.isStarving });
  }

  const settledResources: KingdomResources = {
    gold: state.resources.gold,
    wood: state.resources.wood,
    stone: state.resources.stone,
    iron: state.resources.iron,
    food: settlement.updatedFood,
  };
  return { ...state, settlement, settledResources };
}

async function migrateAggregateKingdomState(ctx: any, kingdom: any) {
  const existing = await readRelationalKingdomState(ctx, kingdom._id);
  if (existing.resources || existing.population || existing.populationJobs.length > 0 || existing.armyUnits.length > 0) {
    throw new Error("El reino tiene datos relacionales parciales; requiere conciliación antes de migrar el agregado.");
  }
  const { population, regularSoldiers, workers, unassignedCivil, resources } = kingdom;
  if (
    !Number.isInteger(population) || population < 0 ||
    !Number.isInteger(regularSoldiers) || regularSoldiers < 0 ||
    !isWorkersDistribution(workers) ||
    !Number.isInteger(unassignedCivil) || unassignedCivil < 0 ||
    !resources || !validateKingdomResources(resources).valid
  ) {
    throw new Error("El reino heredado no contiene un estado demográfico y económico completo para migrar.");
  }
  const populationValidation = validatePopulationIntegrity(
    population,
    regularSoldiers,
    workers,
    unassignedCivil
  );
  if (!populationValidation.valid) {
    throw new Error(`Estado agregado incoherente: ${populationValidation.error}`);
  }

  const now = Date.now();
  const legacyResources = resources as KingdomResources;
  await ctx.db.insert("resources" as any, {
    kingdomId: kingdom._id,
    ...legacyResources,
    lastUpdated: typeof kingdom.lastUpdated === "number" ? kingdom.lastUpdated : now,
    settlementInitialized: typeof kingdom.lastUpdated === "number",
  });
  await ctx.db.insert("population" as any, {
    kingdomId: kingdom._id,
    total: population,
    available: unassignedCivil,
  });
  for (const [jobType, assignedCount] of Object.entries(workers)) {
    if (assignedCount > 0) {
      await ctx.db.insert("populationJobs" as any, {
        kingdomId: kingdom._id,
        jobType,
        assignedCount,
      });
    }
  }
  if (regularSoldiers > 0) {
    await ctx.db.insert("Armyunits" as any, {
      kingdomId: kingdom._id,
      unitType: "regular",
      count: regularSoldiers,
    });
  }
}

function legacyKingdomResponse(kingdom: any, state: any) {
  const adapted = adaptRemoteDocumentsToEconomicState({
    kingdom,
    resources: state.resources,
    population: state.population,
    populationJobs: state.populationJobs,
    armyUnits: state.armyUnits,
    buildings: state.buildings,
    foodTier: kingdom.foodTier ?? "normal",
  });
  if (!adapted.success || !adapted.kingdomState) {
    throw new Error(adapted.error ?? "No se pudo adaptar el estado relacional del reino.");
  }
  return {
    ...kingdom,
    population: adapted.kingdomState.population,
    regularSoldiers: adapted.kingdomState.regularSoldiers,
    workers: adapted.kingdomState.workers,
    unassignedCivil: adapted.kingdomState.unassignedCivil,
    resources: {
      ...adapted.kingdomState.resources,
      food: state.settlement?.updatedFood ?? state.resources.food,
    },
    lastUpdated: state.settlement?.effectiveTimeMs ?? state.resources.lastUpdated,
  };
}

/** Inicializa o recupera el reino, migrando su estado heredado al modelo relacional. */
export const getOrInitializeKingdom = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const callerUserId = await requireAuthenticatedUser(ctx);
    const existing = await ctx.db
      .query("kingdoms")
      .withIndex("by_user_id_and_name", (q) =>
        q.eq("userId", callerUserId).eq("name", args.name)
      )
      .first();

    if (existing) {
      const current = await readRelationalKingdomState(ctx, existing._id);
      if (!current.resources && !current.population && current.populationJobs.length === 0 && current.armyUnits.length === 0) {
        await migrateAggregateKingdomState(ctx, existing);
      }
      const now = Date.now();
      const settled = await settleRelationalKingdomEconomy(ctx, existing, callerUserId, now);
      return legacyKingdomResponse(existing, settled);
    }

    const now = Date.now();
    const kingdomId = await ctx.db.insert("kingdoms", {
      userId: callerUserId,
      name: args.name,
      foodTier: INITIAL_KINGDOM_CONFIG.foodTier,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("resources" as any, {
      kingdomId,
      ...INITIAL_KINGDOM_CONFIG.resources,
      lastUpdated: now,
      settlementInitialized: false,
    });
    await ctx.db.insert("population" as any, {
      kingdomId,
      total: INITIAL_KINGDOM_CONFIG.population,
      available: INITIAL_KINGDOM_CONFIG.unassignedCivil,
    });
    for (const [jobType, assignedCount] of Object.entries(INITIAL_KINGDOM_CONFIG.workers)) {
      if (assignedCount > 0) {
        await ctx.db.insert("populationJobs" as any, {
          kingdomId,
          jobType,
          assignedCount,
        });
      }
    }
    await insertInitialBuildings(ctx, kingdomId);
    const kingdom = await ctx.db.get(kingdomId);
    if (!kingdom) throw new Error("No se pudo recuperar el reino recién inicializado.");
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, callerUserId, now);
    return legacyKingdomResponse(kingdom, settled);
  },
});

/** Sincroniza recursos persistidos aplicando la liquidación relacional autoritativa. */
export const syncKingdom = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
  },
  handler: async (ctx, args) => {
    const callerUserId = await requireAuthenticatedUser(ctx);
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    if (!isKingdomOwner(kingdom.userId, callerUserId)) {
      throw new Error("No autorizado: el reino no pertenece al usuario autenticado.");
    }
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, callerUserId, Date.now());
    return {
      kingdomId: args.kingdomId,
      resources: {
        gold: settled.resources.gold,
        wood: settled.resources.wood,
        stone: settled.resources.stone,
        iron: settled.resources.iron,
        food: settled.settlement.updatedFood,
      },
      elapsedSeconds: settled.settlement.elapsedSeconds,
      dailyNetFood: settled.settlement.dailyNetSurplus,
      secondsToExhaustion: settled.settlement.secondsToExhaustion,
      starvationSeconds: settled.settlement.starvationSeconds,
      lastUpdated: settled.settlement.effectiveTimeMs,
    };
  },
});

/** Gasto atómico e idempotente contra los saldos y la tabla de transacciones relacionales. */
export const spendResource = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    idempotencyKey: v.string(),
    resourceType: v.string(), // "gold" | "wood" | "stone" | "iron" | "food"
    amount: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const callerUserId = await requireAuthenticatedUser(ctx);
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    if (!isKingdomOwner(kingdom.userId, callerUserId)) {
      throw new Error("No autorizado: el reino no pertenece al usuario autenticado.");
    }
    const cleanKey = args.idempotencyKey.trim();
    if (!cleanKey) throw new Error("Se requiere una clave de idempotencia ('idempotencyKey') no vacía.");

    const existingTx = await ctx.db
      .query("transactions")
      .withIndex("by_kingdom_and_key", (q) =>
        q.eq("kingdomId", args.kingdomId).eq("idempotencyKey", cleanKey)
      )
      .first();
    if (existingTx) {
      const duplicate = evaluateIdempotentTransaction(
        existingTx,
        args.resourceType,
        args.amount,
        args.reason
      );
      if (!duplicate.matchesPayload) throw new Error(duplicate.error ?? "Conflicto de idempotencia.");
      return {
        success: true,
        idempotentDuplicate: true,
        transactionId: existingTx._id,
        kingdomId: args.kingdomId,
        resourceType: existingTx.resourceType,
        amountDeducted: existingTx.amount,
        message: "Transacción idempotente previa detectada; no se duplicó el cobro.",
      };
    }

    const validation = validateSpendParameters(args.resourceType, args.amount, args.reason);
    if (!validation.valid) throw new Error(validation.error);

    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, callerUserId, Date.now());
    const currentResources = {
      gold: settled.resources.gold,
      wood: settled.resources.wood,
      stone: settled.resources.stone,
      iron: settled.resources.iron,
      food: settled.settlement.updatedFood,
    } as KingdomResources;
    if (currentResources[args.resourceType as keyof KingdomResources] < args.amount) {
      throw new Error(
        `Saldo insuficiente para ${args.resourceType}: disponible ${currentResources[args.resourceType as keyof KingdomResources].toFixed(2)}, requerido ${args.amount}`
      );
    }
    currentResources[args.resourceType as keyof KingdomResources] -= args.amount;
    await ctx.db.patch(settled.resources._id, currentResources);
    const transactionId = await ctx.db.insert("transactions", {
      kingdomId: args.kingdomId,
      idempotencyKey: cleanKey,
      resourceType: args.resourceType,
      amount: args.amount,
      reason: args.reason,
      createdAt: Date.now(),
    });
    return {
      success: true,
      idempotentDuplicate: false,
      transactionId,
      kingdomId: args.kingdomId,
      resourceType: args.resourceType,
      amountDeducted: args.amount,
      remainingAmount: currentResources[args.resourceType as keyof KingdomResources],
    };
  },
});

/** Mantiene la firma heredada, persistiendo ahora la distribución relacional. */
export const reassignWorkers = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    newWorkers: v.object({
      agriculture: v.number(),
      wood: v.number(),
      stone: v.number(),
      iron: v.number(),
      gold: v.number(),
      other: v.number(),
    }),
    newRegularSoldiers: v.number(),
  },
  handler: async (ctx, args) => {
    const callerUserId = await requireAuthenticatedUser(ctx);
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    if (!isKingdomOwner(kingdom.userId, callerUserId)) {
      throw new Error("No autorizado: el reino no pertenece al usuario autenticado.");
    }

    if (!isWorkersDistribution(args.newWorkers)) {
      throw new Error("Las asignaciones deben ser enteros no negativos.");
    }
    if (!Number.isInteger(args.newRegularSoldiers) || args.newRegularSoldiers < 0) {
      throw new Error("Los soldados regulares deben ser un entero no negativo.");
    }

    const current = await readRelationalKingdomState(ctx, kingdom._id);
    if (!current.population) throw new Error("No existe documento de población para el reino.");
    const military = classifyArmyUnits(current.armyUnits);
    if (args.newRegularSoldiers !== military.regularSoldiers) {
      throw new Error(
        "La reasignación laboral no puede crear ni retirar tropas; los efectivos se leen de Armyunits."
      );
    }

    const legacyJobTypes = Object.keys(args.newWorkers);
    const existingByType = new Map<string, any>();
    let totalAssigned = 0;
    let previousLegacyAssigned = 0;
    const seenJobTypes = new Set<string>();
    for (const job of current.populationJobs) {
      if (typeof job.jobType !== "string") throw new Error("Tipo de oficio persistido inválido.");
      const normalizedJobType = job.jobType.trim().toLowerCase();
      if (!normalizedJobType || seenJobTypes.has(normalizedJobType)) {
        throw new Error(`Hay un tipo de oficio vacío o duplicado ('${job.jobType}').`);
      }
      if (!Number.isInteger(job.assignedCount) || job.assignedCount < 0) {
        throw new Error(`La asignación persistida de '${job.jobType}' no es válida.`);
      }
      if (job.kingdomId !== kingdom._id) {
        throw new Error("Hay una asignación laboral asociada a otro reino.");
      }
      seenJobTypes.add(normalizedJobType);
      totalAssigned += job.assignedCount;
      if (legacyJobTypes.includes(normalizedJobType)) {
        previousLegacyAssigned += job.assignedCount;
        existingByType.set(normalizedJobType, job);
      }
    }
    if (
      !Number.isInteger(current.population.total) ||
      !Number.isInteger(current.population.available) ||
      current.population.total < 0 ||
      current.population.available < 0 ||
      totalAssigned + current.population.available + military.regularSoldiers > current.population.total
    ) {
      throw new Error("El estado laboral y militar persistido excede el censo disponible.");
    }
    const requestedLegacyAssigned = Object.values(args.newWorkers).reduce((sum, count) => sum + count, 0);
    const available = current.population.available + previousLegacyAssigned - requestedLegacyAssigned;
    if (available < 0) {
      throw new Error("No hay suficientes habitantes disponibles para esta reasignación.");
    }
    const unchanged = legacyJobTypes.every(
      (jobType) =>
        (existingByType.get(jobType)?.assignedCount ?? 0) === args.newWorkers[jobType as keyof WorkersDistribution]
    ) && current.population.available === available;
    if (unchanged) {
      return {
        success: true,
        population: current.population.total,
        regularSoldiers: military.regularSoldiers,
        workers: args.newWorkers,
        unassignedCivil: available,
        changed: false,
      };
    }

    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, callerUserId, now);
    for (const jobType of legacyJobTypes) {
      const assignedCount = args.newWorkers[jobType as keyof WorkersDistribution];
      const existingJob = existingByType.get(jobType);
      if (assignedCount > 0 && existingJob) {
        await ctx.db.patch(existingJob._id, { assignedCount });
      } else if (assignedCount > 0) {
        await ctx.db.insert("populationJobs" as any, {
          kingdomId: kingdom._id,
          jobType,
          assignedCount,
        });
      } else if (existingJob) {
        await ctx.db.delete(existingJob._id);
      }
    }
    await ctx.db.patch(current.population._id, { available });

    return {
      success: true,
      population: current.population.total,
      regularSoldiers: military.regularSoldiers,
      workers: args.newWorkers,
      unassignedCivil: available,
      simulatedResources: {
        gold: settled.resources.gold,
        wood: settled.resources.wood,
        stone: settled.resources.stone,
        iron: settled.resources.iron,
        food: settled.settlement.updatedFood,
      },
      lastUpdated: settled.settlement.effectiveTimeMs ?? now,
      changed: true,
    };
  },
});

/**
 * Reasigna un oficio desde el modelo relacional, liquidando primero el periodo
 * previo con la distribución anterior en la misma transacción Convex.
 */
export const reassignPopulationJob = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    jobType: v.string(),
    assignedCount: v.number(),
  },
  handler: async (ctx, args) => {
    const callerUserId = await requireAuthenticatedUser(ctx);
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    if (!isKingdomOwner(kingdom.userId, callerUserId)) {
      throw new Error("No autorizado: el reino no pertenece al usuario autenticado.");
    }

    const current = await readRelationalKingdomState(ctx, kingdom._id);
    const population = current.population;
    if (!population) throw new Error("No existe documento de población para el reino.");

    const reassignment = calculatePopulationJobReassignment({
      populationTotal: population.total,
      available: population.available,
      populationJobs: current.populationJobs,
      jobType: args.jobType,
      assignedCount: args.assignedCount,
      kingdomId: kingdom._id,
    });
    if (!reassignment.success || !reassignment.jobType ||
      reassignment.assignedCount === undefined ||
      reassignment.previousAssignedCount === undefined ||
      reassignment.available === undefined ||
      !reassignment.persistence) {
      throw new Error(reassignment.error ?? "Reasignación de trabajadores inválida.");
    }

    if (reassignment.persistence.operation === "unchanged") {
      return {
        success: true,
        kingdomId: kingdom._id,
        jobType: reassignment.jobType,
        assignedCount: reassignment.assignedCount,
        available: reassignment.available,
        changed: false,
      };
    }

    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, callerUserId, now);
    if (reassignment.persistence.operation === "update" && reassignment.persistence.jobId) {
      await ctx.db.patch(reassignment.persistence.jobId as any, {
        assignedCount: reassignment.assignedCount,
      });
    } else if (reassignment.persistence.operation === "insert") {
      await ctx.db.insert("populationJobs" as any, {
        kingdomId: kingdom._id,
        jobType: reassignment.jobType,
        assignedCount: reassignment.assignedCount,
      });
    } else if (reassignment.persistence.operation === "delete" && reassignment.persistence.jobId) {
      await ctx.db.delete(reassignment.persistence.jobId as any);
    } else {
      throw new Error("No se pudo construir un plan válido para persistir la reasignación.");
    }
    await ctx.db.patch(population._id, { available: reassignment.available });

    return {
      success: true,
      kingdomId: kingdom._id,
      jobType: reassignment.jobType,
      assignedCount: reassignment.assignedCount,
      available: reassignment.available,
      settledFood: settled.settlement.updatedFood,
      lastUpdated: settled.settlement.effectiveTimeMs ?? now,
      changed: true,
    };
  },
});

/**
 * Consulta del estado del reino proyectado al tiempo actual del servidor (interpolación reactiva).
 */
export const getKingdom = query({
  args: {
    kingdomId: v.id("kingdoms"),
  },
  handler: async (ctx, args) => {
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) return null;

    const callerUserId = await requireAuthenticatedUser(ctx);
    if (!isKingdomOwner(kingdom.userId, callerUserId)) {
      throw new Error("No autorizado: el reino pertenece a otro usuario.");
    }

    const resources = await ctx.db
      .query("resources" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdom._id))
      .first();
    const population = await ctx.db
      .query("population" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdom._id))
      .first();
    const populationJobs = await ctx.db
      .query("populationJobs" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdom._id))
      .collect();

    let armyUnits: any[];
    try {
      armyUnits = await ctx.db
        .query("Armyunits" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), kingdom._id))
        .collect();
    } catch {
      armyUnits = await ctx.db
        .query("armyUnits" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), kingdom._id))
        .collect();
    }

    const now = Date.now();
    const simulation = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      populationJobs,
      armyUnits,
      foodTier: kingdom.foodTier ?? "normal",
      targetTime: now,
      callerUserId,
    });
    if (!simulation.success || !simulation.simulatedResources || !simulation.productionAndConsumption) {
      throw new Error(simulation.error ?? "No se pudo proyectar la economía relacional.");
    }

    return {
      ...kingdom,
      simulatedResources: simulation.simulatedResources,
      metrics: {
        dailyFoodProduction: simulation.productionAndConsumption.dailyFoodProduction,
        dailyFoodConsumption: simulation.productionAndConsumption.dailyFoodConsumption,
        dailyFoodNetSurplus: simulation.productionAndConsumption.dailyFoodNetSurplus,
        secondsSinceLastSync: simulation.elapsedSeconds,
        secondsToExhaustion: simulation.exhaustionMetrics?.secondsToExhaustion ?? null,
        starvationSeconds: simulation.exhaustionMetrics?.starvationSeconds ?? 0,
      },
    };
  },
});

/**
 * Consulta autoritativa proyectada del estado económico del reino (Etapa 1B).
 * Opera sobre las tablas relacionales normalizadas ('kingdoms', 'resources', 'population', 'populationJobs', 'Armyunits').
 * Es una consulta de SOLO LECTURA (sin escrituras ni mutaciones en DB).
 * Requisitos y garantías:
 * 1. Control de autorización estricto (P1): exige que el usuario autenticado sea el propietario del reino.
 * 2. Simulación temporal continua (P2): proyecta las reservas hasta 'targetTime' (o Date.now() si no se especifica).
 * 3. Respeta 'resources.lastUpdated', foodTier (P17) y clasificación militar (P18) con segregación de asedio.
 * 4. Hora de referencia inyectable ('targetTime') para garantizar reproducibilidad exacta.
 */
export const getSimulatedKingdomResources = query({
  args: {
    kingdomId: v.string(),
    foodTier: v.string(),
    targetTime: v.optional(v.number()),
    includeSiegeInFoodConsumption: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // 1. Verificación de identidad autenticada (P1)
    const callerUserId = await requireAuthenticatedUser(ctx);

    // 2. Obtención de documentos desde las tablas relacionales del backend
    let kingdom: any = null;
    try {
      kingdom = await ctx.db.get(args.kingdomId as any);
    } catch {
      // Si kingdomId no es un ID tipado en el schema local
    }
    if (!kingdom) {
      kingdom = await ctx.db
        .query("kingdoms" as any)
        .filter((q: any) => q.eq(q.field("_id"), args.kingdomId))
        .first();
    }
    if (!kingdom) {
      throw new Error(`Reino no encontrado con ID '${args.kingdomId}'.`);
    }
    if (kingdom.userId !== callerUserId) {
      throw new Error("No autorizado: el reino no pertenece al usuario autenticado.");
    }

    const resources = await ctx.db
      .query("resources" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), args.kingdomId))
      .first();

    const population = await ctx.db
      .query("population" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), args.kingdomId))
      .first();

    const populationJobs = await ctx.db
      .query("populationJobs" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), args.kingdomId))
      .collect();

    let armyUnits: any[] = [];
    try {
      armyUnits = await ctx.db
        .query("Armyunits" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), args.kingdomId))
        .collect();
    } catch {
      try {
        armyUnits = await ctx.db
          .query("armyUnits" as any)
          .filter((q: any) => q.eq(q.field("kingdomId"), args.kingdomId))
          .collect();
      } catch {
        armyUnits = [];
      }
    }

    // 3. Proyección analítica mediante el adaptador y motor puro
    const result = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      populationJobs,
      armyUnits,
      foodTier: args.foodTier,
      targetTime: args.targetTime,
      callerUserId,
      options: {
        includeSiegeInFoodConsumption: args.includeSiegeInFoodConsumption,
      },
    });

    if (!result.success) {
      throw new Error(result.error);
    }

    return result;
  },
});

/**
 * ============================================================================
 * ETAPA 2: MUTACIÓN AUTORITATIVA DE LIQUIDACIÓN ECONÓMICA PERSISTENTE
 * ============================================================================
 * Liquida de forma persistente y atómica la economía del reino en Convex.
 *
 * Requisitos cumplidos:
 * 1. Identificación y autorización estricta (P1): Identifica al usuario mediante
 *    'ctx.auth.getUserIdentity()'. No confía en identidades ni en 'kingdomId'
 *    enviados por el cliente sin verificar la titularidad real del reino.
 * 2. Lectura directa de las tablas relacionales reales: 'kingdoms', 'resources',
 *    'population', 'populationJobs', 'buildings' y 'Armyunits'.
 * 3. Tiempo autoritativo del servidor: Intervalo calculado exclusivamente con
 *    'Date.now()' y 'resources.lastUpdated'.
 * 4. Fórmulas oficiales y factores alimentarios aprobados (P17: 0.75, 1.00, 1.10, 1.20).
 * 5. Actualización atómica en la base de datos sin saldos negativos (piso en 0)
 *    y sin duplicación de liquidaciones (control de concurrencia OCC de Convex).
 * 6. Procesa el intervalo offline completo; la primera liquidación se ancla al reloj del servidor
 *    cuando los recursos todavía no tienen settlementInitialized.
 * 7. Inalterabilidad de recursos sin fórmula aprobada: madera, piedra, hierro y oro
 *    no sufren alteraciones.
 * 8. Sin persistencia forzada de 'foodTier': utiliza el valor existente o 'normal' (1.00).
 */
export const settleKingdomEconomy = mutation({
  args: {
    kingdomId: v.optional(v.string()),
    includeSiegeInFoodConsumption: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // 1. Identificar al usuario mediante ctx.auth.getUserIdentity()
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !identity.subject) {
      throw new Error(
        "Autenticación requerida: No se detectó una sesión autenticada en el servidor Convex. " +
        "Por estrictas razones de integridad y propiedad (P1), se prohíbe liquidar reinos sin sesión válida."
      );
    }

    const callerUserId = identity.subject;
    // 2. Resolver el reino en el servidor y verificar propiedad estrictamente
    let kingdom: any = null;
    if (args.kingdomId) {
      try {
        kingdom = await ctx.db.get(args.kingdomId as any);
      } catch {
        // En caso de que kingdomId no sea un ID tipado local
      }
      if (!kingdom) {
        kingdom = await ctx.db
          .query("kingdoms" as any)
          .filter((q: any) => q.eq(q.field("_id"), args.kingdomId))
          .first();
      }
      if (!kingdom) {
        throw new Error(`Reino no encontrado con ID '${args.kingdomId}'.`);
      }

      if (!isKingdomOwner(kingdom.userId, callerUserId)) {
        throw new Error("No autorizado: el reino especificado no pertenece al usuario autenticado.");
      }
    } else {
      // Búsqueda por identificador de usuario
      kingdom = await ctx.db
        .query("kingdoms")
        .withIndex("by_user_id", (q) => q.eq("userId", callerUserId))
        .first();

      if (!kingdom) {
        throw new Error("No se encontró ningún reino asignado a la identidad autenticada.");
      }
    }

    const kingdomId = kingdom._id;

    // 3. Lectura de las tablas relacionales reales del reino
    const resources = await ctx.db
      .query("resources" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .first();

    if (!resources) {
      throw new Error(`Inconsistencia en la base de datos: no existen recursos para el reino '${kingdomId}'.`);
    }

    const population = await ctx.db
      .query("population" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .first();

    if (!population) {
      throw new Error(`Inconsistencia en la base de datos: no existe documento de población para el reino '${kingdomId}'.`);
    }

    const populationJobs = await ctx.db
      .query("populationJobs" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();

    const buildings = await ctx.db
      .query("buildings" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();

    let armyUnits: any[] = [];
    try {
      armyUnits = await ctx.db
        .query("Armyunits" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
        .collect();
    } catch {
      try {
        armyUnits = await ctx.db
          .query("armyUnits" as any)
          .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
          .collect();
      } catch {
        armyUnits = [];
      }
    }

    // 4. Marca temporal autoritativa del servidor
    const now = Date.now();

    // El cliente no decide si se omite un intervalo histórico.
    const isFirstInit = (resources as any).settlementInitialized !== true;

    // 5. Cálculo determinista y puro de la liquidación económica (Req 3: sin tope artificial 86400s)
    const settlement = calculateSettlementProgress({
      kingdom,
      resources,
      population,
      populationJobs,
      armyUnits,
      buildings,
      currentServerTimeMs: now,
      options: {
        isFirstInitialization: isFirstInit,
        includeSiegeInFoodConsumption: args.includeSiegeInFoodConsumption,
        callerUserId,
      },
    });

    if (!settlement.success || settlement.updatedFood === undefined) {
      throw new Error(settlement.error ?? "Fallo en el cálculo de liquidación económica.");
    }

    // 6. Actualización atómica en la misma transacción Convex
    await ctx.db.patch(resources._id as any, {
      food: settlement.updatedFood,
      lastUpdated: settlement.effectiveTimeMs ?? now,
      settlementInitialized: true,
    });

    if (population.starving !== settlement.isStarving) {
      await ctx.db.patch(population._id as any, {
        starving: settlement.isStarving,
      });
    }

    // Req 1: Persistir foodTier en kingdoms si carecía del campo (inicial "normal")
    if ((kingdom as any).foodTier === undefined) {
      await ctx.db.patch(kingdom._id as any, {
        foodTier: "normal",
      });
    }

    return {
      success: true,
      kingdomId,
      resources: {
        gold: resources.gold,
        wood: resources.wood,
        stone: resources.stone,
        iron: resources.iron,
        food: settlement.updatedFood,
      },
      foodDelta: settlement.foodDelta,
      isStarving: settlement.isStarving,
      starvationSeconds: settlement.starvationSeconds,
      secondsToExhaustion: settlement.secondsToExhaustion,
      elapsedSeconds: settlement.elapsedSeconds,
      cappedInterval: settlement.cappedInterval,
      appliedFoodTier: settlement.appliedFoodTier ?? ((kingdom as any).foodTier || "normal"),
      lastUpdated: settlement.effectiveTimeMs ?? now,
    };
  },
});

/**
 * ============================================================================
 * TRANSICIÓN ATÓMICA DE RÉGIMEN ALIMENTARIO (BLOQUE B.8, REQ 1 Y 6)
 * ============================================================================
 * 1. Valida la sesión y propiedad del reino.
 * 2. Comprueba que el nuevo foodTier pertenezca a los regímenes oficiales de P17.
 * 3. LIQUIDA PRIMERO el intervalo transcurrido con el régimen vigente hasta 'now'.
 * 4. ACTUALIZA DE FORMA ATÓMICA:
 *    - 'resources': nuevo saldo de comida y 'lastUpdated = now'.
 *    - 'population': estado 'starving' según el resultado de la liquidación previa.
 *    - 'kingdoms': guarda 'foodTier = args.foodTier' y 'updatedAt = now'.
 */
export const setKingdomFoodTier = mutation({
  args: {
    kingdomId: v.optional(v.string()),
    foodTier: v.string(), // "minima" | "normal" | "abundante" | "excelente"
  },
  handler: async (ctx, args) => {
    // 1. Identificar al usuario
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !identity.subject) {
      throw new Error(
        "Autenticación requerida: No se detectó una sesión autenticada en el servidor Convex."
      );
    }

    const callerUserId = identity.subject;
    // 2. Validar que el nuevo foodTier sea válido según P17
    const requestedTier = args.foodTier.toLowerCase().trim();
    if (
      requestedTier !== "minima" &&
      requestedTier !== "normal" &&
      requestedTier !== "abundante" &&
      requestedTier !== "excelente"
    ) {
      throw new Error(
        `Régimen alimentario inválido '${args.foodTier}'. Permitidos: minima, normal, abundante, excelente.`
      );
    }

    // 3. Resolver el reino y verificar propiedad
    let kingdom: any = null;
    if (args.kingdomId) {
      try {
        kingdom = await ctx.db.get(args.kingdomId as any);
      } catch {}
      if (!kingdom) {
        kingdom = await ctx.db
          .query("kingdoms" as any)
          .filter((q: any) => q.eq(q.field("_id"), args.kingdomId))
          .first();
      }
      if (!kingdom) {
        throw new Error(`Reino no encontrado con ID '${args.kingdomId}'.`);
      }
      if (!isKingdomOwner(kingdom.userId, callerUserId)) {
        throw new Error("No autorizado: el reino no pertenece al usuario autenticado.");
      }
    } else {
      kingdom = await ctx.db
        .query("kingdoms")
        .withIndex("by_user_id", (q) => q.eq("userId", callerUserId))
        .first();

      if (!kingdom) {
        throw new Error("No se encontró ningún reino para el usuario autenticado.");
      }
    }

    const kingdomId = kingdom._id;

    // 4. Leer tablas relacionales reales
    const resources = await ctx.db
      .query("resources" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .first();
    if (!resources) {
      throw new Error("No existen recursos para el reino.");
    }

    const population = await ctx.db
      .query("population" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .first();
    if (!population) {
      throw new Error("No existe documento de población para el reino.");
    }

    const populationJobs = await ctx.db
      .query("populationJobs" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();

    const buildings = await ctx.db
      .query("buildings" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();

    let armyUnits: any[] = [];
    try {
      armyUnits = await ctx.db
        .query("Armyunits" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
        .collect();
    } catch {
      try {
        armyUnits = await ctx.db
          .query("armyUnits" as any)
          .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
          .collect();
      } catch {
        armyUnits = [];
      }
    }

    const now = Date.now();

    // 5. Transición atómica pura: liquida primero el régimen previo
    const isFirstInit = (resources as any).settlementInitialized !== true;

    const transition = executeRegimeChangeTransition({
      kingdom,
      resources,
      population,
      populationJobs,
      armyUnits,
      buildings,
      newFoodTier: requestedTier,
      currentServerTimeMs: now,
      options: {
        isFirstInitialization: isFirstInit,
        callerUserId,
      },
    });

    if (!transition.success || transition.settledFood === undefined) {
      throw new Error(transition.error ?? "Fallo al realizar la transición del régimen alimentario.");
    }

    // 6. Actualización atómica en Convex
    await ctx.db.patch(resources._id as any, {
      food: transition.settledFood,
      lastUpdated: now,
      settlementInitialized: true,
    });

    if (population.starving !== transition.isStarving) {
      await ctx.db.patch(population._id as any, {
        starving: transition.isStarving,
      });
    }

    // Persiste el nuevo régimen alimentario en kingdoms (Req 1 y 6)
    await ctx.db.patch(kingdom._id as any, {
      foodTier: requestedTier,
      updatedAt: now,
    });

    return {
      success: true,
      kingdomId,
      previousFoodTier: transition.previousFoodTier,
      newFoodTier: transition.newFoodTier,
      settledFood: transition.settledFood,
      foodDelta: transition.foodDelta,
      isStarving: transition.isStarving,
      starvationSeconds: transition.starvationSeconds,
      elapsedSeconds: transition.elapsedSeconds,
      timestamp: now,
    };
  },
});
