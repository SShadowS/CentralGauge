// site/src/lib/shared/setup-publish.ts
// Pure contract for publishing one harness run to the setups leaderboard.
import { AGENT_TOOLS } from './setups.ts';
import type { AgentTool, CellOutcome, Ingredients, Role } from './setups.ts';

export interface SetupPublishPayload {
  setup: {
    id: string; agent_tool: AgentTool; base_model: string; description: string | null;
    visibility: 'public' | 'private' | null; roles: Role[]; ingredients: Ingredients;
  };
  submission_id: string | null;
  task_set: { hash: string; display_name: string; tasks: { task_id: string; description_sha: string }[] };
  run: {
    id: string; tool_version: string; score: number; cost_per_solved_usd: number | null; price_note: string | null;
    excluded_cells: number; repeats: number;
    cells: { task_id: string; repeat: number; outcome: CellOutcome; cost_usd: number | null; duration_ms: number | null }[];
  };
}

export const PUBLISH_LIMITS = { description: 200, displayName: 100, toolVersion: 50, priceNote: 200 } as const;
export const SETUP_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const OUTCOMES = ['pass', 'fail', 'env_blocked', 'infra'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nullableNum = (v: unknown) => v === null || (isNum(v) && v >= 0);

export function validatePublishPayload(
  x: unknown,
): { ok: true; value: SetupPublishPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(x)) return { ok: false, errors: ['payload must be an object'] };
  const setup = isObj(x['setup']) ? x['setup'] : {};
  const ts = isObj(x['task_set']) ? x['task_set'] : {};
  const run = isObj(x['run']) ? x['run'] : {};
  if (!isObj(x['setup'])) errors.push('setup is required');
  if (!isObj(x['task_set'])) errors.push('task_set is required');
  if (!isObj(x['run'])) errors.push('run is required');

  if (typeof setup['id'] !== 'string' || !SETUP_ID_RE.test(setup['id'])) errors.push('setup.id is invalid');
  if (!AGENT_TOOLS.includes(setup['agent_tool'] as AgentTool)) errors.push('setup.agent_tool is not a known tool');
  if (!isStr(setup['base_model'], 200)) errors.push('setup.base_model is required');
  if (x['submission_id'] !== null && !isStr(x['submission_id'], 100)) errors.push('submission_id must be a string or null');
  if (setup['description'] !== null && setup['description'] !== undefined && !isStr(setup['description'], PUBLISH_LIMITS.description)) {
    errors.push(`setup.description must be 1 to ${PUBLISH_LIMITS.description} characters`);
  }
  if ((setup['description'] ?? null) === null && x['submission_id'] === null) {
    errors.push('setup.description is required without a submission');
  }
  if (setup['visibility'] !== null && setup['visibility'] !== 'public' && setup['visibility'] !== 'private') {
    errors.push('setup.visibility must be public, private or null');
  }
  if (!Array.isArray(setup['roles'])) errors.push('setup.roles must be a list');
  if (!isObj(setup['ingredients'])) errors.push('setup.ingredients must be an object');

  if (typeof ts['hash'] !== 'string' || !HEX64.test(ts['hash'])) errors.push('task_set.hash must be 64 hex characters');
  if (!isStr(ts['display_name'], PUBLISH_LIMITS.displayName)) errors.push('task_set.display_name is required (max 100)');
  const taskIds = new Set<string>();
  if (!Array.isArray(ts['tasks']) || ts['tasks'].length === 0) errors.push('task_set.tasks must be a non-empty list');
  else {
    for (const t of ts['tasks']) {
      const o = isObj(t) ? t : {};
      if (typeof o['task_id'] !== 'string' || !o['task_id']) errors.push('task_set.tasks has an invalid task_id');
      else if (taskIds.has(o['task_id'])) errors.push(`duplicate task ${o['task_id']}`);
      else taskIds.add(o['task_id']);
      if (typeof o['description_sha'] !== 'string' || !HEX64.test(o['description_sha'])) {
        errors.push(`description_sha for ${String(o['task_id'])} must be 64 hex characters`);
      }
    }
  }

  if (!isStr(run['id'], 200)) errors.push('run.id is required');
  if (!isStr(run['tool_version'], PUBLISH_LIMITS.toolVersion)) errors.push('run.tool_version is required (max 50)');
  if (!isNum(run['score']) || run['score'] < 0 || run['score'] > 1) errors.push('run.score must be between 0 and 1');
  if (!nullableNum(run['cost_per_solved_usd'])) errors.push('run.cost_per_solved_usd must be null or >= 0');
  if (run['price_note'] !== null && !isStr(run['price_note'], PUBLISH_LIMITS.priceNote)) errors.push('run.price_note must be null or at most 200 characters');
  if (!Number.isInteger(run['excluded_cells']) || (run['excluded_cells'] as number) < 0) errors.push('run.excluded_cells must be a non-negative integer');
  const repeats = run['repeats'];
  if (!Number.isInteger(repeats) || (repeats as number) < 1) errors.push('run.repeats must be a positive integer');

  if (!Array.isArray(run['cells'])) errors.push('run.cells must be a list');
  else {
    const seen = new Set<string>();
    for (const c of run['cells']) {
      const o = isObj(c) ? c : {};
      const key = `${String(o['task_id'])}#${String(o['repeat'])}`;
      if (typeof o['task_id'] !== 'string' || !taskIds.has(o['task_id'])) errors.push(`cell for unknown task ${String(o['task_id'])}`);
      if (!Number.isInteger(o['repeat']) || (o['repeat'] as number) < 1 || (Number.isInteger(repeats) && (o['repeat'] as number) > (repeats as number))) {
        errors.push(`cell ${key} has an invalid repeat`);
      }
      if (!OUTCOMES.includes(o['outcome'] as string)) errors.push(`cell ${key} has an invalid outcome`);
      if (!nullableNum(o['cost_usd']) || !nullableNum(o['duration_ms']) || (o['duration_ms'] !== null && !Number.isInteger(o['duration_ms']))) errors.push(`cell ${key} has an invalid cost or duration`);
      if (seen.has(key)) errors.push(`duplicate cell ${key}`);
      seen.add(key);
    }
    if (Number.isInteger(repeats) && taskIds.size > 0 && run['cells'].length !== taskIds.size * (repeats as number)) {
      errors.push(`expected ${taskIds.size * (repeats as number)} cells, got ${run['cells'].length}`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: x as unknown as SetupPublishPayload };
}
