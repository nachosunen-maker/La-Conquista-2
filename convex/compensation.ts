import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { OUTAGE_COMPENSATION } from "./balanceConfig";
import { isDemoAccountUserId } from "./kingdomAccess";
import { settleRelationalKingdomEconomy } from "./economy";

function canonicalUserId(raw?: string | null): string {
  if (!raw) return "";
  return raw.split("|")[0].trim();
}

async function resolveVerifiedUserId(ctx: QueryCtx | MutationCtx): Promise<string | null> {
  const authId = await getAuthUserId(ctx);
  if (authId) {
    const clean = canonicalUserId(authId);
    return clean || null;
  }
  const identity = await ctx.auth.getUserIdentity();
  const clean = identity?.subject ? canonicalUserId(identity.subject) : "";
  return clean || null;
}

function isDemoAccount(userId: string): boolean {
  return isDemoAccountUserId(userId);
}

function matchesOutageIncident(record: { campaignId: string; incidentId?: string }): boolean {
  if (record.incidentId === OUTAGE_COMPENSATION.INCIDENT_ID) return true;
  if (record.campaignId === OUTAGE_COMPENSATION.CAMPAIGN_ID) return true;
  if (record.campaignId.startsWith(OUTAGE_COMPENSATION.INCIDENT_ID)) return true;
  return false;
}

async function findIncidentCompensationState(ctx: QueryCtx | MutationCtx, userId: string) {
  const allForUser = await ctx.db
    .query("outageCompensations")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const matching = allForUser.filter(matchesOutageIncident);
  const claimed = matching.find((r) => r.status === "claimed") ?? null;
  const pending = matching.find((r) => r.status === "pending") ?? null;
  return {
    matching,
    claimed,
    pending,
    effective: claimed ?? pending ?? null,
  };
}

async function findOwnedFoundedKingdom(ctx: QueryCtx | MutationCtx, userId: string) {
  const direct = await ctx.db
    .query("kingdoms")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .collect();

  const all = await ctx.db.query("kingdoms").collect();
  const seen = new Set(direct.map((k) => String(k._id)));
  const candidates = [...direct];
  for (const k of all) {
    if (!seen.has(String(k._id)) && canonicalUserId(k.userId) === userId) {
      candidates.push(k);
    }
  }

  for (const k of candidates) {
    if (isDemoAccount(canonicalUserId(k.userId))) continue;
    if (!k.name || !k.name.trim()) continue;
    const resourcesDoc = await ctx.db
      .query("resources")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", k._id))
      .first();
    if (resourcesDoc) {
      return k;
    }
  }
  return null;
}

/**
 * Aplica una compensación en estado "pending" al documento de recursos de un reino recién fundado.
 * Es idempotente y respeta el excedente por encima del tope de almacén.
 */
export async function applyPendingOutageCompensationOnFounding(
  ctx: MutationCtx,
  rawUserId: string,
  kingdomId: Id<"kingdoms">,
  resourcesId: Id<"resources">,
  now: number
): Promise<boolean> {
  const userId = canonicalUserId(rawUserId);
  if (!userId || isDemoAccount(userId)) return false;

  const { claimed, pending } = await findIncidentCompensationState(ctx, userId);
  if (claimed || !pending) {
    return false;
  }

  const resDoc = await ctx.db.get(resourcesId);
  if (!resDoc || resDoc.kingdomId !== kingdomId) return false;

  await ctx.db.patch(resourcesId, {
    gold: resDoc.gold + pending.resources.gold,
    wood: resDoc.wood + pending.resources.wood,
    stone: resDoc.stone + pending.resources.stone,
    iron: resDoc.iron + pending.resources.iron,
    food: resDoc.food + pending.resources.food,
  });

  await ctx.db.patch(pending._id, {
    status: "claimed",
    incidentId: pending.incidentId ?? OUTAGE_COMPENSATION.INCIDENT_ID,
    claimedKingdomId: kingdomId,
    claimedAt: now,
  });

  return true;
}

export const getOutageCompensationStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await resolveVerifiedUserId(ctx);
    if (!userId) {
      return {
        authenticated: false,
        eligible: false,
        incidentId: OUTAGE_COMPENSATION.INCIDENT_ID,
        campaignId: OUTAGE_COMPENSATION.CAMPAIGN_ID,
        status: "excluded" as const,
        resources: OUTAGE_COMPENSATION.RESOURCES,
        hasFoundedKingdom: false,
        claimedAt: null as number | null,
        claimedKingdomId: null as string | null,
      };
    }

    if (isDemoAccount(userId)) {
      return {
        authenticated: true,
        eligible: false,
        incidentId: OUTAGE_COMPENSATION.INCIDENT_ID,
        campaignId: OUTAGE_COMPENSATION.CAMPAIGN_ID,
        status: "excluded" as const,
        resources: OUTAGE_COMPENSATION.RESOURCES,
        hasFoundedKingdom: true,
        claimedAt: null as number | null,
        claimedKingdomId: null as string | null,
      };
    }

    const [compState, foundedKingdom] = await Promise.all([
      findIncidentCompensationState(ctx, userId),
      findOwnedFoundedKingdom(ctx, userId),
    ]);
    const record = compState.effective;

    return {
      authenticated: true,
      eligible: !record,
      incidentId: OUTAGE_COMPENSATION.INCIDENT_ID,
      campaignId: OUTAGE_COMPENSATION.CAMPAIGN_ID,
      status: record ? record.status : ("unclaimed" as const),
      resources: record?.resources ?? OUTAGE_COMPENSATION.RESOURCES,
      hasFoundedKingdom: Boolean(foundedKingdom),
      claimedAt: record?.claimedAt ?? null,
      claimedKingdomId: record?.claimedKingdomId ? String(record.claimedKingdomId) : null,
    };
  },
});

export const claimOutageCompensation = mutation({
  args: {
    kingdomId: v.optional(v.id("kingdoms")),
  },
  handler: async (ctx, args) => {
    const userId = await resolveVerifiedUserId(ctx);
    if (!userId) {
      throw new ConvexError("Debes iniciar sesión para reclamar la compensación extraordinaria.");
    }
    if (isDemoAccount(userId)) {
      throw new ConvexError("El reino de demostración Iberia está excluido de la compensación.");
    }

    let explicitCandidate = null;
    if (args.kingdomId) {
      const candidate = await ctx.db.get(args.kingdomId);
      if (candidate) {
        if (isDemoAccount(canonicalUserId(candidate.userId))) {
          throw new ConvexError("El reino de demostración Iberia está excluido de la compensación.");
        }
        if (canonicalUserId(candidate.userId) !== userId) {
          throw new ConvexError("No autorizado: ese reino pertenece a otra cuenta.");
        }
        explicitCandidate = candidate;
      }
    }

    const { effective: existing } = await findIncidentCompensationState(ctx, userId);
    if (existing) {
      return {
        success: true,
        alreadyClaimed: true,
        status: existing.status,
        appliedImmediately: false,
        resources: existing.resources,
        claimedKingdomId: existing.claimedKingdomId ?? null,
        message:
          existing.status === "claimed"
            ? "La compensación por la caída ya fue acreditada anteriormente en tu cuenta."
            : "Tu compensación ya está reservada en la cuenta y se acreditará al fundar tu reino.",
      };
    }

    let targetKingdom = null;
    if (explicitCandidate && explicitCandidate.name && explicitCandidate.name.trim()) {
      const resourcesDoc = await ctx.db
        .query("resources")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", explicitCandidate._id))
        .first();
      if (resourcesDoc) {
        targetKingdom = explicitCandidate;
      }
    }
    if (!targetKingdom) {
      targetKingdom = await findOwnedFoundedKingdom(ctx, userId);
    }

    const now = Date.now();
    const reward = { ...OUTAGE_COMPENSATION.RESOURCES };

    if (targetKingdom) {
      const settled = await settleRelationalKingdomEconomy(ctx, targetKingdom, userId, now);
      await ctx.db.patch(settled.resources._id, {
        gold: settled.settledResources.gold + reward.gold,
        wood: settled.settledResources.wood + reward.wood,
        stone: settled.settledResources.stone + reward.stone,
        iron: settled.settledResources.iron + reward.iron,
        food: settled.settledResources.food + reward.food,
      });

      await ctx.db.insert("outageCompensations", {
        userId,
        incidentId: OUTAGE_COMPENSATION.INCIDENT_ID,
        campaignId: OUTAGE_COMPENSATION.CAMPAIGN_ID,
        status: "claimed",
        resources: reward,
        claimedKingdomId: targetKingdom._id,
        createdAt: now,
        claimedAt: now,
      });

      return {
        success: true,
        alreadyClaimed: false,
        status: "claimed" as const,
        appliedImmediately: true,
        resources: reward,
        claimedKingdomId: targetKingdom._id,
        message: "Compensación acreditada: +30.000 de oro, madera, piedra, hierro y alimentos añadidos a tus reservas.",
      };
    }

    await ctx.db.insert("outageCompensations", {
      userId,
      incidentId: OUTAGE_COMPENSATION.INCIDENT_ID,
      campaignId: OUTAGE_COMPENSATION.CAMPAIGN_ID,
      status: "pending",
      resources: reward,
      createdAt: now,
    });

    return {
      success: true,
      alreadyClaimed: false,
      status: "pending" as const,
      appliedImmediately: false,
      resources: reward,
      claimedKingdomId: null,
      message: "Compensación reservada en tu cuenta: recibirás +30.000 de cada recurso automáticamente al fundar tu reino.",
    };
  },
});
