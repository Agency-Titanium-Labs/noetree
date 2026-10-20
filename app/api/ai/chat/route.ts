import { after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { handleChatRequest, type ChatDeps } from "@/lib/ai/chatHandler";
import { createGatewayProvider } from "@/lib/ai/gatewayProvider";
import { chatModelId } from "@/lib/ai/models";

// Node runtime: ai@7 is ESM + Node >= 22, and settlement runs in after().
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Seconds. Must be a literal for Next's static analysis. 120 equals
// MAX_RUN_DURATION_MS (convex/helpers/aiRunState.ts) and is far below
// RUN_TTL_MS (300 s), so the reaper can never refund a live stream. The
// stream timer in chatHandler leaves 20 s of this budget for settlement.
export const maxDuration = 120;

function realDeps(): ChatDeps {
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

export async function POST(req: Request): Promise<Response> {
  return handleChatRequest(req, realDeps());
}
