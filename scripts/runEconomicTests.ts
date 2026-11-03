import { runEconomicValidationTests, type TestResult } from "../convex/economyPureTests";
import { runMilitaryTests, type MilitaryTestResult } from "../convex/militaryPureTests";
import { runFoundationTests, type FoundationTestResult } from "../convex/foundationPureTests";
import { runChallengeValidationTests as runChallengePureTests, type ChallengeTestResult } from "../convex/challengePureTests";
import { runTerritoryValidationTests, type TerritoryTestResult } from "../convex/territoryPureTests";
import { runExplorationValidationTests, type ExplorationTestResult } from "../convex/explorationPureTests";
import { runCivilizationTests, type CivilizationTestResult } from "../convex/civilizationPureTests";
import { runAccountTests, type AccountTestResult } from "../convex/accountPureTests";
import { runMissionTests, type MissionTestResult } from "../convex/missionPureTests";
import { runTechnologyValidationTests, type TechnologyTestResult } from "../convex/technologyPureTests";
import { runBotPureTests } from "../convex/botPureTests";

console.log("================================================================================");
console.log("LA CONQUISTA — BATERÍA DE PRUEBAS (ECONOMÍA + MILITAR + FUNDACIÓN + PARLAMENTO + BOTS + EXPLORACIÓN + CIVILIZACIONES + CUENTA + MISIONES + TECNOLOGÍAS)");
console.log("================================================================================\n");

const startTime = Date.now();
const economicResults: TestResult[] = runEconomicValidationTests();
const militaryResults: MilitaryTestResult[] = runMilitaryTests();
const foundationResults: FoundationTestResult[] = runFoundationTests();
const challengeResults: ChallengeTestResult[] = runChallengePureTests();
const territoryResults = runTerritoryValidationTests().map((t) => ({ ...t, category: "MAPA Y TERRITORIOS D-22-D-26" }));
const explorationResults: ExplorationTestResult[] = runExplorationValidationTests();
const civilizationResults: CivilizationTestResult[] = runCivilizationTests();
const accountResults: AccountTestResult[] = runAccountTests();
const missionResults: MissionTestResult[] = runMissionTests();
const technologyResults: TechnologyTestResult[] = runTechnologyValidationTests();

const botTestRun = runBotPureTests();
const botResults = [
  {
    category: "SISTEMA DE BOTS MILITARES",
    test: "Catálogo de 47 monarcas, dificultades fijas, rotación semanal de 7 días, espionaje y combate",
    passed: botTestRun.failed === 0,
    details: botTestRun.failed === 0
      ? `Superadas las ${botTestRun.passed} comprobaciones de bots (catálogo, rotación, espionaje e inmutabilidad).`
      : `Fallaron ${botTestRun.failed} comprobaciones: ${botTestRun.errors.join("; ")}`,
  },
];

const results = [
  ...economicResults,
  ...militaryResults,
  ...foundationResults,
  ...challengeResults,
  ...territoryResults,
  ...explorationResults,
  ...civilizationResults,
  ...accountResults,
  ...missionResults,
  ...technologyResults,
  ...botResults,
];
const durationMs = Date.now() - startTime;

let passedCount = 0;
let failedCount = 0;

for (let i = 0; i < results.length; i++) {
  const result = results[i];
  const statusLabel = result.passed ? "\x1b[32m[APROBADO]\x1b[0m" : "\x1b[31m[FALLIDO]\x1b[0m";
  if (result.passed) {
    passedCount++;
  } else {
    failedCount++;
  }
  console.log(`${statusLabel} (${result.category})`);
  console.log(`  Prueba:  ${result.test}`);
  console.log(`  Detalle: ${result.details}\n`);
}

console.log("--------------------------------------------------------------------------------");
console.log(`RESUMEN FINAL:`);
console.log(`  Total de pruebas:     ${results.length}`);
console.log(`  Pruebas superadas:    ${passedCount}`);
console.log(`  Pruebas fallidas:     ${failedCount}`);
console.log(`  Tiempo de ejecución:  ${durationMs} ms`);
console.log("--------------------------------------------------------------------------------");

if (failedCount === 0) {
  console.log("\x1b[32m  TODAS LAS PRUEBAS MATEMÁTICAS Y DE INTEGRIDAD HAN SIDO SUPERADAS.\x1b[0m");
  process.exit(0);
} else {
  console.log("\x1b[31m  SE HAN DETECTADO FALLOS EN LA BATERÍA DE PRUEBAS.\x1b[0m");
  process.exit(1);
}
