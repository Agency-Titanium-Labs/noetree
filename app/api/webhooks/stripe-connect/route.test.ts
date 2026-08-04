import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { ConvexError } from "convex/values";

const mockConstructEvent = vi.fn();
const mockAction = vi.fn();

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function StripeMock() {
    return {
      webhooks: { constructEvent: mockConstructEvent },
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
  // Distinct sentinel values so the secret-isolation test is meaningful.
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_platform_sentinel";
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_connect_sentinel";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.INTERNAL_WEBHOOK_SECRET = "shared-secret";

  ({ POST } = await import("./route"));
});

function makeRequest(rawBody: string, signature = "test_sig"): Request {
  return new Request("http://localhost/api/webhooks/stripe-connect", {
    method: "POST",
    body: rawBody,
    headers: { "stripe-signature": signature },
  });
}

describe("POST /api/webhooks/stripe-connect", () => {
  beforeEach(() => {
    mockConstructEvent.mockReset();
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
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("returns 200 when the signature is valid and the Convex action resolves", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_1",
      type: "account.updated",
      account: "acct_1",
      data: { object: { charges_enabled: true } },
    });
    mockAction.mockResolvedValue({ success: true });

    const res = await POST(makeRequest("{}"));

    expect(res.status).toBe(200);
  });

  it("returns 400 (not 500) when the Convex action rejects with a ConvexError carrying an Unauthorized-prefixed data payload", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_2",
      type: "account.updated",
      account: "acct_2",
      data: { object: {} },
    });
    const authError = new ConvexError<string>("Server Error");
    authError.data = "Unauthorized: invalid internal webhook secret";
    mockAction.mockRejectedValue(authError);

    const res = await POST(makeRequest("{}"));

    expect(res.status).toBe(400);
  });

  it("returns 500 when the Convex action rejects with a generic Error, and logs it", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_3",
      type: "account.updated",
      account: "acct_3",
      data: { object: {} },
    });
    mockAction.mockRejectedValue(new Error("Convex unreachable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest("{}"));

    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("verifies the signature against STRIPE_CONNECT_WEBHOOK_SECRET, not STRIPE_WEBHOOK_SECRET", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_4",
      type: "account.updated",
      account: "acct_4",
      data: { object: {} },
    });
    mockAction.mockResolvedValue({ success: true });

    await POST(makeRequest("{}"));

    expect(mockConstructEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "whsec_connect_sentinel",
    );
    expect(mockConstructEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "whsec_platform_sentinel",
    );
  });

  it("forwards the verified event to processConnectWebhookEvent with the INTERNAL_WEBHOOK_SECRET", async () => {
    const event = {
      id: "evt_5",
      type: "account.updated",
      account: "acct_5",
      data: { object: { charges_enabled: true } },
    };
    mockConstructEvent.mockReturnValue(event);
    mockAction.mockResolvedValue({ success: true });

    await POST(makeRequest("{}"));

    expect(mockAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event,
        secret: "shared-secret",
      }),
    );
  });
});
