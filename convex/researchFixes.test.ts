import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  CIVILIZATIONS,
  LEGACY_CIVILIZATION_IDS,
  LEGACY_TECHNOLOGY_IDS,
  MISSIONS,
  PARLIAMENT,
  STORAGE,
  TECHNOLOGIES,
  TECH_EFFECT_CAPS,
  TIME,
} from "./balanceConfig";
import { costsForTargetLevel, BUILDING_RULES } from "./buildingRules";
import { getCivilizationPassive } from "./civilizationRules";
import { effectiveKingdomStorageCapacity } from "./economyExtended";
import {
  computeResearchDuration,
  computeTechnologyModifiers,
  filterVisibleTechnologiesForCivilization,
  getVisibleTechnologyForCivilization,
  normalizeTechnologyId,
} from "./technologyRules";
import { armyMarchMultiplier, marchFatigue, marchTimeSeconds } from "./territoryRules";
import { getAllActiveBots } from "./botConfig";
import { createBotBattleSide, estimateBotArmy } from "./botRules";
import { computeSideFactors, emptyComposition, type BattleSide } from "./battleRules";

const modules = import.meta.glob("./**/*.ts");
const T0 = Date.UTC(2026, 9, 25, 12, 0, 0);

function createTestBackend() {
  return convexTest(schema, modules);
}

function identity(subject: string) {
  return {
    subject,
    tokenIdentifier: `https://test.auth|${subject}`,
    issuer: "https://test.auth",
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

async function seedBuildings(
  t: ReturnType<typeof createTestBackend>,
  kingdomId: Id<"kingdoms">,
  levels: Record<string, number>
) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("buildings")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .collect();
    for (const [buildingType, level] of Object.entries(levels)) {
      const doc = existing.find((b) => b.buildingType === buildingType);
      if (level <= 0) {
        if (doc) await ctx.db.delete(doc._id);
      } else if (doc) {
        await ctx.db.patch(doc._id, { level });
      } else {
        await ctx.db.insert("buildings", { kingdomId, buildingType, level });
      }
    }
  });
}

async function seedCompletedTechs(
  t: ReturnType<typeof createTestBackend>,
  kingdomId: Id<"kingdoms">,
  techIds: string[]
) {
  await t.run(async (ctx) => {
    for (const technologyId of techIds) {
      await ctx.db.insert("technologyProgress", {
        kingdomId,
        technologyId,
        status: "completed",
        startedAt: T0 - 10_000,
        durationMs: 1_000,
        completedAt: T0 - 9_000,
      });
    }
  });
}

async function patchResources(
  t: ReturnType<typeof createTestBackend>,
  kingdomId: Id<"kingdoms">,
  patch: Partial<{ gold: number; wood: number; stone: number; iron: number; food: number; lastUpdated: number; settlementInitialized: boolean }>
) {
  await t.run(async (ctx) => {
    const res = await ctx.db
      .query("resources")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .first();
    if (res) await ctx.db.patch(res._id, patch);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// §2.1 MARCHAS REALES EN army:launchAttack
// ============================================================================
describe("§2.1 — Velocidad y duración real de marchas militares", () => {
  test("launchAttack aplica logistics_2, logistics_5, spy_2 y exclusivas de velocidad más pasiva cultural", async () => {
    const t = createTestBackend();
    const def = await foundKingdom(t, "u-march-def", "Defensor Llano", "ingleses");
    await seedBuildings(t, def.kingdomId, { castillo: 5, parlamento: 1 });
    const defHome = await def.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: def.kingdomId });
    expect(defHome.homeTerritoryId).toBeTruthy();
    const [defQStr, defRStr] = defHome.homeTerritoryId!.split(",");
    const defQ = Number(defQStr);
    const defR = Number(defRStr);
    const stepQ = defQ >= 0 ? -1 : 1;

    // Forzamos una ruta determinista sobre llanura (multiplicador 1.0) a distancia 4
    const startQ = defQ + stepQ * 4;
    const pathCells = [
      { q: startQ, r: defR, cellId: `${startQ},${defR}` },
      { q: defQ + stepQ * 3, r: defR, cellId: `${defQ + stepQ * 3},${defR}` },
      { q: defQ + stepQ * 2, r: defR, cellId: `${defQ + stepQ * 2},${defR}` },
      { q: defQ + stepQ * 1, r: defR, cellId: `${defQ + stepQ * 1},${defR}` },
      { q: defQ, r: defR, cellId: defHome.homeTerritoryId! },
    ];

    const runAttackDurationFor = async (
      subject: string,
      civilization: string,
      techIds: string[]
    ) => {
      const atk = await foundKingdom(t, subject, `Atacante ${subject}`, civilization);
      await seedBuildings(t, atk.kingdomId, { castillo: 5, parlamento: 1, cuartel: 5 });
      await seedCompletedTechs(t, atk.kingdomId, techIds);
      await t.run(async (ctx) => {
        for (const p of pathCells) {
          const existingCell = await ctx.db
            .query("territories")
            .withIndex("by_cell", (q) => q.eq("cellId", p.cellId))
            .first();
          if (existingCell) {
            await ctx.db.patch(existingCell._id, { terrain: "llanura" });
          } else {
            await ctx.db.insert("territories", {
              q: p.q,
              r: p.r,
              cellId: p.cellId,
              terrain: "llanura",
            });
          }
        }
        const homeCell = await ctx.db
          .query("territories")
          .withIndex("by_cell", (q) => q.eq("cellId", pathCells[0].cellId))
          .first();
        await ctx.db.patch(homeCell!._id, { ownerKingdomId: atk.kingdomId, isHome: true });
        await ctx.db.patch(atk.kingdomId, { homeTerritoryId: pathCells[0].cellId });
        await ctx.db.insert("exploredTerritories", {
          kingdomId: atk.kingdomId,
          cellId: defHome.homeTerritoryId!,
          discoveredAt: T0,
        });
        await ctx.db.insert("armyUnits", { kingdomId: atk.kingdomId, unitType: "infanteria", level: 1, count: 50 });
        await ctx.db.insert("challenges", {
          challengerKingdomId: atk.kingdomId,
          targetKingdomId: def.kingdomId,
          challengeType: "batalla",
          status: "ACCEPTED",
          window: "proxima",
          createdAt: T0 - 5_000,
          respondedAt: T0 - 4_000,
          expiresAt: T0 + 100_000,
          freezeAt: T0 - 2_000,
          scheduledAt: T0 - 1_000,
          distance: 4,
          messages: [],
        });
      });
      await atk.asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId: atk.kingdomId });
      const res = await atk.asUser.mutation(api.army.launchAttack, {
        kingdomId: atk.kingdomId,
        cellId: defHome.homeTerritoryId!,
        units: [{ unitType: "infanteria", level: 1, count: 20 }],
      });
      return res.durationSeconds;
    };

    const durBase = await runAttackDurationFor("atk-base", "romanos", []);
    const durLog2 = await runAttackDurationFor("atk-log2", "romanos", ["logistics_2"]);
    const durGeneralMax = await runAttackDurationFor("atk-genmax", "romanos", ["logistics_2", "logistics_5", "spy_2"]);
    const durMongolTech = await runAttackDurationFor("atk-mongol", "mongoles", [
      "logistics_2",
      "logistics_5",
      "spy_2",
      "tech_civ_mongoles",
      "tech_civ_mongoles_b",
    ]);
    const durNavajoTech = await runAttackDurationFor("atk-navajo", "navajos", ["tech_civ_navajos_c"]);

    // Cálculo manual independiente:
    // Base (d=4, ter=1.0, inf=1.0, civ=1.0, tech=0): 1800*4 = 7200 s
    expect(durBase).toBe(marchTimeSeconds(4, 1.0, 1.0, 1.0, 0));
    expect(durBase).toBe(7200);

    // logistics_2 (+7%): 7200 / 1.07 = 6728.9719 -> ceil 6729 s
    expect(durLog2).toBe(marchTimeSeconds(4, 1.0, 1.0, 1.0, 0.07));
    expect(durLog2).toBe(6729);

    // Genéricos máx (logistics_2 0.07 + logistics_5 0.08 + spy_2 0.05 = 0.20): 7200 / 1.20 = 6000 s
    expect(durGeneralMax).toBe(marchTimeSeconds(4, 1.0, 1.0, 1.0, 0.20));
    expect(durGeneralMax).toBe(6000);

    // Mongoles (+15% pasiva, +0.20 gen + 0.15 + 0.10 = +0.45 tech): 7200 / (1.15 * 1.45) = 7200 / 1.6675 = 4317.8 -> 4318 s
    const mongolCiv = getCivilizationPassive("mongoles").marchSpeedMultiplier;
    expect(mongolCiv).toBe(1.15);
    expect(durMongolTech).toBe(marchTimeSeconds(4, 1.0, 1.0, mongolCiv, 0.45));
    expect(durMongolTech).toBe(4318);

    // Navajos tech_civ_navajos_c (+12%): 7200 / 1.12 = 6428.5714 -> 6429 s
    expect(durNavajoTech).toBe(marchTimeSeconds(4, 1.0, 1.0, 1.0, 0.12));
    expect(durNavajoTech).toBe(6429);
  });
});

// ============================================================================
// §2.2 PARIDAD DE PROYECCIÓN Y LIQUIDACIÓN EN LOS 5 RECURSOS
// ============================================================================
describe("§2.2 — Consistencia exacta entre getKingdom, getSimulatedKingdomResources y settleKingdomEconomy", () => {
  test("getKingdom y getSimulatedKingdomResources aplican agri_1, agri_5, mining_*, trade_* y moraleBase igual que settleKingdomEconomy", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "u-econ-sync", "Reino Económico", "arabes");
    await seedBuildings(t, kingdomId, {
      castillo: 6,
      granja: 10,
      aserradero: 10,
      cantera: 10,
      minaHierro: 10,
      minaOro: 10,
      mercado: 4,
      viviendas: 5,
    });
    await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });

    // Asignar población en todos los oficios productivos
    await t.run(async (ctx) => {
      const jobs = await ctx.db
        .query("populationJobs")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .collect();
      for (const j of jobs) await ctx.db.delete(j._id);
      for (const jobType of ["agriculture", "wood", "stone", "iron", "gold"]) {
        await ctx.db.insert("populationJobs", { kingdomId, jobType, assignedCount: 100 });
      }
      const pop = await ctx.db.query("population").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
      if (pop) await ctx.db.patch(pop._id, { total: 2000, available: 1500 });
    });

    await seedCompletedTechs(t, kingdomId, [
      "agri_1", // +5 % agri
      "agri_5", // -4 % consumo comida
      "mining_1", // +5 % mineria
      "mining_4", // +10 % madera
      "mining_5", // +10 % piedra
      "mining_6", // +10 % hierro
      "mining_7", // +6 % oro
      "trade_1", // +15 % almacen
      "happiness_3", // +3 moral
    ]);

    // Liquidar en T0 para alinear punto de partida, luego avanzar medio año de juego
    await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    const halfDayMs = Math.round(0.5 * TIME.MS_PER_GAME_YEAR);
    vi.advanceTimersByTime(halfDayMs);
    const targetNow = Date.now();

    const projected = await asUser.query(api.economy.getKingdom, { kingdomId });
    const simulated = await asUser.query(api.economy.getSimulatedKingdomResources, {
      kingdomId: String(kingdomId),
      foodTier: "normal",
      targetTime: targetNow,
    });
    const settled = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });

    expect(projected).not.toBeNull();
    expect(simulated.success).toBe(true);
    expect(settled.success).toBe(true);

    // Paridad exacta en los 5 recursos entre getKingdom, getSimulatedKingdomResources y settleKingdomEconomy
    for (const r of ["gold", "wood", "stone", "iron", "food"] as const) {
      expect(projected!.simulatedResources[r]).toBeCloseTo(settled.resources[r], 6);
      expect(simulated.simulatedResources![r]).toBeCloseTo(settled.resources[r], 6);
    }

    // Paridad de moral y capacidad de almacén
    expect(projected!.militaryMorale).toBeCloseTo(settled.militaryMorale!, 6);
    expect(projected!.metrics.storageCapacity).toBe(settled.storageCapacity);
    expect(simulated.extended!.storageCapacity).toBe(settled.storageCapacity);
    expect(projected!.metrics.dailyProduction!.gold).toBeCloseTo(settled.dailyProduction!.gold, 6);
    expect(projected!.metrics.dailyProduction!.wood).toBeCloseTo(settled.dailyProduction!.wood, 6);
    expect(projected!.metrics.dailyProduction!.stone).toBeCloseTo(settled.dailyProduction!.stone, 6);
    expect(projected!.metrics.dailyProduction!.iron).toBeCloseTo(settled.dailyProduction!.iron, 6);
    expect(projected!.metrics.dailyProduction!.food).toBeCloseTo(settled.dailyProduction!.food, 6);
  });
});

// ============================================================================
// §2.3 COBRO DE RECOMPENSAS CON CAPACIDAD EFECTIVA DE ALMACÉN Y ATOMICIDAD
// ============================================================================
describe("§2.3 — claimMissionReward: capacidad base, tech, civilización, combinación, rechazo y concurrencia", () => {
  async function prepareMissionPending(
    t: ReturnType<typeof createTestBackend>,
    subject: string,
    civilization: string,
    marketLevel: number,
    techIds: string[],
    initialResources: Partial<{ gold: number; wood: number; stone: number; iron: number; food: number }>
  ) {
    const { asUser, kingdomId } = await foundKingdom(t, subject, `Reino ${subject}`, civilization);
    await seedBuildings(t, kingdomId, { castillo: 2, mercado: marketLevel });
    await seedCompletedTechs(t, kingdomId, techIds);
    await patchResources(t, kingdomId, initialResources);
    await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    await asUser.mutation(api.missions.finishMission, { kingdomId, progressId: "s1_castillo2" });
    // Re-alineamos exactamente recursos tras finalizar para probar bordes precisos de capacidad
    await patchResources(t, kingdomId, { ...initialResources, lastUpdated: Date.now() });
    return { asUser, kingdomId };
  }

  test("rechaza con base saturada, acepta con tecnología o civilización, aplica combinación y rechaza inventario parcial/lleno", async () => {
    const t = createTestBackend();

    // 1. Base (mercado 0 = 10.000): stone 9.900 + 200 = 10.100 > 10.000 -> rechaza
    const kBase = await prepareMissionPending(t, "m-base", "romanos", 0, [], { stone: 9_900, wood: 1_000 });
    await expect(
      kBase.asUser.mutation(api.missions.claimMissionReward, { kingdomId: kBase.kingdomId, progressId: "s1_castillo2" })
    ).rejects.toThrow(/NO HAY SITIO EN EL MERCADO/);

    // 2. Ampliada por tecnología (storage_1 +10% => 11.000): stone 10.500 + 200 = 10.700 <= 11.000 -> acepta
    const kTech = await prepareMissionPending(t, "m-tech", "romanos", 0, ["storage_1"], { stone: 10_500, wood: 1_000 });
    await kTech.asUser.mutation(api.missions.claimMissionReward, { kingdomId: kTech.kingdomId, progressId: "s1_castillo2" });
    const resTech = await t.run(async (ctx) => ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kTech.kingdomId)).first());
    expect(resTech!.stone).toBe(10_700);
    expect(resTech!.wood).toBe(1_150);

    // 3. Ampliada por civilización (Vikingos +10% => 11.000 en mercado 0): stone 10.800 + 200 = 11.000 -> acepta; 10.801 -> rechaza
    const kVik = await prepareMissionPending(t, "m-vik", "vikingos", 0, [], { stone: 10_800, wood: 1_000 });
    await kVik.asUser.mutation(api.missions.claimMissionReward, { kingdomId: kVik.kingdomId, progressId: "s1_castillo2" });
    const resVik = await t.run(async (ctx) => ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kVik.kingdomId)).first());
    expect(resVik!.stone).toBe(11_000);

    // 4. Combinación mercado nv1 (12.000) + todas techs de almacen (+55% = 1.55) + Vikingos (1.10) => floor(12000*1.55*1.10) = 20.460
    const allStorageTechs = ["storage_1", "storage_2", "storage_3", "agri_6", "trade_1"];
    const expectedCap = effectiveKingdomStorageCapacity({
      marketLevel: 1,
      technologyMultiplier: computeTechnologyModifiers(allStorageTechs).storageCapacity,
      civilization: "vikingos",
    });
    expect(expectedCap).toBe(20_460);
    const kCombo = await prepareMissionPending(t, "m-combo", "vikingos", 1, allStorageTechs, { stone: 20_260, wood: 20_310 });
    await kCombo.asUser.mutation(api.missions.claimMissionReward, { kingdomId: kCombo.kingdomId, progressId: "s1_castillo2" });
    const resCombo = await t.run(async (ctx) => ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kCombo.kingdomId)).first());
    expect(resCombo!.stone).toBe(20_460);
    expect(resCombo!.wood).toBe(20_460);

    // 5. Inventario lleno en un recurso -> rechaza
    const kFull = await prepareMissionPending(t, "m-full", "romanos", 0, [], { stone: 10_000, wood: 10_000 });
    await expect(
      kFull.asUser.mutation(api.missions.claimMissionReward, { kingdomId: kFull.kingdomId, progressId: "s1_castillo2" })
    ).rejects.toThrow(/NO HAY SITIO EN EL MERCADO/);

    // 6. Inventario parcialmente lleno (wood cabe: 500+150<=10000, pero stone desborda: 9950+200>10000) -> rechaza atómicamente (0 cambios en wood y honor)
    const kPartial = await prepareMissionPending(t, "m-partial", "romanos", 0, [], { stone: 9_950, wood: 500 });
    const kPartialBefore = await t.run(async (ctx) => ctx.db.get(kPartial.kingdomId));
    await expect(
      kPartial.asUser.mutation(api.missions.claimMissionReward, { kingdomId: kPartial.kingdomId, progressId: "s1_castillo2" })
    ).rejects.toThrow(/NO HAY SITIO EN EL MERCADO/);
    const resPartialAfter = await t.run(async (ctx) => ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kPartial.kingdomId)).first());
    const kPartialAfter = await t.run(async (ctx) => ctx.db.get(kPartial.kingdomId));
    expect(resPartialAfter!.wood).toBe(500);
    expect(resPartialAfter!.stone).toBe(9_950);
    expect(kPartialAfter!.honor).toBe(kPartialBefore!.honor);
  });

  test("7. Dos cobros simultáneos sobre la misma misión entregan la recompensa exactamente una vez", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "m-concurrent", "Reino Concurrente", "romanos");
    await seedBuildings(t, kingdomId, { castillo: 2 });
    await patchResources(t, kingdomId, { stone: 1_000, wood: 1_000 });
    await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    await asUser.mutation(api.missions.finishMission, { kingdomId, progressId: "s1_castillo2" });
    await patchResources(t, kingdomId, { stone: 1_000, wood: 1_000, lastUpdated: Date.now() });

    const settled = await Promise.allSettled([
      asUser.mutation(api.missions.claimMissionReward, { kingdomId, progressId: "s1_castillo2" }),
      asUser.mutation(api.missions.claimMissionReward, { kingdomId, progressId: "s1_castillo2" }),
    ]);

    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const resAfter = await t.run(async (ctx) => ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first());
    expect(resAfter!.stone).toBe(1_200);
    expect(resAfter!.wood).toBe(1_150);
  });
});

// ============================================================================
// §2.4 y §2.5 — DURACIÓN REAL DE INVESTIGACIÓN, COLAS ACTIVAS Y COSTE DE EDIFICIOS
// ============================================================================
describe("§2.4 y §2.5 — Paridad bonifiedDurationSeconds/durationMs, inmutabilidad en cola y costes de construcción", () => {
  test("bonifiedDurationSeconds * 1000 === durationMs real en researchTechnology y las investigaciones en curso no se recalculan", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "u-res-dur", "Reino Sabio", "griegos");
    await seedBuildings(t, kingdomId, { castillo: 6, universidad: 5 });
    await patchResources(t, kingdomId, { gold: 50_000, wood: 50_000, stone: 50_000, iron: 50_000, food: 50_000 });
    await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });

    // Completamos educ_1..educ_6 (-34 %) -> con Griegos (-10 %) = 0.66 * 0.90 = 0.594
    await seedCompletedTechs(t, kingdomId, ["educ_1", "educ_2", "educ_3", "educ_4", "educ_5", "educ_6", "construction_3"]);

    const catalogBefore = await asUser.query(api.technologies.getTechnologies, { kingdomId });
    const agri1Entry = catalogBefore.catalog.find((c: any) => c.id === "agri_1");
    expect(agri1Entry).toBeDefined();

    // Cálculo manual: agri_1 base = 30 s; 30 * (0.66 * 0.90) = 17.82 -> ceil = 18 s -> 18.000 ms
    const expected = computeResearchDuration(30, 0.66, 0.90);
    expect(expected.durationSeconds).toBe(18);
    expect(agri1Entry!.bonifiedDurationSeconds).toBe(18);

    const started = await asUser.mutation(api.technologies.researchTechnology, { kingdomId, techType: "agri_1" });
    expect(started.durationMs).toBe(agri1Entry!.bonifiedDurationSeconds * 1000);
    expect(started.durationMs).toBe(18_000);

    // Completar tech_civ_griegos_b en segundo plano mientras agri_1 sigue en cola: agri_1 conserva su durationMs original
    await seedCompletedTechs(t, kingdomId, ["tech_civ_griegos", "tech_civ_griegos_b"]);
    const afterPassiveChange = await asUser.query(api.technologies.getTechnologies, { kingdomId });
    const activeAgri1 = afterPassiveChange.researching.find((r: any) => r.technologyId === "agri_1");
    expect(activeAgri1!.durationMs).toBe(18_000);
    expect(activeAgri1!.completesAt).toBe(started.completesAt);
  });

  test("construction_4..8 reducen costes reales de construcción en startConstruction y convergen al tope 0.75", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "u-const-cost", "Reino Constructor", "romanos");
    await seedBuildings(t, kingdomId, { castillo: 8, universidad: 5, granja: 1 });
    await patchResources(t, kingdomId, { gold: 100_000, wood: 100_000, stone: 100_000, iron: 100_000, food: 100_000 });
    await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });

    // 4 niveles completados primero: 0.94 -> 0.89 -> 0.84 -> 0.79 -> 0.75
    await seedCompletedTechs(t, kingdomId, ["construction_4", "construction_5", "construction_6", "construction_7", "construction_8"]);
    const state = await asUser.query(api.kingdoms.getConstructionState, { kingdomId });
    const granjaInfo = state.catalogForLevels.granja;
    const expectedCosts = costsForTargetLevel(BUILDING_RULES.granja.costs!, 2, 0.75)!;
    expect(granjaInfo.nextCosts).toEqual(expectedCosts);

    const beforeRes = await t.run(async (ctx) => ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first());
    await asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "granja" });
    const afterRes = await t.run(async (ctx) => ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first());
    expect(Math.round((beforeRes!.wood - afterRes!.wood) * 100) / 100).toBe(expectedCosts.wood);
    expect(Math.round((beforeRes!.gold - afterRes!.gold) * 100) / 100).toBe(expectedCosts.gold);
  });
});

// ============================================================================
// §3.1, §3.2 y §3.3 — PARLAMENTO, MORAL SIN DUPLICACIÓN Y ESPIONAJE EN BOTS
// ============================================================================
describe("§3.1, §3.2 y §3.3 — Paridad Parlamento/Ejército, moralBase única y espionaje niveles 1-4 en bots", () => {
  test("parliament:acceptChallenge usa pasiva azteca Jaguar y snapshotSide aplica fatigueAccrualReduction sin duplicar moraleBase", async () => {
    const t = createTestBackend();
    const atk = await foundKingdom(t, "u-parl-atk", "Tenochtitlan", "aztecas");
    const def = await foundKingdom(t, "u-parl-def", "Defensa", "ingleses");
    await seedBuildings(t, atk.kingdomId, { castillo: 5, parlamento: 1, cuartel: 5 });
    await seedBuildings(t, def.kingdomId, { castillo: 5, parlamento: 1, cuartel: 5 });
    await seedCompletedTechs(t, atk.kingdomId, ["logistics_1", "logistics_3", "medical_4", "happiness_3"]);
    await seedCompletedTechs(t, def.kingdomId, ["happiness_3"]);

    await t.run(async (ctx) => {
      await ctx.db.insert("territories", { q: 0, r: 0, cellId: "0,0", terrain: "llanura", ownerKingdomId: atk.kingdomId, isHome: true });
      await ctx.db.insert("territories", { q: 1, r: 0, cellId: "1,0", terrain: "llanura" });
      await ctx.db.insert("territories", { q: 2, r: 0, cellId: "2,0", terrain: "llanura" });
      await ctx.db.insert("territories", { q: 3, r: 0, cellId: "3,0", terrain: "llanura", ownerKingdomId: def.kingdomId, isHome: true });
      await ctx.db.patch(atk.kingdomId, { homeTerritoryId: "0,0" });
      await ctx.db.patch(def.kingdomId, { homeTerritoryId: "3,0" });
      await ctx.db.insert("armyUnits", { kingdomId: atk.kingdomId, unitType: "caballeria", level: 1, count: 80 });
      await ctx.db.insert("armyUnits", { kingdomId: def.kingdomId, unitType: "infanteria", level: 1, count: 40 });
    });

    await atk.asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId: atk.kingdomId });
    await def.asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId: def.kingdomId });

    const created = await atk.asUser.mutation(api.parliament.createChallenge, {
      challengerKingdomId: atk.kingdomId,
      targetKingdomId: def.kingdomId,
      challengeType: "batalla",
    });
    const accepted = await def.asUser.mutation(api.parliament.acceptChallenge, {
      kingdomId: def.kingdomId,
      challengeId: created.challengeId,
      window: "proxima",
    });

    // En Aztecas la plaza 'caballeria' son Guerreros Jaguar a pie (marchMultiplier = 1.0, no 1.2)
    expect(armyMarchMultiplier({ caballeria: 80 }, "aztecas")).toBe(1.0);
    expect(accepted.marchSeconds).toBe(marchTimeSeconds(3, 1.0, 1.0, 1.0, 0));

    // Verificamos que la fatiga tras resolver desafío aplica medical_4 (-5%) y logistics_3 (-6%) + logistics_1 (-10%)
    vi.setSystemTime(accepted.scheduledAt + 1_000);
    await t.mutation(internal.parliament.resolveChallenge, { challengeId: created.challengeId });

    const atkAfter = await t.run(async (ctx) => ctx.db.get(atk.kingdomId));
    const defAfter = await t.run(async (ctx) => ctx.db.get(def.kingdomId));
    const expectedFatigue = marchFatigue(0, 3, 1.0, 1.0, 0.10, 0.11); // ceil(2*3*0.9*(1-0.11)) = ceil(4.806) = 5
    expect(expectedFatigue).toBe(5);
    expect(atkAfter!.armyFatigue).toBe(expectedFatigue);

    // Moral base +3 aplicada una sola vez: no se duplica sobre el campo ya liquidado
    const baseBattleFactors = computeSideFactors(
      {
        kingdomId: "A",
        name: "A",
        composition: { ...emptyComposition(), infanteria: 100 },
        trainingMultiplier: 1,
        weaponTier: "palo",
        armorTier: "ninguna",
        strategy: "defensiva",
        morale: defAfter!.militaryMorale!,
        foodTier: "normal",
        fatigue: 0,
        wallsLevel: 0,
        terrainDefenseBonus: 0,
        moraleBase: 0,
      },
      { ...emptyComposition(), infanteria: 100 },
      {
        kingdomId: "B",
        name: "B",
        composition: { ...emptyComposition(), infanteria: 100 },
        trainingMultiplier: 1,
        weaponTier: "palo",
        armorTier: "ninguna",
        strategy: "defensiva",
        morale: 50,
        foodTier: "normal",
        fatigue: 0,
        wallsLevel: 0,
        terrainDefenseBonus: 0,
      }
    );
    const doubleApplied = computeSideFactors(
      {
        kingdomId: "A",
        name: "A",
        composition: { ...emptyComposition(), infanteria: 100 },
        trainingMultiplier: 1,
        weaponTier: "palo",
        armorTier: "ninguna",
        strategy: "defensiva",
        morale: defAfter!.militaryMorale!,
        foodTier: "normal",
        fatigue: 0,
        wallsLevel: 0,
        terrainDefenseBonus: 0,
        moraleBase: 3,
      },
      { ...emptyComposition(), infanteria: 100 },
      {
        kingdomId: "B",
        name: "B",
        composition: { ...emptyComposition(), infanteria: 100 },
        trainingMultiplier: 1,
        weaponTier: "palo",
        armorTier: "ninguna",
        strategy: "defensiva",
        morale: 50,
        foodTier: "normal",
        fatigue: 0,
        wallsLevel: 0,
        terrainDefenseBonus: 0,
      }
    );
    expect(defAfter!.militaryMorale).toBe(58);
    expect(baseBattleFactors.morale).toBeCloseTo(0.79, 6);
    expect(doubleApplied.morale).toBeCloseTo(0.805, 6);
  });

  test("bots:listBots y requestBotEspionage soportan niveles 1-4, coste 1000 en nivel 4 y bono Navajo hasta tope 4", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "u-bot-navajo", "Navajos Espías", "navajos");
    await seedBuildings(t, kingdomId, { castillo: 6, parlamento: 1, universidad: 5 });
    await patchResources(t, kingdomId, { gold: 20_000 });
    await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });

    // Con espionage_3 + tech_civ_navajos_a => nivel 4 (tope 4)
    await seedCompletedTechs(t, kingdomId, ["espionage_1", "espionage_2", "espionage_3", "tech_civ_navajos", "tech_civ_navajos_a"]);

    const listed = await asUser.query(api.bots.listBots, { kingdomId });
    expect(listed.playerEspionageLevel).toBe(4);
    expect(listed.hasEspionage1).toBe(true);
    expect(listed.hasEspionage2).toBe(true);
    expect(listed.hasEspionage3).toBe(true);
    expect(listed.hasEspionage4).toBe(true);
    expect(listed.espionageCost).toBe(PARLIAMENT.ESPIONAGE.costByLevel[4]);
    expect(listed.espionageCost).toBe(1000);

    const activeBot = getAllActiveBots(T0)[0];
    const spyReport = await asUser.mutation(api.bots.requestBotEspionage, { kingdomId, botId: activeBot.id });
    expect(spyReport.level).toBe(4);
    expect(spyReport.cost).toBe(1000);

    const expectedExact = estimateBotArmy(activeBot, 4);
    expect(spyReport.estimate.min).toBe(expectedExact.total.min);
    expect(spyReport.estimate.max).toBe(expectedExact.total.max);
    expect(spyReport.estimate.min).toBe(spyReport.estimate.max);

    // También comprobamos nivel 3 (±3 %) para otro reino sin Navajo ni espionage_4
    const g3 = await foundKingdom(t, "u-bot-n3", "Espía Nivel 3", "romanos");
    await seedBuildings(t, g3.kingdomId, { castillo: 5, parlamento: 1 });
    await patchResources(t, g3.kingdomId, { gold: 10_000 });
    await g3.asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId: g3.kingdomId });
    await seedCompletedTechs(t, g3.kingdomId, ["espionage_1", "espionage_2", "espionage_3"]);
    const rep3 = await g3.asUser.mutation(api.bots.requestBotEspionage, { kingdomId: g3.kingdomId, botId: activeBot.id });
    expect(rep3.level).toBe(3);
    expect(rep3.cost).toBe(500);
    expect(rep3.estimate).toMatchObject({ min: estimateBotArmy(activeBot, 3).total.min, max: estimateBotArmy(activeBot, 3).total.max });
  });
});

// ============================================================================
// §4 IDENTIFICADORES HISTÓRICOS Y COMPATIBILIDAD SIN BORRADO DESTRUCTIVO
// ============================================================================
describe("§4 — Normalización de LEGACY_TECHNOLOGY_IDS y LEGACY_CIVILIZATION_IDS en todos los lectores", () => {
  test("IDs antiguos de Navajos y Masáis funcionan en catálogo, sucesoras, en curso y misiones secretas", async () => {
    const t = createTestBackend();

    // Reino heredado con civilization="keniatas" y tecnología completada "tech_civ_keniatas"
    const kMasais = await foundKingdom(t, "u-legacy-masai", "Reino Masái Heredado", "masais");
    await t.run(async (ctx) => {
      await ctx.db.patch(kMasais.kingdomId, { civilization: "keniatas" });
    });
    await seedBuildings(t, kMasais.kingdomId, { castillo: 5, universidad: 3, cuartel: 3 });
    await seedCompletedTechs(t, kMasais.kingdomId, ["tech_civ_keniatas"]);

    const techRes = await kMasais.asUser.query(api.technologies.getTechnologies, { kingdomId: kMasais.kingdomId });
    const baseMasai = techRes.catalog.find((c: any) => c.id === "tech_civ_masais");
    const sucMasaiA = techRes.catalog.find((c: any) => c.id === "tech_civ_masais_a");
    expect(baseMasai?.status).toBe("completed");
    expect(sucMasaiA?.status).toBe("available");
    expect(Math.abs(techRes.modifiers.marchFatigueReduction - 0.25) < 1e-9).toBe(true);

    // Misión secreta de Masáis detectada gracias a la normalización de ID y civilización heredados
    const missionsRes = await kMasais.asUser.query(api.missions.getMissions, { kingdomId: kMasais.kingdomId });
    const secretMasai = missionsRes.secrets.discovered.find((m: any) => m.id === "x_civ_masais");
    expect(secretMasai).toBeDefined();
    expect(secretMasai?.status).toBe("ready_to_finish");

    // Investigación en curso con ID histórico antiguo de Navajos se lee normalizada y al completarse no duplica ni borra ilegítimamente
    const kNavajos = await foundKingdom(t, "u-legacy-nav", "Reino Navajo Heredado", "navajos");
    await t.run(async (ctx) => {
      await ctx.db.patch(kNavajos.kingdomId, { civilization: "indiosAmericanos" });
    });
    await seedBuildings(t, kNavajos.kingdomId, { castillo: 5, universidad: 3 });
    let legacyProgressId: Id<"technologyProgress"> | null = null;
    await t.run(async (ctx) => {
      legacyProgressId = await ctx.db.insert("technologyProgress", {
        kingdomId: kNavajos.kingdomId,
        technologyId: "tech_civ_indiosAmericanos",
        status: "researching",
        startedAt: T0 - 420_000,
        durationMs: 420_000,
      });
    });

    const navCatalog = await kNavajos.asUser.query(api.technologies.getTechnologies, { kingdomId: kNavajos.kingdomId });
    expect(navCatalog.researching[0].technologyId).toBe("tech_civ_navajos");
    expect(navCatalog.catalog.find((c: any) => c.id === "tech_civ_navajos")?.status).toBe("researching");

    await t.mutation(internal.technologies.completeResearch, { progressId: legacyProgressId! });
    const navAfter = await kNavajos.asUser.query(api.technologies.getTechnologies, { kingdomId: kNavajos.kingdomId });
    expect(navAfter.catalog.find((c: any) => c.id === "tech_civ_navajos")?.status).toBe("completed");
    expect(navAfter.modifiers.marchFatigueReduction).toBeCloseTo(0.20, 9);
  });
});

// ============================================================================
// §5 AISLAMIENTO ESTRICTO DE INVESTIGACIONES POR CIVILIZACIÓN (12 CIVILIZACIONES)
// ============================================================================
describe("§5 — Aislamiento estricto por civilizationRequirement para las 12 civilizaciones y manipulación de cliente", () => {
  test("cada una de las 12 civilizaciones ve 87 generales + 4 propias = 91 y nunca puede investigar ni consultar ajenas", async () => {
    const t = createTestBackend();
    const generalCount = TECHNOLOGIES.filter((tech) => !tech.civilizationRequirement).length;
    expect(generalCount).toBe(87);
    expect(TECHNOLOGIES.length).toBe(135);

    const kOther = await foundKingdom(t, "u-iso-other", "Reino Romano Ajeno", "romanos");
    await seedBuildings(t, kOther.kingdomId, { castillo: 6, universidad: 5 });

    for (const civ of CIVILIZATIONS) {
      const { asUser, kingdomId } = await foundKingdom(t, `u-iso-${civ.id}`, `Reino ${civ.id}`, civ.id);
      await seedBuildings(t, kingdomId, { castillo: 6, universidad: 5 });
      await patchResources(t, kingdomId, { gold: 50_000, wood: 50_000, stone: 50_000, iron: 50_000, food: 50_000 });
      await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });

      const res = await asUser.query(api.technologies.getTechnologies, { kingdomId });
      expect(res.catalog).toHaveLength(91);

      const ownExclusives = res.catalog.filter((c: any) => c.civilizationRequirement === civ.id);
      const foreignExclusives = res.catalog.filter(
        (c: any) => c.civilizationRequirement && c.civilizationRequirement !== civ.id
      );
      expect(ownExclusives).toHaveLength(4);
      expect(foreignExclusives).toHaveLength(0);

      // Elegir una tecnología exclusiva de otra civilización e intentar iniciarla manipulando el parámetro techType
      const alienCiv = CIVILIZATIONS.find((other) => other.id !== civ.id)!;
      const alienTechId = `tech_civ_${alienCiv.id}`;
      await expect(
        asUser.mutation(api.technologies.researchTechnology, { kingdomId, techType: alienTechId })
      ).rejects.toThrow(/Exclusiva de/i);

      // Intentar consultar o iniciar sobre kingdomId ajeno también falla por control de acceso
      await expect(
        asUser.query(api.technologies.getTechnologies, { kingdomId: kOther.kingdomId })
      ).rejects.toThrow(/No autorizado/i);
    }

    // Reino sin civilización asignada (0 exclusivas, solo 87 generales)
    const noCivKingdomId = await t.run(async (ctx) => {
      const kId = await ctx.db.insert("kingdoms", { userId: "u-nociv", name: "Reino Apátrida" });
      await ctx.db.insert("buildings", { kingdomId: kId, buildingType: "castillo", level: 2 });
      await ctx.db.insert("buildings", { kingdomId: kId, buildingType: "universidad", level: 2 });
      return kId;
    });
    const asNoCiv = t.withIdentity({ subject: "u-nociv", tokenIdentifier: "https://test.auth|u-nociv", issuer: "https://test.auth" });
    const noCivCatalog = await asNoCiv.query(api.technologies.getTechnologies, { kingdomId: noCivKingdomId });
    expect(noCivCatalog.catalog).toHaveLength(87);
    expect(noCivCatalog.catalog.every((c: any) => !c.civilizationRequirement)).toBe(true);

    // Consulta individual directa + tecnología exclusiva en rama distinta de "civilizacion"
    expect(getVisibleTechnologyForCivilization("tech_civ_chinos", "romanos")).toBeNull();
    expect(
      filterVisibleTechnologiesForCivilization(
        [{ ...TECHNOLOGIES[0], id: "tech_militar_exclusiva_japoneses", branch: "militar", civilizationRequirement: "japoneses" }],
        "romanos"
      )
    ).toHaveLength(0);
    expect(
      filterVisibleTechnologiesForCivilization(
        [{ ...TECHNOLOGIES[0], id: "tech_militar_exclusiva_japoneses", branch: "militar", civilizationRequirement: "japoneses" }],
        "japoneses"
      )
    ).toHaveLength(1);
  });
});
