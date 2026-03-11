/**
 * Unit tests for Agent Configuration Loader
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import {
  getAgentDisplayName,
  getAgentIdFromPath,
  loadAgentConfig,
  loadAgentConfigs,
  resolveAgentInheritance,
  validateAgentConfig,
} from "../../../src/agents/loader.ts";
import type { AgentConfig } from "../../../src/agents/types.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

describe("Agent Loader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir("agent-loader-test");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("loadAgentConfig", () => {
    it("should load a valid agent config from YAML", async () => {
      const configPath = join(tempDir, "test-agent.yml");
      const configYaml = `
id: test-agent
name: Test Agent
model: claude-sonnet-4-5-20250929
maxTurns: 10
allowedTools:
  - Read
  - Write
`;
      await Deno.writeTextFile(configPath, configYaml);

      const config = await loadAgentConfig(configPath);

      assertEquals(config.id, "test-agent");
      assertEquals(config.name, "Test Agent");
      assertEquals(config.model, "claude-sonnet-4-5-20250929");
      assertEquals(config.maxTurns, 10);
      assertEquals(config.allowedTools, ["Read", "Write"]);
    });

    it("should throw error for non-existent config file", async () => {
      const configPath = join(tempDir, "non-existent.yml");

      await assertRejects(
        async () => await loadAgentConfig(configPath),
        Error,
        "Agent config not found",
      );
    });

    it("should throw error for config missing id field", async () => {
      const configPath = join(tempDir, "missing-id.yml");
      const configYaml = `
name: Test Agent
model: claude-sonnet-4-5-20250929
maxTurns: 10
`;
      await Deno.writeTextFile(configPath, configYaml);

      await assertRejects(
        async () => await loadAgentConfig(configPath),
        Error,
        "missing 'id' field",
      );
    });

    it("should load config with all optional fields", async () => {
      const configPath = join(tempDir, "full-agent.yml");
      const configYaml = `
id: full-agent
name: Full Agent
description: A fully configured agent
model: claude-sonnet-4-5-20250929
maxTurns: 20
maxTokens: 100000
workingDir: ./project
settingSources:
  - project
  - user
allowedTools:
  - Read
  - Write
  - Edit
  - Skill
mcpServers:
  test-server:
    command: node
    args:
      - server.js
    env:
      API_KEY: secret
systemPrompt:
  preset: claude_code
  append: "Extra instructions"
limits:
  maxCompileAttempts: 10
  timeoutMs: 60000
extends: base-agent
tags:
  - test
  - full
`;
      await Deno.writeTextFile(configPath, configYaml);

      const config = await loadAgentConfig(configPath);

      assertEquals(config.id, "full-agent");
      assertEquals(config.description, "A fully configured agent");
      assertEquals(config.maxTokens, 100000);
      assertEquals(config.workingDir, "./project");
      assertEquals(config.settingSources, ["project", "user"]);
      assertEquals(config.allowedTools?.length, 4);
      assertExists(config.mcpServers?.["test-server"]);
      assertEquals(config.mcpServers?.["test-server"]?.command, "node");
      assertEquals(config.limits?.maxCompileAttempts, 10);
      assertEquals(config.extends, "base-agent");
      assertEquals(config.tags, ["test", "full"]);
    });

    it("should load config with string system prompt", async () => {
      const configPath = join(tempDir, "string-prompt.yml");
      const configYaml = `
id: string-prompt-agent
name: String Prompt Agent
model: claude-sonnet-4-5-20250929
maxTurns: 10
allowedTools:
  - Read
systemPrompt: "You are a helpful assistant."
`;
      await Deno.writeTextFile(configPath, configYaml);

      const config = await loadAgentConfig(configPath);

      assertEquals(config.systemPrompt, "You are a helpful assistant.");
    });
  });

  describe("loadAgentConfigs", () => {
    it("should load multiple agent configs from directory", async () => {
      // Create two agent config files
      await Deno.writeTextFile(
        join(tempDir, "agent1.yml"),
        `
id: agent1
name: Agent One
model: claude-sonnet-4-5-20250929
maxTurns: 10
allowedTools: [Read]
`,
      );
      await Deno.writeTextFile(
        join(tempDir, "agent2.yaml"),
        `
id: agent2
name: Agent Two
model: gpt-4o
maxTurns: 15
allowedTools: [Write]
`,
      );

      const configs = await loadAgentConfigs(tempDir);

      assertEquals(configs.size, 2);
      assertExists(configs.get("agent1"));
      assertExists(configs.get("agent2"));
      assertEquals(configs.get("agent1")?.name, "Agent One");
      assertEquals(configs.get("agent2")?.name, "Agent Two");
    });

    it("should return empty map for non-existent directory", async () => {
      const configs = await loadAgentConfigs(join(tempDir, "non-existent"));

      assertEquals(configs.size, 0);
    });

    it("should return empty map for empty directory", async () => {
      const emptyDir = join(tempDir, "empty");
      await Deno.mkdir(emptyDir);

      const configs = await loadAgentConfigs(emptyDir);

      assertEquals(configs.size, 0);
    });

    it("should skip invalid config files with warning", async () => {
      // Create one valid and one invalid config
      await Deno.writeTextFile(
        join(tempDir, "valid.yml"),
        `
id: valid-agent
name: Valid Agent
model: claude-sonnet-4-5-20250929
maxTurns: 10
allowedTools: [Read]
`,
      );
      await Deno.writeTextFile(
        join(tempDir, "invalid.yml"),
        `
name: Invalid Agent (missing id)
model: claude-sonnet-4-5-20250929
`,
      );

      const configs = await loadAgentConfigs(tempDir);

      // Should only load the valid config
      assertEquals(configs.size, 1);
      assertExists(configs.get("valid-agent"));
    });

    it("should only process .yml and .yaml files", async () => {
      await Deno.writeTextFile(
        join(tempDir, "agent.yml"),
        `
id: yml-agent
name: YAML Agent
model: claude-sonnet-4-5-20250929
maxTurns: 10
allowedTools: [Read]
`,
      );
      await Deno.writeTextFile(join(tempDir, "not-agent.txt"), "id: text-file");
      await Deno.writeTextFile(
        join(tempDir, "not-agent.json"),
        '{"id": "json-file"}',
      );

      const configs = await loadAgentConfigs(tempDir);

      assertEquals(configs.size, 1);
      assertExists(configs.get("yml-agent"));
    });
  });

  describe("loadAgentConfigs companion folder", () => {
    it("should set workingDir when companion folder exists", async () => {
      const configPath = join(tempDir, "my-agent.yml");
      await Deno.writeTextFile(
        configPath,
        `id: my-agent\nname: My Agent\nmodel: test\nmaxTurns: 10\nallowedTools:\n  - Read\n`,
      );

      // Create companion folder
      const companionDir = join(tempDir, "my-agent");
      await Deno.mkdir(companionDir, { recursive: true });
      await Deno.writeTextFile(
        join(companionDir, "CLAUDE.md"),
        "# My Agent Rules",
      );

      const configs = await loadAgentConfigs(tempDir);
      const config = configs.get("my-agent");

      assertExists(config);
      assertExists(config!.workingDir);
      assertEquals(config!.workingDir!.endsWith("my-agent"), true);
    });

    it("should not set workingDir when no companion folder exists", async () => {
      const configPath = join(tempDir, "solo-agent.yml");
      await Deno.writeTextFile(
        configPath,
        `id: solo-agent\nname: Solo\nmodel: test\nmaxTurns: 10\nallowedTools:\n  - Read\n`,
      );

      const configs = await loadAgentConfigs(tempDir);
      const config = configs.get("solo-agent");

      assertExists(config);
      assertEquals(config!.workingDir, undefined);
    });

    it("should use filename stem not config.id for companion folder", async () => {
      // YAML filename is "custom-name.yml" but config id is "different-id"
      const configPath = join(tempDir, "custom-name.yml");
      await Deno.writeTextFile(
        configPath,
        `id: different-id\nname: Custom\nmodel: test\nmaxTurns: 10\nallowedTools:\n  - Read\n`,
      );

      // Companion folder matches filename stem, NOT config.id
      const companionDir = join(tempDir, "custom-name");
      await Deno.mkdir(companionDir, { recursive: true });
      await Deno.writeTextFile(
        join(companionDir, "CLAUDE.md"),
        "# Custom Rules",
      );

      const configs = await loadAgentConfigs(tempDir);
      const config = configs.get("different-id");

      assertExists(config);
      assertExists(config!.workingDir);
      // workingDir should end with "custom-name" (filename stem), not "different-id"
      assertEquals(config!.workingDir!.endsWith("custom-name"), true);
    });

    it("should override explicit workingDir with companion folder", async () => {
      const configPath = join(tempDir, "override-agent.yml");
      await Deno.writeTextFile(
        configPath,
        `id: override-agent\nname: Override\nmodel: test\nmaxTurns: 10\nworkingDir: some/other/path\nallowedTools:\n  - Read\n`,
      );

      // Create companion folder
      const companionDir = join(tempDir, "override-agent");
      await Deno.mkdir(companionDir, { recursive: true });

      const configs = await loadAgentConfigs(tempDir);
      const config = configs.get("override-agent");

      assertExists(config);
      assertEquals(config!.workingDir!.endsWith("override-agent"), true);
    });
  });

  describe("resolveAgentInheritance", () => {
    it("should return config as-is when no extends", () => {
      const configs = new Map<string, AgentConfig>();
      configs.set("base", {
        id: "base",
        name: "Base Agent",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
      });

      const resolved = resolveAgentInheritance("base", configs);

      assertEquals(resolved.id, "base");
      assertEquals(resolved.name, "Base Agent");
      assertEquals(resolved._inheritanceChain, ["base"]);
    });

    it("should merge parent config with child config", () => {
      const configs = new Map<string, AgentConfig>();
      configs.set("parent", {
        id: "parent",
        name: "Parent Agent",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        maxTokens: 50000,
        allowedTools: ["Read", "Write"],
        limits: {
          maxCompileAttempts: 5,
        },
      });
      configs.set("child", {
        id: "child",
        name: "Child Agent",
        model: "gpt-4o",
        maxTurns: 20,
        allowedTools: ["Read", "Write", "Edit"],
        extends: "parent",
      });

      const resolved = resolveAgentInheritance("child", configs);

      assertEquals(resolved.id, "child");
      assertEquals(resolved.name, "Child Agent");
      assertEquals(resolved.model, "gpt-4o"); // Child overrides
      assertEquals(resolved.maxTurns, 20); // Child overrides
      assertEquals(resolved.maxTokens, 50000); // Inherited from parent
      assertEquals(resolved.allowedTools, ["Read", "Write", "Edit"]); // Child overrides
      assertEquals(resolved.limits?.maxCompileAttempts, 5); // Inherited
      assertEquals(resolved._inheritanceChain, ["parent", "child"]);
    });

    it("should support multi-level inheritance", () => {
      const configs = new Map<string, AgentConfig>();
      configs.set("grandparent", {
        id: "grandparent",
        name: "Grandparent",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 5,
        maxTokens: 10000,
        allowedTools: ["Read"],
      });
      configs.set("parent", {
        id: "parent",
        name: "Parent",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read", "Write"],
        extends: "grandparent",
      });
      configs.set("child", {
        id: "child",
        name: "Child",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 15,
        allowedTools: ["Read", "Write", "Edit"],
        extends: "parent",
      });

      const resolved = resolveAgentInheritance("child", configs);

      assertEquals(resolved.maxTokens, 10000); // From grandparent
      assertEquals(resolved.maxTurns, 15); // From child
      assertEquals(resolved._inheritanceChain, [
        "grandparent",
        "parent",
        "child",
      ]);
    });

    it("should detect circular inheritance", () => {
      const configs = new Map<string, AgentConfig>();
      configs.set("a", {
        id: "a",
        name: "Agent A",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        extends: "b",
      });
      configs.set("b", {
        id: "b",
        name: "Agent B",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        extends: "a",
      });

      assertThrows(
        () => resolveAgentInheritance("a", configs),
        Error,
        "Circular inheritance detected",
      );
    });

    it("should throw for non-existent parent", () => {
      const configs = new Map<string, AgentConfig>();
      configs.set("child", {
        id: "child",
        name: "Child Agent",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        extends: "non-existent-parent",
      });

      assertThrows(
        () => resolveAgentInheritance("child", configs),
        Error,
        "Agent config not found: non-existent-parent",
      );
    });

    it("should merge mcpServers from parent and child", () => {
      const configs = new Map<string, AgentConfig>();
      configs.set("parent", {
        id: "parent",
        name: "Parent",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        mcpServers: {
          server1: { command: "node", args: ["s1.js"] },
        },
      });
      configs.set("child", {
        id: "child",
        name: "Child",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        extends: "parent",
        mcpServers: {
          server2: { command: "node", args: ["s2.js"] },
        },
      });

      const resolved = resolveAgentInheritance("child", configs);

      assertExists(resolved.mcpServers?.["server1"]);
      assertExists(resolved.mcpServers?.["server2"]);
    });

    it("should merge limits from parent and child", () => {
      const configs = new Map<string, AgentConfig>();
      configs.set("parent", {
        id: "parent",
        name: "Parent",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        limits: {
          maxCompileAttempts: 5,
        },
      });
      configs.set("child", {
        id: "child",
        name: "Child",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        extends: "parent",
        limits: {
          timeoutMs: 60000,
        },
      });

      const resolved = resolveAgentInheritance("child", configs);

      assertEquals(resolved.limits?.maxCompileAttempts, 5);
      assertEquals(resolved.limits?.timeoutMs, 60000);
    });

    it("should use child settingSources when specified", () => {
      const configs = new Map<string, AgentConfig>();
      configs.set("parent", {
        id: "parent",
        name: "Parent",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        settingSources: ["project"],
      });
      configs.set("child", {
        id: "child",
        name: "Child",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        extends: "parent",
        settingSources: ["user"],
      });

      const resolved = resolveAgentInheritance("child", configs);

      assertEquals(resolved.settingSources, ["user"]);
    });

    it("should default settingSources to project when inheriting from parent without settingSources", () => {
      const configs = new Map<string, AgentConfig>();
      configs.set("parent", {
        id: "parent",
        name: "Parent",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        // No settingSources specified
      });
      configs.set("child", {
        id: "child",
        name: "Child",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        extends: "parent",
        // No settingSources specified
      });

      const resolved = resolveAgentInheritance("child", configs);

      // When both parent and child don't have settingSources, default to ['project']
      assertEquals(resolved.settingSources, ["project"]);
    });

    it("should preserve undefined settingSources for base config without inheritance", () => {
      const configs = new Map<string, AgentConfig>();
      configs.set("base", {
        id: "base",
        name: "Base",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        // No settingSources specified
      });

      const resolved = resolveAgentInheritance("base", configs);

      // Base config without inheritance doesn't get default settingSources
      assertEquals(resolved.settingSources, undefined);
    });

    it("should merge retry config from parent and child", () => {
      const configs = new Map<string, AgentConfig>();
      configs.set("parent", {
        id: "parent",
        name: "Parent",
        model: "sonnet",
        maxTurns: 50,
        allowedTools: ["Read"],
        limits: {
          maxRetries: 3,
          retryBaseDelayMs: 5000,
        },
      });
      configs.set("child", {
        id: "child",
        name: "Child",
        model: "sonnet",
        maxTurns: 50,
        allowedTools: ["Read"],
        extends: "parent",
        limits: {
          maxRetries: 1,
        },
      });

      const resolved = resolveAgentInheritance("child", configs);
      assertEquals(resolved.limits?.maxRetries, 1);
      // retryBaseDelayMs comes from parent via spread merge
      assertEquals(resolved.limits?.retryBaseDelayMs, 5000);
    });
  });

  describe("validateAgentConfig", () => {
    it("should pass validation for valid config", () => {
      const config: AgentConfig = {
        id: "valid-agent",
        name: "Valid Agent",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read", "Write"],
      };

      const result = validateAgentConfig(config);

      assertEquals(result.valid, true);
      assertEquals(result.errors.length, 0);
    });

    it("should fail validation for missing id", () => {
      const config = {
        name: "No ID Agent",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
      } as AgentConfig;

      const result = validateAgentConfig(config);

      assertEquals(result.valid, false);
      assertEquals(result.errors.some((e) => e.includes("id")), true);
    });

    it("should fail validation for missing name", () => {
      const config = {
        id: "no-name",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
      } as AgentConfig;

      const result = validateAgentConfig(config);

      assertEquals(result.valid, false);
      assertEquals(result.errors.some((e) => e.includes("name")), true);
    });

    it("should fail validation for missing model", () => {
      const config = {
        id: "no-model",
        name: "No Model Agent",
        maxTurns: 10,
        allowedTools: ["Read"],
      } as AgentConfig;

      const result = validateAgentConfig(config);

      assertEquals(result.valid, false);
      assertEquals(result.errors.some((e) => e.includes("model")), true);
    });

    it("should fail validation for invalid maxTurns", () => {
      const config: AgentConfig = {
        id: "invalid-turns",
        name: "Invalid Turns",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 0,
        allowedTools: ["Read"],
      };

      const result = validateAgentConfig(config);

      assertEquals(result.valid, false);
      assertEquals(result.errors.some((e) => e.includes("maxTurns")), true);
    });

    it("should fail validation for empty allowedTools", () => {
      const config: AgentConfig = {
        id: "no-tools",
        name: "No Tools",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: [],
      };

      const result = validateAgentConfig(config);

      assertEquals(result.valid, false);
      assertEquals(result.errors.some((e) => e.includes("allowedTools")), true);
    });

    it("should warn for very low maxTokens", () => {
      const config: AgentConfig = {
        id: "low-tokens",
        name: "Low Tokens",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        maxTokens: 5000,
        allowedTools: ["Read"],
      };

      const result = validateAgentConfig(config);

      assertEquals(result.valid, true);
      assertEquals(result.warnings.some((w) => w.includes("maxTokens")), true);
    });

    it("should warn for very high maxTurns", () => {
      const config: AgentConfig = {
        id: "high-turns",
        name: "High Turns",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 100,
        allowedTools: ["Read"],
      };

      const result = validateAgentConfig(config);

      assertEquals(result.valid, true);
      assertEquals(result.warnings.some((w) => w.includes("maxTurns")), true);
    });

    it("should fail for invalid systemPrompt preset", () => {
      const config: AgentConfig = {
        id: "invalid-preset",
        name: "Invalid Preset",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        systemPrompt: {
          preset: "invalid_preset" as "claude_code",
        },
      };

      const result = validateAgentConfig(config);

      assertEquals(result.valid, false);
      assertEquals(
        result.errors.some((e) => e.includes("systemPrompt.preset")),
        true,
      );
    });

    it("should fail for MCP server without command", () => {
      const config: AgentConfig = {
        id: "no-command",
        name: "No Command",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
        mcpServers: {
          broken: { command: "" },
        },
      };

      const result = validateAgentConfig(config);

      assertEquals(result.valid, false);
      assertEquals(
        result.errors.some((e) => e.includes("MCP server")),
        true,
      );
    });
  });

  describe("getAgentDisplayName", () => {
    it("should return name when available", () => {
      const config: AgentConfig = {
        id: "test-id",
        name: "Test Name",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
      };

      assertEquals(getAgentDisplayName(config), "Test Name");
    });

    it("should return id when name is missing", () => {
      const config = {
        id: "test-id",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        allowedTools: ["Read"],
      } as AgentConfig;

      assertEquals(getAgentDisplayName(config), "test-id");
    });
  });

  describe("getAgentIdFromPath", () => {
    it("should extract id from .yml path", () => {
      assertEquals(getAgentIdFromPath("/path/to/my-agent.yml"), "my-agent");
    });

    it("should extract id from .yaml path", () => {
      assertEquals(getAgentIdFromPath("/path/to/my-agent.yaml"), "my-agent");
    });

    it("should handle Windows paths", () => {
      assertEquals(
        getAgentIdFromPath("C:\\Users\\test\\agents\\default.yml"),
        "default",
      );
    });
  });
});
