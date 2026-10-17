import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { completeDueConstructions, insertInitialBuildings } from "./buildings";
import { completeDueTraining, readArmyUnitDocs, readArmyUnitsWithMigration } from "./army";
import { completeDueResearch } from "./technologies";
import { ensureHomeTerritory } from "./territories";
import { calculateJobCapacities, calculateResidentialCapacity, validateBuildingCollection } from "./buildingRules";
import { computeTechnologyModifiers, readCompletedTechnologyIds } from "./technologyRules";
import { simulateExtendedEconomy, type ExtendedEconomyResult } from "./economyExtended";
import { normalizeUnitType } from "./armyRules";
import { TAXES, WELLBEING, UNITS, TERRAINS } from "./balanceConfig";
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

  const armyUnits: any[] = await readArmyUnitsWithMigration(ctx, kingdomId);

  return { resources, population, populationJobs, armyUnits, buildings };
}

/** Lee bonificaciones de terreno de los territorios del reino (Bloque G); vacío si el módulo no está disponible. */
async function readTerrainBonuses(ctx: any, kingdomId: any): Promise<Partial<Record<"agriculture" | "wood" | "stone" | "iron" | "gold", number>>> {
  try {
    const territories: any[] = await ctx.db
      .query("territories")
      .withIndex("by_owner", (q: any) => q.eq("ownerKingdomId", kingdomId))
      .collect();
    const bonuses: Partial<Record<"agriculture" | "wood" | "stone" | "iron" | "gold", number>> = {};
    for (const territory of territories) {
      const terrain = (TERRAINS as any)[territory.terrain];
      if (!terrain) continue;
      for (const [job, bonus] of Object.entries(terrain.production as Record<string, number>)) {
        const key = job as keyof typeof bonuses;
        bonuses[key] = (bonuses[key] ?? 0) + bonus;
      }
    }
    return bonuses;
  } catch {
    return {};
  }
}

/**
 * Liquidación autoritativa y persistente del reino (Bloques A-D):
 * 1. Completa obras, lotes de entrenamiento e investigaciones vencidas (salvaguarda del scheduler).
 * 2. Liquida alimentos con el motor aprobado (calculateSettlementProgress) y, si no es la primera
 *    inicialización, el resto de la economía ampliada (recursos, impuestos, población, inanición,
 *    felicidad y moral) con simulateExtendedEconomy.
 * 3. Persiste todo en la misma transacción Convex.
 */
export async function settleRelationalKingdomEconomy(
  ctx: any,
  kingdom: any,
  callerUserId: string,
  now: number
) {
  await completeDueConstructions(ctx, kingdom._id, now);
  await completeDueTraining(ctx, kingdom._id, now);
  await completeDueResearch(ctx, kingdom._id, now);

  const state = await readRelationalKingdomState(ctx, kingdom._id);
  if (!state.resources) throw new Error("No existen recursos para el reino.");
  if (!state.population) throw new Error("No existe documento de población para el reino.");

  const isFirstInitialization = state.resources.settlementInitialized !== true;
  const settlement = calculateSettlementProgress({
    kingdom,
    ...state,
    currentServerTimeMs: now,
    options: { isFirstInitialization, callerUserId },
  });
  if (!settlement.success || settlement.updatedFood === undefined) {
    throw new Error(settlement.error ?? "Fallo al liquidar la economía relacional.");
  }

  let extended: ExtendedEconomyResult | null = null;
  let settledResources: KingdomResources = {
    gold: state.resources.gold,
    wood: state.resources.wood,
    stone: state.resources.stone,
    iron: state.resources.iron,
    food: settlement.updatedFood,
  };

  if (!isFirstInitialization) {
    const adapted = adaptRemoteDocumentsToEconomicState({
      kingdom,
      resources: state.resources,
      population: state.population,
      populationJobs: state.populationJobs,
      armyUnits: state.armyUnits,
      buildings: state.buildings,
      foodTier: settlement.appliedFoodTier ?? (kingdom.foodTier || "normal"),
    });
    if (!adapted.success || !adapted.kingdomState || !adapted.militaryClassification) {
      throw new Error(adapted.error ?? "No se pudo adaptar el estado relacional del reino.");
    }
    const collection = validateBuildingCollection(state.buildings);
    const buildingLevels = collection.success ? collection.levels : {};
    const completedTechnologies = await readCompletedTechnologyIds(ctx, kingdom._id);
    const terrainBonuses = await readTerrainBonuses(ctx, kingdom._id);
    extended = simulateExtendedEconomy({
      kingdomState: adapted.kingdomState,
      now,
      jobCapacities: calculateJobCapacities(state.buildings),
      residentialCapacity: calculateResidentialCapacity(state.buildings),
      technologyModifiers: computeTechnologyModifiers(completedTechnologies),
      terrainBonuses,
      taxRate: typeof kingdom.taxRate === "number" ? kingdom.taxRate : TAXES.INITIAL_RATE,
      happiness: typeof kingdom.happiness === "number" ? kingdom.happiness : WELLBEING.INITIAL_HAPPINESS,
      moraleEffects: Array.isArray(kingdom.moraleEffects) ? kingdom.moraleEffects : [],
      starvationSeconds: typeof state.population.starvationSeconds === "number" ? state.population.starvationSeconds : 0,
      buildingLevels,
      militaryPersonnel: adapted.militaryClassification.regularSoldiers,
    });
    settledResources = extended.updatedResources;
  }

  await ctx.db.patch(state.resources._id, {
    ...settledResources,
    lastUpdated: settlement.effectiveTimeMs ?? now,
    settlementInitialized: true,
  });

  const populationPatch: Record<string, unknown> = {};
  const isStarving = extended ? extended.starvation.phaseAfter > 0 || settledResources.food <= 0 : settlement.isStarving;
  if (state.population.starving !== isStarving) populationPatch.starving = isStarving;
  if (extended) {
    if (extended.population.totalAfter !== state.population.total) populationPatch.total = extended.population.totalAfter;
    if (extended.population.availableAfter !== state.population.available) populationPatch.available = extended.population.availableAfter;
    if ((state.population.starvationSeconds ?? 0) !== extended.starvation.secondsAfter) populationPatch.starvationSeconds = extended.starvation.secondsAfter;
  }
  if (Object.keys(populationPatch).length > 0) await ctx.db.patch(state.population._id, populationPatch);

  if (extended) {
    const kingdomPatch: Record<string, unknown> = {};
    if (kingdom.happiness !== extended.happiness.after) kingdomPatch.happiness = extended.happiness.after;
    if (kingdom.militaryMorale !== extended.morale) kingdomPatch.militaryMorale = extended.morale;
    const liveEffects = (Array.isArray(kingdom.moraleEffects) ? kingdom.moraleEffects : []).filter((e: any) => e.expiresAt > now);
    if (liveEffects.length !== (kingdom.moraleEffects?.length ?? 0)) kingdomPatch.moraleEffects = liveEffects;
    if (Object.keys(kingdomPatch).length > 0) await ctx.db.patch(kingdom._id, { ...kingdomPatch, updatedAt: now });

    if (extended.militaryDesertion > 0) {
      await applyMilitaryDesertion(ctx, state.armyUnits, extended.militaryDesertion);
    }
  }

  return { ...state, settlement, settledResources, extended };
}

/** [COMPLEMENTO D-48] Deserción en fase 3: se retira tropa viva empezando por los lotes más numerosos. */
async function applyMilitaryDesertion(ctx: any, armyUnits: any[], personnel: number): Promise<void> {
  let remaining = personnel;
  const living = armyUnits
    .filter((doc) => normalizeUnitType(doc.unitType) && normalizeUnitType(doc.unitType) !== "asedio" && doc.count > 0)
    .sort((a, b) => b.count - a.count);
  for (const doc of living) {
    if (remaining <= 0) break;
    const removed = Math.min(doc.count, remaining);
    await ctx.db.patch(doc._id, { count: doc.count - removed });
    remaining -= removed;
  }
  // Operadores de asedio desertan en bloques de máquina completa.
  if (remaining > 0) {
    const siege = armyUnits.filter((doc) => normalizeUnitType(doc.unitType) === "asedio" && doc.count > 0);
    for (const doc of siege) {
      if (remaining < UNITS.asedio.populationPerUnit) break;
      const machines = Math.min(doc.count, Math.floor(remaining / UNITS.asedio.populationPerUnit));
      await ctx.db.patch(doc._id, { count: doc.count - machines });
      remaining -= machines * UNITS.asedio.populationPerUnit;
    }
  }
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
    // [D-11] Fuente única: los soldados heredados pasan a armyUnits como infantería nivel 1 (Milicia).
    await ctx.db.insert("armyUnits", {
      kingdomId: kingdom._id,
      unitType: "infanteria",
      level: 1,
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
      happiness: WELLBEING.INITIAL_HAPPINESS,
      militaryMorale: WELLBEING.INITIAL_MORALE,
      taxRate: TAXES.INITIAL_RATE,
      honor: 0,
      glory: 0,
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
    await ensureHomeTerritory(ctx, kingdomId);
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
        "La reasignación laboral no puede crear ni retirar tropas; los efectivos se leen de armyUnits."
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

    const armyUnits: any[] = await readArmyUnitDocs(ctx, kingdom._id);

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

    const armyUnits: any[] = await readArmyUnitDocs(ctx, args.kingdomId as any);

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
      },
    });

    if (!result.success) {
      throw new Error(result.error);
    }

    return result;
  },
});

/** Resuelve un reino por id (tipado o no) o por el usuario autenticado, verificando titularidad (P1). */
async function resolveOwnedKingdom(ctx: any, callerUserId: string, kingdomId?: string): Promise<any> {
  let kingdom: any = null;
  if (kingdomId) {
    try {
      kingdom = await ctx.db.get(kingdomId as any);
    } catch {
      // kingdomId no tipado
    }
    if (!kingdom) {
      kingdom = await ctx.db
        .query("kingdoms" as any)
        .filter((q: any) => q.eq(q.field("_id"), kingdomId))
        .first();
    }
    if (!kingdom) throw new Error(`Reino no encontrado con ID '${kingdomId}'.`);
    if (!isKingdomOwner(kingdom.userId, callerUserId)) {
      throw new Error("No autorizado: el reino especificado no pertenece al usuario autenticado.");
    }
    return kingdom;
  }
  kingdom = await ctx.db
    .query("kingdoms")
    .withIndex("by_user_id", (q: any) => q.eq("userId", callerUserId))
    .first();
  if (!kingdom) throw new Error("No se encontró ningún reino asignado a la identidad autenticada.");
  return kingdom;
}

function settlementResponse(kingdom: any, settled: Awaited<ReturnType<typeof settleRelationalKingdomEconomy>>, now: number) {
  const { settlement, settledResources, extended } = settled;
  return {
    success: true,
    kingdomId: kingdom._id,
    resources: settledResources,
    foodDelta: settlement.foodDelta,
    isStarving: extended ? extended.starvation.phaseAfter > 0 || settledResources.food <= 0 : settlement.isStarving,
    starvationSeconds: extended ? extended.starvation.secondsAfter : settlement.starvationSeconds,
    starvationPhase: extended ? extended.starvation.phaseAfter : 0,
    secondsToExhaustion: settlement.secondsToExhaustion,
    elapsedSeconds: settlement.elapsedSeconds,
    cappedInterval: settlement.cappedInterval,
    appliedFoodTier: settlement.appliedFoodTier ?? (kingdom.foodTier || "normal"),
    lastUpdated: settlement.effectiveTimeMs ?? now,
    dailyProduction: extended?.dailyProduction ?? null,
    dailyFoodConsumption: extended?.dailyFoodConsumption ?? null,
    dailyTaxIncome: extended?.dailyTaxIncome ?? null,
    taxesCollected: extended?.taxesCollected ?? 0,
    productivityMultiplier: extended?.productivityMultiplier ?? 1,
    population: extended?.population ?? null,
    happiness: extended?.happiness.after ?? kingdom.happiness ?? null,
    militaryMorale: extended?.morale ?? kingdom.militaryMorale ?? null,
    militaryDesertion: extended?.militaryDesertion ?? 0,
  };
}

/**
 * ============================================================================
 * LIQUIDACIÓN ECONÓMICA PERSISTENTE (Bloques A-D)
 * ============================================================================
 * Identifica al usuario (P1), resuelve el reino y aplica settleRelationalKingdomEconomy
 * con el reloj del servidor (P2, P66). El argumento includeSiegeInFoodConsumption se
 * acepta por compatibilidad y se ignora (D-12).
 */
export const settleKingdomEconomy = mutation({
  args: {
    kingdomId: v.optional(v.string()),
    includeSiegeInFoodConsumption: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const callerUserId = await requireAuthenticatedUser(ctx);
    const kingdom = await resolveOwnedKingdom(ctx, callerUserId, args.kingdomId);
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, callerUserId, now);
    if ((kingdom as any).foodTier === undefined) {
      await ctx.db.patch(kingdom._id as any, { foodTier: "normal" });
    }
    return settlementResponse(kingdom, settled, now);
  },
});

/**
 * Transición atómica de régimen alimentario (P17): liquida primero el intervalo con el
 * régimen vigente y a continuación persiste el nuevo régimen a partir de esa marca temporal.
 */
export const setKingdomFoodTier = mutation({
  args: {
    kingdomId: v.optional(v.string()),
    foodTier: v.string(),
  },
  handler: async (ctx, args) => {
    const callerUserId = await requireAuthenticatedUser(ctx);
    const requestedTier = args.foodTier.toLowerCase().trim();
    if (!["minima", "normal", "abundante", "excelente"].includes(requestedTier)) {
      throw new Error(`Régimen alimentario inválido '${args.foodTier}'. Permitidos: minima, normal, abundante, excelente.`);
    }
    const kingdom = await resolveOwnedKingdom(ctx, callerUserId, args.kingdomId);
    const previousTier = (kingdom as any).foodTier ?? "normal";
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, callerUserId, now);
    await ctx.db.patch(kingdom._id as any, { foodTier: requestedTier, updatedAt: now });
    return {
      success: true,
      kingdomId: kingdom._id,
      previousFoodTier: previousTier,
      newFoodTier: requestedTier,
      settledFood: settled.settledResources.food,
      foodDelta: settled.settlement.foodDelta,
      isStarving: settled.extended ? settled.extended.starvation.phaseAfter > 0 : settled.settlement.isStarving,
      starvationSeconds: settled.extended ? settled.extended.starvation.secondsAfter : settled.settlement.starvationSeconds,
      elapsedSeconds: settled.settlement.elapsedSeconds,
      timestamp: now,
    };
  },
});

/** [MAESTRA P27] Tasa impositiva entre 0 % y 100 %; liquida primero el intervalo con la tasa anterior. */
export const setTaxRate = mutation({
  args: { kingdomId: v.id("kingdoms"), taxRate: v.number() },
  handler: async (ctx, args) => {
    const callerUserId = await requireAuthenticatedUser(ctx);
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    if (!isKingdomOwner(kingdom.userId, callerUserId)) {
      throw new Error("No autorizado: el reino no pertenece al usuario autenticado.");
    }
    if (!Number.isFinite(args.taxRate) || args.taxRate < TAXES.MIN_RATE || args.taxRate > TAXES.MAX_RATE) {
      throw new Error(`La tasa impositiva debe estar entre ${TAXES.MIN_RATE * 100} % y ${TAXES.MAX_RATE * 100} %.`);
    }
    const now = Date.now();
    await settleRelationalKingdomEconomy(ctx, kingdom, callerUserId, now);
    const taxRate = Math.round(args.taxRate * 100) / 100;
    await ctx.db.patch(args.kingdomId, { taxRate, updatedAt: now });
    return { success: true, kingdomId: args.kingdomId, taxRate };
  },
});
