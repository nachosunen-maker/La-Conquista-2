import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "../convex/schema.js";
import { api } from "../convex/_generated/api.js";
import { isAdapterKingdomOwner, DEMO_USER_ID } from "../convex/identityAdapter.js";

const modules = import.meta.glob("../convex/*.ts");

describe("Fase 3E-5: Reproducible Identity Adapter Audit", () => {
  test("1. Uniqueness mechanism: prevent duplicate provider/externalId mappings", async () => {
    const t = convexTest(schema, modules);

    const uid1 = await t.run(async (ctx) => await ctx.db.insert("users", { name: "User 1" }));
    const uid2 = await t.run(async (ctx) => await ctx.db.insert("users", { name: "User 2" }));

    // First link succeeds
    await t.mutation(api.identityAdapter.linkIdentity, {
      provider: "google",
      externalId: "google-sub-audit-1",
      canonicalUserId: uid1,
    });

    // Second link with same externalId fails due to transaction check
    await expect(
      t.mutation(api.identityAdapter.linkIdentity, {
        provider: "google",
        externalId: "google-sub-audit-1",
        canonicalUserId: uid2,
      })
    ).rejects.toThrow();
  });

  test("2. Kingdom Authorization & Revocation Scenario", async () => {
    const t = convexTest(schema, modules);

    const { canonicalUserId } = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { name: "Audit Lord" });
      await ctx.db.insert("kingdoms", {
        userId: "google-sub-audit-legacy",
        name: "Legacy Audit Kingdom",
      });
      await ctx.db.insert("identityMappings", {
        provider: "google",
        externalId: "google-sub-audit-legacy",
        canonicalUserId: uid,
        verified: true,
        createdAt: Date.now(),
      });
      return { canonicalUserId: uid };
    });

    // Before revocation: canonical user is owner
    const ownerBefore = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, "google-sub-audit-legacy", undefined, canonicalUserId);
    });
    expect(ownerBefore).toBe(true);

    // Revoke mapping
    await t.run(async (ctx) => {
      const mapping = await ctx.db
        .query("identityMappings")
        .withIndex("by_external_id", (q) =>
          q.eq("provider", "google").eq("externalId", "google-sub-audit-legacy")
        )
        .first();
      if (mapping) {
        await ctx.db.delete(mapping._id);
      }
    });

    // After revocation: access denied for canonical user
    const ownerAfter = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, "google-sub-audit-legacy", undefined, canonicalUserId);
    });
    expect(ownerAfter).toBe(false);

    // Original legacy Google sub still retains access
    const legacyOwner = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, "google-sub-audit-legacy", "google-sub-audit-legacy", undefined);
    });
    expect(legacyOwner).toBe(true);
  });

  test("3. Demo read-only strictness", async () => {
    const t = convexTest(schema, modules);

    const isDemoOwner = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, DEMO_USER_ID, DEMO_USER_ID, undefined);
    });

    expect(isDemoOwner).toBe(false); // Demo never has write ownership
  });
});
