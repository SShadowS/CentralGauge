# Running Benchmarks

CentralGauge supports two benchmark modes: **LLM benchmarks** (single API calls) and **Agent benchmarks** (autonomous iterative execution).

## LLM Benchmarks

LLM benchmarks evaluate models on their ability to generate correct AL code in a single attempt, with an optional second attempt to fix compilation errors.

### Basic Usage

```bash
deno task bench --llms <models> --tasks <patterns> [options]
```

### Specifying Models

#### Model Aliases

Use convenient short names:

```bash
deno task bench --llms sonnet,opus,gpt-5
```

| Alias    | Full Model           |
| -------- | -------------------- |
| `opus`   | claude-4.5-opus      |
| `sonnet` | claude-sonnet-4      |
| `gpt-5`  | gpt-5.2              |
| `gpt-4o` | gpt-4o               |
| `o3`     | o3                   |
| `o1`     | o1                   |
| `gemini` | gemini-3-pro-preview |

#### Provider/Model Format

Explicitly specify provider and model:

```bash
deno task bench --llms anthropic/claude-sonnet-4-20250514,openai/gpt-4o-2024-08-06
```

#### Model Groups

Use predefined groups:

```bash
# Flagship models from each provider
deno task bench --llms flagship

# Best coding models
deno task bench --llms coding

# Budget-friendly options
deno task bench --llms budget
```

#### OpenRouter Models

Access 200+ models through OpenRouter:

```bash
deno task bench --llms openrouter/anthropic/claude-4.5-opus
deno task bench --llms openrouter/google/gemini-3-pro-preview
```

### Specifying Tasks

Use glob patterns to select tasks:

```bash
# Single task
deno task bench --llms sonnet --tasks "tasks/easy/CG-AL-E001-basic-table.yml"

# All easy tasks
deno task bench --llms sonnet --tasks "tasks/easy/*.yml"

# All tasks in any difficulty
deno task bench --llms sonnet --tasks "tasks/**/*.yml"

# Multiple patterns
deno task bench --llms sonnet --tasks "tasks/easy/*.yml" "tasks/medium/*.yml"
```

### Execution Options

#### Attempts

Control how many attempts each model gets:

```bash
# Single attempt (no retry on failure)
deno task bench --llms sonnet --tasks tasks/*.yml --attempts 1

# Two attempts (default)
deno task bench --llms sonnet --tasks tasks/*.yml --attempts 2
```

#### Temperature

Adjust model creativity:

```bash
# Lower temperature = more deterministic
deno task bench --llms sonnet --tasks tasks/*.yml --temperature 0.1

# Higher temperature = more varied
deno task bench --llms sonnet --tasks tasks/*.yml --temperature 0.7
```

#### Token Limits

Set maximum response length:

```bash
deno task bench --llms sonnet --tasks tasks/*.yml --max-tokens 8000
```

#### Concurrency

Control parallel execution:

```bash
# Limit concurrent LLM calls
deno task bench --llms sonnet --tasks tasks/*.yml --max-concurrency 5

# Disable parallelism entirely
deno task bench --llms sonnet --tasks tasks/*.yml --sequential
```

### Output Options

#### Output Directory

Specify where results are saved:

```bash
deno task bench --llms sonnet --tasks tasks/*.yml --output my-results/
```

#### Output Formats

Choose display format:

```bash
# Verbose (default) - full details
deno task bench --llms sonnet --format verbose

# Leaderboard - ranked table
deno task bench --llms sonnet --format leaderboard

# Scorecard - compact summary
deno task bench --llms sonnet --format scorecard

# JSON - machine readable
deno task bench --llms sonnet --format json
```

#### Debug Logging

Capture detailed execution logs:

```bash
# Enable debug mode
deno task bench --llms sonnet --tasks tasks/*.yml --debug

# Verbose debug with raw responses
deno task bench --llms sonnet --tasks tasks/*.yml --debug-level verbose

# Custom debug output directory
deno task bench --llms sonnet --tasks tasks/*.yml --debug --debug-output ./my-debug
```

### TUI Mode

Enable the terminal UI for real-time progress visualization:

```bash
deno task bench --llms sonnet --tasks tasks/*.yml --tui
```

The TUI shows:

- Progress bar
- Active LLM calls
- Compile queue status
- Pass/fail rates per model
- Error log

### Retry Mode

Resume a failed benchmark run:

```bash
# Initial run
deno task bench --llms sonnet,gpt-4o --tasks tasks/**/*.yml -o results/run1

# Retry missing combinations
deno task bench --llms sonnet,gpt-4o --retry results/run1/benchmark-results-*.json
```

## Agent Benchmarks

Agent benchmarks evaluate autonomous agents (like Claude Code) that can iteratively generate, compile, and fix code until success.

### Basic Usage

```bash
deno task bench --agents <agent-ids> --tasks <patterns> --container <name>
```

### Specifying Agents

Agent configurations are defined in `agents/*.yml`:

```bash
# Single agent
deno task bench --agents default --tasks tasks/easy/*.yml

# Multiple agents for comparison
deno task bench --agents default,minimal --tasks tasks/easy/*.yml
```

### Agent Configuration

Create custom agent configurations in `agents/`:

```yaml
# agents/my-agent.yml
id: my-agent
name: "My Custom Agent"
description: "Optimized for BC development"
model: claude-opus-4-5-20251101
maxTurns: 100
maxTokens: 500000

allowedTools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Skill

limits:
  maxCompileAttempts: 10
  timeoutMs: 180000
```

### Sandbox Mode

Run agents in isolated Windows containers:

```bash
deno task bench \
  --agents default \
  --tasks tasks/easy/*.yml \
  --container Cronus28 \
  --sandbox
```

Sandbox mode:

- Isolates agent execution
- Provides MCP tools via HTTP
- Prevents interference between runs
- Requires Docker with Windows containers

### Agent Options

```bash
# Enable debug output
deno task bench --agents default --tasks tasks/*.yml --debug

# Show detailed failure output
deno task bench --agents default --tasks tasks/*.yml --verbose

# Enable streaming
deno task bench --agents default --tasks tasks/*.yml --stream
```

## Understanding Results

### Pass Rates

- **Pass Rate 1 (PR1)**: Percentage passing on first attempt
- **Pass Rate 2 (PR2)**: Percentage passing on second attempt
- **Overall Pass Rate**: Total percentage passing within attempt limit

### Scoring

Each task execution receives a score from 0.0 to 1.0:

| Score   | Meaning                                 |
| ------- | --------------------------------------- |
| 1.0     | Compilation successful, all tests pass  |
| 0.7-0.9 | Compilation successful, some tests pass |
| 0.3-0.5 | Compilation successful, no tests        |
| 0.0     | Compilation failed                      |

### Cost Tracking

Results include estimated API costs:

```json
{
  "stats": {
    "totalTokens": 45678,
    "totalCost": 0.2345,
    "perModel": {
      "anthropic/claude-sonnet-4-20250514": {
        "cost": 0.1234,
        "tokens": 23456
      }
    }
  }
}
```

## Prompt Customization

Override prompts at runtime:

```bash
# Custom system prompt
deno task bench --llms sonnet --system-prompt "You are an AL expert..."

# Add prefix/suffix to prompts
deno task bench --llms sonnet --prompt-prefix "Important: " --prompt-suffix " Be concise."

# Apply only to specific stage
deno task bench --llms sonnet --system-prompt "..." --prompt-stage generation
```

## Knowledge Bank Injection

The knowledge bank feature allows injecting markdown files into the system prompt to provide model-specific guidance. This enables comparing model performance with and without guidance (e.g., "gpt-5" vs "gpt-5 (guided)").

### Basic Usage

```bash
# Single knowledge file
deno task bench --llms gpt-5 --knowledge model-shortcomings/gpt-5.rules.md

# Multiple files
deno task bench --llms gpt-5 --knowledge rules1.md rules2.md tips.md

# Directory of .md files (loaded alphabetically)
deno task bench --llms gpt-5 --knowledge-dir .claude/rules/
```

### Run Labeling

When knowledge files are provided, the run is automatically labeled with "(guided)" suffix:

```bash
# Auto-labeled as "gpt-5 (guided)"
deno task bench --llms gpt-5 --knowledge rules.md

# Custom label override
deno task bench --llms gpt-5 --knowledge rules.md --run-label "gpt-5-optimized"
```

### Knowledge Bank Format

Knowledge content is formatted and prepended to the system prompt:

```markdown
# Knowledge Bank

The following guidance should inform your code generation:

---
## filename.md
{ content of filename.md }
---

## another-file.md

{content of another-file.md}

# End Knowledge Bank
```

### Workflow: Rules to Knowledge

This feature integrates with the `rules` command for a complete improvement cycle:

```bash
# Step 1: Run baseline benchmark
deno task bench --llms gpt-5 --tasks "tasks/**/*.yml" -o results/baseline

# Step 2: Analyze failures and generate shortcomings JSON
# (Done automatically during benchmark or via verify command)

# Step 3: Generate rules from shortcomings
deno run --allow-all cli/centralgauge.ts rules model-shortcomings/gpt-5.json

# Step 4: Run guided benchmark with generated rules
deno task bench --llms gpt-5 --knowledge model-shortcomings/gpt-5.rules.md \
  --tasks "tasks/**/*.yml" -o results/guided

# Step 5: Compare results to measure improvement
```

### Use Cases

| Use Case                    | Command                                             |
| --------------------------- | --------------------------------------------------- |
| Test model-specific rules   | `--knowledge model-shortcomings/gpt-5.rules.md`     |
| Test Claude Code rules      | `--knowledge-dir .claude/rules/`                    |
| A/B test guidance           | Run with/without `--knowledge`, compare reports     |
| Custom prompting strategies | `--knowledge strategy.md --run-label "strategy-v2"` |

## Historical Stats

Track benchmark results over time:

```bash
# Import results to database
deno run --allow-all cli/centralgauge.ts stats-import results/

# View recent runs
deno run --allow-all cli/centralgauge.ts stats-runs

# Compare models
deno run --allow-all cli/centralgauge.ts stats-compare opus gpt-5

# Detect regressions
deno run --allow-all cli/centralgauge.ts stats-regression --threshold 10
```

## Next Steps

- [Model Variants](./model-variants.md) - Compare same model with different settings
- [Configuration](./configuration.md) - Customize CentralGauge
- [Understanding Results](./understanding-results.md) - Deep dive into output
