import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const mockSubscriptionsUpdate = vi.fn();
const mockConvexQuery = vi.fn();
const mockAuth = vi.fn();
const mockSessionsCreate = vi.fn();
const mockRedirect = vi.fn();

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function StripeMock() {
    return {
      subscriptions: { update: mockSubscriptionsUpdate },
      checkout: { sessions: { create: mockSessionsCreate } },
    };
  }),
}));

const mockSetAuth = vi.fn();

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(function ConvexHttpClientMock() {
    return {
      query: mockConvexQuery,
      setAuth: mockSetAuth,
    };
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
}));

let cancelSubscription: () => Promise<void>;
let resumeSubscription: () => Promise<void>;
let createCreditPackCheckoutSession: (
  prev: { error: "checkoutError" | null },
  formData: FormData,
) => Promise<{ error: "checkoutError" | null }>;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

  process.env.APP_URL = "https://app.test";

  ({ cancelSubscription, resumeSubscription, createCreditPackCheckoutSession } =
    await import("./actions"));
});

describe("cancelSubscription", () => {
  beforeEach(() => {
    mockSubscriptionsUpdate.mockReset();
    mockConvexQuery.mockReset();
    mockAuth.mockReset();
    mockSetAuth.mockReset();
  });

  it("unauthenticated caller throws UNAUTHENTICATED, no Stripe call", async () => {
    mockAuth.mockResolvedValue({
      userId: null,
      getToken: vi.fn(),
    });

    await expect(cancelSubscription()).rejects.toThrow("UNAUTHENTICATED");
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("caller whose getSubscription returns null throws CANCEL_REQUIRES_ACTIVE_SUBSCRIPTION, no Stripe call", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_free_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue(null);

    await expect(cancelSubscription()).rejects.toThrow(
      "CANCEL_REQUIRES_ACTIVE_SUBSCRIPTION",
    );
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("caller whose getSubscription status !== 'active' throws CANCEL_REQUIRES_ACTIVE_SUBSCRIPTION, no Stripe call", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_canceled_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue({
      status: "canceled",
      stripeSubscriptionId: "sub_canceled_1",
      cancelAtPeriodEnd: false,
    });

    await expect(cancelSubscription()).rejects.toThrow(
      "CANCEL_REQUIRES_ACTIVE_SUBSCRIPTION",
    );
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("authenticated caller with an active subscription calls stripe.subscriptions.update with cancel_at_period_end: true exactly once", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_active_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue({
      status: "active",
      stripeSubscriptionId: "sub_active_1",
      cancelAtPeriodEnd: false,
    });
    mockSubscriptionsUpdate.mockResolvedValue({});

    await cancelSubscription();

    expect(mockSubscriptionsUpdate).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith("sub_active_1", {
      cancel_at_period_end: true,
    });
  });

  it("a thrown Convex auth-handshake/query failure surfaces as subscriptionLookupFailed, never reaching Stripe", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_lookup_fail_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockRejectedValueOnce(
      new Error("convex auth handshake failed"),
    );

    await expect(cancelSubscription()).rejects.toThrow(
      "subscriptionLookupFailed",
    );
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });
});

describe("resumeSubscription", () => {
  beforeEach(() => {
    mockSubscriptionsUpdate.mockReset();
    mockConvexQuery.mockReset();
    mockAuth.mockReset();
    mockSetAuth.mockReset();
  });

  it("unauthenticated caller throws UNAUTHENTICATED, no Stripe call", async () => {
    mockAuth.mockResolvedValue({
      userId: null,
      getToken: vi.fn(),
    });

    await expect(resumeSubscription()).rejects.toThrow("UNAUTHENTICATED");
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("caller with cancelAtPeriodEnd !== true throws RESUME_REQUIRES_PENDING_CANCELLATION, no Stripe call", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_active_no_cancel_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue({
      status: "active",
      stripeSubscriptionId: "sub_active_no_cancel_1",
      cancelAtPeriodEnd: false,
    });

    await expect(resumeSubscription()).rejects.toThrow(
      "RESUME_REQUIRES_PENDING_CANCELLATION",
    );
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("caller whose getSubscription returns null throws RESUME_REQUIRES_PENDING_CANCELLATION, no Stripe call", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_free_2",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue(null);

    await expect(resumeSubscription()).rejects.toThrow(
      "RESUME_REQUIRES_PENDING_CANCELLATION",
    );
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("authenticated caller with cancelAtPeriodEnd === true calls stripe.subscriptions.update with cancel_at_period_end: false exactly once", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_cancelling_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue({
      status: "active",
      stripeSubscriptionId: "sub_cancelling_1",
      cancelAtPeriodEnd: true,
    });
    mockSubscriptionsUpdate.mockResolvedValue({});

    await resumeSubscription();

    expect(mockSubscriptionsUpdate).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith("sub_cancelling_1", {
      cancel_at_period_end: false,
    });
  });

  it("a thrown Convex auth-handshake/query failure surfaces as subscriptionLookupFailed, never reaching Stripe", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_lookup_fail_2",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockRejectedValueOnce(
      new Error("convex auth handshake failed"),
    );

    await expect(resumeSubscription()).rejects.toThrow(
      "subscriptionLookupFailed",
    );
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });
});

describe("createCreditPackCheckoutSession", () => {
  const initial = { error: null } as const;
  const redirectToSignIn = vi.fn();

  function form(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  beforeEach(() => {
    mockSessionsCreate.mockReset();
    mockRedirect.mockReset();
    mockAuth.mockReset();
    mockConvexQuery.mockReset();
    redirectToSignIn.mockReset();
    mockAuth.mockResolvedValue({ userId: "user_1", redirectToSignIn });
    process.env.STRIPE_PACK_DECOUVERTE_PRICE_ID = "price_dec";
    process.env.STRIPE_PACK_BOOST_PRICE_ID = "price_boost";
    process.env.STRIPE_PACK_PRO_PRICE_ID = "price_pro";
    mockSessionsCreate.mockResolvedValue({ url: "https://checkout.test/s" });
  });

  it("signed-out redirects to sign-in and never calls Stripe", async () => {
    mockAuth.mockResolvedValue({ userId: null, redirectToSignIn });
    await createCreditPackCheckoutSession(initial, form({ pack: "boost" }));
    expect(redirectToSignIn).toHaveBeenCalled();
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("creates a payment session with env price, auth userId metadata and redirects", async () => {
    await createCreditPackCheckoutSession(
      initial,
      form({ pack: "boost", returnTo: "notes" }),
    );
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    expect(mockSessionsCreate).toHaveBeenCalledWith({
      mode: "payment",
      line_items: [{ price: "price_boost", quantity: 1 }],
      metadata: {
        clerkUserId: "user_1",
        type: "ai_credit_pack",
        pack: "boost",
      },
      success_url: "https://app.test/notes",
      cancel_url: "https://app.test/notes",
    });
    expect(mockRedirect).toHaveBeenCalledWith("https://checkout.test/s");
    expect(mockConvexQuery).not.toHaveBeenCalled();
  });

  it("falls back to settings for a foreign or missing returnTo", async () => {
    await createCreditPackCheckoutSession(
      initial,
      form({ pack: "pro", returnTo: "https://evil.example" }),
    );
    await createCreditPackCheckoutSession(initial, form({ pack: "pro" }));
    expect(mockSessionsCreate).toHaveBeenCalledTimes(2);
    for (const call of mockSessionsCreate.mock.calls) {
      expect(call[0].success_url).toBe("https://app.test/settings");
      expect(call[0].cancel_url).toBe("https://app.test/settings");
    }
  });

  it.each(["toString", "", "gold"])(
    "unknown pack %j returns checkoutError without calling Stripe",
    async pack => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await createCreditPackCheckoutSession(
        initial,
        form({ pack }),
      );
      expect(result).toEqual({ error: "checkoutError" });
      expect(mockSessionsCreate).not.toHaveBeenCalled();
      spy.mockRestore();
    },
  );

  it("ignores forged price/amount/clerkUserId fields", async () => {
    await createCreditPackCheckoutSession(
      initial,
      form({
        pack: "decouverte",
        price: "price_evil",
        amount: "1",
        clerkUserId: "user_evil",
      }),
    );
    const args = mockSessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price).toBe("price_dec");
    expect(args.metadata.clerkUserId).toBe("user_1");
  });

  it("missing price env returns checkoutError and logs the env var name", async () => {
    delete process.env.STRIPE_PACK_PRO_PRICE_ID;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createCreditPackCheckoutSession(
      initial,
      form({ pack: "pro" }),
    );
    expect(result).toEqual({ error: "checkoutError" });
    expect(spy.mock.calls.flat().join(" ")).toContain(
      "STRIPE_PACK_PRO_PRICE_ID",
    );
    expect(mockSessionsCreate).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("Stripe failure returns checkoutError and does not redirect", async () => {
    mockSessionsCreate.mockRejectedValue(new Error("stripe down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createCreditPackCheckoutSession(
      initial,
      form({ pack: "boost" }),
    );
    expect(result).toEqual({ error: "checkoutError" });
    expect(mockRedirect).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
