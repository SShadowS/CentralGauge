import type { RequestHandler } from './$types';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { verifySignedRequest } from '$lib/server/signature';
import type {
  PrecheckCatalog,
  PrecheckRequest,
  PrecheckResponse,
} from '$lib/shared/types';

/**
 * POST /api/v1/precheck — read-only signed health probe.
 *
 * Auth-only mode (this task, T6): verifies the Ed25519 signature against the
 * machine_keys row, reports whether the key is active and whether the bound
 * machine_id matches the payload claim, and returns the server's current time
 * for client-side clock-skew detection.
 *
 * T7 will extend this endpoint with an optional catalog block when the
 * request payload includes variants[].
 *
 * Read-only contract: no INSERT/UPDATE/DELETE in this handler. Note that
 * verifySignedRequest performs a best-effort UPDATE machine_keys.last_used_at
 * as telemetry — that is internal to the verifier and not user-visible state.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  }
  const db = platform.env.DB;

  try {
    const body = (await request.json()) as PrecheckRequest;

    if (body.version !== 1) {
      throw new ApiError(400, 'version_unsupported', 'version must be 1');
    }
    if (!body.payload || typeof body.payload.machine_id !== 'string') {
      throw new ApiError(400, 'bad_payload', 'payload.machine_id required');
    }

    // Required scope: 'ingest' (the lowest tier; verifier/admin satisfy via hasScope).
    const verified = await verifySignedRequest(
      db,
      { signature: body.signature, payload: body.payload as unknown as Record<string, unknown> },
      'ingest',
    );

    // verifySignedRequest already throws 401 'revoked_key' when revoked_at is set,
    // so on success the key is by definition active.
    const auth = {
      ok: true as const,
      key_id: verified.key_id,
      key_role: verified.scope,
      key_active: true,
      machine_id_match: verified.machine_id === body.payload.machine_id,
    };

    // Catalog probe: only when variants[] is non-empty. Read-only SELECTs only.
    let catalog: PrecheckCatalog | undefined;
    const variants = body.payload.variants;
    if (variants && variants.length > 0) {
      const slugs = variants.map((v) => v.slug);
      const placeholders = slugs.map(() => '?').join(',');

      // 1. Look up models matching the requested slugs.
      const modelsRes = await db
        .prepare(`SELECT id, slug FROM models WHERE slug IN (${placeholders})`)
        .bind(...slugs)
        .all<{ id: number; slug: string }>();
      const foundRows = modelsRes.results ?? [];
      const foundSlugs = new Set(foundRows.map((r) => r.slug));

      const missing_models = variants
        .filter((v) => !foundSlugs.has(v.slug))
        .map((v) => ({ slug: v.slug, reason: 'not_in_catalog' }));

      // 2. Look up cost_snapshots at the requested pricing_version (if any).
      const missing_pricing: PrecheckCatalog['missing_pricing'] = [];
      const pricingVersion = body.payload.pricing_version;
      if (pricingVersion && foundRows.length > 0) {
        const idPlaceholders = foundRows.map(() => '?').join(',');
        const costRes = await db
          .prepare(
            `SELECT model_id FROM cost_snapshots WHERE pricing_version = ? AND model_id IN (${idPlaceholders})`,
          )
          .bind(pricingVersion, ...foundRows.map((r) => r.id))
          .all<{ model_id: number }>();
        const pricedModelIds = new Set((costRes.results ?? []).map((r) => r.model_id));
        for (const row of foundRows) {
          if (!pricedModelIds.has(row.id)) {
            missing_pricing.push({ slug: row.slug, pricing_version: pricingVersion });
          }
        }
      }

      // 3. Task set lookup.
      let task_set_known = false;
      let task_set_current = false;
      const taskSetHash = body.payload.task_set_hash;
      if (taskSetHash) {
        const tsRow = await db
          .prepare(`SELECT is_current FROM task_sets WHERE hash = ?`)
          .bind(taskSetHash)
          .first<{ is_current: number }>();
        if (tsRow) {
          task_set_known = true;
          task_set_current = tsRow.is_current === 1;
        }
      }

      catalog = {
        missing_models,
        missing_pricing,
        task_set_current,
        task_set_known,
      };
    }

    const response: PrecheckResponse = {
      schema_version: 1,
      auth,
      ...(catalog ? { catalog } : {}),
      server_time: new Date().toISOString(),
    };
    return jsonResponse(response, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
