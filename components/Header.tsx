"use client";

import { useStoreUserEffect } from "@/hooks/useStoreUserEffect";
import ConditionChecker from "@/components/helpers/ConditionChecker";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useHeader } from "@/providers/HeaderProvider";

export default function Header() {
  const { isLoading, isAuthenticated } = useStoreUserEffect();
  const { title, search, action } = useHeader();

  return (
    <header className="flex justify-between items-center px-4 md:px-6 py-4 gap-4 h-16 shrink-0 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="flex items-center gap-3 min-w-0">
        <SidebarTrigger className="shrink-0" />
        {title && (
          <>
            <span className="h-4 w-px bg-border shrink-0" />
            <h2 className="font-semibold text-sm sm:text-base md:text-lg truncate text-foreground select-none">
              {title}
            </h2>
          </>
        )}
      </div>

      {search && <div className="flex-1 max-w-xs mx-2 sm:mx-4">{search}</div>}

      <div className="flex items-center gap-3 shrink-0">
        {action}
        <ConditionChecker condition={!isLoading}>
          <ConditionChecker condition={!isAuthenticated}>
            <div className="flex items-center gap-2">
              <SignInButton />
              <SignUpButton />
            </div>
          </ConditionChecker>
        </ConditionChecker>
      </div>
    </header>
  );
}
