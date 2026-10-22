/**
 * Pruebas puras de la cuenta del jugador (sección 5 de CLAUDE.md): nombre de gobernante,
 * contraseña y código de recuperación. Sin Convex.
 */
import { ACCOUNT } from "./balanceConfig";
import {
  formatRecoveryCode,
  hashesMatch,
  isRecoveryLocked,
  isValidRecoveryCodeShape,
  normalizeRecoveryCode,
  normalizeRulerName,
  recoveryCodeFromRandomBytes,
  registerFailedRecoveryAttempt,
  rulerNameToAccountEmail,
  validatePassword,
  validateRulerName,
} from "./accountRules";

export interface AccountTestResult {
  category: string;
  test: string;
  passed: boolean;
  details: string;
}

const CATEGORY = "CUENTA Y ACCESO (P4, P5, sección 5)";

export function runAccountTests(): AccountTestResult[] {
  const results: AccountTestResult[] = [];
  const add = (test: string, passed: boolean, details: string) => results.push({ category: CATEGORY, test, passed, details });

  // Nombre de gobernante
  const okNames = ["Alfonso de Castilla", "Ña", "Jean-Luc d'Arc", "Rey Juan III", "Æthelred", "李世民"];
  const badNames = ["A", "a".repeat(41), " Alfonso  ", "", "Rey--Juan", "-Alfonso", "Rey@Castilla", "Rey_Juan", "Rey  Juan"];
  const okResults = okNames.map((n) => validateRulerName(n).success);
  const badResults = badNames.map((n) => validateRulerName(n).success);
  add(
    `Nombre de gobernante: ${ACCOUNT.RULER_NAME_MIN_LENGTH}–${ACCOUNT.RULER_NAME_MAX_LENGTH} caracteres; letras, números, espacio, apóstrofo, punto y guion simples`,
    okResults.every(Boolean) && !badResults[0] && !badResults[1] && badResults[2] && !badResults[3] && !badResults[4] && !badResults[5] && !badResults[6] && !badResults[7] && badResults[8],
    `válidos: ${okResults.join(",")} · inválidos (1 char, 41, espacios extra OK, vacío, --, -inicio, @, _, doble espacio OK): ${badResults.join(",")}`
  );

  const n1 = normalizeRulerName("  Alfonso   DE Castilla ");
  const n2 = normalizeRulerName("ALFONSO de CASTILLA");
  const n3 = normalizeRulerName("Álfonso dé Castílla");
  add(
    "Unicidad sin distinguir mayúsculas ni acentos: el identificador normalizado coincide y el correo sintético es interno",
    n1 === "alfonso de castilla" && n1 === n2 && n2 === n3 &&
      rulerNameToAccountEmail("Alfonso de Castilla") === `alfonso%20de%20castilla@${ACCOUNT.SYNTHETIC_EMAIL_DOMAIN}` &&
      rulerNameToAccountEmail("ÁLFONSO de Castilla") === rulerNameToAccountEmail("alfonso de castilla"),
    `normalizados: "${n1}" / "${n2}" / "${n3}" · correo: ${rulerNameToAccountEmail("Alfonso de Castilla")}`
  );

  // Contraseña
  add(
    `Contraseña: mínimo ${ACCOUNT.PASSWORD_MIN_LENGTH} caracteres y máximo ${ACCOUNT.PASSWORD_MAX_LENGTH}`,
    !validatePassword("1234567").success && validatePassword("12345678").success && !validatePassword("x".repeat(129)).success && !validatePassword(undefined).success,
    `7 → ${validatePassword("1234567").success}, 8 → ${validatePassword("12345678").success}, 129 → ${validatePassword("x".repeat(129)).success}`
  );

  // Código de recuperación
  const bytes = Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256);
  const code = recoveryCodeFromRandomBytes(bytes);
  const formatted = code ? formatRecoveryCode(code) : "";
  const short = recoveryCodeFromRandomBytes([1, 2, 3]);
  const biased = recoveryCodeFromRandomBytes(Array.from({ length: 40 }, () => 255));
  add(
    `Código de recuperación: ${ACCOUNT.RECOVERY_CODE.LENGTH} símbolos del alfabeto sin ambigüedades, en grupos de ${ACCOUNT.RECOVERY_CODE.GROUP_SIZE}; bytes fuera de rango se descartan (sin sesgo)`,
    code !== null && isValidRecoveryCodeShape(code) && formatted.split("-").length === 4 && formatted.replace(/-/g, "") === code &&
      short === null && biased === null && !/[0OI1L]/.test(code),
    `código: ${formatted} · pocos bytes → ${short} · solo bytes 255 → ${biased}`
  );
  add(
    "El código escrito en minúsculas, con espacios o sin guiones se normaliza al mismo valor",
    code !== null && normalizeRecoveryCode(formatted.toLowerCase()) === code && normalizeRecoveryCode(` ${code.slice(0, 8)} ${code.slice(8)} `) === code &&
      !isValidRecoveryCodeShape(normalizeRecoveryCode("abc")) && !isValidRecoveryCodeShape(code!.slice(0, 15) + "0"),
    `normalizado desde minúsculas: ${normalizeRecoveryCode(formatted.toLowerCase()) === code}`
  );

  // Intentos fallidos y bloqueo
  let state = { failedAttempts: 0 } as { failedAttempts: number; lockedUntil?: number };
  const now = 1_000_000;
  for (let i = 0; i < ACCOUNT.RECOVERY_CODE.MAX_FAILED_ATTEMPTS - 1; i++) state = registerFailedRecoveryAttempt(state, now);
  const beforeLock = !isRecoveryLocked(state, now) && state.failedAttempts === ACCOUNT.RECOVERY_CODE.MAX_FAILED_ATTEMPTS - 1;
  state = registerFailedRecoveryAttempt(state, now);
  const locked = isRecoveryLocked(state, now) && state.lockedUntil === now + ACCOUNT.RECOVERY_CODE.LOCK_MS && state.failedAttempts === 0;
  const released = !isRecoveryLocked(state, now + ACCOUNT.RECOVERY_CODE.LOCK_MS);
  add(
    `Recuperación: tras ${ACCOUNT.RECOVERY_CODE.MAX_FAILED_ATTEMPTS} fallos seguidos se bloquea ${ACCOUNT.RECOVERY_CODE.LOCK_MS / 60000} min y luego se libera`,
    beforeLock && locked && released,
    `antes del bloqueo: ${beforeLock} · bloqueado: ${locked} · liberado al expirar: ${released}`
  );

  add(
    "Comparación de hashes en tiempo constante",
    hashesMatch("abcd", "abcd") && !hashesMatch("abcd", "abce") && !hashesMatch("abc", "abcd"),
    "iguales → true; distinto último carácter → false; longitudes distintas → false"
  );

  return results;
}
