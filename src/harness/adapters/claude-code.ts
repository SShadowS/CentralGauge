/**
 * Claude Code adapter, minimal (pulled forward from M2 for the 10-05 gate).
 * Parses stream-json (findings section 4): the run is judged from the final
 * `result` record, never the exit code; cost from result.modelUsage per model
 * (repeated assistant chunks are never summed); tool calls from assistant
 * tool_use blocks, errors from tool_result.is_error. Non-JSON lines never
 * discard the attempt: they are counted (no content stored). Contradictory
 * records (a second result or init, a reused tool id) are refused with the
 * file and line; anything unexpected but harmless is listed in
 * raw_usage.stream_problems.
 */

import type { HarnessAdapter, ParsedRun, ParseInput } from "../adapter.ts";
import type { ModelTokens } from "../pricing.ts";
import type { Telemetry, Termination } from "../records.ts";
import type { TraceEvent } from "../trace.ts";
import { ConfigurationError } from "../../errors.ts";
import { requestedComponents } from "../adapter.ts";
import { estimateCost } from "../pricing.ts";
import { writeTrace } from "../trace.ts";
import type { J } from "./jsonl.ts";
import { claudeTrace } from "./claude-trace.ts";
import {
  list,
  nonJsonReason,
  obj,
  only,
  readRecords,
  refuse,
} from "./jsonl.ts";

const KNOWN_TYPES = new Set([
  "system",
  "assistant",
  "user",
  "result",
  "rate_limit_event",
]);

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

/** A JSON round trip: the value is JSON by construction, whatever the log held. */
const toJson = (v: unknown): Telemetry["raw_usage"] =>
  JSON.parse(JSON.stringify(v));

export function parseClaudeStream(
  text: string,
  input: Omit<ParseInput, "traceOut">,
  /** Problems found before parsing (a missing log); reported first. */
  streamProblems: string[] = [],
): ParsedRun & { trace: TraceEvent[] } {
  const file = input.rawLog;
  const { lines, nonJson } = readRecords<J>(text);
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

  const init = only(
    of("system").filter((x) => x.rec.subtype === "init"),
    "system/init",
    file,
  )?.rec;
  const resultLine = only(of("result"), "result", file);
  const result = resultLine?.rec;
  if (
    resultLine &&
    (typeof result?.is_error !== "boolean" ||
      typeof result?.subtype !== "string")
  ) {
    refuse(
      `${file}:${resultLine.line}: result record needs a boolean is_error and a string subtype`,
    );
  }
  const version = typeof init?.claude_code_version === "string"
    ? init.claude_code_version
    : null;

  // Per message id, for the TTL split and the partial usage (the stream
  // repeats a message once per content block).
  const perMessage = new Map<string, { model: string; usage: J }>();
  let didWork = false;
  for (const { rec } of of("assistant")) {
    didWork = true;
    const msg = obj(rec.message);
    const model = typeof msg.model === "string" ? msg.model : "";
    if (typeof msg.id === "string") {
      perMessage.set(msg.id, { model, usage: obj(msg.usage) });
    }
  }

  const denied = new Set(
    list(result?.permission_denials).map(obj).map((d) => d.tool_use_id)
      .filter((x): x is string => typeof x === "string"),
  );
  const built = claudeTrace(lines, file, denied);
  streamProblems.push(...built.problems, ...built.structural);
  const trace = built.events;

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
  const priced = result ? estimateCost(usage, input.pricing) : null;
  // A lost line may have been a second result or a usage record the TTL
  // check needed, so the cost is not provable: null, with the lines named.
  const est = priced && nonJson.count > 0
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
      reported_cost_usd: typeof result?.total_cost_usd === "number"
        ? result.total_cost_usd
        : null,
      per_model: est?.per_model ?? [],
      turns: typeof result?.num_turns === "number" ? result.num_turns : null,
      compactions: null,
      wall_ms: typeof result?.duration_ms === "number"
        ? result.duration_ms
        : null,
      exit_code: input.exitCode,
      stop_reason: stop,
      refusal_detected: result ? stop === "refusal" : null,
      raw_usage: toJson({
        usage: result?.usage ?? null,
        modelUsage: result?.modelUsage ?? null,
        partial,
        missing: est?.missing ??
          (nonJson.count > 0 ? [nonJsonReason(nonJson)] : []),
        stream_problems: streamProblems,
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
    return { ...config.settings, api_models };
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
      problems.push(`${input.rawLog}: raw log missing`);
    }
    const { trace, ...parsed } = parseClaudeStream(text, input, problems);
    await writeTrace(input.traceOut, trace);
    return parsed;
  },
};
