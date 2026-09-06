import { assertEquals } from "@std/assert";
import {
  buildCanonicalSettings,
  extrasJson,
  promptProfileDigest,
  settingsHashOf,
} from "../../../shared/settings-hash.ts";
import type { CanonicalSettingsExtras } from "../../../shared/settings-hash.ts";

const extras: CanonicalSettingsExtras = {
  invocation_mode: "batch",
  continuation: { enabled: false, max: 0 },
  empty_retry: { enabled: false, max: 0 },
  fallback_policy: "unavailable",
  provider_route: "anthropic",
  endpoint: "/v1/messages",
  thinking_budget: null,
  prompt_profile_digest: "a".repeat(64),
  infra_retries_per_attempt: 1,
};

Deno.test("extrasJson is canonical (sorted keys, no whitespace)", () => {
  assertEquals(
    extrasJson(extras),
    '{"continuation":{"enabled":false,"max":0},"empty_retry":{"enabled":false,"max":0},"endpoint":"/v1/messages","fallback_policy":"unavailable","infra_retries_per_attempt":1,"invocation_mode":"batch","prompt_profile_digest":"' +
      "a".repeat(64) + '","provider_route":"anthropic","thinking_budget":null}',
  );
});

Deno.test("buildCanonicalSettings fills the six keys and nothing else", () => {
  const s = buildCanonicalSettings(
    { temperature: 0, max_tokens: 64000 },
    extras,
  );
  assertEquals(Object.keys(s).sort(), [
    "bc_version",
    "extra_json",
    "max_attempts",
    "max_tokens",
    "prompt_version",
    "temperature",
  ]);
  assertEquals(s.max_attempts, null);
  assertEquals(s.extra_json, extrasJson(extras));
});

Deno.test("settingsHashOf matches the committed fixture and hashes legacy null/string extra_json unchanged", async () => {
  const fixture = JSON.parse(
    await Deno.readTextFile("shared/fixtures/settings-hash.fixture.json"),
  ) as {
    cases: Array<
      { name: string; settings: Record<string, unknown>; hash: string }
    >;
  };
  for (const c of fixture.cases) {
    assertEquals(await settingsHashOf(c.settings), c.hash, c.name);
  }
});

Deno.test("promptProfileDigest is stable and sensitive to every part", async () => {
  const base = {
    overrides: { prefix: "p" },
    knowledge: "k",
    variantSystemPrompt: null,
  };
  const d1 = await promptProfileDigest(base);
  assertEquals(d1.length, 64);
  assertEquals(await promptProfileDigest({ ...base }), d1);
  assertEquals(
    (await promptProfileDigest({ ...base, knowledge: "k2" })) === d1,
    false,
  );
  assertEquals(
    (await promptProfileDigest({ ...base, variantSystemPrompt: "s" })) === d1,
    false,
  );
});
