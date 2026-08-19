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

| Command          | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `bench`          | Run benchmark evaluation                                 |
| `ingest`         | Replay a saved results file to the scoreboard API        |
| `sync-catalog`   | Reconcile `site/catalog/*.yml` with production D1 tables |
| `report`         | Generate reports from results                            |
| `report-from-db` | Generate reports from stats database                     |
| `verify`         | Analyze and fix failing benchmarks                       |
| `rules`          | Generate rules from model shortcomings                   |
| `models`         | List and test model resolution                           |
| `config`         | Configuration management                                 |
| `stats-*`        | Historical statistics commands                           |
| `workbench`      | Local authoring dashboard for draft trap-tasks           |
| `container`      | Container management                                     |
| `compile`        | Compile AL code                                          |
| `test`           | Run AL tests                                             |

## bench

Run benchmark evaluation on LLMs or agents.

### Usage

```bash
centralgauge bench [options]
```

### Options

| Option                 | Type     | Default        | Description                                  |
| ---------------------- | -------- | -------------- | -------------------------------------------- |
| `--preset`             | string   | -              | Load benchmark preset from config            |
| `--list-presets`       | boolean  | false          | List available benchmark presets             |
| `-l, --llms`           | string[] | -              | LLM models to test                           |
| `--agents`             | string[] | -              | Agent configurations to use                  |
| `--container`          | string   | Cronus28       | BC container name                            |
| `-s, --sandbox`        | boolean  | false          | Run agents in isolated containers            |
| `-t, --tasks`          | string[] | tasks/**/*.yml | Task file patterns                           |
| `-a, --attempts`       | number   | 2              | Number of attempts per task                  |
| `-o, --output`         | string   | results/       | Output directory                             |
| `--temperature`        | number   | 0.1            | LLM temperature                              |
| `--max-tokens`         | number   | 4000           | Maximum tokens per request                   |
| `--debug`              | boolean  | false          | Enable debug logging                         |
| `--debug-output`       | string   | debug/         | Debug output directory                       |
| `--debug-level`        | string   | basic          | Debug log level                              |
| `--container-provider` | string   | auto           | Container provider                           |
| `--sequential`         | boolean  | false          | Disable parallel execution                   |
| `--max-concurrency`    | number   | 10             | Max concurrent LLM calls                     |
| `-f, --format`         | string   | verbose        | Output format                                |
| `--system-prompt`      | string   | -              | Override system prompt                       |
| `--prompt-prefix`      | string   | -              | Prefix for user prompt                       |
| `--prompt-suffix`      | string   | -              | Suffix for user prompt                       |
| `--prompt-stage`       | string   | both           | Apply overrides to stage                     |
| `--prompt-provider`    | string   | -              | Apply overrides to provider                  |
| `--knowledge`          | string[] | -              | Markdown files to inject as knowledge bank   |
| `--knowledge-dir`      | string   | -              | Directory of .md files to inject             |
| `--run-label`          | string   | auto           | Custom label for this run                    |
| `--no-continuation`    | boolean  | false          | Disable continuation                         |
| `--stream`             | boolean  | false          | Emit real-time progress events                |
| `--json-events`        | boolean  | false          | Output JSON lines                            |
| `--tui`                | boolean  | false          | Enable TUI mode                              |
| `--retry`              | string   | -              | Retry from previous results                  |
| `--runs`               | number   | 1              | Run the full benchmark N times (pass@k)      |
| `--no-ingest`          | boolean  | false          | Skip ingest to scoreboard API                |
| `-y, --yes`            | boolean  | false          | Non-interactive; auto-accept fetched pricing |

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

## ingest

Replay a saved benchmark results file to the scoreboard API.

After a local `bench` run finishes, its results are auto-ingested unless
`--no-ingest` was passed. Use `ingest` to replay a saved file after the
fact (for example, because the network dropped mid-run or the machine
was offline).

### Usage

```bash
centralgauge ingest <path> [options]
```

### Arguments

| Argument | Description                                       |
| -------- | ------------------------------------------------- |
| `path`   | Path to the saved `benchmark-results-*.json` file |

### Options

| Option             | Type    | Default | Description                                  |
| ------------------ | ------- | ------- | -------------------------------------------- |
| `--url`            | string  | -       | Override ingest URL                          |
| `--key-path`       | string  | -       | Override ingest private key path             |
| `--key-id`         | number  | -       | Override ingest key id                       |
| `--machine-id`     | string  | -       | Override machine id                          |
| `--admin-key-path` | string  | -       | Admin key path for catalog writes            |
| `--admin-key-id`   | number  | -       | Admin key id for catalog writes              |
| `--dry-run`        | boolean | false   | Parse + validate only, do not POST           |
| `-y, --yes`        | boolean | false   | Non-interactive; auto-accept fetched pricing |

Credentials default to `~/.centralgauge.yml` (see [config](./config.md)).

### Examples

```bash
# Ingest a saved run (uses ~/.centralgauge.yml)
centralgauge ingest results/benchmark-results-1776819080051.json

# Dry-run (no POST)
centralgauge ingest results/run.json --dry-run

# Non-interactive (auto-accept OpenRouter pricing)
centralgauge ingest results/run.json --yes
```

## sync-catalog

Reconcile `site/catalog/*.yml` with the production D1 catalog tables.
POSTs each model + pricing row through the signed admin API.

### Usage

```bash
centralgauge sync-catalog [options]
```

### Options

| Option             | Type    | Default | Description                             |
| ------------------ | ------- | ------- | --------------------------------------- |
| `--apply`          | boolean | false   | Actually POST rows (default is dry-run) |
| `--url`            | string  | -       | Override ingest URL                     |
| `--key-path`       | string  | -       | Override ingest key path                |
| `--key-id`         | number  | -       | Override ingest key id                  |
| `--machine-id`     | string  | -       | Override machine id                     |
| `--admin-key-path` | string  | -       | Admin key path (required to write)      |
| `--admin-key-id`   | number  | -       | Admin key id (required to write)        |

Families are seeded via D1 SQL at deploy time; `sync-catalog` skips them.

### Examples

```bash
# Preview (no writes)
centralgauge sync-catalog

# Apply to production
centralgauge sync-catalog --apply
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

## Benchmark metrics glossary

| Metric                | Definition                                                                                                | Where it appears          |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Pass rate**         | Tasks passed ÷ tasks attempted (any-of-k attempts within a single run)                                    | All reports               |
| **Pass rate 95% CI**  | Wilson score interval on pass rate. Use to judge if a lead over another model is statistically meaningful | Model card                |
| **pass@k**            | Probability that _at least one_ of k samples passes (HumanEval-style unbiased estimator)                  | Multi-run reports only    |
| **pass^k**            | Probability that _all_ k samples pass (strict reliability)                                                | Multi-run reports only    |
| **Majority@n**        | Fraction of tasks where strictly more than half of n runs pass                                            | Multi-run reports only    |
| **Pass-count stddev** | Sample stddev of per-task pass counts across runs. Higher = flakier                                       | Multi-run reports only    |
| **Consistency**       | Fraction of tasks where every run produced the same outcome (all pass or all fail)                        | Multi-run reports only    |
| **$/Pass**            | Total cost ÷ tasks passed                                                                                 | Model card                |
| **Tokens/Pass**       | Total tokens ÷ tasks passed                                                                               | Model card                |
| **Latency p50/p95**   | Median / 95th-percentile per-task wall time (LLM + compile + test)                                        | Model card, latency chart |

Multi-run metrics require `--runs N` (N ≥ 2) when running `bench`, and are only shown in `report` / `report-from-db` output when multiple runs are present for the same model and task set.

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

## workbench

Local authoring dashboard for draft trap-tasks under `scratch/`.

A trap task pairs a `correct/` reference solution that passes the oracle with a
`naive/` one that fails it. The dashboard asks several models the same question
and shows, per AL object, which of them fell for the trap — so an author can see
at a glance whether a draft actually discriminates before spending a bench run
on it.

### Usage

```bash
centralgauge workbench serve [options]
```

### Options

| Option            | Description                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `--port <number>` | Port to listen on. Omit to let the OS assign an ephemeral one.                                        |
| `--preset <name>` | Pre-fill the model input from a `benchmarkPresets` entry in `.centralgauge.yml`.                      |

An unknown `--preset`, or one defining no models, prints a `[WARN]` and starts
anyway with an empty model input. A typo in a preset name never stops the tool.

### Examples

```bash
# Ephemeral port, empty model input
centralgauge workbench serve

# Fixed port
centralgauge workbench serve --port 4173

# Pre-fill from a preset — quick-test is the free one (mock provider)
centralgauge workbench serve --preset quick-test

# Pre-fill from a real preset (these calls cost money)
centralgauge workbench serve --preset flagship-2026-q2
```

### What the screen shows

One row per AL object, one column per model. Each cell carries a plain-language
verdict rather than a score:

| Label                    | Meaning                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| **Made the mistake**     | The response takes the naive form at a trap site.                    |
| **Avoided the mistake**  | The response takes the correct form at every trap site.              |
| **Different approach**   | Neither form — not wrong, just not either reference.                 |
| **Couldn't compare yet** | No trap sites to compare against; the panel names why.               |
| **Wrote extra object**   | An object the task did not ask for.                                  |
| **not written**          | The object is absent from this response.                             |

"Avoided the mistake" is scoped to the trap and claims nothing else — not that
the response compiles, and not that the rest of it is correct.

When the draft has a `prereq/`, the "Files" rail shows what the selected
response actually referenced from it, scoped to whichever model's column you
last clicked:

| Label                                  | Meaning                                                              |
| --------------------------------------- | --------------------------------------------------------------------- |
| **Made up this field**                  | The referenced name exists in no prereq table (a hallucination).      |
| **Unknown member**                      | The reference couldn't be resolved confidently either way.            |
| **Nothing from prereq/ referenced**     | Analysis ran and found nothing to flag among the references it could resolve. |
| **Couldn't check the prereq**           | Analysis could not run at all; this says nothing about the response.  |

These four labels are pinned verbatim by
`tests/unit/dashboard/vocabulary.test.ts`: keep this table and the UI
identical.

An empty rail is not a verdict that the response is correct. References the
binder cannot resolve are never shown: an unbound variable, anything bound to
a table outside the prereq, `Record <id>` and `array[N] of Record` variables,
chained receivers (`Rec.SubRec.Modify()`), and prereq objects that are not
tables or table extensions. See `docs/task-authoring-guide.md` for the full
list.

### Compiling and testing a response (escalation)

Two ways to check a response, at very different cost:

| Mode | What it does | Cost |
|---|---|---|
| **Ask N models** (above) | Calls each model's API and classifies the response against the trap. Never touches a container. | Seconds. Free with the `mock` provider. |
| **Compile & test** | Publishes the response to a live Business Central container and runs the oracle's tests, escalating to the bench's own fix attempt on a genuine failure. | Minutes. Drives a real container. |

"Compile & test" appears next to each response, and as "Compile & test all"
scoped to every response that produced usable AL.

**Serial and single-container.** Candidates share publish state on one
container, so escalation verifies run one at a time, FIFO: a second click
while one is running queues behind it rather than racing it. Runs target the
default container (`Cronus28`; see CLAUDE.md's Local BC Container section)
unless a caller of `/api/verify` supplies `containerName`, though the
dashboard's own page has no control for that yet.

**Refused entirely while a bench is live.** Publishing to the same container
as a running bench would corrupt that bench's BC NST PSSession, so both
"Compile & test" actions grey out with the reason the moment a bench marker is
found, and `POST /api/verify` itself refuses with `409` carrying that reason.
"Ask N models" is unaffected: it never touches a container.

The verdict an author sees, per response:

| Label | Meaning |
|---|---|
| **Passed first try** | The oracle's tests passed on this container, first attempt. |
| **Passed on 2nd try** | The first attempt failed to compile or failed a test; the bench's own fix attempt then passed. |
| **Failed both tries (n of m tests)** | The first attempt failed, and so did the fix attempt (or none ran). |
| **Didn't compile** | The first attempt's code did not compile. |

None of these say the response is good. They say the oracle's tests passed or
failed, on this container, at this moment (the same honesty rule as "Avoided
the mistake" above), and they say nothing about anything the oracle does not
exercise.

Two more labels describe the container, not the model, and must never be read
as a test result:

| Label | Meaning |
|---|---|
| **Didn't publish: \<reason\>** | The candidate published or installed badly and ran zero tests. Its pass/fail counts would be a scoring convention, not a measurement, so none are shown. |
| **Verification error: \<reason\>** | A genuine infrastructure failure: a dead container, a thrown call. |

Neither means the model failed a test. Treat both as "this response has not
actually been checked yet" and re-run once the container is healthy.

While a job is in flight it shows **Queued to compile & test**, then
**In progress…**. A job refused before it ever reached a container (a live
bench, or escalation not configured) shows the gate's reason verbatim.

**Mismatched identity badge.** Two objects merge into one matrix row when they
share a kind and either the same id or the same normalized name. When they
merge, the field that did NOT decide the merge can still disagree between what
the row expects and what a response actually wrote: a model that wrote the
right kind of object under the wrong id, or under a name that is not just a
different spelling. That disagreement renders in-cell as "Asked for: ..."
against "Wrote: ...". A difference only of letter case or whitespace does not
trigger it: AL identifiers are case-insensitive, so that is not a defect.

**Deep links.** Every row in the "Files" rail (`task.yml`, the oracle test,
`correct/`, `naive/`, each file under `prereq/`) is a `vscode://file/...` link
built from the draft's absolute path. Known limitation: the `correct/` and
`naive/` rows link to the directories themselves, and whether VS Code's URI
handler opens a bare directory as a folder has not been verified against a
live install. If clicking one of those two does nothing, that is why. The
file-level links (`task.yml`, the oracle test, each file under `prereq/`)
point at actual files and do not carry this uncertainty.

### Safety properties

- **Binds `127.0.0.1` only.** The server spends API money, so it is never
  reachable off the machine. Cross-origin `POST`s are refused.
- **Never publishes to the scoreboard.** No code path from the dashboard
  reaches `bench`, `ingest`, `src/ingest/` or the config loader, and
  `tests/unit/dashboard/ingest-safety.test.ts` fails the build if one ever does.
  Quick runs are calibration, not benchmark results.
- **Run artifacts stay with the draft**, at
  `scratch/<id>/.runs/<id>-<timestamp>.json`. They deliberately do not use the
  `benchmark-results-*` shape, so a stray `ingest` replay cannot pick one up.

### HTTP endpoints

Served on the bound port for the page's own use:

| Route          | Purpose                                        |
| -------------- | ---------------------------------------------- |
| `GET /`        | The dashboard page                             |
| `GET /api/drafts`   | Drafts discovered under `scratch/`         |
| `GET /api/defaults` | Models resolved from `--preset`            |
| `POST /api/run`     | Run the selected models against a draft    |
| `POST /api/promote-naive` | Promote a response into the draft's `naive/`, replacing what's there |
| `POST /api/verify` | Enqueue one compile-and-test job per response (see "Compiling and testing a response" above). Returns `{jobs: [{model, id}]}`. |
| `GET /api/verify-events` | Server-sent events of every job's outcome, replaying every job this server instance has ever accepted before subscribing the client to live updates. |

Both routes refuse with **`501`** when the server has no verify adapter wired
at all. This is a legitimate mode, not a failure: "Ask N models" works with
containers down or unconfigured. `centralgauge workbench serve` always
supplies a real adapter (`createEscalationVerify`,
`cli/commands/workbench-command.ts`), so this status is not something the
CLI's own `workbench serve` produces today; it documents the endpoint's
contract for any other caller that constructs the server without one.

`POST /api/verify` additionally refuses with **`409`** when a bench is live,
checked before any job is created. The body's `error` carries the gate's
reason verbatim, naming which bench is blocking and when it started.
Publishing to the same container as a running bench would corrupt that
bench's BC NST PSSession. `GET /api/verify-events` does not repeat this
check: opening the event stream is not itself container work, and jobs
already queued are re-checked against the gate individually as their own
turn comes up.

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
- [Task Authoring Guide](../task-authoring-guide.md) - Writing trap tasks with `workbench serve`
- [Running Benchmarks](../guides/running-benchmarks.md) - Usage guide
- [Configuration](../guides/configuration.md) - Config reference
