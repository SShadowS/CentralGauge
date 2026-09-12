import { assert, assertEquals } from "@std/assert";
import {
  buildCanonicalSettings,
  buildLegacyCanonicalSettings,
  extrasJson,
  isLegacyExtras,
  promptProfileDigest,
  settingsHashOf,
} from "../../../shared/settings-hash.ts";
import type {
  CanonicalSettingsExtras,
  LegacyCanonicalSettingsExtras,
} from "../../../shared/settings-hash.ts";

/** The nine-key extras shape every run before the upstream lock hashed. */
const legacyExtras: LegacyCanonicalSettingsExtras = {
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

const extras2: CanonicalSettingsExtras = {
  ...legacyExtras,
  settings_extras_schema: 2,
  upstream_pin: null,
};

Deno.test("extrasJson is canonical (sorted keys, no whitespace)", () => {
  assertEquals(
    extrasJson(extras2),
    '{"continuation":{"enabled":false,"max":0},"empty_retry":{"enabled":false,"max":0},"endpoint":"/v1/messages","fallback_policy":"unavailable","infra_retries_per_attempt":1,"invocation_mode":"batch","prompt_profile_digest":"' +
      "a".repeat(64) +
      '","provider_route":"anthropic","settings_extras_schema":2,"thinking_budget":null,"upstream_pin":null}',
  );
});

Deno.test("buildCanonicalSettings fills the six keys and nothing else", () => {
  const s = buildCanonicalSettings(
    { temperature: 0, max_tokens: 64000 },
    extras2,
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
  assertEquals(s.extra_json, extrasJson(extras2));
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

Deno.test("schema-2 extras hash differently from the same legacy extras", async () => {
  const legacy = await settingsHashOf(
    buildLegacyCanonicalSettings(
      { temperature: 0, max_attempts: 2, max_tokens: 64000 },
      legacyExtras,
    ),
  );
  const v2 = await settingsHashOf(
    buildCanonicalSettings(
      { temperature: 0, max_attempts: 2, max_tokens: 64000 },
      extras2,
    ),
  );
  assert(legacy !== v2);
});

Deno.test("buildLegacyCanonicalSettings reproduces the committed batch-profile fixture hash byte for byte", async () => {
  const fixture = JSON.parse(
    await Deno.readTextFile("shared/fixtures/settings-hash.fixture.json"),
  ) as {
    cases: Array<
      { name: string; settings: Record<string, unknown>; hash: string }
    >;
  };
  const c = fixture.cases.find((x) => x.name === "batch profile");
  if (!c) throw new Error("fixture case 'batch profile' is missing");
  const parsed = JSON.parse(c.settings["extra_json"] as string);
  assertEquals(isLegacyExtras(parsed), true);
  const rebuilt = buildLegacyCanonicalSettings(
    {
      temperature: 0,
      max_attempts: 2,
      max_tokens: 64000,
      prompt_version: null,
      bc_version: null,
    },
    parsed,
  );
  assertEquals(rebuilt.extra_json, c.settings["extra_json"]);
  assertEquals(await settingsHashOf(rebuilt), c.hash);
});

Deno.test("isLegacyExtras is false once settings_extras_schema is present", () => {
  assertEquals(isLegacyExtras(extras2), false);
  assertEquals(
    isLegacyExtras({
      ...extras2,
      settings_extras_schema: 2,
      upstream_pin: "novita/fp8",
    }),
    false,
  );
  assertEquals(isLegacyExtras(null), false);
  assertEquals(isLegacyExtras({ provider_route: 7 }), false);
});

Deno.test("buildLegacyCanonicalSettings drops any schema-2 keys a caller leaks in", () => {
  const leaked = {
    ...legacyExtras,
    settings_extras_schema: 2,
    upstream_pin: "novita/fp8",
  } as unknown as LegacyCanonicalSettingsExtras;
  const rebuilt = buildLegacyCanonicalSettings({ temperature: 0 }, leaked);
  assertEquals(
    rebuilt.extra_json,
    buildLegacyCanonicalSettings({ temperature: 0 }, legacyExtras).extra_json,
  );
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
