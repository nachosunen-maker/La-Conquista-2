import { query } from "./_generated/server";
import { v } from "convex/values";
import { resolveKingdomQueryUserId } from "./kingdomAccess";
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

    // 6. Edificios
    let buildings: any[] = [];
    try {
      buildings = await ctx.db
        .query("buildings" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
        .collect();
    } catch {
      buildings = [];
    }

    // 7. Cola de construcción
    let constructionQueue: any[] = [];
    try {
      constructionQueue = await ctx.db
        .query("constructionQueue" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
        .collect();
    } catch {
      constructionQueue = [];
    }

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
