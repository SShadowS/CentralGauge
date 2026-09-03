import { parse } from "@std/yaml";
import { walk } from "@std/fs/walk";
import { exists } from "@std/fs/exists";
import {
  validateCatalog,
  type ValidationIssue,
} from "../../../../site/src/lib/shared/taxonomy-schema.ts";
import { deriveFormat } from "./format-rules.ts";
import { parseCatalogYaml } from "./catalog-yaml.ts";

export async function validateRepo(
  o: {
    catalogPath: string;
    tasksDir: string;
    starterDir: string;
    expectedCountsPath: string;
  },
) {
  const issues: ValidationIssue[] = [];
  const catalog = parseCatalogYaml(await Deno.readTextFile(o.catalogPath));
  issues.push(...validateCatalog(catalog));

  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  for await (
    const e of walk(o.tasksDir, { exts: [".yml"], includeDirs: false })
  ) {
    const doc = parse(await Deno.readTextFile(e.path)) as {
      id?: string;
      prompt_template?: string;
      metadata?: { cohort?: string; donors?: string[] };
    };
    if (!doc.id) continue;
    seen.add(doc.id);
    const manifestFacts = {
      id: doc.id,
      prompt_template: doc.prompt_template ?? "",
      donors: doc.metadata?.donors ?? [],
      hasStarter: await exists(`${o.starterDir}/${doc.id}`),
      ...(doc.metadata?.cohort && { cohort: doc.metadata.cohort }),
    };
    const { group, violations } = deriveFormat(manifestFacts);
    for (const v of violations) {
      issues.push({
        code: `manifest_${v}`,
        where: doc.id,
        message: `format rule violation: ${v}`,
      });
    }
    const entry = catalog.tasks[doc.id];
    const override = catalog.overrides.find((x) => x.task === doc.id);
    const want = override?.group ?? group;
    if (!entry) {
      issues.push({
        code: "task_not_in_catalog",
        where: doc.id,
        message: "manifest has no catalog entry",
      });
    } else if (want && entry.group !== want) {
      issues.push({
        code: "group_mismatch",
        where: doc.id,
        message: `catalog says ${entry.group}, rules say ${want}`,
      });
    }
    if (want) counts[want] = (counts[want] ?? 0) + 1;
  }
  for (const id of Object.keys(catalog.tasks)) {
    if (!seen.has(id)) {
      issues.push({
        code: "catalog_task_without_manifest",
        where: id,
        message: "no manifest under tasks/",
      });
    }
  }
  const expected = JSON.parse(
    await Deno.readTextFile(o.expectedCountsPath),
  ) as Record<string, number>;
  for (const [g, n] of Object.entries(expected)) {
    if ((counts[g] ?? 0) !== n) {
      issues.push({
        code: "count_mismatch",
        where: g,
        message: `expected ${n}, found ${counts[g] ?? 0}`,
      });
    }
  }
  return { issues, counts };
}

if (import.meta.main) {
  const { issues, counts } = await validateRepo({
    catalogPath: "site/catalog/task-categories.yml",
    tasksDir: "tasks",
    starterDir: "tasks/starter",
    expectedCountsPath:
      ".claude/skills/refresh-task-taxonomy/pipeline/expected-counts.json",
  });
  console.log("per-format counts", counts);
  if (issues.length) {
    for (const i of issues) {
      console.error(`[${i.code}] ${i.where}: ${i.message}`);
    }
    console.error(`${issues.length} taxonomy issue(s)`);
    Deno.exit(1);
  }
  console.log("[OK] taxonomy valid");
}
