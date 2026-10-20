export const DEMO_USER_ID = "guest_g9ai8cz";

export async function resolveCallerIdentity(
  ctx: any,
  authSubject?: string,
  authUserId?: string
): Promise<string> {
  // 1. If demo or explicit demo caller
  if (authSubject === DEMO_USER_ID || authUserId === DEMO_USER_ID) {
    return DEMO_USER_ID;
  }

  // 2. Check if authUserId (canonical Convex Auth user ID) is provided
  if (authUserId) {
    // Check if there is a verified mapping from an external identity (like Google sub)
    // or if the canonical user ID itself is used as owner
    return authUserId;
  }

  // 3. Fallback to authSubject (legacy Google sub)
  if (authSubject) {
    // Check if this authSubject has a verified mapping to a canonical user ID
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

  // Direct match
  if (kingdomUserId === resolvedCaller) {
    return true;
  }

  // Check if kingdomUserId is a legacy Google sub mapped to this canonical caller
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
