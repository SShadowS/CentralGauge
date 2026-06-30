#!/usr/bin/env -S deno run -A
// Discrimination-probe driver. Runs a task's oracle against a provided AL
// solution directory and asserts the pass/fail outcome.
// Usage: deno run -A scripts/trap-probe.ts --task CG-AL-X002 --solution <dir> --expect pass|fail [--container Cronus28]
import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path";
import * as colors from "@std/fmt/colors";
import { handleAlVerifyTask } from "../mcp/al-tools-server.ts";
import { classifyInfraError } from "../src/health/classify.ts";

// Exact return shape of handleAlVerifyTask / handleAlVerify, copied from
// `interface VerifyResult` in mcp/al-tools-server.ts (~line 913). Note:
// `message` is required (not optional) and test counts are flat optional
// fields (`totalTests`/`passed`/`failed`), not a nested `testResults` object.
export type VerifyResult = {
  success: boolean;
  message: string;
  totalTests?: number;
  passed?: number;
  failed?: number;
  failures?: string[];
  compileErrors?: string[];
};

export type ProbeOutcome = "pass" | "fail" | "inconclusive";

// `handleAlVerify`'s catch-all (mcp/al-tools-server.ts:1456-1459) stamps
// EVERY caught exception with this exact prefix before it reaches
// VerifyResult.message:
//   return { success: false, message: `Verification error: ${errorMessage}` };
// That includes the GH #13 zero-tests-after-publish ContainerError("test")
// thrown in src/container/bc-container-provider.ts (~2024-2037) and every
// other infra ContainerError (SYSLIB0014, SQL down, PSSession lost, publish
// timeout, container offline) thrown anywhere in handleAlVerify's try block.
const CATCH_ALL_PREFIX = "Verification error: ";

/**
 * Pure, unit-testable classifier distinguishing a genuine oracle result from
 * an infra hiccup that was swallowed into `success:false` by the catch-all.
 *
 * - "pass" — `res.success === true`.
 * - "fail" — `success:false` reached WITHOUT a thrown-exception catch-all:
 *   compile errors are present, or test results show real failures. This is
 *   the oracle actually discriminating.
 * - "inconclusive" — `success:false` produced by a caught thrown
 *   exception / known infra signature. The run never completed for infra
 *   reasons; it must not be compared against `--expect`.
 *
 * Detection strategy: the catch-all prefix is the authoritative signal.
 * Every `ContainerError` thrown inside handleAlVerify's try block funnels
 * through that one `catch` and gets the same "Verification error: " prefix
 * — regardless of which infra signature it represents. Most ContainerError
 * messages are generic operation labels ("Publish failed", "BC test harness
 * failed (infra)"); the raw output that actually carries signature text
 * (SYSLIB0014, "Cannot establish a connection to the SQL Server", etc.) is
 * tail-captured into `ContainerError.rawOutput`, which never survives into
 * the flattened `VerifyResult.message` string this probe receives. So
 * prefix-matching is not a heuristic shortcut here, it is the only
 * structurally reliable signal available post-flattening.
 *
 * `classifyInfraError` (src/health/`signatures.ts`'s `matchSignature`,
 * reused via `classify.ts`) is layered on top as defense-in-depth: for the
 * cases where signature text DOES survive into the message (e.g. GH #13's
 * zero_tests: "Zero tests detected after successful publish (infra)" is
 * passed through verbatim as the ContainerError message), it independently
 * confirms infra without depending on the prefix string staying exact.
 */
export function classifyProbeOutcome(res: VerifyResult): ProbeOutcome {
  if (res.success === true) return "pass";

  if (res.message.startsWith(CATCH_ALL_PREFIX)) return "inconclusive";

  const { signature } = classifyInfraError(res.message);
  if (signature) return "inconclusive";

  return "fail";
}

async function main() {
  const a = parseArgs(Deno.args, {
    string: ["task", "solution", "expect", "container"],
    default: { container: "Cronus28" },
  });

  if (!a.task || !a.solution || !a.expect) {
    console.error("Required: --task <id> --solution <dir> --expect pass|fail");
    Deno.exit(2);
  }
  if (a.expect !== "pass" && a.expect !== "fail") {
    console.error(`--expect must be 'pass' or 'fail', got '${a.expect}'`);
    Deno.exit(2);
  }

  // Resolve to an absolute path before crossing into handleAlVerifyTask: the
  // compile pool runs scripts in a pwsh subprocess whose working directory is
  // NOT this Deno process's cwd (it resolves relative to the AL compiler's own
  // bin directory), so a relative --solution silently produces
  // "AL1001: Source file ... could not be found" inside the container's
  // compile step. Resolving here keeps the CLI ergonomic (relative paths still
  // work from the invoker's shell) while the handler always sees an absolute
  // path.
  const solutionDir = resolve(a.solution);

  const res: VerifyResult = await handleAlVerifyTask({
    projectDir: solutionDir,
    taskId: a.task,
    containerName: a.container,
  });

  const outcome = classifyProbeOutcome(res);
  console.log(
    `[trap-probe] ${a.task}: actual=${outcome} expected=${a.expect}`,
  );
  if (res.message) console.log(`[trap-probe] message: ${res.message}`);
  if (res.totalTests !== undefined) {
    console.log(
      `[trap-probe] tests: ${res.passed ?? 0}/${res.totalTests} passed` +
        (res.failed ? `, ${res.failed} failed` : ""),
    );
  }
  if (res.compileErrors?.length) {
    console.log(`[trap-probe] compile errors:`);
    for (const e of res.compileErrors) console.log(`  ${e}`);
  }
  if (res.failures?.length) {
    console.log(`[trap-probe] test failures:`);
    for (const f of res.failures) console.log(`  ${f}`);
  }

  if (outcome === "inconclusive") {
    console.error(
      colors.yellow(`[trap-probe] INCONCLUSIVE — infra, re-run`),
    );
    Deno.exit(3);
  }

  if (outcome !== a.expect) {
    console.error(
      colors.red(`[trap-probe] MISMATCH — discrimination NOT satisfied`),
    );
    Deno.exit(1);
  }
  console.log(colors.green(`[trap-probe] OK`));
  // Explicit exit: BcContainerProvider keeps pooled pwsh child-process handles
  // (compile session pool, per-container session slot) open for reuse across
  // calls within a long-lived host (MCP server, bench run). A one-shot CLI
  // invocation has no such host, so those open handles keep the event loop
  // alive and the process would otherwise hang indefinitely after printing OK
  // instead of returning control to the caller (verified: a successful run
  // left a `deno.exe` process alive for 10+ minutes until force-killed).
  Deno.exit(0);
}

if (import.meta.main) {
  await main();
}
