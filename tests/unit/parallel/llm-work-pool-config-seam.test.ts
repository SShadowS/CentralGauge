/**
 * Seam test: variant config must reach the LLM adapter through the real
 * registry when LLMWorkPool executes a work item.
 *
 * Guards against the data-validity bug where `opus@thinking=50000` /
 * `@prompt=name` variants were silently dropped in getAdapter/buildRequest,
 * labelling bench runs as thinking/prompted while executing plain calls.
 */

import { assertEquals } from "@std/assert";
import type { LLMConfig } from "../../../src/llm/types.ts";
import type { ParallelExecutionConfig } from "../../../src/parallel/types.ts";
import { LLMAdapterRegistry } from "../../../src/llm/registry.ts";
import { MockLLMAdapter } from "../../../src/llm/mock-adapter.ts";
import { LLMWorkPool } from "../../../src/parallel/llm-work-pool.ts";
import { ProviderRateLimiter } from "../../../src/parallel/rate-limiter.ts";
import {
  createMockLLMWorkItem,
  createMockTaskExecutionContext,
} from "../../utils/test-helpers.ts";

function createSeamConfig(): ParallelExecutionConfig {
  return {
    maxGlobalConcurrency: 1,
    providerConcurrency: new Map([
      ["seamtest", { concurrent: 2, rpm: 1000, tpm: 1000000 }],
    ]),
    compileQueueSize: 100,
    resultBufferSize: 50,
    streamResults: false,
    compileQueueTimeout: 300000,
    taskConcurrency: 1,
    templateDir: "templates",
  };
}

function createSeamRateLimiter(): ProviderRateLimiter {
  return new ProviderRateLimiter(
    new Map([["seamtest", { concurrent: 100, rpm: 1000, tpm: 1000000 }]]),
  );
}

Deno.test({
  name: "LLMWorkPool adapter-config seam",
  sanitizeOps: false,
  sanitizeResources: false,
}, async (t) => {
  const configs: LLMConfig[] = [];
  const requests: { systemPrompt?: string | undefined }[] = [];
  LLMAdapterRegistry.register("seamtest", () => {
    const a = new MockLLMAdapter();
    const origConfigure = a.configure.bind(a);
    a.configure = (c: LLMConfig) => {
      configs.push(structuredClone(c));
      origConfigure(c);
    };
    const origGen = a.generateCode.bind(a);
    a.generateCode = (req, ctx) => {
      requests.push({ systemPrompt: req.systemPrompt });
      return origGen(req, ctx);
    };
    return a;
  });

  await t.step("thinkingBudget + timeout reach adapter.configure", async () => {
    const item = createMockLLMWorkItem({
      llmProvider: "seamtest",
      context: createMockTaskExecutionContext({
        variantConfig: { thinkingBudget: 50000, timeout: 120000 },
      }),
    });
    const pool = new LLMWorkPool(createSeamConfig(), createSeamRateLimiter());
    await pool.submit(item);
    const last = configs.at(-1)!;
    assertEquals(last.thinkingBudget, 50000);
    assertEquals(last.timeout, 120000);
  });

  await t.step("variant systemPrompt reaches LLMRequest", async () => {
    const item = createMockLLMWorkItem({
      llmProvider: "seamtest",
      context: createMockTaskExecutionContext({
        variantConfig: { systemPrompt: "You are a terse AL expert." },
      }),
    });
    const pool = new LLMWorkPool(createSeamConfig(), createSeamRateLimiter());
    await pool.submit(item);
    assertEquals(requests.at(-1)!.systemPrompt, "You are a terse AL expert.");
  });
});
