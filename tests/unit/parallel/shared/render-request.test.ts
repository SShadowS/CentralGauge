import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { renderLLMRequest } from "../../../../src/parallel/shared/render-request.ts";
import type { RenderInputs } from "../../../../src/parallel/shared/prompt-inputs.ts";
import {
  cleanupTempDir,
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
  createMockTaskManifest,
  createTempDir,
} from "../../../utils/test-helpers.ts";

function inputs(starterRoot: string): RenderInputs {
  return {
    provider: "mock",
    apiModelId: "mock-gpt-4",
    variantConfig: null,
    variantSystemPrompt: null,
    promptOverrides: null,
    knowledge: null,
    templateDir: "templates",
    starterRoot,
  };
}

Deno.test("renderLLMRequest attempt 1 reads starter code from inputs.starterRoot, not cwd", async () => {
  const root = await createTempDir("render-root");
  try {
    const starterDir = join(root, "tasks", "starter", "CG-AL-X999");
    await Deno.mkdir(starterDir, { recursive: true });
    await Deno.writeTextFile(
      join(starterDir, "Thing.Codeunit.al"),
      "codeunit 70999 Thing { }",
    );
    const manifest = createMockTaskManifest({
      id: "CG-AL-X999",
      description: "Find and fix the defect.",
      prompt_template: "diagnose.md",
    });
    const context = createMockTaskExecutionContext({
      manifest,
      instructions: manifest.description,
      temperature: 0.2,
      maxTokens: 1234,
    });
    const req = await renderLLMRequest({
      context,
      attemptNumber: 1,
      inputs: inputs(root),
    });
    assert(req.prompt.includes("codeunit 70999 Thing"));
    assert(req.prompt.includes("Find and fix the defect."));
    assertEquals(req.temperature, 0.2);
    assertEquals(req.maxTokens, 1234);
  } finally {
    await cleanupTempDir(root);
  }
});

Deno.test("renderLLMRequest attempt 2 builds the fix prompt from the prior attempt", async () => {
  const manifest = createMockTaskManifest({
    id: "CG-AL-E001",
    description: "Create Ping.",
  });
  const context = createMockTaskExecutionContext({
    manifest,
    instructions: manifest.description,
  });
  const prior = createMockExecutionAttempt({
    attemptNumber: 1,
    success: false,
    extractedCode: "codeunit 70001 Ping { }",
    candidateCode: "codeunit 70001 Ping { /* candidate */ }",
    failureReasons: ["Compilation failed", "  Ping.al:1: AL0118 nope"],
  });
  const req = await renderLLMRequest({
    context,
    attemptNumber: 2,
    prior,
    inputs: inputs(Deno.cwd()),
  });
  assert(
    req.prompt.includes("/* candidate */"),
    "fix prompt uses candidateCode via retrySourceFor",
  );
  assert(req.prompt.includes("AL0118 nope"));
});

Deno.test("renderLLMRequest applies the variant system prompt and knowledge", async () => {
  const manifest = createMockTaskManifest({
    id: "CG-AL-E001",
    description: "Create Ping.",
  });
  const context = createMockTaskExecutionContext({
    manifest,
    instructions: manifest.description,
  });
  const req = await renderLLMRequest({
    context,
    attemptNumber: 1,
    inputs: {
      ...inputs(Deno.cwd()),
      variantSystemPrompt: "VARIANT SYSTEM",
      promptOverrides: { knowledgeContent: "KNOWLEDGE BANK" },
      knowledge: { content: "KNOWLEDGE BANK" },
    },
  });
  assertEquals(req.systemPrompt, "VARIANT SYSTEM");
});
