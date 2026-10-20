import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    username: v.optional(v.string()),
    email: v.optional(v.string()),
  }),
  identityMappings: defineTable({
    provider: v.string(), // e.g., "google"
    externalId: v.string(), // e.g., Google sub
    canonicalUserId: v.id("users"),
    verified: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_external_id", ["provider", "externalId"])
    .index("by_canonical_user", ["canonicalUserId"]),
  kingdoms: defineTable({
    userId: v.string(), // Holds either Google sub or canonical user ID string
    name: v.string(),
  }),
});
