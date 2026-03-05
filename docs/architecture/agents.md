# Agent System

The agent system enables autonomous LLM agents (like Claude Code) to iteratively generate, compile, and fix AL code until success. Unlike single-shot LLM benchmarks, agents can use tools to inspect errors and refine their solutions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Agent Executor                                 │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │                    Agent Configuration                         │ │
│   │  - Model selection                                             │ │
│   │  - Tools allowed                                               │ │
│   │  - System prompt                                               │ │
│   │  - Execution limits                                            │ │
│   └───────────────────────────────────────────────────────────────┘ │
│                              │                                       │
│                              ▼                                       │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │                    Execution Loop                              │ │
│   │  1. Generate code                                              │ │
│   │  2. Compile via MCP tool                                       │ │
│   │  3. Read errors                                                │ │
│   │  4. Fix code                                                   │ │
│   │  5. Repeat until success or limit                              │ │
│   └───────────────────────────────────────────────────────────────┘ │
│                              │                                       │
└──────────────────────────────│───────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐
│  Claude Code     │  │  MCP Server  │  │   BC Container   │
│  (Agent SDK)     │  │  (AL Tools)  │  │   (Compilation)  │
└──────────────────┘  └──────────────┘  └──────────────────┘
```

## Agent Configuration

Agents are configured in YAML files in the `agents/` directory:

```yaml
# agents/my-agent.yml
id: my-agent
name: "My Custom Agent"
description: "Optimized for BC development"

# Model selection
model: claude-opus-4-5-20251101

# Execution limits
maxTurns: 100
maxTokens: 500000

# Project directory with CLAUDE.md, skills, etc.
workingDir: agents/al-project

# Settings to load
settingSources:
  - project

# Tools the agent can use
allowedTools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Skill

# MCP servers for AL tools
mcpServers:
  al-tools:
    command: deno
    args:
      - run
      - --allow-all
      - mcp/al-tools-server.ts

# System prompt configuration
systemPrompt:
  preset: claude_code
  append: |
    ## AL Code Generation Workflow
    1. Read the task description
    2. Write AL code to .al files
    3. Use mcp__al-tools__al_compile to compile
    4. Fix errors and recompile until success

# Execution limits
limits:
  maxCompileAttempts: 15
  timeoutMs: 300000

# Tags for filtering
tags:
  - baseline
  - al-generation
```

## Configuration Schema

### AgentConfig

```typescript
interface AgentConfig {
  // Identification
  id: string;
  name: string;
  description?: string;

  // Model
  model: string; // Preset alias or provider/model

  // Execution limits
  maxTurns: number;
  maxTokens?: number;

  // Claude Code features
  workingDir?: string;
  settingSources?: ("user" | "project")[];
  allowedTools: string[];
  mcpServers?: Record<string, MCPServerConfig>;
  systemPrompt?: SystemPromptConfig;

  // Execution
  limits?: AgentLimits;
  sandbox?: SandboxModeConfig;

  // Inheritance
  extends?: string;
  tags?: string[];
}
```

### MCPServerConfig

```typescript
interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}
```

### SystemPromptConfig

```typescript
type SystemPromptConfig =
  | string // Custom system prompt
  | {
    preset: "claude_code"; // Use Claude Code's built-in
    append?: string; // Optional text to append
  };
```

### AgentLimits

```typescript
interface AgentLimits {
  maxCompileAttempts?: number; // Max compilation attempts
  timeoutMs?: number; // Overall timeout
}
```

## Agent Registry

The `AgentRegistry` manages agent configurations:

```typescript
import { AgentRegistry } from "../src/agents/registry.ts";

// Load agents from directory
await AgentRegistry.load("agents");

// Get a specific agent
const config = AgentRegistry.get("my-agent");

// List available agents
const agents = AgentRegistry.list();
// ["default", "my-agent", ...]

// Validate an agent config
const validation = AgentRegistry.validate(config);
// { valid: true, errors: [], warnings: [] }
```

## Agent Executor

The `AgentTaskExecutor` runs agents on tasks:

```typescript
import { AgentTaskExecutor } from "../src/agents/executor.ts";

const executor = new AgentTaskExecutor();

const result = await executor.execute(agentConfig, taskManifest, {
  projectDir: "/path/to/workspace",
  containerName: "Cronus28",
  containerProvider: "bccontainer",
  debug: true,
  sandbox: false,
});
```

### Execution Options

```typescript
interface AgentExecutionOptions {
  projectDir: string;
  containerName: string;
  containerProvider: string;
  debug?: boolean;
  abortSignal?: AbortSignal;
  sandbox?: boolean;
  mcpHttpPort?: number;
}
```

## Execution Result

```typescript
interface AgentExecutionResult {
  // Identification
  taskId: string;
  agentId: string;
  executionId: string;

  // Outcome
  success: boolean;
  finalCode?: string;
  terminationReason: TerminationReason;

  // Metrics
  turns: AgentTurn[];
  metrics: AgentCostMetrics;
  duration: number;

  // Test results
  testResult?: TestResult;
  resultSummary?: ParsedTaskResult;

  // Failure details (if failed)
  failureDetails?: DetailedFailureReason;

  executedAt: Date;
}

type TerminationReason =
  | "success"
  | "max_turns"
  | "max_tokens"
  | "max_compile_attempts"
  | "test_failure"
  | "timeout"
  | "error";
```

## MCP Tools

Agents use MCP (Model Context Protocol) tools to interact with the AL compiler:

### al_compile

Compiles AL code in a project directory:

```typescript
// Tool input
{
  projectDir: "/path/to/project",
  containerName: "Cronus28"
}

// Tool output (success)
"Compilation: **Success**\nNo errors found."

// Tool output (failure)
"Compilation: **Failed**\nErrors found:\n- AL0001: Syntax error at line 10"
```

### al_verify

Compiles and runs tests:

```typescript
// Tool input
{
  projectDir: "/path/to/project",
  testFile: "/path/to/test.al",
  testCodeunitId: 80001,
  containerName: "Cronus28"
}

// Tool output
"Compilation: **Success**\nTests: 4 passed, 0 failed\nAll tests passed!"
```

### al_verify_task

Verifies a task by ID:

```typescript
// Tool input
{
  projectDir: "/path/to/project",
  taskId: "CG-AL-E001",
  containerName: "Cronus28"
}
```

## Sandbox Mode

Sandbox mode runs agents in isolated Windows containers:

```yaml
# Agent config with sandbox
sandbox:
  enabled: true
  provider: windows
  image: centralgauge/agent-sandbox:windows-latest
```

### Sandbox Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Host Machine                                │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │                    MCP HTTP Server                             │ │
│   │                    (port 3100)                                 │ │
│   │  - Path translation (C:\workspace -> host path)                │ │
│   │  - AL compilation tools                                        │ │
│   └───────────────────────────────────────────────────────────────┘ │
│                              │ HTTP                                  │
└──────────────────────────────│───────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Docker Container (Sandbox)                       │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │  Windows Server Core 2025                                      │ │
│   │  - Node.js                                                     │ │
│   │  - Git Bash                                                    │ │
│   │  - Claude Code CLI                                             │ │
│   │                                                                │ │
│   │  Workspace: C:\workspace (mounted from host)                   │ │
│   └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Using Sandbox Mode

```bash
# Run with sandbox
deno task bench \
  --agents my-agent \
  --tasks tasks/easy/*.yml \
  --container Cronus28 \
  --sandbox
```

## Agent Inheritance

Agents can extend other agents:

```yaml
# agents/minimal.yml
id: minimal
extends: default
name: "Minimal Agent"
description: "Extends default with fewer tools"

# Override tools
allowedTools:
  - Read
  - Write
  - Edit

# Override limits
limits:
  maxCompileAttempts: 5
```

Resolution order:

1. Agent's own settings
2. Parent agent's settings
3. Default values

## Cost Tracking

Agent executions track costs:

```typescript
interface AgentCostMetrics {
  turns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number; // USD
  compileAttempts: number;
  testRuns: number;
}
```

## Failure Details

When agents fail, detailed failure information is captured:

```typescript
interface DetailedFailureReason {
  terminationReason: TerminationReason;
  phase: FailurePhase;
  summary: string;

  // Phase-specific details
  compilation?: CompilationFailureDetails;
  tests?: TestFailureDetails;
  timeout?: TimeoutDetails;
  container?: ContainerFailureDetails;

  failedAt: Date;
}

type FailurePhase =
  | "container_startup"
  | "mcp_connection"
  | "agent_execution"
  | "compilation"
  | "test_execution"
  | "timeout"
  | "unknown";
```

## Running Agent Benchmarks

### Basic Usage

```bash
# Single agent
deno task bench --agents default --tasks tasks/easy/*.yml --container Cronus28

# Multiple agents for comparison
deno task bench --agents default,minimal --tasks tasks/easy/*.yml --container Cronus28

# With sandbox mode
deno task bench --agents default --tasks tasks/easy/*.yml --container Cronus28 --sandbox

# With debug output
deno task bench --agents default --tasks tasks/easy/*.yml --debug
```

### Output

```
[CentralGauge] Starting agent benchmark...
[Info] Agents: default
[Info] Tasks: tasks/easy/CG-AL-E001-basic-table.yml
[Info] Container: Cronus28

[Task] CG-AL-E001: Running with 1 agent(s)
[default] Starting...
[default] pass (tests: 4/4), turns: 12, cost: $0.0234

[Summary]
Agent        | Pass | Fail | Cost      | Turns
-------------|------|------|-----------|-------
default      | 1    | 0    | $0.0234   | 12
```

## Creating Custom Agents

### 1. Define Configuration

Create `agents/my-agent.yml`:

```yaml
id: my-agent
name: "My Custom Agent"
model: claude-opus-4-5-20251101
maxTurns: 100

allowedTools:
  - Read
  - Write
  - Edit
  - Bash

systemPrompt:
  preset: claude_code
  append: |
    Your custom instructions here.

limits:
  maxCompileAttempts: 10
  timeoutMs: 180000
```

### 2. Create Working Directory (Optional)

Create `agents/my-project/CLAUDE.md`:

```markdown
# AL Development Guide

## Code Style

- Use PascalCase for all identifiers
- Include proper captions
- Add data classification
```

Reference in config:

```yaml
workingDir: agents/my-project
settingSources:
  - project
```

### 3. Test the Agent

```bash
deno task bench --agents my-agent --tasks tasks/easy/CG-AL-E001*.yml
```

## Next Steps

- [Architecture Overview](./overview.md) - System design
- [LLM Adapters](./llm-adapters.md) - LLM integration
- [Running Benchmarks](../guides/running-benchmarks.md) - Usage guide
