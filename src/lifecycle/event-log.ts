import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { canonicalJSON } from "../ingest/canonical.ts";
import { signPayload } from "../ingest/sign.ts";
import { postWithRetry } from "../ingest/client.ts";
import type {
  AppendEventInput,
  CurrentStateMap,
  LifecycleEnvelope,
  LifecycleEvent,
  LifecycleStep,
  ToolVersions,
} from "./types.ts";

/**
 * SHA-256 of canonical(payload) — identifies idempotent events.
 */
export async function computePayloadHash(
  payload: Record<string, unknown>,
): Promise<string> {
  const canon = canonicalJSON(payload);
  const bytes = new TextEncoder().encode(canon);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return encodeHex(new Uint8Array(digest));
}

/**
 * Build the signed-request body shape expected by
 * `POST /api/v1/admin/lifecycle/events`. Same envelope shape as the catalog
 * admin endpoints (see site/src/lib/server/signature.ts SignedAdminRequest).
 *
 * Callers pass `AppendEventInput` with object payload / tool_versions /
 * envelope; this helper stringifies them into the wire shape. The matching
 * worker-side helper (`site/src/lib/server/lifecycle-event-log.ts`)
 * stringifies the same objects directly to D1 columns. Identical contract,
 * different transport.
 */
export async function buildAppendBody(
  input: AppendEventInput,
): Promise<{ version: 1; payload: Record<string, unknown> }> {
  if (!input.model_slug) throw new Error("model_slug must be non-empty");
  if (!input.task_set_hash) throw new Error("task_set_hash must be non-empty");
  if (!input.event_type) throw new Error("event_type must be non-empty");

  const ts = input.ts ?? Date.now();
  const payload_hash = input.payload_hash ??
    await computePayloadHash(input.payload);
  return {
    version: 1,
    payload: {
      ts,
      model_slug: input.model_slug,
      task_set_hash: input.task_set_hash,
      event_type: input.event_type,
      source_id: input.source_id ?? null,
      payload_hash,
      tool_versions_json: input.tool_versions
        ? JSON.stringify(input.tool_versions)
        : null,
      envelope_json: input.envelope ? JSON.stringify(input.envelope) : null,
      payload_json: JSON.stringify(input.payload),
      actor: input.actor,
      actor_id: input.actor_id ?? null,
      migration_note: input.migration_note ?? null,
    },
  };
}

/**
 * Reduce a flat list of events into the most-recent event per step. Step is
 * derived from the event_type prefix matching v_lifecycle_state's CASE.
 * ts ties broken by id (highest wins) — matches the view's MAX(id) tiebreaker.
 */
export function reduceCurrentState(events: LifecycleEvent[]): CurrentStateMap {
  const out: CurrentStateMap = {};
  for (const ev of events) {
    const step = stepFor(ev.event_type);
    if (!step) continue;
    const cur = out[step];
    if (
      !cur ||
      ev.ts > cur.ts ||
      (ev.ts === cur.ts && (ev.id ?? 0) > (cur.id ?? 0))
    ) {
      out[step] = ev;
    }
  }
  return out;
}

function stepFor(eventType: string): LifecycleStep | null {
  if (eventType.startsWith("bench.")) return "bench";
  if (eventType.startsWith("debug.")) return "debug";
  if (eventType.startsWith("analysis.")) return "analyze";
  if (eventType.startsWith("publish.")) return "publish";
  if (eventType.startsWith("cycle.")) return "cycle";
  return null;
}

export interface AppendOptions {
  url: string;
  privateKey: Uint8Array;
  keyId: number;
}

/**
 * POST a lifecycle event via the signed admin endpoint. Used by every CLI
 * command (verify, populate-shortcomings, cycle) that emits lifecycle events.
 * The worker code path skips this and writes D1 directly.
 */
export async function appendEvent(
  input: AppendEventInput,
  opts: AppendOptions,
): Promise<{ id: number }> {
  const body = await buildAppendBody(input);
  const signature = await signPayload(
    body.payload,
    opts.privateKey,
    opts.keyId,
  );
  const resp = await postWithRetry(
    `${opts.url}/api/v1/admin/lifecycle/events`,
    { ...body, signature },
    { maxAttempts: 3 },
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`appendEvent failed (${resp.status}): ${text}`);
  }
  return await resp.json() as { id: number };
}

export interface QueryEventsFilter {
  model_slug: string;
  task_set_hash?: string;
  since?: number;
  /** Match `event_type LIKE '<prefix>%'` — e.g. `'bench.'` or `'analysis.'`. Plan C uses this. */
  event_type_prefix?: string;
  /** Cap results; oldest-first ordering preserved. Plan C uses this. */
  limit?: number;
}

/**
 * Query events for a (model, task_set) pair. Mirrors the worker's
 * `GET /api/v1/admin/lifecycle/events`. The matching worker-side helper
 * accepts the same filter shape; only the first arg differs (D1Database vs.
 * AppendOptions).
 */
export async function queryEvents(
  filter: QueryEventsFilter,
  opts: AppendOptions,
): Promise<LifecycleEvent[]> {
  const params = new URLSearchParams({ model: filter.model_slug });
  if (filter.task_set_hash) params.set("task_set", filter.task_set_hash);
  if (filter.since !== undefined) params.set("since", String(filter.since));
  if (filter.event_type_prefix) {
    params.set("event_type_prefix", filter.event_type_prefix);
  }
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  // Read endpoint accepts a signed empty payload + the query params for filtering.
  const body = { version: 1 as const, payload: { model: filter.model_slug } };
  const signature = await signPayload(
    body.payload,
    opts.privateKey,
    opts.keyId,
  );
  const resp = await fetch(
    `${opts.url}/api/v1/admin/lifecycle/events?${params}`,
    {
      method: "GET",
      headers: {
        "X-CG-Signature": signature.value,
        "X-CG-Key-Id": String(signature.key_id),
        "X-CG-Signed-At": signature.signed_at,
      },
    },
  );
  if (!resp.ok) throw new Error(`queryEvents failed (${resp.status})`);
  const raw = await resp.json() as LifecycleEvent[];
  // Symmetric with worker-side: populate parsed fields so CLI consumers
  // (Plan C orchestrator, Plan H status renderer) read `e.payload.field`
  // directly. The worker JSON serializes `payload_json` as a string; CLI
  // must parse here.
  return raw.map((r) => {
    const out: LifecycleEvent = {
      ...r,
      tool_versions: r.tool_versions_json
        ? JSON.parse(r.tool_versions_json) as ToolVersions
        : null,
      envelope: r.envelope_json
        ? JSON.parse(r.envelope_json) as LifecycleEnvelope
        : null,
    };
    if (r.payload_json) {
      out.payload = JSON.parse(r.payload_json) as Record<string, unknown>;
    }
    return out;
  });
}

export async function currentState(
  modelSlug: string,
  taskSetHash: string,
  opts: AppendOptions,
): Promise<CurrentStateMap> {
  const events = await queryEvents(
    { model_slug: modelSlug, task_set_hash: taskSetHash },
    opts,
  );
  return reduceCurrentState(events);
}
