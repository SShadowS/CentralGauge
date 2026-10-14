/**
 * H-10 spike: Claude Code OpenTelemetry usage capture. The sandboxed claude
 * exports OTLP/HTTP logs (http/json) to the backend's /v1/logs; only the
 * `api_request` events are kept, reduced to an allow-list of usage fields, so
 * no prompt or tool content is ever stored even if a content switch flips.
 */

export const OTEL_MAX_BODY_BYTES = 4 * 1024 * 1024;

/** One API request as Claude Code reported it (one line of otel.jsonl). */
export interface OtelApiRequest {
  session_id: string | null;
  prompt_id: string | null;
  sequence: number | null;
  timestamp: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  /** H-10: the TTL split of cache_creation_tokens (priced per TTL). */
  cache_creation_5m_tokens: number;
  cache_creation_1h_tokens: number;
  cost_usd: number | null;
  request_id: string | null;
  query_source: string | null;
  agent_name: string | null;
  execution_id: string | null;
}

type Attrs = Record<string, unknown>;

/** OTLP JSON AnyValue to a plain value (int64 may arrive as a string). */
function value(v: unknown): unknown {
  if (v === null || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if ("stringValue" in o) return o["stringValue"];
  if ("intValue" in o) {
    const n = Number(o["intValue"]);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  if ("doubleValue" in o) return Number(o["doubleValue"]);
  if ("boolValue" in o) return o["boolValue"];
  return undefined;
}

function attrs(list: unknown): Attrs {
  const out: Attrs = {};
  if (!Array.isArray(list)) return out;
  for (const kv of list) {
    if (kv && typeof kv === "object" && typeof kv.key === "string") {
      out[kv.key] = value(kv.value);
    }
  }
  return out;
}

const str = (v: unknown) => typeof v === "string" ? v : null;
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const count = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

/**
 * The api_request events of one ExportLogsServiceRequest. A malformed body
 * throws; an api_request missing its model or a token count throws too, so a
 * partial record never reads as zero usage.
 */
export function apiRequests(body: unknown): OtelApiRequest[] {
  if (!body || typeof body !== "object") throw new Error("not an object");
  const rl = (body as Record<string, unknown>)["resourceLogs"];
  if (!Array.isArray(rl)) throw new Error("resourceLogs missing");
  const out: OtelApiRequest[] = [];
  for (const r of rl) {
    const res = attrs(r?.resource?.attributes);
    for (const s of Array.isArray(r?.scopeLogs) ? r.scopeLogs : []) {
      for (const rec of Array.isArray(s?.logRecords) ? s.logRecords : []) {
        const a = { ...res, ...attrs(rec?.attributes) };
        if (a["event.name"] !== "api_request") continue;
        const model = str(a["model"]);
        const t = {
          input_tokens: count(a["input_tokens"]),
          output_tokens: count(a["output_tokens"]),
          cache_read_tokens: count(a["cache_read_tokens"]),
          cache_creation_tokens: count(a["cache_creation_tokens"]),
          cache_creation_5m_tokens: count(a["cache_creation_5m_tokens"]),
          cache_creation_1h_tokens: count(a["cache_creation_1h_tokens"]),
        };
        if (model === null || Object.values(t).some((v) => v === null)) {
          throw new Error("api_request without model or token counts");
        }
        out.push({
          session_id: str(a["session.id"]),
          prompt_id: str(a["prompt.id"]),
          sequence: count(a["event.sequence"]),
          timestamp: str(a["event.timestamp"]),
          model,
          ...(t as Record<keyof typeof t, number>),
          cost_usd: num(a["cost_usd"]),
          request_id: str(a["request_id"]),
          query_source: str(a["query_source"]),
          agent_name: str(a["agent.name"]),
          execution_id: str(a["cg.execution_id"]),
        });
      }
    }
  }
  return out;
}
