import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "./convex/schema.js";
import { anyApi as api } from "convex/server";

const modules = import.meta.glob("./convex/*.ts");

describe("Convex Auth Password & Username Isolated Test", () => {
  test("user registration and sign-in with username", async () => {
    const t = convexTest(schema, modules);

    // 1. Check username availability before registration
    const availableBefore = await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", "reypelayo"))
        .first();
      return !existing;
    });
    expect(availableBefore).toBe(true);

    // 2. Register via Password provider (flow: "signUp")
    const signUpResult = await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "signUp",
        email: "reypelayo@local.auth",
        password: "SecurePassword123!",
        name: "ReyPelayo",
      },
    });
    expect(signUpResult).toHaveProperty("token");

    // 3. Verify user was created in users table
    const user = await t.run(async (ctx) => {
      return await ctx.db.query("users").first();
    });
    expect(user).toBeDefined();
    expect(user?.name).toBe("ReyPelayo");
    expect(user?.username).toBe("reypelayo");

    // 4. Test sign-in with correct password
    const signInResult = await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "signIn",
        email: "reypelayo@local.auth",
        password: "SecurePassword123!",
      },
    });
    expect(signInResult).toHaveProperty("token");
  });
});
