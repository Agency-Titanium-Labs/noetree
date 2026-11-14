// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Quote, QuoteAuthor, QuoteContent, quoteVariants } from "./quote";

describe("Quote component", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders a blockquote with default variant and size", () => {
    render(
      <Quote>
        <QuoteContent>Ceci est une citation</QuoteContent>
      </Quote>,
    );

    const quote = screen.getByRole("blockquote");
    expect(quote).toBeInTheDocument();
    expect(quote).toHaveAttribute("data-slot", "quote");
    expect(quote).toHaveAttribute("data-variant", "default");
    expect(quote).toHaveAttribute("data-size", "default");
    expect(quote).toHaveTextContent("Ceci est une citation");
  });

  it("applies variant and size attributes and classes", () => {
    render(
      <Quote variant="amber" size="sm">
        <QuoteContent>Texte amber</QuoteContent>
        <QuoteAuthor>Auteur</QuoteAuthor>
      </Quote>,
    );

    const quote = screen.getByRole("blockquote");
    expect(quote).toHaveAttribute("data-variant", "amber");
    expect(quote).toHaveAttribute("data-size", "sm");
    expect(quote.className).toContain("border-amber-400");
    expect(quote.className).toContain("text-xs");

    const content = screen.getByText("Texte amber");
    expect(content).toHaveAttribute("data-slot", "quote-content");
    expect(content.className).toContain("italic");

    const author = screen.getByText("Auteur");
    expect(author).toHaveAttribute("data-slot", "quote-author");
  });

  it("supports asChild to render a custom element", () => {
    render(
      <Quote asChild variant="amber">
        <div data-testid="custom-quote-div">Citation custom</div>
      </Quote>,
    );

    const el = screen.getByTestId("custom-quote-div");
    expect(el.tagName).toBe("DIV");
    expect(el).toHaveAttribute("data-slot", "quote");
    expect(el).toHaveAttribute("data-variant", "amber");
  });

  it("exports quoteVariants for standalone class generation", () => {
    const classes = quoteVariants({ variant: "amber", size: "sm" });
    expect(classes).toContain("border-amber-400");
    expect(classes).toContain("text-xs");
  });
});
