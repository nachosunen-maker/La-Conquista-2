export const DEMO_USER_ID = "guest_g9ai8cz";

export function resolveKingdomQueryUserId(
  requestedUserId: string,
  authenticatedUserId?: string
): string | null {
  if (requestedUserId === DEMO_USER_ID) return DEMO_USER_ID;
  if (!authenticatedUserId) return null;
  if (requestedUserId !== authenticatedUserId) {
    throw new Error("No autorizado: solo se puede consultar el reino propio o la demo de solo lectura.");
  }
  return authenticatedUserId;
}

export function isKingdomOwner(kingdomUserId: string, authenticatedUserId?: string): boolean {
  return Boolean(
    authenticatedUserId &&
    kingdomUserId !== DEMO_USER_ID &&
    kingdomUserId === authenticatedUserId
  );
}