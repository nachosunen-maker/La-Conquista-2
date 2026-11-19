/**
 * LA CONQUISTA — EJÉRCITO Y ENTRENAMIENTO (Bloque B)
 * Fuente única de verdad de tropas: tabla armyUnits (D-11). La tabla heredada
 * 'Armyunits' se migra al leerla desde una mutación y se retira tras migrar (D-15).
 */
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { isKingdomOwner } from "./kingdomAccess";
import { settleRelationalKingdomEconomy } from "./economy";
import { evaluateKingdomMissions, recordMissionEvent } from "./missions";
import { requireOwner } from "./buildings";
import { checkBuildingRequirements, validateBuildingCollection } from "./buildingRules";
import { computeTechnologyModifiers, readCompletedTechnologyIds } from "./technologyRules";
import {
  availableArmorTiers,
  availableMilitaryLevels,
  availableWeaponTiers,
  calculateTrainingCancellation,
  createSpyRecruitmentPlan,
  createTrainingPlan,
  isSpyUnitDoc,
  normalizeUnitType,
  planArmyUnitsMigration,
  reconcileArmyUnitDocs,
  summarizeArmy,
  trainingCostsFor,
  trainingDurationMs,
  trainingProgress,
  trainingQueueSlots,
  unitBuildingRequirements,
  unitLevelOf,
  isTacticalFormation,
  validateGlobalArmyUpgrade,
  validateEquipmentSelection,
  validateMercenaryHire,
  type TrainingQueueEntry,
} from "./armyRules";
import { ARMORS, DEFAULT_TACTICAL_FORMATION, MAP, MERCENARIES, MILITARY_LEVELS, REGULAR_UNIT_TYPES, STRATEGIES, TACTICAL_FORMATIONS, TERRAINS, TERRITORIES, TIME, UNITS, UNIT_TYPES, WEAPONS, type ArmorTier, type UnitType, type WeaponTier } from "./balanceConfig";
import { civilizationArmorLabel, civilizationTrainingCostMultiplier, civilizationTrainingDurationMultiplier, civilizationUnitLabel, civilizationWeaponLabel, getCivilizationIdentity, getCivilizationPassive } from "./civilizationRules";
import type { ResourceType } from "./economyCalculations";
import { getOrCreateTerritoryCell, patchTerritoryCell, readHomeCoord, readKnownCellIds, readPathTerrainMultiplier, readTerritoryCell } from "./territories";
import {
  armyMarchMultiplier,
  cellId,
  hexDistance,
  hexNeighbors,
  marchFatigue,
  marchTimeSeconds,
} from "./territoryRules";
import {
  applyFormation,
  emptyComposition,
  simulateBattle,
  type BattleSide,
  type Composition,
} from "./battleRules";
import { isScheduleWindow } from "./challengeRules";

/** Lectura de solo consulta: reconcilia armyUnits con la tabla heredada sin escribir ni duplicar registros ya migrados. */
export async function readArmyUnitDocs(ctx: QueryCtx | MutationCtx, kingdomId: Id<"kingdoms">): Promise<any[]> {
  const canonical = await ctx.db
    .query("armyUnits")
    .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
    .collect();
  let legacy: any[] = [];
  try {
    legacy = await (ctx.db as any)
      .query("Armyunits")
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();
  } catch {
    legacy = [];
  }
  return reconcileArmyUnitDocs(canonical, legacy);
}

/**
 * Lectura con migración transaccional e idempotente:
 * - Si un registro de Armyunits ya tiene representación canónica (por vínculo de procedencia),
 *   se elimina la copia heredada sin volver a sumar sus cantidades.
 * - Si es un registro heredado no migrado, se inserta en armyUnits conservando todos sus atributos
 *   (tipo, nivel, cantidad, isSpy, heridos, mercenario) y registrando su trazabilidad (migratedFromLegacyId).
 * - Si coexiste un registro canónico del mismo tipo y nivel sin vínculo de procedencia, se preserva
 *   como documento independiente marcado con migrationAmbiguous: true sin perder unidades ni fusionarlas a ciegas.
 */
export async function readArmyUnitsWithMigration(ctx: MutationCtx, kingdomId: Id<"kingdoms">): Promise<any[]> {
  const canonical = await ctx.db
    .query("armyUnits")
    .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
    .collect();
  let legacy: any[] = [];
  try {
    legacy = await (ctx.db as any)
      .query("Armyunits")
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();
  } catch {
    legacy = [];
  }
  if (legacy.length === 0) {
    return canonical;
  }

  const actions = planArmyUnitsMigration(canonical, legacy);
  for (const action of actions) {
    if (action.kind === "quarantine_unrecognized_legacy") {
      console.warn("[MIGRACIÓN CUARENTENA] Registro heredado conservado en Armyunits sin conversión ni borrado:", {
        kingdomId,
        legacyId: action.legacyId,
        rawUnitType: action.rawUnitType,
        reason: action.reason,
      });
      continue;
    }
    if (action.kind === "insert_canonical") {
      const legacyIdStr = String(action.legacyId);
      await ctx.db.insert("armyUnits", {
        kingdomId,
        unitType: action.payload.unitType,
        level: action.payload.level,
        count: action.payload.count,
        isSpy: action.payload.isSpy,
        ...(action.payload.wounded !== undefined ? { wounded: action.payload.wounded } : {}),
        ...(action.payload.recoveryProgress !== undefined ? { recoveryProgress: action.payload.recoveryProgress } : {}),
        ...(action.payload.isMercenary ? { isMercenary: true } : {}),
        ...(action.payload.mercenaryTypeId !== undefined ? { mercenaryTypeId: action.payload.mercenaryTypeId } : {}),
        ...(action.payload.contractEndsAt !== undefined ? { contractEndsAt: action.payload.contractEndsAt } : {}),
        migratedFromLegacyId: legacyIdStr,
        migratedFromLegacyIds: [legacyIdStr],
        ...(action.ambiguous ? { migrationAmbiguous: true } : {}),
      });
    }
    await ctx.db.delete(action.legacyId as any);
  }

  return await ctx.db
    .query("armyUnits")
    .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
    .collect();
}

/** Suma unidades al documento (tipo, nivel) correspondiente, creándolo si no existe. Conserva niveles distintos también en espías. */
export async function addUnits(ctx: MutationCtx, kingdomId: Id<"kingdoms">, unitType: string, level: number, count: number): Promise<void> {
  if (!Number.isInteger(count) || count <= 0) return;
  const normalizedType = normalizeUnitType(unitType) ?? unitType;
  const isSpy = normalizedType === "espia";
  const effectiveLevel = unitLevelOf({ level });
  const docs = await ctx.db
    .query("armyUnits")
    .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
    .collect();
  const existing = docs.find((doc) =>
    isSpy
      ? isSpyUnitDoc(doc) && unitLevelOf(doc) === effectiveLevel && !doc.migrationAmbiguous
      : !isSpyUnitDoc(doc) && !doc.isMercenary && normalizeUnitType(doc.unitType) === normalizedType && unitLevelOf(doc) === effectiveLevel && !doc.migrationAmbiguous
  );
  if (existing) {
    await ctx.db.patch(existing._id, {
      unitType: normalizedType,
      count: existing.count + count,
      level: effectiveLevel,
      isSpy,
    });
  } else {
    await ctx.db.insert("armyUnits", {
      kingdomId,
      unitType: normalizedType,
      level: effectiveLevel,
      count,
      isSpy,
    });
  }
}

async function readTrainingQueue(ctx: QueryCtx | MutationCtx, kingdomId: Id<"kingdoms">) {
  return ctx.db
    .query("trainingQueue")
    .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
    .collect();
}

async function readPopulationDoc(ctx: QueryCtx | MutationCtx, kingdomId: Id<"kingdoms">): Promise<any> {
  return (ctx.db as any)
    .query("population")
    .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
    .first();
}

export const getArmyState = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    const isDemoRead = kingdom.userId === "guest_g9ai8cz";
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar su propio reino.");
    }
    const [units, queue, buildings, population] = await Promise.all([
      readArmyUnitDocs(ctx, args.kingdomId),
      readTrainingQueue(ctx, args.kingdomId),
      ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
      readPopulationDoc(ctx, args.kingdomId),
    ]);
    const completedTechnologies = await readCompletedTechnologyIds(ctx, args.kingdomId);
    const modifiers = computeTechnologyModifiers(completedTechnologies);
    const collection = validateBuildingCollection(buildings);
    const buildingLevels = collection.success ? collection.levels : {};
    const serverTimeMs = Date.now();
    const summary = summarizeArmy(units);
    const slots = trainingQueueSlots(buildingLevels.cuartel ?? 0);
    const kingdomAny = kingdom as any;
    const civPassive = getCivilizationPassive(kingdom.civilization);
    const civIdentity = getCivilizationIdentity(kingdom.civilization);
    const currentArmyLevel = kingdomAny.armyLevel ?? 1;
    const nextArmyLevel = Math.min(5, currentArmyLevel + 1);
    const nextArmyLevelInfo = MILITARY_LEVELS.find((l) => l.level === nextArmyLevel) ?? null;
    const nextArmyLevelReqs = nextArmyLevelInfo ? checkBuildingRequirements(nextArmyLevelInfo.requirements, buildingLevels) : null;


    const explorationExpeditions = await ctx.db
      .query("explorationQueue")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
      .collect();
    const busySpies = explorationExpeditions
      .filter((exp) => exp.isSpyMission)
      .reduce((sum, exp) => sum + (exp.scoutsCount ?? 1), 0);

    return {
      serverTimeMs,
      writable: isKingdomOwner(kingdom.userId, identity?.subject),
      armyLevel: currentArmyLevel,
      globalUpgradeInfo: {
        currentLevel: currentArmyLevel,
        nextLevel: nextArmyLevel,
        isMaxLevel: currentArmyLevel >= 5,
        nextLevelInfo: nextArmyLevelInfo,
        requirementsSatisfied: nextArmyLevelReqs?.satisfied ?? false,
        requirementError: nextArmyLevelReqs && !nextArmyLevelReqs.satisfied ? nextArmyLevelReqs.error : null,
      },
      units,
      summary,
      availableCivil: typeof population?.available === "number" ? population.available : null,
      trainingQueue: queue.map((entry) => ({
        ...entry,
        progressPercent: typeof entry.startedAt === "number" && typeof entry.durationMs === "number"
          ? trainingProgress(entry as TrainingQueueEntry, serverTimeMs)
          : null,
        completesAt: typeof entry.startedAt === "number" && typeof entry.durationMs === "number"
          ? entry.startedAt + entry.durationMs
          : null,
      })),
      queueSlots: slots,
      queueSlotsFree: Math.max(0, slots - queue.length),
      militaryLevels: MILITARY_LEVELS.map((level) => ({
        ...level,
        available: availableMilitaryLevels(buildingLevels).some((entry) => entry.level === level.level),
      })),
      unitCatalog: REGULAR_UNIT_TYPES.map((unitType) => {
        const civCost = civilizationTrainingCostMultiplier(unitType, kingdom.civilization);
        const civDuration = civilizationTrainingDurationMultiplier(unitType, kingdom.civilization);
        const baseCosts = trainingCostsFor(unitType, 1);
        const reqs = unitBuildingRequirements(unitType, kingdom.civilization);
        return {
          unitType,
          ...UNITS[unitType],
          label: civilizationUnitLabel(kingdom.civilization, unitType),
          unitCosts: Object.fromEntries(Object.entries(baseCosts).map(([resource, value]) => [resource, Math.ceil(value * civCost)])) as typeof baseCosts,
          unitDurationMs: trainingDurationMs(unitType, 1, modifiers.trainingDuration * civDuration),
          civilizationCostMultiplier: civCost,
          civilizationDurationMultiplier: civDuration,
          requirementsSatisfied: Object.entries(reqs).every(([type, level]) => (buildingLevels[type] ?? 0) >= level),
        };
      }),
      trainingDurationModifier: modifiers.trainingDuration,
      formation: kingdomAny.formation ?? { infanteria: 1, arqueria: 1, caballeria: 1, asedio: 1 },
      mercenaries: {
        active: units.filter((doc) => doc.isMercenary).reduce((sum, doc) => sum + Math.max(0, doc.count ?? 0), 0),
        contracts: units.filter((doc) => doc.isMercenary).map((doc) => ({
          count: doc.count,
          contractEndsAt: doc.contractEndsAt ?? null,
          typeId: doc.mercenaryTypeId ?? MERCENARIES.DEFAULT_TYPE_ID,
          label: MERCENARIES.TYPES.find((type) => type.id === (doc.mercenaryTypeId ?? MERCENARIES.DEFAULT_TYPE_ID))?.label ?? "Mercenarios",
        })),
        types: MERCENARIES.TYPES.map((type) => ({ ...type, available: (buildingLevels.taberna ?? 0) >= type.minTavernLevel })),
        maxActive: MERCENARIES.MAX_PER_TAVERN_LEVEL * (buildingLevels.taberna ?? 0),
        goldPerUnit: MERCENARIES.GOLD_PER_UNIT,
        salaryGoldPerDay: MERCENARIES.SALARY_GOLD_PER_DAY,
        contractDays: MERCENARIES.CONTRACT_DAYS,
        unitType: MERCENARIES.UNIT_TYPE,
        level: MERCENARIES.LEVEL,
        tavernLevel: buildingLevels.taberna ?? 0,
      },
      equipment: {
        weaponTier: kingdomAny.weaponTier ?? "palo",
        armorTier: kingdomAny.armorTier ?? "ninguna",
        strategy: kingdomAny.strategy ?? "defensiva",
        fatigue: typeof kingdomAny.armyFatigue === "number" ? kingdomAny.armyFatigue : 0,
        availableWeapons: availableWeaponTiers(buildingLevels, modifiers.unlockedWeapons),
        availableArmors: availableArmorTiers(buildingLevels, modifiers.unlockedArmors),
        weaponCatalog: Object.fromEntries(Object.entries(WEAPONS).map(([tier, info]) => [tier, { ...info, label: civilizationWeaponLabel(kingdom.civilization, tier as WeaponTier) }])),
        armorCatalog: Object.fromEntries(Object.entries(ARMORS).map(([tier, info]) => [tier, { ...info, label: civilizationArmorLabel(kingdom.civilization, tier as ArmorTier) }])),
        civilization: kingdom.civilization ?? null,
        civilizationIdentity: civIdentity ? { signatureUnit: civIdentity.signatureUnit, uniqueBuilding: civIdentity.uniqueBuilding } : null,
        civilizationWeakness: civPassive.weakness ?? null,
        strategyCatalog: STRATEGIES,
        tacticalFormation: isTacticalFormation(kingdomAny.tacticalFormation ?? "") ? kingdomAny.tacticalFormation : DEFAULT_TACTICAL_FORMATION,
        tacticalFormationCatalog: TACTICAL_FORMATIONS,
      },
      spies: (() => {
        const activeSpies = units.filter((doc) => isSpyUnitDoc(doc)).reduce((sum, doc) => sum + Math.max(0, doc.count ?? 0), 0);
        const woundedSpies = units.filter((doc) => isSpyUnitDoc(doc)).reduce((sum, doc) => sum + Math.max(0, doc.wounded ?? 0), 0);
        const inQueueSpies = queue.filter((doc) => normalizeUnitType(doc.unitType) === "espia").reduce((sum, doc) => sum + Math.max(0, doc.count ?? 0), 0);
        const capacity = Math.floor((buildingLevels.cuartel ?? 0) / 2);
        const occupied = activeSpies + woundedSpies + busySpies + inQueueSpies;
        return {
          active: activeSpies,
          wounded: woundedSpies,
          busy: busySpies,
          inQueue: inQueueSpies,
          occupied,
          capacity,
          remaining: Math.max(0, capacity - occupied),
          cuartelLevel: buildingLevels.cuartel ?? 0,
        };
      })(),
    };
  },
});

/** [FASE 2] Ascenso global del nivel militar del reino (del nivel 1 al 5). */
export const upgradeArmyLevel = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    targetLevel: v.number(),
  },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    const kingdomAny = kingdom as any;
    const currentLevel = kingdomAny.armyLevel ?? 1;
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const buildings = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect();
    const collection = validateBuildingCollection(buildings);
    if (!collection.success) throw new ConvexError(collection.error);

    const validation = validateGlobalArmyUpgrade({
      currentLevel,
      targetLevel: args.targetLevel,
      buildingLevels: collection.levels,
      resources: settled.settledResources,
    });
    if (!validation.success) throw new ConvexError(validation.error);

    // Deduct costs
    const nextResources: Record<ResourceType, number> = { ...settled.settledResources };
    for (const [res, cost] of Object.entries(validation.costs) as [ResourceType, number][]) {
      nextResources[res] -= cost;
    }
    await ctx.db.patch(settled.resources._id, nextResources);

    // Upgrade kingdom armyLevel
    await ctx.db.patch(args.kingdomId, { armyLevel: args.targetLevel, updatedAt: now });

    // Upgrade all existing combat armyUnits for this kingdom (spies are excluded from military tiers)
    const units = await readArmyUnitsWithMigration(ctx, args.kingdomId);
    let unitsUpgraded = 0;
    for (const doc of units) {
      if (isSpyUnitDoc(doc)) continue;
      await ctx.db.patch(doc._id, { level: args.targetLevel });
      unitsUpgraded += 1;
    }

    return {
      success: true,
      armyLevel: args.targetLevel,
      levelName: validation.levelInfo.name,
      multiplier: validation.levelInfo.multiplier,
      unitsUpgraded,
    };
  },
});

export const startTraining = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    unitType: v.string(),
    count: v.number(),
    level: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    // La liquidación completa lotes vencidos y actualiza la población: todo se lee después de ella.
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const [buildings, queue] = await Promise.all([
      ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
      readTrainingQueue(ctx, args.kingdomId),
    ]);
    const collection = validateBuildingCollection(buildings);
    if (!collection.success) throw new ConvexError(collection.error);
    const completedTechnologies = await readCompletedTechnologyIds(ctx, args.kingdomId);
    const modifiers = computeTechnologyModifiers(completedTechnologies);
    const population = await ctx.db.get(settled.population._id);
    if (!population) throw new Error("No existe documento de población para el reino.");
    // [P6, decisión 21-10-2026] Ventaja y debilidad de la civilización en la instrucción (duración y coste por tipo).
    const civUnitType = normalizeUnitType(args.unitType);
    if (civUnitType === "espia") {
      throw new ConvexError("Los espías no se reclutan en formación militar ordinaria; utiliza la sección de Espionaje ('Instrucción de Agentes').");
    }
    const civDuration = civUnitType ? civilizationTrainingDurationMultiplier(civUnitType, kingdom.civilization) : 1;
    const planResult = createTrainingPlan({
      unitType: args.unitType,
      count: args.count,
      level: args.level ?? (kingdom as any).armyLevel ?? 1,
      resources: settled.settledResources,
      availableCivil: population.available,
      buildingLevels: collection.levels,
      activeTraining: queue as TrainingQueueEntry[],
      now,
      durationModifier: modifiers.trainingDuration * civDuration,
      costModifier: civUnitType ? civilizationTrainingCostMultiplier(civUnitType, kingdom.civilization) : 1,
      civilization: kingdom.civilization,
    });
    if (!planResult.success) throw new ConvexError(planResult.error);
    const plan = planResult.plan;

    const nextResources: Record<ResourceType, number> = { ...settled.settledResources };
    for (const [resource, cost] of Object.entries(plan.costs) as [ResourceType, number][]) {
      nextResources[resource] -= cost;
    }
    await ctx.db.patch(settled.resources._id, nextResources);
    await ctx.db.patch(population._id, { available: population.available - plan.populationReserved });

    const trainingId = await ctx.db.insert("trainingQueue", {
      kingdomId: args.kingdomId,
      unitType: plan.unitType,
      count: plan.count,
      level: plan.level,
      startedAt: plan.startedAt,
      durationMs: plan.durationMs,
      costs: plan.costs,
      populationReserved: plan.populationReserved,
    });
    await ctx.scheduler.runAt(plan.completesAt, internal.army.completeTraining, { trainingId });
    return { success: true, trainingId, ...plan };
  },
});

export const cancelTraining = mutation({
  args: { kingdomId: v.id("kingdoms"), trainingId: v.id("trainingQueue") },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    const entry = await ctx.db.get(args.trainingId);
    if (!entry || entry.kingdomId !== args.kingdomId) throw new ConvexError("El lote de entrenamiento no existe en este reino.");
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const cancellation = calculateTrainingCancellation({ entry: entry as TrainingQueueEntry, serverTimeMs: now });
    if (!cancellation.success) throw new ConvexError(cancellation.error);
    const nextResources: Record<ResourceType, number> = { ...settled.settledResources };
    for (const [resource, amount] of Object.entries(cancellation.refund) as [ResourceType, number][]) {
      nextResources[resource] += amount;
    }
    await ctx.db.patch(settled.resources._id, nextResources);
    const population = await ctx.db.get(settled.population._id);
    if (!population) throw new Error("No existe documento de población para el reino.");
    await ctx.db.patch(population._id, { available: population.available + cancellation.populationReturned });
    await ctx.db.delete(args.trainingId);
    return { success: true, refund: cancellation.refund, populationReturned: cancellation.populationReturned };
  },
});

async function finalizeTraining(ctx: MutationCtx, entry: any, now: number, evaluateMissionsNow: boolean = true): Promise<boolean> {
  if (
    typeof entry.startedAt !== "number" || typeof entry.durationMs !== "number" ||
    typeof entry.count !== "number" || typeof entry.unitType !== "string" ||
    trainingProgress(entry as TrainingQueueEntry, now) !== 100
  ) {
    return false;
  }
  const unitType = normalizeUnitType(entry.unitType);
  if (!unitType) throw new Error(`Tipo de unidad persistido no válido: '${entry.unitType}'.`);
  await addUnits(ctx, entry.kingdomId, unitType, unitLevelOf({ level: entry.level }), entry.count);
  await ctx.db.delete(entry._id);
  await recordMissionEvent(ctx, entry.kingdomId, "troopsTrained", entry.count, evaluateMissionsNow);
  return true;
}

export const completeTraining = internalMutation({
  args: { trainingId: v.id("trainingQueue") },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.trainingId);
    if (!entry) return { success: true, completed: false };
    const completed = await finalizeTraining(ctx, entry, Date.now());
    if (!completed) throw new Error("El lote aún no ha alcanzado su tiempo de finalización.");
    return { success: true, completed: true, unitType: entry.unitType, count: entry.count };
  },
});

/** Salvaguarda: completa en la misma transacción los lotes vencidos de un reino. */
export async function completeDueTraining(ctx: MutationCtx, kingdomId: Id<"kingdoms">, now: number): Promise<number> {
  const queue = await readTrainingQueue(ctx, kingdomId);
  let completed = 0;
  for (const entry of queue) {
    if (await finalizeTraining(ctx, entry, now, false)) completed += 1;
  }
  return completed;
}

/** [MAESTRA P36] El jugador configura equipamiento y estrategia antes del combate. */
export const setArmyEquipment = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    weaponTier: v.string(),
    armorTier: v.string(),
    strategy: v.string(),
    tacticalFormation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.kingdomId);
    const buildings = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect();
    const collection = validateBuildingCollection(buildings);
    if (!collection.success) throw new ConvexError(collection.error);
    const modifiers = computeTechnologyModifiers(await readCompletedTechnologyIds(ctx, args.kingdomId));
    const selection = validateEquipmentSelection({
      weaponTier: args.weaponTier,
      armorTier: args.armorTier,
      strategy: args.strategy,
      buildingLevels: collection.levels,
      unlockedWeapons: modifiers.unlockedWeapons,
      unlockedArmors: modifiers.unlockedArmors,
      tacticalFormation: args.tacticalFormation,
    });
    if (!selection.success) throw new ConvexError(selection.error);
    const patch: any = {
      weaponTier: selection.weaponTier,
      armorTier: selection.armorTier,
      strategy: selection.strategy,
      updatedAt: Date.now(),
    };
    if (selection.tacticalFormation !== undefined) {
      patch.tacticalFormation = selection.tacticalFormation;
    }
    await ctx.db.patch(args.kingdomId, patch);
    return {
      success: true,
      weaponTier: selection.weaponTier,
      armorTier: selection.armorTier,
      strategy: selection.strategy,
      tacticalFormation: patch.tacticalFormation,
    };
  },
});

/**
 * [M-02 + DECISIÓN 21-10-2026] Contratación de mercenarios en la Taberna (P53) por tipo:
 * varios tipos y precios ligados al nivel de la Taberna (MERCENARIES.TYPES), hasta 50 activos por
 * nivel entre todos los tipos, contrato de 7 días reales, pago íntegro al contratar y sin salario.
 * Se suman al censo pero no generan natalidad.
 */
export const hireMercenaries = mutation({
  args: { kingdomId: v.id("kingdoms"), count: v.number(), typeId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const buildings = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect();
    const collection = validateBuildingCollection(buildings);
    if (!collection.success) throw new ConvexError(collection.error);
    const tavernLevel = collection.levels.taberna ?? 0;
    const units = await readArmyUnitsWithMigration(ctx, args.kingdomId);
    const active = units.filter((doc) => doc.isMercenary).reduce((sum, doc) => sum + Math.max(0, doc.count ?? 0), 0);
    const completedTechnologies = await readCompletedTechnologyIds(ctx, args.kingdomId);
    const modifiers = computeTechnologyModifiers(completedTechnologies);
    const hire = validateMercenaryHire({
      typeId: args.typeId,
      count: args.count,
      tavernLevel,
      activeMercenaries: active,
      gold: settled.settledResources.gold,
      mercenaryCostReduction: modifiers.mercenaryCostReduction,
    });
    if (!hire.success) throw new ConvexError(hire.error);
    await ctx.db.patch(settled.resources._id, { ...settled.settledResources, gold: settled.settledResources.gold - hire.cost });
    const contractEndsAt = now + MERCENARIES.CONTRACT_DAYS * TIME.MS_PER_GAME_YEAR;
    await ctx.db.insert("armyUnits", {
      kingdomId: args.kingdomId,
      unitType: hire.type.unitType,
      level: hire.type.level,
      count: args.count,
      isMercenary: true,
      mercenaryTypeId: hire.type.id,
      contractEndsAt,
    });
    const population = await ctx.db.get(settled.population._id);
    if (population) await ctx.db.patch(population._id, { total: population.total + args.count });
    return {
      success: true,
      typeId: hire.type.id,
      label: hire.type.label,
      unitType: hire.type.unitType,
      level: hire.type.level,
      count: args.count,
      cost: hire.cost,
      contractEndsAt,
      salaryGoldPerDay: MERCENARIES.SALARY_GOLD_PER_DAY * args.count,
    };
  },
});

export const recruitSpy = mutation({
  args: { kingdomId: v.id("kingdoms"), count: v.number() },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const buildings = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect();
    const collection = validateBuildingCollection(buildings);
    if (!collection.success) throw new ConvexError(collection.error);

    if (!Number.isInteger(args.count) || args.count < 1) {
      throw new ConvexError("La cantidad de espías debe ser un número entero positivo.");
    }

    const [units, queue, explorationExpeditions] = await Promise.all([
      readArmyUnitsWithMigration(ctx, args.kingdomId),
      readTrainingQueue(ctx, args.kingdomId),
      ctx.db
        .query("explorationQueue")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
        .collect(),
    ]);

    const active = units
      .filter((doc) => isSpyUnitDoc(doc))
      .reduce((sum, doc) => sum + Math.max(0, doc.count ?? 0), 0);
    const woundedSpies = units
      .filter((doc) => isSpyUnitDoc(doc))
      .reduce((sum, doc) => sum + Math.max(0, doc.wounded ?? 0), 0);
    const busySpies = explorationExpeditions
      .filter((exp) => exp.isSpyMission)
      .reduce((sum, exp) => sum + (exp.scoutsCount ?? 1), 0);
    const inQueue = queue
      .filter((doc) => normalizeUnitType(doc.unitType) === "espia")
      .reduce((sum, doc) => sum + Math.max(0, doc.count ?? 0), 0);

    const completedTechnologies = await readCompletedTechnologyIds(ctx, args.kingdomId);
    const modifiers = computeTechnologyModifiers(completedTechnologies);
    const population = await ctx.db.get(settled.population._id);
    if (!population) throw new Error("No existe documento de población para el reino.");

    const planResult = createSpyRecruitmentPlan({
      count: args.count,
      resources: settled.settledResources,
      availableCivil: population.available,
      buildingLevels: collection.levels,
      activeTraining: queue as TrainingQueueEntry[],
      activeSpies: active,
      woundedSpies,
      busySpies,
      inQueueSpies: inQueue,
      now,
      durationModifier: modifiers.trainingDuration,
    });
    if (!planResult.success) throw new ConvexError(planResult.error);
    const plan = planResult.plan;

    const nextResources: Record<ResourceType, number> = { ...settled.settledResources };
    for (const [resource, cost] of Object.entries(plan.costs) as [ResourceType, number][]) {
      nextResources[resource] -= cost;
    }
    await ctx.db.patch(settled.resources._id, nextResources);
    await ctx.db.patch(population._id, { available: population.available - plan.populationReserved });

    const trainingId = await ctx.db.insert("trainingQueue", {
      kingdomId: args.kingdomId,
      unitType: plan.unitType,
      count: plan.count,
      level: plan.level,
      startedAt: plan.startedAt,
      durationMs: plan.durationMs,
      costs: plan.costs,
      populationReserved: plan.populationReserved,
    });
    await ctx.scheduler.runAt(plan.completesAt, internal.army.completeTraining, { trainingId });
    return { success: true, trainingId, ...plan };
  },
});


/** [DECISIÓN 21-10-2026] Formación táctica del ejército: ofensiva, defensiva, equilibrada o flanqueo. */
export const setTacticalFormation = mutation({
  args: { kingdomId: v.id("kingdoms"), tacticalFormation: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.kingdomId);
    if (!isTacticalFormation(args.tacticalFormation)) throw new ConvexError(`Formación desconocida: '${args.tacticalFormation}'.`);
    await ctx.db.patch(args.kingdomId, { tacticalFormation: args.tacticalFormation, updatedAt: Date.now() });
    return { success: true, tacticalFormation: args.tacticalFormation, ...TACTICAL_FORMATIONS[args.tacticalFormation] };
  },
});

/** [MAESTRA P37, M-11] Fracción (0-1) de cada tipo que participa en el próximo combate. */
export const setFormation = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    formation: v.record(v.string(), v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.kingdomId);
    const formation: Partial<Record<UnitType, number>> = {};
    for (const type of REGULAR_UNIT_TYPES) {
      const value = args.formation[type];
      if (value === undefined) continue;
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new ConvexError(`La fracción de '${type}' debe estar entre 0 y 1.`);
      formation[type] = Math.round(value * 100) / 100;
    }
    await ctx.db.patch(args.kingdomId, { formation, updatedAt: Date.now() });
    return { success: true, formation };
  },
});

function activeComposition(units: any[]): Composition {
  const composition = emptyComposition();
  for (const unit of units) {
    if (isSpyUnitDoc(unit)) continue;
    const type = normalizeUnitType(unit.unitType);
    if (!type) continue;
    composition[type] += Number.isInteger(unit.count) && unit.count > 0 ? unit.count : 0;
  }
  return composition;
}

export type RegularMilitaryUnitType = Exclude<UnitType, "espia">;

export type MarchUnitInput = Doc<"armyMarches">["units"][number];

export interface ValidatedMarchUnit {
  unitType: RegularMilitaryUnitType;
  level: number;
  count: number;
}

export type MarchUnitRejectionReason =
  | "invalid_entry"
  | "spy_not_allowed"
  | "unknown_unit_type"
  | "invalid_count"
  | "invalid_level";

export interface RejectedMarchUnit {
  unit: MarchUnitInput;
  reason: MarchUnitRejectionReason;
}

export interface ParsedMarchUnitsResult {
  validUnits: ValidatedMarchUnit[];
  rejectedUnits: RejectedMarchUnit[];
  totalValidCount: number;
}

export interface RefundMarchUnitsOptions {
  /**
   * Política ante composiciones heredadas inválidas:
   * - "strict" (por defecto): rechaza con ConvexError antes de escribir en BD si existe cualquier entrada inválida (sin devoluciones parciales).
   * - "quarantine_legacy": devuelve únicamente las unidades militares válidas consolidadas y registra explícitamente las entradas rechazadas.
   */
  invalidEntryPolicy?: "strict" | "quarantine_legacy";
}

export interface RefundMarchUnitsResult {
  refundedUnits: ValidatedMarchUnit[];
  rejectedUnits: RejectedMarchUnit[];
  totalRefunded: number;
}

export interface MarchRefundPatch {
  status: "completada" | "cancelada";
  cancelledAt?: number;
  cancelReason?: string;
  battleResult?: unknown;
}

export interface RefundMarchOnceResult extends RefundMarchUnitsResult {
  alreadyRefunded: boolean;
}

/**
 * Valida y consolida una composición de marcha sin modificar la base de datos.
 * - Rechaza expresamente espías (tanto unitType "espia" como documentos con isSpy: true).
 * - Rechaza tipos desconocidos, cantidades no enteras o <= 0, y niveles explícitamente fuera de [1, 5].
 * - Nunca transforma un nivel inválido en nivel 1 (solo la ausencia del campo opcional `level` en registros heredados equivale a nivel 1).
 */
export function parseMarchUnits(units: ReadonlyArray<MarchUnitInput>): ParsedMarchUnitsResult {
  const consolidated = new Map<string, ValidatedMarchUnit>();
  const rejectedUnits: RejectedMarchUnit[] = [];

  for (const u of units) {
    if (!u || typeof u !== "object") {
      rejectedUnits.push({ unit: u, reason: "invalid_entry" });
      continue;
    }
    if (isSpyUnitDoc(u)) {
      rejectedUnits.push({ unit: u, reason: "spy_not_allowed" });
      continue;
    }
    const normalized = normalizeUnitType(u.unitType);
    if (!normalized) {
      rejectedUnits.push({ unit: u, reason: "unknown_unit_type" });
      continue;
    }
    if (normalized === "espia") {
      rejectedUnits.push({ unit: u, reason: "spy_not_allowed" });
      continue;
    }
    if (typeof u.count !== "number" || !Number.isInteger(u.count) || u.count <= 0) {
      rejectedUnits.push({ unit: u, reason: "invalid_count" });
      continue;
    }
    const level = u.level === undefined ? 1 : u.level;
    if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 5) {
      rejectedUnits.push({ unit: u, reason: "invalid_level" });
      continue;
    }

    const key = `${normalized}:${level}`;
    const existing = consolidated.get(key);
    if (existing) {
      existing.count += u.count;
    } else {
      consolidated.set(key, {
        unitType: normalized,
        level,
        count: u.count,
      });
    }
  }

  const validUnits = Array.from(consolidated.values());
  const totalValidCount = validUnits.reduce((sum, u) => sum + u.count, 0);
  return { validUnits, rejectedUnits, totalValidCount };
}

export async function refundMarchUnitsToGarrison(
  ctx: MutationCtx,
  kingdomId: Id<"kingdoms">,
  units: ReadonlyArray<MarchUnitInput>,
  options: RefundMarchUnitsOptions = {}
): Promise<RefundMarchUnitsResult> {
  const policy = options.invalidEntryPolicy ?? "strict";
  const parsed = parseMarchUnits(units);

  if (parsed.rejectedUnits.length > 0) {
    if (policy === "strict") {
      const summary = parsed.rejectedUnits
        .map((r) => `${String(r.unit?.unitType ?? "desconocido")}:${String(r.unit?.level ?? "?")}:${String(r.unit?.count ?? "?")}(${r.reason})`)
        .join(", ");
      throw new ConvexError(`Composición de marcha inválida para devolución a guarnición: ${summary}`);
    }
    console.warn("[DEVOLUCIÓN MARCHA] Entradas inválidas o de espía rechazadas sin conversión:", {
      kingdomId,
      rejectedUnits: parsed.rejectedUnits,
    });
  }

  for (const unit of parsed.validUnits) {
    await addUnits(ctx, kingdomId, unit.unitType, unit.level, unit.count);
  }

  return {
    refundedUnits: parsed.validUnits,
    rejectedUnits: parsed.rejectedUnits,
    totalRefunded: parsed.totalValidCount,
  };
}

/**
 * Devuelve las tropas de una marcha a la guarnición exactamente una vez dentro de la transacción de Convex.
 * - Comprueba atómicamente `status === "marchando"` y `unitsRefundedAt == null`.
 * - Si la validación o restauración falla, la mutación hace rollback sin marcar `unitsRefundedAt`.
 */
export async function refundMarchToGarrisonOnce(
  ctx: MutationCtx,
  marchId: Id<"armyMarches">,
  patchOnRefund: MarchRefundPatch,
  options: RefundMarchUnitsOptions = { invalidEntryPolicy: "quarantine_legacy" }
): Promise<RefundMarchOnceResult> {
  const freshMarch = await ctx.db.get(marchId);
  if (!freshMarch || freshMarch.status !== "marchando" || freshMarch.unitsRefundedAt != null) {
    return {
      alreadyRefunded: true,
      refundedUnits: [],
      rejectedUnits: [],
      totalRefunded: 0,
    };
  }

  const refundNow = Date.now();
  const refundResult = await refundMarchUnitsToGarrison(
    ctx,
    freshMarch.kingdomId,
    freshMarch.units,
    options
  );

  await ctx.db.patch(marchId, {
    status: patchOnRefund.status,
    ...(patchOnRefund.cancelledAt !== undefined ? { cancelledAt: patchOnRefund.cancelledAt } : {}),
    ...(patchOnRefund.cancelReason !== undefined ? { cancelReason: patchOnRefund.cancelReason } : {}),
    ...(patchOnRefund.battleResult !== undefined ? { battleResult: patchOnRefund.battleResult } : {}),
    unitsRefundedAt: refundNow,
  });

  return {
    alreadyRefunded: false,
    ...refundResult,
  };
}

export async function applyCasualtiesToArmy(ctx: MutationCtx, kingdomId: Id<"kingdoms">, casualties: Composition, wounded: Composition): Promise<void> {
  const units = await readArmyUnitsWithMigration(ctx, kingdomId);
  for (const type of UNIT_TYPES as readonly UnitType[]) {
    if (type === "espia") continue;
    let remaining = casualties[type];
    const docs = units
      .filter((doc) => !isSpyUnitDoc(doc) && normalizeUnitType(doc.unitType) === type)
      .sort((a, b) => b.count - a.count || String(a._id).localeCompare(String(b._id)));
    for (const doc of docs) {
      if (remaining <= 0) break;
      const removed = Math.min(doc.count, remaining);
      await ctx.db.patch(doc._id, { count: doc.count - removed });
      remaining -= removed;
    }
    const woundedCount = wounded[type];
    if (woundedCount > 0) {
      const host = docs[0];
      if (host) {
        await ctx.db.patch(host._id, { wounded: (host.wounded ?? 0) + woundedCount });
      } else {
        await ctx.db.insert("armyUnits", { kingdomId, unitType: type, level: 1, count: 0, wounded: woundedCount, isSpy: false });
      }
    }
  }
}

async function removeDeadFromPopulation(ctx: MutationCtx, kingdomId: Id<"kingdoms">, casualties: Composition, wounded: Composition): Promise<void> {
  let deadPersons = 0;
  for (const type of UNIT_TYPES as readonly UnitType[]) {
    const dead = Math.max(0, casualties[type] - wounded[type]);
    deadPersons += dead * UNITS[type].populationPerUnit;
  }
  if (deadPersons <= 0) return;
  const population: any = await (ctx.db as any).query("population").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).first();
  if (!population) return;
  await ctx.db.patch(population._id, { total: Math.max(0, population.total - deadPersons) });
}

export const launchAttack = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    cellId: v.string(),
    units: v.array(v.object({
      unitType: v.string(),
      level: v.optional(v.number()),
      count: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    if (kingdom.userId === "guest_g9ai8cz") throw new Error("El reino demo no puede lanzar ataques.");
    const now = Date.now();
    await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);

    const target = await getOrCreateTerritoryCell(ctx, args.cellId);
    if (!target) throw new Error("El territorio objetivo no existe en el mapa.");
    if (target.ownerKingdomId && String(target.ownerKingdomId) === String(args.kingdomId)) throw new Error("No puedes atacar ni marchar sobre tu propio territorio.");

    const knownSet = await readKnownCellIds(ctx, args.kingdomId);
    if (!knownSet.has(args.cellId)) {
      throw new Error("El territorio objetivo debe estar explorado o descubierto por expedición/espionaje antes de poder enviar tropas.");
    }

    const homeCoord = await readHomeCoord(ctx, args.kingdomId);
    if (!homeCoord) throw new Error("El reino no tiene territorio principal asignado.");

    const ownedDocs = await ctx.db
      .query("territories")
      .withIndex("by_owner", (q) => q.eq("ownerKingdomId", args.kingdomId))
      .collect();
    const ownedCellIds = new Set<string>();
    const ownedCoords: Array<{ q: number; r: number }> = [];
    for (const t of ownedDocs) {
      ownedCellIds.add(t.cellId);
      ownedCoords.push({ q: t.q, r: t.r });
    }
    const homeCellKey = cellId(homeCoord.q, homeCoord.r);
    if (!ownedCellIds.has(homeCellKey)) {
      ownedCellIds.add(homeCellKey);
      ownedCoords.push(homeCoord);
    }

    let authorizedChallengeId: Id<"challenges"> | undefined = undefined;

    // [VALIDACIÓN FRONTERA + TOPE 100]: Solo permitir conquistar si es neutral adyacente a territorio propio y < 100 territorios
    if (!target.ownerKingdomId) {
      if (ownedCellIds.size >= TERRITORIES.MAX_PER_KINGDOM) {
        throw new ConvexError(
          `Has alcanzado el límite máximo de ${TERRITORIES.MAX_PER_KINGDOM} territorios por reino (actuales: ${ownedCellIds.size}).`
        );
      }
      const neighbors = hexNeighbors({ q: target.q, r: target.r }, MAP.RADIUS);
      const isAdjacentToOwned = neighbors.some((n) => ownedCoords.some((o) => o.q === n.q && o.r === n.r));
      if (!isAdjacentToOwned) {
        throw new Error("El territorio neutral debe limitar con una de tus casillas propias para poder conquistarlo (Expansión contigua).");
      }
    } else {
      // [MAESTRA P38] No existen ataques sorpresivos ni prematuros entre reinos:
      // se exige un desafío parlamentario ACCEPTED exactamente entre atacante y defensor,
      // con ventana y scheduledAt válidos ya alcanzados, sin caducar y no reutilizado.
      const [asChallenger, existingMarches] = await Promise.all([
        ctx.db.query("challenges").withIndex("by_challenger", (q) => q.eq("challengerKingdomId", args.kingdomId)).collect(),
        ctx.db.query("armyMarches").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
      ]);

      const usedChallengeIds = new Set<string>();
      for (const m of existingMarches) {
        if (m.challengeId && m.status !== "cancelada") {
          usedChallengeIds.add(String(m.challengeId));
        }
      }

      const pairChallenges = asChallenger.filter(
        (ch) =>
          String(ch.challengerKingdomId) === String(args.kingdomId) &&
          String(ch.targetKingdomId) === String(target.ownerKingdomId)
      );

      const acceptedUnused = pairChallenges.filter(
        (ch) =>
          ch.status === "ACCEPTED" &&
          !ch.battleId &&
          !ch.resolvedAt &&
          !ch.activeMarchId &&
          !ch.resolutionLockedBy &&
          !usedChallengeIds.has(String(ch._id))
      );

      if (acceptedUnused.length === 0) {
        const hasFrozen = pairChallenges.some((ch) => ch.status === "FROZEN");
        if (hasFrozen) {
          throw new ConvexError(
            "Procedimiento de Parlamento requerido (P38): el desafío ya está congelado (FROZEN) para resolución automática del Parlamento y no admite ataques manuales."
          );
        }
        const hasReusedOrResolved = pairChallenges.some(
          (ch) =>
            ch.status === "RESOLVED" ||
            Boolean(ch.battleId) ||
            Boolean(ch.resolvedAt) ||
            Boolean(ch.activeMarchId) ||
            Boolean(ch.resolutionLockedBy) ||
            usedChallengeIds.has(String(ch._id))
        );
        if (hasReusedOrResolved) {
          throw new ConvexError(
            "Procedimiento de Parlamento requerido (P38): el desafío ya fue utilizado o resuelto y no puede reutilizarse para ataques adicionales."
          );
        }
        throw new ConvexError(
          "Procedimiento de Parlamento requerido (P38): para atacar territorios de otro reino debes contar con un desafío aceptado (ACCEPTED) vigente entre atacante y defensor."
        );
      }

      const validScheduled = acceptedUnused.filter((ch) => {
        const hasValidWindow = typeof ch.window === "string" && isScheduleWindow(ch.window);
        const hasValidScheduledAt = typeof ch.scheduledAt === "number" && Number.isFinite(ch.scheduledAt) && ch.scheduledAt > 0;
        const hasValidFreezeAt = typeof ch.freezeAt === "number" && Number.isFinite(ch.freezeAt) && ch.freezeAt <= (ch.scheduledAt as number);
        const notExpiredBeforeResponse = typeof ch.respondedAt === "number" ? ch.respondedAt < ch.expiresAt : now < ch.expiresAt;
        return hasValidWindow && hasValidScheduledAt && hasValidFreezeAt && notExpiredBeforeResponse;
      });

      if (validScheduled.length === 0) {
        throw new ConvexError(
          "Procedimiento de Parlamento requerido (P38): el desafío aceptado carece de una programación temporal válida (window, freezeAt, scheduledAt)."
        );
      }

      const readyChallenge = validScheduled.find((ch) => now >= (ch.scheduledAt as number));
      if (!readyChallenge) {
        throw new ConvexError(
          "Procedimiento de Parlamento requerido (P38): aún no ha llegado la fecha y hora programadas (scheduledAt) para iniciar el combate."
        );
      }

      authorizedChallengeId = readyChallenge._id;
    }

    const distance = ownedCoords.length
      ? Math.max(1, Math.min(...ownedCoords.map((c) => hexDistance(c, { q: target.q, r: target.r }))))
      : hexDistance(homeCoord, { q: target.q, r: target.r });

    const currentArmy = await readArmyUnitsWithMigration(ctx, args.kingdomId);
    const requestedComposition: Partial<Record<UnitType, number>> = {};
    const requestedByTypeLevel = new Map<string, ValidatedMarchUnit>();

    for (const req of args.units) {
      if (!Number.isInteger(req.count) || req.count <= 0) {
        throw new ConvexError("Cada cantidad de tropas debe ser un entero positivo.");
      }
      const normalized = normalizeUnitType(req.unitType);
      if (!normalized) {
        throw new ConvexError(`Tipo de unidad no válido para una marcha: '${req.unitType}'.`);
      }
      if (normalized === "espia") {
        throw new ConvexError("Los espías no participan en marchas de ataque ni conquista territorial; solo en expediciones de exploración o espionaje.");
      }
      const level = req.level ?? 1;
      if (!Number.isInteger(level) || level < 1 || level > 5) {
        throw new ConvexError(`Nivel militar no válido para '${normalized}': ${level}.`);
      }
      const key = `${normalized}:${level}`;
      const previous = requestedByTypeLevel.get(key);
      requestedByTypeLevel.set(key, {
        unitType: normalized,
        level,
        count: (previous?.count ?? 0) + req.count,
      });
      requestedComposition[normalized] = (requestedComposition[normalized] ?? 0) + req.count;
    }

    if (requestedByTypeLevel.size === 0) {
      throw new ConvexError("Debes seleccionar al menos un tipo de tropa válido para la marcha.");
    }

    for (const request of requestedByTypeLevel.values()) {
      const matchingDocs = currentArmy.filter((doc) =>
        !isSpyUnitDoc(doc) &&
        normalizeUnitType(doc.unitType) === request.unitType &&
        unitLevelOf(doc) === request.level
      );
      const availableCount = matchingDocs.reduce(
        (sum, doc) => sum + (Number.isInteger(doc.count) && doc.count > 0 ? doc.count : 0),
        0
      );
      if (availableCount < request.count) {
        throw new ConvexError(`Tropas insuficientes de '${request.unitType}' nivel ${request.level}: solicitadas ${request.count}, disponibles ${availableCount}.`);
      }
    }

    for (const request of requestedByTypeLevel.values()) {
      let remaining = request.count;
      const matchingDocs = currentArmy
        .filter((doc) =>
          !isSpyUnitDoc(doc) &&
          normalizeUnitType(doc.unitType) === request.unitType &&
          unitLevelOf(doc) === request.level &&
          Number.isInteger(doc.count) &&
          doc.count > 0
        )
        .sort((a, b) => b.count - a.count || String(a._id).localeCompare(String(b._id)));
      for (const doc of matchingDocs) {
        if (remaining <= 0) break;
        const taken = Math.min(doc.count, remaining);
        const nextCount = doc.count - taken;
        if (nextCount <= 0) {
          await ctx.db.delete(doc._id);
        } else {
          await ctx.db.patch(doc._id, { count: nextCount });
        }
        remaining -= taken;
      }
      if (remaining !== 0) {
        throw new ConvexError(`No se pudo reservar íntegramente la composición de '${request.unitType}' nivel ${request.level}.`);
      }
    }

    // [R-14, decisión 23-10-2026] Media del terreno del camino (origen excluido, destino incluido).
    const terrainMul = await readPathTerrainMultiplier(ctx, homeCoord, { q: target.q, r: target.r });
    const unitMul = armyMarchMultiplier(requestedComposition, kingdom.civilization);
    const civPassive = getCivilizationPassive(kingdom.civilization);
    const durationSeconds = marchTimeSeconds(distance, terrainMul, unitMul, civPassive?.marchSpeedMultiplier ?? 1.0);
    const durationMs = Math.round(durationSeconds * 1000);
    const completesAt = now + durationMs;

    const isConquest = !target.ownerKingdomId;

    const normalizedMarchUnits: ValidatedMarchUnit[] = Array.from(
      requestedByTypeLevel.values()
    ).map((unit) => ({
      unitType: unit.unitType,
      level: unit.level,
      count: unit.count,
    }));

    const marchId = await ctx.db.insert("armyMarches", {
      kingdomId: args.kingdomId,
      targetCellId: args.cellId,
      targetQ: target.q,
      targetR: target.r,
      distance,
      terrainMultiplier: terrainMul,
      units: normalizedMarchUnits,
      startedAt: now,
      durationMs,
      completesAt,
      status: "marchando",
      isConquest,
      ...(authorizedChallengeId ? { challengeId: authorizedChallengeId } : {}),
    });

    if (authorizedChallengeId) {
      await ctx.db.patch(authorizedChallengeId, {
        activeMarchId: marchId,
        resolutionLockedBy: "march",
      });
    }

    await ctx.scheduler.runAt(completesAt, internal.army.completeMarchScheduled, { marchId });

    return {
      success: true,
      marchId,
      cellId: args.cellId,
      distance,
      durationSeconds,
      completesAt,
    };
  },
});

export async function resolveMarch(ctx: MutationCtx, marchId: Id<"armyMarches">) {
  const march = await ctx.db.get(marchId);
  if (!march || march.status !== "marchando" || march.unitsRefundedAt != null) return null;

  const attackerKingdom = await ctx.db.get(march.kingdomId);
  if (!attackerKingdom) {
    await ctx.db.patch(marchId, {
      status: "cancelada",
      cancelledAt: Date.now(),
      cancelReason: "attacker_kingdom_missing",
    });
    return null;
  }

  const targetCell = await getOrCreateTerritoryCell(ctx, march.targetCellId);

  const currentFatigue = typeof attackerKingdom.armyFatigue === "number" ? attackerKingdom.armyFatigue : 0;
  const attackerCiv = getCivilizationPassive(attackerKingdom.civilization);
  const attackerTech = computeTechnologyModifiers(await readCompletedTechnologyIds(ctx, march.kingdomId));
  const newFatigue = marchFatigue(
    currentFatigue,
    march.distance,
    typeof march.terrainMultiplier === "number" ? march.terrainMultiplier : 1,
    attackerCiv?.fatigueAccrualMultiplier ?? 1.0,
    attackerTech.marchFatigueReduction,
    attackerTech.fatigueAccrualReduction
  );
  await ctx.db.patch(march.kingdomId, { armyFatigue: newFatigue });

  if (!targetCell || !targetCell.ownerKingdomId || targetCell.ownerKingdomId === march.kingdomId) {
    let capBlocked = false;
    if (targetCell && !targetCell.ownerKingdomId) {
      const liveOwned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", march.kingdomId))
        .collect();
      const liveOwnedIds = new Set(liveOwned.map((c) => c.cellId));
      if (attackerKingdom.homeTerritoryId) liveOwnedIds.add(attackerKingdom.homeTerritoryId);

      if (liveOwnedIds.size >= TERRITORIES.MAX_PER_KINGDOM) {
        capBlocked = true;
      } else {
        await patchTerritoryCell(ctx, march.targetCellId, {
          ownerKingdomId: march.kingdomId,
          claimedAt: Date.now(),
          isHome: false,
        });
        await recordMissionEvent(ctx, march.kingdomId, "territoriesClaimed", 1, false);
        const currentAttackerDoc = await ctx.db.get(march.kingdomId);
        if (currentAttackerDoc) {
          await ctx.db.patch(march.kingdomId, {
            glory: (currentAttackerDoc.glory ?? 0) + 1,
            honor: (currentAttackerDoc.honor ?? 0) + 1,
            conquestRewardsGranted: (currentAttackerDoc.conquestRewardsGranted ?? 0) + 1,
            updatedAt: Date.now(),
          });
        }
      }
    }
    const alreadyOwnedBySelf = Boolean(targetCell && targetCell.ownerKingdomId === march.kingdomId);
    const outcome = capBlocked
      ? "limite_territorios_alcanzado"
      : alreadyOwnedBySelf
        ? "terreno_ya_propio"
        : "conquista_neutral";
    await refundMarchToGarrisonOnce(ctx, marchId, {
      status: "completada",
      battleResult: capBlocked
        ? {
            outcome,
            crushingVictory: false,
            note: `Límite máximo de ${TERRITORIES.MAX_PER_KINGDOM} territorios alcanzado; el territorio neutral no se ha anexionado.`,
          }
        : alreadyOwnedBySelf
          ? {
              outcome,
              crushingVictory: false,
              note: "El territorio objetivo ya pertenecía a tu reino al llegar la marcha; tropas devueltas sin duplicar recompensas.",
            }
          : { outcome, crushingVictory: false },
    });
    return { success: true, outcome, cellId: march.targetCellId, territoryCapBlocked: capBlocked };
  }

  // Si la marcha fue enviada como conquista territorial sobre casilla neutral, pero al llegar ya tiene soberano (carrera entre jugadores):
  // La resolución atómica es retorno automático sin combate, sin bajas y liberando el cupo de tropas.
  if (march.isConquest && targetCell.ownerKingdomId && targetCell.ownerKingdomId !== march.kingdomId) {
    await refundMarchToGarrisonOnce(ctx, marchId, {
      status: "completada",
      battleResult: {
        outcome: "terreno_ya_reclamado",
        note: "El territorio neutral fue reclamado por otro soberano antes de la llegada de tus tropas.",
      },
    });
    return {
      success: true,
      outcome: "terreno_ya_reclamado",
      cellId: march.targetCellId,
      message: "El territorio neutral fue reclamado por otro soberano antes de la llegada de tus tropas. Tus tropas regresaron a la guarnición sin bajas.",
    };
  }

  const defenderKingdomId = targetCell.ownerKingdomId;
  const defenderKingdom = await ctx.db.get(defenderKingdomId);
  if (!defenderKingdom) {
    await refundMarchToGarrisonOnce(ctx, marchId, {
      status: "completada",
      battleResult: { outcome: "sin_oposicion" },
    });
    return { success: true, outcome: "sin_oposicion" };
  }

  const parsedAttackerUnits = parseMarchUnits(march.units);
  if (parsedAttackerUnits.rejectedUnits.length > 0) {
    console.warn("[RESOLUCIÓN MARCHA] Entradas inválidas o de espía excluidas antes de combate:", {
      marchId,
      kingdomId: march.kingdomId,
      rejectedUnits: parsedAttackerUnits.rejectedUnits,
    });
  }
  if (parsedAttackerUnits.validUnits.length === 0) {
    const cancelNow = Date.now();
    await ctx.db.patch(marchId, {
      status: "cancelada",
      cancelledAt: cancelNow,
      cancelReason: "invalid_march_composition",
      unitsRefundedAt: cancelNow,
      battleResult: {
        outcome: "composicion_invalida",
        note: "La marcha no contenía tropas militares válidas; se canceló sin combate ni conversión de espías.",
      },
    });
    return { success: false, outcome: "composicion_invalida" };
  }

  const attackerUnitsDocs = parsedAttackerUnits.validUnits.map((u) => ({
    unitType: u.unitType,
    level: u.level,
    count: u.count,
    isSpy: false,
  }));
  const attackerComposition = activeComposition(attackerUnitsDocs);
  const attackerSummary = summarizeArmy(attackerUnitsDocs);

  const defenderUnitsDocs = await readArmyUnitsWithMigration(ctx, defenderKingdomId);
  const defenderComposition = activeComposition(defenderUnitsDocs);
  const defenderSummary = summarizeArmy(defenderUnitsDocs);

  const defenderBuildings = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", defenderKingdomId)).collect();
  const defCollection = validateBuildingCollection(defenderBuildings);
  const defLevels = defCollection.success ? defCollection.levels : {};


  const attackerSide: BattleSide = {
    kingdomId: march.kingdomId,
    name: attackerKingdom.name,
    composition: applyFormation(attackerComposition, attackerKingdom.formation ?? null),
    trainingMultiplier: attackerSummary.trainingMultiplier,
    weaponTier: (attackerKingdom.weaponTier as any) ?? "palo",
    armorTier: (attackerKingdom.armorTier as any) ?? "ninguna",
    strategy: (attackerKingdom.strategy as any) ?? "defensiva",
    tacticalFormation: isTacticalFormation(attackerKingdom.tacticalFormation ?? "") ? (attackerKingdom.tacticalFormation as BattleSide["tacticalFormation"]) : DEFAULT_TACTICAL_FORMATION,
    morale: typeof attackerKingdom.militaryMorale === "number" ? attackerKingdom.militaryMorale : 70,
    foodTier: attackerKingdom.foodTier ?? "normal",
    fatigue: newFatigue,
    wallsLevel: 0,
    terrainDefenseBonus: 0,
    civilization: attackerKingdom.civilization,
    combatAttackBonus: attackerTech.combatAttackBonus,
    combatDefenseBonus: attackerTech.combatDefenseBonus,
    moraleBase: attackerTech.moraleBase,
    unitEfficiencyInf: attackerTech.unitEfficiencyInf,
    unitEfficiencyArc: attackerTech.unitEfficiencyArc,
    unitEfficiencyCav: attackerTech.unitEfficiencyCav,
    woundedRateBonus: attackerTech.woundedRateBonus,
  };

  const defenderTech = computeTechnologyModifiers(await readCompletedTechnologyIds(ctx, defenderKingdomId));
  const terrainDefBonus = (TERRAINS as any)[targetCell.terrain]?.defense ?? 0;
  const defenderSide: BattleSide = {
    kingdomId: defenderKingdomId,
    name: defenderKingdom.name,
    composition: applyFormation(defenderComposition, defenderKingdom.formation ?? null),
    trainingMultiplier: defenderSummary.trainingMultiplier,
    weaponTier: (defenderKingdom.weaponTier as any) ?? "palo",
    armorTier: (defenderKingdom.armorTier as any) ?? "ninguna",
    strategy: (defenderKingdom.strategy as any) ?? "defensiva",
    tacticalFormation: isTacticalFormation(defenderKingdom.tacticalFormation ?? "") ? (defenderKingdom.tacticalFormation as BattleSide["tacticalFormation"]) : DEFAULT_TACTICAL_FORMATION,
    morale: typeof defenderKingdom.militaryMorale === "number" ? defenderKingdom.militaryMorale : 70,
    foodTier: defenderKingdom.foodTier ?? "normal",
    fatigue: typeof defenderKingdom.armyFatigue === "number" ? defenderKingdom.armyFatigue : 0,
    wallsLevel: defLevels.murallas ?? 0,
    terrainDefenseBonus: terrainDefBonus,
    civilization: defenderKingdom.civilization,
    combatAttackBonus: defenderTech.combatAttackBonus,
    combatDefenseBonus: defenderTech.combatDefenseBonus,
    moraleBase: defenderTech.moraleBase,
    unitEfficiencyInf: defenderTech.unitEfficiencyInf,
    unitEfficiencyArc: defenderTech.unitEfficiencyArc,
    unitEfficiencyCav: defenderTech.unitEfficiencyCav,
    woundedRateBonus: defenderTech.woundedRateBonus,
  };

  // [P38] Exclusión mutua y garantía de batalla única: si la marcha está vinculada a un desafío
  // que ya fue resuelto, cancelado o bloqueado por el Parlamento, abortar combate y devolver tropas sin bajas.
  if (march.challengeId) {
    const linkedChallenge = await ctx.db.get(march.challengeId);
    const existingBattle = await ctx.db
      .query("Battle")
      .withIndex("by_challenge", (q) => q.eq("challengeId", march.challengeId!))
      .first();

    const invalidChallengeState =
      !linkedChallenge ||
      Boolean(existingBattle) ||
      Boolean(linkedChallenge.battleId) ||
      Boolean(linkedChallenge.resolvedAt) ||
      linkedChallenge.status === "RESOLVED" ||
      linkedChallenge.status === "CANCELLED" ||
      linkedChallenge.status === "REJECTED" ||
      linkedChallenge.status === "EXPIRED" ||
      (linkedChallenge.resolutionLockedBy && linkedChallenge.resolutionLockedBy !== "march") ||
      (linkedChallenge.activeMarchId && String(linkedChallenge.activeMarchId) !== String(marchId));

    if (invalidChallengeState) {
      const cancelNow = Date.now();
      await refundMarchToGarrisonOnce(ctx, marchId, {
        status: "cancelada",
        cancelledAt: cancelNow,
        cancelReason: "challenge_already_resolved_or_cancelled",
        battleResult: {
          outcome: "desafio_no_vigente",
          note: "El desafío parlamentario ya fue resuelto o cancelado antes de la llegada de la marcha; las tropas regresan sin bajas.",
        },
      });
      return { success: false, outcome: "desafio_no_vigente" };
    }
  }

  const report = simulateBattle(attackerSide, defenderSide);
  const now = Date.now();

  const battleId = await ctx.db.insert("Battle", {
    challengeId: march.challengeId ?? (null as any),
    attackerKingdomId: march.kingdomId,
    defenderKingdomId,
    resolvedAt: now,
    outcome: report.outcome,
    winnerKingdomId: report.winnerKingdomId ? (report.winnerKingdomId as Id<"kingdoms">) : undefined,
    crushingVictory: report.crushingVictory,
    report,
  });

  if (march.challengeId) {
    const linkedChallenge = await ctx.db.get(march.challengeId);
    if (linkedChallenge && linkedChallenge.status !== "RESOLVED") {
      await ctx.db.patch(march.challengeId, {
        status: "RESOLVED",
        resolvedAt: now,
        battleId,
        resolutionLockedBy: "march",
      });
    }
  }

  const unitsByType: Partial<Record<RegularMilitaryUnitType, ValidatedMarchUnit[]>> = {};
  for (const u of parsedAttackerUnits.validUnits) {
    const existingList = unitsByType[u.unitType] ?? [];
    existingList.push({ unitType: u.unitType, level: u.level, count: u.count });
    unitsByType[u.unitType] = existingList;
  }

  for (const [type, survivorsTotal] of Object.entries(report.attacker.survivorsComposition) as [UnitType, number][]) {
    if (type === "espia" || survivorsTotal <= 0) continue;
    const groups = unitsByType[type];
    if (!groups || groups.length === 0) {
      await addUnits(ctx, march.kingdomId, type, 1, survivorsTotal);
      continue;
    }
    const totalSent = groups.reduce((sum, g) => sum + g.count, 0);
    let remainingSurvivors = survivorsTotal;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const share = i === groups.length - 1 ? remainingSurvivors : Math.round(survivorsTotal * (g.count / totalSent));
      const countToAdd = Math.min(remainingSurvivors, Math.max(0, share));
      if (countToAdd > 0) {
        await addUnits(ctx, march.kingdomId, type, g.level, countToAdd);
        remainingSurvivors -= countToAdd;
      }
    }
  }

  for (const [type, woundedTotal] of Object.entries(report.attacker.woundedComposition) as [UnitType, number][]) {
    if (type === "espia" || woundedTotal <= 0) continue;
    const groups = unitsByType[type];
    if (!groups || groups.length === 0) {
      const docs = await ctx.db
        .query("armyUnits")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", march.kingdomId))
        .collect();
      const host = docs.find((d) => !isSpyUnitDoc(d) && normalizeUnitType(d.unitType) === type);
      if (host) {
        await ctx.db.patch(host._id, { wounded: (host.wounded ?? 0) + woundedTotal });
      } else {
        await ctx.db.insert("armyUnits", { kingdomId: march.kingdomId, unitType: type, level: 1, count: 0, wounded: woundedTotal, isSpy: false });
      }
      continue;
    }
    const totalSent = groups.reduce((sum, g) => sum + g.count, 0);
    let remainingWounded = woundedTotal;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const share = i === groups.length - 1 ? remainingWounded : Math.round(woundedTotal * (g.count / totalSent));
      const countToAdd = Math.min(remainingWounded, Math.max(0, share));
      if (countToAdd > 0) {
        const docs = await ctx.db
          .query("armyUnits")
          .withIndex("by_kingdom", (q) => q.eq("kingdomId", march.kingdomId))
          .collect();
        const host = docs.find((d) => !isSpyUnitDoc(d) && normalizeUnitType(d.unitType) === type && unitLevelOf(d) === g.level);
        if (host) {
          await ctx.db.patch(host._id, { wounded: (host.wounded ?? 0) + countToAdd });
        } else {
          await ctx.db.insert("armyUnits", { kingdomId: march.kingdomId, unitType: type, level: g.level, count: 0, wounded: countToAdd, isSpy: false });
        }
        remainingWounded -= countToAdd;
      }
    }
  }

  // [MAESTRA P54] Descontar los muertos definitivos del censo tanto del atacante como del defensor.
  await removeDeadFromPopulation(ctx, march.kingdomId, report.attacker.casualtiesComposition, report.attacker.woundedComposition);
  await applyCasualtiesToArmy(ctx, defenderKingdomId, report.defender.casualtiesComposition, report.defender.woundedComposition);
  await removeDeadFromPopulation(ctx, defenderKingdomId, report.defender.casualtiesComposition, report.defender.woundedComposition);

  let territoryCapBlocked = false;
  let capitalProtected = false;
  if (report.outcome === "victoria" && targetCell) {
    if (targetCell.isHome) {
      // [MAESTRA P48] La capital (territorio principal) no puede ser conquistada ni perder su condición de capital.
      capitalProtected = true;
    } else {
      const liveOwned = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", march.kingdomId))
        .collect();
      const liveOwnedIds = new Set(liveOwned.map((c) => c.cellId));
      if (attackerKingdom.homeTerritoryId) liveOwnedIds.add(attackerKingdom.homeTerritoryId);

      if (liveOwnedIds.size >= TERRITORIES.MAX_PER_KINGDOM) {
        territoryCapBlocked = true;
      } else {
        await ctx.db.patch(targetCell._id, { ownerKingdomId: march.kingdomId, claimedAt: now, isHome: false });
        await recordMissionEvent(ctx, march.kingdomId, "territoriesClaimed", 1, false);
        const victorDoc = await ctx.db.get(march.kingdomId);
        if (victorDoc) {
          await ctx.db.patch(march.kingdomId, {
            glory: (victorDoc.glory ?? 0) + 1,
            honor: (victorDoc.honor ?? 0) + 1,
            conquestRewardsGranted: (victorDoc.conquestRewardsGranted ?? 0) + 1,
            updatedAt: now,
          });
        }
      }
    }
  }

  await ctx.db.patch(marchId, {
    status: "completada",
    unitsRefundedAt: now,
    battleResult: {
      outcome: report.outcome,
      crushingVictory: report.crushingVictory,
      battleId,
      ...(territoryCapBlocked ? { territoryCapBlocked: true } : {}),
      ...(capitalProtected ? { capitalProtected: true } : {}),
    },
  });
  
  // Mission updates
  await recordMissionEvent(ctx, march.kingdomId, "battlesFought", 1, false);
  await recordMissionEvent(ctx, defenderKingdomId, "battlesFought", 1, false);
  if (report.winnerKingdomId === march.kingdomId) await recordMissionEvent(ctx, march.kingdomId, "battlesWon", 1, false);
  if (report.winnerKingdomId === defenderKingdomId) await recordMissionEvent(ctx, defenderKingdomId, "battlesWon", 1, false);
  
  if (report.crushingVictory && report.winnerKingdomId === march.kingdomId) {
     await ctx.db.patch(march.kingdomId, {
      pendingTerritoryClaims: (attackerKingdom.pendingTerritoryClaims ?? 0) + 1
    });
    await recordMissionEvent(ctx, march.kingdomId, "crushingVictories", 1, false);
  }

  await evaluateKingdomMissions(ctx, march.kingdomId);
  await evaluateKingdomMissions(ctx, defenderKingdomId);

  return { success: true, outcome: report.outcome, battleId };
}

export const completeMarchScheduled = internalMutation({
  args: { marchId: v.id("armyMarches") },
  handler: async (ctx, args) => {
    return resolveMarch(ctx, args.marchId);
  },
});

export const getArmyMarch = query({
  args: { marchId: v.id("armyMarches") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.marchId);
  },
});

