/**
 * Unit tests for Prompt Injection Resolver
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { PromptInjectionResolver } from "../../../src/prompts/injection-resolver.ts";
import type {
  CLIPromptOverrides,
  PromptInjectionConfig,
} from "../../../src/prompts/types.ts";

describe("PromptInjectionResolver", () => {
  describe("resolve()", () => {
    it("should return empty object when no config provided", () => {
      const resolved = PromptInjectionResolver.resolve(
        undefined,
        undefined,
        undefined,
        "anthropic",
        "generation",
      );

      assertEquals(resolved, {});
    });

    it("should resolve default.default injections", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Global default system prompt",
              prefix: "Global prefix: ",
              suffix: " :Global suffix",
            },
          },
        },
      };

      const resolved = PromptInjectionResolver.resolve(
        globalConfig,
        undefined,
        undefined,
        "anthropic",
        "generation",
      );

      assertEquals(resolved.system, "Global default system prompt");
      assertEquals(resolved.prefix, "Global prefix: ");
      assertEquals(resolved.suffix, " :Global suffix");
    });

    it("should resolve stage-specific injections over default", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Default system",
            },
            generation: {
              system: "Generation system",
            },
          },
        },
      };

      const resolved = PromptInjectionResolver.resolve(
        globalConfig,
        undefined,
        undefined,
        "anthropic",
        "generation",
      );

      assertEquals(resolved.system, "Generation system");
    });

    it("should resolve provider-specific injections over default", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Default system",
            },
          },
          anthropic: {
            default: {
              system: "Anthropic system",
            },
          },
        },
      };

      const resolved = PromptInjectionResolver.resolve(
        globalConfig,
        undefined,
        undefined,
        "anthropic",
        "generation",
      );

      assertEquals(resolved.system, "Anthropic system");
    });

    it("should resolve provider+stage specific injections with highest priority", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Default default",
            },
            generation: {
              system: "Default generation",
            },
          },
          anthropic: {
            default: {
              system: "Anthropic default",
            },
            generation: {
              system: "Anthropic generation",
            },
          },
        },
      };

      const resolved = PromptInjectionResolver.resolve(
        globalConfig,
        undefined,
        undefined,
        "anthropic",
        "generation",
      );

      assertEquals(resolved.system, "Anthropic generation");
    });

    it("should respect cascading priority: Task > Global", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Global system",
              prefix: "Global prefix",
            },
          },
        },
      };

      const taskConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Task system",
            },
          },
        },
      };

      const resolved = PromptInjectionResolver.resolve(
        globalConfig,
        taskConfig,
        undefined,
        "anthropic",
        "generation",
      );

      // Task overrides global for system
      assertEquals(resolved.system, "Task system");
      // Global prefix preserved (not overridden)
      assertEquals(resolved.prefix, "Global prefix");
    });

    it("should respect cascading priority: CLI > Task > Global", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Global system",
              prefix: "Global prefix",
              suffix: "Global suffix",
            },
          },
        },
      };

      const taskConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Task system",
              prefix: "Task prefix",
            },
          },
        },
      };

      const cliOverrides: CLIPromptOverrides = {
        systemPrompt: "CLI system",
        stage: "both",
      };

      const resolved = PromptInjectionResolver.resolve(
        globalConfig,
        taskConfig,
        cliOverrides,
        "anthropic",
        "generation",
      );

      // CLI wins for system
      assertEquals(resolved.system, "CLI system");
      // Task wins for prefix
      assertEquals(resolved.prefix, "Task prefix");
      // Global wins for suffix
      assertEquals(resolved.suffix, "Global suffix");
    });

    it("should skip disabled global config", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: false,
        injections: {
          default: {
            default: {
              system: "Should not appear",
            },
          },
        },
      };

      const resolved = PromptInjectionResolver.resolve(
        globalConfig,
        undefined,
        undefined,
        "anthropic",
        "generation",
      );

      assertEquals(resolved.system, undefined);
    });

    it("should skip disabled task config", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Global system",
            },
          },
        },
      };

      const taskConfig: PromptInjectionConfig = {
        enabled: false,
        injections: {
          default: {
            default: {
              system: "Task system - disabled",
            },
          },
        },
      };

      const resolved = PromptInjectionResolver.resolve(
        globalConfig,
        taskConfig,
        undefined,
        "anthropic",
        "generation",
      );

      // Global should win since task is disabled
      assertEquals(resolved.system, "Global system");
    });

    it("should filter CLI overrides by provider", () => {
      const cliOverrides: CLIPromptOverrides = {
        systemPrompt: "CLI system for OpenAI",
        provider: "openai",
        stage: "both",
      };

      const resolved = PromptInjectionResolver.resolve(
        undefined,
        undefined,
        cliOverrides,
        "anthropic", // Different provider
        "generation",
      );

      // CLI override should not apply to different provider
      assertEquals(resolved.system, undefined);
    });

    it("should filter CLI overrides by stage", () => {
      const cliOverrides: CLIPromptOverrides = {
        systemPrompt: "CLI system for generation",
        stage: "generation",
      };

      const resolvedGeneration = PromptInjectionResolver.resolve(
        undefined,
        undefined,
        cliOverrides,
        "anthropic",
        "generation",
      );

      const resolvedFix = PromptInjectionResolver.resolve(
        undefined,
        undefined,
        cliOverrides,
        "anthropic",
        "fix",
      );

      // CLI should apply to generation
      assertEquals(resolvedGeneration.system, "CLI system for generation");
      // CLI should NOT apply to fix
      assertEquals(resolvedFix.system, undefined);
    });

    it("should apply CLI overrides to both stages when stage is 'both'", () => {
      const cliOverrides: CLIPromptOverrides = {
        systemPrompt: "CLI system for both",
        stage: "both",
      };

      const resolvedGeneration = PromptInjectionResolver.resolve(
        undefined,
        undefined,
        cliOverrides,
        "anthropic",
        "generation",
      );

      const resolvedFix = PromptInjectionResolver.resolve(
        undefined,
        undefined,
        cliOverrides,
        "anthropic",
        "fix",
      );

      assertEquals(resolvedGeneration.system, "CLI system for both");
      assertEquals(resolvedFix.system, "CLI system for both");
    });

    it("should handle fix stage correctly", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Default system",
            },
            fix: {
              system: "Fix system",
              prefix: "Fixing errors: ",
            },
          },
        },
      };

      const resolved = PromptInjectionResolver.resolve(
        globalConfig,
        undefined,
        undefined,
        "anthropic",
        "fix",
      );

      assertEquals(resolved.system, "Fix system");
      assertEquals(resolved.prefix, "Fixing errors: ");
    });
  });

  describe("apply()", () => {
    it("should return base prompt unchanged when no injections", () => {
      const result = PromptInjectionResolver.apply("Generate code", {});

      assertEquals(result.prompt, "Generate code");
      assertEquals(result.systemPrompt, undefined);
    });

    it("should add prefix to prompt", () => {
      const result = PromptInjectionResolver.apply("Generate code", {
        prefix: "Task context: ",
      });

      assertEquals(result.prompt, "Task context: Generate code");
    });

    it("should add suffix to prompt", () => {
      const result = PromptInjectionResolver.apply("Generate code", {
        suffix: " Remember: No comments.",
      });

      assertEquals(result.prompt, "Generate code Remember: No comments.");
    });

    it("should add both prefix and suffix", () => {
      const result = PromptInjectionResolver.apply("Generate code", {
        prefix: "Start: ",
        suffix: " :End",
      });

      assertEquals(result.prompt, "Start: Generate code :End");
    });

    it("should set system prompt separately", () => {
      const result = PromptInjectionResolver.apply("Generate code", {
        system: "You are an AL expert.",
      });

      assertEquals(result.prompt, "Generate code");
      assertEquals(result.systemPrompt, "You are an AL expert.");
    });

    it("should apply all injections together", () => {
      const result = PromptInjectionResolver.apply("Generate code", {
        system: "You are an AL expert.",
        prefix: "Task: ",
        suffix: " Format: AL",
      });

      assertEquals(result.prompt, "Task: Generate code Format: AL");
      assertEquals(result.systemPrompt, "You are an AL expert.");
    });
  });

  describe("resolveAndApply()", () => {
    it("should resolve and apply in one step", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Default system",
              prefix: "Prefix: ",
              suffix: " :Suffix",
            },
          },
        },
      };

      const result = PromptInjectionResolver.resolveAndApply(
        "Generate code",
        globalConfig,
        undefined,
        undefined,
        "anthropic",
        "generation",
      );

      assertEquals(result.prompt, "Prefix: Generate code :Suffix");
      assertEquals(result.systemPrompt, "Default system");
    });

    it("should handle complex multi-level resolution", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Global default",
              prefix: "Global: ",
            },
            generation: {
              suffix: " [generation stage]",
            },
          },
        },
      };

      const taskConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "Task default",
            },
          },
          anthropic: {
            generation: {
              prefix: "Anthropic: ",
            },
          },
        },
      };

      const cliOverrides: CLIPromptOverrides = {
        suffix: " [CLI suffix]",
        stage: "both",
      };

      const result = PromptInjectionResolver.resolveAndApply(
        "Generate code",
        globalConfig,
        taskConfig,
        cliOverrides,
        "anthropic",
        "generation",
      );

      // System: Task default (task > global)
      assertEquals(result.systemPrompt, "Task default");
      // Prefix: Anthropic: (provider-specific > default)
      // Suffix: [CLI suffix] (CLI > config)
      assertEquals(result.prompt, "Anthropic: Generate code [CLI suffix]");
    });
  });

  describe("hasInjections()", () => {
    it("should return false when no config", () => {
      const result = PromptInjectionResolver.hasInjections(
        undefined,
        undefined,
        undefined,
      );

      assertEquals(result, false);
    });

    it("should return true when CLI overrides present", () => {
      const result = PromptInjectionResolver.hasInjections(
        undefined,
        undefined,
        { systemPrompt: "CLI system" },
      );

      assertEquals(result, true);
    });

    it("should return true when global config has injections", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: { system: "System" },
          },
        },
      };

      const result = PromptInjectionResolver.hasInjections(
        globalConfig,
        undefined,
        undefined,
      );

      assertEquals(result, true);
    });

    it("should return false when global config is disabled", () => {
      const globalConfig: PromptInjectionConfig = {
        enabled: false,
        injections: {
          default: {
            default: { system: "System" },
          },
        },
      };

      const result = PromptInjectionResolver.hasInjections(
        globalConfig,
        undefined,
        undefined,
      );

      assertEquals(result, false);
    });

    it("should return true when task config has injections", () => {
      const taskConfig: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            generation: { prefix: "Prefix" },
          },
        },
      };

      const result = PromptInjectionResolver.hasInjections(
        undefined,
        taskConfig,
        undefined,
      );

      assertEquals(result, true);
    });
  });

  describe("validate()", () => {
    it("should return empty array for valid config", () => {
      const config: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: { system: "System" },
            generation: { prefix: "Prefix" },
            fix: { suffix: "Suffix" },
          },
          anthropic: {
            generation: { system: "Anthropic system" },
          },
        },
      };

      const result = PromptInjectionResolver.validate(config);

      assertEquals(result.errors.length, 0);
      assertEquals(result.warnings.length, 0);
    });

    it("should detect invalid stage names", () => {
      const config: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: { system: "System" },
            // @ts-ignore - intentionally testing invalid key
            invalidStage: { prefix: "Prefix" },
          },
        },
      };

      const result = PromptInjectionResolver.validate(config);

      assertEquals(result.errors.length, 1);
      assertEquals(
        result.errors[0]?.includes("Invalid stage 'invalidStage'") ?? false,
        true,
      );
    });

    it("should detect invalid injection keys", () => {
      const config: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "System",
              // @ts-ignore - intentionally testing invalid key
              invalidKey: "Value",
            },
          },
        },
      };

      const result = PromptInjectionResolver.validate(config);

      assertEquals(result.errors.length, 1);
      assertEquals(
        result.errors[0]?.includes("Invalid injection key 'invalidKey'") ??
          false,
        true,
      );
    });

    it("should warn (not error) about empty system prompts (D10)", () => {
      const config: PromptInjectionConfig = {
        enabled: true,
        injections: {
          default: {
            default: {
              system: "",
            },
          },
        },
      };

      const result = PromptInjectionResolver.validate(config);

      // Empty system prompt is suspicious but not structurally invalid — it
      // must not block a caller that treats a non-empty errors[] as fatal.
      assertEquals(result.errors.length, 0);
      assertEquals(result.warnings.length, 1);
      assertEquals(
        result.warnings[0]?.includes("Empty system prompt") ?? false,
        true,
      );
    });

    it("should return empty arrays for config without injections", () => {
      const config: PromptInjectionConfig = {
        enabled: true,
      };

      const result = PromptInjectionResolver.validate(config);

      assertEquals(result.errors.length, 0);
      assertEquals(result.warnings.length, 0);
    });
  });
});
