import { cn } from "@/lib/utils";

interface TypingDotsProps {
  className?: string;
  dotClassName?: string;
}

export default function TypingDots({
  className,
  dotClassName,
}: Readonly<TypingDotsProps>) {
  return (
    <span
      className={cn("collaborative-cursor-typing", className)}
      aria-hidden="true"
    >
      <span className={cn("collaborative-cursor-dot", dotClassName)} />
      <span className={cn("collaborative-cursor-dot", dotClassName)} />
      <span className={cn("collaborative-cursor-dot", dotClassName)} />
    </span>
  );
}
