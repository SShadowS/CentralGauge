import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  formatReportAsJson,
  formatReportToTerminal,
} from "../../../src/doctor/formatter.ts";
import type { DoctorReport } from "../../../src/doctor/types.ts";

const sampleReport: DoctorReport = {
  schemaVersion: 1,
  section: "ingest",
  generatedAt: "2026-04-26T03:00:00.000Z",
  ok: false,
  checks: [
    {
      id: "cfg.present",
      level: "A",
      status: "passed",
      message: "ingest config loaded",
      durationMs: 3,
    },
    {
      id: "auth.probe",
      level: "C",
      status: "failed",
      message: "key mismatch",
      remediation: {
        summary: "Re-provision keys and re-insert into D1",
        command: "deno run scripts/provision-ingest-keys.ts",
        autoRepairable: false,
      },
      durationMs: 304,
    },
    {
      id: "catalog.bench",
      level: "D",
      status: "skipped",
      message: "skipped: dependency 'auth.probe' failed",
      durationMs: 0,
    },
  ],
  summary: { passed: 1, failed: 1, warning: 0, skipped: 1 },
};

describe("formatReportToTerminal", () => {
  it("includes section header and timing", () => {
    const out = formatReportToTerminal(sampleReport, { color: false });
    assert(out.includes("[doctor: ingest]"));
    assert(out.includes("ok"), "should mention each passing check status");
  });

  it("renders passed/failed/skipped per check with id", () => {
    const out = formatReportToTerminal(sampleReport, { color: false });
    assert(out.includes("cfg.present"));
    assert(out.includes("auth.probe"));
    assert(out.includes("catalog.bench"));
    assert(out.includes("ingest config loaded"));
    assert(out.includes("key mismatch"));
  });

  it("includes remediation hint after a failed check", () => {
    const out = formatReportToTerminal(sampleReport, { color: false });
    assert(out.includes("Re-provision keys"));
    assert(out.includes("scripts/provision-ingest-keys.ts"));
  });

  it("ends with a summary line including counts and exit code hint", () => {
    const out = formatReportToTerminal(sampleReport, { color: false });
    assert(out.includes("1/3 passed"));
    assert(out.includes("1 failed"));
    assert(out.includes("1 skipped"));
  });
});

describe("formatReportAsJson", () => {
  it("returns the DoctorReport stringified", () => {
    const out = formatReportAsJson(sampleReport);
    const parsed = JSON.parse(out) as DoctorReport;
    assertEquals(parsed.schemaVersion, 1);
    assertEquals(parsed.section, "ingest");
    assertEquals(parsed.checks.length, 3);
    assertEquals(parsed.ok, false);
  });

  it("is pretty-printed by default for human inspection", () => {
    const out = formatReportAsJson(sampleReport);
    assert(out.includes("\n"), "JSON output should be multi-line");
  });
});
