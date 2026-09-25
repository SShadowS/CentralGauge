/**
 * List-price cost from reported tokens (cost basis decided 2026-09-24; spec
 * 1a section 1; cache writes priced by logged TTL, owner decision
 * 2026-09-25-m1p2-round2). Prices come from the catalog (site/catalog), fixed
 * per run as a PricingBook; the snapshot string names every
 * model@pricing_version and flags a derived 1-hour write rate.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { compareInstant, type Telemetry } from "./records.ts";
import { readYaml } from "./yaml.ts";

export interface ModelPrice {
  slug: string;
  pricing_version: string;
  /** USD per million tokens. */
  input: number;
  output: number;
  cache_read: number;
  /** Catalog cache_write_per_mtoken (5-minute TTL). */
  cache_write_5m: number;
  /** 1-hour TTL write; derived as 2x input for anthropic/* (published rule), else null (unknown). */
  cache_write_1h: number | null;
  cache_write_1h_derived: boolean;
}

export interface PricingBook {
  at: string;
  /** Keyed by the provider's api model id (what harness logs report). */
  models: Record<string, ModelPrice>;
}

// Strict mirrors of CatalogModelEntry / CatalogPricingEntry (src/ingest/types.ts):
// the ingest reader maps a bad file to [] and keeps unknown keys; the harness fails loudly.
const Iso = z.iso.datetime();
const Rate = z.number().nonnegative(); // z.number() already refuses NaN and Infinity
const CatalogModels = z.array(z.strictObject({
  slug: z.string().min(1),
  api_model_id: z.string().min(1),
  family: z.string(),
  display_name: z.string(),
  generation: z.number().nullable().optional(),
  released_at: z.string().nullable().optional(),
  deprecated_at: z.string().nullable().optional(),
  max_input_tokens: z.number().nullable().optional(),
  max_output_tokens: z.number().nullable().optional(),
  capabilities: z.array(z.string()).nullable().optional(),
}));
const CatalogPricing = z.array(
  z.strictObject({
    pricing_version: z.string().min(1),
    model_slug: z.string().min(1),
    effective_from: Iso,
    effective_until: Iso.nullable().optional(),
    input_per_mtoken: Rate,
    output_per_mtoken: Rate,
    cache_read_per_mtoken: Rate,
    cache_write_per_mtoken: Rate,
    batch_input_per_mtoken: Rate.nullable().optional(),
    batch_output_per_mtoken: Rate.nullable().optional(),
    batch_cache_read_per_mtoken: Rate.nullable().optional(),
    batch_cache_write_per_mtoken: Rate.nullable().optional(),
    source: z.string().optional(),
    fetched_at: z.string().optional(),
  }).refine(
    (p) =>
      p.effective_until == null ||
      compareInstant(p.effective_from, p.effective_until) < 0,
    { message: "effective_until must be after effective_from" },
  ),
);

export async function loadPricingBook(
  catalogDir: string,
  at: Date,
): Promise<PricingBook> {
  const modelsFile = join(catalogDir, "models.yml");
  const pricingFile = join(catalogDir, "pricing.yml");
  const models = await readYaml(modelsFile, CatalogModels);
  const pricing = await readYaml(pricingFile, CatalogPricing);
  if (Number.isNaN(at.getTime())) {
    const msg = `${pricingFile}: invalid run time for the pricing book`;
    throw new ValidationError(msg, [msg]);
  }
  const now = at.toISOString();
  const slugs = new Set(models.map((m) => m.slug));
  const orphans = [...new Set(pricing.map((p) => p.model_slug))]
    .filter((s) => !slugs.has(s)).sort();
  if (orphans.length > 0) {
    const msg = `${pricingFile}: prices for model_slug not in ${modelsFile}: ${
      orphans.join(", ")
    }`;
    throw new ValidationError(msg, [msg]);
  }
  const book: Record<string, ModelPrice> = {};
  for (const m of models) {
    if (Object.hasOwn(book, m.api_model_id)) {
      const msg =
        `${modelsFile}: api_model_id ${m.api_model_id} is listed twice`;
      throw new ValidationError(msg, [msg]);
    }
    const effective = pricing
      .filter((x) =>
        x.model_slug === m.slug && compareInstant(x.effective_from, now) <= 0 &&
        (x.effective_until == null ||
          compareInstant(now, x.effective_until) < 0)
      )
      .sort((a, b) => compareInstant(b.effective_from, a.effective_from));
    const p = effective[0];
    if (!p) continue;
    if (
      effective.length > 1 &&
      compareInstant(effective[1]!.effective_from, p.effective_from) === 0
    ) {
      const msg =
        `${pricingFile}: ambiguous price for ${m.slug} at ${now}: ${p.pricing_version} and ${
          effective[1]!.pricing_version
        } take effect together`;
      throw new ValidationError(msg, [msg]);
    }
    // ponytail: derived 1-hour write price; a pricing.yml field replaces this rule if the catalog adds one.
    const anthropic = m.slug.startsWith("anthropic/");
    book[m.api_model_id] = {
      slug: m.slug,
      pricing_version: p.pricing_version,
      input: p.input_per_mtoken,
      output: p.output_per_mtoken,
      cache_read: p.cache_read_per_mtoken,
      cache_write_5m: p.cache_write_per_mtoken,
      cache_write_1h: anthropic ? 2 * p.input_per_mtoken : null,
      cache_write_1h_derived: anthropic,
    };
  }
  return { at: now, models: book };
}

export interface ModelTokens {
  model: string;
  requests: number | null;
  /** Non-overlapping: input + cache_read + all cache writes is the input total. */
  input: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  /** Cache-write tokens whose TTL the log does not state: never priced. */
  cache_write_unknown: number;
  /** Includes reasoning; reasoning is never added again. */
  output: number;
  reasoning: number | null;
  /** Usage fields the log lacked or reported non-numerically. */
  problems: string[];
}

export interface CostEstimate {
  cost_usd: number | null;
  pricing_snapshot: string | null;
  per_model: Telemetry["per_model"];
  missing: string[];
}

const isCount = (n: number | null): n is number =>
  Number.isSafeInteger(n) && n! >= 0;
/** Only requests and reasoning may be null; a priced token kind never is. */
const count = (n: number | null, nullable: boolean) =>
  (nullable && n === null) || isCount(n);
/** An invalid count is reported as null in per_model (Telemetry rejects NaN and negatives). */
const valid = (n: number | null) => isCount(n) ? n : null;

/**
 * Every unpriceable case makes the total null and names a reason in
 * `missing`. Each model's cost sums its token kinds in a fixed order; the
 * total sums models in sorted model-id order, so it never depends on the
 * order the log reported them.
 */
export function estimateCost(
  usage: ModelTokens[],
  book: PricingBook,
): CostEstimate {
  const missing: string[] = [];
  const per_model: Telemetry["per_model"] = [];
  const priced: [string, number, string][] = [];
  const seen = new Set<string>();
  if (usage.length === 0) missing.push("no model usage reported");
  for (const u of usage) {
    const p = Object.hasOwn(book.models, u.model)
      ? book.models[u.model]
      : undefined;
    let cost: number | null = null;
    const why: string[] = u.problems.map((x) => `${u.model}: ${x}`);
    if (seen.has(u.model)) why.push(`${u.model}: duplicate usage entry`);
    seen.add(u.model);
    const counts: [string, number | null, boolean][] = [
      ["input tokens", u.input, false],
      ["cache_read tokens", u.cache_read, false],
      ["cache_write_5m tokens", u.cache_write_5m, false],
      ["cache_write_1h tokens", u.cache_write_1h, false],
      ["cache_write_unknown tokens", u.cache_write_unknown, false],
      ["output tokens", u.output, false],
      ["reasoning tokens", u.reasoning, true],
      ["requests", u.requests, true],
    ];
    for (const [k, n, nullable] of counts) {
      if (!count(n, nullable)) {
        why.push(`${u.model}: ${k} not a non-negative integer (${n})`);
      }
    }
    // Output includes reasoning; more reasoning than output means separately
    // counted thinking tokens that the output rate would leave unbilled.
    if (isCount(u.reasoning) && isCount(u.output) && u.reasoning > u.output) {
      why.push(
        `${u.model}: reasoning tokens (${u.reasoning}) exceed output tokens (${u.output})`,
      );
    }
    if (u.cache_write_unknown > 0) {
      why.push(
        `${u.model}: cache write TTL unknown (${u.cache_write_unknown} tokens)`,
      );
    }
    if (!p) why.push(`${u.model}: not in the pricing book`);
    else {
      const kinds: [string, number, number | null][] = [
        ["input", u.input, p.input],
        ["cache_read", u.cache_read, p.cache_read],
        ["cache_write_5m", u.cache_write_5m, p.cache_write_5m],
        ["cache_write_1h", u.cache_write_1h, p.cache_write_1h],
        ["output", u.output, p.output],
      ];
      for (const [k, n, rate] of kinds) {
        if (rate !== null && !(Number.isFinite(rate) && rate >= 0)) {
          why.push(`${u.model}: ${k} rate is invalid (${rate})`);
        } else if (n > 0 && rate === null) {
          why.push(`${u.model}: ${k} rate is unknown`);
        } else if (n > 0 && rate === 0) why.push(`${u.model}: ${k} rate is 0`);
      }
      if (why.length === 0) {
        cost = kinds.reduce((sum, [, n, rate]) => sum + n * (rate ?? 0), 0) /
          1e6;
        priced.push([
          u.model,
          cost,
          `${p.slug}@${p.pricing_version}${
            p.cache_write_1h_derived && u.cache_write_1h > 0
              ? "(1h=2x input)"
              : ""
          }`,
        ]);
      }
    }
    missing.push(...why);
    per_model.push({
      model: p?.slug ?? u.model,
      requests: valid(u.requests),
      tokens_in_uncached: valid(u.input),
      tokens_cache_read: valid(u.cache_read),
      // Never a partial sum: null + n is n in JS, so validate each part first.
      tokens_cache_write: isCount(u.cache_write_5m) &&
          isCount(u.cache_write_1h) && isCount(u.cache_write_unknown)
        ? u.cache_write_5m + u.cache_write_1h + u.cache_write_unknown
        : null,
      tokens_out: valid(u.output),
      tokens_reasoning: valid(u.reasoning),
      cost_usd: cost,
    });
  }
  if (missing.length > 0) {
    return { cost_usd: null, pricing_snapshot: null, per_model, missing };
  }
  priced.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return {
    cost_usd: priced.reduce((sum, [, c]) => sum + c, 0),
    pricing_snapshot: priced.map(([, , s]) => s).sort().join(";"),
    per_model,
    missing,
  };
}
