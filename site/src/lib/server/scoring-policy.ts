import {
  canonicalJson,
  FORMATS,
  sha256Hex,
  type FormatSlug,
} from "../shared/taxonomy-schema";
import { ApiError } from "./errors";
import { appendAudit } from "./audit";
import type { VerifiedKey } from "./signature";

export interface ScoringPolicy {
  schema_version: 1;
  eligible: { statuses: string[]; sources: string[]; settings_hash: string };
  cohort: { size: number; order: "started_at_desc"; tie_break: "run_id" };
  reduction: "best_of_cohort";
  cells: {
    infra: "exclude";
    provider_error: "exclude";
    refusal: "count_for_requested_model";
    fallback: "count_for_requested_model";
  };
  macro_weights: Record<FormatSlug, number>;
  metrics: string[];
  estimator_version: string;
  draws: number;
  gate: { min_effective_components: number; max_largest_share: number };
}

export function validatePolicy(p: unknown): asserts p is ScoringPolicy {
  const bad = (m: string): never => {
    throw new ApiError(400, "invalid_policy", m);
  };
  if (!p || typeof p !== "object") return bad("policy must be an object");
  const o = p as Partial<ScoringPolicy>;
  if (o.schema_version !== 1) return bad("schema_version must be 1");
  if (
    !o.eligible ||
    !Array.isArray(o.eligible.statuses) ||
    !Array.isArray(o.eligible.sources) ||
    !/^[0-9a-f]{64}$/.test(o.eligible.settings_hash ?? "")
  ) {
    return bad("eligible.{statuses,sources,settings_hash} required");
  }
  if (
    !o.cohort ||
    !Number.isInteger(o.cohort.size) ||
    o.cohort.size < 1 ||
    o.cohort.order !== "started_at_desc" ||
    o.cohort.tie_break !== "run_id"
  ) {
    return bad("cohort invalid");
  }
  if (o.reduction !== "best_of_cohort")
    return bad("reduction must be best_of_cohort");
  if (
    !o.cells ||
    o.cells.infra !== "exclude" ||
    o.cells.provider_error !== "exclude" ||
    o.cells.refusal !== "count_for_requested_model" ||
    o.cells.fallback !== "count_for_requested_model"
  ) {
    return bad("cells invalid");
  }
  const w = o.macro_weights ?? {};
  const keys = Object.keys(w);
  const sum = Object.values(w).reduce((s, x) => s + x, 0);
  const coversFormats =
    keys.length === FORMATS.length && FORMATS.every((f) => f in w);
  if (!coversFormats || Math.abs(sum - 1) > 1e-9) {
    return bad("macro_weights must cover the four formats and sum to 1");
  }
  if (!Array.isArray(o.metrics) || !o.metrics.length) {
    return bad("metrics required");
  }
  if (
    typeof o.estimator_version !== "string" ||
    !o.estimator_version ||
    !Number.isInteger(o.draws) ||
    (o.draws ?? 0) < 1000
  ) {
    return bad("estimator_version and draws >= 1000 required");
  }
  if (
    !o.gate ||
    !(o.gate.min_effective_components > 0) ||
    !(o.gate.max_largest_share > 0 && o.gate.max_largest_share <= 1)
  ) {
    return bad("gate invalid");
  }
}

export function policyDigest(p: ScoringPolicy): Promise<string> {
  return sha256Hex(canonicalJson(p));
}

export async function createPolicy(
  db: D1Database,
  p: ScoringPolicy,
): Promise<{ id: number; digest: string; created: boolean }> {
  const digest = await policyDigest(p);
  const existing = await db
    .prepare(`SELECT id FROM scoring_policies WHERE digest = ?`)
    .bind(digest)
    .first<{ id: number }>();
  if (existing) return { id: existing.id, digest, created: false };
  const r = await db
    .prepare(
      `INSERT INTO scoring_policies(schema_version, digest, policy_json, created_at) VALUES (?,?,?,?)`,
    )
    .bind(1, digest, canonicalJson(p), new Date().toISOString())
    .run();
  return { id: r.meta.last_row_id as number, digest, created: true };
}

export async function assignPolicy(
  db: D1Database,
  hash: string,
  digest: string,
  actor: VerifiedKey,
): Promise<void> {
  const pol = await db
    .prepare(`SELECT id FROM scoring_policies WHERE digest = ?`)
    .bind(digest)
    .first<{ id: number }>();
  if (!pol) throw new ApiError(400, "unknown_policy", digest);
  const before = await db
    .prepare(
      `SELECT p.digest FROM task_sets t LEFT JOIN scoring_policies p ON p.id = t.scoring_policy_id WHERE t.hash = ?`,
    )
    .bind(hash)
    .first<{ digest: string | null }>();
  await db
    .prepare(`UPDATE task_sets SET scoring_policy_id = ? WHERE hash = ?`)
    .bind(pol.id, hash)
    .run();
  await appendAudit(db, {
    event: "scoring_policy_assigned",
    actor,
    taskSetHash: hash,
    before: before?.digest ?? null,
    after: digest,
  });
}
