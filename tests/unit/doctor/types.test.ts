import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type {
  Check,
  CheckLevel,
  CheckResult,
  CheckStatus,
  DoctorContext,
  DoctorReport,
  Section,
} from "../../../src/doctor/types.ts";

describe("doctor types", () => {
  it("CheckResult is JSON-serializable", () => {
    const r: CheckResult = {
      id: "cfg.present",
      level: "A",
      status: "passed",
      message: "config loaded",
      durationMs: 3,
    };
    const round = JSON.parse(JSON.stringify(r)) as CheckResult;
    assertEquals(round, r);
  });

  it("DoctorReport composes CheckResult + summary", () => {
    const report: DoctorReport = {
      schemaVersion: 1,
      section: "ingest",
      generatedAt: "2026-04-26T03:00:00.000Z",
      ok: true,
      checks: [],
      summary: { passed: 0, failed: 0, warning: 0, skipped: 0 },
    };
    const round = JSON.parse(JSON.stringify(report)) as DoctorReport;
    assertEquals(round.schemaVersion, 1);
  });

  it("Section + Check shape is usable", () => {
    const fakeCheck: Check = {
      id: "test.fake",
      level: "A",
      run: () =>
        Promise.resolve({
          id: "test.fake",
          level: "A",
          status: "passed",
          message: "ok",
          durationMs: 0,
        }),
    };
    const section: Section = { id: "ingest", checks: [fakeCheck] };
    assertEquals(section.checks.length, 1);
  });

  it("CheckLevel narrows to A|B|C|D", () => {
    const levels: CheckLevel[] = ["A", "B", "C", "D"];
    assertEquals(levels.length, 4);
  });

  it("CheckStatus narrows to four values", () => {
    const statuses: CheckStatus[] = ["passed", "failed", "warning", "skipped"];
    assertEquals(statuses.length, 4);
  });

  it("DoctorContext carries optional bench-aware inputs", () => {
    const ctx: DoctorContext = {
      cwd: "/tmp",
      fetchFn: globalThis.fetch,
      previousResults: new Map(),
    };
    assertEquals(ctx.cwd, "/tmp");
    assertEquals(ctx.previousResults.size, 0);
  });
});
