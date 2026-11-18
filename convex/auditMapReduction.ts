import { internalQuery } from "./_generated/server";
import { MAP } from "./balanceConfig";
import { hexDistance } from "./territoryRules";

export const auditMapReductionDeep = internalQuery({
  args: {},
  handler: async (ctx) => {
    const radiusLimit = MAP.RADIUS;
    
    // Read data
    const territories = await ctx.db.query("territories").collect();
    const explorations = await ctx.db.query("exploredTerritories").collect();
    const expQueue = await ctx.db.query("explorationQueue").collect();
    const armyMarches = await ctx.db.query("armyMarches").collect();
    const armyUnits = await ctx.db.query("armyUnits").collect();

    // Identify exterior elements (excluding protected capitals, matching runMapReduction)
    const exteriorTerritoriesAll = territories.filter(t => hexDistance({ q: t.q, r: t.r }, { q: 0, r: 0 }) > radiusLimit);
    const protectedCapitals = exteriorTerritoriesAll.filter(t => t.isHome === true);
    const exteriorTerritories = exteriorTerritoriesAll.filter(t => t.isHome !== true);
    
    // Explored territories: need to parse cellId
    const exteriorExplorations = explorations.filter(e => {
        const parts = e.cellId.split(',');
        if (parts.length !== 2) return false;
        const q = Number(parts[0]);
        const r = Number(parts[1]);
        if (!Number.isFinite(q) || !Number.isFinite(r)) return false;
        return hexDistance({ q, r }, { q: 0, r: 0 }) > radiusLimit;
    });

    // Expeditions
    const exteriorExpQueue = expQueue.filter(e => hexDistance({ q: e.targetQ, r: e.targetR }, { q: 0, r: 0 }) > radiusLimit);
    
    // Marches: only active marches that have not already been refunded
    const exteriorMarches = armyMarches.filter(
      m => hexDistance({ q: m.targetQ, r: m.targetR }, { q: 0, r: 0 }) > radiusLimit && m.status === "marchando" && m.unitsRefundedAt == null
    );

    // Kingdoms affected
    const affectedKingdomIds = new Set<string>();
    exteriorTerritories.forEach(t => { if (t.ownerKingdomId) affectedKingdomIds.add(String(t.ownerKingdomId)); });
    
    return {
        territoriesToDelete: exteriorTerritories.length,
        protectedCapitals: protectedCapitals.length,
        exploredTerritoriesToDelete: exteriorExplorations.length,
        expeditionsToCancel: exteriorExpQueue.length,
        marchesToCancel: exteriorMarches.length,
        affectedKingdomCount: affectedKingdomIds.size,
        // Approximate cost estimate: ~15k docs read
        estimatedConvexReadCost: "Very low (< 5% of monthly quota)" 
    };
  },
});
