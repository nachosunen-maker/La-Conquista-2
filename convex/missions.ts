/**
 * LA CONQUISTA — MISIONES (sección 17 de CLAUDE.md, decisión 2026-10-21)
 * El servidor detecta el cumplimiento, marca la misión y concede la recompensa en la misma
 * transacción; cada misión única se concede una sola vez (missionProgress) y el cliente solo lee.
 * Los eventos (obras, tropas, investigación, batallas, exploración, bonus diario) alimentan los
 * contadores de missionCounters; el estado del reino se lee directamente de sus tablas.
 */
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { MISSIONS, TIME, UNIT_TYPES, type MissionCounterKey, type MissionReward } from "./balanceConfig";
import { isKingdomOwner } from "./kingdomAccess";
import { storageCapacity } from "./economyExtended";
import {
  allSecretMissions,
  conditionProgress,
  currentStage,
  dailyKeyFor,
  dailyMissionProgressId,
  describeReward,
  emptyCounters,
  evaluateMissions,
  nextDailyResetAt,
  normalizeCounters,
  selectDailyMissions,
  stageProgressId,
  type MissionCounters,
  type MissionSnapshot,
} from "./missionRules";

type Ctx = QueryCtx | MutationCtx;

async function readCounters(ctx: Ctx, kingdomId: Id<"kingdoms">) {
  return await ctx.db.query("missionCounters").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
}

async function readProgress(ctx: Ctx, kingdomId: Id<"kingdoms">) {
  return await ctx.db.query("missionProgress").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect();
}

/** Contadores vigentes; los diarios se reinician al cambiar de día (perezosamente). */
function splitCounters(doc: any, dayKey: string): { lifetime: MissionCounters; daily: MissionCounters; sameDay: boolean } {
  const lifetime = normalizeCounters(doc?.lifetime);
  const sameDay = doc?.dayKey === dayKey;
  const daily = sameDay ? normalizeCounters(doc?.daily) : emptyCounters();
  return { lifetime, daily, sameDay };
}

/**
 * Registra un evento de misión (obra terminada, tropas entrenadas, batalla…) en los contadores
 * acumulados y del día, y evalúa las misiones en la misma transacción.
 */
export async function recordMissionEvent(ctx: MutationCtx, kingdomId: Id<"kingdoms">, key: MissionCounterKey, amount: number = 1, evaluate: boolean = true): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const now = Date.now();
  const dayKey = dailyKeyFor(now);
  const doc = await readCounters(ctx, kingdomId);
  const { lifetime, daily } = splitCounters(doc, dayKey);
  lifetime[key] += Math.floor(amount);
  daily[key] += Math.floor(amount);
  if (doc) await ctx.db.patch(doc._id, { dayKey, lifetime, daily, updatedAt: now });
  else await ctx.db.insert("missionCounters", { kingdomId, dayKey, lifetime, daily, updatedAt: now });
  if (evaluate) await evaluateKingdomMissions(ctx, kingdomId, now);
}

async function buildSnapshot(ctx: Ctx, kingdomId: Id<"kingdoms">, now: number): Promise<{ snapshot: MissionSnapshot; kingdom: any; dayKey: string } | null> {
  const kingdom = await ctx.db.get(kingdomId);
  if (!kingdom) return null;
  const dayKey = dailyKeyFor(now);
  const [buildings, population, resources, technologies, units, territories, counters] = await Promise.all([
    ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect(),
    ctx.db.query("population").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first(),
    ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first(),
    ctx.db.query("technologyProgress").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect(),
    ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect(),
    ctx.db.query("territories").withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdomId)).collect(),
    readCounters(ctx, kingdomId),
  ]);
  const buildingLevels: Record<string, number> = {};
  for (const doc of buildings as any[]) {
    if (typeof doc.buildingType === "string" && typeof doc.level === "number") buildingLevels[doc.buildingType] = Math.max(buildingLevels[doc.buildingType] ?? 0, doc.level);
  }
  const { lifetime, daily } = splitCounters(counters, dayKey);
  const kingdomAny = kingdom as any;
  const resourceMap: Record<string, number> = {};
  for (const key of ["gold", "wood", "stone", "iron", "food"]) resourceMap[key] = typeof (resources as any)?.[key] === "number" ? (resources as any)[key] : (kingdomAny.resources?.[key] ?? 0);
  const snapshot: MissionSnapshot = {
    buildingLevels,
    population: typeof (population as any)?.total === "number" ? (population as any).total : kingdomAny.population ?? 0,
    completedTechnologyIds: (technologies as any[]).filter((t) => t.status === "completed").map((t) => t.technologyId as string),
    armySize: (units as any[]).reduce((sum, u) => sum + (UNIT_TYPES.includes(u.unitType) && u.unitType !== "asedio" ? Math.max(0, u.count ?? 0) : 0), 0),
    happiness: typeof kingdomAny.happiness === "number" ? kingdomAny.happiness : 0,
    honor: typeof kingdomAny.honor === "number" ? kingdomAny.honor : 0,
    resources: resourceMap,
    territoriesOwned: territories.length,
    civilization: kingdomAny.civilization ?? null,
    lifetime,
    daily,
  };
  return { snapshot, kingdom, dayKey };
}

/** Concede una recompensa en la misma transacción (recursos con tope de almacén, honor, gloria, tropas, bonificación temporal). */
async function grantReward(ctx: MutationCtx, kingdomId: Id<"kingdoms">, reward: MissionReward, now: number): Promise<void> {
  const kingdom = await ctx.db.get(kingdomId);
  if (!kingdom) return;
  if (reward.resources) {
    const resources = await ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
    if (resources) {
      const buildings = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect();
      const market = Math.max(0, ...(buildings as any[]).filter((b) => b.buildingType === "mercado").map((b) => b.level ?? 0));
      const cap = storageCapacity(market);
      const patch: Record<string, number> = {};
      for (const [resource, amount] of Object.entries(reward.resources)) {
        if (!amount) continue;
        const current = typeof (resources as any)[resource] === "number" ? (resources as any)[resource] : 0;
        patch[resource] = Math.min(cap, current + amount);
      }
      await ctx.db.patch(resources._id, patch);
    }
  }
  const kingdomPatch: Record<string, unknown> = { updatedAt: now };
  const kingdomAny = kingdom as any;
  if (reward.honor) kingdomPatch.honor = Math.max(0, (kingdomAny.honor ?? 0) + reward.honor);
  if (reward.glory) kingdomPatch.glory = Math.max(0, (kingdomAny.glory ?? 0) + reward.glory);
  if (reward.productionBonus) {
    const live = (Array.isArray(kingdomAny.temporaryBonuses) ? kingdomAny.temporaryBonuses : []).filter((b: any) => b.expiresAt > now);
    live.push({ type: "production", multiplier: reward.productionBonus.multiplier, expiresAt: now + reward.productionBonus.days * TIME.MS_PER_GAME_YEAR });
    kingdomPatch.temporaryBonuses = live;
  }
  await ctx.db.patch(kingdomId, kingdomPatch);
  if (reward.troops) {
    const units = await ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect();
    const host = (units as any[]).find((u) => u.unitType === reward.troops!.unitType && (u.level ?? 1) === reward.troops!.level && !u.isMercenary);
    if (host) await ctx.db.patch(host._id, { count: Math.max(0, host.count ?? 0) + reward.troops.count });
    else await ctx.db.insert("armyUnits", { kingdomId, unitType: reward.troops.unitType, level: reward.troops.level, count: reward.troops.count });
    // Las tropas regaladas entran en el censo como efectivos militares (no retiran civiles).
    const population = await ctx.db.query("population").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
    if (population) await ctx.db.patch(population._id, { total: (population as any).total + reward.troops.count });
  }
}

/**
 * Evalúa y concede las misiones cumplidas de un reino. Idempotente: cada identificador de
 * progreso se inserta una sola vez; si otra transacción lo insertó antes, Convex reintenta y la
 * segunda pasada ya lo ve completado.
 */
export async function evaluateKingdomMissions(ctx: MutationCtx, kingdomId: Id<"kingdoms">, now: number = Date.now()): Promise<string[]> {
  const built = await buildSnapshot(ctx, kingdomId, now);
  if (!built) return [];
  const progress = await readProgress(ctx, kingdomId);
  const completedIds = new Set(progress.map((doc) => doc.progressId));
  const completions = evaluateMissions(built.snapshot, completedIds, built.dayKey);
  const granted: string[] = [];
  for (const completion of completions) {
    await ctx.db.insert("missionProgress", {
      kingdomId,
      progressId: completion.progressId,
      missionId: completion.mission.id,
      kind: completion.kind,
      stage: completion.stage,
      title: completion.mission.title,
      rewardSummary: describeReward(completion.reward),
      completedAt: now,
      rewardGranted: true,
    });
    await grantReward(ctx, kingdomId, completion.reward, now);
    granted.push(completion.progressId);
  }
  return granted;
}

async function assertReadable(ctx: Ctx, kingdomId: Id<"kingdoms">) {
  const kingdom = await ctx.db.get(kingdomId);
  if (!kingdom) throw new Error("Reino no encontrado.");
  const userId = await getAuthUserId(ctx);
  const isDemoRead = kingdom.userId === "guest_g9ai8cz";
  const owner = isKingdomOwner(kingdom.userId, userId ?? undefined);
  if (!isDemoRead && !owner) throw new Error("No autorizado: solo puede consultar su propio reino.");
  return { kingdom, owner };
}

/** Panel de misiones: etapa en curso (las futuras no se muestran), diarias del día, secretas descubiertas e historial. */
export const getMissions = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const { owner } = await assertReadable(ctx, args.kingdomId);
    const now = Date.now();
    const built = await buildSnapshot(ctx, args.kingdomId, now);
    if (!built) throw new Error("Reino no encontrado.");
    const progress = await readProgress(ctx, args.kingdomId);
    const completedIds = new Set(progress.map((doc) => doc.progressId));
    const completedAt = new Map(progress.map((doc) => [doc.progressId, doc.completedAt]));
    const stage = currentStage(completedIds);
    const completedStages = MISSIONS.STAGES.filter((s) => completedIds.has(stageProgressId(s.stage))).map((s) => ({ stage: s.stage, title: s.title, rewardSummary: describeReward(s.reward) }));
    const secrets = allSecretMissions().filter((m) => !m.civilization || m.civilization === built.snapshot.civilization);
    const describe = (mission: (typeof MISSIONS.STAGES)[number]["missions"][number], progressId: string) => ({
      id: mission.id,
      progressId,
      title: mission.title,
      description: mission.description,
      rewardSummary: describeReward(mission.reward),
      completed: completedIds.has(progressId),
      completedAt: completedAt.get(progressId) ?? null,
      progress: conditionProgress(mission.condition, built.snapshot),
    });
    return {
      serverTimeMs: now,
      writable: owner,
      currentStage: stage
        ? { stage: stage.stage, title: stage.title, total: MISSIONS.STAGES.length, rewardSummary: describeReward(stage.reward), missions: stage.missions.map((m) => describe(m, m.id)) }
        : null,
      completedStages,
      daily: {
        dayKey: built.dayKey,
        resetsAt: nextDailyResetAt(now),
        missions: selectDailyMissions(built.dayKey).map((m) => describe(m, dailyMissionProgressId(m.id, built.dayKey))),
      },
      secrets: {
        discovered: secrets.filter((m) => completedIds.has(m.id)).map((m) => ({ id: m.id, title: m.title, description: m.description, rewardSummary: describeReward(m.reward), completedAt: completedAt.get(m.id) ?? null })),
        remaining: secrets.filter((m) => !completedIds.has(m.id)).length,
      },
      history: progress
        .slice()
        .sort((a, b) => b.completedAt - a.completedAt)
        .slice(0, 20)
        .map((doc) => ({ progressId: doc.progressId, title: doc.title, kind: doc.kind, rewardSummary: doc.rewardSummary, completedAt: doc.completedAt })),
    };
  },
});

/** Celebraciones pendientes de mostrar (misiones completadas que el jugador aún no ha visto). */
export const getMissionCelebrations = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const { owner } = await assertReadable(ctx, args.kingdomId);
    if (!owner) return [];
    const progress = await readProgress(ctx, args.kingdomId);
    return progress
      .filter((doc) => !doc.seenAt)
      .sort((a, b) => a.completedAt - b.completedAt)
      .slice(0, 5)
      .map((doc) => ({ id: doc._id, progressId: doc.progressId, title: doc.title, kind: doc.kind, stage: doc.stage ?? null, rewardSummary: doc.rewardSummary, completedAt: doc.completedAt }));
  },
});

export const markMissionsSeen = mutation({
  args: { kingdomId: v.id("kingdoms"), ids: v.array(v.id("missionProgress")) },
  handler: async (ctx, args) => {
    const { owner } = await assertReadable(ctx, args.kingdomId);
    if (!owner) throw new Error("No autorizado.");
    const now = Date.now();
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc && doc.kingdomId === args.kingdomId && !doc.seenAt) await ctx.db.patch(id, { seenAt: now });
    }
    return { success: true };
  },
});

/** Reevaluación explícita (el propietario entra en el panel): el servidor sigue siendo la autoridad. */
export const refreshMissions = mutation({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const { owner } = await assertReadable(ctx, args.kingdomId);
    if (!owner) throw new Error("No autorizado.");
    const granted = await evaluateKingdomMissions(ctx, args.kingdomId, Date.now());
    return { success: true, granted };
  },
});
