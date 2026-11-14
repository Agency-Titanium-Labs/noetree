"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import type {
  SlashCommandCategory,
  SlashCommandItem,
} from "./slashCommandItems";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

export interface SlashCommandMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export interface SlashCommandMenuProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

const CATEGORIES: readonly SlashCommandCategory[] = [
  "basic",
  "headings",
  "media",
  "formatting",
  "actions",
] as const;

export const SlashCommandMenu = forwardRef<
  SlashCommandMenuRef,
  SlashCommandMenuProps
>(({ items, command }, ref) => {
  const t = useTranslations("Editor.slashCommands");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  selectedIndexRef.current = selectedIndex;
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    selectedIndexRef.current = 0;
    setSelectedIndex(0);
  }, [items]);

  useEffect(() => {
    const activeEl = itemRefs.current[selectedIndex];
    activeEl?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowUp") {
        const next =
          (selectedIndexRef.current + items.length - 1) % items.length;
        selectedIndexRef.current = next;
        setSelectedIndex(next);
        return true;
      }
      if (event.key === "ArrowDown") {
        const next = (selectedIndexRef.current + 1) % items.length;
        selectedIndexRef.current = next;
        setSelectedIndex(next);
        return true;
      }
      if (event.key === "Enter") {
        const item = items[selectedIndexRef.current];
        if (item) {
          command(item);
          return true;
        }
      }
      return false;
    },
  }));

  const selectedValue = items[selectedIndex]?.id;
  const activeCategories = CATEGORIES.filter(category =>
    items.some(item => item.category === category),
  );

  return (
    <Command
      data-testid="slash-command-menu"
      shouldFilter={false}
      value={selectedValue}
      className="w-72 border shadow-md"
    >
      <CommandList>
        {items.length === 0 ? (
          <CommandEmpty data-testid="slash-command-empty">
            {t("noResult")}
          </CommandEmpty>
        ) : (
          activeCategories.map((category, catIndex) => {
            const groupItems = items.filter(item => item.category === category);
            return (
              <div key={category}>
                {catIndex > 0 && <CommandSeparator />}
                <CommandGroup heading={t(`categories.${category}`)}>
                  {groupItems.map(item => {
                    const Icon = item.icon;
                    const itemIndex = items.indexOf(item);
                    return (
                      <CommandItem
                        key={item.id}
                        ref={el => {
                          if (itemIndex !== -1) {
                            itemRefs.current[itemIndex] = el;
                          }
                        }}
                        value={item.id}
                        onSelect={() => command(item)}
                        onPointerMove={() => {
                          if (itemIndex !== -1) {
                            selectedIndexRef.current = itemIndex;
                            setSelectedIndex(itemIndex);
                          }
                        }}
                      >
                        <Icon />
                        <span>{t(item.titleKey)}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </div>
            );
          })
        )}
      </CommandList>
    </Command>
  );
});

SlashCommandMenu.displayName = "SlashCommandMenu";
