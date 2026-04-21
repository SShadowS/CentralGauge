import type { RequestHandler } from './$types';
import { verifySignedRequest, type SignedAdminRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

interface PricingUpsert {
  pricing_version: string;
  model_slug: string;
  input_per_mtoken: number;
  output_per_mtoken: number;
  cache_read_per_mtoken?: number;
  cache_write_per_mtoken?: number;
  effective_from: string;
  effective_until?: string;
  source: string;
  fetched_at?: string;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const body = await request.json() as { version: number; signature: any; payload: PricingUpsert };
    if (body.version !== 1) throw new ApiError(400, 'bad_version', 'only version 1 supported');
    await verifySignedRequest(db, body as unknown as SignedAdminRequest, 'admin');
    const p = body.payload;
    const m = await db.prepare(`SELECT id FROM models WHERE slug = ?`).bind(p.model_slug).first<{ id: number }>();
    if (!m) throw new ApiError(400, 'unknown_model', `model_slug '${p.model_slug}' not in catalog`);
    if (!p.source) throw new ApiError(400, 'missing_source', 'source is required (anthropic-api, openai-api, gemini-api, openrouter-api, manual)');
    // Idempotent by (pricing_version, model_id); reposts silently no-op
    // KEEP IN SYNC WITH migrations/0003_cost_source.sql (source, fetched_at)
    await db.prepare(
      `INSERT OR IGNORE INTO cost_snapshots(
         pricing_version, model_id, input_per_mtoken, output_per_mtoken,
         cache_read_per_mtoken, cache_write_per_mtoken, effective_from, effective_until,
         source, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      p.pricing_version, m.id, p.input_per_mtoken, p.output_per_mtoken,
      p.cache_read_per_mtoken ?? 0, p.cache_write_per_mtoken ?? 0,
      p.effective_from, p.effective_until ?? null,
      p.source, p.fetched_at ?? null,
    ).run();
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
