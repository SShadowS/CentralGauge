/** Normalized trace events, schema v1 (spec 1a section 5). M2/M3 extend producers, not the shape. */

import { z } from "zod";
import { ValidationError } from "../errors.ts";

export const TRACE_VERSION = 1;

const Str = z.string().nullable();
const Count = z.number().int().nonnegative().nullable();

/** Strict: an unknown key, a missing key or a non-finite number is refused. */
export const TraceEventSchema = z.strictObject({
  v: z.literal(TRACE_VERSION),
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
