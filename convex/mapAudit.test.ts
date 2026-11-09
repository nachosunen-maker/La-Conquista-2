import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { hexDistance } from "./territoryRules";

describe("AUDITORÍA DE REDUCCIÓN DEL MAPA", () => {
  test("Audit cells to delete", async () => {
    const t = convexTest(schema);
    const territories = await t.run(async (ctx) => {
        return await ctx.db.query("territories").collect();
    });

    const toDelete = territories.filter(t => hexDistance({ q: t.q, r: t.r }, { q: 0, r: 0 }) > 25);
    
    // Group by owner
    const lostTerritories: Record<string, number> = {};
    for (const t of toDelete) {
        if (t.ownerKingdomId) {
            const id = String(t.ownerKingdomId);
            lostTerritories[id] = (lostTerritories[id] || 0) + 1;
        }
    }
    
    console.log("Total cells:", territories.length);
    console.log("Cells to delete:", toDelete.length);
    console.log("Lost territories by kingdom:", lostTerritories);
    
    expect(true).toBe(true);
  });
});
