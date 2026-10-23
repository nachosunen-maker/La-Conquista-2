/**
 * Convex Auth con proveedor de contraseña (T-01 B). Entrada por nombre de gobernante +
 * contraseña, sin correo ni Google [DECISIÓN 21-10-2026]. Flujos: "signUp" (crear cuenta)
 * y "signIn" (entrar). La contraseña se guarda con hash scrypt (P5).
 * El código de recuperación vive en convex/account.ts.
 */
import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError } from "convex/values";
import { DataModel } from "./_generated/dataModel.js";
import { ACCOUNT } from "./balanceConfig";
import {
  displayRulerName,
  rulerNameToAccountEmail,
  validatePassword,
  validateRulerName,
} from "./accountRules";

const RulerPassword = Password<DataModel>({
  profile(params) {
    const rawName = (params.username ?? params.name) as unknown;
    const nameCheck = validateRulerName(rawName);
    if (!nameCheck.success) throw new ConvexError(nameCheck.error);
    const name = displayRulerName(rawName as string);
    return { email: rulerNameToAccountEmail(name), name };
  },
  validatePasswordRequirements(password) {
    const check = validatePassword(password);
    if (!check.success) throw new ConvexError(check.error);
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [RulerPassword],
  signIn: { maxFailedAttempsPerHour: ACCOUNT.SIGN_IN_MAX_FAILED_ATTEMPTS_PER_HOUR },
});

