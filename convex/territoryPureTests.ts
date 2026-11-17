import {
  analyzeWorldSpawnGeometry,
  armyMarchMultiplier,
  calculateArmyMarchPlan,
  canClaimTerritory,
  chooseHomeCell,
  chooseHomeCellWithDiagnostics,
  fatigueMultiplier,
  generateWorldCells,
  hexDistance,
  hexLine,
  hexNeighbors,
  pathTerrainMultiplier,
  marchFatigue,
  marchTimeSeconds,
  parseCellId,
  planTerritoryCapCleanup,
  recoverFatigue,
  terrainForCell,
} from "./territoryRules";
import { CIVILIZATION_ZONES, MAP, TERRITORIES } from "./balanceConfig";

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
  const coastOnlyAtValidLocations = world.every(
    (cell) =>
      cell.terrain !== "costa" ||
      hexDistance(cell, { q: 0, r: 0 }) === MAP.RADIUS ||
      hexDistance(cell, { q: 0, r: 0 }) === MAP.HISTORICAL_RADIUS
  );
  const historicalWorld = generateWorldCells(MAP.HISTORICAL_RADIUS, MAP.WORLD_SEED);
  const historicalPreserved = historicalWorld.length === 331 && historicalWorld.every((cell) => {
    const exp = world.find((c) => c.cellId === cell.cellId);
    return exp && exp.terrain === cell.terrain && exp.q === cell.q && exp.r === cell.r;
  });

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
  const marchPlan = calculateArmyMarchPlan({
    from: { q: 0, r: 0 },
    to: { q: 4, r: 0 },
    composition: { infanteria: 100 },
    currentFatigue: 10,
    departureTimeMs: 1000,
  });
  const planOk = marchPlan.distance === 4 && marchPlan.durationSeconds === 7_200 && marchPlan.fatigueAccrued === 8 &&
    marchPlan.finalFatigue === 18 && marchPlan.arrivalTimeMs === 7_201_000 && marchPlan.battlePrepWindowSeconds === 1440;
  const fatigueAfter = marchFatigue(10, 4, 1);
  const fatigueCapped = marchFatigue(99, 4, 1);
  const multipliers = [0, 10, 11, 25, 26, 40, 41, 60, 61, 75, 76, 90, 91, 100].map(fatigueMultiplier);
  const recoveredNormal = recoverFatigue(50, 2, "normal");
  const recoveredMinima = recoverFatigue(50, 2, "minima");

  // R-14: línea hexagonal y media del terreno del camino
  const line = hexLine({ q: 0, r: 0 }, { q: 3, r: -1 });
  const lineOk = line.length === 3 && line.every((c, i) => hexDistance({ q: 0, r: 0 }, c) === i + 1) && line[2].q === 3 && line[2].r === -1;
  const terrainMap = new Map<string, string>([["1,0", "llanura"], ["2,-1", "montana"], ["3,-1", "bosque"]]);
  const expectedAverage = Math.round(((1.0 + 1.5 + 1.2) / 3) * 1000) / 1000; // 1.233
  const mixedAverage = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 3, r: -1 }, terrainMap);
  const weighted = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 2, r: 0 }, new Map([["1,0", "x"], ["2,0", "y"]]));
  const zero = pathTerrainMultiplier({ q: 2, r: 2 }, { q: 2, r: 2 }, terrainMap);

  // Pruebas específicas de los 6 terrenos y caminos mixtos (requisitos 5 y 6)
  const singleLlanura = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 1, r: 0 }, { "1,0": "llanura" });
  const singleRio = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 1, r: 0 }, { "1,0": "rio" });
  const singleCosta = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 1, r: 0 }, { "1,0": "costa" });
  const singleBosque = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 1, r: 0 }, { "1,0": "bosque" });
  const singleColina = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 1, r: 0 }, { "1,0": "colina" });
  const singleMontana = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 1, r: 0 }, { "1,0": "montana" });
  const all6TerrainsExact =
    singleLlanura === 1.0 &&
    singleRio === 1.10 &&
    singleCosta === 1.10 &&
    singleBosque === 1.20 &&
    singleColina === 1.25 &&
    singleMontana === 1.50;

  // Caminos mixtos de 4 hexágonos (línea recta (0,0) -> (4,0): celdas "1,0", "2,0", "3,0", "4,0")
  const pathLlanura = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 4, r: 0 }, { "1,0": "llanura", "2,0": "llanura", "3,0": "llanura", "4,0": "llanura" }); // 1.000
  const pathColinas = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 4, r: 0 }, { "1,0": "llanura", "2,0": "llanura", "3,0": "colina", "4,0": "colina" });   // (1+1+1.25+1.25)/4 = 1.125
  const pathVariado = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 4, r: 0 }, { "1,0": "llanura", "2,0": "rio", "3,0": "bosque", "4,0": "montana" });      // (1+1.1+1.2+1.5)/4 = 1.200
  const pathMontanas = pathTerrainMultiplier({ q: 0, r: 0 }, { q: 4, r: 0 }, { "1,0": "montana", "2,0": "montana", "3,0": "montana", "4,0": "montana" }); // 1.500

  // Determinismo: múltiples evaluaciones producen resultados estrictamente idénticos
  const determinismOk =
    pathVariado === 1.200 &&
    pathTerrainMultiplier({ q: 0, r: 0 }, { q: 4, r: 0 }, { "1,0": "llanura", "2,0": "rio", "3,0": "bosque", "4,0": "montana" }) === 1.200 &&
    pathLlanura < pathColinas && pathColinas < pathVariado && pathVariado < pathMontanas;

  // Comportamiento con civilizaciones, asedio, fatiga y límites
  // Caso base: 4 hexágonos en bosque (1.20), infantería, fatiga inicial 10
  const terrainBosque4 = { "1,0": "bosque", "2,0": "bosque", "3,0": "bosque", "4,0": "bosque" };
  const standardMarch = calculateArmyMarchPlan({
    from: { q: 0, r: 0 },
    to: { q: 4, r: 0 },
    composition: { infanteria: 50 },
    currentFatigue: 10,
    departureTimeMs: 0,
    terrainByCell: terrainBosque4,
  });
  // rawSeconds = 1800 * 4 * 1.20 * 1.0 / 1.0 = 8640 s
  // rawFatigue = 2 * 4 * 1.20 * 1.0 = 9.6 -> ceil(9.6) = 10 fatiga
  const standardOk = standardMarch.durationSeconds === 8640 && standardMarch.fatigueAccrued === 10 && standardMarch.finalFatigue === 20;

  // Mongoles: +15 % velocidad de marcha (civSpeed = 1.15), fatiga normal (1.0)
  const mongolesMarch = calculateArmyMarchPlan({
    from: { q: 0, r: 0 },
    to: { q: 4, r: 0 },
    composition: { infanteria: 50 },
    currentFatigue: 10,
    departureTimeMs: 0,
    terrainByCell: terrainBosque4,
    civilizationPassive: { marchSpeedMultiplier: 1.15, fatigueAccrualMultiplier: 1.0 },
  });
  // ceil(8640 / 1.15) = 7514 s; fatiga = 10
  const mongolesOk = mongolesMarch.durationSeconds === 7514 && mongolesMarch.fatigueAccrued === 10 && mongolesMarch.durationSeconds < standardMarch.durationSeconds;

  // Masáis: velocidad normal (1.0), -25 % acumulación de fatiga (civFatigue = 0.75)
  const masaisMarch = calculateArmyMarchPlan({
    from: { q: 0, r: 0 },
    to: { q: 4, r: 0 },
    composition: { infanteria: 50 },
    currentFatigue: 10,
    departureTimeMs: 0,
    terrainByCell: terrainBosque4,
    civilizationPassive: { marchSpeedMultiplier: 1.0, fatigueAccrualMultiplier: 0.75 },
  });
  // durationSeconds = 8640 s; rawFatigue = 2 * 4 * 1.20 * 0.75 = 7.2 -> ceil(7.2) = 8
  const masaisOk = masaisMarch.durationSeconds === 8640 && masaisMarch.fatigueAccrued === 8 && masaisMarch.fatigueAccrued < standardMarch.fatigueAccrued;

  // Asedio: marcha a la velocidad del más lento (marchMultiplier = 1.50)
  const siegeMarch = calculateArmyMarchPlan({
    from: { q: 0, r: 0 },
    to: { q: 2, r: 0 },
    composition: { infanteria: 100, asedio: 2 },
    currentFatigue: 0,
    departureTimeMs: 0,
    terrainMultiplier: 1.50, // montaña
  });
  // rawSeconds = 1800 * 2 * 1.50 * 1.50 = 8100 s; infantería sola sería 1800 * 2 * 1.50 * 1.0 = 5400 s
  const siegeOk = siegeMarch.unitSpeedMultiplier === 1.50 && siegeMarch.slowestUnitType === "asedio" && siegeMarch.durationSeconds === 8100;

  // Límite máximo: 20 hexágonos en montaña (1.50) con asedio (1.50) -> raw = 81.000 s -> acotado a 43.200 s (12 h reales)
  const maxBoundMarch = calculateArmyMarchPlan({
    from: { q: -10, r: 0 },
    to: { q: 10, r: 0 },
    composition: { asedio: 5 },
    currentFatigue: 0,
    departureTimeMs: 0,
    terrainMultiplier: 1.50,
  });
  const maxBoundOk = maxBoundMarch.durationSeconds === 43_200 && maxBoundMarch.maxBoundApplied === true;

  // Límite mínimo: marcha de prueba corta con tiempo raw menor a 900 s acotada a 900 s
  const minBoundTime = marchTimeSeconds(1, 0.4, 1.0); // raw = 720 s -> 900 s
  const minBoundOk = minBoundTime === 900;

  // Fatiga acumulada con tope en 100
  const cappedFatigueMarch = calculateArmyMarchPlan({
    from: { q: 0, r: 0 },
    to: { q: 6, r: 0 },
    composition: { infanteria: 50 },
    currentFatigue: 95,
    departureTimeMs: 0,
    terrainMultiplier: 1.50, // raw fatiga = 2 * 6 * 1.50 = 18
  });
  const cappedFatigueOk = cappedFatigueMarch.fatigueAccrued === 18 && cappedFatigueMarch.finalFatigue === 100;

  return [
    {
      test: "R-14 (decisión 23-10-2026): la marcha usa la media del terreno de las celdas del camino (origen excluido, destino incluido)",
      passed: lineOk && mixedAverage === expectedAverage && weighted === 1 && zero === 1 && hexLine({ q: 1, r: 1 }, { q: 1, r: 1 }).length === 0,
      details: `Línea (0,0)→(3,-1): ${line.map((c) => `${c.q},${c.r}`).join(" ")}; media ponderada mixta: ${mixedAverage} (esperado ${expectedAverage}); distancia 0: ${zero}`,
    },
    {
      test: "Mundo hexagonal ampliado a radio 50 con 7.651 celdas únicas, fórmula N=1+3r(r+1) y conservación de las 331 originales (D-23, D-25)",
      passed: world.length === 7651 && ids.size === 7651 && world.every((cell, index) => cell.terrain === worldAgain[index].terrain) &&
        terrainForCell(3, -2) === terrainForCell(3, -2) && coastOnlyAtValidLocations && historicalPreserved && Object.keys(terrainCounts).length >= 5 &&
        parseCellId("-3,7")?.q === -3 && parseCellId("x") === null,
      details: `Celdas ${world.length}; 331 originales intactas: ${historicalPreserved}; terrenos: ${Object.entries(terrainCounts).map(([k, n]) => `${k}=${n}`).join(", ")}`,
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
      test: "Marcha (P41): 1.800 s por hexágono a la velocidad del más lento; asedio ×1,5 y plan de marcha completo",
      passed: marchInfantry === 7_200 && marchSiege === 10_800 && planOk,
      details: `Infantería 4 hex: ${marchInfantry}s; con asedio: ${marchSiege}s; plan completo: dur=${marchPlan.durationSeconds}s, fatiga=${marchPlan.finalFatigue}, prep=${marchPlan.battlePrepWindowSeconds}s`,
    },
    {
      test: "Fatiga (P32): +2 por hexágono con tope 100, tabla de penalización y recuperación de 10/día solo con ración normal o mejor",
      passed: fatigueAfter === 18 && fatigueCapped === 100 &&
        multipliers.join(",") === "1,1,0.97,0.97,0.92,0.92,0.85,0.85,0.75,0.75,0.6,0.6,0.45,0.45" &&
        recoveredNormal === 30 && recoveredMinima === 50,
      details: `Fatiga tras 4 hex: ${fatigueAfter}; tope: ${fatigueCapped}; multiplicadores: ${multipliers.join(",")}; recuperación normal/mínima: ${recoveredNormal}/${recoveredMinima}`,
    },
    {
      test: "Modificadores de los 6 terrenos canónicos (P41, D-24) y caminos mixtos deterministas",
      passed: all6TerrainsExact && determinismOk && pathLlanura === 1.0 && pathColinas === 1.125 && pathVariado === 1.200 && pathMontanas === 1.500,
      details: `Terrenos: llanura=${singleLlanura}, rio=${singleRio}, costa=${singleCosta}, bosque=${singleBosque}, colina=${singleColina}, montana=${singleMontana}; caminos: llanura=${pathLlanura}, colinas=${pathColinas}, mixto=${pathVariado}, montaña=${pathMontanas}`,
    },
    {
      test: "Interacción completa de marcha con civilizaciones (Mongoles, Masáis), asedio, fatiga y límites",
      passed: standardOk && mongolesOk && masaisOk && siegeOk && maxBoundOk && minBoundOk && cappedFatigueOk,
      details: `Estándar: ${standardMarch.durationSeconds}s / ${standardMarch.fatigueAccrued}f; Mongoles: ${mongolesMarch.durationSeconds}s; Masáis fatiga: ${masaisMarch.fatigueAccrued}f; Asedio 2 hex montaña: ${siegeMarch.durationSeconds}s; Límite máx: ${maxBoundMarch.durationSeconds}s; Límite mín: ${minBoundTime}s; Tope fatiga: ${cappedFatigueMarch.finalFatigue}`,
    },
    ...(() => {
      // Bloque 1.2 & 1.3: Tope de 100 territorios y saneamiento determinista idempotente
      const claimAtCap = canClaimTerritory({
        target: { ...nearFree, ownerKingdomId: null },
        ownedCells: [{ q: 0, r: 0 }],
        pendingClaims: 1,
        ownedCount: TERRITORIES.MAX_PER_KINGDOM,
      });

      const originCell = world.find((c) => c.cellId === "0,0")!;
      const excessCells = [
        originCell,
        ...world.filter((c) => c.cellId !== "0,0" && hexDistance({ q: 0, r: 0 }, c) <= 10).slice(0, 114),
      ].map((c, idx) => ({
        id: `doc_${idx}`,
        cellId: c.cellId,
        q: c.q,
        r: c.r,
        isHome: c.cellId === "0,0",
        claimedAt: 1000 + idx,
      }));
      const cleanupPlan1 = planTerritoryCapCleanup({
        ownedCells: excessCells,
        homeTerritoryId: "0,0",
        maxAllowed: TERRITORIES.MAX_PER_KINGDOM,
      });
      const keptSet = new Set(cleanupPlan1.keptCellIds);
      const maxKeptDist = Math.max(...excessCells.filter((c) => keptSet.has(c.cellId)).map((c) => hexDistance({ q: 0, r: 0 }, c)));
      const minReleasedDist = Math.min(...cleanupPlan1.releasedCells.map((c) => hexDistance({ q: 0, r: 0 }, c)));
      const cleanupPlan2 = planTerritoryCapCleanup({
        ownedCells: excessCells.filter((c) => keptSet.has(c.cellId)),
        homeTerritoryId: "0,0",
        maxAllowed: TERRITORIES.MAX_PER_KINGDOM,
      });

      // Bloque 2.2 & 2.3: Agrupación por civilización, banda [20, 30] y análisis de empaquetamiento
      const rom1 = chooseHomeCellWithDiagnostics(world, new Set(), [], {
        civilization: "romanos",
        existingKingdoms: [],
        preferCenterIfEmpty: false,
      });
      const occupiedSpawns = new Set<string>([rom1.cell!.cellId]);
      const existingSpawns = [{ q: rom1.cell!.q, r: rom1.cell!.r, civilization: "romanos" }];
      const rom2 = chooseHomeCellWithDiagnostics(world, occupiedSpawns, [{ q: rom1.cell!.q, r: rom1.cell!.r }], {
        civilization: "romanos",
        existingKingdoms: existingSpawns,
      });
      const vik1 = chooseHomeCellWithDiagnostics(world, occupiedSpawns, [{ q: rom1.cell!.q, r: rom1.cell!.r }], {
        civilization: "vikingos",
        existingKingdoms: existingSpawns,
      });
      const geometry = analyzeWorldSpawnGeometry(50, 20, 30);

      return [
        {
          test: "Tope de 100 territorios (Bloque 1.2) y planificador de saneamiento determinista e idempotente (Bloque 1.3)",
          passed:
            TERRITORIES.MAX_PER_KINGDOM === 100 &&
            !claimAtCap.success &&
            !cleanupPlan1.skipped &&
            cleanupPlan1.capitalCellId === "0,0" &&
            cleanupPlan1.keptCellIds.length === 100 &&
            cleanupPlan1.releasedCellIds.length === 15 &&
            cleanupPlan1.keptCellIds.includes("0,0") &&
            maxKeptDist <= minReleasedDist &&
            cleanupPlan2.skipped &&
            cleanupPlan2.releasedCellIds.length === 0,
          details: `Rechazo en 100: ${!claimAtCap.success}; saneo 115→${cleanupPlan1.keptCellIds.length} (liberados=${cleanupPlan1.releasedCellIds.length}); maxDistConservada=${maxKeptDist}<=minDistLiberada=${minReleasedDist}; 2ª ejecución idempotente: ${cleanupPlan2.skipped}`,
        },
        {
          test: "Aparición por zonas de civilización, banda [20, 30] hex y prueba matemática de empaquetamiento (Bloques 2.2-2.3)",
          passed:
            Object.keys(CIVILIZATION_ZONES).length === 12 &&
            rom1.cell?.q === CIVILIZATION_ZONES.romanos.q &&
            rom1.cell?.r === CIVILIZATION_ZONES.romanos.r &&
            rom2.withinTargetBand &&
            rom2.nearestDistance !== null &&
            rom2.nearestDistance >= 20 &&
            rom2.nearestDistance <= 30 &&
            vik1.cell !== null &&
            hexDistance(vik1.cell, CIVILIZATION_ZONES.vikingos) < hexDistance(vik1.cell, CIVILIZATION_ZONES.romanos) &&
            geometry.totalCells === 7651 &&
            geometry.diameter === 100 &&
            geometry.exclusiveDiskCellsAtHalfSep === 271 &&
            geometry.areaUpperBoundAtMinSeparation === 28 &&
            geometry.sameCivClusterMaxAtBand30 >= 1 &&
            geometry.greedyPackingMaxAtMinSeparation >= 15,
          details: `Romanos 1 en ${rom1.cell?.cellId}; Romanos 2 a dist=${rom2.nearestDistance} (banda=${rom2.withinTargetBand}); Vikingos cerca de su ancla: ${vik1.cell?.cellId}; cota área d>=20 en R50=${geometry.areaUpperBoundAtMinSeparation}, greedy=${geometry.greedyPackingMaxAtMinSeparation}, clúster diam=30=${geometry.sameCivClusterMaxAtBand30}`,
        },
      ];
    })(),
  ];
}
