/**
 * Unit tests for DockerContainerProvider
 *
 * These tests verify the DockerContainerProvider's behavior by testing:
 * 1. Public interface properties
 * 2. Docker command execution with mocked responses
 * 3. Container lifecycle management (setup, start, stop, remove)
 * 4. Compilation and test execution logic
 * 5. Error handling scenarios
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { DockerContainerProvider } from "../../../src/container/docker-container-provider.ts";
import { createCommandMock } from "../../utils/command-mock.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

// =============================================================================
// Provider Properties Tests
// =============================================================================

Deno.test("DockerContainerProvider - Provider Properties", async (t) => {
  await t.step('name property returns "docker"', () => {
    const provider = new DockerContainerProvider();
    assertEquals(provider.name, "docker");
  });

  await t.step('platform property returns "linux"', () => {
    const provider = new DockerContainerProvider();
    assertEquals(provider.platform, "linux");
  });
});

// =============================================================================
// ContainerProvider Interface Compliance Tests
// =============================================================================

Deno.test("DockerContainerProvider - implements ContainerProvider interface", async (t) => {
  await t.step("has all required methods", () => {
    const provider = new DockerContainerProvider();

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
    const provider = new DockerContainerProvider();

    assertEquals(typeof provider.name, "string");
    assertEquals(typeof provider.platform, "string");
    assertEquals(provider.name.length > 0, true);
  });
});

// =============================================================================
// Constructor Tests
// =============================================================================

Deno.test("DockerContainerProvider - constructor initializes correctly", async (t) => {
  await t.step("creates new instance without errors", () => {
    const provider = new DockerContainerProvider();
    assertEquals(provider instanceof DockerContainerProvider, true);
  });

  await t.step("multiple instances are independent", () => {
    const provider1 = new DockerContainerProvider();
    const provider2 = new DockerContainerProvider();

    assertEquals(provider1.name, provider2.name);
    assertEquals(provider1 !== provider2, true);
  });
});

// =============================================================================
// Docker Command Execution Tests (with mocking)
// =============================================================================

Deno.test("DockerContainerProvider - setup checks Docker availability first", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    // Mock: Docker version check succeeds
    mock.mockDocker(["--version"], "Docker version 24.0.0, build abc123");

    // Mock: Remove existing container
    mock.mockDocker(["rm", "-f"], "");

    // Mock: Pull image
    mock.mockDocker(["pull"], "Pulling from microsoft/businesscentral");

    // Mock: Run container
    mock.mockDocker(["run"], "container_id_123");

    // Mock: Container logs (ready)
    mock.mockDocker(["logs"], "Ready for connections!");

    const provider = new DockerContainerProvider();
    await provider.setup({
      name: "TestContainer",
      bcVersion: "24.0",
      memoryLimit: "8g",
      acceptEula: true,
      includeAL: true,
      includeTestToolkit: true,
    });

    // Verify Docker version was checked
    assertEquals(mock.wasCalledWith("docker", ["--version"]), true);
    // Verify pull was called
    assertEquals(mock.wasCalledWith("docker", ["pull"]), true);
    // Verify run was called
    assertEquals(mock.wasCalledWith("docker", ["run"]), true);
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - setup throws when Docker not available", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    // Mock: Docker not responding
    mock.mockDockerError(["--version"], "Docker daemon not running", 1);

    const provider = new DockerContainerProvider();

    await assertRejects(
      async () =>
        await provider.setup({
          name: "TestContainer",
          bcVersion: "24.0",
          memoryLimit: "8g",
          acceptEula: true,
          includeAL: true,
          includeTestToolkit: true,
        }),
      Error,
      "Docker is not responding",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - setup throws when image pull fails", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    // Mock: Docker available
    mock.mockDocker(["--version"], "Docker version 24.0.0");

    // Mock: Remove existing (no error)
    mock.mockDocker(["rm", "-f"], "");

    // Mock: Pull fails
    mock.mockDockerError(["pull"], "manifest for image not found", 1);

    const provider = new DockerContainerProvider();

    await assertRejects(
      async () =>
        await provider.setup({
          name: "TestContainer",
          bcVersion: "99.0", // Non-existent version
          memoryLimit: "8g",
          acceptEula: true,
          includeAL: true,
          includeTestToolkit: true,
        }),
      Error,
      "Failed to pull BC image",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - start executes docker start command", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDocker(["start"], "TestContainer");

    const provider = new DockerContainerProvider();
    await provider.start("TestContainer");

    assertEquals(mock.wasCalledWith("docker", ["start"]), true);
    assertEquals(mock.wasCalledWith("docker", ["TestContainer"]), true);
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - start throws on failure", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDockerError(["start"], "No such container", 1);

    const provider = new DockerContainerProvider();

    await assertRejects(
      async () => await provider.start("NonExistent"),
      Error,
      "Failed to start container",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - stop executes docker stop command", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDocker(["stop"], "TestContainer");

    const provider = new DockerContainerProvider();
    await provider.stop("TestContainer");

    assertEquals(mock.wasCalledWith("docker", ["stop"]), true);
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - stop throws on failure", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDockerError(["stop"], "No such container", 1);

    const provider = new DockerContainerProvider();

    await assertRejects(
      async () => await provider.stop("NonExistent"),
      Error,
      "Failed to stop container",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - remove executes docker rm command", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDocker(["rm", "-f"], "TestContainer");

    const provider = new DockerContainerProvider();
    await provider.remove("TestContainer");

    assertEquals(mock.wasCalledWith("docker", ["rm"]), true);
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - remove throws on failure", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDockerError(["rm"], "No such container", 1);

    const provider = new DockerContainerProvider();

    await assertRejects(
      async () => await provider.remove("NonExistent"),
      Error,
      "Failed to remove container",
    );
  } finally {
    mock.restore();
  }
});

// =============================================================================
// Status Tests
// =============================================================================

Deno.test("DockerContainerProvider - status returns container info", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    // Mock: docker inspect returns structured output
    mock.mockDocker(
      ["inspect"],
      "true|healthy|mcr.microsoft.com/businesscentral:24.0|2024-01-01T10:00:00Z",
    );

    const provider = new DockerContainerProvider();
    const status = await provider.status("TestContainer");

    assertEquals(status.name, "TestContainer");
    assertEquals(status.isRunning, true);
    assertEquals(status.health, "healthy");
    assertEquals(status.bcVersion, "24.0");
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - status throws for non-existent container", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDockerError(["inspect"], "No such container", 1);

    const provider = new DockerContainerProvider();

    await assertRejects(
      async () => await provider.status("NonExistent"),
      Error,
      "Container NonExistent not found",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - status handles stopped container", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    // Container is not running
    mock.mockDocker(
      ["inspect"],
      "false||mcr.microsoft.com/businesscentral:24.0|2024-01-01T10:00:00Z",
    );

    const provider = new DockerContainerProvider();
    const status = await provider.status("StoppedContainer");

    assertEquals(status.isRunning, false);
    assertEquals(status.health, "stopped");
  } finally {
    mock.restore();
  }
});

// =============================================================================
// Health Check Tests
// =============================================================================

Deno.test("DockerContainerProvider - isHealthy returns true for healthy running container", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDocker(
      ["inspect"],
      "true|healthy|mcr.microsoft.com/businesscentral:24.0|2024-01-01T10:00:00Z",
    );

    const provider = new DockerContainerProvider();
    const healthy = await provider.isHealthy("TestContainer");

    assertEquals(healthy, true);
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - isHealthy returns false for unhealthy container", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDocker(
      ["inspect"],
      "true|unhealthy|mcr.microsoft.com/businesscentral:24.0|2024-01-01T10:00:00Z",
    );

    const provider = new DockerContainerProvider();
    const healthy = await provider.isHealthy("TestContainer");

    assertEquals(healthy, false);
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - isHealthy returns false for stopped container", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDocker(
      ["inspect"],
      "false|healthy|mcr.microsoft.com/businesscentral:24.0|2024-01-01T10:00:00Z",
    );

    const provider = new DockerContainerProvider();
    const healthy = await provider.isHealthy("TestContainer");

    assertEquals(healthy, false);
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - isHealthy returns false on error", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDockerError(["inspect"], "No such container", 1);

    const provider = new DockerContainerProvider();
    const healthy = await provider.isHealthy("NonExistent");

    assertEquals(healthy, false);
  } finally {
    mock.restore();
  }
});

// =============================================================================
// Compilation Tests
// =============================================================================

Deno.test("DockerContainerProvider - compileProject copies project and compiles", async () => {
  const mock = createCommandMock();
  const tempDir = await testTempDir();

  try {
    mock.install();

    // Create a minimal project structure
    await Deno.writeTextFile(
      `${tempDir}/app.json`,
      JSON.stringify({ name: "Test", publisher: "Test", version: "1.0.0" }),
    );

    // Mock: copy to container
    mock.mockDocker(["cp"], "");

    // Mock: compile succeeds
    mock.mockDocker(
      ["exec"],
      "Compilation object written to /tmp/build/app.app",
    );

    const provider = new DockerContainerProvider();
    const result = await provider.compileProject("TestContainer", {
      path: tempDir,
      appJson: { name: "Test", publisher: "Test", version: "1.0.0" },
      sourceFiles: [],
      testFiles: [],
    });

    assertEquals(result.success, true);
    assertEquals(result.errors.length, 0);
    // Verify docker cp was called
    assertEquals(mock.wasCalledWith("docker", ["cp"]), true);
    // Verify docker exec was called for compilation
    assertEquals(mock.wasCalledWith("docker", ["exec"]), true);
  } finally {
    mock.restore();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DockerContainerProvider - compileProject handles compilation errors", async () => {
  const mock = createCommandMock();
  const tempDir = await testTempDir();

  try {
    mock.install();

    await Deno.writeTextFile(
      `${tempDir}/app.json`,
      JSON.stringify({ name: "Test", publisher: "Test", version: "1.0.0" }),
    );

    // Mock: copy to container
    mock.mockDocker(["cp"], "");

    // Mock: compile fails with errors
    mock.mockDocker(
      ["exec"],
      "error AL0118: The name 'InvalidFunction' does not exist\nCOMPILE_FAILED",
    );

    const provider = new DockerContainerProvider();
    const result = await provider.compileProject("TestContainer", {
      path: tempDir,
      appJson: { name: "Test", publisher: "Test", version: "1.0.0" },
      sourceFiles: [],
      testFiles: [],
    });

    assertEquals(result.success, false);
  } finally {
    mock.restore();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DockerContainerProvider - compileProject throws when copy fails", async () => {
  const mock = createCommandMock();
  const tempDir = await testTempDir();

  try {
    mock.install();

    await Deno.writeTextFile(
      `${tempDir}/app.json`,
      JSON.stringify({ name: "Test", publisher: "Test", version: "1.0.0" }),
    );

    // Mock: copy fails
    mock.mockDockerError(["cp"], "No such container", 1);

    const provider = new DockerContainerProvider();

    await assertRejects(
      async () =>
        await provider.compileProject("TestContainer", {
          path: tempDir,
          appJson: { name: "Test", publisher: "Test", version: "1.0.0" },
          sourceFiles: [],
          testFiles: [],
        }),
      Error,
      "Failed to copy project to container",
    );
  } finally {
    mock.restore();
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Test Execution Tests
// =============================================================================

Deno.test("DockerContainerProvider - runTests copies project and runs tests", async () => {
  const mock = createCommandMock();
  const tempDir = await testTempDir();

  try {
    mock.install();

    await Deno.writeTextFile(
      `${tempDir}/app.json`,
      JSON.stringify({ name: "Test", publisher: "Test", version: "1.0.0" }),
    );

    // Mock: copy to container
    mock.mockDocker(["cp"], "");

    // Mock: tests pass - format must match parseDockerTestResults
    mock.mockDocker(
      ["exec"],
      "Test TestCase1 passed in 100ms\nTest TestCase2 passed in 150ms",
    );

    const provider = new DockerContainerProvider();
    const result = await provider.runTests("TestContainer", {
      path: tempDir,
      appJson: { name: "Test", publisher: "Test", version: "1.0.0" },
      sourceFiles: [],
      testFiles: [`${tempDir}/Test.al`],
    });

    assertEquals(result.success, true);
  } finally {
    mock.restore();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DockerContainerProvider - runTests handles test failures", async () => {
  const mock = createCommandMock();
  const tempDir = await testTempDir();

  try {
    mock.install();

    await Deno.writeTextFile(
      `${tempDir}/app.json`,
      JSON.stringify({ name: "Test", publisher: "Test", version: "1.0.0" }),
    );

    // Mock: copy to container
    mock.mockDocker(["cp"], "");

    // Mock: some tests fail - format must match parseDockerTestResults
    mock.mockDocker(
      ["exec"],
      "Test TestCase1 failed in 100ms: assertion error",
    );

    const provider = new DockerContainerProvider();
    const result = await provider.runTests("TestContainer", {
      path: tempDir,
      appJson: { name: "Test", publisher: "Test", version: "1.0.0" },
      sourceFiles: [],
      testFiles: [],
    });

    assertEquals(result.success, false);
  } finally {
    mock.restore();
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Copy Operations Tests
// =============================================================================

Deno.test("DockerContainerProvider - copyToContainer executes docker cp", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDocker(["cp"], "");

    const provider = new DockerContainerProvider();
    await provider.copyToContainer(
      "TestContainer",
      "/local/path",
      "/container/path",
    );

    assertEquals(mock.wasCalledWith("docker", ["cp"]), true);
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - copyToContainer throws on failure", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDockerError(["cp"], "No such container", 1);

    const provider = new DockerContainerProvider();

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
});

Deno.test("DockerContainerProvider - copyFromContainer executes docker cp", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDocker(["cp"], "");

    const provider = new DockerContainerProvider();
    await provider.copyFromContainer(
      "TestContainer",
      "/container/path",
      "/local/path",
    );

    assertEquals(mock.wasCalledWith("docker", ["cp"]), true);
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - copyFromContainer throws on failure", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDockerError(["cp"], "No such file or directory", 1);

    const provider = new DockerContainerProvider();

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
});

// =============================================================================
// Execute Command Tests
// =============================================================================

Deno.test("DockerContainerProvider - executeCommand runs command in container", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDocker(["exec"], "Command output here");

    const provider = new DockerContainerProvider();
    const result = await provider.executeCommand(
      "TestContainer",
      "Get-Service",
    );

    assertEquals(result.exitCode, 0);
    assertStringIncludes(result.output, "Command output here");
    assertEquals(mock.wasCalledWith("docker", ["exec"]), true);
  } finally {
    mock.restore();
  }
});

Deno.test("DockerContainerProvider - executeCommand returns error code on failure", async () => {
  const mock = createCommandMock();

  try {
    mock.install();

    mock.mockDockerError(["exec"], "Command failed", 1);

    const provider = new DockerContainerProvider();
    const result = await provider.executeCommand(
      "TestContainer",
      "InvalidCommand",
    );

    assertEquals(result.exitCode, 1);
  } finally {
    mock.restore();
  }
});
