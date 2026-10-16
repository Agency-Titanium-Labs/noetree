const PRICE_RE = /^\d{1,3}([.,]\d{1,2})?$/;

/** Converts a user price string to integer cents; null when invalid. Bounds are enforced elsewhere. */
export function parsePriceToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!PRICE_RE.test(trimmed)) return null;
  const [intPart, fracPart = ""] = trimmed.replace(",", ".").split(".");
  return Number(intPart) * 100 + Number(fracPart.padEnd(2, "0"));
}

export function centsToPriceInput(cents: number): string {
  const rem = cents % 100;
  return `${Math.floor(cents / 100)}.${rem < 10 ? "0" : ""}${rem}`;
}

export function normalizeTagInput(raw: string): string {
  return raw.trim().toLowerCase();
}
