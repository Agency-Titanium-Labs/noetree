import { handleCompleteRequest } from "@/lib/ai/completeHandler";
import { realCompleteDeps } from "@/lib/ai/completeRouteDeps";

// Node runtime, like chat: ai@7 is ESM + Node >= 22.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Seconds. Literal for Next's static analysis. A suggestion call is abandoned
// after COMPLETE_TIMEOUT_MS (15 s, lib/ai/completeConfig.ts), well inside this.
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  return handleCompleteRequest(req, realCompleteDeps());
}
