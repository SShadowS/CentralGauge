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
