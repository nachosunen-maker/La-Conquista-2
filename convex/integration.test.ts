/**
 * LA CONQUISTA — PRUEBAS DE INTEGRACIÓN (T-04) sobre el backend simulado de convex-test.
 * Cubren fundación, construcción, entrenamiento, investigación, liquidación, bonus diario,
 * Parlamento y resolución de batallas con el reloj controlado.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { createTestBackend } from "./test.setup";
import { INITIAL_BUILDINGS, TIME, BUILDINGS, UNITS, DAILY_BONUS, PARLIAMENT, RESOURCE_PRODUCTION_MULTIPLIERS, PRODUCTION_PER_WORKER_PER_DAY, TERRITORIES, TERRAINS, OUTAGE_COMPENSATION, CIVILIZATION_ZONES } from "./balanceConfig";
import { costsForTargetLevel, BUILDING_RULES } from "./buildingRules";
import { DEMO_USER_ID } from "./kingdomAccess";
import { ensureHomeTerritory } from "./territories";
import { generateWorldCells, hexDistance } from "./territoryRules";

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
    expect(territories.homeTerritoryId).toBe(`${CIVILIZATION_ZONES.romanos.q},${CIVILIZATION_ZONES.romanos.r}`);
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
    if (!result.success) throw new Error("startConstruction failed");
    const expectedCosts = costsForTargetLevel(BUILDINGS.cuartel.baseCosts, 1)!;
    expect(result.costs.gold).toBe(expectedCosts.gold);
    const after = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(after!.resources.gold).toBeCloseTo(before!.resources.gold - expectedCosts.gold, 5);
    // Duración con bonificación romana (−10 % duración de construcción, P6) y multiplicador global
    expect(result.completesAt - result.startedAt).toBe(Math.ceil(BUILDING_RULES.cuartel.baseDurationMs! * 0.90));

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
    if (!started.success) throw new Error("startConstruction failed");
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
    expect(hired.cost).toBe(100);
    expect(hired.typeId).toBe("mesnada_sueldo");
    const after = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(after!.population?.total).toBe(before!.population!.total + 5);
    const army = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(army.mercenaries.active).toBe(5);
    // Tipos ligados al nivel de Taberna: los jinetes exigen Taberna 3.
    await expect(asUser.mutation(api.army.hireMercenaries, { kingdomId, count: 2, typeId: "jinetes" })).rejects.toThrow(/Taberna nivel 3/);
    await setBuildingLevel(t, kingdomId, "taberna", 3);
    const riders = await asUser.mutation(api.army.hireMercenaries, { kingdomId, count: 2, typeId: "jinetes" });
    expect(riders.cost).toBe(150);
    expect(riders.unitType).toBe("caballeria");
    const armyAfter = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(armyAfter.mercenaries.active).toBe(7);
    expect(armyAfter.summary.byType.caballeria.active).toBe(2);
    expect(armyAfter.mercenaries.types.filter((type: any) => type.available).map((type: any) => type.id)).toEqual(["mesnada_sueldo", "lanceros_sueldo", "arqueros_fortuna", "jinetes_fortuna"]);
  });

  test("configurar formación táctica: valida en servidor, persiste en el reino y por defecto es equilibrada", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-tactics", "Reino Táctico");
    const state0 = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state0.equipment.tacticalFormation).toBe("equilibrada");

    // Guardar formación táctica válida
    const res = await asUser.mutation(api.army.setTacticalFormation, { kingdomId, tacticalFormation: "ofensiva" });
    expect(res.tacticalFormation).toBe("ofensiva");
    expect(res.attack).toBe(1.12);
    expect(res.defense).toBe(0.9);

    const state1 = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state1.equipment.tacticalFormation).toBe("ofensiva");

    // Rechazar formación arbitraria o inválida
    await expect(asUser.mutation(api.army.setTacticalFormation, { kingdomId, tacticalFormation: "invencible" })).rejects.toThrow(/Formación desconocida/);

    // Permite actualizarla mediante setArmyEquipment
    await setBuildingLevel(t, kingdomId, "herreria", 2);
    await setBuildingLevel(t, kingdomId, "minaHierro", 1);
    const equip = await asUser.mutation(api.army.setArmyEquipment, {
      kingdomId,
      weaponTier: "espadaHierro",
      armorTier: "cueroReforzado",
      strategy: "defensiva",
      tacticalFormation: "flanqueo",
    });
    expect(equip.tacticalFormation).toBe("flanqueo");
    const state2 = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state2.equipment.tacticalFormation).toBe("flanqueo");
  });
});

describe("Singularidades por civilización (decisión 21-10-2026)", () => {
  test("los ingleses instruyen arqueros un 10 % más rápido y pagan la caballería un 15 % más cara; los romanos ven su Castra", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-eng"));
    const english = await asUser.mutation(api.economy.getOrInitializeKingdom, { name: "Albión", civilization: "ingleses", castleName: "Torre", monarchName: "Ricardo" });
    await setBuildingLevel(t, english._id as any, "castillo", 3);
    await setBuildingLevel(t, english._id as any, "cuartel", 3);
    await setBuildingLevel(t, english._id as any, "herreria", 1);
    await t.run(async (ctx) => {
      const res = await ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", english._id as any)).first();
      if (res) await ctx.db.patch(res._id, { gold: 5_000, wood: 5_000, stone: 5_000, iron: 5_000, food: 5_000 });
    });
    const archers = await asUser.mutation(api.army.startTraining, { kingdomId: english._id as any, unitType: "arqueria", count: 10 });
    expect(archers.durationMs).toBe(Math.ceil(UNITS.arqueria.trainingSecondsPerUnit * 1000 * 10 * 0.9));
    const cavalry = await asUser.mutation(api.army.startTraining, { kingdomId: english._id as any, unitType: "caballeria", count: 10 });
    expect(cavalry.costs.gold).toBe(Math.ceil(UNITS.caballeria.costs.gold * 10 * 1.15));
    expect(cavalry.durationMs).toBe(UNITS.caballeria.trainingSecondsPerUnit * 1000 * 10);
    const army = await asUser.query(api.army.getArmyState, { kingdomId: english._id as any });
    expect(army.equipment.weaponCatalog.acero.label).toContain("Arco largo");
    expect(army.equipment.weaponCatalog.acero.multiplier).toBe(1.15);
    expect(army.equipment.civilizationWeakness).toContain("Caballería pesada");
    expect(army.unitCatalog.find((u: any) => u.unitType === "arqueria")?.label).toBe("Arquero de arco largo (Arquería)");

    const { asUser: roman, kingdomId } = await foundKingdom(t, "user-rom", "Roma");
    const construction = await roman.query(api.kingdoms.getConstructionState, { kingdomId });
    expect(construction.catalog.cuartel.label).toBe(`Castra (${BUILDINGS.cuartel.label})`);
    expect(construction.catalog.granja.label).toBe(BUILDINGS.granja.label);
    const civs = await t.query(api.civilizations.listCivilizations, {});
    expect(civs.profiles.find((p: any) => p.id === "navajos")?.pendingDesign).toBe(false);
    expect(civs.profiles.find((p: any) => p.id === "navajos")?.identity?.signatureUnit.name).toBe("Rastreador Diné");
    expect(civs.profiles.find((p: any) => p.id === "romanos")?.identity?.signatureUnit.name).toBe("Legionario");
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
    const territories = await asUser.query(api.territories.getKingdomTerritories, { kingdomId });
    const homeTerrain = territories.territories.find((cell) => cell.isHome)?.terrain as keyof typeof TERRAINS | undefined;
    const woodTerrainMult = 1 + (homeTerrain ? (TERRAINS[homeTerrain]?.production.wood ?? 0) : 0);
    const stoneTerrainMult = 1 + (homeTerrain ? (TERRAINS[homeTerrain]?.production.stone ?? 0) : 0);
    vi.setSystemTime(T0 + DAY);
    const settled = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    expect(settled.resources.food).toBeGreaterThan(before!.resources.food);
    expect(settled.resources.wood).toBeCloseTo(before!.resources.wood + 250 * PRODUCTION_PER_WORKER_PER_DAY.wood * woodTerrainMult * RESOURCE_PRODUCTION_MULTIPLIERS.wood, 3);
    expect(settled.resources.stone).toBeCloseTo(before!.resources.stone + 250 * PRODUCTION_PER_WORKER_PER_DAY.stone * 1.1 * stoneTerrainMult * RESOURCE_PRODUCTION_MULTIPLIERS.stone, 3);
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
    await t.run(async (ctx) => {
      const res = await ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
      if (res) await ctx.db.patch(res._id, { gold: 1000 });
    });
    const first = await asUser.mutation(api.kingdoms.claimDailyBonus, { kingdomId });
    expect(first.honor).toBe(DAILY_BONUS.HONOR);
    await expect(asUser.mutation(api.kingdoms.claimDailyBonus, { kingdomId })).rejects.toThrow(/ya fue reclamado/);
    vi.setSystemTime(T0 + DAILY_BONUS.COOLDOWN_MS + 1);
    const second = await asUser.mutation(api.kingdoms.claimDailyBonus, { kingdomId });
    expect(second.honor).toBe(DAILY_BONUS.HONOR * 2);
  });

  test("desbloqueo de población por ampliación de viviendas sin nacimientos retroactivos (Bloque 25)", async () => {
    const t = createTestBackend();
    // 1. Fundar reino de prueba con 2.000 habitantes y 2.000 plazas (Viviendas 20, Castillo 1)
    const { asUser, kingdomId } = await foundKingdom(t, "user-demografia", "Reino Demografía");
    const full0 = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-demografia" });
    expect(full0?.population?.total).toBe(2000);
    const constState0 = await asUser.query(api.kingdoms.getConstructionState, { kingdomId });
    expect(constState0.residentialCapacity).toBe(2000);

    // 2. Dejar transcurrir 1 día completo con las viviendas llenas y liquidar
    vi.setSystemTime(T0 + DAY);
    const settled1 = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });

    // 3. Confirmar que no hay nacimientos ni fracción acumulada pendiente
    expect(settled1.population?.births).toBe(0);
    expect(settled1.population?.growthCappedByHousing).toBe(true);
    const full1 = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-demografia" });
    expect(full1?.population?.total).toBe(2000);
    expect(full1?.population?.available).toBe(250);
    expect(full1?.population?.birthFraction ?? 0).toBe(0);

    // 4. Mejorar Castillo y Viviendas respetando restricciones (Viviendas 21 requiere Castillo 21)
    await expect(
      asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "viviendas" })
    ).rejects.toThrow(/Castillo/);

    await setBuildingLevel(t, kingdomId, "castillo", 21);
    await setBuildingLevel(t, kingdomId, "viviendas", 21);

    // 5. Completar ampliación y comprobar que la capacidad aumenta a 2.100 (100 plazas libres)
    const constState1 = await asUser.query(api.kingdoms.getConstructionState, { kingdomId });
    expect(constState1.residentialCapacity).toBe(2100);
    expect(constState1.buildingLevels.castillo).toBe(21);
    expect(constState1.buildingLevels.viviendas).toBe(21);

    // Liquidación inmediata (deltaT = 0 tras la ampliación): no hay nacimientos retroactivos
    const settledImmediate = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    expect(settledImmediate.population?.births).toBe(0);

    // 6. Avanzar 1 hora tras la ampliación: el crecimiento se reanuda a futuro
    const ONE_HOUR = 3600 * 1000;
    vi.setSystemTime(T0 + DAY + ONE_HOUR);
    const settled1h = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });

    // 7. Confirmar nacimientos correspondientes estrictamente a 1 hora (21 hab), sin retroactividad del día anterior
    expect(settled1h.population?.births).toBe(21);
    expect(settled1h.population?.growthCappedByHousing).toBe(false);
    const full1h = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-demografia" });
    expect(full1h?.population?.total).toBe(2021);
    expect(full1h?.population?.available).toBe(271);

    // Avanzar hasta completar el segundo día: llega al tope de 2.100 (+79 hab)
    vi.setSystemTime(T0 + 2 * DAY);
    const settled2d = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    expect(settled2d.population?.births).toBe(79);
    expect(settled2d.population?.growthCappedByHousing).toBe(true);
    const full2d = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-demografia" });
    expect(full2d?.population?.total).toBe(2100);
    expect(full2d?.population?.available).toBe(350);
  });

  test("capacidad de almacén: no supera el tope, descarta excedente, conserva reservas previas y amplía con Mercado (M-06)", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-storage", "Reino Almacén");

    // 1. Conservación de reservas preexistentes por encima del tope:
    // Fijar madera en 15.000 (superior al tope base de 10.000 con Mercado nivel 0)
    await t.run(async (ctx) => {
      const resDoc = await ctx.db.query("resources").filter((q) => q.eq(q.field("kingdomId"), kingdomId)).first();
      await ctx.db.patch(resDoc!._id, { wood: 15_000, stone: 9_900 });
    });

    // Avanzar 1 hora y liquidar
    vi.setSystemTime(T0 + 3600 * 1000);
    const settled1 = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });

    // La madera preexistente de 15.000 no se destruye por el tope
    expect(settled1.resources.wood).toBeGreaterThanOrEqual(15_000);

    // 2. Producción no supera el tope base (10.000 con Mercado 0):
    // La piedra arrancó en 9.900 y genera ~206/día (romanos).
    // Avanzar a 1 día completo (T0 + DAY)
    vi.setSystemTime(T0 + DAY);
    const settledDay = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });

    // La piedra queda estrictamente acotada a 10.000 y el excedente se descarta
    expect(settledDay.resources.stone).toBe(10_000);
    const fullCheck = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-storage" });
    expect(fullCheck?.resources.stone).toBe(10_000);

    // 3. Ampliación del Mercado eleva la capacidad efectiva: 10.000 + 2.000 * 1 = 12.000
    await setBuildingLevel(t, kingdomId, "mercado", 1);
    vi.setSystemTime(T0 + 2 * DAY);
    const settledExpanded = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });

    // Ahora la piedra puede crecer por encima de 10.000 hacia 12.000
    expect(settledExpanded.resources.stone).toBeGreaterThan(10_000);
    expect(settledExpanded.resources.stone).toBeLessThanOrEqual(12_000);
  });

  test("inanición prolongada en base de datos: transiciones de fase, bajas civiles, deserción militar e idempotencia (D-48)", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-starve", "Reino Inanición");

    // Preparar estado de hambruna total:
    // - Comida en 0
    // - Agricultores en 0 (pasan a disponibles para asegurar 0 producción de comida)
    // - Tropa regular: 100 infantes
    await t.run(async (ctx) => {
      const resDoc = await ctx.db.query("resources").filter((q) => q.eq(q.field("kingdomId"), kingdomId)).first();
      await ctx.db.patch(resDoc!._id, { food: 0 });

      const agriJob = await ctx.db.query("populationJobs")
        .filter((q) => q.and(q.eq(q.field("kingdomId"), kingdomId), q.eq(q.field("jobType"), "agriculture")))
        .first();
      if (agriJob) {
        await ctx.db.patch(agriJob._id, { assignedCount: 0 });
      }

      await ctx.db.insert("armyUnits", {
        kingdomId,
        unitType: "infanteria",
        level: 1,
        count: 100,
      });

      const popDoc = await ctx.db.query("population").filter((q) => q.eq(q.field("kingdomId"), kingdomId)).first();
      await ctx.db.patch(popDoc!._id, { available: 1250 });
    });

    // Día 1 (86.400s): entra en Fase 2 (1 día de déficit acumulado)
    vi.setSystemTime(T0 + DAY);
    const settledDay1 = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    expect(settledDay1.isStarving).toBe(true);
    expect(settledDay1.starvationPhase).toBe(2);
    expect(settledDay1.starvationSeconds).toBe(86_400);

    const fullD1 = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-starve" });
    expect(fullD1?.population?.total).toBe(2000);
    const armyD1 = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(armyD1.units.find((u: any) => u.unitType === "infanteria")?.count).toBe(100);

    // Día 2 (172.800s): sigue en Fase 2
    vi.setSystemTime(T0 + 2 * DAY);
    const settledDay2 = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    expect(settledDay2.starvationPhase).toBe(2);
    expect(settledDay2.starvationSeconds).toBe(172_800);

    // Día 3 (259.200s): alcanza el umbral de Fase 3 (3 días acumulados)
    vi.setSystemTime(T0 + 3 * DAY);
    const settledDay3 = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    expect(settledDay3.starvationPhase).toBe(3);
    expect(settledDay3.starvationSeconds).toBe(259_200);

    // Día 4 (345.600s): 1 día completo transcurrido dentro de Fase 3
    // Pérdidas: 0,5 % civil/día sobre 1.900 civiles = 9 bajas
    // Deserción militar: 1,0 % sobre 100 soldados = 1 deserción
    vi.setSystemTime(T0 + 4 * DAY);
    const settledDay4 = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    expect(settledDay4.starvationPhase).toBe(3);
    expect(settledDay4.starvationSeconds).toBe(345_600);
    expect(settledDay4.population?.deaths).toBe(9);
    expect(settledDay4.militaryDesertion).toBe(1);

    // Verificar persistencia en tablas population y armyUnits
    const fullD4 = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-starve" });
    expect(fullD4?.population?.total).toBe(1990); // 2000 - 9 civiles - 1 desertor
    const armyD4 = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(armyD4.units.find((u: any) => u.unitType === "infanteria")?.count).toBe(99);

    // Idempotencia: liquidar en el mismo instante no duplica pérdidas
    const settledRepeat = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    expect(settledRepeat.population?.deaths).toBe(0);
    expect(settledRepeat.militaryDesertion).toBe(0);
    const fullRepeat = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-starve" });
    expect(fullRepeat?.population?.total).toBe(1990);
    const armyRepeat = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(armyRepeat.units.find((u: any) => u.unitType === "infanteria")?.count).toBe(99);
  });

  test("los mercenarios no cobran salarios diarios durante la liquidación continua del tiempo", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-mercs", "Reino Mercenarios");

    await setBuildingLevel(t, kingdomId, "taberna", 1);
    await t.run(async (ctx) => {
      const resDoc = await ctx.db.query("resources").filter((q) => q.eq(q.field("kingdomId"), kingdomId)).first();
      await ctx.db.patch(resDoc!._id, { gold: 1000 });
    });

    const hired = await asUser.mutation(api.army.hireMercenaries, {
      kingdomId,
      typeId: "lanceros",
      count: 10,
    });
    expect(hired.success).toBe(true);

    const afterHire = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-mercs" });
    const goldAfterHire = afterHire!.resources.gold;
    expect(goldAfterHire).toBeCloseTo(750, 2);

    vi.setSystemTime(T0 + 2 * DAY);
    const settled = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });

    expect(settled.mercenaries?.salaryDue).toBe(0);
    expect(settled.mercenaries?.salaryPaid).toBe(0);
    expect(settled.mercenaries?.unpaid).toBe(false);

    const expectedGoldGain = (settled.taxesCollected ?? 0) + (settled.dailyProduction?.gold ?? 0) * 2;
    expect(settled.resources.gold).toBeCloseTo(goldAfterHire + expectedGoldGain, 2);
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
    // Honor de batalla más el de las misiones completadas por el camino (tropas entrenadas, batalla del día).
    const missionHonorA = await t.run(async (ctx) => {
      const docs = await ctx.db.query("missionProgress").withIndex("by_kingdom", (q) => q.eq("kingdomId", a.kingdomId)).collect();
      return docs.reduce((sum, doc) => sum + (Number(/\+(\d+) honor/.exec(doc.rewardSummary)?.[1] ?? 0)), 0);
    });
    expect(parliamentA.honor).toBe(report.honorAwarded.attacker + missionHonorA);
    const armyA = await a.asUser.query(api.army.getArmyState, { kingdomId: a.kingdomId });
    expect(armyA.summary.byType.infanteria.active).toBe(report.attacker.survivors);
    expect(armyA.summary.byType.infanteria.wounded).toBe(report.attacker.wounded);
  });

  test("rechazar un desafío aplica la penalización del 2 % con mínimo 10", async () => {
    const t = createTestBackend();
    const a = await foundKingdom(t, "user-a", "Reino A");
    const b = await foundKingdom(t, "user-b", "Reino B");
    for (const k of [a, b]) await setBuildingLevel(t, k.kingdomId, "parlamento", 1);
    await t.run(async (ctx) => {
      const res = await ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", b.kingdomId)).first();
      if (res) await ctx.db.patch(res._id, { gold: 300, food: 2500 });
    });
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
  test("inicia expedición, reserva espía profesional, completa autoritativamente y revela la celda con hallazgo", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 2, isSpy: true });
    });

    const mapBefore = await asUser.query(api.territories.getWorldMap, { kingdomId });
    expect(mapBefore.exploredCount).toBe(7); // Capital + 6 vecinos iniciales
    const [hq, hr] = mapBefore.homeTerritoryId!.split(",").map(Number);
    const targetCellId = `${hq + 1},${hr + 1}`;

    const target = mapBefore.cells.find((c) => c.cellId === targetCellId)!;
    expect(target.state).toBe("fog");
    expect(target.canExplore).toBe(true);

    const fullBefore = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    const freeCivilBefore = fullBefore!.population!.available;
    const armyBefore = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(armyBefore.spies.active).toBe(2);
    expect(armyBefore.spies.busy).toBe(0);

    const started = await asUser.mutation(api.territories.startExploration, { kingdomId, cellId: targetCellId });
    expect(started.costs.gold).toBe(30);
    expect(started.costs.food).toBe(40);

    const during = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(during!.resources.gold).toBeCloseTo(fullBefore!.resources.gold - 30, 5);
    expect(during!.resources.food).toBeCloseTo(fullBefore!.resources.food - 40, 5);
    expect(during!.population!.available).toBe(freeCivilBefore); // No consume civiles adicionales al enviar espía

    const armyDuring = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(armyDuring.spies.active).toBe(1);
    expect(armyDuring.spies.busy).toBe(1);

    const mapDuring = await asUser.query(api.territories.getWorldMap, { kingdomId });
    const cellDuring = mapDuring.cells.find((c) => c.cellId === targetCellId);
    expect(cellDuring?.state).toBe("exploring");
    expect(mapDuring.activeExpeditions).toHaveLength(1);

    // Avanzar reloj hasta completar la expedición
    vi.setSystemTime(started.completesAt + 1000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const mapAfter = await asUser.query(api.territories.getWorldMap, { kingdomId });
    const cellAfter = mapAfter.cells.find((c) => c.cellId === targetCellId);
    expect(cellAfter?.state).toBe("explored");
    expect(cellAfter?.terrain).not.toBe("desconocido");
    expect(mapAfter.exploredCount).toBe(8);

    const armyAfter = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(armyAfter.spies.active).toBe(2); // Espía devuelto
    expect(armyAfter.spies.busy).toBe(0);
    const fullAfter = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(fullAfter!.population!.available).toBe(freeCivilBefore);
  });

  test("cancelar expedición devuelve el 50 % de costes y libera al espía sin duplicar población civil", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-a", "Reino A");

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 2, isSpy: true });
    });

    const fullBefore = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    const territoriesBefore = await asUser.query(api.territories.getKingdomTerritories, { kingdomId });
    const [hq, hr] = territoriesBefore.homeTerritoryId!.split(",").map(Number);
    const started = await asUser.mutation(api.territories.startExploration, { kingdomId, cellId: `${hq + 1},${hr + 1}` });
    const cancelled = await asUser.mutation(api.territories.cancelExploration, {
      kingdomId,
      expeditionId: started.expeditionId,
    });

    expect(cancelled.refund.gold).toBe(15);
    expect(cancelled.refund.food).toBe(20);
    expect(cancelled.returnedSpies).toBe(1);

    const fullAfter = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-a" });
    expect(fullAfter!.population!.available).toBe(fullBefore!.population!.available);
    expect(fullAfter!.resources.gold).toBeCloseTo(fullBefore!.resources.gold - 15, 5);

    const armyAfter = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(armyAfter.spies.active).toBe(2);
    expect(armyAfter.spies.busy).toBe(0);

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

    // Celda adyacente conocida está en la visión inicial y a distancia 1: puede reclamarse
    const territoriesBefore = await asUser.query(api.territories.getKingdomTerritories, { kingdomId });
    const [hq, hr] = territoriesBefore.homeTerritoryId!.split(",").map(Number);
    const claimed = await asUser.mutation(api.territories.claimFreeTerritory, { kingdomId, cellId: `${hq},${hr + 1}` });
    expect(claimed.success).toBe(true);
    expect(claimed.remainingClaims).toBe(0);

    const territories = await asUser.query(api.territories.getKingdomTerritories, { kingdomId });
    expect(territories.territories).toHaveLength(2); // Capital + nuevo territorio adyacente
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

    const defTerritories = await defender.asUser.query(api.territories.getKingdomTerritories, { kingdomId: defender.kingdomId });
    const targetCellId = defTerritories.homeTerritoryId!;

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: attacker.kingdomId, unitType: "infanteria", level: 1, count: 500 });
      await ctx.db.insert("armyUnits", { kingdomId: defender.kingdomId, unitType: "infanteria", level: 1, count: 100 });
      await ctx.db.insert("exploredTerritories", { kingdomId: attacker.kingdomId, cellId: targetCellId, discoveredAt: T0 });
      await ctx.db.insert("challenges", {
        challengerKingdomId: attacker.kingdomId,
        targetKingdomId: defender.kingdomId,
        challengeType: "batalla",
        status: "ACCEPTED",
        createdAt: T0 - 90_000_000,
        expiresAt: T0 + 86_400_000,
        respondedAt: T0 - 86_400_000,
        window: "proxima",
        freezeAt: T0 - 900_000,
        scheduledAt: T0,
      });
    });

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

    const defTerritories = await defender.asUser.query(api.territories.getKingdomTerritories, { kingdomId: defender.kingdomId });
    const targetCellId = defTerritories.homeTerritoryId!;

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: attacker.kingdomId, unitType: "infanteria", level: 2, count: 200 });
      await ctx.db.insert("armyUnits", { kingdomId: defender.kingdomId, unitType: "infanteria", level: 1, count: 50 });
      await ctx.db.insert("exploredTerritories", { kingdomId: attacker.kingdomId, cellId: targetCellId, discoveredAt: T0 });
      await ctx.db.insert("challenges", {
        challengerKingdomId: attacker.kingdomId,
        targetKingdomId: defender.kingdomId,
        challengeType: "batalla",
        status: "ACCEPTED",
        createdAt: T0 - 90_000_000,
        expiresAt: T0 + 86_400_000,
        respondedAt: T0 - 86_400_000,
        window: "proxima",
        freezeAt: T0 - 900_000,
        scheduledAt: T0,
      });
    });

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

  test("marcha calcula el multiplicador de terreno medio con datos reales de la base de datos y coincide con previewArmyMarchPlan", async () => {
    const t = createTestBackend();
    const attacker = await foundKingdom(t, "user-atk-terr", "Reino Atacante Terreno");
    const defender = await foundKingdom(t, "user-def-terr", "Reino Defensor Terreno");

    await attacker.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: attacker.kingdomId });
    await defender.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: defender.kingdomId });

    const defTerritories = await defender.asUser.query(api.territories.getKingdomTerritories, { kingdomId: defender.kingdomId });
    const targetCellId = defTerritories.homeTerritoryId!;

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: attacker.kingdomId, unitType: "infanteria", level: 1, count: 200 });
      await ctx.db.insert("exploredTerritories", { kingdomId: attacker.kingdomId, cellId: targetCellId, discoveredAt: T0 });
      await ctx.db.insert("challenges", {
        challengerKingdomId: attacker.kingdomId,
        targetKingdomId: defender.kingdomId,
        challengeType: "batalla",
        status: "ACCEPTED",
        createdAt: T0 - 90_000_000,
        expiresAt: T0 + 86_400_000,
        respondedAt: T0 - 86_400_000,
        window: "proxima",
        freezeAt: T0 - 900_000,
        scheduledAt: T0,
      });
    });

    // 1. Obtener previsualización autoritativa
    const preview = await attacker.asUser.query(api.territories.previewArmyMarchPlan, {
      kingdomId: attacker.kingdomId,
      targetCellId,
      composition: { infanteria: 100 },
    });
    expect(preview.success).toBe(true);
    expect(preview.terrainMultiplier).toBeGreaterThanOrEqual(1.0);
    expect(preview.plan.distance).toBeGreaterThan(0);
    expect(preview.plan.durationSeconds).toBeGreaterThanOrEqual(900);
    expect(preview.plan.durationSeconds).toBeLessThanOrEqual(43200);

    // 2. Lanzar ataque y verificar coincidencia exacta con el plan
    const marchRes = await attacker.asUser.mutation(api.army.launchAttack, {
      kingdomId: attacker.kingdomId,
      cellId: targetCellId,
      units: [{ unitType: "infanteria", level: 1, count: 100 }],
    });
    expect(marchRes.success).toBe(true);
    expect(marchRes.distance).toBe(preview.plan.distance);
    expect(marchRes.durationSeconds).toBe(preview.plan.durationSeconds);

    // 3. Verificar datos guardados en la tabla armyMarches
    const savedMarch = await t.run(async (ctx) => {
      return await ctx.db.get(marchRes.marchId);
    });
    expect(savedMarch).toBeDefined();
    expect(savedMarch?.terrainMultiplier).toBe(preview.terrainMultiplier);
  }, 15000);

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
    expect(ownMap.cells.length).toBe(7651);
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
    expect(demoMap.radius).toBe(50);
    expect(demoMap.totalCells).toBe(7651);
    expect(demoMap.cells).toHaveLength(7651);
    expect(demoMap.exploredCount).toBe(7); // Capital y sus 6 vecinos iniciales
    const expectedDemoHome = `${CIVILIZATION_ZONES.ingleses.q},${CIVILIZATION_ZONES.ingleses.r}`;
    expect(demoMap.homeTerritoryId).toBe(expectedDemoHome);
    expect(demoMap.activeExpeditions).toEqual([]);

    // Comprobar la celda capital del reino demo
    const homeCell = demoMap.cells.find((c) => c.cellId === expectedDemoHome);
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
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 1, isSpy: true });
    });
    const privTerritories = await asUser.query(api.territories.getKingdomTerritories, { kingdomId });
    const [hq, hr] = privTerritories.homeTerritoryId!.split(",").map(Number);
    await asUser.mutation(api.territories.startExploration, { kingdomId, cellId: `${hq + 1},${hr + 1}` });

    // 2. Consulta global pública/neutral (sin kingdomId)
    const publicMap = await t.query(api.territories.getWorldMap, {});

    // Comprobar que no se filtran expediciones privadas, reclamaciones ni territorio principal
    expect(publicMap.activeExpeditions).toHaveLength(0);
    expect(publicMap.pendingClaims).toBe(0);
    expect(publicMap.homeTerritoryId).toBeNull();
    expect(publicMap.totalCells).toBe(7651);
    expect(publicMap.cells).toHaveLength(7651);

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

describe("Clasificación global de reinos (Bloque 15)", () => {
  test("ordena reinos de mayor a menor honor, maneja empates y reinos vacíos", async () => {
    const t = createTestBackend();
    
    // 1. Caso sin reinos: tabla vacía
    const emptyBoard = await t.query(api.parliament.getLeaderboard, {});
    expect(emptyBoard.rankings).toHaveLength(0);

    // 2. Crear reinos con diferentes niveles de honor y gloria
    const a = await foundKingdom(t, "user-lead-a", "Reino Bajo Honor");
    const b = await foundKingdom(t, "user-lead-b", "Reino Alto Honor");
    const c = await foundKingdom(t, "user-lead-c", "Reino Empate Honor 1");
    const d = await foundKingdom(t, "user-lead-d", "Reino Empate Honor 2");

    await t.run(async (ctx) => {
      await ctx.db.patch(a.kingdomId, { honor: 10, glory: 5 });
      await ctx.db.patch(b.kingdomId, { honor: 100, glory: 20 });
      // Empate en honor (50), pero distinto en gloria
      await ctx.db.patch(c.kingdomId, { honor: 50, glory: 10 });
      await ctx.db.patch(d.kingdomId, { honor: 50, glory: 30 });
    });

    const board = await b.asUser.query(api.parliament.getLeaderboard, { kingdomId: b.kingdomId });
    expect(board.rankings).toHaveLength(4);
    // Orden descendente por honor: b (100), d (50, glory 30), c (50, glory 10), a (10)
    expect(board.rankings[0].name).toBe("Reino Alto Honor");
    expect(board.rankings[0].honor).toBe(100);
    expect(board.rankings[0].rank).toBe(1);
    expect(board.rankings[0].isPlayer).toBe(true);

    expect(board.rankings[1].name).toBe("Reino Empate Honor 2"); // Mayor gloria (30 > 10)
    expect(board.rankings[1].honor).toBe(50);
    expect(board.rankings[1].glory).toBe(30);
    expect(board.rankings[1].rank).toBe(2);

    expect(board.rankings[2].name).toBe("Reino Empate Honor 1");
    expect(board.rankings[2].honor).toBe(50);
    expect(board.rankings[2].glory).toBe(10);
    expect(board.rankings[2].rank).toBe(3);

    expect(board.rankings[3].name).toBe("Reino Bajo Honor");
    expect(board.rankings[3].honor).toBe(10);
    expect(board.rankings[3].rank).toBe(4);
  });
});

describe("Bloque 1: Espías, tope de 100 territorios y saneamiento", () => {
  test("excluye espías de entrenamiento normal/ataques y aplica tope de Cuartel incluyendo activos, en misión y en cola", async () => {
    const t = createTestBackend();
    const attacker = await foundKingdom(t, "user-spy-a", "Reino Espía");
    const defender = await foundKingdom(t, "user-spy-b", "Reino Blanco");

    await setBuildingLevel(t, attacker.kingdomId, "cuartel", 4); // Capacidad espías = floor(4/2) = 2
    await attacker.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: attacker.kingdomId });
    await defender.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: defender.kingdomId });

    const armyState = await attacker.asUser.query(api.army.getArmyState, { kingdomId: attacker.kingdomId });
    expect(armyState.unitCatalog.some((u: any) => u.unitType === "espia")).toBe(false);
    expect(armyState.spies.capacity).toBe(2);

    await expect(
      attacker.asUser.mutation(api.army.startTraining, { kingdomId: attacker.kingdomId, unitType: "espia", count: 1 })
    ).rejects.toThrow(/espías no se reclutan/i);

    await expect(
      attacker.asUser.mutation(api.military.trainUnits, { kingdomId: attacker.kingdomId, unitType: "espia", count: 1, level: 1 })
    ).rejects.toThrow(/espías no se reclutan/i);

    // 1 espía en misión (explorationQueue) + 1 reclutado por recruitSpy -> alcanza límite de 2
    await t.run(async (ctx) => {
      await ctx.db.insert("explorationQueue", {
        kingdomId: attacker.kingdomId,
        cellId: "1,1",
        targetQ: 1,
        targetR: 1,
        distance: 2,
        startedAt: T0,
        durationMs: 600_000,
        completesAt: T0 + 600_000,
        scoutsCount: 1,
        costs: { gold: 30, food: 40 },
        isSpyMission: true,
      });
    });

    const recruited = await attacker.asUser.mutation(api.army.recruitSpy, { kingdomId: attacker.kingdomId, count: 1 });
    expect(recruited.success).toBe(true);

    // 2do espía en cola supera capacidad = 2 (1 ocupado + 1 en cola)
    await expect(
      attacker.asUser.mutation(api.army.recruitSpy, { kingdomId: attacker.kingdomId, count: 1 })
    ).rejects.toThrow(/Capacidad de espías excedida/i);

    // También prohíbe enviar espías en launchAttack
    const defT = await defender.asUser.query(api.territories.getKingdomTerritories, { kingdomId: defender.kingdomId });
    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: attacker.kingdomId, unitType: "espia", level: 1, count: 1, isSpy: true });
      await ctx.db.insert("exploredTerritories", { kingdomId: attacker.kingdomId, cellId: defT.homeTerritoryId!, discoveredAt: T0 });
      await ctx.db.insert("challenges", {
        challengerKingdomId: attacker.kingdomId,
        targetKingdomId: defender.kingdomId,
        challengeType: "batalla",
        status: "ACCEPTED",
        createdAt: T0 - 90_000_000,
        expiresAt: T0 + 86_400_000,
        respondedAt: T0 - 86_400_000,
        window: "proxima",
        freezeAt: T0 - 900_000,
        scheduledAt: T0,
      });
    });

    await expect(
      attacker.asUser.mutation(api.army.launchAttack, {
        kingdomId: attacker.kingdomId,
        cellId: defT.homeTerritoryId!,
        units: [{ unitType: "espia", level: 1, count: 1 }],
      })
    ).rejects.toThrow(/espías no participan en marchas de ataque/i);
  });

  test("respeta el tope estricto de 100 territorios en claimFreeTerritory, launchAttack y resolveMarch (neutral y enemigo)", async () => {
    const t = createTestBackend();
    const attacker = await foundKingdom(t, "user-cap-atk", "Imperio Cien");
    const defender = await foundKingdom(t, "user-cap-def", "Reino Blanco");

    await attacker.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: attacker.kingdomId });
    await defender.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: defender.kingdomId });

    const defT = await defender.asUser.query(api.territories.getKingdomTerritories, { kingdomId: defender.kingdomId });
    const defHomeCellId = defT.homeTerritoryId!;
    const world = generateWorldCells(50, 20261017);

    // Completar hasta 100 territorios (capital "0,0" + 99 más) dejando un vecino neutral cercano sin dueño
    // y una celda secundaria enemiga (no capital, P48) para probar el tope de 100 en conquista PvP.
    let adjacentFreeCellId = "";
    let enemyCellId = "";
    await t.run(async (ctx) => {
      const existingOwned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", attacker.kingdomId))
        .collect();
      const occupied = new Set<string>([defHomeCellId, ...existingOwned.map((c) => c.cellId)]);
      let needed = TERRITORIES.MAX_PER_KINGDOM - existingOwned.length;
      for (const cell of world) {
        if (occupied.has(cell.cellId)) continue;
        if (cell.q === 1 && cell.r === 0) {
          adjacentFreeCellId = cell.cellId;
          continue; // Reservar "1,0" como neutral adyacente a "0,0"
        }
        if (needed > 0) {
          await ctx.db.insert("territories", {
            cellId: cell.cellId,
            q: cell.q,
            r: cell.r,
            terrain: cell.terrain,
            ownerKingdomId: attacker.kingdomId,
            isHome: false,
            claimedAt: T0,
          });
          occupied.add(cell.cellId);
          needed--;
        } else if (!enemyCellId) {
          enemyCellId = cell.cellId;
          await ctx.db.insert("territories", {
            cellId: cell.cellId,
            q: cell.q,
            r: cell.r,
            terrain: cell.terrain,
            ownerKingdomId: defender.kingdomId,
            isHome: false,
            claimedAt: T0,
          });
          occupied.add(cell.cellId);
        }
      }
      await ctx.db.patch(attacker.kingdomId, { pendingTerritoryClaims: 2 });
      await ctx.db.insert("armyUnits", { kingdomId: attacker.kingdomId, unitType: "infanteria", level: 1, count: 1000 });
      await ctx.db.insert("armyUnits", { kingdomId: defender.kingdomId, unitType: "infanteria", level: 1, count: 10 });
      await ctx.db.insert("exploredTerritories", { kingdomId: attacker.kingdomId, cellId: adjacentFreeCellId, discoveredAt: T0 });
      await ctx.db.insert("exploredTerritories", { kingdomId: attacker.kingdomId, cellId: enemyCellId, discoveredAt: T0 });
      await ctx.db.insert("challenges", {
        challengerKingdomId: attacker.kingdomId,
        targetKingdomId: defender.kingdomId,
        challengeType: "batalla",
        status: "ACCEPTED",
        createdAt: T0 - 90_000_000,
        expiresAt: T0 + 86_400_000,
        respondedAt: T0 - 86_400_000,
        window: "proxima",
        freezeAt: T0 - 900_000,
        scheduledAt: T0,
      });
    });

    // 1. claimFreeTerritory bloqueado en 100
    await expect(
      attacker.asUser.mutation(api.territories.claimFreeTerritory, { kingdomId: attacker.kingdomId, cellId: adjacentFreeCellId })
    ).rejects.toThrow(/límite máximo de 100 territorios/i);

    // 2. launchAttack hacia celda neutral bloqueado en 100
    await expect(
      attacker.asUser.mutation(api.army.launchAttack, {
        kingdomId: attacker.kingdomId,
        cellId: adjacentFreeCellId,
        units: [{ unitType: "infanteria", level: 1, count: 100 }],
      })
    ).rejects.toThrow(/límite máximo de 100 territorios/i);

    // 3. Marcha directa sobre neutral llegada con 100 territorios: no anexiona y devuelve tropas
    const neutralMarchId = await t.run(async (ctx) => {
      const mId = await ctx.db.insert("armyMarches", {
        kingdomId: attacker.kingdomId,
        targetCellId: adjacentFreeCellId,
        targetQ: 1,
        targetR: 0,
        distance: 1,
        terrainMultiplier: 1,
        units: [{ unitType: "infanteria", level: 1, count: 50 }],
        startedAt: T0,
        durationMs: 900_000,
        completesAt: T0 + 900_000,
        status: "marchando",
        isConquest: true,
      });
      return mId;
    });
    const neutralRes: any = await t.mutation(internal.army.completeMarchScheduled, { marchId: neutralMarchId });
    expect(neutralRes.outcome).toBe("limite_territorios_alcanzado");
    expect(neutralRes.territoryCapBlocked).toBe(true);

    // 4. Ataque contra enemigo con victoria aplastante cuando ya tiene 100 territorios: gana batalla pero no anexiona la celda #101
    const enemyAttack = await attacker.asUser.mutation(api.army.launchAttack, {
      kingdomId: attacker.kingdomId,
      cellId: enemyCellId,
      units: [{ unitType: "infanteria", level: 1, count: 500 }],
    });
    vi.setSystemTime(T0 + enemyAttack.durationSeconds * 1000 + 2000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const marchDoc = await t.run(async (ctx) => await ctx.db.get(enemyAttack.marchId));
    expect((marchDoc?.battleResult as any)?.outcome).toBe("victoria");
    expect((marchDoc?.battleResult as any)?.territoryCapBlocked).toBe(true);

    const finalOwned = await attacker.asUser.query(api.territories.getKingdomTerritories, { kingdomId: attacker.kingdomId });
    expect(finalOwned.territories).toHaveLength(100);
  });

  test("cleanupExcessTerritories sanea excesos >100 conservando capital + 99 cercanos, protege Iberia y es idempotente", async () => {
    const t = createTestBackend();
    const demoKingdomId = await t.run(async (ctx) => {
      const dId = await ctx.db.insert("kingdoms", {
        userId: DEMO_USER_ID,
        name: "Reino de Iberia",
        civilization: "ingleses",
        homeTerritoryId: "0,0",
      });
      await ctx.db.insert("territories", { cellId: "0,0", q: 0, r: 0, terrain: "llanura", ownerKingdomId: dId, isHome: true });
      return dId;
    });

    const { asUser, kingdomId } = await foundKingdom(t, "user-clean", "Reino Extenso");

    await t.run(async (ctx) => {
      const existingOwned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdomId))
        .collect();
      for (const doc of existingOwned) {
        await ctx.db.delete(doc._id);
      }

      const world = generateWorldCells(50, 20261017);
      // Insertar exactamente 108 territorios para user-clean (capital "10,0" + 107)
      await ctx.db.patch(kingdomId, { homeTerritoryId: "10,0" });
      await ctx.db.insert("territories", { cellId: "10,0", q: 10, r: 0, terrain: "llanura", ownerKingdomId: kingdomId, isHome: true, claimedAt: 1 });
      let added = 1;
      for (const cell of world) {
        if (cell.cellId === "0,0" || cell.cellId === "10,0") continue;
        if (added >= 108) break;
        await ctx.db.insert("territories", {
          cellId: cell.cellId,
          q: cell.q,
          r: cell.r,
          terrain: cell.terrain,
          ownerKingdomId: kingdomId,
          isHome: false,
          claimedAt: 10 + added,
        });
        added++;
      }
    });

    const prevAdminEnv = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = "admin-integration-cap";
    const asAdmin = t.withIdentity(identity("admin-integration-cap"));
    try {
      const dry = await asAdmin.mutation(internal.territories.cleanupExcessTerritories, { dryRun: true });
      expect(dry.dryRun).toBe(true);
      expect(dry.territoriesReleased).toBe(8);

      const real1 = await asAdmin.mutation(internal.territories.cleanupExcessTerritories, { dryRun: false });
      expect(real1.success).toBe(true);
      expect(real1.territoriesReleased).toBe(8);
      expect(real1.referentialIntegrity.intact).toBe(true);
      expect(real1.details.find((d) => d.kingdomId === String(demoKingdomId))?.skippedDemo).toBe(true);

      const ownedAfter = await asUser.query(api.territories.getKingdomTerritories, { kingdomId });
      expect(ownedAfter.territories).toHaveLength(100);
      expect(ownedAfter.homeTerritoryId).toBe("10,0");
      expect(ownedAfter.territories.some((c) => c.cellId === "10,0" && c.isHome)).toBe(true);

      // Segunda ejecución estrictamente idempotente
      const real2 = await asAdmin.mutation(internal.territories.cleanupExcessTerritories, { dryRun: false });
      expect(real2.territoriesReleased).toBe(0);
      expect(real2.kingdomsModified).toBe(0);
    } finally {
      if (prevAdminEnv === undefined) {
        delete process.env.ADMIN_USER_IDS;
      } else {
        process.env.ADMIN_USER_IDS = prevAdminEnv;
      }
    }
  });
});

describe("Bloque 2: Mapa compacto y zonas geográficas de aparición", () => {
  test("getWorldMapCompact devuelve celdas visibles sin fugar niebla privada ajena ni explorar de forma neutral", async () => {
    const t = createTestBackend();
    const userA = await foundKingdom(t, "user-compact-a", "Reino Compacto A");
    const userB = await foundKingdom(t, "user-compact-b", "Reino Compacto B");

    const compactA = await userA.asUser.query(api.territories.getWorldMapCompact, { kingdomId: userA.kingdomId });
    expect(compactA.radius).toBe(50);
    expect(compactA.totalCells).toBe(7651);
    expect(compactA.exploredCount).toBe(7);
    expect(compactA.visibleCells.length).toBeGreaterThanOrEqual(7);
    expect(compactA.visibleCells.length).toBeLessThan(100);

    await expect(
      userA.asUser.query(api.territories.getWorldMapCompact, { kingdomId: userB.kingdomId })
    ).rejects.toThrow(/No autorizado/);

    const neutralCompact = await t.query(api.territories.getWorldMapCompact, {});
    expect(neutralCompact.totalCells).toBe(7651);
    expect(neutralCompact.pendingClaims).toBe(0);
    expect(neutralCompact.activeExpeditions).toHaveLength(0);
    expect(neutralCompact.visibleCells).toHaveLength(0);
    expect(neutralCompact.kingdomLegend).toHaveLength(0);
  });

  test("los reinos posteriores aparecen agrupados por civilización manteniendo separación [20, 30] hex", async () => {
    const t = createTestBackend();
    const first = await t.withIdentity(identity("user-zone-1")).mutation(api.economy.getOrInitializeKingdom, {
      name: "Centro Inicial",
      civilization: "romanos",
    });
    const second = await t.withIdentity(identity("user-zone-2")).mutation(api.economy.getOrInitializeKingdom, {
      name: "Legio II",
      civilization: "romanos",
    });
    const third = await t.withIdentity(identity("user-zone-3")).mutation(api.economy.getOrInitializeKingdom, {
      name: "Jarl Vikingo",
      civilization: "vikingos",
    });

    const t1 = await t.withIdentity(identity("user-zone-1")).query(api.territories.getKingdomTerritories, { kingdomId: first._id as any });
    const t2 = await t.withIdentity(identity("user-zone-2")).query(api.territories.getKingdomTerritories, { kingdomId: second._id as any });
    const t3 = await t.withIdentity(identity("user-zone-3")).query(api.territories.getKingdomTerritories, { kingdomId: third._id as any });

    const expectedRomanAnchor = `${CIVILIZATION_ZONES.romanos.q},${CIVILIZATION_ZONES.romanos.r}`;
    expect(t1.homeTerritoryId).toBe(expectedRomanAnchor);
    const c1 = t1.territories.find((c) => c.isHome)!;
    const c2 = t2.territories.find((c) => c.isHome)!;
    const c3 = t3.territories.find((c) => c.isHome)!;
    const dist12 = hexDistance({ q: c1.q, r: c1.r }, { q: c2.q, r: c2.r });
    expect(dist12).toBeGreaterThanOrEqual(20);
    expect(dist12).toBeLessThanOrEqual(30);
    expect(hexDistance(c3, CIVILIZATION_ZONES.vikingos)).toBeLessThan(hexDistance(c3, CIVILIZATION_ZONES.romanos));
  });
});

describe("Bloque 3: Edificios hasta nivel 200 y compensación por caída", () => {
  test("permite ampliar edificios por encima de 100 hasta el nivel 200 y bloquea superar 200", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-lvl-200", "Reino Constructores");

    await setBuildingLevel(t, kingdomId, "castillo", 200);
    await setBuildingLevel(t, kingdomId, "viviendas", 150);

    await t.run(async (ctx) => {
      const res = await ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
      if (res) {
        await ctx.db.patch(res._id, { gold: 1e14, wood: 1e14, stone: 1e14, iron: 1e14, food: 1e14 });
      }
    });

    const upgrade151 = await asUser.mutation(api.kingdoms.startConstruction, {
      kingdomId,
      buildingType: "viviendas",
    });
    expect(upgrade151.success).toBe(true);
    expect(upgrade151.targetLevel).toBe(151);

    await expect(
      asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "castillo" })
    ).rejects.toThrow(/nivel máximo.*200/i);
  });

  test("compensación +30.000 por cuenta: excede almacén, es idempotente, soporta pre-fundación y no se duplica tras resetKingdom", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "user-comp-1", "Reino Compensado");

    const statusBefore = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(statusBefore.eligible).toBe(true);
    expect(statusBefore.status).toBe("unclaimed");

    const claim1 = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claim1.success).toBe(true);
    expect(claim1.alreadyClaimed).toBe(false);
    expect(claim1.status).toBe("claimed");
    expect(claim1.appliedImmediately).toBe(true);

    const fullAfter = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-comp-1" });
    // Tope de almacén base sin mercado = 10.000; la compensación (+30.000) debe excederlo intacta
    expect(fullAfter!.resources.gold).toBeGreaterThanOrEqual(30_000);
    expect(fullAfter!.resources.wood).toBeGreaterThanOrEqual(30_000);
    expect(fullAfter!.resources.stone).toBeGreaterThanOrEqual(30_000);
    expect(fullAfter!.resources.iron).toBeGreaterThanOrEqual(30_000);
    expect(fullAfter!.resources.food).toBeGreaterThanOrEqual(30_000);

    // Llamadas concurrentes / repetidas no duplican
    const [dupA, dupB] = await Promise.all([
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId }),
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId }),
    ]);
    expect(dupA.alreadyClaimed).toBe(true);
    expect(dupB.alreadyClaimed).toBe(true);

    // Tras reiniciar reino y volver a fundar, NO se vuelve a conceder
    await asUser.mutation(api.economy.resetKingdom, { kingdomId });
    await asUser.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino Refundado",
      civilization: "griegos",
    });
    const afterRefound = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-comp-1" });
    expect(afterRefound!.resources.gold).toBeLessThan(10_000);
    const statusAfterRefound = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(statusAfterRefound.status).toBe("claimed");
    expect(statusAfterRefound.eligible).toBe(false);

    // Pre-fundación: usuario reclama antes de fundar -> estado "pending" -> auto-aplicado al fundar
    const preUser = t.withIdentity(identity("user-comp-pre"));
    const pendingRes = await preUser.mutation(api.compensation.claimOutageCompensation, {});
    expect(pendingRes.status).toBe("pending");
    expect(pendingRes.appliedImmediately).toBe(false);

    await preUser.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino Nuevo",
      civilization: "arabes",
    });
    const foundedAfterPending = await preUser.query(api.kingdoms.getKingdomFull, { userId: "user-comp-pre" });
    expect(foundedAfterPending!.resources.gold).toBeGreaterThanOrEqual(30_000);
    expect(foundedAfterPending!.resources.food).toBeGreaterThanOrEqual(30_000);
    const preStatusFinal = await preUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(preStatusFinal.status).toBe("claimed");

    // Iberia está excluido
    const demoCaller = t.withIdentity(identity(DEMO_USER_ID));
    const demoStatus = await demoCaller.query(api.compensation.getOutageCompensationStatus, {});
    expect(demoStatus.status).toBe("excluded");
    expect(demoStatus.eligible).toBe(false);
    await expect(
      demoCaller.mutation(api.compensation.claimOutageCompensation, {})
    ).rejects.toThrow(/excluido/i);
  });
});




