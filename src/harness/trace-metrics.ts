/** Per-execution metrics from a trace, read with the run's own capabilities (spec 1a sections 5 and 9). */

import { isAbsolute, join, normalize } from "@std/path";
import type { Category } from "./classify.ts";
import type { ExecutionRecord } from "./records.ts";
import type { TraceEvent } from "./trace.ts";
import { CATEGORIES, classify, RULES_VERSION } from "./classify.ts";
import { readTrace } from "./trace.ts";

export interface TraceMetrics {
  complete: boolean;
  tool_calls: number;
  tool_errors: number;
  errors_by_class: Record<string, number>;
  by_transport: Record<string, number>;
  by_agent: Record<string, number>;
  categories: Record<Category, number>;
  rule_classified: number;
  unclassified: number;
  /** Calls with a stale classification whose command was dropped (over the cap): never guessed. */
  unreplayable: number;
  /** Trace-classified compile calls, not backend builds (the host log counts builds). */
  compile_calls: { via_backend_route: number; in_container: number };
  /** null: the run's parser does not emit that event type (never zero). */
  model_requests: number | null;
  subagents: number | null;
  skill_invocations: Record<string, number> | null;
  mcp_calls: Record<string, number>;
  compactions: number | null;
  retries: number | null;
  rules: string;
}

export interface LoadedTrace {
  events: TraceEvent[];
  complete: boolean;
  trace_types: string[];
}

const SHELL_TOOLS = new Set(["Bash", "PowerShell", "bash"]);

const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

export function traceMetrics(
  events: TraceEvent[],
  run: { complete: boolean; trace_types: readonly string[] },
): TraceMetrics {
  const has = (t: string) => run.trace_types.includes(t);
  const m: TraceMetrics = {
    complete: run.complete,
    tool_calls: 0,
    tool_errors: 0,
    errors_by_class: {},
    by_transport: {},
    by_agent: {},
    categories: Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<
      Category,
      number
    >,
    rule_classified: 0,
    unclassified: 0,
    unreplayable: 0,
    compile_calls: { via_backend_route: 0, in_container: 0 },
    model_requests: has("model_request") ? 0 : null,
    subagents: has("subagent_spawn") ? 0 : null,
    skill_invocations: has("skill_invoke") ? {} : null,
    mcp_calls: {},
    compactions: has("compaction") ? 0 : null,
    retries: has("retry") ? 0 : null,
    rules: `rules@${RULES_VERSION}`,
  };
  for (const e of events) {
    if (e.type === "model_request" && m.model_requests !== null) {
      m.model_requests++;
    } else if (e.type === "subagent_spawn" && m.subagents !== null) {
      m.subagents++;
    } else if (e.type === "skill_invoke" && m.skill_invocations !== null) {
      bump(m.skill_invocations, e.skill ?? "(unnamed)");
    } else if (e.type === "compaction" && m.compactions !== null) {
      m.compactions++;
    } else if (e.type === "retry" && m.retries !== null) m.retries++;
    if (e.type !== "tool_call") continue;
    m.tool_calls++;
    if (e.outcome !== null && e.outcome !== "ok") {
      m.tool_errors++;
      bump(m.errors_by_class, e.error_class ?? "unclassified_error");
    }
    bump(m.by_transport, e.transport ?? "unknown");
    bump(m.by_agent, e.agent);
    if (e.transport?.startsWith("mcp:")) {
      bump(m.mcp_calls, e.transport.slice(4));
    }
    // A classification from other rules is replayed from the full command;
    // a dropped command is never guessed.
    let c: { category: Category; classifier: string };
    if (
      e.category !== null && e.classifier !== null &&
      e.classifier.endsWith(`@${RULES_VERSION}`)
    ) c = { category: e.category, classifier: e.classifier };
    else if (
      e.command_cut === true ||
      (e.command === null && SHELL_TOOLS.has(e.tool ?? ""))
    ) {
      // A dropped command, or a v1 shell call whose command was never recorded.
      m.unreplayable++;
      c = { category: "unclassified", classifier: `none@${RULES_VERSION}` };
    } else {
      c = classify({
        tool: e.tool ?? "",
        command: e.command,
        target: e.target,
      });
    }
    m.categories[c.category]++;
    if (c.category === "unclassified") m.unclassified++;
    else m.rule_classified++;
    if (c.category === "compile") {
      if (c.classifier.startsWith("shell.toolchain.")) {
        m.compile_calls.in_container++;
      } else m.compile_calls.via_backend_route++;
    }
  }
  return m;
}

/**
 * Each execution's published trace with the run's own capabilities. Never
 * throws: no trace_path is null; a missing, malformed or out-of-root trace is
 * null and listed in `invalid`. Records written before M2-05 have no `trace_complete` and read
 * as incomplete.
 */
export async function loadTraces(
  root: string,
  executions: ExecutionRecord[],
): Promise<{
  traces: Map<string, LoadedTrace | null>;
  invalid: { execution: string; error: string }[];
}> {
  const traces = new Map<string, LoadedTrace | null>();
  const invalid: { execution: string; error: string }[] = [];
  for (const e of executions) {
    if (e.trace_path === null) {
      traces.set(e.id, null);
      continue;
    }
    const raw = e.telemetry.raw_usage as {
      trace_complete?: unknown;
      capabilities?: { trace_types?: unknown };
    } | null;
    const types = raw?.capabilities?.trace_types;
    const rel = e.trace_path;
    const bad = (error: string) => {
      traces.set(e.id, null);
      invalid.push({ execution: e.id, error });
    };
    // A published record names a path inside the results root; anything else is never read.
    if (
      isAbsolute(rel) || /^[A-Za-z]:/.test(rel) ||
      normalize(rel).split(/[\\/]/).includes("..")
    ) {
      bad("trace_path outside the results root");
      continue;
    }
    const full = join(root, rel);
    try {
      traces.set(e.id, {
        events: await readTrace(full),
        complete: raw?.trace_complete === true,
        trace_types: Array.isArray(types) ? types.map(String) : ["tool_call"],
      });
    } catch (err) {
      // The record says a trace was published, so a missing file is data loss.
      // Messages name the relative path only: the JSON must not depend on the machine.
      bad(
        err instanceof Deno.errors.NotFound
          ? `trace missing: ${rel}`
          : (err instanceof Error ? err.message : String(err))
            .replaceAll(full, rel),
      );
    }
  }
  return { traces, invalid };
}
