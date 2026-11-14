import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type RemoteUserCursor = {
  userId: string;
  name: string;
  color: string;
  cursor?: {
    from: number;
    to: number;
  };
  isTyping?: boolean;
};

export type CollaborativeCursorsStorage = {
  users: RemoteUserCursor[];
};

type State = {
  users: RemoteUserCursor[];
};

export const collaborativeCursorsKey = new PluginKey<State>(
  "collaborativeCursors",
);

// Exclude purple / violet / indigo shades to avoid clashing with the UI primary color (#7e10b2)
const CURSOR_COLORS = [
  "#0284c7", // sky-600
  "#059669", // emerald-600
  "#ea580c", // orange-600
  "#2563eb", // blue-600
  "#d97706", // amber-600
  "#0d9488", // teal-600
  "#e11d48", // rose-600
  "#16a34a", // green-600
  "#0891b2", // cyan-600
] as const;

export function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = Math.trunc((hash << 5) - hash + (userId.codePointAt(i) ?? 0));
  }
  const index = Math.abs(hash) % CURSOR_COLORS.length;
  return CURSOR_COLORS[index];
}

function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/**
 * Calculates optimal text color ('#000000' or '#ffffff') for a given background hex color
 * according to WCAG 2 relative luminance standards to maximize contrast and accessibility.
 */
export function getContrastTextColor(hexColor: string): "#000000" | "#ffffff" {
  const hex = hexColor.startsWith("#") ? hexColor.slice(1) : hexColor;
  const r = Number.parseInt(hex.slice(0, 2), 16) || 0;
  const g = Number.parseInt(hex.slice(2, 4), 16) || 0;
  const b = Number.parseInt(hex.slice(4, 6), 16) || 0;

  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

  return luminance > 0.179 ? "#000000" : "#ffffff";
}

function createCursorElement(user: RemoteUserCursor): HTMLElement {
  const span = document.createElement("span");
  span.className = "collaborative-cursor";
  span.dataset.cursorUserId = user.userId;
  span.style.setProperty("--cursor-color", user.color);

  const textColor = getContrastTextColor(user.color);
  span.style.setProperty("--cursor-text-color", textColor);

  const label = document.createElement("span");
  label.className = "collaborative-cursor-label";
  label.textContent = user.name;
  label.style.color = textColor;

  if (user.isTyping) {
    const dots = document.createElement("span");
    dots.className = "collaborative-cursor-typing";
    dots.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.className = "collaborative-cursor-dot";
      dots.append(dot);
    }
    label.append(dots);
  }

  span.append(label);
  return span;
}

function createWidgetFactory(user: RemoteUserCursor) {
  return () => createCursorElement(user);
}

export const CollaborativeCursors = Extension.create<
  Record<string, never>,
  CollaborativeCursorsStorage
>({
  name: "collaborativeCursors",

  addStorage() {
    return {
      users: [],
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<State>({
        key: collaborativeCursorsKey,
        state: {
          init: () => ({ users: [] }),
          apply: (tr, value) => {
            const meta = tr.getMeta(collaborativeCursorsKey) as
              | RemoteUserCursor[]
              | undefined;
            if (meta !== undefined) {
              return {
                users: meta.map(remoteUser => {
                  // If the remote user is actively typing and already exists locally with a mapped cursor,
                  // keep the locally mapped cursor so incoming content steps continue to move the cursor smoothly
                  // instead of presence snapping it backwards or jumping ahead!
                  if (remoteUser.isTyping) {
                    const existing = value.users.find(
                      u => u.userId === remoteUser.userId,
                    );
                    if (existing?.cursor) {
                      return {
                        ...remoteUser,
                        cursor: existing.cursor,
                      };
                    }
                  }
                  return remoteUser;
                }),
              };
            }
            if (tr.docChanged && value.users.length > 0) {
              return {
                users: value.users.map(user => {
                  if (!user.cursor) return user;
                  return {
                    ...user,
                    cursor: {
                      from: tr.mapping.map(user.cursor.from),
                      to: tr.mapping.map(user.cursor.to),
                    },
                  };
                }),
              };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            const pluginState = collaborativeCursorsKey.getState(state);
            if (!pluginState || pluginState.users.length === 0) {
              return DecorationSet.empty;
            }

            const decos: Decoration[] = [];
            const docSize = state.doc.content.size;

            for (const user of pluginState.users) {
              if (!user.cursor) continue;
              const from = Math.max(0, Math.min(user.cursor.from, docSize));
              const to = Math.max(0, Math.min(user.cursor.to, docSize));
              const start = Math.min(from, to);
              const end = Math.max(from, to);

              if (start !== end) {
                decos.push(
                  Decoration.inline(start, end, {
                    style: `background-color: ${user.color}33;`,
                    class: "collaborative-selection",
                  }),
                );
              }

              decos.push(
                Decoration.widget(to, createWidgetFactory(user), {
                  side: 0,
                  key: `cursor-${user.userId}-${user.isTyping ? "typing" : "idle"}`,
                  ignoreSelection: true,
                }),
              );
            }

            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
