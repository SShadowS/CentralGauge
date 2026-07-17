/**
 * Unit tests for Azure OpenAI, Local LLM, and OpenRouter adapters
 *
 * These tests verify the adapters' behavior without making actual API calls:
 * 1. Public properties (name)
 * 2. Configuration validation (validateConfig)
 * 3. Cost estimation (estimateCost)
 * 4. Interface compliance (LLMAdapter)
 */

import { assertEquals } from "@std/assert";
import { AzureOpenAIAdapter } from "../../../src/llm/azure-openai-adapter.ts";
import { LocalLLMAdapter } from "../../../src/llm/local-adapter.ts";
import { OpenRouterAdapter } from "../../../src/llm/openrouter-adapter.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";

// =============================================================================
// Azure OpenAI Adapter Tests
// =============================================================================

Deno.test("AzureOpenAIAdapter - Provider Properties", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step('name property returns "azure-openai"', () => {
    const adapter = new AzureOpenAIAdapter();
    assertEquals(adapter.name, "azure-openai");
  });
});

Deno.test("AzureOpenAIAdapter - implements LLMAdapter interface", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("has all required methods", () => {
    const adapter = new AzureOpenAIAdapter();

    assertEquals(typeof adapter.configure, "function");
    assertEquals(typeof adapter.generateCode, "function");
    assertEquals(typeof adapter.generateFix, "function");
    assertEquals(typeof adapter.validateConfig, "function");
    assertEquals(typeof adapter.estimateCost, "function");
    assertEquals(typeof adapter.isHealthy, "function");
  });
});

Deno.test("AzureOpenAIAdapter - validateConfig", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("returns error when API key is missing", () => {
    const adapter = new AzureOpenAIAdapter();
    const errors = adapter.validateConfig({
      provider: "azure-openai",
      model: "gpt-4o",
      baseUrl: "https://test.openai.azure.com",
    });

    assertEquals(
      errors.some((e) => e.includes("API key")),
      true,
    );
  });

  await t.step("returns error when endpoint and baseUrl are missing", () => {
    const adapter = new AzureOpenAIAdapter();
    // Clear environment variable for this test
    const originalEnv = Deno.env.get("AZURE_OPENAI_ENDPOINT");
    try {
      Deno.env.delete("AZURE_OPENAI_ENDPOINT");
      const errors = adapter.validateConfig({
        provider: "azure-openai",
        apiKey: "test-key",
        model: "gpt-4o",
      });

      assertEquals(
        errors.some((e) => e.includes("endpoint")),
        true,
      );
    } finally {
      if (originalEnv) {
        Deno.env.set("AZURE_OPENAI_ENDPOINT", originalEnv);
      }
    }
  });

  await t.step(
    "returns error when deployment name and model are missing",
    () => {
      const adapter = new AzureOpenAIAdapter();
      const errors = adapter.validateConfig({
        provider: "azure-openai",
        apiKey: "test-key",
        baseUrl: "https://test.openai.azure.com",
        model: "",
      });

      assertEquals(
        errors.some((e) => e.includes("Deployment")),
        true,
      );
    },
  );

  await t.step("validates temperature range", () => {
    const adapter = new AzureOpenAIAdapter();

    const errors = adapter.validateConfig({
      provider: "azure-openai",
      apiKey: "test-key",
      baseUrl: "https://test.openai.azure.com",
      model: "gpt-4o",
      temperature: 2.5,
    });
    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      true,
    );
  });
});

Deno.test("AzureOpenAIAdapter - estimateCost", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("calculates cost for gpt-4o model", () => {
    const adapter = new AzureOpenAIAdapter();
    adapter.configure({
      provider: "azure-openai",
      model: "gpt-4o",
      apiKey: "test-key",
      baseUrl: "https://test.openai.azure.com",
    });

    // GPT-4o pricing: $0.0025/1K input, $0.01/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 0.0025 + 0.01 = 0.0125
    assertEquals(Math.abs(cost - 0.0125) < 0.001, true);
  });

  await t.step("handles zero tokens", () => {
    const adapter = new AzureOpenAIAdapter();
    adapter.configure({
      provider: "azure-openai",
      model: "gpt-4o",
      apiKey: "test-key",
      baseUrl: "https://test.openai.azure.com",
    });

    const cost = adapter.estimateCost(0, 0);
    assertEquals(cost, 0);
  });
});

Deno.test("AzureOpenAIAdapter - streaming interface", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("supportsStreaming property is true", () => {
    const adapter = new AzureOpenAIAdapter();
    assertEquals(adapter.supportsStreaming, true);
  });

  await t.step("has generateCodeStream method", () => {
    const adapter = new AzureOpenAIAdapter();
    assertEquals(typeof adapter.generateCodeStream, "function");
  });

  await t.step("has generateFixStream method", () => {
    const adapter = new AzureOpenAIAdapter();
    assertEquals(typeof adapter.generateFixStream, "function");
  });
});

Deno.test("AzureOpenAIAdapter - isHealthy", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("returns false when API call fails", async () => {
    const adapter = new AzureOpenAIAdapter();
    adapter.configure({
      provider: "azure-openai",
      model: "gpt-4o",
      apiKey: "invalid-api-key",
      baseUrl: "https://test.openai.azure.com",
    });

    const healthy = await adapter.isHealthy();
    assertEquals(healthy, false);
  });
});

Deno.test("AzureOpenAIAdapter - configure", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("accepts configuration without throwing", () => {
    const adapter = new AzureOpenAIAdapter();
    adapter.configure({
      provider: "azure-openai",
      model: "gpt-4o",
      apiKey: "test-key",
      baseUrl: "https://test.openai.azure.com",
      deploymentName: "my-deployment",
      apiVersion: "2024-02-15-preview",
    });
  });

  await t.step("multiple instances are independent", () => {
    const adapter1 = new AzureOpenAIAdapter();
    const adapter2 = new AzureOpenAIAdapter();

    adapter1.configure({
      provider: "azure-openai",
      model: "gpt-4o",
      apiKey: "key1",
      baseUrl: "https://test1.openai.azure.com",
    });

    adapter2.configure({
      provider: "azure-openai",
      model: "gpt-4o-mini",
      apiKey: "key2",
      baseUrl: "https://test2.openai.azure.com",
    });

    // Different cost calculations prove independence
    const cost1 = adapter1.estimateCost(1000, 1000);
    const cost2 = adapter2.estimateCost(1000, 1000);

    assertEquals(cost1 !== cost2, true);
  });
});

// =============================================================================
// Local LLM Adapter Tests
// =============================================================================

Deno.test("LocalLLMAdapter - Provider Properties", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step('name property returns "local"', () => {
    const adapter = new LocalLLMAdapter();
    assertEquals(adapter.name, "local");
  });
});

Deno.test("LocalLLMAdapter - implements LLMAdapter interface", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("has all required methods", () => {
    const adapter = new LocalLLMAdapter();

    assertEquals(typeof adapter.configure, "function");
    assertEquals(typeof adapter.generateCode, "function");
    assertEquals(typeof adapter.generateFix, "function");
    assertEquals(typeof adapter.validateConfig, "function");
    assertEquals(typeof adapter.estimateCost, "function");
    assertEquals(typeof adapter.isHealthy, "function");
  });
});

Deno.test("LocalLLMAdapter - validateConfig", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("returns no error when no API key (local model)", () => {
    const adapter = new LocalLLMAdapter();
    const errors = adapter.validateConfig({
      provider: "local",
      model: "codellama:latest",
    });

    // Local models don't require API key
    assertEquals(
      errors.some((e) => e.toLowerCase().includes("api key")),
      false,
    );
  });

  await t.step("returns error when model is missing", () => {
    const adapter = new LocalLLMAdapter();
    const errors = adapter.validateConfig({
      provider: "local",
      model: "",
    });

    assertEquals(
      errors.some((e) => e.includes("Model")),
      true,
    );
  });

  await t.step(
    "returns error when endpoint is missing and no env vars set",
    () => {
      const adapter = new LocalLLMAdapter();
      // Clear environment variables for this test
      const originalHost = Deno.env.get("OLLAMA_HOST");
      const originalEndpoint = Deno.env.get("LOCAL_LLM_ENDPOINT");
      try {
        Deno.env.delete("OLLAMA_HOST");
        Deno.env.delete("LOCAL_LLM_ENDPOINT");

        const errors = adapter.validateConfig({
          provider: "local",
          model: "codellama:latest",
          // No baseUrl provided
        });

        assertEquals(
          errors.some((e) => e.includes("endpoint")),
          true,
        );
      } finally {
        if (originalHost) Deno.env.set("OLLAMA_HOST", originalHost);
        if (originalEndpoint) {
          Deno.env.set(
            "LOCAL_LLM_ENDPOINT",
            originalEndpoint,
          );
        }
      }
    },
  );

  await t.step("returns no error when baseUrl is provided", () => {
    const adapter = new LocalLLMAdapter();
    const originalHost = Deno.env.get("OLLAMA_HOST");
    const originalEndpoint = Deno.env.get("LOCAL_LLM_ENDPOINT");
    try {
      Deno.env.delete("OLLAMA_HOST");
      Deno.env.delete("LOCAL_LLM_ENDPOINT");

      const errors = adapter.validateConfig({
        provider: "local",
        model: "codellama:latest",
        baseUrl: "http://localhost:11434",
      });

      assertEquals(
        errors.some((e) => e.includes("endpoint")),
        false,
      );
    } finally {
      if (originalHost) Deno.env.set("OLLAMA_HOST", originalHost);
      if (originalEndpoint) {
        Deno.env.set("LOCAL_LLM_ENDPOINT", originalEndpoint);
      }
    }
  });

  await t.step("returns no error when OLLAMA_HOST env var is set", () => {
    const adapter = new LocalLLMAdapter();
    const originalHost = Deno.env.get("OLLAMA_HOST");
    const originalEndpoint = Deno.env.get("LOCAL_LLM_ENDPOINT");
    try {
      Deno.env.set("OLLAMA_HOST", "http://localhost:11434");
      Deno.env.delete("LOCAL_LLM_ENDPOINT");

      const errors = adapter.validateConfig({
        provider: "local",
        model: "codellama:latest",
      });

      assertEquals(
        errors.some((e) => e.includes("endpoint")),
        false,
      );
    } finally {
      if (originalHost) {
        Deno.env.set("OLLAMA_HOST", originalHost);
      } else {
        Deno.env.delete("OLLAMA_HOST");
      }
      if (originalEndpoint) {
        Deno.env.set("LOCAL_LLM_ENDPOINT", originalEndpoint);
      }
    }
  });

  await t.step(
    "returns no error when LOCAL_LLM_ENDPOINT env var is set",
    () => {
      const adapter = new LocalLLMAdapter();
      const originalHost = Deno.env.get("OLLAMA_HOST");
      const originalEndpoint = Deno.env.get("LOCAL_LLM_ENDPOINT");
      try {
        Deno.env.delete("OLLAMA_HOST");
        Deno.env.set("LOCAL_LLM_ENDPOINT", "http://localhost:8080");

        const errors = adapter.validateConfig({
          provider: "local",
          model: "codellama:latest",
        });

        assertEquals(
          errors.some((e) => e.includes("endpoint")),
          false,
        );
      } finally {
        if (originalHost) Deno.env.set("OLLAMA_HOST", originalHost);
        if (originalEndpoint) {
          Deno.env.set("LOCAL_LLM_ENDPOINT", originalEndpoint);
        } else {
          Deno.env.delete("LOCAL_LLM_ENDPOINT");
        }
      }
    },
  );

  await t.step("validates temperature range - too high", () => {
    const adapter = new LocalLLMAdapter();
    const errors = adapter.validateConfig({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
      temperature: 2.5,
    });

    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      true,
    );
  });

  await t.step("validates temperature range - negative", () => {
    const adapter = new LocalLLMAdapter();
    const errors = adapter.validateConfig({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
      temperature: -0.5,
    });

    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      true,
    );
  });

  await t.step("accepts valid temperature at boundary (0)", () => {
    const adapter = new LocalLLMAdapter();
    const errors = adapter.validateConfig({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
      temperature: 0,
    });

    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      false,
    );
  });

  await t.step("accepts valid temperature at boundary (2)", () => {
    const adapter = new LocalLLMAdapter();
    const errors = adapter.validateConfig({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
      temperature: 2,
    });

    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      false,
    );
  });

  await t.step("validates maxTokens - must be positive", () => {
    const adapter = new LocalLLMAdapter();
    const errors = adapter.validateConfig({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
      maxTokens: 0,
    });

    assertEquals(
      errors.some((e) => e.includes("Max tokens")),
      true,
    );
  });

  await t.step("validates maxTokens - negative value", () => {
    const adapter = new LocalLLMAdapter();
    const errors = adapter.validateConfig({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
      maxTokens: -100,
    });

    assertEquals(
      errors.some((e) => e.includes("Max tokens")),
      true,
    );
  });

  await t.step("accepts valid maxTokens", () => {
    const adapter = new LocalLLMAdapter();
    const errors = adapter.validateConfig({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
      maxTokens: 4000,
    });

    assertEquals(
      errors.some((e) => e.includes("Max tokens")),
      false,
    );
  });

  await t.step("returns no errors for fully valid config", () => {
    const adapter = new LocalLLMAdapter();
    const errors = adapter.validateConfig({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
      temperature: 0.7,
      maxTokens: 2000,
    });

    assertEquals(errors.length, 0);
  });
});

Deno.test("LocalLLMAdapter - estimateCost", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("returns zero cost for local models", () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
    });

    // Local models have no API cost
    const cost = adapter.estimateCost(1000, 1000);
    assertEquals(cost, 0);
  });
});

Deno.test("LocalLLMAdapter - configure", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("accepts configuration without throwing", () => {
    const adapter = new LocalLLMAdapter();

    adapter.configure({
      provider: "local",
      model: "llama3:latest",
      temperature: 0.7,
      maxTokens: 2000,
    });
  });

  await t.step("merges config with defaults", () => {
    const adapter = new LocalLLMAdapter();

    // First configure with model
    adapter.configure({
      provider: "local",
      model: "llama3:latest",
    });

    // Validate that it works - no errors expected
    const errors = adapter.validateConfig({
      provider: "local",
      model: "llama3:latest",
      baseUrl: "http://localhost:11434",
    });
    assertEquals(errors.length, 0);
  });
});

// Helper function to create mock fetch for Ollama responses
function createOllamaFetchMock(
  responseContent: string,
  usage?: { prompt_eval_count?: number; eval_count?: number },
) {
  return (
    input: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    if (url.includes("/api/generate")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            response: responseContent,
            prompt_eval_count: usage?.prompt_eval_count || 10,
            eval_count: usage?.eval_count || 20,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  };
}

// Helper function to create mock fetch for OpenAI-compatible responses
function createOpenAICompatibleFetchMock(responseContent: string) {
  return (
    input: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    if (url.includes("/v1/chat/completions")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: responseContent },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 25,
              total_tokens: 40,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  };
}

// Helper function to create error mock fetch
function createErrorFetchMock(statusCode: number, errorMessage: string) {
  return (
    _input: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    return Promise.resolve(
      new Response(errorMessage, {
        status: statusCode,
        headers: { "Content-Type": "text/plain" },
      }),
    );
  };
}

Deno.test("LocalLLMAdapter - isHealthy with mocked fetch", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("returns true when Ollama endpoint responds", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = createOllamaFetchMock("OK") as typeof fetch;
      const healthy = await adapter.isHealthy();
      assertEquals(healthy, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step(
    "returns true when OpenAI-compatible endpoint responds",
    async () => {
      const adapter = new LocalLLMAdapter();
      adapter.configure({
        provider: "local",
        model: "codellama:latest",
        baseUrl: "http://localhost:8080", // Non-Ollama port
      });

      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = createOpenAICompatibleFetchMock(
          "OK",
        ) as typeof fetch;
        const healthy = await adapter.isHealthy();
        assertEquals(healthy, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );

  await t.step("returns false when endpoint returns error", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = createErrorFetchMock(
        500,
        "Internal Server Error",
      ) as typeof fetch;
      const healthy = await adapter.isHealthy();
      assertEquals(healthy, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("returns false when fetch throws", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = () => Promise.reject(new Error("Connection refused"));
      const healthy = await adapter.isHealthy();
      assertEquals(healthy, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("LocalLLMAdapter - generateCode with mocked fetch", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("generates code from Ollama response", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    const codeResponse =
      "```al\ncodeunit 50100 \"Test Codeunit\"\n{\n    procedure Hello(): Text\n    begin\n        exit('Hello World');\n    end;\n}\n```";

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = createOllamaFetchMock(codeResponse) as typeof fetch;

      const result = await adapter.generateCode(
        { prompt: "Generate a hello world codeunit" },
        { taskId: "test-task", attempt: 1, description: "Test task" },
      );

      assertEquals(result.language, "al");
      assertEquals(result.code.includes("codeunit 50100"), true);
      assertEquals(result.extractedFromDelimiters, true);
      assertEquals(result.response.model, "codellama:latest");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("generates code from OpenAI-compatible response", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:8080", // Non-Ollama port
    });

    const codeResponse =
      '```al\ntable 50100 "Test Table"\n{\n    fields\n    {\n        field(1; "Code"; Code[20]) { }\n    }\n}\n```';

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = createOpenAICompatibleFetchMock(
        codeResponse,
      ) as typeof fetch;

      const result = await adapter.generateCode(
        { prompt: "Generate a test table" },
        { taskId: "test-task-2", attempt: 1, description: "Test task" },
      );

      assertEquals(result.language, "al");
      assertEquals(result.code.includes("table 50100"), true);
      assertEquals(result.response.usage.promptTokens, 15);
      assertEquals(result.response.usage.completionTokens, 25);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("throws error when API returns error status", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = createErrorFetchMock(
        500,
        "Model not found",
      ) as typeof fetch;

      let errorThrown = false;
      try {
        await adapter.generateCode(
          { prompt: "Generate code" },
          { taskId: "test-task", attempt: 1, description: "Test task" },
        );
      } catch (error) {
        errorThrown = true;
        assertEquals(error instanceof Error, true);
        assertEquals((error as Error).message.includes("500"), true);
      }
      assertEquals(errorThrown, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("handles response without code delimiters", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    // Response without code fences
    const plainResponse =
      "codeunit 50100 \"Plain Codeunit\"\n{\n    procedure Test(): Text\n    begin\n        exit('Test');\n    end;\n}";

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = createOllamaFetchMock(plainResponse) as typeof fetch;

      const result = await adapter.generateCode(
        { prompt: "Generate code" },
        { taskId: "test-task", attempt: 1, description: "Test task" },
      );

      // Should still extract the code
      assertEquals(result.code.includes("codeunit 50100"), true);
      assertEquals(result.extractedFromDelimiters, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("includes system prompt in Ollama request", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    let capturedBody: Record<string, unknown> | null = null;
    const mockFetch = (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      if (url.includes("/api/generate") && init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            response: "```al\ncodeunit 1 Test { }\n```",
            prompt_eval_count: 10,
            eval_count: 5,
          }),
          { status: 200 },
        ),
      );
    };

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = mockFetch as typeof fetch;

      await adapter.generateCode(
        {
          prompt: "Generate code",
          systemPrompt: "You are an AL expert",
        },
        { taskId: "test-task", attempt: 1, description: "Test task" },
      );

      assertEquals(capturedBody !== null, true);
      assertEquals(capturedBody!["system"], "You are an AL expert");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("LocalLLMAdapter - generateFix with mocked fetch", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("generates fix from Ollama response", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    const fixResponse = "```diff\n- exit('old');\n+ exit('new');\n```";

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = createOllamaFetchMock(fixResponse) as typeof fetch;

      const result = await adapter.generateFix(
        "original code",
        ["Error: undefined variable"],
        { prompt: "Fix the error" },
        { taskId: "fix-task", attempt: 2, description: "Fix task" },
      );

      assertEquals(result.language, "diff");
      assertEquals(result.code.includes("exit"), true);
      assertEquals(result.extractedFromDelimiters, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("handles AL code response for fix", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    // Fix response that contains AL code instead of diff
    const alFixResponse =
      "```al\ncodeunit 50100 \"Fixed Codeunit\"\n{\n    procedure Fixed(): Text\n    begin\n        exit('Fixed');\n    end;\n}\n```";

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = createOllamaFetchMock(alFixResponse) as typeof fetch;

      const result = await adapter.generateFix(
        "original code",
        ["Compilation error"],
        { prompt: "Fix the error" },
        { taskId: "fix-task", attempt: 2, description: "Fix task" },
      );

      assertEquals(result.language, "al");
      assertEquals(result.code.includes("Fixed Codeunit"), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("throws error when API fails during fix", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = createErrorFetchMock(
        503,
        "Service unavailable",
      ) as typeof fetch;

      let errorThrown = false;
      try {
        await adapter.generateFix(
          "code",
          ["error"],
          { prompt: "Fix" },
          { taskId: "test", attempt: 2, description: "Test" },
        );
      } catch (error) {
        errorThrown = true;
        assertEquals(error instanceof Error, true);
        assertEquals((error as Error).message.includes("503"), true);
      }
      assertEquals(errorThrown, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("LocalLLMAdapter - callLocalLLM endpoint detection", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("detects Ollama by port 11434", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    let calledUrl = "";
    const mockFetch = (
      input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      calledUrl = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            response: "OK",
            prompt_eval_count: 1,
            eval_count: 1,
          }),
          { status: 200 },
        ),
      );
    };

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = mockFetch as typeof fetch;
      await adapter.isHealthy();
      assertEquals(calledUrl.includes("/api/generate"), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("detects Ollama by 'ollama' in URL", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://ollama.local:8080",
    });

    let calledUrl = "";
    const mockFetch = (
      input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      calledUrl = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            response: "OK",
            prompt_eval_count: 1,
            eval_count: 1,
          }),
          { status: 200 },
        ),
      );
    };

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = mockFetch as typeof fetch;
      await adapter.isHealthy();
      assertEquals(calledUrl.includes("/api/generate"), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step(
    "uses OpenAI-compatible API for non-Ollama endpoints",
    async () => {
      const adapter = new LocalLLMAdapter();
      adapter.configure({
        provider: "local",
        model: "codellama:latest",
        baseUrl: "http://localhost:8080",
      });

      let calledUrl = "";
      const mockFetch = (
        input: string | URL | Request,
        _init?: RequestInit,
      ): Promise<Response> => {
        calledUrl = typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : input.url;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "OK" } }],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
            { status: 200 },
          ),
        );
      };

      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = mockFetch as typeof fetch;
        await adapter.isHealthy();
        assertEquals(calledUrl.includes("/v1/chat/completions"), true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );

  await t.step(
    "adds Authorization header when apiKey is provided for OpenAI-compatible",
    async () => {
      const adapter = new LocalLLMAdapter();
      adapter.configure({
        provider: "local",
        model: "codellama:latest",
        baseUrl: "http://localhost:8080",
        apiKey: "test-api-key",
      });

      let capturedHeaders: Record<string, string> = {};
      const mockFetch = (
        _input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        if (init?.headers) {
          capturedHeaders = init.headers as Record<string, string>;
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "OK" } }],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
            { status: 200 },
          ),
        );
      };

      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = mockFetch as typeof fetch;
        await adapter.isHealthy();
        assertEquals(capturedHeaders["Authorization"], "Bearer test-api-key");
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );

  await t.step("uses default endpoint when no config provided", async () => {
    const adapter = new LocalLLMAdapter();
    // Don't configure baseUrl - should default to localhost:11434

    let calledUrl = "";
    const mockFetch = (
      input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      calledUrl = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            response: "OK",
            prompt_eval_count: 1,
            eval_count: 1,
          }),
          { status: 200 },
        ),
      );
    };

    const originalFetch = globalThis.fetch;
    const originalHost = Deno.env.get("OLLAMA_HOST");
    const originalEndpoint = Deno.env.get("LOCAL_LLM_ENDPOINT");
    try {
      Deno.env.delete("OLLAMA_HOST");
      Deno.env.delete("LOCAL_LLM_ENDPOINT");
      globalThis.fetch = mockFetch as typeof fetch;
      await adapter.isHealthy();
      assertEquals(calledUrl.includes("localhost:11434"), true);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalHost) Deno.env.set("OLLAMA_HOST", originalHost);
      if (originalEndpoint) {
        Deno.env.set("LOCAL_LLM_ENDPOINT", originalEndpoint);
      }
    }
  });

  await t.step("prefers LOCAL_LLM_ENDPOINT over default", async () => {
    const adapter = new LocalLLMAdapter();

    let calledUrl = "";
    const mockFetch = (
      input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      calledUrl = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200 },
        ),
      );
    };

    const originalFetch = globalThis.fetch;
    const originalHost = Deno.env.get("OLLAMA_HOST");
    const originalEndpoint = Deno.env.get("LOCAL_LLM_ENDPOINT");
    try {
      Deno.env.delete("OLLAMA_HOST");
      Deno.env.set("LOCAL_LLM_ENDPOINT", "http://custom-llm:9000");
      globalThis.fetch = mockFetch as typeof fetch;
      await adapter.isHealthy();
      assertEquals(calledUrl.includes("custom-llm:9000"), true);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalHost) Deno.env.set("OLLAMA_HOST", originalHost);
      if (originalEndpoint) {
        Deno.env.set("LOCAL_LLM_ENDPOINT", originalEndpoint);
      } else {
        Deno.env.delete("LOCAL_LLM_ENDPOINT");
      }
    }
  });
});

Deno.test("LocalLLMAdapter - response parsing", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("parses Ollama usage stats correctly", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = createOllamaFetchMock("test response", {
        prompt_eval_count: 100,
        eval_count: 200,
      }) as typeof fetch;

      const result = await adapter.generateCode(
        { prompt: "test" },
        { taskId: "test", attempt: 1, description: "Test" },
      );

      assertEquals(result.response.usage.promptTokens, 100);
      assertEquals(result.response.usage.completionTokens, 200);
      assertEquals(result.response.usage.totalTokens, 300);
      assertEquals(result.response.usage.estimatedCost, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("handles missing usage stats in Ollama response", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    const mockFetch = (
      _input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            response: "test response",
            // No usage stats
          }),
          { status: 200 },
        ),
      );
    };

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = mockFetch as typeof fetch;

      const result = await adapter.generateCode(
        { prompt: "test" },
        { taskId: "test", attempt: 1, description: "Test" },
      );

      assertEquals(result.response.usage.promptTokens, 0);
      assertEquals(result.response.usage.completionTokens, 0);
      assertEquals(result.response.usage.totalTokens, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("handles text field in OpenAI-compatible response", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:8080",
    });

    const mockFetch = (
      _input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                text: "completion text", // Some APIs use 'text' instead of 'message.content'
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          }),
          { status: 200 },
        ),
      );
    };

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = mockFetch as typeof fetch;

      const result = await adapter.generateCode(
        { prompt: "test" },
        { taskId: "test", attempt: 1, description: "Test" },
      );

      assertEquals(result.code.includes("completion text"), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("tracks response duration", async () => {
    const adapter = new LocalLLMAdapter();
    adapter.configure({
      provider: "local",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434",
    });

    const originalFetch = globalThis.fetch;
    try {
      // Add a small delay to ensure measurable duration
      globalThis.fetch = async (
        _input: string | URL | Request,
        _init?: RequestInit,
      ): Promise<Response> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(
          JSON.stringify({
            response: "test",
            prompt_eval_count: 1,
            eval_count: 1,
          }),
          { status: 200 },
        );
      };

      const result = await adapter.generateCode(
        { prompt: "test" },
        { taskId: "test", attempt: 1, description: "Test" },
      );

      assertEquals(result.response.duration >= 10, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// =============================================================================
// OpenRouter Adapter Tests
// =============================================================================

Deno.test("OpenRouterAdapter - Provider Properties", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step('name property returns "openrouter"', () => {
    const adapter = new OpenRouterAdapter();
    assertEquals(adapter.name, "openrouter");
  });
});

Deno.test("OpenRouterAdapter - implements LLMAdapter interface", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("has all required methods", () => {
    const adapter = new OpenRouterAdapter();

    assertEquals(typeof adapter.configure, "function");
    assertEquals(typeof adapter.generateCode, "function");
    assertEquals(typeof adapter.generateFix, "function");
    assertEquals(typeof adapter.validateConfig, "function");
    assertEquals(typeof adapter.estimateCost, "function");
    assertEquals(typeof adapter.isHealthy, "function");
  });
});

Deno.test("OpenRouterAdapter - validateConfig", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("returns error when API key is missing", () => {
    const adapter = new OpenRouterAdapter();
    const errors = adapter.validateConfig({
      provider: "openrouter",
      model: "openai/gpt-4o",
    });

    assertEquals(
      errors.some((e) => e.includes("API key")),
      true,
    );
  });

  await t.step("returns error when model is missing", () => {
    const adapter = new OpenRouterAdapter();
    const errors = adapter.validateConfig({
      provider: "openrouter",
      apiKey: "test-key",
      model: "",
    });

    assertEquals(
      errors.some((e) => e.includes("Model")),
      true,
    );
  });

  await t.step("returns no errors for valid config", () => {
    const adapter = new OpenRouterAdapter();
    const errors = adapter.validateConfig({
      provider: "openrouter",
      apiKey: "test-key",
      model: "openai/gpt-4o",
    });

    assertEquals(errors.length, 0);
  });
});

Deno.test("OpenRouterAdapter - estimateCost", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("calculates cost for openai/gpt-4o model", () => {
    const adapter = new OpenRouterAdapter();
    adapter.configure({
      provider: "openrouter",
      model: "openai/gpt-4o",
      apiKey: "test-key",
    });

    const cost = adapter.estimateCost(1000, 1000);
    // Should return positive cost
    assertEquals(cost > 0, true);
  });

  await t.step("handles zero tokens", () => {
    const adapter = new OpenRouterAdapter();
    adapter.configure({
      provider: "openrouter",
      model: "openai/gpt-4o",
      apiKey: "test-key",
    });

    const cost = adapter.estimateCost(0, 0);
    assertEquals(cost, 0);
  });
});

Deno.test("OpenRouterAdapter - configure", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("accepts configuration without throwing", () => {
    const adapter = new OpenRouterAdapter();

    adapter.configure({
      provider: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      apiKey: "test-key",
      temperature: 0.5,
      maxTokens: 2000,
    });
  });

  await t.step("multiple instances are independent", () => {
    const adapter1 = new OpenRouterAdapter();
    const adapter2 = new OpenRouterAdapter();

    adapter1.configure({
      provider: "openrouter",
      model: "openai/gpt-4o",
      apiKey: "key1",
    });

    adapter2.configure({
      provider: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      apiKey: "key2",
    });

    assertEquals(adapter1.name, adapter2.name);
    assertEquals(adapter1 !== adapter2, true);
  });
});
