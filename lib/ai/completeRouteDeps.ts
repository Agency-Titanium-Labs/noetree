import { auth } from "@clerk/nextjs/server";
import { generateText } from "ai";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CompleteDeps, Completer } from "./completeHandler";
import { completeModelId } from "./completeConfig";

/**
 * Non-streamed completion over the AI SDK: a plain "provider/model" string
 * resolved by the Vercel AI Gateway (same as chat). Tests pass a
 * `MockLanguageModelV4` instead. No retries: a slow or failed suggestion is
 * simply not shown.
 */
export function createGatewayCompleter(
  model: Parameters<typeof generateText>[0]["model"],
): Completer {
  return {
    async complete(input, signal) {
      const result = await generateText({
        model,
        system: input.system,
        prompt: input.prompt,
        maxOutputTokens: input.maxOutputTokens,
        temperature: 0.3,
        abortSignal: signal,
        maxRetries: 0,
      });
      return result.text;
    },
  };
}

/**
 * Real dependencies of POST /api/ai/complete, kept out of the route file so
 * the wiring is testable. Two Convex clients as in chat (security F-01): the
 * user's token for issue and dismiss, and an unauthenticated one whose only
 * credential is INTERNAL_WEBHOOK_SECRET for `fill`.
 */
export function realCompleteDeps(): CompleteDeps {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL!;
  return {
    async getAuth() {
      const { userId, getToken } = await auth();
      if (!userId) return { userId: null, token: null };
      return { userId, token: await getToken({ template: "convex" }) };
    },
    hasSettleSecret: () => Boolean(process.env.INTERNAL_WEBHOOK_SECRET),
    createClient(token) {
      const convex = new ConvexHttpClient(url);
      convex.setAuth(token);
      return {
        issue: args =>
          convex.mutation(api.aiSuggestions.issue, {
            noteId: args.noteId as Id<"notes">,
          }),
        dismiss: args =>
          convex.mutation(api.aiSuggestions.dismiss, {
            suggestionId: args.suggestionId as Id<"aiSuggestions">,
          }),
      };
    },
    createFillClient() {
      const convex = new ConvexHttpClient(url);
      return {
        fill: args =>
          convex.mutation(api.aiSuggestions.fill, {
            secret: process.env.INTERNAL_WEBHOOK_SECRET!,
            suggestionId: args.suggestionId as Id<"aiSuggestions">,
            text: args.text,
          }),
      };
    },
    completer: createGatewayCompleter(completeModelId()),
  };
}
