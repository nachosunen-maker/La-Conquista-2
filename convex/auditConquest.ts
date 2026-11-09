import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { TERRAINS } from "./balanceConfig";

export const auditAllKingdoms = query({
  args: {},
  handler: async (ctx) => {
    const kingdoms = await ctx.db.query("kingdoms").collect();
    const territories = await ctx.db.query("territories").collect();

    const results = [];

    for (const kingdom of kingdoms) {
      const owned = territories.filter(
        (t) => t.ownerKingdomId && String(t.ownerKingdomId) === String(kingdom._id)
      );

      const capitalCell = owned.find((t) => t.isHome) ??
        (kingdom.homeTerritoryId ? owned.find((t) => t.cellId === kingdom.homeTerritoryId) : null);

      const conqueredCells = owned.filter(
        (t) => t.cellId !== capitalCell?.cellId && !t.isHome
      );

      // Expected bonuses
      const expectedBonuses: Record<string, number> = {};
      for (const t of owned) {
        const info = (TERRAINS as any)[t.terrain];
        if (!info || !info.production) continue;
        for (const [job, bonus] of Object.entries(info.production as Record<string, number>)) {
          expectedBonuses[job] = (expectedBonuses[job] ?? 0) + bonus;
        }
      }

      const conqueredCount = conqueredCells.length;
      const currentGlory = typeof kingdom.glory === "number" ? kingdom.glory : 0;
      const currentHonor = typeof kingdom.honor === "number" ? kingdom.honor : 0;
      const conquestRewardsGranted = typeof kingdom.conquestRewardsGranted === "number" ? kingdom.conquestRewardsGranted : 0;
      const missingRewards = Math.max(0, conqueredCount - conquestRewardsGranted);

      results.push({
        kingdomId: kingdom._id,
        name: kingdom.name,
        userId: kingdom.userId,
        civilization: kingdom.civilization ?? "ninguna",
        currentGlory,
        currentHonor,
        conquestRewardsGranted,
        missingRewards,
        totalOwnedTerritories: owned.length,
        capitalCellId: capitalCell?.cellId ?? null,
        conqueredTerritoriesCount: conqueredCount,
        conqueredCells: conqueredCells.map((c) => ({
          cellId: c.cellId,
          terrain: c.terrain,
          claimedAt: c.claimedAt ?? null,
          terrainLabel: (TERRAINS as any)[c.terrain]?.label ?? c.terrain,
          productionBonus: (TERRAINS as any)[c.terrain]?.production ?? {},
        })),
        expectedBonuses,
      });
    }

    return results;
  },
});

export const regularizeConquestRewards = mutation({
  args: {},
  handler: async (ctx) => {
    const kingdoms = await ctx.db.query("kingdoms").collect();
    const territories = await ctx.db.query("territories").collect();

    const updates = [];

    for (const kingdom of kingdoms) {
      const owned = territories.filter(
        (t) => t.ownerKingdomId && String(t.ownerKingdomId) === String(kingdom._id)
      );

      const capitalCell = owned.find((t) => t.isHome) ??
        (kingdom.homeTerritoryId ? owned.find((t) => t.cellId === kingdom.homeTerritoryId) : null);

      const conqueredCells = owned.filter(
        (t) => t.cellId !== capitalCell?.cellId && !t.isHome
      );

      const conqueredCount = conqueredCells.length;
      const currentGlory = typeof kingdom.glory === "number" ? kingdom.glory : 0;
      const currentHonor = typeof kingdom.honor === "number" ? kingdom.honor : 0;
      const granted = typeof kingdom.conquestRewardsGranted === "number" ? kingdom.conquestRewardsGranted : 0;

      // Calculate missing conquest rewards
      const missing = Math.max(0, conqueredCount - granted);

      if (missing > 0 || kingdom.conquestRewardsGranted === undefined) {
        const newGlory = currentGlory + missing;
        const newHonor = currentHonor + missing;

        await ctx.db.patch(kingdom._id, {
          glory: newGlory,
          honor: newHonor,
          conquestRewardsGranted: conqueredCount,
          updatedAt: Date.now(),
        });

        updates.push({
          kingdomId: kingdom._id,
          name: kingdom.name,
          conqueredCount,
          previouslyGranted: granted,
          missingGranted: missing,
          gloryBefore: currentGlory,
          gloryAfter: newGlory,
          honorBefore: currentHonor,
          honorAfter: newHonor,
        });
      } else {
        updates.push({
          kingdomId: kingdom._id,
          name: kingdom.name,
          conqueredCount,
          previouslyGranted: granted,
          missingGranted: 0,
          gloryBefore: currentGlory,
          gloryAfter: currentGlory,
          honorBefore: currentHonor,
          honorAfter: currentHonor,
        });
      }
    }

    return {
      success: true,
      timestamp: Date.now(),
      processedKingdoms: kingdoms.length,
      updates,
    };
  },
});
