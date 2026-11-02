import type { Ingredients } from '../../src/lib/shared/setups';

const noIngredients: Ingredients = { instructions: null, rules: [], settings: null, skills: [], mcp: [], hooks: [] };
const secretIngredients: Ingredients = {
  instructions: { name: 'CLAUDE.md', content: 'SECRET-BODY' },
  rules: [{ name: 'style.md', content: 'SECRET-RULE' }],
  settings: { name: 'settings.json', content: 'SECRET-SETTINGS' },
  skills: ['skill-a', 'skill-b'],
  mcp: ['mcp-x'],
  hooks: ['hook-y'],
};

/** Two task sets (hx-cur current, hx-old) and four setups; see Task 3 brief. */
export async function seedSetups(db: D1Database): Promise<void> {
  const roles = JSON.stringify([{ role: 'main', model: 'm-1', effort: null }]);
  const setup = (id: string, agent: string, vis: string, ing: Ingredients, flow: string | null) =>
    db
      .prepare(
        `INSERT INTO setups (id, description, agent_tool, base_model, visibility, needs_key, roles_json, flow, ingredients_json, created_at)
         VALUES (?, ?, ?, 'm-1', ?, 0, ?, ?, ?, '2026-10-01T00:00:00Z')`,
      )
      .bind(id, `${id} description`, agent, vis, roles, flow, JSON.stringify(ing));
  const run = (id: string, setupId: string, set: string, ver: string, at: string, score: number, cost: number | null, note: string | null) =>
    db
      .prepare(
        `INSERT INTO setup_runs (id, setup_id, task_set_hash, tool_version, published_at, score, cost_per_solved_usd, price_note, excluded_cells)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .bind(id, setupId, set, ver, at, score, cost, note);
  const cell = (runId: string, task: string, repeat: number, outcome: string) =>
    db
      .prepare(`INSERT INTO setup_cells (run_id, task_id, repeat, outcome, cost_usd, duration_ms) VALUES (?, ?, ?, ?, 0.1, 1000)`)
      .bind(runId, task, repeat, outcome);

  await db.batch([
    db.prepare(`INSERT INTO setup_task_sets (hash, display_name, task_count, is_current, created_at, promoted_at) VALUES ('hx-cur', 'HX current', 2, 1, '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')`),
    db.prepare(`INSERT INTO setup_task_sets (hash, display_name, task_count, is_current, created_at, promoted_at) VALUES ('hx-old', 'HX old', 1, 0, '2026-09-01T00:00:00Z', NULL)`),
    db.prepare(`INSERT INTO hx_tasks (task_set_hash, task_id, description_sha) VALUES ('hx-cur', 'HX-002', 'sha-cur-2'), ('hx-cur', 'HX-001', 'sha-cur-1'), ('hx-old', 'HX-001', 'sha-old-1')`),
    setup('cc-plain', 'claude-code', 'public', noIngredients, 'plain flow'),
    setup('pi-default', 'pi', 'public', noIngredients, null),
    setup('cc-secret', 'claude-code', 'private', secretIngredients, 'SECRET-FLOW'),
    setup('codex-old', 'codex', 'public', noIngredients, null),
    run('r-cc-1', 'cc-plain', 'hx-cur', '2.1.300', '2026-10-05T00:00:00Z', 0.5, 0.4, null),
    run('r-cc-2', 'cc-plain', 'hx-cur', '2.1.314', '2026-10-10T00:00:00Z', 0.75, 0.3, null),
    run('r-pi-1', 'pi-default', 'hx-cur', '0.9.0', '2026-10-06T00:00:00Z', 0.25, null, 'no price data'),
    run('r-sec-1', 'cc-secret', 'hx-cur', '2.1.314', '2026-10-07T00:00:00Z', 0.9, 0.2, null),
    run('r-old-1', 'codex-old', 'hx-old', '1.0.0', '2026-09-10T00:00:00Z', 0.6, 0.5, null),
    // cc-plain newest run: HX-001 pass+pass, HX-002 pass+fail
    cell('r-cc-2', 'HX-001', 1, 'pass'),
    cell('r-cc-2', 'HX-001', 2, 'pass'),
    cell('r-cc-2', 'HX-002', 1, 'pass'),
    cell('r-cc-2', 'HX-002', 2, 'fail'),
    // cc-plain older run: all fail (must be ignored)
    cell('r-cc-1', 'HX-001', 1, 'fail'),
    cell('r-cc-1', 'HX-002', 1, 'fail'),
    // pi: HX-001 env_blocked only (blocked), HX-002 fail
    cell('r-pi-1', 'HX-001', 1, 'env_blocked'),
    cell('r-pi-1', 'HX-002', 1, 'fail'),
    cell('r-sec-1', 'HX-001', 1, 'pass'),
    cell('r-old-1', 'HX-001', 1, 'pass'),
  ]);
}
