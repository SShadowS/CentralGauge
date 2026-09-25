/**
 * pi 0.87.1 adapter (spec 1a section 12 item 3; findings section 4; pi
 * docs/json.md; decisions accept-M0-04, accept-M1-32, m1p2-round2,
 * pi-cache-ttl). Judged from events, never the exit code. Final settlement is
 * agent_settled (agent_end only closes one low-level run). Tool calls from
 * tool_execution_start, outcomes from tool_execution_end, usage and pi's own
 * cost from assistant message_end only. Cache writes carry no TTL: priced at
 * the 5-minute rate for pi/OpenRouter (owner decision), disclosed. Work that
 * bills outside message_end (compaction, summarization, anything unknown)
 * nulls the cost.
 */

import { basename } from "@std/path";
import type { HarnessAdapter, ParsedRun, ParseInput } from "../adapter.ts";
import type { ModelTokens } from "../pricing.ts";
import type { Telemetry, Termination } from "../records.ts";
import type { TraceEvent } from "../trace.ts";
import { ConfigurationError } from "../../errors.ts";
import { requestedComponents } from "../adapter.ts";
import { estimateCost } from "../pricing.ts";
import { TRACE_VERSION, writeTrace } from "../trace.ts";
import {
  type Line,
  nonJsonReason,
  only,
  readRecords,
  refuse,
} from "./jsonl.ts";

export const PI_PROVIDER = "openrouter";
export const PI_ROUTE = "openrouter:api-key";
export const ENTRY_RECORD = "cg_entry";
export const BUDGET_ENTRY = "cg-budget";
export const TTL_ASSUMPTION = "pi_openrouter_cache_write_5m";

type R = Record<string, unknown>;

/** Record types that never bill. */
const KNOWN_TYPES = new Set([
  "session",
  "agent_start",
  "agent_end",
  "agent_settled",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "auto_retry_start",
  "auto_retry_end",
  "queue_update",
  "entry_appended",
  "session_info_changed",
  "thinking_level_changed",
  ENTRY_RECORD,
]);
/**
 * Nested session entries (pi emits them as entry_appended) that never bill:
 * custom data (including our cg-budget records), custom messages, context
 * edits (retry context), labels, session info, thinking-level and model
 * changes. Any other entry type (usage entries such as cache_warm,
 * compaction, branch_summary, anything new) or any entry carrying `usage` is
 * a billing source outside message_end: the estimate becomes null.
 */
const NON_BILLING_ENTRIES = new Set([
  "custom",
  "custom_message",
  "context_edit",
  "label",
  "session_info",
  "thinking_level_change",
  "model_change",
]);
/** Billable outside message_end; disabled by the recorded agent settings (M3-02). */
const BILLABLE = /^(compaction_|summarization_)/;
const SHELL_TOOLS = new Set(["bash", "powershell"]);
const WORK_STOPS = new Set(["stop", "length", "toolUse"]);
const LIMIT_TEXT = /\b(402|429)\b|rate.?limit|insufficient credits|quota/i;

const isObj = (v: unknown): v is R =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): R => (isObj(v) ? v : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const utf8 = new TextEncoder();
const toJson = (v: unknown): Telemetry["raw_usage"] =>
  JSON.parse(JSON.stringify(v));
const lastOf = <T>(xs: Line<T>[]): Line<T> | undefined => xs[xs.length - 1];

interface Agg {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number | null;
  problems: string[];
}

export function parsePiStream(
  text: string,
  input: Omit<ParseInput, "traceOut">,
  streamProblems: string[] = [],
): ParsedRun & { trace: TraceEvent[] } {
  // The file name only: messages reach published records, private paths never do.
  const file = basename(input.rawLog);
  const { lines, nonJson } = readRecords<R>(text);
  if (nonJson.count > 0) {
    streamProblems.push(
      `${nonJsonReason(nonJson)}: ${
        nonJson.first.map((x) => `line ${x.line} (${x.bytes} bytes)`).join(", ")
      }`,
    );
  }
  const of = (t: string) => lines.filter((x) => x.rec["type"] === t);
  const costGaps: string[] = [];
  const unknown = new Map<string, number>();
  for (const { rec } of lines) {
    const t = rec["type"] as string;
    if (!KNOWN_TYPES.has(t)) unknown.set(t, (unknown.get(t) ?? 0) + 1);
  }
  for (const [t, n] of [...unknown].sort(([a], [b]) => a < b ? -1 : 1)) {
    const why = BILLABLE.test(t)
      ? `${t} (${n}): billable work outside message_end`
      : `unknown record type ${t} (possibly billable), ${n} record${
        n === 1 ? "" : "s"
      }`;
    streamProblems.push(why);
    costGaps.push(why);
  }

  only(of("session"), "session", file);
  const session = of("session")[0]?.rec;
  const entry = only(of(ENTRY_RECORD), ENTRY_RECORD, file)?.rec;
  const budgetOf = (event: string) =>
    of("entry_appended").filter((x) => {
      const e = obj(x.rec["entry"]);
      return e["customType"] === BUDGET_ENTRY &&
        obj(e["data"])["event"] === event;
    });
  const armedLine = only(budgetOf("armed"), `${BUDGET_ENTRY} armed`, file);
  const exhausted = only(
    budgetOf("exhausted"),
    `${BUDGET_ENTRY} exhausted`,
    file,
  );
  const armed = armedLine
    ? obj(obj(armedLine.rec["entry"])["data"])
    : undefined;
  const entryGaps = new Map<string, number>();
  for (const { rec } of of("entry_appended")) {
    const e = obj(rec["entry"]);
    const et = str(e["type"]) ?? "(no type)";
    if (NON_BILLING_ENTRIES.has(et) && e["usage"] === undefined) continue;
    const key = et === "usage" ? `usage/${str(e["kind"]) ?? "(no kind)"}` : et;
    entryGaps.set(key, (entryGaps.get(key) ?? 0) + 1);
  }
  for (const [k, n] of [...entryGaps].sort(([a], [b]) => a < b ? -1 : 1)) {
    const why =
      `session entry ${k} (${n}): billing source outside message_end, not in the estimate`;
    streamProblems.push(why);
    costGaps.push(why);
  }
  const settled = of("agent_settled").length > 0;
  const retryStarts = of("auto_retry_start");
  const retryEnds = of("auto_retry_end");
  const lastRetryEnd = lastOf(retryEnds);
  const retryPending =
    (lastOf(retryStarts)?.line ?? 0) > (lastRetryEnd?.line ?? 0);
  const sessionId = str(session?.["id"]);
  const version = /\d+\.\d+\.\d+/.exec(str(entry?.["pi_version"]) ?? "")?.[0] ??
    null;

  const outcomes = new Map<string, { error: boolean; bytes: number }>();
  for (const { rec, line } of of("tool_execution_end")) {
    const id = str(rec["toolCallId"]);
    if (id === null) {
      refuse(`${file}:${line}: tool_execution_end without a toolCallId`);
    }
    if (outcomes.has(id)) {
      refuse(`${file}:${line}: second tool_execution_end for ${id}`);
    }
    const body = list(obj(rec["result"])["content"]).map(obj)
      .filter((c) => c["type"] === "text").map((c) => str(c["text"]) ?? "")
      .join("");
    outcomes.set(id, {
      error: rec["isError"] === true,
      bytes: utf8.encode(body).length,
    });
  }

  const trace: TraceEvent[] = [];
  const ev = (o: Partial<TraceEvent>): TraceEvent => ({
    v: TRACE_VERSION,
    seq: trace.length + 1,
    t_ms: null,
    type: "tool_call",
    session: sessionId,
    agent: "main",
    parent: null,
    call_id: null,
    request_id: null,
    tool: null,
    transport: null,
    skill: null,
    backend_request: null,
    outcome: null,
    error_class: null,
    result_bytes: null,
    truncated: null,
    duration_ms: null,
    model: null,
    // ponytail: v2 call fields left null until M2-15 fills them (callFields).
    command: null,
    command_cut: null,
    target: null,
    category: null,
    classifier: null,
    ...o,
  });
  const started = new Map<string, number>();
  const usage = new Map<string, Agg>();
  let reported: number | null = 0;
  let last: Line<R> | undefined;
  let firstRequestLine: number | null = null;
  // An assistant request that never ended: its usage (and tool calls) may be missing.
  let openRequest: number | null = null;
  const unclosed = (at: number) => {
    const why = `line ${at}: assistant message without message_end`;
    streamProblems.push(why);
    costGaps.push(why);
  };
  let requestId: string | null = null;
  let model: string | null = null;
  let systemSkills: string | null = null;
  let didWork = false;
  for (const l of lines) {
    const { rec, line } = l;
    const t = rec["type"];
    const m = obj(rec["message"]);
    if (
      t === "message_start" && m["role"] === "system" && systemSkills === null
    ) {
      systemSkills = str(obj(m["sections"])["skills"]) ?? "";
    } else if (t === "message_start" && m["role"] === "assistant") {
      firstRequestLine ??= line;
      if (openRequest !== null) unclosed(openRequest);
      openRequest = line;
    } else if (t === "message_end" && m["role"] === "assistant") {
      openRequest = null;
      last = l;
      model = str(m["model"]);
      requestId = str(m["responseId"]);
      const stop = str(m["stopReason"]);
      if (stop !== null && WORK_STOPS.has(stop)) didWork = true;
      if (model === null) {
        // Unattributable usage: never filed under an empty model id.
        const why = `line ${line}: message.model missing, usage not attributed`;
        streamProblems.push(why);
        costGaps.push(why);
        continue;
      }
      const a: Agg = usage.get(model) ?? {
        requests: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: null,
        problems: [],
      };
      usage.set(model, a);
      a.requests++;
      if (m["provider"] !== PI_PROVIDER) {
        a.problems.push(
          `line ${line}: provider ${
            String(m["provider"])
          }, expected ${PI_PROVIDER}`,
        );
      }
      const u = obj(m["usage"]);
      const n = (k: string): number => {
        const v = u[k];
        if (isCount(v)) return v;
        a.problems.push(`line ${line}: usage.${k} missing or not a count`);
        return 0;
      };
      const [i, o, cr, cw, total] = [
        n("input"),
        n("output"),
        n("cacheRead"),
        n("cacheWrite"),
        n("totalTokens"),
      ];
      if (total !== i + o + cr + cw) {
        a.problems.push(
          `line ${line}: totalTokens ${total} != input + output + cacheRead + cacheWrite`,
        );
      }
      a.input += i;
      a.output += o;
      a.cacheRead += cr;
      a.cacheWrite += cw;
      const rz = u["reasoning"];
      if (rz !== undefined) {
        if (isCount(rz)) {
          a.reasoning = (a.reasoning ?? 0) + rz;
          // Per message: a later message's output must not hide unbilled thinking.
          if (rz > o) {
            const why =
              `line ${line}: reasoning tokens (${rz}) exceed output tokens (${o})`;
            streamProblems.push(why);
            a.problems.push(why);
          }
        } else a.problems.push(`line ${line}: usage.reasoning not a count`);
      }
      const c = obj(u["cost"])["total"];
      reported =
        reported !== null && typeof c === "number" && Number.isFinite(c) &&
          c >= 0
          ? reported + c
          : null;
    } else if (t === "tool_execution_start") {
      didWork = true;
      const id = str(rec["toolCallId"]);
      const name = str(rec["toolName"]);
      if (id === null || name === null) {
        refuse(
          `${file}:${line}: tool_execution_start without a string toolCallId and toolName`,
        );
      }
      const seen = started.get(id);
      if (seen !== undefined) {
        refuse(`${file}:${line}: tool call ${id} repeats line ${seen}`);
      }
      started.set(id, line);
      const out = outcomes.get(id);
      trace.push(ev({
        call_id: id,
        request_id: requestId,
        tool: name,
        transport: SHELL_TOOLS.has(name) ? "shell" : "builtin",
        outcome: out ? (out.error ? "error" : "ok") : null,
        result_bytes: out?.bytes ?? null,
        model,
      }));
    } else if (t === "auto_retry_start") {
      trace.push(ev({ type: "retry", request_id: requestId, model }));
    } else if (t === "agent_settled" && openRequest !== null) {
      unclosed(openRequest);
      openRequest = null;
    }
  }
  if (openRequest !== null) unclosed(openRequest);
  for (const id of [...outcomes.keys()].sort()) {
    if (!started.has(id)) {
      streamProblems.push(`tool_execution_end for unknown ${id}`);
    }
  }

  // Cost: pi/OpenRouter cache writes at the 5-minute rate (owner decision pi-cache-ttl).
  const models = [...usage.keys()].sort();
  const tokens: ModelTokens[] = models.map((k) => {
    const a = usage.get(k)!;
    return {
      model: k,
      requests: a.requests,
      input: a.input,
      cache_read: a.cacheRead,
      cache_write_5m: a.cacheWrite,
      cache_write_1h: 0,
      cache_write_unknown: 0,
      output: a.output,
      reasoning: a.reasoning,
      problems: a.problems,
    };
  });
  const written = tokens.reduce((s, x) => s + x.cache_write_5m, 0);
  const assumptions = written > 0
    ? [{
      key: TTL_ASSUMPTION,
      tokens: written,
      decision: "2026-09-25-pi-cache-ttl",
    }]
    : [];
  const priced = estimateCost(tokens, input.pricing);
  const gaps = [
    ...(nonJson.count > 0
      ? [`${nonJsonReason(nonJson)}: a lost line may have been a usage record`]
      : []),
    ...(!settled
      ? [
        "no agent_settled: the run was cut, the last request's usage may be missing",
      ]
      : []),
    ...(retryPending
      ? ["retry without auto_retry_end: a request may be missing"]
      : []),
    ...costGaps,
  ];
  const est = gaps.length > 0
    ? {
      ...priced,
      cost_usd: null,
      pricing_snapshot: null,
      missing: [...gaps, ...priced.missing],
    }
    : priced;

  // Termination (plan M3-01 rules 1 to 7).
  const limit = input.manifest.limits.max_budget_usd;
  const armedOk = armed !== undefined && armed["limit_usd"] === limit &&
    (firstRequestLine === null || armedLine!.line < firstRequestLine);
  if (settled && !armedOk) {
    streamProblems.push(
      armed === undefined
        ? "budget guard not armed (no cg-budget armed entry)"
        : armed["limit_usd"] !== limit
        ? `budget guard limit ${String(armed["limit_usd"])}, manifest ${limit}`
        : "budget guard armed after the first provider request",
    );
  }
  const lastMsg = last ? obj(last.rec["message"]) : null;
  const stop = lastMsg ? str(lastMsg["stopReason"]) : null;
  const retryFailed = lastRetryEnd !== undefined &&
    lastRetryEnd.rec["success"] === false &&
    lastRetryEnd.line > (last?.line ?? 0);
  let failure: string | null = null;
  let completed = false;
  if (retryFailed) failure = str(lastRetryEnd!.rec["finalError"]) ?? "";
  else if (stop === "stop" || stop === "length") completed = true;
  else if (stop === "error" || stop === "aborted") {
    failure = str(lastMsg!["errorMessage"]) ?? "";
  } else {
    if (last !== undefined && stop === null) {
      streamProblems.push(`line ${last.line}: missing stopReason`);
    } else if (stop !== null && stop !== "toolUse") {
      streamProblems.push(`unknown stopReason ${stop}`);
    }
    failure = "";
  }
  let termination: Termination | null;
  if (entry?.["ready"] === false) termination = "setup_failed";
  else if (exhausted !== undefined) termination = "budget_exhausted";
  else if (!settled || retryPending) termination = null;
  else if (!armedOk) termination = "setup_failed";
  else if (completed) termination = "completed";
  else {termination = LIMIT_TEXT.test(failure ?? "")
      ? "usage_limited"
      : "harness_crash";}

  const slugOf = (api: string) =>
    Object.hasOwn(input.pricing.models, api)
      ? input.pricing.models[api]!.slug
      : api;
  const skillNames = new Set(
    [...(systemSkills ?? "").matchAll(/<name>([^<]+)<\/name>/g)].map((x) =>
      x[1]!.trim()
    ),
  );
  const wantSkills = [
    ...new Set(
      (input.manifest.skills?.files ?? []).map((f) => f.path.split("/")[0]!),
    ),
  ];
  const loaded = systemSkills === null ? null : [
    ...(input.manifest.skills && wantSkills.length > 0 &&
        wantSkills.every((s) => skillNames.has(s))
      ? ["skills"]
      : []),
  ];
  const unobservable = requestedComponents(input.manifest).filter((c) =>
    ["instructions", "agents", "hooks"].includes(c) ||
    c.startsWith("plugin:") ||
    c.startsWith("lsp:") || c.startsWith("mcp:") || c.startsWith("toolchain:")
  );
  return {
    telemetry: {
      harness_version: version,
      cost_usd: est.cost_usd,
      cost_source: est.cost_usd !== null ? "estimated" : null,
      pricing_snapshot: est.cost_usd !== null ? est.pricing_snapshot : null,
      // pi's own sum only beside a complete estimate: a gap or any unpriceable
      // request means pi may have billed requests this sum does not cover.
      reported_cost_usd:
        last === undefined || est.cost_usd === null || est.missing.length > 0
          ? null
          : reported,
      per_model: est.per_model,
      turns: settled ? of("turn_end").length : null,
      compactions: null,
      wall_ms: null,
      exit_code: input.exitCode,
      stop_reason: stop,
      refusal_detected: null,
      raw_usage: toJson({
        usage: Object.fromEntries(models.map((k) => [k, usage.get(k)])),
        reported_cost_total: reported,
        budget: exhausted ? obj(obj(exhausted.rec["entry"])["data"]) : null,
        assumptions,
        missing: est.missing,
        stream_problems: streamProblems,
      }),
    },
    observed: {
      harness_version: version,
      models: last === undefined ? null : models.map(slugOf),
      loaded_components: loaded,
    },
    unobservable,
    didWork,
    termination,
    usageResetAt: null,
    imageSupport: null,
    traceEvents: trace.length,
    trace,
  };
}

/** pi agent settings written into the isolated agent directory (recorded in the manifest). */
export const PI_SETTINGS = {
  compaction: { enabled: false },
  cacheWarming: "off",
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2000,
    provider: { maxRetries: 0 },
  },
} as const;
const THINKING = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const piAdapter: HarnessAdapter = {
  harness: "pi",
  declared: [
    "harness_version",
    "cost_usd",
    "reported_cost_usd",
    "per_model",
    "turns",
    "exit_code",
    "stop_reason",
  ],
  secretFiles: ["openrouter-api-key"],
  credentialBearing: true,
  enforcesBudget: true,
  nativeSettings(config, catalog) {
    const c = config.components;
    const unsupported = [
      ...(c.mcp.length > 0 ? ["mcp"] : []),
      ...(c.lsp.length > 0 ? ["lsp"] : []),
      ...(c.agents !== null ? ["agents"] : []),
      ...(c.hooks !== null ? ["hooks"] : []),
      ...(c.plugins.length > 0 ? ["plugins"] : []),
    ];
    if (unsupported.length > 0) {
      throw new ConfigurationError(
        `${config.id}: pi 0.87.1 has no MCP and supports only instructions, skills and toolchain (refused: ${
          unsupported.join(", ")
        })`,
      );
    }
    const slots = Object.keys(config.models);
    if (slots.length !== 1 || slots[0] !== "main") {
      throw new ConfigurationError(
        `${config.id}: pi takes exactly one model slot, main (got ${
          slots.join(", ")
        })`,
      );
    }
    const slug = config.models["main"]!;
    if (!slug.startsWith(`${PI_PROVIDER}/`)) {
      throw new ConfigurationError(
        `${config.id}: pi runs through ${PI_PROVIDER}; ${slug} is not an ${PI_PROVIDER}/ slug`,
      );
    }
    const m = catalog.models.find((x) => x.slug === slug);
    if (!m) {
      throw new ConfigurationError(
        `model ${slug} (slot main) is not in the catalog`,
      );
    }
    for (const k of Object.keys(config.settings)) {
      if (k !== "thinking") {
        throw new ConfigurationError(
          `${config.id}: unknown setting ${k} for pi (known: thinking)`,
        );
      }
    }
    const t = config.settings["thinking"];
    if (t !== undefined && !(typeof t === "string" && THINKING.has(t))) {
      throw new ConfigurationError(
        `${config.id}: thinking must be one of ${[...THINKING].join(", ")}`,
      );
    }
    return {
      ...config.settings,
      provider: PI_PROVIDER,
      api_models: { main: m.api_model_id },
      pi_settings: PI_SETTINGS,
    };
  },
  providerRoutes(config) {
    return Object.fromEntries(
      Object.keys(config.models).map((slot) => [slot, PI_ROUTE]),
    );
  },
  extraMounts: () => Promise.resolve([]),
  async parse(input) {
    let text = "";
    const problems: string[] = [];
    try {
      text = await Deno.readTextFile(input.rawLog);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      problems.push(`${input.rawLog}: raw log missing`);
    }
    const { trace, ...parsed } = parsePiStream(text, input, problems);
    await writeTrace(input.traceOut, trace);
    return parsed;
  },
};
