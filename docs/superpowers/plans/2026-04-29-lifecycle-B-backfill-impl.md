# Phase B — Lifecycle Backfill + Slug Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `lifecycle_events` with synthetic events for every existing `runs`/`shortcomings`/`shortcoming_occurrences` row, migrate the 15 `model-shortcomings/*.json` files to vendor-prefixed slugs, update the `verify` command to write the production slug directly, and delete `VENDOR_PREFIX_MAP` from `populate-shortcomings`.
**Architecture:** Two new TypeScript scripts under `scripts/` synthesize lifecycle events and rewrite JSON slugs respectively. They consume the `LifecycleEvent` / `AppendEventInput` shapes from Plan A's `src/lifecycle/types.ts`, sign payloads with the existing Ed25519 admin key, and POST through `/api/v1/admin/lifecycle/events`. The `verify` command's `--model` flag default becomes the production slug. `populate-shortcomings` becomes pass-through (no slug transformation).
**Tech Stack:** TypeScript / Deno 1.46+, Cliffy Command, `wrangler d1 execute --remote`, signed Ed25519 admin endpoint, the same `ingest` helpers (`signPayload`, `postWithRetry`, `loadIngestConfig`) `populate-shortcomings` uses.
**Depends on:** Plan A (`src/lifecycle/types.ts` + `src/lifecycle/event-log.ts` + `src/lifecycle/envelope.ts` + `0006_lifecycle.sql` applied to production).
**Strategic context:** See `docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md` Phase B for design rationale (especially the edge-case decisions: NULL `task_set_hash` → sentinel `'pre-p6-unknown'`, multi-run = one event per run, CASCADE-deleted occurrences = `migration_note='occurrences cascaded'`).

---

## Task B1: Backfill script `scripts/backfill-lifecycle.ts`

**Files:**

- Create: `scripts/backfill-lifecycle.ts`
- Create: `tests/unit/lifecycle/backfill.test.ts`

### Steps

- [ ] **1. Write the failing test.**

Create `tests/unit/lifecycle/backfill.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  buildAnalysisEvents,
  buildBenchEvents,
  buildPublishEvents,
} from "../../../scripts/backfill-lifecycle.ts";
import { PRE_P6_TASK_SET_SENTINEL } from "../../../src/lifecycle/types.ts";

describe("backfill-lifecycle", () => {
  it("synthesizes one bench.completed per runs row", () => {
    const runs = [
      {
        id: "r1",
        model_slug: "anthropic/claude-opus-4-6",
        task_set_hash: "h1",
        started_at: "2026-04-01T00:00:00Z",
      },
      {
        id: "r2",
        model_slug: "anthropic/claude-opus-4-6",
        task_set_hash: "h1",
        started_at: "2026-04-15T00:00:00Z",
      },
      {
        id: "r3",
        model_slug: "openai/gpt-5.5",
        task_set_hash: "h1",
        started_at: "2026-04-10T00:00:00Z",
      },
    ];
    const events = buildBenchEvents(runs);
    assertEquals(events.length, 3);
    assertEquals(events.every((e) => e.event_type === "bench.completed"), true);
    assertEquals(events.every((e) => e.actor === "migration"), true);
    assertEquals(
      events.every((e) => e.migration_note?.startsWith("backfilled at")),
      true,
    );
  });

  it("uses pre-p6-unknown sentinel when task_set_hash is null", () => {
    const runs = [
      {
        id: "r1",
        model_slug: "m/x",
        task_set_hash: null,
        started_at: "2025-01-01T00:00:00Z",
      },
    ];
    const events = buildBenchEvents(runs);
    assertEquals(events[0]!.task_set_hash, PRE_P6_TASK_SET_SENTINEL);
    assertEquals(events[0]!.migration_note?.includes("pre-P6"), true);
  });

  it("synthesizes one analysis.completed per (model_slug, task_set_hash) shortcoming pair", () => {
    const shortcomings = [
      {
        model_slug: "anthropic/claude-opus-4-6",
        task_set_hash: "h1",
        first_seen: "2026-04-20T00:00:00Z",
      },
      {
        model_slug: "anthropic/claude-opus-4-6",
        task_set_hash: "h1",
        first_seen: "2026-04-21T00:00:00Z",
      },
      {
        model_slug: "anthropic/claude-opus-4-6",
        task_set_hash: "h2",
        first_seen: "2026-04-22T00:00:00Z",
      },
    ];
    const events = buildAnalysisEvents(shortcomings);
    assertEquals(events.length, 2); // dedupe by (model_slug, task_set_hash)
    const byHash = events.map((e) => e.task_set_hash).sort();
    assertEquals(byHash, ["h1", "h2"]);
  });

  it("synthesizes publish events with occurrences_count from groups", () => {
    const occGroups = [
      {
        model_slug: "m/a",
        task_set_hash: "h",
        last_seen: "2026-04-25T00:00:00Z",
        occurrences_count: 5,
      },
      {
        model_slug: "m/b",
        task_set_hash: "h",
        last_seen: "2026-04-26T00:00:00Z",
        occurrences_count: 0,
        cascaded: true,
      },
    ];
    const events = buildPublishEvents(occGroups);
    assertEquals(events.length, 2);
    assertEquals(events[0]!.event_type, "publish.completed");
    assertEquals(events[1]!.migration_note, "occurrences cascaded");
    assertEquals(JSON.parse(events[1]!.payload_json!), {
      occurrences_count: 0,
    });
  });
});
```

- [ ] **2. Run test to verify failure.**

```bash
deno task test:unit -- --filter "backfill-lifecycle"
```

Expected: `Module not found "scripts/backfill-lifecycle.ts"`. Test fails red.

- [ ] **3. Implement the script.**

Create `scripts/backfill-lifecycle.ts`:

```typescript
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

interface QueryD1Options {
  siteDir: string;
  dbName: string;
  remote: boolean;
}

async function queryD1<T = Record<string, unknown>>(
  opts: QueryD1Options,
  sql: string,
): Promise<T[]> {
  const args = [
    "wrangler",
    "d1",
    "execute",
    opts.dbName,
    opts.remote ? "--remote" : "--local",
    "--json",
    "--command",
    sql,
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
  return await queryD1<BackfillShortcoming>(
    opts,
    `SELECT m.slug AS model_slug, runs.task_set_hash AS task_set_hash, s.first_seen AS first_seen
       FROM shortcomings s
       JOIN models m ON m.id = s.model_id
       LEFT JOIN runs ON runs.model_id = m.id
       GROUP BY s.id
       ORDER BY s.first_seen ASC`,
  );
}

async function fetchOccurrenceGroups(
  opts: QueryD1Options,
): Promise<BackfillOccurrenceGroup[]> {
  // Two-step: rows with occurrences (real publish), then shortcomings without
  // any occurrences (CASCADE-deleted → cascaded=true).
  const withOcc = await queryD1<{
    model_slug: string;
    task_set_hash: string | null;
    last_seen: string;
    occurrences_count: number;
  }>(
    opts,
    `SELECT m.slug AS model_slug, NULL AS task_set_hash,
            MAX(occ.first_seen_at) AS last_seen,
            COUNT(occ.id) AS occurrences_count
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
       WHERE occ.id IS NULL
       GROUP BY m.slug`,
  );
  const withOccGroups = withOcc.map((g) => ({ ...g }));
  const cascadedGroups = cascaded.map((g) => ({
    ...g,
    occurrences_count: 0,
    cascaded: true,
  }));
  return [...withOccGroups, ...cascadedGroups];
}

async function main() {
  await new Command()
    .name("backfill-lifecycle")
    .description("Synthesize lifecycle_events for existing rows.")
    .option("--d1-database <name:string>", "D1 db", { default: "centralgauge" })
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
```

- [ ] **4. Run test to verify it passes.**

```bash
deno task test:unit -- --filter "backfill-lifecycle"
```

Expected: `4 passed`.

- [ ] **5. Format and commit.**

```bash
deno fmt scripts/backfill-lifecycle.ts tests/unit/lifecycle/backfill.test.ts && deno check scripts/backfill-lifecycle.ts && deno lint scripts/backfill-lifecycle.ts && git add scripts/backfill-lifecycle.ts tests/unit/lifecycle/backfill.test.ts && git commit -m "feat(scripts): backfill-lifecycle — synthesize bench/analysis/publish events for existing rows"
```

---

## Task B2: Slug migration script `scripts/migrate-shortcomings-slugs.ts`

**Files:**

- Create: `scripts/migrate-shortcomings-slugs.ts`
- Create: `tests/unit/lifecycle/migrate-slugs.test.ts`

### Steps

- [ ] **1. Write the failing test.**

Create `tests/unit/lifecycle/migrate-slugs.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import {
  resolveTargetFilename,
  resolveTargetSlug,
  SLUG_MIGRATION_TABLE,
} from "../../../scripts/migrate-shortcomings-slugs.ts";

describe("migrate-shortcomings-slugs", () => {
  it("contains exactly 15 entries matching strategic plan B2", () => {
    assertEquals(SLUG_MIGRATION_TABLE.length, 15);
  });

  it("maps the 2 known JSONs (claude-opus-4-6, gpt-5.3-codex)", () => {
    assertEquals(
      resolveTargetSlug("claude-opus-4-6"),
      "anthropic/claude-opus-4-6",
    );
    assertEquals(resolveTargetSlug("gpt-5.3-codex"), "openai/gpt-5.3-codex");
  });

  it("collapses date suffix from claude-opus-4-5-20251101 to anthropic/claude-opus-4-5", () => {
    assertEquals(
      resolveTargetSlug("claude-opus-4-5-20251101"),
      "anthropic/claude-opus-4-5",
    );
    assertEquals(
      resolveTargetSlug("claude-sonnet-4-5-20250929"),
      "anthropic/claude-sonnet-4-5",
    );
    assertEquals(resolveTargetSlug("gpt-5.2-2025-12-11"), "openai/gpt-5.2");
  });

  it("maps gemini snapshots to google/", () => {
    assertEquals(
      resolveTargetSlug("gemini-3-pro-preview"),
      "google/gemini-3-pro-preview",
    );
    assertEquals(
      resolveTargetSlug("gemini-3.1-pro-preview"),
      "google/gemini-3.1-pro-preview",
    );
  });

  it("converts underscore-separated vendor slugs to openrouter/<vendor>/<model>", () => {
    assertEquals(
      resolveTargetSlug("deepseek_deepseek-v3.2"),
      "openrouter/deepseek/deepseek-v3.2",
    );
    assertEquals(
      resolveTargetSlug("minimax_minimax-m2.5"),
      "openrouter/minimax/minimax-m2.5",
    );
    assertEquals(
      resolveTargetSlug("moonshotai_kimi-k2.5"),
      "openrouter/moonshotai/kimi-k2.5",
    );
    assertEquals(
      resolveTargetSlug("qwen_qwen3-coder-next"),
      "openrouter/qwen/qwen3-coder-next",
    );
    assertEquals(
      resolveTargetSlug("qwen_qwen3-max-thinking"),
      "openrouter/qwen/qwen3-max-thinking",
    );
    assertEquals(
      resolveTargetSlug("x-ai_grok-code-fast-1"),
      "openrouter/x-ai/grok-code-fast-1",
    );
    assertEquals(resolveTargetSlug("z-ai_glm-5"), "openrouter/z-ai/glm-5");
  });

  it("resolveTargetFilename replaces `/` with `_` for fs-safe names", () => {
    assertEquals(
      resolveTargetFilename("anthropic/claude-opus-4-6"),
      "anthropic_claude-opus-4-6.json",
    );
    assertEquals(
      resolveTargetFilename("openrouter/deepseek/deepseek-v3.2"),
      "openrouter_deepseek_deepseek-v3.2.json",
    );
  });

  it("returns null for unknown legacy slugs", () => {
    assertEquals(resolveTargetSlug("unknown-model-slug"), null);
  });
});
```

- [ ] **2. Run test to verify failure.**

```bash
deno task test:unit -- --filter "migrate-shortcomings-slugs"
```

Expected: `Module not found`. Test fails red.

- [ ] **3. Implement the script.**

Create `scripts/migrate-shortcomings-slugs.ts`:

```typescript
/**
 * scripts/migrate-shortcomings-slugs.ts — Rewrite model-shortcomings/*.json
 * to use vendor-prefixed production slugs matching the catalog.
 *
 * Strategic plan: docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md Phase B Task B2.
 *
 * The 15-entry SLUG_MIGRATION_TABLE below is the AUTHORITATIVE mapping; do
 * not edit without updating the strategic plan.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/migrate-shortcomings-slugs.ts [--dir model-shortcomings] [--dry-run]
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";

export interface SlugMigrationRow {
  /** legacy `model` field from JSON */
  legacy: string;
  /** legacy filename (without dir) */
  legacyFile: string;
  /** new vendor-prefixed slug to write into the JSON `model` field */
  target: string;
}

/**
 * The authoritative 15-file migration table from the strategic plan
 * (Phase B Task B2). Editing this requires updating the strategic plan.
 */
export const SLUG_MIGRATION_TABLE: SlugMigrationRow[] = [
  // 2 mapped JSONs
  {
    legacy: "claude-opus-4-6",
    legacyFile: "claude-opus-4-6.json",
    target: "anthropic/claude-opus-4-6",
  },
  {
    legacy: "gpt-5.3-codex",
    legacyFile: "gpt-5.3-codex.json",
    target: "openai/gpt-5.3-codex",
  },
  // 6 unmapped legacy snapshots (collapse date suffix)
  {
    legacy: "claude-opus-4-5-20251101",
    legacyFile: "claude-opus-4-5-20251101.json",
    target: "anthropic/claude-opus-4-5",
  },
  {
    legacy: "claude-sonnet-4-6",
    legacyFile: "claude-sonnet-4-6.json",
    target: "anthropic/claude-sonnet-4-6",
  },
  {
    legacy: "claude-sonnet-4-5-20250929",
    legacyFile: "claude-sonnet-4-5-20250929.json",
    target: "anthropic/claude-sonnet-4-5",
  },
  {
    legacy: "gpt-5.2-2025-12-11",
    legacyFile: "gpt-5.2-2025-12-11.json",
    target: "openai/gpt-5.2",
  },
  {
    legacy: "gemini-3-pro-preview",
    legacyFile: "gemini-3-pro-preview.json",
    target: "google/gemini-3-pro-preview",
  },
  {
    legacy: "gemini-3.1-pro-preview",
    legacyFile: "gemini-3.1-pro-preview.json",
    target: "google/gemini-3.1-pro-preview",
  },
  // 7 vendor-prefixed via underscore (convert _ → / and prepend openrouter/)
  {
    legacy: "deepseek_deepseek-v3.2",
    legacyFile: "deepseek_deepseek-v3.2.json",
    target: "openrouter/deepseek/deepseek-v3.2",
  },
  {
    legacy: "minimax_minimax-m2.5",
    legacyFile: "minimax_minimax-m2.5.json",
    target: "openrouter/minimax/minimax-m2.5",
  },
  {
    legacy: "moonshotai_kimi-k2.5",
    legacyFile: "moonshotai_kimi-k2.5.json",
    target: "openrouter/moonshotai/kimi-k2.5",
  },
  {
    legacy: "qwen_qwen3-max-thinking",
    legacyFile: "qwen_qwen3-max-thinking.json",
    target: "openrouter/qwen/qwen3-max-thinking",
  },
  {
    legacy: "qwen_qwen3-coder-next",
    legacyFile: "qwen_qwen3-coder-next.json",
    target: "openrouter/qwen/qwen3-coder-next",
  },
  {
    legacy: "x-ai_grok-code-fast-1",
    legacyFile: "x-ai_grok-code-fast-1.json",
    target: "openrouter/x-ai/grok-code-fast-1",
  },
  {
    legacy: "z-ai_glm-5",
    legacyFile: "z-ai_glm-5.json",
    target: "openrouter/z-ai/glm-5",
  },
];

export function resolveTargetSlug(legacy: string): string | null {
  return SLUG_MIGRATION_TABLE.find((r) => r.legacy === legacy)?.target ?? null;
}

export function resolveTargetFilename(targetSlug: string): string {
  return `${targetSlug.replaceAll("/", "_")}.json`;
}

interface CliOptions {
  dir: string;
  dryRun: boolean;
}

async function migrate(opts: CliOptions): Promise<{
  migrated: string[];
  missing: string[];
  alreadyMigrated: string[];
}> {
  const migrated: string[] = [];
  const missing: string[] = [];
  const alreadyMigrated: string[] = [];

  for (const row of SLUG_MIGRATION_TABLE) {
    const oldPath = `${opts.dir}/${row.legacyFile}`;
    const newName = resolveTargetFilename(row.target);
    const newPath = `${opts.dir}/${newName}`;

    let text: string;
    try {
      text = await Deno.readTextFile(oldPath);
    } catch {
      // Maybe already migrated.
      try {
        await Deno.stat(newPath);
        alreadyMigrated.push(row.legacyFile);
      } catch {
        missing.push(row.legacyFile);
      }
      continue;
    }

    const json = JSON.parse(text) as { model: string; [k: string]: unknown };
    json.model = row.target;
    const out = JSON.stringify(json, null, 2);
    if (opts.dryRun) {
      console.log(
        colors.yellow(
          `[DRY] ${oldPath} → ${newPath} (model: ${row.legacy} → ${row.target})`,
        ),
      );
    } else {
      await Deno.writeTextFile(newPath, out);
      if (newPath !== oldPath) {
        await Deno.remove(oldPath);
      }
      console.log(colors.green(`[OK] ${row.legacyFile} → ${newName}`));
    }
    migrated.push(row.legacyFile);
  }

  return { migrated, missing, alreadyMigrated };
}

if (import.meta.main) {
  await new Command()
    .name("migrate-shortcomings-slugs")
    .description("Rewrite model-shortcomings/*.json to vendor-prefixed slugs.")
    .option("--dir <dir:string>", "Directory", {
      default: "model-shortcomings",
    })
    .option("--dry-run", "Preview without writing", { default: false })
    .action(async (opts) => {
      const result = await migrate({ dir: opts.dir, dryRun: opts.dryRun });
      console.log(
        colors.cyan(
          `migrated=${result.migrated.length} missing=${result.missing.length} already=${result.alreadyMigrated.length}`,
        ),
      );
      if (result.missing.length > 0) {
        console.log(colors.yellow("[WARN] missing files (not found in dir):"));
        for (const m of result.missing) console.log(`  - ${m}`);
      }
    })
    .parse(Deno.args);
}
```

- [ ] **4. Run test to verify it passes.**

```bash
deno task test:unit -- --filter "migrate-shortcomings-slugs"
```

Expected: `7 passed`.

- [ ] **5. Format and commit.**

```bash
deno fmt scripts/migrate-shortcomings-slugs.ts tests/unit/lifecycle/migrate-slugs.test.ts && deno check scripts/migrate-shortcomings-slugs.ts && deno lint scripts/migrate-shortcomings-slugs.ts && git add scripts/migrate-shortcomings-slugs.ts tests/unit/lifecycle/migrate-slugs.test.ts && git commit -m "feat(scripts): migrate-shortcomings-slugs — vendor-prefix the 15 model-shortcomings JSONs"
```

---

## Task B3: Update `verify` command to write production slug directly

**Files:**

- Modify: `cli/commands/verify-command.ts`
- Create: `tests/unit/cli/commands/verify-slug-default.test.ts`

### Steps

- [ ] **1. Write the failing test.**

Create `tests/unit/cli/commands/verify-slug-default.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

/**
 * Reads the verify command source and asserts the --model flag default is a
 * vendor-prefixed slug, NOT the unprefixed legacy form. Regression guard for
 * Phase B Task B3 — preventing the slug-drift class from regrowing.
 */
describe("verify command --model default", () => {
  it("uses anthropic/claude-opus-4-6 (vendor-prefixed) as default", async () => {
    const src = await Deno.readTextFile(
      new URL("../../../../cli/commands/verify-command.ts", import.meta.url),
    );
    const match = src.match(
      /\.option\(\s*"--model[^"]*",\s*"[^"]+",\s*\{\s*default:\s*"([^"]+)"/,
    );
    assertEquals(match?.[1], "anthropic/claude-opus-4-6");
  });
});
```

- [ ] **2. Run test to verify failure.**

```bash
deno task test:unit -- --filter "verify command --model default"
```

Expected: `Expected: "anthropic/claude-opus-4-6", Actual: "claude-opus-4-6"`. Test fails red (the current default is the legacy form).

- [ ] **3. Update the source.**

Edit `cli/commands/verify-command.ts` line ~144-146 (the `--model` option):

```typescript
.option("--model <model:string>", "LLM for analysis (vendor-prefixed prod slug)", {
  default: "anthropic/claude-opus-4-6",
})
```

(Replaces the current `default: "claude-opus-4-6"`.)

- [ ] **4. Run test to verify it passes.**

```bash
deno task test:unit -- --filter "verify command --model default"
```

Expected: `1 passed`.

- [ ] **5. Format and commit.**

```bash
deno fmt cli/commands/verify-command.ts tests/unit/cli/commands/verify-slug-default.test.ts && deno check cli/commands/verify-command.ts && git add cli/commands/verify-command.ts tests/unit/cli/commands/verify-slug-default.test.ts && git commit -m "feat(cli): verify --model default → vendor-prefixed production slug (kills slug drift at source)"
```

---

## Task B4: Delete `VENDOR_PREFIX_MAP` from `populate-shortcomings`

**Files:**

- Modify: `cli/commands/populate-shortcomings-command.ts`
- Modify (or create): `tests/unit/cli/commands/populate-shortcomings-passthrough.test.ts`

### Steps

- [ ] **1. Write the failing test.**

Create `tests/unit/cli/commands/populate-shortcomings-passthrough.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";

describe("populate-shortcomings VENDOR_PREFIX_MAP removal", () => {
  it("source no longer contains VENDOR_PREFIX_MAP literal", async () => {
    const src = await Deno.readTextFile(
      new URL(
        "../../../../cli/commands/populate-shortcomings-command.ts",
        import.meta.url,
      ),
    );
    assert(
      !src.includes("VENDOR_PREFIX_MAP"),
      "VENDOR_PREFIX_MAP still present in populate-shortcomings — Phase B4 not done",
    );
  });

  it("mapToProductionSlug now passes through vendor-prefixed inputs unchanged", async () => {
    const mod = await import(
      new URL(
        "../../../../cli/commands/populate-shortcomings-command.ts",
        import.meta.url,
      ).href
    ) as { mapToProductionSlug?: (s: string) => string | null };
    if (!mod.mapToProductionSlug) {
      // export was removed entirely (acceptable end state)
      return;
    }
    assertEquals(
      mod.mapToProductionSlug("anthropic/claude-opus-4-6"),
      "anthropic/claude-opus-4-6",
    );
    assertEquals(
      mod.mapToProductionSlug("openrouter/deepseek/deepseek-v3.2"),
      "openrouter/deepseek/deepseek-v3.2",
    );
  });
});
```

- [ ] **2. Run test to verify failure.**

```bash
deno task test:unit -- --filter "VENDOR_PREFIX_MAP removal"
```

Expected: first assertion fails (`VENDOR_PREFIX_MAP still present`).

- [ ] **3. Edit the source — delete the function body and replace with pass-through.**

In `cli/commands/populate-shortcomings-command.ts`, locate the function `mapToProductionSlug` at line 78-98 and replace it with:

```typescript
/**
 * Pass-through after Phase B2 migrated all JSON `model` fields to
 * vendor-prefixed production slugs. Retained as a function (not inlined) so
 * future invariant checks (e.g. slug-format validation) have a single home.
 *
 * Returns null only when the input doesn't match the expected slug shape
 * (vendor/model or vendor/family/model). Old VENDOR_PREFIX_MAP deleted —
 * see strategic plan Phase B Task B4.
 */
export function mapToProductionSlug(jsonModel: string): string | null {
  if (!jsonModel.includes("/")) return null;
  return jsonModel;
}
```

- [ ] **4. Run test to verify it passes.**

```bash
deno task test:unit -- --filter "VENDOR_PREFIX_MAP removal"
```

Expected: `2 passed`.

- [ ] **5. Format and commit.**

```bash
deno fmt cli/commands/populate-shortcomings-command.ts tests/unit/cli/commands/populate-shortcomings-passthrough.test.ts && deno check cli/commands/populate-shortcomings-command.ts && deno lint cli/commands/populate-shortcomings-command.ts && git add cli/commands/populate-shortcomings-command.ts tests/unit/cli/commands/populate-shortcomings-passthrough.test.ts && git commit -m "feat(cli): delete VENDOR_PREFIX_MAP — populate-shortcomings is pure pass-through after slug migration"
```

---

## Task B5: Run B1 + B2 against staging copy + invariant assertions

**Files:**

- Create: `scripts/verify-backfill-invariants.ts`
- Create: `tests/unit/lifecycle/invariants.test.ts`

### Steps

- [ ] **1. Write the failing invariant test.**

Create `tests/unit/lifecycle/invariants.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  assertAnalysisCoversShortcomings,
  assertPublishCoversOccurrences,
} from "../../../scripts/verify-backfill-invariants.ts";

describe("backfill invariants", () => {
  it("passes when every (model,task_set) with shortcomings has an analysis event", () => {
    const shortcomings = [
      { model_slug: "m/x", task_set_hash: "h" },
      { model_slug: "m/y", task_set_hash: "h" },
    ];
    const events = [
      {
        model_slug: "m/x",
        task_set_hash: "h",
        event_type: "analysis.completed",
      },
      {
        model_slug: "m/y",
        task_set_hash: "h",
        event_type: "analysis.completed",
      },
    ];
    const result = assertAnalysisCoversShortcomings(shortcomings, events);
    assertEquals(result.missing, []);
  });

  it("flags missing analysis events", () => {
    const shortcomings = [
      { model_slug: "m/x", task_set_hash: "h" },
      { model_slug: "m/y", task_set_hash: "h" },
    ];
    const events = [
      {
        model_slug: "m/x",
        task_set_hash: "h",
        event_type: "analysis.completed",
      },
    ];
    const result = assertAnalysisCoversShortcomings(shortcomings, events);
    assertEquals(result.missing, ["m/y\x1fh"]);
  });

  it("publish invariant requires every (model, task_set) with occurrences to have publish event", () => {
    const occGroups = [{ model_slug: "m/a", task_set_hash: "h" }];
    const events = [
      {
        model_slug: "m/a",
        task_set_hash: "h",
        event_type: "publish.completed",
      },
    ];
    const result = assertPublishCoversOccurrences(occGroups, events);
    assertEquals(result.missing, []);
  });
});
```

- [ ] **2. Run test to verify failure.**

```bash
deno task test:unit -- --filter "backfill invariants"
```

Expected: `Module not found "scripts/verify-backfill-invariants.ts"`. Test fails red.

- [ ] **3. Implement the invariant verifier.**

Create `scripts/verify-backfill-invariants.ts`:

```typescript
/**
 * scripts/verify-backfill-invariants.ts — Post-backfill invariant assertions.
 * Strategic plan: Phase B Task B5.
 *
 * Invariants:
 *  - every (model_slug, task_set_hash) with `shortcomings` rows has at least
 *    one `analysis.completed` event for that pair.
 *  - every (model_slug, task_set_hash) with `shortcoming_occurrences` rows
 *    has at least one `publish.completed` event for that pair.
 */

interface KeyedRow {
  model_slug: string;
  task_set_hash: string | null;
}

interface KeyedEvent extends KeyedRow {
  event_type: string;
}

function key(r: KeyedRow): string {
  return `${r.model_slug}\x1f${r.task_set_hash ?? "pre-p6-unknown"}`;
}

export function assertAnalysisCoversShortcomings(
  shortcomings: KeyedRow[],
  events: KeyedEvent[],
): { missing: string[] } {
  const haveAnalysis = new Set(
    events.filter((e) => e.event_type === "analysis.completed").map(key),
  );
  const need = new Set(shortcomings.map(key));
  const missing = [...need].filter((k) => !haveAnalysis.has(k));
  return { missing };
}

export function assertPublishCoversOccurrences(
  occGroups: KeyedRow[],
  events: KeyedEvent[],
): { missing: string[] } {
  const havePublish = new Set(
    events.filter((e) => e.event_type === "publish.completed").map(key),
  );
  const need = new Set(occGroups.map(key));
  const missing = [...need].filter((k) => !havePublish.has(k));
  return { missing };
}
```

- [ ] **4. Run test to verify it passes.**

```bash
deno task test:unit -- --filter "backfill invariants"
```

Expected: `3 passed`.

- [ ] **5. Run B1 + B2 against the staging copy of prod.**

The "staging copy" pattern (per CLAUDE.md and Phase B5 in the strategic plan):

```bash
cd site && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler d1 backup create centralgauge
```

Expected: `Backup created: <backup-id>`. Note the ID for restore-on-fail.

Then dry-run B1 against remote (read-only):

```bash
deno run --allow-all scripts/backfill-lifecycle.ts --remote --dry-run
```

Expected output: `[PLAN] bench=~45 analysis=~12 publish=~7 total=~64`. Numbers match the strategic plan's Phase B5 acceptance.

Dry-run B2 against the local model-shortcomings dir:

```bash
deno run --allow-read --allow-write scripts/migrate-shortcomings-slugs.ts --dry-run
```

Expected: `migrated=15 missing=0 already=0` and 15 lines like `[DRY] ... claude-opus-4-6.json → anthropic_claude-opus-4-6.json`.

- [ ] **6. Commit invariant tooling.**

```bash
deno fmt scripts/verify-backfill-invariants.ts tests/unit/lifecycle/invariants.test.ts && deno check scripts/verify-backfill-invariants.ts && deno lint scripts/verify-backfill-invariants.ts && git add scripts/verify-backfill-invariants.ts tests/unit/lifecycle/invariants.test.ts && git commit -m "test(lifecycle): post-backfill invariant assertions (analysis covers shortcomings, publish covers occurrences)"
```

---

## Task B6: Run B1 + B2 against production (with backup)

**Files:**

- Modify: none (operational task)

### Steps

- [ ] **1. Confirm Phase A migration is live and lifecycle_events count is 0 on prod.**

```bash
cd site && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler d1 execute centralgauge --remote --command="SELECT COUNT(*) AS c FROM lifecycle_events"
```

Expected: `[{"c":0}]`. If non-zero, abort — backfill is not idempotent against partial state without manual reconciliation.

- [ ] **2. Take a fresh production backup.**

```bash
cd site && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler d1 backup create centralgauge
```

Expected: `Backup created: <backup-id>`. Save the backup-id in the commit message for B6.

- [ ] **3. Run the B1 backfill against production.**

```bash
deno run --allow-all scripts/backfill-lifecycle.ts --remote
```

Expected output: `[OK] wrote ~64 synthetic events`. Per-10 progress lines printed.

- [ ] **4. Run the B2 slug migration in-place.**

```bash
deno run --allow-read --allow-write scripts/migrate-shortcomings-slugs.ts
```

Expected: 15 `[OK]` lines + `migrated=15 missing=0 already=0`.

- [ ] **5. Re-run the invariant assertions against production via a one-shot wrapper.**

```bash
deno run --allow-all scripts/backfill-lifecycle.ts --remote --dry-run
```

Expected: `[PLAN] bench=~45 analysis=~12 publish=~7 total=~64`. After B6 succeeded, re-running dry-run still computes the same plan size from existing rows; the numbers prove `runs`/`shortcomings`/`shortcoming_occurrences` content was untouched.

Verify event counts on production:

```bash
cd site && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler d1 execute centralgauge --remote --command="SELECT event_type, COUNT(*) AS n FROM lifecycle_events GROUP BY event_type ORDER BY event_type"
```

Expected: rows for `bench.completed` (~45), `analysis.completed` (~12), `publish.completed` (~7). Total ~64.

Verify the invariant — every (model_slug, task_set_hash) with shortcomings has an analysis.completed:

```bash
cd site && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler d1 execute centralgauge --remote --command="SELECT m.slug, COUNT(s.id) AS shorts, COUNT(le.id) AS analyses FROM models m LEFT JOIN shortcomings s ON s.model_id = m.id LEFT JOIN lifecycle_events le ON le.model_slug = m.slug AND le.event_type = 'analysis.completed' GROUP BY m.slug HAVING shorts > 0"
```

Expected: every row has `analyses >= 1`. If any row has `shorts > 0 AND analyses = 0`, ROLLBACK via the backup-id from step 2:

```bash
cd site && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler d1 restore centralgauge <backup-id>
```

- [ ] **6. Verify the populate-shortcomings end-to-end works for a previously-skipped slug.**

```bash
deno task start populate-shortcomings --only openrouter/deepseek/deepseek-v3.2 --dry-run
```

Expected: `[FILE] model-shortcomings/openrouter_deepseek_deepseek-v3.2.json` followed by `[DRY] payload: N shortcomings, M occurrences` — i.e., NOT skipped (was skipped pre-migration).

- [ ] **7. Commit the migrated JSON files (the only modified files from this step).**

```bash
git add model-shortcomings/ && git commit -m "chore(model-shortcomings): vendor-prefix the 15 JSON files (B2 outcome)

Backup id: <paste backup-id from B6 step 2>
Synthetic events written: ~64 (bench=~45 analysis=~12 publish=~7).

This matches the Phase B5/B6 acceptance from the strategic plan."
```

- [ ] **8. Final tree-clean check.**

```bash
deno task test:unit && cd site && npm run build && npx vitest run tests/api/lifecycle*.test.ts tests/migrations/lifecycle*.test.ts
```

Expected: all tests green. Phase B is complete.

---

## Task B-COMMIT: Phase B closing

**Files:** none

### Steps

- [ ] **1. Run the full test sweep one more time.**

```bash
deno task test:unit && deno check src/lifecycle/ scripts/backfill-lifecycle.ts scripts/migrate-shortcomings-slugs.ts scripts/verify-backfill-invariants.ts && deno lint src/lifecycle scripts && deno fmt src/lifecycle scripts tests/unit/lifecycle tests/unit/cli/commands
```

Expected: all green; no diagnostics.

- [ ] **2. Verify production state matches the B-COMMIT acceptance.**

```bash
cd site && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler d1 execute centralgauge --remote --command="SELECT COUNT(*) AS total, SUM(CASE WHEN actor='migration' THEN 1 ELSE 0 END) AS synthetic FROM lifecycle_events"
```

Expected: `total >= 64 AND synthetic >= 64`. (Equality holds until Phase C starts emitting non-migration events.)

- [ ] **3. Confirm the populate-shortcomings unmapped-files class is empty.**

```bash
ls model-shortcomings/ | grep -v "^anthropic_\|^openai_\|^google_\|^openrouter_" || echo "all 15 files vendor-prefixed"
```

Expected stdout: `all 15 files vendor-prefixed`. (The grep finds no non-prefixed files; the `|| echo` fires.)

- [ ] **4. Phase B is complete. No additional commit needed if B1-B6 commits are individually present.**

```bash
git log --oneline -10
```

Confirm 6+ commits with `feat(scripts):` / `feat(cli):` / `chore(model-shortcomings):` prefixes from this phase.

---

## Acceptance criteria (Phase B)

- `deno task test:unit -- --filter "lifecycle"` and `... --filter "VENDOR_PREFIX_MAP"` and `... --filter "verify command --model default"` all green.
- `wrangler d1 execute centralgauge --remote --command="SELECT COUNT(*) FROM lifecycle_events"` returns `~64`.
- Every shortcomings row's `(model_slug, task_set_hash)` has at least one `analysis.completed` event.
- All 15 `model-shortcomings/*.json` files have vendor-prefixed slugs in `model` field; filenames use `_` separator.
- `deno task start populate-shortcomings --only openrouter/deepseek/deepseek-v3.2` (a previously-skipped slug) succeeds.
- `VENDOR_PREFIX_MAP` literal absent from `cli/commands/populate-shortcomings-command.ts`.
- `verify --model` default is `anthropic/claude-opus-4-6` (vendor-prefixed).

Phase C (orchestrator) consumes the same `appendEvent` / `LifecycleEvent` types and now starts emitting fresh non-`migration` events on top of the synthetic baseline laid by this phase.
