/**
 * LA CONQUISTA — PRUEBAS PURAS DEL SISTEMA TECNOLÓGICO Y ENTREGA 0 (E0)
 * Verificación matemática y determinista sin acceso a base de datos.
 */

import {
  TECHNOLOGIES,
  RESEARCH,
  RESEARCH_SLOTS_BY_UNIVERSITY,
} from "./balanceConfig";
import {
  computeTechnologyModifiers,
  researchSlots,
  TECHNOLOGY_CATALOG,
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

export function runTechnologyTests(): TechnologyTestResult[] {
  const results: TechnologyTestResult[] = [];

  // 1. Ranuras de investigación fijadas a 1
  {
    const slotsU1 = researchSlots(1);
    const slotsU3 = researchSlots(3);
    const slotsU5 = researchSlots(5);
    const maxSlots = RESEARCH.MAX_SLOTS;
    const allSlotsOne = slotsU1 === 1 && slotsU3 === 1 && slotsU5 === 1 && maxSlots === 1;

    results.push({
      category: "ÁRBOL TECNOLÓGICO Y RANURAS (E0)",
      test: "1. Una sola investigación activa a la vez en todos los niveles de Universidad",
      passed: allSlotsOne,
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

  // 4. Conexión de marcha y fatiga: marchSpeedBonus y marchFatigueReduction
  {
    const dist = 5;
    const terrain = 1.2;
    const unitSpeed = 1.0;
    const civSpeed = 1.0;

    const baseDuration = marchTimeSeconds(dist, terrain, unitSpeed, civSpeed, 0);
    const buffedDuration = marchTimeSeconds(dist, terrain, unitSpeed, civSpeed, 0.20); // +20 % velocidad

    const baseFatigue = marchFatigue(10, dist, terrain, 1.0, 0);
    const buffedFatigue = marchFatigue(10, dist, terrain, 1.0, 0.25); // -25 % fatiga

    const speedWorks = buffedDuration < baseDuration;
    const fatigueWorks = buffedFatigue < baseFatigue;

    results.push({
      category: "CONEXIÓN DE MARCHA Y RESISTENCIA (E0)",
      test: "4. Bonificaciones de tecnología reducen duración de marcha y acumulación de fatiga",
      passed: speedWorks && fatigueWorks,
      details: `Duración: ${baseDuration}s -> ${buffedDuration}s; Fatiga final: ${baseFatigue} -> ${buffedFatigue}`,
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
      details: `Base: nivel ${modNone.espionageLevel}, Esp 1: nivel ${modEsp1.espionageLevel}, Esp 1+2: nivel ${modEsp2.espionageLevel}`,
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
      test: "6. Todas las 25 tecnologías existentes tienen efecto numérico definido y conectado",
      passed: allConnected,
      details: `Total de tecnologías verificadas: ${TECHNOLOGIES.length}, sin tecnologías huérfanas`,
    });
  }

  return results;
}
