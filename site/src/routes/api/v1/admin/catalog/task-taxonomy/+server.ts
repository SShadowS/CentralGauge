import type { RequestHandler } from "./$types";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import {
  type TaxonomyPayload,
  applyTaxonomy,
} from "$lib/server/taxonomy";

/** 64-hex string pattern for a task-set hash. */
const HASH_RE = /^[0-9a-f]{64}$/i;

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  try {
    const body = await request.json() as {
      version: number;
      signature: unknown;
      payload: Record<string, unknown>;
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

    // Validate required taxonomy fields.
    if (!Array.isArray(p.groups) || !Array.isArray(p.tags) || p.tasks == null || typeof p.tasks !== "object" || Array.isArray(p.tasks)) {
      throw new ApiError(
        400,
        "missing_field",
        "groups (array), tags (array), and tasks (object) are required",
      );
    }

    const payload: TaxonomyPayload = {
      groups: p.groups as TaxonomyPayload["groups"],
      tags: p.tags as TaxonomyPayload["tags"],
      tasks: p.tasks as TaxonomyPayload["tasks"],
    };

    // Resolve the target hash: explicit body.hash takes precedence.
    let hash: string;
    if (typeof p.hash === "string" && HASH_RE.test(p.hash)) {
      hash = p.hash;
    } else {
      const row = await db
        .prepare(`SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`)
        .first<{ hash: string }>();
      if (!row) {
        throw new ApiError(
          400,
          "no_current_task_set",
          "no current task_set found; provide an explicit hash",
        );
      }
      hash = row.hash;
    }

    await applyTaxonomy(db, hash, payload);

    return jsonResponse(
      {
        hash,
        groups: payload.groups.length,
        tags: payload.tags.length,
        tasks: Object.keys(payload.tasks).length,
      },
      200,
    );
  } catch (err) {
    return errorResponse(err);
  }
};
