/**
 * LA CONQUISTA — PRUEBAS DE INTEGRACIÓN (T-04) sobre el backend simulado de convex-test.
 * Cubren fundación, construcción, entrenamiento, investigación, liquidación, bonus diario,
 * Parlamento y resolución de batallas con el reloj controlado.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { createTestBackend } from "./test.setup";
import { INITIAL_BUILDINGS, TIME, BUILDINGS, UNITS, DAILY_BONUS, PARLIAMENT } from "./balanceConfig";
import { costsForTargetLevel } from "./buildingRules";

const DAY = TIME.MS_PER_GAME_YEAR;
const T0 = new Date("2026-10-17T10:00:00Z").getTime();

function identity(subject: string) {
  return { subject, tokenIdentifier: `https://accounts.google.com|${subject}`, issuer: "https://accounts.google.com" };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

async function foundKingdom(t: ReturnType<typeof createTestBackend>, subject: string, name: string) {
  const asUser = t.withIdentity(identity(subject));
  const kingdom = await asUser.mutation(api.economy.getOrInitializeKingdom, {
    name,
    civilization: "romanos",
    castleName: `Castillo de ${name}`,
    monarchName: `Monarca de ${name}`,
  });
  return { asUser, kingdomId: kingdom._id as any };
}

async function setBuildingLevel(t: ReturnType<typeof createTestBackend>, kingdomId: any, buildingType: string, level: number) {
  await t.run(async (ctx) => {
    const existing = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect();
    const doc = existing.find((b) => b.buildingType === buildingType);
    if (doc) await ctx.db.patch(doc._id, { level });
    else await ctx.db.insert("buildings", { kingdomId, buildingType, level });
  });
}

describe("Fundación del reino (P4-P10, H)", () => {
  test("crea edificios fundacionales, territorio principal, bienestar inicial y civilización inmutable", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");
    const full = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(full?.kingdom.civilization).toBe("romanos");
    expect(full?.kingdom.happiness).toBe(70);
    expect(full?.population?.total).toBe(2000);
    const levels = Object.fromEntries((full?.buildings ?? []).map((b: any) => [b.buildingType, b.level]));
    expect(levels).toEqual(INITIAL_BUILDINGS);
    const territories = await asUser.query(api.territories.getKingdomTerritories, { kingdomId });
    expect(territories.homeTerritoryId).toBe("0,0");
    await expect(
      asUser.mutation(api.economy.getOrInitializeKingdom, { name: "Reino A", civilization: "vikingos" })
    ).rejects.toThrow(/no puede cambiarse/);
  });

  test("un usuario ajeno no puede operar sobre el reino (P1)", async () => {
    const t = createTestBackend();
    const { kingdomId } = await foundKingdom(t, "user-a", "Reino A");
    const intruder = t.withIdentity(identity("user-b"));
    await expect(intruder.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "granja" })).rejects.toThrow(/No autorizado/);
  });
});

describe("Construcción (Bloque A)", () => {
  test("descuenta el coste escalado, respeta el tope del Castillo y completa por tiempo de servidor", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");
    // Granja 11 → 12 supera el Castillo nivel 1
    await expect(asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "granja" })).rejects.toThrow(/Castillo/);
    // Cuartel 0 → 1 cabe en el tope y cuesta el nivel 1
    const before = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    const result = await asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "cuartel" });
    const expectedCosts = costsForTargetLevel(BUILDINGS.cuartel.baseCosts, 1)!;
    expect(result.costs.gold).toBe(expectedCosts.gold);
    const after = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(after!.resources.gold).toBeCloseTo(before!.resources.gold - expectedCosts.gold, 5);
    expect(result.completesAt - result.startedAt).toBe(BUILDINGS.cuartel.baseDurationSeconds * 1000);

    vi.setSystemTime(result.completesAt + 1000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const state = await asUser.query(api.kingdoms.getConstructionState, { kingdomId });
    expect(state.buildingLevels.cuartel).toBe(1);
    expect(state.constructionQueue).toHaveLength(0);
  });

  test("cancelar devuelve el 50 % y libera la ranura", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");
    const started = await asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "cuartel" });
    const mid = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    const cancelled = await asUser.mutation(api.kingdoms.cancelConstruction, { kingdomId, constructionId: started.constructionId });
    expect(cancelled.refund.gold).toBe(Math.floor(started.costs.gold! * 0.5));
    const after = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(after!.resources.gold).toBeCloseTo(mid!.resources.gold + cancelled.refund.gold!, 5);
    const state = await asUser.query(api.kingdoms.getConstructionState, { kingdomId });
    expect(state.constructionQueue).toHaveLength(0);
  });
});

describe("Entrenamiento (Bloque B)", () => {
  test("reserva población civil libre, cobra el coste y entrega las tropas al vencer el lote", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");
    await expect(asUser.mutation(api.army.startTraining, { kingdomId, unitType: "infanteria", count: 10 })).rejects.toThrow(/Cuartel/);
    await setBuildingLevel(t, kingdomId, "cuartel", 1);
    const before = await asUser.query(api.army.getArmyState, { kingdomId });
    const result = await asUser.mutation(api.army.startTraining, { kingdomId, unitType: "infanteria", count: 10 });
    expect(result.populationReserved).toBe(10);
    expect(result.costs.gold).toBe(UNITS.infanteria.costs.gold * 10);
    const during = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(during.availableCivil).toBe(before.availableCivil! - 10);
    expect(during.trainingQueue).toHaveLength(1);

    vi.setSystemTime(T0 + result.durationMs + 1000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(after.trainingQueue).toHaveLength(0);
    expect(after.summary.byType.infanteria.active).toBe(10);
    expect(after.summary.livingSoldiers).toBe(10);
  });

  test("los mercenarios exigen Taberna, cuestan oro y se suman al censo", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");
    await expect(asUser.mutation(api.army.hireMercenaries, { kingdomId, count: 5 })).rejects.toThrow(/Taberna/);
    await setBuildingLevel(t, kingdomId, "taberna", 1);
    const before = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    const hired = await asUser.mutation(api.army.hireMercenaries, { kingdomId, count: 5 });
    expect(hired.cost).toBe(125);
    const after = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(after!.population?.total).toBe(before!.population!.total + 5);
    const army = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(army.mercenaries.active).toBe(5);
  });
});

describe("Investigación (Bloque C)", () => {
  test("exige Universidad, cobra el coste y aplica el efecto al completarse", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");
    await expect(asUser.mutation(api.technologies.researchTechnology, { kingdomId, techType: "agri_1" })).rejects.toThrow(/Universidad/);
    await setBuildingLevel(t, kingdomId, "universidad", 1);
    const result = await asUser.mutation(api.technologies.researchTechnology, { kingdomId, techType: "agri_1" });
    expect(result.costs.gold).toBe(100);
    const during = await asUser.query(api.technologies.getTechnologies, { kingdomId });
    expect(during.researching).toHaveLength(1);
    expect(during.slotsFree).toBe(0);
    vi.setSystemTime(T0 + result.durationMs + 1000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await asUser.query(api.technologies.getTechnologies, { kingdomId });
    expect(after.researching).toHaveLength(0);
    expect(after.modifiers.agricultureProduction).toBeCloseTo(1.05, 9);
    expect(after.catalog.find((tech: any) => tech.id === "agri_1")?.status).toBe("completed");
  });
});

describe("Liquidación económica (Bloque D)", () => {
  test("tras un día real produce los cinco recursos, recauda impuestos y no crece sin viviendas libres", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");
    const before = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    vi.setSystemTime(T0 + DAY);
    const settled = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    expect(settled.resources.food).toBeGreaterThan(before!.resources.food);
    expect(settled.resources.wood).toBeCloseTo(before!.resources.wood + 250, 3);
    expect(settled.resources.stone).toBeCloseTo(before!.resources.stone + 187.5, 3);
    expect(settled.taxesCollected).toBeGreaterThan(0);
    expect(settled.population?.births).toBe(0);
    expect(settled.population?.growthCappedByHousing).toBe(true);
    expect(settled.happiness).toBe(70);
    expect(settled.militaryMorale).toBe(55);
    // Idempotencia: liquidar de nuevo en el mismo instante no cambia nada.
    const again = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    expect(again.resources.wood).toBeCloseTo(settled.resources.wood, 6);
  });

  test("el bonus diario se concede una vez cada 24 horas (P59)", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");
    const first = await asUser.mutation(api.kingdoms.claimDailyBonus, { kingdomId });
    expect(first.honor).toBe(DAILY_BONUS.HONOR);
    await expect(asUser.mutation(api.kingdoms.claimDailyBonus, { kingdomId })).rejects.toThrow(/ya fue reclamado/);
    vi.setSystemTime(T0 + DAILY_BONUS.COOLDOWN_MS + 1);
    const second = await asUser.mutation(api.kingdoms.claimDailyBonus, { kingdomId });
    expect(second.honor).toBe(DAILY_BONUS.HONOR * 2);
  });
});

describe("Parlamento y batalla (Bloques E y F)", () => {
  test("crea, acepta, congela y resuelve un desafío con informe y recompensas", async () => {
    const t = createTestBackend();
    const a = await foundKingdom(t, "user-a", "Reino A");
    const b = await foundKingdom(t, "user-b", "Reino B");
    for (const k of [a, b]) {
      await setBuildingLevel(t, k.kingdomId, "parlamento", 1);
      await setBuildingLevel(t, k.kingdomId, "cuartel", 1);
    }
    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: a.kingdomId, unitType: "infanteria", level: 3, count: 600 });
      await ctx.db.insert("armyUnits", { kingdomId: b.kingdomId, unitType: "infanteria", level: 1, count: 200 });
    });
    await expect(a.asUser.mutation(api.parliament.createChallenge, { challengerKingdomId: a.kingdomId, targetKingdomId: a.kingdomId, challengeType: "batalla" })).rejects.toThrow(/a sí mismo/);
    const created = await a.asUser.mutation(api.parliament.createChallenge, { challengerKingdomId: a.kingdomId, targetKingdomId: b.kingdomId, challengeType: "batalla" });
    expect(created.distance).toBeGreaterThan(0);

    const parliamentB = await b.asUser.query(api.parliament.getParliament, { kingdomId: b.kingdomId });
    expect(parliamentB.badgeCount).toBe(1);
    const accepted = await b.asUser.mutation(api.parliament.acceptChallenge, { kingdomId: b.kingdomId, challengeId: created.challengeId, window: "proxima" });
    expect(accepted.scheduledAt).toBe(T0 + PARLIAMENT.SCHEDULE_WINDOWS_MS.proxima);
    expect(accepted.freezeAt).toBe(accepted.scheduledAt - PARLIAMENT.FREEZE_BEFORE_BATTLE_MS);
    // Un segundo desafío entre los mismos reinos se rechaza mientras hay uno abierto.
    await expect(a.asUser.mutation(api.parliament.createChallenge, { challengerKingdomId: a.kingdomId, targetKingdomId: b.kingdomId, challengeType: "batalla" })).rejects.toThrow(/abierto/);

    vi.setSystemTime(accepted.scheduledAt + 1000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const battles = await a.asUser.query(api.parliament.getBattles, { kingdomId: a.kingdomId });
    expect(battles).toHaveLength(1);
    const report = battles[0].report;
    expect(["victoria", "derrota", "empate"]).toContain(report.outcome);
    expect(report.attacker.initial).toBe(600);
    expect(report.defender.initial).toBe(200);
    expect(report.attacker.survivors + report.attacker.casualties).toBe(600);
    const parliamentA = await a.asUser.query(api.parliament.getParliament, { kingdomId: a.kingdomId });
    expect(parliamentA.challenges[0].status).toBe("RESOLVED");
    expect(parliamentA.honor).toBe(report.honorAwarded.attacker);
    const armyA = await a.asUser.query(api.army.getArmyState, { kingdomId: a.kingdomId });
    expect(armyA.summary.byType.infanteria.active).toBe(report.attacker.survivors);
    expect(armyA.summary.byType.infanteria.wounded).toBe(report.attacker.wounded);
  });

  test("rechazar un desafío aplica la penalización del 2 % con mínimo 10", async () => {
    const t = createTestBackend();
    const a = await foundKingdom(t, "user-a", "Reino A");
    const b = await foundKingdom(t, "user-b", "Reino B");
    for (const k of [a, b]) await setBuildingLevel(t, k.kingdomId, "parlamento", 1);
    const created = await a.asUser.mutation(api.parliament.createChallenge, { challengerKingdomId: a.kingdomId, targetKingdomId: b.kingdomId, challengeType: "batalla" });
    const before = await b.asUser.query(api.kingdoms.getKingdomFull, { userId: "user-b" });
    const rejected = await b.asUser.mutation(api.parliament.rejectChallenge, { kingdomId: b.kingdomId, challengeId: created.challengeId });
    expect(rejected.penalty.gold).toBe(10);
    expect(rejected.penalty.food).toBe(50);
    const after = await b.asUser.query(api.kingdoms.getKingdomFull, { userId: "user-b" });
    expect(after!.resources.gold).toBeCloseTo(before!.resources.gold - 10, 5);
    await expect(b.asUser.mutation(api.parliament.rejectChallenge, { kingdomId: b.kingdomId, challengeId: created.challengeId })).rejects.toThrow(/Transición inválida/);
    expect(internal).toBeDefined();
  });
});
