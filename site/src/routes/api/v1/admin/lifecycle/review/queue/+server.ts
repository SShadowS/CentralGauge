/**
 * GET /api/v1/admin/lifecycle/review/queue
 *
 * Plan F / F3.3 — returns pending_review rows joined with the
 * analysis.completed event (for analyzer_model) and the latest
 * debug.captured event (for the R2 key the review UI proxies).
 *
 * Auth: dual — CF Access JWT (browser, primary path) OR Ed25519 admin
 * signature (CLI replay). Per F5.5 retro-patch, the unified
 * `authenticateAdminRequest` helper in `$lib/server/cf-access` handles
 * both transports.
 *
 * Read-only (GET) — no body, no signature wrap. The CLI replay path
 * cannot use this endpoint directly because there's no body to sign;
 * a CLI consumer should switch to a body-signed POST mirror if needed.
 */
import type { RequestHandler } from './$types';
import { authenticateAdminRequest } from '$lib/server/cf-access';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { getAll } from '$lib/server/db';

interface QueueRow {
  id: number;
  analysis_event_id: number;
  model_slug: string;
  concept_slug_proposed: string;
  payload_json: string;
  confidence: number;
  created_at: number;
  debug_session_id: string | null;
  r2_key: string | null;
  analyzer_model: string | null;
}

export const GET: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const env = platform.env;
  try {
    // (Plan F / F5.5) authenticateAdminRequest replaces verifySignedRequest.
    // CF Access JWT in the browser is the primary path; CLI signature
    // accepted via the body when present (read endpoints typically pass
    // null because there's no body envelope to sign — CF Access only).
    await authenticateAdminRequest(request, env, null);

    // JOIN to the analysis.completed event for analyzer_model, and to the
    // most recent debug.captured event for the same (model, task_set) so
    // the UI can deep-link the raw debug bundle. The debug.captured event
    // ordering is "before the analysis event" — we use id < le.id so that
    // any later debug captures (re-runs) don't shadow the bundle that the
    // analysis was actually based on.
    const rows = await getAll<QueueRow>(
      env.DB,
      `SELECT pr.id,
              pr.analysis_event_id,
              pr.model_slug,
              pr.concept_slug_proposed,
              pr.payload_json,
              pr.confidence,
              pr.created_at,
              json_extract(dbg.payload_json, '$.session_id') AS debug_session_id,
              json_extract(dbg.payload_json, '$.r2_key')     AS r2_key,
              json_extract(le.payload_json, '$.analyzer_model') AS analyzer_model
         FROM pending_review pr
         JOIN lifecycle_events le ON le.id = pr.analysis_event_id
    LEFT JOIN lifecycle_events dbg
                ON dbg.model_slug = pr.model_slug
               AND dbg.task_set_hash = le.task_set_hash
               AND dbg.event_type = 'debug.captured'
               AND dbg.id < le.id
        WHERE pr.status = 'pending'
        ORDER BY pr.created_at ASC
        LIMIT 200`,
      [],
    );

    return jsonResponse(
      {
        entries: rows.map((r) => {
          // Wave 5 / IMPORTANT 4 — per-row try/catch on payload_json
          // parse. Pre-fix a single corrupted row's SyntaxError surfaced
          // as 500 internal_error and crashed the whole review UI. Now
          // surface the row with `payload: null` + `_parse_error` so the
          // operator can triage one row without losing the queue.
          let payload: unknown = null;
          let parseError: string | undefined;
          try {
            payload = JSON.parse(r.payload_json) as unknown;
          } catch (err) {
            parseError = err instanceof Error ? err.message : String(err);
            console.warn(
              `[review/queue] pending_review id=${r.id} payload_json parse failed: ${parseError}`,
            );
          }
          const out: {
            id: number;
            analysis_event_id: number;
            model_slug: string;
            concept_slug_proposed: string;
            payload: unknown;
            confidence: number;
            created_at: number;
            debug_session_id: string | null;
            r2_key: string | null;
            analyzer_model: string | null;
            _parse_error?: string;
          } = {
            id: r.id,
            analysis_event_id: r.analysis_event_id,
            model_slug: r.model_slug,
            concept_slug_proposed: r.concept_slug_proposed,
            // Parse server-side so the UI gets a typed object instead of a
            // string-that-still-needs-parsing. Plan F's review UI expects
            // `{ entry, confidence }` per the canonical pending_review shape
            // (see src/lifecycle/pending-review.ts docstring).
            payload,
            confidence: r.confidence,
            created_at: r.created_at,
            debug_session_id: r.debug_session_id,
            r2_key: r.r2_key,
            analyzer_model: r.analyzer_model,
          };
          if (parseError !== undefined) out._parse_error = parseError;
          return out;
        }),
        count: rows.length,
      },
      200,
    );
  } catch (err) {
    return errorResponse(err);
  }
};
