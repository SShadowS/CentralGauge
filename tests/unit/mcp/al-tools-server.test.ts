import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  handleAlVerify,
  handleAlVerifyTask,
  loadTaskTarget,
  loadTestCodeunitId,
  resolveTestFileFromTaskId,
  verifyResultFromTestResult,
} from "../../../mcp/al-tools-server.ts";

// Real project root, for tests that exercise the X-prefixed (trap-task)
// resolution path against the actual committed CG-AL-X002 task files
// rather than a synthetic fixture.
const PROJECT_ROOT = fromFileUrl(new URL("../../../", import.meta.url));

describe("al-tools-server", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await Deno.makeTempDir({ prefix: "al-tools-test-" });
  });

  afterEach(async () => {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("loadTaskTarget", () => {
    it("should return OnPrem when metadata.target is OnPrem", async () => {
      // Create task directory structure
      const tasksDir = join(tempDir, "tasks", "medium");
      await ensureDir(tasksDir);

      // Create task YAML with OnPrem target
      const taskYaml = `id: CG-AL-M022
description: Test task
metadata:
  target: OnPrem
expected:
  compile: true
`;
      await Deno.writeTextFile(
        join(tasksDir, "CG-AL-M022-mock-httpclient.yml"),
        taskYaml,
      );

      const target = await loadTaskTarget("CG-AL-M022", tempDir);
      assertEquals(target, "OnPrem");
    });

    it("should return Cloud when metadata.target is Cloud", async () => {
      const tasksDir = join(tempDir, "tasks", "easy");
      await ensureDir(tasksDir);

      const taskYaml = `id: CG-AL-E001
description: Test task
metadata:
  target: Cloud
expected:
  compile: true
`;
      await Deno.writeTextFile(
        join(tasksDir, "CG-AL-E001-basic-table.yml"),
        taskYaml,
      );

      const target = await loadTaskTarget("CG-AL-E001", tempDir);
      assertEquals(target, "Cloud");
    });

    it("should return undefined when metadata.target is not set", async () => {
      const tasksDir = join(tempDir, "tasks", "hard");
      await ensureDir(tasksDir);

      const taskYaml = `id: CG-AL-H001
description: Test task without target
expected:
  compile: true
`;
      await Deno.writeTextFile(
        join(tasksDir, "CG-AL-H001-tax-calculator.yml"),
        taskYaml,
      );

      const target = await loadTaskTarget("CG-AL-H001", tempDir);
      assertEquals(target, undefined);
    });

    it("should return undefined when task file does not exist", async () => {
      const target = await loadTaskTarget("CG-AL-M999", tempDir);
      assertEquals(target, undefined);
    });

    it("should return undefined for invalid task ID format", async () => {
      const target = await loadTaskTarget("invalid-id", tempDir);
      assertEquals(target, undefined);
    });

    it("should resolve an X-prefixed (trap-task) id to the hard tier", async () => {
      // X-prefixed ids (ado-trap-2026 cohort) must resolve into tasks/hard,
      // same as H-prefixed ids. Regression for commit 4402da3.
      const tasksDir = join(tempDir, "tasks", "hard");
      await ensureDir(tasksDir);

      const taskYaml = `id: CG-AL-X002
description: Test task
metadata:
  target: OnPrem
expected:
  compile: true
`;
      await Deno.writeTextFile(
        join(tasksDir, "CG-AL-X002-codeunit-run-rollback.yml"),
        taskYaml,
      );

      const target = await loadTaskTarget("CG-AL-X002", tempDir);
      assertEquals(target, "OnPrem");
    });

    it("should resolve an X-prefixed id into medium when it only exists there", async () => {
      // ado-trap-2026 is not pinned to "hard" -- CG-AL-X004 is a medium
      // trap-task. Use a synthetic id (not a real committed task) placed
      // ONLY under tasks/medium to prove resolveXTaskDifficulty finds it
      // there rather than defaulting to "hard". Regression for the X004
      // dispatch (harness previously hardcoded X -> hard, commit 4402da3).
      const tasksDir = join(tempDir, "tasks", "medium");
      await ensureDir(tasksDir);

      const taskYaml = `id: CG-AL-X999
description: Test task
metadata:
  target: Cloud
expected:
  compile: true
`;
      await Deno.writeTextFile(
        join(tasksDir, "CG-AL-X999-synthetic-medium-trap.yml"),
        taskYaml,
      );

      const target = await loadTaskTarget("CG-AL-X999", tempDir);
      assertEquals(target, "Cloud");
    });
  });

  describe("loadTestCodeunitId", () => {
    it("should return testCodeunitId from expected section", async () => {
      const tasksDir = join(tempDir, "tasks", "medium");
      await ensureDir(tasksDir);

      const taskYaml = `id: CG-AL-M022
description: Test task
expected:
  compile: true
  testCodeunitId: 80122
`;
      await Deno.writeTextFile(
        join(tasksDir, "CG-AL-M022-mock-httpclient.yml"),
        taskYaml,
      );

      const id = await loadTestCodeunitId("CG-AL-M022", tempDir);
      assertEquals(id, 80122);
    });

    it("should return undefined when testCodeunitId is not set", async () => {
      const tasksDir = join(tempDir, "tasks", "easy");
      await ensureDir(tasksDir);

      const taskYaml = `id: CG-AL-E001
description: Test task
expected:
  compile: true
`;
      await Deno.writeTextFile(
        join(tasksDir, "CG-AL-E001-basic-table.yml"),
        taskYaml,
      );

      const id = await loadTestCodeunitId("CG-AL-E001", tempDir);
      assertEquals(id, undefined);
    });

    it("should return testCodeunitId for an X-prefixed (trap-task) id using the real committed task files", async () => {
      // CG-AL-X002 is committed under tasks/hard/ (ado-trap-2026 cohort).
      // Uses the real project root (not a tempDir fixture) to prove the
      // X-prefix is resolved into the hard/ folder against the actual
      // task YAML. Regression for commit 4402da3.
      const id = await loadTestCodeunitId("CG-AL-X002", PROJECT_ROOT);
      assertEquals(id, 80291);
    });

    it("should return testCodeunitId for the medium-tier X-prefixed (trap-task) CG-AL-X004 using the real committed task files", async () => {
      // CG-AL-X004 is committed under tasks/medium/ (ado-trap-2026 cohort,
      // first medium-tier X-task). Uses the real project root to prove the
      // X-prefix resolves into medium/ (not the hard/ default) against the
      // actual task YAML.
      const id = await loadTestCodeunitId("CG-AL-X004", PROJECT_ROOT);
      assertEquals(id, 80293);
    });
  });

  describe("resolveTestFileFromTaskId", () => {
    it("should resolve the medium-tier X-prefixed (trap-task) CG-AL-X004 to tests/al/medium using the real committed task files", async () => {
      // CG-AL-X004 is committed under tasks/medium/ (ado-trap-2026 cohort,
      // first medium-tier X-task). This is a direct regression test for the
      // function that actually blocked X004: before the resolveXTaskDifficulty
      // fix, resolveTestFileFromTaskId hardcoded every X-prefixed id to
      // tests/al/hard/, so al_verify_task could never find
      // tests/al/medium/CG-AL-X004.Test.al even though the file exists.
      const result = await resolveTestFileFromTaskId(
        "CG-AL-X004",
        PROJECT_ROOT,
      );
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(
          result.testFile,
          join(PROJECT_ROOT, "tests", "al", "medium", "CG-AL-X004.Test.al"),
        );
      }
    });

    it("should resolve an X-prefixed id into tests/al/medium when its task YAML only exists under tasks/medium", async () => {
      // Synthetic fixture proving resolution is dynamic (probes
      // tasks/{hard,medium,easy}) rather than hardcoded to "hard". Mirrors
      // the loadTaskTarget/loadTestCodeunitId synthetic-medium regression
      // tests above, but exercises resolveTestFileFromTaskId directly.
      const tasksDir = join(tempDir, "tasks", "medium");
      await ensureDir(tasksDir);
      await Deno.writeTextFile(
        join(tasksDir, "CG-AL-X998-synthetic-medium-trap.yml"),
        `id: CG-AL-X998\ndescription: Test task\nexpected:\n  compile: true\n`,
      );

      const testDir = join(tempDir, "tests", "al", "medium");
      await ensureDir(testDir);
      const testFilePath = join(testDir, "CG-AL-X998.Test.al");
      await Deno.writeTextFile(testFilePath, "codeunit 80998 Test { }\n");

      const result = await resolveTestFileFromTaskId("CG-AL-X998", tempDir);
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.testFile, testFilePath);
      }
    });

    it("should return success:false for an invalid task ID format", async () => {
      const result = await resolveTestFileFromTaskId("invalid-id", tempDir);
      assertEquals(result.success, false);
    });
  });

  /**
   * Both halves of the task-workbench probe defect, pinned without a
   * container: resolving an oracle from a task id CANNOT serve an unpromoted
   * draft, and passing the oracle explicitly reaches the verify pipeline
   * instead. Neither test below gets far enough to compile or publish -
   * `handleAlVerify` returns before `findProjectDir` yields a project.
   */
  describe("draft oracle resolution", () => {
    it("id-based resolution misses an unpromoted draft, and reports it as a plain error", async () => {
      // The draft's oracle sits in scratch/<id>/, so nothing exists at
      // tests/al/<difficulty>/<id>.Test.al. The resulting VerifyResult has
      // no "Verification error: " catch-all prefix and no infra signature,
      // so scripts/trap-probe.ts's classifyProbeOutcome scores it "fail" -
      // which is what made every scaffolded draft look non-discriminating.
      const resolution = await resolveTestFileFromTaskId(
        "CG-AL-X999",
        tempDir,
      );
      assertEquals(resolution.success, false);
      if (!resolution.success) {
        assertStringIncludes(resolution.error, "Test file not found");
      }

      const result = await handleAlVerifyTask({
        projectDir: tempDir,
        taskId: "CG-AL-X999",
      });
      assertEquals(result.success, false);
      assertStringIncludes(result.message, "Test file not found");
    });

    it("an explicit testFile bypasses id resolution and reaches the verify pipeline", async () => {
      // Same id, same absent tests/al/ entry - but the oracle is handed over
      // directly, exactly as `trap-probe --test-file` does for a draft. The
      // failure now comes from the SOLUTION directory (no app.json), i.e.
      // from inside handleAlVerify's own pipeline, proving the id-based
      // lookup is not consulted. No container is touched: findProjectDir
      // finds nothing and the handler returns before compiling.
      const draftDir = join(tempDir, "scratch", "CG-AL-X999");
      await ensureDir(draftDir);
      const draftOracle = join(draftDir, "CG-AL-X999.Test.al");
      await Deno.writeTextFile(draftOracle, "codeunit 80999 Test { }\n");

      const emptySolutionDir = join(draftDir, "correct");
      await ensureDir(emptySolutionDir);

      const result = await handleAlVerify({
        projectDir: emptySolutionDir,
        testFile: draftOracle,
        testCodeunitId: 80999,
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "No app.json found");
      assertEquals(result.message.includes("Test file not found"), false);
    });
  });

  /**
   * Middle link of the chain `makePublishFailureTestResult` ->
   * `verifyResultFromTestResult` -> `strictFailExitCode`. The other two links
   * are pinned in `tests/unit/container/bc-container-provider.test.ts` and
   * `tests/unit/scripts/trap-probe.test.ts`; drop the flag at THIS link and
   * the task workbench's discrimination gate silently reopens to the
   * publish-defect bypass with a fully green suite.
   */
  describe("verifyResultFromTestResult", () => {
    const baseTestResult = {
      duration: 1234,
      output: "",
    };

    it("forwards syntheticNoTestsRan for a publish/install defect", () => {
      // Exactly what makePublishFailureTestResult produces: real-looking 1/1
      // counts that no AL test method actually earned.
      const verify = verifyResultFromTestResult({
        ...baseTestResult,
        success: false,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        results: [{
          name: "Publish/Install",
          passed: false,
          duration: 0,
          error: "Candidate publish/install defect: …",
        }],
        syntheticNoTestsRan: true,
      });

      assertEquals(verify.syntheticNoTestsRan, true);
      // The counts must still come through — the flag qualifies them, it does
      // not replace them, and the bench still scores this as a model failure.
      assertEquals(verify.totalTests, 1);
      assertEquals(verify.failed, 1);
    });

    it("omits the key entirely for a genuine assertion failure", () => {
      const verify = verifyResultFromTestResult({
        ...baseTestResult,
        success: false,
        totalTests: 5,
        passedTests: 3,
        failedTests: 2,
        results: [
          { name: "TestPostsLine", passed: false, duration: 1, error: "boom" },
          { name: "TestOk", passed: true, duration: 1 },
        ],
      });

      // Absent, not `undefined`: exactOptionalPropertyTypes distinguishes the
      // two, and `"key" in obj` is what proves the conditional spread held.
      assertEquals("syntheticNoTestsRan" in verify, false);
      assertEquals(verify.failures, ["TestPostsLine: boom"]);
    });

    it("forwards the flag on the success branch too", () => {
      // No producer emits this combination today. Asserted so the branch
      // cannot drift into dropping the flag if one ever does.
      const verify = verifyResultFromTestResult({
        ...baseTestResult,
        success: true,
        totalTests: 2,
        passedTests: 2,
        failedTests: 0,
        results: [],
        syntheticNoTestsRan: true,
      });
      assertEquals(verify.syntheticNoTestsRan, true);
    });
  });
});
