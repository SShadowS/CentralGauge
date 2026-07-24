# CentralGauge Codebase Structure

## Top level
| Path | Purpose |
|---|---|
| `cli/` | Cliffy CLI, TUI/dashboard, helpers, services |
| `src/` | Core library |
| `site/` | SvelteKit Cloudflare Worker scoreboard (D1 + R2) |
| `tasks/` | Benchmark task YAML (`easy/`, `medium/`, `hard/`) |
| `tests/` | `unit/`, `integration/`, `e2e/`, `utils/`, `al/` (AL test codeunits + prereq apps) |
| `mcp/` | MCP server for AL tools (`al-tools-server.ts`) |
| `docs/` | Architecture docs + mkdocs site + `docs/superpowers/` plans |
| `infra/` | `cg-test-harness/` AL app (SOAP test runner codeunit 50500) |
| `docker/` | `agent-sandbox/` Windows image + entrypoint for agent runs |
| `scripts/` | Repro/microbench/maintenance scripts |
| `agents/`, `model-shortcomings/`, `templates/`, `fixtures/`, `config/` | supporting data |
| `results/`, `reports-output/`, `coverage/`, `dist/` | generated output (not source) |

Root files worth knowing: `main.ts`, `deno.json` (tasks + imports + fmt/lint +
compilerOptions), `.centralgauge.yml` (runtime config), `package.json` +
`package-lock.json` (type-only shim so `site/` svelte-check resolves npm types),
`CLAUDE.md`, `BenchBattleplan.md`, `NewRanking.md`, `Findings.md`, `ROADMAP.md`.

## `src/`
```
agents/        Agent execution (sandboxed Claude Code runs), failure-parser
catalog/       Model/pricing catalog logic
compiler/      AL compilation utilities
config/        ConfigManager, layered config loading
container/     ContainerProvider registry + bc-container-provider, docker, mock,
               bcch-config.ts (BCH version + exec-mode pins), soap-test-client.ts,
               test-routing.ts, bc-script-builders.ts, pwsh-session.ts
doctor/        `doctor ingest` / precheck diagnostics
health/        Container health monitor, signatures, recovery-prober
ingest/        Bench -> scoreboard payload, Ed25519 signing, R2 upload, HTTP client
lifecycle/     bench -> debug -> analyze -> publish orchestration (event-sourced)
llm/           LLM adapters + registry + pooling
logger/        Logging
notifications/ Notification sinks
parallel/      Orchestrator, compile-queue, compile-queue-pool, infra-retry
prompts/       Prompt templates
rules/         Markdown rules generation from model shortcomings
sandbox/       Windows sandbox provider for agent benches
stats/         SQLite storage, schema, hasher, importer
tasks/         Task loading, execution, transformation
templates/     Report templates
tracing/       Span/trace output
utils/, verify/
constants.ts, errors.ts   (error hierarchy: CentralGaugeError + subclasses)
```

## `cli/`
```
centralgauge.ts       Entry point, registers all commands
commands/             bench-command, agents-command, doctor-command,
                      ingest-command, models-command, report-command,
                      report-db-command, stats-command, status-command,
                      sync-catalog-command, sync-taxonomy-command,
                      task-set-command, verify-command, cycle-command,
                      cluster-review-command, digest-command, rules-command,
                      container-command, compile-test-command, config-command,
                      populate-*-command; subdirs bench/, analyze/, report/
dashboard/            Live bench dashboard (state.ts owns the shared health monitor)
helpers/, services/, types/, tui/
```

## `site/`
SvelteKit worker. `src/routes/api/v1/*` endpoints, `src/lib/server/` (tiers,
queries), `migrations/` D1 SQL, `catalog/*.yml` (models, model-families,
pricing, task-categories) synced to D1 via `sync-catalog` / `sync-taxonomy`.

## Conventions
- Each major module has a `mod.ts` barrel that lists types first, then impls.
- Registry pattern for pluggable LLM adapters and container providers
  (`.claude/rules/registry-pattern.md`).
- Tests mirror `src/` layout under `tests/unit/`.
