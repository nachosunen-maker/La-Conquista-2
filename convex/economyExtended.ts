/**
 * LA CONQUISTA — ECONOMÍA AMPLIADA (Bloque D, D-46 a D-51; ronda 2: M-02, M-04, M-06, M-07)
 * Lógica pura y determinista que envuelve a simulateEconomicProgress (alimentos)
 * y añade: producción de madera, piedra, hierro y oro por trabajador con
 * capacidad de edificios (D-46/D-47), impuestos (P27, D-49), crecimiento de
 * población limitado por viviendas (P12/P16, D-50), inanición por fases (D-48),
 * felicidad y moral (P33, D-49), políticas de descanso (P15, M-04), efectos de
 * profesiones (P13, M-07), tope de almacén (M-06), gloria (M-01) y mercenarios (M-02).
 *
 * Principio: el mismo intervalo procesado una vez o en varias reconexiones
 * produce el mismo resultado; las tasas se evalúan con el estado inicial del
 * intervalo y se integran analíticamente.
 */
import {
  simulateEconomicProgress,
  SECONDS_PER_GAME_YEAR,
  type KingdomResources,
  type KingdomState,
  type WorkersDistribution,
} from "./economyCalculations";
import {
  BATTLE_REWARDS,
  JOB_TO_RESOURCE,
  MERCENARIES,
  MORALE,
  POPULATION,
  PRODUCTION_PER_WORKER_PER_DAY,
  PROFESSION_BUILDING_CAPACITY,
  PROFESSION_EFFECTS,
  RESOURCE_PRODUCTION_MULTIPLIERS,
  REST_POLICIES,
  STARVATION,
  STARVATION_JOB_REDUCTION_PRIORITY,
  STORAGE,
  TAXES,
  WELLBEING,
  TECH_EFFECT_CAPS,
  type ProductiveJob,
  type RestPolicy,
} from "./balanceConfig";
import type { TechnologyModifiers } from "./technologyRules";
import { getCivilizationPassive } from "./civilizationRules";

export interface MoraleEffect {
  amount: number;
  expiresAt: number;
}

export interface ExtendedEconomyInput {
  kingdomState: KingdomState;
  now: number;
  /** Capacidad de trabajadores por oficio (edificios completados). null = sin edificios conocidos. */
  jobCapacities: Record<ProductiveJob, number> | null;
  residentialCapacity: number | null;
  technologyModifiers: TechnologyModifiers;
  /** Bonificaciones multiplicativas por terreno de territorios propios (0,1 = +10 %). */
  terrainBonuses?: Partial<Record<ProductiveJob, number>>;
  taxRate: number;
  happiness: number;
  moraleEffects?: ReadonlyArray<MoraleEffect>;
  /** Segundos reales de déficit acumulados antes del intervalo. */
  starvationSeconds: number;
  buildingLevels: Readonly<Record<string, number>>;
  /** Personas militares activas (tropa viva + operadores) para la deserción de la fase 3. */
  militaryPersonnel: number;
  /** [M-04] Política de descanso vigente. */
  restPolicy?: RestPolicy;
  /** [M-01] Gloria acumulada antes del intervalo. */
  glory?: number;
  /** [M-02] Mercenarios activos (no generan natalidad; cobran salario diario). */
  mercenaryCount?: number;
  /** [Bloque 10, P6] Identificador de civilización oficial para aplicar bonificaciones culturales. */
  civilization?: string;
  /** [Misiones] Multiplicador de las bonificaciones temporales de producción vigentes (1 = ninguna). */
  bonusProductionMultiplier?: number;
  /** [DECISIÓN 23-10-2026] Fracción residual de nacimientos previa (0 <= birthFraction < 1). */
  birthFraction?: number;
  /** [DECISIÓN 23-10-2026] Fracción residual de muertes por inanición previa (0 <= deathFraction < 1). */
  deathFraction?: number;
  /** [DECISIÓN 23-10-2026] Fracción residual de deserción militar previa (0 <= desertionFraction < 1). */
  desertionFraction?: number;
}

export interface ProfessionEffects {
  woundedRecoveryBonus: number; // puntos porcentuales (0,05 = +5 pp)
  happinessPerDay: number;      // religión + entretenimiento
  foodConsumptionMultiplier: number; // panadería
  constructionDurationMultiplier: number; // construcción
  effectiveWorkers: Record<string, number>;
}

export interface ExtendedEconomyResult {
  elapsedSeconds: number;
  elapsedDays: number;
  updatedResources: KingdomResources;
  dailyProduction: KingdomResources;
  dailyFoodConsumption: number;
  dailyFoodNetSurplus: number;
  effectiveWorkers: Record<ProductiveJob, number>;
  productivityMultiplier: number;
  taxesCollected: number;
  dailyTaxIncome: number;
  secondsToExhaustion: number | null;
  storageCapacity: number;
  wastedByStorage: KingdomResources;
  starvation: {
    secondsBefore: number;
    secondsAfter: number;
    secondsThisInterval: number;
    phaseBefore: 0 | 1 | 2 | 3;
    phaseAfter: 0 | 1 | 2 | 3;
  };
  population: {
    totalBefore: number;
    totalAfter: number;
    availableAfter: number;
    births: number;
    deaths: number;
    growthCappedByHousing: boolean;
    residentialCapacity: number | null;
    birthFraction: number;
    deathFraction: number;
    desertionFraction: number;
    updatedWorkers: KingdomState["workers"];
    updatedJobCounts?: Record<string, number>;
    jobDeductions: Record<string, number>;
  };
  happiness: { before: number; after: number; dailyDelta: number };
  morale: number;
  militaryDesertion: number;
  professions: ProfessionEffects;
  restPolicy: RestPolicy;
  restFatigueDelta: number;
  glory: { before: number; after: number; moraleBonus: number };
  mercenaries: { count: number; salaryDue: number; salaryPaid: number; unpaid: boolean };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** [COMPLEMENTO D-48] Fase de inanición según segundos de déficit acumulados. */
export function starvationPhase(seconds: number): 0 | 1 | 2 | 3 {
  if (!(seconds > 0)) return 0;
  if (seconds < STARVATION.PHASE_2_AFTER_SECONDS) return 1;
  if (seconds < STARVATION.PHASE_3_AFTER_SECONDS) return 2;
  return 3;
}

/** [COMPLEMENTO D-49] Penalización de productividad por impuestos: lineal entre 30 % y 60 %, tope −15 %. */
export function taxProductivityPenalty(taxRate: number, taxToleranceReduction: number = 0): number {
  const rate = clamp(taxRate, TAXES.MIN_RATE, TAXES.MAX_RATE);
  if (rate <= TAXES.MID_BAND_MAX) return 0;
  const span = TAXES.HIGH_BAND_MAX - TAXES.MID_BAND_MAX;
  const base = TAXES.HIGH_BAND_MAX_PRODUCTIVITY_PENALTY * clamp((rate - TAXES.MID_BAND_MAX) / span, 0, 1);
  return base * (1 - clamp(taxToleranceReduction, 0, 1));
}

/** [COMPLEMENTO D-49] Penalización diaria de felicidad por impuestos: −0,1 por punto porcentual por encima del 10 %. */
export function taxHappinessPenaltyPerDay(taxRate: number, taxToleranceReduction: number = 0): number {
  const rate = clamp(taxRate, TAXES.MIN_RATE, TAXES.MAX_RATE);
  if (rate <= TAXES.LOW_BAND_MAX) return 0;
  const pointsAboveLow = (rate - TAXES.LOW_BAND_MAX) * 100;
  const base = TAXES.MID_BAND_HAPPINESS_PER_POINT * pointsAboveLow;
  return base * (1 - clamp(taxToleranceReduction, 0, 1));
}

/** [COMPLEMENTO D-49] Penalización de moral militar por impuestos extremos (61–100 %), lineal hasta el máximo. */
export function taxMoralePenalty(taxRate: number, taxToleranceReduction: number = 0): number {
  const rate = clamp(taxRate, TAXES.MIN_RATE, TAXES.MAX_RATE);
  if (rate <= TAXES.HIGH_BAND_MAX) return 0;
  const span = TAXES.MAX_RATE - TAXES.HIGH_BAND_MAX;
  const base = TAXES.EXTREME_BAND_MAX_MORALE_PENALTY * clamp((rate - TAXES.HIGH_BAND_MAX) / span, 0, 1);
  return base * (1 - clamp(taxToleranceReduction, 0, 1));
}

export function productivityMultiplier(taxRate: number, phase: 0 | 1 | 2 | 3, restPolicy: RestPolicy = "normal", taxToleranceReduction: number = 0): number {
  const starvationPenalty = phase >= 2 ? STARVATION.CIVIL_PRODUCTIVITY_PENALTY : 0;
  const rest = REST_POLICIES[restPolicy]?.productionMultiplier ?? 1;
  return (1 - taxProductivityPenalty(taxRate, taxToleranceReduction)) * (1 - starvationPenalty) * rest;
}

/** [M-01 opción A] +1 punto de moral por cada 10 de gloria, máximo +10. */
export function gloryMoraleBonus(glory: number): number {
  const value = Number.isFinite(glory) && glory > 0 ? glory : 0;
  return Math.min(BATTLE_REWARDS.GLORY_MORALE_MAX, Math.floor(value / BATTLE_REWARDS.GLORY_MORALE_PER_POINTS));
}

/** [COMPLEMENTO D-49] moral = clamp(50 + 0,25×(felicidad−50) + bonus alimentación + efectos de batalla + gloria − fiscal − inanición). */
export function computeMorale(input: {
  happiness: number;
  foodTier: string;
  taxRate: number;
  starvationPhase: 0 | 1 | 2 | 3;
  moraleEffects?: ReadonlyArray<MoraleEffect>;
  now: number;
  glory?: number;
  taxToleranceReduction?: number;
}): number {
  const foodBonus = (MORALE.FOOD_TIER_BONUS as Record<string, number>)[input.foodTier] ?? 0;
  const battleEffects = (input.moraleEffects ?? [])
    .filter((effect) => Number.isFinite(effect.amount) && effect.expiresAt > input.now)
    .reduce((sum, effect) => sum + effect.amount, 0);
  const starvationPenalty = input.starvationPhase >= 2 ? STARVATION.MORALE_PENALTY_POINTS : 0;
  const morale = MORALE.BASE
    + MORALE.HAPPINESS_COEFFICIENT * (input.happiness - 50)
    + foodBonus
    + battleEffects
    + gloryMoraleBonus(input.glory ?? 0)
    - taxMoralePenalty(input.taxRate, input.taxToleranceReduction ?? 0)
    - starvationPenalty;
  return clamp(Math.round(morale * 100) / 100, WELLBEING.MIN, WELLBEING.MAX);
}

/** [MAESTRA P12 + COMPLEMENTO D-50 + DECISIÓN 23-10-2026] P_objetivo con acumulador fraccionario continuo, limitado por capacidad residencial. */
export function computePopulationGrowth(input: {
  total: number;
  elapsedDays: number;
  residentialCapacity: number | null;
  birthFraction?: number;
}): { births: number; cappedByHousing: boolean; nextBirthFraction: number } {
  const initialFraction = Number.isFinite(input.birthFraction) && input.birthFraction! >= 0
    ? input.birthFraction!
    : 0;
  if (!Number.isInteger(input.total) || input.total <= 0 || !(input.elapsedDays > 0)) {
    return { births: 0, cappedByHousing: false, nextBirthFraction: initialFraction };
  }
  const currentVirtual = input.total + initialFraction;
  const targetVirtual = currentVirtual * (1 + POPULATION.ANNUAL_GROWTH_RATE) ** input.elapsedDays;
  const capacity = input.residentialCapacity;

  if (capacity !== null && input.total >= capacity) {
    return { births: 0, cappedByHousing: true, nextBirthFraction: 0 };
  }

  let effectiveTarget = targetVirtual;
  let cappedByHousing = false;
  if (capacity !== null && targetVirtual >= capacity) {
    effectiveTarget = capacity;
    cappedByHousing = true;
  }

  const totalGrown = effectiveTarget - input.total;
  if (totalGrown <= 0) {
    return { births: 0, cappedByHousing, nextBirthFraction: 0 };
  }

  let births = Math.floor(totalGrown + 1e-9);
  if (capacity !== null) {
    births = Math.min(births, Math.max(0, capacity - input.total));
  }

  let nextBirthFraction = Math.max(0, totalGrown - births);
  nextBirthFraction = Math.round(nextBirthFraction * 1e9) / 1e9;
  if (nextBirthFraction >= 1) {
    births += Math.floor(nextBirthFraction);
    nextBirthFraction = nextBirthFraction % 1;
  }
  if (capacity !== null && input.total + births >= capacity) {
    nextBirthFraction = 0;
  }

  return { births, cappedByHousing, nextBirthFraction };
}

/** [M-06 opción A] Tope de almacén por recurso: base + nivel de Mercado, multiplicado por tecnología. */
export function storageCapacity(marketLevel: number, technologyMultiplier: number = 1): number {
  const level = Number.isInteger(marketLevel) && marketLevel > 0 ? marketLevel : 0;
  const multiplier = Number.isFinite(technologyMultiplier) && technologyMultiplier > 0 ? technologyMultiplier : 1;
  return Math.floor((STORAGE.BASE_CAPACITY + STORAGE.CAPACITY_PER_MARKET_LEVEL * level) * multiplier);
}

/**
 * [M-07 opción A] Efectos de las profesiones de P13. Cada efecto escala por bloques de trabajadores
 * efectivos (limitados por la capacidad del edificio correspondiente) con un tope.
 */
export function computeProfessionEffects(
  jobCounts: Readonly<Record<string, number>> | undefined,
  buildingLevels: Readonly<Record<string, number>>,
  buildingCapacityPerLevel: Readonly<Record<string, number>>
): ProfessionEffects {
  const effectiveWorkers: Record<string, number> = {};
  const value = (job: keyof typeof PROFESSION_EFFECTS): number => {
    const rule = PROFESSION_EFFECTS[job];
    const assigned = Math.max(0, jobCounts?.[job] ?? 0);
    const capacity = rule.building ? (buildingLevels[rule.building] ?? 0) * (buildingCapacityPerLevel[rule.building] ?? 0) : Number.POSITIVE_INFINITY;
    const effective = Math.min(assigned, capacity);
    effectiveWorkers[job] = Number.isFinite(effective) ? effective : assigned;
    const steps = Math.floor(effective / rule.workersPerStep);
    const raw = steps * rule.perStep;
    return rule.max >= 0 ? Math.min(rule.max, raw) : Math.max(rule.max, raw);
  };
  return {
    woundedRecoveryBonus: value("medicine"),
    happinessPerDay: value("religion") + value("entertainment"),
    foodConsumptionMultiplier: 1 + value("bakery"),
    constructionDurationMultiplier: 1 + value("construction"),
    effectiveWorkers,
  };
}

function daysInPhase3(secondsBefore: number, secondsAfter: number): number {
  const threshold = STARVATION.PHASE_3_AFTER_SECONDS;
  const before = Math.max(0, secondsBefore - threshold);
  const after = Math.max(0, secondsAfter - threshold);
  return Math.max(0, after - before) / SECONDS_PER_GAME_YEAR;
}

/** Re-exportación de PROFESSION_BUILDING_CAPACITY (definida en balanceConfig.ts) por compatibilidad. */
export { PROFESSION_BUILDING_CAPACITY };

export function simulateExtendedEconomy(input: ExtendedEconomyInput): ExtendedEconomyResult {
  const state = input.kingdomState;
  const elapsedSeconds = Math.max(0, input.now - state.lastUpdated) / 1000;
  const elapsedDays = elapsedSeconds / SECONDS_PER_GAME_YEAR;
  const taxRate = Number.isFinite(input.taxRate) ? clamp(input.taxRate, TAXES.MIN_RATE, TAXES.MAX_RATE) : TAXES.INITIAL_RATE;
  const restPolicy: RestPolicy = input.restPolicy && REST_POLICIES[input.restPolicy] ? input.restPolicy : "normal";
  const rest = REST_POLICIES[restPolicy];
  const starvationBefore = Number.isFinite(input.starvationSeconds) && input.starvationSeconds > 0 ? input.starvationSeconds : 0;
  const phaseBefore = starvationPhase(starvationBefore);
  const bonusProduction = Number.isFinite(input.bonusProductionMultiplier) && (input.bonusProductionMultiplier as number) > 0 ? (input.bonusProductionMultiplier as number) : 1;
  const taxTolerance = input.technologyModifiers.taxToleranceReduction ?? 0;
  const productivity = productivityMultiplier(taxRate, phaseBefore, restPolicy, taxTolerance) * bonusProduction;
  const terrain = input.terrainBonuses ?? {};
  const civPassive = getCivilizationPassive(input.civilization);
  const professions = computeProfessionEffects(state.jobCounts, input.buildingLevels, PROFESSION_BUILDING_CAPACITY);
  const mercenaryCount = Number.isInteger(input.mercenaryCount) && (input.mercenaryCount as number) > 0 ? (input.mercenaryCount as number) : 0;

  // 1. Alimentos: motor aprobado con multiplicador agrícola y consumo (panadería × tecnologías de consumo).
  const civAgriBonus = civPassive.production.agriculture ?? 0;
  const betaAgriMultiplier = RESOURCE_PRODUCTION_MULTIPLIERS.agriculture ?? 1.0;
  const agricultureMultiplier = betaAgriMultiplier * input.technologyModifiers.agricultureProduction * (1 + (terrain.agriculture ?? 0)) * (1 + civAgriBonus) * productivity;
  const foodTechConsumptionMultiplier = 1 - Math.min(TECH_EFFECT_CAPS.foodConsumption, Math.max(0, input.technologyModifiers.foodConsumptionReduction ?? 0));
  const combinedFoodConsumptionMultiplier = professions.foodConsumptionMultiplier * foodTechConsumptionMultiplier;
  const foodSim = simulateEconomicProgress(state, input.now, agricultureMultiplier, combinedFoodConsumptionMultiplier);

  // 2. Resto de recursos (D-46/D-47): tasa × multiplicador beta × min(asignados, capacidad) × modificadores.
  const effectiveWorkers: Record<ProductiveJob, number> = {
    agriculture: foodSim.effectiveAgricultureWorkers,
    wood: 0,
    stone: 0,
    iron: 0,
    gold: 0,
  };
  const dailyProduction: KingdomResources = { gold: 0, wood: 0, stone: 0, iron: 0, food: foodSim.dailyFoodProduction };
  const goldTechMultiplier = 1 + Math.min(TECH_EFFECT_CAPS.goldProduction, Math.max(0, input.technologyModifiers.goldProductionBonus ?? 0));
  for (const job of ["wood", "stone", "iron", "gold"] as const) {
    const assigned = state.workers[job];
    const capacity = input.jobCapacities ? input.jobCapacities[job] : 0;
    const effective = Math.max(0, Math.min(assigned, capacity));
    effectiveWorkers[job] = effective;
    
    let resourceSpecificBonus = 0;
    if (job === "wood") resourceSpecificBonus = Math.min(TECH_EFFECT_CAPS.woodProduction, Math.max(0, input.technologyModifiers.woodProductionBonus ?? 0));
    if (job === "stone") resourceSpecificBonus = Math.min(TECH_EFFECT_CAPS.stoneProduction, Math.max(0, input.technologyModifiers.stoneProductionBonus ?? 0));
    if (job === "iron") resourceSpecificBonus = Math.min(TECH_EFFECT_CAPS.ironProduction, Math.max(0, input.technologyModifiers.ironProductionBonus ?? 0));

    const technologyMultiplier = job === "gold"
      ? goldTechMultiplier
      : input.technologyModifiers.miningProduction * (1 + resourceSpecificBonus);
      
    const civJobBonus = civPassive.production[job] ?? 0;
    const betaJobMultiplier = RESOURCE_PRODUCTION_MULTIPLIERS[job] ?? 1.0;
    const rate = PRODUCTION_PER_WORKER_PER_DAY[job] * betaJobMultiplier * technologyMultiplier * (1 + (terrain[job] ?? 0)) * (1 + civJobBonus) * productivity;
    dailyProduction[JOB_TO_RESOURCE[job]] = effective * rate;
  }

  // 3. Impuestos (P27, D-49): [DERIVADO R-02] base imponible = unidades producidas de alimentos, madera, piedra y hierro.
  // goldProduction tecnología aumenta el oro generado por impuestos y minería.
  const taxableDailyBase = dailyProduction.food + dailyProduction.wood + dailyProduction.stone + dailyProduction.iron;
  const dailyTaxIncome = taxableDailyBase * taxRate * goldTechMultiplier;
  const taxesCollected = dailyTaxIncome * elapsedDays;

  // 3b. [DECISIÓN 21-10-2026] Sin salarios diarios para mercenarios: se pagan íntegros al contratar.
  // salaryDue, salaryPaid y unpaid se mantienen en 0 por compatibilidad de contrato con la interfaz y pruebas.
  const salaryDue = 0;
  const salaryPaid = 0;
  const unpaid = false;
  const totalGoldAfterIncome = state.resources.gold + dailyProduction.gold * elapsedDays + taxesCollected;

  // 3c. [M-06] Tope de almacén (con bonificación de civilización si procede).
  const storageTechMultiplier = input.technologyModifiers.storageCapacity * (civPassive.storageCapacityMultiplier ?? 1.0);
  const capacity = storageCapacity(input.buildingLevels.mercado ?? 0, storageTechMultiplier);
  const rawResources: KingdomResources = {
    gold: totalGoldAfterIncome,
    wood: state.resources.wood + dailyProduction.wood * elapsedDays,
    stone: state.resources.stone + dailyProduction.stone * elapsedDays,
    iron: state.resources.iron + dailyProduction.iron * elapsedDays,
    food: foodSim.updatedResources.food,
  };
  const wastedByStorage: KingdomResources = { gold: 0, wood: 0, stone: 0, iron: 0, food: 0 };
  const updatedResources = { ...rawResources };
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    // Solo se descarta el excedente generado en el intervalo; reservas previas por encima del tope no se destruyen.
    const limit = Math.max(capacity, state.resources[resource]);
    if (updatedResources[resource] > limit) {
      wastedByStorage[resource] = updatedResources[resource] - limit;
      updatedResources[resource] = limit;
    }
  }

  // 4. Inanición (D-48): se exige al menos 1 día real de consumo para considerarse recuperado [DECISIÓN 23-10-2026]
  const secondsThisInterval = foodSim.starvationSeconds;
  const oneDayConsumption = foodSim.dailyFoodConsumption;
  const recovered = elapsedSeconds > 0 && secondsThisInterval === 0 && foodSim.updatedResources.food >= oneDayConsumption;
  const starvationAfter = recovered ? 0 : starvationBefore + secondsThisInterval;
  const phaseAfter = starvationPhase(starvationAfter);

  // 5. Población (D-50): crecimiento compuesto limitado por viviendas; fracciones acumuladas.
  const growthBase = Math.max(0, state.population - mercenaryCount);
  const effectiveResidentialCapacity = input.residentialCapacity === null
    ? null
    : Math.ceil(input.residentialCapacity * (civPassive.residentialCapacityMultiplier ?? 1.0));
  const growth = computePopulationGrowth({
    total: growthBase,
    elapsedDays,
    residentialCapacity: effectiveResidentialCapacity === null ? null : Math.max(0, effectiveResidentialCapacity - mercenaryCount),
    birthFraction: input.birthFraction,
  });
  const phase3Days = daysInPhase3(starvationBefore, starvationAfter);
  const civilPopulation = Math.max(0, state.population - state.regularSoldiers);

  // [DECISIÓN 23-10-2026] Fracciones de muertes civiles y deserciones militares
  const deathFractionBefore = Number.isFinite(input.deathFraction) && input.deathFraction! >= 0 ? input.deathFraction! : 0;
  const desertionFractionBefore = Number.isFinite(input.desertionFraction) && input.desertionFraction! >= 0 ? input.desertionFraction! : 0;

  let theoreticalDeaths = 0;
  let nextDeathFraction = recovered ? 0 : deathFractionBefore;
  if (phase3Days > 0 && civilPopulation > 0) {
    const rawDeaths = civilPopulation * STARVATION.DAILY_CIVIL_LOSS_RATE * phase3Days;
    const accumulatedDeaths = deathFractionBefore + rawDeaths;
    theoreticalDeaths = Math.floor(accumulatedDeaths + 1e-9);
    nextDeathFraction = Math.max(0, accumulatedDeaths - theoreticalDeaths);
    nextDeathFraction = Math.round(nextDeathFraction * 1e9) / 1e9;
  }

  let militaryDesertion = 0;
  let nextDesertionFraction = recovered ? 0 : desertionFractionBefore;
  if (phase3Days > 0 && input.militaryPersonnel > 0) {
    const rawDesertions = input.militaryPersonnel * STARVATION.DAILY_MILITARY_DESERTION_RATE * phase3Days;
    const accumulatedDesertions = desertionFractionBefore + rawDesertions;
    militaryDesertion = Math.min(input.militaryPersonnel, Math.floor(accumulatedDesertions + 1e-9));
    nextDesertionFraction = Math.max(0, accumulatedDesertions - militaryDesertion);
    nextDesertionFraction = Math.round(nextDesertionFraction * 1e9) / 1e9;
  }

  // [DECISIÓN 23-10-2026] Descontar muertes primero de disponibles y luego de puestos asignados según prioridad vital
  const maxPossibleCivilDeaths = Math.min(civilPopulation + growth.births, theoreticalDeaths);
  const availableWithBirths = Math.max(0, state.unassignedCivil + growth.births);
  const fromAvailable = Math.min(maxPossibleCivilDeaths, availableWithBirths);
  let excessDeaths = maxPossibleCivilDeaths - fromAvailable;
  const availableAfter = availableWithBirths - fromAvailable;

  const updatedWorkers: WorkersDistribution = { ...state.workers };
  const updatedJobCounts: Record<string, number> = { ...(state.jobCounts ?? {}) };
  const jobDeductions: Record<string, number> = {};

  if (excessDeaths > 0) {
    for (const job of STARVATION_JOB_REDUCTION_PRIORITY) {
      if (excessDeaths <= 0) break;
      const count = updatedJobCounts[job] ?? (job in updatedWorkers ? updatedWorkers[job as keyof WorkersDistribution] : 0);
      if (count > 0) {
        const toDeduct = Math.min(count, excessDeaths);
        if (job in updatedJobCounts) {
          updatedJobCounts[job] -= toDeduct;
        }
        if (job in updatedWorkers) {
          updatedWorkers[job as keyof WorkersDistribution] = Math.max(0, updatedWorkers[job as keyof WorkersDistribution] - toDeduct);
        } else {
          updatedWorkers.other = Math.max(0, updatedWorkers.other - toDeduct);
        }
        jobDeductions[job] = (jobDeductions[job] ?? 0) + toDeduct;
        excessDeaths -= toDeduct;
      }
    }
  }

  const actualWorkforceDeaths = (maxPossibleCivilDeaths - fromAvailable) - excessDeaths;
  const deaths = fromAvailable + actualWorkforceDeaths;
  const totalAfter = state.population + growth.births - deaths;

  // 6. Felicidad (D-49, R-03/R-04, M-04, M-07): contribuciones diarias limitadas a ±5 puntos por día.
  const happinessBefore = Number.isFinite(input.happiness) ? clamp(input.happiness, WELLBEING.MIN, WELLBEING.MAX) : WELLBEING.INITIAL_HAPPINESS;
  const overcrowded = effectiveResidentialCapacity !== null && state.population > effectiveResidentialCapacity;
  const equilibrium = WELLBEING.INITIAL_HAPPINESS + input.technologyModifiers.happinessBase + (civPassive.happinessBonus ?? 0);
  let dailyDelta = (WELLBEING.FOOD_TIER_HAPPINESS as Record<string, number>)[state.foodTier] ?? 0;
  dailyDelta += overcrowded ? WELLBEING.OVERCROWDING_PENALTY : 0;
  dailyDelta += (input.buildingLevels.iglesia ?? 0) > 0 ? WELLBEING.RELIGION_BONUS_WITH_CHURCH : 0;
  dailyDelta += (input.buildingLevels.circo ?? 0) > 0 ? WELLBEING.ENTERTAINMENT_BONUS_WITH_CIRCUS : 0;
  dailyDelta += professions.happinessPerDay;
  dailyDelta += rest.happinessPerDay;
  dailyDelta -= taxHappinessPenaltyPerDay(taxRate, taxTolerance);
  dailyDelta -= phaseAfter >= 1 && secondsThisInterval > 0 ? STARVATION.HAPPINESS_PENALTY_PER_DAY : 0;
  // [DERIVADO R-03] Las tecnologías de felicidad elevan el nivel de equilibrio: recuperan 1 punto/día hasta alcanzarlo.
  if (dailyDelta === 0 && happinessBefore < equilibrium && input.technologyModifiers.happinessBase > 0) dailyDelta += 1;
  const maxDelta = WELLBEING.MAX_HAPPINESS_DELTA_PER_DAY * elapsedDays;
  const appliedDelta = clamp(dailyDelta * elapsedDays, -maxDelta, maxDelta);
  const happinessAfter = clamp(Math.round((happinessBefore + appliedDelta) * 100) / 100, WELLBEING.MIN, WELLBEING.MAX);

  // 7. Gloria (M-01): decae 1 punto por día real y nunca baja de 0.
  const gloryBefore = Number.isFinite(input.glory) && (input.glory as number) > 0 ? (input.glory as number) : 0;
  const gloryAfter = Math.max(0, Math.round((gloryBefore - BATTLE_REWARDS.GLORY_DECAY_PER_DAY * elapsedDays) * 100) / 100);

  // 8. Moral militar (P33, D-49, M-01)
  const morale = computeMorale({
    happiness: happinessAfter,
    foodTier: state.foodTier,
    taxRate,
    starvationPhase: phaseAfter,
    moraleEffects: input.moraleEffects,
    now: input.now,
    glory: gloryAfter,
    taxToleranceReduction: taxTolerance,
  });

  return {
    elapsedSeconds,
    elapsedDays,
    updatedResources,
    dailyProduction,
    dailyFoodConsumption: foodSim.dailyFoodConsumption,
    dailyFoodNetSurplus: foodSim.dailyFoodNetSurplus,
    effectiveWorkers,
    productivityMultiplier: productivity,
    taxesCollected,
    dailyTaxIncome,
    secondsToExhaustion: foodSim.secondsToExhaustion,
    storageCapacity: capacity,
    wastedByStorage,
    starvation: {
      secondsBefore: starvationBefore,
      secondsAfter: starvationAfter,
      secondsThisInterval,
      phaseBefore,
      phaseAfter,
    },
    population: {
      totalBefore: state.population,
      totalAfter,
      availableAfter,
      births: growth.births,
      deaths,
      growthCappedByHousing: growth.cappedByHousing,
      residentialCapacity: input.residentialCapacity,
      birthFraction: growth.nextBirthFraction,
      deathFraction: nextDeathFraction,
      desertionFraction: nextDesertionFraction,
      updatedWorkers,
      updatedJobCounts,
      jobDeductions,
    },
    happiness: { before: happinessBefore, after: happinessAfter, dailyDelta },
    morale,
    militaryDesertion,
    professions,
    restPolicy,
    restFatigueDelta: rest.fatiguePerDay * elapsedDays,
    glory: { before: gloryBefore, after: gloryAfter, moraleBonus: gloryMoraleBonus(gloryAfter) },
    mercenaries: { count: mercenaryCount, salaryDue, salaryPaid, unpaid },
  };
}

/** [M-05 opción B] Estación del año de juego en un instante (informativa). */
export function seasonAt(nowMs: number, order: readonly string[], msPerYear: number): { index: number; id: string; progress: number } {
  const positive = ((nowMs % msPerYear) + msPerYear) % msPerYear;
  const fraction = positive / msPerYear;
  const index = Math.min(order.length - 1, Math.floor(fraction * order.length));
  const progress = fraction * order.length - index;
  return { index, id: order[index], progress };
}
