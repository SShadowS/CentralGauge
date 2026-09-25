/**
 * Claude Code stream-json records to trace v2 events (spec 1a section 5,
 * D14; findings section 4). Pure. Stream order: a model_request at the first
 * record of each assistant message id, a tool_call per tool_use block, plus a
 * subagent_spawn (Agent/Task) or skill_invoke (Skill) marker for the same
 * call. Retry and compaction records are added by M2-12 from recorded shapes.
 */

import type { TraceEvent } from "../trace.ts";
import type { J, Line } from "./jsonl.ts";
import { callFields } from "../call-fields.ts";
import { redactPatternText } from "../redact-patterns.ts";
import { TRACE_VERSION } from "../trace.ts";
import { isObj, list, obj, refuse } from "./jsonl.ts";

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const SPAWN_TOOLS = new Set(["Agent", "Task"]);
const utf8 = new TextEncoder();

export function transportOf(tool: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool);
  if (m) return `mcp:${m[1]}`;
  return SHELL_TOOLS.has(tool) ? "shell" : "builtin";
}

export interface ClaudeTrace {
  events: TraceEvent[];
  problems: string[];
  /** Problems that make the trace incomplete. */
  structural: string[];
  /** Distinct visible assistant message ids per model. */
  requests: Map<string, number>;
  /** Assistant records without a message id (requests unprovable). */
  unidentified: number;
}

const ms = (ts: unknown) => {
  if (typeof ts !== "string") return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
};
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
/** The one place a stored event is redacted: every string field, including any future one. */
function redacted(e: TraceEvent): TraceEvent {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    out[k] = typeof v === "string" ? redactPatternText(v).text : v;
  }
  return out as TraceEvent;
}
const textOf = (c: unknown) =>
  typeof c === "string"
    ? c
    : list(c).map(obj).map((x) => (typeof x.text === "string" ? x.text : ""))
      .join("\n");

/**
 * A whole shell command that is exactly one cg-al invocation: app names,
 * codeunit numbers, quotes, spaces and tabs only (no CR or LF), so no ; && || |
 * redirect, substitution, second line or wrapper shell can put other output in the result.
 */
const SINGLE_CG_AL = /^[ \t]*cg-al([ \t]+[A-Za-z0-9 \t._"'-]*)?$/;
/** Only these calls talk to the backend; any other tool's output is never read as a reply. */
const isBackendCall = (tool: string, rawCommand: string | null) =>
  tool.startsWith("mcp__al-tools__") ||
  (SHELL_TOOLS.has(tool) && rawCommand !== null &&
    SINGLE_CG_AL.test(rawCommand));
/** The backend's request id shape (backend.ts `br_<n>`); anything else is not stored. */
const REQUEST_ID = /^br_[0-9]{1,18}$/;

/**
 * The cg-al client line {op, client:{status}, result} or the al-tools MCP
 * reply {op, status, result}: the whole text as one JSON value, else the last
 * line that is one (earlier lines may be echoed output).
 */
function backendReply(
  text: string,
): { op: string; status: number | null; result: J } | null {
  for (const l of [text, ...text.split(/\r?\n/).reverse()]) {
    const s = l.trim();
    if (!s.startsWith("{")) continue;
    try {
      const v = JSON.parse(s);
      if (isObj(v) && typeof v.op === "string") {
        const st = isObj(v.client) ? v.client.status : v.status;
        return {
          op: v.op,
          status: typeof st === "number" ? st : null,
          result: obj(v.result),
        };
      }
    } catch {
      // not the reply line
    }
  }
  return null;
}

function errorClass(
  outcome: TraceEvent["outcome"],
  text: string,
  reply: ReturnType<typeof backendReply>,
): string | null {
  if (outcome === "denied") return "denied";
  if (outcome !== "error") return null;
  if (reply !== null) {
    const rows = list(reply.result.tests).map(obj);
    const failedApps = list(reply.result.apps).map(obj).filter((a) =>
      a.ok === false && list(a.diagnostics).length > 0
    );
    const st = reply.status;
    if (
      reply.result.infra !== undefined || st === 0 || st === 401 ||
      (st !== null && st >= 500) || rows.some((r) => r.failure === "infra")
    ) return "infra";
    if (st === 400) return "tool_protocol";
    if (failedApps.length > 0) return "compile_diagnostics";
    if (rows.some((r) => r.failure === "assertion")) return "test_assertion";
    return null;
  }
  return text.trimStart().startsWith("<tool_use_error>")
    ? "tool_protocol"
    : null;
}

const BASE = {
  session: null,
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
  command: null,
  command_cut: null,
  target: null,
  category: null,
  classifier: null,
} as const;

export function claudeTrace(
  lines: Line<J>[],
  file: string,
  denied: ReadonlySet<string>,
): ClaudeTrace {
  const problems: string[] = [];
  const structural: string[] = [];
  const events: TraceEvent[] = [];
  const push = (e: Omit<TraceEvent, "v" | "seq">) =>
    events.push(redacted({ v: TRACE_VERSION, seq: events.length + 1, ...e }));
  const t0 = lines.map((l) => ms(l.rec.timestamp)).find((t) => t !== null) ??
    null;
  const rel = (
    t: number | null,
  ) => (t === null || t0 === null ? null : Math.max(0, t - t0));
  const hasFinal = lines.some((l) => l.rec.type === "result");

  const results = new Map<
    string,
    { error: boolean; bytes: number; text: string; at: number | null }
  >();
  for (const { rec, line } of lines) {
    if (rec.type !== "user") continue;
    for (const c of list(obj(rec.message).content).map(obj)) {
      if (c.type !== "tool_result") continue;
      const id = c.tool_use_id;
      if (typeof id !== "string") {
        refuse(`${file}:${line}: tool_result without a tool_use_id`);
      }
      if (results.has(id)) refuse(`${file}:${line}: second result for ${id}`);
      const body = typeof c.content === "string"
        ? c.content
        : JSON.stringify(c.content ?? "");
      results.set(id, {
        error: c.is_error === true,
        bytes: utf8.encode(body).length,
        text: textOf(c.content),
        at: ms(rec.timestamp),
      });
    }
  }

  const spawned = new Map<string, string>();
  const orphans = new Set<string>();
  const seenMsg = new Set<string>();
  const callLine = new Map<string, number>();
  const requests = new Map<string, number>();
  let unidentified = 0;
  for (const { rec, line } of lines) {
    if (rec.type !== "assistant") continue;
    const parent = typeof rec.parent_tool_use_id === "string"
      ? rec.parent_tool_use_id
      : null;
    let agent = "main";
    if (parent !== null) {
      const a = spawned.get(parent);
      if (a === undefined && !orphans.has(parent)) {
        orphans.add(parent);
        structural.push(
          `${file}:${line}: parent_tool_use_id ${parent} has no earlier Agent call`,
        );
      }
      agent = a ?? "subagent";
    }
    const session = str(rec.session_id);
    const at = ms(rec.timestamp);
    const msg = obj(rec.message);
    const model = str(msg.model);
    const requestId = str(msg.id);
    if (requestId === null || model === null) {
      unidentified++;
      structural.push(
        `${file}:${line}: assistant record without a message id or model`,
      );
    } else if (!seenMsg.has(requestId)) {
      seenMsg.add(requestId);
      requests.set(model, (requests.get(model) ?? 0) + 1);
      push({
        ...BASE,
        type: "model_request",
        t_ms: rel(at),
        session,
        agent,
        parent,
        request_id: requestId,
        model,
      });
    }
    for (const c of list(msg.content).map(obj)) {
      if (c.type !== "tool_use") continue;
      if (typeof c.id !== "string" || typeof c.name !== "string") {
        refuse(`${file}:${line}: tool_use without a string id and name`);
      }
      const id = c.id;
      const name = c.name;
      const seen = callLine.get(id);
      if (seen !== undefined) {
        refuse(`${file}:${line}: tool_use id ${id} repeats line ${seen}`);
      }
      callLine.set(id, line);
      const input = obj(c.input);
      const rawCmd = SHELL_TOOLS.has(name) && typeof input.command === "string"
        ? input.command
        : null;
      const target = [input.file_path, input.notebook_path, input.path].map(str)
        .find((v) => v !== null) ?? null;
      const r = results.get(id);
      const outcome: TraceEvent["outcome"] = denied.has(id)
        ? "denied"
        : r
        ? (r.error ? "error" : "ok")
        : null;
      const fields = callFields(name, rawCmd, target);
      const reply = r && isBackendCall(name, rawCmd)
        ? backendReply(r.text)
        : null;
      const skill = name === "Skill" ? str(input.skill) : null;
      const common = {
        t_ms: rel(at),
        session,
        agent,
        parent,
        call_id: id,
        request_id: requestId,
        tool: name,
        transport: transportOf(name),
        model,
      };
      push({
        ...BASE,
        ...common,
        type: "tool_call",
        skill,
        backend_request: reply && typeof reply.result.request === "string" &&
            REQUEST_ID.test(reply.result.request)
          ? reply.result.request
          : null,
        outcome,
        error_class: errorClass(outcome, r?.text ?? "", reply),
        result_bytes: r?.bytes ?? null,
        duration_ms: r && r.at !== null && at !== null && r.at >= at
          ? r.at - at
          : null,
        ...fields,
      });
      if (SPAWN_TOOLS.has(name)) {
        spawned.set(id, str(input.subagent_type) ?? "subagent");
        push({ ...BASE, ...common, type: "subagent_spawn" });
      }
      if (name === "Skill") {
        push({
          ...BASE,
          ...common,
          type: "skill_invoke",
          skill,
        });
      }
    }
  }
  for (const id of [...results.keys()].sort()) {
    if (!callLine.has(id)) structural.push(`tool_result for unknown ${id}`);
  }
  if (hasFinal) {
    for (const id of [...callLine.keys()].sort()) {
      if (!results.has(id) && !denied.has(id)) {
        structural.push(`tool_use ${id} has no result`);
      }
    }
  }
  return { events, problems, structural, requests, unidentified };
}
