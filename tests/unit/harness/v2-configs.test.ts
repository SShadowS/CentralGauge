import { assert, assertEquals } from "@std/assert";
import {
  checkModelsInCatalog,
  loadConfig,
  loadExperiment,
} from "../../../src/harness/config.ts";

/** Spec v2 section 7: the 2x2 arms differ only in the realistic bundle and the LSP. */
const ARMS = [
  "cc-v2-plain",
  "cc-v2-plain-lsp",
  "cc-v2-realistic",
  "cc-v2-realistic-lsp",
];
const PROBES = [
  "cc-v2-probe-plain",
  "cc-v2-probe-realistic",
  "cc-v2-probe-hooks",
  "cc-v2-probe-subagent",
  "cc-v2-probe-budget",
];

Deno.test("v2 arms: one harness, campaign image revision, model, settings and limit; LSP toggles only lsp", async () => {
  const cfgs = await Promise.all(ARMS.map((a) => loadConfig("harness", a)));
  await checkModelsInCatalog(cfgs, "site/catalog");
  const [plain, plainLsp, real, realLsp] = cfgs;
  for (const c of cfgs) {
    assertEquals(
      [c.harness, c.harness_version, c.image_revision, c.settings],
      // H-03: the campaign arms track the newest Claude Code (resolved at the r3 build).
      ["claude-code", "latest", "3", {}],
      c.id,
    );
    assertEquals(c.models, plain!.models, c.id);
    assertEquals(c.limits, plain!.limits, c.id);
  }
  assertEquals(plain!.components.instructions, "bundles/env/instructions");
  assertEquals(real!.components, {
    ...plain!.components,
    instructions: "bundles/realistic/instructions",
    skills: "bundles/realistic/skills",
    agents: "bundles/realistic/agents",
    mcp: ["al-tools"],
  });
  assertEquals(plainLsp!.components, { ...plain!.components, lsp: ["al"] });
  assertEquals(realLsp!.components, { ...real!.components, lsp: ["al"] });
});

Deno.test("cc-v2-factorial: plain baseline, three variants, vary is exactly the bundle and the LSP", async () => {
  const { experiment, configs } = await loadExperiment(
    "harness",
    "cc-v2-factorial",
  );
  assertEquals(configs.map((c) => c.id), ARMS);
  assertEquals([...experiment.vary].sort(), [
    "agents",
    "instructions",
    "lsp",
    "mcp",
    "skills",
  ]);
  assertEquals(experiment.primary_metric, "cost_per_solved_task");
});

Deno.test("v2 probe configs: developmental, same model; never in an experiment", async () => {
  const plain = await loadConfig("harness", "cc-v2-plain");
  const real = await loadConfig("harness", "cc-v2-realistic");
  const revs = new Set<string | undefined>();
  for (const id of PROBES) {
    const c = await loadConfig("harness", id);
    // H-03: the historical probes stay on their 2.1.282 proof images (frozen evidence).
    assertEquals(
      [c.harness_version, c.models],
      ["2.1.282", plain.models],
      id,
    );
    assert(
      /^3(-dev-M9-(07|13))?$/.test(c.image_revision ?? ""),
      `${id}: ${c.image_revision}`,
    );
    revs.add(c.image_revision);
  }
  assertEquals(revs.size, 1, "every probe config runs the same image revision");
  assertEquals(
    (await loadConfig("harness", "cc-v2-probe-plain")).components,
    plain.components,
  );
  assertEquals(
    (await loadConfig("harness", "cc-v2-probe-realistic")).components,
    real.components,
  );
  assertEquals(
    (await loadConfig("harness", "cc-v2-probe-hooks")).components.hooks,
    "bundles/probe-m9/hooks",
  );
  assertEquals(
    (await loadConfig("harness", "cc-v2-probe-budget")).limits.max_budget_usd,
    0.5,
  );
  for await (const e of Deno.readDir("harness/experiments")) {
    const text = await Deno.readTextFile(`harness/experiments/${e.name}`);
    for (const p of PROBES) assert(!text.includes(p), `${e.name} names ${p}`);
  }
});

/** M10-08b: the M10 proof configs are their arm with only id and the dev revision changed. */
const M10_PROBES: [string, string][] = [
  ["cc-v2-probe-m10-lsp", "cc-v2-plain-lsp"],
  ["cc-v2-probe-m10-plain", "cc-v2-plain"],
  ["cc-v2-probe-m10-realistic", "cc-v2-realistic"],
  ["cc-v2-probe-m10-realistic-lsp", "cc-v2-realistic-lsp"],
];

Deno.test("M10 probe configs: their arm with id and image revision 3-dev-M10-08 only; developmental; never in an experiment", async () => {
  for (const [id, armId] of M10_PROBES) {
    const c = await loadConfig("harness", id);
    const arm = await loadConfig("harness", armId);
    // H-03: the arm now tracks latest; the proof stays on its 2.1.282 image.
    assertEquals(
      c,
      {
        ...arm,
        id,
        harness_version: "2.1.282",
        image_revision: "3-dev-M10-08",
      },
      id,
    );
    const first = (await Deno.readTextFile(`harness/configs/${id}.yml`))
      .split(/\r?\n/)[0];
    assertEquals(
      first,
      "# M10 proof config (developmental). Never part of an experiment.",
      id,
    );
  }
  for await (const e of Deno.readDir("harness/experiments")) {
    const text = await Deno.readTextFile(`harness/experiments/${e.name}`);
    for (const [p] of M10_PROBES) {
      assert(!text.includes(p), `${e.name} names ${p}`);
    }
  }
});

/** H-03: the qualification stub-cell configs (plain + LSP) on the dev image of the resolved version. */
const H03_PROBES: [string, string][] = [
  ["cc-v2-probe-h03-plain", "cc-v2-plain"],
  ["cc-v2-probe-h03-lsp", "cc-v2-plain-lsp"],
];

Deno.test("H-03 probe configs: their arm (latest) with id and image revision 3-dev-H-03b only; developmental; never in an experiment", async () => {
  for (const [id, armId] of H03_PROBES) {
    const c = await loadConfig("harness", id);
    const arm = await loadConfig("harness", armId);
    assertEquals(c, { ...arm, id, image_revision: "3-dev-H-03b" }, id);
    assertEquals(c.harness_version, "latest", id);
    const first = (await Deno.readTextFile(`harness/configs/${id}.yml`))
      .split(/\r?\n/)[0];
    assertEquals(
      first,
      "# H-03 qualification config (developmental). Never part of an experiment.",
      id,
    );
  }
  for await (const e of Deno.readDir("harness/experiments")) {
    const text = await Deno.readTextFile(`harness/experiments/${e.name}`);
    for (const [p] of H03_PROBES) {
      assert(!text.includes(p), `${e.name} names ${p}`);
    }
  }
});

/**
 * H-03 run 002 (orchestrator): the M8-07c arms and the M9-07/M9-13 probes on the H-03 dev image.
 * Each is its source config with only id, harness_version "latest" and image_revision
 * 3-dev-H-03b changed; the old probe configs stay as frozen evidence.
 */
const H03_COPIES: [string, string][] = [
  ["cc-v2-probe-h03-realistic", "cc-v2-realistic"],
  ["cc-v2-probe-h03-realistic-lsp", "cc-v2-realistic-lsp"],
  ["cc-v2-probe-h03-m9-plain", "cc-v2-probe-plain"],
  ["cc-v2-probe-h03-m9-realistic", "cc-v2-probe-realistic"],
  ["cc-v2-probe-h03-m9-hooks", "cc-v2-probe-hooks"],
  ["cc-v2-probe-h03-m9-budget", "cc-v2-probe-budget"],
  ["cc-v2-probe-h03-m9-subagent", "cc-v2-probe-subagent"],
];

Deno.test("H-03 copies of the M8-07c arms and M9 probes: source with id, latest and 3-dev-H-03b only; sources unchanged; never in an experiment", async () => {
  for (const [id, srcId] of H03_COPIES) {
    const c = await loadConfig("harness", id);
    const src = await loadConfig("harness", srcId);
    assertEquals(
      c,
      {
        ...src,
        id,
        harness_version: "latest",
        image_revision: "3-dev-H-03b",
      },
      id,
    );
    const first = (await Deno.readTextFile(`harness/configs/${id}.yml`))
      .split(/\r?\n/)[0];
    assertEquals(
      first,
      "# H-03 qualification config (developmental). Never part of an experiment.",
      id,
    );
  }
  // The frozen M9 probes keep their own version and image.
  for (const id of PROBES) {
    const c = await loadConfig("harness", id);
    assertEquals(c.harness_version, "2.1.282", id);
  }
  for await (const e of Deno.readDir("harness/experiments")) {
    const text = await Deno.readTextFile(`harness/experiments/${e.name}`);
    for (const [p] of H03_COPIES) {
      assert(!text.includes(p), `${e.name} names ${p}`);
    }
  }
});
