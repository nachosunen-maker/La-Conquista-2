import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * ============================================================================
 * LA CONQUISTA — ESQUEMA DE DATOS DEL MOTOR ECONÓMICO (CONVEX)
 * ============================================================================
 */

export default defineSchema(
  {
    // Tabla principal de reinos
    kingdoms: defineTable({
      userId: v.string(),
      name: v.string(),
      civilization: v.optional(v.string()),
      castleName: v.optional(v.string()),
      monarchName: v.optional(v.string()),
      taxPolicy: v.optional(v.string()),
      happiness: v.optional(v.number()),
      militaryMorale: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      createdAt: v.optional(v.number()),

      // Campos escalares / unificados (opcionales para reinos preexistentes)
      population: v.optional(v.number()),
      regularSoldiers: v.optional(v.number()),
      workers: v.optional(
        v.object({
          agriculture: v.number(),
          wood: v.number(),
          stone: v.number(),
          iron: v.number(),
          gold: v.number(),
          other: v.number(),
        })
      ),
      unassignedCivil: v.optional(v.number()),
      resources: v.optional(
        v.object({
          gold: v.number(),
          wood: v.number(),
          stone: v.number(),
          iron: v.number(),
          food: v.number(),
        })
      ),
      foodTier: v.optional(
        v.union(
          v.literal("minima"),
          v.literal("normal"),
          v.literal("abundante"),
          v.literal("excelente")
        )
      ),
      lastUpdated: v.optional(v.number()),
    })
      .index("by_user_id", ["userId"])
      .index("by_user_id_and_name", ["userId", "name"])
      .index("by_name", ["name"]),

    // Tabla para registro atómico e idempotente de transacciones de gasto
    transactions: defineTable({
      kingdomId: v.id("kingdoms"),
      idempotencyKey: v.string(),
      resourceType: v.string(),
      amount: v.number(),
      reason: v.string(),
      createdAt: v.number(),
    })
      .index("by_idempotency_key", ["idempotencyKey"])
      .index("by_kingdom_and_key", ["kingdomId", "idempotencyKey"]),

    // Building documents already exist relationally; the observed contract is type + level.
    buildings: defineTable({
      kingdomId: v.id("kingdoms"),
      buildingType: v.string(),
      level: v.number(),
    }).index("by_kingdom", ["kingdomId"]),

    // Queue fields are the minimal server-owned lifecycle data needed for timed construction.
    constructionQueue: defineTable({
      kingdomId: v.id("kingdoms"),
      buildingType: v.optional(v.string()),
      targetLevel: v.optional(v.number()),
      startedAt: v.optional(v.number()),
      durationMs: v.optional(v.number()),
      costs: v.optional(v.object({
        gold: v.optional(v.number()),
        wood: v.optional(v.number()),
        stone: v.optional(v.number()),
        iron: v.optional(v.number()),
        food: v.optional(v.number()),
      })),
    }).index("by_kingdom", ["kingdomId"]),

    // Cola de entrenamiento militar (ciclo de vida de reclutamiento)
    trainingQueue: defineTable({
      kingdomId: v.id("kingdoms"),
      unitType: v.optional(v.string()),
      count: v.optional(v.number()),
      startedAt: v.optional(v.number()),
      durationMs: v.optional(v.number()),
      costs: v.optional(v.object({
        gold: v.optional(v.number()),
        wood: v.optional(v.number()),
        stone: v.optional(v.number()),
        iron: v.optional(v.number()),
        food: v.optional(v.number()),
      })),
    }).index("by_kingdom", ["kingdomId"]),

    // Unidades militares del reino (esquema mínimo persistido)
    armyUnits: defineTable({
      kingdomId: v.id("kingdoms"),
      unitType: v.string(), // "infanteria", "caballeria", "arqueria", "asedio", etc.
      count: v.number(),    // Cantidad entera no negativa
    }).index("by_kingdom", ["kingdomId"]),
  },
  {
    schemaValidation: false,
    strictTableNameTypes: false,
  }
);
