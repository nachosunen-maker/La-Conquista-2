import {
  armyMarchMultiplier,
  canClaimTerritory,
  chooseHomeCell,
  fatigueMultiplier,
  generateWorldCells,
  hexDistance,
  hexLine,
  hexNeighbors,
  pathTerrainMultiplier,
  marchFatigue,
  marchTimeSeconds,
  parseCellId,
  recoverFatigue,
  terrainForCell,
} from "./territoryRules";
import { MAP } from "./balanceConfig";

export interface TerritoryTestResult {
  test: string;
  passed: boolean;
  details: string;
}

export function runTerritoryValidationTests(): TerritoryTestResult[] {
  const world = generateWorldCells();
  const worldAgain = generateWorldCells();
  const ids = new Set(world.map((cell) => cell.cellId));
  const terrainCounts: Record<string, number> = {};
  for (const cell of world) terrainCounts[cell.terrain] = (terrainCounts[cell.terrain] ?? 0) + 1;
  const coastOnlyAtEdge = world.every((cell) => cell.terrain !== "costa" || hexDistance(cell, { q: 0, r: 0 }) === MAP.RADIUS);

  const d1 = hexDistance({ q: 0, r: 0 }, { q: 3, r: -1 });
  const d2 = hexDistance({ q: -2, r: 5 }, { q: 4, r: -3 });
  const neighborsCenter = hexNeighbors({ q: 0, r: 0 });
  const neighborsEdge = hexNeighbors({ q: MAP.RADIUS, r: 0 });

  const first = chooseHomeCell(world, new Set(), []);
  const second = chooseHomeCell(world, new Set([first!.cellId]), [first!]);
  const secondDistance = second ? hexDistance(second, first!) : -1;
  const secondAgain = chooseHomeCell(worldAgain, new Set([first!.cellId]), [first!]);

  const claimNoPending = canClaimTerritory({ target: { ...world[0], ownerKingdomId: null }, ownedCells: [{ q: 0, r: 0 }], pendingClaims: 0 });
  const nearFree = world.find((cell) => hexDistance(cell, { q: 0, r: 0 }) === 2)!;
  const farFree = world.find((cell) => hexDistance(cell, { q: 0, r: 0 }) === 5)!;
  const claimNear = canClaimTerritory({ target: { ...nearFree, ownerKingdomId: null }, ownedCells: [{ q: 0, r: 0 }], pendingClaims: 1 });
  const claimFar = canClaimTerritory({ target: { ...farFree, ownerKingdomId: null }, ownedCells: [{ q: 0, r: 0 }], pendingClaims: 1 });
  const claimOwned = canClaimTerritory({ target: { ...nearFree, ownerKingdomId: "otro" }, ownedCells: [{ q: 0, r: 0 }], pendingClaims: 1 });

  const marchInfantry = marchTimeSeconds(4, 1, armyMarchMultiplier({ infanteria: 100 }));
  const marchSiege = marchTimeSeconds(4, 1, armyMarchMultiplier({ infanteria: 100, asedio: 2 }));
  const fatigueAfter = marchFatigue(10, 4, 1);
  const fatigueCapped = marchFatigue(99, 4, 1);
  const multipliers = [0, 10, 11, 25, 26, 40, 41, 60, 61, 75, 76, 90, 91, 100].map(fatigueMultiplier);
  const recoveredNormal = recoverFatigue(50, 2, "normal");
  const recoveredMinima = recoverFatigue(50, 2, "minima");

  // R-14: línea hexagonal y media del terreno del camino
  const line = hexLine({ q: 0, r: 0 }, { q: 3, r: -1 });
  const lineOk = line.length === 3 && line.every((c, i) => hexDistance({ q: 0, r: 0 }, c) === i + 1) && line[2].q === 3 && line[2].r === -1;
  const terrainMap = new Map<string, string>([["1,0", "llanura"], ["2,-1", "montana"], ["3,-1", "bosque"]]);
  const allOnes = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 3, r: -1 }, terrainMap);
  const weighted = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 2, r: 0 }, new Map([["1,0", "x"], ["2,0", "y"]]));
  const zero = pathTerrainMultiplier({ q: 2, r: 2 }, { q: 2, r: 2 }, terrainMap);

  return [
    {
      test: "R-14 (decisión 23-10-2026): la marcha usa la media del terreno de las celdas del camino (origen excluido, destino incluido); con los valores vigentes (1,0) no cambia nada",
      passed: lineOk && allOnes === 1 && weighted === 1 && zero === 1 && hexLine({ q: 1, r: 1 }, { q: 1, r: 1 }).length === 0,
      details: `Línea (0,0)→(3,-1): ${line.map((c) => `${c.q},${c.r}`).join(" ")}; media con TERRAINS vigentes: ${allOnes}; distancia 0: ${zero}`,
    },
    {
      test: "Mundo hexagonal de radio 10 con 331 celdas únicas y terreno reproducible por semilla (D-23, D-25)",
      passed: world.length === 331 && ids.size === 331 && world.every((cell, index) => cell.terrain === worldAgain[index].terrain) &&
        terrainForCell(3, -2) === terrainForCell(3, -2) && coastOnlyAtEdge && Object.keys(terrainCounts).length >= 5 &&
        parseCellId("-3,7")?.q === -3 && parseCellId("x") === null,
      details: `Celdas ${world.length}; terrenos: ${Object.entries(terrainCounts).map(([k, n]) => `${k}=${n}`).join(", ")}`,
    },
    {
      test: "Distancia axial (D-26) y vecindad: 6 vecinos en el interior, menos en el borde",
      passed: d1 === 3 && d2 === 8 && neighborsCenter.length === 6 && neighborsEdge.length === 3,
      details: `d((0,0),(3,-1))=${d1}; d((-2,5),(4,-3))=${d2}; vecinos centro ${neighborsCenter.length}, borde ${neighborsEdge.length}`,
    },
    {
      test: "Territorio principal: el primer reino ocupa el centro y el segundo se sitúa lo más lejos posible, de forma determinista",
      passed: first?.cellId === "0,0" && secondDistance === MAP.RADIUS && second?.cellId === secondAgain?.cellId,
      details: `Primero ${first?.cellId}; segundo ${second?.cellId} a distancia ${secondDistance}`,
    },
    {
      test: "Reclamación de territorio libre cercano (P47-P49): exige reclamación pendiente, celda libre y distancia ≤ 2",
      passed: !claimNoPending.success && claimNear.success && !claimFar.success && !claimOwned.success,
      details: `Sin reclamación: ${!claimNoPending.success}; cercana: ${claimNear.success}; lejana: ${!claimFar.success}; ocupada: ${!claimOwned.success}`,
    },
    {
      test: "Marcha (P41): 1.800 s por hexágono a la velocidad del más lento; asedio ×1,5",
      passed: marchInfantry === 7_200 && marchSiege === 10_800,
      details: `Infantería 4 hex: ${marchInfantry}s; con asedio: ${marchSiege}s`,
    },
    {
      test: "Fatiga (P32): +2 por hexágono con tope 100, tabla de penalización y recuperación de 10/día solo con ración normal o mejor",
      passed: fatigueAfter === 18 && fatigueCapped === 100 &&
        multipliers.join(",") === "1,1,0.97,0.97,0.92,0.92,0.85,0.85,0.75,0.75,0.6,0.6,0.45,0.45" &&
        recoveredNormal === 30 && recoveredMinima === 50,
      details: `Fatiga tras 4 hex: ${fatigueAfter}; tope: ${fatigueCapped}; multiplicadores: ${multipliers.join(",")}; recuperación normal/mínima: ${recoveredNormal}/${recoveredMinima}`,
    },
  ];
}
