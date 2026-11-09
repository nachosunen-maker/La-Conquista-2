import { query } from "./_generated/server";
import { v } from "convex/values";
import { TERRAINS } from "./balanceConfig";
import { getCivilizationPassive } from "./civilizationRules";
import { computeTechnologyModifiers, readCompletedTechnologyIds } from "./technologyRules";
import { simulateExtendedEconomy } from "./economyExtended";
import { calculateJobCapacities, calculateResidentialCapacity, validateBuildingCollection } from "./buildingRules";
import { activeProductionBonusMultiplier } from "./missionRules";

export const auditWormeyDeep = query({
  args: {},
  handler: async (ctx) => {
    // 1. Find Wormey's user & kingdom
    const users = await ctx.db.query("users" as any).collect();
    const wormeyUser = users.find((u: any) =>
      (u.name && u.name.toLowerCase().includes("wormey")) ||
      (u.email && u.email.toLowerCase().includes("wormey"))
    );

    if (!wormeyUser) throw new Error("Wormey user not found");

    const kingdom = await ctx.db
      .query("kingdoms")
      .withIndex("by_user_id", (q) => q.eq("userId", wormeyUser._id))
      .first();

    if (!kingdom) throw new Error("Wormey kingdom not found");

    // 2. Fetch all owned territories
    const territories = await ctx.db
      .query("territories")
      .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdom._id))
      .collect();

    // 3. Compute terrain bonuses directly
    const bonusesFromTerritories: Record<string, number> = {};
    for (const t of territories) {
      const terrainInfo = (TERRAINS as any)[t.terrain];
      if (!terrainInfo || !terrainInfo.production) continue;
      for (const [job, bonus] of Object.entries(terrainInfo.production as Record<string, number>)) {
        bonusesFromTerritories[job] = (bonusesFromTerritories[job] ?? 0) + bonus;
      }
    }

    // 4. Fetch relational state (resources, population, jobs, buildings, tech)
    const resources = await ctx.db
      .query("resources" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdom._id))
      .first();

    const population = await ctx.db
      .query("population" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdom._id))
      .first();

    const populationJobs = await ctx.db
      .query("populationJobs" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdom._id))
      .collect();

    const buildings = await ctx.db
      .query("buildings" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdom._id))
      .collect();

    const completedTech = await readCompletedTechnologyIds(ctx, kingdom._id);
    const techModifiers = computeTechnologyModifiers(completedTech);

    const collection = validateBuildingCollection(buildings);
    const buildingLevels = collection.success ? collection.levels : {};

    const jobCounts: Record<string, number> = {};
    for (const pj of populationJobs) {
      jobCounts[pj.jobType] = pj.assignedCount;
    }

    const kingdomState = {
      kingdom,
      resources,
      population,
      jobCounts,
      workers: {
        agriculture: jobCounts.agriculture ?? 0,
        wood: jobCounts.wood ?? 0,
        stone: jobCounts.stone ?? 0,
        iron: jobCounts.iron ?? 0,
        gold: jobCounts.gold ?? 0,
        other: jobCounts.other ?? 0,
      },
      lastUpdated: resources?.lastUpdated ?? Date.now(),
    };

    // 5. Run simulation WITH terrain bonuses vs WITHOUT terrain bonuses
    const now = Date.now();
    const simWithTerritories = simulateExtendedEconomy({
      kingdomState: kingdomState as any,
      now,
      jobCapacities: calculateJobCapacities(buildings),
      residentialCapacity: calculateResidentialCapacity(buildings),
      technologyModifiers: techModifiers,
      terrainBonuses: bonusesFromTerritories as any,
      taxRate: kingdom.taxRate ?? 0,
      happiness: kingdom.happiness ?? 70,
      moraleEffects: Array.isArray(kingdom.moraleEffects) ? kingdom.moraleEffects : [],
      starvationSeconds: population?.starvationSeconds ?? 0,
      buildingLevels,
      militaryPersonnel: 0,
      civilization: kingdom.civilization,
      bonusProductionMultiplier: activeProductionBonusMultiplier(kingdom.temporaryBonuses, now),
    });

    const simWithoutTerritories = simulateExtendedEconomy({
      kingdomState: kingdomState as any,
      now,
      jobCapacities: calculateJobCapacities(buildings),
      residentialCapacity: calculateResidentialCapacity(buildings),
      technologyModifiers: techModifiers,
      terrainBonuses: {},
      taxRate: kingdom.taxRate ?? 0,
      happiness: kingdom.happiness ?? 70,
      moraleEffects: Array.isArray(kingdom.moraleEffects) ? kingdom.moraleEffects : [],
      starvationSeconds: population?.starvationSeconds ?? 0,
      buildingLevels,
      militaryPersonnel: 0,
      civilization: kingdom.civilization,
      bonusProductionMultiplier: activeProductionBonusMultiplier(kingdom.temporaryBonuses, now),
    });

    return {
      userName: wormeyUser.name,
      userEmail: wormeyUser.email,
      kingdomName: kingdom.name,
      kingdomId: kingdom._id,
      civilization: kingdom.civilization,
      currentGlory: kingdom.glory ?? 0,
      currentHonor: kingdom.honor ?? 0,
      territoriesCount: territories.length,
      territoriesBreakdown: territories.map((t) => ({
        cellId: t.cellId,
        terrain: t.terrain,
        isHome: Boolean(t.isHome),
        claimedAt: t.claimedAt ?? null,
        productionBonus: (TERRAINS as any)[t.terrain]?.production ?? {},
      })),
      bonusesFromTerritories,
      dailyFoodProductionWithTerritories: simWithTerritories.dailyProduction.food,
      dailyFoodProductionWithoutTerritories: simWithoutTerritories.dailyProduction.food,
      effectiveAgricultureBoostPercent: simWithoutTerritories.dailyProduction.food > 0
        ? Math.round(((simWithTerritories.dailyProduction.food / simWithoutTerritories.dailyProduction.food) - 1) * 100)
        : 0,
    };
  },
});
