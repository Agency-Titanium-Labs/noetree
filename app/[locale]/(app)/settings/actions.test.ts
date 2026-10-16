import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const mockSubscriptionsUpdate = vi.fn();
const mockConvexQuery = vi.fn();
const mockAuth = vi.fn();

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function StripeMock() {
    return {
      subscriptions: { update: mockSubscriptionsUpdate },
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

let cancelSubscription: () => Promise<void>;
let resumeSubscription: () => Promise<void>;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

  ({ cancelSubscription, resumeSubscription } = await import("./actions"));
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
