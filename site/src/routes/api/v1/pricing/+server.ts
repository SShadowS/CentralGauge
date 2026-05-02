import type { RequestHandler } from "./$types";
import { verifySignedRequest } from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { runBatch } from "$lib/server/db";

interface RateInput {
  model_slug: string;
  input_per_mtoken: number;
  output_per_mtoken: number;
  cache_read_per_mtoken?: number;
  cache_write_per_mtoken?: number;
}

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === "number" && isFinite(v) && v >= 0;
}

function validateRate(r: unknown, idx: number): RateInput {
  if (!r || typeof r !== "object") {
    throw new ApiError(400, "bad_rate", `rates[${idx}] must be an object`);
  }
  const rate = r as Record<string, unknown>;
  if (typeof rate.model_slug !== "string" || !rate.model_slug) {
    throw new ApiError(
      400,
      "bad_rate",
      `rates[${idx}].model_slug must be a non-empty string`,
    );
  }
  if (!isFiniteNonNegative(rate.input_per_mtoken)) {
    throw new ApiError(
      400,
      "bad_rate",
      `rates[${idx}].input_per_mtoken must be a finite non-negative number`,
    );
  }
  if (!isFiniteNonNegative(rate.output_per_mtoken)) {
    throw new ApiError(
      400,
      "bad_rate",
      `rates[${idx}].output_per_mtoken must be a finite non-negative number`,
    );
  }
  if (
    rate.cache_read_per_mtoken !== undefined &&
    !isFiniteNonNegative(rate.cache_read_per_mtoken)
  ) {
    throw new ApiError(
      400,
      "bad_rate",
      `rates[${idx}].cache_read_per_mtoken must be a finite non-negative number`,
    );
  }
  if (
    rate.cache_write_per_mtoken !== undefined &&
    !isFiniteNonNegative(rate.cache_write_per_mtoken)
  ) {
    throw new ApiError(
      400,
      "bad_rate",
      `rates[${idx}].cache_write_per_mtoken must be a finite non-negative number`,
    );
  }
  return {
    model_slug: rate.model_slug as string,
    input_per_mtoken: rate.input_per_mtoken as number,
    output_per_mtoken: rate.output_per_mtoken as number,
    cache_read_per_mtoken: rate.cache_read_per_mtoken as number | undefined,
    cache_write_per_mtoken: rate.cache_write_per_mtoken as number | undefined,
  };
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "Cloudflare platform not available"),
    );
  }
  const db = platform.env.DB;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "bad_request", "request body must be valid JSON");
    }

    const envelope = body as {
      payload: Record<string, unknown>;
      signature: {
        alg: "Ed25519";
        key_id: number;
        signed_at: string;
        value: string;
      };
    };
    if (!envelope.signature) {
      throw new ApiError(400, "missing_signature", "signature block required");
    }
    if (!envelope.payload || typeof envelope.payload !== "object") {
      throw new ApiError(400, "bad_payload", "payload object required");
    }

    await verifySignedRequest(db, envelope, "admin");

    const p = envelope.payload;

    if (
      typeof p.pricing_version !== "string" || !p.pricing_version ||
      typeof p.effective_from !== "string" || !p.effective_from
    ) {
      throw new ApiError(
        400,
        "missing_fields",
        "pricing_version and effective_from are required non-empty strings",
      );
    }

    if (!Array.isArray(p.rates)) {
      throw new ApiError(400, "no_rates", "rates must be a non-empty array");
    }
    if (p.rates.length === 0) {
      throw new ApiError(400, "no_rates", "rates must not be empty");
    }

    const closePrevious = p.close_previous === true;
    const pricingVersion = p.pricing_version as string;
    const effectiveFrom = p.effective_from as string;
    const rates = (p.rates as unknown[]).map((r, i) => validateRate(r, i));

    // Resolve model slugs to IDs
    const placeholders = rates.map(() => "?").join(",");
    const slugs = rates.map((r) => r.model_slug);
    const modelRows = await db
      .prepare(`SELECT id, slug FROM models WHERE slug IN (${placeholders})`)
      .bind(...slugs)
      .all<{ id: number; slug: string }>();
    const modelMap = new Map<string, number>(
      modelRows.results.map((r) => [r.slug, r.id]),
    );

    const missingSlugs = slugs.filter((s) => !modelMap.has(s));
    if (missingSlugs.length > 0) {
      throw new ApiError(
        404,
        "model_not_found",
        `unknown model slugs: ${missingSlugs.join(", ")}`,
      );
    }

    // Conflict check: single IN query instead of N round-trips
    const modelIds = rates.map((r) => modelMap.get(r.model_slug)!);
    const idPlaceholders = modelIds.map(() => "?").join(",");
    const conflictRows = await db
      .prepare(
        `SELECT model_id FROM cost_snapshots WHERE pricing_version = ? AND model_id IN (${idPlaceholders})`,
      )
      .bind(pricingVersion, ...modelIds)
      .all<{ model_id: number }>();
    if (conflictRows.results.length > 0) {
      const idToSlug = new Map<number, string>(
        modelRows.results.map((r) => [r.id, r.slug]),
      );
      const conflictSlugs = conflictRows.results.map((r) =>
        idToSlug.get(r.model_id) ?? String(r.model_id)
      );
      throw new ApiError(
        409,
        "duplicate",
        `pricing_version '${pricingVersion}' already has snapshots for: ${
          conflictSlugs.join(", ")
        }`,
      );
    }

    // Build atomic batch
    const ops: { sql: string; params: (string | number | null)[] }[] = [];

    if (closePrevious) {
      ops.push({
        sql:
          `UPDATE cost_snapshots SET effective_until = ? WHERE effective_until IS NULL AND pricing_version != ? AND model_id IN (${idPlaceholders})`,
        params: [effectiveFrom, pricingVersion, ...modelIds],
      });
    }

    for (const rate of rates) {
      const modelId = modelMap.get(rate.model_slug)!;
      ops.push({
        sql:
          `INSERT INTO cost_snapshots(pricing_version, model_id, input_per_mtoken, output_per_mtoken, cache_read_per_mtoken, cache_write_per_mtoken, effective_from) VALUES (?,?,?,?,?,?,?)`,
        params: [
          pricingVersion,
          modelId,
          rate.input_per_mtoken,
          rate.output_per_mtoken,
          rate.cache_read_per_mtoken ?? 0,
          rate.cache_write_per_mtoken ?? 0,
          effectiveFrom,
        ],
      });
    }

    await runBatch(db, ops);

    return jsonResponse(
      {
        pricing_version: pricingVersion,
        effective_from: effectiveFrom,
        inserted: rates.length,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch (err) {
    return errorResponse(err);
  }
};
