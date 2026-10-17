import {
  computeMorale,
  computePopulationGrowth,
  simulateExtendedEconomy,
  starvationPhase,
  taxHappinessPenaltyPerDay,
  taxMoralePenalty,
  taxProductivityPenalty,
  type ExtendedEconomyInput,
} from "./economyExtended";
import { computeTechnologyModifiers } from "./technologyRules";
import { INITIAL_KINGDOM_CONFIG, SECONDS_PER_GAME_YEAR, type KingdomState } from "./economyCalculations";
import { PRODUCTION_PER_WORKER_PER_DAY } from "./balanceConfig";

export interface ExtendedEconomyTestResult {
  test: string;
  passed: boolean;
  details: string;
}

const DAY_MS = SECONDS_PER_GAME_YEAR * 1000;

function baseState(overrides: Partial<KingdomState> = {}): KingdomState {
  return {
    userId: "u",
    name: "Reino de prueba",
    ...INITIAL_KINGDOM_CONFIG,
    foodProductionWorkerLimit: 1100,
    lastUpdated: 1_000_000,
    ...overrides,
  };
}

function baseInput(overrides: Partial<ExtendedEconomyInput> = {}): ExtendedEconomyInput {
  return {
    kingdomState: baseState(),
    now: 1_000_000 + DAY_MS,
    jobCapacities: { agriculture: 1100, wood: 320, stone: 320, iron: 120, gold: 50 },
    residentialCapacity: 2000,
    technologyModifiers: computeTechnologyModifiers([]),
    taxRate: 0.1,
    happiness: 70,
    starvationSeconds: 0,
    buildingLevels: { castillo: 1 },
    militaryPersonnel: 0,
    ...overrides,
  };
}

export function runExtendedEconomyTests(): ExtendedEconomyTestResult[] {
  const oneDay = simulateExtendedEconomy(baseInput());
  const expectedWood = 250 * PRODUCTION_PER_WORKER_PER_DAY.wood;
  const expectedStone = 250 * PRODUCTION_PER_WORKER_PER_DAY.stone;
  const expectedIron = 100 * PRODUCTION_PER_WORKER_PER_DAY.iron;
  const expectedGoldMining = 50 * PRODUCTION_PER_WORKER_PER_DAY.gold;
  const expectedTaxBase = 2200 + expectedWood + expectedStone + expectedIron;

  const capped = simulateExtendedEconomy(baseInput({ jobCapacities: { agriculture: 1100, wood: 100, stone: 0, iron: 120, gold: 50 } }));
  const withTechnology = simulateExtendedEconomy(baseInput({ technologyModifiers: computeTechnologyModifiers(["agri_1", "mining_1"]) }));
  const withTerrain = simulateExtendedEconomy(baseInput({ terrainBonuses: { wood: 0.15 } }));

  const highTax = simulateExtendedEconomy(baseInput({ taxRate: 0.6 }));
  const extremeTax = simulateExtendedEconomy(baseInput({ taxRate: 1 }));

  const growthFree = computePopulationGrowth({ total: 2000, elapsedDays: 1, residentialCapacity: 10_000 });
  const growthCapped = computePopulationGrowth({ total: 2000, elapsedDays: 1, residentialCapacity: 2100 });
  const growthFull = computePopulationGrowth({ total: 2000, elapsedDays: 1, residentialCapacity: 2000 });
  const growthHalfDay = computePopulationGrowth({ total: 2000, elapsedDays: 0.5, residentialCapacity: 10_000 });
  const twoHalves = computePopulationGrowth({ total: 2000 + growthHalfDay.births, elapsedDays: 0.5, residentialCapacity: 10_000 });
  const growthSim = simulateExtendedEconomy(baseInput({ residentialCapacity: 10_000 }));

  // Inanición: sin alimentos ni agricultores, 2.000 personas consumen 2.000/día.
  const starvingState = baseState({ resources: { ...INITIAL_KINGDOM_CONFIG.resources, food: 0 }, workers: { ...INITIAL_KINGDOM_CONFIG.workers, agriculture: 0 }, unassignedCivil: 1350 });
  const starveDay1 = simulateExtendedEconomy(baseInput({ kingdomState: starvingState, starvationSeconds: 0, militaryPersonnel: 0 }));
  const starvePhase2 = simulateExtendedEconomy(baseInput({ kingdomState: starvingState, starvationSeconds: SECONDS_PER_GAME_YEAR * 1.5 }));
  const starvePhase3 = simulateExtendedEconomy(baseInput({ kingdomState: starvingState, starvationSeconds: SECONDS_PER_GAME_YEAR * 3, militaryPersonnel: 1000 }));
  const recovered = simulateExtendedEconomy(baseInput({ starvationSeconds: SECONDS_PER_GAME_YEAR * 2 }));

  const morale = computeMorale({ happiness: 70, foodTier: "normal", taxRate: 0.1, starvationPhase: 0, now: 0 });
  const moraleVictory = computeMorale({ happiness: 70, foodTier: "abundante", taxRate: 0.1, starvationPhase: 0, moraleEffects: [{ amount: 5, expiresAt: 10 }, { amount: 5, expiresAt: 0 }], now: 5 });
  const moraleWorst = computeMorale({ happiness: 0, foodTier: "minima", taxRate: 1, starvationPhase: 3, now: 0 });

  const happinessOvercrowded = simulateExtendedEconomy(baseInput({ residentialCapacity: 1500 }));
  const happinessChurch = simulateExtendedEconomy(baseInput({ buildingLevels: { castillo: 1, iglesia: 1, circo: 1 } }));
  const happinessClamp = simulateExtendedEconomy(baseInput({ kingdomState: baseState({ foodTier: "minima" }), residentialCapacity: 1500, taxRate: 1, now: 1_000_000 + DAY_MS * 10 }));

  return [
    {
      test: "Producción por trabajador y día (D-46): madera 1, piedra 0,75, hierro 0,40, oro 0,20; alimentos intactos",
      passed: Math.abs(oneDay.dailyProduction.wood - expectedWood) < 1e-9 &&
        Math.abs(oneDay.dailyProduction.stone - expectedStone) < 1e-9 &&
        Math.abs(oneDay.dailyProduction.iron - expectedIron) < 1e-9 &&
        Math.abs(oneDay.dailyProduction.gold - expectedGoldMining) < 1e-9 &&
        Math.abs(oneDay.dailyProduction.food - 2200) < 1e-9 &&
        Math.abs(oneDay.updatedResources.wood - (1000 + expectedWood)) < 1e-6,
      details: `Madera ${oneDay.dailyProduction.wood}/día, piedra ${oneDay.dailyProduction.stone}, hierro ${oneDay.dailyProduction.iron}, oro ${oneDay.dailyProduction.gold}, alimentos ${oneDay.dailyProduction.food}`,
    },
    {
      test: "La capacidad de edificios limita a los trabajadores efectivos (D-47); tecnología y terreno multiplican",
      passed: capped.effectiveWorkers.wood === 100 && capped.effectiveWorkers.stone === 0 && capped.dailyProduction.stone === 0 &&
        Math.abs(withTechnology.dailyProduction.food - 2200 * 1.05) < 1e-9 &&
        Math.abs(withTechnology.dailyProduction.wood - expectedWood * 1.05) < 1e-9 &&
        Math.abs(withTechnology.dailyProduction.gold - expectedGoldMining) < 1e-9 &&
        Math.abs(withTerrain.dailyProduction.wood - expectedWood * 1.15) < 1e-9,
      details: `Madera limitada a ${capped.effectiveWorkers.wood}; piedra sin cantera ${capped.dailyProduction.stone}; con tecnología alimentos ${withTechnology.dailyProduction.food} y madera ${withTechnology.dailyProduction.wood}; bosque ${withTerrain.dailyProduction.wood}`,
    },
    {
      test: "Impuestos (P27, D-49): recaudación = producción no monetaria × tasa; tramos de penalización",
      passed: Math.abs(oneDay.dailyTaxIncome - expectedTaxBase * 0.1) < 1e-9 &&
        Math.abs(oneDay.taxesCollected - expectedTaxBase * 0.1) < 1e-6 &&
        Math.abs(oneDay.updatedResources.gold - (500 + expectedGoldMining + expectedTaxBase * 0.1)) < 1e-6 &&
        taxProductivityPenalty(0.3) === 0 && Math.abs(taxProductivityPenalty(0.45) - 0.075) < 1e-9 && Math.abs(taxProductivityPenalty(0.6) - 0.15) < 1e-9 &&
        Math.abs(highTax.productivityMultiplier - 0.85) < 1e-9 && Math.abs(extremeTax.productivityMultiplier - 0.85) < 1e-9 &&
        taxHappinessPenaltyPerDay(0.1) === 0 && Math.abs(taxHappinessPenaltyPerDay(0.3) - 2) < 1e-9 &&
        taxMoralePenalty(0.6) === 0 && Math.abs(taxMoralePenalty(1) - 10) < 1e-9,
      details: `Recaudación diaria ${oneDay.dailyTaxIncome.toFixed(2)} oro; productividad al 60 %: ${highTax.productivityMultiplier}; felicidad/día al 30 %: −${taxHappinessPenaltyPerDay(0.3)}; moral al 100 %: −${taxMoralePenalty(1)}`,
    },
    {
      test: "Crecimiento del 30 % anual (P12) limitado por viviendas (P16, D-50) y continuo en fracciones de año",
      passed: growthFree.births === 600 && !growthFree.cappedByHousing &&
        growthCapped.births === 100 && growthCapped.cappedByHousing &&
        growthFull.births === 0 && growthFull.cappedByHousing &&
        Math.abs((growthHalfDay.births + twoHalves.births) - 600) <= 1 &&
        growthSim.population.totalAfter === 2600 && growthSim.population.availableAfter === 250 + 600 &&
        oneDay.population.births === 0 && oneDay.population.growthCappedByHousing,
      details: `Sin tope: +${growthFree.births}; tope 2.100: +${growthCapped.births}; lleno: +${growthFull.births}; dos medios días: +${growthHalfDay.births + twoHalves.births}; simulación: ${growthSim.population.totalAfter}`,
    },
    {
      test: "Inanición por fases (D-48): acumulación persistida, −10 % productividad en fase 2, pérdidas y deserción en fase 3, reinicio al recuperarse",
      passed: starvationPhase(0) === 0 && starvationPhase(100) === 1 && starvationPhase(SECONDS_PER_GAME_YEAR) === 2 && starvationPhase(SECONDS_PER_GAME_YEAR * 3) === 3 &&
        Math.abs(starveDay1.starvation.secondsAfter - SECONDS_PER_GAME_YEAR) < 1e-6 && starveDay1.population.deaths === 0 &&
        Math.abs(starvePhase2.productivityMultiplier - 0.9) < 1e-9 && starvePhase2.population.deaths === 0 &&
        starvePhase3.population.deaths === Math.floor(2000 * 0.005) && starvePhase3.militaryDesertion === Math.floor(1000 * 0.01) &&
        starvePhase3.population.totalAfter === 2000 - 10 &&
        recovered.starvation.secondsAfter === 0 && recovered.starvation.phaseAfter === 0,
      details: `Día 1: ${starveDay1.starvation.secondsAfter}s acumulados; fase 2 productividad ${starvePhase2.productivityMultiplier}; fase 3 muertes ${starvePhase3.population.deaths} y deserción ${starvePhase3.militaryDesertion}; recuperado: ${recovered.starvation.secondsAfter}s`,
    },
    {
      test: "Moral militar (P33, D-49): 70 de felicidad y ración normal dan 55; efectos de batalla caducan; peor caso 7,5",
      passed: morale === 55 && moraleVictory === 63 && moraleWorst === 7.5 && oneDay.morale === 55,
      details: `Moral base ${morale}; con victoria vigente y ración abundante ${moraleVictory}; peor caso ${moraleWorst}`,
    },
    {
      test: "Felicidad (D-49): ración normal estable en 70; hacinamiento −2/día; iglesia y circo +2/día; variación limitada a ±5/día",
      passed: oneDay.happiness.after === 70 && happinessOvercrowded.happiness.after === 68 && happinessChurch.happiness.after === 72 &&
        happinessClamp.happiness.after === 20 && happinessClamp.happiness.dailyDelta < -5,
      details: `Normal ${oneDay.happiness.after}; hacinado ${happinessOvercrowded.happiness.after}; con iglesia y circo ${happinessChurch.happiness.after}; peor caso 10 días (delta/día ${happinessClamp.happiness.dailyDelta.toFixed(1)}) ${happinessClamp.happiness.after}`,
    },
  ];
}
