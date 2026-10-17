import { ConvexError } from "convex/values";
import {
  createElement,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

/** next-intl namespace that holds the guard error messages. */
export const GUARD_NAMESPACE = "Guards";

/** Whether the Leave action may be offered for a shared note (D-04). */
export function canLeaveShare(note: {
  isShared?: boolean;
  isPurchased?: boolean;
}): boolean {
  return !!note.isShared && !note.isPurchased;
}

type ItemProps = {
  onClick?: (e: never) => void;
  variant?: "destructive";
  children?: ReactNode;
};

type LeaveShareMenuItemProps = {
  note: { isShared?: boolean; isPurchased?: boolean };
  onLeave: () => void;
  label: ReactNode;
  icon?: ReactNode;
  /** Menu item component to render (defaults to a plain menuitem button). */
  as?: ComponentType<ItemProps>;
};

function DefaultItem({ onClick, children }: ItemProps) {
  return createElement(
    "button",
    { type: "button", role: "menuitem", onClick: onClick as never },
    children,
  );
}

/** Leave menu item; renders nothing for notes granted by a purchase. */
export function LeaveShareMenuItem({
  note,
  onLeave,
  label,
  icon,
  as: Item = DefaultItem,
}: LeaveShareMenuItemProps) {
  if (!canLeaveShare(note)) return null;
  return createElement(
    Item,
    { variant: "destructive", onClick: onLeave },
    icon,
    label,
  );
}

const GUARD_KEYS: Record<string, string> = {
  NOTE_HAS_PURCHASE_GRANTS: "noteHasPurchaseGrants",
  SHARE_PROTECTED: "shareProtected",
  LISTING_PURCHASED_CONTENT: "listingPurchasedContent",
};

/** Message key (inside GUARD_NAMESPACE) for a server guard code, or null. */
export function guardErrorMessageKey(code: string): string | null {
  return Object.hasOwn(GUARD_KEYS, code) ? GUARD_KEYS[code] : null;
}

export const GUARD_EVENT = "noetree:guard-error";

/** Broadcast a guard error (from non-UI code such as mutation hooks). */
export function emitGuardError(err: unknown): void {
  const code = convexErrorCode(err);
  if (!code || !guardErrorMessageKey(code) || typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(GUARD_EVENT, { detail: code }));
}

/**
 * Localized guard error state. `report(err)` sets the message when the error
 * is a known guard code (returns true); window events from emitGuardError
 * are picked up as well.
 */
export function useGuardNotice() {
  const t = useTranslations(GUARD_NAMESPACE);
  const [message, setMessage] = useState<string | null>(null);

  const show = useCallback(
    (code: string): boolean => {
      const key = guardErrorMessageKey(code);
      if (!key) return false;
      setMessage(t(key));
      return true;
    },
    [t],
  );

  const report = useCallback(
    (err: unknown): boolean => {
      const code = convexErrorCode(err);
      return code ? show(code) : false;
    },
    [show],
  );

  useEffect(() => {
    const handler = (e: Event) => show(String((e as CustomEvent).detail));
    window.addEventListener(GUARD_EVENT, handler);
    return () => window.removeEventListener(GUARD_EVENT, handler);
  }, [show]);

  return { message, report, clear: () => setMessage(null) };
}

/** Extract the string code from a ConvexError (string or { code }). */
export function convexErrorCode(err: unknown): string | null {
  if (!(err instanceof ConvexError)) return null;
  const data: unknown = err.data;
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "code" in data) {
    const code = (data as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}
