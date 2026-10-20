import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "./convex/schema.js";
import { anyApi as api } from "convex/server";

const modules = import.meta.glob("./convex/*.ts");

describe("Convex Auth Password Provider & Username Tests", () => {
  test("1. Schema contains auth tables and users table with username index", async () => {
    const t = convexTest(schema, modules);
    const db = t.db;
    const users = await db.query("users").withIndex("username").collect();
    expect(users).toEqual([]);
  });

  test("2. Register new user with username and password", async () => {
    const t = convexTest(schema, modules);
    
    const result = await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        username: "Alfonso_I",
        password: "securePassword123",
        flow: "signUp",
      },
    });

    expect(result).toHaveProperty("token");
    
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

    const authedT = t.withIdentity({ token: result.token });
    const viewer = await authedT.query(api.game.viewer);
    expect(viewer).toBeDefined();
    expect(viewer?._id).toBe(user?._id);
  });

  test("3. Reject duplicate username (case-insensitive)", async () => {
    const t = convexTest(schema, modules);

    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        username: "Castilla",
        password: "password123",
        flow: "signUp",
      },
    });

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

    const isAvailable = await t.query(api.game.checkUsernameAvailable, { username: "castilla" });
    expect(isAvailable).toBe(false);
  });

  test("4. Correct login and incorrect password rejection", async () => {
    const t = convexTest(schema, modules);

    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        username: "Aragon",
        password: "correctPassword",
        flow: "signUp",
      },
    });

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
