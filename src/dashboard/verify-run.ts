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

  return {
    state: "failed_both",
    passed: result.passed ?? 0,
    total: result.totalTests ?? 0,
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
    await staged.cleanup();
  }
}
