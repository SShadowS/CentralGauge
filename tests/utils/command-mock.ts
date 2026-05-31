/**
 * Command Mock Utility for testing Deno.Command (PowerShell/Docker CLI)
 *
 * This utility intercepts Deno.Command calls and returns configured responses,
 * allowing unit tests to run without actual external process execution.
 */

/**
 * Represents a command call made during testing
 */
export interface CommandCall {
  command: string;
  args: string[];
  options?: Deno.CommandOptions | undefined;
  timestamp: number;
}

/**
 * Configured response for a mocked command
 */
export interface CommandResponse {
  code: number;
  stdout: string | Uint8Array;
  stderr: string | Uint8Array;
  /** Optional delay in ms to simulate execution time */
  delay?: number;
}

/**
 * Pattern matcher for command interception
 */
export interface CommandPattern {
  /** Command executable to match (e.g., "pwsh", "docker") */
  command: string;
  /** Optional args pattern - if provided, all must be present (substring match) */
  argsContain?: string[];
  /** Optional exact args match */
  argsExact?: string[];
}

interface MockedCommand {
  pattern: CommandPattern;
  response: CommandResponse;
  /** Number of times this mock has been matched */
  matchCount: number;
  /** If true, only match once then remove */
  once: boolean;
}

/**
 * Mock class for Deno.Command that tracks calls and returns configured responses
 */
export class CommandMock {
  private mocks: MockedCommand[] = [];
  private calls: CommandCall[] = [];
  private originalCommand: typeof Deno.Command | null = null;
  private installed = false;

  /** Default response when no mock matches */
  private defaultResponse: CommandResponse = {
    code: 0,
    stdout: "",
    stderr: "",
  };

  /**
   * Add a mock response for a specific command pattern
   */
  mockCommand(pattern: CommandPattern, response: CommandResponse): this {
    this.mocks.push({
      pattern,
      response,
      matchCount: 0,
      once: false,
    });
    return this;
  }

  /**
   * Add a mock response that only matches once
   */
  mockCommandOnce(pattern: CommandPattern, response: CommandResponse): this {
    this.mocks.push({
      pattern,
      response,
      matchCount: 0,
      once: true,
    });
    return this;
  }

  /**
   * Convenience method to mock a successful PowerShell command
   */
  mockPowerShell(argsContain: string[], stdout: string): this {
    return this.mockCommand(
      { command: "pwsh", argsContain },
      { code: 0, stdout, stderr: "" },
    );
  }

  /**
   * Convenience method to mock a failed PowerShell command
   */
  mockPowerShellError(
    argsContain: string[],
    stderr: string,
    code = 1,
  ): this {
    return this.mockCommand(
      { command: "pwsh", argsContain },
      { code, stdout: "", stderr },
    );
  }

  /**
   * Convenience method to mock a successful Docker command
   */
  mockDocker(argsContain: string[], stdout: string): this {
    return this.mockCommand(
      { command: "docker", argsContain },
      { code: 0, stdout, stderr: "" },
    );
  }

  /**
   * Convenience method to mock a failed Docker command
   */
  mockDockerError(argsContain: string[], stderr: string, code = 1): this {
    return this.mockCommand(
      { command: "docker", argsContain },
      { code, stdout: "", stderr },
    );
  }

  /**
   * Set default response for unmatched commands
   */
  setDefaultResponse(response: CommandResponse): this {
    this.defaultResponse = response;
    return this;
  }

  /**
   * Get all recorded command calls
   */
  getCalls(): CommandCall[] {
    return [...this.calls];
  }

  /**
   * Get calls filtered by command name
   */
  getCallsFor(command: string): CommandCall[] {
    return this.calls.filter((c) => c.command === command);
  }

  /**
   * Get the last recorded call
   */
  getLastCall(): CommandCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  /**
   * Check if a command was called with specific args
   */
  wasCalledWith(command: string, argsContain?: string[]): boolean {
    return this.calls.some((call) => {
      if (call.command !== command) return false;
      if (!argsContain) return true;
      return argsContain.every((arg) => call.args.some((a) => a.includes(arg)));
    });
  }

  /**
   * Assert a command was called (throws if not)
   */
  assertCalled(command: string, argsContain?: string[]): void {
    if (!this.wasCalledWith(command, argsContain)) {
      const argsStr = argsContain
        ? ` with args containing [${argsContain.join(", ")}]`
        : "";
      throw new Error(
        `Expected command "${command}"${argsStr} to be called, but it was not.\n` +
          `Actual calls: ${
            JSON.stringify(
              this.calls.map((c) => ({ command: c.command, args: c.args })),
              null,
              2,
            )
          }`,
      );
    }
  }

  /**
   * Assert a command was NOT called
   */
  assertNotCalled(command: string, argsContain?: string[]): void {
    if (this.wasCalledWith(command, argsContain)) {
      const argsStr = argsContain
        ? ` with args containing [${argsContain.join(", ")}]`
        : "";
      throw new Error(
        `Expected command "${command}"${argsStr} NOT to be called, but it was.`,
      );
    }
  }

  /**
   * Get count of calls for a specific command
   */
  getCallCount(command?: string): number {
    if (!command) return this.calls.length;
    return this.calls.filter((c) => c.command === command).length;
  }

  /**
   * Clear all recorded calls (but keep mocks)
   */
  clearCalls(): this {
    this.calls = [];
    return this;
  }

  /**
   * Clear all mocks (but keep recorded calls)
   */
  clearMocks(): this {
    this.mocks = [];
    return this;
  }

  /**
   * Reset everything - clear calls and mocks
   */
  reset(): this {
    this.calls = [];
    this.mocks = [];
    for (const mock of this.mocks) {
      mock.matchCount = 0;
    }
    return this;
  }

  /**
   * Install the mock by replacing Deno.Command
   */
  install(): this {
    if (this.installed) {
      return this;
    }

    // Store original
    this.originalCommand = Deno.Command;

    // Create mock Command class
    // deno-lint-ignore no-this-alias
    const mockInstance = this;

    const MockCommand = function (
      this: Deno.Command,
      command: string | URL,
      options?: Deno.CommandOptions,
    ) {
      const cmdStr = command.toString();
      const args = options?.args ?? [];

      // Record the call
      mockInstance.calls.push({
        command: cmdStr,
        args: [...args],
        options,
        timestamp: Date.now(),
      });

      // Find matching mock
      const response = mockInstance.findMatchingResponse(cmdStr, args);

      // Return mock command instance
      return {
        output: async () => {
          if (response.delay) {
            await new Promise((resolve) => setTimeout(resolve, response.delay));
          }
          return {
            code: response.code,
            success: response.code === 0,
            signal: null,
            stdout: typeof response.stdout === "string"
              ? new TextEncoder().encode(response.stdout)
              : response.stdout,
            stderr: typeof response.stderr === "string"
              ? new TextEncoder().encode(response.stderr)
              : response.stderr,
          };
        },
        outputSync: () => {
          return {
            code: response.code,
            success: response.code === 0,
            signal: null,
            stdout: typeof response.stdout === "string"
              ? new TextEncoder().encode(response.stdout)
              : response.stdout,
            stderr: typeof response.stderr === "string"
              ? new TextEncoder().encode(response.stderr)
              : response.stderr,
          };
        },
        spawn: () => {
          throw new Error("CommandMock does not support spawn()");
        },
      } as unknown as Deno.Command;
      // deno-lint-ignore no-explicit-any
    } as any;

    // Replace Deno.Command. Deno 2.8 exposes Deno.Command as a getter-only
    // accessor, so a plain assignment throws; redefine it as a configurable
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
   * Restore the original Deno.Command
   */
  restore(): this {
    if (!this.installed || !this.originalCommand) {
      return this;
    }

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
   * Check if mock is currently installed
   */
  isInstalled(): boolean {
    return this.installed;
  }

  /**
   * Find matching response for a command call
   */
  private findMatchingResponse(
    command: string,
    args: string[],
  ): CommandResponse {
    for (let i = 0; i < this.mocks.length; i++) {
      const mock = this.mocks[i]!;
      if (this.matchesPattern(mock.pattern, command, args)) {
        mock.matchCount++;

        // Remove if it's a one-time mock
        if (mock.once) {
          this.mocks.splice(i, 1);
        }

        return mock.response;
      }
    }

    return this.defaultResponse;
  }

  /**
   * Check if a command matches a pattern
   */
  private matchesPattern(
    pattern: CommandPattern,
    command: string,
    args: string[],
  ): boolean {
    // Check command name
    if (!command.includes(pattern.command) && command !== pattern.command) {
      return false;
    }

    // Check exact args if specified
    if (pattern.argsExact) {
      if (args.length !== pattern.argsExact.length) return false;
      for (let i = 0; i < args.length; i++) {
        if (args[i] !== pattern.argsExact[i]) return false;
      }
      return true;
    }

    // Check args contain if specified
    if (pattern.argsContain) {
      const argsStr = args.join(" ");
      return pattern.argsContain.every((arg) => argsStr.includes(arg));
    }

    return true;
  }
}

/**
 * Create a new CommandMock instance (convenience function)
 */
export function createCommandMock(): CommandMock {
  return new CommandMock();
}

/**
 * Helper to encode string to Uint8Array (for output mocking)
 */
export function encodeOutput(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Helper to decode Uint8Array to string (for output assertions)
 */
export function decodeOutput(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
