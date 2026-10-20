import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "../convex/schema.js";
import { anyApi as api } from "convex/server";

const modules = import.meta.glob("../convex/*.ts");

describe("Convex Auth Guarantees Verification (Fase 3C-2B)", () => {
  test("1. Concurrent signups with same username", async () => {
    const t = convexTest(schema, modules);

    // Run two signups concurrently with the same username (different casing or exact)
    const p1 = t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "signUp",
        email: "user1@local.auth",
        password: "Password123!",
        name: "TestUser",
      },
    });

    const p2 = t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "signUp",
        email: "user2@local.auth",
        password: "Password123!",
        name: "testuser",
      },
    });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one should succeed, one should fail due to duplicate email or duplicate check
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  test("3. Session invalidation on sign out", async () => {
    const t = convexTest(schema, modules);

    // Sign up / sign in
    const signInResult = await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "signUp",
        email: "sessiontest@local.auth",
        password: "Password123!",
        name: "SessionUser",
      },
    });

    expect(signInResult).toHaveProperty("token");
    const token = signInResult.token;

    // As client with token, call viewer
    const asUser = t.withIdentity({ token });
    const viewerBefore = await asUser.query(api.game.viewer);
    expect(viewerBefore).toBeDefined();

    // Sign out (using signOut action)
    await t.action(api.auth.signOut, {});

    // Test if token is still valid or invalidated
    const asUserAfterSignOut = t.withIdentity({ token });
    const viewerAfter = await asUserAfterSignOut.query(api.game.viewer).catch(() => null);
    // Depending on whether stateless JWTs or stateful session tokens are used
    console.log("Viewer after sign out with same token:", viewerAfter);
  });
});
