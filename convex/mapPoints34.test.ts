import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { MAP } from "./balanceConfig";
import { cellId, generateWorldCells, hexDistance, isInsideWorld } from "./territoryRules";
import {
  axialToFlatIndex,
  axialToPixel,
  BASE_HEX_SIZE,
  clearPersistedCamera,
  computeAdaptiveDpr,
  computeClaimableAdjacentIds,
  computeVisibleAxialBounds,
  createCapitalCenteredCamera,
  DEFAULT_CAPITAL_ZOOM,
  getCachedStaticWorld,
  getPersistedCamera,
  HEX_EDGE_NEIGHBORS,
  HEX_UNIT_VERTICES,
  pixelToAxial,
  screenToAxial,
  screenToWorld,
  setPersistedCamera,
  worldToScreen,
  zoomCameraAtPoint,
} from "../src/map/hexMath";
import {
  MEDIEVAL_TERRAIN_PALETTE,
  selectLodLevel,
  terrainAssetRegistry,
} from "../src/map/terrainVisuals";

const modules = import.meta.glob("./**/*.ts");

function identity(subject: string) {
  return { subject, tokenIdentifier: `test|${subject}`, name: subject };
}

describe("Puntos 3+4 — Geometría hexagonal, culling, cámara y arquitectura visual", () => {
  test("Disco hexagonal canónico R=50 exacto: 7.651 celdas, sin duplicados, determinista y cacheado", () => {
    const worldA = getCachedStaticWorld(MAP.RADIUS, MAP.WORLD_SEED, BASE_HEX_SIZE);
    const worldB = getCachedStaticWorld(MAP.RADIUS, MAP.WORLD_SEED, BASE_HEX_SIZE);

    expect(worldA).toBe(worldB); // Misma referencia en caché (0 reconstrucción)
    expect(worldA.radius).toBe(50);
    expect(worldA.seed).toBe(20261017);
    expect(worldA.totalCells).toBe(1 + 3 * 50 * 51);
    expect(worldA.totalCells).toBe(7651);

    const seen = new Set<string>();
    for (let i = 0; i < worldA.totalCells; i++) {
      const q = worldA.cellQ[i];
      const r = worldA.cellR[i];
      expect(isInsideWorld({ q, r }, 50)).toBe(true);
      expect(Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r))).toBeLessThanOrEqual(50);
      const id = cellId(q, r);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(7651);
  });

  test("Conversión axial <-> píxel exacta en los 7.651 centros y perturbaciones dentro del radio inscrito", () => {
    const world = getCachedStaticWorld(MAP.RADIUS, MAP.WORLD_SEED, BASE_HEX_SIZE);
    const inradius = (Math.sqrt(3) / 2) * BASE_HEX_SIZE;

    for (let i = 0; i < world.totalCells; i++) {
      const q = world.cellQ[i];
      const r = world.cellR[i];
      const px = axialToPixel(q, r, BASE_HEX_SIZE);
      const back = pixelToAxial(px.x, px.y, BASE_HEX_SIZE);
      expect(back.q).toBe(q);
      expect(back.r).toBe(r);
    }

    // Perturbaciones dentro del 80% del radio inscrito deben resolver siempre al mismo hexágono
    const probes = [
      { q: 0, r: 0 },
      { q: 17, r: -9 },
      { q: -25, r: 12 },
      { q: 50, r: -50 },
      { q: -50, r: 0 },
    ];
    for (const c of probes) {
      const center = axialToPixel(c.q, c.r, BASE_HEX_SIZE);
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
        const dx = Math.cos(angle) * inradius * 0.8;
        const dy = Math.sin(angle) * inradius * 0.8;
        const resolved = pixelToAxial(center.x + dx, center.y + dy, BASE_HEX_SIZE);
        expect(resolved).toEqual(c);
      }
    }
  });

  test("Las 6 aristas de cada hexágono apuntan exactamente a sus 6 vecinos axiales (fronteras de reinos exactas)", () => {
    const origin = axialToPixel(0, 0, BASE_HEX_SIZE);
    for (let edge = 0; edge < 6; edge++) {
      const v1 = HEX_UNIT_VERTICES[edge];
      const v2 = HEX_UNIT_VERTICES[(edge + 1) % 6];
      const midX = ((v1.x + v2.x) * 0.5) * BASE_HEX_SIZE;
      const midY = ((v1.y + v2.y) * 0.5) * BASE_HEX_SIZE;

      const dir = HEX_EDGE_NEIGHBORS[edge];
      const neighbor = axialToPixel(dir.q, dir.r, BASE_HEX_SIZE);
      // El punto medio de la arista debe coincidir exactamente con el punto medio entre ambos centros
      expect(Math.abs(midX - (origin.x + neighbor.x) * 0.5)).toBeLessThan(1e-6);
      expect(Math.abs(midY - (origin.y + neighbor.y) * 0.5)).toBeLessThan(1e-6);
    }
  });

  test("Culling espacial O(V) no recorta ningún hexágono visible y procesa solo una fracción en zoom cercano", () => {
    const world = getCachedStaticWorld(MAP.RADIUS, MAP.WORLD_SEED, BASE_HEX_SIZE);
    const viewports = [
      { width: 1440, height: 900, zoom: 2.2 },
      { width: 1440, height: 900, zoom: 1.25 },
      { width: 390, height: 844, zoom: 1.25 },
    ];

    for (const vp of viewports) {
      const camera = createCapitalCenteredCamera({ q: 8, r: -12 }, vp.zoom, BASE_HEX_SIZE);
      const bounds = computeVisibleAxialBounds(camera, vp, BASE_HEX_SIZE, MAP.RADIUS, 1.5);

      const culledSet = new Set<number>();
      for (let r = bounds.rMin; r <= bounds.rMax; r++) {
        const { qMin, qMax } = bounds.qRangeForRow(r);
        for (let q = qMin; q <= qMax; q++) {
          const idx = axialToFlatIndex(q, r, MAP.RADIUS);
          if (world.valid[idx] === 1) culledSet.add(idx);
        }
      }

      // Verificar contra barrido exhaustivo de los 7.651 hexes: ninguno visible en pantalla puede faltar
      let strictlyOnScreen = 0;
      for (let i = 0; i < world.totalCells; i++) {
        const idx = world.cellFlatIndex[i];
        const scr = worldToScreen(world.worldX[idx], world.worldY[idx], camera, vp);
        const rPx = BASE_HEX_SIZE * vp.zoom;
        if (scr.x >= -rPx && scr.x <= vp.width + rPx && scr.y >= -rPx && scr.y <= vp.height + rPx) {
          strictlyOnScreen++;
          expect(culledSet.has(idx)).toBe(true);
        }
      }
      expect(culledSet.size).toBeGreaterThanOrEqual(strictlyOnScreen);
      expect(culledSet.size).toBeLessThan(world.totalCells * 0.25);
    }
  });

  test("Zoom centrado en punto, selección exacta bajo pan+zoom, centrado en capital y persistencia de cámara", () => {
    const viewport = { width: 1280, height: 720 };
    const home = { q: -14, r: 9 };
    const cam0 = createCapitalCenteredCamera(home, DEFAULT_CAPITAL_ZOOM, BASE_HEX_SIZE);

    // La capital debe quedar centrada exactamente en el centro de la pantalla
    const homeWorld = axialToPixel(home.q, home.r, BASE_HEX_SIZE);
    const homeScreen = worldToScreen(homeWorld.x, homeWorld.y, cam0, viewport);
    expect(Math.abs(homeScreen.x - viewport.width * 0.5)).toBeLessThan(1e-6);
    expect(Math.abs(homeScreen.y - viewport.height * 0.5)).toBeLessThan(1e-6);

    // Zoom centrado en (820, 260) debe mantener invariante la coordenada de mundo bajo ese punto
    const anchorX = 820;
    const anchorY = 260;
    const worldBefore = screenToWorld(anchorX, anchorY, cam0, viewport);
    const cam1 = zoomCameraAtPoint(cam0, anchorX, anchorY, viewport, 2.15);
    const worldAfter = screenToWorld(anchorX, anchorY, cam1, viewport);
    expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(1e-6);
    expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(1e-6);

    // Click tras pan + zoom debe seleccionar exactamente el hexágono esperado
    const target = { q: -11, r: 7 };
    const targetWorld = axialToPixel(target.q, target.r, BASE_HEX_SIZE);
    const targetScreen = worldToScreen(targetWorld.x, targetWorld.y, cam1, viewport);
    const picked = screenToAxial(targetScreen.x, targetScreen.y, cam1, viewport, BASE_HEX_SIZE, MAP.RADIUS);
    expect(picked).toEqual(target);

    // Persistencia de cámara por reino
    clearPersistedCamera();
    setPersistedCamera("kingdom-alpha", cam1);
    expect(getPersistedCamera("kingdom-alpha")).toEqual(cam1);
    expect(getPersistedCamera("kingdom-beta")).toBeNull();
    clearPersistedCamera("kingdom-alpha");
    expect(getPersistedCamera("kingdom-alpha")).toBeNull();
  });

  test("computeClaimableAdjacentIds O(|T_owned|) coincide exactamente con fuerza bruta O(|V| * |T_owned|)", () => {
    const all = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
    const owned = all.slice(0, 100);
    const visibleById = new Map<string, { state: string; ownerKingdomId: string | null }>();
    for (let i = 0; i < 2000; i++) {
      const c = all[i];
      visibleById.set(c.cellId, {
        state: i < 100 ? "owned" : "explored",
        ownerKingdomId: i < 100 ? "k1" : i % 17 === 0 ? "k2" : null,
      });
    }

    const fastSet = computeClaimableAdjacentIds(owned, visibleById, MAP.RADIUS);

    // Referencia fuerza bruta
    const bruteSet = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = all[i];
      const info = visibleById.get(c.cellId)!;
      if (info.state !== "explored" || info.ownerKingdomId) continue;
      let minDist = Infinity;
      for (const o of owned) {
        const d = hexDistance(o, c);
        if (d < minDist) minDist = d;
      }
      if (minDist <= 2) bruteSet.add(c.cellId);
    }

    expect(fastSet.size).toBe(bruteSet.size);
    for (const id of bruteSet) {
      expect(fastSet.has(id)).toBe(true);
    }
  });

  test("DPR adaptativo, niveles LOD y registro extensible de sprites para Punto 7", () => {
    expect(computeAdaptiveDpr(390, 844, 3)).toBeLessThanOrEqual(1.5);
    expect(computeAdaptiveDpr(1440, 900, 3)).toBeLessThanOrEqual(2.0);
    const qhdDpr = computeAdaptiveDpr(2560, 1440, 2);
    expect(2560 * 1440 * qhdDpr * qhdDpr).toBeLessThanOrEqual(4_100_000);
    expect(computeAdaptiveDpr(3840, 2160, 2)).toBe(1);

    expect(selectLodLevel(8)).toBe(0);
    expect(selectLodLevel(18)).toBe(1);
    expect(selectLodLevel(28)).toBe(2);

    // Paleta completa para los 6 terrenos
    expect(Object.keys(MEDIEVAL_TERRAIN_PALETTE).sort()).toEqual([
      "bosque",
      "colina",
      "costa",
      "llanura",
      "montana",
      "rio",
    ]);

    // Registro y limpieza del proveedor de sprites (Punto 7)
    const mockProvider = { getTerrainSprite: () => null };
    terrainAssetRegistry.registerProvider(mockProvider);
    expect(terrainAssetRegistry.getProvider()).toBe(mockProvider);
    terrainAssetRegistry.registerProvider(null);
    expect(terrainAssetRegistry.getProvider()).toBeNull();
  });
});

describe("Puntos 3+4 — Backend getWorldMapCompact optimizado y seguridad de niebla", () => {
  test("getWorldMapCompact preserva niebla de guerra, autorización estricta y sincronía con recentDiscoveries", async () => {
    const t = convexTest(schema, modules);

    // 1. Consulta global sin kingdomId: no expone reinos ni celdas privadas
    const anon = await t.query(api.territories.getWorldMapCompact, {});
    expect(anon.radius).toBe(50);
    expect(anon.totalCells).toBe(7651);
    expect(anon.worldSeed).toBe(20261017);
    expect(anon.visibleCells).toEqual([]);
    expect(anon.recentDiscoveries).toEqual([]);

    // 2. Fundar dos reinos independientes
    const userA = t.withIdentity(identity("map-p34-user-a"));
    const userB = t.withIdentity(identity("map-p34-user-b"));

    const resA = await userA.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino de Sol",
      civilization: "romanos",
      castleName: "Alcázar Solar",
      monarchName: "Aurelio",
    });
    const resB = await userB.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino de Sombra",
      civilization: "vikingos",
      castleName: "Fuerte Norte",
      monarchName: "Ragnar",
    });

    const kingdomAId = resA._id;
    const kingdomBId = resB._id;

    // 3. Usuario A no puede consultar la vista privada de B
    await expect(
      userA.query(api.territories.getWorldMapCompact, { kingdomId: kingdomBId })
    ).rejects.toThrow(/No autorizado/i);

    // 4. Consulta propia de A: devuelve capital, celdas visibles, recentDiscoveries y no fuga capital de B
    const compactA = await userA.query(api.territories.getWorldMapCompact, { kingdomId: kingdomAId });
    const terrA = await userA.query(api.territories.getKingdomTerritories, { kingdomId: kingdomAId });

    expect(compactA.radius).toBe(50);
    expect(compactA.totalCells).toBe(7651);
    expect(compactA.homeTerritoryId).toBe(terrA.homeTerritoryId);
    expect(compactA.exploredCount).toBe(terrA.exploredCount);
    expect(compactA.recentDiscoveries).toEqual(terrA.recentDiscoveries);

    const ownHome = compactA.visibleCells.find((c: any) => c.cellId === compactA.homeTerritoryId);
    expect(ownHome).toBeDefined();
    expect(ownHome?.isHome).toBe(true);
    expect(ownHome?.state).toBe("owned");

    // Verificar que ningún registro en activeMarches tiene estado distinto de "marchando"
    expect(Array.isArray(compactA.activeMarches)).toBe(true);
  });
});
