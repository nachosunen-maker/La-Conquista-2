/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as accountPureTests from "../accountPureTests.js";
import type * as accountRules from "../accountRules.js";
import type * as army from "../army.js";
import type * as armyPureTests from "../armyPureTests.js";
import type * as armyRules from "../armyRules.js";
import type * as auth from "../auth.js";
import type * as balanceConfig from "../balanceConfig.js";
import type * as battlePureTests from "../battlePureTests.js";
import type * as battleRules from "../battleRules.js";
import type * as buildingRules from "../buildingRules.js";
import type * as buildings from "../buildings.js";
import type * as challengePureTests from "../challengePureTests.js";
import type * as challengeRules from "../challengeRules.js";
import type * as civilizationPureTests from "../civilizationPureTests.js";
import type * as civilizationRules from "../civilizationRules.js";
import type * as civilizations from "../civilizations.js";
import type * as constructionPureTests from "../constructionPureTests.js";
import type * as economy from "../economy.js";
import type * as economyAdapter from "../economyAdapter.js";
import type * as economyCalculations from "../economyCalculations.js";
import type * as economyExtended from "../economyExtended.js";
import type * as economyExtendedPureTests from "../economyExtendedPureTests.js";
import type * as economyPureTests from "../economyPureTests.js";
import type * as economyRound2PureTests from "../economyRound2PureTests.js";
import type * as economyTests from "../economyTests.js";
import type * as explorationPureTests from "../explorationPureTests.js";
import type * as explorationRules from "../explorationRules.js";
import type * as foundationPureTests from "../foundationPureTests.js";
import type * as foundationRules from "../foundationRules.js";
import type * as http from "../http.js";
import type * as kingdomAccess from "../kingdomAccess.js";
import type * as kingdomReadModel from "../kingdomReadModel.js";
import type * as kingdoms from "../kingdoms.js";
import type * as military from "../military.js";
import type * as militaryPureTests from "../militaryPureTests.js";
import type * as militaryRules from "../militaryRules.js";
import type * as missionPureTests from "../missionPureTests.js";
import type * as missionRules from "../missionRules.js";
import type * as missions from "../missions.js";
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
  account: typeof account;
  accountPureTests: typeof accountPureTests;
  accountRules: typeof accountRules;
  army: typeof army;
  armyPureTests: typeof armyPureTests;
  armyRules: typeof armyRules;
  auth: typeof auth;
  balanceConfig: typeof balanceConfig;
  battlePureTests: typeof battlePureTests;
  battleRules: typeof battleRules;
  buildingRules: typeof buildingRules;
  buildings: typeof buildings;
  challengePureTests: typeof challengePureTests;
  challengeRules: typeof challengeRules;
  civilizationPureTests: typeof civilizationPureTests;
  civilizationRules: typeof civilizationRules;
  civilizations: typeof civilizations;
  constructionPureTests: typeof constructionPureTests;
  economy: typeof economy;
  economyAdapter: typeof economyAdapter;
  economyCalculations: typeof economyCalculations;
  economyExtended: typeof economyExtended;
  economyExtendedPureTests: typeof economyExtendedPureTests;
  economyPureTests: typeof economyPureTests;
  economyRound2PureTests: typeof economyRound2PureTests;
  economyTests: typeof economyTests;
  explorationPureTests: typeof explorationPureTests;
  explorationRules: typeof explorationRules;
  foundationPureTests: typeof foundationPureTests;
  foundationRules: typeof foundationRules;
  http: typeof http;
  kingdomAccess: typeof kingdomAccess;
  kingdomReadModel: typeof kingdomReadModel;
  kingdoms: typeof kingdoms;
  military: typeof military;
  militaryPureTests: typeof militaryPureTests;
  militaryRules: typeof militaryRules;
  missionPureTests: typeof missionPureTests;
  missionRules: typeof missionRules;
  missions: typeof missions;
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
