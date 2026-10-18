/**
 * LA CONQUISTA — INVESTIGACIÓN (Bloque C, D-16 a D-21)
 * Catálogo global inmutable (balanceConfig.TECHNOLOGIES) y progreso por reino
 * en technologyProgress con estado researching | completed.
 */
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { isKingdomOwner } from "./kingdomAccess";
import { settleRelationalKingdomEconomy } from "./economy";
import { requireOwner } from "./buildings";
import { validateBuildingCollection } from "./buildingRules";
import {
  TECHNOLOGY_CATALOG,
  calculateResearchCancellationRefund,
  computeTechnologyModifiers,
  createResearchPlan,
  evaluateTechnologyStatus,
  researchProgress,
  researchSlots,
  type ResearchQueueEntry,
} from "./technologyRules";
import { TECHNOLOGIES } from "./balanceConfig";
import type { ResourceType } from "./economyCalculations";

async function readProgress(ctx: { db: any }, kingdomId: Id<"kingdoms">) {
  return ctx.db
    .query("technologyProgress")
    .withIndex("by_kingdom", (q: any) => q.eq("kingdomId", kingdomId))
    .collect() as Promise<any[]>;
}

export const getTechnologies = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    const isDemoRead = kingdom.userId === "guest_g9ai8cz";
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar su propio reino.");
    }
    const [progress, buildings] = await Promise.all([
      readProgress(ctx, args.kingdomId),
      ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
    ]);
    const collection = validateBuildingCollection(buildings);
    const buildingLevels = collection.success ? collection.levels : {};
    const completedIds = new Set<string>(progress.filter((doc) => doc.status === "completed").map((doc) => doc.technologyId));
    const researching = progress.filter((doc) => doc.status === "researching");
    const researchingIds = new Set<string>(researching.map((doc) => doc.technologyId));
    const serverTimeMs = Date.now();
    const slots = researchSlots(buildingLevels.universidad ?? 0);
    return {
      serverTimeMs,
      writable: isKingdomOwner(kingdom.userId, identity?.subject),
      slots,
      slotsFree: Math.max(0, slots - researching.length),
      modifiers: computeTechnologyModifiers([...completedIds]),
      researching: researching.map((doc) => ({
        ...doc,
        name: TECHNOLOGY_CATALOG[doc.technologyId]?.name ?? doc.technologyId,
        progressPercent: typeof doc.startedAt === "number" && typeof doc.durationMs === "number"
          ? researchProgress(doc as ResearchQueueEntry, serverTimeMs)
          : null,
        completesAt: typeof doc.startedAt === "number" && typeof doc.durationMs === "number"
          ? doc.startedAt + doc.durationMs
          : null,
      })),
      catalog: TECHNOLOGIES.map((technology) => {
        const evaluation = evaluateTechnologyStatus({
          technology,
          completedIds,
          researchingIds,
          buildingLevels,
          kingdomCivilization: kingdom.civilization,
        });
        return { ...technology, status: evaluation.status, blockers: evaluation.blockers };
      }),
    };
  },
});

export const researchTechnology = mutation({
  args: { kingdomId: v.id("kingdoms"), techType: v.string() },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const [progress, buildings] = await Promise.all([
      readProgress(ctx, args.kingdomId),
      ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
    ]);
    const collection = validateBuildingCollection(buildings);
    if (!collection.success) throw new Error(collection.error);
    const planResult = createResearchPlan({
      technologyId: args.techType,
      resources: settled.settledResources,
      completedIds: progress.filter((doc) => doc.status === "completed").map((doc) => doc.technologyId),
      activeResearch: progress.filter((doc) => doc.status === "researching") as ResearchQueueEntry[],
      buildingLevels: collection.levels,
      now,
      kingdomCivilization: kingdom.civilization,
    });
    if (!planResult.success) throw new Error(planResult.error);
    const plan = planResult.plan;
    const nextResources: Record<ResourceType, number> = { ...settled.settledResources };
    for (const [resource, cost] of Object.entries(plan.costs) as [ResourceType, number][]) {
      nextResources[resource] -= cost;
    }
    await ctx.db.patch(settled.resources._id, nextResources);
    const progressId = await ctx.db.insert("technologyProgress", {
      kingdomId: args.kingdomId,
      technologyId: plan.technologyId,
      status: "researching",
      startedAt: plan.startedAt,
      durationMs: plan.durationMs,
      costs: plan.costs,
    });
    await ctx.scheduler.runAt(plan.completesAt, internal.technologies.completeResearch, { progressId });
    return { success: true, progressId, ...plan };
  },
});

export const cancelResearch = mutation({
  args: { kingdomId: v.id("kingdoms"), progressId: v.id("technologyProgress") },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    const doc = await ctx.db.get(args.progressId);
    if (!doc || doc.kingdomId !== args.kingdomId) throw new Error("La investigación no existe en este reino.");
    if (doc.status !== "researching") throw new Error("Solo se puede cancelar una investigación en curso.");
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const refundResult = calculateResearchCancellationRefund({ entry: doc as ResearchQueueEntry, serverTimeMs: now });
    if (!refundResult.success) throw new Error(refundResult.error);
    const nextResources: Record<ResourceType, number> = { ...settled.settledResources };
    for (const [resource, amount] of Object.entries(refundResult.refund) as [ResourceType, number][]) {
      nextResources[resource] += amount;
    }
    await ctx.db.patch(settled.resources._id, nextResources);
    await ctx.db.delete(args.progressId);
    return { success: true, refund: refundResult.refund };
  },
});

async function finalizeResearch(ctx: MutationCtx, doc: any, now: number): Promise<boolean> {
  if (doc.status !== "researching") return false;
  if (typeof doc.startedAt !== "number" || typeof doc.durationMs !== "number") return false;
  if (researchProgress(doc as ResearchQueueEntry, now) !== 100) return false;
  // Idempotencia: si ya existe un documento completado de la misma tecnología, se elimina el duplicado.
  const siblings = await readProgress(ctx, doc.kingdomId);
  const alreadyCompleted = siblings.some((other) => other._id !== doc._id && other.technologyId === doc.technologyId && other.status === "completed");
  if (alreadyCompleted) {
    await ctx.db.delete(doc._id);
    return true;
  }
  await ctx.db.patch(doc._id, { status: "completed", completedAt: now });
  return true;
}

export const completeResearch = internalMutation({
  args: { progressId: v.id("technologyProgress") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.progressId);
    if (!doc) return { success: true, completed: false };
    if (doc.status === "completed") return { success: true, completed: true };
    const completed = await finalizeResearch(ctx, doc, Date.now());
    if (!completed) throw new Error("La investigación aún no ha alcanzado su tiempo de finalización.");
    return { success: true, completed: true, technologyId: doc.technologyId };
  },
});

/** Salvaguarda: completa las investigaciones vencidas de un reino en la misma transacción. */
export async function completeDueResearch(ctx: MutationCtx, kingdomId: Id<"kingdoms">, now: number): Promise<number> {
  const progress = await readProgress(ctx, kingdomId);
  let completed = 0;
  for (const doc of progress) {
    if (await finalizeResearch(ctx, doc, now)) completed += 1;
  }
  return completed;
}
