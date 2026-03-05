# API Reference

This section documents the CentralGauge TypeScript API for developers who want to extend or integrate with the system.

## Module Organization

CentralGauge is organized into these main modules:

```
src/
├── llm/           # LLM adapters and registry
├── container/     # Container providers
├── tasks/         # Task execution
├── parallel/      # Parallel orchestration
├── agents/        # Agent system
├── config/        # Configuration
├── prompts/       # Prompt templates
├── stats/         # Statistics and storage
├── verify/        # Failure analysis
├── rules/         # Rules generation from shortcomings
└── utils/         # Utilities
```

## Core Modules

### LLM Module (`src/llm/`)

LLM adapter interfaces and implementations.

**Exports:**

- `LLMAdapterRegistry` - Adapter management
- `LLMAdapter` - Adapter interface
- `LLMConfig`, `LLMRequest`, `LLMResponse` - Types
- Provider adapters: `AnthropicAdapter`, `OpenAIAdapter`, etc.

```typescript
import { LLMAdapterRegistry } from "./src/llm/registry.ts";
import type { LLMConfig, LLMResponse } from "./src/llm/types.ts";
```

### Container Module (`src/container/`)

Container provider interfaces and implementations.

**Exports:**

- `ContainerProviderRegistry` - Provider management
- `ContainerProvider` - Provider interface
- `CompilationResult`, `TestResult` - Types

```typescript
import { ContainerProviderRegistry } from "./src/container/registry.ts";
import type { CompilationResult, TestResult } from "./src/container/types.ts";
```

### Tasks Module (`src/tasks/`)

Task loading and execution.

**Exports:**

- `loadTaskManifest` - Load YAML manifests
- `TaskExecutorV2` - Execute tasks
- `TaskTransformer` - Transform manifests to contexts

```typescript
import { loadTaskManifest } from "./src/tasks/loader.ts";
import { TaskExecutorV2 } from "./src/tasks/executor-v2.ts";
import type {
  TaskExecutionResult,
  TaskManifest,
} from "./src/tasks/interfaces.ts";
```

### Parallel Module (`src/parallel/`)

Parallel benchmark orchestration.

**Exports:**

- `ParallelBenchmarkOrchestrator` - Orchestrate parallel runs
- `createDefaultConfig` - Default configuration
- Event types for progress tracking

```typescript
import {
  createDefaultConfig,
  ParallelBenchmarkOrchestrator,
} from "./src/parallel/mod.ts";
import type { ParallelExecutionEvent } from "./src/parallel/mod.ts";
```

### Agents Module (`src/agents/`)

Agent configuration and execution.

**Exports:**

- `AgentRegistry` - Agent management
- `AgentTaskExecutor` - Execute agents
- Agent types

```typescript
import { AgentRegistry } from "./src/agents/registry.ts";
import { AgentTaskExecutor } from "./src/agents/executor.ts";
import type { AgentConfig, AgentExecutionResult } from "./src/agents/types.ts";
```

### Config Module (`src/config/`)

Configuration management.

**Exports:**

- `ConfigManager` - Load and merge configuration

```typescript
import { ConfigManager } from "./src/config/config.ts";
import type { CentralGaugeConfig } from "./src/config/config.ts";
```

### Rules Module (`src/rules/`)

Markdown rules generation from model shortcomings.

**Exports:**

- `generateRulesMarkdown` - Convert shortcomings to markdown
- `loadShortcomingsFile` - Load JSON shortcomings file
- `getDefaultOutputPath` - Compute default output path
- `RulesGeneratorOptions` - Generation options type

```typescript
import {
  generateRulesMarkdown,
  getDefaultOutputPath,
  loadShortcomingsFile,
} from "./src/rules/mod.ts";
import type { RulesGeneratorOptions } from "./src/rules/mod.ts";

// Load shortcomings and generate rules
const data = await loadShortcomingsFile("model-shortcomings/gpt-5.2.json");
const markdown = generateRulesMarkdown(data, { minOccurrences: 2 });
await Deno.writeTextFile("rules.md", markdown);
```

### Prompts Module (`src/prompts/`)

Prompt injection and knowledge bank management.

**Exports:**

- `PromptInjectionResolver` - Resolve and apply prompt injections
- `loadKnowledgeFiles` - Load markdown files as knowledge bank
- `hasKnowledgeOptions` - Check if knowledge options are provided
- `CLIPromptOverrides` - CLI prompt override options type

```typescript
import {
  hasKnowledgeOptions,
  loadKnowledgeFiles,
} from "./src/prompts/knowledge-loader.ts";
import { PromptInjectionResolver } from "./src/prompts/injection-resolver.ts";
import type { CLIPromptOverrides } from "./src/prompts/types.ts";

// Load knowledge files
const knowledge = await loadKnowledgeFiles({
  files: ["rules.md", "tips.md"],
  directory: ".claude/rules/",
});

// Apply to prompt overrides
const overrides: CLIPromptOverrides = {
  knowledgeContent: knowledge,
  runLabel: "guided",
};
```

## Type Reference

### Task Types

```typescript
// Task manifest (from YAML)
interface TaskManifest {
  id: string;
  description: string;
  prompt_template: string;
  fix_template: string;
  max_attempts: number;
  expected: {
    compile: boolean;
    testApp?: string;
    testCodeunitId?: number;
    mustContain?: string[];
    mustNotContain?: string[];
  };
  metrics: string[];
  metadata?: TaskMetadata;
}

// Execution result
interface TaskExecutionResult {
  taskId: string;
  executionId: string;
  success: boolean;
  finalScore: number;
  passedAttemptNumber: number;
  attempts: ExecutionAttempt[];
  totalTokensUsed: number;
  totalCost: number;
  totalDuration: number;
}
```

### LLM Types

```typescript
// LLM configuration
interface LLMConfig {
  provider: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  thinkingBudget?: number | string;
}

// LLM response
interface LLMResponse {
  content: string;
  model: string;
  usage: TokenUsage;
  duration: number;
  finishReason: "stop" | "length" | "content_filter" | "error";
}

// Token usage
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: number;
}
```

### Container Types

```typescript
// Compilation result
interface CompilationResult {
  success: boolean;
  errors: CompilationError[];
  warnings: CompilationWarning[];
  output: string;
  duration: number;
  artifactPath?: string;
}

// Test result
interface TestResult {
  success: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number;
  results: TestCaseResult[];
  output: string;
}
```

### Agent Types

```typescript
// Agent configuration
interface AgentConfig {
  id: string;
  name: string;
  model: string;
  maxTurns: number;
  allowedTools: string[];
  systemPrompt?: SystemPromptConfig;
  limits?: AgentLimits;
}

// Agent result
interface AgentExecutionResult {
  taskId: string;
  agentId: string;
  success: boolean;
  terminationReason: TerminationReason;
  metrics: AgentCostMetrics;
  testResult?: TestResult;
}
```

## Usage Examples

### Run a Single Task

```typescript
import { loadTaskManifest } from "./src/tasks/loader.ts";
import { TaskExecutorV2 } from "./src/tasks/executor-v2.ts";

const manifest = await loadTaskManifest(
  "tasks/easy/CG-AL-E001-basic-table.yml",
);
const executor = new TaskExecutorV2();

const result = await executor.executeTask({
  taskManifest: manifest,
  llmProvider: "anthropic",
  llmModel: "claude-sonnet-4-20250514",
  containerName: "Cronus28",
  attemptLimit: 2,
});

console.log(`Success: ${result.success}, Score: ${result.finalScore}`);
```

### Run Parallel Benchmark

```typescript
import {
  createDefaultConfig,
  ParallelBenchmarkOrchestrator,
} from "./src/parallel/mod.ts";
import { loadTaskManifest } from "./src/tasks/loader.ts";

const config = createDefaultConfig();
config.maxGlobalConcurrency = 5;

const orchestrator = new ParallelBenchmarkOrchestrator(config);

orchestrator.on((event) => {
  if (event.type === "result") {
    console.log(
      `${event.result.taskId}: ${event.result.success ? "pass" : "fail"}`,
    );
  }
});

const manifests = [
  await loadTaskManifest("tasks/easy/CG-AL-E001-basic-table.yml"),
];

const variants = [
  {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    variantId: "sonnet",
  },
];

const { results, summary } = await orchestrator.runParallel(
  manifests,
  variants,
  {
    containerName: "Cronus28",
    attemptLimit: 2,
  },
);
```

### Execute an Agent

```typescript
import { AgentRegistry } from "./src/agents/registry.ts";
import { AgentTaskExecutor } from "./src/agents/executor.ts";
import { loadTaskManifest } from "./src/tasks/loader.ts";

await AgentRegistry.load("agents");
const agentConfig = AgentRegistry.get("default");
const taskManifest = await loadTaskManifest(
  "tasks/easy/CG-AL-E001-basic-table.yml",
);

const executor = new AgentTaskExecutor();
const result = await executor.execute(agentConfig, taskManifest, {
  projectDir: "/path/to/workspace",
  containerName: "Cronus28",
  containerProvider: "bccontainer",
});

console.log(
  `Turns: ${result.metrics.turns}, Cost: $${result.metrics.estimatedCost}`,
);
```

### Create Custom LLM Adapter

```typescript
import type {
  CodeGenerationResult,
  LLMAdapter,
  LLMConfig,
  LLMRequest,
} from "./src/llm/types.ts";
import { LLMAdapterRegistry } from "./src/llm/registry.ts";

class MyAdapter implements LLMAdapter {
  readonly name = "my-adapter";
  readonly supportedModels = ["my-model"];

  configure(config: LLMConfig): void {/* ... */}

  async generateCode(
    request: LLMRequest,
    context: GenerationContext,
  ): Promise<CodeGenerationResult> {
    // Implementation
  }

  // ... other methods
}

LLMAdapterRegistry.register("my-adapter", () => new MyAdapter());
```

## Error Handling

```typescript
import {
  CentralGaugeError,
  ContainerError,
  isRetryableError,
  LLMProviderError,
} from "./src/errors.ts";

try {
  const result = await executor.executeTask(request);
} catch (error) {
  if (error instanceof LLMProviderError) {
    console.log(`Provider error: ${error.provider}`);
    if (isRetryableError(error)) {
      // Retry logic
    }
  } else if (error instanceof ContainerError) {
    console.log(`Container error: ${error.containerName} - ${error.operation}`);
  }
}
```

## See Also

- [Core Types](./types.md) - Detailed type reference
- [Architecture Overview](../architecture/overview.md) - System design
- [LLM Adapters](../architecture/llm-adapters.md) - Adapter development
- [Container Providers](../architecture/containers.md) - Provider development
