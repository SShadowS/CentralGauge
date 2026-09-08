/**
 * Pure unit tests for `rowCostUsd`. No D1 needed, so this runs under
 * `vitest.unit.config.ts` (jsdom pool) rather than the workers pool.
 */
import { describe, expect, it } from "vitest";
import { rowCostUsd } from "../../src/lib/server/cost-sql";

describe("rowCostUsd", () => {
  it("prices every run at the sync list rates, whatever its invocation mode", () => {
    const sql = rowCostUsd("r", "cs", "runs");
    expect(sql).toContain("r.tokens_in * cs.input_per_mtoken");
    expect(sql).toContain("r.tokens_out * cs.output_per_mtoken");
    expect(sql).toContain("COALESCE(cs.cache_read_per_mtoken, 0)");
    expect(sql).toContain("COALESCE(cs.cache_write_per_mtoken, 0)");
    expect(sql).not.toContain("invocation_mode");
    expect(sql).not.toContain("batch_");
    expect(sql.endsWith("/ 1000000.0")).toBe(true);
  });
  it("rejects a non-identifier alias, including the runs alias", () => {
    expect(() => rowCostUsd("r; DROP", "cs", "runs")).toThrow();
    expect(() => rowCostUsd("r", "cs", "runs; DROP")).toThrow();
  });
});
