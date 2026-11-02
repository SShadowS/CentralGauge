// site/src/lib/shared/setups.test.ts
import { describe, it, expect } from 'vitest';
import {
  AGENT_TOOLS, KNOWN_ISSUES, rankRows, taskGrid, repeatSpread, diffIngredients, withholdContents,
} from './setups';
import type { Cell, CellOutcome, Ingredients, SetupRow } from './setups';

function setup(id: string, score: number, visibility: 'public' | 'private'): Omit<SetupRow, 'rank'> {
  return {
    id, description: id, agent_tool: 'claude-code', base_model: 'm', visibility, score,
    cost_per_solved_usd: null, price_note: null, tool_version: '1', needs_key: false,
  };
}

function cell(task_id: string, repeat: number, outcome: CellOutcome): Cell {
  return { task_id, repeat, outcome, cost_usd: null, duration_ms: null };
}

const empty: Ingredients = { instructions: null, rules: [], settings: null, skills: [], mcp: [], hooks: [] };

describe('rankRows', () => {
  it('uses competition ranks for public rows and null for private', () => {
    const out = rankRows([
      setup('a', 0.8, 'public'), setup('b', 0.8, 'public'),
      setup('c', 0.7, 'public'), setup('p', 0.9, 'private'),
    ]);
    expect(out.map((r) => r.id)).toEqual(['p', 'a', 'b', 'c']);
    expect(out.map((r) => r.rank)).toEqual([null, 1, 1, 3]);
  });
});

describe('taskGrid', () => {
  it('computes pass rate and flags all-blocked tasks', () => {
    const g = taskGrid([
      cell('HX-001', 1, 'pass'), cell('HX-001', 2, 'fail'),
      cell('HX-002', 1, 'env_blocked'), cell('HX-002', 2, 'infra'),
    ]);
    expect(g.get('HX-001')).toEqual({ passRate: 0.5, blocked: false });
    expect(g.get('HX-002')).toEqual({ passRate: null, blocked: true });
  });
});

describe('repeatSpread', () => {
  it('returns min and max per-repeat pass rate, skipping blocked repeats', () => {
    expect(repeatSpread([
      cell('a', 1, 'pass'), cell('b', 1, 'pass'),
      cell('a', 2, 'pass'), cell('b', 2, 'fail'),
      cell('a', 3, 'env_blocked'),
    ])).toEqual({ min: 0.5, max: 1 });
  });
  it('returns null when everything is blocked', () => {
    expect(repeatSpread([cell('a', 1, 'env_blocked'), cell('a', 2, 'infra')])).toBeNull();
  });
});

describe('diffIngredients', () => {
  it('marks differing fields only, in interface key order', () => {
    const d = diffIngredients(
      { ...empty, skills: ['a'], mcp: ['x'] },
      { ...empty, skills: ['a', 'b'], mcp: ['x'] },
    );
    expect(d.map((e) => e.field)).toEqual(['instructions', 'rules', 'settings', 'skills', 'mcp', 'hooks']);
    expect(d.find((e) => e.field === 'skills')).toEqual({ field: 'skills', a: ['a'], b: ['a', 'b'], differs: true });
    expect(d.find((e) => e.field === 'mcp')?.differs).toBe(false);
  });
  it('compares files by name', () => {
    const d = diffIngredients(
      { ...empty, instructions: { name: 'CLAUDE.md', content: 'x' }, rules: [{ name: 'r2', content: null }, { name: 'r1', content: null }] },
      { ...empty, instructions: { name: 'CLAUDE.md', content: 'y' }, rules: [{ name: 'r1', content: 'z' }, { name: 'r2', content: 'z' }] },
    );
    expect(d.find((e) => e.field === 'instructions')).toEqual({ field: 'instructions', a: ['CLAUDE.md'], b: ['CLAUDE.md'], differs: false });
    expect(d.find((e) => e.field === 'rules')?.differs).toBe(false);
  });
});

describe('withholdContents', () => {
  it('keeps names and nulls every content', () => {
    const out = withholdContents({
      ...empty,
      instructions: { name: 'AGENTS.md', content: 'secret' },
      rules: [{ name: 'r', content: 'secret' }],
      settings: { name: 's.json', content: 'secret' },
      skills: ['k'],
    });
    expect(out.instructions).toEqual({ name: 'AGENTS.md', content: null });
    expect(out.rules).toEqual([{ name: 'r', content: null }]);
    expect(out.settings).toEqual({ name: 's.json', content: null });
    expect(out.skills).toEqual(['k']);
  });
});

describe('KNOWN_ISSUES', () => {
  it('has a non-empty entry for every tool', () => {
    for (const t of AGENT_TOOLS) expect(KNOWN_ISSUES[t].length).toBeGreaterThan(0);
  });
});
