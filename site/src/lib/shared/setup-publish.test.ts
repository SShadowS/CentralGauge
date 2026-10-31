import { describe, expect, it } from 'vitest';
import { validatePublishPayload } from './setup-publish';
import type { SetupPublishPayload } from './setup-publish';

const H = 'a'.repeat(64);
function valid(): SetupPublishPayload {
  return {
    setup: {
      id: 'my-setup', agent_tool: 'claude-code', base_model: 'm', description: 'd', visibility: 'public',
      roles: [], ingredients: { instructions: null, rules: [], settings: null, skills: [], mcp: [], hooks: [] },
    },
    submission_id: null,
    task_set: { hash: H, display_name: 'HX', tasks: [{ task_id: 't1', description_sha: H }, { task_id: 't2', description_sha: H }] },
    run: {
      id: 'c:a', tool_version: '1', score: 0.5, cost_per_solved_usd: null, price_note: null, excluded_cells: 0, repeats: 1,
      cells: [
        { task_id: 't1', repeat: 1, outcome: 'pass', cost_usd: 1, duration_ms: 5 },
        { task_id: 't2', repeat: 1, outcome: 'fail', cost_usd: null, duration_ms: null },
      ],
    },
  };
}
const bad = (mut: (p: SetupPublishPayload) => void) => {
  const p = valid();
  mut(p);
  expect(validatePublishPayload(p).ok).toBe(false);
};

describe('validatePublishPayload', () => {
  it('accepts a valid payload', () => expect(validatePublishPayload(valid()).ok).toBe(true));
  it('rejects a bad id', () => bad((p) => { p.setup.id = 'Bad_ID'; }));
  it('rejects the mock tool', () => bad((p) => { (p.setup as { agent_tool: string }).agent_tool = 'mock'; }));
  it('rejects score 1.2', () => bad((p) => { p.run.score = 1.2; }));
  it('rejects a missing cell', () => bad((p) => { p.run.cells.pop(); }));
  it('rejects a duplicate cell', () => bad((p) => { p.run.cells[1] = { ...p.run.cells[0]! }; }));
  it('rejects a cell for an unknown task', () => bad((p) => { p.run.cells[1]!.task_id = 'zzz'; }));
  it('rejects a null description without a submission', () => bad((p) => { p.setup.description = null; }));
  it('allows a null description with a submission', () => {
    const p = valid();
    p.setup.description = null;
    p.submission_id = 's1';
    expect(validatePublishPayload(p).ok).toBe(true);
  });
  it('rejects a short hash', () => bad((p) => { p.task_set.hash = 'abc'; }));
});
