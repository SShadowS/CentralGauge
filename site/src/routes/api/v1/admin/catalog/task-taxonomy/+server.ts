import type { RequestHandler } from "./$types";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { type TaxonomyPayload, applyTaxonomy } from "$lib/server/taxonomy";
import { applyRevision, isV1Frozen } from "$lib/server/taxonomy-v2";
import {
  type CatalogV2,
  normalizeCatalog,
  validateCatalog,
} from "$lib/shared/taxonomy-schema";

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

    // Signature verification runs FIRST for both versions, before the
    // freeze check or either version branch — otherwise the freeze check
    // leaks one bit (whether v1 is frozen) to an unauthenticated caller.
    const verified = await verifySignedRequest(
      db,
      body as unknown as SignedAdminRequest,
      "admin",
    );

    if (body.version === 1 && (await isV1Frozen(db))) {
      throw new ApiError(
        409,
        "taxonomy_v1_frozen",
        "a schema-version-2 taxonomy is active; v1 writes are frozen site-wide",
      );
    }

    if (body.version === 2) {
      const p = body.payload as Record<string, unknown>;
      if (typeof p.hash !== "string" || !HASH_RE.test(p.hash)) {
        throw new ApiError(
          400,
          "hash_required",
          "version 2 requires an explicit 64-hex hash",
        );
      }
      const hash = p.hash;
      const set = await db
        .prepare(`SELECT is_current FROM task_sets WHERE hash = ?`)
        .bind(hash)
        .first<{ is_current: number }>();
      if (!set) throw new ApiError(400, "unknown_task_set", hash);
      if (set.is_current !== 1 && p.allow_non_current !== true) {
        throw new ApiError(
          409,
          "not_current_task_set",
          "hash is not the current set; pass allow_non_current",
        );
      }
      const catalog = {
        schema_version: 2,
        groups: p.groups,
        families: p.families,
        tags: p.tags,
        aliases: p.aliases ?? [],
        overrides: p.overrides ?? [],
        tasks: p.tasks,
      } as CatalogV2;
      const issues = validateCatalog(catalog);
      const setIds = new Set(
        (
          await db
            .prepare(`SELECT task_id FROM tasks WHERE task_set_hash = ?`)
            .bind(hash)
            .all<{ task_id: string }>()
        ).results.map((r) => r.task_id),
      );
      const payloadIds = new Set(Object.keys(catalog.tasks ?? {}));
      const missing = [...setIds].filter((id) => !payloadIds.has(id));
      const extra = [...payloadIds].filter((id) => !setIds.has(id));
      if (missing.length || extra.length) {
        issues.push({
          code: "coverage",
          where: "tasks",
          message: `coverage mismatch: missing ${missing.length}, extra ${extra.length}`,
        });
      }
      if (issues.length) {
        throw new ApiError(
          400,
          "catalog_invalid",
          issues.map((i) => `[${i.code}] ${i.where}: ${i.message}`).join("; "),
        );
      }
      const normalized = normalizeCatalog(catalog, hash);
      const provenance = (p.provenance ?? {}) as Record<string, unknown>;
      const r = await applyRevision(db, {
        hash,
        normalized,
        provenance,
        actor: verified,
        signature: (body as { signature: { value: string } }).signature.value,
      });
      return jsonResponse(
        {
          hash,
          revision_id: r.revisionId,
          digest: r.digest,
          status: r.status,
          tasks: Object.keys(catalog.tasks ?? {}).length,
        },
        200,
      );
    }

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
