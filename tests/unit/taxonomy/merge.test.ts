import { assertEquals } from "@std/assert";
import { buildDraft } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts";
import { mergeEnrichment } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts";
import { validateCatalog } from "../../../site/src/lib/shared/taxonomy-schema.ts";

const opts = {
  tasksDir: "tests/fixtures/taxonomy/manifests",
  starterDir: "tests/fixtures/taxonomy/starter",
};

Deno.test("enrichment adds vocabulary facets to singles and composites derive the union", async () => {
  const { catalog } = await buildDraft(opts);
  // give every donor of X283 a facet so the union is observable
  const enriched: Record<string, string[]> = {
    "CG-AL-X076": ["tryfunction-write-rollback", "multi-company"],
    "CG-AL-H001": ["inclusive-boundary"],
  };
  for (
    const d of (catalog.tasks["CG-AL-X283"] as { donors: string[] }).donors
  ) {
    enriched[d] ??= ["exact-total"];
  }
  const merged = mergeEnrichment(catalog, enriched);
  const x076 = merged.tasks["CG-AL-X076"] as { facets: string[] };
  assertEquals(x076.facets.includes("tryfunction-write-rollback"), true);
  assertEquals(x076.facets.includes("multi-company"), true);
  const comp = merged.tasks["CG-AL-X283"] as {
    derived_facets: string[];
    min_bc_version: number;
  };
  assertEquals(
    comp.derived_facets.includes("tryfunction-write-rollback"),
    true,
  );
  assertEquals(comp.derived_facets.includes("multi-company"), true);
  assertEquals(
    merged.tags.some((t) =>
      t.slug === "tryfunction-write-rollback" && t.family === "mechanism"
    ),
    true,
  );
  assertEquals(
    validateCatalog(merged).filter(
      (i) => i.code !== "unresolved_donor" && i.code !== "donor_not_single",
    ),
    [],
  );
});

Deno.test("unknown enrichment slugs are refused, not silently dropped", async () => {
  const { catalog } = await buildDraft(opts);
  let threw = false;
  try {
    mergeEnrichment(catalog, { "CG-AL-X076": ["made-up"] });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("the enrichment workflow's VOCAB equals the shared vocabulary", async () => {
  const js = await Deno.readTextFile(
    ".claude/skills/refresh-task-taxonomy/pipeline/enrich-task-tags.workflow.js",
  );
  const m = /const VOCAB = \[([\s\S]*?)\];/.exec(js);
  const inJs = [...(m?.[1] ?? "").matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1])
    .sort();
  const { MECHANISM_VOCAB, INVARIANT_VOCAB, ENVIRONMENT_VOCAB } = await import(
    "../../../site/src/lib/shared/taxonomy-schema.ts"
  );
  assertEquals(
    inJs,
    [...MECHANISM_VOCAB, ...INVARIANT_VOCAB, ...ENVIRONMENT_VOCAB].sort(),
  );
});
