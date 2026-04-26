import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { runDoctor } from "../../../src/doctor/engine.ts";
import type { Check, Section } from "../../../src/doctor/types.ts";

const emptySection: Section = { id: "ingest", checks: [] };

describe("runDoctor — empty section", () => {
  it("returns ok=true with zero checks", async () => {
    const report = await runDoctor({ section: emptySection });
    assertEquals(report.schemaVersion, 1);
    assertEquals(report.section, "ingest");
    assertEquals(report.ok, true);
    assertEquals(report.checks.length, 0);
    assertEquals(report.summary.passed, 0);
    assertEquals(report.summary.failed, 0);
    assert(report.generatedAt.length > 0);
  });
});

describe("runDoctor — single passing check", () => {
  it("runs the check and counts passed=1", async () => {
    const check: Check = {
      id: "fake.ok",
      level: "A",
      run: () =>
        Promise.resolve({
          id: "fake.ok",
          level: "A",
          status: "passed",
          message: "ok",
          durationMs: 0,
        }),
    };
    const section: Section = { id: "ingest", checks: [check] };
    const report = await runDoctor({ section });
    assertEquals(report.checks.length, 1);
    assertEquals(report.checks[0]!.id, "fake.ok");
    assertEquals(report.summary.passed, 1);
    assertEquals(report.summary.failed, 0);
    assertEquals(report.ok, true);
    assert(report.checks[0]!.durationMs >= 0);
  });
});

describe("runDoctor — single failing check", () => {
  it("flips ok=false and counts failed=1", async () => {
    const check: Check = {
      id: "fake.fail",
      level: "A",
      run: () =>
        Promise.resolve({
          id: "fake.fail",
          level: "A",
          status: "failed",
          message: "nope",
          durationMs: 0,
        }),
    };
    const report = await runDoctor({
      section: { id: "ingest", checks: [check] },
    });
    assertEquals(report.summary.failed, 1);
    assertEquals(report.summary.passed, 0);
    assertEquals(report.ok, false);
  });
});

describe("runDoctor — dependency skip", () => {
  it("skips a dependent check when its requires has failed", async () => {
    const failingParent: Check = {
      id: "parent",
      level: "A",
      run: () =>
        Promise.resolve({
          id: "parent",
          level: "A",
          status: "failed",
          message: "broken",
          durationMs: 0,
        }),
    };
    const dependent: Check = {
      id: "child",
      level: "B",
      requires: ["parent"],
      run: () => {
        throw new Error("should not be called");
      },
    };
    const independent: Check = {
      id: "sibling",
      level: "A",
      run: () =>
        Promise.resolve({
          id: "sibling",
          level: "A",
          status: "passed",
          message: "ok",
          durationMs: 0,
        }),
    };
    const report = await runDoctor({
      section: {
        id: "ingest",
        checks: [failingParent, dependent, independent],
      },
    });

    const child = report.checks.find((c) => c.id === "child")!;
    assertEquals(child.status, "skipped");
    assertEquals(child.message, "skipped: dependency 'parent' failed");

    assertEquals(report.summary.failed, 1);
    assertEquals(report.summary.skipped, 1);
    assertEquals(report.summary.passed, 1);
    assertEquals(report.ok, false);
  });

  it("runs a dependent check when its requires has passed", async () => {
    const ok: Check = {
      id: "parent2",
      level: "A",
      run: () =>
        Promise.resolve({
          id: "parent2",
          level: "A",
          status: "passed",
          message: "ok",
          durationMs: 0,
        }),
    };
    let childRan = false;
    const child: Check = {
      id: "child2",
      level: "B",
      requires: ["parent2"],
      run: () => {
        childRan = true;
        return Promise.resolve({
          id: "child2",
          level: "B",
          status: "passed",
          message: "ok",
          durationMs: 0,
        });
      },
    };
    await runDoctor({ section: { id: "ingest", checks: [ok, child] } });
    assertEquals(childRan, true);
  });

  it("treats 'warning' as not-failed for dependency purposes", async () => {
    const warned: Check = {
      id: "parent3",
      level: "A",
      run: () =>
        Promise.resolve({
          id: "parent3",
          level: "A",
          status: "warning",
          message: "minor",
          durationMs: 0,
        }),
    };
    let childRan = false;
    const child: Check = {
      id: "child3",
      level: "B",
      requires: ["parent3"],
      run: () => {
        childRan = true;
        return Promise.resolve({
          id: "child3",
          level: "B",
          status: "passed",
          message: "ok",
          durationMs: 0,
        });
      },
    };
    await runDoctor({ section: { id: "ingest", checks: [warned, child] } });
    assertEquals(childRan, true);
  });
});
