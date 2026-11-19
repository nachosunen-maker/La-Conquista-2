/**
 * LA CONQUISTA — SUITE INTEGRAL DE RECLUTAMIENTO, ALMACENAMIENTO Y EXPEDICIONES DE ESPÍAS
 *
 * Valida la separación estricta entre tropas militares ordinarias y espías en:
 * - Reclutamiento especializado (army:recruitSpy) y rechazo en vías militares ordinarias (army:startTraining, military:trainUnits).
 * - Validación de cantidades, autenticación, propiedad, protección del reino demo Iberia, población, edificios y capacidad.
 * - Persistencia canónica (unitType: "espia", isSpy: true, level: 1) y exclusión de regularSoldiers.
 * - Migración segura e idempotente desde la tabla heredada Armyunits sin conversión a infantería ni duplicación.
 * - Disponibilidad, reserva atómica, concurrencia real (Promise.allSettled), finalización, cancelación e idempotencia.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DEMO_USER_ID } from "./kingdomAccess";
import {
  classifyLegacyArmyUnitDoc,
  createSpyRecruitmentPlan,
  isLegacyDocRepresentedInCanonical,
  isSpyUnitDoc,
  normalizeUnitType,
  planArmyUnitsMigration,
  reconcileArmyUnitDocs,
  summarizeArmy,
} from "./armyRules";
import {
  applyCasualtiesToArmy,
  parseMarchUnits,
  readArmyUnitDocs,
  readArmyUnitsWithMigration,
  refundMarchUnitsToGarrison,
  resolveMarch,
} from "./army";
import { applyCasualtiesToArmy as parliamentApplyCasualtiesToArmy } from "./parliament";
import { runMapReduction } from "./mapReduction";
import { emptyComposition } from "./battleRules";
import { isLivingRegularTroop } from "./militaryRules";
import { cellId, hexNeighbors, parseCellId } from "./territoryRules";
import { MAP } from "./balanceConfig";

const modules = import.meta.glob("./**/*.ts");
const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);

function createTestBackend() {
  return convexTest(schema, modules);
}

function identity(subject: string) {
  return {
    subject,
    tokenIdentifier: `https://accounts.google.com|${subject}`,
    issuer: "https://accounts.google.com",
  };
}

async function foundKingdom(
  t: ReturnType<typeof createTestBackend>,
  subject: string,
  name: string,
  civilization = "romanos"
) {
  const asUser = t.withIdentity(identity(subject));
  const kingdom = await asUser.mutation(api.economy.getOrInitializeKingdom, {
    name,
    civilization,
    castleName: `Castillo de ${name}`,
    monarchName: `Monarca de ${name}`,
  });
  return { asUser, kingdomId: kingdom._id as Id<"kingdoms"> };
}

async function setBuildingLevel(
  t: ReturnType<typeof createTestBackend>,
  kingdomId: Id<"kingdoms">,
  buildingType: string,
  level: number
) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("buildings")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .collect();
    const doc = existing.find((b) => b.buildingType === buildingType);
    if (doc) {
      await ctx.db.patch(doc._id, { level });
    } else {
      await ctx.db.insert("buildings", { kingdomId, buildingType, level });
    }
  });
}

async function setResourcesAndPop(
  t: ReturnType<typeof createTestBackend>,
  kingdomId: Id<"kingdoms">,
  opts: { gold?: number; food?: number; wood?: number; stone?: number; iron?: number; available?: number }
) {
  await t.run(async (ctx) => {
    const res = await ctx.db
      .query("resources")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .first();
    if (res) {
      await ctx.db.patch(res._id, {
        ...(opts.gold !== undefined ? { gold: opts.gold } : {}),
        ...(opts.food !== undefined ? { food: opts.food } : {}),
        ...(opts.wood !== undefined ? { wood: opts.wood } : {}),
        ...(opts.stone !== undefined ? { stone: opts.stone } : {}),
        ...(opts.iron !== undefined ? { iron: opts.iron } : {}),
      });
    }
    if (opts.available !== undefined) {
      const pop = await ctx.db
        .query("population")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .first();
      if (pop) {
        await ctx.db.patch(pop._id, { available: opts.available });
      }
    }
  });
}

async function findUnexploredFrontierCells(
  t: ReturnType<typeof createTestBackend>,
  kingdomId: Id<"kingdoms">,
  count = 3
): Promise<string[]> {
  return await t.run(async (ctx) => {
    const kingdom = await ctx.db.get(kingdomId);
    const home = kingdom?.homeTerritoryId ? parseCellId(kingdom.homeTerritoryId) : { q: 0, r: 0 };
    const origin = home ?? { q: 0, r: 0 };
    // Radio de visión inicial = 1, así que las celdas a distancia 2 son frontera explorable desconocida.
    const candidates: string[] = [];
    const seen = new Set<string>();
    const ring1 = hexNeighbors(origin, MAP.RADIUS);
    const ring1Ids = new Set([cellId(origin.q, origin.r), ...ring1.map((c) => cellId(c.q, c.r))]);
    for (const r1 of ring1) {
      for (const r2 of hexNeighbors(r1, MAP.RADIUS)) {
        const id = cellId(r2.q, r2.r);
        if (!ring1Ids.has(id) && !seen.has(id)) {
          seen.add(id);
          candidates.push(id);
          if (candidates.length >= count) return candidates;
        }
      }
    }
    return candidates;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Sistema de Reclutamiento y Gestión de Espías", () => {
  test("1 y 8. Reclutamiento válido de espías y persistencia canónica (unitType='espia', isSpy=true, level=1)", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "spy-user-1", "Reino Sombra");
    await setBuildingLevel(t, kingdomId, "cuartel", 4); // capacidad = 2 espías
    await setResourcesAndPop(t, kingdomId, { available: 10 });

    const beforePop = await t.run(async (ctx) =>
      ctx.db.query("population").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first()
    );

    const plan = await asUser.mutation(api.army.recruitSpy, { kingdomId, count: 2 });
    expect(plan.success).toBe(true);
    expect(plan.unitType).toBe("espia");
    expect(plan.level).toBe(1);
    expect(plan.count).toBe(2);

    // Población reservada inmediatamente
    const duringPop = await t.run(async (ctx) =>
      ctx.db.query("population").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first()
    );
    expect(duringPop!.available).toBe(beforePop!.available - 2);

    // En cola antes de finalizar
    const stateQueued = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(stateQueued.spies.inQueue).toBe(2);
    expect(stateQueued.spies.active).toBe(0);

    // Avanzar reloj hasta finalización y completar
    vi.setSystemTime(plan.completesAt + 1000);
    await t.mutation(internal.army.completeTraining, { trainingId: plan.trainingId });

    // Verificar persistencia canónica en armyUnits
    const docs = await t.run(async (ctx) =>
      ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect()
    );
    const spyDocs = docs.filter((d) => isSpyUnitDoc(d));
    expect(spyDocs).toHaveLength(1);
    expect(spyDocs[0].unitType).toBe("espia");
    expect(spyDocs[0].isSpy).toBe(true);
    expect(spyDocs[0].level).toBe(1);
    expect(spyDocs[0].count).toBe(2);

    // Los espías NO se suman a regularSoldiers ni al resumen de tropas de combate
    const stateAfter = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(stateAfter.spies.active).toBe(2);
    expect(stateAfter.spies.inQueue).toBe(0);
    expect(stateAfter.summary.totalActive).toBe(0);
    expect(stateAfter.summary.livingSoldiers).toBe(0);
    expect(isLivingRegularTroop("espia")).toBe(false);
  });

  test("2. Rechazo de reclutamiento de espías mediante formación militar ordinaria (army:startTraining y military:trainUnits)", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "spy-user-2", "Reino Estricto");
    await setBuildingLevel(t, kingdomId, "cuartel", 4);
    await setResourcesAndPop(t, kingdomId, { available: 10, gold: 5000, food: 5000 });

    await expect(
      asUser.mutation(api.army.startTraining, { kingdomId, unitType: "espia", count: 1 })
    ).rejects.toThrow(/no se reclutan en formación militar ordinaria|Instrucción de Agentes/i);

    await expect(
      asUser.mutation(api.army.startTraining, { kingdomId, unitType: "  ESPIA ", count: 1 })
    ).rejects.toThrow(/no se reclutan en formación militar ordinaria|Instrucción de Agentes/i);

    await expect(
      asUser.mutation(api.military.trainUnits, { kingdomId, unitType: "espia", count: 1, level: 1 })
    ).rejects.toThrow(/formación militar ordinaria|Espionaje/i);
  });

  test("3. Rechazo de cantidades inválidas (0, negativos, decimales, NaN)", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "spy-user-3", "Reino Rigor");
    await setBuildingLevel(t, kingdomId, "cuartel", 4);

    for (const invalid of [0, -1, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        asUser.mutation(api.army.recruitSpy, { kingdomId, count: invalid })
      ).rejects.toThrow(/entero positivo/i);
    }
  });

  test("4. Rechazo de usuario no autenticado o no propietario del reino", async () => {
    const t = createTestBackend();
    const owner = await foundKingdom(t, "spy-owner-4", "Reino Propio");
    const intruder = await foundKingdom(t, "spy-intruder-4", "Reino Intruso");
    await setBuildingLevel(t, owner.kingdomId, "cuartel", 4);

    // Anónimo
    await expect(
      t.mutation(api.army.recruitSpy, { kingdomId: owner.kingdomId, count: 1 })
    ).rejects.toThrow(/Autenticación requerida/i);

    // Otro usuario
    await expect(
      intruder.asUser.mutation(api.army.recruitSpy, { kingdomId: owner.kingdomId, count: 1 })
    ).rejects.toThrow(/No autorizado/i);
  });

  test("5. Protección del reino demo Iberia contra reclutamiento y expediciones", async () => {
    const t = createTestBackend();
    const demoUser = t.withIdentity(identity(DEMO_USER_ID));
    const demoKingdomId = await t.run(async (ctx) => {
      const kId = await ctx.db.insert("kingdoms", {
        userId: DEMO_USER_ID,
        name: "Reino de Iberia",
        civilization: "romanos",
        homeTerritoryId: "0,0",
      });
      await ctx.db.insert("buildings", { kingdomId: kId, buildingType: "cuartel", level: 4 });
      await ctx.db.insert("armyUnits", { kingdomId: kId, unitType: "espia", level: 1, count: 2, isSpy: true });
      return kId;
    });

    await expect(
      demoUser.mutation(api.army.recruitSpy, { kingdomId: demoKingdomId, count: 1 })
    ).rejects.toThrow(/No autorizado/i);

    await expect(
      demoUser.mutation(api.territories.startExploration, { kingdomId: demoKingdomId, cellId: "2,0", spiesCount: 1 })
    ).rejects.toThrow(/No autorizado/i);
  });

  test("6 y 7. Validación de requisitos de edificios, población civil libre, capacidad y recursos", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "spy-user-67", "Reino Requisitos");

    // 7a. Cuartel nivel 1 (insuficiente: requiere nivel 2)
    await setBuildingLevel(t, kingdomId, "cuartel", 1);
    await expect(
      asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 })
    ).rejects.toThrow(/Cuartel nivel 2/i);

    // 7b. Cuartel nivel 2 (capacidad 1), pero población civil libre 0
    await setBuildingLevel(t, kingdomId, "cuartel", 2);
    await setResourcesAndPop(t, kingdomId, { available: 0 });
    await expect(
      asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 })
    ).rejects.toThrow(/Población civil libre insuficiente/i);

    // 7c. Capacidad excedida (cuartel nivel 2 -> máx 1 espía, solicita 2)
    await setResourcesAndPop(t, kingdomId, { available: 10 });
    await expect(
      asUser.mutation(api.army.recruitSpy, { kingdomId, count: 2 })
    ).rejects.toThrow(/Capacidad de espías excedida/i);

    // 6. Validación de recursos en regla pura (saldo negativo o corrupto rechazado)
    const invalidRes = createSpyRecruitmentPlan({
      count: 1,
      resources: { gold: -10, wood: 100, stone: 100, iron: 100, food: 100 },
      availableCivil: 5,
      buildingLevels: { cuartel: 2 },
      activeTraining: [],
      activeSpies: 0,
      busySpies: 0,
      inQueueSpies: 0,
      now: T0,
    });
    expect(invalidRes.success).toBe(false);
  });

  test("9 y 10. Lectura y migración segura de espías en tabla heredada Armyunits sin conversión a infantería ni duplicación", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "spy-user-910", "Reino Legado");
    await setBuildingLevel(t, kingdomId, "cuartel", 6); // capacidad = 3
    await setResourcesAndPop(t, kingdomId, { available: 10, gold: 5000, food: 5000 });

    // Insertar espía en tabla heredada Armyunits (incluyendo caso extremo unitType='regular' con isSpy=true)
    await t.run(async (ctx) => {
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        count: 1,
      });
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "regular",
        isSpy: true,
        count: 1,
      });
    });

    // Lectura de solo consulta debe contabilizar ambos espías sin mezclar con infantería
    const beforeState = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(beforeState.spies.active).toBe(2);
    expect(beforeState.summary.byType.infanteria.active).toBe(0);
    expect(beforeState.summary.totalActive).toBe(0);

    // Al ejecutar una mutación (reclutar 1 espía más), se migra Armyunits -> armyUnits sin duplicar ni convertir
    const plan = await asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 });
    expect(plan.success).toBe(true);

    const { canonical, legacy } = await t.run(async (ctx) => ({
      canonical: await ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect(),
      legacy: await (ctx.db as any).query("Armyunits").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).collect(),
    }));

    expect(legacy).toHaveLength(0);
    const spyDocs = canonical.filter((d) => isSpyUnitDoc(d));
    const infDocs = canonical.filter((d) => !isSpyUnitDoc(d) && d.unitType === "infanteria");
    expect(infDocs).toHaveLength(0);
    expect(spyDocs.reduce((sum, d) => sum + d.count, 0)).toBe(2);
    for (const d of spyDocs) {
      expect(d.unitType).toBe("espia");
      expect(d.isSpy).toBe(true);
      expect(d.level).toBe(1);
      expect(typeof d.migratedFromLegacyId).toBe("string");
    }
  });

  test("11, 12, 13 y 14. Expedición con espías disponibles, rechazo sin espías, rechazo de tropas ordinarias como espías y reserva correcta", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "spy-user-1114", "Reino Explorador");
    await setResourcesAndPop(t, kingdomId, { gold: 10000, food: 10000 });
    const [cell1, cell2] = await findUnexploredFrontierCells(t, kingdomId, 2);

    // 12 y 13. Solo infantería ordinaria, cero espías -> la expedición debe fallar
    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", {
        kingdomId,
        unitType: "infanteria",
        level: 1,
        count: 50,
        isSpy: false,
      });
    });

    await expect(
      asUser.mutation(api.territories.startExploration, { kingdomId, cellId: cell1, spiesCount: 1 })
    ).rejects.toThrow(/espías/i);

    // Añadir 2 espías canónicos
    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
        isSpy: true,
      });
    });

    // 11 y 14. Lanzar expedición con 1 espía -> reserva exactamente 1 espía
    const exp = await asUser.mutation(api.territories.startExploration, {
      kingdomId,
      cellId: cell1,
      spiesCount: 1,
    });
    expect(exp.success).toBe(true);

    const stateAfterStart = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(stateAfterStart.spies.active).toBe(1);
    expect(stateAfterStart.spies.busy).toBe(1);
    // La infantería permanece intacta
    expect(stateAfterStart.summary.byType.infanteria.active).toBe(50);

    // Solicitar 2 espías cuando solo queda 1 libre -> rechazado
    await expect(
      asUser.mutation(api.territories.startSpyExploration, { kingdomId, cellId: cell2, spiesCount: 2 })
    ).rejects.toThrow(/suficientes espías/i);
  });

  test("15. Protección frente a peticiones concurrentes reales (reclutamiento al límite y expediciones compitiendo por el último espía)", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "spy-user-15", "Reino Concurrente");
    await setBuildingLevel(t, kingdomId, "cuartel", 2); // capacidad = 1 espía
    await setResourcesAndPop(t, kingdomId, { available: 10, gold: 10000, food: 10000 });

    // 15a. Dos reclutamientos concurrentes cuando la capacidad es 1: exactamente uno triunfa
    const recruitResults = await Promise.allSettled([
      asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 }),
      asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 }),
    ]);
    const recruitFulfilled = recruitResults.filter((r) => r.status === "fulfilled");
    const recruitRejected = recruitResults.filter((r) => r.status === "rejected");
    expect(recruitFulfilled).toHaveLength(1);
    expect(recruitRejected).toHaveLength(1);

    // Completar el único espía reclutado
    const recruitedPlan = (recruitFulfilled[0] as PromiseFulfilledResult<any>).value;
    vi.setSystemTime(recruitedPlan.completesAt + 1000);
    await t.mutation(internal.army.completeTraining, { trainingId: recruitedPlan.trainingId });

    // 15b. Dos expediciones concurrentes compitiendo por el único espía disponible: exactamente una triunfa
    const [cell1, cell2] = await findUnexploredFrontierCells(t, kingdomId, 2);
    const expResults = await Promise.allSettled([
      asUser.mutation(api.territories.startExploration, { kingdomId, cellId: cell1, spiesCount: 1 }),
      asUser.mutation(api.territories.startSpyExploration, { kingdomId, cellId: cell2, spiesCount: 1 }),
    ]);
    const expFulfilled = expResults.filter((r) => r.status === "fulfilled");
    const expRejected = expResults.filter((r) => r.status === "rejected");
    expect(expFulfilled).toHaveLength(1);
    expect(expRejected).toHaveLength(1);

    const stateAfterRace = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(stateAfterRace.spies.active).toBe(0);
    expect(stateAfterRace.spies.busy).toBe(1);
  });

  test("16 y 18. Finalización de expedición sin pérdida ni duplicación de espías + idempotencia ante reintentos", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "spy-user-1618", "Reino Idempotente");
    await setResourcesAndPop(t, kingdomId, { gold: 10000, food: 10000 });
    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 2, isSpy: true });
    });
    const [cell1] = await findUnexploredFrontierCells(t, kingdomId, 1);

    const exp = await asUser.mutation(api.territories.startExploration, {
      kingdomId,
      cellId: cell1,
      spiesCount: 2,
    });

    // Durante la misión: 0 libres, 2 ocupados
    const mid = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(mid.spies.active).toBe(0);
    expect(mid.spies.busy).toBe(2);

    // Completar y reintentar la finalización dos veces (idempotencia)
    vi.setSystemTime(exp.completesAt + 1000);
    const first = await t.mutation(internal.territories.completeExplorationScheduled, {
      expeditionId: exp.expeditionId,
    });
    const second = await t.mutation(internal.territories.completeExplorationScheduled, {
      expeditionId: exp.expeditionId,
    });
    expect(first?.success).toBe(true);
    expect(second).toBeNull();

    // Exactamente 2 espías devueltos (ni perdidos ni duplicados) con metadatos canónicos
    const after = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(after.spies.active).toBe(2);
    expect(after.spies.busy).toBe(0);
    const spyDocs = await t.run(async (ctx) =>
      ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect()
    );
    expect(spyDocs).toHaveLength(1);
    expect(spyDocs[0].isSpy).toBe(true);
    expect(spyDocs[0].level).toBe(1);
    expect(spyDocs[0].count).toBe(2);
  });

  test("17. Cancelación de expedición en curso devuelve espías y 50 % de recursos; rechazo de cancelación si ya venció", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "spy-user-17", "Reino Cancelación");
    await setResourcesAndPop(t, kingdomId, { gold: 10000, food: 10000 });
    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 2, isSpy: true });
    });
    const [cell1, cell2] = await findUnexploredFrontierCells(t, kingdomId, 2);

    // Caso A: cancelar en curso devuelve espías y 50 % de costes
    const expA = await asUser.mutation(api.territories.startExploration, {
      kingdomId,
      cellId: cell1,
      spiesCount: 2,
    });
    const cancelled = await asUser.mutation(api.territories.cancelExploration, {
      kingdomId,
      expeditionId: expA.expeditionId,
    });
    expect(cancelled.success).toBe(true);
    expect(cancelled.returnedSpies).toBe(2);
    expect(cancelled.refund.gold).toBe(Math.floor(expA.costs.gold * 0.5));
    expect(cancelled.refund.food).toBe(Math.floor(expA.costs.food * 0.5));

    // Reintentar cancelar la misma expedición falla
    await expect(
      asUser.mutation(api.territories.cancelExploration, { kingdomId, expeditionId: expA.expeditionId })
    ).rejects.toThrow(/no existe/i);

    const stateAfterCancel = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(stateAfterCancel.spies.active).toBe(2);
    expect(stateAfterCancel.spies.busy).toBe(0);

    // Caso B: cancelar una expedición cuyo tiempo ya venció debe rechazarse
    const expB = await asUser.mutation(api.territories.startExploration, {
      kingdomId,
      cellId: cell2,
      spiesCount: 1,
    });
    vi.setSystemTime(expB.completesAt + 1000);
    await expect(
      asUser.mutation(api.territories.cancelExploration, { kingdomId, expeditionId: expB.expeditionId })
    ).rejects.toThrow(/ya ha alcanzado su tiempo de finalización/i);

    // Debe poder completarse normalmente después sin pérdida de espías
    const resolved = await asUser.mutation(api.territories.resolveCompletedExplorations, { kingdomId });
    expect(resolved.count).toBe(1);
    const finalState = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(finalState.spies.active).toBe(2);
    expect(finalState.spies.busy).toBe(0);
  });

  test("Integridad cruzada: military:resolveCompletedTrainings conserva isSpy=true, level=1 y no incrementa regularSoldiers", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "spy-user-military", "Reino Cruzado");
    await setBuildingLevel(t, kingdomId, "cuartel", 4);
    await setResourcesAndPop(t, kingdomId, { available: 10 });

    const plan = await asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 });
    vi.setSystemTime(plan.completesAt + 1000);

    // Si alguien llama a military:resolveCompletedTrainings en lugar de army:completeTraining
    const res = await asUser.mutation(api.military.resolveCompletedTrainings, { kingdomId });
    expect(res.success).toBe(true);
    expect(res.processedCount).toBe(1);
    expect(res.nextRegularSoldiers).toBe(0);

    const docs = await t.run(async (ctx) =>
      ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect()
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].unitType).toBe("espia");
    expect(docs[0].isSpy).toBe(true);
    expect(docs[0].level).toBe(1);
    expect(docs[0].count).toBe(1);
    expect(summarizeArmy(docs).livingSoldiers).toBe(0);
  });
});

describe("Migración y reconciliación determinista Armyunits -> armyUnits (Casos A–G)", () => {
  test("Caso A — Solo registros antiguos: migra espías desde Armyunits conservando todos sus atributos", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "mig-caso-a", "Reino Antiguo");

    const legacyId = await t.run(async (ctx) =>
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 3,
      })
    );

    // Antes de migrar: getArmyState ya refleja exactamente 3 espías
    const stateBefore = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(stateBefore.spies.active).toBe(3);

    // Ejecutar migración transaccional
    const migrated = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    const legacyRemaining = await t.run(async (ctx) =>
      (ctx.db as any).query("Armyunits").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).collect()
    );

    expect(legacyRemaining).toHaveLength(0);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].unitType).toBe("espia");
    expect(migrated[0].isSpy).toBe(true);
    expect(migrated[0].level).toBe(1);
    expect(migrated[0].count).toBe(3);
    expect(migrated[0].kingdomId).toBe(kingdomId);
    expect(migrated[0].migratedFromLegacyId).toBe(String(legacyId));
    expect(migrated[0].migrationAmbiguous).toBeUndefined();
  });

  test("Caso B — Solo registros canónicos: la migración no altera cantidades, documentos ni atributos", async () => {
    const t = createTestBackend();
    const { kingdomId } = await foundKingdom(t, "mig-caso-b", "Reino Canónico");

    const canonicalId = await t.run(async (ctx) =>
      ctx.db.insert("armyUnits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 4,
        isSpy: true,
      })
    );

    const after = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(after).toHaveLength(1);
    expect(after[0]._id).toBe(canonicalId);
    expect(after[0].unitType).toBe("espia");
    expect(after[0].isSpy).toBe(true);
    expect(after[0].level).toBe(1);
    expect(after[0].count).toBe(4);
  });

  test("Caso C — Datos mixtos: no duplica la unidad ya representada en ambas tablas y conserva unidades legítimas distintas", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "mig-caso-c", "Reino Mixto");

    const { dupLegacyId, distinctLegacyId, ambiguousLegacyId } = await t.run(async (ctx) => {
      // 1. Unidad presente en AMBAS tablas (vínculo de procedencia explícito)
      const dupId = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
      });
      await ctx.db.insert("armyUnits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
        isSpy: true,
        migratedFromLegacyId: String(dupId),
        migratedFromLegacyIds: [String(dupId)],
      });

      // 2. Unidad legítima distinta en Armyunits (nivel 2, sin representación en armyUnits)
      const distId = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 2,
        count: 1,
      });

      // 3. Registro heredado ambiguo: mismo tipo y nivel 1 que el canónico pero SIN vínculo de procedencia
      const ambId = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 1,
      });

      return { dupLegacyId: dupId, distinctLegacyId: distId, ambiguousLegacyId: ambId };
    });

    // Lectura previa (solo consulta): debe contar 2 (canónico) + 1 (distinto nv2) + 1 (ambiguo nv1) = 4, NO 6
    const beforeState = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(beforeState.spies.active).toBe(4);

    // Ejecutar migración
    const after = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    const legacyRemaining = await t.run(async (ctx) =>
      (ctx.db as any).query("Armyunits").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).collect()
    );
    expect(legacyRemaining).toHaveLength(0);

    // El registro duplicado NO se sumó dos veces; el canónico original sigue con count=2
    const origCanonical = after.find((d) => d.migratedFromLegacyId === String(dupLegacyId));
    expect(origCanonical?.count).toBe(2);
    expect(origCanonical?.migrationAmbiguous).toBeUndefined();

    // La unidad legítima distinta de nivel 2 se conserva íntegra
    const distinctCanonical = after.find((d) => d.migratedFromLegacyId === String(distinctLegacyId));
    expect(distinctCanonical?.level).toBe(2);
    expect(distinctCanonical?.count).toBe(1);
    expect(distinctCanonical?.isSpy).toBe(true);
    expect(distinctCanonical?.migrationAmbiguous).toBeUndefined();

    // El registro ambiguo sin vínculo se preserva marcado explícitamente sin borrar ni fusionar a ciegas
    const ambiguousCanonical = after.find((d) => d.migratedFromLegacyId === String(ambiguousLegacyId));
    expect(ambiguousCanonical?.level).toBe(1);
    expect(ambiguousCanonical?.count).toBe(1);
    expect(ambiguousCanonical?.isSpy).toBe(true);
    expect(ambiguousCanonical?.migrationAmbiguous).toBe(true);

    // Total coherente antes y después de la migración
    const afterState = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(afterState.spies.active).toBe(4);
  });

  test("Caso D — Diferentes niveles: espías de distintos niveles permanecen separados con sus cantidades exactas", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "mig-caso-d", "Reino Niveles");

    await t.run(async (ctx) => {
      await (ctx.db as any).insert("Armyunits", { kingdomId, unitType: "espia", level: 1, count: 2 });
      await (ctx.db as any).insert("Armyunits", { kingdomId, unitType: "espia", level: 2, count: 3 });
      await (ctx.db as any).insert("Armyunits", { kingdomId, unitType: "espia", level: 3, count: 1 });
    });

    const migrated = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(migrated).toHaveLength(3);

    const byLevel = new Map(migrated.map((d) => [d.level, d]));
    expect(byLevel.get(1)?.count).toBe(2);
    expect(byLevel.get(2)?.count).toBe(3);
    expect(byLevel.get(3)?.count).toBe(1);
    for (const d of migrated) {
      expect(d.unitType).toBe("espia");
      expect(d.isSpy).toBe(true);
    }

    const state = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state.spies.active).toBe(6);
  });

  test("Caso E — Tipos y atributos: mezcla de tropas ordinarias, mercenarios, heridos y espías sin mezclar tipos", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "mig-caso-e", "Reino Atributos");

    await t.run(async (ctx) => {
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "regular",
        level: 2,
        count: 15,
        wounded: 3,
      });
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "caballeria",
        level: 3,
        count: 8,
        isMercenary: true,
        mercenaryTypeId: "jinetes",
        contractEndsAt: T0 + 86400_000,
      });
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
      });
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "regular",
        isSpy: true,
        level: 2,
        count: 1,
      });
    });

    const migrated = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    const spies = migrated.filter((d) => isSpyUnitDoc(d));
    const regulars = migrated.filter((d) => !isSpyUnitDoc(d));

    expect(spies).toHaveLength(2);
    expect(spies.reduce((s, d) => s + d.count, 0)).toBe(3);
    expect(spies.every((d) => d.unitType === "espia" && d.isSpy === true)).toBe(true);

    expect(regulars).toHaveLength(2);
    const inf = regulars.find((d) => d.unitType === "infanteria");
    const cav = regulars.find((d) => d.unitType === "caballeria");
    expect(inf?.isSpy).toBe(false);
    expect(inf?.level).toBe(2);
    expect(inf?.count).toBe(15);
    expect(inf?.wounded).toBe(3);
    expect(cav?.isSpy).toBe(false);
    expect(cav?.isMercenary).toBe(true);
    expect(cav?.mercenaryTypeId).toBe("jinetes");
    expect(cav?.contractEndsAt).toBe(T0 + 86400_000);

    const state = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state.spies.active).toBe(3);
    expect(state.summary.totalActive).toBe(23);
    expect(state.summary.totalWounded).toBe(3);
  });

  test("Caso F — Idempotencia: ejecutar la migración dos veces no modifica cantidades, documentos ni resultados", async () => {
    const t = createTestBackend();
    const { kingdomId } = await foundKingdom(t, "mig-caso-f", "Reino Idempotencia");

    await t.run(async (ctx) => {
      await (ctx.db as any).insert("Armyunits", { kingdomId, unitType: "espia", level: 1, count: 2 });
      await (ctx.db as any).insert("Armyunits", { kingdomId, unitType: "infanteria", level: 1, count: 10 });
    });

    const firstPass = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    const secondPass = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));

    expect(secondPass).toHaveLength(firstPass.length);
    expect(secondPass.map((d) => ({ _id: d._id, unitType: d.unitType, count: d.count, level: d.level, isSpy: d.isSpy }))).toEqual(
      firstPass.map((d) => ({ _id: d._id, unitType: d.unitType, count: d.count, level: d.level, isSpy: d.isSpy }))
    );
  });

  test("Caso G — Lecturas posteriores: getArmyState devuelve valores coherentes antes y después sin doble conteo", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "mig-caso-g", "Reino Coherente");
    await setBuildingLevel(t, kingdomId, "cuartel", 6); // capacidad = 3

    await t.run(async (ctx) => {
      const legacyId = await (ctx.db as any).insert("Armyunits", { kingdomId, unitType: "espia", level: 1, count: 1 });
      await ctx.db.insert("armyUnits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 1,
        isSpy: true,
        migratedFromLegacyId: String(legacyId),
      });
      await (ctx.db as any).insert("Armyunits", { kingdomId, unitType: "espia", level: 2, count: 1 });
    });

    const stateBefore = await asUser.query(api.army.getArmyState, { kingdomId });
    await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    const stateAfter = await asUser.query(api.army.getArmyState, { kingdomId });

    expect(stateBefore.spies.active).toBe(2);
    expect(stateAfter.spies.active).toBe(2);
    expect(stateAfter.spies.capacity).toBe(3);
    expect(stateAfter.spies.busy).toBe(0);
    expect(stateAfter.spies.inQueue).toBe(0);
  });
});

describe("Concurrencia real y transacciones del ciclo completo de espías", () => {
  test("Concurrencia en recruitSpy: no supera capacidad ni descuenta población dos veces", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "conc-recruit", "Reino Conc Recluta");
    await setBuildingLevel(t, kingdomId, "cuartel", 2); // capacidad = 1
    await setResourcesAndPop(t, kingdomId, { available: 10 });

    const results = await Promise.allSettled([
      asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 }),
      asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 }),
      asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);

    const popAfter = await t.run(async (ctx) =>
      ctx.db.query("population").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first()
    );
    expect(popAfter!.available).toBe(9); // Solo se descontó 1 ciudadano, no 3

    const queue = await t.run(async (ctx) =>
      ctx.db.query("trainingQueue").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect()
    );
    expect(queue).toHaveLength(1);
  });

  test("Concurrencia en completeTraining y cancelTraining: sin duplicación de espías ni doble reembolso", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "conc-train-lifecycle", "Reino Conc Cola");
    await setBuildingLevel(t, kingdomId, "cuartel", 4); // capacidad = 2
    await setResourcesAndPop(t, kingdomId, { available: 10 });

    // Caso 1: dos cancelTraining simultáneos sobre el mismo lote
    const batchA = await asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 });
    const cancelRace = await Promise.allSettled([
      asUser.mutation(api.army.cancelTraining, { kingdomId, trainingId: batchA.trainingId }),
      asUser.mutation(api.army.cancelTraining, { kingdomId, trainingId: batchA.trainingId }),
    ]);
    expect(cancelRace.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(cancelRace.filter((r) => r.status === "rejected")).toHaveLength(1);

    const popAfterCancel = await t.run(async (ctx) =>
      ctx.db.query("population").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first()
    );
    expect(popAfterCancel!.available).toBe(10); // Devuelto exactamente 1 vez

    // Caso 2: dos completeTraining simultáneos sobre un lote vencido -> sin duplicar espías
    const batchB = await asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 });
    vi.setSystemTime(batchB.completesAt + 1000);
    const completeRace = await Promise.allSettled([
      t.mutation(internal.army.completeTraining, { trainingId: batchB.trainingId }),
      t.mutation(internal.army.completeTraining, { trainingId: batchB.trainingId }),
    ]);
    expect(completeRace.every((r) => r.status === "fulfilled")).toBe(true);
    const completedFlags = completeRace.map((r) => (r as PromiseFulfilledResult<any>).value.completed);
    expect(completedFlags.filter(Boolean)).toHaveLength(1);

    const stateAfter = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(stateAfter.spies.active).toBe(1);
    expect(stateAfter.spies.inQueue).toBe(0);
  });

  test("Concurrencia entre cancelExploration y completeExplorationScheduled sobre expedición vencida: exclusión mutua y sin doble devolución", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "conc-exp-race", "Reino Conc Exp");
    await setResourcesAndPop(t, kingdomId, { gold: 10000, food: 10000 });
    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 2, isSpy: true });
    });
    const [cell1, cell2] = await findUnexploredFrontierCells(t, kingdomId, 2);

    // 1. Crear expedición válida con 2 espías y verificar completesAt persistido
    const exp1 = await asUser.mutation(api.territories.startExploration, {
      kingdomId,
      cellId: cell1,
      spiesCount: 2,
    });
    const persistedBefore = await t.run(async (ctx) => ctx.db.get(exp1.expeditionId));
    expect(persistedBefore).not.toBeNull();
    expect(persistedBefore!.completesAt).toBe(exp1.completesAt);

    // 2. Adelantar el reloj de prueba hasta DESPUÉS de completesAt (expedición realmente vencida)
    vi.setSystemTime(exp1.completesAt + 1000);

    // 3. Lanzar simultáneamente cancelExploration y completeExplorationScheduled
    const [cancelOutcome, completeOutcome] = await Promise.allSettled([
      asUser.mutation(api.territories.cancelExploration, { kingdomId, expeditionId: exp1.expeditionId }),
      t.mutation(internal.territories.completeExplorationScheduled, { expeditionId: exp1.expeditionId }),
    ]);

    // 4. Solo una transición válida ocurre: cancelación rechazada y finalización exitosa
    expect(cancelOutcome.status).toBe("rejected");
    expect(completeOutcome.status).toBe("fulfilled");
    expect((completeOutcome as PromiseFulfilledResult<any>).value?.success).toBe(true);
    expect((completeOutcome as PromiseFulfilledResult<any>).value?.cellId).toBe(cell1);

    // 5. Verificar estado persistido en base de datos: expedición eliminada, celda explorada, exactamente 2 espías (nunca 4)
    const { persistedExpAfter, exploredDoc, spyDocsAfter } = await t.run(async (ctx) => ({
      persistedExpAfter: await ctx.db.get(exp1.expeditionId),
      exploredDoc: await ctx.db
        .query("exploredTerritories")
        .withIndex("by_kingdom_and_cell", (q) => q.eq("kingdomId", kingdomId).eq("cellId", cell1))
        .first(),
      spyDocsAfter: (
        await ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect()
      ).filter((d) => isSpyUnitDoc(d)),
    }));

    expect(persistedExpAfter).toBeNull();
    expect(exploredDoc).not.toBeNull();
    expect(spyDocsAfter.reduce((sum, d) => sum + d.count, 0)).toBe(2);

    const stateMid = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(stateMid.spies.active).toBe(2);
    expect(stateMid.spies.busy).toBe(0);

    // 6. Carrera real de doble completeExplorationScheduled sobre expedición vencida (idempotencia)
    const exp2 = await asUser.mutation(api.territories.startSpyExploration, {
      kingdomId,
      cellId: cell2,
      spiesCount: 2,
    });
    vi.setSystemTime(exp2.completesAt + 1000);
    const doubleComplete = await Promise.allSettled([
      t.mutation(internal.territories.completeExplorationScheduled, { expeditionId: exp2.expeditionId }),
      t.mutation(internal.territories.completeExplorationScheduled, { expeditionId: exp2.expeditionId }),
    ]);
    const nonNullCompletions = doubleComplete
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value)
      .filter((val) => val !== null);
    expect(nonNullCompletions).toHaveLength(1);

    const persistedExp2After = await t.run(async (ctx) => ctx.db.get(exp2.expeditionId));
    expect(persistedExp2After).toBeNull();

    const stateFinal = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(stateFinal.spies.active).toBe(2);
    expect(stateFinal.spies.busy).toBe(0);
  });

  test("Ausencia de participación de espías en combates ordinarios (launchAttack rechaza espías)", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "spy-no-combat", "Reino Sin Espías En Combate");
    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 2, isSpy: true });
    });

    // Celda adyacente a la capital (ya conocida por visión inicial radio 1)
    const adjacentCellId = await t.run(async (ctx) => {
      const k = await ctx.db.get(kingdomId);
      const home = k?.homeTerritoryId ? parseCellId(k.homeTerritoryId) : { q: 0, r: 0 };
      const neighbor = hexNeighbors(home ?? { q: 0, r: 0 }, MAP.RADIUS)[0];
      return cellId(neighbor.q, neighbor.r);
    });

    await expect(
      asUser.mutation(api.army.launchAttack, {
        kingdomId,
        cellId: adjacentCellId,
        units: [{ unitType: "espia", level: 1, count: 1 }],
      })
    ).rejects.toThrow(/espías no participan en marchas de ataque/i);
  });
});

describe("Defecto 1 — Verificación segura de procedencia en migración (nunca confiar en migrated: true sin canónico válido)", () => {
  test("1. Registro antiguo con migrated: true y SIN documento canónico: se conserva y se migra", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "def1-t1", "Reino Sin Canónico");

    const legacyId = await t.run(async (ctx) =>
      (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 3,
        migrated: true,
      })
    );

    // Antes de migrar: no debe omitirse por tener migrated: true sin respaldo canónico
    const before = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(before.spies.active).toBe(3);

    const after = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(after).toHaveLength(1);
    expect(after[0].unitType).toBe("espia");
    expect(after[0].isSpy).toBe(true);
    expect(after[0].count).toBe(3);
    expect(after[0].migratedFromLegacyId).toBe(String(legacyId));
  });

  test("2. Registro antiguo con migrated: true Y documento canónico válido vinculado: evita doble conteo", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "def1-t2", "Reino Con Canónico");

    await t.run(async (ctx) => {
      const canonicalId = await ctx.db.insert("armyUnits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
        isSpy: true,
      });
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
        migrated: true,
        migratedToId: canonicalId,
      });
    });

    const before = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(before.spies.active).toBe(2);

    const after = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(after).toHaveLength(1);
    expect(after[0].count).toBe(2);
  });

  test("3. Identificador de destino (migratedToId/canonicalId) inexistente: NO borra el registro antiguo, lo migra", async () => {
    const t = createTestBackend();
    const { kingdomId } = await foundKingdom(t, "def1-t3", "Reino Destino Roto");

    await t.run(async (ctx) => {
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 2,
        count: 2,
        migrated: true,
        migratedToId: "id_inexistente_9999",
        canonicalId: "id_inexistente_8888",
      });
    });

    const after = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(after).toHaveLength(1);
    expect(after[0].unitType).toBe("espia");
    expect(after[0].level).toBe(2);
    expect(after[0].count).toBe(2);
    expect(after[0].isSpy).toBe(true);
  });

  test("4. Identificador canónico perteneciente a OTRO reino: NO se considera correspondencia válida", async () => {
    const t = createTestBackend();
    const realmA = await foundKingdom(t, "def1-t4-a", "Reino A");
    const realmB = await foundKingdom(t, "def1-t4-b", "Reino B");

    // Verificación pura sobre cruce de reinos (both migratedToId and migratedFromLegacyId)
    const crossKingdomCanonical = {
      _id: "canon_b",
      kingdomId: realmB.kingdomId,
      unitType: "espia",
      count: 2,
      isSpy: true,
      migratedFromLegacyId: "legacy_a",
    };
    const legacyInRealmA = {
      _id: "legacy_a",
      kingdomId: realmA.kingdomId,
      unitType: "espia",
      count: 2,
      migrated: true,
      migratedToId: "canon_b",
      canonicalId: "canon_b",
    };
    expect(isLegacyDocRepresentedInCanonical(legacyInRealmA, [crossKingdomCanonical])).toBe(false);

    // Verificación en BD: documento en Reino A apuntando a canónico de Reino B se migra y NO se pierde
    await t.run(async (ctx) => {
      const otherCanonicalId = await ctx.db.insert("armyUnits", {
        kingdomId: realmB.kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
        isSpy: true,
      });
      await (ctx.db as any).insert("Armyunits", {
        kingdomId: realmA.kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
        migrated: true,
        migratedToId: otherCanonicalId,
      });
    });

    const afterA = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, realmA.kingdomId));
    expect(afterA).toHaveLength(1);
    expect(afterA[0].kingdomId).toBe(realmA.kingdomId);
    expect(afterA[0].count).toBe(2);
    expect(afterA[0].isSpy).toBe(true);
  });

  test("5 y 6. Vínculo válido por migratedFromLegacyId y por migratedFromLegacyIds + 7. Repetición idempotente", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "def1-t567", "Reino Vínculos");

    await t.run(async (ctx) => {
      const leg1 = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
      });
      const leg2 = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 2,
        count: 3,
      });
      await ctx.db.insert("armyUnits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
        isSpy: true,
        migratedFromLegacyId: String(leg1),
      });
      await ctx.db.insert("armyUnits", {
        kingdomId,
        unitType: "espia",
        level: 2,
        count: 3,
        isSpy: true,
        migratedFromLegacyIds: ["otro_id", String(leg2)],
      });
    });

    const before = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(before.spies.active).toBe(5);

    const pass1 = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    const pass2 = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));

    expect(pass1).toHaveLength(2);
    expect(pass1.reduce((s, d) => s + d.count, 0)).toBe(5);
    expect(pass2.map((d) => ({ _id: d._id, count: d.count, level: d.level }))).toEqual(
      pass1.map((d) => ({ _id: d._id, count: d.count, level: d.level }))
    );
  });
});

describe("Defecto 2 — Cuarentena y preservación de registros heredados con tipos no reconocidos", () => {
  test("1, 2, 3 y 4. Tipos desconocidos (cantidad, heridos, mercenario, isSpy) se conservan íntegros sin convertirse ni contabilizarse", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "def2-t1234", "Reino Cuarentena");

    const ids = await t.run(async (ctx) => {
      const id1 = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "lancero_heredado_v0",
        level: 2,
        count: 7,
      });
      const id2 = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "ballestero_beta",
        level: 3,
        count: 5,
        wounded: 2,
      });
      const id3 = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "corsario_antiguo",
        level: 1,
        count: 4,
        isMercenary: true,
        mercenaryTypeId: "corsarios",
        contractEndsAt: T0 + 86400_000,
      });
      const id4 = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "agente_experimental_v0",
        level: 1,
        count: 3,
        isSpy: true,
      });
      return { id1, id2, id3, id4 };
    });

    // Clasificación pura verifica los 3 estados
    expect(classifyLegacyArmyUnitDoc({ unitType: "agente_experimental_v0", isSpy: true, count: 3 }).status).toBe("unrecognized");

    // Ejecutar migración: ninguno debe borrarse ni insertarse en armyUnits
    const canonical = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(canonical).toHaveLength(0);

    // Verificar que los 4 registros siguen intactos en Armyunits con TODOS sus atributos originales
    const legacyAfter = await t.run(async (ctx) =>
      (ctx.db as any).query("Armyunits").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).collect()
    );
    expect(legacyAfter).toHaveLength(4);

    const d1 = legacyAfter.find((d: any) => d._id === ids.id1);
    const d2 = legacyAfter.find((d: any) => d._id === ids.id2);
    const d3 = legacyAfter.find((d: any) => d._id === ids.id3);
    const d4 = legacyAfter.find((d: any) => d._id === ids.id4);
    expect(d1).toMatchObject({ unitType: "lancero_heredado_v0", level: 2, count: 7 });
    expect(d2).toMatchObject({ unitType: "ballestero_beta", level: 3, count: 5, wounded: 2 });
    expect(d3).toMatchObject({
      unitType: "corsario_antiguo",
      count: 4,
      isMercenary: true,
      mercenaryTypeId: "corsarios",
      contractEndsAt: T0 + 86400_000,
    });
    expect(d4).toMatchObject({ unitType: "agente_experimental_v0", count: 3, isSpy: true });

    // No se contabilizan como tropas ordinarias ni como espías en getArmyState
    const state = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state.summary.totalActive).toBe(0);
    expect(state.summary.totalWounded).toBe(0);
    expect(state.spies.active).toBe(0);
  });

  test("5, 6 y 7. Vacío se limpia, válidos migran junto a inválido en cuarentena, y repetir migración es idempotente", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "def2-t567", "Reino Mixto Cuarentena");

    const { unknownId } = await t.run(async (ctx) => {
      // Registro realmente vacío -> elegible para borrado
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "infanteria",
        count: 0,
      });
      // Registro válido de espías -> debe migrar
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
      });
      // Registro válido de infantería -> debe migrar
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "regular",
        level: 1,
        count: 10,
      });
      // Registro con tipo desconocido -> debe permanecer en cuarentena
      const unkId = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "unidad_misteriosa",
        level: 2,
        count: 4,
      });
      return { unknownId: unkId };
    });

    // Primera pasada de migración
    const pass1 = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(pass1).toHaveLength(2);
    expect(pass1.find((d) => isSpyUnitDoc(d))?.count).toBe(2);
    expect(pass1.find((d) => d.unitType === "infanteria")?.count).toBe(10);

    const legacyAfterPass1 = await t.run(async (ctx) =>
      (ctx.db as any).query("Armyunits").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).collect()
    );
    // Solo queda el registro en cuarentena (ni el vacío ni los 2 válidos)
    expect(legacyAfterPass1).toHaveLength(1);
    expect(legacyAfterPass1[0]._id).toBe(unknownId);
    expect(legacyAfterPass1[0].count).toBe(4);

    // Segunda pasada de migración (idempotencia): no duplica válidos ni elimina el registro en cuarentena
    const pass2 = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(pass2).toHaveLength(2);
    expect(pass2.map((d) => ({ _id: d._id, unitType: d.unitType, count: d.count }))).toEqual(
      pass1.map((d) => ({ _id: d._id, unitType: d.unitType, count: d.count }))
    );

    const legacyAfterPass2 = await t.run(async (ctx) =>
      (ctx.db as any).query("Armyunits").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).collect()
    );
    expect(legacyAfterPass2).toHaveLength(1);
    expect(legacyAfterPass2[0]._id).toBe(unknownId);

    const state = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state.spies.active).toBe(2);
    expect(state.summary.totalActive).toBe(10);
  });
});

// =============================================================================
// DEFECTO RESIDUAL 1: COMPROBACIÓN ESTRICTA DE REINO EN PROCEDENCIA DE MIGRACIÓN
// =============================================================================

describe("Defecto residual 1: comprobación estricta de kingdomId y existencia real en procedencia", () => {
  test("1. Legacy sin kingdomId + canónico con kingdomId: rechazado y no eliminado como duplicado", () => {
    const legacyDoc = {
      _id: "leg-no-kingdom",
      unitType: "espia",
      count: 3,
      migratedToId: "can-k1",
    };
    const canonical = [
      {
        _id: "can-k1",
        kingdomId: "k-1",
        unitType: "espia",
        level: 1,
        count: 3,
        isSpy: true,
        migratedFromLegacyId: "leg-no-kingdom",
      },
    ];

    expect(isLegacyDocRepresentedInCanonical(legacyDoc, canonical)).toBe(false);

    const actions = planArmyUnitsMigration(canonical, [legacyDoc]);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).not.toBe("delete_duplicate_legacy");
    expect(actions[0].kind).toBe("insert_canonical");

    const reconciled = reconcileArmyUnitDocs(canonical, [legacyDoc]);
    expect(reconciled).toHaveLength(2);
  });

  test("2. Canónico sin kingdomId + legacy con kingdomId: rechazado y no eliminado como duplicado", () => {
    const legacyDoc = {
      _id: "leg-k1",
      kingdomId: "k-1",
      unitType: "espia",
      count: 2,
      migratedToId: "can-no-kingdom",
    };
    const canonical = [
      {
        _id: "can-no-kingdom",
        unitType: "espia",
        level: 1,
        count: 2,
        isSpy: true,
        migratedFromLegacyId: "leg-k1",
      },
    ];

    expect(isLegacyDocRepresentedInCanonical(legacyDoc, canonical)).toBe(false);

    const actions = planArmyUnitsMigration(canonical, [legacyDoc]);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).not.toBe("delete_duplicate_legacy");
    expect(actions[0].kind).toBe("insert_canonical");
  });

  test("3. Ambos sin kingdomId: rechazado y no eliminado como duplicado", () => {
    const legacyDoc = {
      _id: "leg-both-missing",
      unitType: "infanteria",
      count: 5,
      migratedToId: "can-both-missing",
      canonicalId: "can-both-missing",
    };
    const canonical = [
      {
        _id: "can-both-missing",
        unitType: "infanteria",
        level: 1,
        count: 5,
        migratedFromLegacyId: "leg-both-missing",
        migratedFromLegacyIds: ["leg-both-missing"],
      },
    ];

    expect(isLegacyDocRepresentedInCanonical(legacyDoc, canonical)).toBe(false);

    const actions = planArmyUnitsMigration(canonical, [legacyDoc]);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).not.toBe("delete_duplicate_legacy");
    expect(actions[0].kind).toBe("insert_canonical");
  });

  test("4 y 8. Ambos con el mismo kingdomId y vínculo válido (migratedFromLegacyId, migratedFromLegacyIds, migratedToId, canonicalId): aceptado y deduplicado", () => {
    const canonical = [
      {
        _id: "can-1",
        kingdomId: "k-1",
        unitType: "espia",
        level: 1,
        count: 4,
        isSpy: true,
        migratedFromLegacyId: "leg-single",
      },
      {
        _id: "can-2",
        kingdomId: "k-1",
        unitType: "infanteria",
        level: 1,
        count: 10,
        migratedFromLegacyIds: ["leg-arr-a", "leg-arr-b"],
      },
      {
        _id: "can-3",
        kingdomId: "k-1",
        unitType: "arqueria",
        level: 1,
        count: 6,
      },
    ];

    const legSingle = { _id: "leg-single", kingdomId: "k-1", unitType: "espia", count: 4 };
    const legArrA = { _id: "leg-arr-a", kingdomId: "k-1", unitType: "infanteria", count: 5 };
    const legArrB = { _id: "leg-arr-b", kingdomId: "k-1", unitType: "infanteria", count: 5 };
    const legMigratedTo = { _id: "leg-to", kingdomId: "k-1", unitType: "arqueria", count: 6, migratedToId: "can-3" };
    const legCanonicalId = { _id: "leg-cid", kingdomId: "k-1", unitType: "arqueria", count: 6, canonicalId: "can-3" };

    for (const leg of [legSingle, legArrA, legArrB, legMigratedTo, legCanonicalId]) {
      expect(isLegacyDocRepresentedInCanonical(leg, canonical)).toBe(true);
    }

    const actions = planArmyUnitsMigration(canonical, [legSingle, legArrA, legArrB, legMigratedTo, legCanonicalId]);
    expect(actions.every((a) => a.kind === "delete_duplicate_legacy")).toBe(true);

    const reconciled = reconcileArmyUnitDocs(canonical, [legSingle, legArrA, legArrB, legMigratedTo, legCanonicalId]);
    expect(reconciled).toHaveLength(3);
  });

  test("5. Ambos con kingdomId distinto: rechazado aunque coincidan los vínculos", () => {
    const legacyDoc = {
      _id: "leg-k1",
      kingdomId: "k-1",
      unitType: "espia",
      count: 3,
      migratedToId: "can-k2",
      canonicalId: "can-k2",
    };
    const canonical = [
      {
        _id: "can-k2",
        kingdomId: "k-2",
        unitType: "espia",
        level: 1,
        count: 3,
        isSpy: true,
        migratedFromLegacyId: "leg-k1",
        migratedFromLegacyIds: ["leg-k1"],
      },
    ];

    expect(isLegacyDocRepresentedInCanonical(legacyDoc, canonical)).toBe(false);

    const actions = planArmyUnitsMigration(canonical, [legacyDoc]);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("insert_canonical");
  });

  test("6 y 7. migratedToId o canonicalId apuntando a documento canónico inexistente: rechazado y el legacy se migra sin pérdida", async () => {
    const canonical = [
      {
        _id: "can-real",
        kingdomId: "k-1",
        unitType: "infanteria",
        level: 1,
        count: 5,
      },
    ];
    const legDanglingMigratedTo = {
      _id: "leg-dangling-1",
      kingdomId: "k-1",
      unitType: "espia",
      count: 2,
      migrated: true,
      migratedToId: "can-inexistente-1",
    };
    const legDanglingCanonicalId = {
      _id: "leg-dangling-2",
      kingdomId: "k-1",
      unitType: "caballeria",
      count: 4,
      migrated: true,
      canonicalId: "can-inexistente-2",
    };

    expect(isLegacyDocRepresentedInCanonical(legDanglingMigratedTo, canonical)).toBe(false);
    expect(isLegacyDocRepresentedInCanonical(legDanglingCanonicalId, canonical)).toBe(false);

    const actions = planArmyUnitsMigration(canonical, [legDanglingMigratedTo, legDanglingCanonicalId]);
    expect(actions.map((a) => a.kind)).toEqual(["insert_canonical", "insert_canonical"]);

    // Verificación transaccional real en Convex: ninguno se descarta como duplicado
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "res1-dangling", "Reino Vínculo Roto");
    await t.run(async (ctx) => {
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
        migrated: true,
        migratedToId: "can-no-existe-tx",
      });
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "caballeria",
        level: 1,
        count: 4,
        migrated: true,
        canonicalId: "can-no-existe-tx-2",
      });
    });

    const migrated = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(migrated).toHaveLength(2);
    const state = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state.spies.active).toBe(2);
    expect(state.summary.totalActive).toBe(4);
  });
});

// =============================================================================
// DEFECTO RESIDUAL 2: NUNCA ELIMINAR REGISTROS HEREDADOS CON DATOS INVÁLIDOS
// =============================================================================

describe("Defecto residual 2: clasificación conservadora y preservación de registros heredados inválidos o parciales", () => {
  test("Clasificador puro: decimales, cadenas, negativos, atributos relevantes sin cantidad e inválidos combinados van a cuarentena; count=0 con wounded>0 es válido", () => {
    // 1. count decimal -> cuarentena (nunca 0 / empty)
    expect(classifyLegacyArmyUnitDoc({ unitType: "infanteria", count: 1.5 }).status).toBe("unrecognized");
    // 2. count cadena numérica -> cuarentena
    expect(classifyLegacyArmyUnitDoc({ unitType: "infanteria", count: "7" as any }).status).toBe("unrecognized");
    // 3. count negativo -> cuarentena
    expect(classifyLegacyArmyUnitDoc({ unitType: "espia", count: -3 }).status).toBe("unrecognized");
    // 4. count NaN -> cuarentena
    expect(classifyLegacyArmyUnitDoc({ unitType: "infanteria", count: Number.NaN }).status).toBe("unrecognized");
    // 5. count ausente con atributos relevantes (mercenario / espía / campo extra) -> cuarentena
    expect(
      classifyLegacyArmyUnitDoc({
        unitType: "infanteria",
        isMercenary: true,
        mercenaryTypeId: "guardia_real",
      }).status
    ).toBe("unrecognized");
    expect(
      classifyLegacyArmyUnitDoc({
        unitType: "infanteria",
        legacyCustomMeta: "conservar",
      } as any).status
    ).toBe("unrecognized");
    // 6. wounded inválido (decimal / cadena / negativo) -> cuarentena
    expect(classifyLegacyArmyUnitDoc({ unitType: "infanteria", count: 0, wounded: 1.5 }).status).toBe("unrecognized");
    expect(classifyLegacyArmyUnitDoc({ unitType: "infanteria", count: 2, wounded: "2" as any }).status).toBe("unrecognized");
    expect(classifyLegacyArmyUnitDoc({ unitType: "infanteria", count: 2, wounded: -1 }).status).toBe("unrecognized");
    // 7. count: 0 con wounded > 0 entero válido -> válido (preserva heridos)
    const woundedOnly = classifyLegacyArmyUnitDoc({ unitType: "infanteria", level: 2, count: 0, wounded: 4 });
    expect(woundedOnly.status).toBe("valid");
    if (woundedOnly.status === "valid") {
      expect(woundedOnly.payload).toMatchObject({
        unitType: "infanteria",
        level: 2,
        count: 0,
        wounded: 4,
        isSpy: false,
      });
    }
    // 8. count y wounded ausentes con atributos relevantes -> cuarentena
    expect(classifyLegacyArmyUnitDoc({ isSpy: true }).status).toBe("unrecognized");
    expect(classifyLegacyArmyUnitDoc({ unitType: "infanteria", recoveryProgress: 0.4 }).status).toBe("unrecognized");
    // 9. unitType desconocido con count / wounded / isMercenary / isSpy -> cuarentena
    expect(classifyLegacyArmyUnitDoc({ unitType: "alabardero_v0", count: 5 }).status).toBe("unrecognized");
    expect(classifyLegacyArmyUnitDoc({ unitType: "alabardero_v0", count: 0, wounded: 3 }).status).toBe("unrecognized");
    expect(classifyLegacyArmyUnitDoc({ unitType: "alabardero_v0", count: 0, isMercenary: true }).status).toBe("unrecognized");
    expect(classifyLegacyArmyUnitDoc({ unitType: "alabardero_v0", count: 0, isSpy: true }).status).toBe("unrecognized");
    // 10. Combinación de campos válidos e inválidos (ej. count válido + level fuera de rango o contractEndsAt inválido) -> cuarentena
    expect(classifyLegacyArmyUnitDoc({ unitType: "espia", count: 2, level: 9 }).status).toBe("unrecognized");
    expect(
      classifyLegacyArmyUnitDoc({ unitType: "infanteria", count: 3, contractEndsAt: "2026-12-01" as any }).status
    ).toBe("unrecognized");
    // 11. Realmente vacío sin atributos relevantes -> empty
    expect(classifyLegacyArmyUnitDoc({ unitType: "infanteria", count: 0, wounded: 0 }).status).toBe("empty");
    expect(classifyLegacyArmyUnitDoc({ count: 0 }).status).toBe("empty");
  });

  test("Migración transaccional real: preserva intactos en Armyunits los registros inválidos, migra count=0 con wounded>0 y es idempotente", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "res2-tx", "Reino Cuarentena Estricta");

    const inserted = await t.run(async (ctx) => {
      const idDecimal = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "infanteria",
        count: 1.5,
      });
      const idStringCount = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        count: "7",
      });
      const idNegative = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "arqueria",
        count: -3,
      });
      const idNoCountMerc = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "infanteria",
        isMercenary: true,
        mercenaryTypeId: "guardia_legacy",
      });
      const idInvalidWounded = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "infanteria",
        count: 2,
        wounded: "3",
      });
      const idAbsentBothSpy = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        isSpy: true,
      });
      const idUnknownAttr = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "piquero_antiguo",
        count: 0,
        isMercenary: true,
      });
      const idMixedInvalid = await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        count: 2,
        level: 9,
      });
      // Registro válido solo con heridos (count: 0, wounded: 4) -> DEBE migrar conservando heridos
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "infanteria",
        level: 1,
        count: 0,
        wounded: 4,
      });
      // Registro válido de espías -> DEBE migrar
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 3,
      });
      // Registro genuinamente vacío -> único elegible para borrado
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "infanteria",
        count: 0,
        wounded: 0,
      });

      return {
        quarantinedIds: [
          idDecimal,
          idStringCount,
          idNegative,
          idNoCountMerc,
          idInvalidWounded,
          idAbsentBothSpy,
          idUnknownAttr,
          idMixedInvalid,
        ],
      };
    });

    // Primera pasada transaccional
    const pass1 = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(pass1).toHaveLength(2);
    const woundedDoc = pass1.find((d) => d.unitType === "infanteria");
    const spyDoc = pass1.find((d) => isSpyUnitDoc(d));
    expect(woundedDoc).toMatchObject({ unitType: "infanteria", count: 0, wounded: 4, isSpy: false });
    expect(spyDoc).toMatchObject({ unitType: "espia", count: 3, isSpy: true });

    // Los 8 registros inválidos/sospechosos deben permanecer intactos en Armyunits
    const legacyAfterPass1 = await t.run(async (ctx) =>
      (ctx.db as any).query("Armyunits").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).collect()
    );
    expect(legacyAfterPass1).toHaveLength(8);
    expect(new Set(legacyAfterPass1.map((d: any) => d._id))).toEqual(new Set(inserted.quarantinedIds));

    // Segunda pasada: idempotencia total (ni duplica válidos ni borra los 8 registros en cuarentena)
    const pass2 = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(pass2).toHaveLength(2);
    expect(pass2.map((d) => ({ _id: d._id, count: d.count, wounded: d.wounded }))).toEqual(
      pass1.map((d) => ({ _id: d._id, count: d.count, wounded: d.wounded }))
    );
    const legacyAfterPass2 = await t.run(async (ctx) =>
      (ctx.db as any).query("Armyunits").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).collect()
    );
    expect(legacyAfterPass2).toHaveLength(8);

    // Consulta real getArmyState: solo cuenta los 3 espías y los 4 heridos válidos; jamás los 8 en cuarentena
    const state = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state.spies.active).toBe(3);
    expect(state.summary.totalActive).toBe(0);
    expect(state.summary.totalWounded).toBe(4);
  });
});

// =============================================================================
// PROTECCIÓN INTEGRAL DE REGISTROS HEREDADOS — VALIDACIÓN CONSERVADORA DE TODOS LOS CAMPOS
// =============================================================================

describe("Protección integral de registros heredados: validación de todos los campos conocidos, procedencia y atributos adicionales", () => {
  test("3.1 Clasificador conservador: todos los 15 escenarios obligatorios sin mutar el documento original", () => {
    const assertQuarantinedUntouched = (doc: Record<string, unknown>) => {
      const snapshot = structuredClone(doc);
      const res = classifyLegacyArmyUnitDoc(doc as any);
      expect(res.status).toBe("unrecognized");
      // El clasificador nunca muta ni normaliza el documento original
      expect(doc).toEqual(snapshot);
    };

    // 1. count: 0 y isSpy: "true"
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, isSpy: "true" });
    // 2. count: 0 y isSpy: 1
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, isSpy: 1 });
    // 3. count: 0 y isMercenary: "false"
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, isMercenary: "false" });
    // 4. count: 0 y isMercenary: 1
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, isMercenary: 1 });
    // 5. count: 0 y legacy con valores relevantes (true, cadena, número u objeto)
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, legacy: true });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, legacy: "v0_origen" });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, legacy: 1 });
    // 6. count: 0 y level inválido (9, -1, 1.5, "2")
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, level: 9 });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, level: -1 });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, level: 1.5 });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, level: "2" });
    // 7. count: 0 y recoveryProgress inválido (<0, >=1, cadena)
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, recoveryProgress: -0.1 });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, recoveryProgress: 1 });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, recoveryProgress: 1.5 });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, recoveryProgress: "0.5" });
    // 8. count: 0 y contractEndsAt inválido (cadena, 0, negativo, NaN)
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, contractEndsAt: "2026-12-01" });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, contractEndsAt: 0 });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, contractEndsAt: -500 });
    // 9. count: 0 y mercenaryTypeId inválido (número, cadena vacía, o sin isMercenary: true)
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, mercenaryTypeId: 42 });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, mercenaryTypeId: "" });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, mercenaryTypeId: "guardia" });
    // 10. Campos adicionales desconocidos con información (con count: 0 y también con count > 0)
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, notaHistorica: "batalla_sur" });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, metadataExtra: { origen: "v1" } });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 5, atributoNoCanonico: "no_descartar" });
    // 11. Campos de procedencia de migración inválidos o con metadatos sin destino canónico verificado
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, migrated: "true" });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, migrated: 1 });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, migrated: true });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, migratedToId: 12345 });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, migratedToId: "" });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, migratedToId: "canon_sin_confirmar" });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, canonicalId: 999 });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, migratedFromLegacyId: 77 });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, migratedFromLegacyIds: "no_es_array" });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, migratedFromLegacyIds: [123] });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, migrationAmbiguous: "yes" });
    // 12. Combinaciones de campos válidos e inválidos (y contradicciones semánticas)
    assertQuarantinedUntouched({ unitType: "espia", count: 0, isSpy: false });
    assertQuarantinedUntouched({ unitType: "espia", count: 3, isMercenary: true });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 4, isSpy: "true" });
    assertQuarantinedUntouched({ unitType: "infanteria", count: "0" });
    assertQuarantinedUntouched({ unitType: "infanteria", count: 0, wounded: "0" });
    // 13. Documentos realmente vacíos que SÍ cumplen todos los criterios de 'empty'
    expect(classifyLegacyArmyUnitDoc({ unitType: "infanteria", count: 0, wounded: 0 }).status).toBe("empty");
    expect(
      classifyLegacyArmyUnitDoc({
        unitType: "arqueria",
        level: 1,
        count: 0,
        wounded: 0,
        isSpy: false,
        isMercenary: false,
        recoveryProgress: 0,
        legacy: false,
        migrated: false,
      }).status
    ).toBe("empty");
    // 14. Documentos con count: 0 y wounded positivo entero -> válidos y migrables
    const validWounded = classifyLegacyArmyUnitDoc({
      unitType: "caballeria",
      level: 3,
      count: 0,
      wounded: 6,
      recoveryProgress: 0.25,
    });
    expect(validWounded.status).toBe("valid");
    if (validWounded.status === "valid") {
      expect(validWounded.payload).toEqual({
        unitType: "caballeria",
        level: 3,
        count: 0,
        wounded: 6,
        recoveryProgress: 0.25,
        isSpy: false,
      });
    }
    // 15. Documentos con tipo de unidad desconocido -> cuarentena
    assertQuarantinedUntouched({ unitType: "catapulta_v0", count: 0 });
    assertQuarantinedUntouched({ unitType: "catapulta_v0", count: 2 });
    assertQuarantinedUntouched({ unitType: null, count: 0 });
  });

  test("3.2 Migración transaccional real: preserva bit a bit todos los documentos en cuarentena en Armyunits, migra válidos, limpia solo vacíos y es idempotente", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "prot-int-32", "Reino Integridad Total");

    const quarantinePayloads: Array<Record<string, unknown>> = [
      { kingdomId, unitType: "infanteria", count: 0, isSpy: "true" },
      { kingdomId, unitType: "infanteria", count: 0, isSpy: 1 },
      { kingdomId, unitType: "infanteria", count: 0, isMercenary: "false" },
      { kingdomId, unitType: "infanteria", count: 0, isMercenary: 1 },
      { kingdomId, unitType: "infanteria", count: 0, legacy: "v0_historico" },
      { kingdomId, unitType: "infanteria", count: 0, legacy: true },
      { kingdomId, unitType: "infanteria", count: 0, level: 9 },
      { kingdomId, unitType: "infanteria", count: 0, level: -1 },
      { kingdomId, unitType: "infanteria", count: 0, level: 1.5 },
      { kingdomId, unitType: "infanteria", count: 0, recoveryProgress: 1.25 },
      { kingdomId, unitType: "infanteria", count: 0, recoveryProgress: "0.3" },
      { kingdomId, unitType: "infanteria", count: 0, contractEndsAt: "2026-12-31" },
      { kingdomId, unitType: "infanteria", count: 0, mercenaryTypeId: 999 },
      { kingdomId, unitType: "infanteria", count: 0, campoDesconocido: "no_borrar", extraNum: 42 },
      { kingdomId, unitType: "infanteria", count: 0, migrated: "true", migratedToId: 123 },
      { kingdomId, unitType: "infanteria", count: 0, migratedFromLegacyIds: "invalido" },
      { kingdomId, unitType: "espia", count: 2, isSpy: false },
      { kingdomId, unitType: "infanteria", count: "0", wounded: "0" },
      { kingdomId, unitType: "ballestero_v0", count: 3 },
    ];

    const originalQuarantinedDocs = await t.run(async (ctx) => {
      const saved: Array<Record<string, unknown>> = [];
      for (const payload of quarantinePayloads) {
        const id = await (ctx.db as any).insert("Armyunits", payload);
        const doc = await (ctx.db as any).get(id);
        saved.push(structuredClone(doc));
      }
      // 2 registros válidos: uno con count: 0 y wounded: 5, y otro de espías válidos
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "infanteria",
        level: 2,
        count: 0,
        wounded: 5,
        recoveryProgress: 0.5,
      });
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 2,
      });
      // 1 registro genuinamente vacío (único elegible para eliminación)
      await (ctx.db as any).insert("Armyunits", {
        kingdomId,
        unitType: "arqueria",
        level: 1,
        count: 0,
        wounded: 0,
        isSpy: false,
        isMercenary: false,
      });
      return saved;
    });

    // Verificar coherencia antes de migrar: readArmyUnitDocs (reconcileArmyUnitDocs) solo ve los 2 válidos
    const beforeState = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(beforeState.spies.active).toBe(2);
    expect(beforeState.summary.totalActive).toBe(0);
    expect(beforeState.summary.totalWounded).toBe(5);

    // Primera ejecución real de la migración
    const pass1 = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(pass1).toHaveLength(2);
    expect(pass1.find((d) => d.unitType === "infanteria")).toMatchObject({
      unitType: "infanteria",
      level: 2,
      count: 0,
      wounded: 5,
      recoveryProgress: 0.5,
      isSpy: false,
    });
    expect(pass1.find((d) => isSpyUnitDoc(d))).toMatchObject({
      unitType: "espia",
      level: 1,
      count: 2,
      isSpy: true,
    });

    // Comprobar conservación ÍNTEGRA (mismo _id, mismos campos y mismos valores exactos) en Armyunits
    const legacyAfterPass1 = await t.run(async (ctx) =>
      (ctx.db as any).query("Armyunits").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).collect()
    );
    expect(legacyAfterPass1).toHaveLength(originalQuarantinedDocs.length);
    for (const orig of originalQuarantinedDocs) {
      const persisted = legacyAfterPass1.find((d: any) => d._id === orig._id);
      expect(persisted).toBeDefined();
      expect(persisted).toEqual(orig);
    }

    // Segunda ejecución: idempotencia total (ni duplica canónicos ni modifica o elimina cuarentena)
    const pass2 = await t.run(async (ctx) => readArmyUnitsWithMigration(ctx as any, kingdomId));
    expect(pass2).toHaveLength(2);
    expect(pass2).toEqual(pass1);

    const legacyAfterPass2 = await t.run(async (ctx) =>
      (ctx.db as any).query("Armyunits").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).collect()
    );
    expect(legacyAfterPass2).toHaveLength(originalQuarantinedDocs.length);
    for (const orig of originalQuarantinedDocs) {
      const persisted = legacyAfterPass2.find((d: any) => d._id === orig._id);
      expect(persisted).toEqual(orig);
    }

    // Verificar contadores finales de getArmyState: ninguno de los documentos en cuarentena se contabiliza
    const afterState = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(afterState.spies.active).toBe(2);
    expect(afterState.summary.totalActive).toBe(0);
    expect(afterState.summary.totalWounded).toBe(5);
  });
});

// =============================================================================
// PRUEBAS DE REGRESIÓN OBLIGATORIAS (PARTE 3)
// =============================================================================

describe("Pruebas de regresión del sistema militar y parches de lanzamiento de ataque", () => {
  test("1. Varios documentos del mismo tipo y nivel suman correctamente su disponibilidad y se descuentan de forma distribuida", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "reg-multi-lots", "Reino Múltiples Lotes");
    await setResourcesAndPop(t, kingdomId, { gold: 10000, wood: 10000, food: 10000, stone: 10000, iron: 10000 });

    const targetCellId = "1,0";
    await t.run(async (ctx) => {
      // Crear celda neutral adyacente válida (distancia 1 desde 0,0) y explorada
      await ctx.db.insert("territories", { cellId: "1,0", q: 1, r: 0, terrain: "llanura" });
      await ctx.db.insert("exploredTerritories", { kingdomId, cellId: "1,0", discoveredAt: Date.now() });
      // Lote 1 de infantería nivel 1 (count: 4)
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "infanteria", level: 1, count: 4 });
      // Lote 2 de infantería nivel 1 (count: 6)
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "infanteria", level: 1, count: 6 });
    });

    // Lanzar ataque solicitando 7 unidades (supera lote 1 pero cabe en la suma 4 + 6 = 10)
    const res = await asUser.mutation(api.army.launchAttack, {
      kingdomId,
      cellId: targetCellId,
      units: [{ unitType: "infanteria", level: 1, count: 7 }],
    });
    expect(res.success).toBe(true);

    // Verificar que los lotes restantes suman exactamente 10 - 7 = 3 unidades
    const state = await asUser.query(api.army.getArmyState, { kingdomId });
    const remainingInf = state.units.filter((d: any) => normalizeUnitType(d.unitType) === "infanteria");
    const totalRemaining = remainingInf.reduce((sum: number, d: any) => sum + d.count, 0);
    expect(totalRemaining).toBe(3);
  });

  test("2. Solicitudes repetidas del mismo tipo y nivel se agregan antes de validar disponibilidad", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "reg-repeated-req", "Reino Solicitudes Repetidas");
    await setResourcesAndPop(t, kingdomId, { gold: 10000, wood: 10000, food: 10000, stone: 10000, iron: 10000 });

    await t.run(async (ctx) => {
      await ctx.db.insert("territories", { cellId: "1,0", q: 1, r: 0, terrain: "llanura" });
      await ctx.db.insert("exploredTerritories", { kingdomId, cellId: "1,0", discoveredAt: Date.now() });
      // Total disponible: 5
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "arqueria", level: 1, count: 5 });
    });

    // Enviar dos objetos separados solicitando 3 y 3 (total 6 > 5 disponibles) -> debe fallar por insuficiencia
    await expect(
      asUser.mutation(api.army.launchAttack, {
        kingdomId,
        cellId: "1,0",
        units: [
          { unitType: "arqueria", level: 1, count: 3 },
          { unitType: "arqueria", level: 1, count: 3 },
        ],
      })
    ).rejects.toThrow(/Tropas insuficientes/i);
  });

  test("3. Un documento de infantería con isSpy: true o tipo espía con isSpy: false no pueden utilizarse como tropa ordinaria", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "reg-contradictory", "Reino Contradictorio");
    await setResourcesAndPop(t, kingdomId, { gold: 10000, wood: 10000, food: 10000, stone: 10000, iron: 10000 });

    await t.run(async (ctx) => {
      await ctx.db.insert("territories", { cellId: "1,0", q: 1, r: 0, terrain: "llanura" });
      await ctx.db.insert("exploredTerritories", { kingdomId, cellId: "1,0", discoveredAt: Date.now() });
      // Documento contradictorio 1: infantería pero isSpy: true
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "infanteria", level: 1, count: 10, isSpy: true });
      // Documento contradictorio 2: espía pero isSpy: false
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 5, isSpy: false });
    });

    // Intentar atacar con infantería debe arrojar error de tropas insuficientes (porque el único documento de infantería es espía y está excluido)
    await expect(
      asUser.mutation(api.army.launchAttack, {
        kingdomId,
        cellId: "1,0",
        units: [{ unitType: "infanteria", level: 1, count: 2 }],
      })
    ).rejects.toThrow(/Tropas insuficientes/i);
  });

  test("4. Marcha cancelada o resuelta sin combate devuelve las tropas correctamente a través de refundMarchUnitsToGarrison sin convertir espías", async () => {
    const t = createTestBackend();
    const { kingdomId } = await foundKingdom(t, "reg-refund", "Reino Devolución Marcha");

    await t.run(async (ctx) => {
      // Insertar un espía y verificar que refundMarchUnitsToGarrison lo ignora o no lo crea como infantería
      await (ctx.db as any).insert("armyUnits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 5,
        isSpy: true,
      });
    });

    // Simular llamada directa a resolución de marcha cancelada con unidades mixtas
    const marchId = await t.run(async (ctx) => {
      return await ctx.db.insert("armyMarches", {
        kingdomId,
        targetCellId: "1,1",
        targetQ: 1,
        targetR: 1,
        distance: 1,
        units: [
          { unitType: "infanteria", level: 1, count: 4 },
          { unitType: "espia", level: 1, count: 2 },
        ],
        startedAt: Date.now(),
        durationMs: 1000,
        completesAt: Date.now() + 1000,
        status: "marchando",
      });
    });

    await t.run(async (ctx) => {
      // Forzar cancelación o resolución que devuelva tropas
      await resolveMarch(ctx, marchId);
    });

    const unitsFinal = await t.run(async (ctx) => readArmyUnitDocs(ctx, kingdomId));
    // La infantería (4) debe haberse devuelto correctamente; el espía (2) nunca se convierte en infantería
    const infDoc = unitsFinal.find((d: any) => normalizeUnitType(d.unitType) === "infanteria");
    const spyDoc = unitsFinal.find((d: any) => isSpyUnitDoc(d));
    expect(infDoc.count).toBe(4);
    expect(spyDoc.count).toBe(5); // El espía original sigue intacto y no se alteró por la marcha
  });

  test("5. Identidad, bajas y heridas: applyCasualtiesToArmy (army y parliament) excluye espías y documentos contradictorios", async () => {
    expect(parliamentApplyCasualtiesToArmy).toBe(applyCasualtiesToArmy);

    const t = createTestBackend();
    const { kingdomId } = await foundKingdom(t, "reg-casualties-iso", "Reino Aislamiento Bajas");

    const ids = await t.run(async (ctx) => {
      const normalInfId = await ctx.db.insert("armyUnits", { kingdomId, unitType: "infanteria", level: 2, count: 20, isSpy: false });
      const contradictoryInfId = await ctx.db.insert("armyUnits", { kingdomId, unitType: "infanteria", level: 2, count: 7, isSpy: true });
      const normalSpyId = await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 8, isSpy: true });
      const contradictorySpyId = await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 3, isSpy: false });
      return { normalInfId, contradictoryInfId, normalSpyId, contradictorySpyId };
    });

    await t.run(async (ctx) => {
      await applyCasualtiesToArmy(
        ctx,
        kingdomId,
        { ...emptyComposition(), infanteria: 12, espia: 5 },
        { ...emptyComposition(), infanteria: 6, espia: 2 }
      );
    });

    const docs = await t.run(async (ctx) => ({
      normalInf: await ctx.db.get(ids.normalInfId),
      contradictoryInf: await ctx.db.get(ids.contradictoryInfId),
      normalSpy: await ctx.db.get(ids.normalSpyId),
      contradictorySpy: await ctx.db.get(ids.contradictorySpyId),
    }));

    expect(docs.normalInf?.count).toBe(8);
    expect(docs.normalInf?.wounded).toBe(6);
    expect(docs.contradictoryInf?.count).toBe(7);
    expect(docs.contradictoryInf?.wounded).toBeUndefined();
    expect(docs.normalSpy?.count).toBe(8);
    expect(docs.normalSpy?.wounded).toBeUndefined();
    expect(docs.contradictorySpy?.count).toBe(3);
    expect(docs.contradictorySpy?.wounded).toBeUndefined();
  });

  test("6. launchAttack consolida la composición persistida, conserva niveles y rechaza entradas inválidas sin estados parciales", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "reg-consolidate", "Reino Consolidación");
    await setResourcesAndPop(t, kingdomId, { gold: 10000, wood: 10000, food: 10000, stone: 10000, iron: 10000 });

    await t.run(async (ctx) => {
      await ctx.db.insert("territories", { cellId: "1,0", q: 1, r: 0, terrain: "llanura" });
      await ctx.db.insert("exploredTerritories", { kingdomId, cellId: "1,0", discoveredAt: Date.now() });
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "infanteria", level: 1, count: 4, isSpy: false });
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "infanteria", level: 1, count: 6, isSpy: false });
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "infanteria", level: 3, count: 5, isSpy: false });
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 5, isSpy: true });
    });

    // Rechazos obligatorios antes de descontar nada
    const invalidPayloads = [
      [{ unitType: "espia", level: 1, count: 1 }],
      [{ unitType: "infanteria", level: 0, count: 1 }],
      [{ unitType: "infanteria", level: 6, count: 1 }],
      [{ unitType: "infanteria", level: 1.5, count: 1 }],
      [{ unitType: "infanteria", level: 1, count: 0 }],
      [{ unitType: "infanteria", level: 1, count: -3 }],
      [{ unitType: "infanteria", level: 1, count: 2.5 }],
      [{ unitType: "desconocido", level: 1, count: 1 }],
    ];
    for (const badUnits of invalidPayloads) {
      await expect(
        asUser.mutation(api.army.launchAttack, { kingdomId, cellId: "1,0", units: badUnits })
      ).rejects.toThrow();
    }

    // Verificar que ningún error dejó estados parciales ni descontó tropas
    const beforeValid = await t.run(async (ctx) => readArmyUnitDocs(ctx, kingdomId));
    const infLvl1Before = beforeValid.filter((d: any) => !isSpyUnitDoc(d) && d.unitType === "infanteria" && (d.level ?? 1) === 1).reduce((s, d) => s + d.count, 0);
    const infLvl3Before = beforeValid.filter((d: any) => !isSpyUnitDoc(d) && d.unitType === "infanteria" && d.level === 3).reduce((s, d) => s + d.count, 0);
    expect(infLvl1Before).toBe(10);
    expect(infLvl3Before).toBe(5);

    // Lanzar ataque con solicitudes repetidas del mismo tipo/nivel y otro nivel distinto
    const res = await asUser.mutation(api.army.launchAttack, {
      kingdomId,
      cellId: "1,0",
      units: [
        { unitType: "infanteria", level: 1, count: 3 },
        { unitType: "infanteria", level: 1, count: 4 },
        { unitType: "infanteria", level: 3, count: 2 },
      ],
    });
    expect(res.success).toBe(true);

    // Comprobar la composición persistida directamente en BD
    const marchDoc = await t.run(async (ctx) => ctx.db.get(res.marchId));
    expect(marchDoc?.units).toEqual([
      { unitType: "infanteria", level: 1, count: 7 },
      { unitType: "infanteria", level: 3, count: 2 },
    ]);

    // Comprobar que las tropas descontadas coinciden exactamente con la composición persistida
    const afterValid = await t.run(async (ctx) => readArmyUnitDocs(ctx, kingdomId));
    const infLvl1After = afterValid.filter((d: any) => !isSpyUnitDoc(d) && d.unitType === "infanteria" && (d.level ?? 1) === 1).reduce((s, d) => s + d.count, 0);
    const infLvl3After = afterValid.filter((d: any) => !isSpyUnitDoc(d) && d.unitType === "infanteria" && d.level === 3).reduce((s, d) => s + d.count, 0);
    const spiesAfter = afterValid.filter((d: any) => isSpyUnitDoc(d)).reduce((s, d) => s + d.count, 0);
    expect(infLvl1After).toBe(3);
    expect(infLvl3After).toBe(3);
    expect(spiesAfter).toBe(5);
  });

  test("7. refundMarchUnitsToGarrison: modo estricto evita devoluciones parciales y modo cuarentena rechaza niveles inválidos y espías sin convertirlos", async () => {
    const t = createTestBackend();
    const { kingdomId } = await foundKingdom(t, "reg-refund-policy", "Reino Política Devolución");

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "infanteria", level: 2, count: 10, isSpy: false });
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 6, isSpy: true });
    });

    // En modo estricto (por defecto), una composición parcialmente corrupta debe lanzar error sin añadir nada
    await expect(
      t.run(async (ctx) =>
        refundMarchUnitsToGarrison(ctx, kingdomId, [
          { unitType: "infanteria", level: 2, count: 5 },
          { unitType: "infanteria", level: 99, count: 2 },
        ])
      )
    ).rejects.toThrow(/invalid_level/i);

    const afterStrictFail = await t.run(async (ctx) => readArmyUnitDocs(ctx, kingdomId));
    const infLvl2Strict = afterStrictFail.find((d: any) => !isSpyUnitDoc(d) && d.unitType === "infanteria" && d.level === 2);
    expect(infLvl2Strict?.count).toBe(10); // Sin devolución parcial

    // En modo quarantine_legacy, devuelve solo las válidas con su nivel exacto y reporta explícitamente las rechazadas
    const legacyInput = [
      { unitType: "infanteria", level: 2, count: 5 },
      { unitType: "infanteria", level: 99, count: 2 }, // NO debe convertirse a nivel 1
      { unitType: "infanteria", level: 1, count: -2 },
      { unitType: "infanteria", level: 1, count: 0 },
      { unitType: "infanteria", level: 1, count: 1.5 },
      { unitType: "espia", level: 1, count: 4 },
      { unitType: "desconocido", level: 1, count: 3 },
    ];
    const parsedCheck = parseMarchUnits(legacyInput);
    expect(parsedCheck.validUnits).toEqual([{ unitType: "infanteria", level: 2, count: 5 }]);
    expect(parsedCheck.rejectedUnits.map((r) => r.reason)).toEqual([
      "invalid_level",
      "invalid_count",
      "invalid_count",
      "invalid_count",
      "spy_not_allowed",
      "unknown_unit_type",
    ]);

    const res = await t.run(async (ctx) =>
      refundMarchUnitsToGarrison(ctx, kingdomId, legacyInput, { invalidEntryPolicy: "quarantine_legacy" })
    );
    expect(res.totalRefunded).toBe(5);
    expect(res.rejectedUnits).toHaveLength(6);

    const afterLegacy = await t.run(async (ctx) => readArmyUnitDocs(ctx, kingdomId));
    const infLvl1 = afterLegacy.filter((d: any) => !isSpyUnitDoc(d) && d.unitType === "infanteria" && (d.level ?? 1) === 1);
    const infLvl2 = afterLegacy.find((d: any) => !isSpyUnitDoc(d) && d.unitType === "infanteria" && d.level === 2);
    const spies = afterLegacy.filter((d: any) => isSpyUnitDoc(d)).reduce((s, d) => s + d.count, 0);
    expect(infLvl1).toHaveLength(0); // Nivel 99 NO fue transformado en nivel 1
    expect(infLvl2?.count).toBe(15); // 10 + 5 exactos en nivel 2
    expect(spies).toBe(6); // Espías intactos
  });

  test("8. Idempotencia real de devoluciones en todas las rutas: conquista neutral, carrera, desafío cancelado, reducción de mapa y concurrencia", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "reg-idemp-routes", "Reino Rutas Idempotentes");
    const { kingdomId: otherKingdomId } = await foundKingdom(t, "reg-idemp-other", "Reino Rival");
    await setResourcesAndPop(t, kingdomId, { gold: 20000, wood: 20000, food: 20000, stone: 20000, iron: 20000 });

    await t.run(async (ctx) => {
      await ctx.db.insert("territories", { cellId: "1,0", q: 1, r: 0, terrain: "llanura" });
      await ctx.db.insert("exploredTerritories", { kingdomId, cellId: "1,0", discoveredAt: Date.now() });
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "infanteria", level: 3, count: 12, isSpy: false });
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 4, isSpy: true });
    });

    // Ruta A: conquista neutral resuelta concurrentemente dos veces vía completeMarchScheduled
    const launchA = await asUser.mutation(api.army.launchAttack, {
      kingdomId,
      cellId: "1,0",
      units: [{ unitType: "infanteria", level: 3, count: 5 }],
    });
    const [rA1, rA2] = await Promise.allSettled([
      t.mutation(internal.army.completeMarchScheduled, { marchId: launchA.marchId }),
      t.mutation(internal.army.completeMarchScheduled, { marchId: launchA.marchId }),
    ]);
    expect(rA1.status).toBe("fulfilled");
    expect(rA2.status).toBe("fulfilled");
    const marchA = await t.run(async (ctx) => ctx.db.get(launchA.marchId));
    expect(marchA?.status).toBe("completada");
    expect(marchA?.unitsRefundedAt).toBeDefined();

    let unitsNow = await t.run(async (ctx) => readArmyUnitDocs(ctx, kingdomId));
    expect(unitsNow.find((d: any) => !isSpyUnitDoc(d) && d.unitType === "infanteria" && d.level === 3)?.count).toBe(12);

    // Ruta B: desafío cancelado (desafio_no_vigente) resuelto dos veces
    const cancelledChallengeId = await t.run(async (ctx) => {
      await ctx.db.insert("territories", { cellId: "2,0", q: 2, r: 0, terrain: "llanura", ownerKingdomId: otherKingdomId });
      return ctx.db.insert("challenges", {
        challengerKingdomId: kingdomId,
        targetKingdomId: otherKingdomId,
        challengeType: "duelo",
        status: "CANCELLED",
        createdAt: Date.now() - 10000,
        expiresAt: Date.now() + 10000,
      });
    });
    const marchBId = await t.run(async (ctx) => {
      const infDoc = (await ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect())
        .find((d) => !isSpyUnitDoc(d) && d.unitType === "infanteria" && d.level === 3)!;
      await ctx.db.patch(infDoc._id, { count: infDoc.count - 4 });
      return ctx.db.insert("armyMarches", {
        kingdomId,
        targetCellId: "2,0",
        targetQ: 2,
        targetR: 0,
        distance: 2,
        units: [{ unitType: "infanteria", level: 3, count: 4 }],
        startedAt: Date.now(),
        durationMs: 1000,
        completesAt: Date.now() + 1000,
        status: "marchando",
        challengeId: cancelledChallengeId,
      });
    });
    await t.mutation(internal.army.completeMarchScheduled, { marchId: marchBId });
    await t.mutation(internal.army.completeMarchScheduled, { marchId: marchBId });
    const marchB = await t.run(async (ctx) => ctx.db.get(marchBId));
    expect(marchB?.status).toBe("cancelada");
    expect(marchB?.unitsRefundedAt).toBeDefined();
    unitsNow = await t.run(async (ctx) => readArmyUnitDocs(ctx, kingdomId));
    expect(unitsNow.find((d: any) => !isSpyUnitDoc(d) && d.unitType === "infanteria" && d.level === 3)?.count).toBe(12);

    // Ruta C: cancelación por reducción de mapa + disparo posterior del scheduler -> devuelve una sola vez
    const marchCId = await t.run(async (ctx) => {
      const infDoc = (await ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect())
        .find((d) => !isSpyUnitDoc(d) && d.unitType === "infanteria" && d.level === 3)!;
      await ctx.db.patch(infDoc._id, { count: infDoc.count - 3 });
      return ctx.db.insert("armyMarches", {
        kingdomId,
        targetCellId: "60,0",
        targetQ: 60,
        targetR: 0,
        distance: 60,
        units: [
          { unitType: "infanteria", level: 3, count: 3 },
          { unitType: "espia", level: 1, count: 2 },
        ],
        startedAt: Date.now(),
        durationMs: 1000,
        completesAt: Date.now() + 1000,
        status: "marchando",
      });
    });
    await t.run(async (ctx) => runMapReduction(ctx, { dryRun: false }));
    await t.mutation(internal.army.completeMarchScheduled, { marchId: marchCId });
    const marchC = await t.run(async (ctx) => ctx.db.get(marchCId));
    expect(marchC?.status).toBe("cancelada");
    expect(marchC?.unitsRefundedAt).toBeDefined();
    unitsNow = await t.run(async (ctx) => readArmyUnitDocs(ctx, kingdomId));
    expect(unitsNow.find((d: any) => !isSpyUnitDoc(d) && d.unitType === "infanteria" && d.level === 3)?.count).toBe(12);
    expect(unitsNow.filter((d: any) => isSpyUnitDoc(d)).reduce((s, d) => s + d.count, 0)).toBe(4);
  });

  test("9. Combate real entre dos reinos: conserva el combate normal, aísla espías en ambos bandos y no duplica supervivientes al reejecutar", async () => {
    const t = createTestBackend();
    const { asUser: asAttacker, kingdomId: attackerId } = await foundKingdom(t, "reg-battle-atk", "Reino Atacante");
    const { kingdomId: defenderId } = await foundKingdom(t, "reg-battle-def", "Reino Defensor");
    await setResourcesAndPop(t, attackerId, { gold: 20000, wood: 20000, food: 20000, stone: 20000, iron: 20000 });

    const now = Date.now();
    const spyIds = await t.run(async (ctx) => {
      await ctx.db.insert("territories", { cellId: "1,1", q: 1, r: 1, terrain: "llanura", ownerKingdomId: defenderId });
      await ctx.db.insert("exploredTerritories", { kingdomId: attackerId, cellId: "1,1", discoveredAt: now });

      // Atacante: tropas reales + espía legítimo + infantería contradictoria con isSpy: true
      await ctx.db.insert("armyUnits", { kingdomId: attackerId, unitType: "infanteria", level: 2, count: 50, isSpy: false });
      const atkSpyId = await ctx.db.insert("armyUnits", { kingdomId: attackerId, unitType: "espia", level: 1, count: 6, isSpy: true });
      const atkContraId = await ctx.db.insert("armyUnits", { kingdomId: attackerId, unitType: "infanteria", level: 2, count: 4, isSpy: true });

      // Defensor: tropas reales + espía legítimo + infantería contradictoria con isSpy: true
      await ctx.db.insert("armyUnits", { kingdomId: defenderId, unitType: "infanteria", level: 1, count: 30, isSpy: false });
      const defSpyId = await ctx.db.insert("armyUnits", { kingdomId: defenderId, unitType: "espia", level: 1, count: 5, isSpy: true });
      const defContraId = await ctx.db.insert("armyUnits", { kingdomId: defenderId, unitType: "infanteria", level: 1, count: 9, isSpy: true });

      // Desafío ACCEPTED listo para combate
      await ctx.db.insert("challenges", {
        challengerKingdomId: attackerId,
        targetKingdomId: defenderId,
        challengeType: "conquista",
        status: "ACCEPTED",
        createdAt: now - 3600_000,
        expiresAt: now + 3600_000,
        respondedAt: now - 1800_000,
        window: "proxima",
        freezeAt: now - 900_000,
        scheduledAt: now - 1000,
      });

      return { atkSpyId, atkContraId, defSpyId, defContraId };
    });

    const launch = await asAttacker.mutation(api.army.launchAttack, {
      kingdomId: attackerId,
      cellId: "1,1",
      units: [
        { unitType: "infanteria", level: 2, count: 20 },
        { unitType: "infanteria", level: 2, count: 30 },
      ],
    });
    expect(launch.success).toBe(true);

    // Ejecutar combate real y comprobar idempotencia ante una segunda invocación
    const res1 = await t.mutation(internal.army.completeMarchScheduled, { marchId: launch.marchId });
    expect(res1?.success).toBe(true);
    expect((res1 as any)?.battleId).toBeDefined();

    const atkUnitsAfterFirst = await t.run(async (ctx) => readArmyUnitDocs(ctx, attackerId));
    const atkInfAfterFirst = atkUnitsAfterFirst.filter((d: any) => !isSpyUnitDoc(d) && d.unitType === "infanteria").reduce((s, d) => s + d.count, 0);

    const res2 = await t.mutation(internal.army.completeMarchScheduled, { marchId: launch.marchId });
    expect(res2).toBeNull();

    const atkUnitsAfterSecond = await t.run(async (ctx) => readArmyUnitDocs(ctx, attackerId));
    const atkInfAfterSecond = atkUnitsAfterSecond.filter((d: any) => !isSpyUnitDoc(d) && d.unitType === "infanteria").reduce((s, d) => s + d.count, 0);
    expect(atkInfAfterSecond).toBe(atkInfAfterFirst); // Sin duplicación de supervivientes

    // Todos los documentos espía (y contradictorios) en ambos bandos permanecen intactos sin bajas ni heridos
    const finalSpies = await t.run(async (ctx) => ({
      atkSpy: await ctx.db.get(spyIds.atkSpyId),
      atkContra: await ctx.db.get(spyIds.atkContraId),
      defSpy: await ctx.db.get(spyIds.defSpyId),
      defContra: await ctx.db.get(spyIds.defContraId),
    }));
    expect(finalSpies.atkSpy?.count).toBe(6);
    expect(finalSpies.atkSpy?.wounded).toBeUndefined();
    expect(finalSpies.atkContra?.count).toBe(4);
    expect(finalSpies.atkContra?.wounded).toBeUndefined();
    expect(finalSpies.defSpy?.count).toBe(5);
    expect(finalSpies.defSpy?.wounded).toBeUndefined();
    expect(finalSpies.defContra?.count).toBe(9);
    expect(finalSpies.defContra?.wounded).toBeUndefined();
  });
});

// =============================================================================
// CIERRE DEFINITIVO PUNTO 1 — RECLUTAMIENTO, MISIONES, CONCURRENCIA Y COHERENCIA
// =============================================================================

describe("Cierre definitivo Punto 1: reclutamiento, misiones, concurrencia y coherencia de estado", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("1. getArmyState.spies devuelve active, wounded, busy, inQueue, occupied, capacity y remaining coherentes en todo el ciclo y recruitSpy contabiliza heridos", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "p1-coherence", "Reino Coherencia");
    await setBuildingLevel(t, kingdomId, "cuartel", 8); // capacidad = floor(8 / 2) = 4 espías
    await setResourcesAndPop(t, kingdomId, { gold: 50000, food: 50000, wood: 50000, stone: 50000, iron: 50000, available: 100 });

    // 1 espía activo + 1 espía herido en BD
    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", {
        kingdomId,
        unitType: "espia",
        level: 1,
        count: 1,
        wounded: 1,
        isSpy: true,
      });
    });

    // Estado inicial: active=1, wounded=1, busy=0, inQueue=0, occupied=2, capacity=4, remaining=2
    let state = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state.spies).toMatchObject({
      active: 1,
      wounded: 1,
      busy: 0,
      inQueue: 0,
      occupied: 2,
      capacity: 4,
      remaining: 2,
      cuartelLevel: 8,
    });

    // Intentar reclutar 3 debe fallar porque 1 activo + 1 herido + 3 = 5 > 4
    await expect(
      asUser.mutation(api.army.recruitSpy, { kingdomId, count: 3 })
    ).rejects.toThrow(/Capacidad de espías excedida/i);

    // Reclutar 2 encaja exactamente (occupied = 4, remaining = 0)
    await asUser.mutation(api.army.recruitSpy, { kingdomId, count: 2 });
    state = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state.spies).toMatchObject({
      active: 1,
      wounded: 1,
      busy: 0,
      inQueue: 2,
      occupied: 4,
      capacity: 4,
      remaining: 0,
    });

    // Enviar el único espía activo a una expedición en celda no explorada (distancia 2) -> active=0, busy=1, occupied=4, remaining=0
    const targetId = "2,0";
    await t.run(async (ctx) => {
      await ctx.db.insert("territories", { cellId: targetId, q: 2, r: 0, terrain: "llanura" });
    });

    const launchRes = await asUser.mutation(api.territories.startExploration, {
      kingdomId,
      cellId: targetId,
      spiesCount: 1,
    });
    expect(launchRes.success).toBe(true);

    state = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state.spies).toMatchObject({
      active: 0,
      wounded: 1,
      busy: 1,
      inQueue: 2,
      occupied: 4,
      capacity: 4,
      remaining: 0,
    });

    // Cancelar la expedición devuelve el espía: active=1, busy=0, occupied=4, remaining=0
    await asUser.mutation(api.territories.cancelExploration, {
      kingdomId,
      expeditionId: launchRes.expeditionId,
    });
    state = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state.spies).toMatchObject({
      active: 1,
      wounded: 1,
      busy: 0,
      inQueue: 2,
      occupied: 4,
      capacity: 4,
      remaining: 0,
    });
  });

  test("2. military:trainUnits rechaza payloads manipulados de espía y resolveCompletedTrainings conserva isSpy:true y level:1 al incorporar espías vencidos", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "p1-mil-iso", "Reino Aislamiento Militar");
    await setBuildingLevel(t, kingdomId, "cuartel", 2);
    await setResourcesAndPop(t, kingdomId, { gold: 50000, food: 50000, wood: 50000, stone: 50000, iron: 50000, available: 100 });

    for (const manipulated of ["espia", "ESPIA", " espia ", "EspIa"]) {
      await expect(
        asUser.mutation(api.military.trainUnits, {
          kingdomId,
          unitType: manipulated,
          count: 1,
        })
      ).rejects.toThrow(/espías/i);
    }

    // Si existe una entrada vencida de espía en trainingQueue, resolveCompletedTrainings debe incorporarla canónicamente con isSpy:true y level:1
    await t.run(async (ctx) => {
      await ctx.db.insert("trainingQueue", {
        kingdomId,
        unitType: "espia",
        level: 3, // incluso si viniera con nivel alterado, addUnits canónico fuerza level: 1 e isSpy: true
        count: 2,
        startedAt: T0 - 60_000,
        durationMs: 30_000,
      });
    });

    const res = await asUser.mutation(api.military.resolveCompletedTrainings, { kingdomId });
    expect(res.processedCount).toBe(1);

    const units = await t.run(async (ctx) =>
      ctx.db.query("armyUnits").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect()
    );
    const spyDocs = units.filter((u) => isSpyUnitDoc(u));
    expect(spyDocs).toHaveLength(1);
    expect(spyDocs[0]).toMatchObject({
      unitType: "espia",
      level: 1,
      count: 2,
      isSpy: true,
    });

    // Los espías NO se suman a regularSoldiers del reino
    const kingdomDoc = await t.run(async (ctx) => ctx.db.get(kingdomId));
    expect(kingdomDoc?.regularSoldiers ?? 0).toBe(0);
  });

  test("3. parliament:requestEspionageReport rechaza spiesCount inválido (0, negativo, decimal) sin truncar ni silenciar", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "p1-parl-atk", "Reino Parlamento A");
    const { kingdomId: targetKingdomId } = await foundKingdom(t, "p1-parl-def", "Reino Parlamento B");
    await setBuildingLevel(t, kingdomId, "cuartel", 2);
    await setResourcesAndPop(t, kingdomId, { gold: 50000, food: 50000, wood: 50000, stone: 50000, iron: 50000, available: 50 });

    await t.run(async (ctx) => {
      await ctx.db.insert("technologyProgress", {
        kingdomId,
        technologyId: "espionage_1",
        status: "completed",
      });
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 3, isSpy: true });
    });

    for (const invalidCount of [0, -1, 1.5]) {
      await expect(
        asUser.mutation(api.parliament.requestEspionageReport, {
          kingdomId,
          targetKingdomId,
          spiesCount: invalidCount,
        })
      ).rejects.toThrow(/entero positivo/i);
    }

    // Los 3 espías siguen intactos
    const state = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state.spies.active).toBe(3);
  });

  test("4. Carrera entre cancelExploration y completeExplorationScheduled devuelve el espía una sola vez sin duplicación ni pérdida", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "p1-race-cancel", "Reino Carrera Cancelación");
    await setBuildingLevel(t, kingdomId, "cuartel", 4);
    await setResourcesAndPop(t, kingdomId, { gold: 50000, food: 50000, wood: 50000, stone: 50000, iron: 50000, available: 50 });

    const targetId = "2,0";
    await t.run(async (ctx) => {
      await ctx.db.insert("territories", { cellId: targetId, q: 2, r: 0, terrain: "llanura" });
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "espia", level: 1, count: 2, isSpy: true });
    });

    const launchRes = await asUser.mutation(api.territories.startExploration, {
      kingdomId,
      cellId: targetId,
      spiesCount: 2,
    });
    expect(launchRes.success).toBe(true);

    // Ejecutar cancelación y finalización programada concurrentemente
    const settled = await Promise.allSettled([
      asUser.mutation(api.territories.cancelExploration, {
        kingdomId,
        expeditionId: launchRes.expeditionId,
      }),
      t.mutation(internal.territories.completeExplorationScheduled, {
        expeditionId: launchRes.expeditionId,
      }),
    ]);

    // Al menos una ganó y la otra fue idempotente o rechazada limpiamente
    expect(settled.some((r) => r.status === "fulfilled")).toBe(true);

    // La expedición fue eliminada y los espías activos vuelven a ser EXACTAMENTE 2 (jamás 0 ni 4)
    const remainingExp = await t.run(async (ctx) => ctx.db.get(launchRes.expeditionId));
    expect(remainingExp).toBeNull();

    const state = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state.spies.active).toBe(2);
    expect(state.spies.busy).toBe(0);
    expect(state.spies.occupied).toBe(2);
  });

  test("5. completeExplorationScheduled limpia una expedición huérfana si el reino ya no existe", async () => {
    const t = createTestBackend();
    const { kingdomId } = await foundKingdom(t, "p1-orphan-exp", "Reino Temporal");
    const target = hexNeighbors({ q: 0, r: 0 })[0];
    const targetId = cellId(target.q, target.r);

    const expeditionId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("explorationQueue", {
        kingdomId,
        cellId: targetId,
        targetQ: target.q,
        targetR: target.r,
        distance: 1,
        scoutsCount: 1,
        startedAt: T0,
        durationMs: 10_000,
        completesAt: T0 + 10_000,
        costs: { gold: 0, food: 0 },
        isSpyMission: true,
      });
      // Eliminar el reino para simular expedición huérfana
      await ctx.db.delete(kingdomId);
      return id;
    });

    const result = await t.mutation(internal.territories.completeExplorationScheduled, { expeditionId });
    expect(result).toBeNull();

    // La entrada huérfana debe haberse limpiado de explorationQueue
    const stillExists = await t.run(async (ctx) => ctx.db.get(expeditionId));
    expect(stillExists).toBeNull();
  });
});



