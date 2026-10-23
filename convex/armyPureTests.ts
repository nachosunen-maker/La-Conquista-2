import {
  availableMilitaryLevels,
  calculateTrainingCancellation,
  createTrainingPlan,
  summarizeArmy,
  trainingDurationMs,
  trainingQueueSlots,
  validateEquipmentSelection,
  availableMercenaryTypes,
  derivedMercenaryPrice,
  validateMercenaryHire,
  type TrainingQueueEntry,
} from "./armyRules";
import { MERCENARIES, UNITS } from "./balanceConfig";
import type { ResourceType } from "./economyCalculations";

export interface ArmyTestResult {
  test: string;
  passed: boolean;
  details: string;
}

const richResources: Record<ResourceType, number> = { gold: 10_000, wood: 10_000, stone: 10_000, iron: 10_000, food: 10_000 };

function baseInput(overrides: Partial<Parameters<typeof createTrainingPlan>[0]> = {}) {
  return {
    unitType: "infanteria",
    count: 10,
    level: 1,
    resources: { ...richResources },
    availableCivil: 100,
    buildingLevels: { castillo: 3, cuartel: 1 } as Record<string, number>,
    activeTraining: [] as TrainingQueueEntry[],
    now: 1_000_000,
    ...overrides,
  };
}

export function runArmyValidationTests(): ArmyTestResult[] {
  const valid = createTrainingPlan(baseInput());
  const noBarracks = createTrainingPlan(baseInput({ buildingLevels: { castillo: 3 } }));
  const noCivil = createTrainingPlan(baseInput({ availableCivil: 9 }));
  const noGold = createTrainingPlan(baseInput({ resources: { ...richResources, gold: 49 } }));
  const cavalryLocked = createTrainingPlan(baseInput({ unitType: "caballeria" }));
  const cavalryOpen = createTrainingPlan(baseInput({ unitType: "caballeria", buildingLevels: { castillo: 3, cuartel: 2, herreria: 1 } }));
  const siege = createTrainingPlan(baseInput({ unitType: "asedio", count: 2, buildingLevels: { castillo: 3, cuartel: 3, herreria: 2 }, availableCivil: 10 }));
  const siegeNoOperators = createTrainingPlan(baseInput({ unitType: "asedio", count: 2, buildingLevels: { castillo: 3, cuartel: 3, herreria: 2 }, availableCivil: 9 }));
  const levelTwoLocked = createTrainingPlan(baseInput({ level: 2, buildingLevels: { castillo: 1, cuartel: 2 } }));
  const levelTwoOpen = createTrainingPlan(baseInput({ level: 2, buildingLevels: { castillo: 2, cuartel: 2 } }));
  const invalidLevel = createTrainingPlan(baseInput({ level: 6 }));
  const activeOne: TrainingQueueEntry = { unitType: "arqueria", count: 5, level: 1, startedAt: 0, durationMs: 1000, costs: {}, populationReserved: 5 };
  const queueFull = createTrainingPlan(baseInput({ activeTraining: [activeOne] }));
  const queueExtra = createTrainingPlan(baseInput({ activeTraining: [activeOne], buildingLevels: { castillo: 3, cuartel: 3 } }));
  const withDoctrine = trainingDurationMs("infanteria", 10, 0.95);
  const floorDuration = trainingDurationMs("infanteria", 10, 0.1);

  const entry: TrainingQueueEntry = { unitType: "infanteria", count: 10, level: 1, startedAt: 1_000_000, durationMs: 18_000_000, costs: { gold: 50, iron: 20, food: 20 }, populationReserved: 10 };
  const cancelMid = calculateTrainingCancellation({ entry, serverTimeMs: 10_000_000 });
  const cancelDone = calculateTrainingCancellation({ entry, serverTimeMs: 19_000_000 });

  const summary = summarizeArmy([
    { unitType: "infanteria", level: 1, count: 100, wounded: 10 },
    { unitType: "infanteria", level: 3, count: 100 },
    { unitType: "asedio", count: 4 },
    { unitType: "regular", count: 20 },
  ]);
  const levels = availableMilitaryLevels({ castillo: 4, cuartel: 3, universidad: 2 }).map((l) => l.level);

  const equipmentLocked = validateEquipmentSelection({ weaponTier: "acero", armorTier: "ninguna", strategy: "agresiva", buildingLevels: { herreria: 4 }, unlockedWeapons: [], unlockedArmors: [] });
  const equipmentOpen = validateEquipmentSelection({ weaponTier: "acero", armorTier: "piel", strategy: "agresiva", buildingLevels: { herreria: 4 }, unlockedWeapons: ["acero"], unlockedArmors: [] });

  // Mercenarios por tipo (decisión 21-10-2026)
  const priceTableMatchesFormula = MERCENARIES.TYPES.every((type) => derivedMercenaryPrice(type.unitType, type.level) === type.goldPerUnit);
  const pricesVary = Math.min(...MERCENARIES.TYPES.map((t) => t.goldPerUnit)) < MERCENARIES.GOLD_PER_UNIT && Math.max(...MERCENARIES.TYPES.map((t) => t.goldPerUnit)) > MERCENARIES.GOLD_PER_UNIT;
  const tavern1 = availableMercenaryTypes(1).map((t) => t.id);
  const tavern5 = availableMercenaryTypes(5).length;
  const hireLocked = validateMercenaryHire({ typeId: "jinetes", count: 5, tavernLevel: 2, activeMercenaries: 0, gold: 10_000 });
  const hireOk = validateMercenaryHire({ typeId: "jinetes", count: 5, tavernLevel: 3, activeMercenaries: 0, gold: 10_000 });
  const hireFull = validateMercenaryHire({ typeId: "mesnada", count: 60, tavernLevel: 1, activeMercenaries: 0, gold: 10_000 });
  const hireDefault = validateMercenaryHire({ typeId: undefined, count: 5, tavernLevel: 1, activeMercenaries: 0, gold: 125 });
  const hirePoor = validateMercenaryHire({ typeId: undefined, count: 5, tavernLevel: 1, activeMercenaries: 0, gold: 124 });

  return [
    {
      test: "Mercenarios por tipo (decisión 21-10-2026): la tabla de precios sigue la fórmula derivada del anclaje de 25 oro, hay tipos más baratos y más caros, y el nivel de Taberna los desbloquea",
      passed: priceTableMatchesFormula && pricesVary && tavern1.join(",") === "mesnada,lanceros" && tavern5 === MERCENARIES.TYPES.length && availableMercenaryTypes(0).length === 0,
      details: `Precios: ${MERCENARIES.TYPES.map((t) => `${t.label} ${t.goldPerUnit}`).join(" · ")}; fórmula coincide: ${priceTableMatchesFormula}; Taberna 1: ${tavern1.join("/")}; Taberna 5: ${tavern5} tipos`,
    },
    {
      test: "Contratar mercenarios: exige el nivel de Taberna del tipo, respeta el tope común de 50 por nivel, usa lanceros por defecto y cobra el precio del tipo",
      passed: !hireLocked.success && hireOk.success && hireOk.cost === 375 && !hireFull.success && hireDefault.success && hireDefault.type.id === "lanceros" && hireDefault.cost === 125 && !hirePoor.success,
      details: `Jinetes con Taberna 2: ${hireLocked.success ? "aceptado" : hireLocked.error}; con Taberna 3: coste ${hireOk.success ? hireOk.cost : "rechazado"}; 60 con Taberna 1: ${hireFull.success ? "aceptado" : "rechazado"}; por defecto ${hireDefault.success ? hireDefault.type.id : "rechazado"}; sin oro: ${!hirePoor.success}`,
    },
    {
      test: "Entrenamiento válido: coste unitario × cantidad, duración lineal (D-08) y población civil reservada",
      passed: valid.success && valid.plan.costs.gold === 50 && valid.plan.costs.iron === 20 && valid.plan.costs.food === 20 &&
        valid.plan.durationMs === UNITS.infanteria.trainingSecondsPerUnit * 1000 * 10 &&
        valid.plan.populationReserved === 10 && valid.plan.completesAt === 1_000_000 + valid.plan.durationMs,
      details: valid.success ? `Oro ${valid.plan.costs.gold}, duración ${valid.plan.durationMs} ms, población ${valid.plan.populationReserved}` : valid.error,
    },
    {
      test: "Sin Cuartel no se entrena; sin civiles libres o sin recursos se rechaza (P54, decisión posterior)",
      passed: !noBarracks.success && !noCivil.success && noCivil.error.includes("civil libre") && !noGold.success,
      details: `Sin cuartel: ${!noBarracks.success}; civiles insuficientes: ${!noCivil.success}; oro insuficiente: ${!noGold.success}`,
    },
    {
      test: "Requisitos por unidad: caballería exige Cuartel 2 + Herrería 1; asedio reserva 5 operadores por pieza (D-12)",
      passed: !cavalryLocked.success && cavalryOpen.success && siege.success && siege.plan.populationReserved === 10 && !siegeNoOperators.success,
      details: `Caballería bloqueada/abierta: ${!cavalryLocked.success}/${cavalryOpen.success}; asedio 2 piezas reserva ${siege.success ? siege.plan.populationReserved : siege.error}; sin operadores rechazado: ${!siegeNoOperators.success}`,
    },
    {
      test: "Niveles militares P23/P29: nivel 2 exige Castillo 2 + Cuartel 2; nivel fuera de 1-5 rechazado",
      passed: !levelTwoLocked.success && levelTwoOpen.success && levelTwoOpen.plan.level === 2 && !invalidLevel.success &&
        levels.join(",") === "1,2,3",
      details: `Nivel 2 bloqueado/abierto: ${!levelTwoLocked.success}/${levelTwoOpen.success}; nivel 6 rechazado: ${!invalidLevel.success}; niveles con Castillo 4 + Cuartel 3 + Universidad 2: ${levels.join(",")}`,
    },
    {
      test: "Colas de entrenamiento (D-09): 1 con Cuartel 1-2, 2 con Cuartel 3, máximo 4",
      passed: trainingQueueSlots(0) === 0 && trainingQueueSlots(1) === 1 && trainingQueueSlots(2) === 1 && trainingQueueSlots(3) === 2 &&
        trainingQueueSlots(9) === 4 && trainingQueueSlots(50) === 4 && !queueFull.success && queueExtra.success,
      details: `Ranuras 0/1/2/3/9/50: ${[0, 1, 2, 3, 9, 50].map(trainingQueueSlots).join("/")}; cola llena rechazada: ${!queueFull.success}; segunda cola con Cuartel 3: ${queueExtra.success}`,
    },
    {
      test: "Modificador tecnológico de duración con suelo del 50 %",
      passed: withDoctrine === Math.ceil(1_800_000 * 10 * 0.95) && floorDuration === Math.ceil(1_800_000 * 10 * 0.5),
      details: `Con doctrina: ${withDoctrine}; con suelo: ${floorDuration}`,
    },
    {
      test: "Cancelación (D-10): 50 % de recursos, población íntegra; lote completado no se cancela",
      passed: cancelMid.success && cancelMid.refund.gold === 25 && cancelMid.refund.iron === 10 && cancelMid.refund.food === 10 &&
        cancelMid.populationReturned === 10 && !cancelDone.success,
      details: cancelMid.success ? `Reembolso oro ${cancelMid.refund.gold}, hierro ${cancelMid.refund.iron}; población ${cancelMid.populationReturned}; completado rechazado: ${!cancelDone.success}` : cancelMid.error,
    },
    {
      test: "Resumen del ejército: niveles ponderados, heridos aparte, operadores de asedio y tabla heredada 'regular' como infantería",
      passed: summary.totalActive === 224 && summary.totalWounded === 10 && summary.siegeMachines === 4 && summary.siegeOperators === 20 &&
        summary.livingSoldiers === 240 && summary.byType.infanteria.active === 220 &&
        Math.abs(summary.trainingMultiplier - ((100 * 1 + 100 * 1.35 + 4 * 1 + 20 * 1) / 224)) < 1e-9,
      details: `Activos ${summary.totalActive}, heridos ${summary.totalWounded}, máquinas ${summary.siegeMachines}, operadores ${summary.siegeOperators}, vivos ${summary.livingSoldiers}, multiplicador ${summary.trainingMultiplier.toFixed(4)}`,
    },
    {
      test: "Equipamiento (P30/P31): el acero exige tecnología además de Herrería 4",
      passed: !equipmentLocked.success && equipmentOpen.success && equipmentOpen.weaponTier === "acero" && equipmentOpen.armorTier === "piel",
      details: `Acero sin tecnología rechazado: ${!equipmentLocked.success}; con tecnología aceptado: ${equipmentOpen.success}`,
    },
  ];
}
