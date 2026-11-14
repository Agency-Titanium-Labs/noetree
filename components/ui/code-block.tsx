"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function CodeBlock({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block"
      className={cn(
        "group relative rounded-lg border border-border bg-muted/40 font-mono text-sm overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

function CodeBlockHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-header"
      className={cn(
        "flex items-center justify-between border-b border-border/50 bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground select-none",
        className,
      )}
      {...props}
    />
  );
}

function CodeBlockTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-title"
      className={cn("flex items-center gap-1.5 font-sans text-xs", className)}
      {...props}
    />
  );
}

function CodeBlockActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-actions"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  );
}

interface CodeBlockCopyButtonProps extends React.ComponentProps<typeof Button> {
  value?: string;
  onCopy?: () => void;
  copyLabel?: string;
  copiedLabel?: string;
}

function CodeBlockCopyButton({
  value,
  onCopy,
  copyLabel = "Copy",
  copiedLabel = "Copied!",
  className,
  ...props
}: CodeBlockCopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    if (!value) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        onCopy?.();
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.warn("Failed to copy code:", err);
    }
  }, [value, onCopy]);

  return (
    <Button
      data-slot="code-block-copy-button"
      type="button"
      variant="ghost"
      size="xs"
      className={cn(
        "h-6 gap-1 px-1.5 text-xs font-sans text-muted-foreground hover:bg-background/50 hover:text-foreground",
        className,
      )}
      onClick={handleCopy}
      title={copied ? copiedLabel : copyLabel}
      aria-label={copied ? copiedLabel : copyLabel}
      {...props}
    >
      {copied ? (
        <>
          <Check className="size-3.5 text-green-500" />
          <span>{copiedLabel}</span>
        </>
      ) : (
        <>
          <Copy className="size-3.5" />
          <span>{copyLabel}</span>
        </>
      )}
    </Button>
  );
}

interface CodeBlockContentProps extends React.ComponentProps<"pre"> {
  wrap?: boolean;
  lineNumbers?: boolean;
}

function CodeBlockContent({
  wrap = false,
  lineNumbers = false,
  className,
  ...props
}: CodeBlockContentProps) {
  return (
    <pre
      data-slot="code-block-content"
      data-wrap={wrap}
      data-line-numbers={lineNumbers}
      className={cn(
        "p-4 leading-relaxed font-mono text-sm",
        wrap
          ? "whitespace-pre-wrap break-words overflow-x-hidden"
          : "whitespace-pre overflow-x-auto",
        className,
      )}
      {...props}
    />
  );
}

interface CodeBlockLineProps extends React.ComponentProps<"div"> {
  variant?: "default" | "highlighted" | "added" | "removed";
}

function CodeBlockLine({
  variant = "default",
  className,
  ...props
}: CodeBlockLineProps) {
  return (
    <div
      data-slot="code-block-line"
      data-variant={variant}
      className={cn(
        "table-row font-mono text-sm leading-relaxed",
        variant === "highlighted" && "bg-muted/80",
        variant === "added" &&
          "bg-green-500/10 text-green-700 dark:text-green-400",
        variant === "removed" && "bg-red-500/10 text-red-700 dark:text-red-400",
        className,
      )}
      {...props}
    />
  );
}

function CodeBlockFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-footer"
      className={cn(
        "flex items-center border-t border-border/50 bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockContent,
  CodeBlockLine,
  CodeBlockFooter,
};
