import { KNOWN_ISSUES, rankRows, taskGrid, withholdContents } from '$lib/shared/setups';
import type { AgentTool, Cell, Ingredients, Role, SetupRow } from '$lib/shared/setups';

export interface SetupTaskSet { hash: string; display_name: string; task_count: number; is_current: boolean; promoted_at: string | null; tasks: string[]; }
export interface SetupRunSummary { run_id: string; task_set_hash: string; task_set_name: string; is_current: boolean; tool_version: string; published_at: string; score: number; cost_per_solved_usd: number | null; price_note: string | null; excluded_cells: number; }
export interface SetupDetail {
  setup: { id: string; description: string; agent_tool: AgentTool; base_model: string; visibility: 'public' | 'private'; needs_key: boolean; roles: Role[]; flow: string | null; ingredients: Ingredients };
  known_issue: string;
  runs: SetupRunSummary[];
  latest: { run_id: string; task_set_hash: string; cells: Cell[] } | null;
}

// Newest run per setup on a set: max published_at, then max id.
const NEWEST_RUN = `r.id = (SELECT r2.id FROM setup_runs r2 WHERE r2.setup_id = r.setup_id AND r2.task_set_hash = r.task_set_hash
  ORDER BY r2.published_at DESC, r2.id DESC LIMIT 1)`;

export async function listSetupTaskSets(db: D1Database): Promise<SetupTaskSet[]> {
  const sets = (await db.prepare(`SELECT hash, display_name, task_count, is_current, promoted_at FROM setup_task_sets ORDER BY created_at DESC, hash`).all<{
    hash: string; display_name: string; task_count: number; is_current: number; promoted_at: string | null;
  }>()).results;
  const tasks = (await db.prepare(`SELECT task_set_hash, task_id FROM hx_tasks ORDER BY task_id`).all<{ task_set_hash: string; task_id: string }>()).results;
  return sets.map((s) => ({
    ...s,
    is_current: s.is_current === 1,
    tasks: tasks.filter((t) => t.task_set_hash === s.hash).map((t) => t.task_id),
  }));
}

export async function computeSetupRanking(db: D1Database, setHash: string, includePrivate: boolean): Promise<SetupRow[]> {
  const rows = (await db.prepare(
    `SELECT s.id, s.description, s.agent_tool, s.base_model, s.visibility, s.needs_key,
            r.score, r.cost_per_solved_usd, r.price_note, r.tool_version
     FROM setup_runs r JOIN setups s ON s.id = r.setup_id
     WHERE r.task_set_hash = ? AND ${NEWEST_RUN} ${includePrivate ? '' : "AND s.visibility = 'public'"}`,
  ).bind(setHash).all<Omit<SetupRow, 'rank' | 'needs_key'> & { needs_key: number }>()).results;
  return rankRows(rows.map((r) => ({ ...r, needs_key: r.needs_key === 1 })));
}

export async function getSetupDetail(db: D1Database, id: string): Promise<SetupDetail | null> {
  const s = await db.prepare(`SELECT * FROM setups WHERE id = ?`).bind(id).first<{
    id: string; description: string; agent_tool: AgentTool; base_model: string; visibility: 'public' | 'private';
    needs_key: number; roles_json: string; flow: string | null; ingredients_json: string;
  }>();
  if (!s) return null;
  const isPrivate = s.visibility === 'private';
  const ingredients: Ingredients = JSON.parse(s.ingredients_json);

  const runs = (await db.prepare(
    `SELECT r.id AS run_id, r.task_set_hash, t.display_name AS task_set_name, t.is_current, r.tool_version, r.published_at,
            r.score, r.cost_per_solved_usd, r.price_note, r.excluded_cells
     FROM setup_runs r JOIN setup_task_sets t ON t.hash = r.task_set_hash
     WHERE r.setup_id = ? ORDER BY r.published_at DESC, r.id DESC`,
  ).bind(id).all<Omit<SetupRunSummary, 'is_current'> & { is_current: number }>()).results
    .map((r) => ({ ...r, is_current: r.is_current === 1 }));

  const newest = runs.find((r) => r.is_current);
  let latest: SetupDetail['latest'] = null;
  if (newest) {
    const cells = (await db.prepare(
      `SELECT task_id, repeat, outcome, cost_usd, duration_ms FROM setup_cells WHERE run_id = ? ORDER BY task_id, repeat`,
    ).bind(newest.run_id).all<Cell>()).results;
    latest = { run_id: newest.run_id, task_set_hash: newest.task_set_hash, cells };
  }

  return {
    setup: {
      id: s.id, description: s.description, agent_tool: s.agent_tool, base_model: s.base_model,
      visibility: s.visibility, needs_key: s.needs_key === 1, roles: JSON.parse(s.roles_json),
      flow: isPrivate ? null : s.flow,
      ingredients: isPrivate ? withholdContents(ingredients) : ingredients,
    },
    known_issue: KNOWN_ISSUES[s.agent_tool],
    runs,
    latest,
  };
}

export async function getHxTaskResults(db: D1Database, setHash: string, taskId: string): Promise<{
  description_sha: string;
  results: { setup_id: string; description: string; agent_tool: AgentTool; passRate: number | null; blocked: boolean }[];
} | null> {
  const task = await db.prepare(`SELECT description_sha FROM hx_tasks WHERE task_set_hash = ? AND task_id = ?`)
    .bind(setHash, taskId).first<{ description_sha: string }>();
  if (!task) return null;
  const rows = (await db.prepare(
    `SELECT s.id AS setup_id, s.description, s.agent_tool, c.repeat, c.outcome, c.task_id, c.cost_usd, c.duration_ms
     FROM setup_runs r JOIN setups s ON s.id = r.setup_id
     JOIN setup_cells c ON c.run_id = r.id AND c.task_id = ?
     WHERE r.task_set_hash = ? AND s.visibility = 'public' AND ${NEWEST_RUN}
     ORDER BY s.id`,
  ).bind(taskId, setHash).all<Cell & { setup_id: string; description: string; agent_tool: AgentTool }>()).results;
  const bySetup = new Map<string, typeof rows>();
  for (const r of rows) bySetup.set(r.setup_id, [...(bySetup.get(r.setup_id) ?? []), r]);
  return {
    description_sha: task.description_sha,
    results: [...bySetup.values()].map((cells) => {
      const g = taskGrid(cells).get(taskId)!;
      return { setup_id: cells[0].setup_id, description: cells[0].description, agent_tool: cells[0].agent_tool, passRate: g.passRate, blocked: g.blocked };
    }),
  };
}
