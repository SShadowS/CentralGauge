// Step 3 of the refresh: fold the enrichment workflow's mechanism/invariant/
// environment facets into the draft, then derive every composite.
// Usage: deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts [--enriched path] [--catalog path]
import {
  type CatalogTag,
  type CatalogV2,
  ENVIRONMENT_VOCAB,
  INVARIANT_VOCAB,
  isComposite,
  MECHANISM_VOCAB,
} from "../../../../site/src/lib/shared/taxonomy-schema.ts";
import { displayName } from "./aliases.ts";
import { FACET_DEFINITIONS } from "./facet-definitions.ts";
import { emitCatalogYaml, parseCatalogYaml } from "./catalog-yaml.ts";

const VOCAB_FAMILY = new Map<string, "mechanism" | "invariant" | "environment">(
  [
    ...MECHANISM_VOCAB.map((s) => [s, "mechanism"] as const),
    ...INVARIANT_VOCAB.map((s) => [s, "invariant"] as const),
    ...ENVIRONMENT_VOCAB.map((s) => [s, "environment"] as const),
  ],
);

export function deriveComposites(c: CatalogV2): CatalogV2 {
  for (const e of Object.values(c.tasks)) {
    if (!isComposite(e)) continue;
    const union = new Set<string>();
    let max = 15;
    for (const d of e.donors) {
      const donor = c.tasks[d];
      if (!donor || isComposite(donor)) continue; // the validator reports these
      for (const f of donor.facets) union.add(f);
      max = Math.max(max, donor.min_bc_version);
    }
    e.derived_facets = [...union].sort();
    e.local_facets = e.local_facets.filter((f) => !union.has(f)).sort();
    e.min_bc_version = max;
  }
  return c;
}

export function mergeEnrichment(
  catalog: CatalogV2,
  enriched: Record<string, string[]>,
): CatalogV2 {
  const c: CatalogV2 = structuredClone(catalog);
  const have = new Set(c.tags.map((t) => t.slug));
  for (const [id, slugs] of Object.entries(enriched)) {
    const e = c.tasks[id];
    if (!e) {
      // A renamed or deleted task leaves its entry behind in the enrichment
      // file, where it would otherwise rot unseen. Not fatal: the merge still
      // has to produce a catalog for every task that does exist.
      console.error(`[WARN] enrichment id not in catalog: ${id}`);
      continue;
    }
    if (isComposite(e)) continue; // composites never take enrichment directly
    for (const s of slugs) {
      const fam = VOCAB_FAMILY.get(s);
      if (!fam) {
        throw new Error(
          `enrichment for ${id} uses "${s}", not in the mechanism/invariant/environment vocabulary`,
        );
      }
      if (!have.has(s)) {
        const tag: CatalogTag = {
          slug: s,
          family: fam,
          name: displayName(s),
          description: FACET_DEFINITIONS[s] ?? `${displayName(s)} (${fam}).`,
        };
        c.tags.push(tag);
        have.add(s);
      }
      if (!e.facets.includes(s)) e.facets.push(s);
    }
    e.facets.sort();
  }
  // The definitions file and the slug speller own every vocabulary tag's
  // description and name, so re-stamp them: a catalog written before a
  // definition was added, or before a spelling was corrected, is brought back
  // in line here instead of keeping a stale generated placeholder forever.
  for (const t of c.tags) {
    if (!VOCAB_FAMILY.has(t.slug)) continue;
    t.name = displayName(t.slug);
    const def = FACET_DEFINITIONS[t.slug];
    if (def) t.description = def;
  }
  return deriveComposites(c);
}

if (import.meta.main) {
  const arg = (k: string, d: string) =>
    Deno.args.includes(k) ? Deno.args[Deno.args.indexOf(k) + 1]! : d;
  const catalogPath = arg("--catalog", "site/catalog/task-categories.yml");
  const enrichedPath = arg(
    "--enriched",
    ".claude/skills/refresh-task-taxonomy/pipeline/enriched-tags.json",
  );
  const catalog = parseCatalogYaml(await Deno.readTextFile(catalogPath));
  const enriched = JSON.parse(
    await Deno.readTextFile(enrichedPath),
  ) as Record<string, string[]>;
  const merged = mergeEnrichment(catalog, enriched);
  await Deno.writeTextFile(catalogPath, emitCatalogYaml(merged));
  const n = Object.values(merged.tasks).filter((e) =>
    !isComposite(e) && e.facets.some((f) =>
      VOCAB_FAMILY.has(f)
    )
  ).length;
  console.log(
    `merged; ${n} singles carry a mechanism/invariant/environment facet; ${merged.tags.length} tags`,
  );
}
