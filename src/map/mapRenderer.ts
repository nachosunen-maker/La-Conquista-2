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
  lastBaseRenderMs: number;
  lastOverlayRenderMs: number;
  lastVisibleHexCount: number;
  baseRenderCount: number;
  overlayRenderCount: number;
  dpr: number;
  stampCacheEntries: number;
  stampCacheBytes: number;
}

export class MedievalMapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private baseCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private baseCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

  private readonly stampCache = new TerrainStampCache(128, 12 * 1024 * 1024);

  private staticWorld: StaticWorldIndex;
  private visibleByFlatIndex = new Map<number, RenderableMapCell>();
  private ownerByFlatIndex = new Map<number, string>();
  private homeCoord: { q: number; r: number } | null = null;

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
    lastBaseRenderMs: 0,
    lastOverlayRenderMs: 0,
    lastVisibleHexCount: 0,
    baseRenderCount: 0,
    overlayRenderCount: 0,
    dpr: 1,
    stampCacheEntries: 0,
    stampCacheBytes: 0,
  };

  constructor(canvas: HTMLCanvasElement, radius: number = 50, worldSeed: number = 20261017) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("No se pudo inicializar el contexto Canvas 2D del mapa.");
    }
    this.ctx = ctx;
    this.staticWorld = getCachedStaticWorld(radius, worldSeed, BASE_HEX_SIZE);
  }

  setViewport(width: number, height: number, devicePixelRatio: number = window.devicePixelRatio || 1): void {
    const safeW = Math.max(1, Math.floor(width));
    const safeH = Math.max(1, Math.floor(height));
    const nextDpr = computeAdaptiveDpr(safeW, safeH, devicePixelRatio);

    if (this.viewport.width === safeW && this.viewport.height === safeH && this.dpr === nextDpr) {
      return;
    }

    this.viewport = { width: safeW, height: safeH };
    this.dpr = nextDpr;

    const backingW = Math.max(1, Math.floor(safeW * nextDpr));
    const backingH = Math.max(1, Math.floor(safeH * nextDpr));

    this.canvas.width = backingW;
    this.canvas.height = backingH;
    this.canvas.style.width = `${safeW}px`;
    this.canvas.style.height = `${safeH}px`;

    this.ensureBaseSurface(backingW, backingH);
    this.scheduleRender(true);
  }

  setData(input: MapRenderInput): void {
    this.input = input;
    if (this.staticWorld.radius !== input.radius || this.staticWorld.seed !== input.worldSeed) {
      this.staticWorld = getCachedStaticWorld(input.radius, input.worldSeed, BASE_HEX_SIZE);
    }

    this.visibleByFlatIndex.clear();
    this.ownerByFlatIndex.clear();
    this.homeCoord = null;

    const r = this.staticWorld.radius;
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
    }

    this.scheduleRender(true);
  }

  setCamera(camera: CameraState): void {
    if (
      this.camera.x === camera.x &&
      this.camera.y === camera.y &&
      this.camera.zoom === camera.zoom
    ) {
      return;
    }
    this.camera = { ...camera };
    this.scheduleRender(true);
  }

  getCamera(): CameraState {
    return { ...this.camera };
  }

  setSelectedCell(q: number | null, r: number | null): void {
    const next = q !== null && r !== null ? axialToFlatIndex(q, r, this.staticWorld.radius) : null;
    if (next === this.selectedFlatIndex) return;
    this.selectedFlatIndex = next;
    // Selección solo ensucia la capa dinámica: O(1), sin redibujar el mapa base
    this.scheduleRender(false);
  }

  setHoveredCell(q: number | null, r: number | null): void {
    const next = q !== null && r !== null ? axialToFlatIndex(q, r, this.staticWorld.radius) : null;
    if (next === this.hoveredFlatIndex) return;
    this.hoveredFlatIndex = next;
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

    if (this.dirtyBase || !this.baseCanvas) {
      const baseStart = performance.now();
      this.renderBaseLayer();
      this.perf.lastBaseRenderMs = performance.now() - baseStart;
      this.perf.baseRenderCount++;
      this.dirtyBase = false;
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
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      this.renderNow();
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stampCache.clear();
    this.visibleByFlatIndex.clear();
    this.ownerByFlatIndex.clear();
    this.baseCanvas = null;
    this.baseCtx = null;
  }

  private ensureBaseSurface(backingW: number, backingH: number): void {
    if (typeof OffscreenCanvas !== "undefined") {
      const oc = new OffscreenCanvas(backingW, backingH);
      const ctx = oc.getContext("2d", { alpha: false });
      if (ctx) {
        this.baseCanvas = oc;
        this.baseCtx = ctx;
        return;
      }
    }
    const c = document.createElement("canvas");
    c.width = backingW;
    c.height = backingH;
    const ctx = c.getContext("2d", { alpha: false });
    this.baseCanvas = c;
    this.baseCtx = ctx;
  }

  private renderBaseLayer(): void {
    const targetCtx = (this.baseCtx ?? this.ctx) as CanvasRenderingContext2D;
    const { width, height } = this.viewport;
    const world = this.staticWorld;
    const radius = world.radius;
    const stride = world.stride;
    const zoom = this.camera.zoom;
    const hexSize = world.hexSize;
    const pixelRadius = hexSize * zoom;
    const lod = selectLodLevel(pixelRadius);

    targetCtx.save();
    targetCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Fondo de océano profundo / pergamino cartográfico fuera del disco
    const bgGrad = targetCtx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      Math.min(width, height) * 0.1,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.85
    );
    bgGrad.addColorStop(0, "#151a1f");
    bgGrad.addColorStop(1, "#0b0e11");
    targetCtx.fillStyle = bgGrad;
    targetCtx.fillRect(0, 0, width, height);

    const bounds = computeVisibleAxialBounds(this.camera, this.viewport, hexSize, radius, 1.5);
    const screenHalfW = width * 0.5;
    const screenHalfH = height * 0.5;
    const camX = this.camera.x;
    const camY = this.camera.y;

    const stampW = pixelRadius * SQRT3 + 1.2;
    const stampH = pixelRadius * 2 + 1.2;

    // Colecciones ligeras de elementos que se dibujan encima de la capa de terreno
    const visibleOwned: Array<{ idx: number; sx: number; sy: number; cell: RenderableMapCell }> = [];
    const visibleCapitals: Array<{ sx: number; sy: number; cell: RenderableMapCell }> = [];
    const visibleExplorable: Array<{ sx: number; sy: number }> = [];

    let processedHexes = 0;

    // PASADA 1: Terreno ilustrado y niebla de guerra (solo hexágonos en viewport: O(V))
    for (let r = bounds.rMin; r <= bounds.rMax; r++) {
      const { qMin, qMax } = bounds.qRangeForRow(r);
      for (let q = qMin; q <= qMax; q++) {
        const idx = (q + radius) * stride + (r + radius);
        if (world.valid[idx] === 0) continue;

        const sx = (world.worldX[idx] + camX) * zoom + screenHalfW;
        const sy = (world.worldY[idx] + camY) * zoom + screenHalfH;
        if (sx < -pixelRadius * 2 || sx > width + pixelRadius * 2 || sy < -pixelRadius * 2 || sy > height + pixelRadius * 2) {
          continue;
        }

        processedHexes++;
        const dyn = this.visibleByFlatIndex.get(idx);
        const variant = world.variant[idx];

        if (!dyn || dyn.state === "fog" || dyn.state === "exploring") {
          const fogStamp = this.stampCache.getFogStamp(variant, lod);
          if (fogStamp) {
            targetCtx.drawImage(fogStamp.canvas, sx - stampW * 0.5, sy - stampH * 0.5, stampW, stampH);
          } else {
            drawFogHex(targetCtx, sx, sy, pixelRadius, variant, lod);
          }
          if (dyn?.canExplore) {
            visibleExplorable.push({ sx, sy });
          }
          continue;
        }

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
          visibleOwned.push({ idx, sx, sy, cell: dyn });
          if (dyn.isHome) {
            visibleCapitals.push({ sx, sy, cell: dyn });
          }
        }
      }
    }

    // PASADA 2: Frontera explorable sutil
    if (visibleExplorable.length > 0) {
      targetCtx.fillStyle = FOG_PALETTE.explorableTint;
      targetCtx.strokeStyle = FOG_PALETTE.explorableStroke;
      targetCtx.lineWidth = Math.max(0.8, Math.min(1.5, pixelRadius * 0.05));
      for (let i = 0; i < visibleExplorable.length; i++) {
        const pt = visibleExplorable[i];
        traceHexPath(targetCtx, pt.sx, pt.sy, pixelRadius - 0.6);
        targetCtx.fill();
        targetCtx.stroke();
      }
    }

    // PASADA 3: Velo heráldico translúcido + fronteras exteriores de reinos (aristas compartidas)
    if (visibleOwned.length > 0) {
      const borderWidth = Math.max(1.8, Math.min(4.2, pixelRadius * 0.12));
      for (let i = 0; i < visibleOwned.length; i++) {
        const { sx, sy, cell } = visibleOwned[i];
        const color = cell.ownerColor ?? "#d4af37";
        targetCtx.save();
        targetCtx.globalAlpha = 0.22;
        targetCtx.fillStyle = color;
        traceHexPath(targetCtx, sx, sy, pixelRadius - 0.3);
        targetCtx.fill();
        targetCtx.restore();
      }

      // Aristas exteriores (solo bordes cuyo vecino NO pertenece al mismo reino)
      targetCtx.lineCap = "round";
      for (let i = 0; i < visibleOwned.length; i++) {
        const { sx, sy, cell } = visibleOwned[i];
        const ownerId = cell.ownerKingdomId!;
        const color = cell.ownerColor ?? "#d4af37";

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
          const x1 = sx + v1.x * (pixelRadius - 0.5);
          const y1 = sy + v1.y * (pixelRadius - 0.5);
          const x2 = sx + v2.x * (pixelRadius - 0.5);
          const y2 = sy + v2.y * (pixelRadius - 0.5);

          // Perfilado oscuro para máximo contraste sobre cualquier terreno
          targetCtx.strokeStyle = "rgba(18, 13, 8, 0.85)";
          targetCtx.lineWidth = borderWidth + 2;
          targetCtx.beginPath();
          targetCtx.moveTo(x1, y1);
          targetCtx.lineTo(x2, y2);
          targetCtx.stroke();

          // Línea principal en el color del reino
          targetCtx.strokeStyle = color;
          targetCtx.lineWidth = borderWidth;
          targetCtx.beginPath();
          targetCtx.moveTo(x1, y1);
          targetCtx.lineTo(x2, y2);
          targetCtx.stroke();
        }
      }

      // Blasón discreto en provincias no capitales
      for (let i = 0; i < visibleOwned.length; i++) {
        const { sx, sy, cell } = visibleOwned[i];
        if (!cell.isHome) {
          drawProvinceBanner(targetCtx, sx, sy, pixelRadius, cell.ownerColor ?? "#d4af37");
        }
      }
    }

    // PASADA 4: Fortalezas medievales de las capitales (siempre prominentes)
    const ownKingdomId = this.input?.kingdomId;
    for (let i = 0; i < visibleCapitals.length; i++) {
      const { sx, sy, cell } = visibleCapitals[i];
      const isOwn = cell.ownerKingdomId === ownKingdomId;
      drawMedievalCapitalFortress(targetCtx, sx, sy, pixelRadius, cell.ownerColor ?? "#fbbf24", isOwn);

      // Etiqueta de capital cuando hay suficiente zoom
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
  }

  private composeAndRenderOverlay(): void {
    const ctx = this.ctx;
    const { width, height } = this.viewport;
    const world = this.staticWorld;
    const zoom = this.camera.zoom;
    const pixelRadius = world.hexSize * zoom;

    // 1. Blit 1:1 de la capa base cacheada (coste O(1))
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.baseCanvas) {
      ctx.drawImage(this.baseCanvas, 0, 0);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const screenHalfW = width * 0.5;
    const screenHalfH = height * 0.5;
    const camX = this.camera.x;
    const camY = this.camera.y;

    // 2. Territorios reclamables gratuitamente (si hay reclamos pendientes)
    if (this.input && this.input.pendingClaims > 0 && this.input.claimableAdjacentIds.size > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(251, 191, 36, 0.85)";
      ctx.lineWidth = Math.max(1.5, pixelRadius * 0.08);
      ctx.setLineDash([4, 3]);
      for (const id of this.input.claimableAdjacentIds) {
        const parts = id.split(",");
        const q = Number(parts[0]);
        const r = Number(parts[1]);
        const idx = axialToFlatIndex(q, r, world.radius);
        const sx = (world.worldX[idx] + camX) * zoom + screenHalfW;
        const sy = (world.worldY[idx] + camY) * zoom + screenHalfH;
        if (sx < -pixelRadius || sx > width + pixelRadius || sy < -pixelRadius || sy > height + pixelRadius) continue;
        traceHexPath(ctx, sx, sy, pixelRadius - 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Expediciones activas (anillo de progreso)
    if (this.input) {
      for (let i = 0; i < this.input.visibleCells.length; i++) {
        const cell = this.input.visibleCells[i];
        if (!cell.expedition) continue;
        const idx = axialToFlatIndex(cell.q, cell.r, world.radius);
        const sx = (world.worldX[idx] + camX) * zoom + screenHalfW;
        const sy = (world.worldY[idx] + camY) * zoom + screenHalfH;
        if (sx < -pixelRadius || sx > width + pixelRadius || sy < -pixelRadius || sy > height + pixelRadius) continue;

        const ringR = Math.max(6, pixelRadius * 0.48);
        ctx.save();
        ctx.fillStyle = "rgba(18, 22, 34, 0.78)";
        ctx.beginPath();
        ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
        ctx.fill();

        const pct = Math.max(0.05, Math.min(1, cell.expedition.progressPercent / 100));
        ctx.strokeStyle = cell.expedition.isSpyMission ? "#c084fc" : "#38bdf8";
        ctx.lineWidth = Math.max(2, pixelRadius * 0.09);
        ctx.beginPath();
        ctx.arc(sx, sy, ringR, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * pct);
        ctx.stroke();

        ctx.fillStyle = "#f8fafc";
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(2, ringR * 0.28), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 4. Marchas militares activas (trayectoria + marcador de progreso)
      if (this.input.activeMarches.length > 0) {
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

            // Posición actual de la columna militar en ruta
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

          // Dianas sobre destino de marcha
          traceHexPath(ctx, tx, ty, pixelRadius - 1.5);
          ctx.strokeStyle = "#f87171";
          ctx.lineWidth = Math.max(2, pixelRadius * 0.1);
          ctx.stroke();
          ctx.restore();
        }
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
