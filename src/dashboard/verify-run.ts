/**
 * Verifies one model response against a draft's oracle, attempt 1.
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
 * @module dashboard/verify-run
 */

import * as colors from "@std/fmt/colors";

import type { VerifyOutcome } from "./verify-types.ts";
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
}

/**
 * Maps a raw `VerifyResult` onto the attempt-1 subset of `VerifyOutcome`.
 * Order matters: `syntheticNoTestsRan` is checked first, before any
 * counts-based branch, so a publish/install defect can never be reported
 * as a test failure regardless of what the counts say.
 *
 * A `failed_both` verdict requires POSITIVE EVIDENCE that tests actually
 * ran (`totalTests` is a defined, positive number). `handleAlVerify` has
 * three sites that return `{success: false, message}` with no `totalTests`
 * at all (`mcp/al-tools-server.ts:1407` app.json prep, `:1427` test-file
 * copy, `:1558-1560` the outer catch, which also absorbs a thrown infra
 * `ContainerError`), and `createFailedTestResult`
 * (`src/container/bc-container-provider.ts:2478`) produces the legacy
 * `totalTests: 0, passed: 0, failed: 0` shape with no `syntheticNoTestsRan`
 * flag. Without this guard either shape falls through to `failed_both` with
 * fabricated `0/0` counts and an empty failures array — reporting an
 * infrastructure failure (the same class of lie `syntheticNoTestsRan`
 * exists to prevent) as though a model's tests ran and failed. Mapping both
 * to `errored` instead surfaces `result.message`, the real reason, to the
 * author.
 */
function mapResult(result: VerifyResultLike): VerifyOutcome {
  if (result.syntheticNoTestsRan) {
    return { state: "publish_defect", message: result.message };
  }

  if (result.compileErrors && result.compileErrors.length > 0) {
    return { state: "didnt_compile", compileErrors: result.compileErrors };
  }

  if (result.success) {
    return {
      state: "passed_first_try",
      passed: result.passed ?? 0,
      total: result.totalTests ?? 0,
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
 * Stages `code`, verifies it against the draft's oracle, and returns the
 * mapped outcome. Cleans up the staged directory in a `finally` so it runs
 * on every path, including a thrown verifier.
 */
export async function verifyResponse(
  opts: VerifyResponseOptions,
): Promise<VerifyOutcome> {
  const staged = await stageResponse({
    draftDir: opts.draftDir,
    taskId: opts.taskId,
    code: opts.code,
  });

  try {
    const result = await opts.verify({
      projectDir: staged.projectDir,
      testFile: staged.testFile,
      ...(opts.containerName !== undefined
        ? { containerName: opts.containerName }
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
