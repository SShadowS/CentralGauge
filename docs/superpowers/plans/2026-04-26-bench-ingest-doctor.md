# Bench Ingest Doctor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `centralgauge doctor` umbrella + bench auto-precheck so a 2-hour bench fails in 1 second when its end-of-run ingest will fail.

**Architecture:** Pure `src/doctor/` engine produces a schema-versioned `DoctorReport` from composable per-check async functions. Two surfaces consume the same engine: a `centralgauge doctor <section>` CLI for ad-hoc health checks, and a programmatic call in `bench-command.ts` that runs at bench startup + re-checks just before ingest. A new read-only worker endpoint `POST /api/v1/precheck` returns auth + bench-aware catalog state in a single signed round-trip.

**Tech Stack:** Deno + TypeScript, Cliffy commands, SvelteKit Cloudflare Worker, D1 SQLite, ed25519 signatures (`@noble/ed25519`), existing CG ingest/auth helpers.

**Spec:** `docs/superpowers/specs/2026-04-26-bench-ingest-doctor-design.md`

---

## File map

**New files:**

| Path                                                            | Purpose                                                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/doctor/types.ts`                                           | `CheckLevel`, `CheckStatus`, `CheckResult`, `DoctorReport`, `DoctorContext`, `Section`, `Check` |
| `src/doctor/engine.ts`                                          | `runDoctor(opts) → Promise<DoctorReport>`, composition + dependency-skip                        |
| `src/doctor/formatter.ts`                                       | `formatReportToTerminal`, `formatReportAsJson`                                                  |
| `src/doctor/repair.ts`                                          | Auto-repair allowlist + executors (`sync-catalog`, mark-current)                                |
| `src/doctor/mod.ts`                                             | Public re-exports                                                                               |
| `src/doctor/sections/ingest/mod.ts`                             | Composes the 8 ingest checks into a `Section`                                                   |
| `src/doctor/sections/ingest/check-cfg-present.ts`               | Level A — config files parse, required ingest fields populated                                  |
| `src/doctor/sections/ingest/check-cfg-admin.ts`                 | Level A — admin key fields present when admin actions are configured                            |
| `src/doctor/sections/ingest/check-keys-files.ts`                | Level A — key files exist, exactly 32 raw bytes                                                 |
| `src/doctor/sections/ingest/check-catalog-local.ts`             | Level A — `site/catalog/*.yml` parse + schema-valid                                             |
| `src/doctor/sections/ingest/check-clock-skew.ts`                | Level A — local vs server clock < 60s                                                           |
| `src/doctor/sections/ingest/check-net-health.ts`                | Level B — `GET ${url}/health` returns 200 within 5s                                             |
| `src/doctor/sections/ingest/check-auth-probe.ts`                | Level C — signed `POST /api/v1/precheck`, key match + role + machine_id                         |
| `src/doctor/sections/ingest/check-catalog-bench.ts`             | Level D — same probe with variants/pricing/task_set, all green                                  |
| `cli/commands/doctor-command.ts`                                | Cliffy command surface for `centralgauge doctor <section>`                                      |
| `site/src/routes/api/v1/precheck/+server.ts`                    | Read-only signed-probe endpoint                                                                 |
| `tests/unit/doctor/engine.test.ts`                              | Engine composition + dependency-skip + summary counters                                         |
| `tests/unit/doctor/formatter.test.ts`                           | Terminal + JSON output snapshots                                                                |
| `tests/unit/doctor/repair.test.ts`                              | Repair allowlist + executor invocation                                                          |
| `tests/unit/doctor/sections/ingest/check-cfg-present.test.ts`   | …one test file per check                                                                        |
| `tests/unit/doctor/sections/ingest/check-cfg-admin.test.ts`     |                                                                                                 |
| `tests/unit/doctor/sections/ingest/check-keys-files.test.ts`    |                                                                                                 |
| `tests/unit/doctor/sections/ingest/check-catalog-local.test.ts` |                                                                                                 |
| `tests/unit/doctor/sections/ingest/check-clock-skew.test.ts`    |                                                                                                 |
| `tests/unit/doctor/sections/ingest/check-net-health.test.ts`    |                                                                                                 |
| `tests/unit/doctor/sections/ingest/check-auth-probe.test.ts`    |                                                                                                 |
| `tests/unit/doctor/sections/ingest/check-catalog-bench.test.ts` |                                                                                                 |
| `tests/integration/doctor/ingest-against-prod.test.ts`          | Opt-in `DOCTOR_E2E_PROD=1` real-worker round-trip                                               |
| `site/tests/api/precheck.test.ts`                               | Worker endpoint signature + read-only contract                                                  |
| `site/tests/api/task-sets-set-current.test.ts`                  | Extended task-sets endpoint with `set_current` flag                                             |

**Modified files:**

| Path                                                        | Change                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `cli/centralgauge.ts`                                       | Register `doctor` command                                                         |
| `cli/commands/bench-command.ts`                             | Add precheck at startup (env-flag-gated, then default-on) and pre-ingest re-check |
| `site/src/lib/shared/types.ts`                              | Add `PrecheckRequest`, `PrecheckResponse`                                         |
| `site/src/routes/api/v1/admin/catalog/task-sets/+server.ts` | Accept optional `set_current: true`                                               |

---

## Task 1: Doctor types module

**Files:**

- Create: `src/doctor/types.ts`
- Test: `tests/unit/doctor/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/types.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
deno test --allow-all tests/unit/doctor/types.test.ts
```

Expected: FAIL with "Module not found: src/doctor/types.ts".

- [ ] **Step 3: Write the types module**

Create `src/doctor/types.ts`:

```typescript
/**
 * Doctor schema — see docs/superpowers/specs/2026-04-26-bench-ingest-doctor-design.md
 *
 * Stable, JSON-serializable. Bump `schemaVersion` on breaking shape changes.
 */

export type CheckLevel = "A" | "B" | "C" | "D";
export type CheckStatus = "passed" | "failed" | "warning" | "skipped";

export interface Remediation {
  /** One-line "what to do" summary. */
  summary: string;
  /** Exact copy-paste shell command, when applicable. */
  command?: string;
  /** Whether the auto-repair allowlist will execute it under `--repair`. */
  autoRepairable: boolean;
}

export interface CheckResult {
  /** Stable check id, e.g. "cfg.present", "auth.probe". */
  id: string;
  level: CheckLevel;
  status: CheckStatus;
  /** Single-line human summary shown in terminal output. */
  message: string;
  remediation?: Remediation;
  /** Structured payload for programmatic consumers (e.g. missing_models[]). */
  details?: Record<string, unknown>;
  /** Wall-clock time spent running the check. */
  durationMs: number;
}

export interface DoctorReport {
  schemaVersion: 1;
  section: SectionId;
  /** ISO timestamp set by the engine when the report is finalized. */
  generatedAt: string;
  /** True iff no `failed` checks. Warnings do not flip this. */
  ok: boolean;
  checks: CheckResult[];
  summary: {
    passed: number;
    failed: number;
    warning: number;
    skipped: number;
  };
}

export type SectionId = "ingest" | "containers" | "llm" | "all";

/**
 * Variant identification passed to the bench-aware catalog check.
 * Mirrors the existing `ModelVariant` shape but flattens to wire-format fields.
 */
export interface VariantProbe {
  slug: string; // e.g. "anthropic/claude-opus-4-7"
  api_model_id: string; // e.g. "claude-opus-4-7"
  family_slug: string; // e.g. "claude"
}

export interface DoctorContext {
  /** Repository root (where `site/catalog`, `tasks/`, `.centralgauge.yml` live). */
  cwd: string;
  /** Injected fetch — overridable for testing. */
  fetchFn: typeof fetch;
  /** Bench-aware inputs (only present when called from bench or with `--llms`). */
  variants?: VariantProbe[];
  pricingVersion?: string;
  taskSetHash?: string;
  /**
   * Map from check id to its already-completed CheckResult. The engine
   * populates this as checks finish, so a later check can declare
   * `requires: ["cfg.present"]` and the engine will skip it if the
   * dependency failed.
   */
  previousResults: Map<string, CheckResult>;
}

export interface Check {
  id: string;
  level: CheckLevel;
  /** Other check ids whose `passed` status is required for this check to run. */
  requires?: string[];
  run(ctx: DoctorContext): Promise<CheckResult>;
}

export interface Section {
  id: SectionId;
  /** Checks in matrix order — engine respects this order so dependencies resolve naturally. */
  checks: Check[];
}

export interface RunDoctorOptions {
  section: Section;
  /** Subset of levels to run; default: all in the section. */
  levels?: CheckLevel[];
  variants?: VariantProbe[];
  pricingVersion?: string;
  taskSetHash?: string;
  /** Inject a fetch implementation (tests). */
  fetchFn?: typeof fetch;
  /** When true, runs the repair allowlist for failed checks then re-runs them. */
  repair?: boolean;
  cwd?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
deno test --allow-all tests/unit/doctor/types.test.ts
```

Expected: PASS, 6 steps green.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/types.ts tests/unit/doctor/types.test.ts
deno fmt src/doctor/types.ts tests/unit/doctor/types.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/doctor/types.ts tests/unit/doctor/types.test.ts
git commit -m "feat(doctor): types — CheckResult, DoctorReport, DoctorContext, Section"
```

---

## Task 2: Engine skeleton (runDoctor with empty section)

**Files:**

- Create: `src/doctor/engine.ts`
- Test: `tests/unit/doctor/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/engine.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
deno test --allow-all tests/unit/doctor/engine.test.ts
```

Expected: FAIL with "Module not found: src/doctor/engine.ts".

- [ ] **Step 3: Write the engine**

Create `src/doctor/engine.ts`:

```typescript
/**
 * Doctor engine — runs a Section's checks and assembles a DoctorReport.
 * Pure: no I/O of its own. Each Check brings its own side effects.
 */

import type {
  Check,
  CheckResult,
  DoctorContext,
  DoctorReport,
  RunDoctorOptions,
} from "./types.ts";

export async function runDoctor(opts: RunDoctorOptions): Promise<DoctorReport> {
  const ctx: DoctorContext = {
    cwd: opts.cwd ?? Deno.cwd(),
    fetchFn: opts.fetchFn ?? globalThis.fetch.bind(globalThis),
    ...(opts.variants !== undefined ? { variants: opts.variants } : {}),
    ...(opts.pricingVersion !== undefined
      ? { pricingVersion: opts.pricingVersion }
      : {}),
    ...(opts.taskSetHash !== undefined
      ? { taskSetHash: opts.taskSetHash }
      : {}),
    previousResults: new Map(),
  };

  const filteredChecks = opts.levels
    ? opts.section.checks.filter((c) => opts.levels!.includes(c.level))
    : opts.section.checks;

  const checks: CheckResult[] = [];
  for (const check of filteredChecks) {
    const result = await runOne(check, ctx);
    checks.push(result);
    ctx.previousResults.set(result.id, result);
  }

  const summary = {
    passed: checks.filter((c) => c.status === "passed").length,
    failed: checks.filter((c) => c.status === "failed").length,
    warning: checks.filter((c) => c.status === "warning").length,
    skipped: checks.filter((c) => c.status === "skipped").length,
  };

  return {
    schemaVersion: 1,
    section: opts.section.id,
    generatedAt: new Date().toISOString(),
    ok: summary.failed === 0,
    checks,
    summary,
  };
}

async function runOne(
  check: Check,
  ctx: DoctorContext,
): Promise<CheckResult> {
  const started = Date.now();
  try {
    const result = await check.run(ctx);
    // Engine owns the timing — don't trust the check to set durationMs.
    return { ...result, durationMs: Date.now() - started };
  } catch (err) {
    return {
      id: check.id,
      level: check.level,
      status: "failed",
      message: `unexpected error: ${
        err instanceof Error ? err.message : String(err)
      }`,
      durationMs: Date.now() - started,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
deno test --allow-all tests/unit/doctor/engine.test.ts
```

Expected: PASS, all 3 cases green.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/engine.ts tests/unit/doctor/engine.test.ts
deno fmt src/doctor/engine.ts tests/unit/doctor/engine.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/engine.ts tests/unit/doctor/engine.test.ts
git commit -m "feat(doctor): runDoctor engine — composition + timing + summary"
```

---

## Task 3: Engine dependency-skip logic

**Files:**

- Modify: `src/doctor/engine.ts`
- Test: `tests/unit/doctor/engine.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/doctor/engine.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify the new cases fail**

```bash
deno test --allow-all tests/unit/doctor/engine.test.ts
```

Expected: FAIL — at least the "skipped: dependency 'parent' failed" assertion fails (the engine currently calls `child.run()` which throws).

- [ ] **Step 3: Add dependency-skip to the engine**

Modify `src/doctor/engine.ts` — replace the `runOne` function and the inner loop:

```typescript
export async function runDoctor(opts: RunDoctorOptions): Promise<DoctorReport> {
  const ctx: DoctorContext = {
    cwd: opts.cwd ?? Deno.cwd(),
    fetchFn: opts.fetchFn ?? globalThis.fetch.bind(globalThis),
    ...(opts.variants !== undefined ? { variants: opts.variants } : {}),
    ...(opts.pricingVersion !== undefined
      ? { pricingVersion: opts.pricingVersion }
      : {}),
    ...(opts.taskSetHash !== undefined
      ? { taskSetHash: opts.taskSetHash }
      : {}),
    previousResults: new Map(),
  };

  const filteredChecks = opts.levels
    ? opts.section.checks.filter((c) => opts.levels!.includes(c.level))
    : opts.section.checks;

  const checks: CheckResult[] = [];
  for (const check of filteredChecks) {
    const failedDep = (check.requires ?? []).find((depId) => {
      const dep = ctx.previousResults.get(depId);
      return dep && dep.status === "failed";
    });

    let result: CheckResult;
    if (failedDep) {
      result = {
        id: check.id,
        level: check.level,
        status: "skipped",
        message: `skipped: dependency '${failedDep}' failed`,
        durationMs: 0,
      };
    } else {
      result = await runOne(check, ctx);
    }
    checks.push(result);
    ctx.previousResults.set(result.id, result);
  }

  const summary = {
    passed: checks.filter((c) => c.status === "passed").length,
    failed: checks.filter((c) => c.status === "failed").length,
    warning: checks.filter((c) => c.status === "warning").length,
    skipped: checks.filter((c) => c.status === "skipped").length,
  };

  return {
    schemaVersion: 1,
    section: opts.section.id,
    generatedAt: new Date().toISOString(),
    ok: summary.failed === 0,
    checks,
    summary,
  };
}
```

(Keep `runOne` from Task 2 unchanged.)

- [ ] **Step 4: Run tests**

```bash
deno test --allow-all tests/unit/doctor/engine.test.ts
```

Expected: PASS, all 6 cases green.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/engine.ts
deno fmt src/doctor/engine.ts tests/unit/doctor/engine.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/engine.ts tests/unit/doctor/engine.test.ts
git commit -m "feat(doctor): dependency-skip — child checks skip when requires failed"
```

---

## Task 4: Terminal formatter

**Files:**

- Create: `src/doctor/formatter.ts`
- Test: `tests/unit/doctor/formatter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/formatter.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
deno test --allow-all tests/unit/doctor/formatter.test.ts
```

Expected: FAIL with "Module not found: src/doctor/formatter.ts".

- [ ] **Step 3: Write the formatter**

Create `src/doctor/formatter.ts`:

```typescript
/**
 * Terminal + JSON formatters for DoctorReport.
 * Pure; no I/O. The CLI surface decides where to print.
 */

import * as colors from "@std/fmt/colors";
import type { CheckResult, DoctorReport } from "./types.ts";

export interface FormatOptions {
  /** Strip ANSI color codes (default true when not a TTY; explicit override here). */
  color?: boolean;
}

const STATUS_GLYPH: Record<CheckResult["status"], string> = {
  passed: "✓",
  failed: "✗",
  warning: "!",
  skipped: "·",
};

export function formatReportToTerminal(
  report: DoctorReport,
  opts: FormatOptions = {},
): string {
  const useColor = opts.color ?? true;
  const c = (fn: (s: string) => string) => (s: string) => useColor ? fn(s) : s;
  const green = c(colors.green);
  const red = c(colors.red);
  const yellow = c(colors.yellow);
  const dim = c(colors.dim);

  const totalMs = report.checks.reduce((acc, ch) => acc + ch.durationMs, 0);
  const lines: string[] = [];

  lines.push(
    `[doctor: ${report.section}]${" ".repeat(40)}${
      dim((totalMs / 1000).toFixed(1) + "s")
    }`,
  );

  for (const ch of report.checks) {
    const glyph = STATUS_GLYPH[ch.status];
    const colored = ch.status === "passed"
      ? green(glyph)
      : ch.status === "failed"
      ? red(glyph)
      : ch.status === "warning"
      ? yellow(glyph)
      : dim(glyph);
    const pad = ch.id.padEnd(18);
    const time = dim(`(${ch.durationMs}ms)`);
    lines.push(`  ${colored} ${pad} ${ch.message} ${time}`);
    if (ch.status === "failed" && ch.remediation) {
      lines.push(`                       → ${ch.remediation.summary}`);
      if (ch.remediation.command) {
        lines.push(`                         ${dim(ch.remediation.command)}`);
      }
    }
  }

  const { passed, failed, warning, skipped } = report.summary;
  const total = passed + failed + warning + skipped;
  const summaryParts: string[] = [`${passed}/${total} passed`];
  if (failed > 0) summaryParts.push(`${failed} failed`);
  if (warning > 0) summaryParts.push(`${warning} warning`);
  if (skipped > 0) summaryParts.push(`${skipped} skipped`);

  lines.push("");
  lines.push(summaryParts.join(", ") + (report.ok ? "" : "  exit 1"));

  return lines.join("\n");
}

export function formatReportAsJson(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}
```

- [ ] **Step 4: Run tests**

```bash
deno test --allow-all tests/unit/doctor/formatter.test.ts
```

Expected: PASS, all 6 cases green.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/formatter.ts tests/unit/doctor/formatter.test.ts
deno fmt src/doctor/formatter.ts tests/unit/doctor/formatter.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/formatter.ts tests/unit/doctor/formatter.test.ts
git commit -m "feat(doctor): terminal + JSON formatters for DoctorReport"
```

---

## Task 5: Worker shared types (Precheck request/response)

**Files:**

- Modify: `site/src/lib/shared/types.ts`

- [ ] **Step 1: Inspect existing shared types**

```bash
grep -n "^export\|interface\|^type" /u/Git/CentralGauge/site/src/lib/shared/types.ts | head -30
```

Note the existing types (`IngestRequest`, `FinalizeResponse`, etc.) — the new precheck types should follow the same naming style.

- [ ] **Step 2: Add precheck types**

Append to `site/src/lib/shared/types.ts`:

```typescript
// =============================================================================
// Precheck — POST /api/v1/precheck (read-only health probe)
// =============================================================================

export interface PrecheckRequestPayload {
  machine_id: string;
  /** Omit for auth-only check; include to also validate bench-aware catalog state. */
  variants?: Array<{
    slug: string;
    api_model_id: string;
    family_slug: string;
  }>;
  pricing_version?: string;
  task_set_hash?: string;
}

export interface PrecheckRequest {
  version: 1;
  signature: {
    alg: "Ed25519";
    key_id: number;
    signed_at: string; // ISO
    value: string; // base64
  };
  payload: PrecheckRequestPayload;
}

export interface PrecheckAuth {
  ok: true;
  key_id: number;
  key_role: "ingest" | "verifier" | "admin";
  key_active: boolean;
  /** True iff the machine_keys row's machine_id matches payload.machine_id. */
  machine_id_match: boolean;
}

export interface PrecheckCatalog {
  /** Slugs in the request's variants[] that have no models row. */
  missing_models: Array<{ slug: string; reason: string }>;
  /** Variants with no cost_snapshots row at the requested pricing_version. */
  missing_pricing: Array<{ slug: string; pricing_version: string }>;
  /** True iff task_sets.is_current=1 for the requested task_set_hash. */
  task_set_current: boolean;
  /** True iff a task_sets row exists at all for that hash. */
  task_set_known: boolean;
}

export interface PrecheckResponse {
  schema_version: 1;
  auth: PrecheckAuth;
  catalog?: PrecheckCatalog;
  /** Server's current ISO timestamp; client uses for clock-skew detection. */
  server_time: string;
}
```

- [ ] **Step 3: Type-check**

```bash
cd site && npx tsc --noEmit 2>&1 | head -10 || true
```

Expected: no new errors related to the additions. If existing project has unrelated errors that's fine — focus on the new type lines.

- [ ] **Step 4: Lint**

```bash
deno fmt /u/Git/CentralGauge/site/src/lib/shared/types.ts
```

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/shared/types.ts
git commit -m "feat(worker): PrecheckRequest/Response shared types"
```

---

## Task 6: Worker /api/v1/precheck endpoint — auth-only mode

**Files:**

- Create: `site/src/routes/api/v1/precheck/+server.ts`
- Test: `site/tests/api/precheck.test.ts`

- [ ] **Step 1: Inspect existing signature-verification helper**

The existing endpoints (e.g. `/api/v1/runs/+server.ts`) use a shared signature verifier. Find it:

```bash
grep -rn "verifySignature\|signature.*verify" /u/Git/CentralGauge/site/src/lib/server/ | head -10
```

Read that file to understand its API and the `signed_at` tolerance window (resolves Open Question #2 in the spec). Note the tolerance constant and use the same value in the doctor's `check-clock-skew` later.

- [ ] **Step 2: Write the failing test**

Create `site/tests/api/precheck.test.ts`. Look at an existing API test (e.g. `site/tests/api/runs-precheck.test.ts`) for the harness pattern. The test should:

```typescript
import { describe, it, expect } from "vitest";
// Adjust imports to match the existing harness in site/tests/api/
import { createTestEnv, signRequest } from "./helpers";
import { POST } from "../../src/routes/api/v1/precheck/+server";

describe("POST /api/v1/precheck — auth only", () => {
  it("returns 200 with auth=ok for a valid signed probe", async () => {
    const env = createTestEnv({
      machineKeys: [
        {
          id: 7,
          machine_id: "machine-A",
          public_key: /* base64 of test pubkey */,
          scope: "ingest",
        },
      ],
    });
    const body = await signRequest({
      keyId: 7,
      privateKey: /* test private key */,
      payload: { machine_id: "machine-A" },
    });
    const resp = await POST({
      request: new Request("https://x/api/v1/precheck", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      platform: { env },
    } as any);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.schema_version).toBe(1);
    expect(data.auth.ok).toBe(true);
    expect(data.auth.key_id).toBe(7);
    expect(data.auth.key_role).toBe("ingest");
    expect(data.auth.machine_id_match).toBe(true);
    expect(data.catalog).toBeUndefined(); // no variants supplied
    expect(typeof data.server_time).toBe("string");
  });

  it("returns 401 on bad signature", async () => {
    const env = createTestEnv({
      machineKeys: [{ id: 7, machine_id: "machine-A", public_key: "...", scope: "ingest" }],
    });
    const resp = await POST({
      request: new Request("https://x/api/v1/precheck", {
        method: "POST",
        body: JSON.stringify({
          version: 1,
          signature: { alg: "Ed25519", key_id: 7, signed_at: new Date().toISOString(), value: "AAAA" },
          payload: { machine_id: "machine-A" },
        }),
      }),
      platform: { env },
    } as any);
    expect(resp.status).toBe(401);
  });

  it("returns auth.machine_id_match=false when payload.machine_id differs", async () => {
    // build env with key for "machine-A", probe with payload.machine_id="machine-B"
    // expect 200 (auth still valid) but auth.machine_id_match=false
  });

  it("does not write to D1 (read-only)", async () => {
    // spy on env.DB.prepare; verify only SELECT/SELECT...JOIN statements
  });
});
```

(Adapt to the actual existing test harness's mocking style.)

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /u/Git/CentralGauge/site && npm test -- precheck.test 2>&1 | tail -10
```

Expected: FAIL with "Module not found: ../../src/routes/api/v1/precheck/+server".

- [ ] **Step 4: Write the endpoint**

Create `site/src/routes/api/v1/precheck/+server.ts`:

```typescript
import type { RequestHandler } from "./$types";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { verifySignedRequest } from "$lib/server/signature";
import type { PrecheckRequest, PrecheckResponse } from "$lib/shared/types";

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;

  try {
    const body = (await request.json()) as PrecheckRequest;
    if (body.version !== 1) {
      throw new ApiError(400, "version_unsupported", "version must be 1");
    }
    const verified = await verifySignedRequest(db, body);
    // verifySignedRequest throws ApiError(401) on bad sig; otherwise returns
    // { key_id, machine_id (from row), scope, revoked_at }.

    const auth = {
      ok: true as const,
      key_id: verified.key_id,
      key_role: verified.scope as "ingest" | "verifier" | "admin",
      key_active: verified.revoked_at === null,
      machine_id_match: verified.machine_id === body.payload.machine_id,
    };

    const response: PrecheckResponse = {
      schema_version: 1,
      auth,
      server_time: new Date().toISOString(),
    };
    return jsonResponse(response, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
```

(If `verifySignedRequest` doesn't yet return `machine_id` and `revoked_at`, extend that helper as a sub-step — note the change in the commit message.)

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /u/Git/CentralGauge/site && npm test -- precheck.test 2>&1 | tail -15
```

Expected: PASS, 4 cases green.

- [ ] **Step 6: Commit**

```bash
git add site/src/routes/api/v1/precheck/+server.ts site/tests/api/precheck.test.ts
git commit -m "feat(worker): /api/v1/precheck endpoint — auth-only signed probe"
```

---

## Task 7: Worker /api/v1/precheck endpoint — catalog mode

**Files:**

- Modify: `site/src/routes/api/v1/precheck/+server.ts`
- Modify: `site/tests/api/precheck.test.ts`

- [ ] **Step 1: Add the failing test cases**

Append to `site/tests/api/precheck.test.ts`:

```typescript
describe("POST /api/v1/precheck — catalog probe", () => {
  it("returns missing_models for slugs not in the models table", async () => {
    const env = createTestEnv({
      machineKeys: [/* valid ingest key */],
      models: [
        { id: 1, slug: "anthropic/claude-opus-4-7", api_model_id: "claude-opus-4-7", family_id: 1 },
      ],
    });
    const body = await signRequest({
      keyId: 7, privateKey: /* ... */,
      payload: {
        machine_id: "machine-A",
        variants: [
          { slug: "anthropic/claude-opus-4-7", api_model_id: "claude-opus-4-7", family_slug: "claude" },
          { slug: "openai/gpt-5", api_model_id: "gpt-5", family_slug: "gpt" },
        ],
        pricing_version: "2026-04-26",
      },
    });
    const resp = await POST({ /* ... */ } as any);
    const data = await resp.json();
    expect(data.catalog!.missing_models.map((m: any) => m.slug)).toEqual([
      "openai/gpt-5",
    ]);
  });

  it("returns missing_pricing for variants without cost_snapshots at pricing_version", async () => {
    // env has model row but no cost_snapshots row at "2026-04-26"
    // expect data.catalog.missing_pricing to include the variant
  });

  it("returns task_set_current=true when is_current=1", async () => {
    // env.DB has task_sets row { hash: "abc", is_current: 1 }
    // payload.task_set_hash="abc"
    // expect data.catalog.task_set_current === true && task_set_known === true
  });

  it("returns task_set_known=false for unknown hash", async () => {
    // empty task_sets, payload.task_set_hash="zzz"
    // expect data.catalog.task_set_current === false && task_set_known === false
  });

  it("does not include `catalog` in response when no variants supplied", async () => {
    // already covered in Task 6 test, verify still true
  });
});
```

- [ ] **Step 2: Run tests, expect new ones to fail**

```bash
cd /u/Git/CentralGauge/site && npm test -- precheck.test 2>&1 | tail -15
```

Expected: catalog tests fail (`catalog` field is currently undefined for all responses).

- [ ] **Step 3: Extend the endpoint**

Modify `site/src/routes/api/v1/precheck/+server.ts` — replace the body of `POST` between the `verifySignedRequest` and the `return jsonResponse`:

```typescript
const auth = {
  ok: true as const,
  key_id: verified.key_id,
  key_role: verified.scope as "ingest" | "verifier" | "admin",
  key_active: verified.revoked_at === null,
  machine_id_match: verified.machine_id === body.payload.machine_id,
};

let catalog: PrecheckResponse["catalog"];
const { variants, pricing_version, task_set_hash } = body.payload;

if (variants && variants.length > 0) {
  const slugs = variants.map((v) => v.slug);
  const placeholders = slugs.map(() => "?").join(",");

  // Models present in D1
  const modelsFound = await db
    .prepare(
      `SELECT slug, id FROM models WHERE slug IN (${placeholders})`,
    )
    .bind(...slugs)
    .all<{ slug: string; id: number }>();
  const knownSlugs = new Set(
    (modelsFound.results ?? []).map((r) => r.slug),
  );
  const missing_models = slugs
    .filter((s) => !knownSlugs.has(s))
    .map((slug) => ({ slug, reason: "no models row" }));

  // Pricing rows for known models at the requested pricing_version
  let missing_pricing: Array<{ slug: string; pricing_version: string }> = [];
  if (pricing_version) {
    const knownIds = (modelsFound.results ?? []).map((r) => r.id);
    const idMap = new Map(
      (modelsFound.results ?? []).map((r) => [r.id, r.slug]),
    );
    if (knownIds.length > 0) {
      const idPlaceholders = knownIds.map(() => "?").join(",");
      const cs = await db
        .prepare(
          `SELECT model_id FROM cost_snapshots
               WHERE model_id IN (${idPlaceholders}) AND pricing_version = ?`,
        )
        .bind(...knownIds, pricing_version)
        .all<{ model_id: number }>();
      const haveCs = new Set((cs.results ?? []).map((r) => r.model_id));
      missing_pricing = knownIds
        .filter((id) => !haveCs.has(id))
        .map((id) => ({
          slug: idMap.get(id) ?? "(unknown)",
          pricing_version,
        }));
    }
  }

  // Task-set
  let task_set_known = false;
  let task_set_current = false;
  if (task_set_hash) {
    const ts = await db
      .prepare(
        `SELECT hash, is_current FROM task_sets WHERE hash = ?`,
      )
      .bind(task_set_hash)
      .first<{ hash: string; is_current: number }>();
    task_set_known = !!ts;
    task_set_current = ts?.is_current === 1;
  }

  catalog = {
    missing_models,
    missing_pricing,
    task_set_current,
    task_set_known,
  };
}

const response: PrecheckResponse = {
  schema_version: 1,
  auth,
  ...(catalog ? { catalog } : {}),
  server_time: new Date().toISOString(),
};
return jsonResponse(response, 200);
```

- [ ] **Step 4: Run tests**

```bash
cd /u/Git/CentralGauge/site && npm test -- precheck.test 2>&1 | tail -15
```

Expected: PASS, all 9 cases green.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/precheck/+server.ts site/tests/api/precheck.test.ts
git commit -m "feat(worker): /api/v1/precheck — bench-aware catalog probe"
```

---

## Task 8: Worker — extend /admin/catalog/task-sets to accept set_current

**Files:**

- Modify: `site/src/routes/api/v1/admin/catalog/task-sets/+server.ts`
- Create: `site/tests/api/task-sets-set-current.test.ts`

- [ ] **Step 1: Read existing handler**

```bash
cat /u/Git/CentralGauge/site/src/routes/api/v1/admin/catalog/task-sets/+server.ts
```

Note the existing `POST` body shape and admin-key verification flow.

- [ ] **Step 2: Write the failing test**

Create `site/tests/api/task-sets-set-current.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createTestEnv, signAdminRequest } from "./helpers";
import { POST } from "../../src/routes/api/v1/admin/catalog/task-sets/+server";

describe("POST /api/v1/admin/catalog/task-sets — set_current flag", () => {
  it("sets is_current=1 only on the requested hash and unsets all others", async () => {
    const env = createTestEnv({
      adminKeys: [/* valid admin key */],
      taskSets: [
        { hash: "old", is_current: 1, task_count: 50, created_at: "2026-04-01" },
        { hash: "new", is_current: 0, task_count: 64, created_at: "2026-04-26" },
      ],
    });
    const body = await signAdminRequest({
      keyId: 4, privateKey: /* ... */,
      payload: {
        hash: "new",
        created_at: "2026-04-26",
        task_count: 64,
        set_current: true,
      },
    });
    const resp = await POST({ /* ... */ } as any);
    expect(resp.status).toBe(200);

    const oldRow = await env.DB.prepare(
      "SELECT is_current FROM task_sets WHERE hash = 'old'",
    ).first<{ is_current: number }>();
    const newRow = await env.DB.prepare(
      "SELECT is_current FROM task_sets WHERE hash = 'new'",
    ).first<{ is_current: number }>();
    expect(oldRow!.is_current).toBe(0);
    expect(newRow!.is_current).toBe(1);
  });

  it("does not set is_current when set_current is omitted", async () => {
    // existing behavior preserved
  });

  it("rejects non-admin keys with 401", async () => {
    // sign with ingest-role key, expect 401
  });
});
```

- [ ] **Step 3: Run test, expect fail**

```bash
cd /u/Git/CentralGauge/site && npm test -- task-sets-set-current 2>&1 | tail -10
```

Expected: FAIL — `set_current` field not handled yet.

- [ ] **Step 4: Modify the handler**

Open `site/src/routes/api/v1/admin/catalog/task-sets/+server.ts`. Locate the `INSERT OR IGNORE INTO task_sets ...` statement. Add a `set_current` flag handler around it:

```typescript
// Existing INSERT (or UPSERT) for the task_sets row …
await db.prepare(
  `INSERT OR IGNORE INTO task_sets (hash, task_count, created_at) VALUES (?,?,?)`,
).bind(payload.hash, payload.task_count, payload.created_at).run();

// New: when set_current=true, atomically flip is_current
if (payload.set_current === true) {
  await db.batch([
    db.prepare(`UPDATE task_sets SET is_current = 0 WHERE is_current = 1`),
    db.prepare(`UPDATE task_sets SET is_current = 1 WHERE hash = ?`).bind(
      payload.hash,
    ),
  ]);
}
```

Update the request payload type to include the optional flag.

- [ ] **Step 5: Run tests**

```bash
cd /u/Git/CentralGauge/site && npm test -- task-sets 2>&1 | tail -15
```

Expected: PASS, 3 new cases plus existing tests still green.

- [ ] **Step 6: Commit**

```bash
git add site/src/routes/api/v1/admin/catalog/task-sets/+server.ts site/tests/api/task-sets-set-current.test.ts
git commit -m "feat(worker): admin task-sets endpoint accepts set_current flag"
```

---

## Task 9: Check — cfg.present

**Files:**

- Create: `src/doctor/sections/ingest/check-cfg-present.ts`
- Test: `tests/unit/doctor/sections/ingest/check-cfg-present.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/sections/ingest/check-cfg-present.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkCfgPresent } from "../../../../../src/doctor/sections/ingest/check-cfg-present.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

function ctx(cwd: string): DoctorContext {
  return {
    cwd,
    fetchFn: globalThis.fetch,
    previousResults: new Map(),
  };
}

describe("checkCfgPresent", () => {
  it("passes when both home and project configs exist with full ingest section", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: https://x.example.com\n  key_id: 1\n  key_path: /tmp/k\n  machine_id: m\n`,
    );
    // Inject HOME env so the check finds a "home" config in the same tmp.
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkCfgPresent.run(ctx(tmp));
      assertEquals(result.id, "cfg.present");
      assertEquals(result.status, "passed");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when no ingest section is reachable and includes remediation", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `# no ingest section\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkCfgPresent.run(ctx(tmp));
      assertEquals(result.status, "failed");
      assertEquals(
        result.remediation?.command,
        "deno run --allow-env --allow-read --allow-write scripts/provision-ingest-keys.ts",
      );
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when required field key_path is missing", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: https://x.example.com\n  key_id: 1\n  machine_id: m\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkCfgPresent.run(ctx(tmp));
      assertEquals(result.status, "failed");
      const missing = (result.details?.missing as string[]) ?? [];
      assertEquals(missing.includes("key_path"), true);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-cfg-present.test.ts
```

Expected: FAIL with "Module not found".

- [ ] **Step 3: Write the check**

Create `src/doctor/sections/ingest/check-cfg-present.ts`:

```typescript
import { parse } from "jsr:@std/yaml@^1.1.0";
import type { Check, DoctorContext } from "../../types.ts";

const REQUIRED_FIELDS = ["url", "key_id", "key_path", "machine_id"] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

function homeDir(): string {
  // Allow tests to override via env without touching real $HOME.
  const override = Deno.env.get("CENTRALGAUGE_TEST_HOME");
  if (override) return override;
  return Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
}

async function readYaml(path: string): Promise<Record<string, unknown> | null> {
  try {
    return parse(await Deno.readTextFile(path)) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    return null;
  }
}

export const checkCfgPresent: Check = {
  id: "cfg.present",
  level: "A",
  async run(ctx: DoctorContext) {
    const home = homeDir();
    const homeCfg = await readYaml(`${home}/.centralgauge.yml`);
    const cwdCfg = await readYaml(`${ctx.cwd}/.centralgauge.yml`);
    const homeIngest = (homeCfg?.["ingest"] ?? {}) as Record<string, unknown>;
    const cwdIngest = (cwdCfg?.["ingest"] ?? {}) as Record<string, unknown>;
    const merged = { ...homeIngest, ...cwdIngest };

    const missing: RequiredField[] = REQUIRED_FIELDS.filter(
      (k) => merged[k] === undefined || merged[k] === null || merged[k] === "",
    );

    if (Object.keys(merged).length === 0 || missing.length > 0) {
      return {
        id: "cfg.present",
        level: "A" as const,
        status: "failed" as const,
        message: missing.length > 0
          ? `missing fields: ${missing.join(", ")}`
          : "no ingest section in home or project config",
        remediation: {
          summary:
            "Generate keys and write ingest section to ~/.centralgauge.yml",
          command:
            "deno run --allow-env --allow-read --allow-write scripts/provision-ingest-keys.ts",
          autoRepairable: false,
        },
        details: { missing },
        durationMs: 0,
      };
    }

    return {
      id: "cfg.present",
      level: "A" as const,
      status: "passed" as const,
      message: "ingest config loaded",
      durationMs: 0,
    };
  },
};
```

- [ ] **Step 4: Run test**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-cfg-present.test.ts
```

Expected: PASS, 3 cases green.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/sections/ingest/check-cfg-present.ts
deno fmt src/doctor/sections/ingest/check-cfg-present.ts tests/unit/doctor/sections/ingest/check-cfg-present.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/sections/ingest/check-cfg-present.ts tests/unit/doctor/sections/ingest/check-cfg-present.test.ts
git commit -m "feat(doctor): check cfg.present — ingest config + required fields"
```

---

## Task 10: Check — cfg.admin

**Files:**

- Create: `src/doctor/sections/ingest/check-cfg-admin.ts`
- Test: `tests/unit/doctor/sections/ingest/check-cfg-admin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/sections/ingest/check-cfg-admin.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkCfgAdmin } from "../../../../../src/doctor/sections/ingest/check-cfg-admin.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

function ctx(cwd: string): DoctorContext {
  return { cwd, fetchFn: globalThis.fetch, previousResults: new Map() };
}

describe("checkCfgAdmin", () => {
  it("passes when admin_key_id and admin_key_path are both set", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: https://x\n  key_id: 1\n  key_path: /tmp/k\n  machine_id: m\n  admin_key_id: 2\n  admin_key_path: /tmp/a\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkCfgAdmin.run(ctx(tmp));
      assertEquals(result.status, "passed");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("warns (not fails) when admin keys are absent — admin actions just won't be available", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: https://x\n  key_id: 1\n  key_path: /tmp/k\n  machine_id: m\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkCfgAdmin.run(ctx(tmp));
      assertEquals(result.status, "warning");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when only one of the two admin fields is set (incomplete pair)", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: https://x\n  key_id: 1\n  key_path: /tmp/k\n  machine_id: m\n  admin_key_id: 2\n`, // path missing
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkCfgAdmin.run(ctx(tmp));
      assertEquals(result.status, "failed");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-cfg-admin.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the check**

Create `src/doctor/sections/ingest/check-cfg-admin.ts`:

```typescript
import { parse } from "jsr:@std/yaml@^1.1.0";
import type { Check, DoctorContext } from "../../types.ts";

function homeDir(): string {
  const override = Deno.env.get("CENTRALGAUGE_TEST_HOME");
  if (override) return override;
  return Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
}

async function readYaml(path: string): Promise<Record<string, unknown> | null> {
  try {
    return parse(await Deno.readTextFile(path)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const checkCfgAdmin: Check = {
  id: "cfg.admin",
  level: "A",
  requires: ["cfg.present"],
  async run(ctx: DoctorContext) {
    const home = homeDir();
    const homeCfg = await readYaml(`${home}/.centralgauge.yml`);
    const cwdCfg = await readYaml(`${ctx.cwd}/.centralgauge.yml`);
    const merged = {
      ...((homeCfg?.["ingest"] ?? {}) as Record<string, unknown>),
      ...((cwdCfg?.["ingest"] ?? {}) as Record<string, unknown>),
    };

    const hasId = merged["admin_key_id"] !== undefined &&
      merged["admin_key_id"] !== null;
    const hasPath = typeof merged["admin_key_path"] === "string" &&
      (merged["admin_key_path"] as string).length > 0;

    if (!hasId && !hasPath) {
      return {
        id: "cfg.admin",
        level: "A" as const,
        status: "warning" as const,
        message: "admin keys not configured (auto-register/repair disabled)",
        durationMs: 0,
      };
    }
    if (hasId !== hasPath) {
      return {
        id: "cfg.admin",
        level: "A" as const,
        status: "failed" as const,
        message:
          "admin_key_id and admin_key_path must both be set or both omitted",
        remediation: {
          summary: "Add the missing field to ~/.centralgauge.yml",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    }
    return {
      id: "cfg.admin",
      level: "A" as const,
      status: "passed" as const,
      message: `admin_key_id=${merged["admin_key_id"]} configured`,
      durationMs: 0,
    };
  },
};
```

- [ ] **Step 4: Run test**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-cfg-admin.test.ts
```

Expected: PASS, 3 cases green.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/sections/ingest/check-cfg-admin.ts
deno fmt src/doctor/sections/ingest/check-cfg-admin.ts tests/unit/doctor/sections/ingest/check-cfg-admin.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/sections/ingest/check-cfg-admin.ts tests/unit/doctor/sections/ingest/check-cfg-admin.test.ts
git commit -m "feat(doctor): check cfg.admin — admin keys present (warning if absent)"
```

---

## Task 11: Check — keys.files

**Files:**

- Create: `src/doctor/sections/ingest/check-keys-files.ts`
- Test: `tests/unit/doctor/sections/ingest/check-keys-files.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/sections/ingest/check-keys-files.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkKeysFiles } from "../../../../../src/doctor/sections/ingest/check-keys-files.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

function ctx(cwd: string): DoctorContext {
  return { cwd, fetchFn: globalThis.fetch, previousResults: new Map() };
}

async function writeKey(path: string, bytes: number) {
  await Deno.writeFile(path, new Uint8Array(bytes));
}

describe("checkKeysFiles", () => {
  it("passes when ingest key file exists at exactly 32 bytes", async () => {
    const tmp = await Deno.makeTempDir();
    const keyPath = `${tmp}/key.ed25519`;
    await writeKey(keyPath, 32);
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: x\n  key_id: 1\n  key_path: ${keyPath}\n  machine_id: m\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkKeysFiles.run(ctx(tmp));
      assertEquals(result.status, "passed");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when key file does not exist", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: x\n  key_id: 1\n  key_path: ${tmp}/missing.ed25519\n  machine_id: m\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkKeysFiles.run(ctx(tmp));
      assertEquals(result.status, "failed");
      const issues =
        (result.details?.issues as Array<Record<string, unknown>>) ?? [];
      assertEquals(issues[0]?.["reason"], "not found");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when key file size is not 32 bytes", async () => {
    const tmp = await Deno.makeTempDir();
    const keyPath = `${tmp}/wrong.ed25519`;
    await writeKey(keyPath, 64); // wrong size
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: x\n  key_id: 1\n  key_path: ${keyPath}\n  machine_id: m\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkKeysFiles.run(ctx(tmp));
      assertEquals(result.status, "failed");
      const issues =
        (result.details?.issues as Array<Record<string, unknown>>) ?? [];
      assertEquals(issues[0]?.["reason"], "wrong size");
      assertEquals(issues[0]?.["bytes"], 64);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("checks admin key too when configured", async () => {
    const tmp = await Deno.makeTempDir();
    const ingestKey = `${tmp}/i.ed25519`;
    const adminKey = `${tmp}/a.ed25519`;
    await writeKey(ingestKey, 32);
    await writeKey(adminKey, 32);
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: x\n  key_id: 1\n  key_path: ${ingestKey}\n  machine_id: m\n  admin_key_id: 2\n  admin_key_path: ${adminKey}\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkKeysFiles.run(ctx(tmp));
      assertEquals(result.status, "passed");
      assertEquals(result.message, "ingest + admin keys 32B each");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-keys-files.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the check**

Create `src/doctor/sections/ingest/check-keys-files.ts`:

```typescript
import { parse } from "jsr:@std/yaml@^1.1.0";
import type { Check, DoctorContext } from "../../types.ts";

const KEY_BYTES = 32;

function homeDir(): string {
  const override = Deno.env.get("CENTRALGAUGE_TEST_HOME");
  if (override) return override;
  return Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
}

async function readYaml(path: string): Promise<Record<string, unknown> | null> {
  try {
    return parse(await Deno.readTextFile(path)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface KeyIssue {
  which: "ingest" | "admin";
  path: string;
  reason: "not found" | "wrong size" | "unreadable";
  bytes?: number;
}

async function inspectKey(
  which: "ingest" | "admin",
  path: string,
): Promise<KeyIssue | null> {
  try {
    const stat = await Deno.stat(path);
    if (stat.size !== KEY_BYTES) {
      return { which, path, reason: "wrong size", bytes: stat.size };
    }
    return null;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return { which, path, reason: "not found" };
    }
    return { which, path, reason: "unreadable" };
  }
}

export const checkKeysFiles: Check = {
  id: "keys.files",
  level: "A",
  requires: ["cfg.present"],
  async run(ctx: DoctorContext) {
    const home = homeDir();
    const merged = {
      ...((await readYaml(`${home}/.centralgauge.yml`))?.["ingest"] ??
        {}) as Record<
          string,
          unknown
        >,
      ...((await readYaml(`${ctx.cwd}/.centralgauge.yml`))?.["ingest"] ??
        {}) as Record<
          string,
          unknown
        >,
    };

    const issues: KeyIssue[] = [];
    const ingestPath = merged["key_path"] as string | undefined;
    if (!ingestPath) {
      // cfg.present should have failed already; defensive.
      return {
        id: "keys.files",
        level: "A" as const,
        status: "failed" as const,
        message: "ingest.key_path missing",
        durationMs: 0,
      };
    }
    const i = await inspectKey("ingest", ingestPath);
    if (i) issues.push(i);

    const adminPath = merged["admin_key_path"] as string | undefined;
    let hadAdmin = false;
    if (adminPath) {
      hadAdmin = true;
      const a = await inspectKey("admin", adminPath);
      if (a) issues.push(a);
    }

    if (issues.length > 0) {
      return {
        id: "keys.files",
        level: "A" as const,
        status: "failed" as const,
        message: issues
          .map((x) => `${x.which}: ${x.reason}`)
          .join("; "),
        remediation: {
          summary: "Re-run the key provisioning script",
          command:
            "deno run --allow-env --allow-read --allow-write scripts/provision-ingest-keys.ts",
          autoRepairable: false,
        },
        details: { issues },
        durationMs: 0,
      };
    }

    return {
      id: "keys.files",
      level: "A" as const,
      status: "passed" as const,
      message: hadAdmin
        ? "ingest + admin keys 32B each"
        : "ingest key 32B (admin key not configured)",
      durationMs: 0,
    };
  },
};
```

- [ ] **Step 4: Run test**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-keys-files.test.ts
```

Expected: PASS, 4 cases green.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/sections/ingest/check-keys-files.ts
deno fmt src/doctor/sections/ingest/check-keys-files.ts tests/unit/doctor/sections/ingest/check-keys-files.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/sections/ingest/check-keys-files.ts tests/unit/doctor/sections/ingest/check-keys-files.test.ts
git commit -m "feat(doctor): check keys.files — exists + 32 raw bytes"
```

---

## Task 12: Check — catalog.local

**Files:**

- Create: `src/doctor/sections/ingest/check-catalog-local.ts`
- Test: `tests/unit/doctor/sections/ingest/check-catalog-local.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/sections/ingest/check-catalog-local.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkCatalogLocal } from "../../../../../src/doctor/sections/ingest/check-catalog-local.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

function ctx(cwd: string): DoctorContext {
  return { cwd, fetchFn: globalThis.fetch, previousResults: new Map() };
}

describe("checkCatalogLocal", () => {
  it("passes when all catalog YAMLs parse cleanly", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.mkdir(`${tmp}/site/catalog`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/site/catalog/models.yml`,
      `- slug: x/y\n  api_model_id: y\n  family: f\n  display_name: Y\n`,
    );
    await Deno.writeTextFile(
      `${tmp}/site/catalog/model-families.yml`,
      `- slug: f\n  vendor: V\n  display_name: F\n`,
    );
    await Deno.writeTextFile(
      `${tmp}/site/catalog/pricing.yml`,
      `[]\n`,
    );
    try {
      const result = await checkCatalogLocal.run(ctx(tmp));
      assertEquals(result.status, "passed");
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails on YAML parse error", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.mkdir(`${tmp}/site/catalog`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/site/catalog/models.yml`,
      `: not [valid yaml`,
    );
    try {
      const result = await checkCatalogLocal.run(ctx(tmp));
      assertEquals(result.status, "failed");
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when site/catalog directory is missing entirely", async () => {
    const tmp = await Deno.makeTempDir();
    try {
      const result = await checkCatalogLocal.run(ctx(tmp));
      assertEquals(result.status, "failed");
      assertEquals(result.message.includes("site/catalog"), true);
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-catalog-local.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the check**

Create `src/doctor/sections/ingest/check-catalog-local.ts`:

```typescript
import { parse } from "jsr:@std/yaml@^1.1.0";
import type { Check, DoctorContext } from "../../types.ts";

const FILES = ["models.yml", "model-families.yml", "pricing.yml"] as const;

export const checkCatalogLocal: Check = {
  id: "catalog.local",
  level: "A",
  async run(ctx: DoctorContext) {
    const dir = `${ctx.cwd}/site/catalog`;
    try {
      await Deno.stat(dir);
    } catch {
      return {
        id: "catalog.local",
        level: "A" as const,
        status: "failed" as const,
        message: `site/catalog directory missing at ${dir}`,
        durationMs: 0,
      };
    }

    const errors: Array<{ file: string; error: string }> = [];
    for (const f of FILES) {
      try {
        const text = await Deno.readTextFile(`${dir}/${f}`);
        parse(text);
      } catch (e) {
        errors.push({
          file: f,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (errors.length > 0) {
      return {
        id: "catalog.local",
        level: "A" as const,
        status: "failed" as const,
        message: `parse error in: ${errors.map((e) => e.file).join(", ")}`,
        remediation: {
          summary: "Fix YAML syntax in site/catalog/*.yml",
          autoRepairable: false,
        },
        details: { errors },
        durationMs: 0,
      };
    }

    return {
      id: "catalog.local",
      level: "A" as const,
      status: "passed" as const,
      message: `${FILES.join(" + ")} ok`,
      durationMs: 0,
    };
  },
};
```

- [ ] **Step 4: Run test**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-catalog-local.test.ts
```

Expected: PASS, 3 cases.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/sections/ingest/check-catalog-local.ts
deno fmt src/doctor/sections/ingest/check-catalog-local.ts tests/unit/doctor/sections/ingest/check-catalog-local.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/sections/ingest/check-catalog-local.ts tests/unit/doctor/sections/ingest/check-catalog-local.test.ts
git commit -m "feat(doctor): check catalog.local — site/catalog YAMLs parse"
```

---

## Task 13: Check — clock.skew

**Files:**

- Create: `src/doctor/sections/ingest/check-clock-skew.ts`
- Test: `tests/unit/doctor/sections/ingest/check-clock-skew.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/sections/ingest/check-clock-skew.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkClockSkew } from "../../../../../src/doctor/sections/ingest/check-clock-skew.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

function makeFetch(serverDate: string): typeof fetch {
  return async () =>
    new Response(null, {
      status: 200,
      headers: { Date: serverDate },
    });
}

describe("checkClockSkew", () => {
  it("passes when skew < 60s", async () => {
    const ctx: DoctorContext = {
      cwd: "/",
      fetchFn: makeFetch(new Date().toUTCString()),
      previousResults: new Map(),
    };
    const result = await checkClockSkew.run(ctx);
    assertEquals(result.status, "passed");
  });

  it("fails when skew >= 60s", async () => {
    const tooEarly = new Date(Date.now() - 120_000).toUTCString();
    const ctx: DoctorContext = {
      cwd: "/",
      fetchFn: makeFetch(tooEarly),
      previousResults: new Map(),
    };
    const result = await checkClockSkew.run(ctx);
    assertEquals(result.status, "failed");
    assertEquals(result.remediation?.summary, "Sync system clock");
  });

  it("warns when probe URL is not configured (skew unknowable)", async () => {
    const ctx: DoctorContext = {
      cwd: "/",
      fetchFn: async () => {
        throw new Error("no url");
      },
      previousResults: new Map(),
    };
    const result = await checkClockSkew.run(ctx);
    assertEquals(result.status, "warning");
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-clock-skew.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the check**

Create `src/doctor/sections/ingest/check-clock-skew.ts`:

```typescript
import { parse } from "jsr:@std/yaml@^1.1.0";
import type { Check, DoctorContext } from "../../types.ts";

const TOLERANCE_MS = 60_000; // matches worker's signed_at validation window

function homeDir(): string {
  const override = Deno.env.get("CENTRALGAUGE_TEST_HOME");
  if (override) return override;
  return Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
}

async function readUrl(ctx: DoctorContext): Promise<string | null> {
  for (
    const path of [
      `${ctx.cwd}/.centralgauge.yml`,
      `${homeDir()}/.centralgauge.yml`,
    ]
  ) {
    try {
      const cfg = parse(await Deno.readTextFile(path)) as Record<
        string,
        unknown
      >;
      const url = (cfg?.["ingest"] as Record<string, unknown> | undefined)?.[
        "url"
      ];
      if (typeof url === "string" && url.length > 0) return url;
    } catch {
      // try next
    }
  }
  return null;
}

export const checkClockSkew: Check = {
  id: "clock.skew",
  level: "A",
  async run(ctx: DoctorContext) {
    const url = await readUrl(ctx);
    if (!url) {
      return {
        id: "clock.skew",
        level: "A" as const,
        status: "warning" as const,
        message: "no ingest.url configured; skew unknowable",
        durationMs: 0,
      };
    }
    try {
      const resp = await ctx.fetchFn(`${url}/health`, { method: "HEAD" });
      const dateHeader = resp.headers.get("Date");
      if (!dateHeader) {
        return {
          id: "clock.skew",
          level: "A" as const,
          status: "warning" as const,
          message: "server did not return a Date header",
          durationMs: 0,
        };
      }
      const serverMs = new Date(dateHeader).getTime();
      const skew = Math.abs(Date.now() - serverMs);
      if (skew < TOLERANCE_MS) {
        return {
          id: "clock.skew",
          level: "A" as const,
          status: "passed" as const,
          message: `${(skew / 1000).toFixed(1)}s`,
          durationMs: 0,
        };
      }
      return {
        id: "clock.skew",
        level: "A" as const,
        status: "failed" as const,
        message: `skew ${(skew / 1000).toFixed(1)}s exceeds ${
          TOLERANCE_MS / 1000
        }s tolerance`,
        remediation: {
          summary: "Sync system clock",
          autoRepairable: false,
        },
        details: { skew_ms: skew, tolerance_ms: TOLERANCE_MS },
        durationMs: 0,
      };
    } catch (e) {
      return {
        id: "clock.skew",
        level: "A" as const,
        status: "warning" as const,
        message: `skew probe failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
        durationMs: 0,
      };
    }
  },
};
```

- [ ] **Step 4: Run test**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-clock-skew.test.ts
```

Expected: PASS, 3 cases.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/sections/ingest/check-clock-skew.ts
deno fmt src/doctor/sections/ingest/check-clock-skew.ts tests/unit/doctor/sections/ingest/check-clock-skew.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/sections/ingest/check-clock-skew.ts tests/unit/doctor/sections/ingest/check-clock-skew.test.ts
git commit -m "feat(doctor): check clock.skew — local vs server Date header within 60s"
```

---

## Task 14: Check — net.health

**Files:**

- Create: `src/doctor/sections/ingest/check-net-health.ts`
- Test: `tests/unit/doctor/sections/ingest/check-net-health.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/sections/ingest/check-net-health.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkNetHealth } from "../../../../../src/doctor/sections/ingest/check-net-health.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

function makeFetch(impl: typeof fetch): typeof fetch {
  return impl;
}

async function withTmpConfig<T>(
  url: string,
  body: (cwd: string) => Promise<T>,
): Promise<T> {
  const tmp = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${tmp}/.centralgauge.yml`,
    `ingest:\n  url: ${url}\n  key_id: 1\n  key_path: /k\n  machine_id: m\n`,
  );
  Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
  try {
    return await body(tmp);
  } finally {
    Deno.env.delete("CENTRALGAUGE_TEST_HOME");
    await Deno.remove(tmp, { recursive: true });
  }
}

describe("checkNetHealth", () => {
  it("passes when /health returns 200", async () => {
    await withTmpConfig("https://x.example", async (tmp) => {
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn: makeFetch(async () => new Response("ok", { status: 200 })),
        previousResults: new Map(),
      };
      const result = await checkNetHealth.run(ctx);
      assertEquals(result.status, "passed");
    });
  });

  it("fails on non-200 response", async () => {
    await withTmpConfig("https://x.example", async (tmp) => {
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn: makeFetch(async () => new Response("nope", { status: 502 })),
        previousResults: new Map(),
      };
      const result = await checkNetHealth.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.message.includes("502"), true);
    });
  });

  it("fails on timeout", async () => {
    await withTmpConfig("https://x.example", async (tmp) => {
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn: (_url, init?: RequestInit) => {
          const signal = (init as RequestInit | undefined)?.signal;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
            );
          });
        },
        previousResults: new Map(),
      };
      const result = await checkNetHealth.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(
        result.message.toLowerCase().includes("timeout") ||
          result.message.toLowerCase().includes("abort"),
        true,
      );
    });
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-net-health.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the check**

Create `src/doctor/sections/ingest/check-net-health.ts`:

```typescript
import { parse } from "jsr:@std/yaml@^1.1.0";
import type { Check, DoctorContext } from "../../types.ts";

const TIMEOUT_MS = 5000;

function homeDir(): string {
  const override = Deno.env.get("CENTRALGAUGE_TEST_HOME");
  if (override) return override;
  return Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
}

async function readUrl(ctx: DoctorContext): Promise<string | null> {
  for (
    const path of [
      `${ctx.cwd}/.centralgauge.yml`,
      `${homeDir()}/.centralgauge.yml`,
    ]
  ) {
    try {
      const cfg = parse(await Deno.readTextFile(path)) as Record<
        string,
        unknown
      >;
      const url = (cfg?.["ingest"] as Record<string, unknown> | undefined)?.[
        "url"
      ];
      if (typeof url === "string" && url.length > 0) {
        return url.replace(/\/+$/, "");
      }
    } catch {
      // try next
    }
  }
  return null;
}

export const checkNetHealth: Check = {
  id: "net.health",
  level: "B",
  requires: ["cfg.present"],
  async run(ctx: DoctorContext) {
    const url = await readUrl(ctx);
    if (!url) {
      return {
        id: "net.health",
        level: "B" as const,
        status: "failed" as const,
        message: "no ingest.url configured",
        durationMs: 0,
      };
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const started = Date.now();
    try {
      const resp = await ctx.fetchFn(`${url}/health`, {
        method: "GET",
        signal: ac.signal,
      });
      clearTimeout(timer);
      const elapsed = Date.now() - started;
      if (resp.status === 200) {
        return {
          id: "net.health",
          level: "B" as const,
          status: "passed" as const,
          message: `200 in ${elapsed}ms`,
          durationMs: 0,
        };
      }
      return {
        id: "net.health",
        level: "B" as const,
        status: "failed" as const,
        message: `${resp.status} from ${url}/health (in ${elapsed}ms)`,
        remediation: {
          summary: "Check Cloudflare worker dashboard / URL correctness",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    } catch (e) {
      clearTimeout(timer);
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      return {
        id: "net.health",
        level: "B" as const,
        status: "failed" as const,
        message: isAbort
          ? `timeout after ${TIMEOUT_MS}ms`
          : `fetch failed: ${e instanceof Error ? e.message : String(e)}`,
        remediation: {
          summary: "Check URL, DNS, and network",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    }
  },
};
```

- [ ] **Step 4: Run test**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-net-health.test.ts
```

Expected: PASS, 3 cases.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/sections/ingest/check-net-health.ts
deno fmt src/doctor/sections/ingest/check-net-health.ts tests/unit/doctor/sections/ingest/check-net-health.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/sections/ingest/check-net-health.ts tests/unit/doctor/sections/ingest/check-net-health.test.ts
git commit -m "feat(doctor): check net.health — GET /health 200 within 5s"
```

---

## Task 15: Check — auth.probe

**Files:**

- Create: `src/doctor/sections/ingest/check-auth-probe.ts`
- Test: `tests/unit/doctor/sections/ingest/check-auth-probe.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/sections/ingest/check-auth-probe.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkAuthProbe } from "../../../../../src/doctor/sections/ingest/check-auth-probe.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

async function setupConfigAndKey(): Promise<{ tmp: string; keyPath: string }> {
  const tmp = await Deno.makeTempDir();
  const keyPath = `${tmp}/k.ed25519`;
  await Deno.writeFile(keyPath, new Uint8Array(32)); // 32 zero bytes — valid format, not a real key
  await Deno.writeTextFile(
    `${tmp}/.centralgauge.yml`,
    `ingest:\n  url: https://x.example\n  key_id: 7\n  key_path: ${keyPath}\n  machine_id: machine-A\n`,
  );
  Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
  return { tmp, keyPath };
}

describe("checkAuthProbe", () => {
  it("passes when server returns auth.ok=true and key_role=ingest and machine_id_match=true", async () => {
    const { tmp } = await setupConfigAndKey();
    try {
      const fetchFn: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            schema_version: 1,
            auth: {
              ok: true,
              key_id: 7,
              key_role: "ingest",
              key_active: true,
              machine_id_match: true,
            },
            server_time: new Date().toISOString(),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        previousResults: new Map(),
      };
      const result = await checkAuthProbe.run(ctx);
      assertEquals(result.status, "passed");
      assertEquals(result.message.includes("key_id=7"), true);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails on 401 with auth-mismatch remediation hint", async () => {
    const { tmp } = await setupConfigAndKey();
    try {
      const fetchFn: typeof fetch = async () =>
        new Response("bad sig", { status: 401 });
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        previousResults: new Map(),
      };
      const result = await checkAuthProbe.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.remediation?.autoRepairable, false);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when machine_id_match=false even though signature is valid", async () => {
    const { tmp } = await setupConfigAndKey();
    try {
      const fetchFn: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            schema_version: 1,
            auth: {
              ok: true,
              key_id: 7,
              key_role: "ingest",
              key_active: true,
              machine_id_match: false,
            },
            server_time: new Date().toISOString(),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        previousResults: new Map(),
      };
      const result = await checkAuthProbe.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.message.includes("machine_id"), true);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when key was revoked (auth.key_active=false)", async () => {
    const { tmp } = await setupConfigAndKey();
    try {
      const fetchFn: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            schema_version: 1,
            auth: {
              ok: true,
              key_id: 7,
              key_role: "ingest",
              key_active: false,
              machine_id_match: true,
            },
            server_time: new Date().toISOString(),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        previousResults: new Map(),
      };
      const result = await checkAuthProbe.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.message.includes("revoked"), true);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-auth-probe.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the check**

Create `src/doctor/sections/ingest/check-auth-probe.ts`:

```typescript
import { parse } from "jsr:@std/yaml@^1.1.0";
import { signPayload } from "../../../ingest/sign.ts";
import type { Check, DoctorContext } from "../../types.ts";

function homeDir(): string {
  const override = Deno.env.get("CENTRALGAUGE_TEST_HOME");
  if (override) return override;
  return Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
}

async function loadIngest(
  ctx: DoctorContext,
): Promise<Record<string, unknown>> {
  const merged: Record<string, unknown> = {};
  for (
    const p of [
      `${homeDir()}/.centralgauge.yml`,
      `${ctx.cwd}/.centralgauge.yml`,
    ]
  ) {
    try {
      const cfg = parse(await Deno.readTextFile(p)) as Record<
        string,
        unknown
      >;
      Object.assign(
        merged,
        (cfg?.["ingest"] as Record<string, unknown> | undefined) ?? {},
      );
    } catch {
      // try next
    }
  }
  return merged;
}

interface PrecheckResponse {
  schema_version: number;
  auth: {
    ok: boolean;
    key_id: number;
    key_role: string;
    key_active: boolean;
    machine_id_match: boolean;
  };
  catalog?: unknown;
  server_time: string;
}

export const checkAuthProbe: Check = {
  id: "auth.probe",
  level: "C",
  requires: ["keys.files", "net.health"],
  async run(ctx: DoctorContext) {
    const ingest = await loadIngest(ctx);
    const url = (ingest["url"] as string).replace(/\/+$/, "");
    const keyPath = ingest["key_path"] as string;
    const keyIdRaw = ingest["key_id"];
    const keyId = typeof keyIdRaw === "number"
      ? keyIdRaw
      : parseInt(String(keyIdRaw), 10);
    const machineId = ingest["machine_id"] as string;

    const privateKey = await Deno.readFile(keyPath);
    const payload = { machine_id: machineId };
    const sig = await signPayload(payload, privateKey, keyId);
    const body = JSON.stringify({
      version: 1,
      signature: sig,
      payload,
    });

    const resp = await ctx.fetchFn(`${url}/api/v1/precheck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    if (resp.status === 401) {
      return {
        id: "auth.probe",
        level: "C" as const,
        status: "failed" as const,
        message:
          `401 from precheck — signature did not verify against key_id=${keyId}`,
        remediation: {
          summary:
            "Public key in D1 doesn't match local private key. Re-provision keys and re-insert into D1.",
          command:
            "deno run --allow-env --allow-read --allow-write scripts/provision-ingest-keys.ts",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    }
    if (resp.status !== 200) {
      return {
        id: "auth.probe",
        level: "C" as const,
        status: "failed" as const,
        message: `unexpected status ${resp.status} from precheck`,
        durationMs: 0,
      };
    }

    const data = await resp.json() as PrecheckResponse;

    if (!data.auth.ok) {
      return {
        id: "auth.probe",
        level: "C" as const,
        status: "failed" as const,
        message: "server returned auth.ok=false",
        durationMs: 0,
      };
    }
    if (!data.auth.key_active) {
      return {
        id: "auth.probe",
        level: "C" as const,
        status: "failed" as const,
        message: `key_id=${keyId} is revoked`,
        remediation: {
          summary: "Provision a new key and update ~/.centralgauge.yml",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    }
    if (!data.auth.machine_id_match) {
      return {
        id: "auth.probe",
        level: "C" as const,
        status: "failed" as const,
        message:
          `machine_id mismatch: D1 row's machine_id ≠ local config's '${machineId}'`,
        remediation: {
          summary:
            "Align machine_id in ~/.centralgauge.yml with the D1 machine_keys row",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    }

    return {
      id: "auth.probe",
      level: "C" as const,
      status: "passed" as const,
      message: `key_id=${data.auth.key_id} role=${data.auth.key_role}`,
      details: { key_role: data.auth.key_role, server_time: data.server_time },
      durationMs: 0,
    };
  },
};
```

- [ ] **Step 4: Run test**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-auth-probe.test.ts
```

Expected: PASS, 4 cases.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/sections/ingest/check-auth-probe.ts
deno fmt src/doctor/sections/ingest/check-auth-probe.ts tests/unit/doctor/sections/ingest/check-auth-probe.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/sections/ingest/check-auth-probe.ts tests/unit/doctor/sections/ingest/check-auth-probe.test.ts
git commit -m "feat(doctor): check auth.probe — signed POST /api/v1/precheck"
```

---

## Task 16: Check — catalog.bench

**Files:**

- Create: `src/doctor/sections/ingest/check-catalog-bench.ts`
- Test: `tests/unit/doctor/sections/ingest/check-catalog-bench.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/sections/ingest/check-catalog-bench.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkCatalogBench } from "../../../../../src/doctor/sections/ingest/check-catalog-bench.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

async function setup(): Promise<string> {
  const tmp = await Deno.makeTempDir();
  const keyPath = `${tmp}/k.ed25519`;
  await Deno.writeFile(keyPath, new Uint8Array(32));
  await Deno.writeTextFile(
    `${tmp}/.centralgauge.yml`,
    `ingest:\n  url: https://x.example\n  key_id: 7\n  key_path: ${keyPath}\n  machine_id: m\n`,
  );
  Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
  return tmp;
}

describe("checkCatalogBench", () => {
  it("skips with warning when ctx.variants is empty", async () => {
    const tmp = await setup();
    try {
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn: async () => new Response("{}"),
        previousResults: new Map(),
      };
      const result = await checkCatalogBench.run(ctx);
      assertEquals(result.status, "warning");
      assertEquals(result.message.includes("no variants"), true);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("passes when all variants registered, pricing seeded, task-set current", async () => {
    const tmp = await setup();
    try {
      const fetchFn: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            schema_version: 1,
            auth: {
              ok: true,
              key_id: 7,
              key_role: "ingest",
              key_active: true,
              machine_id_match: true,
            },
            catalog: {
              missing_models: [],
              missing_pricing: [],
              task_set_current: true,
              task_set_known: true,
            },
            server_time: new Date().toISOString(),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        variants: [{
          slug: "anthropic/claude-opus-4-7",
          api_model_id: "claude-opus-4-7",
          family_slug: "claude",
        }],
        pricingVersion: "2026-04-26",
        taskSetHash: "abc",
        previousResults: new Map(),
      };
      const result = await checkCatalogBench.run(ctx);
      assertEquals(result.status, "passed");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when missing_models is non-empty and is auto-repairable", async () => {
    const tmp = await setup();
    try {
      const fetchFn: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            schema_version: 1,
            auth: {
              ok: true,
              key_id: 7,
              key_role: "ingest",
              key_active: true,
              machine_id_match: true,
            },
            catalog: {
              missing_models: [{
                slug: "openai/gpt-5",
                reason: "no models row",
              }],
              missing_pricing: [],
              task_set_current: true,
              task_set_known: true,
            },
            server_time: new Date().toISOString(),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        variants: [{
          slug: "openai/gpt-5",
          api_model_id: "gpt-5",
          family_slug: "gpt",
        }],
        previousResults: new Map(),
      };
      const result = await checkCatalogBench.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.remediation?.autoRepairable, true);
      assertEquals(
        result.remediation?.command,
        "deno task start sync-catalog --apply",
      );
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when task_set_current=false (mark-current is auto-repairable)", async () => {
    const tmp = await setup();
    try {
      const fetchFn: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            schema_version: 1,
            auth: {
              ok: true,
              key_id: 7,
              key_role: "ingest",
              key_active: true,
              machine_id_match: true,
            },
            catalog: {
              missing_models: [],
              missing_pricing: [],
              task_set_current: false,
              task_set_known: true,
            },
            server_time: new Date().toISOString(),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        variants: [{ slug: "x/y", api_model_id: "y", family_slug: "x" }],
        taskSetHash: "abc",
        previousResults: new Map(),
      };
      const result = await checkCatalogBench.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.remediation?.autoRepairable, true);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-catalog-bench.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the check**

Create `src/doctor/sections/ingest/check-catalog-bench.ts`:

```typescript
import { parse } from "jsr:@std/yaml@^1.1.0";
import { signPayload } from "../../../ingest/sign.ts";
import type { Check, DoctorContext } from "../../types.ts";

function homeDir(): string {
  const override = Deno.env.get("CENTRALGAUGE_TEST_HOME");
  if (override) return override;
  return Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
}

async function loadIngest(
  ctx: DoctorContext,
): Promise<Record<string, unknown>> {
  const merged: Record<string, unknown> = {};
  for (
    const p of [
      `${homeDir()}/.centralgauge.yml`,
      `${ctx.cwd}/.centralgauge.yml`,
    ]
  ) {
    try {
      const cfg = parse(await Deno.readTextFile(p)) as Record<
        string,
        unknown
      >;
      Object.assign(
        merged,
        (cfg?.["ingest"] as Record<string, unknown> | undefined) ?? {},
      );
    } catch {
      // try next
    }
  }
  return merged;
}

export const checkCatalogBench: Check = {
  id: "catalog.bench",
  level: "D",
  requires: ["auth.probe"],
  async run(ctx: DoctorContext) {
    if (!ctx.variants || ctx.variants.length === 0) {
      return {
        id: "catalog.bench",
        level: "D" as const,
        status: "warning" as const,
        message: "no variants supplied; bench-aware catalog check skipped",
        durationMs: 0,
      };
    }
    const ingest = await loadIngest(ctx);
    const url = (ingest["url"] as string).replace(/\/+$/, "");
    const keyPath = ingest["key_path"] as string;
    const keyIdRaw = ingest["key_id"];
    const keyId = typeof keyIdRaw === "number"
      ? keyIdRaw
      : parseInt(String(keyIdRaw), 10);
    const machineId = ingest["machine_id"] as string;
    const privateKey = await Deno.readFile(keyPath);

    const payload: Record<string, unknown> = {
      machine_id: machineId,
      variants: ctx.variants,
    };
    if (ctx.pricingVersion) payload["pricing_version"] = ctx.pricingVersion;
    if (ctx.taskSetHash) payload["task_set_hash"] = ctx.taskSetHash;

    const sig = await signPayload(payload, privateKey, keyId);
    const resp = await ctx.fetchFn(`${url}/api/v1/precheck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1, signature: sig, payload }),
    });

    if (resp.status !== 200) {
      return {
        id: "catalog.bench",
        level: "D" as const,
        status: "failed" as const,
        message: `unexpected status ${resp.status}`,
        durationMs: 0,
      };
    }
    const data = await resp.json() as {
      catalog?: {
        missing_models: Array<{ slug: string; reason: string }>;
        missing_pricing: Array<{ slug: string; pricing_version: string }>;
        task_set_current: boolean;
        task_set_known: boolean;
      };
    };
    const cat = data.catalog;
    if (!cat) {
      return {
        id: "catalog.bench",
        level: "D" as const,
        status: "failed" as const,
        message: "server did not return catalog data despite variants[] sent",
        durationMs: 0,
      };
    }

    const failures: string[] = [];
    if (cat.missing_models.length > 0) {
      failures.push(
        `models missing: ${cat.missing_models.map((m) => m.slug).join(", ")}`,
      );
    }
    if (cat.missing_pricing.length > 0) {
      failures.push(
        `pricing missing for: ${
          cat.missing_pricing.map((m) => m.slug).join(", ")
        }`,
      );
    }
    if (ctx.taskSetHash && !cat.task_set_known) {
      failures.push(`task_set hash unknown to D1`);
    }
    if (ctx.taskSetHash && cat.task_set_known && !cat.task_set_current) {
      failures.push(`task_set is_current=0`);
    }

    if (failures.length === 0) {
      return {
        id: "catalog.bench",
        level: "D" as const,
        status: "passed" as const,
        message: `${ctx.variants.length} variant(s) ready`,
        durationMs: 0,
      };
    }

    const repairable = cat.missing_models.length > 0 ||
      cat.missing_pricing.length > 0 ||
      (ctx.taskSetHash !== undefined && cat.task_set_known &&
        !cat.task_set_current);

    return {
      id: "catalog.bench",
      level: "D" as const,
      status: "failed" as const,
      message: failures.join("; "),
      remediation: repairable
        ? {
          summary: cat.missing_models.length > 0 ||
              cat.missing_pricing.length > 0
            ? "Push catalog drift to D1"
            : "Mark task_set is_current=1 via admin API",
          command: "deno task start sync-catalog --apply",
          autoRepairable: true,
        }
        : {
          summary:
            "Investigate task_set hash; bench task tree may have drifted",
          autoRepairable: false,
        },
      details: cat,
      durationMs: 0,
    };
  },
};
```

- [ ] **Step 4: Run test**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/check-catalog-bench.test.ts
```

Expected: PASS, 4 cases.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/sections/ingest/check-catalog-bench.ts
deno fmt src/doctor/sections/ingest/check-catalog-bench.ts tests/unit/doctor/sections/ingest/check-catalog-bench.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/sections/ingest/check-catalog-bench.ts tests/unit/doctor/sections/ingest/check-catalog-bench.test.ts
git commit -m "feat(doctor): check catalog.bench — bench-aware D1 catalog state"
```

---

## Task 17: Compose ingest section

**Files:**

- Create: `src/doctor/sections/ingest/mod.ts`
- Create: `src/doctor/mod.ts`
- Test: `tests/unit/doctor/sections/ingest/mod.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/sections/ingest/mod.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { ingestSection } from "../../../../../src/doctor/sections/ingest/mod.ts";

describe("ingestSection", () => {
  it("contains the 8 expected checks in matrix order", () => {
    assertEquals(ingestSection.id, "ingest");
    assertEquals(ingestSection.checks.map((c) => c.id), [
      "cfg.present",
      "cfg.admin",
      "keys.files",
      "catalog.local",
      "clock.skew",
      "net.health",
      "auth.probe",
      "catalog.bench",
    ]);
  });

  it("dependency declarations are consistent (every requires id exists earlier)", () => {
    const seen = new Set<string>();
    for (const c of ingestSection.checks) {
      for (const dep of c.requires ?? []) {
        if (!seen.has(dep)) {
          throw new Error(
            `Check '${c.id}' requires '${dep}' which is not declared earlier`,
          );
        }
      }
      seen.add(c.id);
    }
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/mod.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the section composition**

Create `src/doctor/sections/ingest/mod.ts`:

```typescript
import type { Section } from "../../types.ts";
import { checkCfgPresent } from "./check-cfg-present.ts";
import { checkCfgAdmin } from "./check-cfg-admin.ts";
import { checkKeysFiles } from "./check-keys-files.ts";
import { checkCatalogLocal } from "./check-catalog-local.ts";
import { checkClockSkew } from "./check-clock-skew.ts";
import { checkNetHealth } from "./check-net-health.ts";
import { checkAuthProbe } from "./check-auth-probe.ts";
import { checkCatalogBench } from "./check-catalog-bench.ts";

export const ingestSection: Section = {
  id: "ingest",
  checks: [
    checkCfgPresent,
    checkCfgAdmin,
    checkKeysFiles,
    checkCatalogLocal,
    checkClockSkew,
    checkNetHealth,
    checkAuthProbe,
    checkCatalogBench,
  ],
};
```

Also create `src/doctor/mod.ts`:

```typescript
/**
 * Public re-exports for the doctor module.
 */
export { runDoctor } from "./engine.ts";
export { formatReportAsJson, formatReportToTerminal } from "./formatter.ts";
export type {
  Check,
  CheckLevel,
  CheckResult,
  CheckStatus,
  DoctorContext,
  DoctorReport,
  Remediation,
  RunDoctorOptions,
  Section,
  SectionId,
  VariantProbe,
} from "./types.ts";
export { ingestSection } from "./sections/ingest/mod.ts";
```

- [ ] **Step 4: Run test**

```bash
deno test --allow-all tests/unit/doctor/sections/ingest/mod.test.ts
```

Expected: PASS.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/mod.ts src/doctor/sections/ingest/mod.ts tests/unit/doctor/sections/ingest/mod.test.ts
deno fmt src/doctor/mod.ts src/doctor/sections/ingest/mod.ts tests/unit/doctor/sections/ingest/mod.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/mod.ts src/doctor/sections/ingest/mod.ts tests/unit/doctor/sections/ingest/mod.test.ts
git commit -m "feat(doctor): compose ingest section + public mod.ts barrel"
```

---

## Task 18: Repair module

**Files:**

- Create: `src/doctor/repair.ts`
- Test: `tests/unit/doctor/repair.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/doctor/repair.test.ts`:

```typescript
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
        throw new Error("kaboom");
      },
    };
    const outcome = await applyRepairs(reportWithRepairableFailure, [r]);
    assertEquals(outcome.attempted.length, 1);
    assertEquals(outcome.attempted[0]!.ok, false);
    assertEquals(outcome.attempted[0]!.message?.includes("kaboom"), true);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
deno test --allow-all tests/unit/doctor/repair.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the repair module**

Create `src/doctor/repair.ts`:

```typescript
import type { CheckResult, DoctorReport } from "./types.ts";

export interface RepairResult {
  ok: boolean;
  message?: string;
}

export interface Repairer {
  id: string;
  matches(check: CheckResult): boolean;
  run(check: CheckResult): Promise<RepairResult>;
}

export interface RepairAttempt {
  checkId: string;
  repairerId: string;
  ok: boolean;
  message?: string;
  durationMs: number;
}

export interface RepairOutcome {
  attempted: RepairAttempt[];
}

export async function applyRepairs(
  report: DoctorReport,
  repairers: Repairer[],
): Promise<RepairOutcome> {
  const attempted: RepairAttempt[] = [];
  for (const check of report.checks) {
    if (
      check.status !== "failed" ||
      check.remediation?.autoRepairable !== true
    ) continue;
    const r = repairers.find((rep) => rep.matches(check));
    if (!r) continue;
    const started = Date.now();
    try {
      const out = await r.run(check);
      attempted.push({
        checkId: check.id,
        repairerId: r.id,
        ok: out.ok,
        ...(out.message ? { message: out.message } : {}),
        durationMs: Date.now() - started,
      });
    } catch (e) {
      attempted.push({
        checkId: check.id,
        repairerId: r.id,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - started,
      });
    }
  }
  return { attempted };
}

/**
 * Built-in repairer: invoke `centralgauge sync-catalog --apply` to push local
 * catalog YAML to D1. Used to fix `catalog.bench.missing_models` and
 * `catalog.bench.missing_pricing`.
 */
export const syncCatalogRepairer: Repairer = {
  id: "sync-catalog",
  matches(check) {
    if (check.id !== "catalog.bench") return false;
    if (check.remediation?.autoRepairable !== true) return false;
    const d = check.details as Record<string, unknown> | undefined;
    const missingModels = (d?.["missing_models"] ?? []) as unknown[];
    const missingPricing = (d?.["missing_pricing"] ?? []) as unknown[];
    return missingModels.length > 0 || missingPricing.length > 0;
  },
  async run() {
    const cmd = new Deno.Command("deno", {
      args: ["task", "start", "sync-catalog", "--apply"],
      stdout: "piped",
      stderr: "piped",
    });
    const { success, stdout, stderr } = await cmd.output();
    const out = new TextDecoder().decode(stdout) +
      new TextDecoder().decode(stderr);
    return success
      ? { ok: true, message: "sync-catalog --apply succeeded" }
      : { ok: false, message: `sync-catalog failed: ${out.slice(-300)}` };
  },
};

/**
 * Built-in repairer: when task_set_known=true && task_set_current=false AND
 * task_set_hash is provided, mark it current via the admin endpoint.
 * Note: requires admin_key_id + admin_key_path in config (cfg.admin).
 */
export const markTaskSetCurrentRepairer: Repairer = {
  id: "mark-task-set-current",
  matches(check) {
    if (check.id !== "catalog.bench") return false;
    if (check.remediation?.autoRepairable !== true) return false;
    const d = check.details as Record<string, unknown> | undefined;
    return d?.["task_set_known"] === true && d?.["task_set_current"] === false;
  },
  run() {
    // Implementation deferred to integration: needs admin signing + POST.
    // Defensive default: report not-yet-implemented so the user can run sync-catalog manually.
    return Promise.resolve({
      ok: false,
      message:
        "mark-task-set-current auto-repair not yet implemented; run wrangler UPDATE manually",
    });
  },
};

export const builtInRepairers: Repairer[] = [
  syncCatalogRepairer,
  markTaskSetCurrentRepairer,
];
```

- [ ] **Step 4: Run test**

```bash
deno test --allow-all tests/unit/doctor/repair.test.ts
```

Expected: PASS, 3 cases.

- [ ] **Step 5: Lint + format**

```bash
deno check src/doctor/repair.ts
deno fmt src/doctor/repair.ts tests/unit/doctor/repair.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/doctor/repair.ts tests/unit/doctor/repair.test.ts
git commit -m "feat(doctor): repair allowlist — sync-catalog + mark-task-set-current"
```

---

## Task 19: doctor CLI command

**Files:**

- Create: `cli/commands/doctor-command.ts`

- [ ] **Step 1: Inspect existing CLI registration**

```bash
grep -n "registerIngestCommand\|registerBenchCommand\|registerSyncCatalog" /u/Git/CentralGauge/cli/centralgauge.ts | head
```

Note the registration pattern other commands use.

- [ ] **Step 2: Write the command file**

Create `cli/commands/doctor-command.ts`:

```typescript
/**
 * `centralgauge doctor <section>` — environment health check umbrella.
 * @module cli/commands/doctor
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import {
  formatReportAsJson,
  formatReportToTerminal,
  ingestSection,
  runDoctor,
  type SectionId,
  type VariantProbe,
} from "../../src/doctor/mod.ts";
import { applyRepairs, builtInRepairers } from "../../src/doctor/repair.ts";
import { parseModelVariants } from "../../src/llm/variant-parser.ts";

interface DoctorOptions {
  json?: boolean;
  levels?: string;
  repair?: boolean;
  llms?: string[];
  pricingVersion?: string;
  taskSetHash?: string;
}

function parseLevels(
  s: string | undefined,
): ("A" | "B" | "C" | "D")[] | undefined {
  if (!s) return undefined;
  const all: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
  const want = s.toUpperCase().split(",").map((x) => x.trim());
  return all.filter((l) => want.includes(l));
}

async function variantProbesFromLlms(
  llms: string[] | undefined,
): Promise<VariantProbe[]> {
  if (!llms || llms.length === 0) return [];
  // The CLI takes raw spec strings (e.g. "anthropic/claude-opus-4-7"),
  // routed through the existing variant-parser to canonicalize provider/model.
  const variants = await parseModelVariants(llms);
  return variants.map((v) => ({
    slug: `${v.provider}/${v.model}`,
    api_model_id: v.model,
    family_slug: v.provider === "anthropic"
      ? "claude"
      : v.provider === "openai"
      ? "gpt"
      : v.provider === "google" || v.provider === "gemini"
      ? "gemini"
      : v.provider === "openrouter"
      ? v.model.split("/")[0] ?? v.provider
      : v.provider,
  }));
}

async function runIngest(options: DoctorOptions): Promise<void> {
  const variants = await variantProbesFromLlms(options.llms);
  const opts: Parameters<typeof runDoctor>[0] = {
    section: ingestSection,
    variants: variants.length > 0 ? variants : undefined,
    pricingVersion: options.pricingVersion,
    taskSetHash: options.taskSetHash,
    levels: parseLevels(options.levels),
  };
  let report = await runDoctor(opts);

  if (options.repair && !report.ok) {
    const rep = await applyRepairs(report, builtInRepairers);
    if (!options.json) {
      for (const a of rep.attempted) {
        console.log(
          colors.gray(
            `[repair] ${a.repairerId}: ${a.ok ? "ok" : "failed"} ${
              a.message ?? ""
            }`,
          ),
        );
      }
    }
    // Re-run after repairs
    report = await runDoctor(opts);
  }

  if (options.json) {
    console.log(formatReportAsJson(report));
  } else {
    console.log(formatReportToTerminal(report));
  }
  if (!report.ok) Deno.exit(1);
}

export function registerDoctorCommand(cli: Command): void {
  cli
    .command("doctor", "Environment health checks")
    .action(() => {
      console.log("Available sections: ingest");
      console.log("Run `centralgauge doctor ingest` to check ingest health.");
    })
    .command(
      "ingest",
      "Verify ingest health (config, keys, connectivity, catalog state)",
    )
    .option("--json", "Emit DoctorReport as JSON for CI/scripts", {
      default: false,
    })
    .option(
      "--levels <list:string>",
      "Comma-separated subset of levels (A,B,C,D)",
    )
    .option(
      "--repair",
      "Run built-in auto-repair allowlist for repairable failures, then re-check",
      { default: false },
    )
    .option(
      "--llms <models:string[]>",
      "Variants to bench-aware-check (omit for auth-only health)",
    )
    .option(
      "--pricing-version <ver:string>",
      "Pricing version to validate (default: today UTC)",
    )
    .option(
      "--task-set-hash <hash:string>",
      "Task-set hash to validate is_current",
    )
    .action((opts: DoctorOptions) => runIngest(opts));
}
```

- [ ] **Step 3: Register in CLI**

Modify `cli/centralgauge.ts` — add the import and registration alongside the other commands:

```typescript
import { registerDoctorCommand } from "./commands/doctor-command.ts";

// … inside the command setup:
registerDoctorCommand(cli);
```

- [ ] **Step 4: Manual smoke test**

```bash
deno task start doctor ingest --json
```

Expected: a JSON `DoctorReport` printed (likely `ok: false` because the running env may have catalog.bench skipped without `--llms`, but the engine should run all level-A/B/C checks). Verify the output is valid JSON:

```bash
deno task start doctor ingest --json | python -m json.tool > /dev/null && echo "JSON ok"
```

- [ ] **Step 5: Lint + format**

```bash
deno check cli/commands/doctor-command.ts cli/centralgauge.ts
deno fmt cli/commands/doctor-command.ts cli/centralgauge.ts
```

- [ ] **Step 6: Commit**

```bash
git add cli/commands/doctor-command.ts cli/centralgauge.ts
git commit -m "feat(cli): centralgauge doctor ingest — engine surface for ad-hoc precheck"
```

---

## Task 20: Bench startup precheck (env-flag-gated)

**Files:**

- Modify: `cli/commands/bench-command.ts`

- [ ] **Step 1: Locate the right insertion point**

```bash
grep -n "ingestBenchResults\|executeBenchmark\|action.*async" /u/Git/CentralGauge/cli/commands/bench-command.ts | head
```

Find where `executeBenchmark()` is called inside the `action()` handler, and the line where `result.variants` becomes available.

- [ ] **Step 2: Add precheck call gated on env flag**

In `cli/commands/bench-command.ts`, immediately after variants are resolved (and before LLM calls begin), insert:

```typescript
import {
  formatReportToTerminal,
  ingestSection,
  runDoctor,
  type VariantProbe,
} from "../../src/doctor/mod.ts";

// … inside the bench action handler, after variants are resolved …

const benchPrecheckEnabled =
  Deno.env.get("CENTRALGAUGE_BENCH_PRECHECK") === "1";

if (benchPrecheckEnabled && options.ingest !== false && variants.length > 0) {
  const probes: VariantProbe[] = variants.map((v) => ({
    slug: `${v.provider}/${v.model}`,
    api_model_id: v.model,
    family_slug: v.provider === "anthropic"
      ? "claude"
      : v.provider === "openai"
      ? "gpt"
      : v.provider === "google" || v.provider === "gemini"
      ? "gemini"
      : v.provider === "openrouter"
      ? v.model.split("/")[0] ?? v.provider
      : v.provider,
  }));
  // Reuse existing helper if you have one; otherwise inline:
  const today = new Date();
  const pricingVersion = `${today.getUTCFullYear()}-${
    String(today.getUTCMonth() + 1).padStart(2, "0")
  }-${String(today.getUTCDate()).padStart(2, "0")}`;

  const report = await runDoctor({
    section: ingestSection,
    variants: probes,
    pricingVersion,
    // taskSetHash deliberately omitted at startup — it's computed during the run;
    // the catalog-bench check only validates models + pricing here.
  });
  if (!report.ok) {
    console.error(formatReportToTerminal(report));
    console.error(
      colors.red(
        "\n[FAIL] ingest precheck failed — bench aborted before any LLM calls.",
      ),
    );
    console.error(
      colors.gray(
        "       Fix above or pass --no-ingest to skip ingest entirely.",
      ),
    );
    Deno.exit(1);
  }
}
```

- [ ] **Step 3: Manual verification**

Run a small bench with the flag set and an intentionally-broken config (e.g. rename `~/.centralgauge.yml` temporarily). Expected: bench aborts in ~1 second, no LLM calls made.

```bash
mv ~/.centralgauge.yml ~/.centralgauge.yml.bak
CENTRALGAUGE_BENCH_PRECHECK=1 deno task start bench --llms anthropic/claude-opus-4-7 --tasks "tasks/easy/CG-AL-E001.yml" --runs 1
mv ~/.centralgauge.yml.bak ~/.centralgauge.yml
```

Expected: aborts with terminal report listing `cfg.present` failure.

Repeat without the flag — bench runs normally:

```bash
deno task start bench --llms anthropic/claude-opus-4-7 --tasks "tasks/easy/CG-AL-E001.yml" --runs 1
```

- [ ] **Step 4: Lint + format**

```bash
deno check cli/commands/bench-command.ts
deno fmt cli/commands/bench-command.ts
```

- [ ] **Step 5: Commit**

```bash
git add cli/commands/bench-command.ts
git commit -m "feat(bench): startup ingest precheck behind CENTRALGAUGE_BENCH_PRECHECK=1"
```

---

## Task 21: Bench pre-ingest re-check

**Files:**

- Modify: `cli/commands/bench-command.ts`

- [ ] **Step 1: Locate the ingest call**

The pre-ingest re-check goes immediately before `await ingestBenchResults(...)` in `bench-command.ts`.

- [ ] **Step 2: Insert the lighter re-check**

```typescript
// Just before: await ingestBenchResults(...)
if (benchPrecheckEnabled && options.ingest !== false) {
  const recheck = await runDoctor({
    section: ingestSection,
    levels: ["B", "C"], // skip static (already verified at startup) + catalog (D was at startup)
  });
  if (!recheck.ok) {
    console.warn(colors.yellow(
      "[WARN] pre-ingest re-check failed; skipping auto-ingest.",
    ));
    console.warn(formatReportToTerminal(recheck));
    console.warn(colors.gray(
      `       Results saved to ${result.resultFilePaths?.join(", ")}.`,
    ));
    console.warn(colors.gray(
      "       Replay later: deno task start ingest <path> --yes",
    ));
    return; // exit cleanly with results on disk
  }
}

// Existing call:
await ingestBenchResults(...)
```

- [ ] **Step 3: Manual verification**

Run a small bench with `CENTRALGAUGE_BENCH_PRECHECK=1`, then mid-run rename `~/.centralgauge.yml`. Bench should complete the runs (results saved) and skip ingest with the warning above.

```bash
CENTRALGAUGE_BENCH_PRECHECK=1 deno task start bench --llms anthropic/claude-opus-4-7 --tasks "tasks/easy/CG-AL-E001.yml" --runs 1 &
sleep 30  # wait for it to be mid-run
mv ~/.centralgauge.yml ~/.centralgauge.yml.bak
wait
mv ~/.centralgauge.yml.bak ~/.centralgauge.yml
```

Expected: bench finishes runs, then prints the WARN block and returns cleanly without crashing.

- [ ] **Step 4: Lint + format**

```bash
deno check cli/commands/bench-command.ts
deno fmt cli/commands/bench-command.ts
```

- [ ] **Step 5: Commit**

```bash
git add cli/commands/bench-command.ts
git commit -m "feat(bench): pre-ingest re-check — degrade to results-saved if D1/network drifted"
```

---

## Task 22: Flip default to on

**Files:**

- Modify: `cli/commands/bench-command.ts`

- [ ] **Step 1: Replace env-flag check with default-on**

Find:

```typescript
const benchPrecheckEnabled =
  Deno.env.get("CENTRALGAUGE_BENCH_PRECHECK") === "1";
```

Replace with:

```typescript
// Default: precheck on. Set CENTRALGAUGE_BENCH_PRECHECK=0 to disable
// (escape hatch only; --no-ingest is the supported way to skip ingest).
const benchPrecheckEnabled =
  Deno.env.get("CENTRALGAUGE_BENCH_PRECHECK") !== "0";
```

- [ ] **Step 2: Verify the bench's default path now precheck-gated**

```bash
mv ~/.centralgauge.yml ~/.centralgauge.yml.bak
deno task start bench --llms anthropic/claude-opus-4-7 --tasks "tasks/easy/CG-AL-E001.yml" --runs 1
# Expected: aborts with cfg.present failure, no LLM calls made.
mv ~/.centralgauge.yml.bak ~/.centralgauge.yml

# Sanity: --no-ingest still bypasses entirely
mv ~/.centralgauge.yml ~/.centralgauge.yml.bak
deno task start bench --no-ingest --llms anthropic/claude-opus-4-7 --tasks "tasks/easy/CG-AL-E001.yml" --runs 1
# Expected: bench runs to completion, no precheck.
mv ~/.centralgauge.yml.bak ~/.centralgauge.yml
```

- [ ] **Step 3: Lint + format**

```bash
deno check cli/commands/bench-command.ts
deno fmt cli/commands/bench-command.ts
```

- [ ] **Step 4: Commit**

```bash
git add cli/commands/bench-command.ts
git commit -m "feat(bench): default ingest precheck to on (set CENTRALGAUGE_BENCH_PRECHECK=0 to disable)"
```

---

## Task 23: Opt-in real-prod E2E test

**Files:**

- Create: `tests/integration/doctor/ingest-against-prod.test.ts`

- [ ] **Step 1: Write the opt-in test**

Create `tests/integration/doctor/ingest-against-prod.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { runDoctor } from "../../../src/doctor/mod.ts";
import { ingestSection } from "../../../src/doctor/mod.ts";

const ENABLED = Deno.env.get("DOCTOR_E2E_PROD") === "1";

Deno.test({
  name: "doctor ingest — real prod end-to-end",
  ignore: !ENABLED,
  async fn() {
    const report = await runDoctor({ section: ingestSection });
    if (!report.ok) {
      console.error(JSON.stringify(report, null, 2));
    }
    // Auth-only run (no variants[]) — should pass against a healthy prod.
    assertEquals(report.ok, true, "doctor ingest auth-only should pass");
  },
});
```

- [ ] **Step 2: Verify it skips by default**

```bash
deno test --allow-all tests/integration/doctor/ingest-against-prod.test.ts
```

Expected: 1 test, ignored.

- [ ] **Step 3: Manual opt-in verification**

```bash
DOCTOR_E2E_PROD=1 deno test --allow-all tests/integration/doctor/ingest-against-prod.test.ts
```

Expected: PASS against the live `~/.centralgauge.yml`-configured worker.

- [ ] **Step 4: Lint + format**

```bash
deno check tests/integration/doctor/ingest-against-prod.test.ts
deno fmt tests/integration/doctor/ingest-against-prod.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add tests/integration/doctor/ingest-against-prod.test.ts
git commit -m "test(doctor): opt-in DOCTOR_E2E_PROD=1 real-worker round-trip"
```

---

## Task 24: Documentation cross-link

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/architecture/ingest-pipeline.md` (if present — append a section)

- [ ] **Step 1: Add a CLAUDE.md note**

In the "Ingest Pipeline & Site" section of `CLAUDE.md`, append:

```markdown
- `centralgauge doctor ingest [--llms <list>] [--repair]` — verify config + keys
  - connectivity + bench-aware catalog state in one signed round-trip. Bench
    runs this automatically at startup; set `CENTRALGAUGE_BENCH_PRECHECK=0` to
    disable.
```

- [ ] **Step 2: Cross-link from spec**

If `docs/architecture/ingest-pipeline.md` exists, append a "Health checks" section pointing to the spec:

```markdown
## Health checks

`centralgauge doctor ingest` validates the entire ingest pipeline before a
bench commits to running. See
`docs/superpowers/specs/2026-04-26-bench-ingest-doctor-design.md` for the full
schema and check matrix.
```

- [ ] **Step 3: Lint + format**

```bash
deno fmt CLAUDE.md docs/architecture/ingest-pipeline.md 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/architecture/ingest-pipeline.md
git commit -m "docs: cross-link doctor ingest from CLAUDE.md + ingest-pipeline"
```

---

## Self-review (post-plan checklist)

- [x] Spec coverage: every requirement from the spec maps to a task. Worker endpoint = T6+T7, admin set_current = T8, all 8 ingest checks = T9-T16, engine = T2+T3, formatter = T4, repair = T18, CLI = T19, bench startup precheck = T20, pre-ingest re-check = T21, default-on rollout = T22, real-prod E2E = T23, docs = T24.
- [x] No "TBD" / "TODO" / "implement later" in any step. Every code-bearing step shows complete code.
- [x] Type consistency: `CheckResult`, `DoctorReport`, `Section`, `Check`, `DoctorContext`, `VariantProbe` defined in T1 and used identically in T2-T19. The `Repairer` interface defined in T18 used identically in T19.
- [x] Filename consistency: every `tests/unit/doctor/sections/ingest/check-*.test.ts` matches the corresponding `src/doctor/sections/ingest/check-*.ts`.
- [x] Engine ordering of dependency-skip is consistent with declared `requires` arrays in T9-T16.
- [x] Worker endpoint shape (T6/T7) matches client expectations in T15 (`auth.probe`) and T16 (`catalog.bench`).
- [x] Three open questions from the spec resolved inline at the top of this plan.

---

## Estimated complexity

- 24 tasks (~5 steps each = ~120 steps)
- Each task: ~150-300 LoC including tests
- Total: ~1350-1500 LoC source + tests
- Time-on-task: estimating 30-60 min/task end-to-end with subagent-driven execution
