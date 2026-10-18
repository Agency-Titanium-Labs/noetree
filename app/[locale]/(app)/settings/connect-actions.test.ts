import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const mockAccountsCreate = vi.fn();
const mockAccountLinksCreate = vi.fn();
const mockCreateLoginLink = vi.fn();
const mockConvexQuery = vi.fn();
const mockConvexAction = vi.fn();
const mockSetAuth = vi.fn();
const mockAuth = vi.fn();
const mockRedirectNav = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function StripeMock() {
    return {
      accounts: {
        create: mockAccountsCreate,
        createLoginLink: mockCreateLoginLink,
      },
      accountLinks: { create: mockAccountLinksCreate },
    };
  }),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(function ConvexHttpClientMock() {
    return {
      query: mockConvexQuery,
      action: mockConvexAction,
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

let createConnectOnboardingLink: (locale: string) => Promise<void>;
let createConnectLoginLink: () => Promise<void>;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.APP_URL = "https://noetree.app";
  process.env.INTERNAL_WEBHOOK_SECRET = "shared-secret";

  ({ createConnectOnboardingLink, createConnectLoginLink } =
    await import("./connect-actions"));
});

describe("createConnectOnboardingLink", () => {
  beforeEach(() => {
    mockAccountsCreate.mockReset();
    mockAccountLinksCreate.mockReset();
    mockConvexQuery.mockReset();
    mockConvexAction.mockReset();
    mockAuth.mockReset();
    mockSetAuth.mockReset();
    mockRedirectNav.mockClear();
  });

  it("unauthenticated caller throws UNAUTHENTICATED, no Stripe or Convex mutation calls", async () => {
    mockAuth.mockResolvedValue({ userId: null, getToken: vi.fn() });

    await expect(createConnectOnboardingLink("en")).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(mockAccountLinksCreate).not.toHaveBeenCalled();
    expect(mockConvexAction).not.toHaveBeenCalled();
  });

  it("first-time seller creates a Stripe Express account, records it, and mints a fresh link", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_new_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue(null);
    mockAccountsCreate.mockResolvedValue({ id: "acct_new_1" });
    mockConvexAction.mockResolvedValue({ created: true });
    mockAccountLinksCreate.mockResolvedValue({
      url: "https://connect.stripe.com/setup/acct_new_1",
    });

    await expect(createConnectOnboardingLink("en")).rejects.toThrow(
      "NEXT_REDIRECT:https://connect.stripe.com/setup/acct_new_1",
    );

    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    expect(mockAccountsCreate).toHaveBeenCalledWith(
      {
        type: "express",
        metadata: { clerkUserId: "user_new_1" },
      },
      { idempotencyKey: "connect-account-create-user_new_1" },
    );
    expect(mockConvexAction).toHaveBeenCalledTimes(1);
    expect(mockConvexAction).toHaveBeenCalledWith(expect.anything(), {
      secret: "shared-secret",
      clerkUserId: "user_new_1",
      stripeAccountId: "acct_new_1",
    });
    expect(mockAccountLinksCreate).toHaveBeenCalledTimes(1);
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ account: "acct_new_1" }),
    );
  });

  it("lost race: when recordPendingAccount reports alreadyExists, the existing account id is reused for the link (CR-01)", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_race_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue(null);
    mockAccountsCreate.mockResolvedValue({ id: "acct_duplicate" });
    mockConvexAction.mockResolvedValue({
      alreadyExists: true,
      stripeAccountId: "acct_first",
    });
    mockAccountLinksCreate.mockResolvedValue({
      url: "https://connect.stripe.com/setup/acct_first",
    });

    await expect(createConnectOnboardingLink("en")).rejects.toThrow(
      "NEXT_REDIRECT:https://connect.stripe.com/setup/acct_first",
    );

    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ account: "acct_first" }),
    );
  });

  it("returning seller skips account creation/recording but still mints a fresh link with the existing account id (D-07)", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_existing_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue({ stripeAccountId: "acct_existing" });
    mockAccountLinksCreate.mockResolvedValue({
      url: "https://connect.stripe.com/setup/acct_existing",
    });

    await expect(createConnectOnboardingLink("en")).rejects.toThrow(
      "NEXT_REDIRECT:https://connect.stripe.com/setup/acct_existing",
    );

    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(mockConvexAction).not.toHaveBeenCalled();
    expect(mockAccountLinksCreate).toHaveBeenCalledTimes(1);
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ account: "acct_existing" }),
    );
  });

  it("two sequential calls for a returning seller mint two fresh links and create zero Stripe accounts", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_existing_2",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue({ stripeAccountId: "acct_existing_2" });
    mockAccountLinksCreate.mockResolvedValue({
      url: "https://connect.stripe.com/setup/acct_existing_2",
    });

    await expect(createConnectOnboardingLink("en")).rejects.toThrow(
      /NEXT_REDIRECT:/,
    );
    await expect(createConnectOnboardingLink("en")).rejects.toThrow(
      /NEXT_REDIRECT:/,
    );

    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(mockAccountLinksCreate).toHaveBeenCalledTimes(2);
  });

  it("locale allow-list: a path-traversal locale collapses to the default locale in both URLs", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_locale_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue({ stripeAccountId: "acct_locale_1" });
    mockAccountLinksCreate.mockResolvedValue({
      url: "https://connect.stripe.com/setup/acct_locale_1",
    });

    await expect(createConnectOnboardingLink("../evil")).rejects.toThrow(
      /NEXT_REDIRECT:/,
    );

    const call = mockAccountLinksCreate.mock.calls[0][0];
    expect(call.refresh_url).toBe(call.return_url);
    expect(call.refresh_url.endsWith("/en/settings")).toBe(true);
  });

  it("locale allow-list: a supported non-default locale (fr) is honored in both URLs", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_locale_2",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue({ stripeAccountId: "acct_locale_2" });
    mockAccountLinksCreate.mockResolvedValue({
      url: "https://connect.stripe.com/setup/acct_locale_2",
    });

    await expect(createConnectOnboardingLink("fr")).rejects.toThrow(
      /NEXT_REDIRECT:/,
    );

    const call = mockAccountLinksCreate.mock.calls[0][0];
    expect(call.refresh_url).toBe(call.return_url);
    expect(call.refresh_url.endsWith("/fr/settings")).toBe(true);
  });

  it("a Convex status lookup/auth-handshake failure surfaces as connectStatusLookupFailed, no Stripe call", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_lookup_fail_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockRejectedValueOnce(
      new Error("convex auth handshake failed"),
    );

    await expect(createConnectOnboardingLink("en")).rejects.toThrow(
      "connectStatusLookupFailed",
    );
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(mockAccountLinksCreate).not.toHaveBeenCalled();
  });

  it("a null Convex token aborts with connectStatusLookupFailed and creates no Stripe account (WR-01)", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_null_token",
      getToken: vi.fn().mockResolvedValue(null),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(createConnectOnboardingLink("en")).rejects.toThrow(
      "connectStatusLookupFailed",
    );
    expect(mockConvexQuery).not.toHaveBeenCalled();
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("stripe.accounts.create failure surfaces as connectAccountCreationFailed, accountLinks.create never called", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_create_fail_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue(null);
    mockAccountsCreate.mockRejectedValueOnce(new Error("stripe down"));

    await expect(createConnectOnboardingLink("en")).rejects.toThrow(
      "connectAccountCreationFailed",
    );
    expect(mockConvexAction).not.toHaveBeenCalled();
    expect(mockAccountLinksCreate).not.toHaveBeenCalled();
  });

  it("recordPendingAccount failure surfaces as connectAccountRecordFailed, accountLinks.create never called", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_record_fail_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue(null);
    mockAccountsCreate.mockResolvedValue({ id: "acct_record_fail_1" });
    mockConvexAction.mockRejectedValueOnce(new Error("convex down"));

    await expect(createConnectOnboardingLink("en")).rejects.toThrow(
      "connectAccountRecordFailed",
    );
    expect(mockAccountLinksCreate).not.toHaveBeenCalled();
  });

  it("stripe.accountLinks.create failure surfaces as connectAccountLinkCreationFailed", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_link_fail_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue({ stripeAccountId: "acct_link_fail_1" });
    mockAccountLinksCreate.mockRejectedValueOnce(new Error("stripe down"));

    await expect(createConnectOnboardingLink("en")).rejects.toThrow(
      "connectAccountLinkCreationFailed",
    );
  });

  it("success path calls redirect exactly once with the URL returned by accountLinks.create", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_success_1",
      getToken: vi.fn().mockResolvedValue("mock_convex_token"),
    });
    mockConvexQuery.mockResolvedValue({ stripeAccountId: "acct_success_1" });
    mockAccountLinksCreate.mockResolvedValue({
      url: "https://connect.stripe.com/setup/acct_success_1",
    });

    await expect(createConnectOnboardingLink("en")).rejects.toThrow(
      /NEXT_REDIRECT:/,
    );

    expect(mockRedirectNav).toHaveBeenCalledTimes(1);
    expect(mockRedirectNav).toHaveBeenCalledWith(
      "https://connect.stripe.com/setup/acct_success_1",
    );
  });
});

describe("createConnectLoginLink", () => {
  const activeAccount = {
    stripeAccountId: "acct_seller",
    status: "active",
    chargesEnabled: true,
    payoutsEnabled: true,
  };

  function authed(token: string | null = "mock_convex_token") {
    mockAuth.mockResolvedValue({
      userId: "user_seller_1",
      getToken: vi.fn().mockResolvedValue(token),
    });
  }

  beforeEach(() => {
    mockCreateLoginLink.mockReset();
    mockConvexQuery.mockReset();
    mockAuth.mockReset();
    mockSetAuth.mockReset();
    mockRedirectNav.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("unauthenticated caller throws UNAUTHENTICATED, Stripe not called", async () => {
    mockAuth.mockResolvedValue({ userId: null, getToken: vi.fn() });
    await expect(createConnectLoginLink()).rejects.toThrow("UNAUTHENTICATED");
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
  });

  it("null Convex token throws connectStatusLookupFailed, Stripe not called", async () => {
    authed(null);
    await expect(createConnectLoginLink()).rejects.toThrow(
      "connectStatusLookupFailed",
    );
    expect(mockConvexQuery).not.toHaveBeenCalled();
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
  });

  it("no Connect account throws connectNotActive, Stripe not called", async () => {
    authed();
    mockConvexQuery.mockResolvedValue(null);
    await expect(createConnectLoginLink()).rejects.toThrow("connectNotActive");
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
  });

  it("pending account throws connectNotActive, Stripe not called", async () => {
    authed();
    mockConvexQuery.mockResolvedValue({
      ...activeAccount,
      status: "pending",
      chargesEnabled: false,
    });
    await expect(createConnectLoginLink()).rejects.toThrow("connectNotActive");
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
  });

  it("payouts disabled throws connectNotActive", async () => {
    authed();
    mockConvexQuery.mockResolvedValue({
      ...activeAccount,
      payoutsEnabled: false,
    });
    await expect(createConnectLoginLink()).rejects.toThrow("connectNotActive");
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
  });

  it("active account mints a login link for the server-read account id and redirects", async () => {
    authed("tok_abc");
    mockConvexQuery.mockResolvedValue(activeAccount);
    mockCreateLoginLink.mockResolvedValue({
      url: "https://connect.stripe.com/express/abc",
    });

    await expect(createConnectLoginLink()).rejects.toThrow(
      "NEXT_REDIRECT:https://connect.stripe.com/express/abc",
    );
    expect(mockSetAuth).toHaveBeenCalledWith("tok_abc");
    expect(mockCreateLoginLink).toHaveBeenCalledTimes(1);
    expect(mockCreateLoginLink).toHaveBeenCalledWith("acct_seller");
  });

  it("createLoginLink failure throws connectLoginLinkFailed and does not redirect", async () => {
    authed();
    mockConvexQuery.mockResolvedValue(activeAccount);
    mockCreateLoginLink.mockRejectedValueOnce(new Error("stripe down"));
    await expect(createConnectLoginLink()).rejects.toThrow(
      "connectLoginLinkFailed",
    );
    expect(mockRedirectNav).not.toHaveBeenCalled();
  });
});
