// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const mockContext = {
  presenceList: [] as unknown[],
  treePresenceList: [] as unknown[],
};

const mockTreeContext = {
  tree: null as unknown,
  onSelectNote: vi.fn(),
};

vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => ({
    presenceList: mockContext.presenceList,
    treePresenceList: mockContext.treePresenceList,
  }),
}));

vi.mock("@/providers/TreeProvider", () => ({
  useTreeContext: () => mockTreeContext,
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

  it("renders null when only the current user is on the note across multiple tabs or offline users exist", () => {
    // Multiple tabs of the same user
    mockContext.presenceList = [
      { userId: "user_me", name: "Me", online: true },
      { userId: "user_me", name: "Me", online: true },
    ];
    const { container: c1 } = render(<CollaboratorsPile noteId="note123" />);
    expect(c1.firstChild).toBeNull();

    // Current user online + other user offline
    mockContext.presenceList = [
      { userId: "user_me", name: "Me", online: true },
      { userId: "user_other", name: "Other", online: false },
    ];
    const { container: c2 } = render(<CollaboratorsPile noteId="note123" />);
    expect(c2.firstChild).toBeNull();
  });

  it("renders visible collaborators with initials when other users are online", () => {
    mockContext.presenceList = [
      { userId: "user_me", name: "Antoine F", online: true },
      { userId: "user_2", name: "Jane Doe", online: true },
      { userId: "user_3", name: "Bob Smith", online: true },
    ];

    render(<CollaboratorsPile noteId="note123" maxVisible={2} />);

    // Current user "AF" is excluded from the pile
    expect(screen.queryByText("AF")).toBeNull();
    // Other users "JD" and "BS" are displayed
    expect(screen.getByText("JD")).toBeInTheDocument();
    expect(screen.getByText("BS")).toBeInTheDocument();
  });

  it("renders +N overflow count when other online users exceed maxVisible", () => {
    mockContext.presenceList = [
      { userId: "user_me", name: "Antoine F", online: true },
      { userId: "user_2", name: "Jane Doe", online: true },
      { userId: "user_3", name: "Bob Smith", online: true },
      { userId: "user_4", name: "Alice Martin", online: true },
    ];

    render(<CollaboratorsPile noteId="note123" maxVisible={1} />);

    // Max 1 visible: "JD", and +2 for overflow (Bob and Alice)
    expect(screen.getByText("JD")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.queryByText("BS")).toBeNull();
  });

  it("opens DropdownMenu with remaining users when +N count is clicked", () => {
    mockContext.presenceList = [
      { userId: "user_me", name: "Antoine F", online: true },
      { userId: "user_2", name: "Jane Doe", online: true },
      { userId: "user_3", name: "Bob Smith", online: true },
      { userId: "user_4", name: "Alice Martin", online: true },
    ];

    render(<CollaboratorsPile noteId="note123" maxVisible={1} />);

    const countButton = screen.getByText("+2");
    fireEvent.pointerDown(countButton, { pointerType: "mouse" });

    // Dropdown label with count should appear
    expect(screen.getByText("Collaborateurs (2)")).toBeInTheDocument();
    // Overflow users should appear in the dropdown menu
    expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    expect(screen.getByText("Alice Martin")).toBeInTheDocument();
  });

  it("renders tree-level collaborators and selects note on click", () => {
    mockTreeContext.tree = {
      _id: "root_1",
      title: "Root Note",
      childNotes: [
        {
          _id: "child_1",
          title: "Sub Note",
          childNotes: [],
        },
      ],
    };

    mockContext.presenceList = [];
    mockContext.treePresenceList = [
      { userId: "user_me", name: "Antoine F", online: true },
      {
        userId: "user_2",
        name: "Jane Doe",
        online: true,
        data: { activeNoteId: "child_1" },
      },
    ];

    render(<CollaboratorsPile />);

    // Current user is excluded
    expect(screen.queryByText("AF")).toBeNull();
    const janeAvatar = screen.getByText("JD");
    expect(janeAvatar).toBeInTheDocument();

    // Clicking Jane's avatar navigates to her note
    fireEvent.click(janeAvatar);
    expect(mockTreeContext.onSelectNote).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "child_1", title: "Sub Note" }),
    );
  });

  it("filters treePresenceList for specific noteId and supports size='sm'", () => {
    mockContext.presenceList = [];
    mockContext.treePresenceList = [
      {
        userId: "user_2",
        name: "Jane Doe",
        online: true,
        data: { activeNoteId: "note_a" },
      },
      {
        userId: "user_3",
        name: "Bob Smith",
        online: true,
        data: { activeNoteId: "note_b" },
      },
    ];

    const { unmount } = render(<CollaboratorsPile noteId="note_a" size="sm" />);
    expect(screen.getByText("JD")).toBeInTheDocument();
    expect(screen.queryByText("BS")).toBeNull();
    unmount();

    render(<CollaboratorsPile noteId="note_b" size="sm" />);
    expect(screen.getByText("BS")).toBeInTheDocument();
    expect(screen.queryByText("JD")).toBeNull();
  });
});
