// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import {
  GUARD_NAMESPACE,
  LeaveShareMenuItem,
  canLeaveShare,
  guardErrorMessageKey,
} from "./purchaseShareUi";

afterEach(cleanup);

describe("leave visibility", () => {
  it("hides Leave for purchased shares only", () => {
    expect(canLeaveShare({ isShared: true, isPurchased: true })).toBe(false);
    expect(canLeaveShare({ isShared: true })).toBe(true);
    expect(canLeaveShare({ isShared: true, isPurchased: false })).toBe(true);
    expect(canLeaveShare({ isShared: false })).toBe(false);
  });

  it("renders nothing for a purchased note", () => {
    render(
      <LeaveShareMenuItem
        note={{ isShared: true, isPurchased: true }}
        onLeave={vi.fn()}
        label="Leave share"
      />,
    );
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(screen.queryByText("Leave share")).toBeNull();
  });

  it("renders Leave for a manual share and calls onLeave", () => {
    const onLeave = vi.fn();
    render(
      <LeaveShareMenuItem
        note={{ isShared: true }}
        onLeave={onLeave}
        label="Leave share"
      />,
    );
    fireEvent.click(screen.getByText("Leave share"));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe("guard error mapping", () => {
  const codes = [
    "NOTE_HAS_PURCHASE_GRANTS",
    "SHARE_PROTECTED",
    "LISTING_PURCHASED_CONTENT",
  ];

  it("maps the three guard codes and returns null for unknown", () => {
    for (const code of codes) {
      expect(guardErrorMessageKey(code)).toEqual(expect.any(String));
    }
    expect(guardErrorMessageKey("SOMETHING_ELSE")).toBeNull();
    expect(guardErrorMessageKey("toString")).toBeNull();
  });

  it("every key resolves in both en and fr", () => {
    for (const code of codes) {
      const key = guardErrorMessageKey(code)!;
      for (const msgs of [en, fr] as Record<string, unknown>[]) {
        const ns = msgs[GUARD_NAMESPACE] as Record<string, unknown>;
        expect(typeof ns[key]).toBe("string");
        expect((ns[key] as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("renders the EN delete-guard message through next-intl", () => {
    function Probe() {
      const t = useTranslations(GUARD_NAMESPACE);
      return <p>{t(guardErrorMessageKey("NOTE_HAS_PURCHASE_GRANTS")!)}</p>;
    }
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <Probe />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText(
        "This note was sold with read-only access and cannot be deleted.",
      ),
    ).toBeInTheDocument();
  });
});
