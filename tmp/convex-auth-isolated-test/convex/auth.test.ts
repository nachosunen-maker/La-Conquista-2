import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "./schema.js";
import { api } from "./_generated/api.js";
import schemaAuth from "./auth.js";

const modules = import.meta.glob("./*.ts");

describe("Convex Auth Password Provider & Username Tests", () => {
  test("1. Schema contains auth tables and users table with username index", async () => {
    const t = convexTest(schema, modules);
    const db = t.db;
    // Check if we can query users by username index
    const users = await db.query("users").withIndex("username").collect();
    expect(users).toEqual([]);
  });

  test("2. Register new user with username and password", async () => {
    const t = convexTest(schema, modules);
    
    // Call signIn action with flow: "signUp"
    const result = await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        username: "Alfonso_I",
        password: "securePassword123",
        flow: "signUp",
      },
    });

    expect(result).toHaveProperty("token");
    
    // Verify user was created in DB with normalized username and synthetic email
    const user = await t.run(async (ctx) => {
      return await ctx.db
        .query("users")
        .withIndex("username", (q) => q.eq("username", "alfonso_i"))
        .first();
    });

    expect(user).toBeDefined();
    expect(user?.name).toBe("Alfonso_I");
    expect(user?.username).toBe("alfonso_i");
    expect(user?.email).toBe("alfonso_i@local.conquista.game");

    // Test getAuthUserId with the returned token
    const authedT = t.withIdentity({ token: result.token });
    const viewer = await authedT.query(api.game.viewer);
    expect(viewer).toBeDefined();
    expect(viewer?._id).toBe(user?._id);
  });

  test("3. Reject duplicate username (case-insensitive)", async () => {
    const t = convexTest(schema, modules);

    // Register first user
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        username: "Castilla",
        password: "password123",
        flow: "signUp",
      },
    });

    // Try registering with same username in different case ("CASTILLA" or "castilla")
    let errorThrown = false;
    try {
      await t.action(api.auth.signIn, {
        provider: "password",
        params: {
          username: "CASTILLA",
          password: "otherPassword456",
          flow: "signUp",
        },
      });
    } catch (err) {
      errorThrown = true;
    }

    expect(errorThrown).toBe(true);

    // Check availability query
    const isAvailable = await t.query(api.game.checkUsernameAvailable, { username: "castilla" });
    expect(isAvailable).toBe(false);
  });

  test("4. Correct login and incorrect password rejection", async () => {
    const t = convexTest(schema, modules);

    // Register user
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        username: "Aragon",
        password: "correctPassword",
        flow: "signUp",
      },
    });

    // Try login with incorrect password
    let loginFailed = false;
    try {
      await t.action(api.auth.signIn, {
        provider: "password",
        params: {
          username: "Aragon",
          password: "wrongPassword",
          flow: "signIn",
        },
      });
    } catch (err) {
      loginFailed = true;
    }
    expect(loginFailed).toBe(true);

    // Login with correct password
    const loginResult = await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        username: "Aragon",
        password: "correctPassword",
        flow: "signIn",
      },
    });

    expect(loginResult).toHaveProperty("token");

    const authedT = t.withIdentity({ token: loginResult.token });
    const viewer = await authedT.query(api.game.viewer);
    expect(viewer?.username).toBe("aragon");
  });
});
