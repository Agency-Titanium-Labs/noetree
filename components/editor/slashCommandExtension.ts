import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { slashCommandItems, type SlashCommandItem } from "./slashCommandItems";
import { SlashCommandMenu, type SlashCommandMenuRef } from "./SlashCommandMenu";

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        allow: ({ editor }: { editor: SuggestionProps["editor"] }) =>
          editor.isEditable,
        command: ({
          editor,
          range,
          props,
        }: {
          editor: SuggestionProps["editor"];
          range: SuggestionProps["range"];
          props: SlashCommandItem;
        }) => {
          editor.chain().focus().deleteRange(range).run();
          props.action(editor);
        },
        items: ({ query }: { query: string }) => {
          const cleanQuery = query.toLowerCase().trim();
          if (!cleanQuery) return slashCommandItems;
          return slashCommandItems.filter(
            item =>
              item.id.toLowerCase().includes(cleanQuery) ||
              item.searchTerms.some(term => term.includes(cleanQuery)),
          );
        },
        render: () => {
          let component: ReactRenderer<SlashCommandMenuRef> | null = null;
          let unmount: (() => void) | undefined;

          return {
            onStart: (props: SuggestionProps<SlashCommandItem>) => {
              component = new ReactRenderer(SlashCommandMenu, {
                props,
                editor: props.editor,
              });

              if (!props.clientRect) {
                return;
              }

              unmount = props.mount(component.element);
            },

            onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
              component?.updateProps(props);
            },

            onKeyDown: (props: { event: KeyboardEvent }) => {
              if (props.event.key === "Escape") {
                unmount?.();
                return true;
              }

              return component?.ref?.onKeyDown(props) ?? false;
            },

            onExit: () => {
              unmount?.();
              component?.destroy();
              component = null;
            },
          };
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
