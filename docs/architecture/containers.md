# Container Providers

Container providers manage Business Central containers for compilation and test execution. CentralGauge abstracts container operations through a provider interface.

## Provider Registry

The `ContainerProviderRegistry` manages provider instances:

```typescript
import { ContainerProviderRegistry } from "../src/container/registry.ts";

// Get a specific provider
const provider = ContainerProviderRegistry.create("bccontainer");

// Auto-detect best available provider
const bestProvider = await ContainerProviderRegistry.getDefault();

// List available providers
const providers = ContainerProviderRegistry.list();
// ["bccontainer", "docker", "mock"]
```

## Available Providers

| Provider      | Platform | Description                              |
| ------------- | -------- | ---------------------------------------- |
| `bccontainer` | Windows  | Uses bccontainerhelper PowerShell module |
| `docker`      | All      | Direct Docker API calls                  |
| `mock`        | All      | Testing mock (no real container)         |

### Auto-Detection

`getDefault()` auto-detects the best provider:

1. **bccontainer** - Windows only, checks for bccontainerhelper module
2. **docker** - All platforms, checks `docker --version`
3. **mock** - Fallback when no real containers available

## Provider Interface

All providers implement `ContainerProvider`:

```typescript
interface ContainerProvider {
  readonly name: string;

  // Lifecycle
  setup(config: ContainerConfig): Promise<void>;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  remove(name: string): Promise<void>;

  // Operations
  compile(name: string, projectPath: string): Promise<CompilationResult>;
  runTests(
    name: string,
    extensionId: string,
    testCodeunitId?: number,
  ): Promise<TestResult>;

  // Status
  status(name: string): Promise<ContainerStatus>;
  isHealthy(name: string): Promise<boolean>;
}
```

## Configuration

### ContainerConfig

```typescript
interface ContainerConfig {
  name: string;
  bcVersion: string;
  memoryLimit: string;
  acceptEula: boolean;
  includeAL: boolean;
  includeTestToolkit: boolean;
  credentials?: ContainerCredentials;
}

interface ContainerCredentials {
  username: string;
  password: string;
}
```

### Example Configuration

```yaml
# .centralgauge.yml
container:
  provider: bccontainer
  name: Cronus28
  bcVersion: "27.0"
  memoryLimit: 8G
  credentials:
    username: admin
    password: admin
```

## bccontainerhelper Provider

The recommended provider for Windows. Uses the bccontainerhelper PowerShell module.

### Prerequisites

```powershell
# Install bccontainerhelper
Install-Module -Name bccontainerhelper -Force

# Create a container
$cred = New-Object PSCredential 'admin', (ConvertTo-SecureString 'admin' -AsPlainText -Force)
New-BcContainer -containerName Cronus28 -credential $cred -artifactUrl (Get-BCArtifactUrl -country us -version 27) -includeTestToolkit
```

### Operations

```typescript
const provider = ContainerProviderRegistry.create("bccontainer");

// Check status
const status = await provider.status("Cronus28");
console.log(status.isRunning, status.health);

// Compile AL project
const compileResult = await provider.compile("Cronus28", "U:/Git/MyProject");
console.log(compileResult.success, compileResult.errors);

// Run tests
const testResult = await provider.runTests(
  "Cronus28",
  "12345678-1234-1234-1234-123456789012",
);
console.log(testResult.passedTests, testResult.failedTests);
```

### Credentials

Set container credentials:

```typescript
const provider = ContainerProviderRegistry.create(
  "bccontainer",
) as BcContainerProvider;
provider.setCredentials("Cronus28", {
  username: "admin",
  password: "admin",
});
```

## Docker Provider

Direct Docker API integration for non-Windows platforms or custom setups.

### Usage

```typescript
const provider = ContainerProviderRegistry.create("docker");

await provider.setup({
  name: "my-bc-container",
  bcVersion: "24.0",
  memoryLimit: "8G",
  acceptEula: true,
  includeAL: true,
  includeTestToolkit: true,
});
```

## Mock Provider

For testing without real containers:

```typescript
const provider = ContainerProviderRegistry.create("mock");

// Returns success by default
const result = await provider.compile("mock", "/path/to/project");
// result.success === true

// Configure mock responses
(provider as MockContainerProvider).setCompileResult({
  success: false,
  errors: [{ code: "AL0001", message: "Syntax error", ... }],
});
```

## Result Types

### CompilationResult

```typescript
interface CompilationResult {
  success: boolean;
  errors: CompilationError[];
  warnings: CompilationWarning[];
  output: string;
  duration: number; // milliseconds
  artifactPath?: string; // Path to compiled .app file
}

interface CompilationError {
  code: string; // e.g., "AL0001"
  message: string;
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
}
```

### TestResult

```typescript
interface TestResult {
  success: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number; // milliseconds
  results: TestCaseResult[];
  output: string;
}

interface TestCaseResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}
```

### ContainerStatus

```typescript
interface ContainerStatus {
  name: string;
  isRunning: boolean;
  bcVersion?: string;
  uptime?: number;
  health: "healthy" | "unhealthy" | "starting" | "stopped";
}
```

## Compilation Workflow

```
1. Provider receives projectPath
   │
   ▼
2. Create app.json if missing
   │
   ▼
3. Copy source files to build directory
   │
   ▼
4. Invoke AL compiler in container
   │
   ▼
5. Parse compiler output
   │
   ▼
6. Return CompilationResult
```

### PowerShell Commands (bccontainer)

```powershell
# Compile
Compile-AppInBcContainer -containerName Cronus28 -appProjectFolder $ProjectPath

# Run tests
Run-TestsInBcContainer -containerName Cronus28 -testCodeunitId $CodeunitId
```

## Test Execution Workflow

```
1. Provider receives extensionId and testCodeunitId
   │
   ▼
2. Publish compiled extension
   │
   ▼
3. Invoke test runner in container
   │
   ▼
4. Parse test output
   │
   ▼
5. Return TestResult
```

## Prereq Apps

Some tasks require prerequisite apps. The provider handles:

1. Detecting prereq dependencies
2. Compiling prereqs first
3. Publishing prereqs before main app
4. Including prereqs in app.json dependencies

See `.claude/rules/prereq-apps.md` for details.

## Instance Caching

Providers are cached as singletons:

```typescript
const p1 = ContainerProviderRegistry.create("bccontainer");
const p2 = ContainerProviderRegistry.create("bccontainer");
// p1 === p2 (same instance)

// Clear cache (for testing)
ContainerProviderRegistry.clearInstances();
```

## Creating Custom Providers

To add a new container provider:

### 1. Create Provider Class

```typescript
// src/container/my-provider.ts
import type {
  CompilationResult,
  ContainerConfig,
  ContainerProvider,
  TestResult,
} from "./types.ts";

export class MyContainerProvider implements ContainerProvider {
  readonly name = "my-container";

  async setup(config: ContainerConfig): Promise<void> {
    // Setup implementation
  }

  async start(name: string): Promise<void> {
    // Start implementation
  }

  async stop(name: string): Promise<void> {
    // Stop implementation
  }

  async remove(name: string): Promise<void> {
    // Remove implementation
  }

  async compile(name: string, projectPath: string): Promise<CompilationResult> {
    // Compile implementation
  }

  async runTests(
    name: string,
    extensionId: string,
    testCodeunitId?: number,
  ): Promise<TestResult> {
    // Test implementation
  }

  async status(name: string): Promise<ContainerStatus> {
    // Status implementation
  }

  async isHealthy(name: string): Promise<boolean> {
    // Health check implementation
  }
}
```

### 2. Register Provider

```typescript
// src/container/registry.ts
import { MyContainerProvider } from "./my-provider.ts";

static {
  // ... existing registrations
  this.register("my-container", () => new MyContainerProvider());
}
```

### 3. Update Auto-Detection (Optional)

```typescript
static async detectBestProvider(): Promise<string> {
  // Add to detection chain
  if (await this.isMyContainerAvailable()) {
    return "my-container";
  }
  // ... existing checks
}
```

## Error Handling

Providers throw `ContainerError` for container-specific errors:

```typescript
import { ContainerError } from "../src/errors.ts";

try {
  await provider.compile("Cronus28", projectPath);
} catch (error) {
  if (error instanceof ContainerError) {
    console.log(`Container: ${error.containerName}`);
    console.log(`Operation: ${error.operation}`); // "compile" | "test" | etc.
  }
}
```

## Next Steps

- [LLM Adapters](./llm-adapters.md) - LLM provider integration
- [Agent System](./agents.md) - Autonomous agent execution
- [Architecture Overview](./overview.md) - System design
