/**
 * LA CONQUISTA — SISTEMA MILITAR Y RECLUTAMIENTO AUTORITATIVO (CONVEX)
 * 
 * Implementación autoritativa en servidor de la mutación 'military:trainUnits',
 * la operación interna 'military:completeTraining' y la consulta 'military:getTrainingQueue'.
 * 
 * Cumple estrictamente con:
 * - P1: Control de autorización estricto por identidad verificada en servidor.
 * - P23: Requisitos de progresión edilicia (Castillo, Barracones/Cuartel, Universidad, Herrería).
 * - P28 y P29: Tipos principales y multiplicadores marciales de eficacia.
 * - P54: Deducción atómica de ciudadanos libres sin inventar mecanismos paralelos.
 * - P18: Mantenimiento alimentario intacto; regularSoldiers NO se incrementa hasta finalizar la leva.
 * - Finalización Idempotente: scheduled via ctx.scheduler.runAt y procesada atómicamente con eliminación de la tarea.
 * - Protección total del reino de demostración Iberia.
 */

import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { isKingdomOwner, DEMO_USER_ID } from "./kingdomAccess";
import { settleRelationalKingdomEconomy } from "./economy";
import { addUnits } from "./army";
import { normalizeUnitType } from "./armyRules";
import {
  createTrainingPlan,
  isTrainingComplete,
  calculateTrainingProgressPercent,
  calculateNextRegularSoldiers,
  isLivingRegularTroop,
  type TrainingQueueEntry,
} from "./militaryRules";
import type { ResourceType } from "./economyCalculations";

async function requireMilitaryOwner(ctx: MutationCtx, kingdomId: Id<"kingdoms">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new Error("Autenticación requerida: No se detectó una sesión autenticada en el servidor Convex.");
  }
  const kingdom = await ctx.db.get(kingdomId);
  if (!kingdom) {
    throw new Error("Reino no encontrado.");
  }
  if (kingdom.userId === DEMO_USER_ID || kingdom.userId === "guest_g9ai8cz") {
    throw new Error("No se permiten modificaciones ni reclutamiento en el reino de demostración Iberia.");
  }
  if (!isKingdomOwner(kingdom.userId, identity.subject)) {
    throw new Error("No autorizado: el reino no pertenece al usuario autenticado.");
  }
  return { kingdom, userId: identity.subject };
}

/**
 * Consulta autoritativa de la cola de entrenamiento de un reino.
 * Incluye progreso calculado en tiempo real respecto al reloj del servidor.
 */
export const getTrainingQueue = query({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const kingdom = await ctx.db.get(args.kingdomId);
    if (!kingdom) throw new Error("Reino no encontrado.");

    const isDemoRead = kingdom.userId === DEMO_USER_ID;
    if (!isDemoRead && !isKingdomOwner(kingdom.userId, identity?.subject)) {
      throw new Error("No autorizado: solo puede consultar su propio reino.");
    }

    const queue = await ctx.db
      .query("trainingQueue")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
      .collect();

    const serverTimeMs = Date.now();
    return {
      kingdomId: args.kingdomId,
      queue: queue.map((entry) => {
        const startedAt = entry.startedAt ?? 0;
        const durationMs = entry.durationMs ?? 0;
        return {
          ...entry,
          progressPercent: calculateTrainingProgressPercent(startedAt, durationMs, serverTimeMs),
          completesAt: startedAt + durationMs,
          isComplete: isTrainingComplete(startedAt, durationMs, serverTimeMs),
        };
      }),
      serverTimeMs,
    };
  },
});

/**
 * Mutación autoritativa de reclutamiento y adiestramiento de tropas.
 * Valida recursos, ciudadanos libres, edificios P23 y ranuras en servidor.
 */
export const trainUnits = mutation({
  args: {
    kingdomId: v.id("kingdoms"),
    unitType: v.string(),
    count: v.number(),
    level: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // 1. Autorización estricta del propietario (P1) y rechazo absoluto de Iberia
    const { kingdom, userId } = await requireMilitaryOwner(ctx, args.kingdomId);

    // 2. Comprobación de números enteros, positivos y exclusión de espías
    if (normalizeUnitType(args.unitType) === "espia") {
      throw new Error("Los espías no se reclutan mediante formación militar ordinaria; utiliza la sección de Espionaje.");
    }
    if (!Number.isInteger(args.count) || args.count <= 0) {
      throw new Error(`La cantidad de tropas a reclutar debe ser un número entero positivo (recibido: ${args.count}).`);
    }
    const requestedLevel = args.level ?? 1;
    if (!Number.isInteger(requestedLevel) || requestedLevel < 1 || requestedLevel > 5) {
      throw new Error(`El nivel militar debe ser un número entero entre 1 y 5 (recibido: ${requestedLevel}).`);
    }

    // 3. Obtener edificios persistidos para validar requisitos P23
    const storedBuildings = await ctx.db
      .query("buildings" as any)
      .filter((q: any) => q.eq(q.field("kingdomId"), args.kingdomId))
      .collect();

    const buildingLevels: Record<string, number> = {};
    for (const b of storedBuildings) {
      if (b.buildingType && typeof b.level === "number") {
        buildingLevels[b.buildingType] = b.level;
      }
    }

    // 4. Obtener colas de entrenamiento mediante el índice real 'by_kingdom'
    const storedTrainings = await ctx.db
      .query("trainingQueue")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
      .collect();

    const now = Date.now();

    // Auto-incorporar levas cuyo tiempo haya vencido para liberar ranuras pendientes en el cuartel
    const activeTrainings: typeof storedTrainings = [];
    let livingTroopsToAdd = 0;
    for (const task of storedTrainings) {
      if (isTrainingComplete(task.startedAt ?? 0, task.durationMs ?? 0, now)) {
        const count = task.count ?? 0;
        const type = normalizeUnitType(task.unitType ?? "infanteria") ?? (task.unitType ?? "infanteria").trim().toLowerCase();
        const level = type === "espia" ? 1 : (task.level ?? 1);
        await addUnits(ctx, args.kingdomId, type, level, count);
        if (isLivingRegularTroop(type)) {
          livingTroopsToAdd += count;
        }
        await ctx.db.delete(task._id);
      } else {
        activeTrainings.push(task);
      }
    }

    if (livingTroopsToAdd > 0) {
      const nextReg = calculateNextRegularSoldiers(kingdom.regularSoldiers ?? 0, livingTroopsToAdd);
      await ctx.db.patch(args.kingdomId, { regularSoldiers: nextReg });
    }

    // 5. Liquidar la economía relacional previa para disponer del saldo de alimentos al segundo actual
    let settledResources: any = null;
    let availableCivilians = 0;
    let populationDoc: any = null;

    try {
      const settled = await settleRelationalKingdomEconomy(ctx, kingdom, userId, now);
      settledResources = settled.resources;
      populationDoc = settled.population;
      availableCivilians = settled.population?.available ?? 0;
    } catch {
      // Fallback a lecturas directas en caso de reinos sin liquidación relacional previa
      const res = await ctx.db
        .query("resources" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), args.kingdomId))
        .first();
      settledResources = res ?? (kingdom as any).resources;

      const pop = await ctx.db
        .query("population" as any)
        .filter((q: any) => q.eq(q.field("kingdomId"), args.kingdomId))
        .first();
      populationDoc = pop;
      availableCivilians = pop?.available ?? (kingdom as any).unassignedCivil ?? (kingdom as any).population ?? 0;
    }

    if (!settledResources) {
      throw new Error("No existen registros de recursos para el reino.");
    }

    const currentResources: Record<ResourceType, number> = {
      gold: settledResources.gold ?? 0,
      wood: settledResources.wood ?? 0,
      stone: settledResources.stone ?? 0,
      iron: settledResources.iron ?? 0,
      food: settledResources.food ?? 0,
    };

    // 6. Planificar y validar el reclutamiento de forma pura (P23, P28, P29, P54)
    const planResult = createTrainingPlan({
      unitType: args.unitType,
      count: args.count,
      level: requestedLevel,
      resources: currentResources,
      availableCivilians,
      activeTrainings: activeTrainings as TrainingQueueEntry[],
      buildingLevels,
      now,
      civilization: kingdom.civilization,
    });

    if (!planResult.success) {
      throw new Error(planResult.error);
    }

    const plan = planResult.plan;

    // 7. Deducción atómica de recursos
    const nextResources: Record<ResourceType, number> = {
      gold: currentResources.gold - plan.costs.gold,
      wood: currentResources.wood - plan.costs.wood,
      stone: currentResources.stone - plan.costs.stone,
      iron: currentResources.iron - plan.costs.iron,
      food: currentResources.food - plan.costs.food,
    };

    if (settledResources._id) {
      await ctx.db.patch(settledResources._id, nextResources);
    }
    if ((kingdom as any).resources) {
      await ctx.db.patch(kingdom._id, { resources: nextResources });
    }

    // 8. Deducción atómica de ciudadanos libres (P54)
    const nextAvailableCivilians = availableCivilians - plan.count;
    if (populationDoc?._id) {
      await ctx.db.patch(populationDoc._id, { available: nextAvailableCivilians });
    }
    await ctx.db.patch(kingdom._id, { unassignedCivil: nextAvailableCivilians });

    // 9. Inserción atómica en trainingQueue con índice 'by_kingdom'
    const trainingId = await ctx.db.insert("trainingQueue", {
      kingdomId: args.kingdomId,
      unitType: plan.unitType,
      count: plan.count,
      startedAt: plan.startedAt,
      durationMs: plan.durationMs,
      costs: plan.costs,
    });

    // 10. Programar la finalización automática mediante el scheduler autoritativo de Convex
    await ctx.scheduler.runAt(
      plan.completesAt,
      internal.army.completeTraining,
      { trainingId }
    );

    // NOTA CANÓNICA P18:
    // 'regularSoldiers' NO se incrementa aquí. Permanece intacto para no cobrar doble ración
    // a tropas en adiestramiento que aún no han sido dadas de alta en el ejército activo.

    return {
      success: true,
      trainingId,
      unitType: plan.unitType,
      level: plan.level,
      count: plan.count,
      startedAt: plan.startedAt,
      durationMs: plan.durationMs,
      completesAt: plan.completesAt,
      costs: plan.costs,
      remainingCivilians: nextAvailableCivilians,
    };
  },
});

/**
 * Operación interna de finalización autoritativa e idempotente de un adiestramiento.
 * Incorpora las tropas en armyUnits, incrementa regularSoldiers y elimina la tarea de trainingQueue.
 */
export const completeTraining = internalMutation({
  args: { trainingId: v.id("trainingQueue") },
  handler: async (ctx, args) => {
    const training = await ctx.db.get(args.trainingId);
    // Idempotencia: si ya fue procesada o eliminada por una invocación concurrente, sale de forma segura
    if (!training) {
      return { success: true, completed: false, reason: "already_completed_or_deleted" };
    }

    const now = Date.now();
    const startedAt = training.startedAt ?? 0;
    const durationMs = training.durationMs ?? 0;
    if (!isTrainingComplete(startedAt, durationMs, now)) {
      throw new Error("El entrenamiento militar aún no ha alcanzado su tiempo de finalización.");
    }

    const kingdom = await ctx.db.get(training.kingdomId);
    if (!kingdom) {
      // Si el reino fue eliminado, limpia la tarea huérfana de forma segura sin reintentos infinitos
      await ctx.db.delete(args.trainingId);
      return { success: true, completed: false, reason: "kingdom_not_found_cleaned_up" };
    }
    if (kingdom.userId === DEMO_USER_ID || kingdom.userId === "guest_g9ai8cz") {
      // El reino Iberia es inmutable; limpia cualquier tarea huérfana sin modificar el reino de demostración
      await ctx.db.delete(args.trainingId);
      return { success: true, completed: false, reason: "demo_kingdom_protected" };
    }

    const count = training.count ?? 0;
    const unitType = normalizeUnitType(training.unitType ?? "infanteria") ?? (training.unitType ?? "infanteria").trim().toLowerCase();
    const isSpy = unitType === "espia";
    const level = isSpy ? 1 : (training.level ?? 1);

    // 1. Incorporación atómica en la tabla armyUnits mediante función canónica addUnits
    await addUnits(ctx, training.kingdomId, unitType, level, count);

    // 2. Sincronización atómica de regularSoldiers (P18: solo combatientes vivos devengan raciones; excluye espías)
    const nextRegular = calculateNextRegularSoldiers(kingdom.regularSoldiers ?? 0, count, unitType);
    await ctx.db.patch(training.kingdomId, { regularSoldiers: nextRegular });

    // 3. Eliminación atómica de la tarea de trainingQueue
    await ctx.db.delete(args.trainingId);

    return {
      success: true,
      completed: true,
      kingdomId: training.kingdomId,
      unitType,
      count,
      nextRegularSoldiers: nextRegular,
    };
  },
});

/**
 * Mutación pública para resolver bajo demanda cualquier entrenamiento vencido del reino.
 * Permite que al cargar la aplicación o visitar la vista militar se procesen de inmediato
 * las levas que hayan finalizado mientras la sesión estaba cerrada.
 */
export const resolveCompletedTrainings = mutation({
  args: { kingdomId: v.id("kingdoms") },
  handler: async (ctx, args) => {
    const { kingdom } = await requireMilitaryOwner(ctx, args.kingdomId);
    const now = Date.now();

    const queue = await ctx.db
      .query("trainingQueue")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", args.kingdomId))
      .collect();

    const expired = queue.filter((t) => isTrainingComplete(t.startedAt ?? 0, t.durationMs ?? 0, now));
    if (expired.length === 0) {
      return { success: true, processedCount: 0, totalUnitsIncorporated: 0 };
    }

    let totalUnitsIncorporated = 0;
    let totalLivingSoldiersIncorporated = 0;

    for (const task of expired) {
      const count = task.count ?? 0;
      const type = normalizeUnitType(task.unitType ?? "infanteria") ?? (task.unitType ?? "infanteria").trim().toLowerCase();
      const level = type === "espia" ? 1 : (task.level ?? 1);
      await addUnits(ctx, args.kingdomId, type, level, count);

      totalUnitsIncorporated += count;
      if (isLivingRegularTroop(type)) {
        totalLivingSoldiersIncorporated += count;
      }
      await ctx.db.delete(task._id);
    }

    const nextRegular = calculateNextRegularSoldiers(kingdom.regularSoldiers ?? 0, totalLivingSoldiersIncorporated);
    await ctx.db.patch(args.kingdomId, { regularSoldiers: nextRegular });

    return {
      success: true,
      processedCount: expired.length,
      totalUnitsIncorporated,
      nextRegularSoldiers: nextRegular,
    };
  },
});
