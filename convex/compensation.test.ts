/**
 * LA CONQUISTA — LAS 17 PRUEBAS OBLIGATORIAS DEL PUNTO 6:
 * REGALO ÚNICO POR CAÍDA DEL SERVIDOR (+30.000 × 5 CON CAPACIDAD DE ALMACÉN).
 *
 * Utiliza el backend real de Convex (convex-test) y las reglas reales de almacenamiento
 * (storageCapacity = floor((10.000 + 2.000 * nivelMercado) * multTecnología * multCivilización)).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { createTestBackend } from "./test.setup";
import { OUTAGE_COMPENSATION, STORAGE } from "./balanceConfig";
import { DEMO_USER_ID } from "./kingdomAccess";
import { storageCapacity } from "./economyExtended";
import * as economyAdapter from "./economyAdapter";
import * as economy from "./economy";

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

async function foundKingdom(
  t: Backend,
  asUser: ReturnType<Backend["withIdentity"]>,
  name: string,
  civilization: string = "romanos"
) {
  const kingdom = await asUser.mutation(api.economy.getOrInitializeKingdom, {
    name,
    civilization,
    castleName: `Castillo de ${name}`,
    monarchName: `Monarca de ${name}`,
  });
  return kingdom._id as any;
}

async function setBuildingLevel(t: Backend, kingdomId: any, buildingType: string, level: number) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("buildings")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .collect();
    const doc = existing.find((b) => b.buildingType === buildingType);
    if (doc) await ctx.db.patch(doc._id, { level });
    else await ctx.db.insert("buildings", { kingdomId, buildingType, level });
  });
}

async function setResources(
  t: Backend,
  kingdomId: any,
  values: { gold: number; wood: number; stone: number; iron: number; food: number }
) {
  await t.run(async (ctx) => {
    const doc = await ctx.db
      .query("resources")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .first();
    if (!doc) throw new Error("No resources doc found");
    await ctx.db.patch(doc._id, { ...values, lastUpdated: T0, settlementInitialized: true });
  });
}

async function getResourcesDoc(t: Backend, kingdomId: any) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("resources")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .first();
  });
}

function getConvexErrorMessage(err: unknown): string {
  const data = (err as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return err instanceof Error ? err.message : String(err);
}

async function assertSingleResourceRejected(
  key: "gold" | "wood" | "stone" | "iron" | "food",
  label: string,
  stored: number,
  expectedNeeded: number
) {
  const t = createTestBackend();
  const userId = `user-p6-single-${key}`;
  const asUser = t.withIdentity(identity(userId));
  const kingdomId = await foundKingdom(t, asUser, `Reino ${label}`);

  // Mercado 11 => tope = 32.000
  await setBuildingLevel(t, kingdomId, "mercado", 11);
  const initial = { gold: 0, wood: 0, stone: 0, iron: 0, food: 0 };
  initial[key] = stored;
  await setResources(t, kingdomId, initial);

  const status = await asUser.query(api.compensation.getOutageCompensationStatus, {});
  expect(status.canClaim).toBe(false);
  expect(status.capacityReport?.allSufficient).toBe(false);
  expect(status.capacityReport?.insufficientResources).toHaveLength(1);
  expect(status.capacityReport?.insufficientResources[0].resource).toBe(key);
  expect(status.capacityReport?.insufficientResources[0].additionalNeeded).toBe(expectedNeeded);

  let caught: unknown = null;
  try {
    await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
  } catch (err) {
    caught = err;
  }
  expect(caught).not.toBeNull();
  const msg = getConvexErrorMessage(caught);
  expect(msg).toContain(label);
  expect(msg).toContain(String(expectedNeeded));

  // Ningún recurso fue acreditado y no se registró compensación
  const after = await getResourcesDoc(t, kingdomId);
  expect(after!.gold).toBe(initial.gold);
  expect(after!.wood).toBe(initial.wood);
  expect(after!.stone).toBe(initial.stone);
  expect(after!.iron).toBe(initial.iron);
  expect(after!.food).toBe(initial.food);

  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("outageCompensations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
  );
  expect(rows).toHaveLength(0);
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

describe("Punto 6: Regalo único de +30.000 × 5 con comprobación obligatoria y atómica de capacidad", () => {
  test("1. Jugador válido con capacidad suficiente cobra exactamente 30.000 de los cinco recursos (con liquidación económica previa)", async () => {
    const t = createTestBackend();
    // Vikingos (+10 %) + storage_1 (+10 %) + Mercado 8 => storageCapacity(8, 1.21) = 31.460
    const asUser = t.withIdentity(identity("user-p6-1"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Completo", "vikingos");

    await setBuildingLevel(t, kingdomId, "mercado", 8);
    await t.run(async (ctx) => {
      await ctx.db.insert("technologyProgress", {
        kingdomId,
        technologyId: "storage_1",
        status: "completed",
        startedAt: T0 - 10_000,
        durationMs: 5_000,
        completedAt: T0 - 5_000,
      });
    });
    await setResources(t, kingdomId, { gold: 1_000, wood: 1_000, stone: 1_000, iron: 1_000, food: 1_000 });

    // Avanzamos 5 minutos para comprobar que primero se liquida la economía pendiente
    vi.setSystemTime(T0 + 300_000);

    const statusBefore = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(statusBefore.authenticated).toBe(true);
    expect(statusBefore.eligible).toBe(true);
    expect(statusBefore.canClaim).toBe(true);
    expect(statusBefore.capacityReport?.maxCapacity).toBe(storageCapacity(8, 1.1 * 1.1));
    expect(statusBefore.capacityReport?.maxCapacity).toBe(31_460);
    expect(statusBefore.capacityReport?.allSufficient).toBe(true);

    const claim = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claim.success).toBe(true);
    expect(claim.alreadyClaimed).toBe(false);
    expect(claim.status).toBe("claimed");
    expect(claim.appliedImmediately).toBe(true);
    expect(claim.resources).toEqual(OUTAGE_COMPENSATION.RESOURCES);

    const after = await getResourcesDoc(t, kingdomId);
    // La economía se liquidó primero (lastUpdated == T0 + 300_000) y se sumaron los +30.000 exactos
    expect(after!.lastUpdated).toBe(T0 + 300_000);
    expect(after!.gold).toBeGreaterThanOrEqual(31_000);
    expect(after!.wood).toBeGreaterThanOrEqual(31_000);
    expect(after!.stone).toBeGreaterThanOrEqual(31_000);
    expect(after!.iron).toBeGreaterThanOrEqual(31_000);
    expect(after!.food).toBeGreaterThanOrEqual(31_000);

    // También comprobamos suma exacta sin producción adicional cuando el reloj no avanza
    const asExact = t.withIdentity(identity("user-p6-1-exact"));
    const kExact = await foundKingdom(t, asExact, "Reino Exacto");
    await setBuildingLevel(t, kExact, "mercado", 14); // tope 38.000 >= 6.000 + 30.000
    const beforeExact = await getResourcesDoc(t, kExact);
    await asExact.mutation(api.compensation.claimOutageCompensation, { kingdomId: kExact });
    const afterExact = await getResourcesDoc(t, kExact);
    expect(afterExact!.gold).toBe(beforeExact!.gold + 30_000);
    expect(afterExact!.wood).toBe(beforeExact!.wood + 30_000);
    expect(afterExact!.stone).toBe(beforeExact!.stone + 30_000);
    expect(afterExact!.iron).toBe(beforeExact!.iron + 30_000);
    expect(afterExact!.food).toBe(beforeExact!.food + 30_000);

    const records = await t.run(async (ctx) =>
      ctx.db
        .query("outageCompensations")
        .withIndex("by_user", (q) => q.eq("userId", "user-p6-1"))
        .collect()
    );
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("claimed");
    expect(records[0].incidentId).toBe(OUTAGE_COMPENSATION.INCIDENT_ID);
    expect(records[0].campaignId).toBe(OUTAGE_COMPENSATION.CAMPAIGN_ID);
    expect(records[0].claimedKingdomId).toBe(kingdomId);
  });

  test("2. Capacidad insuficiente para oro -> no recibe ningún recurso", async () => {
    await assertSingleResourceRejected("gold", "oro", 5_000, 3_000);
  });

  test("3. Capacidad insuficiente para madera -> no recibe ningún recurso", async () => {
    await assertSingleResourceRejected("wood", "madera", 4_500, 2_500);
  });

  test("4. Capacidad insuficiente para piedra -> no recibe ningún recurso", async () => {
    await assertSingleResourceRejected("stone", "piedra", 3_000, 1_000);
  });

  test("5. Capacidad insuficiente para hierro -> no recibe ningún recurso", async () => {
    await assertSingleResourceRejected("iron", "hierro", 2_001, 1);
  });

  test("6. Capacidad insuficiente para comida -> no recibe ningún recurso", async () => {
    await assertSingleResourceRejected("food", "comida", 10_000, 8_000);
  });

  test("7. Varios recursos sin espacio -> identifica todos y no entrega ninguno", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-multi"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Múltiple");

    // Mercado 10 => tope = 30.000
    await setBuildingLevel(t, kingdomId, "mercado", 10);
    await setResources(t, kingdomId, {
      gold: 4_000,  // falta 4.000
      wood: 0,      // suficiente
      stone: 1_500, // falta 1.500
      iron: 0,      // suficiente
      food: 9_000,  // falta 9.000
    });

    const status = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(status.canClaim).toBe(false);
    expect(status.capacityReport?.insufficientResources.map((r) => r.resource)).toEqual([
      "gold",
      "stone",
      "food",
    ]);
    expect(status.capacityReport?.resources.gold.additionalNeeded).toBe(4_000);
    expect(status.capacityReport?.resources.wood.additionalNeeded).toBe(0);
    expect(status.capacityReport?.resources.stone.additionalNeeded).toBe(1_500);
    expect(status.capacityReport?.resources.iron.additionalNeeded).toBe(0);
    expect(status.capacityReport?.resources.food.additionalNeeded).toBe(9_000);

    let caught: unknown = null;
    try {
      await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const msg = getConvexErrorMessage(caught);
    expect(msg).toContain("oro");
    expect(msg).toContain("4000");
    expect(msg).toContain("piedra");
    expect(msg).toContain("1500");
    expect(msg).toContain("comida");
    expect(msg).toContain("9000");
    expect(msg).not.toContain("madera");
    expect(msg).not.toContain("hierro");

    const after = await getResourcesDoc(t, kingdomId);
    expect(after!.gold).toBe(4_000);
    expect(after!.wood).toBe(0);
    expect(after!.stone).toBe(1_500);
    expect(after!.iron).toBe(0);
    expect(after!.food).toBe(9_000);
  });

  test("8. Tras liberar espacio suficiente (gasto o ampliación de Mercado), el jugador puede cobrar", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-free-space"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Ampliado");

    // Inicial: Mercado 10 (tope 30.000), oro 2.500 => falta espacio para oro
    await setBuildingLevel(t, kingdomId, "mercado", 10);
    await setResources(t, kingdomId, { gold: 2_500, wood: 0, stone: 0, iron: 0, food: 0 });

    await expect(
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId })
    ).rejects.toThrow(/oro/i);

    // Gasta 2.500 de oro con spendResource real -> ahora oro = 0, disponible = 30.000 >= 30.000
    await asUser.mutation(api.economy.spendResource, {
      kingdomId,
      idempotencyKey: "liberar-oro-1",
      resourceType: "gold",
      amount: 2_500,
      reason: "Liberar espacio en almacén",
    });

    const statusReady = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(statusReady.canClaim).toBe(true);

    const claim = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claim.status).toBe("claimed");
    expect(claim.appliedImmediately).toBe(true);

    const after = await getResourcesDoc(t, kingdomId);
    expect(after!.gold).toBe(30_000);
    expect(after!.wood).toBe(30_000);
    expect(after!.stone).toBe(30_000);
    expect(after!.iron).toBe(30_000);
    expect(after!.food).toBe(30_000);

    // También funciona ampliando el Mercado (inicialmente Mercado = 0, sin fila)
    const asUser2 = t.withIdentity(identity("user-p6-upgrade-market"));
    const kingdomId2 = await foundKingdom(t, asUser2, "Reino Mercado");
    await expect(
      asUser2.mutation(api.compensation.claimOutageCompensation, { kingdomId: kingdomId2 })
    ).rejects.toThrow(/capacidad de almacenamiento insuficiente/i);

    await setBuildingLevel(t, kingdomId2, "mercado", 14); // tope 38.000
    const claim2 = await asUser2.mutation(api.compensation.claimOutageCompensation, {
      kingdomId: kingdomId2,
    });
    expect(claim2.status).toBe("claimed");
    const after2 = await getResourcesDoc(t, kingdomId2);
    expect(after2!.gold).toBeGreaterThanOrEqual(30_000);
    expect(after2!.gold).toBeLessThanOrEqual(STORAGE.BASE_CAPACITY + 14 * STORAGE.CAPACITY_PER_MARKET_LEVEL);
  });

  test("9. Fundar un reino no entrega la compensación", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-founding"));

    // Antes de fundar, existe incluso un registro heredado "pending": tampoco debe auto-aplicarse al fundar
    await t.run(async (ctx) => {
      await ctx.db.insert("outageCompensations", {
        userId: "user-p6-founding",
        incidentId: OUTAGE_COMPENSATION.INCIDENT_ID,
        campaignId: OUTAGE_COMPENSATION.CAMPAIGN_ID,
        status: "pending",
        resources: OUTAGE_COMPENSATION.RESOURCES,
        createdAt: T0 - 10_000,
      });
    });

    const kingdomId = await foundKingdom(t, asUser, "Reino Recién Fundado");
    const resourcesAfterFounding = await getResourcesDoc(t, kingdomId);
    expect(resourcesAfterFounding!.gold).toBe(6_000);
    expect(resourcesAfterFounding!.wood).toBe(6_000);
    expect(resourcesAfterFounding!.stone).toBe(6_000);
    expect(resourcesAfterFounding!.iron).toBe(6_000);
    expect(resourcesAfterFounding!.food).toBe(6_000);

    const status = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(status.status).toBe("unclaimed");
    expect(status.eligible).toBe(true);

    // Al ampliar Mercado y pulsar «Recibir regalo único» sí cobra una única vez
    await setBuildingLevel(t, kingdomId, "mercado", 14);
    const claim = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claim.status).toBe("claimed");
    expect((await getResourcesDoc(t, kingdomId))!.gold).toBe(36_000);
  });

  test("10. Inicializar un reino existente no entrega la compensación", async () => {
    const t = createTestBackend();
    const userId = "user-p6-init-existing";
    const asUser = t.withIdentity(identity(userId));

    // Creamos un reino existente sin fila de resources (estado previo pendiente de inicialización)
    // y una reserva "pending" heredada para garantizar que inicializar nunca autocobra.
    const existingKingdomId = await t.run(async (ctx) => {
      const kId = await ctx.db.insert("kingdoms", {
        userId,
        name: "Reino Preexistente",
        civilization: "romanos",
        castleName: "Castillo Previo",
        monarchName: "Monarca Previo",
      });
      await ctx.db.insert("outageCompensations", {
        userId,
        incidentId: OUTAGE_COMPENSATION.INCIDENT_ID,
        campaignId: OUTAGE_COMPENSATION.CAMPAIGN_ID,
        status: "pending",
        resources: OUTAGE_COMPENSATION.RESOURCES,
        createdAt: T0 - 5_000,
      });
      return kId;
    });

    await asUser.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino Preexistente",
      civilization: "romanos",
    });

    // Segunda llamada de inicialización + sync tras avanzar el tiempo tampoco otorgan el regalo
    vi.setSystemTime(T0 + 60_000);
    await asUser.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino Preexistente",
      civilization: "romanos",
    });
    await asUser.mutation(api.economy.syncKingdom, { kingdomId: existingKingdomId });

    const resAfterInit = await getResourcesDoc(t, existingKingdomId);
    expect(resAfterInit!.gold).toBeLessThan(10_000);
    expect(resAfterInit!.wood).toBeLessThan(10_000);
    expect(resAfterInit!.stone).toBeLessThan(10_000);
    expect(resAfterInit!.iron).toBeLessThan(10_000);
    expect(resAfterInit!.food).toBeLessThan(10_000);

    const status = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(status.status).toBe("unclaimed");
    expect(status.eligible).toBe(true);
  });

  test("11. Dos solicitudes simultáneas no duplican la compensación", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-concurrent"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Concurrente");
    await setBuildingLevel(t, kingdomId, "mercado", 15); // tope 40.000
    const before = await getResourcesDoc(t, kingdomId);

    const results = await Promise.all([
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId }),
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId }),
    ]);

    const fresh = results.filter((r) => !r.alreadyClaimed);
    const dups = results.filter((r) => r.alreadyClaimed);
    expect(fresh).toHaveLength(1);
    expect(dups).toHaveLength(1);

    const after = await getResourcesDoc(t, kingdomId);
    expect(after!.gold).toBe(before!.gold + 30_000);
    expect(after!.wood).toBe(before!.wood + 30_000);
    expect(after!.stone).toBe(before!.stone + 30_000);
    expect(after!.iron).toBe(before!.iron + 30_000);
    expect(after!.food).toBe(before!.food + 30_000);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("outageCompensations")
        .withIndex("by_user", (q) => q.eq("userId", "user-p6-concurrent"))
        .collect()
    );
    expect(rows).toHaveLength(1);
  });

  test("12. Reintentar una solicitud después de perder la respuesta no duplica la compensación", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-timeout"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Timeout");

    // Mercado 13 (tope 36.000) con 6.000 iniciales: tras el primer cobro quedan 0 libres (< 30.000),
    // pero el reintento responde idempotentemente sin duplicar ni fallar falsamente.
    await setBuildingLevel(t, kingdomId, "mercado", 13);
    const before = await getResourcesDoc(t, kingdomId);

    let droppedOnce = false;
    const callWithLostResponse = async () => {
      const res = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
      if (!droppedOnce) {
        droppedOnce = true;
        throw new Error("Simulated lost network response");
      }
      return res;
    };

    await expect(callWithLostResponse()).rejects.toThrow(/Simulated lost network response/);
    const retry = await callWithLostResponse();
    expect(retry.success).toBe(true);
    expect(retry.alreadyClaimed).toBe(true);
    expect(retry.appliedImmediately).toBe(false);

    const after = await getResourcesDoc(t, kingdomId);
    expect(after!.gold).toBe(before!.gold + 30_000);
    expect(after!.food).toBe(before!.food + 30_000);
  });

  test("13. Una cuenta que ya cobró no puede volver a cobrar (incluye cambio de nombre/versión de campaña)", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-already"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Ya Cobrado");
    await setBuildingLevel(t, kingdomId, "mercado", 20); // tope 50.000 -> incluso tras +30.000 queda espacio

    const first = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(first.alreadyClaimed).toBe(false);
    const afterFirst = await getResourcesDoc(t, kingdomId);

    // Segundo intento con o sin kingdomId
    const second = await asUser.mutation(api.compensation.claimOutageCompensation, {});
    expect(second.alreadyClaimed).toBe(true);
    expect(second.appliedImmediately).toBe(false);
    expect((await getResourcesDoc(t, kingdomId))!.gold).toBe(afterFirst!.gold);

    // Simula cambio de nombre o versión de campaña para el mismo incidente
    const renamedUser = t.withIdentity(identity("user-p6-renamed"));
    const renamedKingdom = await foundKingdom(t, renamedUser, "Reino Campaña");
    await setBuildingLevel(t, renamedKingdom, "mercado", 20);
    const beforeRenamed = await getResourcesDoc(t, renamedKingdom);

    await t.run(async (ctx) => {
      await ctx.db.insert("outageCompensations", {
        userId: "user-p6-renamed",
        incidentId: OUTAGE_COMPENSATION.INCIDENT_ID,
        campaignId: "campana_renombrada_v99",
        status: "claimed",
        resources: OUTAGE_COMPENSATION.RESOURCES,
        claimedKingdomId: renamedKingdom,
        createdAt: T0 - 50_000,
        claimedAt: T0 - 50_000,
      });
    });

    const renamedStatus = await renamedUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(renamedStatus.eligible).toBe(false);
    expect(renamedStatus.canClaim).toBe(false);
    expect(renamedStatus.status).toBe("claimed");

    const attempt = await renamedUser.mutation(api.compensation.claimOutageCompensation, {
      kingdomId: renamedKingdom,
    });
    expect(attempt.alreadyClaimed).toBe(true);
    expect((await getResourcesDoc(t, renamedKingdom))!.gold).toBe(beforeRenamed!.gold);
  });

  test("14. Reiniciar el reino no permite volver a recibir el regalo", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-reset"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Reiniciable");
    await setBuildingLevel(t, kingdomId, "mercado", 14);

    const claim = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claim.status).toBe("claimed");

    await asUser.mutation(api.economy.resetKingdom, { kingdomId });
    await asUser.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino Segundo",
      civilization: "griegos",
    });
    await setBuildingLevel(t, kingdomId, "mercado", 14);

    const statusAfterReset = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(statusAfterReset.eligible).toBe(false);
    expect(statusAfterReset.canClaim).toBe(false);
    expect(statusAfterReset.status).toBe("claimed");

    const beforeRetry = await getResourcesDoc(t, kingdomId);
    const retryAfterReset = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(retryAfterReset.alreadyClaimed).toBe(true);
    expect(retryAfterReset.appliedImmediately).toBe(false);
    expect((await getResourcesDoc(t, kingdomId))!.gold).toBe(beforeRetry!.gold);
  });

  test("15. Dos sesiones o dispositivos de la misma cuenta comparten el mismo estado", async () => {
    const t = createTestBackend();
    const dev1 = await signIn(t, "signUp", "Fernán González", "castilla-2026");
    const dev2 = await signIn(t, "signIn", "fernán gonzález", "castilla-2026");
    expect(dev1.userId).toBe(dev2.userId);
    expect(dev1.subject).not.toBe(dev2.subject);

    const kingdomId = await foundKingdom(t, dev1.asUser, "Condado de Castilla");

    // En dispositivo 1 y 2 se ve la misma falta de capacidad (Mercado 0 => tope 10.000)
    const s1Low = await dev1.asUser.query(api.compensation.getOutageCompensationStatus, {});
    const s2Low = await dev2.asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(s1Low.canClaim).toBe(false);
    expect(s2Low.canClaim).toBe(false);

    // Tras ampliar Mercado a 14, ambos reflejan canClaim = true; cobra en dispositivo 1
    await setBuildingLevel(t, kingdomId, "mercado", 14);
    const s2Ready = await dev2.asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(s2Ready.canClaim).toBe(true);

    const before = await getResourcesDoc(t, kingdomId);
    const claimDev1 = await dev1.asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claimDev1.alreadyClaimed).toBe(false);
    expect(claimDev1.status).toBe("claimed");

    // Dispositivo 2 ve inmediatamente el estado ya cobrado y no puede duplicar
    const s2After = await dev2.asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(s2After.eligible).toBe(false);
    expect(s2After.canClaim).toBe(false);
    expect(s2After.status).toBe("claimed");

    const claimDev2 = await dev2.asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claimDev2.alreadyClaimed).toBe(true);
    expect(claimDev2.appliedImmediately).toBe(false);

    const after = await getResourcesDoc(t, kingdomId);
    expect(after!.gold).toBe(before!.gold + 30_000);
  });

  test("16. Un cliente no puede modificar cantidades, estado ni suplantar identidades", async () => {
    const t = createTestBackend();
    const attacker = t.withIdentity(identity("user-p6-attacker"));
    const victim = t.withIdentity(identity("user-p6-victim"));

    const attackerKingdom = await foundKingdom(t, attacker, "Reino Atacante");
    const victimKingdom = await foundKingdom(t, victim, "Reino Víctima");
    await setBuildingLevel(t, attackerKingdom, "mercado", 15);
    await setBuildingLevel(t, victimKingdom, "mercado", 15);

    // Argumentos extra rechazados por el validador estricto de Convex
    await expect(
      attacker.mutation(api.compensation.claimOutageCompensation, {
        kingdomId: attackerKingdom,
        resources: { gold: 999_999, wood: 999_999, stone: 999_999, iron: 999_999, food: 999_999 },
      } as any)
    ).rejects.toThrow();

    await expect(
      attacker.mutation(api.compensation.claimOutageCompensation, {
        kingdomId: attackerKingdom,
        bypassCapacityCheck: true,
      } as any)
    ).rejects.toThrow();

    await expect(
      attacker.mutation(api.compensation.claimOutageCompensation, {
        userId: "user-p6-victim",
      } as any)
    ).rejects.toThrow();

    await expect(
      attacker.mutation(api.compensation.claimOutageCompensation, {
        kingdomId: victimKingdom,
      })
    ).rejects.toThrow(/no autorizado/i);

    // Invitados sin sesión y demo Iberia excluidos
    await expect(t.mutation(api.compensation.claimOutageCompensation, {})).rejects.toThrow(/iniciar sesión/i);
    const demoCaller = t.withIdentity(identity(DEMO_USER_ID));
    const demoStatus = await demoCaller.query(api.compensation.getOutageCompensationStatus, {});
    expect(demoStatus.status).toBe("excluded");
    expect(demoStatus.canClaim).toBe(false);
    await expect(demoCaller.mutation(api.compensation.claimOutageCompensation, {})).rejects.toThrow(/excluido/i);
  });

  test("17. Las cantidades de recursos anteriores a una reclamación fallida permanecen intactas", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-atomic-rollback"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Rollback");

    // Mercado 11 (tope 32.000): 4 recursos con espacio suficiente y 1 recurso (comida) sin espacio.
    // Con tiempo anterior, settleRelationalKingdomEconomy intentaría actualizar recursos antes del fallo;
    // al lanzar ConvexError la transacción revierte completamente todos los saldos y lastUpdated.
    await setBuildingLevel(t, kingdomId, "mercado", 11);
    const customTime = T0 - 3_600_000;
    await t.run(async (ctx) => {
      const doc = await ctx.db
        .query("resources")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .first();
      await ctx.db.patch(doc!._id, {
        gold: 1_000,
        wood: 1_200,
        stone: 800,
        iron: 400,
        food: 5_000, // disponible = 27.000 < 30.000
        lastUpdated: customTime,
        settlementInitialized: true,
      });
    });

    const snapshotBefore = await getResourcesDoc(t, kingdomId);

    await expect(
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId })
    ).rejects.toThrow(/comida/i);

    const snapshotAfter = await getResourcesDoc(t, kingdomId);
    expect(snapshotAfter!.gold).toBe(snapshotBefore!.gold);
    expect(snapshotAfter!.wood).toBe(snapshotBefore!.wood);
    expect(snapshotAfter!.stone).toBe(snapshotBefore!.stone);
    expect(snapshotAfter!.iron).toBe(snapshotBefore!.iron);
    expect(snapshotAfter!.food).toBe(snapshotBefore!.food);
    expect(snapshotAfter!.lastUpdated).toBe(snapshotBefore!.lastUpdated);

    const records = await t.run(async (ctx) =>
      ctx.db
        .query("outageCompensations")
        .withIndex("by_user", (q) => q.eq("userId", "user-p6-atomic-rollback"))
        .collect()
    );
    expect(records).toHaveLength(0);
  });

  test("18. La consulta de estado refleja la economía liquidada y obras/tecnologías vencidas igual que la mutación", async () => {
    const t = createTestBackend();
    // Vikingos (+10 % capacidad) con Mercado 7 en BD + mejora vencida a Mercado 8 en cola
    // y tecnología storage_1 vencida en cola => storageCapacity(8, 1.1 * 1.1) = 31.460
    const asUser = t.withIdentity(identity("user-p6-query-parity"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Coherente", "vikingos");
    await setBuildingLevel(t, kingdomId, "mercado", 7);
    await setResources(t, kingdomId, { gold: 1_000, wood: 1_000, stone: 1_000, iron: 1_000, food: 1_000 });

    await t.run(async (ctx) => {
      await ctx.db.insert("constructionQueue", {
        kingdomId,
        buildingType: "mercado",
        targetLevel: 8,
        startedAt: T0 - 20_000,
        durationMs: 10_000,
        costs: { gold: 100 },
      });
      await ctx.db.insert("technologyProgress", {
        kingdomId,
        technologyId: "storage_1",
        status: "researching",
        startedAt: T0 - 20_000,
        durationMs: 10_000,
        costs: { gold: 100 },
      });
    });

    // Avanzamos el reloj 1 hora SIN llamar a syncKingdom antes: la consulta debe proyectar
    // la producción/impuestos/consumo + Mercado 8 + storage_1 + bonus vikingo de forma exacta.
    vi.setSystemTime(T0 + 3_600_000);

    const status = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    const expectedCap = storageCapacity(8, 1.1 * 1.1);
    expect(expectedCap).toBe(31_460);
    expect(status.capacityReport?.maxCapacity).toBe(expectedCap);
    expect(status.canClaim).toBe(true);
    // Los recursos proyectados deben haber avanzado desde 1.000 por producción/impuestos
    expect(status.capacityReport!.resources.gold.current).toBeGreaterThan(1_000);
    expect(status.capacityReport!.resources.wood.current).toBeGreaterThan(1_000);

    const projectedBeforeClaim = status.capacityReport!.resources;
    const claim = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claim.status).toBe("claimed");
    expect(claim.maxCapacity).toBe(expectedCap);

    // El saldo resultante en BD coincide exactamente con lo proyectado por la consulta + 30.000
    const after = await getResourcesDoc(t, kingdomId);
    expect(after!.gold).toBeCloseTo(projectedBeforeClaim.gold.current + 30_000, 6);
    expect(after!.wood).toBeCloseTo(projectedBeforeClaim.wood.current + 30_000, 6);
    expect(after!.stone).toBeCloseTo(projectedBeforeClaim.stone.current + 30_000, 6);
    expect(after!.iron).toBeCloseTo(projectedBeforeClaim.iron.current + 30_000, 6);
    expect(after!.food).toBeCloseTo(projectedBeforeClaim.food.current + 30_000, 6);
  });

  test("19. Si la capacidad efectiva cambia entre la consulta y el clic, el backend rechaza el cobro íntegramente", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-drift-reject"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Deriva");

    // Mercado 13 => tope 36.000. En T0 oro = 5.995 -> disponible = 30.005 >= 30.000 -> canClaim = true.
    await setBuildingLevel(t, kingdomId, "mercado", 13);
    await setResources(t, kingdomId, { gold: 5_995, wood: 1_000, stone: 1_000, iron: 1_000, food: 1_000 });

    const statusAtT0 = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(statusAtT0.canClaim).toBe(true);
    expect(statusAtT0.capacityReport?.maxCapacity).toBe(36_000);

    // Pasa 1 hora sin actualizar en cliente: la recaudación/producción eleva el oro por encima de 6.000
    vi.setSystemTime(T0 + 3_600_000);
    const snapshotBeforeClick = await getResourcesDoc(t, kingdomId);

    // La mutación reevalúa con la economía liquidada al instante del clic y rechaza atómicamente
    await expect(
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId })
    ).rejects.toThrow(/oro/i);

    const afterRejected = await getResourcesDoc(t, kingdomId);
    expect(afterRejected!.gold).toBe(snapshotBeforeClick!.gold);
    expect(afterRejected!.wood).toBe(snapshotBeforeClick!.wood);
    expect(afterRejected!.food).toBe(snapshotBeforeClick!.food);
    expect(afterRejected!.lastUpdated).toBe(T0);

    const records = await t.run(async (ctx) =>
      ctx.db
        .query("outageCompensations")
        .withIndex("by_user", (q) => q.eq("userId", "user-p6-drift-reject"))
        .collect()
    );
    expect(records).toHaveLength(0);
  });

  test("20. Coherencia en el umbral exacto de capacidad disponible (30.000 aceptado vs 29.999 rechazado)", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-boundary"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Umbral");

    // Mercado 13 => tope exacto 36.000
    await setBuildingLevel(t, kingdomId, "mercado", 13);
    await setResources(t, kingdomId, { gold: 6_000.5, wood: 6_000, stone: 6_000, iron: 6_000, food: 6_000 });

    const lowStatus = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(lowStatus.canClaim).toBe(false);
    expect(lowStatus.capacityReport?.insufficientResources.map((r) => r.resource)).toEqual(["gold"]);
    expect(lowStatus.capacityReport?.resources.gold.additionalNeeded).toBe(1);

    await expect(
      asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId })
    ).rejects.toThrow(/oro/i);

    // Bajamos exactamente a 6.000 (disponible = 30.000 exactos): tanto consulta como mutación aceptan
    await setResources(t, kingdomId, { gold: 6_000, wood: 6_000, stone: 6_000, iron: 6_000, food: 6_000 });
    const exactStatus = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(exactStatus.canClaim).toBe(true);
    expect(exactStatus.capacityReport?.allSufficient).toBe(true);

    const claim = await asUser.mutation(api.compensation.claimOutageCompensation, { kingdomId });
    expect(claim.status).toBe("claimed");
    const after = await getResourcesDoc(t, kingdomId);
    expect(after!.gold).toBe(36_000);
    expect(after!.food).toBe(36_000);
  });

  test("21. Si falla calculateSettlementProgress, la consulta devuelve capacityVerifiable: false y canClaim: false", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-unverifiable"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Fallido");

    // Borramos el documento de población para provocar que calculateSettlementProgress falle (falta población relacional requerida)
    await t.run(async (ctx) => {
      const popDoc = await ctx.db
        .query("population")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .first();
      if (popDoc) await ctx.db.delete(popDoc._id);
    });

    const status = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(status.hasFoundedKingdom).toBe(true);
    expect(status.capacityVerifiable).toBe(false);
    expect(status.canClaim).toBe(false);
    expect(status.capacityReport).toBeNull();
  });

  test("22. Cuando la proyección vuelve a funcionar (población restaurada), la consulta recupera la disponibilidad real", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-recoverable"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Recuperable");

    await setBuildingLevel(t, kingdomId, "mercado", 14); // tope 38.000 >= 36.000

    let savedPop: any = null;
    await t.run(async (ctx) => {
      const popDoc = await ctx.db
        .query("population")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .first();
      if (popDoc) {
        savedPop = popDoc;
        await ctx.db.delete(popDoc._id);
      }
    });

    const badStatus = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(badStatus.capacityVerifiable).toBe(false);
    expect(badStatus.canClaim).toBe(false);

    // Restauramos la población (vuelve a funcionar)
    await t.run(async (ctx) => {
      if (savedPop) {
        await ctx.db.insert("population", {
          kingdomId: savedPop.kingdomId,
          total: savedPop.total,
          available: savedPop.available,
          capacity: savedPop.capacity,
          starving: savedPop.starving,
          starvationSeconds: savedPop.starvationSeconds,
          birthFraction: savedPop.birthFraction,
          deathFraction: savedPop.deathFraction,
          desertionFraction: savedPop.desertionFraction,
        });
      }
    });

    const goodStatus = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(goodStatus.capacityVerifiable).toBe(true);
    expect(goodStatus.canClaim).toBe(true);
    expect(goodStatus.capacityReport?.allSufficient).toBe(true);
  });

  test("23. adaptRemoteDocumentsToEconomicState devuelve resultado fallido: capacityVerifiable: false, report null, canClaim: false", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-adapter-fail"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Fallo Adaptación");

    const spy = vi.spyOn(economyAdapter, "adaptRemoteDocumentsToEconomicState").mockReturnValue({
      success: false,
      error: "Fallo simulado de adaptación",
    });

    const status = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(status.capacityVerifiable).toBe(false);
    expect(status.capacityReport).toBeNull();
    expect(status.canClaim).toBe(false);

    spy.mockRestore();
  });

  test("24. calculateSettlementProgress lanza excepción: capacityVerifiable: false, canClaim: false", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-settlement-throw"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Excepción Settlement");

    const spy = vi.spyOn(economy, "calculateSettlementProgress").mockImplementation(() => {
      throw new Error("Excepción inesperada en settlement");
    });

    const status = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(status.capacityVerifiable).toBe(false);
    expect(status.capacityReport).toBeNull();
    expect(status.canClaim).toBe(false);

    spy.mockRestore();
  });

  test("25. adaptRemoteDocumentsToEconomicState lanza excepción: capacityVerifiable: false, canClaim: false", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-adapter-throw"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Excepción Adaptación");

    const spy = vi.spyOn(economyAdapter, "adaptRemoteDocumentsToEconomicState").mockImplementation(() => {
      throw new Error("Excepción inesperada en adaptación");
    });

    const status = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(status.capacityVerifiable).toBe(false);
    expect(status.capacityReport).toBeNull();
    expect(status.canClaim).toBe(false);

    spy.mockRestore();
  });

  test("26. La consulta no modifica los recursos almacenados cuando falla la proyección", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-no-modify"));
    const kingdomId = await foundKingdom(t, asUser, "Reino No Modificar");

    const before = await getResourcesDoc(t, kingdomId);

    const spy = vi.spyOn(economyAdapter, "adaptRemoteDocumentsToEconomicState").mockImplementation(() => {
      throw new Error("Fallo forzado");
    });

    const status = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(status.capacityVerifiable).toBe(false);

    const after = await getResourcesDoc(t, kingdomId);
    expect(after).toEqual(before);

    spy.mockRestore();
  });

  test("27. Recuperación posterior tras fallo de proyección calcula correctamente la capacidad", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-recovery-after-fail"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Recuperación");

    await setBuildingLevel(t, kingdomId, "mercado", 14); // tope 38.000 >= 36.000

    const spy = vi.spyOn(economyAdapter, "adaptRemoteDocumentsToEconomicState").mockImplementation(() => {
      throw new Error("Fallo temporal");
    });

    const badStatus = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(badStatus.capacityVerifiable).toBe(false);
    expect(badStatus.canClaim).toBe(false);

    spy.mockRestore();

    const goodStatus = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(goodStatus.capacityVerifiable).toBe(true);
    expect(goodStatus.canClaim).toBe(true);
    expect(goodStatus.capacityReport?.allSufficient).toBe(true);
  });

  test("28. Una proyección fallida nunca puede habilitar el botón de cobro", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p6-never-enable"));
    const kingdomId = await foundKingdom(t, asUser, "Reino Nunca Habilitar");

    const spy = vi.spyOn(economyAdapter, "adaptRemoteDocumentsToEconomicState").mockImplementation(() => {
      throw new Error("Fallo");
    });

    const status = await asUser.query(api.compensation.getOutageCompensationStatus, {});
    expect(status.canClaim).toBe(false);
    expect(status.capacityVerifiable).toBe(false);

    spy.mockRestore();
  });
});

