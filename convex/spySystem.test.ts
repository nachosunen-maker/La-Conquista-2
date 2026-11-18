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
import { createSpyRecruitmentPlan, isSpyUnitDoc, summarizeArmy } from "./armyRules";
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
    expect(spyDocs).toHaveLength(1);
    expect(spyDocs[0].unitType).toBe("espia");
    expect(spyDocs[0].isSpy).toBe(true);
    expect(spyDocs[0].level).toBe(1);
    expect(spyDocs[0].count).toBe(2);
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
