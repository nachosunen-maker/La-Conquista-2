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

export const RESOURCE_NAMES_SPANISH: Record<ResourceType, string> = {
  gold: "oro",
  wood: "madera",
  stone: "piedra",
  iron: "hierro",
  food: "alimentos",
};

export function resourceNameSpanish(resourceKey: string): string {
  return (RESOURCE_NAMES_SPANISH as Record<string, string>)[resourceKey] ?? resourceKey;
}

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
  agriculture: 6.0, // Multiplicador ×3 (anterior 2.0)
  wood: 3.0,        // Multiplicador ×3 (anterior 1.0)
  stone: 2.25,      // Multiplicador ×3 (anterior 0.75)
  iron: 1.2,        // Multiplicador ×3 (anterior 0.4)
  gold: 0.4,        // Multiplicador ×2 (anterior 0.2)
} as const;
export type ProductiveJob = keyof typeof PRODUCTION_PER_WORKER_PER_DAY;

/**
 * [BALANCE BETA APROBADO 2026-10-29] Multiplicadores de producción por recurso.
 * - Alimentos: 1.00 (sin incremento)
 * - Madera: 3.00
 * - Piedra: 2.00
 * - Hierro: 3.00
 * - Oro procedente de minería: 1.00 (sin incremento)
 */
export const RESOURCE_PRODUCTION_MULTIPLIERS: Record<ProductiveJob, number> = {
  agriculture: 1.00,
  wood: 3.00,
  stone: 2.00,
  iron: 3.00,
  gold: 1.00,
};

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
  castillo: { label: "Castillo", baseCosts: { gold: 500, wood: 800, stone: 800, iron: 100, food: 0 }, baseDurationSeconds: 180, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 0, jobType: null, requirements: {}, role: "Desbloqueos y administración" },
  viviendas: { label: "Viviendas", baseCosts: { gold: 40, wood: 100, stone: 20, iron: 0, food: 0 }, baseDurationSeconds: 5, residentialCapacityPerLevel: 100, workerCapacityPerLevel: 0, jobType: null, requirements: { castillo: 1 }, role: "Capacidad residencial" },
  granja: { label: "Granja", baseCosts: { gold: 30, wood: 80, stone: 20, iron: 0, food: 0 }, baseDurationSeconds: 10, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 100, jobType: "agriculture", requirements: { castillo: 1 }, role: "Agricultura" },
  aserradero: { label: "Aserradero", baseCosts: { gold: 40, wood: 100, stone: 30, iron: 0, food: 0 }, baseDurationSeconds: 10, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 80, jobType: "wood", requirements: { castillo: 1 }, role: "Madera" },
  cantera: { label: "Cantera", baseCosts: { gold: 50, wood: 80, stone: 80, iron: 0, food: 0 }, baseDurationSeconds: 15, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 80, jobType: "stone", requirements: { castillo: 1 }, role: "Piedra" },
  minaHierro: { label: "Mina de hierro", baseCosts: { gold: 60, wood: 100, stone: 80, iron: 20, food: 0 }, baseDurationSeconds: 20, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 60, jobType: "iron", requirements: { cantera: 1 }, role: "Hierro" },
  minaOro: { label: "Mina de oro", baseCosts: { gold: 100, wood: 100, stone: 100, iron: 0, food: 0 }, baseDurationSeconds: 20, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 50, jobType: "gold", requirements: { castillo: 2 }, role: "Oro" },
  cuartel: { label: "Cuartel/Barracones", baseCosts: { gold: 100, wood: 150, stone: 100, iron: 20, food: 0 }, baseDurationSeconds: 30, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 0, jobType: null, requirements: { castillo: 1 }, role: "Reclutamiento y entrenamiento" },
  herreria: { label: "Herrería/Forja", baseCosts: { gold: 100, wood: 120, stone: 100, iron: 80, food: 0 }, baseDurationSeconds: 45, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 50, jobType: null, requirements: { cuartel: 1, minaHierro: 1 }, role: "Armas y armaduras" },
  universidad: { label: "Universidad", baseCosts: { gold: 150, wood: 100, stone: 150, iron: 20, food: 0 }, baseDurationSeconds: 45, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 0, jobType: null, requirements: { castillo: 2 }, role: "Investigación y tecnologías" },
  murallas: { label: "Murallas", baseCosts: { gold: 100, wood: 100, stone: 300, iron: 20, food: 0 }, baseDurationSeconds: 90, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 0, jobType: null, requirements: { castillo: 2 }, role: "Defensa del reino" },
  mercado: { label: "Mercado", baseCosts: { gold: 100, wood: 150, stone: 100, iron: 0, food: 0 }, baseDurationSeconds: 45, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 30, jobType: null, requirements: { castillo: 2 }, role: "Intercambio y eficiencia económica" },
  parlamento: { label: "Parlamento", baseCosts: { gold: 200, wood: 100, stone: 200, iron: 20, food: 0 }, baseDurationSeconds: 60, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 0, jobType: null, requirements: { castillo: 2 }, role: "Desafíos y diplomacia" },
  hospitalMilitar: { label: "Hospital militar", baseCosts: { gold: 100, wood: 100, stone: 150, iron: 30, food: 0 }, baseDurationSeconds: 90, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 50, jobType: null, requirements: { castillo: 2 }, role: "Recuperación de heridos", professionJob: "medicine" },
  taberna: { label: "Taberna", baseCosts: { gold: 50, wood: 100, stone: 40, iron: 0, food: 0 }, baseDurationSeconds: 30, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 30, jobType: null, requirements: { castillo: 1 }, role: "Contratación de mercenarios" },
  panaderia: { label: "Panadería", baseCosts: { gold: 40, wood: 100, stone: 30, iron: 0, food: 0 }, baseDurationSeconds: 30, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 40, jobType: null, requirements: { castillo: 1 }, role: "Apoyo a la alimentación", professionJob: "bakery" },
  iglesia: { label: "Iglesia", baseCosts: { gold: 60, wood: 100, stone: 80, iron: 0, food: 0 }, baseDurationSeconds: 45, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 40, jobType: null, requirements: { castillo: 1 }, role: "Religión y moral", professionJob: "religion" },
  circo: { label: "Circo/Feria", baseCosts: { gold: 60, wood: 120, stone: 60, iron: 0, food: 0 }, baseDurationSeconds: 90, residentialCapacityPerLevel: 0, workerCapacityPerLevel: 40, jobType: null, requirements: { castillo: 1 }, role: "Felicidad", professionJob: "entertainment" },
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
  /**
   * [BALANCE BETA APROBADO 2026-10-29] Multiplicador global de duración de construcción.
   * Con los nuevos tiempos base ya calibrados en segundos reales, el multiplicador es 1.00 (sin reducción temporal).
   */
  GLOBAL_DURATION_MULTIPLIER: 1.00,
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
export type UnitType =
  | "infanteria"
  | "arqueria"
  | "caballeria"
  | "asedio"
  | "onagro_campana"
  | "carrobalista"
  | "espringarda_movil"
  | "trabuchet_traccion"
  | "arcuballista"
  | "fustibalo_campo"
  | "mangonel_tactico"
  | "carros_artillados"
  | "ariete_movil"
  | "torres_asalto";

export const UNIT_TYPES: readonly UnitType[] = [
  "infanteria",
  "arqueria",
  "caballeria",
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
  infanteria: { label: "Infantería", costs: { gold: 5, wood: 0, stone: 0, iron: 2, food: 2 }, trainingSecondsPerUnit: 10, populationPerUnit: 1, isLivingTroop: true, requirements: { cuartel: 1 }, attack: 1.0, defense: 1.2, speed: 1.0, marchMultiplier: 1.0 },
  arqueria: { label: "Arquería", costs: { gold: 6, wood: 2, stone: 0, iron: 2, food: 2 }, trainingSecondsPerUnit: 15, populationPerUnit: 1, isLivingTroop: true, requirements: { cuartel: 1 }, attack: 1.2, defense: 0.7, speed: 0.9, marchMultiplier: 1.0 },
  caballeria: { label: "Caballería", costs: { gold: 15, wood: 2, stone: 0, iron: 5, food: 4 }, trainingSecondsPerUnit: 30, populationPerUnit: 1, isLivingTroop: true, requirements: { cuartel: 2, herreria: 1 }, attack: 1.4, defense: 1.0, speed: 1.3, marchMultiplier: 1.2 },
  asedio: { label: "Asedio genérico", costs: { gold: 30, wood: 20, stone: 20, iron: 10, food: 0 }, trainingSecondsPerUnit: 60, populationPerUnit: 5, isLivingTroop: false, requirements: { cuartel: 3, herreria: 2 }, attack: 1.8, defense: 0.5, speed: 0.6, marchMultiplier: 1.5 },
  onagro_campana: { label: "Onagro de campaña", costs: { gold: 30, wood: 20, stone: 20, iron: 10, food: 0 }, trainingSecondsPerUnit: 60, populationPerUnit: 5, isLivingTroop: false, requirements: { cuartel: 3, herreria: 2 }, attack: 2.52, defense: 0.40, speed: 0.24, marchMultiplier: 3.75 },
  carrobalista: { label: "Carrobalista", costs: { gold: 30, wood: 20, stone: 20, iron: 10, food: 0 }, trainingSecondsPerUnit: 60, populationPerUnit: 5, isLivingTroop: false, requirements: { cuartel: 3, herreria: 2 }, attack: 2.34, defense: 0.40, speed: 0.39, marchMultiplier: 2.31 },
  espringarda_movil: { label: "Espringarda móvil", costs: { gold: 30, wood: 20, stone: 20, iron: 10, food: 0 }, trainingSecondsPerUnit: 60, populationPerUnit: 5, isLivingTroop: false, requirements: { cuartel: 3, herreria: 2 }, attack: 2.16, defense: 0.35, speed: 0.45, marchMultiplier: 2.00 },
  trabuchet_traccion: { label: "Trabuchet de tracción", costs: { gold: 30, wood: 20, stone: 20, iron: 10, food: 0 }, trainingSecondsPerUnit: 75, populationPerUnit: 5, isLivingTroop: false, requirements: { cuartel: 3, herreria: 2 }, attack: 2.16, defense: 0.35, speed: 0.36, marchMultiplier: 2.50 },
  arcuballista: { label: "Arcuballista / manuballista", costs: { gold: 30, wood: 20, stone: 20, iron: 10, food: 0 }, trainingSecondsPerUnit: 60, populationPerUnit: 5, isLivingTroop: false, requirements: { cuartel: 3, herreria: 2 }, attack: 1.98, defense: 0.30, speed: 0.48, marchMultiplier: 1.88 },
  fustibalo_campo: { label: "Fustíbalo de campo", costs: { gold: 30, wood: 20, stone: 20, iron: 10, food: 0 }, trainingSecondsPerUnit: 60, populationPerUnit: 5, isLivingTroop: false, requirements: { cuartel: 3, herreria: 2 }, attack: 0.90, defense: 0.25, speed: 0.66, marchMultiplier: 1.36 },
  mangonel_tactico: { label: "Mangonel de ruedas táctico", costs: { gold: 30, wood: 20, stone: 20, iron: 10, food: 0 }, trainingSecondsPerUnit: 75, populationPerUnit: 5, isLivingTroop: false, requirements: { cuartel: 3, herreria: 2 }, attack: 2.34, defense: 0.35, speed: 0.33, marchMultiplier: 2.73 },
  carros_artillados: { label: "Carros de combate artillados", costs: { gold: 30, wood: 20, stone: 20, iron: 10, food: 0 }, trainingSecondsPerUnit: 75, populationPerUnit: 5, isLivingTroop: false, requirements: { cuartel: 3, herreria: 2 }, attack: 0.90, defense: 0.75, speed: 0.24, marchMultiplier: 3.75 },
  ariete_movil: { label: "Ariete móvil de campo", costs: { gold: 30, wood: 20, stone: 20, iron: 10, food: 0 }, trainingSecondsPerUnit: 60, populationPerUnit: 5, isLivingTroop: false, requirements: { cuartel: 3, herreria: 2 }, attack: 1.44, defense: 0.50, speed: 0.30, marchMultiplier: 3.00 },
  torres_asalto: { label: "Torres de asalto ligeras", costs: { gold: 30, wood: 20, stone: 20, iron: 10, food: 0 }, trainingSecondsPerUnit: 90, populationPerUnit: 5, isLivingTroop: false, requirements: { cuartel: 3, herreria: 2 }, attack: 1.08, defense: 0.55, speed: 0.15, marchMultiplier: 6.00 },
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

/** [MAESTRA P29 + P23] Niveles militares globales: multiplicador de daño, consumo de alimentos y requisitos. */
export interface MilitaryLevelBalance {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  multiplier: number; // Multiplicador de daño
  foodMultiplier: number; // Multiplicador de consumo de alimentos
  requirements: Readonly<Record<string, number>>;
  costs: ResourceCosts;
  upgradeDurationSeconds: number;
}
export const MILITARY_LEVELS: readonly MilitaryLevelBalance[] = [
  { level: 1, name: "Milicia", multiplier: 1.00, foodMultiplier: 1.00, requirements: { cuartel: 1 }, costs: { gold: 0, wood: 0, stone: 0, iron: 0, food: 0 }, upgradeDurationSeconds: 0 },
  { level: 2, name: "Entrenado", multiplier: 1.10, foodMultiplier: 1.10, requirements: { castillo: 2, cuartel: 2, herreria: 1 }, costs: { gold: 200, wood: 100, stone: 100, iron: 100, food: 200 }, upgradeDurationSeconds: 60 },
  { level: 3, name: "Veterano", multiplier: 1.20, foodMultiplier: 1.20, requirements: { castillo: 3, cuartel: 3, herreria: 2, universidad: 1 }, costs: { gold: 500, wood: 250, stone: 250, iron: 250, food: 500 }, upgradeDurationSeconds: 120 },
  { level: 4, name: "Profesional", multiplier: 1.30, foodMultiplier: 1.30, requirements: { castillo: 4, cuartel: 4, herreria: 3, universidad: 2 }, costs: { gold: 1200, wood: 600, stone: 600, iron: 600, food: 1200 }, upgradeDurationSeconds: 300 },
  { level: 5, name: "Élite", multiplier: 1.40, foodMultiplier: 1.40, requirements: { castillo: 5, cuartel: 5, herreria: 4, universidad: 3 }, costs: { gold: 2500, wood: 1200, stone: 1200, iron: 1200, food: 2500 }, upgradeDurationSeconds: 600 },
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
    { id: "mesnada_sueldo", label: "Mesnada a sueldo", unitType: "infanteria" as UnitType, level: 1, goldPerUnit: 20, minTavernLevel: 1, origin: "Reinos Peninsulares", description: "Peones de frontera a sueldo estacional para choque rápido.", citation: "Cantar de mio Cid." },
    { id: "lanceros_sueldo", label: "Lanceros a sueldo", unitType: "infanteria" as UnitType, level: 2, goldPerUnit: 25, minTavernLevel: 1, origin: "Ciudades-Estado Europeas", description: "Infantería entrenada en formación de muralla de lanzas.", citation: "Annales Genoenses." },
    { id: "arqueros_fortuna", label: "Arqueros de fortuna", unitType: "arqueria" as UnitType, level: 2, goldPerUnit: 30, minTavernLevel: 2, origin: "Compañías de Fortuna", description: "Proyectilistas profesionales de larga distancia y cadencia fina.", citation: "Chroniques de Froissart." },
    { id: "jinetes_fortuna", label: "Jinetes de fortuna", unitType: "caballeria" as UnitType, level: 2, goldPerUnit: 75, minTavernLevel: 3, origin: "Balcanes y Frontera", description: "Caballería ligera móvil, experta en emboscadas y escaramuzas.", citation: "Philippe de Commynes." },
    { id: "compania_veterana", label: "Compañía veterana", unitType: "infanteria" as UnitType, level: 3, goldPerUnit: 30, minTavernLevel: 4, origin: "Compañías Blancas", description: "Infantería veterana curtida y altamente disciplinada en combate.", citation: "Machiavelli, Arte della guerra." },
    { id: "guardia_mercenaria", label: "Guardia mercenaria", unitType: "caballeria" as UnitType, level: 3, goldPerUnit: 90, minTavernLevel: 5, origin: "Condottieri Italianos", description: "Caballería pesada acorazada de asalto arrollador.", citation: "Rerum Italicarum Scriptores." },
  ],
  /** Tipo por defecto. */
  DEFAULT_TYPE_ID: "mesnada_sueldo",
} as const;
export type MercenaryTypeId = (typeof MERCENARIES.TYPES)[number]["id"];
export type MercenaryType = (typeof MERCENARIES.TYPES)[number];

/** [DECISIÓN 17-10-2026, actualizada 03-11-2026] Ranuras de investigación fijadas a 1 activa por decisión técnica. */
export const RESEARCH_SLOTS_BY_UNIVERSITY: readonly { minLevel: number; slots: number }[] = [
  { minLevel: 1, slots: 1 },
  { minLevel: 3, slots: 1 },
  { minLevel: 5, slots: 1 },
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
  onagro_campana: "onagro_campana",
  carrobalista: "carrobalista",
  espringarda_movil: "espringarda_movil",
  trabuchet_traccion: "trabuchet_traccion",
  arcuballista: "arcuballista",
  fustibalo_campo: "fustibalo_campo",
  mangonel_tactico: "mangonel_tactico",
  carros_artillados: "carros_artillados",
  ariete_movil: "ariete_movil",
  torres_asalto: "torres_asalto",
};

/** [DECISIÓN 17-10-2026, M-01 opción A] Recompensas de honor y gloria por batalla (P50, P51). */
export const BATTLE_REWARDS = {
  victory: { honor: 20, glory: 10 },
  crushingVictory: { honor: 50, glory: 30 },
  decisiveVictory: { honor: 30, glory: 18 },
  narrowVictory: { honor: 12, glory: 6 },
  draw: { honor: 5, glory: 0 },
  defeat: { honor: 0, glory: -5 },
  /** La gloria decae 1 punto por día real y nunca baja de 0. */
  GLORY_DECAY_PER_DAY: 1,
  /** +1 punto de moral por cada 10 de gloria, máximo +10. */
  GLORY_MORALE_PER_POINTS: 10,
  GLORY_MORALE_MAX: 10,
  /** Factor de escalado por tamaño relativo de ejércitos (anti-exploit y batallas desiguales). */
  SIZE_SCALING: {
    MIN_SCALE: 0.10,
    MAX_SCALE: 1.50,
    MIN_ARMY_SIZE: 10,
  },
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

/** Capacidad hospitalaria y gestión de heridos en exceso (triaje de campaña). */
export const HOSPITAL = {
  /** Capacidad de camas hospitalarias por nivel de Hospital militar. */
  CAPACITY_PER_LEVEL: 100,
  /** Tasa anual base de recuperación natural/triaje en campaña para heridos fuera de capacidad (5 %). */
  FIELD_RECOVERY_RATE: 0.05,
} as const;

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
  | "marchFatigue"
  | "foodConsumption"
  | "woodProduction"
  | "stoneProduction"
  | "ironProduction"
  | "goldProduction"
  | "researchDuration"
  | "constructionCost"
  | "housingCapacity"
  | "taxTolerance"
  | "moraleBase"
  | "unitEfficiencyInf"
  | "unitEfficiencyArc"
  | "unitEfficiencyCav"
  | "unitEfficiencyAll"
  | "mercenaryCost"
  | "woundedRate"
  | "fatigueAccrual"
  | "counterEspionage";

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

export const RESEARCH_TIME_SCALE = 1.0;

/** [ENTREGA 1, 2, 3, 4a, 4c] Topes máximos para los efectos acumulados de tecnologías (suma aditiva con techo). */
export const TECH_EFFECT_CAPS = {
  agricultureProduction: 0.65,
  miningProduction: 0.50,
  storageCapacity: 1.00,
  happinessBase: 30,
  combatAttack: 0.25,
  combatDefense: 0.25,
  marchSpeed: 0.50,
  marchFatigue: 0.50,
  woundedRecovery: 0.60,
  trainingDurationFloor: 0.60,
  constructionDurationFloor: 0.60,
  espionageAccuracyMax: 4,
  foodConsumption: 0.15,
  woodProduction: 0.30,
  stoneProduction: 0.30,
  ironProduction: 0.30,
  goldProduction: 0.60,
  researchDuration: 0.40,
  constructionCost: 0.25,
  housingCapacity: 0.30,
  taxTolerance: 0.50,
  moraleBase: 15,
  unitEfficiency: 0.20,
  mercenaryCost: 0.30,
  woundedRate: 0.20,
  fatigueAccrual: 0.30,
  counterEspionage: 0.60,
} as const;

const DAY = TIME.SECONDS_PER_GAME_YEAR;
/** [COMPLEMENTO §4, P62, ENTREGA 1 + 2] Catálogo tecnológico oficial con ramas universales y tecnologías únicas de civilización. */
export const TECHNOLOGIES: readonly TechnologyBalance[] = [
  // --- RAMA ECONÓMICA Y AGRÍCOLA ---
  { id: "agri_1", name: "Rotación de cultivos", branch: "economica", universityLevel: 1, costs: { gold: 100, wood: 100, stone: 50, iron: 0, food: 0 }, durationSeconds: 30, buildingRequirements: {}, technologyRequirements: [], effect: { key: "agricultureProduction", value: 0.05, description: "+5 % producción agrícola" } },
  { id: "agri_2", name: "Arado de vertedera de hierro", branch: "economica", universityLevel: 2, costs: { gold: 200, wood: 150, stone: 100, iron: 50, food: 0 }, durationSeconds: 180, buildingRequirements: { granja: 2 }, technologyRequirements: ["agri_1"], effect: { key: "agricultureProduction", value: 0.08, description: "+8 % producción agrícola por labranza profunda" } },
  { id: "agri_3", name: "Acequias y molinos hidráulicos", branch: "economica", universityLevel: 3, costs: { gold: 400, wood: 250, stone: 200, iron: 80, food: 0 }, durationSeconds: 360, buildingRequirements: { granja: 4, cantera: 2 }, technologyRequirements: ["agri_2"], effect: { key: "agricultureProduction", value: 0.12, description: "+12 % rendimiento en molienda y riego" } },
  { id: "agri_4", name: "Barbecho trienal y abonado", branch: "economica", universityLevel: 4, costs: { gold: 650, wood: 390, stone: 240, iron: 50, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 4, universidad: 4 }, technologyRequirements: ["agri_3"], effect: { key: "agricultureProduction", value: 0.06, description: "+6 % producción agrícola" } },
  { id: "agri_5", name: "Molinos de viento y hornos comunales", branch: "economica", universityLevel: 4, costs: { gold: 650, wood: 390, stone: 240, iron: 50, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 4, universidad: 4 }, technologyRequirements: ["agri_3"], effect: { key: "foodConsumption", value: -0.04, description: "Consumo de alimentos −4 %" } },
  { id: "agri_6", name: "Pósitos y graneros comunales", branch: "economica", universityLevel: 4, costs: { gold: 650, wood: 390, stone: 240, iron: 50, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 4, universidad: 4 }, technologyRequirements: ["agri_3", "storage_1"], effect: { key: "storageCapacity", value: 0.08, description: "+8 % capacidad de almacenamiento" } },
  { id: "agri_7", name: "Rotación de cuatro hojas", branch: "economica", universityLevel: 5, costs: { gold: 1100, wood: 500, stone: 360, iron: 90, food: 0 }, durationSeconds: Math.round(720 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 6, universidad: 5 }, technologyRequirements: ["agri_4", "agri_5"], effect: { key: "agricultureProduction", value: 0.08, description: "+8 % producción agrícola" } },
  { id: "agri_8", name: "Tratado de agronomía", branch: "economica", universityLevel: 5, costs: { gold: 1800, wood: 1040, stone: 560, iron: 150, food: 0 }, durationSeconds: Math.round(1080 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 8, universidad: 5 }, technologyRequirements: ["agri_7", "agri_6"], effect: { key: "agricultureProduction", value: 0.10, description: "+10 % producción agrícola" } },
  { id: "mining_1", name: "Herramientas mineras de hierro", branch: "economica", universityLevel: 1, costs: { gold: 100, wood: 80, stone: 80, iron: 10, food: 0 }, durationSeconds: 30, buildingRequirements: {}, technologyRequirements: [], effect: { key: "miningProduction", value: 0.05, description: "+5 % madera, piedra y hierro" } },
  { id: "mining_2", name: "Lavaderos de mineral y desmonte", branch: "economica", universityLevel: 2, costs: { gold: 250, wood: 150, stone: 150, iron: 60, food: 0 }, durationSeconds: 240, buildingRequirements: { minaHierro: 2 }, technologyRequirements: ["mining_1"], effect: { key: "miningProduction", value: 0.08, description: "+8 % extracción de materiales y mineral" } },
  { id: "mining_3", name: "Entibado de galerías", branch: "economica", universityLevel: 3, costs: { gold: 400, wood: 180, stone: 240, iron: 60, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 3, universidad: 3, minaHierro: 3 }, technologyRequirements: ["mining_2"], effect: { key: "miningProduction", value: 0.05, description: "+5 % madera, piedra y hierro" } },
  { id: "mining_4", name: "Aserraderos de sierra hidráulica", branch: "economica", universityLevel: 3, costs: { gold: 400, wood: 180, stone: 240, iron: 60, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 5, universidad: 3, aserradero: 5 }, technologyRequirements: ["mining_1"], effect: { key: "woodProduction", value: 0.10, description: "+10 % producción de madera" } },
  { id: "mining_5", name: "Canteras de cuña y talla", branch: "economica", universityLevel: 3, costs: { gold: 400, wood: 180, stone: 240, iron: 60, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 5, universidad: 3, cantera: 5 }, technologyRequirements: ["mining_1"], effect: { key: "stoneProduction", value: 0.10, description: "+10 % producción de piedra" } },
  { id: "mining_6", name: "Altos hornos de fundición", branch: "economica", universityLevel: 4, costs: { gold: 650, wood: 270, stone: 360, iron: 100, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 5, universidad: 4, minaHierro: 5, herreria: 3 }, technologyRequirements: ["mining_2"], effect: { key: "ironProduction", value: 0.10, description: "+10 % producción de hierro" } },
  { id: "mining_7", name: "Filones de oro y lavado aurífero", branch: "economica", universityLevel: 4, costs: { gold: 650, wood: 270, stone: 360, iron: 100, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 4, universidad: 4, minaOro: 4 }, technologyRequirements: ["mining_3"], effect: { key: "goldProduction", value: 0.06, description: "+6 % producción total de oro" } },
  { id: "mining_8", name: "Gremios de mineros y canteros", branch: "economica", universityLevel: 5, costs: { gold: 1100, wood: 450, stone: 540, iron: 180, food: 0 }, durationSeconds: Math.round(720 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 6, universidad: 5 }, technologyRequirements: ["mining_4", "mining_5", "mining_6"], effect: { key: "miningProduction", value: 0.08, description: "+8 % extracción de madera, piedra y hierro" } },
  { id: "mining_9", name: "Cecas y orfebrería real", branch: "economica", universityLevel: 5, costs: { gold: 1100, wood: 450, stone: 540, iron: 180, food: 0 }, durationSeconds: Math.round(720 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 6, universidad: 5, minaOro: 6 }, technologyRequirements: ["mining_7", "trade_2"], effect: { key: "goldProduction", value: 0.06, description: "+6 % producción total de oro" } },
  { id: "storage_1", name: "Almacenes reforzados", branch: "economica", universityLevel: 1, costs: { gold: 100, wood: 150, stone: 100, iron: 0, food: 0 }, durationSeconds: 45, buildingRequirements: {}, technologyRequirements: [], effect: { key: "storageCapacity", value: 0.10, description: "+10 % capacidad de almacenamiento" } },
  { id: "storage_2", name: "Silos y bodegas subterráneas", branch: "economica", universityLevel: 3, costs: { gold: 400, wood: 180, stone: 240, iron: 60, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 3, universidad: 3 }, technologyRequirements: ["storage_1"], effect: { key: "storageCapacity", value: 0.10, description: "+10 % capacidad de almacenamiento" } },
  { id: "storage_3", name: "Reservas de guerra", branch: "economica", universityLevel: 5, costs: { gold: 1100, wood: 450, stone: 540, iron: 180, food: 0 }, durationSeconds: Math.round(720 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 6, universidad: 5 }, technologyRequirements: ["storage_2", "trade_1"], effect: { key: "storageCapacity", value: 0.12, description: "+12 % capacidad de almacenamiento" } },
  { id: "trade_1", name: "Estándar real de pesos y medidas", branch: "economica", universityLevel: 2, costs: { gold: 200, wood: 150, stone: 150, iron: 20, food: 0 }, durationSeconds: 180, buildingRequirements: { mercado: 1 }, technologyRequirements: ["storage_1"], effect: { key: "storageCapacity", value: 0.15, description: "+15 % capacidad de gestión comercial y logística" } },
  { id: "trade_2", name: "Ferias y caravanas regulares", branch: "economica", universityLevel: 3, costs: { gold: 520, wood: 160, stone: 160, iron: 40, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 3, universidad: 3, mercado: 3 }, technologyRequirements: ["trade_1"], effect: { key: "goldProduction", value: 0.06, description: "+6 % producción total de oro" } },
  { id: "trade_3", name: "Lonjas y letras de cambio", branch: "economica", universityLevel: 4, costs: { gold: 850, wood: 240, stone: 240, iron: 70, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 5, universidad: 4, mercado: 5 }, technologyRequirements: ["trade_2"], effect: { key: "goldProduction", value: 0.08, description: "+8 % producción total de oro" } },
  { id: "trade_4", name: "Banca de los gremios", branch: "economica", universityLevel: 5, costs: { gold: 1430, wood: 400, stone: 360, iron: 110, food: 0 }, durationSeconds: Math.round(720 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 6, universidad: 5, mercado: 5 }, technologyRequirements: ["trade_3", "mining_7"], effect: { key: "goldProduction", value: 0.10, description: "+10 % producción total de oro" } },

  // --- RAMA CONSTRUCCIÓN Y CIVIL ---
  { id: "construction_1", name: "Cantería de sillería", branch: "civil", universityLevel: 1, costs: { gold: 100, wood: 100, stone: 150, iron: 10, food: 0 }, durationSeconds: 45, buildingRequirements: {}, technologyRequirements: [], effect: { key: "constructionDuration", value: -0.05, description: "−5 % duración de construcción" } },
  { id: "construction_2", name: "Grúas de rueda de ardilla", branch: "civil", universityLevel: 2, costs: { gold: 250, wood: 200, stone: 200, iron: 30, food: 0 }, durationSeconds: 240, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: ["construction_1"], effect: { key: "constructionDuration", value: -0.08, description: "−8 % duración en izado de cargas pesadas" } },
  { id: "construction_3", name: "Andamios y maestros de obra", branch: "civil", universityLevel: 3, costs: { gold: 400, wood: 220, stone: 260, iron: 40, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 3, universidad: 3 }, technologyRequirements: ["construction_2"], effect: { key: "constructionDuration", value: -0.06, description: "−6 % duración de construcción" } },
  { id: "construction_4", name: "Arbotantes y contrafuertes", branch: "civil", universityLevel: 3, costs: { gold: 500, wood: 260, stone: 320, iron: 50, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 4, universidad: 3, cantera: 5 }, technologyRequirements: ["construction_3"], effect: { key: "constructionCost", value: -0.06, description: "−6 % coste de construcción de edificios" } },
  { id: "construction_5", name: "Encofrados y mortero hidráulico", branch: "civil", universityLevel: 4, costs: { gold: 800, wood: 350, stone: 450, iron: 80, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 5, universidad: 4 }, technologyRequirements: ["construction_4"], effect: { key: "constructionCost", value: -0.07, description: "−7 % coste de construcción de edificios" } },
  { id: "construction_6", name: "Maestros de cantería y gremios", branch: "civil", universityLevel: 4, costs: { gold: 950, wood: 400, stone: 520, iron: 90, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 5, universidad: 4, cantera: 6 }, technologyRequirements: ["construction_5"], effect: { key: "constructionCost", value: -0.06, description: "−6 % coste de construcción de edificios" } },
  { id: "construction_7", name: "Arquitectura monumental de fábrica", branch: "civil", universityLevel: 5, costs: { gold: 1500, wood: 650, stone: 800, iron: 150, food: 0 }, durationSeconds: Math.round(720 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 7, universidad: 5 }, technologyRequirements: ["construction_6"], effect: { key: "constructionCost", value: -0.06, description: "−6 % coste de construcción de edificios" } },
  { id: "construction_8", name: "Obra maestra del reino", branch: "civil", universityLevel: 5, costs: { gold: 1800, wood: 880, stone: 910, iron: 190, food: 0 }, durationSeconds: Math.round(1080 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 8, universidad: 5 }, technologyRequirements: ["construction_6", "construction_7"], effect: { key: "constructionCost", value: -0.06, description: "−6 % coste de construcción de edificios" } },
  { id: "educ_1", name: "Tratados escolásticos y trivium", branch: "civil", universityLevel: 2, costs: { gold: 200, wood: 120, stone: 100, iron: 20, food: 0 }, durationSeconds: 180, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: [], effect: { key: "researchDuration", value: -0.08, description: "−8 % duración de investigaciones" } },
  { id: "educ_2", name: "Quadrivium y cátedras reales", branch: "civil", universityLevel: 3, costs: { gold: 450, wood: 200, stone: 180, iron: 40, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 3, universidad: 3 }, technologyRequirements: ["educ_1"], effect: { key: "researchDuration", value: -0.10, description: "−10 % duración de investigaciones" } },
  { id: "educ_3", name: "Bibliotecas monacales y cartularios", branch: "civil", universityLevel: 4, costs: { gold: 750, wood: 300, stone: 280, iron: 70, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 4, universidad: 4 }, technologyRequirements: ["educ_2"], effect: { key: "researchDuration", value: -0.12, description: "−12 % duración de investigaciones" } },
  { id: "educ_4", name: "Academia de ciencias reales", branch: "civil", universityLevel: 5, costs: { gold: 1250, wood: 500, stone: 480, iron: 120, food: 0 }, durationSeconds: Math.round(720 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 6, universidad: 5 }, technologyRequirements: ["educ_3"], effect: { key: "researchDuration", value: -0.10, description: "−10 % duración de investigaciones" } },
  { id: "educ_5", name: "Ingeniería y mecánica", branch: "civil", universityLevel: 4, costs: { gold: 850, wood: 240, stone: 300, iron: 80, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 4, universidad: 4 }, technologyRequirements: ["educ_2", "construction_3"], effect: { key: "constructionDuration", value: -0.05, description: "−5 % duración de construcción" } },
  { id: "educ_6", name: "Sabios y consejeros del reino", branch: "civil", universityLevel: 5, costs: { gold: 2340, wood: 640, stone: 700, iron: 230, food: 0 }, durationSeconds: Math.round(1080 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 8, universidad: 5 }, technologyRequirements: ["educ_3", "educ_5"], effect: { key: "researchDuration", value: -0.08, description: "−8 % duración de investigaciones" } },
  { id: "happiness_1", name: "Fiestas y ferias comunales", branch: "civil", universityLevel: 1, costs: { gold: 100, wood: 100, stone: 50, iron: 0, food: 0 }, durationSeconds: 45, buildingRequirements: {}, technologyRequirements: [], effect: { key: "happinessBase", value: 3, description: "+3 felicidad base" } },
  { id: "happiness_2", name: "Fueros de villa y gremios", branch: "civil", universityLevel: 3, costs: { gold: 350, wood: 150, stone: 150, iron: 20, food: 0 }, durationSeconds: 360, buildingRequirements: { castillo: 3, mercado: 2 }, technologyRequirements: ["happiness_1"], effect: { key: "happinessBase", value: 5, description: "+5 felicidad base por autogobierno gremial" } },
  { id: "happiness_4", name: "Justas, circo y festejos", branch: "civil", universityLevel: 3, costs: { gold: 400, wood: 220, stone: 260, iron: 40, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 3, universidad: 3, circo: 3 }, technologyRequirements: ["happiness_1"], effect: { key: "happinessBase", value: 3, description: "+3 felicidad base" } },
  { id: "happiness_5", name: "Exención de cargas y patronato", branch: "civil", universityLevel: 3, costs: { gold: 400, wood: 180, stone: 180, iron: 40, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 3, universidad: 3, mercado: 2 }, technologyRequirements: ["happiness_1"], effect: { key: "taxTolerance", value: -0.50, description: "−50 % penalización por impuestos altos" } },

  // --- RAMA MILITAR, METALURGIA Y DOCTRINA ---
  { id: "training_1", name: "Doctrina de instrucción de levas", branch: "militar", universityLevel: 1, costs: { gold: 100, wood: 80, stone: 50, iron: 20, food: 0 }, durationSeconds: 45, buildingRequirements: { cuartel: 1 }, technologyRequirements: [], effect: { key: "trainingDuration", value: -0.05, description: "−5 % duración de entrenamiento militar" } },
  { id: "training_2", name: "Ordenanzas de regimiento", branch: "militar", universityLevel: 3, costs: { gold: 300, wood: 150, stone: 100, iron: 80, food: 0 }, durationSeconds: 300, buildingRequirements: { cuartel: 3, universidad: 3 }, technologyRequirements: ["training_1"], effect: { key: "trainingDuration", value: -0.10, description: "−10 % duración de adiestramiento en filas" } },
  { id: "training_3", name: "Campos de instrucción permanentes", branch: "militar", universityLevel: 4, costs: { gold: 650, wood: 240, stone: 180, iron: 130, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 5, universidad: 4, cuartel: 5 }, technologyRequirements: ["training_2"], effect: { key: "trainingDuration", value: -0.06, description: "−6 % duración de entrenamiento militar" } },
  { id: "medicine_1", name: "Cataplasmas y huertos medicinales", branch: "militar", universityLevel: 2, costs: { gold: 100, wood: 80, stone: 80, iron: 10, food: 0 }, durationSeconds: 45, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: [], effect: { key: "woundedRecovery", value: 0.05, description: "+5 pp de recuperación de heridos" } },
  { id: "medical_2", name: "Cirugía de campaña y triaje", branch: "militar", universityLevel: 3, costs: { gold: 400, wood: 150, stone: 200, iron: 100, food: 0 }, durationSeconds: 360, buildingRequirements: { hospitalMilitar: 2, universidad: 3 }, technologyRequirements: ["medicine_1"], effect: { key: "woundedRecovery", value: 0.10, description: "+10 pp recuperación de heridos en hospital" } },
  { id: "medicine_3", name: "Herboristería y boticas", branch: "militar", universityLevel: 3, costs: { gold: 400, wood: 160, stone: 200, iron: 50, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 3, universidad: 3, hospitalMilitar: 2 }, technologyRequirements: ["medicine_1"], effect: { key: "happinessBase", value: 2, description: "+2 felicidad base" } },
  { id: "weapons_1", name: "Metalurgia del acero", branch: "militar", universityLevel: 3, costs: { gold: 300, wood: 100, stone: 150, iron: 100, food: 0 }, durationSeconds: 300, buildingRequirements: { castillo: 3, universidad: 3, herreria: 3 }, technologyRequirements: [], effect: { key: "unlockWeaponSteel", value: 1, description: "Desbloquea arma de acero (×1,15)" } },
  { id: "armor_1", name: "Armaduras de hierro y malla", branch: "militar", universityLevel: 3, costs: { gold: 300, wood: 100, stone: 150, iron: 100, food: 0 }, durationSeconds: 300, buildingRequirements: { castillo: 3, universidad: 3, herreria: 3 }, technologyRequirements: [], effect: { key: "unlockArmorSteel", value: 1, description: "Desbloquea armadura de acero (×1,25)" } },
  { id: "advanced_steel", name: "Acero al crisol y caldeado", branch: "militar", universityLevel: 3, costs: { gold: 600, wood: 200, stone: 250, iron: 200, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 5, universidad: 3, herreria: 4 }, technologyRequirements: ["weapons_1"], effect: { key: "unlockWeaponAdvancedSteel", value: 1, description: "Desbloquea arma de acero avanzado (×1,30)" } },
  { id: "forge_2", name: "Templado y revenido", branch: "militar", universityLevel: 4, costs: { gold: 780, wood: 150, stone: 240, iron: 260, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 4, universidad: 4, herreria: 4 }, technologyRequirements: ["weapons_1"], effect: { key: "combatAttack", value: 0.03, description: "+3 % ataque militar" } },
  { id: "forge_3", name: "Cotas de malla y escudos reforzados", branch: "militar", universityLevel: 4, costs: { gold: 780, wood: 150, stone: 240, iron: 260, food: 0 }, durationSeconds: Math.round(480 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 4, universidad: 4, herreria: 4 }, technologyRequirements: ["armor_1"], effect: { key: "combatDefense", value: 0.03, description: "+3 % defensa militar" } },
  { id: "forge_4", name: "Aceros de crisol refinado", branch: "militar", universityLevel: 5, costs: { gold: 1320, wood: 250, stone: 360, iron: 440, food: 0 }, durationSeconds: Math.round(720 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 6, universidad: 5, herreria: 5 }, technologyRequirements: ["advanced_steel", "forge_2"], effect: { key: "combatAttack", value: 0.03, description: "+3 % ataque militar" } },
  { id: "forge_5", name: "Armaduras de placas articuladas", branch: "militar", universityLevel: 5, costs: { gold: 1320, wood: 250, stone: 360, iron: 440, food: 0 }, durationSeconds: Math.round(720 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 6, universidad: 5, herreria: 5 }, technologyRequirements: ["forge_3", "advanced_steel"], effect: { key: "combatDefense", value: 0.04, description: "+4 % defensa militar" } },
  { id: "logistics_1", name: "Intendencia y trenes de bagaje", branch: "militar", universityLevel: 3, costs: { gold: 400, wood: 160, stone: 120, iron: 80, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 3, universidad: 3, cuartel: 3 }, technologyRequirements: ["training_1"], effect: { key: "marchFatigue", value: -0.10, description: "−10 % fatiga de marcha" } },
  { id: "logistics_2", name: "Calzadas y postas militares", branch: "militar", universityLevel: 3, costs: { gold: 400, wood: 160, stone: 120, iron: 80, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 3, universidad: 3 }, technologyRequirements: ["training_1"], effect: { key: "marchSpeed", value: 0.07, description: "+7 % velocidad de marcha" } },

  // --- RAMA INTELIGENCIA Y EXPLORACIÓN ---
  { id: "espionage_1", name: "Red de confidentes I", branch: "inteligencia", universityLevel: 2, costs: { gold: 200, wood: 100, stone: 100, iron: 20, food: 0 }, durationSeconds: 180, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: [], effect: { key: "espionageAccuracy", value: 1, description: "Informe militar aproximado (±15 %)" } },
  { id: "espionage_2", name: "Criptografía y agentes II", branch: "inteligencia", universityLevel: 4, costs: { gold: 500, wood: 200, stone: 200, iron: 100, food: 0 }, durationSeconds: 480, buildingRequirements: { universidad: 4 }, technologyRequirements: ["espionage_1"], effect: { key: "espionageAccuracy", value: 2, description: "Informe militar preciso (±7 %)" } },
  { id: "espionage_3", name: "Informantes en la corte III", branch: "inteligencia", universityLevel: 4, costs: { gold: 800, wood: 320, stone: 300, iron: 90, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 5 }, technologyRequirements: ["espionage_2", "spy_2"], effect: { key: "espionageAccuracy", value: 3, description: "Informe militar detallado (±3 %)" } },
  { id: "espionage_4", name: "Maestros del espionaje IV", branch: "inteligencia", universityLevel: 5, costs: { gold: 2340, wood: 640, stone: 700, iron: 230, food: 0 }, durationSeconds: 1080, buildingRequirements: { castillo: 8 }, technologyRequirements: ["espionage_3", "spy_3"], effect: { key: "espionageAccuracy", value: 4, description: "Informe militar exacto" } },
  { id: "spy_1", name: "Ojos y oídos en el reino", branch: "inteligencia", universityLevel: 2, costs: { gold: 250, wood: 150, stone: 100, iron: 40, food: 0 }, durationSeconds: 240, buildingRequirements: { castillo: 2 }, technologyRequirements: [], effect: { key: "counterEspionage", value: 0.10, description: "+10 % probabilidad de contrainteligencia" } },
  { id: "spy_2", name: "Exploradores y atalayas", branch: "inteligencia", universityLevel: 3, costs: { gold: 480, wood: 160, stone: 160, iron: 60, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 3, universidad: 3 }, technologyRequirements: ["espionage_1"], effect: { key: "marchSpeed", value: 0.05, description: "+5 % velocidad de marcha" } },
  { id: "spy_3", name: "Guardia del silencio", branch: "inteligencia", universityLevel: 4, costs: { gold: 750, wood: 300, stone: 280, iron: 80, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 4 }, technologyRequirements: ["spy_1", "spy_2"], effect: { key: "counterEspionage", value: 0.12, description: "+12 % probabilidad de contrainteligencia" } },
  { id: "spy_4", name: "Sombras del trono", branch: "inteligencia", universityLevel: 5, costs: { gold: 2100, wood: 600, stone: 700, iron: 220, food: 0 }, durationSeconds: 1080, buildingRequirements: { castillo: 8 }, technologyRequirements: ["spy_3", "espionage_3"], effect: { key: "counterEspionage", value: 0.15, description: "+15 % probabilidad de contrainteligencia" } },

  // --- TECNOLOGÍAS ÚNICAS POR CIVILIZACIÓN (420 s / 7 minutos cada una) ---
  { id: "tech_civ_ingleses", name: "Arco largo inglés", branch: "civilizacion", universityLevel: 2, costs: { gold: 200, wood: 250, stone: 80, iron: 50, food: 0 }, durationSeconds: 420, buildingRequirements: { cuartel: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "ingleses", effect: { key: "combatAttack", value: 0.05, description: "+5 % ataque militar (alcance letal de arquería)" } },
  { id: "tech_civ_romanos", name: "Legión y testudo", branch: "civilizacion", universityLevel: 2, costs: { gold: 200, wood: 80, stone: 250, iron: 80, food: 0 }, durationSeconds: 420, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "romanos", effect: { key: "combatDefense", value: 0.05, description: "+5 % defensa militar en formación cerrada" } },
  { id: "tech_civ_griegos", name: "Falange y dialéctica", branch: "civilizacion", universityLevel: 2, costs: { gold: 250, wood: 100, stone: 150, iron: 60, food: 0 }, durationSeconds: 420, buildingRequirements: { universidad: 2 }, technologyRequirements: [], civilizationRequirement: "griegos", effect: { key: "combatDefense", value: 0.05, description: "+5 % defensa militar en formación de falange" } },
  { id: "tech_civ_vikingos", name: "Drakkar y furia nórdica", branch: "civilizacion", universityLevel: 2, costs: { gold: 180, wood: 300, stone: 80, iron: 60, food: 0 }, durationSeconds: 420, buildingRequirements: { cuartel: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "vikingos", effect: { key: "combatAttack", value: 0.05, description: "+5 % ataque militar e ímpetu de asalto" } },
  { id: "tech_civ_bizantinos", name: "Fuego griego y baluartes", branch: "civilizacion", universityLevel: 2, costs: { gold: 300, wood: 100, stone: 200, iron: 100, food: 0 }, durationSeconds: 420, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "bizantinos", effect: { key: "combatDefense", value: 0.06, description: "+6 % defensa militar y fuego defensivo" } },
  { id: "tech_civ_arabes", name: "Medicina de Córdoba y riego", branch: "civilizacion", universityLevel: 2, costs: { gold: 250, wood: 120, stone: 120, iron: 40, food: 0 }, durationSeconds: 420, buildingRequirements: { hospitalMilitar: 1, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "arabes", effect: { key: "woundedRecovery", value: 0.10, description: "+10 pp recuperación de heridos y acequias de regadío" } },
  { id: "tech_civ_mongoles", name: "Tácticas de la estepa", branch: "civilizacion", universityLevel: 2, costs: { gold: 200, wood: 150, stone: 80, iron: 50, food: 0 }, durationSeconds: 420, buildingRequirements: { cuartel: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "mongoles", effect: { key: "marchSpeed", value: 0.15, description: "+15 % velocidad de marcha y maniobra envolvente" } },
  { id: "tech_civ_chinos", name: "Gran Muralla y pólvora", branch: "civilizacion", universityLevel: 2, costs: { gold: 220, wood: 150, stone: 300, iron: 50, food: 0 }, durationSeconds: 420, buildingRequirements: { castillo: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "chinos", effect: { key: "combatDefense", value: 0.06, description: "+6 % defensa militar y arquitectura defensiva" } },
  { id: "tech_civ_japoneses", name: "Acero Tamahagane y Bushido", branch: "civilizacion", universityLevel: 2, costs: { gold: 250, wood: 100, stone: 100, iron: 120, food: 0 }, durationSeconds: 420, buildingRequirements: { herreria: 2, universidad: 2 }, technologyRequirements: [], civilizationRequirement: "japoneses", effect: { key: "combatAttack", value: 0.05, description: "+5 % ataque militar por temple de hojas de acero" } },
  { id: "tech_civ_navajos", name: "Rastreadores del bosque", branch: "civilizacion", universityLevel: 2, costs: { gold: 150, wood: 250, stone: 100, iron: 30, food: 0 }, durationSeconds: 420, buildingRequirements: { universidad: 2 }, technologyRequirements: [], civilizationRequirement: "navajos", effect: { key: "marchFatigue", value: 0.20, description: "−20 % fatiga de marcha por sendas y bosques" } },
  { id: "tech_civ_aztecas", name: "Chinampas y sacerdotes guerreros", branch: "civilizacion", universityLevel: 2, costs: { gold: 200, wood: 200, stone: 150, iron: 30, food: 0 }, durationSeconds: 420, buildingRequirements: { universidad: 2 }, technologyRequirements: [], civilizationRequirement: "aztecas", effect: { key: "agricultureProduction", value: 0.08, description: "+8 % producción agrícola en huertos intensivos" } },
  { id: "tech_civ_masais", name: "Resistencia masái y sabana", branch: "civilizacion", universityLevel: 2, costs: { gold: 160, wood: 180, stone: 100, iron: 40, food: 0 }, durationSeconds: 420, buildingRequirements: { universidad: 2 }, technologyRequirements: [], civilizationRequirement: "masais", effect: { key: "marchFatigue", value: 0.25, description: "−25 % fatiga en expediciones de larga distancia" } },
  { id: "happiness_3", name: "Capellanes de campaña y misas de leva", branch: "civil", universityLevel: 2, costs: { gold: 250, wood: 170, stone: 160, iron: 20, food: 0 }, durationSeconds: 240, buildingRequirements: { castillo: 2, iglesia: 2 }, technologyRequirements: ["happiness_1"], effect: { key: "moraleBase", value: 3, description: "Moral militar +3 puntos" } },
  { id: "happiness_6", name: "Cofradías y fiestas patronales", branch: "civil", universityLevel: 4, costs: { gold: 650, wood: 330, stone: 390, iron: 70, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 4, iglesia: 4, circo: 4 }, technologyRequirements: ["happiness_3", "happiness_4"], effect: { key: "happinessBase", value: 4, description: "+4 felicidad base" } },
  { id: "happiness_7", name: "Edad de oro del reino", branch: "civil", universityLevel: 5, costs: { gold: 1800, wood: 880, stone: 910, iron: 190, food: 0 }, durationSeconds: 1080, buildingRequirements: { castillo: 8 }, technologyRequirements: ["happiness_2", "happiness_5", "happiness_6"], effect: { key: "happinessBase", value: 5, description: "+5 felicidad base" } },
  { id: "training_4", name: "Disciplina y ordenanza de hierro", branch: "militar", universityLevel: 4, costs: { gold: 650, wood: 240, stone: 180, iron: 130, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 4, cuartel: 4 }, technologyRequirements: ["training_2"], effect: { key: "moraleBase", value: 3, description: "Moral militar +3 puntos" } },
  { id: "training_5", name: "Academia militar", branch: "militar", universityLevel: 5, costs: { gold: 1100, wood: 400, stone: 270, iron: 220, food: 0 }, durationSeconds: 720, buildingRequirements: { castillo: 6, cuartel: 6 }, technologyRequirements: ["training_3", "training_4"], effect: { key: "trainingDuration", value: -0.08, description: "−8 % duración de entrenamiento militar" } },
  { id: "logistics_4", name: "Estandartes, trompetas y banderas", branch: "militar", universityLevel: 4, costs: { gold: 650, wood: 240, stone: 180, iron: 130, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 4, cuartel: 4 }, technologyRequirements: ["training_4", "logistics_1"], effect: { key: "moraleBase", value: 3, description: "Moral militar +3 puntos" } },
  { id: "tactics_inf_1", name: "Escuadras de lanceros y piqueros", branch: "militar", universityLevel: 2, costs: { gold: 250, wood: 120, stone: 70, iron: 40, food: 0 }, durationSeconds: 240, buildingRequirements: { castillo: 2, cuartel: 2 }, technologyRequirements: ["training_1"], effect: { key: "unitEfficiencyInf", value: 0.04, description: "Eficacia de infantería +4 %" } },
  { id: "tactics_arc_1", name: "Compañías de arqueros y ballesteros", branch: "militar", universityLevel: 2, costs: { gold: 250, wood: 120, stone: 70, iron: 40, food: 0 }, durationSeconds: 240, buildingRequirements: { castillo: 2, cuartel: 2 }, technologyRequirements: ["training_1"], effect: { key: "unitEfficiencyArc", value: 0.04, description: "Eficacia de arqueros +4 %" } },
  { id: "tactics_cav_1", name: "Monta y caballería pesada", branch: "militar", universityLevel: 2, costs: { gold: 250, wood: 120, stone: 70, iron: 40, food: 0 }, durationSeconds: 240, buildingRequirements: { castillo: 2, cuartel: 2 }, technologyRequirements: ["training_1"], effect: { key: "unitEfficiencyCav", value: 0.04, description: "Eficacia de caballería +4 %" } },
  { id: "tactics_inf_2", name: "Infantería de línea", branch: "militar", universityLevel: 4, costs: { gold: 650, wood: 240, stone: 180, iron: 130, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 4, cuartel: 4 }, technologyRequirements: ["tactics_inf_1", "training_2"], effect: { key: "unitEfficiencyInf", value: 0.05, description: "Eficacia de infantería +5 %" } },
  { id: "tactics_arc_2", name: "Salvas y tiro en masa", branch: "militar", universityLevel: 4, costs: { gold: 650, wood: 240, stone: 180, iron: 130, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 4, cuartel: 4 }, technologyRequirements: ["tactics_arc_1", "training_2"], effect: { key: "unitEfficiencyArc", value: 0.05, description: "Eficacia de arqueros +5 %" } },
  { id: "tactics_cav_2", name: "Cargas de choque y maniobra", branch: "militar", universityLevel: 4, costs: { gold: 650, wood: 240, stone: 180, iron: 130, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 4, cuartel: 4 }, technologyRequirements: ["tactics_cav_1", "training_2"], effect: { key: "unitEfficiencyCav", value: 0.05, description: "Eficacia de caballería +5 %" } },
  { id: "tactics_all", name: "Ejércitos de armas combinadas", branch: "militar", universityLevel: 5, costs: { gold: 1800, wood: 640, stone: 420, iron: 380, food: 0 }, durationSeconds: 1080, buildingRequirements: { castillo: 8, cuartel: 7 }, technologyRequirements: ["tactics_inf_2", "tactics_arc_2", "tactics_cav_2"], effect: { key: "unitEfficiencyAll", value: 0.04, description: "Eficacia de las tres armas +4 %" } },
  { id: "merc_1", name: "Contratas y capitanes de compañía", branch: "economica", universityLevel: 3, costs: { gold: 400, wood: 160, stone: 120, iron: 80, food: 0 }, durationSeconds: Math.round(360 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 3, universidad: 3, taberna: 3 }, technologyRequirements: ["training_1"], effect: { key: "mercenaryCost", value: -0.08, description: "−8 % coste de mercenarios" } },
  { id: "merc_2", name: "Compañías libres", branch: "economica", universityLevel: 5, costs: { gold: 1100, wood: 400, stone: 270, iron: 220, food: 0 }, durationSeconds: Math.round(720 * RESEARCH_TIME_SCALE), buildingRequirements: { castillo: 6, universidad: 5, taberna: 5 }, technologyRequirements: ["merc_1", "trade_2"], effect: { key: "mercenaryCost", value: -0.10, description: "−10 % coste de mercenarios" } },
  // --- ENTREGA 4c: HERIDOS, FATIGA Y LOGÍSTICA ---
  { id: "medicine_2", name: "Ambulancias de carro y hospicio de campaña", branch: "militar", universityLevel: 3, costs: { gold: 400, wood: 160, stone: 200, iron: 50, food: 0 }, durationSeconds: 360, buildingRequirements: { castillo: 3, hospitalMilitar: 3 }, technologyRequirements: ["medicine_1"], effect: { key: "woundedRate", value: 0.04, description: "Bajas que pasan a heridos +4 %" } },
  { id: "medical_3", name: "Cirugía de guerra y vino antiséptico", branch: "militar", universityLevel: 4, costs: { gold: 650, wood: 240, stone: 300, iron: 80, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 4, hospitalMilitar: 4 }, technologyRequirements: ["medical_2", "medicine_2"], effect: { key: "woundedRate", value: 0.05, description: "Bajas que pasan a heridos +5 %" } },
  { id: "medical_4", name: "Letrinas, baños y aseo de campamento", branch: "militar", universityLevel: 4, costs: { gold: 650, wood: 240, stone: 300, iron: 80, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 4, hospitalMilitar: 3 }, technologyRequirements: ["medicine_3"], effect: { key: "fatigueAccrual", value: -0.05, description: "Fatiga acumulada −5 %" } },
  { id: "medical_5", name: "Orden de caballeros hospitalarios", branch: "militar", universityLevel: 5, costs: { gold: 1800, wood: 640, stone: 700, iron: 230, food: 0 }, durationSeconds: 1080, buildingRequirements: { castillo: 8, hospitalMilitar: 5 }, technologyRequirements: ["medical_3", "medical_4"], effect: { key: "woundedRate", value: 0.06, description: "Bajas que pasan a heridos +6 %" } },
  { id: "logistics_3", name: "Campamentos fortificados", branch: "militar", universityLevel: 4, costs: { gold: 650, wood: 240, stone: 180, iron: 130, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 4, cuartel: 4 }, technologyRequirements: ["logistics_1"], effect: { key: "fatigueAccrual", value: -0.06, description: "Fatiga acumulada −6 %" } },
  { id: "logistics_5", name: "Marchas forzadas", branch: "militar", universityLevel: 5, costs: { gold: 1100, wood: 400, stone: 270, iron: 220, food: 0 }, durationSeconds: 720, buildingRequirements: { castillo: 6, cuartel: 6 }, technologyRequirements: ["logistics_2", "logistics_3"], effect: { key: "marchSpeed", value: 0.08, description: "+8 % velocidad de marcha" } },
  { id: "logistics_6", name: "Estado mayor logístico", branch: "militar", universityLevel: 5, costs: { gold: 1800, wood: 640, stone: 420, iron: 380, food: 0 }, durationSeconds: 1080, buildingRequirements: { castillo: 8 }, technologyRequirements: ["logistics_4", "logistics_5"], effect: { key: "marchFatigue", value: -0.10, description: "−10 % fatiga de marcha" } },
  // --- ENTREGA 6a: CADENAS DE CIVILIZACIÓN (6/12) ---
  // Ingleses
  { id: "tech_civ_ingleses_a", name: "Arqueros de tiro largo", branch: "civilizacion", universityLevel: 3, costs: { gold: 600, wood: 500, stone: 0, iron: 200, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_ingleses"], civilizationRequirement: "ingleses", effect: { key: "unitEfficiencyArc", value: 0.08, description: "Eficacia de arqueros +8 %" } },
  { id: "tech_civ_ingleses_b", name: "Rotación de cultivos avanzada", branch: "civilizacion", universityLevel: 3, costs: { gold: 500, wood: 200, stone: 200, iron: 0, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_ingleses"], civilizationRequirement: "ingleses", effect: { key: "agricultureProduction", value: 0.10, description: "+10 % producción agrícola" } },
  { id: "tech_civ_ingleses_c", name: "Dominio del Canal", branch: "civilizacion", universityLevel: 5, costs: { gold: 1200, wood: 800, stone: 400, iron: 300, food: 0 }, durationSeconds: 900, buildingRequirements: { castillo: 6 }, technologyRequirements: ["tech_civ_ingleses_a", "tech_civ_ingleses_b"], civilizationRequirement: "ingleses", effect: { key: "combatAttack", value: 0.12, description: "+12 % ataque militar total" } },
  // Romanos
  { id: "tech_civ_romanos_a", name: "Formación de Testudo", branch: "civilizacion", universityLevel: 3, costs: { gold: 400, wood: 200, stone: 400, iron: 400, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_romanos"], civilizationRequirement: "romanos", effect: { key: "unitEfficiencyInf", value: 0.10, description: "Eficacia de infantería +10 %" } },
  { id: "tech_civ_romanos_b", name: "Acueductos y calzadas", branch: "civilizacion", universityLevel: 3, costs: { gold: 400, wood: 0, stone: 800, iron: 200, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_romanos"], civilizationRequirement: "romanos", effect: { key: "constructionDuration", value: -0.06, description: "−6 % duración de construcción" } },
  { id: "tech_civ_romanos_c", name: "Legado de la Legión", branch: "civilizacion", universityLevel: 5, costs: { gold: 1500, wood: 300, stone: 600, iron: 800, food: 0 }, durationSeconds: 900, buildingRequirements: { castillo: 6 }, technologyRequirements: ["tech_civ_romanos_a", "tech_civ_romanos_b"], civilizationRequirement: "romanos", effect: { key: "unitEfficiencyInf", value: 0.12, description: "Eficacia de infantería +12 %" } },
  // Griegos
  { id: "tech_civ_griegos_a", name: "Falange hoplita", branch: "civilizacion", universityLevel: 3, costs: { gold: 500, wood: 300, stone: 200, iron: 400, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_griegos"], civilizationRequirement: "griegos", effect: { key: "unitEfficiencyInf", value: 0.08, description: "Eficacia de infantería +8 %" } },
  { id: "tech_civ_griegos_b", name: "Academias de filosofía", branch: "civilizacion", universityLevel: 3, costs: { gold: 800, wood: 200, stone: 200, iron: 100, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_griegos"], civilizationRequirement: "griegos", effect: { key: "researchDuration", value: -0.05, description: "−5 % duración de investigaciones" } },
  { id: "tech_civ_griegos_c", name: "Fuego griego", branch: "civilizacion", universityLevel: 5, costs: { gold: 1400, wood: 400, stone: 560, iron: 900, food: 0 }, durationSeconds: 900, buildingRequirements: { castillo: 6 }, technologyRequirements: ["tech_civ_griegos_a", "tech_civ_griegos_b"], civilizationRequirement: "griegos", effect: { key: "unitEfficiencyArc", value: 0.15, description: "Eficacia de arqueros +15 %" } },
  // Vikingos
  { id: "tech_civ_vikingos_a", name: "Navegación estelar", branch: "civilizacion", universityLevel: 3, costs: { gold: 700, wood: 600, stone: 0, iron: 0, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_vikingos"], civilizationRequirement: "vikingos", effect: { key: "goldProduction", value: 0.08, description: "+8 % producción de oro" } },
  { id: "tech_civ_vikingos_b", name: "Forja de acero nórdico", branch: "civilizacion", universityLevel: 3, costs: { gold: 400, wood: 100, stone: 0, iron: 800, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_vikingos"], civilizationRequirement: "vikingos", effect: { key: "unitEfficiencyInf", value: 0.08, description: "Eficacia de infantería +8 %" } },
  { id: "tech_civ_vikingos_c", name: "Furia de los Berserkers", branch: "civilizacion", universityLevel: 5, costs: { gold: 1600, wood: 700, stone: 0, iron: 600, food: 0 }, durationSeconds: 900, buildingRequirements: { castillo: 6 }, technologyRequirements: ["tech_civ_vikingos_a", "tech_civ_vikingos_b"], civilizationRequirement: "vikingos", effect: { key: "combatAttack", value: 0.12, description: "+12 % ataque militar total" } },
  // Bizantinos
  { id: "tech_civ_bizantinos_a", name: "Muros Teodosianos", branch: "civilizacion", universityLevel: 3, costs: { gold: 300, wood: 100, stone: 1000, iron: 200, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_bizantinos"], civilizationRequirement: "bizantinos", effect: { key: "combatDefense", value: 0.08, description: "+8 % defensa militar" } },
  { id: "tech_civ_bizantinos_b", name: "Diplomacia imperial", branch: "civilizacion", universityLevel: 3, costs: { gold: 800, wood: 0, stone: 0, iron: 0, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_bizantinos"], civilizationRequirement: "bizantinos", effect: { key: "goldProduction", value: 0.10, description: "+10 % producción de oro" } },
  { id: "tech_civ_bizantinos_c", name: "Catafractos imperiales", branch: "civilizacion", universityLevel: 5, costs: { gold: 1800, wood: 400, stone: 400, iron: 900, food: 0 }, durationSeconds: 900, buildingRequirements: { castillo: 6 }, technologyRequirements: ["tech_civ_bizantinos_a", "tech_civ_bizantinos_b"], civilizationRequirement: "bizantinos", effect: { key: "unitEfficiencyCav", value: 0.12, description: "Eficacia de caballería +12 %" } },
  // Árabes
  { id: "tech_civ_arabes_a", name: "Sabiduría de la Casa", branch: "civilizacion", universityLevel: 3, costs: { gold: 900, wood: 100, stone: 100, iron: 100, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_arabes"], civilizationRequirement: "arabes", effect: { key: "researchDuration", value: -0.06, description: "−6 % duración de investigaciones" } },
  { id: "tech_civ_arabes_b", name: "Comercio de caravanas", branch: "civilizacion", universityLevel: 3, costs: { gold: 600, wood: 200, stone: 100, iron: 0, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_arabes"], civilizationRequirement: "arabes", effect: { key: "goldProduction", value: 0.12, description: "+12 % producción de oro" } },
  { id: "tech_civ_arabes_c", name: "Tácticas de desierto", branch: "civilizacion", universityLevel: 5, costs: { gold: 1300, wood: 400, stone: 200, iron: 500, food: 0 }, durationSeconds: 900, buildingRequirements: { castillo: 6 }, technologyRequirements: ["tech_civ_arabes_a", "tech_civ_arabes_b"], civilizationRequirement: "arabes", effect: { key: "unitEfficiencyAll", value: 0.10, description: "Eficacia de las tres armas +10 %" } },
  // --- ENTREGA 6b: CADENAS DE CIVILIZACIÓN (Resto) ---
  // Mongoles
  { id: "tech_civ_mongoles_a", name: "Yasa y disciplina de la horda", branch: "civilizacion", universityLevel: 3, costs: { gold: 400, wood: 200, stone: 100, iron: 100, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3, cuartel: 3 }, technologyRequirements: ["tech_civ_mongoles"], civilizationRequirement: "mongoles", effect: { key: "moraleBase", value: 4, description: "Moral militar +4 puntos" } },
  { id: "tech_civ_mongoles_b", name: "Correo Yam", branch: "civilizacion", universityLevel: 3, costs: { gold: 600, wood: 300, stone: 0, iron: 0, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_mongoles"], civilizationRequirement: "mongoles", effect: { key: "marchSpeed", value: 0.10, description: "+10 % velocidad de marcha" } },
  { id: "tech_civ_mongoles_c", name: "Arqueros a caballo de élite", branch: "civilizacion", universityLevel: 5, costs: { gold: 1600, wood: 400, stone: 200, iron: 700, food: 0 }, durationSeconds: 900, buildingRequirements: { castillo: 6, cuartel: 5 }, technologyRequirements: ["tech_civ_mongoles_a", "tech_civ_mongoles_b"], civilizationRequirement: "mongoles", effect: { key: "unitEfficiencyCav", value: 0.15, description: "Eficacia de caballería +15 %" } },
  // Chinos
  { id: "tech_civ_chinos_a", name: "Exámenes imperiales", branch: "civilizacion", universityLevel: 3, costs: { gold: 700, wood: 200, stone: 200, iron: 50, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3, universidad: 3 }, technologyRequirements: ["tech_civ_chinos"], civilizationRequirement: "chinos", effect: { key: "researchDuration", value: -0.05, description: "−5 % duración de investigaciones" } },
  { id: "tech_civ_chinos_b", name: "Ballestas de repetición", branch: "civilizacion", universityLevel: 3, costs: { gold: 500, wood: 300, stone: 100, iron: 300, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3, herreria: 3 }, technologyRequirements: ["tech_civ_chinos"], civilizationRequirement: "chinos", effect: { key: "unitEfficiencyArc", value: 0.08, description: "Eficacia de arqueros +8 %" } },
  { id: "tech_civ_chinos_c", name: "Mandato del Cielo", branch: "civilizacion", universityLevel: 5, costs: { gold: 1800, wood: 600, stone: 800, iron: 200, food: 0 }, durationSeconds: 900, buildingRequirements: { castillo: 6 }, technologyRequirements: ["tech_civ_chinos_a", "tech_civ_chinos_b"], civilizationRequirement: "chinos", effect: { key: "happinessBase", value: 6, description: "+6 felicidad base" } },
  // Japoneses
  { id: "tech_civ_japoneses_a", name: "Código Bushido", branch: "civilizacion", universityLevel: 3, costs: { gold: 500, wood: 200, stone: 100, iron: 100, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_japoneses"], civilizationRequirement: "japoneses", effect: { key: "moraleBase", value: 5, description: "Moral militar +5 puntos" } },
  { id: "tech_civ_japoneses_b", name: "Maestros forjadores", branch: "civilizacion", universityLevel: 3, costs: { gold: 400, wood: 100, stone: 100, iron: 600, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3, herreria: 3 }, technologyRequirements: ["tech_civ_japoneses"], civilizationRequirement: "japoneses", effect: { key: "unitEfficiencyInf", value: 0.08, description: "Eficacia de infantería +8 %" } },
  { id: "tech_civ_japoneses_c", name: "Shogunato", branch: "civilizacion", universityLevel: 5, costs: { gold: 2000, wood: 500, stone: 500, iron: 800, food: 0 }, durationSeconds: 900, buildingRequirements: { castillo: 6 }, technologyRequirements: ["tech_civ_japoneses_a", "tech_civ_japoneses_b"], civilizationRequirement: "japoneses", effect: { key: "combatAttack", value: 0.10, description: "+10 % ataque militar" } },
  // Navajos
  { id: "tech_civ_navajos_a", name: "Sabiduría del coyote", branch: "civilizacion", universityLevel: 3, costs: { gold: 400, wood: 200, stone: 100, iron: 50, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_navajos"], civilizationRequirement: "navajos", effect: { key: "espionageAccuracy", value: 1, description: "Mejora del espionaje" } },
  { id: "tech_civ_navajos_b", name: "Tejedores de sueños", branch: "civilizacion", universityLevel: 3, costs: { gold: 400, wood: 400, stone: 100, iron: 20, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_navajos"], civilizationRequirement: "navajos", effect: { key: "happinessBase", value: 4, description: "+4 felicidad base" } },
  { id: "tech_civ_navajos_c", name: "El Gran Camino del Bosque", branch: "civilizacion", universityLevel: 5, costs: { gold: 1400, wood: 900, stone: 400, iron: 100, food: 0 }, durationSeconds: 900, buildingRequirements: { castillo: 6 }, technologyRequirements: ["tech_civ_navajos_a", "tech_civ_navajos_b"], civilizationRequirement: "navajos", effect: { key: "marchSpeed", value: 0.12, description: "+12 % velocidad de marcha" } },
  // Aztecas
  { id: "tech_civ_aztecas_a", name: "Sacrificios rituales", branch: "civilizacion", universityLevel: 3, costs: { gold: 400, wood: 200, stone: 300, iron: 20, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3, iglesia: 3 }, technologyRequirements: ["tech_civ_aztecas"], civilizationRequirement: "aztecas", effect: { key: "moraleBase", value: 5, description: "Moral militar +5 puntos" } },
  { id: "tech_civ_aztecas_b", name: "Guerreros Jaguar y Águila", branch: "civilizacion", universityLevel: 3, costs: { gold: 500, wood: 200, stone: 100, iron: 100, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3, cuartel: 3 }, technologyRequirements: ["tech_civ_aztecas"], civilizationRequirement: "aztecas", effect: { key: "unitEfficiencyInf", value: 0.10, description: "Eficacia de infantería +10 %" } },
  { id: "tech_civ_aztecas_c", name: "Imperio de la Triple Alianza", branch: "civilizacion", universityLevel: 5, costs: { gold: 1600, wood: 500, stone: 500, iron: 200, food: 0 }, durationSeconds: 900, buildingRequirements: { castillo: 6 }, technologyRequirements: ["tech_civ_aztecas_a", "tech_civ_aztecas_b"], civilizationRequirement: "aztecas", effect: { key: "goldProduction", value: 0.15, description: "+15 % producción de oro" } },
  // Masáis
  { id: "tech_civ_masais_a", name: "Guerreros Morani", branch: "civilizacion", universityLevel: 3, costs: { gold: 400, wood: 200, stone: 100, iron: 50, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3, cuartel: 3 }, technologyRequirements: ["tech_civ_masais"], civilizationRequirement: "masais", effect: { key: "unitEfficiencyInf", value: 0.10, description: "Eficacia de infantería +10 %" } },
  { id: "tech_civ_masais_b", name: "Ganadería trashumante", branch: "civilizacion", universityLevel: 3, costs: { gold: 300, wood: 400, stone: 100, iron: 20, food: 0 }, durationSeconds: 480, buildingRequirements: { castillo: 3 }, technologyRequirements: ["tech_civ_masais"], civilizationRequirement: "masais", effect: { key: "foodConsumption", value: -0.06, description: "Consumo de alimentos −6 %" } },
  { id: "tech_civ_masais_c", name: "El Gran Salto", branch: "civilizacion", universityLevel: 5, costs: { gold: 1200, wood: 600, stone: 400, iron: 100, food: 0 }, durationSeconds: 900, buildingRequirements: { castillo: 6 }, technologyRequirements: ["tech_civ_masais_a", "tech_civ_masais_b"], civilizationRequirement: "masais", effect: { key: "moraleBase", value: 6, description: "Moral militar +6 puntos" } },
];
// NOTA: form_1-7, forge_1, forge_6 aplazados y sin implementar (efectos formationEfficiency/equipmentWear inexistentes en el motor).


export const RESEARCH = {
  /** [COMPLEMENTO §4, actualizado 03-11-2026] Una investigación activa por reino fijada a 1 por decisión. */
  BASE_SLOTS: 1,
  MAX_SLOTS: 1,
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
/** [DERIVADO de P41/D-24/R-14] Terrenos y modificadores de marcha y economía. */
export const TERRAINS: Readonly<Record<TerrainType, TerrainBalance>> = {
  llanura: { label: "Llanura", production: { agriculture: 0.1 }, defense: 0, commerce: 0, marchMultiplier: 1.0 },
  rio: { label: "Río", production: { agriculture: 0.1 }, defense: 0, commerce: 0, marchMultiplier: 1.10 },
  costa: { label: "Costa", production: {}, defense: 0, commerce: 0.1, marchMultiplier: 1.10 },
  bosque: { label: "Bosque", production: { wood: 0.15 }, defense: 0, commerce: 0, marchMultiplier: 1.20 },
  colina: { label: "Colina", production: { stone: 0.1 }, defense: 0, commerce: 0, marchMultiplier: 1.25 },
  montana: { label: "Montaña", production: { iron: 0.15 }, defense: 0.1, commerce: 0, marchMultiplier: 1.50 },
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

export const MARCH = {
  /** Límites de duración de marcha entre reinos en segundos reales (1 día real = 1 año de juego). */
  MIN_DURATION_SECONDS: 900, // 15 minutos reales (~3,8 días de juego)
  MAX_DURATION_SECONDS: 43_200, // 12 horas reales (0,5 años = 6 meses de juego)
  /** Ventana de preparación previa al combate (20 % de la duración de marcha, acotada entre 15 min y 1 h). */
  PREP_WINDOW_RATIO: 0.20,
  MIN_PREP_SECONDS: 900,
  MAX_PREP_SECONDS: 3_600,
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
    errorByLevel: { 0: 0.25, 1: 0.15, 2: 0.07, 3: 0.03, 4: 0 } as Readonly<Record<number, number>>,
    costByLevel: { 1: 100, 2: 250, 3: 500, 4: 1000 } as Readonly<Record<number, number>>,
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
      storageCapacityMultiplier: 1.10,
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
      trainingDurationByUnit: { asedio: 1.1 },
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
      combatDefenseMultiplier: 0.95,
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
    weapons: {
      palo: "Arco de piñón y vara de caza",
      lanzaBasica: "Lanza Diné de punta de piedra",
      espadaHierro: "Arco compuesto de madera y tendón",
      acero: "Arco de caza reforzado y cuchillo",
      aceroAvanzado: "Arco Diné de guerra y cuchillo de sílex",
    },
    armors: {
      ninguna: "Sin protección",
      piel: "Túnica de piel de ciervo",
      cueroReforzado: "Cuero de bisonte endurecido",
      hierro: "Cuero de bisonte multicapa y escudo de cuero crudo",
      acero: "Vestimenta militar Diné con escudo de cuero crudo reforzado",
    },
    uniqueBuilding: { buildingType: "taberna", name: "Hogar de rastreadores", description: "Taberna navaja: lugar de descanso para exploradores y tiradores." },
    signatureUnit: { unitType: "infanteria", name: "Rastreador Diné", description: "Infantería ligera con arco y flechas especialista en terreno boscoso." },
    unitNames: { infanteria: "Rastreador Diné", arqueria: "Arquero Navajo", caballeria: "Jinete explorador", asedio: "Cuadrilla de asalto" },
  },
  aztecas: {
    weapons: {
      palo: "Bastón de guerra (Cuauhololli)",
      lanzaBasica: "Lanza de obsidiana (Tepoztopilli)",
      espadaHierro: "Espada de obsidiana (Macuahuitl)",
      acero: "Macuahuitl pesado de combate",
      aceroAvanzado: "Macuahuitl de élite con hojas de obsidiana",
    },
    armors: {
      ninguna: "Sin protección",
      piel: "Protección acolchada de algodón (Ichcahuipilli ligero)",
      cueroReforzado: "Ichcahuipilli denso de capa doble",
      hierro: "Indumentaria militar (Tlahuiztli) con escudo Chimalli",
      acero: "Tlahuiztli de guerrero de élite con escudo Chimalli",
    },
    uniqueBuilding: { buildingType: "iglesia", name: "Templo Mayor", description: "Iglesia mexica: gran templo ceremonial y escalonado de Tenochtitlan." },
    signatureUnit: { unitType: "infanteria", name: "Guerrero Águila", description: "Infantería de élite; sin caballos ni acero europeo." },
    unitNames: { infanteria: "Guerrero Águila", arqueria: "Atlatl y honderos", caballeria: "Guerrero Jaguar (élite a pie)", asedio: "Cuadrilla de asalto" },
  },
  masais: {
    weapons: {
      palo: "Rungu de madera de acacia",
      lanzaBasica: "Lanza masái de hoja estrecha (Ol-alem)",
      espadaHierro: "Seme (espada corta tradicional)",
      acero: "Lanza masái de hierro de hoja ancha",
      aceroAvanzado: "Panoplia Il-Moran: Lanza de hierro reforzada y Seme",
    },
    armors: {
      ninguna: "Sin protección",
      piel: "Manta Shúkà de algodón",
      cueroReforzado: "Vestimenta de cuero y pintura ceremonial",
      hierro: "Manta Shúkà con escudo de piel de búfalo (El-longo)",
      acero: "Atavío de combate Il-Moran con escudo El-longo de búfalo",
    },
    uniqueBuilding: { buildingType: "viviendas", name: "Boma", description: "Viviendas masáis: recinto fortificado para el ganado y la familia." },
    signatureUnit: { unitType: "infanteria", name: "Guerrero Moran", description: "Infantería tradicional masái con gran resistencia a la fatiga." },
    unitNames: { infanteria: "Guerrero Moran", arqueria: "Arquero masái", caballeria: "Jinete de la sabana", asedio: "Ariete ligero" },
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
