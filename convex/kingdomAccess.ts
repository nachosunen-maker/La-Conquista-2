/**
 * Identificador canónico de la cuenta de demostración de solo lectura ("Reino de Iberia").
 * El literal "guest_g9ai8cz" corresponde históricamente a la cuenta demo pública de Iberia
 * (verificado en kingdoms.ts, integration.test.ts y pruebas de solo lectura).
 * Centralizado aquí para evitar comprobaciones por literales dispersos o coincidencias ambiguas por nombre.
 */
export const DEMO_USER_ID = "guest_g9ai8cz";

export const DEMO_ACCOUNT_IDS: ReadonlySet<string> = new Set([DEMO_USER_ID]);

function baseUserId(id?: string | null): string {
  if (!id) return "";
  return id.split("|")[0];
}

/** Comprueba de forma inequívoca si un userId pertenece a una cuenta de demostración registrada. */
export function isDemoAccountUserId(userId?: string | null): boolean {
  if (!userId) return false;
  return DEMO_ACCOUNT_IDS.has(userId) || DEMO_ACCOUNT_IDS.has(baseUserId(userId));
}

export function resolveKingdomQueryUserId(
  requestedUserId?: string | null,
  authenticatedUserId?: string | null
): string | null {
  if (isDemoAccountUserId(requestedUserId)) return DEMO_USER_ID;
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
  if (isDemoAccountUserId(kingdomUserId)) return false;
  return baseUserId(kingdomUserId) === baseUserId(authenticatedUserId);
}

/**
 * Lee los identificadores de administradores configurados en servidor mediante ADMIN_USER_IDS
 * (lista separada por comas de subjects/IDs autenticados por Convex Auth).
 * Nunca incluye cuentas de demostración ni acepta identificadores enviados por el cliente.
 */
export function getConfiguredAdminIds(): Set<string> {
  const envProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const raw = envProcess?.env?.ADMIN_USER_IDS ?? "";
  const ids = new Set<string>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed || isDemoAccountUserId(trimmed)) continue;
    ids.add(trimmed);
    const base = baseUserId(trimmed);
    if (base && !isDemoAccountUserId(base)) ids.add(base);
  }
  return ids;
}

/**
 * Verifica en servidor que el llamante posee una sesión autenticada de administrador autorizado.
 * Rechaza llamadas anónimas, cuentas de demostración y usuarios normales.
 */
export async function requireAuthorizedAdmin(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject?: string | null } | null> };
}): Promise<{ adminIdentity: string; baseAdminId: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new Error("No autorizado: se requiere una sesión administrativa autenticada en servidor.");
  }
  if (isDemoAccountUserId(identity.subject)) {
    throw new Error("No autorizado: la cuenta de demostración no dispone de permisos administrativos.");
  }
  const configuredAdmins = getConfiguredAdminIds();
  const base = baseUserId(identity.subject);
  if (configuredAdmins.size === 0 || (!configuredAdmins.has(identity.subject) && !configuredAdmins.has(base))) {
    throw new Error("No autorizado: el usuario autenticado no tiene permisos administrativos.");
  }
  return { adminIdentity: identity.subject, baseAdminId: base };
}