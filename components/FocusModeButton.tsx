"use client";

import { useRef, useCallback } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useEditorContext } from "@/providers/EditorProvider";
import { useOptionalSidebar } from "@/components/ui/sidebar";

export default function FocusModeButton({
  className,
}: Readonly<{ className?: string }>) {
  const t = useTranslations("Editor");
  const editorContext = useEditorContext();
  const isFocusMode = editorContext?.isFocusMode ?? false;
  const toggleFocusMode = editorContext?.toggleFocusMode ?? (() => {});

  const sidebar = useOptionalSidebar();
  const previousSidebarState = useRef<boolean | null>(null);

  const handleClick = useCallback(() => {
    if (sidebar) {
      if (!isFocusMode) {
        // Entering focus mode: remember sidebar state and collapse it
        previousSidebarState.current = sidebar.open;
        if (sidebar.open) {
          sidebar.setOpen(false);
        }
      } else {
        // Exiting focus mode: restore sidebar state if it was open
        if (previousSidebarState.current) {
          sidebar.setOpen(true);
        }
        previousSidebarState.current = null;
      }
    }
    toggleFocusMode();
  }, [sidebar, isFocusMode, toggleFocusMode]);

  const label = isFocusMode ? t("exitFocusMode") : t("enterFocusMode");

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleClick}
      aria-label={label}
      aria-pressed={isFocusMode}
      className={className}
    >
      {isFocusMode ? (
        <Minimize2 aria-hidden="true" />
      ) : (
        <Maximize2 aria-hidden="true" />
      )}
    </Button>
  );
}
