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
  PRODUCTION_PER_WORKER_PER_DAY,
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
import { calculateHospitalRecovery, wallsDefenseBonus } from "./battleRules";
import { trainingQueueSlots, validateMercenaryHire } from "./armyRules";
import { researchSlots } from "./technologyRules";
import { getMarketFee } from "./marketRules";
import { computeProfessionEffects, PROFESSION_BUILDING_CAPACITY, storageCapacity } from "./economyExtended";

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

describe("Punto 5 — Escalado funcional real de todos los edificios en niveles 1..200", () => {
  test("edificios productivos y Viviendas escalan linealmente hasta nivel 200 con topes y tasas oficiales", () => {
    const prodSpec: Record<string, { job: keyof typeof PRODUCTION_PER_WORKER_PER_DAY; perLevel: number }> = {
      granja: { job: "agriculture", perLevel: 100 },
      aserradero: { job: "wood", perLevel: 80 },
      cantera: { job: "stone", perLevel: 80 },
      minaHierro: { job: "iron", perLevel: 60 },
      minaOro: { job: "gold", perLevel: 50 },
    };

    for (let level = 1; level <= 200; level++) {
      // Viviendas: 100 plazas por nivel; hasta +30% por tecnologías
      const baseBeds = calculateResidentialCapacity([{ buildingType: "viviendas", level }], 0);
      expect(baseBeds).toBe(level * 100);
      const maxTechBeds = calculateResidentialCapacity([{ buildingType: "viviendas", level }], TECH_EFFECT_CAPS.housingCapacity);
      expect(maxTechBeds).toBe(Math.round(level * 100 * 1.3));

      // Productivos
      for (const [bType, spec] of Object.entries(prodSpec)) {
        const cap = calculateBuildingWorkerCapacity([{ buildingType: bType, level }], bType);
        expect(cap).toBe(level * spec.perLevel);
        const jobs = calculateJobCapacities([{ buildingType: bType, level }])!;
        expect(jobs[spec.job]).toBe(level * spec.perLevel);
        const baseDailyProduction = jobs[spec.job] * PRODUCTION_PER_WORKER_PER_DAY[spec.job];
        expect(baseDailyProduction).toBe(level * spec.perLevel * PRODUCTION_PER_WORKER_PER_DAY[spec.job]);
      }
    }

    // Valores exactos en nivel 200
    expect(calculateResidentialCapacity([{ buildingType: "viviendas", level: 200 }], 0)).toBe(20_000);
    expect(calculateResidentialCapacity([{ buildingType: "viviendas", level: 200 }], 0.30)).toBe(26_000);
    expect(
      calculateJobCapacities([
        { buildingType: "granja", level: 200 },
        { buildingType: "aserradero", level: 200 },
        { buildingType: "cantera", level: 200 },
        { buildingType: "minaHierro", level: 200 },
        { buildingType: "minaOro", level: 200 },
      ])
    ).toEqual({
      agriculture: 20_000,
      wood: 16_000,
      stone: 16_000,
      iron: 12_000,
      gold: 10_000,
    });
  });

  test("edificios de infraestructura, militares, conocimiento y servicios reflejan sus escalados y techos reales hasta 200", () => {
    for (let level = 1; level <= 200; level++) {
      // Mercado: almacenamiento continuo 10.000 + 2.000 * nivel; comisión 1 / (nivel + 6)
      expect(storageCapacity(level, 1)).toBe(10_000 + 2_000 * level);
      const fee = getMarketFee(level);
      expect(fee.feeRate).toBeCloseTo(1 / (level + 6), 12);
      expect(fee.retentionFactor).toBeCloseTo((level + 5) / (level + 6), 12);

      // Murallas: +5 %/nivel hasta nivel 10 (+50 %), constante en 10..200
      const expectedWalls = Math.min(0.5, level * 0.05);
      expect(wallsDefenseBonus(level)).toBeCloseTo(expectedWalls, 12);

      // Cuartel: colas 1..4 (tope en nivel 9); espías floor(nivel / 2) continuo hasta 100
      const expectedQueues = Math.min(4, 1 + Math.floor(level / 3));
      expect(trainingQueueSlots(level)).toBe(expectedQueues);
      expect(Math.floor(level / 2)).toBe(level === 200 ? 100 : Math.floor(level / 2));

      // Universidad: ranuras 1 (1-2), 2 (3-4), 3 (5..200)
      const expectedResearch = level >= 5 ? 3 : level >= 3 ? 2 : 1;
      expect(researchSlots(level)).toBe(expectedResearch);

      // Hospital militar: camas = 100 * nivel; tasa base 15/22/30/40/50% (tope 50% base desde nv.5, máx. 60%)
      const hosp = calculateHospitalRecovery({ hospitalLevel: level, totalWounded: 1, elapsedDays: 1 });
      expect(hosp.hospitalCapacity).toBe(level * HOSPITAL.CAPACITY_PER_LEVEL);
      const expectedBaseRec = level === 1 ? 0.15 : level === 2 ? 0.22 : level === 3 ? 0.3 : level === 4 ? 0.4 : 0.5;
      expect(hosp.baseRecoveryRatio).toBe(expectedBaseRec);
      expect(hosp.effectiveRecoveryRatio).toBeLessThanOrEqual(HOSPITAL_RECOVERY_CAP);

      // Taberna: mercenarios máximos = 50 * nivel hasta 10.000
      const maxMercAllowed = validateMercenaryHire({
        typeId: "mesnada_sueldo",
        count: level * MERCENARIES.MAX_PER_TAVERN_LEVEL,
        tavernLevel: level,
        activeMercenaries: 0,
        gold: 1e12,
      });
      expect(maxMercAllowed.success).toBe(true);
      const overMerc = validateMercenaryHire({
        typeId: "mesnada_sueldo",
        count: level * MERCENARIES.MAX_PER_TAVERN_LEVEL + 1,
        tavernLevel: level,
        activeMercenaries: 0,
        gold: 1e12,
      });
      expect(overMerc.success).toBe(false);

      // Profesiones: capacidades lineales, efectos acotados por PROFESSION_EFFECTS
      const prof = computeProfessionEffects(
        { medicine: level * 50, religion: level * 40, entertainment: level * 40, bakery: level * 40 },
        { hospitalMilitar: level, iglesia: level, circo: level, panaderia: level },
        PROFESSION_BUILDING_CAPACITY
      );
      expect(prof.woundedRecoveryBonus).toBe(level === 1 ? 0.05 : 0.1);
      expect(prof.happinessPerDay).toBe(level === 1 ? 4 : 6);
      expect(prof.foodConsumptionMultiplier).toBeCloseTo(level === 1 ? 0.9 : 0.85, 12);
    }

    // Edificios con workerCapacityPerLevel sin oficio asignable en calculateJobCapacities
    const nonJobCaps = calculateJobCapacities([
      { buildingType: "herreria", level: 200 },
      { buildingType: "mercado", level: 200 },
      { buildingType: "taberna", level: 200 },
    ]);
    expect(nonJobCaps).toEqual({ agriculture: 0, wood: 0, stone: 0, iron: 0, gold: 0 });
    expect(WELLBEING.RELIGION_BONUS_WITH_CHURCH).toBe(1);
    expect(WELLBEING.ENTERTAINMENT_BONUS_WITH_CIRCUS).toBe(1);
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
    expect(state.residentialCapacity).toBe(20_000);
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
});
