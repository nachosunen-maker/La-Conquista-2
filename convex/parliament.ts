/**
 * LA CONQUISTA — PARLAMENTO, DESAFÍOS Y RESOLUCIÓN DE BATALLAS (Bloques E y F)
 * Flujo (P38-P40, BLOQUE 9): crear → aceptar (ventana) / rechazar (penalización) →
 * congelar contingentes 15 min antes → resolver con el simulador determinista.
 * Todas las transiciones las ejecuta el servidor; las programadas son idempotentes.
 */
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { isKingdomOwner } from "./kingdomAccess";
import { requireOwner } from "./buildings";
import { settleRelationalKingdomEconomy } from "./economy";
import { readArmyUnitDocs, readArmyUnitsWithMigration } from "./army";
import { normalizeUnitType, summarizeArmy, unitLevelOf } from "./armyRules";
import { validateBuildingCollection } from "./buildingRules";
import { computeTechnologyModifiers, readCompletedTechnologyIds } from "./technologyRules";
import { distanceBetweenKingdoms, readHomeCoord } from "./territories";
import { marchFatigue, marchTimeSeconds, armyMarchMultiplier } from "./territoryRules";
import { applyFormation, emptyComposition, simulateBattle, type BattleSide, type Composition } from "./battleRules";
import { isTacticalFormation } from "./armyRules";
import { evaluateKingdomMissions, recordMissionEvent } from "./missions";
import {
  approximateEstimate,
  approximatePopulation,
  assertTransition,
  isPredefinedMessage,
  isScheduleWindow,
  pendingExpiry,
  predefinedMessageText,
  rejectionPenalty,
  scheduleFor,
  validateNewChallenge,
  type ChallengeStatus,
} from "./challengeRules";
import { DEFAULT_TACTICAL_FORMATION, MORALE, PARLIAMENT, PREDEFINED_MESSAGES, TERRAINS, UNITS, UNIT_TYPES, WELLBEING, type UnitType } from "./balanceConfig";
import type { ResourceType } from "./economyCalculations";

type ChallengeDoc = Doc<"challenges">;

async function readKingdomChallenges(ctx: QueryCtx | MutationCtx, kingdomId: Id<"kingdoms">): Promise<ChallengeDoc[]> {
  const [outgoing, incoming] = await Promise.all([
    ctx.db.query("challenges").withIndex("by_challenger", (q) => q.eq("challengerKingdomId", kingdomId)).collect(),
    ctx.db.query("challenges").withIndex("by_target", (q) => q.eq("targetKingdomId", kingdomId)).collect(),
  ]);
  return [...outgoing, ...incoming];
}

async function readBuildingLevels(ctx: QueryCtx | MutationCtx, kingdomId: Id<"kingdoms">): Promise<Record<string, number>> {
  const buildings = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect();
  const collection = validateBuildingCollection(buildings);
  return collection.success ? collection.levels : {};
}

async function readPopulationTotal(ctx: QueryCtx | MutationCtx, kingdomId: Id<"kingdoms">): Promise<number> {
  const doc: any = await (ctx.db as any).query("population").filter((q: any) => q.eq(q.field("kingdomId"), kingdomId)).first();
  return typeof doc?.total === "number" ? doc.total : 0;
}

function activeComposition(units: any[]): Composition {
  const composition = emptyComposition();
  for (const unit of units) {
    const type = normalizeUnitType(unit.unitType);
    if (!type) continue;
    composition[type] += Number.isInteger(unit.count) && unit.count > 0 ? unit.count : 0;
  }
  return composition;
}

// ----------------------------------------------------------------------------
// Consultas
// ----------------------------------------------------------------------------
export const getParliament = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    const isDemoRead = kingdom.userId === "guest_g9ai8cz";
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar su propio reino.");
    }
    const [challenges, buildingLevels] = await Promise.all([
      readKingdomChallenges(ctx, args.kingdomId),
      readBuildingLevels(ctx, args.kingdomId),
    ]);
    const otherIds = [...new Set(challenges.flatMap((c) => [c.challengerKingdomId, c.targetKingdomId]).filter((id) => id !== args.kingdomId))];
    const others = await Promise.all(otherIds.map((id) => ctx.db.get(id)));
    const names = new Map<string, string>();
    for (const other of others) if (other) names.set(other._id, other.name);
    const now = Date.now();
    const pendingIncoming = challenges.filter((c) => c.targetKingdomId === args.kingdomId && c.status === "PENDING");
    return {
      serverTimeMs: now,
      writable: isKingdomOwner(kingdom.userId, identity?.subject),
      parliamentLevel: buildingLevels.parlamento ?? 0,
      requiredParliamentLevel: PARLIAMENT.REQUIRED_PARLIAMENT_LEVEL,
      /** [MAESTRA P58] Insignia del Parlamento: desafíos pendientes de gestionar. */
      badgeCount: pendingIncoming.length,
      windows: PARLIAMENT.SCHEDULE_WINDOWS_MS,
      predefinedMessages: PREDEFINED_MESSAGES,
      honor: kingdom.honor ?? 0,
      glory: kingdom.glory ?? 0,
      pendingTerritoryClaims: kingdom.pendingTerritoryClaims ?? 0,
      challenges: challenges
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((c) => ({
          _id: c._id,
          direction: c.challengerKingdomId === args.kingdomId ? "outgoing" : "incoming",
          rivalKingdomId: c.challengerKingdomId === args.kingdomId ? c.targetKingdomId : c.challengerKingdomId,
          rivalName: names.get(c.challengerKingdomId === args.kingdomId ? c.targetKingdomId : c.challengerKingdomId) ?? "Reino desconocido",
          challengeType: c.challengeType,
          status: c.status,
          createdAt: c.createdAt,
          expiresAt: c.expiresAt,
          window: c.window ?? null,
          scheduledAt: c.scheduledAt ?? null,
          freezeAt: c.freezeAt ?? null,
          resolvedAt: c.resolvedAt ?? null,
          battleId: c.battleId ?? null,
          distance: c.distance ?? null,
          marchSeconds: c.marchSeconds ?? null,
          messages: (c.messages ?? []).map((m) => ({ ...m, text: predefinedMessageText(m.messageId) ?? m.messageId })),
        })),
    };
  },
});

/** [MAESTRA P42] Rivales con información general; la composición exacta requiere inteligencia. */
export const listRivals = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    const isDemoRead = kingdom.userId === "guest_g9ai8cz";
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar su propio reino.");
    }
    const all = await ctx.db.query("kingdoms").collect();
    const reports = await ctx.db.query("espionageReports").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect();
    const now = Date.now();
    const myHome = await readHomeCoord(ctx, args.kingdomId);
    const rivals = [];
    for (const other of all) {
      if (other._id === args.kingdomId) continue;
      const [levels, population, units, home] = await Promise.all([
        readBuildingLevels(ctx, other._id),
        readPopulationTotal(ctx, other._id),
        readArmyUnitDocs(ctx, other._id),
        readHomeCoord(ctx, other._id),
      ]);
      const summary = summarizeArmy(units);
      const report = reports.filter((r) => r.targetKingdomId === other._id && r.expiresAt > now).sort((a, b) => b.level - a.level)[0];
      const estimate = approximateEstimate(summary.totalActive, report?.level ?? 0);
      const distance = myHome && home ? Math.round(((Math.abs(myHome.q - home.q) + Math.abs(myHome.r - home.r) + Math.abs(myHome.q - home.q + myHome.r - home.r)) / 2)) : null;
      rivals.push({
        kingdomId: other._id,
        name: other.name,
        civilization: other.civilization ?? null,
        parliamentLevel: levels.parlamento ?? 0,
        canBeChallenged: (levels.parlamento ?? 0) >= PARLIAMENT.REQUIRED_PARLIAMENT_LEVEL,
        approximatePopulation: approximatePopulation(population),
        armyEstimate: { min: estimate.min, max: estimate.max, error: estimate.error },
        honor: other.honor ?? 0,
        distance,
        espionageReport: report ? { level: report.level, expiresAt: report.expiresAt, composition: report.composition ?? null } : null,
      });
    }
    return { rivals, serverTimeMs: now };
  },
});

export const getBattles = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    const isDemoRead = kingdom.userId === "guest_g9ai8cz";
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar su propio reino.");
    }
    const [asAttacker, asDefender] = await Promise.all([
      ctx.db.query("Battle").withIndex("by_attacker", (q) => q.eq("attackerKingdomId", args.kingdomId)).collect(),
      ctx.db.query("Battle").withIndex("by_defender", (q) => q.eq("defenderKingdomId", args.kingdomId)).collect(),
    ]);
    return [...asAttacker, ...asDefender]
      .sort((a, b) => b.resolvedAt - a.resolvedAt)
      .map((battle) => ({ ...battle, role: battle.attackerKingdomId === args.kingdomId ? "attacker" : "defender" }));
  },
});

// ----------------------------------------------------------------------------
// Mutaciones del jugador
// ----------------------------------------------------------------------------
export const createChallenge = mutation({
  args: {
    challengerKingdomId: v.id("kingdoms"),
    targetKingdomId: v.id("kingdoms"),
    challengeType: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.challengerKingdomId);
    const target = await ctx.db.get(args.targetKingdomId);
    if (!target) throw new Error("El reino rival no existe.");
    if (!["batalla"].includes(args.challengeType)) throw new Error("Tipo de desafío no admitido; solo 'batalla' está disponible (D-37: sin apuestas).");
    const [myLevels, targetLevels, existing] = await Promise.all([
      readBuildingLevels(ctx, args.challengerKingdomId),
      readBuildingLevels(ctx, args.targetKingdomId),
      readKingdomChallenges(ctx, args.challengerKingdomId),
    ]);
    const now = Date.now();
    const validation = validateNewChallenge({
      challengerKingdomId: args.challengerKingdomId,
      targetKingdomId: args.targetKingdomId,
      challengerParliamentLevel: myLevels.parlamento ?? 0,
      targetParliamentLevel: targetLevels.parlamento ?? 0,
      existing: existing.map((c) => ({ challengerKingdomId: c.challengerKingdomId, targetKingdomId: c.targetKingdomId, status: c.status as ChallengeStatus, createdAt: c.createdAt })),
      now,
    });
    if (!validation.success) throw new Error(validation.error);
    const distance = await distanceBetweenKingdoms(ctx, args.challengerKingdomId, args.targetKingdomId);
    const expiresAt = pendingExpiry(now);
    const challengeId = await ctx.db.insert("challenges", {
      challengerKingdomId: args.challengerKingdomId,
      targetKingdomId: args.targetKingdomId,
      challengeType: args.challengeType,
      status: "PENDING",
      createdAt: now,
      expiresAt,
      distance: distance ?? undefined,
      messages: [],
    });
    await ctx.scheduler.runAt(expiresAt, internal.parliament.expireChallenge, { challengeId });
    await recordMissionEvent(ctx, args.challengerKingdomId, "challengesSent", 1);
    return { success: true, challengeId, expiresAt, distance };
  },
});

export const acceptChallenge = mutation({
  args: { kingdomId: v.id("kingdoms"), challengeId: v.id("challenges"), window: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.kingdomId);
    const challenge = await ctx.db.get(args.challengeId);
    if (!challenge || challenge.targetKingdomId !== args.kingdomId) throw new Error("El desafío no está dirigido a este reino.");
    const transition = assertTransition(challenge.status as ChallengeStatus, "ACCEPTED");
    if (!transition.success) throw new Error(transition.error);
    if (!isScheduleWindow(args.window)) throw new Error("Ventana de programación inválida: usa 'proxima', 'dias' o 'semana' (P38).");
    const now = Date.now();
    if (now >= challenge.expiresAt) throw new Error("El desafío ha caducado.");
    const { scheduledAt, freezeAt } = scheduleFor(now, args.window);
    const attackerUnits = await readArmyUnitDocs(ctx, challenge.challengerKingdomId);
    const marchSeconds = marchTimeSeconds(challenge.distance ?? 0, 1, armyMarchMultiplier(activeComposition(attackerUnits)));
    await ctx.db.patch(args.challengeId, { status: "ACCEPTED", respondedAt: now, window: args.window, scheduledAt, freezeAt, marchSeconds });
    await ctx.scheduler.runAt(freezeAt, internal.parliament.freezeChallenge, { challengeId: args.challengeId });
    await ctx.scheduler.runAt(scheduledAt, internal.parliament.resolveChallenge, { challengeId: args.challengeId });
    return { success: true, scheduledAt, freezeAt, marchSeconds };
  },
});

export const rejectChallenge = mutation({
  args: { kingdomId: v.id("kingdoms"), challengeId: v.id("challenges") },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    const challenge = await ctx.db.get(args.challengeId);
    if (!challenge || challenge.targetKingdomId !== args.kingdomId) throw new Error("El desafío no está dirigido a este reino.");
    const transition = assertTransition(challenge.status as ChallengeStatus, "REJECTED");
    if (!transition.success) throw new Error(transition.error);
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    const penalty = rejectionPenalty(settled.settledResources);
    const nextResources: Record<ResourceType, number> = { ...settled.settledResources };
    for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) nextResources[resource] -= penalty[resource];
    await ctx.db.patch(settled.resources._id, nextResources);
    await ctx.db.patch(args.challengeId, { status: "REJECTED", respondedAt: now, penaltyApplied: penalty });
    return { success: true, penalty };
  },
});

/** [MAESTRA P60] Solo mensajes predefinidos entre los dos reinos de un desafío. */
export const sendPredefinedMessage = mutation({
  args: { kingdomId: v.id("kingdoms"), challengeId: v.id("challenges"), messageId: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.kingdomId);
    const challenge = await ctx.db.get(args.challengeId);
    if (!challenge || (challenge.challengerKingdomId !== args.kingdomId && challenge.targetKingdomId !== args.kingdomId)) {
      throw new Error("No participas en este desafío.");
    }
    if (!isPredefinedMessage(args.messageId)) throw new Error("Solo se permiten los mensajes predefinidos del Parlamento (P60).");
    const messages = [...(challenge.messages ?? []), { fromKingdomId: args.kingdomId, messageId: args.messageId, at: Date.now() }];
    await ctx.db.patch(args.challengeId, { messages });
    return { success: true, text: predefinedMessageText(args.messageId) };
  },
});

/** [COMPLEMENTO D-39] Informe de espionaje pagado en oro según el nivel tecnológico. */
export const requestEspionageReport = mutation({
  args: { kingdomId: v.id("kingdoms"), targetKingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    if (args.kingdomId === args.targetKingdomId) throw new Error("No puedes espiar a tu propio reino.");
    const target = await ctx.db.get(args.targetKingdomId);
    if (!target) throw new Error("El reino objetivo no existe.");
    const modifiers = computeTechnologyModifiers(await readCompletedTechnologyIds(ctx, args.kingdomId));
    const level = modifiers.espionageLevel;
    if (level < 1) throw new Error("Se necesita la tecnología Espionaje I para solicitar informes (P42).");
    const cost = PARLIAMENT.ESPIONAGE.costByLevel[level] ?? PARLIAMENT.ESPIONAGE.costByLevel[1];
    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    if (settled.settledResources.gold < cost) throw new Error(`Oro insuficiente: el informe cuesta ${cost} y hay ${Math.floor(settled.settledResources.gold)}.`);
    await ctx.db.patch(settled.resources._id, { ...settled.settledResources, gold: settled.settledResources.gold - cost });
    const units = await readArmyUnitDocs(ctx, args.targetKingdomId);
    const composition = activeComposition(units);
    const estimated: Record<string, { min: number; max: number }> = {};
    for (const type of UNIT_TYPES) estimated[type] = approximateEstimate(composition[type], level);
    const total = approximateEstimate(Object.values(composition).reduce((a, b) => a + b, 0), level);
    const reportId = await ctx.db.insert("espionageReports", {
      kingdomId: args.kingdomId,
      targetKingdomId: args.targetKingdomId,
      level,
      createdAt: now,
      expiresAt: now + PARLIAMENT.ESPIONAGE.reportTtlMs,
      estimate: { min: total.min, max: total.max },
      composition: estimated,
    });
    return { success: true, reportId, cost, level, estimate: total, composition: estimated, expiresAt: now + PARLIAMENT.ESPIONAGE.reportTtlMs };
  },
});

// ----------------------------------------------------------------------------
// Transiciones programadas (servidor)
// ----------------------------------------------------------------------------
export const expireChallenge = internalMutation({
  args: { challengeId: v.id("challenges") },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get(args.challengeId);
    if (!challenge || challenge.status !== "PENDING") return { expired: false };
    if (Date.now() < challenge.expiresAt) return { expired: false };
    await ctx.db.patch(args.challengeId, { status: "EXPIRED", respondedAt: Date.now() });
    return { expired: true };
  },
});

async function snapshotSide(ctx: MutationCtx, kingdomId: Id<"kingdoms">, role: "attacker" | "defender", distance: number): Promise<BattleSide> {
  const kingdom = await ctx.db.get(kingdomId);
  if (!kingdom) throw new Error("Reino participante no encontrado.");
  await settleRelationalKingdomEconomy(ctx, kingdom, kingdom.userId, Date.now());
  const refreshed = (await ctx.db.get(kingdomId)) ?? kingdom;
  const units = await readArmyUnitsWithMigration(ctx, kingdomId);
  const summary = summarizeArmy(units);
  const levels = await readBuildingLevels(ctx, kingdomId);
  const home = await readHomeCoord(ctx, kingdomId);
  let terrainDefenseBonus = 0;
  if (home) {
    const cell = await ctx.db.query("territories").withIndex("by_cell", (q) => q.eq("cellId", `${home.q},${home.r}`)).first();
    terrainDefenseBonus = cell ? (TERRAINS as any)[cell.terrain]?.defense ?? 0 : 0;
  }
  const currentFatigue = typeof refreshed.armyFatigue === "number" ? refreshed.armyFatigue : 0;
  return {
    kingdomId,
    name: refreshed.name,
    // [P37, M-11] Solo participa la fracción de cada tipo fijada en la formación del reino.
    composition: applyFormation(activeComposition(units), refreshed.formation ?? null),
    trainingMultiplier: summary.trainingMultiplier,
    weaponTier: (refreshed.weaponTier as BattleSide["weaponTier"]) ?? "palo",
    armorTier: (refreshed.armorTier as BattleSide["armorTier"]) ?? "ninguna",
    strategy: (refreshed.strategy as BattleSide["strategy"]) ?? "defensiva",
    tacticalFormation: isTacticalFormation(refreshed.tacticalFormation ?? "") ? (refreshed.tacticalFormation as BattleSide["tacticalFormation"]) : DEFAULT_TACTICAL_FORMATION,
    morale: typeof refreshed.militaryMorale === "number" ? refreshed.militaryMorale : WELLBEING.INITIAL_MORALE,
    foodTier: refreshed.foodTier ?? "normal",
    fatigue: role === "attacker" ? marchFatigue(currentFatigue, distance, 1) : currentFatigue,
    wallsLevel: role === "defender" ? levels.murallas ?? 0 : 0,
    terrainDefenseBonus: role === "defender" ? terrainDefenseBonus : 0,
  };
}

/** [COMPLEMENTO D-36] Congela composición, equipo y estrategia; los cambios posteriores no afectan al combate. */
export const freezeChallenge = internalMutation({
  args: { challengeId: v.id("challenges") },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get(args.challengeId);
    if (!challenge) return { frozen: false };
    const transition = assertTransition(challenge.status as ChallengeStatus, "FROZEN");
    if (!transition.success) return { frozen: false, reason: transition.error };
    const distance = challenge.distance ?? 0;
    const attacker = await snapshotSide(ctx, challenge.challengerKingdomId, "attacker", distance);
    const defender = await snapshotSide(ctx, challenge.targetKingdomId, "defender", distance);
    await ctx.db.patch(args.challengeId, { status: "FROZEN", frozenAt: Date.now(), frozen: { attacker, defender } });
    return { frozen: true };
  },
});

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

export const resolveChallenge = internalMutation({
  args: { challengeId: v.id("challenges") },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get(args.challengeId);
    if (!challenge) return { resolved: false };
    if (challenge.status === "ACCEPTED") {
      // El scheduler de congelación no se ejecutó: congelar ahora y continuar (idempotente).
      const distance = challenge.distance ?? 0;
      const attacker = await snapshotSide(ctx, challenge.challengerKingdomId, "attacker", distance);
      const defender = await snapshotSide(ctx, challenge.targetKingdomId, "defender", distance);
      await ctx.db.patch(args.challengeId, { status: "FROZEN", frozenAt: Date.now(), frozen: { attacker, defender } });
    }
    const current = await ctx.db.get(args.challengeId);
    if (!current || !current.frozen) return { resolved: false };
    const transition = assertTransition(current.status as ChallengeStatus, "RESOLVED");
    if (!transition.success) return { resolved: false, reason: transition.error };

    const report = simulateBattle(current.frozen.attacker as BattleSide, current.frozen.defender as BattleSide);
    const now = Date.now();
    const battleId = await ctx.db.insert("Battle", {
      challengeId: args.challengeId,
      attackerKingdomId: current.challengerKingdomId,
      defenderKingdomId: current.targetKingdomId,
      resolvedAt: now,
      outcome: report.outcome,
      winnerKingdomId: report.winnerKingdomId ? (report.winnerKingdomId as Id<"kingdoms">) : undefined,
      crushingVictory: report.crushingVictory,
      report,
    });

    await applyCasualtiesToArmy(ctx, current.challengerKingdomId, report.attacker.casualtiesComposition, report.attacker.woundedComposition);
    await applyCasualtiesToArmy(ctx, current.targetKingdomId, report.defender.casualtiesComposition, report.defender.woundedComposition);
    // [MAESTRA P46] Los muertos se pierden definitivamente: salen también del censo (operadores incluidos).
    await removeDeadFromPopulation(ctx, current.challengerKingdomId, report.attacker.casualtiesComposition, report.attacker.woundedComposition);
    await removeDeadFromPopulation(ctx, current.targetKingdomId, report.defender.casualtiesComposition, report.defender.woundedComposition);

    const expiresAt = now + MORALE.BATTLE_EFFECT_DURATION_SECONDS * 1000;
    for (const side of [current.challengerKingdomId, current.targetKingdomId]) {
      const doc = await ctx.db.get(side);
      if (!doc) continue;
      const won = report.winnerKingdomId === side;
      const lost = report.loserKingdomId === side;
      const effects = [...(doc.moraleEffects ?? []).filter((e) => e.expiresAt > now)];
      if (won) effects.push({ amount: MORALE.VICTORY_BONUS, expiresAt });
      if (lost) effects.push({ amount: -MORALE.DEFEAT_PENALTY, expiresAt });
      const patch: Record<string, unknown> = { moraleEffects: effects, updatedAt: now };
      if (side === current.challengerKingdomId) patch.armyFatigue = (current.frozen.attacker as BattleSide).fatigue;
      if (won && report.crushingVictory) patch.pendingTerritoryClaims = (doc.pendingTerritoryClaims ?? 0) + 1;
      // [M-01] Honor y gloria por batalla (P50, P51); la gloria nunca baja de 0.
      const isAttacker = side === current.challengerKingdomId;
      const honorGain = isAttacker ? report.honorAwarded.attacker : report.honorAwarded.defender;
      const gloryGain = isAttacker ? report.gloryAwarded.attacker : report.gloryAwarded.defender;
      patch.honor = Math.max(0, (doc.honor ?? 0) + honorGain);
      patch.glory = Math.max(0, (doc.glory ?? 0) + gloryGain);
      await ctx.db.patch(side, patch);
    }

    await ctx.db.patch(args.challengeId, { status: "RESOLVED", resolvedAt: now, battleId });
    // [Misiones] Contadores de batalla y evaluación para ambos reinos.
    for (const side of [current.challengerKingdomId, current.targetKingdomId]) {
      await recordMissionEvent(ctx, side, "battlesFought", 1, false);
      if (report.winnerKingdomId === side) await recordMissionEvent(ctx, side, "battlesWon", 1, false);
      if (report.winnerKingdomId === side && report.crushingVictory) await recordMissionEvent(ctx, side, "crushingVictories", 1, false);
      await evaluateKingdomMissions(ctx, side, now);
    }
    return { resolved: true, battleId, outcome: report.outcome };
  },
});
