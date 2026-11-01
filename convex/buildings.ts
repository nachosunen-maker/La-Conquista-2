/**
 * LA CONQUISTA — CONSTRUCCIÓN (ruta canónica, Bloque A)
 * Única implementación de consulta, inicio, cancelación y finalización de obras.
 * kingdoms.ts reexporta estas funciones por compatibilidad con la interfaz.
 */
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { recordMissionEvent } from "./missions";
import { isKingdomOwner } from "./kingdomAccess";
import { settleRelationalKingdomEconomy } from "./economy";
import {
  BUILDING_RULES,
  BUILDING_PARAMETERS_PENDING,
  INITIAL_BUILDING_LEVELS,
  calculateConstructionCancellationRefund,
  calculateJobCapacities,
  calculateResidentialCapacity,
  constructionProgress,
  createConstructionPlan,
  describeCatalogForLevels,
  validateBuildingCollection,
  validateConstructionCompletion,
  type ConstructionQueueEntry,
} from "./buildingRules";
import { getConstructionDurationModifier, readCompletedTechnologyIds } from "./technologyRules";
import { computeProfessionEffects, PROFESSION_BUILDING_CAPACITY } from "./economyExtended";
import { civilizationBuildingLabel, getCivilizationPassive } from "./civilizationRules";
import type { ResourceType } from "./economyCalculations";

export async function requireOwner(ctx: MutationCtx, kingdomId: Id<"kingdoms">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) throw new Error("Autenticación requerida.");
  const kingdom = await ctx.db.get(kingdomId);
  if (!kingdom) throw new Error("Reino no encontrado.");
  if (!isKingdomOwner(kingdom.userId, identity.subject)) {
    throw new Error("No autorizado: el reino no pertenece al usuario autenticado.");
  }
  return { kingdom, userId: identity.subject };
}

/**
 * [DERIVADO de P19] Inserta los edificios fundacionales de un reino que no tiene ninguno.
 * Idempotente: si ya existe cualquier edificio no hace nada.
 */
export async function insertInitialBuildings(ctx: MutationCtx, kingdomId: Id<"kingdoms">): Promise<boolean> {
  const existing = await ctx.db
    .query("buildings")
    .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
    .first();
  if (existing) return false;
  for (const [buildingType, level] of Object.entries(INITIAL_BUILDING_LEVELS)) {
    if (!BUILDING_RULES[buildingType] || !Number.isInteger(level) || level < 1) continue;
    await ctx.db.insert("buildings", { kingdomId, buildingType, level });
  }
  return true;
}

/** [M-07] Trabajadores de construcción: −1 % de duración por cada 10, máximo −20 %. */
async function constructionWorkersModifier(ctx: { db: any }, kingdomId: Id<"kingdoms">): Promise<number> {
  const jobs: any[] = await ctx.db.query("populationJobs").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).collect();
  const jobCounts: Record<string, number> = {};
  for (const job of jobs) if (typeof job.jobType === "string") jobCounts[job.jobType.trim().toLowerCase()] = job.assignedCount ?? 0;
  return computeProfessionEffects(jobCounts, {}, PROFESSION_BUILDING_CAPACITY).constructionDurationMultiplier;
}

export const getConstructionState = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    const isDemoRead = kingdom.userId === "guest_g9ai8cz";
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar su propio reino.");
    }

    const [buildings, queue] = await Promise.all([
      ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
      ctx.db.query("constructionQueue").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
    ]);
    const completedTechnologies = await readCompletedTechnologyIds(ctx, args.kingdomId);
    const civPassive = getCivilizationPassive(kingdom.civilization);
    const durationModifier =
      getConstructionDurationModifier(completedTechnologies) *
      (await constructionWorkersModifier(ctx, args.kingdomId)) *
      civPassive.constructionDurationMultiplier;
    const serverTimeMs = Date.now();
    const collection = validateBuildingCollection(buildings);
    const buildingLevels = collection.success ? collection.levels : {};
    return {
      buildings,
      buildingLevels,
      residentialCapacity: calculateResidentialCapacity(buildings),
      jobCapacities: calculateJobCapacities(buildings),
      constructionQueue: queue.map((entry) => ({
        ...entry,
        progressPercent: typeof entry.startedAt === "number" && typeof entry.durationMs === "number"
          ? constructionProgress(entry as ConstructionQueueEntry, serverTimeMs)
          : null,
        completesAt: typeof entry.startedAt === "number" && typeof entry.durationMs === "number"
          ? entry.startedAt + entry.durationMs
          : null,
      })),
      serverTimeMs,
      writable: isKingdomOwner(kingdom.userId, identity?.subject),
      availableBuildingTypes: Object.keys(BUILDING_RULES),
      pendingBuildingTypes: [] as string[],
      // [Decisión 21-10-2026] El edificio único de la civilización lleva su nombre propio (solo estética).
      catalog: Object.fromEntries(Object.entries(BUILDING_RULES).map(([type, rule]) => [type, { ...rule, label: civilizationBuildingLabel(kingdom.civilization, type) }])),
      catalogForLevels: describeCatalogForLevels(buildingLevels, durationModifier),
      constructionDurationModifier: durationModifier,
      pendingParameters: BUILDING_PARAMETERS_PENDING,
      hasInitialBuildings: buildings.length > 0,
    };
  },
});

export const startConstruction = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    buildingType: v.string(),
  },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    const rule = BUILDING_RULES[args.buildingType];
    if (!rule) {
      throw new ConvexError(`El edificio '${args.buildingType}' no pertenece al catálogo configurado.`);
    }

    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const [storedBuildings, queue] = await Promise.all([
      ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
      ctx.db.query("constructionQueue").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
    ]);
    const collection = validateBuildingCollection(storedBuildings);
    if (!collection.success) throw new ConvexError(collection.error);
    
    const buildingLevels = collection.levels;
    const completedTechnologies = await readCompletedTechnologyIds(ctx, args.kingdomId);
    const resourceSnapshot: Record<ResourceType, number> = settled.settledResources;
    const planResult = createConstructionPlan({
      buildingType: args.buildingType,
      currentLevel: buildingLevels[args.buildingType] ?? 0,
      resources: resourceSnapshot,
      activeConstructions: queue as ConstructionQueueEntry[],
      buildingLevels,
      now,
      rule,
      durationModifier:
        getConstructionDurationModifier(completedTechnologies) *
        (await constructionWorkersModifier(ctx, args.kingdomId)) *
        getCivilizationPassive(kingdom.civilization).constructionDurationMultiplier,
    });
    if (!planResult.success) throw new ConvexError(planResult.error);

    const nextResources = { ...resourceSnapshot };
    for (const [resource, cost] of Object.entries(planResult.plan.costs) as [ResourceType, number][]) {
      nextResources[resource] -= cost;
    }
    await ctx.db.patch(settled.resources._id, nextResources);

    const constructionId = await ctx.db.insert("constructionQueue", {
      kingdomId: args.kingdomId,
      buildingType: args.buildingType,
      targetLevel: planResult.plan.targetLevel,
      startedAt: planResult.plan.startedAt,
      durationMs: planResult.plan.durationMs,
      costs: planResult.plan.costs,
    });
    await ctx.scheduler.runAt(
      planResult.plan.completesAt,
      internal.buildings.completeConstruction,
      { constructionId }
    );

    return {
      success: true as const,
      constructionId,
      buildingType: args.buildingType,
      targetLevel: planResult.plan.targetLevel,
      startedAt: planResult.plan.startedAt,
      completesAt: planResult.plan.completesAt,
      costs: planResult.plan.costs,
    };
  },
});

export const cancelConstruction = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    constructionId: v.id("constructionQueue"),
  },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    const construction = await ctx.db.get(args.constructionId);
    if (!construction || construction.kingdomId !== args.kingdomId) {
      throw new Error("La construcción no existe en este reino.");
    }

    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const refundResult = calculateConstructionCancellationRefund({
      construction: construction as ConstructionQueueEntry,
      serverTimeMs: now,
    });
    if (!refundResult.success) throw new ConvexError(refundResult.error);

    const updatedResources: Record<ResourceType, number> = { ...settled.settledResources };
    for (const [resource, amount] of Object.entries(refundResult.refund) as [ResourceType, number][]) {
      updatedResources[resource] += amount;
    }
    await ctx.db.patch(settled.resources._id, updatedResources);
    await ctx.db.delete(args.constructionId);
    return { success: true, refund: refundResult.refund };
  },
});

/**
 * Finalización autoritativa programada en servidor. También puede invocarse
 * de forma idempotente desde una liquidación posterior si el scheduler no se ejecutó.
 */
export const completeConstruction = internalMutation({
  args: { constructionId: v.id("constructionQueue") },
  handler: async (ctx, args) => {
    const construction = await ctx.db.get(args.constructionId);
    if (!construction) return { success: true, completed: false };
    if (
      typeof construction.startedAt !== "number" ||
      typeof construction.durationMs !== "number" ||
      typeof construction.targetLevel !== "number" ||
      typeof construction.buildingType !== "string" ||
      constructionProgress(construction as ConstructionQueueEntry, Date.now()) !== 100
    ) {
      throw new Error("La construcción aún no ha alcanzado su tiempo de finalización.");
    }
    const buildings = await ctx.db
      .query("buildings")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", construction.kingdomId))
      .collect();
    const matching = buildings.filter((item) => item.buildingType === construction.buildingType);
    const completion = validateConstructionCompletion({
      buildingType: construction.buildingType,
      targetLevel: construction.targetLevel,
      existingLevels: matching.map((item) => item.level),
    });
    if (!completion.success) throw new Error(completion.error);
    const existing = matching[0];
    if (completion.action === "upgrade" && existing) {
      await ctx.db.patch(existing._id, { level: construction.targetLevel });
    } else if (completion.action === "insert") {
      await ctx.db.insert("buildings", {
        kingdomId: construction.kingdomId,
        buildingType: construction.buildingType,
        level: construction.targetLevel,
      });
    }
    await ctx.db.delete(args.constructionId);
    await recordMissionEvent(ctx, construction.kingdomId, "buildingsCompleted", 1);
    return { success: true, completed: true, buildingType: construction.buildingType, level: construction.targetLevel };
  },
});

/**
 * Completa en la misma transacción las obras vencidas de un reino (salvaguarda
 * frente a tareas programadas perdidas). Devuelve los tipos completados.
 */
export async function completeDueConstructions(ctx: MutationCtx, kingdomId: Id<"kingdoms">, now: number): Promise<string[]> {
  const queue = await ctx.db
    .query("constructionQueue")
    .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
    .collect();
  const completed: string[] = [];
  for (const construction of queue) {
    if (
      typeof construction.startedAt !== "number" ||
      typeof construction.durationMs !== "number" ||
      typeof construction.targetLevel !== "number" ||
      typeof construction.buildingType !== "string" ||
      constructionProgress(construction as ConstructionQueueEntry, now) !== 100
    ) {
      continue;
    }
    const buildings = await ctx.db
      .query("buildings")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .collect();
    const matching = buildings.filter((item) => item.buildingType === construction.buildingType);
    const completion = validateConstructionCompletion({
      buildingType: construction.buildingType,
      targetLevel: construction.targetLevel,
      existingLevels: matching.map((item) => item.level),
    });
    if (!completion.success) continue;
    if (completion.action === "upgrade" && matching[0]) {
      await ctx.db.patch(matching[0]._id, { level: construction.targetLevel });
    } else if (completion.action === "insert") {
      await ctx.db.insert("buildings", { kingdomId, buildingType: construction.buildingType, level: construction.targetLevel });
    }
    await ctx.db.delete(construction._id);
    completed.push(construction.buildingType);
    // La liquidación evalúa las misiones al final; aquí solo se cuenta el evento.
    await recordMissionEvent(ctx, kingdomId, "buildingsCompleted", 1, false);
  }
  return completed;
}

/** Permite al titular de un reino sin edificios recibir los edificios fundacionales (reinos anteriores a esta regla). */
export const bootstrapInitialBuildings = mutation({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.kingdomId);
    const inserted = await insertInitialBuildings(ctx, args.kingdomId);
    return { success: true, inserted, levels: inserted ? INITIAL_BUILDING_LEVELS : {} };
  },
});
