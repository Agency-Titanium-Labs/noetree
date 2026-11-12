const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(
  timestamp: number | Date,
  locale: string,
  now: number | Date = Date.now(),
  options?: { style?: Intl.RelativeTimeFormatStyle },
): string {
  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: options?.style ?? "long",
  });
  const nowMs = typeof now === "number" ? now : now.getTime();
  const tsMs = typeof timestamp === "number" ? timestamp : timestamp.getTime();
  const elapsed = Math.max(0, nowMs - tsMs);

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

export function formatCompactRelativeTime(
  timestamp: number | Date,
  locale: string,
  now: number | Date = Date.now(),
  options?: { unitDisplay?: "short" | "narrow" },
): string {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const tsMs = typeof timestamp === "number" ? timestamp : timestamp.getTime();
  const elapsed = Math.max(0, nowMs - tsMs);

  const fmt = (val: number, unit: string) =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit,
      unitDisplay: options?.unitDisplay ?? "short",
    }).format(val);

  if (elapsed < MINUTE) {
    return fmt(Math.max(1, Math.floor(elapsed / SECOND)), "second");
  }
  if (elapsed < HOUR) {
    return fmt(Math.floor(elapsed / MINUTE), "minute");
  }
  if (elapsed < DAY) {
    return fmt(Math.floor(elapsed / HOUR), "hour");
  }
  if (elapsed < 7 * DAY) {
    return fmt(Math.floor(elapsed / DAY), "day");
  }
  if (elapsed < 35 * DAY) {
    return fmt(Math.floor(elapsed / (7 * DAY)), "week");
  }
  if (elapsed < 365 * DAY) {
    return fmt(Math.floor(elapsed / (30 * DAY)), "month");
  }
  return fmt(Math.floor(elapsed / (365 * DAY)), "year");
}

export function formatFullDate(
  timestamp: number | Date,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
