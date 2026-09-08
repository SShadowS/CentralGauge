/**
 * `validateBatchConfig` validation (pure-function tests, Task 16).
 *
 * `batch.openrouter.limits` fields are optional and have no config-level
 * default (the provider's own `OPENROUTER_BATCH_MAX_ITEMS`/
 * `OPENROUTER_BATCH_MAX_BYTES` are the real defaults) - so unlike
 * `mergeBenchDefaults`, this validator never fills a value in. It only
 * rejects an explicitly-set bad one. Matches the pattern in
 * `bench-config.test.ts`: pure helper, no filesystem, no env vars.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  type BatchConfig,
  ConfigManager,
  validateBatchConfig,
} from "../../../src/config/config.ts";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  cleanupTempDir,
  createTempDir,
  MockEnv,
} from "../../utils/test-helpers.ts";

Deno.test("validateBatchConfig returns undefined unchanged", () => {
  assertEquals(validateBatchConfig(undefined), undefined);
});

Deno.test("validateBatchConfig returns an empty section unchanged", () => {
  const cfg: BatchConfig = {};
  assertEquals(validateBatchConfig(cfg), cfg);
});

Deno.test("validateBatchConfig returns a section with no limits unchanged", () => {
  const cfg: BatchConfig = { openrouter: {} };
  assertEquals(validateBatchConfig(cfg), cfg);
});

Deno.test("validateBatchConfig passes through valid limits", () => {
  const cfg: BatchConfig = {
    openrouter: { limits: { maxItems: 1000, maxBytes: 500_000 } },
  };
  assertEquals(validateBatchConfig(cfg), cfg);
});

Deno.test("validateBatchConfig passes through a partially-set limits object", () => {
  const cfg: BatchConfig = { openrouter: { limits: { maxItems: 4096 } } };
  assertEquals(validateBatchConfig(cfg), cfg);
});

Deno.test("validateBatchConfig rejects a zero maxItems", () => {
  assertThrows(
    () => validateBatchConfig({ openrouter: { limits: { maxItems: 0 } } }),
    ConfigurationError,
    "maxItems",
  );
});

Deno.test("validateBatchConfig rejects a negative maxBytes", () => {
  assertThrows(
    () => validateBatchConfig({ openrouter: { limits: { maxBytes: -1 } } }),
    ConfigurationError,
    "maxBytes",
  );
});

Deno.test("validateBatchConfig rejects NaN", () => {
  assertThrows(
    () =>
      validateBatchConfig({
        openrouter: { limits: { maxItems: Number.NaN } },
      }),
    ConfigurationError,
    "maxItems",
  );
});

Deno.test("validateBatchConfig rejects Infinity", () => {
  assertThrows(
    () =>
      validateBatchConfig({
        openrouter: { limits: { maxBytes: Number.POSITIVE_INFINITY } },
      }),
    ConfigurationError,
    "maxBytes",
  );
});

Deno.test("validateBatchConfig rejects a non-number value (e.g. a quoted YAML string)", () => {
  assertThrows(
    () =>
      validateBatchConfig(
        {
          openrouter: { limits: { maxItems: "big" as unknown as number } },
        },
      ),
    ConfigurationError,
    "maxItems",
  );
});

Deno.test("validateBatchConfig passes through a valid advanceIntervalMinutes", () => {
  const cfg: BatchConfig = { advanceIntervalMinutes: 30 };
  assertEquals(validateBatchConfig(cfg), cfg);
});

Deno.test("validateBatchConfig rejects a zero advanceIntervalMinutes", () => {
  assertThrows(
    () => validateBatchConfig({ advanceIntervalMinutes: 0 }),
    ConfigurationError,
    "advanceIntervalMinutes",
  );
});

Deno.test("validateBatchConfig rejects a non-numeric advanceIntervalMinutes", () => {
  assertThrows(
    () =>
      validateBatchConfig(
        { advanceIntervalMinutes: "30" } as unknown as BatchConfig,
      ),
    ConfigurationError,
    "advanceIntervalMinutes",
  );
});
/**
 * The home and cwd configs are merged one key at a time, so a section only
 * one of them sets must survive: an operator who sets `maxBytes` once in
 * their home config and overrides `maxItems` per project must end up with
 * both, not with the project's half alone.
 */
Deno.test("ConfigManager deep-merges batch.openrouter.limits across config files", async () => {
  const mockEnv = new MockEnv();
  const homeDir = await createTempDir("batch-merge-home");
  const projectDir = await createTempDir("batch-merge-project");
  const originalCwd = Deno.cwd();

  try {
    mockEnv.set("HOME", homeDir);
    mockEnv.set("USERPROFILE", homeDir);
    await Deno.writeTextFile(
      join(homeDir, ".centralgauge.yml"),
      "batch:\n  openrouter:\n    limits:\n      maxBytes: 524288\n",
    );
    await Deno.writeTextFile(
      join(projectDir, ".centralgauge.yml"),
      "batch:\n  openrouter:\n    limits:\n      maxItems: 4096\n",
    );
    Deno.chdir(projectDir);
    ConfigManager.reset();

    const config = await ConfigManager.loadConfig();

    assertEquals(config.batch?.openrouter?.limits?.maxItems, 4096);
    assertEquals(config.batch?.openrouter?.limits?.maxBytes, 524288);
  } finally {
    Deno.chdir(originalCwd);
    mockEnv.restore();
    ConfigManager.reset();
    await cleanupTempDir(projectDir);
    await cleanupTempDir(homeDir);
  }
});
