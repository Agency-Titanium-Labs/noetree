import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const mockSessionsCreate = vi.fn();
const mockConvexQuery = vi.fn();
const mockAuth = vi.fn();
const mockRedirectNav = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function StripeMock() {
    return {
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

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirectNav,
  // next-intl's createNavigation (used by "@/i18n/routing") destructures both
  // `redirect` and `permanentRedirect` from "next/navigation" at module-load
  // time, even though only `redirect` is ever invoked by this action.
  permanentRedirect: vi.fn(),
}));

let createCheckoutSession: (
  locale: string,
  interval: "monthly" | "annual",
) => Promise<void>;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  // Kept set (never referenced by actions.ts anymore) so Test 4 can assert
  // it is unused as a line_items price.
  process.env.STRIPE_PRO_PRICE_ID = "price_test_123";
  process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID = "price_premium_monthly_test";
  process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID = "price_premium_annual_test";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.APP_URL = "https://localhost:3000";

  ({ createCheckoutSession } = await import("./actions"));
});

describe("createCheckoutSession", () => {
  beforeEach(() => {
    mockSessionsCreate.mockReset();
    mockConvexQuery.mockReset();
    mockAuth.mockReset();
    mockRedirectNav.mockClear();
  });

  it("signed-out visitor is redirected to sign-in, and never calls Stripe (D-02)", async () => {
    const mockRedirectToSignIn = vi.fn();
    mockAuth.mockResolvedValue({
      userId: null,
      redirectToSignIn: mockRedirectToSignIn,
    });

    await createCheckoutSession("en", "monthly");

    expect(mockRedirectToSignIn).toHaveBeenCalledWith(
      expect.objectContaining({
        returnBackUrl: expect.stringContaining("/en/pricing"),
      }),
    );
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("already-active subscription short-circuits straight to the success page, no Stripe call (D-08)", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_active_1",
      redirectToSignIn: vi.fn(),
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue({
      status: "active",
      stripeCustomerId: "cus_active_1",
    });

    await expect(createCheckoutSession("en", "monthly")).rejects.toThrow(
      /REDIRECT:/,
    );

    expect(mockRedirectNav).toHaveBeenCalledWith(
      expect.stringContaining("/en/checkout/success"),
    );
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("no/inactive subscription creates a Checkout Session with correct metadata + conditional customer reuse (D-06/D-07)", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_new_1",
      redirectToSignIn: vi.fn(),
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/session_1",
    });

    // No existing subscription row: no `customer` param should be set (Stripe creates a new customer).
    mockConvexQuery.mockResolvedValueOnce(null);
    await expect(createCheckoutSession("en", "monthly")).rejects.toThrow(
      /REDIRECT:/,
    );
    expect(mockSessionsCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        mode: "subscription",
        line_items: [
          expect.objectContaining({ price: "price_premium_monthly_test" }),
        ],
        metadata: expect.objectContaining({ clerkUserId: "user_new_1" }),
        subscription_data: expect.objectContaining({
          metadata: expect.objectContaining({ clerkUserId: "user_new_1" }),
        }),
      }),
    );
    expect(mockSessionsCreate.mock.calls[0][0]).not.toHaveProperty("customer");

    // Existing inactive row: stripeCustomerId reused (D-06), same metadata contract (D-07).
    mockConvexQuery.mockResolvedValueOnce({
      status: "canceled",
      stripeCustomerId: "cus_existing_1",
    });
    await expect(createCheckoutSession("en", "monthly")).rejects.toThrow(
      /REDIRECT:/,
    );
    expect(mockSessionsCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        customer: "cus_existing_1",
        metadata: expect.objectContaining({ clerkUserId: "user_new_1" }),
        subscription_data: expect.objectContaining({
          metadata: expect.objectContaining({ clerkUserId: "user_new_1" }),
        }),
      }),
    );
  });

  it("a thrown Convex auth-handshake/query failure surfaces as subscriptionLookupFailed, never reaching Stripe (gap closure)", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_lookup_fail_1",
      redirectToSignIn: vi.fn(),
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockRejectedValueOnce(
      new Error("convex auth handshake failed"),
    );

    await expect(createCheckoutSession("en", "monthly")).rejects.toThrow(
      /subscriptionLookupFailed/,
    );
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('createCheckoutSession("en", "annual") creates a session priced at STRIPE_PREMIUM_ANNUAL_PRICE_ID', async () => {
    mockAuth.mockResolvedValue({
      userId: "user_annual_1",
      redirectToSignIn: vi.fn(),
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValueOnce(null);
    mockSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/session_annual",
    });

    await expect(createCheckoutSession("en", "annual")).rejects.toThrow(
      /REDIRECT:/,
    );

    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          expect.objectContaining({ price: "price_premium_annual_test" }),
        ],
      }),
    );
  });

  it('createCheckoutSession("en", "monthly") creates a session priced at STRIPE_PREMIUM_MONTHLY_PRICE_ID', async () => {
    mockAuth.mockResolvedValue({
      userId: "user_monthly_1",
      redirectToSignIn: vi.fn(),
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValueOnce(null);
    mockSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/session_monthly",
    });

    await expect(createCheckoutSession("en", "monthly")).rejects.toThrow(
      /REDIRECT:/,
    );

    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          expect.objectContaining({ price: "price_premium_monthly_test" }),
        ],
      }),
    );
  });

  it("V5 tamper guard: an out-of-union interval falls back to monthly and the raw value never reaches Stripe", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_tamper_1",
      redirectToSignIn: vi.fn(),
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValueOnce(null);
    mockSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/session_tamper",
    });

    const tamperedInterval = "price_premium_annual_test" as unknown as
      | "monthly"
      | "annual";

    await expect(createCheckoutSession("en", tamperedInterval)).rejects.toThrow(
      /REDIRECT:/,
    );

    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          expect.objectContaining({ price: "price_premium_monthly_test" }),
        ],
      }),
    );
    const callArgs = JSON.stringify(mockSessionsCreate.mock.calls[0][0]);
    expect(callArgs).not.toContain(tamperedInterval);
  });

  it("STRIPE_PRO_PRICE_ID is never used as a line_items price by any call", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_no_pro_1",
      redirectToSignIn: vi.fn(),
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValueOnce(null);
    mockSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/session_no_pro",
    });

    await expect(createCheckoutSession("en", "monthly")).rejects.toThrow(
      /REDIRECT:/,
    );

    for (const call of mockSessionsCreate.mock.calls) {
      const lineItems = call[0].line_items as Array<{ price: string }>;
      for (const item of lineItems) {
        expect(item.price).not.toBe(process.env.STRIPE_PRO_PRICE_ID);
      }
    }
  });
});
