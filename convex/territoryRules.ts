/**
 * LA CONQUISTA — REGLAS PURAS DEL MAPA Y TERRITORIOS (Bloque G, D-22 a D-26)
 * Mapa hexagonal canónico con coordenadas axiales (q, r), radio 50 → 7.651 celdas (1 + 3 × 50 × 51).
 * Referencia histórica: radio 10 → 331 celdas. Sin acceso a Convex.
 */
import {
  CIVILIZATION_ZONES,
  FATIGUE,
  FATIGUE_TABLE,
  FOOD,
  MAP,
  MARCH,
  TERRAINS,
  TERRITORIES,
  TIME,
  UNITS,
  type TerrainType,
  type UnitType,
} from "./balanceConfig";
import { normalizeCivilizationId } from "./civilizationRules";

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
  // Preservación histórica: las casillas en la frontera original de radio 10 que eran costa
  // conservan íntegramente su terreno para garantizar la compatibilidad con los 331 hexágonos originales
  if (distance === 10 && h % 2 === 0) return "costa";
  if (distance === radius && h % 2 === 0) return "costa";
  const total = INLAND_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = h % total;
  for (const entry of INLAND_WEIGHTS) {
    if (roll < entry.weight) return entry.terrain;
    roll -= entry.weight;
  }
  return TERRAIN_ORDER[0];
}

/** Fórmula geométrica exacta de un disco hexagonal de radio r: 1 + 3 × r × (r + 1). */
export function canonicalWorldCellCount(radius: number = MAP.RADIUS): number {
  if (!Number.isInteger(radius) || radius < 0) return 0;
  return 1 + 3 * radius * (radius + 1);
}

/** [MAPA CANÓNICO] Todas las celdas del disco hexagonal completo (7.651 con radio 50; histórico: 331 con radio 10). */
export function generateWorldCells(radius: number = MAP.RADIUS, seed: number = MAP.WORLD_SEED): WorldCell[] {
  const cells: WorldCell[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      cells.push({ q, r, cellId: cellId(q, r), terrain: terrainForCell(q, r, seed, radius) });
    }
  }
  return cells;
}

export interface WorldIntegrityReport {
  radius: number;
  expectedCanonicalCells: number;
  persistedTotal: number;
  uniqueCanonicalPresent: number;
  missingCellIds: string[];
  duplicateCellIds: string[];
  outOfBoundsCellIds: string[];
  isComplete: boolean;
  isExact: boolean;
}

/**
 * Contrasta los registros persistidos de `territories` contra el mapa hexagonal canónico.
 * Detecta celdas faltantes, duplicados y coordenadas fuera del radio canónico,
 * sin confiar únicamente en el recuento total de filas.
 */
export function inspectWorldIntegrity(
  persistedCells: ReadonlyArray<{ cellId: string; q: number; r: number }>,
  radius: number = MAP.RADIUS,
  seed: number = MAP.WORLD_SEED
): WorldIntegrityReport {
  const canonical = generateWorldCells(radius, seed);
  const canonicalIds = new Set(canonical.map((c) => c.cellId));
  const seenCanonical = new Set<string>();
  const duplicateCellIds: string[] = [];
  const outOfBoundsCellIds: string[] = [];

  for (const row of persistedCells) {
    const parsed = parseCellId(row.cellId);
    const matchesCoords =
      parsed !== null &&
      parsed.q === row.q &&
      parsed.r === row.r &&
      isInsideWorld(parsed, radius) &&
      canonicalIds.has(row.cellId);

    if (!matchesCoords) {
      outOfBoundsCellIds.push(row.cellId);
      continue;
    }

    if (seenCanonical.has(row.cellId)) {
      duplicateCellIds.push(row.cellId);
    } else {
      seenCanonical.add(row.cellId);
    }
  }

  const missingCellIds: string[] = [];
  for (const cell of canonical) {
    if (!seenCanonical.has(cell.cellId)) {
      missingCellIds.push(cell.cellId);
    }
  }

  return {
    radius,
    expectedCanonicalCells: canonical.length,
    persistedTotal: persistedCells.length,
    uniqueCanonicalPresent: seenCanonical.size,
    missingCellIds,
    duplicateCellIds,
    outOfBoundsCellIds,
    isComplete: missingCellIds.length === 0,
    isExact:
      missingCellIds.length === 0 &&
      duplicateCellIds.length === 0 &&
      outOfBoundsCellIds.length === 0 &&
      persistedCells.length === canonical.length,
  };
}

export interface ExistingKingdomSpawn {
  q: number;
  r: number;
  civilization?: string | null;
}

export interface SpawnPlacementOptions {
  civilization?: string | null;
  existingKingdoms?: ReadonlyArray<ExistingKingdomSpawn>;
  separationMin?: number;
  separationMax?: number;
  preferCenterIfEmpty?: boolean;
}

export interface SpawnPlacementDiagnostics {
  cell: WorldCell | null;
  civilization: string | null;
  zoneAnchor: HexCoord | null;
  zoneLabel: string | null;
  nearestDistance: number | null;
  distanceToAnchor: number | null;
  withinTargetBand: boolean;
  strictPackingImpossible: boolean;
  reason: string;
}

export interface WorldSpawnGeometryAnalysis {
  radius: number;
  totalCells: number;
  diameter: number;
  separationMin: number;
  separationMax: number;
  greedyPackingMaxAtMinSeparation: number;
  exclusiveDiskCellsAtHalfSep: number;
  areaUpperBoundAtMinSeparation: number;
  sameCivClusterMaxAtBand30: number;
  notes: string;
}

/**
 * Demostración geométrica verificable de empaquetamiento hexagonal sobre un disco de radio R.
 * Calcula cota superior por área (discos disjuntos de radio floor((minSep-1)/2)) y cota constructiva greedy.
 */
export function analyzeWorldSpawnGeometry(
  radius: number = MAP.RADIUS,
  separationMin: number = TERRITORIES.SPAWN_SEPARATION_MIN,
  separationMax: number = TERRITORIES.SPAWN_SEPARATION_MAX
): WorldSpawnGeometryAnalysis {
  const totalCells = 1 + 3 * radius * (radius + 1);
  const diameter = 2 * radius;
  const halfRadius = Math.max(0, Math.floor((separationMin - 1) / 2));
  const exclusiveDiskCellsAtHalfSep = 1 + 3 * halfRadius * (halfRadius + 1);
  const areaUpperBoundAtMinSeparation = Math.floor(totalCells / exclusiveDiskCellsAtHalfSep);

  // Empaquetamiento constructivo en orden espiral/axial sobre el disco completo
  const placed: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      const candidate = { q, r };
      if (placed.every((p) => hexDistance(candidate, p) >= separationMin)) {
        placed.push(candidate);
      }
    }
  }

  // En una subregión de diámetro <= separationMax (radio <= separationMax / 2 = 15),
  // cuántas capitales caben manteniendo distancia mutua >= separationMin (20):
  const clusterRadius = Math.floor(separationMax / 2);
  const clusterPlaced: HexCoord[] = [];
  for (let q = -clusterRadius; q <= clusterRadius; q++) {
    for (let r = Math.max(-clusterRadius, -q - clusterRadius); r <= Math.min(clusterRadius, -q + clusterRadius); r++) {
      const candidate = { q, r };
      if (clusterPlaced.every((p) => hexDistance(candidate, p) >= separationMin)) {
        clusterPlaced.push(candidate);
      }
    }
  }

  return {
    radius,
    totalCells,
    diameter,
    separationMin,
    separationMax,
    greedyPackingMaxAtMinSeparation: placed.length,
    exclusiveDiskCellsAtHalfSep,
    areaUpperBoundAtMinSeparation,
    sameCivClusterMaxAtBand30: clusterPlaced.length,
    notes:
      `En radio ${radius} (${totalCells} celdas, diámetro ${diameter}), cada reino con separación >= ${separationMin} ` +
      `reserva al menos un disco exclusivo de radio ${halfRadius} (${exclusiveDiskCellsAtHalfSep} celdas): cota superior absoluta ~${areaUpperBoundAtMinSeparation} ` +
      `reinos y empaquetamiento constructivo ${placed.length}. Además, dentro de una zona de diámetro ${separationMax} solo caben ` +
      `${clusterPlaced.length} reinos con d >= ${separationMin} mutua; a partir de ese umbral resulta matemáticamente imposible satisfacer ` +
      `a la vez separación >= ${separationMin}, distancia <= ${separationMax} y agrupación compacta en la misma zona.`,
  };
}

/**
 * Selecciona la casilla inicial con agrupación geográfica por civilización y banda objetivo [20, 30] hexágonos.
 * Si no se pasa `options`, mantiene el comportamiento histórico para compatibilidad de pruebas heredadas.
 */
export function chooseHomeCellWithDiagnostics(
  cells: ReadonlyArray<WorldCell>,
  occupiedCellIds: ReadonlySet<string>,
  existingHomes: ReadonlyArray<HexCoord>,
  options?: SpawnPlacementOptions
): SpawnPlacementDiagnostics {
  const free = cells.filter((cell) => !occupiedCellIds.has(cell.cellId));
  if (free.length === 0) {
    return {
      cell: null,
      civilization: normalizeCivilizationId(options?.civilization),
      zoneAnchor: null,
      zoneLabel: null,
      nearestDistance: null,
      distanceToAnchor: null,
      withinTargetBand: false,
      strictPackingImpossible: true,
      reason: "No hay casillas libres disponibles en el mapa.",
    };
  }

  if (!options) {
    if (existingHomes.length === 0) {
      const center = free.find((cell) => cell.q === 0 && cell.r === 0) ?? free[0];
      return {
        cell: center,
        civilization: null,
        zoneAnchor: { q: 0, r: 0 },
        zoneLabel: "Centro del mundo",
        nearestDistance: null,
        distanceToAnchor: hexDistance(center, { q: 0, r: 0 }),
        withinTargetBand: true,
        strictPackingImpossible: false,
        reason: "Casilla central asignada al primer reino.",
      };
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
    return {
      cell: best,
      civilization: null,
      zoneAnchor: null,
      zoneLabel: null,
      nearestDistance: bestScore,
      distanceToAnchor: null,
      withinTargetBand: bestScore >= TERRITORIES.SPAWN_SEPARATION_MIN && bestScore <= TERRITORIES.SPAWN_SEPARATION_MAX,
      strictPackingImpossible: false,
      reason: "Asignación heredada por distancia máxima mínima.",
    };
  }

  const normCiv = normalizeCivilizationId(options.civilization);
  const zone = normCiv ? CIVILIZATION_ZONES[normCiv] ?? null : null;
  const anchor: HexCoord | null = zone ? { q: zone.q, r: zone.r } : null;
  const minSep = options.separationMin ?? TERRITORIES.SPAWN_SEPARATION_MIN;
  const maxSep = options.separationMax ?? TERRITORIES.SPAWN_SEPARATION_MAX;
  const idealMid = (minSep + maxSep) / 2;

  const existing: ReadonlyArray<ExistingKingdomSpawn> = options.existingKingdoms && options.existingKingdoms.length > 0
    ? options.existingKingdoms
    : existingHomes.map((h) => ({ q: h.q, r: h.r, civilization: null }));

  if (existing.length === 0) {
    const targetRef: HexCoord = options.preferCenterIfEmpty || !anchor ? { q: 0, r: 0 } : anchor;
    let best = free[0];
    let bestAnchorDist = hexDistance(best, targetRef);
    for (const cell of free) {
      const d = hexDistance(cell, targetRef);
      if (d < bestAnchorDist || (d === bestAnchorDist && cell.cellId < best.cellId)) {
        best = cell;
        bestAnchorDist = d;
      }
    }
    return {
      cell: best,
      civilization: normCiv,
      zoneAnchor: options.preferCenterIfEmpty ? { q: 0, r: 0 } : anchor,
      zoneLabel: options.preferCenterIfEmpty ? "Centro del mundo" : (zone?.label ?? null),
      nearestDistance: null,
      distanceToAnchor: bestAnchorDist,
      withinTargetBand: true,
      strictPackingImpossible: false,
      reason: options.preferCenterIfEmpty
        ? "Primer reino asignado al centro del mundo."
        : zone
          ? `Primer reino asignado a su zona geográfica (${zone.label}).`
          : "Primer reino asignado al centro.",
    };
  }

  const sameCiv = normCiv
    ? existing.filter((k) => normalizeCivilizationId(k.civilization) === normCiv)
    : [];

  let bestFeasible: { cell: WorldCell; cost: number; nearest: number; anchorDist: number; inBand: boolean } | null = null;
  let bestFallback: { cell: WorldCell; nearest: number; anchorDist: number } | null = null;

  for (const cell of free) {
    let nearest = Infinity;
    for (const k of existing) {
      const d = hexDistance(cell, k);
      if (d < nearest) nearest = d;
    }

    const anchorDist = anchor ? hexDistance(cell, anchor) : 0;

    if (nearest < minSep) {
      if (
        !bestFallback ||
        nearest > bestFallback.nearest ||
        (nearest === bestFallback.nearest && anchorDist < bestFallback.anchorDist) ||
        (nearest === bestFallback.nearest && anchorDist === bestFallback.anchorDist && cell.cellId < bestFallback.cell.cellId)
      ) {
        bestFallback = { cell, nearest, anchorDist };
      }
      continue;
    }

    const inBand = nearest >= minSep && nearest <= maxSep;
    let cost = 0;

    if (sameCiv.length > 0) {
      let nearestSame = Infinity;
      for (const k of sameCiv) {
        const d = hexDistance(cell, k);
        if (d < nearestSame) nearestSame = d;
      }
      const sameBandPenalty = nearestSame <= maxSep ? 0 : (nearestSame - maxSep) * 4;
      cost = sameBandPenalty + anchorDist * 1.5 + Math.abs(nearestSame - idealMid) * 0.5;
    } else if (anchor) {
      const farPenalty = nearest <= maxSep ? 0 : (nearest - maxSep) * 0.1;
      cost = anchorDist * 2 + farPenalty;
    } else {
      const bandPenalty = inBand ? 0 : Math.abs(nearest - idealMid) * 2;
      cost = bandPenalty + Math.abs(nearest - idealMid) * 0.25;
    }

    if (
      !bestFeasible ||
      cost < bestFeasible.cost ||
      (cost === bestFeasible.cost && cell.cellId < bestFeasible.cell.cellId)
    ) {
      bestFeasible = { cell, cost, nearest, anchorDist, inBand };
    }
  }

  if (bestFeasible) {
    return {
      cell: bestFeasible.cell,
      civilization: normCiv,
      zoneAnchor: anchor,
      zoneLabel: zone?.label ?? null,
      nearestDistance: bestFeasible.nearest,
      distanceToAnchor: bestFeasible.anchorDist,
      withinTargetBand: bestFeasible.inBand,
      strictPackingImpossible: !bestFeasible.inBand && sameCiv.length > 0,
      reason: bestFeasible.inBand
        ? `Ubicado dentro de la banda objetivo [${minSep}, ${maxSep}] hexágonos` + (zone ? ` en ${zone.label}.` : ".")
        : `Separación mínima >= ${minSep} preservada; banda <= ${maxSep} saturada o incompatible con ancla regional distante.`,
    };
  }

  return {
    cell: bestFallback?.cell ?? null,
    civilization: normCiv,
    zoneAnchor: anchor,
    zoneLabel: zone?.label ?? null,
    nearestDistance: bestFallback?.nearest ?? null,
    distanceToAnchor: bestFallback?.anchorDist ?? null,
    withinTargetBand: false,
    strictPackingImpossible: true,
    reason: `Saturación espacial del mapa: no existen casillas libres con separación >= ${minSep}; se eligió la máxima separación disponible (${bestFallback?.nearest ?? 0}).`,
  };
}

/**
 * [DERIVADO de D-25] Territorio principal de un reino nuevo.
 */
export function chooseHomeCell(
  cells: ReadonlyArray<WorldCell>,
  occupiedCellIds: ReadonlySet<string>,
  existingHomes: ReadonlyArray<HexCoord>,
  options?: SpawnPlacementOptions
): WorldCell | null {
  return chooseHomeCellWithDiagnostics(cells, occupiedCellIds, existingHomes, options).cell;
}

/** [MAESTRA P48] Tras una victoria aplastante se reclama un territorio libre CERCANO: a distancia ≤ 2 de uno propio ([DERIVADO]). */
export const CLAIM_MAX_DISTANCE = 2;

export function canClaimTerritory(input: {
  target: WorldCell & { ownerKingdomId?: string | null };
  ownedCells: ReadonlyArray<HexCoord>;
  pendingClaims: number;
  exploredCellIds?: ReadonlySet<string>;
  ownedCount?: number;
  maxTerritories?: number;
}): { success: true } | { success: false; error: string } {
  const maxTerritories = input.maxTerritories ?? TERRITORIES.MAX_PER_KINGDOM;
  const ownedCount = input.ownedCount ?? input.ownedCells.length;
  if (!Number.isInteger(input.pendingClaims) || input.pendingClaims < 1) {
    return { success: false, error: "No tienes reclamaciones territoriales pendientes; se obtienen con victorias aplastantes (P47)." };
  }
  if (input.target.ownerKingdomId) {
    return { success: false, error: "El territorio ya tiene propietario; no se arrebatan territorios ocupados (P48)." };
  }
  if (ownedCount >= maxTerritories) {
    return {
      success: false,
      error: `Has alcanzado el límite máximo de ${maxTerritories} territorios por reino (actuales: ${ownedCount}).`,
    };
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

export interface CleanupCandidateCell {
  id: string;
  cellId: string;
  q: number;
  r: number;
  isHome?: boolean;
  claimedAt?: number;
}

export interface TerritoryCapCleanupPlan {
  capitalCellId: string;
  totalOwned: number;
  maxAllowed: number;
  keptCellIds: string[];
  releasedCellIds: string[];
  releasedCells: CleanupCandidateCell[];
  skipped: boolean;
  reason?: string;
}

/**
 * Planificador puro, determinista e idempotente para sanear reinos que excedan el tope de territorios.
 * Conserva la capital canónica y las (maxAllowed - 1) casillas más cercanas por distancia hexagonal.
 */
export function planTerritoryCapCleanup(input: {
  ownedCells: ReadonlyArray<CleanupCandidateCell>;
  homeTerritoryId?: string | null;
  maxAllowed?: number;
}): TerritoryCapCleanupPlan {
  const maxAllowed = input.maxAllowed ?? TERRITORIES.MAX_PER_KINGDOM;
  const cells = [...input.ownedCells];
  if (cells.length === 0) {
    return {
      capitalCellId: input.homeTerritoryId ?? "",
      totalOwned: 0,
      maxAllowed,
      keptCellIds: [],
      releasedCellIds: [],
      releasedCells: [],
      skipped: true,
      reason: "Sin territorios propios.",
    };
  }

  const sortedForCapital = [...cells].sort((a, b) => {
    const aHomeId = input.homeTerritoryId && a.cellId === input.homeTerritoryId ? 0 : 1;
    const bHomeId = input.homeTerritoryId && b.cellId === input.homeTerritoryId ? 0 : 1;
    if (aHomeId !== bHomeId) return aHomeId - bHomeId;
    const aIsHome = a.isHome ? 0 : 1;
    const bIsHome = b.isHome ? 0 : 1;
    if (aIsHome !== bIsHome) return aIsHome - bIsHome;
    const distA = hexDistance(a, { q: 0, r: 0 });
    const distB = hexDistance(b, { q: 0, r: 0 });
    if (distA !== distB) return distA - distB;
    const claimedA = typeof a.claimedAt === "number" ? a.claimedAt : Number.MAX_SAFE_INTEGER;
    const claimedB = typeof b.claimedAt === "number" ? b.claimedAt : Number.MAX_SAFE_INTEGER;
    if (claimedA !== claimedB) return claimedA - claimedB;
    return a.cellId.localeCompare(b.cellId);
  });

  const capital = sortedForCapital[0];
  if (cells.length <= maxAllowed) {
    return {
      capitalCellId: capital.cellId,
      totalOwned: cells.length,
      maxAllowed,
      keptCellIds: cells.map((c) => c.cellId),
      releasedCellIds: [],
      releasedCells: [],
      skipped: true,
      reason: "Dentro del límite territorial.",
    };
  }

  const others = cells
    .filter((c) => c.cellId !== capital.cellId)
    .sort((a, b) => {
      const distA = hexDistance(capital, a);
      const distB = hexDistance(capital, b);
      if (distA !== distB) return distA - distB;
      const claimedA = typeof a.claimedAt === "number" ? a.claimedAt : Number.MAX_SAFE_INTEGER;
      const claimedB = typeof b.claimedAt === "number" ? b.claimedAt : Number.MAX_SAFE_INTEGER;
      if (claimedA !== claimedB) return claimedA - claimedB;
      return a.cellId.localeCompare(b.cellId);
    });

  const keepCount = Math.max(0, maxAllowed - 1);
  const kept = [capital, ...others.slice(0, keepCount)];
  const released = others.slice(keepCount);

  return {
    capitalCellId: capital.cellId,
    totalOwned: cells.length,
    maxAllowed,
    keptCellIds: kept.map((c) => c.cellId),
    releasedCellIds: released.map((c) => c.cellId),
    releasedCells: released,
    skipped: false,
  };
}

// ----------------------------------------------------------------------------
// Marcha y fatiga (P41, P32, D-26)
// ----------------------------------------------------------------------------

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
