# Agent Benchmark Guide

Quick reference for running A/B agent benchmarks — comparing configurations, tools, and models.

## Agent Config Files

Agent configs live in `agents/*.yml`. Each config defines a complete agent setup: model, tools, MCP servers, limits, and prompt strategy.

### Key Fields

```yaml
id: my-agent # Unique identifier (used in CLI and results)
name: "My Agent" # Display name
model: claude-sonnet-4-6 # Model to use
extends: default # Inherit from another agent config
maxTurns: 500 # Max conversation turns
allowedTools: [...] # SDK tools the agent can use
mcpServers: { ... } # MCP servers (al-tools for compile/test)
limits:
  maxCompileAttempts: 15 # Give up after N failed compiles
  timeoutMs: 300000 # 5 minute timeout
  maxBudgetUsd: 2.00 # Hard cost cap per task
  maxRetries: 1 # Retry on transient errors
settingSources: [project] # Load CLAUDE.md from workingDir
workingDir: agents/my-dir # Project dir with CLAUDE.md and skills
```

### Inheritance (`extends`)

Configs can extend a parent. Only override what you need:

```yaml
# agents/my-variant.yml
id: my-variant
name: "My Variant"
extends: default # Gets everything from default.yml
allowedTools: # Override just this field
  - Read
  - Write
  - Edit
```

All unspecified fields come from the parent. This is how you create A/B variants.

## Setting Up an LSP vs No-LSP Comparison

### 1. Create the two agent configs

**`agents/sonnet-lsp.yml`** — With LSP:

```yaml
id: sonnet-lsp
name: "Sonnet + LSP"
extends: default
model: claude-sonnet-4-6

allowedTools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - LSP # <-- AL language server (hover, symbols, diagnostics)

tags:
  - lsp-comparison
  - with-lsp
```

**`agents/sonnet-no-lsp.yml`** — Without LSP:

```yaml
id: sonnet-no-lsp
name: "Sonnet (no LSP)"
extends: default
model: claude-sonnet-4-6

allowedTools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  # No LSP — agent relies on compiler errors only

tags:
  - lsp-comparison
  - no-lsp
```

### How LSP Works

When `LSP` is in `allowedTools`, the executor auto-resolves the AL language server plugin from `~/.claude/plugins/cache/claude-code-lsps/al-language-server-go-windows/`. This gives the agent tools like `documentSymbol`, `hover`, `diagnostics`, etc. — letting it explore AL types without compiling.

If the plugin isn't installed, the executor logs a warning and continues without it. Check it's installed:

```bash
ls ~/.claude/plugins/cache/claude-code-lsps/al-language-server-go-windows/
```

## Running Benchmarks

### Compare two agents on all tasks

```bash
deno task start bench --agents sonnet-lsp sonnet-no-lsp
```

### Run on specific difficulty tiers

```bash
# Easy only (19 tasks) — fast sanity check
deno task start bench --agents sonnet-lsp sonnet-no-lsp --tasks "tasks/easy/*.yml"

# Easy + Medium (38 tasks)
deno task start bench --agents sonnet-lsp sonnet-no-lsp --tasks "tasks/easy/*.yml" "tasks/medium/*.yml"

# Hard only (26 tasks) — where LSP might matter most
deno task start bench --agents sonnet-lsp sonnet-no-lsp --tasks "tasks/hard/*.yml"
```

### Run specific tasks

```bash
# Single task
deno task start bench --agents sonnet-lsp sonnet-no-lsp --tasks "tasks/easy/CG-AL-E001-basic-table.yml"

# Multiple specific tasks
deno task start bench --agents sonnet-lsp sonnet-no-lsp \
  --tasks "tasks/easy/CG-AL-E001-basic-table.yml" "tasks/hard/CG-AL-H001-tax-calculator.yml"
```

### Useful flags

```bash
# Debug mode — shows SDK messages, tool calls, timing
--debug

# TUI mode — live split-pane progress
--tui

# Multiple runs for statistical significance (pass@k)
--runs 3

# Custom output directory
--output results/lsp-comparison

# Limit task concurrency (1 = serial, safer for shared BC container)
--task-concurrency 1

# Override container
--container Cronus28
```

### Full recommended command

```bash
deno task start bench \
  --agents sonnet-lsp sonnet-no-lsp \
  --tasks "tasks/easy/*.yml" "tasks/medium/*.yml" "tasks/hard/*.yml" \
  --task-concurrency 1 \
  --output results/lsp-comparison \
  --debug
```

## Reading Results

Results go to `results/agent-benchmark-{timestamp}.json`.

### Quick results with jq

```bash
# Summary: pass rate per agent
cat results/agent-benchmark-*.json | jq '{
  agents: .agents,
  stats: .stats
}'

# Per-task comparison
cat results/agent-benchmark-*.json | jq '.results[] | {taskId, agentId, success: .result.success, turns: .result.metrics.turns, cost: .result.sdkCostUsd, duration: .result.duration}'

# Win/loss matrix — tasks where LSP helped vs didn't
cat results/agent-benchmark-*.json | jq '
  [.results[] | {taskId, agentId, success: .result.success}]
  | group_by(.taskId)
  | map(select(length == 2))
  | map({
      task: .[0].taskId,
      lsp: (map(select(.agentId == "sonnet-lsp")) | .[0].success),
      noLsp: (map(select(.agentId == "sonnet-no-lsp")) | .[0].success)
    })
  | map(select(.lsp != .noLsp))
'
```

### Per-execution logs (new)

Each execution writes structured JSONL logs to the task working directory:

```
.tasks/{taskId}-{executionId}/execution.jsonl
```

Contains: execution metadata, per-turn progress with tool names, and final result with cost/session data. Useful for post-mortem analysis of individual failures.

```bash
# View execution log for a specific run
cat .tasks/CG-AL-E001-agent-*/execution.jsonl | jq .

# Find which tools were used per turn
cat .tasks/CG-AL-E001-agent-*/execution.jsonl | jq 'select(.namespace == "agent:turn") | {message, tools: .data.tools}'
```

## Other Comparison Ideas

### Model comparison (same tools)

```yaml
# agents/opus-default.yml
id: opus-default
extends: default
model: claude-opus-4-6

# agents/sonnet-default.yml
id: sonnet-default
extends: default
model: claude-sonnet-4-6
```

```bash
deno task start bench --agents opus-default sonnet-default
```

### Skills vs no-skills

```yaml
# agents/with-skills.yml already exists — uses AL-specific skills
# agents/config-a.yml already exists — minimal guidance

deno task start bench --agents with-skills config-a
```

### Budget impact

```yaml
# agents/low-budget.yml
id: low-budget
extends: default
model: claude-sonnet-4-6
limits:
  maxBudgetUsd: 0.50

# agents/high-budget.yml
id: high-budget
extends: default
model: claude-sonnet-4-6
limits:
  maxBudgetUsd: 5.00
```

### Prompt template comparison

```yaml
# Universal template (provider-agnostic, generic tool names)
id: universal-agent
extends: default
promptTemplate: universal
toolNaming: generic

# Legacy template (current default, MCP-prefixed tool names)
id: legacy-agent
extends: default
promptTemplate: legacy
toolNaming: mcp
```

## Parallel Execution & Multi-Container

### Current State

Agent benchmarks run **sequentially**: one task at a time, one agent at a time. All agents share a single `--container`. This means two agents running 64 tasks takes ~2x as long as one agent.

The LLM benchmark path (`--llms`) already supports `--containers Cronus28 Cronus29` for parallel compilation across multiple BC containers. The agent path does not yet have this.

### Why Not Parallel Today

Each agent execution calls the Claude Agent SDK `query()` which runs a full autonomous session. The agent itself decides when to compile — and compilation happens via the MCP server which talks to the BC container. Two agents compiling on the same container simultaneously would work (bccontainerhelper handles concurrent compile requests), but the bottleneck is that each agent runs for 1-5 minutes and the executor processes them serially.

### What It Would Take

To support `--containers Cronus28 Cronus29` in agent mode with per-agent container affinity:

1. **`AgentBenchmarkOptions`** — add `containers?: string[]` (like LLM mode already has)
2. **`agent-executor.ts`** — instead of the nested `for task / for agent` loop, run agents concurrently per task using `Promise.all` or a concurrency pool, assigning each agent its own container
3. **`AgentExecutionOptions`** — already has `containerName: string`, so each concurrent call just gets a different container name
4. **MCP server** — each agent needs its own MCP server instance (or the MCP server needs to route to different containers). Currently the MCP server is configured in the agent YAML with a fixed path. The executor would need to inject the container name dynamically.

The simplest approach: run two separate benchmark processes in parallel, each with a different container:

```bash
# Terminal 1
deno task start bench --agents sonnet-lsp --container Cronus28 --output results/lsp-run

# Terminal 2
deno task start bench --agents sonnet-no-lsp --container Cronus29 --output results/no-lsp-run
```

Then merge results with jq:

```bash
jq -s '.[0].results + .[1].results' results/lsp-run/agent-benchmark-*.json results/no-lsp-run/agent-benchmark-*.json > results/combined.json
```

This gives true parallelism today without code changes. The agents don't interfere because each has its own container and workspace directory.

## Task Inventory

| Tier   | Count | What it tests                                                             |
| ------ | ----- | ------------------------------------------------------------------------- |
| Easy   | 19    | Tables, pages, enums, basic codeunits                                     |
| Medium | 19    | API pages, business logic, complex tables, report layouts                 |
| Hard   | 26    | Tax calculators, flowfields, event subscribers, interfaces, data transfer |

## Troubleshooting

**Agent hangs with no output**

- Check `ANTHROPIC_API_KEY` is set: `source .env`
- Verify BC container is running: `curl http://Cronus28/BC/?tenant=default`

**LSP plugin not found**

- Install via Claude Code: open a `.al` file and accept the LSP plugin prompt
- Or check: `ls ~/.claude/plugins/cache/claude-code-lsps/`

**Compilation always fails**

- Ensure container is healthy: `deno task start bench --agents sonnet-lsp --tasks "tasks/easy/CG-AL-E001-basic-table.yml" --debug`
- Check sandbox-debug.log for MCP server issues

**Results show 0 compile attempts**

- Agent may not be calling the compile tool — check `toolCallCounts` in results
- Verify MCP server is configured in agent YAML

**Session ID missing in results**

- Upgrade to latest codebase — `sessionId` capture was just added
- Only populated for non-sandbox executions currently
