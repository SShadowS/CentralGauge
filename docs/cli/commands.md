# CLI Command Reference

CentralGauge provides a comprehensive CLI for benchmarking, reporting, and analysis.

## Global Options

These options are available for all commands:

| Option          | Description                               |
| --------------- | ----------------------------------------- |
| `-v, --verbose` | Enable verbose output                     |
| `-q, --quiet`   | Disable splash screen and minimize output |
| `--help`        | Show help for command                     |
| `--version`     | Show version                              |

## Commands Overview

| Command          | Description                            |
| ---------------- | -------------------------------------- |
| `bench`          | Run benchmark evaluation               |
| `report`         | Generate reports from results          |
| `report-from-db` | Generate reports from stats database   |
| `verify`         | Analyze and fix failing benchmarks     |
| `rules`          | Generate rules from model shortcomings |
| `models`         | List and test model resolution         |
| `config`         | Configuration management               |
| `stats-*`        | Historical statistics commands         |
| `container`      | Container management                   |
| `compile`        | Compile AL code                        |
| `test`           | Run AL tests                           |

## bench

Run benchmark evaluation on LLMs or agents.

### Usage

```bash
centralgauge bench [options]
```

### Options

| Option                 | Type     | Default        | Description                                |
| ---------------------- | -------- | -------------- | ------------------------------------------ |
| `--preset`             | string   | -              | Load benchmark preset from config          |
| `--list-presets`       | boolean  | false          | List available benchmark presets           |
| `-l, --llms`           | string[] | -              | LLM models to test                         |
| `--agents`             | string[] | -              | Agent configurations to use                |
| `--container`          | string   | Cronus28       | BC container name                          |
| `-s, --sandbox`        | boolean  | false          | Run agents in isolated containers          |
| `-t, --tasks`          | string[] | tasks/**/*.yml | Task file patterns                         |
| `-a, --attempts`       | number   | 2              | Number of attempts per task                |
| `-o, --output`         | string   | results/       | Output directory                           |
| `--temperature`        | number   | 0.1            | LLM temperature                            |
| `--max-tokens`         | number   | 4000           | Maximum tokens per request                 |
| `--debug`              | boolean  | false          | Enable debug logging                       |
| `--debug-output`       | string   | debug/         | Debug output directory                     |
| `--debug-level`        | string   | basic          | Debug log level                            |
| `--container-provider` | string   | auto           | Container provider                         |
| `--sequential`         | boolean  | false          | Disable parallel execution                 |
| `--max-concurrency`    | number   | 10             | Max concurrent LLM calls                   |
| `-f, --format`         | string   | verbose        | Output format                              |
| `--system-prompt`      | string   | -              | Override system prompt                     |
| `--prompt-prefix`      | string   | -              | Prefix for user prompt                     |
| `--prompt-suffix`      | string   | -              | Suffix for user prompt                     |
| `--prompt-stage`       | string   | both           | Apply overrides to stage                   |
| `--prompt-provider`    | string   | -              | Apply overrides to provider                |
| `--knowledge`          | string[] | -              | Markdown files to inject as knowledge bank |
| `--knowledge-dir`      | string   | -              | Directory of .md files to inject           |
| `--run-label`          | string   | auto           | Custom label for this run                  |
| `--no-continuation`    | boolean  | false          | Disable continuation                       |
| `--stream`             | boolean  | false          | Enable streaming mode                      |
| `--json-events`        | boolean  | false          | Output JSON lines                          |
| `--tui`                | boolean  | false          | Enable TUI mode                            |
| `--retry`              | string   | -              | Retry from previous results                |

### Examples

```bash
# Basic LLM benchmark
centralgauge bench --llms sonnet,gpt-4o --tasks "tasks/easy/*.yml"

# Model variants
centralgauge bench --llms "opus@temp=0.1,opus@temp=0.5"

# Agent benchmark
centralgauge bench --agents default --tasks "tasks/**/*.yml" --container Cronus28

# With sandbox
centralgauge bench --agents default --sandbox --container Cronus28

# Retry failed tasks
centralgauge bench --llms sonnet --retry results/benchmark-results-*.json

# TUI mode
centralgauge bench --llms sonnet --tasks "tasks/**/*.yml" --tui

# Knowledge bank injection
centralgauge bench --llms gpt-5 --knowledge model-shortcomings/gpt-5.rules.md

# Guided vs unguided comparison
centralgauge bench --llms gpt-5 --knowledge rules.md --run-label "gpt-5 (guided)"

# List available presets
centralgauge bench --list-presets

# Run with a preset
centralgauge bench --preset flagship-compare

# Override preset values with CLI args
centralgauge bench --preset quick-test --attempts 2
```

## report

Generate reports from benchmark results.

### Usage

```bash
centralgauge report <results-dir> [options]
```

### Arguments

| Argument      | Description                            |
| ------------- | -------------------------------------- |
| `results-dir` | Directory containing benchmark results |

### Options

| Option            | Type    | Default           | Description                            |
| ----------------- | ------- | ----------------- | -------------------------------------- |
| `--html`          | boolean | false             | Generate HTML report                   |
| `-o, --output`    | string  | `reports-output/` | Output directory                       |
| `--save-as`       | string  | -                 | Save file selection as a named dataset |
| `--add-to`        | string  | -                 | Add files to an existing dataset       |
| `--dataset`       | string  | -                 | Generate report from a saved dataset   |
| `--list-datasets` | boolean | false             | List all saved datasets                |

### Examples

```bash
# Generate HTML report (interactive file selection)
centralgauge report results/ --html

# Save selection as a dataset
centralgauge report results/ --html --save-as january-comparison

# List all saved datasets
centralgauge report results/ --list-datasets

# Generate from saved dataset
centralgauge report results/ --dataset january-comparison --html

# Add new files to existing dataset
centralgauge report results/ --add-to january-comparison --html
```

## report-from-db

Generate reports from the stats database.

### Usage

```bash
centralgauge report-from-db [options]
```

### Options

| Option            | Type     | Default                 | Description                     |
| ----------------- | -------- | ----------------------- | ------------------------------- |
| `--db`            | string   | results/centralgauge.db | Database path                   |
| `--html`          | boolean  | false                   | Generate HTML report            |
| `--output`        | string   | -                       | Output directory                |
| `--task-set`      | string   | -                       | Filter by task set hash         |
| `--current-tasks` | boolean  | false                   | Filter by current task files    |
| `--tasks`         | string[] | -                       | Task patterns for current-tasks |
| `--interactive`   | boolean  | false                   | Interactive run selection       |
| `--list-sets`     | boolean  | false                   | List available task sets        |

### Examples

```bash
# Interactive run selection
centralgauge report-from-db --interactive --html

# Filter by current tasks
centralgauge report-from-db --current-tasks --tasks "tasks/easy/*.yml"

# List available task sets
centralgauge report-from-db --list-sets
```

## verify

Analyze and fix failing benchmark tasks.

### Usage

```bash
centralgauge verify <debug-dir> [options]
```

### Arguments

| Argument    | Description                     |
| ----------- | ------------------------------- |
| `debug-dir` | Directory containing debug logs |

### Options

| Option      | Type    | Default | Description                            |
| ----------- | ------- | ------- | -------------------------------------- |
| `--session` | string  | -       | Specific session ID                    |
| `--filter`  | string  | -       | Filter by failure type (compile, test) |
| `--dry-run` | boolean | false   | Show fixes without applying            |
| `--task`    | string  | -       | Analyze specific task                  |

### Examples

```bash
# Analyze failures
centralgauge verify debug/

# Specific session
centralgauge verify debug/ --session 1734567890123

# Dry run
centralgauge verify debug/ --dry-run

# Filter compilation failures
centralgauge verify debug/ --filter compile
```

## rules

Generate markdown rules from model shortcomings JSON files.

### Usage

```bash
centralgauge rules <input> [options]
```

### Arguments

| Argument | Description                          |
| -------- | ------------------------------------ |
| `input`  | Path to model shortcomings JSON file |

### Options

| Option              | Type   | Default          | Description                                   |
| ------------------- | ------ | ---------------- | --------------------------------------------- |
| `-o, --output`      | string | {input}.rules.md | Output file path                              |
| `--min-occurrences` | number | 1                | Only include shortcomings with N+ occurrences |

### Examples

```bash
# Basic usage
centralgauge rules model-shortcomings/gpt-5.2-2025-12-11.json

# Custom output path
centralgauge rules model-shortcomings/gpt-5.2.json -o .claude/rules/gpt-5.2.md

# Only frequent issues (3+ occurrences)
centralgauge rules model-shortcomings/claude-opus.json --min-occurrences 3
```

## models

List and test model resolution.

### Usage

```bash
centralgauge models [spec]
```

### Arguments

| Argument | Description                               |
| -------- | ----------------------------------------- |
| `spec`   | Model specification to resolve (optional) |

### Examples

```bash
# List all models
centralgauge models

# Test alias resolution
centralgauge models sonnet

# Test group resolution
centralgauge models flagship

# Test variant
centralgauge models "opus@temp=0.5"
```

## config

Configuration management commands.

### Subcommands

#### config init

Create a sample configuration file.

```bash
centralgauge config init
```

#### config show

Display effective configuration.

```bash
centralgauge config show
```

#### config validate

Validate configuration file.

```bash
centralgauge config validate
```

## Stats Commands

### stats-import

Import JSON results into the database.

```bash
centralgauge stats-import <results-dir> [options]
```

| Option | Type   | Default                 | Description   |
| ------ | ------ | ----------------------- | ------------- |
| `--db` | string | results/centralgauge.db | Database path |

### stats-runs

View benchmark run history.

```bash
centralgauge stats-runs [options]
```

| Option       | Type   | Default                 | Description             |
| ------------ | ------ | ----------------------- | ----------------------- |
| `--db`       | string | results/centralgauge.db | Database path           |
| `--task-set` | string | -                       | Filter by task set hash |
| `--model`    | string | -                       | Filter by model         |
| `--limit`    | number | 20                      | Maximum runs to show    |

### stats-compare

Compare two models head-to-head.

```bash
centralgauge stats-compare <model1> <model2> [options]
```

| Option       | Type   | Default                 | Description             |
| ------------ | ------ | ----------------------- | ----------------------- |
| `--db`       | string | results/centralgauge.db | Database path           |
| `--task-set` | string | -                       | Filter by task set hash |

### stats-regression

Detect performance regressions.

```bash
centralgauge stats-regression [options]
```

| Option        | Type   | Default                 | Description              |
| ------------- | ------ | ----------------------- | ------------------------ |
| `--db`        | string | results/centralgauge.db | Database path            |
| `--threshold` | number | 10                      | Regression threshold (%) |

### stats-cost

View cost breakdown.

```bash
centralgauge stats-cost [options]
```

| Option    | Type   | Default                 | Description            |
| --------- | ------ | ----------------------- | ---------------------- |
| `--db`    | string | results/centralgauge.db | Database path          |
| `--group` | string | model                   | Group by (model, task) |

## Container Commands

### container status

Check container status.

```bash
centralgauge container status <name>
```

### container start

Start a container.

```bash
centralgauge container start <name>
```

### container stop

Stop a container.

```bash
centralgauge container stop <name>
```

## Compile/Test Commands

### compile

Compile AL code in a container.

```bash
centralgauge compile <project-path> --container <name>
```

### test

Run AL tests in a container.

```bash
centralgauge test <project-path> --container <name> [--codeunit <id>]
```

## Exit Codes

| Code | Description         |
| ---- | ------------------- |
| 0    | Success             |
| 1    | General error       |
| 2    | Invalid arguments   |
| 3    | Configuration error |
| 4    | Container error     |
| 5    | LLM provider error  |

## Environment Variables

See [Configuration](../guides/configuration.md) for environment variable reference.

## Next Steps

- [bench Command](./bench.md) - Detailed bench reference
- [rules Command](./rules.md) - Rules generation reference
- [Running Benchmarks](../guides/running-benchmarks.md) - Usage guide
- [Configuration](../guides/configuration.md) - Config reference
