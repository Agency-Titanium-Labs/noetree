// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) => (key: string, vars?: Record<string, unknown>) =>
      `${ns}.${key}${vars ? ` ${JSON.stringify(vars)}` : ""}`,
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

let links:
  | Array<{
      linkId: string;
      noteId: string;
      title: string;
      reason: string | null;
    }>
  | undefined;
const removeLink = vi.fn(async () => ({ removed: true }));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "links:listLinkedNotes" ? links : undefined,
  useMutation: () => removeLink,
}));

import LinkedNotesBlock from "./LinkedNotesBlock";

const NOTE = "n1" as Id<"notes">;
beforeEach(() => {
  links = [];
  removeLink.mockClear();
  toastError.mockReset();
});
afterEach(cleanup);

describe("LinkedNotesBlock (D-01)", () => {
  it("renders nothing while loading or when there is no link", () => {
    links = undefined;
    const { container, rerender } = render(
      <LinkedNotesBlock noteId={NOTE} onOpenNote={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    links = [];
    rerender(<LinkedNotesBlock noteId={NOTE} onOpenNote={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the linked notes (both directions arrive merged) and opens one on click", () => {
    links = [
      { linkId: "l1", noteId: "n2", title: "Planets", reason: null },
      { linkId: "l2", noteId: "n3", title: "Backlink from n3", reason: "x" },
    ];
    const onOpenNote = vi.fn();
    render(<LinkedNotesBlock noteId={NOTE} onOpenNote={onOpenNote} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: /LinkedNotes\.open.*Planets/ }),
    );
    expect(onOpenNote).toHaveBeenCalledWith("n2");
    fireEvent.click(
      screen.getByRole("button", { name: /LinkedNotes\.open.*Backlink/ }),
    );
    expect(onOpenNote).toHaveBeenLastCalledWith("n3");
  });

  it("titles are plain text", () => {
    links = [{ linkId: "l1", noteId: "n2", title: "<i>x</i>", reason: null }];
    const { container } = render(
      <LinkedNotesBlock noteId={NOTE} onOpenNote={() => {}} />,
    );
    expect(screen.getByText("<i>x</i>")).toBeInTheDocument();
    expect(container.querySelector("i")).toBeNull();
  });

  it("removes a link by id", async () => {
    links = [{ linkId: "l1", noteId: "n2", title: "Planets", reason: null }];
    render(<LinkedNotesBlock noteId={NOTE} onOpenNote={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: /removeAria.*Planets/ }),
    );
    await waitFor(() =>
      expect(removeLink).toHaveBeenCalledWith({ linkId: "l1" }),
    );
  });

  it("toasts when removing fails", async () => {
    links = [{ linkId: "l1", noteId: "n2", title: "Planets", reason: null }];
    removeLink.mockRejectedValueOnce(new Error("x"));
    render(<LinkedNotesBlock noteId={NOTE} onOpenNote={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /removeAria/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("LinkedNotes.removeError"),
    );
  });
});
