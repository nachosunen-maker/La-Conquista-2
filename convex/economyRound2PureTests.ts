import {
  computeMorale,
  computeProfessionEffects,
  gloryMoraleBonus,
  PROFESSION_BUILDING_CAPACITY,
  seasonAt,
  simulateExtendedEconomy,
  storageCapacity,
  type ExtendedEconomyInput,
} from "./economyExtended";
import { computeTechnologyModifiers } from "./technologyRules";
import { INITIAL_KINGDOM_CONFIG, SECONDS_PER_GAME_YEAR, type KingdomState } from "./economyCalculations";
import { MERCENARIES, RESOURCE_PRODUCTION_MULTIPLIERS, REST_POLICIES, SEASONS, STORAGE, TIME, PRODUCTION_PER_WORKER_PER_DAY } from "./balanceConfig";

export interface Round2TestResult {
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

export function runRound2EconomyTests(): Round2TestResult[] {
  const normal = simulateExtendedEconomy(baseInput());
  const intensive = simulateExtendedEconomy(baseInput({ restPolicy: "intensiva" }));
  const relaxed = simulateExtendedEconomy(baseInput({ restPolicy: "relajada" }));

  // Almacén: reservas de madera cerca del tope.
  const nearCap = simulateExtendedEconomy(baseInput({ kingdomState: baseState({ resources: { ...INITIAL_KINGDOM_CONFIG.resources, wood: 9_900 } }) }));
  const aboveCap = simulateExtendedEconomy(baseInput({ kingdomState: baseState({ resources: { ...INITIAL_KINGDOM_CONFIG.resources, wood: 12_000 } }) }));
  const withMarket = simulateExtendedEconomy(baseInput({ buildingLevels: { castillo: 3, mercado: 2 }, kingdomState: baseState({ resources: { ...INITIAL_KINGDOM_CONFIG.resources, wood: 12_000 } }) }));

  // Profesiones
  const effects = computeProfessionEffects(
    { medicine: 60, religion: 45, entertainment: 100, bakery: 60, construction: 250 },
    { hospitalMilitar: 1, iglesia: 2, circo: 1, panaderia: 1 },
    PROFESSION_BUILDING_CAPACITY
  );
  const bakeryState = baseState({ workers: { ...INITIAL_KINGDOM_CONFIG.workers, other: 60 }, unassignedCivil: 190, jobCounts: { bakery: 60 } });
  const bakery = simulateExtendedEconomy(baseInput({ kingdomState: bakeryState, buildingLevels: { castillo: 2, panaderia: 2 } }));
  const churchWorkers = simulateExtendedEconomy(baseInput({ kingdomState: baseState({ jobCounts: { religion: 40 } }), buildingLevels: { castillo: 2, iglesia: 1 } }));

  // Gloria
  const gloryDecay = simulateExtendedEconomy(baseInput({ glory: 25.5, now: 1_000_000 + DAY_MS * 2 }));
  const moraleWithGlory = computeMorale({ happiness: 70, foodTier: "normal", taxRate: 0.1, starvationPhase: 0, now: 0, glory: 45 });
  const moraleCapGlory = computeMorale({ happiness: 70, foodTier: "normal", taxRate: 0.1, starvationPhase: 0, now: 0, glory: 500 });

  // Mercenarios
  const mercs = simulateExtendedEconomy(baseInput({ mercenaryCount: 100, kingdomState: baseState({ population: 2100, regularSoldiers: 100 }), residentialCapacity: 10_000 }));
  const mercsBroke = simulateExtendedEconomy(baseInput({ mercenaryCount: 100, kingdomState: baseState({ population: 2100, regularSoldiers: 100, resources: { ...INITIAL_KINGDOM_CONFIG.resources, gold: 0 } }), taxRate: 0, jobCapacities: { agriculture: 1100, wood: 320, stone: 320, iron: 120, gold: 0 } }));
  const expectedBirthsNoMercs = Math.floor(2000 * 1.3) - 2000;

  // Estaciones
  const s0 = seasonAt(0, SEASONS.ORDER, TIME.MS_PER_GAME_YEAR);
  const s3 = seasonAt(TIME.MS_PER_GAME_YEAR * 0.8, SEASONS.ORDER, TIME.MS_PER_GAME_YEAR);
  const sWrap = seasonAt(TIME.MS_PER_GAME_YEAR * 5.3, SEASONS.ORDER, TIME.MS_PER_GAME_YEAR);

  return [
    {
      test: "Políticas de descanso (M-04): intensiva +15 % producción, −3 felicidad y +5 fatiga/día; relajada −10 %, +2 y −5",
      passed: Math.abs(intensive.productivityMultiplier - 1.15) < 1e-9 && intensive.happiness.after === 67 && intensive.restFatigueDelta === 5 &&
        Math.abs(relaxed.productivityMultiplier - 0.9) < 1e-9 && relaxed.happiness.after === 72 && relaxed.restFatigueDelta === -5 &&
        normal.restPolicy === "normal" && Math.abs(intensive.dailyProduction.wood - normal.dailyProduction.wood * 1.15) < 1e-9,
      details: `Intensiva: productividad ${intensive.productivityMultiplier}, felicidad ${intensive.happiness.after}, fatiga +${intensive.restFatigueDelta}; relajada: ${relaxed.productivityMultiplier}, ${relaxed.happiness.after}, ${relaxed.restFatigueDelta}`,
    },
    {
      test: "Almacén (M-06): tope 10.000 + 2.000 por nivel de Mercado; el excedente del intervalo se pierde y las reservas previas no se destruyen",
      passed: storageCapacity(0) === STORAGE.BASE_CAPACITY && storageCapacity(2) === STORAGE.BASE_CAPACITY + 2 * STORAGE.CAPACITY_PER_MARKET_LEVEL &&
        storageCapacity(0, 1.1) === 11_000 &&
        nearCap.updatedResources.wood === 10_000 && nearCap.wastedByStorage.wood > 0 &&
        aboveCap.updatedResources.wood === 12_000 && aboveCap.wastedByStorage.wood === 250 * PRODUCTION_PER_WORKER_PER_DAY.wood * RESOURCE_PRODUCTION_MULTIPLIERS.wood &&
        withMarket.updatedResources.wood === 12_750 && withMarket.wastedByStorage.wood === 0,
      details: `Capacidad 0/2 mercados: ${storageCapacity(0)}/${storageCapacity(2)}; 9.900 madera → ${nearCap.updatedResources.wood} (perdido ${nearCap.wastedByStorage.wood.toFixed(0)}); 12.000 sin mercado → ${aboveCap.updatedResources.wood}; con Mercado 2 → ${withMarket.updatedResources.wood}`,
    },
    {
      test: "Profesiones (M-07): medicina +1 pp/10 (tope 10), religión y circo +1/20 (tope 3), panadería −5 %/20 (tope −15 %), construcción −1 %/10 (tope −20 %); limitadas por capacidad",
      passed: Math.abs(effects.woundedRecoveryBonus - 0.05) < 1e-9 && effects.happinessPerDay === 4 &&
        Math.abs(effects.foodConsumptionMultiplier - 0.9) < 1e-9 && Math.abs(effects.constructionDurationMultiplier - 0.8) < 1e-9 &&
        effects.effectiveWorkers.medicine === 50 && effects.effectiveWorkers.entertainment === 40 &&
        Math.abs(bakery.dailyFoodConsumption - 2000 * 0.85) < 1e-9 && churchWorkers.happiness.after === 73,
      details: `Medicina +${effects.woundedRecoveryBonus} (60 asignados, 50 efectivos); felicidad/día +${effects.happinessPerDay}; consumo ×${effects.foodConsumptionMultiplier}; obras ×${effects.constructionDurationMultiplier}; panadería nivel 2 con 60 trabajadores (tope −15 %): consumo ${bakery.dailyFoodConsumption}; iglesia con 40 trabajadores: felicidad ${churchWorkers.happiness.after}`,
    },
    {
      test: "Gloria (M-01): decae 1 punto por día real sin bajar de 0 y aporta +1 moral por cada 10 (máximo +10)",
      passed: Math.abs(gloryDecay.glory.after - 23.5) < 1e-9 && gloryDecay.glory.moraleBonus === 2 && gloryMoraleBonus(0) === 0 &&
        moraleWithGlory === 59 && moraleCapGlory === 65,
      details: `Gloria 25,5 tras 2 días: ${gloryDecay.glory.after} (moral +${gloryDecay.glory.moraleBonus}); moral con 45 de gloria: ${moraleWithGlory}; con 500: ${moraleCapGlory}`,
    },
    {
      test: "Mercenarios (M-02 + decisión 21-10-2026): sin salario diario, sin natalidad propia y sin deserción por impago",
      passed: mercs.mercenaries.salaryDue === 0 && mercs.mercenaries.salaryPaid === 0 && !mercs.mercenaries.unpaid &&
        mercs.population.births === expectedBirthsNoMercs && !mercsBroke.mercenaries.unpaid &&
        Math.abs(mercs.updatedResources.gold - (normal.updatedResources.gold + (mercs.taxesCollected - normal.taxesCollected))) < 1e-6,
      details: `Salario debido ${mercs.mercenaries.salaryDue}; nacimientos sin contar mercenarios: ${mercs.population.births} (esperado ${expectedBirthsNoMercs}); sin oro no desertan: ${!mercsBroke.mercenaries.unpaid}`,
    },
    {
      test: "Estaciones informativas (M-05 B): cuatro estaciones de un cuarto de año de juego, cíclicas, sin efectos activos",
      passed: s0.id === "primavera" && s3.id === "invierno" && sWrap.id === "verano" && Math.abs(sWrap.progress - 0.2) < 1e-9 && SEASONS.ENABLED_EFFECTS === false &&
        Object.keys(REST_POLICIES).length === 3 && MERCENARIES.CONTRACT_DAYS === 7,
      details: `t=0: ${s0.id}; t=0,8 años: ${s3.id}; t=5,3 años: ${sWrap.id} (progreso ${sWrap.progress.toFixed(2)}); efectos activos: ${SEASONS.ENABLED_EFFECTS}`,
    },
  ];
}
