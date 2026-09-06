import { assert, assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import type { ParallelExecutionConfig } from "../../../src/parallel/types.ts";
import { LLMWorkPool } from "../../../src/parallel/llm-work-pool.ts";
import { ProviderRateLimiter } from "../../../src/parallel/rate-limiter.ts";
import {
  createMockLLMWorkItem,
  createMockTaskExecutionContext,
  createMockTaskManifest,
} from "../../utils/test-helpers.ts";

function pool(): LLMWorkPool {
  const limits = new Map([["mock", {
    concurrent: 2,
    rpm: 1000,
    tpm: 1_000_000,
  }]]);
  const config: ParallelExecutionConfig = {
    maxGlobalConcurrency: 2,
    providerConcurrency: limits,
    compileQueueSize: 10,
    resultBufferSize: 10,
    streamResults: false,
    compileQueueTimeout: 10_000,
    taskConcurrency: 1,
    templateDir: "templates",
  };
  return new LLMWorkPool(config, new ProviderRateLimiter(limits));
}

function item(model: string) {
  const manifest = createMockTaskManifest({
    id: "CG-AL-E001",
    description: "Create a codeunit named Ping.",
  });
  return createMockLLMWorkItem({
    llmProvider: "mock",
    llmModel: model,
    taskManifest: manifest,
    context: createMockTaskExecutionContext({
      instructions: manifest.description,
    }),
  });
}

describe({
  name: "LLMWorkResult.request",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it("carries the rendered request on a successful result", async () => {
    const work = item("mock-gpt-4");
    const result = await pool().submit(work);
    assertExists(result.request, "request must be captured");
    assert(result.request.prompt.includes("Create a codeunit named Ping."));
    assertEquals(result.request.maxTokens, work.context.maxTokens);
  });

  it("carries the rendered request when the adapter throws", async () => {
    const result = await pool().submit(item("mock-throws"));
    assertEquals(result.success, false);
    assertExists(result.request, "request must be captured on failure too");
    assert(result.request.prompt.includes("Create a codeunit named Ping."));
  });
});
