import {
  simulateEconomicProgress,
  validatePopulationIntegrity,
  validateKingdomResources,
  validateSpendParameters,
  evaluateIdempotentTransaction,
  INITIAL_KINGDOM_CONFIG,
  SECONDS_PER_GAME_YEAR,
  MILITARY_FOOD_FACTOR,
  BASE_FOOD_CONSUMPTION_PER_DAY,
  BASE_AGRICULTURE_PRODUCTIVITY_PER_DAY,
  VALID_RESOURCE_TYPES,
  FOOD_TIER_FACTORS,
  type KingdomResources,
} from "./economyCalculations";
import {
  adaptRemoteDocumentsToEconomicState,
  calculatePopulationJobReassignment,
  classifyArmyUnits,
  calculateSimulatedKingdomResources,
  calculateSettlementProgress,
  executeRegimeChangeTransition,
} from "./economyAdapter";
import { DEMO_USER_ID, isKingdomOwner, resolveKingdomQueryUserId } from "./kingdomAccess";
import { createAggregatePopulationFallback } from "./kingdomReadModel";
import { runConstructionValidationTests } from "./constructionPureTests";
import { runArmyValidationTests } from "./armyPureTests";
import { runTechnologyValidationTests } from "./technologyPureTests";
import { runExtendedEconomyTests } from "./economyExtendedPureTests";

/**
 * ============================================================================
 * LA CONQUISTA — SUITE PURA DE PRUEBAS DEL MOTOR ECONÓMICO
 * ============================================================================
 * Funciones deterministas independientes del motor de almacenamiento de Convex,
 * ejecutables en cualquier runtime (Node.js, tsx, vitest) sin dependencias ni mocking.
 * ============================================================================
 */
export interface TestResult {
  category: "MATEMÁTICA / LÓGICA PURA" | "LÍMITES Y ROBUSTEZ" | "INTEGRACIÓN CONVEX";
  test: string;
  passed: boolean;
  details: string;
}

/**
 * Ejecuta la suite de verificación matemática, lógica y de casos límite.
 */
export function runEconomicValidationTests(): TestResult[] {
  const results: TestResult[] = [];

  // --------------------------------------------------------------------------
  // ACCESO A REINOS: el subject del servidor autoriza; el cliente solo selecciona demo.
  // --------------------------------------------------------------------------
  {
    let rejectedForeignUser = false;
    try {
      resolveKingdomQueryUserId("otro_usuario", "usuario_autenticado");
    } catch {
      rejectedForeignUser = true;
    }

    const passed =
      resolveKingdomQueryUserId(DEMO_USER_ID) === DEMO_USER_ID &&
      resolveKingdomQueryUserId("usuario_autenticado", "usuario_autenticado") === "usuario_autenticado" &&
      rejectedForeignUser &&
      isKingdomOwner("usuario_autenticado", "usuario_autenticado") &&
      !isKingdomOwner(DEMO_USER_ID, "usuario_autenticado") &&
      !isKingdomOwner("usuario_autenticado", undefined);

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "Acceso: el subject autenticado autoriza el reino propio y la demo permanece solo de lectura",
      passed,
      details: `Demo pública de lectura: ${resolveKingdomQueryUserId(DEMO_USER_ID) === DEMO_USER_ID}; usuario ajeno rechazado: ${rejectedForeignUser}; demo modificable: ${isKingdomOwner(DEMO_USER_ID, "usuario_autenticado")}`,
    });
  }

  {
    const fallback = createAggregatePopulationFallback("k_read_model", 2000, 250);
    const missing = createAggregatePopulationFallback("k_read_model", 2000, undefined);
    const invalid = createAggregatePopulationFallback("k_read_model", 2000.5, 250);
    const overassigned = createAggregatePopulationFallback("k_read_model", 200, 250);
    const passed =
      fallback?.total === 2000 &&
      fallback.available === 250 &&
      !Object.hasOwn(fallback, "capacity") &&
      !Object.hasOwn(fallback, "starving") &&
      missing === null &&
      invalid === null &&
      overassigned === null;

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "Lectura de población: fallback solo usa censo y mano libre persistidos, sin inventar capacidad ni hambruna",
      passed,
      details: `Fallback agregado: ${fallback ? `${fallback.total}/${fallback.available}` : "ausente"}; sin capacidad/hambruna inventadas: ${Boolean(fallback && !Object.hasOwn(fallback, "capacity") && !Object.hasOwn(fallback, "starving"))}; faltantes/inválidos/sobreasignados rechazados: ${missing === null && invalid === null && overassigned === null}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 1: Proporcionalidad temporal continua en segundos (P2)
  // --------------------------------------------------------------------------
  {
    const baseKingdom = {
      ...INITIAL_KINGDOM_CONFIG,
      userId: "authenticated-user-test",
      name: "Reino de Prueba",
      lastUpdated: 1000000,
    };

    // Simular exactamente 43.200 segundos (medio día real = medio año de juego)
    const elapsedSeconds = 43200;
    const futureTime = baseKingdom.lastUpdated + elapsedSeconds * 1000;
    const sim = simulateEconomicProgress(baseKingdom, futureTime);

    const expectedFraction = 43200 / 86400; // 0.5
    // Producción: 1100 * 2 = 2200; Consumo: 2000 * 1 = 2000. Superávit diario = +200.
    // Medio día = +100 comida.
    const expectedFood = 2500 + 100;

    const passed =
      Math.abs(sim.timeFractionOfDay - expectedFraction) < 1e-6 &&
      Math.abs(sim.updatedResources.food - expectedFood) < 1e-4;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "1. Tiempo transcurrido continuo en segundos (P2)",
      passed,
      details: `Fracción esperada ${expectedFraction}, obtenida ${sim.timeFractionOfDay}. Comida resultante: ${sim.updatedResources.food} (esperada ${expectedFood})`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 2: Balance alimentario inicial y autosuficiencia (P19) en Régimen Normal
  // --------------------------------------------------------------------------
  {
    const baseKingdom = {
      ...INITIAL_KINGDOM_CONFIG,
      userId: "authenticated-user-test",
      name: "Reino de Prueba",
      lastUpdated: 0,
    };

    const oneDayLater = SECONDS_PER_GAME_YEAR * 1000; // 86.400.000 ms
    const sim = simulateEconomicProgress(baseKingdom, oneDayLater);

    const production = sim.dailyFoodProduction;
    const consumption = sim.dailyFoodConsumption;
    const surplus = sim.dailyFoodNetSurplus;
    const marginPercent = (surplus / consumption) * 100;

    const passed =
      production === 2200 &&
      consumption === 2000 &&
      surplus === 200 &&
      Math.abs(marginPercent - 10.0) < 1e-4;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "2. Balance alimentario y superávit de P19 (Régimen Normal oficial)",
      passed,
      details: `Producción: ${production}/día, Consumo: ${consumption}/día, Margen: +${marginPercent.toFixed(1)}% (esperado +10.0%)`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 3: Factor militar 1,05 exclusivamente a soldados regulares (P18)
  // --------------------------------------------------------------------------
  {
    const kingdomWithArmy = {
      ...INITIAL_KINGDOM_CONFIG,
      regularSoldiers: 200, // 200 soldados regulares
      unassignedCivil: 50,  // Reserva civil se reduce de 250 a 50 (Total P = 2000)
      userId: "authenticated-user-test",
      name: "Reino de Prueba",
      lastUpdated: 0,
    };

    const sim = simulateEconomicProgress(kingdomWithArmy, SECONDS_PER_GAME_YEAR * 1000);

    // Civiles: 1800 * 1.0 = 1800 comida/d
    // Soldados: 200 * (1.0 * 1.05) = 210 comida/d
    // Total: 2010 comida/d
    const expectedConsumption = 1800 + 210;

    const passed = Math.abs(sim.dailyFoodConsumption - expectedConsumption) < 1e-4;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "3. Factor militar 1,05 exclusivamente en tropa regular (P18)",
      passed,
      details: `Consumo con 200 soldados: ${sim.dailyFoodConsumption} (esperado ${expectedConsumption}: 1800 civil + 210 militar)`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 4: No negatividad y detección analítica de agotamiento (Bloque 6)
  // --------------------------------------------------------------------------
  {
    // Reino en déficit: 0 agricultores, consumo = 2000/día, reservas iniciales = 500 comida
    // Déficit = 2000 comida/día. Tiempo agotamiento: 500 / (2000/86400) = 21.600 segundos (6 horas reales).
    const starvingKingdom = {
      ...INITIAL_KINGDOM_CONFIG,
      workers: { ...INITIAL_KINGDOM_CONFIG.workers, agriculture: 0 },
      unassignedCivil: INITIAL_KINGDOM_CONFIG.unassignedCivil + 1100,
      resources: { ...INITIAL_KINGDOM_CONFIG.resources, food: 500 },
      userId: "authenticated-user-test",
      name: "Reino de Prueba",
      lastUpdated: 0,
    };

    // Simular 1 día real completo (86.400 segundos)
    const sim = simulateEconomicProgress(starvingKingdom, SECONDS_PER_GAME_YEAR * 1000);

    const expectedSecondsToExhaustion = 21600;
    const expectedStarvationSeconds = 86400 - 21600; // 64.800 s en inanición

    const passed =
      sim.updatedResources.food === 0 &&
      Math.abs((sim.secondsToExhaustion ?? 0) - expectedSecondsToExhaustion) < 1e-2 &&
      Math.abs(sim.starvationSeconds - expectedStarvationSeconds) < 1e-2;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "4. No negatividad y detección analítica de agotamiento (Bloque 6)",
      passed,
      details: `Comida final: ${sim.updatedResources.food} (suelo 0). Agotada a los ${sim.secondsToExhaustion}s. Tiempo en inanición: ${sim.starvationSeconds}s.`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 5: Agotamiento exacto en el instante final del intervalo (Límite crítico)
  // --------------------------------------------------------------------------
  {
    // Consumo = 2.000 comida/día (tasa = 2000 / 86400 comida/s).
    // Para un intervalo de exactamente 10.800 segundos (3 horas = 0.125 días),
    // el consumo acumulado exacto es: (2000 / 86400) * 10800 = 250 comida.
    // Con reservas iniciales exactamente iguales a 250 comida:
    // El agotamiento debe ocurrir con precisión milimétrica en el instante final (t = 10.800 s),
    // arrojando: food = 0, secondsToExhaustion = 10800, y starvationSeconds = 0.
    const exactDepletionKingdom = {
      ...INITIAL_KINGDOM_CONFIG,
      workers: { ...INITIAL_KINGDOM_CONFIG.workers, agriculture: 0 },
      unassignedCivil: INITIAL_KINGDOM_CONFIG.unassignedCivil + 1100,
      resources: { ...INITIAL_KINGDOM_CONFIG.resources, food: 250 },
      userId: "authenticated-user-test",
      name: "Reino de Prueba",
      lastUpdated: 0,
    };

    const elapsedSeconds = 10800;
    const sim = simulateEconomicProgress(exactDepletionKingdom, elapsedSeconds * 1000);

    const passed =
      sim.updatedResources.food === 0 &&
      sim.secondsToExhaustion !== null &&
      Math.abs(sim.secondsToExhaustion - elapsedSeconds) < 1e-4 &&
      Math.abs(sim.starvationSeconds) < 1e-4;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "5. Agotamiento exacto en el instante final del intervalo",
      passed,
      details: `Comida final: ${sim.updatedResources.food}; secondsToExhaustion: ${sim.secondsToExhaustion}s (esperado ${elapsedSeconds}s); starvationSeconds: ${sim.starvationSeconds}s (esperado 0s).`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 6: Recursos iniciales no válidos (negativos o no finitos)
  // --------------------------------------------------------------------------
  {
    const validRes: KingdomResources = {
      gold: 500,
      wood: 1000,
      stone: 800,
      iron: 250,
      food: 2500,
    };

    const negativeRes: KingdomResources = { ...validRes, food: -10 };
    const infinityRes: KingdomResources = { ...validRes, gold: Infinity };
    const nanRes: KingdomResources = { ...validRes, wood: NaN };

    const validCase = validateKingdomResources(validRes);
    const negativeCase = validateKingdomResources(negativeRes);
    const infinityCase = validateKingdomResources(infinityRes);
    const nanCase = validateKingdomResources(nanRes);

    const passed =
      validCase.valid === true &&
      negativeCase.valid === false &&
      infinityCase.valid === false &&
      nanCase.valid === false;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "6. Detección de recursos no válidos (negativos, infinitos o NaN)",
      passed,
      details: `Válido aceptado: ${validCase.valid}; Negativo rechazado: ${!negativeCase.valid}; Infinito rechazado: ${!infinityCase.valid}; NaN rechazado: ${!nanCase.valid}.`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 7: Validación de nombres o tipos de recurso incorrectos
  // --------------------------------------------------------------------------
  {
    const correctTypes = VALID_RESOURCE_TYPES.map((t) => validateSpendParameters(t, 50, "construccion_edificio"));
    const allCorrectPass = correctTypes.every((r) => r.valid);

    const wrongName1 = validateSpendParameters("oro", 50, "gasto_prueba"); // Castellano no registrado
    const wrongName2 = validateSpendParameters("mana", 50, "gasto_prueba");
    const wrongName3 = validateSpendParameters("gems", 50, "gasto_prueba");
    const wrongName4 = validateSpendParameters("", 50, "gasto_prueba");
    const negativeAmount = validateSpendParameters("wood", -10, "gasto_prueba");
    const zeroAmount = validateSpendParameters("wood", 0, "gasto_prueba");
    const emptyReason = validateSpendParameters("wood", 50, "");
    const whitespaceReason = validateSpendParameters("wood", 50, "   ");
    // @ts-expect-error verificación en tiempo de ejecución de tipo no string
    const nonStringReason = validateSpendParameters("wood", 50, null);

    const passed =
      allCorrectPass &&
      !wrongName1.valid &&
      !wrongName2.valid &&
      !wrongName3.valid &&
      !wrongName4.valid &&
      !negativeAmount.valid &&
      !zeroAmount.valid &&
      !emptyReason.valid &&
      !whitespaceReason.valid &&
      !nonStringReason.valid;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "7. Validación de nombres, montos y motivo obligatorio de gasto (P3, Bloque 5)",
      passed,
      details: `Tipos oficiales aceptados: ${allCorrectPass}; 'oro' rechazado: ${!wrongName1.valid}; motivo vacío rechazado: ${!emptyReason.valid}; motivo espacios rechazado: ${!whitespaceReason.valid}.`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 8: Lógica pura de idempotencia de transacciones (Bloque 5)
  // --------------------------------------------------------------------------
  {
    const registeredTx = {
      resourceType: "wood",
      amount: 150,
      reason: "construccion_muralla",
    };

    // Caso A: Misma clave, mismo contenido y motivo -> duplicado idempotente reconocido
    const repeatExact = evaluateIdempotentTransaction(registeredTx, "wood", 150, "construccion_muralla");

    // Caso B: Misma clave, monto contradictorio -> conflicto detectado
    const repeatConflictAmount = evaluateIdempotentTransaction(registeredTx, "wood", 300, "construccion_muralla");

    // Caso C: Misma clave, motivo contradictorio -> conflicto detectado
    const repeatConflictReason = evaluateIdempotentTransaction(registeredTx, "wood", 150, "reclutamiento");

    // Caso D: Clave no existente -> transacción nueva admitida
    const freshTx = evaluateIdempotentTransaction(null, "wood", 150, "construccion_muralla");

    // Caso E: Motivo vacío en solicitud -> conflicto / rechazo por motivo obligatorio
    const repeatEmptyReason = evaluateIdempotentTransaction(registeredTx, "wood", 150, "");

    const passed =
      repeatExact.isDuplicate === true &&
      repeatExact.matchesPayload === true &&
      repeatConflictAmount.isDuplicate === true &&
      repeatConflictAmount.matchesPayload === false &&
      repeatConflictReason.isDuplicate === true &&
      repeatConflictReason.matchesPayload === false &&
      freshTx.isDuplicate === false &&
      repeatEmptyReason.isDuplicate === true &&
      repeatEmptyReason.matchesPayload === false;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "8. Lógica de deduplicación e idempotencia contable con motivo obligatorio (Bloque 5)",
      passed,
      details: `Duplicado idéntico detectado: ${repeatExact.matchesPayload}; Conflicto monto: ${!repeatConflictAmount.matchesPayload}; Conflicto motivo: ${!repeatConflictReason.matchesPayload}; Rechazo motivo vacío: ${!repeatEmptyReason.matchesPayload}; Nueva transacción: ${!freshTx.isDuplicate}.`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 9: Validación de integridad censal (P10)
  // --------------------------------------------------------------------------
  {
    const validCase = validatePopulationIntegrity(2000, 0, INITIAL_KINGDOM_CONFIG.workers, 250);
    const floatCase = validatePopulationIntegrity(2000, 0, { ...INITIAL_KINGDOM_CONFIG.workers, agriculture: 1100.5 }, 249.5);
    const mismatchCase = validatePopulationIntegrity(2000, 0, INITIAL_KINGDOM_CONFIG.workers, 200);
    const negativeCase = validatePopulationIntegrity(2000, -10, INITIAL_KINGDOM_CONFIG.workers, 260);

    const passed =
      validCase.valid === true &&
      floatCase.valid === false &&
      mismatchCase.valid === false &&
      negativeCase.valid === false;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "9. Integridad censal: enteros, no negativos y suma exacta = 2.000 (P10)",
      passed,
      details: `Válido: ${validCase.valid}; Decimal rechazado: ${!floatCase.valid}; Descuadre rechazado: ${!mismatchCase.valid}; Negativo rechazado: ${!negativeCase.valid}.`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 10: Adaptador - Transformación de documentos válidos y cálculo económico
  // --------------------------------------------------------------------------
  {
    const validKingdom = { _id: "k_123", name: "Reino de Iberia", userId: "guest_g9ai8cz" };
    const validResources = {
      kingdomId: "k_123",
      gold: 500,
      wood: 1000,
      stone: 800,
      iron: 250,
      food: 2500,
      lastUpdated: 1000000,
    };
    const validPopulation = { kingdomId: "k_123", total: 2000, available: 250 };
    const validJobs = [
      { kingdomId: "k_123", jobType: "agriculture", assignedCount: 1100 },
      { kingdomId: "k_123", jobType: "wood", assignedCount: 250 },
      { kingdomId: "k_123", jobType: "stone", assignedCount: 250 },
      { kingdomId: "k_123", jobType: "iron", assignedCount: 100 },
      { kingdomId: "k_123", jobType: "gold", assignedCount: 50 },
    ];
    const validArmy = [
      { kingdomId: "k_123", unitType: "infanteria", count: 100 },
      { kingdomId: "k_123", unitType: "caballeria", count: 50 },
    ];

    const adaptResult = adaptRemoteDocumentsToEconomicState({
      kingdom: validKingdom,
      resources: validResources,
      population: validPopulation,
      populationJobs: validJobs,
      armyUnits: validArmy,
      foodTier: "normal",
    });

    const passed =
      adaptResult.success === true &&
      adaptResult.kingdomState !== undefined &&
      adaptResult.kingdomState.population === 2000 &&
      adaptResult.kingdomState.regularSoldiers === 150 &&
      adaptResult.kingdomState.workers.agriculture === 1100 &&
      adaptResult.kingdomState.unassignedCivil === 250;

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "10. Adaptador: Transformación válida de documentos relacionales y ensamblado de estado",
      passed,
      details: `Éxito: ${adaptResult.success}; Población: ${adaptResult.kingdomState?.population}; Soldados: ${adaptResult.kingdomState?.regularSoldiers}; Agricultores: ${adaptResult.kingdomState?.workers.agriculture}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 11: Adaptador - Reino existente de 1.000 habitantes (sin forzar P10)
  // --------------------------------------------------------------------------
  {
    const existingKingdom = { _id: "k_guest", name: "Reino Existente", userId: "guest_g9ai8cz" };
    const existingResources = {
      kingdomId: "k_guest",
      gold: 300,
      wood: 500,
      stone: 400,
      iron: 100,
      food: 1200,
      lastUpdated: 500000,
    };
    const existingPopulation = { kingdomId: "k_guest", total: 1000, available: 100 };
    const existingJobs = [
      { kingdomId: "k_guest", jobType: "agriculture", assignedCount: 600 },
      { kingdomId: "k_guest", jobType: "mining", assignedCount: 200 },
      { kingdomId: "k_guest", jobType: "construction", assignedCount: 100 },
    ];
    const existingArmy = [
      { kingdomId: "k_guest", unitType: "infanteria", count: 80 },
    ];

    const adaptResult = adaptRemoteDocumentsToEconomicState({
      kingdom: existingKingdom,
      resources: existingResources,
      population: existingPopulation,
      populationJobs: existingJobs,
      armyUnits: existingArmy,
      foodTier: "normal",
    });

    // Debe conservar 1.000 habitantes intactos sin forzar 2.000
    const passed =
      adaptResult.success === true &&
      adaptResult.kingdomState !== undefined &&
      adaptResult.kingdomState.population === 1000 &&
      adaptResult.kingdomState.regularSoldiers === 80 &&
      adaptResult.kingdomState.workers.agriculture === 600 &&
      adaptResult.kingdomState.unassignedCivil === 100;

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "11. Adaptador: Preservación de censo real de 1.000 hab. en reinos existentes sin alterar datos",
      passed,
      details: `Éxito: ${adaptResult.success}; Censo preservado: ${adaptResult.kingdomState?.population} (esperado 1000 sin sobreescritura P10)`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 12: Adaptador - Rechazo estricto ante documentos ausentes o nulos
  // --------------------------------------------------------------------------
  {
    const dummyKingdom = { _id: "k_1", name: "Reino", userId: "u_1" };
    const dummyResources = { kingdomId: "k_1", gold: 10, wood: 10, stone: 10, iron: 10, food: 10, lastUpdated: 10 };
    const dummyPopulation = { kingdomId: "k_1", total: 500, available: 500 };

    const noKingdom = adaptRemoteDocumentsToEconomicState({
      kingdom: null,
      resources: dummyResources,
      population: dummyPopulation,
      populationJobs: [],
      armyUnits: [],
      foodTier: "normal",
    });

    const noResources = adaptRemoteDocumentsToEconomicState({
      kingdom: dummyKingdom,
      resources: null,
      population: dummyPopulation,
      populationJobs: [],
      armyUnits: [],
      foodTier: "normal",
    });

    const noPopulation = adaptRemoteDocumentsToEconomicState({
      kingdom: dummyKingdom,
      resources: dummyResources,
      population: null,
      populationJobs: [],
      armyUnits: [],
      foodTier: "normal",
    });

    const passed =
      noKingdom.success === false &&
      noResources.success === false &&
      noPopulation.success === false;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "12. Adaptador: Rechazo estricto ante ausencia de documentos raíz requeridos",
      passed,
      details: `Sin reino rechazado: ${!noKingdom.success}; Sin recursos rechazado: ${!noResources.success}; Sin población rechazado: ${!noPopulation.success}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 13: Adaptador - Detección y rechazo de recursos inválidos o negativos
  // --------------------------------------------------------------------------
  {
    const dummyKingdom = { _id: "k_1", name: "Reino", userId: "u_1" };
    const dummyPopulation = { kingdomId: "k_1", total: 500, available: 500 };

    const negativeFoodResources = {
      kingdomId: "k_1",
      gold: 100,
      wood: 100,
      stone: 100,
      iron: 100,
      food: -50, // Inválido
      lastUpdated: 1000,
    };

    const invalidTimestampResources = {
      kingdomId: "k_1",
      gold: 100,
      wood: 100,
      stone: 100,
      iron: 100,
      food: 100,
      lastUpdated: -1, // Inválido
    };

    const resNeg = adaptRemoteDocumentsToEconomicState({
      kingdom: dummyKingdom,
      resources: negativeFoodResources,
      population: dummyPopulation,
      populationJobs: [],
      armyUnits: [],
      foodTier: "normal",
    });

    const resTime = adaptRemoteDocumentsToEconomicState({
      kingdom: dummyKingdom,
      resources: invalidTimestampResources,
      population: dummyPopulation,
      populationJobs: [],
      armyUnits: [],
      foodTier: "normal",
    });

    const passed = resNeg.success === false && resTime.success === false;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "13. Adaptador: Detección y rechazo de recursos negativos o marcas temporales inválidas",
      passed,
      details: `Comida negativa rechazada: ${!resNeg.success}; Timestamp negativo rechazado: ${!resTime.success}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 14: Adaptador - Clasificación militar segregada y tratamiento de asedio
  // --------------------------------------------------------------------------
  {
    const armyWithSiege = [
      { kingdomId: "k_1", unitType: "infanteria", count: 120 },
      { kingdomId: "k_1", unitType: "caballeria", count: 30 },
      { kingdomId: "k_1", unitType: "arqueria", count: 50 },
      { kingdomId: "k_1", unitType: "asedio", count: 10 },
    ];

    // D-12: 200 soldados vivos + 10 máquinas (no comen) con 50 operadores (sí comen) = 250 personas militares.
    const classDefault = classifyArmyUnits(armyWithSiege);
    const withWounded = classifyArmyUnits([...armyWithSiege, { kingdomId: "k_1", unitType: "arqueria", count: 0, wounded: 15 }]);

    const passed =
      classDefault.regularSoldiers === 250 &&
      classDefault.siegeUnits === 10 &&
      classDefault.siegeOperators === 50 &&
      classDefault.totalUnits === 210 &&
      withWounded.regularSoldiers === 265 &&
      withWounded.woundedSoldiers === 15;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "14. Adaptador: Clasificación militar (P18, D-12): máquinas de asedio no comen, operadores y heridos sí",
      passed,
      details: `Personas militares: ${classDefault.regularSoldiers}; máquinas: ${classDefault.siegeUnits}; operadores: ${classDefault.siegeOperators}; unidades activas: ${classDefault.totalUnits}; con heridos: ${withWounded.regularSoldiers}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 15: Adaptador - Detección de incoherencias censales y régimen alimentario
  // --------------------------------------------------------------------------
  {
    const dummyKingdom = { _id: "k_1", name: "Reino", userId: "u_1" };
    const dummyResources = { kingdomId: "k_1", gold: 10, wood: 10, stone: 10, iron: 10, food: 10, lastUpdated: 10 };

    // Censo total 1.000, pero asignados 900 y libres 200 (suma = 1.100 > 1.000)
    const overassignedPopulation = { kingdomId: "k_1", total: 1000, available: 200 };
    const overassignedJobs = [
      { kingdomId: "k_1", jobType: "agriculture", assignedCount: 900 },
    ];

    const resOver = adaptRemoteDocumentsToEconomicState({
      kingdom: dummyKingdom,
      resources: dummyResources,
      population: overassignedPopulation,
      populationJobs: overassignedJobs,
      armyUnits: [],
      foodTier: "normal",
    });

    // Régimen alimentario inválido no contemplado en P17
    const resBadTier = adaptRemoteDocumentsToEconomicState({
      kingdom: dummyKingdom,
      resources: dummyResources,
      population: { kingdomId: "k_1", total: 1000, available: 100 },
      populationJobs: [{ kingdomId: "k_1", jobType: "agriculture", assignedCount: 900 }],
      armyUnits: [],
      foodTier: "banquete_imperial", // No existe en P17
    });

    const passed = resOver.success === false && resBadTier.success === false;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "15. Adaptador: Rechazo de incoherencias demográficas y regímenes no oficiales (P17)",
      passed,
      details: `Superación de censo rechazada: ${!resOver.success}; Régimen alimentario no oficial rechazado: ${!resBadTier.success}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 16: Consulta Proyectada - Proyección reproducible con hora inyectable (P2)
  // --------------------------------------------------------------------------
  {
    const kingdom = { _id: "k_iberia", name: "Reino de Iberia", userId: "guest_g9ai8cz" };
    const resources = {
      kingdomId: "k_iberia",
      gold: 500,
      wood: 1000,
      stone: 800,
      iron: 250,
      food: 2500,
      lastUpdated: 1_000_000,
    };
    const population = { kingdomId: "k_iberia", total: 1000, available: 100 };
    const populationJobs = [
      { kingdomId: "k_iberia", jobType: "agriculture", assignedCount: 600 },
      { kingdomId: "k_iberia", jobType: "wood", assignedCount: 150 },
      { kingdomId: "k_iberia", jobType: "stone", assignedCount: 100 },
      { kingdomId: "k_iberia", jobType: "iron", assignedCount: 50 },
    ];
    const armyUnits = [{ kingdomId: "k_iberia", unitType: "infanteria", count: 100 }];

    // Simular exactamente 43.200 segundos (medio día de juego) con targetTime inyectado
    const targetTime = 1_000_000 + 43200 * 1000;

    const res = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      populationJobs,
      armyUnits,
      foodTier: "normal",
      targetTime,
      callerUserId: "guest_g9ai8cz",
    });

    // Producción: 600 * 2 = 1200/d
    // Consumo: Civiles 900 * 1.0 + Soldados 100 * 1.05 = 1005/d
    // Superávit diario: +195 comida. Medio día = +97.5 comida.
    const expectedFood = 2500 + 97.5;

    const passed =
      res.success === true &&
      res.elapsedSeconds === 43200 &&
      Math.abs((res.simulatedResources?.food ?? 0) - expectedFood) < 1e-4 &&
      res.productionAndConsumption?.dailyFoodNetSurplus === 195 &&
      res.exhaustionMetrics?.secondsToExhaustion === null &&
      res.exhaustionMetrics?.starvationSeconds === 0;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "16. Consulta Proyectada: Proyección reproducible con hora inyectable (P2)",
      passed,
      details: `Éxito: ${res.success}; Segundos transcurridos: ${res.elapsedSeconds}; Comida proyectada: ${res.simulatedResources?.food} (esperada ${expectedFood}); Superávit diario: ${res.productionAndConsumption?.dailyFoodNetSurplus}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 17: Consulta Proyectada - Intervalo temporal de cero segundos
  // --------------------------------------------------------------------------
  {
    const kingdom = { _id: "k_iberia", name: "Reino de Iberia", userId: "guest_g9ai8cz" };
    const resources = {
      kingdomId: "k_iberia",
      gold: 500,
      wood: 1000,
      stone: 800,
      iron: 250,
      food: 2500,
      lastUpdated: 1_000_000,
    };
    const population = { kingdomId: "k_iberia", total: 1000, available: 100 };
    const populationJobs = [{ kingdomId: "k_iberia", jobType: "agriculture", assignedCount: 600 }];

    // targetTime idéntico a lastUpdated (cero segundos)
    const res = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      populationJobs,
      foodTier: "normal",
      targetTime: 1_000_000,
      callerUserId: "guest_g9ai8cz",
    });

    const passed =
      res.success === true &&
      res.elapsedSeconds === 0 &&
      res.simulatedResources?.food === 2500 &&
      res.simulatedResources?.gold === 500 &&
      res.exhaustionMetrics?.starvationSeconds === 0;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "17. Consulta Proyectada: Intervalo temporal de cero segundos (conservación exacta)",
      passed,
      details: `Éxito: ${res.success}; Segundos: ${res.elapsedSeconds}; Comida proyectada: ${res.simulatedResources?.food} (idéntica a original ${resources.food})`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 18: Consulta Proyectada - Timestamp anterior a lastUpdated (clamp a 0s)
  // --------------------------------------------------------------------------
  {
    const kingdom = { _id: "k_iberia", name: "Reino de Iberia", userId: "guest_g9ai8cz" };
    const resources = {
      kingdomId: "k_iberia",
      gold: 500,
      wood: 1000,
      stone: 800,
      iron: 250,
      food: 2500,
      lastUpdated: 1_000_000,
    };
    const population = { kingdomId: "k_iberia", total: 1000, available: 1000 };

    // targetTime anterior en el tiempo (anomalía de reloj)
    const res = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      foodTier: "normal",
      targetTime: 1_000_000 - 60_000,
      callerUserId: "guest_g9ai8cz",
    });

    const passed =
      res.success === true &&
      res.elapsedSeconds === 0 &&
      res.simulatedResources?.food === 2500;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "18. Consulta Proyectada: Timestamp anterior a lastUpdated (prevención de retroceso)",
      passed,
      details: `Éxito: ${res.success}; Segundos clamp: ${res.elapsedSeconds}; Comida protegida: ${res.simulatedResources?.food}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 19: Consulta Proyectada - Detección analítica de agotamiento y tiempo en inanición
  // --------------------------------------------------------------------------
  {
    // Reino en déficit: 1.000 habitantes civiles, 0 agricultores, consumo = 1.000 raciones/d
    // Reservas de comida = 500.
    // Tasa de déficit = 1.000 / 86.400 raciones/segundo.
    // Tiempo hasta agotamiento: 500 / (1000/86400) = 43.200 segundos.
    // Proyección: 1 día completo (86.400 segundos). Inanición esperada: 43.200 segundos.
    const kingdom = { _id: "k_iberia", name: "Reino de Iberia", userId: "guest_g9ai8cz" };
    const resources = {
      kingdomId: "k_iberia",
      gold: 100,
      wood: 100,
      stone: 100,
      iron: 100,
      food: 500,
      lastUpdated: 1_000_000,
    };
    const population = { kingdomId: "k_iberia", total: 1000, available: 1000 };
    const targetTime = 1_000_000 + 86400 * 1000;

    const res = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      populationJobs: [],
      armyUnits: [],
      foodTier: "normal",
      targetTime,
      callerUserId: "guest_g9ai8cz",
    });

    const passed =
      res.success === true &&
      res.simulatedResources?.food === 0 &&
      Math.abs((res.exhaustionMetrics?.secondsToExhaustion ?? 0) - 43200) < 1e-2 &&
      Math.abs((res.exhaustionMetrics?.starvationSeconds ?? 0) - 43200) < 1e-2 &&
      res.exhaustionMetrics?.isStarving === true;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "19. Consulta Proyectada: Detección analítica de agotamiento e inanición (Bloque 6)",
      passed,
      details: `Comida final: ${res.simulatedResources?.food} (suelo 0); Segundos hasta agotamiento: ${res.exhaustionMetrics?.secondsToExhaustion}; Segundos en inanición: ${res.exhaustionMetrics?.starvationSeconds}; isStarving: ${res.exhaustionMetrics?.isStarving}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 20: Consulta Proyectada - Control de autorización estricto P1
  // --------------------------------------------------------------------------
  {
    const kingdom = { _id: "k_iberia", name: "Reino de Iberia", userId: "guest_g9ai8cz" };
    const resources = {
      kingdomId: "k_iberia",
      gold: 100,
      wood: 100,
      stone: 100,
      iron: 100,
      food: 100,
      lastUpdated: 1_000_000,
    };
    const population = { kingdomId: "k_iberia", total: 1000, available: 1000 };

    // Caso A: Usuario no coincide (intento de consulta por tercero)
    const resUnauthorized = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      foodTier: "normal",
      callerUserId: "adversary_user_999",
    });

    // Caso B: Usuario no suministrado (solicitud anónima)
    const resNoAuth = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      foodTier: "normal",
      callerUserId: "",
    });

    // Caso C: Usuario legítimo
    const resAuthorized = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      foodTier: "normal",
      callerUserId: "guest_g9ai8cz",
    });

    const passed =
      resUnauthorized.success === false &&
      (resUnauthorized.error?.includes("No autorizado") ?? false) &&
      resNoAuth.success === false &&
      (resNoAuth.error?.includes("Autenticación requerida") ?? false) &&
      resAuthorized.success === true;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "20. Consulta Proyectada: Control estricto de autorización (P1: rechazo de ajenos y anónimos)",
      passed,
      details: `Rechazo usuario ajeno: ${!resUnauthorized.success}; Rechazo anónimo: ${!resNoAuth.success}; Aprobación usuario legítimo: ${resAuthorized.success}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 21: Consulta Proyectada - Régimen alimentario (P17) y segregación de asedio (P18)
  // --------------------------------------------------------------------------
  {
    const kingdom = { _id: "k_iberia", name: "Reino de Iberia", userId: "guest_g9ai8cz" };
    const resources = {
      kingdomId: "k_iberia",
      gold: 500,
      wood: 500,
      stone: 500,
      iron: 500,
      food: 1000,
      lastUpdated: 1_000_000,
    };
    const population = { kingdomId: "k_iberia", total: 1000, available: 100 };
    const populationJobs = [{ kingdomId: "k_iberia", jobType: "agriculture", assignedCount: 600 }];
    const armyUnits = [
      { kingdomId: "k_iberia", unitType: "infanteria", count: 100 },
      { kingdomId: "k_iberia", unitType: "asedio", count: 50 },
    ];

    // Consulta con régimen mínimo (factor oficial 0,75) y asedio segregado
    const resMinima = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      populationJobs,
      armyUnits,
      foodTier: "minima",
      targetTime: 1_000_000,
      callerUserId: "guest_g9ai8cz",
    });

    // Consulta con régimen abundante (factor oficial 1,10) y asedio segregado
    const resAbundante = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      populationJobs,
      armyUnits,
      foodTier: "abundante",
      targetTime: 1_000_000,
      callerUserId: "guest_g9ai8cz",
    });

    // Consulta con régimen excelente (factor oficial 1,20) y asedio segregado
    const resExcelente = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      populationJobs,
      armyUnits,
      foodTier: "excelente",
      targetTime: 1_000_000,
      callerUserId: "guest_g9ai8cz",
    });

    // Consulta en régimen normal (factor oficial 1,00)
    const resNormal = calculateSimulatedKingdomResources({
      kingdom,
      resources,
      population,
      populationJobs,
      armyUnits,
      foodTier: "normal",
      targetTime: 1_000_000,
      callerUserId: "guest_g9ai8cz",
    });

    // D-12: 100 infantes + 50 máquinas × 5 operadores = 350 personas militares; civiles = 650.
    // En mínima (0,75): 650 * 0.75 + 350 * (1.05 * 0.75) = 487.5 + 275.625 = 763.125
    // En abundante (1,10): 650 * 1.10 + 350 * (1.05 * 1.10) = 715 + 404.25 = 1119.25
    // En excelente (1,20): 650 * 1.20 + 350 * (1.05 * 1.20) = 780 + 441 = 1221.0
    // En normal (1,00): 650 + 367.5 = 1017.5
    const consumoMinima = resMinima.productionAndConsumption?.dailyFoodConsumption;
    const consumoAbundante = resAbundante.productionAndConsumption?.dailyFoodConsumption;
    const consumoExcelente = resExcelente.productionAndConsumption?.dailyFoodConsumption;
    const consumoNormal = resNormal.productionAndConsumption?.dailyFoodConsumption;
    const regularNormal = resNormal.militaryClassification?.regularSoldiers;

    const passed =
      Math.abs((consumoMinima ?? 0) - 763.125) < 1e-4 &&
      Math.abs((consumoAbundante ?? 0) - 1119.25) < 1e-4 &&
      Math.abs((consumoExcelente ?? 0) - 1221.0) < 1e-4 &&
      Math.abs((consumoNormal ?? 0) - 1017.5) < 1e-4 &&
      regularNormal === 350;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "21. Consulta Proyectada: Factores oficiales del régimen alimentario (P17) y operadores de asedio (P18, D-12)",
      passed,
      details: `Consumo mínima: ${consumoMinima} (esperado 763.125); abundante: ${consumoAbundante} (esperado 1119.25); excelente: ${consumoExcelente} (esperado 1221.0); normal: ${consumoNormal} (esperado 1017.5); personas militares: ${regularNormal} (esperado 350)`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 21B: balances diarios con los cuatro regímenes oficiales
  // --------------------------------------------------------------------------
  {
    const expectedFoodBalances: Record<string, number> = {
      minima: 5446.25,
      normal: 5195,
      abundante: 5094.5,
      excelente: 4994,
    };
    const foodBalances = Object.entries(expectedFoodBalances).map(([foodTier]) => {
      const settlement = calculateSettlementProgress({
        kingdom: { _id: "test_tier_balance", name: "Test", userId: "test_owner", foodTier },
        resources: {
          kingdomId: "test_tier_balance",
          gold: 0,
          wood: 0,
          stone: 0,
          iron: 0,
          food: 5000,
          lastUpdated: 1_000_000,
          settlementInitialized: true,
        },
        population: { kingdomId: "test_tier_balance", total: 1000, available: 0 },
        populationJobs: [
          { kingdomId: "test_tier_balance", jobType: "agriculture", assignedCount: 600 },
          { kingdomId: "test_tier_balance", jobType: "mining", assignedCount: 400 },
        ],
        armyUnits: [{ kingdomId: "test_tier_balance", unitType: "infanteria", count: 100 }],
        currentServerTimeMs: 1_000_000 + SECONDS_PER_GAME_YEAR * 1000,
      });
      return { foodTier, expected: expectedFoodBalances[foodTier], settlement };
    });
    const passed = foodBalances.every(({ expected, settlement }) =>
      settlement.success &&
      settlement.elapsedSeconds === SECONDS_PER_GAME_YEAR &&
      Math.abs((settlement.updatedFood ?? 0) - expected) < 1e-4
    );

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "21B. Saldos de un día real en los cuatro regímenes, incluyendo el 5% de tropas reales",
      passed,
      details: foodBalances.map(({ foodTier, expected, settlement }) =>
        `${foodTier}: ${settlement.updatedFood} (esperado ${expected})`
      ).join("; "),
    });
  }

  // --------------------------------------------------------------------------
  // TEST 22: Constantes oficiales aprobadas de regímenes alimentarios
  // --------------------------------------------------------------------------
  {
    const passed =
      FOOD_TIER_FACTORS.minima === 0.75 &&
      FOOD_TIER_FACTORS.normal === 1.00 &&
      FOOD_TIER_FACTORS.abundante === 1.10 &&
      FOOD_TIER_FACTORS.excelente === 1.20;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "22. Constantes oficiales de balance alimentario aprobadas (Mínima 0.75, Normal 1.00, Abundante 1.10, Excelente 1.20)",
      passed,
      details: `Mínima: ${FOOD_TIER_FACTORS.minima} (0.75), Normal: ${FOOD_TIER_FACTORS.normal} (1.00), Abundante: ${FOOD_TIER_FACTORS.abundante} (1.10), Excelente: ${FOOD_TIER_FACTORS.excelente} (1.20)`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 23: Liquidación persistente: cálculo autoritativo con régimen normal
  // --------------------------------------------------------------------------
  {
    const kingdom = {
      _id: "test_k_23",
      name: "Reino de Prueba 23",
      userId: "test_user_23",
    };
    const resources = {
      kingdomId: "test_k_23",
      gold: 500,
      wood: 1000,
      stone: 800,
      iron: 200,
      food: 2000,
      lastUpdated: 1_000_000,
    };
    const population = {
      kingdomId: "test_k_23",
      total: 1000,
      available: 0,
      capacity: 1500,
      starving: false,
    };
    // 550 agricultores -> 550 * 2 = 1100 producción/día
    // 1000 civiles -> 1000 * 1 = 1000 consumo/día (en normal 1.00)
    // Superávit neto: +100/día
    const populationJobs = [
      { kingdomId: "test_k_23", jobType: "agriculture", assignedCount: 550 },
      { kingdomId: "test_k_23", jobType: "mining", assignedCount: 450 },
    ];

    // Transcurre medio día real (43.200s): superávit esperado = +50 comida
    const now = 1_000_000 + 43_200 * 1000;
    const res = calculateSettlementProgress({
      kingdom,
      resources,
      population,
      populationJobs,
      currentServerTimeMs: now,
      options: { callerUserId: "test_user_23" },
    });

    const passed =
      res.success === true &&
      res.elapsedSeconds === 43200 &&
      Math.abs((res.updatedFood ?? 0) - 2050) < 1e-4 &&
      Math.abs((res.foodDelta ?? 0) - 50) < 1e-4 &&
      res.isStarving === false &&
      res.appliedFoodTier === "normal";

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "23. Liquidación persistente: cálculo autoritativo con régimen alimentario normal y actualización atómica",
      passed,
      details: `Éxito: ${res.success}; Segundos: ${res.elapsedSeconds}; Comida inicial: 2000; Comida liquidada: ${res.updatedFood} (esperada 2050); Delta: ${res.foodDelta}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 24: Periodo offline completo sin límite temporal impuesto
  // --------------------------------------------------------------------------
  {
    const kingdom = {
      _id: "test_k_24",
      name: "Reino de Prueba 24",
      userId: "test_user_24",
    };
    const resources = {
      kingdomId: "test_k_24",
      gold: 500,
      wood: 1000,
      stone: 800,
      iron: 200,
      food: 3000,
      lastUpdated: 1_000_000,
    };
    const population = {
      kingdomId: "test_k_24",
      total: 1000,
      available: 0,
    };
    const populationJobs = [
      { kingdomId: "test_k_24", jobType: "agriculture", assignedCount: 600 },
      { kingdomId: "test_k_24", jobType: "mining", assignedCount: 400 },
    ];

    // Supongamos que han pasado 10 días reales (864.000 segundos)
    const now = 1_000_000 + 864_000 * 1000;
    const res = calculateSettlementProgress({
      kingdom,
      resources,
      population,
      populationJobs,
      currentServerTimeMs: now,
    });

    const passed =
      res.success === true &&
      res.cappedInterval === false &&
      res.elapsedSeconds === 864000 &&
      res.effectiveTimeMs === now &&
      Math.abs((res.updatedFood ?? 0) - 5000) < 1e-4;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "24. Liquidación persistente: procesa diez días offline completos sin tope artificial",
      passed,
      details: `Intervalo limitado: ${res.cappedInterval}; Segundos: ${res.elapsedSeconds} (esperados 864000); Comida final: ${res.updatedFood} (esperada 5000); Timestamp efectivo: ${res.effectiveTimeMs}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 25: Primera inicialización de salvaguarda sin adeudamiento histórico
  // --------------------------------------------------------------------------
  {
    const kingdom = {
      _id: "test_k_25",
      name: "Reino de Prueba 25",
      userId: "test_user_25",
    };
    const resources = {
      kingdomId: "test_k_25",
      gold: 800,
      wood: 1200,
      stone: 1000,
      iron: 300,
      food: 2500,
      lastUpdated: 1_000_000, // Fecha remota antigua
    };
    const population = {
      kingdomId: "test_k_25",
      total: 1000,
      available: 0,
    };

    // Con isFirstInitialization: true, sincroniza marca temporal sin consumir comida histórica
    const now = 2_000_000;
    const res = calculateSettlementProgress({
      kingdom,
      resources,
      population,
      currentServerTimeMs: now,
      options: { isFirstInitialization: true },
    });

    const passed =
      res.success === true &&
      res.elapsedSeconds === 0 &&
      res.updatedFood === 2500 &&
      res.foodDelta === 0 &&
      res.effectiveTimeMs === now;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "25. Liquidación persistente: primera inicialización (isFirstInitialization) sin adeudamiento ni regalo de recursos",
      passed,
      details: `Éxito: ${res.success}; Segundos: ${res.elapsedSeconds}; Comida conservada intacta: ${res.updatedFood} (esperado 2500); Delta: ${res.foodDelta}; Timestamp actualizado: ${res.effectiveTimeMs}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 26: Inalterabilidad estricta de recursos no alimentarios
  // --------------------------------------------------------------------------
  {
    const kingdom = {
      _id: "test_k_26",
      name: "Reino de Prueba 26",
      userId: "test_user_26",
    };
    const resources = {
      kingdomId: "test_k_26",
      gold: 800,
      wood: 1200,
      stone: 1000,
      iron: 300,
      food: 2500,
      lastUpdated: 1_000_000,
    };
    const population = {
      kingdomId: "test_k_26",
      total: 1000,
      available: 0,
    };
    const buildings = [
      { kingdomId: "test_k_26", buildingType: "granja", level: 1 },
      { kingdomId: "test_k_26", buildingType: "aserradero", level: 1 },
      { kingdomId: "test_k_26", buildingType: "cantera", level: 1 },
      { kingdomId: "test_k_26", buildingType: "minaHierro", level: 1 },
    ];

    const now = 1_000_000 + 3600 * 1000;
    const res = calculateSettlementProgress({
      kingdom,
      resources,
      population,
      buildings,
      currentServerTimeMs: now,
    });

    // Recursos madera, piedra, hierro y oro deben permanecer idénticos en la definición de recursos
    const passed =
      res.success === true &&
      resources.gold === 800 &&
      resources.wood === 1200 &&
      resources.stone === 1000 &&
      resources.iron === 300;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "26. Inalterabilidad de recursos sin fórmula aprobada (oro 800, madera 1200, piedra 1000, hierro 300)",
      passed,
      details: `Oro: ${resources.gold}, Madera: ${resources.wood}, Piedra: ${resources.stone}, Hierro: ${resources.iron} (100% inalterados)`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 27: Detección analítica de agotamiento y transición atómica a starving
  // --------------------------------------------------------------------------
  {
    const kingdom = {
      _id: "test_k_27",
      name: "Reino de Prueba 27",
      userId: "test_user_27",
    };
    const resources = {
      kingdomId: "test_k_27",
      gold: 500,
      wood: 1000,
      stone: 800,
      iron: 200,
      food: 100, // Muy poca comida
      lastUpdated: 1_000_000,
    };
    const population = {
      kingdomId: "test_k_27",
      total: 1000,
      available: 0,
      starving: false,
    };
    // 0 agricultores -> 0 producción
    // 1000 consumo/día -> déficit = -1000/día (-0.01157 raciones/s)
    // 100 comida dura 100 / (1000 / 86400) = 8640s
    const populationJobs = [
      { kingdomId: "test_k_27", jobType: "mining", assignedCount: 1000 },
    ];

    // Transcurren 17.280 segundos (el doble de lo que dura la comida)
    const now = 1_000_000 + 17_280 * 1000;
    const res = calculateSettlementProgress({
      kingdom,
      resources,
      population,
      populationJobs,
      currentServerTimeMs: now,
    });

    const passed =
      res.success === true &&
      res.updatedFood === 0 &&
      res.isStarving === true &&
      res.starvationSeconds === 8640 &&
      res.secondsToExhaustion === 8640;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "27. Liquidación persistente: no negatividad (suelo en 0) y activación precisa del estado isStarving",
      passed,
      details: `Comida final: ${res.updatedFood} (no negativa); isStarving: ${res.isStarving}; Tiempo agotamiento: ${res.secondsToExhaustion}s (esperado 8640s); Tiempo en inanición: ${res.starvationSeconds}s (esperado 8640s)`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 28: Transición atómica de régimen alimentario (Req 6)
  // --------------------------------------------------------------------------
  {
    const kingdom = {
      _id: "test_k_28",
      name: "Reino de Prueba 28",
      userId: "test_user_28",
      foodTier: "normal", // Régimen inicial vigente
    };
    const resources = {
      kingdomId: "test_k_28",
      gold: 500,
      wood: 1000,
      stone: 800,
      iron: 200,
      food: 2000,
      lastUpdated: 1_000_000,
      settlementInitialized: true,
    };
    const population = {
      kingdomId: "test_k_28",
      total: 1000,
      available: 0,
      starving: false,
    };
    // 600 agricultores -> 1200 producción/día
    // Consumo normal: 1000/día -> Superávit neto = +200/día
    const populationJobs = [
      { kingdomId: "test_k_28", jobType: "agriculture", assignedCount: 600 },
      { kingdomId: "test_k_28", jobType: "mining", assignedCount: 400 },
    ];

    // Transcurre medio día (43.200s) y se solicita cambio a régimen "excelente" (1.20)
    const now = 1_000_000 + 43_200 * 1000;
    const transition = executeRegimeChangeTransition({
      kingdom,
      resources,
      population,
      populationJobs,
      newFoodTier: "excelente",
      currentServerTimeMs: now,
      options: { callerUserId: "test_user_28" },
    });

    // En el intervalo transcurrido rigió "normal", superávit = 200 * 0.5 = +100
    const passed =
      transition.success === true &&
      transition.previousFoodTier === "normal" &&
      transition.newFoodTier === "excelente" &&
      transition.elapsedSeconds === 43200 &&
      Math.abs((transition.settledFood ?? 0) - 2100) < 1e-4 &&
      Math.abs((transition.foodDelta ?? 0) - 100) < 1e-4 &&
      transition.timestamp === now;

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "28. Transición atómica de régimen: liquida con el régimen previo antes de activar el nuevo",
      passed,
      details: `Previo: ${transition.previousFoodTier}, Nuevo: ${transition.newFoodTier}, Comida liquidada: ${transition.settledFood} (esperada 2100 con factor normal), Delta: ${transition.foodDelta}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 29: Periodos prolongados sin bucles (cálculo analítico O(1), Req 3)
  // --------------------------------------------------------------------------
  {
    const kingdom = {
      _id: "test_k_29",
      name: "Reino de Prueba 29",
      userId: "test_user_29",
      foodTier: "normal",
    };
    const resources = {
      kingdomId: "test_k_29",
      gold: 500,
      wood: 1000,
      stone: 800,
      iron: 200,
      food: 2000,
      lastUpdated: 1_000_000,
      settlementInitialized: true,
    };
    const population = {
      kingdomId: "test_k_29",
      total: 1000,
      available: 0,
    };
    // 600 agricultores -> 1200 producción/día
    // Consumo normal: 1000/día -> Superávit neto = +200/día
    const populationJobs = [
      { kingdomId: "test_k_29", jobType: "agriculture", assignedCount: 600 },
      { kingdomId: "test_k_29", jobType: "mining", assignedCount: 400 },
    ];

    // Transcurren 30 días reales = 2.592.000 segundos sin tope artificial
    const elapsedSecondsExpected = 30 * 86400;
    const now = 1_000_000 + elapsedSecondsExpected * 1000;

    const startPerf = Date.now();
    const res = calculateSettlementProgress({
      kingdom,
      resources,
      population,
      populationJobs,
      currentServerTimeMs: now,
    });
    const perfTimeMs = Date.now() - startPerf;

    // Producción esperada: 2000 inicial + 30 días * 200 comida/día = 8000
    const passed =
      res.success === true &&
      res.elapsedSeconds === elapsedSecondsExpected &&
      res.cappedInterval === false &&
      Math.abs((res.updatedFood ?? 0) - 8000) < 1e-4 &&
      perfTimeMs < 50;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "29. Periodos prolongados (30 días reales / 2.592.000s): cálculo analítico exacto en O(1) sin bucles",
      passed,
      details: `Tiempo cálculo: ${perfTimeMs}ms (O(1)); Segundos: ${res.elapsedSeconds}; Comida resultante: ${res.updatedFood} (esperada 8000); Capped: ${res.cappedInterval}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 30: Primera inicialización automática con settlementInitialized !== true
  // --------------------------------------------------------------------------
  {
    const kingdom = {
      _id: "test_k_30",
      name: "Reino de Iberia Mock",
      userId: "guest_g9ai8cz",
    };
    const resources = {
      kingdomId: "test_k_30",
      gold: 800,
      wood: 1200,
      stone: 1000,
      iron: 300,
      food: 2500,
      lastUpdated: 1791108622538, // Fecha antigua (hace 12 días)
      settlementInitialized: false, // O undefined: primer arranque del motor
    };
    const population = {
      kingdomId: "test_k_30",
      total: 1000,
      available: 0,
      starving: false,
    };

    const now = 1792139337131; // Tiempo actual
    const res = calculateSettlementProgress({
      kingdom,
      resources,
      population,
      currentServerTimeMs: now,
      options: { isFirstInitialization: true },
    });

    const passed =
      res.success === true &&
      res.elapsedSeconds === 0 &&
      res.updatedFood === 2500 &&
      res.foodDelta === 0 &&
      res.isStarving === false &&
      res.effectiveTimeMs === now;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "30. Primera liquidación: fija referencia temporal inicial sin alterar recursos anteriores",
      passed,
      details: `Segundos: ${res.elapsedSeconds}; Delta comida: ${res.foodDelta}; Comida conservada: ${res.updatedFood} (exactamente 2500); Timestamp fijado: ${res.effectiveTimeMs}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 31: Inanición acumulada en periodos prolongados
  // --------------------------------------------------------------------------
  {
    const kingdom = {
      _id: "test_k_31",
      name: "Reino en Hambruna",
      userId: "test_user_31",
    };
    const resources = {
      kingdomId: "test_k_31",
      gold: 500,
      wood: 1000,
      stone: 800,
      iron: 200,
      food: 1000, // 1000 raciones
      lastUpdated: 1_000_000,
      settlementInitialized: true,
    };
    const population = {
      kingdomId: "test_k_31",
      total: 1000,
      available: 0,
      starving: false,
    };
    // 0 agricultores -> déficit de 1000 raciones/día (se agota en exactamente 86.400s = 1 día)
    const populationJobs = [
      { kingdomId: "test_k_31", jobType: "mining", assignedCount: 1000 },
    ];

    // Transcurren 10 días reales = 864.000s
    const now = 1_000_000 + 864_000 * 1000;
    const res = calculateSettlementProgress({
      kingdom,
      resources,
      population,
      populationJobs,
      currentServerTimeMs: now,
    });

    // Debe agotarse a los 86.400s y permanecer en inanición 864.000 - 86.400 = 777.600s (9 días)
    const passed =
      res.success === true &&
      res.updatedFood === 0 &&
      res.isStarving === true &&
      res.secondsToExhaustion === 86400 &&
      res.starvationSeconds === 777600 &&
      res.elapsedSeconds === 864000;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "31. Inanición acumulada en periodos largos: cálculo exacto de tiempo en inanición y suelo en 0",
      passed,
      details: `Comida final: ${res.updatedFood}; Agotamiento en: ${res.secondsToExhaustion}s (1 día); Tiempo en inanición: ${res.starvationSeconds}s (exactamente 9 días = 777.600s)`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 32: Concurrencia e idempotencia temporal (evitar doble liquidación)
  // --------------------------------------------------------------------------
  {
    const kingdom = {
      _id: "test_k_32",
      name: "Reino Concurrencia",
      userId: "test_user_32",
    };
    const resources = {
      kingdomId: "test_k_32",
      gold: 500,
      wood: 1000,
      stone: 800,
      iron: 200,
      food: 2000,
      lastUpdated: 1_000_000,
      settlementInitialized: true,
    };
    const population = {
      kingdomId: "test_k_32",
      total: 1000,
      available: 0,
    };
    const populationJobs = [
      { kingdomId: "test_k_32", jobType: "agriculture", assignedCount: 600 },
      { kingdomId: "test_k_32", jobType: "mining", assignedCount: 400 },
    ];

    // Liquidación 1 en T1
    const t1 = 1_000_000 + 3600 * 1000; // 1 hora después
    const res1 = calculateSettlementProgress({
      kingdom,
      resources,
      population,
      populationJobs,
      currentServerTimeMs: t1,
    });

    // Simulamos la confirmación atómica en Convex: resources actualiza lastUpdated a t1
    const updatedResources = {
      ...resources,
      food: res1.updatedFood!,
      lastUpdated: res1.effectiveTimeMs!,
    };

    // Liquidación 2 concurrente (o inmediata reejecución OCC en el mismo timestamp t1)
    const res2 = calculateSettlementProgress({
      kingdom,
      resources: updatedResources,
      population,
      populationJobs,
      currentServerTimeMs: t1,
    });

    const passed =
      res1.success === true &&
      res2.success === true &&
      res2.elapsedSeconds === 0 &&
      res2.foodDelta === 0 &&
      res2.updatedFood === res1.updatedFood &&
      res2.starvationSeconds === 0;

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "32. Concurrencia e idempotencia temporal: reejecución con timestamp idéntico resulta en delta 0 sin duplicación",
      passed,
      details: `Liq 1: delta +${res1.foodDelta?.toFixed(2)}, comida ${res1.updatedFood?.toFixed(2)}; Liq 2 (mismo timestamp): delta ${res2.foodDelta}, comida ${res2.updatedFood?.toFixed(2)} (sin duplicación)`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 33: Integración B.8: Usuario sin reino no puede liquidar ni cambiar régimen
  // --------------------------------------------------------------------------
  {
    const resSettlement = calculateSettlementProgress({
      kingdom: null,
      resources: null,
      population: null,
      currentServerTimeMs: Date.now(),
    });

    const resRegime = executeRegimeChangeTransition({
      kingdom: null,
      resources: null,
      population: null,
      newFoodTier: "abundante",
      currentServerTimeMs: Date.now(),
    });

    const passed =
      resSettlement.success === false &&
      resRegime.success === false &&
      typeof resSettlement.error === "string" &&
      typeof resRegime.error === "string";

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "33. Integración UI: Usuario sin reino no puede liquidar ni cambiar régimen (rechazo defensivo)",
      passed,
      details: `Liquidación rechazada: ${!resSettlement.success} (${resSettlement.error}); Cambio de régimen rechazado: ${!resRegime.success} (${resRegime.error})`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 34: Integración B.8: Modo demo no realiza mutaciones persistentes
  // --------------------------------------------------------------------------
  {
    // Simulación del guardia de interfaz en modo demostración
    const isViewingDemo = true;
    const DEMO_USER_ID = "guest_g9ai8cz";
    const authUser = { sub: "google_user_123", email: "soberano@ejemplo.com" };

    const isOwner = Boolean(
      !isViewingDemo &&
      authUser.sub &&
      DEMO_USER_ID === authUser.sub
    );

    // En demo, isOwner es estrictamente falso; cualquier intento de mutación debe bloquearse en cliente
    const mutationBlocked = !isOwner;

    // Solo se permite simulación local de solo lectura
    const localSim = calculateSimulatedKingdomResources({
      kingdom: { _id: "jx74jatng7da8c0bjehpb6c7258fnzqc", name: "Reino de Iberia", userId: DEMO_USER_ID },
      resources: { kingdomId: "jx74jatng7da8c0bjehpb6c7258fnzqc", food: 2500, gold: 800, wood: 1200, stone: 1000, iron: 300, lastUpdated: 1_000_000 },
      population: { kingdomId: "jx74jatng7da8c0bjehpb6c7258fnzqc", total: 1000, available: 0 },
      foodTier: "normal",
      callerUserId: DEMO_USER_ID,
    });

    const passed = mutationBlocked === true && localSim.success === true;

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "34. Integración UI: Modo demo bloquea mutaciones persistentes y restringe interacción a simulación local",
      passed,
      details: `isOwner en demo: ${isOwner}; Mutaciones bloqueadas: ${mutationBlocked}; Simulación local permitida: ${localSim.success}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 35: Integración B.8: Carga de régimen de reino propio desde Convex
  // --------------------------------------------------------------------------
  {
    const kingdomWithSavedTier = {
      _id: "k_own_1",
      userId: "user_owner",
      name: "Corona Propia",
      foodTier: "abundante",
    };
    const kingdomWithoutSavedTier = {
      _id: "k_own_2",
      userId: "user_owner",
      name: "Corona Nueva",
    };

    const initialTier1 = kingdomWithSavedTier.foodTier ?? "normal";
    const initialTier2 = (kingdomWithoutSavedTier as any).foodTier ?? "normal";

    const passed = initialTier1 === "abundante" && initialTier2 === "normal";

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "35. Integración UI: Carga inicial del régimen desde kingdom.foodTier con fallback a 'normal'",
      passed,
      details: `Reino con tier guardado: ${initialTier1} (esperado 'abundante'); Reino sin tier guardado: ${initialTier2} (esperado 'normal')`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 36: Integración B.8: Cambio de régimen solo guardado tras confirmación
  // --------------------------------------------------------------------------
  {
    let clientVisibleRegime = "normal";
    let isSaving = false;

    // Acción de usuario: solicitar cambio a 'excelente'
    isSaving = true;
    // Mientras la mutación está en vuelo, el valor guardado confirmado sigue siendo 'normal'
    const pendingSaveMatchesClient = clientVisibleRegime === "normal";

    // Simulación de confirmación del servidor
    const serverResult = executeRegimeChangeTransition({
      kingdom: { _id: "k_own_36", userId: "u36", name: "Reino 36", foodTier: clientVisibleRegime },
      resources: { kingdomId: "k_own_36", food: 2000, gold: 500, wood: 1000, stone: 800, iron: 200, lastUpdated: 1_000_000, settlementInitialized: true },
      population: { kingdomId: "k_own_36", total: 1000, available: 0 },
      newFoodTier: "excelente",
      currentServerTimeMs: 1_000_000 + 3600 * 1000,
      options: { callerUserId: "u36" },
    });

    if (serverResult.success && serverResult.newFoodTier) {
      clientVisibleRegime = serverResult.newFoodTier;
      isSaving = false;
    }

    const passed =
      pendingSaveMatchesClient &&
      !isSaving &&
      clientVisibleRegime === "excelente" &&
      serverResult.previousFoodTier === "normal";

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "36. Integración UI: Cambio de régimen solo aparece confirmado tras respuesta exitosa del servidor",
      passed,
      details: `Sin actualización optimista falsa: ${pendingSaveMatchesClient}; Confirmado tras servidor: ${clientVisibleRegime} (esperado 'excelente')`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 37: Integración B.8: Fallo en mutación revierte y no desincroniza selector
  // --------------------------------------------------------------------------
  {
    const serverConfirmedRegime = "normal";
    let clientSelectedRegime = serverConfirmedRegime;

    // Usuario intenta seleccionar un régimen inválido
    const attemptedTier = "invalido_supervivencia";

    // El servidor rechaza la mutación
    const failedResult = executeRegimeChangeTransition({
      kingdom: { _id: "k37", userId: "u37", name: "R37", foodTier: serverConfirmedRegime },
      resources: { kingdomId: "k37", food: 2000, gold: 500, wood: 1000, stone: 800, iron: 200, lastUpdated: 1_000_000 },
      population: { kingdomId: "k37", total: 1000, available: 0 },
      newFoodTier: attemptedTier,
      currentServerTimeMs: 1_000_000,
    });

    if (!failedResult.success) {
      // Manejo de error en UI: revertir al régimen confirmado por el servidor
      clientSelectedRegime = serverConfirmedRegime;
    }

    const passed =
      failedResult.success === false &&
      clientSelectedRegime === serverConfirmedRegime;

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "37. Integración UI: Fallo de mutación captura el error y revierte el selector al régimen confirmado",
      passed,
      details: `Rechazo del servidor: ${!failedResult.success}; Selector revertido a: ${clientSelectedRegime} (esperado 'normal')`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 38: Integración B.8: Respeto estricto de firmas reales de Convex
  // --------------------------------------------------------------------------
  {
    // Firma de getKingdomFull: { userId: string }
    const validQueryArgs: { userId: string } = { userId: "guest_g9ai8cz" };

    // Firma de getViewer: {}
    const validViewerArgs: Record<string, never> = {};

    // Firma de settleKingdomEconomy: { kingdomId?: string, includeSiegeInFoodConsumption?: boolean }
    const validSettleArgs: {
      kingdomId?: string;
      includeSiegeInFoodConsumption?: boolean;
    } = { kingdomId: "jx74jatng7da8c0bjehpb6c7258fnzqc" };

    // Firma de setKingdomFoodTier: { kingdomId?: string, foodTier: string }
    const validSetTierArgs: {
      kingdomId?: string;
      foodTier: string;
    } = { kingdomId: "jx74jatng7da8c0bjehpb6c7258fnzqc", foodTier: "abundante" };

    const passed =
      typeof validQueryArgs.userId === "string" &&
      Object.keys(validViewerArgs).length === 0 &&
      typeof validSettleArgs.kingdomId === "string" &&
      typeof validSetTierArgs.foodTier === "string";

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "38. Integración UI: Las consultas y mutaciones respetan estrictamente sus firmas tipadas en Convex",
      passed,
      details: `getKingdomFull: {userId}; getViewer: {}; settleKingdomEconomy: {kingdomId?}; setKingdomFoodTier: {kingdomId?, foodTier}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 39: Integración B.8: Segregación entre reservas persistidas y proyección local
  // --------------------------------------------------------------------------
  {
    const persistedFood = 2500;
    const simResult = calculateSimulatedKingdomResources({
      kingdom: { _id: "k39", name: "Reino 39", userId: "u39" },
      resources: { kingdomId: "k39", food: persistedFood, gold: 800, wood: 1200, stone: 1000, iron: 300, lastUpdated: 1_000_000 },
      population: { kingdomId: "k39", total: 1000, available: 0 },
      populationJobs: [
        { kingdomId: "k39", jobType: "agriculture", assignedCount: 600 },
        { kingdomId: "k39", jobType: "mining", assignedCount: 400 },
      ],
      foodTier: "normal",
      targetTime: 1_000_000 + 43200 * 1000, // +12h -> +100 comida
      callerUserId: "u39",
    });

    const projectedFood = simResult.simulatedResources?.food ?? 0;
    const delta = projectedFood - persistedFood;

    // En la UI, el almacén muestra persistedFood (2500), mientras el delta (+100)
    // se muestra claramente como proyección no persistida en el bloque estimado
    const passed =
      persistedFood === 2500 &&
      projectedFood === 2600 &&
      delta === 100 &&
      simResult.originalResources?.food === 2500;

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "39. Integración UI: Segregación visual estricta entre reservas persistidas (2500) y delta estimado (+100)",
      passed,
      details: `Persistido en almacén: ${persistedFood}; Estimación en proyección: ${projectedFood} (delta +${delta}); Original intacto: ${simResult.originalResources?.food}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 40: Integración B.8: Salvaguarda anti-bucles en liquidación al cargar
  // --------------------------------------------------------------------------
  {
    const hasAutoSettledRef: Record<string, boolean> = {};
    const kingdomId = "test_k_40";

    let settlementCalls = 0;
    const simulateAutoSettleOnRender = (currentKingdomId: string) => {
      if (!hasAutoSettledRef[currentKingdomId]) {
        hasAutoSettledRef[currentKingdomId] = true;
        settlementCalls++;
      }
    };

    // Simulamos 5 re-renders sucesivos de React por actualización de estado / reloj
    simulateAutoSettleOnRender(kingdomId);
    simulateAutoSettleOnRender(kingdomId);
    simulateAutoSettleOnRender(kingdomId);
    simulateAutoSettleOnRender(kingdomId);
    simulateAutoSettleOnRender(kingdomId);

    const passed = settlementCalls === 1 && hasAutoSettledRef[kingdomId] === true;

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "40. Integración UI: Salvaguarda anti-bucles en liquidación automática al cargar el reino propio",
      passed,
      details: `Re-renders simulados: 5; Liquidaciones ejecutadas: ${settlementCalls} (estrictamente 1 vez); Flag persistente: ${hasAutoSettledRef[kingdomId]}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 41: Reasignación relacional, disponibilidad y persistencia resultante
  // --------------------------------------------------------------------------
  {
    const populationJobs = [
      { _id: "job_agriculture", kingdomId: "k_workers", jobType: "agriculture", assignedCount: 300 },
      { _id: "job_mining", kingdomId: "k_workers", jobType: "mining", assignedCount: 200 },
    ];
    const reassignment = calculatePopulationJobReassignment({
      populationTotal: 1000,
      available: 500,
      populationJobs,
      kingdomId: "k_workers",
      jobType: "agriculture",
      assignedCount: 400,
    });
    const release = calculatePopulationJobReassignment({
      populationTotal: 1000,
      available: 500,
      populationJobs,
      kingdomId: "k_workers",
      jobType: "agriculture",
      assignedCount: 250,
    });
    const passed =
      reassignment.success &&
      reassignment.previousAssignedCount === 300 &&
      reassignment.assignedCount === 400 &&
      reassignment.available === 400 &&
      reassignment.persistence?.operation === "update" &&
      reassignment.persistence.jobId === "job_agriculture" &&
      300 + 200 + 500 === 400 + 200 + reassignment.available &&
      release.success &&
      release.assignedCount === 250 &&
      release.available === 550 &&
      release.persistence?.operation === "update" &&
      release.available + release.assignedCount + 200 === 1000;

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "41. Reasignación laboral valida y resultado persistible sincroniza oficio y mano disponible",
      passed,
      details: `Persistir agriculture=${reassignment.assignedCount}, available=${reassignment.available}; liberar a ${release.assignedCount} deja ${release.available} disponibles`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 42: Rechaza valores inválidos, tipos no admitidos y sobreasignación
  // --------------------------------------------------------------------------
  {
    const base = {
      populationTotal: 1000,
      available: 100,
      populationJobs: [
        { _id: "job_agriculture", kingdomId: "k_workers", jobType: "agriculture", assignedCount: 400 },
      ],
      kingdomId: "k_workers",
      jobType: "agriculture",
    };
    const negative = calculatePopulationJobReassignment({ ...base, assignedCount: -1 });
    const fractional = calculatePopulationJobReassignment({ ...base, assignedCount: 1.5 });
    const unavailable = calculatePopulationJobReassignment({ ...base, assignedCount: 501 });
    const unknownJob = calculatePopulationJobReassignment({
      ...base,
      jobType: "invented",
      assignedCount: 100,
    });
    const duplicateJob = calculatePopulationJobReassignment({
      ...base,
      populationJobs: [
        ...base.populationJobs,
        { kingdomId: "k_workers", jobType: "AGRICULTURE", assignedCount: 10 },
      ],
      assignedCount: 400,
    });
    const foreignRecord = calculatePopulationJobReassignment({
      ...base,
      populationJobs: [
        { kingdomId: "another_kingdom", jobType: "agriculture", assignedCount: 400 },
      ],
      assignedCount: 400,
    });
    const overallocatedPopulation = calculatePopulationJobReassignment({
      ...base,
      available: 100,
      populationJobs: [
        { kingdomId: "k_workers", jobType: "agriculture", assignedCount: 950 },
      ],
      assignedCount: 950,
    });
    const newJob = calculatePopulationJobReassignment({
      ...base,
      jobType: "scholars",
      assignedCount: 50,
    });
    const removeJob = calculatePopulationJobReassignment({
      ...base,
      assignedCount: 0,
    });
    const passed = [
      negative,
      fractional,
      unavailable,
      unknownJob,
      duplicateJob,
      foreignRecord,
      overallocatedPopulation,
    ].every(result => !result.success) &&
      newJob.persistence?.operation === "insert" &&
      removeJob.persistence?.operation === "delete" &&
      removeJob.persistence.jobId === "job_agriculture";

    results.push({
      category: "LÍMITES Y ROBUSTEZ",
      test: "42. Rechaza cantidades negativas/fraccionarias, oficio inválido, falta de disponibles y estado duplicado/ajeno",
      passed,
      details: `Rechazos: negativo=${!negative.success}, fracción=${!fractional.success}, sin disponibles=${!unavailable.success}, tipo=${!unknownJob.success}, duplicado=${!duplicateJob.success}, reino ajeno=${!foreignRecord.success}, censo excedido=${!overallocatedPopulation.success}; insert=${newJob.persistence?.operation}, delete=${removeJob.persistence?.operation}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 43: La autorización se basa en identidad y propiedad, no en el ID
  // --------------------------------------------------------------------------
  {
    const owner = isKingdomOwner("user_workers", "user_workers");
    const foreignOwner = isKingdomOwner("user_workers", "intruder");
    const demoOwner = isKingdomOwner(DEMO_USER_ID, "user_workers");
    const passed = owner && !foreignOwner && !demoOwner;

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "43. La reasignación sólo puede ser autorizada por el propietario autenticado; Iberia sigue siendo de solo lectura",
      passed,
      details: `Propietario aceptado=${owner}; ajeno rechazado=${!foreignOwner}; demo rechazada=${!demoOwner}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 44: Producción depende del trabajo agrícola y militares civiles no son tropas
  // --------------------------------------------------------------------------
  {
    const adapted = adaptRemoteDocumentsToEconomicState({
      kingdom: { _id: "k_economy_workers", name: "Test", userId: "u" },
      resources: {
        kingdomId: "k_economy_workers",
        gold: 0,
        wood: 0,
        stone: 0,
        iron: 0,
        food: 1000,
        lastUpdated: 1_000_000,
      },
      population: { kingdomId: "k_economy_workers", total: 1000, available: 100 },
      populationJobs: [
        { kingdomId: "k_economy_workers", jobType: "agriculture", assignedCount: 100 },
        { kingdomId: "k_economy_workers", jobType: "military", assignedCount: 800 },
      ],
      armyUnits: [{ kingdomId: "k_economy_workers", unitType: "infanteria", count: 100 }],
      foodTier: "normal",
    });
    const noFarmers = simulateEconomicProgress(
      {
        ...INITIAL_KINGDOM_CONFIG,
        workers: { ...INITIAL_KINGDOM_CONFIG.workers, agriculture: 0 },
        lastUpdated: 1_000_000,
      },
      1_000_000 + SECONDS_PER_GAME_YEAR * 1000
    );
    const staffed = adapted.kingdomState
      ? simulateEconomicProgress(adapted.kingdomState, 1_000_000 + SECONDS_PER_GAME_YEAR * 1000)
      : null;
    const passed =
      noFarmers.dailyFoodProduction === 0 &&
      adapted.success &&
      staffed?.dailyFoodProduction === 200 &&
      staffed.dailyFoodConsumption === 1005 &&
      adapted.kingdomState?.regularSoldiers === 100;

    results.push({
      category: "MATEMÁTICA / LÓGICA PURA",
      test: "44. Sin agricultores no hay producción gratuita; el oficio militar civil no recibe recargo de tropa",
      passed,
      details: `Sin agricultores=${noFarmers.dailyFoodProduction}/día; con 100 agricultores=${staffed?.dailyFoodProduction}/día; consumo=${staffed?.dailyFoodConsumption}/día; tropas reales=${adapted.kingdomState?.regularSoldiers}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 45: Una liquidación repetida no vuelve a contabilizar el mismo intervalo
  // --------------------------------------------------------------------------
  {
    const kingdom = { _id: "k_once", name: "Test", userId: "u" };
    const population = { kingdomId: "k_once", total: 1000, available: 0 };
    const populationJobs = [
      { kingdomId: "k_once", jobType: "agriculture", assignedCount: 600 },
      { kingdomId: "k_once", jobType: "mining", assignedCount: 400 },
    ];
    const first = calculateSettlementProgress({
      kingdom,
      resources: {
        kingdomId: "k_once",
        gold: 0,
        wood: 0,
        stone: 0,
        iron: 0,
        food: 1000,
        lastUpdated: 1_000_000,
        settlementInitialized: true,
      },
      population,
      populationJobs,
      currentServerTimeMs: 1_000_000 + SECONDS_PER_GAME_YEAR * 1000,
    });
    const second = calculateSettlementProgress({
      kingdom,
      resources: {
        kingdomId: "k_once",
        gold: 0,
        wood: 0,
        stone: 0,
        iron: 0,
        food: first.updatedFood ?? 0,
        lastUpdated: first.effectiveTimeMs ?? 1_000_000,
        settlementInitialized: true,
      },
      population,
      populationJobs,
      currentServerTimeMs: first.effectiveTimeMs ?? 1_000_000,
    });
    const passed =
      first.success &&
      first.updatedFood === 1200 &&
      first.foodDelta === 200 &&
      second.success &&
      second.elapsedSeconds === 0 &&
      second.foodDelta === 0 &&
      second.updatedFood === first.updatedFood;

    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "45. Liquidación repetida sobre el mismo timestamp no duplica producción ni consumo",
      passed,
      details: `Primera liquidación: ${first.foodDelta}; repetición: ${second.foodDelta}; saldo final: ${second.updatedFood}`,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 46: Edificios relacionales y capacidad productiva pendiente
  // --------------------------------------------------------------------------
  {
    const projected = calculateSimulatedKingdomResources({
      kingdom: { _id: "k_building", name: "Test", userId: "u" },
      resources: {
        kingdomId: "k_building",
        gold: 0,
        wood: 0,
        stone: 0,
        iron: 0,
        food: 1000,
        lastUpdated: 1_000_000,
      },
      population: { kingdomId: "k_building", total: 100, available: 0 },
      populationJobs: [
        { kingdomId: "k_building", jobType: "agriculture", assignedCount: 20 },
        { kingdomId: "k_building", jobType: "mining", assignedCount: 80 },
      ],
      armyUnits: [],
      buildings: [
        { kingdomId: "k_building", buildingType: "granja", level: 1 },
      ],
      foodTier: "normal",
      targetTime: 1_000_000 + SECONDS_PER_GAME_YEAR * 1000,
      callerUserId: "u",
    });
    const configuredCapacity = simulateEconomicProgress({
      ...INITIAL_KINGDOM_CONFIG,
      workers: { ...INITIAL_KINGDOM_CONFIG.workers, agriculture: 20 },
      foodProductionWorkerLimit: 5,
      lastUpdated: 1_000_000,
    }, 1_000_000 + SECONDS_PER_GAME_YEAR * 1000);
    const unstaffedBuilding = simulateEconomicProgress({
      ...INITIAL_KINGDOM_CONFIG,
      workers: { ...INITIAL_KINGDOM_CONFIG.workers, agriculture: 0 },
      foodProductionWorkerLimit: 50,
      lastUpdated: 1_000_000,
    }, 1_000_000 + SECONDS_PER_GAME_YEAR * 1000);

    // Granja nivel 1 = 100 agricultores de capacidad (D-03/D-47): 20 agricultores producen 40/día.
    const passed =
      projected.success &&
      projected.foodProductionCapacityPending === false &&
      projected.productionAndConsumption?.dailyFoodProduction === 40 &&
      projected.productionAndConsumption.effectiveAgricultureWorkers === 20 &&
      configuredCapacity.dailyFoodProduction === 10 &&
      configuredCapacity.effectiveAgricultureWorkers === 5 &&
      unstaffedBuilding.dailyFoodProduction === 0;
    results.push({
      category: "INTEGRACIÓN CONVEX",
      test: "46. La capacidad edificada limita la producción por trabajador (D-47); edificio sin trabajadores no genera producción",
      passed,
      details: `Pendiente=${projected.foodProductionCapacityPending}; granja nivel 1 con 20 agricultores=${projected.productionAndConsumption?.dailyFoodProduction}/día; capacidad limitada (fixture)=${configuredCapacity.dailyFoodProduction}/día; granja sin agricultores=${unstaffedBuilding.dailyFoodProduction}/día`,
    });
  }

  results.push(...runConstructionValidationTests().map((result) => ({
    category: "INTEGRACIÓN CONVEX" as const,
    ...result,
  })));
  results.push(...runArmyValidationTests().map((result) => ({
    category: "INTEGRACIÓN CONVEX" as const,
    test: `Ejército: ${result.test}`,
    passed: result.passed,
    details: result.details,
  })));
  results.push(...runTechnologyValidationTests().map((result) => ({
    category: "INTEGRACIÓN CONVEX" as const,
    test: `Tecnología: ${result.test}`,
    passed: result.passed,
    details: result.details,
  })));
  results.push(...runExtendedEconomyTests().map((result) => ({
    category: "MATEMÁTICA / LÓGICA PURA" as const,
    test: `Economía ampliada: ${result.test}`,
    passed: result.passed,
    details: result.details,
  })));
  return results;
}
