import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { computeSetupRanking, getHxTaskResults, getSetupDetail, listSetupTaskSets } from '../../src/lib/server/setups';
import { KNOWN_ISSUES } from '../../src/lib/shared/setups';
import { resetDb } from '../utils/reset-db';
import { seedSetups } from '../utils/seed-setups';

describe('setups queries', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await resetDb();
    await seedSetups(env.DB);
  });

  it('ranks public setups on the newest run per setup', async () => {
    const rows = await computeSetupRanking(env.DB, 'hx-cur', false);
    expect(rows.map((r) => r.id)).toEqual(['cc-plain', 'pi-default']);
    expect(rows[0].tool_version).toBe('2.1.314');
    expect(rows[0].rank).toBe(1);
  });

  it('includes private setups unranked when asked', async () => {
    const rows = await computeSetupRanking(env.DB, 'hx-cur', true);
    const sec = rows.find((r) => r.id === 'cc-secret');
    expect(sec).toBeDefined();
    expect(sec!.rank).toBeNull();
  });

  it('scopes ranking to the set', async () => {
    expect((await computeSetupRanking(env.DB, 'hx-cur', true)).map((r) => r.id)).not.toContain('codex-old');
    expect((await computeSetupRanking(env.DB, 'hx-old', false)).map((r) => r.id)).toContain('codex-old');
  });

  it('never leaks private contents or flow', async () => {
    const d = await getSetupDetail(env.DB, 'cc-secret');
    expect(d).not.toBeNull();
    const json = JSON.stringify(d);
    for (const s of ['SECRET-BODY', 'SECRET-RULE', 'SECRET-SETTINGS', 'SECRET-FLOW']) expect(json).not.toContain(s);
    expect(d!.setup.flow).toBeNull();
    expect(d!.setup.ingredients.skills).toEqual(['skill-a', 'skill-b']);
    expect(d!.setup.ingredients.instructions).toEqual({ name: 'CLAUDE.md', content: null });
  });

  it('returns public detail with runs newest first, known issue and latest cells', async () => {
    const d = await getSetupDetail(env.DB, 'cc-plain');
    expect(d!.runs.map((r) => r.run_id)).toEqual(['r-cc-2', 'r-cc-1']);
    expect(d!.runs[0].is_current).toBe(true);
    expect(d!.known_issue).toBe(KNOWN_ISSUES['claude-code']);
    expect(d!.setup.flow).toBe('plain flow');
    expect(d!.latest!.run_id).toBe('r-cc-2');
    expect(d!.latest!.cells).toHaveLength(4);
  });

  it('latest is null when the setup has no run on the current set', async () => {
    expect((await getSetupDetail(env.DB, 'codex-old'))!.latest).toBeNull();
  });

  it('returns null for an unknown setup', async () => {
    expect(await getSetupDetail(env.DB, 'nope')).toBeNull();
  });

  it('task results cover public setups only, from the newest run', async () => {
    const r = await getHxTaskResults(env.DB, 'hx-cur', 'HX-001');
    expect(r!.description_sha).toBe('sha-cur-1');
    expect(r!.results.map((x) => x.setup_id).sort()).toEqual(['cc-plain', 'pi-default']);
    const cc = r!.results.find((x) => x.setup_id === 'cc-plain')!;
    expect(cc.passRate).toBe(1);
    expect(cc.blocked).toBe(false);
    const pi = r!.results.find((x) => x.setup_id === 'pi-default')!;
    expect(pi.passRate).toBeNull();
    expect(pi.blocked).toBe(true);
  });

  it('task results are null for an unknown pair', async () => {
    expect(await getHxTaskResults(env.DB, 'hx-cur', 'HX-999')).toBeNull();
    expect(await getHxTaskResults(env.DB, 'hx-old', 'HX-002')).toBeNull();
  });

  it('lists task sets with their tasks', async () => {
    const sets = await listSetupTaskSets(env.DB);
    expect(sets.map((s) => s.hash).sort()).toEqual(['hx-cur', 'hx-old']);
    const cur = sets.find((s) => s.hash === 'hx-cur')!;
    expect(cur.is_current).toBe(true);
    expect(cur.tasks).toEqual(['HX-001', 'HX-002']);
  });
});
