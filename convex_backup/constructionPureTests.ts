import {
  BUILDING_RULES,
  INITIAL_BUILDING_LEVELS,
  calculateConstructionCancellationRefund,
  calculateJobCapacities,
  calculateResidentialCapacity,
  constructionProgress,
  costsForTargetLevel,
  createConstructionPlan,
  durationForTargetLevel,
  isConstructionDue,
  validateConstructionCompletion,
  type BuildingRule,
  type ConstructionQueueEntry,
} from "./buildingRules";
import { isKingdomOwner } from "./kingdomAccess";
import { BUILDINGS, POPULATION } from "./balanceConfig";
import { INITIAL_KINGDOM_CONFIG, type ResourceType } from "./economyCalculations";

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
  const atMaxLevel = createConstructionPlan(validInput({ currentLevel: 100, buildingLevels: { castillo: 100 } }));
  const invalidLevel = createConstructionPlan(validInput({ currentLevel: 100.5 }));
  const invalidBaseDuration = createConstructionPlan(validInput({
    rule: { ...rule, baseDurationMs: 0 },
  }));
  const durationAtLevelTwo = durationForTargetLevel(testBaseDurationMs, 2);
  const durationAtLevelHundred = durationForTargetLevel(testBaseDurationMs, 100);
  const expectedLevelHundredDuration = Math.ceil(testBaseDurationMs * (1.01 ** 99));
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
  const upgradedBuilding = validateConstructionCompletion({ buildingType: "granja", targetLevel: 100, existingLevels: [99] });
  const invalidUpgrade = validateConstructionCompletion({ buildingType: "granja", targetLevel: 4, existingLevels: [2] });

  return [
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
      test: "Límite de nivel 100 y validación de nivel entero",
      passed: !atMaxLevel.success && !invalidLevel.success,
      details: `Nivel 100 rechazado: ${!atMaxLevel.success}; nivel fraccionario rechazado: ${!invalidLevel.success}`,
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
      passed: initialResidential >= POPULATION.INITIAL && initialWorkersCovered,
      details: `Capacidad residencial inicial ${initialResidential} ≥ ${POPULATION.INITIAL}: ${initialResidential >= POPULATION.INITIAL}; capacidades laborales cubren la distribución inicial: ${initialWorkersCovered}`,
    },
    {
      test: "Finalización conserva edificios y sólo permite crear nivel 1 o subir un nivel existente",
      passed: newBuilding.success && newBuilding.action === "insert" &&
        upgradedBuilding.success && upgradedBuilding.action === "upgrade" &&
        !invalidUpgrade.success,
      details: `Edificio nuevo: ${newBuilding.success}; mejora consecutiva hasta 100: ${upgradedBuilding.success}; salto de nivel rechazado: ${!invalidUpgrade.success}`,
    },
    {
      test: "Requisitos configurados se validan contra niveles de edificios persistidos",
      passed: !missingPrerequisite.success && satisfiedPrerequisite.success,
      details: `Requisito no satisfecho bloqueado: ${!missingPrerequisite.success}; nivel requerido persistido permite continuar: ${satisfiedPrerequisite.success}`,
    },
  ];
}
