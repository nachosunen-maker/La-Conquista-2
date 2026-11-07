import { describe, expect, it } from "vitest";
import {
  RESOURCE_COMMERCIAL_VALUES,
  MARKET_RESOURCE_NAMES,
  UNLOCK_MERCADO_MIN_LEVEL,
  VALID_MARKET_RESOURCES,
  getExchangeBatchInfo,
  calculateExchange,
  type MarketResourceType,
} from "./market";
import { storageCapacity } from "./economyExtended";
import { STORAGE } from "./balanceConfig";

describe("Mercado — Sistema Matemático y Equivalencias de Intercambio", () => {
  it("Valores comerciales oficiales de la especificación", () => {
    expect(RESOURCE_COMMERCIAL_VALUES.gold).toBe(30);
    expect(RESOURCE_COMMERCIAL_VALUES.iron).toBe(15);
    expect(RESOURCE_COMMERCIAL_VALUES.stone).toBe(8);
    expect(RESOURCE_COMMERCIAL_VALUES.wood).toBe(6);
    expect(RESOURCE_COMMERCIAL_VALUES.food).toBe(3);
  });

  it("Comprobación de la tabla de equivalencias oficial (sección 4.2)", () => {
    // 1 oro -> Madera: 5
    const goldToWood = calculateExchange("gold", "wood", 1);
    expect(goldToWood.valid).toBe(true);
    expect(goldToWood.toAmount).toBe(5);

    // 1 oro -> Piedra: 3,75 (Lote mínimo 4 oro -> 15 piedra)
    const goldToStoneBatch = calculateExchange("gold", "stone", 4);
    expect(goldToStoneBatch.valid).toBe(true);
    expect(goldToStoneBatch.toAmount).toBe(15);
    expect(goldToStoneBatch.toAmount / 4).toBe(3.75);

    // 1 oro -> Hierro: 2
    const goldToIron = calculateExchange("gold", "iron", 1);
    expect(goldToIron.valid).toBe(true);
    expect(goldToIron.toAmount).toBe(2);

    // 1 oro -> Alimentos: 10
    const goldToFood = calculateExchange("gold", "food", 1);
    expect(goldToFood.valid).toBe(true);
    expect(goldToFood.toAmount).toBe(10);

    // 4 madera -> Piedra: 3
    const woodToStone = calculateExchange("wood", "stone", 4);
    expect(woodToStone.valid).toBe(true);
    expect(woodToStone.toAmount).toBe(3);

    // 5 madera -> Hierro: 2
    const woodToIron = calculateExchange("wood", "iron", 5);
    expect(woodToIron.valid).toBe(true);
    expect(woodToIron.toAmount).toBe(2);

    // 1 madera -> Alimentos: 2
    const woodToFood = calculateExchange("wood", "food", 1);
    expect(woodToFood.valid).toBe(true);
    expect(woodToFood.toAmount).toBe(2);

    // 2 hierro -> Madera: 5
    const ironToWood = calculateExchange("iron", "wood", 2);
    expect(ironToWood.valid).toBe(true);
    expect(ironToWood.toAmount).toBe(5);

    // 1 hierro -> Alimentos: 5
    const ironToFood = calculateExchange("iron", "food", 1);
    expect(ironToFood.valid).toBe(true);
    expect(ironToFood.toAmount).toBe(5);

    // 3 piedra -> Alimentos: 8
    const stoneToFood = calculateExchange("stone", "food", 3);
    expect(stoneToFood.valid).toBe(true);
    expect(stoneToFood.toAmount).toBe(8);
  });

  it("Prueba E: Cobertura de las 20 direcciones posibles conservando estrictamente el valor económico", () => {
    let pairCount = 0;

    for (const from of VALID_MARKET_RESOURCES) {
      for (const to of VALID_MARKET_RESOURCES) {
        if (from === to) continue;
        pairCount++;

        const info = getExchangeBatchInfo(from, to);
        expect(info.minFromBatch).toBeGreaterThan(0);
        expect(info.minToBatch).toBeGreaterThan(0);

        // Probar intercambio con 1 lote mínimo
        const res1 = calculateExchange(from, to, info.minFromBatch);
        expect(res1.valid).toBe(true);
        expect(res1.toAmount).toBe(info.minToBatch);
        expect(res1.valueDelivered).toBe(res1.valueReceived); // Conservación exacta de valor

        // Probar intercambio con 3 lotes
        const res3 = calculateExchange(from, to, info.minFromBatch * 3);
        expect(res3.valid).toBe(true);
        expect(res3.toAmount).toBe(info.minToBatch * 3);
        expect(res3.valueDelivered).toBe(res3.valueReceived);
      }
    }

    expect(pairCount).toBe(20); // 5 * 4 = 20 direcciones
  });

  it("Prueba K: Imposibilidad de arbitraje o creación de recursos de la nada", () => {
    // Si cambio 10 oro a madera (50 madera) y luego esa madera de vuelta a oro:
    const goldToWood = calculateExchange("gold", "wood", 10);
    expect(goldToWood.toAmount).toBe(50);

    const woodToGold = calculateExchange("wood", "gold", 50);
    expect(woodToGold.toAmount).toBe(10); // Exactamente los mismos 10 de oro iniciales

    // Si cambio 4 oro a piedra (15 piedra) y luego 15 piedra a oro:
    const goldToStone = calculateExchange("gold", "stone", 4);
    expect(goldToStone.toAmount).toBe(15);

    const stoneToGold = calculateExchange("stone", "gold", 15);
    expect(stoneToGold.toAmount).toBe(4); // Exactamente los 4 de oro iniciales
  });

  it("Prueba H: Rechazo de intercambios con cantidades negativas, cero o fraccionarias", () => {
    // Negativo
    const neg = calculateExchange("gold", "wood", -5);
    expect(neg.valid).toBe(false);

    // Cero
    const zero = calculateExchange("gold", "wood", 0);
    expect(zero.valid).toBe(false);

    // Fraccionario
    const frac = calculateExchange("gold", "wood", 2.5);
    expect(frac.valid).toBe(false);

    // Mismo recurso
    const same = calculateExchange("gold", "gold", 10);
    expect(same.valid).toBe(false);
  });

  it("Lotes mínimos: rechazo de cantidades que no completan el lote exacto", () => {
    // oro a piedra requiere múltiplos de 4 oro
    const invalidBatch = calculateExchange("gold", "stone", 3);
    expect(invalidBatch.valid).toBe(false);
    expect(invalidBatch.error).toContain("múltiplo de 4");

    const validBatch = calculateExchange("gold", "stone", 8);
    expect(validBatch.valid).toBe(true);
    expect(validBatch.toAmount).toBe(30);
  });

  it("Prueba A y B: Regla de desbloqueo (Nivel < 4 bloqueado, Nivel >= 4 disponible)", () => {
    expect(UNLOCK_MERCADO_MIN_LEVEL).toBe(4);

    const isUnlocked = (mercadoLevel: number) => mercadoLevel >= UNLOCK_MERCADO_MIN_LEVEL;
    expect(isUnlocked(0)).toBe(false);
    expect(isUnlocked(1)).toBe(false);
    expect(isUnlocked(2)).toBe(false);
    expect(isUnlocked(3)).toBe(false); // Prueba A: bloqueado
    expect(isUnlocked(4)).toBe(true);  // Prueba B: desbloqueado
    expect(isUnlocked(5)).toBe(true);
  });

  it("Prueba L: Las capacidades de almacenamiento y multiplicadores siguen funcionando exactamente igual", () => {
    // Base 10.000 + 2.000 por nivel de mercado
    expect(storageCapacity(0)).toBe(STORAGE.BASE_CAPACITY);
    expect(storageCapacity(1)).toBe(12_000);
    expect(storageCapacity(2)).toBe(14_000);
    expect(storageCapacity(3)).toBe(16_000);
    expect(storageCapacity(4)).toBe(18_000);
    expect(storageCapacity(5)).toBe(20_000);

    // Multiplicador tecnológico y civilización
    expect(storageCapacity(4, 1.15)).toBe(Math.floor(18_000 * 1.15));
    expect(storageCapacity(4, 1.25)).toBe(Math.floor(18_000 * 1.25));
  });
});
