// Constant-time check of INTERNAL_WEBHOOK_SECRET for server-to-server calls
// (Next route -> Convex). Length mismatch and content mismatch are folded into
// one accumulator with no early exit. A missing/empty server-side secret never
// authenticates anyone, not even an empty string.
//
// Same algorithm as connectAccounts.ts (kept as a separate copy on purpose so
// the AI metering code does not depend on, or edit, the marketplace modules).
export function isValidInternalSecret(provided: string): boolean {
  const expected = process.env.INTERNAL_WEBHOOK_SECRET;
  if (!expected) return false;
  const len = Math.max(provided.length, expected.length);
  let diff = provided.length ^ expected.length;
  for (let i = 0; i < len; i++) {
    diff |= (provided.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}
