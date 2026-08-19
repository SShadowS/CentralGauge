/**
 * Verifies one model response against a draft's oracle, then — when the
 * caller supplies a model to escalate to — runs the bench's own fix
 * attempt on a genuine model mistake.
 *
 * Stages the response (`stageResponse`, Task 3), runs it through an
 * injected verifier, and maps the raw `VerifyResult` onto a `VerifyOutcome`
 * (Task 1) an author's UI can render without lying about what happened.
 *
 * The mapping is the whole point of this module. `syntheticNoTestsRan`
 * marks a candidate that published or installed badly and therefore ran
 * ZERO tests — its pass/fail counts are a scoring convention, not a
 * measurement — so that check runs BEFORE any counts-based branch and maps
 * to `publish_defect`, never `failed_both`.
 *
 * `verify` is an injectable seam so this module is testable without a real
 * Business Central container: production passes `handleAlVerify`
 * (`mcp/al-tools-server.ts`), every test passes a fake. A thrown verifier
 * becomes `{state: "errored", message}` rather than propagating — one bad
 * response must not take down the queue Task 6 builds around this.
 *
 * The fix attempt (Task 5) only runs for `didnt_compile` and `failed_both`
 * — both genuine model mistakes. It is skipped for `passed_first_try`
 * (nothing to fix), `publish_defect`, and `errored` (both infrastructure
 * outcomes: asking a model to repair a container defect burns a paid call
 * and misreports the result as though the model had another try at the
 * actual task). It builds the fix prompt from the SAME `buildFixPrompt`
 * the bench uses (`src/llm/prompt-building.ts`), so the dashboard measures
 * what the bench measures, and stages/verifies the fix exactly like attempt
 * 1 via a shared `attemptOnce` helper — one staging per attempt, so the fix
 * attempt's temp directory is independent of attempt 1's and each is
 * cleaned up as soon as its own attempt finishes.
 *
 * The SECOND attempt's own outcome is not always what gets returned. A
 * passing second attempt becomes `passed_second_try`. A `didnt_compile` or
 * `failed_both` second attempt IS returned as-is — a genuine model outcome
 * from the fix, same honesty rule as attempt 1. But `publish_defect` or
 * `errored` on the SECOND attempt carries no model signal at all (the
 * container that ran the fix died, or it published/installed badly), so
 * returning it would silently discard attempt 1's real, already-measured
 * result — the same loss the throwing-call catch below already refuses to
 * accept. Those two states fall back to `first` instead of replacing it.
 *
 * @module dashboard/verify-run
 */

import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

import type { CandidateResolution } from "../llm/candidate-resolution.ts";
import type { GateDecision } from "./bench-gate.ts";
import type { VerifyOutcome } from "./verify-types.ts";
import type { ModelCaller } from "./run-manager.ts";

import { resolveCandidate } from "../llm/candidate-resolution.ts";
import { buildFixPrompt } from "../llm/prompt-building.ts";
import { stageResponse } from "./verify-staging.ts";

/** The subset of `VerifyResult` (`mcp/al-tools-server.ts`) this module maps. */
export interface VerifyResultLike {
  success: boolean;
  message: string;
  totalTests?: number;
  passed?: number;
  failed?: number;
  failures?: string[];
  compileErrors?: string[];
  syntheticNoTestsRan?: boolean;
}

/** Injectable verifier seam. Production passes `handleAlVerify`. */
export type VerifyFn = (params: {
  projectDir: string;
  testFile: string;
  containerName?: string;
  testCodeunitId?: number;
  prereqDir?: string;
}) => Promise<VerifyResultLike>;

export interface VerifyResponseOptions {
  draftDir: string;
  taskId: string;
  /** The response's code, verbatim — staged as-is to `<taskId>.al`. */
  code: string;
  containerName?: string;
  verify: VerifyFn;
  /**
   * When both `call` and `model` are present AND attempt 1 lands on
   * `didnt_compile` or `failed_both` (a genuine model mistake), runs
   * exactly ONE fix attempt: builds the bench's own fix prompt
   * (`buildFixPrompt`), calls the model once, stages and verifies the
   * result. Either field absent, or attempt 1 landing on `passed_first_try`
   * / `publish_defect` / `errored`, leaves attempt 1's outcome standing
   * unchanged — identical to Task 4's behaviour.
   */
  call?: ModelCaller;
  /** The model slug to escalate to. See `call`. */
  model?: string;
  /**
   * Re-checks bench liveness immediately before the FIX attempt's publish.
   * Mirrors `checkBenchGate`'s shape (`./bench-gate.ts`) but takes no
   * arguments — the caller closes over whatever directory it needs, same
   * seam as `VerifyQueue`'s `gate`.
   *
   * `VerifyQueue` checks the gate once, right before dispatching a job.
   * That job then publishes to a container TWICE, separated by a model
   * call: attempt 1 (minutes), the fix prompt plus `call` (seconds to a
   * minute), attempt 2 (minutes). Without a second check, a bench that
   * starts anywhere in that window is refused for every queued job behind
   * this one and completely ignored by THIS job's second publish — the
   * exposure window the queue's per-job check was written to close, only
   * longer. On refusal, attempt 1's real, measured outcome is returned
   * unchanged, exactly as it already is for a `publish_defect` or
   * `errored` attempt 2.
   *
   * Optional: omitted means no re-check, which is every existing caller's
   * current behaviour. Production wires it in
   * `cli/commands/workbench-command.ts`'s `createEscalationVerify`.
   */
  gate?: () => GateDecision;
}

/**
 * Maps a raw `VerifyResult` onto the attempt-1 subset of `VerifyOutcome`.
 * Order matters: `syntheticNoTestsRan` is checked first, before any
 * counts-based branch, so a publish/install defect can never be reported
 * as a test failure regardless of what the counts say.
 *
 * Both the `passed_first_try` and `failed_both` verdicts require POSITIVE
 * EVIDENCE that tests actually ran (`totalTests` is a defined, positive
 * number) — a claim of success with no tests behind it is the same
 * condition `syntheticNoTestsRan` describes, just arriving with
 * `success: true` instead of `false`. This repo already treats
 * zero-tests-after-successful-publish as infrastructure and throws
 * `ContainerError("test")` for it upstream, but CLAUDE.md records that
 * exact guarantee failing once already (GH #13: scoring it as a model
 * result "hid a broken BCH version across an entire bench run") — this is
 * the module whose whole purpose is that invariant, so it holds it locally
 * rather than depending on a remote one with that history. Mapped to
 * `publish_defect`, not `errored`: the message that comes with a
 * `success: true` zero-tests result reads as a (false) success claim, not
 * an error, and `publish_defect` already exists for exactly "published or
 * installed badly, ran zero tests" regardless of which side of `success`
 * it arrives on.
 *
 * On the `success: false` side, `handleAlVerify` has three sites that
 * return `{success: false, message}` with no `totalTests` at all
 * (`mcp/al-tools-server.ts:1407` app.json prep, `:1427` test-file copy,
 * `:1558-1560` the outer catch, which also absorbs a thrown infra
 * `ContainerError`), and `createFailedTestResult`
 * (`src/container/bc-container-provider.ts:2478`) produces the legacy
 * `totalTests: 0, passed: 0, failed: 0` shape with no `syntheticNoTestsRan`
 * flag. Without a guard either shape falls through to `failed_both` with
 * fabricated `0/0` counts and an empty failures array — reporting an
 * infrastructure failure as though a model's tests ran and failed. Mapped
 * to `errored` instead, since the message here already describes a genuine
 * failure/exception, so `result.message` reaching the author unchanged is
 * the honest read.
 */
function mapResult(result: VerifyResultLike): VerifyOutcome {
  if (result.syntheticNoTestsRan) {
    return { state: "publish_defect", message: result.message };
  }

  if (result.compileErrors && result.compileErrors.length > 0) {
    return { state: "didnt_compile", compileErrors: result.compileErrors };
  }

  if (result.success) {
    if (result.totalTests === undefined || result.totalTests === 0) {
      return { state: "publish_defect", message: result.message };
    }
    return {
      state: "passed_first_try",
      passed: result.passed ?? 0,
      total: result.totalTests,
    };
  }

  if (result.totalTests === undefined || result.totalTests === 0) {
    return { state: "errored", message: result.message };
  }

  return {
    state: "failed_both",
    passed: result.passed ?? 0,
    total: result.totalTests,
    failures: result.failures ?? [],
  };
}

/**
 * Reads `task.yml`'s `description` for use as `buildFixPrompt`'s
 * `originalInstructions`, tolerating a missing or malformed file the same
 * way `verify-staging.ts`'s `readTestCodeunitId` does: a draft with no
 * `task.yml` yet still gets a fix attempt, just with an empty original-task
 * section in the prompt rather than a thrown error that would sink the
 * whole escalation and leave attempt 1's outcome standing for the wrong
 * reason.
 */
async function readDraftDescription(draftDir: string): Promise<string> {
  try {
    const content = await Deno.readTextFile(join(draftDir, "task.yml"));
    const parsed = (parseYaml(content) ?? {}) as Record<string, unknown>;
    const description = parsed["description"];
    if (typeof description === "string") {
      return description;
    }
  } catch {
    // Missing or malformed task.yml - fall through to "".
  }
  return "";
}

/**
 * Stages `code`, verifies it against the draft's oracle, and returns the
 * mapped outcome. Cleans up the staged directory in a `finally` so it runs
 * on every path, including a thrown verifier.
 *
 * Shared by both attempts (Task 5): `verifyResponse` calls this once for
 * attempt 1 and, when a fix attempt runs, once more for the fix. Each call
 * owns and releases its own staged temp directory — nesting a second
 * staging inside the first attempt's `try` would keep attempt 1's directory
 * alive for the whole of attempt 2 and entangle the two cleanups.
 */
async function attemptOnce(params: {
  draftDir: string;
  taskId: string;
  code: string;
  containerName?: string;
  verify: VerifyFn;
}): Promise<VerifyOutcome> {
  const staged = await stageResponse({
    draftDir: params.draftDir,
    taskId: params.taskId,
    code: params.code,
  });

  try {
    const result = await params.verify({
      projectDir: staged.projectDir,
      testFile: staged.testFile,
      ...(params.containerName !== undefined
        ? { containerName: params.containerName }
        : {}),
      ...(staged.testCodeunitId !== undefined
        ? { testCodeunitId: staged.testCodeunitId }
        : {}),
      ...(staged.prereqDir !== undefined
        ? { prereqDir: staged.prereqDir }
        : {}),
    });
    return mapResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: "errored", message };
  } finally {
    // Never let a cleanup failure escape and discard an already-computed
    // outcome: one bad response must not take down the queue Task 6 builds
    // around this module. `staged.cleanup()` rethrows anything that is not
    // `Deno.errors.NotFound` (correctly, in `verify-staging.ts`), so this is
    // the deliberate last line of defense against a real cleanup error
    // (permission denied, file busy) surfacing here instead.
    try {
      await staged.cleanup();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        colors.yellow(
          `[verify-run] cleanup failed for ${staged.projectDir}: ${message}`,
        ),
      );
    }
  }
}

/**
 * Verifies `opts.code` against the draft's oracle, then — when eligible and
 * a `call`/`model` pair is supplied — runs exactly one fix attempt using
 * the bench's own fix prompt.
 *
 * Only `didnt_compile` and `failed_both` are eligible: both are genuine
 * model mistakes. `passed_first_try` has nothing to fix; `publish_defect`
 * and `errored` are infrastructure outcomes, and asking a model to repair a
 * container defect would burn a paid call and misreport the result as
 * though the model had another try at the actual task.
 *
 * A fix attempt that itself throws (prompt build, task.yml read, or the
 * model call) leaves attempt 1's outcome standing rather than becoming
 * `errored` — attempt 1's real result must not be discarded just because
 * the ESCALATION failed.
 *
 * When `opts.gate` is supplied it is re-checked immediately before the fix
 * attempt's publish, and a refusal likewise leaves attempt 1 standing. See
 * that option's doc for why one check at dispatch is not enough.
 */
export async function verifyResponse(
  opts: VerifyResponseOptions,
): Promise<VerifyOutcome> {
  const first = await attemptOnce({
    draftDir: opts.draftDir,
    taskId: opts.taskId,
    code: opts.code,
    ...(opts.containerName !== undefined
      ? { containerName: opts.containerName }
      : {}),
    verify: opts.verify,
  });

  let errors: string[];
  if (first.state === "didnt_compile") {
    errors = first.compileErrors;
  } else if (first.state === "failed_both") {
    errors = first.failures;
  } else {
    // passed_first_try, publish_defect, or errored - not eligible for a fix.
    return first;
  }

  if (!opts.call || !opts.model) {
    return first;
  }

  let fixPrompt: string;
  let resolution: CandidateResolution;
  try {
    const originalInstructions = await readDraftDescription(opts.draftDir);
    fixPrompt = buildFixPrompt({
      attemptNumber: 2,
      originalInstructions,
      previousCode: opts.code,
      errors,
    });
    const response = await opts.call(opts.model, { prompt: fixPrompt });
    resolution = resolveCandidate(response.content, response.finishReason);
  } catch {
    return first;
  }

  // Re-checked HERE, not only at dispatch: the gate's only other check ran
  // before attempt 1, minutes and one model call ago, and what follows is a
  // second publish to the same container. A bench that started in that
  // window would otherwise be ignored entirely by this job. On refusal
  // attempt 1's already-measured outcome stands — the same fallback the two
  // infrastructure branches below apply, for the same reason: the fix
  // attempt produced no signal, so it must not replace one that exists.
  // Wrapped defensively because `gate` is a generic injection seam and a
  // throw here would discard attempt 1's real result.
  if (opts.gate) {
    let decision: GateDecision;
    try {
      decision = opts.gate();
    } catch {
      return first;
    }
    if (!decision.allowed) {
      return first;
    }
  }

  const second = await attemptOnce({
    draftDir: opts.draftDir,
    taskId: opts.taskId,
    code: resolution.cleanedCode,
    ...(opts.containerName !== undefined
      ? { containerName: opts.containerName }
      : {}),
    verify: opts.verify,
  });

  if (second.state === "passed_first_try") {
    return {
      state: "passed_second_try",
      passed: second.passed,
      total: second.total,
      fixPrompt,
    };
  }

  // An infrastructure outcome on the fix attempt itself (the container that
  // ran the fix died, or it published/installed badly) carries NO model
  // signal - same reasoning as the throwing-call catch above, just reached
  // one step later. Discarding attempt 1's real, already-measured result
  // (e.g. a genuine `failed_both` with real counts) in favour of "container
  // offline" would erase the only actual signal the run produced, so both
  // fall back to `first` rather than replacing it.
  if (second.state === "publish_defect") {
    return first;
  }
  if (second.state === "errored") {
    return first;
  }

  // second.state is didnt_compile or failed_both here: a genuine model
  // outcome from the fix attempt itself, and the honest final state - it
  // describes what really happened on the fix attempt, same as attempt 1
  // would report it standing alone.
  return second;
}
