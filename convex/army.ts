/**
 * LA CONQUISTA — EJÉRCITO Y ENTRENAMIENTO (Bloque B)
 * Fuente única de verdad de tropas: tabla armyUnits (D-11). La tabla heredada
 * 'Armyunits' se migra al leerla desde una mutación y se retira tras migrar (D-15).
 */
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { isKingdomOwner } from "./kingdomAccess";
import { settleRelationalKingdomEconomy } from "./economy";
import { requireOwner } from "./buildings";
import { validateBuildingCollection } from "./buildingRules";
import { computeTechnologyModifiers, readCompletedTechnologyIds } from "./technologyRules";
import {
  availableArmorTiers,
  availableMilitaryLevels,
  availableWeaponTiers,
  calculateTrainingCancellation,
  createTrainingPlan,
  normalizeUnitType,
  summarizeArmy,
  trainingCostsFor,
  trainingDurationMs,
  trainingProgress,
  trainingQueueSlots,
  unitLevelOf,
  validateEquipmentSelection,
  type TrainingQueueEntry,
} from "./armyRules";
import { ARMORS, MERCENARIES, MILITARY_LEVELS, STRATEGIES, TIME, UNITS, UNIT_TYPES, WEAPONS, type UnitType } from "./balanceConfig";
import type { ResourceType } from "./economyCalculations";

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
    await ctx.db.insert("armyUnits", { kingdomId, unitType, level, count });
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
    return {
      serverTimeMs,
      writable: isKingdomOwner(kingdom.userId, identity?.subject),
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
      unitCatalog: UNIT_TYPES.map((unitType) => ({
        unitType,
        ...UNITS[unitType],
        unitCosts: trainingCostsFor(unitType, 1),
        unitDurationMs: trainingDurationMs(unitType, 1, modifiers.trainingDuration),
        requirementsSatisfied: Object.entries(UNITS[unitType].requirements).every(([type, level]) => (buildingLevels[type] ?? 0) >= level),
      })),
      trainingDurationModifier: modifiers.trainingDuration,
      formation: kingdomAny.formation ?? { infanteria: 1, arqueria: 1, caballeria: 1, asedio: 1 },
      mercenaries: {
        active: units.filter((doc) => doc.isMercenary).reduce((sum, doc) => sum + Math.max(0, doc.count ?? 0), 0),
        contracts: units.filter((doc) => doc.isMercenary).map((doc) => ({ count: doc.count, contractEndsAt: doc.contractEndsAt ?? null })),
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
        weaponCatalog: WEAPONS,
        armorCatalog: ARMORS,
        strategyCatalog: STRATEGIES,
      },
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
    if (!collection.success) throw new Error(collection.error);
    const completedTechnologies = await readCompletedTechnologyIds(ctx, args.kingdomId);
    const modifiers = computeTechnologyModifiers(completedTechnologies);
    const population = await ctx.db.get(settled.population._id);
    if (!population) throw new Error("No existe documento de población para el reino.");
    const planResult = createTrainingPlan({
      unitType: args.unitType,
      count: args.count,
      level: args.level ?? 1,
      resources: settled.settledResources,
      availableCivil: population.available,
      buildingLevels: collection.levels,
      activeTraining: queue as TrainingQueueEntry[],
      now,
      durationModifier: modifiers.trainingDuration,
    });
    if (!planResult.success) throw new Error(planResult.error);
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
    if (!entry || entry.kingdomId !== args.kingdomId) throw new Error("El lote de entrenamiento no existe en este reino.");
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const cancellation = calculateTrainingCancellation({ entry: entry as TrainingQueueEntry, serverTimeMs: now });
    if (!cancellation.success) throw new Error(cancellation.error);
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

async function finalizeTraining(ctx: MutationCtx, entry: any, now: number): Promise<boolean> {
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
    if (await finalizeTraining(ctx, entry, now)) completed += 1;
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
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.kingdomId);
    const buildings = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect();
    const collection = validateBuildingCollection(buildings);
    if (!collection.success) throw new Error(collection.error);
    const modifiers = computeTechnologyModifiers(await readCompletedTechnologyIds(ctx, args.kingdomId));
    const selection = validateEquipmentSelection({
      weaponTier: args.weaponTier,
      armorTier: args.armorTier,
      strategy: args.strategy,
      buildingLevels: collection.levels,
      unlockedWeapons: modifiers.unlockedWeapons,
      unlockedArmors: modifiers.unlockedArmors,
    });
    if (!selection.success) throw new Error(selection.error);
    await ctx.db.patch(args.kingdomId, {
      weaponTier: selection.weaponTier,
      armorTier: selection.armorTier,
      strategy: selection.strategy,
      updatedAt: Date.now(),
    });
    return { success: true, weaponTier: selection.weaponTier, armorTier: selection.armorTier, strategy: selection.strategy };
  },
});

/**
 * [DECISIÓN 17-10-2026, M-02 opción A] Contratación de mercenarios en la Taberna (P53):
 * 25 oro por mercenario (infantería nivel 2), hasta 50 activos por nivel de Taberna, contrato
 * de 7 días reales con salario de 1 oro/día. Se suman al censo pero no generan natalidad.
 */
export const hireMercenaries = mutation({
  args: { kingdomId: v.id("kingdoms"), count: v.number() },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    if (!Number.isInteger(args.count) || args.count < 1) throw new Error("La cantidad debe ser un entero positivo.");
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const buildings = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect();
    const collection = validateBuildingCollection(buildings);
    if (!collection.success) throw new Error(collection.error);
    const tavernLevel = collection.levels.taberna ?? 0;
    if (tavernLevel < 1) throw new Error("Se necesita una Taberna para contratar mercenarios (P13, P53).");
    const units = await readArmyUnitsWithMigration(ctx, args.kingdomId);
    const active = units.filter((doc) => doc.isMercenary).reduce((sum, doc) => sum + Math.max(0, doc.count ?? 0), 0);
    const maxActive = MERCENARIES.MAX_PER_TAVERN_LEVEL * tavernLevel;
    if (active + args.count > maxActive) {
      throw new Error(`La Taberna nivel ${tavernLevel} admite ${maxActive} mercenarios activos; hay ${active}.`);
    }
    const cost = MERCENARIES.GOLD_PER_UNIT * args.count;
    if (settled.settledResources.gold < cost) {
      throw new Error(`Oro insuficiente: ${args.count} mercenarios cuestan ${cost} y hay ${Math.floor(settled.settledResources.gold)}.`);
    }
    await ctx.db.patch(settled.resources._id, { ...settled.settledResources, gold: settled.settledResources.gold - cost });
    const contractEndsAt = now + MERCENARIES.CONTRACT_DAYS * TIME.MS_PER_GAME_YEAR;
    await ctx.db.insert("armyUnits", {
      kingdomId: args.kingdomId,
      unitType: MERCENARIES.UNIT_TYPE,
      level: MERCENARIES.LEVEL,
      count: args.count,
      isMercenary: true,
      contractEndsAt,
    });
    const population = await ctx.db.get(settled.population._id);
    if (population) await ctx.db.patch(population._id, { total: population.total + args.count });
    return { success: true, count: args.count, cost, contractEndsAt, salaryGoldPerDay: MERCENARIES.SALARY_GOLD_PER_DAY * args.count };
  },
});

/** [MAESTRA P37, M-11] Fracción (0-1) de cada tipo que participa en el próximo combate. */
export const setFormation = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    formation: v.object({
      infanteria: v.optional(v.number()),
      arqueria: v.optional(v.number()),
      caballeria: v.optional(v.number()),
      asedio: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.kingdomId);
    const formation: Partial<Record<UnitType, number>> = {};
    for (const type of UNIT_TYPES) {
      const value = args.formation[type];
      if (value === undefined) continue;
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`La fracción de '${type}' debe estar entre 0 y 1.`);
      formation[type] = Math.round(value * 100) / 100;
    }
    await ctx.db.patch(args.kingdomId, { formation, updatedAt: Date.now() });
    return { success: true, formation };
  },
});
