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
import { readArmyUnitDocs, readArmyUnitsWithMigration, addUnits, applyCasualtiesToArmy } from "./army";
export { applyCasualtiesToArmy };
import { isSpyUnitDoc, normalizeUnitType, summarizeArmy, unitLevelOf } from "./armyRules";
import { validateBuildingCollection } from "./buildingRules";
import { calculateEspionageCost, computeTechnologyModifiers, readCompletedTechnologyIds } from "./technologyRules";
import { distanceBetweenKingdoms, pathTerrainBetweenKingdoms, readHomeCoord, readDiscoveredKingdomIds } from "./territories";
import { marchFatigue, marchTimeSeconds, armyMarchMultiplier } from "./territoryRules";
import { applyFormation, emptyComposition, simulateBattle, type BattleSide, type Composition } from "./battleRules";
import { isTacticalFormation } from "./armyRules";
import { getCivilizationPassive } from "./civilizationRules";
import { evaluateKingdomMissions, recordMissionEvent } from "./missions";
import { isTestOrDemoKingdom } from "./explorationRules";
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
    if (isSpyUnitDoc(unit)) continue;
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
    const discoveredKingdomIds = await readDiscoveredKingdomIds(ctx, args.kingdomId);
    const all = await ctx.db.query("kingdoms").collect();
    const reports = await ctx.db.query("espionageReports").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect();
    const now = Date.now();
    const myHome = await readHomeCoord(ctx, args.kingdomId);
    const rivals = [];
    const seenNames = new Set<string>();
    for (const other of all) {
      if (other._id === args.kingdomId) continue;
      // [BETA PARLAMENTO]: Excluir reinos de demostración, pruebas o verificación
      if (isTestOrDemoKingdom({ userId: other.userId, name: other.name, monarchName: other.monarchName })) continue;
      // [BETA PARLAMENTO]: Solo reinos de jugadores reales descubiertos previamente en el mapa
      if (!discoveredKingdomIds.has(other._id)) continue;
      // [BETA PARLAMENTO]: Deduplicar por nombre normalizado
      const normName = (other.name ?? "").toLowerCase().trim();
      if (normName && seenNames.has(normName)) continue;
      if (normName) seenNames.add(normName);
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
    const seen = new Set<string>();
    const battles = [];
    for (const battle of [...asAttacker, ...asDefender]) {
      if (seen.has(battle._id)) continue;
      seen.add(battle._id);
      battles.push(battle);
    }
    return battles
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
    const attackerKingdom = await ctx.db.get(challenge.challengerKingdomId);
    const civPassive = getCivilizationPassive(attackerKingdom?.civilization);
    const attackerTech = await readCompletedTechnologyIds(ctx, challenge.challengerKingdomId);
    const attackerTechModifiers = computeTechnologyModifiers(attackerTech);
    // [R-14, decisión 23-10-2026] Terreno medio del camino entre los territorios principales.
    const terrainMultiplier = await pathTerrainBetweenKingdoms(ctx, challenge.challengerKingdomId, challenge.targetKingdomId);
    const marchSeconds = marchTimeSeconds(
      challenge.distance ?? 0,
      terrainMultiplier,
      armyMarchMultiplier(activeComposition(attackerUnits), attackerKingdom?.civilization),
      civPassive?.marchSpeedMultiplier ?? 1.0,
      attackerTechModifiers.marchSpeedBonus
    );
    await ctx.db.patch(args.challengeId, { status: "ACCEPTED", respondedAt: now, window: args.window, scheduledAt, freezeAt, marchSeconds, terrainMultiplier });
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
  args: { 
    kingdomId: v.id("kingdoms"), 
    targetKingdomId: v.id("kingdoms"),
    spiesCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    if (args.kingdomId === args.targetKingdomId) throw new Error("No puedes espiar a tu propio reino.");
    const target = await ctx.db.get(args.targetKingdomId);
    if (!target) throw new Error("El reino objetivo no existe.");
    const modifiers = computeTechnologyModifiers(await readCompletedTechnologyIds(ctx, args.kingdomId));
    const spyLevel = modifiers.espionageLevel;
    if (spyLevel < 1) throw new Error("Se necesita la tecnología Espionaje I para solicitar informes (P42).");

    const spiesCount = args.spiesCount ?? 1;
    if (!Number.isInteger(spiesCount) || spiesCount < 1) {
      throw new Error("La cantidad de espías debe ser un número entero positivo.");
    }
    const armyUnits = await readArmyUnitsWithMigration(ctx, args.kingdomId);
    const totalSpies = armyUnits.filter((u) => isSpyUnitDoc(u)).reduce((sum, u) => sum + Math.max(0, u.count ?? 0), 0);
    if (totalSpies < spiesCount) throw new Error(`No tienes suficientes espías disponibles para la misión (solicitados: ${spiesCount}, disponibles: ${totalSpies}).`);

    // Descontar espías temporalmente
    let remainingToDeduct = spiesCount;
    for (const u of armyUnits) {
      if (isSpyUnitDoc(u) && (u.count ?? 0) > 0 && remainingToDeduct > 0) {
        const take = Math.min(u.count, remainingToDeduct);
        await ctx.db.patch(u._id, { count: u.count - take });
        remainingToDeduct -= take;
      }
    }

    try {
      const targetTech = await readCompletedTechnologyIds(ctx, args.targetKingdomId);
      const targetModifiers = computeTechnologyModifiers(targetTech);
      const counterProb = Math.max(0, targetModifiers.counterEspionage - 0.05 * (spiesCount - 1));

      let effectiveLevel = Math.min(4, spyLevel + Math.floor((spiesCount - 1) / 2));
      if (Math.random() < counterProb) {
        effectiveLevel = Math.max(1, effectiveLevel - 1);
      }

      const cost = calculateEspionageCost(spyLevel, modifiers.espionageCostReduction);
      const now = Date.now();
      const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
      if (settled.settledResources.gold < cost) throw new Error(`Oro insuficiente: el informe cuesta ${cost} y hay ${Math.floor(settled.settledResources.gold)}.`);
      await ctx.db.patch(settled.resources._id, { ...settled.settledResources, gold: settled.settledResources.gold - cost });
      const units = await readArmyUnitDocs(ctx, args.targetKingdomId);
      const composition = activeComposition(units);
      const estimated: Record<string, { min: number; max: number }> = {};
      for (const type of UNIT_TYPES) estimated[type] = approximateEstimate(composition[type], effectiveLevel);
      const total = approximateEstimate(Object.values(composition).reduce((a, b) => a + b, 0), effectiveLevel);
      const reportId = await ctx.db.insert("espionageReports", {
        kingdomId: args.kingdomId,
        targetKingdomId: args.targetKingdomId,
        level: effectiveLevel,
        createdAt: now,
        expiresAt: now + PARLIAMENT.ESPIONAGE.reportTtlMs,
        estimate: { min: total.min, max: total.max },
        composition: estimated,
      });

      // Los espías también son exploradores: registrar los territorios del reino objetivo en 'exploredTerritories'
      const targetTerritories = await ctx.db
        .query("territories")
        .withIndex("by_owner", (q) => q.eq("ownerKingdomId", args.targetKingdomId))
        .collect();
      for (const cell of targetTerritories) {
        const existing = await ctx.db
          .query("exploredTerritories")
          .withIndex("by_kingdom_and_cell", (q) => q.eq("kingdomId", args.kingdomId).eq("cellId", cell.cellId))
          .first();
        if (!existing) {
          await ctx.db.insert("exploredTerritories", {
            kingdomId: args.kingdomId,
            cellId: cell.cellId,
            discoveredAt: now,
            discoveryNote: `Territorio de ${target.name} descubierto por la red de espionaje.`,
          });
        }
      }

      return { success: true, reportId, cost, level: effectiveLevel, originalLevel: spyLevel, estimate: total, composition: estimated, expiresAt: now + PARLIAMENT.ESPIONAGE.reportTtlMs };
    } finally {
      // Devolver espías al ejército
      await addUnits(ctx, args.kingdomId, "espia", 1, spiesCount);
    }
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

export async function snapshotSide(ctx: MutationCtx, kingdomId: Id<"kingdoms">, role: "attacker" | "defender", distance: number, terrainMultiplier: number = 1): Promise<BattleSide> {
  const kingdom = await ctx.db.get(kingdomId);
  if (!kingdom) throw new Error("Reino participante no encontrado.");
  const settled = await settleRelationalKingdomEconomy(ctx, kingdom, kingdom.userId, Date.now());
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
  const civPassive = getCivilizationPassive(refreshed.civilization);
  const currentFatigue = typeof refreshed.armyFatigue === "number" ? refreshed.armyFatigue : 0;
  const completedTech = await readCompletedTechnologyIds(ctx, kingdomId);
  const techModifiers = computeTechnologyModifiers(completedTech);
  return {
    kingdomId,
    name: refreshed.name,
    civilization: refreshed.civilization,
    // [P37, M-11] Solo participa la fracción de cada tipo fijada en la formación del reino.
    composition: applyFormation(activeComposition(units), refreshed.formation ?? null),
    trainingMultiplier: summary.trainingMultiplier,
    weaponTier: (refreshed.weaponTier as BattleSide["weaponTier"]) ?? "palo",
    armorTier: (refreshed.armorTier as BattleSide["armorTier"]) ?? "ninguna",
    strategy: (refreshed.strategy as BattleSide["strategy"]) ?? "defensiva",
    tacticalFormation: isTacticalFormation(refreshed.tacticalFormation ?? "") ? (refreshed.tacticalFormation as BattleSide["tacticalFormation"]) : DEFAULT_TACTICAL_FORMATION,
    morale: typeof refreshed.militaryMorale === "number" ? refreshed.militaryMorale : WELLBEING.INITIAL_MORALE,
    foodTier: refreshed.foodTier ?? "normal",
    fatigue: role === "attacker"
      ? marchFatigue(
          currentFatigue,
          distance,
          terrainMultiplier,
          civPassive.fatigueAccrualMultiplier,
          techModifiers.marchFatigueReduction,
          techModifiers.fatigueAccrualReduction
        )
      : currentFatigue,
    wallsLevel: role === "defender" ? levels.murallas ?? 0 : 0,
    terrainDefenseBonus: role === "defender" ? terrainDefenseBonus : 0,
    combatAttackBonus: techModifiers.combatAttackBonus,
    combatDefenseBonus: techModifiers.combatDefenseBonus,
    moraleBase: settled.extended ? 0 : techModifiers.moraleBase,
    unitEfficiencyInf: techModifiers.unitEfficiencyInf,
    unitEfficiencyArc: techModifiers.unitEfficiencyArc,
    unitEfficiencyCav: techModifiers.unitEfficiencyCav,
    unitEfficiencySiege: techModifiers.unitEfficiencySiege,
    woundedRateBonus: techModifiers.woundedRateBonus,
  };
}

/** [COMPLEMENTO D-36] Congela composición, equipo y estrategia; los cambios posteriores no afectan al combate. */
export const freezeChallenge = internalMutation({
  args: { challengeId: v.id("challenges") },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get(args.challengeId);
    if (!challenge) return { frozen: false };
    if (challenge.battleId || challenge.resolvedAt) {
      return { frozen: false, reason: "El desafío ya está resuelto." };
    }
    if (challenge.resolutionLockedBy === "march" || challenge.activeMarchId) {
      const activeMarch = challenge.activeMarchId ? await ctx.db.get(challenge.activeMarchId) : null;
      if (!activeMarch || activeMarch.status !== "cancelada") {
        return { frozen: false, reason: "El desafío ya está vinculado a una marcha activa." };
      }
    }
    const transition = assertTransition(challenge.status as ChallengeStatus, "FROZEN");
    if (!transition.success) return { frozen: false, reason: transition.error };
    const distance = challenge.distance ?? 0;
    const attacker = await snapshotSide(ctx, challenge.challengerKingdomId, "attacker", distance, challenge.terrainMultiplier ?? 1);
    const defender = await snapshotSide(ctx, challenge.targetKingdomId, "defender", distance);
    await ctx.db.patch(args.challengeId, { status: "FROZEN", frozenAt: Date.now(), frozen: { attacker, defender } });
    return { frozen: true };
  },
});


export async function removeDeadFromPopulation(ctx: MutationCtx, kingdomId: Id<"kingdoms">, casualties: Composition, wounded: Composition): Promise<void> {
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

    // 1. Estados terminales o no autorizados: nunca resolver un desafío cancelado, rechazado, caducado, pendiente o ya resuelto
    if (
      challenge.status === "RESOLVED" ||
      challenge.status === "CANCELLED" ||
      challenge.status === "REJECTED" ||
      challenge.status === "EXPIRED" ||
      challenge.status === "PENDING" ||
      challenge.battleId ||
      challenge.resolvedAt
    ) {
      return { resolved: false, reason: `Desafío no resoluble en estado ${challenge.status}.` };
    }

    // 2. Exclusión mutua con ruta de marcha manual: si ya hay una marcha activa/completada reclamando este desafío, no crear doble batalla
    if (challenge.resolutionLockedBy === "march" || challenge.activeMarchId) {
      const linkedMarch = challenge.activeMarchId ? await ctx.db.get(challenge.activeMarchId) : null;
      if (!linkedMarch || linkedMarch.status !== "cancelada") {
        return { resolved: false, reason: "El desafío ya está siendo resuelto o fue resuelto por una marcha." };
      }
    }

    // 3. Salvaguarda de unicidad de batalla en tabla Battle
    const existingBattle = await ctx.db
      .query("Battle")
      .withIndex("by_challenge", (q) => q.eq("challengeId", args.challengeId))
      .first();
    if (existingBattle) {
      await ctx.db.patch(args.challengeId, {
        status: "RESOLVED",
        resolvedAt: challenge.resolvedAt ?? existingBattle.resolvedAt,
        battleId: existingBattle._id,
      });
      return { resolved: false, reason: "Ya existe una batalla registrada para este desafío." };
    }

    if (challenge.status === "ACCEPTED") {
      // El scheduler de congelación no se ejecutó: congelar ahora y continuar (idempotente).
      const distance = challenge.distance ?? 0;
      const attacker = await snapshotSide(ctx, challenge.challengerKingdomId, "attacker", distance, challenge.terrainMultiplier ?? 1);
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

    await ctx.db.patch(args.challengeId, {
      status: "RESOLVED",
      resolvedAt: now,
      battleId,
      resolutionLockedBy: "parliament",
    });
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

/** [BLOQUE 15] Clasificación global de reinos por honor y gloria. */
export const getLeaderboard = query({
  args: { kingdomId: v.optional(v.id("kingdoms")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    let viewerKingdomId = args.kingdomId;
    if (!viewerKingdomId && identity) {
      const userKingdom = await ctx.db
        .query("kingdoms")
        .withIndex("by_user_id", (q) => q.eq("userId", identity.subject))
        .first();
      if (userKingdom) viewerKingdomId = userKingdom._id;
    }

    const kingdoms = await ctx.db.query("kingdoms").collect();
    const sorted = kingdoms.sort((a, b) => {
      const honorA = typeof a.honor === "number" ? a.honor : 0;
      const honorB = typeof b.honor === "number" ? b.honor : 0;
      if (honorB !== honorA) return honorB - honorA;
      const gloryA = typeof a.glory === "number" ? a.glory : 0;
      const gloryB = typeof b.glory === "number" ? b.glory : 0;
      if (gloryB !== gloryA) return gloryB - gloryA;
      return a.name.localeCompare(b.name);
    });

    return {
      serverTimeMs: Date.now(),
      rankings: sorted.map((k, index) => ({
        rank: index + 1,
        kingdomId: k._id,
        name: k.name,
        monarchName: k.monarchName ?? "Monarca desconocido",
        civilization: k.civilization ?? null,
        honor: typeof k.honor === "number" ? k.honor : 0,
        glory: typeof k.glory === "number" ? k.glory : 0,
        isPlayer: viewerKingdomId ? k._id === viewerKingdomId : false,
      })),
    };
  },
});

