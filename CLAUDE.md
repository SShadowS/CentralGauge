# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CentralGauge is an open-source benchmark for evaluating LLMs on AL (Application Language) code generation, debugging, and refactoring for Microsoft Dynamics 365 Business Central. The system provides two-attempt task execution with automated compilation and testing inside isolated BC containers.

## Memory

- Current year is 2026; today's date is the source of truth for "recent" model releases.
- Don't hardcode model IDs in code. Use the catalog (`site/catalog/models.yml`) or
  `deno task start models -p <provider> --live` to discover current names.
  Verify availability with `deno task start models <slug> --check` before running benchmarks.

Subsystem notes load on demand from path-scoped rule files: bench infra retry, drain and
bench lock (`bench-infra-retry.md`), refusal fallbacks, shared execution units, invocation
profile / batch / upstream lock, BC container quirks, ingest + site + Wrangler, lifecycle.
See the table under Architecture Patterns.

## Technology Stack

- **CLI Framework**: Cliffy Command (https://cliffy.io/docs@v0.25.4/command) - Use this for CLI argument parsing instead of manual parseArgs

## Environment

- We use Git Bash for shell commands, but use full Windows paths (e.g., `U:\Git\CentralGauge\src\file.ts`) in tool calls (Read, Edit, Write, Glob, Grep).
- `jq` is available for debugging and inspecting JSON files.
- Worktrees branch from `origin/master`, which often lags local `master`
  (local commits aren't always pushed). A fresh worktree may miss recent
  local work — `git merge master` inside the worktree if a needed feature
  is absent.
- After `deno update`/`deno update --latest`: it rewrites `deno.json` + the
  root `package.json` but NOT `package-lock.json` (Deno owns `deno.lock`, not
  npm's lockfile). Run `npm install` at repo root to re-sync, or Site CI's root
  `npm ci` (`site-ci.yml`, `working-directory: .`) fails with `EUSAGE: lock
  file ... does not satisfy`. The root `package.json` (`centralgauge-types`) is
  a type-only shim so `site/` svelte-check resolves npm types (zod) across the
  Deno↔node `import type` boundary — keep its versions == the Deno-side ones.
  (Node SDK ambient types can also flip `setTimeout`/`setInterval` return types
  from `number` to `Timeout`; type timer fields as `ReturnType<typeof setTimeout>`.)

## Local BC Container

- Available containers: `Cronus28`, `Cronus281`, `Cronus282`, `Cronus283`, `Cronus284`, `Cronus285`
  (use `--containers Cronus28,Cronus281` for parallel compile/test)
- Credentials: `sshadows` / `1234`
- Health check URL: `http://Cronus28/BC/?tenant=default` (check if login page loads to verify container is up)
- **Docker context is pinned, not inherited** (`src/container/docker-context.ts`).
  BC containers exist only under Docker Desktop's `desktop-windows` context, and
  that context is global machine state that flips (a Desktop restart, an update,
  someone switching to Linux containers). A flipped context makes `docker inspect
  Cronus28` and BCH's `Test-BcContainer` both report a healthy container as
  absent, and the bench then fails with the misleading `Container "Cronus28" is
  not running`. So every Windows-container subprocess we spawn sets
  `DOCKER_CONTEXT` explicitly: our own `docker inspect`, the one-shot `pwsh`, the
  warm pwsh session slot (BCH shells out to `docker`, so the pin has to reach the
  pwsh process), and the agent sandbox provider. The context is resolved once per
  process and only pinned when `docker context ls` shows it exists, so a Windows
  host running plain Docker without Desktop is unaffected. Escape hatches:
  `CENTRALGAUGE_DOCKER_CONTEXT=<name>` pins a different context,
  `CENTRALGAUGE_DOCKER_CONTEXT=` (set and empty) pins nothing and inherits the
  machine's. Ad-hoc operator commands are NOT covered - keep prefixing those with
  `DOCKER_CONTEXT=desktop-windows`.

## bccontainerhelper config quirks

Pinned version, BCH execution settings, SOAP harness, compiler cache and folder adoption:
`.claude/rules/bc-container-quirks.md` (loads when working under `src/container/`, bench
commands, container tests or PowerShell scripts). Never split `prepareCandidateApp` back
into separate cleanup + publish calls on the hot path.

## Ingest Pipeline & Site

Bench results auto-ingest to the production scoreboard at
`https://centralgauge.sshadows.workers.dev` (Cloudflare Worker + D1 + R2).
Disable with `--no-ingest`.

Details (canonical URL, run exclusion, catalog auto-seed, task-set hash scope, taxonomy,
Wrangler, cohort metrics, cache rules, catalog sync, worker tests): `.claude/rules/site-ingest.md`.

### Deploy order (always applies)

- **Migrations BEFORE deploy — strict ordering.** `npm run deploy` is bare
  `wrangler deploy` and does NOT apply D1 migrations. A new worker that SELECTs
  a column added by an unapplied migration 500s on every request (e.g. the
  leaderboard query references `mf.open_weight` unconditionally — added by
  migration `0011_family_open_weight.sql` in the Phase-3 leaderboard work). When
  a change adds a migration, the prod deploy order is: (1) `wrangler d1
  migrations apply <db> --remote` → (2) `centralgauge sync-catalog --apply` (to
  backfill the new column from `site/catalog/*.yml`) → (3) bump the leaderboard
  cache `_cv` if the response shape changed → (4) `cd site && npm run deploy`.
  Never deploy the worker first.

## Lifecycle

Bench -> debug -> analyze -> publish orchestration (`centralgauge cycle`, `lifecycle status`):
`.claude/rules/lifecycle.md`. `docs/site/lifecycle.md` is the full operator guide.

## Code Style

- **Console output**: Use `@std/fmt/colors` (chalk-style) for colored output instead of emojis. Prefer `[Tag]` prefixes with colors over emoji indicators.
- Example: `colors.green("[OK]")` instead of `✅`, `colors.red("[FAIL]")` instead of `❌`

### Cliffy CLI gotchas

- **`--no-X` with `{ default: false }` is a footgun.** Cliffy treats `default: false` as the option's value, so the field is permanently `false` even when the flag is absent. Drop `default` entirely; cliffy's built-in `--no-` inverse handles it (absent → true, present → false).

### Import Conventions

Order imports as:

1. Standard library (`@std/...`)
2. Type imports from project modules
3. Implementation imports from project modules
4. Relative imports

## Architecture Patterns

Detailed pattern documentation lives in `.claude/rules/`. Most files carry `paths` frontmatter and load only when a session works on matching files:

| Pattern           | Rule File                  | Key Concepts                                                              |
| ----------------- | -------------------------- | ------------------------------------------------------------------------- |
| Error Handling    | `error-handling.md`        | `CentralGaugeError` hierarchy, `isRetryableError()`, `getRetryDelay()`    |
| Registry Pattern  | `registry-pattern.md`      | LLM/container registries, pooling, auto-detection                         |
| Testing Patterns  | `testing-patterns.md`      | Mock factories, `MockEnv`, `EventCollector`                               |
| Async Generators  | `async-generators.md`      | Return value handling, manual iteration                                   |
| Prereq Apps       | `prereq-apps.md`           | Task dependencies, ID ranges                                              |
| Docker Sandbox    | `docker-sandbox.md`        | Container isolation, MCP HTTP transport, workspace mapping                |
| MCP Debug Logging | `mcp-debug-logging.md`     | `sandbox-debug.log` for diagnosing `al_verify` failures                   |
| Detailed Errors   | `detailed-error-output.md` | `AgentExecutionResult.failureDetails` schema for sandbox failures         |
| SOAP Test Harness | `soap-test-harness.md`     | Hybrid test execution, TestPage routing, headless web-service runner      |
| Alert Drain       | `alert-drain-rebalance.md` | Container-alert drain + rebalance + quarantine wrap + free-requeue waiver |
| Bench infra retry | `bench-infra-retry.md`     | Zero-tests infra, inline infra retry, drain summary, exclusive bench lock |
| Refusal fallback  | `refusal-fallback.md`      | Server-side fallback beta, `servedModel`, `fallbackEvents[]`, pricing gap  |
| Shared execution  | `shared-execution.md`      | `src/parallel/shared/` units, attempt prompt + provider fields            |
| Invocation profile| `invocation-profile.md`    | Settings hash, `invocation_mode`, batch mode, OpenRouter upstream lock    |
| BC container      | `bc-container-quirks.md`   | BCH pin, execution settings, SOAP path, compiler cache and adoption       |
| Site + ingest     | `site-ingest.md`           | Ingest, Wrangler, leaderboard metrics, cache keys, catalog sync, worker tests |
| Lifecycle         | `lifecycle.md`             | `cycle`, `lifecycle` commands, review surface, weekly CI                  |

## Running Benchmarks

`deno task start bench --help` lists the options; presets live under `benchmarkPresets:` in
`.centralgauge.yml` (`bench --list-presets`). Verify a model with `deno task start models <slug> --check`
before benching. Use `bench --agents` for all agent benchmarking; the `agents run` command is deprecated.

## Benchmark Consistency

LLM and Agent benchmarks MUST report results identically to ensure fair comparison:

- Both show test counts in format: `(score: X, tests: passed/total)`
- Both show full test output when `--debug` is enabled
- Use the same scoring and evaluation logic

When modifying benchmark reporting, always update BOTH paths to maintain parity.

## Development Principles

- TDD: write the failing test first. Unit tests in `tests/unit/`, integration tests in `tests/integration/`.
- Use the helpers in `tests/utils/test-helpers.ts` (see `testing-patterns.md`).
- Avoid over-engineering: no abstractions for one-off use cases, no interface where a function suffices.

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
- **Never run the full `deno task test:unit` while a bench is live** — `tests/unit/container/` publishes/unpublishes on the real Cronus containers and corrupts the running bench's BC NST PSSession (stalls it). Use `deno test --allow-all --ignore=tests/unit/container tests/unit/`, or confirm the bench is stopped first.
- Deno 2.8 makes `Deno.Command` getter-only: mock subprocesses with `Object.defineProperty(Deno, "Command", { value: Mock, configurable: true })`, NOT `Deno.Command = Mock` (throws `which has only a getter`). Such mocks can pass in the full suite yet fail in isolation — they are test-order dependent. Shared helper: `tests/utils/command-mock.ts`.

Do NOT run `deno fmt` on `site/` files — it converts quote style which
conflicts with site's own prettier config.

## Benchmark Tasks

- Never submit real bench runs; always use dry-run mode first and confirm before live submission.
- Keep task difficulty high — do not soften tests to make models pass. If a task is too easy, redesign rather than weaken.
- Validate `prompt_template` and YAML schemas on load (Zod) — silent YAML load failures have repeatedly caused wasted bench runs.
- After authoring tasks, run `sync-catalog --apply` before benching to avoid catalog drift.

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

Run the following after making changes. Scope `fmt`/`check` to the files you
touched — the repo has CRLF/LF drift on Windows, so `deno fmt` over a whole
directory rewrites dozens of unrelated files.

```bash
deno check <changed-files>
deno lint <changed-dirs>
deno fmt <changed-files>
```

## Claude Code automation in this repo

Hooks live in `.claude/hooks/` and are wired in `.claude/settings.json`. All of
them degrade to a silent no-op when `jq` is missing.

| Hook | Event | Behavior |
|---|---|---|
| `deno-fmt-check.sh` | PostToolUse Edit/Write | `deno fmt` + `deno check` on the single changed `.ts` file. Skips `site/` (prettier owns it). Type errors come back as non-blocking context. |
| `guard-bench-lock.sh` | PreToolUse Bash | DENIES container-touching test runs while a bench is live. Escape hatch: `--ignore=tests/unit/container`. |
| `guard-deploy-order.sh` | PreToolUse Bash | ASKS on `wrangler deploy` / `npm run deploy`, restating the migrations-first order. |
| `guard-stale-site-build.sh` | PreToolUse Bash | ASKS when `site/src` is newer than `.svelte-kit/output` and a vitest run is about to use the stale bundle. |

Liveness for the bench guard comes from `src/utils/bench-lock.ts`: `bench`
writes a heartbeat marker at `<output-dir>/.bench-running.json` and refreshes it
every 30 s; anything older than 120 s is treated as a crashed run. Shell
equivalent: `find results/.bench-running.json -mmin -2`.

Repo-specific agents: `al-test-auditor` (task YAML + AL oracle quality),
`worker-pitfall-reviewer` (site/ Cloudflare traps). Repo-specific operator
skills: `/deploy-site`, `/rebench-after-task-change`.

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
