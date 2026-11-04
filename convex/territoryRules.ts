/**
 * LA CONQUISTA — REGLAS PURAS DEL MAPA Y TERRITORIOS (Bloque G, D-22 a D-26)
 * Mapa hexagonal con coordenadas axiales (q, r), radio 10 → 331 celdas.
 * Sin acceso a Convex.
 */
import {
  FATIGUE,
  FATIGUE_TABLE,
  FOOD,
  MAP,
  MARCH,
  TERRAINS,
  TIME,
  UNITS,
  type TerrainType,
  type UnitType,
} from "./balanceConfig";

export interface HexCoord {
  q: number;
  r: number;
}

export interface WorldCell extends HexCoord {
  cellId: string;
  terrain: TerrainType;
}

export function cellId(q: number, r: number): string {
  return `${q},${r}`;
}

export function parseCellId(id: string): HexCoord | null {
  const match = /^(-?\d+),(-?\d+)$/.exec(id);
  if (!match) return null;
  return { q: Number(match[1]), r: Number(match[2]) };
}

/** [COMPLEMENTO D-26] d = (|Δq| + |Δr| + |Δq + Δr|) / 2 */
export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function isInsideWorld(coord: HexCoord, radius: number = MAP.RADIUS): boolean {
  return Number.isInteger(coord.q) && Number.isInteger(coord.r) && hexDistance(coord, { q: 0, r: 0 }) <= radius;
}

const HEX_DIRECTIONS: readonly HexCoord[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function hexNeighbors(coord: HexCoord, radius: number = MAP.RADIUS): HexCoord[] {
  return HEX_DIRECTIONS
    .map((direction) => ({ q: coord.q + direction.q, r: coord.r + direction.r }))
    .filter((neighbor) => isInsideWorld(neighbor, radius));
}

/** Hash determinista (xorshift sobre semilla y coordenadas) para asignar terrenos reproducibles (D-25). */
function hashCell(q: number, r: number, seed: number): number {
  let h = (seed ^ (q * 374761393) ^ (r * 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

const TERRAIN_ORDER: readonly TerrainType[] = ["llanura", "bosque", "colina", "montana", "rio", "costa"];

/**
 * [DERIVADO] Terreno de una celda: la costa solo aparece en el borde del mundo; el resto se
 * reparte por hash. Los pesos relativos (llanura 30 %, bosque 25 %, colina 20 %, montaña 15 %,
 * río 10 %) son parámetros de generación revisables.
 */
const INLAND_WEIGHTS: ReadonlyArray<{ terrain: TerrainType; weight: number }> = [
  { terrain: "llanura", weight: 30 },
  { terrain: "bosque", weight: 25 },
  { terrain: "colina", weight: 20 },
  { terrain: "montana", weight: 15 },
  { terrain: "rio", weight: 10 },
];

export function terrainForCell(q: number, r: number, seed: number = MAP.WORLD_SEED, radius: number = MAP.RADIUS): TerrainType {
  const distance = hexDistance({ q, r }, { q: 0, r: 0 });
  const h = hashCell(q, r, seed);
  if (distance === radius && h % 2 === 0) return "costa";
  const total = INLAND_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = h % total;
  for (const entry of INLAND_WEIGHTS) {
    if (roll < entry.weight) return entry.terrain;
    roll -= entry.weight;
  }
  return TERRAIN_ORDER[0];
}

/** [COMPLEMENTO D-23] Todas las celdas del mundo (331 con radio 10). */
export function generateWorldCells(radius: number = MAP.RADIUS, seed: number = MAP.WORLD_SEED): WorldCell[] {
  const cells: WorldCell[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      cells.push({ q, r, cellId: cellId(q, r), terrain: terrainForCell(q, r, seed, radius) });
    }
  }
  return cells;
}

/**
 * [DERIVADO de D-25] Territorio principal de un reino nuevo: el centro si está libre; si no,
 * la celda libre que maximiza la distancia mínima a los territorios principales existentes
 * (desempate por identificador), para repartir los reinos por el mapa de forma reproducible.
 */
export function chooseHomeCell(
  cells: ReadonlyArray<WorldCell>,
  occupiedCellIds: ReadonlySet<string>,
  existingHomes: ReadonlyArray<HexCoord>
): WorldCell | null {
  const free = cells.filter((cell) => !occupiedCellIds.has(cell.cellId));
  if (free.length === 0) return null;
  if (existingHomes.length === 0) {
    return free.find((cell) => cell.q === 0 && cell.r === 0) ?? free[0];
  }
  let best: WorldCell | null = null;
  let bestScore = -1;
  for (const cell of free) {
    const score = Math.min(...existingHomes.map((home) => hexDistance(cell, home)));
    if (score > bestScore || (score === bestScore && best && cell.cellId < best.cellId)) {
      best = cell;
      bestScore = score;
    }
  }
  return best;
}

/** [MAESTRA P48] Tras una victoria aplastante se reclama un territorio libre CERCANO: a distancia ≤ 2 de uno propio ([DERIVADO]). */
export const CLAIM_MAX_DISTANCE = 2;

export function canClaimTerritory(input: {
  target: WorldCell & { ownerKingdomId?: string | null };
  ownedCells: ReadonlyArray<HexCoord>;
  pendingClaims: number;
  exploredCellIds?: ReadonlySet<string>;
}): { success: true } | { success: false; error: string } {
  if (!Number.isInteger(input.pendingClaims) || input.pendingClaims < 1) {
    return { success: false, error: "No tienes reclamaciones territoriales pendientes; se obtienen con victorias aplastantes (P47)." };
  }
  if (input.target.ownerKingdomId) {
    return { success: false, error: "El territorio ya tiene propietario; no se arrebatan territorios ocupados (P48)." };
  }
  if (input.exploredCellIds && !input.exploredCellIds.has(input.target.cellId)) {
    return { success: false, error: "Debes explorar y cartografiar este territorio antes de poder reclamarlo (P22/P49)." };
  }
  if (input.ownedCells.length === 0) {
    return { success: false, error: "El reino no tiene territorio principal desde el que reclamar." };
  }
  const nearest = Math.min(...input.ownedCells.map((cell) => hexDistance(cell, input.target)));
  if (nearest > CLAIM_MAX_DISTANCE) {
    return { success: false, error: `El territorio debe estar cerca (distancia ≤ ${CLAIM_MAX_DISTANCE}); el más cercano propio está a ${nearest}.` };
  }
  return { success: true };
}

// ----------------------------------------------------------------------------
// Marcha y fatiga (P41, P32, D-26)
// ----------------------------------------------------------------------------
import { normalizeCivilizationId } from "./civilizationRules";

export function terrainMarchMultiplier(terrain: TerrainType): number {
  return TERRAINS[terrain]?.marchMultiplier ?? 1;
}

/**
 * Devuelve el multiplicador de velocidad de marcha individual de una unidad,
 * considerando excepciones culturales (p. ej. Guerreros Jaguar aztecas en plaza caballería marchan a pie).
 */
export function unitMarchMultiplier(unitType: UnitType, civilization?: string | null): number {
  const normCiv = normalizeCivilizationId(civilization);
  if (unitType === "caballeria" && normCiv === "aztecas") {
    return UNITS.infanteria.marchMultiplier; // 1.0 (velocidad a pie)
  }
  return UNITS[unitType]?.marchMultiplier ?? 1.0;
}

/** El ejército viaja a la velocidad de la unidad más lenta presente. */
export function armyMarchMultiplier(
  composition: Partial<Record<UnitType, number>>,
  civilization?: string | null
): number {
  let multiplier = 1;
  for (const [unitType, count] of Object.entries(composition) as [UnitType, number][]) {
    if (count > 0 && UNITS[unitType]) {
      multiplier = Math.max(multiplier, unitMarchMultiplier(unitType, civilization));
    }
  }
  return multiplier;
}

/** [COMPLEMENTO §5] T_marcha = T_base × d × M_terreno × M_unidad / M_civ (segundos reales, acotado entre 900 y 43.200 s). */
export function marchTimeSeconds(
  distance: number,
  terrainMultiplier: number = 1,
  unitMultiplier: number = 1,
  civSpeedMultiplier: number = 1,
  techSpeedBonus: number = 0
): number {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  const civSpeed = civSpeedMultiplier > 0 ? civSpeedMultiplier : 1;
  const effectiveSpeed = Math.max(0.1, civSpeed * (1 + Math.max(0, techSpeedBonus)));
  const rawSeconds = (MAP.MARCH_SECONDS_PER_HEX * distance * terrainMultiplier * unitMultiplier) / effectiveSpeed;
  return Math.max(MARCH.MIN_DURATION_SECONDS, Math.min(MARCH.MAX_DURATION_SECONDS, Math.ceil(rawSeconds)));
}

/** [COMPLEMENTO §5 + E4c] F_nueva = min(100, F_actual + ceil(2·d·M_terreno·M_civFatiga·(1−ReducciónMarcha)·(1−ReducciónAcumulada))). */
export function marchFatigue(
  currentFatigue: number,
  distance: number,
  terrainMultiplier: number = 1,
  civFatigueMultiplier: number = 1,
  techMarchFatigueReduction: number = 0,
  techFatigueAccrualReduction: number = 0
): number {
  const current = Number.isFinite(currentFatigue) ? Math.max(0, currentFatigue) : 0;
  if (!Number.isFinite(distance) || distance <= 0) return Math.min(100, current);
  const civFatigue = civFatigueMultiplier > 0 ? civFatigueMultiplier : 1;
  // Combinación multiplicativa: Pasiva × (1 - MarchFatigue) × (1 - FatigueAccrual)
  const techFactor = (1 - Math.min(0.5, techMarchFatigueReduction)) * (1 - Math.min(0.3, techFatigueAccrualReduction));
  const fatigueFactor = civFatigue * Math.max(0.1, techFactor);
  const rawFatigue = FATIGUE.PER_HEX * distance * terrainMultiplier * fatigueFactor;
  return Math.min(100, current + Math.max(0, Math.ceil(rawFatigue)));
}

/**
 * [DECISIÓN 23-10-2026, R-14] Celdas de la línea recta hexagonal entre dos coordenadas (interpolación
 * cúbica redondeada), sin incluir el origen e incluyendo el destino. Para distancia 0 no hay celdas.
 */
export function hexLine(from: HexCoord, to: HexCoord): HexCoord[] {
  const distance = hexDistance(from, to);
  if (distance <= 0) return [];
  const cells: HexCoord[] = [];
  const fromCube = { x: from.q, z: from.r, y: -from.q - from.r };
  const toCube = { x: to.q, z: to.r, y: -to.q - to.r };
  for (let i = 1; i <= distance; i++) {
    const t = i / distance;
    const x = fromCube.x + (toCube.x - fromCube.x) * t;
    const y = fromCube.y + (toCube.y - fromCube.y) * t;
    const z = fromCube.z + (toCube.z - fromCube.z) * t;
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    cells.push({ q: rx, r: rz });
  }
  return cells;
}

/**
 * [DECISIÓN 23-10-2026, R-14] Multiplicador de terreno de una marcha: media de los multiplicadores de
 * las celdas del camino (origen excluido, destino incluido). Celdas desconocidas cuentan como 1.
 */
export function pathTerrainMultiplier(
  from: HexCoord,
  to: HexCoord,
  terrainByCell: ReadonlyMap<string, TerrainType | string> | Record<string, TerrainType | string>
): number {
  const cells = hexLine(from, to);
  if (cells.length === 0) return 1;
  let total = 0;
  for (const cell of cells) {
    const id = cellId(cell.q, cell.r);
    const terrain = terrainByCell instanceof Map ? terrainByCell.get(id) : (terrainByCell as Record<string, string>)[id];
    total += terrain ? terrainMarchMultiplier(terrain as TerrainType) : 1;
  }
  return Math.round((total / cells.length) * 1000) / 1000;
}

/** [MAESTRA P32] Multiplicador por fatiga. */
export function fatigueMultiplier(fatigue: number): number {
  const value = Number.isFinite(fatigue) ? Math.max(0, Math.min(100, fatigue)) : 0;
  for (const row of FATIGUE_TABLE) {
    if (value <= row.maxFatigue) return row.multiplier;
  }
  return FATIGUE_TABLE[FATIGUE_TABLE.length - 1].multiplier;
}

/** [COMPLEMENTO §5] Recuperación de 10 puntos por día real en descanso con ración normal o mejor. */
export function recoverFatigue(currentFatigue: number, elapsedDays: number, foodTier: string): number {
  const current = Number.isFinite(currentFatigue) ? Math.max(0, Math.min(100, currentFatigue)) : 0;
  const tierFactor = (FOOD.TIER_FACTORS as Record<string, number>)[foodTier] ?? 1;
  const minimum = FOOD.TIER_FACTORS[FATIGUE.MIN_TIER_FOR_RECOVERY];
  if (tierFactor < minimum || !(elapsedDays > 0)) return current;
  return Math.max(0, current - FATIGUE.RECOVERY_PER_DAY * elapsedDays);
}

// ----------------------------------------------------------------------------
// Planificación completa de marcha y desplazamiento militar (Sección A)
// ----------------------------------------------------------------------------
export interface ArmyMarchPlan {
  distance: number;
  durationSeconds: number;
  durationMs: number;
  departureTimeMs: number;
  arrivalTimeMs: number;
  fatigueAccrued: number;
  finalFatigue: number;
  battlePrepWindowSeconds: number;
  gameTimeDays: number;
  gameTimeYears: number;
  slowestUnitType: UnitType | null;
  unitSpeedMultiplier: number;
  terrainMultiplier: number;
  civilizationSpeedMultiplier: number;
  civilizationFatigueMultiplier: number;
  minBoundApplied: boolean;
  maxBoundApplied: boolean;
  pathCells: HexCoord[];
}

export function calculateArmyMarchPlan(input: {
  from: HexCoord;
  to: HexCoord;
  composition: Partial<Record<UnitType, number>>;
  currentFatigue: number;
  departureTimeMs: number;
  civilization?: string | null;
  terrainMultiplier?: number;
  terrainByCell?: ReadonlyMap<string, TerrainType | string> | Record<string, TerrainType | string>;
  civilizationPassive?: { marchSpeedMultiplier?: number; fatigueAccrualMultiplier?: number } | null;
  technologyModifiers?: { marchSpeedBonus?: number; marchFatigueReduction?: number; fatigueAccrualReduction?: number } | null;
}): ArmyMarchPlan {
  const distance = hexDistance(input.from, input.to);
  const pathCells = hexLine(input.from, input.to);

  let terrainMultiplier = 1;
  if (typeof input.terrainMultiplier === "number" && input.terrainMultiplier > 0) {
    terrainMultiplier = input.terrainMultiplier;
  } else if (input.terrainByCell && distance > 0) {
    terrainMultiplier = pathTerrainMultiplier(input.from, input.to, input.terrainByCell);
  }

  let slowestUnitType: UnitType | null = null;
  let unitSpeedMultiplier = 1;
  for (const [type, count] of Object.entries(input.composition) as [UnitType, number][]) {
    if (count > 0 && UNITS[type]) {
      const mult = unitMarchMultiplier(type, input.civilization);
      if (mult > unitSpeedMultiplier) {
        unitSpeedMultiplier = mult;
        slowestUnitType = type;
      } else if (!slowestUnitType) {
        slowestUnitType = type;
      }
    }
  }

  const civSpeed = input.civilizationPassive?.marchSpeedMultiplier ?? 1.0;
  const civFatigue = input.civilizationPassive?.fatigueAccrualMultiplier ?? 1.0;
  const techSpeed = 1 + Math.max(0, input.technologyModifiers?.marchSpeedBonus ?? 0);
  const marchFatRed = input.technologyModifiers?.marchFatigueReduction ?? 0;
  const fatAccRed = input.technologyModifiers?.fatigueAccrualReduction ?? 0;
  const techFatFactor = (1 - Math.min(0.5, marchFatRed)) * (1 - Math.min(0.3, fatAccRed));
  
  const effectiveSpeed = Math.max(0.1, civSpeed * techSpeed);
  const effectiveFatigue = civFatigue * Math.max(0.1, techFatFactor);

  let durationSeconds = 0;
  let minBoundApplied = false;
  let maxBoundApplied = false;

  if (distance > 0) {
    const rawSeconds = (MAP.MARCH_SECONDS_PER_HEX * distance * terrainMultiplier * unitSpeedMultiplier) / effectiveSpeed;
    if (rawSeconds < MARCH.MIN_DURATION_SECONDS) {
      durationSeconds = MARCH.MIN_DURATION_SECONDS;
      minBoundApplied = true;
    } else if (rawSeconds > MARCH.MAX_DURATION_SECONDS) {
      durationSeconds = MARCH.MAX_DURATION_SECONDS;
      maxBoundApplied = true;
    } else {
      durationSeconds = Math.ceil(rawSeconds);
    }
  }

  const durationMs = durationSeconds * 1000;
  const departureTimeMs = Number.isFinite(input.departureTimeMs) ? input.departureTimeMs : 0;
  const arrivalTimeMs = departureTimeMs + durationMs;

  const rawFatigue = distance > 0 ? FATIGUE.PER_HEX * distance * terrainMultiplier * effectiveFatigue : 0;
  const fatigueAccrued = Math.max(0, Math.ceil(rawFatigue));
  const currentFatigue = Number.isFinite(input.currentFatigue) ? Math.max(0, Math.min(100, input.currentFatigue)) : 0;
  const finalFatigue = Math.min(100, currentFatigue + fatigueAccrued);

  const battlePrepWindowSeconds = distance > 0
    ? Math.max(MARCH.MIN_PREP_SECONDS, Math.min(MARCH.MAX_PREP_SECONDS, Math.round(MARCH.PREP_WINDOW_RATIO * durationSeconds)))
    : 0;

  // Escala temporal: 1 día real (86.400 s) = 1 año de juego = 365 días de juego
  const gameTimeYears = Math.round((durationSeconds / TIME.SECONDS_PER_GAME_YEAR) * 10_000) / 10_000;
  const gameTimeDays = Math.round((durationSeconds * (365 / TIME.SECONDS_PER_GAME_YEAR)) * 100) / 100;

  return {
    distance,
    durationSeconds,
    durationMs,
    departureTimeMs,
    arrivalTimeMs,
    fatigueAccrued,
    finalFatigue,
    battlePrepWindowSeconds,
    gameTimeDays,
    gameTimeYears,
    slowestUnitType,
    unitSpeedMultiplier,
    terrainMultiplier,
    civilizationSpeedMultiplier: civSpeed,
    civilizationFatigueMultiplier: civFatigue,
    minBoundApplied,
    maxBoundApplied,
    pathCells,
  };
}
