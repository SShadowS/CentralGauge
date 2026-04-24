import type { RequestHandler } from './$types';
import { verifySignedRequest, type SignedAdminRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

interface ModelUpsert {
  slug: string;
  api_model_id: string;
  family: string;
  display_name: string;
  generation?: number | null;
  released_at?: string | null;
  deprecated_at?: string | null;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const body = await request.json() as { version: number; signature: any; payload: ModelUpsert };
    if (body.version !== 1) throw new ApiError(400, 'bad_version', 'only version 1 supported');
    await verifySignedRequest(db, body as unknown as SignedAdminRequest, 'admin');
    const p = body.payload;
    if (!p.slug || !p.api_model_id || !p.family || !p.display_name) {
      throw new ApiError(400, 'missing_field', 'slug, api_model_id, family, display_name required');
    }
    const fam = await db.prepare(`SELECT id FROM model_families WHERE slug = ?`).bind(p.family).first<{ id: number }>();
    if (!fam) throw new ApiError(400, 'unknown_family', `model family '${p.family}' not in catalog`);
    // Reject silent family reassignment: check if model already exists under a different family
    const existing = await db.prepare(
      `SELECT m.id, m.family_id, f.slug AS family_slug
       FROM models m JOIN model_families f ON f.id = m.family_id
       WHERE m.slug = ? AND m.api_model_id = ?`,
    ).bind(p.slug, p.api_model_id).first<{ id: number; family_id: number; family_slug: string }>();
    if (existing && existing.family_id !== fam.id) {
      throw new ApiError(409, 'family_mismatch',
        `model '${p.slug}' already belongs to family '${existing.family_slug}', cannot change to '${p.family}'`);
    }
    await db.prepare(
      `INSERT INTO models(family_id, slug, api_model_id, display_name, generation, released_at, deprecated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, api_model_id) DO UPDATE SET
         display_name = excluded.display_name,
         generation = excluded.generation,
         released_at = excluded.released_at,
         deprecated_at = excluded.deprecated_at`,
    ).bind(
      fam.id, p.slug, p.api_model_id, p.display_name,
      p.generation ?? null, p.released_at ?? null, p.deprecated_at ?? null,
    ).run();
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
