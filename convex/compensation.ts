import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { OUTAGE_COMPENSATION, TAXES, TERRAINS, WELLBEING } from "./balanceConfig";
import { isDemoAccountUserId } from "./kingdomAccess";
import {
  INITIAL_KINGDOM_CONFIG,
  calculateSettlementProgress,
  settleRelationalKingdomEconomy,
} from "./economy";
import { adaptRemoteDocumentsToEconomicState } from "./economyAdapter";
import { simulateExtendedEconomy, storageCapacity } from "./economyExtended";
import {
  calculateJobCapacities,
  calculateResidentialCapacity,
  constructionProgress,
  validateBuildingCollection,
  validateConstructionCompletion,
  type ConstructionQueueEntry,
} from "./buildingRules";
import {
  readCompletedTechnologyIds,
  computeTechnologyModifiers,
  normalizeTechnologyId,
  researchProgress,
  type ResearchQueueEntry,
} from "./technologyRules";
import {
  normalizeUnitType,
  trainingProgress,
  unitLevelOf,
  type TrainingQueueEntry,
} from "./armyRules";
import { readArmyUnitDocs } from "./army";
import { activeProductionBonusMultiplier } from "./missionRules";
import { getCivilizationPassive, normalizeCivilizationId } from "./civilizationRules";

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

/**
 * Proyección de solo lectura idéntica a settleRelationalKingdomEconomy:
 * incorpora obras/entrenamientos/investigaciones vencidos hasta `now` y simula
 * la liquidación económica pendiente antes de evaluar la capacidad disponible.
 */
async function projectKingdomCapacityState(
  ctx: QueryCtx,
  kingdom: any,
  resourcesDoc: any,
  userId: string,
  now: number
): Promise<{
  currentResources: Record<CompensationResourceKey, number>;
  maxCapacity: number;
} | null> {
  try {
    const normalizedCivilization = normalizeCivilizationId(kingdom.civilization);
    const effectiveKingdom =
      normalizedCivilization && normalizedCivilization !== kingdom.civilization
        ? { ...kingdom, civilization: normalizedCivilization }
        : kingdom;

    const [
      populationDoc,
      populationJobs,
      storedBuildings,
      constructionQueue,
      trainingQueue,
      technologyProgress,
      storedArmyUnits,
      territories,
    ] = await Promise.all([
      ctx.db
        .query("population" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), kingdom._id))
        .first(),
      ctx.db
        .query("populationJobs" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), kingdom._id))
        .collect(),
      ctx.db
        .query("buildings")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdom._id))
        .collect(),
      ctx.db
        .query("constructionQueue")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdom._id))
        .collect(),
      ctx.db
        .query("trainingQueue")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdom._id))
        .collect(),
      ctx.db
        .query("technologyProgress")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdom._id))
        .collect(),
      readArmyUnitDocs(ctx, kingdom._id),
      ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", kingdom._id))
        .collect(),
    ]);

    const effectiveBuildings = storedBuildings.map((b: any) => ({ ...b }));
    for (const construction of constructionQueue) {
      if (
        typeof construction.startedAt !== "number" ||
        typeof construction.durationMs !== "number" ||
        typeof construction.targetLevel !== "number" ||
        typeof construction.buildingType !== "string" ||
        constructionProgress(construction as ConstructionQueueEntry, now) !== 100
      ) {
        continue;
      }
      const matching = effectiveBuildings.filter(
        (item: any) => item.buildingType === construction.buildingType
      );
      const completion = validateConstructionCompletion({
        buildingType: construction.buildingType,
        targetLevel: construction.targetLevel,
        existingLevels: matching.map((item: any) => item.level),
      });
      if (!completion.success) continue;
      if (completion.action === "upgrade" && matching[0]) {
        matching[0].level = construction.targetLevel;
      } else if (completion.action === "insert") {
        effectiveBuildings.push({
          kingdomId: kingdom._id,
          buildingType: construction.buildingType,
          level: construction.targetLevel,
        });
      }
    }

    const effectiveArmyUnits = storedArmyUnits.map((u: any) => ({ ...u }));
    for (const entry of trainingQueue) {
      if (
        typeof entry.startedAt !== "number" ||
        typeof entry.durationMs !== "number" ||
        typeof entry.count !== "number" ||
        typeof entry.unitType !== "string" ||
        trainingProgress(entry as TrainingQueueEntry, now) !== 100
      ) {
        continue;
      }
      const unitType = normalizeUnitType(entry.unitType);
      if (!unitType) continue;
      const isSpy = unitType === "espia";
      const effectiveLevel = unitLevelOf({ level: entry.level });
      const existing = effectiveArmyUnits.find((doc: any) => {
        if (doc.migrationAmbiguous) return false;
        const docIsSpy = doc.isSpy === true || normalizeUnitType(doc.unitType) === "espia";
        if (isSpy) {
          return docIsSpy && unitLevelOf(doc) === effectiveLevel;
        }
        return (
          !docIsSpy &&
          !doc.isMercenary &&
          normalizeUnitType(doc.unitType) === unitType &&
          unitLevelOf(doc) === effectiveLevel
        );
      });
      if (existing) {
        existing.unitType = unitType;
        existing.count += entry.count;
        existing.level = effectiveLevel;
        existing.isSpy = isSpy;
      } else {
        effectiveArmyUnits.push({
          kingdomId: kingdom._id,
          unitType,
          level: effectiveLevel,
          count: entry.count,
          isSpy,
        });
      }
    }

    const completedTechSet = new Set<string>();
    for (const doc of technologyProgress) {
      if (typeof doc.technologyId !== "string") continue;
      const isAlreadyCompleted = doc.status === "completed";
      const isDueResearch =
        doc.status === "researching" &&
        typeof doc.startedAt === "number" &&
        typeof doc.durationMs === "number" &&
        researchProgress(doc as ResearchQueueEntry, now) === 100;
      if (isAlreadyCompleted || isDueResearch) {
        completedTechSet.add(normalizeTechnologyId(doc.technologyId));
      }
    }
    const completedTechnologies = [...completedTechSet];

    if (!populationDoc) {
      return null;
    }
    const effectivePopulation = populationDoc;

    const isFirstInitialization = resourcesDoc.settlementInitialized !== true;
    const settlement = calculateSettlementProgress({
      kingdom: effectiveKingdom,
      resources: resourcesDoc,
      population: effectivePopulation,
      populationJobs,
      armyUnits: effectiveArmyUnits,
      buildings: effectiveBuildings,
      currentServerTimeMs: now,
      options: { isFirstInitialization, callerUserId: userId },
    });

    if (!settlement.success || settlement.updatedFood === undefined) {
      return null;
    }

    const collection = validateBuildingCollection(effectiveBuildings);
    const buildingLevels = collection.success ? collection.levels : {};
    const techModifiers = computeTechnologyModifiers(completedTechnologies);
    const civPassive = getCivilizationPassive(effectiveKingdom.civilization);
    const fallbackMaxCapacity = storageCapacity(
      buildingLevels.mercado ?? 0,
      techModifiers.storageCapacity * (civPassive.storageCapacityMultiplier ?? 1.0)
    );

    if (isFirstInitialization) {
      return {
        currentResources: {
          gold: resourcesDoc.gold,
          wood: resourcesDoc.wood,
          stone: resourcesDoc.stone,
          iron: resourcesDoc.iron,
          food: settlement.updatedFood,
        },
        maxCapacity: fallbackMaxCapacity,
      };
    }

    const adapted = adaptRemoteDocumentsToEconomicState({
      kingdom: effectiveKingdom,
      resources: resourcesDoc,
      population: effectivePopulation,
      populationJobs,
      armyUnits: effectiveArmyUnits,
      buildings: effectiveBuildings,
      foodTier: settlement.appliedFoodTier ?? (effectiveKingdom.foodTier || "normal"),
    });

    if (!adapted.success || !adapted.kingdomState || !adapted.militaryClassification) {
      return null;
    }

    const terrainBonuses: Partial<Record<"agriculture" | "wood" | "stone" | "iron" | "gold", number>> = {};
    for (const territory of territories) {
      const terrain = (TERRAINS as Record<string, any>)[territory.terrain];
      if (!terrain) continue;
      for (const [job, bonus] of Object.entries(terrain.production as Record<string, number>)) {
        const key = job as keyof typeof terrainBonuses;
        terrainBonuses[key] = (terrainBonuses[key] ?? 0) + bonus;
      }
    }

    const extended = simulateExtendedEconomy({
      kingdomState: adapted.kingdomState,
      now,
      jobCapacities: calculateJobCapacities(effectiveBuildings),
      residentialCapacity: calculateResidentialCapacity(
        effectiveBuildings,
        techModifiers.housingCapacityBonus
      ),
      technologyModifiers: techModifiers,
      terrainBonuses,
      taxRate: typeof effectiveKingdom.taxRate === "number" ? effectiveKingdom.taxRate : TAXES.INITIAL_RATE,
      happiness:
        typeof effectiveKingdom.happiness === "number"
          ? effectiveKingdom.happiness
          : WELLBEING.INITIAL_HAPPINESS,
      moraleEffects: Array.isArray(effectiveKingdom.moraleEffects)
        ? effectiveKingdom.moraleEffects
        : [],
      starvationSeconds:
        typeof effectivePopulation.starvationSeconds === "number"
          ? effectivePopulation.starvationSeconds
          : 0,
      birthFraction:
        typeof effectivePopulation.birthFraction === "number" ? effectivePopulation.birthFraction : 0,
      deathFraction:
        typeof effectivePopulation.deathFraction === "number" ? effectivePopulation.deathFraction : 0,
      desertionFraction:
        typeof effectivePopulation.desertionFraction === "number"
          ? effectivePopulation.desertionFraction
          : 0,
      buildingLevels,
      militaryPersonnel: adapted.militaryClassification.regularSoldiers,
      restPolicy:
        typeof effectiveKingdom.restPolicy === "string"
          ? (effectiveKingdom.restPolicy as any)
          : "normal",
      glory: typeof effectiveKingdom.glory === "number" ? effectiveKingdom.glory : 0,
      mercenaryCount: effectiveArmyUnits
        .filter((doc: any) => doc.isMercenary && Number.isInteger(doc.count))
        .reduce((sum: number, doc: any) => sum + Math.max(0, doc.count), 0),
      civilization: effectiveKingdom.civilization,
      bonusProductionMultiplier: activeProductionBonusMultiplier(effectiveKingdom.temporaryBonuses, now),
    });

    return {
      currentResources: extended.updatedResources,
      maxCapacity: extended.storageCapacity,
    };
  } catch (err) {
    return null;
  }
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
    let capacityVerifiable = true;
    if (owned && !claimedRecord) {
      const projected = await projectKingdomCapacityState(
        ctx,
        owned.kingdom,
        owned.resourcesDoc,
        userId,
        Date.now()
      );
      if (!projected) {
        capacityVerifiable = false;
        capacityReport = null;
      } else {
        capacityReport = evaluateCompensationStorageCapacity(
          projected.currentResources,
          projected.maxCapacity,
          OUTAGE_COMPENSATION.RESOURCES
        );
      }
    }

    const status = claimedRecord ? ("claimed" as const) : ("unclaimed" as const);
    const hasFoundedKingdom = Boolean(owned);
    const canClaim = !claimedRecord && hasFoundedKingdom && capacityVerifiable && Boolean(capacityReport?.allSufficient);

    return {
      authenticated: true,
      eligible: !claimedRecord,
      canClaim,
      capacityVerifiable,
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
