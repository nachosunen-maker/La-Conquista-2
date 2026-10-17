/**
 * LA CONQUISTA — MAPA Y TERRITORIOS (Bloque G)
 * El mundo se genera una sola vez (331 celdas, semilla reproducible). Cada reino
 * recibe un territorio principal al fundarse; los demás permanecen libres hasta
 * reclamarse tras una victoria aplastante (P47-P49).
 */
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { isKingdomOwner } from "./kingdomAccess";
import { requireOwner } from "./buildings";
import { MAP, TERRAINS } from "./balanceConfig";
import {
  canClaimTerritory,
  chooseHomeCell,
  generateWorldCells,
  hexDistance,
  parseCellId,
  type HexCoord,
  type WorldCell,
} from "./territoryRules";

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

export const getWorldMap = query({
  args: {},
  handler: async (ctx) => {
    const world = await readWorld(ctx);
    const ownerIds = [...new Set(world.map((cell) => cell.ownerKingdomId).filter((id): id is Id<"kingdoms"> => Boolean(id)))];
    const owners = await Promise.all(ownerIds.map((id) => ctx.db.get(id)));
    const names = new Map<string, string>();
    for (const owner of owners) if (owner) names.set(owner._id, owner.name);
    return {
      radius: MAP.RADIUS,
      generated: world.length > 0,
      terrains: TERRAINS,
      cells: world.map((cell) => ({
        cellId: cell.cellId,
        q: cell.q,
        r: cell.r,
        terrain: cell.terrain,
        ownerKingdomId: cell.ownerKingdomId ?? null,
        ownerName: cell.ownerKingdomId ? names.get(cell.ownerKingdomId) ?? null : null,
        isHome: cell.isHome ?? false,
      })),
    };
  },
});

export const getKingdomTerritories = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    const isDemoRead = kingdom.userId === "guest_g9ai8cz";
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar su propio reino.");
    }
    const owned = await ctx.db
      .query("territories")
      .withIndex("by_owner", (q) => q.eq("ownerKingdomId", args.kingdomId))
      .collect();
    return {
      homeTerritoryId: kingdom.homeTerritoryId ?? null,
      pendingClaims: kingdom.pendingTerritoryClaims ?? 0,
      territories: owned.map((cell) => ({ cellId: cell.cellId, q: cell.q, r: cell.r, terrain: cell.terrain, isHome: cell.isHome ?? false })),
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
    const owned = await ctx.db
      .query("territories")
      .withIndex("by_owner", (q) => q.eq("ownerKingdomId", args.kingdomId))
      .collect();
    const check = canClaimTerritory({
      target: { cellId: target.cellId, q: target.q, r: target.r, terrain: target.terrain as any, ownerKingdomId: target.ownerKingdomId ?? null },
      ownedCells: owned.map((cell) => ({ q: cell.q, r: cell.r })),
      pendingClaims: kingdom.pendingTerritoryClaims ?? 0,
    });
    if (!check.success) throw new Error(check.error);
    const now = Date.now();
    await ctx.db.patch(target._id, { ownerKingdomId: args.kingdomId, isHome: false, claimedAt: now });
    await ctx.db.patch(args.kingdomId, { pendingTerritoryClaims: (kingdom.pendingTerritoryClaims ?? 0) - 1, updatedAt: now });
    return { success: true, cellId: target.cellId, terrain: target.terrain, remainingClaims: (kingdom.pendingTerritoryClaims ?? 0) - 1 };
  },
});
