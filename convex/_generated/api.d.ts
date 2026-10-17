/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiCredits from "../aiCredits.js";
import type * as comments from "../comments.js";
import type * as connectAccounts from "../connectAccounts.js";
import type * as helpers_commentAccess from "../helpers/commentAccess.js";
import type * as helpers_commission from "../helpers/commission.js";
import type * as helpers_delivery from "../helpers/delivery.js";
import type * as helpers_helper from "../helpers/helper.js";
import type * as helpers_listings from "../helpers/listings.js";
import type * as helpers_permissions from "../helpers/permissions.js";
import type * as helpers_sharing from "../helpers/sharing.js";
import type * as listings from "../listings.js";
import type * as marketplace from "../marketplace.js";
import type * as notes from "../notes.js";
import type * as notifications from "../notifications.js";
import type * as purchases from "../purchases.js";
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
  aiCredits: typeof aiCredits;
  comments: typeof comments;
  connectAccounts: typeof connectAccounts;
  "helpers/commentAccess": typeof helpers_commentAccess;
  "helpers/commission": typeof helpers_commission;
  "helpers/delivery": typeof helpers_delivery;
  "helpers/helper": typeof helpers_helper;
  "helpers/listings": typeof helpers_listings;
  "helpers/permissions": typeof helpers_permissions;
  "helpers/sharing": typeof helpers_sharing;
  listings: typeof listings;
  marketplace: typeof marketplace;
  notes: typeof notes;
  notifications: typeof notifications;
  purchases: typeof purchases;
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
