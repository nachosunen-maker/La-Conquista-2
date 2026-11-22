import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { OUTAGE_COMPENSATION } from "./balanceConfig";
import { isDemoAccountUserId } from "./kingdomAccess";
import { settleRelationalKingdomEconomy } from "./economy";
import { storageCapacity } from "./economyExtended";
import { validateBuildingCollection } from "./buildingRules";
import { readCompletedTechnologyIds, computeTechnologyModifiers } from "./technologyRules";
import { getCivilizationPassive } from "./civilizationRules";

const COMPENSATION_RESOURCE_KEYS = ["gold", "wood", "stone", "iron", "food"] as const;
type CompensationResourceKey = (typeof COMPENSATION_RESOURCE_KEYS)[number];

const COMPENSATION_RESOURCE_LABELS: Record<CompensationResourceKey, string> = {
  gold: "oro",
  wood: "madera",
  stone: "piedra",
  iron: "hierro",
  food: "comida",
};

export interface ResourceCapacityCheck {
  resource: CompensationResourceKey;
  label: string;
  current: number;
  maxCapacity: number;
  available: number;
  required: number;
  additionalNeeded: number;
  sufficient: boolean;
}

export interface CompensationCapacityReport {
  maxCapacity: number;
  requiredPerResource: number;
  allSufficient: boolean;
  insufficientResources: ResourceCapacityCheck[];
  resources: Record<CompensationResourceKey, ResourceCapacityCheck>;
}

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
  const legacyPending = matching.find((r) => r.status === "pending") ?? null;
  return {
    matching,
    claimed,
    legacyPending,
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
      return { kingdom: k, resourcesDoc };
    }
  }
  return null;
}

async function computeKingdomStorageCapacity(ctx: QueryCtx | MutationCtx, kingdom: any): Promise<number> {
  const [buildings, completedTechnologies] = await Promise.all([
    ctx.db
      .query("buildings")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdom._id))
      .collect(),
    readCompletedTechnologyIds(ctx, kingdom._id),
  ]);
  const collection = validateBuildingCollection(buildings);
  const mercadoLevel = collection.success ? (collection.levels.mercado ?? 0) : 0;
  const techModifiers = computeTechnologyModifiers(completedTechnologies);
  const civPassive = getCivilizationPassive(kingdom.civilization);
  const storageMultiplier =
    techModifiers.storageCapacity * (civPassive.storageCapacityMultiplier ?? 1.0);
  return storageCapacity(mercadoLevel, storageMultiplier);
}

function evaluateCompensationStorageCapacity(
  currentResources: Record<CompensationResourceKey, number>,
  maxCapacity: number,
  reward: Record<CompensationResourceKey, number>
): CompensationCapacityReport {
  const resources = {} as Record<CompensationResourceKey, ResourceCapacityCheck>;
  const insufficientResources: ResourceCapacityCheck[] = [];

  for (const key of COMPENSATION_RESOURCE_KEYS) {
    const current = Number.isFinite(currentResources[key]) ? currentResources[key] : 0;
    const required = reward[key];
    const rawAvailable = maxCapacity - current;
    const available = Math.max(0, rawAvailable);
    const sufficient = rawAvailable >= required;
    const additionalNeeded = sufficient ? 0 : Math.ceil(Math.max(0, required - rawAvailable));

    const entry: ResourceCapacityCheck = {
      resource: key,
      label: COMPENSATION_RESOURCE_LABELS[key],
      current,
      maxCapacity,
      available,
      required,
      additionalNeeded,
      sufficient,
    };
    resources[key] = entry;
    if (!sufficient) {
      insufficientResources.push(entry);
    }
  }

  return {
    maxCapacity,
    requiredPerResource: reward.gold,
    allSufficient: insufficientResources.length === 0,
    insufficientResources,
    resources,
  };
}

export const getOutageCompensationStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await resolveVerifiedUserId(ctx);
    if (!userId) {
      return {
        authenticated: false,
        eligible: false,
        canClaim: false,
        incidentId: OUTAGE_COMPENSATION.INCIDENT_ID,
        campaignId: OUTAGE_COMPENSATION.CAMPAIGN_ID,
        status: "excluded" as const,
        resources: OUTAGE_COMPENSATION.RESOURCES,
        hasFoundedKingdom: false,
        capacityReport: null as CompensationCapacityReport | null,
        claimedAt: null as number | null,
        claimedKingdomId: null as string | null,
      };
    }

    if (isDemoAccount(userId)) {
      return {
        authenticated: true,
        eligible: false,
        canClaim: false,
        incidentId: OUTAGE_COMPENSATION.INCIDENT_ID,
        campaignId: OUTAGE_COMPENSATION.CAMPAIGN_ID,
        status: "excluded" as const,
        resources: OUTAGE_COMPENSATION.RESOURCES,
        hasFoundedKingdom: true,
        capacityReport: null as CompensationCapacityReport | null,
        claimedAt: null as number | null,
        claimedKingdomId: null as string | null,
      };
    }

    const [compState, owned] = await Promise.all([
      findIncidentCompensationState(ctx, userId),
      findOwnedFoundedKingdom(ctx, userId),
    ]);
    const claimedRecord = compState.claimed;

    let capacityReport: CompensationCapacityReport | null = null;
    if (owned && !claimedRecord) {
      const maxCapacity = await computeKingdomStorageCapacity(ctx, owned.kingdom);
      capacityReport = evaluateCompensationStorageCapacity(
        {
          gold: owned.resourcesDoc.gold,
          wood: owned.resourcesDoc.wood,
          stone: owned.resourcesDoc.stone,
          iron: owned.resourcesDoc.iron,
          food: owned.resourcesDoc.food,
        },
        maxCapacity,
        OUTAGE_COMPENSATION.RESOURCES
      );
    }

    const status = claimedRecord ? ("claimed" as const) : ("unclaimed" as const);
    const hasFoundedKingdom = Boolean(owned);
    const canClaim = !claimedRecord && hasFoundedKingdom && Boolean(capacityReport?.allSufficient);

    return {
      authenticated: true,
      eligible: !claimedRecord,
      canClaim,
      incidentId: OUTAGE_COMPENSATION.INCIDENT_ID,
      campaignId: OUTAGE_COMPENSATION.CAMPAIGN_ID,
      status,
      resources: claimedRecord?.resources ?? OUTAGE_COMPENSATION.RESOURCES,
      hasFoundedKingdom,
      capacityReport,
      claimedAt: claimedRecord?.claimedAt ?? null,
      claimedKingdomId: claimedRecord?.claimedKingdomId ? String(claimedRecord.claimedKingdomId) : null,
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
      throw new ConvexError("Debes iniciar sesión para recibir el regalo único.");
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

    const { claimed, legacyPending } = await findIncidentCompensationState(ctx, userId);
    if (claimed) {
      return {
        success: true,
        alreadyClaimed: true,
        status: claimed.status,
        appliedImmediately: false,
        resources: claimed.resources,
        claimedKingdomId: claimed.claimedKingdomId ?? null,
        message: "El regalo único ya fue recibido anteriormente en tu cuenta.",
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
      const owned = await findOwnedFoundedKingdom(ctx, userId);
      targetKingdom = owned?.kingdom ?? null;
    }

    if (!targetKingdom) {
      throw new ConvexError(
        "Debes fundar tu reino y disponer de capacidad de almacén suficiente para recibir los 30.000 de cada recurso."
      );
    }

    const now = Date.now();
    const reward = { ...OUTAGE_COMPENSATION.RESOURCES };
    const settled = await settleRelationalKingdomEconomy(ctx, targetKingdom, userId, now);
    const maxCapacity =
      settled.extended?.storageCapacity ?? (await computeKingdomStorageCapacity(ctx, targetKingdom));

    const capacityReport = evaluateCompensationStorageCapacity(
      settled.settledResources,
      maxCapacity,
      reward
    );

    if (!capacityReport.allSufficient) {
      const details = capacityReport.insufficientResources
        .map(
          (item) =>
            `${item.label} (necesita ${item.additionalNeeded} de espacio adicional; almacenado ${Math.floor(item.current)}, disponible ${Math.floor(item.available)} de ${item.maxCapacity})`
        )
        .join("; ");
      throw new ConvexError(
        `Capacidad de almacenamiento insuficiente para recibir el regalo único (+30.000 por recurso). Recursos sin espacio suficiente: ${details}.`
      );
    }

    await ctx.db.patch(settled.resources._id, {
      gold: settled.settledResources.gold + reward.gold,
      wood: settled.settledResources.wood + reward.wood,
      stone: settled.settledResources.stone + reward.stone,
      iron: settled.settledResources.iron + reward.iron,
      food: settled.settledResources.food + reward.food,
    });

    if (legacyPending) {
      await ctx.db.patch(legacyPending._id, {
        status: "claimed",
        incidentId: legacyPending.incidentId ?? OUTAGE_COMPENSATION.INCIDENT_ID,
        campaignId: OUTAGE_COMPENSATION.CAMPAIGN_ID,
        resources: reward,
        claimedKingdomId: targetKingdom._id,
        claimedAt: now,
      });
    } else {
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
    }

    return {
      success: true,
      alreadyClaimed: false,
      status: "claimed" as const,
      appliedImmediately: true,
      resources: reward,
      claimedKingdomId: targetKingdom._id,
      maxCapacity,
      message:
        "Regalo único recibido: +30.000 de oro, madera, piedra, hierro y comida añadidos a tus almacenes.",
    };
  },
});
