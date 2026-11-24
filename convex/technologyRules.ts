/**
 * LA CONQUISTA — REGLAS PURAS DE TECNOLOGÍAS (Bloque C, D-16 a D-21)
 * Catálogo inmutable (balanceConfig.TECHNOLOGIES) separado del progreso por reino.
 * Las funciones puras no acceden a Convex; readCompletedTechnologyIds es el único
 * lector de base de datos y se mantiene aquí para que construcción, entrenamiento
 * y economía obtengan los modificadores desde una sola ruta.
 */
import type { ResourceType } from "./economyCalculations";
import {
  RESEARCH,
  RESEARCH_SLOTS_BY_UNIVERSITY,
  TECHNOLOGIES,
  TECH_EFFECT_CAPS,
  resourceNameSpanish,
  type TechnologyBalance,
  type TechnologyEffectKey,
  LEGACY_TECHNOLOGY_IDS,
} from "./balanceConfig";
import { BUILDING_RULES } from "./buildingRules";
import {
  getCivilizationPassive,
  validateCivilizationTechAccess,
} from "./civilizationRules";

export type TechnologyStatus = "locked" | "available" | "researching" | "completed";

export const TECHNOLOGY_CATALOG: Readonly<Record<string, TechnologyBalance>> = Object.fromEntries(
  TECHNOLOGIES.map((technology) => [technology.id, technology])
);

/** Traduce identificadores de tecnología antiguos (civilizaciones renombradas) al vigente. */
export function normalizeTechnologyId(id: string): string {
  return LEGACY_TECHNOLOGY_IDS[id] ?? id;
}

export function getTechnology(id: string): TechnologyBalance | null {
  return TECHNOLOGY_CATALOG[normalizeTechnologyId(id)] ?? null;
}

export interface ResearchQueueEntry {
  technologyId: string;
  startedAt: number;
  durationMs: number;
  costs: Partial<Record<ResourceType, number>>;
}

/**
 * [DECISIÓN 17-10-2026, M-03 opción B] Ranuras de investigación por nivel de Universidad
 * (nivel 1 = 1, nivel 3 = 2, nivel 5 = 3). Sustituye a los supervisores formados de P25
 * hasta que exista esa mecánica; el máximo sigue siendo RESEARCH.MAX_SLOTS.
 */
export function researchSlots(universityLevel: number = 0): number {
  const level = Number.isInteger(universityLevel) && universityLevel > 0 ? universityLevel : 0;
  if (level === 0) return 0;
  let slots = 0;
  for (const row of RESEARCH_SLOTS_BY_UNIVERSITY) if (level >= row.minLevel) slots = row.slots;
  return Math.min(RESEARCH.MAX_SLOTS, Math.max(RESEARCH.BASE_SLOTS, slots));
}

/** Calcula duración final de investigación estabilizando ruido IEEE-754 y unificando segundos y milisegundos. */
export function computeResearchDuration(
  baseDurationSeconds: number,
  techResearchDurationMultiplier: number = 1,
  civResearchDurationMultiplier: number = 1
): { durationSeconds: number; durationMs: number } {
  const base = Number.isFinite(baseDurationSeconds) && baseDurationSeconds > 0 ? baseDurationSeconds : 60;
  const techMul = Number.isFinite(techResearchDurationMultiplier) && techResearchDurationMultiplier > 0
    ? techResearchDurationMultiplier
    : 1;
  const civMul = Number.isFinite(civResearchDurationMultiplier) && civResearchDurationMultiplier > 0
    ? civResearchDurationMultiplier
    : 1;
  const combinedMultiplier = Math.round(techMul * civMul * 1e9) / 1e9;
  const rawSeconds = Math.round(base * combinedMultiplier * 1e9) / 1e9;
  const durationSeconds = Math.max(1, Math.ceil(rawSeconds));
  return { durationSeconds, durationMs: durationSeconds * 1000 };
}

/** Determina si una tecnología debe ser visible e investigable para la civilización del reino (independiente de la rama). */
export function isTechnologyVisibleForCivilization(
  technology: Pick<TechnologyBalance, "civilizationRequirement">,
  kingdomCivilization?: string | null
): boolean {
  return validateCivilizationTechAccess(technology.civilizationRequirement, kingdomCivilization).allowed;
}

/** Filtra el catálogo tecnológico dejando visibles únicamente las tecnologías universales y las de la civilización del reino. */
export function filterVisibleTechnologiesForCivilization(
  catalog: ReadonlyArray<TechnologyBalance>,
  kingdomCivilization?: string | null
): TechnologyBalance[] {
  return catalog.filter((technology) => isTechnologyVisibleForCivilization(technology, kingdomCivilization));
}

/** Consulta individual de tecnología respetando el aislamiento estricto por civilización. */
export function getVisibleTechnologyForCivilization(
  id: string,
  kingdomCivilization?: string | null
): TechnologyBalance | null {
  const technology = getTechnology(id);
  if (!technology) return null;
  return isTechnologyVisibleForCivilization(technology, kingdomCivilization) ? technology : null;
}

/** Modificadores agregados de las tecnologías completadas. Idempotente: cada tecnología cuenta una vez. */
export interface TechnologyModifiers {
  agricultureProduction: number; // multiplicador (1,05 = +5 %)
  miningProduction: number; // multiplicador aplicado a madera, piedra y hierro
  storageCapacity: number; // multiplicador
  woundedRecoveryBonus: number; // puntos porcentuales adicionales (0,05 = +5 pp)
  espionageLevel: number; // 0..4 (TECH_EFFECT_CAPS.espionageAccuracyMax)
  trainingDuration: number; // multiplicador (0,95 = −5 %)
  constructionDuration: number; // multiplicador (0,95 = −5 %)
  happinessBase: number; // puntos
  unlockedWeapons: string[];
  unlockedArmors: string[];
  combatAttackBonus: number; // bonificación ofensiva aditiva (+0,05 = +5 %)
  combatDefenseBonus: number; // bonificación defensiva aditiva (+0,05 = +5 %)
  marchSpeedBonus: number; // bonificación de velocidad de marcha (+0,15 = +15 %)
  marchFatigueReduction: number; // reducción de fatiga acumulada (0,20 = −20 %)
  foodConsumptionReduction: number; // reducción de consumo de alimentos de población (0,04 = −4 %, máx 0,15)
  woodProductionBonus: number; // bonificación específica de madera (+0,10 = +10 %, máx +0,30)
  stoneProductionBonus: number; // bonificación específica de piedra (+0,10 = +10 %, máx +0,30)
  ironProductionBonus: number; // bonificación específica de hierro (+0,10 = +10 %, máx +0,30)
  goldProductionBonus: number; // bonificación específica de oro (+0,06 = +6 %, máx +0,60)
  researchDuration: number; // multiplicador de duración de investigación (mín 0,60)
  constructionCost: number; // multiplicador de coste de construcción (mín 0,75)
  housingCapacityBonus: number; // bonificación de capacidad residencial (máx 0,30)
  taxToleranceReduction: number; // reducción de penalización fiscal (máx 0,50)
  moraleBase: number;
  unitEfficiencyInf: number;
  unitEfficiencyArc: number;
  unitEfficiencyCav: number;
  mercenaryCostReduction: number; // reducción de coste (e.g. 0.08 = -8 %, máx 0.30)
  woundedRateBonus: number; // puntos porcentuales adicionales (0,05 = +5 pp)
  fatigueAccrualReduction: number; // reducción de fatiga acumulada (0,05 = −5 %)
  counterEspionage: number; // probabilidad de contrainteligencia (e.g. 0.10 = 10 %, máx 0.60)
  explorationSpeedBonus: number; // bonificación de velocidad en expediciones de exploración (+0,10 = +10 %)
}

export function computeTechnologyModifiers(completedIds: ReadonlyArray<string>): TechnologyModifiers {
  let sumAgri = 0;
  let sumMining = 0;
  let sumStorage = 0;
  let sumWounded = 0;
  let baseEspionage = 0;
  let navajoEspionageBonus = 0;
  let sumTraining = 0;
  let sumConstruction = 0;
  let sumHappiness = 0;
  let sumCombatAttack = 0;
  let sumCombatDefense = 0;
  let sumMarchSpeed = 0;
  let sumMarchFatigue = 0;
  let sumFoodCons = 0;
  let sumWoodProd = 0;
  let sumStoneProd = 0;
  let sumIronProd = 0;
  let sumGoldProd = 0;
  let sumResearchDuration = 0;
  let sumConstructionCost = 0;
  let sumHousingCapacity = 0;
  let sumTaxTolerance = 0;
  let sumMorale = 0;
  let sumEffInf = 0;
  let sumEffArc = 0;
  let sumEffCav = 0;
  let sumMercCost = 0;
  let sumWoundedRate = 0;
  let sumFatigueAccrual = 0;
  let sumCounterEspionage = 0;
  let sumExplorationSpeed = 0;
  const unlockedWeapons: string[] = [];
  const unlockedArmors: string[] = [];

  const seen = new Set<string>();
  for (const rawId of completedIds) {
    const id = normalizeTechnologyId(rawId);
    if (seen.has(id)) continue;
    seen.add(id);
    const technology = TECHNOLOGY_CATALOG[id];
    if (!technology) continue;
    const effectEntries = technology.secondaryEffects
      ? [technology.effect, ...technology.secondaryEffects]
      : [technology.effect];
    for (const { key, value } of effectEntries) {
      switch (key as TechnologyEffectKey) {
        case "agricultureProduction": sumAgri += value; break;
        case "miningProduction": sumMining += value; break;
        case "storageCapacity": sumStorage += value; break;
        case "woundedRecovery": sumWounded += value; break;
        case "espionageAccuracy":
          if (id === "tech_civ_navajos_a") {
            navajoEspionageBonus += value;
          } else {
            baseEspionage = Math.max(baseEspionage, value);
          }
          break;
        case "trainingDuration": sumTraining += value; break; // Convención: valor negativo e.g. -0.05
        case "constructionDuration": sumConstruction += value; break; // Convención: valor negativo e.g. -0.05
        case "happinessBase": sumHappiness += value; break;
        case "unlockWeaponSteel": unlockedWeapons.push("acero"); break;
        case "unlockWeaponAdvancedSteel": unlockedWeapons.push("aceroAvanzado"); break;
        case "unlockArmorSteel": unlockedArmors.push("acero"); break;
        case "combatAttack": sumCombatAttack += value; break;
        case "combatDefense": sumCombatDefense += value; break;
        case "marchSpeed": sumMarchSpeed += value; break;
        case "marchFatigue": sumMarchFatigue += Math.abs(value); break;
        case "foodConsumption": sumFoodCons += Math.abs(value); break; // Convención: e.g. -0.04 -> 0.04
        case "woodProduction": sumWoodProd += value; break;
        case "stoneProduction": sumStoneProd += value; break;
        case "ironProduction": sumIronProd += value; break;
        case "goldProduction": sumGoldProd += value; break;
        case "researchDuration": sumResearchDuration += value; break; // Convención: valor negativo e.g. -0.08
        case "constructionCost": sumConstructionCost += value; break; // Convención: valor negativo e.g. -0.06
        case "housingCapacity": sumHousingCapacity += value; break;
        case "taxTolerance": sumTaxTolerance += Math.abs(value); break; // Convención: e.g. -0.50 -> 0.50
        case "moraleBase": sumMorale += value; break;
        case "unitEfficiencyInf": sumEffInf += value; break;
        case "unitEfficiencyArc": sumEffArc += value; break;
        case "unitEfficiencyCav": sumEffCav += value; break;
        case "unitEfficiencyAll": sumEffInf += value; sumEffArc += value; sumEffCav += value; break;
        case "mercenaryCost": sumMercCost += Math.abs(value); break;
        case "woundedRate": sumWoundedRate += value; break;
        case "fatigueAccrual": sumFatigueAccrual += Math.abs(value); break;
        case "counterEspionage": sumCounterEspionage += value; break;
        case "explorationSpeed": sumExplorationSpeed += value; break;
      }
    }
  }

  return {
    agricultureProduction: 1 + Math.min(TECH_EFFECT_CAPS.agricultureProduction, Math.max(0, sumAgri)),
    miningProduction: 1 + Math.min(TECH_EFFECT_CAPS.miningProduction, Math.max(0, sumMining)),
    storageCapacity: 1 + Math.min(TECH_EFFECT_CAPS.storageCapacity, Math.max(0, sumStorage)),
    woundedRecoveryBonus: Math.min(TECH_EFFECT_CAPS.woundedRecovery, Math.max(0, sumWounded)),
    espionageLevel: baseEspionage > 0
      ? Math.min(TECH_EFFECT_CAPS.espionageAccuracyMax, baseEspionage + navajoEspionageBonus)
      : 0,
    trainingDuration: Math.max(TECH_EFFECT_CAPS.trainingDurationFloor, 1 + sumTraining),
    constructionDuration: Math.max(TECH_EFFECT_CAPS.constructionDurationFloor, 1 + sumConstruction),
    happinessBase: Math.min(TECH_EFFECT_CAPS.happinessBase, sumHappiness),
    unlockedWeapons,
    unlockedArmors,
    combatAttackBonus: Math.min(TECH_EFFECT_CAPS.combatAttack, sumCombatAttack),
    combatDefenseBonus: Math.min(TECH_EFFECT_CAPS.combatDefense, sumCombatDefense),
    marchSpeedBonus: Math.min(TECH_EFFECT_CAPS.marchSpeed, sumMarchSpeed),
    marchFatigueReduction: Math.min(TECH_EFFECT_CAPS.marchFatigue, sumMarchFatigue),
    foodConsumptionReduction: Math.min(TECH_EFFECT_CAPS.foodConsumption, Math.max(0, sumFoodCons)),
    woodProductionBonus: Math.min(TECH_EFFECT_CAPS.woodProduction, Math.max(0, sumWoodProd)),
    stoneProductionBonus: Math.min(TECH_EFFECT_CAPS.stoneProduction, Math.max(0, sumStoneProd)),
    ironProductionBonus: Math.min(TECH_EFFECT_CAPS.ironProduction, Math.max(0, sumIronProd)),
    goldProductionBonus: Math.min(TECH_EFFECT_CAPS.goldProduction, Math.max(0, sumGoldProd)),
    researchDuration: Math.max(1 - TECH_EFFECT_CAPS.researchDuration, 1 + sumResearchDuration),
    constructionCost: Math.max(1 - TECH_EFFECT_CAPS.constructionCost, 1 + sumConstructionCost),
    housingCapacityBonus: Math.min(TECH_EFFECT_CAPS.housingCapacity, Math.max(0, sumHousingCapacity)),
    taxToleranceReduction: Math.min(TECH_EFFECT_CAPS.taxTolerance, Math.max(0, sumTaxTolerance)),
    moraleBase: Math.min(TECH_EFFECT_CAPS.moraleBase, sumMorale),
    unitEfficiencyInf: Math.min(TECH_EFFECT_CAPS.unitEfficiency, Math.max(0, sumEffInf)),
    unitEfficiencyArc: Math.min(TECH_EFFECT_CAPS.unitEfficiency, Math.max(0, sumEffArc)),
    unitEfficiencyCav: Math.min(TECH_EFFECT_CAPS.unitEfficiency, Math.max(0, sumEffCav)),
    mercenaryCostReduction: Math.min(TECH_EFFECT_CAPS.mercenaryCost, Math.max(0, sumMercCost)),
    woundedRateBonus: Math.min(TECH_EFFECT_CAPS.woundedRate, Math.max(0, sumWoundedRate)),
    fatigueAccrualReduction: Math.min(TECH_EFFECT_CAPS.fatigueAccrual, Math.max(0, sumFatigueAccrual)),
    counterEspionage: Math.min(TECH_EFFECT_CAPS.counterEspionage, Math.max(0, sumCounterEspionage)),
    explorationSpeedBonus: Math.max(0, sumExplorationSpeed),
  };
}

export function getConstructionDurationModifier(completedIds: ReadonlyArray<string>): number {
  return computeTechnologyModifiers(completedIds).constructionDuration;
}

/** Estado de una tecnología para un reino según progreso persistido, edificios, requisitos y civilización. */
export function evaluateTechnologyStatus(input: {
  technology: TechnologyBalance;
  completedIds: ReadonlySet<string>;
  researchingIds: ReadonlySet<string>;
  buildingLevels: Readonly<Record<string, number>>;
  kingdomCivilization?: string | null;
}): { status: TechnologyStatus; blockers: string[] } {
  const { technology, buildingLevels, kingdomCivilization } = input;
  const completedIds = new Set(Array.from(input.completedIds, (id) => normalizeTechnologyId(id)));
  const researchingIds = new Set(Array.from(input.researchingIds, (id) => normalizeTechnologyId(id)));
  const techId = normalizeTechnologyId(technology.id);
  if (completedIds.has(techId)) return { status: "completed", blockers: [] };
  if (researchingIds.has(techId)) return { status: "researching", blockers: [] };
  const blockers: string[] = [];

  // Validación de civilización exclusiva (P62)
  if (technology.civilizationRequirement) {
    const access = validateCivilizationTechAccess(technology.civilizationRequirement, kingdomCivilization);
    if (!access.allowed) {
      blockers.push(access.error ?? `Exclusiva de la civilización: ${technology.civilizationRequirement}`);
    }
  }

  if ((buildingLevels.universidad ?? 0) < technology.universityLevel) {
    blockers.push(`Universidad nivel ${technology.universityLevel}`);
  }

  // Comprobar requisitos de edificios (Castillo, y edificios extra)
  for (const [buildingType, reqLevel] of Object.entries(technology.buildingRequirements)) {
    if (buildingType === "universidad" && reqLevel <= technology.universityLevel) {
      continue;
    }
    const current = buildingLevels[buildingType] ?? 0;
    if (current < reqLevel) {
      const label = BUILDING_RULES[buildingType]?.label ?? buildingType;
      blockers.push(`${label} nivel ${reqLevel}`);
    }
  }

  for (const rawRequiredId of technology.technologyRequirements) {
    const requiredId = normalizeTechnologyId(rawRequiredId);
    if (!completedIds.has(requiredId)) {
      blockers.push(`Requiere ${TECHNOLOGY_CATALOG[requiredId]?.name ?? rawRequiredId}`);
    }
  }
  return { status: blockers.length === 0 ? "available" : "locked", blockers };
}

export interface ResearchPlan {
  technologyId: string;
  startedAt: number;
  durationMs: number;
  completesAt: number;
  costs: Partial<Record<ResourceType, number>>;
}

export function createResearchPlan(input: {
  technologyId: string;
  resources: Record<ResourceType, number>;
  completedIds: ReadonlyArray<string>;
  activeResearch: ReadonlyArray<ResearchQueueEntry>;
  buildingLevels: Readonly<Record<string, number>>;
  now: number;
  kingdomCivilization?: string | null;
}): { success: true; plan: ResearchPlan } | { success: false; error: string } {
  const technology = TECHNOLOGY_CATALOG[normalizeTechnologyId(input.technologyId)];
  if (!technology) return { success: false, error: `La tecnología '${input.technologyId}' no existe en el catálogo.` };
  if (!Number.isFinite(input.now) || input.now < 0) return { success: false, error: "Marca temporal inválida." };

  const normalizedCompletedIds = input.completedIds.map((id) => normalizeTechnologyId(id));
  const completedIds = new Set(normalizedCompletedIds);
  const researchingIds = new Set(input.activeResearch.map((entry) => normalizeTechnologyId(entry.technologyId)));
  if (input.activeResearch.some((entry) =>
    !entry.technologyId || !Number.isFinite(entry.startedAt) || !Number.isFinite(entry.durationMs) || entry.durationMs <= 0
  )) {
    return { success: false, error: "La cola de investigación contiene una entrada incompleta; requiere conciliación." };
  }
  const slots = researchSlots(input.buildingLevels.universidad ?? 0);
  if (input.activeResearch.length >= slots) {
    return { success: false, error: `No hay ranuras de investigación libres (${slots} con Universidad nivel ${input.buildingLevels.universidad ?? 0}).` };
  }
  const evaluation = evaluateTechnologyStatus({
    technology,
    completedIds,
    researchingIds,
    buildingLevels: input.buildingLevels,
    kingdomCivilization: input.kingdomCivilization,
  });
  if (evaluation.status === "completed") return { success: false, error: `'${technology.name}' ya está investigada.` };
  if (evaluation.status === "researching") return { success: false, error: `'${technology.name}' ya se está investigando.` };
  if (evaluation.status === "locked") return { success: false, error: `Bloqueada: ${evaluation.blockers.join("; ")}.` };

  const costs: Partial<Record<ResourceType, number>> = {};
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    const cost = technology.costs[resource];
    const balance = input.resources[resource];
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(balance) || balance < 0) {
      return { success: false, error: `Coste o saldo inválido para '${resource}'.` };
    }
    if (cost > 0) {
      if (balance < cost) {
        return { success: false, error: `Recursos insuficientes: ${resourceNameSpanish(resource)} requiere ${cost} y hay ${Math.floor(balance)}.` };
      }
      costs[resource] = cost;
    }
  }

  const techModifiers = computeTechnologyModifiers(normalizedCompletedIds);
  const civPassive = getCivilizationPassive(input.kingdomCivilization);
  const { durationMs } = computeResearchDuration(
    technology.durationSeconds,
    techModifiers.researchDuration,
    civPassive.researchDurationMultiplier
  );

  return {
    success: true,
    plan: { technologyId: technology.id, startedAt: input.now, durationMs, completesAt: input.now + durationMs, costs },
  };
}

export function researchProgress(entry: Pick<ResearchQueueEntry, "startedAt" | "durationMs">, serverTimeMs: number): number | null {
  if (!Number.isFinite(entry.startedAt) || !Number.isFinite(entry.durationMs) || entry.durationMs <= 0 || !Number.isFinite(serverTimeMs)) {
    return null;
  }
  return Math.max(0, Math.min(100, ((serverTimeMs - entry.startedAt) / entry.durationMs) * 100));
}

/** [COMPLEMENTO §4] Reembolso del 50 % al cancelar antes de completar. */
export function calculateResearchCancellationRefund(input: {
  entry: ResearchQueueEntry;
  serverTimeMs: number;
}): { success: true; refund: Partial<Record<ResourceType, number>> } | { success: false; error: string } {
  const progress = researchProgress(input.entry, input.serverTimeMs);
  if (progress === null) return { success: false, error: "La investigación no contiene marcas temporales válidas." };
  if (progress >= 100) return { success: false, error: "No se puede cancelar una investigación ya completada." };
  const refund: Partial<Record<ResourceType, number>> = {};
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    const paid = input.entry.costs[resource];
    if (paid === undefined) continue;
    if (!Number.isFinite(paid) || paid < 0) return { success: false, error: `El coste persistido de '${resource}' no es válido.` };
    const amount = Math.floor(paid * RESEARCH.CANCEL_REFUND_RATIO);
    if (amount > 0) refund[resource] = amount;
  }
  return { success: true, refund };
}

/** Lector de base de datos: identificadores de tecnologías completadas de un reino. */
export async function readCompletedTechnologyIds(ctx: { db: any }, kingdomId: unknown): Promise<string[]> {
  try {
    const docs: Array<{ technologyId?: string; status?: string }> = await ctx.db
      .query("technologyProgress")
      .withIndex("by_kingdom", (q: any) => q.eq("kingdomId", kingdomId))
      .collect();
    return docs
      .filter((doc) => doc.status === "completed" && typeof doc.technologyId === "string")
      .map((doc) => normalizeTechnologyId(doc.technologyId as string));
  } catch {
    return [];
  }
}
