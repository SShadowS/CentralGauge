import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { basename, join } from "@std/path";
import { ConfigurationError, ValidationError } from "../../../src/errors.ts";
import {
  type HarnessConfig,
  HarnessConfigSchema,
} from "../../../src/harness/config.ts";
import {
  assertVaryHolds,
  diffManifests,
  executionMismatch,
  forTask,
  manifestHash,
  ResolvedManifestSchema,
  resolveManifest,
  type RuntimeFacts,
} from "../../../src/harness/manifest.ts";

const FACTS: RuntimeFacts = {
  native_settings: { model: "model-a", effort: "high" },
  image: { digest: "sha256:img1", base_digest: "sha256:base1" },
  backend_version: "cg-al-backend@1",
  servers: { "al-tools": { version: "1.0.0", tool_schema_hash: "s1" } },
  provider_routes: { main: "anthropic" },
};

async function root(): Promise<string> {
  const r = await Deno.makeTempDir();
  for (
    const [rel, text] of Object.entries({
      "bundles/al/skills/objid/SKILL.md": "Allocate object ids.",
      "bundles/al/skills/.hidden/manifest.json": "{}",
      "bundles/al/nudge.md": "Consider your skills.",
    })
  ) {
    await Deno.mkdir(join(r, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(r, rel), text);
  }
  return r;
}

function config(
  id: string,
  components: Record<string, unknown> = {},
): HarnessConfig {
  return HarnessConfigSchema.parse({
    id,
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/model-a" },
    components,
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
}

const GOLDEN = {
  v: 1,
  rules: "hr1",
  config_id: "golden",
  harness: "claude-code",
  harness_version: "2.1.282",
  models: { main: "anthropic/model-a" },
  settings: { requested: { reasoning: "high" }, native: { effort: "high" } },
  limits: { timeout_min: 30, max_budget_usd: 5 },
  instructions: null,
  skills: null,
  agents: null,
  hooks: null,
  plugins: [],
  mcp: [{ name: "al-tools", version: "1.0.0", tool_schema_hash: "s1" }],
  lsp: [],
  toolchain: [],
  image: { digest: "sha256:img1", base_digest: "sha256:base1" },
  backend_version: "b1",
  provider_routes: { main: "anthropic" },
};

Deno.test("manifestHash: golden resolved manifest", async () => {
  const m = ResolvedManifestSchema.parse(GOLDEN);
  assertEquals(
    await manifestHash(m),
    "6ae14d261de04f54c09e5e9d8585ad15a3537c757e9cb5f7dcb07e7b08cfdf40",
  );
});

Deno.test("manifestHash: config name is not identity, content is", async () => {
  const r = await root();
  const a = await resolveManifest(r, config("cc-a"), FACTS);
  const b = await resolveManifest(r, config("cc-b"), FACTS);
  assertEquals(await manifestHash(a), await manifestHash(b));
  const c = await resolveManifest(
    r,
    config("cc-c", { skills: "bundles/al/skills" }),
    FACTS,
  );
  assertNotEquals(await manifestHash(a), await manifestHash(c));
});

Deno.test("resolveManifest: a hidden bundle file edit changes only the skills hash", async () => {
  const r = await root();
  const cfg = config("cc-a", {
    skills: "bundles/al/skills",
    instructions: "bundles/al/nudge.md",
  });
  const before = await resolveManifest(r, cfg, FACTS);
  await Deno.writeTextFile(
    join(r, "bundles/al/skills/.hidden/manifest.json"),
    '{"hook":true}',
  );
  const after = await resolveManifest(r, cfg, FACTS);
  assertEquals(await diffManifests(before, after), ["skills"]);
});

Deno.test("resolveManifest: native settings are part of settings identity", async () => {
  const r = await root();
  const a = await resolveManifest(r, config("a"), FACTS);
  const b = await resolveManifest(r, config("a"), {
    ...FACTS,
    native_settings: { model: "model-a", effort: "low" },
  });
  assertEquals(await diffManifests(a, b), ["settings"]);
});

Deno.test("resolveManifest: missing MCP facts or provider route is refused", async () => {
  const r = await root();
  await assertRejects(
    () => resolveManifest(r, config("cc-a", { mcp: ["other"] }), FACTS),
    ConfigurationError,
    "other",
  );
  await assertRejects(
    () => resolveManifest(r, config("cc-a"), { ...FACTS, provider_routes: {} }),
    ConfigurationError,
    "no provider route for model slot(s) main",
  );
});

Deno.test("assertVaryHolds: inside vary passes, outside is refused", async () => {
  const r = await root();
  const base = await resolveManifest(r, config("plain"), FACTS);
  const skills = await resolveManifest(
    r,
    config("skills", { skills: "bundles/al/skills" }),
    FACTS,
  );
  await assertVaryHolds(base, skills, ["skills"]);
  const both = await resolveManifest(
    r,
    config("both", { skills: "bundles/al/skills", mcp: ["al-tools"] }),
    FACTS,
  );
  await assertRejects(
    () => assertVaryHolds(base, both, ["skills"]),
    ConfigurationError,
    "outside vary [skills]: mcp",
  );
  await assertVaryHolds(base, both, ["skills", "mcp"]);
});

Deno.test("assertVaryHolds: MCP server version bump counts as an mcp difference", async () => {
  const r = await root();
  const cfg = config("x", { mcp: ["al-tools"] });
  const a = await resolveManifest(r, cfg, FACTS);
  const b = await resolveManifest(r, cfg, {
    ...FACTS,
    servers: { "al-tools": { version: "1.0.1", tool_schema_hash: "s1" } },
  });
  assertEquals(await diffManifests(a, b), ["mcp"]);
  await assertRejects(
    () => assertVaryHolds(a, b, ["skills"]),
    ConfigurationError,
  );
});

Deno.test("assertVaryHolds: image follows harness_version, backend never varies", async () => {
  const r = await root();
  const a = await resolveManifest(r, config("a"), FACTS);
  const b = await resolveManifest(
    r,
    { ...config("b"), harness_version: "2.1.300" },
    { ...FACTS, image: { digest: "sha256:img2", base_digest: "sha256:base1" } },
  );
  await assertVaryHolds(a, b, ["harness_version"]);
  await assertRejects(
    () => assertVaryHolds(a, b, ["skills"]),
    ConfigurationError,
  );
  const c = await resolveManifest(r, config("c"), {
    ...FACTS,
    backend_version: "cg-al-backend@2",
  });
  await assertRejects(
    () => assertVaryHolds(a, c, ["harness", "models", "skills", "mcp"]),
    ConfigurationError,
    "backend_version",
  );
});

Deno.test("assertVaryHolds: a manifest under other hashing rules is refused", async () => {
  const r = await root();
  const a = await resolveManifest(r, config("a"), FACTS);
  const old = { ...a, config_id: "old", rules: "hr0" };
  await assertRejects(
    () => assertVaryHolds(a, old, ["skills"]),
    ConfigurationError,
    "rules hr0",
  );
});

Deno.test("forTask: task limits tighten the execution, not the arm", async () => {
  const r = await root();
  const template = await resolveManifest(r, config("a"), FACTS);
  const exec = forTask(template, { timeout_min: 20 });
  assertEquals(exec.limits, { timeout_min: 20, max_budget_usd: 5 });
  assertEquals(template.limits.timeout_min, 30);
  assertEquals(
    await executionMismatch(template, exec, { timeout_min: 20 }),
    [],
  );
  const other = await resolveManifest(
    r,
    config("a", { skills: "bundles/al/skills" }),
    FACTS,
  );
  assertEquals(await executionMismatch(template, other, {}), [
    "component skills differs from the arm template with task limits",
  ]);
});

Deno.test("executionMismatch: any limit other than the exact task-effective one is caught", async () => {
  const r = await root();
  const template = await resolveManifest(r, config("a"), FACTS);
  const tighter = {
    ...template,
    limits: { timeout_min: 1, max_budget_usd: 5 },
  };
  const looser = {
    ...template,
    limits: { timeout_min: 60, max_budget_usd: 5 },
  };
  for (const m of [tighter, looser]) {
    assertEquals(await executionMismatch(template, m, {}), [
      "component limits differs from the arm template with task limits",
    ]);
  }
});

Deno.test("ResolvedManifestSchema: nonpositive limits are refused", () => {
  for (
    const limits of [{ timeout_min: 0, max_budget_usd: 5 }, {
      timeout_min: 30,
      max_budget_usd: 0,
    }]
  ) {
    const r = ResolvedManifestSchema.safeParse({
      ...ResolvedManifestSchema.parse(GOLDEN),
      limits,
    });
    assertEquals(r.success, false);
  }
});

Deno.test("resolveManifest: a link between the harness root and a component is refused", async () => {
  const r = await root();
  const outside = await Deno.makeTempDir();
  await Deno.mkdir(join(outside, "skills"));
  await Deno.writeTextFile(join(outside, "skills", "SKILL.md"), "x");
  await Deno.symlink(outside, join(r, "bundles", "linked"), {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
  for (const skills of ["bundles/linked/skills", "bundles/linked"]) {
    await assertRejects(
      () => resolveManifest(r, config("cc-a", { skills }), FACTS),
      ValidationError,
      "link or reparse point",
    );
  }
});

Deno.test("resolveManifest: a component path outside the harness root is refused", async () => {
  const r = await root();
  const outside = await Deno.makeTempDir();
  await Deno.writeTextFile(join(outside, "SKILL.md"), "x");
  const rel = `../${basename(outside)}`;
  const base = config("cc-a");
  const cfg = { ...base, components: { ...base.components, skills: rel } };
  await assertRejects(
    () => resolveManifest(r, cfg, FACTS),
    ValidationError,
    "outside",
  );
});

Deno.test("ResolvedManifestSchema: route keys must equal model slots as a set", () => {
  const r = ResolvedManifestSchema.safeParse({
    ...ResolvedManifestSchema.parse(GOLDEN),
    models: { "a,b": "anthropic/model-a" },
    provider_routes: { a: "anthropic", b: "anthropic" },
  });
  assertEquals(r.success, false);
});
