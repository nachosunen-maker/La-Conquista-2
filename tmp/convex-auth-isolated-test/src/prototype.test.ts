import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "../convex/schema.js";
import { api } from "../convex/_generated/api.js";

const modules = import.meta.glob("../convex/*.ts");

describe("Fase 3F-0: Prototype Authentication Audit", () => {
  test("1. Password registration and sign-in", async () => {
    const t = convexTest(schema, modules);

    // Register
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "signUp",
        email: "test@local.auth",
        password: "Password123!",
        name: "TestUser",
      },
    });

    // Check identity
    const identity = await t.query(api.identity.getIdentity);
    expect(identity.status).toBe("authenticated");
    expect(identity.user?.name).toBe("TestUser");
  });

  test("2. Duplicate username prevention", async () => {
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
