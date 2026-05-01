#!/usr/bin/env -S deno run --allow-all
/**
 * D-data Task D1.6 — backfill the canonical concepts registry from the
 * historical free-text shortcomings.concept strings in production D1.
 *
 * Walk every distinct (concept, al_concept, description) triple, embed it
 * via OpenAI text-embedding-3-small, cluster against existing concepts,
 * and dispatch each candidate through the signed admin API:
 *
 *   slug-equal OR cosine ≥ 0.85 → POST .../concepts/merge   (auto-merge)
 *   0.70 ≤ cosine < 0.85       → POST .../concepts/review-enqueue
 *   cosine < 0.70              → POST .../concepts/create   (auto-create)
 *
 * IDEMPOTENT: re-running after a partial failure replays cleanly because
 * every mutation lands in a single D1 batch and the shortcomings updated
 * in batch N-1 already carry concept_id (skipped on N).
 *
 * Pacing: ~10 req/min admin rate-limit (Cloudflare). 7000 ms between
 * POSTs gives ~8.5 req/min with margin. Worst case ~21 distinct strings
 * × 1 event each = ~2.5 min wall-clock; with the analysis_event_id
 * one-shot per (model, task_set) pair the multiplier is ~2x.
 *
 * Usage:
 *   deno run --allow-all scripts/backfill-concepts.ts
 *   deno run --allow-all scripts/backfill-concepts.ts --dry-run
 *   deno run --allow-all scripts/backfill-concepts.ts --actor migration --limit 50
 *
 * Plan: docs/superpowers/plans/2026-04-29-lifecycle-D-data-impl.md Task D1.6.
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import OpenAI from "@openai/openai";
import { cosineSimilarity, Embedder } from "../src/lifecycle/embedder.ts";
import {
  type ClusterCandidate,
  decideCluster,
} from "../src/lifecycle/cluster-decide.ts";
import { collectEnvelope } from "../src/lifecycle/envelope.ts";
import { loadIngestConfig, readPrivateKey } from "../src/ingest/config.ts";
import { signPayload } from "../src/ingest/sign.ts";
import { postWithRetry } from "../src/ingest/client.ts";
import { appendEvent } from "../src/lifecycle/event-log.ts";

interface ShortcomingRow {
  id: number;
  model_slug: string;
  task_set_hash: string | null;
  concept: string;
  al_concept: string;
  description: string;
  concept_id: number | null;
}

interface BackfillFlags {
  dryRun: boolean;
  actor: "migration" | "operator" | "ci" | "reviewer";
  limit?: number;
  thresholdMerge?: number;
  thresholdReview?: number;
}

const PACE_MS = 7000; // ~8.5 req/min — same shape as scripts/backfill-lifecycle.ts.

async function fetchUnclassified(
  siteUrl: string,
  signed: { version: 1; payload: unknown; signature: unknown },
): Promise<ShortcomingRow[]> {
  const resp = await postWithRetry(
    `${siteUrl}/api/v1/admin/lifecycle/shortcomings/unclassified`,
    signed,
  );
  if (!resp.ok) {
    throw new Error(
      `fetch unclassified failed: ${resp.status} ${await resp.text()}`,
    );
  }
  const body = (await resp.json()) as { rows: ShortcomingRow[] };
  return body.rows;
}

async function fetchConcepts(
  siteUrl: string,
  signed: { version: 1; payload: unknown; signature: unknown },
): Promise<{ id: number; slug: string }[]> {
  const resp = await postWithRetry(
    `${siteUrl}/api/v1/admin/lifecycle/concepts/list`,
    signed,
  );
  if (!resp.ok) {
    throw new Error(
      `fetch concepts failed: ${resp.status} ${await resp.text()}`,
    );
  }
  const body = (await resp.json()) as { rows: { id: number; slug: string }[] };
  return body.rows;
}

/**
 * Cache for one-shot analysis.completed event per (model, task_set) pair.
 * Review-band entries need a real lifecycle_events.id (FK NOT NULL); rather
 * than emit one event per shortcoming we emit one per pair and reuse it
 * across every review-band shortcoming inside that pair.
 */
function makeAnalysisEventCache(
  siteUrl: string,
  privKey: Uint8Array,
  keyId: number,
): (
  modelSlug: string,
  taskSetHash: string,
  envelopeJson: string,
) => Promise<number> {
  const cache = new Map<string, number>();
  return async (modelSlug, taskSetHash, envelopeJson) => {
    const key = `${modelSlug}|${taskSetHash}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    // Use the canonical CLI appendEvent helper which signs + POSTs to
    // /api/v1/admin/lifecycle/events. No direct INSERT — every event flows
    // through the signed admin endpoint per cross-plan invariant #1.
    const { id } = await appendEvent(
      {
        event_type: "analysis.completed",
        model_slug: modelSlug,
        task_set_hash: taskSetHash,
        actor: "migration",
        actor_id: null,
        payload: {},
        envelope: JSON.parse(envelopeJson) as Record<string, unknown>,
      },
      { url: siteUrl, privateKey: privKey, keyId },
    );
    cache.set(key, id);
    return id;
  };
}

function prettify(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w[0]?.toUpperCase() ?? "") + w.slice(1))
    .join(" ");
}

async function runBackfill(opts: BackfillFlags): Promise<void> {
  const cwd = Deno.cwd();
  const config = await loadIngestConfig(cwd, {});
  if (!config.adminKeyPath || config.adminKeyId == null) {
    console.error(
      colors.red(
        "[ERR] admin_key_path + admin_key_id required in .centralgauge.yml " +
          "(admin scope; ingest key is rejected by the cluster endpoints).",
      ),
    );
    Deno.exit(1);
  }
  const adminPriv = await readPrivateKey(config.adminKeyPath);
  const adminKeyId = config.adminKeyId;

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error(
      colors.red("[ERR] OPENAI_API_KEY required for embedding pass"),
    );
    Deno.exit(1);
  }
  const openai = new OpenAI({ apiKey });
  const embedder = new Embedder(openai);
  await embedder.init();

  const envelope = await collectEnvelope({});
  const envelopeJson = JSON.stringify(envelope);

  // List read — uses the same signed-body envelope as the writes.
  const listPayload = { scope: "list" as const, ts: Date.now() };
  const listSig = await signPayload(
    listPayload,
    adminPriv,
    adminKeyId,
  );
  const listSigned = {
    version: 1 as const,
    payload: listPayload,
    signature: listSig,
  };

  const unclassified = await fetchUnclassified(config.url, listSigned);
  const concepts = await fetchConcepts(config.url, listSigned);

  console.log(
    colors.cyan(
      `[INFO] ${unclassified.length} unclassified shortcomings, ${concepts.length} existing concepts`,
    ),
  );

  if (unclassified.length === 0) {
    console.log(colors.green("[OK] nothing to backfill"));
    embedder.close();
    return;
  }

  // Embed all distinct concept strings (cache hits are free; misses batched).
  const distinctSlugs = new Set<string>([
    ...unclassified.map((r) => r.concept),
    ...concepts.map((c) => c.slug),
  ]);
  const slugList = [...distinctSlugs];
  console.log(
    colors.gray(`[INFO] embedding ${slugList.length} distinct slugs...`),
  );
  const embeddings = await embedder.embedMany(slugList);

  // Group rows by (model_slug, concept) so all shortcomings sharing the same
  // proposed slug update together. task_set_hash defaults to a sentinel since
  // shortcomings has no per-row column (matches scripts/backfill-lifecycle.ts).
  const SENTINEL = "pre-p6-unknown";
  type GroupKey = string;
  const groups = new Map<GroupKey, ShortcomingRow[]>();
  for (const row of unclassified) {
    if (row.concept_id !== null) continue; // idempotent skip
    const tsh = row.task_set_hash ?? SENTINEL;
    const key = `${row.model_slug}|${tsh}|${row.concept}`;
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  const ensureAnalysisEvent = makeAnalysisEventCache(
    config.url,
    adminPriv,
    adminKeyId,
  );

  let processed = 0;
  let merged = 0;
  let created = 0;
  let queued = 0;

  for (const [key, rows] of groups) {
    if (opts.limit !== undefined && processed >= opts.limit) break;
    const [modelSlug, taskSetHash, proposedSlug] = key.split("|") as [
      string,
      string,
      string,
    ];
    const propVec = embeddings.get(proposedSlug);
    if (!propVec) {
      console.error(
        colors.red(`[ERR] no embedding for '${proposedSlug}' — skip`),
      );
      continue;
    }

    const candidates: ClusterCandidate[] = concepts.map((c) => ({
      conceptId: c.id,
      slug: c.slug,
      similarity: cosineSimilarity(propVec, embeddings.get(c.slug)!),
    }));

    const decision = decideCluster(proposedSlug, candidates);
    const sample = rows[0]!;
    const shortcomingIds = rows.map((r) => r.id);

    if (opts.dryRun) {
      const detail = decision.kind === "auto-merge"
        ? `→ #${decision.target.conceptId} '${decision.target.slug}' (${
          decision.target.similarity.toFixed(3)
        })`
        : decision.kind === "review"
        ? `~ '${decision.target.slug}' (${
          decision.target.similarity.toFixed(3)
        })`
        : `(nearest ${decision.nearest?.similarity.toFixed(3) ?? "n/a"})`;
      console.log(
        colors.yellow(
          `[DRY] ${proposedSlug} → ${decision.kind} ${detail}  [${shortcomingIds.length} shortcomings]`,
        ),
      );
      processed++;
      continue;
    }

    try {
      if (decision.kind === "auto-merge") {
        const payload = {
          proposed_slug: proposedSlug,
          winner_concept_id: decision.target.conceptId,
          similarity: decision.target.similarity,
          shortcoming_ids: shortcomingIds,
          model_slug: modelSlug,
          task_set_hash: taskSetHash,
          actor: opts.actor,
          actor_id: null,
          envelope_json: envelopeJson,
          ts: Date.now(),
        };
        const sig = await signPayload(payload, adminPriv, adminKeyId);
        const resp = await postWithRetry(
          `${config.url}/api/v1/admin/lifecycle/concepts/merge`,
          { version: 1, payload, signature: sig },
        );
        if (!resp.ok) {
          console.error(
            colors.red(
              `[ERR ${resp.status}] merge failed for ${proposedSlug}: ${await resp
                .text()}`,
            ),
          );
          continue;
        }
        merged++;
        console.log(
          colors.green(
            `[MERGE] ${proposedSlug} → #${decision.target.conceptId} (${
              decision.target.similarity.toFixed(3)
            })`,
          ),
        );
      } else if (decision.kind === "review") {
        const analysisEventId = await ensureAnalysisEvent(
          modelSlug,
          taskSetHash,
          envelopeJson,
        );
        const entry = {
          concept: sample.concept,
          alConcept: sample.al_concept,
          description: sample.description,
          concept_slug_proposed: proposedSlug,
          concept_slug_existing_match: decision.target.slug,
          similarity_score: decision.target.similarity,
          // backfill annotation; Plan F's reader ignores unknown fields.
          sample_descriptions: rows.slice(0, 3).map((r) => r.description),
        };
        const payload = {
          entry,
          confidence: decision.target.similarity,
          proposed_slug: proposedSlug,
          nearest_concept_id: decision.target.conceptId,
          similarity: decision.target.similarity,
          model_slug: modelSlug,
          shortcoming_ids: shortcomingIds,
          analysis_event_id: analysisEventId,
          ts: Date.now(),
        };
        const sig = await signPayload(payload, adminPriv, adminKeyId);
        const resp = await postWithRetry(
          `${config.url}/api/v1/admin/lifecycle/concepts/review-enqueue`,
          { version: 1, payload, signature: sig },
        );
        if (!resp.ok) {
          console.error(
            colors.red(
              `[ERR ${resp.status}] review-enqueue failed for ${proposedSlug}: ${await resp
                .text()}`,
            ),
          );
          continue;
        }
        queued++;
        console.log(
          colors.yellow(
            `[REVIEW] ${proposedSlug} ~ ${decision.target.slug} (${
              decision.target.similarity.toFixed(3)
            })`,
          ),
        );
      } else {
        // auto-create
        const payload = {
          proposed_slug: proposedSlug,
          display_name: prettify(proposedSlug),
          al_concept: sample.al_concept,
          description: sample.description,
          similarity_to_nearest: decision.nearest?.similarity ?? 0,
          shortcoming_ids: shortcomingIds,
          model_slug: modelSlug,
          task_set_hash: taskSetHash,
          actor: opts.actor,
          actor_id: null,
          envelope_json: envelopeJson,
          ts: Date.now(),
          analyzer_model: null,
        };
        const sig = await signPayload(payload, adminPriv, adminKeyId);
        const resp = await postWithRetry(
          `${config.url}/api/v1/admin/lifecycle/concepts/create`,
          { version: 1, payload, signature: sig },
        );
        if (!resp.ok) {
          console.error(
            colors.red(
              `[ERR ${resp.status}] create failed for ${proposedSlug}: ${await resp
                .text()}`,
            ),
          );
          continue;
        }
        const body = (await resp.json()) as { conceptId: number };
        // Add the freshly-created concept to the in-memory list so
        // subsequent rows in this run can match against it. We DON'T
        // re-embed (the slug is already embedded above as part of
        // distinctSlugs since it appeared in unclassified.concept).
        concepts.push({ id: body.conceptId, slug: proposedSlug });
        created++;
        console.log(
          colors.cyan(`[CREATE] ${proposedSlug} (#${body.conceptId})`),
        );
      }
    } catch (e) {
      console.error(
        colors.red(
          `[ERR] ${proposedSlug}: ${e instanceof Error ? e.message : e}`,
        ),
      );
      // Don't abort the whole run on one failure — operator can retry.
    }

    processed++;
    // Pace to stay under the admin rate limit.
    if (PACE_MS > 0) {
      await new Promise((r) => setTimeout(r, PACE_MS));
    }
  }

  embedder.close();
  console.log(
    colors.bold(
      `\n[DONE] processed=${processed} merged=${merged} created=${created} queued=${queued}`,
    ),
  );
}

async function main(): Promise<void> {
  await new Command()
    .name("backfill-concepts")
    .description(
      "Cluster historical shortcomings.concept strings into the concepts registry.",
    )
    .option("--dry-run", "plan only, no writes", { default: false })
    .option(
      "--actor <a:string>",
      "actor (migration|operator|ci|reviewer)",
      { default: "migration" },
    )
    .option("--limit <n:integer>", "cap iterations (debug)")
    .option(
      "--threshold-merge <n:number>",
      "auto-merge cosine threshold (default 0.85)",
    )
    .option(
      "--threshold-review <n:number>",
      "review-band lower bound (default 0.70)",
    )
    .action(async (opts) => {
      const flags: BackfillFlags = {
        dryRun: !!opts.dryRun,
        actor: (opts.actor as BackfillFlags["actor"]) ?? "migration",
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.thresholdMerge !== undefined
          ? { thresholdMerge: opts.thresholdMerge }
          : {}),
        ...(opts.thresholdReview !== undefined
          ? { thresholdReview: opts.thresholdReview }
          : {}),
      };
      await runBackfill(flags);
    })
    .parse(Deno.args);
}

if (import.meta.main) {
  await main();
}
