# Development Setup

This guide covers setting up a development environment for contributing to CentralGauge.

## Prerequisites

- Deno 1.44+
- Git
- Windows 10/11 or Server (for BC containers)
- Docker Desktop
- bccontainerhelper PowerShell module

## Clone and Setup

```bash
# Clone the repository
git clone https://github.com/SShadowS/CentralGauge.git
cd CentralGauge

# Copy environment file
cp .env.example .env

# Add at least one API key to .env
# ANTHROPIC_API_KEY=sk-ant-...
```

## Development Commands

```bash
# Run with watch mode
deno task dev

# Type checking
deno check cli/centralgauge.ts

# Linting
deno lint

# Formatting
deno fmt

# All checks
deno check && deno lint && deno fmt
```

## Running Tests

```bash
# Full test suite
deno task test

# Unit tests only
deno task test:unit

# Integration tests only
deno task test:integration

# Watch mode
deno task test:watch

# Coverage report
deno task coverage
deno task coverage:html
```

**Important:** Always use `deno task test`, not `deno test` directly. The tasks include required permissions (`--allow-all`).

## Project Structure

```
CentralGauge/
├── cli/                    # CLI commands and helpers
│   ├── commands/           # Command implementations
│   │   ├── bench-command.ts
│   │   ├── report-command.ts
│   │   └── ...
│   ├── helpers/            # Shared utilities
│   └── tui/                # Terminal UI
├── src/                    # Core library
│   ├── llm/                # LLM adapters
│   ├── container/          # Container providers
│   ├── tasks/              # Task execution
│   ├── parallel/           # Orchestration
│   ├── agents/             # Agent system
│   ├── config/             # Configuration
│   └── utils/              # Utilities
├── tests/                  # Test suite
│   ├── unit/               # Unit tests (mirrors src/)
│   ├── integration/        # Integration tests
│   └── utils/              # Test helpers
├── tasks/                  # Task definitions
├── templates/              # Prompt templates
├── agents/                 # Agent configurations
└── docs/                   # Documentation
```

## Coding Standards

### Import Order

```typescript
// 1. Standard library
import { assertEquals } from "@std/assert";

// 2. Type imports
import type { LLMConfig } from "../../src/llm/types.ts";

// 3. Implementation imports
import { LLMAdapterRegistry } from "../../src/llm/registry.ts";

// 4. Relative imports
import { helper } from "./utils.ts";
```

### Barrel Exports

Each module has a `mod.ts` with explicit exports:

```typescript
// src/llm/mod.ts
export type { LLMAdapter, LLMConfig, LLMResponse } from "./types.ts";
export { LLMAdapterRegistry } from "./registry.ts";
```

### Console Output

Use colored output with tag prefixes instead of emojis:

```typescript
import * as colors from "@std/fmt/colors";

// Good
console.log(colors.green("[OK]"), "Task completed");
console.log(colors.red("[FAIL]"), "Task failed");

// Avoid
console.log("✅ Task completed");
console.log("❌ Task failed");
```

### Error Handling

Use the error hierarchy:

```typescript
import { CentralGaugeError, TaskExecutionError } from "../src/errors.ts";

// Good - specific error with context
throw new TaskExecutionError(
  `Compilation failed for ${taskId}`,
  taskId,
  attemptNumber,
  { errors: compilationErrors },
);

// Avoid - generic error
throw new Error("Compilation failed");
```

### TypeScript Strictness

The project uses strict TypeScript settings:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true
  }
}
```

## Adding Features

### New LLM Adapter

1. Create adapter in `src/llm/`:

```typescript
// src/llm/my-adapter.ts
export class MyAdapter implements LLMAdapter {
  readonly name = "my-adapter";
  // ... implementation
}
```

2. Register in `src/llm/registry.ts`:

```typescript
import { MyAdapter } from "./my-adapter.ts";

static {
  this.register("my-adapter", () => new MyAdapter());
}
```

3. Add tests in `tests/unit/llm/my-adapter.test.ts`

4. Export from `src/llm/mod.ts`

### New CLI Command

1. Create command in `cli/commands/`:

```typescript
// cli/commands/my-command.ts
import { Command } from "@cliffy/command";

export function registerMyCommand(cli: Command): void {
  cli.command("my-cmd", "Description")
    .option("-f, --flag", "Flag description")
    .action(async (options) => {
      // Implementation
    });
}
```

2. Register in `cli/commands/mod.ts`:

```typescript
export { registerMyCommand } from "./my-command.ts";
```

3. Add to `cli/centralgauge.ts`:

```typescript
import { registerMyCommand } from "./commands/mod.ts";
registerMyCommand(cli);
```

### New Task Type

1. Create YAML in `tasks/{difficulty}/`:

```yaml
id: CG-AL-E999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: >-
  Your task description
expected:
  compile: true
  testApp: tests/al/easy/CG-AL-E999.Test.al
  testCodeunitId: 80099
metrics:
  - compile_pass
  - tests_pass
```

2. Create test file in `tests/al/{difficulty}/`:

```al
codeunit 80099 "CG-AL-E999 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;
    // ... tests
}
```

3. Validate:

```bash
deno task bench --llms mock --tasks "tasks/easy/CG-AL-E999*.yml"
```

## Testing Guidelines

### Test Organization

Mirror source structure:

```
src/llm/registry.ts      → tests/unit/llm/registry.test.ts
src/tasks/loader.ts      → tests/unit/tasks/loader.test.ts
```

### Test Helpers

Use helpers from `tests/utils/test-helpers.ts`:

```typescript
import {
  createMockLLMConfig,
  createMockTaskManifest,
  EventCollector,
  MockEnv,
} from "../utils/test-helpers.ts";

Deno.test("my test", async () => {
  const mockEnv = new MockEnv();
  try {
    mockEnv.set("API_KEY", "test");
    // Test code
  } finally {
    mockEnv.restore();
  }
});
```

### Mock Factories

```typescript
// Create mock configs with overrides
const config = createMockLLMConfig({ temperature: 0.5 });
const manifest = createMockTaskManifest({ id: "CG-AL-E999" });

// Create mock results
const compileResult = createMockCompilationResult({ success: true });
const testResult = createMockTestResult({ passedTests: 5, failedTests: 0 });
```

## Git Workflow

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation
- `refactor/description` - Code refactoring

### Commit Messages

Follow conventional commits:

```
feat: add OpenRouter adapter support
fix: handle rate limit errors in Anthropic adapter
docs: update CLI reference
refactor: extract code extractor to separate module
test: add unit tests for task loader
```

### Pull Requests

1. Create feature branch
2. Make changes
3. Run all checks: `deno check && deno lint && deno fmt && deno task test`
4. Push and create PR
5. Ensure CI passes
6. Request review

## Debugging

### Debug Logging

Enable debug logging:

```bash
deno task bench --llms sonnet --tasks "tasks/easy/*.yml" --debug --debug-level verbose
```

Check logs in `debug/` directory.

### VS Code Configuration

Recommended `.vscode/settings.json`:

```json
{
  "deno.enable": true,
  "deno.lint": true,
  "deno.unstable": false,
  "[typescript]": {
    "editor.defaultFormatter": "denoland.vscode-deno"
  }
}
```

### Running Specific Tests

```bash
# Run single test file
deno test --allow-all tests/unit/llm/registry.test.ts

# Run tests matching pattern
deno test --allow-all --filter "registry"
```

## Building

### Compile Binary

```bash
# Current platform
deno task build

# Cross-platform
deno task build:all
```

Outputs to `dist/`:

- `centralgauge` (Linux)
- `centralgauge.exe` (Windows)
- `centralgauge-macos` (macOS x64)
- `centralgauge-macos-arm` (macOS ARM)

## Next Steps

- [Testing Patterns](./testing.md) - Test writing guide
- [Code Style](./style.md) - Style conventions
- [Architecture](../architecture/overview.md) - System design
