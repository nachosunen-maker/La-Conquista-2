import { convexTest } from "convex-test";
import { test, expect, describe } from "vitest";
import schema from "../convex/schema.js";
import { api } from "../convex/_generated/api.js";

const modules = import.meta.glob("../convex/*.ts");

describe("Fase 3E-7: Final Audit", () => {
  test("1. linkIdentity rejects without implementation", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.identityAdapter.linkIdentity, {
        provider: "google",
        externalId: "some-sub",
      })
    ).rejects.toThrow("NO APTO");
  });
});
