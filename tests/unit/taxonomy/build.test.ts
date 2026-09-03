import { assertEquals } from "@std/assert";
import { buildDraft } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts";
import {
  emitCatalogYaml,
  parseCatalogYaml,
} from "../../../.claude/skills/refresh-task-taxonomy/pipeline/catalog-yaml.ts";
import {
  displayName,
  SURFACE_TAGS,
} from "../../../.claude/skills/refresh-task-taxonomy/pipeline/aliases.ts";
import { FACET_DEFINITIONS } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/facet-definitions.ts";
import { mergeEnrichment } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts";

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

Deno.test("domains map through the alias table like tags do", async () => {
  const { catalog } = await buildDraft(opts);
  const facets = (catalog.tasks["CG-AL-X076"]! as { facets: string[] }).facets;
  // The X-series records object types under `domains:`, in the plural, and
  // nowhere else. Spec 4.4's own X076 example expects codeunit and table.
  assertEquals(facets.includes("codeunit"), true);
  assertEquals(facets.includes("table"), true);
  // "performance" names a concern, not an AL surface: dropped like any unknown
  // value, and it never becomes a facet of its own.
  assertEquals(facets.includes("performance"), false);
  // a manifest with no domains at all is unaffected
  assertEquals((catalog.tasks["CG-AL-H001"]! as { facets: string[] }).facets, [
    "table",
  ]);
});

Deno.test("YAML round-trips and is byte-deterministic", async () => {
  const { catalog } = await buildDraft(opts);
  const text = emitCatalogYaml(catalog);
  assertEquals(emitCatalogYaml(parseCatalogYaml(text)), text);
});

Deno.test("previous catalog carry-over keeps unowned facets and re-derives the rest", async () => {
  const { catalog } = await buildDraft(opts);
  const task = catalog.tasks["CG-AL-H001"]!;
  if (!("donors" in task)) {
    // "inclusive-boundary" is owned by the enrichment file and must NOT be
    // carried over: carrying it would make a facet impossible to remove from
    // the emitted catalog by editing the enrichment. "house-facet" is owned by
    // nothing, so it survives.
    task.facets = [...task.facets, "inclusive-boundary", "house-facet"];
  }
  // Add a task with no manifest (vanished task)
  catalog.tasks["CG-AL-X999"] = {
    group: "build-from-spec",
    facets: ["some-facet"],
    min_bc_version: 15,
  };
  // Build again with previous catalog
  const { catalog: catalog2 } = await buildDraft({
    ...opts,
    previous: catalog,
  });
  const task2 = catalog2.tasks["CG-AL-H001"]!;
  if (!("donors" in task2)) {
    assertEquals(task2.facets.includes("house-facet"), true);
    assertEquals(task2.facets.includes("inclusive-boundary"), false);
    // Surface facet from manifest still present
    assertEquals(task2.facets.includes("table"), true);
  }
  // Vanished task is not in the new catalog
  assertEquals(catalog2.tasks["CG-AL-X999"], undefined);
});

Deno.test("a composite's local_facets survive a rebuild and merge strips only the overlap", async () => {
  const { catalog } = await buildDraft(opts);
  const composite = catalog.tasks["CG-AL-X283"]!;
  if (!("donors" in composite)) throw new Error("X283 must be a composite");
  // "table" is a surface facet donor X076 already carries, so the derivation
  // owns it; "assembly-glue" is introduced by the composite itself.
  composite.local_facets = ["table", "assembly-glue"];

  const { catalog: catalog2 } = await buildDraft({
    ...opts,
    previous: parseCatalogYaml(emitCatalogYaml(catalog)),
  });
  const rebuilt = catalog2.tasks["CG-AL-X283"]!;
  if (!("donors" in rebuilt)) throw new Error("X283 must still be a composite");
  assertEquals(rebuilt.local_facets, ["assembly-glue", "table"]);
  // the derivation is always recomputed, never carried
  assertEquals(rebuilt.derived_facets, []);

  const merged = mergeEnrichment(catalog2, {});
  const derived = merged.tasks["CG-AL-X283"]!;
  if (!("donors" in derived)) throw new Error("X283 must still be a composite");
  assertEquals(derived.derived_facets.includes("table"), true);
  // the overlap is dropped from local, the genuinely local facet stays
  assertEquals(derived.local_facets, ["assembly-glue"]);
});

Deno.test("hand-written tag definitions survive a rebuild", async () => {
  const { catalog } = await buildDraft(opts);
  catalog.tags.push({
    slug: "inclusive-boundary",
    family: "invariant",
    name: "Inclusive Boundary",
    description: FACET_DEFINITIONS["inclusive-boundary"]!,
  });
  // Go through the file on the way back in, the way a real rerun does, so the
  // assertion cannot pass on reference identity alone.
  const { catalog: catalog2 } = await buildDraft({
    ...opts,
    previous: parseCatalogYaml(emitCatalogYaml(catalog)),
  });
  const tag = catalog2.tags.find((t) => t.slug === "inclusive-boundary");
  assertEquals(tag?.description, FACET_DEFINITIONS["inclusive-boundary"]);
});

Deno.test("surface tag names spell acronyms and AL type names correctly", () => {
  const name = (slug: string) =>
    SURFACE_TAGS.find((t) => t.slug === slug)?.name;
  assertEquals(name("json"), "JSON");
  assertEquals(name("http"), "HTTP");
  assertEquals(name("xml"), "XML");
  assertEquals(name("guid"), "GUID");
  assertEquals(name("sift-keys"), "SIFT Keys");
  assertEquals(name("recordref"), "RecordRef");
  assertEquals(name("fieldref"), "FieldRef");
  assertEquals(name("permissionset"), "PermissionSet");
  assertEquals(name("secrettext"), "SecretText");
  assertEquals(name("datatransfer"), "DataTransfer");
  assertEquals(name("flowfield"), "FlowField");
  // a slug with no special word is still plain title case
  assertEquals(name("table-extension"), "Table Extension");
  // vocabulary slugs go through the same speller
  assertEquals(displayName("bounded-sql-cost"), "Bounded SQL Cost");
  assertEquals(
    displayName("tryfunction-write-rollback"),
    "TryFunction Write Rollback",
  );
  assertEquals(displayName("xrec-trigger-state"), "xRec Trigger State");
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
