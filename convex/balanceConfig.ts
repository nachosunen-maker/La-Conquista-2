/**
 * ============================================================================
 * LA CONQUISTA — PARÁMETROS DE BALANCE CENTRALIZADOS (P72)
 * ============================================================================
 * Única fuente de verdad para todos los valores numéricos del juego.
 *
 * ORIGEN DE CADA VALOR (trazabilidad obligatoria):
 *  - [MAESTRA Pnn]   Valor fijado en la Especificación Maestra P1-P73
 *                    (docs/Especificacion_Maestra_P1-P73.txt).
 *  - [COMPLEMENTO]   Propuesta de balance del documento complementario
 *                    (docs/Complemento_Datos_Pendientes.txt), aprobada para
 *                    carga el 17-10-2026 por el responsable del proyecto.
 *  - [DERIVADO]      Regla calculada a partir de valores anteriores; se
 *                    documenta la fórmula y queda sujeta a revisión.
 *
 * Ningún valor de este archivo se considera inmutable: P72 exige que todo
 * parámetro de balance pueda modificarse sin reescribir la lógica. Los módulos
 * de reglas importan de aquí y nunca definen números propios.
 */

import type { ResourceType } from "./economyCalculations";

export type ResourceCosts = Record<ResourceType, number>;

// ============================================================================
// 1. TIEMPO Y ECONOMÍA BASE
// ============================================================================
export const TIME = {
  /** [MAESTRA P2] 1 día real (86.400 s) = 1 año de juego. */
  SECONDS_PER_GAME_YEAR: 86_400,
  MS_PER_GAME_YEAR: 86_400 * 1000,
} as const;

export const FOOD = {
  /** [COMPLEMENTO §1, aprobado] 1 ración por habitante y día real. */
  BASE_CONSUMPTION_PER_DAY: 1.0,
  /** [MAESTRA P18] Tropas regulares consumen un 5 % más. */
  MILITARY_FACTOR: 1.05,
  /** [MAESTRA P17 + valores aprobados] Multiplicadores de ración. */
  TIER_FACTORS: { minima: 0.75, normal: 1.0, abundante: 1.1, excelente: 1.2 } as const,
  /** [COMPLEMENTO D-12] Las máquinas de asedio no consumen raciones. */
  SIEGE_CONSUMES_FOOD: false,
} as const;

/**
 * [COMPLEMENTO D-46] Producción por trabajador efectivo y día real.
 * Agricultura es valor aprobado; el resto es propuesta de balance aprobada.
 */
export const PRODUCTION_PER_WORKER_PER_DAY = {
  agriculture: 2.0,
  wood: 1.0,
  stone: 0.75,
  iron: 0.4,
  gold: 0.2,
} as const;
export type ProductiveJob = keyof typeof PRODUCTION_PER_WORKER_PER_DAY;

/** Mapa oficio → recurso producido. */
export const JOB_TO_RESOURCE: Record<ProductiveJob, ResourceType> = {
  agriculture: "food",
  wood: "wood",
  stone: "stone",
  iron: "iron",
  gold: "gold",
};

// ============================================================================
// 2. POBLACIÓN, BIENESTAR, IMPUESTOS E INANICIÓN
// ============================================================================
export const POPULATION = {
  /** [MAESTRA P10] Censo inicial. */
  INITIAL: 2000,
  /** [MAESTRA P12] Crecimiento del 30 % por año de juego, limitado por viviendas (P13/P16). */
  ANNUAL_GROWTH_RATE: 0.3,
} as const;

/** [COMPLEMENTO D-48] Fases de inanición. Los umbrales se expresan en segundos reales de déficit acumulado. */
export const STARVATION = {
  PHASE_2_AFTER_SECONDS: 1 * TIME.SECONDS_PER_GAME_YEAR, // 1 día real
  PHASE_3_AFTER_SECONDS: 3 * TIME.SECONDS_PER_GAME_YEAR, // 3 días reales
  HAPPINESS_PENALTY_PER_DAY: 2,
  CIVIL_PRODUCTIVITY_PENALTY: 0.10,
  MORALE_PENALTY_POINTS: 10,
  DAILY_CIVIL_LOSS_RATE: 0.005,
  DAILY_MILITARY_DESERTION_RATE: 0.01,
} as const;

/** [COMPLEMENTO D-49] Felicidad y moral militar en escala 0-100 con valor inicial 70. */
export const WELLBEING = {
  MIN: 0,
  MAX: 100,
  INITIAL_HAPPINESS: 70,
  INITIAL_MORALE: 70,
  /** Límite de variación de felicidad por actualización diaria. */
  MAX_HAPPINESS_DELTA_PER_DAY: 5,
  /** Contribuciones diarias a la felicidad por régimen alimentario (propuesta coherente con P17). */
  FOOD_TIER_HAPPINESS: { minima: -2, normal: 0, abundante: 1, excelente: 2 } as const,
  /** Penalización diaria cuando la población supera la capacidad residencial (P16). */
  OVERCROWDING_PENALTY: -2,
  /** Bonificación diaria por edificio de religión o entretenimiento completado (P13). */
  RELIGION_BONUS_WITH_CHURCH: 1,
  ENTERTAINMENT_BONUS_WITH_CIRCUS: 1,
} as const;

/** [COMPLEMENTO D-49] Tramos impositivos (P27: 0 %–100 %). */
export const TAXES = {
  MIN_RATE: 0,
  MAX_RATE: 1,
  INITIAL_RATE: 0.1,
  LOW_BAND_MAX: 0.10,
  /** 11–30 %: −0,1 felicidad por punto porcentual sobre 10, por día. */
  MID_BAND_MAX: 0.30,
  MID_BAND_HAPPINESS_PER_POINT: 0.1,
  /** 31–60 %: penalización de productividad adicional de hasta −15 % (lineal en el tramo). */
  HIGH_BAND_MAX: 0.60,
  HIGH_BAND_MAX_PRODUCTIVITY_PENALTY: 0.15,
  /** 61–100 %: penalización adicional de moral militar (puntos por día, lineal hasta el máximo). */
  EXTREME_BAND_MAX_MORALE_PENALTY: 10,
} as const;

/** [COMPLEMENTO D-49] Moral militar: moral = clamp(50 + 0,25×(felicidad−50) + bonus − penalizaciones). */
export const MORALE = {
  BASE: 50,
  HAPPINESS_COEFFICIENT: 0.25,
  FOOD_TIER_BONUS: { minima: -10, normal: 0, abundante: 3, excelente: 5 } as const,
  VICTORY_BONUS: 5,
  DEFEAT_PENALTY: 5,
  /** Las bonificaciones de victoria y derrota decaen por completo tras este tiempo real. */
  BATTLE_EFFECT_DURATION_SECONDS: 7 * TIME.SECONDS_PER_GAME_YEAR,
} as const;

// ============================================================================
// 3. EDIFICIOS (D-01 a D-07)
// ============================================================================
export interface BuildingBalance {
  label: string;
  /** Coste del nivel 1. [COMPLEMENTO §2] */
  baseCosts: ResourceCosts;
  /** Duración base del nivel 1 en segundos reales. [COMPLEMENTO §2] */
  baseDurationSeconds: number;
  /** Residentes alojados por nivel (solo viviendas). */
  residentialCapacityPerLevel: number;
  /** Trabajadores asignables por nivel. */
  workerCapacityPerLevel: number;
  /** Oficio productivo habilitado, si aplica. */
  jobType: ProductiveJob | null;
  /** Profesión de P13 cuya capacidad habilita (sin producción de recursos). */
  professionJob?: "medicine" | "religion" | "entertainment" | "bakery";
  /** Requisitos de progresión: edificio → nivel mínimo. */
  requirements: Readonly<Record<string, number>>;
  /** Función descriptiva (P20). */
  role: string;
}

export const BUILDINGS: Readonly<Record<string, BuildingBalance>> = {
  castillo: { label: "Castillo", baseCosts: { gold: 500, wood: 800, stone: 800, iron: 100, food: 0 }, baseDurationSeconds: 86_400, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 0, jobType: null, requirements: {}, role: "Desbloqueos y administración" },
  viviendas: { label: "Viviendas", baseCosts: { gold: 40, wood: 100, stone: 20, iron: 0, food: 0 }, baseDurationSeconds: 7_200, residentialCapacityPerLevel: 100, workerCapacityPerLevel: 0, jobType: null, requirements: { castillo: 1 }, role: "Capacidad residencial" },
  granja: { label: "Granja", baseCosts: { gold: 30, wood: 80, stone: 20, iron: 0, food: 0 }, baseDurationSeconds: 10_800, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 100, jobType: "agriculture", requirements: { castillo: 1 }, role: "Agricultura" },
  aserradero: { label: "Aserradero", baseCosts: { gold: 40, wood: 100, stone: 30, iron: 0, food: 0 }, baseDurationSeconds: 14_400, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 80, jobType: "wood", requirements: { castillo: 1 }, role: "Madera" },
  cantera: { label: "Cantera", baseCosts: { gold: 50, wood: 80, stone: 80, iron: 0, food: 0 }, baseDurationSeconds: 18_000, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 80, jobType: "stone", requirements: { castillo: 1 }, role: "Piedra" },
  minaHierro: { label: "Mina de hierro", baseCosts: { gold: 60, wood: 100, stone: 80, iron: 20, food: 0 }, baseDurationSeconds: 21_600, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 60, jobType: "iron", requirements: { cantera: 1 }, role: "Hierro" },
  minaOro: { label: "Mina de oro", baseCosts: { gold: 100, wood: 100, stone: 100, iron: 0, food: 0 }, baseDurationSeconds: 21_600, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 50, jobType: "gold", requirements: { castillo: 2 }, role: "Oro" },
  cuartel: { label: "Cuartel/Barracones", baseCosts: { gold: 100, wood: 150, stone: 100, iron: 20, food: 0 }, baseDurationSeconds: 28_800, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 0, jobType: null, requirements: { castillo: 1 }, role: "Reclutamiento y entrenamiento" },
  herreria: { label: "Herrería/Forja", baseCosts: { gold: 100, wood: 120, stone: 100, iron: 80, food: 0 }, baseDurationSeconds: 28_800, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 50, jobType: null, requirements: { cuartel: 1, minaHierro: 1 }, role: "Armas y armaduras" },
  universidad: { label: "Universidad", baseCosts: { gold: 150, wood: 100, stone: 150, iron: 20, food: 0 }, baseDurationSeconds: 43_200, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 0, jobType: null, requirements: { castillo: 2 }, role: "Investigación y tecnologías" },
  murallas: { label: "Murallas", baseCosts: { gold: 100, wood: 100, stone: 300, iron: 20, food: 0 }, baseDurationSeconds: 36_000, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 0, jobType: null, requirements: { castillo: 2 }, role: "Defensa del reino" },
  mercado: { label: "Mercado", baseCosts: { gold: 100, wood: 150, stone: 100, iron: 0, food: 0 }, baseDurationSeconds: 28_800, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 30, jobType: null, requirements: { castillo: 2 }, role: "Intercambio y eficiencia económica" },
  parlamento: { label: "Parlamento", baseCosts: { gold: 200, wood: 100, stone: 200, iron: 20, food: 0 }, baseDurationSeconds: 43_200, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 0, jobType: null, requirements: { castillo: 2 }, role: "Desafíos y diplomacia" },
  hospitalMilitar: { label: "Hospital militar", baseCosts: { gold: 100, wood: 100, stone: 150, iron: 30, food: 0 }, baseDurationSeconds: 36_000, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 50, jobType: null, requirements: { castillo: 2 }, role: "Recuperación de heridos", professionJob: "medicine" },
  taberna: { label: "Taberna", baseCosts: { gold: 50, wood: 100, stone: 40, iron: 0, food: 0 }, baseDurationSeconds: 14_400, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 30, jobType: null, requirements: { castillo: 1 }, role: "Contratación de mercenarios" },
  panaderia: { label: "Panadería", baseCosts: { gold: 40, wood: 100, stone: 30, iron: 0, food: 0 }, baseDurationSeconds: 14_400, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 40, jobType: null, requirements: { castillo: 1 }, role: "Apoyo a la alimentación", professionJob: "bakery" },
  iglesia: { label: "Iglesia", baseCosts: { gold: 60, wood: 100, stone: 80, iron: 0, food: 0 }, baseDurationSeconds: 18_000, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 40, jobType: null, requirements: { castillo: 1 }, role: "Religión y moral", professionJob: "religion" },
  circo: { label: "Circo/Feria", baseCosts: { gold: 60, wood: 120, stone: 60, iron: 0, food: 0 }, baseDurationSeconds: 18_000, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 40, jobType: null, requirements: { castillo: 1 }, role: "Felicidad", professionJob: "entertainment" },
};

export const CONSTRUCTION = {
  /** [COMPLEMENTO §1, confirmado] Nivel máximo técnico. */
  MAX_LEVEL: 100,
  /** [COMPLEMENTO §1, confirmado] Obras simultáneas. */
  MAX_CONCURRENT: 2,
  /** [MAESTRA P22] +1 % de duración por nivel. */
  DURATION_INCREASE_PER_LEVEL: 0.01,
  /** [COMPLEMENTO D-02] coste(n) = redondear(base × 1,15^(n−1)). */
  COST_GROWTH_PER_LEVEL: 0.15,
  /** [COMPLEMENTO D-04] Reembolso fijo del 50 % al cancelar. */
  CANCEL_REFUND_RATIO: 0.5,
  /** [COMPLEMENTO D-05] Ningún edificio supera el nivel del Castillo. */
  CASTLE_CAPS_LEVELS: true,
} as const;

/**
 * [DERIVADO de P19 + P10 + capacidades D-03] Edificios con los que se funda un reino.
 * P19 exige que los 2.000 habitantes iniciales no entren en hambruna y la
 * capacidad productiva D-47 solo cuenta edificios completados. Por tanto el
 * reino nace con el Castillo nivel 1 y los niveles mínimos que alojan el censo
 * inicial y emplean la distribución inicial de trabajadores:
 *   nivel = ceil(trabajadores iniciales / capacidad por nivel).
 * Pendiente de revisión de balance; se modifica aquí sin tocar la lógica.
 */
export const INITIAL_BUILDINGS: Readonly<Record<string, number>> = {
  castillo: 1,
  viviendas: 20, // 2.000 habitantes / 100 por nivel
  granja: 11, // 1.100 agricultores / 100 por nivel
  aserradero: 4, // 250 leñadores / 80 por nivel
  cantera: 4, // 250 canteros / 80 por nivel
  minaHierro: 2, // 100 mineros / 60 por nivel
  minaOro: 1, // 50 mineros de oro / 50 por nivel
};

// ============================================================================
// 4. EJÉRCITO (D-08 a D-15, P23, P28-P32)
// ============================================================================
export type UnitType = "infanteria" | "arqueria" | "caballeria" | "asedio";
export const UNIT_TYPES: readonly UnitType[] = ["infanteria", "arqueria", "caballeria", "asedio"];

export interface UnitBalance {
  label: string;
  /** [COMPLEMENTO §3] Coste por unidad. */
  costs: ResourceCosts;
  /** [COMPLEMENTO §3] Duración de entrenamiento por unidad en segundos reales. */
  trainingSecondsPerUnit: number;
  /** Población civil libre consumida por unidad (asedio: operadores por pieza). */
  populationPerUnit: number;
  /** ¿Es tropa viva que consume raciones con el factor P18? */
  isLivingTroop: boolean;
  /** [COMPLEMENTO §3] Requisitos de edificios. */
  requirements: Readonly<Record<string, number>>;
  /** [COMPLEMENTO §6] Estadísticas relativas por regimiento. */
  attack: number;
  defense: number;
  speed: number;
  /** Multiplicador de velocidad de marcha (D-26): el ejército viaja a la velocidad del más lento. */
  marchMultiplier: number;
}

export const UNITS: Readonly<Record<UnitType, UnitBalance>> = {
  infanteria: { label: "Infantería", costs: { gold: 5, wood: 0, stone: 0, iron: 2, food: 2 }, trainingSecondsPerUnit: 1_800, populationPerUnit: 1, isLivingTroop: true, requirements: { cuartel: 1 }, attack: 1.0, defense: 1.2, speed: 1.0, marchMultiplier: 1.0 },
  arqueria: { label: "Arquería", costs: { gold: 6, wood: 2, stone: 0, iron: 2, food: 2 }, trainingSecondsPerUnit: 2_400, populationPerUnit: 1, isLivingTroop: true, requirements: { cuartel: 1 }, attack: 1.2, defense: 0.7, speed: 0.9, marchMultiplier: 1.0 },
  caballeria: { label: "Caballería", costs: { gold: 15, wood: 2, stone: 0, iron: 5, food: 4 }, trainingSecondsPerUnit: 3_600, populationPerUnit: 1, isLivingTroop: true, requirements: { cuartel: 2, herreria: 1 }, attack: 1.4, defense: 1.0, speed: 1.3, marchMultiplier: 1.2 },
  asedio: { label: "Asedio", costs: { gold: 30, wood: 20, stone: 20, iron: 10, food: 0 }, trainingSecondsPerUnit: 10_800, populationPerUnit: 5, isLivingTroop: false, requirements: { cuartel: 3, herreria: 2 }, attack: 1.8, defense: 0.5, speed: 0.6, marchMultiplier: 1.5 },
};

export const TRAINING = {
  /** [COMPLEMENTO D-09] 1 cola con Cuartel 1, +1 por cada 3 niveles completos, máximo 4. */
  BASE_QUEUES: 1,
  LEVELS_PER_EXTRA_QUEUE: 3,
  MAX_QUEUES: 4,
  /** [COMPLEMENTO D-10] Reembolso del 50 % de recursos; la población reservada vuelve íntegra. */
  CANCEL_REFUND_RATIO: 0.5,
  /** [COMPLEMENTO §3] La duración de un lote es duraciónPorUnidad × cantidad. */
  BATCH_DURATION_IS_LINEAR: true,
  /** [DECISIÓN 17-10-2026, D-51 opción B] Sin salario militar recurrente. */
  MILITARY_SALARY_ENABLED: false,
  /** [COMPLEMENTO §3] Las tecnologías de instrucción reducen la duración; mínimo relativo. */
  MIN_DURATION_RATIO: 0.5,
} as const;

/** [MAESTRA P29 + P23] Niveles militares: multiplicador de eficacia y requisitos. */
export interface MilitaryLevelBalance {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  multiplier: number;
  requirements: Readonly<Record<string, number>>;
}
export const MILITARY_LEVELS: readonly MilitaryLevelBalance[] = [
  { level: 1, name: "Milicia", multiplier: 1.0, requirements: { cuartel: 1 } },
  { level: 2, name: "Entrenado", multiplier: 1.15, requirements: { castillo: 2, cuartel: 2 } },
  { level: 3, name: "Veterano", multiplier: 1.35, requirements: { castillo: 4, cuartel: 3, universidad: 2 } },
  { level: 4, name: "Profesional", multiplier: 1.6, requirements: { castillo: 6, cuartel: 4, universidad: 3 } },
  { level: 5, name: "Élite", multiplier: 1.9, requirements: { castillo: 8, cuartel: 5, universidad: 4, herreria: 5 } },
];

/** [MAESTRA P30] Calidad de armas. */
export const WEAPONS = {
  palo: { label: "Palo", multiplier: 0.7 },
  lanzaBasica: { label: "Lanza básica", multiplier: 0.9 },
  espadaHierro: { label: "Espada de hierro", multiplier: 1.0 },
  acero: { label: "Acero", multiplier: 1.15 },
  aceroAvanzado: { label: "Acero avanzado", multiplier: 1.3 },
} as const;
export type WeaponTier = keyof typeof WEAPONS;

/** [MAESTRA P31] Calidad de armadura. */
export const ARMORS = {
  ninguna: { label: "Ninguna", multiplier: 0.7 },
  piel: { label: "Piel", multiplier: 0.85 },
  cueroReforzado: { label: "Cuero reforzado", multiplier: 0.95 },
  hierro: { label: "Hierro", multiplier: 1.1 },
  acero: { label: "Acero", multiplier: 1.25 },
} as const;
export type ArmorTier = keyof typeof ARMORS;

/**
 * [DERIVADO] Equipamiento que un reino puede fabricar según sus edificios y
 * tecnologías. La Maestra (P30, P31, P24) liga el acero y el acero avanzado a
 * tecnologías; los niveles inferiores se ligan a Herrería y Mina de hierro.
 */
export const EQUIPMENT_UNLOCKS = {
  weapons: [
    { tier: "palo" as WeaponTier, requirements: {}, technology: null },
    { tier: "lanzaBasica" as WeaponTier, requirements: { herreria: 1 }, technology: null },
    { tier: "espadaHierro" as WeaponTier, requirements: { herreria: 2, minaHierro: 1 }, technology: null },
    { tier: "acero" as WeaponTier, requirements: { herreria: 4 }, technology: "weapons_1" },
    { tier: "aceroAvanzado" as WeaponTier, requirements: { herreria: 4 }, technology: "advanced_steel" },
  ],
  armors: [
    { tier: "ninguna" as ArmorTier, requirements: {}, technology: null },
    { tier: "piel" as ArmorTier, requirements: { herreria: 1 }, technology: null },
    { tier: "cueroReforzado" as ArmorTier, requirements: { herreria: 2 }, technology: null },
    { tier: "hierro" as ArmorTier, requirements: { herreria: 3, minaHierro: 1 }, technology: null },
    { tier: "acero" as ArmorTier, requirements: { herreria: 4 }, technology: "armor_1" },
  ],
} as const;

/** [MAESTRA P32] Penalización por fatiga: intervalos (límite superior inclusivo) y multiplicador. */
export const FATIGUE_TABLE: readonly { maxFatigue: number; multiplier: number }[] = [
  { maxFatigue: 10, multiplier: 1.0 },
  { maxFatigue: 25, multiplier: 0.97 },
  { maxFatigue: 40, multiplier: 0.92 },
  { maxFatigue: 60, multiplier: 0.85 },
  { maxFatigue: 75, multiplier: 0.75 },
  { maxFatigue: 90, multiplier: 0.6 },
  { maxFatigue: 100, multiplier: 0.45 },
];

export const FATIGUE = {
  /** [COMPLEMENTO §5] Fatiga nueva = min(100, actual + 2·d·Mterreno). */
  PER_HEX: 2,
  /** [COMPLEMENTO §5] Recuperación de 10 puntos por día real en descanso con ración normal o mejor. */
  RECOVERY_PER_DAY: 10,
  MIN_TIER_FOR_RECOVERY: "normal" as const,
} as const;

/** [MAESTRA P35] Estrategias y [COMPLEMENTO §6] multiplicador de formación/estrategia (0,80–1,25). */
export type Strategy = "defensiva" | "agresiva" | "concentracion";
export const STRATEGIES: Readonly<Record<Strategy, { label: string; attack: number; defense: number; beats: Strategy }>> = {
  defensiva: { label: "Defensiva", attack: 0.9, defense: 1.2, beats: "agresiva" },
  agresiva: { label: "Agresiva", attack: 1.25, defense: 0.8, beats: "concentracion" },
  concentracion: { label: "Concentración", attack: 1.1, defense: 1.0, beats: "defensiva" },
};
export const STRATEGY_COUNTER_BONUS = 1.15; // [DERIVADO de P35: la estrategia adecuada produce ventaja]
export const STRATEGY_FACTOR_RANGE = { min: 0.8, max: 1.25 } as const;

// ============================================================================
// 4b. MERCENARIOS, SUPERVISORES, DESCANSO, ESTACIONES, ALMACÉN Y PROFESIONES (ronda 2)
// ============================================================================
/** [DECISIÓN 17-10-2026, M-02 opción A] Mercenarios contratados en la Taberna (P53). */
export const MERCENARIES = {
  GOLD_PER_UNIT: 25,
  UNIT_TYPE: "infanteria" as UnitType,
  LEVEL: 2,
  /** Máximo de mercenarios activos por nivel de Taberna. */
  MAX_PER_TAVERN_LEVEL: 50,
  CONTRACT_DAYS: 7,
  /**
   * [DECISIÓN 21-10-2026] Sin salario diario: los mercenarios se pagan íntegramente al contratarlos
   * (sección 21 de CLAUDE.md, «Sin salarios militares, incluidos los mercenarios»). Se conserva el
   * parámetro a 0 para que la liquidación y la interfaz no cambien de forma.
   */
  SALARY_GOLD_PER_DAY: 0,
  /** No cuentan para la natalidad ni para la capacidad residencial. */
  COUNTS_FOR_GROWTH: false,
} as const;

/** [DECISIÓN 17-10-2026, M-03 opción B] Ranuras de investigación según nivel de Universidad (P25). */
export const RESEARCH_SLOTS_BY_UNIVERSITY: readonly { minLevel: number; slots: number }[] = [
  { minLevel: 1, slots: 1 },
  { minLevel: 3, slots: 2 },
  { minLevel: 5, slots: 3 },
];

/** [DECISIÓN 17-10-2026, M-04 opción A] Políticas de descanso del Castillo (P15, P55). */
export type RestPolicy = "normal" | "intensiva" | "relajada";
export const REST_POLICIES: Readonly<Record<RestPolicy, { label: string; productionMultiplier: number; happinessPerDay: number; fatiguePerDay: number; description: string }>> = {
  normal: { label: "Descanso normal", productionMultiplier: 1.0, happinessPerDay: 0, fatiguePerDay: 0, description: "Sin efectos." },
  intensiva: { label: "Jornada intensiva («A tope»)", productionMultiplier: 1.15, happinessPerDay: -3, fatiguePerDay: 5, description: "+15 % de producción, −3 felicidad y +5 fatiga por día." },
  relajada: { label: "Jornada relajada", productionMultiplier: 0.9, happinessPerDay: 2, fatiguePerDay: -5, description: "−10 % de producción, +2 felicidad y −5 fatiga adicional por día." },
};

/** [DECISIÓN 17-10-2026, M-05 opción B] Estaciones informativas (P3); los modificadores quedan desactivados hasta aprobación (opción A). */
export const SEASONS = {
  ENABLED_EFFECTS: false,
  /** Cuatro estaciones por año de juego: 1/4 de día real cada una. */
  ORDER: ["primavera", "verano", "otono", "invierno"] as const,
  LABELS: { primavera: "Primavera", verano: "Verano", otono: "Otoño", invierno: "Invierno" } as const,
  /** Propuesta M-05 opción A (sin efecto mientras ENABLED_EFFECTS sea false). */
  AGRICULTURE_MODIFIER: { primavera: 0.1, verano: 0.2, otono: 0, invierno: -0.3 } as const,
  WINTER_MARCH_MULTIPLIER: 1.25,
} as const;

/** [DECISIÓN 17-10-2026, M-06 opción A] Tope de almacén por recurso. */
export const STORAGE = {
  BASE_CAPACITY: 10_000,
  CAPACITY_PER_MARKET_LEVEL: 2_000,
} as const;

/**
 * [DECISIÓN 17-10-2026, M-07 opción A] Efectos de las profesiones de P13 que no producen recursos.
 * Cada efecto escala por bloques de trabajadores con un tope.
 */
export const PROFESSION_EFFECTS = {
  medicine: { building: "hospitalMilitar", workersPerStep: 10, perStep: 0.01, max: 0.10, description: "+1 punto porcentual de recuperación de heridos por cada 10 trabajadores (máximo +10)" },
  religion: { building: "iglesia", workersPerStep: 20, perStep: 1, max: 3, description: "+1 felicidad/día por cada 20 trabajadores (máximo +3)" },
  entertainment: { building: "circo", workersPerStep: 20, perStep: 1, max: 3, description: "+1 felicidad/día por cada 20 trabajadores (máximo +3)" },
  bakery: { building: "panaderia", workersPerStep: 20, perStep: -0.05, max: -0.15, description: "−5 % de consumo de alimentos por cada 20 trabajadores (máximo −15 %)" },
  construction: { building: null, workersPerStep: 10, perStep: -0.01, max: -0.20, description: "−1 % de duración de obras por cada 10 trabajadores (máximo −20 %)" },
} as const;
export type ProfessionJob = keyof typeof PROFESSION_EFFECTS;

// ============================================================================
// 5. COMBATE (P34, P44-P47, D-27 a D-32)
// ============================================================================
export const COMBAT = {
  /** [MAESTRA P34] Pesos del combate (suman 100 %). Se conservan como referencia y para la puntuación lineal. */
  WEIGHTS: { number: 0.3, training: 0.2, weapons: 0.15, armor: 0.1, formation: 0.1, morale: 0.05, food: 0.05, fatigue: 0.05 } as const,
  /**
   * [DECISIÓN 17-10-2026, B-02 opción D] Exponentes de la fórmula multiplicativa de potencia.
   * El número conserva 0,85 (Complemento); los factores de calidad suben para que la preparación
   * pueda vencer al número (P34, P69). Validados con scripts/simulateBattles.ts.
   */
  EXPONENTS: { number: 0.85, training: 0.6, weapons: 0.45, armor: 0.3, formation: 0.3, morale: 0.15, food: 0.15, fatigue: 0.15 } as const,
  /** [COMPLEMENTO §6] Referencia de efectivos para la puntuación lineal normalizada. */
  NUMBER_REFERENCE: 1000,
  /** [COMPLEMENTO §6] Máximo de rondas. */
  MAX_ROUNDS: 3,
  /** [DECISIÓN 17-10-2026, B-01 opción B] Máximo aproximado de bajas por ronda: techo 1 − 0,60³ = 78,4 %. */
  CASUALTY_RATE_K: 0.4,
  /** [MAESTRA P44] ≈65 % de las bajas se convierten en heridos. */
  WOUNDED_RATIO: 0.65,
  /** [MAESTRA P47] Victoria aplastante: el enemigo pierde MÁS del 75 %. */
  CRUSHING_VICTORY_LOSS_RATIO: 0.75,
  /** [DECISIÓN 17-10-2026, B-02 opción B] Empate: diferencia de bajas relativas ≤ 5 puntos porcentuales. */
  DRAW_TOLERANCE: 0.05,
  /** [COMPLEMENTO §6] Retirada al perder ≥70 % de efectivos o moral < 20. */
  RETREAT_LOSS_RATIO: 0.7,
  RETREAT_MORALE_BELOW: 20,
  /** [COMPLEMENTO §6] Conversión de moral 0-100 a factor: 0,50 + M/200. */
  MORALE_FACTOR_BASE: 0.5,
  MORALE_FACTOR_DIVISOR: 200,
  /** [COMPLEMENTO §6] Factor de ración en combate limitado a 0,80–1,05. */
  FOOD_FACTOR_MIN: 0.8,
  FOOD_FACTOR_MAX: 1.05,
  /** [COMPLEMENTO D-31] Sin transferencia de botín en la primera versión. */
  LOOT_ENABLED: false,
  /** [DECISIÓN 17-10-2026, M-01 opción A] Honor y gloria por batalla definidos (ver BATTLE_REWARDS). */
  HONOR_REWARDS_DEFINED: true,
  /** [COMPLEMENTO §6] Daño de asedio solo pleno contra murallas. */
  SIEGE_ATTACK_WITHOUT_WALLS: 1.0,
  /** [DECISIÓN 17-10-2026, M-06 opción A] Murallas: +5 % de defensa por nivel, máximo +50 %. */
  WALLS_DEFENSE_PER_LEVEL: 0.05,
  WALLS_DEFENSE_MAX: 0.5,
  /** [DECISIÓN 17-10-2026, M-11 opción A] Ventaja de +25 % del tipo contra el tipo que contrarresta (P37). */
  FORMATION_COUNTER_BONUS: 0.25,
} as const;

/** [MAESTRA P37 + M-11] Matriz de contrapartidas: caballería > arqueros > infantería > caballería. */
export const UNIT_COUNTERS: Readonly<Record<Exclude<UnitType, "asedio">, Exclude<UnitType, "asedio">>> = {
  caballeria: "arqueria",
  arqueria: "infanteria",
  infanteria: "caballeria",
};

/** [DECISIÓN 17-10-2026, M-01 opción A] Recompensas de honor y gloria por batalla (P50, P51). */
export const BATTLE_REWARDS = {
  victory: { honor: 20, glory: 10 },
  crushingVictory: { honor: 50, glory: 30 },
  draw: { honor: 5, glory: 0 },
  defeat: { honor: 0, glory: -5 },
  /** La gloria decae 1 punto por día real y nunca baja de 0. */
  GLORY_DECAY_PER_DAY: 1,
  /** +1 punto de moral por cada 10 de gloria, máximo +10. */
  GLORY_MORALE_PER_POINTS: 10,
  GLORY_MORALE_MAX: 10,
} as const;

/** [MAESTRA P45] Recuperación anual de heridos por nivel de Hospital militar. */
export const HOSPITAL_RECOVERY_PER_YEAR: readonly { minLevel: number; ratio: number }[] = [
  { minLevel: 1, ratio: 0.15 },
  { minLevel: 2, ratio: 0.22 },
  { minLevel: 3, ratio: 0.3 },
  { minLevel: 4, ratio: 0.4 },
  { minLevel: 5, ratio: 0.5 },
];
/** [COMPLEMENTO §4] Tope acumulado de recuperación con tecnologías médicas. */
export const HOSPITAL_RECOVERY_CAP = 0.6;

/** [MAESTRA P59] Bonus diario: +5 honor una vez cada 24 h reales, validado en servidor. */
export const DAILY_BONUS = { HONOR: 5, COOLDOWN_MS: 24 * 60 * 60 * 1000 } as const;

// ============================================================================
// 6. TECNOLOGÍAS (D-16 a D-21)
// ============================================================================
export type TechnologyBranch = "economica" | "civil" | "militar" | "inteligencia" | "civilizacion";
export type TechnologyEffectKey =
  | "agricultureProduction"
  | "miningProduction"
  | "storageCapacity"
  | "woundedRecovery"
  | "espionageAccuracy"
  | "trainingDuration"
  | "unlockWeaponSteel"
  | "unlockArmorSteel"
  | "constructionDuration"
  | "happinessBase"
  | "unlockWeaponAdvancedSteel"
  | "combatAttack"
  | "combatDefense"
  | "marchSpeed"
  | "marchFatigue";

export interface TechnologyBalance {
  id: string;
  name: string;
  branch: TechnologyBranch;
  universityLevel: number;
  costs: ResourceCosts;
  /** Duración de investigación en segundos reales. */
  durationSeconds: number;
  buildingRequirements: Readonly<Record<string, number>>;
  technologyRequirements: readonly string[];
  civilizationRequirement?: string;
  effect: { key: TechnologyEffectKey; value: number; description: string };
}

const DAY = TIME.SECONDS_PER_GAME_YEAR;
/** [COMPLEMENTO §4, P62] Catálogo tecnológico oficial con ramas universales y tecnologías únicas de civilización. */
export const TECHNOLOGIES: readonly TechnologyBalance[] = [
  { id: "agri_1", name: "Rotación de cultivos", branch: "economica", universityLevel: 1, costs: { gold: 100, wood: 100, stone: 50, iron: 0, food: 0 }, durationSeconds: 1 * DAY, buildingRequirements: {}, technologyRequirements: [], effect: { key: "agricultureProduction", value: 0.05, description: "+5 % producción agrícola" } },
  { id: "mining_1", name: "Herramientas mineras", branch: "economica", universityLevel: 1, costs: { gold: 100, wood: 80, stone: 80, iron: 10, food: 0 }, durationSeconds: 1 * DAY, buildingRequirements: {}, technologyRequirements: [], effect: { key: "miningProduction", value: 0.05, description: "+5 % madera, piedra y hierro" } },
  { id: "storage_1", name: "Almacenes reforzados", branch: "economica", universityLevel: 1, costs: { gold: 100, wood: 150, stone: 100, iron: 0, food: 0 }, durationSeconds: 1 * DAY, buildingRequirements: {}, technologyRequirements: [], effect: { key: "storageCapacity", value: 0.1, description: "+10 % capacidad de almacenamiento" } },
  { id: "medicine_1", name: "Cataplasmas medicinales", branch: "militar", universityLevel: 2, costs: { gold: 150, wood: 80, stone: 100, iron: 10, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: [], effect: { key: "woundedRecovery", value: 0.05, description: "+5 puntos porcentuales de recuperación de heridos" } },
  { id: "espionage_1", name: "Espionaje I", branch: "inteligencia", universityLevel: 2, costs: { gold: 200, wood: 100, stone: 100, iron: 20, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: [], effect: { key: "espionageAccuracy", value: 1, description: "Desbloquea informe militar aproximado (±15 %)" } },
  { id: "training_1", name: "Doctrina de instrucción", branch: "militar", universityLevel: 2, costs: { gold: 200, wood: 100, stone: 100, iron: 30, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { cuartel: 2 }, technologyRequirements: [], effect: { key: "trainingDuration", value: -0.05, description: "−5 % duración de entrenamiento" } },
  { id: "weapons_1", name: "Metalurgia del acero", branch: "militar", universityLevel: 3, costs: { gold: 300, wood: 100, stone: 150, iron: 100, food: 0 }, durationSeconds: 3 * DAY, buildingRequirements: { castillo: 5, universidad: 3, herreria: 4 }, technologyRequirements: [], effect: { key: "unlockWeaponSteel", value: 1, description: "Desbloquea arma de acero (×1,15)" } },
  { id: "armor_1", name: "Armaduras reforzadas", branch: "militar", universityLevel: 3, costs: { gold: 300, wood: 100, stone: 150, iron: 100, food: 0 }, durationSeconds: 3 * DAY, buildingRequirements: { castillo: 5, universidad: 3, herreria: 4 }, technologyRequirements: [], effect: { key: "unlockArmorSteel", value: 1, description: "Desbloquea armadura de acero (×1,25)" } },
  { id: "construction_1", name: "Ingeniería civil", branch: "civil", universityLevel: 2, costs: { gold: 200, wood: 150, stone: 200, iron: 20, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: [], effect: { key: "constructionDuration", value: -0.05, description: "−5 % duración de construcción (mínimo 50 % de la base)" } },
  { id: "happiness_1", name: "Fiestas comunales", branch: "civil", universityLevel: 1, costs: { gold: 100, wood: 100, stone: 50, iron: 0, food: 0 }, durationSeconds: 1 * DAY, buildingRequirements: {}, technologyRequirements: [], effect: { key: "happinessBase", value: 3, description: "+3 felicidad base (límite 100)" } },
  { id: "medical_2", name: "Cirugía de campaña", branch: "militar", universityLevel: 4, costs: { gold: 500, wood: 150, stone: 200, iron: 150, food: 0 }, durationSeconds: 5 * DAY, buildingRequirements: { hospitalMilitar: 3 }, technologyRequirements: ["medicine_1"], effect: { key: "woundedRecovery", value: 0.1, description: "+10 puntos porcentuales de recuperación (tope acumulado 60 %)" } },
  { id: "espionage_2", name: "Espionaje II", branch: "inteligencia", universityLevel: 4, costs: { gold: 500, wood: 200, stone: 200, iron: 100, food: 0 }, durationSeconds: 5 * DAY, buildingRequirements: { universidad: 4 }, technologyRequirements: ["espionage_1"], effect: { key: "espionageAccuracy", value: 2, description: "Estrecha el intervalo de estimación militar (±7 %)" } },
  { id: "advanced_steel", name: "Acero avanzado", branch: "militar", universityLevel: 4, costs: { gold: 700, wood: 200, stone: 300, iron: 250, food: 0 }, durationSeconds: 7 * DAY, buildingRequirements: { castillo: 5, universidad: 3, herreria: 4 }, technologyRequirements: ["weapons_1"], effect: { key: "unlockWeaponAdvancedSteel", value: 1, description: "Desbloquea arma de acero avanzado (×1,30)" } },

  // ==========================================================================
  // TECNOLOGÍAS ÚNICAS POR CIVILIZACIÓN (P62, Bloque 10)
  // Cada una requiere Universidad nivel 2 y pertenecer a la civilización canónica
  // ==========================================================================
  { id: "tech_civ_ingleses", name: "Arco largo inglés", branch: "civilizacion", universityLevel: 2, costs: { gold: 200, wood: 250, stone: 80, iron: 50, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { cuartel: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "ingleses", effect: { key: "combatAttack", value: 0.05, description: "+5 % ataque militar (alcance letal de arquería)" } },
  { id: "tech_civ_romanos", name: "Legión y testudo", branch: "civilizacion", universityLevel: 2, costs: { gold: 200, wood: 80, stone: 250, iron: 80, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "romanos", effect: { key: "combatDefense", value: 0.05, description: "+5 % defensa militar en formación cerrada" } },
  { id: "tech_civ_griegos", name: "Falange y dialéctica", branch: "civilizacion", universityLevel: 2, costs: { gold: 250, wood: 100, stone: 150, iron: 60, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { universidad: 2 }, technologyRequirements: [], civilizationRequirement: "griegos", effect: { key: "combatDefense", value: 0.05, description: "+5 % defensa militar en formación de falange" } },
  { id: "tech_civ_vikingos", name: "Drakkar y furia nórdica", branch: "civilizacion", universityLevel: 2, costs: { gold: 180, wood: 300, stone: 80, iron: 60, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { cuartel: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "vikingos", effect: { key: "combatAttack", value: 0.05, description: "+5 % ataque militar e ímpetu de asalto" } },
  { id: "tech_civ_bizantinos", name: "Fuego griego y baluartes", branch: "civilizacion", universityLevel: 2, costs: { gold: 300, wood: 100, stone: 200, iron: 100, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "bizantinos", effect: { key: "combatDefense", value: 0.06, description: "+6 % defensa militar y fuego defensivo" } },
  { id: "tech_civ_arabes", name: "Medicina de Córdoba y riego", branch: "civilizacion", universityLevel: 2, costs: { gold: 250, wood: 120, stone: 120, iron: 40, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { hospitalMilitar: 1, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "arabes", effect: { key: "woundedRecovery", value: 0.10, description: "+10 pp recuperación de heridos y acequias de regadío" } },
  { id: "tech_civ_mongoles", name: "Tácticas de la estepa", branch: "civilizacion", universityLevel: 2, costs: { gold: 200, wood: 150, stone: 80, iron: 50, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { establo: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "mongoles", effect: { key: "marchSpeed", value: 0.15, description: "+15 % velocidad de marcha y maniobra envolvente" } },
  { id: "tech_civ_chinos", name: "Gran Muralla y pólvora", branch: "civilizacion", universityLevel: 2, costs: { gold: 220, wood: 150, stone: 300, iron: 50, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "chinos", effect: { key: "combatDefense", value: 0.06, description: "+6 % defensa militar y arquitectura defensiva" } },
  { id: "tech_civ_japoneses", name: "Acero Tamahagane y Bushido", branch: "civilizacion", universityLevel: 2, costs: { gold: 250, wood: 100, stone: 100, iron: 120, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { herreria: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "japoneses", effect: { key: "combatAttack", value: 0.05, description: "+5 % ataque militar por temple de hojas de acero" } },
  { id: "tech_civ_indiosAmericanos", name: "Rastreadores del bosque", branch: "civilizacion", universityLevel: 2, costs: { gold: 150, wood: 250, stone: 100, iron: 30, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { universidad: 2 }, technologyRequirements: [], civilizationRequirement: "indiosAmericanos", effect: { key: "marchFatigue", value: 0.20, description: "−20 % fatiga de marcha por sendas y bosques" } },
  { id: "tech_civ_aztecas", name: "Chinampas y sacerdotes guerreros", branch: "civilizacion", universityLevel: 2, costs: { gold: 200, wood: 200, stone: 150, iron: 30, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { universidad: 2 }, technologyRequirements: [], civilizationRequirement: "aztecas", effect: { key: "agricultureProduction", value: 0.08, description: "+8 % producción agrícola en huertos intensivos" } },
  { id: "tech_civ_keniatas", name: "Resistencia Masai y sabana", branch: "civilizacion", universityLevel: 2, costs: { gold: 160, wood: 180, stone: 100, iron: 40, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { universidad: 2 }, technologyRequirements: [], civilizationRequirement: "keniatas", effect: { key: "marchFatigue", value: 0.25, description: "−25 % fatiga en expediciones de larga distancia" } },
];

export const RESEARCH = {
  /** [COMPLEMENTO §4] Una investigación activa por reino sin supervisores; máximo 3. */
  BASE_SLOTS: 1,
  MAX_SLOTS: 3,
  /** [COMPLEMENTO §4] Reembolso del 50 % al cancelar. */
  CANCEL_REFUND_RATIO: 0.5,
  /** [COMPLEMENTO §4] Mínimo de duración de construcción tras reducciones tecnológicas. */
  CONSTRUCTION_MIN_DURATION_RATIO: 0.5,
} as const;

// ============================================================================
// 7. MAPA Y TERRITORIOS (D-22 a D-26)
// ============================================================================
export type TerrainType = "llanura" | "bosque" | "colina" | "montana" | "rio" | "costa";
export interface TerrainBalance {
  label: string;
  /** Modificadores económicos (aplicados solo si el reino posee el territorio y el edificio correspondiente). */
  production: Partial<Record<ProductiveJob, number>>;
  defense: number;
  commerce: number;
  marchMultiplier: number;
}
/** [COMPLEMENTO D-24] Terrenos y modificadores iniciales. */
export const TERRAINS: Readonly<Record<TerrainType, TerrainBalance>> = {
  llanura: { label: "Llanura", production: { agriculture: 0.1 }, defense: 0, commerce: 0, marchMultiplier: 1.0 },
  bosque: { label: "Bosque", production: { wood: 0.15 }, defense: 0, commerce: 0, marchMultiplier: 1.0 },
  colina: { label: "Colina", production: { stone: 0.1 }, defense: 0, commerce: 0, marchMultiplier: 1.0 },
  montana: { label: "Montaña", production: { iron: 0.15 }, defense: 0.1, commerce: 0, marchMultiplier: 1.0 },
  rio: { label: "Río", production: { agriculture: 0.1 }, defense: 0, commerce: 0, marchMultiplier: 1.0 },
  costa: { label: "Costa", production: {}, defense: 0, commerce: 0.1, marchMultiplier: 1.0 },
};

export const MAP = {
  /** [COMPLEMENTO D-23] Mapa hexagonal axial de radio 10 alrededor del centro: 331 celdas. */
  RADIUS: 10,
  MAX_CELLS: 331,
  /** [COMPLEMENTO §5] Tiempo base de marcha por hexágono en segundos reales. */
  MARCH_SECONDS_PER_HEX: 1_800,
  /** [DERIVADO] Semilla de mundo reproducible para asignar terrenos (D-25). */
  WORLD_SEED: 20261017,
} as const;

export const EXPLORATION = {
  /** [P22, P49] Costes base de aprovisionamiento de una expedición de exploración */
  BASE_COSTS: { gold: 30, food: 40, wood: 0, stone: 0, iron: 0 } as const,
  /** [P22] Exploradores requeridos (ciudadanos libres reservados durante la marcha) */
  SCOUTS_REQUIRED: 1,
  /** [COMPLEMENTO §5 / D-26] Segundos reales de marcha por hexágono de distancia */
  SECONDS_PER_HEX: MAP.MARCH_SECONDS_PER_HEX,
  /** Radio de visión inicial alrededor del territorio principal (distancia <= 1, 7 celdas conocidas) */
  INITIAL_SIGHT_RADIUS: 1,
  /** Límite de expediciones de exploración concurrentes por reino */
  MAX_CONCURRENT_EXPEDITIONS: 1,
  /** Reembolso al cancelar expedición en curso (D-04, D-21: 50%) */
  CANCELLATION_REFUND_RATIO: 0.5,
} as const;

// ============================================================================
// 8. PARLAMENTO Y DESAFÍOS (D-34 a D-42)
// ============================================================================
export const PARLIAMENT = {
  /** [COMPLEMENTO D-34] Penalización por rechazo: 2 % de cada recurso, mínimo 10, máximo 500, sin bajar de 0. */
  REJECTION_PENALTY_RATIO: 0.02,
  REJECTION_PENALTY_MIN: 10,
  REJECTION_PENALTY_MAX: 500,
  /** [MAESTRA P38 + COMPLEMENTO D-35] Tres ventanas: 1, 3 y 7 días reales desde la aceptación. */
  SCHEDULE_WINDOWS_MS: { proxima: 1 * TIME.MS_PER_GAME_YEAR, dias: 3 * TIME.MS_PER_GAME_YEAR, semana: 7 * TIME.MS_PER_GAME_YEAR } as const,
  /** [COMPLEMENTO D-36] Congelación 15 minutos reales antes del combate. */
  FREEZE_BEFORE_BATTLE_MS: 15 * 60 * 1000,
  /** [COMPLEMENTO D-37] Sin apuestas en la primera versión. */
  WAGERS_ENABLED: false,
  /** [COMPLEMENTO D-40] Máximo de desafíos pendientes y enfriamiento por rival. */
  MAX_PENDING_PER_KINGDOM: 3,
  SAME_RIVAL_COOLDOWN_MS: 24 * 60 * 60 * 1000,
  /** [COMPLEMENTO D-42] Nivel de Parlamento necesario para enviar o recibir desafíos. */
  REQUIRED_PARLIAMENT_LEVEL: 1,
  /** [COMPLEMENTO D-39] Espionaje: error de estimación según nivel y coste por informe. */
  ESPIONAGE: {
    errorByLevel: { 0: 0.25, 1: 0.15, 2: 0.07 } as Readonly<Record<number, number>>,
    costByLevel: { 1: 100, 2: 250 } as Readonly<Record<number, number>>,
    reportTtlMs: 24 * 60 * 60 * 1000,
  },
  /** [DERIVADO] Un desafío pendiente caduca si no se responde antes de la ventana más larga (7 días reales). */
  PENDING_EXPIRY_MS: 7 * TIME.MS_PER_GAME_YEAR,
} as const;
export type ScheduleWindow = keyof typeof PARLIAMENT.SCHEDULE_WINDOWS_MS;

/** [MAESTRA P60] Mensajes predefinidos; no hay chat libre. */
export const PREDEFINED_MESSAGES = [
  { id: "reto", text: "¿Te atreves a retarme?" },
  { id: "preparado", text: "Mi reino está preparado." },
  { id: "suerte", text: "Buena suerte." },
  { id: "todo", text: "¿Eso es todo?" },
  { id: "campo", text: "Nos veremos en el campo de batalla." },
] as const;

// ============================================================================
// 9. CIVILIZACIONES (P6, P62, D-43 a D-45, Bloque 10)
// ============================================================================

export interface CivilizationPassiveConfig {
  description: string;
  production: Partial<Record<ProductiveJob, number>>;
  constructionDurationMultiplier: number;
  researchDurationMultiplier: number;
  explorationDurationMultiplier: number;
  explorationCostMultiplier: number;
  woundedRecoveryBonus: number;
  marchSpeedMultiplier: number;
  fatigueAccrualMultiplier: number;
  residentialCapacityMultiplier: number;
  storageCapacityMultiplier?: number;
  trainingDurationByUnit: Partial<Record<UnitType, number>>;
  combatAttackMultiplier: number;
  combatDefenseMultiplier: number;
  happinessBonus: number;
}

export interface CivilizationBalance {
  id: string;
  label: string;
  emblem: string;
  style: string;
  passive: CivilizationPassiveConfig;
  uniqueTechnologyId: string;
}

/**
 * [MAESTRA P6, P62] Doce civilizaciones canónicas con identidad estratégica balanceada.
 * Ninguna es objetivamente superior; cada una ofrece un perfil distintivo económico,
 * demográfico, de expansión o militar calibrado entre el 5 % y el 15 %.
 */
export const CIVILIZATIONS = [
  {
    id: "ingleses",
    label: "Ingleses",
    emblem: "🏹",
    style: "Arqueros de tiro largo y maestros madereros",
    passive: {
      description: "+10 % producción de madera en aserraderos y −10 % duración de instrucción de arqueros",
      production: { wood: 0.10 },
      constructionDurationMultiplier: 1.0,
      researchDurationMultiplier: 1.0,
      explorationDurationMultiplier: 1.0,
      explorationCostMultiplier: 1.0,
      woundedRecoveryBonus: 0,
      marchSpeedMultiplier: 1.0,
      fatigueAccrualMultiplier: 1.0,
      residentialCapacityMultiplier: 1.0,
      trainingDurationByUnit: { arqueria: 0.90 },
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
    },
    uniqueTechnologyId: "tech_civ_ingleses",
  },
  {
    id: "romanos",
    label: "Romanos",
    emblem: "🏛️",
    style: "Ingeniería de calzadas, cantería y legiones disciplinadas",
    passive: {
      description: "+10 % producción de piedra en canteras y −10 % duración de construcción de edificios",
      production: { stone: 0.10 },
      constructionDurationMultiplier: 0.90,
      researchDurationMultiplier: 1.0,
      explorationDurationMultiplier: 1.0,
      explorationCostMultiplier: 1.0,
      woundedRecoveryBonus: 0,
      marchSpeedMultiplier: 1.0,
      fatigueAccrualMultiplier: 1.0,
      residentialCapacityMultiplier: 1.0,
      trainingDurationByUnit: {},
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
    },
    uniqueTechnologyId: "tech_civ_romanos",
  },
  {
    id: "griegos",
    label: "Griegos",
    emblem: "🏺",
    style: "Erudición de la Academia, falange cívica y bienestar",
    passive: {
      description: "−10 % duración de investigaciones en Universidad y +5 puntos de felicidad base",
      production: {},
      constructionDurationMultiplier: 1.0,
      researchDurationMultiplier: 0.90,
      explorationDurationMultiplier: 1.0,
      explorationCostMultiplier: 1.0,
      woundedRecoveryBonus: 0,
      marchSpeedMultiplier: 1.0,
      fatigueAccrualMultiplier: 1.0,
      residentialCapacityMultiplier: 1.0,
      trainingDurationByUnit: {},
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 5,
    },
    uniqueTechnologyId: "tech_civ_griegos",
  },
  {
    id: "vikingos",
    label: "Vikingos",
    emblem: "⚔️",
    style: "Exploración marítima rápida, asaltos y grandes depósitos",
    passive: {
      description: "−15 % duración de expediciones de exploración y +10 % capacidad de almacenamiento",
      production: {},
      constructionDurationMultiplier: 1.0,
      researchDurationMultiplier: 1.0,
      explorationDurationMultiplier: 0.85,
      explorationCostMultiplier: 1.0,
      woundedRecoveryBonus: 0,
      marchSpeedMultiplier: 1.0,
      fatigueAccrualMultiplier: 1.0,
      residentialCapacityMultiplier: 1.0,
      trainingDurationByUnit: {},
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
    },
    uniqueTechnologyId: "tech_civ_vikingos",
  },
  {
    id: "bizantinos",
    label: "Bizantinos",
    emblem: "🛡️",
    style: "Moneda sólida, recaudación imperial y murallas inexpugnables",
    passive: {
      description: "+10 % producción de oro y +5 % poder defensivo militar del reino",
      production: { gold: 0.10 },
      constructionDurationMultiplier: 1.0,
      researchDurationMultiplier: 1.0,
      explorationDurationMultiplier: 1.0,
      explorationCostMultiplier: 1.0,
      woundedRecoveryBonus: 0,
      marchSpeedMultiplier: 1.0,
      fatigueAccrualMultiplier: 1.0,
      residentialCapacityMultiplier: 1.0,
      trainingDurationByUnit: {},
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.05,
      happinessBonus: 0,
    },
    uniqueTechnologyId: "tech_civ_bizantinos",
  },
  {
    id: "arabes",
    label: "Árabes",
    emblem: "🌙",
    style: "Medicina de vanguardia, caravanas comerciales y regadío",
    passive: {
      description: "+8 pp tasa de recuperación de heridos y +5 % producción de oro por comercio",
      production: { gold: 0.05 },
      constructionDurationMultiplier: 1.0,
      researchDurationMultiplier: 1.0,
      explorationDurationMultiplier: 1.0,
      explorationCostMultiplier: 1.0,
      woundedRecoveryBonus: 0.08,
      marchSpeedMultiplier: 1.0,
      fatigueAccrualMultiplier: 1.0,
      residentialCapacityMultiplier: 1.0,
      trainingDurationByUnit: {},
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
    },
    uniqueTechnologyId: "tech_civ_arabes",
  },
  {
    id: "mongoles",
    label: "Mongoles",
    emblem: "🐎",
    style: "Jinetes de la estepa, velocidad de marcha y caballería ligera",
    passive: {
      description: "+15 % velocidad de marcha en el mapa y −10 % duración de instrucción de caballería",
      production: {},
      constructionDurationMultiplier: 1.0,
      researchDurationMultiplier: 1.0,
      explorationDurationMultiplier: 1.0,
      explorationCostMultiplier: 1.0,
      woundedRecoveryBonus: 0,
      marchSpeedMultiplier: 1.15,
      fatigueAccrualMultiplier: 1.0,
      residentialCapacityMultiplier: 1.0,
      trainingDurationByUnit: { caballeria: 0.90 },
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
    },
    uniqueTechnologyId: "tech_civ_mongoles",
  },
  {
    id: "chinos",
    label: "Chinos",
    emblem: "🏮",
    style: "Gran censo ordenado, cultivos intensivos y arquitectura defensiva",
    passive: {
      description: "+8 % producción de alimentos agrícolas y +5 % capacidad residencial en viviendas",
      production: { agriculture: 0.08 },
      constructionDurationMultiplier: 1.0,
      researchDurationMultiplier: 1.0,
      explorationDurationMultiplier: 1.0,
      explorationCostMultiplier: 1.0,
      woundedRecoveryBonus: 0,
      marchSpeedMultiplier: 1.0,
      fatigueAccrualMultiplier: 1.0,
      residentialCapacityMultiplier: 1.05,
      trainingDurationByUnit: {},
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
    },
    uniqueTechnologyId: "tech_civ_chinos",
  },
  {
    id: "japoneses",
    label: "Japoneses",
    emblem: "⛩️",
    style: "Tradición samurái, temple del hierro y espíritu marcial",
    passive: {
      description: "+10 % producción de hierro en minas y +5 % poder ofensivo militar",
      production: { iron: 0.10 },
      constructionDurationMultiplier: 1.0,
      researchDurationMultiplier: 1.0,
      explorationDurationMultiplier: 1.0,
      explorationCostMultiplier: 1.0,
      woundedRecoveryBonus: 0,
      marchSpeedMultiplier: 1.0,
      fatigueAccrualMultiplier: 1.0,
      residentialCapacityMultiplier: 1.0,
      trainingDurationByUnit: {},
      combatAttackMultiplier: 1.05,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
    },
    uniqueTechnologyId: "tech_civ_japoneses",
  },
  {
    id: "indiosAmericanos",
    label: "Indios americanos",
    emblem: "🦅",
    style: "Rastreo ancestral, expediciones autosuficientes y bosques vivos",
    passive: {
      description: "−20 % costes de oro y comida en expediciones y +8 % producción de madera",
      production: { wood: 0.08 },
      constructionDurationMultiplier: 1.0,
      researchDurationMultiplier: 1.0,
      explorationDurationMultiplier: 1.0,
      explorationCostMultiplier: 0.80,
      woundedRecoveryBonus: 0,
      marchSpeedMultiplier: 1.0,
      fatigueAccrualMultiplier: 1.0,
      residentialCapacityMultiplier: 1.0,
      trainingDurationByUnit: {},
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
    },
    uniqueTechnologyId: "tech_civ_indiosAmericanos",
  },
  {
    id: "aztecas",
    label: "Aztecas",
    emblem: "☀️",
    style: "Chinampas de alto rendimiento, fervor comunal y festividades",
    passive: {
      description: "+12 % producción de alimentos agrícolas y +4 puntos de felicidad base",
      production: { agriculture: 0.12 },
      constructionDurationMultiplier: 1.0,
      researchDurationMultiplier: 1.0,
      explorationDurationMultiplier: 1.0,
      explorationCostMultiplier: 1.0,
      woundedRecoveryBonus: 0,
      marchSpeedMultiplier: 1.0,
      fatigueAccrualMultiplier: 1.0,
      residentialCapacityMultiplier: 1.0,
      trainingDurationByUnit: {},
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 4,
    },
    uniqueTechnologyId: "tech_civ_aztecas",
  },
  {
    id: "keniatas",
    label: "Keniatas",
    emblem: "🌾",
    style: "Fondo físico inagotable en marchas y ganadería/agricultura tenaz",
    passive: {
      description: "−25 % fatiga acumulada en marchas territoriales y +6 % producción de alimentos",
      production: { agriculture: 0.06 },
      constructionDurationMultiplier: 1.0,
      researchDurationMultiplier: 1.0,
      explorationDurationMultiplier: 1.0,
      explorationCostMultiplier: 1.0,
      woundedRecoveryBonus: 0,
      marchSpeedMultiplier: 1.0,
      fatigueAccrualMultiplier: 0.75,
      residentialCapacityMultiplier: 1.0,
      trainingDurationByUnit: {},
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
    },
    uniqueTechnologyId: "tech_civ_keniatas",
  },
] as const;

export type CivilizationId = (typeof CIVILIZATIONS)[number]["id"];
export const CIVILIZATION_BONUSES_ENABLED = true;
export const CIVILIZATION_IMMUTABLE = true;
