/**
 * Validate a YYYY-MM-DD string and return a Date (UTC midnight) or null.
 * Checks calendar validity — rejects impossible dates like 2026-02-31
 * that JavaScript silently rolls forward.
 */
export function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  // Verify the parsed components match the input to catch rollover (e.g. Feb 31 -> Mar 3)
  const [year, month, day] = value.split("-").map(Number);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}
