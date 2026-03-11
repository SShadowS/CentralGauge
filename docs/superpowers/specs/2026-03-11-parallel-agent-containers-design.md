# Parallel Agent Containers Design

## Goal

Enable two agent benchmarks to run simultaneously, each with its own BC container, cutting A/B comparison time in half while also testing instruction-following (agents must use their assigned container name in MCP tool calls).

## Scope

- **Now:** 1:1 mapping — N agents, N containers. Each agent gets exactly one dedicated container.
- **Future:** N:M pool-based assignment. Data structures should accommodate this without breaking changes.

## CLI Interface

The `--containers` option already exists for LLM benchmarks (parallel compilation across multiple BC containers). This design reuses the same option for agent benchmarks with agent-mode-specific semantics.

```bash
# Parallel: each agent gets its own container (comma-delimited, reuses existing --containers option)
deno task start bench --agents sonnet-lsp sonnet-no-lsp --containers Cronus28,Cronus29

# Sequential: single container shared by all agents (unchanged)
deno task start bench --agents sonnet-lsp sonnet-no-lsp --container Cronus28

# Single agent with --containers: equivalent to --container (allowed, no special case)
deno task start bench --agents sonnet-lsp --containers Cronus28
```

**Validation rules (agent mode only — LLM mode is unaffected):**
- When both `--containers` and `--container` are provided in agent mode: `--containers` wins, `--container` is ignored (log a warning)
- When `--containers` is provided, `containers.length` must equal `agents.length`
- `--container` behavior is unchanged (backward compatible)

**Wiring:** `options.containers` is already parsed by the CLI. In the agent branch of the action handler (~line 271 of `bench-command.ts`), set `containerNames` from `options.containers` when present.

## Architecture

### Execution Model

**Sequential mode** (existing `--container` or `--containers` with 1 entry): Unchanged. Single `AgentTaskExecutor`, nested `for task / for agent` loop.

**Parallel mode** (`--containers` with N > 1 entries): N independent pipelines running concurrently.

```
CLI parses --containers Cronus28,Cronus29
    │
    ├── Pipeline 0: AgentTaskExecutor instance #1
    │   agent: sonnet-lsp
    │   container: Cronus28
    │   └── for each task → execute(agent, task, {containerName: "Cronus28"})
    │
    └── Pipeline 1: AgentTaskExecutor instance #2
        agent: sonnet-no-lsp
        container: Cronus29
        └── for each task → execute(agent, task, {containerName: "Cronus29"})

Both pipelines run via Promise.all, results merged at end
```

Each pipeline:
1. Creates its own `AgentTaskExecutor` instance (isolated mutable state: `toolTimings`, `pendingToolCalls`)
2. Iterates all tasks sequentially within its pipeline
3. Pushes results to a shared `allResults` array (safe — JS is single-threaded, no concurrent array mutation at the same tick)

### Prompt Injection

The container name is injected into the agent's system prompt whenever `containerNames` is set (i.e., parallel containers mode is active). This tests instruction-following — if the agent ignores the instruction and uses the default `Cronus28`, that's a real signal.

**Injected text** (appended after resolved system prompt):

```
## Container Assignment

You MUST use containerName: "{containerName}" for ALL MCP tool calls that accept a containerName parameter (al_compile, al_test, al_verify, al_verify_task). Do not use the default container.
```

**Injection point:** In `AgentTaskExecutor.execute()`, after `resolveSystemPrompt()` but before building `queryOptions`.

**Handling the polymorphic return type of `resolveSystemPrompt()`:**
- If the result is a **string**: concatenate the container instruction to the end.
- If the result is a **preset object** (`{ type: "preset", preset: "claude_code", append?: string }`): concatenate the container instruction to the existing `append` field (or set it if `append` is empty).

The condition is: inject whenever `options.containerNames` is provided in the execution options — regardless of whether the individual container name matches the default. The goal is testing instruction-following, not optimizing away the injection.

### MCP Server

No changes needed. The existing shared MCP server is stateless — `containerName` is a per-call parameter on every tool (`al_compile`, `al_test`, `al_verify`, `al_verify_task`). Two agents calling the same MCP server with different container names works without conflict.

### Concurrency Safety

| Resource | Shared? | Safe? | Why |
|----------|---------|-------|-----|
| `AgentTaskExecutor` | No — one per pipeline | Yes | Isolated instances |
| Workspace directories | No — unique per `${agentId}_${taskId}_${timestamp}` | Yes | No overlap |
| BC containers | No — one per pipeline | Yes | Dedicated containers |
| MCP server process | Yes | Yes | Stateless, `containerName` per call |
| `allResults` array | Yes | Yes | JS single-threaded, no concurrent mutation at same tick |
| Console output | Yes | Interleaved | Acceptable — lines prefixed with `[agentId]` |
| Internal `Logger` | Yes | Interleaved | Known limitation — `Logger.create("agent")` does not include agent ID. Debug output from two executors will interleave without agent identification. Acceptable for now; parameterized logger namespace (e.g., `Logger.create("agent:sonnet-lsp")`) is a future improvement. |

### Result Format

Unchanged. The existing result JSON already carries `agentId` per entry. Parallel vs sequential execution is transparent to the output format and downstream analysis.

## Changes

| File | Change |
|------|--------|
| `cli/commands/bench-command.ts` | Wire `options.containers` to agent path: set `containerNames` from parsed comma-delimited string. Warn if both `--container` and `--containers` provided in agent mode. |
| `cli/commands/bench/types.ts` | Add `containerNames?: string[]` to `AgentBenchmarkOptions` |
| `cli/commands/bench/agent-executor.ts` | When `containerNames` provided with N > 1: create one `AgentTaskExecutor` per agent, run pipelines via `Promise.all`, merge results. When N = 1, use sequential mode with that container. |
| `src/agents/executor.ts` | In `execute()`, accept optional `containerInstruction` in options. When present, append to resolved system prompt (handling both string and preset-object return types). |

No new files. No changes to MCP server, agent YAML schema, or result JSON format.

## Future: N:M Pool Assignment

The `containerNames: string[]` type naturally extends to a pool model:
- When `containers.length < agents.length`, containers become a shared pool
- Agents acquire/release containers per-task (like `LLMAdapterRegistry` pooling)
- Requires a `ContainerPool` class with `acquire()`/`release()` methods
- The prompt injection approach still works — the acquired container name is injected per-execution

This is out of scope for now but the data structures (`containerNames: string[]`) don't need to change.
