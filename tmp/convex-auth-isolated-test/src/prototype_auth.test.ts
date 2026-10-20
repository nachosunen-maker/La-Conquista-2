import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "../convex/schema.js";
import { api } from "../convex/_generated/api.js";

const modules = import.meta.glob("../convex/*.ts");

describe("Fase 3F-1: Password Auth Prototype", () => {
  test("1. Registration and sign-in with username", async () => {
    const t = convexTest(schema, modules);

    // Register
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "signUp",
        email: "testuser@local.auth",
        password: "Password123!",
        name: "TestUser",
      },
    });

    // Check identity
    const identity = await t.query(api.identity.getIdentity);
    expect(identity.status).toBe("authenticated");
    expect(identity.user?.name).toBe("TestUser");
  });

  test("2. Duplicate name prevention (case-insensitive)", async () => {
    const t = convexTest(schema, modules);

    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "signUp",
        email: "u1@local.auth",
        password: "Password123!",
        name: "Pelayo",
      },
    });

    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          flow: "signUp",
          email: "u2@local.auth",
          password: "Password123!",
          name: "PELAYO",
        },
      })
    ).rejects.toThrow();
  });
});
