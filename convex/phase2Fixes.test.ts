import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAP, PARLIAMENT } from "./balanceConfig";
import { researchSlots } from "./technologyRules";

const modules = import.meta.glob("./**/*.ts");
const T0 = Date.UTC(2026, 9, 17, 12, 0, 0);

function createTestBackend() {
  return convexTest(schema, modules);
}

function identity(subject: string) {
  return {
    subject,
    tokenIdentifier: `https://accounts.google.com|${subject}`,
    issuer: "https://accounts.google.com",
  };
}

async function foundKingdom(
  t: ReturnType<typeof createTestBackend>,
  subject: string,
  name: string,
  civilization = "romanos"
) {
  const asUser = t.withIdentity(identity(subject));
  const kingdom = await asUser.mutation(api.economy.getOrInitializeKingdom, {
    name,
    civilization,
    castleName: `Castillo de ${name}`,
    monarchName: `Monarca de ${name}`,
  });
  return { asUser, kingdomId: kingdom._id as Id<"kingdoms"> };
}

async function setBuilding(
  t: ReturnType<typeof createTestBackend>,
  kingdomId: Id<"kingdoms">,
  buildingType: string,
  level: number
) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("buildings")
      .withIndex("by_kingdom", (q) => q.eq("kingdomId", kingdomId))
      .collect();
    const doc = existing.find((b) => b.buildingType === buildingType);
    if (doc) await ctx.db.patch(doc._id, { level });
    else await ctx.db.insert("buildings", { kingdomId, buildingType, level });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Corrección 1 — Parlamento y fechas de combate (P38)", () => {
  test("rechaza desafío ACCEPTED con scheduledAt futuro, sin scheduledAt, FROZEN, REJECTED, EXPIRED, RESOLVED, reinos distintos y reutilización", async () => {
    const t = createTestBackend();
    const atk = await foundKingdom(t, "p38-atk", "Reino Atacante");
    const def = await foundKingdom(t, "p38-def", "Reino Defensor");
    const third = await foundKingdom(t, "p38-third", "Reino Tercero");

    await atk.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: atk.kingdomId });
    await def.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: def.kingdomId });
    await third.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: third.kingdomId });

    const defT = await def.asUser.query(api.territories.getKingdomTerritories, { kingdomId: def.kingdomId });
    const defCapital = defT.homeTerritoryId!;

    await setBuilding(t, atk.kingdomId, "parlamento", 1);
    await setBuilding(t, def.kingdomId, "parlamento", 1);
    await setBuilding(t, third.kingdomId, "parlamento", 1);

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: atk.kingdomId, unitType: "infanteria", level: 1, count: 600 });
      await ctx.db.insert("armyUnits", { kingdomId: def.kingdomId, unitType: "infanteria", level: 1, count: 100 });
      await ctx.db.insert("exploredTerritories", { kingdomId: atk.kingdomId, cellId: defCapital, discoveredAt: T0 });
      const pop = await ctx.db.query("population").filter((q) => q.eq(q.field("kingdomId"), atk.kingdomId)).first();
      if (pop) await ctx.db.patch(pop._id, { total: pop.total + 600 });
    });

    // 1. Flujo real: crear y aceptar desafío en Parlamento -> scheduledAt futuro -> launchAttack RECHAZADO
    const created = await atk.asUser.mutation(api.parliament.createChallenge, {
      challengerKingdomId: atk.kingdomId,
      targetKingdomId: def.kingdomId,
      challengeType: "batalla",
    });
    const accepted = await def.asUser.mutation(api.parliament.acceptChallenge, {
      kingdomId: def.kingdomId,
      challengeId: created.challengeId,
      window: "proxima",
    });
    expect(accepted.scheduledAt).toBeGreaterThan(T0);

    await expect(
      atk.asUser.mutation(api.army.launchAttack, {
        kingdomId: atk.kingdomId,
        cellId: defCapital,
        units: [{ unitType: "infanteria", level: 1, count: 100 }],
      })
    ).rejects.toThrow(/aún no ha llegado la fecha y hora programadas/i);

    // 2. Estado FROZEN no autoriza ataque manual
    await t.run(async (ctx) => {
      await ctx.db.patch(created.challengeId, { status: "FROZEN", frozenAt: accepted.freezeAt });
    });
    await expect(
      atk.asUser.mutation(api.army.launchAttack, {
        kingdomId: atk.kingdomId,
        cellId: defCapital,
        units: [{ unitType: "infanteria", level: 1, count: 100 }],
      })
    ).rejects.toThrow(/FROZEN/i);

    // 3. Desafío sin scheduledAt (corrupto/incompleto): rechazado
    await t.run(async (ctx) => {
      await ctx.db.patch(created.challengeId, { status: "ACCEPTED", scheduledAt: undefined });
    });
    await expect(
      atk.asUser.mutation(api.army.launchAttack, {
        kingdomId: atk.kingdomId,
        cellId: defCapital,
        units: [{ unitType: "infanteria", level: 1, count: 100 }],
      })
    ).rejects.toThrow(/programación temporal válida/i);

    // 4. Desafío REJECTED: rechazado
    await t.run(async (ctx) => {
      await ctx.db.patch(created.challengeId, { status: "REJECTED", scheduledAt: T0 });
    });
    await expect(
      atk.asUser.mutation(api.army.launchAttack, {
        kingdomId: atk.kingdomId,
        cellId: defCapital,
        units: [{ unitType: "infanteria", level: 1, count: 100 }],
      })
    ).rejects.toThrow(/Procedimiento de Parlamento requerido \(P38\)/i);

    // 5. Desafío EXPIRED: rechazado
    await t.run(async (ctx) => {
      await ctx.db.patch(created.challengeId, { status: "EXPIRED" });
    });
    await expect(
      atk.asUser.mutation(api.army.launchAttack, {
        kingdomId: atk.kingdomId,
        cellId: defCapital,
        units: [{ unitType: "infanteria", level: 1, count: 100 }],
      })
    ).rejects.toThrow(/Procedimiento de Parlamento requerido \(P38\)/i);

    // 6. Desafío entre reinos distintos (atk -> third, no def): rechazado al atacar a def
    await t.run(async (ctx) => {
      await ctx.db.insert("challenges", {
        challengerKingdomId: atk.kingdomId,
        targetKingdomId: third.kingdomId,
        challengeType: "batalla",
        status: "ACCEPTED",
        createdAt: T0 - 90_000_000,
        expiresAt: T0 + 86_400_000,
        respondedAt: T0 - 86_400_000,
        window: "proxima",
        freezeAt: T0 - 900_000,
        scheduledAt: T0,
      });
    });
    await expect(
      atk.asUser.mutation(api.army.launchAttack, {
        kingdomId: atk.kingdomId,
        cellId: defCapital,
        units: [{ unitType: "infanteria", level: 1, count: 100 }],
      })
    ).rejects.toThrow(/Procedimiento de Parlamento requerido \(P38\)/i);

    // 7. Cuando llega scheduledAt en un desafío ACCEPTED válido: permite el ataque UNA SOLA VEZ y bloquea reutilización
    await t.run(async (ctx) => {
      await ctx.db.patch(created.challengeId, {
        status: "ACCEPTED",
        scheduledAt: accepted.scheduledAt,
        freezeAt: accepted.freezeAt,
        window: "proxima",
      });
    });
    vi.setSystemTime(accepted.scheduledAt + 1000);

    const march1 = await atk.asUser.mutation(api.army.launchAttack, {
      kingdomId: atk.kingdomId,
      cellId: defCapital,
      units: [{ unitType: "infanteria", level: 1, count: 150 }],
    });
    expect(march1.success).toBe(true);

    // Intento inmediato de reutilizar el mismo desafío mientras marcha está activa: RECHAZADO
    await expect(
      atk.asUser.mutation(api.army.launchAttack, {
        kingdomId: atk.kingdomId,
        cellId: defCapital,
        units: [{ unitType: "infanteria", level: 1, count: 150 }],
      })
    ).rejects.toThrow(/ya fue utilizado o resuelto/i);

    // Completar marcha -> marca desafío como RESOLVED -> sigue bloqueando reutilización
    vi.setSystemTime(accepted.scheduledAt + 1000 + march1.durationSeconds * 1000 + 2000);
    await t.mutation(internal.army.completeMarchScheduled, { marchId: march1.marchId });

    const challengeAfter = await t.run(async (ctx) => ctx.db.get(created.challengeId));
    expect(challengeAfter?.status).toBe("RESOLVED");
    expect(challengeAfter?.battleId).toBeDefined();

    await expect(
      atk.asUser.mutation(api.army.launchAttack, {
        kingdomId: atk.kingdomId,
        cellId: defCapital,
        units: [{ unitType: "infanteria", level: 1, count: 100 }],
      })
    ).rejects.toThrow(/ya fue utilizado o resuelto/i);
  });

  test("conquista neutral adyacente sigue permitida sin Parlamento y resolución programada del Parlamento funciona", async () => {
    const t = createTestBackend();
    const atk = await foundKingdom(t, "p38-neut-atk", "Reino Expansivo");
    const def = await foundKingdom(t, "p38-neut-def", "Reino Rival");

    await atk.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: atk.kingdomId });
    await def.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: def.kingdomId });
    await setBuilding(t, atk.kingdomId, "parlamento", 1);
    await setBuilding(t, def.kingdomId, "parlamento", 1);

    await t.run(async (ctx) => {
      await ctx.db.insert("armyUnits", { kingdomId: atk.kingdomId, unitType: "infanteria", level: 1, count: 200 });
      await ctx.db.insert("armyUnits", { kingdomId: def.kingdomId, unitType: "infanteria", level: 1, count: 100 });
    });

    // Celda "1,0" es vecina inmediata de la capital "0,0" y conocida por visión inicial
    const neutralMarch = await atk.asUser.mutation(api.army.launchAttack, {
      kingdomId: atk.kingdomId,
      cellId: "1,0",
      units: [{ unitType: "infanteria", level: 1, count: 50 }],
    });
    expect(neutralMarch.success).toBe(true);

    // Flujo completo programado del Parlamento (create -> accept -> freeze -> resolve)
    const ch = await atk.asUser.mutation(api.parliament.createChallenge, {
      challengerKingdomId: atk.kingdomId,
      targetKingdomId: def.kingdomId,
      challengeType: "batalla",
    });
    const acc = await def.asUser.mutation(api.parliament.acceptChallenge, {
      kingdomId: def.kingdomId,
      challengeId: ch.challengeId,
      window: "proxima",
    });

    vi.setSystemTime(acc.scheduledAt + 5000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const finalCh = await t.run(async (ctx) => ctx.db.get(ch.challengeId));
    expect(finalCh?.status).toBe("RESOLVED");
    expect(finalCh?.battleId).toBeDefined();
  });
});

describe("Corrección 2 — Ranuras de investigación por nivel de Universidad (M-03 opción B / P25)", () => {
  test("respeta 0 ranuras sin Universidad, 1/2/3 por nivel y rechaza exceso en mutación directa y concurrencia", async () => {
    expect(researchSlots(0)).toBe(0);
    expect(researchSlots(1)).toBe(1);
    expect(researchSlots(2)).toBe(1);
    expect(researchSlots(3)).toBe(2);
    expect(researchSlots(4)).toBe(2);
    expect(researchSlots(5)).toBe(3);

    const t = createTestBackend();
    const k = await foundKingdom(t, "p25-univ", "Reino Académico");
    await t.run(async (ctx) => {
      const res = await ctx.db.query("resources").filter((q) => q.eq(q.field("kingdomId"), k.kingdomId)).first();
      if (res) await ctx.db.patch(res._id, { gold: 50_000, wood: 50_000, stone: 50_000, iron: 50_000, food: 50_000 });
    });

    // Sin Universidad: 0 ranuras y mutación rechazada
    const stateU0 = await k.asUser.query(api.technologies.getTechnologies, { kingdomId: k.kingdomId });
    expect(stateU0.slots).toBe(0);
    expect(stateU0.slotsFree).toBe(0);
    await expect(
      k.asUser.mutation(api.technologies.researchTechnology, { kingdomId: k.kingdomId, techType: "agri_1" })
    ).rejects.toThrow(/No hay ranuras de investigación libres/i);

    // Universidad nivel 1 -> 1 ranura; dos peticiones concurrentes por la última plaza: solo 1 triunfa
    await setBuilding(t, k.kingdomId, "universidad", 1);
    const stateU1 = await k.asUser.query(api.technologies.getTechnologies, { kingdomId: k.kingdomId });
    expect(stateU1.slots).toBe(1);

    const concurrent = await Promise.allSettled([
      k.asUser.mutation(api.technologies.researchTechnology, { kingdomId: k.kingdomId, techType: "agri_1" }),
      k.asUser.mutation(api.technologies.researchTechnology, { kingdomId: k.kingdomId, techType: "mining_1" }),
    ]);
    const fulfilled = concurrent.filter((r) => r.status === "fulfilled");
    const rejected = concurrent.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Universidad nivel 3 -> 2 ranuras; permite la segunda y bloquea la tercera
    await setBuilding(t, k.kingdomId, "universidad", 3);
    await setBuilding(t, k.kingdomId, "castillo", 3);
    const stateU3 = await k.asUser.query(api.technologies.getTechnologies, { kingdomId: k.kingdomId });
    expect(stateU3.slots).toBe(2);
    expect(stateU3.slotsFree).toBe(1);

    const secondTech = fulfilled[0].status === "fulfilled" && fulfilled[0].value.technologyId === "agri_1" ? "mining_1" : "agri_1";
    const r2 = await k.asUser.mutation(api.technologies.researchTechnology, { kingdomId: k.kingdomId, techType: secondTech });
    expect(r2.success).toBe(true);

    const thirdTech = stateU3.catalog.find(
      (c: any) => c.status === "available" && c.id !== "agri_1" && c.id !== "mining_1"
    );
    expect(thirdTech).toBeDefined();

    await expect(
      k.asUser.mutation(api.technologies.researchTechnology, { kingdomId: k.kingdomId, techType: thirdTech!.id })
    ).rejects.toThrow(/No hay ranuras de investigación libres/i);
  });
});

describe("Corrección 3 — Niebla de guerra coherente en getWorldMap y getWorldMapCompact", () => {
  test("impide eludir niebla vía consulta global, oculta celdas en exploración y filtra leyenda de reinos", async () => {
    const t = createTestBackend();
    const kA = await foundKingdom(t, "fog-a", "Reino Alfa");
    const kB = await foundKingdom(t, "fog-b", "Reino Beta");

    await kA.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: kA.kingdomId });
    await kB.asUser.mutation(api.territories.ensureMyHomeTerritory, { kingdomId: kB.kingdomId });

    const tB = await kB.asUser.query(api.territories.getKingdomTerritories, { kingdomId: kB.kingdomId });
    const capitalB = tB.homeTerritoryId!;

    // 1. Consulta global sin kingdomId en getWorldMap y getWorldMapCompact NO expone propietarios ni capitales
    const globalFull = await t.query(api.territories.getWorldMap, {});
    const globalCompact = await t.query(api.territories.getWorldMapCompact, {});

    expect(globalFull.kingdomLegend).toEqual([]);
    expect(globalFull.exploredCount).toBe(0);
    for (const cell of globalFull.cells) {
      expect(cell.ownerKingdomId).toBeNull();
      expect(cell.ownerName).toBeNull();
      expect(cell.isHome).toBe(false);
    }
    expect(globalCompact.visibleCells).toEqual([]);
    expect(globalCompact.kingdomLegend).toEqual([]);
    expect(globalCompact.exploredCount).toBe(0);

    // 2. Reino A no puede consultar la niebla de Reino B ni un anónimo la de A
    await expect(kA.asUser.query(api.territories.getWorldMap, { kingdomId: kB.kingdomId })).rejects.toThrow(/No autorizado/i);
    await expect(kA.asUser.query(api.territories.getWorldMapCompact, { kingdomId: kB.kingdomId })).rejects.toThrow(/No autorizado/i);
    await expect(t.query(api.territories.getWorldMap, { kingdomId: kA.kingdomId })).rejects.toThrow(/No autorizado/i);
    await expect(t.query(api.territories.getWorldMapCompact, { kingdomId: kA.kingdomId })).rejects.toThrow(/No autorizado/i);

    // 3. Capital enemiga no descubierta permanece oculta en ambas consultas y ausente de la leyenda
    const mapA = await kA.asUser.query(api.territories.getWorldMap, { kingdomId: kA.kingdomId });
    const compactA = await kA.asUser.query(api.territories.getWorldMapCompact, { kingdomId: kA.kingdomId });

    const capBInFull = mapA.cells.find((c) => c.cellId === capitalB);
    expect(capBInFull?.state).toBe("fog");
    expect(capBInFull?.ownerKingdomId).toBeNull();
    expect(capBInFull?.ownerName).toBeNull();
    expect(capBInFull?.isHome).toBe(false);
    expect(capBInFull?.terrain).toBe("desconocido");

    const capBInCompact = compactA.visibleCells.find((c) => c.cellId === capitalB);
    expect(capBInCompact).toBeUndefined();
    expect(mapA.kingdomLegend.some((k) => k.id === String(kB.kingdomId))).toBe(false);
    expect(compactA.kingdomLegend.some((k) => k.id === String(kB.kingdomId))).toBe(false);

    // 4. Celda en estado "exploring" (expedición en curso) NO filtra propietario ni terreno hasta completarse
    await t.run(async (ctx) => {
      await ctx.db.insert("territories", {
        cellId: "2,0",
        q: 2,
        r: 0,
        terrain: "montana",
        ownerKingdomId: kB.kingdomId,
        isHome: false,
      });
      await ctx.db.insert("armyUnits", { kingdomId: kA.kingdomId, unitType: "espia", level: 1, count: 2, isSpy: true });
      const res = await ctx.db.query("resources").filter((q) => q.eq(q.field("kingdomId"), kA.kingdomId)).first();
      if (res) await ctx.db.patch(res._id, { gold: 1000, food: 1000 });
    });

    await kA.asUser.mutation(api.territories.startExploration, { kingdomId: kA.kingdomId, cellId: "2,0", spiesCount: 1 });

    const mapDuring = await kA.asUser.query(api.territories.getWorldMap, { kingdomId: kA.kingdomId });
    const compactDuring = await kA.asUser.query(api.territories.getWorldMapCompact, { kingdomId: kA.kingdomId });

    const cellDuringFull = mapDuring.cells.find((c) => c.cellId === "2,0");
    const cellDuringCompact = compactDuring.visibleCells.find((c) => c.cellId === "2,0");
    expect(cellDuringFull?.state).toBe("exploring");
    expect(cellDuringFull?.ownerKingdomId).toBeNull();
    expect(cellDuringFull?.terrain).toBe("desconocido");
    expect(cellDuringCompact?.state).toBe("exploring");
    expect(cellDuringCompact?.ownerKingdomId).toBeNull();
    expect(cellDuringCompact?.terrain).toBe("desconocido");

    // 5. Tras descubrir por exploración/espionaje, ambas consultas muestran exactamente el territorio enemigo y la leyenda
    await t.run(async (ctx) => {
      await ctx.db.insert("exploredTerritories", { kingdomId: kA.kingdomId, cellId: capitalB, discoveredAt: T0 });
    });
    const mapAfter = await kA.asUser.query(api.territories.getWorldMap, { kingdomId: kA.kingdomId });
    const compactAfter = await kA.asUser.query(api.territories.getWorldMapCompact, { kingdomId: kA.kingdomId });

    const revealedFull = mapAfter.cells.find((c) => c.cellId === capitalB);
    const revealedCompact = compactAfter.visibleCells.find((c) => c.cellId === capitalB);
    expect(revealedFull?.state).toBe("explored");
    expect(String(revealedFull?.ownerKingdomId)).toBe(String(kB.kingdomId));
    expect(revealedFull?.isHome).toBe(true);
    expect(revealedCompact?.state).toBe("explored");
    expect(String(revealedCompact?.ownerKingdomId)).toBe(String(kB.kingdomId));
    expect(revealedCompact?.isHome).toBe(true);
    expect(mapAfter.kingdomLegend.some((k) => k.id === String(kB.kingdomId))).toBe(true);
    expect(compactAfter.kingdomLegend.some((k) => k.id === String(kB.kingdomId))).toBe(true);
  });
});

describe("Corrección 4 — Reducción del mapa unificada (MAP.RADIUS, dryRun, capitales protegidas e idempotencia)", () => {
  test("dryRun no persiste cambios, protege capitales, conserva celdas <= MAP.RADIUS y delegador es idéntico e idempotente", async () => {
    const t = createTestBackend();
    const k = await foundKingdom(t, "red-user", "Reino Frontera");

    await t.run(async (ctx) => {
      // Celda dentro de MAP.RADIUS (debe conservarse)
      await ctx.db.insert("territories", { cellId: "30,0", q: 30, r: 0, terrain: "llanura", ownerKingdomId: k.kingdomId, isHome: false });
      // Celda exterior normal (debe eliminarse)
      await ctx.db.insert("territories", { cellId: `${MAP.RADIUS + 2},0`, q: MAP.RADIUS + 2, r: 0, terrain: "bosque", ownerKingdomId: k.kingdomId, isHome: false });
      // Capital exterior (debe protegerse, nunca eliminarse)
      await ctx.db.insert("territories", { cellId: `${MAP.RADIUS + 3},0`, q: MAP.RADIUS + 3, r: 0, terrain: "llanura", ownerKingdomId: k.kingdomId, isHome: true });
      // Registro de exploración exterior
      await ctx.db.insert("exploredTerritories", { kingdomId: k.kingdomId, cellId: `${MAP.RADIUS + 2},0`, discoveredAt: T0 });
    });

    // 1. Simulación por defecto (dryRun=true) desde mapReduction y desde territories (delegador)
    const dryMain: any = await t.mutation(internal.mapReduction.executeMapReduction, {});
    const dryDeleg: any = await t.mutation(internal.territories.executeMapReduction, {});
    expect(dryMain).toEqual(dryDeleg);
    expect(dryMain.dryRun).toBe(true);
    expect(dryMain.radiusLimit).toBe(MAP.RADIUS);
    expect(dryMain.territoriesDeleted).toBe(1);
    expect(dryMain.protectedCapitals).toBe(1);
    expect(dryMain.explorationsDeleted).toBe(1);

    // Verificar que dryRun NO borró nada (capital inicial "0,0" + 3 celdas insertadas = 4)
    const countAfterDry = await t.run(async (ctx) => (await ctx.db.query("territories").collect()).length);
    expect(countAfterDry).toBe(4);

    // 2. Ejecución real (dryRun=false)
    const realRes: any = await t.mutation(internal.mapReduction.executeMapReduction, { dryRun: false });
    expect(realRes.dryRun).toBe(false);
    expect(realRes.territoriesDeleted).toBe(1);
    expect(realRes.protectedCapitals).toBe(1);
    expect(realRes.explorationsDeleted).toBe(1);

    // Verificar que se conservó la capital inicial, la celda interior (30,0) y la capital exterior protegida
    const remaining = await t.run(async (ctx) => ctx.db.query("territories").collect());
    expect(remaining.map((c) => c.cellId).sort()).toEqual(["0,0", "30,0", `${MAP.RADIUS + 3},0`].sort());

    // 3. Idempotencia (sin doble ejecución)
    const secondRun: any = await t.mutation(internal.territories.executeMapReduction, { dryRun: false });
    expect(secondRun.territoriesDeleted).toBe(0);
    expect(secondRun.explorationsDeleted).toBe(0);
    expect(secondRun.protectedCapitals).toBe(1);
  });
});
