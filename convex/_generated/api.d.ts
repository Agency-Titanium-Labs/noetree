/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiChat from "../aiChat.js";
import type * as aiCredits from "../aiCredits.js";
import type * as aiRuns from "../aiRuns.js";
import type * as comments from "../comments.js";
import type * as connectAccounts from "../connectAccounts.js";
import type * as crons from "../crons.js";
import type * as helpers_aiContext from "../helpers/aiContext.js";
import type * as helpers_aiContextLoad from "../helpers/aiContextLoad.js";
import type * as helpers_aiErrors from "../helpers/aiErrors.js";
import type * as helpers_aiRateLimit from "../helpers/aiRateLimit.js";
import type * as helpers_aiRunState from "../helpers/aiRunState.js";
import type * as helpers_commentAccess from "../helpers/commentAccess.js";
import type * as helpers_commission from "../helpers/commission.js";
import type * as helpers_creditCatalog from "../helpers/creditCatalog.js";
import type * as helpers_delivery from "../helpers/delivery.js";
import type * as helpers_earnings from "../helpers/earnings.js";
import type * as helpers_helper from "../helpers/helper.js";
import type * as helpers_internalSecret from "../helpers/internalSecret.js";
import type * as helpers_listings from "../helpers/listings.js";
import type * as helpers_noteText from "../helpers/noteText.js";
import type * as helpers_noteVersions from "../helpers/noteVersions.js";
import type * as helpers_permissions from "../helpers/permissions.js";
import type * as helpers_purchaseAccess from "../helpers/purchaseAccess.js";
import type * as helpers_purchasedFlag from "../helpers/purchasedFlag.js";
import type * as helpers_sharing from "../helpers/sharing.js";
import type * as listings from "../listings.js";
import type * as marketplace from "../marketplace.js";
import type * as noteVersions from "../noteVersions.js";
import type * as notes from "../notes.js";
import type * as notifications from "../notifications.js";
import type * as purchases from "../purchases.js";
import type * as sales from "../sales.js";
import type * as shareLinks from "../shareLinks.js";
import type * as shareLinksNode from "../shareLinksNode.js";
import type * as stripeWebhooks from "../stripeWebhooks.js";
import type * as subscriptions from "../subscriptions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiChat: typeof aiChat;
  aiCredits: typeof aiCredits;
  aiRuns: typeof aiRuns;
  comments: typeof comments;
  connectAccounts: typeof connectAccounts;
  crons: typeof crons;
  "helpers/aiContext": typeof helpers_aiContext;
  "helpers/aiContextLoad": typeof helpers_aiContextLoad;
  "helpers/aiErrors": typeof helpers_aiErrors;
  "helpers/aiRateLimit": typeof helpers_aiRateLimit;
  "helpers/aiRunState": typeof helpers_aiRunState;
  "helpers/commentAccess": typeof helpers_commentAccess;
  "helpers/commission": typeof helpers_commission;
  "helpers/creditCatalog": typeof helpers_creditCatalog;
  "helpers/delivery": typeof helpers_delivery;
  "helpers/earnings": typeof helpers_earnings;
  "helpers/helper": typeof helpers_helper;
  "helpers/internalSecret": typeof helpers_internalSecret;
  "helpers/listings": typeof helpers_listings;
  "helpers/noteText": typeof helpers_noteText;
  "helpers/noteVersions": typeof helpers_noteVersions;
  "helpers/permissions": typeof helpers_permissions;
  "helpers/purchaseAccess": typeof helpers_purchaseAccess;
  "helpers/purchasedFlag": typeof helpers_purchasedFlag;
  "helpers/sharing": typeof helpers_sharing;
  listings: typeof listings;
  marketplace: typeof marketplace;
  noteVersions: typeof noteVersions;
  notes: typeof notes;
  notifications: typeof notifications;
  purchases: typeof purchases;
  sales: typeof sales;
  shareLinks: typeof shareLinks;
  shareLinksNode: typeof shareLinksNode;
  stripeWebhooks: typeof stripeWebhooks;
  subscriptions: typeof subscriptions;
  users: typeof users;
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
