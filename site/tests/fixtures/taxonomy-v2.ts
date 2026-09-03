import { env } from "cloudflare:test";
import type { CatalogV2 } from "../../src/lib/shared/taxonomy-schema";

// Shared across every taxonomy-v2 test file (stage/apply/activate/etc.) —
// keep these here rather than in a single .test.ts so importing one suite's
// helpers never re-registers that suite's `describe` blocks in another.

export const HASH = "a".repeat(64);

export function smallCatalog(): CatalogV2 {
  return {
    schema_version: 2,
    groups: [
      { slug: "diagnose-single", name: "S", description: "d" },
      { slug: "diagnose-composite", name: "C", description: "d" },
    ],
    families: [
      { slug: "mechanism", name: "M", description: "d" },
      { slug: "surface", name: "F", description: "d" },
    ],
    tags: [
      {
        slug: "tryfunction-write-rollback",
        family: "mechanism",
        name: "n",
        description: "d",
      },
      {
        slug: "table",
        family: "surface",
        name: "n",
        description: "d",
        hidden_by_default: true,
      },
    ],
    aliases: [],
    overrides: [],
    tasks: {
      t1: {
        group: "diagnose-single",
        facets: ["tryfunction-write-rollback", "table"],
        min_bc_version: 17,
      },
      t2: { group: "diagnose-single", facets: ["table"], min_bc_version: 16 },
      t3: { group: "diagnose-single", facets: ["table"], min_bc_version: 15 },
      t4: { group: "diagnose-single", facets: ["table"], min_bc_version: 15 },
      c1: {
        group: "diagnose-composite",
        donors: ["t1", "t2", "t3", "t4"],
        derived_facets: ["table", "tryfunction-write-rollback"],
        local_facets: [],
        min_bc_version: 17,
      },
    },
  };
}

export async function seedSet(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES (?, 't', 5, 1)`,
    ).bind(HASH),
    ...["t1", "t2", "t3", "t4", "c1"].map((id) =>
      env.DB.prepare(
        `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES (?,?,?,'hard',NULL,'{}')`,
      ).bind(HASH, id, "h" + id),
    ),
  ]);
}
