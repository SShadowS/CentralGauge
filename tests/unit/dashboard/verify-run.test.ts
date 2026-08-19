import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { verifyResponse } from "../../../src/dashboard/verify-run.ts";

async function draftWithOracle(taskId: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "cg-vr-" });
  await Deno.mkdir(join(dir, "correct"), { recursive: true });
  await Deno.writeTextFile(join(dir, "correct", `${taskId}.Test.al`), "x");
  return dir;
}

Deno.test("verify-run attempt 1", async (t) => {
  await t.step("a zero-test publish defect is not a test failure", async () => {
    const draftDir = await draftWithOracle("CG-AL-X010");
    try {
      const outcome = await verifyResponse({
        draftDir,
        taskId: "CG-AL-X010",
        code: "table 70001 A { }",
        verify: () =>
          Promise.resolve({
            success: false,
            message: "zero tests ran",
            totalTests: 3,
            passed: 0,
            failed: 3,
            syntheticNoTestsRan: true,
          }),
      });
      assertEquals(outcome, {
        state: "publish_defect",
        message: "zero tests ran",
      });
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step("a compile failure reports its errors", async () => {
    const draftDir = await draftWithOracle("CG-AL-X011");
    try {
      const outcome = await verifyResponse({
        draftDir,
        taskId: "CG-AL-X011",
        code: "not al",
        verify: () =>
          Promise.resolve({
            success: false,
            message: "compilation failed",
            compileErrors: ["AL0118: syntax error"],
          }),
      });
      assertEquals(outcome.state, "didnt_compile");
      if (outcome.state !== "didnt_compile") throw new Error("unreachable");
      assertEquals(outcome.compileErrors, ["AL0118: syntax error"]);
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step("all tests passing is passed_first_try", async () => {
    const draftDir = await draftWithOracle("CG-AL-X012");
    try {
      const outcome = await verifyResponse({
        draftDir,
        taskId: "CG-AL-X012",
        code: "table 70001 A { }",
        verify: () =>
          Promise.resolve({
            success: true,
            message: "ok",
            totalTests: 3,
            passed: 3,
            failed: 0,
          }),
      });
      assertEquals(outcome, { state: "passed_first_try", passed: 3, total: 3 });
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step(
    "a success claim with zero tests behind it is not a pass",
    async () => {
      // Reachable shape: verifyResultFromTestResult propagates
      // testResult.success and its counts straight through with no floor,
      // so success:true + totalTests:0 is constructible even though this
      // repo's infra layer is supposed to intercept a real
      // zero-tests-after-successful-publish case upstream (GH #13). This
      // module holds the invariant locally rather than trusting that.
      const draftDir = await draftWithOracle("CG-AL-X016");
      try {
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X016",
          code: "table 70001 A { }",
          verify: () =>
            Promise.resolve({
              success: true,
              message: "All tests passed! (0/0)",
              totalTests: 0,
              passed: 0,
              failed: 0,
            }),
        });
        assertEquals(outcome, {
          state: "publish_defect",
          message: "All tests passed! (0/0)",
        });
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step(
    "the staged directory is cleaned up even when verify throws",
    async () => {
      const draftDir = await draftWithOracle("CG-AL-X013");
      let seenProjectDir = "";
      try {
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X013",
          code: "table 70001 A { }",
          verify: (p) => {
            seenProjectDir = p.projectDir;
            return Promise.reject(new Error("container offline"));
          },
        });
        assertEquals(outcome, {
          state: "errored",
          message: "container offline",
        });
        assertEquals(
          seenProjectDir !== "",
          true,
          "the injected verifier must actually have been called",
        );
        let exists = true;
        try {
          await Deno.stat(seenProjectDir);
        } catch {
          exists = false;
        }
        assertEquals(exists, false, "cleanup must run in a finally");
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step(
    "a bare success:false with no totalTests is not a test failure",
    async () => {
      // Reachable shape: handleAlVerify's app.json-prep failure
      // (mcp/al-tools-server.ts:1407), test-file-copy failure (:1427), and
      // outer catch-all (:1558-1560, which also absorbs a thrown infra
      // ContainerError) all return exactly this — no totalTests field at
      // all, so there is no positive evidence any test ran.
      const draftDir = await draftWithOracle("CG-AL-X014");
      try {
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X014",
          code: "table 70001 A { }",
          verify: () =>
            Promise.resolve({
              success: false,
              message: "Verification error: container offline",
            }),
        });
        assertEquals(outcome, {
          state: "errored",
          message: "Verification error: container offline",
        });
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step(
    "a legacy zero-count test result is not a test failure",
    async () => {
      // Reachable shape: createFailedTestResult
      // (src/container/bc-container-provider.ts:2478) produces
      // {totalTests: 0, passedTests: 0, failedTests: 0} with no
      // syntheticNoTestsRan flag; verifyResultFromTestResult carries that
      // straight through to totalTests: 0 / passed: 0 / failed: 0.
      const draftDir = await draftWithOracle("CG-AL-X015");
      try {
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X015",
          code: "table 70001 A { }",
          verify: () =>
            Promise.resolve({
              success: false,
              message: "Tests failed: 0 of 0 tests failed",
              totalTests: 0,
              passed: 0,
              failed: 0,
              failures: [],
            }),
        });
        assertEquals(outcome, {
          state: "errored",
          message: "Tests failed: 0 of 0 tests failed",
        });
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );
});

Deno.test("verify-run fix attempt", async (t) => {
  await t.step(
    "a failing attempt 1 that the fix repairs is passed_second_try",
    async () => {
      const draftDir = await draftWithOracle("CG-AL-X020");
      try {
        let n = 0;
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X020",
          code: "table 70001 A { }",
          model: "fake/model",
          call: () =>
            Promise.resolve({
              content: "table 70001 A { }",
              finishReason: "stop",
            }),
          verify: () => {
            n++;
            return Promise.resolve(
              n === 1
                ? {
                  success: false,
                  message: "fail",
                  totalTests: 3,
                  passed: 1,
                  failed: 2,
                  failures: ["T1"],
                }
                : {
                  success: true,
                  message: "ok",
                  totalTests: 3,
                  passed: 3,
                  failed: 0,
                },
            );
          },
        });
        assertEquals(outcome.state, "passed_second_try");
        assertEquals(n, 2, "exactly two verifies");
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step("no fix attempt is made after a publish defect", async () => {
    const draftDir = await draftWithOracle("CG-AL-X021");
    try {
      let calls = 0;
      const outcome = await verifyResponse({
        draftDir,
        taskId: "CG-AL-X021",
        code: "table 70001 A { }",
        model: "fake/model",
        call: () => {
          calls++;
          return Promise.resolve({ content: "x", finishReason: "stop" });
        },
        verify: () =>
          Promise.resolve({
            success: false,
            message: "zero tests",
            syntheticNoTestsRan: true,
          }),
      });
      assertEquals(outcome.state, "publish_defect");
      assertEquals(calls, 0, "infra outcome must not consume a model call");
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step("still failing after the fix is failed_both", async () => {
    // Counts verifies (not just the final state): an implementation that
    // never runs the fix attempt at all produces the identical final state,
    // so only the call count can tell "the fix ran and failed" apart from
    // "the fix never ran".
    const draftDir = await draftWithOracle("CG-AL-X022");
    try {
      let n = 0;
      const outcome = await verifyResponse({
        draftDir,
        taskId: "CG-AL-X022",
        code: "table 70001 A { }",
        model: "fake/model",
        call: () =>
          Promise.resolve({
            content: "table 70001 A { }",
            finishReason: "stop",
          }),
        verify: () => {
          n++;
          return Promise.resolve({
            success: false,
            message: "fail",
            totalTests: 3,
            passed: 1,
            failed: 2,
            failures: ["T1", "T2"],
          });
        },
      });
      assertEquals(outcome.state, "failed_both");
      assertEquals(n, 2, "exactly two verifies: the fix attempt ran");
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step(
    "a throwing fix call leaves attempt 1's outcome standing",
    async () => {
      // Counts model calls: an implementation that never attempts the fix
      // would produce the identical failed_both state, so only the call
      // count proves the model was actually reached before it threw.
      const draftDir = await draftWithOracle("CG-AL-X023");
      try {
        let calls = 0;
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X023",
          code: "table 70001 A { }",
          model: "fake/model",
          call: () => {
            calls++;
            return Promise.reject(new Error("rate limited"));
          },
          verify: () =>
            Promise.resolve({
              success: false,
              message: "fail",
              totalTests: 3,
              passed: 1,
              failed: 2,
              failures: ["T1"],
            }),
        });
        assertEquals(outcome.state, "failed_both");
        assertEquals(
          calls,
          1,
          "the fix call was actually made before it threw",
        );
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step("errored skips the fix attempt", async () => {
    // `errored` is an infrastructure outcome, same rule as publish_defect,
    // but reached via a thrown verifier rather than syntheticNoTestsRan.
    const draftDir = await draftWithOracle("CG-AL-X024");
    try {
      let calls = 0;
      const outcome = await verifyResponse({
        draftDir,
        taskId: "CG-AL-X024",
        code: "table 70001 A { }",
        model: "fake/model",
        call: () => {
          calls++;
          return Promise.resolve({ content: "x", finishReason: "stop" });
        },
        verify: () => Promise.reject(new Error("container offline")),
      });
      assertEquals(outcome.state, "errored");
      assertEquals(calls, 0, "an infra outcome must not consume a model call");
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step(
    "an infra failure on the fix attempt does not erase attempt 1's failed_both",
    async () => {
      // attempt 1 is a genuine failed_both with real counts; attempt 2's
      // container dies (errored). Losing attempt 1's measurement here would
      // be the same loss the throwing-fix-call test already refuses to
      // accept, just reached one verify later instead of at the model call.
      const draftDir = await draftWithOracle("CG-AL-X025");
      try {
        let n = 0;
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X025",
          code: "table 70001 A { }",
          model: "fake/model",
          call: () =>
            Promise.resolve({
              content: "table 70001 A { }",
              finishReason: "stop",
            }),
          verify: () => {
            n++;
            return Promise.resolve(
              n === 1
                ? {
                  success: false,
                  message: "fail",
                  totalTests: 3,
                  passed: 1,
                  failed: 2,
                  failures: ["T1", "T2"],
                }
                : { success: false, message: "container offline" },
            );
          },
        });
        assertEquals(outcome, {
          state: "failed_both",
          passed: 1,
          total: 3,
          failures: ["T1", "T2"],
        });
        assertEquals(n, 2, "the fix attempt actually ran");
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step(
    "an infra failure on the fix attempt does not erase attempt 1's failed_both (publish_defect variant)",
    async () => {
      // Same claim as above, but attempt 2 publishes/installs badly
      // (syntheticNoTestsRan) instead of throwing outright.
      const draftDir = await draftWithOracle("CG-AL-X026");
      try {
        let n = 0;
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X026",
          code: "table 70001 A { }",
          model: "fake/model",
          call: () =>
            Promise.resolve({
              content: "table 70001 A { }",
              finishReason: "stop",
            }),
          verify: () => {
            n++;
            return Promise.resolve(
              n === 1
                ? {
                  success: false,
                  message: "fail",
                  totalTests: 3,
                  passed: 1,
                  failed: 2,
                  failures: ["T1", "T2"],
                }
                : {
                  success: false,
                  message: "zero tests",
                  syntheticNoTestsRan: true,
                },
            );
          },
        });
        assertEquals(outcome, {
          state: "failed_both",
          passed: 1,
          total: 3,
          failures: ["T1", "T2"],
        });
        assertEquals(n, 2, "the fix attempt actually ran");
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step(
    "a fix attempt that fails to compile does not erase attempt 1's counts",
    async () => {
      // Attempt 1 MEASURED something (1 of 3, with failing test names); the
      // rewrite measured nothing. Returning `second` would both discard the
      // run's only measurement and label the response "Didn't compile",
      // which the docs define as "The first attempt's code did not
      // compile" — false here. Counts verifies too, so "the fix ran and
      // failed to compile" is distinguishable from "the fix never ran".
      const draftDir = await draftWithOracle("CG-AL-X030");
      try {
        let n = 0;
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X030",
          code: "table 70001 A { }",
          model: "fake/model",
          call: () =>
            Promise.resolve({ content: "not al", finishReason: "stop" }),
          verify: () => {
            n++;
            return Promise.resolve(
              n === 1
                ? {
                  success: false,
                  message: "fail",
                  totalTests: 3,
                  passed: 1,
                  failed: 2,
                  failures: ["T1", "T2"],
                }
                : {
                  success: false,
                  message: "compilation failed",
                  compileErrors: ["AL0118: syntax error"],
                },
            );
          },
        });
        assertEquals(outcome, {
          state: "failed_both",
          passed: 1,
          total: 3,
          failures: ["T1", "T2"],
        });
        assertEquals(n, 2, "the fix attempt actually ran");
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step(
    "the mirror case still reports the fix attempt's measured result",
    async () => {
      // Attempt 1 `didnt_compile` -> attempt 2 `failed_both`. Here the fix
      // attempt is the one that measured something, so it is returned. Pins
      // that the fallback above is one-directional and did not become a
      // blanket "attempt 1 always wins".
      const draftDir = await draftWithOracle("CG-AL-X031");
      try {
        let n = 0;
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X031",
          code: "not al",
          model: "fake/model",
          call: () =>
            Promise.resolve({
              content: "table 70001 A { }",
              finishReason: "stop",
            }),
          verify: () => {
            n++;
            return Promise.resolve(
              n === 1
                ? {
                  success: false,
                  message: "compilation failed",
                  compileErrors: ["AL0118: syntax error"],
                }
                : {
                  success: false,
                  message: "fail",
                  totalTests: 3,
                  passed: 1,
                  failed: 2,
                  failures: ["T1"],
                },
            );
          },
        });
        assertEquals(outcome, {
          state: "failed_both",
          passed: 1,
          total: 3,
          failures: ["T1"],
        });
        assertEquals(n, 2, "the fix attempt actually ran");
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step(
    "a bench that starts before the fix attempt stops its publish",
    async () => {
      // The gate is checked once at dispatch, and the job then publishes
      // TWICE with a model call in between. This pins the second check:
      // counts verifies (not just the final state), since an
      // implementation that ran the fix anyway produces a `failed_both`
      // that looks identical from the outside.
      const draftDir = await draftWithOracle("CG-AL-X027");
      try {
        let n = 0;
        let gateCalls = 0;
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X027",
          code: "table 70001 A { }",
          model: "fake/model",
          call: () =>
            Promise.resolve({
              content: "table 70001 A { }",
              finishReason: "stop",
            }),
          gate: () => {
            gateCalls++;
            return { allowed: false, reason: "`bench` is running" };
          },
          verify: () => {
            n++;
            return Promise.resolve({
              success: false,
              message: "fail",
              totalTests: 3,
              passed: 1,
              failed: 2,
              failures: ["T1", "T2"],
            });
          },
        });
        assertEquals(outcome, {
          state: "failed_both",
          passed: 1,
          total: 3,
          failures: ["T1", "T2"],
        });
        assertEquals(n, 1, "the fix attempt must NOT have published");
        assertEquals(gateCalls, 1, "the gate was consulted before attempt 2");
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step(
    "an open gate lets the fix attempt through unchanged",
    async () => {
      const draftDir = await draftWithOracle("CG-AL-X028");
      try {
        let n = 0;
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X028",
          code: "table 70001 A { }",
          model: "fake/model",
          call: () =>
            Promise.resolve({
              content: "table 70001 A { }",
              finishReason: "stop",
            }),
          gate: () => ({ allowed: true }),
          verify: () => {
            n++;
            return Promise.resolve(
              n === 1
                ? {
                  success: false,
                  message: "fail",
                  totalTests: 3,
                  passed: 1,
                  failed: 2,
                  failures: ["T1"],
                }
                : {
                  success: true,
                  message: "ok",
                  totalTests: 3,
                  passed: 3,
                  failed: 0,
                },
            );
          },
        });
        assertEquals(outcome.state, "passed_second_try");
        assertEquals(n, 2, "exactly two verifies");
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step(
    "a throwing gate leaves attempt 1's outcome standing",
    async () => {
      // `gate` is a generic injection seam. An unguarded throw here would
      // propagate out of `verifyResponse` and be caught by the queue as
      // `errored`, discarding attempt 1's real, measured counts.
      const draftDir = await draftWithOracle("CG-AL-X029");
      try {
        let n = 0;
        const outcome = await verifyResponse({
          draftDir,
          taskId: "CG-AL-X029",
          code: "table 70001 A { }",
          model: "fake/model",
          call: () =>
            Promise.resolve({
              content: "table 70001 A { }",
              finishReason: "stop",
            }),
          gate: () => {
            throw new Error("marker file unreadable");
          },
          verify: () => {
            n++;
            return Promise.resolve({
              success: false,
              message: "fail",
              totalTests: 3,
              passed: 1,
              failed: 2,
              failures: ["T1", "T2"],
            });
          },
        });
        assertEquals(outcome, {
          state: "failed_both",
          passed: 1,
          total: 3,
          failures: ["T1", "T2"],
        });
        assertEquals(n, 1, "the fix attempt must NOT have published");
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );
});
