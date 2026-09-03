import { assertEquals } from "@std/assert";
import { buildDraft } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts";
import {
  emitCatalogYaml,
  parseCatalogYaml,
} from "../../../.claude/skills/refresh-task-taxonomy/pipeline/catalog-yaml.ts";

const opts = {
  tasksDir: "tests/fixtures/taxonomy/manifests",
  starterDir: "tests/fixtures/taxonomy/starter",
};

Deno.test("build assigns one format per fixture and maps raw tags through the alias table", async () => {
  const { catalog, violations } = await buildDraft(opts);
  assertEquals(violations, {});
  assertEquals(catalog.tasks["CG-AL-H001"]!.group, "build-from-spec");
  assertEquals(catalog.tasks["CG-AL-X001"]!.group, "runtime-trap");
  assertEquals(catalog.tasks["CG-AL-X076"]!.group, "diagnose-single");
  assertEquals(catalog.tasks["CG-AL-X283"]!.group, "diagnose-composite");
  // "calculations" is retired, "rounding" is not a surface: both dropped; "table" survives.
  assertEquals((catalog.tasks["CG-AL-H001"]! as { facets: string[] }).facets, [
    "table",
  ]);
  // try-function is a mechanism alias, so it leaves the surface facets of X001.
  assertEquals(
    (catalog.tasks["CG-AL-X001"]! as { facets: string[] }).facets.includes(
      "try-function",
    ),
    false,
  );
});

Deno.test("YAML round-trips and is byte-deterministic", async () => {
  const { catalog } = await buildDraft(opts);
  const text = emitCatalogYaml(catalog);
  assertEquals(emitCatalogYaml(parseCatalogYaml(text)), text);
});

Deno.test("previous catalog carry-over preserves non-surface facets", async () => {
  const { catalog } = await buildDraft(opts);
  // Add a non-surface facet to H001
  const task = catalog.tasks["CG-AL-H001"]!;
  if (!("donors" in task)) {
    task.facets = [...task.facets, "inclusive-boundary"];
  }
  // Build again with previous catalog
  const { catalog: catalog2 } = await buildDraft({
    ...opts,
    previous: catalog,
  });
  const task2 = catalog2.tasks["CG-AL-H001"]!;
  if (!("donors" in task2)) {
    // Non-surface facet survives
    assertEquals(task2.facets.includes("inclusive-boundary"), true);
    // Surface facet from manifest still present
    assertEquals(task2.facets.includes("table"), true);
  }
});

Deno.test("manifest parse failure records violation and continues", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    // Write a malformed manifest
    await Deno.writeTextFile(
      `${tempDir}/CG-AL-E888.yml`,
      "{ invalid yaml: [unclosed",
    );
    const { violations } = await buildDraft({
      tasksDir: tempDir,
      starterDir: `${tempDir}/starter`,
    });
    // Malformed file is recorded as unparseable
    assertEquals(violations["CG-AL-E888"], ["manifest_unparseable"]);
    // No other violations should exist (only E888 should have failed)
    const otherViolations = Object.entries(violations).filter(
      ([id]) => id !== "CG-AL-E888",
    );
    assertEquals(otherViolations.length, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("id field disagreement with filename records violation and skips", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    // Write a manifest whose id disagrees with filename
    await Deno.writeTextFile(
      `${tempDir}/CG-AL-E888.yml`,
      `id: CG-AL-E999\nprompt_template: code-gen.md`,
    );
    const { violations, catalog } = await buildDraft({
      tasksDir: tempDir,
      starterDir: `${tempDir}/starter`,
    });
    // Mismatch is recorded under filename-derived id
    assertEquals(violations["CG-AL-E888"], ["id_filename_mismatch"]);
    // Task is not in catalog
    assertEquals(catalog.tasks["CG-AL-E888"], undefined);
    assertEquals(catalog.tasks["CG-AL-E999"], undefined);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
