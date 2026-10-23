/**
 * LA CONQUISTA — PRUEBAS DE INTEGRACIÓN DE LA CUENTA (sección 5 de CLAUDE.md, T-01).
 * Crear cuenta e iniciar sesión por nombre de gobernante + contraseña con Convex Auth, y
 * código de recuperación mostrado una sola vez [DECISIÓN 21-10-2026]. Backend simulado de
 * convex-test con una clave de firma desechable generada en cada ejecución (nunca un secreto real).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { createTestBackend } from "./test.setup";
import { ACCOUNT } from "./balanceConfig";
import { ACCOUNT_MESSAGES } from "./accountRules";

const TEST_SITE_URL = "https://pruebas-la-conquista.convex.site";
const T0 = new Date("2026-10-22T10:00:00Z").getTime();

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/** Clave RSA desechable para que Convex Auth pueda firmar tokens en las pruebas. */
async function installThrowawaySigningKey() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const pkcs8 = toBase64(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)).replace(/(.{64})/g, "$1\n");
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  process.env.JWT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`;
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", ...jwk }] });
  process.env.CONVEX_SITE_URL = TEST_SITE_URL;
  process.env.SITE_URL = "http://localhost:3000";
}

function decodeJwtSubject(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  return payload.sub as string;
}

type Backend = ReturnType<typeof createTestBackend>;

async function signIn(t: Backend, flow: "signUp" | "signIn", username: string, password: string) {
  const result = await t.action(api.auth.signIn, { provider: "password", params: { username, password, flow } });
  const token = (result as any).tokens?.token as string | undefined;
  if (!token) throw new Error("Convex Auth no devolvió token de sesión");
  const subject = decodeJwtSubject(token);
  const userId = subject.split("|")[0];
  const asUser = t.withIdentity({ subject, issuer: TEST_SITE_URL, tokenIdentifier: `${TEST_SITE_URL}|${subject}` });
  return { asUser, userId, subject };
}

function errorMessage(error: unknown): string {
  const data = (error as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return error instanceof Error ? error.message : String(error);
}

beforeAll(async () => {
  await installThrowawaySigningKey();
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Cuenta: nombre de gobernante + contraseña (sección 5, T-01)", () => {
  test("crea la cuenta, inicia sesión desde otro dispositivo y el nombre es único sin distinguir mayúsculas ni acentos", async () => {
    const t = createTestBackend();
    const created = await signIn(t, "signUp", "Alfonso de Castilla", "corona-2026");
    const viewer = await created.asUser.query(api.kingdoms.getViewer, {});
    expect(viewer?.rulerName).toBe("Alfonso de Castilla");
    expect(viewer?.userId).toBe(created.userId);

    // Segunda sesión (otro dispositivo): misma cuenta, mismo usuario.
    const again = await signIn(t, "signIn", "alfonso DE castilla", "corona-2026");
    expect(again.userId).toBe(created.userId);
    expect(again.subject).not.toBe(created.subject);

    // El nombre ya está ocupado, con acentos o mayúsculas distintas.
    const availability = await t.query(api.account.isRulerNameAvailable, { rulerName: "ÁLFONSO de Castilla" });
    expect(availability.available).toBe(false);
    expect(availability.error).toBe(ACCOUNT_MESSAGES.NAME_TAKEN);
    await expect(signIn(t, "signUp", "Álfonso de Castilla", "otra-clave-123")).rejects.toThrow(/already exists/);
    expect((await t.query(api.account.isRulerNameAvailable, { rulerName: "Urraca de León" })).available).toBe(true);
  });

  test("rechaza contraseñas cortas, nombres inválidos y credenciales incorrectas; la contraseña nunca se guarda en claro", async () => {
    const t = createTestBackend();
    await expect(signIn(t, "signUp", "Rey Sancho", "1234567")).rejects.toSatisfy((e: unknown) =>
      errorMessage(e).includes(`${ACCOUNT.PASSWORD_MIN_LENGTH} caracteres`)
    );
    await expect(signIn(t, "signUp", "R", "clave-larga-1")).rejects.toSatisfy((e: unknown) =>
      errorMessage(e).includes(`${ACCOUNT.RULER_NAME_MIN_LENGTH} y ${ACCOUNT.RULER_NAME_MAX_LENGTH}`)
    );
    await expect(signIn(t, "signUp", "Rey@Sancho", "clave-larga-1")).rejects.toSatisfy((e: unknown) =>
      errorMessage(e).includes("solo admite")
    );

    await signIn(t, "signUp", "Rey Sancho", "clave-larga-1");
    await expect(signIn(t, "signIn", "Rey Sancho", "clave-equivocada")).rejects.toThrow(/InvalidSecret|InvalidAccountId|Invalid credentials/);
    await expect(signIn(t, "signIn", "Rey Desconocido", "clave-larga-1")).rejects.toThrow(/InvalidSecret|InvalidAccountId|Invalid credentials/);

    const stored = await t.run(async (ctx) => {
      const accounts = await ctx.db.query("authAccounts").collect();
      const users = await ctx.db.query("users").collect();
      return { accounts, users };
    });
    expect(stored.accounts).toHaveLength(1);
    expect(stored.accounts[0].secret).toBeDefined();
    expect(stored.accounts[0].secret).not.toContain("clave-larga-1");
    expect(stored.users[0].email).toBe(`rey%20sancho@${ACCOUNT.SYNTHETIC_EMAIL_DOMAIN}`);
  });

  test("el invitado no tiene identidad: getViewer es null y no puede pedir código ni fundar reino", async () => {
    const t = createTestBackend();
    expect(await t.query(api.kingdoms.getViewer, {})).toBeNull();
    expect(await t.query(api.account.getRecoveryStatus, {})).toBeNull();
    await expect(t.action(api.account.issueRecoveryCode, {})).rejects.toThrow(/Autenticación requerida/);
  });
});

describe("Código de recuperación mostrado una sola vez [DECISIÓN 21-10-2026]", () => {
  test("se emite una vez al crear la cuenta, solo se guarda su hash y no se vuelve a entregar", async () => {
    const t = createTestBackend();
    const { asUser } = await signIn(t, "signUp", "Urraca de León", "reina-1109-x");
    expect((await asUser.query(api.account.getRecoveryStatus, {}))?.hasActiveCode).toBe(false);

    const issued = await asUser.action(api.account.issueRecoveryCode, {});
    expect(issued.recoveryCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(issued.recoveryCode).not.toMatch(/[0OI1L]/);

    const status = await asUser.query(api.account.getRecoveryStatus, {});
    expect(status?.hasActiveCode).toBe(true);
    expect(status?.issuedAt).toBe(T0);

    const records = await t.run((ctx) => ctx.db.query("accountRecovery").collect());
    expect(records).toHaveLength(1);
    expect(records[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(records[0].codeHash).not.toContain(issued.recoveryCode.replace(/-/g, ""));

    await expect(asUser.action(api.account.issueRecoveryCode, {})).rejects.toSatisfy((e: unknown) =>
      errorMessage(e) === ACCOUNT_MESSAGES.RECOVERY_ALREADY_ISSUED
    );
    // Dentro de la sesión se puede pedir uno nuevo: el anterior deja de valer.
    const regenerated = await asUser.action(api.account.issueRecoveryCode, { regenerate: true });
    expect(regenerated.recoveryCode).not.toBe(issued.recoveryCode);
    expect(await t.run((ctx) => ctx.db.query("accountRecovery").collect())).toHaveLength(1);
  });

  test("con nombre + código se fija una contraseña nueva, se cierran las sesiones y se entrega otro código de un solo uso", async () => {
    const t = createTestBackend();
    const { asUser } = await signIn(t, "signUp", "Fernando el Católico", "aragon-1479");
    const { recoveryCode } = await asUser.action(api.account.issueRecoveryCode, {});

    const result = await t.action(api.account.resetPasswordWithRecoveryCode, {
      rulerName: "fernando el catolico",
      recoveryCode: recoveryCode.toLowerCase().replace(/-/g, " "),
      newPassword: "castilla-1474",
    });
    expect(result.recoveryCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(result.recoveryCode).not.toBe(recoveryCode);

    // La sesión anterior queda invalidada; la contraseña vieja ya no sirve y la nueva sí.
    const sessions = await t.run((ctx) => ctx.db.query("authSessions").collect());
    expect(sessions).toHaveLength(0);
    await expect(signIn(t, "signIn", "Fernando el Católico", "aragon-1479")).rejects.toThrow(/InvalidSecret|InvalidAccountId|Invalid credentials/);
    const back = await signIn(t, "signIn", "Fernando el Católico", "castilla-1474");
    expect((await back.asUser.query(api.account.getRecoveryStatus, {}))?.lastUsedAt).toBe(T0);

    // El código usado no vale una segunda vez; el nuevo sí.
    await expect(
      t.action(api.account.resetPasswordWithRecoveryCode, { rulerName: "Fernando el Católico", recoveryCode, newPassword: "otra-clave-999" })
    ).rejects.toSatisfy((e: unknown) => errorMessage(e) === ACCOUNT_MESSAGES.RECOVERY_INVALID);
    await t.action(api.account.resetPasswordWithRecoveryCode, {
      rulerName: "Fernando el Católico",
      recoveryCode: result.recoveryCode,
      newPassword: "tercera-clave-1",
    });
    await signIn(t, "signIn", "Fernando el Católico", "tercera-clave-1");
  });

  test("mensajes genéricos, contraseña nueva válida y bloqueo temporal tras varios fallos seguidos", async () => {
    const t = createTestBackend();
    const { asUser } = await signIn(t, "signUp", "Isabel de Castilla", "trastamara-1451");
    const { recoveryCode } = await asUser.action(api.account.issueRecoveryCode, {});
    const wrongCode = "AAAA-BBBB-CCCC-DDDD";

    // Nombre inexistente y código con forma incorrecta: mismo mensaje genérico, sin contar como intento.
    await expect(
      t.action(api.account.resetPasswordWithRecoveryCode, { rulerName: "Nadie", recoveryCode: wrongCode, newPassword: "clave-nueva-123" })
    ).rejects.toSatisfy((e: unknown) => errorMessage(e) === ACCOUNT_MESSAGES.RECOVERY_INVALID);
    await expect(
      t.action(api.account.resetPasswordWithRecoveryCode, { rulerName: "Isabel de Castilla", recoveryCode: "corto", newPassword: "clave-nueva-123" })
    ).rejects.toSatisfy((e: unknown) => errorMessage(e) === ACCOUNT_MESSAGES.RECOVERY_INVALID);
    await expect(
      t.action(api.account.resetPasswordWithRecoveryCode, { rulerName: "Isabel de Castilla", recoveryCode, newPassword: "corta" })
    ).rejects.toSatisfy((e: unknown) => errorMessage(e).includes(`${ACCOUNT.PASSWORD_MIN_LENGTH} caracteres`));

    for (let i = 0; i < ACCOUNT.RECOVERY_CODE.MAX_FAILED_ATTEMPTS; i++) {
      await expect(
        t.action(api.account.resetPasswordWithRecoveryCode, { rulerName: "Isabel de Castilla", recoveryCode: wrongCode, newPassword: "clave-nueva-123" })
      ).rejects.toSatisfy((e: unknown) => errorMessage(e) === ACCOUNT_MESSAGES.RECOVERY_INVALID);
    }
    // Bloqueada: ni siquiera el código correcto entra hasta que pase el tiempo de bloqueo.
    await expect(
      t.action(api.account.resetPasswordWithRecoveryCode, { rulerName: "Isabel de Castilla", recoveryCode, newPassword: "clave-nueva-123" })
    ).rejects.toSatisfy((e: unknown) => errorMessage(e) === ACCOUNT_MESSAGES.RECOVERY_LOCKED);

    vi.setSystemTime(T0 + ACCOUNT.RECOVERY_CODE.LOCK_MS + 1);
    const result = await t.action(api.account.resetPasswordWithRecoveryCode, {
      rulerName: "Isabel de Castilla",
      recoveryCode,
      newPassword: "clave-nueva-123",
    });
    expect(result.recoveryCode).toBeDefined();
    await signIn(t, "signIn", "Isabel de Castilla", "clave-nueva-123");
  });
});
