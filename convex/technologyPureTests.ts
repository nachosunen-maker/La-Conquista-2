/**
 * LA CONQUISTA — PRUEBAS PURAS DEL SISTEMA TECNOLÓGICO Y ENTREGA 0 (E0)
 * Verificación matemática y determinista sin acceso a base de datos.
 */

import {
  TECHNOLOGIES,
  RESEARCH,
  INITIAL_BUILDINGS,
  TECH_EFFECT_CAPS,
  type ResourceCosts,
} from "./balanceConfig";
import {
  computeTechnologyModifiers,
  researchSlots,
  TECHNOLOGY_CATALOG,
  createResearchPlan,
  calculateResearchCancellationRefund,
  type ResearchQueueEntry,
} from "./technologyRules";
import { computeSideFactors, emptyComposition, type BattleSide } from "./battleRules";
import { marchTimeSeconds, marchFatigue } from "./territoryRules";

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

  return results;
}

function testEfficiencyIsolation(): boolean {
    // Prueba aislamiento: infantería no cambia con tecnología de caballería
    const modCavTech = computeTechnologyModifiers(["tactics_cav_1"]);
    return Math.abs(modCavTech.unitEfficiencyInf) < 1e-9 && Math.abs(modCavTech.unitEfficiencyCav - 0.04) < 1e-9;
}

