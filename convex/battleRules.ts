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
  HOSPITAL,
  HOSPITAL_RECOVERY_CAP,
  HOSPITAL_RECOVERY_PER_YEAR,
  STRATEGIES,
  STRATEGY_COUNTER_BONUS,
  STRATEGY_FACTOR_RANGE,
  DEFAULT_TACTICAL_FORMATION,
  TACTICAL_FORMATIONS,
  TACTICAL_FORMATION_COUNTER_BONUS,
  TACTICAL_FORMATION_FACTOR_RANGE,
  UNITS,
  UNIT_COUNTERS,
  UNIT_TYPES,
  WEAPONS,
  type ArmorTier,
  type Strategy,
  type TacticalFormation,
  type UnitType,
  type WeaponTier,
} from "./balanceConfig";
import { fatigueMultiplier } from "./territoryRules";
import { getCivilizationPassive } from "./civilizationRules";

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
  /** [DECISIÓN 21-10-2026] Formación táctica; si falta, equilibrada. */
  tacticalFormation?: TacticalFormation;
  morale: number; // 0-100
  foodTier: string;
  fatigue: number; // 0-100
  /** Nivel de murallas del defensor: +5 % de defensa por nivel (máx. +50 %) y asedio a pleno rendimiento. */
  wallsLevel: number;
  /** Bonificación defensiva del terreno del territorio principal (0,1 = +10 %). */
  terrainDefenseBonus: number;
  /** [P6, Bloque 10] Identificador de civilización oficial. */
  civilization?: string;
  /** Bonificación ofensiva tecnológica aditiva (+0,05 = +5 %). */
  combatAttackBonus?: number;
  /** Bonificación defensiva tecnológica aditiva (+0,05 = +5 %). */
  combatDefenseBonus?: number;
  moraleBase?: number;
  unitEfficiencyInf?: number;
  unitEfficiencyArc?: number;
  unitEfficiencyCav?: number;
  /** Bonificación tecnológica a la proporción de heridos aditiva (+0,04 = +4 pp). */
  woundedRateBonus?: number;
}

export interface SideFactors {
  effectives: number;
  offensiveStrength: number;
  defensiveStrength: number;
  training: number;
  weapons: number;
  armor: number;
  /** Factor combinado estrategia × formación táctica (modo ataque). */
  formation: number;
  tacticalFormation: TacticalFormation;
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
  const comp = {} as Record<UnitType, number>;
  for (const t of UNIT_TYPES) {
    comp[t] = 0;
  }
  return comp as Composition;
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
function strengths(side: BattleSide, composition: Composition, enemyComposition: Composition, enemyWalls: number): { offensive: number; defensive: number } {
  const enemyLiving = UNIT_TYPES.reduce((sum, type) => sum + (UNITS[type]?.isLivingTroop ? Math.max(0, enemyComposition[type] ?? 0) : 0), 0);
  let offensive = 0;
  let defensive = 0;
  for (const type of UNIT_TYPES) {
    const count = Math.max(0, composition[type] ?? 0);
    if (count === 0) continue;
    const unit = UNITS[type];
    let attack = !unit.isLivingTroop && enemyWalls <= 0 ? COMBAT.SIEGE_ATTACK_WITHOUT_WALLS : unit.attack;
    let defense = unit.defense;
    
    // Aplicar eficiencia de unidad
    let efficiency = 0;
    if (type === "infanteria") efficiency = side.unitEfficiencyInf ?? 0;
    else if (type === "arqueria") efficiency = side.unitEfficiencyArc ?? 0;
    else if (type === "caballeria") efficiency = side.unitEfficiencyCav ?? 0;
    
    attack *= (1 + efficiency);
    defense *= (1 + efficiency);

    if (unit.isLivingTroop && enemyLiving > 0) {
      const countered = (UNIT_COUNTERS as Record<string, string>)[type];
      if (countered && enemyComposition[countered as UnitType] !== undefined) {
        const share = Math.max(0, enemyComposition[countered as UnitType] ?? 0) / enemyLiving;
        attack *= 1 + COMBAT.FORMATION_COUNTER_BONUS * share;
      }
    }
    offensive += count * attack;
    defensive += count * defense;
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

/** [DECISIÓN 21-10-2026] Factor de la formación táctica, acotado; contrarrestar da ×1,10. */
export function tacticalFormationOf(side: Pick<BattleSide, "tacticalFormation">): TacticalFormation {
  const value = side.tacticalFormation;
  return value && Object.hasOwn(TACTICAL_FORMATIONS, value) ? value : DEFAULT_TACTICAL_FORMATION;
}

export function tacticalFormationFactor(own: TacticalFormation, enemy: TacticalFormation, mode: "attack" | "defense"): number {
  const base = TACTICAL_FORMATIONS[own][mode];
  return Math.max(TACTICAL_FORMATION_FACTOR_RANGE.min, Math.min(TACTICAL_FORMATION_FACTOR_RANGE.max, base));
}

/**
 * Término «Contramedida» de la fórmula de potencia (Ronda 2): multiplicador directo cuando la
 * formación táctica propia contrarresta a la enemiga; 1 en cualquier otro caso.
 */
export function tacticalCounterMultiplier(own: TacticalFormation, enemy: TacticalFormation): number {
  return TACTICAL_FORMATIONS[own].beats === enemy ? TACTICAL_FORMATION_COUNTER_BONUS : 1;
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
  const rawStrengths = strengths(side, composition, enemyComposition ?? enemy.composition, enemy.wallsLevel);
  const civPassive = getCivilizationPassive(side.civilization);
  const techAttack = 1 + Math.max(0, side.combatAttackBonus ?? 0);
  const techDefense = 1 + Math.max(0, side.combatDefenseBonus ?? 0);
  const offensive = rawStrengths.offensive * civPassive.combatAttackMultiplier * techAttack;
  const defensive = rawStrengths.defensive * civPassive.combatDefenseMultiplier * techDefense;
  const training = Math.max(0.01, side.trainingMultiplier);
  const weapons = WEAPONS[side.weaponTier]?.multiplier ?? WEAPONS.palo.multiplier;
  const armor = ARMORS[side.armorTier]?.multiplier ?? ARMORS.ninguna.multiplier;
  const ownTactical = tacticalFormationOf(side);
  const enemyTactical = tacticalFormationOf(enemy);
  const formationAttack = strategyFactor(side.strategy, enemy.strategy, "attack") * tacticalFormationFactor(ownTactical, enemyTactical, "attack");
  const formationDefense = strategyFactor(side.strategy, enemy.strategy, "defense") * tacticalFormationFactor(ownTactical, enemyTactical, "defense");
  const morale = moraleFactor(Math.min(100, side.morale + (side.moraleBase ?? 0)));
  const food = foodFactor(side.foodTier);
  const fatigue = fatigueMultiplier(side.fatigue);
  const E = COMBAT.EXPONENTS;
  const common = weapons ** E.weapons * armor ** E.armor
    * morale ** E.morale * food ** E.food * fatigue ** E.fatigue;
  const wallsBonus = wallsDefenseBonus(side.wallsLevel);
  const terrain = 1 + Math.max(0, side.terrainDefenseBonus) + wallsBonus;
  const counter = tacticalCounterMultiplier(ownTactical, enemyTactical);
  const offensivePower = effectives > 0 ? offensive ** E.number * formationAttack ** E.formation * (training ** E.training) * common * counter : 0;
  const defensivePower = effectives > 0 ? (defensive * terrain) ** E.number * formationDefense ** E.formation * (training ** E.training) * common * counter : 0;
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
    tacticalFormation: ownTactical,
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
  for (const type of UNIT_TYPES) result[type] = Math.round(composition[type] ?? 0);
  return result;
}

function diffComposition(initial: Composition, final: Composition): Composition {
  const result = emptyComposition();
  for (const type of UNIT_TYPES) result[type] = Math.max(0, (initial[type] ?? 0) - (final[type] ?? 0));
  return result;
}

/** [MAESTRA P44 + E4c] ≈65 % de las bajas se convierten en heridos, con bonificación tecnológica. */
function splitWounded(casualties: Composition, techBonus: number = 0): Composition {
  const wounded = emptyComposition();
  const ratio = Math.max(0, Math.min(1, COMBAT.WOUNDED_RATIO + techBonus));
  for (const type of UNIT_TYPES) wounded[type] = Math.round(casualties[type] * ratio);
  return wounded;
}

export interface BattleRewardResult {
  honor: number;
  glory: number;
  baseHonor: number;
  baseGlory: number;
  sizeScale: number;
  victoryTier: "crushing" | "decisive" | "standard" | "narrow" | "draw" | "defeat";
}

/**
 * [DECISIÓN 17-10-2026, M-01 opción A y Ronda 3] Recompensas de honor y gloria con escalado por
 * tamaño relativo de ejércitos (anti-exploit) y niveles de victoria (aplastante, decisiva, estándar, mínima).
 */
export function calculateBattleRewards(
  outcome: BattleOutcome,
  crushing: boolean,
  attackerInitial: number,
  defenderInitial: number,
  loserLossRatio: number
): {
  attacker: BattleRewardResult;
  defender: BattleRewardResult;
} {
  const nA = Math.max(0, attackerInitial);
  const nD = Math.max(0, defenderInitial);

  // Escala por tamaño relativo para el atacante frente al defensor
  const ratioA = nA > 0 ? nD / nA : 1;
  const ratioD = nD > 0 ? nA / nD : 1;

  // Límite mínimo de efectivos para evitar batallas artificiales (farming de duelos 1 vs 1)
  const minArmyLimit = BATTLE_REWARDS.SIZE_SCALING.MIN_ARMY_SIZE;
  const minUnitsPresent = Math.min(nA, nD);
  const sizeFactor = minUnitsPresent < minArmyLimit && minUnitsPresent > 0 ? minUnitsPresent / minArmyLimit : 1;

  const rawScaleA = Math.max(BATTLE_REWARDS.SIZE_SCALING.MIN_SCALE, Math.min(BATTLE_REWARDS.SIZE_SCALING.MAX_SCALE, Math.sqrt(ratioA)));
  const rawScaleD = Math.max(BATTLE_REWARDS.SIZE_SCALING.MIN_SCALE, Math.min(BATTLE_REWARDS.SIZE_SCALING.MAX_SCALE, Math.sqrt(ratioD)));

  const scaleA = Math.round(rawScaleA * sizeFactor * 100) / 100;
  const scaleD = Math.round(rawScaleD * sizeFactor * 100) / 100;

  // Determinar nivel de victoria
  let winTier: "crushing" | "decisive" | "standard" | "narrow" = "standard";
  let winBase: { honor: number; glory: number } = BATTLE_REWARDS.victory;

  if (crushing) {
    winTier = "crushing";
    winBase = BATTLE_REWARDS.crushingVictory;
  } else if (loserLossRatio >= 0.50) {
    winTier = "decisive";
    winBase = BATTLE_REWARDS.decisiveVictory;
  } else if (loserLossRatio >= 0.25) {
    winTier = "standard";
    winBase = BATTLE_REWARDS.victory;
  } else {
    winTier = "narrow";
    winBase = BATTLE_REWARDS.narrowVictory;
  }

  if (outcome === "victoria") {
    const effScaleA = (nA === 0 && nD === 0) ? 1 : scaleA;
    const honorA = Math.max(1, Math.round(winBase.honor * effScaleA));
    const gloryA = Math.max(1, Math.round(winBase.glory * effScaleA));
    return {
      attacker: { honor: honorA, glory: gloryA, baseHonor: winBase.honor, baseGlory: winBase.glory, sizeScale: effScaleA, victoryTier: winTier },
      defender: { honor: BATTLE_REWARDS.defeat.honor, glory: BATTLE_REWARDS.defeat.glory, baseHonor: BATTLE_REWARDS.defeat.honor, baseGlory: BATTLE_REWARDS.defeat.glory, sizeScale: scaleD, victoryTier: "defeat" },
    };
  }

  if (outcome === "derrota") {
    const effScaleD = (nA === 0 && nD === 0) ? 1 : scaleD;
    const honorD = Math.max(1, Math.round(winBase.honor * effScaleD));
    const gloryD = Math.max(1, Math.round(winBase.glory * effScaleD));
    return {
      attacker: { honor: BATTLE_REWARDS.defeat.honor, glory: BATTLE_REWARDS.defeat.glory, baseHonor: BATTLE_REWARDS.defeat.honor, baseGlory: BATTLE_REWARDS.defeat.glory, sizeScale: scaleA, victoryTier: "defeat" },
      defender: { honor: honorD, glory: gloryD, baseHonor: winBase.honor, baseGlory: winBase.glory, sizeScale: effScaleD, victoryTier: winTier },
    };
  }

  // Empate
  return {
    attacker: { honor: BATTLE_REWARDS.draw.honor, glory: BATTLE_REWARDS.draw.glory, baseHonor: BATTLE_REWARDS.draw.honor, baseGlory: BATTLE_REWARDS.draw.glory, sizeScale: scaleA, victoryTier: "draw" },
    defender: { honor: BATTLE_REWARDS.draw.honor, glory: BATTLE_REWARDS.draw.glory, baseHonor: BATTLE_REWARDS.draw.honor, baseGlory: BATTLE_REWARDS.draw.glory, sizeScale: scaleD, victoryTier: "draw" },
  };
}

/** [M-01 opción A] Recompensas de honor y gloria según resultado (interfaz base). */
export function battleRewards(outcome: BattleOutcome, crushing: boolean): { attacker: { honor: number; glory: number }; defender: { honor: number; glory: number } } {
  const win = crushing ? BATTLE_REWARDS.crushingVictory : BATTLE_REWARDS.victory;
  if (outcome === "victoria") return { attacker: { ...win }, defender: { ...BATTLE_REWARDS.defeat } };
  if (outcome === "derrota") return { attacker: { ...BATTLE_REWARDS.defeat }, defender: { ...win } };
  return { attacker: { ...BATTLE_REWARDS.draw }, defender: { ...BATTLE_REWARDS.draw } };
}

/** Decaimiento diario de la gloria (1 punto por día real/año de juego, mínimo 0). */
export function calculateGloryDecay(currentGlory: number, elapsedDays: number): { nextGlory: number; decayed: number } {
  const current = Number.isFinite(currentGlory) ? Math.max(0, currentGlory) : 0;
  const days = Number.isFinite(elapsedDays) ? Math.max(0, elapsedDays) : 0;
  const decayed = Math.min(current, Math.floor(days * BATTLE_REWARDS.GLORY_DECAY_PER_DAY));
  return { nextGlory: current - decayed, decayed };
}

/** Efecto concreto de la gloria: +1 punto de moral militar por cada 10 de gloria (máximo +10). */
export function calculateGloryMoraleBonus(glory: number): number {
  const value = Number.isFinite(glory) ? Math.max(0, glory) : 0;
  return Math.min(BATTLE_REWARDS.GLORY_MORALE_MAX, Math.floor(value / BATTLE_REWARDS.GLORY_MORALE_PER_POINTS));
}

/**
 * Evaluación determinista del resultado de la batalla (P47, P52):
 * - Victoria aplastante: exige que el enemigo pierda MÁS del 75 % (> 0,75; exactamente 0,75 no basta).
 * - Empate: diferencia de bajas relativas <= 5 puntos porcentuales (0,05) sin retirada por pánico.
 */
export function evaluateBattleOutcome(
  lossA: number,
  lossD: number,
  attackerRetreated: boolean,
  defenderRetreated: boolean
): {
  outcome: BattleOutcome;
  crushingVictory: boolean;
  loserLoss: number;
  reason: string;
} {
  let outcome: BattleOutcome;
  let reason: string;

  if (attackerRetreated && !defenderRetreated) {
    outcome = "derrota";
    reason = "El atacante se retiró del combate por pérdidas excesivas o moral insuficiente.";
  } else if (defenderRetreated && !attackerRetreated) {
    outcome = "victoria";
    reason = "El defensor se retiró del combate por pérdidas excesivas o moral insuficiente.";
  } else if (Math.abs(lossA - lossD) <= COMBAT.DRAW_TOLERANCE) {
    outcome = "empate";
    reason = "Diferencia de bajas relativas inferior al 5 % sin retirada de ninguno de los bandos: combate equilibrado (empate).";
  } else if (lossD > lossA) {
    outcome = "victoria";
    reason = `Victoria táctica del atacante: el defensor sufrió mayores pérdidas relativas (${(lossD * 100).toFixed(1)} % frente a ${(lossA * 100).toFixed(1)} %).`;
  } else {
    outcome = "derrota";
    reason = `Victoria táctica del defensor: el atacante sufrió mayores pérdidas relativas (${(lossA * 100).toFixed(1)} % frente a ${(lossD * 100).toFixed(1)} %).`;
  }

  const loserLoss = outcome === "victoria" ? lossD : outcome === "derrota" ? lossA : 0;
  // [MAESTRA P47] Victoria aplastante exige que el perdedor pierda MÁS del 75 %.
  const crushingVictory = outcome !== "empate" && loserLoss > COMBAT.CRUSHING_VICTORY_LOSS_RATIO;

  return { outcome, crushingVictory, loserLoss, reason };
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

  const evalResult = evaluateBattleOutcome(lossA, lossD, attackerRetreated, defenderRetreated);
  const outcome = evalResult.outcome;
  const crushingVictory = evalResult.crushingVictory;
  const loserLoss = evalResult.loserLoss;
  const winnerKingdomId = outcome === "victoria" ? attacker.kingdomId : outcome === "derrota" ? defender.kingdomId : null;
  const loserKingdomId = outcome === "victoria" ? defender.kingdomId : outcome === "derrota" ? attacker.kingdomId : null;
  const rewards = battleRewards(outcome, crushingVictory);

  const woundedA = splitWounded(casualtiesA, attacker.woundedRateBonus ?? 0);
  const woundedD = splitWounded(casualtiesD, defender.woundedRateBonus ?? 0);

  const explanation: string[] = [];
  const stronger = lastFactorsA.offensivePower >= lastFactorsD.defensivePower ? "atacante" : "defensor";
  explanation.push(`Potencia ofensiva del atacante ${lastFactorsA.offensivePower.toFixed(1)} frente a defensa ${lastFactorsD.defensivePower.toFixed(1)}: ventaja del ${stronger} en la última ronda.`);
  if (Math.abs(lastFactorsA.training - lastFactorsD.training) > 1e-9) explanation.push(`Entrenamiento: atacante ×${lastFactorsA.training.toFixed(2)} frente a defensor ×${lastFactorsD.training.toFixed(2)}.`);
  if (lastFactorsA.weapons !== lastFactorsD.weapons || lastFactorsA.armor !== lastFactorsD.armor) explanation.push(`Equipo: armas ${lastFactorsA.weapons}/${lastFactorsD.weapons}, armaduras ${lastFactorsA.armor}/${lastFactorsD.armor}.`);
  if (STRATEGIES[attacker.strategy].beats === defender.strategy) explanation.push(`La estrategia ${STRATEGIES[attacker.strategy].label} del atacante contrarrestó la ${STRATEGIES[defender.strategy].label} del defensor.`);
  if (STRATEGIES[defender.strategy].beats === attacker.strategy) explanation.push(`La estrategia ${STRATEGIES[defender.strategy].label} del defensor contrarrestó la ${STRATEGIES[attacker.strategy].label} del atacante.`);
  {
    const ta = tacticalFormationOf(attacker);
    const td = tacticalFormationOf(defender);
    if (TACTICAL_FORMATIONS[ta].beats === td) explanation.push(`La formación ${TACTICAL_FORMATIONS[ta].label} del atacante desbarató la ${TACTICAL_FORMATIONS[td].label} del defensor.`);
    if (TACTICAL_FORMATIONS[td].beats === ta) explanation.push(`La formación ${TACTICAL_FORMATIONS[td].label} del defensor desbarató la ${TACTICAL_FORMATIONS[ta].label} del atacante.`);
  }
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

/** Desgaste de equipamiento según intensidad del combate y porcentaje de bajas (0 a 100 %). */
export function calculateEquipmentWear(lossRatio: number): number {
  const ratio = Number.isFinite(lossRatio) ? Math.max(0, Math.min(1, lossRatio)) : 0;
  return Math.round(ratio * 10_000) / 100;
}

/**
 * [MAESTRA P45 y Sección B] Gestión y recuperación de heridos en hospital militar:
 * - Capacidad hospitalaria = nivelHospital × 100 camas.
 * - Los heridos dentro de capacidad se tratan con la tasa completa del hospital (15 %-50 % según nivel + medicina + tecnología, tope 60 %).
 * - Los heridos fuera de capacidad (exceso) reciben triaje/atención de campaña a tasa reducida (5 % anual), sin pérdidas arbitrarias ni recuperación duplicada.
 */
export function calculateHospitalRecovery(input: {
  hospitalLevel: number;
  totalWounded: number;
  technologyBonus?: number;
  medicsBonus?: number;
  elapsedDays: number;
  civilizationBonus?: number;
}): {
  hospitalCapacity: number;
  hospitalizedWounded: number;
  overflowWounded: number;
  baseRecoveryRatio: number;
  effectiveRecoveryRatio: number;
  recoveredCount: number;
  remainingWounded: number;
} {
  const hospitalLevel = Number.isInteger(input.hospitalLevel) && input.hospitalLevel > 0 ? input.hospitalLevel : 0;
  const totalWounded = Number.isInteger(input.totalWounded) && input.totalWounded > 0 ? input.totalWounded : 0;
  const elapsedDays = Number.isFinite(input.elapsedDays) && input.elapsedDays > 0 ? input.elapsedDays : 0;

  const hospitalCapacity = hospitalLevel * HOSPITAL.CAPACITY_PER_LEVEL;
  const hospitalizedWounded = Math.min(totalWounded, hospitalCapacity);
  const overflowWounded = Math.max(0, totalWounded - hospitalCapacity);

  const techBonus = input.technologyBonus ?? 0;
  const medicsBonus = input.medicsBonus ?? 0;
  const civBonus = input.civilizationBonus ?? 0;
  const totalBonus = Math.max(0, techBonus + medicsBonus + civBonus);

  const baseRecoveryRatio = woundedRecoveryRatio(
    hospitalLevel,
    totalBonus,
    HOSPITAL_RECOVERY_PER_YEAR,
    HOSPITAL_RECOVERY_CAP
  );

  let effectiveRecoveryRatio = 0;
  if (totalWounded > 0) {
    if (hospitalLevel === 0) {
      effectiveRecoveryRatio = HOSPITAL.FIELD_RECOVERY_RATE;
    } else if (totalWounded <= hospitalCapacity) {
      effectiveRecoveryRatio = baseRecoveryRatio;
    } else {
      effectiveRecoveryRatio =
        (hospitalizedWounded * baseRecoveryRatio + overflowWounded * HOSPITAL.FIELD_RECOVERY_RATE) / totalWounded;
    }
  }

  const progress = totalWounded * effectiveRecoveryRatio * elapsedDays;
  const recoveredCount = Math.min(totalWounded, Math.floor(progress));
  const remainingWounded = totalWounded - recoveredCount;

  return {
    hospitalCapacity,
    hospitalizedWounded,
    overflowWounded,
    baseRecoveryRatio,
    effectiveRecoveryRatio,
    recoveredCount,
    remainingWounded,
  };
}

/** Aplica la fracción de formación elegida (P37) a un inventario activo. */
export function applyFormation(composition: Composition, formation: Partial<Record<UnitType, number>> | undefined | null): Composition {
  const result = emptyComposition();
  for (const type of UNIT_TYPES) {
    if (type === "espia") {
      result[type] = 0;
      continue;
    }
    let raw = formation?.[type];
    if (raw === undefined && !UNITS[type].isLivingTroop) {
      raw = formation?.asedio;
    }
    const fraction = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
    result[type] = Math.round(Math.max(0, composition[type] ?? 0) * fraction);
  }
  return result;
}
