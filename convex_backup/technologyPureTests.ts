import {
  TECHNOLOGY_CATALOG,
  calculateResearchCancellationRefund,
  computeTechnologyModifiers,
  createResearchPlan,
  evaluateTechnologyStatus,
  researchSlots,
  type ResearchQueueEntry,
} from "./technologyRules";
import { TECHNOLOGIES } from "./balanceConfig";
import type { ResourceType } from "./economyCalculations";

export interface TechnologyTestResult {
  test: string;
  passed: boolean;
  details: string;
}

const richResources: Record<ResourceType, number> = { gold: 10_000, wood: 10_000, stone: 10_000, iron: 10_000, food: 10_000 };

export function runTechnologyValidationTests(): TechnologyTestResult[] {
  const base = {
    resources: { ...richResources },
    completedIds: [] as string[],
    activeResearch: [] as ResearchQueueEntry[],
    buildingLevels: { castillo: 2, universidad: 1 } as Record<string, number>,
    now: 5_000_000,
  };
  const agri = createResearchPlan({ ...base, technologyId: "agri_1" });
  const unknown = createResearchPlan({ ...base, technologyId: "magia" });
  const needsUniversity2 = createResearchPlan({ ...base, technologyId: "espionage_1" });
  const espionageOpen = createResearchPlan({ ...base, technologyId: "espionage_1", buildingLevels: { castillo: 2, universidad: 2 } });
  const chainLocked = createResearchPlan({ ...base, technologyId: "espionage_2", buildingLevels: { castillo: 5, universidad: 4 } });
  const chainOpen = createResearchPlan({ ...base, technologyId: "espionage_2", buildingLevels: { castillo: 5, universidad: 4 }, completedIds: ["espionage_1"] });
  const poor = createResearchPlan({ ...base, technologyId: "agri_1", resources: { ...richResources, gold: 99 } });
  const active: ResearchQueueEntry = { technologyId: "mining_1", startedAt: 0, durationMs: 1000, costs: {} };
  const slotFull = createResearchPlan({ ...base, technologyId: "agri_1", activeResearch: [active] });
  const secondSlot = createResearchPlan({ ...base, technologyId: "agri_1", activeResearch: [active], buildingLevels: { castillo: 3, universidad: 3 } });
  const duplicate = createResearchPlan({ ...base, technologyId: "mining_1", activeResearch: [active] });
  const alreadyDone = createResearchPlan({ ...base, technologyId: "agri_1", completedIds: ["agri_1"] });

  const entry: ResearchQueueEntry = { technologyId: "agri_1", startedAt: 5_000_000, durationMs: 86_400_000, costs: { gold: 100, wood: 100, stone: 50 } };
  const cancelMid = calculateResearchCancellationRefund({ entry, serverTimeMs: 50_000_000 });
  const cancelDone = calculateResearchCancellationRefund({ entry, serverTimeMs: 5_000_000 + 86_400_000 });

  const modifiers = computeTechnologyModifiers(["agri_1", "agri_1", "mining_1", "training_1", "construction_1", "medicine_1", "medical_2", "weapons_1", "espionage_1", "happiness_1"]);
  const capped = computeTechnologyModifiers(["medicine_1", "medical_2", "medicine_1"]);
  const status = evaluateTechnologyStatus({
    technology: TECHNOLOGY_CATALOG.weapons_1,
    completedIds: new Set(),
    researchingIds: new Set(),
    buildingLevels: { castillo: 5, universidad: 3, herreria: 3 },
  });

  return [
    {
      test: "Investigación válida descuenta el coste del catálogo y fija fin por duración real (D-17)",
      passed: agri.success && agri.plan.costs.gold === 100 && agri.plan.costs.wood === 100 && agri.plan.costs.stone === 50 &&
        agri.plan.durationMs === 86_400_000 && agri.plan.completesAt === 5_000_000 + 86_400_000 && !unknown.success,
      details: agri.success ? `Oro ${agri.plan.costs.gold}, duración ${agri.plan.durationMs} ms; desconocida rechazada: ${!unknown.success}` : agri.error,
    },
    {
      test: "Requisitos: nivel de Universidad, edificios y tecnologías previas (D-19)",
      passed: !needsUniversity2.success && espionageOpen.success && !chainLocked.success && chainOpen.success &&
        status.status === "locked" && status.blockers.some((b) => b.includes("Herrería")),
      details: `Espionaje I con Universidad 1 bloqueada: ${!needsUniversity2.success}; con Universidad 2: ${espionageOpen.success}; Espionaje II sin I: ${!chainLocked.success}; con I: ${chainOpen.success}; bloqueos de Metalurgia: ${status.blockers.join(" | ")}`,
    },
    {
      test: "Ranuras (D-20, M-03): 1 con Universidad 1-2, 2 con Universidad 3-4, 3 con Universidad 5+; sin duplicados ni repetir completadas",
      passed: researchSlots(0) === 1 && researchSlots(2) === 1 && researchSlots(3) === 2 && researchSlots(5) === 3 && researchSlots(10) === 3 &&
        !slotFull.success && secondSlot.success && !duplicate.success && !alreadyDone.success && !poor.success,
      details: `Ranuras Universidad 0/2/3/5/10: ${[0, 2, 3, 5, 10].map(researchSlots).join("/")}; ranura ocupada rechazada: ${!slotFull.success}; segunda ranura con Universidad 3: ${secondSlot.success}; duplicada: ${!duplicate.success}; completada: ${!alreadyDone.success}; sin oro: ${!poor.success}`,
    },
    {
      test: "Cancelación reembolsa el 50 % antes de completar (uniforme con construcción y entrenamiento)",
      passed: cancelMid.success && cancelMid.refund.gold === 50 && cancelMid.refund.wood === 50 && cancelMid.refund.stone === 25 && !cancelDone.success,
      details: cancelMid.success ? `Reembolso oro ${cancelMid.refund.gold}, madera ${cancelMid.refund.wood}, piedra ${cancelMid.refund.stone}; completada rechazada: ${!cancelDone.success}` : cancelMid.error,
    },
    {
      test: "Efectos idempotentes (D-18): una tecnología repetida cuenta una vez; recuperación de heridos con tope 60 %",
      passed: Math.abs(modifiers.agricultureProduction - 1.05) < 1e-9 && Math.abs(modifiers.miningProduction - 1.05) < 1e-9 &&
        Math.abs(modifiers.trainingDuration - 0.95) < 1e-9 && Math.abs(modifiers.constructionDuration - 0.95) < 1e-9 &&
        Math.abs(modifiers.woundedRecoveryBonus - 0.15) < 1e-9 && modifiers.espionageLevel === 1 && modifiers.happinessBase === 3 &&
        modifiers.unlockedWeapons.includes("acero") && Math.abs(capped.woundedRecoveryBonus - 0.15) < 1e-9,
      details: `Agricultura ×${modifiers.agricultureProduction}; minería ×${modifiers.miningProduction}; entrenamiento ×${modifiers.trainingDuration}; construcción ×${modifiers.constructionDuration}; heridos +${modifiers.woundedRecoveryBonus}; espionaje ${modifiers.espionageLevel}; felicidad +${modifiers.happinessBase}`,
    },
    {
      test: "El catálogo contiene las tecnologías universales y únicas (P62) con ramas, costes y duraciones positivas",
      passed: TECHNOLOGIES.length === 25 && TECHNOLOGIES.every((t) => t.durationSeconds > 0 && t.universityLevel >= 1 && Object.values(t.costs).every((c) => c >= 0)),
      details: `Total tecnologías: ${TECHNOLOGIES.length} (13 universales + 12 de civilización)`,
    },
  ];
}
