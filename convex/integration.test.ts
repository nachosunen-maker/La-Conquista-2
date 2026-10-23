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
import { DEMO_USER_ID } from "./kingdomAccess";
import { ensureHomeTerritory } from "./territories";

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

  test("un invitado no autenticado puede consultar el reino demo Iberia pero no reinos privados ajenos", async () => {
    const t = createTestBackend();
    await t.run(async (ctx) => {
      await ctx.db.insert("kingdoms", {
        name: "Reino de Iberia",
        civilization: "ingleses",
        castleName: "Castillo de Zaragoza",
        monarchName: "Rey Arturo",
        userId: DEMO_USER_ID,
        happiness: 70,
        militaryMorale: 70,
        taxPolicy: "normales",
      });
    });
    // Invitado anónimo sin sesión
    const demoFull = await t.query(api.kingdoms.getKingdomFull, { userId: DEMO_USER_ID });
    expect(demoFull?.kingdom.name).toBe("Reino de Iberia");
    expect(demoFull?.kingdom.userId).toBe(DEMO_USER_ID);

    // Consulta de reino privado por usuario no autenticado es rechazada retornando null
    const privateFull = await t.query(api.kingdoms.getKingdomFull, { userId: "user-private" });
    expect(privateFull).toBeNull();
  });

  test("un invitado o atacante con DEMO_USER_ID no puede ejecutar mutaciones ni alterar datos", async () => {
    const t = createTestBackend();
    const { kingdomId } = await foundKingdom(t, "user-a", "Reino A");

    // 1. Invitado anónimo (sin sesión OIDC) intenta mutar
    await expect(
      t.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "granja" })
    ).rejects.toThrow(/Autenticación requerida/);

    await expect(
      t.mutation(api.economy.getOrInitializeKingdom, { name: "Reino Hacker", civilization: "romanos" })
    ).rejects.toThrow(/Autenticación requerida/);

    // 2. Intruso que finge token con DEMO_USER_ID como subject
    const fakeDemoCaller = t.withIdentity(identity(DEMO_USER_ID));
    await expect(
      fakeDemoCaller.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "granja" })
    ).rejects.toThrow(/No autorizado/);
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
    // Duración con bonificación romana (−10 % duración de construcción, P6)
    expect(result.completesAt - result.startedAt).toBe(Math.ceil(BUILDINGS.cuartel.baseDurationSeconds * 1000 * 0.90));

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
    expect(hired.typeId).toBe("lanceros");
    const after = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(after!.population?.total).toBe(before!.population!.total + 5);
    const army = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(army.mercenaries.active).toBe(5);
    // Tipos ligados al nivel de Taberna (decisión 21-10-2026): los jinetes exigen Taberna 3.
    await expect(asUser.mutation(api.army.hireMercenaries, { kingdomId, count: 2, typeId: "jinetes" })).rejects.toThrow(/Taberna nivel 3/);
    await setBuildingLevel(t, kingdomId, "taberna", 3);
    const riders = await asUser.mutation(api.army.hireMercenaries, { kingdomId, count: 2, typeId: "jinetes" });
    expect(riders.cost).toBe(150);
    expect(riders.unitType).toBe("caballeria");
    const armyAfter = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(armyAfter.mercenaries.active).toBe(7);
    expect(armyAfter.summary.byType.caballeria.active).toBe(2);
    expect(armyAfter.mercenaries.types.filter((type: any) => type.available).map((type: any) => type.id)).toEqual(["mesnada", "lanceros", "arqueros", "jinetes"]);
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
    expect(settled.resources.stone).toBeCloseTo(before!.resources.stone + 206.25, 3);
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

describe("Exploración del mapa y territorios libres (P22, P49)", () => {
  test("inicia expedición, reserva explorador, completa autoritativamente y revela la celda con hallazgo", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");

    const mapBefore = await asUser.query(api.territories.getWorldMap, { kingdomId });
    expect(mapBefore.exploredCount).toBe(7); // Capital (0,0) + 6 vecinos iniciales

    const target = mapBefore.cells.find((c) => c.cellId === "1,1")!;
    expect(target.state).toBe("fog");
    expect(target.canExplore).toBe(true);

    const fullBefore = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    const freeCivilBefore = fullBefore!.population!.available;

    const started = await asUser.mutation(api.territories.startExploration, { kingdomId, cellId: "1,1" });
    expect(started.costs.gold).toBe(30);
    expect(started.costs.food).toBe(40);

    const during = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(during!.resources.gold).toBeCloseTo(fullBefore!.resources.gold - 30, 5);
    expect(during!.resources.food).toBeCloseTo(fullBefore!.resources.food - 40, 5);
    expect(during!.population!.available).toBe(freeCivilBefore - 1);

    const mapDuring = await asUser.query(api.territories.getWorldMap, { kingdomId });
    const cellDuring = mapDuring.cells.find((c) => c.cellId === "1,1");
    expect(cellDuring?.state).toBe("exploring");
    expect(mapDuring.activeExpeditions).toHaveLength(1);

    // Avanzar reloj hasta completar la expedición
    vi.setSystemTime(started.completesAt + 1000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const mapAfter = await asUser.query(api.territories.getWorldMap, { kingdomId });
    const cellAfter = mapAfter.cells.find((c) => c.cellId === "1,1");
    expect(cellAfter?.state).toBe("explored");
    expect(cellAfter?.terrain).not.toBe("desconocido");
    expect(mapAfter.exploredCount).toBe(8);

    const fullAfter = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(fullAfter!.population!.available).toBe(freeCivilBefore); // Explorador devuelto
  });

  test("cancelar expedición devuelve el 50 % de costes y libera al explorador", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");

    const fullBefore = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    const started = await asUser.mutation(api.territories.startExploration, { kingdomId, cellId: "1,1" });
    const cancelled = await asUser.mutation(api.territories.cancelExploration, {
      kingdomId,
      expeditionId: started.expeditionId,
    });

    expect(cancelled.refund.gold).toBe(15);
    expect(cancelled.refund.food).toBe(20);

    const fullAfter = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(fullAfter!.population!.available).toBe(fullBefore!.population!.available);
    expect(fullAfter!.resources.gold).toBeCloseTo(fullBefore!.resources.gold - 15, 5);

    const mapAfter = await asUser.query(api.territories.getWorldMap, { kingdomId });
    expect(mapAfter.activeExpeditions).toHaveLength(0);
  });

  test("reclamar territorio libre (P49) exige que esté explorado previamente", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");

    // Conceder 1 reclamación de territorio pendiente
    await t.run(async (ctx) => {
      await ctx.db.patch(kingdomId, { pendingTerritoryClaims: 1 });
    });

    // Celda lejana inexplorada no puede ser reclamada
    await expect(
      asUser.mutation(api.territories.claimFreeTerritory, { kingdomId, cellId: "5,-2" })
    ).rejects.toThrow(/explorar y cartografiar/);

    // Celda adyacente conocida (0,1) está en la visión inicial y a distancia 1: puede reclamarse
    const claimed = await asUser.mutation(api.territories.claimFreeTerritory, { kingdomId, cellId: "0,1" });
    expect(claimed.success).toBe(true);
    expect(claimed.remainingClaims).toBe(0);

    const territories = await asUser.query(api.territories.getKingdomTerritories, { kingdomId });
    expect(territories.territories).toHaveLength(2); // Capital (0,0) + nuevo territorio (0,1)
  });
});

describe("Autenticación y seguridad de identidad (P1, P4, T-01): identidad simulada del servidor", () => {
  test("getViewer devuelve null para invitados anónimos y la identidad verificada para usuarios con sesión", async () => {
    const t = createTestBackend();

    // 1. Invitado anónimo
    const anonymousViewer = await t.query(api.kingdoms.getViewer, {});
    expect(anonymousViewer).toBeNull();

    // 2. Usuario con sesión verificada (identidad simulada; el inicio real por contraseña se prueba en account.test.ts)
    const googleUser = t.withIdentity({
      subject: "198291664207-user-12345",
      tokenIdentifier: "https://accounts.google.com|198291664207-user-12345",
      issuer: "https://accounts.google.com",
      email: "soberano@example.com",
      name: "Rey Alfonso",
    });
    const verifiedViewer = await googleUser.query(api.kingdoms.getViewer, {});
    expect(verifiedViewer).not.toBeNull();
    expect(verifiedViewer?.subject).toBe("198291664207-user-12345");
    expect(verifiedViewer?.email).toBe("soberano@example.com");
    expect(verifiedViewer?.name).toBe("Rey Alfonso");
    expect(verifiedViewer?.tokenIdentifier).toBe("https://accounts.google.com|198291664207-user-12345");
  });

  test("todas las mutaciones económicas y de gobierno rechazan llamadas sin identidad verificada", async () => {
    const t = createTestBackend();
    const { kingdomId } = await foundKingdom(t, "user-legit", "Reino Legítimo");

    // Intento de fundar sin auth
    await expect(
      t.mutation(api.economy.getOrInitializeKingdom, { name: "Reino Pirata", civilization: "romanos" })
    ).rejects.toThrow(/Autenticación requerida/);

    // Intento de liquidar economía sin auth
    await expect(
      t.mutation(api.economy.settleKingdomEconomy, { kingdomId })
    ).rejects.toThrow(/Autenticación requerida/);

    // Intento de modificar régimen alimentario sin auth
    await expect(
      t.mutation(api.economy.setKingdomFoodTier, { kingdomId, foodTier: "abundante" })
    ).rejects.toThrow(/Autenticación requerida/);

    // Intento de cambiar política de descanso sin auth
    await expect(
      t.mutation(api.economy.setRestPolicy, { kingdomId, restPolicy: "festiva" })
    ).rejects.toThrow(/Autenticación requerida/);

    // Intento de iniciar construcción sin auth
    await expect(
      t.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "granja" })
    ).rejects.toThrow(/Autenticación requerida/);
  });

  test("un usuario autenticado no puede consultar ni usurpar el reino de otro usuario", async () => {
    const t = createTestBackend();
    const userA = t.withIdentity(identity("google-sub-a"));
    const userB = t.withIdentity(identity("google-sub-b"));

    // User A funda su reino
    const kingdomA = await userA.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino de A",
      civilization: "bizantinos",
    });

    // User A puede consultar su propio reino
    const fullA = await userA.query(api.kingdoms.getKingdomFull, { userId: "google-sub-a" });
    expect(fullA?.kingdom.name).toBe("Reino de A");

    // User B intenta consultar el reino de User A -> error de autorización
    await expect(
      userB.query(api.kingdoms.getKingdomFull, { userId: "google-sub-a" })
    ).rejects.toThrow(/No autorizado/);

    // User B intenta mutar el reino de User A -> rechazado
    await expect(
      userB.mutation(api.kingdoms.startConstruction, { kingdomId: kingdomA._id as any, buildingType: "granja" })
    ).rejects.toThrow(/No autorizado/);
  });

  test("el reino de demostración Iberia solo admite lecturas y prohíbe cualquier mutación", async () => {
    const t = createTestBackend();
    let demoKingdomId: any;
    await t.run(async (ctx) => {
      demoKingdomId = await ctx.db.insert("kingdoms", {
        name: "Reino de Iberia",
        civilization: "ingleses",
        castleName: "Castillo de Zaragoza",
        monarchName: "Rey Arturo",
        userId: DEMO_USER_ID,
        happiness: 70,
        militaryMorale: 70,
        taxPolicy: "normales",
      });
    });

    // 1. Invitado anónimo lee la demo con éxito
    const demoFull = await t.query(api.kingdoms.getKingdomFull, { userId: DEMO_USER_ID });
    expect(demoFull?.kingdom.name).toBe("Reino de Iberia");

    // 2. Invitado anónimo intenta mutar la demo -> falla
    await expect(
      t.mutation(api.kingdoms.startConstruction, { kingdomId: demoKingdomId, buildingType: "granja" })
    ).rejects.toThrow(/Autenticación requerida/);

    // 3. Atacante autenticado con DEMO_USER_ID como subject intenta reiniciar o mutar la demo -> rechazado
    const attacker = t.withIdentity(identity(DEMO_USER_ID));
    await expect(
      attacker.mutation(api.kingdoms.startConstruction, { kingdomId: demoKingdomId, buildingType: "granja" })
    ).rejects.toThrow(/No autorizado/);

    await expect(
      attacker.mutation(api.economy.resetKingdom, { kingdomId: demoKingdomId })
    ).rejects.toThrow(/No autorizado|demostración no puede reiniciarse/);
  });
});

describe("Campañas militares y marchas sobre el mapa (Bloque G, P34-P41)", () => {
  test("lanza ataque, programa llegada, simula batalla y devuelve supervivientes", async () => {
    const t = createTestBackend();
    const attacker = await foundKingdom(t, "user-atk", "Reino Atacante");
    const defender = await foundKingdom(t, "user-def", "Reino Defensor");

    await attacker.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: attacker.kingdomId });
    await defender.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: defender.kingdomId });

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: attacker.kingdomId, unitType: "infanteria", level: 1, count: 500 });
      await ctx.db.insert("armyUnits", { kingdomId: defender.kingdomId, unitType: "infanteria", level: 1, count: 100 });
    });

    const defTerritories = await defender.asUser.query(api.territories.getKingdomTerritories, { kingdomId: defender.kingdomId });
    const targetCellId = defTerritories.homeTerritoryId!;

    const marchRes = await attacker.asUser.mutation(api.army.launchAttack, {
      kingdomId: attacker.kingdomId,
      cellId: targetCellId,
      units: [{ unitType: "infanteria", level: 1, count: 300 }],
    });
    expect(marchRes.success).toBe(true);
    expect(marchRes.marchId).toBeDefined();

    vi.setSystemTime(T0 + marchRes.durationSeconds * 1000 + 5000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const armyA = await attacker.asUser.query(api.army.getArmyState, { kingdomId: attacker.kingdomId });
    expect(armyA.summary.livingSoldiers).toBeGreaterThan(0);
  });

  test("las tropas de niveles distintos conservan su nivel al regresar de campaña", async () => {
    const t = createTestBackend();
    const attacker = await foundKingdom(t, "user-atk-lvl", "Reino Atacante Nivel");
    const defender = await foundKingdom(t, "user-def-lvl", "Reino Defensor Nivel");

    await attacker.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: attacker.kingdomId });
    await defender.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: defender.kingdomId });

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: attacker.kingdomId, unitType: "infanteria", level: 2, count: 200 });
      await ctx.db.insert("armyUnits", { kingdomId: defender.kingdomId, unitType: "infanteria", level: 1, count: 50 });
    });

    const defTerritories = await defender.asUser.query(api.territories.getKingdomTerritories, { kingdomId: defender.kingdomId });
    const targetCellId = defTerritories.homeTerritoryId!;

    const marchRes = await attacker.asUser.mutation(api.army.launchAttack, {
      kingdomId: attacker.kingdomId,
      cellId: targetCellId,
      units: [{ unitType: "infanteria", level: 2, count: 200 }],
    });
    expect(marchRes.success).toBe(true);

    vi.setSystemTime(T0 + marchRes.durationSeconds * 1000 + 5000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const armyState = await attacker.asUser.query(api.army.getArmyState, { kingdomId: attacker.kingdomId });
    const level2Unit = armyState.units.find((u: any) => u.unitType === "infanteria" && u.level === 2);
    expect(level2Unit).toBeDefined();
    expect(level2Unit.count).toBeGreaterThan(0);
  });

  test("seguridad getWorldMap: prohíbe espiar la niebla de guerra de otro reino", async () => {
    const t = createTestBackend();
    const userA = await foundKingdom(t, "user-map-a", "Reino A");
    const userB = await foundKingdom(t, "user-map-b", "Reino B");

    // 1. Un usuario no puede consultar la niebla de guerra ni expediciones de un reino ajeno
    await expect(
      userA.asUser.query(api.territories.getWorldMap, { kingdomId: userB.kingdomId })
    ).rejects.toThrow("No autorizado: solo puede consultar la niebla de guerra de su propio reino.");

    // 2. Un usuario sí puede consultar su propia niebla de guerra
    const ownMap = await userA.asUser.query(api.territories.getWorldMap, { kingdomId: userA.kingdomId });
    expect(ownMap.cells.length).toBe(331);
    expect(ownMap.exploredCount).toBe(7);
  });

  // PRUEBA 2: Mapa del reino demo por invitado anónimo en modo solo lectura
  test("seguridad getWorldMap: invitado anónimo puede consultar el mapa del reino demo en modo solo lectura", async () => {
    const t = createTestBackend();
    // 1. Configurar el reino demo de forma directa en base de datos sin ejecutar mutaciones
    const demoKingdomId = await t.run(async (ctx) => {
      const kId = await ctx.db.insert("kingdoms", {
        name: "Reino de Iberia",
        civilization: "ingleses",
        castleName: "Castillo de Zaragoza",
        monarchName: "Rey Arturo",
        userId: DEMO_USER_ID,
        happiness: 70,
        militaryMorale: 70,
        taxPolicy: "normales",
      });
      await ensureHomeTerritory(ctx, kId);
      return kId;
    });

    // 2. Consulta anónima (sin sesión ni autenticación)
    const demoMap = await t.query(api.territories.getWorldMap, { kingdomId: demoKingdomId });
    expect(demoMap).toBeDefined();
    expect(demoMap.radius).toBe(10);
    expect(demoMap.totalCells).toBe(331);
    expect(demoMap.cells).toHaveLength(331);
    expect(demoMap.exploredCount).toBe(7); // Capital y sus 6 vecinos iniciales
    expect(demoMap.homeTerritoryId).toBe("0,0");
    expect(demoMap.activeExpeditions).toEqual([]);

    // Comprobar la celda capital del reino demo
    const homeCell = demoMap.cells.find((c) => c.cellId === "0,0");
    expect(homeCell).toBeDefined();
    expect(homeCell?.state).toBe("owned");
    expect(homeCell?.isHome).toBe(true);
    expect(homeCell?.ownerKingdomId).toBe(demoKingdomId);
  });

  // PRUEBA 3: Mapa global neutral sin exponer datos privados de ningún reino
  test("seguridad getWorldMap: consulta neutral sin kingdomId no expone datos privados de ningún reino", async () => {
    const t = createTestBackend();
    // 1. Crear un reino privado con reclamaciones pendientes y expedición activa
    const { asUser, kingdomId } = await foundKingdom(t, "user-priv-map", "Reino Privado");
    await t.run(async (ctx) => {
      await ctx.db.patch(kingdomId, { pendingTerritoryClaims: 3 });
    });
    await asUser.mutation(api.territories.startExploration, { kingdomId, cellId: "1,1" });

    // 2. Consulta global pública/neutral (sin kingdomId)
    const publicMap = await t.query(api.territories.getWorldMap, {});

    // Comprobar que no se filtran expediciones privadas, reclamaciones ni territorio principal
    expect(publicMap.activeExpeditions).toHaveLength(0);
    expect(publicMap.pendingClaims).toBe(0);
    expect(publicMap.homeTerritoryId).toBeNull();
    expect(publicMap.totalCells).toBe(331);
    expect(publicMap.cells).toHaveLength(331);

    // Comprobar exhaustivamente cada una de las 331 celdas devueltas
    for (const cell of publicMap.cells) {
      expect(cell.canExplore).toBe(false);
      expect(cell.explorationPlan).toBeNull();
      expect(cell.expedition).toBeNull();
    }
  });

  test("seguridad military:trainUnits: bloquea reinos ajenos y no permite inyección de reglas arbitrarias", async () => {
    const t = createTestBackend();
    const attacker = await foundKingdom(t, "user-atk-rule", "Reino Atacante");
    const victim = await foundKingdom(t, "user-vic-rule", "Reino Víctima");

    // 1. Intento de entrenar tropas en reino ajeno -> rechazado por titularidad
    await expect(
      attacker.asUser.mutation(api.military.trainUnits, {
        kingdomId: victim.kingdomId,
        unitType: "infanteria",
        count: 10,
        level: 1,
      })
    ).rejects.toThrow("No autorizado: el reino no pertenece al usuario autenticado.");

    // 2. Intento de entrenar con reglas canónicas pendientes de especificación oficial -> falla de forma segura en servidor
    await expect(
      attacker.asUser.mutation(api.military.trainUnits, {
        kingdomId: attacker.kingdomId,
        unitType: "infanteria",
        count: 10,
        level: 1,
      })
    ).rejects.toThrow("pendientes de especificación oficial");
  });

  // PRUEBA 1: Rechazo de argumento retirado overrideRule por validación de argumentos
  test("seguridad military:trainUnits: rechaza llamadas con overrideRule por error de validación de argumentos", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-override", "Reino Override");

    let thrownError: any = null;
    try {
      await asUser.mutation(api.military.trainUnits, {
        kingdomId,
        unitType: "infanteria",
        count: 10,
        level: 1,
        overrideRule: {
          unitType: "infanteria",
          level: 1,
          costsPerUnit: { gold: 0, wood: 0, stone: 0, iron: 0, food: 0 },
          durationMsPerUnit: 1,
          prerequisites: {},
        },
      } as any);
    } catch (err: any) {
      thrownError = err;
    }
    expect(thrownError).not.toBeNull();
    // Validar rechazo estricto a nivel de validador de argumentos por el campo 'overrideRule'
    // sin alcanzar la lógica posterior del handler (ni fallo de reglas, ni de costes, ni de titularidad)
    expect(thrownError.message).toContain("overrideRule");
    expect(thrownError.message).not.toContain("pendientes de especificación oficial");
    expect(thrownError.message).not.toContain("No autorizado");
  });
});


