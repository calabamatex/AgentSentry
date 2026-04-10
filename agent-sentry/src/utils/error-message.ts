/**
 * Safely extracts an error message from an unknown caught value.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
