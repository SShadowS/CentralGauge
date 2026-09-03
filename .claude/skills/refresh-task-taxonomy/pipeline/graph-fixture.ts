// Usage: deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/graph-fixture.ts
import { parse } from "@std/yaml";
import { walk } from "@std/fs/walk";
import {
  buildComponents,
  sliceStats,
} from "../../../../site/src/lib/shared/taxonomy-graph.ts";
import type { CatalogV2 } from "../../../../site/src/lib/shared/taxonomy-schema.ts";

/**
 * The reasoning-only view spans every format, so it is selected by cohort,
 * which the catalog does not carry (cohort is administrative metadata, not a
 * facet). Read it from the manifests instead.
 */
async function cohortIds(cohort: string): Promise<string[]> {
  const ids: string[] = [];
  for await (const e of walk("tasks", { exts: [".yml"], includeDirs: false })) {
    const doc = parse(await Deno.readTextFile(e.path)) as {
      id?: string;
      metadata?: { cohort?: string };
    };
    if (doc?.id && doc.metadata?.cohort === cohort) ids.push(doc.id);
  }
  return ids.sort();
}

const cat = parse(
  await Deno.readTextFile("site/catalog/task-categories.yml"),
) as CatalogV2;
const tasks = Object.entries(cat.tasks).map(([id, e]) => ({
  id,
  donors: "donors" in e ? e.donors : [],
}));
const g = buildComponents(tasks);
const byGroup = (slug: string) =>
  Object.entries(cat.tasks)
    .filter(([, e]) => e.group === slug)
    .map(([id]) => id);
const reasoning = (await cohortIds("reasoning-100")).filter((id) =>
  cat.tasks[id] !== undefined
);
const fixture = {
  generated_from: "site/catalog/task-categories.yml",
  components: Object.fromEntries([...g.componentOf].sort()),
  sizes: g.sizes,
  slices: {
    all: sliceStats(g, tasks.map((t) => t.id)),
    "build-from-spec": sliceStats(g, byGroup("build-from-spec")),
    "runtime-trap": sliceStats(g, byGroup("runtime-trap")),
    "diagnose-single": sliceStats(g, byGroup("diagnose-single")),
    "diagnose-composite": sliceStats(g, byGroup("diagnose-composite")),
    "reasoning-only": sliceStats(g, reasoning),
  },
};
await Deno.writeTextFile(
  "docs/reasoning-suite/taxonomy-graph-fixture.json",
  JSON.stringify(fixture, null, 1) + "\n",
);
console.log(fixture.slices);
