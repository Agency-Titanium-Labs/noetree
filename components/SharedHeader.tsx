import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/routing";

interface SharedHeaderProps {
  badgeLabel: string;
  badgeIcon: React.ReactNode;
  status?: string;
  actions?: React.ReactNode;
}

export default function SharedHeader({
  badgeLabel,
  badgeIcon,
  status,
  actions,
}: Readonly<SharedHeaderProps>) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="font-semibold">
          NoeTree
        </Link>
        <div className="flex items-center gap-3">
          {actions}
          {status && (
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {status}
            </span>
          )}
          <Badge variant="secondary" aria-label={badgeLabel} title={badgeLabel}>
            {badgeIcon}
            <span className="hidden sm:inline">{badgeLabel}</span>
          </Badge>
        </div>
      </div>
    </header>
  );
}
