/**
 * LA CONQUISTA — PRUEBAS EXHAUSTIVAS DEL PUNTO 6:
 * COMPENSACIÓN ÚNICA POR LA CAÍDA DEL SERVIDOR (+30.000 × 5 recursos).
 *
 * Cubre elegibilidad, exclusión de invitado/demo Iberia, concurrencia (Promise.all),
 * pérdida de respuesta/reintentos, recuperación tras estado incompleto, recarga de sesión,
 * dos dispositivos reales con Convex Auth (signIn), auditoría persistente en outageCompensations,
 * aislamiento respecto a otros jugadores y economía normal (spendResource/transactions),
 * rechazo de manipulación de argumentos por el cliente, reinicio de reino (resetKingdom),
 * y bloqueo de reactivación ante cambios de nombre o versión de campaña.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { createTestBackend } from "./test.setup";
import { OUTAGE_COMPENSATION } from "./balanceConfig";
import { DEMO_USER_ID } from "./kingdomAccess";
import { applyPendingOutageCompensationOnFounding } from "./compensation";

const TEST_SITE_URL = "https://pruebas-la-conquista.convex.site";
const T0 = new Date("2026-11-18T12:00:00Z").getTime();

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

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

function identity(subject: string) {
  return {
    subject,
    tokenIdentifier: `https://accounts.google.com|${subject}`,
    issuer: "https://accounts.google.com",
  };
}

async function signIn(t: Backend, flow: "signUp" | "signIn", username: string, password: string) {
  const result = await t.action(api.auth.signIn, {
    provider: "password",
    params: { username, password, flow },
  });
  const token = (result as any).tokens?.token as string | undefined;
  if (!token) throw new Error("Convex Auth no devolvió token de sesión");
  const subject = decodeJwtSubject(token);
  const userId = subject.split("|")[0];
  const asUser = t.withIdentity({
    subject,
    issuer: TEST_SITE_URL,
    tokenIdentifier: `${TEST_SITE_URL}|${subject}`,
  });
  return { asUser, userId, subject };
}

async function foundKingdom(t: Backend, asUser: ReturnType<Backend["withIdentity"]>, name: string) {
  const kingdom = await asUser.mutation(api.economy.getOrInitializeKingdom, {
    name,
    civilization: "romanos",
    castleName: `Castillo de ${name}`,
    monarchName: `Monarca de ${name}`,
  });
  return kingdom._id as any;
}

async function getResourcesDoc(t: Backend, kingdomId: any) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("resources")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .first();
  });
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

describe("Punto 6: Compensación única por caída del servidor (+30.000 × 5)", () => {
  test("1. Jugador elegible recibe exactamente +30.000 de cada uno de los 5 recursos por encima del almacén y se conserva tras tick", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-eligible-1"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Elegible");

    const beforeRes = await getResourcesDoc(t, kingdomId);
    expect(beforeRes).not.toBeNull();

    const statusBefore = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(statusBefore.authenticated).toBe(true);
    expect(statusBefore.eligible).toBe(true);
    expect(statusBefore.status).toBe("unclaimed");
    expect(statusBefore.incidentId).toBe(OUTAGE_COMPENSATION.INCIDENT_ID);
    expect(statusBefore.campaignId).toBe(OUTAGE_COMPENSATION.CAMPAIGN_ID);
    expect(statusBefore.resources).toEqual({
      gold: 30_000,
      wood: 30_000,
      stone: 30_000,
      iron: 30_000,
      food: 30_000,
    });

    const claim = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claim.success).toBe(true);
    expect(claim.alreadyClaimed).toBe(false);
    expect(claim.status).toBe("claimed");
    expect(claim.appliedImmediately).toBe(true);
    expect(claim.claimedKingdomId).toBe(kingdomId);
    expect(claim.resources).toEqual(OUTAGE_COMPENSATION.RESOURCES);

    const afterRes = await getResourcesDoc(t, kingdomId);
    expect(afterRes!.gold).toBe(beforeRes!.gold + 30_000);
    expect(afterRes!.wood).toBe(beforeRes!.wood + 30_000);
    expect(afterRes!.stone).toBe(beforeRes!.stone + 30_000);
    expect(afterRes!.iron).toBe(beforeRes!.iron + 30_000);
    expect(afterRes!.food).toBe(beforeRes!.food + 30_000);

    // Avanza 10 minutos y ejecuta syncKingdom: el excedente > 10.000 sobre el tope de almacén no se recorta
    vi.setSystemTime(T0 + 10 * 60 * 1000);
    const synced = await asUser.mutation(api.economy.syncKingdom, { kingdomId });
    expect(synced.resources.gold).toBeGreaterThanOrEqual(afterRes!.gold);
    expect(synced.resources.wood).toBeGreaterThanOrEqual(afterRes!.wood);
    expect(synced.resources.stone).toBeGreaterThanOrEqual(afterRes!.stone);
    expect(synced.resources.iron).toBeGreaterThanOrEqual(afterRes!.iron);
    expect(synced.resources.food).toBeGreaterThanOrEqual(30_000);
  });

  test("2. Jugadores no elegibles (sin sesión, invitado/demo Iberia) no reciben nada y son rechazados", async () => {
    const t = createTestBackend();

    // Sin autenticación
    const anonStatus = await t.query(api.compensation.getOutageCompensationStatus, {});
    expect(anonStatus.authenticated).toBe(false);
    expect(anonStatus.eligible).toBe(false);
    expect(anonStatus.status).toBe("excluded");
    await expect(t.mutation(api.compensation.claimOutageCompensation, {})).rejects.toThrow(/iniciar sesión/i);

    // Sujeto en blanco
    const blankCaller = t.withIdentity(identity("   "));
    await expect(blankCaller.mutation(api.compensation.claimOutageCompensation, {})).rejects.toThrow(/iniciar sesión/i);

    // Cuenta demo Iberia (directa y con sufijo de sesión)
    const demoKingdomId = await t.run(async (ctx) => {
      const kId = await ctx.db.insert("kingdoms", {
        userId: DEMO_USER_ID,
        name: "Iberia",
        civilization: "romanos",
        createdAt: T0,
        updatedAt: T0,
      });
      await ctx.db.insert("resources", {
        kingdomId: kId,
        gold: 500,
        wood: 500,
        stone: 500,
        iron: 500,
        food: 500,
        lastUpdated: T0,
        settlementInitialized: true,
      });
      return kId;
    });

    for (const demoSub of [DEMO_USER_ID, `${DEMO_USER_ID}|session-99`]) {
      const demoCaller = t.withIdentity(identity(demoSub));
      const status = await demoCaller.query(api.compensation.getOutageCompensationStatus, {});
      expect(status.eligible).toBe(false);
      expect(status.status).toBe("excluded");
      await expect(demoCaller.mutation(api.compensation.claimOutageCompensation, {})).rejects.toThrow(/excluido/i);
      await expect(
        demoCaller.mutation(api.compensation.claimOutageCompensation, { kingdomId: demoKingdomId })
      ).rejects.toThrow(/excluido/i);
    }

    // Recursos de Iberia intactos y 0 registros en outageCompensations
    const demoRes = await getResourcesDoc(t, demoKingdomId);
    expect(demoRes!.gold).toBe(500);
    const records = await t.run(async (ctx) => ctx.db.query("outageCompensations").collect());
    expect(records).toHaveLength(0);

    // Un jugador normal tampoco puede apuntar al reino de Iberia ni al reino de otro jugador
    const realCaller = t.withIdentity(identity("user-real-1"));
    await expect(
      realCaller.mutation(api.compensation.claimOutageCompensation, { kingdomId: demoKingdomId })
    ).rejects.toThrow(/excluido/i);
  });

  test("3. Segunda solicitud consecutiva no concede recursos adicionales", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-second-req"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Segundo");

    const first = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(first.alreadyClaimed).toBe(false);
    const afterFirst = await getResourcesDoc(t, kingdomId);

    const second = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(second.success).toBe(true);
    expect(second.alreadyClaimed).toBe(true);
    expect(second.appliedImmediately).toBe(false);
    expect(second.status).toBe("claimed");

    const afterSecond = await getResourcesDoc(t, kingdomId);
    expect(afterSecond!.gold).toBe(afterFirst!.gold);
    expect(afterSecond!.wood).toBe(afterFirst!.wood);
    expect(afterSecond!.stone).toBe(afterFirst!.stone);
    expect(afterSecond!.iron).toBe(afterFirst!.iron);
    expect(afterSecond!.food).toBe(afterFirst!.food);
  });

  test("4. Solicitudes simultáneas (Promise.all) no duplican la concesión ni crean registros duplicados", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-concurrent"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Concurrente");
    const beforeRes = await getResourcesDoc(t, kingdomId);

    const results = await Promise.all([
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId }),
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId }),
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId }),
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId }),
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId }),
    ]);

    const freshClaims = results.filter((r) => !r.alreadyClaimed);
    const duplicateClaims = results.filter((r) => r.alreadyClaimed);
    expect(freshClaims).toHaveLength(1);
    expect(duplicateClaims).toHaveLength(4);

    const afterRes = await getResourcesDoc(t, kingdomId);
    expect(afterRes!.gold).toBe(beforeRes!.gold + 30_000);
    expect(afterRes!.wood).toBe(beforeRes!.wood + 30_000);
    expect(afterRes!.stone).toBe(beforeRes!.stone + 30_000);
    expect(afterRes!.iron).toBe(beforeRes!.iron + 30_000);
    expect(afterRes!.food).toBe(beforeRes!.food + 30_000);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("outageCompensations")
        .withIndex("by_user", (q) => q.eq("userId", "user-concurrent"))
        .collect()
    );
    expect(rows).toHaveLength(1);
  });

  test("5. Reintento tras fallo o respuesta perdida y recuperación ante estado incompleto sin duplicar", async () => {
    const t = createTestBackend();

    // 5a. Respuesta perdida en red simulada: el cliente descarta la respuesta del primer intento y reintenta
    const asLostUser = t.withIdentity(identity("user-lost-response"));
    const kingdomId = await foundKingdom(t, asLostUser, "Reino Timeout");
    const beforeRes = await getResourcesDoc(t, kingdomId);

    let simulatedTimedOut = false;
    const invokeWithTimeout = async () => {
      const response = await asLostUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
      if (!simulatedTimedOut) {
        simulatedTimedOut = true;
        throw new Error("Simulated client timeout before reading response");
      }
      return response;
    };

    await expect(invokeWithTimeout()).rejects.toThrow(/Simulated client timeout/);
    const retryResponse = await invokeWithTimeout();
    expect(retryResponse.success).toBe(true);
    expect(retryResponse.alreadyClaimed).toBe(true);
    expect(retryResponse.appliedImmediately).toBe(false);

    const afterRetry = await getResourcesDoc(t, kingdomId);
    expect(afterRetry!.gold).toBe(beforeRes!.gold + 30_000);

    // 5b. Reino con estado relacional incompleto (sin fila en tabla resources todavía):
    // claimOutageCompensation reserva "pending" sin fallar y getOrInitializeKingdom la aplica al reparar/inicializar.
    const asBroken = t.withIdentity(identity("user-partial-kingdom"));
    const brokenKingdomId = await t.run(async (ctx) => {
      return await ctx.db.insert("kingdoms", {
        userId: "user-partial-kingdom",
        name: "Reino Incompleto",
        civilization: "griegos",
        createdAt: T0,
        updatedAt: T0,
      });
    });

    const reserveRes = await asBroken.mutation(api.compensation.claimOutageCompensation, {
      kingdomId: brokenKingdomId,
    });
    expect(reserveRes.status).toBe("pending");
    expect(reserveRes.appliedImmediately).toBe(false);

    await asBroken.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino Incompleto",
      civilization: "griegos",
    });
    const repairedRes = await getResourcesDoc(t, brokenKingdomId);
    expect(repairedRes!.gold).toBeGreaterThanOrEqual(30_000);
    expect(repairedRes!.food).toBeGreaterThanOrEqual(30_000);

    // Reintento posterior no duplica
    const afterRepairClaim = await asBroken.mutation(api.compensation.claimOutageCompensation, {
      kingdomId: brokenKingdomId,
    });
    expect(afterRepairClaim.alreadyClaimed).toBe(true);
    const repairedResAgain = await getResourcesDoc(t, brokenKingdomId);
    expect(repairedResAgain!.gold).toBe(repairedRes!.gold);
  });

  test("6. Recarga de sesión conserva el estado reclamado y bloquea nuevas concesiones", async () => {
    const t = createTestBackend();
    const session1 = t.withIdentity(identity("user-reload|tab-1"));
    const kingdomId = await foundKingdom(t, session1, "Reino Recarga");
    const initialRes = await getResourcesDoc(t, kingdomId);

    await session1.mutation(api.compensation.claimOutageCompensation, { kingdomId });

    // Simula recarga de página / nueva instancia de identidad de la misma cuenta
    const reloadedSession = t.withIdentity(identity("user-reload|tab-2-reloaded"));
    const status = await reloadedSession.query(api.compensation.getOutageCompensationStatus, {});
    expect(status.eligible).toBe(false);
    expect(status.status).toBe("claimed");
    expect(status.claimedAt).toBeTypeOf("number");
    expect(status.claimedKingdomId).toBe(String(kingdomId));

    const claimAfterReload = await reloadedSession.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claimAfterReload.alreadyClaimed).toBe(true);
    expect(claimAfterReload.appliedImmediately).toBe(false);

    const resAfterReload = await getResourcesDoc(t, kingdomId);
    expect(resAfterReload!.gold).toBe(initialRes!.gold + 30_000);
  });

  test("7. Dos dispositivos/sesiones reales (Convex Auth signIn) comparten UID canónico y no duplican (tanto tras fundar como pre-fundación)", async () => {
    const t = createTestBackend();

    // Caso A: Dos sesiones reales con reino ya fundado
    const device1 = await signIn(t, "signUp", "Isabel de León", "corona-2026");
    const device2 = await signIn(t, "signIn", "isabel de león", "corona-2026");
    expect(device1.userId).toBe(device2.userId);
    expect(device1.subject).not.toBe(device2.subject);

    const kingdomId = await foundKingdom(t, device1.asUser, "Reino de León");
    const beforeRes = await getResourcesDoc(t, kingdomId);

    const claimDev1 = await device1.asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claimDev1.alreadyClaimed).toBe(false);
    expect(claimDev1.status).toBe("claimed");

    const statusDev2 = await device2.asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(statusDev2.eligible).toBe(false);
    expect(statusDev2.status).toBe("claimed");

    const claimDev2 = await device2.asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claimDev2.alreadyClaimed).toBe(true);
    expect(claimDev2.appliedImmediately).toBe(false);

    const afterRes = await getResourcesDoc(t, kingdomId);
    expect(afterRes!.gold).toBe(beforeRes!.gold + 30_000);

    // Caso B: Dispositivo 1 reserva antes de fundar ("pending") y Dispositivo 2 intenta reclamar / funda
    const mob1 = await signIn(t, "signUp", "Pelayo de Asturias", "covadonga-2026");
    const mob2 = await signIn(t, "signIn", "Pelayo de Asturias", "covadonga-2026");
    expect(mob1.userId).toBe(mob2.userId);

    const pendingDev1 = await mob1.asUser.mutation(api.compensation.claimOutageCompensation, {});
    expect(pendingDev1.status).toBe("pending");
    expect(pendingDev1.alreadyClaimed).toBe(false);

    const pendingDev2 = await mob2.asUser.mutation(api.compensation.claimOutageCompensation, {});
    expect(pendingDev2.status).toBe("pending");
    expect(pendingDev2.alreadyClaimed).toBe(true);

    const asturiasId = await foundKingdom(t, mob2.asUser, "Asturias");
    const asturiasRes = await getResourcesDoc(t, asturiasId);
    expect(asturiasRes!.gold).toBeGreaterThanOrEqual(30_000);
    expect(asturiasRes!.gold).toBeLessThan(60_000);

    const finalMob1 = await mob1.asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(finalMob1.status).toBe("claimed");
    expect(finalMob1.eligible).toBe(false);
  });

  test("8. Registro auditable persistente en outageCompensations guarda todos los metadatos exactos", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-audit-1|session-a"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Auditado");

    await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });

    const records = await t.run(async (ctx) =>
      ctx.db
        .query("outageCompensations")
        .withIndex("by_user", (q) => q.eq("userId", "user-audit-1"))
        .collect()
    );
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.userId).toBe("user-audit-1");
    expect(rec.incidentId).toBe(OUTAGE_COMPENSATION.INCIDENT_ID);
    expect(rec.campaignId).toBe(OUTAGE_COMPENSATION.CAMPAIGN_ID);
    expect(rec.status).toBe("claimed");
    expect(rec.resources).toEqual({
      gold: 30_000,
      wood: 30_000,
      stone: 30_000,
      iron: 30_000,
      food: 30_000,
    });
    expect(rec.claimedKingdomId).toBe(kingdomId);
    expect(rec.createdAt).toBe(T0);
    expect(rec.claimedAt).toBe(T0);
  });

  test("9. Aislamiento entre jugadores: los recursos de otros jugadores no se modifican ni pierden elegibilidad", async () => {
    const t = createTestBackend();
    const userA = t.withIdentity(identity("user-iso-a"));
    const userB = t.withIdentity(identity("user-iso-b"));

    const kingdomA = await foundKingdom(t, userA, "Reino A");
    const kingdomB = await foundKingdom(t, userB, "Reino B");

    const beforeB = await getResourcesDoc(t, kingdomB);
    await userA.mutation(api.compensation.claimOutageCompensation, { kingdomId: kingdomA });

    const afterB = await getResourcesDoc(t, kingdomB);
    expect(afterB!.gold).toBe(beforeB!.gold);
    expect(afterB!.wood).toBe(beforeB!.wood);
    expect(afterB!.stone).toBe(beforeB!.stone);
    expect(afterB!.iron).toBe(beforeB!.iron);
    expect(afterB!.food).toBe(beforeB!.food);

    const statusB = await userB.query(api.compensation.getOutageCompensationStatus, {});
    expect(statusB.eligible).toBe(true);
  });

  test("10. Transacciones económicas normales (spendResource, transactions y liquidación) no se ven alteradas", async () => {
    const t = createTestBackend();
    const userA = t.withIdentity(identity("user-econ-a"));
    const kingdomA = await foundKingdom(t, userA, "Reino Económico");

    await userA.mutation(api.compensation.claimOutageCompensation, { kingdomId: kingdomA });
    const resABeforeSpend = await getResourcesDoc(t, kingdomA);

    const spend1 = await userA.mutation(api.economy.spendResource, {
      kingdomId: kingdomA,
      idempotencyKey: "gasto-normal-1",
      resourceType: "gold",
      amount: 500,
      reason: "Compra de provisiones",
    });
    expect(spend1.idempotentDuplicate).toBe(false);

    const spendDup = await userA.mutation(api.economy.spendResource, {
      kingdomId: kingdomA,
      idempotencyKey: "gasto-normal-1",
      resourceType: "gold",
      amount: 500,
      reason: "Compra de provisiones",
    });
    expect(spendDup.idempotentDuplicate).toBe(true);

    const resAAfterSpend = await getResourcesDoc(t, kingdomA);
    expect(resAAfterSpend!.gold).toBe(resABeforeSpend!.gold - 500);

    const txsA = await t.run(async (ctx) =>
      ctx.db
        .query("transactions")
        .withIndex("by_kingdom_and_key", (q) => q.eq("kingdomId", kingdomA))
        .collect()
    );
    expect(txsA).toHaveLength(1);
    expect(txsA[0].idempotencyKey).toBe("gasto-normal-1");
  });

  test("11. El cliente no puede manipular recursos, cantidades, usuario ni estado", async () => {
    const t = createTestBackend();
    const attacker = t.withIdentity(identity("user-attacker"));
    const victim = t.withIdentity(identity("user-victim"));

    const attackerKingdom = await foundKingdom(t, attacker, "Reino Atacante");
    const victimKingdom = await foundKingdom(t, victim, "Reino Víctima");

    // Intentos de inyectar argumentos no autorizados son rechazados por el validador estricto de Convex
    await expect(
      attacker.mutation(api.compensation.claimOutageCompensation, {
        kingdomId: attackerKingdom,
        resources: { gold: 999_999, wood: 999_999, stone: 999_999, iron: 999_999, food: 999_999 },
      } as any)
    ).rejects.toThrow();

    await expect(
      attacker.mutation(api.compensation.claimOutageCompensation, {
        kingdomId: attackerKingdom,
        amount: 1_000_000,
      } as any)
    ).rejects.toThrow();

    await expect(
      attacker.mutation(api.compensation.claimOutageCompensation, {
        userId: "user-victim",
      } as any)
    ).rejects.toThrow();

    await expect(
      attacker.mutation(api.compensation.claimOutageCompensation, {
        campaignId: "outage_2026_general_v99",
        status: "unclaimed",
      } as any)
    ).rejects.toThrow();

    // Intentar reclamar sobre el reino de otro usuario es rechazado
    await expect(
      attacker.mutation(api.compensation.claimOutageCompensation, {
        kingdomId: victimKingdom,
      })
    ).rejects.toThrow(/no autorizado/i);
  });

  test("12. Quien ya recibió compensación no puede volver a recibirla por otra vía (sin kingdomId, hook de fundación, resetKingdom o cambio de nombre/versión de campaña)", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-all-paths"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Principal");

    // Reclama llamando SIN kingdomId (el servidor resuelve su reino fundado)
    const initial = await asUser.mutation(api.compensation.claimOutageCompensation, {});
    expect(initial.alreadyClaimed).toBe(false);
    expect(initial.appliedImmediately).toBe(true);
    expect(initial.claimedKingdomId).toBe(kingdomId);

    const afterInitial = await getResourcesDoc(t, kingdomId);

    // 12a. Volver a llamar CON kingdomId -> bloqueado
    const withId = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(withId.alreadyClaimed).toBe(true);
    expect(withId.appliedImmediately).toBe(false);

    // 12b. Invocar directamente applyPendingOutageCompensationOnFounding -> devuelve false sin modificar recursos
    const hookApplied = await t.run(async (ctx) => {
      const resDoc = await ctx.db
        .query("resources")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .first();
      return await applyPendingOutageCompensationOnFounding(
        ctx,
        "user-all-paths|otra-sesion",
        kingdomId,
        resDoc!._id,
        T0 + 5000
      );
    });
    expect(hookApplied).toBe(false);
    expect((await getResourcesDoc(t, kingdomId))!.gold).toBe(afterInitial!.gold);

    // 12c. Reiniciar reino y refundar -> NO vuelve a conceder
    await asUser.mutation(api.economy.resetKingdom, { kingdomId });
    await asUser.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino Refundado",
      civilization: "vikingos",
    });
    const afterRefound = await getResourcesDoc(t, kingdomId);
    expect(afterRefound!.gold).toBeLessThan(10_000);
    const afterRefoundClaim = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(afterRefoundClaim.alreadyClaimed).toBe(true);

    // 12d. Cambio de versión o nombre de campaña para el mismo incidente NO reactiva la compensación:
    // Simula un registro previo guardado con otro campaignId/versión pero mismo incidentId (o prefijo heredado sin incidentId)
    const renamedCampUser = t.withIdentity(identity("user-renamed-campaign"));
    const renamedKingdom = await foundKingdom(t, renamedCampUser, "Reino Campaña");
    const beforeRenamed = await getResourcesDoc(t, renamedKingdom);

    await t.run(async (ctx) => {
      await ctx.db.insert("outageCompensations", {
        userId: "user-renamed-campaign",
        incidentId: OUTAGE_COMPENSATION.INCIDENT_ID,
        campaignId: "campana_nombre_renombrado_v99",
        status: "claimed",
        resources: OUTAGE_COMPENSATION.RESOURCES,
        claimedKingdomId: renamedKingdom,
        createdAt: T0 - 100_000,
        claimedAt: T0 - 100_000,
      });
    });

    const renamedStatus = await renamedCampUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(renamedStatus.eligible).toBe(false);
    expect(renamedStatus.status).toBe("claimed");

    const renamedAttempt = await renamedCampUser.mutation(api.compensation.claimOutageCompensation, {
      kingdomId: renamedKingdom,
    });
    expect(renamedAttempt.alreadyClaimed).toBe(true);
    expect((await getResourcesDoc(t, renamedKingdom))!.gold).toBe(beforeRenamed!.gold);

    // También bloquea si un registro heredado carece de incidentId pero su campaignId pertenece al incidente ("outage_2026_general_v0")
    const legacyNoIncidentUser = t.withIdentity(identity("user-legacy-no-incident"));
    const legacyKingdom = await foundKingdom(t, legacyNoIncidentUser, "Reino Legacy");
    await t.run(async (ctx) => {
      await ctx.db.insert("outageCompensations", {
        userId: "user-legacy-no-incident",
        campaignId: `${OUTAGE_COMPENSATION.INCIDENT_ID}_v0`,
        status: "claimed",
        resources: OUTAGE_COMPENSATION.RESOURCES,
        claimedKingdomId: legacyKingdom,
        createdAt: T0 - 200_000,
        claimedAt: T0 - 200_000,
      });
    });
    const legacyStatus = await legacyNoIncidentUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(legacyStatus.eligible).toBe(false);
    expect(legacyStatus.status).toBe("claimed");
    const legacyAttempt = await legacyNoIncidentUser.mutation(api.compensation.claimOutageCompensation, {
      kingdomId: legacyKingdom,
    });
    expect(legacyAttempt.alreadyClaimed).toBe(true);
  });
});
