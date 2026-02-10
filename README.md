# CentralGauge

> **Modern LLM benchmark for Microsoft Dynamics 365 Business Central AL code**

> [!IMPORTANT]
> Currently only pre-made containers are supported. Create a BC27 container with TestToolkit installed before running benchmarks:
>
> ```powershell
> $cred = New-Object PSCredential 'admin', (ConvertTo-SecureString 'admin' -AsPlainText -Force)
> New-BcContainer -containerName Cronus27 -credential $cred -artifactUrl (Get-BCArtifactUrl -country us -version 27) -includeTestToolkit
> ```

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Deno](https://img.shields.io/badge/Deno-000000?style=flat-square&logo=deno&logoColor=white)](https://deno.land/)
[![MIT License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

CentralGauge evaluates large language models on their ability to generate, debug, and refactor **AL code** for Business Central. Get repeatable, two-attempt benchmarks with automated compilation and testing in isolated BC containers.

<img width="711" height="1277" alt="image" src="https://github.com/user-attachments/assets/f8a8e564-6397-42be-af83-42fd812f4c9a" />

## Features

- **Two-pass evaluation** - Models get a second chance to fix compilation errors
- **Containerized testing** - Isolated Business Central environments via Docker
- **Parallel execution** - Run multiple models and tasks concurrently (enabled by default)
- **Streaming support** - Real-time progress feedback during code generation
- **Rich reporting** - JSON data + beautiful HTML reports
- **Model agnostic** - Works with OpenAI, Anthropic, Google, Azure, OpenRouter, and local LLMs
- **Model variants** - Compare same model with different temperatures/prompts
- **Early validation** - Invalid models are detected before benchmark starts with helpful suggestions
- **Debug logging** - Capture raw LLM requests/responses for analysis
- **Historical stats** - SQLite persistence for tracking results, regressions, and costs over time
- **Fast & deterministic** - Consistent results across identical runs

## Quick Start

```bash
# Install Deno (if not already installed)
curl -fsSL https://deno.land/x/install/install.sh | sh

# Clone the repo
git clone https://github.com/SShadowS/CentralGauge.git
cd CentralGauge

# Set up your API keys
cp .env.example .env
# Edit .env and add your keys:
#   ANTHROPIC_API_KEY=sk-ant-...
#   OPENAI_API_KEY=sk-...

# Run your first benchmark - compare Claude vs GPT
deno task bench --llms "opus,gpt-5"

# Generate HTML report
deno task report results/ --html
```

## Commands

```bash
# Development
deno task lint        # Lint code
deno task fmt         # Format code
deno task test        # Run tests

# Benchmarking with model aliases
deno task bench --llms opus,gpt-5.2 --tasks tasks/easy/*.yml   # Use aliases
deno task bench --llms flagship --tasks tasks/*.yml            # Use groups
deno task bench --llms coding,budget --attempts 2              # Mix & match

# Traditional provider/model syntax
deno task bench --llms openai/gpt-5.2,anthropic/claude-4.5-opus

# OpenRouter models (access 200+ models)
deno task bench --llms openrouter/anthropic/claude-4.5-opus
deno task bench --llms openrouter/google/gemini-3-pro-preview

# Reasoning models comparison (recommended for complex tasks)
deno task bench --llms "opus@reasoning=50000,gpt-5@reasoning=50000"

# Sequential execution (parallel is default)
deno task bench --llms opus,gpt-5.2 --tasks tasks/*.yml --sequential

# Configuration
deno run --allow-all cli/centralgauge.ts config init           # Create config file
deno run --allow-all cli/centralgauge.ts models               # List all models
deno run --allow-all cli/centralgauge.ts models --provider openai  # List models for a provider
deno run --allow-all cli/centralgauge.ts models flagship      # Test model resolution

# HTML Reports
deno task report results/ --html --output reports/

# Stats & Analytics
deno run --allow-all cli/centralgauge.ts stats-import results/   # Import JSON results
deno run --allow-all cli/centralgauge.ts stats-runs              # View run history
deno run --allow-all cli/centralgauge.ts stats-compare opus gpt  # Compare models
deno run --allow-all cli/centralgauge.ts stats-cost              # Cost breakdown

# Failure Analysis
deno run --allow-all cli/centralgauge.ts verify debug/           # Analyze failures
deno run --allow-all cli/centralgauge.ts verify debug/ --dry-run # Preview fixes only
```

## Model Variants

Compare the same model with different configurations using the `@` syntax:

```bash
# Compare different temperatures
deno task bench --llms "opus@temp=0.1,opus@temp=0.5,opus@temp=0.9"

# Override multiple parameters (use semicolon to separate params within a variant)
deno task bench --llms "gpt-5.2@temp=0.2;maxTokens=8000"

# Compare different thinking budgets (for reasoning models)
deno task bench --llms "opus@thinking=10000;tokens=16384,opus@thinking=16000;tokens=20000"
deno task bench --llms "o3@reasoning=5000,o3@reasoning=20000"

# Use named profiles from config
deno task bench --llms "opus@profile=conservative,opus@profile=creative"
```

### Supported Parameters

| Parameter          | Aliases                   | Description                              |
| ------------------ | ------------------------- | ---------------------------------------- |
| `temperature`      | `temp`                    | Generation temperature (0.0-1.0)         |
| `maxTokens`        | `max_tokens`, `tokens`    | Maximum response tokens                  |
| `systemPromptName` | `prompt`, `system_prompt` | Named prompt from config                 |
| `thinkingBudget`   | `thinking`, `reasoning`   | Extended thinking/reasoning token budget |
| `timeout`          | -                         | Request timeout in ms                    |

**Thinking Budget** is supported on:

- **Claude 4.5+**: Extended thinking token budget
- **OpenAI o1/o3**: Maps to reasoning effort
- **Gemini**: Thinking token budget for supported models

> **Note**: For Claude extended thinking without streaming, `max_tokens` must be ≤21,333.
> Use `thinking=16000;tokens=20000` for safe non-streaming operation. Higher budgets require streaming support.

### Config File Profiles

Define reusable profiles in `.centralgauge.yml`:

```yaml
# Named system prompts
systemPrompts:
  strict-al:
    content: |
      You are a strict AL code generator for Business Central.
      Only output valid AL code without explanations.

# Named variant profiles
variantProfiles:
  conservative:
    description: "Low temperature for deterministic output"
    config:
      temperature: 0.1
      maxTokens: 4000
  creative:
    description: "Higher temperature for varied solutions"
    config:
      temperature: 0.8
      maxTokens: 8000
      systemPromptName: strict-al
  deep-thinking:
    description: "Extended reasoning for complex tasks"
    config:
      temperature: 0.2
      thinkingBudget: 50000
```

## Debug Logging

Enable debug logging to capture raw LLM requests and responses for analysis:

```bash
# Basic debug logging
deno task bench --llms opus --tasks tasks/*.yml --debug

# Verbose logging with raw responses
deno task bench --llms opus --tasks tasks/*.yml --debug-level verbose

# Custom output directory
deno task bench --llms opus --tasks tasks/*.yml --debug --debug-output ./my-debug
```

Debug output includes:

- Request prompts and parameters
- Raw API responses
- Extracted code blocks
- Compilation results
- Timing information

## Failure Analysis & Verification

Analyze failing benchmark tasks to identify root causes and track model limitations.

First, run a benchmark with verbose debug logging to capture failure details:

```bash
# Run benchmark with verbose debug logging (recommended before verify)
deno task bench --llms opus --tasks tasks/*.yml --debug-level verbose
```

Then analyze the failures:

```bash
# Analyze failures from latest debug session
deno run --allow-all cli/centralgauge.ts verify debug/

# Analyze specific session
deno run --allow-all cli/centralgauge.ts verify debug/ --session 1734567890123

# Filter by failure type
deno run --allow-all cli/centralgauge.ts verify debug/ --filter compile   # Compilation failures only
deno run --allow-all cli/centralgauge.ts verify debug/ --filter test      # Test failures only

# Dry run - show fixes without applying
deno run --allow-all cli/centralgauge.ts verify debug/ --dry-run

# Analyze specific task
deno run --allow-all cli/centralgauge.ts verify debug/ --task CG-AL-E008
```

### Two Analysis Outcomes

The verify command distinguishes between:

1. **Fixable Issues** - Problems in task YAML or test AL files
   - ID conflicts, syntax errors, test logic bugs, task definition issues
   - Interactive prompt: `[A]pply`, `[S]kip`, `[Q]uit` for each fix

2. **Model Knowledge Gaps** - The model lacks AL knowledge, but the test is valid
   - Model doesn't know interfaces don't have IDs
   - Model uses deprecated BC APIs
   - Model misunderstands FlowField syntax
   - Tracked per-model in `model-shortcomings/{model-name}.json` (default folder)

### Model Shortcomings Tracking

Knowledge gaps are deduplicated by AL concept with affected task lists:

```json
{
  "model": "claude-opus-4-5-20251101",
  "shortcomings": [
    {
      "concept": "interface-id-syntax",
      "alConcept": "interface-definition",
      "description": "Model incorrectly adds numeric IDs to interface definitions",
      "correctPattern": "interface \"Name\"",
      "affectedTasks": ["CG-AL-E008", "CG-AL-M015"],
      "occurrences": 2
    }
  ]
}
```

## Agent-Based Benchmarking

Compare different Claude Agent configurations to find the optimal setup for AL code generation.

### Agent Configs

Agent configurations define how the Claude Agent SDK runs tasks. Each agent can have:

- `workingDir` - Directory with CLAUDE.md, skills, and rules
- `allowedTools` - Which tools the agent can use
- `systemPrompt` - Custom or Claude Code preset prompts
- `maxTurns` - Maximum conversation turns

```yaml
# agents/config-b.yml
id: config-b
name: "Config B (Detailed)"
extends: default
workingDir: test-configs/config-b # Points to Claude Code config directory
```

### Running Agent Benchmarks

```bash
# Compare two agent configurations
deno task bench --agents config-a,config-b

# On specific tasks
deno task bench --agents config-a,config-b --tasks "tasks/easy/*.yml"

# With debug output
deno task bench --agents config-a,config-b --debug
```

### Configuration Testing

Create test configurations in `test-configs/`:

```
test-configs/
├── config-a/                    # Minimal guidance
│   ├── CLAUDE.md                # Brief instructions
│   └── .claude/
│       ├── skills/              # Few/no skills
│       └── rules/               # Minimal rules
│
└── config-b/                    # Detailed guidance
    ├── CLAUDE.md                # Full AL language rules
    └── .claude/
        ├── skills/              # AL patterns, examples
        └── rules/               # Naming conventions
```

### Combined Reports

Run both LLM and Agent benchmarks, then generate a unified report:

```bash
# Run LLM benchmark
deno task bench --llms sonnet --tasks "tasks/easy/*.yml" -o results/combined

# Run Agent benchmark (same output directory)
deno task bench --agents config-b --tasks "tasks/easy/*.yml" -o results/combined

# Generate combined HTML report
deno task report results/combined --html
```

The report shows LLM and Agent results together, with agents prefixed as `agent:config-b`.

## Historical Stats & Analytics

Track benchmark results over time with SQLite-based persistence. Compare models, detect regressions, and analyze costs across runs.

```bash
# Import existing JSON results into the database
deno run --allow-all cli/centralgauge.ts stats-import results/

# View recent benchmark runs
deno run --allow-all cli/centralgauge.ts stats-runs

# Filter runs by task set hash (same tasks = comparable results)
deno run --allow-all cli/centralgauge.ts stats-runs --task-set c71a992f

# View performance trend for a specific model
deno run --allow-all cli/centralgauge.ts stats-runs --model anthropic/claude-sonnet-4-20250514

# Compare two models head-to-head
deno run --allow-all cli/centralgauge.ts stats-compare anthropic/claude-sonnet-4 openai/gpt-4o

# Detect performance regressions
deno run --allow-all cli/centralgauge.ts stats-regression --threshold 10

# View cost breakdown by model or task
deno run --allow-all cli/centralgauge.ts stats-cost --group model
deno run --allow-all cli/centralgauge.ts stats-cost --group task
```

### Task Set Hash

The task set hash uniquely identifies which tasks were run in a benchmark. Runs with the same hash tested the same set of tasks, making them directly comparable for model performance analysis. Use `--task-set` to filter and compare runs across identical task sets.

### Reports Filtered by Current Tasks

Generate reports that only include runs matching your current task/test files:

```bash
# Filter by hash of current task files (all tasks)
deno run --allow-all cli/centralgauge.ts report-from-db --current-tasks

# Filter by specific task patterns
deno run --allow-all cli/centralgauge.ts report-from-db --current-tasks --tasks "tasks/easy/*.yml"

# Combine with interactive mode (pre-filter, then select runs)
deno run --allow-all cli/centralgauge.ts report-from-db --current-tasks --interactive

# List available task sets to see which hashes have runs
deno run --allow-all cli/centralgauge.ts report-from-db --list-sets
```

This is useful when you've modified task definitions or test files and want to see only the benchmark runs that match the current state of your files.

### Database Location

Stats are stored in `results/centralgauge.db` by default. Use `--db <path>` to specify a different location.

## Supported Providers

| Provider       | Environment Variable   | Example                                |
| -------------- | ---------------------- | -------------------------------------- |
| OpenAI         | `OPENAI_API_KEY`       | `openai/gpt-5.2`                       |
| Anthropic      | `ANTHROPIC_API_KEY`    | `anthropic/claude-4.5-opus`            |
| Google Gemini  | `GOOGLE_API_KEY`       | `gemini/gemini-3-pro-preview`          |
| Azure OpenAI   | `AZURE_OPENAI_API_KEY` | `azure/gpt-5.2`                        |
| OpenRouter     | `OPENROUTER_API_KEY`   | `openrouter/anthropic/claude-4.5-opus` |
| Local (Ollama) | -                      | `local/codellama`                      |

### Listing Available Models

View all models supported by a specific provider:

```bash
# List all OpenAI models
deno task start models --provider openai

# List all Anthropic models
deno task start models --provider anthropic

# List all available providers and models
deno task start models
```

The `--provider` output shows:

- Base models supported by the adapter
- Aliases that map to full model names
- Usage examples

### Model Validation

Invalid models are detected before benchmarks start:

```bash
$ deno task bench --llms "openai/gpt-99-nonexistent"

Error: Invalid model specification(s)

  openai/gpt-99-nonexistent
  └─ Model 'gpt-99-nonexistent' not supported by openai provider
     Did you mean: gpt-4o, gpt-5.2, gpt-5-pro?
     Available openai models: gpt-5.1, gpt-5.2, gpt-5-pro, gpt-4o, ...

Use --list-models to see all available models.
```

## Contributing

We welcome contributions! Feel free to open issues or submit a PR.

## License

MIT © [SShadowS](https://github.com/SShadowS)
