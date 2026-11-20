import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { CIVILIZATION_ZONES, MAP } from "./balanceConfig";
import {
  analyzeWorldSpawnGeometry,
  auditExistingKingdomSpawns,
  cellId,
  chooseHomeCellWithDiagnostics,
  generateWorldCells,
  hexDistance,
  optimizeKingdomDistribution,
  verifyCivilizationAnchors,
} from "./territoryRules";
import {
  buildKnownColumnQueries,
  executeBoundedColumnQueries,
  MAX_CONCURRENT_TERRITORY_QUERIES,
  MAX_MAP_COLUMN_QUERIES,
  MAX_THEORETICAL_DOCS_WITH_SENTINEL,
} from "./territories";
import {
  BASE_HEX_SIZE,
  createCapitalCenteredCamera,
  zoomCameraAtPoint,
} from "../src/map/hexMath";
import { MedievalMapRenderer, type MapRenderInput, type RenderableMapCell } from "../src/map/mapRenderer";
import { MANDATORY_BROWSER_SCENARIOS, sortedPercentile } from "../src/map/browserBenchmarkHarness";

const modules = import.meta.glob("./**/*.ts");

function identity(subject: string) {
  return { subject, tokenIdentifier: `perf|${subject}`, name: subject };
}

function createHeadlessCanvas() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  const ctx: any = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "butt", globalAlpha: 1, font: "", textAlign: "left", textBaseline: "alphabetic",
    save: noop, restore: noop, setTransform: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, ellipse: noop, quadraticCurveTo: noop, bezierCurveTo: noop, fill: noop, stroke: noop, clip: noop,
    fillRect: noop, strokeRect: noop, drawImage: noop, setLineDash: noop, strokeText: noop, fillText: noop,
    createLinearGradient: () => grad, createRadialGradient: () => grad,
  };
  const canvas: any = {
    width: 0, height: 0, style: { width: "", height: "" },
    getContext: () => ctx,
  };
  return { canvas: canvas as HTMLCanvasElement, ctx };
}

function buildSyntheticVisibleCells(
  knownCount: number,
  expeditionCount: number,
  progressOverride?: number
): RenderableMapCell[] {
  const all = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
  all.sort((a, b) => hexDistance(a, { q: 0, r: 0 }) - hexDistance(b, { q: 0, r: 0 }));

  const cells: RenderableMapCell[] = [];
  for (let i = 0; i < Math.min(knownCount, all.length); i++) {
    const c = all[i];
    const isHome = i === 0;
    const isOwned = i < 15;
    const hasExp = i >= 15 && i < 15 + expeditionCount;
    cells.push({
      cellId: c.cellId,
      q: c.q,
      r: c.r,
      terrain: hasExp ? "desconocido" : c.terrain,
      ownerKingdomId: isOwned ? "k-player" : i % 37 === 0 ? "k-rival" : null,
      ownerName: isOwned ? "Reino Propio" : i % 37 === 0 ? "Reino Rival" : null,
      ownerColor: isOwned ? "#d4af37" : i % 37 === 0 ? "#dc2626" : null,
      isHome,
      state: isOwned ? "owned" : hasExp ? "exploring" : "explored",
      canExplore: false,
      canConquer: false,
      explorationPlan: null,
      expedition: hasExp
        ? {
            expeditionId: `exp-${i}`,
            progressPercent: progressOverride ?? ((i * 17) % 100),
            completesAt: Date.now() + 60_000,
            durationMs: 120_000,
            distance: hexDistance({ q: 0, r: 0 }, c),
            isSpyMission: i % 3 === 0,
          }
        : null,
    });
  }
  return cells;
}

describe("Bloque 1 — Convex: consultas agrupadas por columna axial q, coste acotado (<=101) y concurrencia (<=8)", () => {
  const allCells = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
  const byContiguous = [...allCells].sort((a, b) => hexDistance(a, { q: 0, r: 0 }) - hexDistance(b, { q: 0, r: 0 }));
  // Índice simulado del mundo completo por columna q para verificar documentos recuperados vs descartados
  const worldByQ = new Map<number, typeof allCells>();
  for (const c of allCells) {
    let col = worldByQ.get(c.q);
    if (!col) {
      col = [];
      worldByQ.set(c.q, col);
    }
    col.push(c);
  }
  for (const col of worldByQ.values()) {
    col.sort((a, b) => a.r - b.r);
  }

  /** Selecciona N celdas máximamente dispersas en todo el disco (paso primo coprimo con 7.651). */
  function pickDispersed(count: number) {
    const picked: typeof allCells = [];
    const stride = 769; // primo grande -> máxima dispersión axial en columnas y filas
    let idx = 0;
    const seen = new Set<string>();
    while (picked.length < Math.min(count, allCells.length)) {
      const c = allCells[idx % allCells.length];
      if (!seen.has(c.cellId)) {
        seen.add(c.cellId);
        picked.push(c);
      }
      idx += stride;
    }
    return picked;
  }

  test("Invarianza por columna: añadir territorios dentro de una misma columna q (central, extrema o fragmentada) NO aumenta el número de consultas", () => {
    // Columna central q = 0 (n(0) = 101) con intervalos fuertemente fragmentados
    const fragmentedCenter: string[] = [];
    for (let r = -50; r <= 50; r += 5) fragmentedCenter.push(cellId(0, r));
    const planFrag1 = buildKnownColumnQueries(fragmentedCenter.slice(0, 3), new Set(), MAP.RADIUS);
    const planFragAll = buildKnownColumnQueries(fragmentedCenter, new Set(), MAP.RADIUS);
    expect(planFrag1.columns.length).toBe(1);
    expect(planFragAll.columns.length).toBe(1);
    expect(planFragAll.columns[0]).toMatchObject({ q: 0, rMin: -50, rMax: 50, targetCount: fragmentedCenter.length });

    // Columnas extremas q = -50 (r ∈ [0, 50], n(-50) = 51) y q = 50 (r ∈ [-50, 0], n(50) = 51)
    const extremes = [
      cellId(-50, 0), cellId(-50, 25), cellId(-50, 50),
      cellId(50, -50), cellId(50, -25), cellId(50, 0),
    ];
    const planExt = buildKnownColumnQueries(extremes, new Set(), MAP.RADIUS);
    expect(planExt.columns.length).toBe(2);
    expect(planExt.geometricColumnUpperBound).toBe(51 + 51);
  });

  test("Validación estricta de coordenadas inválidas y deduplicación", () => {
    const noisy = [
      "0,0", "0,0", "0,1", "0,1",
      "51,0", "-51,0", "30,30", "-30,-30", "invalid", "", "NaN,5",
      "-50,50", "50,-50",
    ];
    const plan = buildKnownColumnQueries(noisy, new Set(["0,0"]), MAP.RADIUS);
    expect(plan.validUniqueKnownCount).toBe(4); // 0,0 ; 0,1 ; -50,50 ; 50,-50
    expect(plan.missingTargetCount).toBe(3); // excluye 0,0 ya cargada
    expect(plan.invalidOrDuplicateSkipped).toBe(9);
    expect(plan.columns.map((c) => c.q)).toEqual([-50, 0, 50]);
  });

  test("Escenarios obligatorios (10/500 contiguos, 10/500/2000 dispersos adversos, 7651 completo): <=101 consultas, <=8 concurrentes, 0 fugas y métricas exactas", async () => {
    const scenarios = [
      { name: "10_contiguos", cells: byContiguous.slice(0, 10) },
      { name: "10_dispersos", cells: pickDispersed(10) },
      { name: "500_contiguos", cells: byContiguous.slice(0, 500) },
      { name: "500_dispersos", cells: pickDispersed(500) },
      { name: "2000_dispersos", cells: pickDispersed(2000) },
      { name: "7651_completo", cells: allCells },
    ];

    const summaryTable: Array<Record<string, number | string>> = [];

    for (const sc of scenarios) {
      const knownSet = new Set(sc.cells.map((c) => c.cellId));
      const alreadyLoaded = new Set<string>([sc.cells[0].cellId]);
      const plan = buildKnownColumnQueries(knownSet, alreadyLoaded, MAP.RADIUS);

      // Límites matemáticos estrictos
      expect(plan.columns.length).toBeLessThanOrEqual(MAX_MAP_COLUMN_QUERIES);
      expect(plan.columns.length).toBeLessThanOrEqual(101);
      expect(plan.geometricColumnUpperBound).toBeLessThanOrEqual(7651);

      const { docs, metrics } = await executeBoundedColumnQueries(
        plan.columns,
        knownSet,
        alreadyLoaded,
        async (col) => {
          // Simula retardo asíncrono real para validar que inFlight jamás supera 8
          await Promise.resolve();
          const colDocs = worldByQ.get(col.q) ?? [];
          return colDocs.filter((d) => d.r >= col.rMin && d.r <= col.rMax);
        },
        MAX_CONCURRENT_TERRITORY_QUERIES
      );

      // Verificaciones obligatorias
      expect(metrics.indexedQueriesCount).toBe(plan.columns.length);
      expect(metrics.indexedQueriesCount).toBeLessThanOrEqual(101);
      expect(metrics.maxObservedConcurrency).toBeLessThanOrEqual(8);
      expect(metrics.docsAcceptedCount).toBe(sc.cells.length - alreadyLoaded.size);
      expect(docs.length).toBe(sc.cells.length - alreadyLoaded.size);
      expect(metrics.docsRetrievedCount).toBe(metrics.docsAcceptedCount + metrics.docsDiscardedCount);

      // 0 duplicados y 0 filtraciones de celdas fuera de knownSet
      const returnedSet = new Set<string>();
      for (const d of docs) {
        expect(knownSet.has(d.cellId)).toBe(true);
        expect(alreadyLoaded.has(d.cellId)).toBe(false);
        expect(returnedSet.has(d.cellId)).toBe(false);
        returnedSet.add(d.cellId);
      }

      summaryTable.push({
        scenario: sc.name,
        queries: metrics.indexedQueriesCount,
        retrieved: metrics.docsRetrievedCount,
        discarded: metrics.docsDiscardedCount,
        accepted: metrics.docsAcceptedCount,
        maxConcurrency: metrics.maxObservedConcurrency,
        upperBoundDocs: plan.geometricColumnUpperBound,
        elapsedMs: Number(metrics.elapsedMs.toFixed(3)),
      });
    }

    console.info("[Bloque 1 — Escenarios obligatorios]", JSON.stringify(summaryTable));

    // Verificar cota exacta en el mapa completo (7.651): 101 columnas y suma geométrica 7.651
    const fullRow = summaryTable.find((r) => r.scenario === "7651_completo")!;
    expect(fullRow.queries).toBe(101);
    expect(fullRow.upperBoundDocs).toBe(7651);
    expect(fullRow.maxConcurrency).toBe(8);
  });

  test("Fallo controlado: si falla una consulta de un lote, nunca devuelve resultados parciales como completos", async () => {
    const dispersed = pickDispersed(25);
    const knownSet = new Set(dispersed.map((c) => c.cellId));
    const plan = buildKnownColumnQueries(knownSet, new Set(), MAP.RADIUS);
    expect(plan.columns.length).toBeGreaterThan(8);

    let callNum = 0;
    await expect(
      executeBoundedColumnQueries(
        plan.columns,
        knownSet,
        new Set(),
        async (col) => {
          callNum++;
          if (callNum === 10) {
            throw new Error(`Fallo simulado en columna q=${col.q}`);
          }
          return [];
        },
        8
      )
    ).rejects.toThrow(/Fallo simulado/i);
  });

  test("Integración Convex real con territorios dispersos y fragmentados: recuperación completa, propietarios exactos y 0 fugas de niebla", async () => {
    const t = convexTest(schema, modules);
    const userA = t.withIdentity(identity("col-user-a"));
    const userB = t.withIdentity(identity("col-user-b"));

    const kingdomA = await userA.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino Disperso",
      civilization: "romanos",
      castleName: "Alcázar",
      monarchName: "Marco",
    });
    const kingdomB = await userB.mutation(api.economy.getOrInitializeKingdom, {
      name: "Imperio Oculto",
      civilization: "vikingos",
      castleName: "Fuerte",
      monarchName: "Olaf",
    });

    // Columna q = 0 fragmentada: A conoce (0, -40) y (0, 40), pero NO conoce (0, 0) ni (0, 10)
    // En la columna q = 0, el rango [rMin=-40, rMax=40] incluye (0, 10) en BD -> el servidor DEBE descartarla.
    const knownRivalCell = { q: 0, r: 40, cellId: "0,40", terrain: "llanura" };
    const knownNeutralCell = { q: 0, r: -40, cellId: "0,-40", terrain: "bosque" };
    const fogRivalInsideRange = { q: 0, r: 10, cellId: "0,10", terrain: "colina" };

    await t.run(async (ctx) => {
      for (const c of [knownRivalCell, knownNeutralCell]) {
        await ctx.db.insert("exploredTerritories", {
          kingdomId: kingdomA._id,
          cellId: c.cellId,
          discoveredAt: Date.now(),
        });
      }
      // Insertar territorio rival conocido en (0, 40)
      const ex1 = await ctx.db.query("territories").withIndex("by_cell", (q) => q.eq("cellId", knownRivalCell.cellId)).first();
      if (!ex1) {
        await ctx.db.insert("territories", { ...knownRivalCell, ownerKingdomId: kingdomB._id });
      }
      // Insertar territorio rival BAJO NIEBLA justo en medio del rango [rMin=-40, rMax=40] de la misma columna q=0
      const ex2 = await ctx.db.query("territories").withIndex("by_cell", (q) => q.eq("cellId", fogRivalInsideRange.cellId)).first();
      if (!ex2) {
        await ctx.db.insert("territories", { ...fogRivalInsideRange, ownerKingdomId: kingdomB._id });
      }
    });

    const compactA = await userA.query(api.territories.getWorldMapCompact, { kingdomId: kingdomA._id });

    // (0, 40) sí es conocida -> debe aparecer con su propietario real
    const visibleRival = compactA.visibleCells.find((c: any) => c.cellId === "0,40");
    expect(visibleRival).toBeDefined();
    expect(visibleRival?.ownerKingdomId).toBe(kingdomB._id);
    expect(visibleRival?.ownerName).toBe("Imperio Oculto");

    // (0, 10) está dentro del rango [rMin, rMax] de la columna q=0 pero BAJO NIEBLA -> JAMÁS debe exponerse
    const leaked = compactA.visibleCells.find((c: any) => c.cellId === "0,10");
    expect(leaked).toBeUndefined();

    // La leyenda de reinos solo contabiliza territorios visibles de Imperio Oculto (1, NO 2)
    const legendB = compactA.kingdomLegend.find((l: any) => l.id === String(kingdomB._id));
    expect(legendB?.territoryCount).toBe(1);

    // Verificar métricas reales devueltas por getWorldMapCompactWithDiagnostics (sin descartarlas)
    const diag = await userA.query(internal.territories.getWorldMapCompactWithDiagnostics, { kingdomId: kingdomA._id });
    expect(diag.metrics.indexedQueriesCount).toBeGreaterThan(0);
    expect(diag.metrics.indexedQueriesCount).toBeLessThanOrEqual(101);
    expect(diag.metrics.maxObservedConcurrency).toBeLessThanOrEqual(8);
    expect(diag.metrics.duplicatesDetected).toBe(0);
    expect(diag.metrics.errors).toEqual([]);
    expect(diag.metrics.docsRetrievedCount).toBe(diag.metrics.docsAcceptedCount + diag.metrics.docsDiscardedCount);
  });

  test("Duplicados e inconsistencias en territories: límite centinela 7651+101=7752, detección y error controlado sin resultados parciales", async () => {
    // 1. Verificar límite teórico con centinela en mapa completo (7.651 + 101 = 7.752)
    expect(MAX_THEORETICAL_DOCS_WITH_SENTINEL).toBe(7752);
    const fullPlan = buildKnownColumnQueries(allCells.map((c) => c.cellId), new Set(), MAP.RADIUS);
    expect(fullPlan.columns.length).toBe(101);
    expect(fullPlan.theoreticalMaxRangeDocs).toBe(7651);
    expect(fullPlan.theoreticalMaxRangeDocsWithSentinel).toBe(7752);

    // 2. Simular documento duplicado en una columna (dispara centinela take(maxRangeSpan + 1))
    const colPlan = buildKnownColumnQueries(["0,0", "0,1"], new Set(), MAP.RADIUS);
    expect(colPlan.columns[0].maxRangeSpan).toBe(2);
    expect(colPlan.columns[0].takeLimit).toBe(3);

    await expect(
      executeBoundedColumnQueries(
        colPlan.columns,
        new Set(["0,0", "0,1"]),
        new Set(),
        async () => [
          { cellId: "0,0", q: 0, r: 0 },
          { cellId: "0,1", q: 0, r: 1 },
          { cellId: "0,1", q: 0, r: 1 }, // centinela (+1) disparado
        ]
      )
    ).rejects.toThrow(/centinela disparado|duplicado/i);

    // 3. Simular incoherencia de cellId vs (q, r)
    await expect(
      executeBoundedColumnQueries(
        colPlan.columns,
        new Set(["0,0", "0,1"]),
        new Set(),
        async () => [{ cellId: "0,99", q: 0, r: 0 }]
      )
    ).rejects.toThrow(/Inconsistencia de coordenadas/i);

    // 4. Integración real en Convex: insertar documento duplicado en BD para una celda explorada -> debe fallar sin devolver parciales
    const t = convexTest(schema, modules);
    const userA = t.withIdentity(identity("dup-user-a"));
    const kingdomA = await userA.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino Centinela",
      civilization: "romanos",
      castleName: "Torre",
      monarchName: "Tito",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("exploredTerritories", {
        kingdomId: kingdomA._id,
        cellId: "5,-5",
        discoveredAt: Date.now(),
      });
      await ctx.db.insert("territories", { cellId: "5,-5", q: 5, r: -5, terrain: "llanura" });
      await ctx.db.insert("territories", { cellId: "5,-5", q: 5, r: -5, terrain: "bosque" });
    });

    await expect(
      userA.query(api.territories.getWorldMapCompact, { kingdomId: kingdomA._id })
    ).rejects.toThrow(/centinela disparado|duplicado/i);
  });
});

describe("Bloque A — Distribución geográfica, anclas, geometría por intersección y auditoría de reinos existentes", () => {
  test("Verificación matemática de las 12 anclas de civilización: válidas, enteras, sin duplicados y distancia mínima 21", () => {
    const check = verifyCivilizationAnchors(MAP.RADIUS);
    expect(check.totalAnchors).toBe(12);
    expect(check.allInsideMap).toBe(true);
    expect(check.allIntegerCoords).toBe(true);
    expect(check.hasDuplicates).toBe(false);
    expect(check.minPairwiseDistance).toBe(21);
    expect(check.isValid).toBe(true);
  });

  test("Análisis geométrico corregido (R=50, d_min=20): disco completo 271, intersección mínima real 100, cota superior conservadora 76 y distribución constructiva verificada", () => {
    const g = analyzeWorldSpawnGeometry(50, 20, 30);
    expect(g.totalCells).toBe(7651);
    expect(g.exclusionDiskRadius).toBe(9);
    expect(g.fullExclusionDiskCells).toBe(271);
    expect(g.minDiskIntersectionCells).toBe(100);
    expect(g.conservativeIntersectionUpperBound).toBe(76);
    expect(g.constructiveVerified).toBe(true);
    expect(g.constructiveMinPairwiseDistance).toBeGreaterThanOrEqual(20);
    expect(g.constructivePlacement.length).toBe(g.constructiveGreedyCountAtMinSeparation);
  });

  test("Asignación de capitales respeta siempre el ancla regional (sin usar el centro por defecto) y prioriza d >= 20", async () => {
    const worldCells = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
    // Primera capital del mundo (romanos) -> debe caer en su ancla (0, 34), NO en (0, 0)
    const first = chooseHomeCellWithDiagnostics(worldCells, new Set(), [], {
      civilization: "romanos",
      existingKingdoms: [],
    });
    expect(first.cell?.q).toBe(CIVILIZATION_ZONES.romanos.q);
    expect(first.cell?.r).toBe(CIVILIZATION_ZONES.romanos.r);
    expect(first.status).toBe("solution_in_target_band");
    expect(first.provenInfeasible).toBe(false);

    // En Convex real (`ensureHomeTerritory`), el primer reino también recibe su ancla regional
    const t = convexTest(schema, modules);
    const user1 = t.withIdentity(identity("anchor-first-user"));
    const k1 = await user1.mutation(api.economy.getOrInitializeKingdom, {
      name: "Roma Prima",
      civilization: "romanos",
      castleName: "Capitolio",
      monarchName: "Rómulo",
    });
    const terr1 = await user1.query(api.territories.getKingdomTerritories, { kingdomId: k1._id });
    expect(terr1.homeTerritoryId).toBe("0,34");

    // Segundo reino de otra civilización (vikingos) recibe su ancla (-34, 0)
    const user2 = t.withIdentity(identity("anchor-second-user"));
    const k2 = await user2.mutation(api.economy.getOrInitializeKingdom, {
      name: "Fiordo Alfa",
      civilization: "vikingos",
      castleName: "Valhalla",
      monarchName: "Bjorn",
    });
    const terr2 = await user2.query(api.territories.getKingdomTerritories, { kingdomId: k2._id });
    expect(terr2.homeTerritoryId).toBe("-34,0");
  });

  test("Optimizador multi-reino determinista separa solución en banda, solo separación mínima e inviabilidad demostrada (N > 76)", () => {
    const reqs12 = Object.keys(CIVILIZATION_ZONES).map((civ, i) => ({
      kingdomId: `k-${String(i).padStart(2, "0")}`,
      civilization: civ,
    }));
    const runA = optimizeKingdomDistribution(reqs12, MAP.RADIUS);
    const runB = optimizeKingdomDistribution(reqs12, MAP.RADIUS);

    // Determinista
    expect(runA.assignments).toEqual(runB.assignments);
    expect(runA.verifiedAllPairwiseDistances).toBe(true);
    expect(runA.allMeetMinSeparation).toBe(true);
    expect(runA.minPairwiseDistance).toBe(21);
    expect(runA.status).toBe("solution_in_target_band");

    // Inviabilidad demostrada cuando N > 76
    const reqs80 = Array.from({ length: 80 }, (_, i) => ({
      kingdomId: `k-${i}`,
      civilization: "romanos",
    }));
    const infeasible = optimizeKingdomDistribution(reqs80, MAP.RADIUS);
    expect(infeasible.status).toBe("proven_infeasible");
    expect(infeasible.upperBoundAtMinSeparation).toBe(76);
  });

  test("Auditoría geográfica de reinos existentes detecta conflictos, bloqueos de integridad y NO modifica la base de datos", async () => {
    const pureAudit = auditExistingKingdomSpawns([
      {
        kingdomId: "k1",
        name: "Roma",
        civilization: "romanos",
        homeTerritoryId: "0,34",
        persistedHomeCell: { cellId: "0,34", q: 0, r: 34, ownerKingdomId: "k1", isHome: true },
        ownedTerritoryCount: 1,
        activeMarchesCount: 0,
        activeChallengesCount: 0,
        activeExplorationsCount: 0,
      },
      {
        kingdomId: "k2",
        name: "Roma Cercana Libre",
        civilization: "romanos",
        homeTerritoryId: "0,30",
        persistedHomeCell: { cellId: "0,30", q: 0, r: 30, ownerKingdomId: "k2", isHome: true },
        ownedTerritoryCount: 1,
        activeMarchesCount: 0,
        activeChallengesCount: 0,
        activeExplorationsCount: 0,
      },
      {
        kingdomId: "k3",
        name: "Roma Cercana Bloqueada",
        civilization: "romanos",
        homeTerritoryId: "1,33",
        persistedHomeCell: { cellId: "1,33", q: 1, r: 33, ownerKingdomId: "k3", isHome: true },
        ownedTerritoryCount: 5,
        activeMarchesCount: 1,
        activeChallengesCount: 0,
        activeExplorationsCount: 0,
      },
    ]);

    expect(pureAudit.readOnlyPlan).toBe(true);
    expect(pureAudit.totalKingdoms).toBe(3);
    expect(pureAudit.kingdomsRequiringRelocation).toBe(3);
    expect(pureAudit.blockedRelocations).toBe(1);
    const blockedEntry = pureAudit.entries.find((e) => e.kingdomId === "k3")!;
    expect(blockedEntry.relocationAction).toBe("blocked");
    expect(blockedEntry.blockedReasons.length).toBeGreaterThanOrEqual(2);

    // Verificar consulta interna de solo lectura en Convex
    const t = convexTest(schema, modules);
    const userA = t.withIdentity(identity("audit-spawn-a"));
    const kA = await userA.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino Auditado",
      civilization: "griegos",
      castleName: "Acrópolis",
      monarchName: "Pericles",
    });
    const beforeHome = (await userA.query(api.territories.getKingdomTerritories, { kingdomId: kA._id })).homeTerritoryId;
    const report = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    const afterHome = (await userA.query(api.territories.getKingdomTerritories, { kingdomId: kA._id })).homeTerritoryId;

    expect(report.readOnlyPlan).toBe(true);
    expect(report.totalKingdoms).toBe(1);
    expect(report.entries[0].coord).toEqual({ q: -34, r: 34 });
    expect(afterHome).toBe(beforeHome); // 0 mutaciones
  });
});

describe("Bloque 2 — Pruebas unitarias simuladas (Canvas headless, NO benchmark gráfico real) y utilidades estadísticas", () => {
  test("Percentiles R-7 sobre muestras ordenadas y catálogo completo de escenarios reales de navegador", () => {
    expect(sortedPercentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(sortedPercentile([10, 20, 30, 40, 50], 0.95)).toBeCloseTo(48, 6);
    expect(sortedPercentile([10, 20, 30, 40, 50], 0.99)).toBeCloseTo(49.6, 6);
    expect(MANDATORY_BROWSER_SCENARIOS.length).toBe(12);
  });

  test("Simulación unitaria (Canvas headless): índice compacto de expediciones (5 / 50 / 200 sobre 7.651 celdas)", () => {
    const { canvas } = createHeadlessCanvas();
    const renderer = new MedievalMapRenderer(canvas, MAP.RADIUS, MAP.WORLD_SEED, () => createHeadlessCanvas().canvas);
    renderer.setViewport(1440, 900, 2);
    renderer.setCamera(createCapitalCenteredCamera({ q: 0, r: 0 }, 1.25, BASE_HEX_SIZE));

    for (const expCount of [5, 50, 200]) {
      renderer.setData({
        radius: MAP.RADIUS,
        worldSeed: MAP.WORLD_SEED,
        kingdomId: "k-player",
        homeTerritoryId: "0,0",
        pendingClaims: 1,
        visibleCells: buildSyntheticVisibleCells(7651, expCount),
        claimableAdjacentIds: new Set(["1,0", "0,1", "-1,1"]),
        activeMarches: [],
      });
      renderer.renderNow();

      const snap = renderer.getPerfSnapshot();
      expect(snap.lastExpeditionsInspected).toBe(expCount);
      expect(snap.lastExpeditionsDrawn).toBeLessThanOrEqual(expCount);
    }

    renderer.destroy();
  });

  test("Simulación unitaria (Canvas headless): selección, hover, progreso de expedición y pan dentro de overscan NO redibujan la capa base", () => {
    const { canvas } = createHeadlessCanvas();
    const renderer = new MedievalMapRenderer(canvas, MAP.RADIUS, MAP.WORLD_SEED, () => createHeadlessCanvas().canvas);
    renderer.setViewport(1440, 900, 2);
    const cam0 = createCapitalCenteredCamera({ q: 0, r: 0 }, 1.25, BASE_HEX_SIZE);
    renderer.setCamera(cam0);

    const baseInput: MapRenderInput = {
      radius: MAP.RADIUS,
      worldSeed: MAP.WORLD_SEED,
      kingdomId: "k-player",
      homeTerritoryId: "0,0",
      pendingClaims: 0,
      visibleCells: buildSyntheticVisibleCells(2000, 50, 25),
      claimableAdjacentIds: new Set(),
      activeMarches: [],
    };
    renderer.setData(baseInput);
    renderer.renderNow();
    const baseAfterInit = renderer.getPerfSnapshot().baseRenderCount;
    expect(baseAfterInit).toBe(1);

    renderer.setSelectedCell(1, 0);
    renderer.renderNow();
    renderer.setHoveredCell(2, -1);
    renderer.renderNow();
    expect(renderer.getPerfSnapshot().baseRenderCount).toBe(baseAfterInit);

    renderer.setData({ ...baseInput, visibleCells: buildSyntheticVisibleCells(2000, 50, 60) });
    renderer.renderNow();
    expect(renderer.getPerfSnapshot().baseRenderCount).toBe(baseAfterInit);

    for (let step = 1; step <= 10; step++) {
      renderer.setCamera({ x: cam0.x + step * 5, y: cam0.y + step * 3, zoom: cam0.zoom });
      renderer.renderNow();
    }
    expect(renderer.getPerfSnapshot().panReuseHitCount).toBe(10);
    expect(renderer.getPerfSnapshot().baseRenderCount).toBe(baseAfterInit);

    const zoomed = zoomCameraAtPoint(renderer.getCamera(), 720, 450, { width: 1440, height: 900 }, 1.8);
    renderer.setCamera(zoomed);
    renderer.renderNow();
    expect(renderer.getPerfSnapshot().baseRenderCount).toBe(baseAfterInit + 1);

    renderer.destroy();
    // Verificar limpieza completa tras destroy(): caché liberada y renderNow() inactivo
    const afterDestroy = renderer.getPerfSnapshot();
    expect(afterDestroy.stampCacheEntries).toBe(0);
    expect(afterDestroy.stampCacheBytes).toBe(0);
    const overlayCountBefore = afterDestroy.overlayRenderCount;
    renderer.renderNow();
    expect(renderer.getPerfSnapshot().overlayRenderCount).toBe(overlayCountBefore);
  });
});
