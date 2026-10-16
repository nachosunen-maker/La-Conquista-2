import {
  BUILDING_RULES,
  calculateConstructionCancellationRefund,
  constructionProgress,
  createConstructionPlan,
  durationForTargetLevel,
  isConstructionDue,
  validateConstructionCompletion,
  type BuildingRule,
  type ConstructionQueueEntry,
} from "./buildingRules";
import { isKingdomOwner } from "./kingdomAccess";
import type { ResourceType } from "./economyCalculations";

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
  costs: { gold: 50, wood: 120, stone: 0, iron: 0, food: 0 },
  baseDurationMs: 60_000,
  residentialCapacityPerLevel: null,
  productiveWorkerCapacityPerLevel: null,
  progressionRequirements: {},
};
const testBaseDurationMs = 60_000;

function validInput(overrides: Partial<Parameters<typeof createConstructionPlan>[0]> = {}) {
  return {
    buildingType: "granja",
    currentLevel: 0,
    resources: { ...fullResources },
    activeConstructions: [] as ConstructionQueueEntry[],
    buildingLevels: {} as Record<string, number>,
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
  const atMaxLevel = createConstructionPlan(validInput({ currentLevel: 100 }));
  const invalidLevel = createConstructionPlan(validInput({ currentLevel: 100.5 }));
  const missingRule = createConstructionPlan(validInput({ rule: BUILDING_RULES.granja }));
  const invalidBaseDuration = createConstructionPlan(validInput({
    rule: { ...rule, baseDurationMs: 0 },
  }));
  const durationAtLevelTwo = durationForTargetLevel(testBaseDurationMs, 2);
  const durationAtLevelHundred = durationForTargetLevel(testBaseDurationMs, 100);
  const expectedLevelHundredDuration = Math.ceil(testBaseDurationMs * (1.01 ** 99));
  const missingPrerequisite = createConstructionPlan(validInput({
    rule: { ...rule, progressionRequirements: { universidad: 2 } },
  }));
  const satisfiedPrerequisite = createConstructionPlan(validInput({
    rule: { ...rule, progressionRequirements: { universidad: 2 } },
    buildingLevels: { universidad: 2 },
  }));

  const timed = { buildingType: "granja", targetLevel: 1, startedAt: 10_000, durationMs: 60_000, costs: { gold: 50, wood: 120 } };
  const progress = constructionProgress(timed, 40_000);
  const dueAtBoundary = isConstructionDue(timed, 70_000);
  const cancellation = calculateConstructionCancellationRefund({
    construction: timed,
    serverTimeMs: 40_000,
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
      test: "La duración aumenta aproximadamente un 1 % por nivel sin inventar tiempos base",
      passed: durationAtLevelTwo === 60_600 &&
        durationAtLevelHundred === expectedLevelHundredDuration,
      details: `Nivel 1 (fixture): ${testBaseDurationMs}; nivel 2: ${durationAtLevelTwo}; nivel 100: ${durationAtLevelHundred}.`,
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
      test: "Progreso y finalización dependen sólo del intervalo temporal calculado",
      passed: progress === 50 && !isConstructionDue(timed, 69_999) && dueAtBoundary,
      details: `Progreso 50%: ${progress === 50}; vencimiento exacto: ${dueAtBoundary}`,
    },
    {
      test: "Cancelar obra en curso reembolsa exactamente el 50%; una vencida no se cancela",
      passed: cancellation.success && cancellation.refund.gold === 25 &&
        cancellation.refund.wood === 60 && !cancellationAfterCompletion.success &&
        !cancellationBeforeStart.success,
      details: cancellation.success
        ? `Reembolso oro ${cancellation.refund.gold}, madera ${cancellation.refund.wood}; vencida/futura rechazadas: ${!cancellationAfterCompletion.success && !cancellationBeforeStart.success}`
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
      test: "No permite iniciar edificios sin valores oficiales configurados",
      passed: !missingRule.success && missingRule.error.includes("Costes de 'granja' pendientes de especificación oficial"),
      details: missingRule.success ? "Se inició con parámetros no documentados." : missingRule.error,
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
