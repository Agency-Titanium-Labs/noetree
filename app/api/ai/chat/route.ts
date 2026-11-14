import { handleChatRequest } from "@/lib/ai/chatHandler";
import { realChatDeps } from "@/lib/ai/chatRouteDeps";

// Node runtime: ai@7 is ESM + Node >= 22, and settlement runs in after().
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Seconds. Must be a literal for Next's static analysis. 120 equals
// MAX_RUN_DURATION_MS (convex/helpers/aiRunState.ts) and is far below
// RUN_TTL_MS (300 s), so the reaper can never refund a live stream. The
// stream timer in chatHandler leaves 20 s of this budget for settlement.
export const maxDuration = 120;

export async function POST(req: Request): Promise<Response> {
  return handleChatRequest(req, realChatDeps());
}
