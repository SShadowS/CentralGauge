import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { applyRepairs, type Repairer } from "../../../src/doctor/repair.ts";
import type { DoctorReport } from "../../../src/doctor/types.ts";

const reportWithRepairableFailure: DoctorReport = {
  schemaVersion: 1,
  section: "ingest",
  generatedAt: "2026-04-26T00:00:00.000Z",
  ok: false,
  checks: [
    {
      id: "catalog.bench",
      level: "D",
      status: "failed",
      message: "pricing missing for openai/gpt-5",
      remediation: {
        summary: "Push catalog drift to D1",
        command: "deno task start sync-catalog --apply",
        autoRepairable: true,
      },
      details: {
        missing_pricing: [{
          slug: "openai/gpt-5",
          pricing_version: "2026-04-26",
        }],
      },
      durationMs: 100,
    },
  ],
  summary: { passed: 0, failed: 1, warning: 0, skipped: 0 },
};

describe("applyRepairs", () => {
  it("invokes the matching repairer for each auto-repairable failed check", async () => {
    const calls: string[] = [];
    const repairer: Repairer = {
      id: "sync-catalog",
      matches: (r) =>
        r.id === "catalog.bench" && r.remediation?.autoRepairable === true,
      run: async () => {
        await Promise.resolve();
        calls.push("sync-catalog");
        return { ok: true, message: "synced" };
      },
    };
    const outcome = await applyRepairs(reportWithRepairableFailure, [repairer]);
    assertEquals(calls, ["sync-catalog"]);
    assertEquals(outcome.attempted.length, 1);
    assertEquals(outcome.attempted[0]!.checkId, "catalog.bench");
    assertEquals(outcome.attempted[0]!.ok, true);
  });

  it("does not invoke repairers for non-repairable failures", async () => {
    const failedNonRepairable: DoctorReport = {
      ...reportWithRepairableFailure,
      checks: [
        {
          id: "auth.probe",
          level: "C",
          status: "failed",
          message: "key mismatch",
          remediation: {
            summary: "Re-provision",
            autoRepairable: false,
          },
          durationMs: 0,
        },
      ],
    };
    const calls: string[] = [];
    const r: Repairer = {
      id: "any",
      matches: () => true,
      run: async () => {
        await Promise.resolve();
        calls.push("ran");
        return { ok: true };
      },
    };
    const outcome = await applyRepairs(failedNonRepairable, [r]);
    assertEquals(calls.length, 0);
    assertEquals(outcome.attempted.length, 0);
  });

  it("captures repairer errors and reports ok=false", async () => {
    const r: Repairer = {
      id: "boom",
      matches: () => true,
      run: async () => {
        await Promise.resolve();
        throw new Error("kaboom");
      },
    };
    const outcome = await applyRepairs(reportWithRepairableFailure, [r]);
    assertEquals(outcome.attempted.length, 1);
    assertEquals(outcome.attempted[0]!.ok, false);
    assertEquals(outcome.attempted[0]!.message?.includes("kaboom"), true);
  });
});
