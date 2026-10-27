export const DEMO_USER_ID = "guest_g9ai8cz";

function baseUserId(id?: string | null): string {
  if (!id) return "";
  return id.split("|")[0];
}

export function resolveKingdomQueryUserId(
  requestedUserId?: string | null,
  authenticatedUserId?: string | null
): string | null {
  if (requestedUserId === DEMO_USER_ID) return DEMO_USER_ID;
  if (!authenticatedUserId) return null;
  const baseRequested = baseUserId(requestedUserId);
  const baseAuth = baseUserId(authenticatedUserId);
  if (!baseRequested || baseRequested === baseAuth) {
    return baseAuth;
  }
  throw new Error("No autorizado: solo se puede consultar el reino propio o la demo de solo lectura.");
}

export function isKingdomOwner(kingdomUserId: string, authenticatedUserId?: string | null): boolean {
  if (!authenticatedUserId || !kingdomUserId) return false;
  if (kingdomUserId === DEMO_USER_ID) return false;
  return baseUserId(kingdomUserId) === baseUserId(authenticatedUserId);
}