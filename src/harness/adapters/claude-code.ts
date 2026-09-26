/**
 * Claude Code adapter, minimal (pulled forward from M2 for the 10-05 gate).
 * Parses stream-json (findings section 4): the run is judged from the final
 * `result` record, never the exit code; cost from result.modelUsage per model
 * (repeated assistant chunks are never summed); tool calls from assistant
 * tool_use blocks, errors from tool_result.is_error. Non-JSON lines never
 * discard the attempt: they are counted (no content stored). Contradictory
 * records (a second result or init, a reused tool id) are refused with the
 * file and line; anything unexpected but harmless is listed in
 * raw_usage.stream_problems. A same-session resume (M1-32b) is one
 * system/init and one result per segment, all with one session id: turns and
 * duration are summed, cost is the last result's cumulative modelUsage once
 * proven cumulative (else null, with the reason).
 */

import { basename } from "@std/path";
import type { HarnessAdapter, ParsedRun, ParseInput } from "../adapter.ts";
import type { ModelTokens } from "../pricing.ts";
import type { Telemetry, Termination } from "../records.ts";
import type { TraceEvent } from "../trace.ts";
import { ConfigurationError, ValidationError } from "../../errors.ts";
import { requestedComponents } from "../adapter.ts";
import { estimateCost } from "../pricing.ts";
import { writeTrace } from "../trace.ts";

/** Stream-json record: the keys this parser reads are declared (noPropertyAccessFromIndexSignature). */
interface J {
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
}
interface Line {
  rec: J;
  line: number;
}

const KNOWN_TYPES = new Set([
  "system",
  "assistant",
  "user",
  "result",
  "rate_limit_event",
]);

const isObj = (v: unknown): v is J =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): J => (isObj(v) ? v : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
/** Lower bound only (raw_usage.partial): never feeds the cost. */
const num = (v: unknown): number => (isCount(v) ? v : 0);
/** A required usage field: missing or non-numeric is recorded, never treated as zero. */
const req = (x: J, k: string, problems: string[]): number => {
  const v = x[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  problems.push(`${k} missing or not a number`);
  return 0;
};
const utf8 = new TextEncoder();

/** A JSON round trip: the value is JSON by construction, whatever the log held. */
const toJson = (v: unknown): Telemetry["raw_usage"] =>
  JSON.parse(JSON.stringify(v));

function refuse(msg: string): never {
  throw new ValidationError(msg, [msg]);
}

function transportOf(tool: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool);
  if (m) return `mcp:${m[1]}`;
  return tool === "Bash" || tool === "PowerShell" ? "shell" : "builtin";
}

/**
 * Non-JSON stdout is evidence only: a count, the first few line numbers and
 * their byte lengths. No content is stored, since even a prefix can carry part
 * of a secret; the full log stays in quarantine.
 */
const NON_JSON_SHOWN = 3;
interface NonJson {
  count: number;
  first: { line: number; bytes: number }[];
}

/**
 * One JSON object with a string `type` per line. A leading BOM, CRLF and
 * blank lines are accepted. Any other line (a stray warning, a corrupt or
 * truncated record, a non-object) never throws the attempt away: it is
 * counted, and the first few are named by line number and byte length.
 */
function readRecords(text: string): { lines: Line[]; nonJson: NonJson } {
  const raw = (text.startsWith("\uFEFF") ? text.slice(1) : text).split(
    /\r?\n/,
  );
  const lines: Line[] = [];
  const nonJson: NonJson = { count: 0, first: [] };
  for (const [i, l] of raw.entries()) {
    if (l.trim() === "") continue;
    let v: unknown;
    try {
      v = JSON.parse(l);
    } catch {
      v = undefined;
    }
    if (isObj(v) && typeof v.type === "string") {
      lines.push({ rec: v, line: i + 1 });
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
function nonJsonReason(n: NonJson): string {
  return `${n.count} non-JSON stdout line${n.count === 1 ? "" : "s"} (${
    n.first.map((x) => `line ${x.line}`).join(", ")
  }${n.count > n.first.length ? ", ..." : ""})`;
}

const linesOf = (recs: Line[]) => `lines ${recs.map((r) => r.line).join(", ")}`;

/** The sum of a per-segment result field; null when absent or not a number in any result. */
function sumOf(results: Line[], k: "num_turns" | "duration_ms"): number | null {
  if (results.length === 0) return null;
  let n = 0;
  for (const { rec } of results) {
    const v = rec[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    n += v;
  }
  return n;
}

const CUMULATIVE = [
  "inputTokens",
  "outputTokens",
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
] as const;

/**
 * Several results (a same-session resume): 2.1.282 repeats the session's
 * cumulative modelUsage and total_cost_usd in every result, so the last one
 * is the run (M1-32b fixture proof in claude-code.test.ts). Returns why that
 * is not proven for this log, or null. Proven: totals never fall from one
 * result to the next, and the last modelUsage covers the input and cache
 * tokens of every assistant message in every segment, which a per-segment
 * figure cannot. Output is not checked: message chunks carry a partial count.
 */
function notCumulative(
  results: Line[],
  perMessage: Map<string, { model: string; usage: J }>,
): string | null {
  for (const [i, b] of results.entries()) {
    if (typeof b.rec.total_cost_usd !== "number") {
      return `line ${b.line}: total_cost_usd missing`;
    }
    const a = results[i - 1];
    if (!a) continue;
    if (b.rec.total_cost_usd < (a.rec.total_cost_usd as number)) {
      return `total_cost_usd falls from line ${a.line} to line ${b.line}`;
    }
    const am = obj(a.rec.modelUsage);
    const bm = obj(b.rec.modelUsage);
    for (const m of Object.keys(am).sort()) {
      for (const k of CUMULATIVE) {
        const x = obj(am[m])[k];
        const y = obj(bm[m])[k];
        if (!isCount(x) || !isCount(y) || y < x) {
          return `${m} ${k} falls or is missing from line ${a.line} to line ${b.line}`;
        }
      }
    }
  }
  const seen = new Map<string, Record<(typeof CUMULATIVE)[number], number>>();
  for (const { model, usage: u } of perMessage.values()) {
    const s = seen.get(model) ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
    s.inputTokens += num(u.input_tokens);
    s.cacheReadInputTokens += num(u.cache_read_input_tokens);
    s.cacheCreationInputTokens += num(u.cache_creation_input_tokens);
    seen.set(model, s);
  }
  const last = obj(results.at(-1)!.rec.modelUsage);
  for (const [m, s] of [...seen].sort(([a], [b]) => a < b ? -1 : 1)) {
    for (const k of CUMULATIVE) {
      if (k === "outputTokens") continue;
      const x = obj(last[m])[k];
      if (!isCount(x) || x < s[k]) {
        return `last modelUsage ${m || "(no model)"} ${k} ${
          isCount(x) ? x : "missing"
        } is below the ${s[k]} its assistant messages report`;
      }
    }
  }
  return null;
}

/**
 * Noise may follow the last result: rate_limit_event and system records other
 * than init (M1-29: background_tasks_changed, task_updated,
 * task_notification after both results).
 */
const isNoise = (r: J) =>
  r.type === "rate_limit_event" ||
  (r.type === "system" && r.subtype !== "init");
const SESSION_BOUND = new Set(["assistant", "user", "result"]);
const SHOWN = 3;

/**
 * Provenance and placement (M1-32b run 002). The cost is proven only when
 * there are as many results as inits, none before the first init, nothing but
 * noise after the last result, and every assistant, user and result record
 * carries the inits' session_id. Segment 1's result may come after init 2
 * (M1-29: inits at lines 1 and 113, results at 144 and 145). `trace` lists
 * the provenance failures: the trace holds records not proven to be the run's.
 */
function provenanceAndPlacement(
  file: string,
  lines: Line[],
  inits: Line[],
  results: Line[],
): { costs: string[]; trace: string[] } {
  const costs: string[] = [];
  if (results.length !== inits.length) {
    costs.push(
      `${file}: ${inits.length} system/init records but ${results.length} result record${
        results.length === 1 ? "" : "s"
      }${results.length > 0 ? ` (${linesOf(results)})` : ""}`,
    );
  }
  const first = inits[0];
  const early = results.find((r) => !first || r.line < first.line);
  if (early && first) {
    costs.push(
      `${file}: result at line ${early.line} before the first system/init (line ${first.line})`,
    );
  }
  const last = results.at(-1);
  const late = last &&
    lines.find((x) => x.line > last.line && !isNoise(x.rec));
  if (late) {
    costs.push(
      `${file}: ${late.rec.type} at line ${late.line} after the last result (line ${last.line})`,
    );
  }
  const sid = first?.rec.session_id;
  const bad: string[] = [];
  for (const { rec, line } of lines) {
    if (!SESSION_BOUND.has(rec.type as string)) continue;
    if (typeof rec.session_id !== "string") {
      bad.push(`line ${line}: ${rec.type} without session_id`);
    } else if (typeof sid === "string" && rec.session_id !== sid) {
      bad.push(`line ${line}: ${rec.type} from another session`);
    }
  }
  if (first && typeof sid !== "string") {
    bad.unshift(`line ${first.line}: system/init without session_id`);
  }
  const trace = bad.length === 0 ? [] : [
    `${file}: session provenance: ${bad.slice(0, SHOWN).join(", ")}${
      bad.length > SHOWN ? `, ${bad.length - SHOWN} more` : ""
    }`,
  ];
  return { costs: [...costs, ...trace], trace };
}

export function parseClaudeStream(
  text: string,
  input: Omit<ParseInput, "traceOut">,
  /** Problems found before parsing (a missing log); reported first. */
  streamProblems: string[] = [],
): ParsedRun & { trace: TraceEvent[] } {
  // The file name only: messages reach published records, private paths never do.
  const file = basename(input.rawLog);
  const { lines, nonJson } = readRecords(text);
  if (nonJson.count > 0) {
    streamProblems.push(
      `${nonJsonReason(nonJson)}: ${
        nonJson.first.map((x) => `line ${x.line} (${x.bytes} bytes)`)
          .join(", ")
      }`,
    );
  }
  const of = (t: string) => lines.filter((x) => x.rec.type === t);

  const unknown = new Map<string, number>();
  for (const { rec } of lines) {
    const t = rec.type as string;
    if (!KNOWN_TYPES.has(t)) unknown.set(t, (unknown.get(t) ?? 0) + 1);
  }
  for (const [t, n] of [...unknown].sort(([a], [b]) => a < b ? -1 : 1)) {
    streamProblems.push(`unknown record type ${t} (${n})`);
  }

  // A same-session resume (M1-32b: a background task wakes the session) adds
  // one system/init and one result per segment; another session is refused.
  const inits = of("system").filter((x) => x.rec.subtype === "init");
  const allResults = of("result");
  if (inits.length > 1) {
    const sid = inits[0]!.rec.session_id;
    if (
      typeof sid !== "string" || inits.some((x) => x.rec.session_id !== sid)
    ) {
      refuse(
        `${file}: ${inits.length} system/init records (${
          linesOf(inits)
        }) without one shared session id`,
      );
    }
  }
  if (allResults.length > Math.max(inits.length, 1)) {
    refuse(
      `${file}: ${allResults.length} result records (${linesOf(allResults)})`,
    );
  }
  for (const { rec, line } of allResults) {
    if (typeof rec.is_error !== "boolean" || typeof rec.subtype !== "string") {
      refuse(
        `${file}:${line}: result record needs a boolean is_error and a string subtype`,
      );
    }
  }
  // A resumed run missing a segment's result has no final result (a hard kill).
  const short = inits.length > 1 && allResults.length < inits.length;
  const results = short ? [] : allResults;
  if (short) {
    streamProblems.push(
      `${file}: ${inits.length} system/init records but ${allResults.length} result record${
        allResults.length === 1 ? "" : "s"
      }${allResults.length > 0 ? ` (${linesOf(allResults)})` : ""}`,
    );
  }
  const unproven = provenanceAndPlacement(file, lines, inits, allResults);
  const init = inits[0]?.rec;
  const result = results.at(-1)?.rec;
  const version = typeof init?.claude_code_version === "string"
    ? init.claude_code_version
    : null;

  // Tool outcomes, one per tool_use id.
  const outcomes = new Map<string, { error: boolean; bytes: number }>();
  for (const { rec, line } of of("user")) {
    for (const c of list(obj(rec.message).content).map(obj)) {
      if (c.type !== "tool_result") continue;
      const id = c.tool_use_id;
      if (typeof id !== "string") {
        refuse(`${file}:${line}: tool_result without a tool_use_id`);
      }
      if (outcomes.has(id)) refuse(`${file}:${line}: second result for ${id}`);
      const body = typeof c.content === "string"
        ? c.content
        : JSON.stringify(c.content ?? "");
      outcomes.set(id, {
        error: c.is_error === true,
        bytes: utf8.encode(body).length,
      });
    }
  }

  // Tool calls: one tool_use block per call (the stream repeats a message
  // once per content block, each record carrying a different block).
  const trace: TraceEvent[] = [];
  const callLine = new Map<string, number>();
  const perMessage = new Map<string, { model: string; usage: J }>();
  let didWork = false;
  for (const { rec, line } of of("assistant")) {
    didWork = true;
    const msg = obj(rec.message);
    const model = typeof msg.model === "string" ? msg.model : "";
    if (typeof msg.id === "string") {
      perMessage.set(msg.id, { model, usage: obj(msg.usage) });
    }
    for (const c of list(msg.content).map(obj)) {
      if (c.type !== "tool_use") continue;
      if (typeof c.id !== "string" || typeof c.name !== "string") {
        refuse(`${file}:${line}: tool_use without a string id and name`);
      }
      const id = c.id;
      const seen = callLine.get(id);
      if (seen !== undefined) {
        refuse(`${file}:${line}: tool_use id ${id} repeats line ${seen}`);
      }
      callLine.set(id, line);
      const out = outcomes.get(id);
      const parent = typeof rec.parent_tool_use_id === "string"
        ? rec.parent_tool_use_id
        : null;
      trace.push({
        v: 1,
        seq: trace.length + 1,
        t_ms: null,
        type: "tool_call",
        session: typeof rec.session_id === "string" ? rec.session_id : null,
        agent: parent ? "subagent" : "main",
        parent,
        call_id: id,
        request_id: typeof msg.id === "string" ? msg.id : null,
        tool: c.name,
        transport: transportOf(c.name),
        skill: null,
        backend_request: null,
        outcome: out ? (out.error ? "error" : "ok") : null,
        error_class: null,
        result_bytes: out?.bytes ?? null,
        truncated: null,
        duration_ms: null,
        model: model || null,
      });
    }
  }
  for (const id of [...outcomes.keys()].sort()) {
    if (!callLine.has(id)) streamProblems.push(`tool_result for unknown ${id}`);
  }

  // TTL splits: assistant messages (deduplicated by id) plus sub-agent
  // tool_use_result usage, per model. A split that is absent leaves the sum
  // short; one that is present but not a count spoils the model's split.
  const models = Object.keys(obj(result?.modelUsage)).sort();
  const split = new Map<string, { m5: number; h1: number; bad: boolean }>();
  const addSplit = (model: string, u: J) => {
    const cc = obj(u.cache_creation);
    const a = cc.ephemeral_5m_input_tokens;
    const b = cc.ephemeral_1h_input_tokens;
    if (a === undefined && b === undefined) return;
    const e = split.get(model) ?? { m5: 0, h1: 0, bad: false };
    if (isCount(a) && isCount(b)) {
      e.m5 += a;
      e.h1 += b;
    } else e.bad = true;
    split.set(model, e);
  };
  for (const { model, usage: u } of perMessage.values()) addSplit(model, u);
  for (const { rec, line } of of("user")) {
    const tr = obj(rec.tool_use_result);
    const tu = obj(tr.usage);
    if (Object.keys(tu).length === 0) continue;
    // The sub-agent's model is `resolvedModel` (M0-04 fixture; `model` is null there).
    const model = typeof tr.resolvedModel === "string"
      ? tr.resolvedModel
      : models.length === 1
      ? models[0]!
      : null;
    if (model !== null && models.includes(model)) addSplit(model, tu);
    else {
      streamProblems.push(
        `line ${line}: sub-agent usage for ${
          model ?? "no model"
        } outside modelUsage`,
      );
      for (const m of models) {
        split.set(m, { ...(split.get(m) ?? { m5: 0, h1: 0 }), bad: true });
      }
    }
  }

  // Usage: result.modelUsage is authoritative (includes sub-agents).
  const usage: ModelTokens[] = models.map((model) => {
    const x = obj(obj(result?.modelUsage)[model]);
    const problems: string[] = [];
    const writes = req(x, "cacheCreationInputTokens", problems);
    const s = split.get(model);
    const exact = s !== undefined && !s.bad && s.m5 + s.h1 === writes;
    if (s !== undefined && !exact) {
      problems.push(
        s.bad
          ? "cache write split mismatch (a TTL split is not a count)"
          : `cache write split mismatch (${s.m5} + ${s.h1} != ${writes})`,
      );
    }
    let reasoning: number | null = null;
    if (typeof x.thinkingTokens === "number") reasoning = x.thinkingTokens;
    else if (x.thinkingTokens !== undefined) {
      problems.push("thinkingTokens not a number");
    }
    return {
      model,
      requests: null,
      input: req(x, "inputTokens", problems),
      cache_read: req(x, "cacheReadInputTokens", problems),
      cache_write_5m: exact ? s.m5 : 0,
      cache_write_1h: exact ? s.h1 : 0,
      cache_write_unknown: exact ? 0 : writes,
      output: req(x, "outputTokens", problems),
      reasoning,
      problems,
    };
  });
  const why = results.length > 1 ? notCumulative(results, perMessage) : null;
  if (why !== null) {
    unproven.costs.push(
      `${file}: ${results.length} result records (${
        linesOf(results)
      }): modelUsage not provably cumulative (${why})`,
    );
  }
  const proven = unproven.costs.length === 0;
  const priced = result ? estimateCost(usage, input.pricing) : null;
  // A lost line may have been a second result or a usage record the TTL
  // check needed, so the cost is not provable: null, with the lines named.
  const est = !proven
    ? {
      cost_usd: null,
      pricing_snapshot: null,
      per_model: [],
      missing: [
        ...(nonJson.count > 0 ? [nonJsonReason(nonJson)] : []),
        ...unproven.costs,
        ...(priced?.missing ?? []),
      ],
    }
    : priced && nonJson.count > 0
    ? {
      ...priced,
      cost_usd: null,
      pricing_snapshot: null,
      missing: [
        `${nonJsonReason(nonJson)}: the result record may not cover the run`,
        ...priced.missing,
      ],
    }
    : priced;
  const partial: Record<string, ModelTokens> = {};
  for (const { model, usage: u } of perMessage.values()) {
    const p = partial[model] ??= {
      model,
      requests: 0,
      input: 0,
      cache_read: 0,
      cache_write_5m: 0,
      cache_write_1h: 0,
      cache_write_unknown: 0,
      output: 0,
      reasoning: null,
      problems: [],
    };
    p.requests = (p.requests ?? 0) + 1;
    p.input += num(u.input_tokens);
    p.cache_read += num(u.cache_read_input_tokens);
    p.cache_write_unknown += num(u.cache_creation_input_tokens);
    p.output += num(u.output_tokens);
  }

  // Usage limits: concurrent limits combine to the latest reset.
  const rejected = of("rate_limit_event").filter((x) =>
    obj(x.rec.rate_limit_info).status === "rejected"
  );
  let resetSec: number | null = null;
  for (const { rec, line } of rejected) {
    const at = obj(rec.rate_limit_info).resetsAt;
    if (typeof at !== "number" || !Number.isFinite(at)) {
      streamProblems.push(`line ${line}: rejected limit without resetsAt`);
    } else resetSec = Math.max(resetSec ?? at, at);
  }
  const stop = typeof result?.stop_reason === "string"
    ? result.stop_reason
    : null;
  const limited = rejected.length > 0 || result?.api_error_status === 429;
  let termination: Termination | null;
  if (!result) termination = limited ? "usage_limited" : null;
  else if (result.is_error === true && limited) termination = "usage_limited";
  else if (stop === "refusal") termination = "refusal";
  else if (result.subtype === "error_max_budget_usd") {
    termination = "budget_exhausted";
  } else if (result.is_error === true) termination = "harness_crash";
  else termination = "completed";

  const slugOf = (api: string) =>
    Object.hasOwn(input.pricing.models, api)
      ? input.pricing.models[api]!.slug
      : api;
  const skillNames = new Set(list(init?.skills).map(String));
  const wantSkills = [
    ...new Set(
      (input.manifest.skills?.files ?? []).map((f) => f.path.split("/")[0]!),
    ),
  ];
  const connected = list(init?.mcp_servers).map(obj)
    .filter((s) => s.status === "connected").map((s) => `mcp:${s.name}`);
  const loaded = init
    ? [
      ...(input.manifest.skills && wantSkills.length > 0 &&
          wantSkills.every((s) => skillNames.has(s))
        ? ["skills"]
        : []),
      ...connected,
    ]
    : null;
  const unobservable = requestedComponents(input.manifest).filter((c) =>
    ["instructions", "agents", "hooks"].includes(c) ||
    c.startsWith("plugin:") || c.startsWith("lsp:") ||
    c.startsWith("toolchain:")
  );
  return {
    telemetry: {
      harness_version: version,
      cost_usd: est?.cost_usd ?? null,
      cost_source: est?.cost_usd != null ? "estimated" : null,
      pricing_snapshot: est?.cost_usd != null ? est.pricing_snapshot : null,
      reported_cost_usd: proven && typeof result?.total_cost_usd === "number"
        ? result.total_cost_usd
        : null,
      per_model: est?.per_model ?? [],
      // Per segment in 2.1.282 (fixture proof: 13 then 7): summed.
      turns: sumOf(results, "num_turns"),
      compactions: null,
      wall_ms: sumOf(results, "duration_ms"),
      exit_code: input.exitCode,
      stop_reason: stop,
      refusal_detected: result ? stop === "refusal" : null,
      raw_usage: toJson({
        usage: result?.usage ?? null,
        modelUsage: result?.modelUsage ?? null,
        ...(results.length > 1
          ? {
            results: results.map(({ rec, line }) => ({
              line,
              num_turns: rec.num_turns ?? null,
              duration_ms: rec.duration_ms ?? null,
              total_cost_usd: rec.total_cost_usd ?? null,
              usage: rec.usage ?? null,
            })),
          }
          : {}),
        partial,
        missing: est?.missing ??
          (nonJson.count > 0 ? [nonJsonReason(nonJson)] : []),
        stream_problems: streamProblems,
        ...(unproven.trace.length > 0
          ? { trace_incomplete: unproven.trace }
          : {}),
      }),
    },
    observed: {
      harness_version: version,
      models: result ? models.map(slugOf) : null,
      loaded_components: loaded,
    },
    unobservable,
    didWork,
    termination,
    usageResetAt: termination === "usage_limited" && resetSec !== null
      ? new Date(resetSec * 1000).toISOString()
      : null,
    imageSupport: null,
    traceEvents: trace.length,
    trace,
  };
}

/**
 * Session-control and cross-session tools a benchmark cell has no use for
 * (M1-32b), sorted: those of ScheduleWakeup, ListAgents, SendMessage, Monitor,
 * CronCreate, CronDelete and RemoteTrigger that 2.1.282's system/init lists
 * (Monitor is not listed). Background Task/Agent use stays allowed. Passed as
 * --disallowedTools by run.ps1 and recorded in settings.native, so they are
 * identity inputs.
 */
const DISALLOWED_TOOLS = [
  "CronCreate",
  "CronDelete",
  "ListAgents",
  "RemoteTrigger",
  "ScheduleWakeup",
  "SendMessage",
] as const;

export const claudeCodeAdapter: HarnessAdapter = {
  harness: "claude-code",
  declared: [
    "harness_version",
    "cost_usd",
    "reported_cost_usd",
    "per_model",
    "turns",
    "wall_ms",
    "exit_code",
    "stop_reason",
  ],
  secretFiles: ["claude-oauth-token"],
  credentialBearing: true,
  enforcesBudget: true,
  nativeSettings(config, catalog) {
    if (Object.hasOwn(config.settings, "disallowed_tools")) {
      throw new ConfigurationError(
        `${config.id}: settings.disallowed_tools is set by the claude-code adapter`,
      );
    }
    const api_models: Record<string, string> = {};
    for (const [slot, slug] of Object.entries(config.models)) {
      const m = catalog.models.find((x) => x.slug === slug);
      if (!m) {
        throw new ConfigurationError(
          `model ${slug} (slot ${slot}) is not in the catalog`,
        );
      }
      api_models[slot] = m.api_model_id;
    }
    return {
      ...config.settings,
      api_models,
      disallowed_tools: [...DISALLOWED_TOOLS],
    };
  },
  providerRoutes(config) {
    return Object.fromEntries(
      Object.keys(config.models).map((
        slot,
      ) => [slot, "anthropic:first-party-oauth"]),
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
      problems.push(`${basename(input.rawLog)}: raw log missing`);
    }
    const { trace, ...parsed } = parseClaudeStream(text, input, problems);
    await writeTrace(input.traceOut, trace);
    return parsed;
  },
};
