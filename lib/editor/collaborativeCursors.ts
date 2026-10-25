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

const CURSOR_COLORS = [
  "#0284c7", // sky-600
  "#7c3aed", // violet-600
  "#db2777", // pink-600
  "#059669", // emerald-600
  "#d97706", // amber-600
  "#4f46e5", // indigo-600
  "#0d9488", // teal-600
  "#ea580c", // orange-600
  "#9333ea", // purple-600
];

export function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % CURSOR_COLORS.length;
  return CURSOR_COLORS[index];
}

/**
 * Calculates optimal text color ('#000000' or '#ffffff') for a given background hex color
 * according to WCAG 2 relative luminance standards to maximize contrast and accessibility.
 */
export function getContrastTextColor(hexColor: string): "#000000" | "#ffffff" {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;

  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

  return luminance > 0.179 ? "#000000" : "#ffffff";
}

function createCursorElement(user: RemoteUserCursor): HTMLElement {
  const span = document.createElement("span");
  span.className = "collaborative-cursor";
  span.style.setProperty("--cursor-color", user.color);

  const textColor = getContrastTextColor(user.color);
  span.style.setProperty("--cursor-text-color", textColor);

  const label = document.createElement("span");
  label.className = "collaborative-cursor-label";
  label.textContent = user.name;
  label.style.color = textColor;

  span.appendChild(label);
  return span;
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
              return { users: meta };
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
            if (!pluginState || !pluginState.users.length) {
              return DecorationSet.empty;
            }

            const decos: Decoration[] = [];
            const docSize = state.doc.content.size;

            for (const user of pluginState.users) {
              if (!user.cursor) continue;
              const from = Math.max(0, Math.min(user.cursor.from, docSize));
              const to = Math.max(0, Math.min(user.cursor.to, docSize));

              if (from !== to) {
                decos.push(
                  Decoration.inline(Math.min(from, to), Math.max(from, to), {
                    style: `background-color: ${user.color}33;`,
                    class: "collaborative-selection",
                  }),
                );
              }

              decos.push(
                Decoration.widget(to, () => createCursorElement(user), {
                  side: 0,
                  key: `cursor-${user.userId}`,
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
