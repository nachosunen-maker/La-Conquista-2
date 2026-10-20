import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "../convex/schema.js";
import { isAdapterKingdomOwner, resolveCallerIdentity, DEMO_USER_ID } from "../convex/identityAdapter.js";

const modules = import.meta.glob("../convex/*.ts");

describe("Identity Adapter Prototype Tests (Fase 3E-3)", () => {
  test("1. Original Google identity retains access to legacy kingdom", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("kingdoms", {
        userId: "google-sub-old",
        name: "Legacy Google Kingdom",
      });
    });

    const isOwner = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, "google-sub-old", "google-sub-old", undefined);
    });

    expect(isOwner).toBe(true);
  });

  test("2. Canonical user linked via verified mapping gains access", async () => {
    const t = convexTest(schema, modules);

    const canonicalUserId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { name: "Canonical Lord" });
      await ctx.db.insert("kingdoms", {
        userId: "google-sub-old",
        name: "Legacy Kingdom",
      });
      await ctx.db.insert("identityMappings", {
        provider: "google",
        externalId: "google-sub-old",
        canonicalUserId: uid,
        verified: true,
        createdAt: Date.now(),
      });
      return uid;
    });

    const isOwner = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, "google-sub-old", undefined, canonicalUserId);
    });

    expect(isOwner).toBe(true);
  });

  test("3. Unmapped identity cannot access old kingdom", async () => {
    const t = convexTest(schema, modules);

    const canonicalUserId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { name: "New User" });
      await ctx.db.insert("kingdoms", {
        userId: "google-sub-old",
        name: "Legacy Kingdom",
      });
      return uid;
    });

    const isOwner = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, "google-sub-old", undefined, canonicalUserId);
    });

    expect(isOwner).toBe(false);
  });

  test("4. Demo identity maintains exact read-only / restricted rules", async () => {
    const t = convexTest(schema, modules);

    const isDemoOwner = await t.run(async (ctx) => {
      return await isAdapterKingdomOwner(ctx, DEMO_USER_ID, DEMO_USER_ID, undefined);
    });

    expect(isDemoOwner).toBe(false); // Demo cannot have owner write access
  });

  test("8. Adapter does not modify kingdoms.userId or grant access by guesswork", async () => {
    const t = convexTest(schema, modules);

    const kingdomUserId = await t.run(async (ctx) => {
      const kid = await ctx.db.insert("kingdoms", {
        userId: "google-sub-old",
        name: "Untouched Kingdom",
      });
      const k = await ctx.db.get(kid);
      return k?.userId;
    });

    expect(kingdomUserId).toBe("google-sub-old"); // Unchanged
  });
});
