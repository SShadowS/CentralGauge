import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  ConfigManager,
  upstreamPinFor,
  validateOpenRouterConfig,
} from "../../../src/config/config.ts";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  cleanupTempDir,
  createTempDir,
  MockEnv,
} from "../../utils/test-helpers.ts";

Deno.test("validateOpenRouterConfig accepts a slug map and rejects malformed entries", () => {
  assertEquals(validateOpenRouterConfig(undefined), undefined);
  const ok = {
    upstream: {
      "z-ai/glm-5.3": "fireworks",
      "google/gemini-3.8-flash": "google-vertex/global",
    },
  };
  assertEquals(validateOpenRouterConfig(ok), ok);

  assertThrows(
    () => validateOpenRouterConfig({ upstream: { "z-ai/glm-5.3": "" } }),
    ConfigurationError,
    "non-empty",
  );
  assertThrows(
    () =>
      validateOpenRouterConfig({
        upstream: { "z-ai/glm-5.3": "Fireworks FP8" },
      }),
    ConfigurationError,
    "slug",
  );
  assertThrows(
    () => validateOpenRouterConfig({ upstream: "fireworks" } as never),
    ConfigurationError,
    "object",
  );
  assertThrows(
    () => validateOpenRouterConfig({ upstream: {}, other: 1 } as never),
    ConfigurationError,
    "unknown key",
  );
});

Deno.test("upstreamPinFor answers only for openrouter models", () => {
  const cfg = { openrouter: { upstream: { "z-ai/glm-5.3": "fireworks" } } };
  assertEquals(upstreamPinFor(cfg, "openrouter", "z-ai/glm-5.3"), "fireworks");
  assertEquals(upstreamPinFor(cfg, "openrouter", "z-ai/glm-5.2"), undefined);
  assertEquals(upstreamPinFor(cfg, "anthropic", "z-ai/glm-5.3"), undefined);
  assertEquals(upstreamPinFor({}, "openrouter", "z-ai/glm-5.3"), undefined);
});

Deno.test("openrouter.upstream merges per key: project overrides home, disjoint keys survive", async () => {
  const home = await createTempDir("home");
  const cwd = await createTempDir("cwd");
  const env = new MockEnv();
  const originalCwd = Deno.cwd();
  try {
    await Deno.writeTextFile(
      join(home, ".centralgauge.yml"),
      'openrouter:\n  upstream:\n    "z-ai/glm-5.3": fireworks\n    "minimax/minimax-m3": novita/fp8\n',
    );
    await Deno.writeTextFile(
      join(cwd, ".centralgauge.yml"),
      'openrouter:\n  upstream:\n    "z-ai/glm-5.3": novita/fp8\n',
    );
    env.set("HOME", home);
    env.set("USERPROFILE", home);
    Deno.chdir(cwd);
    ConfigManager.reset();
    const cfg = await ConfigManager.loadConfig();
    assertEquals(cfg.openrouter?.upstream, {
      "z-ai/glm-5.3": "novita/fp8",
      "minimax/minimax-m3": "novita/fp8",
    });
  } finally {
    Deno.chdir(originalCwd);
    env.restore();
    ConfigManager.reset();
    await cleanupTempDir(home);
    await cleanupTempDir(cwd);
  }
});
