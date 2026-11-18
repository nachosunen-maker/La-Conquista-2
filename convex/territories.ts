/**
 * LA CONQUISTA — MAPA, TERRITORIOS Y EXPLORACIÓN (Bloques G, P22, P47-P49)
 * El mundo se genera una sola vez (331 celdas, semilla reproducible). Cada reino
 * recibe un territorio principal al fundarse; los demás permanecen libres hasta
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
import { v } from "convex/values";
import { recordMissionEvent } from "./missions";
import { isKingdomOwner, DEMO_USER_ID } from "./kingdomAccess";
import { requireOwner } from "./buildings";
import { ensureAllKingdomsHaveColors } from "./kingdomColors";
import { addUnits, readArmyUnitDocs } from "./army";
import { isSpyUnitDoc } from "./armyRules";
import { runMapReduction } from "./mapReduction";
import { EXPLORATION, MAP, TERRAINS, TERRITORIES, type TerrainType } from "./balanceConfig";
import {
  canClaimTerritory,
  chooseHomeCell,
  generateWorldCells,
  hexDistance,
  hexNeighbors,
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
  if (existing.length >= MAP.MAX_CELLS) {
    return existing;
  }
  const existingMap = new Map<string, typeof existing[0]>();
  for (const t of existing) existingMap.set(t.cellId, t);

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
 * Asegura la existencia de las 7.651 celdas del mundo hexagonal (radio 50).
 * Si el mundo ya contiene celdas (p. ej. las 331 originales o un conjunto parcial),
 * CONSERVA ÍNTEGRAMENTE todos los registros existentes (sin modificar terrenos,
 * propietarios, capitales ni fechas de reclamación) e inserta únicamente las celdas
 * faltantes hasta completar exactamente las 7.651 celdas.
 * Es estrictamente idempotente.
 */
export async function ensureWorld(ctx: MutationCtx): Promise<number> {
  const existing = await ctx.db.query("territories").collect();
  if (existing.length >= MAP.MAX_CELLS) return 0;

  const existingIds = new Set(existing.map((cell) => cell.cellId));
  const targetCells = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
  let added = 0;

  for (const cell of targetCells) {
    if (!existingIds.has(cell.cellId)) {
      await ctx.db.insert("territories", {
        cellId: cell.cellId,
        q: cell.q,
        r: cell.r,
        terrain: cell.terrain,
      });
      existingIds.add(cell.cellId);
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
    const count = (await ctx.db.query("territories").collect()).length;
    return {
      success: true,
      added,
      totalCells: count,
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
  if (!kingdom) return null;

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
    const world = await readWorld(ctx);
    const ownerIds = [...new Set(world.map((cell) => cell.ownerKingdomId).filter((id): id is Id<"kingdoms"> => Boolean(id)))];
    const owners = await Promise.all(ownerIds.map((id) => ctx.db.get(id)));
    const names = new Map<string, string>();
    for (const owner of owners) if (owner) names.set(String(owner._id), owner.name);

    // Si no se especifica kingdomId (vista cartográfica global pública): solo terreno y coordenadas,
    // sin exponer propiedad, nombres de reinos, capitales ni ningún dato oculto por la niebla de guerra.
    if (!args.kingdomId) {
      return {
        radius: MAP.RADIUS,
        generated: world.length > 0,
        terrains: TERRAINS,
        totalCells: world.length,
        exploredCount: 0,
        activeExpeditions: [],
        kingdomLegend: [],
        pendingClaims: 0,
        homeTerritoryId: null,
        cells: world.map((cell) => ({
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

    // Consulta con visibilidad y niebla de guerra por reino (P22)
    const kingdomId = args.kingdomId;
    const kingdom = await ctx.db.get(kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");

    const identity = await ctx.auth.getUserIdentity();
    const isDemoRead = kingdom.userId === DEMO_USER_ID;
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar la niebla de guerra de su propio reino.");
    }

    const homeCoord = kingdom.homeTerritoryId ? parseCellId(kingdom.homeTerritoryId) : null;

    const ownedCells = world.filter((c) => c.ownerKingdomId && String(c.ownerKingdomId) === String(kingdomId));
    const [exploredRecords, activeQueue, completedTech, activeMarchesDocs, allKingdomDocs] = await Promise.all([
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
      ctx.db.query("kingdoms").collect(),
    ]);

    const colorsMap = new Map<string, string>();
    for (const k of allKingdomDocs) {
      colorsMap.set(String(k._id), k.color ?? "#d4af37");
    }

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

    // Celdas conocidas: territorios propios + visión inicial + exploradas guardadas
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

    // Leyenda filtrada estrictamente a territorios conocidos por este reino (sin filtrar reinos ni conteos bajo niebla)
    const knownOwnedCountByKingdom = new Map<string, number>();
    for (const cell of world) {
      if (cell.ownerKingdomId && knownIds.has(cell.cellId)) {
        const key = String(cell.ownerKingdomId);
        knownOwnedCountByKingdom.set(key, (knownOwnedCountByKingdom.get(key) ?? 0) + 1);
      }
    }
    const legendList: Array<{ id: string; name: string; monarchName?: string; color: string; territoryCount: number }> = [];
    for (const k of allKingdomDocs) {
      const visibleOwnedCount = knownOwnedCountByKingdom.get(String(k._id)) ?? 0;
      if (visibleOwnedCount > 0) {
        legendList.push({
          id: String(k._id),
          name: k.name,
          monarchName: k.monarchName,
          color: colorsMap.get(String(k._id)) ?? "#d4af37",
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

    const allKingdomDocs = await ctx.db.query("kingdoms").collect();
    const names = new Map<string, string>();
    const colorsMap = new Map<string, string>();
    for (const k of allKingdomDocs) {
      names.set(String(k._id), k.name);
      colorsMap.set(String(k._id), k.color ?? "#d4af37");
    }

    const ownedByKingdom = await Promise.all(
      allKingdomDocs.map(async (k) => ({
        kingdom: k,
        cells: await ctx.db
          .query("territories")
          .withIndex("by_owner", (q) => q.eq("ownerKingdomId", k._id))
          .collect(),
      }))
    );

    const ownedByCellId = new Map<string, Doc<"territories">>();
    for (const entry of ownedByKingdom) {
      for (const cell of entry.cells) {
        ownedByCellId.set(cell.cellId, cell);
      }
    }

    const kingdomId = args.kingdomId;
    const kingdom = allKingdomDocs.find((k) => k._id === kingdomId) ?? (await ctx.db.get(kingdomId));
    if (!kingdom) throw new Error("Reino no encontrado.");

    const identity = await ctx.auth.getUserIdentity();
    const isDemoRead = kingdom.userId === DEMO_USER_ID;
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar la niebla de guerra de su propio reino.");
    }

    const ownedCells = ownedByKingdom.find((e) => e.kingdom._id === kingdomId)?.cells ?? [];
    const [exploredRecords, activeQueue, completedTech, activeMarchesDocs] = await Promise.all([
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
    for (const c of ownedCells) ownedIds.add(String(c.cellId));
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

      const dbOwned = ownedByCellId.get(id);
      const isOwned = ownedIds.has(id);
      const isExploring = activeExpeditionMap.has(id);
      const isKnown = knownIds.has(id);

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
      if (state === "explored" && !dbOwned?.ownerKingdomId) {
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
      const realTerrain = dbOwned?.terrain ?? terrainForCell(coord.q, coord.r, MAP.WORLD_SEED, MAP.RADIUS);
      const ownerId = dbOwned?.ownerKingdomId ?? null;
      const ownerColor = isHidden ? null : ownerId ? colorsMap.get(String(ownerId)) ?? "#d4af37" : null;

      visibleCells.push({
        cellId: id,
        q: coord.q,
        r: coord.r,
        terrain: isHidden ? "desconocido" : realTerrain,
        ownerKingdomId: isHidden ? null : ownerId,
        ownerName: isHidden ? null : ownerId ? names.get(String(ownerId)) ?? null : null,
        ownerColor,
        isHome: isHidden ? false : dbOwned?.isHome ?? false,
        state,
        canExplore,
        canConquer,
        explorationPlan,
        expedition,
      });
    }

    // Leyenda filtrada estrictamente a territorios conocidos por este reino (idéntico a getWorldMap)
    const knownOwnedCountByKingdom = new Map<string, number>();
    for (const [cid, cell] of ownedByCellId.entries()) {
      if (cell.ownerKingdomId && knownIds.has(cid)) {
        const key = String(cell.ownerKingdomId);
        knownOwnedCountByKingdom.set(key, (knownOwnedCountByKingdom.get(key) ?? 0) + 1);
      }
    }
    const legendList: Array<{ id: string; name: string; monarchName?: string; color: string; territoryCount: number }> = [];
    for (const k of allKingdomDocs) {
      const visibleOwnedCount = knownOwnedCountByKingdom.get(String(k._id)) ?? 0;
      if (visibleOwnedCount > 0) {
        legendList.push({
          id: String(k._id),
          name: k.name,
          monarchName: k.monarchName,
          color: colorsMap.get(String(k._id)) ?? "#d4af37",
          territoryCount: visibleOwnedCount,
        });
      }
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
    readArmyUnitDocs(ctx, args.kingdomId),
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

/**
 * Saneamiento idempotente del tope de 100 territorios por reino (incluyendo capital).
 * No altera recursos, ejércitos, edificios, progreso ni el reino de demostración Iberia.
 */
export const cleanupExcessTerritories = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    kingdomId: v.optional(v.id("kingdoms")),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const targetKingdoms = args.kingdomId
      ? [await ctx.db.get(args.kingdomId)].filter((k): k is Doc<"kingdoms"> => Boolean(k))
      : await ctx.db.query("kingdoms").collect();

    const details: Array<{
      kingdomId: string;
      kingdomName: string;
      capitalCellId: string;
      totalOwnedBefore: number;
      keptCount: number;
      releasedCount: number;
      releasedCellIds: string[];
      homeRepaired: boolean;
      skippedDemo: boolean;
    }> = [];

    let kingdomsModified = 0;
    let territoriesReleased = 0;

    for (const kingdom of targetKingdoms) {
      if (kingdom.userId === DEMO_USER_ID || kingdom.userId === "guest_g9ai8cz") {
        details.push({
          kingdomId: String(kingdom._id),
          kingdomName: kingdom.name,
          capitalCellId: kingdom.homeTerritoryId ?? "",
          totalOwnedBefore: 0,
          keptCount: 0,
          releasedCount: 0,
          releasedCellIds: [],
          homeRepaired: false,
          skippedDemo: true,
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

      let homeRepaired = false;
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
          }
        }
        if (!plan.skipped && plan.releasedCells.length > 0) {
          const releaseIds = new Set(plan.releasedCellIds);
          for (const cellDoc of owned) {
            if (releaseIds.has(cellDoc.cellId)) {
              await ctx.db.patch(cellDoc._id, {
                ownerKingdomId: undefined,
                isHome: false,
                claimedAt: undefined,
              });
            }
          }
        }
      }

      if (!plan.skipped || homeRepaired) {
        kingdomsModified++;
      }
      territoriesReleased += plan.releasedCellIds.length;

      details.push({
        kingdomId: String(kingdom._id),
        kingdomName: kingdom.name,
        capitalCellId: plan.capitalCellId,
        totalOwnedBefore: plan.totalOwned,
        keptCount: plan.keptCellIds.length,
        releasedCount: plan.releasedCellIds.length,
        releasedCellIds: plan.releasedCellIds,
        homeRepaired,
        skippedDemo: false,
      });
    }

    // Verificación de integridad referencial posterior sobre los reinos inspeccionados
    let orphanedHomes = 0;
    let kingdomsOverCapAfter = 0;
    for (const kingdom of targetKingdoms) {
      if (kingdom.userId === DEMO_USER_ID || kingdom.userId === "guest_g9ai8cz") continue;
      const freshKingdom = await ctx.db.get(kingdom._id);
      const freshOwned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdom._id))
        .collect();
      if (freshOwned.length > TERRITORIES.MAX_PER_KINGDOM) kingdomsOverCapAfter++;
      if (freshKingdom?.homeTerritoryId && !freshOwned.some((c) => c.cellId === freshKingdom.homeTerritoryId)) {
        orphanedHomes++;
      }
    }

    return {
      success: true,
      dryRun,
      maxAllowed: TERRITORIES.MAX_PER_KINGDOM,
      kingdomsAudited: targetKingdoms.length,
      kingdomsModified,
      territoriesReleased,
      referentialIntegrity: {
        orphanedHomes,
        kingdomsOverCapAfter,
        intact: orphanedHomes === 0 && kingdomsOverCapAfter === 0,
      },
      details,
    };
  },
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
