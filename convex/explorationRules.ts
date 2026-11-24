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
import { applyCivilizationExploration } from "./civilizationRules";

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
 * [P22 / FASE 2] Fórmulas de costes progresivos de exploración según la distancia logística:
 * - Distancias 1 a 5: 30 oro, 40 alimentos (constante base)
 * - Distancias > 5: 5 × d + 5 oro, 10 × d - 10 alimentos
 */
export function calculateBaseExplorationCosts(distance: number): ExplorationCosts {
  const d = Math.max(1, distance);
  if (d <= 5) {
    return { gold: 30, food: 40 };
  }
  return {
    gold: 5 * d + 5,
    food: 10 * d - 10,
  };
}

export const MIN_EXPLORATION_DURATION_MS = EXPLORATION.MIN_DURATION_MS;

/**
 * Calcula la duración de exploración en milisegundos dividiendo por (1 + explorationSpeedBonus)
 * y respetando el mínimo global de exploración.
 */
export function calculateExplorationDurationMs(
  baseDurationMs: number,
  explorationSpeedBonus = 0
): number {
  const safeBaseDurationMs = Math.max(0, Number.isFinite(baseDurationMs) ? baseDurationMs : 0);
  const safeBonus = Math.max(0, Number.isFinite(explorationSpeedBonus) ? explorationSpeedBonus : 0);
  const explorationSpeedMultiplier = 1 + safeBonus;
  return Math.max(
    MIN_EXPLORATION_DURATION_MS,
    Math.ceil(safeBaseDurationMs / explorationSpeedMultiplier)
  );
}

/**
 * Fuente única de cálculo del plan de exploración (distancia, costes, bonificación cultural
 * y bonificación tecnológica centralizada explorationSpeedBonus).
 */
export function computeExplorationPlan(input: {
  distance: number;
  civilization?: string;
  explorationSpeedBonus?: number;
}): ExplorationPlan {
  const distance = Math.max(1, input.distance);
  const baseCosts = calculateBaseExplorationCosts(distance);
  const baseDurationMs = EXPLORATION.SECONDS_PER_HEX * distance * 1000;

  // Aplicar bonificaciones pasivas culturales (Navajos: Math.floor(costeBase * 0.80), Vikingos: duration * 0.85)
  const civExploration = applyCivilizationExploration(baseCosts, baseDurationMs, input.civilization);

  // Aplicar bonificación tecnológica centralizada de velocidad de exploración
  const durationMs = calculateExplorationDurationMs(
    civExploration.durationMs,
    input.explorationSpeedBonus ?? 0
  );
  const durationSeconds = Math.ceil(durationMs / 1000);

  return {
    distance,
    durationSeconds,
    durationMs,
    costs: civExploration.costs,
    scoutsRequired: EXPLORATION.SCOUTS_REQUIRED,
  };
}

/**
 * Valida si una celda puede ser explorada por el reino.
 * Exige:
 * 1. Estar dentro del mundo.
 * 2. No estar ya poseída ni explorada.
 * 3. No tener ya una expedición en camino.
 * 4. No exceder el límite de expediciones activas.
 * 5. Adyacencia: debe limitar con al menos una celda ya conocida/poseída (expansión de frontera).
 * 6. Disponer de población civil libre y recursos suficientes (costes progresivos según distancia logística).
 */
export function canStartExploration(input: {
  targetCoord: HexCoord;
  targetCellId: string;
  knownCellIds: ReadonlySet<string>;
  activeCellIds: ReadonlySet<string>;
  ownedCoords: ReadonlyArray<HexCoord>;
  availableCivil?: number;
  availableSpies?: number;
  currentResources: { gold: number; food: number };
  activeExpeditionsCount: number;
  worldRadius?: number;
  civilization?: string;
  explorationSpeedBonus?: number;
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

  const plan = computeExplorationPlan({
    distance,
    civilization: input.civilization,
    explorationSpeedBonus: input.explorationSpeedBonus,
  });
  const costs: ExplorationCosts = plan.costs;

  const spiesCount = (input as any).availableSpies ?? input.availableCivil ?? 0;
  if (spiesCount < EXPLORATION.SCOUTS_REQUIRED) {
    return {
      success: false,
      error: `No tienes espías profesionales disponibles en tu reino (disponibles: ${spiesCount}). Recluta espías en el Cuartel.`,
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
    plan,
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

/**
 * [BETA PARLAMENTO]: Identifica si un reino es de demostración, pruebas o verificación.
 * Estos reinos no deben figurar como rivales legítimos en el Parlamento.
 */
export function isTestOrDemoKingdom(kingdom: {
  userId?: string | null;
  name?: string | null;
  monarchName?: string | null;
}): boolean {
  if (kingdom.userId === "guest_g9ai8cz") return true;
  const name = (kingdom.name ?? "").toLowerCase().trim();
  const monarch = (kingdom.monarchName ?? "").toLowerCase().trim();

  // El reino de demostración Iberia oficial no es un rival de combate real
  if (name === "reino de iberia" || name === "iberia") return true;
  if (name.includes("prueba") || name.includes("pruebas")) return true;
  if (name.includes("verificaci") || name.includes("verificacion") || name.includes("verificación")) return true;
  if (name.includes("test")) return true;

  if (monarch.includes("test") || monarch.includes("prueba") || monarch.includes("verificaci")) return true;
  if (monarch === "rey arturo") return true;

  return false;
}

/**
 * [BETA PARLAMENTO]: Determina si un reino objetivo ha sido descubierto en el mapa por un reino observador.
 * Un reino se considera descubierto si el observador conoce al menos una de las celdas
 * territoriales que dicho reino posee (su territorio principal o territorios anexionados).
 */
export function isKingdomDiscoveredOnMap(
  targetKingdomId: string,
  knownCellIds: ReadonlySet<string>,
  targetOwnedCellIds: ReadonlyArray<string>,
  targetHomeTerritoryId?: string | null
): boolean {
  if (targetHomeTerritoryId && knownCellIds.has(targetHomeTerritoryId)) {
    return true;
  }
  return targetOwnedCellIds.some((cellId) => knownCellIds.has(cellId));
}

/**
 * [BETA PARLAMENTO]: Filtra la lista de reinos candidatos para el Parlamento, devolviendo
 * únicamente aquellos de jugadores reales descubiertos en el mapa por el reino observador,
 * excluyendo reinos de demostración, pruebas o verificación y deduplicando por nombre.
 */
export function filterDiscoveredKingdoms<T extends { kingdomId: string; name?: string; monarchName?: string; userId?: string }>(
  viewerKingdomId: string,
  candidates: ReadonlyArray<T>,
  discoveredKingdomIds: ReadonlySet<string>
): T[] {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const result: T[] = [];

  for (const k of candidates) {
    if (k.kingdomId === viewerKingdomId) continue;
    if (seenIds.has(k.kingdomId)) continue;
    if (!discoveredKingdomIds.has(k.kingdomId)) continue;
    if (isTestOrDemoKingdom(k)) continue;

    const normName = (k.name ?? "").toLowerCase().trim();
    if (normName && seenNames.has(normName)) continue;
    if (normName) seenNames.add(normName);

    seenIds.add(k.kingdomId);
    result.push(k);
  }

  return result;
}


