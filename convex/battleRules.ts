/**
 * LA CONQUISTA — SIMULADOR DETERMINISTA DE BATALLAS (Bloque F, P34-P37, P43-P47, D-27 a D-32)
 * Lógica pura: dos contingentes congelados entran, un informe completo sale.
 * Sin aleatoriedad: el mismo par de contingentes produce siempre el mismo informe.
 */
import {
  ARMORS,
  COMBAT,
  FOOD,
  STRATEGIES,
  STRATEGY_COUNTER_BONUS,
  STRATEGY_FACTOR_RANGE,
  UNITS,
  UNIT_TYPES,
  WEAPONS,
  type ArmorTier,
  type Strategy,
  type UnitType,
  type WeaponTier,
} from "./balanceConfig";
import { fatigueMultiplier } from "./territoryRules";

export type Composition = Record<UnitType, number>;

export interface BattleSide {
  kingdomId: string;
  name: string;
  composition: Composition;
  /** Multiplicador medio de entrenamiento (P29), ponderado por efectivos. */
  trainingMultiplier: number;
  weaponTier: WeaponTier;
  armorTier: ArmorTier;
  strategy: Strategy;
  morale: number; // 0-100
  foodTier: string;
  fatigue: number; // 0-100
  /** Nivel de murallas del defensor (el asedio solo rinde a pleno contra murallas). */
  wallsLevel: number;
  /** Bonificación defensiva del terreno del territorio principal (0,1 = +10 %). */
  terrainDefenseBonus: number;
}

export interface SideFactors {
  effectives: number;
  offensiveStrength: number;
  defensiveStrength: number;
  training: number;
  weapons: number;
  armor: number;
  formation: number;
  morale: number;
  food: number;
  fatigue: number;
  offensivePower: number;
  defensivePower: number;
  linearScore: number;
}

export interface RoundReport {
  round: number;
  ratio: number;
  attackerCasualties: number;
  defenderCasualties: number;
  attackerRemaining: number;
  defenderRemaining: number;
}

export type BattleOutcome = "victoria" | "derrota" | "empate";

export interface SideResult {
  kingdomId: string;
  name: string;
  initial: number;
  initialComposition: Composition;
  survivors: number;
  survivorsComposition: Composition;
  casualties: number;
  casualtiesComposition: Composition;
  wounded: number;
  woundedComposition: Composition;
  dead: number;
  lossRatio: number;
  retreated: boolean;
  factors: SideFactors;
}

export interface BattleReport {
  /** Resultado desde el punto de vista del atacante. */
  outcome: BattleOutcome;
  winnerKingdomId: string | null;
  loserKingdomId: string | null;
  crushingVictory: boolean;
  rounds: RoundReport[];
  attacker: SideResult;
  defender: SideResult;
  explanation: string[];
  /** [MAESTRA P50-P51] Importes pendientes de balance: se registran a cero. */
  honorAwarded: { attacker: number; defender: number; pending: true };
  gloryAwarded: { attacker: number; defender: number; pending: true };
  /** [DERIVADO] Desgaste del equipo informado como porcentaje de bajas propias (sin regla numérica oficial). */
  equipmentWear: { attacker: number; defender: number };
  /** [COMPLEMENTO D-31] Sin botín en la primera versión. */
  lootTransferred: false;
}

export function emptyComposition(): Composition {
  return { infanteria: 0, arqueria: 0, caballeria: 0, asedio: 0 };
}

export function totalUnits(composition: Composition): number {
  return UNIT_TYPES.reduce((sum, type) => sum + Math.max(0, composition[type] ?? 0), 0);
}

function strengths(side: BattleSide, composition: Composition, enemyWalls: number): { offensive: number; defensive: number } {
  let offensive = 0;
  let defensive = 0;
  for (const type of UNIT_TYPES) {
    const count = Math.max(0, composition[type] ?? 0);
    const unit = UNITS[type];
    const attack = type === "asedio" && enemyWalls <= 0 ? COMBAT.SIEGE_ATTACK_WITHOUT_WALLS : unit.attack;
    offensive += count * attack;
    defensive += count * unit.defense;
  }
  return { offensive, defensive };
}

/** [MAESTRA P35 + COMPLEMENTO §6] Factor de formación/estrategia entre 0,80 y 1,25, con ventaja al contrarrestar. */
export function strategyFactor(own: Strategy, enemy: Strategy, mode: "attack" | "defense"): number {
  const base = STRATEGIES[own][mode];
  const counters = STRATEGIES[own].beats === enemy;
  const value = counters ? base * STRATEGY_COUNTER_BONUS : base;
  return Math.max(STRATEGY_FACTOR_RANGE.min, Math.min(STRATEGY_FACTOR_RANGE.max, value));
}

export function moraleFactor(morale: number): number {
  const value = Number.isFinite(morale) ? Math.max(0, Math.min(100, morale)) : 50;
  return COMBAT.MORALE_FACTOR_BASE + value / COMBAT.MORALE_FACTOR_DIVISOR;
}

export function foodFactor(foodTier: string): number {
  const factor = (FOOD.TIER_FACTORS as Record<string, number>)[foodTier] ?? 1;
  return Math.max(COMBAT.FOOD_FACTOR_MIN, Math.min(COMBAT.FOOD_FACTOR_MAX, factor));
}

export function computeSideFactors(side: BattleSide, composition: Composition, enemy: BattleSide): SideFactors {
  const effectives = totalUnits(composition);
  const { offensive, defensive } = strengths(side, composition, enemy.wallsLevel);
  const training = Math.max(0.01, side.trainingMultiplier);
  const weapons = WEAPONS[side.weaponTier]?.multiplier ?? WEAPONS.palo.multiplier;
  const armor = ARMORS[side.armorTier]?.multiplier ?? ARMORS.ninguna.multiplier;
  const formationAttack = strategyFactor(side.strategy, enemy.strategy, "attack");
  const formationDefense = strategyFactor(side.strategy, enemy.strategy, "defense");
  const morale = moraleFactor(side.morale);
  const food = foodFactor(side.foodTier);
  const fatigue = fatigueMultiplier(side.fatigue);
  const common = training ** COMBAT.WEIGHTS.training * weapons ** COMBAT.WEIGHTS.weapons * armor ** COMBAT.WEIGHTS.armor
    * morale ** COMBAT.WEIGHTS.morale * food ** COMBAT.WEIGHTS.food * fatigue ** COMBAT.WEIGHTS.fatigue;
  const terrain = 1 + Math.max(0, side.terrainDefenseBonus);
  const offensivePower = effectives > 0 ? offensive ** COMBAT.NUMBER_EXPONENT * formationAttack ** COMBAT.WEIGHTS.formation * common : 0;
  const defensivePower = effectives > 0 ? (defensive * terrain) ** COMBAT.NUMBER_EXPONENT * formationDefense ** COMBAT.WEIGHTS.formation * common : 0;
  const linearScore = COMBAT.WEIGHTS.number * (effectives / COMBAT.NUMBER_REFERENCE) + COMBAT.WEIGHTS.training * training
    + COMBAT.WEIGHTS.weapons * weapons + COMBAT.WEIGHTS.armor * armor + COMBAT.WEIGHTS.formation * formationAttack
    + COMBAT.WEIGHTS.morale * morale + COMBAT.WEIGHTS.food * food + COMBAT.WEIGHTS.fatigue * fatigue;
  return {
    effectives,
    offensiveStrength: offensive,
    defensiveStrength: defensive,
    training,
    weapons,
    armor,
    formation: formationAttack,
    morale,
    food,
    fatigue,
    offensivePower,
    defensivePower,
    linearScore,
  };
}

function applyCasualties(composition: Composition, casualties: number): Composition {
  const total = totalUnits(composition);
  const next = { ...composition };
  if (total <= 0 || casualties <= 0) return next;
  const share = Math.min(1, casualties / total);
  for (const type of UNIT_TYPES) next[type] = Math.max(0, composition[type] * (1 - share));
  return next;
}

function roundComposition(composition: Composition): Composition {
  const result = emptyComposition();
  for (const type of UNIT_TYPES) result[type] = Math.round(composition[type]);
  return result;
}

function diffComposition(initial: Composition, final: Composition): Composition {
  const result = emptyComposition();
  for (const type of UNIT_TYPES) result[type] = Math.max(0, initial[type] - final[type]);
  return result;
}

/** [MAESTRA P44] ≈65 % de las bajas se convierten en heridos, aplicado por tipo (sin doble conversión). */
function splitWounded(casualties: Composition): Composition {
  const wounded = emptyComposition();
  for (const type of UNIT_TYPES) wounded[type] = Math.round(casualties[type] * COMBAT.WOUNDED_RATIO);
  return wounded;
}

export function simulateBattle(attacker: BattleSide, defender: BattleSide): BattleReport {
  const initialAttacker = roundComposition(attacker.composition);
  const initialDefender = roundComposition(defender.composition);
  const nA0 = totalUnits(initialAttacker);
  const nD0 = totalUnits(initialDefender);
  let currentA: Composition = { ...initialAttacker };
  let currentD: Composition = { ...initialDefender };
  const rounds: RoundReport[] = [];
  let attackerRetreated = false;
  let defenderRetreated = false;
  let lastFactorsA = computeSideFactors(attacker, currentA, defender);
  let lastFactorsD = computeSideFactors(defender, currentD, attacker);

  if (nA0 === 0 || nD0 === 0) {
    attackerRetreated = nA0 === 0;
    defenderRetreated = nD0 === 0;
  }

  for (let round = 1; round <= COMBAT.MAX_ROUNDS && !attackerRetreated && !defenderRetreated; round++) {
    const factorsA = computeSideFactors(attacker, currentA, defender);
    const factorsD = computeSideFactors(defender, currentD, attacker);
    lastFactorsA = factorsA;
    lastFactorsD = factorsD;
    const nA = totalUnits(currentA);
    const nD = totalUnits(currentD);
    const ratio = factorsA.offensivePower / Math.max(factorsD.defensivePower, 0.01);
    const inverse = factorsD.offensivePower / Math.max(factorsA.defensivePower, 0.01);
    const defenderCasualties = Math.min(nD, nD * COMBAT.CASUALTY_RATE_K * (ratio / (1 + ratio)));
    const attackerCasualties = Math.min(nA, nA * COMBAT.CASUALTY_RATE_K * (inverse / (1 + inverse)));
    currentA = applyCasualties(currentA, attackerCasualties);
    currentD = applyCasualties(currentD, defenderCasualties);
    const remainingA = totalUnits(currentA);
    const remainingD = totalUnits(currentD);
    rounds.push({
      round,
      ratio,
      attackerCasualties: Math.round(attackerCasualties * 100) / 100,
      defenderCasualties: Math.round(defenderCasualties * 100) / 100,
      attackerRemaining: Math.round(remainingA * 100) / 100,
      defenderRemaining: Math.round(remainingD * 100) / 100,
    });
    attackerRetreated = remainingA <= 0 || (1 - remainingA / nA0) >= COMBAT.RETREAT_LOSS_RATIO || attacker.morale < COMBAT.RETREAT_MORALE_BELOW;
    defenderRetreated = remainingD <= 0 || (1 - remainingD / nD0) >= COMBAT.RETREAT_LOSS_RATIO || defender.morale < COMBAT.RETREAT_MORALE_BELOW;
  }

  const finalA = roundComposition(currentA);
  const finalD = roundComposition(currentD);
  const casualtiesA = diffComposition(initialAttacker, finalA);
  const casualtiesD = diffComposition(initialDefender, finalD);
  const lossA = nA0 > 0 ? totalUnits(casualtiesA) / nA0 : 0;
  const lossD = nD0 > 0 ? totalUnits(casualtiesD) / nD0 : 0;

  let outcome: BattleOutcome;
  if (attackerRetreated && !defenderRetreated) outcome = "derrota";
  else if (defenderRetreated && !attackerRetreated) outcome = "victoria";
  else if (Math.abs(lossA - lossD) <= COMBAT.DRAW_TOLERANCE) outcome = "empate";
  else outcome = lossD > lossA ? "victoria" : "derrota";

  const winnerKingdomId = outcome === "victoria" ? attacker.kingdomId : outcome === "derrota" ? defender.kingdomId : null;
  const loserKingdomId = outcome === "victoria" ? defender.kingdomId : outcome === "derrota" ? attacker.kingdomId : null;
  const loserLoss = outcome === "victoria" ? lossD : outcome === "derrota" ? lossA : 0;
  const crushingVictory = winnerKingdomId !== null && loserLoss > COMBAT.CRUSHING_VICTORY_LOSS_RATIO;

  const woundedA = splitWounded(casualtiesA);
  const woundedD = splitWounded(casualtiesD);

  const explanation: string[] = [];
  const stronger = lastFactorsA.offensivePower >= lastFactorsD.defensivePower ? "atacante" : "defensor";
  explanation.push(`Potencia ofensiva del atacante ${lastFactorsA.offensivePower.toFixed(1)} frente a defensa ${lastFactorsD.defensivePower.toFixed(1)}: ventaja del ${stronger} en la última ronda.`);
  if (Math.abs(lastFactorsA.training - lastFactorsD.training) > 1e-9) explanation.push(`Entrenamiento: atacante ×${lastFactorsA.training.toFixed(2)} frente a defensor ×${lastFactorsD.training.toFixed(2)}.`);
  if (lastFactorsA.weapons !== lastFactorsD.weapons || lastFactorsA.armor !== lastFactorsD.armor) explanation.push(`Equipo: armas ${lastFactorsA.weapons}/${lastFactorsD.weapons}, armaduras ${lastFactorsA.armor}/${lastFactorsD.armor}.`);
  if (STRATEGIES[attacker.strategy].beats === defender.strategy) explanation.push(`La estrategia ${STRATEGIES[attacker.strategy].label} del atacante contrarrestó la ${STRATEGIES[defender.strategy].label} del defensor.`);
  if (STRATEGIES[defender.strategy].beats === attacker.strategy) explanation.push(`La estrategia ${STRATEGIES[defender.strategy].label} del defensor contrarrestó la ${STRATEGIES[attacker.strategy].label} del atacante.`);
  if (lastFactorsA.fatigue < 1) explanation.push(`La fatiga de la marcha penalizó al atacante (×${lastFactorsA.fatigue}).`);
  if (lastFactorsA.morale !== lastFactorsD.morale) explanation.push(`Moral: atacante ${attacker.morale}, defensor ${defender.morale}.`);
  if (attackerRetreated) explanation.push("El atacante se retiró al superar el umbral de pérdidas o por moral insuficiente.");
  if (defenderRetreated) explanation.push("El defensor se retiró al superar el umbral de pérdidas o por moral insuficiente.");
  if (outcome === "empate") explanation.push("Pérdidas similares sin ventaja significativa: empate (P52).");
  if (crushingVictory) explanation.push("El perdedor perdió más del 75 % de su ejército: victoria aplastante (P47) que habilita reclamar un territorio libre cercano (P48).");

  const buildSide = (side: BattleSide, initial: Composition, final: Composition, casualties: Composition, wounded: Composition, lossRatio: number, retreated: boolean, factors: SideFactors): SideResult => ({
    kingdomId: side.kingdomId,
    name: side.name,
    initial: totalUnits(initial),
    initialComposition: initial,
    survivors: totalUnits(final),
    survivorsComposition: final,
    casualties: totalUnits(casualties),
    casualtiesComposition: casualties,
    wounded: totalUnits(wounded),
    woundedComposition: wounded,
    dead: totalUnits(casualties) - totalUnits(wounded),
    lossRatio: Math.round(lossRatio * 10_000) / 10_000,
    retreated,
    factors,
  });

  return {
    outcome,
    winnerKingdomId,
    loserKingdomId,
    crushingVictory,
    rounds,
    attacker: buildSide(attacker, initialAttacker, finalA, casualtiesA, woundedA, lossA, attackerRetreated, lastFactorsA),
    defender: buildSide(defender, initialDefender, finalD, casualtiesD, woundedD, lossD, defenderRetreated, lastFactorsD),
    explanation,
    honorAwarded: { attacker: 0, defender: 0, pending: true },
    gloryAwarded: { attacker: 0, defender: 0, pending: true },
    equipmentWear: { attacker: Math.round(lossA * 10_000) / 100, defender: Math.round(lossD * 10_000) / 100 },
    lootTransferred: false,
  };
}

/** Recuperación anual de heridos según nivel de hospital (P45) más bonificación tecnológica, con tope. */
export function woundedRecoveryRatio(hospitalLevel: number, technologyBonus: number, table: ReadonlyArray<{ minLevel: number; ratio: number }>, cap: number): number {
  let base = 0;
  for (const row of table) if (hospitalLevel >= row.minLevel) base = row.ratio;
  if (base === 0) return 0;
  return Math.min(cap, base + Math.max(0, technologyBonus));
}
