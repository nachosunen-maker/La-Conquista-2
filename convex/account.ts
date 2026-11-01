/**
 * LA CONQUISTA — CUENTA DEL JUGADOR: disponibilidad del nombre y código de recuperación.
 * [DECISIÓN 21-10-2026] Sin correo: al crear la cuenta se muestra UNA SOLA VEZ un código de
 * recuperación que el jugador debe guardar. Con nombre + código puede fijar una contraseña
 * nueva. El servidor guarda solo el hash del código; cada código es de un solo uso y, al
 * usarse, se entrega otro nuevo (también mostrado una sola vez).
 */
import { ConvexError, v } from "convex/values";
import { getAuthUserId, invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  ACCOUNT_MESSAGES,
  formatRecoveryCode,
  hashesMatch,
  isRecoveryLocked,
  isValidRecoveryCodeShape,
  normalizeRecoveryCode,
  recoveryCodeFromRandomBytes,
  registerFailedRecoveryAttempt,
  rulerNameToAccountEmail,
  validatePassword,
  validateRulerName,
} from "./accountRules";

const PASSWORD_PROVIDER_ID = "password";

/** Hash SHA-256 en hexadecimal (Web Crypto del entorno de Convex). */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Código aleatorio con la entropía del sistema (solo en acciones; en mutaciones el azar es determinista). */
function generateRecoveryCode(): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    const code = recoveryCodeFromRandomBytes(bytes);
    if (code) return code;
  }
  throw new Error("No se pudo generar el código de recuperación.");
}

// ----------------------------------------------------------------------------
// Consultas públicas
// ----------------------------------------------------------------------------

/** Comprueba antes de crear la cuenta si el nombre de gobernante es válido y está libre. */
export const isRulerNameAvailable = query({
  args: { rulerName: v.string() },
  handler: async (ctx, args) => {
    const check = validateRulerName(args.rulerName);
    if (!check.success) return { available: false, error: check.error };
    const email = rulerNameToAccountEmail(args.rulerName);
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (existing) return { available: false, error: ACCOUNT_MESSAGES.NAME_TAKEN };
    return { available: true, error: null };
  },
});

/** Estado del código de recuperación del jugador autenticado (nunca devuelve el código). */
export const getRecoveryStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const record = await ctx.db
      .query("accountRecovery")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      hasActiveCode: record !== null,
      issuedAt: record?.issuedAt ?? null,
      lastUsedAt: record?.lastUsedAt ?? null,
    };
  },
});

// ----------------------------------------------------------------------------
// Funciones internas (solo las llaman las acciones de este módulo)
// ----------------------------------------------------------------------------

export const getRecoveryRecord = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("accountRecovery")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const findRecoveryByAccountEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (!user) return null;
    const record = await ctx.db
      .query("accountRecovery")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!record) return null;
    return {
      recordId: record._id,
      userId: user._id,
      codeHash: record.codeHash,
      failedAttempts: record.failedAttempts,
      lockedUntil: record.lockedUntil,
    };
  },
});

/** Guarda (o sustituye) el hash del código del usuario y reinicia el contador de fallos. */
export const storeRecoveryCodeHash = internalMutation({
  args: { userId: v.id("users"), codeHash: v.string(), markUsed: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("accountRecovery")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    const fields = {
      codeHash: args.codeHash,
      issuedAt: now,
      failedAttempts: 0,
      lockedUntil: undefined,
      lastUsedAt: args.markUsed ? now : existing?.lastUsedAt,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("accountRecovery", { userId: args.userId, ...fields });
  },
});

export const recordFailedRecoveryAttempt = internalMutation({
  args: { recordId: v.id("accountRecovery") },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.recordId);
    if (!record) return;
    const next = registerFailedRecoveryAttempt(
      { failedAttempts: record.failedAttempts, lockedUntil: record.lockedUntil },
      Date.now()
    );
    await ctx.db.patch(args.recordId, next);
  },
});

// ----------------------------------------------------------------------------
export const resetRecoveryAttempts = internalMutation({
  args: { recordId: v.id("accountRecovery") },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.recordId, {
      failedAttempts: 0,
      lockedUntil: undefined,
      lastUsedAt: now,
    });
  },
});

// ----------------------------------------------------------------------------
// Acciones públicas
// ----------------------------------------------------------------------------

/**
 * Entrega el código de recuperación al jugador autenticado. Solo se emite si la cuenta no
 * tiene ninguno (al crearla) o si el jugador, ya dentro, pide uno nuevo con `regenerate`
 * (el anterior deja de valer). El servidor nunca puede volver a mostrar un código emitido.
 */
export const issueRecoveryCode = action({
  args: { regenerate: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ recoveryCode: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Autenticación requerida para obtener el código de recuperación.");
    const existing = await ctx.runQuery(internal.account.getRecoveryRecord, { userId });
    if (existing && !args.regenerate) throw new ConvexError(ACCOUNT_MESSAGES.RECOVERY_ALREADY_ISSUED);
    const code = generateRecoveryCode();
    await ctx.runMutation(internal.account.storeRecoveryCodeHash, { userId, codeHash: await sha256Hex(code) });
    return { recoveryCode: formatRecoveryCode(code) };
  },
});

/**
 * Restablece la contraseña con nombre de gobernante + clave de recuperación (sin sesión).
 * La clave es PERMANENTE Y REUTILIZABLE: una recuperación exitosa restablece la contraseña
 * y el contador de fallos, pero mantiene intacta la clave de recuperación original.
 */
export const resetPasswordWithRecoveryCode = action({
  args: { rulerName: v.string(), recoveryCode: v.string(), newPassword: v.string() },
  handler: async (ctx, args): Promise<{ success: boolean; message: string }> => {
    const passwordCheck = validatePassword(args.newPassword);
    if (!passwordCheck.success) throw new ConvexError(passwordCheck.error);
    const code = normalizeRecoveryCode(args.recoveryCode);
    if (!validateRulerName(args.rulerName).success || !isValidRecoveryCodeShape(code)) {
      throw new ConvexError(ACCOUNT_MESSAGES.RECOVERY_INVALID);
    }
    const email = rulerNameToAccountEmail(args.rulerName);
    const record = await ctx.runQuery(internal.account.findRecoveryByAccountEmail, { email });
    if (!record) throw new ConvexError(ACCOUNT_MESSAGES.RECOVERY_INVALID);
    if (isRecoveryLocked(record, Date.now())) throw new ConvexError(ACCOUNT_MESSAGES.RECOVERY_LOCKED);

    const providedHash = await sha256Hex(code);
    if (!hashesMatch(providedHash, record.codeHash)) {
      await ctx.runMutation(internal.account.recordFailedRecoveryAttempt, { recordId: record.recordId });
      throw new ConvexError(ACCOUNT_MESSAGES.RECOVERY_INVALID);
    }

    const userId = record.userId as Id<"users">;
    await modifyAccountCredentials(ctx, {
      provider: PASSWORD_PROVIDER_ID,
      account: { id: email, secret: args.newPassword },
    });
    await invalidateSessions(ctx, { userId });
    await ctx.runMutation(internal.account.resetRecoveryAttempts, { recordId: record.recordId });
    return {
      success: true,
      message: "Contraseña restablecida con éxito. Ya puedes iniciar sesión con tu nueva contraseña.",
    };
  },
});
