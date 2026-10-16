/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as economy from "../economy.js";
import type * as economyAdapter from "../economyAdapter.js";
import type * as economyCalculations from "../economyCalculations.js";
import type * as economyPureTests from "../economyPureTests.js";
import type * as economyTests from "../economyTests.js";
import type * as kingdoms from "../kingdoms.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  economy: typeof economy;
  economyAdapter: typeof economyAdapter;
  economyCalculations: typeof economyCalculations;
  economyPureTests: typeof economyPureTests;
  economyTests: typeof economyTests;
  kingdoms: typeof kingdoms;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
