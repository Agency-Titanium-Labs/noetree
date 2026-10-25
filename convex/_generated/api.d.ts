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
import type * as aiSuggestions from "../aiSuggestions.js";
import type * as aiTree from "../aiTree.js";
import type * as aiUserContext from "../aiUserContext.js";
import type * as comments from "../comments.js";
import type * as connectAccounts from "../connectAccounts.js";
import type * as crons from "../crons.js";
import type * as helpers_aiContext from "../helpers/aiContext.js";
import type * as helpers_aiContextLoad from "../helpers/aiContextLoad.js";
import type * as helpers_aiErrors from "../helpers/aiErrors.js";
import type * as helpers_aiPersonalContext from "../helpers/aiPersonalContext.js";
import type * as helpers_aiRateLimit from "../helpers/aiRateLimit.js";
import type * as helpers_aiRunState from "../helpers/aiRunState.js";
import type * as helpers_aiSuggestionState from "../helpers/aiSuggestionState.js";
import type * as helpers_aiTreeOutline from "../helpers/aiTreeOutline.js";
import type * as helpers_aiTreeProposal from "../helpers/aiTreeProposal.js";
import type * as helpers_commentAccess from "../helpers/commentAccess.js";
import type * as helpers_commission from "../helpers/commission.js";
import type * as helpers_creditCatalog from "../helpers/creditCatalog.js";
import type * as helpers_delivery from "../helpers/delivery.js";
import type * as helpers_earnings from "../helpers/earnings.js";
import type * as helpers_helper from "../helpers/helper.js";
import type * as helpers_internalSecret from "../helpers/internalSecret.js";
import type * as helpers_linkCleanup from "../helpers/linkCleanup.js";
import type * as helpers_linkConfig from "../helpers/linkConfig.js";
import type * as helpers_linkGateway from "../helpers/linkGateway.js";
import type * as helpers_linkPrompt from "../helpers/linkPrompt.js";
import type * as helpers_linkRanking from "../helpers/linkRanking.js";
import type * as helpers_linkSearch from "../helpers/linkSearch.js";
import type * as helpers_listings from "../helpers/listings.js";
import type * as helpers_noteDeletion from "../helpers/noteDeletion.js";
import type * as helpers_noteText from "../helpers/noteText.js";
import type * as helpers_noteVersions from "../helpers/noteVersions.js";
import type * as helpers_permissions from "../helpers/permissions.js";
import type * as helpers_purchaseAccess from "../helpers/purchaseAccess.js";
import type * as helpers_purchasedFlag from "../helpers/purchasedFlag.js";
import type * as helpers_sharing from "../helpers/sharing.js";
import type * as links from "../links.js";
import type * as listings from "../listings.js";
import type * as marketplace from "../marketplace.js";
import type * as noteVersions from "../noteVersions.js";
import type * as notes from "../notes.js";
import type * as notifications from "../notifications.js";
import type * as presence from "../presence.js";
import type * as prosemirrorSync from "../prosemirrorSync.js";
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
  aiSuggestions: typeof aiSuggestions;
  aiTree: typeof aiTree;
  aiUserContext: typeof aiUserContext;
  comments: typeof comments;
  connectAccounts: typeof connectAccounts;
  crons: typeof crons;
  "helpers/aiContext": typeof helpers_aiContext;
  "helpers/aiContextLoad": typeof helpers_aiContextLoad;
  "helpers/aiErrors": typeof helpers_aiErrors;
  "helpers/aiPersonalContext": typeof helpers_aiPersonalContext;
  "helpers/aiRateLimit": typeof helpers_aiRateLimit;
  "helpers/aiRunState": typeof helpers_aiRunState;
  "helpers/aiSuggestionState": typeof helpers_aiSuggestionState;
  "helpers/aiTreeOutline": typeof helpers_aiTreeOutline;
  "helpers/aiTreeProposal": typeof helpers_aiTreeProposal;
  "helpers/commentAccess": typeof helpers_commentAccess;
  "helpers/commission": typeof helpers_commission;
  "helpers/creditCatalog": typeof helpers_creditCatalog;
  "helpers/delivery": typeof helpers_delivery;
  "helpers/earnings": typeof helpers_earnings;
  "helpers/helper": typeof helpers_helper;
  "helpers/internalSecret": typeof helpers_internalSecret;
  "helpers/linkCleanup": typeof helpers_linkCleanup;
  "helpers/linkConfig": typeof helpers_linkConfig;
  "helpers/linkGateway": typeof helpers_linkGateway;
  "helpers/linkPrompt": typeof helpers_linkPrompt;
  "helpers/linkRanking": typeof helpers_linkRanking;
  "helpers/linkSearch": typeof helpers_linkSearch;
  "helpers/listings": typeof helpers_listings;
  "helpers/noteDeletion": typeof helpers_noteDeletion;
  "helpers/noteText": typeof helpers_noteText;
  "helpers/noteVersions": typeof helpers_noteVersions;
  "helpers/permissions": typeof helpers_permissions;
  "helpers/purchaseAccess": typeof helpers_purchaseAccess;
  "helpers/purchasedFlag": typeof helpers_purchasedFlag;
  "helpers/sharing": typeof helpers_sharing;
  links: typeof links;
  listings: typeof listings;
  marketplace: typeof marketplace;
  noteVersions: typeof noteVersions;
  notes: typeof notes;
  notifications: typeof notifications;
  presence: typeof presence;
  prosemirrorSync: typeof prosemirrorSync;
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

export declare const components: {
  prosemirrorSync: import("@convex-dev/prosemirror-sync/_generated/component.js").ComponentApi<"prosemirrorSync">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
};
