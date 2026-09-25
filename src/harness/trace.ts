/**
 * Normalized trace events (spec 1a section 5). v2 adds the stored call
 * fields (command, command_cut, target, category, classifier); a v1 trace is
 * read back upgraded with nulls.
 */

import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { CATEGORIES } from "./classify.ts";

export const TRACE_VERSION = 2;

const Str = z.string().nullable();
const Count = z.number().int().nonnegative().nullable();

/** The v1 fields, all of which v2 keeps. */
const V1_FIELDS = {
  /** Strictly increasing within one trace, from 1. */
  seq: z.number().int().positive(),
  t_ms: z.number().nonnegative().nullable(),
  type: z.enum([
    "tool_call",
    "model_request",
    "skill_invoke",
    "subagent_spawn",
    "compaction",
    "retry",
  ]),
  session: Str,
  agent: z.string(),
  parent: Str,
  call_id: Str,
  request_id: Str,
  tool: Str,
  /** builtin, mcp:<server>, shell */
  transport: Str,
  skill: Str,
  backend_request: Str,
  outcome: z.enum(["ok", "error", "denied", "cancelled"]).nullable(),
  error_class: Str,
  result_bytes: Count,
  truncated: z.boolean().nullable(),
  duration_ms: z.number().nonnegative().nullable(),
  model: Str,
};
const V1 = z.strictObject({ v: z.literal(1), ...V1_FIELDS });

/** Strict: an unknown key, a missing key or a non-finite number is refused. */
export const TraceEventSchema = z.strictObject({
  v: z.literal(TRACE_VERSION),
  ...V1_FIELDS,
  /** Shell command after pattern redaction; null when not a shell call or over the cap. */
  command: Str,
  /** True when the command was over the cap and dropped (never cut). */
  command_cut: z.boolean().nullable(),
  target: Str,
  category: z.enum(CATEGORIES).nullable(),
  /** `<rule>@<RULES_VERSION>` from classify.ts. */
  classifier: Str,
});
export type TraceEvent = z.output<typeof TraceEventSchema>;

/**
 * Validate every event, then write one JSON line per event in schema key
 * order (same events, same bytes). Nothing is written if any event is
 * refused; the error names the file.
 */
export async function writeTrace(
  path: string,
  events: TraceEvent[],
): Promise<number> {
  const lines: string[] = [];
  let prev = 0;
  for (const [i, e] of events.entries()) {
    const r = TraceEventSchema.safeParse(e);
    const problem = !r.success
      ? r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join(
        "; ",
      )
      : r.data.seq <= prev
      ? `seq ${r.data.seq} does not follow ${prev}`
      : null;
    if (problem !== null || !r.success) {
      const msg = `${path}: trace event ${i}: ${problem}`;
      throw new ValidationError(msg, [msg]);
    }
    prev = r.data.seq;
    lines.push(JSON.stringify(r.data));
  }
  await Deno.writeTextFile(path, lines.map((l) => l + "\n").join(""));
  return lines.length;
}

const issue = (i: { path: PropertyKey[]; message: string }) =>
  `${i.path.map(String).join(".")}: ${i.message}`;

/**
 * Read a trace back: every line validated, one version per file, `seq`
 * strictly increasing. v1 events are upgraded with null call fields. A bad
 * line is refused with the file and line number.
 */
export async function readTrace(path: string): Promise<TraceEvent[]> {
  const out: TraceEvent[] = [];
  let version: unknown = null;
  for (const [i, l] of (await Deno.readTextFile(path)).split("\n").entries()) {
    if (l.trim() === "") continue;
    const fail = (why: string): never => {
      const msg = `${path}:${i + 1}: ${why}`;
      throw new ValidationError(msg, [msg]);
    };
    let raw: unknown;
    try {
      raw = JSON.parse(l);
    } catch {
      fail("not JSON");
    }
    const v = (raw as { v?: unknown } | null)?.v;
    if (version !== null && v !== version) {
      fail(`version ${v} after ${version}`);
    }
    version = v;
    let e: TraceEvent;
    if (v === 1) {
      const r = V1.safeParse(raw);
      if (!r.success) return fail(issue(r.error.issues[0]!));
      e = {
        ...r.data,
        v: TRACE_VERSION,
        command: null,
        command_cut: null,
        target: null,
        category: null,
        classifier: null,
      };
    } else {
      const r = TraceEventSchema.safeParse(raw);
      if (!r.success) return fail(issue(r.error.issues[0]!));
      e = r.data;
    }
    const prev = out.at(-1);
    if (prev && e.seq <= prev.seq) {
      fail(`seq ${e.seq} does not follow ${prev.seq}`);
    }
    out.push(e);
  }
  return out;
}
