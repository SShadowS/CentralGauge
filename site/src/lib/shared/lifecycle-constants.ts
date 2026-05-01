/**
 * Worker-side mirror of `src/lifecycle/types.ts` runtime values.
 *
 * The strict-typed types (`LifecycleEventType`, `LifecycleActor`) are
 * `import type`-able from the Deno-side `src/lifecycle/types.ts` (zero-cost
 * type erasure), but the runtime value tuples cannot be — Vite/rolldown
 * refuses to bundle `.ts` cross-package imports outside the workspace.
 *
 * Keep these arrays IN LOCKSTEP with the Deno source. The
 * `lifecycle-event-types-parity.test.ts` test pins the two lists together
 * by reading both files at test time.
 *
 * Adding a new event type requires editing BOTH:
 *   - src/lifecycle/types.ts: CANONICAL_EVENT_TYPES
 *   - site/src/lib/shared/lifecycle-constants.ts: CANONICAL_EVENT_TYPES (this file)
 * (and the strategic plan's "Event types" appendix)
 */

import type { LifecycleActor, LifecycleEventType } from '../../../../src/lifecycle/types';

export const CANONICAL_EVENT_TYPES = [
  'bench.started',
  'bench.completed',
  'bench.failed',
  'bench.skipped',
  'debug.started',
  'debug.captured',
  'debug.failed',
  'debug.skipped',
  'analysis.started',
  'analysis.completed',
  'analysis.failed',
  'analysis.skipped',
  'analysis.accepted',
  'analysis.rejected',
  'publish.started',
  'publish.completed',
  'publish.failed',
  'publish.skipped',
  'cycle.started',
  'cycle.completed',
  'cycle.failed',
  'cycle.timed_out',
  'cycle.aborted',
  'concept.created',
  'concept.merged',
  'concept.split',
  'concept.aliased',
  'model.released',
  'task_set.changed',
] as const satisfies readonly LifecycleEventType[];

const CANONICAL_EVENT_TYPE_SET: ReadonlySet<string> = new Set(CANONICAL_EVENT_TYPES);

export function isCanonicalEventType(s: string): s is LifecycleEventType {
  return CANONICAL_EVENT_TYPE_SET.has(s);
}

export const CANONICAL_ACTORS = [
  'operator',
  'ci',
  'migration',
  'reviewer',
] as const satisfies readonly LifecycleActor[];

const CANONICAL_ACTOR_SET: ReadonlySet<string> = new Set(CANONICAL_ACTORS);

export function isCanonicalActor(s: string): s is LifecycleActor {
  return CANONICAL_ACTOR_SET.has(s);
}
