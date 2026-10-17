/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev` (or `node scripts/regenerateConvexApi.mjs` offline).
 * @module
 */

import type * as army from "../army.js";
import type * as armyPureTests from "../armyPureTests.js";
import type * as armyRules from "../armyRules.js";
import type * as balanceConfig from "../balanceConfig.js";
import type * as battlePureTests from "../battlePureTests.js";
import type * as battleRules from "../battleRules.js";
import type * as buildingRules from "../buildingRules.js";
import type * as buildings from "../buildings.js";
import type * as challengePureTests from "../challengePureTests.js";
import type * as challengeRules from "../challengeRules.js";
import type * as constructionPureTests from "../constructionPureTests.js";
import type * as economy from "../economy.js";
import type * as economyAdapter from "../economyAdapter.js";
import type * as economyCalculations from "../economyCalculations.js";
import type * as economyExtended from "../economyExtended.js";
import type * as economyExtendedPureTests from "../economyExtendedPureTests.js";
import type * as economyPureTests from "../economyPureTests.js";
import type * as economyTests from "../economyTests.js";
import type * as kingdomAccess from "../kingdomAccess.js";
import type * as kingdomReadModel from "../kingdomReadModel.js";
import type * as kingdoms from "../kingdoms.js";
import type * as parliament from "../parliament.js";
import type * as technologies from "../technologies.js";
import type * as technologyPureTests from "../technologyPureTests.js";
import type * as technologyRules from "../technologyRules.js";
import type * as territories from "../territories.js";
import type * as territoryPureTests from "../territoryPureTests.js";
import type * as territoryRules from "../territoryRules.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  army: typeof army;
  armyPureTests: typeof armyPureTests;
  armyRules: typeof armyRules;
  balanceConfig: typeof balanceConfig;
  battlePureTests: typeof battlePureTests;
  battleRules: typeof battleRules;
  buildingRules: typeof buildingRules;
  buildings: typeof buildings;
  challengePureTests: typeof challengePureTests;
  challengeRules: typeof challengeRules;
  constructionPureTests: typeof constructionPureTests;
  economy: typeof economy;
  economyAdapter: typeof economyAdapter;
  economyCalculations: typeof economyCalculations;
  economyExtended: typeof economyExtended;
  economyExtendedPureTests: typeof economyExtendedPureTests;
  economyPureTests: typeof economyPureTests;
  economyTests: typeof economyTests;
  kingdomAccess: typeof kingdomAccess;
  kingdomReadModel: typeof kingdomReadModel;
  kingdoms: typeof kingdoms;
  parliament: typeof parliament;
  technologies: typeof technologies;
  technologyPureTests: typeof technologyPureTests;
  technologyRules: typeof technologyRules;
  territories: typeof territories;
  territoryPureTests: typeof territoryPureTests;
  territoryRules: typeof territoryRules;
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
