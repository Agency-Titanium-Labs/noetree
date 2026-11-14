import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const quoteVariants = cva(
  "relative flex items-start gap-1.5 rounded border-l-2 transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-muted/40 text-foreground",
        amber:
          "border-amber-400 bg-amber-50 text-muted-foreground dark:border-amber-500 dark:bg-amber-950/30",
        secondary:
          "border-secondary-foreground/20 bg-secondary text-secondary-foreground",
        destructive:
          "border-destructive bg-destructive/10 text-destructive dark:bg-destructive/20",
        muted: "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        ghost: "border-transparent bg-transparent text-muted-foreground",
      },
      size: {
        default: "px-3 py-1.5 text-sm",
        sm: "px-2 py-1 text-xs",
        lg: "px-4 py-2.5 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Quote({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"blockquote"> &
  VariantProps<typeof quoteVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "blockquote";

  return (
    <Comp
      data-slot="quote"
      data-variant={variant}
      data-size={size}
      className={cn(quoteVariants({ variant, size }), className)}
      {...props}
    />
  );
}

function QuoteContent({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"p"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "p";

  return (
    <Comp
      data-slot="quote-content"
      className={cn("min-w-0 flex-1 italic text-muted-foreground", className)}
      {...props}
    />
  );
}

function QuoteAuthor({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"cite"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "cite";

  return (
    <Comp
      data-slot="quote-author"
      className={cn(
        "mt-1 block text-xs not-italic text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Quote, QuoteContent, QuoteAuthor, quoteVariants };
