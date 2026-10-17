// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { ConvexError } from "convex/values";

const restoreMock = vi.fn();
const exitPreview = vi.fn();
const editor: { previewVersion: unknown } = { previewVersion: null };
const tree = { selectedNote: { title: "Current" } };

vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: () => restoreMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { noteVersions: { restore: "noteVersions.restore" } },
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, vars?: Record<string, string>) => {
    let m = key;
    for (const [k, v] of Object.entries(vars ?? {})) m += ` ${k}=${v}`;
    return m;
  },
}));

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast };
});

vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => ({
    previewVersion: editor.previewVersion,
    exitPreview,
  }),
}));

vi.mock("@/providers/TreeProvider", () => ({
  useTreeContext: () => tree,
}));

import { toast } from "sonner";
import VersionPreviewBanner, {
  historyErrorMessage,
} from "./VersionPreviewBanner";

function version(title = "Current") {
  return {
    _id: "v1",
    content: "{}",
    title,
    createdAt: Date.UTC(2026, 9, 10, 12, 0),
    isPreRestore: false,
    author: null,
  };
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /restoreVersion/ }));
  return screen.findByRole("alertdialog");
}

describe("restore banner", () => {
  beforeEach(() => {
    editor.previewVersion = version();
    restoreMock.mockReset();
    exitPreview.mockReset();
    vi.mocked(toast).mockReset();
    vi.mocked(toast.error).mockReset();
  });
  afterEach(cleanup);

  it("renders nothing without a preview", () => {
    editor.previewVersion = null;
    const { container } = render(<VersionPreviewBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the viewing text and title suffix only when titles differ", () => {
    const { unmount } = render(<VersionPreviewBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("bannerViewing date=");
    expect(screen.queryByText(/bannerTitleThen/)).toBeNull();
    unmount();
    editor.previewVersion = version("Old title");
    render(<VersionPreviewBanner />);
    expect(screen.getByText(/bannerTitleThen title=Old title/)).toBeVisible();
  });

  it("back to current and Escape exit the preview", () => {
    render(<VersionPreviewBanner />);
    fireEvent.click(screen.getByRole("button", { name: /backToCurrent/ }));
    expect(exitPreview).toHaveBeenCalledWith();
    fireEvent.keyDown(screen.getByRole("status"), { key: "Escape" });
    expect(exitPreview).toHaveBeenCalledTimes(2);
  });

  it("keep current closes the dialog without restoring", async () => {
    render(<VersionPreviewBanner />);
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent("restoreDialogTitle");
    expect(dialog).toHaveTextContent("restoreDialogBody");
    fireEvent.click(screen.getByRole("button", { name: "keepCurrent" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it("confirm restores, exits with restored content and toasts", async () => {
    let resolve!: (v: { content: string }) => void;
    restoreMock.mockReturnValue(
      new Promise(r => {
        resolve = r;
      }),
    );
    render(<VersionPreviewBanner />);
    const dialog = await openDialog();
    const confirm = Array.from(dialog.querySelectorAll("button")).find(b =>
      /restoreVersion/.test(b.textContent ?? ""),
    )!;
    fireEvent.click(confirm);
    expect(restoreMock).toHaveBeenCalledWith({ versionId: "v1" });
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(confirm).toHaveTextContent("restoring");
    resolve({ content: "RESTORED" });
    await waitFor(() => expect(exitPreview).toHaveBeenCalledTimes(1));
    expect(exitPreview).toHaveBeenCalledWith("RESTORED");
    expect(toast).toHaveBeenCalledWith("restoreSuccess");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it.each([
    ["VERSION_OUT_OF_WINDOW", "errorOutOfWindow"],
    ["NOT_ALLOWED", "errorNoAccess"],
    ["UNAUTHENTICATED", "errorNoAccess"],
  ])("maps %s to %s and keeps the preview", async (data, key) => {
    restoreMock.mockRejectedValue(new ConvexError(data));
    render(<VersionPreviewBanner />);
    const dialog = await openDialog();
    const confirm = Array.from(dialog.querySelectorAll("button")).find(b =>
      /restoreVersion/.test(b.textContent ?? ""),
    )!;
    fireEvent.click(confirm);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(key));
    expect(exitPreview).not.toHaveBeenCalled();
  });

  it("maps unknown errors to errorRestore", async () => {
    restoreMock.mockRejectedValue(new Error("boom"));
    render(<VersionPreviewBanner />);
    const dialog = await openDialog();
    const confirm = Array.from(dialog.querySelectorAll("button")).find(b =>
      /restoreVersion/.test(b.textContent ?? ""),
    )!;
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("errorRestore"),
    );
    expect(exitPreview).not.toHaveBeenCalled();
  });

  it("historyErrorMessage uses the fallback key", () => {
    const t = (k: string) => k;
    expect(historyErrorMessage(new Error("x"), t, "errorLoad")).toBe(
      "errorLoad",
    );
    expect(
      historyErrorMessage(new ConvexError("NOT_ALLOWED"), t, "errorLoad"),
    ).toBe("errorNoAccess");
  });
});
