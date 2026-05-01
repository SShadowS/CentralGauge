import type {
  AppendEventInput,
  LifecycleEnvelope,
  LifecycleEvent,
  ToolVersions,
} from '../../../../src/lifecycle/types';

/**
 * Worker-side `appendEvent` — direct D1 INSERT. Used by the lifecycle POST
 * handler (after signature/CF-Access auth), by Plan C's orchestrator, by
 * Plan D-data's concept-mutation paths, and by Plan F's review-decision
 * handler. Callers always pass *objects* for payload / tool_versions /
 * envelope; this helper stringifies them.
 *
 * Mirrors the CLI-side helper at `src/lifecycle/event-log.ts` (which signs +
 * POSTs to this same endpoint). Both share `AppendEventInput` from
 * `src/lifecycle/types.ts`.
 */
export async function appendEvent(
  db: D1Database,
  input: AppendEventInput,
): Promise<{ id: number }> {
  if (!input.model_slug) throw new Error('appendEvent: model_slug must be non-empty');
  if (!input.task_set_hash) throw new Error('appendEvent: task_set_hash must be non-empty');
  if (!input.event_type) throw new Error('appendEvent: event_type must be non-empty');

  const ts = input.ts ?? Date.now();
  const payload_hash = input.payload_hash ?? await computePayloadHash(input.payload);
  const payload_json = JSON.stringify(input.payload);
  const tool_versions_json = input.tool_versions ? JSON.stringify(input.tool_versions) : null;
  const envelope_json = input.envelope ? JSON.stringify(input.envelope) : null;

  const res = await db.prepare(
    `INSERT INTO lifecycle_events(
       ts, model_slug, task_set_hash, event_type, source_id, payload_hash,
       tool_versions_json, envelope_json, payload_json, actor, actor_id, migration_note
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    ts, input.model_slug, input.task_set_hash, input.event_type,
    input.source_id ?? null, payload_hash,
    tool_versions_json, envelope_json,
    payload_json, input.actor,
    input.actor_id ?? null, input.migration_note ?? null,
  ).run();
  return { id: Number(res.meta?.last_row_id ?? 0) };
}

export interface QueryEventsFilter {
  model_slug: string;
  task_set_hash?: string;
  since?: number;
  /** Match `event_type LIKE '<prefix>%'` — e.g. `'bench.'` or `'analysis.'`. */
  event_type_prefix?: string;
  /** Cap results; oldest-first ordering preserved. */
  limit?: number;
}

export async function queryEvents(
  db: D1Database,
  filter: QueryEventsFilter,
): Promise<LifecycleEvent[]> {
  const params: (string | number)[] = [filter.model_slug];
  let sql = `SELECT id, ts, model_slug, task_set_hash, event_type, source_id, payload_hash,
                    tool_versions_json, envelope_json, payload_json, actor, actor_id, migration_note
               FROM lifecycle_events WHERE model_slug = ?`;
  if (filter.task_set_hash) { sql += ' AND task_set_hash = ?'; params.push(filter.task_set_hash); }
  if (filter.since !== undefined) { sql += ' AND ts >= ?'; params.push(filter.since); }
  if (filter.event_type_prefix) { sql += ' AND event_type LIKE ?'; params.push(`${filter.event_type_prefix}%`); }
  sql += ' ORDER BY ts ASC, id ASC';
  if (filter.limit !== undefined) { sql += ' LIMIT ?'; params.push(filter.limit); }
  const rows = await db.prepare(sql).bind(...params).all<LifecycleEvent>();
  // Populate parsed `payload`/`tool_versions`/`envelope` so consumers don't
  // re-parse JSON at every call site (Plan C lock-token tiebreaker, Plan E
  // diff trigger, Plan H matrix renderer all read these).
  return rows.results.map((r) => ({
    ...r,
    payload: r.payload_json ? JSON.parse(r.payload_json) as Record<string, unknown> : undefined,
    tool_versions: r.tool_versions_json ? JSON.parse(r.tool_versions_json) as ToolVersions : null,
    envelope: r.envelope_json ? JSON.parse(r.envelope_json) as LifecycleEnvelope : null,
  }));
}

async function computePayloadHash(payload: Record<string, unknown>): Promise<string> {
  // Canonical JSON: sort keys recursively for stable hashes.
  const canon = canonicalJSON(payload);
  const bytes = new TextEncoder().encode(canon);
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON((value as Record<string, unknown>)[k])).join(',') + '}';
}
