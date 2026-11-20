/**
 * LA CONQUISTA — ARQUITECTURA VISUAL ILUSTRADA 2D MEDIEVAL Y CACHÉ DE STAMPS (Puntos 3 + 4)
 *
 * Diseñada para:
 * 1. Ofrecer una lectura cartográfica medieval ilustrada inmediata de los 6 terrenos
 *    (llanura, bosque, colina, montaña, río, costa) y niebla de guerra con 3 niveles de LOD.
 * 2. Pre-renderizar stamps de terreno en cachés offscreen estrictamente acotadas (LRU + presupuesto
 *    de bytes) para que el renderizado de cada fotograma sea un blit O(1) por hexágono visible.
 * 3. Proveer un contrato limpio de registro de sprites/atlas (`TerrainAssetRegistry`) preparado
 *    para conectar la librería gráfica definitiva en el Punto 7 con fallback automático.
 */
import type { TerrainType } from "../../convex/balanceConfig";
import { CODE_TO_TERRAIN, HEX_UNIT_VERTICES, SQRT3 } from "./hexMath";

export type MapLodLevel = 0 | 1 | 2;

export interface TerrainSpriteSource {
  readonly image: CanvasImageSource;
  readonly sx?: number;
  readonly sy?: number;
  readonly sw?: number;
  readonly sh?: number;
}

/**
 * Contrato extensible para conectar sprites/atlas reales en el Punto 7 sin modificar el motor
 * de renderizado. Si devuelve `null`, el motor utiliza automáticamente el ilustrador procedural 2D.
 */
export interface TerrainAssetProvider {
  getTerrainSprite(terrain: TerrainType, variant: number, lod: MapLodLevel): TerrainSpriteSource | null;
  getCapitalSprite?(isOwnCapital: boolean, lod: MapLodLevel): TerrainSpriteSource | null;
}

class TerrainAssetRegistry {
  private provider: TerrainAssetProvider | null = null;

  registerProvider(provider: TerrainAssetProvider | null): void {
    this.provider = provider;
  }

  getProvider(): TerrainAssetProvider | null {
    return this.provider;
  }
}

export const terrainAssetRegistry = new TerrainAssetRegistry();

/** Paleta cartográfica medieval inspirada en atlas iluminados y estrategia clásica 2D. */
export const MEDIEVAL_TERRAIN_PALETTE: Record<
  TerrainType,
  {
    readonly baseTop: string;
    readonly baseBottom: string;
    readonly stroke: string;
    readonly accent: string;
    readonly accentDark: string;
    readonly highlight: string;
    readonly swatch: string;
    readonly label: string;
  }
> = {
  llanura: {
    baseTop: "#8da85a",
    baseBottom: "#728c45",
    stroke: "#5c7238",
    accent: "#b5c976",
    accentDark: "#5b7334",
    highlight: "#d8df9e",
    swatch: "#8da85a",
    label: "Llanura",
  },
  bosque: {
    baseTop: "#3d6a44",
    baseBottom: "#2a4d32",
    stroke: "#1f3a25",
    accent: "#214027",
    accentDark: "#152b1a",
    highlight: "#5a8c57",
    swatch: "#35613d",
    label: "Bosque",
  },
  colina: {
    baseTop: "#b89558",
    baseBottom: "#97753e",
    stroke: "#795d31",
    accent: "#cfa96a",
    accentDark: "#6e5227",
    highlight: "#e2c792",
    swatch: "#b89558",
    label: "Colina",
  },
  montana: {
    baseTop: "#7f7b74",
    baseBottom: "#5c5953",
    stroke: "#46433e",
    accent: "#9f9b93",
    accentDark: "#3e3c38",
    highlight: "#ece9e2",
    swatch: "#7b7872",
    label: "Montaña",
  },
  rio: {
    baseTop: "#6d915c",
    baseBottom: "#557748",
    stroke: "#425d39",
    accent: "#367fa3",
    accentDark: "#245b78",
    highlight: "#89cbe3",
    swatch: "#3b86ab",
    label: "Río",
  },
  costa: {
    baseTop: "#336d8d",
    baseBottom: "#214e6b",
    stroke: "#1a3e55",
    accent: "#ccb483",
    accentDark: "#16384d",
    highlight: "#88c6e0",
    swatch: "#2f6a8a",
    label: "Costa",
  },
};

export const FOG_PALETTE = {
  baseTop: "#1f1c17",
  baseBottom: "#171410",
  stroke: "#29231b",
  stipple: "rgba(214, 193, 152, 0.08)",
  explorableTint: "rgba(212, 175, 55, 0.14)",
  explorableStroke: "rgba(212, 175, 55, 0.45)",
} as const;

/** Selecciona el nivel de detalle (LOD) según el radio en píxeles CSS del hexágono. */
export function selectLodLevel(pixelRadius: number): MapLodLevel {
  if (pixelRadius < 12) return 0;
  if (pixelRadius < 24) return 1;
  return 2;
}

/** Cuantiza el tamaño de stamp para evitar regeneraciones continuas durante zoom suave. */
export function getStampRadiusForLod(lod: MapLodLevel): number {
  if (lod === 0) return 14;
  if (lod === 1) return 26;
  return 44;
}

export function traceHexPath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number
): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const vx = cx + HEX_UNIT_VERTICES[i].x * radius;
    const vy = cy + HEX_UNIT_VERTICES[i].y * radius;
    if (i === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
}

/** Dibuja la ilustración cartográfica 2D medieval de un hexágono sobre cualquier contexto 2D. */
export function drawIllustratedTerrainHex(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  terrain: TerrainType,
  variant: number,
  lod: MapLodLevel
): void {
  const palette = MEDIEVAL_TERRAIN_PALETTE[terrain];

  ctx.save();
  traceHexPath(ctx, cx, cy, radius + 0.45);
  ctx.clip();

  // 1. Si hay un atlas/sprite registrado (Punto 7), dibujarlo con ajuste al hexágono
  const provider = terrainAssetRegistry.getProvider();
  const sprite = provider?.getTerrainSprite(terrain, variant, lod) ?? null;
  if (sprite) {
    const w = radius * SQRT3 + 1;
    const h = radius * 2 + 1;
    if (
      sprite.sx !== undefined &&
      sprite.sy !== undefined &&
      sprite.sw !== undefined &&
      sprite.sh !== undefined
    ) {
      ctx.drawImage(sprite.image, sprite.sx, sprite.sy, sprite.sw, sprite.sh, cx - w * 0.5, cy - h * 0.5, w, h);
    } else {
      ctx.drawImage(sprite.image, cx - w * 0.5, cy - h * 0.5, w, h);
    }
    ctx.restore();
    return;
  }

  // 2. Gradiente base orgánico
  const grad = ctx.createLinearGradient(cx, cy - radius, cx, cy + radius);
  grad.addColorStop(0, palette.baseTop);
  grad.addColorStop(1, palette.baseBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  // Sutil variación tonal determinista por variante para romper el aspecto de cuadrícula repetitiva
  if (variant === 1 || variant === 3) {
    ctx.fillStyle = variant === 1 ? "rgba(255, 245, 215, 0.05)" : "rgba(18, 14, 10, 0.07)";
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  // 3. Motivos cartográficos medievales según terreno y LOD
  if (lod >= 1) {
    switch (terrain) {
      case "llanura":
        drawPlainsIllustration(ctx, cx, cy, radius, variant, lod, palette);
        break;
      case "bosque":
        drawForestIllustration(ctx, cx, cy, radius, variant, lod, palette);
        break;
      case "colina":
        drawHillsIllustration(ctx, cx, cy, radius, variant, lod, palette);
        break;
      case "montana":
        drawMountainIllustration(ctx, cx, cy, radius, variant, lod, palette);
        break;
      case "rio":
        drawRiverIllustration(ctx, cx, cy, radius, variant, lod, palette);
        break;
      case "costa":
        drawCoastIllustration(ctx, cx, cy, radius, variant, lod, palette);
        break;
    }
  } else {
    // LOD 0: pistas rápidas de relieve/agua reconocibles a vista mundial
    if (terrain === "montana") {
      ctx.fillStyle = palette.highlight;
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius * 0.42);
      ctx.lineTo(cx + radius * 0.28, cy + radius * 0.2);
      ctx.lineTo(cx - radius * 0.28, cy + radius * 0.2);
      ctx.closePath();
      ctx.fill();
    } else if (terrain === "rio") {
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = Math.max(1.5, radius * 0.26);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx - radius * 0.45, cy - radius * 0.35);
      ctx.quadraticCurveTo(cx + radius * 0.15, cy, cx + radius * 0.35, cy + radius * 0.45);
      ctx.stroke();
    } else if (terrain === "bosque") {
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.arc(cx - radius * 0.15, cy - radius * 0.05, radius * 0.26, 0, Math.PI * 2);
      ctx.arc(cx + radius * 0.18, cy + radius * 0.12, radius * 0.22, 0, Math.PI * 2);
      ctx.fill();
    } else if (terrain === "colina") {
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.arc(cx, cy + radius * 0.25, radius * 0.42, Math.PI, 0);
      ctx.fill();
    }
  }

  ctx.restore();

  // Contorno sutil integrado (nunca una rejilla estridente)
  traceHexPath(ctx, cx, cy, radius);
  ctx.strokeStyle = lod === 0 ? "rgba(24, 20, 14, 0.22)" : palette.stroke;
  ctx.lineWidth = lod === 2 ? 0.9 : 0.6;
  ctx.stroke();
}

function drawPlainsIllustration(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  variant: number,
  lod: MapLodLevel,
  p: (typeof MEDIEVAL_TERRAIN_PALETTE)["llanura"]
): void {
  // Praderas suaves + matojos de trigo/hierba
  ctx.fillStyle = p.accent;
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.ellipse(
    cx + (variant - 1.5) * r * 0.12,
    cy - r * 0.12,
    r * 0.46,
    r * 0.22,
    variant * 0.3,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.globalAlpha = 1;

  const tufts = lod === 2 ? 4 : 2;
  ctx.strokeStyle = p.accentDark;
  ctx.lineWidth = Math.max(0.8, r * 0.05);
  ctx.lineCap = "round";
  for (let i = 0; i < tufts; i++) {
    const angle = (variant * 1.3 + i * 1.7) % (Math.PI * 2);
    const dist = r * (0.2 + (i % 2) * 0.22);
    const tx = cx + Math.cos(angle) * dist;
    const ty = cy + Math.sin(angle) * dist * 0.7;
    const h = r * 0.13;
    ctx.beginPath();
    ctx.moveTo(tx - h * 0.5, ty);
    ctx.lineTo(tx - h * 0.8, ty - h);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx, ty - h * 1.2);
    ctx.moveTo(tx + h * 0.5, ty);
    ctx.lineTo(tx + h * 0.8, ty - h);
    ctx.stroke();
  }
}

function drawForestIllustration(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  variant: number,
  lod: MapLodLevel,
  p: (typeof MEDIEVAL_TERRAIN_PALETTE)["bosque"]
): void {
  // Arboleda escalonada de pinos y robles medievales
  const positions =
    lod === 2
      ? [
          { dx: -0.32, dy: -0.22, s: 0.26 },
          { dx: 0.24, dy: -0.25, s: 0.24 },
          { dx: -0.05, dy: -0.04, s: 0.31 },
          { dx: -0.34, dy: 0.22, s: 0.25 },
          { dx: 0.28, dy: 0.18, s: 0.27 },
        ]
      : [
          { dx: -0.24, dy: -0.14, s: 0.28 },
          { dx: 0.22, dy: -0.08, s: 0.26 },
          { dx: -0.02, dy: 0.18, s: 0.3 },
        ];

  const flip = variant % 2 === 0 ? 1 : -1;
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const tx = cx + pos.dx * r * flip;
    const ty = cy + pos.dy * r;
    const ts = pos.s * r;

    // Sombra bajo la copa
    ctx.fillStyle = p.accentDark;
    ctx.beginPath();
    ctx.ellipse(tx, ty + ts * 0.6, ts * 0.65, ts * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    // Copa cónica (pino) o redondeada (roble) alternada
    if ((i + variant) % 2 === 0) {
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.moveTo(tx, ty - ts * 0.95);
      ctx.lineTo(tx + ts * 0.62, ty + ts * 0.5);
      ctx.lineTo(tx - ts * 0.62, ty + ts * 0.5);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = p.highlight;
      ctx.beginPath();
      ctx.moveTo(tx, ty - ts * 0.95);
      ctx.lineTo(tx + ts * 0.08, ty + ts * 0.45);
      ctx.lineTo(tx - ts * 0.56, ty + ts * 0.45);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(tx, ty - ts * 0.1, ts * 0.58, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.highlight;
      ctx.beginPath();
      ctx.arc(tx - ts * 0.18, ty - ts * 0.26, ts * 0.34, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawHillsIllustration(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  variant: number,
  lod: MapLodLevel,
  p: (typeof MEDIEVAL_TERRAIN_PALETTE)["colina"]
): void {
  const shift = (variant - 1.5) * r * 0.07;
  const mounds =
    lod === 2
      ? [
          { dx: -0.24, dy: 0.05, rx: 0.42, ry: 0.28 },
          { dx: 0.26, dy: 0.12, rx: 0.38, ry: 0.24 },
          { dx: 0.02, dy: 0.36, rx: 0.48, ry: 0.28 },
        ]
      : [
          { dx: -0.18, dy: 0.12, rx: 0.44, ry: 0.26 },
          { dx: 0.2, dy: 0.28, rx: 0.42, ry: 0.25 },
        ];

  for (const m of mounds) {
    const mx = cx + m.dx * r + shift;
    const my = cy + m.dy * r;
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.ellipse(mx, my, m.rx * r, m.ry * r, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();

    // Sombra en ladera derecha
    ctx.fillStyle = p.accentDark;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(mx + m.rx * r * 0.25, my, m.rx * r * 0.55, m.ry * r * 0.85, 0, Math.PI * 1.45, 0);
    ctx.lineTo(mx, my);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Cresta iluminada
    ctx.strokeStyle = p.highlight;
    ctx.lineWidth = Math.max(0.9, r * 0.045);
    ctx.beginPath();
    ctx.ellipse(mx, my, m.rx * r * 0.92, m.ry * r * 0.92, 0, Math.PI * 1.08, Math.PI * 1.65);
    ctx.stroke();
  }
}

function drawMountainIllustration(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  variant: number,
  lod: MapLodLevel,
  p: (typeof MEDIEVAL_TERRAIN_PALETTE)["montana"]
): void {
  const flip = variant % 2 === 0 ? 1 : -1;
  const peaks =
    lod === 2
      ? [
          { dx: -0.32 * flip, dy: 0.24, w: 0.44, h: 0.54 },
          { dx: 0.3 * flip, dy: 0.28, w: 0.42, h: 0.5 },
          { dx: 0.0, dy: 0.34, w: 0.56, h: 0.82 },
        ]
      : [
          { dx: -0.24 * flip, dy: 0.24, w: 0.44, h: 0.55 },
          { dx: 0.14 * flip, dy: 0.3, w: 0.54, h: 0.78 },
        ];

  for (const pk of peaks) {
    const px = cx + pk.dx * r;
    const baseY = cy + pk.dy * r;
    const topY = baseY - pk.h * r;
    const hw = pk.w * r;

    // Cara iluminada izquierda
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.moveTo(px, topY);
    ctx.lineTo(px - hw, baseY);
    ctx.lineTo(px + hw * 0.08, baseY);
    ctx.closePath();
    ctx.fill();

    // Cara sombreada derecha
    ctx.fillStyle = p.accentDark;
    ctx.beginPath();
    ctx.moveTo(px, topY);
    ctx.lineTo(px + hw * 0.08, baseY);
    ctx.lineTo(px + hw, baseY);
    ctx.closePath();
    ctx.fill();

    // Casquete de nieve alpina
    const snowH = pk.h * r * 0.36;
    const snowW = hw * 0.36;
    ctx.fillStyle = p.highlight;
    ctx.beginPath();
    ctx.moveTo(px, topY);
    ctx.lineTo(px - snowW, topY + snowH);
    ctx.lineTo(px - snowW * 0.25, topY + snowH * 0.82);
    ctx.lineTo(px + snowW * 0.1, topY + snowH * 1.05);
    ctx.lineTo(px + snowW, topY + snowH);
    ctx.closePath();
    ctx.fill();
  }
}

function drawRiverIllustration(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  variant: number,
  lod: MapLodLevel,
  p: (typeof MEDIEVAL_TERRAIN_PALETTE)["rio"]
): void {
  const flip = variant % 2 === 0 ? 1 : -1;
  const x0 = cx - r * 0.65 * flip;
  const y0 = cy - r * 0.55;
  const c1x = cx + r * 0.35 * flip;
  const c1y = cy - r * 0.15;
  const c2x = cx - r * 0.35 * flip;
  const c2y = cy + r * 0.2;
  const x1 = cx + r * 0.55 * flip;
  const y1 = cy + r * 0.65;

  // Orilla fangosa / ribera
  ctx.strokeStyle = "#b5a06e";
  ctx.lineWidth = r * 0.42;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1);
  ctx.stroke();

  // Cauce principal
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = r * 0.3;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1);
  ctx.stroke();

  // Reflejo de corriente
  ctx.strokeStyle = p.highlight;
  ctx.lineWidth = Math.max(1, r * 0.075);
  ctx.setLineDash(lod === 2 ? [r * 0.16, r * 0.14] : []);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCoastIllustration(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  variant: number,
  lod: MapLodLevel,
  p: (typeof MEDIEVAL_TERRAIN_PALETTE)["costa"]
): void {
  // Franja de playa arenosa en un flanco del hexágono
  const shoreSide = variant % 2 === 0 ? -1 : 1;
  ctx.fillStyle = p.accent;
  ctx.beginPath();
  ctx.ellipse(cx + shoreSide * r * 0.62, cy - r * 0.2, r * 0.55, r * 0.82, shoreSide * 0.35, 0, Math.PI * 2);
  ctx.fill();

  // Espuma de orilla
  ctx.strokeStyle = "rgba(235, 248, 255, 0.55)";
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath();
  ctx.ellipse(cx + shoreSide * r * 0.62, cy - r * 0.2, r * 0.6, r * 0.87, shoreSide * 0.35, 0, Math.PI * 2);
  ctx.stroke();

  // Ondas cartográficas en el agua
  const waves = lod === 2 ? 3 : 2;
  ctx.strokeStyle = p.highlight;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = Math.max(0.9, r * 0.048);
  ctx.lineCap = "round";
  for (let i = 0; i < waves; i++) {
    const wx = cx - shoreSide * r * (0.18 + (i % 2) * 0.16);
    const wy = cy - r * 0.25 + i * r * 0.28;
    const ww = r * 0.22;
    ctx.beginPath();
    ctx.moveTo(wx - ww, wy);
    ctx.quadraticCurveTo(wx - ww * 0.5, wy - r * 0.08, wx, wy);
    ctx.quadraticCurveTo(wx + ww * 0.5, wy + r * 0.08, wx + ww, wy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Dibuja un hexágono bajo niebla de guerra con textura de pergamino oscuro / cartografía inexplorada. */
export function drawFogHex(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  variant: number,
  lod: MapLodLevel
): void {
  ctx.save();
  traceHexPath(ctx, cx, cy, radius + 0.35);
  const grad = ctx.createLinearGradient(cx, cy - radius, cx, cy + radius);
  grad.addColorStop(0, FOG_PALETTE.baseTop);
  grad.addColorStop(1, FOG_PALETTE.baseBottom);
  ctx.fillStyle = grad;
  ctx.fill();

  if (lod >= 1) {
    ctx.clip();
    // Punteado sutil de cartografía sin descubrir
    ctx.fillStyle = FOG_PALETTE.stipple;
    const dx = (variant - 1.5) * radius * 0.14;
    ctx.beginPath();
    ctx.arc(cx - radius * 0.22 + dx, cy - radius * 0.15, radius * 0.1, 0, Math.PI * 2);
    ctx.arc(cx + radius * 0.2 + dx * 0.5, cy + radius * 0.18, radius * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  traceHexPath(ctx, cx, cy, radius);
  ctx.strokeStyle = FOG_PALETTE.stroke;
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

/**
 * Dibuja una fortaleza/castillo medieval ilustrado para las capitales de reino.
 * Claramente distinguible a cualquier nivel de zoom.
 */
export function drawMedievalCapitalFortress(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pixelRadius: number,
  ownerColor: string,
  isOwnCapital: boolean
): void {
  // 1. Halo dorado / de estandarte para localizar la capital de inmediato
  const haloR = Math.max(8, pixelRadius * (isOwnCapital ? 0.92 : 0.72));
  const halo = ctx.createRadialGradient(cx, cy, haloR * 0.15, cx, cy, haloR);
  halo.addColorStop(0, isOwnCapital ? "rgba(251, 191, 36, 0.55)" : "rgba(255, 245, 220, 0.32)");
  halo.addColorStop(1, "rgba(251, 191, 36, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();

  // Si hay sprite de capital registrado (Punto 7), usarlo
  const lod = selectLodLevel(pixelRadius);
  const sprite = terrainAssetRegistry.getProvider()?.getCapitalSprite?.(isOwnCapital, lod) ?? null;
  if (sprite) {
    const size = Math.max(14, pixelRadius * 1.15);
    ctx.drawImage(sprite.image, cx - size * 0.5, cy - size * 0.55, size, size);
    return;
  }

  // En zoom muy lejano (LOD 0), dibujar un blasón/estrella de fortaleza nítido
  if (pixelRadius < 10) {
    const r = Math.max(4.5, pixelRadius * 0.52);
    ctx.fillStyle = "#16110a";
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isOwnCapital ? "#fbbf24" : ownerColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff8dc";
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const s = Math.max(9, Math.min(30, pixelRadius * 0.58));
  const baseY = cy + s * 0.48;

  ctx.save();
  // Sombra proyectada de la fortaleza
  ctx.fillStyle = "rgba(12, 9, 6, 0.55)";
  ctx.beginPath();
  ctx.ellipse(cx, baseY + s * 0.08, s * 0.82, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Muralla central de piedra
  ctx.fillStyle = "#d9d2c5";
  ctx.strokeStyle = "#1d1710";
  ctx.lineWidth = Math.max(1, s * 0.08);
  ctx.fillRect(cx - s * 0.62, baseY - s * 0.72, s * 1.24, s * 0.72);
  ctx.strokeRect(cx - s * 0.62, baseY - s * 0.72, s * 1.24, s * 0.72);

  // Torreón central elevado
  ctx.fillStyle = "#ece5d8";
  ctx.fillRect(cx - s * 0.28, baseY - s * 1.12, s * 0.56, s * 1.12);
  ctx.strokeRect(cx - s * 0.28, baseY - s * 1.12, s * 0.56, s * 1.12);

  // Torres laterales izquierda y derecha
  ctx.fillStyle = "#cfc7b8";
  ctx.fillRect(cx - s * 0.72, baseY - s * 0.92, s * 0.3, s * 0.92);
  ctx.strokeRect(cx - s * 0.72, baseY - s * 0.92, s * 0.3, s * 0.92);
  ctx.fillRect(cx + s * 0.42, baseY - s * 0.92, s * 0.3, s * 0.92);
  ctx.strokeRect(cx + s * 0.42, baseY - s * 0.92, s * 0.3, s * 0.92);

  // Almenas del torreón central
  const merlonW = s * 0.14;
  const merlonH = s * 0.14;
  ctx.fillStyle = "#f4efe4";
  ctx.fillRect(cx - s * 0.28, baseY - s * 1.12 - merlonH, merlonW, merlonH);
  ctx.fillRect(cx - merlonW * 0.5, baseY - s * 1.12 - merlonH, merlonW, merlonH);
  ctx.fillRect(cx + s * 0.28 - merlonW, baseY - s * 1.12 - merlonH, merlonW, merlonH);

  // Techos cónicos / estandartes laterales en color del reino
  ctx.fillStyle = ownerColor;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.57, baseY - s * 1.2);
  ctx.lineTo(cx - s * 0.75, baseY - s * 0.9);
  ctx.lineTo(cx - s * 0.39, baseY - s * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx + s * 0.57, baseY - s * 1.2);
  ctx.lineTo(cx + s * 0.39, baseY - s * 0.9);
  ctx.lineTo(cx + s * 0.75, baseY - s * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Portón arqueado
  ctx.fillStyle = "#2b1d12";
  ctx.beginPath();
  ctx.arc(cx, baseY - s * 0.26, s * 0.16, Math.PI, 0);
  ctx.lineTo(cx + s * 0.16, baseY);
  ctx.lineTo(cx - s * 0.16, baseY);
  ctx.closePath();
  ctx.fill();

  // Estandarte ondeante en la cima del torreón
  const mastTop = baseY - s * 1.56;
  ctx.strokeStyle = isOwnCapital ? "#fbbf24" : "#e5dccb";
  ctx.lineWidth = Math.max(1.2, s * 0.08);
  ctx.beginPath();
  ctx.moveTo(cx, baseY - s * 1.12);
  ctx.lineTo(cx, mastTop);
  ctx.stroke();

  ctx.fillStyle = isOwnCapital ? "#fbbf24" : ownerColor;
  ctx.beginPath();
  ctx.moveTo(cx, mastTop);
  ctx.lineTo(cx + s * 0.44, mastTop + s * 0.13);
  ctx.lineTo(cx, mastTop + s * 0.26);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/** Dibuja un pequeño blasón heráldico en provincias (territorios propios no capitales). */
export function drawProvinceBanner(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pixelRadius: number,
  ownerColor: string
): void {
  if (pixelRadius < 15) return;
  const s = Math.max(4, Math.min(9, pixelRadius * 0.22));
  ctx.save();
  ctx.fillStyle = "#16110a";
  ctx.beginPath();
  ctx.moveTo(cx - s, cy - s * 0.9);
  ctx.lineTo(cx + s, cy - s * 0.9);
  ctx.lineTo(cx + s, cy + s * 0.2);
  ctx.lineTo(cx, cy + s * 1.15);
  ctx.lineTo(cx - s, cy + s * 0.2);
  ctx.closePath();
  ctx.fill();

  const inner = s * 0.74;
  ctx.fillStyle = ownerColor;
  ctx.beginPath();
  ctx.moveTo(cx - inner, cy - inner * 0.85);
  ctx.lineTo(cx + inner, cy - inner * 0.85);
  ctx.lineTo(cx + inner, cy + inner * 0.15);
  ctx.lineTo(cx, cy + inner * 1.05);
  ctx.lineTo(cx - inner, cy + inner * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export interface StampEntry {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly bytes: number;
}

/**
 * Caché offscreen estrictamente acotada (LRU + límite de entradas y bytes) para stamps de terreno
 * y niebla por (tipo, variante, LOD). Garantiza memoria constante y blitting O(1).
 */
export class TerrainStampCache {
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly entries = new Map<string, StampEntry>();
  private currentBytes = 0;

  constructor(maxEntries: number = 128, maxBytes: number = 12 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  get bytesUsed(): number {
    return this.currentBytes;
  }

  clear(): void {
    this.entries.clear();
    this.currentBytes = 0;
  }

  getTerrainStamp(terrainCode: number, variant: number, lod: MapLodLevel): StampEntry | null {
    const key = `t:${terrainCode}:${variant}:${lod}`;
    const cached = this.entries.get(key);
    if (cached) {
      // Refresh LRU position
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }

    const radius = getStampRadiusForLod(lod);
    const pad = 2;
    const width = Math.ceil(radius * SQRT3 + pad * 2);
    const height = Math.ceil(radius * 2 + pad * 2);
    const surface = createOffscreenSurface(width, height);
    if (!surface) return null;

    const terrain = CODE_TO_TERRAIN[terrainCode] ?? "llanura";
    drawIllustratedTerrainHex(surface.ctx, width * 0.5, height * 0.5, radius, terrain, variant, lod);

    const entry: StampEntry = {
      canvas: surface.canvas,
      width,
      height,
      radius,
      bytes: width * height * 4,
    };
    this.insert(key, entry);
    return entry;
  }

  getFogStamp(variant: number, lod: MapLodLevel): StampEntry | null {
    const v = variant & 1;
    const key = `f:${v}:${lod}`;
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }

    const radius = getStampRadiusForLod(lod);
    const pad = 2;
    const width = Math.ceil(radius * SQRT3 + pad * 2);
    const height = Math.ceil(radius * 2 + pad * 2);
    const surface = createOffscreenSurface(width, height);
    if (!surface) return null;

    drawFogHex(surface.ctx, width * 0.5, height * 0.5, radius, v, lod);

    const entry: StampEntry = {
      canvas: surface.canvas,
      width,
      height,
      radius,
      bytes: width * height * 4,
    };
    this.insert(key, entry);
    return entry;
  }

  private insert(key: string, entry: StampEntry): void {
    while (
      this.entries.size >= this.maxEntries ||
      (this.entries.size > 0 && this.currentBytes + entry.bytes > this.maxBytes)
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest) this.currentBytes -= oldest.bytes;
    }
    this.entries.set(key, entry);
    this.currentBytes += entry.bytes;
  }
}

function createOffscreenSurface(
  width: number,
  height: number
): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (ctx) return { canvas, ctx };
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) return { canvas, ctx };
  }
  return null;
}
