import {
  type BeginResult,
  type ChatDeps,
  type RunClient,
  type SettleClient,
} from "./chatHandler";
import {
  createFakeProvider,
  type FakeProviderOptions,
  type LlmProvider,
  type ProviderInput,
} from "./fakeProvider";
import type { SettleOutcome } from "./executeRun";

/** Shared test harness for the chat handler (no network, fake provider). */

export const OK_BEGIN: BeginResult = {
  runId: "run_1",
  replayed: false,
  status: "reserved",
  claimed: true,
};

export function userMsg(text: string, role: "user" | "assistant" = "user") {
  return { role, parts: [{ type: "text", text }] };
}

export function body(over: Record<string, unknown> = {}) {
  return {
    requestId: "req-1",
    locale: "en",
    messages: [userMsg("Hello")],
    ...over,
  };
}

export function request(b: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof b === "string" ? b : JSON.stringify(b),
    signal,
  });
}

export type Harness = {
  deps: ChatDeps;
  begins: Array<{ requestId: string; actionKey: string; noteId?: string }>;
  settles: Array<{ runId: string; outcome: SettleOutcome }>;
  inputs: ProviderInput[];
  afters: Promise<unknown>[];
  providerCalls: () => number;
};

export function harness(opts: {
  provider?: FakeProviderOptions | LlmProvider;
  begin?: BeginResult | Error;
  auth?: { userId: string | null; token: string | null };
  secret?: boolean;
  streamTimeoutMs?: number;
}): Harness {
  const begins: Harness["begins"] = [];
  const settles: Harness["settles"] = [];
  const inputs: ProviderInput[] = [];
  const afters: Promise<unknown>[] = [];
  let calls = 0;
  const base: LlmProvider =
    opts.provider && "stream" in opts.provider
      ? opts.provider
      : createFakeProvider(opts.provider ?? { mode: "ok" });
  const provider: LlmProvider = {
    stream(input, signal) {
      calls += 1;
      inputs.push(input);
      return base.stream(input, signal);
    },
  };
  const client: RunClient = {
    async begin(args) {
      begins.push(args);
      const r = opts.begin ?? OK_BEGIN;
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const settleClient: SettleClient = {
    async settle(runId, outcome) {
      settles.push({ runId, outcome });
      return { status: "x", changed: true };
    },
  };
  const deps: ChatDeps = {
    getAuth: async () => opts.auth ?? { userId: "user_1", token: "tok" },
    hasSettleSecret: () => opts.secret ?? true,
    createRunClient: () => client,
    createSettleClient: () => settleClient,
    provider,
    after: p => afters.push(p),
    streamTimeoutMs: opts.streamTimeoutMs,
  };
  return {
    deps,
    begins,
    settles,
    inputs,
    afters,
    providerCalls: () => calls,
  };
}

export async function drain(res: Response, h: Harness): Promise<string> {
  const text = await res.text();
  await Promise.all(h.afters);
  return text;
}
