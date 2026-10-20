import { after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ChatDeps } from "./chatHandler";
import { createGatewayProvider } from "./gatewayProvider";
import { chatModelId } from "./models";

/**
 * Real dependencies of POST /api/ai/chat, kept out of the route file (Next
 * only allows route-specific exports there) so the wiring is testable.
 *
 * Two Convex clients, on purpose (security F-01):
 *  - `createRunClient(token)`: carries the user's Clerk `convex` JWT and is
 *    used ONLY for `beginRun`, at the start of the request.
 *  - `createSettleClient()`: NO user auth. `settleRun` is guarded by
 *    INTERNAL_WEBHOOK_SECRET, so the secret is the credential. A stream can
 *    outlive the user's token (Clerk `convex` template lifetime assumption:
 *    see 19-PLAN.md), and an expired token must never leave a charged run
 *    unsettled.
 */
export function realChatDeps(): ChatDeps {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL!;
  return {
    async getAuth() {
      const { userId, getToken } = await auth();
      if (!userId) return { userId: null, token: null };
      return { userId, token: await getToken({ template: "convex" }) };
    },
    hasSettleSecret: () => Boolean(process.env.INTERNAL_WEBHOOK_SECRET),
    createRunClient(token) {
      const convex = new ConvexHttpClient(url);
      convex.setAuth(token);
      return {
        begin: args =>
          convex.mutation(api.aiRuns.beginRun, {
            requestId: args.requestId,
            actionKey: args.actionKey,
            ...(args.noteId ? { noteId: args.noteId as Id<"notes"> } : {}),
          }),
      };
    },
    createSettleClient() {
      const convex = new ConvexHttpClient(url);
      return {
        settle: (runId, outcome) =>
          convex.mutation(api.aiRuns.settleRun, {
            secret: process.env.INTERNAL_WEBHOOK_SECRET!,
            runId: runId as Id<"aiRuns">,
            outcome,
          }),
      };
    },
    // Plain "provider/model" string, resolved by the Vercel AI Gateway.
    provider: createGatewayProvider(chatModelId()),
    after: promise => after(() => promise),
  };
}
