import { describe, expect, it, vi } from "vitest";
import { GatewayError, createGatewayClient } from "./linkGateway";
import { EMBEDDING_DIMENSIONS } from "./linkConfig";

const vec = () => new Array(EMBEDDING_DIMENSIONS).fill(0.1);
const ok = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200 });
const env = { AI_GATEWAY_API_KEY: "k-secret" };

describe("gateway client", () => {
  it("refuses without a key, before any request", async () => {
    const f = vi.fn();
    const c = createGatewayClient({}, f);
    await expect(c.embed(["a"])).rejects.toMatchObject({ kind: "NO_KEY" });
    expect(f).not.toHaveBeenCalled();
  });

  it("posts to /v1/embeddings with bearer auth and the configured model", async () => {
    const f = vi.fn(async () => ok({ data: [{ index: 0, embedding: vec() }] }));
    const c = createGatewayClient(
      { ...env, AI_EMBEDDING_MODEL: "google/gemini-embedding-001" },
      f,
    );
    await c.embed(["hello"]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/embeddings");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer k-secret",
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "google/gemini-embedding-001",
      input: ["hello"],
    });
  });

  it("defaults to google/text-embedding-005 and ignores a malformed override", () => {
    expect(createGatewayClient(env, vi.fn()).embeddingModel).toBe(
      "google/text-embedding-005",
    );
    expect(
      createGatewayClient({ ...env, AI_EMBEDDING_MODEL: "bad model!" }, vi.fn())
        .embeddingModel,
    ).toBe("google/text-embedding-005");
  });

  it("returns vectors in input order using `index`", async () => {
    const a = vec();
    const b = vec().map(() => 0.9);
    const f = vi.fn(async () =>
      ok({
        data: [
          { index: 1, embedding: b },
          { index: 0, embedding: a },
        ],
      }),
    );
    const out = await createGatewayClient(env, f).embed(["x", "y"]);
    expect(out[0][0]).toBe(0.1);
    expect(out[1][0]).toBe(0.9);
  });

  it("rejects wrong dimensions, wrong count and malformed bodies", async () => {
    const run = (body: unknown) =>
      createGatewayClient(env, async () => ok(body)).embed(["a", "b"]);
    await expect(
      run({ data: [{ embedding: [1] }, { embedding: [1] }] }),
    ).rejects.toMatchObject({ kind: "DIMENSION" });
    await expect(run({ data: [{ embedding: vec() }] })).rejects.toMatchObject({
      kind: "BAD_RESPONSE",
    });
    await expect(run({})).rejects.toMatchObject({ kind: "BAD_RESPONSE" });
    await expect(
      run({
        data: [
          { index: 0, embedding: vec() },
          { index: 0, embedding: vec() },
        ],
      }),
    ).rejects.toMatchObject({ kind: "BAD_RESPONSE" });
    const nan = vec();
    nan[3] = Number.NaN;
    await expect(
      createGatewayClient(env, async () =>
        ok({ data: [{ embedding: nan }] }),
      ).embed(["a"]),
    ).rejects.toMatchObject({ kind: "BAD_RESPONSE" });
  });

  it("retries once on 5xx, never on 4xx, and marks auth failures fatal", async () => {
    let n = 0;
    const flaky = vi.fn(async () =>
      n++ === 0
        ? new Response("x", { status: 503 })
        : ok({ data: [{ embedding: vec() }] }),
    );
    await createGatewayClient(env, flaky).embed(["a"]);
    expect(flaky).toHaveBeenCalledTimes(2);

    const denied = vi.fn(async () => new Response("no", { status: 403 }));
    const err = await createGatewayClient(env, denied)
      .embed(["a"])
      .catch(e => e as GatewayError);
    expect(denied).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).fatal).toBe(true);
    expect((err as Error).message).not.toContain("k-secret");

    const down = vi.fn(async () => new Response("x", { status: 500 }));
    const e2 = await createGatewayClient(env, down)
      .embed(["a"])
      .catch(e => e as GatewayError);
    expect(down).toHaveBeenCalledTimes(2);
    expect((e2 as GatewayError).fatal).toBe(false);
  });

  it("reads choices[0].message.content from chat completions", async () => {
    const f = vi.fn(async () =>
      ok({ choices: [{ message: { content: "One sentence." } }] }),
    );
    const c = createGatewayClient(env, f);
    expect(await c.complete({ system: "s", user: "u" })).toBe("One sentence.");
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://ai-gateway.vercel.sh/v1/chat/completions",
    );
    await expect(
      createGatewayClient(env, async () => ok({ choices: [] })).complete({
        system: "s",
        user: "u",
      }),
    ).rejects.toMatchObject({ kind: "BAD_RESPONSE" });
  });
});
