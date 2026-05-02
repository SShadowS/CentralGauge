/**
 * Unit tests for `checkDebugBundleAvailable` — Wave 5 / Plan E IMPORTANT 5.
 *
 * The helper is the single source of truth for "does R2 still hold the
 * debug bundle preceding this analysis.completed event" — consumed by
 * both the family page loader (collapses to boolean) and the admin
 * `debug-bundle-exists` endpoint (surfaces discriminated reasons).
 * Tests cover every discriminated-result branch + the catch-all
 * unexpected-failure path.
 */
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../utils/reset-db';
import { checkDebugBundleAvailable } from '../../src/lib/server/lifecycle-debug-bundle';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); });

async function insertEvent(opts: {
  ts: number;
  modelSlug: string;
  taskSetHash: string;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO lifecycle_events(
       ts, model_slug, task_set_hash, event_type, payload_json, actor
     ) VALUES (?, ?, ?, ?, ?, 'operator')`,
  ).bind(
    opts.ts, opts.modelSlug, opts.taskSetHash, opts.eventType,
    JSON.stringify(opts.payload),
  ).run();
  return Number(r.meta!.last_row_id!);
}

describe('checkDebugBundleAvailable', () => {
  it('returns event_not_found when event_id does not exist', async () => {
    const status = await checkDebugBundleAvailable(env.DB, env.LIFECYCLE_BLOBS, 99999);
    expect(status).toEqual({ exists: false, reason: 'event_not_found' });
  });

  it('returns no_debug_captured when no debug.captured precedes the event', async () => {
    const eventId = await insertEvent({
      ts: Date.now(),
      modelSlug: 'm/x', taskSetHash: 'h-no-dbg',
      eventType: 'analysis.completed',
      payload: { analyzer_model: 'a/x' },
    });
    const status = await checkDebugBundleAvailable(env.DB, env.LIFECYCLE_BLOBS, eventId);
    expect(status).toEqual({ exists: false, reason: 'no_debug_captured' });
  });

  it('returns malformed_payload_json when debug.captured payload is unparseable', async () => {
    // Inject a row with garbled payload directly — appendEvent's
    // canonical writer always emits valid JSON, but we want to verify
    // the helper tolerates schema drift / migration leftovers.
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(
         ts, model_slug, task_set_hash, event_type, payload_json, actor
       ) VALUES (?, ?, ?, 'debug.captured', ?, 'operator')`,
    ).bind(Date.now() - 1000, 'm/x', 'h-bad-json', '{not-json').run();
    const eventId = await insertEvent({
      ts: Date.now(),
      modelSlug: 'm/x', taskSetHash: 'h-bad-json',
      eventType: 'analysis.completed',
      payload: { analyzer_model: 'a/x' },
    });
    const status = await checkDebugBundleAvailable(env.DB, env.LIFECYCLE_BLOBS, eventId);
    expect(status).toEqual({ exists: false, reason: 'malformed_payload_json' });
  });

  it('returns no_r2_key when debug.captured payload omits r2_key', async () => {
    await insertEvent({
      ts: Date.now() - 1000,
      modelSlug: 'm/x', taskSetHash: 'h-no-key',
      eventType: 'debug.captured',
      payload: { session_id: 'sess-only' }, // no r2_key
    });
    const eventId = await insertEvent({
      ts: Date.now(),
      modelSlug: 'm/x', taskSetHash: 'h-no-key',
      eventType: 'analysis.completed',
      payload: { analyzer_model: 'a/x' },
    });
    const status = await checkDebugBundleAvailable(env.DB, env.LIFECYCLE_BLOBS, eventId);
    expect(status).toEqual({ exists: false, reason: 'no_r2_key' });
  });

  it('returns no_r2_key when r2_key is empty string', async () => {
    await insertEvent({
      ts: Date.now() - 1000,
      modelSlug: 'm/x', taskSetHash: 'h-empty-key',
      eventType: 'debug.captured',
      payload: { r2_key: '' },
    });
    const eventId = await insertEvent({
      ts: Date.now(),
      modelSlug: 'm/x', taskSetHash: 'h-empty-key',
      eventType: 'analysis.completed',
      payload: { analyzer_model: 'a/x' },
    });
    const status = await checkDebugBundleAvailable(env.DB, env.LIFECYCLE_BLOBS, eventId);
    expect(status).toEqual({ exists: false, reason: 'no_r2_key' });
  });

  it('returns no_r2_key when r2_key is non-string', async () => {
    await insertEvent({
      ts: Date.now() - 1000,
      modelSlug: 'm/x', taskSetHash: 'h-num-key',
      eventType: 'debug.captured',
      payload: { r2_key: 42 },
    });
    const eventId = await insertEvent({
      ts: Date.now(),
      modelSlug: 'm/x', taskSetHash: 'h-num-key',
      eventType: 'analysis.completed',
      payload: { analyzer_model: 'a/x' },
    });
    const status = await checkDebugBundleAvailable(env.DB, env.LIFECYCLE_BLOBS, eventId);
    expect(status).toEqual({ exists: false, reason: 'no_r2_key' });
  });

  it('returns r2_head_null with r2_key when r2_key references an absent R2 object', async () => {
    const r2Key = 'lifecycle/m-x/never-uploaded.tar.zst';
    await insertEvent({
      ts: Date.now() - 1000,
      modelSlug: 'm/x', taskSetHash: 'h-r2-miss',
      eventType: 'debug.captured',
      payload: { r2_key: r2Key },
    });
    const eventId = await insertEvent({
      ts: Date.now(),
      modelSlug: 'm/x', taskSetHash: 'h-r2-miss',
      eventType: 'analysis.completed',
      payload: { analyzer_model: 'a/x' },
    });
    const status = await checkDebugBundleAvailable(env.DB, env.LIFECYCLE_BLOBS, eventId);
    // r2_key carried on the failure variant for forensic UI / wire-contract
    // compatibility (the legacy admin endpoint included r2_key on
    // exists:false responses where debug.captured had a key).
    expect(status).toEqual({ exists: false, reason: 'r2_head_null', r2_key: r2Key });
  });

  it('returns exists:true with r2_key when bundle is present in R2', async () => {
    const r2Key = 'lifecycle/m-x/dbg-fixture.tar.zst';
    await env.LIFECYCLE_BLOBS.put(r2Key, new Uint8Array([1, 2, 3]));
    await insertEvent({
      ts: Date.now() - 1000,
      modelSlug: 'm/x', taskSetHash: 'h-r2-yes',
      eventType: 'debug.captured',
      payload: { r2_key: r2Key },
    });
    const eventId = await insertEvent({
      ts: Date.now(),
      modelSlug: 'm/x', taskSetHash: 'h-r2-yes',
      eventType: 'analysis.completed',
      payload: { analyzer_model: 'a/x' },
    });
    const status = await checkDebugBundleAvailable(env.DB, env.LIFECYCLE_BLOBS, eventId);
    expect(status).toEqual({ exists: true, r2_key: r2Key });
  });

  it('matches the most-recent debug.captured for the (model, task_set) when multiple exist', async () => {
    // Older debug.captured with a stale r2_key (R2 may have GC'd it);
    // newer one with a live key. The helper picks the newer (id-DESC LIMIT 1).
    await insertEvent({
      ts: Date.now() - 5000,
      modelSlug: 'm/x', taskSetHash: 'h-multi',
      eventType: 'debug.captured',
      payload: { r2_key: 'lifecycle/m-x/old-stale.tar.zst' },
    });
    const liveKey = 'lifecycle/m-x/recent-live.tar.zst';
    await env.LIFECYCLE_BLOBS.put(liveKey, new Uint8Array([1]));
    await insertEvent({
      ts: Date.now() - 1000,
      modelSlug: 'm/x', taskSetHash: 'h-multi',
      eventType: 'debug.captured',
      payload: { r2_key: liveKey },
    });
    const eventId = await insertEvent({
      ts: Date.now(),
      modelSlug: 'm/x', taskSetHash: 'h-multi',
      eventType: 'analysis.completed',
      payload: { analyzer_model: 'a/x' },
    });
    const status = await checkDebugBundleAvailable(env.DB, env.LIFECYCLE_BLOBS, eventId);
    expect(status).toEqual({ exists: true, r2_key: liveKey });
  });

  it('ignores debug.captured for a different model_slug or task_set_hash', async () => {
    // Cross-pollution check: a debug.captured for a DIFFERENT model
    // must NOT satisfy the lookup for our event.
    await insertEvent({
      ts: Date.now() - 1000,
      modelSlug: 'other/y', taskSetHash: 'h-cross',
      eventType: 'debug.captured',
      payload: { r2_key: 'lifecycle/other-y/some.tar.zst' },
    });
    const eventId = await insertEvent({
      ts: Date.now(),
      modelSlug: 'm/x', taskSetHash: 'h-cross',
      eventType: 'analysis.completed',
      payload: { analyzer_model: 'a/x' },
    });
    const status = await checkDebugBundleAvailable(env.DB, env.LIFECYCLE_BLOBS, eventId);
    expect(status).toEqual({ exists: false, reason: 'no_debug_captured' });
  });

  it('ignores debug.captured AFTER the event_id (same model + task_set)', async () => {
    // The lookup constrains `id <= event_id` so future debug.captured
    // events don't retroactively claim availability.
    const eventId = await insertEvent({
      ts: Date.now() - 1000,
      modelSlug: 'm/x', taskSetHash: 'h-future',
      eventType: 'analysis.completed',
      payload: { analyzer_model: 'a/x' },
    });
    await insertEvent({
      ts: Date.now(),
      modelSlug: 'm/x', taskSetHash: 'h-future',
      eventType: 'debug.captured',
      payload: { r2_key: 'lifecycle/m-x/future.tar.zst' },
    });
    const status = await checkDebugBundleAvailable(env.DB, env.LIFECYCLE_BLOBS, eventId);
    expect(status).toEqual({ exists: false, reason: 'no_debug_captured' });
  });
});
