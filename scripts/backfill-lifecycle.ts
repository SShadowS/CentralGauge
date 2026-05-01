/**
 * scripts/backfill-lifecycle.ts — Synthesize lifecycle_events for every
 * existing (model, task_set, run/shortcoming/occurrence) triple.
 *
 * Strategic plan: docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md Phase B Task B1.
 *
 * Edge-case decisions (frozen by the strategic plan, NOT to be re-litigated):
 *  - NULL task_set_hash → sentinel `'pre-p6-unknown'` + migration_note documenting why.
 *  - One bench.completed per runs row (NOT aggregated per (model, task_set)) to
 *    preserve timestamp granularity for the diff phase.
 *  - One analysis.completed per (model_slug, task_set_hash) where shortcomings
 *    exist (deduped — multiple shortcomings rows for the same (model, task_set)
 *    collapse to one analysis event using the earliest first_seen).
 *  - publish.completed: when shortcoming_occurrences exists, occurrences_count
 *    = COUNT(*); when CASCADE-deleted (shortcomings exist but no occurrences),
 *    occurrences_count = 0 + migration_note='occurrences cascaded'.
 *
 * Usage:
 *   deno run --allow-all scripts/backfill-lifecycle.ts --d1-database centralgauge [--dry-run]
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import type { AppendEventInput } from "../src/lifecycle/types.ts";
import { PRE_P6_TASK_SET_SENTINEL } from "../src/lifecycle/types.ts";
import { loadIngestConfig, readPrivateKey } from "../src/ingest/config.ts";
import { appendEvent } from "../src/lifecycle/event-log.ts";

export interface BackfillRun {
  id: string;
  model_slug: string;
  task_set_hash: string | null;
  started_at: string;
}

export interface BackfillShortcoming {
  model_slug: string;
  task_set_hash: string | null;
  first_seen: string;
}

export interface BackfillOccurrenceGroup {
  model_slug: string;
  task_set_hash: string | null;
  last_seen: string;
  occurrences_count: number;
  /** True when shortcomings exist but matching occurrences were CASCADE-deleted. */
  cascaded?: boolean;
}

const NOW_NOTE = `backfilled at ${new Date().toISOString()}`;

function resolveTaskSetHash(raw: string | null): {
  hash: string;
  note?: string;
} {
  if (raw && raw !== "") return { hash: raw };
  return {
    hash: PRE_P6_TASK_SET_SENTINEL,
    note: "task_set_hash unknown — pre-P6 era",
  };
}

export function buildBenchEvents(runs: BackfillRun[]): AppendEventInput[] {
  return runs.map((r) => {
    const { hash, note } = resolveTaskSetHash(r.task_set_hash);
    return {
      ts: Date.parse(r.started_at),
      model_slug: r.model_slug,
      task_set_hash: hash,
      event_type: "bench.completed",
      source_id: r.id,
      payload: { run_id: r.id },
      tool_versions: {},
      envelope: {},
      actor: "migration" as const,
      migration_note: note ? `${NOW_NOTE}; ${note}` : NOW_NOTE,
    };
  });
}

export function buildAnalysisEvents(
  shortcomings: BackfillShortcoming[],
): AppendEventInput[] {
  // Dedupe by (model_slug, task_set_hash); pick the earliest first_seen.
  const buckets = new Map<string, BackfillShortcoming>();
  for (const s of shortcomings) {
    const { hash } = resolveTaskSetHash(s.task_set_hash);
    const key = `${s.model_slug}\x1f${hash}`;
    const cur = buckets.get(key);
    if (!cur || Date.parse(s.first_seen) < Date.parse(cur.first_seen)) {
      buckets.set(key, { ...s, task_set_hash: hash });
    }
  }
  return [...buckets.values()].map((s) => ({
    ts: Date.parse(s.first_seen),
    model_slug: s.model_slug,
    task_set_hash: s.task_set_hash!,
    event_type: "analysis.completed",
    payload: {},
    tool_versions: {},
    envelope: {},
    actor: "migration" as const,
    migration_note: NOW_NOTE,
  }));
}

export function buildPublishEvents(
  groups: BackfillOccurrenceGroup[],
): AppendEventInput[] {
  return groups.map((g) => {
    const { hash } = resolveTaskSetHash(g.task_set_hash);
    return {
      ts: Date.parse(g.last_seen),
      model_slug: g.model_slug,
      task_set_hash: hash,
      event_type: "publish.completed",
      payload: { occurrences_count: g.occurrences_count },
      tool_versions: {},
      envelope: {},
      actor: "migration" as const,
      migration_note: g.cascaded ? "occurrences cascaded" : NOW_NOTE,
    };
  });
}

/**
 * Deduplicate publish groups for mixed-state models.
 *
 * A model with BOTH (a) shortcomings whose occurrences exist AND (b)
 * shortcomings whose occurrences were CASCADE-deleted appears in BOTH the
 * `withOcc` and `cascaded` queries inside `fetchOccurrenceGroups`. Without
 * this filter, two `publish.completed` events would be emitted for the same
 * (model_slug, task_set_hash) pair — one with the real count and one with
 * `occurrences_count=0 + migration_note='occurrences cascaded'`.
 *
 * Resolution: the real publish wins. We drop the cascaded row when a withOcc
 * row exists for the same (model_slug, task_set_hash) key.
 */
export function dedupePublishGroups(
  groups: BackfillOccurrenceGroup[],
): BackfillOccurrenceGroup[] {
  const keyOf = (g: BackfillOccurrenceGroup) =>
    `${g.model_slug}\x1f${g.task_set_hash ?? ""}`;
  const realKeys = new Set(
    groups.filter((g) => !g.cascaded).map(keyOf),
  );
  return groups.filter((g) => !g.cascaded || !realKeys.has(keyOf(g)));
}

interface QueryD1Options {
  siteDir: string;
  dbName: string;
  remote: boolean;
}

async function queryD1<T = Record<string, unknown>>(
  opts: QueryD1Options,
  sql: string,
): Promise<T[]> {
  // Flatten multi-line SQL to a single line — Windows `npx.cmd` rejects batch
  // arguments containing newlines with "batch file arguments are invalid".
  const flatSql = sql.replace(/\s+/g, " ").trim();
  const args = [
    "wrangler",
    "d1",
    "execute",
    opts.dbName,
    opts.remote ? "--remote" : "--local",
    "--json",
    "--command",
    flatSql,
  ];
  const cmd = new Deno.Command("npx", {
    args,
    cwd: opts.siteDir,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(`wrangler failed: ${new TextDecoder().decode(stderr)}`);
  }
  const out = new TextDecoder().decode(stdout);
  const start = out.indexOf("[");
  if (start < 0) throw new Error(`no JSON in: ${out.slice(0, 200)}`);
  const parsed = JSON.parse(out.slice(start)) as Array<{ results?: T[] }>;
  return parsed[0]?.results ?? [];
}

async function fetchRuns(opts: QueryD1Options): Promise<BackfillRun[]> {
  return await queryD1<BackfillRun>(
    opts,
    `SELECT runs.id AS id, m.slug AS model_slug, runs.task_set_hash AS task_set_hash, runs.started_at AS started_at
       FROM runs JOIN models m ON m.id = runs.model_id
       ORDER BY runs.started_at ASC`,
  );
}

async function fetchShortcomings(
  opts: QueryD1Options,
): Promise<BackfillShortcoming[]> {
  // Group shortcomings by (model_slug). We don't have a per-shortcoming
  // task_set_hash column, so we attribute it to NULL (sentinel pre-p6-unknown
  // applied downstream) — matches the plan's edge-case handling for legacy
  // data where the link from shortcomings to a specific task_set is lost.
  return await queryD1<BackfillShortcoming>(
    opts,
    `SELECT m.slug AS model_slug, NULL AS task_set_hash, s.first_seen AS first_seen
       FROM shortcomings s
       JOIN models m ON m.id = s.model_id
       ORDER BY s.first_seen ASC`,
  );
}

async function fetchOccurrenceGroups(
  opts: QueryD1Options,
): Promise<BackfillOccurrenceGroup[]> {
  // Two-step: rows with occurrences (real publish), then shortcomings without
  // any occurrences (CASCADE-deleted -> cascaded=true).
  // shortcoming_occurrences has no timestamp column; we use shortcomings.last_seen
  // as the canonical "last published" timestamp for the (model, task_set) pair.
  const withOcc = await queryD1<{
    model_slug: string;
    task_set_hash: string | null;
    last_seen: string;
    occurrences_count: number;
  }>(
    opts,
    `SELECT m.slug AS model_slug, NULL AS task_set_hash,
            MAX(s.last_seen) AS last_seen,
            COUNT(occ.shortcoming_id) AS occurrences_count
       FROM shortcoming_occurrences occ
       JOIN shortcomings s ON s.id = occ.shortcoming_id
       JOIN models m ON m.id = s.model_id
       GROUP BY m.slug`,
  );
  const cascaded = await queryD1<{
    model_slug: string;
    task_set_hash: string | null;
    last_seen: string;
  }>(
    opts,
    `SELECT m.slug AS model_slug, NULL AS task_set_hash, MAX(s.last_seen) AS last_seen
       FROM shortcomings s
       JOIN models m ON m.id = s.model_id
       LEFT JOIN shortcoming_occurrences occ ON occ.shortcoming_id = s.id
       WHERE occ.shortcoming_id IS NULL
       GROUP BY m.slug`,
  );
  const withOccGroups = withOcc.map((g) => ({ ...g }));
  const cascadedGroups = cascaded.map((g) => ({
    ...g,
    occurrences_count: 0,
    cascaded: true,
  }));
  // I3 fix: a mixed-state model (one shortcoming with occurrences + one without)
  // appears in BOTH queries; drop the cascaded duplicate when a real publish row
  // covers the same (model_slug, task_set_hash) key.
  return dedupePublishGroups([...withOccGroups, ...cascadedGroups]);
}

async function main() {
  await new Command()
    .name("backfill-lifecycle")
    .description("Synthesize lifecycle_events for existing rows.")
    .option("--d1-database <name:string>", "D1 db", {
      default: "centralgauge",
    })
    .option("--remote", "Query production D1 (default: local)", {
      default: false,
    })
    .option("--dry-run", "Print event count without writing", {
      default: false,
    })
    .option("--site-dir <dir:string>", "site/ dir", {
      default: `${Deno.cwd()}/site`,
    })
    .action(async (opts) => {
      const queryOpts: QueryD1Options = {
        siteDir: opts.siteDir,
        dbName: opts.d1Database,
        remote: opts.remote,
      };
      console.log(
        colors.gray(
          `[INFO] reading runs from ${opts.remote ? "remote" : "local"} D1`,
        ),
      );
      const runs = await fetchRuns(queryOpts);
      const shortcomings = await fetchShortcomings(queryOpts);
      const occGroups = await fetchOccurrenceGroups(queryOpts);

      const benchEvents = buildBenchEvents(runs);
      const analysisEvents = buildAnalysisEvents(shortcomings);
      const publishEvents = buildPublishEvents(occGroups);
      const all = [...benchEvents, ...analysisEvents, ...publishEvents];

      console.log(
        colors.cyan(
          `[PLAN] bench=${benchEvents.length} analysis=${analysisEvents.length} publish=${publishEvents.length} total=${all.length}`,
        ),
      );
      if (opts.dryRun) {
        console.log(colors.yellow("[DRY] no events written"));
        return;
      }

      const config = await loadIngestConfig(Deno.cwd(), {});
      if (!config.adminKeyPath || config.adminKeyId === undefined) {
        throw new Error("admin_key_path / admin_key_id required for backfill");
      }
      const privKey = await readPrivateKey(config.adminKeyPath);
      let written = 0;
      for (const ev of all) {
        await appendEvent(ev, {
          url: config.url,
          privateKey: privKey,
          keyId: config.adminKeyId,
        });
        written++;
        if (written % 10 === 0) {
          console.log(colors.gray(`[PROGRESS] ${written}/${all.length}`));
        }
      }
      console.log(colors.green(`[OK] wrote ${written} synthetic events`));
    })
    .parse(Deno.args);
}

if (import.meta.main) {
  await main();
}
