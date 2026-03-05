# Testing Patterns

This guide covers testing patterns and utilities used in CentralGauge.

## Running Tests

```bash
# Full test suite with coverage
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

**Important:** Always use `deno task test`, not `deno test` directly. The tasks include `--allow-all` for required permissions.

## Test Organization

Tests mirror the source structure:

```
src/
├── llm/
│   ├── registry.ts
│   └── anthropic-adapter.ts
└── tasks/
    └── loader.ts

tests/
├── unit/
│   ├── llm/
│   │   ├── registry.test.ts
│   │   └── anthropic-adapter.test.ts
│   └── tasks/
│       └── loader.test.ts
└── integration/
    └── bc-container-real.test.ts
```

## Test Structure

Use nested test steps:

```typescript
import { assertEquals, assertThrows } from "@std/assert";

Deno.test("FeatureName", async (t) => {
  await t.step("handles normal case", async () => {
    const result = await myFunction("valid input");
    assertEquals(result, expectedValue);
  });

  await t.step("handles edge case", async () => {
    const result = await myFunction("");
    assertEquals(result, null);
  });

  await t.step("throws on invalid input", () => {
    assertThrows(
      () => myFunction(null),
      Error,
      "Input required",
    );
  });
});
```

## Mock Factories

Use factories from `tests/utils/test-helpers.ts`:

### LLM Mocks

```typescript
import {
  createMockLLMConfig,
  createMockLLMResponse,
} from "../utils/test-helpers.ts";

// Default mock config
const config = createMockLLMConfig();

// Override specific fields
const customConfig = createMockLLMConfig({
  provider: "anthropic",
  model: "claude-sonnet-4",
  temperature: 0.5,
});

// Mock response
const response = createMockLLMResponse({
  content: "procedure MyProc() begin end;",
  usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
});
```

### Task Mocks

```typescript
import {
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
  createMockTaskManifest,
} from "../utils/test-helpers.ts";

const manifest = createMockTaskManifest({
  id: "CG-AL-E001",
  max_attempts: 3,
});

const context = createMockTaskExecutionContext({
  llmProvider: "anthropic",
  llmModel: "claude-sonnet-4",
});

const attempt = createMockExecutionAttempt({
  attemptNumber: 2,
  success: false,
  failureReasons: ["Compilation failed"],
});
```

### Container Result Mocks

```typescript
import {
  createMockCompilationError,
  createMockCompilationResult,
  createMockTestCaseResult,
  createMockTestResult,
} from "../utils/test-helpers.ts";

const compileResult = createMockCompilationResult({
  success: false,
  errors: [createMockCompilationError({ message: "Syntax error" })],
});

const testResult = createMockTestResult({
  passed: 5,
  failed: 1,
  testCases: [
    createMockTestCaseResult({ name: "TestAdd", passed: true }),
    createMockTestCaseResult({ name: "TestSub", passed: false }),
  ],
});
```

## MockEnv

Test environment variable handling:

```typescript
import { MockEnv } from "../utils/test-helpers.ts";

Deno.test("uses API key from env", async () => {
  const mockEnv = new MockEnv();

  try {
    mockEnv.set("ANTHROPIC_API_KEY", "test-key-123");
    mockEnv.delete("OPENAI_API_KEY");

    // Test code that reads env vars
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    assertEquals(key, "test-key-123");
  } finally {
    mockEnv.restore(); // Always restore
  }
});
```

## EventCollector

Collect and analyze events:

```typescript
import { EventCollector } from "../utils/test-helpers.ts";

Deno.test("emits correct events", async () => {
  const collector = new EventCollector();

  orchestrator.on(collector.listener);
  await orchestrator.run(tasks);

  // Check event count
  assertEquals(collector.count, 10);

  // Check for specific event types
  assert(collector.hasEventType("task_started"));
  assert(collector.hasEventType("llm_completed"));

  // Get typed events
  const llmEvents = collector.getByType("llm_started");
  assertEquals(llmEvents.length, 3);
  assertEquals(llmEvents[0].model, "sonnet");

  // Get first/last
  const first = collector.getFirst();
  const last = collector.getLast();

  // Reset for next test
  collector.clear();
});
```

## Assertion Helpers

```typescript
import {
  assertThrowsWithMessage,
  assertValidCostEstimate,
  assertValidLLMResponse,
} from "../utils/test-helpers.ts";

// Validate response structure
assertValidLLMResponse(response);
// Checks: content exists, usage fields exist, totalTokens = prompt + completion

// Validate cost
assertValidCostEstimate(cost);
// Checks: is number, non-negative, finite

// Assert error message
await assertThrowsWithMessage(
  () => riskyOperation(),
  "expected error substring",
);
```

## MockALCode

Pre-built AL code for testing:

```typescript
import { MockALCode } from "../utils/test-helpers.ts";

const code = MockALCode.table; // Complete table definition
const page = MockALCode.page; // Complete page definition
const codeunit = MockALCode.codeunit; // Complete codeunit
```

## Temporary Directories

```typescript
import { cleanupTempDir, createTempDir } from "../utils/test-helpers.ts";

Deno.test("writes output files", async () => {
  const tempDir = await createTempDir("my-test");

  try {
    await writeOutput(tempDir);

    const files = Array.from(Deno.readDirSync(tempDir));
    assertEquals(files.length, 1);
  } finally {
    await cleanupTempDir(tempDir);
  }
});
```

## Conditional Tests

Skip tests on specific platforms:

```typescript
const isWindows = Deno.build.os === "windows";

Deno.test({
  name: "bccontainer compiles AL code",
  ignore: !isWindows, // Skip on non-Windows
  fn: async () => {
    // Windows-only test
  },
});
```

## Testing Async Generators

When testing generators with return values:

```typescript
Deno.test("generator returns final result", async () => {
  const gen = myGenerator();

  // Don't use for await...of - it discards return value
  let iterResult = await gen.next();
  while (!iterResult.done) {
    // Process yields
    iterResult = await gen.next();
  }

  // Now we have the return value
  assertExists(iterResult.value);
  assertEquals(iterResult.value.success, true);
});
```

## Testing Error Cases

```typescript
Deno.test("handles errors correctly", async (t) => {
  await t.step("throws on invalid input", () => {
    assertThrows(
      () => validate(null),
      ValidationError,
      "Input is required",
    );
  });

  await t.step("returns error result on failure", async () => {
    const result = await process({ invalid: true });
    assertEquals(result.success, false);
    assertStringIncludes(result.error, "invalid");
  });

  await t.step("retries on transient errors", async () => {
    let attempts = 0;
    const result = await retryable(async () => {
      attempts++;
      if (attempts < 3) throw new Error("Transient");
      return "success";
    });

    assertEquals(attempts, 3);
    assertEquals(result, "success");
  });
});
```

## Integration Tests

Integration tests use real containers (when available):

```typescript
// tests/integration/bc-container-real.test.ts

const hasContainer = await checkContainerExists("Cronus28");

Deno.test({
  name: "compiles AL code in real container",
  ignore: !hasContainer,
  fn: async () => {
    const provider = ContainerProviderRegistry.create("bccontainer");
    const result = await provider.compile("Cronus28", testProjectPath);
    assertEquals(result.success, true);
  },
});
```

## Test Data

Keep test data in `tests/fixtures/`:

```typescript
import { testData } from "../fixtures/provider-responses.ts";

Deno.test("parses provider response", () => {
  const result = parseResponse(testData.anthropicResponse);
  assertEquals(result.model, "claude-sonnet-4");
});
```

## Coverage

Check coverage after tests:

```bash
# Generate coverage
deno task test

# View coverage report
deno task coverage

# Generate HTML report
deno task coverage:html
open coverage/html/index.html
```

## Best Practices

### Isolate Tests

Each test should be independent:

```typescript
// Good - setup/teardown in each test
Deno.test("test A", async () => {
  const data = await setup();
  try {
    // test
  } finally {
    await cleanup(data);
  }
});

// Bad - shared state
let sharedData;
Deno.test("test A", () => {
  sharedData = "from A";
});
Deno.test("test B", () => {
  assertEquals(sharedData, "from A"); // Depends on A
});
```

### Test Edge Cases

```typescript
Deno.test("handles edge cases", async (t) => {
  await t.step("empty input", () => {/* ... */});
  await t.step("null input", () => {/* ... */});
  await t.step("very long input", () => {/* ... */});
  await t.step("special characters", () => {/* ... */});
  await t.step("unicode", () => {/* ... */});
});
```

### Use Descriptive Names

```typescript
// Good
Deno.test("LLMAdapter generates code when given valid prompt", async () => {});
Deno.test("LLMAdapter throws when API key is missing", async () => {});

// Bad
Deno.test("test1", async () => {});
Deno.test("adapter test", async () => {});
```

### Prefer Specific Assertions

```typescript
// Good - specific
assertEquals(result.count, 5);
assertStringIncludes(result.message, "error");
assertArrayIncludes(result.items, ["a", "b"]);

// Bad - generic
assert(result.count === 5);
assert(result.message.includes("error"));
```

## Next Steps

- [Development Setup](./development.md) - Environment setup
- [Code Style](./style.md) - Style conventions
- [API Reference](../api/index.md) - Module documentation
