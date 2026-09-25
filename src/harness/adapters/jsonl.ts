/**
 * JSONL reading shared by the harness stream parsers (moved from the Claude
 * Code adapter, accept-M1-32): one JSON object with a string `type` per line;
 * a leading BOM, CRLF and blank lines are accepted. Any other line (a stray
 * warning, a corrupt or truncated record, a non-object) never throws the
 * attempt away: it is counted, and the first few are named by line number and
 * byte length. No content is stored, since even a prefix can carry part of a
 * secret; the full log stays in quarantine. Lines split on LF only (pi
 * docs/json.md: U+2028/U+2029 are valid inside JSON strings).
 */

import { ValidationError } from "../../errors.ts";

export interface Line<T> {
  rec: T;
  line: number;
}

const NON_JSON_SHOWN = 3;
export interface NonJson {
  count: number;
  first: { line: number; bytes: number }[];
}

/** Stream record: the keys the parsers read are declared (noPropertyAccessFromIndexSignature). */
export interface J {
  [k: string]: unknown;
  type?: unknown;
  subtype?: unknown;
  claude_code_version?: unknown;
  message?: unknown;
  content?: unknown;
  tool_use_id?: unknown;
  is_error?: unknown;
  id?: unknown;
  model?: unknown;
  usage?: unknown;
  name?: unknown;
  session_id?: unknown;
  parent_tool_use_id?: unknown;
  cache_creation?: unknown;
  ephemeral_5m_input_tokens?: unknown;
  ephemeral_1h_input_tokens?: unknown;
  tool_use_result?: unknown;
  resolvedModel?: unknown;
  modelUsage?: unknown;
  thinkingTokens?: unknown;
  input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  output_tokens?: unknown;
  rate_limit_info?: unknown;
  status?: unknown;
  resetsAt?: unknown;
  api_error_status?: unknown;
  stop_reason?: unknown;
  skills?: unknown;
  mcp_servers?: unknown;
  total_cost_usd?: unknown;
  num_turns?: unknown;
  duration_ms?: unknown;
  timestamp?: unknown;
  input?: unknown;
  text?: unknown;
  op?: unknown;
  client?: unknown;
  result?: unknown;
  request?: unknown;
  ok?: unknown;
  infra?: unknown;
  apps?: unknown;
  tests?: unknown;
  failure?: unknown;
  diagnostics?: unknown;
  skill?: unknown;
  subagent_type?: unknown;
  file_path?: unknown;
  notebook_path?: unknown;
  path?: unknown;
  command?: unknown;
  permission_denials?: unknown;
}

export const isObj = (v: unknown): v is J =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const obj = (v: unknown): J => (isObj(v) ? v : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function readRecords<T extends object>(
  text: string,
): { lines: Line<T>[]; nonJson: NonJson } {
  const raw = (text.startsWith("\uFEFF") ? text.slice(1) : text).split(
    /\r?\n/,
  );
  const lines: Line<T>[] = [];
  const nonJson: NonJson = { count: 0, first: [] };
  for (const [i, l] of raw.entries()) {
    if (l.trim() === "") continue;
    let v: unknown;
    try {
      v = JSON.parse(l);
    } catch {
      v = undefined;
    }
    if (isObj(v) && typeof v["type"] === "string") {
      lines.push({ rec: v as T, line: i + 1 });
      continue;
    }
    nonJson.count++;
    if (nonJson.first.length < NON_JSON_SHOWN) {
      nonJson.first.push({
        line: i + 1,
        bytes: new TextEncoder().encode(l).length,
      });
    }
  }
  return { lines, nonJson };
}

/** Names the non-JSON lines: count and the first line numbers. */
export function nonJsonReason(n: NonJson): string {
  return `${n.count} non-JSON stdout line${n.count === 1 ? "" : "s"} (${
    n.first.map((x) => `line ${x.line}`).join(", ")
  }${n.count > n.first.length ? ", ..." : ""})`;
}

export function refuse(msg: string): never {
  throw new ValidationError(msg, [msg]);
}

/** At most one record of a kind; a second one contradicts the first. */
export function only<T>(
  recs: Line<T>[],
  what: string,
  file: string,
): Line<T> | undefined {
  if (recs.length > 1) {
    refuse(
      `${file}: ${recs.length} ${what} records (lines ${
        recs.map((r) => r.line).join(", ")
      })`,
    );
  }
  return recs[0];
}
