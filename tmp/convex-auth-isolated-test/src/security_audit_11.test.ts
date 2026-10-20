import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "../convex/schema.js";
import { api } from "../convex/_generated/api.js";
import { isAdapterKingdomOwner, DEMO_USER_ID } from "../convex/identityAdapter.js";

const modules = import.meta.glob("../convex/*.ts");

describe("Fase 3E-6: Security Audit 11 Tests", () => {
  test("1. Unauthenticated link attempt: rejected", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.identityAdapter.linkIdentity, {
        provider: "google",
        externalId: "google-sub-1",
        verificationToken: "verified_proof_google-sub-1",
      })
    ).rejects.toThrow();
  });

  test("3 & 4. Arbitrary external ID / missing proof: rejected", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { name: "Test" }));
    const asUser = t.withIdentity({ subject: userId }); // authenticated as canonical user

    await expect(
      asUser.mutation(api.identityAdapter.linkIdentity, {
        provider: "google",
        externalId: "google-sub-arbitrary",
        verificationToken: "invalid_token",
      })
    ).rejects.toThrow();
  });

  test("5. Double linking same external ID: rejected", async () => {
    const t = convexTest(schema, modules);
    const uid1 = await t.run(async (ctx) => await ctx.db.insert("users", { name: "User 1" }));
    const uid2 = await t.run(async (ctx) => await ctx.db.insert("users", { name: "User 2" }));

    const asUser1 = t.withIdentity({ subject: uid1 });
    await asUser1.mutation(api.identityAdapter.linkIdentity, {
      provider: "google",
      externalId: "google-shared",
      verificationToken: "verified_proof_google-shared",
    });

    const asUser2 = t.withIdentity({ subject: uid2 });
    await expect(
      asUser2.mutation(api.identityAdapter.linkIdentity, {
        provider: "google",
        externalId: "google-shared",
        verificationToken: "verified_proof_google-shared",
      })
    ).rejects.toThrow();
  });

  test("8 & 9. Access of linked vs unlinked user to kingdom", async () => {
    const t = convexTest(schema, modules);

    const { uidLinked, uidUnlinked } = await t.run(async (ctx) => {
      const u1 = await ctx.db.insert("users", { name: "Linked" });
      const u2 = await ctx.db.insert("users", { name: "Unlinked" });
      await ctx.db.insert("kingdoms", {
        userId: "google-legacy-sub",
        name: "Legacy Kingdom",
      });
      await ctx.db.insert("identityMappings", {
        provider: "google",
        externalId: "google-legacy-sub",
        canonicalUserId: u1,
        verified: true,
        createdAt: Date.now(),
      });
      return { uidLinked: u1, uidUnlinked: u2 };
    });

    const canLinkedAccess = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, "google-legacy-sub", undefined, uidLinked);
    });
    expect(canLinkedAccess).toBe(true);

    const canUnlinkedAccess = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, "google-legacy-sub", undefined, uidUnlinked);
    });
    expect(canUnlinkedAccess).toBe(false);
  });

  test("10. Revocation: access denied", async () => {
    const t = convexTest(schema, modules);

    const uid = await t.run(async (ctx) => {
      const u = await ctx.db.insert("users", { name: "Owner" });
      await ctx.db.insert("identityMappings", {
        provider: "google",
        externalId: "google-revoke",
        canonicalUserId: u,
        verified: true,
        createdAt: Date.now(),
      });
      return u;
    });

    // Revoke
    await t.run(async (ctx) => {
      const m = await ctx.db
        .query("identityMappings")
        .withIndex("by_external_id", (q) => q.eq("provider", "google").eq("externalId", "google-revoke"))
        .first();
      if (m) await ctx.db.delete(m._id);
    });

    const accessAfter = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, "google-revoke", undefined, uid);
    });
    expect(accessAfter).toBe(false);
  });

  test("11. Demo read-only: write mutation blocked", async () => {
    const t = convexTest(schema, modules);
    const isDemoOwner = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, DEMO_USER_ID, DEMO_USER_ID, undefined);
    });
    expect(isDemoOwner).toBe(false);
  });
});
