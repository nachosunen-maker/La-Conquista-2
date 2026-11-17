/**
 * LA CONQUISTA — EJÉRCITO Y ENTRENAMIENTO (Bloque B)
 * Fuente única de verdad de tropas: tabla armyUnits (D-11). La tabla heredada
 * 'Armyunits' se migra al leerla desde una mutación y se retira tras migrar (D-15).
 */
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
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
  normalizeUnitType,
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

/** Lectura de solo consulta: une armyUnits con la tabla heredada sin escribir. */
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
  return [...canonical, ...legacy.map((doc) => ({ ...doc, legacy: true }))];
}

/** Lectura con migración: mueve los documentos heredados a armyUnits (idempotente) y devuelve el inventario canónico. */
export async function readArmyUnitsWithMigration(ctx: MutationCtx, kingdomId: Id<"kingdoms">): Promise<any[]> {
  let legacy: any[] = [];
  try {
    legacy = await (ctx.db as any)
      .query("Armyunits")
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();
  } catch {
    legacy = [];
  }
  for (const doc of legacy) {
    const unitType = normalizeUnitType(doc.unitType);
    const count = Number.isInteger(doc.count) && doc.count > 0 ? doc.count : 0;
    if (unitType && count > 0) {
      await addUnits(ctx, kingdomId, unitType, 1, count);
    }
    await ctx.db.delete(doc._id);
  }
  return await ctx.db
    .query("armyUnits")
    .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
    .collect();
}

/** Suma unidades al documento (tipo, nivel) correspondiente, creándolo si no existe. */
export async function addUnits(ctx: MutationCtx, kingdomId: Id<"kingdoms">, unitType: string, level: number, count: number): Promise<void> {
  if (count <= 0) return;
  const docs = await ctx.db
    .query("armyUnits")
    .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
    .collect();
  const existing = docs.find((doc) => normalizeUnitType(doc.unitType) === unitType && unitLevelOf(doc) === level);
  if (existing) {
    await ctx.db.patch(existing._id, { count: existing.count + count, level });
  } else {
    await ctx.db.insert("armyUnits", { 
      kingdomId, 
      unitType, 
      level, 
      count, 
      isSpy: unitType === "espia" 
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
      spies: {
        active: units.filter((doc) => doc.isSpy).reduce((sum, doc) => sum + Math.max(0, doc.count ?? 0), 0),
        busy: busySpies,
        inQueue: queue.filter((doc) => doc.unitType === "espia").reduce((sum, doc) => sum + Math.max(0, doc.count ?? 0), 0),
        capacity: Math.floor((buildingLevels.cuartel ?? 0) / 2),
        cuartelLevel: buildingLevels.cuartel ?? 0,
      },
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

    // Upgrade all existing armyUnits for this kingdom
    const units = await readArmyUnitsWithMigration(ctx, args.kingdomId);
    for (const doc of units) {
      await ctx.db.patch(doc._id, { level: args.targetLevel });
    }

    return {
      success: true,
      armyLevel: args.targetLevel,
      levelName: validation.levelInfo.name,
      multiplier: validation.levelInfo.multiplier,
      unitsUpgraded: units.length,
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
      .filter((doc) => doc.isSpy || normalizeUnitType(doc.unitType) === "espia")
      .reduce((sum, doc) => sum + Math.max(0, doc.count ?? 0), 0);
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
    for (const type of UNIT_TYPES) {
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
    const type = normalizeUnitType(unit.unitType);
    if (!type) continue;
    composition[type] += Number.isInteger(unit.count) && unit.count > 0 ? unit.count : 0;
  }
  return composition;
}

async function applyCasualtiesToArmy(ctx: MutationCtx, kingdomId: Id<"kingdoms">, casualties: Composition, wounded: Composition): Promise<void> {
  const units = await readArmyUnitsWithMigration(ctx, kingdomId);
  for (const type of UNIT_TYPES as readonly UnitType[]) {
    let remaining = casualties[type];
    const docs = units.filter((doc) => normalizeUnitType(doc.unitType) === type).sort((a, b) => b.count - a.count);
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
        await ctx.db.insert("armyUnits", { kingdomId, unitType: type, level: 1, count: 0, wounded: woundedCount });
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
    }

    const distance = ownedCoords.length
      ? Math.max(1, Math.min(...ownedCoords.map((c) => hexDistance(c, { q: target.q, r: target.r }))))
      : hexDistance(homeCoord, { q: target.q, r: target.r });

    const currentArmy = await readArmyUnitsWithMigration(ctx, args.kingdomId);
    const requestedComposition: Partial<Record<UnitType, number>> = {};
    for (const req of args.units) {
      if (req.count <= 0) continue;
      const normalized = normalizeUnitType(req.unitType);
      if (!normalized) continue;
      if (normalized === "espia") {
        throw new ConvexError("Los espías no participan en marchas de ataque ni conquista territorial; solo en expediciones de exploración o espionaje.");
      }
      const availableDoc = currentArmy.find((d) => normalizeUnitType(d.unitType) === normalized && unitLevelOf(d) === (req.level ?? 1));
      const availableCount = availableDoc ? (availableDoc.count ?? 0) : 0;
      if (availableCount < req.count) {
        throw new ConvexError(`Tropas insuficientes de '${normalized}' nivel ${req.level ?? 1}: solicitadas ${req.count}, disponibles ${availableCount}.`);
      }
      requestedComposition[normalized as UnitType] = (requestedComposition[normalized as UnitType] ?? 0) + req.count;
    }

    if (Object.keys(requestedComposition).length === 0) {
      throw new Error("Debes seleccionar al menos un tipo de tropa válido para la marcha.");
    }

    for (const req of args.units) {
      if (req.count <= 0) continue;
      const normalized = normalizeUnitType(req.unitType);
      if (!normalized) continue;
      const doc = currentArmy.find((d) => normalizeUnitType(d.unitType) === normalized && unitLevelOf(d) === (req.level ?? 1));
      if (doc) {
        const nextCount = doc.count - req.count;
        if (nextCount <= 0) {
          await ctx.db.delete(doc._id);
        } else {
          await ctx.db.patch(doc._id, { count: nextCount });
        }
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

    const marchId = await ctx.db.insert("armyMarches", {
      kingdomId: args.kingdomId,
      targetCellId: args.cellId,
      targetQ: target.q,
      targetR: target.r,
      distance,
      terrainMultiplier: terrainMul,
      units: args.units,
      startedAt: now,
      durationMs,
      completesAt,
      status: "marchando",
      isConquest,
    });

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
  if (!march || march.status !== "marchando") return null;

  const attackerKingdom = await ctx.db.get(march.kingdomId);
  if (!attackerKingdom) {
    await ctx.db.patch(marchId, { status: "cancelada" });
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
    for (const u of march.units) {
      const norm = normalizeUnitType(u.unitType);
      if (norm && u.count > 0) {
        await addUnits(ctx, march.kingdomId, norm, u.level ?? 1, u.count);
      }
    }
    const outcome = capBlocked ? "limite_territorios_alcanzado" : "conquista_neutral";
    await ctx.db.patch(marchId, {
      status: "completada",
      battleResult: capBlocked
        ? {
            outcome,
            crushingVictory: false,
            note: `Límite máximo de ${TERRITORIES.MAX_PER_KINGDOM} territorios alcanzado; el territorio neutral no se ha anexionado.`,
          }
        : { outcome, crushingVictory: false },
    });
    return { success: true, outcome, cellId: march.targetCellId, territoryCapBlocked: capBlocked };
  }

  // Si la marcha fue enviada como conquista territorial sobre casilla neutral, pero al llegar ya tiene soberano (carrera entre jugadores):
  // La resolución atómica es retorno automático sin combate, sin bajas y liberando el cupo de tropas.
  if (march.isConquest && targetCell.ownerKingdomId && targetCell.ownerKingdomId !== march.kingdomId) {
    for (const u of march.units) {
      const norm = normalizeUnitType(u.unitType);
      if (norm && u.count > 0) {
        await addUnits(ctx, march.kingdomId, norm, u.level ?? 1, u.count);
      }
    }
    await ctx.db.patch(marchId, {
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
    for (const u of march.units) {
      const norm = normalizeUnitType(u.unitType);
      if (norm && u.count > 0) {
        await addUnits(ctx, march.kingdomId, norm, u.level ?? 1, u.count);
      }
    }
    await ctx.db.patch(marchId, { status: "completada" });
    return { success: true, outcome: "sin_oposicion" };
  }

  const attackerUnitsDocs = march.units.map((u) => ({ unitType: u.unitType, level: u.level ?? 1, count: u.count }));
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

  const report = simulateBattle(attackerSide, defenderSide);
  const now = Date.now();

  const battleId = await ctx.db.insert("Battle", {
    challengeId: null as any,
    attackerKingdomId: march.kingdomId,
    defenderKingdomId,
    resolvedAt: now,
    outcome: report.outcome,
    winnerKingdomId: report.winnerKingdomId ? (report.winnerKingdomId as Id<"kingdoms">) : undefined,
    crushingVictory: report.crushingVictory,
    report,
  });

  const unitsByType: Record<string, Array<{ unitType: string; level: number; count: number }>> = {};
  for (const u of march.units) {
    const norm = normalizeUnitType(u.unitType);
    if (!norm || u.count <= 0) continue;
    const lvl = u.level ?? 1;
    if (!unitsByType[norm]) unitsByType[norm] = [];
    unitsByType[norm].push({ unitType: norm, level: lvl, count: u.count });
  }

  for (const [type, survivorsTotal] of Object.entries(report.attacker.survivorsComposition) as [UnitType, number][]) {
    if (survivorsTotal <= 0) continue;
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
    if (woundedTotal <= 0) continue;
    const groups = unitsByType[type];
    if (!groups || groups.length === 0) {
      const docs = await ctx.db
        .query("armyUnits")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", march.kingdomId))
        .collect();
      const host = docs.find((d) => normalizeUnitType(d.unitType) === type) ?? docs[0];
      if (host) {
        await ctx.db.patch(host._id, { wounded: (host.wounded ?? 0) + woundedTotal });
      } else {
        await ctx.db.insert("armyUnits", { kingdomId: march.kingdomId, unitType: type, level: 1, count: 0, wounded: woundedTotal });
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
        const host = docs.find((d) => normalizeUnitType(d.unitType) === type && unitLevelOf(d) === g.level);
        if (host) {
          await ctx.db.patch(host._id, { wounded: (host.wounded ?? 0) + countToAdd });
        } else {
          await ctx.db.insert("armyUnits", { kingdomId: march.kingdomId, unitType: type, level: g.level, count: 0, wounded: countToAdd });
        }
        remainingWounded -= countToAdd;
      }
    }
  }

  await applyCasualtiesToArmy(ctx, defenderKingdomId, report.defender.casualtiesComposition, report.defender.woundedComposition);
  await removeDeadFromPopulation(ctx, defenderKingdomId, report.defender.casualtiesComposition, report.defender.woundedComposition);

  let territoryCapBlocked = false;
  if (report.outcome === "victoria" && targetCell) {
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

  await ctx.db.patch(marchId, {
    status: "completada",
    battleResult: {
      outcome: report.outcome,
      crushingVictory: report.crushingVictory,
      battleId,
      ...(territoryCapBlocked ? { territoryCapBlocked: true } : {}),
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

