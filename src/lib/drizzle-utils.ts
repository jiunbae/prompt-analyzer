/**
 * Extract rows from a Drizzle raw SQL result.
 * Handles both array results and { rows: T[] } shapes.
 */
export function extractRows<T extends Record<string, unknown>>(
  result: unknown,
): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}
