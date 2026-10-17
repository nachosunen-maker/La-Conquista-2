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
      // Bloque B: equipamiento y estrategia del ejército (P30, P31, P35) y fatiga (P32)
      weaponTier: v.optional(v.string()),
      armorTier: v.optional(v.string()),
      strategy: v.optional(v.string()),
      armyFatigue: v.optional(v.number()),
      // Ronda 2: política de descanso (M-04) y formación de combate (P37, M-11)
      restPolicy: v.optional(v.string()),
      formation: v.optional(v.object({
        infanteria: v.optional(v.number()),
        arqueria: v.optional(v.number()),
        caballeria: v.optional(v.number()),
        asedio: v.optional(v.number()),
      })),
      // Bloques D-F: bienestar, impuestos, honor y gloria
      taxRate: v.optional(v.number()),
      honor: v.optional(v.number()),
      glory: v.optional(v.number()),
      lastDailyBonusAt: v.optional(v.number()),
      moraleEffects: v.optional(v.array(v.object({ amount: v.number(), expiresAt: v.number() }))),
      // Bloque G: territorio principal y reclamaciones pendientes (P47)
      homeTerritoryId: v.optional(v.string()),
      pendingTerritoryClaims: v.optional(v.number()),
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
      level: v.optional(v.number()), // Nivel militar P29 (1-5)
      populationReserved: v.optional(v.number()), // Civiles libres reservados hasta completar
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

    // Progreso tecnológico por reino (Bloque C): un documento por tecnología iniciada o completada.
    technologyProgress: defineTable({
      kingdomId: v.id("kingdoms"),
      technologyId: v.string(),
      status: v.union(v.literal("researching"), v.literal("completed")),
      startedAt: v.optional(v.number()),
      durationMs: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      costs: v.optional(v.object({
        gold: v.optional(v.number()),
        wood: v.optional(v.number()),
        stone: v.optional(v.number()),
        iron: v.optional(v.number()),
        food: v.optional(v.number()),
      })),
    })
      .index("by_kingdom", ["kingdomId"])
      .index("by_kingdom_and_technology", ["kingdomId", "technologyId"]),

    // Mapa hexagonal (Bloque G): una fila por celda; ownerKingdomId ausente = territorio libre (P49).
    territories: defineTable({
      cellId: v.string(),
      q: v.number(),
      r: v.number(),
      terrain: v.string(),
      ownerKingdomId: v.optional(v.id("kingdoms")),
      isHome: v.optional(v.boolean()),
      claimedAt: v.optional(v.number()),
    })
      .index("by_cell", ["cellId"])
      .index("by_owner", ["ownerKingdomId"]),

    // Desafíos del Parlamento (Bloque E): máquina de estados server-authoritative (BLOQUE 9).
    challenges: defineTable({
      challengerKingdomId: v.id("kingdoms"),
      targetKingdomId: v.id("kingdoms"),
      challengeType: v.string(),
      status: v.union(
        v.literal("PENDING"), v.literal("ACCEPTED"), v.literal("REJECTED"),
        v.literal("FROZEN"), v.literal("RESOLVED"), v.literal("EXPIRED")
      ),
      createdAt: v.number(),
      expiresAt: v.number(),
      respondedAt: v.optional(v.number()),
      window: v.optional(v.string()),
      scheduledAt: v.optional(v.number()),
      freezeAt: v.optional(v.number()),
      frozenAt: v.optional(v.number()),
      resolvedAt: v.optional(v.number()),
      distance: v.optional(v.number()),
      marchSeconds: v.optional(v.number()),
      battleId: v.optional(v.id("Battle")),
      penaltyApplied: v.optional(v.any()),
      frozen: v.optional(v.any()),
      messages: v.optional(v.array(v.object({ fromKingdomId: v.id("kingdoms"), messageId: v.string(), at: v.number() }))),
    })
      .index("by_challenger", ["challengerKingdomId"])
      .index("by_target", ["targetKingdomId"]),

    // Informes de batalla (Bloque F, P43). Nombre de tabla confirmado con mayúscula.
    Battle: defineTable({
      challengeId: v.id("challenges"),
      attackerKingdomId: v.id("kingdoms"),
      defenderKingdomId: v.id("kingdoms"),
      resolvedAt: v.number(),
      outcome: v.string(),
      winnerKingdomId: v.optional(v.id("kingdoms")),
      crushingVictory: v.boolean(),
      report: v.any(),
    })
      .index("by_attacker", ["attackerKingdomId"])
      .index("by_defender", ["defenderKingdomId"]),

    // Informes de espionaje (D-39), caducan a las 24 h reales.
    espionageReports: defineTable({
      kingdomId: v.id("kingdoms"),
      targetKingdomId: v.id("kingdoms"),
      level: v.number(),
      createdAt: v.number(),
      expiresAt: v.number(),
      estimate: v.object({ min: v.number(), max: v.number() }),
      composition: v.optional(v.any()),
    }).index("by_kingdom", ["kingdomId"]),

    // Unidades militares del reino (esquema mínimo persistido)
    armyUnits: defineTable({
      kingdomId: v.id("kingdoms"),
      unitType: v.string(), // "infanteria", "caballeria", "arqueria", "asedio"
      level: v.optional(v.number()), // Nivel militar P29 (1-5); ausente = 1
      count: v.number(),    // Activos: cantidad entera no negativa
      wounded: v.optional(v.number()), // Heridos (P44) separados de los disponibles
      recoveryProgress: v.optional(v.number()), // Fracción acumulada de recuperación hospitalaria (P45)
      isMercenary: v.optional(v.boolean()), // [M-02] Contrato de mercenarios (P53)
      contractEndsAt: v.optional(v.number()),
    }).index("by_kingdom", ["kingdomId"]),
  },
  {
    schemaValidation: false,
    strictTableNameTypes: false,
  }
);
