import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
    expect(pureAudit.pendingActivityRelocations).toBe(1);
    const pendingEntry = pureAudit.entries.find((e) => e.kingdomId === "k3")!;
    expect(pendingEntry.status).toBe("pending_activity");
    expect(pendingEntry.relocationAction).toBe("pending_activity");
    expect(pendingEntry.pendingActivityReasons.length).toBeGreaterThanOrEqual(1);

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

describe("Redistribución quirúrgica de reinos existentes — 15 pruebas obligatorias", () => {
  const createTestInstance = () => convexTest(schema, modules);
  type TestBackend = ReturnType<typeof createTestInstance>;

  async function createKingdomAt(
    t: TestBackend,
    subject: string,
    name: string,
    civilization: string,
    q: number,
    r: number
  ) {
    const asUser = t.withIdentity(identity(subject));
    const k = await asUser.mutation(api.economy.getOrInitializeKingdom, {
      name,
      civilization,
      castleName: `Castillo ${name}`,
      monarchName: `Monarca ${name}`,
    });
    const targetCellId = `${q},${r}`;
    await t.run(async (ctx) => {
      // Mover manualmente su capital a la posición heredada deseada para simular estado preexistente en BD
      const owned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (qb) => qb.eq("ownerKingdomId", k._id))
        .collect();
      for (const c of owned) {
        await ctx.db.patch(c._id, { ownerKingdomId: undefined, isHome: false, claimedAt: undefined });
      }
      const existingTarget = await ctx.db
        .query("territories")
        .withIndex("by_cell", (qb) => qb.eq("cellId", targetCellId))
        .first();
      if (existingTarget) {
        await ctx.db.patch(existingTarget._id, {
          ownerKingdomId: k._id,
          isHome: true,
          claimedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("territories", {
          cellId: targetCellId,
          q,
          r,
          terrain: "llanura",
          ownerKingdomId: k._id,
          isHome: true,
          claimedAt: Date.now(),
        });
      }
      await ctx.db.patch(k._id, { homeTerritoryId: targetCellId });
    });
    return { asUser, kingdomId: k._id as Id<"kingdoms"> };
  }

  test("1. Reino correctamente situado: no se recoloca", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId } = await createKingdomAt(t, "redist-ok-1", "Roma Fiel", "romanos", 0, 34);
    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit.totalKingdoms).toBe(1);
    expect(audit.correctlyPositionedCount).toBe(1);
    expect(audit.plannedRelocations).toBe(0);
    expect(audit.entries[0].status).toBe("correctly_positioned");
    expect(audit.entries[0].requiresRelocation).toBe(false);

    const applied = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
    });
    expect(applied.relocatedCount).toBe(0);
    expect(applied.alreadyAlignedCount).toBe(1);
    const kDoc = await t.run((ctx) => ctx.db.get(kingdomId));
    expect(kDoc?.homeTerritoryId).toBe("0,34");
  });

  test("2. Reino de civilización incorrecta para su región: se detecta y se recoloca en su región", async () => {
    const t = convexTest(schema, modules);
    // Romanos situado en el centro heredado (0,0) y Vikingos situado en el ancla de Árabes (34,-34)
    const { kingdomId: kRom } = await createKingdomAt(t, "redist-wrong-1", "Roma Perdida", "romanos", 0, 0);
    const { kingdomId: kVik } = await createKingdomAt(t, "redist-wrong-2", "Vikingo Perdido", "vikingos", 34, -34);

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit.kingdomsRequiringRelocation).toBe(2);
    expect(audit.plannedRelocations).toBe(2);
    for (const e of audit.entries) {
      expect(e.matchesCivilizationRegion).toBe(false);
      expect(e.status).toBe("planned");
    }

    const applied = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
    });
    expect(applied.relocatedCount).toBe(2);

    const romDoc = await t.run((ctx) => ctx.db.get(kRom));
    const vikDoc = await t.run((ctx) => ctx.db.get(kVik));
    expect(romDoc?.homeTerritoryId).toBe("0,34");
    expect(vikDoc?.homeTerritoryId).toBe("-34,0");
  });

  test("3. Reino a menos de 20 hexágonos: se detecta y se recoloca respetando d >= 20", async () => {
    const t = convexTest(schema, modules);
    await createKingdomAt(t, "redist-close-1", "Roma I", "romanos", 0, 34);
    await createKingdomAt(t, "redist-close-2", "Roma II", "romanos", 0, 28); // d = 6 < 20

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit.kingdomsRequiringRelocation).toBe(2);
    expect(audit.plannedRelocations).toBe(2);
    expect(audit.entries.every((e) => !e.meetsMinSeparation)).toBe(true);

    const applied = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
    });
    expect(applied.relocatedCount).toBe(2);
    expect(applied.postAuditSummary.correctlyPositionedCount).toBe(2);
    expect(applied.postAuditSummary.plannedRelocations).toBe(0);
  });

  test("4. Reinos de la misma civilización separados por más de 30: se detectan y se agrupan en [20, 30]", async () => {
    const t = convexTest(schema, modules);
    // Dos reinos romanos a distancia 36 (> 30)
    await createKingdomAt(t, "redist-far-1", "Roma Sur", "romanos", 0, 34);
    await createKingdomAt(t, "redist-far-2", "Roma Norte", "romanos", 0, -2); // dist = 36 > 30

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit.kingdomsRequiringRelocation).toBe(2);
    expect(audit.entries.every((e) => e.sameCivGroupedWithinBand === false)).toBe(true);

    const applied = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
    });
    expect(applied.relocatedCount).toBe(2);

    const postAudit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(postAudit.correctlyPositionedCount).toBe(2);
    for (const e of postAudit.entries) {
      expect(e.nearestSameCivDistance).toBeGreaterThanOrEqual(20);
      expect(e.nearestSameCivDistance).toBeLessThanOrEqual(30);
    }
  });

  test("5. Varios reinos de una misma civilización y múltiples civilizaciones: distribución global correcta y determinista", async () => {
    const t = convexTest(schema, modules);
    // 3 romanos + 2 vikingos + 2 ingleses amontonados en el centro
    await createKingdomAt(t, "glob-r1", "Roma 1", "romanos", 0, 0);
    await createKingdomAt(t, "glob-r2", "Roma 2", "romanos", 1, 0);
    await createKingdomAt(t, "glob-r3", "Roma 3", "romanos", 0, 1);
    await createKingdomAt(t, "glob-v1", "Vikingo 1", "vikingos", -1, 0);
    await createKingdomAt(t, "glob-v2", "Vikingo 2", "vikingos", 0, -1);
    await createKingdomAt(t, "glob-i1", "Inglés 1", "ingleses", 1, -1);
    await createKingdomAt(t, "glob-i2", "Inglés 2", "ingleses", -1, 1);

    const audit1 = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    const audit2 = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit1.planFingerprint).toBe(audit2.planFingerprint);
    expect(audit1.entries.map((e) => e.proposedHomeCellId)).toEqual(audit2.entries.map((e) => e.proposedHomeCellId));
    expect(audit1.plannedRelocations).toBe(7);
    expect(audit1.globalPlanVerifiedAllPairwise).toBe(true);
    expect(audit1.globalPlanMinPairwiseDistance).toBeGreaterThanOrEqual(20);

    const applied = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit1.planFingerprint,
    });
    expect(applied.relocatedCount).toBe(7);
    expect(applied.postAuditSummary.correctlyPositionedCount).toBe(7);
    expect(applied.postAuditSummary.plannedRelocations).toBe(0);
  });

  test("6. Reinos con varios territorios: conservación íntegra de la propiedad, recursos, edificios, colas e historial", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId } = await createKingdomAt(t, "redist-multi-1", "Imperio Multi", "romanos", 0, 0);

    // Añadir 4 territorios adicionales, recursos, tecnología y registro de exploración
    await t.run(async (ctx) => {
      for (const [q, r] of [[1, 0], [0, 1], [-1, 1], [-1, 0]] as const) {
        await ctx.db.insert("territories", {
          cellId: `${q},${r}`,
          q,
          r,
          terrain: "bosque",
          ownerKingdomId: kingdomId,
          isHome: false,
          claimedAt: 123456,
        });
      }
      const res = await ctx.db
        .query("resources")
        .withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId))
        .first();
      if (res) await ctx.db.patch(res._id, { gold: 98765, wood: 54321 });
      await ctx.db.insert("technologyProgress", {
        kingdomId,
        technologyId: "agri_1",
        status: "completed",
      });
      await ctx.db.insert("exploredTerritories", {
        kingdomId,
        cellId: "2,0",
        discoveredAt: 111111,
        discoveryNote: "Hallazgo histórico",
      });
    });

    const buildingsBefore = await t.run((ctx) =>
      ctx.db.query("buildings").withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId)).collect()
    );

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit.entries[0].status).toBe("planned"); // NO bloqueado por tener varios territorios

    const applied = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
    });
    expect(applied.relocatedCount).toBe(1);
    expect(applied.outcomes[0].preservedOwnedTerritoriesCount).toBe(5);
    expect(applied.outcomes[0].finalOwnedTerritoriesCount).toBe(6);

    const afterState = await t.run(async (ctx) => {
      const k = await ctx.db.get(kingdomId);
      const owned = await ctx.db.query("territories").withIndex("by_owner", (qb) => qb.eq("ownerKingdomId", kingdomId)).collect();
      const res = await ctx.db.query("resources").withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId)).first();
      const buildings = await ctx.db.query("buildings").withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId)).collect();
      const tech = await ctx.db.query("technologyProgress").withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId)).collect();
      const explored = await ctx.db.query("exploredTerritories").withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId)).collect();
      return { k, owned, res, buildings, tech, explored };
    });

    expect(afterState.k?.homeTerritoryId).toBe("0,34");
    expect(afterState.owned.map((c) => c.cellId)).toEqual(
      expect.arrayContaining(["0,0", "1,0", "0,1", "-1,1", "-1,0", "0,34"])
    );
    expect(afterState.owned.filter((c) => c.isHome)).toHaveLength(1);
    expect(afterState.owned.find((c) => c.isHome)?.cellId).toBe("0,34");
    expect(afterState.res?.gold).toBe(98765);
    expect(afterState.res?.wood).toBe(54321);
    expect(afterState.buildings).toHaveLength(buildingsBefore.length);
    expect(afterState.tech).toHaveLength(1);
    expect(afterState.explored.some((e) => e.cellId === "2,0")).toBe(true);
  });

  test("7. Reino con marcha activa: recolocación pendiente sin modificar datos; al finalizar se puede recolocar", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId } = await createKingdomAt(t, "redist-march-1", "Roma en Campaña", "romanos", 0, 0);

    const marchId = await t.run(async (ctx) =>
      ctx.db.insert("armyMarches", {
        kingdomId,
        targetCellId: "1,0",
        targetQ: 1,
        targetR: 0,
        distance: 1,
        units: [{ unitType: "infanteria", level: 1, count: 10 }],
        startedAt: Date.now(),
        durationMs: 60_000,
        completesAt: Date.now() + 60_000,
        status: "marchando",
      })
    );

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit.pendingActivityRelocations).toBe(1);
    expect(audit.entries[0].status).toBe("pending_activity");

    const appliedPending = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
    });
    expect(appliedPending.relocatedCount).toBe(0);
    expect(appliedPending.pendingActivityCount).toBe(1);

    const kStill = await t.run((ctx) => ctx.db.get(kingdomId));
    const marchStill = await t.run((ctx) => ctx.db.get(marchId));
    expect(kStill?.homeTerritoryId).toBe("0,0");
    expect(marchStill?.status).toBe("marchando");
    expect(marchStill?.targetCellId).toBe("1,0");

    // Cuando la marcha termina, se re-evalúa y se recoloca limpiamente
    await t.run(async (ctx) => ctx.db.patch(marchId, { status: "completada" }));
    const auditAfter = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(auditAfter.plannedRelocations).toBe(1);
    const appliedAfter = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: auditAfter.planFingerprint,
    });
    expect(appliedAfter.relocatedCount).toBe(1);
    const kMoved = await t.run((ctx) => ctx.db.get(kingdomId));
    expect(kMoved?.homeTerritoryId).toBe("0,34");
  });

  test("8. Reino con expedición activa: recolocación pendiente sin modificar datos ni expedición", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId } = await createKingdomAt(t, "redist-exp-1", "Roma Explorando", "romanos", 0, 0);

    const expId = await t.run(async (ctx) =>
      ctx.db.insert("explorationQueue", {
        kingdomId,
        cellId: "2,0",
        targetQ: 2,
        targetR: 0,
        distance: 2,
        startedAt: Date.now(),
        durationMs: 60_000,
        completesAt: Date.now() + 60_000,
        scoutsCount: 1,
        costs: { gold: 30, food: 40 },
      })
    );

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit.pendingActivityRelocations).toBe(1);
    expect(audit.entries[0].status).toBe("pending_activity");

    const applied = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
    });
    expect(applied.relocatedCount).toBe(0);
    expect(applied.pendingActivityCount).toBe(1);

    const kStill = await t.run((ctx) => ctx.db.get(kingdomId));
    const expStill = await t.run((ctx) => ctx.db.get(expId));
    expect(kStill?.homeTerritoryId).toBe("0,0");
    expect(expStill?.cellId).toBe("2,0");
  });

  test("9. Celda de destino ocupada: operación rechazada sin cambios parciales", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId: k1 } = await createKingdomAt(t, "redist-occ-1", "Roma 1", "romanos", 0, 0);
    const { kingdomId: k2 } = await createKingdomAt(t, "redist-occ-2", "Vikingo Dueño", "vikingos", -34, 0);
    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});

    await expect(
      t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
        expectedPlanFingerprint: audit.planFingerprint,
        plannedRelocations: [{ kingdomId: k1, fromCellId: "0,0", toCellId: "-34,0" }],
      })
    ).rejects.toThrow(/ocupada por otro reino/i);

    const k1After = await t.run((ctx) => ctx.db.get(k1));
    const k2After = await t.run((ctx) => ctx.db.get(k2));
    expect(k1After?.homeTerritoryId).toBe("0,0");
    expect(k2After?.homeTerritoryId).toBe("-34,0");
  });

  test("10. Límite de 100 territorios: nunca se supera (reino con 100 conserva 100; reino con >100 se bloquea)", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId: k100 } = await createKingdomAt(t, "redist-cap-100", "Imperio 100", "romanos", 0, 0);

    // Añadir 99 territorios adicionales -> exactamente 100
    await t.run(async (ctx) => {
      const world = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
      let added = 0;
      for (const c of world) {
        if (c.cellId === "0,0" || c.cellId === "0,34") continue;
        await ctx.db.insert("territories", {
          cellId: c.cellId,
          q: c.q,
          r: c.r,
          terrain: c.terrain,
          ownerKingdomId: k100,
          isHome: false,
          claimedAt: 1000,
        });
        added++;
        if (added === 99) break;
      }
    });

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit.entries[0].status).toBe("planned");

    const applied = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
    });
    expect(applied.relocatedCount).toBe(1);
    expect(applied.outcomes[0].finalOwnedTerritoriesCount).toBe(100);

    const ownedAfter = await t.run((ctx) =>
      ctx.db.query("territories").withIndex("by_owner", (qb) => qb.eq("ownerKingdomId", k100)).collect()
    );
    expect(ownedAfter).toHaveLength(100);
    expect(ownedAfter.filter((c) => c.isHome)).toHaveLength(1);
    expect(ownedAfter.find((c) => c.isHome)?.cellId).toBe("0,34");

    // Un reino que ya supera 100 territorios se marca blocked_integrity
    const overCapAudit = auditExistingKingdomSpawns([
      {
        kingdomId: "k-over",
        name: "Excedido",
        civilization: "romanos",
        homeTerritoryId: "0,0",
        persistedHomeCell: { cellId: "0,0", q: 0, r: 0, ownerKingdomId: "k-over", isHome: true },
        ownedTerritoryCount: 101,
        markedHomeCount: 1,
        activeMarchesCount: 0,
        activeChallengesCount: 0,
        activeExplorationsCount: 0,
      },
    ]);
    expect(overCapAudit.entries[0].status).toBe("blocked_integrity");
    expect(overCapAudit.blockedIntegrityRelocations).toBe(1);
  });

  test("11. Fallo durante la operación: rollback íntegro sin modificaciones parciales", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId: k1 } = await createKingdomAt(t, "redist-rb-1", "Roma Válida", "romanos", 0, 0);
    const { kingdomId: k2 } = await createKingdomAt(t, "redist-rb-2", "Vikingo Fallido", "vikingos", 1, 0);
    const { kingdomId: k3 } = await createKingdomAt(t, "redist-rb-3", "Inglés Ocupante", "ingleses", 34, 0);
    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});

    // k1 tiene destino válido (0,34), pero k2 intenta moverse a (34,0) ocupado por k3 -> toda la mutación falla y hace rollback
    await expect(
      t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
        expectedPlanFingerprint: audit.planFingerprint,
        plannedRelocations: [
          { kingdomId: k1, fromCellId: "0,0", toCellId: "0,34" },
          { kingdomId: k2, fromCellId: "1,0", toCellId: "34,0" },
        ],
      })
    ).rejects.toThrow(/ocupada por otro reino/i);

    // Verificar que k1 NO cambió nada (rollback íntegro)
    const [k1Doc, k2Doc, k3Doc, cell034] = await t.run(async (ctx) => [
      await ctx.db.get(k1),
      await ctx.db.get(k2),
      await ctx.db.get(k3),
      await ctx.db.query("territories").withIndex("by_cell", (qb) => qb.eq("cellId", "0,34")).first(),
    ]);
    expect(k1Doc?.homeTerritoryId).toBe("0,0");
    expect(k2Doc?.homeTerritoryId).toBe("1,0");
    expect(k3Doc?.homeTerritoryId).toBe("34,0");
    expect(cell034?.ownerKingdomId).toBeUndefined();
  });

  test("12. Repetición de la operación (idempotencia): no duplica territorios ni altera resultados", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId: k1 } = await createKingdomAt(t, "redist-idem-1", "Roma Idem", "romanos", 0, 0);
    const { kingdomId: k2 } = await createKingdomAt(t, "redist-idem-2", "Griegos Idem", "griegos", 1, 0);

    const audit1 = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    const first = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit1.planFingerprint,
    });
    expect(first.relocatedCount).toBe(2);

    const snapshotAfterFirst = await t.run(async (ctx) => ({
      k1: (await ctx.db.get(k1))?.homeTerritoryId,
      k2: (await ctx.db.get(k2))?.homeTerritoryId,
      terrCount: (await ctx.db.query("territories").collect()).length,
    }));

    const second = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: first.newPlanFingerprint,
    });
    expect(second.relocatedCount).toBe(0);
    expect(second.alreadyAlignedCount).toBe(2);

    const snapshotAfterSecond = await t.run(async (ctx) => ({
      k1: (await ctx.db.get(k1))?.homeTerritoryId,
      k2: (await ctx.db.get(k2))?.homeTerritoryId,
      terrCount: (await ctx.db.query("territories").collect()).length,
    }));

    expect(snapshotAfterSecond).toEqual(snapshotAfterFirst);
  });

  test("13. Datos modificados después de la simulación: el plan antiguo se rechaza por huella desactualizada", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId } = await createKingdomAt(t, "redist-stale-1", "Roma Stale", "romanos", 0, 0);

    const simulation = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(simulation.plannedRelocations).toBe(1);

    // Modificar datos en BD después de la simulación (p. ej. aparece otro reino o cambia una marcha)
    await createKingdomAt(t, "redist-stale-2", "Nuevo Reino", "vikingos", -34, 0);

    await expect(
      t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
        expectedPlanFingerprint: simulation.planFingerprint,
      })
    ).rejects.toThrow(/Plan desactualizado/i);

    const kDoc = await t.run((ctx) => ctx.db.get(kingdomId));
    expect(kDoc?.homeTerritoryId).toBe("0,0");
  });

  test("14. Distribución completa multi-civilización: todas las distancias por parejas verificadas matemáticamente", async () => {
    const t = convexTest(schema, modules);
    const setup: Array<[string, string, number, number]> = [
      ["k-rom-1", "romanos", 0, 0],
      ["k-rom-2", "romanos", 1, 0],
      ["k-vik-1", "vikingos", 0, 1],
      ["k-vik-2", "vikingos", -1, 1],
      ["k-ing-1", "ingleses", -1, 0],
      ["k-gri-1", "griegos", 0, -1],
      ["k-ara-1", "arabes", 1, -1],
      ["k-chi-1", "chinos", 2, 0],
    ];
    for (const [id, civ, q, r] of setup) {
      await createKingdomAt(t, id, `Reino ${id}`, civ, q, r);
    }

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit.plannedRelocations).toBe(8);

    // Ejecutar en lotes controlados de 4 hasta completar la convergencia global
    const batch1 = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
      batchSize: 4,
    });
    expect(batch1.relocatedCount).toBe(4);
    expect(batch1.deferredBatchCount).toBe(4);

    let lastFingerprint = batch1.newPlanFingerprint;
    let remaining = batch1.remainingPlannedCount;
    let extraBatches = 0;
    while (remaining > 0 && extraBatches < 3) {
      const next = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
        expectedPlanFingerprint: lastFingerprint,
        batchSize: 4,
      });
      lastFingerprint = next.newPlanFingerprint;
      remaining = next.remainingPlannedCount;
      extraBatches++;
    }
    expect(remaining).toBe(0);
    const finalAudit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(finalAudit.correctlyPositionedCount).toBe(8);
    expect(finalAudit.plannedRelocations).toBe(0);

    // Verificación matemática exhaustiva de TODAS las distancias por parejas en BD real
    const allKingdoms = await t.run((ctx) => ctx.db.query("kingdoms").collect());
    const coords = allKingdoms.map((k) => {
      const [q, r] = k.homeTerritoryId!.split(",").map(Number);
      return { id: String(k._id), civ: k.civilization!, q, r };
    });

    for (let i = 0; i < coords.length; i++) {
      // Dentro de radio 50
      expect(hexDistance(coords[i], { q: 0, r: 0 })).toBeLessThanOrEqual(50);
      let nearestSame = Infinity;
      let sameCount = 0;
      for (let j = 0; j < coords.length; j++) {
        if (i === j) continue;
        const d = hexDistance(coords[i], coords[j]);
        expect(d).toBeGreaterThanOrEqual(20);
        if (coords[i].civ === coords[j].civ) {
          sameCount++;
          if (d < nearestSame) nearestSame = d;
        }
      }
      if (sameCount > 0) {
        expect(nearestSame).toBeGreaterThanOrEqual(20);
        expect(nearestSame).toBeLessThanOrEqual(30);
      }
    }
  });

  test("15. Autorización: un usuario no administrador ni anónimo puede auditar o ejecutar la recolocación; solo un admin autorizado", async () => {
    const prevAdmins = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = "admin-real-01";
    try {
      const t = convexTest(schema, modules);
      await createKingdomAt(t, "normal-player-1", "Jugador Normal", "romanos", 0, 0);

      // Anónimo rechazado
      await expect(t.query(api.territories.auditKingdomSpawnDistribution, {})).rejects.toThrow(/No autorizado/i);
      await expect(t.mutation(api.territories.applyKingdomSpawnRelocation, {})).rejects.toThrow(/No autorizado/i);

      // Usuario normal rechazado
      const normalUser = t.withIdentity(identity("normal-player-1"));
      await expect(normalUser.query(api.territories.auditKingdomSpawnDistribution, {})).rejects.toThrow(/No autorizado/i);
      await expect(normalUser.mutation(api.territories.applyKingdomSpawnRelocation, {})).rejects.toThrow(/No autorizado/i);

      // Cuenta demo rechazada
      const demoUser = t.withIdentity(identity("guest_g9ai8cz"));
      await expect(demoUser.mutation(api.territories.applyKingdomSpawnRelocation, {})).rejects.toThrow(/No autorizado/i);

      // Administrador autorizado puede auditar y ejecutar
      const adminUser = t.withIdentity(identity("admin-real-01"));
      const sim = await adminUser.query(api.territories.auditKingdomSpawnDistribution, {});
      expect(sim.plannedRelocations).toBe(1);
      const exec = await adminUser.mutation(api.territories.applyKingdomSpawnRelocation, {
        expectedPlanFingerprint: sim.planFingerprint,
      });
      expect(exec.relocatedCount).toBe(1);
    } finally {
      if (prevAdmins === undefined) delete process.env.ADMIN_USER_IDS;
      else process.env.ADMIN_USER_IDS = prevAdmins;
    }
  });
});

describe("Validación quirúrgica commit 241686b — 13 pruebas obligatorias", () => {
  const createTypedTest = () => convexTest(schema, modules);
  type TypedTestBackend = ReturnType<typeof createTypedTest>;

  async function createKingdomWithHome(
    t: TypedTestBackend,
    subject: string,
    name: string,
    civilization: string,
    q: number,
    r: number
  ) {
    const asUser = t.withIdentity(identity(subject));
    const k = await asUser.mutation(api.economy.getOrInitializeKingdom, {
      name,
      civilization,
      castleName: `Castillo ${name}`,
      monarchName: `Monarca ${name}`,
    });
    const targetCellId = `${q},${r}`;
    await t.run(async (ctx) => {
      const owned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (qb) => qb.eq("ownerKingdomId", k._id))
        .collect();
      for (const c of owned) {
        await ctx.db.patch(c._id, { ownerKingdomId: undefined, isHome: false, claimedAt: undefined });
      }
      const existingTarget = await ctx.db
        .query("territories")
        .withIndex("by_cell", (qb) => qb.eq("cellId", targetCellId))
        .first();
      if (existingTarget) {
        await ctx.db.patch(existingTarget._id, {
          ownerKingdomId: k._id,
          isHome: true,
          claimedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("territories", {
          cellId: targetCellId,
          q,
          r,
          terrain: "llanura",
          ownerKingdomId: k._id,
          isHome: true,
          claimedAt: Date.now(),
        });
      }
      await ctx.db.patch(k._id, { homeTerritoryId: targetCellId });
    });
    return { asUser, kingdomId: k._id as Id<"kingdoms"> };
  }

  test("1. Rechazo si se intenta aplicar sin expectedPlanFingerprint (ni con cadena vacía)", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId } = await createKingdomWithHome(t, "qfix-1", "Roma Sin Huella", "romanos", 0, 0);

    await expect(
      t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {})
    ).rejects.toThrow(/expectedPlanFingerprint/i);

    await expect(
      t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
        expectedPlanFingerprint: "   ",
        plannedRelocations: [{ kingdomId, fromCellId: "0,0", toCellId: "0,34" }],
      })
    ).rejects.toThrow(/expectedPlanFingerprint/i);

    const kDoc = await t.run((ctx) => ctx.db.get(kingdomId));
    expect(kDoc?.homeTerritoryId).toBe("0,0");
  });

  test("2. Rechazo si expectedPlanFingerprint está desactualizado", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId } = await createKingdomWithHome(t, "qfix-2", "Roma Obsoleta", "romanos", 0, 0);
    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});

    await expect(
      t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
        expectedPlanFingerprint: "00000000deadbeef",
        plannedRelocations: [{ kingdomId, fromCellId: "0,0", toCellId: audit.entries[0].proposedHomeCellId! }],
      })
    ).rejects.toThrow(/Plan desactualizado/i);

    const kDoc = await t.run((ctx) => ctx.db.get(kingdomId));
    expect(kDoc?.homeTerritoryId).toBe("0,0");
  });

  test("3. Rechazo si toCellId difiere de proposedHomeCellId de la auditoría (incluso para admin)", async () => {
    const prevAdmins = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = "admin-qfix-3";
    try {
      const t = convexTest(schema, modules);
      const { kingdomId } = await createKingdomWithHome(t, "qfix-3-usr", "Roma Arbitraria", "romanos", 0, 0);
      const adminUser = t.withIdentity(identity("admin-qfix-3"));

      const audit = await adminUser.query(api.territories.auditKingdomSpawnDistribution, {});
      expect(audit.entries[0].proposedHomeCellId).toBe("0,34");

      // Celda libre "0,33" distinta a proposedHomeCellId ("0,34") debe ser rechazada incluso para admin
      await expect(
        adminUser.mutation(api.territories.applyKingdomSpawnRelocation, {
          expectedPlanFingerprint: audit.planFingerprint,
          plannedRelocations: [{ kingdomId, fromCellId: "0,0", toCellId: "0,33" }],
        })
      ).rejects.toThrow(/no coincide con proposedHomeCellId/i);

      const kDoc = await t.run((ctx) => ctx.db.get(kingdomId));
      expect(kDoc?.homeTerritoryId).toBe("0,0");
    } finally {
      if (prevAdmins === undefined) delete process.env.ADMIN_USER_IDS;
      else process.env.ADMIN_USER_IDS = prevAdmins;
    }
  });

  test("4. Rechazo si el resultado tras el lote viola la separación mínima < 20", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId: k1 } = await createKingdomWithHome(t, "qfix-4a", "Roma Movida", "romanos", 0, 0);
    const { kingdomId: k2 } = await createKingdomWithHome(t, "qfix-4b", "Vikingo Cercano", "vikingos", 0, 25);

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    const e1 = audit.entries.find((e) => e.kingdomId === String(k1))!;
    expect(e1.proposedHomeCellId).toBe("0,34");

    // Ejecutar solo k1 deja a k1 en (0,34) y k2 aún en (0,25): distancia 9 < 20 -> debe rechazarse
    await expect(
      t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
        expectedPlanFingerprint: audit.planFingerprint,
        plannedRelocations: [{ kingdomId: k1, fromCellId: "0,0", toCellId: "0,34" }],
      })
    ).rejects.toThrow(/Separación mínima incumplida tras el lote/i);

    const [k1After, k2After] = await t.run(async (ctx) => [await ctx.db.get(k1), await ctx.db.get(k2)]);
    expect(k1After?.homeTerritoryId).toBe("0,0");
    expect(k2After?.homeTerritoryId).toBe("0,25");
  });

  test("5. Rechazo si existe conflicto entre dos movimientos del mismo lote", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId: k1 } = await createKingdomWithHome(t, "qfix-5a", "Roma Conflicto 1", "romanos", 0, 0);
    const { kingdomId: k2 } = await createKingdomWithHome(t, "qfix-5b", "Roma Conflicto 2", "romanos", 1, 0);

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    const e1 = audit.entries.find((e) => e.kingdomId === String(k1))!;

    // Dos reinos apuntando a la misma celda destino en el mismo lote
    await expect(
      t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
        expectedPlanFingerprint: audit.planFingerprint,
        plannedRelocations: [
          { kingdomId: k1, fromCellId: "0,0", toCellId: e1.proposedHomeCellId! },
          { kingdomId: k2, fromCellId: "1,0", toCellId: e1.proposedHomeCellId! },
        ],
      })
    ).rejects.toThrow(/múltiples reinos apuntan a la misma celda destino/i);

    // Mismo reino duplicado dentro de plannedRelocations
    await expect(
      t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
        expectedPlanFingerprint: audit.planFingerprint,
        plannedRelocations: [
          { kingdomId: k1, fromCellId: "0,0", toCellId: e1.proposedHomeCellId! },
          { kingdomId: k1, fromCellId: "0,0", toCellId: e1.proposedHomeCellId! },
        ],
      })
    ).rejects.toThrow(/duplicado en 'plannedRelocations'/i);
  });

  test("6. Reino con 2..99 territorios reserva su antigua capital en el optimizador y la conserva tras recolocar", async () => {
    const t = convexTest(schema, modules);
    // k1 (vikingos) ocupa el ancla romana (0,34) y tiene además otro territorio (1,33) -> total 2 territorios
    const { kingdomId: k1 } = await createKingdomWithHome(t, "qfix-6a", "Vikingo 2 Terr", "vikingos", 0, 34);
    const { kingdomId: k2 } = await createKingdomWithHome(t, "qfix-6b", "Roma Buscando", "romanos", 0, 0);

    await t.run(async (ctx) => {
      await ctx.db.insert("territories", {
        cellId: "1,33",
        q: 1,
        r: 33,
        terrain: "llanura",
        ownerKingdomId: k1,
        isHome: false,
        claimedAt: 1000,
      });
    });

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    const e1 = audit.entries.find((e) => e.kingdomId === String(k1))!;
    const e2 = audit.entries.find((e) => e.kingdomId === String(k2))!;
    expect(e1.status).toBe("planned");
    expect(e2.status).toBe("planned");
    // Al tener 2 territorios, k1 conserva "0,34" como territorio propio normal -> k2 NO puede recibir "0,34"
    expect(e2.proposedHomeCellId).not.toBe("0,34");

    const applied = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
    });
    expect(applied.relocatedCount).toBe(2);

    const [oldCapDoc, k1Owned, k2Doc] = await t.run(async (ctx) => [
      await ctx.db.query("territories").withIndex("by_cell", (qb) => qb.eq("cellId", "0,34")).first(),
      await ctx.db.query("territories").withIndex("by_owner", (qb) => qb.eq("ownerKingdomId", k1)).collect(),
      await ctx.db.get(k2),
    ]);
    expect(oldCapDoc?.ownerKingdomId).toBe(k1);
    expect(oldCapDoc?.isHome).toBe(false);
    expect(k1Owned).toHaveLength(3);
    expect(k2Doc?.homeTerritoryId).not.toBe("0,34");
  });

  test("7. Reino con 100 territorios libera su antigua capital al sustituirla, conservando los otros 99", async () => {
    const t = convexTest(schema, modules);
    // k100 (vikingos) tiene 100 territorios con capital en "0,34" (ancla de romanos) y se recoloca hacia (-34,0)
    const { kingdomId: k100 } = await createKingdomWithHome(t, "qfix-7", "Vikingo 100", "vikingos", 0, 34);
    await t.run(async (ctx) => {
      const world = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
      let added = 0;
      for (const c of world) {
        if (c.cellId === "0,34" || c.cellId === "-34,0" || hexDistance(c, { q: -34, r: 0 }) <= 3) continue;
        await ctx.db.insert("territories", {
          cellId: c.cellId,
          q: c.q,
          r: c.r,
          terrain: c.terrain,
          ownerKingdomId: k100,
          isHome: false,
          claimedAt: 1000,
        });
        added++;
        if (added === 99) break;
      }
    });

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit.entries[0].proposedHomeCellId).toBe("-34,0");

    const applied = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
    });
    expect(applied.relocatedCount).toBe(1);
    expect(applied.outcomes[0].preservedOwnedTerritoriesCount).toBe(99);
    expect(applied.outcomes[0].finalOwnedTerritoriesCount).toBe(100);

    const [oldCapDoc, ownedAfter] = await t.run(async (ctx) => [
      await ctx.db.query("territories").withIndex("by_cell", (qb) => qb.eq("cellId", "0,34")).first(),
      await ctx.db.query("territories").withIndex("by_owner", (qb) => qb.eq("ownerKingdomId", k100)).collect(),
    ]);
    expect(oldCapDoc?.ownerKingdomId).toBeUndefined();
    expect(oldCapDoc?.isHome).toBe(false);
    expect(ownedAfter).toHaveLength(100);
    expect(ownedAfter.find((c) => c.isHome)?.cellId).toBe("-34,0");
  });

  test("8. Reino con 1 territorio libera limpiamente su antigua capital y permite orden seguro multi-reino", async () => {
    const t = convexTest(schema, modules);
    // k1 (vikingos, 1 territorio en "0,34") libera "0,34" al irse a "-34,0"; k2 (romanos, 1 territorio en "0,0") puede reutilizar "0,34"
    const { kingdomId: k1 } = await createKingdomWithHome(t, "qfix-8a", "Vikingo Uno", "vikingos", 0, 34);
    const { kingdomId: k2 } = await createKingdomWithHome(t, "qfix-8b", "Roma Dos", "romanos", 0, 0);

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    const e1 = audit.entries.find((e) => e.kingdomId === String(k1))!;
    const e2 = audit.entries.find((e) => e.kingdomId === String(k2))!;
    expect(e1.proposedHomeCellId).toBe("-34,0");

    // Ejecutar explícitamente poniendo k2 primero y k1 después si k2 reutiliza "0,34" (orden topológico seguro)
    const applied = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
      plannedRelocations: [
        { kingdomId: k2, fromCellId: "0,0", toCellId: e2.proposedHomeCellId! },
        { kingdomId: k1, fromCellId: "0,34", toCellId: e1.proposedHomeCellId! },
      ],
    });
    expect(applied.relocatedCount).toBe(2);

    const [cell00, k1Owned, k2Owned] = await t.run(async (ctx) => [
      await ctx.db.query("territories").withIndex("by_cell", (qb) => qb.eq("cellId", "0,0")).first(),
      await ctx.db.query("territories").withIndex("by_owner", (qb) => qb.eq("ownerKingdomId", k1)).collect(),
      await ctx.db.query("territories").withIndex("by_owner", (qb) => qb.eq("ownerKingdomId", k2)).collect(),
    ]);
    expect(cell00?.ownerKingdomId).toBeUndefined();
    expect(cell00?.isHome).toBe(false);
    expect(k1Owned).toHaveLength(1);
    expect(k1Owned[0].cellId).toBe("-34,0");
    expect(k2Owned).toHaveLength(1);
    expect(k2Owned[0].cellId).toBe(e2.proposedHomeCellId);
  });

  test("9. Invalidación de huella si cambian las coordenadas de la capital", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId } = await createKingdomWithHome(t, "qfix-9", "Roma Coords", "romanos", 0, 0);
    const auditBefore = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});

    // Cambiar coordenadas de la capital a (1,0)
    await t.run(async (ctx) => {
      const oldHome = await ctx.db.query("territories").withIndex("by_cell", (qb) => qb.eq("cellId", "0,0")).first();
      if (oldHome) await ctx.db.patch(oldHome._id, { ownerKingdomId: undefined, isHome: false });
      await ctx.db.insert("territories", {
        cellId: "1,0",
        q: 1,
        r: 0,
        terrain: "llanura",
        ownerKingdomId: kingdomId,
        isHome: true,
        claimedAt: Date.now(),
      });
      await ctx.db.patch(kingdomId, { homeTerritoryId: "1,0" });
    });

    const auditAfter = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(auditAfter.planFingerprint).not.toBe(auditBefore.planFingerprint);

    await expect(
      t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
        expectedPlanFingerprint: auditBefore.planFingerprint,
      })
    ).rejects.toThrow(/Plan desactualizado/i);
  });

  test("10. Invalidación de huella si cambia el objetivo de una marcha activa (sin cambiar conteo)", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId } = await createKingdomWithHome(t, "qfix-10", "Roma Marcha", "romanos", 0, 0);

    const marchId = await t.run((ctx) =>
      ctx.db.insert("armyMarches", {
        kingdomId,
        targetCellId: "1,0",
        targetQ: 1,
        targetR: 0,
        distance: 1,
        units: [{ unitType: "infanteria", level: 1, count: 5 }],
        startedAt: Date.now(),
        durationMs: 60_000,
        completesAt: Date.now() + 60_000,
        status: "marchando",
      })
    );

    const auditBefore = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(auditBefore.pendingActivityRelocations).toBe(1);

    // Cambiar solo el objetivo de la marcha (de 1,0 a 2,0), manteniendo conteo = 1
    await t.run((ctx) =>
      ctx.db.patch(marchId, {
        targetCellId: "2,0",
        targetQ: 2,
        targetR: 0,
        distance: 2,
      })
    );

    const auditAfter = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(auditAfter.planFingerprint).not.toBe(auditBefore.planFingerprint);

    await expect(
      t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
        expectedPlanFingerprint: auditBefore.planFingerprint,
      })
    ).rejects.toThrow(/Plan desactualizado/i);
  });

  test("11. Invalidación de huella si cambia una expedición activa o un desafío activo (sin cambiar conteo)", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId: k1 } = await createKingdomWithHome(t, "qfix-11a", "Roma Exp", "romanos", 0, 0);
    const { kingdomId: k2 } = await createKingdomWithHome(t, "qfix-11b", "Vikingo Rival", "vikingos", -34, 0);

    const expId = await t.run((ctx) =>
      ctx.db.insert("explorationQueue", {
        kingdomId: k1,
        cellId: "1,0",
        targetQ: 1,
        targetR: 0,
        distance: 1,
        startedAt: Date.now(),
        durationMs: 60_000,
        completesAt: Date.now() + 60_000,
        scoutsCount: 1,
        costs: { gold: 30, food: 40 },
      })
    );
    const challengeId = await t.run((ctx) =>
      ctx.db.insert("challenges", {
        challengerKingdomId: k1,
        targetKingdomId: k2,
        challengeType: "duel",
        status: "PENDING",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      })
    );

    const audit1 = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});

    // Cambiar objetivo de la expedición manteniendo conteo = 1
    await t.run((ctx) =>
      ctx.db.patch(expId, {
        cellId: "3,0",
        targetQ: 3,
        targetR: 0,
      })
    );
    const audit2 = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit2.planFingerprint).not.toBe(audit1.planFingerprint);

    // Cambiar estado activo del desafío (PENDING -> ACCEPTED) manteniendo conteo activo = 1
    await t.run((ctx) =>
      ctx.db.patch(challengeId, {
        status: "ACCEPTED",
      })
    );
    const audit3 = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    expect(audit3.planFingerprint).not.toBe(audit2.planFingerprint);
  });

  test("12. Preservación íntegra de territorios, recursos, edificios, investigaciones y demás datos tras recolocación válida", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId } = await createKingdomWithHome(t, "qfix-12", "Roma Completa", "romanos", 0, 0);

    await t.run(async (ctx) => {
      for (const [q, r] of [[1, 0], [0, 1], [-1, 0]] as const) {
        await ctx.db.insert("territories", {
          cellId: `${q},${r}`,
          q,
          r,
          terrain: "montana",
          ownerKingdomId: kingdomId,
          isHome: false,
          claimedAt: 55555,
        });
      }
      const res = await ctx.db.query("resources").withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId)).first();
      if (res) await ctx.db.patch(res._id, { gold: 77777, food: 66666, stone: 44444 });
      await ctx.db.insert("technologyProgress", {
        kingdomId,
        technologyId: "mil_1",
        status: "completed",
      });
    });

    const beforeBuildings = await t.run((ctx) =>
      ctx.db.query("buildings").withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId)).collect()
    );
    const beforePop = await t.run((ctx) =>
      ctx.db.query("population").withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId)).first()
    );

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    const applied = await t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
      expectedPlanFingerprint: audit.planFingerprint,
      plannedRelocations: [{ kingdomId, fromCellId: "0,0", toCellId: audit.entries[0].proposedHomeCellId! }],
    });
    expect(applied.relocatedCount).toBe(1);
    expect(applied.outcomes[0].preservedOwnedTerritoriesCount).toBe(4);
    expect(applied.outcomes[0].finalOwnedTerritoriesCount).toBe(5);

    const after = await t.run(async (ctx) => ({
      k: await ctx.db.get(kingdomId),
      owned: await ctx.db.query("territories").withIndex("by_owner", (qb) => qb.eq("ownerKingdomId", kingdomId)).collect(),
      res: await ctx.db.query("resources").withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId)).first(),
      buildings: await ctx.db.query("buildings").withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId)).collect(),
      tech: await ctx.db.query("technologyProgress").withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId)).collect(),
      pop: await ctx.db.query("population").withIndex("by_kingdom", (qb) => qb.eq("kingdomId", kingdomId)).first(),
    }));

    expect(after.k?.homeTerritoryId).toBe("0,34");
    expect(after.owned).toHaveLength(5);
    expect(after.owned.map((c) => c.cellId)).toEqual(expect.arrayContaining(["0,0", "1,0", "0,1", "-1,0", "0,34"]));
    expect(after.owned.filter((c) => c.isHome).map((c) => c.cellId)).toEqual(["0,34"]);
    expect(after.res?.gold).toBe(77777);
    expect(after.res?.food).toBe(66666);
    expect(after.res?.stone).toBe(44444);
    expect(after.buildings).toHaveLength(beforeBuildings.length);
    expect(after.tech).toHaveLength(1);
    expect(after.pop?.total).toBe(beforePop?.total);
  });

  test("13. Rollback atómico íntegro ante un fallo de validación en lote mixto", async () => {
    const t = convexTest(schema, modules);
    const { kingdomId: k1 } = await createKingdomWithHome(t, "qfix-13a", "Roma Válida", "romanos", 0, 0);
    // k2 ya está correctamente situado en su ancla (-34,0), por lo que intentar recolocarlo debe abortar todo
    const { kingdomId: k2 } = await createKingdomWithHome(t, "qfix-13b", "Vikingo Fijo", "vikingos", -34, 0);

    const audit = await t.query(internal.territories.auditKingdomSpawnDistributionInternal, {});
    const e1 = audit.entries.find((e) => e.kingdomId === String(k1))!;
    const e2 = audit.entries.find((e) => e.kingdomId === String(k2))!;
    expect(e1.status).toBe("planned");
    expect(e2.status).toBe("correctly_positioned");

    await expect(
      t.mutation(internal.territories.applyKingdomSpawnRelocationInternal, {
        expectedPlanFingerprint: audit.planFingerprint,
        plannedRelocations: [
          { kingdomId: k1, fromCellId: "0,0", toCellId: e1.proposedHomeCellId! },
          { kingdomId: k2, fromCellId: "-34,0", toCellId: "-34,1" },
        ],
      })
    ).rejects.toThrow();

    const [k1After, k2After, cell034] = await t.run(async (ctx) => [
      await ctx.db.get(k1),
      await ctx.db.get(k2),
      await ctx.db.query("territories").withIndex("by_cell", (qb) => qb.eq("cellId", "0,34")).first(),
    ]);
    expect(k1After?.homeTerritoryId).toBe("0,0");
    expect(k2After?.homeTerritoryId).toBe("-34,0");
    expect(cell034?.ownerKingdomId).toBeUndefined();
  });
});

