import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    username: v.optional(v.string()),
    email: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_username", ["username"]),
});
