// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FollowBanner from "./FollowBanner";

const mockContext = {
  followedCollaborator: null as unknown,
  setFollowedUserId: vi.fn(),
};

vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => mockContext,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    if (key === "following") return `Vous suivez ${params?.name}`;
    if (key === "stopFollowing") return "Arrêter";
    if (key === "escapeKey") return "Échap";
    return key;
  },
}));

describe("FollowBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders null when no collaborator is being followed", () => {
    mockContext.followedCollaborator = null;
    const { container } = render(<FollowBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders follow pill with user name, note title and stops following on button click", () => {
    mockContext.followedCollaborator = {
      userId: "user_bob",
      name: "Bob Smith",
      activeNoteId: "note_123",
      color: "#059669",
    };

    render(<FollowBanner />);

    expect(screen.getByText("Vous suivez Bob Smith")).toBeInTheDocument();
    expect(screen.getByText("BS")).toBeInTheDocument();
    expect(screen.getByText("Échap")).toBeInTheDocument();

    const stopButton = screen.getByRole("button", { name: /Arrêter/i });
    expect(stopButton).toBeInTheDocument();

    fireEvent.click(stopButton);
    expect(mockContext.setFollowedUserId).toHaveBeenCalledWith(null);
  });
});
