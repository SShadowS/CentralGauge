/**
 * Tests for the inline-infra-retry config knob (`bench.infraRetriesPerAttempt`).
 *
 * Contract (Task 1 of the automatic-infra-retry plan):
 *
 * 1. `.centralgauge.yml` with `bench: { infraRetriesPerAttempt: 3 }` resolves to 3.
 * 2. `CENTRALGAUGE_BENCH_INFRA_RETRY=0` overrides the YAML to 0.
 * 3. YAML absent → resolved default is 1.
 * 4. Invalid YAML values (negative, non-integer) → config load throws.
 *
 * The env var only honors the literal string `"0"`. Any other value (e.g. "3")
 * leaves the YAML value (or default) in effect. This mirrors the pattern used
 * for `CENTRALGAUGE_BENCH_PRECHECK`.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { ConfigManager } from "../../../src/config/config.ts";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  cleanupTempDir,
  createTempDir,
  MockEnv,
} from "../../utils/test-helpers.ts";

describe("ConfigManager: bench.infraRetriesPerAttempt", () => {
  let mockEnv: MockEnv;
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    mockEnv = new MockEnv();
    tempDir = await createTempDir("infra-retry-config");
    originalCwd = Deno.cwd();
    // Isolate from any project-level .centralgauge.yml and any home config.
    mockEnv.set("HOME", tempDir);
    mockEnv.set("USERPROFILE", tempDir);
    mockEnv.delete("CENTRALGAUGE_BENCH_INFRA_RETRY");
    Deno.chdir(tempDir);
    ConfigManager.reset();
  });

  afterEach(async () => {
    Deno.chdir(originalCwd);
    mockEnv.restore();
    ConfigManager.reset();
    await cleanupTempDir(tempDir);
  });

  it("resolves the YAML value when bench.infraRetriesPerAttempt is set", async () => {
    await Deno.writeTextFile(
      `${tempDir}/.centralgauge.yml`,
      "bench:\n  infraRetriesPerAttempt: 3\n",
    );

    const config = await ConfigManager.loadConfig();

    assertEquals(config.bench?.infraRetriesPerAttempt, 3);
  });

  it("env var CENTRALGAUGE_BENCH_INFRA_RETRY=0 overrides YAML to 0", async () => {
    await Deno.writeTextFile(
      `${tempDir}/.centralgauge.yml`,
      "bench:\n  infraRetriesPerAttempt: 5\n",
    );
    mockEnv.set("CENTRALGAUGE_BENCH_INFRA_RETRY", "0");

    const config = await ConfigManager.loadConfig();

    assertEquals(config.bench?.infraRetriesPerAttempt, 0);
  });

  it("env var with non-'0' value does NOT override YAML", async () => {
    await Deno.writeTextFile(
      `${tempDir}/.centralgauge.yml`,
      "bench:\n  infraRetriesPerAttempt: 3\n",
    );
    // Per the plan: env var only honors literal "0". Any other value (here "5")
    // leaves the YAML value in effect.
    mockEnv.set("CENTRALGAUGE_BENCH_INFRA_RETRY", "5");

    const config = await ConfigManager.loadConfig();

    assertEquals(config.bench?.infraRetriesPerAttempt, 3);
  });

  it("defaults to 1 when YAML omits the bench section entirely", async () => {
    // No .centralgauge.yml at all in the temp cwd.
    const config = await ConfigManager.loadConfig();

    assertEquals(config.bench?.infraRetriesPerAttempt, 1);
  });

  it("defaults to 1 when YAML has bench section without infraRetriesPerAttempt", async () => {
    await Deno.writeTextFile(
      `${tempDir}/.centralgauge.yml`,
      "bench: {}\n",
    );

    const config = await ConfigManager.loadConfig();

    assertEquals(config.bench?.infraRetriesPerAttempt, 1);
  });

  it("throws ConfigurationError when bench.infraRetriesPerAttempt is negative", async () => {
    await Deno.writeTextFile(
      `${tempDir}/.centralgauge.yml`,
      "bench:\n  infraRetriesPerAttempt: -1\n",
    );

    let caught: unknown;
    try {
      await ConfigManager.loadConfig();
    } catch (err) {
      caught = err;
    }

    assert(
      caught instanceof ConfigurationError,
      `expected ConfigurationError, got ${
        caught instanceof Error ? caught.name : typeof caught
      }`,
    );
    assert(
      (caught as ConfigurationError).message.includes("infraRetriesPerAttempt"),
      "error message should reference infraRetriesPerAttempt",
    );
  });

  it("throws ConfigurationError when bench.infraRetriesPerAttempt is a non-integer", async () => {
    await Deno.writeTextFile(
      `${tempDir}/.centralgauge.yml`,
      "bench:\n  infraRetriesPerAttempt: 1.5\n",
    );

    let caught: unknown;
    try {
      await ConfigManager.loadConfig();
    } catch (err) {
      caught = err;
    }

    assert(
      caught instanceof ConfigurationError,
      `expected ConfigurationError, got ${
        caught instanceof Error ? caught.name : typeof caught
      }`,
    );
  });

  it("throws ConfigurationError when bench.infraRetriesPerAttempt is not a number", async () => {
    await Deno.writeTextFile(
      `${tempDir}/.centralgauge.yml`,
      'bench:\n  infraRetriesPerAttempt: "three"\n',
    );

    let caught: unknown;
    try {
      await ConfigManager.loadConfig();
    } catch (err) {
      caught = err;
    }

    assert(
      caught instanceof ConfigurationError,
      `expected ConfigurationError, got ${
        caught instanceof Error ? caught.name : typeof caught
      }`,
    );
  });

  it("accepts explicit zero in YAML", async () => {
    await Deno.writeTextFile(
      `${tempDir}/.centralgauge.yml`,
      "bench:\n  infraRetriesPerAttempt: 0\n",
    );

    const config = await ConfigManager.loadConfig();

    assertEquals(config.bench?.infraRetriesPerAttempt, 0);
  });
});
