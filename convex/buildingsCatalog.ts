/**
 * LA CONQUISTA — CATÁLOGO CENTRALIZADO DE EDIFICIOS Y PROGRESIÓN (OFICIAL)
 * 
 * Reglas de la Especificación Maestra y Acuerdos:
 * - Nivel máximo de edificios: 100 (OFICIAL)
 * - Duración base incrementada en aprox. 1% por nivel superior:
 *   duración = Math.round(baseDuration * (1 + 0.01 * (targetLevel - 1)))
 * - Requisitos de progresión:
 *   * El Castillo es el eje de gobierno; ningún edificio puede superar el nivel del Castillo.
 *   * Cuarteles requieren Castillo nivel 1.
 *   * Mina de Hierro requiere Cantera nivel 1.
 *   * Herrería requiere Cuartel nivel 1 y Mina de Hierro nivel 1.
 *   * Universidad requiere Castillo nivel 2.
 *   * Parlamento requiere Castillo nivel 2.
 * - Si falta un dato oficial, bloquear la acción y documentar qué parámetro falta.
 */

import { type KingdomResources } from "./economyCalculations";

export type BuildingType =
  | "castillo"
  | "viviendas"
  | "granja"
  | "aserradero"
  | "cantera"
  | "minaHierro"
  | "cuartel"
  | "herreria"
  | "universidad"
  | "murallas"
  | "mercado"
  | "parlamento";

export type BuildingCategory =
  | "governance"
  | "residential"
  | "production"
  | "military"
  | "research"
  | "defense"
  | "economy"
  | "diplomacy";

export interface BuildingPrerequisite {
  buildingType: BuildingType;
  minLevel: number;
  description: string;
}

export interface BuildingDefinition {
  type: BuildingType;
  name: string;
  category: BuildingCategory;
  emoji: string;
  description: string;
  baseCost: KingdomResources;
  baseDurationSeconds: number; // Duración base para nivel 1
  maxLevel: number; // 100
  prerequisites: BuildingPrerequisite[];
  capacityType?: "residential" | "workers";
  jobType?: "agriculture" | "wood" | "stone" | "iron";
  baseCapacityPerLevel: number;
  isFullyDefined: boolean;
  missingParameters?: string[];
}

export const MAX_BUILDING_LEVEL = 100;
export const MAX_SIMULTANEOUS_CONSTRUCTIONS = 2;
export const CANCEL_REFUND_PERCENTAGE = 0.5; // 50% de devolución al cancelar

/**
 * Catálogo maestro de edificios conocidos
 */
export const BUILDINGS_CATALOG: Record<BuildingType, BuildingDefinition> = {
  castillo: {
    type: "castillo",
    name: "Castillo",
    category: "governance",
    emoji: "🏰",
    description: "Sede del poder real y bastión del reino. Su nivel determina el límite superior de los demás edificios.",
    baseCost: { gold: 200, wood: 500, stone: 500, iron: 100, food: 0 },
    baseDurationSeconds: 3600, // 1 hora base
    maxLevel: MAX_BUILDING_LEVEL,
    prerequisites: [],
    baseCapacityPerLevel: 0,
    isFullyDefined: true,
  },
  viviendas: {
    type: "viviendas",
    name: "Viviendas",
    category: "residential",
    emoji: "🏡",
    description: "Casas y barrios comunales para alojar a la población civil y trabajadora. Determina la capacidad residencial.",
    baseCost: { gold: 50, wood: 200, stone: 150, iron: 0, food: 0 },
    baseDurationSeconds: 1800, // 30 min base
    maxLevel: MAX_BUILDING_LEVEL,
    prerequisites: [
      { buildingType: "castillo", minLevel: 1, description: "Requiere Castillo nivel 1" },
    ],
    capacityType: "residential",
    baseCapacityPerLevel: 2500, // Nivel 1 aloja 2500 habitantes (satisface censo inicial de 2000), +500 por nivel posterior
    isFullyDefined: true,
  },
  granja: {
    type: "granja",
    name: "Granja",
    category: "production",
    emoji: "🌾",
    description: "Campos de cultivo y eras para la producción agrícola. Determina la capacidad máxima de agricultores en faena.",
    baseCost: { gold: 30, wood: 150, stone: 50, iron: 0, food: 100 },
    baseDurationSeconds: 1200, // 20 min base
    maxLevel: MAX_BUILDING_LEVEL,
    prerequisites: [
      { buildingType: "castillo", minLevel: 1, description: "Requiere Castillo nivel 1" },
    ],
    capacityType: "workers",
    jobType: "agriculture",
    baseCapacityPerLevel: 1200, // Nivel 1 da capacidad para 1.200 agricultores (cubre los 1.100 iniciales)
    isFullyDefined: true,
  },
  aserradero: {
    type: "aserradero",
    name: "Aserradero",
    category: "production",
    emoji: "🪵",
    description: "Explotación forestal y bancos de corte. Determina la capacidad de trabajadores en tala y madera.",
    baseCost: { gold: 40, wood: 100, stone: 100, iron: 20, food: 0 },
    baseDurationSeconds: 1200, // 20 min base
    maxLevel: MAX_BUILDING_LEVEL,
    prerequisites: [
      { buildingType: "castillo", minLevel: 1, description: "Requiere Castillo nivel 1" },
    ],
    capacityType: "workers",
    jobType: "wood",
    baseCapacityPerLevel: 300, // Nivel 1 da capacidad para 300 leñadores (cubre los 250 iniciales)
    isFullyDefined: true,
  },
  cantera: {
    type: "cantera",
    name: "Cantera",
    category: "production",
    emoji: "⛏️",
    description: "Extracción y desbaste de piedra para murallas y obras. Determina la capacidad de peones de cantera.",
    baseCost: { gold: 40, wood: 150, stone: 50, iron: 30, food: 0 },
    baseDurationSeconds: 1500, // 25 min base
    maxLevel: MAX_BUILDING_LEVEL,
    prerequisites: [
      { buildingType: "castillo", minLevel: 1, description: "Requiere Castillo nivel 1" },
    ],
    capacityType: "workers",
    jobType: "stone",
    baseCapacityPerLevel: 300, // Nivel 1 da capacidad para 300 canteros (cubre los 250 iniciales)
    isFullyDefined: true,
  },
  minaHierro: {
    type: "minaHierro",
    name: "Mina de Hierro",
    category: "production",
    emoji: "⛓️",
    description: "Pozos y galerías para extracción de mineral de hierro. Determina la capacidad de mineros de hierro.",
    baseCost: { gold: 80, wood: 250, stone: 200, iron: 0, food: 0 },
    baseDurationSeconds: 1800, // 30 min base
    maxLevel: MAX_BUILDING_LEVEL,
    prerequisites: [
      { buildingType: "cantera", minLevel: 1, description: "Requiere Cantera nivel 1" },
    ],
    capacityType: "workers",
    jobType: "iron",
    baseCapacityPerLevel: 150, // Nivel 1 da capacidad para 150 mineros (cubre los 100 iniciales)
    isFullyDefined: true,
  },
  cuartel: {
    type: "cuartel",
    name: "Cuartel",
    category: "military",
    emoji: "⚔️",
    description: "Instalación para acuartelamiento e instrucción de soldados regulares y guardias del reino.",
    baseCost: { gold: 150, wood: 300, stone: 250, iron: 100, food: 0 },
    baseDurationSeconds: 2400, // 40 min base
    maxLevel: MAX_BUILDING_LEVEL,
    prerequisites: [
      { buildingType: "castillo", minLevel: 1, description: "Requiere Castillo nivel 1" },
    ],
    baseCapacityPerLevel: 200,
    isFullyDefined: true,
  },
  herreria: {
    type: "herreria",
    name: "Herrería",
    category: "military",
    emoji: "🔨",
    description: "Forja y talleres para fabricar armamento, cotas de malla y herrajes para las tropas.",
    baseCost: { gold: 120, wood: 200, stone: 300, iron: 150, food: 0 },
    baseDurationSeconds: 2400, // 40 min base
    maxLevel: MAX_BUILDING_LEVEL,
    prerequisites: [
      { buildingType: "minaHierro", minLevel: 1, description: "Requiere Mina de Hierro nivel 1" },
      { buildingType: "cuartel", minLevel: 1, description: "Requiere Cuartel nivel 1" },
    ],
    baseCapacityPerLevel: 0,
    isFullyDefined: true,
  },
  universidad: {
    type: "universidad",
    name: "Universidad",
    category: "research",
    emoji: "🏛️",
    description: "Centro de estudio y claustro de sabios. Habilita investigaciones y desarrollo de tecnologías.",
    baseCost: { gold: 300, wood: 400, stone: 400, iron: 50, food: 0 },
    baseDurationSeconds: 3600, // 60 min base
    maxLevel: MAX_BUILDING_LEVEL,
    prerequisites: [
      { buildingType: "castillo", minLevel: 2, description: "Requiere Castillo nivel 2" },
    ],
    baseCapacityPerLevel: 0,
    isFullyDefined: true,
  },
  murallas: {
    type: "murallas",
    name: "Murallas",
    category: "defense",
    emoji: "🧱",
    description: "Muros defensivos de sillería y almenas para proteger el asentamiento de incursiones y asedios.",
    baseCost: { gold: 50, wood: 100, stone: 500, iron: 50, food: 0 },
    baseDurationSeconds: 2700, // 45 min base
    maxLevel: MAX_BUILDING_LEVEL,
    prerequisites: [
      { buildingType: "cantera", minLevel: 1, description: "Requiere Cantera nivel 1" },
    ],
    baseCapacityPerLevel: 0,
    isFullyDefined: true,
  },
  mercado: {
    type: "mercado",
    name: "Mercado",
    category: "economy",
    emoji: "⚖️",
    description: "Plaza de comercio y aduana municipal para intercambio de excedentes y transacciones del reino.",
    baseCost: { gold: 200, wood: 300, stone: 200, iron: 0, food: 100 },
    baseDurationSeconds: 1800, // 30 min base
    maxLevel: MAX_BUILDING_LEVEL,
    prerequisites: [
      { buildingType: "castillo", minLevel: 1, description: "Requiere Castillo nivel 1" },
    ],
    baseCapacityPerLevel: 0,
    isFullyDefined: true,
  },
  parlamento: {
    type: "parlamento",
    name: "Parlamento",
    category: "diplomacy",
    emoji: "📜",
    description: "Asamblea estamental de embajadores y nobles para formalizar desafíos PvP y tratados diplomáticos.",
    baseCost: { gold: 350, wood: 400, stone: 500, iron: 100, food: 0 },
    baseDurationSeconds: 3600, // 60 min base
    maxLevel: MAX_BUILDING_LEVEL,
    prerequisites: [
      { buildingType: "castillo", minLevel: 2, description: "Requiere Castillo nivel 2" },
    ],
    baseCapacityPerLevel: 0,
    isFullyDefined: true,
  },
};

/**
 * Obtiene la definición de un edificio.
 */
export function getBuildingDefinition(type: string): BuildingDefinition | null {
  return (BUILDINGS_CATALOG as Record<string, BuildingDefinition>)[type] ?? null;
}

/**
 * Duración oficial de construcción:
 * "Cada nivel superior incrementa aproximadamente un 1 % el tiempo de construcción,
 * aplicado sobre la duración base correspondiente."
 */
export function calculateConstructionDuration(buildingType: string, targetLevel: number): number {
  const def = getBuildingDefinition(buildingType);
  if (!def) {
    throw new Error(`Edificio desconocido: '${buildingType}'.`);
  }
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > MAX_BUILDING_LEVEL) {
    throw new Error(`Nivel objetivo inválido: ${targetLevel}. Debe estar entre 1 y ${MAX_BUILDING_LEVEL}.`);
  }

  // Incremento del 1% por cada nivel por encima del nivel 1
  const levelFactor = 1 + 0.01 * (targetLevel - 1);
  return Math.round(def.baseDurationSeconds * levelFactor);
}

/**
 * Coste oficial de subida de nivel:
 * Escala con el nivel objetivo: baseCost * (1 + 0.15 * (targetLevel - 1))
 */
export function calculateUpgradeCost(buildingType: string, targetLevel: number): KingdomResources {
  const def = getBuildingDefinition(buildingType);
  if (!def) {
    throw new Error(`Edificio desconocido: '${buildingType}'.`);
  }
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > MAX_BUILDING_LEVEL) {
    throw new Error(`Nivel objetivo inválido: ${targetLevel}. Debe estar entre 1 y ${MAX_BUILDING_LEVEL}.`);
  }

  const multiplier = 1 + 0.15 * (targetLevel - 1);

  return {
    gold: Math.round(def.baseCost.gold * multiplier),
    wood: Math.round(def.baseCost.wood * multiplier),
    stone: Math.round(def.baseCost.stone * multiplier),
    iron: Math.round(def.baseCost.iron * multiplier),
    food: Math.round(def.baseCost.food * multiplier),
  };
}

/**
 * Comprueba si los recursos actuales son suficientes para pagar el coste.
 */
export function hasSufficientResources(
  available: KingdomResources,
  cost: KingdomResources
): { sufficient: boolean; deficits: Partial<Record<keyof KingdomResources, number>> } {
  const deficits: Partial<Record<keyof KingdomResources, number>> = {};
  let sufficient = true;

  const resTypes: (keyof KingdomResources)[] = ["gold", "wood", "stone", "iron", "food"];
  for (const res of resTypes) {
    const avail = available[res] ?? 0;
    const req = cost[res] ?? 0;
    if (avail < req) {
      sufficient = false;
      deficits[res] = req - avail;
    }
  }

  return { sufficient, deficits };
}

/**
 * Valida los requisitos y precondiciones de progresión para iniciar una construcción.
 */
export function validateBuildingProgression(
  buildingType: string,
  currentLevel: number,
  targetLevel: number,
  existingBuildingLevels: Record<string, number>
): { valid: boolean; error?: string; missingParameter?: string } {
  const def = getBuildingDefinition(buildingType);
  if (!def) {
    return {
      valid: false,
      error: `Edificio '${buildingType}' no catalogado en las especificaciones del juego.`,
    };
  }

  // 1. Verificar si faltan parámetros oficiales
  if (!def.isFullyDefined) {
    const missing = def.missingParameters?.join(", ") ?? "parámetros oficiales no definidos";
    return {
      valid: false,
      error: `Construcción bloqueada: faltan parámetros oficiales (${missing}).`,
      missingParameter: missing,
    };
  }

  // 2. Verificar nivel máximo oficial (100)
  if (targetLevel > MAX_BUILDING_LEVEL) {
    return {
      valid: false,
      error: `Nivel máximo alcanzado: '${def.name}' no puede superar el nivel ${MAX_BUILDING_LEVEL}.`,
    };
  }

  // 3. Progresión secuencial (debe ser currentLevel + 1)
  if (targetLevel !== currentLevel + 1) {
    return {
      valid: false,
      error: `Progresión no secuencial: se intenta subir '${def.name}' de nivel ${currentLevel} a ${targetLevel} (debe ser ${currentLevel + 1}).`,
    };
  }

  // 4. Regla del Castillo: Ningún edificio puede superar el nivel del Castillo (salvo el propio Castillo)
  if (buildingType !== "castillo") {
    const castilloLevel = existingBuildingLevels["castillo"] ?? 1;
    if (targetLevel > castilloLevel) {
      return {
        valid: false,
        error: `Requisito de gobierno: '${def.name}' nivel ${targetLevel} requiere que el Castillo sea al menos de nivel ${targetLevel} (Castillo actual: nivel ${castilloLevel}).`,
      };
    }
  }

  // 5. Requisitos específicos de la definición
  for (const prereq of def.prerequisites) {
    const actualLevel = existingBuildingLevels[prereq.buildingType] ?? 0;
    if (actualLevel < prereq.minLevel) {
      const prereqDef = getBuildingDefinition(prereq.buildingType);
      const prereqName = prereqDef ? prereqDef.name : prereq.buildingType;
      return {
        valid: false,
        error: `Requisito no cumplido: '${def.name}' requiere ${prereqName} nivel ${prereq.minLevel} (actual: nivel ${actualLevel}).`,
      };
    }
  }

  return { valid: true };
}

/**
 * Calcula la capacidad habitacional residencial según el nivel de viviendas.
 */
export function calculateResidentialCapacity(viviendasLevel: number): number {
  if (viviendasLevel <= 0) return 2000; // Censo base protegido
  // Nivel 1 = 2500 plazas. Cada nivel adicional añade 500 plazas.
  return 2500 + (viviendasLevel - 1) * 500;
}

/**
 * Calcula la capacidad máxima de trabajadores para un oficio según el nivel del edificio correspondiente.
 */
export function calculateWorkerCapacity(
  buildingType: "granja" | "aserradero" | "cantera" | "minaHierro",
  level: number
): number {
  const def = getBuildingDefinition(buildingType);
  if (!def || level <= 0) return 0;
  return def.baseCapacityPerLevel * level;
}
