import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  MAX_UNRESOLVED_SUGGESTIONS,
  SUGGESTION_CLEANUP_GRACE_MS,
  SUGGESTION_TTL_MS,
  SUGGEST_RATE_CAPACITY,
} from "./helpers/aiSuggestionState";
import {
  TEST_SECRET,
  USER,
  as,
  assertLedgerInvariant,
  balances,
  errorCode,
  ledger,
  seedCredits,
} from "../test-utils/aiHarness";
import { seedUser } from "../test-utils/convexSeed";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  process.env.INTERNAL_WEBHOOK_SECRET = TEST_SECRET;
});
afterEach(() => {
  delete process.env.INTERNAL_WEBHOOK_SECRET;
  vi.useRealTimers();
});

async function rejects(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return errorCode(err);
  }
  throw new Error("expected rejection");
}

/** A Premium user with credits, the preference ON, and one owned note. */
async function setup(
  opts: {
    monthly?: number;
    premium?: boolean;
    pref?: boolean;
    key?: string;
  } = {},
) {
  const t = convexTest(schema, modules);
  const key = opts.key ?? USER;
  const userId = await seedUser(t, { key });
  const noteId = await t.run(async ctx =>
    ctx.db.insert("notes", {
      owner: userId,
      title: "  My   note\ntitle ",
      content: "{}",
    }),
  );
  await seedCredits(t, {
    clerkUserId: key,
    monthly: opts.monthly ?? 10,
    ...(opts.premium === false ? {} : { status: "active" as const }),
  });
  if (opts.pref !== false)
    await as(t, key).mutation(api.aiSuggestions.setMyAutocomplete, {
      enabled: true,
    });
  return { t, userId, noteId, key };
}

async function issue(t: T, noteId: Id<"notes">, key = USER) {
  return await as(t, key).mutation(api.aiSuggestions.issue, { noteId });
}

async function issued(t: T, noteId: Id<"notes">, key = USER) {
  const r = await issue(t, noteId, key);
  if (r.status !== "issued")
    throw new Error("expected issued, got " + r.reason);
  return r.suggestionId;
}

async function fill(
  t: T,
  suggestionId: Id<"aiSuggestions">,
  text = "and so on.",
) {
  return await t.mutation(api.aiSuggestions.fill, {
    secret: TEST_SECRET,
    suggestionId,
    text,
  });
}

async function accept(t: T, suggestionId: Id<"aiSuggestions">, key = USER) {
  return await as(t, key).mutation(api.aiSuggestions.accept, { suggestionId });
}

async function rows(t: T) {
  return await t.run(async ctx => ctx.db.query("aiSuggestions").collect());
}

describe("issue (AUTO-02, AUTO-03)", () => {
  it("inserts an unresolved suggestion and debits nothing", async () => {
    const { t, noteId } = await setup();
    const r = await issue(t, noteId);
    expect(r).toMatchObject({ status: "issued", title: "My note title" });
    expect(await balances(t)).toMatchObject({ monthly: 10 });
    expect(await ledger(t)).toHaveLength(0);
    const [row] = await rows(t);
    expect(row).toMatchObject({ status: "issued", clerkUserId: USER });
    expect(row.text).toBeUndefined();
  });

  it("refuses a Free user with PREMIUM_REQUIRED and writes nothing", async () => {
    const { t, noteId } = await setup({ premium: false, pref: false });
    expect(await rejects(issue(t, noteId))).toBe("PREMIUM_REQUIRED");
    expect(await rows(t)).toHaveLength(0);
    expect(
      await t.run(async ctx => ctx.db.query("aiSuggestionLimits").collect()),
    ).toHaveLength(0);
  });

  it("refuses a signed-out caller", async () => {
    const { t, noteId } = await setup();
    expect(await rejects(t.mutation(api.aiSuggestions.issue, { noteId }))).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("pauses silently when the preference is off", async () => {
    const { t, noteId } = await setup({ pref: false });
    expect(await issue(t, noteId)).toEqual({ status: "paused", reason: "off" });
    expect(await rows(t)).toHaveLength(0);
  });

  it("pauses silently on the kill switch and on a per-user block", async () => {
    const { t, noteId } = await setup();
    await t.mutation(internal.aiRuns.setAiEnabled, { enabled: false });
    expect(await issue(t, noteId)).toEqual({
      status: "paused",
      reason: "disabled",
    });
    await t.mutation(internal.aiRuns.setAiEnabled, { enabled: true });
    await t.mutation(internal.aiRuns.setUserAiBlock, {
      clerkUserId: USER,
      blockedUntil: Date.now() + 60_000,
    });
    expect(await issue(t, noteId)).toEqual({
      status: "paused",
      reason: "disabled",
    });
    expect(await rows(t)).toHaveLength(0);
  });

  it("pauses (no model call) when no credit is left to accept with", async () => {
    const { t, noteId } = await setup({ monthly: 0 });
    expect(await issue(t, noteId)).toEqual({
      status: "paused",
      reason: "credits",
    });
    expect(await rows(t)).toHaveLength(0);
  });

  it("refuses a note owned by someone else (NOTE_NOT_OWNED), nothing written", async () => {
    const { t } = await setup();
    const other = await seedUser(t, { key: "someone_else" });
    const foreign = await t.run(async ctx =>
      ctx.db.insert("notes", { owner: other, title: "x", content: "{}" }),
    );
    expect(await rejects(issue(t, foreign))).toBe("NOTE_NOT_OWNED");
    expect(await rows(t)).toHaveLength(0);
    expect(
      await t.run(async ctx => ctx.db.query("aiSuggestionLimits").collect()),
    ).toHaveLength(0);
  });

  it("refuses a purchased note, a flagged note and a note under a purchased branch", async () => {
    const { t, userId } = await setup();
    const purchased = await t.run(async ctx =>
      ctx.db.insert("notes", {
        owner: userId,
        title: "p",
        content: "{}",
        isPurchasedContent: true,
      }),
    );
    expect(await rejects(issue(t, purchased))).toBe(
      "PURCHASED_CONTENT_EXCLUDED",
    );
    const child = await t.run(async ctx =>
      ctx.db.insert("notes", {
        owner: userId,
        title: "c",
        content: "{}",
        parentNote: purchased,
      }),
    );
    expect(await rejects(issue(t, child))).toBe("PURCHASED_CONTENT_EXCLUDED");
    expect(await rows(t)).toHaveLength(0);
  });

  it("reports a deleted note as NOTE_NOT_FOUND", async () => {
    const { t, noteId } = await setup();
    await t.run(async ctx => ctx.db.delete("notes", noteId));
    expect(await rejects(issue(t, noteId))).toBe("NOTE_NOT_FOUND");
  });

  it("caps unresolved suggestions at 5, then pauses silently (AUTO-03)", async () => {
    const { t, noteId } = await setup();
    for (let i = 0; i < MAX_UNRESOLVED_SUGGESTIONS; i++)
      await issued(t, noteId);
    expect(await issue(t, noteId)).toEqual({
      status: "paused",
      reason: "unresolved",
    });
    expect(await rows(t)).toHaveLength(MAX_UNRESOLVED_SUGGESTIONS);
  });

  it("frees a slot when a suggestion is dismissed, accepted or expires", async () => {
    const { t, noteId } = await setup();
    const ids: Id<"aiSuggestions">[] = [];
    for (let i = 0; i < MAX_UNRESOLVED_SUGGESTIONS; i++) {
      ids.push(await issued(t, noteId));
    }
    await as(t).mutation(api.aiSuggestions.dismiss, { suggestionId: ids[0] });
    expect((await issue(t, noteId)).status).toBe("issued");
    expect((await issue(t, noteId)).status).toBe("paused");

    await fill(t, ids[1]);
    await accept(t, ids[1]);
    expect((await issue(t, noteId)).status).toBe("issued");

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + SUGGESTION_TTL_MS + 1);
    expect((await issue(t, noteId)).status).toBe("issued");
  });

  it("limits requests to 20 per minute on its own bucket (AUTO-03)", async () => {
    const { t, noteId } = await setup();
    for (let i = 0; i < SUGGEST_RATE_CAPACITY; i++) {
      const id = await issued(t, noteId);
      await as(t).mutation(api.aiSuggestions.dismiss, { suggestionId: id });
    }
    expect(await issue(t, noteId)).toEqual({
      status: "paused",
      reason: "rate",
    });
    // The chat bucket was never touched.
    expect(
      await t.run(async ctx => ctx.db.query("aiRateLimits").collect()),
    ).toHaveLength(0);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect((await issue(t, noteId)).status).toBe("issued");
  });

  it("a request budget spent on suggestions never blocks chat (separate buckets)", async () => {
    const { t, noteId } = await setup();
    for (let i = 0; i < SUGGEST_RATE_CAPACITY; i++) {
      const id = await issued(t, noteId);
      await as(t).mutation(api.aiSuggestions.dismiss, { suggestionId: id });
    }
    const run = await as(t).mutation(api.aiRuns.beginRun, {
      requestId: "chat-1",
      actionKey: "basic",
    });
    expect(run.claimed).toBe(true);
  });
});

describe("fill", () => {
  it("is secret-guarded and writes the text once", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    expect(
      await rejects(
        t.mutation(api.aiSuggestions.fill, {
          secret: "wrong",
          suggestionId: id,
          text: "x",
        }),
      ),
    ).toBe("Unauthorized");
    expect(await fill(t, id, "first.")).toBe(true);
    expect(await fill(t, id, "second.")).toBe(false);
    expect((await rows(t))[0].text).toBe("first.");
  });

  it("rejects blank, multi-line and oversized text", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    expect(await fill(t, id, "   ")).toBe(false);
    expect(await fill(t, id, "a\nb")).toBe(false);
    expect(await fill(t, id, "x".repeat(401))).toBe(false);
    expect((await rows(t))[0].text).toBeUndefined();
  });

  it("is not callable by a signed-in user without the secret", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    expect(
      await rejects(
        as(t).mutation(api.aiSuggestions.fill, {
          secret: "",
          suggestionId: id,
          text: "x",
        }),
      ),
    ).toBe("Unauthorized");
  });
});

describe("accept (AUTO-02)", () => {
  it("debits exactly 1 credit, marks accepted and returns the text", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    await fill(t, id, "to the point.");
    const r = await accept(t, id);
    expect(r).toEqual({ text: "to the point.", cost: 1, replayed: false });
    expect(await balances(t)).toMatchObject({ monthly: 9 });
    const tx = await ledger(t);
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({
      type: "deduction",
      amount: -1,
      actionKey: "autocomplete",
    });
    const [row] = await rows(t);
    expect(row).toMatchObject({ status: "accepted", transactionId: tx[0]._id });
    await assertLedgerInvariant(t, 10);
  });

  it("a replayed accept returns the text and debits nothing more", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    await fill(t, id);
    await accept(t, id);
    const again = await accept(t, id);
    expect(again).toMatchObject({
      replayed: true,
      cost: 1,
      text: "and so on.",
    });
    // Even concurrent replays are serialized into one debit.
    await Promise.all([accept(t, id), accept(t, id), accept(t, id)]);
    expect(await balances(t)).toMatchObject({ monthly: 9 });
    expect(await ledger(t)).toHaveLength(1);
    await assertLedgerInvariant(t, 10);
  });

  it("a replay stays free even after the kill switch or a downgrade", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    await fill(t, id);
    await accept(t, id);
    await t.mutation(internal.aiRuns.setAiEnabled, { enabled: false });
    expect((await accept(t, id)).replayed).toBe(true);
    expect(await ledger(t)).toHaveLength(1);
  });

  it("insufficient credits at accept: nothing debited, row stays issued", async () => {
    const { t, noteId } = await setup({ monthly: 1 });
    const id = await issued(t, noteId);
    await fill(t, id);
    // The balance is spent elsewhere between show and accept.
    await t.run(async ctx => {
      const row = await ctx.db.query("aiCredits").first();
      await ctx.db.patch("aiCredits", row!._id, { balance: 0 });
    });
    expect(await rejects(accept(t, id))).toBe("INSUFFICIENT_CREDITS");
    expect(await ledger(t)).toHaveLength(0);
    expect((await rows(t))[0].status).toBe("issued");
  });

  it("refuses a Free user (downgraded after issue) before any write", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    await fill(t, id);
    await t.run(async ctx => {
      const sub = await ctx.db.query("subscriptions").first();
      await ctx.db.patch("subscriptions", sub!._id, { status: "canceled" });
    });
    expect(await rejects(accept(t, id))).toBe("PREMIUM_REQUIRED");
    expect(await ledger(t)).toHaveLength(0);
    expect((await rows(t))[0].status).toBe("issued");
  });

  it("refuses when the kill switch is on", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    await fill(t, id);
    await t.mutation(internal.aiRuns.setAiEnabled, { enabled: false });
    expect(await rejects(accept(t, id))).toBe("AI_DISABLED");
    expect(await ledger(t)).toHaveLength(0);
  });

  it("refuses an expired suggestion", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    await fill(t, id);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + SUGGESTION_TTL_MS + 1);
    expect(await rejects(accept(t, id))).toBe("SUGGESTION_EXPIRED");
    expect(await ledger(t)).toHaveLength(0);
  });

  it("refuses a dismissed suggestion", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    await fill(t, id);
    await as(t).mutation(api.aiSuggestions.dismiss, { suggestionId: id });
    expect(await rejects(accept(t, id))).toBe("SUGGESTION_EXPIRED");
    expect(await ledger(t)).toHaveLength(0);
  });

  it("refuses a suggestion whose text was never produced", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    expect(await rejects(accept(t, id))).toBe("SUGGESTION_NOT_FOUND");
    expect(await ledger(t)).toHaveLength(0);
  });

  it("refuses another user's suggestion exactly like a missing one", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    await fill(t, id);
    await seedUser(t, { key: "mallory" });
    await seedCredits(t, {
      clerkUserId: "mallory",
      monthly: 10,
      status: "active",
    });
    expect(await rejects(accept(t, id, "mallory"))).toBe(
      "SUGGESTION_NOT_FOUND",
    );
    expect(await balances(t, "mallory")).toMatchObject({ monthly: 10 });
    expect((await rows(t))[0].status).toBe("issued");
  });

  it("refuses a signed-out caller", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    expect(
      await rejects(t.mutation(api.aiSuggestions.accept, { suggestionId: id })),
    ).toBe("UNAUTHENTICATED");
  });

  it("beginRun cannot launch the autocomplete charge as a metered run", async () => {
    const { t } = await setup();
    expect(
      await rejects(
        as(t).mutation(api.aiRuns.beginRun, {
          requestId: "r-1",
          actionKey: "autocomplete",
        }),
      ),
    ).toBe("UNKNOWN_ACTION");
    expect(await ledger(t)).toHaveLength(0);
  });
});

describe("dismiss", () => {
  it("is idempotent and silent for missing, foreign and resolved ids", async () => {
    const { t, noteId } = await setup();
    const id = await issued(t, noteId);
    await as(t).mutation(api.aiSuggestions.dismiss, { suggestionId: id });
    await as(t).mutation(api.aiSuggestions.dismiss, { suggestionId: id });
    expect((await rows(t))[0].status).toBe("dismissed");

    const id2 = await issued(t, noteId);
    await fill(t, id2);
    await accept(t, id2);
    await as(t).mutation(api.aiSuggestions.dismiss, { suggestionId: id2 });
    expect((await rows(t)).find(r => r._id === id2)!.status).toBe("accepted");

    await seedUser(t, { key: "mallory" });
    await as(t, "mallory").mutation(api.aiSuggestions.dismiss, {
      suggestionId: (await issued(t, noteId)) as Id<"aiSuggestions">,
    });
    expect((await rows(t)).at(-1)!.status).toBe("issued");
  });
});

describe("cleanup cron", () => {
  it("deletes rows past expiry + grace and keeps the rest", async () => {
    const { t, noteId } = await setup();
    const old = await issued(t, noteId);
    await fill(t, old);
    await accept(t, old);
    const dismissed = await issued(t, noteId);
    await as(t).mutation(api.aiSuggestions.dismiss, {
      suggestionId: dismissed,
    });

    // Just after expiry: still inside the grace window (replay stays safe).
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + SUGGESTION_TTL_MS + 1000);
    expect(await t.mutation(internal.aiSuggestions.sweepSuggestions, {})).toBe(
      0,
    );
    expect((await accept(t, old)).replayed).toBe(true);

    vi.setSystemTime(Date.now() + SUGGESTION_CLEANUP_GRACE_MS + 1000);
    const fresh = await issued(t, noteId);
    expect(await t.mutation(internal.aiSuggestions.sweepSuggestions, {})).toBe(
      2,
    );
    const left = await rows(t);
    expect(left.map(r => r._id)).toEqual([fresh]);
    // The accepted row is gone, the ledger is not.
    expect(await ledger(t)).toHaveLength(1);
  });

  it("is registered as a cron", async () => {
    const crons = (await import("./crons")).default;
    expect(JSON.stringify(crons)).toContain("sweepSuggestions");
  });
});

describe("account preference (D-02)", () => {
  it("is OFF by default and follows the account", async () => {
    const { t } = await setup({ pref: false });
    expect(
      await as(t).query(api.aiSuggestions.getMyAutocomplete, {}),
    ).toMatchObject({
      premium: true,
      preference: false,
      enabled: false,
    });
    await as(t).mutation(api.aiSuggestions.setMyAutocomplete, {
      enabled: true,
    });
    expect(
      await as(t).query(api.aiSuggestions.getMyAutocomplete, {}),
    ).toMatchObject({
      preference: true,
      enabled: true,
    });
    await as(t).mutation(api.aiSuggestions.setMyAutocomplete, {
      enabled: false,
    });
    expect(
      (await as(t).query(api.aiSuggestions.getMyAutocomplete, {}))!.enabled,
    ).toBe(false);
  });

  it("a Free user cannot switch it on and sees it locked", async () => {
    const { t } = await setup({ premium: false, pref: false });
    expect(
      await rejects(
        as(t).mutation(api.aiSuggestions.setMyAutocomplete, { enabled: true }),
      ),
    ).toBe("PREMIUM_REQUIRED");
    await as(t).mutation(api.aiSuggestions.setMyAutocomplete, {
      enabled: false,
    });
    expect(
      await as(t).query(api.aiSuggestions.getMyAutocomplete, {}),
    ).toMatchObject({
      premium: false,
      enabled: false,
    });
  });

  it("a lapsed Premium keeps the stored choice but is effectively off", async () => {
    const { t } = await setup();
    await t.run(async ctx => {
      const sub = await ctx.db.query("subscriptions").first();
      await ctx.db.patch("subscriptions", sub!._id, { status: "canceled" });
    });
    expect(
      await as(t).query(api.aiSuggestions.getMyAutocomplete, {}),
    ).toMatchObject({
      premium: false,
      preference: true,
      enabled: false,
    });
  });

  it("returns null when signed out", async () => {
    const { t } = await setup();
    expect(await t.query(api.aiSuggestions.getMyAutocomplete, {})).toBeNull();
  });
});
