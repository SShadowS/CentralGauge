// tests/unit/scripts/trap-probe.test.ts
//
// SAFETY: nothing here spawns trap-probe or touches a container. Only the
// pure classifier and the pure argument planner are exercised.
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { isAbsolute } from "@std/path";
import {
  classifyProbeOutcome,
  planProbe,
  strictFailExitCode,
  type VerifyResult,
} from "../../../scripts/trap-probe.ts";

Deno.test("classifyProbeOutcome: success:true is pass", () => {
  const res: VerifyResult = {
    success: true,
    message: "All tests passed! (5/5)",
    totalTests: 5,
    passed: 5,
    failed: 0,
  };
  assertEquals(classifyProbeOutcome(res), "pass");
});

Deno.test("classifyProbeOutcome: success:false with testResults failures is fail", () => {
  const res: VerifyResult = {
    success: false,
    message: "Tests failed: 2 of 5 tests failed",
    totalTests: 5,
    passed: 3,
    failed: 2,
    failures: ["TestAdd: expected 5 got 4", "TestSub: expected 1 got 2"],
  };
  assertEquals(classifyProbeOutcome(res), "fail");
});

Deno.test("classifyProbeOutcome: success:false with compile errors is fail", () => {
  const res: VerifyResult = {
    success: false,
    message: "Verification compilation failed",
    compileErrors: [
      "MyCodeunit.al(10,5): AL0118 - The name 'Foo' does not exist",
    ],
  };
  assertEquals(classifyProbeOutcome(res), "fail");
});

Deno.test("classifyProbeOutcome: caught-exception catch-all message is inconclusive (GH #13 zero_tests)", () => {
  const res: VerifyResult = {
    success: false,
    message:
      "Verification error: Zero tests detected after successful publish (infra)",
  };
  assertEquals(classifyProbeOutcome(res), "inconclusive");
});

Deno.test("classifyProbeOutcome: caught-exception catch-all with generic ContainerError label is inconclusive", () => {
  // Most ContainerError messages are generic operation labels — the real
  // SYSLIB0014/SQL-down/PSSession-lost signature text lives in rawOutput,
  // which never survives into VerifyResult.message. The catch-all prefix
  // alone must be enough to classify these as inconclusive.
  const res: VerifyResult = {
    success: false,
    message: "Verification error: Publish failed",
  };
  assertEquals(classifyProbeOutcome(res), "inconclusive");
});

Deno.test("classifyProbeOutcome: non-prefixed message matching a known infra signature is inconclusive", () => {
  const res: VerifyResult = {
    success: false,
    message: "SYSLIB0014: ServicePointManager is obsolete",
  };
  assertEquals(classifyProbeOutcome(res), "inconclusive");
});

Deno.test("classifyProbeOutcome: a missing oracle scores as a real fail, not inconclusive", () => {
  // Why an id-based probe of an unpromoted draft was so damaging: the id
  // resolution's miss carries neither the catch-all prefix nor an infra
  // signature, so it is indistinguishable here from a solution that genuinely
  // failed the oracle. Both draft sides scored "fail" and the operator was
  // told to fix a reference solution that had never run.
  const res: VerifyResult = {
    success: false,
    message:
      "Test file not found: U:\\Git\\CentralGauge\\tests\\al\\hard\\CG-AL-X053.Test.al",
  };
  assertEquals(classifyProbeOutcome(res), "fail");
});

// --- planProbe: which handler runs, and on what -----------------------------
//
// The `task-id` mode is the ORIGINAL contract (run-xiterate.ps1's sanity lane
// and every hand invocation). The `test-file` mode is additive and exists so
// an unpromoted scratch/<id>/ draft can be probed at all - resolving its
// oracle from the task id finds nothing under tests/al/ and reports "Test
// file not found" as though it were a real oracle failure.

Deno.test("planProbe: --task alone still routes through the task-id oracle", () => {
  const plan = planProbe({
    task: "CG-AL-X002",
    solution: "scratch/CG-AL-X002/correct",
    expect: "pass",
    container: "Cronus28",
  });

  assertEquals(plan.ok, true);
  if (!plan.ok) return;
  assertEquals(plan.oracle.via, "task-id");
  assertEquals(plan.taskId, "CG-AL-X002");
  assertEquals(plan.expect, "pass");
  assertEquals(plan.container, "Cronus28");
  // Relative --solution is resolved for the caller: the compile step runs in
  // a pwsh subprocess whose cwd is not this process's.
  assertEquals(isAbsolute(plan.solutionDir), true);
});

Deno.test("planProbe: --test-file switches to the explicit-oracle mode", () => {
  const plan = planProbe({
    task: "CG-AL-X053",
    solution: "scratch/CG-AL-X053/correct",
    expect: "pass",
    testFile: "scratch/CG-AL-X053/CG-AL-X053.Test.al",
    testCodeunitId: "80053",
    prereqDir: "scratch/CG-AL-X053/prereq",
  });

  assertEquals(plan.ok, true);
  if (!plan.ok || plan.oracle.via !== "test-file") {
    throw new Error("expected the test-file oracle mode");
  }
  assertEquals(isAbsolute(plan.oracle.testFile), true);
  assertStringIncludes(plan.oracle.testFile, "CG-AL-X053.Test.al");
  assertEquals(plan.oracle.testCodeunitId, 80053);
  assertEquals(isAbsolute(plan.oracle.prereqDir ?? ""), true);
  // --task is still carried: it labels the output, and handleAlVerify
  // independently derives the same id from the test file's name.
  assertEquals(plan.taskId, "CG-AL-X053");
});

Deno.test("planProbe: --test-file without the optional extras", () => {
  const plan = planProbe({
    task: "CG-AL-X053",
    solution: "scratch/CG-AL-X053/naive",
    expect: "fail",
    testFile: "scratch/CG-AL-X053/CG-AL-X053.Test.al",
  });

  assertEquals(plan.ok, true);
  if (!plan.ok || plan.oracle.via !== "test-file") {
    throw new Error("expected the test-file oracle mode");
  }
  assertEquals(plan.oracle.testCodeunitId, undefined);
  assertEquals(plan.oracle.prereqDir, undefined);
  assertEquals(plan.expect, "fail");
});

Deno.test("planProbe: defaults the container to Cronus28", () => {
  const plan = planProbe({
    task: "CG-AL-X002",
    solution: "scratch/CG-AL-X002/correct",
    expect: "pass",
  });

  assertEquals(plan.ok, true);
  if (!plan.ok) return;
  assertEquals(plan.container, "Cronus28");
});

Deno.test("planProbe: refuses --test-codeunit-id without --test-file", () => {
  // Ignoring it would silently run the id-based resolution the caller was
  // explicitly trying to bypass, and report its miss as a real oracle result.
  const plan = planProbe({
    task: "CG-AL-X053",
    solution: "scratch/CG-AL-X053/correct",
    expect: "pass",
    testCodeunitId: "80053",
  });

  assertEquals(plan.ok, false);
  if (plan.ok) return;
  assertStringIncludes(plan.message, "--test-file");
});

Deno.test("planProbe: refuses --prereq-dir without --test-file", () => {
  const plan = planProbe({
    task: "CG-AL-X053",
    solution: "scratch/CG-AL-X053/correct",
    expect: "pass",
    prereqDir: "scratch/CG-AL-X053/prereq",
  });

  assertEquals(plan.ok, false);
  if (plan.ok) return;
  assertStringIncludes(plan.message, "--test-file");
});

Deno.test("planProbe: refuses a non-integer --test-codeunit-id", () => {
  const plan = planProbe({
    task: "CG-AL-X053",
    solution: "scratch/CG-AL-X053/correct",
    expect: "pass",
    testFile: "scratch/CG-AL-X053/CG-AL-X053.Test.al",
    testCodeunitId: "eighty-thousand",
  });

  assertEquals(plan.ok, false);
  if (plan.ok) return;
  assertStringIncludes(plan.message, "--test-codeunit-id");
});

Deno.test("planProbe: refuses a missing required argument", () => {
  const plan = planProbe({ task: "CG-AL-X002", expect: "pass" });

  assertEquals(plan.ok, false);
  if (plan.ok) return;
  assertStringIncludes(plan.message, "--solution");
});

Deno.test("planProbe: refuses an --expect that is neither pass nor fail", () => {
  const plan = planProbe({
    task: "CG-AL-X002",
    solution: "scratch/CG-AL-X002/correct",
    expect: "maybe",
  });

  assertEquals(plan.ok, false);
  if (plan.ok) return;
  assertStringIncludes(plan.message, "--expect");
});

// --- Task 7 additive flags: --stage-symbols-dir + --strict-fail-mode -------

describe("scripts/trap-probe", () => {
  describe("planProbe additive flags", () => {
    const base = {
      task: "CG-AL-X053",
      solution: "scratch/CG-AL-X053/correct",
      expect: "pass",
    };

    it("omits stageSymbolsDir when the flag is absent", () => {
      const plan = planProbe({
        ...base,
        testFile: "scratch/CG-AL-X053/correct/CG-AL-X053.Test.al",
      });
      assertEquals(plan.ok, true);
      if (!plan.ok) return;
      assertEquals(plan.oracle.via, "test-file");
      if (plan.oracle.via !== "test-file") return;
      assertEquals(plan.oracle.stageSymbolsDir, undefined);
    });

    it("resolves stageSymbolsDir to an absolute path", () => {
      const plan = planProbe({
        ...base,
        testFile: "scratch/CG-AL-X053/correct/CG-AL-X053.Test.al",
        stageSymbolsDir: "scratch/CG-AL-X053/.symbols",
      });
      assertEquals(plan.ok, true);
      if (!plan.ok || plan.oracle.via !== "test-file") return;
      assertEquals(
        plan.oracle.stageSymbolsDir?.includes(".symbols"),
        true,
      );
      assertEquals(
        plan.oracle.stageSymbolsDir?.startsWith("scratch"),
        false,
        "must be absolute - the compile pool's cwd is not this process's",
      );
    });

    it("refuses --stage-symbols-dir without --test-file", () => {
      const plan = planProbe({ ...base, stageSymbolsDir: "somewhere" });
      assertEquals(plan.ok, false);
    });

    it("carries strictFailMode through", () => {
      const plan = planProbe({
        ...base,
        expect: "fail",
        strictFailMode: true,
      });
      assertEquals(plan.ok, true);
      if (!plan.ok) return;
      assertEquals(plan.strictFailMode, true);
    });

    it("defaults strictFailMode to false", () => {
      const plan = planProbe(base);
      assertEquals(plan.ok, true);
      if (!plan.ok) return;
      assertEquals(plan.strictFailMode, false);
    });
  });

  describe("strictFailExitCode", () => {
    // Each fixture is a VERBATIM shape of a real `handleAlVerify` return, so
    // these tests fail if that handler's contract drifts rather than merely
    // if this predicate does. Site references are to `mcp/al-tools-server.ts`.

    /** The one legitimate discrimination: compiled, published, ran, lost. */
    const assertionFailure: VerifyResult = {
      success: false,
      message: "Tests failed: 2 of 5 tests failed",
      totalTests: 5,
      passed: 3,
      failed: 2,
      failures: ["TestPostsLine: expected 100 got 0"],
    };

    /** Candidate compile failure WITH parseable AL errors. */
    const compileFailWithErrors: VerifyResult = {
      success: false,
      message: "Verification compilation failed",
      compileErrors: [
        "CG-AL-X053.al(12,5): AL0118 - The name 'Foo' does not exist",
      ],
    };

    /**
     * BYPASS PATH 1. A compile that died without the `COMPILE_SUCCESS`
     * sentinel AND without parser-recognisable `file(line,col): ALxxxx` lines
     * — an alc crash, truncated output, a killed script. `errors` is empty, so
     * the handler's `.map()` yields `compileErrors: []`. The old
     * `compileErrors.length > 0` test read that as "no compile errors" and
     * scored a naive side that never compiled as a real assertion failure.
     */
    const compileFailEmptyErrors: VerifyResult = {
      success: false,
      message: "Verification compilation failed",
      compileErrors: [],
    };

    /**
     * BYPASS PATH 2. `naive/` with no `app.json`: the handler returns before
     * any compile, so there is no `compileErrors` KEY at all. Asymmetric with
     * `correct/`, where the same deletion fails closed via `--expect pass`.
     */
    const noAppJson: VerifyResult = {
      success: false,
      message:
        "No app.json found in C:/scratch/CG-AL-X053/naive or its subdirectories. " +
        "Create an app.json manifest first.",
    };

    /** Same family: the oracle could not be copied into the verify dir. */
    const testFileNotFound: VerifyResult = {
      success: false,
      message: "Test file not found: C:/scratch/CG-AL-X053/correct/x.Test.al",
    };

    /**
     * Reached the test step but ran nothing. Cannot arrive via the SOAP path
     * (that throws `ContainerError("test")` on `totalTests === 0`, which the
     * catch-all turns into "inconclusive" before this predicate is reached),
     * but is asserted anyway so the gate does not depend on that upstream
     * guard staying in place.
     */
    const zeroTests: VerifyResult = {
      success: false,
      message: "Tests failed: 0 of 0 tests failed",
      totalTests: 0,
      passed: 0,
      failed: 0,
    };

    const underStrict = (result: VerifyResult) =>
      strictFailExitCode({
        strictFailMode: true,
        expect: "fail",
        outcome: "fail",
        result,
      });

    it("returns 0 for a genuine assertion failure — the one earned fail", () => {
      assertEquals(underStrict(assertionFailure), 0);
    });

    it("returns 4 for a compile failure with a populated error array", () => {
      assertEquals(underStrict(compileFailWithErrors), 4);
    });

    it("returns 4 for a compile failure with an EMPTY error array (bypass path 1)", () => {
      assertEquals(underStrict(compileFailEmptyErrors), 4);
    });

    it("returns 4 when there is no compileErrors key and no tests (bypass path 2)", () => {
      assertEquals(underStrict(noAppJson), 4);
    });

    it("returns 4 when the oracle file could not be found", () => {
      assertEquals(underStrict(testFileNotFound), 4);
    });

    it("returns 4 when the run reached the test step but ran zero tests", () => {
      assertEquals(underStrict(zeroTests), 4);
    });

    it("returns 4 when tests ran but none of them failed", () => {
      // `success:false` with `failed:0` is not an assertion loss. Today the
      // SOAP client produces this for an all-skipped codeunit (skips count
      // toward totalTests but not toward failedTests).
      assertEquals(
        underStrict({
          success: false,
          message: "Tests failed: 0 of 3 tests failed",
          totalTests: 3,
          passed: 0,
          failed: 0,
        }),
        4,
      );
    });

    it("never returns 4 when expecting pass", () => {
      assertEquals(
        strictFailExitCode({
          strictFailMode: true,
          expect: "pass",
          outcome: "pass",
          result: compileFailWithErrors,
        }),
        0,
      );
    });

    it("never returns 4 for an outcome that is not 'fail'", () => {
      for (const outcome of ["pass", "inconclusive"] as const) {
        assertEquals(
          strictFailExitCode({
            strictFailMode: true,
            expect: "fail",
            outcome,
            result: compileFailEmptyErrors,
          }),
          0,
        );
      }
    });

    // The additive contract: `scripts/run-xiterate.ps1` and every hand
    // invocation omit `--strict-fail-mode`, and exit 4 must stay unreachable
    // for them no matter what the result looks like.
    it("returns 0 for EVERY result shape without strict mode", () => {
      for (
        const result of [
          assertionFailure,
          compileFailWithErrors,
          compileFailEmptyErrors,
          noAppJson,
          testFileNotFound,
          zeroTests,
        ]
      ) {
        assertEquals(
          strictFailExitCode({
            strictFailMode: false,
            expect: "fail",
            outcome: "fail",
            result,
          }),
          0,
        );
      }
    });
  });
});
