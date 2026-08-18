/**
 * Tests for ModelPresetRegistry and MODEL_ALIASES
 * @module tests/unit/llm/model-presets
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  getModelDisplayName,
  MODEL_ALIASES,
  MODEL_DISPLAY_NAMES,
  MODEL_GROUPS,
  MODEL_PRESETS,
  ModelPresetRegistry,
} from "../../../src/llm/model-presets.ts";

Deno.test("ModelPresetRegistry.resolve", async (t) => {
  await t.step("resolves alias to provider/model format", () => {
    const result = ModelPresetRegistry.resolve("sonnet");
    assertEquals(result.length, 1);
    assertEquals(result[0], "anthropic/claude-sonnet-4-5-20250929");
  });

  await t.step("resolves gpt-4o alias correctly", () => {
    const result = ModelPresetRegistry.resolve("gpt-4o");
    assertEquals(result.length, 1);
    assertEquals(result[0], "openai/gpt-4o");
  });

  await t.step("resolves haiku alias correctly", () => {
    const result = ModelPresetRegistry.resolve("haiku");
    assertEquals(result.length, 1);
    assertEquals(result[0], "anthropic/claude-haiku-4-5-20251001");
  });

  await t.step("resolves opus to claude-opus-4-6", () => {
    const result = ModelPresetRegistry.resolve("opus");
    assertEquals(result.length, 1);
    assertEquals(result[0], "anthropic/claude-opus-4-6");
  });

  await t.step("resolves o3 to openai/o3", () => {
    const result = ModelPresetRegistry.resolve("o3");
    assertEquals(result.length, 1);
    assertEquals(result[0], "openai/o3");
  });

  await t.step("resolves group to multiple models", () => {
    const result = ModelPresetRegistry.resolve("flagship");
    assertEquals(result.length > 1, true);
    result.forEach((r) => assertEquals(r.includes("/"), true));
  });

  await t.step("resolves budget group", () => {
    const result = ModelPresetRegistry.resolve("budget");
    assertEquals(result.length > 0, true);
    const hasHaiku = result.some((r) => r.includes("haiku"));
    assertEquals(hasHaiku, true);
  });

  await t.step("passes through provider/model format unchanged", () => {
    const result = ModelPresetRegistry.resolve("openai/gpt-4-turbo");
    assertEquals(result.length, 1);
    assertEquals(result[0], "openai/gpt-4-turbo");
  });

  await t.step("passes through unknown spec unchanged", () => {
    const result = ModelPresetRegistry.resolve("unknown-model-xyz");
    assertEquals(result.length, 1);
    assertEquals(result[0], "unknown-model-xyz");
  });

  await t.step("resolves mock preset", () => {
    const result = ModelPresetRegistry.resolve("mock");
    assertEquals(result.length, 1);
    assertEquals(result[0], "mock/mock-gpt-4");
  });

  await t.step("resolves all group to all aliases", () => {
    const result = ModelPresetRegistry.resolve("all");
    const aliasCount = Object.keys(MODEL_ALIASES).length;
    assertEquals(result.length, aliasCount);
  });
});

Deno.test("ModelPresetRegistry.getAlias", async (t) => {
  await t.step("returns alias for valid name", () => {
    const alias = ModelPresetRegistry.getAlias("sonnet");
    assertExists(alias);
    assertEquals(alias.provider, "anthropic");
    assertEquals(alias.model, "claude-sonnet-4-5-20250929");
  });

  await t.step("returns null for invalid alias", () => {
    const alias = ModelPresetRegistry.getAlias("nonexistent-model");
    assertEquals(alias, null);
  });
});

Deno.test("ModelPresetRegistry.getPreset (backward compat)", async (t) => {
  await t.step("returns preset for valid alias", () => {
    const preset = ModelPresetRegistry.getPreset("sonnet");
    assertExists(preset);
    assertEquals(preset.alias, "sonnet");
    assertEquals(preset.provider, "anthropic");
  });

  await t.step("returns null for invalid alias", () => {
    const preset = ModelPresetRegistry.getPreset("nonexistent-model");
    assertEquals(preset, null);
  });

  await t.step("returns preset with required fields", () => {
    const preset = ModelPresetRegistry.getPreset("gpt-4o");
    assertExists(preset);
    assertExists(preset.alias);
    assertExists(preset.provider);
    assertExists(preset.model);
    assertExists(preset.displayName);
  });
});

Deno.test("ModelPresetRegistry.getGroups", async (t) => {
  await t.step("returns array of group names", () => {
    const groups = ModelPresetRegistry.getGroups();
    assertEquals(Array.isArray(groups), true);
    assertEquals(groups.length > 0, true);
  });

  await t.step("includes essential groups", () => {
    const groups = ModelPresetRegistry.getGroups();
    assertEquals(groups.includes("flagship"), true);
    assertEquals(groups.includes("budget"), true);
    assertEquals(groups.includes("coding"), true);
    assertEquals(groups.includes("all"), true);
  });

  await t.step("matches MODEL_GROUPS keys", () => {
    const groups = ModelPresetRegistry.getGroups();
    const expectedGroups = Object.keys(MODEL_GROUPS);
    assertEquals(groups.sort(), expectedGroups.sort());
  });
});

Deno.test("ModelPresetRegistry.getAliases", async (t) => {
  await t.step("returns array of alias names", () => {
    const aliases = ModelPresetRegistry.getAliases();
    assertEquals(Array.isArray(aliases), true);
    assertEquals(aliases.length > 0, true);
  });

  await t.step("includes common aliases", () => {
    const aliases = ModelPresetRegistry.getAliases();
    assertEquals(aliases.includes("sonnet"), true);
    assertEquals(aliases.includes("haiku"), true);
    assertEquals(aliases.includes("gpt-4o"), true);
    assertEquals(aliases.includes("gemini"), true);
    assertEquals(aliases.includes("mock"), true);
  });

  await t.step("matches MODEL_ALIASES keys", () => {
    const aliases = ModelPresetRegistry.getAliases();
    const expectedAliases = Object.keys(MODEL_ALIASES);
    assertEquals(aliases.sort(), expectedAliases.sort());
  });
});

Deno.test("MODEL_ALIASES structure", async (t) => {
  await t.step("all aliases have required fields", () => {
    for (const [alias, entry] of Object.entries(MODEL_ALIASES)) {
      assertExists(entry.provider, `${alias} missing provider`);
      assertExists(entry.model, `${alias} missing model`);
    }
  });
});

Deno.test("MODEL_PRESETS backward-compat shim", async (t) => {
  await t.step("has same keys as MODEL_ALIASES", () => {
    const presetKeys = Object.keys(MODEL_PRESETS).sort();
    const aliasKeys = Object.keys(MODEL_ALIASES).sort();
    assertEquals(presetKeys, aliasKeys);
  });

  await t.step("each entry has alias, provider, model, displayName", () => {
    for (const [alias, preset] of Object.entries(MODEL_PRESETS)) {
      assertEquals(preset.alias, alias, `${alias} alias mismatch`);
      assertExists(preset.provider, `${alias} missing provider`);
      assertExists(preset.model, `${alias} missing model`);
      assertExists(preset.displayName, `${alias} missing displayName`);
    }
  });
});

Deno.test("MODEL_GROUPS structure", async (t) => {
  await t.step("all groups are arrays", () => {
    for (const [name, aliases] of Object.entries(MODEL_GROUPS)) {
      assertEquals(
        Array.isArray(aliases),
        true,
        `${name} should be an array`,
      );
    }
  });

  await t.step("group aliases exist in MODEL_ALIASES", () => {
    for (const [groupName, aliases] of Object.entries(MODEL_GROUPS)) {
      if (groupName === "all") continue;

      for (const alias of aliases) {
        assertExists(
          MODEL_ALIASES[alias],
          `Group '${groupName}' contains unknown alias '${alias}'`,
        );
      }
    }
  });

  await t.step("all group contains all aliases", () => {
    const allGroup = MODEL_GROUPS["all"] ?? [];
    const aliasKeys = Object.keys(MODEL_ALIASES);
    assertEquals(allGroup.length, aliasKeys.length);
  });
});

Deno.test("MODEL_DISPLAY_NAMES", async (t) => {
  await t.step("has entries for all alias models", () => {
    const uniqueModels = new Set(
      Object.values(MODEL_ALIASES).map((a) => a.model),
    );
    for (const model of uniqueModels) {
      // Local and mock models may not have display names (fallback is fine)
      if (model.includes(":") || model === "mock-gpt-4") continue;
      assertExists(
        MODEL_DISPLAY_NAMES[model],
        `Missing display name for model: ${model}`,
      );
    }
  });
});

Deno.test("getModelDisplayName", async (t) => {
  await t.step("returns known display name", () => {
    assertEquals(getModelDisplayName("gpt-4o"), "GPT-4o");
    assertEquals(
      getModelDisplayName("claude-sonnet-4-5-20250929"),
      "Claude Sonnet 4.5",
    );
  });

  await t.step("returns fallback for unknown model", () => {
    const result = getModelDisplayName("some-unknown-model");
    assertEquals(typeof result, "string");
    assertEquals(result.length > 0, true);
  });
});

// The alias table now lives in the zero-import leaf src/llm/model-aliases.ts
// and is re-exported from here. These assertions read it through
// model-presets.ts on purpose: they pin BOTH that the values survived the
// move byte-for-byte and that the re-export still serves every existing
// importer. The rest of this file exercises the table only through
// ModelPresetRegistry or by counting keys, so a wrong model id would have
// gone unnoticed.
Deno.test("MODEL_ALIASES entries survive the move to the leaf", async (t) => {
  await t.step("pins representative aliases", () => {
    assertEquals(MODEL_ALIASES["mock"], {
      provider: "mock",
      model: "mock-gpt-4",
    });
    assertEquals(MODEL_ALIASES["sonnet"], {
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
    });
    assertEquals(MODEL_ALIASES["opus"], {
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
    assertEquals(MODEL_ALIASES["gpt-4o"], {
      provider: "openai",
      model: "gpt-4o",
    });
    // An entry whose model id contains its own "/" — the case a naive split
    // would mangle.
    assertEquals(MODEL_ALIASES["openrouter-deepseek"], {
      provider: "openrouter",
      model: "deepseek/deepseek-v3.2",
    });
  });

  await t.step("keeps every alias, so nothing was dropped in the move", () => {
    assertEquals(Object.keys(MODEL_ALIASES).length, 26);
  });
});
