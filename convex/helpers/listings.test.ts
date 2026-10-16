import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import {
  buildSearchText,
  extractExcerpt,
  normalizeTags,
  toPublicListing,
  validateListingFields,
} from "./listings";

function expectConvexErrorCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<string>).data).toBe(code);
    return;
  }
  expect.unreachable("expected function to throw");
}

const para = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });

describe("listing helpers — pure", () => {
  test("extractExcerpt joins paragraphs with a space", () => {
    expect(extractExcerpt(doc(para("Hello"), para("world")))).toBe(
      "Hello world",
    );
  });

  test("extractExcerpt returns empty string for empty or malformed content", () => {
    expect(extractExcerpt("{}")).toBe("");
    expect(extractExcerpt("not json")).toBe("");
    expect(extractExcerpt("")).toBe("");
  });

  test("extractExcerpt truncates long text at a word boundary with ellipsis", () => {
    const out = extractExcerpt(doc(para("word ".repeat(200))));
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1).endsWith("word")).toBe(true);
  });

  test("extractExcerpt never leaks image src or link href", () => {
    const content = doc(
      { type: "image", attrs: { src: "https://secret.example/x.png" } },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "click",
            marks: [
              { type: "link", attrs: { href: "https://secret.example" } },
            ],
          },
        ],
      },
    );
    const out = extractExcerpt(content);
    expect(out).toBe("click");
    expect(out).not.toContain("secret.example");
  });

  test("normalizeTags trims, lowercases and dedupes", () => {
    expect(normalizeTags([" Math ", "math", "PHYSICS", ""])).toEqual([
      "math",
      "physics",
    ]);
  });

  test("normalizeTags rejects more than 5 tags or tags over 24 chars", () => {
    expectConvexErrorCode(
      () => normalizeTags(["a", "b", "c", "d", "e", "f"]),
      "LISTING_INVALID_TAGS",
    );
    expectConvexErrorCode(
      () => normalizeTags(["x".repeat(25)]),
      "LISTING_INVALID_TAGS",
    );
  });

  test("validateListingFields enforces title and description bounds", () => {
    const ok = { title: "T", description: "D", priceCents: 100 };
    expectConvexErrorCode(
      () => validateListingFields({ ...ok, title: "  " }),
      "LISTING_INVALID_FIELD",
    );
    expectConvexErrorCode(
      () => validateListingFields({ ...ok, title: "x".repeat(101) }),
      "LISTING_INVALID_FIELD",
    );
    expectConvexErrorCode(
      () => validateListingFields({ ...ok, description: "" }),
      "LISTING_INVALID_FIELD",
    );
    expectConvexErrorCode(
      () => validateListingFields({ ...ok, description: "x".repeat(1001) }),
      "LISTING_INVALID_FIELD",
    );
  });

  test("validateListingFields enforces price bounds and trims", () => {
    for (const priceCents of [99, 50001, 150.5, NaN]) {
      expectConvexErrorCode(
        () =>
          validateListingFields({ title: "T", description: "D", priceCents }),
        "LISTING_INVALID_PRICE",
      );
    }
    expect(
      validateListingFields({
        title: " T ",
        description: " D ",
        priceCents: 100,
      }),
    ).toEqual({ title: "T", description: "D", priceCents: 100 });
    expect(
      validateListingFields({ title: "T", description: "D", priceCents: 50000 })
        .priceCents,
    ).toBe(50000);
  });

  test("buildSearchText concatenates title, description and tags", () => {
    expect(buildSearchText("A", "B", ["x", "y"])).toBe("A\nB\nx y");
  });

  test("toPublicListing projects only public keys", () => {
    const listing = {
      _id: "l1" as Id<"listings">,
      _creationTime: 1,
      noteId: "n1" as Id<"notes">,
      sellerId: "u1" as Id<"users">,
      sellerClerkUserId: "clerk",
      sellerName: undefined,
      title: "T",
      description: "D",
      excerpt: "E",
      noteCount: 1,
      priceCents: 100,
      currency: "eur",
      scope: "note",
      accessMode: "copy",
      tags: ["a"],
      status: "published",
      salesCount: 0,
      searchText: "T\nD\na",
      attestedAt: 1,
      updatedAt: 1,
    } as Doc<"listings">;
    const result = toPublicListing(listing);
    expect(Object.keys(result).sort()).toEqual(
      [
        "_id",
        "_creationTime",
        "title",
        "description",
        "excerpt",
        "noteCount",
        "priceCents",
        "currency",
        "scope",
        "accessMode",
        "tags",
        "salesCount",
        "sellerName",
      ].sort(),
    );
    expect(result.sellerName).toBeNull();
  });
});
