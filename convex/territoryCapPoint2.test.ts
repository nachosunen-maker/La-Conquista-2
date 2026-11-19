/**
 * LA CONQUISTA — SUITE INTEGRAL DEL PUNTO 2: LÍMITE DE 100 TERRITORIOS Y SANEAMIENTO SEGURO
 *
 * Cubre las 5 tareas y los 19 escenarios obligatorios sobre el backend real de Convex (convex-test):
 * - Tarea 1: Concurrencia estricta en 99 y 98 territorios, vías distintas, neutral + PvP y reintentos idempotentes.
 * - Tarea 2: Auditoría de integridad referencial antes y después, conservación de historiales y bloqueo de inconsistencias.
 * - Tarea 3: Autorización administrativa real en servidor (rechazo de anónimo, usuario normal y demo en dryRun y efectivo).
 * - Tarea 4: Registro persistente de auditoría (territoryCapAuditLogs) con idempotencia por operationId y conservación histórica.
 * - Tarea 5: Protección de capital histórica (sin elegir por cercanía al centro) y exclusión centralizada de cuentas demo.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DEMO_USER_ID, isDemoAccountUserId } from "./kingdomAccess";
import { generateWorldCells, hexDistance } from "./territoryRules";
import { TERRITORIES } from "./balanceConfig";

const modules = import.meta.glob("./**/*.ts");

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

/**
 * Siembra exactamente `ownedCount` territorios propios para `kingdomId` (capital en `capitalCellId` + contiguos)
 * y devuelve celdas vecinas libres y exploradas listas para reclamación o marcha.
 */
async function seedKingdomTerritories(
  t: ReturnType<typeof createTestBackend>,
  kingdomId: Id<"kingdoms">,
  ownedCount: number,
  options?: {
    capitalCellId?: string;
    extraNeighborCount?: number;
    excludeCellIds?: Set<string>;
  }
) {
  const capitalCellId = options?.capitalCellId ?? "0,0";
  const extraNeighborCount = options?.extraNeighborCount ?? 6;
  const world = generateWorldCells(50, 20261017);
  const capitalCell = world.find((c) => c.cellId === capitalCellId)!;
  const exclude = new Set<string>(options?.excludeCellIds ?? []);

  // Ordenar celdas por cercanía a la capital para construir un bloque compacto y contiguo
  const sorted = world
    .filter((c) => c.cellId !== capitalCellId && !exclude.has(c.cellId))
    .sort((a, b) => {
      const da = hexDistance(capitalCell, a);
      const db = hexDistance(capitalCell, b);
      if (da !== db) return da - db;
      return a.cellId.localeCompare(b.cellId);
    });

  const ownedCells = [capitalCell, ...sorted.slice(0, Math.max(0, ownedCount - 1))];
  const freeAdjacentCells = sorted.slice(Math.max(0, ownedCount - 1), Math.max(0, ownedCount - 1) + extraNeighborCount);

  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("territories")
      .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdomId))
      .collect();
    for (const doc of existing) {
      await ctx.db.delete(doc._id);
    }

    await ctx.db.patch(kingdomId, { homeTerritoryId: capitalCell.cellId });

    for (let i = 0; i < ownedCells.length; i++) {
      const c = ownedCells[i];
      const existingCell = await ctx.db
        .query("territories")
        .withIndex("by_cell", (q) => q.eq("cellId", c.cellId))
        .first();
      if (existingCell) {
        await ctx.db.patch(existingCell._id, {
          ownerKingdomId: kingdomId,
          isHome: c.cellId === capitalCell.cellId,
          claimedAt: 1000 + i,
        });
      } else {
        await ctx.db.insert("territories", {
          cellId: c.cellId,
          q: c.q,
          r: c.r,
          terrain: c.terrain,
          ownerKingdomId: kingdomId,
          isHome: c.cellId === capitalCell.cellId,
          claimedAt: 1000 + i,
        });
      }
    }

    for (const c of freeAdjacentCells) {
      const existingCell = await ctx.db
        .query("territories")
        .withIndex("by_cell", (q) => q.eq("cellId", c.cellId))
        .first();
      if (!existingCell) {
        await ctx.db.insert("territories", {
          cellId: c.cellId,
          q: c.q,
          r: c.r,
          terrain: c.terrain,
        });
      }
      const alreadyExplored = await ctx.db
        .query("exploredTerritories")
        .withIndex("by_kingdom_and_cell", (q) => q.eq("kingdomId", kingdomId).eq("cellId", c.cellId))
        .first();
      if (!alreadyExplored) {
        await ctx.db.insert("exploredTerritories", {
          kingdomId,
          cellId: c.cellId,
          discoveredAt: Date.now(),
        });
      }
    }
  });

  return { capitalCell, ownedCells, freeAdjacentCells };
}

// =============================================================================
// TAREA 1: CONCURRENCIA Y LÍMITE ESTRICTO DE 100 TERRITORIOS
// =============================================================================

describe("Punto 2 — Tarea 1: Concurrencia y límite estricto de 100 territorios", () => {
  test("1. Reino con 99 territorios y dos claimFreeTerritory concurrentes: solo 1 prospera, nunca >100 y gloria/reclamaciones coherentes", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "p2-conc-99", "Reino 99");
    const { freeAdjacentCells } = await seedKingdomTerritories(t, kingdomId, 99, { extraNeighborCount: 3 });

    await t.run(async (ctx) => {
      await ctx.db.patch(kingdomId, { pendingTerritoryClaims: 2, glory: 10, honor: 10, conquestRewardsGranted: 0 });
    });

    const outcomes = await Promise.allSettled([
      asUser.mutation(api.territories.claimFreeTerritory, { kingdomId, cellId: freeAdjacentCells[0].cellId }),
      asUser.mutation(api.territories.claimFreeTerritory, { kingdomId, cellId: freeAdjacentCells[1].cellId }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toMatch(/100/);

    const finalState = await t.run(async (ctx) => {
      const owned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdomId))
        .collect();
      const k = await ctx.db.get(kingdomId);
      return { owned, k };
    });

    expect(finalState.owned).toHaveLength(TERRITORIES.MAX_PER_KINGDOM);
    expect(new Set(finalState.owned.map((c) => c.cellId)).size).toBe(100);
    expect(finalState.k?.pendingTerritoryClaims).toBe(1);
    expect(finalState.k?.glory).toBe(11);
    expect(finalState.k?.honor).toBe(11);
    expect(finalState.k?.conquestRewardsGranted).toBe(1);
  });

  test("2. Reino con 98 territorios y 4 adquisiciones concurrentes: exactamente 2 prosperan y se cierra en 100", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "p2-conc-98", "Reino 98");
    const { freeAdjacentCells } = await seedKingdomTerritories(t, kingdomId, 98, { extraNeighborCount: 4 });

    await t.run(async (ctx) => {
      await ctx.db.patch(kingdomId, { pendingTerritoryClaims: 4, glory: 0, honor: 0, conquestRewardsGranted: 0 });
    });

    const outcomes = await Promise.allSettled(
      freeAdjacentCells.slice(0, 4).map((cell) =>
        asUser.mutation(api.territories.claimFreeTerritory, { kingdomId, cellId: cell.cellId })
      )
    );

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(2);

    const owned = await t.run(async (ctx) =>
      ctx.db.query("territories").withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdomId)).collect()
    );
    const k = await t.run(async (ctx) => ctx.db.get(kingdomId));
    expect(owned).toHaveLength(100);
    expect(k?.pendingTerritoryClaims).toBe(2);
    expect(k?.glory).toBe(2);
    expect(k?.conquestRewardsGranted).toBe(2);
  });

  test("3. Adquisición simultánea por vías distintas (claimFreeTerritory + conquista neutral por marcha) en 99 territorios: máximo 100 y tropas devueltas", async () => {
    const t = createTestBackend();
    const { asUser, kingdomId } = await foundKingdom(t, "p2-dual-path", "Reino Dos Vías");
    const { freeAdjacentCells } = await seedKingdomTerritories(t, kingdomId, 99, { extraNeighborCount: 3 });

    const marchId = await t.run(async (ctx) => {
      await ctx.db.patch(kingdomId, { pendingTerritoryClaims: 1, glory: 0, honor: 0, conquestRewardsGranted: 0 });
      await ctx.db.insert("armyUnits", { kingdomId, unitType: "infanteria", level: 1, count: 10, isSpy: false });
      return ctx.db.insert("armyMarches", {
        kingdomId,
        targetCellId: freeAdjacentCells[1].cellId,
        targetQ: freeAdjacentCells[1].q,
        targetR: freeAdjacentCells[1].r,
        distance: 1,
        units: [{ unitType: "infanteria", level: 1, count: 6 }],
        startedAt: Date.now() - 10_000,
        durationMs: 5_000,
        completesAt: Date.now() - 1_000,
        status: "marchando",
        isConquest: true,
      });
    });

    const [claimRes, marchRes] = await Promise.allSettled([
      asUser.mutation(api.territories.claimFreeTerritory, { kingdomId, cellId: freeAdjacentCells[0].cellId }),
      t.mutation(internal.army.completeMarchScheduled, { marchId }),
    ]);

    expect(claimRes.status === "fulfilled" || marchRes.status === "fulfilled").toBe(true);

    const stateAfter = await t.run(async (ctx) => {
      const owned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdomId))
        .collect();
      const k = await ctx.db.get(kingdomId);
      const march = await ctx.db.get(marchId);
      const units = await ctx.db
        .query("armyUnits")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
        .collect();
      const infCount = units.filter((u) => u.unitType === "infanteria").reduce((s, u) => s + u.count, 0);
      return { owned, k, march, infCount };
    });

    expect(stateAfter.owned).toHaveLength(100);
    expect(stateAfter.k?.glory).toBe(1);
    expect(stateAfter.k?.conquestRewardsGranted).toBe(1);
    expect(stateAfter.march?.status).toBe("completada");
    expect(stateAfter.march?.unitsRefundedAt).toBeDefined();
    // Las 6 tropas de la marcha SIEMPRE se devuelven a los 10 originales -> 16
    expect(stateAfter.infCount).toBe(16);
  });

  test("4. Conquista neutral y conquista PvP concurrentes en 99 territorios + reintento idempotente sin duplicar gloria ni registros", async () => {
    const t = createTestBackend();
    const attacker = await foundKingdom(t, "p2-pvp-atk", "Reino Atacante 99");
    const defender = await foundKingdom(t, "p2-pvp-def", "Reino Defensor");

    const { freeAdjacentCells } = await seedKingdomTerritories(t, attacker.kingdomId, 99, { extraNeighborCount: 3 });
    const neutralCell = freeAdjacentCells[0];
    const pvpCell = freeAdjacentCells[1];

    const now = Date.now();
    const { neutralMarchId, pvpMarchId } = await t.run(async (ctx) => {
      await ctx.db.patch(attacker.kingdomId, { glory: 0, honor: 0, conquestRewardsGranted: 0 });
      // Asignar pvpCell al defensor (no es su capital)
      const pvpDoc = await ctx.db
        .query("territories")
        .withIndex("by_cell", (q) => q.eq("cellId", pvpCell.cellId))
        .first();
      await ctx.db.patch(pvpDoc!._id, { ownerKingdomId: defender.kingdomId, isHome: false, claimedAt: 500 });

      // Ejército fuerte en atacante (marcha PvP) y nulo/mínimo en defensor para garantizar victoria
      await ctx.db.insert("armyUnits", { kingdomId: attacker.kingdomId, unitType: "infanteria", level: 3, count: 20, isSpy: false });
      await ctx.db.insert("armyUnits", { kingdomId: defender.kingdomId, unitType: "infanteria", level: 1, count: 1, isSpy: false });

      const challengeId = await ctx.db.insert("challenges", {
        challengerKingdomId: attacker.kingdomId,
        targetKingdomId: defender.kingdomId,
        challengeType: "conquista",
        status: "ACCEPTED",
        createdAt: now - 3600_000,
        expiresAt: now + 3600_000,
        respondedAt: now - 1800_000,
        window: "proxima",
        freezeAt: now - 900_000,
        scheduledAt: now - 1_000,
      });

      const nMarchId = await ctx.db.insert("armyMarches", {
        kingdomId: attacker.kingdomId,
        targetCellId: neutralCell.cellId,
        targetQ: neutralCell.q,
        targetR: neutralCell.r,
        distance: 1,
        units: [{ unitType: "infanteria", level: 3, count: 5 }],
        startedAt: now - 10_000,
        durationMs: 5_000,
        completesAt: now - 1_000,
        status: "marchando",
        isConquest: true,
      });

      const pMarchId = await ctx.db.insert("armyMarches", {
        kingdomId: attacker.kingdomId,
        targetCellId: pvpCell.cellId,
        targetQ: pvpCell.q,
        targetR: pvpCell.r,
        distance: 1,
        units: [{ unitType: "infanteria", level: 3, count: 40 }],
        startedAt: now - 10_000,
        durationMs: 5_000,
        completesAt: now - 1_000,
        status: "marchando",
        isConquest: false,
        challengeId,
      });

      return { neutralMarchId: nMarchId, pvpMarchId: pMarchId };
    });

    // Ejecutar simultáneamente conquista neutral y conquista PvP
    const concurrentRes = await Promise.allSettled([
      t.mutation(internal.army.completeMarchScheduled, { marchId: neutralMarchId }),
      t.mutation(internal.army.completeMarchScheduled, { marchId: pvpMarchId }),
    ]);
    expect(concurrentRes.every((r) => r.status === "fulfilled")).toBe(true);

    const afterConcurrent = await t.run(async (ctx) => {
      const owned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", attacker.kingdomId))
        .collect();
      const k = await ctx.db.get(attacker.kingdomId);
      const battles = await ctx.db
        .query("Battle")
        .withIndex("by_attacker", (q) => q.eq("attackerKingdomId", attacker.kingdomId))
        .collect();
      return { ownedCount: owned.length, glory: k?.glory ?? 0, rewards: k?.conquestRewardsGranted ?? 0, battlesCount: battles.length };
    });

    // Nunca >100 territorios, exactamente 1 conquista otorgada y 1 registro de batalla
    expect(afterConcurrent.ownedCount).toBe(100);
    expect(afterConcurrent.rewards).toBe(1);
    expect(afterConcurrent.battlesCount).toBe(1);

    // Reintentar ambas marchas ya procesadas -> idempotencia absoluta (sin duplicar gloria, recompensas ni batallas)
    const retry1 = await t.mutation(internal.army.completeMarchScheduled, { marchId: neutralMarchId });
    const retry2 = await t.mutation(internal.army.completeMarchScheduled, { marchId: pvpMarchId });
    expect(retry1).toBeNull();
    expect(retry2).toBeNull();

    const afterRetry = await t.run(async (ctx) => {
      const owned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", attacker.kingdomId))
        .collect();
      const k = await ctx.db.get(attacker.kingdomId);
      const battles = await ctx.db
        .query("Battle")
        .withIndex("by_attacker", (q) => q.eq("attackerKingdomId", attacker.kingdomId))
        .collect();
      return { ownedCount: owned.length, glory: k?.glory ?? 0, rewards: k?.conquestRewardsGranted ?? 0, battlesCount: battles.length };
    });

    expect(afterRetry).toEqual(afterConcurrent);
  });
});

// =============================================================================
// TAREAS 2, 3, 4 Y 5: AUTORIZACIÓN, AUDITORÍA, INTEGRIDAD, CAPITAL Y DEMO
// =============================================================================

describe("Punto 2 — Tareas 2–5: Autorización administrativa, auditoría persistente, integridad referencial, capital histórica y cuentas demo", () => {
  let prevAdminEnv: string | undefined;

  beforeEach(() => {
    prevAdminEnv = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = "admin-authorized-1";
  });

  afterEach(() => {
    if (prevAdminEnv === undefined) {
      delete process.env.ADMIN_USER_IDS;
    } else {
      process.env.ADMIN_USER_IDS = prevAdminEnv;
    }
  });

  test("5. Autorización administrativa real: anónimo, usuario normal y cuenta demo son rechazados en dryRun y en ejecución efectiva", async () => {
    const t = createTestBackend();
    const normalUser = await foundKingdom(t, "normal-player-1", "Reino Normal");
    const demoCaller = t.withIdentity(identity(DEMO_USER_ID));

    // Llamada anónima (pública e interna)
    await expect(t.mutation(api.territories.executeTerritoryCapCleanup, { dryRun: true })).rejects.toThrow(/No autorizado/i);
    await expect(t.mutation(internal.territories.cleanupExcessTerritories, { dryRun: true })).rejects.toThrow(/No autorizado/i);
    await expect(t.mutation(internal.territories.cleanupExcessTerritories, { dryRun: false })).rejects.toThrow(/No autorizado/i);

    // Usuario normal autenticado (ni dryRun ni efectivo)
    await expect(
      normalUser.asUser.mutation(api.territories.executeTerritoryCapCleanup, { dryRun: true })
    ).rejects.toThrow(/No autorizado/i);
    await expect(
      normalUser.asUser.mutation(api.territories.executeTerritoryCapCleanup, { dryRun: false })
    ).rejects.toThrow(/No autorizado/i);
    await expect(
      normalUser.asUser.mutation(internal.territories.cleanupExcessTerritories, { dryRun: false })
    ).rejects.toThrow(/No autorizado/i);

    // Cuenta demo Iberia (aunque se añadiera por error a ADMIN_USER_IDS, siempre queda excluida)
    process.env.ADMIN_USER_IDS = `admin-authorized-1,${DEMO_USER_ID}`;
    await expect(
      demoCaller.mutation(api.territories.executeTerritoryCapCleanup, { dryRun: true })
    ).rejects.toThrow(/No autorizado/i);

    // Ningún registro de auditoría fue escrito por intentos rechazados
    const logs = await t.run(async (ctx) => ctx.db.query("territoryCapAuditLogs").collect());
    expect(logs).toHaveLength(0);
  });

  test("6–12 y 17–19. Admin en dryRun sin mutar, saneamiento efectivo con auditoría persistente, idempotencia, integridad referencial e historiales intactos", async () => {
    const t = createTestBackend();
    const asAdmin = t.withIdentity(identity("admin-authorized-1"));

    // Reino 1: exactamente 100 territorios (no debe modificarse)
    const k100 = await foundKingdom(t, "user-exact-100", "Reino Exacto 100");
    await seedKingdomTerritories(t, k100.kingdomId, 100, { capitalCellId: "0,0", extraNeighborCount: 0 });

    // Reino 2: 106 territorios (capital "20,0" + 105) + historiales (batalla, marcha completada, explorados, edificios)
    const k106 = await foundKingdom(t, "user-over-106", "Reino Exceso 106");
    const seeded106 = await seedKingdomTerritories(t, k106.kingdomId, 106, {
      capitalCellId: "20,0",
      extraNeighborCount: 0,
    });

    const historicalIds = await t.run(async (ctx) => {
      const chId = await ctx.db.insert("challenges", {
        challengerKingdomId: k106.kingdomId,
        targetKingdomId: k100.kingdomId,
        challengeType: "duelo",
        status: "RESOLVED",
        createdAt: 100,
        expiresAt: 200,
        resolvedAt: 150,
      });
      const battleId = await ctx.db.insert("Battle", {
        challengeId: chId,
        attackerKingdomId: k106.kingdomId,
        defenderKingdomId: k100.kingdomId,
        resolvedAt: 150,
        outcome: "victoria",
        winnerKingdomId: k106.kingdomId,
        crushingVictory: false,
        report: { summary: "Histórico preservado" },
      });
      const marchId = await ctx.db.insert("armyMarches", {
        kingdomId: k106.kingdomId,
        targetCellId: seeded106.ownedCells[105].cellId,
        targetQ: seeded106.ownedCells[105].q,
        targetR: seeded106.ownedCells[105].r,
        distance: 5,
        units: [{ unitType: "infanteria", level: 1, count: 10 }],
        startedAt: 100,
        durationMs: 1000,
        completesAt: 1100,
        status: "completada",
      });
      const exploredId = await ctx.db.insert("exploredTerritories", {
        kingdomId: k106.kingdomId,
        cellId: seeded106.ownedCells[105].cellId,
        discoveredAt: 50,
        discoveryNote: "Cartografía histórica",
      });
      return { chId, battleId, marchId, exploredId };
    });

    // A) dryRun por admin autorizado: simula sin modificar territorios ni reino y deja registro marcado como dryRun
    const dryRes = await asAdmin.mutation(api.territories.executeTerritoryCapCleanup, {
      dryRun: true,
      operationId: "op-dry-001",
    });
    expect(dryRes.success).toBe(true);
    expect(dryRes.dryRun).toBe(true);
    expect(dryRes.mode).toBe("dryRun");
    expect(dryRes.territoriesReleased).toBe(6);
    expect(dryRes.beforeIntegrity.examinedCount).toBeGreaterThan(0);

    // Verificar que dryRun NO modificó nada en BD
    const owned106AfterDry = await t.run(async (ctx) =>
      ctx.db.query("territories").withIndex("by_owner", (q) => q.eq("ownerKingdomId", k106.kingdomId)).collect()
    );
    expect(owned106AfterDry).toHaveLength(106);

    const dryLogs = await t.run(async (ctx) =>
      ctx.db.query("territoryCapAuditLogs").withIndex("by_operation", (q) => q.eq("operationId", "op-dry-001")).collect()
    );
    expect(dryLogs).toHaveLength(2);
    expect(dryLogs.every((l) => l.mode === "dryRun" && l.outcome === "simulated" && l.adminIdentity === "admin-authorized-1")).toBe(true);

    // B) Saneamiento efectivo con operationId específico
    const effRes = await asAdmin.mutation(api.territories.executeTerritoryCapCleanup, {
      dryRun: false,
      operationId: "op-eff-001",
    });
    expect(effRes.success).toBe(true);
    expect(effRes.idempotentReplay).toBe(false);
    expect(effRes.mode).toBe("effective");
    expect(effRes.territoriesReleased).toBe(6);
    expect(effRes.referentialIntegrity.intact).toBe(true);
    expect(effRes.referentialIntegrity.examinedCount).toBeGreaterThan(200);
    expect(effRes.referentialIntegrity.inconsistentCount).toBe(0);

    // Verificar estado persistido: k100 intacto en 100; k106 reducido a 100 conservando capital "20,0" y los 99 más próximos
    const persisted = await t.run(async (ctx) => {
      const owned100 = await ctx.db.query("territories").withIndex("by_owner", (q) => q.eq("ownerKingdomId", k100.kingdomId)).collect();
      const owned106 = await ctx.db.query("territories").withIndex("by_owner", (q) => q.eq("ownerKingdomId", k106.kingdomId)).collect();
      const battle = await ctx.db.get(historicalIds.battleId);
      const march = await ctx.db.get(historicalIds.marchId);
      const explored = await ctx.db.get(historicalIds.exploredId);
      const challenge = await ctx.db.get(historicalIds.chId);
      const effLogs = await ctx.db
        .query("territoryCapAuditLogs")
        .withIndex("by_operation", (q) => q.eq("operationId", "op-eff-001"))
        .collect();
      return { owned100, owned106, battle, march, explored, challenge, effLogs };
    });

    expect(persisted.owned100).toHaveLength(100);
    expect(persisted.owned106).toHaveLength(100);
    expect(persisted.owned106.some((c) => c.cellId === "20,0" && c.isHome)).toBe(true);

    // Historiales estrictamente conservados intactos
    expect(persisted.battle).not.toBeNull();
    expect(persisted.march).not.toBeNull();
    expect(persisted.explored).not.toBeNull();
    expect(persisted.challenge).not.toBeNull();

    // Auditoría persistente completa con todos los identificadores requeridos
    const log106 = persisted.effLogs.find((l) => String(l.kingdomId) === String(k106.kingdomId))!;
    const log100 = persisted.effLogs.find((l) => String(l.kingdomId) === String(k100.kingdomId))!;
    expect(log106).toBeDefined();
    expect(log106.mode).toBe("effective");
    expect(log106.adminIdentity).toBe("admin-authorized-1");
    expect(log106.initialTerritoryCount).toBe(106);
    expect(log106.capitalCellId).toBe("20,0");
    expect(log106.keptCellIds).toHaveLength(100);
    expect(log106.releasedCellIds).toHaveLength(6);
    expect(log106.releasedCount).toBe(6);
    expect(log106.outcome).toBe("cleaned");
    expect(log106.referentialIntegrityBefore.examinedCount).toBeGreaterThan(100);
    expect(log106.referentialIntegrityAfter.intact).toBe(true);
    expect(log100.outcome).toBe("noop");
    expect(log100.releasedCount).toBe(0);

    // C) Reintento técnico con el MISMO operationId -> idempotente sin duplicar registros en territoryCapAuditLogs
    const replayRes = await asAdmin.mutation(api.territories.executeTerritoryCapCleanup, {
      dryRun: false,
      operationId: "op-eff-001",
    });
    expect(replayRes.idempotentReplay).toBe(true);
    expect(replayRes.territoriesReleased).toBe(6);
    const logsForOpEff1 = await t.run(async (ctx) =>
      ctx.db.query("territoryCapAuditLogs").withIndex("by_operation", (q) => q.eq("operationId", "op-eff-001")).collect()
    );
    expect(logsForOpEff1).toHaveLength(2); // Sin duplicación

    // D) Segunda ejecución con NUEVO operationId -> 0 cambios adicionales y conserva historial previo
    const secondRun = await asAdmin.mutation(api.territories.executeTerritoryCapCleanup, {
      dryRun: false,
      operationId: "op-eff-002",
    });
    expect(secondRun.idempotentReplay).toBe(false);
    expect(secondRun.territoriesReleased).toBe(0);
    expect(secondRun.kingdomsModified).toBe(0);
    const allLogs = await t.run(async (ctx) => ctx.db.query("territoryCapAuditLogs").collect());
    expect(allLogs).toHaveLength(6); // 2 (dry) + 2 (eff-001) + 2 (eff-002), historial intacto
  });

  test("13. Inconsistencia referencial bloqueante (marcha activa hacia celda a liberar) bloquea el saneamiento efectivo", async () => {
    const t = createTestBackend();
    const asAdmin = t.withIdentity(identity("admin-authorized-1"));
    const targetKingdom = await foundKingdom(t, "user-blocking-march", "Reino Con Marcha Activa");
    const attacker = await foundKingdom(t, "user-attacker-blocking", "Reino Atacante");

    const seeded = await seedKingdomTerritories(t, targetKingdom.kingdomId, 102, {
      capitalCellId: "15,0",
      extraNeighborCount: 0,
    });
    // La celda más lejana (índice 101) será planificada para liberación
    const farthestCell = seeded.ownedCells[101];

    await t.run(async (ctx) => {
      await ctx.db.insert("armyMarches", {
        kingdomId: attacker.kingdomId,
        targetCellId: farthestCell.cellId,
        targetQ: farthestCell.q,
        targetR: farthestCell.r,
        distance: 5,
        units: [{ unitType: "infanteria", level: 1, count: 10 }],
        startedAt: Date.now() - 1000,
        durationMs: 60_000,
        completesAt: Date.now() + 59_000,
        status: "marchando",
      });
    });

    const res = await asAdmin.mutation(api.territories.executeTerritoryCapCleanup, {
      dryRun: false,
      kingdomId: targetKingdom.kingdomId,
      operationId: "op-blocked-march",
    });

    expect(res.success).toBe(false);
    expect(res.kingdomsBlocked).toBe(1);
    expect(res.territoriesReleased).toBe(0);
    expect(res.referentialIntegrity.intact).toBe(false);
    expect(res.referentialIntegrity.requiresInterventionCount).toBeGreaterThan(0);
    expect(res.details[0].outcome).toBe("blocked");
    expect(res.details[0].errors.some((e) => e.includes("Marcha activa"))).toBe(true);

    // Ningún territorio fue liberado
    const ownedAfter = await t.run(async (ctx) =>
      ctx.db.query("territories").withIndex("by_owner", (q) => q.eq("ownerKingdomId", targetKingdom.kingdomId)).collect()
    );
    expect(ownedAfter).toHaveLength(102);
  });

  test("14 y 15. Capital histórica ausente o ambigua bloquea el saneamiento (nunca adivina por cercanía a 0,0); isHome único sí recupera con seguridad", async () => {
    const t = createTestBackend();
    const asAdmin = t.withIdentity(identity("admin-authorized-1"));

    // Caso A: capital ausente (homeTerritoryId undefined y ninguna celda con isHome: true) -> BLOQUEADO
    const kNoCap = await foundKingdom(t, "user-no-cap", "Reino Sin Capital");
    await seedKingdomTerritories(t, kNoCap.kingdomId, 103, { capitalCellId: "0,0", extraNeighborCount: 0 });
    await t.run(async (ctx) => {
      await ctx.db.patch(kNoCap.kingdomId, { homeTerritoryId: undefined });
      const owned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kNoCap.kingdomId))
        .collect();
      for (const c of owned) {
        if (c.isHome) await ctx.db.patch(c._id, { isHome: false });
      }
    });

    const resNoCap = await asAdmin.mutation(api.territories.executeTerritoryCapCleanup, {
      dryRun: false,
      kingdomId: kNoCap.kingdomId,
      operationId: "op-no-cap",
    });
    expect(resNoCap.success).toBe(false);
    expect(resNoCap.kingdomsBlocked).toBe(1);
    expect(resNoCap.territoriesReleased).toBe(0);
    expect(resNoCap.details[0].outcome).toBe("blocked");
    expect(resNoCap.details[0].errors.some((e) => /capital histórica/i.test(e))).toBe(true);
    const ownedNoCapAfter = await t.run(async (ctx) =>
      ctx.db.query("territories").withIndex("by_owner", (q) => q.eq("ownerKingdomId", kNoCap.kingdomId)).collect()
    );
    expect(ownedNoCapAfter).toHaveLength(103); // No liberó territorios

    // Caso B: homeTerritoryId ausente pero existe EXACTAMENTE UNA celda con isHome: true -> recuperación segura por prioridad 2
    const kRecoverable = await foundKingdom(t, "user-recover-cap", "Reino Capital Recuperable");
    await seedKingdomTerritories(t, kRecoverable.kingdomId, 103, { capitalCellId: "-20,0", extraNeighborCount: 0 });
    await t.run(async (ctx) => {
      await ctx.db.patch(kRecoverable.kingdomId, { homeTerritoryId: undefined });
    });

    const resRecover = await asAdmin.mutation(api.territories.executeTerritoryCapCleanup, {
      dryRun: false,
      kingdomId: kRecoverable.kingdomId,
      operationId: "op-recover-cap",
    });
    expect(resRecover.success).toBe(true);
    expect(resRecover.territoriesReleased).toBe(3);
    expect(resRecover.details[0].capitalCellId).toBe("-20,0");
    expect(resRecover.details[0].homeRepaired).toBe(true);
    const kRecDoc = await t.run(async (ctx) => ctx.db.get(kRecoverable.kingdomId));
    expect(kRecDoc?.homeTerritoryId).toBe("-20,0");
  });

  test("16. Exclusión centralizada de cuentas de demostración: protege DEMO_USER_ID y NO excluye usuarios reales por coincidencia de nombre", async () => {
    expect(DEMO_USER_ID).toBe("guest_g9ai8cz");
    expect(isDemoAccountUserId(DEMO_USER_ID)).toBe(true);
    expect(isDemoAccountUserId("guest_g9ai8cz|session_1")).toBe(true);
    expect(isDemoAccountUserId("real_user_iberia")).toBe(false);

    const t = createTestBackend();
    const asAdmin = t.withIdentity(identity("admin-authorized-1"));

    // Cuenta demo oficial con 105 territorios -> DEBE quedar excluida (skipped_demo)
    const demoKingdomId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("kingdoms", {
        userId: DEMO_USER_ID,
        name: "Reino de Iberia",
        civilization: "ingleses",
        homeTerritoryId: "0,0",
      });
      return id;
    });
    await seedKingdomTerritories(t, demoKingdomId, 105, { capitalCellId: "0,0", extraNeighborCount: 0 });

    // Usuario real cuyo reino también se llama "Reino de Iberia" con 104 territorios -> NO debe excluirse
    const realIberia = await foundKingdom(t, "real-player-iberia", "Reino de Iberia");
    await seedKingdomTerritories(t, realIberia.kingdomId, 104, { capitalCellId: "25,0", extraNeighborCount: 0 });

    const res = await asAdmin.mutation(api.territories.executeTerritoryCapCleanup, {
      dryRun: false,
      operationId: "op-demo-check",
    });

    expect(res.success).toBe(true);
    const demoDetail = res.details.find((d) => d.kingdomId === String(demoKingdomId))!;
    const realDetail = res.details.find((d) => d.kingdomId === String(realIberia.kingdomId))!;

    expect(demoDetail.skippedDemo).toBe(true);
    expect(demoDetail.outcome).toBe("skipped_demo");
    expect(demoDetail.releasedCount).toBe(0);

    expect(realDetail.skippedDemo).toBe(false);
    expect(realDetail.outcome).toBe("cleaned");
    expect(realDetail.releasedCount).toBe(4);

    // Verificar persistencia: demo sigue con 105, usuario real saneado a 100
    const demoOwned = await t.run(async (ctx) =>
      ctx.db.query("territories").withIndex("by_owner", (q) => q.eq("ownerKingdomId", demoKingdomId)).collect()
    );
    const realOwned = await t.run(async (ctx) =>
      ctx.db.query("territories").withIndex("by_owner", (q) => q.eq("ownerKingdomId", realIberia.kingdomId)).collect()
    );
    expect(demoOwned).toHaveLength(105);
    expect(realOwned).toHaveLength(100);
  });
});
