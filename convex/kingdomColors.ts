/**
 * LA CONQUISTA — SISTEMA DE COLORES ÚNICOS PARA REINOS (Bloque 6)
 * Generador y asignador autoritativo de colores únicos y persistentes por reino.
 */
import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

// Paleta de 64 colores altamente contrastados, vivos y legibles sobre terreno medieval
export const KINGDOM_COLOR_PALETTE: readonly string[] = [
  "#e11d48", // Rosa Carmesí
  "#2563eb", // Azul Real
  "#059669", // Verde Esmeralda
  "#d97706", // Ámbar Dorado
  "#7c3aed", // Púrpura Imperial
  "#06b6d4", // Turquesa Neón
  "#ca8a04", // Oro Viejo
  "#ea580c", // Naranja Fuego
  "#db2777", // Magenta Vivo
  "#16a34a", // Verde Bosque Claro
  "#0284c7", // Azul Cielo Intenso
  "#9333ea", // Violeta Obscuro
  "#c026d3", // Orquídea
  "#4f46e5", // Índigo Profundo
  "#0d9488", // Verde Azulado Teal
  "#dc2626", // Rojo Escarlata
  "#b91c1c", // Granate
  "#15803d", // Verde Oscuro
  "#1d4ed8", // Azul Cobalto
  "#6b21a8", // Púrpura Obscuro
  "#a21caf", // Fucsia Imperial
  "#b45309", // Bronce
  "#047857", // Jade
  "#0369a1", // Azul Zafiro
  "#c2410c", // Terracota Fuego
  "#be123c", // Rubí
  "#4338ca", // Ultramar
  "#6d28d9", // Amatista
  "#0e7490", // Cían Oscuro
  "#166534", // Malaquita
  "#a16207", // Dorado Latón
  "#9a3412", // Óxido Intenso
  "#9f1239", // Vino Carmín
  "#3730a3", // Noche Azurada
  "#581c87", // Obispo
  "#701a75", // Ciruela
  "#155e75", // Turquesa Abisal
  "#14532d", // Pino
  "#854d0e", // Mostaza Dorada
  "#7c2d12", // Caoba
  "#881337", // Sangre de Buey
  "#312e81", // Marino Profundo
  "#4c1d95", // Mora
  "#164e63", // Azul Petróleo
  "#14532d", // Musgo Oscuro
  "#713f12", // Avellana
  "#7f1d1d", // Burdeos
  "#2e1065", // Púrpura Abisal
  "#3b0764", // Berenjena
  "#84cc16", // Lima Llameante
  "#10b981", // Menta Intensa
  "#38bdf8", // Cían Radiante
  "#f43f5e", // Coral Fuego
  "#a855f7", // Lila Neón
  "#f97316", // Mandarina
  "#eab308", // Amarillo Solar
  "#ec4899", // Rosa Neón
  "#6366f1", // Azul Lavanda
  "#14b8a6", // Turquesa Menta
  "#facc15", // Oro Brillante
  "#fb923c", // Naranja Claro
  "#4ade80", // Verde Esmeralda Claro
];

export function normalizeHexColor(hex: string): string {
  return hex.trim().toLowerCase();
}

export function pickRandomUniqueColor(usedColors: Set<string>): string {
  const normalizedUsed = new Set(Array.from(usedColors).map(normalizeHexColor));
  const availableFromPalette = KINGDOM_COLOR_PALETTE.filter(
    (c) => !normalizedUsed.has(normalizeHexColor(c))
  );

  if (availableFromPalette.length > 0) {
    const randomIndex = Math.floor(Math.random() * availableFromPalette.length);
    return availableFromPalette[randomIndex];
  }

  // Generación procedimental en espacio HSL para garantizar unicidad infinita
  let attempt = 0;
  while (attempt < 200) {
    const hue = Math.floor(Math.random() * 360);
    const saturation = 75 + Math.floor(Math.random() * 20);
    const lightness = 45 + Math.floor(Math.random() * 20);
    const hex = hslToHex(hue, saturation, lightness);
    if (!normalizedUsed.has(normalizeHexColor(hex))) {
      return hex;
    }
    attempt++;
  }

  const fallbackHue = (normalizedUsed.size * 137.508) % 360;
  return hslToHex(fallbackHue, 80, 50);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

export async function ensureAllKingdomsHaveColors(ctx: MutationCtx): Promise<number> {
  const kingdoms = await ctx.db.query("kingdoms").collect();
  const usedColors = new Set<string>();
  const DEFAULT_YELLOW = "#d4af37";

  for (const k of kingdoms) {
    if (k.color && typeof k.color === "string" && k.color.trim() && k.color.trim().toLowerCase() !== DEFAULT_YELLOW) {
      usedColors.add(normalizeHexColor(k.color));
    }
  }

  let assignedCount = 0;
  for (const k of kingdoms) {
    if (!k.color || typeof k.color !== "string" || !k.color.trim() || k.color.trim().toLowerCase() === DEFAULT_YELLOW) {
      const newColor = pickRandomUniqueColor(usedColors);
      usedColors.add(normalizeHexColor(newColor));
      await ctx.db.patch(k._id, { color: newColor, updatedAt: Date.now() });
      assignedCount++;
    }
  }

  return assignedCount;
}

/**
 * Mutación autoritativa para asignar colores únicos a todos los reinos existentes en la base de datos.
 */
export const ensureKingdomColors = mutation({
  args: {},
  handler: async (ctx) => {
    const assignedCount = await ensureAllKingdomsHaveColors(ctx);
    const kingdoms = await ctx.db.query("kingdoms").collect();
    return {
      success: true,
      assignedCount,
      totalKingdoms: kingdoms.length,
      kingdoms: kingdoms.map((k) => ({
        id: k._id,
        name: k.name,
        color: k.color,
      })),
    };
  },
});

/**
 * Consulta de la leyenda cartográfica y mapa de colores de reinos.
 */
export const getKingdomColors = query({
  args: {},
  handler: async (ctx) => {
    const kingdoms = await ctx.db.query("kingdoms").collect();
    const territories = await ctx.db.query("territories").collect();

    const result: Record<string, { id: string; name: string; monarchName?: string; color: string; territoryCount: number }> = {};

    for (const k of kingdoms) {
      const ownedCount = territories.filter((t) => t.ownerKingdomId && String(t.ownerKingdomId) === String(k._id)).length;
      result[String(k._id)] = {
        id: String(k._id),
        name: k.name,
        monarchName: k.monarchName,
        color: k.color ?? "#d4af37",
        territoryCount: ownedCount,
      };
    }

    return result;
  },
});
