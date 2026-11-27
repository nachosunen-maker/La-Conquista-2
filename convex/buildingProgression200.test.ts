/**
 * LA CONQUISTA — PUNTO 5: PROGRESIÓN MATEMÁTICA COMPLETA DE EDIFICIOS (NIVELES 1 A 200)
 *
 * Pruebas automatizadas independientes sobre los 18 edificios oficiales y los 200 niveles (3.600 casos):
 * - Cálculos esperados independientes de las funciones bajo prueba.
 * - Verificación de costes (1.15^(n-1)), duraciones (1 + 0.01*(n-1)), redondeos y reembolsos (50%).
 * - Auditoría numérica: safe integers por recurso, BigInt para agregados > MAX_SAFE_INTEGER, 0 NaN/Infinity/negativos.
 * - Escalado funcional real de los 18 edificios en niveles 1..200.
 * - Requisitos, excepción de Viviendas, tope del Castillo, no salto de nivel, rechazo de nivel 201 y coherencia backend/UI.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { createTestBackend } from "./test.setup";
import {
  BUILDINGS,
  CONSTRUCTION,
  HOSPITAL,
  HOSPITAL_RECOVERY_CAP,
  INITIAL_BUILDINGS,
  MERCENARIES,
  RESEARCH,
  TECH_EFFECT_CAPS,
  TIME,
  WELLBEING,
} from "./balanceConfig";
import {
  BUILDING_RULES,
  MAX_BUILDING_LEVEL,
  calculateBuildingWorkerCapacity,
  calculateConstructionCancellationRefund,
  calculateJobCapacities,
  calculateResidentialCapacity,
  costsForTargetLevel,
  createConstructionPlan,
  describeCatalogForLevels,
  durationForTargetLevel,
  getMaxAllowedBuildingLevel,
  validateBuildingCollection,
  validateConstructionCompletion,
} from "./buildingRules";
import { calculateHospitalRecovery, computeSideFactors, emptyComposition, wallsDefenseBonus, type BattleSide } from "./battleRules";
import {
  availableArmorTiers,
  availableMercenaryTypes,
  availableMilitaryLevels,
  availableWeaponTiers,
  createSpyRecruitmentPlan,
  createTrainingPlan,
  trainingQueueSlots,
  validateMercenaryHire,
  type TrainingQueueEntry,
} from "./armyRules";
import {
  TECHNOLOGY_CATALOG,
  computeTechnologyModifiers,
  createResearchPlan,
  evaluateTechnologyStatus,
  researchSlots,
  type ResearchQueueEntry,
} from "./technologyRules";
import { calculateExchange, getMarketFee } from "./marketRules";
import { validateNewChallenge } from "./challengeRules";
import {
  PROFESSION_BUILDING_CAPACITY,
  computeProfessionEffects,
  simulateExtendedEconomy,
  storageCapacity,
  type ExtendedEconomyInput,
} from "./economyExtended";

const T0 = new Date("2026-10-17T10:00:00Z").getTime();
const RESOURCES = ["gold", "wood", "stone", "iron", "food"] as const;
const BUILDING_TYPES = Object.keys(BUILDINGS);

function identity(subject: string) {
  return { subject, tokenIdentifier: `https://accounts.google.com|${subject}`, issuer: "https://accounts.google.com" };
}

/** Fórmula histórica independiente de costes (no reutiliza costsForTargetLevel). */
function independentCost(baseCost: number, targetLevel: number, costMultiplier: number = 1): number {
  const clampedMult = Math.max(0.75, Math.min(1, costMultiplier));
  const growth = 1.15 ** (targetLevel - 1);
  const multiplier = growth * clampedMult;
  return Math.round(baseCost * multiplier);
}

/** Fórmula histórica independiente de duración en ms (no reutiliza durationForTargetLevel). */
function independentDurationMs(baseDurationSeconds: number, targetLevel: number, durationModifier: number = 1): number {
  const baseMs = Math.max(1000, Math.round(baseDurationSeconds * 1000 * 1.0));
  return Math.ceil(baseMs * (1 + 0.01 * (targetLevel - 1)) * durationModifier);
}

/** Fórmula independiente de reembolso por cancelación. */
function independentRefund(paid: number): number {
  return Math.floor(paid * 0.5);
}

describe("Punto 5 — Auditoría de catálogo, constantes y matriz completa 18 × 200 (3.600 casos)", () => {
  test("mantiene intactas las constantes históricas maestras y el catálogo oficial de 18 edificios", () => {
    expect(CONSTRUCTION.MAX_LEVEL).toBe(200);
    expect(MAX_BUILDING_LEVEL).toBe(200);
    expect(CONSTRUCTION.COST_GROWTH_PER_LEVEL).toBe(0.15);
    expect(CONSTRUCTION.DURATION_INCREASE_PER_LEVEL).toBe(0.01);
    expect(CONSTRUCTION.GLOBAL_DURATION_MULTIPLIER).toBe(1.0);
    expect(CONSTRUCTION.CASTLE_CAPS_LEVELS).toBe(true);
    expect(CONSTRUCTION.CANCEL_REFUND_RATIO).toBe(0.5);
    expect(CONSTRUCTION.MAX_CONCURRENT).toBe(2);
    expect(BUILDING_TYPES).toHaveLength(18);
    expect(Object.keys(BUILDING_RULES)).toHaveLength(18);
  });

  test("valida los 3.600 casos de costes y duraciones (18 edificios × niveles 1..200) frente a cálculo independiente", () => {
    let validatedCases = 0;

    for (const type of BUILDING_TYPES) {
      const config = BUILDINGS[type];
      const rule = BUILDING_RULES[type];
      expect(rule.costs).not.toBeNull();
      expect(rule.baseDurationMs).toBe(Math.max(1000, Math.round(config.baseDurationSeconds * 1000)));

      for (let level = 1; level <= 200; level++) {
        validatedCases++;
        const actualCosts = costsForTargetLevel(rule.costs!, level, 1);
        const actualDuration = durationForTargetLevel(rule.baseDurationMs!, level, 1);
        expect(actualCosts).not.toBeNull();
        expect(actualDuration).not.toBeNull();

        for (const res of RESOURCES) {
          const expected = independentCost(config.baseCosts[res], level, 1);
          const got = actualCosts![res];
          expect(got).toBe(expected);
          expect(Number.isFinite(got)).toBe(true);
          expect(Number.isSafeInteger(got)).toBe(true);
          expect(got).toBeGreaterThanOrEqual(0);
        }

        const expectedDuration = independentDurationMs(config.baseDurationSeconds, level, 1);
        expect(actualDuration).toBe(expectedDuration);
        expect(Number.isSafeInteger(actualDuration!)).toBe(true);
        expect(actualDuration!).toBeGreaterThanOrEqual(rule.baseDurationMs!);
      }
    }

    expect(validatedCases).toBe(3600);
  });

  test("aplica correctamente multiplicadores de coste [0.75, 1] (con clamping), duración y reembolso 50% hasta nivel 200", () => {
    const sampleLevels = [1, 2, 10, 20, 50, 100, 150, 182, 199, 200];

    for (const type of BUILDING_TYPES) {
      const config = BUILDINGS[type];
      const rule = BUILDING_RULES[type];

      for (const level of sampleLevels) {
        // Multiplicadores de coste: mínimo 0.75 (clamping de 0.5 -> 0.75), intermedio 0.87, máximo 1.0 (clamping de 1.25 -> 1.0)
        for (const [inputMult, expectedMult] of [
          [0.5, 0.75],
          [0.75, 0.75],
          [0.87, 0.87],
          [1.0, 1.0],
          [1.25, 1.0],
        ] as const) {
          const got = costsForTargetLevel(rule.costs!, level, inputMult)!;
          for (const res of RESOURCES) {
            const expected = independentCost(config.baseCosts[res], level, expectedMult);
            expect(got[res]).toBe(expected);
            expect(Number.isSafeInteger(got[res])).toBe(true);
          }
        }

        // Multiplicadores de duración reales: -5% tec, Romanos 0.90, mínimo real 0.504
        for (const durMod of [0.95, 0.9, 0.504]) {
          const gotDur = durationForTargetLevel(rule.baseDurationMs!, level, durMod);
          const expDur = independentDurationMs(config.baseDurationSeconds, level, durMod);
          expect(gotDur).toBe(expDur);
        }

        // Reembolso por cancelación 50% con Math.floor
        const costsNeutral = costsForTargetLevel(rule.costs!, level, 1)!;
        const refundResult = calculateConstructionCancellationRefund({
          construction: {
            buildingType: type,
            targetLevel: level,
            startedAt: 1_000,
            durationMs: durationForTargetLevel(rule.baseDurationMs!, level, 1)!,
            costs: costsNeutral,
          },
          serverTimeMs: 1_500,
        });
        expect(refundResult.success).toBe(true);
        if (refundResult.success) {
          for (const res of RESOURCES) {
            const paid = costsNeutral[res];
            const expectedRefund = independentRefund(paid);
            expect(refundResult.refund[res] ?? 0).toBe(expectedRefund);
          }
        }
      }
    }
  });

  test("auditoría numérica 1..200: seguridad individual por recurso y acumulados exactos con BigInt", () => {
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    let maxSingleResourceCost = 0;
    let grandTotalBig = 0n;
    let castleTotalBig = 0n;

    for (const type of BUILDING_TYPES) {
      const cumByRes: Record<(typeof RESOURCES)[number], bigint> = {
        gold: 0n,
        wood: 0n,
        stone: 0n,
        iron: 0n,
        food: 0n,
      };
      for (let level = 1; level <= 200; level++) {
        const costs = costsForTargetLevel(BUILDINGS[type].baseCosts, level, 1)!;
        for (const res of RESOURCES) {
          const val = costs[res];
          expect(Number.isSafeInteger(val)).toBe(true);
          if (val > maxSingleResourceCost) maxSingleResourceCost = val;
          cumByRes[res] += BigInt(val);
        }
      }
      let buildingSumBig = 0n;
      for (const res of RESOURCES) {
        // Todos los acumulados por recurso individual caben en Number.MAX_SAFE_INTEGER
        expect(cumByRes[res] <= maxSafe).toBe(true);
        buildingSumBig += cumByRes[res];
      }
      if (type === "castillo") castleTotalBig = buildingSumBig;
      grandTotalBig += buildingSumBig;
    }

    // Castillo nivel 200 madera/piedra = round(800 * 1.15^199) = 959_312_751_649_111
    expect(maxSingleResourceCost).toBe(959_312_751_649_111);
    expect(maxSingleResourceCost).toBeLessThan(Number.MAX_SAFE_INTEGER);
    // El acumulado multi-recurso del Castillo y el global de 18 edificios exceden MAX_SAFE_INTEGER -> verificados por BigInt
    expect(castleTotalBig).toBe(20_225_510_513_920_772n);
    expect(castleTotalBig > maxSafe).toBe(true);
    expect(grandTotalBig).toBe(66_468_382_279_839_686n);
  });
});

function makeEconomyInput(overrides: Partial<ExtendedEconomyInput> & {
  workers?: Partial<ExtendedEconomyInput["kingdomState"]["workers"]>;
  jobCounts?: Record<string, number>;
  population?: number;
  unassignedCivil?: number;
  resources?: Partial<ExtendedEconomyInput["kingdomState"]["resources"]>;
} = {}): ExtendedEconomyInput {
  const { workers, jobCounts, population, unassignedCivil, resources, ...rest } = overrides;
  const baseWorkers = {
    agriculture: 0,
    wood: 0,
    stone: 0,
    iron: 0,
    gold: 0,
    other: 0,
    ...workers,
  };
  const assignedSum =
    baseWorkers.agriculture + baseWorkers.wood + baseWorkers.stone + baseWorkers.iron + baseWorkers.gold + baseWorkers.other;
  const totalPop = population ?? Math.max(assignedSum, 2000);
  const freePop = unassignedCivil ?? Math.max(0, totalPop - assignedSum);
  return {
    kingdomState: {
      userId: "p5-sim",
      name: "Simulación P5",
      population: totalPop,
      regularSoldiers: 0,
      workers: baseWorkers,
      unassignedCivil: freePop,
      resources: { gold: 0, wood: 0, stone: 0, iron: 0, food: 10_000_000, ...resources },
      foodTier: "normal",
      lastUpdated: T0,
      jobCounts,
    },
    now: T0 + TIME.SECONDS_PER_GAME_YEAR * 1000, // exactamente 1 día de juego
    jobCapacities: { agriculture: 0, wood: 0, stone: 0, iron: 0, gold: 0 },
    residentialCapacity: 100_000,
    technologyModifiers: computeTechnologyModifiers([]),
    taxRate: 0,
    happiness: WELLBEING.INITIAL_HAPPINESS,
    starvationSeconds: 0,
    buildingLevels: { castillo: 200 },
    militaryPersonnel: 0,
    restPolicy: "normal",
    civilization: "mongoles", // economía sin pasivas de producción/almacén/residencial/felicidad
    ...rest,
  };
}

describe("Punto 5 — Escalado funcional real de todos los edificios en niveles 1..200", () => {
  test("productivos y Viviendas contrastados con el motor económico real (simulateExtendedEconomy) en niveles 1..200", () => {
    const prodSpec: ReadonlyArray<{
      building: "granja" | "aserradero" | "cantera" | "minaHierro" | "minaOro";
      job: "agriculture" | "wood" | "stone" | "iron" | "gold";
      resource: "food" | "wood" | "stone" | "iron" | "gold";
      perLevel: number;
      expectedRatePerWorker: number;
    }> = [
      { building: "granja", job: "agriculture", resource: "food", perLevel: 100, expectedRatePerWorker: 6 },
      { building: "aserradero", job: "wood", resource: "wood", perLevel: 80, expectedRatePerWorker: 6 },
      { building: "cantera", job: "stone", resource: "stone", perLevel: 80, expectedRatePerWorker: 6 },
      { building: "minaHierro", job: "iron", resource: "iron", perLevel: 60, expectedRatePerWorker: 6 },
      { building: "minaOro", job: "gold", resource: "gold", perLevel: 50, expectedRatePerWorker: 3 },
    ];

    for (let level = 1; level <= 200; level++) {
      // 1. Viviendas: capacidad residencial lineal + impacto real en sobrecupo y crecimiento de población
      const baseBeds = calculateResidentialCapacity([{ buildingType: "viviendas", level }], 0)!;
      expect(baseBeds).toBe(level * 1000);
      expect(calculateResidentialCapacity([{ buildingType: "viviendas", level }], TECH_EFFECT_CAPS.housingCapacity)).toBe(
        Math.round(level * 1000 * 1.3)
      );

      const simAtCap = simulateExtendedEconomy(
        makeEconomyInput({
          population: baseBeds,
          unassignedCivil: baseBeds,
          residentialCapacity: baseBeds,
          buildingLevels: { castillo: 200, viviendas: level, mercado: 200 },
        })
      );
      expect(simAtCap.population.residentialCapacity).toBe(baseBeds);
      // Sin hacinamiento cuando población == capacidad (felicidad diaria sin penalización -2)
      expect(simAtCap.happiness.dailyDelta).toBe(0);

      const simOverCap = simulateExtendedEconomy(
        makeEconomyInput({
          population: baseBeds + 1,
          unassignedCivil: baseBeds + 1,
          residentialCapacity: baseBeds,
          buildingLevels: { castillo: 200, viviendas: level, mercado: 200 },
        })
      );
      expect(simOverCap.population.growthCappedByHousing).toBe(true);
      expect(simOverCap.population.births).toBe(0);
      expect(simOverCap.happiness.dailyDelta).toBe(WELLBEING.OVERCROWDING_PENALTY);

      // 2. Edificios productivos: capacidad + tope real de trabajadores efectivos y producción diaria en simulateExtendedEconomy
      for (const spec of prodSpec) {
        const cap = calculateBuildingWorkerCapacity([{ buildingType: spec.building, level }], spec.building);
        expect(cap).toBe(level * spec.perLevel);
        const jobs = calculateJobCapacities([{ buildingType: spec.building, level }])!;
        expect(jobs[spec.job]).toBe(level * spec.perLevel);

        const overAssigned = level * spec.perLevel + 50;
        const sim = simulateExtendedEconomy(
          makeEconomyInput({
            population: overAssigned,
            unassignedCivil: 0,
            workers: { [spec.job]: overAssigned },
            resources: { food: 1_000_000 },
            jobCapacities: jobs,
            residentialCapacity: 200_000,
            buildingLevels: { castillo: 200, [spec.building]: level, mercado: 200 },
          })
        );
        //Nota: foodProductionWorkerLimit se pasa en KingdomState cuando la economía adapta Granja
        expect(sim.effectiveWorkers[spec.job]).toBe(
          spec.building === "granja" ? overAssigned : level * spec.perLevel
        );
        if (spec.building !== "granja") {
          const expectedDaily = level * spec.perLevel * spec.expectedRatePerWorker;
          expect(sim.dailyProduction[spec.resource]).toBe(expectedDaily);
          expect(sim.updatedResources[spec.resource]).toBe(expectedDaily);
        }
      }

      // Contraste específico de Granja vía foodProductionWorkerLimit (como hace economyAdapter.ts) en todos los niveles 1..200
      const granjaCap = calculateJobCapacities([{ buildingType: "granja", level }])!;
      const overFarmers = level * 100 + 50;
      const foodInput = makeEconomyInput({
        population: overFarmers,
        unassignedCivil: 0,
        workers: { agriculture: overFarmers },
        resources: { food: 0 },
        jobCapacities: granjaCap,
        residentialCapacity: 200_000,
        buildingLevels: { castillo: 200, granja: level, mercado: 200 },
      });
      foodInput.kingdomState.foodProductionWorkerLimit = granjaCap.agriculture;
      const foodSim = simulateExtendedEconomy(foodInput);
      expect(foodSim.effectiveWorkers.agriculture).toBe(level * 100);
      expect(foodSim.dailyProduction.food).toBe(level * 100 * 6);
    }

    // Valores exactos de Viviendas con pasiva de Chinos en nivel 200 y descarte por almacén si Mercado es bajo
    const simChinos = simulateExtendedEconomy(
      makeEconomyInput({
        population: 273_000,
        unassignedCivil: 273_000,
        residentialCapacity: calculateResidentialCapacity([{ buildingType: "viviendas", level: 200 }], TECH_EFFECT_CAPS.housingCapacity),
        civilization: "chinos",
        buildingLevels: { castillo: 200, viviendas: 200, mercado: 200 },
      })
    );
    expect(simChinos.happiness.dailyDelta).toBe(0); // 260.000 * 1,05 = 273.000 -> sin hacinamiento

    const aserradero200Jobs = calculateJobCapacities([{ buildingType: "aserradero", level: 200 }])!;
    const simCappedByMercado1 = simulateExtendedEconomy(
      makeEconomyInput({
        population: 16_000,
        unassignedCivil: 0,
        workers: { wood: 16_000 },
        jobCapacities: aserradero200Jobs,
        buildingLevels: { castillo: 200, aserradero: 200, mercado: 1 },
      })
    );
    expect(simCappedByMercado1.dailyProduction.wood).toBe(96_000);
    expect(simCappedByMercado1.storageCapacity).toBe(12_000);
    expect(simCappedByMercado1.updatedResources.wood).toBe(12_000);
    expect(simCappedByMercado1.wastedByStorage.wood).toBe(84_000);
  });

  test("Cuartel (1..200): capacidad real de espías vía createSpyRecruitmentPlan, colas y desbloqueos militares", () => {
    // Nivel 1: createSpyRecruitmentPlan exige Cuartel nivel 2 -> capacidad efectiva 0
    const spyLvl1 = createSpyRecruitmentPlan({
      count: 1,
      resources: { gold: 1e9, wood: 1e9, stone: 1e9, iron: 1e9, food: 1e9 },
      availableCivil: 1000,
      buildingLevels: { cuartel: 1 },
      activeTraining: [],
      activeSpies: 0,
      busySpies: 0,
      inQueueSpies: 0,
      now: T0,
    });
    expect(spyLvl1.success).toBe(false);
    if (!spyLvl1.success) expect(spyLvl1.error).toContain("Cuartel nivel 2");
    expect(trainingQueueSlots(1)).toBe(1);

    // Niveles 2..200: contraste directo contra createSpyRecruitmentPlan, createTrainingPlan y availableMilitaryLevels
    let prevSpyCap = 0;
    for (let level = 2; level <= 200; level++) {
      const expectedSpyCap = Math.floor(level / 2);

      // Cambio de tramo en niveles pares (2->1, 4->2, ..., 200->100) y constante en impares
      if (level % 2 === 0) {
        expect(expectedSpyCap).toBe(prevSpyCap + 1);
      } else {
        expect(expectedSpyCap).toBe(prevSpyCap);
      }
      prevSpyCap = expectedSpyCap;

      // Admite hasta expectedSpyCap contando activos + heridos + en misión + en cola
      const okSpy = createSpyRecruitmentPlan({
        count: 1,
        resources: { gold: 1e9, wood: 1e9, stone: 1e9, iron: 1e9, food: 1e9 },
        availableCivil: 1000,
        buildingLevels: { cuartel: level },
        activeTraining: [],
        activeSpies: Math.max(0, expectedSpyCap - 1),
        woundedSpies: 0,
        busySpies: 0,
        inQueueSpies: 0,
        now: T0,
      });
      expect(okSpy.success).toBe(true);
      if (okSpy.success) {
        expect(okSpy.capacity).toBe(expectedSpyCap);
        expect(okSpy.occupied).toBe(expectedSpyCap - 1);
      }

      // Rechaza estrictamente al alcanzar el tope del nivel
      const blockedSpy = createSpyRecruitmentPlan({
        count: 1,
        resources: { gold: 1e9, wood: 1e9, stone: 1e9, iron: 1e9, food: 1e9 },
        availableCivil: 1000,
        buildingLevels: { cuartel: level },
        activeTraining: [],
        activeSpies: Math.max(0, expectedSpyCap - 2),
        woundedSpies: 1,
        busySpies: 1,
        inQueueSpies: 0,
        now: T0,
      });
      expect(blockedSpy.success).toBe(false);
      if (!blockedSpy.success) {
        expect(blockedSpy.error).toContain(`capacidad: ${expectedSpyCap}`);
      }

      // Colas de entrenamiento: 1 (1-2), 2 (3-5), 3 (6-8), 4 (9..200) aplicadas por createTrainingPlan
      const expectedQueues = level >= 9 ? 4 : level >= 6 ? 3 : level >= 3 ? 2 : 1;
      expect(trainingQueueSlots(level)).toBe(expectedQueues);
      const fakeQueue: TrainingQueueEntry[] = Array.from({ length: expectedQueues - 1 }, () => ({
        unitType: "infanteria",
        count: 1,
        level: 1,
        startedAt: T0,
        durationMs: 10_000,
        costs: { gold: 10 },
        populationReserved: 1,
      }));
      const slotAvailable = createTrainingPlan({
        unitType: "infanteria",
        count: 1,
        level: 1,
        resources: { gold: 1e6, wood: 1e6, stone: 1e6, iron: 1e6, food: 1e6 },
        availableCivil: 100,
        buildingLevels: { castillo: 200, cuartel: level },
        activeTraining: fakeQueue,
        now: T0,
      });
      expect(slotAvailable.success).toBe(true);
      const slotFull = createTrainingPlan({
        unitType: "infanteria",
        count: 1,
        level: 1,
        resources: { gold: 1e6, wood: 1e6, stone: 1e6, iron: 1e6, food: 1e6 },
        availableCivil: 100,
        buildingLevels: { castillo: 200, cuartel: level },
        activeTraining: [
          ...fakeQueue,
          { unitType: "infanteria", count: 1, level: 1, startedAt: T0, durationMs: 10_000, costs: { gold: 10 }, populationReserved: 1 },
        ],
        now: T0,
      });
      expect(slotFull.success).toBe(false);

      // Desbloqueos militares saturan en nivel 5 (constante en 5..200)
      const unlockedTiers = availableMilitaryLevels({
        castillo: 200,
        cuartel: level,
        universidad: 200,
        herreria: 200,
      }).map((m) => m.level);
      if (level >= 5) {
        expect(unlockedTiers).toEqual([1, 2, 3, 4, 5]);
      } else {
        expect(unlockedTiers).toEqual(Array.from({ length: level }, (_, i) => i + 1));
      }
    }
  });

  test("resto de los 18 edificios (Castillo, Parlamento, Mercado, Murallas, Herrería, Universidad, Hospital, Taberna, Panadería, Iglesia, Circo) en niveles 1..200", () => {
    const emptyComp = emptyComposition();
    const defSideBase: BattleSide = {
      kingdomId: "def",
      name: "Defensor",
      composition: { ...emptyComp, infanteria: 100 },
      trainingMultiplier: 1,
      weaponTier: "palo",
      armorTier: "ninguna",
      strategy: "defensiva",
      morale: 80,
      foodTier: "normal",
      fatigue: 0,
      wallsLevel: 0,
      terrainDefenseBonus: 0,
    };
    const atkWithSiege: BattleSide = {
      ...defSideBase,
      kingdomId: "atk",
      name: "Atacante",
      composition: { ...emptyComp, asedio: 10 },
      strategy: "agresiva",
    };

    const baselineWall0 = computeSideFactors(defSideBase, defSideBase.composition, atkWithSiege).defensivePower;
    const atkVsWall0 = computeSideFactors(atkWithSiege, atkWithSiege.composition, defSideBase).offensiveStrength;
    const atkVsWall1 = computeSideFactors(atkWithSiege, atkWithSiege.composition, { ...defSideBase, wallsLevel: 1 }).offensiveStrength;
    expect(atkVsWall1).toBeGreaterThan(atkVsWall0); // Murallas > 0 activa ataque pleno de asedio

    // Parlamento nivel 0 rechazado
    expect(
      validateNewChallenge({
        challengerKingdomId: "k1",
        targetKingdomId: "k2",
        challengerParliamentLevel: 0,
        targetParliamentLevel: 1,
        existing: [],
        now: T0,
      }).success
    ).toBe(false);

    // Iglesia y Circo en nivel 0 no suman bono +1 edificio
    const simNoBienestar = simulateExtendedEconomy(
      makeEconomyInput({
        buildingLevels: { castillo: 200, iglesia: 0, circo: 0 },
      })
    );
    expect(simNoBienestar.happiness.dailyDelta).toBe(0);

    let hospital200Effective = 0;
    let wall10DefensePower = 0;

    for (let level = 1; level <= 200; level++) {
      // 1. Castillo: topes generales + Viviendas + tope de desbloqueos militares desde nv. 8
      expect(getMaxAllowedBuildingLevel("castillo", level)).toBe(200);
      expect(getMaxAllowedBuildingLevel("mercado", level)).toBe(level);
      expect(getMaxAllowedBuildingLevel("viviendas", level)).toBe(
        level <= 2 ? 20 : Math.min(200, level + 18)
      );
      if (level >= 8) {
        expect(
          availableMilitaryLevels({ castillo: level, cuartel: 200, universidad: 200, herreria: 200 }).map((m) => m.level)
        ).toEqual([1, 2, 3, 4, 5]);
      }

      // 2. Parlamento: puerta binaria constante en 1..200
      expect(
        validateNewChallenge({
          challengerKingdomId: "k1",
          targetKingdomId: "k2",
          challengerParliamentLevel: level,
          targetParliamentLevel: 1,
          existing: [],
          now: T0,
        }).success
      ).toBe(true);

      // 3. Mercado: almacenamiento continuo en simulateExtendedEconomy + comisión real en calculateExchange + sin oficio activo
      const expectedStorage = 10_000 + 2_000 * level;
      expect(storageCapacity(level, 1)).toBe(expectedStorage);
      const simStorage = simulateExtendedEconomy(
        makeEconomyInput({
          population: 16_000,
          unassignedCivil: 0,
          workers: { wood: 16_000 },
          resources: { wood: 0 },
          jobCapacities: { agriculture: 0, wood: 16_000, stone: 0, iron: 0, gold: 0 },
          buildingLevels: { castillo: 200, aserradero: 200, mercado: level },
        })
      );
      expect(simStorage.storageCapacity).toBe(expectedStorage);
      expect(simStorage.updatedResources.wood).toBe(Math.min(96_000, expectedStorage));
      const fee = getMarketFee(level);
      expect(fee.feeRate).toBeCloseTo(1 / (level + 6), 12);
      if (level >= 4) {
        // 100 oro = 500 madera brutos -> neto = floor(500 * (level+5)/(level+6))
        const ex = calculateExchange("gold", "wood", 100, level);
        expect(ex.valid).toBe(true);
        expect(ex.toAmount).toBe(Math.floor((500 * (level + 5)) / (level + 6)));
      }

      // 4. Murallas: +5%/nv. en 1..10, constante en 10..200 dentro de computeSideFactors
      const expectedWalls = Math.min(0.5, level * 0.05);
      expect(wallsDefenseBonus(level)).toBeCloseTo(expectedWalls, 12);
      const factors = computeSideFactors({ ...defSideBase, wallsLevel: level }, defSideBase.composition, atkWithSiege);
      expect(factors.wallsBonus).toBeCloseTo(expectedWalls, 12);
      expect(factors.defensivePower).toBeGreaterThan(baselineWall0);
      if (level === 10) wall10DefensePower = factors.defensivePower;
      if (level > 10) expect(factors.defensivePower).toBe(wall10DefensePower);

      // 5. Herrería: desbloqueos hasta nv. 4/5, constante en 5..200; sin oficio productivo en 1..200
      const weaponsBase = availableWeaponTiers({ herreria: level, minaHierro: 1 }, []);
      const weaponsWithTech = availableWeaponTiers({ herreria: level, minaHierro: 1 }, ["acero", "aceroAvanzado"]);
      const armorsBase = availableArmorTiers({ herreria: level, minaHierro: 1 }, []);
      const armorsWithTech = availableArmorTiers({ herreria: level, minaHierro: 1 }, ["acero"]);
      expect(weaponsBase).toHaveLength(level >= 2 ? 3 : 2); // palo, lanzaBasica, espadaHierro
      expect(weaponsWithTech).toHaveLength(level >= 4 ? 5 : level >= 2 ? 3 : 2); // +acero, +aceroAvanzado en nv. 4
      expect(armorsBase).toHaveLength(level >= 3 ? 4 : level >= 2 ? 3 : 2); // ninguna, piel, cueroReforzado, hierro
      expect(armorsWithTech).toHaveLength(level >= 4 ? 5 : level >= 3 ? 4 : level >= 2 ? 3 : 2); // +acero en nv. 4
      if (level >= 5) {
        expect(
          availableMilitaryLevels({ castillo: 200, cuartel: 200, universidad: 200, herreria: level }).map((m) => m.level)
        ).toEqual([1, 2, 3, 4, 5]);
      }

      // 6. Universidad: ranuras 1/2/3 + createResearchPlan; constante desde nv. 5 hasta 200
      const expectedSlots = level >= 5 ? 3 : level >= 3 ? 2 : 1;
      expect(researchSlots(level)).toBe(expectedSlots);
      const fakeResearchQueue: ResearchQueueEntry[] = Array.from({ length: expectedSlots }, (_, idx) => ({
        technologyId: `agri_${idx + 1}`,
        startedAt: T0,
        durationMs: 10_000,
        costs: { gold: 10 },
      }));
      const fullResearch = createResearchPlan({
        technologyId: "storage_1",
        resources: { gold: 1e6, wood: 1e6, stone: 1e6, iron: 1e6, food: 1e6 },
        completedIds: [],
        activeResearch: fakeResearchQueue,
        buildingLevels: { castillo: 200, universidad: level },
        now: T0,
      });
      expect(fullResearch.success).toBe(false);
      // Tecnología de nivel 5 ("mining_8" requiere universidad 5) solo disponible desde nv. 5 y constante 5..200
      const techLvl5Status = evaluateTechnologyStatus({
        technology: TECHNOLOGY_CATALOG.mining_8,
        completedIds: new Set(["mining_1", "mining_2", "mining_3", "mining_4", "mining_5", "mining_6"]),
        researchingIds: new Set(),
        buildingLevels: { castillo: 200, universidad: level },
      });
      expect(techLvl5Status.status).toBe(level >= 5 ? "available" : "locked");

      // 7. Hospital militar: camas = 100*nivel continuo 1..200 + tasa base tope en nv. 5 + medicina tope en nv. 2
      const hospSmall = calculateHospitalRecovery({ hospitalLevel: level, totalWounded: 1, elapsedDays: 1 });
      expect(hospSmall.hospitalCapacity).toBe(level * HOSPITAL.CAPACITY_PER_LEVEL);
      const expectedBaseRec = level === 1 ? 0.15 : level === 2 ? 0.22 : level === 3 ? 0.3 : level === 4 ? 0.4 : 0.5;
      expect(hospSmall.baseRecoveryRatio).toBe(expectedBaseRec);
      expect(hospSmall.effectiveRecoveryRatio).toBeLessThanOrEqual(HOSPITAL_RECOVERY_CAP);
      // Con 25.000 heridos (por encima de 20.000 camas), la tasa efectiva ponderada sigue aumentando hasta el nivel 200
      const hospOver = calculateHospitalRecovery({ hospitalLevel: level, totalWounded: 25_000, elapsedDays: 1 });
      if (level >= 5) {
        expect(hospOver.effectiveRecoveryRatio).toBeGreaterThan(hospital200Effective);
        hospital200Effective = hospOver.effectiveRecoveryRatio;
      }

      // 8. Taberna: mercenarios máximos = 50*nivel hasta 10.000 + tipos desbloqueados en 1..5 (constante en 5..200)
      const mercTypes = availableMercenaryTypes(level);
      const expectedMercTypes = level >= 5 ? 6 : level >= 4 ? 5 : level >= 3 ? 4 : level >= 2 ? 3 : 2;
      expect(mercTypes).toHaveLength(expectedMercTypes);
      expect(
        validateMercenaryHire({
          typeId: "mesnada_sueldo",
          count: level * MERCENARIES.MAX_PER_TAVERN_LEVEL,
          tavernLevel: level,
          activeMercenaries: 0,
          gold: 1e12,
        }).success
      ).toBe(true);
      expect(
        validateMercenaryHire({
          typeId: "mesnada_sueldo",
          count: level * MERCENARIES.MAX_PER_TAVERN_LEVEL + 1,
          tavernLevel: level,
          activeMercenaries: 0,
          gold: 1e12,
        }).success
      ).toBe(false);

      // 9. Panadería, Iglesia, Circo: profesiones y bonos reales contrastados con computeProfessionEffects + simulateExtendedEconomy
      const prof = computeProfessionEffects(
        { medicine: level * 50, religion: level * 40, entertainment: level * 40, bakery: level * 40 },
        { hospitalMilitar: level, iglesia: level, circo: level, panaderia: level },
        PROFESSION_BUILDING_CAPACITY
      );
      expect(prof.woundedRecoveryBonus).toBe(level === 1 ? 0.05 : 0.1);
      expect(prof.happinessPerDay).toBe(level === 1 ? 4 : 6);
      expect(prof.foodConsumptionMultiplier).toBeCloseTo(level === 1 ? 0.9 : 0.85, 12);

      // Bono binario constante de edificio (+1 Iglesia +1 Circo = +2) con 0 trabajadores
      const simBuildingOnly = simulateExtendedEconomy(
        makeEconomyInput({
          buildingLevels: { castillo: 200, iglesia: level, circo: level, panaderia: level },
        })
      );
      expect(simBuildingOnly.happiness.dailyDelta).toBe(WELLBEING.RELIGION_BONUS_WITH_CHURCH + WELLBEING.ENTERTAINMENT_BONUS_WITH_CIRCUS);

      // Efecto completo en simulateExtendedEconomy (consumo comida + felicidad) saturado en nivel 2..200
      const simFullProf = simulateExtendedEconomy(
        makeEconomyInput({
          population: 2000,
          unassignedCivil: 0,
          jobCounts: { religion: level * 40, entertainment: level * 40, bakery: level * 40 },
          buildingLevels: { castillo: 200, iglesia: level, circo: level, panaderia: level },
        })
      );
      // 2000 hab * 1 ración * panadería (0.90 en nv.1, 0.85 en nv.2..200)
      expect(simFullProf.dailyFoodConsumption).toBeCloseTo(2000 * (level === 1 ? 0.9 : 0.85), 8);
      // Felicidad delta = +2 (edificios) + 4|6 (profesiones), acotado a ±5/día al aplicar, dailyDelta bruto = 6 (nv.1) u 8 (nv.2..200)
      expect(simFullProf.happiness.dailyDelta).toBe(level === 1 ? 6 : 8);
    }

    // Edificios con workerCapacityPerLevel sin oficio asignable en calculateJobCapacities en niveles 1..200
    for (const lvl of [1, 50, 200]) {
      expect(
        calculateJobCapacities([
          { buildingType: "herreria", level: lvl },
          { buildingType: "mercado", level: lvl },
          { buildingType: "taberna", level: lvl },
        ])
      ).toEqual({ agriculture: 0, wood: 0, stone: 0, iron: 0, gold: 0 });
    }
    expect(RESEARCH.MAX_SLOTS).toBe(3);
  });
});

describe("Punto 5 — Requisitos, excepción de Viviendas, límite 200 y rechazo de nivel 201", () => {
  test("reglas puras: tope del Castillo, excepción de Viviendas en 1..200, sin saltos de nivel y rechazo de 201", () => {
    // Excepción de Viviendas en todo el rango
    expect(getMaxAllowedBuildingLevel("viviendas", 1)).toBe(20);
    expect(getMaxAllowedBuildingLevel("viviendas", 2)).toBe(20);
    expect(getMaxAllowedBuildingLevel("viviendas", 3)).toBe(21);
    expect(getMaxAllowedBuildingLevel("viviendas", 181)).toBe(199);
    expect(getMaxAllowedBuildingLevel("viviendas", 182)).toBe(200);
    expect(getMaxAllowedBuildingLevel("viviendas", 200)).toBe(200);
    expect(getMaxAllowedBuildingLevel("castillo", 1)).toBe(200);
    expect(getMaxAllowedBuildingLevel("granja", 182)).toBe(182);
    expect(getMaxAllowedBuildingLevel("granja", 200)).toBe(200);

    // Requisitos de edificio se siguen aplicando a nivel alto (ej. minaHierro requiere cantera >= 1)
    const minaBlocked = createConstructionPlan({
      buildingType: "minaHierro",
      currentLevel: 199,
      resources: { gold: 1e16, wood: 1e16, stone: 1e16, iron: 1e16, food: 0 },
      activeConstructions: [],
      buildingLevels: { castillo: 200 }, // falta cantera >= 1
      now: T0,
      rule: BUILDING_RULES.minaHierro,
    });
    expect(minaBlocked.success).toBe(false);
    if (!minaBlocked.success) expect(minaBlocked.error).toContain("Cantera");

    // Viviendas 199->200 bloqueada con Castillo 181, permitida con Castillo 182
    const vivBlocked = createConstructionPlan({
      buildingType: "viviendas",
      currentLevel: 199,
      resources: { gold: 1e16, wood: 1e16, stone: 1e16, iron: 1e16, food: 0 },
      activeConstructions: [],
      buildingLevels: { castillo: 181, viviendas: 199 },
      now: T0,
      rule: BUILDING_RULES.viviendas,
    });
    expect(vivBlocked.success).toBe(false);
    if (!vivBlocked.success) expect(vivBlocked.error).toContain("Castillo nivel 182");

    const vivAllowed = createConstructionPlan({
      buildingType: "viviendas",
      currentLevel: 199,
      resources: { gold: 1e16, wood: 1e16, stone: 1e16, iron: 1e16, food: 0 },
      activeConstructions: [],
      buildingLevels: { castillo: 182, viviendas: 199 },
      now: T0,
      rule: BUILDING_RULES.viviendas,
    });
    expect(vivAllowed.success).toBe(true);
    if (vivAllowed.success) expect(vivAllowed.plan.targetLevel).toBe(200);

    // Nivel 201 rechazado en todas las funciones de reglas puras
    expect(costsForTargetLevel(BUILDINGS.castillo.baseCosts, 201, 1)).toBeNull();
    expect(durationForTargetLevel(BUILDING_RULES.castillo.baseDurationMs!, 201, 1)).toBeNull();
    expect(validateConstructionCompletion({ buildingType: "castillo", targetLevel: 201, existingLevels: [200] }).success).toBe(false);
    expect(validateConstructionCompletion({ buildingType: "granja", targetLevel: 150, existingLevels: [148] }).success).toBe(false); // sin salto
    expect(validateBuildingCollection([{ buildingType: "castillo", level: 201 }]).success).toBe(false);
    const plan201 = createConstructionPlan({
      buildingType: "castillo",
      currentLevel: 200,
      resources: { gold: 1e16, wood: 1e16, stone: 1e16, iron: 1e16, food: 0 },
      activeConstructions: [],
      buildingLevels: { castillo: 200 },
      now: T0,
      rule: BUILDING_RULES.castillo,
    });
    expect(plan201.success).toBe(false);

    // Coherencia UI/backend: describeCatalogForLevels en nivel 200 marca nextLevel: null y castleCapSatisfied: true (sin mensaje "nivel null")
    const fullMaxLevels = Object.fromEntries(BUILDING_TYPES.map((t) => [t, 200]));
    const catalog200 = describeCatalogForLevels(fullMaxLevels);
    for (const type of BUILDING_TYPES) {
      expect(catalog200[type].currentLevel).toBe(200);
      expect(catalog200[type].nextLevel).toBeNull();
      expect(catalog200[type].nextCosts).toBeNull();
      expect(catalog200[type].nextDurationMs).toBeNull();
      expect(catalog200[type].castleCapSatisfied).toBe(true);
      expect(catalog200[type].requirementsSatisfied).toBe(true);
    }
  });
});

describe("Punto 5 — Integración completa en backend Convex (199 -> 200 y rechazo 201)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("permite completar edificios hasta nivel 200 en Convex, calcula efectos reales y rechaza 201", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p5-200"));
    const kingdom = await asUser.mutation(api.economy.getOrInitializeKingdom, {
      name: "Imperio Doscientos",
      civilization: "ingleses", // multiplicador construcción = 1.00
    });
    const kingdomId = kingdom._id as any;

    await t.run(async (ctx) => {
      const existing = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect();
      const setLvl = async (buildingType: string, level: number) => {
        const doc = existing.find((b) => b.buildingType === buildingType);
        if (doc) await ctx.db.patch(doc._id, { level });
        else await ctx.db.insert("buildings", { kingdomId, buildingType, level });
      };
      await setLvl("castillo", 199);
      await setLvl("viviendas", 199);
      await setLvl("mercado", 199);
      await setLvl("granja", 199);
      const res = await ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
      if (res) {
        await ctx.db.patch(res._id, {
          gold: 5e15,
          wood: 5e15,
          stone: 5e15,
          iron: 5e15,
          food: 5e15,
        });
      }
    });

    // Con Castillo 199, Mercado 199 -> 200 sigue bloqueado hasta completar Castillo 200
    await expect(
      asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "mercado" })
    ).rejects.toThrow(/Castillo \(nivel 199\)/i);

    // Inicia y completa Castillo 199 -> 200
    const upCastillo = await asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "castillo" });
    expect(upCastillo.targetLevel).toBe(200);
    expect(upCastillo.costs.gold).toBe(independentCost(BUILDINGS.castillo.baseCosts.gold, 200, 1));
    expect(upCastillo.costs.wood).toBe(independentCost(BUILDINGS.castillo.baseCosts.wood, 200, 1));
    expect(upCastillo.completesAt - upCastillo.startedAt).toBe(independentDurationMs(BUILDINGS.castillo.baseDurationSeconds, 200, 1));

    vi.setSystemTime(T0 + 600_000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Con Castillo ya en 200, inicia Mercado y Viviendas 199 -> 200 ocupando las 2 ranuras
    const upMercado = await asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "mercado" });
    expect(upMercado.targetLevel).toBe(200);
    expect(upMercado.costs.wood).toBe(independentCost(BUILDINGS.mercado.baseCosts.wood, 200, 1));
    expect(upMercado.completesAt - upMercado.startedAt).toBe(independentDurationMs(BUILDINGS.mercado.baseDurationSeconds, 200, 1));

    const upViviendas = await asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "viviendas" });
    expect(upViviendas.targetLevel).toBe(200);

    // Cola de 2 ocupada -> 3ª mejora rechazada
    await expect(
      asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "granja" })
    ).rejects.toThrow(/ranuras/i);

    // Completar ambas obras tras avanzar el reloj del servidor
    vi.setSystemTime(T0 + 1_200_000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Consultar estado final en nivel 200
    const state = await asUser.query(api.kingdoms.getConstructionState, { kingdomId });
    expect(state.buildingLevels.castillo).toBe(200);
    expect(state.buildingLevels.mercado).toBe(200);
    expect(state.buildingLevels.viviendas).toBe(200);
    expect(state.residentialCapacity).toBe(200_000);
    expect(state.catalogForLevels.castillo.nextLevel).toBeNull();
    expect(state.catalogForLevels.castillo.castleCapSatisfied).toBe(true);
    expect(state.catalogForLevels.viviendas.nextLevel).toBeNull();
    expect(state.catalogForLevels.viviendas.castleCapSatisfied).toBe(true);

    // Verificar efecto real de Mercado 200 en consultas del mercado y economía
    const market = await asUser.query(api.market.getMarketInfo, { kingdomId });
    expect(market).not.toBeNull();
    expect(market!.mercadoLevel).toBe(200);
    expect(market!.feeInfo!.feePercent).toBeCloseTo(100 / 206, 8);
    expect(market!.feeInfo!.retentionFactor).toBeCloseTo(205 / 206, 8);

    const settled = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    expect(settled.storageCapacity).toBe(410_000);

    // Nivel 201 estrictamente rechazado para todos
    await expect(
      asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "castillo" })
    ).rejects.toThrow(/nivel máximo.*200/i);
    await expect(
      asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "viviendas" })
    ).rejects.toThrow(/nivel máximo.*200/i);
    await expect(
      asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "mercado" })
    ).rejects.toThrow(/nivel máximo.*200/i);
  });

  test("la excepción de Viviendas en backend exige Castillo 182 para nivel 200 y rechaza cancelar obra fuera de límite", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p5-viv"));
    const kingdom = await asUser.mutation(api.economy.getOrInitializeKingdom, {
      name: "Viviendas Altas",
      civilization: "ingleses",
    });
    const kingdomId = kingdom._id as any;

    await t.run(async (ctx) => {
      const existing = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect();
      const setLvl = async (buildingType: string, level: number) => {
        const doc = existing.find((b) => b.buildingType === buildingType);
        if (doc) await ctx.db.patch(doc._id, { level });
        else await ctx.db.insert("buildings", { kingdomId, buildingType, level });
      };
      await setLvl("castillo", 181);
      await setLvl("viviendas", 199);
      const res = await ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
      if (res) await ctx.db.patch(res._id, { gold: 5e15, wood: 5e15, stone: 5e15, iron: 5e15, food: 5e15 });
    });

    await expect(
      asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "viviendas" })
    ).rejects.toThrow(/Castillo nivel 182/);

    // Subir Castillo a 182 habilita Viviendas 200
    await t.run(async (ctx) => {
      const doc = (await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect())
        .find((b) => b.buildingType === "castillo");
      if (doc) await ctx.db.patch(doc._id, { level: 182 });
    });

    const started = await asUser.mutation(api.kingdoms.startConstruction, { kingdomId, buildingType: "viviendas" });
    expect(started.targetLevel).toBe(200);

    // Cancelar reembolsa exactamente 50% con Math.floor
    const beforeCancel = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-p5-viv" });
    await asUser.mutation(api.kingdoms.cancelConstruction, { kingdomId, constructionId: started.constructionId });
    const afterCancel = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-p5-viv" });
    expect(afterCancel!.resources.gold - beforeCancel!.resources.gold).toBe(Math.floor(started.costs.gold! * 0.5));
    expect(afterCancel!.resources.wood - beforeCancel!.resources.wood).toBe(Math.floor(started.costs.wood! * 0.5));
    expect(afterCancel!.resources.stone - beforeCancel!.resources.stone).toBe(Math.floor(started.costs.stone! * 0.5));
    expect(INITIAL_BUILDINGS.viviendas).toBe(20);
  });

  test("Cuartel en backend Convex (nv. 1, 2 y 200): capacidad y reclutamiento de espías vía getArmyState y recruitSpy", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-p5-cuartel-spies"));
    const kingdom = await asUser.mutation(api.economy.getOrInitializeKingdom, {
      name: "Espionaje Doscientos",
      civilization: "ingleses",
    });
    const kingdomId = kingdom._id as any;

    const setCuartel = async (level: number) => {
      await t.run(async (ctx) => {
        const existing = await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect();
        const doc = existing.find((b) => b.buildingType === "cuartel");
        if (doc) await ctx.db.patch(doc._id, { level });
        else await ctx.db.insert("buildings", { kingdomId, buildingType: "cuartel", level });

        const res = await ctx.db.query("resources").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
        if (res) await ctx.db.patch(res._id, { gold: 1e12, wood: 1e12, stone: 1e12, iron: 1e12, food: 1e12 });

        const pop = await ctx.db.query("population").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).first();
        if (pop) await ctx.db.patch(pop._id, { total: 5000, available: 500 });
      });
    };

    // Nivel 1: capacidad 0 y reclutamiento bloqueado
    await setCuartel(1);
    const state1 = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state1.spies.capacity).toBe(0);
    await expect(asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 })).rejects.toThrow(/Cuartel nivel 2/i);

    // Nivel 2: capacidad 1 -> recluta 1 y rechaza el 2º
    await setCuartel(2);
    const state2 = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state2.spies.capacity).toBe(1);
    await asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 });
    await expect(asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 })).rejects.toThrow(/Capacidad de espías excedida/i);

    // Nivel 200: capacidad 100 -> con 1 ya en cola, permite 99 más y rechaza el 101º
    await setCuartel(200);
    const state200 = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(state200.spies.capacity).toBe(100);
    expect(state200.spies.remaining).toBe(99);
    await asUser.mutation(api.army.recruitSpy, { kingdomId, count: 99 });
    await expect(asUser.mutation(api.army.recruitSpy, { kingdomId, count: 1 })).rejects.toThrow(/Capacidad de espías excedida/i);

    vi.setSystemTime(T0 + 10_000_000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const finalArmy = await asUser.query(api.army.getArmyState, { kingdomId });
    expect(finalArmy.spies.active).toBe(100);
    expect(finalArmy.spies.capacity).toBe(100);
    expect(finalArmy.spies.remaining).toBe(0);
  });
});
