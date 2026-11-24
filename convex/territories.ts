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
  auditExistingKingdomSpawns,
  canClaimTerritory,
  chooseHomeCell,
  generateWorldCells,
  hexDistance,
  hexNeighbors,
  inspectWorldIntegrity,
  parseCellId,
  cellId,
  planTerritoryCapCleanup,
  verifyTerritoryCapCleanupPostState,
  type ExistingKingdomAuditInput,
  type ExistingKingdomSpawn,
  type HexCoord,
  type TerritoryCapCleanupPlan,
  type TerritoryOwnershipSnapshot,
  type WorldCell,
  hexLine,
  pathTerrainMultiplier,
  calculateArmyMarchPlan,
  isInsideWorld,
  terrainForCell,
} from "./territoryRules";
import type { UnitType } from "./balanceConfig";
import { getCivilizationPassive } from "./civilizationRules";
import { computeTechnologyModifiers, readCompletedTechnologyIds } from "./technologyRules";
import {
  canStartExploration,
  calculateExplorationRefund,
  computeExplorationPlan,
  explorationProgress,
  generateExplorationDiscovery,
  getInitialSightCellIds,
  MIN_EXPLORATION_DURATION_MS,
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
        kingdomId: String(k._id),
      });
    }
  }

  const worldCells = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
  const choice = chooseHomeCell(worldCells, occupied, existingHomes, {
    civilization: kingdom.civilization,
    existingKingdoms,
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
    const techModifiers = computeTechnologyModifiers(completedTech);
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

    const visibleOwnerDocs = (
      await Promise.all(
        Array.from(visibleOwnerIdMap.values()).map((id) => ctx.db.get(id))
      )
    )
      .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
      .sort((a, b) => a._creationTime - b._creationTime || String(a._id).localeCompare(String(b._id)));
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
            explorationSpeedBonus: techModifiers.explorationSpeedBonus,
            explorationCostReduction: techModifiers.explorationCostReduction,
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

export const MAX_MAP_COLUMN_QUERIES = MAP.RADIUS * 2 + 1; // 101 columnas para R = 50
export const MAX_CONCURRENT_TERRITORY_QUERIES = 8;
/** Límite teórico máximo de documentos leídos incluyendo 1 documento centinela por columna: 7.651 + 101 = 7.752. */
export const MAX_THEORETICAL_DOCS_WITH_SENTINEL = MAP.MAX_CELLS + MAX_MAP_COLUMN_QUERIES;

export interface AxialColumnQuery {
  readonly q: number;
  readonly rMin: number;
  readonly rMax: number;
  readonly targetCount: number;
  readonly maxRangeSpan: number;
  /** Límite de lectura `.take(maxRangeSpan + 1)` para detectar duplicados en la columna sin lecturas ilimitadas. */
  readonly takeLimit: number;
}

export interface ColumnQueryPlanSummary {
  readonly columns: AxialColumnQuery[];
  readonly validUniqueKnownCount: number;
  readonly invalidOrDuplicateSkipped: number;
  readonly missingTargetCount: number;
  readonly theoreticalMaxRangeDocs: number;
  readonly theoreticalMaxRangeDocsWithSentinel: number;
  readonly geometricColumnUpperBound: number;
}

export interface ColumnQueryExecutionMetrics {
  readonly indexedQueriesCount: number;
  readonly docsRetrievedCount: number;
  readonly docsDiscardedCount: number;
  readonly docsAcceptedCount: number;
  readonly duplicatesDetected: number;
  readonly maxObservedConcurrency: number;
  readonly elapsedMs: number;
  readonly errors: string[];
}

/**
 * Planificador acotado por columna axial `q` para `getWorldMapCompact`:
 * 1. Valida coordenadas axiales dentro del disco (|q| <= R, |r| <= R, |q + r| <= R).
 * 2. Elimina identificadores inválidos y duplicados.
 * 3. Agrupa las celdas conocidas pendientes por columna `q`, calculando [rMin, rMax] y `takeLimit = maxRangeSpan + 1`.
 *
 * Garantías matemáticas para R = 50:
 * - q ∈ [-50, 50] => <= 2R + 1 = 101 consultas indexadas.
 * - Cada columna tiene n(q) = 101 - |q| celdas válidas; Σ_{q=-50}^{50} n(q) = 7.651.
 * - Con el documento centinela (+1 por columna) para detectar duplicados en DB, la cota absoluta de lecturas es
 *   7.651 + 101 = 7.752 (y 7.651 en un mapa íntegro sin duplicados).
 */
export function buildKnownColumnQueries(
  knownCellIds: Iterable<string>,
  alreadyLoadedIds: ReadonlySet<string>,
  radius: number = MAP.RADIUS
): ColumnQueryPlanSummary {
  const seenValid = new Set<string>();
  const byQ = new Map<number, { rMin: number; rMax: number; targetCount: number }>();
  let invalidOrDuplicateSkipped = 0;
  let missingTargetCount = 0;

  for (const rawId of knownCellIds) {
    const parsed = parseCellId(rawId);
    if (!parsed || !isInsideWorld(parsed, radius)) {
      invalidOrDuplicateSkipped++;
      continue;
    }
    const canonicalId = cellId(parsed.q, parsed.r);
    if (seenValid.has(canonicalId)) {
      invalidOrDuplicateSkipped++;
      continue;
    }
    seenValid.add(canonicalId);

    if (alreadyLoadedIds.has(canonicalId)) continue;
    missingTargetCount++;

    const existing = byQ.get(parsed.q);
    if (!existing) {
      byQ.set(parsed.q, { rMin: parsed.r, rMax: parsed.r, targetCount: 1 });
    } else {
      if (parsed.r < existing.rMin) existing.rMin = parsed.r;
      if (parsed.r > existing.rMax) existing.rMax = parsed.r;
      existing.targetCount++;
    }
  }

  const columns: AxialColumnQuery[] = [];
  let theoreticalMaxRangeDocs = 0;
  let theoreticalMaxRangeDocsWithSentinel = 0;
  let geometricColumnUpperBound = 0;
  const sortedQs = Array.from(byQ.keys()).sort((a, b) => a - b);

  for (let i = 0; i < sortedQs.length; i++) {
    const q = sortedQs[i];
    const entry = byQ.get(q)!;
    const maxRangeSpan = entry.rMax - entry.rMin + 1;
    const takeLimit = maxRangeSpan + 1;
    columns.push({
      q,
      rMin: entry.rMin,
      rMax: entry.rMax,
      targetCount: entry.targetCount,
      maxRangeSpan,
      takeLimit,
    });
    theoreticalMaxRangeDocs += maxRangeSpan;
    theoreticalMaxRangeDocsWithSentinel += takeLimit;
    geometricColumnUpperBound += (2 * radius + 1) - Math.abs(q);
  }

  return {
    columns,
    validUniqueKnownCount: seenValid.size,
    invalidOrDuplicateSkipped,
    missingTargetCount,
    theoreticalMaxRangeDocs,
    theoreticalMaxRangeDocsWithSentinel,
    geometricColumnUpperBound,
  };
}

/**
 * Ejecuta consultas por columna con concurrencia estrictamente acotada (lotes de hasta 8),
 * validando integridad de cada documento (`cellId`, `q`, `r`), detectando duplicados y
 * desbordamientos del documento centinela (`colDocs.length > col.maxRangeSpan`),
 * filtrando contra `knownIds` y propagando cualquier error sin devolver resultados parciales.
 */
export async function executeBoundedColumnQueries<T extends { cellId: string; q: number; r: number }>(
  columns: ReadonlyArray<AxialColumnQuery>,
  knownIds: ReadonlySet<string>,
  alreadyLoadedIds: ReadonlySet<string>,
  fetchColumn: (col: AxialColumnQuery) => Promise<ReadonlyArray<T>>,
  maxConcurrency: number = MAX_CONCURRENT_TERRITORY_QUERIES,
  radius: number = MAP.RADIUS
): Promise<{ docs: T[]; metrics: ColumnQueryExecutionMetrics }> {
  const start = Date.now();
  const batchLimit = Math.max(1, Math.min(maxConcurrency, MAX_CONCURRENT_TERRITORY_QUERIES));

  let inFlight = 0;
  let maxObservedConcurrency = 0;
  let docsRetrievedCount = 0;
  let docsDiscardedCount = 0;
  let duplicatesDetected = 0;
  const errors: string[] = [];
  const seenCoordsInQuery = new Set<string>();
  const acceptedById = new Map<string, T>();

  for (let offset = 0; offset < columns.length; offset += batchLimit) {
    const batch = columns.slice(offset, offset + batchLimit);
    const batchResults = await Promise.all(
      batch.map(async (col) => {
        inFlight++;
        if (inFlight > maxObservedConcurrency) maxObservedConcurrency = inFlight;
        try {
          return { col, colDocs: await fetchColumn(col) };
        } finally {
          inFlight--;
        }
      })
    );

    for (let i = 0; i < batchResults.length; i++) {
      const { col, colDocs } = batchResults[i];
      docsRetrievedCount += colDocs.length;

      // Comprobación del documento centinela (+1): si llegan más documentos que coordenadas válidas en [rMin, rMax],
      // existe necesariamente al menos un duplicado o registro inconsistente en la columna.
      if (colDocs.length > col.maxRangeSpan) {
        duplicatesDetected += colDocs.length - col.maxRangeSpan;
        const msg =
          `Anomalía de integridad en columna q=${col.q} [${col.rMin}, ${col.rMax}]: ` +
          `se recuperaron ${colDocs.length} documentos cuando el máximo válido del intervalo es ${col.maxRangeSpan} (centinela disparado).`;
        errors.push(msg);
        throw new Error(msg);
      }

      for (let j = 0; j < colDocs.length; j++) {
        const doc = colDocs[j];
        // 1. Coherencia estricta de cellId, q y r dentro del intervalo y del disco canónico
        const expectedId = cellId(doc.q, doc.r);
        if (
          !Number.isInteger(doc.q) ||
          !Number.isInteger(doc.r) ||
          doc.q !== col.q ||
          doc.r < col.rMin ||
          doc.r > col.rMax ||
          doc.cellId !== expectedId ||
          !isInsideWorld({ q: doc.q, r: doc.r }, radius)
        ) {
          const msg =
            `Inconsistencia de coordenadas en territorio: cellId="${doc.cellId}", q=${doc.q}, r=${doc.r} ` +
            `(esperado q=${col.q}, r∈[${col.rMin},${col.rMax}], cellId="${expectedId}").`;
          errors.push(msg);
          throw new Error(msg);
        }

        // 2. Detección explícita de duplicados en la misma coordenada (sin ocultarlos)
        if (seenCoordsInQuery.has(doc.cellId)) {
          duplicatesDetected++;
          const msg = `Registro duplicado detectado en la tabla territories para la coordenada ${doc.cellId}.`;
          errors.push(msg);
          throw new Error(msg);
        }
        seenCoordsInQuery.add(doc.cellId);

        if (!knownIds.has(doc.cellId) || alreadyLoadedIds.has(doc.cellId)) {
          docsDiscardedCount++;
          continue;
        }
        acceptedById.set(doc.cellId, doc);
      }
    }
  }

  return {
    docs: Array.from(acceptedById.values()),
    metrics: {
      indexedQueriesCount: columns.length,
      docsRetrievedCount,
      docsDiscardedCount,
      docsAcceptedCount: acceptedById.size,
      duplicatesDetected,
      maxObservedConcurrency,
      elapsedMs: Date.now() - start,
      errors,
    },
  };
}

/**
 * Núcleo compartido de `getWorldMapCompact` que conserva y devuelve métricas reales de consulta
 * sin escribir en base de datos ni añadir sobrecoste operativo.
 */
async function executeWorldMapCompactQuery(
  ctx: QueryCtx,
  args: { kingdomId?: Id<"kingdoms"> }
) {
  const emptyMetrics: ColumnQueryExecutionMetrics = {
    indexedQueriesCount: 0,
    docsRetrievedCount: 0,
    docsDiscardedCount: 0,
    docsAcceptedCount: 0,
    duplicatesDetected: 0,
    maxObservedConcurrency: 0,
    elapsedMs: 0,
    errors: [],
  };

  // Consulta global sin kingdomId: devuelve únicamente la base cartográfica pública (semilla y radio),
  // sin exponer celdas ocupadas, capitales ni leyenda de reinos ocultos por la niebla de guerra.
  if (!args.kingdomId) {
    return {
      payload: {
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
        recentDiscoveries: [],
      },
      metrics: emptyMetrics,
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

  // 3. Leer ÚNICAMENTE los datos propios del reino autorizado (marchas filtradas en servidor)
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
      .filter((q) => q.eq(q.field("status"), "marchando"))
      .collect(),
  ]);

  const techModifiers = computeTechnologyModifiers(completedTech);
  const homeCoord = kingdom.homeTerritoryId ? parseCellId(kingdom.homeTerritoryId) : null;

  const coordById = new Map<string, HexCoord>();
  const getValidCoord = (id: string): HexCoord | null => {
    const cached = coordById.get(id);
    if (cached) return cached;
    const parsed = parseCellId(id);
    if (!parsed || !isInsideWorld(parsed, MAP.RADIUS)) return null;
    coordById.set(id, parsed);
    return parsed;
  };

  const ownedIds = new Set<string>();
  const knownTerritoryByCellId = new Map<string, Doc<"territories">>();
  for (const c of ownedCells) {
    const id = String(c.cellId);
    const expectedId = cellId(c.q, c.r);
    if (!Number.isInteger(c.q) || !Number.isInteger(c.r) || id !== expectedId || !isInsideWorld({ q: c.q, r: c.r }, MAP.RADIUS)) {
      throw new Error(`Inconsistencia de coordenadas en territorio poseído: cellId="${id}", q=${c.q}, r=${c.r}.`);
    }
    if (knownTerritoryByCellId.has(id)) {
      throw new Error(`Registro duplicado detectado en territorios poseídos para la coordenada ${id}.`);
    }
    ownedIds.add(id);
    knownTerritoryByCellId.set(id, c);
    coordById.set(id, { q: c.q, r: c.r });
  }
  if (kingdom.homeTerritoryId) {
    ownedIds.add(String(kingdom.homeTerritoryId));
    if (homeCoord) coordById.set(String(kingdom.homeTerritoryId), homeCoord);
  }

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

  // Agrupar celdas conocidas pendientes por columna axial `q` con rango [rMin, rMax],
  // límite `.take(col.takeLimit)` (maxRangeSpan + 1 centinela) y concurrencia <= 8.
  const alreadyLoadedIds = new Set<string>(knownTerritoryByCellId.keys());
  const columnPlan = buildKnownColumnQueries(knownIds, alreadyLoadedIds, MAP.RADIUS);
  let queryMetrics: ColumnQueryExecutionMetrics = emptyMetrics;

  if (columnPlan.columns.length > 0) {
    const { docs: fetchedKnownDocs, metrics } = await executeBoundedColumnQueries(
      columnPlan.columns,
      knownIds,
      alreadyLoadedIds,
      (col) =>
        ctx.db
          .query("territories")
          .withIndex("by_q_r", (idx) => idx.eq("q", col.q).gte("r", col.rMin).lte("r", col.rMax))
          .take(col.takeLimit),
      MAX_CONCURRENT_TERRITORY_QUERIES,
      MAP.RADIUS
    );
    queryMetrics = metrics;
    for (let i = 0; i < fetchedKnownDocs.length; i++) {
      const doc = fetchedKnownDocs[i];
      knownTerritoryByCellId.set(doc.cellId, doc);
    }
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

  const visibleOwnerDocs = (
    await Promise.all(Array.from(visibleOwnerIdMap.values()).map((id) => ctx.db.get(id)))
  )
    .filter((k): k is Doc<"kingdoms"> => k !== null)
    .sort((a, b) => a._creationTime - b._creationTime);
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
      const coord = getValidCoord(knownId);
      if (!coord) continue;
      for (const n of hexNeighbors(coord, MAP.RADIUS)) {
        const nid = cellId(n.q, n.r);
        if (!knownIds.has(nid) && !activeExpeditionMap.has(nid) && !ownedIds.has(nid)) {
          frontierIds.add(nid);
          if (!coordById.has(nid)) coordById.set(nid, n);
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
    const coord = getValidCoord(id);
    if (!coord) continue;

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

    const canExplore = state === "fog" && canLaunchMore && frontierIds.has(id);

    const canConquer =
      isKnown &&
      !isOwned &&
      dbKnown?.ownerKingdomId !== undefined &&
      dbKnown.ownerKingdomId !== null;

    let explorationPlan = null;
    if (canExplore) {
      let minDist = Infinity;
      for (let i = 0; i < ownedCoords.length; i++) {
        const d = hexDistance(ownedCoords[i], coord);
        if (d < minDist) minDist = d;
      }
      if (!Number.isFinite(minDist)) minDist = 1;

      const plan = computeExplorationPlan({
        distance: minDist,
        civilization: kingdom.civilization,
        explorationSpeedBonus: techModifiers.explorationSpeedBonus,
        explorationCostReduction: techModifiers.explorationCostReduction,
      });
      explorationPlan = {
        distance: plan.distance,
        durationSeconds: plan.durationSeconds,
        costs: plan.costs,
      };
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
    payload: {
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
      activeMarches: activeMarchesDocs.map((m) => ({
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
      recentDiscoveries: exploredRecords.slice(-25).map((e) => ({
        cellId: e.cellId,
        discoveredAt: e.discoveredAt,
        note: e.discoveryNote ?? "Territorio cartografiado",
      })),
    },
    metrics: queryMetrics,
  };
}

/**
 * Consulta compacta del mapa mundial: evita leer las 7.651 filas de `territories` en Convex.
 * Agrupa celdas conocidas por columna axial `q` (<= 101 consultas, <= 8 concurrentes, `.take(span+1)` centinela)
 * y filtra estrictamente la niebla de guerra en servidor.
 */
export const getWorldMapCompact = query({
  args: {
    kingdomId: v.optional(v.id("kingdoms")),
  },
  handler: async (ctx, args) => {
    const { payload } = await executeWorldMapCompactQuery(ctx, args);
    return payload;
  },
});

/**
 * Consulta interna de diagnóstico para pruebas y auditoría: devuelve tanto el payload compacto
 * como las métricas reales de ejecución de columnas (sin descartar métricas ni escribir en DB).
 */
export const getWorldMapCompactWithDiagnostics = internalQuery({
  args: {
    kingdomId: v.optional(v.id("kingdoms")),
  },
  handler: async (ctx, args) => {
    return await executeWorldMapCompactQuery(ctx, args);
  },
});

/**
 * Auditoría geográfica de solo lectura para todos los reinos persistidos.
 * Recopila integridad territorial (duplicados, marcas isHome, tope de 100), actividades en curso
 * (marchas salientes y entrantes, expediciones, desafíos) y genera un plan global determinista
 * sin modificar ningún registro en base de datos.
 */
async function runKingdomSpawnAuditReadOnly(ctx: QueryCtx | MutationCtx) {
  const [allKingdoms, allActiveMarches] = await Promise.all([
    ctx.db.query("kingdoms").collect(),
    ctx.db
      .query("armyMarches")
      .filter((q) => q.eq(q.field("status"), "marchando"))
      .collect(),
  ]);

  const sortedKingdoms = [...allKingdoms].sort((a, b) =>
    String(a._id).localeCompare(String(b._id))
  );

  const incomingMarchesByTargetCell = new Map<string, typeof allActiveMarches>();
  for (const m of allActiveMarches) {
    const list = incomingMarchesByTargetCell.get(m.targetCellId) ?? [];
    list.push(m);
    incomingMarchesByTargetCell.set(m.targetCellId, list);
  }

  const inputs: ExistingKingdomAuditInput[] = await Promise.all(
    sortedKingdoms.map(async (k) => {
      const [owned, outgoingMarches, challengesAsChallenger, challengesAsTarget, explorations] = await Promise.all([
        ctx.db.query("territories").withIndex("by_owner", (q) => q.eq("ownerKingdomId", k._id)).collect(),
        ctx.db
          .query("armyMarches")
          .withIndex("by_kingdom", (q) => q.eq("kingdomId", k._id))
          .filter((q) => q.eq(q.field("status"), "marchando"))
          .collect(),
        ctx.db.query("challenges").withIndex("by_challenger", (q) => q.eq("challengerKingdomId", k._id)).collect(),
        ctx.db.query("challenges").withIndex("by_target", (q) => q.eq("targetKingdomId", k._id)).collect(),
        ctx.db.query("explorationQueue").withIndex("by_kingdom", (q) => q.eq("kingdomId", k._id)).collect(),
      ]);

      const sortedOwned = [...owned].sort(
        (a, b) => a.cellId.localeCompare(b.cellId) || String(a._id).localeCompare(String(b._id))
      );

      const seenOwnedIds = new Set<string>();
      const duplicateOwnedIds: string[] = [];
      let markedHomeCount = 0;
      for (const cell of sortedOwned) {
        if (seenOwnedIds.has(cell.cellId)) {
          duplicateOwnedIds.push(cell.cellId);
        } else {
          seenOwnedIds.add(cell.cellId);
        }
        if (cell.isHome === true) {
          markedHomeCount++;
        }
      }

      const homeDoc =
        (k.homeTerritoryId ? sortedOwned.find((c) => c.cellId === k.homeTerritoryId) : undefined) ??
        sortedOwned.find((c) => c.isHome) ??
        sortedOwned[0] ??
        null;

      // Recopilar marchas salientes y entrantes dirigidas a la capital actual del reino
      const homeCellForIncoming = k.homeTerritoryId ?? homeDoc?.cellId ?? null;
      const incomingMarches = homeCellForIncoming
        ? (incomingMarchesByTargetCell.get(homeCellForIncoming) ?? [])
        : [];

      const activeMarches = [
        ...outgoingMarches.map((m) => ({
          id: String(m._id),
          kingdomId: String(m.kingdomId),
          targetCellId: m.targetCellId,
          targetQ: m.targetQ,
          targetR: m.targetR,
          status: m.status,
          direction: "outgoing" as const,
          startedAt: m.startedAt,
          durationMs: m.durationMs,
          completesAt: m.completesAt,
          cancelledAt: m.cancelledAt ?? null,
          unitsRefundedAt: m.unitsRefundedAt ?? null,
          cancelReason: m.cancelReason ?? null,
        })),
        ...incomingMarches.map((m) => ({
          id: String(m._id),
          kingdomId: String(m.kingdomId),
          targetCellId: m.targetCellId,
          targetQ: m.targetQ,
          targetR: m.targetR,
          status: m.status,
          direction: "incoming" as const,
          startedAt: m.startedAt,
          durationMs: m.durationMs,
          completesAt: m.completesAt,
          cancelledAt: m.cancelledAt ?? null,
          unitsRefundedAt: m.unitsRefundedAt ?? null,
          cancelReason: m.cancelReason ?? null,
        })),
      ].sort((a, b) => a.id.localeCompare(b.id) || a.direction.localeCompare(b.direction));

      const activeChallengeMap = new Map<string, (typeof challengesAsChallenger)[number]>();
      for (const ch of [...challengesAsChallenger, ...challengesAsTarget]) {
        if (
          ch.status !== "RESOLVED" &&
          ch.status !== "CANCELLED" &&
          ch.status !== "EXPIRED" &&
          ch.status !== "REJECTED"
        ) {
          activeChallengeMap.set(String(ch._id), ch);
        }
      }
      const activeChallenges = Array.from(activeChallengeMap.values())
        .map((ch) => ({
          id: String(ch._id),
          challengerKingdomId: String(ch.challengerKingdomId),
          targetKingdomId: String(ch.targetKingdomId),
          status: ch.status,
          createdAt: ch.createdAt,
          expiresAt: ch.expiresAt,
          respondedAt: ch.respondedAt ?? null,
          scheduledAt: ch.scheduledAt ?? null,
          freezeAt: ch.freezeAt ?? null,
          frozenAt: ch.frozenAt ?? null,
          resolvedAt: ch.resolvedAt ?? null,
          cancelledAt: ch.cancelledAt ?? null,
          activeMarchId: ch.activeMarchId ? String(ch.activeMarchId) : null,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

      const activeExplorations = [...explorations]
        .map((e) => ({
          id: String(e._id),
          cellId: e.cellId,
          targetQ: e.targetQ,
          targetR: e.targetR,
          startedAt: e.startedAt,
          durationMs: e.durationMs,
          completesAt: e.completesAt,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

      const ownedTerritories = sortedOwned.map((c) => ({
        id: String(c._id),
        cellId: c.cellId,
        q: c.q,
        r: c.r,
        ownerKingdomId: c.ownerKingdomId ? String(c.ownerKingdomId) : null,
        isHome: c.isHome,
      }));

      return {
        kingdomId: String(k._id),
        name: k.name,
        civilization: k.civilization ?? null,
        homeTerritoryId: k.homeTerritoryId ?? null,
        persistedHomeCell: homeDoc
          ? {
              cellId: homeDoc.cellId,
              q: homeDoc.q,
              r: homeDoc.r,
              ownerKingdomId: homeDoc.ownerKingdomId ? String(homeDoc.ownerKingdomId) : null,
              isHome: homeDoc.isHome,
            }
          : null,
        ownedTerritoryCount: sortedOwned.length,
        ownedCellIds: sortedOwned.map((c) => c.cellId),
        ownedTerritories,
        markedHomeCount,
        duplicateTerritoryCellIds: Array.from(new Set(duplicateOwnedIds)).sort(),
        activeMarchesCount: activeMarches.length,
        activeMarches,
        activeChallengesCount: activeChallenges.length,
        activeChallenges,
        activeExplorationsCount: activeExplorations.length,
        activeExplorations,
      };
    })
  );

  return auditExistingKingdomSpawns(inputs, MAP.RADIUS);
}

export const auditKingdomSpawnDistributionInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await runKingdomSpawnAuditReadOnly(ctx);
  },
});

export const auditKingdomSpawnDistribution = query({
  args: {},
  handler: async (ctx) => {
    await requireAuthorizedAdmin(ctx);
    return await runKingdomSpawnAuditReadOnly(ctx);
  },
});

export interface KingdomRelocationOutcome {
  kingdomId: string;
  name: string;
  previousHomeCellId: string | null;
  newHomeCellId: string | null;
  outcome:
    | "relocated"
    | "already_aligned"
    | "pending_activity"
    | "blocked_integrity"
    | "geometrically_infeasible"
    | "search_exhausted"
    | "deferred_batch";
  preservedOwnedTerritoriesCount: number;
  finalOwnedTerritoriesCount: number;
  reason: string;
}

async function executeKingdomSpawnRelocation(
  ctx: MutationCtx,
  args: {
    expectedPlanFingerprint?: string;
    plannedRelocations?: ReadonlyArray<{
      kingdomId: Id<"kingdoms">;
      fromCellId?: string | null;
      toCellId: string;
    }>;
    kingdomIds?: ReadonlyArray<Id<"kingdoms">>;
    batchSize?: number;
  }
) {
  const now = Date.now();
  const batchLimit = Math.max(1, Math.min(100, Math.floor(args.batchSize ?? 25)));

  // 1. Re-ejecutar auditoría en vivo dentro de la mutación atómica
  const liveAudit = await runKingdomSpawnAuditReadOnly(ctx);

  // 2. Exigir huella del plan y verificar que los datos no han cambiado desde la simulación
  if (!args.expectedPlanFingerprint || !args.expectedPlanFingerprint.trim()) {
    throw new Error(
      "Falta 'expectedPlanFingerprint': toda ejecución de recolocación exige la huella del plan previamente auditado."
    );
  }
  if (liveAudit.planFingerprint !== args.expectedPlanFingerprint) {
    throw new Error(
      `Plan desactualizado: los datos cambiaron desde la simulación (esperado='${args.expectedPlanFingerprint}', actual='${liveAudit.planFingerprint}'). Vuelve a ejecutar la auditoría.`
    );
  }

  const entryById = new Map(liveAudit.entries.map((e) => [e.kingdomId, e]));
  const filterIdSet = args.kingdomIds ? new Set(args.kingdomIds.map((id) => String(id))) : null;

  // 3. Construir la lista de recolocaciones a ejecutar y validarla antes de mutar
  type ValidatedMove = {
    kingdomId: Id<"kingdoms">;
    name: string;
    fromCellId: string | null;
    toCellId: string;
    targetCurrentOwnerId: string | null;
    releasesOldHome: boolean;
  };

  let toExecute: ValidatedMove[] = [];
  const outcomes: KingdomRelocationOutcome[] = [];
  const seenTargets = new Set<string>();
  const seenKingdomIds = new Set<string>();

  if (args.plannedRelocations && args.plannedRelocations.length > 0) {
    // Validar cada recolocación explícita contra el plan global validado y el estado real actual
    const sortedPlan = [...args.plannedRelocations].sort((a, b) =>
      String(a.kingdomId).localeCompare(String(b.kingdomId))
    );
    const stagedCandidates: ValidatedMove[] = [];

    for (const item of sortedPlan) {
      const kIdStr = String(item.kingdomId);
      if (seenKingdomIds.has(kIdStr)) {
        throw new Error(
          `Conflicto en el plan: el reino '${kIdStr}' aparece duplicado en 'plannedRelocations'; operación abortada sin cambios.`
        );
      }
      seenKingdomIds.add(kIdStr);
      if (filterIdSet && !filterIdSet.has(kIdStr)) continue;

      const kingdom = await ctx.db.get(item.kingdomId);
      if (!kingdom) {
        throw new Error(`Reino '${kIdStr}' no encontrado en base de datos; operación abortada sin cambios.`);
      }
      const auditEntry = entryById.get(kIdStr);
      if (!auditEntry) {
        throw new Error(`Reino '${kIdStr}' ausente en la auditoría en vivo; operación abortada sin cambios.`);
      }
      if (item.fromCellId !== undefined && (kingdom.homeTerritoryId ?? null) !== (item.fromCellId ?? null)) {
        throw new Error(
          `El reino '${kIdStr}' cambió de posición desde la simulación (esperado='${item.fromCellId ?? ""}', actual='${kingdom.homeTerritoryId ?? ""}'); operación abortada sin cambios.`
        );
      }
      if (auditEntry.status === "pending_activity") {
        outcomes.push({
          kingdomId: kIdStr,
          name: kingdom.name,
          previousHomeCellId: kingdom.homeTerritoryId ?? null,
          newHomeCellId: kingdom.homeTerritoryId ?? null,
          outcome: "pending_activity",
          preservedOwnedTerritoriesCount: 0,
          finalOwnedTerritoriesCount: 0,
          reason: auditEntry.pendingActivityReasons.join(" "),
        });
        continue;
      }
      if (auditEntry.status === "blocked_integrity") {
        throw new Error(
          `Incompatibilidad de integridad en reino '${kIdStr}': ${auditEntry.integrityBlockReasons.join(" ")}`
        );
      }
      if (auditEntry.status !== "planned" || !auditEntry.proposedHomeCellId) {
        throw new Error(
          `El reino '${kIdStr}' tiene estado '${auditEntry.status}' en la auditoría y no admite recolocación; operación abortada sin cambios.`
        );
      }
      const parsedTarget = parseCellId(item.toCellId);
      if (!parsedTarget || !isInsideWorld(parsedTarget, MAP.RADIUS)) {
        throw new Error(
          `Celda destino '${item.toCellId}' inválida o fuera del mapa de radio ${MAP.RADIUS}; operación abortada sin cambios.`
        );
      }
      if (seenTargets.has(item.toCellId)) {
        throw new Error(
          `Conflicto en el plan: múltiples reinos apuntan a la misma celda destino '${item.toCellId}'; operación abortada sin cambios.`
        );
      }
      seenTargets.add(item.toCellId);

      // Comprobar estado real de la celda destino en BD
      const targetDocs = await ctx.db
        .query("territories")
        .withIndex("by_cell", (q) => q.eq("cellId", item.toCellId))
        .collect();
      if (targetDocs.length > 1) {
        throw new Error(
          `Registros duplicados en celda destino '${item.toCellId}'; operación abortada sin cambios.`
        );
      }
      const targetCurrentOwnerId = targetDocs[0]?.ownerKingdomId
        ? String(targetDocs[0].ownerKingdomId)
        : null;
      if (
        targetCurrentOwnerId &&
        targetCurrentOwnerId !== kIdStr &&
        item.toCellId !== auditEntry.proposedHomeCellId
      ) {
        throw new Error(
          `La celda de destino '${item.toCellId}' está ocupada por otro reino ('${targetCurrentOwnerId}'); operación abortada sin cambios.`
        );
      }
      if (item.toCellId !== auditEntry.proposedHomeCellId) {
        throw new Error(
          `Destino no autorizado para '${kIdStr}': toCellId='${item.toCellId}' no coincide con proposedHomeCellId='${auditEntry.proposedHomeCellId}' de la distribución global validada; operación abortada sin cambios.`
        );
      }

      const ownedForRelease = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", item.kingdomId))
        .collect();
      const fromCell = kingdom.homeTerritoryId ?? null;
      const releasesOldHome =
        fromCell !== null &&
        fromCell !== item.toCellId &&
        (ownedForRelease.length <= 1 || ownedForRelease.length >= TERRITORIES.MAX_PER_KINGDOM) &&
        ownedForRelease.some((c) => c.cellId === fromCell || c.isHome === true);

      stagedCandidates.push({
        kingdomId: item.kingdomId,
        name: kingdom.name,
        fromCellId: fromCell,
        toCellId: item.toCellId,
        targetCurrentOwnerId,
        releasesOldHome,
      });
    }

    for (const candidate of stagedCandidates) {
      if (toExecute.length >= batchLimit) {
        outcomes.push({
          kingdomId: String(candidate.kingdomId),
          name: candidate.name,
          previousHomeCellId: candidate.fromCellId,
          newHomeCellId: null,
          outcome: "deferred_batch",
          preservedOwnedTerritoriesCount: 0,
          finalOwnedTerritoriesCount: 0,
          reason: `Diferido al siguiente lote (límite de lote = ${batchLimit}).`,
        });
        continue;
      }
      toExecute.push(candidate);
    }
  } else {
    // Generar y ejecutar directamente desde el plan global verificado de la auditoría en vivo
    const eligibleAutoMoves: ValidatedMove[] = [];
    for (const entry of liveAudit.entries) {
      if (filterIdSet && !filterIdSet.has(entry.kingdomId)) continue;
      if (entry.status === "correctly_positioned") {
        outcomes.push({
          kingdomId: entry.kingdomId,
          name: entry.name,
          previousHomeCellId: entry.persistedHomeTerritoryId,
          newHomeCellId: entry.persistedHomeTerritoryId,
          outcome: "already_aligned",
          preservedOwnedTerritoriesCount: 0,
          finalOwnedTerritoriesCount: 0,
          reason: "Correctamente situado; sin cambios.",
        });
        continue;
      }
      if (entry.status === "pending_activity") {
        outcomes.push({
          kingdomId: entry.kingdomId,
          name: entry.name,
          previousHomeCellId: entry.persistedHomeTerritoryId,
          newHomeCellId: entry.persistedHomeTerritoryId,
          outcome: "pending_activity",
          preservedOwnedTerritoriesCount: 0,
          finalOwnedTerritoriesCount: 0,
          reason: entry.pendingActivityReasons.join(" "),
        });
        continue;
      }
      if (
        entry.status === "blocked_integrity" ||
        entry.status === "geometrically_infeasible" ||
        entry.status === "search_exhausted"
      ) {
        outcomes.push({
          kingdomId: entry.kingdomId,
          name: entry.name,
          previousHomeCellId: entry.persistedHomeTerritoryId,
          newHomeCellId: entry.persistedHomeTerritoryId,
          outcome: entry.status,
          preservedOwnedTerritoriesCount: 0,
          finalOwnedTerritoriesCount: 0,
          reason: entry.blockedReasons.join(" "),
        });
        continue;
      }

      if (!entry.proposedHomeCellId) continue;

      const kId = entry.kingdomId as Id<"kingdoms">;
      const [targetDocs, ownedForRelease] = await Promise.all([
        ctx.db
          .query("territories")
          .withIndex("by_cell", (q) => q.eq("cellId", entry.proposedHomeCellId!))
          .collect(),
        ctx.db
          .query("territories")
          .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kId))
          .collect(),
      ]);
      if (targetDocs.length > 1) {
        throw new Error(
          `Registros duplicados en celda destino '${entry.proposedHomeCellId}'; operación abortada sin cambios.`
        );
      }
      const targetCurrentOwnerId = targetDocs[0]?.ownerKingdomId
        ? String(targetDocs[0].ownerKingdomId)
        : null;
      const fromCell = entry.persistedHomeTerritoryId;
      const releasesOldHome =
        fromCell !== null &&
        fromCell !== entry.proposedHomeCellId &&
        (ownedForRelease.length <= 1 || ownedForRelease.length >= TERRITORIES.MAX_PER_KINGDOM) &&
        ownedForRelease.some((c) => c.cellId === fromCell || c.isHome === true);

      eligibleAutoMoves.push({
        kingdomId: kId,
        name: entry.name,
        fromCellId: fromCell,
        toCellId: entry.proposedHomeCellId,
        targetCurrentOwnerId,
        releasesOldHome,
      });
    }

    // Ordenar prerequisitos de liberación y separación (< 20 respecto a capitales aún por mover)
    // antes de aplicar batchLimit, evitando conflictos temporales entre lotes consecutivos.
    const autoById = new Map(eligibleAutoMoves.map((m) => [String(m.kingdomId), m]));
    const softDependents = new Map<string, string[]>();
    const softInDegree = new Map<string, number>();
    const autoCoords = new Map<string, { from: HexCoord | null; to: HexCoord | null }>();
    for (const m of eligibleAutoMoves) {
      const id = String(m.kingdomId);
      softDependents.set(id, []);
      softInDegree.set(id, 0);
      autoCoords.set(id, {
        from: m.fromCellId ? parseCellId(m.fromCellId) : null,
        to: parseCellId(m.toCellId),
      });
    }
    for (const m of eligibleAutoMoves) {
      const id = String(m.kingdomId);
      const mCoords = autoCoords.get(id)!;
      if (m.targetCurrentOwnerId && m.targetCurrentOwnerId !== id) {
        const prereq = autoById.get(m.targetCurrentOwnerId);
        if (prereq && prereq.releasesOldHome && prereq.fromCellId === m.toCellId) {
          softDependents.get(m.targetCurrentOwnerId)!.push(id);
          softInDegree.set(id, (softInDegree.get(id) ?? 0) + 1);
        }
      }
      if (mCoords.to) {
        for (const other of eligibleAutoMoves) {
          const otherId = String(other.kingdomId);
          if (otherId === id) continue;
          const otherCoords = autoCoords.get(otherId)!;
          if (
            otherCoords.from &&
            hexDistance(mCoords.to, otherCoords.from) < TERRITORIES.SPAWN_SEPARATION_MIN &&
            !softDependents.get(otherId)!.includes(id)
          ) {
            softDependents.get(otherId)!.push(id);
            softInDegree.set(id, (softInDegree.get(id) ?? 0) + 1);
          }
        }
      }
    }

    const orderedAutoMoves: ValidatedMove[] = [];
    const remainingAuto = new Set(eligibleAutoMoves.map((m) => String(m.kingdomId)));
    while (remainingAuto.size > 0) {
      const ready = Array.from(remainingAuto)
        .filter((id) => (softInDegree.get(id) ?? 0) === 0)
        .sort();
      const pickedId =
        ready.length > 0
          ? ready[0]
          : Array.from(remainingAuto).sort(
              (a, b) => (softInDegree.get(a) ?? 0) - (softInDegree.get(b) ?? 0) || a.localeCompare(b)
            )[0];
      remainingAuto.delete(pickedId);
      orderedAutoMoves.push(autoById.get(pickedId)!);
      for (const depId of softDependents.get(pickedId) ?? []) {
        if (remainingAuto.has(depId)) {
          softInDegree.set(depId, Math.max(0, (softInDegree.get(depId) ?? 0) - 1));
        }
      }
    }

    for (const m of orderedAutoMoves) {
      if (toExecute.length >= batchLimit) {
        outcomes.push({
          kingdomId: String(m.kingdomId),
          name: m.name,
          previousHomeCellId: m.fromCellId,
          newHomeCellId: null,
          outcome: "deferred_batch",
          preservedOwnedTerritoriesCount: 0,
          finalOwnedTerritoriesCount: 0,
          reason: `Diferido al siguiente lote (límite de lote = ${batchLimit}).`,
        });
        continue;
      }
      toExecute.push(m);
    }
  }

  // 3b. Verificar dependencias de ocupación y ordenar topológicamente el lote antes de mutar
  if (toExecute.length > 0) {
    const batchMoveById = new Map(toExecute.map((m) => [String(m.kingdomId), m]));
    const dependents = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const m of toExecute) {
      const id = String(m.kingdomId);
      inDegree.set(id, 0);
      dependents.set(id, []);
    }

    for (const m of toExecute) {
      const id = String(m.kingdomId);
      if (m.targetCurrentOwnerId && m.targetCurrentOwnerId !== id) {
        const prereq = batchMoveById.get(m.targetCurrentOwnerId);
        if (
          !prereq ||
          !prereq.releasesOldHome ||
          prereq.fromCellId !== m.toCellId ||
          prereq.toCellId === m.toCellId
        ) {
          throw new Error(
            `La celda de destino '${m.toCellId}' está ocupada por otro reino ('${m.targetCurrentOwnerId}'); operación abortada sin cambios.`
          );
        }
        dependents.get(m.targetCurrentOwnerId)!.push(id);
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      }
    }

    const ready = Array.from(inDegree.entries())
      .filter(([, deg]) => deg === 0)
      .map(([id]) => id)
      .sort();
    const topoSorted: ValidatedMove[] = [];
    while (ready.length > 0) {
      const nextId = ready.shift()!;
      topoSorted.push(batchMoveById.get(nextId)!);
      for (const depId of dependents.get(nextId) ?? []) {
        const nextDeg = (inDegree.get(depId) ?? 0) - 1;
        inDegree.set(depId, nextDeg);
        if (nextDeg === 0) {
          ready.push(depId);
          ready.sort();
        }
      }
    }
    if (topoSorted.length !== toExecute.length) {
      throw new Error(
        "Conflicto de ordenación entre celdas liberadas y reclamadas en el lote; operación abortada sin cambios."
      );
    }
    toExecute = topoSorted;

    // 3c. Verificar separación mínima >= 20 de todas las capitales resultantes tras el lote
    const postBatchCapitals: Array<{ kingdomId: string; coord: HexCoord; movedInBatch: boolean }> = [];
    for (const entry of liveAudit.entries) {
      const plannedMove = batchMoveById.get(entry.kingdomId);
      if (plannedMove) {
        const coord = parseCellId(plannedMove.toCellId);
        if (!coord) {
          throw new Error(`Celda destino '${plannedMove.toCellId}' inválida; operación abortada sin cambios.`);
        }
        postBatchCapitals.push({ kingdomId: entry.kingdomId, coord, movedInBatch: true });
      } else if (entry.coord) {
        postBatchCapitals.push({ kingdomId: entry.kingdomId, coord: entry.coord, movedInBatch: false });
      }
    }
    for (const moved of postBatchCapitals) {
      if (!moved.movedInBatch) continue;
      for (const other of postBatchCapitals) {
        if (other.kingdomId === moved.kingdomId) continue;
        const dist = hexDistance(moved.coord, other.coord);
        if (dist < TERRITORIES.SPAWN_SEPARATION_MIN) {
          throw new Error(
            `Separación mínima incumplida tras el lote: '${moved.kingdomId}' (${moved.coord.q},${moved.coord.r}) queda a distancia ${dist} < ${TERRITORIES.SPAWN_SEPARATION_MIN} respecto a '${other.kingdomId}' (${other.coord.q},${other.coord.r}); operación abortada sin cambios.`
          );
        }
      }
    }
  }

  // 4. Ejecución atómica por cada reino del lote con verificación de invariantes
  for (const move of toExecute) {
    const kingdom = await ctx.db.get(move.kingdomId);
    if (!kingdom) {
      throw new Error(`Reino '${String(move.kingdomId)}' desapareció durante la mutación; rollback atómico.`);
    }

    const ownedBefore = await ctx.db
      .query("territories")
      .withIndex("by_owner", (q) => q.eq("ownerKingdomId", move.kingdomId))
      .collect();

    // Verificar ausencia de duplicados y respeto estricto del tope de 100 territorios
    const ownedCellIdSet = new Set(ownedBefore.map((c) => c.cellId));
    if (ownedCellIdSet.size !== ownedBefore.length) {
      throw new Error(
        `El reino '${String(move.kingdomId)}' contiene documentos de territorio duplicados; rollback atómico.`
      );
    }
    if (ownedBefore.length > TERRITORIES.MAX_PER_KINGDOM) {
      throw new Error(
        `El reino '${String(move.kingdomId)}' supera el límite de ${TERRITORIES.MAX_PER_KINGDOM} territorios (${ownedBefore.length}); rollback atómico.`
      );
    }

    // Comprobar celda destino en vivo (sin duplicados ni ocupación ajena)
    const targetDocs = await ctx.db
      .query("territories")
      .withIndex("by_cell", (q) => q.eq("cellId", move.toCellId))
      .collect();
    if (targetDocs.length > 1) {
      throw new Error(`Celda destino '${move.toCellId}' duplicada en BD; rollback atómico.`);
    }
    if (targetDocs[0]?.ownerKingdomId && targetDocs[0].ownerKingdomId !== move.kingdomId) {
      throw new Error(
        `Celda destino '${move.toCellId}' ocupada por otro reino ('${String(targetDocs[0].ownerKingdomId)}'); rollback atómico.`
      );
    }

    const oldHomeDoc =
      (kingdom.homeTerritoryId ? ownedBefore.find((c) => c.cellId === kingdom.homeTerritoryId) : undefined) ??
      ownedBefore.find((c) => c.isHome === true) ??
      null;

    const alreadyOwnsTarget = targetDocs[0]?.ownerKingdomId === move.kingdomId;
    let targetDoc: Doc<"territories"> | null = targetDocs[0] ?? null;

    if (!targetDoc) {
      targetDoc = await getOrCreateTerritoryCell(ctx, move.toCellId);
      if (!targetDoc) {
        throw new Error(`No se pudo materializar la celda destino '${move.toCellId}'; rollback atómico.`);
      }
    }

    let preservedNonCapitalCount = 0;

    if (alreadyOwnsTarget) {
      // El reino ya posee la celda destino: solo se transfiere la marca isHome y homeTerritoryId sin perder ningún territorio
      for (const cell of ownedBefore) {
        if (cell._id === targetDoc._id) {
          if (!cell.isHome) await ctx.db.patch(cell._id, { isHome: true });
        } else {
          if (cell.isHome) await ctx.db.patch(cell._id, { isHome: false });
          preservedNonCapitalCount++;
        }
      }
      await ctx.db.patch(move.kingdomId, { homeTerritoryId: move.toCellId });
    } else {
      // Celda destino libre:
      // - Si el reino solo tiene 1 territorio (su antigua capital), se libera la antigua capital y se asigna la nueva (total = 1).
      // - Si el reino tiene 2..99 territorios, se conserva la antigua capital como territorio propio normal (isHome: false) y se añade la nueva capital (total = N + 1 <= 100), preservando el 100 % de la propiedad.
      // - Si el reino tiene exactamente 100 territorios, se sustituye la antigua capital por la nueva (se libera la antigua capital) para no violar jamás el tope de 100, conservando los otros 99 territorios.
      const mustReleaseOldHome =
        oldHomeDoc !== null &&
        oldHomeDoc._id !== targetDoc._id &&
        (ownedBefore.length <= 1 || ownedBefore.length >= TERRITORIES.MAX_PER_KINGDOM);

      for (const cell of ownedBefore) {
        if (mustReleaseOldHome && oldHomeDoc && cell._id === oldHomeDoc._id) {
          await ctx.db.patch(cell._id, {
            ownerKingdomId: undefined,
            isHome: false,
            claimedAt: undefined,
          });
        } else {
          if (cell.isHome) {
            await ctx.db.patch(cell._id, { isHome: false });
          }
          preservedNonCapitalCount++;
        }
      }

      await ctx.db.patch(targetDoc._id, {
        ownerKingdomId: move.kingdomId,
        isHome: true,
        claimedAt: oldHomeDoc?.claimedAt ?? now,
      });
      await ctx.db.patch(move.kingdomId, { homeTerritoryId: move.toCellId });
    }

    // 5. Verificación estricta de post-condiciones (cualquier incoherencia dispara rollback atómico)
    const [freshKingdom, freshOwned, freshTargetDocs] = await Promise.all([
      ctx.db.get(move.kingdomId),
      ctx.db.query("territories").withIndex("by_owner", (q) => q.eq("ownerKingdomId", move.kingdomId)).collect(),
      ctx.db.query("territories").withIndex("by_cell", (q) => q.eq("cellId", move.toCellId)).collect(),
    ]);

    if (!freshKingdom || freshKingdom.homeTerritoryId !== move.toCellId) {
      throw new Error(`Post-verificación fallida: homeTerritoryId no coincide con '${move.toCellId}'.`);
    }
    if (freshOwned.length > TERRITORIES.MAX_PER_KINGDOM) {
      throw new Error(
        `Post-verificación fallida: el reino superó el límite de ${TERRITORIES.MAX_PER_KINGDOM} territorios (${freshOwned.length}).`
      );
    }
    if (new Set(freshOwned.map((c) => c.cellId)).size !== freshOwned.length) {
      throw new Error("Post-verificación fallida: se detectaron cellIds duplicados tras la recolocación.");
    }
    const freshMarkedHomes = freshOwned.filter((c) => c.isHome === true);
    if (freshMarkedHomes.length !== 1 || freshMarkedHomes[0].cellId !== move.toCellId) {
      throw new Error(
        `Post-verificación fallida: marca isHome incoherente (marcadas=${freshMarkedHomes.length}, esperada='${move.toCellId}').`
      );
    }
    if (freshTargetDocs.length !== 1 || freshTargetDocs[0].ownerKingdomId !== move.kingdomId) {
      throw new Error(`Post-verificación fallida: celda destino '${move.toCellId}' inconsistente.`);
    }

    outcomes.push({
      kingdomId: String(move.kingdomId),
      name: move.name,
      previousHomeCellId: move.fromCellId,
      newHomeCellId: move.toCellId,
      outcome: "relocated",
      preservedOwnedTerritoriesCount: preservedNonCapitalCount,
      finalOwnedTerritoriesCount: freshOwned.length,
      reason: `Capital recolocada de '${move.fromCellId ?? "ausente"}' a '${move.toCellId}' conservando ${preservedNonCapitalCount} territorios adicionales (total=${freshOwned.length}).`,
    });
  }

  // 6. Re-auditar estado posterior para informar huella actualizada y pendientes restantes
  const postAudit = await runKingdomSpawnAuditReadOnly(ctx);

  return {
    success: true,
    executedAt: now,
    previousPlanFingerprint: liveAudit.planFingerprint,
    newPlanFingerprint: postAudit.planFingerprint,
    relocatedCount: outcomes.filter((o) => o.outcome === "relocated").length,
    alreadyAlignedCount: outcomes.filter((o) => o.outcome === "already_aligned").length,
    pendingActivityCount: outcomes.filter((o) => o.outcome === "pending_activity").length,
    deferredBatchCount: outcomes.filter((o) => o.outcome === "deferred_batch").length,
    remainingPlannedCount: postAudit.plannedRelocations,
    postAuditSummary: {
      totalKingdoms: postAudit.totalKingdoms,
      correctlyPositionedCount: postAudit.correctlyPositionedCount,
      plannedRelocations: postAudit.plannedRelocations,
      pendingActivityRelocations: postAudit.pendingActivityRelocations,
      blockedIntegrityRelocations: postAudit.blockedIntegrityRelocations,
      globalPlanStatus: postAudit.globalPlanStatus,
    },
    outcomes,
  };
}

/**
 * Aplicación administrativa atómica, validada e idempotente del plan de recolocación de capitales.
 * Protegida por autorización administrativa real en servidor (ADMIN_USER_IDS).
 */
export const applyKingdomSpawnRelocation = mutation({
  args: {
    expectedPlanFingerprint: v.optional(v.string()),
    plannedRelocations: v.optional(
      v.array(
        v.object({
          kingdomId: v.id("kingdoms"),
          fromCellId: v.optional(v.union(v.string(), v.null())),
          toCellId: v.string(),
        })
      )
    ),
    kingdomIds: v.optional(v.array(v.id("kingdoms"))),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuthorizedAdmin(ctx);
    return await executeKingdomSpawnRelocation(ctx, args);
  },
});

/**
 * Variante interna para pruebas y tareas autorizadas de servidor.
 */
export const applyKingdomSpawnRelocationInternal = internalMutation({
  args: {
    expectedPlanFingerprint: v.optional(v.string()),
    plannedRelocations: v.optional(
      v.array(
        v.object({
          kingdomId: v.id("kingdoms"),
          fromCellId: v.optional(v.union(v.string(), v.null())),
          toCellId: v.string(),
        })
      )
    ),
    kingdomIds: v.optional(v.array(v.id("kingdoms"))),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await executeKingdomSpawnRelocation(ctx, args);
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
 * bonificaciones de civilización y modificadores tecnológicos centralizados) y reserva atómica de espías y recursos.
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

  const techModifiers = computeTechnologyModifiers(completedTech);
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
    explorationSpeedBonus: techModifiers.explorationSpeedBonus,
    explorationCostReduction: techModifiers.explorationCostReduction,
  });

  if (!check.success) {
    throw new Error(check.error);
  }

  if (availableSpies < spiesCount) {
    throw new Error(`No tienes suficientes espías profesionales disponibles (solicitados: ${spiesCount}, disponibles: ${availableSpies}). Recluta espías en el Cuartel.`);
  }

  const { plan } = check;

  // Duración con colaboración multi-espía (respetando el mínimo global de exploración)
  const collaborationFactor = 1 / Math.sqrt(spiesCount);
  const durationMs = Math.max(
    MIN_EXPLORATION_DURATION_MS,
    Math.ceil(plan.durationMs * collaborationFactor)
  );
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
  integrityPercentage: number | null;
  examinedByRelation: Record<ReferentialRelationName, number>;
  byRelation: Record<ReferentialRelationName, RelationAuditBreakdown>;
  inconsistencies: ReferentialIntegrityIssue[];
  intact: boolean;
}

function computeIntegrityPercentage(validCount: number, examinedCount: number): number | null {
  if (examinedCount <= 0) return null;
  return (100 * validCount) / examinedCount;
}

interface ReferentialAuditContext {
  allKingdomIds: Set<string>;
  allTerritoriesByCellId: Map<string, Doc<"territories">[]>;
  allMarchesById: Map<string, Doc<"armyMarches">>;
  allActiveMarches: Doc<"armyMarches">[];
  allChallengesById: Map<string, Doc<"challenges">>;
  allBattlesById: Map<string, Doc<"Battle">>;
}

function battleParticipantsMatchChallenge(
  battle: { attackerKingdomId: Id<"kingdoms">; defenderKingdomId: Id<"kingdoms"> },
  challenge: { challengerKingdomId: Id<"kingdoms">; targetKingdomId: Id<"kingdoms"> }
): boolean {
  const a = String(battle.attackerKingdomId);
  const d = String(battle.defenderKingdomId);
  const c = String(challenge.challengerKingdomId);
  const t = String(challenge.targetKingdomId);
  return (a === c && d === t) || (a === t && d === c);
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
    markExamined("territories");
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
      } else if (
        linkedChallenge &&
        (!linkedChallenge.activeMarchId || String(linkedChallenge.activeMarchId) !== String(m._id))
      ) {
        blockingMarchIds.add(String(m._id));
        recordIssue({
          relation: "activeMarches",
          documentId: String(m._id),
          kingdomId: String(m.kingdomId),
          cellId: m.targetCellId,
          severity: "blocking",
          reason: `Marcha activa referencia el desafío '${String(linkedChallenge._id)}', pero su activeMarchId ('${String(linkedChallenge.activeMarchId ?? "")}') no coincide con esta marcha.`,
        });
      } else if (
        linkedChallenge &&
        String(linkedChallenge.challengerKingdomId) !== String(m.kingdomId)
      ) {
        blockingMarchIds.add(String(m._id));
        recordIssue({
          relation: "activeMarches",
          documentId: String(m._id),
          kingdomId: String(m.kingdomId),
          cellId: m.targetCellId,
          severity: "blocking",
          reason: `Marcha activa del reino '${String(m.kingdomId)}' no coincide con el challengerKingdomId '${String(linkedChallenge.challengerKingdomId)}' del desafío.`,
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
      } else if (
        linkedChallenge &&
        String(linkedChallenge.challengerKingdomId) !== String(m.kingdomId)
      ) {
        recordIssue({
          relation: "historicalMarches",
          documentId: String(m._id),
          kingdomId: String(m.kingdomId),
          cellId: m.targetCellId,
          severity: "warning",
          reason: `Marcha histórica del reino '${String(m.kingdomId)}' no coincide con el challengerKingdomId '${String(linkedChallenge.challengerKingdomId)}' del desafío.`,
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

  // 6. Informes de batalla históricos (Battle: conservar siempre, verificando relación bidireccional con challenges)
  const seenBattles = new Set<string>();
  for (const b of [...battlesAsAttacker, ...battlesAsDefender]) {
    if (seenBattles.has(String(b._id))) continue;
    seenBattles.add(String(b._id));
    markExamined("battles");

    const attackerExists = auditCtx.allKingdomIds.has(String(b.attackerKingdomId));
    const defenderExists = auditCtx.allKingdomIds.has(String(b.defenderKingdomId));
    const linkedChallenge = b.challengeId ? auditCtx.allChallengesById.get(String(b.challengeId)) : undefined;
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
    } else if (!b.challengeId || !linkedChallenge) {
      recordIssue({
        relation: "battles",
        documentId: String(b._id),
        kingdomId: String(kingdom._id),
        severity: "warning",
        reason: `Informe de batalla histórico referencia un desafío inexistente '${String(b.challengeId ?? "")}'.`,
      });
    } else if (!linkedChallenge.battleId || String(linkedChallenge.battleId) !== String(b._id)) {
      recordIssue({
        relation: "battles",
        documentId: String(b._id),
        kingdomId: String(kingdom._id),
        severity: "warning",
        reason: `Informe de batalla histórico sin reciprocidad: el desafío '${String(linkedChallenge._id)}' tiene battleId='${String(linkedChallenge.battleId ?? "")}' en lugar de '${String(b._id)}'.`,
      });
    } else if (!battleParticipantsMatchChallenge(b, linkedChallenge)) {
      recordIssue({
        relation: "battles",
        documentId: String(b._id),
        kingdomId: String(kingdom._id),
        severity: "warning",
        reason: `Participantes de la batalla (${String(b.attackerKingdomId)} vs ${String(b.defenderKingdomId)}) no coinciden con los reinos del desafío (${String(linkedChallenge.challengerKingdomId)} vs ${String(linkedChallenge.targetKingdomId)}).`,
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

  // 7. Desafíos parlamentarios (challenges: verificación bidireccional con armyMarches y Battle)
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
    const linkedBattle = ch.battleId ? auditCtx.allBattlesById.get(String(ch.battleId)) : undefined;

    let challengeIssue: ReferentialIntegrityIssue | null = null;

    if (!challengerExists || !targetExists) {
      challengeIssue = {
        relation: "challenges",
        documentId: String(ch._id),
        kingdomId: String(kingdom._id),
        severity: severityForBrokenRef,
        reason: `Desafío '${String(ch._id)}' (${ch.status}) referencia un reino inexistente.`,
      };
    } else if (ch.activeMarchId) {
      if (!linkedMarch) {
        challengeIssue = {
          relation: "challenges",
          documentId: String(ch._id),
          kingdomId: String(kingdom._id),
          severity: severityForBrokenRef,
          reason: `Desafío '${String(ch._id)}' (${ch.status}) referencia activeMarchId inexistente '${String(ch.activeMarchId)}'.`,
        };
      } else if (blockingMarchIds.has(String(ch.activeMarchId))) {
        challengeIssue = {
          relation: "challenges",
          documentId: String(ch._id),
          kingdomId: String(kingdom._id),
          cellId: linkedMarch.targetCellId,
          severity: "blocking",
          reason: `Desafío '${String(ch._id)}' vinculado a una marcha activa incompatible o hacia una celda planificada para liberación.`,
        };
      } else if (isActiveChallenge && linkedMarch.status !== "marchando") {
        challengeIssue = {
          relation: "challenges",
          documentId: String(ch._id),
          kingdomId: String(kingdom._id),
          cellId: linkedMarch.targetCellId,
          severity: "blocking",
          reason: `Desafío activo '${String(ch._id)}' apunta a activeMarchId '${String(linkedMarch._id)}' cuyo estado es '${linkedMarch.status}' en lugar de 'marchando'.`,
        };
      } else if (!isActiveChallenge && linkedMarch.status === "marchando") {
        challengeIssue = {
          relation: "challenges",
          documentId: String(ch._id),
          kingdomId: String(kingdom._id),
          cellId: linkedMarch.targetCellId,
          severity: "blocking",
          reason: `Desafío terminal '${String(ch._id)}' (${ch.status}) sigue vinculado a una marcha activa en estado 'marchando'.`,
        };
      } else if (!linkedMarch.challengeId || String(linkedMarch.challengeId) !== String(ch._id)) {
        challengeIssue = {
          relation: "challenges",
          documentId: String(ch._id),
          kingdomId: String(kingdom._id),
          cellId: linkedMarch.targetCellId,
          severity: severityForBrokenRef,
          reason: `Desafío '${String(ch._id)}' sin reciprocidad: la marcha '${String(linkedMarch._id)}' tiene challengeId='${String(linkedMarch.challengeId ?? "")}'.`,
        };
      } else if (String(linkedMarch.kingdomId) !== String(ch.challengerKingdomId)) {
        challengeIssue = {
          relation: "challenges",
          documentId: String(ch._id),
          kingdomId: String(kingdom._id),
          cellId: linkedMarch.targetCellId,
          severity: severityForBrokenRef,
          reason: `Desafío '${String(ch._id)}' apunta a marcha '${String(linkedMarch._id)}' perteneciente al reino '${String(linkedMarch.kingdomId)}' en lugar del desafiante '${String(ch.challengerKingdomId)}'.`,
        };
      } else if (!auditCtx.allTerritoriesByCellId.has(linkedMarch.targetCellId)) {
        challengeIssue = {
          relation: "challenges",
          documentId: String(ch._id),
          kingdomId: String(kingdom._id),
          cellId: linkedMarch.targetCellId,
          severity: severityForBrokenRef,
          reason: `Desafío '${String(ch._id)}' (${ch.status}) apunta vía activeMarchId a una celda inexistente '${linkedMarch.targetCellId}'.`,
        };
      } else if (linkedMarch.targetCellId !== `${linkedMarch.targetQ},${linkedMarch.targetR}`) {
        challengeIssue = {
          relation: "challenges",
          documentId: String(ch._id),
          kingdomId: String(kingdom._id),
          cellId: linkedMarch.targetCellId,
          severity: severityForBrokenRef,
          reason: `Desafío '${String(ch._id)}' apunta a marcha '${String(linkedMarch._id)}' con coordenadas incoherentes.`,
        };
      } else if (isActiveChallenge && plannedReleaseCellIds.has(linkedMarch.targetCellId)) {
        challengeIssue = {
          relation: "challenges",
          documentId: String(ch._id),
          kingdomId: String(kingdom._id),
          cellId: linkedMarch.targetCellId,
          severity: "blocking",
          reason: `Desafío activo '${String(ch._id)}' apunta vía activeMarchId a la celda '${linkedMarch.targetCellId}' planificada para liberación.`,
        };
      }
    }

    if (!challengeIssue && ch.battleId) {
      if (!linkedBattle) {
        challengeIssue = {
          relation: "challenges",
          documentId: String(ch._id),
          kingdomId: String(kingdom._id),
          severity: severityForBrokenRef,
          reason: `Desafío '${String(ch._id)}' (${ch.status}) referencia battleId inexistente '${String(ch.battleId)}'.`,
        };
      } else if (!linkedBattle.challengeId || String(linkedBattle.challengeId) !== String(ch._id)) {
        challengeIssue = {
          relation: "challenges",
          documentId: String(ch._id),
          kingdomId: String(kingdom._id),
          severity: severityForBrokenRef,
          reason: `Desafío '${String(ch._id)}' sin reciprocidad: la batalla '${String(linkedBattle._id)}' apunta a challengeId='${String(linkedBattle.challengeId ?? "")}'.`,
        };
      } else if (!battleParticipantsMatchChallenge(linkedBattle, ch)) {
        challengeIssue = {
          relation: "challenges",
          documentId: String(ch._id),
          kingdomId: String(kingdom._id),
          severity: severityForBrokenRef,
          reason: `Desafío '${String(ch._id)}' (${String(ch.challengerKingdomId)} vs ${String(ch.targetKingdomId)}) apunta a batalla '${String(linkedBattle._id)}' con participantes incompatibles (${String(linkedBattle.attackerKingdomId)} vs ${String(linkedBattle.defenderKingdomId)}).`,
        };
      }
    }

    if (challengeIssue) {
      recordIssue(challengeIssue);
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
    integrityPercentage: computeIntegrityPercentage(validCount, examinedCount),
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
    integrityPercentage: computeIntegrityPercentage(validCount, examinedCount),
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

function toTerritorySnapshot(doc: Doc<"territories">): TerritoryOwnershipSnapshot {
  return {
    id: String(doc._id),
    cellId: doc.cellId,
    q: doc.q,
    r: doc.r,
    terrain: doc.terrain as TerrainType,
    ownerKingdomId: doc.ownerKingdomId ? String(doc.ownerKingdomId) : null,
    isHome: doc.isHome,
    claimedAt: doc.claimedAt,
  };
}

export async function runTerritoryCapCleanup(
  ctx: MutationCtx,
  args: { dryRun?: boolean; kingdomId?: Id<"kingdoms">; operationId?: string },
  hooks?: {
    afterKingdomWrites?: (
      ctx: MutationCtx,
      info: { kingdomId: Id<"kingdoms">; plan: TerritoryCapCleanupPlan }
    ) => Promise<void>;
  }
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
        integrityPercentage: afterSummary.integrityPercentage,
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
    allBattlesById: new Map(allBattles.map((b) => [String(b._id), b])),
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
    const initialDocIds = new Set(owned.map((c) => String(c._id)));
    const initialSnapshots: TerritoryOwnershipSnapshot[] = owned.map(toTerritorySnapshot);
    let foreignTerritoriesBefore: TerritoryOwnershipSnapshot[] = [];

    if (!dryRun) {
      const beforeKingdomAllTerritories = await ctx.db.query("territories").collect();
      foreignTerritoriesBefore = beforeKingdomAllTerritories
        .filter((t) => !initialDocIds.has(String(t._id)))
        .map(toTerritorySnapshot);

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

      if (hooks?.afterKingdomWrites) {
        await hooks.afterKingdomWrites(ctx, { kingdomId: kingdom._id, plan });
      }
    }

    const freshKingdom = (await ctx.db.get(kingdom._id)) ?? kingdom;
    let afterAudit: ReferentialIntegrityAudit;

    if (dryRun) {
      afterAudit = beforeAudit;
    } else {
      const [finalOwned, finalInitialDocsRaw, afterKingdomAllTerritories] = await Promise.all([
        ctx.db
          .query("territories")
          .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdom._id))
          .collect(),
        Promise.all(owned.map((c) => ctx.db.get(c._id))),
        ctx.db.query("territories").collect(),
      ]);

      const foreignTerritoriesAfter = afterKingdomAllTerritories
        .filter((t) => !initialDocIds.has(String(t._id)))
        .map(toTerritorySnapshot);

      const postVerification = verifyTerritoryCapCleanupPostState({
        kingdomId: String(kingdom._id),
        initialTerritories: initialSnapshots,
        plannedKeptCellIds: plan.keptCellIds,
        plannedReleasedCellIds: plan.releasedCellIds,
        capitalCellId: plan.capitalCellId,
        maxAllowed: TERRITORIES.MAX_PER_KINGDOM,
        finalOwnedByKingdom: finalOwned.map(toTerritorySnapshot),
        finalInitialDocs: finalInitialDocsRaw.map((doc) => (doc ? toTerritorySnapshot(doc) : null)),
        finalKingdomHomeTerritoryId: freshKingdom.homeTerritoryId ?? null,
        foreignTerritoriesBefore,
        foreignTerritoriesAfter,
      });

      const refreshedTerritoriesByCellId = new Map<string, Doc<"territories">[]>();
      for (const t of afterKingdomAllTerritories) {
        const list = refreshedTerritoriesByCellId.get(t.cellId);
        if (list) list.push(t);
        else refreshedTerritoriesByCellId.set(t.cellId, [t]);
      }
      const afterAuditCtx: ReferentialAuditContext = {
        ...auditCtx,
        allTerritoriesByCellId: refreshedTerritoriesByCellId,
      };

      afterAudit = await auditKingdomTerritoryReferentialIntegrity(
        ctx,
        freshKingdom,
        new Set(),
        "after",
        afterAuditCtx
      );

      // Atomicidad real de Convex: cualquier fallo en la verificación posterior o bloqueo
      // en la auditoría posterior DEBE lanzar excepción sin capturar para provocar rollback
      // transaccional completo de la mutation (cero escrituras parciales).
      if (!postVerification.valid || afterAudit.blockingCount > 0) {
        const auditBlockingReasons = afterAudit.inconsistencies
          .filter((i) => i.severity === "blocking")
          .map((i) => `[${i.relation}] ${i.reason}`);
        const allReasons = [...postVerification.errors, ...auditBlockingReasons];
        throw new ConvexError(
          `Rollback transaccional del saneamiento territorial para '${kingdom.name}': ${allReasons.join(" | ")}`
        );
      }
    }

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
      integrityPercentage: afterSummary.integrityPercentage,
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
