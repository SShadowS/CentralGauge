/**
 * The states one response can be in on the escalation path.
 *
 * `publish_defect` is separate from `failed_both` on purpose. `VerifyResult`
 * carries `syntheticNoTestsRan` for a candidate that published or installed
 * badly and therefore ran ZERO tests; its pass/fail numbers are a scoring
 * convention, not a measurement. Folding it into `failed_both` would tell the
 * author "1 of 3 tests failed" about a run where no test executed.
 */
export type VerifyState =
  | "queued"
  | "running"
  | "passed_first_try"
  | "passed_second_try"
  | "failed_both"
  | "didnt_compile"
  | "publish_defect"
  | "refused"
  | "errored";

export type VerifyOutcome =
  | { state: "queued" }
  | { state: "running"; phase: "staging" | "compiling" | "testing" | "fixing" }
  | { state: "passed_first_try"; passed: number; total: number }
  | {
    state: "passed_second_try";
    passed: number;
    total: number;
    /** The fix prompt actually sent, so the author can read what the model was told. */
    fixPrompt: string;
  }
  | { state: "failed_both"; passed: number; total: number; failures: string[] }
  | { state: "didnt_compile"; compileErrors: string[] }
  | { state: "publish_defect"; message: string }
  /** Refused before any container work: a bench is live, or no draft/response. */
  | { state: "refused"; reason: string }
  | {
    state: "errored";
    message: string;
    /**
     * The container's own transcript for this failure, when there is one.
     *
     * `ContainerError` already carries a redacted, 4KB-tail-captured
     * `rawOutput` (`buildPwshError` in `bc-container-provider.ts`), and the
     * dashboard used to drop it: an author saw "Verification error:
     * prepareCandidateApp failed" and had no way to learn WHY the publish
     * failed. That is a message naming nothing, which is the same defect
     * this module's states exist to prevent, one layer down.
     *
     * Absent when the failure did not come from a container operation.
     */
    detail?: string;
  };

export function isTerminal(o: VerifyOutcome): boolean {
  return o.state !== "queued" && o.state !== "running";
}

/**
 * Pass/total ONLY where the numbers measure tests that actually ran.
 * `publish_defect` and `didnt_compile` deliberately return `undefined`.
 */
export function testCounts(
  o: VerifyOutcome,
): { passed: number; total: number } | undefined {
  switch (o.state) {
    case "passed_first_try":
    case "passed_second_try":
    case "failed_both":
      return { passed: o.passed, total: o.total };
    case "queued":
    case "running":
    case "didnt_compile":
    case "publish_defect":
    case "refused":
    case "errored":
      return undefined;
    default: {
      const _exhaustive: never = o;
      void _exhaustive;
      return undefined;
    }
  }
}
