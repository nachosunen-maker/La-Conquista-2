import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "../convex/schema.js";
import { api } from "../convex/_generated/api.js";
import { isAdapterKingdomOwner } from "../convex/identityAdapter.js";

const modules = import.meta.glob("../convex/*.ts");

describe("Adversarial Identity Adapter Tests (Fase 3E-4)", () => {
  test("1. Prevent duplicate or conflicting identity mappings", async () => {
    const t = convexTest(schema, modules);

    const uid1 = await t.run(async (ctx) => await ctx.db.insert("users", { name: "User 1" }));
    const uid2 = await t.run(async (ctx) => await ctx.db.insert("users", { name: "User 2" }));

    // First link should succeed
    await t.mutation(api.identityAdapter.linkIdentity, {
      provider: "google",
      externalId: "google-sub-shared",
      canonicalUserId: uid1,
    });

    // Second link with same externalId should fail
    await expect(
      t.mutation(api.identityAdapter.linkIdentity, {
        provider: "google",
        externalId: "google-sub-shared",
        canonicalUserId: uid2,
      })
    ).rejects.toThrow();
  });

  test("4. Revocation of mapping revokes access to legacy kingdom", async () => {
    const t = convexTest(schema, modules);

    const { canonicalUserId } = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { name: "Revoked Lord" });
      await ctx.db.insert("kingdoms", {
        userId: "google-sub-revocable",
        name: "Legacy Kingdom",
      });
      const mapId = await ctx.db.insert("identityMappings", {
        provider: "google",
        externalId: "google-sub-revocable",
        canonicalUserId: uid,
        verified: true,
        createdAt: Date.now(),
      });
      return { canonicalUserId: uid, mapId };
    });

    // Before revocation: access granted
    const ownerBefore = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, "google-sub-revocable", undefined, canonicalUserId);
    });
    expect(ownerBefore).toBe(true);

    // Revoke mapping (delete or mark unverified)
    await t.run(async (ctx) => {
      const mapping = await ctx.db
        .query("identityMappings")
        .withIndex("by_external_id", (q) =>
          q.eq("provider", "google").eq("externalId", "google-sub-revocable")
        )
        .first();
      if (mapping) {
        await ctx.db.delete(mapping._id);
      }
    });

    // After revocation: access denied
    const ownerAfter = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, "google-sub-revocable", undefined, canonicalUserId);
    });
    expect(ownerAfter).toBe(false);
  });
});
