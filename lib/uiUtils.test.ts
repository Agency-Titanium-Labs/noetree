import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import { getInitials } from "./initials";
import { formatFullDate, formatRelativeTime } from "./relativeTime";

describe("initials", () => {
  it("builds initials from names", () => {
    expect(getInitials("Alex Martin")).toBe("AM");
    expect(getInitials("alex")).toBe("A");
    expect(getInitials("Ann Bea Cole")).toBe("AB");
  });
  it("falls back to ? for missing names", () => {
    expect(getInitials(undefined)).toBe("?");
    expect(getInitials(null)).toBe("?");
    expect(getInitials("")).toBe("?");
    expect(getInitials("  ")).toBe("?");
  });
});

describe("relative time", () => {
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);
  it("formats recent times", () => {
    const s = formatRelativeTime(now - 30_000, "en", now);
    expect(s.length).toBeGreaterThan(0);
    expect(s).not.toContain("NaN");
    expect(formatRelativeTime(now - 5 * 60_000, "en", now)).toBe(
      "5 minutes ago",
    );
    expect(formatRelativeTime(now - 2 * 3_600_000, "en", now)).toBe(
      "2 hours ago",
    );
  });
  it("localizes to French", () => {
    expect(formatRelativeTime(now - 3 * 86_400_000, "fr", now)).toBe(
      "il y a 3 jours",
    );
  });
  it("formats full date with year", () => {
    expect(formatFullDate(now, "en")).toContain("2026");
  });
});

describe("i18n parity", () => {
  for (const ns of ["Comments", "Notifications"] as const) {
    it(`${ns} keys match between en and fr`, () => {
      expect(Object.keys(fr[ns])).toEqual(Object.keys(en[ns]));
      for (const m of [en, fr]) {
        for (const value of Object.values(m[ns])) {
          expect(typeof value).toBe("string");
          expect((value as string).length).toBeGreaterThan(0);
        }
      }
    });
  }
  it("has expected strings", () => {
    expect(en.Comments.postCta).toBe("Post comment");
    expect(fr.Comments.postCta).toBe("Publier le commentaire");
    expect(en.Notifications.textReply).toContain("{actor}");
    expect(en.Notifications.textReply).toContain("{title}");
  });
});
