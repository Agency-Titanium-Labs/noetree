import {
  Bold,
  Italic,
  Quote,
  List,
  Code,
  TerminalSquare,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Undo,
  Redo,
  Strikethrough,
  CornerDownRight,
  Minus,
  ListOrdered,
  ListTodo,
} from "lucide-react";
import { Editor } from "@tiptap/react";
import { JSX } from "react";

export interface ToolbarItem {
  name: string;
  icon: JSX.Element;
  action: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
  tooltip: string;
}

export const historyItems: ToolbarItem[] = [
  {
    name: "undo",
    icon: <Undo />,
    action: editor => editor.chain().focus().undo().run(),
    isDisabled: editor => !editor.can().undo(),
    tooltip: "Undo (Ctrl+Z)",
  },
  {
    name: "redo",
    icon: <Redo />,
    action: editor => editor.chain().focus().redo().run(),
    isDisabled: editor => !editor.can().redo(),
    tooltip: "Redo (Ctrl+Shift+Z)",
  },
];

export const headingItems: ToolbarItem[] = [
  {
    name: "heading-1",
    icon: <Heading1 />,
    action: editor => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    isActive: editor => editor.isActive("heading", { level: 1 }),
    tooltip: "Heading 1",
  },
  {
    name: "heading-2",
    icon: <Heading2 />,
    action: editor => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: editor => editor.isActive("heading", { level: 2 }),
    tooltip: "Heading 2",
  },
  {
    name: "heading-3",
    icon: <Heading3 />,
    action: editor => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: editor => editor.isActive("heading", { level: 3 }),
    tooltip: "Heading 3",
  },
  {
    name: "heading-4",
    icon: <Heading4 />,
    action: editor => editor.chain().focus().toggleHeading({ level: 4 }).run(),
    isActive: editor => editor.isActive("heading", { level: 4 }),
    tooltip: "Heading 4",
  },
  {
    name: "heading-5",
    icon: <Heading5 />,
    action: editor => editor.chain().focus().toggleHeading({ level: 5 }).run(),
    isActive: editor => editor.isActive("heading", { level: 5 }),
    tooltip: "Heading 5",
  },
  {
    name: "heading-6",
    icon: <Heading6 />,
    action: editor => editor.chain().focus().toggleHeading({ level: 6 }).run(),
    isActive: editor => editor.isActive("heading", { level: 6 }),
    tooltip: "Heading 6",
  },
];

export const formattingItems: ToolbarItem[] = [
  {
    name: "bold",
    icon: <Bold />,
    action: editor => editor.chain().focus().toggleBold().run(),
    isActive: editor => editor.isActive("bold"),
    tooltip: "Bold (Ctrl+B)",
  },
  {
    name: "italic",
    icon: <Italic />,
    action: editor => editor.chain().focus().toggleItalic().run(),
    isActive: editor => editor.isActive("italic"),
    tooltip: "Italic (Ctrl+I)",
  },
  {
    name: "strike",
    icon: <Strikethrough />,
    action: editor => editor.chain().focus().toggleStrike().run(),
    isActive: editor => editor.isActive("strike"),
    tooltip: "Strikethrough",
  },
  {
    name: "code",
    icon: <Code />,
    action: editor => editor.chain().focus().toggleCode().run(),
    isActive: editor => editor.isActive("code"),
    tooltip: "Inline Code (Ctrl+E)",
  },
];

export const listItems: ToolbarItem[] = [
  {
    name: "bulletList",
    icon: <List />,
    action: editor => editor.chain().focus().toggleBulletList().run(),
    isActive: editor => editor.isActive("bulletList"),
    tooltip: "Bullet List",
  },
  {
    name: "orderedList",
    icon: <ListOrdered />,
    action: editor => editor.chain().focus().toggleOrderedList().run(),
    isActive: editor => editor.isActive("orderedList"),
    tooltip: "Ordered List",
  },
  {
    name: "taskList",
    icon: <ListTodo />,
    action: editor => editor.chain().focus().toggleTaskList().run(),
    isActive: editor => editor.isActive("taskList"),
    tooltip: "Task List",
  },
];

export const specialItems: ToolbarItem[] = [
  {
    name: "blockquote",
    icon: <Quote />,
    action: editor => editor.chain().focus().toggleBlockquote().run(),
    isActive: editor => editor.isActive("blockquote"),
    tooltip: "Blockquote",
  },
  {
    name: "codeBlock",
    icon: <TerminalSquare />,
    action: editor => editor.chain().focus().toggleCodeBlock().run(),
    isActive: editor => editor.isActive("codeBlock"),
    tooltip: "Code Block",
  },
  {
    name: "hardBreak",
    icon: <CornerDownRight />,
    action: editor => editor.chain().focus().setHardBreak().run(),
    tooltip: "Hard Break",
  },
  {
    name: "horizontalRule",
    icon: <Minus />,
    action: editor => editor.chain().focus().setHorizontalRule().run(),
    tooltip: "Horizontal Rule",
  },
];
