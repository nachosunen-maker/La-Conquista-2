import { query } from "./_generated/server";
import { runEconomicValidationTests, type TestResult } from "./economyPureTests";

export { runEconomicValidationTests, type TestResult };

/**
 * Consulta de prueba ejecutable en Convex.
 * Permite ejecutar y auditar la suite completa desde:
 * - Convex Dashboard (panel de Functions)
 * - Convex CLI: `npx convex run economyTests:runTests`
 * - Frontend cliente mediante `useQuery(api.economyTests.runTests)`
 */
export const runTests = query({
  args: {},
  handler: async () => {
    return runEconomicValidationTests();
  },
});
