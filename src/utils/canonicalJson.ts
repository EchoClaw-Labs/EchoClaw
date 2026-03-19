/**
 * Canonical JSON: recursive sorting of object keys.
 * MUST be identical in slop-backend and echoclaw!
 *
 * This ensures consistent hash computation for query signing.
 */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce(
          (sorted, k) => {
            sorted[k] = value[k];
            return sorted;
          },
          {} as Record<string, unknown>
        );
    }
    return value;
  });
}
