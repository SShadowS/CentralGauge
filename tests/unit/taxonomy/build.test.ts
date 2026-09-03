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
