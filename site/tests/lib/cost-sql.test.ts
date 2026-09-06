/**
 * Pure unit tests for `rowCostUsd`. No D1 needed, so this runs under
 * `vitest.unit.config.ts` (jsdom pool) rather than the workers pool.
 */
import { describe, expect, it } from "vitest";
import { rowCostUsd } from "../../src/lib/server/cost-sql";

describe("rowCostUsd", () => {
  it("branches on the runs alias invocation_mode", () => {
    const sql = rowCostUsd("r", "cs", "runs");
    expect(sql).toContain("CASE WHEN runs.invocation_mode = 'batch'");
    expect(sql).toContain("cs.batch_input_per_mtoken");
    expect(sql).toContain("cs.input_per_mtoken");
    expect(sql.endsWith("/ 1000000.0")).toBe(true);
  });
  it("rejects a non-identifier alias", () => {
    expect(() => rowCostUsd("r", "cs", "runs; DROP")).toThrow();
  });
});
