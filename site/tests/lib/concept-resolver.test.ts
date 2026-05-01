import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { resolveConcept } from '../../src/lib/server/concept-resolver';
import { appendEvent } from '../../src/lib/server/lifecycle-event-log';
import { resetDb } from '../utils/reset-db';
import type { AppendEventInput } from '../../../src/lifecycle/types';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
});

/**
 * Real appendEvent bound to env.DB. The resolver back-patches
 * `concepts.provenance_event_id` REFERENCES lifecycle_events(id) — the FK
 * is enforced by D1, so a no-op fake returning a fabricated id violates
 * the FK constraint. Using the real helper keeps the schema honest.
 */
const realAppend = (input: AppendEventInput) => appendEvent(env.DB, input);

describe('resolveConcept', () => {
  it('aliases an existing concept (action=aliased) when existing_match + sim ≥ 0.85', async () => {
    await env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (1, 'flowfield-calcfields', 'FlowField', 'flowfield', 'd', 1000, 2000)`,
    ).run();
    const res = await resolveConcept(
      env.DB,
      {
        proposed_slug: 'flowfield-calc',
        existing_match: 'flowfield-calcfields',
        similarity_score: 0.91,
        display_name: 'FlowField',
        al_concept: 'flowfield',
        description: 'd',
        correct_pattern: 'p',
        analyzer_model: 'claude-opus-4-6',
      },
      3000,
      realAppend,
      'anthropic/claude-opus-4-6',
      'ts-1',
    );
    expect(res.action).toBe('aliased');
    expect(res.concept_id).toBe(1);
    expect(typeof res.emitted_event_id).toBe('number');
    // Alias row inserted with alias_event_id = the captured event id.
    const alias = await env.DB
      .prepare(
        `SELECT alias_event_id FROM concept_aliases WHERE alias_slug = ?`,
      )
      .bind('flowfield-calc')
      .first<{ alias_event_id: number }>();
    expect(alias?.alias_event_id).toBe(res.emitted_event_id);
  });

  it('returns pending when similarity in review band [0.70, 0.85)', async () => {
    const res = await resolveConcept(
      env.DB,
      {
        proposed_slug: 'flowfield-calc',
        existing_match: null,
        similarity_score: 0.78,
        display_name: 'x',
        al_concept: 'y',
        description: 'z',
        correct_pattern: 'p',
        analyzer_model: 'm',
      },
      3000,
      realAppend,
      'm',
      't',
    );
    expect(res.action).toBe('pending');
    expect(res.concept_id).toBeNull();
    expect(res.emitted_event_id).toBeNull();
  });

  it('creates a new concept when similarity < 0.70', async () => {
    const res = await resolveConcept(
      env.DB,
      {
        proposed_slug: 'fresh-concept',
        existing_match: null,
        similarity_score: 0.42,
        display_name: 'Fresh',
        al_concept: 'misc',
        description: 'd',
        correct_pattern: 'p',
        analyzer_model: 'm',
      },
      3000,
      realAppend,
      'm',
      't',
    );
    expect(res.action).toBe('created');
    expect(res.concept_id).toBeGreaterThan(0);
    const row = await env.DB
      .prepare(`SELECT slug, provenance_event_id FROM concepts WHERE id = ?`)
      .bind(res.concept_id!)
      .first<{ slug: string; provenance_event_id: number | null }>();
    expect(row?.slug).toBe('fresh-concept');
    // provenance_event_id is back-patched to the captured concept.created event id.
    expect(row?.provenance_event_id).toBe(res.emitted_event_id);
  });

  it('concept.created payload carries concept_id (per strategic appendix)', async () => {
    const res = await resolveConcept(
      env.DB,
      {
        proposed_slug: 'fresh-with-id',
        existing_match: null,
        similarity_score: 0.3,
        display_name: 'X',
        al_concept: 'a',
        description: 'd',
        correct_pattern: 'p',
        analyzer_model: 'claude-opus-4-6',
      },
      3000,
      realAppend,
      'm',
      't',
    );
    expect(res.action).toBe('created');
    // Verify the persisted concept.created event payload via D1 directly —
    // payload_json is the canonical wire shape (helper serializes internally).
    const ev = await env.DB
      .prepare(
        `SELECT event_type, payload_json FROM lifecycle_events WHERE id = ?`,
      )
      .bind(res.emitted_event_id!)
      .first<{ event_type: string; payload_json: string }>();
    expect(ev?.event_type).toBe('concept.created');
    const payload = JSON.parse(ev!.payload_json) as Record<string, unknown>;
    expect(payload.concept_id).toBe(res.concept_id);
    expect(payload.slug).toBe('fresh-with-id');
    expect(payload.analyzer_model).toBe('claude-opus-4-6');
  });

  it('creates when similarity is null (no analyzer match attempt)', async () => {
    const res = await resolveConcept(
      env.DB,
      {
        proposed_slug: 'never-seen',
        existing_match: null,
        similarity_score: null,
        display_name: 'N',
        al_concept: 'a',
        description: 'd',
        correct_pattern: 'p',
        analyzer_model: 'm',
      },
      3000,
      realAppend,
      'm',
      't',
    );
    expect(res.action).toBe('created');
  });

  it('falls through to create when existing_match slug is not in the registry', async () => {
    // Analyzer claimed a match but the slug doesn't exist — resolver MUST
    // NOT trust the LLM's claim; it falls through to auto-create.
    const res = await resolveConcept(
      env.DB,
      {
        proposed_slug: 'analyzer-hallucinated',
        existing_match: 'nonexistent-slug',
        similarity_score: 0.95,
        display_name: 'X',
        al_concept: 'a',
        description: 'd',
        correct_pattern: 'p',
        analyzer_model: 'm',
      },
      3000,
      realAppend,
      'm',
      't',
    );
    expect(res.action).toBe('created');
  });
});
