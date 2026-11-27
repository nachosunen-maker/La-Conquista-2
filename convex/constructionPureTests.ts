import {
  BUILDING_RULES,
  INITIAL_BUILDING_LEVELS,
  calculateConstructionCancellationRefund,
  calculateJobCapacities,
  calculateResidentialCapacity,
  constructionProgress,
  costsForTargetLevel,
  createConstructionPlan,
  describeCatalogForLevels,
  durationForTargetLevel,
  isConstructionDue,
  validateConstructionCompletion,
  type BuildingRule,
  type ConstructionQueueEntry,
} from "./buildingRules";
import { isKingdomOwner } from "./kingdomAccess";
import { BUILDINGS, POPULATION, CONSTRUCTION, RESEARCH } from "./balanceConfig";
import { INITIAL_KINGDOM_CONFIG, type ResourceType } from "./economyCalculations";
import { getConstructionDurationModifier } from "./technologyRules";
import { getCivilizationPassive } from "./civilizationRules";

export interface ConstructionTestResult {
  test: string;
  passed: boolean;
  details: string;
}

const fullResources: Record<ResourceType, number> = {
  gold: 1000,
  wood: 1000,
  stone: 1000,
  iron: 1000,
  food: 1000,
};

const rule: BuildingRule = {
  label: "Granja de prueba",
  role: "prueba",
  costs: { gold: 50, wood: 120, stone: 0, iron: 0, food: 0 },
  baseDurationMs: 60_000,
  residentialCapacityPerLevel: null,
  productiveWorkerCapacityPerLevel: null,
  jobType: "agriculture",
  progressionRequirements: {},
};
const testBaseDurationMs = 60_000;

function validInput(overrides: Partial<Parameters<typeof createConstructionPlan>[0]> = {}) {
  return {
    buildingType: "granja",
    currentLevel: 0,
    resources: { ...fullResources },
    activeConstructions: [] as ConstructionQueueEntry[],
    buildingLevels: { castillo: 5 } as Record<string, number>,
    now: 10_000,
    rule,
    ...overrides,
  };
}

export function runConstructionValidationTests(): ConstructionTestResult[] {
  const valid = createConstructionPlan(validInput());
  const insufficient = createConstructionPlan(validInput({
    resources: { ...fullResources, wood: 119 },
  }));
  const explicitlyFree = createConstructionPlan(validInput({
    rule: { ...rule, costs: { gold: 0, wood: 0, stone: 0, iron: 0, food: 0 } },
  }));
  const oneOtherType = [{ buildingType: "viviendas", targetLevel: 1, startedAt: 0, durationMs: 100, costs: {} }];
  const oneActiveSlot = [{ buildingType: "granja", targetLevel: 1, startedAt: 0, durationMs: 100, costs: {} }];
  const twoQueuePlan = createConstructionPlan(validInput({ activeConstructions: oneOtherType }));
  const fullQueue = createConstructionPlan(validInput({
    activeConstructions: [
      ...oneOtherType,
      ...oneActiveSlot,
    ],
  }));
  const duplicateQueue = createConstructionPlan(validInput({ activeConstructions: oneActiveSlot }));
  const malformedQueue = createConstructionPlan(validInput({
    activeConstructions: [{ buildingType: "legacy", targetLevel: 1 } as ConstructionQueueEntry],
  }));
  const atMaxLevel = createConstructionPlan(validInput({ currentLevel: 200, buildingLevels: { castillo: 200 } }));
  const level100To101 = createConstructionPlan(validInput({
    currentLevel: 100,
    buildingLevels: { castillo: 150 },
    resources: { gold: 1e12, wood: 1e12, stone: 1e12, iron: 1e12, food: 1e12 },
  }));
  const level199To200 = createConstructionPlan(validInput({
    currentLevel: 199,
    buildingLevels: { castillo: 200 },
    resources: { gold: 1e16, wood: 1e16, stone: 1e16, iron: 1e16, food: 1e16 },
  }));
  const invalidLevel = createConstructionPlan(validInput({ currentLevel: 100.5 }));
  const invalidBaseDuration = createConstructionPlan(validInput({
    rule: { ...rule, baseDurationMs: 0 },
  }));
  const durationAtLevelTwo = durationForTargetLevel(testBaseDurationMs, 2);
  const durationAtLevelHundred = durationForTargetLevel(testBaseDurationMs, 100);
  const expectedLevelHundredDuration = Math.ceil(testBaseDurationMs * (1 + 0.01 * 99));
  const durationWithTechnology = durationForTargetLevel(testBaseDurationMs, 1, 0.95);
  const missingPrerequisite = createConstructionPlan(validInput({
    rule: { ...rule, progressionRequirements: { universidad: 2 } },
  }));
  const satisfiedPrerequisite = createConstructionPlan(validInput({
    rule: { ...rule, progressionRequirements: { universidad: 2 } },
    buildingLevels: { castillo: 5, universidad: 2 },
  }));

  // [COMPLEMENTO D-02] Coste escalado 1,15^(n−1)
  const costsLevelOne = costsForTargetLevel(rule.costs!, 1);
  const costsLevelThree = costsForTargetLevel(rule.costs!, 3);
  const scaledPlan = createConstructionPlan(validInput({ currentLevel: 2 }));

  // [COMPLEMENTO D-05] Tope por nivel del Castillo
  const cappedByCastle = createConstructionPlan(validInput({ currentLevel: 5, buildingLevels: { castillo: 5 } }));
  const noCastle = createConstructionPlan(validInput({ buildingLevels: {} }));
  const castleItself = createConstructionPlan(validInput({
    buildingType: "castillo",
    rule: BUILDING_RULES.castillo,
    currentLevel: 1,
    buildingLevels: { castillo: 1 },
    resources: { gold: 100_000, wood: 100_000, stone: 100_000, iron: 100_000, food: 0 },
  }));

  // [COMPLEMENTO §2] Catálogo oficial completo y edificios fundacionales coherentes con P19
  const catalogComplete = Object.keys(BUILDINGS).every((type) => {
    const entry = BUILDING_RULES[type];
    return entry && entry.costs !== null && entry.baseDurationMs !== null && entry.baseDurationMs > 0 && entry.progressionRequirements !== null;
  });
  const initialBuildings = Object.entries(INITIAL_BUILDING_LEVELS).map(([buildingType, level]) => ({ buildingType, level }));
  const initialResidential = calculateResidentialCapacity(initialBuildings) ?? 0;
  const initialCapacities = calculateJobCapacities(initialBuildings);
  const initialWorkersCovered = initialCapacities !== null &&
    initialCapacities.agriculture >= INITIAL_KINGDOM_CONFIG.workers.agriculture &&
    initialCapacities.wood >= INITIAL_KINGDOM_CONFIG.workers.wood &&
    initialCapacities.stone >= INITIAL_KINGDOM_CONFIG.workers.stone &&
    initialCapacities.iron >= INITIAL_KINGDOM_CONFIG.workers.iron &&
    initialCapacities.gold >= INITIAL_KINGDOM_CONFIG.workers.gold;

  const timed = { buildingType: "granja", targetLevel: 1, startedAt: 10_000, durationMs: 60_000, costs: { gold: 50, wood: 120 } };
  const progress = constructionProgress(timed, 40_000);
  const dueAtBoundary = isConstructionDue(timed, 70_000);
  const cancellation = calculateConstructionCancellationRefund({
    construction: timed,
    serverTimeMs: 40_000,
  });
  const cancellationLate = calculateConstructionCancellationRefund({
    construction: timed,
    serverTimeMs: 69_000,
  });
  const cancellationAfterCompletion = calculateConstructionCancellationRefund({
    construction: timed,
    serverTimeMs: 70_000,
  });
  const cancellationBeforeStart = calculateConstructionCancellationRefund({
    construction: { ...timed, startedAt: 50_000 },
    serverTimeMs: 40_000,
  });
  const newBuilding = validateConstructionCompletion({ buildingType: "granja", targetLevel: 1, existingLevels: [] });
  const upgradedBuilding = validateConstructionCompletion({ buildingType: "granja", targetLevel: 200, existingLevels: [199] });
  const invalidUpgrade = validateConstructionCompletion({ buildingType: "granja", targetLevel: 4, existingLevels: [2] });

  // [EXCEPCIÓN VIVIENDAS] Pruebas de progresión de Viviendas por nivel del Castillo
  const viviendasInput = (currentLevel: number, castleLevel: number) => ({
    buildingType: "viviendas",
    currentLevel,
    resources: { gold: 10_000, wood: 10_000, stone: 10_000, iron: 10_000, food: 10_000 },
    activeConstructions: [] as ConstructionQueueEntry[],
    buildingLevels: { castillo: castleLevel, viviendas: currentLevel },
    now: 10_000,
    rule: BUILDING_RULES.viviendas,
  });

  const viv_c1_v20 = createConstructionPlan(viviendasInput(20, 1));
  const viv_c2_v20 = createConstructionPlan(viviendasInput(20, 2));
  const viv_c3_v20 = createConstructionPlan(viviendasInput(20, 3));
  const viv_c3_v21 = createConstructionPlan(viviendasInput(21, 3));
  const viv_c4_v21 = createConstructionPlan(viviendasInput(21, 4));
  const viv_c4_v22 = createConstructionPlan(viviendasInput(22, 4));
  const viv_c5_v22 = createConstructionPlan(viviendasInput(22, 5));
  const viv_c5_v23 = createConstructionPlan(viviendasInput(23, 5));

  const granjaInput = (currentLevel: number, castleLevel: number) => ({
    buildingType: "granja",
    currentLevel,
    resources: { gold: 10_000, wood: 10_000, stone: 10_000, iron: 10_000, food: 10_000 },
    activeConstructions: [] as ConstructionQueueEntry[],
    buildingLevels: { castillo: castleLevel, granja: currentLevel },
    now: 10_000,
    rule: BUILDING_RULES.granja,
  });

  const granja_c1_g1 = createConstructionPlan(granjaInput(1, 1));
  const granja_c2_g1 = createConstructionPlan(granjaInput(1, 2));

  // Verificación explícita de describeCatalogForLevels para Viviendas en cada nivel del Castillo
  const cat_c1_v20 = describeCatalogForLevels({ castillo: 1, viviendas: 20 }).viviendas;
  const cat_c2_v20 = describeCatalogForLevels({ castillo: 2, viviendas: 20 }).viviendas;
  const cat_c3_v20 = describeCatalogForLevels({ castillo: 3, viviendas: 20 }).viviendas;
  const cat_c3_v21 = describeCatalogForLevels({ castillo: 3, viviendas: 21 }).viviendas;
  const cat_c4_v21 = describeCatalogForLevels({ castillo: 4, viviendas: 21 }).viviendas;
  const cat_c4_v22 = describeCatalogForLevels({ castillo: 4, viviendas: 22 }).viviendas;
  const cat_c5_v22 = describeCatalogForLevels({ castillo: 5, viviendas: 22 }).viviendas;
  const cat_c5_v23 = describeCatalogForLevels({ castillo: 5, viviendas: 23 }).viviendas;

  const catalogCapPassed =
    !cat_c1_v20.castleCapSatisfied &&
    !cat_c2_v20.castleCapSatisfied &&
    cat_c3_v20.castleCapSatisfied &&
    !cat_c3_v21.castleCapSatisfied &&
    cat_c4_v21.castleCapSatisfied &&
    !cat_c4_v22.castleCapSatisfied &&
    cat_c5_v22.castleCapSatisfied &&
    !cat_c5_v23.castleCapSatisfied;

  const viviendasProgressionPassed =
    !viv_c1_v20.success &&
    !viv_c2_v20.success &&
    viv_c3_v20.success &&
    !viv_c3_v21.success &&
    viv_c4_v21.success &&
    !viv_c4_v22.success &&
    viv_c5_v22.success &&
    !viv_c5_v23.success &&
    !granja_c1_g1.success &&
    granja_c2_g1.success &&
    catalogCapPassed;

  return [
    {
      test: "Excepción de progresión para Viviendas (Castillo + 18 desde nivel 3) y regla D-05 para el resto de edificios",
      passed: viviendasProgressionPassed,
      details: `Catálogo C3_V20 cap ok: ${cat_c3_v20.castleCapSatisfied}; C3_V21 cap blocked: ${!cat_c3_v21.castleCapSatisfied}; C4_V21 cap ok: ${cat_c4_v21.castleCapSatisfied}; C4_V22 cap blocked: ${!cat_c4_v22.castleCapSatisfied}; C5_V22 cap ok: ${cat_c5_v22.castleCapSatisfied}; C5_V23 cap blocked: ${!cat_c5_v23.castleCapSatisfied}; Plan C3_V20: ${viv_c3_v20.success ? "ok" : viv_c3_v20.error}; Granja D-05: ${!granja_c1_g1.success && granja_c2_g1.success}`,
    },
    {
      test: "Construcción válida genera objetivo, coste inmutable y fin basado en hora de servidor",
      passed: valid.success && valid.plan.targetLevel === 1 &&
        valid.plan.completesAt === 70_000 && valid.plan.costs.wood === 120 &&
        invalidBaseDuration.success === false,
      details: valid.success ? `Nivel ${valid.plan.targetLevel}, finaliza en ${valid.plan.completesAt}` : valid.error,
    },
    {
      test: "La duración aumenta un 1 % por nivel (P22) y admite el modificador tecnológico",
      passed: durationAtLevelTwo === 60_600 &&
        durationAtLevelHundred === expectedLevelHundredDuration &&
        durationWithTechnology === 57_000,
      details: `Nivel 1 (fixture): ${testBaseDurationMs}; nivel 2: ${durationAtLevelTwo}; nivel 100: ${durationAtLevelHundred}; con −5 %: ${durationWithTechnology}.`,
    },
    {
      test: "El coste escala con 1,15^(nivel−1) (D-02) y el plan usa el coste del nivel objetivo",
      passed: costsLevelOne?.wood === 120 && costsLevelThree?.wood === Math.round(120 * 1.15 ** 2) &&
        costsLevelThree.gold === Math.round(50 * 1.15 ** 2) &&
        scaledPlan.success && scaledPlan.plan.costs.wood === costsLevelThree.wood,
      details: `Nivel 1: ${costsLevelOne?.wood} madera; nivel 3: ${costsLevelThree?.wood} madera / ${costsLevelThree?.gold} oro; plan nivel 3: ${scaledPlan.success ? scaledPlan.plan.costs.wood : scaledPlan.error}`,
    },
    {
      test: "Rechaza recursos insuficientes sin plan de gasto",
      passed: !insufficient.success && insufficient.error.includes("Recursos insuficientes"),
      details: insufficient.success ? "Se creó indebidamente un plan." : insufficient.error,
    },
    {
      test: "Acepta costes cero sólo cuando la regla los declara explícitamente",
      passed: explicitlyFree.success,
      details: explicitlyFree.success ? "La configuración explícita de coste cero se reconoce." : explicitlyFree.error,
    },
    {
      test: "La cola permite dos construcciones pero rechaza la tercera y evita duplicar edificio activo",
      passed: twoQueuePlan.success && !fullQueue.success && !duplicateQueue.success && !malformedQueue.success,
      details: `Una ranura permite iniciar: ${twoQueuePlan.success}; cola llena, tipo repetido y fila incompleta rechazados: ${!fullQueue.success && !duplicateQueue.success && !malformedQueue.success}`,
    },
    {
      test: "Límite de nivel 200, progresión >100 y validación de nivel entero",
      passed:
        CONSTRUCTION.MAX_LEVEL === 200 &&
        level100To101.success &&
        level100To101.plan.targetLevel === 101 &&
        level199To200.success &&
        level199To200.plan.targetLevel === 200 &&
        !atMaxLevel.success &&
        !invalidLevel.success,
      details: `MAX_LEVEL=${CONSTRUCTION.MAX_LEVEL}; 100→101: ${level100To101.success}; 199→200: ${level199To200.success}; nivel 200 rechazado: ${!atMaxLevel.success}; fraccionario rechazado: ${!invalidLevel.success}`,
    },
    {
      test: "Ningún edificio supera el nivel del Castillo (D-05); el Castillo queda exento",
      passed: !cappedByCastle.success && cappedByCastle.error.includes("Castillo") &&
        !noCastle.success && castleItself.success,
      details: `Granja 5→6 con Castillo 5 bloqueada: ${!cappedByCastle.success}; sin Castillo bloqueada: ${!noCastle.success}; Castillo 1→2 permitido: ${castleItself.success ? "sí" : castleItself.error}`,
    },
    {
      test: "Progreso y finalización dependen sólo del intervalo temporal calculado",
      passed: progress === 50 && !isConstructionDue(timed, 69_999) && dueAtBoundary,
      details: `Progreso 50%: ${progress === 50}; vencimiento exacto: ${dueAtBoundary}`,
    },
    {
      test: "Cancelar obra en curso reembolsa el 50 % fijo (D-04) sin depender del tiempo restante; una vencida no se cancela",
      passed: cancellation.success && cancellation.refund.gold === 25 &&
        cancellation.refund.wood === 60 &&
        cancellationLate.success && cancellationLate.refund.gold === 25 && cancellationLate.refund.wood === 60 &&
        !cancellationAfterCompletion.success &&
        !cancellationBeforeStart.success,
      details: cancellation.success
        ? `Reembolso al 50 % de progreso: oro ${cancellation.refund.gold}, madera ${cancellation.refund.wood}; al 98 %: ${cancellationLate.success ? cancellationLate.refund.gold : cancellationLate.error}; vencida/futura rechazadas: ${!cancellationAfterCompletion.success && !cancellationBeforeStart.success}`
        : cancellation.error,
    },
    {
      test: "Autorización de construcción requiere titular autenticado y excluye Iberia",
      passed: isKingdomOwner("owner-1", "owner-1") &&
        !isKingdomOwner("owner-1", "owner-2") &&
        !isKingdomOwner("guest_g9ai8cz", "guest_g9ai8cz"),
      details: "Propietario aceptado; usuario ajeno y reino demo rechazados.",
    },
    {
      test: "El catálogo oficial está completo: 18 edificios con coste, duración y requisitos",
      passed: catalogComplete && Object.keys(BUILDING_RULES).length === 18,
      details: `Edificios configurados: ${Object.keys(BUILDING_RULES).length}; todos completos: ${catalogComplete}`,
    },
    {
      test: "Los edificios fundacionales alojan el censo inicial (P10/P19) y emplean la distribución inicial de trabajadores",
      passed: initialResidential === 20_000 && initialResidential >= POPULATION.INITIAL && initialWorkersCovered,
      details: `Capacidad residencial inicial ${initialResidential} (viviendas nv.20 × 1.000) ≥ ${POPULATION.INITIAL}: ${initialResidential >= POPULATION.INITIAL}; capacidades laborales cubren la distribución inicial: ${initialWorkersCovered}`,
    },
    {
      test: "Regla de capacidad residencial de 1.000 habitantes por nivel de viviendas (1..200, suma múltiple y validación)",
      passed:
        BUILDINGS.viviendas.residentialCapacityPerLevel === 1000 &&
        calculateResidentialCapacity([{ buildingType: "viviendas", level: 1 }]) === 1000 &&
        calculateResidentialCapacity([{ buildingType: "viviendas", level: 2 }]) === 2000 &&
        calculateResidentialCapacity([{ buildingType: "viviendas", level: 5 }]) === 5000 &&
        calculateResidentialCapacity([{ buildingType: "viviendas", level: 10 }]) === 10_000 &&
        calculateResidentialCapacity([{ buildingType: "viviendas", level: 20 }]) === 20_000 &&
        calculateResidentialCapacity([{ buildingType: "viviendas", level: 50 }]) === 50_000 &&
        calculateResidentialCapacity([{ buildingType: "viviendas", level: 100 }]) === 100_000 &&
        calculateResidentialCapacity([{ buildingType: "viviendas", level: 200 }]) === 200_000 &&
        calculateResidentialCapacity([{ buildingType: "viviendas", level: 3 }, { buildingType: "viviendas", level: 5 }]) === 8000 &&
        calculateResidentialCapacity([{ buildingType: "viviendas", level: 0 }]) === null &&
        calculateResidentialCapacity([{ buildingType: "viviendas", level: 201 }]) === null &&
        calculateResidentialCapacity([{ buildingType: "viviendas", level: 2.5 }]) === null,
      details: `Por nivel: ${BUILDINGS.viviendas.residentialCapacityPerLevel}; nv.20=${calculateResidentialCapacity([{ buildingType: "viviendas", level: 20 }])}; nv.200=${calculateResidentialCapacity([{ buildingType: "viviendas", level: 200 }])}`,
    },
    {
      test: "Finalización conserva edificios y sólo permite crear nivel 1 o subir un nivel existente hasta 200",
      passed: newBuilding.success && newBuilding.action === "insert" &&
        upgradedBuilding.success && upgradedBuilding.action === "upgrade" &&
        !invalidUpgrade.success,
      details: `Edificio nuevo: ${newBuilding.success}; mejora consecutiva hasta 200: ${upgradedBuilding.success}; salto de nivel rechazado: ${!invalidUpgrade.success}`,
    },
    {
      test: "Requisitos configurados se validan contra niveles de edificios persistidos",
      passed: !missingPrerequisite.success && satisfiedPrerequisite.success,
      details: `Requisito no satisfecho bloqueado: ${!missingPrerequisite.success}; nivel requerido persistido permite continuar: ${satisfiedPrerequisite.success}`,
    },
    {
      test: "Catálogo de 18 edificios oficiales y tiempos base aprobados beta (GLOBAL_DURATION_MULTIPLIER = 1.00)",
      passed:
        CONSTRUCTION.GLOBAL_DURATION_MULTIPLIER === 1.00 &&
        Object.keys(BUILDINGS).length === 18 &&
        Object.keys(BUILDING_RULES).length === 18 &&
        BUILDING_RULES.castillo.baseDurationMs === 180_000 &&
        BUILDING_RULES.viviendas.baseDurationMs === 5_000 &&
        BUILDING_RULES.granja.baseDurationMs === 10_000 &&
        BUILDING_RULES.aserradero.baseDurationMs === 10_000 &&
        BUILDING_RULES.cantera.baseDurationMs === 15_000 &&
        BUILDING_RULES.minaHierro.baseDurationMs === 20_000 &&
        BUILDING_RULES.minaOro.baseDurationMs === 20_000 &&
        BUILDING_RULES.cuartel.baseDurationMs === 30_000 &&
        BUILDING_RULES.herreria.baseDurationMs === 45_000 &&
        BUILDING_RULES.universidad.baseDurationMs === 45_000 &&
        BUILDING_RULES.murallas.baseDurationMs === 90_000 &&
        BUILDING_RULES.mercado.baseDurationMs === 45_000 &&
        BUILDING_RULES.parlamento.baseDurationMs === 60_000 &&
        BUILDING_RULES.hospitalMilitar.baseDurationMs === 90_000 &&
        BUILDING_RULES.taberna.baseDurationMs === 30_000 &&
        BUILDING_RULES.panaderia.baseDurationMs === 30_000 &&
        BUILDING_RULES.iglesia.baseDurationMs === 45_000 &&
        BUILDING_RULES.circo.baseDurationMs === 90_000,
      details: `18 edificios con multiplicador 1.00; Castillo: 180s, Viviendas: 5s, Circo: 90s, Granja: 10s, Cuartel: 30s.`,
    },
    {
      test: "Progresión de duraciones en niveles 1, 2, 10, 25, 50 y 100 (+1 % lineal por nivel: base × (1 + 0.01 × (n−1)))",
      passed:
        durationForTargetLevel(BUILDING_RULES.viviendas.baseDurationMs!, 1) === 5_000 &&
        durationForTargetLevel(BUILDING_RULES.viviendas.baseDurationMs!, 2) === 5_050 &&
        durationForTargetLevel(BUILDING_RULES.viviendas.baseDurationMs!, 10) === 5_450 &&
        durationForTargetLevel(BUILDING_RULES.viviendas.baseDurationMs!, 25) === 6_200 &&
        durationForTargetLevel(BUILDING_RULES.viviendas.baseDurationMs!, 50) === 7_450 &&
        durationForTargetLevel(BUILDING_RULES.viviendas.baseDurationMs!, 100) === 9_950 &&
        durationForTargetLevel(BUILDING_RULES.castillo.baseDurationMs!, 1) === 180_000 &&
        durationForTargetLevel(BUILDING_RULES.castillo.baseDurationMs!, 2) === 181_800 &&
        durationForTargetLevel(BUILDING_RULES.castillo.baseDurationMs!, 10) === 196_200 &&
        durationForTargetLevel(BUILDING_RULES.castillo.baseDurationMs!, 25) === 223_200 &&
        durationForTargetLevel(BUILDING_RULES.castillo.baseDurationMs!, 50) === 268_200 &&
        durationForTargetLevel(BUILDING_RULES.castillo.baseDurationMs!, 100) === 358_200 &&
        durationForTargetLevel(BUILDING_RULES.circo.baseDurationMs!, 1) === 90_000 &&
        durationForTargetLevel(BUILDING_RULES.circo.baseDurationMs!, 2) === 90_900 &&
        durationForTargetLevel(BUILDING_RULES.circo.baseDurationMs!, 10) === 98_100 &&
        durationForTargetLevel(BUILDING_RULES.circo.baseDurationMs!, 25) === 111_600 &&
        durationForTargetLevel(BUILDING_RULES.circo.baseDurationMs!, 50) === 134_100 &&
        durationForTargetLevel(BUILDING_RULES.circo.baseDurationMs!, 100) === 179_100,
      details: `Viviendas L1=5s / L100=9.95s; Castillo L1=180s / L100=358.2s; Circo L1=90s / L100=179.1s.`,
    },
    {
      test: "Modificadores de duración de construcción: tecnologías, civilizaciones e idempotencia",
      passed:
        getConstructionDurationModifier(["construction_1"]) === 0.95 &&
        getConstructionDurationModifier(["construction_1", "construction_1"]) === 0.95 &&
        getCivilizationPassive("romanos").constructionDurationMultiplier === 0.90 &&
        RESEARCH.CONSTRUCTION_MIN_DURATION_RATIO === 0.50 &&
        durationForTargetLevel(BUILDING_RULES.circo.baseDurationMs!, 1, 0.95) === 85_500,
      details: `Ingeniería civil: −5% (0.95); id duplicado idéntico: 0.95; Romanos: −10% (0.90); Tope de seguridad: 50%; Circo L1 con −5%: 85.5s.`,
    },
  ];
}
