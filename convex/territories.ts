/**
 * LA CONQUISTA — MAPA, TERRITORIOS Y EXPLORACIÓN (Bloques G, P22, P47-P49)
 * El mundo canónico es un disco hexagonal completo de radio 50 con exactamente
 * 7.651 celdas (1 + 3 × 50 × 51, semilla reproducible; histórico: radio 10 / 331 celdas).
 * Cada reino recibe un territorio principal al fundarse; los demás permanecen libres hasta
 * explorarse y reclamarse tras una victoria aplastante (P47-P49) o expedición.
 *
 * Incluye sistema autoritativo de niebla de guerra, expediciones de exploración,
 * descubrimiento determinista de recursos y asignación de exploradores.
 */
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { recordMissionEvent } from "./missions";
import { isKingdomOwner, DEMO_USER_ID, isDemoAccountUserId, requireAuthorizedAdmin } from "./kingdomAccess";
import { requireOwner } from "./buildings";
import { ensureAllKingdomsHaveColors } from "./kingdomColors";
import { addUnits, readArmyUnitDocs, readArmyUnitsWithMigration } from "./army";
import { isSpyUnitDoc } from "./armyRules";
import { runMapReduction } from "./mapReduction";
import { EXPLORATION, MAP, TERRAINS, TERRITORIES, type TerrainType } from "./balanceConfig";
import {
  canClaimTerritory,
  chooseHomeCell,
  generateWorldCells,
  hexDistance,
  hexNeighbors,
  inspectWorldIntegrity,
  parseCellId,
  cellId,
  planTerritoryCapCleanup,
  type ExistingKingdomSpawn,
  type HexCoord,
  type WorldCell,
  hexLine,
  pathTerrainMultiplier,
  calculateArmyMarchPlan,
  isInsideWorld,
  terrainForCell,
} from "./territoryRules";
import type { UnitType } from "./balanceConfig";
import { getCivilizationPassive } from "./civilizationRules";
import { readCompletedTechnologyIds } from "./technologyRules";
import {
  canStartExploration,
  calculateExplorationRefund,
  explorationProgress,
  generateExplorationDiscovery,
  getInitialSightCellIds,
  type CellExplorationState,
} from "./explorationRules";
import { settleRelationalKingdomEconomy } from "./economy";

export async function readWorld(ctx: QueryCtx | MutationCtx) {
  const existing = await ctx.db.query("territories").collect();
  const existingMap = new Map<string, typeof existing[0]>();
  for (const t of existing) {
    const parsed = parseCellId(t.cellId);
    if (!parsed || parsed.q !== t.q || parsed.r !== t.r || !isInsideWorld(parsed, MAP.RADIUS)) {
      continue;
    }
    const prev = existingMap.get(t.cellId);
    if (!prev) {
      existingMap.set(t.cellId, t);
    } else if ((!prev.isHome && t.isHome) || (!prev.ownerKingdomId && t.ownerKingdomId)) {
      existingMap.set(t.cellId, t);
    }
  }

  const targetCells = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
  return targetCells.map((genCell) => {
    const dbCell = existingMap.get(genCell.cellId);
    if (dbCell) return dbCell;
    return {
      cellId: genCell.cellId,
      q: genCell.q,
      r: genCell.r,
      terrain: genCell.terrain,
      ownerKingdomId: undefined,
      isHome: false,
    };
  });
}

export async function readTerritoryCell(ctx: QueryCtx | MutationCtx, cellIdStr: string) {
  const target = await ctx.db
    .query("territories")
    .withIndex("by_cell", (q) => q.eq("cellId", cellIdStr))
    .first();

  if (target) return target;

  const coord = parseCellId(cellIdStr);
  if (coord && isInsideWorld(coord, MAP.RADIUS)) {
    const terrain = terrainForCell(coord.q, coord.r, MAP.WORLD_SEED, MAP.RADIUS);
    return {
      cellId: cellIdStr,
      q: coord.q,
      r: coord.r,
      terrain,
      ownerKingdomId: undefined,
      isHome: false,
    };
  }
  return null;
}

export async function getOrCreateTerritoryCell(ctx: MutationCtx, cellIdStr: string) {
  let target = await ctx.db
    .query("territories")
    .withIndex("by_cell", (q) => q.eq("cellId", cellIdStr))
    .first();

  if (!target) {
    const coord = parseCellId(cellIdStr);
    if (coord && isInsideWorld(coord, MAP.RADIUS)) {
      const terrain = terrainForCell(coord.q, coord.r, MAP.WORLD_SEED, MAP.RADIUS);
      const id = await ctx.db.insert("territories", {
        cellId: cellIdStr,
        q: coord.q,
        r: coord.r,
        terrain,
      });
      target = await ctx.db.get(id);
    }
  }
  return target;
}

/**
 * Helper para actualizar una celda de territorio, asegurando que existe en la DB primero.
 */
export async function patchTerritoryCell(ctx: MutationCtx, cellIdStr: string, updates: Partial<Doc<"territories">>) {
  const cell = await getOrCreateTerritoryCell(ctx, cellIdStr);
  if (cell) {
    await ctx.db.patch(cell._id, updates);
    return true;
  }
  return false;
}

/**
 * Asegura la existencia de las 7.651 celdas del mundo hexagonal canónico (radio 50).
 * Valida la correspondencia real de coordenadas contra `generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED)`
 * en lugar de confiar únicamente en el recuento total de registros.
 * Conserva íntegramente todos los registros existentes (terrenos, propietarios, capitales
 * y fechas de reclamación) e inserta únicamente las celdas canónicas faltantes.
 * Es estrictamente idempotente y no destructiva.
 */
export async function ensureWorld(ctx: MutationCtx): Promise<number> {
  const existing = await ctx.db.query("territories").collect();
  const existingCanonicalIds = new Set<string>();
  for (const cell of existing) {
    const parsed = parseCellId(cell.cellId);
    if (parsed && parsed.q === cell.q && parsed.r === cell.r && isInsideWorld(parsed, MAP.RADIUS)) {
      existingCanonicalIds.add(cell.cellId);
    }
  }

  const targetCells = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
  let added = 0;

  for (const cell of targetCells) {
    if (!existingCanonicalIds.has(cell.cellId)) {
      await ctx.db.insert("territories", {
        cellId: cell.cellId,
        q: cell.q,
        r: cell.r,
        terrain: cell.terrain,
      });
      existingCanonicalIds.add(cell.cellId);
      added++;
    }
  }

  return added;
}

/**
 * Mutación para ampliar el mundo de forma idempotente a radio 50 (7.651 celdas).
 */
export const expandWorld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const added = await ensureWorld(ctx);
    const persisted = await ctx.db.query("territories").collect();
    const integrity = inspectWorldIntegrity(persisted, MAP.RADIUS, MAP.WORLD_SEED);
    return {
      success: true,
      added,
      totalCells: persisted.length,
      canonicalCells: integrity.uniqueCanonicalPresent,
      expectedCanonicalCells: integrity.expectedCanonicalCells,
      missingCanonicalCells: integrity.missingCellIds.length,
      duplicateRecords: integrity.duplicateCellIds.length,
      outOfBoundsRecords: integrity.outOfBoundsCellIds.length,
      isComplete: integrity.isComplete,
      isExact: integrity.isExact,
      radius: MAP.RADIUS,
    };
  },
});

/** Asigna el territorio principal de un reino si aún no lo tiene (idempotente, sin escribir las 7.651 celdas). */
export async function ensureHomeTerritory(ctx: MutationCtx, kingdomId: Id<"kingdoms">): Promise<string | null> {
  const kingdom = await ctx.db.get(kingdomId);
  if (!kingdom) return null;
  if (kingdom.homeTerritoryId) return kingdom.homeTerritoryId;

  const ownTerritories = await ctx.db
    .query("territories")
    .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdomId))
    .collect();
  const alreadyOwned = ownTerritories.find((cell) => cell.isHome) ?? ownTerritories[0];
  if (alreadyOwned) {
    if (!alreadyOwned.isHome) {
      await ctx.db.patch(alreadyOwned._id, { isHome: true });
    }
    await ctx.db.patch(kingdomId, { homeTerritoryId: alreadyOwned.cellId });
    return alreadyOwned.cellId;
  }

  const allKingdoms = await ctx.db.query("kingdoms").collect();
  const occupied = new Set<string>();
  const existingHomes: HexCoord[] = [];
  const existingKingdoms: ExistingKingdomSpawn[] = [];

  for (const k of allKingdoms) {
    if (k._id === kingdomId) continue;
    const kOwned = await ctx.db
      .query("territories")
      .withIndex("by_owner", (q) => q.eq("ownerKingdomId", k._id))
      .collect();
    for (const c of kOwned) occupied.add(c.cellId);
    if (k.homeTerritoryId) occupied.add(k.homeTerritoryId);

    const parsedHome = k.homeTerritoryId ? parseCellId(k.homeTerritoryId) : null;
    const homeCellDoc = kOwned.find((c) => c.isHome) ?? kOwned[0];
    const homeCoord = parsedHome ?? (homeCellDoc ? { q: homeCellDoc.q, r: homeCellDoc.r } : null);
    if (homeCoord) {
      existingHomes.push(homeCoord);
      existingKingdoms.push({
        q: homeCoord.q,
        r: homeCoord.r,
        civilization: k.civilization ?? null,
      });
    }
  }

  const worldCells = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
  const choice = chooseHomeCell(worldCells, occupied, existingHomes, {
    civilization: kingdom.civilization,
    existingKingdoms,
    preferCenterIfEmpty: existingHomes.length === 0 || kingdom.userId === DEMO_USER_ID,
  });
  if (!choice) return null;

  const doc = await getOrCreateTerritoryCell(ctx, choice.cellId);
  if (!doc) return null;
  await ctx.db.patch(doc._id, { ownerKingdomId: kingdomId, isHome: true, claimedAt: Date.now() });
  await ctx.db.patch(kingdomId, { homeTerritoryId: doc.cellId });
  return doc.cellId;
}

/** Coordenadas del territorio principal de un reino (null si no tiene). */
export async function readHomeCoord(ctx: QueryCtx | MutationCtx, kingdomId: Id<"kingdoms">): Promise<HexCoord | null> {
  const kingdom = await ctx.db.get(kingdomId);
  const fromId = kingdom?.homeTerritoryId ? parseCellId(kingdom.homeTerritoryId) : null;
  if (fromId) return fromId;
  const home = await ctx.db
    .query("territories")
    .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdomId))
    .collect();
  const cell = home.find((entry) => entry.isHome) ?? home[0];
  return cell ? { q: cell.q, r: cell.r } : null;
}

/** [R-14] Multiplicador medio de terreno del camino entre dos coordenadas, leyendo las celdas del mundo. */
export async function readPathTerrainMultiplier(ctx: QueryCtx | MutationCtx, from: HexCoord, to: HexCoord): Promise<number> {
  const line = hexLine(from, to);
  const terrainByCell = new Map<string, string>();
  for (const coord of line) {
    const id = `${coord.q},${coord.r}`;
    const cell = await ctx.db.query("territories").withIndex("by_cell", (q) => q.eq("cellId", id)).first();
    if (cell) terrainByCell.set(id, cell.terrain);
  }
  return pathTerrainMultiplier(from, to, terrainByCell);
}

/** [R-14] Multiplicador de terreno de la marcha entre los territorios principales de dos reinos (1 si falta alguno). */
export async function pathTerrainBetweenKingdoms(ctx: QueryCtx | MutationCtx, a: Id<"kingdoms">, b: Id<"kingdoms">): Promise<number> {
  const [homeA, homeB] = await Promise.all([readHomeCoord(ctx, a), readHomeCoord(ctx, b)]);
  if (!homeA || !homeB) return 1;
  return readPathTerrainMultiplier(ctx, homeA, homeB);
}

/** Distancia hexagonal entre los territorios principales de dos reinos (P41); null si alguno no tiene. */
export async function distanceBetweenKingdoms(ctx: QueryCtx | MutationCtx, a: Id<"kingdoms">, b: Id<"kingdoms">): Promise<number | null> {
  const [homeA, homeB] = await Promise.all([readHomeCoord(ctx, a), readHomeCoord(ctx, b)]);
  if (!homeA || !homeB) return null;
  return hexDistance(homeA, homeB);
}

/**
 * [BETA PARLAMENTO]: Celdas conocidas ("q,r") para un reino:
 * 1. Celdas poseídas por el reino (territorio principal + anexionados).
 * 2. Celdas dentro del radio de visión inicial alrededor del territorio principal.
 * 3. Celdas exploradas registradas en 'exploredTerritories'.
 * 4. Celdas con expediciones vencidas o completadas en 'explorationQueue'.
 */
export async function readKnownCellIds(
  ctx: QueryCtx | MutationCtx,
  kingdomId: Id<"kingdoms">
): Promise<Set<string>> {
  const kingdom = await ctx.db.get(kingdomId);
  if (!kingdom) return new Set();

  const [ownedCells, exploredRecords, activeQueue] = await Promise.all([
    ctx.db
      .query("territories")
      .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdomId))
      .collect(),
    ctx.db
      .query("exploredTerritories")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .collect(),
    ctx.db
      .query("explorationQueue")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .collect(),
  ]);

  const homeCoord = kingdom.homeTerritoryId
    ? parseCellId(kingdom.homeTerritoryId)
    : await readHomeCoord(ctx, kingdomId);
  const initialSight = getInitialSightCellIds(homeCoord, EXPLORATION.INITIAL_SIGHT_RADIUS, MAP.RADIUS);

  const ownedIds = new Set<string>();
  for (const c of ownedCells) ownedIds.add(String(c.cellId));
  if (kingdom.homeTerritoryId) {
    ownedIds.add(String(kingdom.homeTerritoryId));
  }

  const knownIds = new Set<string>([
    ...Array.from(ownedIds),
    ...Array.from(initialSight),
    ...exploredRecords.map((r) => String(r.cellId)),
  ]);

  const now = Date.now();
  for (const exp of activeQueue) {
    if (now >= exp.completesAt) {
      knownIds.add(exp.cellId);
    }
  }

  return knownIds;
}

/**
 * [BETA PARLAMENTO]: Obtiene los identificadores de reinos rivales descubiertos en el mapa por un reino.
 * Un reino se considera descubierto si el jugador conoce la celda de su territorio
 * principal o cualquiera de sus celdas territoriales.
 */
export async function readDiscoveredKingdomIds(
  ctx: QueryCtx | MutationCtx,
  kingdomId: Id<"kingdoms">
): Promise<Set<Id<"kingdoms">>> {
  const knownCellIds = await readKnownCellIds(ctx, kingdomId);
  if (knownCellIds.size === 0) return new Set();

  const allKingdoms = await ctx.db.query("kingdoms").collect();
  const discovered = new Set<Id<"kingdoms">>();

  await Promise.all(
    allKingdoms.map(async (k) => {
      if (k._id === kingdomId) return;
      if (k.homeTerritoryId && knownCellIds.has(k.homeTerritoryId)) {
        discovered.add(k._id);
        return;
      }
      const owned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", k._id))
        .collect();
      if (owned.some((c) => knownCellIds.has(c.cellId))) {
        discovered.add(k._id);
      }
    })
  );

  return discovered;
}

/**
 * Resuelve y completa una expedición de exploración vencida (idempotente).
 */
export async function completeExpedition(ctx: MutationCtx, expeditionId: Id<"explorationQueue">) {
  const expedition = await ctx.db.get(expeditionId);
  if (!expedition) return null;

  const kingdom = await ctx.db.get(expedition.kingdomId);
  if (!kingdom) {
    await ctx.db.delete(expeditionId);
    return null;
  }

  if (Date.now() < expedition.completesAt) {
    return null;
  }

  // 1. Obtener datos de la celda objetivo
  const targetCell = await ctx.db
    .query("territories")
    .withIndex("by_cell", (q) => q.eq("cellId", expedition.cellId))
    .first();

  let ownerName: string | null = null;
  if (targetCell?.ownerKingdomId) {
    const ownerKingdom = await ctx.db.get(targetCell.ownerKingdomId);
    ownerName = ownerKingdom?.name ?? null;
  }

  // 2. Generar hallazgo o evento de descubrimiento
  const discovery = targetCell
    ? generateExplorationDiscovery(targetCell as WorldCell, ownerName)
    : { description: `Territorio ${expedition.cellId} explorado con éxito.`, isFreeTerritory: true, ownerKingdomName: null };

  // 3. Registrar en territorios explorados del reino si no existía ya
  const existingExplored = await ctx.db
    .query("exploredTerritories")
    .withIndex("by_kingdom_and_cell", (q) => q.eq("kingdomId", expedition.kingdomId).eq("cellId", expedition.cellId))
    .first();

  if (!existingExplored) {
    await ctx.db.insert("exploredTerritories", {
      kingdomId: expedition.kingdomId,
      cellId: expedition.cellId,
      discoveredAt: Date.now(),
      discoveryNote: discovery.description,
    });
  }

  // 4. Devolver al ciudadano explorador a la reserva de población civil libre (o devolver espía)
  if (expedition.isSpyMission) {
    await addUnits(ctx, expedition.kingdomId, "espia", 1, expedition.scoutsCount || 1);
  } else {
    const population = await ctx.db
      .query("population")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", expedition.kingdomId))
      .first();

    if (population) {
      await ctx.db.patch(population._id, {
        available: (population.available ?? 0) + (expedition.scoutsCount ?? 1),
      });
    }
  }

  // 5. Conceder recompensa de descubrimiento de recursos si aplica
  if (discovery.resourceReward) {
    const resources = await ctx.db
      .query("resources")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", expedition.kingdomId))
      .first();

    if (resources) {
      const resourceKey = discovery.resourceReward.resource;
      const currentAmount = (resources as any)[resourceKey] ?? 0;
      await ctx.db.patch(resources._id, {
        [resourceKey]: currentAmount + discovery.resourceReward.amount,
      });
    }
  }

  // 6. Eliminar la tarea completada de la cola
  await ctx.db.delete(expeditionId);
  await recordMissionEvent(ctx, expedition.kingdomId, "explorationsCompleted", 1);

  return {
    success: true,
    cellId: expedition.cellId,
    discovery,
  };
}

/**
 * Resuelve cualquier expedición de exploración vencida en el reino.
 */
async function resolveExpiredExpeditions(ctx: MutationCtx, kingdomId: Id<"kingdoms">, nowMs: number) {
  const queue = await ctx.db
    .query("explorationQueue")
    .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
    .collect();

  const completed: Array<{ cellId: string; description: string }> = [];
  for (const expedition of queue) {
    if (nowMs >= expedition.completesAt) {
      const result = await completeExpedition(ctx, expedition._id);
      if (result) {
        completed.push({ cellId: result.cellId, description: result.discovery.description });
      }
    }
  }
  return completed;
}

export const getWorldMap = query({
  args: {
    kingdomId: v.optional(v.id("kingdoms")),
  },
  handler: async (ctx, args) => {
    // 1. Consulta global sin kingdomId (información geográfica pública únicamente):
    // NO lee propietarios ni reinos de la base de datos; devuelve solo coordenadas y terreno canónico.
    if (!args.kingdomId) {
      const publicCells = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
      return {
        radius: MAP.RADIUS,
        generated: publicCells.length > 0,
        terrains: TERRAINS,
        totalCells: publicCells.length,
        exploredCount: 0,
        activeExpeditions: [],
        activeMarches: [],
        kingdomLegend: [],
        pendingClaims: 0,
        homeTerritoryId: null,
        cells: publicCells.map((cell) => ({
          cellId: cell.cellId,
          q: cell.q,
          r: cell.r,
          terrain: cell.terrain,
          ownerKingdomId: null,
          ownerName: null,
          ownerColor: null,
          isHome: false,
          state: "fog" as CellExplorationState,
          canExplore: false,
          canConquer: false,
          explorationPlan: null,
          expedition: null,
        })),
      };
    }

    // 2. Autorización ESTRICTA ANTES de leer territorios, propietarios o reinos rivales (P22)
    const kingdomId = args.kingdomId;
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");

    const isDemoRead = kingdom.userId === DEMO_USER_ID;
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar la niebla de guerra de su propio reino.");
    }

    const homeCoord = kingdom.homeTerritoryId ? parseCellId(kingdom.homeTerritoryId) : null;

    const [world, exploredRecords, activeQueue, completedTech, activeMarchesDocs] = await Promise.all([
      readWorld(ctx),
      ctx.db
        .query("exploredTerritories")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .collect(),
      ctx.db
        .query("explorationQueue")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .collect(),
      readCompletedTechnologyIds(ctx, kingdomId),
      ctx.db
        .query("armyMarches")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .collect(),
    ]);

    const ownedCells = world.filter((c) => c.ownerKingdomId && String(c.ownerKingdomId) === String(kingdomId));
    const hasSpy2Tech = completedTech.includes("spy_2");
    const ownedIds = new Set<string>();
    for (const c of ownedCells) ownedIds.add(String(c.cellId));
    if (kingdom.homeTerritoryId) {
      ownedIds.add(String(kingdom.homeTerritoryId));
    }

    const ownedCoords: HexCoord[] = ownedCells.map((c) => ({ q: c.q, r: c.r }));
    if (homeCoord && !ownedCoords.some(c => c.q === homeCoord.q && c.r === homeCoord.r)) {
      ownedCoords.push(homeCoord);
    }

    // Celdas conocidas: territorios propios + visión inicial + exploradas/espionaje guardadas
    const knownIds = new Set<string>([
      ...Array.from(ownedIds),
      ...getInitialSightCellIds(homeCoord, EXPLORATION.INITIAL_SIGHT_RADIUS, MAP.RADIUS),
      ...exploredRecords.map((r) => String(r.cellId)),
    ]);

    const activeExpeditionMap = new Map<string, typeof activeQueue[0]>();
    const now = Date.now();
    for (const exp of activeQueue) {
      if (now >= exp.completesAt) {
        // En tiempo de lectura, si ya venció se considera conocido
        knownIds.add(exp.cellId);
      } else {
        activeExpeditionMap.set(exp.cellId, exp);
      }
    }

    // Cargar ÚNICAMENTE los reinos propietarios de al menos una celda ya conocida (nunca reinos bajo niebla)
    const knownOwnedCountByKingdom = new Map<string, number>();
    const visibleOwnerIdMap = new Map<string, Id<"kingdoms">>();
    for (const cell of world) {
      if (cell.ownerKingdomId && knownIds.has(cell.cellId)) {
        const key = String(cell.ownerKingdomId);
        knownOwnedCountByKingdom.set(key, (knownOwnedCountByKingdom.get(key) ?? 0) + 1);
        visibleOwnerIdMap.set(key, cell.ownerKingdomId);
      }
    }

    const visibleOwnerDocs = await Promise.all(
      Array.from(visibleOwnerIdMap.values()).map((id) => ctx.db.get(id))
    );
    const names = new Map<string, string>();
    const colorsMap = new Map<string, string>();
    const legendList: Array<{ id: string; name: string; monarchName?: string; color: string; territoryCount: number }> = [];
    for (const k of visibleOwnerDocs) {
      if (!k) continue;
      const key = String(k._id);
      const color = k.color ?? "#d4af37";
      names.set(key, k.name);
      colorsMap.set(key, color);
      const visibleOwnedCount = knownOwnedCountByKingdom.get(key) ?? 0;
      if (visibleOwnedCount > 0) {
        legendList.push({
          id: key,
          name: k.name,
          monarchName: k.monarchName,
          color,
          territoryCount: visibleOwnedCount,
        });
      }
    }

    const activeExpeditionsCount = activeExpeditionMap.size;
    const canLaunchMore = activeExpeditionsCount < EXPLORATION.MAX_CONCURRENT_EXPEDITIONS;
    const activeCellIds = new Set(activeExpeditionMap.keys());

    const mappedCells = world.map((cell) => {
      const isOwned = ownedIds.has(cell.cellId);
      const isExploring = activeExpeditionMap.has(cell.cellId);
      const isKnown = knownIds.has(cell.cellId);

      let state: CellExplorationState;
      if (isOwned) {
        state = "owned";
      } else if (isExploring) {
        state = "exploring";
      } else if (isKnown) {
        state = "explored";
      } else {
        state = "fog";
      }

      // Comprobar si puede ser explorada (adyacente a territorio conocido)
      let canExplore = false;
      let explorationPlan: { distance: number; durationSeconds: number; costs: { gold: number; food: number } } | null = null;

      if (state === "fog") {
        const neighbors = hexNeighbors({ q: cell.q, r: cell.r }, MAP.RADIUS);
        const bordersKnown = neighbors.some((n) => knownIds.has(cellId(n.q, n.r)));
        if (bordersKnown && canLaunchMore) {
          canExplore = true;
          const planRes = canStartExploration({
            targetCoord: { q: cell.q, r: cell.r },
            targetCellId: cell.cellId,
            knownCellIds: knownIds,
            activeCellIds,
            ownedCoords,
            availableSpies: 999,
            currentResources: { gold: 999999, food: 999999 },
            activeExpeditionsCount,
            worldRadius: MAP.RADIUS,
            civilization: kingdom.civilization,
            hasSpy2Tech,
          });
          if (planRes.success) {
            explorationPlan = {
              distance: planRes.plan.distance,
              durationSeconds: planRes.plan.durationSeconds,
              costs: planRes.plan.costs,
            };
          }
        }
      }

      // Comprobar si puede ser conquistada (adyacente a territorio propio Y es conocida Y es neutral)
      let canConquer = false;
      if (state === "explored" && !cell.ownerKingdomId) {
        const neighbors = hexNeighbors({ q: cell.q, r: cell.r }, MAP.RADIUS);
        canConquer = neighbors.some((n) => {
          const nid = cellId(n.q, n.r);
          return ownedIds.has(nid);
        });
      }

      const activeExp = activeExpeditionMap.get(cell.cellId);
      const expedition = activeExp
        ? {
            expeditionId: activeExp._id,
            progressPercent: explorationProgress(activeExp.startedAt, activeExp.durationMs, now),
            completesAt: activeExp.completesAt,
            durationMs: activeExp.durationMs,
            distance: activeExp.distance,
            isSpyMission: activeExp.isSpyMission ?? false,
          }
        : null;

      // Solo las celdas ya conocidas (owned o explored) revelan terreno, propietario y capital.
      const isHidden = !isKnown;
      const ownerColor = isHidden ? null : cell.ownerKingdomId ? (colorsMap.get(String(cell.ownerKingdomId)) ?? "#d4af37") : null;

      return {
        cellId: cell.cellId,
        q: cell.q,
        r: cell.r,
        terrain: isHidden ? "desconocido" : cell.terrain,
        ownerKingdomId: isHidden ? null : cell.ownerKingdomId ?? null,
        ownerName: isHidden ? null : cell.ownerKingdomId ? names.get(String(cell.ownerKingdomId)) ?? null : null,
        ownerColor,
        isHome: isHidden ? false : cell.isHome ?? false,
        state,
        canExplore,
        canConquer,
        explorationPlan,
        expedition,
      };
    });

    return {
      radius: MAP.RADIUS,
      generated: world.length > 0,
      terrains: TERRAINS,
      totalCells: world.length,
      exploredCount: knownIds.size,
      activeExpeditions: activeQueue.map((exp) => ({
        expeditionId: exp._id,
        cellId: exp.cellId,
        completesAt: exp.completesAt,
        durationMs: exp.durationMs,
        progressPercent: explorationProgress(exp.startedAt, exp.durationMs, now),
        isSpyMission: exp.isSpyMission ?? false,
      })),
      activeMarches: activeMarchesDocs
        .filter((m) => m.status === "marchando")
        .map((m) => ({
          marchId: m._id,
          cellId: m.targetCellId,
          targetQ: m.targetQ,
          targetR: m.targetR,
          startedAt: m.startedAt,
          durationMs: m.durationMs,
          completesAt: m.completesAt,
          progressPercent: m.durationMs > 0 ? Math.min(100, Math.floor(((now - m.startedAt) / m.durationMs) * 100)) : 100,
          isConquest: m.isConquest ?? false,
          units: m.units,
        })),
      kingdomLegend: legendList,
      pendingClaims: kingdom?.pendingTerritoryClaims ?? 0,
      homeTerritoryId: kingdom?.homeTerritoryId ?? null,
      cells: mappedCells,
    };
  },
});

/**
 * Consulta compacta del mapa mundial: evita leer las 7.651 filas de `territories` en Convex.
 * Solo consulta territorios poseídos por reinos (`by_owner`), más las tablas del reino activo;
 * el terreno determinista del disco completo se reconstruye en el cliente a partir de `WORLD_SEED`.
 */
export const getWorldMapCompact = query({
  args: {
    kingdomId: v.optional(v.id("kingdoms")),
  },
  handler: async (ctx, args) => {
    // Consulta global sin kingdomId: devuelve únicamente la base cartográfica pública (semilla y radio),
    // sin exponer celdas ocupadas, capitales ni leyenda de reinos ocultos por la niebla de guerra.
    if (!args.kingdomId) {
      return {
        radius: MAP.RADIUS,
        worldSeed: MAP.WORLD_SEED,
        generated: true,
        terrains: TERRAINS,
        totalCells: MAP.MAX_CELLS,
        exploredCount: 0,
        activeExpeditions: [],
        activeMarches: [],
        kingdomLegend: [],
        pendingClaims: 0,
        homeTerritoryId: null,
        visibleCells: [],
      };
    }

    // 2. Autorización ESTRICTA ANTES de leer territorios, propietarios o reinos rivales (P22)
    const kingdomId = args.kingdomId;
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");

    const isDemoRead = kingdom.userId === DEMO_USER_ID;
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar la niebla de guerra de su propio reino.");
    }

    // 3. Leer ÚNICAMENTE los datos propios del reino autorizado
    const [ownedCells, exploredRecords, activeQueue, completedTech, activeMarchesDocs] = await Promise.all([
      ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdomId))
        .collect(),
      ctx.db
        .query("exploredTerritories")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .collect(),
      ctx.db
        .query("explorationQueue")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .collect(),
      readCompletedTechnologyIds(ctx, kingdomId),
      ctx.db
        .query("armyMarches")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .collect(),
    ]);

    const hasSpy2Tech = completedTech.includes("spy_2");
    const homeCoord = kingdom.homeTerritoryId ? parseCellId(kingdom.homeTerritoryId) : null;

    const ownedIds = new Set<string>();
    const knownTerritoryByCellId = new Map<string, Doc<"territories">>();
    for (const c of ownedCells) {
      ownedIds.add(String(c.cellId));
      knownTerritoryByCellId.set(c.cellId, c);
    }
    if (kingdom.homeTerritoryId) ownedIds.add(String(kingdom.homeTerritoryId));

    const ownedCoords: HexCoord[] = ownedCells.map((c) => ({ q: c.q, r: c.r }));
    if (homeCoord && !ownedCoords.some((c) => c.q === homeCoord.q && c.r === homeCoord.r)) {
      ownedCoords.push(homeCoord);
    }

    const knownIds = new Set<string>([
      ...Array.from(ownedIds),
      ...getInitialSightCellIds(homeCoord, EXPLORATION.INITIAL_SIGHT_RADIUS, MAP.RADIUS),
      ...exploredRecords.map((r) => String(r.cellId)),
    ]);

    const activeExpeditionMap = new Map<string, (typeof activeQueue)[0]>();
    const now = Date.now();
    for (const exp of activeQueue) {
      if (now >= exp.completesAt) {
        knownIds.add(exp.cellId);
      } else {
        activeExpeditionMap.set(exp.cellId, exp);
      }
    }

    // Leer de `territories` ÚNICAMENTE las celdas conocidas (nunca celdas ni reinos bajo niebla)
    const missingKnownIds = Array.from(knownIds).filter((id) => {
      if (knownTerritoryByCellId.has(id)) return false;
      const coord = parseCellId(id);
      return coord !== null && isInsideWorld(coord, MAP.RADIUS);
    });
    const fetchedKnownDocs = await Promise.all(
      missingKnownIds.map((cid) =>
        ctx.db
          .query("territories")
          .withIndex("by_cell", (q) => q.eq("cellId", cid))
          .first()
      )
    );
    for (const doc of fetchedKnownDocs) {
      if (doc) knownTerritoryByCellId.set(doc.cellId, doc);
    }

    // Cargar ÚNICAMENTE los reinos propietarios de celdas conocidas
    const knownOwnedCountByKingdom = new Map<string, number>();
    const visibleOwnerIdMap = new Map<string, Id<"kingdoms">>();
    for (const cid of knownIds) {
      const cell = knownTerritoryByCellId.get(cid);
      if (cell?.ownerKingdomId) {
        const key = String(cell.ownerKingdomId);
        knownOwnedCountByKingdom.set(key, (knownOwnedCountByKingdom.get(key) ?? 0) + 1);
        visibleOwnerIdMap.set(key, cell.ownerKingdomId);
      }
    }

    const visibleOwnerDocs = await Promise.all(
      Array.from(visibleOwnerIdMap.values()).map((id) => ctx.db.get(id))
    );
    const names = new Map<string, string>();
    const colorsMap = new Map<string, string>();
    const legendList: Array<{ id: string; name: string; monarchName?: string; color: string; territoryCount: number }> = [];
    for (const k of visibleOwnerDocs) {
      if (!k) continue;
      const key = String(k._id);
      const color = k.color ?? "#d4af37";
      names.set(key, k.name);
      colorsMap.set(key, color);
      const visibleOwnedCount = knownOwnedCountByKingdom.get(key) ?? 0;
      if (visibleOwnedCount > 0) {
        legendList.push({
          id: key,
          name: k.name,
          monarchName: k.monarchName,
          color,
          territoryCount: visibleOwnedCount,
        });
      }
    }

    const activeExpeditionsCount = activeExpeditionMap.size;
    const canLaunchMore = activeExpeditionsCount < EXPLORATION.MAX_CONCURRENT_EXPEDITIONS;
    const activeCellIds = new Set(activeExpeditionMap.keys());

    const frontierIds = new Set<string>();
    if (canLaunchMore) {
      for (const knownId of knownIds) {
        const coord = parseCellId(knownId);
        if (!coord || !isInsideWorld(coord, MAP.RADIUS)) continue;
        for (const n of hexNeighbors(coord, MAP.RADIUS)) {
          const nid = cellId(n.q, n.r);
          if (!knownIds.has(nid) && !activeExpeditionMap.has(nid) && !ownedIds.has(nid)) {
            frontierIds.add(nid);
          }
        }
      }
    }

    const interestingIds = new Set<string>([
      ...Array.from(knownIds),
      ...Array.from(activeCellIds),
      ...Array.from(frontierIds),
    ]);

    const visibleCells = [];
    for (const id of interestingIds) {
      const coord = parseCellId(id);
      if (!coord || !isInsideWorld(coord, MAP.RADIUS)) continue;

      const isOwned = ownedIds.has(id);
      const isExploring = activeExpeditionMap.has(id);
      const isKnown = knownIds.has(id);
      const dbKnown = isKnown ? knownTerritoryByCellId.get(id) : undefined;

      let state: CellExplorationState;
      if (isOwned) {
        state = "owned";
      } else if (isExploring) {
        state = "exploring";
      } else if (isKnown) {
        state = "explored";
      } else {
        state = "fog";
      }

      let canExplore = false;
      let explorationPlan: { distance: number; durationSeconds: number; costs: { gold: number; food: number } } | null = null;
      if (state === "fog" && frontierIds.has(id) && canLaunchMore) {
        canExplore = true;
        const planRes = canStartExploration({
          targetCoord: coord,
          targetCellId: id,
          knownCellIds: knownIds,
          activeCellIds,
          ownedCoords,
          availableSpies: 999,
          currentResources: { gold: 999999, food: 999999 },
          activeExpeditionsCount,
          worldRadius: MAP.RADIUS,
          civilization: kingdom.civilization,
          hasSpy2Tech,
        });
        if (planRes.success) {
          explorationPlan = {
            distance: planRes.plan.distance,
            durationSeconds: planRes.plan.durationSeconds,
            costs: planRes.plan.costs,
          };
        }
      }

      let canConquer = false;
      if (state === "explored" && !dbKnown?.ownerKingdomId) {
        const neighbors = hexNeighbors(coord, MAP.RADIUS);
        canConquer = neighbors.some((n) => ownedIds.has(cellId(n.q, n.r)));
      }

      const activeExp = activeExpeditionMap.get(id);
      const expedition = activeExp
        ? {
            expeditionId: activeExp._id,
            progressPercent: explorationProgress(activeExp.startedAt, activeExp.durationMs, now),
            completesAt: activeExp.completesAt,
            durationMs: activeExp.durationMs,
            distance: activeExp.distance,
            isSpyMission: activeExp.isSpyMission ?? false,
          }
        : null;

      const isHidden = !isKnown;
      const realTerrain = dbKnown?.terrain ?? terrainForCell(coord.q, coord.r, MAP.WORLD_SEED, MAP.RADIUS);
      const ownerId = dbKnown?.ownerKingdomId ?? null;
      const ownerColor = isHidden ? null : ownerId ? colorsMap.get(String(ownerId)) ?? "#d4af37" : null;

      visibleCells.push({
        cellId: id,
        q: coord.q,
        r: coord.r,
        terrain: isHidden ? "desconocido" : realTerrain,
        ownerKingdomId: isHidden ? null : ownerId,
        ownerName: isHidden ? null : ownerId ? names.get(String(ownerId)) ?? null : null,
        ownerColor,
        isHome: isHidden ? false : dbKnown?.isHome ?? false,
        state,
        canExplore,
        canConquer,
        explorationPlan,
        expedition,
      });
    }

    return {
      radius: MAP.RADIUS,
      worldSeed: MAP.WORLD_SEED,
      generated: true,
      terrains: TERRAINS,
      totalCells: MAP.MAX_CELLS,
      exploredCount: knownIds.size,
      activeExpeditions: activeQueue.map((exp) => ({
        expeditionId: exp._id,
        cellId: exp.cellId,
        completesAt: exp.completesAt,
        durationMs: exp.durationMs,
        progressPercent: explorationProgress(exp.startedAt, exp.durationMs, now),
        isSpyMission: exp.isSpyMission ?? false,
      })),
      activeMarches: activeMarchesDocs
        .filter((m) => m.status === "marchando")
        .map((m) => ({
          marchId: m._id,
          cellId: m.targetCellId,
          targetQ: m.targetQ,
          targetR: m.targetR,
          startedAt: m.startedAt,
          durationMs: m.durationMs,
          completesAt: m.completesAt,
          progressPercent: m.durationMs > 0 ? Math.min(100, Math.floor(((now - m.startedAt) / m.durationMs) * 100)) : 100,
          isConquest: m.isConquest ?? false,
          units: m.units,
        })),
      kingdomLegend: legendList,
      pendingClaims: kingdom?.pendingTerritoryClaims ?? 0,
      homeTerritoryId: kingdom?.homeTerritoryId ?? null,
      visibleCells,
    };
  },
});

export const getKingdomTerritories = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    const isDemoRead = kingdom.userId === DEMO_USER_ID;
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar su propio reino.");
    }
    const [owned, explored, queue] = await Promise.all([
      ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", args.kingdomId))
        .collect(),
      ctx.db
        .query("exploredTerritories")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
        .collect(),
      ctx.db
        .query("explorationQueue")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
        .collect(),
    ]);

    const homeCoord = kingdom.homeTerritoryId ? parseCellId(kingdom.homeTerritoryId) : null;
    const initialSight = getInitialSightCellIds(homeCoord, EXPLORATION.INITIAL_SIGHT_RADIUS, MAP.RADIUS);
    const knownSet = new Set<string>([...owned.map((c) => c.cellId), ...initialSight, ...explored.map((e) => e.cellId)]);

    return {
      homeTerritoryId: kingdom.homeTerritoryId ?? null,
      pendingClaims: kingdom.pendingTerritoryClaims ?? 0,
      exploredCount: knownSet.size,
      activeExpeditions: queue.length,
      territories: owned.map((cell) => ({
        cellId: cell.cellId,
        q: cell.q,
        r: cell.r,
        terrain: cell.terrain,
        isHome: cell.isHome ?? false,
      })),
      recentDiscoveries: explored.slice(-25).map((e) => ({
        cellId: e.cellId,
        discoveredAt: e.discoveredAt,
        note: e.discoveryNote ?? "Territorio cartografiado",
      })),
    };
  },
});

/** Reinos existentes sin territorio principal (anteriores a esta regla) pueden recibir uno. */
export const ensureMyHomeTerritory = mutation({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.kingdomId);
    const homeTerritoryId = await ensureHomeTerritory(ctx, args.kingdomId);
    return { success: homeTerritoryId !== null, homeTerritoryId };
  },
});

/**
 * [P22] Lógica autoritativa unificada para iniciar una expedición de exploración con espías.
 * Aplica siempre canStartExploration (límite de expediciones concurrentes, costes progresivos,
 * bonificaciones de civilización y tecnología spy_2) y reserva atómica de espías y recursos.
 */
async function executeExplorationStart(
  ctx: MutationCtx,
  args: { kingdomId: Id<"kingdoms">; cellId: string; spiesCount?: number }
) {
  const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
  await ensureHomeTerritory(ctx, args.kingdomId);
  const now = Date.now();

  // 1. Resolver expediciones previas que ya hayan cumplido su tiempo
  await resolveExpiredExpeditions(ctx, args.kingdomId, now);

  // 2. Comprobar existencia de la celda
  const target = await getOrCreateTerritoryCell(ctx, args.cellId);
  if (!target) {
    throw new Error("La celda indicada no existe en el mapa de La Conquista.");
  }

  const spiesCount = args.spiesCount ?? 1;
  if (!Number.isInteger(spiesCount) || spiesCount < 1) {
    throw new Error("La cantidad de espías debe ser un número entero positivo.");
  }

  // 3. Recopilar celdas conocidas, activas, unidades de ejército y tecnologías
  const [ownedDocs, exploredDocs, activeQueue, units, completedTech] = await Promise.all([
    ctx.db
      .query("territories")
      .withIndex("by_owner", (q) => q.eq("ownerKingdomId", args.kingdomId))
      .collect(),
    ctx.db
      .query("exploredTerritories")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
      .collect(),
    ctx.db
      .query("explorationQueue")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
      .collect(),
    readArmyUnitsWithMigration(ctx, args.kingdomId),
    readCompletedTechnologyIds(ctx, args.kingdomId),
  ]);

  const hasSpy2Tech = completedTech.includes("spy_2");
  const availableSpies = units
    .filter((u) => isSpyUnitDoc(u))
    .reduce((sum, u) => sum + Math.max(0, u.count ?? 0), 0);

  const homeCoord = kingdom.homeTerritoryId ? parseCellId(kingdom.homeTerritoryId) : null;
  const initialSight = getInitialSightCellIds(homeCoord, EXPLORATION.INITIAL_SIGHT_RADIUS, MAP.RADIUS);
  const knownSet = new Set<string>([
    ...ownedDocs.map((c) => c.cellId),
    ...initialSight,
    ...exploredDocs.map((e) => e.cellId),
  ]);

  const activeSet = new Set<string>(activeQueue.map((e) => e.cellId));

  // 4. Liquidar economía y obtener saldos actualizados
  const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
  const currentResources = {
    gold: settled.settledResources.gold,
    food: settled.settledResources.food,
  };

  // 5. Validar reglas puras de exploración con espías profesionales
  const check = canStartExploration({
    targetCoord: { q: target.q, r: target.r },
    targetCellId: target.cellId,
    knownCellIds: knownSet,
    activeCellIds: activeSet,
    ownedCoords: ownedDocs.map((c) => ({ q: c.q, r: c.r })),
    availableSpies,
    currentResources,
    activeExpeditionsCount: activeQueue.length,
    worldRadius: MAP.RADIUS,
    civilization: kingdom.civilization,
    hasSpy2Tech,
  });

  if (!check.success) {
    throw new Error(check.error);
  }

  if (availableSpies < spiesCount) {
    throw new Error(`No tienes suficientes espías profesionales disponibles (solicitados: ${spiesCount}, disponibles: ${availableSpies}). Recluta espías en el Cuartel.`);
  }

  const { plan } = check;

  // Duración con colaboración multi-espía
  const collaborationFactor = 1 / Math.sqrt(spiesCount);
  const durationMs = Math.ceil(plan.durationMs * collaborationFactor);
  const durationSeconds = Math.ceil(durationMs / 1000);

  // 6. Deducir costes de recursos de forma atómica
  await ctx.db.patch(settled.resources._id, {
    gold: settled.settledResources.gold - plan.costs.gold,
    food: settled.settledResources.food - plan.costs.food,
  });

  // 7. Reservar espías profesionales del ejército
  let remainingToDeduct = spiesCount;
  for (const u of units) {
    if (isSpyUnitDoc(u) && (u.count ?? 0) > 0 && remainingToDeduct > 0) {
      const take = Math.min(u.count, remainingToDeduct);
      await ctx.db.patch(u._id, { count: u.count - take });
      remainingToDeduct -= take;
    }
  }

  // 8. Crear documento de expedición en cola
  const completesAt = now + durationMs;
  const expeditionId = await ctx.db.insert("explorationQueue", {
    kingdomId: args.kingdomId,
    cellId: args.cellId,
    targetQ: target.q,
    targetR: target.r,
    distance: plan.distance,
    startedAt: now,
    durationMs,
    completesAt,
    scoutsCount: spiesCount,
    costs: plan.costs,
    isSpyMission: true,
  });

  // 9. Programar finalización autoritativa mediante el scheduler de Convex
  await ctx.scheduler.runAt(completesAt, internal.territories.completeExplorationScheduled, {
    expeditionId,
  });

  return {
    success: true,
    expeditionId,
    cellId: args.cellId,
    completesAt,
    durationMs,
    durationSeconds,
    distance: plan.distance,
    costs: plan.costs,
  };
}

/**
 * [P22] Envía una expedición autoritativa de exploración para cartografiar un hexágono desconocido.
 */
export const startExploration = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    cellId: v.string(),
    spiesCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => executeExplorationStart(ctx, args),
});

/**
 * Alias retrocompatible de startExploration: comparte exactamente las mismas reglas, límites,
 * costes y bonificaciones para impedir cualquier omisión de controles del servidor.
 */
export const startSpyExploration = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    cellId: v.string(),
    spiesCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => executeExplorationStart(ctx, args),
});


/**
 * Cancela una expedición de exploración en curso, reembolsando el 50 % de recursos y liberando al explorador.
 */
export const cancelExploration = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    expeditionId: v.id("explorationQueue"),
  },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    const expedition = await ctx.db.get(args.expeditionId);
    if (!expedition || expedition.kingdomId !== args.kingdomId) {
      throw new Error("La expedición de exploración no existe en este reino.");
    }

    const now = Date.now();
    if (now >= expedition.completesAt) {
      throw new ConvexError("No se puede cancelar una expedición que ya ha alcanzado su tiempo de finalización.");
    }
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const refund = calculateExplorationRefund(expedition.costs);

    // 1. Reembolsar recursos
    await ctx.db.patch(settled.resources._id, {
      gold: settled.settledResources.gold + refund.gold,
      food: settled.settledResources.food + refund.food,
    });

    // 2. Devolver espía o liberar explorador civil según el tipo de misión
    const returnedUnits = expedition.scoutsCount ?? 1;
    if (expedition.isSpyMission) {
      await addUnits(ctx, args.kingdomId, "espia", 1, returnedUnits);
    } else {
      const populationDoc = await ctx.db
        .query("population")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
        .first();

      if (populationDoc) {
        await ctx.db.patch(populationDoc._id, {
          available: (populationDoc.available ?? 0) + returnedUnits,
        });
      }
    }

    // 3. Eliminar de la cola
    await ctx.db.delete(args.expeditionId);

    return {
      success: true,
      refund,
      returnedSpies: expedition.isSpyMission ? returnedUnits : 0,
      message: expedition.isSpyMission
        ? `Misión de espionaje hacia ${expedition.cellId} cancelada. ${returnedUnits} espía(s) regresaron y se reembolsaron ${refund.gold} oro y ${refund.food} alimentos.`
        : `Expedición hacia ${expedition.cellId} cancelada. Reembolso: ${refund.gold} oro y ${refund.food} alimentos.`,
    };
  },
});

/**
 * Finalización programada en el servidor mediante el scheduler autoritativo de Convex.
 */
export const completeExplorationScheduled = internalMutation({
  args: { expeditionId: v.id("explorationQueue") },
  handler: async (ctx, args) => {
    return completeExpedition(ctx, args.expeditionId);
  },
});

/**
 * Permite al soberano forzar la resolución inmediata de expediciones vencidas si el scheduler no se ejecutó.
 */
export const resolveCompletedExplorations = mutation({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.kingdomId);
    const now = Date.now();
    const completed = await resolveExpiredExpeditions(ctx, args.kingdomId, now);
    return { success: true, count: completed.length, completed };
  },
});

/** [MAESTRA P47-P49] Reclama un territorio libre cercano usando una reclamación obtenida por victoria aplastante. */
export const claimFreeTerritory = mutation({
  args: { kingdomId: v.id("kingdoms"), cellId: v.string() },
  handler: async (ctx, args) => {
    const { kingdom } = await requireOwner(ctx, args.kingdomId);
    await ensureHomeTerritory(ctx, args.kingdomId);
    const target = await getOrCreateTerritoryCell(ctx, args.cellId);
    if (!target) throw new Error("El territorio indicado no existe en el mapa.");

    const [owned, exploredDocs] = await Promise.all([
      ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", args.kingdomId))
        .collect(),
      ctx.db
        .query("exploredTerritories")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
        .collect(),
    ]);

    const homeCoord = kingdom.homeTerritoryId ? parseCellId(kingdom.homeTerritoryId) : null;
    const initialSight = getInitialSightCellIds(homeCoord, EXPLORATION.INITIAL_SIGHT_RADIUS, MAP.RADIUS);
    const knownSet = new Set<string>([
      ...owned.map((c) => c.cellId),
      ...initialSight,
      ...exploredDocs.map((e) => e.cellId),
    ]);

    const check = canClaimTerritory({
      target: { cellId: target.cellId, q: target.q, r: target.r, terrain: target.terrain as any, ownerKingdomId: target.ownerKingdomId ?? null },
      ownedCells: owned.map((cell) => ({ q: cell.q, r: cell.r })),
      pendingClaims: kingdom.pendingTerritoryClaims ?? 0,
      exploredCellIds: knownSet,
      ownedCount: owned.length,
      maxTerritories: TERRITORIES.MAX_PER_KINGDOM,
    });
    if (!check.success) throw new Error(check.error);

    const now = Date.now();
    await ctx.db.patch(target._id, { ownerKingdomId: args.kingdomId, isHome: false, claimedAt: now });
    await ctx.db.patch(args.kingdomId, {
      pendingTerritoryClaims: (kingdom.pendingTerritoryClaims ?? 0) - 1,
      glory: (kingdom.glory ?? 0) + 1,
      honor: (kingdom.honor ?? 0) + 1,
      conquestRewardsGranted: (kingdom.conquestRewardsGranted ?? 0) + 1,
      updatedAt: now,
    });

    // Si aún no estaba en la tabla de explorados, registrarlo
    if (!exploredDocs.some((e) => e.cellId === target.cellId)) {
      await ctx.db.insert("exploredTerritories", {
        kingdomId: args.kingdomId,
        cellId: target.cellId,
        discoveredAt: now,
        discoveryNote: `Territorio anexionado a la corona (${TERRAINS[target.terrain as TerrainType]?.label ?? target.terrain}).`,
      });
    }

    await recordMissionEvent(ctx, args.kingdomId, "territoriesClaimed", 1);
    return { success: true, cellId: target.cellId, terrain: target.terrain, remainingClaims: (kingdom.pendingTerritoryClaims ?? 0) - 1 };
  },
});

/** Libera todos los territorios poseídos por un reino (al reiniciar partida). */
export async function releaseTerritories(ctx: MutationCtx, kingdomId: Id<"kingdoms">): Promise<void> {
  const owned = await ctx.db
    .query("territories")
    .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdomId))
    .collect();
  for (const cell of owned) {
    await ctx.db.patch(cell._id, { ownerKingdomId: undefined, isHome: false, claimedAt: undefined });
  }
}

export type ReferentialRelationName =
  | "kingdomHome"
  | "territories"
  | "activeMarches"
  | "historicalMarches"
  | "explorationQueue"
  | "exploredTerritories"
  | "battles"
  | "challenges"
  | "buildings";

export interface ReferentialIntegrityIssue {
  relation: ReferentialRelationName;
  documentId: string;
  kingdomId?: string;
  cellId?: string;
  severity: "blocking" | "warning";
  reason: string;
}

export interface RelationAuditBreakdown {
  examined: number;
  valid: number;
  inconsistent: number;
  blocking: number;
}

export interface ReferentialIntegrityAudit {
  examinedCount: number;
  validCount: number;
  inconsistentCount: number;
  blockingCount: number;
  requiresInterventionCount: number;
  orphanedHomes: number;
  kingdomsOverCap: number;
  examinedByRelation: Record<ReferentialRelationName, number>;
  byRelation: Record<ReferentialRelationName, RelationAuditBreakdown>;
  inconsistencies: ReferentialIntegrityIssue[];
  intact: boolean;
}

interface ReferentialAuditContext {
  allKingdomIds: Set<string>;
  allTerritoriesByCellId: Map<string, Doc<"territories">[]>;
  allMarchesById: Map<string, Doc<"armyMarches">>;
  allActiveMarches: Doc<"armyMarches">[];
  allChallengesById: Map<string, Doc<"challenges">>;
  allBattleIds: Set<string>;
}

const REFERENTIAL_RELATIONS: readonly ReferentialRelationName[] = [
  "kingdomHome",
  "territories",
  "activeMarches",
  "historicalMarches",
  "explorationQueue",
  "exploredTerritories",
  "battles",
  "challenges",
  "buildings",
] as const;

function createEmptyRelationBreakdown(): Record<ReferentialRelationName, RelationAuditBreakdown> {
  return {
    kingdomHome: { examined: 0, valid: 0, inconsistent: 0, blocking: 0 },
    territories: { examined: 0, valid: 0, inconsistent: 0, blocking: 0 },
    activeMarches: { examined: 0, valid: 0, inconsistent: 0, blocking: 0 },
    historicalMarches: { examined: 0, valid: 0, inconsistent: 0, blocking: 0 },
    explorationQueue: { examined: 0, valid: 0, inconsistent: 0, blocking: 0 },
    exploredTerritories: { examined: 0, valid: 0, inconsistent: 0, blocking: 0 },
    battles: { examined: 0, valid: 0, inconsistent: 0, blocking: 0 },
    challenges: { examined: 0, valid: 0, inconsistent: 0, blocking: 0 },
    buildings: { examined: 0, valid: 0, inconsistent: 0, blocking: 0 },
  };
}

function createEmptyExaminedByRelation(): Record<ReferentialRelationName, number> {
  return {
    kingdomHome: 0,
    territories: 0,
    activeMarches: 0,
    historicalMarches: 0,
    explorationQueue: 0,
    exploredTerritories: 0,
    battles: 0,
    challenges: 0,
    buildings: 0,
  };
}

function extractReportCellId(report: unknown): string | null {
  if (!report || typeof report !== "object") return null;
  const r = report as Record<string, unknown>;
  if (typeof r.targetCellId === "string" && r.targetCellId.trim().length > 0) return r.targetCellId.trim();
  if (typeof r.cellId === "string" && r.cellId.trim().length > 0) return r.cellId.trim();
  return null;
}

async function auditKingdomTerritoryReferentialIntegrity(
  ctx: MutationCtx,
  kingdom: Doc<"kingdoms">,
  plannedReleaseCellIds: Set<string>,
  phase: "before" | "after",
  auditCtx: ReferentialAuditContext
): Promise<ReferentialIntegrityAudit> {
  const [
    owned,
    kingdomMarches,
    explorations,
    explored,
    battlesAsAttacker,
    battlesAsDefender,
    challengesAsChallenger,
    challengesAsTarget,
    buildings,
  ] = await Promise.all([
    ctx.db
      .query("territories")
      .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdom._id))
      .collect(),
    ctx.db
      .query("armyMarches")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdom._id))
      .collect(),
    ctx.db
      .query("explorationQueue")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdom._id))
      .collect(),
    ctx.db
      .query("exploredTerritories")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdom._id))
      .collect(),
    ctx.db
      .query("Battle")
      .withIndex("by_attacker", (q) => q.eq("attackerKingdomId", kingdom._id))
      .collect(),
    ctx.db
      .query("Battle")
      .withIndex("by_defender", (q) => q.eq("defenderKingdomId", kingdom._id))
      .collect(),
    ctx.db
      .query("challenges")
      .withIndex("by_challenger", (q) => q.eq("challengerKingdomId", kingdom._id))
      .collect(),
    ctx.db
      .query("challenges")
      .withIndex("by_target", (q) => q.eq("targetKingdomId", kingdom._id))
      .collect(),
    ctx.db
      .query("buildings")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdom._id))
      .collect(),
  ]);

  const byRelation = createEmptyRelationBreakdown();
  const examinedByRelation = createEmptyExaminedByRelation();
  const inconsistencies: ReferentialIntegrityIssue[] = [];
  let orphanedHomes = 0;
  let kingdomsOverCap = 0;

  const markExamined = (rel: ReferentialRelationName) => {
    examinedByRelation[rel] += 1;
    byRelation[rel].examined += 1;
  };
  const markValid = (rel: ReferentialRelationName) => {
    byRelation[rel].valid += 1;
  };
  const recordIssue = (issue: ReferentialIntegrityIssue) => {
    inconsistencies.push(issue);
    byRelation[issue.relation].inconsistent += 1;
    if (issue.severity === "blocking") {
      byRelation[issue.relation].blocking += 1;
    }
  };

  // 1. Capital del reino (kingdoms.homeTerritoryId y territories.isHome)
  markExamined("kingdomHome");
  const markedHomes = owned.filter((c) => c.isHome === true);
  const homeById = kingdom.homeTerritoryId
    ? owned.find((c) => c.cellId === kingdom.homeTerritoryId)
    : undefined;

  if (owned.length === 0) {
    if (kingdom.homeTerritoryId) {
      orphanedHomes += 1;
      recordIssue({
        relation: "kingdomHome",
        documentId: String(kingdom._id),
        kingdomId: String(kingdom._id),
        cellId: kingdom.homeTerritoryId,
        severity: "blocking",
        reason: `homeTerritoryId '${kingdom.homeTerritoryId}' apunta a una celda no poseída por el reino.`,
      });
    } else {
      markValid("kingdomHome");
    }
  } else if (homeById) {
    if (plannedReleaseCellIds.has(homeById.cellId)) {
      orphanedHomes += 1;
      recordIssue({
        relation: "kingdomHome",
        documentId: String(kingdom._id),
        kingdomId: String(kingdom._id),
        cellId: homeById.cellId,
        severity: "blocking",
        reason: `La capital '${homeById.cellId}' no puede figurar entre las celdas planificadas para liberación.`,
      });
    } else {
      markValid("kingdomHome");
    }
  } else if (markedHomes.length === 1) {
    if (phase === "after") {
      orphanedHomes += 1;
      recordIssue({
        relation: "kingdomHome",
        documentId: String(kingdom._id),
        kingdomId: String(kingdom._id),
        cellId: kingdom.homeTerritoryId ?? markedHomes[0].cellId,
        severity: "blocking",
        reason: "homeTerritoryId no coincide con la capital marcada con isHome tras el saneamiento.",
      });
    } else {
      // Recuperable de forma segura mediante prioridad 2 (isHome único)
      recordIssue({
        relation: "kingdomHome",
        documentId: String(kingdom._id),
        kingdomId: String(kingdom._id),
        cellId: markedHomes[0].cellId,
        severity: "warning",
        reason: `homeTerritoryId ausente o inconsistente; recuperable desde isHome único '${markedHomes[0].cellId}'.`,
      });
    }
  } else {
    orphanedHomes += 1;
    recordIssue({
      relation: "kingdomHome",
      documentId: String(kingdom._id),
      kingdomId: String(kingdom._id),
      cellId: kingdom.homeTerritoryId ?? undefined,
      severity: "blocking",
      reason:
        markedHomes.length > 1
          ? `Capital histórica ambigua: ${markedHomes.length} territorios marcados con isHome sin homeTerritoryId válido.`
          : "No existe capital histórica identificable (homeTerritoryId ausente/inválido y sin isHome).",
    });
  }

  // 2. Territorios poseídos: unicidad de cellId, coherencia de coordenadas (q,r) y tope posterior
  for (const cell of owned) {
    markExamined("territories");
    const dupCount = auditCtx.allTerritoriesByCellId.get(cell.cellId)?.length ?? 0;
    const expectedCellId = `${cell.q},${cell.r}`;
    if (dupCount > 1) {
      recordIssue({
        relation: "territories",
        documentId: String(cell._id),
        kingdomId: String(kingdom._id),
        cellId: cell.cellId,
        severity: "blocking",
        reason: `Existen ${dupCount} documentos duplicados en territories para cellId '${cell.cellId}'.`,
      });
    } else if (cell.cellId !== expectedCellId) {
      recordIssue({
        relation: "territories",
        documentId: String(cell._id),
        kingdomId: String(kingdom._id),
        cellId: cell.cellId,
        severity: "blocking",
        reason: `Coordenadas incoherentes en territories: cellId '${cell.cellId}' no coincide con (${cell.q},${cell.r}).`,
      });
    } else {
      markValid("territories");
    }
  }
  if (phase === "after" && owned.length > TERRITORIES.MAX_PER_KINGDOM) {
    kingdomsOverCap += 1;
    recordIssue({
      relation: "territories",
      documentId: String(kingdom._id),
      kingdomId: String(kingdom._id),
      severity: "blocking",
      reason: `El reino sigue superando el tope máximo (${owned.length}/${TERRITORIES.MAX_PER_KINGDOM}).`,
    });
  }

  // 3. Marchas activas (cualquier reino hacia celdas a liberar + marchas activas propias) y marchas históricas
  const activeTargetingRelease = auditCtx.allActiveMarches.filter((m) =>
    plannedReleaseCellIds.has(m.targetCellId)
  );
  const examinedMarchIds = new Set<string>();
  const blockingMarchIds = new Set<string>();

  for (const m of activeTargetingRelease) {
    examinedMarchIds.add(String(m._id));
    blockingMarchIds.add(String(m._id));
    markExamined("activeMarches");
    recordIssue({
      relation: "activeMarches",
      documentId: String(m._id),
      kingdomId: String(m.kingdomId),
      cellId: m.targetCellId,
      severity: "blocking",
      reason: `Marcha activa en curso hacia la celda '${m.targetCellId}' planificada para liberación; requiere resolución previa.`,
    });
  }

  for (const m of kingdomMarches) {
    if (examinedMarchIds.has(String(m._id))) continue;
    examinedMarchIds.add(String(m._id));
    const expectedTargetCellId = `${m.targetQ},${m.targetR}`;
    const targetExists = auditCtx.allTerritoriesByCellId.has(m.targetCellId);
    const linkedChallenge = m.challengeId ? auditCtx.allChallengesById.get(String(m.challengeId)) : undefined;

    if (m.status === "marchando") {
      markExamined("activeMarches");
      if (!targetExists) {
        blockingMarchIds.add(String(m._id));
        recordIssue({
          relation: "activeMarches",
          documentId: String(m._id),
          kingdomId: String(m.kingdomId),
          cellId: m.targetCellId,
          severity: "blocking",
          reason: `Marcha activa apunta a una celda inexistente '${m.targetCellId}' en territories.`,
        });
      } else if (m.targetCellId !== expectedTargetCellId) {
        blockingMarchIds.add(String(m._id));
        recordIssue({
          relation: "activeMarches",
          documentId: String(m._id),
          kingdomId: String(m.kingdomId),
          cellId: m.targetCellId,
          severity: "blocking",
          reason: `Marcha activa con coordenadas incoherentes: targetCellId '${m.targetCellId}' != '${expectedTargetCellId}'.`,
        });
      } else if (m.challengeId && !linkedChallenge) {
        blockingMarchIds.add(String(m._id));
        recordIssue({
          relation: "activeMarches",
          documentId: String(m._id),
          kingdomId: String(m.kingdomId),
          cellId: m.targetCellId,
          severity: "blocking",
          reason: `Marcha activa referencia un desafío inexistente '${String(m.challengeId)}'.`,
        });
      } else if (
        linkedChallenge &&
        (linkedChallenge.status === "RESOLVED" ||
          linkedChallenge.status === "CANCELLED" ||
          linkedChallenge.status === "EXPIRED" ||
          linkedChallenge.status === "REJECTED")
      ) {
        blockingMarchIds.add(String(m._id));
        recordIssue({
          relation: "activeMarches",
          documentId: String(m._id),
          kingdomId: String(m.kingdomId),
          cellId: m.targetCellId,
          severity: "blocking",
          reason: `Marcha activa vinculada a un desafío en estado terminal incompatible '${linkedChallenge.status}'.`,
        });
      } else {
        markValid("activeMarches");
      }
    } else {
      // Registro histórico ("completada" | "cancelada"): conservar siempre, pero verificar referencias reales
      markExamined("historicalMarches");
      if (!targetExists) {
        recordIssue({
          relation: "historicalMarches",
          documentId: String(m._id),
          kingdomId: String(m.kingdomId),
          cellId: m.targetCellId,
          severity: "warning",
          reason: `Marcha histórica referencia una celda inexistente '${m.targetCellId}' en territories.`,
        });
      } else if (m.targetCellId !== expectedTargetCellId) {
        recordIssue({
          relation: "historicalMarches",
          documentId: String(m._id),
          kingdomId: String(m.kingdomId),
          cellId: m.targetCellId,
          severity: "warning",
          reason: `Marcha histórica con coordenadas incoherentes: targetCellId '${m.targetCellId}' != '${expectedTargetCellId}'.`,
        });
      } else if (m.challengeId && !linkedChallenge) {
        recordIssue({
          relation: "historicalMarches",
          documentId: String(m._id),
          kingdomId: String(m.kingdomId),
          cellId: m.targetCellId,
          severity: "warning",
          reason: `Marcha histórica referencia un desafío inexistente '${String(m.challengeId)}'.`,
        });
      } else {
        markValid("historicalMarches");
      }
    }
  }

  // 4. Cola de exploraciones activas (explorationQueue)
  for (const exp of explorations) {
    markExamined("explorationQueue");
    const expectedCellId = `${exp.targetQ},${exp.targetR}`;
    const targetExists = auditCtx.allTerritoriesByCellId.has(exp.cellId);
    if (!targetExists) {
      recordIssue({
        relation: "explorationQueue",
        documentId: String(exp._id),
        kingdomId: String(exp.kingdomId),
        cellId: exp.cellId,
        severity: "blocking",
        reason: `Expedición activa en explorationQueue apunta a una celda inexistente '${exp.cellId}'.`,
      });
    } else if (exp.cellId !== expectedCellId) {
      recordIssue({
        relation: "explorationQueue",
        documentId: String(exp._id),
        kingdomId: String(exp.kingdomId),
        cellId: exp.cellId,
        severity: "blocking",
        reason: `Expedición activa con coordenadas incoherentes: cellId '${exp.cellId}' != '${expectedCellId}'.`,
      });
    } else if (plannedReleaseCellIds.has(exp.cellId)) {
      recordIssue({
        relation: "explorationQueue",
        documentId: String(exp._id),
        kingdomId: String(exp.kingdomId),
        cellId: exp.cellId,
        severity: "blocking",
        reason: `Expedición activa del reino apunta a la celda '${exp.cellId}' planificada para liberación.`,
      });
    } else {
      markValid("explorationQueue");
    }
  }

  // 5. Territorios explorados (exploredTerritories: cartografía histórica conservada tras liberar propiedad)
  const seenExploredCells = new Set<string>();
  for (const exp of explored) {
    markExamined("exploredTerritories");
    if (!auditCtx.allTerritoriesByCellId.has(exp.cellId)) {
      recordIssue({
        relation: "exploredTerritories",
        documentId: String(exp._id),
        kingdomId: String(exp.kingdomId),
        cellId: exp.cellId,
        severity: "warning",
        reason: `Registro histórico de exploredTerritories apunta a una celda inexistente '${exp.cellId}'.`,
      });
    } else if (seenExploredCells.has(exp.cellId)) {
      recordIssue({
        relation: "exploredTerritories",
        documentId: String(exp._id),
        kingdomId: String(exp.kingdomId),
        cellId: exp.cellId,
        severity: "warning",
        reason: `Registro duplicado en exploredTerritories para la celda '${exp.cellId}'.`,
      });
    } else {
      seenExploredCells.add(exp.cellId);
      markValid("exploredTerritories");
    }
  }

  // 6. Informes de batalla históricos (Battle: conservar siempre, verificando referencias reales)
  const seenBattles = new Set<string>();
  for (const b of [...battlesAsAttacker, ...battlesAsDefender]) {
    if (seenBattles.has(String(b._id))) continue;
    seenBattles.add(String(b._id));
    markExamined("battles");

    const attackerExists = auditCtx.allKingdomIds.has(String(b.attackerKingdomId));
    const defenderExists = auditCtx.allKingdomIds.has(String(b.defenderKingdomId));
    const challengeMissing = Boolean(b.challengeId) && !auditCtx.allChallengesById.has(String(b.challengeId));
    const winnerInvalid =
      Boolean(b.winnerKingdomId) &&
      (!auditCtx.allKingdomIds.has(String(b.winnerKingdomId)) ||
        (String(b.winnerKingdomId) !== String(b.attackerKingdomId) &&
          String(b.winnerKingdomId) !== String(b.defenderKingdomId)));
    const reportCellId = extractReportCellId(b.report);
    const reportCellMissing = Boolean(reportCellId) && !auditCtx.allTerritoriesByCellId.has(reportCellId!);

    if (!attackerExists || !defenderExists) {
      recordIssue({
        relation: "battles",
        documentId: String(b._id),
        kingdomId: String(kingdom._id),
        severity: "warning",
        reason: `Informe de batalla histórico referencia un reino inexistente (atacante=${String(b.attackerKingdomId)}, defensor=${String(b.defenderKingdomId)}).`,
      });
    } else if (challengeMissing) {
      recordIssue({
        relation: "battles",
        documentId: String(b._id),
        kingdomId: String(kingdom._id),
        severity: "warning",
        reason: `Informe de batalla histórico referencia un desafío inexistente '${String(b.challengeId)}'.`,
      });
    } else if (winnerInvalid) {
      recordIssue({
        relation: "battles",
        documentId: String(b._id),
        kingdomId: String(kingdom._id),
        severity: "warning",
        reason: `Informe de batalla histórico tiene winnerKingdomId inválido '${String(b.winnerKingdomId)}'.`,
      });
    } else if (reportCellMissing) {
      recordIssue({
        relation: "battles",
        documentId: String(b._id),
        kingdomId: String(kingdom._id),
        cellId: reportCellId!,
        severity: "warning",
        reason: `Informe de batalla histórico referencia en report una celda inexistente '${reportCellId}'.`,
      });
    } else {
      markValid("battles");
    }
  }

  // 7. Desafíos parlamentarios (challenges: activos vs históricos, verificando reinos, activeMarchId y battleId)
  const seenChallenges = new Set<string>();
  for (const ch of [...challengesAsChallenger, ...challengesAsTarget]) {
    if (seenChallenges.has(String(ch._id))) continue;
    seenChallenges.add(String(ch._id));
    markExamined("challenges");

    const isActiveChallenge =
      ch.status === "PENDING" || ch.status === "ACCEPTED" || ch.status === "FROZEN";
    const severityForBrokenRef: "blocking" | "warning" = isActiveChallenge ? "blocking" : "warning";
    const challengerExists = auditCtx.allKingdomIds.has(String(ch.challengerKingdomId));
    const targetExists = auditCtx.allKingdomIds.has(String(ch.targetKingdomId));
    const linkedMarch = ch.activeMarchId ? auditCtx.allMarchesById.get(String(ch.activeMarchId)) : undefined;

    if (ch.activeMarchId && blockingMarchIds.has(String(ch.activeMarchId))) {
      recordIssue({
        relation: "challenges",
        documentId: String(ch._id),
        kingdomId: String(kingdom._id),
        cellId: linkedMarch?.targetCellId,
        severity: "blocking",
        reason: `Desafío '${String(ch._id)}' vinculado a una marcha activa hacia una celda incompatible o planificada para liberación.`,
      });
    } else if (!challengerExists || !targetExists) {
      recordIssue({
        relation: "challenges",
        documentId: String(ch._id),
        kingdomId: String(kingdom._id),
        severity: severityForBrokenRef,
        reason: `Desafío '${String(ch._id)}' (${ch.status}) referencia un reino inexistente.`,
      });
    } else if (ch.activeMarchId && !linkedMarch) {
      recordIssue({
        relation: "challenges",
        documentId: String(ch._id),
        kingdomId: String(kingdom._id),
        severity: severityForBrokenRef,
        reason: `Desafío '${String(ch._id)}' (${ch.status}) referencia activeMarchId inexistente '${String(ch.activeMarchId)}'.`,
      });
    } else if (
      linkedMarch &&
      !auditCtx.allTerritoriesByCellId.has(linkedMarch.targetCellId)
    ) {
      recordIssue({
        relation: "challenges",
        documentId: String(ch._id),
        kingdomId: String(kingdom._id),
        cellId: linkedMarch.targetCellId,
        severity: severityForBrokenRef,
        reason: `Desafío '${String(ch._id)}' (${ch.status}) apunta vía activeMarchId a una celda inexistente '${linkedMarch.targetCellId}'.`,
      });
    } else if (ch.battleId && !auditCtx.allBattleIds.has(String(ch.battleId))) {
      recordIssue({
        relation: "challenges",
        documentId: String(ch._id),
        kingdomId: String(kingdom._id),
        severity: severityForBrokenRef,
        reason: `Desafío '${String(ch._id)}' (${ch.status}) referencia battleId inexistente '${String(ch.battleId)}'.`,
      });
    } else {
      markValid("challenges");
    }
  }

  // 8. Edificios del reino (buildings: pertenecen al asentamiento/capital del reino, no a celdas periféricas)
  const capitalScheduledForRelease = Boolean(
    kingdom.homeTerritoryId && plannedReleaseCellIds.has(kingdom.homeTerritoryId)
  );
  const capitalUnresolvable = owned.length > 0 && !homeById && markedHomes.length !== 1;
  for (const b of buildings) {
    markExamined("buildings");
    const validKingdomRef =
      auditCtx.allKingdomIds.has(String(b.kingdomId)) && String(b.kingdomId) === String(kingdom._id);
    const validFields =
      typeof b.buildingType === "string" &&
      b.buildingType.trim().length > 0 &&
      Number.isFinite(b.level) &&
      b.level >= 0;

    if (!validKingdomRef) {
      recordIssue({
        relation: "buildings",
        documentId: String(b._id),
        kingdomId: String(b.kingdomId),
        severity: "blocking",
        reason: `Edificio '${b.buildingType}' referencia un reino inválido '${String(b.kingdomId)}'.`,
      });
    } else if (!validFields) {
      recordIssue({
        relation: "buildings",
        documentId: String(b._id),
        kingdomId: String(kingdom._id),
        severity: "blocking",
        reason: `Edificio con metadatos inválidos (buildingType='${b.buildingType}', level=${String(b.level)}).`,
      });
    } else if (capitalScheduledForRelease) {
      recordIssue({
        relation: "buildings",
        documentId: String(b._id),
        kingdomId: String(kingdom._id),
        cellId: kingdom.homeTerritoryId,
        severity: "blocking",
        reason: `Edificio '${b.buildingType}' quedaría sin soporte territorial al liberarse la capital '${kingdom.homeTerritoryId}'.`,
      });
    } else if (capitalUnresolvable) {
      recordIssue({
        relation: "buildings",
        documentId: String(b._id),
        kingdomId: String(kingdom._id),
        severity: "warning",
        reason: `Edificio '${b.buildingType}' asociado a un reino con capital histórica no identificable.`,
      });
    } else {
      markValid("buildings");
    }
  }

  const examinedCount = REFERENTIAL_RELATIONS.reduce((acc, rel) => acc + byRelation[rel].examined, 0);
  const validCount = REFERENTIAL_RELATIONS.reduce((acc, rel) => acc + byRelation[rel].valid, 0);
  const inconsistentCount = inconsistencies.length;
  const blockingCount = inconsistencies.filter((i) => i.severity === "blocking").length;
  const requiresInterventionCount = blockingCount;

  return {
    examinedCount,
    validCount,
    inconsistentCount,
    blockingCount,
    requiresInterventionCount,
    orphanedHomes,
    kingdomsOverCap,
    examinedByRelation,
    byRelation,
    inconsistencies,
    intact:
      examinedCount > 0 &&
      inconsistentCount === 0 &&
      blockingCount === 0 &&
      requiresInterventionCount === 0 &&
      orphanedHomes === 0 &&
      kingdomsOverCap === 0,
  };
}

function aggregateIntegrityAudits(audits: ReferentialIntegrityAudit[]): ReferentialIntegrityAudit {
  const examinedByRelation = createEmptyExaminedByRelation();
  const byRelation = createEmptyRelationBreakdown();
  let examinedCount = 0;
  let validCount = 0;
  let inconsistentCount = 0;
  let blockingCount = 0;
  let requiresInterventionCount = 0;
  let orphanedHomes = 0;
  let kingdomsOverCap = 0;
  const inconsistencies: ReferentialIntegrityIssue[] = [];

  for (const a of audits) {
    examinedCount += a.examinedCount;
    validCount += a.validCount;
    inconsistentCount += a.inconsistentCount;
    const auditBlocking = typeof a.blockingCount === "number" ? a.blockingCount : a.requiresInterventionCount;
    blockingCount += auditBlocking;
    requiresInterventionCount += a.requiresInterventionCount;
    orphanedHomes += a.orphanedHomes;
    kingdomsOverCap += a.kingdomsOverCap;
    for (const key of REFERENTIAL_RELATIONS) {
      examinedByRelation[key] += a.examinedByRelation?.[key] ?? 0;
      if (a.byRelation?.[key]) {
        byRelation[key].examined += a.byRelation[key].examined;
        byRelation[key].valid += a.byRelation[key].valid;
        byRelation[key].inconsistent += a.byRelation[key].inconsistent;
        byRelation[key].blocking += a.byRelation[key].blocking;
      }
    }
    inconsistencies.push(...(a.inconsistencies ?? []));
  }

  return {
    examinedCount,
    validCount,
    inconsistentCount,
    blockingCount,
    requiresInterventionCount,
    orphanedHomes,
    kingdomsOverCap,
    examinedByRelation,
    byRelation,
    inconsistencies,
    intact:
      (audits.length === 0 || examinedCount > 0) &&
      inconsistentCount === 0 &&
      blockingCount === 0 &&
      requiresInterventionCount === 0 &&
      orphanedHomes === 0 &&
      kingdomsOverCap === 0,
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function runTerritoryCapCleanup(
  ctx: MutationCtx,
  args: { dryRun?: boolean; kingdomId?: Id<"kingdoms">; operationId?: string }
) {
  const { adminIdentity } = await requireAuthorizedAdmin(ctx);
  const dryRun = args.dryRun ?? true;
  const mode: "dryRun" | "effective" = dryRun ? "dryRun" : "effective";
  const now = Date.now();
  const operationId =
    args.operationId && args.operationId.trim().length > 0
      ? args.operationId.trim()
      : `cap_cleanup_${mode}_${now}_${Math.random().toString(36).slice(2, 8)}`;

  const requestedScope: "single_kingdom" | "all_kingdoms" = args.kingdomId
    ? "single_kingdom"
    : "all_kingdoms";
  const requestedKingdomId = args.kingdomId ? String(args.kingdomId) : undefined;

  const targetKingdoms = args.kingdomId
    ? [await ctx.db.get(args.kingdomId)].filter((k): k is Doc<"kingdoms"> => Boolean(k))
    : await ctx.db.query("kingdoms").collect();
  const currentTargetKingdomIds = targetKingdoms.map((k) => String(k._id)).sort();

  // Idempotencia atómica de operación y registro de auditoría en Convex:
  // si operationId ya fue procesado, exigir coincidencia exacta de admin, modo y ámbito/conjunto de reinos.
  const existingLogs = await ctx.db
    .query("territoryCapAuditLogs")
    .withIndex("by_operation", (q) => q.eq("operationId", operationId))
    .collect();

  if (existingLogs.length > 0) {
    const firstLog = existingLogs[0];
    if (firstLog.adminIdentity !== adminIdentity) {
      throw new Error(
        `Conflicto de idempotencia: operationId '${operationId}' ya fue registrado por otro administrador.`
      );
    }
    if (firstLog.mode !== mode) {
      throw new Error(
        `Conflicto de idempotencia: operationId '${operationId}' ya fue registrado en modo '${firstLog.mode}' y no puede reutilizarse en modo '${mode}'.`
      );
    }

    const storedScope = firstLog.requestedScope;
    const storedRequestedKingdomId = firstLog.requestedKingdomId;
    const storedTargetKingdomIds = firstLog.targetKingdomIds
      ? [...firstLog.targetKingdomIds].sort()
      : existingLogs.map((l) => String(l.kingdomId)).sort();

    if (
      (storedScope !== undefined && storedScope !== requestedScope) ||
      storedRequestedKingdomId !== requestedKingdomId ||
      !arraysEqual(storedTargetKingdomIds, currentTargetKingdomIds)
    ) {
      throw new Error(
        `Conflicto de idempotencia: operationId '${operationId}' ya fue registrado con un ámbito o conjunto de reinos diferente.`
      );
    }

    const beforeAudits = existingLogs
      .map((l) => l.referentialIntegrityBefore as ReferentialIntegrityAudit | null)
      .filter((a): a is ReferentialIntegrityAudit => Boolean(a));
    const afterAudits = existingLogs
      .map((l) => l.referentialIntegrityAfter as ReferentialIntegrityAudit | null)
      .filter((a): a is ReferentialIntegrityAudit => Boolean(a));
    const beforeSummary = aggregateIntegrityAudits(beforeAudits);
    const afterSummary = aggregateIntegrityAudits(afterAudits);
    const blockedCount = existingLogs.filter((l) => l.outcome === "blocked").length;

    return {
      success: blockedCount === 0 && afterSummary.blockingCount === 0,
      idempotentReplay: true,
      operationId,
      adminIdentity: firstLog.adminIdentity,
      dryRun: firstLog.mode === "dryRun",
      mode: firstLog.mode,
      maxAllowed: TERRITORIES.MAX_PER_KINGDOM,
      kingdomsAudited: existingLogs.length,
      kingdomsModified: existingLogs.filter((l) => l.outcome === "cleaned").length,
      kingdomsBlocked: blockedCount,
      territoriesReleased: existingLogs.reduce((acc, l) => acc + l.releasedCount, 0),
      beforeIntegrity: beforeSummary,
      afterIntegrity: afterSummary,
      referentialIntegrity: {
        examinedCount: afterSummary.examinedCount,
        validCount: afterSummary.validCount,
        inconsistentCount: afterSummary.inconsistentCount,
        blockingCount: afterSummary.blockingCount,
        requiresInterventionCount: afterSummary.requiresInterventionCount,
        orphanedHomes: afterSummary.orphanedHomes,
        kingdomsOverCapAfter: afterSummary.kingdomsOverCap,
        intact: afterSummary.intact && blockedCount === 0,
      },
      details: existingLogs.map((l) => ({
        kingdomId: String(l.kingdomId),
        kingdomName: l.kingdomName,
        capitalCellId: l.capitalCellId,
        totalOwnedBefore: l.initialTerritoryCount,
        keptCount: l.keptCellIds.length,
        keptCellIds: l.keptCellIds,
        releasedCount: l.releasedCount,
        releasedCellIds: l.releasedCellIds,
        homeRepaired: false,
        skippedDemo: l.outcome === "skipped_demo",
        blocked: l.outcome === "blocked",
        outcome: l.outcome,
        errors: l.errors,
      })),
    };
  }

  const [allKingdoms, allMarches, allTerritories, allChallenges, allBattles] = await Promise.all([
    ctx.db.query("kingdoms").collect(),
    ctx.db.query("armyMarches").collect(),
    ctx.db.query("territories").collect(),
    ctx.db.query("challenges").collect(),
    ctx.db.query("Battle").collect(),
  ]);

  const allTerritoriesByCellId = new Map<string, Doc<"territories">[]>();
  for (const t of allTerritories) {
    const list = allTerritoriesByCellId.get(t.cellId);
    if (list) list.push(t);
    else allTerritoriesByCellId.set(t.cellId, [t]);
  }

  const auditCtx: ReferentialAuditContext = {
    allKingdomIds: new Set(allKingdoms.map((k) => String(k._id))),
    allTerritoriesByCellId,
    allMarchesById: new Map(allMarches.map((m) => [String(m._id), m])),
    allActiveMarches: allMarches.filter((m) => m.status === "marchando"),
    allChallengesById: new Map(allChallenges.map((c) => [String(c._id), c])),
    allBattleIds: new Set(allBattles.map((b) => String(b._id))),
  };

  const details: Array<{
    kingdomId: string;
    kingdomName: string;
    capitalCellId: string;
    totalOwnedBefore: number;
    keptCount: number;
    keptCellIds: string[];
    releasedCount: number;
    releasedCellIds: string[];
    homeRepaired: boolean;
    skippedDemo: boolean;
    blocked: boolean;
    outcome: "simulated" | "cleaned" | "noop" | "skipped_demo" | "blocked";
    errors: string[];
  }> = [];

  const beforeAudits: ReferentialIntegrityAudit[] = [];
  const afterAudits: ReferentialIntegrityAudit[] = [];
  let kingdomsModified = 0;
  let kingdomsBlocked = 0;
  let territoriesReleased = 0;

  for (const kingdom of targetKingdoms) {
    if (isDemoAccountUserId(kingdom.userId)) {
      const demoOwned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdom._id))
        .collect();
      // Auditoría real en modo solo lectura (sin mutar la cuenta demo)
      const demoIntegrity = await auditKingdomTerritoryReferentialIntegrity(
        ctx,
        kingdom,
        new Set(),
        "before",
        auditCtx
      );
      beforeAudits.push(demoIntegrity);
      afterAudits.push(demoIntegrity);

      await ctx.db.insert("territoryCapAuditLogs", {
        operationId,
        executedAt: now,
        adminIdentity,
        mode,
        kingdomId: kingdom._id,
        kingdomName: kingdom.name,
        initialTerritoryCount: demoOwned.length,
        capitalCellId: kingdom.homeTerritoryId ?? "",
        keptCellIds: demoOwned.map((c) => c.cellId),
        releasedCellIds: [],
        releasedCount: 0,
        referentialIntegrityBefore: demoIntegrity,
        referentialIntegrityAfter: demoIntegrity,
        outcome: "skipped_demo",
        errors: [],
        requestedScope,
        requestedKingdomId,
        targetKingdomIds: currentTargetKingdomIds,
      });
      details.push({
        kingdomId: String(kingdom._id),
        kingdomName: kingdom.name,
        capitalCellId: kingdom.homeTerritoryId ?? "",
        totalOwnedBefore: demoOwned.length,
        keptCount: demoOwned.length,
        keptCellIds: demoOwned.map((c) => c.cellId),
        releasedCount: 0,
        releasedCellIds: [],
        homeRepaired: false,
        skippedDemo: true,
        blocked: false,
        outcome: "skipped_demo",
        errors: [],
      });
      continue;
    }

    const owned = await ctx.db
      .query("territories")
      .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdom._id))
      .collect();

    const plan = planTerritoryCapCleanup({
      ownedCells: owned.map((c) => ({
        id: String(c._id),
        cellId: c.cellId,
        q: c.q,
        r: c.r,
        isHome: c.isHome,
        claimedAt: c.claimedAt,
      })),
      homeTerritoryId: kingdom.homeTerritoryId ?? null,
      maxAllowed: TERRITORIES.MAX_PER_KINGDOM,
    });

    const plannedReleaseSet = new Set(plan.releasedCellIds);
    const beforeAudit = await auditKingdomTerritoryReferentialIntegrity(
      ctx,
      kingdom,
      plannedReleaseSet,
      "before",
      auditCtx
    );
    beforeAudits.push(beforeAudit);

    const blockingErrors: string[] = [];
    if (plan.blocked && plan.reason) {
      blockingErrors.push(plan.reason);
    }
    for (const issue of beforeAudit.inconsistencies) {
      if (issue.severity === "blocking") {
        blockingErrors.push(`[${issue.relation}] ${issue.reason}`);
      }
    }

    const isBlocked = plan.blocked || beforeAudit.blockingCount > 0;
    let homeRepaired = false;

    if (isBlocked) {
      kingdomsBlocked += 1;
      afterAudits.push(beforeAudit);

      await ctx.db.insert("territoryCapAuditLogs", {
        operationId,
        executedAt: now,
        adminIdentity,
        mode,
        kingdomId: kingdom._id,
        kingdomName: kingdom.name,
        initialTerritoryCount: owned.length,
        capitalCellId: plan.capitalCellId,
        keptCellIds: owned.map((c) => c.cellId),
        releasedCellIds: [],
        releasedCount: 0,
        referentialIntegrityBefore: beforeAudit,
        referentialIntegrityAfter: beforeAudit,
        outcome: "blocked",
        errors: blockingErrors,
        requestedScope,
        requestedKingdomId,
        targetKingdomIds: currentTargetKingdomIds,
      });

      details.push({
        kingdomId: String(kingdom._id),
        kingdomName: kingdom.name,
        capitalCellId: plan.capitalCellId,
        totalOwnedBefore: owned.length,
        keptCount: owned.length,
        keptCellIds: owned.map((c) => c.cellId),
        releasedCount: 0,
        releasedCellIds: [],
        homeRepaired: false,
        skippedDemo: false,
        blocked: true,
        outcome: "blocked",
        errors: blockingErrors,
      });
      continue;
    }

    const capitalDoc = owned.find((c) => c.cellId === plan.capitalCellId);

    if (!dryRun) {
      if (plan.capitalCellId && kingdom.homeTerritoryId !== plan.capitalCellId) {
        await ctx.db.patch(kingdom._id, { homeTerritoryId: plan.capitalCellId });
        homeRepaired = true;
      }
      if (capitalDoc && !capitalDoc.isHome) {
        await ctx.db.patch(capitalDoc._id, { isHome: true });
        homeRepaired = true;
      }
      for (const c of owned) {
        if (c.cellId !== plan.capitalCellId && c.isHome) {
          await ctx.db.patch(c._id, { isHome: false });
          homeRepaired = true;
        }
      }
      if (!plan.skipped && plan.releasedCells.length > 0) {
        for (const cellDoc of owned) {
          if (plannedReleaseSet.has(cellDoc.cellId)) {
            await ctx.db.patch(cellDoc._id, {
              ownerKingdomId: undefined,
              isHome: false,
              claimedAt: undefined,
            });
          }
        }
      }
    }

    const freshKingdom = (await ctx.db.get(kingdom._id)) ?? kingdom;
    const afterAudit = dryRun
      ? beforeAudit
      : await auditKingdomTerritoryReferentialIntegrity(
          ctx,
          freshKingdom,
          new Set(),
          "after",
          auditCtx
        );
    afterAudits.push(afterAudit);

    const outcome: "simulated" | "cleaned" | "noop" = dryRun
      ? "simulated"
      : !plan.skipped || homeRepaired
        ? "cleaned"
        : "noop";

    if (!plan.skipped || homeRepaired) {
      kingdomsModified += 1;
    }
    territoriesReleased += plan.releasedCellIds.length;

    await ctx.db.insert("territoryCapAuditLogs", {
      operationId,
      executedAt: now,
      adminIdentity,
      mode,
      kingdomId: kingdom._id,
      kingdomName: kingdom.name,
      initialTerritoryCount: plan.totalOwned,
      capitalCellId: plan.capitalCellId,
      keptCellIds: plan.keptCellIds,
      releasedCellIds: plan.releasedCellIds,
      releasedCount: plan.releasedCellIds.length,
      referentialIntegrityBefore: beforeAudit,
      referentialIntegrityAfter: afterAudit,
      outcome,
      errors: [],
      requestedScope,
      requestedKingdomId,
      targetKingdomIds: currentTargetKingdomIds,
    });

    details.push({
      kingdomId: String(kingdom._id),
      kingdomName: kingdom.name,
      capitalCellId: plan.capitalCellId,
      totalOwnedBefore: plan.totalOwned,
      keptCount: plan.keptCellIds.length,
      keptCellIds: plan.keptCellIds,
      releasedCount: plan.releasedCellIds.length,
      releasedCellIds: plan.releasedCellIds,
      homeRepaired,
      skippedDemo: false,
      blocked: false,
      outcome,
      errors: [],
    });
  }

  const beforeSummary = aggregateIntegrityAudits(beforeAudits);
  const afterSummary = aggregateIntegrityAudits(afterAudits);

  return {
    success: kingdomsBlocked === 0 && afterSummary.blockingCount === 0,
    idempotentReplay: false,
    operationId,
    adminIdentity,
    dryRun,
    mode,
    maxAllowed: TERRITORIES.MAX_PER_KINGDOM,
    kingdomsAudited: targetKingdoms.length,
    kingdomsModified,
    kingdomsBlocked,
    territoriesReleased,
    beforeIntegrity: beforeSummary,
    afterIntegrity: afterSummary,
    referentialIntegrity: {
      examinedCount: afterSummary.examinedCount,
      validCount: afterSummary.validCount,
      inconsistentCount: afterSummary.inconsistentCount,
      blockingCount: afterSummary.blockingCount,
      requiresInterventionCount: afterSummary.requiresInterventionCount,
      orphanedHomes: afterSummary.orphanedHomes,
      kingdomsOverCapAfter: afterSummary.kingdomsOverCap,
      intact: afterSummary.intact && kingdomsBlocked === 0,
    },
    details,
  };
}

/**
 * Saneamiento administrativo, auditable e idempotente del tope de 100 territorios por reino (incluyendo capital).
 * Requiere identidad administrativa autorizada en servidor (ADMIN_USER_IDS), incluso en dryRun.
 * No altera recursos, ejércitos, edificios, historiales ni cuentas de demostración registradas.
 */
export const cleanupExcessTerritories = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    kingdomId: v.optional(v.id("kingdoms")),
    operationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => runTerritoryCapCleanup(ctx, args),
});

/**
 * Punto de entrada público protegido por autorización administrativa real en servidor.
 * Rechaza llamadas anónimas, cuentas de demostración y usuarios normales tanto en dryRun como en ejecución efectiva.
 */
export const executeTerritoryCapCleanup = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
    kingdomId: v.optional(v.id("kingdoms")),
    operationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => runTerritoryCapCleanup(ctx, args),
});

export const auditMapReduction = internalMutation({
  args: {},
  handler: async (ctx) => {
    const territories = await ctx.db.query("territories").collect();
    const toDelete = territories.filter(t => hexDistance({ q: t.q, r: t.r }, { q: 0, r: 0 }) > MAP.RADIUS);
    
    // Group by owner to count lost territories per kingdom
    const lostTerritories: Record<string, number> = {};
    for (const t of toDelete) {
        if (t.ownerKingdomId) {
            const id = String(t.ownerKingdomId);
            lostTerritories[id] = (lostTerritories[id] || 0) + 1;
        }
    }
    
    return {
        totalCells: territories.length,
        cellsToDelete: toDelete.length,
        lostTerritoriesByKingdom: lostTerritories
    };
  },
});

export const auditMapReductionDeep = internalQuery({
  args: {},
  handler: async (ctx) => {
    const radiusLimit = MAP.RADIUS;
    
    // Read data
    const territories = await ctx.db.query("territories").collect();
    const explorations = await ctx.db.query("exploredTerritories").collect();
    const expQueue = await ctx.db.query("explorationQueue").collect();
    const armyMarches = await ctx.db.query("armyMarches").collect();

    // Identify exterior elements
    const exteriorTerritories = territories.filter(t => hexDistance({ q: t.q, r: t.r }, { q: 0, r: 0 }) > radiusLimit);
    
    // Explored territories: need to parse cellId
    const exteriorExplorations = explorations.filter(e => {
        const parts = e.cellId.split(',');
        if (parts.length !== 2) return false;
        const q = Number(parts[0]);
        const r = Number(parts[1]);
        return hexDistance({ q, r }, { q: 0, r: 0 }) > radiusLimit;
    });

    // Expeditions
    const exteriorExpQueue = expQueue.filter(e => hexDistance({ q: e.targetQ, r: e.targetR }, { q: 0, r: 0 }) > radiusLimit);
    
    // Marches
    const exteriorMarches = armyMarches.filter(m => hexDistance({ q: m.targetQ, r: m.targetR }, { q: 0, r: 0 }) > radiusLimit);

    // Kingdoms affected
    const affectedKingdomIds = new Set<string>();
    exteriorTerritories.forEach(t => { if (t.ownerKingdomId) affectedKingdomIds.add(String(t.ownerKingdomId)); });
    
    return {
        territoriesToDelete: exteriorTerritories.length,
        exploredTerritoriesToDelete: exteriorExplorations.length,
        expeditionsToCancel: exteriorExpQueue.length,
        marchesToCancel: exteriorMarches.length,
        affectedKingdomCount: affectedKingdomIds.size,
    };
  },
});

/**
 * [R-14/P41] Previsualización autoritativa del plan de marcha militar entre el territorio principal
 * y una celda objetivo, utilizando los mismos datos de terreno que el servidor almacena.
 */
export const previewArmyMarchPlan = query({
  args: {
    kingdomId: v.id("kingdoms"),
    targetCellId: v.string(),
    composition: v.optional(v.record(v.string(), v.number())),
  },
  handler: async (ctx, args) => {
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    const homeCoord = await readHomeCoord(ctx, args.kingdomId);
    if (!homeCoord) throw new Error("El reino no tiene territorio principal asignado.");

    const target = await readTerritoryCell(ctx, args.targetCellId);
    if (!target) throw new Error("El territorio objetivo no existe.");

    const targetCoord = { q: target.q, r: target.r };
    const terrainMultiplier = await readPathTerrainMultiplier(ctx, homeCoord, targetCoord);
    const civPassive = getCivilizationPassive(kingdom.civilization);

    const comp: Partial<Record<UnitType, number>> = {};
    if (args.composition) {
      for (const [k, v] of Object.entries(args.composition)) {
        if (v > 0) comp[k as UnitType] = v;
      }
    } else {
      comp.infanteria = 1;
    }

    const currentFatigue = typeof kingdom.armyFatigue === "number" ? kingdom.armyFatigue : 0;
    const plan = calculateArmyMarchPlan({
      from: homeCoord,
      to: targetCoord,
      composition: comp,
      currentFatigue,
      departureTimeMs: Date.now(),
      terrainMultiplier,
      civilizationPassive: civPassive,
    });

    return {
      success: true,
      homeCoord,
      targetCoord,
      terrainMultiplier,
      plan,
    };
  },
});

/**
 * Delegador temporal retrocompatible: la lógica única y canónica vive en `convex/mapReduction.ts`.
 */
export const executeMapReduction = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => runMapReduction(ctx, args),
});
