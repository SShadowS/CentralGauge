import type { RequestHandler } from "./$types";
import { bumpDataEpochStmt } from "$lib/server/data-epoch";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";

interface PricingUpsert {
  pricing_version: string;
  model_slug: string;
  input_per_mtoken: number;
  output_per_mtoken: number;
  cache_read_per_mtoken?: number;
  cache_write_per_mtoken?: number;
  batch_input_per_mtoken?: number | null;
  batch_output_per_mtoken?: number | null;
  batch_cache_read_per_mtoken?: number | null;
  batch_cache_write_per_mtoken?: number | null;
  effective_from: string;
  effective_until?: string;
  source: string;
  fetched_at?: string;
}

const BATCH_FIELDS = [
  "batch_input_per_mtoken",
  "batch_output_per_mtoken",
  "batch_cache_read_per_mtoken",
  "batch_cache_write_per_mtoken",
] as const;

/**
 * Batch rates are optional AND independently nullable (spec D5): absence
 * must bind as SQL NULL, never 0, so a batch-mode run with no known batch
 * rate prices as NULL rather than free. Reject anything else (a string, a
 * non-finite number) rather than silently coercing it.
 */
function validateBatchField(
  p: PricingUpsert,
  field: (typeof BATCH_FIELDS)[number],
) {
  const v = p[field];
  if (v === undefined || v === null) return;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ApiError(
      400,
      "invalid_pricing_field",
      `${field} must be a finite number, null, or omitted`,
    );
  }
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  try {
    const body = (await request.json()) as {
      version: number;
      signature: any;
      payload: PricingUpsert;
    };
    if (body.version !== 1) {
      throw new ApiError(400, "bad_version", "only version 1 supported");
    }
    await verifySignedRequest(
      db,
      body as unknown as SignedAdminRequest,
      "admin",
    );
    const p = body.payload;
    const m = await db
      .prepare(`SELECT id FROM models WHERE slug = ?`)
      .bind(p.model_slug)
      .first<{ id: number }>();
    if (!m) {
      throw new ApiError(
        400,
        "unknown_model",
        `model_slug '${p.model_slug}' not in catalog`,
      );
    }
    if (!p.source) {
      throw new ApiError(
        400,
        "missing_source",
        "source is required (anthropic-api, openai-api, gemini-api, openrouter-api, manual)",
      );
    }
    for (const field of BATCH_FIELDS) validateBatchField(p, field);
    // Upsert by (pricing_version, model_id): the catalog YAML is the source of
    // truth, so a repost RECONCILES the row (corrects values) instead of being
    // dropped. Reposting identical values is a harmless no-op write.
    // KEEP IN SYNC WITH migrations/0003_cost_source.sql (source, fetched_at)
    // and 0019_batch_mode.sql (batch_* bound `?? null`, NEVER `?? 0`: NULL
    // must stay distinguishable from "priced at zero").
    const stmt = db
      .prepare(
        `INSERT INTO cost_snapshots(
         pricing_version, model_id, input_per_mtoken, output_per_mtoken,
         cache_read_per_mtoken, cache_write_per_mtoken,
         batch_input_per_mtoken, batch_output_per_mtoken,
         batch_cache_read_per_mtoken, batch_cache_write_per_mtoken,
         effective_from, effective_until,
         source, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pricing_version, model_id) DO UPDATE SET
         input_per_mtoken = excluded.input_per_mtoken,
         output_per_mtoken = excluded.output_per_mtoken,
         cache_read_per_mtoken = excluded.cache_read_per_mtoken,
         cache_write_per_mtoken = excluded.cache_write_per_mtoken,
         batch_input_per_mtoken = excluded.batch_input_per_mtoken,
         batch_output_per_mtoken = excluded.batch_output_per_mtoken,
         batch_cache_read_per_mtoken = excluded.batch_cache_read_per_mtoken,
         batch_cache_write_per_mtoken = excluded.batch_cache_write_per_mtoken,
         effective_from = excluded.effective_from,
         effective_until = excluded.effective_until,
         source = excluded.source,
         fetched_at = excluded.fetched_at`,
      )
      .bind(
        p.pricing_version,
        m.id,
        p.input_per_mtoken,
        p.output_per_mtoken,
        p.cache_read_per_mtoken ?? 0,
        p.cache_write_per_mtoken ?? 0,
        p.batch_input_per_mtoken ?? null,
        p.batch_output_per_mtoken ?? null,
        p.batch_cache_read_per_mtoken ?? null,
        p.batch_cache_write_per_mtoken ?? null,
        p.effective_from,
        p.effective_until ?? null,
        p.source,
        p.fetched_at ?? null,
      );
    // Catalog edits move leaderboard columns (cost, metadata, openness),
    // so retire every cached aggregate. In-batch with the write: a
    // committed edit paired with a failed bump would serve pre-edit
    // numbers until the 24h TTL. See src/lib/server/data-epoch.ts.
    await db.batch([stmt, bumpDataEpochStmt(db)]);
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
