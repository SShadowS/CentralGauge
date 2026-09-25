import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  checkModelsInCatalog,
  ComponentsSchema,
  effectiveLimits,
  loadConfig,
  loadExperiment,
} from "../../../src/harness/config.ts";
import { ConfigurationError } from "../../../src/errors.ts";

const CONFIG = (id: string, extra = "") =>
  `id: ${id}
harness: claude-code
harness_version: 2.1.282
models:
  main: anthropic/model-a
components:
  skills: bundles/al-skills/skills
  mcp: [al-tools]
limits: { timeout_min: 30, max_budget_usd: 5 }
${extra}`;

const EXPERIMENT = `id: skills-vs-plain
hypothesis: Skills cut cost per solved task.
primary_metric: cost_per_solved_task
baseline: cc-plain
variants: [cc-skills]
vary: [skills]
tasks: "harness-tasks/tasks/*"
`;

async function harnessRoot(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(join(root, "bundles", "al-skills", "skills"), {
    recursive: true,
  });
  for (const [rel, text] of Object.entries(files)) {
    await Deno.mkdir(join(root, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(root, rel), text);
  }
  return root;
}

Deno.test("loadConfig: defaults for unlisted components", async () => {
  const root = await harnessRoot({ "configs/cc-a.yml": CONFIG("cc-a") });
  const c = await loadConfig(root, "cc-a");
  assertEquals(c.components.instructions, null);
  assertEquals(c.components.plugins, []);
  assertEquals(c.components.mcp, ["al-tools"]);
  assertEquals(c.settings, {});
});

Deno.test("loadConfig: rejects unknown component, bad model id, id mismatch, missing bundle", async () => {
  const cases: Array<[string, string, string]> = [
    [CONFIG("cc-a").replace("mcp:", "mcps:"), "mcps", "ValidationError"],
    [
      CONFIG("cc-a").replace("anthropic/model-a", "model-a"),
      "provider/model",
      "ValidationError",
    ],
    [CONFIG("cc-b"), "does not match file name", "ValidationError"],
    [
      CONFIG("cc-a").replace("al-skills/skills", "nope"),
      "not found",
      "ConfigurationError",
    ],
    [
      CONFIG("cc-a").replace(
        "limits: { timeout_min: 30, max_budget_usd: 5 }",
        "",
      ),
      "limits",
      "ValidationError",
    ],
  ];
  for (const [yml, needle, cls] of cases) {
    const root = await harnessRoot({ "configs/cc-a.yml": yml });
    const err = await assertRejects(() => loadConfig(root, "cc-a"));
    assertEquals((err as Error).name, cls);
    assertStringIncludes((err as Error).message, needle);
  }
});

Deno.test("loadExperiment: loads baseline then variants, repeats defaults to 3", async () => {
  const root = await harnessRoot({
    "configs/cc-plain.yml": CONFIG("cc-plain"),
    "configs/cc-skills.yml": CONFIG("cc-skills"),
    "experiments/skills-vs-plain.yml": EXPERIMENT,
  });
  const { experiment, configs } = await loadExperiment(root, "skills-vs-plain");
  assertEquals(experiment.repeats, 3);
  assertEquals(configs.map((c) => c.id), ["cc-plain", "cc-skills"]);
});

Deno.test("loadExperiment: rejects missing hypothesis, unknown vary key, baseline listed as variant, missing config", async () => {
  const cases: Array<[string, string]> = [
    [
      EXPERIMENT.replace("Skills cut cost per solved task.", '"  "'),
      "hypothesis",
    ],
    [EXPERIMENT.replace("vary: [skills]", "vary: [skill]"), "vary"],
    [EXPERIMENT.replace("[cc-skills]", "[cc-skills, cc-plain]"), "distinct"],
    [EXPERIMENT.replace("[cc-skills]", "[cc-missing]"), "cc-missing"],
  ];
  for (const [yml, needle] of cases) {
    const root = await harnessRoot({
      "configs/cc-plain.yml": CONFIG("cc-plain"),
      "configs/cc-skills.yml": CONFIG("cc-skills"),
      "experiments/skills-vs-plain.yml": yml,
    });
    const err = await assertRejects(() =>
      loadExperiment(root, "skills-vs-plain")
    );
    assertStringIncludes((err as Error).message, needle);
  }
});

Deno.test("effectiveLimits: task can only tighten", () => {
  const config = { timeout_min: 30, max_budget_usd: 5 };
  assertEquals(effectiveLimits(config, {}), config);
  assertEquals(effectiveLimits(config, { timeout_min: 20 }), {
    timeout_min: 20,
    max_budget_usd: 5,
  });
  assertEquals(
    effectiveLimits(config, { timeout_min: 60, max_budget_usd: 2 }),
    { timeout_min: 30, max_budget_usd: 2 },
  );
});

Deno.test("checkModelsInCatalog: known slugs pass, unknown or missing catalog fail", async () => {
  const root = await harnessRoot({
    "configs/cc-a.yml": CONFIG("cc-a"),
    "catalog/models.yml":
      "- slug: anthropic/model-a\n  api_model_id: model-a\n",
  });
  const config = await loadConfig(root, "cc-a");
  await checkModelsInCatalog([config], join(root, "catalog"));
  const other = { ...config, models: { main: "anthropic/model-z" } };
  await assertRejects(
    () => checkModelsInCatalog([other], join(root, "catalog")),
    ConfigurationError,
    "cc-a.models.main: anthropic/model-z",
  );
  await assertRejects(
    () => checkModelsInCatalog([config], join(root, "nope")),
    ConfigurationError,
  );
});

Deno.test("loadConfig: component paths must stay inside the harness root", async () => {
  for (const bad of ["..", "bundles/../../x", "/abs/skills", "C:/abs/skills"]) {
    const root = await harnessRoot({
      "configs/cc-a.yml": CONFIG("cc-a").replace(
        "bundles/al-skills/skills",
        bad,
      ),
    });
    const err = await assertRejects(() => loadConfig(root, "cc-a"));
    assertEquals((err as Error).name, "ValidationError", bad);
    assertStringIncludes((err as Error).message, "cc-a.yml");
    assertStringIncludes((err as Error).message, "relative path");
  }
});

Deno.test("checkModelsInCatalog: malformed or empty catalog fails naming the file", async () => {
  for (const body of ["- slug: [unclosed\n", "slug: anthropic/model-a\n", ""]) {
    const root = await harnessRoot({
      "configs/cc-a.yml": CONFIG("cc-a"),
      "catalog/models.yml": body,
    });
    const config = await loadConfig(root, "cc-a");
    const err = await assertRejects(
      () => checkModelsInCatalog([config], join(root, "catalog")),
      ConfigurationError,
    );
    assertStringIncludes((err as Error).message, "models.yml");
  }
});

Deno.test("loadExperiment: duplicate vary keys are refused", async () => {
  const root = await harnessRoot({
    "configs/cc-plain.yml": CONFIG("cc-plain"),
    "configs/cc-skills.yml": CONFIG("cc-skills"),
    "experiments/skills-vs-plain.yml": EXPERIMENT.replace(
      "vary: [skills]",
      "vary: [skills, skills]",
    ),
  });
  const err = await assertRejects(() =>
    loadExperiment(root, "skills-vs-plain")
  );
  assertEquals((err as Error).name, "ValidationError");
  assertStringIncludes((err as Error).message, "vary: duplicate key skills");
  assertStringIncludes((err as Error).message, "skills-vs-plain.yml");
});

Deno.test("ComponentsSchema: duplicate list entries are refused", () => {
  const cases: Record<string, string[]> = {
    mcp: ["al-tools", "al-tools"],
    lsp: ["al", "al"],
    plugins: ["plugins/x", "plugins/x"],
    toolchain: ["altool@1.0.0", "altool@1.0.0"],
  };
  for (const [key, list] of Object.entries(cases)) {
    const r = ComponentsSchema.safeParse({ [key]: list });
    assertEquals(r.success, false, `${key} accepted a duplicate`);
    assertEquals(
      ComponentsSchema.safeParse({ [key]: [list[0]] }).success,
      true,
    );
  }
});
