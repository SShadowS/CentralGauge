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
      assertEquals(outcome.state, "publish_defect");
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
        assertEquals(outcome.state, "errored");
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
});
