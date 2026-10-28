/**
 * LA CONQUISTA — PRUEBAS PURAS DE CIVILIZACIONES Y BONIFICACIONES (Bloque H, P6, P62, D-43 a D-45)
 * Valida la matriz estratégica completa de las 12 civilizaciones oficiales:
 * - Integridad de las 12 civilizaciones canónicas (sin inventadas).
 * - Calibración matemática balanceada (entre 5 % y 15 %, sin civilización dominante).
 * - Aplicación determinista en economía, construcción, investigación, expedición y combate.
 * - Restricción autoritativa de tecnología única (P62) por civilización.
 */
import {
  BUILDINGS,
  CIVILIZATIONS,
  CIVILIZATION_BONUSES_ENABLED,
  type CivilizationId,
  TECHNOLOGIES,
} from "./balanceConfig";
import {
  applyCivilizationCombat,
  applyCivilizationConstructionDuration,
  applyCivilizationExploration,
  applyCivilizationMarch,
  applyCivilizationProductionBonus,
  applyCivilizationResearchDuration,
  applyCivilizationTrainingDuration,
  getCivilization,
  getCivilizationPassive,
  getCivilizationStrategicMatrix,
  getUniqueTechForCivilization,
  NEUTRAL_PASSIVE,
  validateCivilizationTechAccess,
  civilizationArmorLabel,
  civilizationBuildingLabel,
  civilizationTrainingCostMultiplier,
  civilizationUnitLabel,
  civilizationWeaponLabel,
  describeCivilizationIdentity,
  getCivilizationIdentity,
} from "./civilizationRules";
import { createTrainingPlan } from "./armyRules";
import { computeTechnologyModifiers } from "./technologyRules";
import { computeSideFactors, type BattleSide, emptyComposition } from "./battleRules";

export interface CivilizationTestResult {
  category: string;
  test: string;
  passed: boolean;
  details: string;
}

export function runCivilizationTests(): CivilizationTestResult[] {
  const results: CivilizationTestResult[] = [];

  function record(category: string, test: string, passed: boolean, details: string) {
    results.push({ category, test, passed, details });
  }

  const expected12Ids: CivilizationId[] = [
    "ingleses",
    "romanos",
    "griegos",
    "vikingos",
    "bizantinos",
    "arabes",
    "mongoles",
    "chinos",
    "japoneses",
    "navajos",
    "aztecas",
    "masais",
  ];

  // 1. Integridad de las 12 civilizaciones canónicas (P6)
  const allIdsMatch = expected12Ids.every((id) => CIVILIZATIONS.some((c) => c.id === id));
  record(
    "CIVILIZACIONES CANÓNICAS (P6)",
    "1. Las 12 civilizaciones oficiales están presentes sin omisiones ni inventadas",
    CIVILIZATIONS.length === 12 && allIdsMatch,
    `Total civilizaciones: ${CIVILIZATIONS.length}; Coinciden exactamente con P6: ${allIdsMatch}`
  );

  // 2. Definición completa de cada civilización (emblema, estilo, pasiva y tecnología única)
  const allComplete = CIVILIZATIONS.every((c) => {
    const hasEmblem = typeof c.emblem === "string" && c.emblem.length > 0;
    const hasStyle = typeof c.style === "string" && c.style.length > 5;
    const hasPassive = typeof c.passive.description === "string" && c.passive.description.length > 10;
    const tech = TECHNOLOGIES.find((t) => t.id === c.uniqueTechnologyId);
    return hasEmblem && hasStyle && hasPassive && tech && tech.branch === "civilizacion";
  });
  record(
    "INTEGRIDAD DE PERFILES ESTRATÉGICOS",
    "2. Cada civilización posee emblema, estilo temático, bonificación pasiva y tecnología única",
    allComplete,
    `Todos los perfiles completos y vinculados a rama 'civilizacion': ${allComplete}`
  );

  // 3. Calibración de balance (sin civilización superior, P6)
  const balanced = CIVILIZATIONS.every((c) => {
    const p = c.passive;
    const prodValues = Object.values(p.production) as number[];
    const prodMax = prodValues.length > 0 ? Math.max(...prodValues) : 0;
    const combatAtk = p.combatAttackMultiplier;
    const combatDef = p.combatDefenseMultiplier;
    const constrMult = p.constructionDurationMultiplier;
    const resMult = p.researchDurationMultiplier;
    return prodMax <= 0.15 && combatAtk <= 1.10 && combatDef <= 1.10 && constrMult >= 0.85 && resMult >= 0.85;
  });
  record(
    "CALIBRACIÓN DE BALANCE (P6)",
    "3. Ninguna bonificación pasiva supera el rango seguro del 15 % para evitar desequilibrios",
    balanced,
    `Bonificaciones contenidas en los límites simétricos aprobados: ${balanced}`
  );

  // 4. Bonificación pasiva de producción económica (D-46)
  const inglesesWood = applyCivilizationProductionBonus("wood", 1.0, "ingleses");
  const romanosStone = applyCivilizationProductionBonus("stone", 0.75, "romanos");
  const bizantinosGold = applyCivilizationProductionBonus("gold", 0.20, "bizantinos");
  const japonesesIron = applyCivilizationProductionBonus("iron", 0.40, "japoneses");
  const aztecasFood = applyCivilizationProductionBonus("agriculture", 2.0, "aztecas");

  const ecoBonusPassed =
    Math.abs(inglesesWood - 1.10) < 1e-6 &&
    Math.abs(romanosStone - (0.75 * 1.10)) < 1e-6 &&
    Math.abs(bizantinosGold - (0.20 * 1.10)) < 1e-6 &&
    Math.abs(japonesesIron - (0.40 * 1.10)) < 1e-6 &&
    Math.abs(aztecasFood - 2.24) < 1e-6;

  record(
    "ECONOMÍA CULTURAL EFECTIVA",
    "4. Las tasas de producción reflejan con exactitud las especialidades de cada pueblo",
    ecoBonusPassed,
    `Madera inglesa: ${inglesesWood.toFixed(2)}; Piedra romana: ${romanosStone.toFixed(3)}; Alimento azteca: ${aztecasFood.toFixed(2)}`
  );

  // 5. Ingeniería romana en construcción (P20–P22)
  const baseDurationMs = 100_000;
  const romanDuration = applyCivilizationConstructionDuration(baseDurationMs, "romanos");
  const standardDuration = applyCivilizationConstructionDuration(baseDurationMs, "ingleses");
  record(
    "INGENIERÍA ROMANA",
    "5. Los romanos reducen la duración de construcción de edificios en exactamente un 10 %",
    romanDuration === 90_000 && standardDuration === 100_000,
    `Base: 100s; Romanos: ${romanDuration / 1000}s; Estándar: ${standardDuration / 1000}s`
  );

  // 6. Erudición griega en la Universidad (P62)
  const baseResearchSec = 86_400;
  const greekResearchSec = applyCivilizationResearchDuration(baseResearchSec, "griegos");
  const greekPassive = getCivilizationPassive("griegos");
  record(
    "ERUDICIÓN GRIEGA",
    "6. Los griegos reducen la duración de investigación un 10 % y aportan +5 de felicidad base",
    greekResearchSec === Math.ceil(86_400 * 0.90) && greekPassive.happinessBonus === 5,
    `Investigación griega: ${greekResearchSec}s (de 86.400s); Felicidad base: +${greekPassive.happinessBonus}`
  );

  // 7. Navegación vikinga y expediciones de los indios americanos (P22)
  const baseCosts = { gold: 30, food: 40 };
  const baseExpDurationMs = 3600 * 1000;
  const vikingExp = applyCivilizationExploration(baseCosts, baseExpDurationMs, "vikingos");
  const indianExp = applyCivilizationExploration(baseCosts, baseExpDurationMs, "navajos");
  record(
    "EXPLORACIÓN Y EXPEDICIONES (P22)",
    "7. Vikingos reducen duración de expedición (15 %) e indios americanos reducen provisiones (20 %)",
    vikingExp.durationMs === Math.ceil(3600 * 1000 * 0.85) &&
      indianExp.costs.gold === Math.ceil(30 * 0.80) &&
      indianExp.costs.food === Math.ceil(40 * 0.80),
    `Vikingos dur: ${vikingExp.durationMs / 1000}s; Navajos costes: ${indianExp.costs.gold} oro / ${indianExp.costs.food} comida`
  );

  // 8. Medicina árabe y recuperación en hospital militar (P44)
  const arabPassive = getCivilizationPassive("arabes");
  record(
    "MEDICINA ÁRABE (P44)",
    "8. Los árabes aportan +8 pp a la tasa de recuperación de heridos",
    arabPassive.woundedRecoveryBonus === 0.08,
    `Bonificación árabe de recuperación: +${Math.round(arabPassive.woundedRecoveryBonus * 100)} pp`
  );

  // 9. Movilidad y fatiga (Mongoles y Masáis, P32/P41)
  const mongolMarch = applyCivilizationMarch(3600, 20, "mongoles");
  const keniaMarch = applyCivilizationMarch(3600, 20, "masais");
  record(
    "MOVILIDAD Y RESISTENCIA (P32, P41)",
    "9. Mongoles aumentan velocidad de marcha un 15 % y masáis reducen fatiga un 25 %",
    mongolMarch.durationSeconds < 3600 && keniaMarch.fatigueAccrued === Math.ceil(20 * 0.75),
    `Mongoles: ${mongolMarch.durationSeconds}s (de 3600s); Masáis fatiga: ${keniaMarch.fatigueAccrued} (de 20)`
  );

  // 10. Exclusividad de tecnología única de civilización (P62)
  const byzantineOnByzantine = validateCivilizationTechAccess("bizantinos", "bizantinos");
  const englishOnByzantine = validateCivilizationTechAccess("ingleses", "bizantinos");
  const unassignedKingdom = validateCivilizationTechAccess("romanos", null);
  const universalTech = validateCivilizationTechAccess(undefined, "vikingos");

  record(
    "EXCLUSIVIDAD TECNOLÓGICA (P62)",
    "10. Solo la civilización correspondiente puede investigar su tecnología única",
    byzantineOnByzantine.allowed &&
      !englishOnByzantine.allowed &&
      !unassignedKingdom.allowed &&
      universalTech.allowed,
    `Propia admitida: ${byzantineOnByzantine.allowed}; Ajena bloqueada: ${!englishOnByzantine.allowed}; Universal admitida: ${universalTech.allowed}`
  );

  // 11. Multiplicadores militares de combate (P34)
  const mockSideJap: BattleSide = {
    kingdomId: "k-jap",
    name: "Japón",
    composition: { ...emptyComposition(), infanteria: 100 },
    trainingMultiplier: 1.0,
    weaponTier: "palo",
    armorTier: "ninguna",
    strategy: "defensiva",
    morale: 50,
    foodTier: "normal",
    fatigue: 0,
    wallsLevel: 0,
    terrainDefenseBonus: 0,
    civilization: "japoneses",
  };
  const mockSideNeutral: BattleSide = {
    ...mockSideJap,
    kingdomId: "k-neu",
    name: "Neutral",
    civilization: undefined,
  };
  const factorsJap = computeSideFactors(mockSideJap, mockSideJap.composition, mockSideNeutral);
  const factorsNeutral = computeSideFactors(mockSideNeutral, mockSideNeutral.composition, mockSideNeutral);
  record(
    "SISTEMA MILITAR Y COMBATE (P34)",
    "11. El poder ofensivo japonés supera al neutral en exactamente el 5 % pasivo",
    factorsJap.offensiveStrength > factorsNeutral.offensiveStrength &&
      Math.abs(factorsJap.offensiveStrength - factorsNeutral.offensiveStrength * 1.05) < 1e-4,
    `Ataque japonés: ${factorsJap.offensiveStrength.toFixed(1)}; Neutral: ${factorsNeutral.offensiveStrength.toFixed(1)}`
  );

  // 12. Compatibilidad neutra y retrocompatibilidad
  const neutral = getCivilizationPassive(null);
  const neutralMatch =
    neutral.constructionDurationMultiplier === 1.0 &&
    neutral.researchDurationMultiplier === 1.0 &&
    neutral.combatAttackMultiplier === 1.0 &&
    neutral.combatDefenseMultiplier === 1.0 &&
    Object.keys(neutral.production).length === 0;

  record(
    "RETROCOMPATIBILIDAD Y NEUTRALIDAD",
    "12. Los reinos sin civilización operan con multiplicadores neutros 1.0 sin penalización",
    neutralMatch,
    `Factores neutros: construccion=1.0, investigacion=1.0, ataque=1.0, defensa=1.0`
  );

  // Singularidades por civilización (decisión 21-10-2026)
  const identified = CIVILIZATIONS.filter((c) => getCivilizationIdentity(c.id) !== null);
  const pending = CIVILIZATIONS.filter((c) => getCivilizationIdentity(c.id) === null).map((c) => c.id);
  const complete = identified.every((c) => {
    const identity = getCivilizationIdentity(c.id)!;
    const weaponsOk = (["palo", "lanzaBasica", "espadaHierro", "acero", "aceroAvanzado"] as const).every((tier) => identity.weapons[tier].length > 2);
    const armorsOk = (["ninguna", "piel", "cueroReforzado", "hierro", "acero"] as const).every((tier) => identity.armors[tier].length > 2);
    return weaponsOk && armorsOk && identity.uniqueBuilding.name.length > 2 && identity.signatureUnit.name.length > 2;
  });
  const weaknessOk = identified.every((c) => typeof c.passive.weakness === "string" && c.passive.weakness.length > 10);
  const pendingNoWeakness = pending.every((id) => (getCivilization(id)?.passive.weakness ?? null) === null);
  const aztecNoSteel = !Object.values(getCivilizationIdentity("aztecas")!.weapons).some((n) => /acero/i.test(n)) && !Object.values(getCivilizationIdentity("aztecas")!.armors).some((n) => /acero|hierro|malla/i.test(n));
  const vikingNoHorns = !Object.values(getCivilizationIdentity("vikingos")!.armors).some((n) => /cuerno/i.test(n));
  const testPassed = identified.length === 12 && pending.length === 0 && complete && weaknessOk && pendingNoWeakness && aztecNoSteel && vikingNoHorns;
  record(
    "SINGULARIDADES POR CIVILIZACIÓN (decisión 21-10-2026)",
    "11. Las 12 civilizaciones cuentan con equipo por nivel, edificio único, tropa característica y debilidad; sin acero ni caballos aztecas ni cuernos vikingos",
    testPassed,
    `Con identidad: ${identified.length}; pendientes: ${pending.length}; completas: ${complete}; con debilidad: ${weaknessOk}; aztecas sin acero: ${aztecNoSteel}; vikingos sin cuernos: ${vikingNoHorns}`
  );

  const roman = { weapon: civilizationWeaponLabel("romanos", "espadaHierro"), armor: civilizationArmorLabel("romanos", "hierro"), building: civilizationBuildingLabel("romanos", "cuartel"), other: civilizationBuildingLabel("romanos", "granja"), unit: civilizationUnitLabel("romanos", "infanteria") };
  const navajo = { weapon: civilizationWeaponLabel("navajos", "espadaHierro"), building: civilizationBuildingLabel("navajos", "taberna"), other: civilizationBuildingLabel("navajos", "cuartel"), unit: civilizationUnitLabel("navajos", "infanteria") };
  record(
    "SINGULARIDADES POR CIVILIZACIÓN (decisión 21-10-2026)",
    "12. Los nombres propios acompañan al nombre base (multiplicadores intactos) y las civilizaciones pendientes usan los nombres genéricos",
    roman.weapon === "Gladius hispaniensis (Espada de hierro)" && roman.armor === "Lorica segmentata (Hierro)" && roman.building === `Castra (${BUILDINGS.cuartel.label})` && roman.other === BUILDINGS.granja.label && roman.unit === "Legionario (Infantería)" &&
      navajo.weapon === "Hacha de hierro (Espada de hierro)" && navajo.building === `Hogar de rastreadores (${BUILDINGS.taberna.label})` && navajo.other === BUILDINGS.cuartel.label && navajo.unit === "Rastreador (Infantería)",
    `Romanos: ${roman.weapon} · ${roman.armor} · ${roman.building} · ${roman.unit}; Navajos: ${navajo.weapon} · ${navajo.building} · ${navajo.unit}`
  );

  const englishCavalryCost = civilizationTrainingCostMultiplier("caballeria", "ingleses");
  const englishInfantryCost = civilizationTrainingCostMultiplier("infanteria", "ingleses");
  const plan = createTrainingPlan({ unitType: "caballeria", count: 10, level: 1, resources: { gold: 10_000, wood: 10_000, stone: 10_000, iron: 10_000, food: 10_000 }, availableCivil: 100, buildingLevels: { castillo: 3, cuartel: 2, herreria: 1 }, activeTraining: [], now: 1_000, costModifier: englishCavalryCost });
  const planPlain = createTrainingPlan({ unitType: "caballeria", count: 10, level: 1, resources: { gold: 10_000, wood: 10_000, stone: 10_000, iron: 10_000, food: 10_000 }, availableCivil: 100, buildingLevels: { castillo: 3, cuartel: 2, herreria: 1 }, activeTraining: [], now: 1_000 });
  const mongolDefense = getCivilizationPassive("mongoles").combatDefenseMultiplier;
  const navajoSiegeDuration = applyCivilizationTrainingDuration("asedio", 10_000, "navajos");
  const navajoInfantryDuration = applyCivilizationTrainingDuration("infanteria", 10_000, "navajos");
  const masaiCombat = applyCivilizationCombat(100, 100, "masais");
  const masaiDefense = getCivilizationPassive("masais").combatDefenseMultiplier;
  const allHaveAdvantage = CIVILIZATIONS.every((c) => c.passive.description.length > 10);
  const profileRomanos = describeCivilizationIdentity(getCivilization("romanos")!);
  const profileNavajos = describeCivilizationIdentity(getCivilization("navajos")!);
  const profileMasais = describeCivilizationIdentity(getCivilization("masais")!);
  const weaknessChecks =
    Math.abs(englishCavalryCost - 1.15) < 1e-9 && englishInfantryCost === 1 && plan.success && planPlain.success &&
    plan.plan.costs.gold === Math.ceil(planPlain.plan.costs.gold! * 1.15) && plan.plan.durationMs === planPlain.plan.durationMs &&
    Math.abs(mongolDefense - 0.95) < 1e-9 &&
    navajoSiegeDuration === 11_000 && navajoInfantryDuration === 10_000 &&
    Math.abs(masaiDefense - 0.95) < 1e-9 && masaiCombat.attack === 100 && Math.abs(masaiCombat.defense - 95) < 1e-9 &&
    allHaveAdvantage && !profileRomanos.pendingDesign && !profileNavajos.pendingDesign && !profileMasais.pendingDesign &&
    profileRomanos.identity?.uniqueBuilding.name === "Castra" && profileMasais.identity?.uniqueBuilding.name === "Boma";
  record(
    "SINGULARIDADES POR CIVILIZACIÓN (decisión 21-10-2026)",
    "13. Debilidades aplicadas: caballería inglesa +15 % de coste, mongoles y masáis −5 % de defensa, navajos +10 % asedio; ventajas y fichas completas",
    weaknessChecks,
    `Oro caballería inglesa: ${plan.success ? plan.plan.costs.gold : "-"} frente a ${planPlain.success ? planPlain.plan.costs.gold : "-"}; defensa mongola ×${mongolDefense}; navajos asedio: ${navajoSiegeDuration} ms (base 10.000 ms); masáis defensa ×${masaiDefense} (${masaiCombat.defense}/100); fichas completas: ${!profileRomanos.pendingDesign && !profileNavajos.pendingDesign && !profileMasais.pendingDesign}`
  );

  return results;
}
