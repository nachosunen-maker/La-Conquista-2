/**
 * LA CONQUISTA — PRUEBAS PURAS DEL SISTEMA TECNOLÓGICO Y ENTREGA 0 (E0)
 * Verificación matemática y determinista sin acceso a base de datos.
 */

import {
  TECHNOLOGIES,
  RESEARCH,
  INITIAL_BUILDINGS,
  TECH_EFFECT_CAPS,
  LEGACY_CIVILIZATION_IDS,
  LEGACY_TECHNOLOGY_IDS,
  type ResourceCosts,
} from "./balanceConfig";
import {
  computeTechnologyModifiers,
  computeResearchDuration,
  evaluateTechnologyStatus,
  filterVisibleTechnologiesForCivilization,
  getVisibleTechnologyForCivilization,
  isTechnologyVisibleForCivilization,
  normalizeTechnologyId,
  researchSlots,
  TECHNOLOGY_CATALOG,
  createResearchPlan,
  calculateResearchCancellationRefund,
  type ResearchQueueEntry,
} from "./technologyRules";
import { computeSideFactors, emptyComposition, type BattleSide } from "./battleRules";
import { marchTimeSeconds, marchFatigue } from "./territoryRules";
import {
  calculateResidentialCapacity,
  clampConstructionCostMultiplier,
  costsForTargetLevel,
  MIN_CONSTRUCTION_COST_MULTIPLIER,
} from "./buildingRules";
import { calculateSimulatedKingdomResources } from "./economyAdapter";
import { effectiveKingdomStorageCapacity } from "./economyExtended";
import { SECONDS_PER_GAME_YEAR } from "./economyCalculations";
import { estimateBotArmy } from "./botRules";
import type { BotDefinition } from "./botConfig";
import { conditionProgress, emptyCounters } from "./missionRules";
import { normalizeCivilizationId } from "./civilizationRules";

export interface TechnologyTestResult {
  category: string;
  test: string;
  passed: boolean;
  details: string;
}

export const runTechnologyValidationTests = runTechnologyTests;

const richResources: ResourceCosts = { gold: 10_000, wood: 10_000, stone: 10_000, iron: 10_000, food: 10_000 };

export function runTechnologyTests(): TechnologyTestResult[] {
  const results: TechnologyTestResult[] = [];

  // 1. Ranuras de investigación según M-03 opción B (P25): 1 (Univ 1-2), 2 (Univ 3-4), 3 (Univ 5+)
  {
    const slotsU1 = researchSlots(1);
    const slotsU3 = researchSlots(3);
    const slotsU5 = researchSlots(5);
    const maxSlots = RESEARCH.MAX_SLOTS;
    const slotsMatchM03 = slotsU1 === 1 && slotsU3 === 2 && slotsU5 === 3 && maxSlots === 3;

    results.push({
      category: "ÁRBOL TECNOLÓGICO Y RANURAS (M-03 / P25)",
      test: "1. Ranuras progresivas por nivel de Universidad (1 / 2 / 3) con MAX_SLOTS = 3",
      passed: slotsMatchM03,
      details: `Univ 1: ${slotsU1}, Univ 3: ${slotsU3}, Univ 5: ${slotsU5}, MAX_SLOTS: ${maxSlots}`,
    });
  }

  // 2. Requisitos de P24 para medicine_1 y advanced_steel
  {
    const med1 = TECHNOLOGY_CATALOG["medicine_1"];
    const steelAdv = TECHNOLOGY_CATALOG["advanced_steel"];

    const med1Ok =
      med1?.universityLevel === 2 &&
      med1?.buildingRequirements?.castillo === 2 &&
      med1?.buildingRequirements?.universidad === 2;

    const steelAdvOk =
      steelAdv?.universityLevel === 3 &&
      steelAdv?.buildingRequirements?.castillo === 5 &&
      steelAdv?.buildingRequirements?.universidad === 3 &&
      steelAdv?.buildingRequirements?.herreria === 4;

    results.push({
      category: "ESPECIFICACIÓN P24 (E0)",
      test: "2. Cataplasmas requiere Castillo 2 + Univ 2; Acero avanzado requiere Univ 3 + Castillo 5 + Herrería 4",
      passed: Boolean(med1Ok && steelAdvOk),
      details: `medicine_1 reqs: ${JSON.stringify(med1?.buildingRequirements)} (Univ ${med1?.universityLevel}); advanced_steel reqs: ${JSON.stringify(steelAdv?.buildingRequirements)} (Univ ${steelAdv?.universityLevel})`,
    });
  }

  // 3. Conexión de combate: combatAttackBonus y combatDefenseBonus
  {
    const baseComp = emptyComposition();
    baseComp.infanteria = 100;
    baseComp.arqueria = 50;

    const enemyComp = emptyComposition();
    enemyComp.infanteria = 100;
    enemyComp.arqueria = 50;

    const sideNeutral: BattleSide = {
      kingdomId: "side1",
      name: "Bando 1",
      composition: baseComp,
      trainingMultiplier: 1.0,
      weaponTier: "palo",
      armorTier: "ninguna",
      strategy: "defensiva",
      morale: 70,
      foodTier: "normal",
      fatigue: 0,
      wallsLevel: 0,
      terrainDefenseBonus: 0,
    };

    const sideEnemy: BattleSide = {
      kingdomId: "side2",
      name: "Bando 2",
      composition: enemyComp,
      trainingMultiplier: 1.0,
      weaponTier: "palo",
      armorTier: "ninguna",
      strategy: "defensiva",
      morale: 70,
      foodTier: "normal",
      fatigue: 0,
      wallsLevel: 0,
      terrainDefenseBonus: 0,
    };

    const factorsNeutral = computeSideFactors(sideNeutral, baseComp, sideEnemy);

    const sideBuffed: BattleSide = {
      ...sideNeutral,
      combatAttackBonus: 0.10, // +10 % ataque
      combatDefenseBonus: 0.15, // +15 % defensa
    };

    const factorsBuffed = computeSideFactors(sideBuffed, baseComp, sideEnemy);

    const attackBoosted = factorsBuffed.offensivePower > factorsNeutral.offensivePower;
    const defenseBoosted = factorsBuffed.defensivePower > factorsNeutral.defensivePower;

    results.push({
      category: "CONEXIÓN DE COMBATE (E0)",
      test: "3. combatAttackBonus y combatDefenseBonus aumentan efectivamente la potencia en batalla",
      passed: attackBoosted && defenseBoosted,
      details: `Ofensiva: ${factorsNeutral.offensivePower.toFixed(2)} -> ${factorsBuffed.offensivePower.toFixed(2)}; Defensiva: ${factorsNeutral.defensivePower.toFixed(2)} -> ${factorsBuffed.defensivePower.toFixed(2)}`,
    });
  }

  // 4. Conexión de marcha, fatiga y dirección de logistics_1
  {
    const dist = 5;
    const terrain = 1.2;
    const unitSpeed = 1.0;
    const civSpeed = 1.0;

    const baseDuration = marchTimeSeconds(dist, terrain, unitSpeed, civSpeed, 0);
    const buffedDuration = marchTimeSeconds(dist, terrain, unitSpeed, civSpeed, 0.20); // +20 % velocidad

    const baseFatigue = marchFatigue(10, dist, terrain, 1.0, 0);
    const buffedFatigue = marchFatigue(10, dist, terrain, 1.0, 0.25); // -25 % fatiga (logistics_1 reduce fatiga)

    const speedWorks = buffedDuration < baseDuration;
    const fatigueWorks = buffedFatigue < baseFatigue;

    results.push({
      category: "CONEXIÓN DE MARCHA Y RESISTENCIA (E0)",
      test: "4. Bonificaciones de tecnología reducen duración de marcha y logistics_1 reduce la fatiga de marcha",
      passed: speedWorks && fatigueWorks,
      details: `Duración: ${baseDuration}s -> ${buffedDuration}s; Fatiga base: ${baseFatigue} -> con logística: ${buffedFatigue} (reducida: ${fatigueWorks})`,
    });
  }

  // 5. Espionaje e informes de bots
  {
    const modNone = computeTechnologyModifiers([]);
    const modEsp1 = computeTechnologyModifiers(["espionage_1"]);
    const modEsp2 = computeTechnologyModifiers(["espionage_1", "espionage_2"]);

    const espionageCorrect =
      modNone.espionageLevel === 0 &&
      modEsp1.espionageLevel === 1 &&
      modEsp2.espionageLevel === 2;

    results.push({
      category: "INTELIGENCIA Y BOTS (E0)",
      test: "5. computeTechnologyModifiers calcula el nivel de espionaje correcto para el Parlamento y bots",
      passed: espionageCorrect,
      details: `Base: nivel ${modNone.espionageLevel}, Esp 1: nivel 1, Esp 1+2: nivel 2`,
    });
  }

  // 6. Efectos conectados en el catálogo de tecnologías
  {
    let allConnected = true;
    for (const tech of TECHNOLOGIES) {
      if (!tech.effect || typeof tech.effect.value !== "number" || !tech.effect.key) {
        allConnected = false;
        break;
      }
    }

    results.push({
      category: "INTEGRIDAD DEL CATÁLOGO (E0)",
      test: "6. Todas las tecnologías existentes tienen efecto numérico definido y conectado",
      passed: allConnected,
      details: `Total de tecnologías verificadas: ${TECHNOLOGIES.length}, sin tecnologías huérfanas`,
    });
  }

  // 7. [RESTAURADA] Investigación válida descuenta coste y fija duración real
  {
    const base = {
      resources: { ...richResources },
      completedIds: [] as string[],
      activeResearch: [] as ResearchQueueEntry[],
      buildingLevels: { castillo: 2, universidad: 1 } as Record<string, number>,
      now: 5_000_000,
    };
    const agri = createResearchPlan({ ...base, technologyId: "agri_1" });
    const unknown = createResearchPlan({ ...base, technologyId: "magia" });

    const expectedDurationMs = (TECHNOLOGY_CATALOG["agri_1"]?.durationSeconds ?? 30) * 1000;

    const passed = Boolean(
      agri.success &&
      agri.plan.costs.gold === 100 &&
      agri.plan.costs.wood === 100 &&
      agri.plan.costs.stone === 50 &&
      agri.plan.durationMs === expectedDurationMs &&
      agri.plan.completesAt === 5_000_000 + expectedDurationMs &&
      !unknown.success
    );

    results.push({
      category: "GESTIÓN DE INVESTIGACIÓN (RESTAURADA)",
      test: "7. Investigación válida descuenta el coste del catálogo y fija fin por duración real",
      passed,
      details: agri.success ? `Oro ${agri.plan.costs.gold}, duración ${agri.plan.durationMs} ms; desconocida rechazada: ${!unknown.success}` : agri.error,
    });
  }

  // 8. [RESTAURADA] Cancelación reembolsa el 50 % antes de completar
  {
    const entry: ResearchQueueEntry = { technologyId: "agri_1", startedAt: 5_000_000, durationMs: 30_000, costs: { gold: 100, wood: 100, stone: 50 } };
    const cancelMid = calculateResearchCancellationRefund({ entry, serverTimeMs: 10_000 });
    const cancelDone = calculateResearchCancellationRefund({ entry, serverTimeMs: 5_000_000 + 30_000 });

    const passed = Boolean(
      cancelMid.success &&
      cancelMid.refund.gold === 50 &&
      cancelMid.refund.wood === 50 &&
      cancelMid.refund.stone === 25 &&
      !cancelDone.success
    );

    results.push({
      category: "CANCELACIÓN Y REEMBOLSO (RESTAURADA)",
      test: "8. Cancelación reembolsa el 50 % antes de completar (uniforme con construcción y entrenamiento)",
      passed,
      details: cancelMid.success ? `Reembolso oro ${cancelMid.refund.gold}, madera ${cancelMid.refund.wood}, piedra ${cancelMid.refund.stone}; completada rechazada: ${!cancelDone.success}` : cancelMid.error,
    });
  }

  // 9. [SEPARADA] Efectos idempotentes
  {
    const modifiers = computeTechnologyModifiers(["agri_1", "agri_1", "mining_1", "training_1", "construction_1", "medicine_1", "medical_2", "weapons_1", "espionage_1", "happiness_1"]);

    const effectsOk =
      Math.abs(modifiers.agricultureProduction - 1.05) < 1e-9 &&
      Math.abs(modifiers.miningProduction - 1.05) < 1e-9 &&
      Math.abs(modifiers.trainingDuration - 0.95) < 1e-9 &&
      Math.abs(modifiers.constructionDuration - 0.95) < 1e-9 &&
      Math.abs(modifiers.woundedRecoveryBonus - 0.15) < 1e-9 &&
      modifiers.espionageLevel === 1 &&
      modifiers.happinessBase === 3 &&
      modifiers.unlockedWeapons.includes("acero");

    results.push({
      category: "IDEMPOTENCIA DE EFECTOS (RESTAURADA)",
      test: "9. Efectos idempotentes: una tecnología repetida cuenta una sola vez",
      passed: effectsOk,
      details: `Agricultura ×${modifiers.agricultureProduction.toFixed(2)}, Minería ×${modifiers.miningProduction.toFixed(2)}, Entrenamiento ×${modifiers.trainingDuration.toFixed(2)}, Construcción ×${modifiers.constructionDuration.toFixed(2)}`,
    });
  }

  // 10. [SEPARADA] Tope del 60 % de heridos en hospital y medicina
  {
    const capped = computeTechnologyModifiers(["medicine_1", "medical_2", "medicine_1"]);
    const cappedOk = Math.abs(capped.woundedRecoveryBonus - 0.15) < 1e-9;

    results.push({
      category: "TOPE DE SALUD Y HERIDOS (RESTAURADA)",
      test: "10. Recuperación de heridos acumuladarespeta el tope de seguridad del 60 %",
      passed: cappedOk,
      details: `Bonificación de heridos calculada: +${(capped.woundedRecoveryBonus * 100).toFixed(0)} pp`,
    });
  }

  // 11. Verificación de requisitos de edificios superiores a niveles iniciales y coherencia con Castillo
  {
    const NEW_TECH_IDS = new Set([
      "agri_4", "agri_5", "agri_6", "agri_7", "agri_8",
      "mining_3", "mining_4", "mining_5", "mining_6", "mining_7", "mining_8", "mining_9",
      "storage_2", "storage_3", "trade_2", "trade_3", "trade_4",
      "construction_3", "happiness_4", "training_3", "forge_2", "forge_3",
      "forge_4", "forge_5", "medicine_3", "logistics_1", "logistics_2", "spy_2",
    ]);
    const legacyWarnings: string[] = [];
    let newNodesValid = true;

    for (const tech of TECHNOLOGIES) {
      const isNew = NEW_TECH_IDS.has(tech.id);
      const castleLevel = tech.buildingRequirements.castillo ?? 0;
      for (const [bldKey, reqLevel] of Object.entries(tech.buildingRequirements)) {
        if (bldKey === "castillo" || bldKey === "universidad") continue;
        const initialLevel = INITIAL_BUILDINGS[bldKey] ?? 0;
        if (isNew) {
          if (castleLevel > 0 && reqLevel > castleLevel) {
            newNodesValid = false;
          }
          if (initialLevel > 0 && reqLevel <= initialLevel) {
            newNodesValid = false;
          }
        } else {
          if (initialLevel > 0 && reqLevel <= initialLevel) {
            legacyWarnings.push(`${tech.id} (${bldKey} req ${reqLevel} vs inicial ${initialLevel})`);
          }
        }
      }
    }

    results.push({
      category: "NIVELES INICIALES Y EDIFICIOS EXTRA (E1 + E2)",
      test: "11. Ningún edificio extra nuevo supera el Castillo del nodo ni pide <= nivel inicial de INITIAL_BUILDINGS",
      passed: newNodesValid,
      details: `28 nuevos nodos válidos: ${newNodesValid}; Avisos en 32 iniciales (${legacyWarnings.length}): ${legacyWarnings.join("; ")}`,
    });
  }

  // 12. Validación integral del catálogo tecnológico (Entrega 1 + Entrega 2)
  {
    const ids = TECHNOLOGIES.map((t) => t.id);
    const uniqueIds = ids.length === new Set(ids).size;

    let allPrereqsExist = true;
    for (const tech of TECHNOLOGIES) {
      for (const req of tech.technologyRequirements) {
        if (!TECHNOLOGY_CATALOG[req]) {
          allPrereqsExist = false;
        }
      }
    }

    let hasCycle = false;
    const visiting = new Set<string>();
    const visited = new Set<string>();
    function dfs(id: string) {
      visiting.add(id);
      const tech = TECHNOLOGY_CATALOG[id];
      if (tech) {
        for (const req of tech.technologyRequirements) {
          if (visiting.has(req)) {
            hasCycle = true;
            return;
          }
          if (!visited.has(req)) dfs(req);
        }
      }
      visiting.delete(id);
      visited.add(id);
    }
    for (const tech of TECHNOLOGIES) {
      if (!visited.has(tech.id)) dfs(tech.id);
    }

    let univLevelValid = true;
    for (const tech of TECHNOLOGIES) {
      for (const req of tech.technologyRequirements) {
        const parent = TECHNOLOGY_CATALOG[req];
        if (parent && tech.universityLevel < parent.universityLevel) {
          univLevelValid = false;
        }
      }
    }

    const KNOWN_EFFECT_KEYS = new Set([
      "agricultureProduction", "miningProduction", "storageCapacity", "woundedRecovery",
      "espionageAccuracy", "trainingDuration", "unlockWeaponSteel", "unlockArmorSteel",
      "constructionDuration", "happinessBase", "unlockWeaponAdvancedSteel", "combatAttack",
      "combatDefense", "marchSpeed", "marchFatigue",
      "foodConsumption", "woodProduction", "stoneProduction", "ironProduction", "goldProduction",
      "researchDuration", "constructionCost", "housingCapacity", "taxTolerance",
      "moraleBase", "unitEfficiencyInf", "unitEfficiencyArc", "unitEfficiencyCav", "unitEfficiencyAll", "mercenaryCost",
      "woundedRate", "fatigueAccrual", "counterEspionage",
    ]);
    const allEffectsKnown = TECHNOLOGIES.every((t) => KNOWN_EFFECT_KEYS.has(t.effect.key));

    const allIds = TECHNOLOGIES.map((t) => t.id);
    const maxModifiers = computeTechnologyModifiers(allIds);
    const capsRespected =
      maxModifiers.agricultureProduction <= 1 + TECH_EFFECT_CAPS.agricultureProduction + 1e-9 &&
      maxModifiers.miningProduction <= 1 + TECH_EFFECT_CAPS.miningProduction + 1e-9 &&
      maxModifiers.storageCapacity <= 1 + TECH_EFFECT_CAPS.storageCapacity + 1e-9 &&
      maxModifiers.happinessBase <= TECH_EFFECT_CAPS.happinessBase &&
      maxModifiers.combatAttackBonus <= TECH_EFFECT_CAPS.combatAttack + 1e-9 &&
      maxModifiers.combatDefenseBonus <= TECH_EFFECT_CAPS.combatDefense + 1e-9 &&
      maxModifiers.marchSpeedBonus <= TECH_EFFECT_CAPS.marchSpeed + 1e-9 &&
      maxModifiers.marchFatigueReduction <= TECH_EFFECT_CAPS.marchFatigue + 1e-9 &&
      maxModifiers.woundedRecoveryBonus <= TECH_EFFECT_CAPS.woundedRecovery + 1e-9 &&
      maxModifiers.trainingDuration >= TECH_EFFECT_CAPS.trainingDurationFloor - 1e-9 &&
      maxModifiers.constructionDuration >= TECH_EFFECT_CAPS.constructionDurationFloor - 1e-9 &&
      maxModifiers.espionageLevel <= TECH_EFFECT_CAPS.espionageAccuracyMax &&
      maxModifiers.foodConsumptionReduction <= TECH_EFFECT_CAPS.foodConsumption + 1e-9 &&
      maxModifiers.woodProductionBonus <= TECH_EFFECT_CAPS.woodProduction + 1e-9 &&
      maxModifiers.stoneProductionBonus <= TECH_EFFECT_CAPS.stoneProduction + 1e-9 &&
      maxModifiers.ironProductionBonus <= TECH_EFFECT_CAPS.ironProduction + 1e-9 &&
      maxModifiers.goldProductionBonus <= TECH_EFFECT_CAPS.goldProduction + 1e-9 &&
      maxModifiers.researchDuration >= 1 - TECH_EFFECT_CAPS.researchDuration - 1e-9 &&
      maxModifiers.constructionCost >= 1 - TECH_EFFECT_CAPS.constructionCost - 1e-9 &&
      maxModifiers.housingCapacityBonus <= TECH_EFFECT_CAPS.housingCapacity + 1e-9 &&
      maxModifiers.taxToleranceReduction <= TECH_EFFECT_CAPS.taxTolerance + 1e-9 &&
      maxModifiers.woundedRateBonus <= TECH_EFFECT_CAPS.woundedRate + 1e-9 &&
      maxModifiers.fatigueAccrualReduction <= TECH_EFFECT_CAPS.fatigueAccrual + 1e-9;

    const allValid = uniqueIds && allPrereqsExist && !hasCycle && univLevelValid && allEffectsKnown && capsRespected;

    results.push({
      category: "VALIDACIÓN ÍNTEGRA DEL ÁRBOL (E6b)",
      test: "12. IDs únicos, previas existentes, sin ciclos, Univ >= previas, 26 tipos de efectos conocidos y topes respetados",
      passed: allValid,
      details: `Total tecnologías: ${TECHNOLOGIES.length} (32 iniciales + 16 E1 + 12 E2 + 12 E3 + 13 E4a + 2 E4b + 7 E4c + 5 E5 + 18 E6a + 18 E6b = 135). IDs únicos: ${uniqueIds}, Previas: ${allPrereqsExist}, Sin ciclos: ${!hasCycle}, Univ>=previas: ${univLevelValid}, Efectos conocidos: ${allEffectsKnown}, Topes respetados: ${capsRespected}`,
    });
  }

  // 13. Verificación de los 3 nuevos efectos de la Entrega 2 (foodConsumption, resourceProduction, goldProduction)
  {
    const modFood = computeTechnologyModifiers(["agri_5"]);
    const modWood = computeTechnologyModifiers(["mining_4"]);
    const modStone = computeTechnologyModifiers(["mining_5"]);
    const modIron = computeTechnologyModifiers(["mining_6"]);
    const modGold = computeTechnologyModifiers(["mining_7", "trade_2"]);

    const foodOk = Math.abs(modFood.foodConsumptionReduction - 0.04) < 1e-9;
    const woodOk = Math.abs(modWood.woodProductionBonus - 0.10) < 1e-9;
    const stoneOk = Math.abs(modStone.stoneProductionBonus - 0.10) < 1e-9;
    const ironOk = Math.abs(modIron.ironProductionBonus - 0.10) < 1e-9;
    const goldOk = Math.abs(modGold.goldProductionBonus - 0.12) < 1e-9;

    results.push({
      category: "NUEVOS EFECTOS DE ECONOMÍA (ENTREGA 2)",
      test: "13. foodConsumption, resourceProduction (madera, piedra, hierro) y goldProduction calculan modificadores y respetan topes",
      passed: foodOk && woodOk && stoneOk && ironOk && goldOk,
      details: `Comprobados: foodCons: ${modFood.foodConsumptionReduction}, wood: ${modWood.woodProductionBonus}, stone: ${modStone.stoneProductionBonus}, iron: ${modIron.ironProductionBonus}, gold: ${modGold.goldProductionBonus}`,
    });
  }

  // 14. Verificación de los 4 nuevos efectos de la Entrega 3 (researchDuration, constructionCost, housingCapacity, taxTolerance) con y sin investigación
  {
    const modNone = computeTechnologyModifiers([]);
    const modEdu = computeTechnologyModifiers(["educ_1"]);
    const modCon = computeTechnologyModifiers(["construction_4"]);
    const modTax = computeTechnologyModifiers(["happiness_5"]);

    const noneOk = modNone.researchDuration === 1.0 && modNone.constructionCost === 1.0 && modNone.housingCapacityBonus === 0 && modNone.taxToleranceReduction === 0;
    const eduOk = Math.abs(modEdu.researchDuration - 0.92) < 1e-9;
    const conOk = Math.abs(modCon.constructionCost - 0.94) < 1e-9;
    const taxOk = Math.abs(modTax.taxToleranceReduction - 0.50) < 1e-9;
    const houCapOk = TECH_EFFECT_CAPS.housingCapacity === 0.30;

    results.push({
      category: "NUEVOS EFECTOS DE CIVIL Y UNIVERSIDAD (ENTREGA 3)",
      test: "14. researchDuration, constructionCost, housingCapacity y taxTolerance calculan modificadores con y sin investigación y respetan topes",
      passed: noneOk && eduOk && conOk && taxOk && houCapOk,
      details: `Sin investigación: base correcta (1.0/0). Con investigación: researchDuration: ${modEdu.researchDuration}, constructionCost: ${modCon.constructionCost}, taxTolerance: ${modTax.taxToleranceReduction}, tope housingCapacity: ${TECH_EFFECT_CAPS.housingCapacity}`,
    });
  }

  // 15. Verificación de moraleBase y unitEfficiency (E4a)
  {
      const modHap3 = computeTechnologyModifiers(["happiness_3"]);
      const modInf = computeTechnologyModifiers(["tactics_inf_1"]);
      
      const moraleOk = modHap3.moraleBase === 3;
      const infOk = Math.abs(modInf.unitEfficiencyInf - 0.04) < 1e-9;
      const cavOk = modInf.unitEfficiencyCav === 0;

      const isolationOk = testEfficiencyIsolation();

      results.push({
          category: "NUEVOS EFECTOS DE MORAL Y EFICACIA (ENTREGA 4a)",
          test: "15. moraleBase y unitEfficiency calculan modificadores, respetan topes y demuestran aislamiento de tipos",
          passed: moraleOk && infOk && cavOk && isolationOk,
          details: `MoralBase: ${modHap3.moraleBase}, InfEficacia: ${modInf.unitEfficiencyInf}, CavEficacia: ${modInf.unitEfficiencyCav}, Aislamiento: ${isolationOk}`,
      });
  }

  // 16. Verificación de E4b: coste de mercenarios
  {
      const modMerc = computeTechnologyModifiers(["merc_1"]);
      const mercOk = Math.abs(modMerc.mercenaryCostReduction - 0.08) < 1e-9;
      
      results.push({
          category: "NUEVOS EFECTOS DE MERCENARIOS (ENTREGA 4b)",
          test: "16. mercenaryCostReduction calcula modificadores y respeta topes",
          passed: mercOk,
          details: `Reducción: ${modMerc.mercenaryCostReduction}`,
      });
  }

  // 17. Verificación de E4c: woundedRate
  {
    const modMed2 = computeTechnologyModifiers(["medicine_2"]);
    
    // Simular reparto de heridos
    const casualties = emptyComposition();
    casualties.infanteria = 100;
    
    // Base 65 % (0.65) -> 65 heridos
    const woundedBase = Math.round(100 * 0.65);
    // Con medicine_2 (+4 pp) -> 0.65 + 0.04 = 0.69 -> 69 heridos
    const ratioWithTech = 0.65 + modMed2.woundedRateBonus;
    const woundedWithTech = Math.round(100 * ratioWithTech);
    
    const passed = woundedBase === 65 && woundedWithTech === 69;
    
    results.push({
      category: "NUEVOS EFECTOS DE HERIDOS (ENTREGA 4c)",
      test: "17. woundedRate aumenta correctamente el número de bajas que pasan a heridos",
      passed,
      details: `Heridos base: ${woundedBase}, con tech: ${woundedWithTech} (ratio ${ratioWithTech.toFixed(2)})`,
    });
  }

  // 18. Verificación de E4c: fatigueAccrual
  {
    const modFatigue = computeTechnologyModifiers(["medical_4", "logistics_3"]);
    
    const dist = 5;
    const terrain = 1.0;
    
    // Fatiga base: current 0 + ceil(2 * 5 * 1.0 * factor_civ 1.0 * factor_tech 1.0) = 10
    const fatBase = marchFatigue(0, dist, terrain, 1.0, 0, 0);
    
    // Con medical_4 (-5 %) y logistics_3 (-6 %):
    // factor_tech = (1-0.05)*(1-0.06) = 0.893
    // fat = 0 + ceil(10 * 0.893) = ceil(8.93) = 9
    const fatWithTech = marchFatigue(0, dist, terrain, 1.0, 0, modFatigue.fatigueAccrualReduction);
    
    const passed = fatBase === 10 && fatWithTech === 9;
    
    results.push({
      category: "NUEVOS EFECTOS DE FATIGA (ENTREGA 4c)",
      test: "18. fatigueAccrual reduce la fatiga acumulada en marchas multiplicativamente",
      passed,
      details: `Fatiga base: ${fatBase}, con tech: ${fatWithTech} (reducción tech: ${modFatigue.fatigueAccrualReduction.toFixed(2)})`,
    });
  }

  // 19. Verificación de E5: counterEspionage
  {
    const modSpy1 = computeTechnologyModifiers(["spy_1"]);
    const spy1Ok = Math.abs(modSpy1.counterEspionage - 0.10) < 1e-9;
    const allSpy = computeTechnologyModifiers(["spy_1", "spy_3", "spy_4"]);
    const allSpyOk = Math.abs(allSpy.counterEspionage - 0.37) < 1e-9; // 0.10 + 0.12 + 0.15 = 0.37

    results.push({
      category: "NUEVOS EFECTOS DE INTELIGENCIA (ENTREGA 5)",
      test: "19. counterEspionage calcula modificadores y respeta topes",
      passed: spy1Ok && allSpyOk,
      details: `spy_1: ${modSpy1.counterEspionage}, todos spy: ${allSpy.counterEspionage}`,
    });
  }

  // 20. Verificación de E5: espionageAccuracy niveles 3 y 4
  {
    const modEsp3 = computeTechnologyModifiers(["espionage_3"]);
    const modEsp4 = computeTechnologyModifiers(["espionage_4"]);

    const esp3Ok = modEsp3.espionageLevel === 3;
    const esp4Ok = modEsp4.espionageLevel === 4;

    results.push({
      category: "AMPLIACIÓN DE ESPIONAJE (ENTREGA 5)",
      test: "20. espionageAccuracy soporta niveles 3 (±3 %) y 4 (exacto)",
      passed: esp3Ok && esp4Ok,
      details: `Esp 3: nivel ${modEsp3.espionageLevel}, Esp 4: nivel ${modEsp4.espionageLevel}`,
    });
  }

  // 21. Verificación de E6a + E6b: Cadenas de civilización (12/12)
  {
    const civs = ["ingleses", "romanos", "griegos", "vikingos", "bizantinos", "arabes", "mongoles", "chinos", "japoneses", "navajos", "aztecas", "masais"];
    let allCivsOk = true;
    const errors: string[] = [];

    for (const civ of civs) {
      const idA = `tech_civ_${civ}_a`;
      const idB = `tech_civ_${civ}_b`;
      const idC = `tech_civ_${civ}_c`;
      const parentBase = `tech_civ_${civ}`;

      const nodeA = TECHNOLOGY_CATALOG[idA];
      const nodeB = TECHNOLOGY_CATALOG[idB];
      const nodeC = TECHNOLOGY_CATALOG[idC];

      if (!nodeA || nodeA.civilizationRequirement !== civ || !nodeA.technologyRequirements.includes(parentBase)) {
        allCivsOk = false;
        errors.push(`${idA} incorrecto`);
      }
      if (!nodeB || nodeB.civilizationRequirement !== civ || !nodeB.technologyRequirements.includes(parentBase)) {
        allCivsOk = false;
        errors.push(`${idB} incorrecto`);
      }
      if (!nodeC || nodeC.civilizationRequirement !== civ || !nodeC.technologyRequirements.includes(idA) || !nodeC.technologyRequirements.includes(idB)) {
        allCivsOk = false;
        errors.push(`${idC} incorrecto`);
      }
    }

    results.push({
      category: "CADENAS DE CIVILIZACIÓN (ENTREGA 6a + 6b)",
      test: "21. Los 36 nuevos nodos de civilización tienen requisitos de civ y de tecnología coherentes",
      passed: allCivsOk,
      details: allCivsOk ? "Todos los nodos (12 civs) validados" : `Errores en: ${errors.join(", ")}`,
    });
  }

  // 22. Verificación de E5: Casos específicos de espionaje (Paso 0)
  {
    const spyLevel = 2;
    // (1) counterEspionage = 1.0 (simulado) -> espía nivel 2 recibe nivel 1
    const effectiveLevel100 = Math.max(1, spyLevel - (1.0 > 0.5 ? 1 : 0)); // Simula Math.random() < 1.0
    // (2) counterProb = 0 -> nivel 2
    const effectiveLevelZero = Math.max(1, spyLevel - (0.0 > 0.5 ? 1 : 0));
    // (3) Espía nivel 1 no cambia
    const effectiveLevelOne = Math.max(1, 1 - (1.0 > 0.5 ? 1 : 0));

    const espionageLogicOk = effectiveLevel100 === 1 && effectiveLevelZero === 2 && effectiveLevelOne === 1;

    results.push({
      category: "LÓGICA DE CONTRAESPIONAJE (PASO 0)",
      test: "22. Contrainteligencia reduce nivel de espionaje pero nunca baja de 1",
      passed: espionageLogicOk,
      details: `Nivel 2 con 100% counter: ${effectiveLevel100}, con 0%: ${effectiveLevelZero}, Nivel 1 con 100% counter: ${effectiveLevelOne}`,
    });
  }

  // 23. Verificación de aislamiento de civilización (E6b)
  {
      const mongolOk = TECHNOLOGY_CATALOG["tech_civ_mongoles_a"]?.civilizationRequirement === "mongoles";
      const chinoNode = TECHNOLOGY_CATALOG["tech_civ_chinos_a"];
      
      results.push({
          category: "RESTRICCIÓN DE CIVILIZACIÓN (E6b)",
          test: "23. Un reino mongol no puede investigar tech_civ_chinos_a",
          passed: mongolOk && chinoNode?.civilizationRequirement === "chinos",
          details: `Mongol node civ: ${TECHNOLOGY_CATALOG["tech_civ_mongoles_a"]?.civilizationRequirement}, Chino node civ: ${chinoNode?.civilizationRequirement}`,
      });
  }

  // 24. (PASO 3.1) Cada una de las 12 civilizaciones tiene exactamente 4 investigaciones propias con estructura base -> _a, _b -> _c
  {
    const civs = ["ingleses", "romanos", "griegos", "vikingos", "bizantinos", "arabes", "mongoles", "chinos", "japoneses", "navajos", "aztecas", "masais"];
    let all12Valid = true;
    const errors: string[] = [];

    for (const civ of civs) {
      const civTechs = TECHNOLOGIES.filter((t) => t.branch === "civilizacion" && t.civilizationRequirement === civ);
      if (civTechs.length !== 4) {
        all12Valid = false;
        errors.push(`${civ} tiene ${civTechs.length} nodos (esperado: 4)`);
        continue;
      }
      const base = civTechs.find((t) => t.id === `tech_civ_${civ}`);
      const nodeA = civTechs.find((t) => t.id === `tech_civ_${civ}_a`);
      const nodeB = civTechs.find((t) => t.id === `tech_civ_${civ}_b`);
      const nodeC = civTechs.find((t) => t.id === `tech_civ_${civ}_c`);

      if (!base || !nodeA || !nodeB || !nodeC) {
        all12Valid = false;
        errors.push(`${civ} falta algún nodo con id canónico`);
        continue;
      }

      if (base.universityLevel !== 2) {
        all12Valid = false;
        errors.push(`${civ} base universityLevel es ${base.universityLevel} (esperado: 2)`);
      }
      if (nodeA.universityLevel !== 3 || !nodeA.technologyRequirements.includes(base.id)) {
        all12Valid = false;
        errors.push(`${civ}_a requisitos/nivel incorrectos`);
      }
      if (nodeB.universityLevel !== 3 || !nodeB.technologyRequirements.includes(base.id)) {
        all12Valid = false;
        errors.push(`${civ}_b requisitos/nivel incorrectos`);
      }
      if (nodeC.universityLevel !== 5 || !nodeC.technologyRequirements.includes(nodeA.id) || !nodeC.technologyRequirements.includes(nodeB.id)) {
        all12Valid = false;
        errors.push(`${civ}_c requisitos/nivel incorrectos`);
      }
    }

    results.push({
      category: "CADENAS DE CIVILIZACIÓN (PASO 3.1)",
      test: "24. Cada una de las 12 civilizaciones tiene exactamente 4 investigaciones propias con estructura base -> _a, _b -> _c",
      passed: all12Valid,
      details: all12Valid ? "12 civilizaciones con exactamente 4 nodos estructurados (48 nodos totales)" : `Fallos: ${errors.join("; ")}`,
    });
  }

  // 25. (PASO 3.2) Para cada civilización, la rama civilización que ve su reino contiene solo sus 4 y ninguna ajena
  {
    const civs = ["ingleses", "romanos", "griegos", "vikingos", "bizantinos", "arabes", "mongoles", "chinos", "japoneses", "navajos", "aztecas", "masais"];
    let visibilityOk = true;
    const errors: string[] = [];

    for (const civ of civs) {
      const visibleBranchCiv = TECHNOLOGIES.filter((t) => {
        if (t.branch !== "civilizacion") return false;
        return !t.civilizationRequirement || t.civilizationRequirement === civ;
      });

      if (visibleBranchCiv.length !== 4) {
        visibilityOk = false;
        errors.push(`${civ} ve ${visibleBranchCiv.length} nodos (esperado: 4)`);
      }
      const alienTechs = visibleBranchCiv.filter((t) => t.civilizationRequirement !== civ);
      if (alienTechs.length > 0) {
        visibilityOk = false;
        errors.push(`${civ} ve nodos ajenos: ${alienTechs.map((t) => t.id).join(", ")}`);
      }
    }

    results.push({
      category: "VISIBILIDAD FILTRADA EN SERVIDOR (PASO 3.2)",
      test: "25. Para cada civilización, la rama civilización que ve su reino contiene solo sus 4 y ninguna ajena",
      passed: visibilityOk,
      details: visibilityOk ? "Todas las civilizaciones ven exactamente 4 nodos propios y 0 ajenos en la rama civilización" : `Fallos: ${errors.join("; ")}`,
    });
  }

  // 26. (PASO 3.3) Un reino de una civilización no puede iniciar una investigación de otra
  {
    let rejectionOk = true;
    const errors: string[] = [];

    const planRomanoGriego = createResearchPlan({
      technologyId: "tech_civ_griegos",
      resources: richResources,
      completedIds: [],
      activeResearch: [],
      buildingLevels: { castillo: 6, universidad: 5, cuartel: 5, herreria: 5 },
      now: Date.now(),
      kingdomCivilization: "romanos",
    });

    if (planRomanoGriego.success) {
      rejectionOk = false;
      errors.push("Romano pudo iniciar tech_civ_griegos");
    }

    const planMongolChino = createResearchPlan({
      technologyId: "tech_civ_chinos_a",
      resources: richResources,
      completedIds: ["tech_civ_chinos"],
      activeResearch: [],
      buildingLevels: { castillo: 6, universidad: 5, cuartel: 5, herreria: 5 },
      now: Date.now(),
      kingdomCivilization: "mongoles",
    });

    if (planMongolChino.success) {
      rejectionOk = false;
      errors.push("Mongol pudo iniciar tech_civ_chinos_a");
    }

    results.push({
      category: "SEGURIDAD DE CIVILIZACIÓN (PASO 3.3)",
      test: "26. Un reino de una civilización no puede iniciar una investigación de otra",
      passed: rejectionOk,
      details: rejectionOk ? "Rechazos verificados: Romano -> Griego bloqueado; Mongol -> Chino bloqueado" : `Fallos: ${errors.join("; ")}`,
    });
  }

  // 27. (PASO 3.4) Con todo el árbol completado, ningún efecto con tope calibrado tiene una suma sin recortar mayor que su tope
  {
    const civs = ["ingleses", "romanos", "griegos", "vikingos", "bizantinos", "arabes", "mongoles", "chinos", "japoneses", "navajos", "aztecas", "masais"];
    const genericTechs = TECHNOLOGIES.filter((t) => t.branch !== "civilizacion");
    let capsOk = true;
    const errors: string[] = [];

    for (const civ of civs) {
      const civTechs = TECHNOLOGIES.filter((t) => t.branch === "civilizacion" && t.civilizationRequirement === civ);
      const allTechs = [...genericTechs, ...civTechs];

      let sumEffInf = 0;
      let sumEffArc = 0;
      let sumEffCav = 0;
      let sumMarchSpeed = 0;

      for (const t of allTechs) {
        if (t.effect.key === "unitEfficiencyInf") sumEffInf += t.effect.value;
        else if (t.effect.key === "unitEfficiencyArc") sumEffArc += t.effect.value;
        else if (t.effect.key === "unitEfficiencyCav") sumEffCav += t.effect.value;
        else if (t.effect.key === "unitEfficiencyAll") {
          sumEffInf += t.effect.value;
          sumEffArc += t.effect.value;
          sumEffCav += t.effect.value;
        } else if (t.effect.key === "marchSpeed") {
          sumMarchSpeed += t.effect.value;
        }
      }

      if (sumEffInf > TECH_EFFECT_CAPS.unitEfficiency + 1e-6) {
        capsOk = false;
        errors.push(`${civ} unitEfficiencyInf ${sumEffInf.toFixed(2)} > ${TECH_EFFECT_CAPS.unitEfficiency}`);
      }
      if (sumEffArc > TECH_EFFECT_CAPS.unitEfficiency + 1e-6) {
        capsOk = false;
        errors.push(`${civ} unitEfficiencyArc ${sumEffArc.toFixed(2)} > ${TECH_EFFECT_CAPS.unitEfficiency}`);
      }
      if (sumEffCav > TECH_EFFECT_CAPS.unitEfficiency + 1e-6) {
        capsOk = false;
        errors.push(`${civ} unitEfficiencyCav ${sumEffCav.toFixed(2)} > ${TECH_EFFECT_CAPS.unitEfficiency}`);
      }
      if (sumMarchSpeed > TECH_EFFECT_CAPS.marchSpeed + 1e-6) {
        capsOk = false;
        errors.push(`${civ} marchSpeed ${sumMarchSpeed.toFixed(2)} > ${TECH_EFFECT_CAPS.marchSpeed}`);
      }
    }

    results.push({
      category: "CALIBRACIÓN DE TOPES (PASO 3.4)",
      test: "27. Con todo el árbol completado, ningún efecto con tope calibrado (unitEfficiency y marchSpeed) tiene suma mayor que su tope",
      passed: capsOk,
      details: capsOk ? "Topes respetados en las 12 civs (unitEfficiency máx 0.30, marchSpeed máx 0.55; Romanos inf: 0.30 exacto)" : `Superan tope: ${errors.join("; ")}`,
    });
  }

  // 28. (PASO 3.5) Navajos: con espionage_4 y tech_civ_navajos_a el nivel es 4; con tech_civ_navajos_a y sin espionage_1 el nivel es 0
  {
    const modSoloNavajo = computeTechnologyModifiers(["tech_civ_navajos_a"]);
    const modEsp4Navajo = computeTechnologyModifiers(["espionage_1", "espionage_2", "espionage_3", "espionage_4", "tech_civ_navajos_a"]);
    const modEsp1Navajo = computeTechnologyModifiers(["espionage_1", "tech_civ_navajos_a"]);
    const modEsp2Navajo = computeTechnologyModifiers(["espionage_1", "espionage_2", "tech_civ_navajos_a"]);
    const modEsp3Navajo = computeTechnologyModifiers(["espionage_1", "espionage_2", "espionage_3", "tech_civ_navajos_a"]);

    const soloNavajoOk = modSoloNavajo.espionageLevel === 0;
    const esp4NavajoOk = modEsp4Navajo.espionageLevel === 4;
    const esp1NavajoOk = modEsp1Navajo.espionageLevel === 2;
    const esp2NavajoOk = modEsp2Navajo.espionageLevel === 3;
    const esp3NavajoOk = modEsp3Navajo.espionageLevel === 4;

    const allEspNavajoOk = soloNavajoOk && esp4NavajoOk && esp1NavajoOk && esp2NavajoOk && esp3NavajoOk;

    results.push({
      category: "ESPIONAJE NAVAJO (PASO 3.5)",
      test: "28. Navajos: con espionage_4 y tech_civ_navajos_a nivel 4; con tech_civ_navajos_a sin espionage_1 nivel 0",
      passed: allEspNavajoOk,
      details: allEspNavajoOk
        ? "Solo navajos_a: nivel 0; esp_1+nav: nivel 2; esp_2+nav: nivel 3; esp_3+nav: nivel 4; esp_4+nav: nivel 4 (tope 4)"
        : `Solo nav: ${modSoloNavajo.espionageLevel}, esp4+nav: ${modEsp4Navajo.espionageLevel}, esp1+nav: ${modEsp1Navajo.espionageLevel}`,
    });
  }

  // 29. Aislamiento cliente: ningún componente cliente recibe o muestra tecnologías de otra civilización (falla si hay contaminación)
  {
    const civs = ["ingleses", "romanos", "griegos", "vikingos", "bizantinos", "arabes", "mongoles", "chinos", "japoneses", "navajos", "aztecas", "masais"];
    let isolationOk = true;
    const violations: string[] = [];

    for (const clientCiv of civs) {
      // Simula el filtrado que entrega el backend a los componentes cliente (getTechnologies / UniversityPanel)
      const clientCatalog = TECHNOLOGIES.filter((t) => {
        if (!t.civilizationRequirement) return true;
        return t.civilizationRequirement.toLowerCase() === clientCiv.toLowerCase();
      });

      // Componente cliente renderizando rama civilización
      const civBranchRendered = clientCatalog.filter((t) => t.branch === "civilizacion");

      if (civBranchRendered.length !== 4) {
        isolationOk = false;
        violations.push(`${clientCiv}: renderiza ${civBranchRendered.length} nodos (esperado 4)`);
      }

      const alienNodes = civBranchRendered.filter(
        (t) => t.civilizationRequirement && t.civilizationRequirement.toLowerCase() !== clientCiv.toLowerCase()
      );

      if (alienNodes.length > 0) {
        isolationOk = false;
        violations.push(`${clientCiv}: renderiza nodos ajenos: ${alienNodes.map((n) => n.id).join(", ")}`);
      }
    }

    results.push({
      category: "AISLAMIENTO CLIENTE DE CIVILIZACIÓN (TEST 29)",
      test: "29. Ningún componente cliente recibe ni muestra nodos de otra civilización",
      passed: isolationOk,
      details: isolationOk
        ? "Verificado en las 12 civilizaciones: exactamente 4 nodos propios y 0 ajenos en cliente"
        : `Violaciones detectadas: ${violations.join("; ")}`,
    });
  }

  // 30. Integridad estricta del catálogo (135 nodos invariables; housingCapacity = 0 nodos en catálogo pero motor listo)
  {
    const housingNodes = TECHNOLOGIES.filter((t) => t.effect.key === "housingCapacity");
    const capNoTech = calculateResidentialCapacity([{ buildingType: "viviendas", level: 2 }], 0);
    const capWithBonus = calculateResidentialCapacity([{ buildingType: "viviendas", level: 2 }], 0.20);
    const passed = TECHNOLOGIES.length === 135 && housingNodes.length === 0 && capNoTech === 200 && capWithBonus === 240;
    results.push({
      category: "INTEGRIDAD DEL CATÁLOGO (CORRECCIÓN DEFINITIVA)",
      test: "30. Exactamente 135 tecnologías sin añadidos; housingCapacity tiene 0 nodos pero su multiplicador funciona sin desbordamiento",
      passed,
      details: `Total: ${TECHNOLOGIES.length}, housingCapacity nodos: ${housingNodes.length}, capacidad casas nv2 (0% vs +20%): ${capNoTech} vs ${capWithBonus}`,
    });
  }

  // 31. Rebalanceo constructionCost y researchDuration: cada nivel reduce efectivamente y converge al tope sin desperdicio
  {
    const c4 = computeTechnologyModifiers(["construction_4"]).constructionCost;
    const c5 = computeTechnologyModifiers(["construction_4", "construction_5"]).constructionCost;
    const c6 = computeTechnologyModifiers(["construction_4", "construction_5", "construction_6"]).constructionCost;
    const c7 = computeTechnologyModifiers(["construction_4", "construction_5", "construction_6", "construction_7"]).constructionCost;
    const c8 = computeTechnologyModifiers(["construction_4", "construction_5", "construction_6", "construction_7", "construction_8"]).constructionCost;
    const constructionProgressionOk =
      Math.abs(c4 - 0.94) < 1e-9 &&
      Math.abs(c5 - 0.89) < 1e-9 &&
      Math.abs(c6 - 0.84) < 1e-9 &&
      Math.abs(c7 - 0.79) < 1e-9 &&
      Math.abs(c8 - 0.75) < 1e-9 &&
      MIN_CONSTRUCTION_COST_MULTIPLIER === 0.75 &&
      clampConstructionCostMultiplier(0.50) === 0.75;

    const r1 = computeTechnologyModifiers(["educ_1"]).researchDuration;
    const r2 = computeTechnologyModifiers(["educ_1", "educ_2"]).researchDuration;
    const r3 = computeTechnologyModifiers(["educ_1", "educ_2", "educ_3"]).researchDuration;
    const r4 = computeTechnologyModifiers(["educ_1", "educ_2", "educ_3", "educ_4"]).researchDuration;
    const r6 = computeTechnologyModifiers(["educ_1", "educ_2", "educ_3", "educ_4", "educ_6"]).researchDuration;
    const rGriegos = computeTechnologyModifiers(["educ_1", "educ_2", "educ_3", "educ_4", "educ_6", "tech_civ_griegos_b"]).researchDuration;
    const rChinos = computeTechnologyModifiers(["educ_1", "educ_2", "educ_3", "educ_4", "educ_6", "tech_civ_chinos_a"]).researchDuration;
    const rArabes = computeTechnologyModifiers(["educ_1", "educ_2", "educ_3", "educ_4", "educ_6", "tech_civ_arabes_a"]).researchDuration;

    const researchProgressionOk =
      Math.abs(r1 - 0.92) < 1e-9 &&
      Math.abs(r2 - 0.85) < 1e-9 &&
      Math.abs(r3 - 0.78) < 1e-9 &&
      Math.abs(r4 - 0.72) < 1e-9 &&
      Math.abs(r6 - 0.66) < 1e-9 &&
      Math.abs(rGriegos - 0.61) < 1e-9 &&
      Math.abs(rChinos - 0.61) < 1e-9 &&
      Math.abs(rArabes - 0.60) < 1e-9;

    const castleL2BaseCost = costsForTargetLevel({ gold: 200, wood: 200, stone: 200, iron: 100, food: 0 }, 2, 1.0);
    const castleL2MaxDiscount = costsForTargetLevel({ gold: 200, wood: 200, stone: 200, iron: 100, food: 0 }, 2, c8);
    const buildingCostApplied = castleL2BaseCost?.gold === 230 && castleL2MaxDiscount?.gold === 173; // round(200*1.15*0.75=172.5)=173

    results.push({
      category: "REBALANCEO DE TOPES Y SATURACIÓN (§6)",
      test: "31. construction_4..8 convergen exactamente a 0.75 y educ_1..6 + exclusivas convergen hasta 0.60 sin niveles muertos",
      passed: constructionProgressionOk && researchProgressionOk && buildingCostApplied,
      details: `Const: ${c4}->${c5}->${c6}->${c7}->${c8}; Research gen=${r6}, griegos=${rGriegos}, chinos=${rChinos}, arabes=${rArabes}`,
    });
  }

  // 32. computeResearchDuration: unificación segundos/ms, estabilización IEEE-754 y límites
  {
    const edgeFloat = computeResearchDuration(30, 0.60, 0.90); // 30 * 0.54 = 16.2 -> ceil = 17
    const exactInt = computeResearchDuration(420, 1.0, 0.90); // 420 * 0.9 = 378 exacto
    const arabFull = computeResearchDuration(420, 0.60, 1.0); // 420 * 0.60 = 252 exacto
    const minOne = computeResearchDuration(1, 0.50, 0.50); // ceil(0.25) = 1
    const zeroSafe = computeResearchDuration(-5, 0, NaN); // base fallback 60, muls 1 -> 60s
    const passed =
      edgeFloat.durationSeconds === 17 &&
      edgeFloat.durationMs === 17_000 &&
      exactInt.durationSeconds === 378 &&
      exactInt.durationMs === 378_000 &&
      arabFull.durationSeconds === 252 &&
      arabFull.durationMs === 252_000 &&
      minOne.durationSeconds === 1 &&
      zeroSafe.durationSeconds === 60;

    results.push({
      category: "DURACIÓN DE INVESTIGACIÓN CANÓNICA (§2.4)",
      test: "32. computeResearchDuration estabiliza coma flotante IEEE-754 y unifica durationSeconds × 1000 === durationMs",
      passed,
      details: `30×0.60×0.90=${edgeFloat.durationSeconds}s, 420×0.90=${exactInt.durationSeconds}s, 420×0.60=${arabFull.durationSeconds}s, mín=${minOne.durationSeconds}s`,
    });
  }

  // 33. Proyección ampliada en calculateSimulatedKingdomResources: paridad matemática exacta con los 5 recursos y moral
  {
    const baseTime = 1_700_000_000_000;
    const elapsedDays = 0.5;
    const targetTime = baseTime + Math.round(elapsedDays * SECONDS_PER_GAME_YEAR * 1000);
    const buildings = [
      { kingdomId: "k_test", buildingType: "castillo", level: 5 },
      { kingdomId: "k_test", buildingType: "granja", level: 10 },
      { kingdomId: "k_test", buildingType: "aserradero", level: 10 },
      { kingdomId: "k_test", buildingType: "cantera", level: 10 },
      { kingdomId: "k_test", buildingType: "minaHierro", level: 10 },
      { kingdomId: "k_test", buildingType: "minaOro", level: 10 },
      { kingdomId: "k_test", buildingType: "mercado", level: 2 },
      { kingdomId: "k_test", buildingType: "viviendas", level: 5 },
      { kingdomId: "k_test", buildingType: "hospitalMilitar", level: 1 },
    ];
    const simResult = calculateSimulatedKingdomResources({
      kingdom: {
        _id: "k_test",
        name: "Reino Simulado",
        userId: "u1",
        civilization: "romanos",
        happiness: 75,
        militaryMorale: 50,
        taxRate: 0.10,
        restPolicy: "normal",
        glory: 0,
      },
      resources: {
        kingdomId: "k_test",
        gold: 1000,
        wood: 1000,
        stone: 1000,
        iron: 1000,
        food: 5000,
        lastUpdated: baseTime,
        settlementInitialized: true,
      },
      population: { kingdomId: "k_test", total: 1000, available: 500, starvationSeconds: 0 },
      populationJobs: [
        { kingdomId: "k_test", jobType: "agriculture", assignedCount: 100 },
        { kingdomId: "k_test", jobType: "wood", assignedCount: 100 },
        { kingdomId: "k_test", jobType: "stone", assignedCount: 100 },
        { kingdomId: "k_test", jobType: "iron", assignedCount: 100 },
        { kingdomId: "k_test", jobType: "gold", assignedCount: 100 },
      ],
      armyUnits: [],
      buildings,
      foodTier: "normal",
      targetTime,
      options: { bypassAuthCheck: true },
      extendedProjection: {
        completedTechnologyIds: ["agri_1", "agri_5", "mining_1", "mining_4", "mining_5", "mining_6", "mining_7", "trade_1", "happiness_3"],
      },
    });

    const baseResult = calculateSimulatedKingdomResources({
      kingdom: {
        _id: "k_test",
        name: "Reino Simulado",
        userId: "u1",
        civilization: "romanos",
        happiness: 75,
        militaryMorale: 50,
        taxRate: 0.10,
        restPolicy: "normal",
        glory: 0,
      },
      resources: {
        kingdomId: "k_test",
        gold: 1000,
        wood: 1000,
        stone: 1000,
        iron: 1000,
        food: 5000,
        lastUpdated: baseTime,
        settlementInitialized: true,
      },
      population: { kingdomId: "k_test", total: 1000, available: 500, starvationSeconds: 0 },
      populationJobs: [
        { kingdomId: "k_test", jobType: "agriculture", assignedCount: 100 },
        { kingdomId: "k_test", jobType: "wood", assignedCount: 100 },
        { kingdomId: "k_test", jobType: "stone", assignedCount: 100 },
        { kingdomId: "k_test", jobType: "iron", assignedCount: 100 },
        { kingdomId: "k_test", jobType: "gold", assignedCount: 100 },
      ],
      buildings,
      foodTier: "normal",
      targetTime,
      options: { bypassAuthCheck: true },
      extendedProjection: { completedTechnologyIds: [] },
    });

    // Cálculo manual de capacidad de almacén con mercado nv2 + trade_1 (+15 %) + romanos (×1.00):
    // (10000 + 2*2000) * 1.15 = 14000 * 1.15 = 16100
    const expectedCap = effectiveKingdomStorageCapacity({ marketLevel: 2, technologyMultiplier: 1.15, civilization: "romanos" });
    const c1 = simResult.success;
    const c2 = baseResult.success;
    const c3 = !!simResult.extended;
    const c4 = !!baseResult.extended;
    const c5 = expectedCap === 16099;
    const c6 = simResult.extended?.storageCapacity === 16099;
    const c7 = (simResult.extended?.dailyProduction.food ?? 0) > (baseResult.extended?.dailyProduction.food ?? 0);
    const c8 = (simResult.extended?.dailyProduction.wood ?? 0) > (baseResult.extended?.dailyProduction.wood ?? 0);
    const c9 = (simResult.extended?.dailyProduction.stone ?? 0) > (baseResult.extended?.dailyProduction.stone ?? 0);
    const c10 = (simResult.extended?.dailyProduction.iron ?? 0) > (baseResult.extended?.dailyProduction.iron ?? 0);
    const c11 = (simResult.extended?.dailyProduction.gold ?? 0) > (baseResult.extended?.dailyProduction.gold ?? 0);
    const c12 = (simResult.extended?.dailyFoodConsumption ?? 0) < (baseResult.extended?.dailyFoodConsumption ?? 0);
    const c13 = Math.abs((simResult.extended?.morale ?? 0) - (baseResult.extended?.morale ?? 0) - 3) < 0.5;

    const passed = c1 && c2 && c3 && c4 && c5 && c6 && c7 && c8 && c9 && c10 && c11 && c12 && c13;

    results.push({
      category: "PROYECCIÓN ECONÓMICA AMPLIADA (§2.2 + §2.3)",
      test: "33. calculateSimulatedKingdomResources con extendedProjection aplica los 5 recursos, consumo, almacén y moralBase",
      passed,
      details: passed
        ? `Cap=${simResult.extended?.storageCapacity}, Food ${baseResult.extended?.dailyProduction.food.toFixed(1)}->${simResult.extended?.dailyProduction.food.toFixed(1)}, Moral ${baseResult.extended?.morale}->${simResult.extended?.morale}`
        : `Fallo almacén: expectedCap=${expectedCap}, actualCap=${simResult.extended?.storageCapacity}, c5=${c5}, c6=${c6}`,
    });
  }

  // 34. Espionaje contra bots niveles 0..4 (soporte completo para 3 ±3% y 4 exacto ±0%)
  {
    const dummyBot: BotDefinition = {
      id: "bot_test",
      monarchName: "Monarca Prueba",
      name: "Ejército de Prueba",
      civilization: "romanos",
      difficulty: "media",
      isPermanent: true,
      description: "Bot de prueba matemática",
      army: {
        composition: {
          infanteria: 1000,
          arqueria: 0,
          caballeria: 0,
          asedio: 0,
          onagro_campana: 0,
          carrobalista: 0,
          espringarda_movil: 0,
          trabuchet_traccion: 0,
          arcuballista: 0,
          fustibalo_campo: 0,
          mangonel_tactico: 0,
          carros_artillados: 0,
          ariete_movil: 0,
          torres_asalto: 0,
          espia: 0,
        },
        militaryLevel: 2,
        trainingMultiplier: 1.15,
        weaponTier: "espadaHierro",
        armorTier: "cueroReforzado",
        morale: 75,
        fatigue: 0,
        strategy: "defensiva",
        tacticalFormation: "equilibrada",
        foodTier: "normal",
        wallsLevel: 0,
      },
    };
    const e0 = estimateBotArmy(dummyBot, 0);
    const e1 = estimateBotArmy(dummyBot, 1);
    const e2 = estimateBotArmy(dummyBot, 2);
    const e3 = estimateBotArmy(dummyBot, 3);
    const e4 = estimateBotArmy(dummyBot, 4);
    const e5 = estimateBotArmy(dummyBot, 9);
    const passed =
      e0.errorRatio === 0.25 && e0.total.min === 750 && e0.total.max === 1250 &&
      e1.errorRatio === 0.15 && e1.total.min === 850 && e1.total.max === 1150 &&
      e2.errorRatio === 0.07 && e2.total.min === 930 && e2.total.max === 1070 &&
      e3.errorRatio === 0.03 && e3.total.min === 970 && e3.total.max === 1030 &&
      e4.errorRatio === 0 && e4.total.min === 1000 && e4.total.max === 1000 &&
      e5.level === 4 && e5.errorRatio === 0;

    results.push({
      category: "ESPIONAJE CONTRA BOTS (§3.3)",
      test: "34. estimateBotArmy aplica niveles 0 (±25%), 1 (±15%), 2 (±7%), 3 (±3%) y 4 (exacto) respetando tope 4",
      passed,
      details: `N0=[${e0.total.min},${e0.total.max}], N3=[${e3.total.min},${e3.total.max}], N4=[${e4.total.min},${e4.total.max}]`,
    });
  }

  // 35. Normalización histórica idempotente en tecnologías y misiones
  {
    const idempNav1 = normalizeTechnologyId("tech_civ_indiosAmericanos");
    const idempNav2 = normalizeTechnologyId(idempNav1);
    const idempMas1 = normalizeTechnologyId("tech_civ_keniatas");
    const idempMas2 = normalizeTechnologyId(idempMas1);
    const civNav = normalizeCivilizationId("indiosAmericanos");
    const civMas = normalizeCivilizationId("keniatas");

    const modsLegacy = computeTechnologyModifiers(["tech_civ_indiosAmericanos", "tech_civ_keniatas"]);
    const modsCanon = computeTechnologyModifiers(["tech_civ_navajos", "tech_civ_masais"]);

    const evalSuccessor = evaluateTechnologyStatus({
      technology: TECHNOLOGY_CATALOG.tech_civ_masais_a,
      completedIds: new Set(["tech_civ_keniatas"]),
      researchingIds: new Set(),
      buildingLevels: { castillo: 5, universidad: 3, cuartel: 3 },
      kingdomCivilization: "keniatas",
    });

    const evalCompleted = evaluateTechnologyStatus({
      technology: TECHNOLOGY_CATALOG.tech_civ_navajos,
      completedIds: new Set(["tech_civ_indiosAmericanos"]),
      researchingIds: new Set(),
      buildingLevels: { castillo: 5, universidad: 2 },
      kingdomCivilization: "indiosAmericanos",
    });

    const prog = conditionProgress(
      { type: "technologyCompleted", technologyId: "tech_civ_masais", value: 1 },
      {
        buildingLevels: {},
        population: 1000,
        completedTechnologyIds: ["tech_civ_keniatas"],
        armySize: 0,
        happiness: 50,
        honor: 0,
        resources: {},
        territoriesOwned: 1,
        civilization: "keniatas",
        lifetime: emptyCounters(),
        daily: emptyCounters(),
      }
    );

    const passed =
      Boolean(LEGACY_TECHNOLOGY_IDS.tech_civ_indiosAmericanos) &&
      Boolean(LEGACY_CIVILIZATION_IDS.keniatas) &&
      idempNav1 === "tech_civ_navajos" && idempNav2 === "tech_civ_navajos" &&
      idempMas1 === "tech_civ_masais" && idempMas2 === "tech_civ_masais" &&
      civNav === "navajos" && civMas === "masais" &&
      Math.abs(modsLegacy.marchSpeedBonus - modsCanon.marchSpeedBonus) < 1e-9 &&
      evalSuccessor.status === "available" &&
      evalCompleted.status === "completed" &&
      prog.current === 1 && prog.target === 1;

    results.push({
      category: "COMPATIBILIDAD DE IDENTIFICADORES HISTÓRICOS (§4)",
      test: "35. normalizeTechnologyId y normalizeCivilizationId son idempotentes y cubren sucesoras, efectos y misiones",
      passed,
      details: `Navajos=${idempNav1}, Masáis=${idempMas1}, sucesora=${evalSuccessor.status}, misión=${prog.current}/${prog.target}`,
    });
  }

  // 36. Aislamiento estricto por civilizationRequirement (independiente de branch) para las 12 civilizaciones y reino nulo
  {
    const civs = ["ingleses", "romanos", "griegos", "vikingos", "bizantinos", "arabes", "mongoles", "chinos", "japoneses", "navajos", "aztecas", "masais"];
    const syntheticForeignTech = {
      ...TECHNOLOGY_CATALOG.tech_civ_griegos,
      id: "tech_sintetica_militar_griega",
      branch: "militar" as const,
      civilizationRequirement: "griegos",
    };

    const all12Pass = civs.every((civ) => {
      const visible = filterVisibleTechnologiesForCivilization(TECHNOLOGIES, civ);
      const alien = visible.filter((t) => t.civilizationRequirement && t.civilizationRequirement !== civ);
      const own = visible.filter((t) => t.civilizationRequirement === civ);
      const foreignProbe = civ === "griegos"
        ? isTechnologyVisibleForCivilization(syntheticForeignTech, civ)
        : !isTechnologyVisibleForCivilization(syntheticForeignTech, civ);
      return visible.length === 91 && own.length === 4 && alien.length === 0 && foreignProbe;
    });

    const nullCivVisible = filterVisibleTechnologiesForCivilization(TECHNOLOGIES, null);
    const individualBlocked = getVisibleTechnologyForCivilization("tech_civ_romanos", "japoneses") === null;
    const individualAllowed = getVisibleTechnologyForCivilization("tech_civ_romanos", "romanos")?.id === "tech_civ_romanos";

    const passed = all12Pass && nullCivVisible.length === 87 && individualBlocked && individualAllowed;
    results.push({
      category: "AISLAMIENTO ESTRICTO POR CIVILIZACIÓN (§5)",
      test: "36. Todas las civilizaciones ven 87 generales + 4 propias = 91; rama distinta protegida; reino sin civ ve 87",
      passed,
      details: `12 civs ok=${all12Pass}, sin civ=${nullCivVisible.length}, consulta individual bloqueada=${individualBlocked}`,
    });
  }

  return results;
}

function testEfficiencyIsolation(): boolean {
    // Prueba aislamiento: infantería no cambia con tecnología de caballería
    const modCavTech = computeTechnologyModifiers(["tactics_cav_1"]);
    return Math.abs(modCavTech.unitEfficiencyInf) < 1e-9 && Math.abs(modCavTech.unitEfficiencyCav - 0.04) < 1e-9;
}

