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
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { recordMissionEvent } from "./missions";
import { isKingdomOwner, DEMO_USER_ID } from "./kingdomAccess";
import { requireOwner } from "./buildings";
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
} from "./territoryRules";
import {
  canStartExploration,
  calculateExplorationRefund,
  explorationProgress,
  generateExplorationDiscovery,
  getInitialSightCellIds,
  type CellExplorationState,
} from "./explorationRules";
import { settleRelationalKingdomEconomy } from "./economy";

async function readWorld(ctx: QueryCtx | MutationCtx) {
  return ctx.db.query("territories").collect();
}

/** Genera el mundo si todavía no existe (idempotente). */
export async function ensureWorld(ctx: MutationCtx): Promise<number> {
  const existing = await ctx.db.query("territories").first();
  if (existing) return 0;
  const cells = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
  for (const cell of cells) {
    await ctx.db.insert("territories", { cellId: cell.cellId, q: cell.q, r: cell.r, terrain: cell.terrain });
  }
  return cells.length;
}

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
  const doc = world.find((cell) => cell.cellId === choice.cellId);
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

/** Distancia hexagonal entre los territorios principales de dos reinos (P41); null si alguno no tiene. */
export async function distanceBetweenKingdoms(ctx: QueryCtx | MutationCtx, a: Id<"kingdoms">, b: Id<"kingdoms">): Promise<number | null> {
  const [homeA, homeB] = await Promise.all([readHomeCoord(ctx, a), readHomeCoord(ctx, b)]);
  if (!homeA || !homeB) return null;
  return hexDistance(homeA, homeB);
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

  // 4. Devolver al ciudadano explorador a la reserva de población civil libre
  const population = await ctx.db
    .query("population")
    .withIndex("by_kingdom", (q) => q.eq("kingdomId", expedition.kingdomId))
    .first();

  if (population) {
    await ctx.db.patch(population._id, {
      available: (population.available ?? 0) + (expedition.scoutsCount ?? 1),
    });
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
    for (const owner of owners) if (owner) names.set(owner._id, owner.name);

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
          ownerName: cell.ownerKingdomId ? names.get(cell.ownerKingdomId) ?? null : null,
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

    const ownedIds = new Set(ownedCells.map((c) => c.cellId));
    const ownedCoords: HexCoord[] = ownedCells.map((c) => ({ q: c.q, r: c.r }));

    // Celdas conocidas: territorio principal + visión inicial (radio 1) + exploradas guardadas
    const knownIds = new Set<string>([
      ...ownedIds,
      ...getInitialSightCellIds(homeCoord, EXPLORATION.INITIAL_SIGHT_RADIUS, MAP.RADIUS),
      ...exploredRecords.map((r) => r.cellId),
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
          const distance = ownedCoords.length
            ? Math.max(1, Math.min(...ownedCoords.map((c) => hexDistance(c, { q: cell.q, r: cell.r }))))
            : 1;
          const durationSeconds = Math.max(600, distance * EXPLORATION.SECONDS_PER_HEX);
          explorationPlan = {
            distance,
            durationSeconds,
            costs: { gold: EXPLORATION.BASE_COSTS.gold, food: EXPLORATION.BASE_COSTS.food },
          };
        }
      }

      const activeExp = activeExpeditionMap.get(cell.cellId);
      const expedition = activeExp
        ? {
            expeditionId: activeExp._id,
            progressPercent: explorationProgress(activeExp.startedAt, activeExp.durationMs, now),
            completesAt: activeExp.completesAt,
            durationMs: activeExp.durationMs,
            distance: activeExp.distance,
          }
        : null;

      return {
        cellId: cell.cellId,
        q: cell.q,
        r: cell.r,
        // Si está en niebla de guerra, el terreno real queda oculto al jugador
        terrain: state === "fog" ? "desconocido" : cell.terrain,
        ownerKingdomId: state === "fog" ? null : cell.ownerKingdomId ?? null,
        ownerName: state === "fog" ? null : cell.ownerKingdomId ? names.get(cell.ownerKingdomId) ?? null : null,
        isHome: state === "fog" ? false : cell.isHome ?? false,
        state,
        canExplore,
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
      })),
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
      recentDiscoveries: explored.slice(-5).map((e) => ({
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
  },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    await ensureHomeTerritory(ctx, args.kingdomId);
    const now = Date.now();

    // 1. Resolver expediciones previas que ya hayan cumplido su tiempo
    await resolveExpiredExpeditions(ctx, args.kingdomId, now);

    // 2. Comprobar existencia de la celda
    const target = await ctx.db
      .query("territories")
      .withIndex("by_cell", (q) => q.eq("cellId", args.cellId))
      .first();

    if (!target) {
      throw new Error("La celda indicada no existe en el mapa de La Conquista.");
    }

    // 3. Recopilar celdas conocidas, activas y poseídas
    const [ownedDocs, exploredDocs, activeQueue, populationDoc] = await Promise.all([
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
      ctx.db
        .query("population")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
        .first(),
    ]);

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

    const availableCivil = populationDoc?.available ?? 0;

    // 5. Validar reglas puras de exploración
    const check = canStartExploration({
      targetCoord: { q: target.q, r: target.r },
      targetCellId: target.cellId,
      knownCellIds: knownSet,
      activeCellIds: activeSet,
      ownedCoords: ownedDocs.map((c) => ({ q: c.q, r: c.r })),
      availableCivil,
      currentResources,
      activeExpeditionsCount: activeQueue.length,
      worldRadius: MAP.RADIUS,
      civilization: kingdom.civilization,
    });

    if (!check.success) {
      throw new Error(check.error);
    }

    const { plan } = check;

    // 6. Deducir costes de recursos de forma atómica
    await ctx.db.patch(settled.resources._id, {
      gold: settled.settledResources.gold - plan.costs.gold,
      food: settled.settledResources.food - plan.costs.food,
    });

    // 7. Reservar explorador de la población civil libre
    if (populationDoc) {
      await ctx.db.patch(populationDoc._id, {
        available: Math.max(0, (populationDoc.available ?? 0) - plan.scoutsRequired),
      });
    }

    // 8. Crear documento de expedición en cola
    const completesAt = now + plan.durationMs;
    const expeditionId = await ctx.db.insert("explorationQueue", {
      kingdomId: args.kingdomId,
      cellId: args.cellId,
      targetQ: target.q,
      targetR: target.r,
      distance: plan.distance,
      startedAt: now,
      durationMs: plan.durationMs,
      completesAt,
      scoutsCount: plan.scoutsRequired,
      costs: plan.costs,
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
      durationMs: plan.durationMs,
      durationSeconds: plan.durationSeconds,
      distance: plan.distance,
      costs: plan.costs,
    };
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
    const target = await ctx.db
      .query("territories")
      .withIndex("by_cell", (q) => q.eq("cellId", args.cellId))
      .first();
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
    await ctx.db.patch(args.kingdomId, { pendingTerritoryClaims: (kingdom.pendingTerritoryClaims ?? 0) - 1, updatedAt: now });

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
