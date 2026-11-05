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
import { MISSIONS, TIME, UNITS, UNIT_TYPES, type MissionCounterKey, type MissionReward } from "./balanceConfig";
import { isKingdomOwner } from "./kingdomAccess";
import { storageCapacity } from "./economyExtended";
import { normalizeUnitType } from "./armyRules";
import {
  allSecretMissions,
  conditionProgress,
  currentStage,
  dailyKeyFor,
  dailyMissionProgressId,
  describeReward,
  emptyCounters,
  evaluateMissions,
  findMissionDetails,
  isConditionMet,
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
    armySize: (units as any[]).reduce((sum, u) => {
      const norm = normalizeUnitType(u.unitType);
      return sum + (norm && UNITS[norm]?.isLivingTroop ? Math.max(0, u.count ?? 0) : 0);
    }, 0),
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
    const population = await ctx.db.query("population").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
    if (population) await ctx.db.patch(population._id, { total: (population as any).total + reward.troops.count });
  }
}

/**
 * Evalúa las misiones cumplidas de un reino para verificar progreso y objetivos.
 * NO concede recompensas automáticamente: la única mutación autorizada para entregar premios es claimMissionReward.
 */
export async function evaluateKingdomMissions(ctx: MutationCtx, kingdomId: Id<"kingdoms">, now: number = Date.now()): Promise<string[]> {
  const built = await buildSnapshot(ctx, kingdomId, now);
  if (!built) return [];
  const progress = await readProgress(ctx, kingdomId);
  const finishedIds = new Set(progress.map((doc) => doc.progressId));
  const completions = evaluateMissions(built.snapshot, finishedIds, built.dayKey);
  // Detecta y devuelve identificadores de misiones con objetivos cumplidos listas para finalizar,
  // sin otorgar recompensas ni crear registros con rewardGranted: true.
  return completions.map((c) => c.progressId);
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

/** Botón FINALIZAR MISIÓN: verifica condiciones en el servidor y pasa la misión a COMPLETADA — PENDIENTE DE COBRO. */
export const finishMission = mutation({
  args: { kingdomId: v.id("kingdoms"), progressId: v.string() },
  handler: async (ctx, args) => {
    const { owner } = await assertReadable(ctx, args.kingdomId);
    if (!owner) throw new Error("No autorizado.");
    const now = Date.now();
    const built = await buildSnapshot(ctx, args.kingdomId, now);
    if (!built) throw new Error("Reino no encontrado.");

    const existing = await ctx.db
      .query("missionProgress")
      .withIndex("by_kingdom_and_progress", (q) => q.eq("kingdomId", args.kingdomId).eq("progressId", args.progressId))
      .first();
    if (existing) {
      if (existing.rewardGranted) {
        throw new Error("La misión ya ha sido cobrada.");
      }
      throw new Error("La misión ya ha sido finalizada y está pendiente de cobro.");
    }

    const details = findMissionDetails(args.progressId, built.dayKey, built.snapshot.civilization);
    if (!details) throw new Error("Misión no encontrada.");

    let met = false;
    if (args.progressId.startsWith("stage:")) {
      const stageNum = details.stage!;
      const stage = MISSIONS.STAGES.find((s) => s.stage === stageNum);
      const progress = await readProgress(ctx, args.kingdomId);
      const finishedIds = new Set(progress.map((doc) => doc.progressId));
      met = stage ? stage.missions.every((m) => finishedIds.has(m.id)) : false;
    } else if (args.progressId.startsWith("daily:")) {
      const parts = args.progressId.split(":");
      const missionId = parts[1];
      const mission = selectDailyMissions(built.dayKey).find((m) => m.id === missionId);
      met = mission ? isConditionMet(mission.condition, built.snapshot) : false;
    } else {
      let cond = null;
      for (const stage of MISSIONS.STAGES) {
        for (const m of stage.missions) {
          if (m.id === args.progressId) cond = m.condition;
        }
      }
      for (const m of allSecretMissions()) {
        if (m.id === args.progressId) cond = m.condition;
      }
      met = cond ? isConditionMet(cond, built.snapshot) : false;
    }

    if (!met) throw new Error("Los objetivos de la misión aún no se han cumplido.");

    await ctx.db.insert("missionProgress", {
      kingdomId: args.kingdomId,
      progressId: args.progressId,
      missionId: args.progressId.startsWith("daily:") ? args.progressId.split(":")[1] : args.progressId,
      kind: details.kind,
      stage: details.stage,
      title: details.title,
      rewardSummary: describeReward(details.reward),
      completedAt: now,
      rewardGranted: false, // Pendiente de cobro
    });

    return { success: true };
  },
});

/** Botón COBRAR RECOMPENSA: valida almacén atómicamente, entrega recompensa completa o rechaza con "NO HAY SITIO EN EL MERCADO". */
export const claimMissionReward = mutation({
  args: { kingdomId: v.id("kingdoms"), progressId: v.string() },
  handler: async (ctx, args) => {
    const { owner } = await assertReadable(ctx, args.kingdomId);
    if (!owner) throw new Error("No autorizado.");
    const now = Date.now();
    const doc = await ctx.db
      .query("missionProgress")
      .withIndex("by_kingdom_and_progress", (q) => q.eq("kingdomId", args.kingdomId).eq("progressId", args.progressId))
      .first();

    if (!doc) throw new Error("La misión no ha sido finalizada todavía.");
    if (doc.rewardGranted) throw new Error("La recompensa ya ha sido cobrada.");

    const built = await buildSnapshot(ctx, args.kingdomId, now);
    if (!built) throw new Error("Reino no encontrado.");

    const details = findMissionDetails(args.progressId, built.dayKey, built.snapshot.civilization);
    if (!details) throw new Error("Misión no encontrada.");

    if (details.reward.resources) {
      const resources = await ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).first();
      const buildings = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect();
      const market = Math.max(0, ...(buildings as any[]).filter((b) => b.buildingType === "mercado").map((b) => b.level ?? 0));
      const cap = storageCapacity(market);
      for (const [resource, amount] of Object.entries(details.reward.resources)) {
        if (!amount) continue;
        const current = typeof (resources as any)?.[resource] === "number" ? (resources as any)[resource] : 0;
        if (current + amount > cap) {
          throw new Error("NO HAY SITIO EN EL MERCADO");
        }
      }
    }

    await grantReward(ctx, args.kingdomId, details.reward, now);
    await ctx.db.patch(doc._id, { rewardGranted: true });

    return { success: true };
  },
});

/** Panel de misiones: estado detallado de cada misión (in_progress, ready_to_finish, pending_claim, claimed). */
export const getMissions = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const { owner } = await assertReadable(ctx, args.kingdomId);
    const now = Date.now();
    const built = await buildSnapshot(ctx, args.kingdomId, now);
    if (!built) throw new Error("Reino no encontrado.");
    const progress = await readProgress(ctx, args.kingdomId);
    const progressMap = new Map(progress.map((doc) => [doc.progressId, doc]));
    const completedIds = new Set(progress.filter((doc) => doc.rewardGranted).map((doc) => doc.progressId));
    const finishedIds = new Set(progress.map((doc) => doc.progressId));
    const completedAt = new Map(progress.map((doc) => [doc.progressId, doc.completedAt]));
    const stage = MISSIONS.STAGES.find((s) => !s.missions.every((m) => finishedIds.has(m.id)) || !finishedIds.has(stageProgressId(s.stage))) ?? null;
    const completedStages = MISSIONS.STAGES.filter((s) => finishedIds.has(stageProgressId(s.stage))).map((s) => ({ stage: s.stage, title: s.title, rewardSummary: describeReward(s.reward) }));
    const secrets = allSecretMissions().filter((m) => !m.civilization || m.civilization === built.snapshot.civilization);

    const describe = (mission: (typeof MISSIONS.STAGES)[number]["missions"][number], progressId: string) => {
      const doc = progressMap.get(progressId);
      const canFinish = isConditionMet(mission.condition, built.snapshot);
      let status: 'in_progress' | 'ready_to_finish' | 'pending_claim' | 'claimed' = 'in_progress';
      if (doc) {
        status = doc.rewardGranted ? 'claimed' : 'pending_claim';
      } else if (canFinish) {
        status = 'ready_to_finish';
      }
      return {
        id: mission.id,
        progressId,
        title: mission.title,
        description: mission.description,
        rewardSummary: describeReward(mission.reward),
        status,
        completedAt: doc?.completedAt ?? null,
        rewardGranted: doc?.rewardGranted ?? false,
        completed: !!doc,
        progress: conditionProgress(mission.condition, built.snapshot),
      };
    };

    return {
      serverTimeMs: now,
      writable: owner,
      currentStage: stage
        ? {
            stage: stage.stage,
            title: stage.title,
            total: MISSIONS.STAGES.length,
            rewardSummary: describeReward(stage.reward),
            missions: stage.missions.map((m) => describe(m, m.id)),
            stageReward: (() => {
              const stageId = stageProgressId(stage.stage);
              const doc = progressMap.get(stageId);
              const allMissionsFinished = stage.missions.every((m) => finishedIds.has(m.id));
              let status: 'in_progress' | 'ready_to_finish' | 'pending_claim' | 'claimed' = 'in_progress';
              if (doc) {
                status = doc.rewardGranted ? 'claimed' : 'pending_claim';
              } else if (allMissionsFinished) {
                status = 'ready_to_finish';
              }
              return {
                id: stageId,
                progressId: stageId,
                title: `Premio final de la Etapa ${stage.stage}: ${stage.title}`,
                description: `Completa todas las misiones de la Etapa ${stage.stage} para reclamar este premio.`,
                rewardSummary: describeReward(stage.reward),
                status,
                completedAt: doc?.completedAt ?? null,
                rewardGranted: doc?.rewardGranted ?? false,
                completed: !!doc,
                progress: {
                  current: stage.missions.filter((m) => finishedIds.has(m.id)).length,
                  target: stage.missions.length,
                },
              };
            })(),
          }
        : null,
      completedStages,
      daily: {
        dayKey: built.dayKey,
        resetsAt: nextDailyResetAt(now),
        missions: selectDailyMissions(built.dayKey).map((m) => describe(m, dailyMissionProgressId(m.id, built.dayKey))),
      },
      secrets: {
        discovered: secrets.filter((m) => finishedIds.has(m.id) || isConditionMet(m.condition, built.snapshot)).map((m) => {
          const doc = progressMap.get(m.id);
          const canFinish = isConditionMet(m.condition, built.snapshot);
          let status: 'in_progress' | 'ready_to_finish' | 'pending_claim' | 'claimed' = 'in_progress';
          if (doc) {
            status = doc.rewardGranted ? 'claimed' : 'pending_claim';
          } else if (canFinish) {
            status = 'ready_to_finish';
          }
          return {
            id: m.id,
            progressId: m.id,
            title: m.title,
            description: m.description,
            rewardSummary: describeReward(m.reward),
            status,
            rewardGranted: doc?.rewardGranted ?? false,
            completed: !!doc,
            completedAt: doc?.completedAt ?? null,
          };
        }),
        remaining: secrets.filter((m) => !finishedIds.has(m.id) && !isConditionMet(m.condition, built.snapshot)).length,
      },
      history: progress
        .filter((doc) => doc.rewardGranted)
        .slice()
        .sort((a, b) => b.completedAt - a.completedAt)
        .slice(0, 20)
        .map((doc) => ({ progressId: doc.progressId, title: doc.title, kind: doc.kind, rewardSummary: doc.rewardSummary, completedAt: doc.completedAt })),
    };
  },
});

/** Celebraciones pendientes de mostrar (misiones cobradas que el jugador aún no ha visto). */
export const getMissionCelebrations = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const { owner } = await assertReadable(ctx, args.kingdomId);
    if (!owner) return [];
    const progress = await readProgress(ctx, args.kingdomId);
    return progress
      .filter((doc) => doc.rewardGranted && !doc.seenAt)
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

