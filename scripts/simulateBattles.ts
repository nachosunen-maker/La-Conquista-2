/**
 * LA CONQUISTA — BANCO DE SIMULACIONES DE COMBATE (T-03)
 * Recorre los escenarios exigidos por el Complemento §6 ("Pruebas obligatorias de combate")
 * con barridos deterministas de parámetros (sin azar: el simulador es determinista, así que
 * la variedad procede de recorrer tamaños, equipos, moral, fatiga y estrategias).
 * Uso: npx tsx scripts/simulateBattles.ts [--json]
 */
import { simulateBattle, type BattleSide } from "../convex/battleRules";
import { COMBAT, STRATEGIES, type Strategy, type UnitType } from "../convex/balanceConfig";

type Outcome = "victoria" | "derrota" | "empate";
interface Stats { n: number; victoria: number; derrota: number; empate: number; crushing: number; retreats: number; lossA: number; lossD: number; rounds: number }

function base(kingdomId: string, overrides: Partial<BattleSide> = {}): BattleSide {
  return {
    kingdomId,
    name: kingdomId,
    composition: { infanteria: 1000, arqueria: 0, caballeria: 0, asedio: 0 },
    trainingMultiplier: 1,
    weaponTier: "espadaHierro",
    armorTier: "cueroReforzado",
    strategy: "concentracion",
    morale: 70,
    foodTier: "normal",
    fatigue: 0,
    wallsLevel: 0,
    terrainDefenseBonus: 0,
    ...overrides,
  };
}

function stats(): Stats { return { n: 0, victoria: 0, derrota: 0, empate: 0, crushing: 0, retreats: 0, lossA: 0, lossD: 0, rounds: 0 }; }
function record(s: Stats, a: BattleSide, d: BattleSide) {
  const r = simulateBattle(a, d);
  s.n += 1;
  s[r.outcome as Outcome] += 1;
  if (r.crushingVictory) s.crushing += 1;
  if (r.attacker.retreated || r.defender.retreated) s.retreats += 1;
  s.lossA += r.attacker.lossRatio;
  s.lossD += r.defender.lossRatio;
  s.rounds += r.rounds.length;
}
function fmt(s: Stats): string {
  const p = (x: number) => `${((100 * x) / Math.max(1, s.n)).toFixed(1)} %`;
  return `n=${s.n} victoria ${p(s.victoria)} · derrota ${p(s.derrota)} · empate ${p(s.empate)} · aplastante ${p(s.crushing)} · retiradas ${p(s.retreats)} · bajas A ${(100 * s.lossA / Math.max(1, s.n)).toFixed(1)} % / D ${(100 * s.lossD / Math.max(1, s.n)).toFixed(1)} % · rondas ${(s.rounds / Math.max(1, s.n)).toFixed(2)}`;
}

const sizes = [200, 400, 600, 800, 1000, 1500, 2000, 3000, 5000];
const morales = [10, 30, 50, 70, 90, 100];
const fatigues = [0, 20, 45, 70, 95];
const weapons = ["palo", "lanzaBasica", "espadaHierro", "acero", "aceroAvanzado"] as const;
const armors = ["ninguna", "piel", "cueroReforzado", "hierro", "acero"] as const;
const trainings = [1, 1.15, 1.35, 1.6, 1.9];
const tiers = ["minima", "normal", "abundante", "excelente"];
const strategies = Object.keys(STRATEGIES) as Strategy[];

const results: Record<string, Stats> = {};

// 1. Fuerzas iguales en todos los factores
{
  const s = stats();
  for (const n of sizes) for (const m of morales) for (const t of trainings)
    record(s, base("A", { composition: { infanteria: n, arqueria: 0, caballeria: 0, asedio: 0 }, morale: m, trainingMultiplier: t }),
      base("D", { composition: { infanteria: n, arqueria: 0, caballeria: 0, asedio: 0 }, morale: m, trainingMultiplier: t }));
  results["1. Fuerzas iguales (debe ser 100 % empate)"] = s;
}
// 2. Ejército pequeño con mejor entrenamiento y equipo contra uno mayor
{
  const s = stats();
  const sAtLeast60 = stats();
  for (const nA of sizes) for (const nD of sizes) {
    if (nA >= nD) continue;
    for (const t of [1.35, 1.6, 1.9]) for (const w of ["acero", "aceroAvanzado"] as const) {
      const a = base("A", { composition: { infanteria: nA, arqueria: 0, caballeria: 0, asedio: 0 }, trainingMultiplier: t, weaponTier: w, armorTier: "acero", morale: 85, foodTier: "abundante" });
      const d = base("D", { composition: { infanteria: nD, arqueria: 0, caballeria: 0, asedio: 0 }, trainingMultiplier: 1, weaponTier: "palo", armorTier: "piel", morale: 50, foodTier: "normal" });
      record(s, a, d);
      if (nA / nD >= 0.6) record(sAtLeast60, a, d);
    }
  }
  results["2. Pequeño y preparado vs grande y mal preparado (todas las proporciones)"] = s;
  results["2b. Igual, solo proporciones ≥ 60 %"] = sAtLeast60;
}
// 3. Superioridad numérica grande pero mala moral y fatiga
{
  const s = stats();
  for (const nA of [1500, 2000, 3000, 5000]) for (const m of [10, 30, 50]) for (const f of [45, 70, 95])
    record(s, base("A", { composition: { infanteria: nA, arqueria: 0, caballeria: 0, asedio: 0 }, morale: m, fatigue: f, foodTier: "minima" }),
      base("D", { composition: { infanteria: 1000, arqueria: 0, caballeria: 0, asedio: 0 }, morale: 80, foodTier: "abundante" }));
  results["3. Horda numerosa con mala moral/fatiga vs 1.000 descansados"] = s;
}
// 4. Ataque contra defensa: murallas y terreno
{
  const s = stats();
  for (const n of sizes) for (const walls of [0, 2, 5, 10]) for (const terrain of [0, 0.1])
    record(s, base("A", { composition: { infanteria: n, arqueria: 0, caballeria: 0, asedio: 0 } }),
      base("D", { composition: { infanteria: 1000, arqueria: 0, caballeria: 0, asedio: 0 }, wallsLevel: walls, terrainDefenseBonus: terrain }));
  results["4. Ataque de distintos tamaños contra 1.000 defensores con murallas/terreno"] = s;
}
// 5. Cada estrategia contra cada estrategia
{
  for (const sa of strategies) {
    const s = stats();
    for (const sd of strategies) for (const n of [600, 1000, 1500])
      record(s, base("A", { strategy: sa, composition: { infanteria: n, arqueria: 0, caballeria: 0, asedio: 0 } }), base("D", { strategy: sd }));
    results[`5. Estrategia atacante ${sa} vs todas`] = s;
  }
}
// 6. Composiciones mixtas: arquería, caballería y asedio (P37)
{
  const s = stats();
  const comps: Record<UnitType, number>[] = [
    { infanteria: 1000, arqueria: 0, caballeria: 0, asedio: 0 },
    { infanteria: 0, arqueria: 1000, caballeria: 0, asedio: 0 },
    { infanteria: 0, arqueria: 0, caballeria: 1000, asedio: 0 },
    { infanteria: 500, arqueria: 300, caballeria: 200, asedio: 0 },
    { infanteria: 800, arqueria: 0, caballeria: 0, asedio: 40 },
  ];
  for (const ca of comps) for (const cd of comps) for (const walls of [0, 5]) record(s, base("A", { composition: ca }), base("D", { composition: cd, wallsLevel: walls }));
  results["6. Composiciones mixtas y asedio"] = s;
}
// 7. Equipamiento y entrenamiento cruzados, igual número
{
  const s = stats();
  for (const w of weapons) for (const a of armors) for (const t of trainings)
    record(s, base("A", { weaponTier: w, armorTier: a, trainingMultiplier: t }), base("D"));
  results["7. Barrido de equipo/entrenamiento del atacante vs defensor estándar (1.000 vs 1.000)"] = s;
}
// 8. Población y alimentos al límite: raciones mínimas y fatiga alta
{
  const s = stats();
  for (const tier of tiers) for (const f of fatigues) for (const m of morales)
    record(s, base("A", { foodTier: tier, fatigue: f, morale: m }), base("D"));
  results["8. Atacante con raciones/fatiga/moral variables vs defensor estándar"] = s;
}

let total = 0;
for (const s of Object.values(results)) total += s.n;
const asJson = process.argv.includes("--json");
if (asJson) {
  console.log(JSON.stringify({ parameters: COMBAT, total, results }, null, 2));
} else {
  console.log("LA CONQUISTA — Banco de simulaciones de combate");
  console.log(`k=${COMBAT.CASUALTY_RATE_K} rondas=${COMBAT.MAX_ROUNDS} empate≤${COMBAT.DRAW_TOLERANCE * 100} pp exponentes=${JSON.stringify(COMBAT.EXPONENTS)}`);
  console.log(`Enfrentamientos simulados: ${total}\n`);
  for (const [name, s] of Object.entries(results)) console.log(`${name}\n  ${fmt(s)}`);
}
