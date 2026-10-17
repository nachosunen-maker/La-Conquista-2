/**
 * LA CONQUISTA — ECONOMÍA AMPLIADA (Bloque D, D-46 a D-51)
 * Lógica pura y determinista que envuelve a simulateEconomicProgress (alimentos)
 * y añade: producción de madera, piedra, hierro y oro por trabajador con
 * capacidad de edificios (D-46/D-47), impuestos (P27, D-49), crecimiento de
 * población limitado por viviendas (P12/P16, D-50), inanición por fases (D-48),
 * felicidad y moral (P33, D-49). Sin salario militar (D-51 opción B).
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
} from "./economyCalculations";
import {
  JOB_TO_RESOURCE,
  MORALE,
  POPULATION,
  PRODUCTION_PER_WORKER_PER_DAY,
  STARVATION,
  TAXES,
  WELLBEING,
  type ProductiveJob,
} from "./balanceConfig";
import type { TechnologyModifiers } from "./technologyRules";

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
  };
  happiness: { before: number; after: number; dailyDelta: number };
  morale: number;
  militaryDesertion: number;
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
export function taxProductivityPenalty(taxRate: number): number {
  const rate = clamp(taxRate, TAXES.MIN_RATE, TAXES.MAX_RATE);
  if (rate <= TAXES.MID_BAND_MAX) return 0;
  const span = TAXES.HIGH_BAND_MAX - TAXES.MID_BAND_MAX;
  return TAXES.HIGH_BAND_MAX_PRODUCTIVITY_PENALTY * clamp((rate - TAXES.MID_BAND_MAX) / span, 0, 1);
}

/** [COMPLEMENTO D-49] Penalización diaria de felicidad por impuestos: −0,1 por punto porcentual por encima del 10 %. */
export function taxHappinessPenaltyPerDay(taxRate: number): number {
  const rate = clamp(taxRate, TAXES.MIN_RATE, TAXES.MAX_RATE);
  if (rate <= TAXES.LOW_BAND_MAX) return 0;
  const pointsAboveLow = (rate - TAXES.LOW_BAND_MAX) * 100;
  return TAXES.MID_BAND_HAPPINESS_PER_POINT * pointsAboveLow;
}

/** [COMPLEMENTO D-49] Penalización de moral militar por impuestos extremos (61–100 %), lineal hasta el máximo. */
export function taxMoralePenalty(taxRate: number): number {
  const rate = clamp(taxRate, TAXES.MIN_RATE, TAXES.MAX_RATE);
  if (rate <= TAXES.HIGH_BAND_MAX) return 0;
  const span = TAXES.MAX_RATE - TAXES.HIGH_BAND_MAX;
  return TAXES.EXTREME_BAND_MAX_MORALE_PENALTY * clamp((rate - TAXES.HIGH_BAND_MAX) / span, 0, 1);
}

export function productivityMultiplier(taxRate: number, phase: 0 | 1 | 2 | 3): number {
  const starvationPenalty = phase >= 2 ? STARVATION.CIVIL_PRODUCTIVITY_PENALTY : 0;
  return (1 - taxProductivityPenalty(taxRate)) * (1 - starvationPenalty);
}

/** [COMPLEMENTO D-49] moral = clamp(50 + 0,25×(felicidad−50) + bonus alimentación + efectos de batalla − fiscal − inanición). */
export function computeMorale(input: {
  happiness: number;
  foodTier: string;
  taxRate: number;
  starvationPhase: 0 | 1 | 2 | 3;
  moraleEffects?: ReadonlyArray<MoraleEffect>;
  now: number;
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
    - taxMoralePenalty(input.taxRate)
    - starvationPenalty;
  return clamp(Math.round(morale * 100) / 100, WELLBEING.MIN, WELLBEING.MAX);
}

/** [MAESTRA P12 + COMPLEMENTO D-50] P_objetivo = floor(P × 1,30^t), limitado por capacidad residencial. */
export function computePopulationGrowth(input: {
  total: number;
  elapsedDays: number;
  residentialCapacity: number | null;
}): { births: number; cappedByHousing: boolean } {
  if (!Number.isInteger(input.total) || input.total <= 0 || !(input.elapsedDays > 0)) {
    return { births: 0, cappedByHousing: false };
  }
  const target = Math.floor(input.total * (1 + POPULATION.ANNUAL_GROWTH_RATE) ** input.elapsedDays);
  const capacity = input.residentialCapacity;
  if (capacity === null) return { births: Math.max(0, target - input.total), cappedByHousing: false };
  if (input.total >= capacity) return { births: 0, cappedByHousing: true };
  const allowed = Math.min(target, capacity);
  return { births: Math.max(0, allowed - input.total), cappedByHousing: target > capacity };
}

function daysInPhase3(secondsBefore: number, secondsAfter: number): number {
  const threshold = STARVATION.PHASE_3_AFTER_SECONDS;
  const before = Math.max(0, secondsBefore - threshold);
  const after = Math.max(0, secondsAfter - threshold);
  return Math.max(0, after - before) / SECONDS_PER_GAME_YEAR;
}

export function simulateExtendedEconomy(input: ExtendedEconomyInput): ExtendedEconomyResult {
  const state = input.kingdomState;
  const elapsedSeconds = Math.max(0, input.now - state.lastUpdated) / 1000;
  const elapsedDays = elapsedSeconds / SECONDS_PER_GAME_YEAR;
  const taxRate = Number.isFinite(input.taxRate) ? clamp(input.taxRate, TAXES.MIN_RATE, TAXES.MAX_RATE) : TAXES.INITIAL_RATE;
  const starvationBefore = Number.isFinite(input.starvationSeconds) && input.starvationSeconds > 0 ? input.starvationSeconds : 0;
  const phaseBefore = starvationPhase(starvationBefore);
  const productivity = productivityMultiplier(taxRate, phaseBefore);
  const terrain = input.terrainBonuses ?? {};

  // 1. Alimentos: motor aprobado con multiplicador agrícola (tecnología × terreno × productividad).
  const agricultureMultiplier = input.technologyModifiers.agricultureProduction * (1 + (terrain.agriculture ?? 0)) * productivity;
  const foodSim = simulateEconomicProgress(state, input.now, agricultureMultiplier);

  // 2. Resto de recursos (D-46/D-47): tasa × min(asignados, capacidad) × modificadores.
  const effectiveWorkers: Record<ProductiveJob, number> = {
    agriculture: foodSim.effectiveAgricultureWorkers,
    wood: 0,
    stone: 0,
    iron: 0,
    gold: 0,
  };
  const dailyProduction: KingdomResources = { gold: 0, wood: 0, stone: 0, iron: 0, food: foodSim.dailyFoodProduction };
  for (const job of ["wood", "stone", "iron", "gold"] as const) {
    const assigned = state.workers[job];
    const capacity = input.jobCapacities ? input.jobCapacities[job] : 0;
    const effective = Math.max(0, Math.min(assigned, capacity));
    effectiveWorkers[job] = effective;
    const technologyMultiplier = job === "gold" ? 1 : input.technologyModifiers.miningProduction;
    const rate = PRODUCTION_PER_WORKER_PER_DAY[job] * technologyMultiplier * (1 + (terrain[job] ?? 0)) * productivity;
    dailyProduction[JOB_TO_RESOURCE[job]] = effective * rate;
  }

  // 3. Impuestos (P27, D-49): [DERIVADO] base imponible = unidades producidas de alimentos, madera, piedra y hierro.
  const taxableDailyBase = dailyProduction.food + dailyProduction.wood + dailyProduction.stone + dailyProduction.iron;
  const dailyTaxIncome = taxableDailyBase * taxRate;
  const taxesCollected = dailyTaxIncome * elapsedDays;

  const updatedResources: KingdomResources = {
    gold: state.resources.gold + dailyProduction.gold * elapsedDays + taxesCollected,
    wood: state.resources.wood + dailyProduction.wood * elapsedDays,
    stone: state.resources.stone + dailyProduction.stone * elapsedDays,
    iron: state.resources.iron + dailyProduction.iron * elapsedDays,
    food: foodSim.updatedResources.food,
  };

  // 4. Inanición (D-48): el déficit se acumula mientras las reservas están a cero y se reinicia
  //    en cuanto las reservas vuelven a cubrir el consumo del intervalo completo.
  const secondsThisInterval = foodSim.starvationSeconds;
  const recovered = elapsedSeconds > 0 && secondsThisInterval === 0 && foodSim.updatedResources.food > 0;
  const starvationAfter = recovered ? 0 : starvationBefore + secondsThisInterval;
  const phaseAfter = starvationPhase(starvationAfter);

  // 5. Población (D-50): crecimiento compuesto limitado por viviendas; pérdidas en fase 3.
  const growth = computePopulationGrowth({ total: state.population, elapsedDays, residentialCapacity: input.residentialCapacity });
  const phase3Days = daysInPhase3(starvationBefore, starvationAfter);
  const civilPopulation = Math.max(0, state.population - state.regularSoldiers);
  // [DERIVADO] Las muertes civiles salen de la reserva libre (nacimientos incluidos) para no dejar
  // puestos de trabajo asignados por encima del censo; el resto de la pérdida se difiere al siguiente intervalo.
  const theoreticalDeaths = phase3Days > 0 ? Math.floor(civilPopulation * STARVATION.DAILY_CIVIL_LOSS_RATE * phase3Days) : 0;
  const deaths = Math.min(theoreticalDeaths, Math.max(0, state.unassignedCivil + growth.births));
  const militaryDesertion = phase3Days > 0
    ? Math.min(input.militaryPersonnel, Math.floor(input.militaryPersonnel * STARVATION.DAILY_MILITARY_DESERTION_RATE * phase3Days))
    : 0;
  const totalAfter = state.population + growth.births - deaths;
  const availableAfter = Math.max(0, state.unassignedCivil + growth.births - deaths);

  // 6. Felicidad (D-49): contribuciones diarias limitadas a ±5 puntos por día.
  const happinessBefore = Number.isFinite(input.happiness) ? clamp(input.happiness, WELLBEING.MIN, WELLBEING.MAX) : WELLBEING.INITIAL_HAPPINESS;
  const overcrowded = input.residentialCapacity !== null && state.population > input.residentialCapacity;
  const equilibrium = WELLBEING.INITIAL_HAPPINESS + input.technologyModifiers.happinessBase;
  let dailyDelta = (WELLBEING.FOOD_TIER_HAPPINESS as Record<string, number>)[state.foodTier] ?? 0;
  dailyDelta += overcrowded ? WELLBEING.OVERCROWDING_PENALTY : 0;
  dailyDelta += (input.buildingLevels.iglesia ?? 0) > 0 ? WELLBEING.RELIGION_BONUS_WITH_CHURCH : 0;
  dailyDelta += (input.buildingLevels.circo ?? 0) > 0 ? WELLBEING.ENTERTAINMENT_BONUS_WITH_CIRCUS : 0;
  dailyDelta -= taxHappinessPenaltyPerDay(taxRate);
  dailyDelta -= phaseAfter >= 1 && secondsThisInterval > 0 ? STARVATION.HAPPINESS_PENALTY_PER_DAY : 0;
  // [DERIVADO] Las tecnologías de felicidad elevan el nivel de equilibrio: recuperan 1 punto/día hasta alcanzarlo.
  if (dailyDelta === 0 && happinessBefore < equilibrium && input.technologyModifiers.happinessBase > 0) dailyDelta += 1;
  const maxDelta = WELLBEING.MAX_HAPPINESS_DELTA_PER_DAY * elapsedDays;
  const appliedDelta = clamp(dailyDelta * elapsedDays, -maxDelta, maxDelta);
  const happinessAfter = clamp(Math.round((happinessBefore + appliedDelta) * 100) / 100, WELLBEING.MIN, Math.min(WELLBEING.MAX, Math.max(happinessBefore, equilibrium, WELLBEING.MAX)));

  // 7. Moral militar (P33, D-49)
  const morale = computeMorale({
    happiness: happinessAfter,
    foodTier: state.foodTier,
    taxRate,
    starvationPhase: phaseAfter,
    moraleEffects: input.moraleEffects,
    now: input.now,
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
    },
    happiness: { before: happinessBefore, after: happinessAfter, dailyDelta },
    morale,
    militaryDesertion,
  };
}
