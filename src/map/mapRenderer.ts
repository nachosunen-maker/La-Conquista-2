/**
 * LA CONQUISTA — MOTOR DE RENDERIZADO CANVAS 2D POR CAPAS (Puntos 3 + 4)
 *
 * Desacopla completamente el renderizado del ciclo de reconciliación de React:
 * - Cámara, hover y selección se gestionan en referencias mutables.
 * - Capa Base (terreno ilustrado + niebla + fronteras exteriores de reinos + capitales/blasón)
 *   cacheada en un canvas offscreen: solo se redibuja cuando cambia la cámara, el viewport o los datos.
 * - Capa Dinámica (marchas, expediciones, selección, hover, hexes reclamables): se compone en O(1)
 *   sobre la capa base en < 0.5 ms sin redibujar los hexágonos de terreno.
 * - Planificador único de `requestAnimationFrame` con cancelación estricta en `destroy()`.
 */
import type { TerrainType } from "../../convex/balanceConfig";
import {
  axialToFlatIndex,
  BASE_HEX_SIZE,
  cellId,
  computeAdaptiveDpr,
  computeVisibleAxialBounds,
  getCachedStaticWorld,
  HEX_EDGE_NEIGHBORS,
  HEX_UNIT_VERTICES,
  screenToAxial,
  SQRT3,
  TERRAIN_TO_CODE,
  worldToScreen,
  type CameraState,
  type StaticWorldIndex,
  type ViewportSize,
} from "./hexMath";
import {
  drawFogHex,
  drawIllustratedTerrainHex,
  drawMedievalCapitalFortress,
  drawProvinceBanner,
  FOG_PALETTE,
  selectLodLevel,
  TerrainStampCache,
  traceHexPath,
} from "./terrainVisuals";

export interface RenderableMapCell {
  cellId: string;
  q: number;
  r: number;
  terrain: TerrainType | "desconocido";
  ownerKingdomId: string | null;
  ownerName: string | null;
  ownerColor: string | null;
  isHome: boolean;
  state: "fog" | "exploring" | "explored" | "owned";
  canExplore: boolean;
  canConquer: boolean;
  explorationPlan: { distance: number; durationSeconds: number; costs: { gold: number; food: number } } | null;
  expedition: {
    expeditionId: string;
    progressPercent: number;
    completesAt: number;
    durationMs: number;
    distance: number;
    isSpyMission: boolean;
  } | null;
}

export interface RenderableMarch {
  marchId: string;
  cellId: string;
  targetQ: number;
  targetR: number;
  startedAt: number;
  durationMs: number;
  completesAt: number;
  progressPercent: number;
  isConquest: boolean;
}

export interface MapRenderInput {
  radius: number;
  worldSeed: number;
  kingdomId: string;
  homeTerritoryId: string | null;
  pendingClaims: number;
  visibleCells: ReadonlyArray<RenderableMapCell>;
  claimableAdjacentIds: ReadonlySet<string>;
  activeMarches: ReadonlyArray<RenderableMarch>;
}

export interface MapRendererPerfSnapshot {
  lastFrameMs: number;
  lastPrepMs: number;
  lastCameraMs: number;
  lastBaseRenderMs: number;
  lastOverlayRenderMs: number;
  lastVisibleHexCount: number;
  lastTerrainDrawnCount: number;
  lastFogDrawnCount: number;
  lastExpeditionsInspected: number;
  lastExpeditionsDrawn: number;
  baseRenderCount: number;
  overlayRenderCount: number;
  panReuseHitCount: number;
  invalidationsBySelection: number;
  invalidationsByHover: number;
  invalidationsByCamera: number;
  invalidationsByData: number;
  dpr: number;
  stampCacheEntries: number;
  stampCacheBytes: number;
}

interface ActiveExpeditionRenderItem {
  readonly flatIndex: number;
  readonly progressPercent: number;
  readonly isSpyMission: boolean;
}

const DEFAULT_PAN_OVERSCAN_CSS = 128;

export class MedievalMapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private baseCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private baseCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private overscanCss = DEFAULT_PAN_OVERSCAN_CSS;
  private baseCamera: CameraState | null = null;

  private readonly stampCache = new TerrainStampCache(128, 12 * 1024 * 1024);

  private staticWorld: StaticWorldIndex;
  private visibleByFlatIndex = new Map<number, RenderableMapCell>();
  private ownerByFlatIndex = new Map<number, string>();
  private homeCoord: { q: number; r: number } | null = null;

  // Índices dinámicos compactos (actualizados solo cuando cambian los datos, nunca al mover cámara)
  private activeExpeditionsIndex: ActiveExpeditionRenderItem[] = [];
  private claimableFlatIndices: Int32Array = new Int32Array(0);
  private lastBaseSignature = "";

  // Buffers reutilizables para evitar asignaciones por fotograma en renderBaseLayer()
  private scratchOwnedSx: number[] = [];
  private scratchOwnedSy: number[] = [];
  private scratchOwnedCell: RenderableMapCell[] = [];
  private scratchCapitalSx: number[] = [];
  private scratchCapitalSy: number[] = [];
  private scratchCapitalCell: RenderableMapCell[] = [];
  private scratchExplorableSx: number[] = [];
  private scratchExplorableSy: number[] = [];

  private input: MapRenderInput | null = null;
  private camera: CameraState = { x: 0, y: 0, zoom: 1.25 };
  private viewport: ViewportSize = { width: 800, height: 560 };
  private dpr = 1;

  private selectedFlatIndex: number | null = null;
  private hoveredFlatIndex: number | null = null;

  private dirtyBase = true;
  private dirtyOverlay = true;
  private rafId: number | null = null;
  private destroyed = false;

  private perf: MapRendererPerfSnapshot = {
    lastFrameMs: 0,
    lastPrepMs: 0,
    lastCameraMs: 0,
    lastBaseRenderMs: 0,
    lastOverlayRenderMs: 0,
    lastVisibleHexCount: 0,
    lastTerrainDrawnCount: 0,
    lastFogDrawnCount: 0,
    lastExpeditionsInspected: 0,
    lastExpeditionsDrawn: 0,
    baseRenderCount: 0,
    overlayRenderCount: 0,
    panReuseHitCount: 0,
    invalidationsBySelection: 0,
    invalidationsByHover: 0,
    invalidationsByCamera: 0,
    invalidationsByData: 0,
    dpr: 1,
    stampCacheEntries: 0,
    stampCacheBytes: 0,
  };

  private readonly offscreenFactory?: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas | null;

  constructor(
    canvas: HTMLCanvasElement,
    radius: number = 50,
    worldSeed: number = 20261017,
    offscreenFactory?: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas | null
  ) {
    this.canvas = canvas;
    this.offscreenFactory = offscreenFactory;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("No se pudo inicializar el contexto Canvas 2D del mapa.");
    }
    this.ctx = ctx;
    this.staticWorld = getCachedStaticWorld(radius, worldSeed, BASE_HEX_SIZE);
  }

  setViewport(width: number, height: number, devicePixelRatio: number = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1): void {
    const safeW = Math.max(1, Math.floor(width));
    const safeH = Math.max(1, Math.floor(height));
    const nextDpr = computeAdaptiveDpr(safeW, safeH, devicePixelRatio);

    if (this.viewport.width === safeW && this.viewport.height === safeH && this.dpr === nextDpr) {
      return;
    }

    this.viewport = { width: safeW, height: safeH };
    this.dpr = nextDpr;
    this.overscanCss = Math.min(DEFAULT_PAN_OVERSCAN_CSS, Math.max(48, Math.floor(Math.min(safeW, safeH) * 0.22)));

    const backingW = Math.max(1, Math.floor(safeW * nextDpr));
    const backingH = Math.max(1, Math.floor(safeH * nextDpr));

    this.canvas.width = backingW;
    this.canvas.height = backingH;
    if (this.canvas.style) {
      this.canvas.style.width = `${safeW}px`;
      this.canvas.style.height = `${safeH}px`;
    }

    const baseBackingW = Math.max(1, Math.floor((safeW + this.overscanCss * 2) * nextDpr));
    const baseBackingH = Math.max(1, Math.floor((safeH + this.overscanCss * 2) * nextDpr));
    this.ensureBaseSurface(baseBackingW, baseBackingH);
    this.baseCamera = null;
    this.scheduleRender(true);
  }

  setData(input: MapRenderInput): void {
    const prepStart = performance.now();
    this.input = input;
    if (this.staticWorld.radius !== input.radius || this.staticWorld.seed !== input.worldSeed) {
      this.staticWorld = getCachedStaticWorld(input.radius, input.worldSeed, BASE_HEX_SIZE);
      this.lastBaseSignature = "";
    }

    this.visibleByFlatIndex.clear();
    this.ownerByFlatIndex.clear();
    this.homeCoord = null;

    const nextExpeditions: ActiveExpeditionRenderItem[] = [];
    const r = this.staticWorld.radius;

    // Firma estructural ligera para detectar si realmente cambió la capa base
    // (terrenos revelados, propietarios, fronteras, capitales o frontera explorable).
    // Si solo cambió el progreso de expediciones/marchas o reclamos, NO se redibuja la capa base.
    let baseHash = (input.radius * 31 + input.worldSeed) | 0;
    let baseCellCount = 0;

    for (let i = 0; i < input.visibleCells.length; i++) {
      const cell = input.visibleCells[i];
      const idx = axialToFlatIndex(cell.q, cell.r, r);
      this.visibleByFlatIndex.set(idx, cell);

      if (cell.ownerKingdomId) {
        this.ownerByFlatIndex.set(idx, cell.ownerKingdomId);
      }
      if (cell.cellId === input.homeTerritoryId || (cell.isHome && cell.ownerKingdomId === input.kingdomId)) {
        this.homeCoord = { q: cell.q, r: cell.r };
      }

      // Índice compacto de expediciones activas (solo las celdas con expedición)
      if (cell.expedition) {
        nextExpeditions.push({
          flatIndex: idx,
          progressPercent: cell.expedition.progressPercent,
          isSpyMission: cell.expedition.isSpyMission,
        });
      }

      // Acumular firma únicamente de atributos que afectan la capa base
      const stateCode = cell.state === "owned" ? 3 : cell.state === "explored" ? 2 : cell.canExplore ? 1 : 0;
      if (stateCode !== 0) {
        baseCellCount++;
        const ownerHash = cell.ownerKingdomId ? hashSmallString(cell.ownerKingdomId) : 0;
        const colorHash = cell.ownerColor ? hashSmallString(cell.ownerColor) : 0;
        const terrainHash = cell.terrain !== "desconocido" && cell.terrain in TERRAIN_TO_CODE
          ? TERRAIN_TO_CODE[cell.terrain as TerrainType] + 1
          : 0;
        const cellSig = Math.imul(idx + 1, 2654435761) ^ (stateCode << 4) ^ (cell.isHome ? 8 : 0) ^ terrainHash ^ ownerHash ^ colorHash;
        baseHash = (baseHash + cellSig) | 0;
      }
    }

    this.activeExpeditionsIndex = nextExpeditions;

    // Pre-indexar reclamables una sola vez (elimina split(",") por fotograma en el overlay)
    if (input.pendingClaims > 0 && input.claimableAdjacentIds.size > 0) {
      const arr = new Int32Array(input.claimableAdjacentIds.size);
      let k = 0;
      for (const id of input.claimableAdjacentIds) {
        const comma = id.indexOf(",");
        if (comma > 0) {
          const cq = Number(id.slice(0, comma));
          const cr = Number(id.slice(comma + 1));
          arr[k++] = axialToFlatIndex(cq, cr, r);
        }
      }
      this.claimableFlatIndices = k === arr.length ? arr : arr.subarray(0, k);
    } else if (this.claimableFlatIndices.length > 0) {
      this.claimableFlatIndices = new Int32Array(0);
    }

    const nextBaseSig = `${input.kingdomId}:${input.homeTerritoryId ?? ""}:${baseCellCount}:${baseHash}`;
    const baseChanged = nextBaseSig !== this.lastBaseSignature;
    this.lastBaseSignature = nextBaseSig;

    this.perf.lastPrepMs = performance.now() - prepStart;
    this.perf.invalidationsByData++;
    if (baseChanged) {
      this.baseCamera = null;
    }
    this.scheduleRender(baseChanged);
  }

  setCamera(camera: CameraState): void {
    const camStart = performance.now();
    if (
      this.camera.x === camera.x &&
      this.camera.y === camera.y &&
      this.camera.zoom === camera.zoom
    ) {
      this.perf.lastCameraMs = performance.now() - camStart;
      return;
    }
    this.camera = { x: camera.x, y: camera.y, zoom: camera.zoom };
    this.perf.invalidationsByCamera++;

    // Si es pan puro (mismo zoom) dentro del margen overscan de la capa base ya renderizada,
    // reutilizamos la superficie base mediante desplazamiento 1:1 exacto sin redibujar terrenos.
    let needsBaseRedraw = true;
    if (this.baseCamera && !this.dirtyBase && this.baseCanvas && this.baseCamera.zoom === camera.zoom) {
      const deltaSx = (camera.x - this.baseCamera.x) * camera.zoom;
      const deltaSy = (camera.y - this.baseCamera.y) * camera.zoom;
      const limit = this.overscanCss - 2;
      if (Math.abs(deltaSx) <= limit && Math.abs(deltaSy) <= limit) {
        needsBaseRedraw = false;
        this.perf.panReuseHitCount++;
      }
    }

    this.perf.lastCameraMs = performance.now() - camStart;
    this.scheduleRender(needsBaseRedraw);
  }

  getCamera(): CameraState {
    return { ...this.camera };
  }

  setSelectedCell(q: number | null, r: number | null): void {
    const next = q !== null && r !== null ? axialToFlatIndex(q, r, this.staticWorld.radius) : null;
    if (next === this.selectedFlatIndex) return;
    this.selectedFlatIndex = next;
    this.perf.invalidationsBySelection++;
    // Selección solo ensucia la capa dinámica: O(1), sin redibujar el mapa base
    this.scheduleRender(false);
  }

  setHoveredCell(q: number | null, r: number | null): void {
    const next = q !== null && r !== null ? axialToFlatIndex(q, r, this.staticWorld.radius) : null;
    if (next === this.hoveredFlatIndex) return;
    this.hoveredFlatIndex = next;
    this.perf.invalidationsByHover++;
    // Hover solo ensucia la capa dinámica: O(1), sin redibujar el mapa base
    this.scheduleRender(false);
  }

  pickCellAtScreen(screenX: number, screenY: number): { q: number; r: number; cellId: string } | null {
    const coord = screenToAxial(
      screenX,
      screenY,
      this.camera,
      this.viewport,
      this.staticWorld.hexSize,
      this.staticWorld.radius
    );
    if (!coord) return null;
    return { q: coord.q, r: coord.r, cellId: cellId(coord.q, coord.r) };
  }

  getPerfSnapshot(): MapRendererPerfSnapshot {
    return {
      ...this.perf,
      dpr: this.dpr,
      stampCacheEntries: this.stampCache.size,
      stampCacheBytes: this.stampCache.bytesUsed,
    };
  }

  /** Fuerza renderizado inmediato (útil para pruebas o tras un cambio síncrono). */
  renderNow(): void {
    if (this.destroyed) return;
    const frameStart = performance.now();

    if (this.dirtyBase || !this.baseCanvas || !this.baseCamera) {
      const baseStart = performance.now();
      this.renderBaseLayer();
      this.perf.lastBaseRenderMs = performance.now() - baseStart;
      this.perf.baseRenderCount++;
      this.dirtyBase = false;
    } else {
      this.perf.lastBaseRenderMs = 0;
    }

    const overlayStart = performance.now();
    this.composeAndRenderOverlay();
    this.perf.lastOverlayRenderMs = performance.now() - overlayStart;
    this.perf.overlayRenderCount++;
    this.dirtyOverlay = false;

    this.perf.lastFrameMs = performance.now() - frameStart;
  }

  scheduleRender(needsBaseRedraw: boolean): void {
    if (this.destroyed) return;
    if (needsBaseRedraw) this.dirtyBase = true;
    this.dirtyOverlay = true;

    if (this.rafId !== null) return;
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      this.rafId = window.requestAnimationFrame(() => {
        this.rafId = null;
        this.renderNow();
      });
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stampCache.clear();
    this.visibleByFlatIndex.clear();
    this.ownerByFlatIndex.clear();
    this.activeExpeditionsIndex = [];
    this.claimableFlatIndices = new Int32Array(0);
    this.scratchOwnedSx.length = 0;
    this.scratchOwnedSy.length = 0;
    this.scratchOwnedCell.length = 0;
    this.scratchCapitalSx.length = 0;
    this.scratchCapitalSy.length = 0;
    this.scratchCapitalCell.length = 0;
    this.scratchExplorableSx.length = 0;
    this.scratchExplorableSy.length = 0;
    this.baseCanvas = null;
    this.baseCtx = null;
    this.baseCamera = null;
  }

  private ensureBaseSurface(backingW: number, backingH: number): void {
    if (this.offscreenFactory) {
      const custom = this.offscreenFactory(backingW, backingH);
      if (custom) {
        const ctx = custom.getContext("2d", { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (ctx) {
          this.baseCanvas = custom;
          this.baseCtx = ctx;
          return;
        }
      }
    }
    if (typeof OffscreenCanvas !== "undefined") {
      const oc = new OffscreenCanvas(backingW, backingH);
      const ctx = oc.getContext("2d", { alpha: false });
      if (ctx) {
        this.baseCanvas = oc;
        this.baseCtx = ctx;
        return;
      }
    }
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = backingW;
      c.height = backingH;
      const ctx = c.getContext("2d", { alpha: false });
      this.baseCanvas = c;
      this.baseCtx = ctx;
    }
  }

  private renderBaseLayer(): void {
    const targetCtx = (this.baseCtx ?? this.ctx) as CanvasRenderingContext2D;
    const { width, height } = this.viewport;
    const overscan = this.baseCtx ? this.overscanCss : 0;
    const surfW = width + overscan * 2;
    const surfH = height + overscan * 2;

    const world = this.staticWorld;
    const radius = world.radius;
    const stride = world.stride;
    const zoom = this.camera.zoom;
    const hexSize = world.hexSize;
    const pixelRadius = hexSize * zoom;
    const lod = selectLodLevel(pixelRadius);

    this.baseCamera = { x: this.camera.x, y: this.camera.y, zoom };

    targetCtx.save();
    targetCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Fondo de océano profundo / pergamino cartográfico fuera del disco
    const bgGrad = targetCtx.createRadialGradient(
      surfW * 0.5,
      surfH * 0.5,
      Math.min(surfW, surfH) * 0.1,
      surfW * 0.5,
      surfH * 0.5,
      Math.max(surfW, surfH) * 0.85
    );
    bgGrad.addColorStop(0, "#151a1f");
    bgGrad.addColorStop(1, "#0b0e11");
    targetCtx.fillStyle = bgGrad;
    targetCtx.fillRect(0, 0, surfW, surfH);

    const bounds = computeVisibleAxialBounds(
      this.camera,
      { width: surfW, height: surfH },
      hexSize,
      radius,
      1.5
    );
    const screenHalfW = surfW * 0.5;
    const screenHalfH = surfH * 0.5;
    const camX = this.camera.x;
    const camY = this.camera.y;

    const stampW = pixelRadius * SQRT3 + 1.2;
    const stampH = pixelRadius * 2 + 1.2;

    // Reutilizar buffers scratch sin asignar objetos nuevos en cada fotograma
    let ownedCount = 0;
    let capitalCount = 0;
    let explorableCount = 0;
    let processedHexes = 0;
    let terrainDrawn = 0;
    let fogDrawn = 0;

    // PASADA 1: Terreno ilustrado y niebla de guerra (solo hexágonos en superficie visible: O(V))
    for (let r = bounds.rMin; r <= bounds.rMax; r++) {
      const { qMin, qMax } = bounds.qRangeForRow(r);
      for (let q = qMin; q <= qMax; q++) {
        const idx = (q + radius) * stride + (r + radius);
        if (world.valid[idx] === 0) continue;

        const sx = (world.worldX[idx] + camX) * zoom + screenHalfW;
        const sy = (world.worldY[idx] + camY) * zoom + screenHalfH;
        if (sx < -pixelRadius * 2 || sx > surfW + pixelRadius * 2 || sy < -pixelRadius * 2 || sy > surfH + pixelRadius * 2) {
          continue;
        }

        processedHexes++;
        const dyn = this.visibleByFlatIndex.get(idx);
        const variant = world.variant[idx];

        if (!dyn || dyn.state === "fog" || dyn.state === "exploring") {
          fogDrawn++;
          const fogStamp = this.stampCache.getFogStamp(variant, lod);
          if (fogStamp) {
            targetCtx.drawImage(fogStamp.canvas, sx - stampW * 0.5, sy - stampH * 0.5, stampW, stampH);
          } else {
            drawFogHex(targetCtx, sx, sy, pixelRadius, variant, lod);
          }
          if (dyn?.canExplore) {
            this.scratchExplorableSx[explorableCount] = sx;
            this.scratchExplorableSy[explorableCount] = sy;
            explorableCount++;
          }
          continue;
        }

        terrainDrawn++;
        const tCode =
          dyn.terrain !== "desconocido" && dyn.terrain in TERRAIN_TO_CODE
            ? TERRAIN_TO_CODE[dyn.terrain as TerrainType]
            : world.terrainCode[idx];

        const stamp = this.stampCache.getTerrainStamp(tCode, variant, lod);
        if (stamp) {
          targetCtx.drawImage(stamp.canvas, sx - stampW * 0.5, sy - stampH * 0.5, stampW, stampH);
        } else {
          drawIllustratedTerrainHex(targetCtx, sx, sy, pixelRadius, dyn.terrain as TerrainType, variant, lod);
        }

        if (dyn.ownerKingdomId) {
          this.scratchOwnedSx[ownedCount] = sx;
          this.scratchOwnedSy[ownedCount] = sy;
          this.scratchOwnedCell[ownedCount] = dyn;
          ownedCount++;
          if (dyn.isHome) {
            this.scratchCapitalSx[capitalCount] = sx;
            this.scratchCapitalSy[capitalCount] = sy;
            this.scratchCapitalCell[capitalCount] = dyn;
            capitalCount++;
          }
        }
      }
    }

    // PASADA 2: Frontera explorable sutil
    if (explorableCount > 0) {
      targetCtx.fillStyle = FOG_PALETTE.explorableTint;
      targetCtx.strokeStyle = FOG_PALETTE.explorableStroke;
      targetCtx.lineWidth = Math.max(0.8, Math.min(1.5, pixelRadius * 0.05));
      for (let i = 0; i < explorableCount; i++) {
        traceHexPath(targetCtx, this.scratchExplorableSx[i], this.scratchExplorableSy[i], pixelRadius - 0.6);
        targetCtx.fill();
        targetCtx.stroke();
      }
    }

    // PASADA 3: Velo heráldico translúcido + fronteras exteriores de reinos (aristas compartidas)
    if (ownedCount > 0) {
      const borderWidth = Math.max(1.8, Math.min(4.2, pixelRadius * 0.12));

      targetCtx.save();
      targetCtx.globalAlpha = 0.22;
      for (let i = 0; i < ownedCount; i++) {
        const cell = this.scratchOwnedCell[i];
        targetCtx.fillStyle = cell.ownerColor ?? "#d4af37";
        traceHexPath(targetCtx, this.scratchOwnedSx[i], this.scratchOwnedSy[i], pixelRadius - 0.3);
        targetCtx.fill();
      }
      targetCtx.restore();

      // Aristas exteriores: perfilado oscuro agrupado en un solo trazado
      targetCtx.lineCap = "round";
      targetCtx.strokeStyle = "rgba(18, 13, 8, 0.85)";
      targetCtx.lineWidth = borderWidth + 2;
      targetCtx.beginPath();
      for (let i = 0; i < ownedCount; i++) {
        const cell = this.scratchOwnedCell[i];
        const sx = this.scratchOwnedSx[i];
        const sy = this.scratchOwnedSy[i];
        const ownerId = cell.ownerKingdomId!;
        for (let edge = 0; edge < 6; edge++) {
          const dir = HEX_EDGE_NEIGHBORS[edge];
          const nq = cell.q + dir.q;
          const nr = cell.r + dir.r;
          const inside = Math.abs(nq) <= radius && Math.abs(nr) <= radius && Math.abs(nq + nr) <= radius;
          const neighborOwner = inside
            ? this.ownerByFlatIndex.get((nq + radius) * stride + (nr + radius))
            : undefined;
          if (neighborOwner === ownerId) continue;

          const v1 = HEX_UNIT_VERTICES[edge];
          const v2 = HEX_UNIT_VERTICES[(edge + 1) % 6];
          targetCtx.moveTo(sx + v1.x * (pixelRadius - 0.5), sy + v1.y * (pixelRadius - 0.5));
          targetCtx.lineTo(sx + v2.x * (pixelRadius - 0.5), sy + v2.y * (pixelRadius - 0.5));
        }
      }
      targetCtx.stroke();

      // Aristas exteriores en color de cada reino
      targetCtx.lineWidth = borderWidth;
      for (let i = 0; i < ownedCount; i++) {
        const cell = this.scratchOwnedCell[i];
        const sx = this.scratchOwnedSx[i];
        const sy = this.scratchOwnedSy[i];
        const ownerId = cell.ownerKingdomId!;
        targetCtx.strokeStyle = cell.ownerColor ?? "#d4af37";
        targetCtx.beginPath();
        let hasEdge = false;
        for (let edge = 0; edge < 6; edge++) {
          const dir = HEX_EDGE_NEIGHBORS[edge];
          const nq = cell.q + dir.q;
          const nr = cell.r + dir.r;
          const inside = Math.abs(nq) <= radius && Math.abs(nr) <= radius && Math.abs(nq + nr) <= radius;
          const neighborOwner = inside
            ? this.ownerByFlatIndex.get((nq + radius) * stride + (nr + radius))
            : undefined;
          if (neighborOwner === ownerId) continue;

          const v1 = HEX_UNIT_VERTICES[edge];
          const v2 = HEX_UNIT_VERTICES[(edge + 1) % 6];
          targetCtx.moveTo(sx + v1.x * (pixelRadius - 0.5), sy + v1.y * (pixelRadius - 0.5));
          targetCtx.lineTo(sx + v2.x * (pixelRadius - 0.5), sy + v2.y * (pixelRadius - 0.5));
          hasEdge = true;
        }
        if (hasEdge) targetCtx.stroke();
      }

      // Blasón discreto en provincias no capitales
      for (let i = 0; i < ownedCount; i++) {
        const cell = this.scratchOwnedCell[i];
        if (!cell.isHome) {
          drawProvinceBanner(targetCtx, this.scratchOwnedSx[i], this.scratchOwnedSy[i], pixelRadius, cell.ownerColor ?? "#d4af37");
        }
      }
    }

    // PASADA 4: Fortalezas medievales de las capitales (siempre prominentes)
    const ownKingdomId = this.input?.kingdomId;
    for (let i = 0; i < capitalCount; i++) {
      const cell = this.scratchCapitalCell[i];
      const sx = this.scratchCapitalSx[i];
      const sy = this.scratchCapitalSy[i];
      const isOwn = cell.ownerKingdomId === ownKingdomId;
      drawMedievalCapitalFortress(targetCtx, sx, sy, pixelRadius, cell.ownerColor ?? "#fbbf24", isOwn);

      if (pixelRadius >= 18 && cell.ownerName) {
        targetCtx.save();
        targetCtx.font = `700 ${Math.max(10, Math.min(13, Math.round(pixelRadius * 0.42)))}px Georgia, serif`;
        targetCtx.textAlign = "center";
        targetCtx.textBaseline = "top";
        const labelY = sy + pixelRadius * 0.55;
        targetCtx.lineWidth = 3;
        targetCtx.strokeStyle = "rgba(15, 11, 7, 0.9)";
        targetCtx.strokeText(cell.ownerName, sx, labelY);
        targetCtx.fillStyle = isOwn ? "#fde68a" : "#f5efe0";
        targetCtx.fillText(cell.ownerName, sx, labelY);
        targetCtx.restore();
      }
    }

    targetCtx.restore();
    this.perf.lastVisibleHexCount = processedHexes;
    this.perf.lastTerrainDrawnCount = terrainDrawn;
    this.perf.lastFogDrawnCount = fogDrawn;
  }

  private composeAndRenderOverlay(): void {
    const ctx = this.ctx;
    const { width, height } = this.viewport;
    const world = this.staticWorld;
    const zoom = this.camera.zoom;
    const pixelRadius = world.hexSize * zoom;

    // 1. Blit 1:1 de la capa base cacheada con desplazamiento exacto de pan si aplica (coste O(1))
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.baseCanvas) {
      const overscan = this.baseCtx ? this.overscanCss : 0;
      const deltaSx = this.baseCamera ? (this.camera.x - this.baseCamera.x) * zoom : 0;
      const deltaSy = this.baseCamera ? (this.camera.y - this.baseCamera.y) * zoom : 0;
      const drawX = Math.round((-overscan + deltaSx) * this.dpr);
      const drawY = Math.round((-overscan + deltaSy) * this.dpr);
      ctx.drawImage(this.baseCanvas, drawX, drawY);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const screenHalfW = width * 0.5;
    const screenHalfH = height * 0.5;
    const camX = this.camera.x;
    const camY = this.camera.y;

    // 2. Territorios reclamables gratuitamente (índice compacto pre-calculado, sin split por frame)
    if (this.claimableFlatIndices.length > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(251, 191, 36, 0.85)";
      ctx.lineWidth = Math.max(1.5, pixelRadius * 0.08);
      ctx.setLineDash([4, 3]);
      for (let i = 0; i < this.claimableFlatIndices.length; i++) {
        const idx = this.claimableFlatIndices[i];
        const sx = (world.worldX[idx] + camX) * zoom + screenHalfW;
        const sy = (world.worldY[idx] + camY) * zoom + screenHalfH;
        if (sx < -pixelRadius || sx > width + pixelRadius || sy < -pixelRadius || sy > height + pixelRadius) continue;
        traceHexPath(ctx, sx, sy, pixelRadius - 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Expediciones activas: recorre EXCLUSIVAMENTE el índice compacto con culling espacial
    let expeditionsInspected = 0;
    let expeditionsDrawn = 0;
    if (this.activeExpeditionsIndex.length > 0) {
      const ringR = Math.max(6, pixelRadius * 0.48);
      const dotR = Math.max(2, ringR * 0.28);
      const lineW = Math.max(2, pixelRadius * 0.09);

      for (let i = 0; i < this.activeExpeditionsIndex.length; i++) {
        expeditionsInspected++;
        const exp = this.activeExpeditionsIndex[i];
        const idx = exp.flatIndex;
        const sx = (world.worldX[idx] + camX) * zoom + screenHalfW;
        const sy = (world.worldY[idx] + camY) * zoom + screenHalfH;
        if (sx < -pixelRadius || sx > width + pixelRadius || sy < -pixelRadius || sy > height + pixelRadius) continue;

        expeditionsDrawn++;
        ctx.fillStyle = "rgba(18, 22, 34, 0.78)";
        ctx.beginPath();
        ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
        ctx.fill();

        const pct = Math.max(0.05, Math.min(1, exp.progressPercent / 100));
        ctx.strokeStyle = exp.isSpyMission ? "#c084fc" : "#38bdf8";
        ctx.lineWidth = lineW;
        ctx.beginPath();
        ctx.arc(sx, sy, ringR, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * pct);
        ctx.stroke();

        ctx.fillStyle = "#f8fafc";
        ctx.beginPath();
        ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.perf.lastExpeditionsInspected = expeditionsInspected;
    this.perf.lastExpeditionsDrawn = expeditionsDrawn;

    // 4. Marchas militares activas (trayectoria + marcador de progreso)
    if (this.input && this.input.activeMarches.length > 0) {
      const originScreen = this.homeCoord
        ? worldToScreen(
            world.worldX[axialToFlatIndex(this.homeCoord.q, this.homeCoord.r, world.radius)],
            world.worldY[axialToFlatIndex(this.homeCoord.q, this.homeCoord.r, world.radius)],
            this.camera,
            this.viewport
          )
        : null;

      for (let i = 0; i < this.input.activeMarches.length; i++) {
        const m = this.input.activeMarches[i];
        const targetIdx = axialToFlatIndex(m.targetQ, m.targetR, world.radius);
        const tx = (world.worldX[targetIdx] + camX) * zoom + screenHalfW;
        const ty = (world.worldY[targetIdx] + camY) * zoom + screenHalfH;

        ctx.save();
        if (originScreen) {
          ctx.strokeStyle = m.isConquest ? "rgba(248, 113, 113, 0.82)" : "rgba(251, 191, 36, 0.8)";
          ctx.lineWidth = Math.max(1.8, Math.min(3, pixelRadius * 0.09));
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(originScreen.x, originScreen.y);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          ctx.setLineDash([]);

          const frac = Math.max(0.05, Math.min(0.95, m.progressPercent / 100));
          const mx = originScreen.x + (tx - originScreen.x) * frac;
          const my = originScreen.y + (ty - originScreen.y) * frac;
          ctx.fillStyle = "#140c0a";
          ctx.beginPath();
          ctx.arc(mx, my, Math.max(5.5, pixelRadius * 0.26), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = m.isConquest ? "#ef4444" : "#f59e0b";
          ctx.beginPath();
          ctx.arc(mx, my, Math.max(3.8, pixelRadius * 0.18), 0, Math.PI * 2);
          ctx.fill();
        }

        traceHexPath(ctx, tx, ty, pixelRadius - 1.5);
        ctx.strokeStyle = "#f87171";
        ctx.lineWidth = Math.max(2, pixelRadius * 0.1);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 5. Resaltado de hover (capa independiente)
    if (this.hoveredFlatIndex !== null && world.valid[this.hoveredFlatIndex] === 1) {
      const sx = (world.worldX[this.hoveredFlatIndex] + camX) * zoom + screenHalfW;
      const sy = (world.worldY[this.hoveredFlatIndex] + camY) * zoom + screenHalfH;
      ctx.save();
      traceHexPath(ctx, sx, sy, pixelRadius - 0.5);
      ctx.fillStyle = "rgba(255, 248, 220, 0.14)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 248, 220, 0.78)";
      ctx.lineWidth = Math.max(1.5, pixelRadius * 0.075);
      ctx.stroke();
      ctx.restore();
    }

    // 6. Resaltado de selección activa (doble marco dorado)
    if (this.selectedFlatIndex !== null && world.valid[this.selectedFlatIndex] === 1) {
      const sx = (world.worldX[this.selectedFlatIndex] + camX) * zoom + screenHalfW;
      const sy = (world.worldY[this.selectedFlatIndex] + camY) * zoom + screenHalfH;
      ctx.save();
      traceHexPath(ctx, sx, sy, pixelRadius + 0.5);
      ctx.strokeStyle = "rgba(18, 12, 5, 0.9)";
      ctx.lineWidth = Math.max(3.5, pixelRadius * 0.16);
      ctx.stroke();

      traceHexPath(ctx, sx, sy, pixelRadius - 0.5);
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = Math.max(2.2, pixelRadius * 0.1);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }
}

function hashSmallString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
