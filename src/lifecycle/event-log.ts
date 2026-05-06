import * as ed from "npm:@noble/ed25519@3.1.0";
import { encodeBase64 } from "jsr:@std/encoding@^1.0.5/base64";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { canonicalJSON } from "../ingest/canonical.ts";
import { cfAccessHeaders } from "../ingest/cf-access-headers.ts";
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
  // Wire body matches the canonical `AppendEventInput` shape — the worker's
  // POST handler (`site/src/routes/api/v1/admin/lifecycle/events/+server.ts`)
  // expects OBJECT-form `payload`/`tool_versions`/`envelope` and stringifies
  // them server-side. Pre-stringified `*_json` strings are rejected with
  // a D1 type error because `JSON.stringify(undefined) === undefined`.
  return {
    version: 1,
    payload: {
      ts,
      model_slug: input.model_slug,
      task_set_hash: input.task_set_hash,
      event_type: input.event_type,
      source_id: input.source_id ?? null,
      payload_hash,
      payload: input.payload,
      tool_versions: input.tool_versions ?? null,
      envelope: input.envelope ?? null,
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
 * Test-only swappable backend for `appendEvent` / `queryEvents`. Plan C's
 * orchestrator integration tests inject an in-memory store via
 * `setEventStore` to assert the EVENT SEQUENCE without round-tripping the
 * worker's signed-admin endpoints. Production code MUST NOT call
 * `setEventStore`; the shim is exported only for the integration suite
 * under `tests/integration/lifecycle/`.
 */
export interface EventStoreBackend {
  appendEvent: (
    e: AppendEventInput,
    opts: AppendOptions,
  ) => Promise<{ id: number }>;
  queryEvents: (
    filter: QueryEventsFilter,
    opts: AppendOptions,
  ) => Promise<LifecycleEvent[]>;
}

let backend: EventStoreBackend | null = null;

/** Test-only. Reset to default by calling `setEventStore(null)` (cast). */
export function setEventStore(b: EventStoreBackend | null): void {
  backend = b;
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
  if (backend) return backend.appendEvent(input, opts);
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
    cfAccessHeaders(),
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
/**
 * Sign a lifecycle-admin GET/PUT request — matches the canonical scheme in
 * `site/src/lib/server/lifecycle-auth.ts`. Body-hash binding closes the
 * pre-fix C1 attack where a captured signed envelope could be replayed
 * against a different URL or with arbitrary body bytes.
 */
export async function signLifecycleHeaders(
  privateKey: Uint8Array,
  keyId: number,
  args: {
    method: "GET" | "PUT";
    path: string;
    query?: Record<string, string | number | null | undefined>;
    body?: Uint8Array;
    now?: Date;
  },
): Promise<Record<string, string>> {
  const signedAt = (args.now ?? new Date()).toISOString();
  let body_sha256 = "";
  if (args.body) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      args.body as BufferSource,
    );
    body_sha256 = encodeHex(new Uint8Array(digest));
  }
  const q: Record<string, string> = {};
  if (args.query) {
    for (const [k, v] of Object.entries(args.query)) {
      if (v === null || v === undefined) continue;
      q[k] = String(v);
    }
  }
  const canonical = canonicalJSON({
    method: args.method,
    path: args.path,
    query: q,
    body_sha256,
    signed_at: signedAt,
  });
  const sig = await ed.signAsync(
    new TextEncoder().encode(canonical),
    privateKey,
  );
  return {
    "X-CG-Signature": encodeBase64(sig),
    "X-CG-Key-Id": String(keyId),
    "X-CG-Signed-At": signedAt,
  };
}

export async function queryEvents(
  filter: QueryEventsFilter,
  opts: AppendOptions,
): Promise<LifecycleEvent[]> {
  if (backend) return backend.queryEvents(filter, opts);
  const params = new URLSearchParams({ model: filter.model_slug });
  if (filter.task_set_hash) params.set("task_set", filter.task_set_hash);
  if (filter.since !== undefined) params.set("since", String(filter.since));
  if (filter.event_type_prefix) {
    params.set("event_type_prefix", filter.event_type_prefix);
  }
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  // Sign-by-headers — canonical bytes bind URL params + path so a captured
  // envelope can't be replayed for a different (model, task_set) pair.
  const path = "/api/v1/admin/lifecycle/events";
  const headers = await signLifecycleHeaders(opts.privateKey, opts.keyId, {
    method: "GET",
    path,
    query: {
      model: filter.model_slug,
      task_set: filter.task_set_hash,
      since: filter.since,
      event_type_prefix: filter.event_type_prefix,
      limit: filter.limit,
    },
  });
  const resp = await fetch(
    `${opts.url}${path}?${params}`,
    { method: "GET", headers: { ...headers, ...cfAccessHeaders() } },
  );
  if (!resp.ok) throw new Error(`queryEvents failed (${resp.status})`);
  // Detect CF Access edge interception: the request escaped the worker and
  // hit the OAuth login page. Without this guard the next `resp.json()` blows
  // up with `Unexpected token '<', "<!DOCTYPE "...` and the operator has to
  // dig through a stack trace to find the actual cause.
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const sample = (await resp.text()).slice(0, 200);
    throw new Error(
      `queryEvents got non-JSON response (content-type=${contentType}). ` +
        `Likely CF Access service token missing — set CF_ACCESS_CLIENT_ID + ` +
        `CF_ACCESS_CLIENT_SECRET. Body sample: ${sample}`,
    );
  }
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
