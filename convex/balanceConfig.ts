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

/**
 * [DECISIÓN 21-10-2026] Cuatro formaciones tácticas: ofensiva, defensiva, equilibrada y flanqueo.
 * Se SUMAN a la estrategia (P35) y a la matriz entre tipos de unidad (M-11): el factor de
 * formación de la fórmula de potencia es estrategia × formación táctica.
 * Valores [DERIVADO, pendientes de aprobación], validados con scripts/simulateBattles.ts:
 *  - Ofensiva: +12 % ataque / −10 % defensa; fuerte contra flanqueo, débil contra defensiva.
 *  - Defensiva: −10 % ataque / +12 % defensa; fuerte contra ofensiva, débil contra flanqueo.
 *  - Flanqueo: +6 % ataque / −4 % defensa; fuerte contra defensiva, débil contra ofensiva.
 *  - Equilibrada: sin modificadores ni ventaja; nadie la contrarresta.
 * Los modificadores entran en el término Formación^0,3 (acotado 0,85–1,25). Contrarrestar es el
 * término «Contramedida» de la fórmula: ×1,15 directo sobre la potencia. Con ejércitos iguales,
 * la formación que contrarresta gana por ~6,7 puntos de bajas (victoria clara, nunca aplastante);
 * cualquier otro cruce queda en empate.
 */
export type TacticalFormation = "ofensiva" | "defensiva" | "equilibrada" | "flanqueo";
export const TACTICAL_FORMATIONS: Readonly<Record<TacticalFormation, { label: string; attack: number; defense: number; beats: TacticalFormation | null; description: string }>> = {
  ofensiva: { label: "Ofensiva", attack: 1.12, defense: 0.9, beats: "flanqueo", description: "Prioriza infligir daño y romper la línea enemiga." },
  defensiva: { label: "Defensiva", attack: 0.9, defense: 1.12, beats: "ofensiva", description: "Prioriza reducir bajas propias y resistir." },
  equilibrada: { label: "Equilibrada", attack: 1.0, defense: 1.0, beats: null, description: "Sin especialización extrema; respuesta flexible." },
  flanqueo: { label: "Flanqueo", attack: 1.06, defense: 0.96, beats: "defensiva", description: "Busca atacar los laterales y desorganizar al rival." },
};
export const TACTICAL_FORMATION_COUNTER_BONUS = 1.15;
export const TACTICAL_FORMATION_FACTOR_RANGE = { min: 0.85, max: 1.25 } as const;
export const DEFAULT_TACTICAL_FORMATION: TacticalFormation = "equilibrada";

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
  /**
   * [DECISIÓN 21-10-2026] Varios tipos, «unos más baratos y otros más caros», ligados al nivel de
   * la Taberna y sin salario. Precio [DERIVADO, pendiente de aprobación]: parte del anclaje
   * aprobado (lanceros = 25 oro, infantería nivel 2) y escala con el oro de instrucción de la
   * unidad y con el multiplicador del nivel militar, redondeado a 5:
   *   precio = redondear5( 25 × (oroInstrucción / 5) × (multiplicadorNivel / 1,15) ).
   * El límite de activos (50 por nivel de Taberna) es común a todos los tipos.
   */
  TYPES: [
    { id: "mesnada", label: "Mesnada a sueldo", unitType: "infanteria" as UnitType, level: 1, goldPerUnit: 20, minTavernLevel: 1, description: "Infantería de milicia (nivel 1): la opción más barata." },
    { id: "lanceros", label: "Lanceros a sueldo", unitType: "infanteria" as UnitType, level: 2, goldPerUnit: 25, minTavernLevel: 1, description: "Infantería entrenada (nivel 2); el contrato de referencia." },
    { id: "arqueros", label: "Arqueros de fortuna", unitType: "arqueria" as UnitType, level: 2, goldPerUnit: 30, minTavernLevel: 2, description: "Arquería entrenada (nivel 2)." },
    { id: "jinetes", label: "Jinetes de fortuna", unitType: "caballeria" as UnitType, level: 2, goldPerUnit: 75, minTavernLevel: 3, description: "Caballería entrenada (nivel 2); cara pero rápida." },
    { id: "veteranos", label: "Compañía veterana", unitType: "infanteria" as UnitType, level: 3, goldPerUnit: 30, minTavernLevel: 4, description: "Infantería veterana (nivel 3)." },
    { id: "guardia", label: "Guardia mercenaria", unitType: "caballeria" as UnitType, level: 3, goldPerUnit: 90, minTavernLevel: 5, description: "Caballería veterana (nivel 3): la más cara." },
  ],
  /** Tipo por defecto (compatibilidad con la contratación anterior). */
  DEFAULT_TYPE_ID: "lanceros",
} as const;
export type MercenaryTypeId = (typeof MERCENARIES.TYPES)[number]["id"];

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

/** [M-07] Capacidades de trabajadores por nivel de los edificios con profesión. */
export const PROFESSION_BUILDING_CAPACITY: Readonly<Record<string, number>> = {
  hospitalMilitar: BUILDINGS.hospitalMilitar.workerCapacityPerLevel,
  iglesia: BUILDINGS.iglesia.workerCapacityPerLevel,
  circo: BUILDINGS.circo.workerCapacityPerLevel,
  panaderia: BUILDINGS.panaderia.workerCapacityPerLevel,
};

/**
 * [DECISIÓN 23-10-2026] Prioridad de reducción de trabajadores asignados ante muertes por inanición:
 * De menor prioridad vital a mayor prioridad vital. La agricultura se preserva hasta el final.
 */
export const STARVATION_JOB_REDUCTION_PRIORITY: readonly string[] = [
  "entertainment",
  "religion",
  "scholars",
  "construction",
  "gold",
  "medicine",
  "wood",
  "stone",
  "iron",
  "mining",
  "military",
  "other",
  "bakery",
  "agriculture",
];

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
// 5c. MISIONES (P3, P50, P51, P59 · sección 17 de CLAUDE.md)
// ============================================================================
/**
 * [DECISIÓN 2026-10-21] Misiones progresivas por etapas (se revela una etapa cada vez), diarias
 * (mismo conjunto y premios para todos; se renuevan cada día) y secretas (ocultas hasta cumplirse;
 * el mismo número por civilización). Completado y recompensa automáticos en servidor, una sola vez.
 * Cantidades [DERIVADO, pendientes de aprobación]: escaladas a los recursos fundacionales
 * (500 oro, 1.000 madera…) y a las recompensas de batalla (victoria +20 honor / +10 gloria).
 */
export type MissionCounterKey =
  | "buildingsCompleted" | "troopsTrained" | "researchStarted" | "researchCompleted" | "battlesFought"
  | "battlesWon" | "crushingVictories" | "challengesSent" | "explorationsCompleted" | "territoriesClaimed" | "dailyBonusClaimed";
export type MissionConditionType =
  | "buildingLevel" | "population" | "technologiesCompleted" | "technologyCompleted" | "armySize" | "happiness" | "honor" | "resourceStock" | "territoriesOwned"
  | "lifetime" | "daily";
export interface MissionCondition {
  type: MissionConditionType;
  value: number;
  buildingType?: string;
  technologyId?: string;
  resource?: ResourceType;
  /** Para "lifetime" y "daily": contador que se compara con value. */
  counter?: MissionCounterKey;
}
export interface MissionReward {
  resources?: Partial<ResourceCosts>;
  honor?: number;
  glory?: number;
  troops?: { unitType: UnitType; level: number; count: number };
  /** Bonificación temporal de producción (multiplicador × días reales). */
  productionBonus?: { multiplier: number; days: number };
}
export interface MissionDefinition {
  id: string;
  title: string;
  description: string;
  condition: MissionCondition;
  reward: MissionReward;
  /** Solo para misiones secretas exclusivas de una civilización. */
  civilization?: string;
}
export interface MissionStage {
  stage: number;
  title: string;
  missions: readonly MissionDefinition[];
  /** Premio adicional al completar todas las misiones de la etapa. */
  reward: MissionReward;
}

export const MISSIONS = {
  /** Las etapas se desbloquean una a una: solo se muestra la etapa en curso y las ya completadas. */
  STAGES: [
    {
      stage: 1,
      title: "Los primeros pasos",
      missions: [
        { id: "s1_castillo2", title: "Torres más altas", description: "Mejora el Castillo al nivel 2 (ningún edificio puede superar su nivel).", condition: { type: "buildingLevel", buildingType: "castillo", value: 2 }, reward: { resources: { stone: 200, wood: 150 }, honor: 5 } },
        { id: "s1_cuartel", title: "Llamada a las armas", description: "Construye el Cuartel.", condition: { type: "buildingLevel", buildingType: "cuartel", value: 1 }, reward: { resources: { gold: 50, iron: 50 }, honor: 5 } },
        { id: "s1_taberna", title: "Posada del reino", description: "Construye la Taberna.", condition: { type: "buildingLevel", buildingType: "taberna", value: 1 }, reward: { resources: { gold: 50, food: 100 }, honor: 5 } },
        { id: "s1_tropas", title: "Primera leva", description: "Entrena 10 tropas en total.", condition: { type: "lifetime", counter: "troopsTrained", value: 10 }, reward: { resources: { gold: 50, food: 100 }, honor: 5 } },
        { id: "s1_universidad", title: "Casa del saber", description: "Construye la Universidad (requiere Castillo 2).", condition: { type: "buildingLevel", buildingType: "universidad", value: 1 }, reward: { resources: { gold: 100 }, honor: 5 } },
      ],
      reward: { resources: { gold: 200, wood: 200, stone: 200, iron: 100, food: 300 }, honor: 10, glory: 5, troops: { unitType: "infanteria" as UnitType, level: 1, count: 20 } },
    },
    {
      stage: 2,
      title: "Un reino en marcha",
      missions: [
        { id: "s2_castillo3", title: "Sede del poder", description: "Mejora el Castillo al nivel 3.", condition: { type: "buildingLevel", buildingType: "castillo", value: 3 }, reward: { resources: { stone: 300 }, honor: 10 } },
        { id: "s2_investigacion", title: "Primer descubrimiento", description: "Completa tu primera investigación.", condition: { type: "technologiesCompleted", value: 1 }, reward: { resources: { gold: 150 }, honor: 10 } },
        { id: "s2_poblacion", title: "Ciudad creciente", description: "Alcanza 2.600 habitantes.", condition: { type: "population", value: 2600 }, reward: { resources: { food: 500 }, honor: 10 } },
        { id: "s2_ejercito", title: "Guarnición", description: "Mantén 50 tropas activas.", condition: { type: "armySize", value: 50 }, reward: { resources: { iron: 100 }, honor: 10 } },
        { id: "s2_parlamento", title: "Voz entre reinos", description: "Construye el Parlamento.", condition: { type: "buildingLevel", buildingType: "parlamento", value: 1 }, reward: { resources: { gold: 150 }, honor: 10 } },
      ],
      reward: { resources: { gold: 400, wood: 400, stone: 400, iron: 200, food: 600 }, honor: 20, glory: 10, productionBonus: { multiplier: 1.05, days: 1 } },
    },
    {
      stage: 3,
      title: "La corona se afirma",
      missions: [
        { id: "s3_castillo4", title: "Alcázar", description: "Mejora el Castillo al nivel 4.", condition: { type: "buildingLevel", buildingType: "castillo", value: 4 }, reward: { resources: { stone: 500 }, honor: 10 } },
        { id: "s3_murallas", title: "Piedra sobre piedra", description: "Construye las Murallas.", condition: { type: "buildingLevel", buildingType: "murallas", value: 1 }, reward: { resources: { stone: 300, iron: 100 }, honor: 10 } },
        { id: "s3_desafio", title: "Guante arrojado", description: "Envía tu primer desafío por el Parlamento.", condition: { type: "lifetime", counter: "challengesSent", value: 1 }, reward: { honor: 10 } },
        { id: "s3_batalla", title: "Bautismo de fuego", description: "Libra tu primera batalla.", condition: { type: "lifetime", counter: "battlesFought", value: 1 }, reward: { resources: { food: 300 }, honor: 10 } },
        { id: "s3_victoria", title: "Primera victoria", description: "Gana tu primera batalla.", condition: { type: "lifetime", counter: "battlesWon", value: 1 }, reward: { resources: { gold: 200 }, honor: 15, glory: 5 } },
        { id: "s3_tecnologias", title: "Tres saberes", description: "Completa 3 investigaciones.", condition: { type: "technologiesCompleted", value: 3 }, reward: { resources: { gold: 200 }, honor: 10 } },
      ],
      reward: { resources: { gold: 600, wood: 600, stone: 600, iron: 300, food: 800 }, honor: 30, glory: 15, troops: { unitType: "arqueria" as UnitType, level: 2, count: 30 } },
    },
    {
      stage: 4,
      title: "Señor de la guerra",
      missions: [
        { id: "s4_castillo6", title: "Ciudadela", description: "Mejora el Castillo al nivel 6.", condition: { type: "buildingLevel", buildingType: "castillo", value: 6 }, reward: { resources: { stone: 800 }, honor: 15 } },
        { id: "s4_ejercito", title: "Hueste real", description: "Mantén 300 tropas activas.", condition: { type: "armySize", value: 300 }, reward: { resources: { iron: 300, food: 500 }, honor: 15 } },
        { id: "s4_victorias", title: "Cinco laureles", description: "Gana 5 batallas.", condition: { type: "lifetime", counter: "battlesWon", value: 5 }, reward: { resources: { gold: 400 }, honor: 20, glory: 10 } },
        { id: "s4_aplastante", title: "Sin cuartel", description: "Logra una victoria aplastante.", condition: { type: "lifetime", counter: "crushingVictories", value: 1 }, reward: { honor: 20, glory: 10 } },
        { id: "s4_territorio", title: "Nuevas tierras", description: "Reclama un territorio libre.", condition: { type: "lifetime", counter: "territoriesClaimed", value: 1 }, reward: { resources: { gold: 300, wood: 300 }, honor: 15 } },
        { id: "s4_hospital", title: "Cuidar a los nuestros", description: "Construye el Hospital militar.", condition: { type: "buildingLevel", buildingType: "hospitalMilitar", value: 1 }, reward: { resources: { gold: 200 }, honor: 10 } },
      ],
      reward: { resources: { gold: 1000, wood: 800, stone: 800, iron: 500, food: 1000 }, honor: 50, glory: 25, troops: { unitType: "caballeria" as UnitType, level: 2, count: 30 }, productionBonus: { multiplier: 1.1, days: 1 } },
    },
  ] as readonly MissionStage[],

  /** Diarias: mismo conjunto para todos, elegido de forma determinista por fecha; se renuevan cada día. */
  DAILY: {
    /** [DERIVADO, pendiente de aprobación] Reinicio diario a las 00:00 UTC. */
    RESET_UTC_HOUR: 0,
    PER_DAY: 3,
    CATALOG: [
      { id: "d_obra", title: "Manos a la obra", description: "Termina 1 obra hoy.", condition: { type: "daily", counter: "buildingsCompleted", value: 1 }, reward: { resources: { wood: 100, stone: 100 }, honor: 2 } },
      { id: "d_tropas", title: "Instrucción diaria", description: "Entrena 20 tropas hoy.", condition: { type: "daily", counter: "troopsTrained", value: 20 }, reward: { resources: { food: 150 }, honor: 2 } },
      { id: "d_investigar", title: "Hora de estudio", description: "Inicia 1 investigación hoy.", condition: { type: "daily", counter: "researchStarted", value: 1 }, reward: { resources: { gold: 60 }, honor: 2 } },
      { id: "d_bonus", title: "Tributo diario", description: "Reclama el bonus diario.", condition: { type: "daily", counter: "dailyBonusClaimed", value: 1 }, reward: { resources: { gold: 40 }, honor: 2 } },
      { id: "d_explorar", title: "Ojos en el horizonte", description: "Completa 1 expedición de exploración hoy.", condition: { type: "daily", counter: "explorationsCompleted", value: 1 }, reward: { resources: { food: 100, gold: 40 }, honor: 2 } },
      { id: "d_batalla", title: "Al campo de batalla", description: "Libra 1 batalla hoy.", condition: { type: "daily", counter: "battlesFought", value: 1 }, reward: { resources: { gold: 80 }, honor: 3 } },
    ] as readonly MissionDefinition[],
  },

  /** Secretas generales: condiciones ocultas hasta cumplirse. */
  SECRET: [
    { id: "x_felicidad", title: "Reino feliz", description: "Alcanzar 90 de felicidad.", condition: { type: "happiness", value: 90 }, reward: { resources: { food: 400 }, honor: 15, glory: 5 } },
    { id: "x_tesoro", title: "Arcas rebosantes", description: "Acumular 5.000 de oro.", condition: { type: "resourceStock", resource: "gold", value: 5000 }, reward: { honor: 15, glory: 5 } },
    { id: "x_honor", title: "Nombre respetado", description: "Alcanzar 100 de honor.", condition: { type: "honor", value: 100 }, reward: { resources: { gold: 300 }, glory: 10 } },
    { id: "x_exploradores", title: "Cartógrafos", description: "Completar 5 expediciones.", condition: { type: "lifetime", counter: "explorationsCompleted", value: 5 }, reward: { resources: { gold: 200, food: 200 }, honor: 10 } },
  ] as readonly MissionDefinition[],

  /**
   * Secretas por civilización: una por civilización (mismo número), misma estructura de premio
   * [DERIVADO]: completar la tecnología única de la civilización.
   */
  SECRET_PER_CIVILIZATION_REWARD: { resources: { gold: 300, wood: 200, stone: 200, iron: 100, food: 300 }, honor: 20, glory: 10 } as MissionReward,
  SECRET_PER_CIVILIZATION_TITLES: {
    ingleses: "Herederos de Agincourt",
    romanos: "Senatus Populusque",
    griegos: "Luz de la Academia",
    vikingos: "Saga de los mares",
    bizantinos: "Púrpura imperial",
    arabes: "Sabios del califato",
    mongoles: "Jinetes de la estepa",
    chinos: "Mandato del Cielo",
    japoneses: "Camino del guerrero",
    navajos: "Senderos sagrados",
    aztecas: "Sol de Tenochtitlan",
    masais: "Guardianes de la sabana",
  } as Readonly<Record<string, string>>,
} as const;

// ============================================================================
// 5b. CUENTA DEL JUGADOR (P4, P5, sección 5 y 21 de CLAUDE.md)
// ============================================================================
/**
 * Inicio de sesión por nombre de gobernante + contraseña, sin correo.
 * El nombre de gobernante es único sin distinguir mayúsculas ni acentos
 * [DECISIÓN 21-10-2026]. La contraseña nunca se almacena en texto plano (P5):
 * la guarda Convex Auth con hash scrypt.
 */
export const ACCOUNT = {
  /** [DECISIÓN 21-10-2026] Longitud del nombre de gobernante. */
  RULER_NAME_MIN_LENGTH: 2,
  RULER_NAME_MAX_LENGTH: 40,
  /**
   * [DERIVADO] Caracteres permitidos en el nombre de gobernante: letras (con
   * acentos y ñ), dígitos, espacio, apóstrofo, punto y guion. Sin dos
   * separadores seguidos ni separadores en los extremos.
   */
  RULER_NAME_PATTERN: /^[\p{L}\p{N}]+(?:[ '.\-][\p{L}\p{N}]+)*$/u,
  /** [DECISIÓN 21-10-2026] Contraseña de mínimo 8 caracteres. */
  PASSWORD_MIN_LENGTH: 8,
  /** [DERIVADO] Límite superior defensivo para el hash de contraseña. */
  PASSWORD_MAX_LENGTH: 128,
  /** [DERIVADO] Intentos de inicio de sesión fallidos por hora y cuenta antes de rechazar (valor por defecto de Convex Auth; se recarga con el tiempo). */
  SIGN_IN_MAX_FAILED_ATTEMPTS_PER_HOUR: 10,
  /** [DERIVADO] Dominio sintético interno: Convex Auth identifica la cuenta por correo, que nunca se envía. */
  SYNTHETIC_EMAIL_DOMAIN: "la-conquista.local",
  /**
   * Código de recuperación [DECISIÓN 21-10-2026: se muestra una sola vez al
   * crear la cuenta; sin correo]. Formato [DERIVADO, pendiente de aprobación]:
   * 16 símbolos en 4 grupos (XXXX-XXXX-XXXX-XXXX) de un alfabeto sin
   * caracteres ambiguos (sin 0/O ni 1/I/L): 31 símbolos → ~79 bits de entropía. Se guarda solo
   * su hash SHA-256; es de un solo uso y al usarlo se entrega otro nuevo.
   */
  RECOVERY_CODE: {
    ALPHABET: "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
    LENGTH: 16,
    GROUP_SIZE: 4,
    SEPARATOR: "-",
    /** [DERIVADO] Intentos fallidos seguidos antes de bloquear la recuperación. */
    MAX_FAILED_ATTEMPTS: 5,
    /** [DERIVADO] Duración del bloqueo tras agotar los intentos. */
    LOCK_MS: 15 * 60 * 1000,
  },
} as const;

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
  { id: "tech_civ_navajos", name: "Rastreadores del bosque", branch: "civilizacion", universityLevel: 2, costs: { gold: 150, wood: 250, stone: 100, iron: 30, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { universidad: 2 }, technologyRequirements: [], civilizationRequirement: "navajos", effect: { key: "marchFatigue", value: 0.20, description: "−20 % fatiga de marcha por sendas y bosques" } },
  { id: "tech_civ_aztecas", name: "Chinampas y sacerdotes guerreros", branch: "civilizacion", universityLevel: 2, costs: { gold: 200, wood: 200, stone: 150, iron: 30, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { universidad: 2 }, technologyRequirements: [], civilizationRequirement: "aztecas", effect: { key: "agricultureProduction", value: 0.08, description: "+8 % producción agrícola en huertos intensivos" } },
  { id: "tech_civ_masais", name: "Resistencia masái y sabana", branch: "civilizacion", universityLevel: 2, costs: { gold: 160, wood: 180, stone: 100, iron: 40, food: 0 }, durationSeconds: 2 * DAY, buildingRequirements: { universidad: 2 }, technologyRequirements: [], civilizationRequirement: "masais", effect: { key: "marchFatigue", value: 0.25, description: "−25 % fatiga en expediciones de larga distancia" } },
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
  /** [DECISIÓN 21-10-2026] Debilidad: sobrecoste de instrucción por tipo de unidad (1,15 = +15 %). */
  trainingCostByUnit?: Partial<Record<UnitType, number>>;
  combatAttackMultiplier: number;
  combatDefenseMultiplier: number;
  happinessBonus: number;
  /** [DECISIÓN 21-10-2026] Texto de la debilidad de la civilización (null = pendiente de diseño). */
  weakness?: string | null;
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
      trainingCostByUnit: { caballeria: 1.15 },
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
      weakness: "Caballería pesada más cara: +15 % de coste de instrucción de caballería (dossier histórico).",
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
      trainingDurationByUnit: { caballeria: 1.1 },
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
      weakness: "Caballería menos especializada: +10 % de duración de instrucción de caballería (dossier histórico).",
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
      trainingCostByUnit: { caballeria: 1.1 },
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 5,
      weakness: "Ciudades-estado con poca caballería: +10 % de coste de instrucción de caballería [DERIVADO].",
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
      trainingDurationByUnit: { asedio: 1.15 },
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
      weakness: "Peores en asedios largos: +15 % de duración de instrucción de asedio (dossier histórico).",
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
      trainingCostByUnit: { caballeria: 1.15 },
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.05,
      happinessBonus: 0,
      weakness: "Élites caras: +15 % de coste de instrucción de caballería (catafractos; dossier histórico).",
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
      trainingDurationByUnit: { infanteria: 1.1 },
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
      weakness: "Infantería pesada poco habitual: +10 % de duración de instrucción de infantería [DERIVADO].",
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
      combatDefenseMultiplier: 0.95,
      happinessBonus: 0,
      weakness: "Débiles en defensa urbana fija: −5 % de fuerza defensiva en combate (dossier histórico).",
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
      trainingCostByUnit: { caballeria: 1.1 },
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
      weakness: "Caballería dependiente de la estepa: +10 % de coste de instrucción de caballería [DERIVADO].",
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
      trainingDurationByUnit: { asedio: 1.1 },
      combatAttackMultiplier: 1.05,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 0,
      weakness: "Asedio poco desarrollado en el periodo Sengoku: +10 % de duración de instrucción de asedio [DERIVADO].",
    },
    uniqueTechnologyId: "tech_civ_japoneses",
  },
  {
    // [DECISIÓN 21-10-2026] «Indios americanos» pasa a Navajos. Pasiva anterior conservada hasta su rediseño.
    id: "navajos",
    label: "Navajos",
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
      weakness: "Dependencia de movilidad ligera: +10 % de duración de instrucción de asedio [DERIVADO].",
    },
    uniqueTechnologyId: "tech_civ_navajos",
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
      trainingDurationByUnit: { caballeria: 1.15 },
      combatAttackMultiplier: 1.0,
      combatDefenseMultiplier: 1.0,
      happinessBonus: 4,
      weakness: "Sin caballos: la plaza de caballería la ocupa la élite a pie (Guerreros Jaguar), +15 % de duración de instrucción (dossier histórico).",
    },
    uniqueTechnologyId: "tech_civ_aztecas",
  },
  {
    // [DECISIÓN 21-10-2026] «Keniatas» pasa a Masáis. Pasiva anterior conservada hasta su rediseño.
    id: "masais",
    label: "Masáis",
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
      weakness: "Defensa fija limitada: −5 % de fuerza defensiva en combate [DERIVADO].",
    },
    uniqueTechnologyId: "tech_civ_masais",
  },
] as const;


/**
 * [DECISIÓN 21-10-2026] Singularidades por civilización: nombres de armas y armaduras por nivel de
 * calidad, edificio único (variante con nombre propio de un edificio base) y tropa característica.
 * Solo cambian nombre y estética: los multiplicadores de P29–P31 son iguales para todas (P6).
 * Cronologías del dossier histórico (propuesta): Ingleses XI–XV · Romanos alto Imperio · Griegos
 * clásicos · Vikingos VIII–XI · Bizantinos periodo medio · Árabes califatos · Mongoles XIII–XIV ·
 * Chinos Song · Japoneses Sengoku · Aztecas XIV–XVI. Sin mezclar épocas ni materiales (los aztecas
 * no tienen acero ni caballos; los vikingos no llevan cuernos). Navajos y Masáis: pendientes de
 * documentar antes de implementar (no se inventan).
 */
export interface CivilizationIdentity {
  weapons: Record<WeaponTier, string>;
  armors: Record<ArmorTier, string>;
  uniqueBuilding: { buildingType: string; name: string; description: string };
  signatureUnit: { unitType: UnitType; name: string; description: string };
  /** Nombres de las cuatro plazas de tropa (solo estética). */
  unitNames: Partial<Record<UnitType, string>>;
}
export const CIVILIZATION_IDENTITIES: Readonly<Record<string, CivilizationIdentity | null>> = {
  ingleses: {
    weapons: { palo: "Bastón de fresno", lanzaBasica: "Lanza de leva", espadaHierro: "Espada de armas", acero: "Arco largo y espada de acero", aceroAvanzado: "Arco largo de tejo y acero templado" },
    armors: { ninguna: "Sin armadura", piel: "Gambesón", cueroReforzado: "Brigantina de cuero", hierro: "Cota de malla", acero: "Arnés de placas" },
    uniqueBuilding: { buildingType: "cuartel", name: "Campo de Tiro", description: "Cuartel inglés donde se instruye a los arqueros de arco largo." },
    signatureUnit: { unitType: "arqueria", name: "Arquero de arco largo", description: "Arquería de tiro largo y disciplina de campaña." },
    unitNames: { infanteria: "Hombre de armas", arqueria: "Arquero de arco largo", caballeria: "Caballero", asedio: "Trabuquete" },
  },
  romanos: {
    weapons: { palo: "Fustis", lanzaBasica: "Hasta", espadaHierro: "Gladius hispaniensis", acero: "Gladius y pilum de acero", aceroAvanzado: "Spatha de acero" },
    armors: { ninguna: "Sin armadura", piel: "Túnica reforzada", cueroReforzado: "Lorica hamata ligera", hierro: "Lorica segmentata", acero: "Lorica segmentata de acero" },
    uniqueBuilding: { buildingType: "cuartel", name: "Castra", description: "Campamento legionario: Cuartel romano de disciplina férrea." },
    signatureUnit: { unitType: "infanteria", name: "Legionario", description: "Infantería pesada de formación cerrada con scutum." },
    unitNames: { infanteria: "Legionario", arqueria: "Sagittarius", caballeria: "Eques", asedio: "Onagro" },
  },
  griegos: {
    weapons: { palo: "Vara de olivo", lanzaBasica: "Dory", espadaHierro: "Xiphos de hierro", acero: "Dory y xiphos de acero", aceroAvanzado: "Panoplia hoplita de acero" },
    armors: { ninguna: "Sin armadura", piel: "Linothorax", cueroReforzado: "Coraza de cuero y hoplon", hierro: "Coraza de bronce y hoplon", acero: "Coraza musculada y hoplon" },
    uniqueBuilding: { buildingType: "universidad", name: "Liceo", description: "Universidad griega: escuela de filosofía y ciencia." },
    signatureUnit: { unitType: "infanteria", name: "Hoplita", description: "Infantería cívica de falange con lanza y escudo redondo." },
    unitNames: { infanteria: "Hoplita", arqueria: "Peltasta", caballeria: "Hippeis", asedio: "Oxybeles" },
  },
  vikingos: {
    weapons: { palo: "Garrote", lanzaBasica: "Lanza nórdica", espadaHierro: "Hacha danesa de hierro", acero: "Hacha y espada de acero", aceroAvanzado: "Hacha danesa de acero pautado" },
    armors: { ninguna: "Sin armadura", piel: "Pieles y casco de hierro", cueroReforzado: "Cuero reforzado y escudo redondo", hierro: "Brynja (cota de malla)", acero: "Brynja de acero y casco" },
    uniqueBuilding: { buildingType: "taberna", name: "Salón Largo", description: "Taberna vikinga: hogar comunal donde se reclutan guerreros a sueldo." },
    signatureUnit: { unitType: "infanteria", name: "Huscarl", description: "Guardia de élite con hacha, lanza y escudo redondo; cascos sin cuernos." },
    unitNames: { infanteria: "Huscarl", arqueria: "Arquero del fiordo", caballeria: "Jinete del norte", asedio: "Ariete" },
  },
  bizantinos: {
    weapons: { palo: "Vara", lanzaBasica: "Kontarion", espadaHierro: "Spathion de hierro", acero: "Spathion y kontos de acero", aceroAvanzado: "Paramerion de acero" },
    armors: { ninguna: "Sin armadura", piel: "Kavadion acolchado", cueroReforzado: "Lorikion de cuero", hierro: "Klivanion lamelar", acero: "Klivanion de acero" },
    uniqueBuilding: { buildingType: "circo", name: "Hipódromo", description: "Circo bizantino: carreras y facciones que animan a la ciudad." },
    signatureUnit: { unitType: "caballeria", name: "Catafracto", description: "Caballería acorazada de carga con kontos." },
    unitNames: { infanteria: "Skutatos", arqueria: "Toxotes", caballeria: "Catafracto", asedio: "Helépolis" },
  },
  arabes: {
    weapons: { palo: "Bastón", lanzaBasica: "Lanza beduina", espadaHierro: "Sayf de hierro", acero: "Sayf y arco compuesto de acero", aceroAvanzado: "Sayf damasquino" },
    armors: { ninguna: "Sin armadura", piel: "Túnica acolchada", cueroReforzado: "Cuero endurecido", hierro: "Dir' (cota de malla)", acero: "Coraza lamelar de acero" },
    uniqueBuilding: { buildingType: "mercado", name: "Caravasar", description: "Mercado árabe: posada de caravanas y comercio de larga distancia." },
    signatureUnit: { unitType: "caballeria", name: "Jinete ligero", description: "Arquero a caballo rápido con arco compuesto." },
    unitNames: { infanteria: "Lancero del califato", arqueria: "Arquero árabe", caballeria: "Jinete ligero", asedio: "Manjaniq" },
  },
  mongoles: {
    weapons: { palo: "Vara de estepa", lanzaBasica: "Lanza ligera", espadaHierro: "Sable de hierro", acero: "Arco compuesto y sable de acero", aceroAvanzado: "Arco compuesto reforzado y sable de acero" },
    armors: { ninguna: "Sin armadura", piel: "Deel acolchado", cueroReforzado: "Cuero lacado", hierro: "Lamelar de hierro", acero: "Lamelar de acero" },
    uniqueBuilding: { buildingType: "viviendas", name: "Ger del Kan", description: "Viviendas mongolas: campamento de tiendas en torno al kan." },
    signatureUnit: { unitType: "caballeria", name: "Jinete arquero", description: "Caballería ligera de arco compuesto y movilidad extrema." },
    unitNames: { infanteria: "Guardia de la horda", arqueria: "Arquero de la estepa", caballeria: "Jinete arquero", asedio: "Trabuquete de contrapeso" },
  },
  chinos: {
    weapons: { palo: "Bastón", lanzaBasica: "Qiang", espadaHierro: "Jian de hierro", acero: "Jian y ballesta de acero", aceroAvanzado: "Jian de acero y ballesta pesada" },
    armors: { ninguna: "Sin armadura", piel: "Túnica acolchada", cueroReforzado: "Cuero laminado", hierro: "Laminada de hierro", acero: "Laminada de acero (shanwenjia)" },
    uniqueBuilding: { buildingType: "granja", name: "Arrozal Imperial", description: "Granja china: arrozales en terrazas de la dinastía Song." },
    signatureUnit: { unitType: "arqueria", name: "Ballestero", description: "Tiradores de ballesta de la burocracia militar Song." },
    unitNames: { infanteria: "Lancero Song", arqueria: "Ballestero", caballeria: "Jinete Song", asedio: "Catapulta de tracción" },
  },
  japoneses: {
    weapons: { palo: "Bō de roble", lanzaBasica: "Yari", espadaHierro: "Katana de hierro", acero: "Katana, yari y yumi de acero", aceroAvanzado: "Katana de acero plegado (tamahagane)" },
    armors: { ninguna: "Sin armadura", piel: "Haramaki acolchado", cueroReforzado: "Dō-maru de cuero", hierro: "Dō-maru lamelar", acero: "Gusoku de acero" },
    uniqueBuilding: { buildingType: "herreria", name: "Herrería del Maestro Forjador", description: "Herrería japonesa: forja de acero plegado." },
    signatureUnit: { unitType: "infanteria", name: "Samurái", description: "Guerrero de élite; la lanza y el arco cuentan tanto como la katana." },
    unitNames: { infanteria: "Samurái", arqueria: "Ashigaru arquero", caballeria: "Samurái a caballo", asedio: "Ōzutsu" },
  },
  navajos: {
    weapons: { palo: "Vara de madera", lanzaBasica: "Lanza de obsidiana", espadaHierro: "Hacha de hierro", acero: "Maza de acero", aceroAvanzado: "Maza de acero reforzado" },
    armors: { ninguna: "Sin armadura", piel: "Túnica de piel", cueroReforzado: "Cuero de bisonte", hierro: "Cota de malla ligera", acero: "Brigantina de acero" },
    uniqueBuilding: { buildingType: "taberna", name: "Hogar de rastreadores", description: "Taberna navaja: lugar de descanso para exploradores." },
    signatureUnit: { unitType: "infanteria", name: "Rastreador", description: "Infantería ligera especialista en terreno boscoso." },
    unitNames: { infanteria: "Rastreador", arqueria: "Arquero Navajo", caballeria: "Jinete explorador", asedio: "Catapulta ligera" },
  },
  aztecas: {
    weapons: { palo: "Bastón de guerra", lanzaBasica: "Tepoztopilli", espadaHierro: "Macuahuitl de obsidiana", acero: "Macuahuitl y átlatl", aceroAvanzado: "Macuahuitl de obsidiana reforzado" },
    armors: { ninguna: "Sin armadura", piel: "Ichcahuipilli ligero", cueroReforzado: "Ichcahuipilli reforzado", hierro: "Tlahuiztli y chimalli", acero: "Tlahuiztli de águila" },
    uniqueBuilding: { buildingType: "iglesia", name: "Templo Mayor", description: "Iglesia mexica: gran templo escalonado de Tenochtitlan." },
    signatureUnit: { unitType: "infanteria", name: "Guerrero Águila", description: "Infantería de élite; sin caballos ni acero europeo." },
    unitNames: { infanteria: "Guerrero Águila", arqueria: "Hondero y atlatl", caballeria: "Guerrero Jaguar (élite a pie)", asedio: "Cuadrilla de asalto" },
  },
  masais: {
    weapons: { palo: "Bastón masái", lanzaBasica: "Lanza masái", espadaHierro: "Seme (espada corta)", acero: "Seme de acero", aceroAvanzado: "Seme de acero forjado" },
    armors: { ninguna: "Sin armadura", piel: "Pieles tradicionales", cueroReforzado: "Cuero endurecido", hierro: "Cota de malla ligera", acero: "Protección de acero masái" },
    uniqueBuilding: { buildingType: "viviendas", name: "Boma", description: "Viviendas masáis: recinto fortificado para el ganado y la familia." },
    signatureUnit: { unitType: "infanteria", name: "Guerrero de la sabana", description: "Infantería con gran resistencia a la fatiga." },
    unitNames: { infanteria: "Guerrero de la sabana", arqueria: "Arquero masái", caballeria: "Jinete de la sabana", asedio: "Ariete ligero" },
  },
};
export type CivilizationId = (typeof CIVILIZATIONS)[number]["id"];
/** [DECISIÓN 21-10-2026] Identificadores antiguos aún presentes en reinos y progreso guardados. */
export const LEGACY_CIVILIZATION_IDS: Readonly<Record<string, string>> = {
  indiosAmericanos: "navajos",
  indios_americanos: "navajos",
  keniatas: "masais",
};
export const LEGACY_TECHNOLOGY_IDS: Readonly<Record<string, string>> = {
  tech_civ_indiosAmericanos: "tech_civ_navajos",
  tech_civ_keniatas: "tech_civ_masais",
};

export const CIVILIZATION_BONUSES_ENABLED = true;
export const CIVILIZATION_IMMUTABLE = true;
