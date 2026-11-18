import { internalMutation } from "./_generated/server";
import { MAP } from "./balanceConfig";
import { hexDistance } from "./territoryRules";
import { addUnits } from "./army";
import { calculateExplorationRefund } from "./explorationRules";
import { settleRelationalKingdomEconomy } from "./economy";

export const executeMapReduction = internalMutation({
  args: {},
  handler: async (ctx) => {
    const radiusLimit = MAP.RADIUS;
    const now = Date.now();

    // 1. Recover Units and Resources from Exterior Missions
    const expQueue = await ctx.db.query("explorationQueue").collect();
    for (const exp of expQueue) {
        if (hexDistance({ q: exp.targetQ, r: exp.targetR }, { q: 0, r: 0 }) > radiusLimit) {
            // Cancel Exploration
            if (exp.isSpyMission) {
                await addUnits(ctx, exp.kingdomId, "espia", 1, exp.scoutsCount || 1);
            } else {
                 const populationDoc = await ctx.db
                    .query("population")
                    .withIndex("by_kingdom", (q) => q.eq("kingdomId", exp.kingdomId))
                    .first();
                 if (populationDoc) {
                    await ctx.db.patch(populationDoc._id, {
                        available: (populationDoc.available ?? 0) + (exp.scoutsCount ?? 1),
                    });
                 }
            }
            // Refund resources
            const kingdom = await ctx.db.get(exp.kingdomId);
            if (kingdom) {
                const settled = await settleRelationalKingdomEconomy(ctx, kingdom, kingdom.userId, now);
                const refund = calculateExplorationRefund(exp.costs);
                await ctx.db.patch(settled.resources._id, {
                    gold: settled.settledResources.gold + refund.gold,
                    food: settled.settledResources.food + refund.food,
                });
            }
            await ctx.db.delete(exp._id);
        }
    }

    const armyMarches = await ctx.db.query("armyMarches").collect();
    for (const march of armyMarches) {
        if (hexDistance({ q: march.targetQ, r: march.targetR }, { q: 0, r: 0 }) > radiusLimit) {
            // Cancel March and return units
            for (const unit of march.units) {
                 await addUnits(ctx, march.kingdomId, unit.unitType as any, unit.level || 1, unit.count);
            }
            await ctx.db.delete(march._id);
        }
    }

    // 2. Delete Exterior Territories and Explorations in batches
    const territories = await ctx.db.query("territories").collect();
    const exteriorTerritories = territories.filter(t => hexDistance({ q: t.q, r: t.r }, { q: 0, r: 0 }) > radiusLimit);
    for (let i = 0; i < exteriorTerritories.length; i += 500) {
        const batch = exteriorTerritories.slice(i, i + 500);
        for (const t of batch) {
            await ctx.db.delete(t._id);
        }
    }

    const explorations = await ctx.db.query("exploredTerritories").collect();
    const exteriorExplorations = explorations.filter(e => {
        const parts = e.cellId.split(',');
        const q = Number(parts[0]);
        const r = Number(parts[1]);
        return hexDistance({ q, r }, { q: 0, r: 0 }) > radiusLimit;
    });
    for (let i = 0; i < exteriorExplorations.length; i += 500) {
        const batch = exteriorExplorations.slice(i, i + 500);
        for (const e of batch) {
            await ctx.db.delete(e._id);
        }
    }

    return {
        territoriesDeleted: exteriorTerritories.length,
        explorationsDeleted: exteriorExplorations.length,
        missionsCancelled: expQueue.length - (await ctx.db.query("explorationQueue").collect()).length,
        marchesCancelled: armyMarches.length - (await ctx.db.query("armyMarches").collect()).length
    };
  },
});
