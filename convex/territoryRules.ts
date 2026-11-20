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

export interface CivilizationAnchorVerification {
  readonly totalAnchors: number;
  readonly allInsideMap: boolean;
  readonly allIntegerCoords: boolean;
  readonly hasDuplicates: boolean;
  readonly minPairwiseDistance: number;
  readonly minPairwisePair: readonly [string, string] | null;
  readonly invalidAnchors: string[];
  readonly duplicateCoords: string[];
  readonly isValid: boolean;
}

/**
 * Verifica matemáticamente las 12 anclas de civilización en `CIVILIZATION_ZONES`:
 * 1. Todas dentro del mapa de radio R.
 * 2. Todas son coordenadas enteras válidas.
 * 3. Distancia hexagonal mínima entre dos anclas distintas (21 para las 12 anclas canónicas).
 * 4. Sin anclas duplicadas.
 */
export function verifyCivilizationAnchors(radius: number = MAP.RADIUS): CivilizationAnchorVerification {
  const entries = Object.entries(CIVILIZATION_ZONES);
  const invalidAnchors: string[] = [];
  const duplicateCoords: string[] = [];
  const seenCoords = new Set<string>();
  let allInsideMap = true;
  let allIntegerCoords = true;

  for (const [civ, z] of entries) {
    const isInt = Number.isInteger(z.q) && Number.isInteger(z.r);
    if (!isInt) allIntegerCoords = false;
    const inside = isInt && isInsideWorld({ q: z.q, r: z.r }, radius);
    if (!inside) {
      allInsideMap = false;
      invalidAnchors.push(civ);
    }
    const key = cellId(z.q, z.r);
    if (seenCoords.has(key)) {
      duplicateCoords.push(`${civ}@${key}`);
    } else {
      seenCoords.add(key);
    }
  }

  let minPairwiseDistance = Infinity;
  let minPairwisePair: [string, string] | null = null;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const d = hexDistance(entries[i][1], entries[j][1]);
      if (d < minPairwiseDistance) {
        minPairwiseDistance = d;
        minPairwisePair = [entries[i][0], entries[j][0]];
      }
    }
  }
  if (!Number.isFinite(minPairwiseDistance)) minPairwiseDistance = 0;

  return {
    totalAnchors: entries.length,
    allInsideMap,
    allIntegerCoords,
    hasDuplicates: duplicateCoords.length > 0,
    minPairwiseDistance,
    minPairwisePair,
    invalidAnchors,
    duplicateCoords,
    isValid:
      entries.length === 12 &&
      allInsideMap &&
      allIntegerCoords &&
      duplicateCoords.length === 0 &&
      minPairwiseDistance >= 21,
  };
}

export interface ExistingKingdomSpawn {
  q: number;
  r: number;
  civilization?: string | null;
  kingdomId?: string;
}

export interface SpawnPlacementOptions {
  civilization?: string | null;
  existingKingdoms?: ReadonlyArray<ExistingKingdomSpawn>;
  separationMin?: number;
  separationMax?: number;
}

export type SpawnPlacementStatus =
  | "solution_in_target_band"
  | "solution_min_separation_only"
  | "proven_infeasible_min_separation"
  | "search_exhausted_without_infeasibility_proof";

export interface SpawnPlacementDiagnostics {
  cell: WorldCell | null;
  civilization: string | null;
  zoneAnchor: HexCoord | null;
  zoneLabel: string | null;
  nearestDistance: number | null;
  nearestSameCivDistance: number | null;
  distanceToAnchor: number | null;
  withinTargetBand: boolean;
  meetsMinSeparation: boolean;
  status: SpawnPlacementStatus;
  provenInfeasible: boolean;
  reason: string;
}

export interface WorldSpawnGeometryAnalysis {
  readonly radius: number;
  readonly totalCells: number;
  readonly diameter: number;
  readonly separationMin: number;
  readonly separationMax: number;
  readonly exclusionDiskRadius: number;
  readonly fullExclusionDiskCells: number;
  readonly minDiskIntersectionCells: number;
  readonly minDiskIntersectionCoord: HexCoord;
  readonly conservativeIntersectionUpperBound: number;
  readonly constructiveGreedyCountAtMinSeparation: number;
  readonly constructivePlacement: ReadonlyArray<HexCoord>;
  readonly constructiveMinPairwiseDistance: number | null;
  readonly constructiveVerified: boolean;
  readonly constructiveClusterCountAtBand30: number;
  readonly notes: string;
}

/**
 * Análisis geométrico riguroso de empaquetamiento hexagonal sobre el disco canónico de radio R.
 *
 * Para R = 50 y separación mínima d_min = 20:
 * - Radio del disco de exclusión disjunto: r_ex = floor((20 - 1) / 2) = 9.
 * - Disco completo de radio 9: 1 + 3 × 9 × 10 = 271 celdas.
 * - Intersección mínima real entre el disco de radio 9 y el mapa de radio 50 (verificada
 *   exhaustivamente en las 7.651 posiciones válidas): 100 celdas (vértices del borde).
 * - Cota superior conservadora válida: floor(7.651 / 100) = 76 capitales.
 *   (Es una cota superior, NO una afirmación de que quepan 76 capitales.)
 * - La distribución constructiva se devuelve explícitamente y se verifica por parejas.
 */
export function analyzeWorldSpawnGeometry(
  radius: number = MAP.RADIUS,
  separationMin: number = TERRITORIES.SPAWN_SEPARATION_MIN,
  separationMax: number = TERRITORIES.SPAWN_SEPARATION_MAX
): WorldSpawnGeometryAnalysis {
  const totalCells = 1 + 3 * radius * (radius + 1);
  const diameter = 2 * radius;
  const exclusionDiskRadius = Math.max(0, Math.floor((separationMin - 1) / 2));
  const fullExclusionDiskCells = 1 + 3 * exclusionDiskRadius * (exclusionDiskRadius + 1);

  // Recorrido exhaustivo de todas las posiciones válidas del mapa para hallar la intersección mínima real
  // entre el disco de exclusión de radio `exclusionDiskRadius` y el disco del mundo de radio `radius`.
  let minDiskIntersectionCells = Infinity;
  let minDiskIntersectionCoord: HexCoord = { q: 0, r: 0 };

  for (let q = -radius; q <= radius; q++) {
    const rLow = Math.max(-radius, -q - radius);
    const rHigh = Math.min(radius, -q + radius);
    for (let r = rLow; r <= rHigh; r++) {
      // Intersección del disco centrado en (q, r) de radio exclusionDiskRadius con el disco centrado en (0, 0) de radio radius
      const qMin = Math.max(-radius, q - exclusionDiskRadius);
      const qMax = Math.min(radius, q + exclusionDiskRadius);
      let count = 0;
      for (let cq = qMin; cq <= qMax; cq++) {
        const dq = cq - q;
        const rMinWorld = Math.max(-radius, -cq - radius);
        const rMaxWorld = Math.min(radius, -cq + radius);
        const rMinDisk = r + Math.max(-exclusionDiskRadius, -dq - exclusionDiskRadius);
        const rMaxDisk = r + Math.min(exclusionDiskRadius, -dq + exclusionDiskRadius);
        const lo = Math.max(rMinWorld, rMinDisk);
        const hi = Math.min(rMaxWorld, rMaxDisk);
        if (hi >= lo) {
          count += hi - lo + 1;
        }
      }
      if (count < minDiskIntersectionCells) {
        minDiskIntersectionCells = count;
        minDiskIntersectionCoord = { q, r };
      }
    }
  }

  const conservativeIntersectionUpperBound =
    minDiskIntersectionCells > 0 ? Math.floor(totalCells / minDiskIntersectionCells) : 0;

  // Distribución constructiva determinista (voraz axial) y verificación por parejas
  const constructivePlacement: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      const candidate = { q, r };
      if (constructivePlacement.every((p) => hexDistance(candidate, p) >= separationMin)) {
        constructivePlacement.push(candidate);
      }
    }
  }

  let constructiveMinPairwiseDistance: number | null = null;
  let constructiveVerified = true;
  for (let i = 0; i < constructivePlacement.length; i++) {
    if (!isInsideWorld(constructivePlacement[i], radius)) {
      constructiveVerified = false;
    }
    for (let j = i + 1; j < constructivePlacement.length; j++) {
      const d = hexDistance(constructivePlacement[i], constructivePlacement[j]);
      if (constructiveMinPairwiseDistance === null || d < constructiveMinPairwiseDistance) {
        constructiveMinPairwiseDistance = d;
      }
      if (d < separationMin) {
        constructiveVerified = false;
      }
    }
  }

  // Solución constructiva en una subregión de diámetro <= separationMax (radio = floor(separationMax / 2))
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
    exclusionDiskRadius,
    fullExclusionDiskCells,
    minDiskIntersectionCells,
    minDiskIntersectionCoord,
    conservativeIntersectionUpperBound,
    constructiveGreedyCountAtMinSeparation: constructivePlacement.length,
    constructivePlacement,
    constructiveMinPairwiseDistance,
    constructiveVerified,
    constructiveClusterCountAtBand30: clusterPlaced.length,
    notes:
      `En radio ${radius} (${totalCells} celdas, diámetro ${diameter}) con separación mínima ${separationMin}: ` +
      `el disco de exclusión tiene radio ${exclusionDiskRadius} (${fullExclusionDiskCells} celdas completo), ` +
      `pero su intersección mínima real con el mapa en el borde es de ${minDiskIntersectionCells} celdas ` +
      `(en ${minDiskIntersectionCoord.q},${minDiskIntersectionCoord.r}). ` +
      `Cota superior conservadora válida: floor(${totalCells}/${minDiskIntersectionCells}) = ${conservativeIntersectionUpperBound} ` +
      `(cota superior, no afirmación de alcanzabilidad). ` +
      `Distribución constructiva verificada por parejas: ${constructivePlacement.length} capitales ` +
      `(d_min observada = ${constructiveMinPairwiseDistance ?? "N/A"}). ` +
      `En una subregión de diámetro ${separationMax}, el algoritmo constructivo ubica ${clusterPlaced.length} capitales.`,
  };
}

/**
 * Selecciona la casilla inicial con agrupación geográfica por civilización y banda objetivo [20, 30] hexágonos.
 * Reglas:
 * - La civilización determina el ancla regional (sin usar el centro del mundo como posición predeterminada).
 * - La primera capital de una civilización utiliza su ancla regional si está libre y cumple la separación mínima.
 * - La separación mínima (20) tiene prioridad estricta frente a la preferencia de región.
 * - Se favorece la banda [20, 30] respecto a reinos de la misma civilización y agrupación regional.
 * - Desempate determinista por `cellId`.
 * - Nunca asigna celdas fuera del mapa ni ocupadas.
 * - Si no se pasa `options`, mantiene compatibilidad determinista para llamadas heredadas sin civilización.
 */
export function chooseHomeCellWithDiagnostics(
  cells: ReadonlyArray<WorldCell>,
  occupiedCellIds: ReadonlySet<string>,
  existingHomes: ReadonlyArray<HexCoord>,
  options?: SpawnPlacementOptions
): SpawnPlacementDiagnostics {
  const free = cells.filter((cell) => isInsideWorld(cell, MAP.RADIUS) && !occupiedCellIds.has(cell.cellId));
  const normCiv = normalizeCivilizationId(options?.civilization);
  const zone = normCiv ? CIVILIZATION_ZONES[normCiv] ?? null : null;
  const anchor: HexCoord | null = zone ? { q: zone.q, r: zone.r } : null;

  if (free.length === 0) {
    return {
      cell: null,
      civilization: normCiv,
      zoneAnchor: anchor,
      zoneLabel: zone?.label ?? null,
      nearestDistance: null,
      nearestSameCivDistance: null,
      distanceToAnchor: null,
      withinTargetBand: false,
      meetsMinSeparation: false,
      status: "proven_infeasible_min_separation",
      provenInfeasible: true,
      reason: "No hay casillas libres disponibles dentro del mapa.",
    };
  }

  const minSep = options?.separationMin ?? TERRITORIES.SPAWN_SEPARATION_MIN;
  const maxSep = options?.separationMax ?? TERRITORIES.SPAWN_SEPARATION_MAX;
  const idealMid = (minSep + maxSep) / 2;

  if (!options) {
    if (existingHomes.length === 0) {
      const center = free.find((cell) => cell.q === 0 && cell.r === 0) ?? free[0];
      return {
        cell: center,
        civilization: null,
        zoneAnchor: null,
        zoneLabel: null,
        nearestDistance: null,
        nearestSameCivDistance: null,
        distanceToAnchor: null,
        withinTargetBand: true,
        meetsMinSeparation: true,
        status: "solution_in_target_band",
        provenInfeasible: false,
        reason: "Primer reino sin civilización especificada asignado de forma determinista.",
      };
    }
    let best: WorldCell | null = null;
    let bestScore = -1;
    for (const cell of free) {
      let score = Infinity;
      for (const home of existingHomes) {
        const d = hexDistance(cell, home);
        if (d < score) score = d;
      }
      if (score > bestScore || (score === bestScore && best && cell.cellId < best.cellId)) {
        best = cell;
        bestScore = score;
      }
    }
    const meetsMin = bestScore >= minSep;
    const inBand = bestScore >= minSep && bestScore <= maxSep;
    return {
      cell: best,
      civilization: null,
      zoneAnchor: null,
      zoneLabel: null,
      nearestDistance: bestScore,
      nearestSameCivDistance: null,
      distanceToAnchor: null,
      withinTargetBand: inBand,
      meetsMinSeparation: meetsMin,
      status: inBand
        ? "solution_in_target_band"
        : meetsMin
          ? "solution_min_separation_only"
          : "proven_infeasible_min_separation",
      provenInfeasible: !meetsMin,
      reason: "Asignación determinista por distancia máxima mínima (sin civilización).",
    };
  }

  const existing: ReadonlyArray<ExistingKingdomSpawn> =
    options.existingKingdoms && options.existingKingdoms.length > 0
      ? options.existingKingdoms
      : existingHomes.map((h) => ({ q: h.q, r: h.r, civilization: null }));

  // Primer reino del mundo: si tiene ancla de civilización, usa SIEMPRE su ancla regional (no el centro)
  if (existing.length === 0) {
    const targetRef: HexCoord = anchor ?? { q: 0, r: 0 };
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
      zoneAnchor: anchor,
      zoneLabel: zone?.label ?? null,
      nearestDistance: null,
      nearestSameCivDistance: null,
      distanceToAnchor: anchor ? bestAnchorDist : null,
      withinTargetBand: true,
      meetsMinSeparation: true,
      status: "solution_in_target_band",
      provenInfeasible: false,
      reason: zone
        ? `Primera capital de ${normCiv} asignada en su ancla regional (${zone.label}: ${best.cellId}).`
        : `Primer reino sin ancla regional asignado en ${best.cellId}.`,
    };
  }

  const sameCiv = normCiv
    ? existing.filter((k) => normalizeCivilizationId(k.civilization) === normCiv)
    : [];

  // Si es la primera capital de esta civilización y su ancla regional está libre y respeta d >= minSep, usarla directamente
  if (sameCiv.length === 0 && anchor) {
    const anchorId = cellId(anchor.q, anchor.r);
    if (!occupiedCellIds.has(anchorId)) {
      const anchorCell = free.find((c) => c.cellId === anchorId);
      if (anchorCell) {
        let nearestAtAnchor = Infinity;
        for (const k of existing) {
          const d = hexDistance(anchorCell, k);
          if (d < nearestAtAnchor) nearestAtAnchor = d;
        }
        if (nearestAtAnchor >= minSep) {
          const inBand = nearestAtAnchor <= maxSep;
          return {
            cell: anchorCell,
            civilization: normCiv,
            zoneAnchor: anchor,
            zoneLabel: zone?.label ?? null,
            nearestDistance: nearestAtAnchor,
            nearestSameCivDistance: null,
            distanceToAnchor: 0,
            withinTargetBand: inBand,
            meetsMinSeparation: true,
            status: inBand ? "solution_in_target_band" : "solution_min_separation_only",
            provenInfeasible: false,
            reason: inBand
              ? `Primera capital de ${normCiv} en su ancla regional (${zone?.label}) dentro de la banda [${minSep}, ${maxSep}].`
              : `Primera capital de ${normCiv} en su ancla regional (${zone?.label}); separación mínima >= ${minSep} cumplida (d = ${nearestAtAnchor}).`,
          };
        }
      }
    }
  }

  interface CandidateScore {
    cell: WorldCell;
    tier: number; // 0 = cumple banda objetivo; 1 = cumple minSep pero fuera de banda
    cost: number;
    nearest: number;
    nearestSame: number | null;
    anchorDist: number;
    inBand: boolean;
  }

  let bestFeasible: CandidateScore | null = null;
  let bestFallback: { cell: WorldCell; nearest: number; nearestSame: number | null; anchorDist: number } | null = null;

  for (const cell of free) {
    let nearest = Infinity;
    for (const k of existing) {
      const d = hexDistance(cell, k);
      if (d < nearest) nearest = d;
    }

    let nearestSame: number | null = null;
    if (sameCiv.length > 0) {
      let ns = Infinity;
      for (const k of sameCiv) {
        const d = hexDistance(cell, k);
        if (d < ns) ns = d;
      }
      nearestSame = ns;
    }

    const anchorDist = anchor ? hexDistance(cell, anchor) : 0;

    // Prioridad 1 absoluta: separación mínima >= minSep
    if (nearest < minSep) {
      if (
        !bestFallback ||
        nearest > bestFallback.nearest ||
        (nearest === bestFallback.nearest && anchorDist < bestFallback.anchorDist) ||
        (nearest === bestFallback.nearest && anchorDist === bestFallback.anchorDist && cell.cellId < bestFallback.cell.cellId)
      ) {
        bestFallback = { cell, nearest, nearestSame, anchorDist };
      }
      continue;
    }

    let inBand: boolean;
    let tier: number;
    let cost: number;

    if (sameCiv.length > 0 && nearestSame !== null) {
      // Misma civilización: favorecer distancia [20, 30] a la misma civilización y cercanía al ancla regional
      inBand = nearestSame >= minSep && nearestSame <= maxSep;
      tier = inBand ? 0 : 1;
      const bandOverflow = nearestSame > maxSep ? (nearestSame - maxSep) * 4 : 0;
      cost = bandOverflow + anchorDist * 1.5 + Math.abs(nearestSame - idealMid) * 0.5;
    } else if (anchor) {
      // Primera capital de su civilización pero el ancla exacta estaba ocupada o a d < 20 de otra capital:
      // priorizar cercanía al ancla respetando d >= 20, y desempatar hacia banda [20, 30]
      inBand = nearest >= minSep && nearest <= maxSep;
      tier = 0;
      const farPenalty = nearest > maxSep ? (nearest - maxSep) * 0.15 : 0;
      cost = anchorDist * 2 + farPenalty;
    } else {
      inBand = nearest >= minSep && nearest <= maxSep;
      tier = inBand ? 0 : 1;
      cost = Math.abs(nearest - idealMid);
    }

    if (
      !bestFeasible ||
      tier < bestFeasible.tier ||
      (tier === bestFeasible.tier && cost < bestFeasible.cost) ||
      (tier === bestFeasible.tier && cost === bestFeasible.cost && cell.cellId < bestFeasible.cell.cellId)
    ) {
      bestFeasible = { cell, tier, cost, nearest, nearestSame, anchorDist, inBand };
    }
  }

  if (bestFeasible) {
    return {
      cell: bestFeasible.cell,
      civilization: normCiv,
      zoneAnchor: anchor,
      zoneLabel: zone?.label ?? null,
      nearestDistance: bestFeasible.nearest,
      nearestSameCivDistance: bestFeasible.nearestSame,
      distanceToAnchor: anchor ? bestFeasible.anchorDist : null,
      withinTargetBand: bestFeasible.inBand,
      meetsMinSeparation: true,
      status: bestFeasible.inBand ? "solution_in_target_band" : "solution_min_separation_only",
      provenInfeasible: false,
      reason: bestFeasible.inBand
        ? `Ubicado en la banda objetivo [${minSep}, ${maxSep}]` + (zone ? ` (${zone.label}).` : ".")
        : `Separación mínima >= ${minSep} preservada (d_min = ${bestFeasible.nearest}); banda <= ${maxSep} no alcanzada para esta posición.`,
    };
  }

  // Búsqueda exhaustiva en todas las casillas libres del mapa sin ninguna candidata con d >= minSep:
  // inviabilidad demostrada para este siguiente reino dada la configuración actual.
  return {
    cell: bestFallback?.cell ?? null,
    civilization: normCiv,
    zoneAnchor: anchor,
    zoneLabel: zone?.label ?? null,
    nearestDistance: bestFallback?.nearest ?? null,
    nearestSameCivDistance: bestFallback?.nearestSame ?? null,
    distanceToAnchor: anchor && bestFallback ? bestFallback.anchorDist : null,
    withinTargetBand: false,
    meetsMinSeparation: false,
    status: "proven_infeasible_min_separation",
    provenInfeasible: true,
    reason: `Inviabilidad demostrada (búsqueda exhaustiva sobre ${free.length} celdas libres): ninguna celda libre cumple d >= ${minSep}; mejor separación disponible = ${bestFallback?.nearest ?? 0}.`,
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

export interface MultiKingdomSpawnRequest {
  readonly kingdomId: string;
  readonly civilization?: string | null;
}

export interface MultiKingdomDistributionResult {
  readonly status:
    | "solution_in_target_band"
    | "solution_min_separation_only"
    | "proven_infeasible"
    | "search_exhausted";
  readonly assignments: ReadonlyArray<{
    readonly kingdomId: string;
    readonly civilization: string | null;
    readonly cellId: string;
    readonly q: number;
    readonly r: number;
    readonly distanceToAnchor: number | null;
    readonly nearestCapitalDistance: number | null;
    readonly nearestSameCivDistance: number | null;
    readonly withinTargetBand: boolean;
  }>;
  readonly minPairwiseDistance: number | null;
  readonly allMeetMinSeparation: boolean;
  readonly allMeetTargetBand: boolean;
  readonly outOfTargetBandKingdomIds: ReadonlyArray<string>;
  readonly verifiedAllPairwiseDistances: boolean;
  readonly attemptsUsed: number;
  readonly maxAttempts: number;
  readonly upperBoundAtMinSeparation: number;
  readonly notes: string;
}

/**
 * Optimizador determinista acotado para distribuir un conjunto de reinos sobre el mapa canónico.
 * Soporta capitales fijas (`fixedKingdoms`) y celdas ocupadas (`occupiedCellIds`) que se reservan
 * durante todo el cálculo para distribución global de reinos existentes.
 * Separa explícitamente:
 * - solución en banda objetivo [20, 30]
 * - solución que respeta únicamente separación mínima (>= 20)
 * - inviabilidad demostrada (cuando N supera la cota superior geométrica real o búsqueda exhaustiva de 1 reino)
 * - búsqueda agotada sin demostrar inviabilidad (cuando se alcanza el límite de intentos)
 * Valida posteriormente TODAS las distancias por parejas.
 */
export function optimizeKingdomDistribution(
  requests: ReadonlyArray<MultiKingdomSpawnRequest>,
  radius: number = MAP.RADIUS,
  options?: {
    separationMin?: number;
    separationMax?: number;
    maxAttempts?: number;
    seed?: number;
    fixedKingdoms?: ReadonlyArray<ExistingKingdomSpawn>;
    occupiedCellIds?: ReadonlySet<string>;
  }
): MultiKingdomDistributionResult {
  const minSep = options?.separationMin ?? TERRITORIES.SPAWN_SEPARATION_MIN;
  const maxSep = options?.separationMax ?? TERRITORIES.SPAWN_SEPARATION_MAX;
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 6);
  const seed = options?.seed ?? MAP.WORLD_SEED;
  const fixedKingdoms = options?.fixedKingdoms ?? [];
  const extraOccupied = options?.occupiedCellIds ?? new Set<string>();

  const geometry = analyzeWorldSpawnGeometry(radius, minSep, maxSep);
  if (requests.length === 0) {
    return {
      status: "solution_in_target_band",
      assignments: [],
      minPairwiseDistance: null,
      allMeetMinSeparation: true,
      allMeetTargetBand: true,
      outOfTargetBandKingdomIds: [],
      verifiedAllPairwiseDistances: true,
      attemptsUsed: 0,
      maxAttempts,
      upperBoundAtMinSeparation: geometry.conservativeIntersectionUpperBound,
      notes: "No hay reinos pendientes de asignación.",
    };
  }

  const totalCapitals = fixedKingdoms.length + requests.length;
  if (totalCapitals > geometry.conservativeIntersectionUpperBound) {
    return {
      status: "proven_infeasible",
      assignments: [],
      minPairwiseDistance: null,
      allMeetMinSeparation: false,
      allMeetTargetBand: false,
      outOfTargetBandKingdomIds: requests.map((r) => r.kingdomId),
      verifiedAllPairwiseDistances: true,
      attemptsUsed: 0,
      maxAttempts,
      upperBoundAtMinSeparation: geometry.conservativeIntersectionUpperBound,
      notes: `Inviabilidad demostrada: se solicitan ${totalCapitals} capitales (${fixedKingdoms.length} fijas + ${requests.length} a recolocar) y la cota superior geométrica conservadora para R=${radius}, d>=${minSep} es ${geometry.conservativeIntersectionUpperBound}.`,
    };
  }

  const world = generateWorldCells(radius, seed);
  // Ordenaciones deterministas por ID y rotación por civilización (sin aleatoriedad)
  const baseSorted = [...requests].sort((a, b) => a.kingdomId.localeCompare(b.kingdomId));
  const orderings: MultiKingdomSpawnRequest[][] = [baseSorted];
  if (baseSorted.length > 1) {
    // Intercalar por civilización para favorecer primeras capitales en sus anclas
    const byCiv = new Map<string, MultiKingdomSpawnRequest[]>();
    for (const req of baseSorted) {
      const key = normalizeCivilizationId(req.civilization) ?? "_none";
      const list = byCiv.get(key) ?? [];
      list.push(req);
      byCiv.set(key, list);
    }
    const interleaved: MultiKingdomSpawnRequest[] = [];
    const civKeys = Array.from(byCiv.keys()).sort();
    let remaining = baseSorted.length;
    while (remaining > 0) {
      for (const ck of civKeys) {
        const list = byCiv.get(ck)!;
        if (list.length > 0) {
          interleaved.push(list.shift()!);
          remaining--;
        }
      }
    }
    orderings.push(interleaved);

    // Rotaciones deterministas adicionales hasta maxAttempts
    for (let shift = 1; orderings.length < maxAttempts && shift < interleaved.length; shift++) {
      const rotated = [...interleaved.slice(shift), ...interleaved.slice(0, shift)];
      orderings.push(rotated);
    }
  }

  let bestSolution: {
    assignments: Array<{
      kingdomId: string;
      civilization: string | null;
      cellId: string;
      q: number;
      r: number;
      distanceToAnchor: number | null;
    }>;
    minPairwise: number | null;
    allMin: boolean;
    allBand: boolean;
    bandCount: number;
  } | null = null;

  let attemptsUsed = 0;
  let singleRequestProvenInfeasible = false;

  for (let a = 0; a < Math.min(orderings.length, maxAttempts); a++) {
    attemptsUsed++;
    const order = orderings[a];
    const occupied = new Set<string>(extraOccupied);
    const placedHomes: HexCoord[] = [];
    const placedKingdoms: ExistingKingdomSpawn[] = [];

    for (const fk of fixedKingdoms) {
      occupied.add(cellId(fk.q, fk.r));
      placedHomes.push({ q: fk.q, r: fk.r });
      placedKingdoms.push(fk);
    }

    const current: Array<{
      kingdomId: string;
      civilization: string | null;
      cellId: string;
      q: number;
      r: number;
      distanceToAnchor: number | null;
    }> = [];

    let failedPlacement = false;
    for (const req of order) {
      const diag = chooseHomeCellWithDiagnostics(world, occupied, placedHomes, {
        civilization: req.civilization,
        existingKingdoms: placedKingdoms,
        separationMin: minSep,
        separationMax: maxSep,
      });
      if (!diag.cell || !diag.meetsMinSeparation) {
        if (order.length === 1 && diag.provenInfeasible) {
          singleRequestProvenInfeasible = true;
        }
        failedPlacement = true;
        break;
      }
      occupied.add(diag.cell.cellId);
      placedHomes.push({ q: diag.cell.q, r: diag.cell.r });
      placedKingdoms.push({
        q: diag.cell.q,
        r: diag.cell.r,
        civilization: req.civilization ?? null,
        kingdomId: req.kingdomId,
      });
      current.push({
        kingdomId: req.kingdomId,
        civilization: diag.civilization,
        cellId: diag.cell.cellId,
        q: diag.cell.q,
        r: diag.cell.r,
        distanceToAnchor: diag.distanceToAnchor,
      });
    }

    if (failedPlacement) continue;

    // Verificación exacta de TODAS las distancias por parejas (asignadas contra asignadas y fijas)
    const allCapitals: Array<{ kingdomId: string; civilization: string | null; q: number; r: number }> = [
      ...fixedKingdoms.map((fk, idx) => ({
        kingdomId: fk.kingdomId ?? `__fixed_${idx}`,
        civilization: normalizeCivilizationId(fk.civilization),
        q: fk.q,
        r: fk.r,
      })),
      ...current.map((c) => ({
        kingdomId: c.kingdomId,
        civilization: c.civilization,
        q: c.q,
        r: c.r,
      })),
    ];

    let minPairwise: number | null = null;
    let allMin = true;
    let bandCount = 0;

    for (const assigned of current) {
      let nearest = Infinity;
      let nearestSame = Infinity;
      let sameCivCount = 0;
      for (const other of allCapitals) {
        if (other.kingdomId === assigned.kingdomId) continue;
        const d = hexDistance(assigned, other);
        if (d < nearest) nearest = d;
        if (minPairwise === null || d < minPairwise) minPairwise = d;
        if (assigned.civilization && other.civilization === assigned.civilization) {
          sameCivCount++;
          if (d < nearestSame) nearestSame = d;
        }
      }
      if (allCapitals.length > 1 && nearest < minSep) allMin = false;
      const inBand =
        allCapitals.length <= 1
          ? true
          : sameCivCount > 0
            ? nearest >= minSep && nearestSame >= minSep && nearestSame <= maxSep
            : nearest >= minSep && (assigned.distanceToAnchor === 0 || nearest <= maxSep);
      if (inBand) bandCount++;
    }
    const allBand = allMin && bandCount === current.length;

    if (
      !bestSolution ||
      (allBand && !bestSolution.allBand) ||
      (allMin && !bestSolution.allMin) ||
      (allMin === bestSolution.allMin && bandCount > bestSolution.bandCount) ||
      (allMin === bestSolution.allMin &&
        bandCount === bestSolution.bandCount &&
        (minPairwise ?? 0) > (bestSolution.minPairwise ?? 0))
    ) {
      bestSolution = { assignments: current, minPairwise, allMin, allBand, bandCount };
    }

    if (allBand) break;
  }

  if (!bestSolution) {
    if (singleRequestProvenInfeasible) {
      return {
        status: "proven_infeasible",
        assignments: [],
        minPairwiseDistance: null,
        allMeetMinSeparation: false,
        allMeetTargetBand: false,
        outOfTargetBandKingdomIds: requests.map((r) => r.kingdomId),
        verifiedAllPairwiseDistances: true,
        attemptsUsed,
        maxAttempts,
        upperBoundAtMinSeparation: geometry.conservativeIntersectionUpperBound,
        notes: `Inviabilidad demostrada por búsqueda exhaustiva sobre las celdas libres restantes para separación >= ${minSep}.`,
      };
    }
    return {
      status: "search_exhausted",
      assignments: [],
      minPairwiseDistance: null,
      allMeetMinSeparation: false,
      allMeetTargetBand: false,
      outOfTargetBandKingdomIds: requests.map((r) => r.kingdomId),
      verifiedAllPairwiseDistances: true,
      attemptsUsed,
      maxAttempts,
      upperBoundAtMinSeparation: geometry.conservativeIntersectionUpperBound,
      notes: `Búsqueda acotada agotada (${attemptsUsed}/${maxAttempts} intentos) sin hallar asignación completa con d >= ${minSep}; esto NO demuestra inviabilidad matemática.`,
    };
  }

  // Enriquecer con distancia real al reino más próximo (global y misma civilización) y ordenar deterministamente por kingdomId
  const combinedCapitals: Array<{ kingdomId: string; civilization: string | null; q: number; r: number }> = [
    ...fixedKingdoms.map((fk, idx) => ({
      kingdomId: fk.kingdomId ?? `__fixed_${idx}`,
      civilization: normalizeCivilizationId(fk.civilization),
      q: fk.q,
      r: fk.r,
    })),
    ...bestSolution.assignments.map((c) => ({
      kingdomId: c.kingdomId,
      civilization: c.civilization,
      q: c.q,
      r: c.r,
    })),
  ];

  const finalAssignments = bestSolution.assignments
    .map((item) => {
      let nearest: number | null = null;
      let nearestSame: number | null = null;
      for (const other of combinedCapitals) {
        if (other.kingdomId === item.kingdomId) continue;
        const d = hexDistance(item, other);
        if (nearest === null || d < nearest) nearest = d;
        if (item.civilization && other.civilization === item.civilization) {
          if (nearestSame === null || d < nearestSame) nearestSame = d;
        }
      }
      const withinTargetBand =
        nearest === null
          ? true
          : nearestSame !== null
            ? nearest >= minSep && nearestSame >= minSep && nearestSame <= maxSep
            : nearest >= minSep && (item.distanceToAnchor === 0 || nearest <= maxSep);
      return {
        ...item,
        nearestCapitalDistance: nearest,
        nearestSameCivDistance: nearestSame,
        withinTargetBand,
      };
    })
    .sort((a, b) => a.kingdomId.localeCompare(b.kingdomId));

  const outOfTargetBandKingdomIds = finalAssignments
    .filter((a) => !a.withinTargetBand)
    .map((a) => a.kingdomId);

  const status: MultiKingdomDistributionResult["status"] = bestSolution.allBand
    ? "solution_in_target_band"
    : bestSolution.allMin
      ? "solution_min_separation_only"
      : "search_exhausted";

  return {
    status,
    assignments: finalAssignments,
    minPairwiseDistance: bestSolution.minPairwise,
    allMeetMinSeparation: bestSolution.allMin,
    allMeetTargetBand: bestSolution.allBand,
    outOfTargetBandKingdomIds,
    verifiedAllPairwiseDistances: true,
    attemptsUsed,
    maxAttempts,
    upperBoundAtMinSeparation: geometry.conservativeIntersectionUpperBound,
    notes:
      status === "solution_in_target_band"
        ? `Solución determinista verificada en banda [${minSep}, ${maxSep}] para ${finalAssignments.length} reinos.`
        : status === "solution_min_separation_only"
          ? `Solución determinista verificada respetando separación mínima >= ${minSep} (d_min = ${bestSolution.minPairwise}) para ${finalAssignments.length} reinos; fuera de banda [${minSep}, ${maxSep}]: ${outOfTargetBandKingdomIds.join(", ")}.`
          : `Búsqueda agotada (${attemptsUsed}/${maxAttempts} intentos) sin cumplir separación mínima >= ${minSep} (d_min = ${bestSolution.minPairwise}); no demuestra inviabilidad matemática.`,
  };
}

export type KingdomSpawnAuditStatus =
  | "correctly_positioned"
  | "planned"
  | "pending_activity"
  | "blocked_integrity"
  | "geometrically_infeasible"
  | "search_exhausted";

export interface ExistingKingdomAuditInput {
  readonly kingdomId: string;
  readonly name: string;
  readonly civilization?: string | null;
  readonly homeTerritoryId?: string | null;
  readonly persistedHomeCell?: {
    readonly cellId: string;
    readonly q: number;
    readonly r: number;
    readonly ownerKingdomId?: string | null;
    readonly isHome?: boolean;
  } | null;
  readonly ownedTerritoryCount: number;
  readonly ownedCellIds?: ReadonlyArray<string>;
  readonly markedHomeCount?: number;
  readonly duplicateTerritoryCellIds?: ReadonlyArray<string>;
  readonly activeMarchesCount: number;
  readonly activeChallengesCount: number;
  readonly activeExplorationsCount: number;
}

export interface KingdomSpawnAuditEntry {
  readonly kingdomId: string;
  readonly name: string;
  readonly civilization: string | null;
  readonly persistedHomeTerritoryId: string | null;
  readonly coord: HexCoord | null;
  readonly regionalAnchor: HexCoord | null;
  readonly nearestAnchorCivilization: string | null;
  readonly distanceToAnchor: number | null;
  readonly matchesCivilizationRegion: boolean;
  readonly nearestCapitalDistance: number | null;
  readonly nearestCapitalKingdomId: string | null;
  readonly nearestSameCivDistance: number | null;
  readonly sameCivGroupedWithinBand: boolean | null;
  readonly hasOccupationConflict: boolean;
  readonly conflictDetails: string[];
  readonly meetsMinSeparation: boolean;
  readonly meetsTargetBand: boolean;
  readonly requiresRelocation: boolean;
  readonly relocationReasons: string[];
  readonly status: KingdomSpawnAuditStatus;
  readonly relocationAction: "none" | "planned" | "pending_activity" | "blocked";
  readonly proposedHomeCellId: string | null;
  readonly proposedCoord: HexCoord | null;
  readonly proposedDistanceToAnchor: number | null;
  readonly proposedWithinTargetBand: boolean | null;
  readonly pendingActivityReasons: string[];
  readonly integrityBlockReasons: string[];
  readonly blockedReasons: string[];
}

export interface ExistingKingdomsSpawnAuditReport {
  readonly radius: number;
  readonly separationMin: number;
  readonly separationMax: number;
  readonly planFingerprint: string;
  readonly anchorsValid: boolean;
  readonly totalKingdoms: number;
  readonly correctlyPositionedCount: number;
  readonly kingdomsMeetingMinSeparation: number;
  readonly kingdomsMeetingTargetBand: number;
  readonly kingdomsWithConflicts: number;
  readonly kingdomsRequiringRelocation: number;
  readonly plannedRelocations: number;
  readonly pendingActivityRelocations: number;
  readonly blockedIntegrityRelocations: number;
  readonly geometricallyInfeasibleRelocations: number;
  readonly searchExhaustedRelocations: number;
  readonly blockedRelocations: number;
  readonly globalPlanStatus: MultiKingdomDistributionResult["status"] | "noop";
  readonly globalPlanMinPairwiseDistance: number | null;
  readonly globalPlanVerifiedAllPairwise: boolean;
  readonly outOfTargetBandKingdomIds: ReadonlyArray<string>;
  readonly readOnlyPlan: true;
  readonly entries: ReadonlyArray<KingdomSpawnAuditEntry>;
}

/** Hash determinista FNV-1a (doble 32 bits -> 16 hex) para detectar cambios entre simulación y aplicación. */
function computeDeterministicPlanFingerprint(payload: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c + i) & 0xff;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/**
 * Auditoría geográfica y plan global determinista de recolocación para reinos existentes.
 * NO modifica datos persistidos.
 *
 * Criterios de correcta ubicación:
 * 1. Dentro del mapa de radio 50.
 * 2. Capital coherente con la región de su civilización (`CIVILIZATION_ZONES`).
 * 3. Separación mínima >= 20 hexágonos respecto a todas las demás capitales.
 * 4. Banda objetivo [20, 30] entre reinos de la misma civilización cuando es geométricamente posible.
 * 5. Sin conflictos de ocupación ni inconsistencias entre `homeTerritoryId` e `isHome`.
 *
 * Distingue explícitamente:
 * - `correctly_positioned`
 * - `planned` (recolocación global verificada)
 * - `pending_activity` (marchas, expediciones o desafíos activos: no se interrumpen)
 * - `blocked_integrity` (incompatibilidad real demostrada: p. ej. duplicados o >100 territorios)
 * - `geometrically_infeasible` (imposibilidad geométrica demostrada)
 * - `search_exhausted` (búsqueda acotada agotada sin demostrar imposibilidad matemática)
 */
export function auditExistingKingdomSpawns(
  kingdoms: ReadonlyArray<ExistingKingdomAuditInput>,
  radius: number = MAP.RADIUS,
  options?: {
    separationMin?: number;
    separationMax?: number;
    maxAttempts?: number;
    occupiedCellIds?: ReadonlySet<string>;
  }
): ExistingKingdomsSpawnAuditReport {
  const minSep = options?.separationMin ?? TERRITORIES.SPAWN_SEPARATION_MIN;
  const maxSep = options?.separationMax ?? TERRITORIES.SPAWN_SEPARATION_MAX;
  const anchorCheck = verifyCivilizationAnchors(radius);
  const sorted = [...kingdoms].sort((a, b) => a.kingdomId.localeCompare(b.kingdomId));

  // Huella determinista del estado de entrada (detecta cualquier cambio entre simulación y ejecución)
  const fingerprintParts = sorted.map((k) =>
    [
      k.kingdomId,
      normalizeCivilizationId(k.civilization) ?? "",
      k.homeTerritoryId ?? "",
      k.persistedHomeCell
        ? `${k.persistedHomeCell.cellId}:${k.persistedHomeCell.ownerKingdomId ?? ""}:${k.persistedHomeCell.isHome ? 1 : 0}`
        : "none",
      String(k.ownedTerritoryCount),
      String(k.markedHomeCount ?? -1),
      (k.duplicateTerritoryCellIds ?? []).join("|"),
      String(k.activeMarchesCount),
      String(k.activeChallengesCount),
      String(k.activeExplorationsCount),
      (k.ownedCellIds ? [...k.ownedCellIds].sort().join("|") : ""),
    ].join(";")
  );
  if (options?.occupiedCellIds && options.occupiedCellIds.size > 0) {
    fingerprintParts.push(`__occ:${Array.from(options.occupiedCellIds).sort().join("|")}`);
  }
  const planFingerprint = computeDeterministicPlanFingerprint(
    `R=${radius};min=${minSep};max=${maxSep}::${fingerprintParts.join("\n")}`
  );

  // Detectar colisiones de coordenadas de capital entre reinos
  const kingdomsByCell = new Map<string, string[]>();
  const resolved = sorted.map((k) => {
    const normCiv = normalizeCivilizationId(k.civilization);
    const zone = normCiv ? CIVILIZATION_ZONES[normCiv] ?? null : null;
    const anchor = zone ? { q: zone.q, r: zone.r } : null;
    const parsedFromHomeId = k.homeTerritoryId ? parseCellId(k.homeTerritoryId) : null;
    const coord = k.persistedHomeCell
      ? { q: k.persistedHomeCell.q, r: k.persistedHomeCell.r }
      : parsedFromHomeId;
    const effectiveCellId = coord ? cellId(coord.q, coord.r) : null;
    if (effectiveCellId) {
      const list = kingdomsByCell.get(effectiveCellId) ?? [];
      list.push(k.kingdomId);
      kingdomsByCell.set(effectiveCellId, list);
    }
    return { k, normCiv, anchor, coord, effectiveCellId };
  });

  // Contar cuántos reinos existen por civilización
  const countByCiv = new Map<string, number>();
  for (const r of resolved) {
    if (r.normCiv) countByCiv.set(r.normCiv, (countByCiv.get(r.normCiv) ?? 0) + 1);
  }

  // Primera pasada: evaluar los 5 criterios de correcta ubicación y clasificar conflictos / actividades / bloqueos
  const preliminary = resolved.map((item) => {
    const conflictDetails: string[] = [];
    const relocationReasons: string[] = [];
    const integrityBlockReasons: string[] = [];
    const pendingActivityReasons: string[] = [];

    const insideMap = item.coord !== null && isInsideWorld(item.coord, radius);
    if (!insideMap) {
      const msg = "Capital ausente o fuera del radio canónico de 50 hexágonos.";
      conflictDetails.push(msg);
      relocationReasons.push(msg);
    }

    if (!item.k.homeTerritoryId) {
      const msg = "homeTerritoryId ausente en el documento del reino.";
      conflictDetails.push(msg);
      relocationReasons.push(msg);
    } else if (!parseCellId(item.k.homeTerritoryId)) {
      const msg = `homeTerritoryId '${item.k.homeTerritoryId}' tiene formato axial inválido.`;
      conflictDetails.push(msg);
      relocationReasons.push(msg);
    }

    if (
      item.k.homeTerritoryId &&
      item.k.persistedHomeCell &&
      item.k.homeTerritoryId !== item.k.persistedHomeCell.cellId
    ) {
      const msg = `Incoherencia entre homeTerritoryId (${item.k.homeTerritoryId}) y territorio persistido (${item.k.persistedHomeCell.cellId}).`;
      conflictDetails.push(msg);
      relocationReasons.push(msg);
    }

    if (item.k.persistedHomeCell && item.k.persistedHomeCell.isHome !== true) {
      const msg = `La celda de capital (${item.k.persistedHomeCell.cellId}) no está marcada con isHome: true.`;
      conflictDetails.push(msg);
      relocationReasons.push(msg);
    }

    if (item.k.markedHomeCount !== undefined && item.k.markedHomeCount !== 1 && item.k.ownedTerritoryCount > 0) {
      const msg = `Inconsistencia en marcas isHome: existen ${item.k.markedHomeCount} territorios marcados como capital (debe ser exactamente 1).`;
      conflictDetails.push(msg);
      relocationReasons.push(msg);
    }

    if (
      item.k.persistedHomeCell &&
      item.k.persistedHomeCell.ownerKingdomId &&
      item.k.persistedHomeCell.ownerKingdomId !== item.k.kingdomId
    ) {
      const msg = `La casilla de capital pertenece a otro reino (${item.k.persistedHomeCell.ownerKingdomId}).`;
      conflictDetails.push(msg);
      relocationReasons.push(msg);
    }

    if (item.effectiveCellId && (kingdomsByCell.get(item.effectiveCellId)?.length ?? 0) > 1) {
      const msg = `Colisión de capital en ${item.effectiveCellId} con otro reino.`;
      conflictDetails.push(msg);
      relocationReasons.push(msg);
    }

    if ((item.k.duplicateTerritoryCellIds?.length ?? 0) > 0) {
      const msg = `Registros de territorio duplicados detectados (${item.k.duplicateTerritoryCellIds!.join(", ")}); requiere saneamiento de integridad previo.`;
      conflictDetails.push(msg);
      relocationReasons.push(msg);
      integrityBlockReasons.push(msg);
    }

    if (item.k.ownedTerritoryCount > TERRITORIES.MAX_PER_KINGDOM) {
      const msg = `El reino posee ${item.k.ownedTerritoryCount} territorios (> ${TERRITORIES.MAX_PER_KINGDOM}); requiere saneamiento del límite territorial (Punto 2) antes de recolocar.`;
      integrityBlockReasons.push(msg);
    }

    let nearestDist: number | null = null;
    let nearestId: string | null = null;
    let nearestSameDist: number | null = null;

    if (item.coord) {
      for (const other of resolved) {
        if (other.k.kingdomId === item.k.kingdomId || !other.coord) continue;
        const d = hexDistance(item.coord, other.coord);
        if (nearestDist === null || d < nearestDist) {
          nearestDist = d;
          nearestId = other.k.kingdomId;
        }
        if (item.normCiv && other.normCiv === item.normCiv) {
          if (nearestSameDist === null || d < nearestSameDist) {
            nearestSameDist = d;
          }
        }
      }
    }

    // Evaluar correspondencia con la región geográfica de la civilización
    const distanceToAnchor = item.coord && item.anchor ? hexDistance(item.coord, item.anchor) : null;
    let nearestAnchorCiv: string | null = null;
    let nearestAnchorDist: number | null = null;
    if (item.coord) {
      for (const [civKey, zone] of Object.entries(CIVILIZATION_ZONES)) {
        const d = hexDistance(item.coord, zone);
        if (
          nearestAnchorDist === null ||
          d < nearestAnchorDist ||
          (d === nearestAnchorDist && civKey === item.normCiv)
        ) {
          nearestAnchorDist = d;
          nearestAnchorCiv = civKey;
        }
      }
    }

    const sameCivCount = item.normCiv ? (countByCiv.get(item.normCiv) ?? 1) : 1;
    const sameCivGroupedWithinBand =
      nearestSameDist === null ? null : nearestSameDist >= minSep && nearestSameDist <= maxSep;

    let matchesCivilizationRegion = true;
    if (item.anchor) {
      if (!item.coord || distanceToAnchor === null || nearestAnchorDist === null) {
        matchesCivilizationRegion = false;
      } else if (distanceToAnchor > maxSep) {
        matchesCivilizationRegion = false;
      } else if (
        distanceToAnchor > nearestAnchorDist &&
        sameCivGroupedWithinBand !== true
      ) {
        matchesCivilizationRegion = false;
      }
    }

    if (!matchesCivilizationRegion && item.anchor) {
      relocationReasons.push(
        `Capital fuera de la región de ${item.normCiv} (ancla en ${item.anchor.q},${item.anchor.r}, distancia=${distanceToAnchor ?? "N/A"}, ancla más cercana=${nearestAnchorCiv ?? "N/A"} a ${nearestAnchorDist ?? "N/A"}).`
      );
    }

    const hasOccupationConflict = conflictDetails.length > 0;
    const meetsMinSeparation = !hasOccupationConflict && (nearestDist === null || nearestDist >= minSep);
    if (nearestDist !== null && nearestDist < minSep) {
      relocationReasons.push(
        `Separación mínima incumplida: distancia ${nearestDist} < ${minSep} respecto al reino '${nearestId}'.`
      );
    }

    const sameCivOutsideTargetBand =
      sameCivCount >= 2 && nearestSameDist !== null && nearestSameDist > maxSep;
    if (sameCivOutsideTargetBand) {
      relocationReasons.push(
        `Distancia entre reinos de la misma civilización (${item.normCiv}) fuera de la banda [${minSep}, ${maxSep}]: ${nearestSameDist} > ${maxSep}.`
      );
    }

    const meetsTargetBand =
      meetsMinSeparation &&
      matchesCivilizationRegion &&
      !sameCivOutsideTargetBand &&
      (nearestSameDist === null ? true : nearestSameDist >= minSep && nearestSameDist <= maxSep);

    // Actividades en curso que dependen de la posición actual: NO se interrumpen, quedan pendientes
    if (item.k.activeMarchesCount > 0) {
      pendingActivityReasons.push(
        `Existen ${item.k.activeMarchesCount} marchas militares activas vinculadas a la posición actual.`
      );
    }
    if (item.k.activeExplorationsCount > 0) {
      pendingActivityReasons.push(
        `Existen ${item.k.activeExplorationsCount} expediciones de exploración activas desde la posición actual.`
      );
    }
    if (item.k.activeChallengesCount > 0) {
      pendingActivityReasons.push(
        `Existen ${item.k.activeChallengesCount} desafíos activos vinculados a las coordenadas actuales.`
      );
    }

    const requiresRelocation =
      !insideMap ||
      hasOccupationConflict ||
      !meetsMinSeparation ||
      !matchesCivilizationRegion ||
      sameCivOutsideTargetBand;

    return {
      ...item,
      insideMap,
      conflictDetails,
      relocationReasons,
      integrityBlockReasons,
      pendingActivityReasons,
      hasOccupationConflict,
      nearestDist,
      nearestId,
      nearestSameDist,
      distanceToAnchor,
      nearestAnchorCiv,
      matchesCivilizationRegion,
      meetsMinSeparation,
      meetsTargetBand,
      sameCivGroupedWithinBand,
      requiresRelocation,
    };
  });

  // Segunda pasada: separar reinos fijos (correctos, pendientes por actividad o bloqueados por integridad)
  // de los reinos movibles que se distribuirán CONJUNTAMENTE mediante el optimizador determinista global.
  const fixedKingdoms: ExistingKingdomSpawn[] = [];
  const reservedOccupied = new Set<string>(options?.occupiedCellIds ?? []);
  const movableRequests: MultiKingdomSpawnRequest[] = [];
  const movableById = new Map<string, (typeof preliminary)[number]>();

  for (const p of preliminary) {
    // Reservar todas las celdas no-capitales poseídas por cualquier reino (nunca se pisan territorios ajenos)
    if (p.k.ownedCellIds) {
      for (const cid of p.k.ownedCellIds) {
        if (cid !== p.effectiveCellId) {
          reservedOccupied.add(cid);
        }
      }
    }

    const isFixed =
      !p.requiresRelocation ||
      p.integrityBlockReasons.length > 0 ||
      p.pendingActivityReasons.length > 0;

    if (isFixed) {
      if (p.coord && p.insideMap) {
        reservedOccupied.add(cellId(p.coord.q, p.coord.r));
        fixedKingdoms.push({
          q: p.coord.q,
          r: p.coord.r,
          civilization: p.normCiv,
          kingdomId: p.k.kingdomId,
        });
      }
    } else {
      movableRequests.push({
        kingdomId: p.k.kingdomId,
        civilization: p.normCiv,
      });
      movableById.set(p.k.kingdomId, p);
    }
  }

  // Distribución global conjunta de todos los reinos movibles respetando los fijos y las celdas ocupadas
  let globalOpt: MultiKingdomDistributionResult | null = null;
  if (movableRequests.length > 0) {
    globalOpt = optimizeKingdomDistribution(movableRequests, radius, {
      separationMin: minSep,
      separationMax: maxSep,
      maxAttempts: options?.maxAttempts ?? 8,
      fixedKingdoms,
      occupiedCellIds: reservedOccupied,
    });
  }

  const assignmentById = new Map(
    (globalOpt?.assignments ?? []).map((a) => [a.kingdomId, a])
  );

  // Construir informe final por reino
  const entries: KingdomSpawnAuditEntry[] = preliminary.map((p) => {
    if (!p.requiresRelocation) {
      return {
        kingdomId: p.k.kingdomId,
        name: p.k.name,
        civilization: p.normCiv,
        persistedHomeTerritoryId: p.k.homeTerritoryId ?? null,
        coord: p.coord,
        regionalAnchor: p.anchor,
        nearestAnchorCivilization: p.nearestAnchorCiv,
        distanceToAnchor: p.distanceToAnchor,
        matchesCivilizationRegion: p.matchesCivilizationRegion,
        nearestCapitalDistance: p.nearestDist,
        nearestCapitalKingdomId: p.nearestId,
        nearestSameCivDistance: p.nearestSameDist,
        sameCivGroupedWithinBand: p.sameCivGroupedWithinBand,
        hasOccupationConflict: false,
        conflictDetails: [],
        meetsMinSeparation: true,
        meetsTargetBand: p.meetsTargetBand,
        requiresRelocation: false,
        relocationReasons: [],
        status: "correctly_positioned",
        relocationAction: "none",
        proposedHomeCellId: null,
        proposedCoord: null,
        proposedDistanceToAnchor: null,
        proposedWithinTargetBand: null,
        pendingActivityReasons: [],
        integrityBlockReasons: [],
        blockedReasons: [],
      };
    }

    if (p.integrityBlockReasons.length > 0) {
      return {
        kingdomId: p.k.kingdomId,
        name: p.k.name,
        civilization: p.normCiv,
        persistedHomeTerritoryId: p.k.homeTerritoryId ?? null,
        coord: p.coord,
        regionalAnchor: p.anchor,
        nearestAnchorCivilization: p.nearestAnchorCiv,
        distanceToAnchor: p.distanceToAnchor,
        matchesCivilizationRegion: p.matchesCivilizationRegion,
        nearestCapitalDistance: p.nearestDist,
        nearestCapitalKingdomId: p.nearestId,
        nearestSameCivDistance: p.nearestSameDist,
        sameCivGroupedWithinBand: p.sameCivGroupedWithinBand,
        hasOccupationConflict: p.hasOccupationConflict,
        conflictDetails: p.conflictDetails,
        meetsMinSeparation: p.meetsMinSeparation,
        meetsTargetBand: p.meetsTargetBand,
        requiresRelocation: true,
        relocationReasons: p.relocationReasons,
        status: "blocked_integrity",
        relocationAction: "blocked",
        proposedHomeCellId: null,
        proposedCoord: null,
        proposedDistanceToAnchor: null,
        proposedWithinTargetBand: null,
        pendingActivityReasons: p.pendingActivityReasons,
        integrityBlockReasons: p.integrityBlockReasons,
        blockedReasons: [...p.integrityBlockReasons, ...p.pendingActivityReasons],
      };
    }

    if (p.pendingActivityReasons.length > 0) {
      return {
        kingdomId: p.k.kingdomId,
        name: p.k.name,
        civilization: p.normCiv,
        persistedHomeTerritoryId: p.k.homeTerritoryId ?? null,
        coord: p.coord,
        regionalAnchor: p.anchor,
        nearestAnchorCivilization: p.nearestAnchorCiv,
        distanceToAnchor: p.distanceToAnchor,
        matchesCivilizationRegion: p.matchesCivilizationRegion,
        nearestCapitalDistance: p.nearestDist,
        nearestCapitalKingdomId: p.nearestId,
        nearestSameCivDistance: p.nearestSameDist,
        sameCivGroupedWithinBand: p.sameCivGroupedWithinBand,
        hasOccupationConflict: p.hasOccupationConflict,
        conflictDetails: p.conflictDetails,
        meetsMinSeparation: p.meetsMinSeparation,
        meetsTargetBand: p.meetsTargetBand,
        requiresRelocation: true,
        relocationReasons: p.relocationReasons,
        status: "pending_activity",
        relocationAction: "pending_activity",
        proposedHomeCellId: null,
        proposedCoord: null,
        proposedDistanceToAnchor: null,
        proposedWithinTargetBand: null,
        pendingActivityReasons: p.pendingActivityReasons,
        integrityBlockReasons: [],
        blockedReasons: p.pendingActivityReasons,
      };
    }

    const assigned = assignmentById.get(p.k.kingdomId);
    if (
      assigned &&
      globalOpt &&
      (globalOpt.status === "solution_in_target_band" || globalOpt.status === "solution_min_separation_only")
    ) {
      return {
        kingdomId: p.k.kingdomId,
        name: p.k.name,
        civilization: p.normCiv,
        persistedHomeTerritoryId: p.k.homeTerritoryId ?? null,
        coord: p.coord,
        regionalAnchor: p.anchor,
        nearestAnchorCivilization: p.nearestAnchorCiv,
        distanceToAnchor: p.distanceToAnchor,
        matchesCivilizationRegion: p.matchesCivilizationRegion,
        nearestCapitalDistance: p.nearestDist,
        nearestCapitalKingdomId: p.nearestId,
        nearestSameCivDistance: p.nearestSameDist,
        sameCivGroupedWithinBand: p.sameCivGroupedWithinBand,
        hasOccupationConflict: p.hasOccupationConflict,
        conflictDetails: p.conflictDetails,
        meetsMinSeparation: p.meetsMinSeparation,
        meetsTargetBand: p.meetsTargetBand,
        requiresRelocation: true,
        relocationReasons: p.relocationReasons,
        status: "planned",
        relocationAction: "planned",
        proposedHomeCellId: assigned.cellId,
        proposedCoord: { q: assigned.q, r: assigned.r },
        proposedDistanceToAnchor: assigned.distanceToAnchor,
        proposedWithinTargetBand: assigned.withinTargetBand,
        pendingActivityReasons: [],
        integrityBlockReasons: [],
        blockedReasons: [],
      };
    }

    const isProvenInfeasible = globalOpt?.status === "proven_infeasible";
    const status: KingdomSpawnAuditStatus = isProvenInfeasible
      ? "geometrically_infeasible"
      : "search_exhausted";
    const reason = isProvenInfeasible
      ? (globalOpt?.notes ?? `Imposibilidad geométrica demostrada para separación >= ${minSep}.`)
      : (globalOpt?.notes ?? "Búsqueda acotada agotada sin hallar solución completa; no demuestra imposibilidad matemática.");

    return {
      kingdomId: p.k.kingdomId,
      name: p.k.name,
      civilization: p.normCiv,
      persistedHomeTerritoryId: p.k.homeTerritoryId ?? null,
      coord: p.coord,
      regionalAnchor: p.anchor,
      nearestAnchorCivilization: p.nearestAnchorCiv,
      distanceToAnchor: p.distanceToAnchor,
      matchesCivilizationRegion: p.matchesCivilizationRegion,
      nearestCapitalDistance: p.nearestDist,
      nearestCapitalKingdomId: p.nearestId,
      nearestSameCivDistance: p.nearestSameDist,
      sameCivGroupedWithinBand: p.sameCivGroupedWithinBand,
      hasOccupationConflict: p.hasOccupationConflict,
      conflictDetails: p.conflictDetails,
      meetsMinSeparation: p.meetsMinSeparation,
      meetsTargetBand: p.meetsTargetBand,
      requiresRelocation: true,
      relocationReasons: p.relocationReasons,
      status,
      relocationAction: "blocked",
      proposedHomeCellId: null,
      proposedCoord: null,
      proposedDistanceToAnchor: null,
      proposedWithinTargetBand: null,
      pendingActivityReasons: [],
      integrityBlockReasons: [],
      blockedReasons: [reason],
    };
  });

  return {
    radius,
    separationMin: minSep,
    separationMax: maxSep,
    planFingerprint,
    anchorsValid: anchorCheck.isValid,
    totalKingdoms: entries.length,
    correctlyPositionedCount: entries.filter((e) => e.status === "correctly_positioned").length,
    kingdomsMeetingMinSeparation: entries.filter((e) => e.meetsMinSeparation).length,
    kingdomsMeetingTargetBand: entries.filter((e) => e.meetsTargetBand).length,
    kingdomsWithConflicts: entries.filter((e) => e.hasOccupationConflict).length,
    kingdomsRequiringRelocation: entries.filter((e) => e.requiresRelocation).length,
    plannedRelocations: entries.filter((e) => e.status === "planned").length,
    pendingActivityRelocations: entries.filter((e) => e.status === "pending_activity").length,
    blockedIntegrityRelocations: entries.filter((e) => e.status === "blocked_integrity").length,
    geometricallyInfeasibleRelocations: entries.filter((e) => e.status === "geometrically_infeasible").length,
    searchExhaustedRelocations: entries.filter((e) => e.status === "search_exhausted").length,
    blockedRelocations: entries.filter((e) => e.relocationAction === "blocked").length,
    globalPlanStatus: globalOpt ? globalOpt.status : "noop",
    globalPlanMinPairwiseDistance: globalOpt ? globalOpt.minPairwiseDistance : null,
    globalPlanVerifiedAllPairwise: globalOpt ? globalOpt.verifiedAllPairwiseDistances : true,
    outOfTargetBandKingdomIds: globalOpt ? globalOpt.outOfTargetBandKingdomIds : [],
    readOnlyPlan: true,
    entries,
  };
}

/** [MAESTRA P48] Tras una victoria aplastante se reclama un territorio libre CERCANO: a distancia ≤ 2 de uno propio ([DERIVADO]). */
export const CLAIM_MAX_DISTANCE = 2;

export interface TerritoryAcquisitionValidation {
  allowed: boolean;
  currentOwned: number;
  requestedCount: number;
  maxAllowed: number;
  resultingTotal: number;
  remainingCapacity: number;
  error?: string;
}

/**
 * Valida matemáticamente la adquisición de x territorios por un reino que posee N_k:
 * - x ∈ ℤ, x ≥ 1 (rechaza 0, negativos, decimales, NaN e infinitos)
 * - N_k ∈ ℤ, N_k ≥ 0
 * - N_k + x ≤ M (por defecto M = TERRITORIES.MAX_PER_KINGDOM = 100)
 */
export function validateTerritoryAcquisition(
  currentOwned: number,
  requestedCount: number = 1,
  maxAllowed: number = TERRITORIES.MAX_PER_KINGDOM
): TerritoryAcquisitionValidation {
  if (!Number.isInteger(maxAllowed) || maxAllowed < 1) {
    return {
      allowed: false,
      currentOwned,
      requestedCount,
      maxAllowed,
      resultingTotal: NaN,
      remainingCapacity: 0,
      error: `El límite máximo territorial debe ser un entero positivo (recibido: ${maxAllowed}).`,
    };
  }
  if (!Number.isInteger(currentOwned) || currentOwned < 0) {
    return {
      allowed: false,
      currentOwned,
      requestedCount,
      maxAllowed,
      resultingTotal: NaN,
      remainingCapacity: 0,
      error: `El número actual de territorios debe ser un entero no negativo (recibido: ${currentOwned}).`,
    };
  }
  if (!Number.isInteger(requestedCount) || requestedCount < 1) {
    return {
      allowed: false,
      currentOwned,
      requestedCount,
      maxAllowed,
      resultingTotal: currentOwned,
      remainingCapacity: Math.max(0, maxAllowed - currentOwned),
      error: `La cantidad de territorios solicitada debe ser un entero ≥ 1 (recibido: ${requestedCount}).`,
    };
  }
  const resultingTotal = currentOwned + requestedCount;
  if (resultingTotal > maxAllowed) {
    return {
      allowed: false,
      currentOwned,
      requestedCount,
      maxAllowed,
      resultingTotal,
      remainingCapacity: Math.max(0, maxAllowed - currentOwned),
      error: `Has alcanzado el límite máximo de ${maxAllowed} territorios por reino (actuales: ${currentOwned}, solicitados: ${requestedCount}).`,
    };
  }
  return {
    allowed: true,
    currentOwned,
    requestedCount,
    maxAllowed,
    resultingTotal,
    remainingCapacity: maxAllowed - resultingTotal,
  };
}

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
  const capCheck = validateTerritoryAcquisition(ownedCount, 1, maxTerritories);
  if (!capCheck.allowed) {
    return {
      success: false,
      error: capCheck.error ?? `Has alcanzado el límite máximo de ${maxTerritories} territorios por reino (actuales: ${ownedCount}).`,
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

export type CapitalResolutionSource = "homeTerritoryId" | "isHome" | "historical" | "missing" | "ambiguous";

export interface TerritoryCapCleanupPlan {
  capitalCellId: string;
  capitalSource: CapitalResolutionSource;
  requiresReview: boolean;
  blocked: boolean;
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
 * Conserva la capital histórica verificable y las (maxAllowed - 1) casillas más cercanas por distancia hexagonal.
 *
 * Orden estricto de identificación de la capital:
 * 1. `homeTerritoryId` si apunta a un territorio propiedad del reino.
 * 2. Registro territorial único marcado con `isHome: true` si la referencia principal falta o es inconsistente.
 * 3. Recuperación segura mediante `historicalCapitalCellId` verificable si el reino dispone de ese dato.
 * Nunca selecciona una capital por cercanía al centro del mapa si falta evidencia suficiente:
 * en ese caso bloquea la liberación y marca `requiresReview: true`.
 */
export function planTerritoryCapCleanup(input: {
  ownedCells: ReadonlyArray<CleanupCandidateCell>;
  homeTerritoryId?: string | null;
  historicalCapitalCellId?: string | null;
  maxAllowed?: number;
}): TerritoryCapCleanupPlan {
  const maxAllowed = input.maxAllowed ?? TERRITORIES.MAX_PER_KINGDOM;
  const cells = [...input.ownedCells];

  // Validación obligatoria de unicidad ANTES de cualquier retorno que declare válido el plan,
  // independientemente del tamaño del reino (< 100, === 100 o > 100) sin ocultar duplicados en un Set.
  const seenCellIds = new Set<string>();
  const duplicateCellIds: string[] = [];
  for (const cell of cells) {
    if (seenCellIds.has(cell.cellId)) {
      duplicateCellIds.push(cell.cellId);
    } else {
      seenCellIds.add(cell.cellId);
    }
  }
  const uniqueCellIdCount = seenCellIds.size;
  if (cells.length !== uniqueCellIdCount) {
    const uniqueDuplicates = Array.from(new Set(duplicateCellIds)).sort();
    return {
      capitalCellId: "",
      capitalSource: "ambiguous",
      requiresReview: true,
      blocked: true,
      totalOwned: cells.length,
      maxAllowed,
      keptCellIds: cells.map((c) => c.cellId),
      releasedCellIds: [],
      releasedCells: [],
      skipped: true,
      reason: `Identificadores de territorio duplicados detectados (${cells.length} registros para ${uniqueCellIdCount} cellIds únicos; duplicados: ${uniqueDuplicates.join(", ")}); plan bloqueado.`,
    };
  }

  if (cells.length === 0) {
    return {
      capitalCellId: input.homeTerritoryId ?? "",
      capitalSource: "missing",
      requiresReview: false,
      blocked: false,
      totalOwned: 0,
      maxAllowed,
      keptCellIds: [],
      releasedCellIds: [],
      releasedCells: [],
      skipped: true,
      reason: "Sin territorios propios.",
    };
  }

  // 1. Prioridad 1: homeTerritoryId apuntando a una celda propiedad del reino
  let capital: CleanupCandidateCell | undefined;
  let capitalSource: CapitalResolutionSource = "missing";
  if (input.homeTerritoryId) {
    const byHomeId = cells.find((c) => c.cellId === input.homeTerritoryId);
    if (byHomeId) {
      capital = byHomeId;
      capitalSource = "homeTerritoryId";
    }
  }

  // 2. Prioridad 2: registro territorial único marcado como isHome
  if (!capital) {
    const markedHomes = cells.filter((c) => c.isHome === true);
    if (markedHomes.length === 1) {
      capital = markedHomes[0];
      capitalSource = "isHome";
    } else if (markedHomes.length > 1) {
      capitalSource = "ambiguous";
    }
  }

  // 3. Prioridad 3: recuperación segura basada en dato histórico verificable (si no es ambiguo)
  if (!capital && capitalSource !== "ambiguous" && input.historicalCapitalCellId) {
    const byHistorical = cells.find((c) => c.cellId === input.historicalCapitalCellId);
    if (byHistorical) {
      capital = byHistorical;
      capitalSource = "historical";
    }
  }

  if (!capital) {
    const reason =
      capitalSource === "ambiguous"
        ? "Capital histórica ambigua: existen múltiples territorios marcados con isHome sin homeTerritoryId válido; requiere revisión manual."
        : "No se pudo identificar la capital histórica con seguridad (homeTerritoryId ausente o ajeno y sin marca isHome verificable); requiere revisión manual.";
    return {
      capitalCellId: "",
      capitalSource,
      requiresReview: true,
      blocked: true,
      totalOwned: cells.length,
      maxAllowed,
      keptCellIds: cells.map((c) => c.cellId),
      releasedCellIds: [],
      releasedCells: [],
      skipped: true,
      reason,
    };
  }

  if (cells.length <= maxAllowed) {
    return {
      capitalCellId: capital.cellId,
      capitalSource,
      requiresReview: false,
      blocked: false,
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
      return a.cellId < b.cellId ? -1 : a.cellId > b.cellId ? 1 : 0;
    });

  const keepCount = Math.max(0, maxAllowed - 1);
  const kept = [capital, ...others.slice(0, keepCount)];
  const released = others.slice(keepCount);
  const keptCellIds = kept.map((c) => c.cellId);
  const releasedCellIds = released.map((c) => c.cellId);

  // Validación matemática estricta del plan: N = K + R, K = min(N, M), R = max(0, N - M),
  // C ∈ K, K ∩ R = ∅, K ∪ R = T_inicial (sin duplicados).
  const initialCellIdSet = new Set(cells.map((c) => c.cellId));
  const keptSet = new Set(keptCellIds);
  const releasedSet = new Set(releasedCellIds);
  const hasOverlap = releasedCellIds.some((id) => keptSet.has(id));
  const expectedKept = Math.min(cells.length, maxAllowed);
  const expectedReleased = Math.max(0, cells.length - maxAllowed);
  const unionMatches =
    initialCellIdSet.size === cells.length &&
    keptSet.size === keptCellIds.length &&
    releasedSet.size === releasedCellIds.length &&
    keptSet.size + releasedSet.size === initialCellIdSet.size;

  const planMathematicallyValid =
    !hasOverlap &&
    unionMatches &&
    keptSet.has(capital.cellId) &&
    keptCellIds.length === expectedKept &&
    releasedCellIds.length === expectedReleased &&
    keptCellIds.length + releasedCellIds.length === cells.length;

  if (!planMathematicallyValid) {
    return {
      capitalCellId: capital.cellId,
      capitalSource,
      requiresReview: true,
      blocked: true,
      totalOwned: cells.length,
      maxAllowed,
      keptCellIds: cells.map((c) => c.cellId),
      releasedCellIds: [],
      releasedCells: [],
      skipped: true,
      reason: "Plan matemáticamente inválido (inconsistencia de partición, duplicados o capital fuera del conjunto conservado); saneamiento bloqueado.",
    };
  }

  return {
    capitalCellId: capital.cellId,
    capitalSource,
    requiresReview: false,
    blocked: false,
    totalOwned: cells.length,
    maxAllowed,
    keptCellIds,
    releasedCellIds,
    releasedCells: released,
    skipped: false,
  };
}

export interface TerritoryOwnershipSnapshot {
  id: string;
  cellId: string;
  q: number;
  r: number;
  terrain: TerrainType;
  ownerKingdomId?: string | null;
  isHome?: boolean;
  claimedAt?: number;
}

export interface PostCleanupVerificationInput {
  kingdomId: string;
  initialTerritories: ReadonlyArray<TerritoryOwnershipSnapshot>;
  plannedKeptCellIds: ReadonlyArray<string>;
  plannedReleasedCellIds: ReadonlyArray<string>;
  capitalCellId: string;
  maxAllowed?: number;
  finalOwnedByKingdom: ReadonlyArray<TerritoryOwnershipSnapshot>;
  finalInitialDocs: ReadonlyArray<TerritoryOwnershipSnapshot | null>;
  finalKingdomHomeTerritoryId?: string | null;
  foreignTerritoriesBefore: ReadonlyArray<TerritoryOwnershipSnapshot>;
  foreignTerritoriesAfter: ReadonlyArray<TerritoryOwnershipSnapshot>;
}

export interface PostCleanupVerificationResult {
  valid: boolean;
  errors: string[];
  actualKeptCellIds: string[];
  actualReleasedCellIds: string[];
}

function sameStringSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/**
 * Verificación exacta posterior al saneamiento territorial (Corrección 2):
 * Comprueba identidad exacta de conjuntos (sin depender del orden), propiedad individual,
 * conservación de capital, ausencia de borrado de documentos y ausencia de modificaciones
 * en territorios ajenos al conjunto inicial.
 */
export function verifyTerritoryCapCleanupPostState(
  input: PostCleanupVerificationInput
): PostCleanupVerificationResult {
  const maxAllowed = input.maxAllowed ?? TERRITORIES.MAX_PER_KINGDOM;
  const errors: string[] = [];

  const initialCellIds = input.initialTerritories.map((t) => t.cellId);
  const initialCellIdSet = new Set(initialCellIds);
  if (initialCellIdSet.size !== initialCellIds.length) {
    errors.push(
      `Conjunto inicial inválido: ${initialCellIds.length} registros para ${initialCellIdSet.size} cellIds únicos.`
    );
  }

  const plannedKeptSet = new Set(input.plannedKeptCellIds);
  const plannedReleasedSet = new Set(input.plannedReleasedCellIds);
  if (plannedKeptSet.size !== input.plannedKeptCellIds.length) {
    errors.push("El conjunto K_planificado contiene identificadores duplicados.");
  }
  if (plannedReleasedSet.size !== input.plannedReleasedCellIds.length) {
    errors.push("El conjunto R_planificado contiene identificadores duplicados.");
  }

  // 1. Verificar conservación e integridad de TODOS los documentos iniciales.
  if (input.finalInitialDocs.length !== input.initialTerritories.length) {
    errors.push(
      `Cantidad de documentos iniciales reconsultados (${input.finalInitialDocs.length}) distinta de T_initial (${input.initialTerritories.length}).`
    );
  }

  const finalInitialById = new Map<string, TerritoryOwnershipSnapshot>();

  for (let i = 0; i < input.initialTerritories.length; i += 1) {
    const initialDoc = input.initialTerritories[i];
    const finalDoc = input.finalInitialDocs[i] ?? null;

    if (!finalDoc) {
      errors.push(
        `Documento de territorio eliminado durante el saneamiento: id='${initialDoc.id}', cellId='${initialDoc.cellId}'.`
      );
      continue;
    }

    if (finalDoc.id !== initialDoc.id) {
      errors.push(
        `Identificador documental alterado para el territorio '${initialDoc.cellId}': '${initialDoc.id}' -> '${finalDoc.id}'.`
      );
    }

    if (
      finalDoc.cellId !== initialDoc.cellId ||
      finalDoc.q !== initialDoc.q ||
      finalDoc.r !== initialDoc.r
    ) {
      errors.push(
        `Coordenadas o cellId alterados en territorio '${initialDoc.cellId}'.`
      );
    }

    if (finalDoc.terrain !== initialDoc.terrain) {
      errors.push(
        `Terreno alterado en territorio '${initialDoc.cellId}': '${initialDoc.terrain}' -> '${finalDoc.terrain}'.`
      );
    }

    finalInitialById.set(initialDoc.id, finalDoc);
  }

  // 2. Construir K_real y R_real desde los registros persistidos reales
  const actualKeptCellIds = input.finalOwnedByKingdom.map((t) => t.cellId);
  const actualKeptSet = new Set(actualKeptCellIds);
  if (actualKeptSet.size !== actualKeptCellIds.length) {
    errors.push(
      `K_real contiene identificadores duplicados (${actualKeptCellIds.length} registros para ${actualKeptSet.size} únicos).`
    );
  }

  const actualReleasedCellIds: string[] = [];
  for (const initialDoc of input.initialTerritories) {
    const finalDoc = finalInitialById.get(initialDoc.id);
    if (!finalDoc) continue;
    const owner = finalDoc.ownerKingdomId ?? null;
    if (owner !== input.kingdomId) {
      actualReleasedCellIds.push(finalDoc.cellId);
    }
  }
  const actualReleasedSet = new Set(actualReleasedCellIds);
  if (actualReleasedSet.size !== actualReleasedCellIds.length) {
    errors.push(
      `R_real contiene identificadores duplicados (${actualReleasedCellIds.length} registros para ${actualReleasedSet.size} únicos).`
    );
  }

  // 3. Invariantes exactos de conjuntos (independientes del orden)
  if (!sameStringSet(actualKeptSet, plannedKeptSet)) {
    errors.push(
      `K_real !== K_planificado (reales=${actualKeptSet.size}, planificados=${plannedKeptSet.size}).`
    );
  }
  if (!sameStringSet(actualReleasedSet, plannedReleasedSet)) {
    errors.push(
      `R_real !== R_planificado (reales=${actualReleasedSet.size}, planificados=${plannedReleasedSet.size}).`
    );
  }

  for (const id of actualReleasedSet) {
    if (actualKeptSet.has(id)) {
      errors.push(`Intersección no vacía K_real ∩ R_real contiene '${id}'.`);
    }
  }

  const unionSet = new Set<string>([...actualKeptSet, ...actualReleasedSet]);
  if (!sameStringSet(unionSet, initialCellIdSet)) {
    errors.push(
      `Unión K_real ∪ R_real (${unionSet.size}) no coincide exactamente con T_initial (${initialCellIdSet.size}).`
    );
  }

  if (actualReleasedCellIds.length !== input.plannedReleasedCellIds.length) {
    errors.push(
      `releasedCount (${actualReleasedCellIds.length}) !== releasedCellIds.length (${input.plannedReleasedCellIds.length}).`
    );
  }

  if (actualKeptCellIds.length + actualReleasedCellIds.length !== input.initialTerritories.length) {
    errors.push(
      `K_real.length + R_real.length (${actualKeptCellIds.length + actualReleasedCellIds.length}) !== T_initial.length (${input.initialTerritories.length}).`
    );
  }

  if (actualKeptCellIds.length > maxAllowed) {
    errors.push(`N_final (${actualKeptCellIds.length}) supera el tope máximo (${maxAllowed}).`);
  }

  // 4. Propiedad individual y conservación exacta de los datos de los territorios.
  for (const initialDoc of input.initialTerritories) {
    const finalDoc = finalInitialById.get(initialDoc.id);
    if (!finalDoc) continue;

    const owner = finalDoc.ownerKingdomId ?? null;

    if (plannedKeptSet.has(initialDoc.cellId)) {
      if (owner !== input.kingdomId) {
        errors.push(
          `Territorio conservado '${initialDoc.cellId}' no pertenece al reino '${input.kingdomId}'.`
        );
      }

      if (finalDoc.isHome !== (initialDoc.cellId === input.capitalCellId)) {
        errors.push(
          `Marca de capital incorrecta en territorio conservado '${initialDoc.cellId}'.`
        );
      }

      if ((finalDoc.claimedAt ?? null) !== (initialDoc.claimedAt ?? null)) {
        errors.push(
          `claimedAt fue alterado en territorio conservado '${initialDoc.cellId}'.`
        );
      }
    } else if (plannedReleasedSet.has(initialDoc.cellId)) {
      if (owner !== null) {
        errors.push(
          `Territorio liberado '${initialDoc.cellId}' conserva propietario '${owner}'.`
        );
      }

      if (finalDoc.isHome !== false) {
        errors.push(
          `Territorio liberado '${initialDoc.cellId}' conserva una marca de capital incorrecta.`
        );
      }

      if (finalDoc.claimedAt !== undefined) {
        errors.push(
          `Territorio liberado '${initialDoc.cellId}' conserva claimedAt después de su liberación.`
        );
      }

      // cellId, coordenadas, terrain e id ya se compararon con el documento original.
    } else {
      errors.push(
        `Territorio inicial '${initialDoc.cellId}' no pertenece a K_planificado ni a R_planificado.`
      );
    }
  }

  // 5. Conservación exacta de la capital
  if (input.initialTerritories.length > 0) {
    if (!actualKeptSet.has(input.capitalCellId)) {
      errors.push(`La capital '${input.capitalCellId}' no forma parte de K_real.`);
    }
    if ((input.finalKingdomHomeTerritoryId ?? null) !== input.capitalCellId) {
      errors.push(
        `homeTerritoryId del reino ('${input.finalKingdomHomeTerritoryId ?? ""}') !== capital '${input.capitalCellId}'.`
      );
    }
    const finalMarkedHomes = input.finalOwnedByKingdom.filter((c) => c.isHome === true);
    if (finalMarkedHomes.length !== 1 || finalMarkedHomes[0].cellId !== input.capitalCellId) {
      errors.push(
        `Marca isHome incoherente tras saneamiento (marcados=${finalMarkedHomes.length}, capital='${input.capitalCellId}').`
      );
    }
  }

  // 6. Conservación íntegra de todos los territorios ajenos al conjunto inicial.
  if (input.foreignTerritoriesBefore.length !== input.foreignTerritoriesAfter.length) {
    errors.push(
      `El número de territorios ajenos a T_initial cambió (${input.foreignTerritoriesBefore.length} -> ${input.foreignTerritoriesAfter.length}).`
    );
  }

  const foreignBeforeIds = new Set(input.foreignTerritoriesBefore.map((t) => t.id));
  const foreignAfterIds = new Set(input.foreignTerritoriesAfter.map((t) => t.id));

  if (foreignBeforeIds.size !== input.foreignTerritoriesBefore.length) {
    errors.push("Existen identificadores documentales duplicados en los territorios ajenos iniciales.");
  }

  if (foreignAfterIds.size !== input.foreignTerritoriesAfter.length) {
    errors.push("Existen identificadores documentales duplicados en los territorios ajenos finales.");
  }

  if (!sameStringSet(foreignBeforeIds, foreignAfterIds)) {
    errors.push("El conjunto exacto de documentos territoriales ajenos ha cambiado.");
  }

  const foreignAfterById = new Map(
    input.foreignTerritoriesAfter.map((t) => [t.id, t])
  );

  for (const beforeDoc of input.foreignTerritoriesBefore) {
    const afterDoc = foreignAfterById.get(beforeDoc.id);

    if (!afterDoc) {
      errors.push(
        `Territorio ajeno '${beforeDoc.cellId}' (id='${beforeDoc.id}') desapareció durante el saneamiento.`
      );
      continue;
    }

    if (
      afterDoc.id !== beforeDoc.id ||
      afterDoc.cellId !== beforeDoc.cellId ||
      afterDoc.q !== beforeDoc.q ||
      afterDoc.r !== beforeDoc.r ||
      afterDoc.terrain !== beforeDoc.terrain ||
      (afterDoc.ownerKingdomId ?? null) !== (beforeDoc.ownerKingdomId ?? null) ||
      Boolean(afterDoc.isHome) !== Boolean(beforeDoc.isHome) ||
      (afterDoc.claimedAt ?? null) !== (beforeDoc.claimedAt ?? null)
    ) {
      errors.push(
        `Territorio ajeno '${beforeDoc.cellId}' (id='${beforeDoc.id}') fue modificado durante el saneamiento.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    actualKeptCellIds,
    actualReleasedCellIds,
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
