# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CentralGauge is an open-source benchmark for evaluating LLMs on AL (Application Language) code generation, debugging, and refactoring for Microsoft Dynamics 365 Business Central. The system provides two-attempt task execution with automated compilation and testing inside isolated BC containers.

## Memory

- Current year is 2025, use this for up-to-date result searches and context
- Don't reference old/deprecated model names in code (e.g., avoid claude-3.5, gpt-4, gemini-1.5). Use current model aliases like sonnet, gpt-4o, gemini instead.

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

- Container name: `Cronus27`
- Credentials: `sshadows` / `1234`
- Health check URL: `http://Cronus27/BC/?tenant=default` (check if login page loads to verify container is up)

## Project Structure

| Directory | Purpose                                                                     |
| --------- | --------------------------------------------------------------------------- |
| `cli/`    | CLI commands (Cliffy), helpers, TUI                                         |
| `src/`    | Core library (LLM adapters, container providers, task execution)            |
| `tests/`  | Unit and integration tests mirroring `src/` structure                       |
| `tasks/`  | Task YAML definitions organized by difficulty (`easy/`, `medium/`, `hard/`) |
| `mcp/`    | MCP server for AL tools                                                     |
| `docs/`   | Architecture documentation                                                  |

Key modules in `src/`:

- `llm/` - LLM adapters with registry and pooling
- `container/` - BC container providers with auto-detection
- `tasks/` - Task execution and transformation
- `parallel/` - Parallel execution orchestration
- `config/` - Configuration loading and merging
- `rules/` - Markdown rules generation from shortcomings
- `errors.ts` - Structured error hierarchy

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

| Pattern          | Rule File             | Key Concepts                                                           |
| ---------------- | --------------------- | ---------------------------------------------------------------------- |
| Error Handling   | `error-handling.md`   | `CentralGaugeError` hierarchy, `isRetryableError()`, `getRetryDelay()` |
| Registry Pattern | `registry-pattern.md` | LLM/container registries, pooling, auto-detection                      |
| Testing Patterns | `testing-patterns.md` | Mock factories, `MockEnv`, `EventCollector`                            |
| Async Generators | `async-generators.md` | Return value handling, manual iteration                                |
| Prereq Apps      | `prereq-apps.md`      | Task dependencies, ID ranges                                           |
| Docker Sandbox   | `docker-sandbox.md`   | Container isolation, MCP HTTP transport, workspace mapping             |

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
# Run with specific models
deno task start bench --llms sonnet gpt-4o --tasks "tasks/easy/*.yml"
```

### Agent Benchmarks

Use `bench --agents` for all agent benchmarking (consolidated command):

```bash
# Single agent
deno task start bench --agents universal-test --tasks "tasks/**/*.yml"

# Multiple agents for comparison
deno task start bench --agents agent1 agent2 --output results

# With sandbox mode (isolated Windows containers)
deno task start bench --agents universal-test --sandbox --container Cronus27

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

Tests must be run using the configured tasks (which include `--allow-all` flag):

```bash
deno task test        # Full test suite
deno task test:unit   # Unit tests only
```

Do NOT run `deno test` directly - it lacks the required permissions for filesystem and environment access.

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
