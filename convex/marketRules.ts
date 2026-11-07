/**
 * ============================================================================
 * LA CONQUISTA — REGLAS Y MATEMÁTICAS PURAS DEL MERCADO (marketRules.ts)
 * ============================================================================
 * Módulo puro sin dependencias de servidor Convex para ser consumido
 * de forma segura tanto por el backend como por el cliente web (React/Vite).
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
 * Comisión del Mercado según el nivel del edificio (desbloqueado desde nivel 4):
 * - comision = 1 / (nivel_mercado + 6)
 * - comision_porcentaje = 100 / (nivel_mercado + 6)
 * - factor_recibido = (nivel_mercado + 5) / (nivel_mercado + 6)
 * - cantidad_recibida = floor(cantidad_bruta_recibida * factor_recibido)
 */
export function getMarketFee(mercadoLevel: number) {
  const level = Math.max(1, Math.floor(mercadoLevel));
  const denominator = level + 6;
  const numerator = level + 5;
  const feeRate = 1 / denominator;
  const feePercent = 100 / denominator;
  const retentionFactor = numerator / denominator;
  const retentionPercent = (numerator * 100) / denominator;

  return {
    level,
    denominator,
    numerator,
    feeRate,
    feePercent,
    retentionFactor,
    retentionPercent,
  };
}

/**
 * Calcula la conversión aplicando la comisión oficial progresiva según el nivel del Mercado.
 * Conserva estrictamente los lotes mínimos y redondea hacia abajo al entero más próximo.
 */
export function calculateExchange(
  from: MarketResourceType,
  to: MarketResourceType,
  fromAmount: number,
  mercadoLevel: number = UNLOCK_MERCADO_MIN_LEVEL
): {
  valid: boolean;
  grossAmount: number;
  toAmount: number;
  feeAmount: number;
  feePercent: number;
  retentionPercent: number;
  valueDelivered: number;
  valueReceivedGross: number;
  valueReceivedNet: number;
  minFromBatch: number;
  error?: string;
} {
  if (from === to) {
    return {
      valid: false,
      grossAmount: 0,
      toAmount: 0,
      feeAmount: 0,
      feePercent: 0,
      retentionPercent: 0,
      valueDelivered: 0,
      valueReceivedGross: 0,
      valueReceivedNet: 0,
      minFromBatch: 1,
      error: "Los recursos de origen y destino deben ser diferentes.",
    };
  }

  if (!Number.isInteger(fromAmount) || fromAmount <= 0) {
    return {
      valid: false,
      grossAmount: 0,
      toAmount: 0,
      feeAmount: 0,
      feePercent: 0,
      retentionPercent: 0,
      valueDelivered: 0,
      valueReceivedGross: 0,
      valueReceivedNet: 0,
      minFromBatch: 1,
      error: "La cantidad entregada debe ser un número entero positivo.",
    };
  }

  const info = getExchangeBatchInfo(from, to);

  if (fromAmount % info.minFromBatch !== 0) {
    return {
      valid: false,
      grossAmount: 0,
      toAmount: 0,
      feeAmount: 0,
      feePercent: 0,
      retentionPercent: 0,
      valueDelivered: fromAmount * info.vFrom,
      valueReceivedGross: 0,
      valueReceivedNet: 0,
      minFromBatch: info.minFromBatch,
      error: `La cantidad de ${MARKET_RESOURCE_NAMES[from]} debe ser múltiplo de ${info.minFromBatch} para garantizar una conversión entera y sin pérdida de valor económico.`,
    };
  }

  const batches = fromAmount / info.minFromBatch;
  const grossAmount = batches * info.minToBatch;
  const feeInfo = getMarketFee(mercadoLevel);

  // Fórmula oficial: cantidad_recibida = floor(cantidad_bruta_recibida * factor_recibido)
  // En aritmética entera: floor((grossAmount * (level + 5)) / (level + 6))
  const toAmount = Math.floor((grossAmount * feeInfo.numerator) / feeInfo.denominator);
  const feeAmount = grossAmount - toAmount;

  if (toAmount <= 0) {
    return {
      valid: false,
      grossAmount,
      toAmount: 0,
      feeAmount: grossAmount,
      feePercent: feeInfo.feePercent,
      retentionPercent: feeInfo.retentionPercent,
      valueDelivered: fromAmount * info.vFrom,
      valueReceivedGross: grossAmount * info.vTo,
      valueReceivedNet: 0,
      minFromBatch: info.minFromBatch,
      error: "La cantidad a recibir tras descontar la comisión del mercado resultaría en 0. Aumenta la cantidad a entregar.",
    };
  }

  const valueDelivered = fromAmount * info.vFrom;
  const valueReceivedGross = grossAmount * info.vTo;
  const valueReceivedNet = toAmount * info.vTo;

  return {
    valid: true,
    grossAmount,
    toAmount,
    feeAmount,
    feePercent: feeInfo.feePercent,
    retentionPercent: feeInfo.retentionPercent,
    valueDelivered,
    valueReceivedGross,
    valueReceivedNet,
    minFromBatch: info.minFromBatch,
  };
}
