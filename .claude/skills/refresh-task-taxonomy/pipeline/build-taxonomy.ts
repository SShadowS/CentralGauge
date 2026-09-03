// Step 1 of the refresh: manifests -> draft catalog v2 (groups by rule,
// surface facets by alias table, min_bc_version, donors; mechanism and
// invariant facets are filled by the enrichment workflow and merge step).
// Usage: deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts [--out path]
import { parse } from "@std/yaml";
import { walk } from "@std/fs/walk";
import { exists } from "@std/fs/exists";
import {
  type CatalogV2,
  FAMILIES,
  FORMATS,
  type TaskEntry,
} from "../../../../site/src/lib/shared/taxonomy-schema.ts";
import { deriveFormat } from "./format-rules.ts";
import {
  minVersionFromTags,
  SURFACE_ALIASES,
  SURFACE_TAGS,
} from "./aliases.ts";
import { emitCatalogYaml, parseCatalogYaml } from "./catalog-yaml.ts";

const GROUP_TEXT: Record<string, [string, string]> = {
  "build-from-spec": [
    "Build from spec",
    "Write new AL objects from a behavioural specification.",
  ],
  "runtime-trap": [
    "Runtime trap",
    "Implement a compact requirement whose natural solution meets a Business Central runtime semantic.",
  ],
  "diagnose-single": [
    "Single-defect diagnose",
    "Repair a complete application with one planted defect, given a symptom.",
  ],
  "diagnose-composite": [
    "Composite diagnose",
    "Repair one application assembled from several donor applications with every defect live and no per-module symptom.",
  ],
};
const FAMILY_TEXT: Record<string, [string, string]> = {
  mechanism: [
    "Mechanism",
    "A Business Central runtime or language semantic the task turns on.",
  ],
  invariant: [
    "Invariant",
    "A domain contract the oracle grades independent of mechanism.",
  ],
  surface: [
    "AL surface",
    "AL objects and APIs the task touches.",
  ],
  environment: [
    "Environment",
    "Execution requirements: company scope, culture, permissions.",
  ],
};

interface Manifest {
  id?: string;
  prompt_template?: string;
  metadata?: {
    cohort?: string;
    donors?: string[];
    tags?: string[];
  };
}

export async function buildDraft(opts: {
  tasksDir: string;
  starterDir: string;
  previous?: CatalogV2;
}) {
  const tasks: Record<string, TaskEntry> = {};
  const violations: Record<string, string[]> = {};
  for await (
    const e of walk(opts.tasksDir, { exts: [".yml"], includeDirs: false })
  ) {
    const doc = parse(await Deno.readTextFile(e.path)) as Manifest;
    if (!doc.id) continue;
    const donors = doc.metadata?.donors ?? [];
    const hasStarter = await exists(`${opts.starterDir}/${doc.id}`);
    const formatOpts: Parameters<typeof deriveFormat>[0] = {
      id: doc.id,
      prompt_template: doc.prompt_template ?? "",
      donors,
      hasStarter,
    };
    if (doc.metadata?.cohort) formatOpts.cohort = doc.metadata.cohort;
    const { group, violations: v } = deriveFormat(formatOpts);
    if (v.length || !group) {
      violations[doc.id] = v;
      continue;
    }
    const raw = (doc.metadata?.tags ?? []).map((t) => t.toLowerCase());
    const surface = [
      ...new Set(
        raw
          .map((t) => SURFACE_ALIASES[t] ?? null)
          .filter((x): x is string => x !== null),
      ),
    ].sort();
    const prev = opts.previous?.tasks[doc.id];
    const keep = prev && !("donors" in prev)
      ? prev.facets.filter((f) => !SURFACE_TAGS.some((s) => s.slug === f))
      : [];
    const min_bc_version = minVersionFromTags(raw);
    if (group === "diagnose-composite") {
      tasks[doc.id] = {
        group,
        donors,
        derived_facets: [],
        local_facets: [],
        min_bc_version,
      };
    } else {
      tasks[doc.id] = {
        group,
        facets: [...new Set([...surface, ...keep])].sort(),
        min_bc_version,
      };
    }
  }
  const catalog: CatalogV2 = {
    schema_version: 2,
    groups: FORMATS.map((slug) => ({
      slug,
      name: GROUP_TEXT[slug]?.[0] ?? slug,
      description: GROUP_TEXT[slug]?.[1] ?? "",
    })),
    families: FAMILIES.map((slug) => ({
      slug,
      name: FAMILY_TEXT[slug]?.[0] ?? slug,
      description: FAMILY_TEXT[slug]?.[1] ?? "",
    })),
    tags: [
      ...SURFACE_TAGS,
      ...(opts.previous?.tags.filter((t) => t.family !== "surface") ?? []),
    ],
    aliases: Object.entries(SURFACE_ALIASES)
      .filter(([k, v]) => v !== null && v !== k)
      .map(([from, to]) => ({ from, to: to as string })),
    overrides: opts.previous?.overrides ?? [],
    tasks,
  };
  return { catalog, violations };
}

if (import.meta.main) {
  const outIdx = Deno.args.indexOf("--out");
  const out = outIdx >= 0 && Deno.args[outIdx + 1]
    ? Deno.args[outIdx + 1]!
    : "site/catalog/task-categories.yml";
  let previous: CatalogV2 | undefined;
  try {
    const prev = parseCatalogYaml(
      await Deno.readTextFile(out),
    );
    if (prev.schema_version === 2) previous = prev; // keep mechanism/invariant facets and overrides across runs
  } catch {
    /* first run */
  }
  const opts: Parameters<typeof buildDraft>[0] = {
    tasksDir: "tasks",
    starterDir: "tasks/starter",
  };
  if (previous) opts.previous = previous;
  const { catalog, violations } = await buildDraft(opts);
  if (Object.keys(violations).length) {
    console.error("format rule violations:");
    for (const [id, v] of Object.entries(violations)) {
      console.error(`  ${id}: ${v.join(", ")}`);
    }
    Deno.exit(1);
  }
  await Deno.writeTextFile(out, emitCatalogYaml(catalog));
  const counts: Record<string, number> = {};
  for (const e of Object.values(catalog.tasks)) {
    counts[e.group] = (counts[e.group] ?? 0) + 1;
  }
  console.log(`wrote ${out}`, counts);
}
