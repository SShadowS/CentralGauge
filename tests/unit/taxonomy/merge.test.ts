import { assertEquals } from "@std/assert";
import { buildDraft } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts";
import {
  deriveComposites,
  mergeEnrichment,
} from "../../../.claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts";
import { FACET_DEFINITIONS } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/facet-definitions.ts";
import {
  type CatalogV2,
  validateCatalog,
} from "../../../site/src/lib/shared/taxonomy-schema.ts";

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

Deno.test("deriveComposites strips overlapping local_facets, keeps the rest, unions derived_facets, and maxes min_bc_version", () => {
  // Synthetic catalog (not the fixture manifests): a composite with four
  // donors whose facets exercise the overlap-stripping rule directly.
  const catalog: CatalogV2 = {
    schema_version: 2,
    groups: [],
    families: [],
    tags: [],
    aliases: [],
    overrides: [],
    tasks: {
      "D1": {
        group: "diagnose-single",
        facets: ["facet-a"],
        min_bc_version: 15,
      },
      "D2": {
        group: "diagnose-single",
        facets: ["facet-b"],
        min_bc_version: 16,
      },
      "D3": {
        group: "diagnose-single",
        facets: ["facet-c"],
        min_bc_version: 15,
      },
      "D4": {
        group: "diagnose-single",
        facets: ["facet-a", "facet-d"],
        min_bc_version: 18,
      },
      "C1": {
        group: "diagnose-composite",
        donors: ["D1", "D2", "D3", "D4"],
        derived_facets: [],
        // "facet-b" duplicates donor D2's facet and must be stripped;
        // "facet-local-only" duplicates no donor and must survive.
        local_facets: ["facet-b", "facet-local-only"],
        min_bc_version: 15,
      },
    },
  };
  const derived = deriveComposites(catalog);
  const comp = derived.tasks["C1"];
  if (!comp || !("donors" in comp)) throw new Error("C1 must be a composite");
  assertEquals(comp.derived_facets, [
    "facet-a",
    "facet-b",
    "facet-c",
    "facet-d",
  ]);
  assertEquals(comp.local_facets, ["facet-local-only"]);
  assertEquals(comp.min_bc_version, 18);
});

Deno.test("mergeEnrichment warns on an unknown task id, skips a composite id, and applies a valid single entry", () => {
  const catalog: CatalogV2 = {
    schema_version: 2,
    groups: [],
    families: [],
    tags: [],
    aliases: [],
    overrides: [],
    tasks: {
      "S1": { group: "diagnose-single", facets: [], min_bc_version: 15 },
      "S2": { group: "diagnose-single", facets: [], min_bc_version: 15 },
      "C1": {
        group: "diagnose-composite",
        donors: ["S2"],
        derived_facets: [],
        local_facets: [],
        min_bc_version: 15,
      },
    },
  };
  const warnings: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void warnings.push(args.join(" "));
  let merged;
  try {
    merged = mergeEnrichment(catalog, {
      "S1": ["inclusive-boundary"],
      "CG-AL-DOES-NOT-EXIST": ["exact-total"],
      "C1": ["exact-total"],
    });
  } finally {
    console.error = realError;
  }
  // Valid single entry is applied.
  const s1 = merged.tasks["S1"];
  if (!s1 || "donors" in s1) throw new Error("S1 must be a single task");
  assertEquals(s1.facets, ["inclusive-boundary"]);
  // Unknown id: warned about, but the merge still produces a catalog.
  assertEquals(warnings, [
    "[WARN] enrichment id not in catalog: CG-AL-DOES-NOT-EXIST",
  ]);
  // No task materializes for it, and the catalog is otherwise unchanged.
  assertEquals(merged.tasks["CG-AL-DOES-NOT-EXIST"], undefined);
  assertEquals(Object.keys(merged.tasks).sort(), ["C1", "S1", "S2"]);
  // Composite id: enrichment is skipped directly (no facets field to add
  // to); its derived_facets still only reflect its donor S2, which never
  // received enrichment, so "exact-total" never appears on C1 at all.
  const c1 = merged.tasks["C1"];
  if (!c1 || !("donors" in c1)) throw new Error("C1 must be a composite");
  assertEquals("facets" in c1, false);
  assertEquals(c1.derived_facets, []);
});

Deno.test("the enrichment workflow's VOCAB equals the shared vocabulary", async () => {
  const js = await Deno.readTextFile(
    ".claude/skills/refresh-task-taxonomy/pipeline/enrich-task-tags.workflow.js",
  );
  const m = /const VOCAB = \[([\s\S]*?)\];/.exec(js);
  // deno fmt rewrites the script's quotes, so accept either style.
  const inJs = [...(m?.[1] ?? "").matchAll(/["']([a-z0-9-]+)["']/g)]
    .map((x) => x[1])
    .sort();
  const { MECHANISM_VOCAB, INVARIANT_VOCAB, ENVIRONMENT_VOCAB } = await import(
    "../../../site/src/lib/shared/taxonomy-schema.ts"
  );
  assertEquals(
    inJs,
    [...MECHANISM_VOCAB, ...INVARIANT_VOCAB, ...ENVIRONMENT_VOCAB].sort(),
  );
});

Deno.test("every vocabulary slug carries a hand-written definition", async () => {
  const { MECHANISM_VOCAB, INVARIANT_VOCAB, ENVIRONMENT_VOCAB } = await import(
    "../../../site/src/lib/shared/taxonomy-schema.ts"
  );
  const missing = [
    ...MECHANISM_VOCAB,
    ...INVARIANT_VOCAB,
    ...ENVIRONMENT_VOCAB,
  ].filter((s) => !FACET_DEFINITIONS[s]);
  assertEquals(missing, []);
  // definitions are real sentences, not the "Slug (family)." placeholder
  const placeholders = Object.entries(FACET_DEFINITIONS)
    .filter(([, d]) => !d.endsWith(".") || d.length < 40)
    .map(([s]) => s);
  assertEquals(placeholders, []);
});

Deno.test("merge stamps the hand-written definition and refreshes a stale one", () => {
  const catalog: CatalogV2 = {
    schema_version: 2,
    groups: [],
    families: [],
    // a catalog written before the definition existed
    tags: [{
      slug: "exact-total",
      family: "invariant",
      name: "Exact Total",
      description: "Exact Total (invariant).",
    }],
    aliases: [],
    overrides: [],
    tasks: {
      "S1": { group: "diagnose-single", facets: [], min_bc_version: 15 },
    },
  };
  const merged = mergeEnrichment(catalog, {
    "S1": ["exact-total", "inclusive-boundary"],
  });
  const bySlug = (s: string) => merged.tags.find((t) => t.slug === s);
  // a newly created tag takes its definition from the file
  assertEquals(
    bySlug("inclusive-boundary")?.description,
    FACET_DEFINITIONS["inclusive-boundary"],
  );
  // a pre-existing tag has its placeholder refreshed rather than kept
  assertEquals(
    bySlug("exact-total")?.description,
    FACET_DEFINITIONS["exact-total"],
  );
});
