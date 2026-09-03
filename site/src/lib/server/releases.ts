/**
 * Signed benchmark releases (Task 10, migration 0016_taxonomy_v2.sql).
 *
 * A release freezes a panel manifest (which models/runs were compared, and
 * the rule that decided the retained-task subset) against a specific
 * VERIFIED taxonomy revision + scoring policy, then snapshots the whole
 * task set into a signed, content-addressed R2 export bundle so the release
 * is independently reproducible after the live D1 rows move on.
 */
import { canonicalJson, sha256Hex } from "../shared/taxonomy-schema";
import { ApiError } from "./errors";
import { appendAudit } from "./audit";
import { readRevisionNormalized } from "./taxonomy-v2";
import type { VerifiedKey } from "./signature";
import type { ScoringPolicy } from "./scoring-policy";

/**
 * sha256 of the canonical `{ model_slug: [run ids in cohort order] }` map
 * the policy's cohort rule selects: completed, matching status/source/
 * settings_hash, most recent `cohort.size` runs per model by `started_at`
 * desc then `id` (tie-break). `policy === null` takes EVERY run of the set
 * for each model (no eligibility filter, no cap).
 */
export async function cohortDigest(
  db: D1Database,
  hash: string,
  policy: ScoringPolicy | null,
): Promise<string> {
  const rows = (
    await db
      .prepare(
        `SELECT r.id, m.slug FROM runs r JOIN models m ON m.id = r.model_id
      WHERE r.task_set_hash = ? ${
        policy
          ? "AND r.status IN (" +
            policy.eligible.statuses.map(() => "?").join(",") +
            ") AND r.source IN (" +
            policy.eligible.sources.map(() => "?").join(",") +
            ") AND r.settings_hash = ?"
          : ""
      }
      ORDER BY m.slug, r.started_at DESC, r.id`,
      )
      .bind(
        hash,
        ...(policy
          ? [
              ...policy.eligible.statuses,
              ...policy.eligible.sources,
              policy.eligible.settings_hash,
            ]
          : []),
      )
      .all<{ id: string; slug: string }>()
  ).results;
  const cohort: Record<string, string[]> = {};
  for (const r of rows) {
    cohort[r.slug] ??= [];
    if (!policy || cohort[r.slug].length < policy.cohort.size) {
      cohort[r.slug].push(r.id);
    }
  }
  return sha256Hex(canonicalJson(cohort));
}

export interface PublishPayload {
  slug: string;
  hash: string;
  revision_digest: string;
  scoring_policy_digest: string;
  estimator_version: string;
  panel_manifest: Record<string, unknown>;
  retained_task_ids: string[];
  selection_reasons: Record<string, string>;
  changelog: string;
  supersedes_slug?: string;
}

/**
 * Publish a release: validate the slug + referenced revision/policy/tasks,
 * write `benchmark_releases` + one `release_tasks` row per task of the set
 * (`retained` for `retained_task_ids`, `full_only` for everything else),
 * audit the mutation, then build + store the R2 export bundle and stamp its
 * manifest sha256 back onto the release row.
 */
export async function publishRelease(
  db: D1Database,
  blobs: R2Bucket,
  p: PublishPayload,
  actor: VerifiedKey,
  signature: string,
): Promise<{
  id: number;
  slug: string;
  cohort_digest: string;
  export_manifest_sha256: string;
}> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) {
    throw new ApiError(400, "invalid_slug", p.slug);
  }
  if (
    await db
      .prepare(`SELECT 1 AS x FROM benchmark_releases WHERE slug = ?`)
      .bind(p.slug)
      .first()
  ) {
    throw new ApiError(409, "release_exists", p.slug);
  }
  const rev = await db
    .prepare(
      `SELECT id FROM taxonomy_revisions WHERE task_set_hash = ? AND digest = ? AND verified_at IS NOT NULL`,
    )
    .bind(p.hash, p.revision_digest)
    .first<{ id: number }>();
  if (!rev) throw new ApiError(400, "unknown_revision", p.revision_digest);
  const pol = await db
    .prepare(`SELECT id, policy_json FROM scoring_policies WHERE digest = ?`)
    .bind(p.scoring_policy_digest)
    .first<{ id: number; policy_json: string }>();
  if (!pol) throw new ApiError(400, "unknown_policy", p.scoring_policy_digest);
  const supersedes = p.supersedes_slug
    ? ((
        await db
          .prepare(`SELECT id FROM benchmark_releases WHERE slug = ?`)
          .bind(p.supersedes_slug)
          .first<{ id: number }>()
      )?.id ?? null)
    : null;
  const setIds = (
    await db
      .prepare(
        `SELECT task_id FROM tasks WHERE task_set_hash = ? ORDER BY task_id`,
      )
      .bind(p.hash)
      .all<{ task_id: string }>()
  ).results.map((r) => r.task_id);
  for (const id of p.retained_task_ids) {
    if (!setIds.includes(id))
      throw new ApiError(400, "retained_not_in_set", id);
  }
  const cohort = await cohortDigest(
    db,
    p.hash,
    JSON.parse(pol.policy_json) as ScoringPolicy,
  );
  const ins = await db
    .prepare(
      `INSERT INTO benchmark_releases(slug, task_set_hash, taxonomy_revision_id, scoring_policy_id, estimator_version, cohort_digest, panel_manifest_json, changelog, supersedes_release_id, published_at, published_by, publish_signature)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      p.slug,
      p.hash,
      rev.id,
      pol.id,
      p.estimator_version,
      cohort,
      canonicalJson(p.panel_manifest),
      p.changelog,
      supersedes,
      new Date().toISOString(),
      actor.machine_id,
      signature,
    )
    .run();
  const releaseId = ins.meta.last_row_id as number;
  const retained = new Set(p.retained_task_ids);
  const stmts = setIds.map((id) =>
    db
      .prepare(
        `INSERT INTO release_tasks(release_id, task_id, role, selection_reason) VALUES (?,?,?,?)`,
      )
      .bind(
        releaseId,
        id,
        retained.has(id) ? "retained" : "full_only",
        p.selection_reasons[id] ??
          (retained.has(id) ? "retained" : "not retained"),
      ),
  );
  for (let i = 0; i < stmts.length; i += 40)
    await db.batch(stmts.slice(i, i + 40));
  const exp = await writeExportBundle(db, blobs, releaseId);
  await db
    .prepare(
      `UPDATE benchmark_releases SET export_manifest_sha256 = ? WHERE id = ?`,
    )
    .bind(exp.manifestSha256, releaseId)
    .run();
  await appendAudit(db, {
    event: "release_published",
    actor,
    taskSetHash: p.hash,
    after: exp.manifestSha256,
    details: { slug: p.slug, cohort_digest: cohort },
  });
  return {
    id: releaseId,
    slug: p.slug,
    cohort_digest: cohort,
    export_manifest_sha256: exp.manifestSha256,
  };
}

/**
 * Write the ten-file R2 export bundle for a published release under
 * `exports/<slug>/`. `manifest.json` lists every OTHER file with its sha256
 * + byte size; the manifest's own sha256 is returned so the caller can stamp
 * it onto the release row.
 */
export async function writeExportBundle(
  db: D1Database,
  blobs: R2Bucket,
  releaseId: number,
): Promise<{ manifestSha256: string; keys: string[] }> {
  const rel = (await db
    .prepare(`SELECT * FROM benchmark_releases WHERE id = ?`)
    .bind(releaseId)
    .first<Record<string, unknown>>())!;
  const slug = rel.slug as string;
  const hash = rel.task_set_hash as string;
  const rid = rel.taxonomy_revision_id as number;
  const prefix = `exports/${slug}/`;
  const files: { key: string; sha256: string; bytes: number }[] = [];
  const put = async (name: string, text: string) => {
    const key = prefix + name;
    const bytes = new TextEncoder().encode(text);
    await blobs.put(key, bytes, {
      httpMetadata: {
        contentType: name.endsWith(".jsonl")
          ? "application/x-ndjson"
          : "application/json",
      },
    });
    files.push({ key, sha256: await sha256Hex(text), bytes: bytes.byteLength });
  };
  const jsonl = (rows: unknown[]) =>
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

  await put(
    "release.json",
    JSON.stringify(
      { ...rel, panel_manifest: JSON.parse(rel.panel_manifest_json as string) },
      null,
      1,
    ),
  );
  await put(
    "tasks.jsonl",
    jsonl(
      (
        await db
          .prepare(
            `SELECT rt.task_id, rt.group_slug AS "group", rt.min_bc_version, x.role, x.selection_reason
             FROM taxonomy_revision_tasks rt JOIN release_tasks x ON x.release_id = ? AND x.task_id = rt.task_id
             WHERE rt.revision_id = ? ORDER BY rt.task_id`,
          )
          .bind(releaseId, rid)
          .all()
      ).results,
    ),
  );
  await put(
    "taxonomy.json",
    JSON.stringify(await readRevisionNormalized(db, rid), null, 1),
  );
  const donors = (
    await db
      .prepare(
        `SELECT task_id, donor_task_id, ordinal FROM taxonomy_task_donors WHERE revision_id = ? ORDER BY task_id, ordinal`,
      )
      .bind(rid)
      .all()
  ).results;
  await put("graph.json", JSON.stringify({ donors }, null, 1));
  await put(
    "models.jsonl",
    jsonl(
      (
        await db
          .prepare(
            `SELECT DISTINCT m.slug, m.display_name, m.api_model_id, f.slug AS family_slug
             FROM models m
             JOIN runs r ON r.model_id = m.id
             JOIN model_families f ON f.id = m.family_id
             WHERE r.task_set_hash = ? ORDER BY m.slug`,
          )
          .bind(hash)
          .all()
      ).results,
    ),
  );
  await put(
    "runs.jsonl",
    jsonl(
      (
        await db
          .prepare(
            `SELECT r.id, m.slug AS model, r.status, r.source, r.settings_hash, r.started_at, r.completed_at,
                    r.harness_fingerprint, r.retry_path_version, r.environment_digest, r.bc_artifact,
                    r.container_image_digest, r.bcch_version, r.test_runner, r.prompt_template_digest, r.invocation_json
             FROM runs r JOIN models m ON m.id = r.model_id
             WHERE r.task_set_hash = ? ORDER BY r.started_at, r.id`,
          )
          .bind(hash)
          .all()
      ).results,
    ),
  );
  await put(
    "results.jsonl",
    jsonl(
      (
        await db
          .prepare(
            `SELECT x.run_id, x.task_id, x.attempt, x.passed, x.score, x.compile_success, x.tests_total, x.tests_passed,
                    x.termination_kind, x.cap_reached, x.infra_retries, x.fallback_chain_json, x.prompt_digest,
                    x.candidate_digest, x.test_vector_json, x.served_model, x.refusal_category
             FROM results x JOIN runs r ON r.id = x.run_id
             WHERE r.task_set_hash = ? ORDER BY x.run_id, x.task_id, x.attempt`,
          )
          .bind(hash)
          .all()
      ).results,
    ),
  );
  await put(
    "cohort.json",
    JSON.stringify({ cohort_digest: rel.cohort_digest }, null, 1),
  );
  const pol = await db
    .prepare(`SELECT digest, policy_json FROM scoring_policies WHERE id = ?`)
    .bind(rel.scoring_policy_id as number)
    .first<{ digest: string; policy_json: string }>();
  await put(
    "policy.json",
    JSON.stringify(
      {
        digest: pol?.digest,
        policy: JSON.parse(pol?.policy_json ?? "null"),
        estimator_version: rel.estimator_version,
      },
      null,
      1,
    ),
  );
  const revDigest = (await db
    .prepare(`SELECT digest FROM taxonomy_revisions WHERE id = ?`)
    .bind(rid)
    .first<{ digest: string }>())!.digest;
  const manifest = {
    release: slug,
    task_set_hash: hash,
    revision_digest: revDigest,
    generated_at: new Date().toISOString(),
    files,
    licence: "see site/LICENSE",
    citation: `CentralGauge release ${slug}`,
  };
  const manifestText = JSON.stringify(manifest, null, 1);
  await blobs.put(prefix + "manifest.json", manifestText, {
    httpMetadata: { contentType: "application/json" },
  });
  return {
    manifestSha256: await sha256Hex(manifestText),
    keys: [...files.map((f) => f.key), prefix + "manifest.json"],
  };
}

export interface ReleaseSummary {
  id: number;
  slug: string;
  hash: string;
  revision_digest: string;
  scoring_policy_digest: string;
  estimator_version: string;
  cohort_digest: string;
  panel_manifest: Record<string, unknown>;
  changelog: string;
  supersedes_slug: string | null;
  export_manifest_sha256: string | null;
  published_at: string;
  published_by: string;
  retained_count: number;
  full_count: number;
}

interface ReleaseSummaryRow {
  id: number;
  slug: string;
  task_set_hash: string;
  estimator_version: string;
  cohort_digest: string;
  panel_manifest_json: string;
  changelog: string;
  export_manifest_sha256: string | null;
  published_at: string;
  published_by: string;
  revision_digest: string;
  scoring_policy_digest: string;
  supersedes_slug: string | null;
  retained_count: number;
  full_count: number;
}

function mapReleaseRow(r: ReleaseSummaryRow): ReleaseSummary {
  return {
    id: r.id,
    slug: r.slug,
    hash: r.task_set_hash,
    revision_digest: r.revision_digest,
    scoring_policy_digest: r.scoring_policy_digest,
    estimator_version: r.estimator_version,
    cohort_digest: r.cohort_digest,
    panel_manifest: JSON.parse(r.panel_manifest_json) as Record<
      string,
      unknown
    >,
    changelog: r.changelog,
    supersedes_slug: r.supersedes_slug ?? null,
    export_manifest_sha256: r.export_manifest_sha256 ?? null,
    published_at: r.published_at,
    published_by: r.published_by,
    retained_count: r.retained_count,
    full_count: r.full_count,
  };
}

const RELEASE_SUMMARY_SQL = `
  SELECT br.id, br.slug, br.task_set_hash, br.estimator_version, br.cohort_digest, br.panel_manifest_json,
         br.changelog, br.export_manifest_sha256, br.published_at, br.published_by,
         tr.digest AS revision_digest, sp.digest AS scoring_policy_digest, sup.slug AS supersedes_slug,
         (SELECT COUNT(*) FROM release_tasks rt WHERE rt.release_id = br.id AND rt.role = 'retained') AS retained_count,
         (SELECT COUNT(*) FROM release_tasks rt WHERE rt.release_id = br.id) AS full_count
  FROM benchmark_releases br
  JOIN taxonomy_revisions tr ON tr.id = br.taxonomy_revision_id
  JOIN scoring_policies sp ON sp.id = br.scoring_policy_id
  LEFT JOIN benchmark_releases sup ON sup.id = br.supersedes_release_id
`;

/** Every release published against `hash`, most recent first. */
export async function listReleases(
  db: D1Database,
  hash: string,
): Promise<ReleaseSummary[]> {
  const rows = (
    await db
      .prepare(
        `${RELEASE_SUMMARY_SQL} WHERE br.task_set_hash = ? ORDER BY br.published_at DESC`,
      )
      .bind(hash)
      .all<ReleaseSummaryRow>()
  ).results;
  return rows.map(mapReleaseRow);
}

/** One release by slug, or `null` if no such release exists. */
export async function getReleaseBySlug(
  db: D1Database,
  slug: string,
): Promise<ReleaseSummary | null> {
  const row = await db
    .prepare(`${RELEASE_SUMMARY_SQL} WHERE br.slug = ?`)
    .bind(slug)
    .first<ReleaseSummaryRow>();
  return row ? mapReleaseRow(row) : null;
}
