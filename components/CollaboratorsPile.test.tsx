// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const mockContext = {
  presenceList: [] as unknown[],
};

vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => ({
    presenceList: mockContext.presenceList,
  }),
}));

vi.mock("convex/react", () => ({
  useQuery: () => ({ _id: "user_me", name: "Me", picture: null }),
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { id: "user_me", fullName: "Me", imageUrl: null } }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      you: "vous",
      collaborator: "Collaborateur",
      collaborators: "Collaborateurs",
    };
    return translations[key] ?? key;
  },
}));

import CollaboratorsPile from "./CollaboratorsPile";

describe("CollaboratorsPile", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders null when noteId is undefined or presenceList is empty/single user", () => {
    mockContext.presenceList = [];
    const { container: c1 } = render(<CollaboratorsPile noteId={undefined} />);
    expect(c1.firstChild).toBeNull();

    mockContext.presenceList = [
      { userId: "user_me", name: "Me", online: true },
    ];
    const { container: c2 } = render(<CollaboratorsPile noteId="note123" />);
    expect(c2.firstChild).toBeNull();
  });

  it("renders visible collaborators with initials when multiple users are online", () => {
    mockContext.presenceList = [
      { userId: "user_me", name: "Antoine F", online: true },
      { userId: "user_2", name: "Jane Doe", online: true },
    ];

    render(<CollaboratorsPile noteId="note123" maxVisible={2} />);

    // Should display initials "AF" and "JD"
    expect(screen.getByText("AF")).toBeInTheDocument();
    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("renders +N overflow count when online users exceed maxVisible", () => {
    mockContext.presenceList = [
      { userId: "user_me", name: "Antoine F", online: true },
      { userId: "user_2", name: "Jane Doe", online: true },
      { userId: "user_3", name: "Bob Smith", online: true },
    ];

    render(<CollaboratorsPile noteId="note123" maxVisible={1} />);

    // Max 1 visible: "AF", and +2 for overflow
    expect(screen.getByText("AF")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    // Jane Doe is in the overflow menu, not visible in the main avatar group directly
    expect(screen.queryByText("JD")).toBeNull();
  });

  it("opens DropdownMenu with remaining users when +N count is clicked", () => {
    mockContext.presenceList = [
      { userId: "user_me", name: "Antoine F", online: true },
      { userId: "user_2", name: "Jane Doe", online: true },
      { userId: "user_3", name: "Bob Smith", online: true },
    ];

    render(<CollaboratorsPile noteId="note123" maxVisible={1} />);

    const countButton = screen.getByText("+2");
    fireEvent.pointerDown(countButton, { pointerType: "mouse" });

    // Dropdown label with count should appear
    expect(screen.getByText("Collaborateurs (2)")).toBeInTheDocument();
    // Overflow users should appear in the dropdown menu
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Bob Smith")).toBeInTheDocument();
  });
});
