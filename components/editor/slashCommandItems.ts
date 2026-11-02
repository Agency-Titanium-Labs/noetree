import type { Editor } from "@tiptap/core";
import {
  Pilcrow,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  Quote,
  Minus,
  Bold,
  Italic,
  Strikethrough,
  Code,
  TerminalSquare,
  Link,
  Image,
  CornerDownRight,
  Undo,
  Redo,
  type LucideIcon,
} from "lucide-react";

export type SlashCommandCategory =
  | "basic"
  | "headings"
  | "media"
  | "formatting"
  | "actions";

export interface SlashCommandItem {
  id: string;
  category: SlashCommandCategory;
  titleKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  searchTerms: string[];
  action: (editor: Editor) => void;
}

export const slashCommandItems: SlashCommandItem[] = [
  // --- Blocs de base (Basic blocks) ---
  {
    id: "paragraph",
    category: "basic",
    titleKey: "paragraph",
    descriptionKey: "paragraphDesc",
    icon: Pilcrow,
    searchTerms: ["p", "paragraph", "paragraphe", "texte", "text", "normal"],
    action: editor => editor.chain().focus().setParagraph().run(),
  },
  {
    id: "bullet-list",
    category: "basic",
    titleKey: "bulletList",
    descriptionKey: "bulletListDesc",
    icon: List,
    searchTerms: ["ul", "list", "bullet", "liste", "puces"],
    action: editor => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    category: "basic",
    titleKey: "orderedList",
    descriptionKey: "orderedListDesc",
    icon: ListOrdered,
    searchTerms: [
      "ol",
      "ordered",
      "numbered",
      "numérotée",
      "chiffres",
      "numbers",
    ],
    action: editor => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "blockquote",
    category: "basic",
    titleKey: "blockquote",
    descriptionKey: "blockquoteDesc",
    icon: Quote,
    searchTerms: ["quote", "citation", "bloc", "blockquote"],
    action: editor => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "horizontal-rule",
    category: "basic",
    titleKey: "horizontalRule",
    descriptionKey: "horizontalRuleDesc",
    icon: Minus,
    searchTerms: ["divider", "rule", "line", "ligne", "séparateur", "hr"],
    action: editor => editor.chain().focus().setHorizontalRule().run(),
  },

  // --- Titres (Headings) ---
  {
    id: "heading-1",
    category: "headings",
    titleKey: "heading1",
    descriptionKey: "heading1Desc",
    icon: Heading1,
    searchTerms: ["h1", "heading", "titre", "titre 1", "grand titre"],
    action: editor => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    category: "headings",
    titleKey: "heading2",
    descriptionKey: "heading2Desc",
    icon: Heading2,
    searchTerms: ["h2", "heading", "titre", "titre 2", "moyen titre"],
    action: editor => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "heading-3",
    category: "headings",
    titleKey: "heading3",
    descriptionKey: "heading3Desc",
    icon: Heading3,
    searchTerms: ["h3", "heading", "titre", "titre 3", "petit titre"],
    action: editor => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: "heading-4",
    category: "headings",
    titleKey: "heading4",
    descriptionKey: "heading4Desc",
    icon: Heading4,
    searchTerms: ["h4", "heading", "titre", "titre 4"],
    action: editor => editor.chain().focus().toggleHeading({ level: 4 }).run(),
  },
  {
    id: "heading-5",
    category: "headings",
    titleKey: "heading5",
    descriptionKey: "heading5Desc",
    icon: Heading5,
    searchTerms: ["h5", "heading", "titre", "titre 5"],
    action: editor => editor.chain().focus().toggleHeading({ level: 5 }).run(),
  },
  {
    id: "heading-6",
    category: "headings",
    titleKey: "heading6",
    descriptionKey: "heading6Desc",
    icon: Heading6,
    searchTerms: ["h6", "heading", "titre", "titre 6"],
    action: editor => editor.chain().focus().toggleHeading({ level: 6 }).run(),
  },

  // --- Médias & Insertion (Media & Inserts) ---
  {
    id: "code-block",
    category: "media",
    titleKey: "codeBlock",
    descriptionKey: "codeBlockDesc",
    icon: TerminalSquare,
    searchTerms: ["code", "codeblock", "pre", "snippet"],
    action: editor => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "link",
    category: "media",
    titleKey: "link",
    descriptionKey: "linkDesc",
    icon: Link,
    searchTerms: ["link", "lien", "url", "href"],
    action: editor => {
      const url = typeof window !== "undefined" ? window.prompt("URL") : null;
      if (!url) return;
      if (editor.state.selection.empty) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "text",
            text: url,
            marks: [{ type: "link", attrs: { href: url } }],
          })
          .run();
      } else {
        editor
          .chain()
          .focus()
          .extendMarkRange("link")
          .setLink({ href: url })
          .run();
      }
    },
  },
  {
    id: "image",
    category: "media",
    titleKey: "image",
    descriptionKey: "imageDesc",
    icon: Image,
    searchTerms: ["image", "img", "photo", "picture"],
    action: editor => {
      const url =
        typeof window !== "undefined" ? window.prompt("Image URL") : null;
      if (url) {
        editor.chain().focus().setImage({ src: url, alt: "Image" }).run();
      }
    },
  },
  {
    id: "hard-break",
    category: "media",
    titleKey: "hardBreak",
    descriptionKey: "hardBreakDesc",
    icon: CornerDownRight,
    searchTerms: ["break", "saut", "ligne", "newline", "enter"],
    action: editor => editor.chain().focus().setHardBreak().run(),
  },

  // --- Mise en forme (Formatting) ---
  {
    id: "bold",
    category: "formatting",
    titleKey: "bold",
    descriptionKey: "boldDesc",
    icon: Bold,
    searchTerms: ["bold", "gras", "b", "strong"],
    action: editor => editor.chain().focus().toggleBold().run(),
  },
  {
    id: "italic",
    category: "formatting",
    titleKey: "italic",
    descriptionKey: "italicDesc",
    icon: Italic,
    searchTerms: ["italic", "italique", "i", "em"],
    action: editor => editor.chain().focus().toggleItalic().run(),
  },
  {
    id: "strike",
    category: "formatting",
    titleKey: "strike",
    descriptionKey: "strikeDesc",
    icon: Strikethrough,
    searchTerms: ["strike", "strikethrough", "barré", "rayé", "del"],
    action: editor => editor.chain().focus().toggleStrike().run(),
  },
  {
    id: "inline-code",
    category: "formatting",
    titleKey: "code",
    descriptionKey: "codeDesc",
    icon: Code,
    searchTerms: ["code", "inline", "monospace"],
    action: editor => editor.chain().focus().toggleCode().run(),
  },

  // --- Actions / Historique (Actions & History) ---
  {
    id: "undo",
    category: "actions",
    titleKey: "undo",
    descriptionKey: "undoDesc",
    icon: Undo,
    searchTerms: ["undo", "annuler", "retour", "ctrl+z"],
    action: editor => editor.chain().focus().undo().run(),
  },
  {
    id: "redo",
    category: "actions",
    titleKey: "redo",
    descriptionKey: "redoDesc",
    icon: Redo,
    searchTerms: ["redo", "rétablir", "refaire", "ctrl+y"],
    action: editor => editor.chain().focus().redo().run(),
  },
];
