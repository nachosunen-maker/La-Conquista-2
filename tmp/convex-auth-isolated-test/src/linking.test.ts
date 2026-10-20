import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "../convex/schema.js";
import { anyApi as api } from "convex/server";

const modules = import.meta.glob("../convex/*.ts");

describe("Convex Auth Identity Linking Test (Fase 3E-0)", () => {
  test("simulate linking password credentials to existing Google user account", async () => {
    const t = convexTest(schema, modules);

    // 1. Simulate a user signing in via Google (provider: "google")
    // In convex-test, we can inspect how auth accounts are created or seed a user directly if needed,
    // or test the signIn action with google provider if configured.
    // Let's test the database structure for authAccounts.

    const userId = await t.run(async (ctx) => {
      // Create user and authAccount simulating a Google login
      const uid = await ctx.db.insert("users", {
        name: "GoogleUser",
        email: "googleuser@gmail.com",
      });

      await ctx.db.insert("authAccounts", {
        userId: uid,
        provider: "google",
        providerAccountId: "google-sub-12345",
      });

      // Create a kingdom owned by this user's ID (or sub)
      await ctx.db.insert("kingdoms", {
        userId: uid, // Canonic userId reference
        name: "Iberia Google",
      });

      return uid;
    });

    expect(userId).toBeDefined();

    // 2. Test linking password credentials to this existing user ID
    // We want to verify if we can insert an authAccount for provider "password" linked to the same userId.
    const linked = await t.run(async (ctx) => {
      // Check if user exists
      const user = await ctx.db.get(userId);
      if (!user) return false;

      // Add password account mapping
      await ctx.db.insert("authAccounts", {
        userId: user._id,
        provider: "password",
        providerAccountId: "googleuser@gmail.com", // or email identifier
        secret: "hashed-password-placeholder",
      });

      return true;
    });

    expect(linked).toBe(true);

    // 3. Verify that both authAccounts point to the exact same canonical userId
    const accounts = await t.run(async (ctx) => {
      return await ctx.db
        .query("authAccounts")
        .withIndex("userId", (q) => q.eq("userId", userId))
        .collect();
    });

    expect(accounts.length).toBe(2);
    expect(accounts[0].provider).toBe("google");
    expect(accounts[1].provider).toBe("password");
    expect(accounts[0].userId).toBe(accounts[1].userId);

    // 4. Verify kingdom ownership remains intact via canonical userId
    const kingdom = await t.run(async (ctx) => {
      return await ctx.db
        .query("kingdoms")
        .filter((q) => q.eq(q.field("userId"), userId))
        .first();
    });

    expect(kingdom).toBeDefined();
    expect(kingdom?.name).toBe("Iberia Google");
  });
});
