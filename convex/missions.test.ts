/**
 * LA CONQUISTA — PRUEBAS DE INTEGRACIÓN DE MISIONES (sección 17 de CLAUDE.md, decisión 2026-10-21).
 * El servidor detecta, marca y premia una sola vez; etapas progresivas, diarias por fecha y secretas.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { createTestBackend } from "./test.setup";
import { BUILDINGS, DAILY_BONUS, MISSIONS, TIME } from "./balanceConfig";
import { costsForTargetLevel } from "./buildingRules";
import { dailyKeyFor, selectDailyMissions, stageProgressId } from "./missionRules";

const T0 = new Date("2026-10-23T10:00:00Z").getTime();

function identity(subject: string) {
  return { subject, tokenIdentifier: `test|${subject}`, issuer: "https://test" };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

async function found(t: ReturnType<typeof createTestBackend>, subject: string, name: string, civilization = "romanos") {
  const asUser = t.withIdentity(identity(subject));
  const kingdom = await asUser.mutation(api.economy.getOrInitializeKingdom, { name, civilization, castleName: `Castillo ${name}`, monarchName: `Rey ${name}` });
  // La primera liquidación crea el documento de recursos relacional.
  await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId: kingdom._id });
  return { asUser, kingdomId: kingdom._id as any };
}

async function setLevel(t: ReturnType<typeof createTestBackend>, kingdomId: any, buildingType: string, level: number) {
  await t.run(async (ctx) => {
    const docs = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect();
    const doc = docs.find((b) => b.buildingType === buildingType);
    if (doc) await ctx.db.patch(doc._id, { level });
    else await ctx.db.insert("buildings", { kingdomId, buildingType, level });
  });
}

async function resourcesOf(t: ReturnType<typeof createTestBackend>, kingdomId: any) {
  return await t.run(async (ctx) => (await ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first()) as any);
}

describe("Misiones progresivas: detección y recompensa automáticas, una sola vez", () => {
  test("al fundar no hay misiones completadas; la etapa 1 es la visible y las futuras no se muestran", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await found(t, "user-a", "Reino A");
    const missions = await asUser.query(api.missions.getMissions, { kingdomId });
    expect(missions.currentStage?.stage).toBe(1);
    expect(missions.currentStage?.missions.every((m: any) => !m.completed)).toBe(true);
    expect(missions.completedStages).toHaveLength(0);
    expect(missions.history).toHaveLength(0);
    expect(missions.daily.missions).toHaveLength(MISSIONS.DAILY.PER_DAY);
    expect(missions.secrets.discovered).toHaveLength(0);
    expect(missions.secrets.remaining).toBe(MISSIONS.SECRET.length + 1);
    // Invitado: puede leer Iberia pero no el reino ajeno.
    await expect(t.query(api.missions.getMissions, { kingdomId })).rejects.toThrow(/No autorizado/);
  });

  test("una obra terminada completa la misión y concede el premio exactamente una vez, con celebración pendiente", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await found(t, "user-a", "Reino A");
    const before = await resourcesOf(t, kingdomId);
    // Castillo 1 → 2 por la cola real de construcción.
    const costs = costsForTargetLevel(BUILDINGS.castillo.baseCosts, 2)!;
    await t.run(async (ctx) => {
      const res = await ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
      await ctx.db.patch(res!._id, { gold: 4_000, wood: 4_000, stone: 4_000, iron: 4_000, food: 4_000 });
    });
    await asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "castillo" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(costs.gold).toBeGreaterThan(0);

    const missions = await asUser.query(api.missions.getMissions, { kingdomId });
    const castle = missions.currentStage!.missions.find((m: any) => m.id === "s1_castillo2");
    expect(castle?.completed).toBe(true);
    const history = missions.history.map((h: any) => h.progressId);
    expect(history).toEqual(["s1_castillo2"]);

    // Recompensa concedida una vez: reevaluar o liquidar no la repite.
    const afterFirst = await resourcesOf(t, kingdomId);
    const reward = MISSIONS.STAGES[0].missions.find((m) => m.id === "s1_castillo2")!.reward;
    await asUser.mutation(api.missions.refreshMissions, { kingdomId });
    await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    const progress = await t.run(async (ctx) => await ctx.db.query("missionProgress").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect());
    expect(progress.filter((p) => p.progressId === "s1_castillo2")).toHaveLength(1);
    const kingdom = (await t.run(async (ctx) => await ctx.db.get(kingdomId))) as any;
    expect(kingdom!.honor).toBe(reward.honor);
    expect(afterFirst.stone).toBeGreaterThan(before.stone - costs.stone);

    const celebrations = await asUser.query(api.missions.getMissionCelebrations, { kingdomId });
    expect(celebrations).toHaveLength(1);
    expect(celebrations[0].title).toBe("Torres más altas");
    await asUser.mutation(api.missions.markMissionsSeen, { kingdomId, ids: [celebrations[0].id] });
    expect(await asUser.query(api.missions.getMissionCelebrations, { kingdomId })).toHaveLength(0);
  });

  test("completar toda la etapa 1 concede el premio final (recursos, honor, gloria y tropas) y revela la etapa 2", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await found(t, "user-a", "Reino A");
    await setLevel(t, kingdomId, "castillo", 2);
    await setLevel(t, kingdomId, "cuartel", 1);
    await setLevel(t, kingdomId, "taberna", 1);
    await setLevel(t, kingdomId, "universidad", 1);
    await t.run(async (ctx) => {
      const res = await ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
      await ctx.db.patch(res!._id, { gold: 3_000, food: 5_000 });
    });
    // 10 tropas por la cola real de entrenamiento (contador acumulado).
    await asUser.mutation(api.army.startTraining, { kingdomId, unitType: "infanteria", count: 10 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await asUser.mutation(api.missions.refreshMissions, { kingdomId });

    const missions = await asUser.query(api.missions.getMissions, { kingdomId });
    expect(missions.completedStages.map((s: any) => s.stage)).toEqual([1]);
    expect(missions.currentStage?.stage).toBe(2);
    const stageReward = MISSIONS.STAGES[0].reward;
    const kingdom = (await t.run(async (ctx) => await ctx.db.get(kingdomId))) as any;
    const expectedHonor = MISSIONS.STAGES[0].missions.reduce((sum, m) => sum + (m.reward.honor ?? 0), 0) + (stageReward.honor ?? 0);
    expect(kingdom!.honor).toBe(expectedHonor);
    expect(kingdom!.glory).toBe(stageReward.glory);
    const army = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(army.summary.byType.infanteria.active).toBe(10 + stageReward.troops!.count);
    const progressIds = (await t.run(async (ctx) => await ctx.db.query("missionProgress").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect())).map((p) => p.progressId);
    expect(progressIds).toContain(stageProgressId(1));
    expect(progressIds.filter((id) => id === stageProgressId(1))).toHaveLength(1);
  });

  test("la bonificación temporal de producción de una etapa se aplica en la liquidación y caduca", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await found(t, "user-a", "Reino A");
    await t.run(async (ctx) => {
      await ctx.db.patch(kingdomId, { temporaryBonuses: [{ type: "production", multiplier: 2, expiresAt: T0 + TIME.MS_PER_GAME_YEAR }] });
    });
    await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    const before = await resourcesOf(t, kingdomId);
    vi.setSystemTime(T0 + TIME.MS_PER_GAME_YEAR / 4);
    await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    const boosted = await resourcesOf(t, kingdomId);
    vi.setSystemTime(T0 + TIME.MS_PER_GAME_YEAR * 2);
    await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    const base = await resourcesOf(t, kingdomId);
    vi.setSystemTime(T0 + TIME.MS_PER_GAME_YEAR * 2.25);
    await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    const normal = await resourcesOf(t, kingdomId);
    const boostedWood = boosted.wood - before.wood;
    const normalWood = normal.wood - base.wood;
    expect(boostedWood).toBeGreaterThan(0);
    expect(normalWood).toBeGreaterThan(0);
    // Mismo intervalo (1/4 de día): con la bonificación ×2 caducada se produce aproximadamente la mitad.
    expect(boostedWood / normalWood).toBeGreaterThan(1.8);
    expect(boostedWood / normalWood).toBeLessThan(2.2);
  });
});

describe("Misiones diarias y secretas", () => {
  test("las diarias son las mismas para todos, se completan con eventos del día y se renuevan al día siguiente", async () => {
    const t = createTestBackend();
    const a = await found(t, "user-a", "Reino A");
    const b = await found(t, "user-b", "Reino B", "griegos");
    const dayKey = dailyKeyFor(T0);
    const expectedIds = selectDailyMissions(dayKey).map((m) => m.id);
    const missionsA = await a.asUser.query(api.missions.getMissions, { kingdomId: a.kingdomId });
    const missionsB = await b.asUser.query(api.missions.getMissions, { kingdomId: b.kingdomId });
    expect(missionsA.daily.missions.map((m: any) => m.id)).toEqual(expectedIds);
    expect(missionsB.daily.missions.map((m: any) => m.id)).toEqual(expectedIds);
    expect(missionsA.daily.dayKey).toBe(dayKey);

    // El bonus diario cuenta como evento del día (d_bonus está entre las de hoy en esta fecha de prueba).
    expect(expectedIds).toContain("d_bonus");
    const honorBefore = ((await t.run(async (ctx) => await ctx.db.get(a.kingdomId))) as any)?.honor ?? 0;
    await a.asUser.mutation(api.kingdoms.claimDailyBonus, { kingdomId: a.kingdomId });
    const after = await a.asUser.query(api.missions.getMissions, { kingdomId: a.kingdomId });
    const bonusMission = after.daily.missions.find((m: any) => m.id === "d_bonus");
    expect(bonusMission?.completed).toBe(true);
    const kingdomAfter = (await t.run(async (ctx) => await ctx.db.get(a.kingdomId))) as any;
    expect(kingdomAfter!.honor).toBe(honorBefore + DAILY_BONUS.HONOR + (MISSIONS.DAILY.CATALOG.find((m) => m.id === "d_bonus")!.reward.honor ?? 0));

    // Al día siguiente la diaria vuelve a estar pendiente y el progreso permanente no se borra.
    vi.setSystemTime(T0 + 24 * 3_600_000);
    const nextDay = await a.asUser.query(api.missions.getMissions, { kingdomId: a.kingdomId });
    expect(nextDay.daily.dayKey).not.toBe(dayKey);
    const nextBonus = nextDay.daily.missions.find((m: any) => m.id === "d_bonus");
    if (nextBonus) expect(nextBonus.completed).toBe(false);
    expect(nextDay.history.some((h: any) => h.progressId === `daily:d_bonus:${dayKey}`)).toBe(true);
  });

  test("las secretas permanecen ocultas hasta cumplirse; la de civilización se concede solo a la propia", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await found(t, "user-a", "Reino A", "romanos");
    const before = await asUser.query(api.missions.getMissions, { kingdomId });
    expect(before.secrets.discovered).toHaveLength(0);
    // Felicidad 90 (secreta general) y tecnología única romana completada (secreta de civilización).
    await t.run(async (ctx) => {
      await ctx.db.patch(kingdomId, { happiness: 95 });
      await ctx.db.insert("technologyProgress", { kingdomId, technologyId: "tech_civ_romanos", status: "completed", startedAt: T0, durationMs: 1, completedAt: T0 });
    });
    await asUser.mutation(api.missions.refreshMissions, { kingdomId });
    const after = await asUser.query(api.missions.getMissions, { kingdomId });
    const discovered = after.secrets.discovered.map((m: any) => m.id).sort();
    expect(discovered).toEqual(["x_civ_romanos", "x_felicidad"]);
    expect(after.secrets.remaining).toBe(MISSIONS.SECRET.length + 1 - 2);
    expect(after.secrets.discovered.find((m: any) => m.id === "x_civ_romanos")?.title).toBe(MISSIONS.SECRET_PER_CIVILIZATION_TITLES.romanos);
    // Otra civilización no recibe la secreta romana aunque tuviera la tecnología.
    const other = await found(t, "user-b", "Reino B", "griegos");
    await t.run(async (ctx) => {
      await ctx.db.insert("technologyProgress", { kingdomId: other.kingdomId, technologyId: "tech_civ_romanos", status: "completed", startedAt: T0, durationMs: 1, completedAt: T0 });
    });
    await other.asUser.mutation(api.missions.refreshMissions, { kingdomId: other.kingdomId });
    const otherMissions = await other.asUser.query(api.missions.getMissions, { kingdomId: other.kingdomId });
    expect(otherMissions.secrets.discovered).toHaveLength(0);
  });
});
