import { query } from "./_generated/server";
import { hexDistance } from "./territoryRules";

export const auditMapReductionDeep = query({
  args: {},
  handler: async (ctx) => {
    const radiusLimit = 25;
    
    // Read data
    const territories = await ctx.db.query("territories").collect();
    const explorations = await ctx.db.query("exploredTerritories").collect();
    const expQueue = await ctx.db.query("explorationQueue").collect();
    const armyMarches = await ctx.db.query("armyMarches").collect();
    const armyUnits = await ctx.db.query("armyUnits").collect();

    // Identify exterior elements
    const exteriorTerritories = territories.filter(t => hexDistance({ q: t.q, r: t.r }, { q: 0, r: 0 }) > radiusLimit);
    
    // Explored territories: need to parse cellId
    const exteriorExplorations = explorations.filter(e => {
        const parts = e.cellId.split(',');
        if (parts.length !== 2) return false;
        const q = Number(parts[0]);
        const r = Number(parts[1]);
        return hexDistance({ q, r }, { q: 0, r: 0 }) > radiusLimit;
    });

    // Expeditions
    const exteriorExpQueue = expQueue.filter(e => hexDistance({ q: e.targetQ, r: e.targetR }, { q: 0, r: 0 }) > radiusLimit);
    
    // Marches
    const exteriorMarches = armyMarches.filter(m => hexDistance({ q: m.targetQ, r: m.targetR }, { q: 0, r: 0 }) > radiusLimit);

    // Kingdoms affected
    const affectedKingdomIds = new Set<string>();
    exteriorTerritories.forEach(t => { if (t.ownerKingdomId) affectedKingdomIds.add(String(t.ownerKingdomId)); });
    
    return {
        territoriesToDelete: exteriorTerritories.length,
        exploredTerritoriesToDelete: exteriorExplorations.length,
        expeditionsToCancel: exteriorExpQueue.length,
        marchesToCancel: exteriorMarches.length,
        affectedKingdomCount: affectedKingdomIds.size,
        // Approximate cost estimate: ~15k docs read
        estimatedConvexReadCost: "Very low (< 5% of monthly quota)" 
    };
  },
});
