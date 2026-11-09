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
import { EXPLORATION, MAP, TERRAINS, type TerrainType } from "./balanceConfig";
import {
  canClaimTerritory,
  chooseHomeCell,
  generateWorldCells,
  hexDistance,
  hexNeighbors,
  parseCellId,
  cellId,
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
export const expandWorld = mutation({
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

/** Asigna el territorio principal de un reino si aún no lo tiene (idempotente). */
export async function ensureHomeTerritory(ctx: MutationCtx, kingdomId: Id<"kingdoms">): Promise<string | null> {
  const kingdom = await ctx.db.get(kingdomId);
  if (!kingdom) return null;
  if (kingdom.homeTerritoryId) return kingdom.homeTerritoryId;
  await ensureWorld(ctx);
  const world = await readWorld(ctx);
  const alreadyOwned = world.find((cell) => cell.ownerKingdomId === kingdomId && cell.isHome);
  if (alreadyOwned) {
    await ctx.db.patch(kingdomId, { homeTerritoryId: alreadyOwned.cellId });
    return alreadyOwned.cellId;
  }
  const occupied = new Set(world.filter((cell) => cell.ownerKingdomId).map((cell) => cell.cellId));
  const homes: HexCoord[] = world.filter((cell) => cell.isHome).map((cell) => ({ q: cell.q, r: cell.r }));
  const choice = chooseHomeCell(world as WorldCell[], occupied, homes);
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

  const [world, exploredRecords, activeQueue] = await Promise.all([
    readWorld(ctx),
    ctx.db
      .query("exploredTerritories")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .collect(),
    ctx.db
      .query("explorationQueue")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .collect(),
  ]);

  const ownedCells = world.filter(c => c.ownerKingdomId && String(c.ownerKingdomId) === String(kingdomId));
  const homeCoord = await readHomeCoord(ctx, kingdomId);
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

  // Visión automática de fronteras: los vecinos de cada territorio propio son conocidos
  const coordsForVision: HexCoord[] = ownedCells.map((c) => ({ q: c.q, r: c.r }));
  if (homeCoord && !coordsForVision.some((c) => c.q === homeCoord.q && c.r === homeCoord.r)) {
    coordsForVision.push(homeCoord);
  }

  for (const coord of coordsForVision) {
    const neighbors = hexNeighbors(coord, MAP.RADIUS);
    for (const n of neighbors) {
      knownIds.add(cellId(n.q, n.r));
    }
  }

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

  const world = await readWorld(ctx);
  const discovered = new Set<Id<"kingdoms">>();

  for (const cell of world) {
    if (cell.ownerKingdomId && cell.ownerKingdomId !== kingdomId && knownCellIds.has(cell.cellId)) {
      discovered.add(cell.ownerKingdomId);
    }
  }

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

    // Si no se especifica kingdomId (vista global pública/demo), se devuelve el mapa cartográfico sin niebla
    if (!args.kingdomId) {
      return {
        radius: MAP.RADIUS,
        generated: world.length > 0,
        terrains: TERRAINS,
        totalCells: world.length,
        exploredCount: world.length,
        activeExpeditions: [],
        pendingClaims: 0,
        homeTerritoryId: null,
        cells: world.map((cell) => ({
          cellId: cell.cellId,
          q: cell.q,
          r: cell.r,
          terrain: cell.terrain,
          ownerKingdomId: cell.ownerKingdomId ?? null,
          ownerName: cell.ownerKingdomId ? names.get(String(cell.ownerKingdomId)) ?? null : null,
          isHome: cell.isHome ?? false,
          state: (cell.ownerKingdomId ? "owned" : "explored") as CellExplorationState,
          canExplore: false,
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
    const legendList: Array<{ id: string; name: string; monarchName?: string; color: string; territoryCount: number }> = [];

    for (const k of allKingdomDocs) {
      const ownedCount = world.filter((c) => c.ownerKingdomId && String(c.ownerKingdomId) === String(k._id)).length;
      const kColor = k.color ?? "#d4af37";
      colorsMap.set(String(k._id), kColor);
      if (ownedCount > 0) {
        legendList.push({
          id: String(k._id),
          name: k.name,
          monarchName: k.monarchName,
          color: kColor,
          territoryCount: ownedCount,
        });
      }
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

    // Celdas conocidas: territorios propios + visión inicial + exploradas guardadas + vecinos de frontera
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

    const activeExpeditionsCount = activeExpeditionMap.size;
    const canLaunchMore = activeExpeditionsCount < EXPLORATION.MAX_CONCURRENT_EXPEDITIONS;

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
            activeCellIds: new Set(activeExpeditionMap.keys()),
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
        // Debe haber al menos un vecino que sea propiedad del reino (capital o conquistado)
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

      const ownerColor = state === "fog" ? null : cell.ownerKingdomId ? (colorsMap.get(String(cell.ownerKingdomId)) ?? "#d4af37") : null;

      return {
        cellId: cell.cellId,
        q: cell.q,
        r: cell.r,
        // Si está en niebla de guerra, el terreno real queda oculto al jugador
        terrain: state === "fog" ? "desconocido" : cell.terrain,
        ownerKingdomId: state === "fog" ? null : cell.ownerKingdomId ?? null,
        ownerName: state === "fog" ? null : cell.ownerKingdomId ? names.get(String(cell.ownerKingdomId)) ?? null : null,
        ownerColor,
        isHome: state === "fog" ? false : cell.isHome ?? false,
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
 * [P22] Envía una expedición autoritativa de exploración para cartografiar un hexágono desconocido.
 */
export const startExploration = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    cellId: v.string(),
    spiesCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
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

    const spiesCount = Math.max(1, args.spiesCount ?? 1);

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
    const availableSpies = units.filter(u => u.isSpy || u.unitType === "espia").reduce((sum, u) => sum + Math.max(0, u.count ?? 0), 0);

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
      if ((u.isSpy || u.unitType === "espia") && (u.count ?? 0) > 0 && remainingToDeduct > 0) {
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
  },
});

export const startSpyExploration = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    cellId: v.string(),
    spiesCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { kingdom } = await requireOwner(ctx, args.kingdomId);
    const now = Date.now();

    // 1. Resolver expediciones previas
    await resolveExpiredExpeditions(ctx, args.kingdomId, now);

    // 2. Comprobar existencia de la celda
    const target = await getOrCreateTerritoryCell(ctx, args.cellId);

    if (!target) throw new Error("La celda indicada no existe.");

    const spiesCount = Math.max(1, args.spiesCount ?? 1);

    // 3. Comprobar disponibilidad de espías
    const units = await ctx.db
      .query("armyUnits")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
      .collect();
    
    const totalSpiesAvailable = units.filter(u => u.isSpy || u.unitType === "espia").reduce((sum, u) => sum + Math.max(0, u.count ?? 0), 0);
    if (totalSpiesAvailable < spiesCount) {
      throw new Error(`No tienes suficientes espías disponibles (solicitados: ${spiesCount}, disponibles: ${totalSpiesAvailable}).`);
    }

    // 4. Recopilar celdas conocidas
    const ownedDocs = await ctx.db
      .query("territories")
      .withIndex("by_owner", (q) => q.eq("ownerKingdomId", args.kingdomId))
      .collect();
    const exploredDocs = await ctx.db
      .query("exploredTerritories")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
      .collect();
    const activeQueue = await ctx.db
      .query("explorationQueue")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
      .collect();

    const homeCoord = kingdom.homeTerritoryId ? parseCellId(kingdom.homeTerritoryId) : null;
    const initialSight = getInitialSightCellIds(homeCoord, EXPLORATION.INITIAL_SIGHT_RADIUS, MAP.RADIUS);
    const knownSet = new Set<string>([
      ...ownedDocs.map((c) => c.cellId),
      ...initialSight,
      ...exploredDocs.map((e) => e.cellId),
    ]);

    if (knownSet.has(args.cellId)) throw new Error("Este territorio ya es conocido.");
    if (activeQueue.some(e => e.cellId === args.cellId)) throw new Error("Ya hay una misión hacia esta celda.");

    // 5. Validar adyacencia
    const neighbors = hexNeighbors({ q: target.q, r: target.r }, MAP.RADIUS);
    const bordersKnown = neighbors.some((n) => knownSet.has(cellId(n.q, n.r)));
    if (!bordersKnown) throw new Error("La celda debe limitar con un territorio ya conocido.");

    // 6. Calcular distancia
    let distance = 1;
    if (ownedDocs.length > 0) {
      distance = Math.max(1, Math.min(...ownedDocs.map((c) => hexDistance(c, { q: target.q, r: target.r }))));
    }

    // 7. Duración con colaboración multi-espía y tecnología spy_2
    const baseDurationSeconds = 1800 * distance;
    const baseDurationMs = baseDurationSeconds * 1000;
    const completedTech = await readCompletedTechnologyIds(ctx, args.kingdomId);
    const hasSpy2Tech = completedTech.includes("spy_2");
    const techMultiplier = hasSpy2Tech ? 0.90 : 1.0;
    const collaborationFactor = 1 / Math.sqrt(spiesCount);
    const durationMs = Math.ceil(baseDurationMs * techMultiplier * collaborationFactor);
    const durationSeconds = Math.ceil(durationMs / 1000);
    const completesAt = now + durationMs;

    // 8. Descontar espías
    let remainingToDeduct = spiesCount;
    for (const u of units) {
      if ((u.isSpy || u.unitType === "espia") && (u.count ?? 0) > 0 && remainingToDeduct > 0) {
        const take = Math.min(u.count, remainingToDeduct);
        await ctx.db.patch(u._id, { count: u.count - take });
        remainingToDeduct -= take;
      }
    }

    // 9. Crear misión
    const expeditionId = await ctx.db.insert("explorationQueue", {
      kingdomId: args.kingdomId,
      cellId: args.cellId,
      targetQ: target.q,
      targetR: target.r,
      distance,
      startedAt: now,
      durationMs,
      completesAt,
      scoutsCount: spiesCount,
      costs: { gold: 0, food: 0 },
      isSpyMission: true,
    });

    await ctx.scheduler.runAt(completesAt, internal.territories.completeExplorationScheduled, { expeditionId });

    return { success: true, expeditionId, cellId: args.cellId, completesAt, durationSeconds };
  },
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

    // 2. Liberar explorador
    const populationDoc = await ctx.db
      .query("population")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
      .first();

    if (populationDoc) {
      await ctx.db.patch(populationDoc._id, {
        available: (populationDoc.available ?? 0) + (expedition.scoutsCount ?? 1),
      });
    }

    // 3. Eliminar de la cola
    await ctx.db.delete(args.expeditionId);

    return {
      success: true,
      refund,
      message: `Expedición hacia ${expedition.cellId} cancelada. Reembolso: ${refund.gold} oro y ${refund.food} alimentos.`,
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
