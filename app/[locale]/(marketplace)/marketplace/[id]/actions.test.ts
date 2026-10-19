import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { ConvexError } from "convex/values";

const mockSessionsCreate = vi.fn();
const mockSessionsRetrieve = vi.fn();
const mockConvexMutation = vi.fn();
const mockAuth = vi.fn();
const mockRedirectNav = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function StripeMock() {
    return {
      checkout: {
        sessions: {
          create: mockSessionsCreate,
          retrieve: mockSessionsRetrieve,
        },
      },
    };
  }),
}));

const mockSetAuth = vi.fn();

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(function ConvexHttpClientMock() {
    return { mutation: mockConvexMutation, setAuth: mockSetAuth };
  }),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));

vi.mock("next/navigation", () => ({
  redirect: mockRedirectNav,
  permanentRedirect: vi.fn(),
}));

type Result = { ok: false; code: string };
let createMarketplaceCheckout: (
  locale: string,
  listingId: string,
) => Promise<Result>;

const LISTING = "listing123";

function snap(over: Record<string, unknown> = {}) {
  return {
    purchaseId: "purchase1",
    existingSessionId: null,
    snapshotVersion: 1,
    snapshotAt: 1_700_000_000_000,
    title: "My Notes",
    priceCents: 1500,
    currency: "eur",
    commissionCents: 225,
    applicationFeeCents: 480,
    destinationAccountId: "acct_seller",
    listingId: LISTING,
    ...over,
  };
}

// Dispatch on the function reference: prepare returns queue, attach returns null.
let prepareQueue: Array<unknown | Error>;
let prepareCalls: Array<Record<string, unknown>>;
let attachCalls: Array<Record<string, unknown>>;
let attachError: Error | null;

function setupConvex() {
  mockConvexMutation.mockImplementation(
    async (_ref: unknown, args: Record<string, unknown>) => {
      if ("snapshotVersion" in args) {
        attachCalls.push(args);
        if (attachError) throw attachError;
        return null;
      }
      prepareCalls.push(args);
      const next = prepareQueue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  );
}

function signedIn(token: string | null = "tok") {
  mockAuth.mockResolvedValue({
    userId: "user_1",
    redirectToSignIn: vi.fn(),
    getToken: vi.fn().mockResolvedValue(token),
  });
}

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.APP_URL = "https://localhost:3000";
  ({ createMarketplaceCheckout } = await import("./actions"));
});

beforeEach(() => {
  mockSessionsCreate.mockReset();
  mockSessionsRetrieve.mockReset();
  mockConvexMutation.mockReset();
  mockAuth.mockReset();
  mockRedirectNav.mockClear();
  prepareQueue = [];
  prepareCalls = [];
  attachCalls = [];
  attachError = null;
  setupConvex();
});

describe("createMarketplaceCheckout", () => {
  it("signed-out caller goes to sign-in and nothing else runs (D-02)", async () => {
    const redirectToSignIn = vi.fn();
    mockAuth.mockResolvedValue({ userId: null, redirectToSignIn });
    await createMarketplaceCheckout("en", LISTING);
    expect(redirectToSignIn).toHaveBeenCalledWith({
      returnBackUrl: `/en/marketplace/${LISTING}`,
    });
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });

  it("null convex token returns UNAUTHENTICATED", async () => {
    signedIn(null);
    const res = await createMarketplaceCheckout("en", LISTING);
    expect(res).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });

  it("happy path builds a destination charge from the snapshot", async () => {
    signedIn();
    prepareQueue.push(snap());
    mockSessionsCreate.mockResolvedValue({
      id: "cs_new",
      url: "https://checkout.stripe.com/c/cs_new",
    });
    await expect(createMarketplaceCheckout("en", LISTING)).rejects.toThrow(
      "REDIRECT:https://checkout.stripe.com/c/cs_new",
    );
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    const [params, opts] = mockSessionsCreate.mock.calls[0];
    expect(params).toMatchObject({
      mode: "payment",
      payment_method_types: ["card"],
      adaptive_pricing: { enabled: false },
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: 1500,
            product_data: { name: "My Notes" },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: 480,
        transfer_data: { destination: "acct_seller" },
        metadata: { type: "marketplace_purchase", purchaseId: "purchase1" },
      },
      metadata: { type: "marketplace_purchase", purchaseId: "purchase1" },
      client_reference_id: "purchase1",
      success_url: `https://localhost:3000/en/marketplace/${LISTING}?purchase=success`,
      cancel_url: `https://localhost:3000/en/marketplace/${LISTING}`,
      expires_at: 1_700_000_000 + 3600,
    });
    expect(opts).toEqual({
      idempotencyKey: "marketplace-checkout-purchase1-v1",
    });
    expect(attachCalls).toEqual([
      {
        purchaseId: "purchase1",
        stripeCheckoutSessionId: "cs_new",
        snapshotVersion: 1,
      },
    ]);
    expect(createMarketplaceCheckout.length).toBe(2);
  });

  it("invalid locale falls back to the default locale", async () => {
    signedIn();
    prepareQueue.push(snap());
    mockSessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://s/1" });
    await expect(createMarketplaceCheckout("xx", LISTING)).rejects.toThrow(
      "REDIRECT:",
    );
    const [params] = mockSessionsCreate.mock.calls[0];
    expect(params.success_url).toContain("/en/marketplace/");
  });

  it.each([
    "PURCHASE_OWN_LISTING",
    "PURCHASE_ALREADY_OWNED",
    "CONNECT_ONBOARDING_REQUIRED",
  ])("maps ConvexError %s to a result code", async code => {
    signedIn();
    prepareQueue.push(new ConvexError(code));
    const res = await createMarketplaceCheckout("en", LISTING);
    expect(res).toEqual({ ok: false, code });
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("Stripe create failure returns CHECKOUT_FAILED without leaking the token", async () => {
    signedIn("secret-token");
    prepareQueue.push(snap());
    mockSessionsCreate.mockRejectedValue(new Error("stripe down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createMarketplaceCheckout("en", LISTING);
    expect(res).toEqual({ ok: false, code: "CHECKOUT_FAILED" });
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-token");
    spy.mockRestore();
    expect(mockRedirectNav).not.toHaveBeenCalled();
  });

  it("stale attach returns CHECKOUT_FAILED and does not redirect", async () => {
    signedIn();
    prepareQueue.push(snap());
    mockSessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://s/1" });
    attachError = new ConvexError("PURCHASE_SNAPSHOT_STALE");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createMarketplaceCheckout("en", LISTING);
    spy.mockRestore();
    expect(res).toEqual({ ok: false, code: "CHECKOUT_FAILED" });
    expect(mockRedirectNav).not.toHaveBeenCalled();
  });
});

describe("reuse (D-05)", () => {
  it("redirects to an open existing session without creating a new one", async () => {
    signedIn();
    prepareQueue.push(snap({ existingSessionId: "cs_open" }));
    mockSessionsRetrieve.mockResolvedValue({
      status: "open",
      url: "https://checkout.stripe.com/c/cs_open",
    });
    await expect(createMarketplaceCheckout("en", LISTING)).rejects.toThrow(
      "REDIRECT:https://checkout.stripe.com/c/cs_open",
    );
    expect(mockSessionsCreate).not.toHaveBeenCalled();
    expect(attachCalls).toHaveLength(0);
    expect(prepareCalls).toHaveLength(1);
  });

  it("replaces an expired session with a fresh one", async () => {
    signedIn();
    prepareQueue.push(
      snap({ existingSessionId: "cs_old" }),
      snap({ snapshotVersion: 2 }),
    );
    mockSessionsRetrieve.mockResolvedValue({ status: "expired", url: null });
    mockSessionsCreate.mockResolvedValue({
      id: "cs_new",
      url: "https://s/new",
    });
    await expect(createMarketplaceCheckout("en", LISTING)).rejects.toThrow(
      "REDIRECT:https://s/new",
    );
    expect(prepareCalls).toHaveLength(2);
    expect(prepareCalls[1]).toMatchObject({ replaceExpiredSession: true });
    expect(mockSessionsCreate.mock.calls[0][1]).toEqual({
      idempotencyKey: "marketplace-checkout-purchase1-v2",
    });
    expect(attachCalls).toHaveLength(1);
    expect(attachCalls[0]).toMatchObject({ snapshotVersion: 2 });
  });

  it("sends a complete session to the success URL and never charges twice", async () => {
    signedIn();
    prepareQueue.push(snap({ existingSessionId: "cs_done" }));
    mockSessionsRetrieve.mockResolvedValue({ status: "complete", url: null });
    await expect(createMarketplaceCheckout("en", LISTING)).rejects.toThrow(
      `REDIRECT:https://localhost:3000/en/marketplace/${LISTING}?purchase=success`,
    );
    expect(mockSessionsCreate).not.toHaveBeenCalled();
    expect(prepareCalls).toHaveLength(1);
  });

  it("treats a retrieve failure as expired", async () => {
    signedIn();
    prepareQueue.push(
      snap({ existingSessionId: "cs_gone" }),
      snap({ snapshotVersion: 2 }),
    );
    mockSessionsRetrieve.mockRejectedValue(new Error("No such session"));
    mockSessionsCreate.mockResolvedValue({
      id: "cs_new",
      url: "https://s/new",
    });
    await expect(createMarketplaceCheckout("en", LISTING)).rejects.toThrow(
      "REDIRECT:https://s/new",
    );
    expect(prepareCalls[1]).toMatchObject({ replaceExpiredSession: true });
  });

  it("treats an open session with no url as expired", async () => {
    signedIn();
    prepareQueue.push(
      snap({ existingSessionId: "cs_nourl" }),
      snap({ snapshotVersion: 2 }),
    );
    mockSessionsRetrieve.mockResolvedValue({ status: "open", url: null });
    mockSessionsCreate.mockResolvedValue({
      id: "cs_new",
      url: "https://s/new",
    });
    await expect(createMarketplaceCheckout("en", LISTING)).rejects.toThrow(
      "REDIRECT:https://s/new",
    );
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });
});
