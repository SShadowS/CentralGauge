import type { RequestHandler } from "./$types";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { type TaxonomyPayload, applyTaxonomy } from "$lib/server/taxonomy";
import { isV1Frozen } from "$lib/server/taxonomy-v2";

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
    const body = (await request.json()) as {
      version: number;
      signature: unknown;
      payload: Record<string, unknown>;
    };
    if (body.version !== 1 && body.version !== 2) {
      throw new ApiError(400, "bad_version", "only versions 1 and 2 supported");
    }
    if (body.version === 1 && (await isV1Frozen(db))) {
      throw new ApiError(
        409,
        "taxonomy_v1_frozen",
        "a schema-version-2 taxonomy is active; v1 writes are frozen site-wide",
      );
    }
    if (body.version === 2) {
      // Task 5 fills this in.
      throw new ApiError(
        501,
        "not_implemented",
        "version 2 apply lands in Task 5",
      );
    }
    await verifySignedRequest(
      db,
      body as unknown as SignedAdminRequest,
      "admin",
    );

    const p = body.payload;

    // Validate required taxonomy fields.
    if (
      !Array.isArray(p.groups) ||
      !Array.isArray(p.tags) ||
      p.tasks == null ||
      typeof p.tasks !== "object" ||
      Array.isArray(p.tasks)
    ) {
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
