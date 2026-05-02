/**
 * POST /api/v1/admin/lifecycle/cluster-review/queue
 *
 * D-data §D7.3 — Returns the pending_review queue with sample descriptions
 * joined from shortcomings (proposed side) and concepts + shortcomings
 * (nearest side) so the cluster-review CLI can render rich operator
 * context per row.
 *
 * Auth: dual — CF Access JWT (browser path) OR Ed25519 admin signature
 * (CLI path). Wired through `authenticateAdminRequest` per F5.5 retro-patch.
 */
import type { RequestHandler } from "./$types";
import { z } from "zod";
import { authenticateAdminRequest } from "$lib/server/cf-access";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";

const Body = z.object({
  scope: z.literal("list"),
  ts: z.number().int(),
  /** Cap rows returned. Default 100. */
  limit: z.number().int().min(1).max(500).optional(),
});

interface QueueRow {
  id: number;
  model_slug: string;
  concept_slug_proposed: string;
  payload_json: string;
  confidence: number;
  created_at: number;
  nearest_concept_id: number | null;
  nearest_slug: string | null;
  nearest_description: string | null;
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
      version?: number;
      signature: unknown;
      payload: unknown;
    };
    if (body.version !== 1) {
      throw new ApiError(400, "bad_version", "only version 1 supported");
    }
    // (Plan F / F5.5) authenticateAdminRequest replaces verifySignedRequest.
    // Browser path: cluster-review web UI lives at /admin/lifecycle/clusters
    // and authenticates via CF Access (no signature in body).
    await authenticateAdminRequest(request, platform.env, body);
    const parsed = Body.safeParse(body.payload);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_body", parsed.error.message);
    }
    const limit = parsed.data.limit ?? 100;

    // Pull pending_review rows + lift cluster metadata from payload_json
    // server-side via JSON_EXTRACT so the CLI gets a flat shape. nearest
    // concept JOIN-resolves through entry._cluster.nearest_concept_id.
    //
    // Wave 5 / IMPORTANT 4 — guard JSON_EXTRACT with json_valid() so a
    // single corrupted payload_json doesn't surface as
    // 'D1_ERROR: malformed JSON: SQLITE_ERROR' and crash the whole query.
    // SQLite's JSON_EXTRACT raises on invalid JSON; CASE WHEN
    // json_valid(...) THEN ... ELSE NULL skips invalid rows for the
    // join-key lookup, then the per-row map below surfaces _parse_error.
    const rows = await db
      .prepare(
        `SELECT pr.id                                                          AS id,
                pr.model_slug                                                  AS model_slug,
                pr.concept_slug_proposed                                       AS concept_slug_proposed,
                pr.payload_json                                                AS payload_json,
                pr.confidence                                                  AS confidence,
                pr.created_at                                                  AS created_at,
                CASE WHEN json_valid(pr.payload_json)
                     THEN CAST(JSON_EXTRACT(pr.payload_json, '$.entry._cluster.nearest_concept_id') AS INTEGER)
                     ELSE NULL END                                             AS nearest_concept_id,
                c.slug                                                         AS nearest_slug,
                c.description                                                  AS nearest_description
           FROM pending_review pr
           LEFT JOIN concepts c
             ON c.id = (CASE WHEN json_valid(pr.payload_json)
                             THEN CAST(JSON_EXTRACT(pr.payload_json, '$.entry._cluster.nearest_concept_id') AS INTEGER)
                             ELSE NULL END)
          WHERE pr.status = 'pending'
          ORDER BY pr.created_at ASC
          LIMIT ?`,
      )
      .bind(limit)
      .all<QueueRow>();

    // Surface the rich shape the CLI consumes. Cluster metadata pre-extracted
    // from payload_json's entry._cluster so the CLI doesn't need to re-parse.
    type FlatRow = {
      id: number;
      model_slug: string;
      concept_slug_proposed: string;
      confidence: number;
      created_at: number;
      payload: Record<string, unknown> | null;
      nearest: {
        id: number | null;
        slug: string | null;
        description: string | null;
        sample_descriptions: string[];
      };
      _parse_error?: string;
    };
    const flat: FlatRow[] = rows.results.map((r): FlatRow => {
      // Wave 5 / IMPORTANT 4 — per-row try/catch on payload_json parse.
      // Pre-fix a single corrupted row's SyntaxError surfaced as 500
      // internal_error and crashed the whole cluster-review UI. Now
      // surface the row with `payload: null` + `_parse_error` so the
      // operator can triage one row without losing the queue.
      let parsedPayload: {
        entry?: Record<string, unknown> & {
          _cluster?: {
            proposed_slug?: string;
            nearest_concept_id?: number;
            similarity?: number;
            shortcoming_ids?: number[];
          };
          al_concept?: string;
          alConcept?: string;
          sample_descriptions?: string[];
          description?: string;
        };
      } | null = null;
      let parseError: string | undefined;
      try {
        parsedPayload = JSON.parse(r.payload_json);
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err);
        console.warn(
          `[cluster-review/queue] pending_review id=${r.id} payload_json parse failed: ${parseError}`,
        );
      }
      if (!parsedPayload) {
        const out: FlatRow = {
          id: r.id,
          model_slug: r.model_slug,
          concept_slug_proposed: r.concept_slug_proposed,
          confidence: r.confidence,
          created_at: r.created_at,
          payload: null,
          nearest: {
            id: r.nearest_concept_id,
            slug: r.nearest_slug,
            description: r.nearest_description,
            sample_descriptions: [] as string[],
          },
        };
        if (parseError !== undefined) out._parse_error = parseError;
        return out;
      }
      const cluster = parsedPayload.entry?._cluster ?? {};
      const samples = parsedPayload.entry?.sample_descriptions ??
        (parsedPayload.entry?.description
          ? [String(parsedPayload.entry.description)]
          : []);
      return {
        id: r.id,
        model_slug: r.model_slug,
        concept_slug_proposed: r.concept_slug_proposed,
        confidence: r.confidence,
        created_at: r.created_at,
        payload: {
          nearest_concept_id: cluster.nearest_concept_id ?? r.nearest_concept_id,
          similarity: cluster.similarity ?? null,
          shortcoming_ids: cluster.shortcoming_ids ?? [],
          sample_descriptions: samples,
          al_concept: parsedPayload.entry?.al_concept ??
            parsedPayload.entry?.alConcept ??
            "unknown",
        },
        nearest: {
          id: r.nearest_concept_id,
          slug: r.nearest_slug,
          description: r.nearest_description,
          // For the nearest concept, surface the descriptions from
          // shortcomings already pointing at it (best-effort: empty when
          // none).
          sample_descriptions: [] as string[],
        },
      };
    });

    // Augment each row's nearest.sample_descriptions with shortcomings on
    // the nearest concept (one extra query per nearest concept_id).
    const seen = new Set<number>();
    for (const r of flat) {
      const nid = r.nearest.id;
      if (nid == null || seen.has(nid)) continue;
      seen.add(nid);
      const samples = await db
        .prepare(
          `SELECT description FROM shortcomings WHERE concept_id = ? LIMIT 3`,
        )
        .bind(nid)
        .all<{ description: string }>();
      const descs = samples.results.map((s) => s.description);
      for (const x of flat) {
        if (x.nearest.id === nid) x.nearest.sample_descriptions = descs;
      }
    }

    return jsonResponse({ rows: flat }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
