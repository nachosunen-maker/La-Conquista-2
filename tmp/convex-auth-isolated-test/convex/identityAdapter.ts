import { mutation } from "./_generated/server.js";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const DEMO_USER_ID = "guest_g9ai8cz";

export async function resolveCallerIdentity(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity?.subject === DEMO_USER_ID) return DEMO_USER_ID;

  // Use official Convex Auth canonical ID
  const userId = await getAuthUserId(ctx);
  if (userId) return userId;

  // Legacy Google sub (requires verification)
  if (identity?.subject) {
    // This part should only be used for legacy access, not for *authoritative* identity resolution
    return identity.subject;
  }

  return "";
}

export async function isAdapterKingdomOwner(
  ctx: any,
  kingdomUserId: string
): Promise<boolean> {
  const resolvedCaller = await resolveCallerIdentity(ctx);
  if (!resolvedCaller || resolvedCaller === DEMO_USER_ID) {
    return false;
  }

  if (kingdomUserId === resolvedCaller) {
    return true;
  }

  // Check mapping
  const mapping = await ctx.db
    .query("identityMappings")
    .withIndex("by_external_id", (q: any) =>
      q.eq("provider", "google").eq("externalId", kingdomUserId)
    )
    .unique();

  return !!(mapping && mapping.verified && mapping.canonicalUserId === resolvedCaller);
}

/**
 * RECHAZO: El flujo de verificación OAuth no está implementado en este entorno.
 */
export const linkIdentity = mutation({
  args: {
    provider: v.string(),
    externalId: v.string(),
  },
  handler: async (ctx, args) => {
    throw new Error("NO APTO: El flujo de verificación OAuth oficial para demostrar el control de la identidad externa no está implementado ni integrado en este entorno.");
  },
});
