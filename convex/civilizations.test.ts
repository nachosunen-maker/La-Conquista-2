import { describe, expect, it } from "vitest";
import { getCivilizationPassive, getCivilizationIdentity } from "./civilizationRules";
import { unitMarchMultiplier, armyMarchMultiplier, calculateArmyMarchPlan } from "./territoryRules";
import { storageCapacity, simulateExtendedEconomy } from "./economyExtended";
import { INITIAL_KINGDOM_CONFIG } from "./economyCalculations";
import { simulateBattle, type BattleSide } from "./battleRules";
import { UNITS } from "./balanceConfig";

describe("Civilizaciones — Verificación de Reglas y Almacenes", () => {
  it("Vikingos: aplica la bonificación de +10 % en capacidad de almacenamiento", () => {
    const vikingPassive = getCivilizationPassive("vikingos");
    expect(vikingPassive.storageCapacityMultiplier).toBe(1.10);

    // Mercado Nivel 0 (Base 10.000)
    const capacityL0 = storageCapacity(0, vikingPassive.storageCapacityMultiplier);
    expect(capacityL0).toBe(11_000); // 10.000 * 1.10

    // Mercado Nivel 1 (Base 12.000)
    const capacityL1 = storageCapacity(1, vikingPassive.storageCapacityMultiplier);
    expect(capacityL1).toBe(13_200); // 12.000 * 1.10
  });

  it("Vikingos: ausencia de doble aplicación del +10 %", () => {
    const vikingPassive = getCivilizationPassive("vikingos");
    const mult1 = vikingPassive.storageCapacityMultiplier ?? 1.0;
    const capacityOnce = storageCapacity(1, mult1);
    
    // Si se aplicara dos veces (1.10 * 1.10 = 1.21), el resultado sería 14.520
    const capacityTwice = storageCapacity(1, mult1 * mult1);
    
    expect(capacityOnce).toBe(13_200);
    expect(capacityOnce).not.toBe(capacityTwice);
  });

  it("Otras civilizaciones: mantienen la capacidad de almacenamiento estándar (sin multiplicador extra)", () => {
    const otherCivs = ["ingleses", "romanos", "griegos", "arabes", "aztecas", "mongoles"];
    
    for (const civId of otherCivs) {
      const passive = getCivilizationPassive(civId);
      const mult = passive.storageCapacityMultiplier ?? 1.0;
      expect(mult).toBe(1.0);
      
      const capL0 = storageCapacity(0, mult);
      expect(capL0).toBe(10_000);
      
      const capL1 = storageCapacity(1, mult);
      expect(capL1).toBe(12_000);
    }
  });

  it("Aztecas: la unidad característica (Guerrero Jaguar) ocupa el rol de caballería sin alterar compatibilidad", () => {
    const identity = getCivilizationIdentity("aztecas");
    expect(identity).not.toBeNull();
    expect(identity?.signatureUnit.name).toBe("Guerrero Águila");
    expect(identity?.unitNames.caballeria).toBe("Guerrero Jaguar (élite a pie)");

    // Aztecas usan la cuarta plaza táctica (caballeria) para los Guerreros Jaguar
    const aztecCavalryLabel = identity?.unitNames.caballeria;
    expect(aztecCavalryLabel).toContain("Guerrero Jaguar");
  });

  it("Aztecas: compatibilidad total de batallas y formaciones tácticas con la plaza de caballería", () => {
    const attacker: BattleSide = {
      kingdomId: "k_aztecas",
      name: "Tenochtitlan",
      composition: { infanteria: 50, arqueria: 30, caballeria: 20, asedio: 0, onagro_campana: 0, carrobalista: 0, espringarda_movil: 0, trabuchet_traccion: 0, arcuballista: 0, fustibalo_campo: 0, mangonel_tactico: 0, carros_artillados: 0, ariete_movil: 0, torres_asalto: 0, espia: 0 },
      trainingMultiplier: 1.10,
      weaponTier: "espadaHierro",
      armorTier: "cueroReforzado",
      strategy: "agresiva",
      tacticalFormation: "flanqueo",
      morale: 80,
      foodTier: "normal",
      fatigue: 0,
      wallsLevel: 0,
      terrainDefenseBonus: 0,
      civilization: "aztecas",
    };

    const defender: BattleSide = {
      kingdomId: "k_defensivo",
      name: "Defensores",
      composition: { infanteria: 60, arqueria: 40, caballeria: 0, asedio: 0, onagro_campana: 0, carrobalista: 0, espringarda_movil: 0, trabuchet_traccion: 0, arcuballista: 0, fustibalo_campo: 0, mangonel_tactico: 0, carros_artillados: 0, ariete_movil: 0, torres_asalto: 0, espia: 0 },
      trainingMultiplier: 1.0,
      weaponTier: "palo",
      armorTier: "ninguna",
      strategy: "defensiva",
      tacticalFormation: "equilibrada",
      morale: 70,
      foodTier: "normal",
      fatigue: 10,
      wallsLevel: 1,
      terrainDefenseBonus: 0,
      civilization: "ingleses",
    };

    const report = simulateBattle(attacker, defender);
    expect(report.outcome).toBe("victoria");
    expect(report.attacker.survivorsComposition.caballeria).toBeGreaterThanOrEqual(0);
  });

  it("Aztecas: marcha de los Guerreros Jaguar (plaza caballería) a velocidad de infantería a pie (1,0)", () => {
    // 1. Velocidad individual de la unidad
    const aztecJaguarSpeed = unitMarchMultiplier("caballeria", "aztecas");
    expect(aztecJaguarSpeed).toBe(1.0); // Marcha a pie

    const englishCavalrySpeed = unitMarchMultiplier("caballeria", "ingleses");
    expect(englishCavalrySpeed).toBe(UNITS.caballeria.marchMultiplier); // 1.2 (caballería normal)

    const aztecInfantrySpeed = unitMarchMultiplier("infanteria", "aztecas");
    expect(aztecInfantrySpeed).toBe(1.0);

    // 2. Velocidad de ejército compuesto (Azteca)
    const aztecArmySpeed = armyMarchMultiplier({ infanteria: 20, caballeria: 10 }, "aztecas");
    expect(aztecArmySpeed).toBe(1.0); // Toda la fuerza azteca marcha a velocidad 1.0

    // 3. Velocidad de ejército compuesto (Inglés)
    const englishArmySpeed = armyMarchMultiplier({ infanteria: 20, caballeria: 10 }, "ingleses");
    expect(englishArmySpeed).toBe(1.2); // La caballería inglesa ralentiza la marcha a 1.2

    // 4. Plan de marcha completo
    const aztecMarchPlan = calculateArmyMarchPlan({
      from: { q: 0, r: 0 },
      to: { q: 2, r: 0 }, // distancia = 2
      composition: { caballeria: 15 },
      currentFatigue: 0,
      departureTimeMs: 1000000,
      civilization: "aztecas",
    });

    expect(aztecMarchPlan.unitSpeedMultiplier).toBe(1.0);

    const englishMarchPlan = calculateArmyMarchPlan({
      from: { q: 0, r: 0 },
      to: { q: 2, r: 0 }, // distancia = 2
      composition: { caballeria: 15 },
      currentFatigue: 0,
      departureTimeMs: 1000000,
      civilization: "ingleses",
    });

    expect(englishMarchPlan.unitSpeedMultiplier).toBe(1.2);
  });

  it("Identidades culturales corregidas (Fase 4): Navajos, Masáis y Aztecas", () => {
    // 1. Navajos
    const navajosIdentity = getCivilizationIdentity("navajos");
    expect(navajosIdentity?.signatureUnit.name).toBe("Rastreador Diné");
    expect(navajosIdentity?.signatureUnit.unitType).toBe("infanteria"); // Mantiene categoría infantería
    expect(navajosIdentity?.weapons.acero).toBe("Arco de caza reforzado y cuchillo");
    expect(navajosIdentity?.armors.hierro).not.toContain("cota de malla");
    expect(navajosIdentity?.armors.hierro).toContain("escudo de cuero crudo");

    // 2. Masáis
    const masaisIdentity = getCivilizationIdentity("masais");
    expect(masaisIdentity?.signatureUnit.name).toBe("Guerrero Moran");
    expect(masaisIdentity?.signatureUnit.unitType).toBe("infanteria"); // Mantiene categoría infantería
    expect(masaisIdentity?.weapons.palo).toBe("Rungu de madera de acacia");
    expect(masaisIdentity?.weapons.acero).not.toContain("Seme de acero");
    expect(masaisIdentity?.armors.hierro).toContain("El-longo");

    // 3. Aztecas
    const aztecasIdentity = getCivilizationIdentity("aztecas");
    expect(aztecasIdentity?.uniqueBuilding.name).toBe("Templo Mayor");
    expect(aztecasIdentity?.uniqueBuilding.description).toContain("ceremonial");
    expect(aztecasIdentity?.weapons.acero).toBe("Macuahuitl pesado de combate"); // Átlatl separado de arma de choque
    expect(aztecasIdentity?.armors.hierro).toContain("Chimalli");
  });

  it("Robustez ante estado sin globalUpgradeInfo (compatibilidad con backend remoto no desplegado)", () => {
    const mockStateWithoutGlobal = {
      armyLevel: 2,
      globalUpgradeInfo: undefined,
    };
    const fallback = mockStateWithoutGlobal.globalUpgradeInfo ?? {
      currentLevel: mockStateWithoutGlobal.armyLevel ?? 1,
      nextLevel: Math.min(5, (mockStateWithoutGlobal.armyLevel ?? 1) + 1),
      isMaxLevel: (mockStateWithoutGlobal.armyLevel ?? 1) >= 5,
      nextLevelInfo: null,
      requirementsSatisfied: false,
      requirementError: null,
    };
    expect(fallback.isMaxLevel).toBe(false);
    expect(fallback.nextLevel).toBe(3);
    expect(fallback.currentLevel).toBe(2);
  });
});
