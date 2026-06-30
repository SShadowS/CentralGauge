import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  loadTaskTarget,
  loadTestCodeunitId,
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
});
