import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { isKingdomOwner } from "./kingdomAccess";
import { settleRelationalKingdomEconomy } from "./economy";
import {
  BUILDING_RULES,
  calculateConstructionCancellationRefund,
  constructionProgress,
  createConstructionPlan,
  BUILDING_PARAMETERS_PENDING,
  validateConstructionCompletion,
  calculateResidentialCapacity,
  type ConstructionQueueEntry,
} from "./buildingRules";
import type { ResourceType } from "./economyCalculations";

async function requireOwner(ctx: MutationCtx, kingdomId: Id<"kingdoms">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) throw new Error("Autenticación requerida.");
  const kingdom = await ctx.db.get(kingdomId);
  if (!kingdom) throw new Error("Reino no encontrado.");
  if (!isKingdomOwner(kingdom.userId, identity.subject)) {
    throw new Error("No autorizado: el reino no pertenece al usuario autenticado.");
  }
  return { kingdom, userId: identity.subject };
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
    const serverTimeMs = Date.now();
    return {
      buildings,
      residentialCapacity: calculateResidentialCapacity(buildings),
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
      availableBuildingTypes: Object.entries(BUILDING_RULES)
        .filter(([, rule]) =>
          rule.costs !== null &&
          rule.baseDurationMs !== null &&
          rule.progressionRequirements !== null
        )
        .map(([buildingType]) => buildingType),
      pendingBuildingTypes: Object.entries(BUILDING_RULES)
        .filter(([, rule]) =>
          rule.costs === null ||
          rule.baseDurationMs === null ||
          rule.progressionRequirements === null
        )
        .map(([buildingType]) => buildingType),
      catalog: BUILDING_RULES,
      pendingParameters: BUILDING_PARAMETERS_PENDING,
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
      throw new Error(`El edificio '${args.buildingType}' no pertenece al catálogo configurado.`);
    }

    const [storedBuildings, queue] = await Promise.all([
      ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
      ctx.db.query("constructionQueue").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
    ]);
    const existingBuildings = storedBuildings.filter((item) => item.buildingType === args.buildingType);
    const buildingLevels: Record<string, number> = {};
    for (const building of storedBuildings) {
      if (
        !building.buildingType.trim() ||
        !Number.isInteger(building.level) ||
        building.level < 1 ||
        building.level > 100 ||
        Object.hasOwn(buildingLevels, building.buildingType)
      ) {
        throw new Error("Los edificios persistidos contienen niveles inválidos o tipos duplicados; se requiere conciliación.");
      }
      buildingLevels[building.buildingType] = building.level;
    }
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    if (settled.settlement.updatedFood === undefined) {
      throw new Error("No se pudo liquidar la comida antes de iniciar la construcción.");
    }
    const resourceSnapshot: Record<ResourceType, number> = {
      gold: settled.resources.gold,
      wood: settled.resources.wood,
      stone: settled.resources.stone,
      iron: settled.resources.iron,
      food: settled.settlement.updatedFood,
    };
    const planResult = createConstructionPlan({
      buildingType: args.buildingType,
      currentLevel: existingBuildings[0]?.level ?? 0,
      resources: resourceSnapshot,
      activeConstructions: queue as ConstructionQueueEntry[],
      buildingLevels,
      now,
      rule,
    });
    if (!planResult.success) throw new Error(planResult.error);

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
      success: true,
      constructionId,
      buildingType: args.buildingType,
      targetLevel: planResult.plan.targetLevel,
      startedAt: planResult.plan.startedAt,
      completesAt: planResult.plan.completesAt,
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
    if (settled.settlement.updatedFood === undefined) {
      throw new Error("No se pudo liquidar la comida antes de cancelar la construcción.");
    }
    const refundResult = calculateConstructionCancellationRefund({
      construction: construction as ConstructionQueueEntry,
      serverTimeMs: now,
    });
    if (!refundResult.success) throw new Error(refundResult.error);

    const updatedResources: Record<ResourceType, number> = {
      gold: settled.resources.gold,
      wood: settled.resources.wood,
      stone: settled.resources.stone,
      iron: settled.resources.iron,
      food: settled.settlement.updatedFood,
    };
    for (const [resource, amount] of Object.entries(refundResult.refund) as [ResourceType, number][]) {
      updatedResources[resource] += amount;
    }
    await ctx.db.patch(settled.resources._id, updatedResources);
    await ctx.db.delete(args.constructionId);
    return { success: true, refund: refundResult.refund };
  },
});

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
    return { success: true, completed: true, buildingType: construction.buildingType, level: construction.targetLevel };
  },
});
