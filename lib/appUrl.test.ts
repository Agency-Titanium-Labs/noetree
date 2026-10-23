import { afterEach, describe, expect, it } from "vitest";
import { getAppUrl } from "./appUrl";

const KEYS = ["APP_URL", "VERCEL_ENV", "VERCEL_BRANCH_URL"] as const;
const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getAppUrl", () => {
  it("prefers APP_URL", () => {
    process.env.APP_URL = "https://noetree.com";
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "x-git-b.vercel.app";
    expect(getAppUrl()).toBe("https://noetree.com");
  });

  it("falls back to the branch URL on preview only", () => {
    delete process.env.APP_URL;
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "x-git-b.vercel.app";
    expect(getAppUrl()).toBe("https://x-git-b.vercel.app");
  });

  it("never falls back in production", () => {
    delete process.env.APP_URL;
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_BRANCH_URL = "x-git-b.vercel.app";
    expect(getAppUrl()).toBeUndefined();
  });
});
