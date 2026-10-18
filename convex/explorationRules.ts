/**
 * LA CONQUISTA — REGLAS PURAS DE EXPLORACIÓN DEL MAPA (P22, P49)
 * Control de visibilidad, niebla de guerra, costes de marcha, asignación de exploradores
 * y descubrimientos territoriales deterministas. Sin acceso directo a base de datos.
 */
import { EXPLORATION, MAP, TERRAINS, type TerrainType } from "./balanceConfig";
import {
  cellId,
  hexDistance,
  hexNeighbors,
  isInsideWorld,
  type HexCoord,
  type WorldCell,
} from "./territoryRules";

export type CellExplorationState = "owned" | "explored" | "exploring" | "fog";

export interface ExplorationCosts {
  gold: number;
  food: number;
}

export interface ExplorationPlan {
  distance: number;
  durationSeconds: number;
  durationMs: number;
  costs: ExplorationCosts;
  scoutsRequired: number;
}

export interface ExplorationDiscovery {
  description: string;
  isFreeTerritory: boolean;
  ownerKingdomName: string | null;
  resourceReward?: {
    resource: "gold" | "wood" | "stone" | "iron" | "food";
    amount: number;
  };
}

/**
 * [P22] Calcula el conjunto de celdas inicialmente conocidas alrededor del territorio principal.
 * Incluye la capital y sus vecinos inmediatos (radio 1 = 7 hexágonos en total).
 */
export function getInitialSightCellIds(
  homeCoord: HexCoord | null,
  sightRadius: number = EXPLORATION.INITIAL_SIGHT_RADIUS,
  worldRadius: number = MAP.RADIUS
): string[] {
  if (!homeCoord) return [];
  const result: string[] = [];
  for (let q = -sightRadius; q <= sightRadius; q++) {
    for (let r = Math.max(-sightRadius, -q - sightRadius); r <= Math.min(sightRadius, -q + sightRadius); r++) {
      const coord: HexCoord = { q: homeCoord.q + q, r: homeCoord.r + r };
      if (isInsideWorld(coord, worldRadius)) {
        result.push(cellId(coord.q, coord.r));
      }
    }
  }
  return result;
}

/**
 * Valida si una celda puede ser explorada por el reino.
 * Exige:
 * 1. Estar dentro del mundo.
 * 2. No estar ya poseída ni explorada.
 * 3. No tener ya una expedición en camino.
 * 4. No exceder el límite de expediciones activas.
 * 5. Adyacencia: debe limitar con al menos una celda ya conocida/poseída (expansión de frontera).
 * 6. Disponer de población civil libre y recursos suficientes.
 */
export function canStartExploration(input: {
  targetCoord: HexCoord;
  targetCellId: string;
  knownCellIds: ReadonlySet<string>;
  activeCellIds: ReadonlySet<string>;
  ownedCoords: ReadonlyArray<HexCoord>;
  availableCivil: number;
  currentResources: { gold: number; food: number };
  activeExpeditionsCount: number;
  worldRadius?: number;
}): { success: true; plan: ExplorationPlan } | { success: false; error: string } {
  const worldRadius = input.worldRadius ?? MAP.RADIUS;

  if (!isInsideWorld(input.targetCoord, worldRadius)) {
    return { success: false, error: "La celda seleccionada está fuera de los límites del mapa conocido." };
  }

  if (input.knownCellIds.has(input.targetCellId)) {
    return { success: false, error: "Este territorio ya ha sido explorado y cartografiado por tu reino." };
  }

  if (input.activeCellIds.has(input.targetCellId)) {
    return { success: false, error: "Ya hay una expedición de exploración en camino hacia esta celda." };
  }

  if (input.activeExpeditionsCount >= EXPLORATION.MAX_CONCURRENT_EXPEDITIONS) {
    return {
      success: false,
      error: `Ya tienes el máximo de expediciones de exploración activas (${EXPLORATION.MAX_CONCURRENT_EXPEDITIONS}). Espera a que concluya o cancélala.`,
    };
  }

  // Comprobar adyacencia a territorios conocidos (expansión desde las fronteras)
  const neighbors = hexNeighbors(input.targetCoord, worldRadius);
  const bordersKnown = neighbors.some((n) => input.knownCellIds.has(cellId(n.q, n.r)));
  if (!bordersKnown) {
    return {
      success: false,
      error: "Para enviar una expedición, la celda debe limitar con un territorio ya conocido o poseído por tu reino.",
    };
  }

  // Cálculo de distancia al territorio propio más cercano
  let distance = 1;
  if (input.ownedCoords.length > 0) {
    distance = Math.max(1, Math.min(...input.ownedCoords.map((c) => hexDistance(c, input.targetCoord))));
  }

  // Duración canónica basada en tiempo de marcha (D-26 / Complemento §5)
  const durationSeconds = Math.max(600, distance * EXPLORATION.SECONDS_PER_HEX);
  const durationMs = durationSeconds * 1000;

  // Costes de aprovisionamiento
  const costs: ExplorationCosts = {
    gold: EXPLORATION.BASE_COSTS.gold,
    food: EXPLORATION.BASE_COSTS.food,
  };

  if (input.availableCivil < EXPLORATION.SCOUTS_REQUIRED) {
    return {
      success: false,
      error: `Se requiere al menos ${EXPLORATION.SCOUTS_REQUIRED} ciudadano libre para formar la partida de exploradores (disponibles: ${input.availableCivil}).`,
    };
  }

  if (input.currentResources.gold < costs.gold) {
    return {
      success: false,
      error: `Oro insuficiente: se requieren ${costs.gold} monedas y dispones de ${Math.floor(input.currentResources.gold)}.`,
    };
  }

  if (input.currentResources.food < costs.food) {
    return {
      success: false,
      error: `Alimentos insuficientes: se requieren ${costs.food} raciones para aprovisionar la expedición y dispones de ${Math.floor(input.currentResources.food)}.`,
    };
  }

  return {
    success: true,
    plan: {
      distance,
      durationSeconds,
      durationMs,
      costs,
      scoutsRequired: EXPLORATION.SCOUTS_REQUIRED,
    },
  };
}

/** Progreso de exploración acotado entre 0 % y 100 %. */
export function explorationProgress(startedAt: number, durationMs: number, nowMs: number): number {
  if (durationMs <= 0) return 100;
  const elapsed = nowMs - startedAt;
  if (elapsed <= 0) return 0;
  if (elapsed >= durationMs) return 100;
  return Math.min(100, Math.floor((elapsed / durationMs) * 100));
}

/** Reembolso al cancelar expedición en marcha (50 % según regla D-04 / D-21). */
export function calculateExplorationRefund(costs: ExplorationCosts): ExplorationCosts {
  return {
    gold: Math.floor(costs.gold * EXPLORATION.CANCELLATION_REFUND_RATIO),
    food: Math.floor(costs.food * EXPLORATION.CANCELLATION_REFUND_RATIO),
  };
}

/**
 * Genera el hallazgo o recompensa de descubrimiento de forma determinista y coherente con el terreno.
 */
export function generateExplorationDiscovery(
  cell: WorldCell,
  ownerKingdomName?: string | null
): ExplorationDiscovery {
  const terrainInfo = TERRAINS[cell.terrain as TerrainType];
  const terrainLabel = terrainInfo?.label ?? cell.terrain;

  if (ownerKingdomName) {
    return {
      description: `Los exploradores han avistado asentamientos del reino soberano ${ownerKingdomName} en este territorio (${terrainLabel}).`,
      isFreeTerritory: false,
      ownerKingdomName,
    };
  }

  // Territorio libre (P49): recompensa inicial moderada de reconocimiento
  let reward: ExplorationDiscovery["resourceReward"];
  let note = `Tierras libres descubiertas y cartografiadas en ${cell.cellId} (${terrainLabel}).`;

  switch (cell.terrain) {
    case "llanura":
      reward = { resource: "food", amount: 50 };
      note += " Los exploradores recolectaron 50 raciones de grano silvestre.";
      break;
    case "bosque":
      reward = { resource: "wood", amount: 50 };
      note += " Se talaron y transportaron 50 haces de madera de calidad.";
      break;
    case "colina":
      reward = { resource: "stone", amount: 50 };
      note += " Se localizaron canteras superficiales (+50 bloques de piedra).";
      break;
    case "montana":
      reward = { resource: "iron", amount: 40 };
      note += " Se detectaron afloramientos minerales ricos en hierro (+40 lingotes).";
      break;
    case "rio":
      reward = { resource: "food", amount: 50 };
      note += " Ribera fluvial con abundante pesca cartografiada (+50 alimentos).";
      break;
    case "costa":
      reward = { resource: "gold", amount: 30 };
      note += " Rutas marítimas y perlas de costa identificadas (+30 oro).";
      break;
    default:
      reward = { resource: "food", amount: 30 };
      break;
  }

  return {
    description: note,
    isFreeTerritory: true,
    ownerKingdomName: null,
    resourceReward: reward,
  };
}
