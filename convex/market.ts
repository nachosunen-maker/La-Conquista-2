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

export * from "./marketRules.js";
import {
  RESOURCE_COMMERCIAL_VALUES,
  MARKET_RESOURCE_NAMES,
  MARKET_RESOURCE_EMOJIS,
  UNLOCK_MERCADO_MIN_LEVEL,
  VALID_MARKET_RESOURCES,
  gcd,
  getExchangeBatchInfo,
  getMarketFee,
  calculateExchange,
  type MarketResourceType,
} from "./marketRules.js";

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

    const feeInfo = isUnlocked ? getMarketFee(mercadoLevel) : null;

    return {
      mercadoLevel,
      isUnlocked,
      requiredLevel: UNLOCK_MERCADO_MIN_LEVEL,
      recentTrades,
      feeInfo,
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

    // 4. Validación matemática y cálculo de conversión con comisión progresiva según nivel
    const exchange = calculateExchange(fromRes, toRes, args.fromAmount, mercadoLevel);
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
      grossAmount: exchange.grossAmount,
      toAmount: exchange.toAmount,
      feeAmount: exchange.feeAmount,
      feePercent: exchange.feePercent,
      remainingFrom: currentResources[fromRes],
      newTo: currentResources[toRes],
      storageCapacity: storageCap,
      message: `Intercambio realizado con éxito: entregados ${args.fromAmount} de ${MARKET_RESOURCE_NAMES[fromRes]}, recibidos ${exchange.toAmount} de ${MARKET_RESOURCE_NAMES[toRes]} (bruto: ${exchange.grossAmount}, comisión nivel ${mercadoLevel}: ${exchange.feeAmount}).`,
    };
  },
});
