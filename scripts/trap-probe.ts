#!/usr/bin/env -S deno run -A
// Discrimination-probe driver. Runs a task's oracle against a provided AL
// solution directory and asserts the pass/fail outcome.
// Usage: deno run -A scripts/trap-probe.ts --task CG-AL-X002 --solution <dir> --expect pass|fail [--container Cronus28]
//        deno run -A scripts/trap-probe.ts --task CG-AL-X053 --solution <dir> --expect pass \
//          --test-file scratch/CG-AL-X053/correct/CG-AL-X053.Test.al [--test-codeunit-id 80053] \
//          [--prereq-dir <dir>] [--stage-symbols-dir <dir>] [--strict-fail-mode]
//
// TWO WAYS TO LOCATE THE ORACLE, and the difference is the whole point of the
// second one:
//
// - `--task` alone (the original contract, used by run-xiterate.ps1's sanity
//   lane and by hand) means "a COMMITTED task id". It routes through
//   `handleAlVerifyTask`, which resolves the oracle by id to
//   `tests/al/<difficulty>/<id>.Test.al` and reads `expected.testCodeunitId`
//   out of `tasks/<difficulty>/<id>-*.yml`. Both live in the task_sets hash
//   scope, so both exist only AFTER the task has been promoted.
// - `--test-file` (additive; the id-based resolution is skipped entirely)
//   points at an oracle directly and routes through `handleAlVerify`, which
//   takes the test file as a parameter. This is what lets the task workbench
//   (`centralgauge task probe`) probe an UNPROMOTED draft whose oracle still
//   sits in `scratch/<id>/` — the discrimination gate has to run BEFORE
//   promotion, or `promote` can only ever be satisfied by `--force`.
//   `--test-codeunit-id` supplies what the not-yet-existing task YAML would
//   have, and `--prereq-dir` what `tests/al/dependencies/<id>/` would have.
//   `--stage-symbols-dir <dir>` (test-file mode only) copies every compiled
//   prereq `.app` into `<dir>` so the VS Code AL extension can resolve them.
//   `--strict-fail-mode` makes an expected `fail` exit `4` instead of `0`
//   unless the run actually REACHED the oracle's assertions and failed them
//   (`totalTests > 0 && failed > 0`) — a naive solution that never compiled,
//   never published, or ran no tests isn't real discrimination. Both flags
//   are additive: omitted, behaviour and exit codes are unchanged from
//   before this task, and exit 4 is unreachable.
//
// `--task` stays required in both modes: it is the label every log line is
// keyed on, and in `--test-file` mode `handleAlVerify` independently derives
// the same id from the test file's NAME for prereq/support-file lookup.
//
// This script is invoked directly via `deno run -A` (NOT `deno task`), so it
// does NOT inherit the project's normal `.env` loading. Without it, BC
// container credentials default to "admin"/"admin" (see
// `BcContainerProvider.getCredentials`), which the local Cronus containers
// reject (they use "sshadows"/"1234" per CLAUDE.md). `handleAlVerifyTask` is
// therefore imported DYNAMICALLY inside `main()`, after credentials are
// resolved, rather than statically at module scope: `mcp/al-tools-server.ts`
// reads CENTRALGAUGE_CONTAINER_USERNAME/PASSWORD from `Deno.env` exactly once,
// at module-evaluation time (top-level code, ~line 64), and ES module static
// imports are fully evaluated before ANY of this file's own top-level code
// runs — so a static import would always see the un-loaded env, no matter
// where `EnvLoader.loadEnvironment()` was called afterwards. Confirmed
// empirically: a dynamic `import()` is the only way to defer that module's
// evaluation until after we've set the env vars it reads.
import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path";
import * as colors from "@std/fmt/colors";
import { classifyInfraError } from "../src/health/classify.ts";
import { EnvLoader } from "../src/utils/env-loader.ts";

/** The only local container with credentials wired for this script (others 401). */
const DEFAULT_CONTAINER = "Cronus28";

/** Local-only dev defaults for THIS machine's Cronus containers (CLAUDE.md
 * "Local BC Container"). `.env` does not carry container credentials today
 * (it only carries LLM API keys + benchmark settings), so trap-probe must be
 * self-sufficient rather than relying on a `.env` entry that doesn't exist. */
const LOCAL_CONTAINER_USERNAME = "sshadows";
const LOCAL_CONTAINER_PASSWORD = "1234";

/**
 * Load `.env` exactly like the normal CLI entrypoint does
 * (`cli/centralgauge.ts`'s `initializeApp` -> `EnvLoader.loadEnvironment()`),
 * then default the BC container credentials to this machine's documented
 * local values if neither `.env` nor the shell environment supplied them.
 * Must run BEFORE the dynamic import of `mcp/al-tools-server.ts` below.
 */
async function resolveCredentialsEnv(): Promise<void> {
  await EnvLoader.loadEnvironment();

  if (!Deno.env.get("CENTRALGAUGE_CONTAINER_USERNAME")) {
    Deno.env.set("CENTRALGAUGE_CONTAINER_USERNAME", LOCAL_CONTAINER_USERNAME);
  }
  if (!Deno.env.get("CENTRALGAUGE_CONTAINER_PASSWORD")) {
    Deno.env.set("CENTRALGAUGE_CONTAINER_PASSWORD", LOCAL_CONTAINER_PASSWORD);
  }
  // Note: never log the password value itself.
  console.error(
    colors.gray(
      `[trap-probe] container credentials resolved (user=${
        Deno.env.get("CENTRALGAUGE_CONTAINER_USERNAME")
      })`,
    ),
  );
}

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
  /** See `TestResult.syntheticNoTestsRan` — the counts are a convention, not a measurement. */
  syntheticNoTestsRan?: boolean;
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

/**
 * Raw string CLI inputs {@link planProbe} consumes, already de-hyphenated.
 * Every field is explicitly `| undefined` because the repo compiles with
 * `exactOptionalPropertyTypes`, and `parseArgs` hands back `undefined` for
 * every flag the caller omitted.
 */
export interface ProbeArgsInput {
  task?: string | undefined;
  solution?: string | undefined;
  expect?: string | undefined;
  container?: string | undefined;
  testFile?: string | undefined;
  testCodeunitId?: string | undefined;
  prereqDir?: string | undefined;
  stageSymbolsDir?: string | undefined;
  strictFailMode?: boolean | undefined;
}

/**
 * Where the oracle comes from, and therefore which handler runs.
 *
 * `task-id` is the original contract (committed task, resolved by id);
 * `test-file` is the additive path that lets an unpromoted draft be probed.
 */
export type ProbeOracle =
  | { via: "task-id" }
  | {
    via: "test-file";
    testFile: string;
    testCodeunitId?: number;
    prereqDir?: string;
    stageSymbolsDir?: string;
  };

export type ProbePlan =
  | { ok: false; message: string }
  | {
    ok: true;
    taskId: string;
    expect: "pass" | "fail";
    container: string;
    solutionDir: string;
    oracle: ProbeOracle;
    strictFailMode: boolean;
  };

/**
 * Pure argument validation + mode selection, split out of {@link main} so the
 * routing decision is unit-testable without a container, a subprocess, or a
 * `Deno.exit`. This is the function that guarantees the additive contract:
 * WITHOUT `--test-file` the plan is byte-for-byte the old one (`via:
 * "task-id"`, same handler, same arguments), so `run-xiterate.ps1` and every
 * hand invocation behave exactly as before.
 *
 * Every path is resolved to an absolute one before it crosses into a handler:
 * the compile pool runs scripts in a pwsh subprocess whose working directory
 * is NOT this Deno process's cwd (it resolves relative to the AL compiler's
 * own bin directory), so a relative path silently produces "AL1001: Source
 * file ... could not be found" inside the container's compile step. Resolving
 * here keeps the CLI ergonomic (relative paths still work from the invoker's
 * shell) while the handler always sees an absolute path.
 */
export function planProbe(a: ProbeArgsInput): ProbePlan {
  if (!a.task || !a.solution || !a.expect) {
    return {
      ok: false,
      message: "Required: --task <id> --solution <dir> --expect pass|fail",
    };
  }
  if (a.expect !== "pass" && a.expect !== "fail") {
    return {
      ok: false,
      message: `--expect must be 'pass' or 'fail', got '${a.expect}'`,
    };
  }

  // Bound immediately: the narrowing above is on a property access, and the
  // `resolve()` call below is enough to lose it by the time `base` is spread.
  const expect: "pass" | "fail" = a.expect;

  const base = {
    ok: true as const,
    taskId: a.task,
    expect,
    container: a.container ?? DEFAULT_CONTAINER,
    solutionDir: resolve(a.solution),
    strictFailMode: a.strictFailMode ?? false,
  };

  if (a.testFile === undefined) {
    // Refuse rather than ignore: silently dropping these would run the
    // id-based resolution the caller was explicitly trying to bypass, and
    // report its "Test file not found" as a real oracle result.
    if (
      a.testCodeunitId !== undefined || a.prereqDir !== undefined ||
      a.stageSymbolsDir !== undefined
    ) {
      return {
        ok: false,
        message:
          "--test-codeunit-id, --prereq-dir and --stage-symbols-dir only " +
          "apply with --test-file (without it the oracle is resolved from " +
          "the committed task id).",
      };
    }
    return { ...base, oracle: { via: "task-id" } };
  }

  let testCodeunitId: number | undefined;
  if (a.testCodeunitId !== undefined) {
    testCodeunitId = Number(a.testCodeunitId);
    if (!Number.isInteger(testCodeunitId)) {
      return {
        ok: false,
        message:
          `--test-codeunit-id must be an integer, got '${a.testCodeunitId}'`,
      };
    }
  }

  return {
    ...base,
    oracle: {
      via: "test-file",
      testFile: resolve(a.testFile),
      ...(testCodeunitId !== undefined ? { testCodeunitId } : {}),
      ...(a.prereqDir !== undefined ? { prereqDir: resolve(a.prereqDir) } : {}),
      ...(a.stageSymbolsDir !== undefined
        ? { stageSymbolsDir: resolve(a.stageSymbolsDir) }
        : {}),
    },
  };
}

/**
 * POSITIVE evidence that a run actually reached the oracle's assertions and
 * lost: the test step ran at least one test, and at least one of them failed.
 *
 * This is the whole of the strict-fail contract, and it is deliberately
 * phrased as evidence-of-success-of-the-test-step rather than as
 * evidence-of-compile-failure. The previous formulation inferred "did not
 * compile" from `compileErrors.length > 0`, which is a SIDE CHANNEL:
 * `handleAlVerify` populates `compileErrors` at exactly two sites (the prereq
 * compile failure and the candidate compile failure), and both build it from
 * the AL parser's error list. A compile that dies WITHOUT producing
 * parser-recognisable `file(line,col): ALxxxx` lines — an alc crash, truncated
 * output, a killed script — returns `success:false, errors:[]`
 * (`isCompilationSuccessful` in `src/container/bc-output-parsers.ts` is
 * `errorCount === 0 && output.includes("COMPILE_SUCCESS")`, so a missing
 * sentinel alone fails it). That produced `compileErrors: []`, length 0, "no
 * compile errors", exit 0 — a naive side that never compiled scored as a
 * legitimate assertion failure and the task was recorded as discriminating.
 * The `naive/` directory losing its `app.json` was the same bug through
 * another door: `handleAlVerify` returns `{success:false, message:"No app.json
 * found in …"}` with no `compileErrors` key at all.
 *
 * Requiring evidence instead of absence-of-evidence closes every one of those
 * doors at once, including the ones nobody has hit yet — "Test file not
 * found", "app.json preparation failed", a publish that never happened, and a
 * run that published but executed zero tests all fail this predicate for the
 * same reason: no assertion was ever evaluated, so nothing discriminated.
 *
 * The `totalTests !== undefined` check is there for the TYPE system, not the
 * runtime: `undefined > 0` is already `false`, so the comparison alone would
 * reject a run that never reached the test step. Under
 * `exactOptionalPropertyTypes` the explicit narrowing is still required to
 * compare an optional `number | undefined` at all. (`undefined` means the run
 * never reached the test step — every early return omits the field; `0` means
 * it reached the step and ran nothing. Both must fail, and both do.)
 *
 * `syntheticNoTestsRan` is the one case where the counts LIE in the honest
 * direction for a different consumer. A candidate that compiles but fails to
 * publish/install is reported by `makePublishFailureTestResult`
 * (`src/container/bc-container-provider.ts`) as `totalTests: 1, failed: 1` so
 * the BENCH scores it as a model failure rather than retrying it as infra.
 * That convention is right there and wrong here: a naive side that never
 * installed never evaluated an assertion, so it proves nothing about whether
 * the oracle discriminates. The flag is what lets both readings coexist
 * without either one string-matching the other's output.
 */
function reachedAndFailedAssertions(res: VerifyResult): boolean {
  if (res.syntheticNoTestsRan) return false;
  return res.totalTests !== undefined && res.totalTests > 0 &&
    (res.failed ?? 0) > 0;
}

/**
 * Exit code for a run whose outcome already MATCHED `--expect`.
 *
 * Returns `4` only when strict-fail mode is on, `fail` was expected, `fail`
 * was what happened, and the run did NOT reach and fail real assertions (see
 * {@link reachedAndFailedAssertions}). A plausible-but-wrong trap solution
 * should compile, publish, run the oracle and lose on its assertions; a naive
 * side that never got that far is the signature of a misnamed solution
 * colliding, a helper present on the correct side and absent on the naive one,
 * an unresolved symbol, or a draft missing a manifest — none of which is real
 * discrimination.
 *
 * Gated behind the flag so every existing invocation keeps its exit codes:
 * without `--strict-fail-mode` this returns 0 unconditionally, so exit 4 stays
 * unreachable for `scripts/run-xiterate.ps1` and every hand invocation.
 */
export function strictFailExitCode(input: {
  strictFailMode: boolean;
  expect: "pass" | "fail";
  outcome: ProbeOutcome;
  /** The handler's own result — the only thing that can carry the evidence. */
  result: VerifyResult;
}): number {
  if (!input.strictFailMode) return 0;
  if (input.expect !== "fail" || input.outcome !== "fail") return 0;
  return reachedAndFailedAssertions(input.result) ? 0 : 4;
}

async function main() {
  const a = parseArgs(Deno.args, {
    string: [
      "task",
      "solution",
      "expect",
      "container",
      "test-file",
      "test-codeunit-id",
      "prereq-dir",
      "stage-symbols-dir",
    ],
    boolean: ["strict-fail-mode"],
    default: { container: DEFAULT_CONTAINER },
  });

  const plan = planProbe({
    task: a.task,
    solution: a.solution,
    expect: a.expect,
    container: a.container,
    testFile: a["test-file"],
    testCodeunitId: a["test-codeunit-id"],
    prereqDir: a["prereq-dir"],
    stageSymbolsDir: a["stage-symbols-dir"],
    strictFailMode: a["strict-fail-mode"],
  });
  if (!plan.ok) {
    console.error(plan.message);
    Deno.exit(2);
  }

  // MUST happen before the dynamic import below — see the file-header note
  // on why this can't be a static import + a later loadEnvironment() call.
  await resolveCredentialsEnv();
  const { handleAlVerify, handleAlVerifyTask } = await import(
    "../mcp/al-tools-server.ts"
  );

  let res: VerifyResult;
  if (plan.oracle.via === "test-file") {
    console.error(
      colors.gray(`[trap-probe] oracle: ${plan.oracle.testFile}`),
    );
    res = await handleAlVerify({
      projectDir: plan.solutionDir,
      testFile: plan.oracle.testFile,
      containerName: plan.container,
      ...(plan.oracle.testCodeunitId !== undefined
        ? { testCodeunitId: plan.oracle.testCodeunitId }
        : {}),
      ...(plan.oracle.prereqDir !== undefined
        ? { prereqDir: plan.oracle.prereqDir }
        : {}),
      ...(plan.oracle.stageSymbolsDir !== undefined
        ? { stageSymbolsDir: plan.oracle.stageSymbolsDir }
        : {}),
    });
  } else {
    res = await handleAlVerifyTask({
      projectDir: plan.solutionDir,
      taskId: plan.taskId,
      containerName: plan.container,
    });
  }

  const outcome = classifyProbeOutcome(res);
  console.log(
    `[trap-probe] ${plan.taskId}: actual=${outcome} expected=${plan.expect}`,
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

  const strictCode = strictFailExitCode({
    strictFailMode: plan.strictFailMode,
    expect: plan.expect,
    outcome,
    result: res,
  });
  if (strictCode === 4) {
    console.error(
      colors.yellow(
        `[trap-probe] UNEARNED FAIL — the naive side never reached and ` +
          `failed the oracle's assertions (no test ran, or none failed). ` +
          `It failed to compile, publish, or find its manifest instead. ` +
          `That is not discrimination.`,
      ),
    );
    Deno.exit(4);
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
