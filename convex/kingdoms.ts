import { query } from "./_generated/server";
import { v } from "convex/values";
import { resolveKingdomQueryUserId, isKingdomOwner } from "./kingdomAccess";
import { createAggregatePopulationFallback } from "./kingdomReadModel";

/**
 * Consulta autoritativa completa del reino para el cliente (Resumen del Reino)
 */
export const getKingdomFull = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = resolveKingdomQueryUserId(args.userId, identity?.subject);

    // Iberia es la única consulta pública; los reinos de usuario usan el subject validado.
    const kingdom = await ctx.db
      .query("kingdoms")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .first();

    if (!kingdom) {
      return null;
    }

    const kingdomId = kingdom._id;

    // 2. Recursos relacionales
    const resources = await ctx.db
      .query("resources" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .first();

    // 3. Población general
    const population = await ctx.db
      .query("population" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .first();

    // 4. Oficios y distribución laboral
    const populationJobs = await ctx.db
      .query("populationJobs" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();

    // 5. Unidades militares (compatibilidad Armyunits / armyUnits)
    let armyUnits: any[] = [];
    try {
      armyUnits = await ctx.db
        .query("Armyunits" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
        .collect();
    } catch {
      try {
        armyUnits = await ctx.db
          .query("armyUnits" as any)
          .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
          .collect();
      } catch {
        armyUnits = [];
      }
    }

    // Fallar explícitamente si faltan tablas relacionales requeridas; nunca presentar estado inventado.
    const buildings = await ctx.db
      .query("buildings" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();

    const constructionQueue = await ctx.db
      .query("constructionQueue" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();

    // 8. Tecnologías
    let technologies: any[] = [];
    try {
      technologies = await ctx.db
        .query("technologies" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
        .collect();
    } catch {
      technologies = [];
    }

    const kingdomPopulation = kingdom as any;
    const populationFallback = createAggregatePopulationFallback(
      kingdomId,
      kingdomPopulation.population,
      kingdomPopulation.unassignedCivil
    );

    return {
      kingdom,
      resources: resources ?? (kingdom as any).resources,
      population: population ?? populationFallback,
      populationJobs,
      armyUnits,
      buildings,
      constructionQueue,
      technologies,
    };
  },
});

/**
 * Comprueba y devuelve la identidad autoritativa del usuario autenticado en Convex
 */
export const getViewer = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    return {
      tokenIdentifier: identity.tokenIdentifier,
      subject: identity.subject,
      email: identity.email,
      name: identity.name,
      pictureUrl: identity.pictureUrl,
    };
  },
});

/**
 * Construcción: la implementación canónica vive en buildings.ts (Bloque A).
 * Se reexporta aquí porque la interfaz invoca kingdoms:getConstructionState,
 * kingdoms:startConstruction y kingdoms:cancelConstruction por nombre.
 */
export { getConstructionState, startConstruction, cancelConstruction, bootstrapInitialBuildings } from "./buildings";
export { getConstructionState as getBuildingsAndQueue } from "./buildings";

/**
 * Consulta de solo lectura de unidades militares del reino.
 * Requiere que la tabla 'armyUnits' esté desplegada en el backend remoto.
 */
export const getArmyUnits = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    const isDemoRead = kingdom.userId === "guest_g9ai8cz";
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar su propio reino.");
    }

    let units: any[] = [];
    try {
      units = await ctx.db
        .query("armyUnits")
        .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
        .collect();
    } catch {
      units = [];
    }

    return {
      kingdomId: args.kingdomId,
      units,
      serverTimeMs: Date.now(),
    };
  },
});

/**
 * Validador puro auxiliar para entradas de unidades militares.
 * Asegura que el tipo de unidad sea válido y la cantidad un entero no negativo.
 */
export function validateMilitaryUnitInput(unitType: string, count: number): { success: boolean; error?: string } {
  const validTypes = ["infanteria", "caballeria", "arqueria", "asedio"];
  const normalizedType = (unitType || "").toLowerCase().trim();
  if (!validTypes.includes(normalizedType)) {
    return { success: false, error: `Tipo de unidad no admitido: '${unitType}'. Válidos: ${validTypes.join(", ")}.` };
  }
  if (!Number.isInteger(count) || count < 0) {
    return { success: false, error: `Cantidad inválida: debe ser un número entero no negativo (recibido: ${count}).` };
  }
  return { success: true };
}

