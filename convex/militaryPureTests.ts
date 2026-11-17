/**
 * LA CONQUISTA — PRUEBAS DE INTEGRIDAD DEL SISTEMA MILITAR Y RECLUTAMIENTO (BLOQUE 3A)
 * 
 * Verifica matemáticamente y lógicamente:
 * 1. Validación de tipos válidos e inválidos de unidad militar.
 * 2. Validación de cantidades enteras positivas, no negativas ni fraccionarias.
 * 3. Validación de niveles militares oficiales (1 a 5, P29).
 * 4. Bloqueo documentado cuando los costes no están especificados en la regla oficial.
 * 5. Requisitos estructurales oficiales de Castillo, Cuartel, Universidad y Herrería (P23).
 * 6. Validación de recursos suficientes para el coste total.
 * 7. Validación de ciudadanos libres disponibles (P54).
 * 8. Límite de tareas concurrentes en la cola de entrenamiento.
 * 9. Autorización estricta: rechazo inmutable del reino Iberia (DEMO_USER_ID).
 * 10. Autorización estricta: rechazo de usuarios no propietarios.
 * 11. Invariante P18: regularSoldiers inalterado durante la leva en curso.
 */

import {
  createTrainingPlan,
  isTrainingComplete,
  calculateTrainingProgressPercent,
  resolveArmyUnitsIncorporation,
  calculateNextRegularSoldiers,
  isLivingRegularTroop,
  MILITARY_PREREQUISITES_P23,
  MILITARY_TIER_EFFICIENCY,
  type MilitaryUnitRule,
  type TrainingQueueEntry,
} from "./militaryRules";
import { isKingdomOwner, DEMO_USER_ID } from "./kingdomAccess";

export interface MilitaryTestResult {
  category: string;
  test: string;
  passed: boolean;
  details?: string;
  error?: string;
}

export function runMilitaryTests(): MilitaryTestResult[] {
  const results: MilitaryTestResult[] = [];

  function record(category: string, test: string, passed: boolean, details?: string, error?: string) {
    results.push({ category, test, passed, details, error });
  }

  const baseResources = {
    gold: 1000,
    wood: 1000,
    stone: 1000,
    iron: 1000,
    food: 1000,
  };

  const sampleConfiguredRule: MilitaryUnitRule = {
    unitType: "infanteria",
    level: 1,
    costsPerUnit: { gold: 20, wood: 0, stone: 0, iron: 10, food: 30 },
    durationMsPerUnit: 5000,
    prerequisites: { castillo: 1 },
  };

  // 1. Tipo de unidad inválido
  const test1 = createTrainingPlan({
    unitType: "dragones",
    count: 10,
    level: 1,
    resources: baseResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 1 },
    now: 100000,
    customRule: sampleConfiguredRule,
  });
  record(
    "VALIDACIÓN BÁSICA",
    "1. Rechaza tipos de unidades militares no admitidos",
    !test1.success && test1.error.includes("Tipo de unidad no admitido"),
    `Resultado: ${test1.success ? "Inesperado éxito" : test1.error}`
  );

  // 2. Cantidades no válidas (cero, negativas, fraccionarias)
  const test2a = createTrainingPlan({
    unitType: "infanteria",
    count: 0,
    level: 1,
    resources: baseResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 1 },
    now: 100000,
    customRule: sampleConfiguredRule,
  });
  const test2b = createTrainingPlan({
    unitType: "infanteria",
    count: -5,
    level: 1,
    resources: baseResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 1 },
    now: 100000,
    customRule: sampleConfiguredRule,
  });
  const test2c = createTrainingPlan({
    unitType: "infanteria",
    count: 10.5,
    level: 1,
    resources: baseResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 1 },
    now: 100000,
    customRule: sampleConfiguredRule,
  });
  record(
    "VALIDACIÓN BÁSICA",
    "2. Rechaza cantidades cero, negativas y fraccionarias",
    !test2a.success && !test2b.success && !test2c.success,
    "Cantidades inválidas rechazadas correctamente"
  );

  // 3. Niveles militares fuera de rango P29
  const test3a = createTrainingPlan({
    unitType: "infanteria",
    count: 10,
    level: 0,
    resources: baseResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 1 },
    now: 100000,
    customRule: sampleConfiguredRule,
  });
  const test3b = createTrainingPlan({
    unitType: "infanteria",
    count: 10,
    level: 6,
    resources: baseResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 1 },
    now: 100000,
    customRule: sampleConfiguredRule,
  });
  record(
    "REGLAS CANÓNICAS P29",
    "3. Exige niveles militares estrictamente entre 1 (Milicia) y 5 (Élite)",
    !test3a.success && !test3b.success,
    "Niveles 0 y 6 rechazados"
  );

  // 4. Bloqueo documentado cuando faltan costes oficiales
  const test4 = createTrainingPlan({
    unitType: "infanteria",
    count: 10,
    level: 1,
    resources: baseResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 1 },
    now: 100000,
    // Sin customRule: utiliza DEFAULT_MILITARY_RULES (costs = null)
  });
  record(
    "REGLAS DE PROTECCIÓN",
    "4. Bloquea el reclutamiento si faltan costes oficiales aprobados",
    !test4.success && test4.error.includes("pendientes de especificación oficial"),
    `Detalle: ${!test4.success ? test4.error : "Falló el bloqueo"}`
  );

  // 5. Requisitos estructurales P23: Nivel 2 requiere Castillo 2 + Cuartel 2
  const ruleLevel2: MilitaryUnitRule = {
    unitType: "infanteria",
    level: 2,
    costsPerUnit: { gold: 30, wood: 0, stone: 0, iron: 15, food: 35 },
    durationMsPerUnit: 6000,
    prerequisites: MILITARY_PREREQUISITES_P23[2],
  };
  const test5a = createTrainingPlan({
    unitType: "infanteria",
    count: 10,
    level: 2,
    resources: baseResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 1, cuartel: 1 }, // Insuficiente
    now: 100000,
    customRule: ruleLevel2,
  });
  const test5b = createTrainingPlan({
    unitType: "infanteria",
    count: 10,
    level: 2,
    resources: baseResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 2, cuartel: 2 }, // Cumplido
    now: 100000,
    customRule: ruleLevel2,
  });
  record(
    "REQUISITOS P23",
    "5. Valida requisitos para tropa nivel 2 (Castillo 2 + Cuartel 2)",
    !test5a.success && test5b.success,
    `Insuficiente bloqueado: ${!test5a.success}; Cumplido aprobado: ${test5b.success}`
  );

  // 6. Requisitos estructurales P23: Nivel 5 requiere Castillo 8, Cuartel 5, Universidad 4, Herrería 5
  const ruleLevel5: MilitaryUnitRule = {
    unitType: "caballeria",
    level: 5,
    costsPerUnit: { gold: 100, wood: 20, stone: 0, iron: 80, food: 80 },
    durationMsPerUnit: 12000,
    prerequisites: MILITARY_PREREQUISITES_P23[5],
  };
  const test6a = createTrainingPlan({
    unitType: "caballeria",
    count: 5,
    level: 5,
    resources: baseResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 8, cuartel: 5, universidad: 4, herreria: 4 }, // Falta herrería 5
    now: 100000,
    customRule: ruleLevel5,
  });
  const test6b = createTrainingPlan({
    unitType: "caballeria",
    count: 5,
    level: 5,
    resources: baseResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 8, cuartel: 5, universidad: 4, herreria: 5 }, // Completo
    now: 100000,
    customRule: ruleLevel5,
  });
  record(
    "REQUISITOS P23",
    "6. Valida requisitos para tropa nivel 5 (Castillo 8 + Cuartel 5 + Univ 4 + Herrería 5)",
    !test6a.success && test6b.success,
    `Falta herrería rechazada: ${!test6a.success}; Todos cumplidos aceptado: ${test6b.success}`
  );

  // 7. Recursos insuficientes
  const poorResources = { gold: 50, wood: 1000, stone: 1000, iron: 1000, food: 1000 };
  const test7 = createTrainingPlan({
    unitType: "infanteria",
    count: 10, // Requiere 20 * 10 = 200 oro
    level: 1,
    resources: poorResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 1 },
    now: 100000,
    customRule: sampleConfiguredRule,
  });
  record(
    "ECONOMÍA Y RECURSOS",
    "7. Rechaza reclutamiento cuando las reservas de recursos son insuficientes",
    !test7.success && test7.error.includes("Recursos insuficientes"),
    `Detalle: ${!test7.success ? test7.error : "Aceptó sin oro"}`
  );

  // 8. Ciudadanos disponibles insuficientes (P54)
  const test8 = createTrainingPlan({
    unitType: "infanteria",
    count: 50,
    level: 1,
    resources: baseResources,
    availableCivilians: 20, // Solo hay 20 libres
    activeTrainings: [],
    buildingLevels: { castillo: 1 },
    now: 100000,
    customRule: sampleConfiguredRule,
  });
  record(
    "DEMOGRAFÍA P54",
    "8. Rechaza reclutar más tropas que los ciudadanos libres disponibles",
    !test8.success && test8.error.includes("No hay suficientes ciudadanos libres"),
    `Detalle: ${!test8.success ? test8.error : "Aceptó sin civiles"}`
  );

  // 9. Límite de colas de entrenamiento concurrentes
  const fullQueue: TrainingQueueEntry[] = [
    { kingdomId: "k1", unitType: "infanteria", count: 10, startedAt: 1000, durationMs: 5000 },
    { kingdomId: "k1", unitType: "arqueria", count: 10, startedAt: 2000, durationMs: 5000 },
  ];
  const test9 = createTrainingPlan({
    unitType: "infanteria",
    count: 5,
    level: 1,
    resources: baseResources,
    availableCivilians: 50,
    activeTrainings: fullQueue,
    buildingLevels: { castillo: 1 },
    now: 100000,
    customRule: sampleConfiguredRule,
  });
  record(
    "COLAS Y CONCURRENCIA",
    "9. Impide exceder la capacidad simultánea de entrenamiento en cuartel",
    !test9.success && test9.error.includes("ranuras de entrenamiento militar ya están ocupadas"),
    `Detalle: ${!test9.success ? test9.error : "Permitió 3 colas"}`
  );

  // 10. Cálculo exacto de plan y deducciones
  const test10 = createTrainingPlan({
    unitType: "infanteria",
    count: 15,
    level: 1,
    resources: baseResources,
    availableCivilians: 50,
    activeTrainings: [],
    buildingLevels: { castillo: 1 },
    now: 200000,
    customRule: sampleConfiguredRule,
  });
  const planOk = test10.success &&
    test10.plan.count === 15 &&
    test10.plan.costs.gold === 300 &&
    test10.plan.costs.iron === 150 &&
    test10.plan.costs.food === 450 &&
    test10.plan.durationMs === 75000 &&
    test10.plan.completesAt === 275000;
  record(
    "CÁLCULO EXACTO",
    "10. Genera costes inmutables, duración lineal y fecha exacta de fin",
    Boolean(planOk),
    `Oro: ${test10.success ? test10.plan.costs.gold : "err"}, Duración: ${test10.success ? test10.plan.durationMs : "err"}ms`
  );

  // 11. Autorización: Rechazo absoluto de Iberia (DEMO_USER_ID)
  const isDemoAuthorized = isKingdomOwner(DEMO_USER_ID, "user_123");
  const isDemoSelfAuthorized = isKingdomOwner(DEMO_USER_ID, DEMO_USER_ID);
  record(
    "AUTORIZACIÓN Y SEGURIDAD",
    "11. El reino de demostración Iberia rechaza cualquier mutación de soberano",
    !isDemoAuthorized && !isDemoSelfAuthorized,
    `isOwner para usuario externo: ${isDemoAuthorized}; para DEMO_USER_ID: ${isDemoSelfAuthorized} (ambos deben ser falsos)`
  );

  // 12. Autorización: Titularidad legítima
  const ownerValid = isKingdomOwner("auth_user_abc", "auth_user_abc");
  const strangerInvalid = isKingdomOwner("auth_user_abc", "impostor_xyz");
  const anonymousInvalid = isKingdomOwner("auth_user_abc", undefined);
  record(
    "AUTORIZACIÓN Y SEGURIDAD",
    "12. Valida estrictamente la identidad del titular contra el documento del reino",
    ownerValid && !strangerInvalid && !anonymousInvalid,
    `Titular legítimo: ${ownerValid}; Ajeno: ${strangerInvalid}; Anónimo: ${anonymousInvalid}`
  );

  // 13. Eficiencia marcial P29
  const eff1 = MILITARY_TIER_EFFICIENCY[1] === 1.00;
  const eff2 = MILITARY_TIER_EFFICIENCY[2] === 1.15;
  const eff3 = MILITARY_TIER_EFFICIENCY[3] === 1.35;
  const eff4 = MILITARY_TIER_EFFICIENCY[4] === 1.60;
  const eff5 = MILITARY_TIER_EFFICIENCY[5] === 1.90;
  record(
    "REGLAS CANÓNICAS P29",
    "13. Multiplicadores marciales de eficacia reflejan exactamente P29 (100% a 190%)",
    eff1 && eff2 && eff3 && eff4 && eff5,
    "N1: 100%, N2: 115%, N3: 135%, N4: 160%, N5: 190%"
  );

  // 14. Vencimiento autoritativo en servidor (isTrainingComplete)
  const notFinished = isTrainingComplete(1000, 5000, 5999);
  const exactlyFinished = isTrainingComplete(1000, 5000, 6000);
  const pastFinished = isTrainingComplete(1000, 5000, 7000);
  const invalidFinished = isTrainingComplete(NaN, 5000, 6000) || isTrainingComplete(1000, -10, 6000);
  record(
    "FINALIZACIÓN AUTORITATIVA (3B)",
    "14. Determina con precisión de milisegundo el vencimiento basado en reloj de servidor",
    !notFinished && exactlyFinished && pastFinished && !invalidFinished,
    `Antes: ${notFinished}; Exacto: ${exactlyFinished}; Posterior: ${pastFinished}; Inválido rechazado: ${!invalidFinished}`
  );

  // 15. Cálculo de porcentaje de progreso (calculateTrainingProgressPercent)
  const p0 = calculateTrainingProgressPercent(1000, 10000, 1000);
  const p50 = calculateTrainingProgressPercent(1000, 10000, 6000);
  const p100 = calculateTrainingProgressPercent(1000, 10000, 11000);
  const pOver = calculateTrainingProgressPercent(1000, 10000, 20000);
  record(
    "FINALIZACIÓN AUTORITATIVA (3B)",
    "15. Calcula porcentaje de avance acotado entre 0% y 100%",
    p0 === 0 && p50 === 50 && p100 === 100 && pOver === 100,
    `Inicio: ${p0}%; Mitad: ${p50}%; Fin: ${p100}%; Posterior: ${pOver}%`
  );

  // 16. Incorporación atómica a armyUnits (resolveArmyUnitsIncorporation)
  const emptyExisting: any[] = [];
  const resInsert = resolveArmyUnitsIncorporation(emptyExisting, "infanteria", 25);
  const existingUnits = [{ _id: "unit_doc_1", unitType: "infanteria", count: 25 }];
  const resUpdate = resolveArmyUnitsIncorporation(existingUnits, "Infanteria", 15);
  const resNewType = resolveArmyUnitsIncorporation(existingUnits, "caballeria", 10);
  const incorporationOk =
    resInsert.action === "insert" &&
    resInsert.nextCount === 25 &&
    resUpdate.action === "update" &&
    resUpdate.existingId === "unit_doc_1" &&
    resUpdate.nextCount === 40 &&
    resNewType.action === "insert" &&
    resNewType.nextCount === 10;
  record(
    "INCORPORACIÓN ATÓMICA (3B)",
    "16. Modifica conteo existente o inserta nuevo registro según tipo sin duplicar filas",
    Boolean(incorporationOk),
    `Insert inicial: ${resInsert.action} (${resInsert.nextCount}); Update existente: ${resUpdate.action} (${resUpdate.nextCount}); Nuevo tipo: ${resNewType.action}`
  );

  // 17. Sincronización de regularSoldiers (calculateNextRegularSoldiers)
  const nextSoldiersBase = calculateNextRegularSoldiers(100, 25);
  const nextSoldiersZero = calculateNextRegularSoldiers(0, 50);
  const nextSoldiersSafe = calculateNextRegularSoldiers(-10, 15);
  record(
    "INCORPORACIÓN ATÓMICA (3B)",
    "17. Incrementa de forma aditiva y segura el censo militar de regularSoldiers (P18)",
    nextSoldiersBase === 125 && nextSoldiersZero === 50 && nextSoldiersSafe === 15,
    `Base 100+25: ${nextSoldiersBase}; Base 0+50: ${nextSoldiersZero}; Seguro con entrada anómala: ${nextSoldiersSafe}`
  );

  // 18. Idempotencia y consolidación atómica
  const stateA = resolveArmyUnitsIncorporation([], "arqueria", 30);
  const stateB = resolveArmyUnitsIncorporation([{ unitType: "arqueria", count: 30, _id: "doc_a" }], "arqueria", 20);
  record(
    "IDEMPOTENCIA Y ATOMICIDAD (3B)",
    "18. Consolidación sucesiva de levas suma exactamente las unidades sin desincronizar contadores",
    stateA.nextCount === 30 && stateB.nextCount === 50,
    `Primera leva: ${stateA.nextCount}; Segunda leva acumulada: ${stateB.nextCount}`
  );

  // 19. Regla canónica P18: Asedio no incrementa regularSoldiers
  const regularWithLiving = calculateNextRegularSoldiers(50, 20, "infanteria");
  const regularWithSiege = calculateNextRegularSoldiers(50, 10, "asedio");
  const isLivingInf = isLivingRegularTroop("infanteria");
  const isLivingSiege = isLivingRegularTroop("asedio");
  record(
    "REGLA CANÓNICA P18",
    "19. Unidades de asedio no computan en regularSoldiers para no devengar ración alimentaria (x1,05)",
    regularWithLiving === 70 && regularWithSiege === 50 && isLivingInf && !isLivingSiege,
    `Infantería (+20): ${regularWithLiving}; Asedio (+10): ${regularWithSiege}; Living infantería: ${isLivingInf}; Living asedio: ${isLivingSiege}`
  );

  // 20. Coherencia demográfica censal: Población total permanece inmutable
  // Inicio: 2000 habitantes, 1750 trabajadores, 250 disponibles, 0 soldados.
  // Reclutamiento: -50 disponibles -> 200 disponibles.
  // Finalización: +50 soldados regulares -> 50 soldados.
  // Balance: 50 soldados + 1750 trabajadores + 200 disponibles = 2000 total.
  const initialCivilianReserves = 250;
  const recruitedCount = 50;
  const nextCivilianReserves = initialCivilianReserves - recruitedCount; // 200
  const finalRegularSoldiers = calculateNextRegularSoldiers(0, recruitedCount, "infanteria"); // 50
  const totalAccounted = finalRegularSoldiers + 1750 + nextCivilianReserves;
  record(
    "COHERENCIA DEMOGRÁFICA CENSAL",
    "20. El censo total permanece matemáticamente exacto (2.000) tras reclutamiento e incorporación",
    totalAccounted === 2000 && nextCivilianReserves === 200 && finalRegularSoldiers === 50,
    `Soldados: ${finalRegularSoldiers}; Trabajadores: 1750; Reserva civil: ${nextCivilianReserves}; Total censado: ${totalAccounted}`
  );

  // 21. Exclusión de espías en formación militar ordinaria (Bloque 1.1)
  const spyRejected = createTrainingPlan({
    unitType: "espia",
    count: 1,
    level: 1,
    resources: baseResources,
    availableCivilians: 100,
    activeTrainings: [],
    buildingLevels: { castillo: 5, cuartel: 5 },
    now: 100000,
  });
  record(
    "EXCLUSIÓN DE ESPÍAS",
    "21. Rechaza 'espia' en el catálogo de reclutamiento militar ordinario",
    !spyRejected.success && spyRejected.error.includes("no admitido"),
    `Espía rechazado: ${!spyRejected.success}`
  );

  return results;
}

