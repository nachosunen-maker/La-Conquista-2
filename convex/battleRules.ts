/**
 * LA CONQUISTA — SIMULADOR DETERMINISTA DE BATALLAS (Bloque F, P34-P37, P43-P47, D-27 a D-32)
 * Lógica pura: dos contingentes congelados entran, un informe completo sale.
 * Sin aleatoriedad: el mismo par de contingentes produce siempre el mismo informe.
 * Ronda 2 (17-10-2026): k = 0,40, exponentes de calidad elevados, empate a 5 puntos,
 * murallas +5 %/nivel, matriz de contrapartidas P37 y recompensas de honor/gloria.
 */
import {
  ARMORS,
  BATTLE_REWARDS,
  COMBAT,
  FOOD,
  STRATEGIES,
  STRATEGY_COUNTER_BONUS,
  STRATEGY_FACTOR_RANGE,
  UNITS,
  UNIT_COUNTERS,
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
  /** Contingente que participa (ya aplicada la fracción de formación elegida, P37). */
  composition: Composition;
  /** Multiplicador medio de entrenamiento (P29), ponderado por efectivos. */
  trainingMultiplier: number;
  weaponTier: WeaponTier;
  armorTier: ArmorTier;
  strategy: Strategy;
  morale: number; // 0-100
  foodTier: string;
  fatigue: number; // 0-100
  /** Nivel de murallas del defensor: +5 % de defensa por nivel (máx. +50 %) y asedio a pleno rendimiento. */
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
  wallsBonus: number;
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
  /** [M-01 opción A] Honor y gloria concedidos según BATTLE_REWARDS. */
  honorAwarded: { attacker: number; defender: number; pending: boolean };
  gloryAwarded: { attacker: number; defender: number; pending: boolean };
  /** [DERIVADO] Desgaste del equipo informado como porcentaje de bajas propias. */
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

/** [M-06 opción A] Bonificación defensiva de murallas. */
export function wallsDefenseBonus(wallsLevel: number): number {
  const level = Number.isInteger(wallsLevel) && wallsLevel > 0 ? wallsLevel : 0;
  return Math.min(COMBAT.WALLS_DEFENSE_MAX, level * COMBAT.WALLS_DEFENSE_PER_LEVEL);
}

/** [P37 + M-11] Fuerza ofensiva y defensiva ponderadas por tipo, con la matriz de contrapartidas. */
function strengths(composition: Composition, enemyComposition: Composition, enemyWalls: number): { offensive: number; defensive: number } {
  const enemyLiving = (["infanteria", "arqueria", "caballeria"] as const).reduce((sum, type) => sum + Math.max(0, enemyComposition[type] ?? 0), 0);
  let offensive = 0;
  let defensive = 0;
  for (const type of UNIT_TYPES) {
    const count = Math.max(0, composition[type] ?? 0);
    if (count === 0) continue;
    const unit = UNITS[type];
    let attack = type === "asedio" && enemyWalls <= 0 ? COMBAT.SIEGE_ATTACK_WITHOUT_WALLS : unit.attack;
    if (type !== "asedio" && enemyLiving > 0) {
      const countered = UNIT_COUNTERS[type];
      const share = Math.max(0, enemyComposition[countered] ?? 0) / enemyLiving;
      attack *= 1 + COMBAT.FORMATION_COUNTER_BONUS * share;
    }
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

export function computeSideFactors(side: BattleSide, composition: Composition, enemy: BattleSide, enemyComposition?: Composition): SideFactors {
  const effectives = totalUnits(composition);
  const { offensive, defensive } = strengths(composition, enemyComposition ?? enemy.composition, enemy.wallsLevel);
  const training = Math.max(0.01, side.trainingMultiplier);
  const weapons = WEAPONS[side.weaponTier]?.multiplier ?? WEAPONS.palo.multiplier;
  const armor = ARMORS[side.armorTier]?.multiplier ?? ARMORS.ninguna.multiplier;
  const formationAttack = strategyFactor(side.strategy, enemy.strategy, "attack");
  const formationDefense = strategyFactor(side.strategy, enemy.strategy, "defense");
  const morale = moraleFactor(side.morale);
  const food = foodFactor(side.foodTier);
  const fatigue = fatigueMultiplier(side.fatigue);
  const E = COMBAT.EXPONENTS;
  const common = training ** E.training * weapons ** E.weapons * armor ** E.armor
    * morale ** E.morale * food ** E.food * fatigue ** E.fatigue;
  const wallsBonus = wallsDefenseBonus(side.wallsLevel);
  const terrain = 1 + Math.max(0, side.terrainDefenseBonus) + wallsBonus;
  const offensivePower = effectives > 0 ? offensive ** E.number * formationAttack ** E.formation * common : 0;
  const defensivePower = effectives > 0 ? (defensive * terrain) ** E.number * formationDefense ** E.formation * common : 0;
  const W = COMBAT.WEIGHTS;
  const linearScore = W.number * (effectives / COMBAT.NUMBER_REFERENCE) + W.training * training
    + W.weapons * weapons + W.armor * armor + W.formation * formationAttack
    + W.morale * morale + W.food * food + W.fatigue * fatigue;
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
    wallsBonus,
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

/** [M-01 opción A] Recompensas de honor y gloria según resultado. */
export function battleRewards(outcome: BattleOutcome, crushing: boolean): { attacker: { honor: number; glory: number }; defender: { honor: number; glory: number } } {
  const win = crushing ? BATTLE_REWARDS.crushingVictory : BATTLE_REWARDS.victory;
  if (outcome === "victoria") return { attacker: { ...win }, defender: { ...BATTLE_REWARDS.defeat } };
  if (outcome === "derrota") return { attacker: { ...BATTLE_REWARDS.defeat }, defender: { ...win } };
  return { attacker: { ...BATTLE_REWARDS.draw }, defender: { ...BATTLE_REWARDS.draw } };
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
  let lastFactorsA = computeSideFactors(attacker, currentA, defender, currentD);
  let lastFactorsD = computeSideFactors(defender, currentD, attacker, currentA);

  if (nA0 === 0 || nD0 === 0) {
    attackerRetreated = nA0 === 0;
    defenderRetreated = nD0 === 0;
  }

  for (let round = 1; round <= COMBAT.MAX_ROUNDS && !attackerRetreated && !defenderRetreated; round++) {
    const factorsA = computeSideFactors(attacker, currentA, defender, currentD);
    const factorsD = computeSideFactors(defender, currentD, attacker, currentA);
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
  const rewards = battleRewards(outcome, crushingVictory);

  const woundedA = splitWounded(casualtiesA);
  const woundedD = splitWounded(casualtiesD);

  const explanation: string[] = [];
  const stronger = lastFactorsA.offensivePower >= lastFactorsD.defensivePower ? "atacante" : "defensor";
  explanation.push(`Potencia ofensiva del atacante ${lastFactorsA.offensivePower.toFixed(1)} frente a defensa ${lastFactorsD.defensivePower.toFixed(1)}: ventaja del ${stronger} en la última ronda.`);
  if (Math.abs(lastFactorsA.training - lastFactorsD.training) > 1e-9) explanation.push(`Entrenamiento: atacante ×${lastFactorsA.training.toFixed(2)} frente a defensor ×${lastFactorsD.training.toFixed(2)}.`);
  if (lastFactorsA.weapons !== lastFactorsD.weapons || lastFactorsA.armor !== lastFactorsD.armor) explanation.push(`Equipo: armas ${lastFactorsA.weapons}/${lastFactorsD.weapons}, armaduras ${lastFactorsA.armor}/${lastFactorsD.armor}.`);
  if (STRATEGIES[attacker.strategy].beats === defender.strategy) explanation.push(`La estrategia ${STRATEGIES[attacker.strategy].label} del atacante contrarrestó la ${STRATEGIES[defender.strategy].label} del defensor.`);
  if (STRATEGIES[defender.strategy].beats === attacker.strategy) explanation.push(`La estrategia ${STRATEGIES[defender.strategy].label} del defensor contrarrestó la ${STRATEGIES[attacker.strategy].label} del atacante.`);
  if (lastFactorsD.wallsBonus > 0) explanation.push(`Las murallas del defensor aportaron +${Math.round(lastFactorsD.wallsBonus * 100)} % de defensa.`);
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
    honorAwarded: { attacker: rewards.attacker.honor, defender: rewards.defender.honor, pending: !COMBAT.HONOR_REWARDS_DEFINED },
    gloryAwarded: { attacker: rewards.attacker.glory, defender: rewards.defender.glory, pending: !COMBAT.HONOR_REWARDS_DEFINED },
    equipmentWear: { attacker: Math.round(lossA * 10_000) / 100, defender: Math.round(lossD * 10_000) / 100 },
    lootTransferred: false,
  };
}

/** Recuperación anual de heridos según nivel de hospital (P45) más bonificación tecnológica y de medicina, con tope. */
export function woundedRecoveryRatio(hospitalLevel: number, technologyBonus: number, table: ReadonlyArray<{ minLevel: number; ratio: number }>, cap: number): number {
  let base = 0;
  for (const row of table) if (hospitalLevel >= row.minLevel) base = row.ratio;
  if (base === 0) return 0;
  return Math.min(cap, base + Math.max(0, technologyBonus));
}

/** Aplica la fracción de formación elegida (P37) a un inventario activo. */
export function applyFormation(composition: Composition, formation: Partial<Record<UnitType, number>> | undefined | null): Composition {
  const result = emptyComposition();
  for (const type of UNIT_TYPES) {
    const raw = formation?.[type];
    const fraction = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
    result[type] = Math.round(Math.max(0, composition[type] ?? 0) * fraction);
  }
  return result;
}
