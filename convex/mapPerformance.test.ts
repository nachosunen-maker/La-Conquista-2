import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { MAP } from "./balanceConfig";
import { cellId, generateWorldCells, hexDistance } from "./territoryRules";
import { buildKnownAxialRangeSegments } from "./territories";
import {
  BASE_HEX_SIZE,
  createCapitalCenteredCamera,
  zoomCameraAtPoint,
} from "../src/map/hexMath";
import { MedievalMapRenderer, type MapRenderInput, type RenderableMapCell } from "../src/map/mapRenderer";

const modules = import.meta.glob("./**/*.ts");

function identity(subject: string) {
  return { subject, tokenIdentifier: `perf|${subject}`, name: subject };
}

/**
 * Contexto Canvas 2D ligero compatible con edge-runtime/Node para ejercitar el código real
 * de `MedievalMapRenderer` y medir coste de CPU, culling, invalidaciones y reutilización de capa base.
 */
function createHeadlessCanvas() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  const ctx: any = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    save: noop,
    restore: noop,
    setTransform: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillRect: noop,
    strokeRect: noop,
    drawImage: noop,
    setLineDash: noop,
    strokeText: noop,
    fillText: noop,
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
  };
  const canvas: any = {
    width: 0,
    height: 0,
    style: { width: "", height: "" },
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

describe("Problema 1 — Eliminación de consultas N+1 en getWorldMapCompact", () => {
  test("Agrupación por intervalos axiales contiguos en 10, 500, 2.000 y 7.651 celdas conocidas: sin N+1, sin fugas ni duplicados", () => {
    const all = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
    all.sort((a, b) => hexDistance(a, { q: 0, r: 0 }) - hexDistance(b, { q: 0, r: 0 }));

    const scales = [10, 500, 2000, 7651];
    for (const count of scales) {
      const subset = all.slice(0, count);
      const knownSet = new Set(subset.map((c) => c.cellId));
      const ownedId = subset[0].cellId; // Capital ya cargada por by_owner
      const missingSet = new Set<string>();
      const rsByQ = new Map<number, number[]>();

      for (const c of subset) {
        let col = rsByQ.get(c.q);
        if (!col) {
          col = [];
          rsByQ.set(c.q, col);
        }
        col.push(c.r);
        if (c.cellId !== ownedId) missingSet.add(c.cellId);
      }

      const segments = buildKnownAxialRangeSegments(rsByQ, missingSet);

      // 1. Nunca 1 consulta por celda: acotado por O(sqrt(K)) <= 101 columnas
      expect(segments.length).toBeLessThan(missingSet.size);
      expect(segments.length).toBeLessThanOrEqual(MAP.RADIUS * 2 + 1);

      // 2. Verificar cobertura exacta, 0 celdas fuera de knownSet (0 niebla leída) y 0 duplicados
      const covered = new Set<string>();
      for (const seg of segments) {
        expect(seg.rStart).toBeLessThanOrEqual(seg.rEnd);
        for (let r = seg.rStart; r <= seg.rEnd; r++) {
          const cid = cellId(seg.q, r);
          expect(knownSet.has(cid)).toBe(true); // Jamás toca una celda bajo niebla
          expect(covered.has(cid)).toBe(false); // Jamás solapa rangos ni duplica lecturas
          covered.add(cid);
        }
      }

      // 3. Todas las celdas faltantes quedan cubiertas al 100%
      for (const mid of missingSet) {
        expect(covered.has(mid)).toBe(true);
      }
    }
  });

  test("Integración Convex real: getWorldMapCompact recupera propietarios exactos sin fugar celdas bajo niebla", async () => {
    const t = convexTest(schema, modules);
    const userA = t.withIdentity(identity("n1-user-a"));
    const userB = t.withIdentity(identity("n1-user-b"));

    const kingdomA = await userA.mutation(api.economy.getOrInitializeKingdom, {
      name: "Corona de León",
      civilization: "romanos",
      castleName: "Alcázar",
      monarchName: "Alfonso",
    });
    const kingdomB = await userB.mutation(api.economy.getOrInitializeKingdom, {
      name: "Ducado Sombrío",
      civilization: "vikingos",
      castleName: "Torre Negra",
      monarchName: "Bjorn",
    });

    // Sembrar 120 celdas exploradas contiguas alrededor de la capital de A + 1 territorio rival dentro y 1 fuera de niebla
    const homeA = kingdomA.homeTerritoryId!;
    const [hq, hr] = homeA.split(",").map(Number);
    const all = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
    all.sort((a, b) => hexDistance(a, { q: hq, r: hr }) - hexDistance(b, { q: hq, r: hr }));

    const exploredSlice = all.slice(1, 121);
    const visibleRivalCell = exploredSlice[10];
    const hiddenRivalCell = all[all.length - 1]; // Muy lejos, bajo niebla de guerra

    await t.run(async (ctx) => {
      for (const c of exploredSlice) {
        await ctx.db.insert("exploredTerritories", {
          kingdomId: kingdomA._id,
          cellId: c.cellId,
          discoveredAt: Date.now(),
        });
      }
      // Insertar territorio rival visible (dentro de exploredSlice)
      const existingVis = await ctx.db
        .query("territories")
        .withIndex("by_cell", (q) => q.eq("cellId", visibleRivalCell.cellId))
        .first();
      if (!existingVis) {
        await ctx.db.insert("territories", {
          cellId: visibleRivalCell.cellId,
          q: visibleRivalCell.q,
          r: visibleRivalCell.r,
          terrain: visibleRivalCell.terrain,
          ownerKingdomId: kingdomB._id,
        });
      }
      // Insertar territorio rival oculto (bajo niebla)
      const existingHid = await ctx.db
        .query("territories")
        .withIndex("by_cell", (q) => q.eq("cellId", hiddenRivalCell.cellId))
        .first();
      if (!existingHid) {
        await ctx.db.insert("territories", {
          cellId: hiddenRivalCell.cellId,
          q: hiddenRivalCell.q,
          r: hiddenRivalCell.r,
          terrain: hiddenRivalCell.terrain,
          ownerKingdomId: kingdomB._id,
        });
      }
    });

    const compactA = await userA.query(api.territories.getWorldMapCompact, { kingdomId: kingdomA._id });

    // Verificar sin duplicados
    const seenIds = new Set<string>();
    for (const c of compactA.visibleCells) {
      expect(seenIds.has(c.cellId)).toBe(false);
      seenIds.add(c.cellId);
    }

    // Territorio rival visible recuperado con propietario correcto
    const foundRival = compactA.visibleCells.find((c: any) => c.cellId === visibleRivalCell.cellId);
    expect(foundRival).toBeDefined();
    expect(foundRival?.ownerKingdomId).toBe(kingdomB._id);
    expect(foundRival?.ownerName).toBe("Ducado Sombrío");

    // Territorio rival bajo niebla NO aparece en la respuesta
    const leakedRival = compactA.visibleCells.find((c: any) => c.cellId === hiddenRivalCell.cellId);
    expect(leakedRival).toBeUndefined();
  });
});

describe("Problema 2 y 3 — Índice de expediciones, reutilización en pan, invalidación selectiva y benchmarks", () => {
  test("Índice compacto de expediciones: inspecciona solo expediciones activas (5 / 50 / 200) incluso con 7.651 celdas", () => {
    const { canvas } = createHeadlessCanvas();
    const renderer = new MedievalMapRenderer(canvas, MAP.RADIUS, MAP.WORLD_SEED, () => createHeadlessCanvas().canvas);
    renderer.setViewport(1440, 900, 2);
    renderer.setCamera(createCapitalCenteredCamera({ q: 0, r: 0 }, 1.25, BASE_HEX_SIZE));

    for (const expCount of [5, 50, 200]) {
      const cells = buildSyntheticVisibleCells(7651, expCount);
      renderer.setData({
        radius: MAP.RADIUS,
        worldSeed: MAP.WORLD_SEED,
        kingdomId: "k-player",
        homeTerritoryId: "0,0",
        pendingClaims: 1,
        visibleCells: cells,
        claimableAdjacentIds: new Set(["1,0", "0,1", "-1,1"]),
        activeMarches: [],
      });
      renderer.renderNow();

      const snap = renderer.getPerfSnapshot();
      // Jamás recorre las 7.651 visibleCells en el overlay
      expect(snap.lastExpeditionsInspected).toBe(expCount);
      expect(snap.lastExpeditionsDrawn).toBeLessThanOrEqual(expCount);
    }

    renderer.destroy();
  });

  test("Invalidación selectiva: selección, hover, progreso de expedición y pan dentro de overscan NO redibujan la capa base", () => {
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

    // 1. Selección y hover: 0 redibujados de capa base
    renderer.setSelectedCell(1, 0);
    renderer.renderNow();
    renderer.setHoveredCell(2, -1);
    renderer.renderNow();
    expect(renderer.getPerfSnapshot().baseRenderCount).toBe(baseAfterInit);
    expect(renderer.getPerfSnapshot().invalidationsBySelection).toBe(1);
    expect(renderer.getPerfSnapshot().invalidationsByHover).toBe(1);

    // 2. Actualizar únicamente el progreso de las expediciones (de 25% a 60%): 0 redibujados de capa base
    renderer.setData({
      ...baseInput,
      visibleCells: buildSyntheticVisibleCells(2000, 50, 60),
    });
    renderer.renderNow();
    expect(renderer.getPerfSnapshot().baseRenderCount).toBe(baseAfterInit);

    // 3. Desplazamiento continuo (pan puro de 60px dentro del margen overscan): reutiliza capa base
    for (let step = 1; step <= 10; step++) {
      renderer.setCamera({ x: cam0.x + step * 5, y: cam0.y + step * 3, zoom: cam0.zoom });
      renderer.renderNow();
    }
    const afterPan = renderer.getPerfSnapshot();
    expect(afterPan.panReuseHitCount).toBe(10);
    expect(afterPan.baseRenderCount).toBe(baseAfterInit);

    // 4. Cambio de zoom: redibuja capa base con precisión
    const zoomed = zoomCameraAtPoint(renderer.getCamera(), 720, 450, { width: 1440, height: 900 }, 1.8);
    renderer.setCamera(zoomed);
    renderer.renderNow();
    expect(renderer.getPerfSnapshot().baseRenderCount).toBe(baseAfterInit + 1);

    renderer.destroy();
  });

  test("Benchmarks reproducibles de fotograma (escritorio 1440x900 y móvil 390x844, pan y zoom continuos)", () => {
    const viewports = [
      { label: "desktop", w: 1440, h: 900, dpr: 2 },
      { label: "mobile", w: 390, h: 844, dpr: 3 },
    ];

    for (const vp of viewports) {
      const { canvas } = createHeadlessCanvas();
      const renderer = new MedievalMapRenderer(canvas, MAP.RADIUS, MAP.WORLD_SEED, () => createHeadlessCanvas().canvas);
      renderer.setViewport(vp.w, vp.h, vp.dpr);
      const cam0 = createCapitalCenteredCamera({ q: 0, r: 0 }, 1.25, BASE_HEX_SIZE);
      renderer.setCamera(cam0);
      renderer.setData({
        radius: MAP.RADIUS,
        worldSeed: MAP.WORLD_SEED,
        kingdomId: "k-player",
        homeTerritoryId: "0,0",
        pendingClaims: 1,
        visibleCells: buildSyntheticVisibleCells(2000, 50),
        claimableAdjacentIds: new Set(["2,0", "1,1", "-1,2"]),
        activeMarches: [],
      });
      renderer.renderNow();

      // 60 fotogramas de pan continuo
      const panTimes: number[] = [];
      for (let f = 1; f <= 60; f++) {
        renderer.setCamera({ x: cam0.x + f * 3, y: cam0.y + f * 1.5, zoom: cam0.zoom });
        renderer.renderNow();
        panTimes.push(renderer.getPerfSnapshot().lastFrameMs);
      }
      panTimes.sort((a, b) => a - b);
      const panP95 = percentile(panTimes, 0.95);
      // Objetivo de presupuesto CPU en entorno headless: muy por debajo de T_60 = 16.67 ms
      expect(panP95).toBeLessThan(16.67);
      expect(renderer.getPerfSnapshot().panReuseHitCount).toBeGreaterThan(40);

      renderer.destroy();
    }
  });
});
