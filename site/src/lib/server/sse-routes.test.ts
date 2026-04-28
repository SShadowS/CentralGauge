import { describe, it, expect } from 'vitest';
import { eventToRoutes, routePatternMatches } from './sse-routes';
import type { BroadcastEvent } from '../../do/leaderboard-broadcaster';

describe('eventToRoutes', () => {
  it('maps run_finalized to leaderboard, runs, run-detail, model-detail, family-detail', () => {
    const ev: BroadcastEvent = {
      type: 'run_finalized',
      ts: '2026-04-29T00:00:00Z',
      run_id: 'r-001',
      model_slug: 'sonnet-4-7',
      family_slug: 'claude',
    };
    const routes = eventToRoutes(ev);
    expect(routes).toContain('/');
    expect(routes).toContain('/runs');
    expect(routes).toContain('/runs/r-001');
    expect(routes).toContain('/models/sonnet-4-7');
    expect(routes).toContain('/families/claude');
  });

  it('maps task_set_promoted to leaderboard, models/*', () => {
    // /tasks is intentionally NOT in this list — the spec's §8.5
    // subscriber list does not include /tasks, so fanning out to
    // /tasks would be dead noise at the DO. If /tasks ever
    // subscribes (future plan), add it back here.
    const ev: BroadcastEvent = { type: 'task_set_promoted', ts: '2026-04-29T00:00:00Z' };
    const routes = eventToRoutes(ev);
    expect(routes).toContain('/');
    expect(routes).toContain('/models/*');
    expect(routes).not.toContain('/tasks');
  });

  it('maps shortcoming_added to limitations and the affected model detail page', () => {
    const ev: BroadcastEvent = {
      type: 'shortcoming_added',
      ts: '2026-04-29T00:00:00Z',
      model_slug: 'haiku-3-5',
    };
    const routes = eventToRoutes(ev);
    expect(routes).toContain('/limitations');
    expect(routes).toContain('/models/haiku-3-5');
  });

  it('maps ping to wildcard (all subscribers)', () => {
    const ev: BroadcastEvent = { type: 'ping', ts: '2026-04-29T00:00:00Z' };
    const routes = eventToRoutes(ev);
    expect(routes).toEqual(['*']);
  });

  it('returns empty array when payload is missing required fields', () => {
    // run_finalized without run_id / model_slug — defensively, do not match anything
    const bad: BroadcastEvent = { type: 'run_finalized', ts: '2026-04-29T00:00:00Z' };
    expect(eventToRoutes(bad)).toEqual([]);
  });
});

describe('routePatternMatches', () => {
  it('matches when subscriber listed the literal event route', () => {
    expect(routePatternMatches(['/'], ['/'])).toBe(true);
    expect(routePatternMatches(['/runs/r-001'], ['/runs/r-001'])).toBe(true);
  });

  it('matches when subscriber listed a wildcard the event satisfies', () => {
    expect(routePatternMatches(['/models/sonnet-4-7'], ['/models/*'])).toBe(true);
  });

  it('matches ping (event route "*") for any subscriber', () => {
    expect(routePatternMatches(['*'], ['/'])).toBe(true);
    expect(routePatternMatches(['*'], ['/runs'])).toBe(true);
  });

  it('rejects mismatched routes', () => {
    expect(routePatternMatches(['/'], ['/runs'])).toBe(false);
    expect(routePatternMatches(['/models/sonnet-4-7'], ['/models/gpt-5'])).toBe(false);
  });

  it('handles empty event-routes by rejecting (filtered out earlier; defensive)', () => {
    expect(routePatternMatches([], ['/'])).toBe(false);
  });
});

describe('routePatternMatches — legacy /leaderboard subscription alias (sunset 2026-05-30)', () => {
  it('treats incoming `/leaderboard` subscription as if it were `/`', () => {
    // A stale tab pre-cutover holding `routes=%2Fleaderboard` connects after
    // worker reload; eventToRoutes() emits events tagged `/`; the matcher
    // must accept the legacy subscription pattern for the alias window.
    expect(routePatternMatches(['/'], ['/leaderboard'])).toBe(true);
  });

  it('does NOT match `/leaderboard` subscription against unrelated event routes', () => {
    expect(routePatternMatches(['/runs'], ['/leaderboard'])).toBe(false);
  });

  it('alias is unidirectional — `/` subscription does NOT match `/leaderboard` event tag', () => {
    // Sanity: `eventToRoutes()` no longer emits events tagged `/leaderboard`,
    // so this case is hypothetical; assert the alias doesn't accidentally
    // reverse direction.
    expect(routePatternMatches(['/leaderboard'], ['/'])).toBe(false);
  });
});
