/** Pruebas puras del sistema de misiones (sección 17 de CLAUDE.md). */
import { CIVILIZATIONS, MISSIONS } from "./balanceConfig";
import {
  activeProductionBonusMultiplier,
  allSecretMissions,
  currentStage,
  dailyKeyFor,
  emptyCounters,
  evaluateMissions,
  nextDailyResetAt,
  selectDailyMissions,
  stageProgressId,
  type MissionSnapshot,
} from "./missionRules";

export interface MissionTestResult {
  category: string;
  test: string;
  passed: boolean;
  details: string;
}

const CATEGORY = "MISIONES (P50, P51, decisión 2026-10-21)";

function snapshot(overrides: Partial<MissionSnapshot> = {}): MissionSnapshot {
  return {
    buildingLevels: { castillo: 1, viviendas: 20, granja: 11 },
    population: 2000,
    completedTechnologyIds: [],
    armySize: 0,
    happiness: 70,
    honor: 0,
    resources: { gold: 500 },
    territoriesOwned: 1,
    civilization: "romanos",
    lifetime: emptyCounters(),
    daily: emptyCounters(),
    ...overrides,
  };
}

export function runMissionTests(): MissionTestResult[] {
  const results: MissionTestResult[] = [];
  const add = (test: string, passed: boolean, details: string) => results.push({ category: CATEGORY, test, passed, details });

  // Catálogo: identificadores únicos y mismo número de secretas por civilización
  const allIds = [
    ...MISSIONS.STAGES.flatMap((s) => s.missions.map((m) => m.id)),
    ...MISSIONS.DAILY.CATALOG.map((m) => m.id),
    ...allSecretMissions().map((m) => m.id),
  ];
  const civSecrets = allSecretMissions().filter((m) => m.civilization);
  const perCiv = CIVILIZATIONS.map((civ) => civSecrets.filter((m) => m.civilization === civ.id).length);
  add(
    "Catálogo: identificadores únicos, etapas numeradas en orden y el mismo número de misiones secretas por civilización con la misma recompensa",
    new Set(allIds).size === allIds.length && MISSIONS.STAGES.every((s, i) => s.stage === i + 1) &&
      perCiv.every((n) => n === perCiv[0] && n >= 1) && civSecrets.every((m) => m.reward === MISSIONS.SECRET_PER_CIVILIZATION_REWARD),
    `${allIds.length} misiones (${MISSIONS.STAGES.length} etapas, ${MISSIONS.DAILY.CATALOG.length} diarias, ${allSecretMissions().length} secretas; ${perCiv[0]} por civilización)`
  );

  // Diarias: mismo conjunto para todos y reinicio por día
  const dayA = dailyKeyFor(Date.UTC(2026, 9, 23, 10));
  const dayB = dailyKeyFor(Date.UTC(2026, 9, 23, 23, 59));
  const dayC = dailyKeyFor(Date.UTC(2026, 9, 24, 0, 0));
  const pickA = selectDailyMissions(dayA).map((m) => m.id);
  const pickA2 = selectDailyMissions(dayA).map((m) => m.id);
  const differentSomeDay = ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"].some((d) => selectDailyMissions(d).map((m) => m.id).join() !== pickA.join());
  add(
    `Diarias: ${MISSIONS.DAILY.PER_DAY} misiones idénticas para todos, elegidas por fecha (reinicio ${MISSIONS.DAILY.RESET_UTC_HOUR}:00 UTC) y distintas entre días`,
    dayA === "2026-10-23" && dayB === dayA && dayC === "2026-10-24" && pickA.length === MISSIONS.DAILY.PER_DAY && new Set(pickA).size === pickA.length &&
      pickA.join() === pickA2.join() && differentSomeDay && nextDailyResetAt(Date.UTC(2026, 9, 23, 10)) === Date.UTC(2026, 9, 24, 0, 0),
    `Día ${dayA}: ${pickA.join(", ")}; 23:59 → ${dayB}; 00:00 → ${dayC}`
  );

  // Etapas: solo la etapa en curso se evalúa; la recompensa final llega al completarla
  const base = snapshot();
  const nothing = evaluateMissions(base, new Set(), dayA);
  const stage1Done = snapshot({ buildingLevels: { castillo: 2, viviendas: 20, granja: 11, cuartel: 1, taberna: 1, universidad: 1 }, lifetime: { ...emptyCounters(), troopsTrained: 10 } });
  const firstPass = evaluateMissions(stage1Done, new Set(), dayA);
  const stage1Ids = MISSIONS.STAGES[0].missions.map((m) => m.id);
  const gotStageReward = firstPass.some((c) => c.kind === "stageReward" && c.progressId === stageProgressId(1));
  const noStage2Yet = !firstPass.some((c) => c.stage === 2);
  const secondPass = evaluateMissions(stage1Done, new Set(firstPass.map((c) => c.progressId)), dayA);
  const stage2Castle = secondPass.filter((c) => c.kind === "stage").map((c) => c.progressId);
  add(
    "Etapas progresivas: sin cumplir nada no hay premios; al cumplir toda la etapa 1 se conceden sus misiones y el premio final, la etapa 2 no se evalúa hasta la siguiente pasada (y con Castillo 2 aún no cumple nada) y nada se repite",
    nothing.length === 0 && stage1Ids.every((id) => firstPass.some((c) => c.progressId === id)) && gotStageReward && noStage2Yet &&
      stage2Castle.join() === "" && currentStage(new Set([...stage1Ids]))?.stage === 2 && currentStage(new Set(allIds)) === null,
    `Primera pasada: ${firstPass.map((c) => c.progressId).join(", ")}; segunda: ${secondPass.map((c) => c.progressId).join(", ")}`
  );

  // Secretas: solo la de la propia civilización; las generales cuando se cumplen
  const romanTech = CIVILIZATIONS.find((c) => c.id === "romanos")!.uniqueTechnologyId;
  const secretSnap = snapshot({ completedTechnologyIds: [romanTech], happiness: 95, resources: { gold: 5000 } });
  const secrets = evaluateMissions(secretSnap, new Set(), dayA).filter((c) => c.kind === "secret").map((c) => c.progressId);
  const wrongCiv = evaluateMissions(snapshot({ completedTechnologyIds: [romanTech], civilization: "griegos" }), new Set(), dayA).filter((c) => c.kind === "secret");
  add(
    "Secretas: se conceden al cumplirse (felicidad 90, 5.000 oro) y la de civilización solo a la civilización correspondiente",
    secrets.includes("x_civ_romanos") && secrets.includes("x_felicidad") && secrets.includes("x_tesoro") && !secrets.includes("x_honor") && wrongCiv.length === 0,
    `Secretas concedidas: ${secrets.join(", ")}; con otra civilización: ${wrongCiv.length}`
  );

  // Diarias: contadores del día y registro único por día
  const todayPicks = selectDailyMissions(dayA);
  const dailyAll = snapshot({ daily: { ...emptyCounters(), buildingsCompleted: 1, troopsTrained: 20, researchStarted: 1, dailyBonusClaimed: 1, explorationsCompleted: 1, battlesFought: 1 } });
  const dailyDone = evaluateMissions(dailyAll, new Set(), dayA).filter((c) => c.kind === "daily");
  const dailyAgain = evaluateMissions(dailyAll, new Set(dailyDone.map((c) => c.progressId)), dayA).filter((c) => c.kind === "daily");
  const nextDay = evaluateMissions(dailyAll, new Set(dailyDone.map((c) => c.progressId)), dayC).filter((c) => c.kind === "daily");
  add(
    "Diarias: se completan con los contadores del día, no se repiten en el mismo día y vuelven a estar disponibles al día siguiente",
    dailyDone.length === todayPicks.length && dailyDone.every((c) => c.progressId.endsWith(dayA)) && dailyAgain.length === 0 && nextDay.length === selectDailyMissions(dayC).length,
    `Hoy: ${dailyDone.map((c) => c.progressId).join(", ")}; repetidas: ${dailyAgain.length}; mañana: ${nextDay.length}`
  );

  add(
    "Bonificación temporal de producción: se multiplican las vigentes y se ignoran las caducadas",
    Math.abs(activeProductionBonusMultiplier([{ multiplier: 1.05, expiresAt: 200 }, { multiplier: 1.1, expiresAt: 50 }], 100) - 1.05) < 1e-9 && activeProductionBonusMultiplier([], 0) === 1,
    `×1,05 vigente y ×1,10 caducada → ${activeProductionBonusMultiplier([{ multiplier: 1.05, expiresAt: 200 }, { multiplier: 1.1, expiresAt: 50 }], 100)}`
  );

  return results;
}
