import { query, mutation } from "./_generated/server.js";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { isKingdomOwner } from "./kingdomAccess.js";
import { settleRelationalKingdomEconomy } from "./economy.js";
import { storageCapacity } from "./economyExtended.js";

/**
 * ============================================================================
 * LA CONQUISTA — SISTEMA DE INTERCAMBIO DE RECURSOS EN EL MERCADO
 * ============================================================================
 * Valores comerciales unitarios basados en la dificultad de producción:
 * - Oro: 30 puntos
 * - Hierro: 15 puntos
 * - Piedra: 8 puntos
 * - Madera: 6 puntos
 * - Alimentos: 3 puntos
 *
 * Desbloqueo: Requiere Mercado nivel 4 o superior (buildings.mercado >= 4).
 * Integridad: Conservación exacta del valor económico, sin redondeos especulativos,
 * operaciones atómicas, protección contra doble pulsación e idempotencia.
 */

export const RESOURCE_COMMERCIAL_VALUES = {
  gold: 30,
  iron: 15,
  stone: 8,
  wood: 6,
  food: 3,
} as const;

export type MarketResourceType = keyof typeof RESOURCE_COMMERCIAL_VALUES;

export const MARKET_RESOURCE_NAMES: Record<MarketResourceType, string> = {
  gold: "Oro",
  iron: "Hierro",
  stone: "Piedra",
  wood: "Madera",
  food: "Alimentos",
};

export const MARKET_RESOURCE_EMOJIS: Record<MarketResourceType, string> = {
  gold: "🪙",
  iron: "⚔️",
  stone: "🪨",
  wood: "🪵",
  food: "🌾",
};

export const UNLOCK_MERCADO_MIN_LEVEL = 4;

export const VALID_MARKET_RESOURCES: MarketResourceType[] = [
  "gold",
  "wood",
  "stone",
  "iron",
  "food",
];

/** Máximo común divisor para cálculo de lotes mínimos enteros. */
export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * Devuelve la información de lote mínimo y equivalencia para un par de recursos.
 * minFromBatch: Cantidad mínima entera del recurso origen para conversión exacta.
 * minToBatch: Cantidad recibida exacta por cada lote mínimo.
 */
export function getExchangeBatchInfo(from: MarketResourceType, to: MarketResourceType) {
  const vFrom = RESOURCE_COMMERCIAL_VALUES[from];
  const vTo = RESOURCE_COMMERCIAL_VALUES[to];
  const common = gcd(vFrom, vTo);
  const minFromBatch = vTo / common;
  const minToBatch = vFrom / common;
  const rateRatio = vFrom / vTo; // Equivalencia unitaria (ej. 1 oro = 5 madera)

  return {
    vFrom,
    vTo,
    minFromBatch,
    minToBatch,
    rateRatio,
  };
}

/**
 * Calcula la conversión conservando estrictamente el valor económico en puntos.
 */
export function calculateExchange(
  from: MarketResourceType,
  to: MarketResourceType,
  fromAmount: number
): {
  valid: boolean;
  toAmount: number;
  valueDelivered: number;
  valueReceived: number;
  minFromBatch: number;
  error?: string;
} {
  if (from === to) {
    return {
      valid: false,
      toAmount: 0,
      valueDelivered: 0,
      valueReceived: 0,
      minFromBatch: 1,
      error: "Los recursos de origen y destino deben ser diferentes.",
    };
  }

  if (!Number.isInteger(fromAmount) || fromAmount <= 0) {
    return {
      valid: false,
      toAmount: 0,
      valueDelivered: 0,
      valueReceived: 0,
      minFromBatch: 1,
      error: "La cantidad entregada debe ser un número entero positivo.",
    };
  }

  const info = getExchangeBatchInfo(from, to);

  if (fromAmount % info.minFromBatch !== 0) {
    return {
      valid: false,
      toAmount: 0,
      valueDelivered: fromAmount * info.vFrom,
      valueReceived: 0,
      minFromBatch: info.minFromBatch,
      error: `La cantidad de ${MARKET_RESOURCE_NAMES[from]} debe ser múltiplo de ${info.minFromBatch} para garantizar una conversión entera y sin pérdida de valor económico.`,
    };
  }

  const batches = fromAmount / info.minFromBatch;
  const toAmount = batches * info.minToBatch;
  const valueDelivered = fromAmount * info.vFrom;
  const valueReceived = toAmount * info.vTo;

  return {
    valid: true,
    toAmount,
    valueDelivered,
    valueReceived,
    minFromBatch: info.minFromBatch,
  };
}

async function requireAuthenticatedUser(ctx: any): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      throw new ConvexError("Autenticación requerida: No se detectó una sesión autenticada en el servidor.");
    }
    return identity.subject;
  }
  return userId;
}

/**
 * Consulta de estado del Mercado: nivel, desbloqueo, límites y últimos intercambios.
 */
export const getMarketInfo = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) return null;

    const mercadoBuilding = await ctx.db
      .query("buildings")
      .filter((q: any) =>
        q.and(
          q.eq(q.field("kingdomId"), args.kingdomId),
          q.eq(q.field("buildingType"), "mercado")
        )
      )
      .first();

    const mercadoLevel = mercadoBuilding?.level ?? 0;
    const isUnlocked = mercadoLevel >= UNLOCK_MERCADO_MIN_LEVEL;

    const recentTrades = await ctx.db
      .query("marketTrades")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
      .order("desc")
      .take(15);

    return {
      mercadoLevel,
      isUnlocked,
      requiredLevel: UNLOCK_MERCADO_MIN_LEVEL,
      recentTrades,
    };
  },
});

/**
 * Mutación atómica e idempotente para ejecutar el intercambio de recursos.
 */
export const executeResourceExchange = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    idempotencyKey: v.string(),
    fromResource: v.string(),
    toResource: v.string(),
    fromAmount: v.number(),
  },
  handler: async (ctx, args) => {
    const callerUserId = await requireAuthenticatedUser(ctx);
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) {
      throw new ConvexError("Reino no encontrado.");
    }

    if (!isKingdomOwner(kingdom.userId, callerUserId)) {
      throw new ConvexError("No autorizado: el reino no pertenece al usuario autenticado.");
    }

    const cleanKey = args.idempotencyKey.trim();
    if (!cleanKey) {
      throw new ConvexError("Se requiere una clave de idempotencia ('idempotencyKey') no vacía.");
    }

    // 1. Protección contra duplicados e idempotencia
    const existingTrade = await ctx.db
      .query("marketTrades")
      .withIndex("by_kingdom_and_key", (q) =>
        q.eq("kingdomId", args.kingdomId).eq("idempotencyKey", cleanKey)
      )
      .first();

    if (existingTrade) {
      if (
        existingTrade.fromResource === args.fromResource &&
        existingTrade.toResource === args.toResource &&
        existingTrade.fromAmount === args.fromAmount
      ) {
        return {
          success: true,
          idempotentDuplicate: true,
          tradeId: existingTrade._id,
          kingdomId: args.kingdomId,
          fromResource: existingTrade.fromResource,
          fromAmount: existingTrade.fromAmount,
          toResource: existingTrade.toResource,
          toAmount: existingTrade.toAmount,
          message: "Operación de intercambio previa detectada; no se duplicó la transacción.",
        };
      }
      throw new ConvexError("Conflicto de idempotencia: esta clave ya fue utilizada para otra operación.");
    }

    // 2. Validación de nivel de Mercado (requisito obligatorio nivel >= 4)
    const mercadoBuilding = await ctx.db
      .query("buildings")
      .filter((q: any) =>
        q.and(
          q.eq(q.field("kingdomId"), args.kingdomId),
          q.eq(q.field("buildingType"), "mercado")
        )
      )
      .first();

    const mercadoLevel = mercadoBuilding?.level ?? 0;
    if (mercadoLevel < UNLOCK_MERCADO_MIN_LEVEL) {
      throw new ConvexError("Mejora el Mercado al nivel 4 para desbloquear el intercambio de recursos.");
    }

    // 3. Validación de recursos origen y destino
    if (
      !VALID_MARKET_RESOURCES.includes(args.fromResource as MarketResourceType) ||
      !VALID_MARKET_RESOURCES.includes(args.toResource as MarketResourceType)
    ) {
      throw new ConvexError("Recursos no válidos para el intercambio comercial.");
    }

    if (args.fromResource === args.toResource) {
      throw new ConvexError("El recurso de origen y destino deben ser diferentes.");
    }

    const fromRes = args.fromResource as MarketResourceType;
    const toRes = args.toResource as MarketResourceType;

    // 4. Validación matemática y cálculo de conversión exacta
    const exchange = calculateExchange(fromRes, toRes, args.fromAmount);
    if (!exchange.valid) {
      throw new ConvexError(exchange.error ?? "Cálculo de intercambio inválido.");
    }

    // 5. Liquidación económica previa para obtener saldos reales y tope de almacén
    const settled = await settleRelationalKingdomEconomy(ctx, kingdom, callerUserId, Date.now());

    const currentResources: Record<MarketResourceType, number> = {
      gold: settled.resources.gold,
      wood: settled.resources.wood,
      stone: settled.resources.stone,
      iron: settled.resources.iron,
      food: settled.settlement.updatedFood ?? settled.resources.food,
    };

    // 6. Validación de saldo disponible
    const availableFrom = currentResources[fromRes];
    if (availableFrom < args.fromAmount) {
      throw new ConvexError(
        `Saldo insuficiente de ${MARKET_RESOURCE_NAMES[fromRes]}: disponible ${availableFrom.toFixed(2)}, requerido ${args.fromAmount}.`
      );
    }

    // 7. Validación de capacidad de almacenamiento en destino
    const storageCap = (settled as any).extended?.storageCapacity ?? storageCapacity(mercadoLevel);
    const currentTo = currentResources[toRes];
    if (currentTo + exchange.toAmount > storageCap) {
      const availableSpace = Math.max(0, storageCap - currentTo);
      throw new ConvexError(
        `Capacidad de almacenamiento insuficiente: espacio disponible para ${MARKET_RESOURCE_NAMES[toRes]} es ${availableSpace.toFixed(0)}, pero recibirías ${exchange.toAmount}. Amplía el Mercado o consume recursos.`
      );
    }

    // 8. Aplicación atómica de recursos
    currentResources[fromRes] -= args.fromAmount;
    currentResources[toRes] += exchange.toAmount;

    await ctx.db.patch(settled.resources._id, {
      gold: currentResources.gold,
      wood: currentResources.wood,
      stone: currentResources.stone,
      iron: currentResources.iron,
      food: currentResources.food,
      lastUpdated: Date.now(),
    });

    // 9. Registro persistido en el historial de intercambios
    const tradeId = await ctx.db.insert("marketTrades", {
      kingdomId: args.kingdomId,
      idempotencyKey: cleanKey,
      fromResource: fromRes,
      fromAmount: args.fromAmount,
      toResource: toRes,
      toAmount: exchange.toAmount,
      createdAt: Date.now(),
    });

    return {
      success: true,
      idempotentDuplicate: false,
      tradeId,
      kingdomId: args.kingdomId,
      fromResource: fromRes,
      fromAmount: args.fromAmount,
      toResource: toRes,
      toAmount: exchange.toAmount,
      remainingFrom: currentResources[fromRes],
      newTo: currentResources[toRes],
      storageCapacity: storageCap,
      message: `Intercambio realizado con éxito: entregados ${args.fromAmount} de ${MARKET_RESOURCE_NAMES[fromRes]}, recibidos ${exchange.toAmount} de ${MARKET_RESOURCE_NAMES[toRes]}.`,
    };
  },
});
