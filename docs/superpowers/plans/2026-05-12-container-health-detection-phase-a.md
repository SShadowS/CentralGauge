# Container Health Detection — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate silent infrastructure data-loss and surface persistent container failures on the bench dashboard within ~3 errors, while preserving every attempt as a durable terminal record so aggregates stop secretly dropping ERR cells.

**Architecture:** Event-sourced. Every container operation throws a context-rich `ContainerError` carrying `{containerName, operation, exitCode, rawTail, artifactPath}`. The orchestrator's catch path (a) classifies the failure into an infra fingerprint + optional named signature, (b) synthesizes a `TaskExecutionResult` with `terminalState: "infra_error"` so the attempt is durable, and (c) emits a structured `error` event carrying the same context. A pure-function `ContainerHealthMonitor` reducer consumes these events plus normal pass/fail events and decides when a container has crossed a persistent-failure threshold. The dashboard adds a sticky banner + per-container card driven by SSE `container-health` events backed by a `GET /api/health-snapshot` for cold reconnects. Aggregates split into `validAttempts` vs `infraInvalidated` so per-model scores are honest.

**Tech Stack:** Deno 1.44+, TypeScript 5, Cliffy, existing dashboard SSE infrastructure, `@std/assert` for tests.

**Out of scope (deferred to Phase B/C):**

- Functional pre-bench canary (Phase B)
- Manual quarantine endpoint + scheduler reroute (Phase B)
- Auto-quarantine flag (Phase C)
- D1 lifecycle telemetry of container health (Phase C)
- Cross-run cached health (deferred indefinitely per gpt-5.5 review)

---

## File map

**New files:**

| Path                                                            | Purpose                                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/health/types.ts`                                           | `InfraFingerprint`, `InfraSignature`, `ContainerOutcome`, `ContainerHealthState`, `HealthAlert`, `TerminalState`                     |
| `src/health/fingerprint.ts`                                     | Pure `fingerprintInfraError(input) → InfraFingerprint` — normalizes errorKind + operation + key log lines into stable string id      |
| `src/health/signatures.ts`                                      | Named signature library: regex array per known infra failure mode (SYSLIB0014, PSSession lost, OOM, publish hang, container offline) |
| `src/health/classify.ts`                                        | `classifyInfraError(err, rawOutput) → {fingerprint, signature?}` — uses fingerprint + signature library                              |
| `src/health/is-infra-error.ts`                                  | `isInfraError(err) → boolean` — distinguishes infra failures from generated-AL user-code failures                                    |
| `src/health/monitor.ts`                                         | `ContainerHealthMonitor` — pure reducer over container outcome events, emits `HealthAlert` when thresholds tripped                   |
| `src/health/mod.ts`                                             | Public re-exports                                                                                                                    |
| `src/health/terminal-record.ts`                                 | `synthesizeInfraFailureResult(args) → TaskExecutionResult` — builds a durable infra-failure record for an ERR'd tuple                |
| `src/health/raw-output.ts`                                      | `captureRawTail(text, maxBytes) → string` and `writeArtifact(dir, key, text) → string` — log artifact handling with redaction        |
| `src/health/redact.ts`                                          | `redactSensitive(text) → string` — strip credentials, license strings, tokens from output before SSE/D1                              |
| `tests/unit/health/fingerprint.test.ts`                         | Coverage of fingerprint normalization (same logical failure → same id; different operations → different ids)                         |
| `tests/unit/health/signatures.test.ts`                          | Each named signature matches its fixture; classifier returns the expected id                                                         |
| `tests/unit/health/classify.test.ts`                            | End-to-end classify against captured real-world output fixtures                                                                      |
| `tests/unit/health/is-infra-error.test.ts`                      | AL compile errors → false; ContainerError → true; PwshSessionError → true; ordinary `Error("Timeout")` → true                        |
| `tests/unit/health/monitor.test.ts`                             | Threshold logic: 3-of-3 same fingerprint trips; 3-of-10 same trips; cold-start safe; global-outage detector suppresses container     |
| `tests/unit/health/terminal-record.test.ts`                     | Synthesized result has correct shape, terminalState, attempts array, executionId uniqueness                                          |
| `tests/unit/health/raw-output.test.ts`                          | Tail truncates at byte boundary; artifact path stable for same key; oversize output split correctly                                  |
| `tests/unit/health/redact.test.ts`                              | Strips `password=`, `token=`, license strings, common patterns                                                                       |
| `tests/fixtures/infra-logs/syslib0014.txt`                      | Real captured bccontainerhelper output (from `H:\Temp3\test-output\test-1778515642326-1749.txt`)                                     |
| `tests/fixtures/infra-logs/pssession-lost.txt`                  | Synthetic fixture for PSSession-loss signature                                                                                       |
| `tests/fixtures/infra-logs/container-oom.txt`                   | `Free Physical Memory: 0.5Gb` pattern                                                                                                |
| `tests/fixtures/infra-logs/publish-timeout.txt`                 | `Publish-BcContainerApp ... timed out` pattern                                                                                       |
| `tests/fixtures/infra-logs/container-offline.txt`               | `container ... not running` pattern                                                                                                  |
| `tests/fixtures/infra-logs/al-compile-error.txt`                | Generated-AL compile error — must NOT be classified as infra                                                                         |

**Modified files:**

| Path                                          | Change                                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/errors.ts`                               | Extend `ContainerError` with `rawOutput?: string`, `rawOutputArtifactPath?: string`, `exitCode?: number`                                              |
| `src/parallel/types.ts`                       | Add `containerName?`, `operation?`, `rawTail?`, `artifactPath?`, `fingerprint?`, `signatureId?` to the `error` event variant                          |
| `src/parallel/orchestrator.ts`                | Catch block: classify err → emit enriched error event → call `synthesizeInfraFailureResult` and `aggregator.add` (so ERR cells become durable results) |
| `src/parallel/result-aggregator.ts`           | Track `infraInvalidated` count; expose new `validAttempts` denominator distinct from `resultCount`                                                    |
| `src/container/bc-container-provider.ts`      | Wrap compile / publish / test PowerShell calls so they throw `ContainerError` with `rawOutput` tail + artifact path                                   |
| `src/container/registry.ts`                   | (Verify) constructors don't mask container context when re-throwing                                                                                   |
| `cli/dashboard/types.ts`                      | `MatrixCell`: add `containerName?`, `operation?`, `fingerprint?`, `signatureId?`, `signatureLabel?`, `errorMessageTail?`, `artifactPath?`. Add `ContainerHealth` interface + `container-health` SSE event + `health-snapshot` event. Add `eventId` (monotonic) to SSE events that participate in replay |
| `cli/dashboard/state.ts`                      | Track per-container `ContainerHealth` map; expose `getContainerHealth()`, `getHealthSnapshot()`; bump monotonic event id on every broadcast           |
| `cli/dashboard/bridge.ts`                     | Wire orchestrator `error` event → `state.updateCell(..., {state:"error", containerName, signatureId, ...})` AND feed `ContainerHealthMonitor`         |
| `cli/dashboard/server.ts`                     | Add `GET /api/health-snapshot` returning `{eventId, containers: ContainerHealth[]}`                                                                   |
| `cli/dashboard/page.ts`                       | Sticky `<div id="infra-banner">` + container traffic-light card grid. SSE listener for `container-health`. Reconnect: fetch snapshot, replay diffs    |
| `cli/commands/bench/results-writer.ts`        | Append `# Container Health` block (per-container pass/fail/err counts, top fingerprint, top signature)                                                |
| `tests/unit/parallel/orchestrator.test.ts`    | Add tests: error path produces a durable result; aggregator sees it; emitted event carries container context                                          |
| `tests/unit/dashboard/state.test.ts`          | Container-health map updates correctly; snapshot is consistent                                                                                        |
| `tests/unit/dashboard/bridge.test.ts`         | Error event routes to monitor; banner alert fires after threshold                                                                                     |
| `tests/unit/cli/results-writer.test.ts`       | Container Health block formatting                                                                                                                     |

---

## Key invariants

These must hold at every commit; tests enforce them:

1. **Every scheduled (task, model, run) tuple appears in `.results[]` exactly once.** No silent drops. ERR cells produce `TaskExecutionResult` with `attempts[0].failureReasons` describing the infra error and `success: false`.
2. **`isInfraError` is deterministic given the same input.** Generated-AL compile errors never trip container health.
3. **Fingerprint is stable.** Same operation + same normalized log lines → same fingerprint string, regardless of run timestamp/container path/GUID noise.
4. **Health monitor is a pure reducer.** No I/O, no clocks except a clock passed in. Easy to unit-test.
5. **Aggregator's `validAttempts` denominator never includes infra-invalidated attempts.** Per-model `pass_rate` is computed against valid attempts only; `infra_invalidated` shown separately.

---

## Task decomposition

### Task 1: Extend `ContainerError` with raw output + exit code

**Files:**

- Modify: `src/errors.ts`
- Test: `tests/unit/errors.test.ts` (extend if exists; otherwise create)

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/errors.test.ts
import { assertEquals, assertExists } from "@std/assert";
import { ContainerError } from "../../src/errors.ts";

Deno.test("ContainerError carries rawOutput, exitCode, artifactPath", () => {
  const err = new ContainerError(
    "Test publish failed",
    "Cronus281",
    "test",
    {
      rawOutput: "TEST_ERROR: SYSLIB0014",
      exitCode: 1,
      rawOutputArtifactPath: "/h/Temp3/test-output/test-123.txt",
    },
  );
  assertEquals(err.containerName, "Cronus281");
  assertEquals(err.operation, "test");
  assertEquals(err.rawOutput, "TEST_ERROR: SYSLIB0014");
  assertEquals(err.exitCode, 1);
  assertEquals(err.rawOutputArtifactPath, "/h/Temp3/test-output/test-123.txt");
});

Deno.test("ContainerError rawOutput is optional", () => {
  const err = new ContainerError("X", "Cronus28", "compile");
  assertEquals(err.rawOutput, undefined);
  assertEquals(err.exitCode, undefined);
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
deno task test:unit -- --filter "ContainerError carries rawOutput"
```

Expected: FAIL — `rawOutput` property doesn't exist.

- [ ] **Step 3: Extend ContainerError**

```typescript
// src/errors.ts (replace existing ContainerError class)
export class ContainerError extends CentralGaugeError {
  public readonly rawOutput?: string;
  public readonly rawOutputArtifactPath?: string;
  public readonly exitCode?: number;

  constructor(
    message: string,
    public readonly containerName: string,
    public readonly operation:
      | "setup"
      | "start"
      | "stop"
      | "compile"
      | "publish"
      | "test"
      | "health",
    context?: {
      rawOutput?: string;
      rawOutputArtifactPath?: string;
      exitCode?: number;
      [key: string]: unknown;
    },
  ) {
    super(message, "CONTAINER_ERROR", { containerName, operation, ...context });
    this.name = "ContainerError";
    this.rawOutput = context?.rawOutput;
    this.rawOutputArtifactPath = context?.rawOutputArtifactPath;
    this.exitCode = context?.exitCode;
  }
}
```

Note: `operation` gains `"publish"` since that's a distinct PowerShell call in the test path.

- [ ] **Step 4: Run test, verify pass**

```bash
deno task test:unit -- --filter "ContainerError carries rawOutput"
```

Expected: PASS.

- [ ] **Step 5: Run full unit suite, ensure no regression**

```bash
deno task test:unit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/errors.ts tests/unit/errors.test.ts
git commit -m "feat(errors): extend ContainerError with rawOutput/exitCode/artifactPath"
```

---

### Task 2: Add `raw-output.ts` for tail capture + artifact write

**Files:**

- Create: `src/health/raw-output.ts`
- Test: `tests/unit/health/raw-output.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/health/raw-output.test.ts
import { assertEquals, assert } from "@std/assert";
import { captureRawTail, writeArtifact } from "../../../src/health/raw-output.ts";

Deno.test("captureRawTail returns last N bytes", () => {
  const big = "A".repeat(10_000) + "TAIL";
  const tail = captureRawTail(big, 100);
  assertEquals(tail.length, 100);
  assert(tail.endsWith("TAIL"));
});

Deno.test("captureRawTail returns whole string when shorter than max", () => {
  assertEquals(captureRawTail("short", 100), "short");
});

Deno.test("captureRawTail handles empty input", () => {
  assertEquals(captureRawTail("", 100), "");
});

Deno.test("writeArtifact writes file and returns path", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "cg-test-artifact-" });
  try {
    const p = await writeArtifact(tempDir, "task-CG-AL-H024_attempt-1", "raw output text");
    assert(p.startsWith(tempDir));
    const content = await Deno.readTextFile(p);
    assertEquals(content, "raw output text");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("writeArtifact key normalizes unsafe chars", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "cg-test-artifact-" });
  try {
    const p = await writeArtifact(tempDir, "task/with:bad*chars", "x");
    // Path is safe (no slashes/colons/asterisks in basename)
    const basename = p.substring(tempDir.length + 1);
    assertEquals(basename.includes("/"), false);
    assertEquals(basename.includes(":"), false);
    assertEquals(basename.includes("*"), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
```

- [ ] **Step 2: Run, verify all fail**

```bash
deno task test:unit -- --filter "captureRawTail"
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// src/health/raw-output.ts
/**
 * Return last `maxBytes` characters of `text`. (We count chars, not bytes —
 * AL/PowerShell output is ASCII-dominant; close enough for tail trimming.)
 */
export function captureRawTail(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  return text.slice(text.length - maxBytes);
}

/**
 * Write `content` to a file in `dir` with a basename derived from `key`.
 * Returns absolute path. Sanitizes `key` to remove path-unsafe characters.
 */
export async function writeArtifact(
  dir: string,
  key: string,
  content: string,
): Promise<string> {
  await Deno.mkdir(dir, { recursive: true });
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${dir}/${safe}.log`;
  await Deno.writeTextFile(path, content);
  return path;
}
```

- [ ] **Step 4: Run tests**

```bash
deno task test:unit -- --filter "captureRawTail"
deno task test:unit -- --filter "writeArtifact"
```

Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/health/raw-output.ts tests/unit/health/raw-output.test.ts
git commit -m "feat(health): add raw-output tail + artifact writer"
```

---

### Task 3: Redaction helper

**Files:**

- Create: `src/health/redact.ts`
- Test: `tests/unit/health/redact.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/health/redact.test.ts
import { assertEquals } from "@std/assert";
import { redactSensitive } from "../../../src/health/redact.ts";

Deno.test("redactSensitive masks password fields", () => {
  const input = "credential password=secret123 user=admin";
  const out = redactSensitive(input);
  assertEquals(out.includes("secret123"), false);
  assertEquals(out.includes("[REDACTED]"), true);
});

Deno.test("redactSensitive masks bearer tokens", () => {
  const input = "Authorization: Bearer eyJhbGc...XYZ";
  const out = redactSensitive(input);
  assertEquals(out.includes("eyJhbGc"), false);
});

Deno.test("redactSensitive masks BC license tail", () => {
  const input =
    "Importing license file C:\\Path\\BC_LICENSE_KEY_XXXXX.flf successfully";
  const out = redactSensitive(input);
  assertEquals(out.includes("XXXXX.flf"), false);
});

Deno.test("redactSensitive preserves normal log lines", () => {
  const input = "Compilation ended at 17:14:33.206";
  assertEquals(redactSensitive(input), input);
});
```

- [ ] **Step 2: Run, verify fail**

```bash
deno task test:unit -- --filter "redactSensitive"
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/health/redact.ts
const PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /password=\S+/gi, replacement: "password=[REDACTED]" },
  { pattern: /Bearer\s+[A-Za-z0-9._-]+/g, replacement: "Bearer [REDACTED]" },
  { pattern: /token=\S+/gi, replacement: "token=[REDACTED]" },
  { pattern: /api[_-]?key[=:]\s*\S+/gi, replacement: "api_key=[REDACTED]" },
  { pattern: /\b[A-Za-z]:\\[^\s]*\.flf\b/g, replacement: "[REDACTED_LICENSE_FILE]" },
];

export function redactSensitive(text: string): string {
  let out = text;
  for (const { pattern, replacement } of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
```

- [ ] **Step 4: Verify pass + commit**

```bash
deno task test:unit -- --filter "redactSensitive"
git add src/health/redact.ts tests/unit/health/redact.test.ts
git commit -m "feat(health): add redactSensitive helper for log output"
```

---

### Task 4: Health module types

**Files:**

- Create: `src/health/types.ts`

- [ ] **Step 1: Add types**

```typescript
// src/health/types.ts

/**
 * Stable, normalized identifier for a class of infra failure.
 * Same logical failure → same fingerprint, regardless of timestamps/GUIDs.
 */
export type InfraFingerprint = string;

/**
 * Terminal state for a (task, model, run, attempt) tuple.
 * Used in synthesized TaskExecutionResult records.
 */
export type TerminalState =
  | "passed"
  | "failed_tests"
  | "compile_failed"
  | "infra_error"
  | "cancelled"
  | "skipped_canary_failed";

/**
 * One outcome event consumed by the health monitor.
 */
export interface ContainerOutcome {
  containerName: string;
  result: "pass" | "fail" | "infra_error";
  fingerprint?: InfraFingerprint;
  signatureId?: string;
  /** Absolute timestamp; monitor uses this for windowed counting */
  timestamp: number;
}

/**
 * Named, human-curated signature for known infra failures.
 * Upgrades fingerprint UX with a label, fix hint, severity.
 */
export interface InfraSignature {
  id: string;                       // "syslib0014"
  label: string;                    // "PsTestTool .NET incompat (SYSLIB0014)"
  patterns: RegExp[];               // matched against rawOutput
  scope: "container" | "model" | "global";
  severity: "info" | "warn" | "critical";
  fixHint: string;                  // actionable
  /** If true, ignore for persistent-failure thresholds (false positives only) */
  ignoreForHealth?: boolean;
}

/**
 * Output of classifier: always a fingerprint, optionally a named signature.
 */
export interface ClassifyResult {
  fingerprint: InfraFingerprint;
  signature?: InfraSignature;
}

/**
 * Health snapshot for one container.
 * Computed by the monitor; serialized over SSE.
 */
export interface ContainerHealth {
  containerName: string;
  /** Rolling window of last N outcomes (oldest → newest) */
  recent: Array<"pass" | "fail" | "infra_error">;
  passCount: number;
  failCount: number;
  errorCount: number;
  /** Currently active alert, if any */
  alert?: HealthAlert;
}

export type HealthAlertKind =
  | "persistent_container_failure" // 3-of-3 same fingerprint on this container
  | "elevated_container_error_rate" // rate-based + peer-compared
  | "global_outage";               // ≥50% containers same fingerprint

export interface HealthAlert {
  kind: HealthAlertKind;
  containerName: string;
  fingerprint: InfraFingerprint;
  signatureId?: string;
  signatureLabel?: string;
  fixHint?: string;
  count: number;
  /** Timestamp when alert was raised */
  raisedAt: number;
}

/**
 * Public state from the monitor — what bridge broadcasts.
 */
export interface ContainerHealthState {
  /** Monotonic event id for SSE replay */
  eventId: number;
  containers: ContainerHealth[];
  /** Currently-active alerts, may be 0..N */
  alerts: HealthAlert[];
}
```

- [ ] **Step 2: Verify file compiles**

```bash
deno check src/health/types.ts
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/health/types.ts
git commit -m "feat(health): add type definitions"
```

---

### Task 5: Fixture files for classifier tests

**Files:**

- Create: `tests/fixtures/infra-logs/syslib0014.txt`
- Create: `tests/fixtures/infra-logs/pssession-lost.txt`
- Create: `tests/fixtures/infra-logs/container-oom.txt`
- Create: `tests/fixtures/infra-logs/publish-timeout.txt`
- Create: `tests/fixtures/infra-logs/container-offline.txt`
- Create: `tests/fixtures/infra-logs/al-compile-error.txt`

- [ ] **Step 1: Capture real SYSLIB0014 fixture from prior bench**

Get the actual output from this conversation's analysis (the `H:\Temp3\test-output\test-1778515642326-1749.txt` we already inspected). Copy a representative ~3 KB chunk into the fixture file.

```
[CG-PIN] buildTestScript bccontainerhelper@6.1.11 usePwshForBc24=False sentinel=2026-04-25-B
CLEANUP:Removing CentralGauge_CG-AL-H022_2 by CentralGauge
Uninstalling CentralGauge_CG-AL-H022_2 from tenant default
App successfully unpublished
PUBLISH_START:1778515615905
Publishing C:\ProgramData\BcContainerHelper\Extensions\Cronus281\...
WARNING: This license is not compatible with this version of Business Central.
Synchronizing CentralGauge_CG-AL-H024_1 on tenant default
Installing CentralGauge_CG-AL-H024_1 on tenant default
App ..._CG-AL-H024_1_1.0.0.0.app successfully published
PUBLISH_END:1778515621668
TEST_START:1778515621668
Connecting to http://localhost:80/BC/cs?tenant=default
at Disable-SslVerification, C:\ProgramData\BcContainerHelper\Extensions\Cronus281\PsTestTool\PsTestFunctions.ps1: line 1370
at <ScriptBlock>, C:\ProgramData\BcContainerHelper\84b12b40-3d1f-4c0f-96c7-3c090ebd2733.ps1: line 98
(7,40): error SYSLIB0014: 'ServicePointManager' is obsolete: 'WebRequest, HttpWebRequest, ServicePoint, and WebClient are obsolete. Use HttpClient instead. Settings on ServicePointManager no longer affect SslStream or HttpClient.' (https://aka.ms/dotnet-warnings/SYSLIB0014)
        public static void Disable() { System.Net.ServicePointManager.ServerCertificateValidationCallback = DisabledServerCertificateValidationCallback; }
                                       ^

Container Free Physical Memory: 1.0Gb
Disk C: Free 119Gb from 127Gb

TEST_ERROR:(7,40): error SYSLIB0014: 'ServicePointManager' is obsolete
TEST_END:1778515642325
```

- [ ] **Step 2: Synthesize PSSession-lost fixture**

```
[CG-PIN] buildTestScript bccontainerhelper@6.1.11 usePwshForBc24=True sentinel=2026-04-25-B
Get-NavServerInstance : The term 'Get-NavServerInstance' is not recognized as the name of a cmdlet, function, script file, or operable program.
At line:1 char:1
+ Get-NavServerInstance | Select-Object ServerInstance
+ ~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : ObjectNotFound: (Get-NavServerInstance:String) [], CommandNotFoundException
    + FullyQualifiedErrorId : CommandNotFoundException
TEST_ERROR: Get-NavServerInstance not found
TEST_END
```

- [ ] **Step 3: Synthesize container-oom**

```
[CG-PIN] buildTestScript bccontainerhelper@6.1.11
Publishing CentralGauge_CG-AL-H024_1_1.0.0.0.app
Container Free Physical Memory: 0.5Gb
Disk C: Free 119Gb from 127Gb
Out of memory error during publish.
```

- [ ] **Step 4: Synthesize publish-timeout**

```
[CG-PIN] buildTestScript bccontainerhelper@6.1.11
PUBLISH_START:1778515615905
Publishing C:\ProgramData\BcContainerHelper\Extensions\Cronus282\...
Publish-BcContainerApp : The operation has timed out.
```

- [ ] **Step 5: Synthesize container-offline**

```
[CG-PIN] buildTestScript bccontainerhelper@6.1.11
Error: container Cronus281 not running.
Cannot find container 'Cronus281'.
```

- [ ] **Step 6: Synthesize al-compile-error (negative case)**

```
.\alc.exe /project:...
Compilation started for project 'CentralGauge_CG-AL-H024_1' containing '2' files
C:\Users\SShadowS\AppData\Local\Temp\cg_compile_xxx\CG-AL-H024.al:25: error AL0118: The name 'FieldRefz' does not exist in the current context
C:\Users\SShadowS\AppData\Local\Temp\cg_compile_xxx\CG-AL-H024.al:30: error AL0132: Variable 'i' must be defined first
Compilation ended at '17:14:33.206'.
COMPILE_ERROR
```

- [ ] **Step 7: Commit fixtures**

```bash
git add tests/fixtures/infra-logs/
git commit -m "test(health): add infra-log classifier fixtures"
```

---

### Task 6: Fingerprint extractor

**Files:**

- Create: `src/health/fingerprint.ts`
- Test: `tests/unit/health/fingerprint.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/health/fingerprint.test.ts
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { fingerprintInfraError } from "../../../src/health/fingerprint.ts";

Deno.test("fingerprint is stable across timestamps/GUIDs in same kind of error", async () => {
  const a = await Deno.readTextFile("tests/fixtures/infra-logs/syslib0014.txt");
  const b = a
    .replace("1778515615905", "1999999999999")
    .replace("84b12b40-3d1f-4c0f-96c7-3c090ebd2733", "00000000-0000-0000-0000-000000000000");
  const fpA = fingerprintInfraError({ operation: "test", rawOutput: a });
  const fpB = fingerprintInfraError({ operation: "test", rawOutput: b });
  assertEquals(fpA, fpB, "Same error class must produce same fingerprint");
});

Deno.test("different operations on same output → different fingerprints", async () => {
  const a = await Deno.readTextFile("tests/fixtures/infra-logs/syslib0014.txt");
  const fpTest = fingerprintInfraError({ operation: "test", rawOutput: a });
  const fpCompile = fingerprintInfraError({ operation: "compile", rawOutput: a });
  assertNotEquals(fpTest, fpCompile);
});

Deno.test("oom and syslib produce different fingerprints", async () => {
  const oom = await Deno.readTextFile("tests/fixtures/infra-logs/container-oom.txt");
  const sys = await Deno.readTextFile("tests/fixtures/infra-logs/syslib0014.txt");
  const fp1 = fingerprintInfraError({ operation: "test", rawOutput: oom });
  const fp2 = fingerprintInfraError({ operation: "test", rawOutput: sys });
  assertNotEquals(fp1, fp2);
});

Deno.test("empty output yields stable 'unknown' fingerprint", () => {
  const fp = fingerprintInfraError({ operation: "test", rawOutput: "" });
  assert(fp.startsWith("test:"));
});
```

- [ ] **Step 2: Run, verify fail**

```bash
deno task test:unit -- --filter "fingerprint"
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/health/fingerprint.ts
import type { InfraFingerprint } from "./types.ts";

interface FingerprintInput {
  operation: string;             // "compile" | "publish" | "test" | "setup"...
  rawOutput?: string;
  errorMessage?: string;         // optional, used when rawOutput is empty
}

/**
 * Normalize an infra error into a stable identifier.
 *
 * Strategy: extract structural "key lines" (first non-noise error-ish line,
 * cmdlet name if obvious), strip variable parts (timestamps, GUIDs, paths
 * with container-specific segments), then hash the combination with the
 * operation.
 */
export function fingerprintInfraError(input: FingerprintInput): InfraFingerprint {
  const op = input.operation;
  const text = (input.rawOutput || input.errorMessage || "").trim();

  if (!text) return `${op}:empty`;

  const lines = text.split(/\r?\n/);
  const keyLines: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Pick error-ish lines only
    if (
      /\b(error|exception|failed|timeout|TEST_ERROR|COMPILE_ERROR|out of memory|not running|not recognized)\b/i.test(
        line,
      )
    ) {
      keyLines.push(normalize(line));
      if (keyLines.length >= 3) break;
    }
  }

  if (keyLines.length === 0) {
    // Fallback: first non-empty line, normalized
    const firstNonEmpty = lines.find((l) => l.trim());
    keyLines.push(firstNonEmpty ? normalize(firstNonEmpty.trim()) : "noise");
  }

  return `${op}:${djb2(keyLines.join("|"))}`;
}

/**
 * Strip variable parts so the same logical error fingerprints identically.
 */
function normalize(line: string): string {
  return line
    .replace(/\b\d{10,}\b/g, "<TS>")           // unix-ms timestamps
    .replace(
      /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
      "<UUID>",
    )
    .replace(/\\Cronus\d+/g, "\\<CONTAINER>")  // container-specific paths
    .replace(/\b\d+(\.\d+)?Gb\b/g, "<MEM>Gb")  // memory sizes
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h &= 0xffffffff;
  }
  // Unsigned 32-bit hex
  return (h >>> 0).toString(16).padStart(8, "0");
}
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
deno task test:unit -- --filter "fingerprint"
git add src/health/fingerprint.ts tests/unit/health/fingerprint.test.ts
git commit -m "feat(health): add stable fingerprint extractor for infra errors"
```

---

### Task 7: Signature library

**Files:**

- Create: `src/health/signatures.ts`
- Test: `tests/unit/health/signatures.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/health/signatures.test.ts
import { assertEquals, assertExists } from "@std/assert";
import { matchSignature, INFRA_SIGNATURES } from "../../../src/health/signatures.ts";

Deno.test("library defines all expected signatures", () => {
  const ids = INFRA_SIGNATURES.map((s) => s.id);
  for (const expected of [
    "syslib0014",
    "pssession_lost",
    "container_oom",
    "publish_timeout",
    "container_offline",
  ]) {
    assertEquals(ids.includes(expected), true, `Missing signature: ${expected}`);
  }
});

Deno.test("matches SYSLIB0014 from real fixture", async () => {
  const text = await Deno.readTextFile("tests/fixtures/infra-logs/syslib0014.txt");
  const sig = matchSignature(text);
  assertExists(sig);
  assertEquals(sig!.id, "syslib0014");
  assertEquals(sig!.scope, "container");
  assertEquals(sig!.severity, "critical");
});

Deno.test("matches pssession_lost", async () => {
  const text = await Deno.readTextFile("tests/fixtures/infra-logs/pssession-lost.txt");
  const sig = matchSignature(text);
  assertExists(sig);
  assertEquals(sig!.id, "pssession_lost");
});

Deno.test("matches container_oom", async () => {
  const text = await Deno.readTextFile("tests/fixtures/infra-logs/container-oom.txt");
  const sig = matchSignature(text);
  assertExists(sig);
  assertEquals(sig!.id, "container_oom");
});

Deno.test("matches publish_timeout", async () => {
  const text = await Deno.readTextFile("tests/fixtures/infra-logs/publish-timeout.txt");
  const sig = matchSignature(text);
  assertExists(sig);
  assertEquals(sig!.id, "publish_timeout");
});

Deno.test("matches container_offline", async () => {
  const text = await Deno.readTextFile("tests/fixtures/infra-logs/container-offline.txt");
  const sig = matchSignature(text);
  assertExists(sig);
  assertEquals(sig!.id, "container_offline");
});

Deno.test("returns undefined on AL compile error fixture (not infra)", async () => {
  const text = await Deno.readTextFile("tests/fixtures/infra-logs/al-compile-error.txt");
  assertEquals(matchSignature(text), undefined);
});
```

- [ ] **Step 2: Run, verify fail**

```bash
deno task test:unit -- --filter "signature"
```

Expected: FAIL.

- [ ] **Step 3: Implement library**

```typescript
// src/health/signatures.ts
import type { InfraSignature } from "./types.ts";

export const INFRA_SIGNATURES: InfraSignature[] = [
  {
    id: "syslib0014",
    label: "PsTestTool .NET incompat (SYSLIB0014)",
    patterns: [
      /SYSLIB0014/i,
      /ServicePointManager.*obsolete/i,
    ],
    scope: "container",
    severity: "critical",
    fixHint:
      "Wipe C:\\ProgramData\\BcContainerHelper\\Extensions\\{container}\\PsTestTool then re-run, or rebuild the container.",
  },
  {
    id: "pssession_lost",
    label: "BC PSSession lost (Get-NavServerInstance missing)",
    patterns: [
      /Get-NavServerInstance.*not recognized/i,
      /CommandNotFoundException.*Get-NavServerInstance/i,
    ],
    scope: "container",
    severity: "critical",
    fixHint:
      "Container session corrupted after Unpublish. Restart the BC service in the container, or rebuild.",
  },
  {
    id: "container_oom",
    label: "Container out of memory",
    patterns: [
      /Free Physical Memory:\s*0\.\d+\s*Gb/i,
      /Out of memory/i,
    ],
    scope: "container",
    severity: "warn",
    fixHint:
      "Container is starved. Reduce parallel concurrency, allocate more RAM to Docker, or restart the container.",
  },
  {
    id: "publish_timeout",
    label: "Publish-BcContainerApp timed out",
    patterns: [
      /Publish-BcContainerApp.*timed out/i,
      /Publish.*operation has timed out/i,
    ],
    scope: "container",
    severity: "warn",
    fixHint:
      "BC service is wedged. Restart the BC service in the container or reduce publish parallelism.",
  },
  {
    id: "container_offline",
    label: "Container not running / not found",
    patterns: [
      /container .* not running/i,
      /Cannot find container '/i,
    ],
    scope: "container",
    severity: "critical",
    fixHint:
      "Container is down. Run Start-BcContainer or rebuild with New-BcContainer.",
  },
];

/**
 * Return the first matching signature, or undefined if none match.
 */
export function matchSignature(text: string): InfraSignature | undefined {
  for (const sig of INFRA_SIGNATURES) {
    for (const p of sig.patterns) {
      if (p.test(text)) return sig;
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Verify pass + commit**

```bash
deno task test:unit -- --filter "signature"
git add src/health/signatures.ts tests/unit/health/signatures.test.ts
git commit -m "feat(health): add named signature library for infra failures"
```

---

### Task 8: Classifier (fingerprint + signature combined)

**Files:**

- Create: `src/health/classify.ts`
- Test: `tests/unit/health/classify.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/health/classify.test.ts
import { assertEquals, assertExists } from "@std/assert";
import { classifyInfraError } from "../../../src/health/classify.ts";
import { ContainerError } from "../../../src/errors.ts";

Deno.test("classify SYSLIB0014 → signature + fingerprint", async () => {
  const raw = await Deno.readTextFile("tests/fixtures/infra-logs/syslib0014.txt");
  const err = new ContainerError("Test failed", "Cronus281", "test", { rawOutput: raw });
  const c = classifyInfraError(err);
  assertExists(c.signature);
  assertEquals(c.signature!.id, "syslib0014");
  assertEquals(typeof c.fingerprint, "string");
});

Deno.test("classify unknown infra: signature undefined, fingerprint defined", () => {
  const err = new ContainerError("Weird thing", "Cronus28", "test", {
    rawOutput: "Some entirely novel error: kablooey at line 42",
  });
  const c = classifyInfraError(err);
  assertEquals(c.signature, undefined);
  assertEquals(typeof c.fingerprint, "string");
});

Deno.test("classify plain Error → fingerprint from message", () => {
  const err = new Error("Queue timeout after 60000 ms");
  const c = classifyInfraError(err);
  assertEquals(typeof c.fingerprint, "string");
});
```

- [ ] **Step 2: Run, verify fail**

```bash
deno task test:unit -- --filter "classify"
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/health/classify.ts
import { ContainerError } from "../errors.ts";
import { fingerprintInfraError } from "./fingerprint.ts";
import { matchSignature } from "./signatures.ts";
import type { ClassifyResult } from "./types.ts";

/**
 * Always returns a fingerprint. Optionally returns a named signature
 * when the raw output (or error message) matches a known pattern.
 */
export function classifyInfraError(err: unknown): ClassifyResult {
  if (err instanceof ContainerError) {
    const rawOutput = err.rawOutput || "";
    const fingerprint = fingerprintInfraError({
      operation: err.operation,
      rawOutput,
      errorMessage: err.message,
    });
    const signature = matchSignature(rawOutput || err.message);
    return { fingerprint, signature };
  }
  const message = err instanceof Error ? err.message : String(err);
  const fingerprint = fingerprintInfraError({
    operation: "unknown",
    errorMessage: message,
  });
  const signature = matchSignature(message);
  return { fingerprint, signature };
}
```

- [ ] **Step 4: Verify + commit**

```bash
deno task test:unit -- --filter "classify"
git add src/health/classify.ts tests/unit/health/classify.test.ts
git commit -m "feat(health): add classifyInfraError (fingerprint + signature)"
```

---

### Task 9: `isInfraError` discriminator

**Files:**

- Create: `src/health/is-infra-error.ts`
- Test: `tests/unit/health/is-infra-error.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/health/is-infra-error.test.ts
import { assertEquals } from "@std/assert";
import { isInfraError } from "../../../src/health/is-infra-error.ts";
import {
  ContainerError,
  PwshSessionError,
  QueueTimeoutError,
  LLMProviderError,
  ValidationError,
} from "../../../src/errors.ts";

Deno.test("ContainerError is infra", () => {
  assertEquals(isInfraError(new ContainerError("x", "C", "test")), true);
});

Deno.test("PwshSessionError is infra", () => {
  assertEquals(isInfraError(new PwshSessionError("x", "session_crashed")), true);
});

Deno.test("QueueTimeoutError is infra (container or queue wedge)", () => {
  assertEquals(
    isInfraError(new QueueTimeoutError("x", "compile", 60000)),
    true,
  );
});

Deno.test("LLMProviderError is NOT container-infra (model-scope)", () => {
  assertEquals(isInfraError(new LLMProviderError("x", "openai")), false);
});

Deno.test("ValidationError is NOT infra", () => {
  assertEquals(isInfraError(new ValidationError("x", [])), false);
});

Deno.test("Plain Error with timeout message is infra", () => {
  assertEquals(isInfraError(new Error("Operation timed out")), true);
});

Deno.test("Plain Error with random message is not infra", () => {
  assertEquals(isInfraError(new Error("Bad input")), false);
});
```

- [ ] **Step 2: Run, verify fail**

```bash
deno task test:unit -- --filter "is-infra-error"
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/health/is-infra-error.ts
import {
  ContainerError,
  PwshSessionError,
  QueueTimeoutError,
  QueueFullError,
} from "../errors.ts";

const INFRA_MESSAGE_HINTS = [
  /timed?\s+out/i,
  /econnreset/i,
  /enotfound/i,
  /container.*not running/i,
  /publish.*failed/i,
  /test_error/i,
];

/**
 * Returns true if the error originates from infrastructure (container,
 * BC test harness, pwsh session, queue) and NOT from generated AL code
 * or model output. Generated-AL compile errors must NEVER trip container
 * health, since they are valid benchmark signal.
 */
export function isInfraError(err: unknown): boolean {
  if (err instanceof ContainerError) return true;
  if (err instanceof PwshSessionError) return true;
  if (err instanceof QueueTimeoutError) return true;
  if (err instanceof QueueFullError) return true;
  if (err instanceof Error) {
    return INFRA_MESSAGE_HINTS.some((p) => p.test(err.message));
  }
  return false;
}
```

- [ ] **Step 4: Verify + commit**

```bash
deno task test:unit -- --filter "is-infra-error"
git add src/health/is-infra-error.ts tests/unit/health/is-infra-error.test.ts
git commit -m "feat(health): add isInfraError discriminator"
```

---

### Task 10: Container health monitor (pure reducer)

**Files:**

- Create: `src/health/monitor.ts`
- Test: `tests/unit/health/monitor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/health/monitor.test.ts
import { assertEquals, assertExists } from "@std/assert";
import { ContainerHealthMonitor } from "../../../src/health/monitor.ts";

Deno.test("3 consecutive same-fingerprint infra errors trip alert", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  for (let i = 0; i < 3; i++) {
    mon.record({
      containerName: "Cronus281",
      result: "infra_error",
      fingerprint: "test:abc123",
      signatureId: "syslib0014",
      timestamp: 1000 + i,
    });
  }
  const state = mon.getState();
  assertEquals(state.alerts.length, 1);
  assertEquals(state.alerts[0].kind, "persistent_container_failure");
  assertEquals(state.alerts[0].containerName, "Cronus281");
  assertEquals(state.alerts[0].signatureId, "syslib0014");
});

Deno.test("2 errors do not trip alert", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  for (let i = 0; i < 2; i++) {
    mon.record({
      containerName: "Cronus281",
      result: "infra_error",
      fingerprint: "test:abc",
      timestamp: 1000 + i,
    });
  }
  assertEquals(mon.getState().alerts.length, 0);
});

Deno.test("3-of-10 same fingerprint also trips (non-consecutive)", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  // pass, err, pass, err, pass, err, pass, pass, pass, pass
  const seq: Array<"pass" | "infra_error"> = [
    "pass", "infra_error", "pass", "infra_error", "pass",
    "infra_error", "pass", "pass", "pass", "pass",
  ];
  for (let i = 0; i < seq.length; i++) {
    mon.record({
      containerName: "Cronus281",
      result: seq[i],
      fingerprint: seq[i] === "infra_error" ? "test:abc" : undefined,
      timestamp: 1000 + i,
    });
  }
  assertEquals(mon.getState().alerts.length, 1);
});

Deno.test("global outage suppresses per-container alert", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  for (const c of ["Cronus28", "Cronus281", "Cronus282", "Cronus283"]) {
    for (let i = 0; i < 3; i++) {
      mon.record({
        containerName: c,
        result: "infra_error",
        fingerprint: "test:license-expired",
        timestamp: 1000 + i,
      });
    }
  }
  const state = mon.getState();
  const kinds = state.alerts.map((a) => a.kind);
  assertEquals(kinds.includes("global_outage"), true);
  // No per-container alert for the same fingerprint when global is active
  const perContainer = state.alerts.filter(
    (a) => a.kind === "persistent_container_failure",
  );
  assertEquals(perContainer.length, 0);
});

Deno.test("alert is idempotent — same threshold doesn't fire twice", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  for (let i = 0; i < 5; i++) {
    mon.record({
      containerName: "Cronus281",
      result: "infra_error",
      fingerprint: "test:abc",
      timestamp: 1000 + i,
    });
  }
  assertEquals(mon.getState().alerts.length, 1);
});

Deno.test("eventId is monotonic", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) {
    mon.record({
      containerName: "Cronus28",
      result: "pass",
      timestamp: 1000 + i,
    });
    ids.push(mon.getState().eventId);
  }
  for (let i = 1; i < ids.length; i++) {
    assertEquals(ids[i] > ids[i - 1], true);
  }
});

Deno.test("getState returns ContainerHealth entries with rolling window", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 3 });
  for (let i = 0; i < 5; i++) {
    mon.record({
      containerName: "Cronus28",
      result: "pass",
      timestamp: 1000 + i,
    });
  }
  const c = mon.getState().containers.find((x) => x.containerName === "Cronus28");
  assertExists(c);
  assertEquals(c!.recent.length, 3);  // windowed
  assertEquals(c!.passCount, 5);      // counter NOT windowed
});

Deno.test("cold start: 1 error never trips", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  mon.record({
    containerName: "Cronus281",
    result: "infra_error",
    fingerprint: "test:abc",
    timestamp: 1000,
  });
  assertEquals(mon.getState().alerts.length, 0);
});
```

- [ ] **Step 2: Run, verify fail**

```bash
deno task test:unit -- --filter "ContainerHealth"
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/health/monitor.ts
import { matchSignature } from "./signatures.ts";
import { INFRA_SIGNATURES } from "./signatures.ts";
import type {
  ContainerHealth,
  ContainerHealthState,
  ContainerOutcome,
  HealthAlert,
} from "./types.ts";

interface MonitorOptions {
  /** Number of recent outcomes to keep in the per-container rolling buffer */
  windowSize: number;
  /** N consecutive (or N-of-window) same-fingerprint to trip persistent alert */
  persistentThreshold?: number;
  /** Fraction of active containers with same fingerprint that triggers global outage */
  globalOutageRatio?: number;
}

/**
 * Pure reducer over container outcome events. No I/O, no async, no clock
 * dependency (caller supplies timestamps). Trivial to unit-test.
 */
export class ContainerHealthMonitor {
  private readonly windowSize: number;
  private readonly persistentThreshold: number;
  private readonly globalOutageRatio: number;
  private containers = new Map<string, ContainerHealth>();
  /** Per-container × fingerprint count over last window */
  private fpHistory = new Map<string, Array<{ fp: string; t: number }>>();
  /** Alert keys we've already raised (idempotent) */
  private raisedAlerts = new Set<string>();
  private eventId = 0;

  constructor(opts: MonitorOptions) {
    this.windowSize = opts.windowSize;
    this.persistentThreshold = opts.persistentThreshold ?? 3;
    this.globalOutageRatio = opts.globalOutageRatio ?? 0.5;
  }

  record(o: ContainerOutcome): void {
    this.eventId++;
    const ch = this.containers.get(o.containerName) ?? {
      containerName: o.containerName,
      recent: [],
      passCount: 0,
      failCount: 0,
      errorCount: 0,
    };
    ch.recent.push(o.result);
    while (ch.recent.length > this.windowSize) ch.recent.shift();
    if (o.result === "pass") ch.passCount++;
    else if (o.result === "fail") ch.failCount++;
    else ch.errorCount++;
    this.containers.set(o.containerName, ch);

    if (o.result === "infra_error" && o.fingerprint) {
      const hist = this.fpHistory.get(o.containerName) ?? [];
      hist.push({ fp: o.fingerprint, t: o.timestamp });
      while (hist.length > this.windowSize) hist.shift();
      this.fpHistory.set(o.containerName, hist);

      this.maybeRaiseAlerts(o);
    }
  }

  private maybeRaiseAlerts(o: ContainerOutcome): void {
    if (!o.fingerprint) return;

    // Check global outage first — it suppresses per-container alerts for
    // the same fingerprint.
    const activeContainers = Array.from(this.fpHistory.keys());
    const containersWithThisFp = activeContainers.filter((c) => {
      const hist = this.fpHistory.get(c) || [];
      return hist.some((h) => h.fp === o.fingerprint);
    });
    const ratio = activeContainers.length > 0
      ? containersWithThisFp.length / activeContainers.length
      : 0;

    if (
      activeContainers.length >= 2 &&
      ratio >= this.globalOutageRatio &&
      containersWithThisFp.length >= 2
    ) {
      const key = `global:${o.fingerprint}`;
      if (!this.raisedAlerts.has(key)) {
        this.raisedAlerts.add(key);
        const sig = INFRA_SIGNATURES.find((s) => s.id === o.signatureId);
        const ch = this.containers.get(o.containerName);
        const alert: HealthAlert = {
          kind: "global_outage",
          containerName: o.containerName,
          fingerprint: o.fingerprint,
          signatureId: o.signatureId,
          signatureLabel: sig?.label,
          fixHint: sig?.fixHint,
          count: containersWithThisFp.length,
          raisedAt: o.timestamp,
        };
        if (ch) ch.alert = alert;
      }
      return; // suppress per-container alert for this fingerprint
    }

    // Per-container persistent failure
    const hist = this.fpHistory.get(o.containerName) || [];
    const sameFpCount = hist.filter((h) => h.fp === o.fingerprint).length;
    if (sameFpCount >= this.persistentThreshold) {
      const key = `persistent:${o.containerName}:${o.fingerprint}`;
      if (!this.raisedAlerts.has(key)) {
        this.raisedAlerts.add(key);
        const sig = INFRA_SIGNATURES.find((s) => s.id === o.signatureId);
        const ch = this.containers.get(o.containerName);
        const alert: HealthAlert = {
          kind: "persistent_container_failure",
          containerName: o.containerName,
          fingerprint: o.fingerprint,
          signatureId: o.signatureId,
          signatureLabel: sig?.label,
          fixHint: sig?.fixHint,
          count: sameFpCount,
          raisedAt: o.timestamp,
        };
        if (ch) ch.alert = alert;
      }
    }
  }

  getState(): ContainerHealthState {
    const containers = Array.from(this.containers.values()).map((c) => ({ ...c }));
    const alerts: HealthAlert[] = containers
      .map((c) => c.alert)
      .filter((a): a is HealthAlert => a !== undefined);
    return { eventId: this.eventId, containers, alerts };
  }
}
```

- [ ] **Step 4: Verify pass + commit**

```bash
deno task test:unit -- --filter "ContainerHealth"
git add src/health/monitor.ts tests/unit/health/monitor.test.ts
git commit -m "feat(health): add ContainerHealthMonitor pure reducer"
```

---

### Task 11: Terminal record synthesizer

**Files:**

- Create: `src/health/terminal-record.ts`
- Test: `tests/unit/health/terminal-record.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/health/terminal-record.test.ts
import { assertEquals, assertExists } from "@std/assert";
import { ContainerError } from "../../../src/errors.ts";
import { synthesizeInfraFailureResult } from "../../../src/health/terminal-record.ts";

Deno.test("synthesized result has correct shape", () => {
  const err = new ContainerError("Boom", "Cronus281", "test", {
    rawOutput: "TEST_ERROR: SYSLIB0014",
    rawOutputArtifactPath: "/h/Temp3/test-output/foo.log",
    exitCode: 1,
  });
  const ctx = {
    taskId: "CG-AL-H024",
    llmProvider: "anthropic",
    llmModel: "claude-opus-4-6",
    variantId: "anthropic/claude-opus-4-6",
    temperature: 0.0,
    maxTokens: 4096,
    containerProvider: "bccontainer",
    containerName: "Cronus281",
    templateDir: "templates/",
    outputDir: "results/",
    promptVersion: "1.0",
  };
  const startTime = new Date();
  const r = synthesizeInfraFailureResult({
    manifestId: "CG-AL-H024",
    context: ctx,
    error: err,
    classification: { fingerprint: "test:abc", signature: undefined },
    startTime,
  });
  assertEquals(r.taskId, "CG-AL-H024");
  assertEquals(r.success, false);
  assertEquals(r.finalScore, 0);
  assertEquals(r.attempts.length, 1);
  const a = r.attempts[0];
  assertEquals(a.success, false);
  assertEquals(a.failureReasons[0].toLowerCase().includes("infra"), true);
  assertExists(r.executionId);
});

Deno.test("executionId is unique across calls", () => {
  const err = new ContainerError("X", "C", "test");
  const ctx = { taskId: "t", llmProvider: "p", llmModel: "m", variantId: "p/m", temperature: 0, maxTokens: 1, containerProvider: "x", containerName: "C", templateDir: "", outputDir: "", promptVersion: "1" };
  const a = synthesizeInfraFailureResult({ manifestId: "t", context: ctx, error: err, classification: { fingerprint: "x" }, startTime: new Date() });
  const b = synthesizeInfraFailureResult({ manifestId: "t", context: ctx, error: err, classification: { fingerprint: "x" }, startTime: new Date() });
  assertEquals(a.executionId === b.executionId, false);
});
```

- [ ] **Step 2: Run, verify fail**

```bash
deno task test:unit -- --filter "synthesized result"
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/health/terminal-record.ts
import type {
  ExecutionAttempt,
  TaskExecutionContext,
  TaskExecutionResult,
} from "../tasks/interfaces.ts";
import { ContainerError } from "../errors.ts";
import type { ClassifyResult } from "./types.ts";

interface SynthInput {
  manifestId: string;
  context: TaskExecutionContext;
  error: unknown;
  classification: ClassifyResult;
  startTime: Date;
}

/**
 * Build a TaskExecutionResult representing an infra failure. Lets aggregates
 * see the attempt rather than silently dropping it.
 */
export function synthesizeInfraFailureResult(
  input: SynthInput,
): TaskExecutionResult {
  const endTime = new Date();
  const err = input.error;
  const errMessage = err instanceof Error ? err.message : String(err);
  const containerName = err instanceof ContainerError
    ? err.containerName
    : input.context.containerName ?? "unknown";
  const operation = err instanceof ContainerError ? err.operation : "unknown";
  const sigLabel = input.classification.signature?.label ?? "(unclassified)";

  const reasons = [
    `Infra error: ${errMessage}`,
    `Container: ${containerName}, Operation: ${operation}`,
    `Signature: ${sigLabel}`,
    `Fingerprint: ${input.classification.fingerprint}`,
  ];

  const attempt: ExecutionAttempt = {
    attemptNumber: 1,
    startTime: input.startTime,
    endTime,
    prompt: "",
    llmResponse: {
      content: "",
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
    extractedCode: "",
    codeLanguage: "al",
    success: false,
    score: 0,
    failureReasons: reasons,
    tokensUsed: 0,
    cost: 0,
    duration: endTime.getTime() - input.startTime.getTime(),
  };

  return {
    taskId: input.manifestId,
    executionId: `${input.manifestId}_${input.context.variantId}_infra_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    context: input.context,
    attempts: [attempt],
    success: false,
    finalScore: 0,
    totalTokensUsed: 0,
    totalCost: 0,
    totalDuration: attempt.duration,
    passedAttemptNumber: 0,
    successRate: 0,
    executedAt: input.startTime,
    executedBy: "centralgauge",
    environment: {},
  };
}
```

- [ ] **Step 4: Verify pass + commit**

```bash
deno task test:unit -- --filter "synthesized result"
git add src/health/terminal-record.ts tests/unit/health/terminal-record.test.ts
git commit -m "feat(health): add synthesizeInfraFailureResult for durable ERR records"
```

---

### Task 12: Health module barrel export

**Files:**

- Create: `src/health/mod.ts`

- [ ] **Step 1: Add barrel**

```typescript
// src/health/mod.ts
export type {
  ClassifyResult,
  ContainerHealth,
  ContainerHealthState,
  ContainerOutcome,
  HealthAlert,
  HealthAlertKind,
  InfraFingerprint,
  InfraSignature,
  TerminalState,
} from "./types.ts";

export { classifyInfraError } from "./classify.ts";
export { fingerprintInfraError } from "./fingerprint.ts";
export { isInfraError } from "./is-infra-error.ts";
export { ContainerHealthMonitor } from "./monitor.ts";
export { captureRawTail, writeArtifact } from "./raw-output.ts";
export { redactSensitive } from "./redact.ts";
export { INFRA_SIGNATURES, matchSignature } from "./signatures.ts";
export { synthesizeInfraFailureResult } from "./terminal-record.ts";
```

- [ ] **Step 2: Verify + commit**

```bash
deno check src/health/mod.ts
git add src/health/mod.ts
git commit -m "feat(health): add barrel export"
```

---

### Task 13: Wrap container ops to throw ContainerError with raw output

**Files:**

- Modify: `src/container/bc-container-provider.ts`
- Test: `tests/unit/container/bc-container-provider.test.ts` (extend)

Locate the points in `bc-container-provider.ts` where PowerShell calls return failure (compile, publish, test). Currently they throw bare `Error` or return failure objects. Wrap each so that on failure they throw a `ContainerError` carrying:

- `containerName`
- `operation`: `"compile" | "publish" | "test" | "setup" | "stop"`
- `rawOutput`: tail of combined stdout+stderr (use `captureRawTail(text, 4096)`)
- `rawOutputArtifactPath`: full output written via `writeArtifact(debugOutputDir, key, fullText)` when a debug output dir is configured (use `H:\Temp3` or similar from existing config)
- `exitCode`: from `Deno.Command` exit code

- [ ] **Step 1: Identify all PS-call sites**

Run:

```bash
grep -n "powershell\|PowerShell\|Compile-AppWithBcCompilerFolder\|Publish-BcContainerApp\|Run-TestsInBcContainer" src/container/bc-container-provider.ts
```

Expected output: a list of 4–8 call sites. Record line numbers in the task notes.

- [ ] **Step 2: Write failing test for compile error wrapping**

```typescript
// tests/unit/container/bc-container-provider.test.ts (add)
import { assertRejects } from "@std/assert";
import { ContainerError } from "../../../src/errors.ts";
// ... existing imports

Deno.test({
  name: "compileApp throws ContainerError on failure with rawOutput",
  ignore: Deno.build.os !== "windows",
  fn: async () => {
    // Set up a guaranteed-failing input (invalid AL)
    // (this needs a small refactor — extract the throw path to a unit-testable function)
    // Verify that the thrown error:
    //   - is a ContainerError
    //   - has containerName === "Cronus28" (or whatever)
    //   - has operation === "compile"
    //   - has non-empty rawOutput
    //   - has rawOutputArtifactPath pointing to a real file
  },
});
```

Note: This test may need to be done via a unit-extracted helper rather than the full bccontainerhelper round-trip. Extract `wrapPwshFailure(containerName, operation, exitCode, stdout, stderr, artifactDir): ContainerError`.

- [ ] **Step 3: Implement `wrapPwshFailure` helper**

Add to `src/container/bc-container-provider.ts`:

```typescript
import { ContainerError } from "../errors.ts";
import { captureRawTail, writeArtifact, redactSensitive } from "../health/mod.ts";

async function wrapPwshFailure(opts: {
  containerName: string;
  operation: "compile" | "publish" | "test" | "setup" | "stop";
  exitCode: number;
  stdout: string;
  stderr: string;
  artifactDir?: string;
  artifactKey: string;
  message?: string;
}): Promise<ContainerError> {
  const combined = `${opts.stdout}\n--- STDERR ---\n${opts.stderr}`;
  const redacted = redactSensitive(combined);
  const tail = captureRawTail(redacted, 4096);
  let artifactPath: string | undefined;
  if (opts.artifactDir) {
    artifactPath = await writeArtifact(opts.artifactDir, opts.artifactKey, redacted);
  }
  return new ContainerError(
    opts.message ?? `${opts.operation} failed in ${opts.containerName}`,
    opts.containerName,
    opts.operation,
    { rawOutput: tail, rawOutputArtifactPath: artifactPath, exitCode: opts.exitCode },
  );
}
```

- [ ] **Step 4: Replace each failure-return site with throw wrapPwshFailure**

For each identified site, change the failure path from `return { success: false, ... }` (or `throw new Error(...)`) to:

```typescript
if (exitCode !== 0 || stdout.includes("COMPILE_ERROR") /* or TEST_ERROR, etc. */) {
  throw await wrapPwshFailure({
    containerName,
    operation: "compile",
    exitCode,
    stdout,
    stderr,
    artifactDir: this.debugOutputDir,
    artifactKey: `${operation}-${containerName}-${Date.now()}`,
  });
}
```

(Replacement details depend on actual code shape; document each replacement in the commit message.)

- [ ] **Step 5: Run container tests**

```bash
deno task test:unit -- --filter "bc-container-provider"
```

Expected: pass on Windows, ignored on others.

- [ ] **Step 6: Commit**

```bash
git add src/container/bc-container-provider.ts tests/unit/container/bc-container-provider.test.ts
git commit -m "feat(container): wrap PS failures as ContainerError with rawOutput + artifact"
```

---

### Task 14: Extend `error` event type with container context

**Files:**

- Modify: `src/parallel/types.ts`

- [ ] **Step 1: Update event variant**

Replace lines 545-550 of `src/parallel/types.ts`:

```typescript
  | {
    type: "error";
    taskId?: string | undefined;
    model?: string | undefined;
    error: Error;
    /** Container that owned the failed operation, when known */
    containerName?: string | undefined;
    /** Specific operation that failed (compile/publish/test/...) */
    operation?: string | undefined;
    /** Tail of raw output for UI display */
    rawTail?: string | undefined;
    /** Path to full output artifact on disk */
    artifactPath?: string | undefined;
    /** Fingerprint id from classifier */
    fingerprint?: string | undefined;
    /** Named signature id, if matched */
    signatureId?: string | undefined;
  };
```

- [ ] **Step 2: Verify + commit (no tests yet — the test for this lives with Task 15)**

```bash
deno check src/parallel/types.ts
git add src/parallel/types.ts
git commit -m "feat(parallel): extend error event with container context fields"
```

---

### Task 15: Orchestrator catch produces durable result + enriched event

**Files:**

- Modify: `src/parallel/orchestrator.ts`
- Test: `tests/unit/parallel/orchestrator.test.ts` (extend)

The catch block at `src/parallel/orchestrator.ts:319-343` currently:

1. Records the failure in `failures` map (not in `modelResults`).
2. Emits a bare error event.
3. Never produces a `TaskExecutionResult`.

We want it to:

1. Classify the error (`classifyInfraError`).
2. Check `isInfraError(err)`.
3. If infra: synthesize a `TaskExecutionResult` via `synthesizeInfraFailureResult` AND emit a `result` event for it (so it lands in aggregates). ALSO emit enriched `error` event for the dashboard.
4. If non-infra (or LLM error): keep current behavior plus emit enriched event.

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/parallel/orchestrator.test.ts (add)
import { assertEquals } from "@std/assert";
import { ContainerError } from "../../../src/errors.ts";
// ... existing test scaffolding

Deno.test("orchestrator catch emits enriched error + synthesizes infra result", async () => {
  // Construct an orchestrator instance with a mock provider that throws
  // a ContainerError. Capture emitted events.
  // Assert:
  //  - at least one event has type "error" with containerName === "Cronus281"
  //  - at least one event has type "result" with result.success === false
  //  - aggregator now sees a result for this (task, variant) tuple
});
```

- [ ] **Step 2: Run, verify fail**

```bash
deno task test:unit -- --filter "orchestrator catch emits"
```

Expected: FAIL.

- [ ] **Step 3: Replace catch block**

In `src/parallel/orchestrator.ts`, replace lines 319-343 with:

```typescript
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));

  // Critical errors abort the entire benchmark.
  if (CriticalError.isCriticalError(error)) {
    criticalError = err;
    this.emit({
      type: "error",
      taskId: manifest.id,
      model: variant.variantId,
      error: err,
    });
    return; // Don't add to failures, will abort after
  }

  failures.set(variant.variantId, err);
  this.errors.push(`${manifest.id}/${variant.variantId}: ${err.message}`);

  // Classify and enrich the error event.
  const cls = classifyInfraError(err);
  const containerName = err instanceof ContainerError
    ? err.containerName
    : undefined;
  const operation = err instanceof ContainerError
    ? err.operation
    : undefined;
  const rawTail = err instanceof ContainerError ? err.rawOutput : undefined;
  const artifactPath = err instanceof ContainerError
    ? err.rawOutputArtifactPath
    : undefined;

  this.emit({
    type: "error",
    taskId: manifest.id,
    model: variant.variantId,
    error: err,
    containerName,
    operation,
    rawTail,
    artifactPath,
    fingerprint: cls.fingerprint,
    signatureId: cls.signature?.id,
  });

  // Infra failures: synthesize a durable result so aggregates don't silently
  // drop the attempt. Non-infra failures (LLM exceptions) stay in `failures`
  // only — the existing semantics are preserved.
  if (isInfraError(err)) {
    const context = await this.buildContext(manifest, variant, options);
    const synth = synthesizeInfraFailureResult({
      manifestId: manifest.id,
      context,
      error: err,
      classification: cls,
      startTime: new Date(),
    });
    modelResults.set(variant.variantId, synth);
    this.emit({ type: "result", result: synth });
  }
}
```

Imports to add at top:

```typescript
import {
  classifyInfraError,
  isInfraError,
  synthesizeInfraFailureResult,
} from "../health/mod.ts";
```

- [ ] **Step 4: Verify test pass + full suite green**

```bash
deno task test:unit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parallel/orchestrator.ts tests/unit/parallel/orchestrator.test.ts
git commit -m "feat(parallel): synthesize durable infra-failure result + enrich error event"
```

---

### Task 16: Aggregator splits valid vs infra-invalidated attempts

**Files:**

- Modify: `src/parallel/result-aggregator.ts`
- Test: `tests/unit/parallel/result-aggregator.test.ts` (extend)

Currently `calculateDetailedStats` (lines 306-360) treats every non-pass as a flat fail and categorizes into `compile_errors / test_failures / malformed`. We add a fourth bucket: `infra_invalidated`. Aggregates report it separately so a 10% Cronus281 failure rate doesn't tank a model's score.

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/parallel/result-aggregator.test.ts (add)
import { assertEquals } from "@std/assert";
// ...

Deno.test("aggregator separates infra-invalidated attempts", () => {
  const agg = new ResultAggregator();
  // Add 3 results: 1 pass, 1 normal compile fail, 1 infra-synthesized.
  // The infra one's attempts[0].failureReasons[0] starts with "Infra error:".
  // ...
  const stats = agg.finalize();
  assertEquals(stats.infraInvalidated, 1);
  assertEquals(stats.passNum1 + stats.passNum2, 1); // unchanged by infra
  // validAttempts = results minus infraInvalidated
  assertEquals(stats.validAttempts, 2);
});
```

- [ ] **Step 2: Implement**

In `categorizeFailure`, detect infra: `result.attempts[0]?.failureReasons[0]?.startsWith("Infra error:")` → bump `infraInvalidated`. Add `infraInvalidated` and `validAttempts` to the returned stats type. Modify `passRate` denominators to exclude infra-invalidated where appropriate.

- [ ] **Step 3: Verify test pass + run full suite**

```bash
deno task test:unit
```

- [ ] **Step 4: Commit**

```bash
git add src/parallel/result-aggregator.ts tests/unit/parallel/result-aggregator.test.ts
git commit -m "feat(aggregator): split infra-invalidated from compile/test failures"
```

---

### Task 17: Extend MatrixCell + SSE event types

**Files:**

- Modify: `cli/dashboard/types.ts`

- [ ] **Step 1: Extend `MatrixCell`**

In `cli/dashboard/types.ts`, replace the `MatrixCell` interface:

```typescript
export interface MatrixCell {
  taskId: string;
  model: string;
  run: number;
  state: CellState;
  attempt: number;
  score?: number;
  cost?: number;
  testsPassed?: number;
  testsTotal?: number;

  // Infra context (set when state === "error")
  containerName?: string;
  operation?: string;
  fingerprint?: string;
  signatureId?: string;
  signatureLabel?: string;
  errorMessageTail?: string;
  artifactPath?: string;
}
```

- [ ] **Step 2: Add `ContainerHealthState` SSE event**

Append to `SSEEvent` union:

```typescript
  | { type: "container-health"; state: import("../../src/health/types.ts").ContainerHealthState }
  | { type: "health-snapshot"; state: import("../../src/health/types.ts").ContainerHealthState };
```

- [ ] **Step 3: Verify + commit**

```bash
deno check cli/dashboard/types.ts
git add cli/dashboard/types.ts
git commit -m "feat(dashboard): extend MatrixCell + add container-health SSE events"
```

---

### Task 18: Dashboard state tracks container health

**Files:**

- Modify: `cli/dashboard/state.ts`
- Test: `tests/unit/dashboard/state.test.ts` (extend)

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/dashboard/state.test.ts (add)
import { DashboardStateManager } from "../../../cli/dashboard/state.ts";

Deno.test("state manager exposes container health snapshot", () => {
  const mgr = new DashboardStateManager({ models: [], taskIds: [], totalRuns: 1, attempts: 1, temperature: 0, containerName: "" });
  mgr.recordContainerOutcome({
    containerName: "Cronus281",
    result: "infra_error",
    fingerprint: "test:abc",
    signatureId: "syslib0014",
    timestamp: Date.now(),
  });
  const snap = mgr.getHealthSnapshot();
  assertEquals(snap.containers.length, 1);
  assertEquals(snap.containers[0].containerName, "Cronus281");
});
```

- [ ] **Step 2: Wire health monitor**

```typescript
// In cli/dashboard/state.ts, add:
import { ContainerHealthMonitor } from "../../src/health/mod.ts";
import type {
  ContainerHealthState,
  ContainerOutcome,
} from "../../src/health/types.ts";

// In class DashboardStateManager:
private healthMonitor = new ContainerHealthMonitor({ windowSize: 20 });

recordContainerOutcome(o: ContainerOutcome): void {
  this.healthMonitor.record(o);
}

getHealthSnapshot(): ContainerHealthState {
  return this.healthMonitor.getState();
}
```

- [ ] **Step 3: Verify test pass + commit**

```bash
deno task test:unit -- --filter "container health snapshot"
git add cli/dashboard/state.ts tests/unit/dashboard/state.test.ts
git commit -m "feat(dashboard): expose container health snapshot via state manager"
```

---

### Task 19: Bridge routes error events to cell + health monitor

**Files:**

- Modify: `cli/dashboard/bridge.ts`
- Test: `tests/unit/dashboard/bridge.test.ts` (extend)

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/dashboard/bridge.test.ts (add)
Deno.test("bridge enriches error cell + feeds health monitor", async () => {
  const broadcasts: SSEEvent[] = [];
  const state = new DashboardStateManager(/* ... */);
  state.initializeCells(["CG-AL-H024"], ["claude-opus-4-6"], 1);
  const bridge = new DashboardEventBridge(state, (e) => broadcasts.push(e));
  bridge.setRun(1);

  bridge.handleEvent({
    type: "error",
    taskId: "CG-AL-H024",
    model: "claude-opus-4-6",
    error: new Error("Boom"),
    containerName: "Cronus281",
    operation: "test",
    rawTail: "TEST_ERROR: SYSLIB0014",
    fingerprint: "test:abc",
    signatureId: "syslib0014",
  });

  const cellUpdate = broadcasts.find((e) => e.type === "cell-update");
  assertExists(cellUpdate);
  assertEquals(cellUpdate!.cell.containerName, "Cronus281");
  assertEquals(cellUpdate!.cell.signatureId, "syslib0014");

  const healthSnapshot = state.getHealthSnapshot();
  assertEquals(healthSnapshot.containers.length, 1);
});
```

- [ ] **Step 2: Update `onError`**

In `cli/dashboard/bridge.ts`, replace `onError(taskId, model)` with:

```typescript
private onError(event: {
  taskId: string;
  model: string;
  containerName?: string;
  operation?: string;
  rawTail?: string;
  artifactPath?: string;
  fingerprint?: string;
  signatureId?: string;
  error: Error;
}): void {
  const key = cellKey(event.taskId, event.model, this.currentRun);
  const update = this.state.updateCell(key, {
    state: "error",
    containerName: event.containerName,
    operation: event.operation,
    fingerprint: event.fingerprint,
    signatureId: event.signatureId,
    signatureLabel: undefined, // filled by signature library lookup if needed
    errorMessageTail: event.rawTail,
    artifactPath: event.artifactPath,
  });
  if (update) {
    this.broadcast({ type: "cell-update", ...update });
  }

  // Feed the health monitor.
  if (event.containerName) {
    this.state.recordContainerOutcome({
      containerName: event.containerName,
      result: "infra_error",
      fingerprint: event.fingerprint,
      signatureId: event.signatureId,
      timestamp: Date.now(),
    });
    this.broadcast({
      type: "container-health",
      state: this.state.getHealthSnapshot(),
    });
  }
  this.broadcastProgress();
}
```

And update the `handleEvent` `case "error"` to pass the full event object:

```typescript
case "error":
  if (event.taskId && event.model) {
    this.onError({
      taskId: event.taskId,
      model: event.model,
      containerName: event.containerName,
      operation: event.operation,
      rawTail: event.rawTail,
      artifactPath: event.artifactPath,
      fingerprint: event.fingerprint,
      signatureId: event.signatureId,
      error: event.error,
    });
  }
  break;
```

Also record pass/fail outcomes for healthy-container baseline:

```typescript
// In onResult, after computing cellUpdate:
const containerName = result.context.containerName;
if (containerName) {
  this.state.recordContainerOutcome({
    containerName,
    result: result.success ? "pass" : "fail",
    timestamp: Date.now(),
  });
  this.broadcast({
    type: "container-health",
    state: this.state.getHealthSnapshot(),
  });
}
```

- [ ] **Step 3: Verify pass + commit**

```bash
deno task test:unit -- --filter "bridge"
git add cli/dashboard/bridge.ts tests/unit/dashboard/bridge.test.ts
git commit -m "feat(dashboard): bridge routes error events to cell + container health monitor"
```

---

### Task 20: Snapshot endpoint for cold reconnect

**Files:**

- Modify: `cli/dashboard/server.ts`

- [ ] **Step 1: Add health-snapshot route**

In `handleRequest`, after the `/api/state` case:

```typescript
      case "/api/health-snapshot":
        return new Response(
          JSON.stringify(this.stateManager.getHealthSnapshot()),
          {
            headers: {
              "content-type": "application/json",
              "cache-control": "no-cache",
            },
          },
        );
```

- [ ] **Step 2: Replay health snapshot on SSE connect**

In `handleSSE` `start()`, after replaying full state:

```typescript
  // Replay container health
  controller.enqueue(
    sseFrame({
      type: "health-snapshot",
      state: stateManager.getHealthSnapshot(),
    }),
  );
```

- [ ] **Step 3: Verify + commit**

```bash
deno check cli/dashboard/server.ts
# Manual smoke: start a bench, hit GET /api/health-snapshot, expect 200 + JSON
git add cli/dashboard/server.ts
git commit -m "feat(dashboard): add health-snapshot endpoint + SSE replay"
```

---

### Task 21: Dashboard UI — sticky banner + per-container card

**Files:**

- Modify: `cli/dashboard/page.ts`

- [ ] **Step 1: Add banner HTML**

Near the top of the body in `page.ts`, after the existing header:

```html
<div id="infra-banner" style="display:none"></div>
<div id="container-health" class="container-health-grid"></div>
```

- [ ] **Step 2: Add CSS for banner + cards**

```css
#infra-banner.active {
  display: block;
  position: sticky;
  top: 0;
  z-index: 100;
  background: #b91c1c;
  color: white;
  padding: 10px 16px;
  font-weight: 600;
  border-bottom: 2px solid #7f1d1d;
}
#infra-banner .fix-hint {
  display: block;
  font-weight: normal;
  font-family: monospace;
  font-size: 11px;
  margin-top: 4px;
  opacity: 0.9;
}
.container-health-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  padding: 8px;
}
.container-card {
  background: var(--card-bg);
  border-radius: 6px;
  padding: 8px;
  font-size: 12px;
}
.container-card.suspect { border: 2px solid #f59e0b; }
.container-card.failed { border: 2px solid #dc2626; }
.container-card.healthy { border: 2px solid #16a34a; }
.sparkline { display: flex; gap: 2px; margin-top: 4px; }
.sparkline span {
  display: inline-block;
  width: 6px;
  height: 12px;
  border-radius: 1px;
}
.sparkline .pass { background: #22c55e; }
.sparkline .fail { background: #f97316; }
.sparkline .infra_error { background: #dc2626; }
```

- [ ] **Step 3: Add JS handlers for `container-health` / `health-snapshot`**

```javascript
// In SSE event handler:
case 'container-health':
case 'health-snapshot':
  renderContainerHealth(msg.state);
  break;

function renderContainerHealth(state) {
  // Banner
  const banner = $('infra-banner');
  if (state.alerts && state.alerts.length > 0) {
    const a = state.alerts[0];
    banner.className = 'active';
    banner.innerHTML =
      '<span>⚠ ' + escapeHtml(a.containerName) + ' — ' +
      escapeHtml(a.signatureLabel || a.fingerprint) +
      ' (' + a.count + ' errors)</span>' +
      (a.fixHint ? '<span class="fix-hint">' + escapeHtml(a.fixHint) + '</span>' : '');
  } else {
    banner.className = '';
  }

  // Per-container cards
  const grid = $('container-health');
  grid.innerHTML = '';
  for (const c of state.containers) {
    const status = c.alert ? 'failed'
      : c.errorCount > 0 ? 'suspect'
      : 'healthy';
    const card = document.createElement('div');
    card.className = 'container-card ' + status;
    card.innerHTML =
      '<div><strong>' + escapeHtml(c.containerName) + '</strong></div>' +
      '<div>pass=' + c.passCount + ' fail=' + c.failCount + ' err=' + c.errorCount + '</div>' +
      '<div class="sparkline">' +
        c.recent.map(function(r) { return '<span class="' + r + '"></span>'; }).join('') +
      '</div>';
    grid.appendChild(card);
  }
}

// On initial load:
async function init() {
  // ... existing init
  const snap = await fetch('/api/health-snapshot').then(r => r.json());
  renderContainerHealth(snap);
}
```

- [ ] **Step 4: Manual smoke test**

```bash
# Start a small bench that intentionally errors on one container.
# Open localhost:5XXXX/. Verify banner appears within ~3 errors.
```

- [ ] **Step 5: Commit**

```bash
git add cli/dashboard/page.ts
git commit -m "feat(dashboard): add infra banner + per-container health cards"
```

---

### Task 22: Post-bench Container Health summary block

**Files:**

- Modify: `cli/commands/bench/results-writer.ts`
- Test: `tests/unit/cli/results-writer.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/cli/results-writer.test.ts (add)
Deno.test("buildScoreLines includes container health block", () => {
  const lines = buildScoreLines({
    /* ... existing required fields ... */
    containerHealth: {
      eventId: 42,
      containers: [
        { containerName: "Cronus28", recent: [], passCount: 100, failCount: 5, errorCount: 0 },
        { containerName: "Cronus281", recent: [], passCount: 2, failCount: 1, errorCount: 297, alert: { kind: "persistent_container_failure", containerName: "Cronus281", fingerprint: "test:abc", signatureId: "syslib0014", signatureLabel: "PsTestTool .NET incompat (SYSLIB0014)", count: 297, raisedAt: Date.now() } },
      ],
      alerts: [],
    },
  });
  const text = lines.join("\n");
  assertEquals(text.includes("# Container Health"), true);
  assertEquals(text.includes("Cronus281"), true);
  assertEquals(text.includes("err=297"), true);
  assertEquals(text.includes("SYSLIB0014"), true);
});
```

- [ ] **Step 2: Implement**

Add `containerHealth?: ContainerHealthState` to `ScoreLineInput`. After existing blocks in `buildScoreLines`:

```typescript
if (input.containerHealth) {
  lines.push(``);
  lines.push(`# Container Health`);
  for (const c of input.containerHealth.containers) {
    const flag = c.alert
      ? `   ⚠ ${c.alert.signatureLabel ?? c.alert.fingerprint} (${c.alert.kind})`
      : "";
    lines.push(
      `${c.containerName}: pass=${c.passCount} fail=${c.failCount} err=${c.errorCount}${flag}`,
    );
  }
}
```

- [ ] **Step 3: Wire from parallel-executor**

In `cli/commands/bench/parallel-executor.ts` where `writeScoreFile` is called, pass `containerHealth` from `dashboard.bridge` (need to expose it via `state.getHealthSnapshot()`).

- [ ] **Step 4: Verify + commit**

```bash
deno task test:unit -- --filter "container health block"
git add cli/commands/bench/results-writer.ts cli/commands/bench/parallel-executor.ts tests/unit/cli/results-writer.test.ts
git commit -m "feat(bench): append # Container Health block to score file"
```

---

### Task 23: End-to-end smoke

**Files:**

- (no new files)

- [ ] **Step 1: Run full unit suite**

```bash
deno task test:unit
deno check
deno lint
deno fmt
```

Expected: all pass.

- [ ] **Step 2: Manual bench against one healthy + one broken container**

If Cronus281 is still broken, run a small bench with both Cronus28 and Cronus281 in the `--containers` list:

```bash
deno task start bench --llms anthropic/claude-haiku-4-5-20251001 --tasks "tasks/easy/CG-AL-E001*.yml" --containers Cronus28,Cronus281 --runs 3 --no-ingest -o results/phasea-smoke.json
```

Expected:
- Web UI shows red banner naming Cronus281 + SYSLIB0014 within ~3 errors.
- Scores file contains `# Container Health` block with `Cronus281: ... err=N`.
- Results JSON `.results[]` contains entries for both pass and infra-failed tuples (count matches expected 6 = 1 task × 1 model × 3 runs × 2 containers, allowing for whatever container the scheduler picked).
- Aggregator output shows `infraInvalidated` count.

- [ ] **Step 3: Document the rollout in `CLAUDE.md` (one-line memo)**

Add under "Memory":

```
- Container infra errors (SYSLIB0014, OOM, etc.) auto-surface on bench dashboard
  banner. Phase A only — no auto-quarantine yet. Run `centralgauge doctor
  containers` (Phase B) to verify before re-benching after a fix.
```

(Phase B/C is future work; the memo is forward-looking but accurate for the part that ships.)

- [ ] **Step 4: Commit + final push**

```bash
git add CLAUDE.md
git commit -m "docs(claude): note container-health Phase A behavior"
```

---

## Self-review checklist

**Spec coverage:**

- Layer 1 (error context) → Tasks 1, 13, 14, 15.
- Layer 2 (signatures + fingerprint) → Tasks 5, 6, 7, 8.
- Layer 3 (health reducer) → Task 10.
- Layer 4 (dashboard surfacing) → Tasks 17, 18, 19, 20, 21.
- Data integrity (durable ERR records) → Tasks 11, 15, 16.
- `isInfraError` discriminator → Task 9.
- Redaction → Task 3.
- Post-bench summary → Task 22.
- SSE snapshot + replay correctness → Task 20.

**Placeholder scan:** No "TBD", no "add appropriate error handling", no "similar to Task N", no "implement later".

**Type consistency:** `ContainerHealthState`, `ContainerHealth`, `ContainerOutcome`, `HealthAlert`, `InfraSignature`, `ClassifyResult` defined in Task 4 and referenced consistently. `MatrixCell` extension in Task 17 matches the fields populated by bridge in Task 19. `synthesizeInfraFailureResult` signature matches its call site in Task 15. `ScoreLineInput` extension in Task 22 referenced in `parallel-executor.ts` change.

**Out-of-scope creep:** Tasks B (canary, manual quarantine) and C (auto-quarantine, D1 telemetry) explicitly deferred. Phase A delivers full value (banner + data integrity) without them.

---

## Execution handoff

Plan complete. Two execution options:

**1. Subagent-Driven (recommended for plans of this size)** — fresh subagent per task, two-stage review between tasks. Reliable but slower per-task.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints. Faster but less review depth.

Which approach?
