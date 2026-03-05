# Quick Start

This guide gets you running your first benchmark in under 5 minutes (assuming you have completed the [installation](./installation.md)).

## Prerequisites

- Deno installed
- BC container running (e.g., `Cronus28`)
- At least one LLM API key configured in `.env`

## Your First Benchmark

### 1. Run a Simple Benchmark

Compare Claude and GPT on easy tasks:

```bash
deno task bench --llms sonnet,gpt-4o --tasks "tasks/easy/CG-AL-E001*.yml"
```

This will:

1. Load the task manifest
2. Send prompts to both models
3. Extract AL code from responses
4. Compile the code in your BC container
5. Run tests to verify correctness
6. Display results

### 2. Understanding the Output

During execution, you'll see real-time progress:

```
[Summary] Starting CentralGauge benchmark (parallel mode)...
[Info] Models: anthropic/claude-sonnet-4-20250514, openai/gpt-4o
[Info] Tasks: tasks/easy/CG-AL-E001-basic-table.yml
[Info] Attempts: 2

[Task] CG-AL-E001: Starting with 2 models
[LLM] anthropic/claude-sonnet-4-20250514: attempt 1: success
[LLM] openai/gpt-4o: attempt 1: success
[Compile] anthropic/claude-sonnet-4-20250514: success
[Compile] openai/gpt-4o: success
[LLM] anthropic/claude-sonnet-4-20250514: pass (score: 1.0, tests: 4/4)
[LLM] openai/gpt-4o: pass (score: 1.0, tests: 4/4)
[Task] Complete - Winner: TIE (1.0)

[Summary] Benchmark Summary:
   Total results: 2
   Pass rate: 100.0%
   Average score: 1.0
   Total tokens: 2,847
   Total cost: $0.0142
   Results: results/benchmark-results-1704067200000.json
```

### 3. View the Results File

Open the JSON results file:

```bash
cat results/benchmark-results-*.json | jq '.stats'
```

```json
{
  "totalTokens": 2847,
  "totalCost": 0.0142,
  "overallPassRate": 1.0,
  "averageScore": 1.0,
  "passRate1": 1.0,
  "passRate2": 0
}
```

### 4. Generate an HTML Report

Create a visual report from your results:

```bash
deno task report results/ --html --output reports/
```

Open `reports/index.html` in your browser to see:

- Model comparison charts
- Task-by-task breakdown
- Cost analysis
- Score distributions

## Quick Commands Reference

### Model Aliases

Use short aliases instead of full model names:

```bash
# These are equivalent:
deno task bench --llms sonnet
deno task bench --llms anthropic/claude-sonnet-4-20250514

# Available aliases:
#   opus     -> claude-4.5-opus
#   sonnet   -> claude-sonnet-4
#   gpt-5    -> gpt-5.2
#   gpt-4o   -> gpt-4o
#   gemini   -> gemini-3-pro-preview
#   o3       -> o3
```

### Model Groups

Compare predefined groups of models:

```bash
# Flagship models from each provider
deno task bench --llms flagship

# Best models for coding tasks
deno task bench --llms coding

# Budget-friendly options
deno task bench --llms budget
```

### Task Patterns

Use glob patterns to select tasks:

```bash
# All easy tasks
deno task bench --llms sonnet --tasks "tasks/easy/*.yml"

# All tasks
deno task bench --llms sonnet --tasks "tasks/**/*.yml"

# Specific task
deno task bench --llms sonnet --tasks "tasks/easy/CG-AL-E001-basic-table.yml"
```

### Common Options

```bash
# Enable debug logging
deno task bench --llms sonnet --tasks tasks/easy/*.yml --debug

# Customize temperature
deno task bench --llms sonnet --tasks tasks/easy/*.yml --temperature 0.2

# Limit concurrent requests
deno task bench --llms sonnet --tasks tasks/easy/*.yml --max-concurrency 5

# Sequential mode (disable parallelism)
deno task bench --llms sonnet --tasks tasks/easy/*.yml --sequential
```

## Example Workflows

### Compare Model Temperatures

```bash
deno task bench \
  --llms "sonnet@temp=0.1,sonnet@temp=0.5,sonnet@temp=0.9" \
  --tasks "tasks/easy/*.yml"
```

### Run All Tasks Against Multiple Models

```bash
deno task bench \
  --llms opus,gpt-5,gemini-3-pro \
  --tasks "tasks/**/*.yml" \
  --output results/full-benchmark
```

### Retry Failed Tasks

If some tasks failed due to rate limits or network issues:

```bash
deno task bench \
  --llms sonnet \
  --retry results/benchmark-results-1704067200000.json
```

### Agent Benchmarks

Test autonomous agents instead of single API calls:

```bash
deno task bench \
  --agents default \
  --tasks "tasks/easy/*.yml" \
  --container Cronus28
```

## Next Steps

- [Running Benchmarks](./guides/running-benchmarks.md) - Detailed benchmark guide
- [Model Variants](./guides/model-variants.md) - Advanced model configuration
- [Configuration](./guides/configuration.md) - Customize CentralGauge
- [Task Format](./tasks/task-format.md) - Create your own tasks
