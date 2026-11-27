import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { createTestBackend } from "./test.setup";
import {
  BUILDINGS,
  INITIAL_BUILDINGS,
  POPULATION,
  PRODUCTION_PER_WORKER_PER_DAY,
  TECH_EFFECT_CAPS,
  TIME,
  WELLBEING,
} from "./balanceConfig";
import {
  BUILDING_RULES,
  calculateJobCapacities,
  calculateResidentialCapacity,
  costsForTargetLevel,
  durationForTargetLevel,
} from "./buildingRules";
import { INITIAL_KINGDOM_CONFIG, validatePopulationIntegrity } from "./economyCalculations";
import { simulateExtendedEconomy, type ExtendedEconomyInput } from "./economyExtended";
import { computeTechnologyModifiers } from "./technologyRules";

const DAY_MS = TIME.MS_PER_GAME_YEAR;
const T0 = new Date("2026-11-27T10:00:00Z").getTime();

function identity(subject: string) {
  return {
    subject,
    tokenIdentifier: `https://accounts.google.com|${subject}`,
    issuer: "https://accounts.google.com",
  };
}

function makeEconomyInput(
  overrides: Partial<ExtendedEconomyInput> & {
    population?: number;
    unassignedCivil?: number;
    regularSoldiers?: number;
    food?: number;
    workers?: Partial<typeof INITIAL_KINGDOM_CONFIG.workers>;
  } = {}
): ExtendedEconomyInput {
  const { population, unassignedCivil, regularSoldiers, food, workers, ...rest } = overrides;
  const mergedWorkers = { ...INITIAL_KINGDOM_CONFIG.workers, ...(workers ?? {}) };
  const pop = population ?? INITIAL_KINGDOM_CONFIG.population;
  const soldiers = regularSoldiers ?? 0;
  const free =
    unassignedCivil ??
    Math.max(
      0,
      pop -
        soldiers -
        mergedWorkers.agriculture -
        mergedWorkers.wood -
        mergedWorkers.stone -
        mergedWorkers.iron -
        mergedWorkers.gold -
        mergedWorkers.other
    );

  return {
    kingdomState: {
      userId: "u_res_test",
      name: "Reino Residencial",
      population: pop,
      regularSoldiers: soldiers,
      workers: mergedWorkers,
      unassignedCivil: free,
      resources: {
        ...INITIAL_KINGDOM_CONFIG.resources,
        food: food ?? 100_000,
      },
      foodTier: "normal",
      lastUpdated: T0,
      foodProductionWorkerLimit: null,
    },
    now: T0 + DAY_MS,
    jobCapacities: { agriculture: 1100, wood: 320, stone: 320, iron: 120, gold: 50 },
    residentialCapacity: 20_000,
    technologyModifiers: computeTechnologyModifiers([]),
    taxRate: 0,
    happiness: WELLBEING.INITIAL_HAPPINESS,
    starvationSeconds: 0,
    buildingLevels: { castillo: 20, viviendas: 20, mercado: 200 },
    militaryPersonnel: soldiers,
    civilization: "romanos",
    ...rest,
  };
}

describe("Regla de capacidad residencial de 1.000 habitantes por nivel de viviendas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("9.A — Capacidad residencial básica (1, 2, 5, 10, 20, 50, 100, 200), suma múltiple y datos inválidos", () => {
    expect(BUILDINGS.viviendas.residentialCapacityPerLevel).toBe(1000);
    expect(BUILDING_RULES.viviendas.residentialCapacityPerLevel).toBe(1000);

    const expected: Array<[number, number]> = [
      [1, 1_000],
      [2, 2_000],
      [5, 5_000],
      [10, 10_000],
      [20, 20_000],
      [50, 50_000],
      [100, 100_000],
      [200, 200_000],
    ];
    for (const [level, cap] of expected) {
      expect(calculateResidentialCapacity([{ buildingType: "viviendas", level }], 0)).toBe(cap);
    }

    // Múltiples estructuras residenciales se suman antes de aplicar bonificaciones
    expect(
      calculateResidentialCapacity(
        [
          { buildingType: "viviendas", level: 8 },
          { buildingType: "viviendas", level: 12 },
          { buildingType: "granja", level: 5 },
        ],
        0
      )
    ).toBe(20_000);

    // Validación de niveles inválidos y ausencia de viviendas
    expect(calculateResidentialCapacity([], 0)).toBe(0);
    expect(calculateResidentialCapacity([{ buildingType: "viviendas", level: 0 }], 0)).toBeNull();
    expect(calculateResidentialCapacity([{ buildingType: "viviendas", level: -1 }], 0)).toBeNull();
    expect(calculateResidentialCapacity([{ buildingType: "viviendas", level: 1.5 }], 0)).toBeNull();
    expect(calculateResidentialCapacity([{ buildingType: "viviendas", level: 201 }], 0)).toBeNull();
  });

  test("9.B — Compatibilidad automática y retroactiva con reinos existentes sin migración ni alteración de población o edificios", async () => {
    const t = createTestBackend();

    const cases: Array<{ userId: string; viviendasLevel: number; expectedCap: number }> = [
      { userId: "player-a", viviendasLevel: 20, expectedCap: 20_000 },
      { userId: "player-b", viviendasLevel: 35, expectedCap: 35_000 },
      { userId: "player-c", viviendasLevel: 8, expectedCap: 8_000 },
      { userId: "player-d", viviendasLevel: 100, expectedCap: 100_000 },
    ];

    for (const item of cases) {
      const asUser = t.withIdentity(identity(item.userId));
      const kingdom = await asUser.mutation(api.economy.getOrInitializeKingdom, {
        name: `Reino ${item.userId}`,
        civilization: "romanos",
      });
      const kingdomId = kingdom._id as any;

      // Simular un reino existente con un nivel arbitrario de viviendas y población inicial de 2.000
      await t.run(async (ctx) => {
        const bld = (
          await ctx.db.query("buildings").withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId)).collect()
        ).find((b) => b.buildingType === "viviendas");
        if (bld) await ctx.db.patch(bld._id, { level: item.viviendasLevel });
      });

      const construction = await asUser.query(api.buildings.getConstructionState, { kingdomId });
      expect(construction.buildingLevels.viviendas).toBe(item.viviendasLevel);
      expect(construction.residentialCapacity).toBe(item.expectedCap);

      // Liquidación inmediata (deltaT = 0): NO modifica población ni niveles de edificios
      const settled0 = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
      expect(settled0.population?.births ?? 0).toBe(0);

      const full = await asUser.query(api.kingdoms.getKingdomFull, { userId: item.userId });
      expect(full?.population?.total).toBe(POPULATION.INITIAL);
      expect(full?.buildings.find((b: any) => b.buildingType === "viviendas")?.level).toBe(item.viviendasLevel);
    }
  });

  test("9.C — Crecimiento compuesto del 30 % anual (2.000 -> 2.600 con 20.000 plazas), tope, saturación y fracción", async () => {
    // 1. Integración en backend Convex: reino recién fundado (2.000 hab, viviendas nv. 20 = 20.000 plazas)
    const t = createTestBackend();
    const asUser = t.withIdentity(identity("user-growth-30"));
    const kingdom = await asUser.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino Crecimiento",
      civilization: "romanos",
    });
    const kingdomId = kingdom._id as any;

    expect(INITIAL_BUILDINGS.viviendas).toBe(20);
    const stateBefore = await asUser.query(api.buildings.getConstructionState, { kingdomId });
    expect(stateBefore.residentialCapacity).toBe(20_000);

    // Tras 1 año de juego (1 día real = 86.400 s), crece exactamente 30 %: 2.000 -> 2.600 (+600)
    vi.setSystemTime(T0 + DAY_MS);
    const settled = await asUser.mutation(api.economy.settleKingdomEconomy, { kingdomId });
    expect(settled.population?.totalBefore).toBe(2000);
    expect(settled.population?.births).toBe(600);
    expect(settled.population?.totalAfter).toBe(2600);
    expect(settled.population?.growthCappedByHousing).toBe(false);
    expect(settled.population?.residentialCapacity).toBe(20_000);

    const fullAfter = await asUser.query(api.kingdoms.getKingdomFull, { userId: "user-growth-30" });
    expect(fullAfter?.population?.total).toBe(2600);
    expect(fullAfter?.population?.available).toBe(850); // 250 + 600

    // 2. Capacidad insuficiente: 1.950 hab con viviendas nv. 2 (2.000 plazas) limita a +50 hab
    const simLimited = simulateExtendedEconomy(
      makeEconomyInput({
        population: 1950,
        unassignedCivil: 200,
        residentialCapacity: calculateResidentialCapacity([{ buildingType: "viviendas", level: 2 }], 0),
        buildingLevels: { castillo: 2, viviendas: 2, mercado: 200 },
      })
    );
    expect(simLimited.population.births).toBe(50);
    expect(simLimited.population.totalAfter).toBe(2000);
    expect(simLimited.population.growthCappedByHousing).toBe(true);

    // 3. Viviendas llenas: 2.000 hab con viviendas nv. 2 (2.000 plazas) -> 0 nacimientos
    const simFull = simulateExtendedEconomy(
      makeEconomyInput({
        population: 2000,
        residentialCapacity: calculateResidentialCapacity([{ buildingType: "viviendas", level: 2 }], 0),
        buildingLevels: { castillo: 2, viviendas: 2, mercado: 200 },
      })
    );
    expect(simFull.population.births).toBe(0);
    expect(simFull.population.totalAfter).toBe(2000);
    expect(simFull.population.growthCappedByHousing).toBe(true);

    // 4. Acumulación fraccionaria continua en intervalos cortos (dos medios días con 10 hab, cap 1.000)
    const halfDayMs = DAY_MS / 2;
    const step1 = simulateExtendedEconomy(
      makeEconomyInput({
        population: 10,
        workers: { agriculture: 0, wood: 0, stone: 0, iron: 0, gold: 0, other: 0 },
        unassignedCivil: 10,
        now: T0 + halfDayMs,
        residentialCapacity: calculateResidentialCapacity([{ buildingType: "viviendas", level: 1 }], 0),
        birthFraction: 0,
      })
    );
    expect(step1.population.births).toBe(1); // floor(10 * 1.3^0.5 - 10 = 1.4017) = 1
    expect(step1.population.birthFraction).toBeGreaterThan(0.39);

    const step2 = simulateExtendedEconomy({
      ...makeEconomyInput({
        population: step1.population.totalAfter,
        workers: { agriculture: 0, wood: 0, stone: 0, iron: 0, gold: 0, other: 0 },
        unassignedCivil: step1.population.availableAfter,
        now: T0 + DAY_MS,
        residentialCapacity: calculateResidentialCapacity([{ buildingType: "viviendas", level: 1 }], 0),
        birthFraction: step1.population.birthFraction,
      }),
      kingdomState: {
        ...makeEconomyInput().kingdomState,
        population: step1.population.totalAfter,
        workers: { agriculture: 0, wood: 0, stone: 0, iron: 0, gold: 0, other: 0 },
        unassignedCivil: step1.population.availableAfter,
        resources: { ...INITIAL_KINGDOM_CONFIG.resources, food: 100_000 },
        lastUpdated: T0 + halfDayMs,
      },
    });
    expect(step1.population.births + step2.population.births).toBe(3); // floor(10 * 1.3) - 10 = 3
  });

  test("9.D — Bonificaciones tecnológicas, pasiva de civilización (sin doble suma) y exclusión de mercenarios", () => {
    const mods24 = computeTechnologyModifiers(["housing_1", "housing_2", "housing_3", "housing_4"]);
    expect(mods24.housingCapacityBonus).toBeCloseTo(0.24, 9);

    // Nivel 20 = 20.000; +24 % tecnológico = 24.800
    const techCap = calculateResidentialCapacity([{ buildingType: "viviendas", level: 20 }], mods24.housingCapacityBonus);
    expect(techCap).toBe(24_800);

    // Tope tecnológico (+30 %): 20.000 * 1,30 = 26.000
    const maxTechCap = calculateResidentialCapacity([{ buildingType: "viviendas", level: 20 }], TECH_EFFECT_CAPS.housingCapacity);
    expect(maxTechCap).toBe(26_000);

    // Chinos (+5 % civilización) sobre 24.800 => Math.ceil(24800 * 1.05) = 26.040 (sin doble conteo)
    const equilibriumChinos = WELLBEING.INITIAL_HAPPINESS + mods24.happinessBase;
    const simChinosJustUnderCap = simulateExtendedEconomy(
      makeEconomyInput({
        population: 26_040,
        unassignedCivil: 24_290,
        happiness: equilibriumChinos,
        residentialCapacity: techCap,
        technologyModifiers: mods24,
        civilization: "chinos",
      })
    );
    expect(simChinosJustUnderCap.happiness.dailyDelta).toBe(0);
    expect(simChinosJustUnderCap.population.births).toBe(0);
    expect(simChinosJustUnderCap.population.growthCappedByHousing).toBe(true);

    // Si supera en 1 (26.041), entra en hacinamiento
    const simChinosOver = simulateExtendedEconomy(
      makeEconomyInput({
        population: 26_041,
        unassignedCivil: 24_291,
        happiness: equilibriumChinos,
        residentialCapacity: techCap,
        technologyModifiers: mods24,
        civilization: "chinos",
      })
    );
    expect(simChinosOver.happiness.dailyDelta).toBe(WELLBEING.OVERCROWDING_PENALTY);

    // Mercenarios excluidos del crecimiento y del cupo de nacimientos:
    // Capacidad 20.000, 1.000 mercenarios + 2.000 regulares/civiles (= 3.000 total).
    // Natalidad solo sobre 2.000 -> +600; cupo efectivo para natalidad = 20.000 - 1.000 = 19.000.
    const simMercs = simulateExtendedEconomy(
      makeEconomyInput({
        population: 3000,
        regularSoldiers: 1000,
        mercenaryCount: 1000,
        unassignedCivil: 250,
        residentialCapacity: 20_000,
        militaryPersonnel: 1000,
      })
    );
    expect(simMercs.population.births).toBe(600);
    expect(simMercs.population.totalAfter).toBe(3600);
    expect(simMercs.population.growthCappedByHousing).toBe(false);

    // Si hay 19.000 civiles/regulares + 1.000 mercenarios (20.000 total en 20.000 plazas), cupo libre = 0
    const simMercsAtCap = simulateExtendedEconomy(
      makeEconomyInput({
        population: 20_000,
        regularSoldiers: 1000,
        mercenaryCount: 1000,
        unassignedCivil: 17_250,
        residentialCapacity: 20_000,
        militaryPersonnel: 1000,
      })
    );
    expect(simMercsAtCap.population.births).toBe(0);
    expect(simMercsAtCap.population.growthCappedByHousing).toBe(true);
  });

  test("9.E — Hacinamiento: se activa al superar la nueva capacidad efectiva y desaparece al quedar dentro", () => {
    // 2.500 habitantes con viviendas nivel 3 (3.000 plazas) -> NO está hacinado (felicidad diaria 0)
    const capLvl3 = calculateResidentialCapacity([{ buildingType: "viviendas", level: 3 }], 0);
    expect(capLvl3).toBe(3000);
    const notOvercrowded = simulateExtendedEconomy(
      makeEconomyInput({
        population: 2500,
        unassignedCivil: 750,
        residentialCapacity: capLvl3,
        buildingLevels: { castillo: 3, viviendas: 3, mercado: 200 },
      })
    );
    expect(notOvercrowded.happiness.dailyDelta).toBe(0);
    expect(notOvercrowded.happiness.after).toBe(WELLBEING.INITIAL_HAPPINESS);

    // 3.001 habitantes con viviendas nivel 3 (3.000 plazas) -> SÍ está hacinado (-2 felicidad/día)
    const overcrowded = simulateExtendedEconomy(
      makeEconomyInput({
        population: 3001,
        unassignedCivil: 1251,
        residentialCapacity: capLvl3,
        buildingLevels: { castillo: 3, viviendas: 3, mercado: 200 },
      })
    );
    expect(overcrowded.happiness.dailyDelta).toBe(WELLBEING.OVERCROWDING_PENALTY);
    expect(overcrowded.happiness.after).toBe(WELLBEING.INITIAL_HAPPINESS + WELLBEING.OVERCROWDING_PENALTY);
  });

  test("9.F y 9.G — Coherencia demográfica (total = soldados + trabajadores + reserva) y económica (alimentos y topes intactos)", () => {
    const sim = simulateExtendedEconomy(
      makeEconomyInput({
        population: 2000,
        regularSoldiers: 0,
        residentialCapacity: calculateResidentialCapacity([{ buildingType: "viviendas", level: 20 }], 0),
      })
    );
    expect(sim.population.births).toBe(600);
    expect(sim.population.totalAfter).toBe(2600);
    expect(sim.population.availableAfter).toBe(850); // 250 iniciales + 600 nacimientos a reserva civil

    const integrity = validatePopulationIntegrity(
      sim.population.totalAfter,
      0,
      sim.population.updatedWorkers,
      sim.population.availableAfter
    );
    expect(integrity.valid).toBe(true);

    // Consumo de alimentos antes de nacimientos: 2.000 raciones/día; no alterado artificialmente
    expect(sim.dailyFoodConsumption).toBe(2000);

    // Al liquidar un segundo día con 2.600 habitantes, el consumo sube exactamente a 2.600 raciones/día
    const simDay2 = simulateExtendedEconomy({
      ...makeEconomyInput({
        population: sim.population.totalAfter,
        unassignedCivil: sim.population.availableAfter,
        residentialCapacity: 20_000,
        now: T0 + 2 * DAY_MS,
      }),
      kingdomState: {
        ...makeEconomyInput().kingdomState,
        population: sim.population.totalAfter,
        unassignedCivil: sim.population.availableAfter,
        resources: { ...INITIAL_KINGDOM_CONFIG.resources, food: 100_000 },
        lastUpdated: T0 + DAY_MS,
      },
    });
    expect(simDay2.dailyFoodConsumption).toBe(2600);

    // Verificar que costes, duraciones y capacidades productivas de otros edificios no se alteraron
    expect(costsForTargetLevel(BUILDINGS.viviendas.baseCosts, 1)).toEqual({ gold: 40, wood: 100, stone: 20, iron: 0, food: 0 });
    expect(durationForTargetLevel(BUILDING_RULES.viviendas.baseDurationMs!, 1)).toBe(5000);
    expect(PRODUCTION_PER_WORKER_PER_DAY.agriculture).toBe(6);
    const jobCaps = calculateJobCapacities([{ buildingType: "granja", level: 11 }, { buildingType: "viviendas", level: 20 }]);
    expect(jobCaps?.agriculture).toBe(1100);
  });
});
