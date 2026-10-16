import React, { useRef, useEffect } from "react";
import { Card } from "./ui/card";
import { useTranslations } from "next-intl";

interface NewNoteCardProps {
  onSave: (title: string) => void;
  onCancel: () => void;
}

export function NewNoteCard({ onSave, onCancel }: NewNoteCardProps) {
  const t = useTranslations("NoteCard");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      e.preventDefault(); // prevent newline before saving
      onSave(e.currentTarget.value);
    }
    if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <Card className="border-border shadow-md min-w-[120px] max-w-[240px] p-3 bg-background border-dashed border-2">
      <textarea
        ref={inputRef}
        placeholder={t("newNotePlaceholder")}
        rows={1}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        onChange={e => {
          e.target.style.height = "auto";
          e.target.style.height = e.target.scrollHeight + "px";
        }}
        className="w-full resize-none overflow-hidden bg-transparent text-sm font-semibold text-center border-none outline-none p-0 focus:ring-0 focus:outline-none leading-initial placeholder:text-muted-foreground"
        style={{ fieldSizing: "content" } as React.CSSProperties}
      />
    </Card>
  );
}
