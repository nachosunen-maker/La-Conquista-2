import { internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { MAP } from "./balanceConfig";
import { hexDistance } from "./territoryRules";
import { addUnits, parseMarchUnits, refundMarchToGarrisonOnce } from "./army";
import { calculateExplorationRefund } from "./explorationRules";
import { settleRelationalKingdomEconomy } from "./economy";

export interface MapReductionResult {
  dryRun: boolean;
  radiusLimit: number;
  territoriesDeleted: number;
  protectedCapitals: number;
  explorationsDeleted: number;
  missionsCancelled: number;
  marchesCancelled: number;
  marchesSkippedCompleted: number;
  marchesSkippedCancelled: number;
  marchesSkippedAlreadyProcessed: number;
  challengesCancelled: number;
  unitsRefunded: number;
}

/**
 * Implementación única y canónica de la reducción del mapa según MAP.RADIUS (radio 50, 7.651 celdas).
 * - `dryRun` por defecto `true`: simula sin realizar escrituras persistentes.
 * - Protege estrictamente las capitales (`isHome === true`), que nunca se eliminan.
 * - Solo cancela y devuelve unidades de marchas exteriores activas (`status === "marchando"`) sin devolución previa (`!unitsRefundedAt`).
 * - Conserva el registro histórico de marchas (`status: "cancelada"`, sin eliminarlas) y nunca devuelve tropas de marchas completadas, canceladas o ya procesadas.
 * - Si una marcha exterior activa estaba vinculada a un desafío parlamentario abierto (`ACCEPTED`/`FROZEN` sin batalla), cancela ese desafío (`CANCELLED`) de forma atómica para impedir que el scheduler lo resuelva después.
 * - Es estrictamente idempotente y segura frente a ejecuciones concurrentes (transacción atómica OCC de Convex).
 */
export async function runMapReduction(
  ctx: MutationCtx,
  options: { dryRun?: boolean } = {}
): Promise<MapReductionResult> {
  const dryRun = options.dryRun ?? true;
  const radiusLimit = MAP.RADIUS;
  const now = Date.now();

  const [expQueue, armyMarches, territories, explorations] = await Promise.all([
    ctx.db.query("explorationQueue").collect(),
    ctx.db.query("armyMarches").collect(),
    ctx.db.query("territories").collect(),
    ctx.db.query("exploredTerritories").collect(),
  ]);

  const exteriorExpeditions = expQueue.filter(
    (exp) => hexDistance({ q: exp.targetQ, r: exp.targetR }, { q: 0, r: 0 }) > radiusLimit
  );

  const exteriorMarchesAll = armyMarches.filter(
    (march) => hexDistance({ q: march.targetQ, r: march.targetR }, { q: 0, r: 0 }) > radiusLimit
  );

  const activeExteriorMarches = exteriorMarchesAll.filter(
    (march) => march.status === "marchando" && march.unitsRefundedAt == null
  );
  const skippedCompletedMarches = exteriorMarchesAll.filter(
    (march) => march.status === "completada"
  );
  const skippedCancelledMarches = exteriorMarchesAll.filter(
    (march) => march.status === "cancelada"
  );
  const skippedAlreadyProcessedMarches = exteriorMarchesAll.filter(
    (march) => march.status === "marchando" && march.unitsRefundedAt != null
  );

  const exteriorTerritoriesAll = territories.filter(
    (t) => hexDistance({ q: t.q, r: t.r }, { q: 0, r: 0 }) > radiusLimit
  );
  const protectedCapitals = exteriorTerritoriesAll.filter((t) => t.isHome === true);
  const exteriorTerritories = exteriorTerritoriesAll.filter((t) => t.isHome !== true);

  const exteriorExplorations = explorations.filter((e) => {
    const parts = e.cellId.split(",");
    if (parts.length !== 2) return false;
    const q = Number(parts[0]);
    const r = Number(parts[1]);
    if (!Number.isFinite(q) || !Number.isFinite(r)) return false;
    return hexDistance({ q, r }, { q: 0, r: 0 }) > radiusLimit;
  });

  if (dryRun) {
    let previewChallengesToCancel = 0;
    const seenChallengeIds = new Set<string>();
    let previewUnitsToRefund = 0;

    for (const march of activeExteriorMarches) {
      previewUnitsToRefund += parseMarchUnits(march.units).totalValidCount;
      if (march.challengeId && !seenChallengeIds.has(String(march.challengeId))) {
        const linked = await ctx.db.get(march.challengeId);
        if (
          linked &&
          (linked.status === "ACCEPTED" || linked.status === "FROZEN") &&
          !linked.battleId &&
          !linked.resolvedAt
        ) {
          seenChallengeIds.add(String(march.challengeId));
          previewChallengesToCancel++;
        }
      }
    }

    return {
      dryRun: true,
      radiusLimit,
      territoriesDeleted: exteriorTerritories.length,
      protectedCapitals: protectedCapitals.length,
      explorationsDeleted: exteriorExplorations.length,
      missionsCancelled: exteriorExpeditions.length,
      marchesCancelled: activeExteriorMarches.length,
      marchesSkippedCompleted: skippedCompletedMarches.length,
      marchesSkippedCancelled: skippedCancelledMarches.length,
      marchesSkippedAlreadyProcessed: skippedAlreadyProcessedMarches.length,
      challengesCancelled: previewChallengesToCancel,
      unitsRefunded: previewUnitsToRefund,
    };
  }

  // 1. Recuperar unidades y recursos de expediciones exteriores
  for (const exp of exteriorExpeditions) {
    if (exp.isSpyMission) {
      await addUnits(ctx, exp.kingdomId, "espia", 1, exp.scoutsCount || 1);
    } else {
      const populationDoc = await ctx.db
        .query("population")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", exp.kingdomId))
        .first();
      if (populationDoc) {
        await ctx.db.patch(populationDoc._id, {
          available: (populationDoc.available ?? 0) + (exp.scoutsCount ?? 1),
        });
      }
    }
    const kingdom = await ctx.db.get(exp.kingdomId);
    if (kingdom) {
      const settled = await settleRelationalKingdomEconomy(ctx, kingdom, kingdom.userId, now);
      const refund = calculateExplorationRefund(exp.costs);
      await ctx.db.patch(settled.resources._id, {
        gold: settled.settledResources.gold + refund.gold,
        food: settled.settledResources.food + refund.food,
      });
    }
    await ctx.db.delete(exp._id);
  }

  // 2. Cancelar únicamente marchas exteriores activas sin devolución previa (atómico, sin borrar historial)
  let marchesCancelled = 0;
  let challengesCancelled = 0;
  let unitsRefunded = 0;

  for (const march of activeExteriorMarches) {
    const refundRes = await refundMarchToGarrisonOnce(ctx, march._id, {
      status: "cancelada",
      cancelledAt: now,
      cancelReason: "map_reduction",
    });
    if (refundRes.alreadyRefunded) {
      continue;
    }
    unitsRefunded += refundRes.totalRefunded;
    marchesCancelled++;

    // Si la marcha estaba vinculada a un desafío parlamentario abierto (no resuelto), cancelarlo
    // para que el scheduler no resuelva posteriormente un combate cuya marcha fue cancelada.
    if (march.challengeId) {
      const linkedChallenge = await ctx.db.get(march.challengeId);
      if (
        linkedChallenge &&
        (linkedChallenge.status === "ACCEPTED" || linkedChallenge.status === "FROZEN") &&
        !linkedChallenge.battleId &&
        !linkedChallenge.resolvedAt
      ) {
        await ctx.db.patch(linkedChallenge._id, {
          status: "CANCELLED",
          cancelledAt: now,
          cancelReason: "map_reduction_march_cancelled",
        });
        challengesCancelled++;
      }
    }
  }

  // 3. Eliminar territorios exteriores no capitales en lotes (nunca toca celdas <= MAP.RADIUS ni capitales)
  for (let i = 0; i < exteriorTerritories.length; i += 500) {
    const batch = exteriorTerritories.slice(i, i + 500);
    for (const t of batch) {
      await ctx.db.delete(t._id);
    }
  }

  // 4. Eliminar registros de exploración exteriores en lotes
  for (let i = 0; i < exteriorExplorations.length; i += 500) {
    const batch = exteriorExplorations.slice(i, i + 500);
    for (const e of batch) {
      await ctx.db.delete(e._id);
    }
  }

  return {
    dryRun: false,
    radiusLimit,
    territoriesDeleted: exteriorTerritories.length,
    protectedCapitals: protectedCapitals.length,
    explorationsDeleted: exteriorExplorations.length,
    missionsCancelled: exteriorExpeditions.length,
    marchesCancelled,
    marchesSkippedCompleted: skippedCompletedMarches.length,
    marchesSkippedCancelled: skippedCancelledMarches.length,
    marchesSkippedAlreadyProcessed: skippedAlreadyProcessedMarches.length,
    challengesCancelled,
    unitsRefunded,
  };
}

export const executeMapReduction = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => runMapReduction(ctx, args),
});
