import { describe, it, expect } from "vitest";
import { generateWorldCells, hexDistance, hexNeighbors, cellId } from "./territoryRules";
import { MAP } from "./balanceConfig";

describe("Auditoría Global y Pruebas del Mapa Ampliado de 7.651 Hexágonos (Bloque A)", () => {
  it("1. Contiene exactamente 7.651 hexágonos únicos con radio 50", () => {
    const cells = generateWorldCells(50, MAP.WORLD_SEED);
    expect(cells).toHaveLength(7651);
    const ids = new Set(cells.map((c) => c.cellId));
    expect(ids.size).toBe(7651);
  });

  it("2. Vecindad hexagonal en las 6 direcciones axiales (q+1,r), (q+1,r-1), (q,r-1), (q-1,r), (q-1,r+1), (q,r+1)", () => {
    const center = { q: 0, r: 0 };
    const neighbors = hexNeighbors(center, 50);
    expect(neighbors).toHaveLength(6);
    const expectedDirs = [
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ];
    for (const ed of expectedDirs) {
      expect(neighbors.some((n) => n.q === ed.q && n.r === ed.r)).toBe(true);
    }
  });

  it("3. Conservación absoluta de los 331 hexágonos originales de radio 10", () => {
    const cells10 = generateWorldCells(10, MAP.WORLD_SEED);
    expect(cells10).toHaveLength(331);

    const cells50 = generateWorldCells(50, MAP.WORLD_SEED);
    const map50 = new Map(cells50.map((c) => [c.cellId, c]));

    for (const c10 of cells10) {
      const match = map50.get(c10.cellId);
      expect(match).toBeDefined();
      expect(match?.q).toBe(c10.q);
      expect(match?.r).toBe(c10.r);
      expect(match?.terrain).toBe(c10.terrain);
    }
  });

  it("4. Integridad de los hexágonos exteriores (ej. radio 35 y radio 50)", () => {
    const cells = generateWorldCells(50, MAP.WORLD_SEED);
    const cellOuter = cells.find((c) => c.q === 35 && c.r === -12);
    expect(cellOuter).toBeDefined();
    expect(hexDistance(cellOuter!, { q: 0, r: 0 })).toBe(35); // <= 50
    expect(cellOuter?.cellId).toBe("35,-12");
  });
});
