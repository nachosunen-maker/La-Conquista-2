import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { MAP } from "./balanceConfig";
import { generateWorldCells, hexDistance } from "./territoryRules";

describe("Ampliación del Mapa Mundial a Radio 50 (7.651 casillas)", () => {
  it("Fórmula matemática N = 1 + 3r(r+1) da exactamente 7.651 para r=50", () => {
    const r = 50;
    const formulaN = 1 + 3 * r * (r + 1);
    expect(formulaN).toBe(7651);
  });

  it("generateWorldCells(50) genera exactamente 7.651 celdas únicas", () => {
    const cells = generateWorldCells(50, MAP.WORLD_SEED);
    expect(cells).toHaveLength(7651);
    const ids = new Set(cells.map((c) => c.cellId));
    expect(ids.size).toBe(7651);

    // Todas las celdas cumplen hexDistance <= 50
    for (const cell of cells) {
      const dist = hexDistance(cell, { q: 0, r: 0 });
      expect(dist).toBeLessThanOrEqual(50);
    }
  });

  it("Los 331 hexágonos originales (radio 10) están contenidos en los 7.651 y conservan sus coordenadas", () => {
    const cells10 = generateWorldCells(10, MAP.WORLD_SEED);
    expect(cells10).toHaveLength(331);

    const cells50 = generateWorldCells(50, MAP.WORLD_SEED);
    const map50 = new Map(cells50.map((c) => [c.cellId, c]));

    for (const c10 of cells10) {
      const c50 = map50.get(c10.cellId);
      expect(c50).toBeDefined();
      expect(c50?.q).toBe(c10.q);
      expect(c50?.r).toBe(c10.r);
      expect(c50?.terrain).toBe(c10.terrain);
    }
  });
});
