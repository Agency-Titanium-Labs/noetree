const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(
  timestamp: number,
  locale: string,
  now: number = Date.now(),
): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const elapsed = Math.max(0, now - timestamp);

  if (elapsed < MINUTE) {
    return rtf.format(-Math.floor(elapsed / SECOND), "second");
  }
  if (elapsed < HOUR) {
    return rtf.format(-Math.floor(elapsed / MINUTE), "minute");
  }
  if (elapsed < DAY) {
    return rtf.format(-Math.floor(elapsed / HOUR), "hour");
  }
  if (elapsed < 7 * DAY) {
    return rtf.format(-Math.floor(elapsed / DAY), "day");
  }
  if (elapsed < 35 * DAY) {
    return rtf.format(-Math.floor(elapsed / (7 * DAY)), "week");
  }
  if (elapsed < 365 * DAY) {
    return rtf.format(-Math.floor(elapsed / (30 * DAY)), "month");
  }
  return rtf.format(-Math.floor(elapsed / (365 * DAY)), "year");
}

export function formatFullDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
