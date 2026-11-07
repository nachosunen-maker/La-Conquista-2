import { describe, expect, it } from "vitest";
import {
  RESOURCE_COMMERCIAL_VALUES,
  MARKET_RESOURCE_NAMES,
  UNLOCK_MERCADO_MIN_LEVEL,
  VALID_MARKET_RESOURCES,
  getExchangeBatchInfo,
  getMarketFee,
  calculateExchange,
  type MarketResourceType,
} from "./market";
import { storageCapacity } from "./economyExtended";
import { STORAGE } from "./balanceConfig";

describe("Mercado — Reducción Progresiva de Comisión por Nivel", () => {
  it("Valores comerciales oficiales de la especificación", () => {
    expect(RESOURCE_COMMERCIAL_VALUES.gold).toBe(30);
    expect(RESOURCE_COMMERCIAL_VALUES.iron).toBe(15);
    expect(RESOURCE_COMMERCIAL_VALUES.stone).toBe(8);
    expect(RESOURCE_COMMERCIAL_VALUES.wood).toBe(6);
    expect(RESOURCE_COMMERCIAL_VALUES.food).toBe(3);
  });

  it("Prueba A: Progresión oficial de comisiones y factor de retención (Sección 3)", () => {
    // Nivel 4: 10,00 % comisión, 90,00 % conservado
    const feeL4 = getMarketFee(4);
    expect(feeL4.feePercent).toBeCloseTo(10.0, 2);
    expect(feeL4.retentionPercent).toBeCloseTo(90.0, 2);

    // Nivel 5: 9,09 % comisión, 90,91 % conservado
    const feeL5 = getMarketFee(5);
    expect(feeL5.feePercent).toBeCloseTo(9.09, 2);
    expect(feeL5.retentionPercent).toBeCloseTo(90.91, 2);

    // Nivel 6: 8,33 % comisión, 91,67 % conservado
    const feeL6 = getMarketFee(6);
    expect(feeL6.feePercent).toBeCloseTo(8.33, 2);
    expect(feeL6.retentionPercent).toBeCloseTo(91.67, 2);

    // Nivel 7: 7,69 % comisión, 92,31 % conservado
    const feeL7 = getMarketFee(7);
    expect(feeL7.feePercent).toBeCloseTo(7.69, 2);
    expect(feeL7.retentionPercent).toBeCloseTo(92.31, 2);

    // Nivel 8: 7,14 % comisión, 92,86 % conservado
    const feeL8 = getMarketFee(8);
    expect(feeL8.feePercent).toBeCloseTo(7.14, 2);
    expect(feeL8.retentionPercent).toBeCloseTo(92.86, 2);

    // Nivel 9: 6,67 % comisión, 93,33 % conservado
    const feeL9 = getMarketFee(9);
    expect(feeL9.feePercent).toBeCloseTo(6.67, 2);
    expect(feeL9.retentionPercent).toBeCloseTo(93.33, 2);

    // Nivel 10: 6,25 % comisión, 93,75 % conservado
    const feeL10 = getMarketFee(10);
    expect(feeL10.feePercent).toBeCloseTo(6.25, 2);
    expect(feeL10.retentionPercent).toBeCloseTo(93.75, 2);

    // Nivel 15: 4,76 % comisión, 95,24 % conservado
    const feeL15 = getMarketFee(15);
    expect(feeL15.feePercent).toBeCloseTo(4.76, 2);
    expect(feeL15.retentionPercent).toBeCloseTo(95.24, 2);

    // Nivel 20: 3,85 % comisión, 96,15 % conservado
    const feeL20 = getMarketFee(20);
    expect(feeL20.feePercent).toBeCloseTo(3.85, 2);
    expect(feeL20.retentionPercent).toBeCloseTo(96.15, 2);

    // Nivel 30: 2,78 % comisión, 97,22 % conservado
    const feeL30 = getMarketFee(30);
    expect(feeL30.feePercent).toBeCloseTo(2.78, 2);
    expect(feeL30.retentionPercent).toBeCloseTo(97.22, 2);

    // Nivel 50: 1,79 % comisión, 98,21 % conservado
    const feeL50 = getMarketFee(50);
    expect(feeL50.feePercent).toBeCloseTo(1.79, 2);
    expect(feeL50.retentionPercent).toBeCloseTo(98.21, 2);

    // Nivel 75: 1,23 % comisión, 98,77 % conservado
    const feeL75 = getMarketFee(75);
    expect(feeL75.feePercent).toBeCloseTo(1.23, 2);
    expect(feeL75.retentionPercent).toBeCloseTo(98.77, 2);

    // Nivel 100: 0,94 % comisión, 99,06 % conservado
    const feeL100 = getMarketFee(100);
    expect(feeL100.feePercent).toBeCloseTo(0.94, 2);
    expect(feeL100.retentionPercent).toBeCloseTo(99.06, 2);
  });

  it("Ejemplo de funcionamiento oficial (Sección 4): 100 oro por madera en distintos niveles", () => {
    // Equivalencia comercial: 1 oro = 5 madera -> 100 oro = 500 madera bruta
    const resL4 = calculateExchange("gold", "wood", 100, 4);
    expect(resL4.grossAmount).toBe(500);
    expect(resL4.toAmount).toBe(450); // Nivel 4 -> 450 madera

    const resL5 = calculateExchange("gold", "wood", 100, 5);
    expect(resL5.grossAmount).toBe(500);
    expect(resL5.toAmount).toBe(454); // Nivel 5 -> 454 madera

    const resL10 = calculateExchange("gold", "wood", 100, 10);
    expect(resL10.grossAmount).toBe(500);
    expect(resL10.toAmount).toBe(468); // Nivel 10 -> 468 madera

    const resL20 = calculateExchange("gold", "wood", 100, 20);
    expect(resL20.grossAmount).toBe(500);
    expect(resL20.toAmount).toBe(480); // Nivel 20 -> 480 madera

    const resL50 = calculateExchange("gold", "wood", 100, 50);
    expect(resL50.grossAmount).toBe(500);
    expect(resL50.toAmount).toBe(491); // Nivel 50 -> 491 madera

    const resL100 = calculateExchange("gold", "wood", 100, 100);
    expect(resL100.grossAmount).toBe(500);
    expect(resL100.toAmount).toBe(495); // Nivel 100 -> 495 madera
  });

  it("Prueba B: Monotonía — aumentar el nivel nunca reduce la cantidad neta recibida", () => {
    // Para todas las parejas y varias cantidades, verificar f(L+1) >= f(L)
    const testAmounts = [10, 50, 100, 500];

    for (const from of VALID_MARKET_RESOURCES) {
      for (const to of VALID_MARKET_RESOURCES) {
        if (from === to) continue;
        const info = getExchangeBatchInfo(from, to);

        for (const mult of testAmounts) {
          const amount = info.minFromBatch * mult;
          let prevReceived = 0;

          for (let level = 4; level <= 30; level++) {
            const res = calculateExchange(from, to, amount, level);
            expect(res.valid).toBe(true);
            expect(res.toAmount).toBeGreaterThanOrEqual(prevReceived);
            prevReceived = res.toAmount;
          }
        }
      }
    }
  });

  it("Prueba C: Equivalencias brutas exactas antes de comisión en las 20 combinaciones", () => {
    let count = 0;
    for (const from of VALID_MARKET_RESOURCES) {
      for (const to of VALID_MARKET_RESOURCES) {
        if (from === to) continue;
        count++;

        const info = getExchangeBatchInfo(from, to);
        const amount = info.minFromBatch * 4;
        const res = calculateExchange(from, to, amount, 4);

        expect(res.valid).toBe(true);
        expect(res.grossAmount).toBe(info.minToBatch * 4);
        expect(res.valueReceivedGross).toBe(res.valueDelivered);
      }
    }
    expect(count).toBe(20);
  });

  it("Prueba D: Seguridad económica — ningún canje produce más valor económico del entregado", () => {
    for (const from of VALID_MARKET_RESOURCES) {
      for (const to of VALID_MARKET_RESOURCES) {
        if (from === to) continue;
        const info = getExchangeBatchInfo(from, to);

        for (let level = 4; level <= 50; level += 5) {
          const res = calculateExchange(from, to, info.minFromBatch * 10, level);
          expect(res.valid).toBe(true);
          // El valor neto recibido SIEMPRE debe ser estrictamente menor o igual al entregado
          expect(res.valueReceivedNet).toBeLessThanOrEqual(res.valueDelivered);
          expect(res.feeAmount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("Prueba E: Redondeo hacia abajo (floor) y prevención de recursos gratuitos", () => {
    // Si la cantidad bruta multiplicada por el factor produce decimales, se redondea hacia abajo
    const res = calculateExchange("gold", "wood", 1, 4); // 5 madera bruta * 0.9 = 4.5 -> 4 madera
    expect(res.toAmount).toBe(4);
    expect(res.feeAmount).toBe(1);

    // Cantidad pequeña que resultaría en 0 recursos tras comisión
    const smallWoodToGold = calculateExchange("wood", "gold", 5, 4); // 1 oro bruto * 0.9 = 0.9 -> floor = 0
    expect(smallWoodToGold.valid).toBe(false);
    expect(smallWoodToGold.error).toContain("resultaría en 0");
  });

  it("Prueba F: Validación de entrada — rechazo de cantidades inválidas", () => {
    expect(calculateExchange("gold", "wood", -10, 4).valid).toBe(false);
    expect(calculateExchange("gold", "wood", 0, 4).valid).toBe(false);
    expect(calculateExchange("gold", "wood", 2.5, 4).valid).toBe(false);
    expect(calculateExchange("gold", "gold", 10, 4).valid).toBe(false);
  });

  it("Prueba G: Desbloqueo y capacidades de almacenamiento intactas", () => {
    expect(UNLOCK_MERCADO_MIN_LEVEL).toBe(4);
    expect(storageCapacity(0)).toBe(STORAGE.BASE_CAPACITY);
    expect(storageCapacity(4)).toBe(18_000);
    expect(storageCapacity(10)).toBe(30_000);
    expect(storageCapacity(4, 1.10)).toBe(19_800);
  });
});
