// @vitest-environment node
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["_generated", "node_modules", ".next"]);

function walk(dir: string, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      out.push(path.join(dir, entry.name));
    }
  }
}

describe("no refund (D-14 / BUY-05)", () => {
  test("no refund mutation, query or Stripe refunds call exists", () => {
    const root = path.resolve(__dirname, "..");
    const files: string[] = [];
    for (const d of ["convex", "app", "components"]) {
      const p = path.join(root, d);
      if (fs.existsSync(p)) walk(p, files);
    }
    expect(files.length).toBeGreaterThan(0);
    const patterns = [
      /refunds\.create/,
      /stripe\.refunds/,
      /export\s+(const|async function|function)\s+\w*refund\w*/i,
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const re of patterns) {
        if (re.test(src)) offenders.push(`${path.relative(root, f)} ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
