/**
 * Best-effort structured error code from a provider SDK error, for the
 * attempt record's `providerErrorCode` (spec section 10). Walks `cause` up
 * to three levels. Returns undefined when nothing structured is present;
 * never invents a code.
 */
export function providerErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 4 && current !== null && typeof current === "object";
    depth++
  ) {
    const e = current as {
      status?: unknown;
      error?: { type?: unknown; code?: unknown } | null;
      context?: Record<string, unknown>;
      cause?: unknown;
    };
    const type = typeof e.error?.type === "string"
      ? e.error.type
      : typeof e.error?.code === "string"
      ? e.error.code
      : undefined;
    const status = typeof e.status === "number"
      ? e.status
      : typeof e.context?.["status"] === "number"
      ? (e.context["status"] as number)
      : undefined;
    if (type !== undefined && status !== undefined) {
      return `http_${status}:${type}`;
    }
    if (type !== undefined) return type;
    if (status !== undefined) return `http_${status}`;
    current = e.cause;
  }
  return undefined;
}
