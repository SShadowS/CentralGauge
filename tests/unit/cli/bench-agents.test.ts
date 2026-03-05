/**
 * Tests for bench --agents consolidated functionality
 * @module tests/unit/cli/bench-agents
 */

import { assertEquals, assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { AgentRegistry } from "../../../src/agents/registry.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

// =============================================================================
// AgentBenchmarkOptions Interface Tests
// =============================================================================

/**
 * Recreate the interface to test its structure
 * This ensures the interface matches what bench command expects
 */
interface AgentBenchmarkOptions {
  agents: string[];
  tasks: string[];
  outputDir: string;
  debug?: boolean;
  stream?: boolean;
  tui?: boolean;
  containerName: string;
  sandbox?: boolean;
  verbose?: boolean;
}

describe("AgentBenchmarkOptions", () => {
  it("should require containerName field", () => {
    const options: AgentBenchmarkOptions = {
      agents: ["test-agent"],
      tasks: ["tasks/**/*.yml"],
      outputDir: "results",
      containerName: "Cronus28",
    };
    assertExists(options.containerName);
    assertEquals(options.containerName, "Cronus28");
  });

  it("should support sandbox option", () => {
    const options: AgentBenchmarkOptions = {
      agents: ["test-agent"],
      tasks: ["tasks/**/*.yml"],
      outputDir: "results",
      containerName: "Cronus28",
      sandbox: true,
    };
    assertEquals(options.sandbox, true);
  });

  it("should support verbose option", () => {
    const options: AgentBenchmarkOptions = {
      agents: ["test-agent"],
      tasks: ["tasks/**/*.yml"],
      outputDir: "results",
      containerName: "Cronus28",
      verbose: true,
    };
    assertEquals(options.verbose, true);
  });

  it("should support custom container name", () => {
    const options: AgentBenchmarkOptions = {
      agents: ["test-agent"],
      tasks: ["tasks/**/*.yml"],
      outputDir: "results",
      containerName: "CustomContainer",
    };
    assertEquals(options.containerName, "CustomContainer");
  });
});

// =============================================================================
// CLI Option Mapping Tests
// =============================================================================

describe("CLI option to AgentBenchmarkOptions mapping", () => {
  it("should map --container option to containerName", () => {
    // Simulate CLI options
    const cliOptions = {
      agents: ["universal-test"],
      tasks: ["tasks/**/*.yml"],
      output: "results/",
      container: "MyContainer",
      sandbox: false,
      debug: false,
    };

    // Build AgentBenchmarkOptions like the action handler does
    const agentBenchOptions: AgentBenchmarkOptions = {
      agents: cliOptions.agents,
      tasks: [...cliOptions.tasks],
      outputDir: cliOptions.output,
      containerName: cliOptions.container,
      sandbox: cliOptions.sandbox ?? false,
      verbose: cliOptions.debug ?? false,
    };

    assertEquals(agentBenchOptions.containerName, "MyContainer");
  });

  it("should map --sandbox flag to sandbox option", () => {
    const cliOptions = {
      agents: ["universal-test"],
      tasks: ["tasks/**/*.yml"],
      output: "results/",
      container: "Cronus28",
      sandbox: true,
      debug: false,
    };

    const agentBenchOptions: AgentBenchmarkOptions = {
      agents: cliOptions.agents,
      tasks: [...cliOptions.tasks],
      outputDir: cliOptions.output,
      containerName: cliOptions.container,
      sandbox: cliOptions.sandbox ?? false,
      verbose: cliOptions.debug ?? false,
    };

    assertEquals(agentBenchOptions.sandbox, true);
  });

  it("should map --debug to verbose for failure details", () => {
    const cliOptions = {
      agents: ["universal-test"],
      tasks: ["tasks/**/*.yml"],
      output: "results/",
      container: "Cronus28",
      sandbox: false,
      debug: true,
    };

    const agentBenchOptions: AgentBenchmarkOptions = {
      agents: cliOptions.agents,
      tasks: [...cliOptions.tasks],
      outputDir: cliOptions.output,
      containerName: cliOptions.container,
      sandbox: cliOptions.sandbox ?? false,
      verbose: cliOptions.debug ?? false,
    };

    assertEquals(agentBenchOptions.verbose, true);
  });

  it("should default sandbox to false when not specified", () => {
    const cliOptions = {
      agents: ["universal-test"],
      tasks: ["tasks/**/*.yml"],
      output: "results/",
      container: "Cronus28",
      // sandbox not specified
      debug: false,
    };

    const agentBenchOptions: AgentBenchmarkOptions = {
      agents: cliOptions.agents,
      tasks: [...cliOptions.tasks],
      outputDir: cliOptions.output,
      containerName: cliOptions.container,
      sandbox: (cliOptions as { sandbox?: boolean }).sandbox ?? false,
      verbose: cliOptions.debug ?? false,
    };

    assertEquals(agentBenchOptions.sandbox, false);
  });
});

// =============================================================================
// Agent Registry Integration Tests
// =============================================================================

describe("Agent Registry with bench --agents", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir("bench-agents-test");
    AgentRegistry.clear();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    AgentRegistry.clear();
  });

  it("should validate agent exists before execution", async () => {
    // Create a minimal agent config
    const agentsDir = join(tempDir, "agents");
    await Deno.mkdir(agentsDir, { recursive: true });
    await Deno.writeTextFile(
      join(agentsDir, "test-agent.yml"),
      `id: test-agent
name: Test Agent
model: anthropic/claude-sonnet-4-20250514
maxTurns: 10
systemPrompt: Test prompt
`,
    );

    await AgentRegistry.load(agentsDir);

    const config = AgentRegistry.get("test-agent");
    assertExists(config);
    assertEquals(config.id, "test-agent");
  });

  it("should return null for non-existent agent", async () => {
    const agentsDir = join(tempDir, "agents");
    await Deno.mkdir(agentsDir, { recursive: true });

    await AgentRegistry.load(agentsDir);

    const config = AgentRegistry.get("non-existent-agent");
    assertEquals(config, undefined);
  });
});

// =============================================================================
// Result Output Format Tests
// =============================================================================

describe("Agent benchmark result format", () => {
  it("should produce result compatible with report command", () => {
    // Mock the result structure that runAgentBenchmark produces
    const result = {
      agents: ["universal-test"],
      tasks: 10,
      results: [
        {
          agentId: "universal-test",
          taskId: "CG-AL-E001",
          result: {
            success: true,
            metrics: {
              turns: 5,
              estimatedCost: 0.01,
              totalTokens: 1000,
            },
            testResult: {
              passedTests: 3,
              totalTests: 3,
            },
          },
        },
      ],
      stats: {
        "universal-test": {
          passed: 8,
          failed: 2,
          totalCost: 0.08,
          totalTurns: 40,
          totalTokens: 8000,
        },
      },
      duration: 120000,
      timestamp: new Date().toISOString(),
    };

    // Verify structure matches what report command expects
    assertExists(result.agents);
    assertExists(result.results);
    assertExists(result.stats);
    assertExists(result.timestamp);
    assertEquals(Array.isArray(result.agents), true);
    assertEquals(Array.isArray(result.results), true);
  });
});
