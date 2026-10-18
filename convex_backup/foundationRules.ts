/**
 * LA CONQUISTA — REGLAS CANÓNICAS DE FUNDACIÓN DE REINOS (P5–P10)
 * 
 * Reglas de la Especificación Maestra:
 * - P5: Registro y nombre del monarca.
 * - P6: Elección de civilización entre las 12 iniciales oficiales.
 * - P7: Nombramiento del reino (asociado permanentemente a la partida).
 * - P8: Nombramiento del castillo (centro administrativo del reino).
 * - P9: Confirmación y fundación ("FUNDAR MI REINO").
 * - P10: Censo inicial obligatorio de exactamente 2.000 habitantes.
 * - Protección total del reino de demostración Iberia.
 */

import { isValidCivilization, getCivilizationById } from "./civilizations";
import { INITIAL_KINGDOM_CONFIG } from "./economyCalculations";

export interface FoundationInput {
  civilization: string;
  kingdomName: string;
  castleName: string;
  monarchName?: string;
}

export interface ValidatedFoundationData {
  civilization: string;
  civilizationName: string;
  kingdomName: string;
  castleName: string;
  monarchName: string;
}

export const RESERVED_KINGDOM_NAMES = [
  "iberia",
  "reino de iberia",
  "demo",
  "admin",
  "administrador",
  "soberano de iberia",
] as const;

export function validateKingdomFoundationInput(
  input: FoundationInput,
  defaultMonarchName: string = "Soberano"
): { valid: true; data: ValidatedFoundationData } | { valid: false; error: string } {
  // 1. Validación de Civilización (P6)
  if (!input.civilization || typeof input.civilization !== "string") {
    return { valid: false, error: "Es obligatorio seleccionar una civilización de origen (P6)." };
  }
  const civDef = getCivilizationById(input.civilization);
  if (!civDef || !isValidCivilization(input.civilization)) {
    return {
      valid: false,
      error: `Civilización no admitida: '${input.civilization}'. Debe ser una de las 12 civilizaciones oficiales (P6).`,
    };
  }

  // 2. Validación de Nombre del Reino (P7)
  if (!input.kingdomName || typeof input.kingdomName !== "string") {
    return { valid: false, error: "Es obligatorio asignar un nombre al reino (P7)." };
  }
  const cleanKingdomName = input.kingdomName.trim();
  if (cleanKingdomName.length < 3 || cleanKingdomName.length > 40) {
    return {
      valid: false,
      error: `El nombre del reino debe contener entre 3 y 40 caracteres (recibido: ${cleanKingdomName.length}).`,
    };
  }

  // Protección del nombre reservado del reino de demostración
  const lowerName = cleanKingdomName.toLowerCase();
  if (RESERVED_KINGDOM_NAMES.some((reserved) => lowerName === reserved)) {
    return {
      valid: false,
      error: `El nombre '${cleanKingdomName}' es un dominio reservado del sistema y no puede ser fundado.`,
    };
  }

  // 3. Validación de Nombre del Castillo (P8)
  if (!input.castleName || typeof input.castleName !== "string") {
    return { valid: false, error: "Es obligatorio asignar un nombre al castillo capital (P8)." };
  }
  const cleanCastleName = input.castleName.trim();
  if (cleanCastleName.length < 3 || cleanCastleName.length > 40) {
    return {
      valid: false,
      error: `El nombre del castillo debe contener entre 3 y 40 caracteres (recibido: ${cleanCastleName.length}).`,
    };
  }

  // 4. Nombre del Monarca (P5)
  let cleanMonarchName = (input.monarchName || "").trim();
  if (!cleanMonarchName) {
    cleanMonarchName = (defaultMonarchName || "").trim() || "Soberano";
  }
  if (cleanMonarchName.length < 2 || cleanMonarchName.length > 40) {
    return {
      valid: false,
      error: `El nombre del monarca debe contener entre 2 y 40 caracteres (recibido: ${cleanMonarchName.length}).`,
    };
  }

  return {
    valid: true,
    data: {
      civilization: civDef.id,
      civilizationName: civDef.label,
      kingdomName: cleanKingdomName,
      castleName: cleanCastleName,
      monarchName: cleanMonarchName,
    },
  };
}

/**
 * Retorna la plantilla censal y económica inicial canónica aprobada (P10).
 */
export function getInitialKingdomSeed(validatedData: ValidatedFoundationData, now: number) {
  return {
    kingdomDoc: {
      name: validatedData.kingdomName,
      civilization: validatedData.civilization,
      castleName: validatedData.castleName,
      monarchName: validatedData.monarchName,
      taxPolicy: "normal",
      happiness: 100,
      militaryMorale: 100,
      population: INITIAL_KINGDOM_CONFIG.population, // 2.000 oficial (P10)
      regularSoldiers: INITIAL_KINGDOM_CONFIG.regularSoldiers, // 0 tropas iniciales
      workers: { ...INITIAL_KINGDOM_CONFIG.workers },
      unassignedCivil: INITIAL_KINGDOM_CONFIG.unassignedCivil, // 250 reserva libre
      resources: { ...INITIAL_KINGDOM_CONFIG.resources },
      foodTier: INITIAL_KINGDOM_CONFIG.foodTier, // "normal"
      createdAt: now,
      lastUpdated: now,
    },
    resourcesDoc: {
      gold: INITIAL_KINGDOM_CONFIG.resources.gold,
      wood: INITIAL_KINGDOM_CONFIG.resources.wood,
      stone: INITIAL_KINGDOM_CONFIG.resources.stone,
      iron: INITIAL_KINGDOM_CONFIG.resources.iron,
      food: INITIAL_KINGDOM_CONFIG.resources.food,
      lastUpdated: now,
      settlementInitialized: true,
    },
    populationDoc: {
      total: INITIAL_KINGDOM_CONFIG.population, // 2.000 oficial (P10)
      available: INITIAL_KINGDOM_CONFIG.unassignedCivil, // 250
      starving: false,
    },
    populationJobs: [
      { jobType: "agriculture", assignedCount: INITIAL_KINGDOM_CONFIG.workers.agriculture },
      { jobType: "wood", assignedCount: INITIAL_KINGDOM_CONFIG.workers.wood },
      { jobType: "stone", assignedCount: INITIAL_KINGDOM_CONFIG.workers.stone },
      { jobType: "iron", assignedCount: INITIAL_KINGDOM_CONFIG.workers.iron },
      { jobType: "gold", assignedCount: INITIAL_KINGDOM_CONFIG.workers.gold },
      { jobType: "other", assignedCount: INITIAL_KINGDOM_CONFIG.workers.other },
    ],
    initialBuildings: [
      { buildingType: "castillo", level: 1 },
    ],
  };
}
