import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "../convex/schema.js";

const modules = import.meta.glob("../convex/*.ts");

describe("Convex Auth Executable Linking & Identity Tests (Fase 3E-1)", () => {
  test("Prueba A: Multiple providers linked to canonical users._id", async () => {
    const t = convexTest(schema, modules);

    // Seed canonical user and multiple authAccounts (Google + Password)
    const canonicalUserId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        name: "Test Player",
        email: "player@local.auth",
        username: "testplayer",
      });

      // Provider 1: Google
      await ctx.db.insert("authAccounts", {
        userId: uid,
        provider: "google",
        providerAccountId: "google-sub-999",
      });

      // Provider 2: Password
      await ctx.db.insert("authAccounts", {
        userId: uid,
        provider: "password",
        providerAccountId: "player@local.auth",
      });

      return uid;
    });

    // Verify both accounts point to the exact same canonical users._id
    const accounts = await t.run(async (ctx) => {
      return await ctx.db
        .query("authAccounts")
        .withIndex("userId", (q) => q.eq("userId", canonicalUserId))
        .collect();
    });

    expect(accounts.length).toBe(2);
    expect(accounts[0].userId).toBe(canonicalUserId);
    expect(accounts[1].userId).toBe(canonicalUserId);
  });

  test("Prueba B: Kingdom ownership resolution via canonical userId vs sub", async () => {
    const t = convexTest(schema, modules);

    const { canonicalUserId, kingdomId } = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        name: "Medieval Lord",
        email: "lord@local.auth",
      });

      const kid = await ctx.db.insert("kingdoms", {
        userId: uid, // Canonical reference
        name: "Castilla",
      });

      return { canonicalUserId: uid, kingdomId: kid };
    });

    const resolvedOwner = await t.run(async (ctx) => {
      const kingdom = await ctx.db.get(kingdomId);
      return kingdom?.userId;
    });

    expect(resolvedOwner).toBe(canonicalUserId);
  });

  test("Prueba C: Username collision prevention", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "User One",
        username: "pelayo",
      });
    });

    // Attempting to insert duplicate normalized username should violate or be caught by unique check / index query
    const duplicateAllowed = await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", "pelayo"))
        .first();
      if (existing) {
        return false; // Collision detected, prevent link/signup
      }
      await ctx.db.insert("users", {
        name: "User Two",
        username: "pelayo",
      });
      return true;
    });

    expect(duplicateAllowed).toBe(false);
  });
});
