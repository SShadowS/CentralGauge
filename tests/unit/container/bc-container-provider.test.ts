/**
 * Unit tests for BcContainerProvider
 *
 * These tests verify the BcContainerProvider's behavior by testing:
 * 1. Public interface properties
 * 2. Credential management (in-memory, no PowerShell needed)
 * 3. PowerShell command execution with mocked responses
 * 4. Compilation and test execution logic
 * 5. Error handling scenarios
 *
 * Integration tests in tests/integration/bc-container-real.test.ts
 * cover actual PowerShell execution with real BC containers.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { PwshContainerSession } from "../../../src/container/pwsh-session.ts";
import { createCommandMock } from "../../utils/command-mock.ts";
import { createMockPwshProcess } from "../../utils/mock-pwsh-process.ts";

// =============================================================================
// Provider Properties Tests
// =============================================================================

Deno.test("BcContainerProvider - Provider Properties", async (t) => {
  await t.step('name property returns "bccontainer"', () => {
    const provider = new BcContainerProvider();
    assertEquals(provider.name, "bccontainer");
  });

  await t.step('platform property returns "windows"', () => {
    const provider = new BcContainerProvider();
    assertEquals(provider.platform, "windows");
  });
});

// =============================================================================
// Credential Management Tests (no PowerShell needed)
// =============================================================================

Deno.test("BcContainerProvider - Credential Management", async (t) => {
  await t.step("setCredentials stores credentials for container", () => {
    const provider = new BcContainerProvider();

    // Should not throw
    provider.setCredentials("Container1", {
      username: "user1",
      password: "pass1",
    });
  });

  await t.step(
    "setCredentials can store multiple container credentials",
    () => {
      const provider = new BcContainerProvider();

      provider.setCredentials("Container1", {
        username: "user1",
        password: "pass1",
      });
      provider.setCredentials("Container2", {
        username: "user2",
        password: "pass2",
      });
    },
  );

  await t.step(
    "setCredentials overwrites existing credentials for same container",
    () => {
      const provider = new BcContainerProvider();

      provider.setCredentials("Container1", {
        username: "old_user",
        password: "old_pass",
      });
      provider.setCredentials("Container1", {
        username: "new_user",
        password: "new_pass",
      });
    },
  );
});

// =============================================================================
// Non-Windows Error Tests
// =============================================================================

// These tests verify error handling on non-Windows platforms
const isWindows = Deno.build.os === "windows";

Deno.test({
  name: "BcContainerProvider - throws on non-Windows for start",
  ignore: isWindows, // Only run on non-Windows
  async fn() {
    const provider = new BcContainerProvider();

    await assertRejects(
      async () => await provider.start("TestContainer"),
      Error,
      "BcContainerProvider requires Windows",
    );
  },
});

Deno.test({
  name: "BcContainerProvider - throws on non-Windows for stop",
  ignore: isWindows,
  async fn() {
    const provider = new BcContainerProvider();

    await assertRejects(
      async () => await provider.stop("TestContainer"),
      Error,
      "BcContainerProvider requires Windows",
    );
  },
});

Deno.test({
  name: "BcContainerProvider - throws on non-Windows for remove",
  ignore: isWindows,
  async fn() {
    const provider = new BcContainerProvider();

    await assertRejects(
      async () => await provider.remove("TestContainer"),
      Error,
      "BcContainerProvider requires Windows",
    );
  },
});

Deno.test({
  name: "BcContainerProvider - throws on non-Windows for status",
  ignore: isWindows,
  async fn() {
    const provider = new BcContainerProvider();

    await assertRejects(
      async () => await provider.status("TestContainer"),
      Error,
      "BcContainerProvider requires Windows",
    );
  },
});

Deno.test({
  name: "BcContainerProvider - throws on non-Windows for executeCommand",
  ignore: isWindows,
  async fn() {
    const provider = new BcContainerProvider();

    await assertRejects(
      async () => await provider.executeCommand("TestContainer", "Get-Service"),
      Error,
      "BcContainerProvider requires Windows",
    );
  },
});

Deno.test({
  name: "BcContainerProvider - throws on non-Windows for copyToContainer",
  ignore: isWindows,
  async fn() {
    const provider = new BcContainerProvider();

    await assertRejects(
      async () =>
        await provider.copyToContainer(
          "TestContainer",
          "/local/path",
          "/container/path",
        ),
      Error,
      "BcContainerProvider requires Windows",
    );
  },
});

Deno.test({
  name: "BcContainerProvider - throws on non-Windows for copyFromContainer",
  ignore: isWindows,
  async fn() {
    const provider = new BcContainerProvider();

    await assertRejects(
      async () =>
        await provider.copyFromContainer(
          "TestContainer",
          "/container/path",
          "/local/path",
        ),
      Error,
      "BcContainerProvider requires Windows",
    );
  },
});

// =============================================================================
// ContainerProvider Interface Compliance Tests
// =============================================================================

Deno.test("BcContainerProvider - implements ContainerProvider interface", async (t) => {
  await t.step("has all required methods", () => {
    const provider = new BcContainerProvider();

    // Check that all interface methods exist
    assertEquals(typeof provider.setup, "function");
    assertEquals(typeof provider.start, "function");
    assertEquals(typeof provider.stop, "function");
    assertEquals(typeof provider.remove, "function");
    assertEquals(typeof provider.status, "function");
    assertEquals(typeof provider.compileProject, "function");
    assertEquals(typeof provider.runTests, "function");
    assertEquals(typeof provider.copyToContainer, "function");
    assertEquals(typeof provider.copyFromContainer, "function");
    assertEquals(typeof provider.executeCommand, "function");
    assertEquals(typeof provider.isHealthy, "function");
  });

  await t.step("has required readonly properties", () => {
    const provider = new BcContainerProvider();

    assertEquals(typeof provider.name, "string");
    assertEquals(typeof provider.platform, "string");
    assertEquals(provider.name.length > 0, true);
  });
});

// =============================================================================
// Credential Integration Test (verifies credentials are used in scripts)
// =============================================================================

Deno.test({
  name: "BcContainerProvider - credentials can be set before operations",
  fn() {
    const provider = new BcContainerProvider();

    // Set credentials for different containers
    provider.setCredentials("Dev", {
      username: "devuser",
      password: "devpass",
    });
    provider.setCredentials("Test", {
      username: "testuser",
      password: "testpass",
    });
    provider.setCredentials("Prod", {
      username: "produser",
      password: "prodpass",
    });

    // Overwrite one
    provider.setCredentials("Dev", {
      username: "newdevuser",
      password: "newdevpass",
    });

    // No errors - credentials are stored internally
    // Actual usage is tested in integration tests
  },
});

// =============================================================================
// Constructor and Initialization Tests
// =============================================================================

Deno.test("BcContainerProvider - constructor initializes correctly", async (t) => {
  await t.step("creates new instance without errors", () => {
    const provider = new BcContainerProvider();
    assertEquals(provider instanceof BcContainerProvider, true);
  });

  await t.step("multiple instances are independent", () => {
    const provider1 = new BcContainerProvider();
    const provider2 = new BcContainerProvider();

    provider1.setCredentials("Container1", {
      username: "user1",
      password: "pass1",
    });

    // provider2 should not have Container1's credentials
    // (we can't directly test this without calling methods,
    // but we verify no errors are thrown)
    provider2.setCredentials("Container2", {
      username: "user2",
      password: "pass2",
    });
  });

  await t.step("provider has correct name", () => {
    const provider = new BcContainerProvider();
    assertEquals(provider.name, "bccontainer");
  });

  await t.step("provider has correct platform", () => {
    const provider = new BcContainerProvider();
    assertEquals(provider.platform, "windows");
  });
});

// =============================================================================
// Edge Cases for Credential Management
// =============================================================================

Deno.test("BcContainerProvider - Credential Edge Cases", async (t) => {
  await t.step("handles empty username", () => {
    const provider = new BcContainerProvider();
    provider.setCredentials("Container", { username: "", password: "pass" });
  });

  await t.step("handles empty password", () => {
    const provider = new BcContainerProvider();
    provider.setCredentials("Container", { username: "user", password: "" });
  });

  await t.step("handles special characters in credentials", () => {
    const provider = new BcContainerProvider();
    provider.setCredentials("Container", {
      username: "user@domain.com",
      password: "p@ss!w0rd$%^&*()",
    });
  });

  await t.step("handles unicode in credentials", () => {
    const provider = new BcContainerProvider();
    provider.setCredentials("Container", {
      username: "用户",
      password: "密码123",
    });
  });

  await t.step("handles very long container names", () => {
    const provider = new BcContainerProvider();
    const longName = "Container" + "X".repeat(1000);
    provider.setCredentials(longName, {
      username: "user",
      password: "pass",
    });
  });

  await t.step("handles container names with special characters", () => {
    const provider = new BcContainerProvider();
    provider.setCredentials("Container-With_Special.Name", {
      username: "user",
      password: "pass",
    });
  });
});

// =============================================================================
// Platform Detection Tests
// =============================================================================

Deno.test("BcContainerProvider - Platform Detection", async (t) => {
  await t.step("reports correct platform constant", () => {
    const provider = new BcContainerProvider();
    // Platform should always be 'windows' regardless of actual OS
    // (the actual check happens at runtime)
    assertEquals(provider.platform, "windows");
  });
});

// =============================================================================
// PowerShell Execution Tests (Windows only, with mocking)
// =============================================================================

Deno.test({
  name: "BcContainerProvider - setup installs bccontainerhelper if missing",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      // Mock: module check returns MISSING_MODULE
      mock.mockPowerShell(["Get-Module"], "MISSING_MODULE");

      // Mock: module installation succeeds
      mock.mockPowerShell(["Install-Module"], "MODULE_INSTALLED");

      // Mock: remove existing container
      mock.mockPowerShell(["Get-BcContainer"], "");

      // Mock: create new container
      mock.mockPowerShell(
        ["New-BcContainer"],
        "Container TestContainer created successfully",
      );

      const provider = new BcContainerProvider();
      await provider.setup({
        name: "TestContainer",
        bcVersion: "24.0",
        memoryLimit: "8G",
        acceptEula: true,
        includeAL: true,
        includeTestToolkit: true,
      });

      // Verify Install-Module was called
      assertEquals(mock.wasCalledWith("pwsh", ["Install-Module"]), true);
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - setup skips install if module exists",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      // Mock: module check returns MODULE_AVAILABLE
      mock.mockPowerShell(["Get-Module"], "MODULE_AVAILABLE");

      // Mock: remove existing container (none found)
      mock.mockPowerShell(["Get-BcContainer"], "");

      // Mock: create new container
      mock.mockPowerShell(
        ["New-BcContainer"],
        "Container TestContainer created successfully",
      );

      const provider = new BcContainerProvider();
      await provider.setup({
        name: "TestContainer",
        bcVersion: "24.0",
        memoryLimit: "8G",
        acceptEula: true,
        includeAL: true,
        includeTestToolkit: true,
      });

      // Verify Install-Module was NOT called
      assertEquals(mock.wasCalledWith("pwsh", ["Install-Module"]), false);
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - setup throws on container creation failure",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      // Mock: module check passes
      mock.mockPowerShell(["Get-Module"], "MODULE_AVAILABLE");

      // Mock: remove existing container
      mock.mockPowerShell(["Get-BcContainer"], "");

      // Mock: container creation fails
      mock.mockPowerShellError(
        ["New-BcContainer"],
        "License validation failed",
        1,
      );

      const provider = new BcContainerProvider();

      await assertRejects(
        async () =>
          await provider.setup({
            name: "TestContainer",
            bcVersion: "24.0",
            memoryLimit: "8G",
            acceptEula: true,
            includeAL: true,
            includeTestToolkit: true,
          }),
        Error,
        "Failed to create BC container",
      );
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - start executes correct PowerShell command",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      // Mock: start container succeeds
      mock.mockPowerShell(
        ["Start-BcContainer"],
        "Container TestContainer started",
      );

      const provider = new BcContainerProvider();
      await provider.start("TestContainer");

      // Verify Start-BcContainer was called
      assertEquals(mock.wasCalledWith("pwsh", ["Start-BcContainer"]), true);
      assertEquals(mock.wasCalledWith("pwsh", ["TestContainer"]), true);
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - stop executes correct PowerShell command",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      // Mock: stop container succeeds
      mock.mockPowerShell(
        ["Stop-BcContainer"],
        "Container TestContainer stopped",
      );

      const provider = new BcContainerProvider();
      await provider.stop("TestContainer");

      // Verify Stop-BcContainer was called
      assertEquals(mock.wasCalledWith("pwsh", ["Stop-BcContainer"]), true);
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - remove executes correct PowerShell command",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      // Mock: remove container succeeds
      mock.mockPowerShell(
        ["Remove-BcContainer"],
        "Container TestContainer removed",
      );

      const provider = new BcContainerProvider();
      await provider.remove("TestContainer");

      // Verify Remove-BcContainer was called
      assertEquals(mock.wasCalledWith("pwsh", ["Remove-BcContainer"]), true);
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - status returns container status",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      // Mock: status command returns structured output
      const statusOutput = `
STATUS_START
NAME:TestContainer
RUNNING:True
HEALTH:healthy
BCVERSION:27.0.0.0
UPTIME:3600
STATUS_END
`;
      mock.mockPowerShell(["Get-BcContainer"], statusOutput);

      const provider = new BcContainerProvider();
      const status = await provider.status("TestContainer");

      assertEquals(status.name, "TestContainer");
      assertEquals(status.isRunning, true);
      assertEquals(status.health, "healthy");
      assertEquals(status.bcVersion, "27.0.0.0");
      assertEquals(status.uptime, 3600);
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - status throws for non-existent container",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      // Mock: container not found
      mock.mockPowerShell([], "CONTAINER_NOT_FOUND");

      const provider = new BcContainerProvider();

      await assertRejects(
        async () => await provider.status("NonExistentContainer"),
        Error,
        "Container NonExistentContainer not found",
      );
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - isHealthy returns true for healthy container",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      // Mock: healthy container
      mock.mockPowerShell(["Test-BcContainer"], "HEALTHY:True");

      const provider = new BcContainerProvider();
      const healthy = await provider.isHealthy("TestContainer");

      assertEquals(healthy, true);
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - isHealthy returns false for unhealthy container",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      // Mock: unhealthy container
      mock.mockPowerShell(["Test-BcContainer"], "HEALTHY:False");

      const provider = new BcContainerProvider();
      const healthy = await provider.isHealthy("TestContainer");

      assertEquals(healthy, false);
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - isHealthy returns false on error",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      // Mock: command fails
      mock.mockPowerShellError(["Test-BcContainer"], "Container not found", 1);

      const provider = new BcContainerProvider();
      const healthy = await provider.isHealthy("TestContainer");

      assertEquals(healthy, false);
    } finally {
      mock.restore();
    }
  },
});

// =============================================================================
// Compilation Tests (Windows only, with mocking)
// =============================================================================

Deno.test({
  name:
    "BcContainerProvider - compileProject returns success on successful compilation",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();
    const tempDir = await Deno.makeTempDir();

    try {
      mock.install();

      // Create a minimal project structure
      await Deno.writeTextFile(
        `${tempDir}/app.json`,
        JSON.stringify({ name: "Test", publisher: "Test", version: "1.0.0" }),
      );

      // Mock: create compiler folder (single script with both commands)
      mock.mockPowerShell(
        ["New-BcCompilerFolder"],
        `ARTIFACT_URL:https://example.com\nCOMPILER_FOLDER:C:\\CompilerFolder`,
      );

      // Mock: compilation succeeds
      mock.mockPowerShell(
        ["Compile-AppWithBcCompilerFolder"],
        `COMPILE_SUCCESS\nAPP_FILE:${tempDir}\\output\\TestApp.app`,
      );

      const provider = new BcContainerProvider();
      const result = await provider.compileProject("TestContainer", {
        path: tempDir,
        appJson: {
          name: "TestApp",
          publisher: "TestPublisher",
          version: "1.0.0.0",
        },
        sourceFiles: [`${tempDir}/Hello.al`],
        testFiles: [],
      });

      assertEquals(result.success, true);
      assertEquals(result.errors.length, 0);
      assertStringIncludes(result.output, "COMPILE_SUCCESS");
    } finally {
      mock.restore();
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "BcContainerProvider - compileProject parses compilation errors",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();
    const tempDir = await Deno.makeTempDir();

    try {
      mock.install();

      // Create a minimal project structure
      await Deno.writeTextFile(
        `${tempDir}/app.json`,
        JSON.stringify({ name: "Test", publisher: "Test", version: "1.0.0" }),
      );

      // Mock: create compiler folder (single script with both commands)
      mock.mockPowerShell(
        ["New-BcCompilerFolder"],
        `ARTIFACT_URL:https://example.com\nCOMPILER_FOLDER:C:\\CompilerFolder`,
      );

      // Mock: compilation fails with errors
      const errorOutput = `
COMPILE_ERROR
ERROR:AL0118: The name 'InvalidFunction' does not exist in the current context
DETAIL:test.al(10,5): error AL0118: The name 'InvalidFunction' does not exist
`;
      mock.mockPowerShell(["Compile-AppWithBcCompilerFolder"], errorOutput);

      const provider = new BcContainerProvider();
      const result = await provider.compileProject("TestContainer", {
        path: tempDir,
        appJson: {
          name: "TestApp",
          publisher: "TestPublisher",
          version: "1.0.0.0",
        },
        sourceFiles: [`${tempDir}/test.al`],
        testFiles: [],
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.output, "COMPILE_ERROR");
    } finally {
      mock.restore();
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "BcContainerProvider - compileProject handles system errors gracefully",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();
    const tempDir = await Deno.makeTempDir();

    try {
      mock.install();

      // Create a minimal project structure
      await Deno.writeTextFile(
        `${tempDir}/app.json`,
        JSON.stringify({ name: "Test", publisher: "Test", version: "1.0.0" }),
      );

      // Mock: compiler folder creation fails completely
      mock.mockPowerShellError(
        ["Get-BcContainerArtifactUrl"],
        "Container not running",
        1,
      );

      const provider = new BcContainerProvider();
      const result = await provider.compileProject("TestContainer", {
        path: tempDir,
        appJson: {
          name: "TestApp",
          publisher: "TestPublisher",
          version: "1.0.0.0",
        },
        sourceFiles: [],
        testFiles: [],
      });

      assertEquals(result.success, false);
      assertEquals(result.errors.length, 1);
      assertEquals(result.errors[0]!.code, "SYSTEM");
    } finally {
      mock.restore();
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "BcContainerProvider - compileProject can compile multiple times",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();
    const tempDir = await Deno.makeTempDir();

    try {
      mock.install();

      // Create a minimal project structure
      await Deno.writeTextFile(
        `${tempDir}/app.json`,
        JSON.stringify({ name: "Test", publisher: "Test", version: "1.0.0" }),
      );

      // Mock: create compiler folder
      mock.mockPowerShell(
        ["New-BcCompilerFolder"],
        `ARTIFACT_URL:https://example.com\nCOMPILER_FOLDER:C:\\CompilerFolder`,
      );

      // Mock: compilation succeeds (used by both compilations)
      mock.mockPowerShell(
        ["Compile-AppWithBcCompilerFolder"],
        "COMPILE_SUCCESS\nAPP_FILE:C:\\output\\app.app",
      );

      const provider = new BcContainerProvider();

      // First compilation
      const result1 = await provider.compileProject("TestContainer", {
        path: tempDir,
        appJson: {
          name: "TestApp",
          publisher: "TestPublisher",
          version: "1.0.0.0",
        },
        sourceFiles: [],
        testFiles: [],
      });

      assertEquals(result1.success, true);

      // Second compilation should also succeed
      const result2 = await provider.compileProject("TestContainer", {
        path: tempDir,
        appJson: {
          name: "TestApp",
          publisher: "TestPublisher",
          version: "1.0.0.0",
        },
        sourceFiles: [],
        testFiles: [],
      });

      assertEquals(result2.success, true);
    } finally {
      mock.restore();
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// =============================================================================
// Test Execution Tests (Windows only, with mocking)
// =============================================================================

Deno.test({
  name: "BcContainerProvider - runTests returns success when all tests pass",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();
    const tempDir = await Deno.makeTempDir();

    try {
      mock.install();

      // Create output directory with compiled app
      await Deno.mkdir(`${tempDir}/output`, { recursive: true });
      await Deno.writeTextFile(
        `${tempDir}/output/TestApp.app`,
        "mock app content",
      );

      // Mock: the runTests PowerShell script (contains all operations in one script)
      mock.mockPowerShell(
        ["Run-TestsInBcContainer"],
        `PRECLEAN_SUCCESS\nPUBLISH_SUCCESS\nTEST_START\nALL_TESTS_PASSED\nTEST_END`,
      );

      const provider = new BcContainerProvider();
      provider.setCredentials("TestContainer", {
        username: "admin",
        password: "admin",
      });

      const result = await provider.runTests("TestContainer", {
        path: tempDir,
        appJson: {
          name: "TestApp",
          publisher: "TestPublisher",
          version: "1.0.0.0",
        },
        sourceFiles: [],
        testFiles: [`${tempDir}/Test.al`],
      });

      assertEquals(result.success, true);
    } finally {
      mock.restore();
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "BcContainerProvider - runTests compiles first if no app file exists",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();
    const tempDir = await Deno.makeTempDir();

    try {
      mock.install();

      // Create project structure (no output folder)
      await Deno.writeTextFile(
        `${tempDir}/app.json`,
        JSON.stringify({ name: "Test", publisher: "Test", version: "1.0.0" }),
      );

      // Mock: compiler folder creation
      mock.mockPowerShell(
        ["Get-BcContainerArtifactUrl"],
        "ARTIFACT_URL:https://example.com",
      );

      mock.mockPowerShell(
        ["New-BcCompilerFolder"],
        `COMPILER_FOLDER:C:\\CompilerFolder`,
      );

      // Mock: compilation fails
      mock.mockPowerShell(
        ["Compile-AppWithBcCompilerFolder"],
        "COMPILE_ERROR\nERROR:Syntax error",
      );

      const provider = new BcContainerProvider();

      const result = await provider.runTests("TestContainer", {
        path: tempDir,
        appJson: {
          name: "TestApp",
          publisher: "TestPublisher",
          version: "1.0.0.0",
        },
        sourceFiles: [],
        testFiles: [],
      });

      // Should fail because compilation failed
      assertEquals(result.success, false);
      assertStringIncludes(result.output, "Compilation failed");
    } finally {
      mock.restore();
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "BcContainerProvider - runTests returns failure when publish fails",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();
    const tempDir = await Deno.makeTempDir();

    try {
      mock.install();

      // Create output directory with compiled app
      await Deno.mkdir(`${tempDir}/output`, { recursive: true });
      await Deno.writeTextFile(
        `${tempDir}/output/TestApp.app`,
        "mock app content",
      );

      // Mock: publish fails
      mock.mockPowerShell([], "PUBLISH_FAILED:Unable to sync database");

      const provider = new BcContainerProvider();

      const result = await provider.runTests("TestContainer", {
        path: tempDir,
        appJson: {
          name: "TestApp",
          publisher: "TestPublisher",
          version: "1.0.0.0",
        },
        sourceFiles: [],
        testFiles: [],
      });

      assertEquals(result.success, false);
    } finally {
      mock.restore();
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "BcContainerProvider - runTests returns failure when some tests fail",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();
    const tempDir = await Deno.makeTempDir();

    try {
      mock.install();

      // Create output directory with compiled app
      await Deno.mkdir(`${tempDir}/output`, { recursive: true });
      await Deno.writeTextFile(
        `${tempDir}/output/TestApp.app`,
        "mock app content",
      );

      // Mock: publish succeeds
      mock.mockPowerShell(["Publish-BcContainerApp"], "PUBLISH_SUCCESS");

      // Mock: some tests fail
      mock.mockPowerShell(
        ["Run-TestsInBcContainer"],
        `TEST_START\nSOME_TESTS_FAILED\nTEST_END`,
      );

      const provider = new BcContainerProvider();

      const result = await provider.runTests("TestContainer", {
        path: tempDir,
        appJson: {
          name: "TestApp",
          publisher: "TestPublisher",
          version: "1.0.0.0",
        },
        sourceFiles: [],
        testFiles: [],
      });

      assertEquals(result.success, false);
    } finally {
      mock.restore();
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "BcContainerProvider - runTests uses configured credentials",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();
    const tempDir = await Deno.makeTempDir();

    try {
      mock.install();

      // Create output directory with compiled app
      await Deno.mkdir(`${tempDir}/output`, { recursive: true });
      await Deno.writeTextFile(
        `${tempDir}/output/TestApp.app`,
        "mock app content",
      );

      // Mock: all operations succeed
      mock.mockPowerShell([], "PUBLISH_SUCCESS\nALL_TESTS_PASSED\nTEST_END");

      const provider = new BcContainerProvider();
      provider.setCredentials("TestContainer", {
        username: "customuser",
        password: "custompass",
      });

      await provider.runTests("TestContainer", {
        path: tempDir,
        appJson: {
          name: "TestApp",
          publisher: "TestPublisher",
          version: "1.0.0.0",
        },
        sourceFiles: [],
        testFiles: [],
      });

      // Verify credentials were used in the PowerShell script
      const calls = mock.getCallsFor("pwsh");
      const scriptCall = calls.find((c) =>
        c.args.some((a) => a.includes("customuser") && a.includes("custompass"))
      );
      assertEquals(scriptCall !== undefined, true);
    } finally {
      mock.restore();
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// =============================================================================
// Copy Operations Tests (Windows only, with mocking)
// =============================================================================

Deno.test({
  name: "BcContainerProvider - copyToContainer executes correct command",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      mock.mockPowerShell(
        ["Copy-ToNavContainer"],
        "Copied /local/path to TestContainer:/container/path",
      );

      const provider = new BcContainerProvider();
      await provider.copyToContainer(
        "TestContainer",
        "/local/path",
        "/container/path",
      );

      assertEquals(mock.wasCalledWith("pwsh", ["Copy-ToNavContainer"]), true);
      assertEquals(mock.wasCalledWith("pwsh", ["TestContainer"]), true);
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - copyFromContainer executes correct command",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      mock.mockPowerShell(
        ["Copy-FromNavContainer"],
        "Copied TestContainer:/container/path to /local/path",
      );

      const provider = new BcContainerProvider();
      await provider.copyFromContainer(
        "TestContainer",
        "/container/path",
        "/local/path",
      );

      assertEquals(mock.wasCalledWith("pwsh", ["Copy-FromNavContainer"]), true);
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - executeCommand runs script in container",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      mock.mockPowerShell(
        ["Invoke-ScriptInBcContainer"],
        "Command output here",
      );

      const provider = new BcContainerProvider();
      const result = await provider.executeCommand(
        "TestContainer",
        "Get-Service",
      );

      assertEquals(result.exitCode, 0);
      assertStringIncludes(result.output, "Command output here");
    } finally {
      mock.restore();
    }
  },
});

// =============================================================================
// Error Handling Tests (Windows only, with mocking)
// =============================================================================

Deno.test({
  name: "BcContainerProvider - start throws on failure",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      mock.mockPowerShellError(["Start-BcContainer"], "Container not found", 1);

      const provider = new BcContainerProvider();

      await assertRejects(
        async () => await provider.start("TestContainer"),
        Error,
        "Failed to start container",
      );
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - stop throws on failure",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      mock.mockPowerShellError(["Stop-BcContainer"], "Container not found", 1);

      const provider = new BcContainerProvider();

      await assertRejects(
        async () => await provider.stop("TestContainer"),
        Error,
        "Failed to stop container",
      );
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - remove throws on failure",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      mock.mockPowerShellError(
        ["Remove-BcContainer"],
        "Container not found",
        1,
      );

      const provider = new BcContainerProvider();

      await assertRejects(
        async () => await provider.remove("TestContainer"),
        Error,
        "Failed to remove container",
      );
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - copyToContainer throws on failure",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      mock.mockPowerShellError(["Copy-ToNavContainer"], "Access denied", 1);

      const provider = new BcContainerProvider();

      await assertRejects(
        async () =>
          await provider.copyToContainer(
            "TestContainer",
            "/local/path",
            "/container/path",
          ),
        Error,
        "Failed to copy to container",
      );
    } finally {
      mock.restore();
    }
  },
});

Deno.test({
  name: "BcContainerProvider - copyFromContainer throws on failure",
  ignore: !isWindows,
  async fn() {
    const mock = createCommandMock();

    try {
      mock.install();

      mock.mockPowerShellError(["Copy-FromNavContainer"], "File not found", 1);

      const provider = new BcContainerProvider();

      await assertRejects(
        async () =>
          await provider.copyFromContainer(
            "TestContainer",
            "/container/path",
            "/local/path",
          ),
        Error,
        "Failed to copy from container",
      );
    } finally {
      mock.restore();
    }
  },
});

// =============================================================================
// Persistent Pwsh Session Tests
// =============================================================================

Deno.test("BcContainerProvider lazy-creates a session per container", async () => {
  const provider = new BcContainerProvider({ persistentPwsh: true });
  // We need a deterministic factory; test the behavior by stubbing the session creator.
  // For this initial test, just verify the provider exposes a maybeRecycleSession that's
  // a no-op when no session exists.
  await provider.maybeRecycleSession("Cronus28"); // does not throw
  await provider.dispose(); // safe to call with no sessions
});

Deno.test("BcContainerProvider - no-arg constructor still works", () => {
  // Backward compatibility: existing call sites use new BcContainerProvider()
  const provider = new BcContainerProvider();
  assertEquals(provider instanceof BcContainerProvider, true);
});

Deno.test("BcContainerProvider with persistentPwsh=false skips session creation", async () => {
  let factoryCalled = false;
  const provider = new BcContainerProvider({
    persistentPwsh: false,
    sessionFactory: () => {
      factoryCalled = true;
      throw new Error("should not be called");
    },
  });
  // Internal call to getOrCreateSession should return null without invoking factory.
  // We verify by checking maybeRecycleSession is a no-op (no factory call).
  await provider.maybeRecycleSession("Cronus28");
  assertEquals(factoryCalled, false);
});

Deno.test("BcContainerProvider - sessionFactory option is accepted", async () => {
  let factoryCalled = false;
  // A stub that returns a mock session — never actually called in this test
  // because no getOrCreateSession call is triggered from maybeRecycleSession
  // when the sessions map is empty.
  const factory = (_name: string): PwshContainerSession => {
    factoryCalled = true;
    throw new Error("should not be called");
  };
  const provider = new BcContainerProvider({
    persistentPwsh: true,
    sessionFactory: factory,
  });
  await provider.maybeRecycleSession("Cronus28");
  await provider.dispose();
  assertEquals(factoryCalled, false);
});

// =============================================================================
// Session Routing Tests (Windows only — requires real shared-folder paths)
// =============================================================================

Deno.test({
  name:
    "BcContainerProvider.compileProject routes through persistent session when available",
  ignore: !isWindows,
  async fn() {
    const mock = createMockPwshProcess();
    const session = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
      defaultTimeoutMs: 30_000,
    });

    let executeCalls = 0;
    let lastScript = "";
    const stubOutput = [
      "COMPILE_SUCCESS",
      "APP_FILE:C:\\fake\\out.app",
    ].join("\n");
    // Stub init to instant-idle so the slot's ensureHealthy completes without
    // running the real bootstrap protocol against the mock pwsh.
    // deno-lint-ignore no-explicit-any
    (session as any).init = () => {
      // deno-lint-ignore no-explicit-any
      (session as any)._state = "idle";
      return Promise.resolve();
    };
    // deno-lint-ignore no-explicit-any
    (session as any).execute = (script: string) => {
      executeCalls++;
      lastScript = script;
      return Promise.resolve({
        output: stubOutput,
        exitCode: 0,
        durationMs: 50,
      });
    };

    const provider = new BcContainerProvider({
      persistentPwsh: true,
      sessionFactory: () => session,
    });

    // Use tmpDir as both the project path and the compiler folder so that
    // getOrCreateCompilerFolder's Deno.stat() check passes without spawning PowerShell.
    const tmpDir = await Deno.makeTempDir();
    // deno-lint-ignore no-explicit-any
    (provider as any).compilerFolderCache.set("Cronus28", tmpDir);

    try {
      const result = await provider.compileProject(
        "Cronus28",
        {
          path: tmpDir,
          appJson: {
            id: "00000000-0000-0000-0000-000000000001",
            name: "TestApp",
          },
          // deno-lint-ignore no-explicit-any
        } as any,
      );
      assertEquals(executeCalls, 1, "session.execute should be called once");
      assertStringIncludes(
        lastScript,
        "Compile-AppWithBcCompilerFolder",
        "script must contain BCH compile command",
      );
      assertEquals(result.success, true, "compilation should succeed");
    } finally {
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
      await provider.dispose();
    }
  },
});

Deno.test({
  name:
    "BcContainerProvider.runTests routes through persistent session when available",
  ignore: !isWindows,
  async fn() {
    const mock = createMockPwshProcess();
    const session = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
      defaultTimeoutMs: 30_000,
    });

    // (bootstrapDone poller is unused because the session is pre-injected as idle,
    // but keep a reference for cleanup in case setInterval was started elsewhere.)

    // Stub session.execute() to return canned PowerShell test output.
    let executeCalls = 0;
    let lastScript = "";
    const stubOutput = [
      "PUBLISH_START:0",
      "PUBLISH_END:1000",
      "TEST_START:1000",
      "ALL_TESTS_PASSED",
      "TEST_END:2000",
    ].join("\n");
    // Stub init to instant-idle so the slot's ensureHealthy completes without
    // running the real bootstrap protocol against the mock pwsh.
    // deno-lint-ignore no-explicit-any
    (session as any).init = () => {
      // deno-lint-ignore no-explicit-any
      (session as any)._state = "idle";
      return Promise.resolve();
    };
    // deno-lint-ignore no-explicit-any
    (session as any).execute = (script: string) => {
      executeCalls++;
      lastScript = script;
      return Promise.resolve({
        output: stubOutput,
        exitCode: 0,
        durationMs: 100,
      });
    };

    const provider = new BcContainerProvider({
      persistentPwsh: true,
      sessionFactory: () => session,
    });

    const tmpDir = await Deno.makeTempDir();
    const fakeApp = `${tmpDir}\\TestPublisher_TestApp_1.0.0.0.app`;
    await Deno.writeTextFile(fakeApp, "fake-app-bytes");

    try {
      const project = {
        path: tmpDir,
        appJson: {
          id: "00000000-0000-0000-0000-000000000001",
          name: "TestApp",
        },
        // Minimal ALProject — sourceFiles/testFiles not needed since appFilePath is provided.
        // deno-lint-ignore no-explicit-any
      } as any;
      const result = await provider.runTests(
        "Cronus28",
        project,
        fakeApp,
        80100,
      );
      assertEquals(executeCalls, 1, "session.execute should be called once");
      assertStringIncludes(
        lastScript,
        "Run-TestsInBcContainer",
        "script must contain BCH test command",
      );
      assertEquals(result.totalTests, 1);
      assertEquals(result.success, true);
    } finally {
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
      await provider.dispose();
    }
  },
});

// =============================================================================
// Concurrency / Per-Container Serialization
// =============================================================================

Deno.test({
  name:
    "BcContainerProvider serializes concurrent compileProject callers per container (no orphan sessions)",
  ignore: !isWindows,
  async fn() {
    let factoryCalls = 0;
    const stubOutput = [
      "COMPILE_SUCCESS",
      "APP_FILE:C:\\fake\\out.app",
    ].join("\n");

    const sessionFactory = (name: string): PwshContainerSession => {
      factoryCalls++;
      const mock = createMockPwshProcess();
      const sess = new PwshContainerSession(name, {
        spawnFactory: () => mock.process,
      });
      // Stub init to take a few ticks so concurrent callers race.
      // deno-lint-ignore no-explicit-any
      (sess as any).init = async () => {
        await new Promise((r) => setTimeout(r, 25));
        // deno-lint-ignore no-explicit-any
        (sess as any)._state = "idle";
      };
      // Stub execute to remain in "idle" so subsequent serialized callers
      // see the session as healthy and reuse it.
      // deno-lint-ignore no-explicit-any
      (sess as any).execute = (_script: string) =>
        Promise.resolve({
          output: stubOutput,
          exitCode: 0,
          durationMs: 10,
        });
      return sess;
    };

    const provider = new BcContainerProvider({
      persistentPwsh: true,
      sessionFactory,
    });

    const tmpDir = await Deno.makeTempDir();
    // Pre-populate compiler folder cache so getOrCreateCompilerFolder skips PowerShell.
    // deno-lint-ignore no-explicit-any
    (provider as any).compilerFolderCache.set("Cronus28", tmpDir);

    const project = {
      path: tmpDir,
      appJson: {
        id: "00000000-0000-0000-0000-000000000001",
        name: "TestApp",
      },
      // deno-lint-ignore no-explicit-any
    } as any;

    try {
      await Promise.all([
        provider.compileProject("Cronus28", project),
        provider.compileProject("Cronus28", project),
        provider.compileProject("Cronus28", project),
      ]);
      assertEquals(
        factoryCalls,
        1,
        "sessionFactory must run exactly once per container under concurrent callers (otherwise pwsh processes are orphaned)",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
      await provider.dispose();
    }
  },
});
