/**
 * LA CONQUISTA — REGLAS PURAS DE BOTS MILITARES (Bloques E y F)
 * Cálculos matemáticos, adaptación al simulador de batalla y espionaje de bots.
 * Desacoplado de base de datos directa para posibilitar pruebas puras y ejecución isomórfica.
 */

import {
  BOT_DIFFICULTY_LABELS,
  BOT_DIFFICULTY_LEVELS,
  type BotDefinition,
  type BotDifficulty,
} from "./botConfig";
import {
  TECH_EFFECT_CAPS,
  UNIT_TYPES,
  type UnitType,
} from "./balanceConfig";
import type { BattleSide, Composition } from "./battleRules";
import { approximateEstimate } from "./challengeRules";

export function totalBotPersonnel(comp: Composition): number {
  return comp.infanteria + comp.arqueria + comp.caballeria;
}

export function totalBotMachines(comp: Composition): number {
  return comp.asedio;
}

export function totalBotUnits(comp: Composition): number {
  return comp.infanteria + comp.arqueria + comp.caballeria + comp.asedio;
}

/**
 * Convierte la ficha militar del bot en un BattleSide completo compatible
 * con el simulador determinista simulateBattle de La Conquista.
 */
export function createBotBattleSide(bot: BotDefinition): BattleSide {
  return {
    kingdomId: bot.id,
    name: `${bot.monarchName} (${bot.name})`,
    composition: { ...bot.army.composition },
    trainingMultiplier: bot.army.trainingMultiplier,
    weaponTier: bot.army.weaponTier,
    armorTier: bot.army.armorTier,
    strategy: bot.army.strategy,
    tacticalFormation: bot.army.tacticalFormation,
    morale: bot.army.morale,
    foodTier: bot.army.foodTier,
    fatigue: bot.army.fatigue,
    wallsLevel: bot.army.wallsLevel,
    terrainDefenseBonus: 0,
    civilization: bot.civilization,
    combatAttackBonus: 0,
    combatDefenseBonus: 0,
    moraleBase: 0,
    unitEfficiencyInf: 0,
    unitEfficiencyArc: 0,
    unitEfficiencyCav: 0,
    unitEfficiencySiege: 0,
    woundedRateBonus: 0,
  };
}

export interface BotEspionageEstimate {
  level: number;
  errorRatio: number;
  total: { min: number; max: number; error: number };
  composition: Record<string, { min: number; max: number }>;
}

/**
 * Calcula la estimación de espionaje sobre un bot respetando los márgenes
 * de error canónicos:
 * Nivel 0 (sin Espionaje I): ±25 %
 * Nivel 1 (Espionaje I): ±15 %
 * Nivel 2 (Espionaje II): ±7 %
 * Nivel 3 (Espionaje III): ±3 %
 * Nivel 4 (Espionaje IV / Navajo bonus): ±0 % (exacto)
 */
export function estimateBotArmy(bot: BotDefinition, espionageLevel: number): BotEspionageEstimate {
  const level = Math.max(0, Math.min(TECH_EFFECT_CAPS.espionageAccuracyMax, espionageLevel));
  const comp = bot.army.composition;
  const total = totalBotUnits(comp);

  const totalEstimate = approximateEstimate(total, level);
  const compEstimate: Record<string, { min: number; max: number }> = {};

  for (const type of UNIT_TYPES) {
    const val = (comp as Record<string, number>)[type] ?? 0;
    const est = approximateEstimate(val, level);
    compEstimate[type] = { min: est.min, max: est.max };
  }

  return {
    level,
    errorRatio: totalEstimate.error,
    total: totalEstimate,
    composition: compEstimate,
  };
}
