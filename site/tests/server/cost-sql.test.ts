import { describe, expect, it } from 'vitest';
import { rowCostUsd } from '../../src/lib/server/cost-sql';

describe('rowCostUsd', () => {
  it('sums all four billable token classes', () => {
    const sql = rowCostUsd();
    expect(sql).toContain('r.tokens_in * cs.input_per_mtoken');
    expect(sql).toContain('r.tokens_out * cs.output_per_mtoken');
    expect(sql).toContain('r.tokens_cache_read * COALESCE(cs.cache_read_per_mtoken, 0)');
    expect(sql).toContain('r.tokens_cache_write * COALESCE(cs.cache_write_per_mtoken, 0)');
    expect(sql).toContain('/ 1000000.0');
  });

  it('does NOT include tokens_reasoning (already folded into tokens_out; would double-count)', () => {
    expect(rowCostUsd()).not.toContain('reasoning');
  });

  it('NULL-guards only the nullable cache-rate columns', () => {
    const sql = rowCostUsd();
    // input/output rates are NOT NULL per schema — left bare.
    expect(sql).not.toContain('COALESCE(cs.input_per_mtoken');
    expect(sql).not.toContain('COALESCE(cs.output_per_mtoken');
    // cache rates are nullable — wrapped.
    expect(sql).toContain('COALESCE(cs.cache_read_per_mtoken, 0)');
    expect(sql).toContain('COALESCE(cs.cache_write_per_mtoken, 0)');
  });

  it('honours custom table aliases', () => {
    const sql = rowCostUsd('res', 'snap');
    expect(sql).toContain('res.tokens_in * snap.input_per_mtoken');
    expect(sql).toContain('res.tokens_cache_write * COALESCE(snap.cache_write_per_mtoken, 0)');
    expect(sql).not.toContain('r.tokens_in');
  });

  it('rejects non-identifier aliases (injection guard)', () => {
    expect(() => rowCostUsd('r; DROP TABLE results;--', 'cs')).toThrow(/Invalid SQL alias/);
    expect(() => rowCostUsd('r', 'cs WHERE 1=1')).toThrow(/Invalid SQL alias/);
    expect(() => rowCostUsd('1r', 'cs')).toThrow(/Invalid SQL alias/);
    // Valid identifiers pass.
    expect(() => rowCostUsd('r', 'cs')).not.toThrow();
    expect(() => rowCostUsd('res_1', 'snap_2')).not.toThrow();
  });
});
