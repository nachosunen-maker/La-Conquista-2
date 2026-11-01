/**
 * LA CONQUISTA — PRUEBAS DE INTEGRACIÓN: FILTRADO DE REINOS EN EL PARLAMENTO POR DESCUBRIMIENTO EN EL MAPA
 * Valida los 4 casos obligatorios:
 * - Caso A: Reino real no descubierto en el mapa -> NO debe aparecer en el Parlamento.
 * - Caso B: Reino real descubierto en el mapa -> DEBE aparecer en el Parlamento.
 * - Caso C: Exploración asimétrica: Jugador 1 descubre a Jugador 2, pero Jugador 2 NO a Jugador 1.
 * - Caso D: Persistencia tras recargas: el descubrimiento guardado en backend persiste en nuevas sesiones.
 */
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { createTestBackend } from "./test.setup";
import { ensureHomeTerritory } from "./territories";

function identity(subject: string) {
  return { subject, tokenIdentifier: `https://accounts.google.com|${subject}`, issuer: "https://accounts.google.com" };
}

describe("Parlamento por Descubrimiento en el Mapa (Beta)", () => {
  test("Casos A, B, C y D: el Parlamento solo lista reinos reales descubiertos en el mapa con persistencia y asimetría", async () => {
    const t = createTestBackend();

    // 1. Fundar Reino 1 (user-alpha)
    const userA = t.withIdentity(identity("user-alpha"));
    const kingdomA = await userA.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino de Castilla",
      civilization: "romanos",
      castleName: "Castillo de Castilla",
      monarchName: "Alfonso",
    });

    // 2. Fundar Reino 2 (user-beta)
    const userB = t.withIdentity(identity("user-beta"));
    const kingdomB = await userB.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino de Aragón",
      civilization: "griegos",
      castleName: "Castillo de Aragón",
      monarchName: "Pedro",
    });

    // Asegurar territorios principales asignados en el mapa
    const [homeA, homeB] = await t.run(async (ctx) => {
      const hA = await ensureHomeTerritory(ctx, kingdomA._id as any);
      const hB = await ensureHomeTerritory(ctx, kingdomB._id as any);
      return [hA, hB];
    });

    expect(homeA).toBeTruthy();
    expect(homeB).toBeTruthy();
    expect(homeA).not.toBe(homeB);

    // =========================================================================
    // CASO A: Reino real no descubierto en el mapa -> NO debe aparecer en el Parlamento
    // =========================================================================
    const rivalsBefore = await userA.query(api.parliament.listRivals, { kingdomId: kingdomA._id as any });
    expect(rivalsBefore.rivals).toHaveLength(0);

    // =========================================================================
    // CASO B: Reino real descubierto en el mapa -> DEBE aparecer en el Parlamento
    // =========================================================================
    // Jugador A explora la celda de homeB y se registra persistentemente en exploredTerritories
    await t.run(async (ctx) => {
      await ctx.db.insert("exploredTerritories", {
        kingdomId: kingdomA._id as any,
        cellId: homeB!,
        discoveredAt: Date.now(),
        discoveryNote: "Exploración exitosa del asentamiento aragonés.",
      });
    });

    const rivalsAfterA = await userA.query(api.parliament.listRivals, { kingdomId: kingdomA._id as any });
    expect(rivalsAfterA.rivals).toHaveLength(1);
    expect(rivalsAfterA.rivals[0].kingdomId).toBe(kingdomB._id);
    expect(rivalsAfterA.rivals[0].name).toBe("Reino de Aragón");

    // =========================================================================
    // CASO C: Exploración asimétrica (Jugador 1 descubrió a Jugador 2, pero Jugador 2 NO a Jugador 1)
    // =========================================================================
    // Jugador B consulta su Parlamento: como no ha explorado el territorio de Jugador A, no debe ver nada
    const rivalsUserB = await userB.query(api.parliament.listRivals, { kingdomId: kingdomB._id as any });
    expect(rivalsUserB.rivals).toHaveLength(0);

    // =========================================================================
    // CASO D: Persistencia tras recargas / nuevas sesiones
    // =========================================================================
    // Una nueva consulta en una nueva llamada de cliente (simulando recarga de página)
    // lee de la base de datos persistida y mantiene a Reino de Aragón disponible en el Parlamento de A
    const freshQuerySession = await userA.query(api.parliament.listRivals, { kingdomId: kingdomA._id as any });
    expect(freshQuerySession.rivals).toHaveLength(1);
    expect(freshQuerySession.rivals[0].kingdomId).toBe(kingdomB._id);
    expect(freshQuerySession.rivals[0].name).toBe("Reino de Aragón");
  });

  test("Exclusión de reinos de prueba, verificación, demo Iberia y deduplicados", async () => {
    const t = createTestBackend();

    const userA = t.withIdentity(identity("user-main"));
    const kingdomA = await userA.mutation(api.economy.getOrInitializeKingdom, {
      name: "Reino de Navarra",
      civilization: "romanos",
      castleName: "Castillo de Olite",
      monarchName: "Sancho",
    });

    const homeA = await t.run(async (ctx) => ensureHomeTerritory(ctx, kingdomA._id as any));

    // Crear Reino de Pruebas, Reino de Verificación Remoto y Demo Iberia
    const [idPruebas, idVerif, idDemo] = await t.run(async (ctx) => {
      const kPruebas = await ctx.db.insert("kingdoms", {
        name: "Reino de Pruebas",
        monarchName: "GobernanteTestFundacion",
        userId: "user-test",
        civilization: "romanos",
      });
      const kVerif = await ctx.db.insert("kingdoms", {
        name: "Reino de Verificación Remoto",
        monarchName: "Monarca",
        userId: "user-verif",
        civilization: "romanos",
      });
      const kDemo = await ctx.db.insert("kingdoms", {
        name: "Reino de Iberia",
        monarchName: "Rey Arturo",
        userId: "guest_g9ai8cz",
        civilization: "ingleses",
      });

      // Asignar celdas a estos reinos
      await ctx.db.insert("territories", { cellId: "2,2", q: 2, r: 2, terrain: "llanura", ownerKingdomId: kPruebas });
      await ctx.db.insert("territories", { cellId: "3,3", q: 3, r: 3, terrain: "bosque", ownerKingdomId: kVerif });
      await ctx.db.insert("territories", { cellId: "4,4", q: 4, r: 4, terrain: "colina", ownerKingdomId: kDemo });

      // Simular que el jugador A ha explorado esas celdas
      for (const cellId of ["2,2", "3,3", "4,4"]) {
        await ctx.db.insert("exploredTerritories", {
          kingdomId: kingdomA._id as any,
          cellId,
          discoveredAt: Date.now(),
        });
      }

      return [kPruebas, kVerif, kDemo];
    });

    // Aunque estén exploradas las celdas, NO deben aparecer en listRivals
    const rivals = await userA.query(api.parliament.listRivals, { kingdomId: kingdomA._id as any });
    expect(rivals.rivals).toHaveLength(0);
    expect(rivals.rivals.some((r) => r.name.includes("Pruebas"))).toBe(false);
    expect(rivals.rivals.some((r) => r.name.includes("Verificación"))).toBe(false);
    expect(rivals.rivals.some((r) => r.name === "Reino de Iberia")).toBe(false);
  });
});
