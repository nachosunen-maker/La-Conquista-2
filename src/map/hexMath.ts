/**
 * LA CONQUISTA — MOTOR MATEMÁTICO HEXAGONAL Y CULLING ESPACIAL (Puntos 3 + 4)
 *
 * Geometría canónica pointy-top en coordenadas axiales (q, r):
 *   x = sqrt(3) * h * (q + r / 2)
 *   y = (3 / 2) * h * r
 *
 * Inversa exacta con redondeo cúbico:
 *   q_f = (sqrt(3) * x - y) / (3 * h)
 *   r_f = (2 * y) / (3 * h)
 *
 * Preserva el disco completo R = 50 -> N(50) = 1 + 3 * 50 * 51 = 7.651 hexágonos,
 * semilla determinista WORLD_SEED = 20261017 e identificadores estables "q,r".
 */
import { MAP, type TerrainType } from "../../convex/balanceConfig";
import {
  cellId,
  hexDistance,
  isInsideWorld,
  terrainForCell,
  type HexCoord,
} from "../../convex/territoryRules";

export const SQRT3 = Math.sqrt(3);

/** Tamaño base de hexágono (radio circunscrito h en px a zoom = 1). */
export const BASE_HEX_SIZE = 22;

/** Zoom por defecto al centrar en la capital: pixelRadius = 22 * 1.25 = 27.5px. */
export const DEFAULT_CAPITAL_ZOOM = 1.25;
export const MIN_ZOOM = 0.24;
export const MAX_ZOOM = 3.2;

/** Límite superior de píxeles físicos en el backing store del canvas (~16 MB RGBA). */
export const MAX_BACKING_PIXELS = 4_000_000;

/** Índice numérico compacto de los 6 terrenos canónicos + niebla. */
export const TERRAIN_TO_CODE: Record<TerrainType, number> = {
  llanura: 0,
  bosque: 1,
  colina: 2,
  montana: 3,
  rio: 4,
  costa: 5,
};

export const CODE_TO_TERRAIN: readonly TerrainType[] = [
  "llanura",
  "bosque",
  "colina",
  "montana",
  "rio",
  "costa",
];

/**
 * 6 vértices unitarios (radio = 1) de un hexágono pointy-top en sentido horario.
 * Ángulos: -30°, 30°, 90°, 150°, 210°, 270°.
 */
export const HEX_UNIT_VERTICES: ReadonlyArray<{ readonly x: number; readonly y: number }> = Array.from(
  { length: 6 },
  (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }
);

/**
 * Dirección axial del vecino que comparte la arista `i` (entre vértice `i` y `(i + 1) % 6`).
 * Verificado trigonométricamente para pointy-top:
 *   arista 0 (-30° ->  30°, derecha):         (+1,  0)
 *   arista 1 ( 30° ->  90°, abajo-derecha):   ( 0, +1)
 *   arista 2 ( 90° -> 150°, abajo-izquierda): (-1, +1)
 *   arista 3 (150° -> 210°, izquierda):       (-1,  0)
 *   arista 4 (210° -> 270°, arriba-izquierda):( 0, -1)
 *   arista 5 (270° -> -30°, arriba-derecha):  (+1, -1)
 */
export const HEX_EDGE_NEIGHBORS: ReadonlyArray<Readonly<HexCoord>> = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface StaticWorldIndex {
  readonly radius: number;
  readonly seed: number;
  readonly hexSize: number;
  readonly stride: number;
  readonly totalCells: number;
  /** 1 si el slot (q, r) pertenece al disco hexagonal, 0 en caso contrario. */
  readonly valid: Uint8Array;
  /** Código de terreno 0..5 por slot plano. */
  readonly terrainCode: Uint8Array;
  /** Variante determinista 0..3 por slot plano para riqueza visual sin aleatoriedad por frame. */
  readonly variant: Uint8Array;
  /** Coordenadas de mundo precomputadas (zoom = 1) por slot plano. */
  readonly worldX: Float32Array;
  readonly worldY: Float32Array;
  /** Coordenadas axiales almacenadas en arrays paralelos para los 7.651 hexes válidos. */
  readonly cellQ: Int16Array;
  readonly cellR: Int16Array;
  readonly cellFlatIndex: Int32Array;
}

const staticWorldCache = new Map<string, StaticWorldIndex>();

/** Hash rápido determinista para seleccionar variante visual 0..3 por celda. */
function visualVariantHash(q: number, r: number, seed: number): number {
  let h = (seed ^ Math.imul(q, 2654435761) ^ Math.imul(r, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 3266489917) >>> 0;
  return (h >>> 29) & 3;
}

export function axialToFlatIndex(q: number, r: number, radius: number): number {
  const stride = radius * 2 + 1;
  return (q + radius) * stride + (r + radius);
}

/**
 * Construye y cachea a nivel de módulo la geometría estática del disco hexagonal completo.
 * Se ejecuta UNA sola vez por (radius, seed, hexSize), evitando reconstruir 7.651 objetos
 * en cada montaje o actualización reactiva.
 */
export function getCachedStaticWorld(
  radius: number = MAP.RADIUS,
  seed: number = MAP.WORLD_SEED,
  hexSize: number = BASE_HEX_SIZE
): StaticWorldIndex {
  const key = `${radius}:${seed}:${hexSize}`;
  const existing = staticWorldCache.get(key);
  if (existing) return existing;

  const stride = radius * 2 + 1;
  const gridSize = stride * stride;
  const expectedCount = 1 + 3 * radius * (radius + 1);

  const valid = new Uint8Array(gridSize);
  const terrainCode = new Uint8Array(gridSize);
  const variant = new Uint8Array(gridSize);
  const worldX = new Float32Array(gridSize);
  const worldY = new Float32Array(gridSize);
  const cellQ = new Int16Array(expectedCount);
  const cellR = new Int16Array(expectedCount);
  const cellFlatIndex = new Int32Array(expectedCount);

  let count = 0;
  for (let q = -radius; q <= radius; q++) {
    const rStart = Math.max(-radius, -q - radius);
    const rEnd = Math.min(radius, -q + radius);
    for (let r = rStart; r <= rEnd; r++) {
      const idx = (q + radius) * stride + (r + radius);
      const terrain = terrainForCell(q, r, seed, radius);
      valid[idx] = 1;
      terrainCode[idx] = TERRAIN_TO_CODE[terrain];
      variant[idx] = visualVariantHash(q, r, seed);
      worldX[idx] = hexSize * SQRT3 * (q + r * 0.5);
      worldY[idx] = hexSize * 1.5 * r;
      cellQ[count] = q;
      cellR[count] = r;
      cellFlatIndex[count] = idx;
      count++;
    }
  }

  const built: StaticWorldIndex = {
    radius,
    seed,
    hexSize,
    stride,
    totalCells: count,
    valid,
    terrainCode,
    variant,
    worldX,
    worldY,
    cellQ,
    cellR,
    cellFlatIndex,
  };
  staticWorldCache.set(key, built);
  return built;
}

/** Conversión canónica axial -> píxel de mundo (a zoom = 1). */
export function axialToPixel(q: number, r: number, hexSize: number = BASE_HEX_SIZE): { x: number; y: number } {
  return {
    x: hexSize * SQRT3 * (q + r * 0.5),
    y: hexSize * 1.5 * r,
  };
}

/** Conversión exacta de píxel de mundo -> axial con redondeo cúbico. */
export function pixelToAxial(x: number, y: number, hexSize: number = BASE_HEX_SIZE): HexCoord {
  const qf = (SQRT3 * x - y) / (3 * hexSize);
  const rf = (2 * y) / (3 * hexSize);
  return roundFractionalAxial(qf, rf);
}

/** Redondeo cúbico exacto que preserva q + r + s = 0. */
export function roundFractionalAxial(qf: number, rf: number): HexCoord {
  const sf = -qf - rf;
  let rq = Math.round(qf);
  let rr = Math.round(rf);
  const rs = Math.round(sf);

  const qDiff = Math.abs(rq - qf);
  const rDiff = Math.abs(rr - rf);
  const sDiff = Math.abs(rs - sf);

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  }
  return { q: rq === 0 ? 0 : rq, r: rr === 0 ? 0 : rr };
}

/** Transforma un punto de pantalla (CSS px relativos al canvas) a coordenadas de mundo. */
export function screenToWorld(
  screenX: number,
  screenY: number,
  camera: CameraState,
  viewport: ViewportSize
): { x: number; y: number } {
  return {
    x: (screenX - viewport.width * 0.5) / camera.zoom - camera.x,
    y: (screenY - viewport.height * 0.5) / camera.zoom - camera.y,
  };
}

/** Transforma un punto de mundo a coordenadas de pantalla (CSS px relativos al canvas). */
export function worldToScreen(
  worldX: number,
  worldY: number,
  camera: CameraState,
  viewport: ViewportSize
): { x: number; y: number } {
  return {
    x: (worldX + camera.x) * camera.zoom + viewport.width * 0.5,
    y: (worldY + camera.y) * camera.zoom + viewport.height * 0.5,
  };
}

/** Resuelve exactamente el hexágono bajo el puntero (o null si cae fuera del disco R=50). */
export function screenToAxial(
  screenX: number,
  screenY: number,
  camera: CameraState,
  viewport: ViewportSize,
  hexSize: number = BASE_HEX_SIZE,
  radius: number = MAP.RADIUS
): HexCoord | null {
  const world = screenToWorld(screenX, screenY, camera, viewport);
  const axial = pixelToAxial(world.x, world.y, hexSize);
  return isInsideWorld(axial, radius) ? axial : null;
}

export interface VisibleAxialBounds {
  readonly rMin: number;
  readonly rMax: number;
  readonly worldLeft: number;
  readonly worldRight: number;
  readonly worldTop: number;
  readonly worldBottom: number;
  /** Calcula los límites exactos [qMin, qMax] para una fila r dentro del disco y del viewport. */
  qRangeForRow(r: number): { qMin: number; qMax: number };
}

/**
 * Culling espacial exacto O(V): proyecta el viewport al espacio de mundo con margen de seguridad
 * de 1 hexágono y devuelve los rangos exactos de r y q(r) dentro del disco hexagonal.
 */
export function computeVisibleAxialBounds(
  camera: CameraState,
  viewport: ViewportSize,
  hexSize: number = BASE_HEX_SIZE,
  radius: number = MAP.RADIUS,
  marginHexes: number = 1.5
): VisibleAxialBounds {
  const halfW = viewport.width / (2 * camera.zoom);
  const halfH = viewport.height / (2 * camera.zoom);
  const pad = hexSize * marginHexes;

  const worldLeft = -camera.x - halfW - pad;
  const worldRight = -camera.x + halfW + pad;
  const worldTop = -camera.y - halfH - pad;
  const worldBottom = -camera.y + halfH + pad;

  const invRowH = 1 / (hexSize * 1.5);
  const invColW = 1 / (hexSize * SQRT3);

  const rMin = Math.max(-radius, Math.floor(worldTop * invRowH) - 1);
  const rMax = Math.min(radius, Math.ceil(worldBottom * invRowH) + 1);

  return {
    rMin,
    rMax,
    worldLeft,
    worldRight,
    worldTop,
    worldBottom,
    qRangeForRow(r: number) {
      const halfR = r * 0.5;
      const qMin = Math.max(-radius, -r - radius, Math.floor(worldLeft * invColW - halfR) - 1);
      const qMax = Math.min(radius, -r + radius, Math.ceil(worldRight * invColW - halfR) + 1);
      return { qMin, qMax };
    },
  };
}

/**
 * Calcula los territorios neutrales explorados reclamables gratuitamente (distancia <= 2
 * desde cualquier territorio propio) en O(|T_owned|) mediante expansión local de radio 2
 * (máximo 18 celdas candidatas por territorio propio) en lugar de O(|V_visible| * |T_owned|).
 */
export function computeClaimableAdjacentIds(
  ownedCoords: ReadonlyArray<HexCoord>,
  visibleById: ReadonlyMap<string, { state: string; ownerKingdomId: string | null }>,
  radius: number = MAP.RADIUS
): Set<string> {
  const claimable = new Set<string>();
  if (ownedCoords.length === 0) return claimable;

  for (let i = 0; i < ownedCoords.length; i++) {
    const origin = ownedCoords[i];
    for (let dq = -2; dq <= 2; dq++) {
      const drMin = Math.max(-2, -dq - 2);
      const drMax = Math.min(2, -dq + 2);
      for (let dr = drMin; dr <= drMax; dr++) {
        if (dq === 0 && dr === 0) continue;
        const q = origin.q + dq;
        const r = origin.r + dr;
        if (Math.abs(q) > radius || Math.abs(r) > radius || Math.abs(q + r) > radius) continue;
        const id = cellId(q, r);
        if (claimable.has(id)) continue;
        const cell = visibleById.get(id);
        if (cell && cell.state === "explored" && !cell.ownerKingdomId) {
          claimable.add(id);
        }
      }
    }
  }
  return claimable;
}

/**
 * Calcula un DPR adaptativo que limita la memoria del canvas (M ~ W * H * DPR^2 * 4 bytes)
 * sin perder nitidez en escritorio ni saturar GPUs móviles.
 */
export function computeAdaptiveDpr(
  width: number,
  height: number,
  devicePixelRatio: number = 1,
  maxBackingPixels: number = MAX_BACKING_PIXELS
): number {
  const safeDpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const isCompactViewport = Math.min(width, height) <= 500;
  const tierCap = isCompactViewport ? 1.5 : 2.0;
  let dpr = Math.min(safeDpr, tierCap);

  const area = Math.max(1, width * height);
  if (area * dpr * dpr > maxBackingPixels) {
    dpr = Math.max(1, Math.sqrt(maxBackingPixels / area));
  }
  return Math.round(dpr * 100) / 100;
}

/**
 * Aplica un zoom centrado en un punto de pantalla (cursor o punto medio de pellizco),
 * manteniendo invariante la coordenada de mundo bajo ese punto.
 */
export function zoomCameraAtPoint(
  camera: CameraState,
  screenX: number,
  screenY: number,
  viewport: ViewportSize,
  targetZoom: number
): CameraState {
  const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));
  const worldBefore = screenToWorld(screenX, screenY, camera, viewport);
  const nextX = (screenX - viewport.width * 0.5) / clampedZoom - worldBefore.x;
  const nextY = (screenY - viewport.height * 0.5) / clampedZoom - worldBefore.y;
  return { x: nextX, y: nextY, zoom: clampedZoom };
}

/** Crea una cámara centrada exactamente en la capital (o en el centro 0,0 si aún no existe). */
export function createCapitalCenteredCamera(
  homeCoord: HexCoord | null,
  zoom: number = DEFAULT_CAPITAL_ZOOM,
  hexSize: number = BASE_HEX_SIZE
): CameraState {
  if (!homeCoord) {
    return { x: 0, y: 0, zoom };
  }
  const pos = axialToPixel(homeCoord.q, homeCoord.r, hexSize);
  return { x: -pos.x, y: -pos.y, zoom };
}

/** Persistencia en memoria de la última cámara por reino para evitar saltos al volver de otra pestaña. */
const persistedCamerasByKingdom = new Map<string, CameraState>();

export function getPersistedCamera(kingdomId: string): CameraState | null {
  const saved = persistedCamerasByKingdom.get(kingdomId);
  return saved ? { ...saved } : null;
}

export function setPersistedCamera(kingdomId: string, camera: CameraState): void {
  persistedCamerasByKingdom.set(kingdomId, { ...camera });
}

export function clearPersistedCamera(kingdomId?: string): void {
  if (kingdomId) {
    persistedCamerasByKingdom.delete(kingdomId);
  } else {
    persistedCamerasByKingdom.clear();
  }
}

export { hexDistance, isInsideWorld, cellId };
