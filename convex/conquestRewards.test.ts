import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { TERRAINS } from "./balanceConfig";
import { simulateExtendedEconomy } from "./economyExtended";

describe("SISTEMA DE RECOMPENSAS Y BONIFICACIONES DE CONQUISTA", () => {
  test("1. Las bonificaciones de terreno se suman aditivamente por tipo de recurso y se aplican multiplicativamente a la producción base", () => {
    // 2 bosques (+15 % madera cada uno = +30 % total)
    const baseState = {
      kingdom: { name: "Test Kingdom", foodTier: "normal", taxRate: 0, happiness: 70 },
      resources: { gold: 1000, wood: 1000, stone: 1000, iron: 1000, food: 1000, lastUpdated: 100000 },
      population: { total: 1000, available: 500 },
      jobCounts: { wood: 10 },
      workers: { agriculture: 0, wood: 10, stone: 0, iron: 0, gold: 0, other: 0 },
      lastUpdated: 100000,
    };

    const simNoBonus = simulateExtendedEconomy({
      kingdomState: baseState as any,
      now: 100000 + 86400000,
      jobCapacities: { agriculture: 100, wood: 100, stone: 100, iron: 100, gold: 100 },
      residentialCapacity: 2000,
      technologyModifiers: { agricultureProduction: 1, miningProduction: 1, storageCapacity: 1 } as any,
      terrainBonuses: {},
      taxRate: 0,
      happiness: 70,
      starvationSeconds: 0,
      buildingLevels: { mercado: 1 },
      militaryPersonnel: 0,
      civilization: "romanos",
      bonusProductionMultiplier: 1,
    });

    const simWithDoubleForest = simulateExtendedEconomy({
      kingdomState: baseState as any,
      now: 100000 + 86400000,
      jobCapacities: { agriculture: 100, wood: 100, stone: 100, iron: 100, gold: 100 },
      residentialCapacity: 2000,
      technologyModifiers: { agricultureProduction: 1, miningProduction: 1, storageCapacity: 1 } as any,
      terrainBonuses: { wood: 0.30 }, // 2 Bosques
      taxRate: 0,
      happiness: 70,
      starvationSeconds: 0,
      buildingLevels: { mercado: 1 },
      militaryPersonnel: 0,
      civilization: "romanos",
      bonusProductionMultiplier: 1,
    });

    expect(simWithDoubleForest.dailyProduction.wood).toBeCloseTo(simNoBonus.dailyProduction.wood * 1.30, 2);
  });

  test("2. Reclamar un territorio con claimFreeTerritory otorga +1 gloria y +1 honor de forma autoritativa", async () => {
    const t = convexTest(schema);
    const userId = "user_conquest_test_1";

    // Crear reino
    const kingdomId = await t.run(async (ctx) => {
      const kId = await ctx.db.insert("kingdoms", {
        userId,
        name: "Reino Conquistador",
        glory: 10,
        honor: 20,
        pendingTerritoryClaims: 1,
        homeTerritoryId: "0,0",
      });
      await ctx.db.insert("territories", { cellId: "0,0", q: 0, r: 0, terrain: "llanura", ownerKingdomId: kId, isHome: true });
      await ctx.db.insert("territories", { cellId: "1,0", q: 1, r: 0, terrain: "bosque" });
      await ctx.db.insert("exploredTerritories", { kingdomId: kId, cellId: "1,0", discoveredAt: Date.now() });
      return kId;
    });

    // Reclamar territorio libre adyacente
    await t.mutation(api.territories.claimFreeTerritory, { kingdomId, cellId: "1,0" });

    const updatedKingdom = await t.run(async (ctx) => await ctx.db.get(kingdomId));
    expect(updatedKingdom!.glory).toBe(11); // +1 gloria
    expect(updatedKingdom!.honor).toBe(21); // +1 honor
    expect(updatedKingdom!.conquestRewardsGranted).toBe(1);
  });

  test("3. Regularización retroactiva es estrictamente idempotente y no duplica puntos en reejecuciones", async () => {
    const t = convexTest(schema);

    // Crear reino con 3 conquistas históricas sin haber recibido sus +3 gloria / +3 honor
    const kingdomId = await t.run(async (ctx) => {
      const kId = await ctx.db.insert("kingdoms", {
        userId: "user_retro_test",
        name: "Reino Historico",
        glory: 5,
        honor: 50,
        homeTerritoryId: "0,0",
      });
      await ctx.db.insert("territories", { cellId: "0,0", q: 0, r: 0, terrain: "llanura", ownerKingdomId: kId, isHome: true });
      await ctx.db.insert("territories", { cellId: "1,0", q: 1, r: 0, terrain: "bosque", ownerKingdomId: kId, isHome: false });
      await ctx.db.insert("territories", { cellId: "0,1", q: 0, r: 1, terrain: "montana", ownerKingdomId: kId, isHome: false });
      await ctx.db.insert("territories", { cellId: "-1,1", q: -1, r: 1, terrain: "colina", ownerKingdomId: kId, isHome: false });
      return kId;
    });

    // Primera regularización
    const res1 = await t.mutation(api.auditConquest.regularizeConquestRewards, {});
    expect(res1.success).toBe(true);

    const k1 = await t.run(async (ctx) => await ctx.db.get(kingdomId));
    expect(k1!.glory).toBe(8); // 5 + 3
    expect(k1!.honor).toBe(53); // 50 + 3
    expect(k1!.conquestRewardsGranted).toBe(3);

    // Segunda regularización (idempotente)
    const res2 = await t.mutation(api.auditConquest.regularizeConquestRewards, {});
    expect(res2.success).toBe(true);

    const k2 = await t.run(async (ctx) => await ctx.db.get(kingdomId));
    expect(k2!.glory).toBe(8); // Sin cambios
    expect(k2!.honor).toBe(53); // Sin cambios
    expect(k2!.conquestRewardsGranted).toBe(3);
  });
});
