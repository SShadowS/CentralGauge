# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CentralGauge is an open-source benchmark for evaluating LLMs on AL (Application Language) code generation, debugging, and refactoring for Microsoft Dynamics 365 Business Central. The system provides two-attempt task execution with automated compilation and testing inside isolated BC containers.

## Memory

- Current year is 2026; today's date is the source of truth for "recent" model releases.
- Don't hardcode model IDs in code. Use the catalog (`site/catalog/models.yml`) or
  `deno task start models -p <provider> --live` to discover current names.
  Verify availability with `deno task start models <slug> --check` before running benchmarks.

## Technology Stack

- **Runtime**: Deno 1.44+ with TypeScript 5
- **CLI Framework**: Cliffy Command (https://cliffy.io/docs@v0.25.4/command) - Use this for CLI argument parsing instead of manual parseArgs
- **Container**: bccontainerhelper + Windows NanoServer LCOW
- **Manifest**: YAML 1.2 format for task definitions
- **Reports**: JSON (machine-readable) and HTML (human-readable) with SvelteKit static generation
- **CI/CD**: GitHub Actions with Docker layer caching

## Environment

- We use Git Bash for shell commands, but use full Windows paths (e.g., `U:\Git\CentralGauge\src\file.ts`) in tool calls (Read, Edit, Write, Glob, Grep).
- `jq` is available for debugging and inspecting JSON files.

## Local BC Container

- Available containers: `Cronus28`, `Cronus281`, `Cronus282`, `Cronus283`
  (use `--containers Cronus28,Cronus281` for parallel compile/test)
- Credentials: `sshadows` / `1234`
- Health check URL: `http://Cronus28/BC/?tenant=default` (check if login page loads to verify container is up)

## bccontainerhelper config quirks

- Pinned to **6.1.11** in `bc-container-provider.ts` + `bc-script-builders.ts`
  (6.1.12+ disables PSSession for BC v28+ by default — breaks publish flow).
- `$bcContainerHelperConfig.usePwshForBc24 = $false` is REQUIRED in the bench's
  PowerShell scripts. With `$true`, the cached PSSession loses
  `Get-NavServerInstance` after any `Unpublish-BcContainerApp`, and the next
  `Publish-BcContainerApp` crashes. Don't flip without reproducing the
  multi-unpublish test sequence.

## Project Structure

| Directory | Purpose                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `cli/`    | CLI commands (Cliffy), helpers, TUI                                          |
| `src/`    | Core library (LLM adapters, container providers, task execution)             |
| `tests/`  | Unit and integration tests mirroring `src/` structure                        |
| `tasks/`  | Task YAML definitions organized by difficulty (`easy/`, `medium/`, `hard/`)  |
| `mcp/`    | MCP server for AL tools                                                      |
| `docs/`   | Architecture documentation                                                   |
| `site/`   | SvelteKit Cloudflare Worker scoreboard (D1 + R2) — see Ingest Pipeline below |

Key modules in `src/`:

- `llm/` - LLM adapters with registry and pooling
- `container/` - BC container providers with auto-detection
- `tasks/` - Task execution and transformation
- `parallel/` - Parallel execution orchestration
- `config/` - Configuration loading and merging
- `rules/` - Markdown rules generation from shortcomings
- `ingest/` - Bench → scoreboard payload, Ed25519 signing, R2 blob upload
- `errors.ts` - Structured error hierarchy

## Ingest Pipeline & Site

Bench results auto-ingest to the production scoreboard at
`https://centralgauge.sshadows.workers.dev` (Cloudflare Worker + D1 + R2).
Disable with `--no-ingest`.

- `site/` — SvelteKit Worker. D1 schema in `site/migrations/`, API under `/api/v1/*`
- `src/ingest/` — payload builder, Ed25519 signer, R2 blob uploader, HTTP client w/ backoff
- `centralgauge ingest <results-file>` — manually replay a saved run
- `centralgauge sync-catalog --apply` — reconcile `site/catalog/*.yml` ↔ D1 catalog tables
- Config (URL, keys, machine_id) merged from `.centralgauge.yml` (cwd + home)
- `centralgauge doctor ingest [--llms <list>] [--repair]` — verify config + keys + connectivity + bench-aware catalog state in one signed round-trip. Bench runs this automatically at startup; set `CENTRALGAUGE_BENCH_PRECHECK=0` to disable.

## Lifecycle

Bench → debug → analyze → publish runs as one orchestrated command,
checkpointed against the `lifecycle_events` table in prod D1. State is
**reduced from the event log** — the table is the source of truth.
Full operator + reviewer guide: `docs/site/lifecycle.md`.

- `centralgauge lifecycle status` — per-(model, task_set) lifecycle
  matrix; `--json` is validated against `StatusJsonOutputSchema` for CI.
- `centralgauge cycle --llms <slug>` — orchestrated bench → debug-capture
  → analyze → publish. **Recommended onboarding command for a new
  model.** Resumes from the last successful step; rerunnable safely.
  `--analyzer-model X` overrides the default analyzer
  (default: `lifecycle.analyzer_model` in `.centralgauge.yml` →
  `anthropic/claude-opus-4-6`).
- `centralgauge lifecycle cluster-review` — interactive operator triage
  for the 0.70–0.85 cosine-similarity review band. Concepts are
  append-only; `--split` is the only safe recovery from a bad merge.
- `centralgauge lifecycle digest` — markdown summary of the last N days
  for the weekly CI sticky issue.
- `/admin/lifecycle` — reviewer surface (CF Access + GitHub OAuth).
  Pending-review queue, event timeline, status matrix.
- Weekly CI: `.github/workflows/weekly-cycle.yml` runs Monday 06:00 UTC,
  re-cycles stale models, posts a digest to a sticky GitHub issue.

Configuration knobs in `.centralgauge.yml`:

- `lifecycle.confidence_threshold` (default `0.7`) — entries below
  threshold route to the review queue rather than auto-publishing.
- `lifecycle.cross_llm_sample_rate` (default `0.2`) — fraction of
  analyzer entries re-checked by a second LLM. ~$3 added per release at
  0.2; ~$15 at 1.0.
- `lifecycle.weekly_stale_after_days` (default `7`) — selects which
  models the weekly CI re-cycles.
- `lifecycle.analyzer_model` (default `anthropic/claude-opus-4-6`) —
  override per-cycle via `--analyzer-model`.

**Slug rule.** Every model is vendor-prefixed end-to-end
(`anthropic/claude-opus-4-7`, `openrouter/deepseek/deepseek-v4-pro`).
The legacy `VENDOR_PREFIX_MAP` is gone (Plan B); `verify` writes the
prod slug directly.

**Bench-time precheck.** `centralgauge doctor ingest` runs automatically
at bench startup and verifies config + keys + connectivity + catalog
state in one signed round-trip. Disable via
`CENTRALGAUGE_BENCH_PRECHECK=0` (CI sets this for the lifecycle weekly
cron after the first stale-list lookup, since each `cycle` invocation
would otherwise re-precheck).

### Wrangler / admin API

- Set `CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b` AND
  `CLOUDFLARE_API_TOKEN` (scope `Account.D1:Edit`) for non-interactive shells.
  `wrangler login` doesn't propagate reliably to subshells.
- `/api/v1/admin/*` rate-limits at ~10 req/min — `sync-catalog --apply` for
  7+ rows hits 429; retry after ~60 s pause.
- `task_sets.is_current = 1` is required for leaderboard visibility. Admin
  task-sets endpoint accepts `set_current: true` to flip it atomically.
- Leaderboard `avg_score` is **per-attempt** (averages all `results` rows);
  local bench summary's "Score" column is **per-task** (final score). They
  diverge — same data, different metric.
- `pricing_version` is today UTC `YYYY-MM-DD`. Pre-seed in
  `site/catalog/pricing.yml` + `sync-catalog --apply` to skip the bench's
  interactive pricing prompt for new models.
- Workers KV free tier = **1000 puts/day**, account-wide. Bulk PUT API
  does NOT amortize the quota — each key still counts as 1 write. For
  high-write paths use **Cache API** (`caches.open('...')`, no daily
  quota) or the **Workers Rate Limiting binding**
  (`[[unsafe.bindings]] type=ratelimit`).
- Use `caches.open('<name>')` (named cache), **not** `caches.default`,
  for app-level read caches in the worker. `adapter-cloudflare` also
  reads/writes `caches.default` keyed by URL — entries you put there
  are served back on the next matching request *without invoking your
  handler*, silently bypassing `cachedJson` ETag/304 negotiation.
  `await cache.put(...)` inline (not `ctx.waitUntil`) so the next
  request — and tests — observe the entry deterministically.

## Code Style

- **Console output**: Use `@std/fmt/colors` (chalk-style) for colored output instead of emojis. Prefer `[Tag]` prefixes with colors over emoji indicators.
- Example: `colors.green("[OK]")` instead of `✅`, `colors.red("[FAIL]")` instead of `❌`

### Import Conventions

Order imports as:

1. Standard library (`@std/...`)
2. Type imports from project modules
3. Implementation imports from project modules
4. Relative imports

```typescript
import { assertEquals } from "@std/assert";
import type { LLMConfig } from "../../src/llm/types.ts";
import { LLMAdapterRegistry } from "../../src/llm/registry.ts";
import { helper } from "./utils.ts";
```

### Barrel Exports

Each major module has a `mod.ts` that explicitly lists exports:

```typescript
// Types first
export type { TaskExecutionContext, TaskManifest } from "./interfaces.ts";

// Then implementations
export { TaskExecutor } from "./executor.ts";
```

## Architecture Patterns

Detailed pattern documentation lives in `.claude/rules/`:

| Pattern           | Rule File                  | Key Concepts                                                           |
| ----------------- | -------------------------- | ---------------------------------------------------------------------- |
| Error Handling    | `error-handling.md`        | `CentralGaugeError` hierarchy, `isRetryableError()`, `getRetryDelay()` |
| Registry Pattern  | `registry-pattern.md`      | LLM/container registries, pooling, auto-detection                      |
| Testing Patterns  | `testing-patterns.md`      | Mock factories, `MockEnv`, `EventCollector`                            |
| Async Generators  | `async-generators.md`      | Return value handling, manual iteration                                |
| Prereq Apps       | `prereq-apps.md`           | Task dependencies, ID ranges                                           |
| Docker Sandbox    | `docker-sandbox.md`        | Container isolation, MCP HTTP transport, workspace mapping             |
| MCP Debug Logging | `mcp-debug-logging.md`     | `sandbox-debug.log` for diagnosing `al_verify` failures                |
| Detailed Errors   | `detailed-error-output.md` | `AgentExecutionResult.failureDetails` schema for sandbox failures      |

### Configuration Hierarchy

Configuration loads from multiple sources (highest priority first):

1. CLI arguments
2. Environment variables (`CENTRALGAUGE_*`)
3. `.centralgauge.yml` in current directory
4. `.centralgauge.yml` in home directory
5. Built-in defaults

Use `ConfigManager.loadConfig()` for unified access.

### Discriminated Unions

Use discriminated unions with type guards for multi-outcome results:

```typescript
type Result = SuccessResult | FailureResult;

function isSuccess(r: Result): r is SuccessResult {
  return r.outcome === "success";
}
```

## Running Benchmarks

### LLM Benchmarks

```bash
# Run with specific models (comma-separated)
deno task start bench --llms sonnet,gpt-4o --tasks "tasks/easy/*.yml"

# Reusable presets (defined in .centralgauge.yml under benchmarkPresets:)
deno task start bench --list-presets
deno task start bench --preset flagship-2026-q2

# Verify a model is callable before benching
deno task start models openai/gpt-5.5 --check
```

### Agent Benchmarks

Use `bench --agents` for all agent benchmarking (consolidated command):

```bash
# Single agent
deno task start bench --agents universal-test --tasks "tasks/**/*.yml"

# Multiple agents for comparison
deno task start bench --agents agent1 agent2 --output results

# With sandbox mode (isolated Windows containers)
deno task start bench --agents universal-test --sandbox --container Cronus28

# With debug output for failure details
deno task start bench --agents universal-test --debug
```

**Note:** The `agents run` command is deprecated. Use `bench --agents` instead.

## Benchmark Consistency

LLM and Agent benchmarks MUST report results identically to ensure fair comparison:

- Both show test counts in format: `(score: X, tests: passed/total)`
- Both show full test output when `--debug` is enabled
- Use the same scoring and evaluation logic

When modifying benchmark reporting, always update BOTH paths to maintain parity.

## Development Principles

### TDD (Test-Driven Development)

- Write tests before implementing new functionality
- Follow the Red-Green-Refactor cycle
- Ensure adequate test coverage before refactoring existing code
- Tests live in `tests/unit/` for unit tests and `tests/integration/` for integration tests

### DRY (Don't Repeat Yourself)

- Extract common logic into shared utilities or helpers
- Use test helpers from `tests/utils/test-helpers.ts` for test setup/teardown
- Prefer composition over duplication
- See `.claude/rules/testing-patterns.md` for mock factory patterns

### SOLID (Applied Pragmatically)

Apply SOLID principles where they add clarity, not complexity:

- **Single Responsibility**: Keep modules focused on one concern (e.g., `code-extractor.ts` only extracts code)
- **Open/Closed**: Use interfaces for extension points (e.g., LLM adapters, container providers)
- **Dependency Inversion**: Depend on interfaces for testability (e.g., `ContainerProvider` interface)

Avoid over-engineering: Don't create abstractions for one-off use cases or add interfaces where a simple function suffices.

## Running Tests

Tests must be run using the configured tasks (which include `--allow-all`):

```bash
deno task test:unit   # Unit tests only
deno task test        # Full test suite
```

- **Prefer `deno task test:unit`** for fast feedback
- Do NOT run `deno test` directly — it lacks the required permissions (`--allow-all`) for filesystem and environment access
- Do NOT use `--parallel` — some tests share static state (e.g. `PricingService`) which causes false positives under parallel execution
- After any code change, run `deno check`, `deno lint`, and `deno fmt` as well

### Worker tests (`site/`)

Vitest runs against the built `.svelte-kit/output/` bundle, **not** source.
After editing `site/src/routes/**/*.ts`, run `cd site && npm run build` before
`npm test` or you'll be debugging stale code.

Do NOT run `deno fmt` on `site/` files — it converts quote style which
conflicts with site's own prettier config.

## Writing Task Specifications (YAML)

Task specifications in `tasks/` define what the LLM should generate. Follow these rules:

### Do NOT Add Guiding Notes

The benchmark tests whether models know AL syntax and semantics. **Never** add hints, notes, or guidance that helps the model avoid mistakes:

**BAD** - Guides the model:

```yaml
description: >-
  Create an interface called "Payment Processor" (note: interfaces in AL do not use numeric IDs)
```

**GOOD** - Tests the model's knowledge:

```yaml
description: >-
  Create an interface called "Payment Processor"
```

If a model incorrectly adds an ID to an interface, that's a valid test failure - it shows the model doesn't understand AL interfaces.

### Keep Specifications Clear but Not Instructive

- Describe **what** to build, not **how** to build it
- Specify required names, signatures, and behaviors
- Don't explain AL language rules or syntax
- Don't warn about common mistakes

## Writing AL Tests (for CentralGauge benchmark tasks)

### Never Use Placeholder Assertions

**BAD** - These always pass and test nothing:

```al
[Test]
procedure TestSomething()
begin
    Assert.IsTrue(true, 'This always passes');  // NEVER do this
end;
```

**GOOD** - Verify actual computed values:

```al
[Test]
procedure TestSomething()
var
    Result: Decimal;
begin
    Result := Calculator.Add(2, 3);
    Assert.AreEqual(5, Result, 'Addition should return correct sum');
end;
```

### Test Everything Specified in Task Requirements

If a task YAML specifies specific fields, options, or behaviors, the test MUST verify ALL of them:

- **Option fields**: Test each specified option value (0, 1, 2, etc.)
- **Default values (InitValue)**: Verify with `Insert()` then `Get()`, not just `Init()`
- **Calculated fields (CalcFormula)**: Create related records and verify the sum/count
- **Table relations**: Test that validation works and invalid values are rejected
- **Boundary conditions**: If task mentions thresholds (e.g., "discount for orders > 1000"), test at and around the boundary

### Interface Tests Require Mock Implementations

Interfaces cannot be instantiated directly. Create a mock codeunit:

```al
codeunit 80108 "Mock Payment Processor" implements "Payment Processor"
{
    procedure ProcessPayment(Amount: Decimal; PaymentMethod: Text): Boolean
    begin
        exit(Amount > 0);  // Simple mock logic
    end;
}
```

Then test via the interface variable:

```al
[Test]
procedure TestProcessPayment()
var
    PaymentProcessor: Interface "Payment Processor";
    MockProcessor: Codeunit "Mock Payment Processor";
begin
    PaymentProcessor := MockProcessor;
    Assert.IsTrue(PaymentProcessor.ProcessPayment(100, 'Card'), 'Should process valid payment');
end;
```

### Match Parameter Signatures Exactly

If the task specifies `ProcessPayment(Amount: Decimal; PaymentMethod: Text)`, the test must call it with those exact types. Don't add or remove parameters.

### No Commented-Out Code

Either implement the test properly or remove it. Commented test code suggests incomplete work.

### Use Appropriate Test Libraries

- `Assert` - Basic assertions
- `Library - Sales` / `Library - Inventory` - Create test records
- `Library - Report Dataset` - Test report output
- `Library - Random` - Generate test data
- `TestPage` - Test page behavior

## After Each Change

Run the following commands after making changes:

```bash
deno check
deno lint
deno fmt
```

## Documentation Maintenance

When modifying public interfaces, run the `documentation-engineer` agent to update `docs/`:

**Trigger documentation updates when:**

- Adding, removing, or changing CLI commands (options, arguments, flags)
- Changing public API interfaces or types
- Modifying configuration options or file formats
- Changing task YAML schema or manifest structure
- Updating architecture patterns or data flows
- Modifying agent system behavior or configuration

The docs site auto-deploys via GitHub Actions when `docs/` changes are pushed to master.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
