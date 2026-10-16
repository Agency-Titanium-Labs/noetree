import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { ConvexError } from "convex/values";

const mockConstructEvent = vi.fn();
const mockRetrieve = vi.fn();
const mockAction = vi.fn();

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function StripeMock() {
    return {
      webhooks: { constructEvent: mockConstructEvent },
      subscriptions: { retrieve: mockRetrieve },
    };
  }),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(function ConvexHttpClientMock() {
    return {
      action: mockAction,
    };
  }),
}));

let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_123";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.INTERNAL_WEBHOOK_SECRET = "shared-secret";

  ({ POST } = await import("./route"));
});

function makeRequest(rawBody: string, signature = "test_sig"): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: rawBody,
    headers: { "stripe-signature": signature },
  });
}

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    mockConstructEvent.mockReset();
    mockRetrieve.mockReset();
    mockAction.mockReset();
  });

  it("returns 400 when the Stripe signature is invalid, and never calls Convex", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("invalid signature");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest("{}"));

    expect(res.status).toBe(400);
    expect(mockAction).not.toHaveBeenCalled();
    // Gap closure (03-06): guards against the diagnostic logging silently
    // regressing on the 400 signature-failure path.
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("returns 200 when the signature is valid and the Convex action resolves", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_1",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    });
    mockAction.mockResolvedValue({ ok: true });

    const res = await POST(makeRequest("{}"));

    expect(res.status).toBe(200);
  });

  it("returns 500 when the Convex action rejects with a generic error (D-11 genuine failure)", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_2",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_2" } },
    });
    mockAction.mockRejectedValue(new Error("Convex unreachable"));

    const res = await POST(makeRequest("{}"));

    expect(res.status).toBe(500);
  });

  it("returns 400 (not 500) when the Convex action rejects with a ConvexError carrying an Unauthorized-prefixed data payload (D-02/D-10, CR-01)", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_3",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_3" } },
    });
    // Models what ConvexHttpClient actually reconstructs across the action
    // boundary in production: a ConvexError whose `.message` may be redacted
    // to something generic, but whose `.data` always preserves the original
    // string thrown via `new ConvexError(...)` (see
    // node_modules/convex/dist/cjs/browser/http_client.js `forwardErrorData`).
    // Checking `.message` here (as the pre-CR-01 code did) would fail to catch
    // this — only `.data` is reliable.
    const authError = new ConvexError<string>("Server Error");
    authError.data = "Unauthorized: invalid internal webhook secret";
    mockAction.mockRejectedValue(authError);

    const res = await POST(makeRequest("{}"));

    expect(res.status).toBe(400);
  });

  it("returns 500 (not 400) when the Convex action rejects with a plain Error whose message happens to start with Unauthorized (CR-01 regression guard)", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_3b",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_3b" } },
    });
    // A plain Error (not a ConvexError) must never be treated as an auth
    // failure, since only ConvexError.data is guaranteed to survive
    // production's message redaction across the action boundary.
    mockAction.mockRejectedValue(
      new Error("Unauthorized: invalid internal webhook secret"),
    );

    const res = await POST(makeRequest("{}"));

    expect(res.status).toBe(500);
  });

  it("enriches checkout.session.completed with a subscriptionSnapshot via stripe.subscriptions.retrieve", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_4",
      type: "checkout.session.completed",
      data: {
        object: {
          subscription: "sub_30",
          metadata: { clerkUserId: "user_30" },
        },
      },
    });
    mockRetrieve.mockResolvedValue({
      status: "active",
      items: { data: [{ current_period_end: 12345 }] },
      cancel_at_period_end: false,
    });
    mockAction.mockResolvedValue({ ok: true });

    const res = await POST(makeRequest("{}"));

    expect(res.status).toBe(200);
    expect(mockRetrieve).toHaveBeenCalledWith("sub_30");
    expect(mockAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: expect.objectContaining({
          data: expect.objectContaining({
            object: expect.objectContaining({
              subscriptionSnapshot: {
                status: "active",
                currentPeriodEnd: 12345,
                cancelAtPeriodEnd: false,
              },
            }),
          }),
        }),
        secret: "shared-secret",
      }),
    );
  });

  it("does not call stripe.subscriptions.retrieve for non-checkout.session.completed events", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_5",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_5", status: "active" } },
    });
    mockAction.mockResolvedValue({ ok: true });

    const res = await POST(makeRequest("{}"));

    expect(res.status).toBe(200);
    expect(mockRetrieve).not.toHaveBeenCalled();
  });
});
