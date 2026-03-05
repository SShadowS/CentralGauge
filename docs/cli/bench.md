# bench Command

The `bench` command runs benchmark evaluations on LLMs or agents.

## Synopsis

```bash
centralgauge bench [options]
```

Either `--llms` or `--agents` must be specified.

## LLM Benchmarks

### Basic Usage

```bash
centralgauge bench --llms <models> --tasks <patterns>
```

### Model Specification

#### Aliases

```bash
centralgauge bench --llms sonnet,opus,gpt-4o
```

| Alias  | Resolves To          |
| ------ | -------------------- |
| opus   | claude-4.5-opus      |
| sonnet | claude-sonnet-4      |
| gpt-5  | gpt-5.2              |
| gpt-4o | gpt-4o               |
| o3     | o3                   |
| gemini | gemini-3-pro-preview |

#### Groups

```bash
centralgauge bench --llms flagship
```

| Group    | Models                    |
| -------- | ------------------------- |
| flagship | opus, gpt-5, gemini-3-pro |
| coding   | sonnet, gpt-4o            |
| budget   | gpt-4o-mini, gemini-flash |

#### Provider/Model Format

```bash
centralgauge bench --llms anthropic/claude-sonnet-4-20250514,openai/gpt-4o
```

#### Variants

```bash
centralgauge bench --llms "opus@temp=0.5"
centralgauge bench --llms "opus@temp=0.1;tokens=8000"
centralgauge bench --llms "opus@profile=conservative"
```

### Task Patterns

```bash
# All tasks
centralgauge bench --llms sonnet --tasks "tasks/**/*.yml"

# By difficulty
centralgauge bench --llms sonnet --tasks "tasks/easy/*.yml"

# Specific task
centralgauge bench --llms sonnet --tasks "tasks/easy/CG-AL-E001-basic-table.yml"

# Multiple patterns
centralgauge bench --llms sonnet --tasks "tasks/easy/*.yml" "tasks/medium/*.yml"
```

## Agent Benchmarks

### Basic Usage

```bash
centralgauge bench --agents <agent-ids> --tasks <patterns> --container <name>
```

### Agent Specification

```bash
# Single agent
centralgauge bench --agents default --tasks "tasks/easy/*.yml" --container Cronus28

# Multiple agents
centralgauge bench --agents default,minimal --tasks "tasks/**/*.yml" --container Cronus28
```

### Sandbox Mode

Run agents in isolated containers:

```bash
centralgauge bench --agents default --sandbox --container Cronus28
```

## Options

### Model Options

| Option          | Type     | Default | Description            |
| --------------- | -------- | ------- | ---------------------- |
| `-l, --llms`    | string[] | -       | Models to benchmark    |
| `--temperature` | number   | 0.1     | Generation temperature |
| `--max-tokens`  | number   | 4000    | Max response tokens    |

### Agent Options

| Option          | Type     | Default  | Description          |
| --------------- | -------- | -------- | -------------------- |
| `--agents`      | string[] | -        | Agent configurations |
| `--container`   | string   | Cronus28 | BC container name    |
| `-s, --sandbox` | boolean  | false    | Run in sandbox       |

### Task Options

| Option           | Type     | Default        | Description       |
| ---------------- | -------- | -------------- | ----------------- |
| `-t, --tasks`    | string[] | tasks/**/*.yml | Task patterns     |
| `-a, --attempts` | number   | 2              | Attempts per task |

### Execution Options

| Option              | Type    | Default | Description             |
| ------------------- | ------- | ------- | ----------------------- |
| `--sequential`      | boolean | false   | Disable parallelism     |
| `--max-concurrency` | number  | 10      | Max concurrent calls    |
| `--no-continuation` | boolean | false   | Disable continuation    |
| `--stream`          | boolean | false   | Enable streaming        |
| `--retry`           | string  | -       | Retry from results file |

### Output Options

| Option          | Type    | Default  | Description      |
| --------------- | ------- | -------- | ---------------- |
| `-o, --output`  | string  | results/ | Output directory |
| `-f, --format`  | string  | verbose  | Output format    |
| `--json-events` | boolean | false    | JSON line output |
| `--tui`         | boolean | false    | Enable TUI       |
| `-q, --quiet`   | boolean | false    | Minimal output   |

### Debug Options

| Option           | Type    | Default | Description          |
| ---------------- | ------- | ------- | -------------------- |
| `--debug`        | boolean | false   | Enable debug logging |
| `--debug-output` | string  | debug/  | Debug directory      |
| `--debug-level`  | string  | basic   | Log level            |

### Container Options

| Option                 | Type   | Default | Description     |
| ---------------------- | ------ | ------- | --------------- |
| `--container-provider` | string | auto    | Provider to use |

### Prompt Options

| Option              | Type   | Default | Description                            |
| ------------------- | ------ | ------- | -------------------------------------- |
| `--system-prompt`   | string | -       | Override system prompt                 |
| `--prompt-prefix`   | string | -       | Add prefix to prompt                   |
| `--prompt-suffix`   | string | -       | Add suffix to prompt                   |
| `--prompt-stage`    | string | both    | Stage to apply (generation, fix, both) |
| `--prompt-provider` | string | -       | Provider to apply to                   |

### Knowledge Bank Options

| Option            | Type     | Default | Description                                |
| ----------------- | -------- | ------- | ------------------------------------------ |
| `--knowledge`     | string[] | -       | Markdown files to inject as knowledge bank |
| `--knowledge-dir` | string   | -       | Directory of .md files to inject           |
| `--run-label`     | string   | auto    | Custom label for this run                  |

Knowledge files are prepended to the system prompt to provide model-specific guidance. When knowledge is provided without a custom `--run-label`, the run is automatically labeled with "(guided)" suffix for easy comparison in reports.

## Output Formats

### verbose (default)

Full details with progress and summary:

```
[Summary] Starting CentralGauge benchmark...
[Info] Models: anthropic/claude-sonnet-4-20250514
[Info] Tasks: tasks/easy/*.yml

[Task] CG-AL-E001: Starting with 1 models
[LLM] anthropic/claude-sonnet-4-20250514: attempt 1: success
[LLM] anthropic/claude-sonnet-4-20250514: pass (score: 1.0, tests: 4/4)

[Summary] Benchmark Summary:
   Pass rate: 100.0%
   Average score: 1.0
```

### leaderboard

Ranked table format:

```
┌─────┬────────────────────┬──────────┬───────┐
│ Rank│ Model              │ Pass Rate│ Score │
├─────┼────────────────────┼──────────┼───────┤
│ 1   │ claude-sonnet-4    │ 90.0%    │ 0.92  │
│ 2   │ gpt-4o             │ 85.0%    │ 0.87  │
└─────┴────────────────────┴──────────┴───────┘
```

### scorecard

Compact summary:

```
CentralGauge Benchmark Results
==============================
Tasks: 10 | Attempts: 2

Model                    PR1    PR2    Score   Cost
claude-sonnet-4          70%    90%    0.92    $0.12
gpt-4o                   65%    85%    0.87    $0.15
```

### json

Machine-readable JSON:

```json
{
  "results": [...],
  "stats": {...},
  "comparisons": [...]
}
```

## TUI Mode

The TUI provides real-time visualization:

```bash
centralgauge bench --llms sonnet --tasks "tasks/**/*.yml" --tui
```

Features:

- Progress bar
- Active LLM calls
- Compile queue status
- Per-model pass rates
- Error log

## Retry Mode

Resume failed benchmarks:

```bash
# Initial run
centralgauge bench --llms sonnet,gpt-4o --tasks "tasks/**/*.yml" -o results/run1

# Retry missing combinations
centralgauge bench --llms sonnet,gpt-4o --retry results/run1/benchmark-results-*.json
```

Only transient failures (timeouts, rate limits) are retried. Model output failures (compilation, tests) are not.

## Interactive Retry

During execution, transient failures prompt for retry:

```
[Retry] 3 transient failures (timeout, API errors). Retry now? [y/N]
```

Press `y` to retry, `n` to continue.

## Output Files

After completion:

```
results/
├── benchmark-results-1704067200000.json    # Detailed results
└── scores-1704067200000.txt                # Quick summary
```

## Examples

### Compare Models

```bash
centralgauge bench --llms opus,gpt-5,gemini --tasks "tasks/**/*.yml"
```

### Temperature Sweep

```bash
centralgauge bench --llms "sonnet@temp=0.1,sonnet@temp=0.3,sonnet@temp=0.5" --tasks "tasks/**/*.yml"
```

### Reasoning Comparison

```bash
centralgauge bench --llms "opus@reasoning=10000,opus@reasoning=50000" --tasks "tasks/hard/*.yml"
```

### Quick Test

```bash
centralgauge bench --llms mock --tasks "tasks/easy/CG-AL-E001*.yml" -q
```

### Full Benchmark

```bash
centralgauge bench \
  --llms flagship \
  --tasks "tasks/**/*.yml" \
  --attempts 2 \
  --max-concurrency 5 \
  --output results/full-benchmark \
  --debug \
  --debug-level verbose
```

### Agent Comparison

```bash
centralgauge bench \
  --agents default,optimized \
  --tasks "tasks/easy/*.yml" \
  --container Cronus28 \
  --output results/agent-comparison
```

### Knowledge Bank Injection

Inject guidance from markdown files to help models avoid known mistakes:

```bash
# Single knowledge file
centralgauge bench --llms gpt-5 --knowledge model-shortcomings/gpt-5.rules.md

# Multiple files
centralgauge bench --llms gpt-5 --knowledge rules1.md rules2.md tips.md

# Directory of .md files (loaded alphabetically)
centralgauge bench --llms gpt-5 --knowledge-dir .claude/rules/

# Custom run label
centralgauge bench --llms gpt-5 --knowledge rules.md --run-label "gpt-5-custom"
```

### Guided vs Unguided Comparison

Compare model performance with and without guidance:

```bash
# Baseline run (no guidance)
centralgauge bench --llms gpt-5 --tasks "tasks/**/*.yml" -o results/baseline

# Guided run (auto-labeled as "gpt-5 (guided)")
centralgauge bench --llms gpt-5 --knowledge model-shortcomings/gpt-5.rules.md \
  --tasks "tasks/**/*.yml" -o results/guided
```

The guided run automatically gets a "(guided)" suffix in reports, making it easy to compare results.

### Rules + Knowledge Workflow

Generate model-specific rules from shortcomings, then use them to guide benchmarks:

```bash
# 1. Generate rules from benchmark shortcomings
centralgauge rules model-shortcomings/gpt-5.json

# 2. Run guided benchmark with generated rules
centralgauge bench --llms gpt-5 --knowledge model-shortcomings/gpt-5.rules.md

# 3. Compare results to measure improvement
```

## Exit Codes

| Code | Description          |
| ---- | -------------------- |
| 0    | Success              |
| 1    | Error (with results) |
| 2    | Invalid arguments    |

## See Also

- [Running Benchmarks](../guides/running-benchmarks.md)
- [Model Variants](../guides/model-variants.md)
- [Understanding Results](../guides/understanding-results.md)
- [rules Command](./rules.md) - Generate knowledge files from model shortcomings
