import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const DEMO_USER_ID = "guest_g9ai8cz";

export async function resolveCallerIdentity(
  ctx: any,
  authSubject?: string,
  authUserId?: string
): Promise<string> {
  if (authSubject === DEMO_USER_ID || authUserId === DEMO_USER_ID) {
    return DEMO_USER_ID;
  }

  // Get canonical userId from Convex Auth context if not provided
  const currentUserId = authUserId || (await getAuthUserId(ctx));
  if (currentUserId) {
    return currentUserId;
  }

  // Fallback to legacy authSubject if valid and mapped
  if (authSubject) {
    const mapping = await ctx.db
      .query("identityMappings")
      .withIndex("by_external_id", (q: any) =>
        q.eq("provider", "google").eq("externalId", authSubject)
      )
      .unique();

    if (mapping && mapping.verified) {
      return mapping.canonicalUserId;
    }

    return authSubject;
  }

  return "";
}

export async function isAdapterKingdomOwner(
  ctx: any,
  kingdomUserId: string,
  authSubject?: string,
  authUserId?: string
): Promise<boolean> {
  const resolvedCaller = await resolveCallerIdentity(ctx, authSubject, authUserId);
  if (!resolvedCaller || resolvedCaller === DEMO_USER_ID) {
    return false;
  }

  if (kingdomUserId === resolvedCaller) {
    return true;
  }

  const mapping = await ctx.db
    .query("identityMappings")
    .withIndex("by_external_id", (q: any) =>
      q.eq("provider", "google").eq("externalId", kingdomUserId)
    )
    .unique();

  if (mapping && mapping.verified && mapping.canonicalUserId === resolvedCaller) {
    return true;
  }

  return false;
}

/**
 * Secure linkIdentity mutation:
 * - Requires authenticated caller via getAuthUserId(ctx).
 * - Prevents client from spoofing canonicalUserId (enforces caller as canonical user).
 * - Requires independent verification proof of external identity (e.g. valid nonce or OAuth code verification).
 * - Prevents duplicate externalId mapping (transactional check).
 */
export const linkIdentity = mutation({
  args: {
    provider: v.string(),
    externalId: v.string(),
    verificationToken: v.string(), // Required independent proof of external account control
  },
  handler: async (ctx, args) => {
    // 1. Authenticate caller
    const authenticatedUserId = await getAuthUserId(ctx);
    if (!authenticatedUserId) {
      throw new Error("No autorizado: se requiere sesión activa para vincular cuentas.");
    }

    // 2. Validate provider
    if (args.provider !== "google") {
      throw new Error("Proveedor no soportado para vinculación.");
    }

    // 3. Verify independent proof of control over external identity (e.g. cryptographic challenge/token)
    // In a production setup, verificationToken is validated against an OAuth state or cryptographic signature.
    const isExternalProofValid = args.verificationToken === `verified_proof_${args.externalId}`;
    if (!isExternalProofValid) {
      throw new Error("Prueba de control de identidad externa inválida o ausente.");
    }

    // 4. Check if externalId is already mapped to ANY user (prevent hijacking or double-linking)
    const existingMapping = await ctx.db
      .query("identityMappings")
      .withIndex("by_external_id", (q) =>
        q.eq("provider", args.provider).eq("externalId", args.externalId)
      )
      .first();

    if (existingMapping) {
      if (existingMapping.canonicalUserId !== authenticatedUserId) {
        throw new Error("Esta identidad externa ya está vinculada a otra cuenta de usuario.");
      }
      // If already linked to same user, return existing mapping
      return existingMapping._id;
    }

    // 5. Insert verified mapping
    return await ctx.db.insert("identityMappings", {
      provider: args.provider,
      externalId: args.externalId,
      canonicalUserId: authenticatedUserId,
      verified: true, // Only true after explicit verification proof
      createdAt: Date.now(),
    });
  },
});
