/**
 * LA CONQUISTA — REGLAS PURAS DE LA CUENTA DEL JUGADOR (P4, P5, sección 5 de CLAUDE.md)
 * Nombre de gobernante + contraseña, sin correo. Código de recuperación mostrado una
 * sola vez [DECISIÓN 21-10-2026]. Sin acceso a Convex ni efectos secundarios.
 */
import { ACCOUNT } from "./balanceConfig";

export type RuleResult = { success: true } | { success: false; error: string };

/** Mensajes visibles (español). El de credenciales es genérico: no revela qué campo falla. */
export const ACCOUNT_MESSAGES = {
  INVALID_CREDENTIALS: "Nombre o contraseña incorrectos.",
  NAME_TAKEN: "Ese nombre de gobernante ya está en uso. Elige otro.",
  RECOVERY_INVALID: "Nombre o código de recuperación incorrectos.",
  RECOVERY_LOCKED: "Demasiados intentos fallidos. Espera unos minutos y vuelve a intentarlo.",
  RECOVERY_ALREADY_ISSUED: "Tu cuenta ya tiene un código de recuperación activo; solo se muestra una vez.",
} as const;

/** Quita acentos y diacríticos, recorta y pasa a minúsculas: identificador único del gobernante. */
export function normalizeRulerName(rawName: string): string {
  return rawName
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function validateRulerName(rawName: unknown): RuleResult {
  if (typeof rawName !== "string") return { success: false, error: "El nombre de gobernante es obligatorio." };
  const trimmed = rawName.trim().replace(/\s+/g, " ");
  const length = Array.from(trimmed).length;
  if (length < ACCOUNT.RULER_NAME_MIN_LENGTH || length > ACCOUNT.RULER_NAME_MAX_LENGTH) {
    return {
      success: false,
      error: `El nombre de gobernante debe tener entre ${ACCOUNT.RULER_NAME_MIN_LENGTH} y ${ACCOUNT.RULER_NAME_MAX_LENGTH} caracteres.`,
    };
  }
  if (!ACCOUNT.RULER_NAME_PATTERN.test(trimmed)) {
    return { success: false, error: "El nombre solo admite letras, números, espacios, apóstrofos, puntos y guiones." };
  }
  return { success: true };
}

/** Nombre tal como se muestra: recortado y con espacios simples. */
export function displayRulerName(rawName: string): string {
  return rawName.trim().replace(/\s+/g, " ");
}

/**
 * [DERIVADO] Convex Auth identifica la cuenta de contraseña por un correo. Se usa uno
 * sintético e interno a partir del nombre normalizado; nunca se envía correo alguno.
 */
export function rulerNameToAccountEmail(rawName: string): string {
  return `${encodeURIComponent(normalizeRulerName(rawName))}@${ACCOUNT.SYNTHETIC_EMAIL_DOMAIN}`;
}

export function validatePassword(password: unknown): RuleResult {
  if (typeof password !== "string" || password.length < ACCOUNT.PASSWORD_MIN_LENGTH) {
    return { success: false, error: `La contraseña debe tener al menos ${ACCOUNT.PASSWORD_MIN_LENGTH} caracteres.` };
  }
  if (password.length > ACCOUNT.PASSWORD_MAX_LENGTH) {
    return { success: false, error: `La contraseña no puede superar ${ACCOUNT.PASSWORD_MAX_LENGTH} caracteres.` };
  }
  return { success: true };
}

// ----------------------------------------------------------------------------
// Código de recuperación
// ----------------------------------------------------------------------------
const CODE = ACCOUNT.RECOVERY_CODE;

/**
 * Convierte bytes aleatorios (los aporta el servidor) en un código del alfabeto sin
 * sesgo: se descartan los bytes fuera del mayor múltiplo del tamaño del alfabeto.
 * Devuelve null si no hay bytes suficientes (el llamante pide más).
 */
export function recoveryCodeFromRandomBytes(bytes: ArrayLike<number>): string | null {
  const alphabet = CODE.ALPHABET;
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let code = "";
  for (let i = 0; i < bytes.length && code.length < CODE.LENGTH; i++) {
    const byte = bytes[i];
    if (byte >= limit) continue;
    code += alphabet[byte % alphabet.length];
  }
  return code.length === CODE.LENGTH ? code : null;
}

/** Presentación con grupos: K7PF-3MQ2-… */
export function formatRecoveryCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += CODE.GROUP_SIZE) groups.push(code.slice(i, i + CODE.GROUP_SIZE));
  return groups.join(CODE.SEPARATOR);
}

/** Acepta el código escrito con o sin guiones/espacios y en cualquier caja. */
export function normalizeRecoveryCode(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidRecoveryCodeShape(code: string): boolean {
  if (code.length !== CODE.LENGTH) return false;
  for (const ch of code) if (!CODE.ALPHABET.includes(ch)) return false;
  return true;
}

export interface RecoveryAttemptState {
  failedAttempts: number;
  lockedUntil?: number;
}

/** ¿Está bloqueada la recuperación en este instante? */
export function isRecoveryLocked(state: RecoveryAttemptState, now: number): boolean {
  return state.lockedUntil !== undefined && state.lockedUntil > now;
}

/** Estado tras un intento fallido: cuenta y, al agotar los intentos, bloquea LOCK_MS. */
export function registerFailedRecoveryAttempt(state: RecoveryAttemptState, now: number): RecoveryAttemptState {
  const failedAttempts = state.failedAttempts + 1;
  if (failedAttempts >= CODE.MAX_FAILED_ATTEMPTS) {
    return { failedAttempts: 0, lockedUntil: now + CODE.LOCK_MS };
  }
  return { failedAttempts, lockedUntil: undefined };
}

/** Comparación en tiempo constante de dos hashes en hexadecimal. */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
