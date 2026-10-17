export const DEMO_USER_ID = "guest_g9ai8cz";

export function resolveKingdomQueryUserId(
  requestedUserId: string,
  authenticatedSubject?: string
): string | null {
  if (requestedUserId === DEMO_USER_ID) return DEMO_USER_ID;
  if (!authenticatedSubject) return null;
  if (requestedUserId !== authenticatedSubject) {
    throw new Error("No autorizado: solo se puede consultar el reino propio o la demo de solo lectura.");
  }
  return authenticatedSubject;
}

export function isKingdomOwner(kingdomUserId: string, authenticatedSubject?: string): boolean {
  return Boolean(
    authenticatedSubject &&
    kingdomUserId !== DEMO_USER_ID &&
    kingdomUserId === authenticatedSubject
  );
}