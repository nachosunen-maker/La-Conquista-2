import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DEMO_USER_ID } from "./kingdomAccess";
import { EXPLORATION, MAP, MERCENARIES, MILITARY_LEVELS, RESEARCH, RESEARCH_SLOTS_BY_UNIVERSITY, UNITS } from "./balanceConfig";
import { applyFormation, emptyComposition, simulateBattle, type BattleSide } from "./battleRules";
import { getMercenaryType, isSpyUnitDoc, summarizeArmy } from "./armyRules";
import { classifyArmyUnits } from "./economyAdapter";
import { SECONDS_PER_GAME_YEAR } from "./economyCalculations";

const modules = import.meta.glob("./**/*.ts");
const T0 = Date.UTC(2026, 9, 17, 12, 0, 0);

function createTestBackend() {
  return convexTest(schema, modules);
}

function identity(subject: string) {
  return {
    subject,
    tokenIdentifier: `https://accounts.google.com|${subject}`,
    issuer: "https://accounts.google.com",
  };
}

async function foundKingdom(
  t: ReturnType<typeof createTestBackend>,
  subject: string,
  name: string,
  civilization = "romanos"
) {
  const asUser = t.withIdentity(identity(subject));
  const kingdom = await asUser.mutation(api.economy.getOrInitializeKingdom, {
    name,
    civilization,
    castleName: `Castillo de ${name}`,
    monarchName: `Monarca de ${name}`,
  });
  return { asUser, kingdomId: kingdom._id as Id<"kingdoms"> };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Paquete A: Seguridad y control de acceso", () => {
  test("getMarketInfo exige autenticación/propiedad y permite lectura solo al propietario o reino demo", async () => {
    const t = createTestBackend();
    const owner = await foundKingdom(t, "user-mkt-owner", "Reino Mercader");
    const intruder = await foundKingdom(t, "user-mkt-intruder", "Reino Espía");

    // Anónimo rechazado
    await expect(
      t.query(api.market.getMarketInfo, { kingdomId: owner.kingdomId })
    ).rejects.toThrow(/No autorizado/i);

    // Otro usuario autenticado rechazado
    await expect(
      intruder.asUser.query(api.market.getMarketInfo, { kingdomId: owner.kingdomId })
    ).rejects.toThrow(/No autorizado/i);

    // Propietario autorizado
    const ownMarket = await owner.asUser.query(api.market.getMarketInfo, { kingdomId: owner.kingdomId });
    expect(ownMarket).not.toBeNull();
    expect(ownMarket!.requiredLevel).toBeGreaterThan(0);

    // Reino demo permitido en solo lectura
    const demoKingdomId = await t.run(async (ctx) => {
      const kId = await ctx.db.insert("kingdoms", {
        userId: DEMO_USER_ID,
        name: "Reino de Iberia",
        civilization: "romanos",
      });
      await ctx.db.insert("resources", {
        kingdomId: kId,
        gold: 1000,
        wood: 1000,
        stone: 1000,
        iron: 1000,
        food: 1000,
        lastUpdated: T0,
        settlementInitialized: true,
      });
      return kId;
    });

    const demoMarket = await t.query(api.market.getMarketInfo, { kingdomId: demoKingdomId });
    expect(demoMarket).not.toBeNull();
  });

  test("cleanupExcessTerritories usa dryRun=true por defecto y evalúa referentialIntegrity.intact", async () => {
    const t = createTestBackend();
    const k = await foundKingdom(t, "user-clean-dry", "Reino DryRun");
    await k.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: k.kingdomId });

    // Llamada sin sesión administrativa debe rechazarse
    await expect(
      t.mutation(internal.territories.cleanupExcessTerritories, {})
    ).rejects.toThrow(/No autorizado/i);

    const prevAdmins = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = "admin-compliance-dry";
    try {
      const asAdmin = t.withIdentity({ subject: "admin-compliance-dry" });
      // Llamada sin dryRun debe operar en modo simulación (no modificar BD)
      const dryRes: any = await asAdmin.mutation(internal.territories.cleanupExcessTerritories, {});
      expect(dryRes.dryRun).toBe(true);
      expect(dryRes.referentialIntegrity.intact).toBe(true);
      expect(dryRes.referentialIntegrity.orphanedHomes).toBe(0);
      expect(dryRes.referentialIntegrity.kingdomsOverCapAfter).toBe(0);
    } finally {
      if (prevAdmins === undefined) delete process.env.ADMIN_USER_IDS;
      else process.env.ADMIN_USER_IDS = prevAdmins;
    }
  });
});

describe("Paquete B: Motor de combate, progresión, hospital y reglas P23/P25/P29/P38/P45/P48/P54", () => {
  test("defensivePower aplica training^E.training (nivel 5 defiende más que nivel 1)", () => {
    const comp = emptyComposition();
    comp.infanteria = 200;

    const baseSide: Omit<BattleSide, "kingdomId" | "name" | "trainingMultiplier"> = {
      composition: comp,
      weaponTier: "espadaHierro",
      armorTier: "cueroReforzado",
      strategy: "defensiva",
      tacticalFormation: "equilibrada",
      morale: 80,
      foodTier: "normal",
      fatigue: 0,
      wallsLevel: 0,
      terrainDefenseBonus: 0,
    };

    const vsLevel1 = simulateBattle(
      { ...baseSide, kingdomId: "A", name: "Atacante", trainingMultiplier: 1.35, strategy: "agresiva" },
      { ...baseSide, kingdomId: "D1", name: "Defensor N1", trainingMultiplier: 1.0 }
    );
    const vsLevel5 = simulateBattle(
      { ...baseSide, kingdomId: "A", name: "Atacante", trainingMultiplier: 1.35, strategy: "agresiva" },
      { ...baseSide, kingdomId: "D5", name: "Defensor N5", trainingMultiplier: 1.9 }
    );

    expect(vsLevel5.defender.factors.defensivePower).toBeGreaterThan(vsLevel1.defender.factors.defensivePower);
  });

  test("P23, P29 y M-03: MILITARY_LEVELS y RESEARCH_SLOTS_BY_UNIVERSITY restaurados a especificación oficial", () => {
    expect(MILITARY_LEVELS.map((l) => l.multiplier)).toEqual([1.0, 1.15, 1.35, 1.6, 1.9]);
    expect(MILITARY_LEVELS[1].requirements).toEqual({ castillo: 2, cuartel: 2 });
    expect(MILITARY_LEVELS[2].requirements).toEqual({ castillo: 4, cuartel: 3, universidad: 2 });
    expect(MILITARY_LEVELS[3].requirements).toEqual({ castillo: 6, cuartel: 4, universidad: 3 });
    expect(MILITARY_LEVELS[4].requirements).toEqual({ castillo: 8, cuartel: 5, universidad: 4, herreria: 5 });

    expect(RESEARCH.MAX_SLOTS).toBe(3);
    expect(RESEARCH_SLOTS_BY_UNIVERSITY).toEqual([
      { minLevel: 1, slots: 1 },
      { minLevel: 3, slots: 2 },
      { minLevel: 5, slots: 3 },
    ]);
  });

  test("summarizeArmy contabiliza todo el asedio especializado sin duplicación y excluye espías", () => {
    const summary = summarizeArmy([
      { unitType: "infanteria", level: 2, count: 50, wounded: 5 },
      { unitType: "onagro_campana", level: 1, count: 3, wounded: 1 },
      { unitType: "ariete_movil", level: 1, count: 2, wounded: 0 },
      { unitType: "torres_asalto", level: 1, count: 1, wounded: 0 },
      { unitType: "espia", level: 1, count: 4 },
    ]);

    const expectedOperators =
      3 * UNITS.onagro_campana.populationPerUnit +
      2 * UNITS.ariete_movil.populationPerUnit +
      1 * UNITS.torres_asalto.populationPerUnit;

    expect(summary.livingSoldiers).toBe(50 + expectedOperators);
    expect(summary.siegeMachines).toBe(6); // 3 + 2 + 1
    expect(summary.siegeOperators).toBe(expectedOperators);
    expect(summary.totalActive).toBe(56); // 50 + 6 (los 4 espías no suman a totalActive)
    expect(summary.totalWounded).toBe(6); // 5 + 1
    expect(summary.byType.espia.active).toBe(4); // visible en desglose, excluido de combate/raciones
  });

  test("P38, P48 y P54: launchAttack exige Parlamento en PvP, protege capital y descuenta muertos del atacante", async () => {
    const t = createTestBackend();
    const attacker = await foundKingdom(t, "user-p38-atk", "Reino P38 Atacante");
    const defender = await foundKingdom(t, "user-p38-def", "Reino P38 Defensor");

    await attacker.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: attacker.kingdomId });
    await defender.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: defender.kingdomId });

    const defT = await defender.asUser.query(api.territories.getKingdomTerritories, { kingdomId: defender.kingdomId });
    const defCapitalId = defT.homeTerritoryId!;

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: attacker.kingdomId, unitType: "infanteria", level: 1, count: 400 });
      await ctx.db.insert("armyUnits", { kingdomId: defender.kingdomId, unitType: "infanteria", level: 1, count: 120 });
      await ctx.db.insert("exploredTerritories", { kingdomId: attacker.kingdomId, cellId: defCapitalId, discoveredAt: T0 });
      const pop = await ctx.db.query("population").filter((q) => q.eq(q.field("kingdomId"), attacker.kingdomId)).first();
      if (pop) await ctx.db.patch(pop._id, { total: 5000 });
    });

    // 1. Sin desafío aceptado/congelado en Parlamento, PvP debe ser rechazado (P38)
    await expect(
      attacker.asUser.mutation(api.army.launchAttack, {
        kingdomId: attacker.kingdomId,
        cellId: defCapitalId,
        units: [{ unitType: "infanteria", level: 1, count: 300 }],
      })
    ).rejects.toThrow(/Procedimiento de Parlamento requerido \(P38\)/i);

    // 2. Con desafío ACCEPTED y programación temporal P38 válida ya alcanzada, el ataque se permite
    await t.run(async (ctx) => {
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

    const popBefore = await t.run(async (ctx) => {
      const p = await ctx.db.query("population").filter((q) => q.eq(q.field("kingdomId"), attacker.kingdomId)).first();
      return p?.total ?? 0;
    });

    const march = await attacker.asUser.mutation(api.army.launchAttack, {
      kingdomId: attacker.kingdomId,
      cellId: defCapitalId,
      units: [{ unitType: "infanteria", level: 1, count: 300 }],
    });
    expect(march.success).toBe(true);

    vi.setSystemTime(T0 + march.durationSeconds * 1000 + 2000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // 3. Capital enemiga protegida (P48): sigue perteneciendo al defensor y sigue siendo isHome=true
    const [capitalDoc, marchDoc, popAfter] = await t.run(async (ctx) => {
      const cap = await ctx.db.query("territories").withIndex("by_cell", (q) => q.eq("cellId", defCapitalId)).first();
      const m = await ctx.db.get(march.marchId);
      const p = await ctx.db.query("population").filter((q) => q.eq(q.field("kingdomId"), attacker.kingdomId)).first();
      return [cap, m, p?.total ?? 0] as const;
    });

    expect((marchDoc?.battleResult as any)?.outcome).toBe("victoria");
    expect((marchDoc?.battleResult as any)?.capitalProtected).toBe(true);
    expect(String(capitalDoc?.ownerKingdomId)).toBe(String(defender.kingdomId));
    expect(capitalDoc?.isHome).toBe(true);

    // 4. Muertos del atacante descontados del censo (P54)
    const battleDoc = await t.run(async (ctx) => {
      const bId = (marchDoc?.battleResult as any)?.battleId;
      return bId ? await ctx.db.get(bId) : null;
    });
    const atkCasualties = (battleDoc as any)?.report?.attacker?.casualties ?? 0;
    const atkWounded = (battleDoc as any)?.report?.attacker?.wounded ?? 0;
    const atkDead = Math.max(0, atkCasualties - atkWounded);
    expect(atkDead).toBeGreaterThan(0);
    expect(popAfter).toBe(popBefore - atkDead);
  });

  test("P45 Hospital en economy.ts: aplica capacidad (nivel × 100) y triaje de campaña al 5 % en exceso y nivel 0", async () => {
    const t = createTestBackend();
    const k0 = await foundKingdom(t, "user-hosp-0", "Reino Sin Hospital");
    const k1 = await foundKingdom(t, "user-hosp-1", "Reino Con Hospital");

    // Inicializar liquidación
    await k0.asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId: k0.kingdomId });
    await k1.asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId: k1.kingdomId });

    // En k0: sin hospital (nivel 0), 200 heridos -> recuperación 5 %/año (10 en 1 año)
    // En k1: hospital nivel 1 (100 camas al 15 % + 100 exceso al 5 % = media 10 %/año -> 20 en 1 año)
    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: k0.kingdomId, unitType: "infanteria", level: 1, count: 0, wounded: 200 });
      await ctx.db.insert("armyUnits", { kingdomId: k1.kingdomId, unitType: "infanteria", level: 1, count: 0, wounded: 200 });
      await ctx.db.insert("buildings", { kingdomId: k1.kingdomId, buildingType: "hospitalMilitar", level: 1 });
    });

    vi.setSystemTime(T0 + SECONDS_PER_GAME_YEAR * 1000);
    await k0.asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId: k0.kingdomId });
    await k1.asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId: k1.kingdomId });

    const [u0, u1] = await t.run(async (ctx) => {
      const a0 = await ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", k0.kingdomId)).first();
      const a1 = await ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", k1.kingdomId)).first();
      return [a0, a1] as const;
    });

    // Con nivel 0: 5 % de 200 = 10 recuperados
    expect(u0?.count).toBe(10);
    expect(u0?.wounded).toBe(190);
    // Con nivel 1 y 200 heridos (100 en camas al 15 % + 100 en exceso al 5 % = 20 recuperados, NO 30)
    expect(u1?.count).toBe(20);
    expect(u1?.wounded).toBe(180);
  });
});

describe("Paquete C: Aislamiento transversal de espías y mercenarios", () => {
  test("espías aislados de raciones, formación, mejora global de ejército y conteo unificado", async () => {
    expect(isSpyUnitDoc({ unitType: "espia" })).toBe(true);
    expect(isSpyUnitDoc({ unitType: "infanteria", isSpy: true })).toBe(true);
    expect(isSpyUnitDoc({ unitType: "infanteria" })).toBe(false);

    // Raciones/clasificación económica excluye espías
    const classified = classifyArmyUnits([
      { kingdomId: "k1", unitType: "infanteria", count: 20 },
      { kingdomId: "k1", unitType: "espia", count: 5 },
    ]);
    expect(classified.regularSoldiers).toBe(20);

    // applyFormation fuerza espia=0 incluso si se pasa explícitamente
    const baseComp = emptyComposition();
    baseComp.infanteria = 10;
    baseComp.espia = 5;
    const formed = applyFormation(baseComp, { infanteria: 1, espia: 1 });
    expect(formed.espia).toBe(0);
    expect(formed.infanteria).toBe(10);

    // getMercenaryType devuelve null con ID inválido
    expect(getMercenaryType("id_inexistente")).toBeNull();
    expect(getMercenaryType(undefined)?.id).toBe(MERCENARIES.DEFAULT_TYPE_ID);

    // upgradeArmyLevel y setFormation ignoran espías
    const t = createTestBackend();
    const k = await foundKingdom(t, "user-spy-iso", "Reino Espías");
    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: k.kingdomId, unitType: "infanteria", level: 1, count: 10 });
      await ctx.db.insert("armyUnits", { kingdomId: k.kingdomId, unitType: "espia", level: 1, count: 2, isSpy: true });
      // Requisitos P29 nivel 2: Castillo 2 + Cuartel 2
      const blds = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", k.kingdomId)).collect();
      const castillo = blds.find((b) => b.buildingType === "castillo");
      if (castillo) await ctx.db.patch(castillo._id, { level: 2 });
      const cuartel = blds.find((b) => b.buildingType === "cuartel");
      if (cuartel) await ctx.db.patch(cuartel._id, { level: 2 });
      else await ctx.db.insert("buildings", { kingdomId: k.kingdomId, buildingType: "cuartel", level: 2 });
      const res = await ctx.db.query("resources").filter((q) => q.eq(q.field("kingdomId"), k.kingdomId)).first();
      if (res) await ctx.db.patch(res._id, { gold: 50000, wood: 50000, stone: 50000, iron: 50000, food: 50000 });
    });

    const formRes = await k.asUser.mutation(api.army.setFormation, {
      kingdomId: k.kingdomId,
      formation: { infanteria: 0.8, espia: 1 },
    });
    expect((formRes.formation as any).espia).toBeUndefined();
    expect((formRes.formation as any).infanteria).toBe(0.8);

    const upgRes = await k.asUser.mutation(api.army.upgradeArmyLevel, { kingdomId: k.kingdomId, targetLevel: 2 });
    expect(upgRes.unitsUpgraded).toBe(1);

    const unitsAfter = await t.run(async (ctx) =>
      ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", k.kingdomId)).collect()
    );
    const spyDoc = unitsAfter.find((u) => isSpyUnitDoc(u));
    const infDoc = unitsAfter.find((u) => u.unitType === "infanteria");
    expect(spyDoc?.level).toBe(1);
    expect(infDoc?.level).toBe(2);
  });
});

describe("Paquete D y Transversal: Mapa, exploración unificada y tecnologías", () => {
  test("startSpyExploration aplica costes, límite MAX_CONCURRENT_EXPEDITIONS y bonificaciones igual que startExploration", async () => {
    const t = createTestBackend();
    const k = await foundKingdom(t, "user-exp-spy", "Reino Explorador");
    await k.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: k.kingdomId });
    await k.asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId: k.kingdomId });

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: k.kingdomId, unitType: "espia", level: 1, count: EXPLORATION.MAX_CONCURRENT_EXPEDITIONS + 2, isSpy: true });
      const res = await ctx.db.query("resources").filter((q) => q.eq(q.field("kingdomId"), k.kingdomId)).first();
      if (res) await ctx.db.patch(res._id, { gold: 5000, food: 5000 });
    });

    // Con capital en 0,0 y radio inicial 1, todas estas celdas a distancia 2 limitan con el anillo de radio 1 conocido
    const borderCells = ["2,0", "0,2", "-2,0", "0,-2", "2,-1", "-2,1"];
    const exp1: any = await k.asUser.mutation(api.territories.startSpyExploration, {
      kingdomId: k.kingdomId,
      cellId: borderCells[0],
      spiesCount: 1,
    });
    expect(exp1.success).toBe(true);
    expect(exp1.costs.gold).toBeGreaterThan(0);
    expect(exp1.costs.food).toBeGreaterThan(0);

    // Verificar que descontó recursos (no fue gratis)
    const resAfter = await t.run(async (ctx) =>
      ctx.db.query("resources").filter((q) => q.eq(q.field("kingdomId"), k.kingdomId)).first()
    );
    expect(resAfter!.gold).toBeLessThan(5000);
    expect(resAfter!.food).toBeLessThan(5000);

    // Completar la cola hasta EXPLORATION.MAX_CONCURRENT_EXPEDITIONS y comprobar que la siguiente se rechaza
    await t.run(async (ctx) => {
      for (let i = 1; i < EXPLORATION.MAX_CONCURRENT_EXPEDITIONS; i++) {
        await ctx.db.insert("explorationQueue", {
          kingdomId: k.kingdomId,
          cellId: `10,${i}`,
          targetQ: 10,
          targetR: i,
          distance: 10,
          startedAt: T0,
          durationMs: 3_600_000,
          completesAt: T0 + 3_600_000,
          scoutsCount: 1,
          costs: { gold: 30, food: 40 },
          isSpyMission: true,
        });
      }
    });
    await expect(
      k.asUser.mutation(api.territories.startSpyExploration, {
        kingdomId: k.kingdomId,
        cellId: "0,2",
        spiesCount: 1,
      })
    ).rejects.toThrow(/máximo de expediciones/i);
  });

  test("auditMapReductionDeep usa MAP.RADIUS unificado y getTechnologies aplica researchDuration", async () => {
    const t = createTestBackend();
    await t.run(async (ctx) => {
      // Celda dentro de MAP.RADIUS (30 <= 50) NO debe marcarse para borrar (antes se borraba con 25 hardcoded)
      await ctx.db.insert("territories", { cellId: "30,0", q: 30, r: 0, terrain: "llanura", isHome: false });
      // Celda fuera de MAP.RADIUS (51 > 50) SÍ debe marcarse para borrar
      await ctx.db.insert("territories", { cellId: `${MAP.RADIUS + 1},0`, q: MAP.RADIUS + 1, r: 0, terrain: "llanura", isHome: false });
    });
    const audit: any = await t.query(internal.auditMapReduction.auditMapReductionDeep, {});
    expect(audit.territoriesToDelete).toBe(1);

    const k = await foundKingdom(t, "user-tech-dur", "Reino Sabio", "griegos");
    const before = await k.asUser.query(api.technologies.getTechnologies, { kingdomId: k.kingdomId });
    const targetBefore = before.catalog.find((c: any) => c.id === "agri_2");

    const techWithResearchDur = before.catalog.find((c: any) => c.effect?.key === "researchDuration");
    expect(techWithResearchDur).toBeDefined();
    expect(targetBefore).toBeDefined();

    await t.run(async (ctx) => {
      await ctx.db.insert("technologyProgress", {
        kingdomId: k.kingdomId,
        technologyId: techWithResearchDur!.id,
        status: "completed",
        completedAt: T0,
      });
    });
    const after = await k.asUser.query(api.technologies.getTechnologies, { kingdomId: k.kingdomId });
    const targetAfter = after.catalog.find((c: any) => c.id === "agri_2");
    expect(targetAfter!.bonifiedDurationSeconds).toBeLessThan(targetBefore!.bonifiedDurationSeconds);
  });
});
