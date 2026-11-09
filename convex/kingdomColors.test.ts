import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { pickRandomUniqueColor } from "./kingdomColors";

const ensureKingdomColorsRef = makeFunctionReference<"mutation">("kingdomColors:ensureKingdomColors");
const getKingdomColorsRef = makeFunctionReference<"query">("kingdomColors:getKingdomColors");

describe("SISTEMA DE COLORES ÚNICOS Y LEYENDA (Bloque 6)", () => {
  test("1. pickRandomUniqueColor genera colores hexadecimales válidos y sin duplicados", () => {
    const used = new Set<string>();
    const countToPick = 20;

    for (let i = 0; i < countToPick; i++) {
      const color = pickRandomUniqueColor(used);
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(used.has(color.toLowerCase())).toBe(false);
      used.add(color.toLowerCase());
    }

    expect(used.size).toBe(countToPick);
  });

  test("2. ensureAllKingdomsHaveColors asigna de forma persistente e idempotente colores únicos a reinos sin color", async () => {
    const t = convexTest(schema);

    // Crear 3 reinos sin color
    const k1 = await t.run(async (ctx) => {
      return await ctx.db.insert("kingdoms", { userId: "u1", name: "Reino Alfa" });
    });
    const k2 = await t.run(async (ctx) => {
      return await ctx.db.insert("kingdoms", { userId: "u2", name: "Reino Beta" });
    });
    const k3 = await t.run(async (ctx) => {
      return await ctx.db.insert("kingdoms", { userId: "u3", name: "Reino Gamma" });
    });

    // Primera asignación
    const res1 = (await t.mutation(ensureKingdomColorsRef, {})) as any;
    expect(res1.success).toBe(true);
    expect(res1.assignedCount).toBe(3);

    const kingdom1 = await t.run(async (ctx) => await ctx.db.get(k1));
    const kingdom2 = await t.run(async (ctx) => await ctx.db.get(k2));
    const kingdom3 = await t.run(async (ctx) => await ctx.db.get(k3));

    expect(kingdom1!.color).toBeDefined();
    expect(kingdom2!.color).toBeDefined();
    expect(kingdom3!.color).toBeDefined();

    // Comprobar que no hay duplicados
    const colors = new Set([kingdom1!.color, kingdom2!.color, kingdom3!.color]);
    expect(colors.size).toBe(3);

    // Segunda asignación (idempotente)
    const res2 = (await t.mutation(ensureKingdomColorsRef, {})) as any;
    expect(res2.assignedCount).toBe(0);

    const kingdom1After = await t.run(async (ctx) => await ctx.db.get(k1));
    expect(kingdom1After!.color).toBe(kingdom1!.color); // Inmutable
  });

  test("3. getKingdomColors devuelve la leyenda cartográfica completa con conteo de provincias", async () => {
    const t = convexTest(schema);

    const kId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("kingdoms", { userId: "u_legend", name: "Imperio del Sol", color: "#e11d48", monarchName: "Soberano Y" });
      await ctx.db.insert("territories", { cellId: "0,0", q: 0, r: 0, terrain: "llanura", ownerKingdomId: id, isHome: true });
      await ctx.db.insert("territories", { cellId: "1,0", q: 1, r: 0, terrain: "bosque", ownerKingdomId: id, isHome: false });
      return id;
    });

    const legend = (await t.query(getKingdomColorsRef, {})) as any;
    expect(legend[String(kId)]).toBeDefined();
    expect(legend[String(kId)].name).toBe("Imperio del Sol");
    expect(legend[String(kId)].color).toBe("#e11d48");
    expect(legend[String(kId)].territoryCount).toBe(2);
  });
});
