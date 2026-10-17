// Regenera convex/_generated/api.d.ts a partir de los módulos presentes en convex/.
// Sustituto offline de `npx convex codegen` (que exige un despliegue configurado).
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const convexDir = new URL("../convex/", import.meta.url).pathname;
const modules = readdirSync(convexDir)
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts") && file !== "schema.ts" && file !== "auth.config.ts" && file !== "tsconfig.json")
  .map((file) => file.replace(/\.ts$/, ""))
  .sort();

const header = `/* eslint-disable */
/**
 * Generated \`api\` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run \`npx convex dev\` (or \`node scripts/regenerateConvexApi.mjs\` offline).
 * @module
 */
`;
const imports = modules.map((m) => `import type * as ${m} from "../${m}.js";`).join("\n");
const entries = modules.map((m) => `  ${m}: typeof ${m};`).join("\n");
const body = `
${imports}

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
${entries}
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * \`\`\`js
 * const myFunctionReference = api.myModule.myFunction;
 * \`\`\`
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * \`\`\`js
 * const myFunctionReference = internal.myModule.myFunction;
 * \`\`\`
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
`;
writeFileSync(join(convexDir, "_generated", "api.d.ts"), header + body);
console.log(`api.d.ts regenerado con ${modules.length} módulos: ${modules.join(", ")}`);
