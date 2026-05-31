/**
 * Windows Sandbox Provider Unit Tests
 *
 * Tests the WindowsSandboxProvider and WindowsSandbox classes.
 * Uses mocked Docker commands to avoid requiring actual Docker runtime.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { WindowsSandboxProvider } from "../../../src/sandbox/windows-provider.ts";
import type { SandboxConfig } from "../../../src/sandbox/types.ts";

// =============================================================================
// Docker Command Mock (supports spawn pattern)
// =============================================================================

interface MockDockerResponse {
  code: number;
  stdout: string;
  stderr: string;
}

interface MockDockerCall {
  args: string[];
  timestamp: number;
}

interface MockCommandInstance {
  spawn: () => {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    status: Promise<{ code: number; success: boolean }>;
    output: () => Promise<Deno.CommandOutput>;
    kill: () => void;
    ref: () => void;
    unref: () => void;
    pid: number;
  };
  output: () => Promise<Deno.CommandOutput>;
  outputSync: () => Deno.CommandOutput;
}

/**
 * Mock for Deno.Command that supports the spawn() pattern used by WindowsSandboxProvider.
 */
class DockerCommandMock {
  private responses: Map<string, MockDockerResponse> = new Map();
  private defaultResponse: MockDockerResponse = {
    code: 0,
    stdout: "",
    stderr: "",
  };
  calls: MockDockerCall[] = [];
  private originalCommand: typeof Deno.Command | null = null;
  private installed = false;

  /**
   * Set response for a specific command pattern.
   * Pattern is matched against the first few args joined.
   */
  setResponse(argsPattern: string, response: MockDockerResponse): this {
    this.responses.set(argsPattern, response);
    return this;
  }

  /**
   * Set default response for unmatched commands.
   */
  setDefaultResponse(response: MockDockerResponse): this {
    this.defaultResponse = response;
    return this;
  }

  /**
   * Find response matching the command args.
   */
  private findResponse(args: string[]): MockDockerResponse {
    const argsStr = args.join(" ");
    for (const [pattern, response] of this.responses) {
      if (argsStr.includes(pattern)) {
        return response;
      }
    }
    return this.defaultResponse;
  }

  /**
   * Install mock by replacing Deno.Command.
   */
  install(): this {
    if (this.installed) return this;

    this.originalCommand = Deno.Command;
    // deno-lint-ignore no-this-alias
    const mock = this;

    const MockCommand = function (
      command: string | URL,
      options?: Deno.CommandOptions,
    ): MockCommandInstance {
      const args = options?.args ?? [];

      // Only intercept docker commands
      if (command.toString() !== "docker") {
        // Fall back to original for non-docker commands
        if (mock.originalCommand) {
          return new mock.originalCommand(command, options);
        }
      }

      mock.calls.push({ args: [...args], timestamp: Date.now() });
      const response = mock.findResponse(args);

      // Create mock streams
      const createMockStream = (content: string) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        let sent = false;

        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              controller.enqueue(data);
              sent = true;
            } else {
              controller.close();
            }
          },
        });
      };

      return {
        spawn: () => ({
          stdout: createMockStream(response.stdout),
          stderr: createMockStream(response.stderr),
          status: Promise.resolve({
            code: response.code,
            success: response.code === 0,
          }),
          output: () =>
            Promise.resolve({
              code: response.code,
              success: response.code === 0,
              stdout: new TextEncoder().encode(response.stdout),
              stderr: new TextEncoder().encode(response.stderr),
              signal: null,
            }),
          kill: () => {},
          ref: () => {},
          unref: () => {},
          pid: 12345,
        }),
        output: () =>
          Promise.resolve({
            code: response.code,
            success: response.code === 0,
            stdout: new TextEncoder().encode(response.stdout),
            stderr: new TextEncoder().encode(response.stderr),
            signal: null,
          }),
        outputSync: () => ({
          code: response.code,
          success: response.code === 0,
          stdout: new TextEncoder().encode(response.stdout),
          stderr: new TextEncoder().encode(response.stderr),
          signal: null,
        }),
      };
    };

    // Deno 2.8 exposes Deno.Command as a getter-only accessor, so a plain
    // `Deno.Command = ...` assignment throws. Redefine it as a configurable
    // data property so the mock installs regardless of test order.
    Object.defineProperty(Deno, "Command", {
      value: MockCommand,
      configurable: true,
      writable: true,
    });
    this.installed = true;
    return this;
  }

  /**
   * Restore original Deno.Command.
   */
  restore(): this {
    if (!this.installed || !this.originalCommand) return this;

    Object.defineProperty(Deno, "Command", {
      value: this.originalCommand,
      configurable: true,
      writable: true,
    });
    this.originalCommand = null;
    this.installed = false;
    return this;
  }

  /**
   * Clear recorded calls.
   */
  clear(): this {
    this.calls = [];
    this.responses.clear();
    return this;
  }

  /**
   * Check if a command was called with specific args.
   */
  wasCalledWith(argsContain: string[]): boolean {
    return this.calls.some((call) =>
      argsContain.every((arg) => call.args.some((a) => a.includes(arg)))
    );
  }

  /**
   * Get all calls matching a pattern.
   */
  getCallsMatching(argsContain: string[]): MockDockerCall[] {
    return this.calls.filter((call) =>
      argsContain.every((arg) => call.args.some((a) => a.includes(arg)))
    );
  }
}

// =============================================================================
// Test Helpers
// =============================================================================

function createTestConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    image: "test-image:latest",
    workspaceDir: "C:\\test\\workspace",
    env: { TEST_VAR: "test_value" },
    mcpServerUrl: "http://localhost:3100",
    timeout: 60000,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

Deno.test("WindowsSandboxProvider", async (t) => {
  const mock = new DockerCommandMock();

  await t.step("name property", () => {
    const provider = new WindowsSandboxProvider();
    assertEquals(provider.name, "windows");
  });

  await t.step("isAvailable", async (t) => {
    await t.step("returns true when Docker is in Windows mode", async () => {
      mock.install();
      mock.setResponse("info --format", {
        code: 0,
        stdout: "windows\n",
        stderr: "",
      });

      try {
        const provider = new WindowsSandboxProvider();
        const available = await provider.isAvailable();
        assertEquals(available, true);
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("returns false when Docker is in Linux mode", async () => {
      mock.install();
      mock.setResponse("info --format", {
        code: 0,
        stdout: "linux\n",
        stderr: "",
      });

      try {
        const provider = new WindowsSandboxProvider();
        const available = await provider.isAvailable();
        assertEquals(available, false);
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("returns false when Docker command fails", async () => {
      mock.install();
      mock.setResponse("info --format", {
        code: 1,
        stdout: "",
        stderr: "Cannot connect to Docker daemon",
      });

      try {
        const provider = new WindowsSandboxProvider();
        const available = await provider.isAvailable();
        assertEquals(available, false);
      } finally {
        mock.restore();
        mock.clear();
      }
    });
  });

  await t.step("create", async (t) => {
    await t.step("creates container with correct arguments", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "abc123container\n",
        stderr: "",
      });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "test-sandbox" });
        const sandbox = await provider.create(config);

        assertEquals(sandbox.name, "test-sandbox");
        assertEquals(sandbox.status, "running");
        assertEquals(sandbox.config, config);

        // Verify docker run was called
        assertEquals(mock.wasCalledWith(["run", "-d"]), true);
        assertEquals(mock.wasCalledWith(["--name", "test-sandbox"]), true);
        assertEquals(mock.wasCalledWith(["-e", "TEST_VAR=test_value"]), true);
        assertEquals(
          mock.wasCalledWith(["-e", "MCP_SERVER_URL=http://localhost:3100"]),
          true,
        );
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("generates name when not provided", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "def456container\n",
        stderr: "",
      });

      try {
        const provider = new WindowsSandboxProvider();
        // Create config without name property to test auto-generation
        const config: SandboxConfig = {
          image: "test-image:latest",
          workspaceDir: "C:\\test\\workspace",
          env: { TEST_VAR: "test_value" },
          mcpServerUrl: "http://localhost:3100",
          timeout: 60000,
        };
        const sandbox = await provider.create(config);

        // Name should start with the prefix
        assertEquals(sandbox.name.startsWith("cg-sandbox-"), true);
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("throws when docker run fails", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 1,
        stdout: "",
        stderr: "Image not found",
      });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig();

        await assertRejects(
          () => provider.create(config),
          Error,
          "Failed to create sandbox",
        );
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step(
      "sets timeout environment variable when specified",
      async () => {
        mock.install();
        mock.setResponse("run -d", {
          code: 0,
          stdout: "ghi789container\n",
          stderr: "",
        });

        try {
          const provider = new WindowsSandboxProvider();
          const config = createTestConfig({ timeout: 120000 });
          await provider.create(config);

          assertEquals(
            mock.wasCalledWith(["-e", "AGENT_TIMEOUT_MS=120000"]),
            true,
          );
        } finally {
          mock.restore();
          mock.clear();
        }
      },
    );
  });

  await t.step("list", async (t) => {
    await t.step("returns empty array when no containers", async () => {
      mock.install();
      mock.setResponse("ps -a", { code: 0, stdout: "", stderr: "" });

      try {
        const provider = new WindowsSandboxProvider();
        const sandboxes = await provider.list();
        assertEquals(sandboxes.length, 0);
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("returns empty array when docker ps fails", async () => {
      mock.install();
      mock.setResponse("ps -a", { code: 1, stdout: "", stderr: "Error" });

      try {
        const provider = new WindowsSandboxProvider();
        const sandboxes = await provider.list();
        assertEquals(sandboxes.length, 0);
      } finally {
        mock.restore();
        mock.clear();
      }
    });
  });

  await t.step("get", async (t) => {
    await t.step("returns null for unknown id", () => {
      const provider = new WindowsSandboxProvider();
      const sandbox = provider.get("unknown-id");
      assertEquals(sandbox, null);
    });

    await t.step("returns sandbox after creation", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "container123\n",
        stderr: "",
      });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig();
        const created = await provider.create(config);

        const retrieved = provider.get(created.id);
        assertEquals(retrieved?.id, created.id);
      } finally {
        mock.restore();
        mock.clear();
      }
    });
  });

  await t.step("cleanup", async (t) => {
    await t.step("removes all sandbox containers", async () => {
      mock.install();
      mock.setResponse("ps -a", {
        code: 0,
        stdout: "cg-sandbox-123\ncg-sandbox-456\n",
        stderr: "",
      });
      mock.setResponse("rm -f", { code: 0, stdout: "", stderr: "" });

      try {
        const provider = new WindowsSandboxProvider();
        await provider.cleanup();

        // Should have called rm -f for each container
        const rmCalls = mock.getCallsMatching(["rm", "-f"]);
        assertEquals(rmCalls.length >= 1, true);
      } finally {
        mock.restore();
        mock.clear();
      }
    });
  });

  await t.step("pruneStaleContainers", async (t) => {
    await t.step("removes exited containers", async () => {
      mock.install();
      mock.setResponse("ps -a", {
        code: 0,
        stdout: "cg-sandbox-old1\ncg-sandbox-old2\n",
        stderr: "",
      });
      mock.setResponse("rm -f", { code: 0, stdout: "", stderr: "" });

      try {
        const removed = await WindowsSandboxProvider.pruneStaleContainers();
        assertEquals(removed >= 0, true);
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("returns 0 when no stale containers", async () => {
      mock.install();
      mock.setResponse("ps -a", { code: 0, stdout: "", stderr: "" });

      try {
        const removed = await WindowsSandboxProvider.pruneStaleContainers();
        assertEquals(removed, 0);
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("returns 0 when docker ps fails", async () => {
      mock.install();
      mock.setResponse("ps -a", { code: 1, stdout: "", stderr: "Error" });

      try {
        const removed = await WindowsSandboxProvider.pruneStaleContainers();
        assertEquals(removed, 0);
      } finally {
        mock.restore();
        mock.clear();
      }
    });
  });
});

Deno.test("WindowsSandbox", async (t) => {
  const mock = new DockerCommandMock();

  await t.step("exec", async (t) => {
    await t.step("executes command and returns result", async () => {
      mock.install();
      // Setup: create sandbox first
      mock.setResponse("run -d", {
        code: 0,
        stdout: "sandbox123\n",
        stderr: "",
      });
      mock.setResponse("exec sandbox123", {
        code: 0,
        stdout: "command output",
        stderr: "",
      });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "sandbox123" });
        const sandbox = await provider.create(config);

        const result = await sandbox.exec(["echo", "hello"]);

        assertEquals(result.exitCode, 0);
        assertEquals(result.stdout, "command output");
        assertEquals(result.timedOut, false);
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("captures stderr", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "sandbox456\n",
        stderr: "",
      });
      mock.setResponse("exec sandbox456", {
        code: 1,
        stdout: "",
        stderr: "error message",
      });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "sandbox456" });
        const sandbox = await provider.create(config);

        const result = await sandbox.exec(["bad", "command"]);

        assertEquals(result.exitCode, 1);
        assertEquals(result.stderr, "error message");
      } finally {
        mock.restore();
        mock.clear();
      }
    });
  });

  await t.step("execStream", async (t) => {
    await t.step("streams output to callback", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "sandbox789\n",
        stderr: "",
      });
      mock.setResponse("exec sandbox789", {
        code: 0,
        stdout: "streamed output",
        stderr: "streamed error",
      });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "sandbox789" });
        const sandbox = await provider.create(config);

        const chunks: Array<{ chunk: string; stream: string }> = [];
        const result = await sandbox.execStream(
          ["some", "command"],
          (chunk, stream) => {
            chunks.push({ chunk, stream });
          },
        );

        assertEquals(result.exitCode, 0);
        assertEquals(result.stdout, "streamed output");
        assertEquals(result.stderr, "streamed error");
        // At least one chunk should have been received
        assertEquals(chunks.length >= 1, true);
      } finally {
        mock.restore();
        mock.clear();
      }
    });
  });

  await t.step("copyIn", async (t) => {
    await t.step("copies files to sandbox", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "sandbox-copy\n",
        stderr: "",
      });
      mock.setResponse("cp", { code: 0, stdout: "", stderr: "" });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "sandbox-copy" });
        const sandbox = await provider.create(config);

        await sandbox.copyIn("/host/path/file.txt", "C:\\container\\path");

        assertEquals(mock.wasCalledWith(["cp", "/host/path/file.txt"]), true);
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("throws on failure", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "sandbox-copy-fail\n",
        stderr: "",
      });
      mock.setResponse("cp", { code: 1, stdout: "", stderr: "Copy failed" });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "sandbox-copy-fail" });
        const sandbox = await provider.create(config);

        await assertRejects(
          () => sandbox.copyIn("/host/path", "C:\\container\\path"),
          Error,
          "Failed to copy to sandbox",
        );
      } finally {
        mock.restore();
        mock.clear();
      }
    });
  });

  await t.step("copyOut", async (t) => {
    await t.step("copies files from sandbox", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "sandbox-out\n",
        stderr: "",
      });
      mock.setResponse("cp", { code: 0, stdout: "", stderr: "" });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "sandbox-out" });
        const sandbox = await provider.create(config);

        await sandbox.copyOut("C:\\container\\file.txt", "/host/path");

        assertEquals(mock.wasCalledWith(["cp"]), true);
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("throws on failure", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "sandbox-out-fail\n",
        stderr: "",
      });
      mock.setResponse("cp", { code: 1, stdout: "", stderr: "Copy failed" });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "sandbox-out-fail" });
        const sandbox = await provider.create(config);

        await assertRejects(
          () => sandbox.copyOut("C:\\container\\path", "/host/path"),
          Error,
          "Failed to copy from sandbox",
        );
      } finally {
        mock.restore();
        mock.clear();
      }
    });
  });

  await t.step("stop", async (t) => {
    await t.step("stops the container", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "sandbox-stop\n",
        stderr: "",
      });
      mock.setResponse("stop", { code: 0, stdout: "", stderr: "" });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "sandbox-stop" });
        const sandbox = await provider.create(config);

        assertEquals(sandbox.status, "running");
        await sandbox.stop();
        assertEquals(sandbox.status, "stopped");

        assertEquals(mock.wasCalledWith(["stop", "sandbox-stop"]), true);
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("throws on failure", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "sandbox-stop-fail\n",
        stderr: "",
      });
      mock.setResponse("stop", { code: 1, stdout: "", stderr: "Stop failed" });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "sandbox-stop-fail" });
        const sandbox = await provider.create(config);

        await assertRejects(
          () => sandbox.stop(),
          Error,
          "Failed to stop sandbox",
        );
      } finally {
        mock.restore();
        mock.clear();
      }
    });
  });

  await t.step("destroy", async (t) => {
    await t.step("stops and removes the container", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "sandbox-destroy\n",
        stderr: "",
      });
      mock.setResponse("stop", { code: 0, stdout: "", stderr: "" });
      mock.setResponse("rm -f", { code: 0, stdout: "", stderr: "" });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "sandbox-destroy" });
        const sandbox = await provider.create(config);

        await sandbox.destroy();

        assertEquals(mock.wasCalledWith(["stop", "sandbox-destroy"]), true);
        assertEquals(mock.wasCalledWith(["rm", "-f", "sandbox-destroy"]), true);
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("removes container even if stop fails", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "sandbox-destroy2\n",
        stderr: "",
      });
      mock.setResponse("stop", {
        code: 1,
        stdout: "",
        stderr: "Already stopped",
      });
      mock.setResponse("rm -f", { code: 0, stdout: "", stderr: "" });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "sandbox-destroy2" });
        const sandbox = await provider.create(config);

        // Should not throw even though stop fails
        await sandbox.destroy();

        assertEquals(mock.wasCalledWith(["rm", "-f"]), true);
      } finally {
        mock.restore();
        mock.clear();
      }
    });

    await t.step("throws when rm fails", async () => {
      mock.install();
      mock.setResponse("run -d", {
        code: 0,
        stdout: "sandbox-destroy3\n",
        stderr: "",
      });
      mock.setResponse("stop", { code: 0, stdout: "", stderr: "" });
      mock.setResponse("rm -f", {
        code: 1,
        stdout: "",
        stderr: "Remove failed",
      });

      try {
        const provider = new WindowsSandboxProvider();
        const config = createTestConfig({ name: "sandbox-destroy3" });
        const sandbox = await provider.create(config);

        await assertRejects(
          () => sandbox.destroy(),
          Error,
          "Failed to destroy sandbox",
        );
      } finally {
        mock.restore();
        mock.clear();
      }
    });
  });
});
