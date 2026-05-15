/**
 * Parse `[TRACE]` lines emitted by the pwsh-side `CG-Trace` helper out of
 * BCH script stdout and forward them to the tracer.
 *
 * Strict matcher: only lines starting EXACTLY with `[TRACE] {` count. Any
 * other content (including informational output from BCH cmdlets) passes
 * through untouched. JSON parse failures emit a `trace-parse-error`
 * instant so they're visible in the trace itself; the bench continues.
 *
 * Spec: docs/superpowers/specs/2026-05-15-bench-tracing.md.
 */

import type { TraceEvent } from "./tracer.ts";
import { getTracer } from "./tracer.ts";

/** Strict prefix that pwsh `[Console]::Out.WriteLine` produces. */
const TRACE_PREFIX = "[TRACE] {";

/** Result of parsing one script's stdout. */
export interface ParseTraceLinesResult {
  /** Stdout with `[TRACE]` lines removed (passes the rest through unchanged). */
  filteredOutput: string;
  /** Events extracted from `[TRACE]` lines. */
  events: TraceEvent[];
  /** Count of lines that started with the prefix but failed to parse. */
  parseErrors: number;
}

/**
 * Walk a script's stdout, extracting trace events and returning the rest.
 *
 * Pure function: doesn't touch the tracer. Use `mergeIntoTracer` to push
 * the events into the active tracer.
 */
export function parseTraceLines(stdout: string): ParseTraceLinesResult {
  const events: TraceEvent[] = [];
  const filtered: string[] = [];
  let parseErrors = 0;

  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith(TRACE_PREFIX)) {
      filtered.push(line);
      continue;
    }
    const json = line.slice("[TRACE] ".length);
    try {
      const ev = JSON.parse(json) as TraceEvent;
      if (
        typeof ev !== "object" || ev === null ||
        typeof ev.name !== "string" || typeof ev.ph !== "string" ||
        typeof ev.tid !== "number"
      ) {
        parseErrors++;
        continue;
      }
      events.push(ev);
    } catch {
      parseErrors++;
    }
  }
  return {
    filteredOutput: filtered.join("\n"),
    events,
    parseErrors,
  };
}

/**
 * Parse + forward to the active tracer. Returns the filtered stdout so
 * callers can use it as a drop-in replacement for the raw script output.
 *
 * `defaultLaneName` is used to label the lane in Perfetto if the pwsh
 * event arrived on a tid the host hasn't seen before. Pass something like
 * `"Cronus281 (pwsh cmdlets)"`.
 *
 * When the tracer is disabled, this is a no-op fast path — but the BCH
 * scripts wouldn't have emitted any `[TRACE]` lines in that case anyway
 * (the helper checks `$env:CG_TRACE_BENCH_START_UNIX_MICROS`).
 */
export function mergeIntoTracer(
  stdout: string,
  defaultLaneName?: string,
): string {
  const tracer = getTracer();
  if (!tracer.enabled) {
    return stdout;
  }
  const { filteredOutput, events, parseErrors } = parseTraceLines(stdout);
  for (const ev of events) {
    tracer.pushPreformed(ev, defaultLaneName);
  }
  if (parseErrors > 0) {
    tracer.instant("trace-parse-error", {
      tid: "orchestrator",
      cat: ["tracing"],
      args: { count: parseErrors },
    });
  }
  return filteredOutput;
}
