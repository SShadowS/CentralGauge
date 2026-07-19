/**
 * Hardening helpers for the AL Tools MCP HTTP server.
 *
 * Kept in a standalone module (no BC container imports) so unit tests can
 * exercise them without dragging in the container provider.
 *
 * - authorize / readBodyCapped: per-run bearer-token auth + request body cap
 *   (finding M3)
 * - appendTextWithRotation: debug/timing log rotation (finding M8)
 * - buildParseErrorResponse: JSON-RPC parse error with id null (finding M9)
 * - validateToolCallEnvelope / validateRequiredStringParams: tools/call
 *   params shape validation for -32602 responses (finding M13)
 */

/** Maximum accepted HTTP request body size (10 MB). */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Check the request's bearer token against the per-run auth token.
 * A null token means no auth is configured (non-sandbox local mode, where
 * the server binds 127.0.0.1) — every request is allowed.
 */
export function authorize(request: Request, token: string | null): boolean {
  if (token === null || token === "") return true;
  const header = request.headers.get("authorization");
  return header === `Bearer ${token}`;
}

/** Result of a capped body read. */
export type CappedBodyResult =
  | { ok: true; body: string }
  | { ok: false; reason: "too_large" };

/**
 * Read a request body, rejecting anything over maxBytes.
 * Checks Content-Length first, then enforces the cap during the actual
 * read (Content-Length is client-controlled and may lie or be absent).
 */
export async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<CappedBodyResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      return { ok: false, reason: "too_large" };
    }
  }

  if (!request.body) return { ok: true, body: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Stream may already be closed
      }
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body: new TextDecoder().decode(merged) };
}

/** JSON-RPC error response shape used by the parse-error path. */
export interface JsonRpcParseErrorResponse {
  jsonrpc: "2.0";
  id: null;
  error: { code: number; message: string };
}

/**
 * Build a JSON-RPC parse-error response. The spec requires id null when the
 * request id could not be determined (a body that failed to parse).
 */
export function buildParseErrorResponse(
  detail: string,
): JsonRpcParseErrorResponse {
  return {
    jsonrpc: "2.0",
    id: null,
    error: { code: -32700, message: `Parse error: ${detail}` },
  };
}

/** Validated tools/call envelope. */
export type ToolCallEnvelopeResult =
  | { ok: true; name: string; args: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Validate the shape of tools/call params: `name` must be a string and
 * `arguments`, when present, a plain object.
 */
export function validateToolCallEnvelope(
  params: unknown,
): ToolCallEnvelopeResult {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return { ok: false, message: "tools/call params must be an object" };
  }
  const record = params as Record<string, unknown>;
  const name = record["name"];
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, message: "tools/call params.name must be a string" };
  }
  const args = record["arguments"];
  if (args === undefined) {
    return { ok: true, name, args: {} };
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return {
      ok: false,
      message: "tools/call params.arguments must be an object",
    };
  }
  return { ok: true, name, args: args as Record<string, unknown> };
}

/**
 * Validate that each required parameter is present and a string (all
 * required tool params in this server are strings).
 */
export function validateRequiredStringParams(
  args: Record<string, unknown>,
  required: string[],
): { ok: true } | { ok: false; message: string } {
  for (const name of required) {
    if (typeof args[name] !== "string") {
      return {
        ok: false,
        message: `Missing or invalid required parameter: ${name} (string)`,
      };
    }
  }
  return { ok: true };
}

/**
 * Append text to a log file, rotating it to `<path>.1` once it reaches
 * maxBytes (single rotation slot — the previous .1 is replaced).
 */
export function appendTextWithRotation(
  path: string,
  text: string,
  maxBytes: number,
): void {
  try {
    const stat = Deno.statSync(path);
    if (stat.size >= maxBytes) {
      try {
        Deno.removeSync(path + ".1");
      } catch {
        // No previous rotation
      }
      Deno.renameSync(path, path + ".1");
    }
  } catch {
    // File doesn't exist yet — nothing to rotate
  }
  Deno.writeTextFileSync(path, text, { append: true });
}
