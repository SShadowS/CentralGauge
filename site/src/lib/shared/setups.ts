// site/src/lib/shared/setups.ts
export const AGENT_TOOLS = ['claude-code', 'codex', 'pi', 'opencode', 'cursor', 'antigravity'] as const;
export type AgentTool = typeof AGENT_TOOLS[number];
export type CellOutcome = 'pass' | 'fail' | 'env_blocked' | 'infra';
export interface Role { role: string; model: string; effort: string | null; }
export interface NamedFile { name: string; content: string | null; } // content null = withheld
export interface Ingredients {
  instructions: NamedFile | null; rules: NamedFile[]; settings: NamedFile | null;
  skills: string[]; mcp: string[]; hooks: string[];
}
export interface Cell { task_id: string; repeat: number; outcome: CellOutcome; cost_usd: number | null; duration_ms: number | null; }
export interface SetupRow {
  rank: number | null; id: string; description: string; agent_tool: AgentTool; base_model: string;
  visibility: 'public' | 'private'; score: number; cost_per_solved_usd: number | null;
  price_note: string | null; tool_version: string; needs_key: boolean;
}

export const KNOWN_ISSUES: Record<AgentTool, string> = {
  'claude-code': 'Open bugs leave a few calls out: a retried failed stream counts only the retry; model-switch and auto-mode classifier calls are not counted.',
  codex: "No model id, so all tokens are priced at the main model's rate. Subagent and background-compaction coverage unconfirmed.",
  pi: 'Subagents exist only via extensions; their usage unconfirmed.',
  opencode: 'Subagent sessions, title generation and compaction are not counted, so cost is understated when they run.',
  cursor: 'No model id, no reasoning tokens; coverage of subagents and background calls unknown. Cost is approximate.',
  antigravity: 'No model id, no cache-write tokens; how thinking tokens relate to output is unclear; subagent coverage undocumented. Cost is approximate.',
};

/** Score desc, id asc. Public rows get competition ranks (1, 1, 3); private rows get null. */
export function rankRows(rows: Omit<SetupRow, 'rank'>[]): SetupRow[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  let pos = 0;
  let prev: number | null = null;
  let prevRank: number | null = null;
  return sorted.map((r) => {
    if (r.visibility === 'private') return { ...r, rank: null };
    pos++;
    const rank: number | null = r.score === prev ? prevRank : pos;
    prev = r.score;
    prevRank = rank;
    return { ...r, rank };
  });
}

function rate(cells: Cell[]): number | null {
  const counted = cells.filter((c) => c.outcome === 'pass' || c.outcome === 'fail');
  if (counted.length === 0) return null;
  return counted.filter((c) => c.outcome === 'pass').length / counted.length;
}

function groupBy<K>(cells: Cell[], key: (c: Cell) => K): Map<K, Cell[]> {
  const m = new Map<K, Cell[]>();
  for (const c of cells) {
    const k = key(c);
    const list = m.get(k);
    if (list) list.push(c); else m.set(k, [c]);
  }
  return m;
}

export function taskGrid(cells: Cell[]): Map<string, { passRate: number | null; blocked: boolean }> {
  const out = new Map<string, { passRate: number | null; blocked: boolean }>();
  for (const [task, list] of groupBy(cells, (c) => c.task_id)) {
    const passRate = rate(list);
    out.set(task, { passRate, blocked: passRate === null });
  }
  return out;
}

export function repeatSpread(cells: Cell[]): { min: number; max: number } | null {
  const rates: number[] = [];
  for (const list of groupBy(cells, (c) => c.repeat).values()) {
    const r = rate(list);
    if (r !== null) rates.push(r);
  }
  return rates.length ? { min: Math.min(...rates), max: Math.max(...rates) } : null;
}

export function diffIngredients(a: Ingredients, b: Ingredients): { field: keyof Ingredients; a: string[]; b: string[]; differs: boolean }[] {
  const names = (i: Ingredients, f: keyof Ingredients): string[] => {
    const v = i[f];
    if (v === null) return [];
    if (!Array.isArray(v)) return [v.name];
    return (v as (string | NamedFile)[]).map((x) => (typeof x === 'string' ? x : x.name)).sort();
  };
  const fields: (keyof Ingredients)[] = ['instructions', 'rules', 'settings', 'skills', 'mcp', 'hooks'];
  return fields.map((field) => {
    const an = names(a, field);
    const bn = names(b, field);
    return { field, a: an, b: bn, differs: an.length !== bn.length || an.some((x, i) => x !== bn[i]) };
  });
}

export function withholdContents(i: Ingredients): Ingredients {
  const w = (f: NamedFile | null): NamedFile | null => (f ? { name: f.name, content: null } : null);
  return { ...i, instructions: w(i.instructions), rules: i.rules.map((r) => ({ name: r.name, content: null })), settings: w(i.settings) };
}
