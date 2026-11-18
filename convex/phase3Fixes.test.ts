import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAP } from "./balanceConfig";
import {
  canonicalWorldCellCount,
  generateWorldCells,
  hexDistance,
  inspectWorldIntegrity,
  isInsideWorld,
} from "./territoryRules";
import { readWorld } from "./territories";

const modules = import.meta.glob("./**/*.ts");
const T0 = Date.UTC(2026, 9, 17, 12, 0, 0);

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

async function setBuilding(
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
    if (doc) await ctx.db.patch(doc._id, { level });
    else await ctx.db.insert("buildings", { kingdomId, buildingType, level });
  });
}

async function totalInfantry(t: ReturnType<typeof createTestBackend>, kingdomId: Id<"kingdoms">) {
  return t.run(async (ctx) => {
    const units = await ctx.db
      .query("armyUnits")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .collect();
    return units
      .filter((u) => u.unitType === "infanteria")
      .reduce((sum, u) => sum + (u.count ?? 0), 0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// BLOQUE A — MAPA MUNDIAL: EXACTAMENTE 7.651 CELDAS (RADIO 50)
// ============================================================================
describe("Fase 3 — Bloque A: Mapa mundial canónico de exactamente 7.651 celdas (radio 50)", () => {
  test("configuración, determinismo, unicidad, geometría hexagonal completa y ausencia de celdas exteriores", () => {
    expect(MAP.RADIUS).toBe(50);
    expect(MAP.MAX_CELLS).toBe(7651);
    expect(MAP.HISTORICAL_RADIUS).toBe(10);
    expect(MAP.HISTORICAL_CELLS).toBe(331);
    expect(canonicalWorldCellCount(MAP.RADIUS)).toBe(7651);
    expect(canonicalWorldCellCount(MAP.HISTORICAL_RADIUS)).toBe(331);

    const run1 = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
    const run2 = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);

    expect(run1).toHaveLength(7651);
    expect(run2).toEqual(run1);

    const seen = new Set<string>();
    let maxDist = 0;
    for (const cell of run1) {
      expect(seen.has(cell.cellId)).toBe(false);
      seen.add(cell.cellId);
      const d = hexDistance(cell, { q: 0, r: 0 });
      expect(d).toBeLessThanOrEqual(50);
      expect(isInsideWorld(cell, MAP.RADIUS)).toBe(true);
      if (d > maxDist) maxDist = d;
    }
    expect(seen.size).toBe(7651);
    expect(maxDist).toBe(50);

    // Los 6 vértices exactos del hexágono de radio 50 deben existir
    for (const corner of ["50,0", "-50,0", "0,50", "0,-50", "50,-50", "-50,50"]) {
      expect(seen.has(corner)).toBe(true);
    }
    // Ninguna coordenada de distancia 51 puede estar presente
    expect(seen.has("51,0")).toBe(false);
    expect(isInsideWorld({ q: 51, r: 0 }, MAP.RADIUS)).toBe(false);
  });

  test("ensureWorld valida correspondencia real (no solo conteo), es idempotente y readWorld proyecta siempre 7.651 celdas", async () => {
    const t = createTestBackend();
    const k = await foundKingdom(t, "map-a-user", "Reino Cartográfico");

    // Sembrar mapa corrupto con 7.652 filas (>= 7.651):
    // faltan 2 celdas canónicas ("50,0" y "-50,0"), pero sobran 1 duplicado ("1,0") y 2 exteriores ("51,0", "52,0")
    await t.run(async (ctx) => {
      const canonical = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
      const existing = await ctx.db.query("territories").collect();
      const already = new Set(existing.map((c) => c.cellId));

      for (const cell of canonical) {
        if (cell.cellId === "50,0" || cell.cellId === "-50,0") continue;
        if (already.has(cell.cellId)) continue;
        await ctx.db.insert("territories", {
          cellId: cell.cellId,
          q: cell.q,
          r: cell.r,
          terrain: cell.terrain,
        });
      }
      // Registro duplicado interior y registros exteriores sobrantes
      await ctx.db.insert("territories", { cellId: "1,0", q: 1, r: 0, terrain: "llanura" });
      await ctx.db.insert("territories", { cellId: "51,0", q: 51, r: 0, terrain: "bosque" });
      await ctx.db.insert("territories", { cellId: "52,0", q: 52, r: 0, terrain: "colina" });

      const rows = await ctx.db.query("territories").collect();
      expect(rows.length).toBeGreaterThanOrEqual(MAP.MAX_CELLS);

      const beforeIntegrity = inspectWorldIntegrity(rows, MAP.RADIUS, MAP.WORLD_SEED);
      expect(beforeIntegrity.isComplete).toBe(false);
      expect(beforeIntegrity.missingCellIds.sort()).toEqual(["-50,0", "50,0"]);
      expect(beforeIntegrity.duplicateCellIds).toEqual(["1,0"]);
      expect(beforeIntegrity.outOfBoundsCellIds.sort()).toEqual(["51,0", "52,0"]);
    });

    // ensureWorld / expandWorld NO debe conformarse con rows.length >= 7651: debe insertar las 2 faltantes
    const expand1: any = await t.mutation(internal.territories.expandWorld, {});
    expect(expand1.added).toBe(2);
    expect(expand1.canonicalCells).toBe(7651);
    expect(expand1.missingCanonicalCells).toBe(0);
    expect(expand1.isComplete).toBe(true);
    expect(expand1.duplicateRecords).toBe(1);
    expect(expand1.outOfBoundsRecords).toBe(2);

    // Segunda ejecución: estrictamente idempotente (0 añadidas)
    const expand2: any = await t.mutation(internal.territories.expandWorld, {});
    expect(expand2.added).toBe(0);

    // readWorld devuelve EXACTAMENTE 7.651 celdas canónicas únicas, sin duplicados ni exteriores
    await t.run(async (ctx) => {
      const world = await readWorld(ctx);
      expect(world).toHaveLength(7651);
      const ids = new Set(world.map((c) => c.cellId));
      expect(ids.size).toBe(7651);
      expect(ids.has("50,0")).toBe(true);
      expect(ids.has("-50,0")).toBe(true);
      expect(ids.has("51,0")).toBe(false);
      expect(ids.has("52,0")).toBe(false);
      // Preserva la capital del reino fundado
      const capital = world.find((c) => c.ownerKingdomId === k.kingdomId && c.isHome);
      expect(capital).toBeDefined();
    });

    // Reducción del mapa elimina SOLO las 2 exteriores (> 50) y conserva intactas las 7.651 canónicas (incluido borde radio 50)
    const red: any = await t.mutation(internal.mapReduction.executeMapReduction, { dryRun: false });
    expect(red.territoriesDeleted).toBe(2);

    await t.run(async (ctx) => {
      const rowsAfter = await ctx.db.query("territories").collect();
      const report = inspectWorldIntegrity(rowsAfter, MAP.RADIUS, MAP.WORLD_SEED);
      expect(report.isComplete).toBe(true);
      expect(report.uniqueCanonicalPresent).toBe(7651);
      expect(report.outOfBoundsCellIds).toHaveLength(0);
    });
  });
});

// ============================================================================
// BLOQUE B — REDUCCIÓN DEL MAPA Y SEGURIDAD DE LAS TROPAS
// ============================================================================
describe("Fase 3 — Bloque B: Reducción del mapa sin duplicación de tropas y coherencia de desafíos", () => {
  test("distingue estados de marcha, devuelve tropas solo una vez, cancela desafío vinculado sin tocar ajenos y resiste re-ejecución/concurrencia", async () => {
    const t = createTestBackend();
    const atk = await foundKingdom(t, "red-b-atk", "Reino Expedicionario");
    const def = await foundKingdom(t, "red-b-def", "Reino Exterior");

    await setBuilding(t, atk.kingdomId, "parlamento", 1);
    await setBuilding(t, def.kingdomId, "parlamento", 1);

    let activeMarchId!: Id<"armyMarches">;
    let completedMarchId!: Id<"armyMarches">;
    let cancelledMarchId!: Id<"armyMarches">;
    let alreadyRefundedMarchId!: Id<"armyMarches">;
    let linkedMarchId!: Id<"armyMarches">;
    let linkedChallengeId!: Id<"challenges">;
    let resolvedChallengeId!: Id<"challenges">;
    let unrelatedPendingChallengeId!: Id<"challenges">;

    await t.run(async (ctx) => {
      // Base inicial en guarnición: 100 infantería
      await ctx.db.insert("armyUnits", { kingdomId: atk.kingdomId, unitType: "infanteria", level: 1, count: 100 });

      // 1. Marcha activa exterior (debe cancelarse y devolver +40)
      activeMarchId = await ctx.db.insert("armyMarches", {
        kingdomId: atk.kingdomId,
        targetCellId: "52,0",
        targetQ: 52,
        targetR: 0,
        distance: 52,
        units: [{ unitType: "infanteria", level: 1, count: 40 }],
        startedAt: T0 - 1000,
        durationMs: 10_000,
        completesAt: T0 + 9_000,
        status: "marchando",
      });

      // 2. Marcha completada exterior (NO debe devolver tropas ni borrarse)
      completedMarchId = await ctx.db.insert("armyMarches", {
        kingdomId: atk.kingdomId,
        targetCellId: "53,0",
        targetQ: 53,
        targetR: 0,
        distance: 53,
        units: [{ unitType: "infanteria", level: 1, count: 75 }],
        startedAt: T0 - 20_000,
        durationMs: 10_000,
        completesAt: T0 - 10_000,
        status: "completada",
      });

      // 3. Marcha cancelada exterior (NO debe devolver tropas ni borrarse)
      cancelledMarchId = await ctx.db.insert("armyMarches", {
        kingdomId: atk.kingdomId,
        targetCellId: "54,0",
        targetQ: 54,
        targetR: 0,
        distance: 54,
        units: [{ unitType: "infanteria", level: 1, count: 60 }],
        startedAt: T0 - 15_000,
        durationMs: 10_000,
        completesAt: T0 - 5_000,
        status: "cancelada",
        cancelledAt: T0 - 12_000,
        unitsRefundedAt: T0 - 12_000,
      });

      // 4. Marcha ya procesada (unitsRefundedAt presente, NO debe devolver tropas)
      alreadyRefundedMarchId = await ctx.db.insert("armyMarches", {
        kingdomId: atk.kingdomId,
        targetCellId: "55,0",
        targetQ: 55,
        targetR: 0,
        distance: 55,
        units: [{ unitType: "infanteria", level: 1, count: 50 }],
        startedAt: T0 - 5_000,
        durationMs: 10_000,
        completesAt: T0 + 5_000,
        status: "marchando",
        unitsRefundedAt: T0 - 2_000,
      });

      // 5. Desafío abierto vinculado a una marcha exterior activa (debe pasar a CANCELLED y devolver +30)
      linkedChallengeId = await ctx.db.insert("challenges", {
        challengerKingdomId: atk.kingdomId,
        targetKingdomId: def.kingdomId,
        challengeType: "batalla",
        status: "ACCEPTED",
        createdAt: T0 - 86_400_000,
        expiresAt: T0 + 86_400_000,
        respondedAt: T0 - 80_000_000,
        window: "proxima",
        freezeAt: T0 - 900_000,
        scheduledAt: T0 + 60_000,
      });
      linkedMarchId = await ctx.db.insert("armyMarches", {
        kingdomId: atk.kingdomId,
        targetCellId: "56,0",
        targetQ: 56,
        targetR: 0,
        distance: 56,
        units: [{ unitType: "infanteria", level: 1, count: 30 }],
        startedAt: T0 - 1000,
        durationMs: 10_000,
        completesAt: T0 + 9_000,
        status: "marchando",
        challengeId: linkedChallengeId,
      });
      await ctx.db.patch(linkedChallengeId, { activeMarchId: linkedMarchId, resolutionLockedBy: "march" });

      // 6. Desafío ya resuelto (NO debe alterarse)
      resolvedChallengeId = await ctx.db.insert("challenges", {
        challengerKingdomId: atk.kingdomId,
        targetKingdomId: def.kingdomId,
        challengeType: "batalla",
        status: "RESOLVED",
        createdAt: T0 - 200_000_000,
        expiresAt: T0 - 100_000_000,
        resolvedAt: T0 - 50_000,
      });

      // 7. Desafío pendiente ajeno (NO debe alterarse)
      unrelatedPendingChallengeId = await ctx.db.insert("challenges", {
        challengerKingdomId: def.kingdomId,
        targetKingdomId: atk.kingdomId,
        challengeType: "batalla",
        status: "PENDING",
        createdAt: T0 - 10_000,
        expiresAt: T0 + 86_400_000,
      });
    });

    // dryRun por defecto no modifica nada
    const dry: any = await t.mutation(internal.mapReduction.executeMapReduction, {});
    expect(dry.dryRun).toBe(true);
    expect(dry.marchesCancelled).toBe(2);
    expect(dry.marchesSkippedCompleted).toBe(1);
    expect(dry.marchesSkippedCancelled).toBe(1);
    expect(dry.marchesSkippedAlreadyProcessed).toBe(1);
    expect(dry.challengesCancelled).toBe(1);
    expect(dry.unitsRefunded).toBe(70); // 40 + 30
    expect(await totalInfantry(t, atk.kingdomId)).toBe(100);

    // Dos intentos concurrentes de reducción real: exactamente UNA devolución (+40 + 30 = +70 -> total 170)
    const [r1, r2]: any[] = await Promise.all([
      t.mutation(internal.mapReduction.executeMapReduction, { dryRun: false }),
      t.mutation(internal.mapReduction.executeMapReduction, { dryRun: false }),
    ]);

    expect(r1.marchesCancelled + r2.marchesCancelled).toBe(2);
    expect(r1.unitsRefunded + r2.unitsRefunded).toBe(70);
    expect(r1.challengesCancelled + r2.challengesCancelled).toBe(1);
    expect(await totalInfantry(t, atk.kingdomId)).toBe(170);

    // Verificar estados persistidos e historial preservado (ninguna marcha eliminada)
    await t.run(async (ctx) => {
      const mActive = await ctx.db.get(activeMarchId);
      const mComp = await ctx.db.get(completedMarchId);
      const mCanc = await ctx.db.get(cancelledMarchId);
      const mProc = await ctx.db.get(alreadyRefundedMarchId);
      const mLink = await ctx.db.get(linkedMarchId);

      expect(mActive?.status).toBe("cancelada");
      expect(mActive?.unitsRefundedAt).toBeDefined();
      expect(mComp?.status).toBe("completada");
      expect(mCanc?.status).toBe("cancelada");
      expect(mProc?.unitsRefundedAt).toBe(T0 - 2_000);
      expect(mLink?.status).toBe("cancelada");
      expect(mLink?.unitsRefundedAt).toBeDefined();

      const chLinked = await ctx.db.get(linkedChallengeId);
      const chResolved = await ctx.db.get(resolvedChallengeId);
      const chPending = await ctx.db.get(unrelatedPendingChallengeId);
      expect(chLinked?.status).toBe("CANCELLED");
      expect(chResolved?.status).toBe("RESOLVED");
      expect(chPending?.status).toBe("PENDING");
    });

    // El scheduler intentando congelar o resolver el desafío cancelado debe ser no-op (0 batallas)
    const freezeAfter = await t.mutation(internal.parliament.freezeChallenge, { challengeId: linkedChallengeId });
    const resolveAfter = await t.mutation(internal.parliament.resolveChallenge, { challengeId: linkedChallengeId });
    expect(freezeAfter.frozen).toBe(false);
    expect(resolveAfter.resolved).toBe(false);

    const battlesForLinked = await t.run(async (ctx) =>
      ctx.db.query("Battle").withIndex("by_challenge", (q) => q.eq("challengeId", linkedChallengeId)).collect()
    );
    expect(battlesForLinked).toHaveLength(0);

    // Segunda ejecución secuencial tras completar: 0 cambios y sin tropas duplicadas
    const secondRun: any = await t.mutation(internal.mapReduction.executeMapReduction, { dryRun: false });
    expect(secondRun.marchesCancelled).toBe(0);
    expect(secondRun.unitsRefunded).toBe(0);
    expect(secondRun.challengesCancelled).toBe(0);
    expect(await totalInfantry(t, atk.kingdomId)).toBe(170);
  });
});

// ============================================================================
// BLOQUE C — P38: UNIFICACIÓN DEL FLUJO DE DESAFÍOS Y COMBATE (SCHEDULER REAL)
// ============================================================================
describe("Fase 3 — Bloque C: P38 flujo de combate con scheduler real y garantía de batalla única", () => {
  test("ciclo completo del scheduler (accept -> freeze -> resolve), reintentos idempotentes y bloqueo de marcha manual tras FROZEN/RESOLVED", async () => {
    const t = createTestBackend();
    const atk = await foundKingdom(t, "p38c-atk", "Reino Desafiante");
    const def = await foundKingdom(t, "p38c-def", "Reino Defensor");

    await atk.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: atk.kingdomId });
    await def.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: def.kingdomId });
    const defT = await def.asUser.query(api.territories.getKingdomTerritories, { kingdomId: def.kingdomId });
    const defCapital = defT.homeTerritoryId!;

    await setBuilding(t, atk.kingdomId, "parlamento", 1);
    await setBuilding(t, def.kingdomId, "parlamento", 1);

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: atk.kingdomId, unitType: "infanteria", level: 1, count: 400 });
      await ctx.db.insert("armyUnits", { kingdomId: def.kingdomId, unitType: "infanteria", level: 1, count: 300 });
      await ctx.db.insert("exploredTerritories", { kingdomId: atk.kingdomId, cellId: defCapital, discoveredAt: T0 });
      const popA = await ctx.db.query("population").filter((q) => q.eq(q.field("kingdomId"), atk.kingdomId)).first();
      if (popA) await ctx.db.patch(popA._id, { total: popA.total + 400 });
      const popD = await ctx.db.query("population").filter((q) => q.eq(q.field("kingdomId"), def.kingdomId)).first();
      if (popD) await ctx.db.patch(popD._id, { total: popD.total + 300 });
    });

    // 1. Crear y aceptar desafío -> programa freezeChallenge (scheduledAt - 15m) y resolveChallenge (scheduledAt)
    const created = await atk.asUser.mutation(api.parliament.createChallenge, {
      challengerKingdomId: atk.kingdomId,
      targetKingdomId: def.kingdomId,
      challengeType: "batalla",
    });
    const accepted = await def.asUser.mutation(api.parliament.acceptChallenge, {
      kingdomId: def.kingdomId,
      challengeId: created.challengeId,
      window: "proxima",
    });
    expect(accepted.freezeAt).toBeLessThan(accepted.scheduledAt);

    // 2. Avanzar el reloj justo al momento de congelación (freezeAt) y ejecutar el scheduler hasta ese instante
    vi.advanceTimersByTime(accepted.freezeAt - T0 + 1_000);
    await t.finishInProgressScheduledFunctions();

    const chFrozen = await t.run(async (ctx) => ctx.db.get(created.challengeId));
    expect(chFrozen?.status).toBe("FROZEN");
    expect(chFrozen?.frozen).toBeDefined();

    // 3. Intento de marcha manual mientras está FROZEN -> rechazado
    await expect(
      atk.asUser.mutation(api.army.launchAttack, {
        kingdomId: atk.kingdomId,
        cellId: defCapital,
        units: [{ unitType: "infanteria", level: 1, count: 100 }],
      })
    ).rejects.toThrow(/FROZEN/i);

    // 4. Avanzar hasta scheduledAt y ejecutar el scheduler real para resolveChallenge
    vi.advanceTimersByTime(accepted.scheduledAt - accepted.freezeAt + 5_000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const chResolved = await t.run(async (ctx) => ctx.db.get(created.challengeId));
    expect(chResolved?.status).toBe("RESOLVED");
    expect(chResolved?.battleId).toBeDefined();

    const atkAfterFirst = await totalInfantry(t, atk.kingdomId);
    const defAfterFirst = await totalInfantry(t, def.kingdomId);
    expect(atkAfterFirst).toBeLessThan(400);
    expect(defAfterFirst).toBeLessThan(300);

    // 5. Reintentos repetidos del scheduler (freeze + resolve): idempotentes, 0 batallas extra, 0 bajas extra
    const retryFreeze = await t.mutation(internal.parliament.freezeChallenge, { challengeId: created.challengeId });
    const retryResolve = await t.mutation(internal.parliament.resolveChallenge, { challengeId: created.challengeId });
    expect(retryFreeze.frozen).toBe(false);
    expect(retryResolve.resolved).toBe(false);

    const battles = await t.run(async (ctx) =>
      ctx.db.query("Battle").withIndex("by_challenge", (q) => q.eq("challengeId", created.challengeId)).collect()
    );
    expect(battles).toHaveLength(1);
    expect(await totalInfantry(t, atk.kingdomId)).toBe(atkAfterFirst);
    expect(await totalInfantry(t, def.kingdomId)).toBe(defAfterFirst);
  });

  test("dos rutas compitiendo por el mismo desafío (marcha vs scheduler) producen como máximo 1 batalla y 1 aplicación de bajas", async () => {
    const t = createTestBackend();
    const atk = await foundKingdom(t, "p38race-atk", "Reino Carrera A");
    const def = await foundKingdom(t, "p38race-def", "Reino Carrera B");

    await atk.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: atk.kingdomId });
    await def.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: def.kingdomId });
    const defT = await def.asUser.query(api.territories.getKingdomTerritories, { kingdomId: def.kingdomId });
    const defCapital = defT.homeTerritoryId!;

    await setBuilding(t, atk.kingdomId, "parlamento", 1);
    await setBuilding(t, def.kingdomId, "parlamento", 1);

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: atk.kingdomId, unitType: "infanteria", level: 1, count: 500 });
      await ctx.db.insert("armyUnits", { kingdomId: def.kingdomId, unitType: "infanteria", level: 1, count: 250 });
      await ctx.db.insert("exploredTerritories", { kingdomId: atk.kingdomId, cellId: defCapital, discoveredAt: T0 });
      const popA = await ctx.db.query("population").filter((q) => q.eq(q.field("kingdomId"), atk.kingdomId)).first();
      if (popA) await ctx.db.patch(popA._id, { total: popA.total + 500 });
      const popD = await ctx.db.query("population").filter((q) => q.eq(q.field("kingdomId"), def.kingdomId)).first();
      if (popD) await ctx.db.patch(popD._id, { total: popD.total + 250 });
    });

    // Escenario 1: marcha manual reclama desafío ACCEPTED al llegar scheduledAt -> resolveChallenge del scheduler queda bloqueado
    const ch1 = await t.run(async (ctx) =>
      ctx.db.insert("challenges", {
        challengerKingdomId: atk.kingdomId,
        targetKingdomId: def.kingdomId,
        challengeType: "batalla",
        status: "ACCEPTED",
        createdAt: T0 - 90_000_000,
        expiresAt: T0 + 86_400_000,
        respondedAt: T0 - 86_400_000,
        window: "proxima",
        freezeAt: T0 - 900_000,
        scheduledAt: T0,
      })
    );

    const march = await atk.asUser.mutation(api.army.launchAttack, {
      kingdomId: atk.kingdomId,
      cellId: defCapital,
      units: [{ unitType: "infanteria", level: 1, count: 200 }],
    });

    // Mientras la marcha vuela, resolveChallenge intenta ejecutarse -> DEBE abortar por exclusión mutua
    const competingParliament = await t.mutation(internal.parliament.resolveChallenge, { challengeId: ch1 });
    expect(competingParliament.resolved).toBe(false);

    // Al llegar la marcha -> resuelve exactamente una batalla
    vi.setSystemTime(T0 + march.durationSeconds * 1000 + 2000);
    await t.mutation(internal.army.completeMarchScheduled, { marchId: march.marchId });

    const battlesCh1 = await t.run(async (ctx) =>
      ctx.db.query("Battle").withIndex("by_challenge", (q) => q.eq("challengeId", ch1)).collect()
    );
    expect(battlesCh1).toHaveLength(1);

    // Escenario 2: desafío ya resuelto por Parlamento antes de que llegue una marcha rezagada -> marcha aborta sin bajas y devuelve tropas
    const ch2 = await t.run(async (ctx) =>
      ctx.db.insert("challenges", {
        challengerKingdomId: atk.kingdomId,
        targetKingdomId: def.kingdomId,
        challengeType: "batalla",
        status: "ACCEPTED",
        createdAt: T0 - 90_000_000,
        expiresAt: T0 + 86_400_000,
        respondedAt: T0 - 86_400_000,
        window: "proxima",
        freezeAt: T0 - 900_000,
        scheduledAt: T0,
      })
    );
    const parlRes = await t.mutation(internal.parliament.resolveChallenge, { challengeId: ch2 });
    expect(parlRes.resolved).toBe(true);

    const atkBeforeStaleMarch = await totalInfantry(t, atk.kingdomId);
    const defBeforeStaleMarch = await totalInfantry(t, def.kingdomId);

    const staleMarchId = await t.run(async (ctx) =>
      ctx.db.insert("armyMarches", {
        kingdomId: atk.kingdomId,
        targetCellId: defCapital,
        targetQ: 0,
        targetR: 0,
        distance: 5,
        units: [{ unitType: "infanteria", level: 1, count: 50 }],
        startedAt: T0,
        durationMs: 1000,
        completesAt: T0 + 1000,
        status: "marchando",
        challengeId: ch2,
      })
    );

    const staleRes: any = await t.mutation(internal.army.completeMarchScheduled, { marchId: staleMarchId });
    expect(staleRes.success).toBe(false);
    expect(staleRes.outcome).toBe("desafio_no_vigente");

    // Sigue existiendo 1 única batalla para ch2, el defensor no sufrió segundas bajas y las 50 tropas de la marcha regresaron íntegras
    const battlesCh2 = await t.run(async (ctx) =>
      ctx.db.query("Battle").withIndex("by_challenge", (q) => q.eq("challengeId", ch2)).collect()
    );
    expect(battlesCh2).toHaveLength(1);
    expect(await totalInfantry(t, def.kingdomId)).toBe(defBeforeStaleMarch);
    expect(await totalInfantry(t, atk.kingdomId)).toBe(atkBeforeStaleMarch + 50);

    // Escenario 3: desafío cancelado antes de la tarea programada -> scheduler no crea batalla ni aplica bajas
    const ch3 = await atk.asUser.mutation(api.parliament.createChallenge, {
      challengerKingdomId: atk.kingdomId,
      targetKingdomId: def.kingdomId,
      challengeType: "batalla",
    });
    const acc3 = await def.asUser.mutation(api.parliament.acceptChallenge, {
      kingdomId: def.kingdomId,
      challengeId: ch3.challengeId,
      window: "proxima",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(ch3.challengeId, { status: "CANCELLED", cancelledAt: Date.now() });
    });

    const defBeforeCancel = await totalInfantry(t, def.kingdomId);
    vi.setSystemTime(acc3.scheduledAt + 5_000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const battlesCh3 = await t.run(async (ctx) =>
      ctx.db.query("Battle").withIndex("by_challenge", (q) => q.eq("challengeId", ch3.challengeId)).collect()
    );
    expect(battlesCh3).toHaveLength(0);
    expect(await totalInfantry(t, def.kingdomId)).toBe(defBeforeCancel);
  });
});

// ============================================================================
// BLOQUE D — NIEBLA DE GUERRA Y PRIVACIDAD DEL MAPA
// ============================================================================
describe("Fase 3 — Bloque D: Privacidad del mapa, orden de autorización y equivalencia full/compact", () => {
  test("controla acceso para anónimo, usuario sin reino, reino propio, reino ajeno, espionaje y equivalencia completa/compacta", async () => {
    const t = createTestBackend();
    const kA = await foundKingdom(t, "priv-a", "Reino A");
    const kB = await foundKingdom(t, "priv-b", "Reino B");
    const userWithoutKingdom = t.withIdentity(identity("priv-no-kingdom"));

    await kA.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: kA.kingdomId });
    await kB.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: kB.kingdomId });

    const tB = await kB.asUser.query(api.territories.getKingdomTerritories, { kingdomId: kB.kingdomId });
    const capitalB = tB.homeTerritoryId!;

    // 1. Usuario NO autenticado: consulta pública global solo expone geografía pública (7.651 celdas, sin dueños/capitales)
    const anonFull = await t.query(api.territories.getWorldMap, {});
    const anonCompact = await t.query(api.territories.getWorldMapCompact, {});
    expect(anonFull.totalCells).toBe(7651);
    expect(anonFull.cells).toHaveLength(7651);
    expect(anonFull.kingdomLegend).toEqual([]);
    expect(anonFull.cells.every((c) => c.ownerKingdomId === null && c.ownerName === null && c.isHome === false)).toBe(true);
    expect(anonCompact.totalCells).toBe(7651);
    expect(anonCompact.visibleCells).toEqual([]);
    expect(anonCompact.kingdomLegend).toEqual([]);

    // Usuario NO autenticado intentando consultar un reino concreto: RECHAZADO
    await expect(t.query(api.territories.getWorldMap, { kingdomId: kA.kingdomId })).rejects.toThrow(/No autorizado/i);
    await expect(t.query(api.territories.getWorldMapCompact, { kingdomId: kA.kingdomId })).rejects.toThrow(/No autorizado/i);

    // 2. Usuario autenticado SIN reino: puede leer geografía pública, pero NO el mapa privado de ningún reino
    const noKingdomGlobal = await userWithoutKingdom.query(api.territories.getWorldMapCompact, {});
    expect(noKingdomGlobal.visibleCells).toEqual([]);
    await expect(userWithoutKingdom.query(api.territories.getWorldMap, { kingdomId: kA.kingdomId })).rejects.toThrow(/No autorizado/i);
    await expect(userWithoutKingdom.query(api.territories.getWorldMapCompact, { kingdomId: kA.kingdomId })).rejects.toThrow(/No autorizado/i);

    // 3. Usuario de Reino A consultando Reino B: RECHAZADO en ambas consultas
    await expect(kA.asUser.query(api.territories.getWorldMap, { kingdomId: kB.kingdomId })).rejects.toThrow(/No autorizado/i);
    await expect(kA.asUser.query(api.territories.getWorldMapCompact, { kingdomId: kB.kingdomId })).rejects.toThrow(/No autorizado/i);

    // 4. Usuario de Reino A consultando su propio reino: capital B no descubierta permanece oculta y equivalencia total full vs compact
    const ownFull = await kA.asUser.query(api.territories.getWorldMap, { kingdomId: kA.kingdomId });
    const ownCompact = await kA.asUser.query(api.territories.getWorldMapCompact, { kingdomId: kA.kingdomId });

    expect(ownFull.exploredCount).toBe(ownCompact.exploredCount);
    expect(ownFull.kingdomLegend).toEqual(ownCompact.kingdomLegend);
    expect(ownFull.kingdomLegend.some((k) => k.id === String(kB.kingdomId))).toBe(false);

    const capBFull = ownFull.cells.find((c) => c.cellId === capitalB);
    expect(capBFull?.state).toBe("fog");
    expect(capBFull?.terrain).toBe("desconocido");
    expect(capBFull?.ownerKingdomId).toBeNull();
    expect(capBFull?.isHome).toBe(false);
    expect(ownCompact.visibleCells.find((c) => c.cellId === capitalB)).toBeUndefined();

    // 5. Descubrimiento mediante espionaje real (requestEspionageReport): revela territorios del objetivo en ambas consultas de forma idéntica
    await t.run(async (ctx) => {
      await ctx.db.insert("technologyProgress", {
        kingdomId: kA.kingdomId,
        technologyId: "espionage_1",
        status: "completed",
        completedAt: T0,
      });
      await ctx.db.insert("armyUnits", { kingdomId: kA.kingdomId, unitType: "espia", level: 1, count: 2, isSpy: true });
      const res = await ctx.db.query("resources").filter((q) => q.eq(q.field("kingdomId"), kA.kingdomId)).first();
      if (res) await ctx.db.patch(res._id, { gold: 5000 });
    });

    const spyReport = await kA.asUser.mutation(api.parliament.requestEspionageReport, {
      kingdomId: kA.kingdomId,
      targetKingdomId: kB.kingdomId,
      spiesCount: 1,
    });
    expect(spyReport.success).toBe(true);

    const afterSpyFull = await kA.asUser.query(api.territories.getWorldMap, { kingdomId: kA.kingdomId });
    const afterSpyCompact = await kA.asUser.query(api.territories.getWorldMapCompact, { kingdomId: kA.kingdomId });

    expect(afterSpyFull.exploredCount).toBe(afterSpyCompact.exploredCount);
    expect(afterSpyFull.kingdomLegend).toEqual(afterSpyCompact.kingdomLegend);
    expect(afterSpyFull.kingdomLegend.some((k) => k.id === String(kB.kingdomId))).toBe(true);

    const revealedFull = afterSpyFull.cells.find((c) => c.cellId === capitalB);
    const revealedCompact = afterSpyCompact.visibleCells.find((c) => c.cellId === capitalB);
    expect(revealedFull?.state).toBe("explored");
    expect(revealedFull?.ownerKingdomId).toBe(kB.kingdomId);
    expect(revealedFull?.isHome).toBe(true);
    expect(revealedCompact?.state).toBe("explored");
    expect(revealedCompact?.ownerKingdomId).toBe(kB.kingdomId);
    expect(revealedCompact?.isHome).toBe(true);
    expect(revealedCompact?.terrain).toBe(revealedFull?.terrain);
    expect(revealedCompact?.ownerName).toBe(revealedFull?.ownerName);
    expect(revealedCompact?.ownerColor).toBe(revealedFull?.ownerColor);
  });
});
