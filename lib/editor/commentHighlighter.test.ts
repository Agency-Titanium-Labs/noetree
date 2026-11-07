/**
 * Tests for the CommentHighlighter extension helpers.
 */

import { describe, it, expect } from "vitest";
import { findQuoteRange } from "./commentHighlighter";

describe("findQuoteRange", () => {
  it("finds a quote near the hinted position", () => {
    const text = "Hello world, this is a test sentence for anchoring.";
    const quote = "this is a test";
    const hint = 13; // approx position in string
    const result = findQuoteRange(text, quote, hint);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(text.indexOf(quote));
    expect(result!.to).toBe(text.indexOf(quote) + quote.length);
  });

  it("falls back to full-doc search when hint is far off", () => {
    const text = "Alpha beta gamma delta epsilon zeta";
    const quote = "gamma";
    const hint = 0; // hint far from actual position (which is 11)
    const result = findQuoteRange(text, quote, hint);
    expect(result).not.toBeNull();
    expect(text.slice(result!.from, result!.to)).toBe(quote);
  });

  it("returns null when quote is not in the document", () => {
    const text = "Some document content without the target phrase.";
    const result = findQuoteRange(text, "xyzzy not here", 0);
    expect(result).toBeNull();
  });

  it("returns null for empty quote", () => {
    expect(findQuoteRange("any text", "", 0)).toBeNull();
  });

  it("handles quote at the very start of the document", () => {
    const text = "First words then more content";
    const result = findQuoteRange(text, "First words", 0);
    expect(result).toEqual({ from: 0, to: 11 });
  });

  it("handles quote at the very end of the document", () => {
    const text = "Some preamble before the final words";
    const quote = "final words";
    const result = findQuoteRange(text, quote, text.length);
    expect(result).not.toBeNull();
    expect(text.slice(result!.from, result!.to)).toBe(quote);
  });
});
