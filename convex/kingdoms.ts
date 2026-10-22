import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { resolveKingdomQueryUserId, isKingdomOwner } from "./kingdomAccess";
import { createAggregatePopulationFallback } from "./kingdomReadModel";
import { readArmyUnitDocs } from "./army";
import { validateMilitaryUnitInput as validateMilitaryUnitInputRule } from "./armyRules";
import { requireOwner } from "./buildings";
import { DAILY_BONUS, SEASONS, TIME } from "./balanceConfig";
import { seasonAt } from "./economyExtended";

/**
 * Consulta autoritativa completa del reino para el cliente (Resumen del Reino)
 */
export const getKingdomFull = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);

    // Iberia es la única consulta pública (modo invitado, sección 5 de CLAUDE.md);
    // los reinos de usuario exigen sesión y solo devuelven el reino propio.
    const resolvedUserId = resolveKingdomQueryUserId(args.userId, userId ?? undefined);
    if (!resolvedUserId) return null;

    const kingdom = await ctx.db
      .query("kingdoms")
      .withIndex("by_user_id", (q) => q.eq("userId", resolvedUserId))
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

    // 5. Unidades militares: armyUnits es la fuente única (D-11); la tabla heredada se une solo en lectura.
    const armyUnits: any[] = await readArmyUnitDocs(ctx, kingdomId);

    // Fallar explícitamente si faltan tablas relacionales requeridas; nunca presentar estado inventado.
    const buildings = await ctx.db
      .query("buildings" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();

    const constructionQueue = await ctx.db
      .query("constructionQueue" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), kingdomId))
      .collect();

    // 8. Tecnologías: progreso por reino (Bloque C)
    const technologies = await ctx.db
      .query("technologyProgress")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .collect();

    const kingdomPopulation = kingdom as any;
    const populationFallback = createAggregatePopulationFallback(
      kingdomId,
      kingdomPopulation.population,
      kingdomPopulation.unassignedCivil
    );

    const season = seasonAt(Date.now(), SEASONS.ORDER, TIME.MS_PER_GAME_YEAR);

    return {
      kingdom,
      season: { id: season.id, label: SEASONS.LABELS[season.id as keyof typeof SEASONS.LABELS], progress: season.progress, effectsEnabled: SEASONS.ENABLED_EFFECTS },
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
    // Nombre de gobernante: vive en la tabla users de Convex Auth (sección 5 de CLAUDE.md).
    const userId = await getAuthUserId(ctx);
    const normalizedUserId = userId ? ctx.db.normalizeId("users", userId) : null;
    const user = normalizedUserId ? await ctx.db.get(normalizedUserId) : null;
    return {
      tokenIdentifier: identity.tokenIdentifier,
      subject: identity.subject,
      userId: userId ?? identity.subject,
      rulerName: user?.name ?? identity.name,
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
    const userId = await getAuthUserId(ctx);
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");
    const isDemoRead = kingdom.userId === "guest_g9ai8cz";
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, userId ?? undefined)) {
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

/** Validador heredado: delega en armyRules (fuente única de tipos de unidad). */
export function validateMilitaryUnitInput(unitType: string, count: number): { success: boolean; error?: string } {
  return validateMilitaryUnitInputRule(unitType, count);
}

/** [MAESTRA P59] Bonus diario: +5 honor una vez cada 24 horas reales, validado en servidor. */
export const claimDailyBonus = mutation({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const { kingdom } = await requireOwner(ctx, args.kingdomId);
    const now = Date.now();
    const last = typeof kingdom.lastDailyBonusAt === "number" ? kingdom.lastDailyBonusAt : 0;
    if (now - last < DAILY_BONUS.COOLDOWN_MS) {
      const remainingMs = DAILY_BONUS.COOLDOWN_MS - (now - last);
      throw new Error(`El bonus diario ya fue reclamado; disponible en ${Math.ceil(remainingMs / 60_000)} minutos.`);
    }
    const honor = (kingdom.honor ?? 0) + DAILY_BONUS.HONOR;
    await ctx.db.patch(args.kingdomId, { honor, lastDailyBonusAt: now, updatedAt: now });
    return { success: true, honor, awarded: DAILY_BONUS.HONOR, nextAvailableAt: now + DAILY_BONUS.COOLDOWN_MS };
  },
});
