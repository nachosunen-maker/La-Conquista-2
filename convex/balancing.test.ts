import { describe, it, expect } from "vitest";
import { TECHNOLOGIES, UNITS, UNIT_TYPES, BUILDINGS, type UnitType } from "./balanceConfig";
import { createResearchPlan, TECHNOLOGY_CATALOG } from "./technologyRules";
import { trainingDurationMs, createTrainingPlan, isSiegeUnit, getUnitCategory } from "./armyRules";
import { civilizationTrainingDurationMultiplier, civilizationTrainingCostMultiplier, applyCivilizationTrainingDuration } from "./civilizationRules";
import { durationForTargetLevel, BUILDING_RULES } from "./buildingRules";
import { applyFormation, emptyComposition } from "./battleRules";

describe("Equilibrio Definitivo: Catálogo y Tiempos de Investigación", () => {
  it("contiene todas las tecnologías del catálogo (135) y todas tienen duración positiva", () => {
    expect(TECHNOLOGIES.length).toBe(135);
    for (const tech of TECHNOLOGIES) {
      expect(tech.durationSeconds).toBeGreaterThan(0);
      expect(Number.isFinite(tech.durationSeconds)).toBe(true);
    }
  });

  it("clasifica las tecnologías en los rangos aprobados según su tier", () => {
    const basicas = ["agri_1", "mining_1", "storage_1", "construction_1", "happiness_1", "training_1", "medicine_1"];
    const intermedias = ["agri_2", "mining_2", "trade_1", "construction_2", "training_2", "weapons_1", "armor_1", "espionage_1"];
    const avanzadas = ["agri_3", "happiness_2", "medical_2", "advanced_steel", "espionage_2"];
    const civs = TECHNOLOGIES.filter((t) => t.branch === "civilizacion");

    // Básicas: 30–60 segundos
    for (const id of basicas) {
      const tech = TECHNOLOGIES.find((t) => t.id === id);
      expect(tech).toBeDefined();
      expect(tech!.durationSeconds).toBeGreaterThanOrEqual(30);
      expect(tech!.durationSeconds).toBeLessThanOrEqual(60);
    }

    // Intermedias: 180–360 segundos
    for (const id of intermedias) {
      const tech = TECHNOLOGIES.find((t) => t.id === id);
      expect(tech).toBeDefined();
      expect(tech!.durationSeconds).toBeGreaterThanOrEqual(180);
      expect(tech!.durationSeconds).toBeLessThanOrEqual(360);
    }

    // Avanzadas: 360–480 segundos
    for (const id of avanzadas) {
      const tech = TECHNOLOGIES.find((t) => t.id === id);
      expect(tech).toBeDefined();
      expect(tech!.durationSeconds).toBeGreaterThanOrEqual(360);
      expect(tech!.durationSeconds).toBeLessThanOrEqual(480);
    }

    // Tecnologías de civilización: 12 base (420 s) + 36 de fases 6a/6b (480 s / 900 s) = 48 en total
    expect(civs.length).toBe(48);
    for (const tech of civs) {
      expect(tech.civilizationRequirement).toBeDefined();
      if (tech.id.endsWith("_a") || tech.id.endsWith("_b") || tech.id.endsWith("_c")) {
        expect([480, 900]).toContain(tech.durationSeconds);
      } else {
        expect(tech.durationSeconds).toBe(420);
      }
    }
  });

  it("calcula duraciones efectivas de investigación y respeta la pasiva griega del 10 % en tech_civ_griegos", () => {
    // Ejemplo Básico: agri_1 (30s = 30.000 ms)
    const basePlan = createResearchPlan({
      technologyId: "agri_1",
      resources: { gold: 1000, wood: 1000, stone: 1000, iron: 1000, food: 1000 },
      completedIds: [],
      activeResearch: [],
      buildingLevels: { castillo: 2, universidad: 1 },
      now: 1_000_000,
    });
    expect(basePlan.success).toBe(true);
    if (basePlan.success) {
      expect(basePlan.plan.durationMs).toBe(30_000);
      expect(basePlan.plan.completesAt).toBe(1_000_000 + 30_000);
    }

    // Tecnología Única Griega: tech_civ_griegos (420s base; con -10% pasiva griega = 378s / 378.000 ms)
    const greekPlan = createResearchPlan({
      technologyId: "tech_civ_griegos",
      resources: { gold: 2000, wood: 2000, stone: 2000, iron: 2000, food: 2000 },
      completedIds: [],
      activeResearch: [],
      buildingLevels: { castillo: 2, universidad: 2 },
      kingdomCivilization: "griegos",
      now: 1_000_000,
    });
    expect(greekPlan.success).toBe(true);
    if (greekPlan.success) {
      expect(greekPlan.plan.durationMs).toBe(378_000);
      expect(greekPlan.plan.completesAt).toBe(1_000_000 + 378_000);
    }
  });

  it("verifica que todos los identificadores de dependencias coinciden exactamente con el catálogo", () => {
    const catalogIds = new Set(TECHNOLOGIES.map((t) => t.id));
    for (const tech of TECHNOLOGIES) {
      for (const reqId of tech.technologyRequirements) {
        expect(catalogIds.has(reqId)).toBe(true);
      }
    }
    // Verificación explícita de happiness y weapons
    expect(catalogIds.has("happiness_1")).toBe(true);
    expect(catalogIds.has("weapons_1")).toBe(true);
    expect(TECHNOLOGY_CATALOG.happiness_2.technologyRequirements).toEqual(["happiness_1"]);
    expect(TECHNOLOGY_CATALOG.advanced_steel.technologyRequirements).toEqual(["weapons_1"]);
  });
});

describe("Equilibrio Definitivo: Catálogo y Tiempos de Reclutamiento Militar", () => {
  it("valida que todas las unidades tengan tiempos de entrenamiento en los rangos aprobados", () => {
    // Infantería: 10 s
    expect(UNITS.infanteria.trainingSecondsPerUnit).toBe(10);
    // Arquería: 15 s
    expect(UNITS.arqueria.trainingSecondsPerUnit).toBe(15);
    // Caballería: 30 s
    expect(UNITS.caballeria.trainingSecondsPerUnit).toBe(30);

    // Asedio: 60 a 90 s
    const siegeUnits: UnitType[] = [
      "asedio",
      "onagro_campana",
      "carrobalista",
      "espringarda_movil",
      "trabuchet_traccion",
      "arcuballista",
      "fustibalo_campo",
      "mangonel_tactico",
      "carros_artillados",
      "ariete_movil",
      "torres_asalto",
    ];
    for (const unit of siegeUnits) {
      expect(UNITS[unit].trainingSecondsPerUnit).toBeGreaterThanOrEqual(60);
      expect(UNITS[unit].trainingSecondsPerUnit).toBeLessThanOrEqual(90);
    }
  });

  it("calcula duraciones de lote de forma estrictamente lineal sin inflar a horas", () => {
    // Lote pequeño: 10 infantería = 100 s (1 min 40 s)
    const infBatchMs = trainingDurationMs("infanteria", 10, 1.0);
    expect(infBatchMs).toBe(100_000);
    expect(infBatchMs! / 1000).toBe(100);

    // Con doctrina de entrenamiento (-5 % = 0.95): 10 infantería = 95 s
    const infBatchBonifiedMs = trainingDurationMs("infanteria", 10, 0.95);
    expect(infBatchBonifiedMs).toBe(95_000);

    // Lote mediano: 20 arquería = 300 s (5 min)
    const archBatchMs = trainingDurationMs("arqueria", 20, 1.0);
    expect(archBatchMs).toBe(300_000);
    expect(archBatchMs! / 1000).toBe(300);

    // Lote mediano: 10 caballería = 300 s (5 min)
    const cavBatchMs = trainingDurationMs("caballeria", 10, 1.0);
    expect(cavBatchMs).toBe(300_000);
    expect(cavBatchMs! / 1000).toBe(300);

    // Lote de asedio: 2 trabuchets de tracción (75 s c/u) = 150 s (2 min 30 s)
    const siegeBatchMs = trainingDurationMs("trabuchet_traccion", 2, 1.0);
    expect(siegeBatchMs).toBe(150_000);
    expect(siegeBatchMs! / 1000).toBe(150);

    // Lote de asedio pesado: 1 torre de asalto = 90 s (1 min 30 s)
    const towerBatchMs = trainingDurationMs("torres_asalto", 1, 1.0);
    expect(towerBatchMs).toBe(90_000);
    expect(towerBatchMs! / 1000).toBe(90);
  });

  it("comprueba que todas las unidades de asedio especializadas heredan los modificadores en Vikingos, Japoneses y Navajos", () => {
    const specializedSiegeUnits: UnitType[] = [
      "onagro_campana",
      "carrobalista",
      "espringarda_movil",
      "trabuchet_traccion",
      "arcuballista",
      "fustibalo_campo",
      "mangonel_tactico",
      "carros_artillados",
      "ariete_movil",
      "torres_asalto",
    ];

    for (const unit of specializedSiegeUnits) {
      expect(isSiegeUnit(unit)).toBe(true);

      // Vikingos: +15 % duración en asedio (1.15)
      expect(civilizationTrainingDurationMultiplier(unit, "vikingos")).toBe(1.15);
      const vikingDuration = applyCivilizationTrainingDuration(unit, 10_000, "vikingos");
      expect(vikingDuration).toBe(11_500);

      // Japoneses: +10 % duración en asedio (1.10)
      expect(civilizationTrainingDurationMultiplier(unit, "japoneses")).toBe(1.10);
      const japaneseDuration = applyCivilizationTrainingDuration(unit, 10_000, "japoneses");
      expect(japaneseDuration).toBe(11_000);

      // Navajos: +10 % duración en asedio (1.10)
      expect(civilizationTrainingDurationMultiplier(unit, "navajos")).toBe(1.10);
      const navajoDuration = applyCivilizationTrainingDuration(unit, 10_000, "navajos");
      expect(navajoDuration).toBe(11_000);

      // Civilización neutral (ej. Bizantinos): factor 1.0
      expect(civilizationTrainingDurationMultiplier(unit, "bizantinos")).toBe(1.0);
    }
  });

  it("comprueba que el plan de reclutamiento usa exactamente trainingSecondsPerUnit * count * 1000 * modifier", () => {
    const plan = createTrainingPlan({
      unitType: "infanteria",
      count: 15,
      level: 1,
      buildingLevels: { cuartel: 2, castillo: 2 },
      resources: { gold: 5000, wood: 5000, stone: 5000, iron: 5000, food: 5000 },
      availableCivil: 100,
      activeTraining: [],
      durationModifier: 1.0,
      now: 1_000_000,
    });
    expect(plan.success).toBe(true);
    if (plan.success) {
      expect(plan.plan.durationMs).toBe(15 * 10 * 1000);
      expect(plan.plan.completesAt).toBe(1_000_000 + 150_000);
      expect(plan.plan.populationReserved).toBe(15);
    }
  });

  it("comprueba que las cuatro unidades/familias de asedio (Ariete, Catapulta, Fundíbulo y Maquinaria Pesada) están en la categoría 'asedio', reciben 'formation.asedio' y Maquinaria Pesada respeta los controles de formación", () => {
    // Unidades representativas de las 4 familias de asedio:
    // - Ariete: ariete_movil
    // - Catapulta: onagro_campana (y mangonel_tactico)
    // - Fundíbulo: fustibalo_campo (y trabuchet_traccion)
    // - Maquinaria Pesada: torres_asalto (y asedio genérico / carros_artillados)
    const ariete: UnitType = "ariete_movil";
    const catapulta: UnitType = "onagro_campana";
    const fundibulo: UnitType = "fustibalo_campo";
    const maquinariaPesada: UnitType = "torres_asalto";

    const fourSiegeUnits = [ariete, catapulta, fundibulo, maquinariaPesada];

    // 1. Inclusión estricta en la categoría de asedio y naturaleza mecánica
    for (const u of fourSiegeUnits) {
      expect(getUnitCategory(u)).toBe("asedio");
      expect(isSiegeUnit(u)).toBe(true);
      expect(UNITS[u].isLivingTroop).toBe(false);
    }

    // 2. Composición de prueba combinada
    const comp = {
      ...emptyComposition(),
      ariete_movil: 10,
      onagro_campana: 20,
      fustibalo_campo: 30,
      torres_asalto: 40,
    };

    // 3. Aplicación correcta del factor genérico "formation.asedio" (50%)
    const formedDefault = applyFormation(comp, { asedio: 0.5 });
    expect(formedDefault.ariete_movil).toBe(5);
    expect(formedDefault.onagro_campana).toBe(10);
    expect(formedDefault.fustibalo_campo).toBe(15);
    expect(formedDefault.torres_asalto).toBe(20);

    // 4. Prueba específica para Maquinaria Pesada respetando controles de formación individuales:
    // Asedio general al 25%, pero Maquinaria Pesada (torres_asalto) configurada individualmente al 100%
    const formedCustom = applyFormation(comp, { asedio: 0.25, torres_asalto: 1.0 });
    expect(formedCustom.ariete_movil).toBe(3);   // round(10 * 0.25) = 3
    expect(formedCustom.onagro_campana).toBe(5);  // round(20 * 0.25) = 5
    expect(formedCustom.fustibalo_campo).toBe(8); // round(30 * 0.25) = 8
    expect(formedCustom.torres_asalto).toBe(40);  // round(40 * 1.0) = 40 (respeta control específico)

    // Maquinaria Pesada excluida selectivamente (0%) mientras el resto de asedio participa al 100%
    const formedExcluded = applyFormation(comp, { asedio: 1.0, torres_asalto: 0 });
    expect(formedExcluded.torres_asalto).toBe(0);
    expect(formedExcluded.ariete_movil).toBe(10);
    expect(formedExcluded.onagro_campana).toBe(20);
    expect(formedExcluded.fustibalo_campo).toBe(30);
  });
});

describe("Precisión Temporal de Construcción", () => {
  it("conserva la precisión exacta en milisegundos en durationForTargetLevel sin redondeo prematuro a segundos", () => {
    // Viviendas (5 s base = 5.000 ms): Nivel 2 -> 5.050 ms (5,05 s, no 6.000 ms)
    const viviendasN2 = durationForTargetLevel(BUILDING_RULES.viviendas.baseDurationMs!, 2);
    expect(viviendasN2).toBe(5_050);

    // Castillo (180 s base = 180.000 ms): Nivel 2 -> 181.800 ms (181,8 s, no 182.000 ms)
    const castilloN2 = durationForTargetLevel(BUILDING_RULES.castillo.baseDurationMs!, 2);
    expect(castilloN2).toBe(181_800);

    // Cantera (15 s base = 15.000 ms): Nivel 2 -> 15.150 ms (15,15 s, no 16.000 ms)
    const canteraN2 = durationForTargetLevel(BUILDING_RULES.cantera.baseDurationMs!, 2);
    expect(canteraN2).toBe(15_150);

    // Con tecnología construction_1 (0.95): Viviendas Nivel 2 -> ceil(5050 * 0.95) = 4.798 ms
    const viviendasN2ConTech = durationForTargetLevel(BUILDING_RULES.viviendas.baseDurationMs!, 2, 0.95);
    expect(viviendasN2ConTech).toBe(4_798);
  });
});
