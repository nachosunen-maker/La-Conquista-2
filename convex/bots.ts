/**
 * LA CONQUISTA — SISTEMA DE BOTS MILITARES (Bloques E y F)
 * Adversarios militares gestionados desde el Parlamento.
 * - Sin economía, sin edificios, sin población civil, sin territorios.
 * - 5 bots permanentes + 5 bots rotatorios semanales deterministas (1 por dificultad).
 * - No aparecen en el mapa ni en listRivals.
 * - Simulador determinista simulateBattle con fichas militares completas e inmutables.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { isKingdomOwner } from "./kingdomAccess";
import { requireOwner } from "./buildings";
import { settleRelationalKingdomEconomy } from "./economy";
import { calculateEspionageCost, computeTechnologyModifiers, readCompletedTechnologyIds } from "./technologyRules";
import { validateBuildingCollection } from "./buildingRules";
import { simulateBattle } from "./battleRules";
import { evaluateKingdomMissions, recordMissionEvent } from "./missions";
import {
  BOT_DIFFICULTY_LABELS,
  BOT_DIFFICULTY_LEVELS,
  getAllActiveBots,
  getBotById,
  getRotationCycle,
  type BotDefinition,
  type BotDifficulty,
} from "./botConfig";
import {
  createBotBattleSide,
  estimateBotArmy,
  totalBotPersonnel,
  totalBotMachines,
  totalBotUnits,
} from "./botRules";
import {
  snapshotSide,
  applyCasualtiesToArmy,
  removeDeadFromPopulation,
} from "./parliament";
import { MORALE, PARLIAMENT, TECH_EFFECT_CAPS } from "./balanceConfig";

export const listBots = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    const isDemoRead = kingdom.userId === "guest_g9ai8cz";
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar su propio reino.");
    }

    const now = Date.now();
    const { cycleIndex, cycleExpiresAtMs } = getRotationCycle(now);
    const activeBots = getAllActiveBots(now);

    const [buildings, completedTech, espionageDocs] = await Promise.all([
      ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
      readCompletedTechnologyIds(ctx, args.kingdomId),
      ctx.db.query("espionageReports").withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId)).collect(),
    ]);

    const collection = validateBuildingCollection(buildings);
    const levels = collection.success ? collection.levels : {};
    const parliamentLevel = levels.parlamento ?? 0;

    const techModifiers = computeTechnologyModifiers(completedTech);
    const playerEspionageLevel = Math.min(
      TECH_EFFECT_CAPS.espionageAccuracyMax,
      Math.max(0, techModifiers.espionageLevel)
    );
    const hasEspionage1 = playerEspionageLevel >= 1;
    const hasEspionage2 = playerEspionageLevel >= 2;
    const hasEspionage3 = playerEspionageLevel >= 3;
    const hasEspionage4 = playerEspionageLevel >= 4;
    const espionageCost = calculateEspionageCost(
      Math.max(1, playerEspionageLevel),
      techModifiers.espionageCostReduction
    );

    // Mapeo de informes de espionaje vigentes sobre bots
    const validReports = espionageDocs.filter(
      (r) => r.expiresAt > now && r.composition && typeof r.composition._botId === "string"
    );
    const reportsByBotId = new Map<string, typeof validReports[0]>();
    for (const r of validReports) {
      const bId = r.composition._botId as string;
      const prev = reportsByBotId.get(bId);
      if (!prev || r.level > prev.level) {
        reportsByBotId.set(bId, r);
      }
    }

    const formattedBots = activeBots.map((bot) => {
      const activeReport = reportsByBotId.get(bot.id);
      const effectiveEspionageLevel = activeReport ? activeReport.level : 0;
      const estimate = estimateBotArmy(bot, effectiveEspionageLevel);

      return {
        id: bot.id,
        monarchName: bot.monarchName,
        name: bot.name,
        civilization: bot.civilization,
        difficulty: bot.difficulty,
        difficultyLabel: BOT_DIFFICULTY_LABELS[bot.difficulty],
        militaryLevel: BOT_DIFFICULTY_LEVELS[bot.difficulty].level,
        isPermanent: bot.isPermanent,
        description: bot.description,
        armyEstimate: estimate.total,
        compositionEstimate: activeReport ? estimate.composition : null,
        espionageReport: activeReport
          ? {
              level: activeReport.level,
              expiresAt: activeReport.expiresAt,
              composition: activeReport.composition,
            }
          : null,
      };
    });

    return {
      serverTimeMs: now,
      parliamentLevel,
      requiredParliamentLevel: PARLIAMENT.REQUIRED_PARLIAMENT_LEVEL,
      canEngageBots: parliamentLevel >= PARLIAMENT.REQUIRED_PARLIAMENT_LEVEL,
      rotationCycle: cycleIndex,
      cycleExpiresAtMs,
      hasEspionage1,
      hasEspionage2,
      hasEspionage3,
      hasEspionage4,
      playerEspionageLevel,
      espionageCost,
      bots: formattedBots,
    };
  },
});

export const requestBotEspionage = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    botId: v.string(),
  },
  handler: async (ctx, args) => {
    const { kingdom, userId } = await requireOwner(ctx, args.kingdomId);
    const bot = getBotById(args.botId);
    if (!bot) throw new Error(`Bot militar "${args.botId}" no encontrado.`);

    const completedTech = await readCompletedTechnologyIds(ctx, args.kingdomId);
    const techModifiers = computeTechnologyModifiers(completedTech);
    const playerEspionageLevel = techModifiers.espionageLevel;
    if (playerEspionageLevel < 1) {
      throw new Error("Requiere la tecnología Espionaje I investigada en la Universidad.");
    }

    const level = Math.min(TECH_EFFECT_CAPS.espionageAccuracyMax, playerEspionageLevel);
    const cost = calculateEspionageCost(level, techModifiers.espionageCostReduction);

    const now = Date.now();
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
    if (settled.settledResources.gold < cost) {
      throw new Error(
        `Oro insuficiente: el informe cuesta ${cost} y hay ${Math.floor(settled.settledResources.gold)}.`
      );
    }

    await ctx.db.patch(settled.resources._id, {
      ...settled.settledResources,
      gold: settled.settledResources.gold - cost,
    });

    const estimate = estimateBotArmy(bot, level);
    const expiresAt = now + PARLIAMENT.ESPIONAGE.reportTtlMs;

    const reportId = await ctx.db.insert("espionageReports", {
      kingdomId: args.kingdomId,
      targetKingdomId: args.kingdomId, // Asignado a sí mismo para compatibilidad con esquema
      level,
      createdAt: now,
      expiresAt,
      estimate: { min: estimate.total.min, max: estimate.total.max },
      composition: {
        ...estimate.composition,
        _botId: bot.id,
      },
    });

    return {
      success: true,
      reportId,
      cost,
      level,
      estimate: estimate.total,
      composition: estimate.composition,
      expiresAt,
    };
  },
});

export const attackBot = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    botId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.kingdomId);
    const bot = getBotById(args.botId);
    if (!bot) throw new Error(`Bot militar "${args.botId}" no encontrado.`);

    // 1. Snapshot del atacante (el jugador)
    const attackerSide = await snapshotSide(ctx, args.kingdomId, "attacker", 0, 1);
    const playerPersonnel = attackerSide.composition.infanteria + attackerSide.composition.arqueria + attackerSide.composition.caballeria;
    const playerMachines = attackerSide.composition.asedio;
    if (playerPersonnel + playerMachines <= 0) {
      throw new Error("No tienes tropas disponibles para iniciar el combate contra este monarca.");
    }

    // 2. Construcción de la ficha del defensor (el bot)
    const defenderSide = createBotBattleSide(bot);

    // 3. Ejecución determinista del combate (simulateBattle)
    const report = simulateBattle(attackerSide, defenderSide);
    const now = Date.now();

    // 4. Registro de desafío formal (para referencia relacional de la batalla)
    const challengeId = await ctx.db.insert("challenges", {
      challengerKingdomId: args.kingdomId,
      targetKingdomId: args.kingdomId,
      challengeType: `BOT_BATTLE:${bot.id}`,
      status: "RESOLVED",
      createdAt: now,
      expiresAt: now,
      resolvedAt: now,
      distance: 0,
      marchSeconds: 0,
    });

    // 5. Registro del informe en la tabla Battle
    const battleReportWithMeta = {
      ...report,
      botBattle: true,
      botId: bot.id,
      botDifficulty: bot.difficulty,
      botCivilization: bot.civilization,
    };

    const isPlayerWinner = report.winnerKingdomId === args.kingdomId;
    const battleId = await ctx.db.insert("Battle", {
      challengeId,
      attackerKingdomId: args.kingdomId,
      defenderKingdomId: args.kingdomId,
      resolvedAt: now,
      outcome: report.outcome,
      winnerKingdomId: isPlayerWinner ? args.kingdomId : undefined,
      crushingVictory: report.crushingVictory,
      report: battleReportWithMeta,
    });

    // 6. Aplicar bajas e impacto poblacional SOLO al jugador
    // El bot es una plantilla estática y NO sufre mermas en base de datos.
    await applyCasualtiesToArmy(
      ctx,
      args.kingdomId,
      report.attacker.casualtiesComposition,
      report.attacker.woundedComposition
    );
    await removeDeadFromPopulation(
      ctx,
      args.kingdomId,
      report.attacker.casualtiesComposition,
      report.attacker.woundedComposition
    );

    // 7. Efectos de moral, honor y gloria en el reino del jugador
    const currentKingdomDoc = await ctx.db.get(args.kingdomId);
    if (currentKingdomDoc) {
      const expiresAt = now + MORALE.BATTLE_EFFECT_DURATION_SECONDS * 1000;
      const won = report.winnerKingdomId === args.kingdomId;
      const lost = report.loserKingdomId === args.kingdomId;
      const effects = [...(currentKingdomDoc.moraleEffects ?? []).filter((e) => e.expiresAt > now)];
      if (won) effects.push({ amount: MORALE.VICTORY_BONUS, expiresAt });
      if (lost) effects.push({ amount: -MORALE.DEFEAT_PENALTY, expiresAt });

      const patch: Record<string, unknown> = {
        moraleEffects: effects,
        armyFatigue: attackerSide.fatigue,
        updatedAt: now,
      };

      if (won && report.crushingVictory) {
        patch.pendingTerritoryClaims = (currentKingdomDoc.pendingTerritoryClaims ?? 0) + 1;
      }

      const honorGain = report.honorAwarded.attacker;
      const gloryGain = report.gloryAwarded.attacker;
      patch.honor = Math.max(0, (currentKingdomDoc.honor ?? 0) + honorGain);
      patch.glory = Math.max(0, (currentKingdomDoc.glory ?? 0) + gloryGain);

      await ctx.db.patch(args.kingdomId, patch);
    }

    // 8. Registro de eventos de misión y evaluación de misiones
    await recordMissionEvent(ctx, args.kingdomId, "battlesFought", 1, false);
    if (isPlayerWinner) {
      await recordMissionEvent(ctx, args.kingdomId, "battlesWon", 1, false);
      if (report.crushingVictory) {
        await recordMissionEvent(ctx, args.kingdomId, "crushingVictories", 1, false);
      }
    }
    await evaluateKingdomMissions(ctx, args.kingdomId, now);

    return {
      success: true,
      battleId,
      outcome: report.outcome,
      crushingVictory: report.crushingVictory,
      report: battleReportWithMeta,
    };
  },
});
