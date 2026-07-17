/**
 * T11 — a PREREQ app that fails to compile is a task-setup (infra) fault,
 * never a model failure: the model does not author prereq code. The executor
 * must throw ContainerError("setup") so the infra-retry/synthesis path
 * classifies the attempt as infra-invalidated instead of scoring it.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { TaskExecutorV2 } from "../../../src/tasks/executor-v2.ts";
import { ContainerProviderRegistry } from "../../../src/container/registry.ts";
import { ContainerError } from "../../../src/errors.ts";
import {
  createMockTaskExecutionContext,
  createMockTaskManifest,
} from "../../utils/test-helpers.ts";
import { MockContainerProvider } from "../../utils/mock-container-provider.ts";

Deno.test("T11: prereq compile failure throws ContainerError(setup) instead of continuing without the prereq", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "cg-t11-" });
  const providerName = "t11-prereq-fail-mock";

  const mockProvider = new MockContainerProvider();
  mockProvider.setCompilationConfig({
    success: false,
    errors: [{
      file: "ProductCategory.Table.al",
      line: 1,
      column: 1,
      code: "AL0001",
      message: "forced prereq compile failure",
      severity: "error",
    }],
  });
  ContainerProviderRegistry.register(providerName, () => mockProvider);

  try {
    // CG-AL-E002 has a real prereq app at tests/al/dependencies/CG-AL-E002,
    // so findAllPrereqApps discovers it from the repo root cwd.
    const context = createMockTaskExecutionContext({
      manifest: createMockTaskManifest({ id: "CG-AL-E002" }),
      containerProvider: providerName,
      containerName: "TestContainer",
      outputDir: tempDir,
    });

    const executor = new TaskExecutorV2();
    const err = await assertRejects(
      () =>
        executor.compileAndTest(
          context,
          'codeunit 70001 "T11 Candidate" { }',
          1,
        ),
      ContainerError,
    );
    assertEquals(err.operation, "setup");
    assertStringIncludes(err.message, "Prereq compilation failed");
    assertStringIncludes(err.message, "forced prereq compile failure");
  } finally {
    ContainerProviderRegistry.clearInstances();
    await Deno.remove(tempDir, { recursive: true });
  }
});
