import {
  Confirm,
  Input,
  Number as NumPrompt,
} from "https://deno.land/x/cliffy@v0.25.7/prompt/mod.ts";
import { appendModel, appendPricing } from "./catalog/write.ts";
import type { Catalog } from "./catalog/read.ts";
import type {
  CatalogModelEntry,
  CatalogPricingEntry,
  IngestConfig,
  PricingRates,
} from "./types.ts";
import {
  fetchPricingFromSources,
  sourcesForFamily,
} from "./pricing-sources/index.ts";
import { signPayload } from "./sign.ts";
import { postWithRetry } from "./client.ts";

export interface RegisterDeps {
  catalogDir: string;
  config: IngestConfig;
  adminPrivateKey: Uint8Array;
  interactive: boolean;
}

// Process-local cache of (slug, api_model_id) already upserted in this run.
// Lets the variant loop call ensureModel repeatedly without re-POSTing for
// rows we just synced. Cleared on process exit; reset hook below for tests.
const postedModelKeys = new Set<string>();

function modelKey(slug: string, apiModelId: string): string {
  return `${slug}\0${apiModelId}`;
}

export async function ensureModel(
  cat: Catalog,
  slug: string,
  apiModelId: string,
  deps: RegisterDeps,
): Promise<CatalogModelEntry> {
  const existing = cat.models.find(
    (m) => m.slug === slug && m.api_model_id === apiModelId,
  );
  // Catalog row already in YAML — push it through the admin upsert so D1
  // matches local state (catches drift from manual YAML edits or a missing
  // sync-catalog --apply). The endpoint is INSERT … ON CONFLICT DO UPDATE
  // so calling it for an unchanged row is a no-op write.
  if (existing) {
    if (!postedModelKeys.has(modelKey(slug, apiModelId))) {
      await postAdmin(deps, "/api/v1/admin/catalog/models", { ...existing });
      postedModelKeys.add(modelKey(slug, apiModelId));
    }
    return existing;
  }

  const family = inferFamily(slug);
  const inferred: CatalogModelEntry = {
    slug,
    api_model_id: apiModelId,
    family,
    display_name: inferDisplayName(slug),
  };

  if (deps.interactive) {
    console.log(`[WARN] Model '${slug}' not in catalog.`);
    console.log(
      `       Inferred: family=${inferred.family}, display_name='${inferred.display_name}'`,
    );
    const ok = await Confirm.prompt({
      message: "Write to catalog + D1?",
      default: true,
    });
    if (!ok) throw new Error(`aborted: model '${slug}' not registered`);
    const displayName = await Input.prompt({
      message: "display_name (enter to keep inferred)",
      default: inferred.display_name,
    });
    inferred.display_name = displayName;
  }

  await appendModel(`${deps.catalogDir}/models.yml`, inferred);
  await postAdmin(deps, "/api/v1/admin/catalog/models", { ...inferred });
  postedModelKeys.add(modelKey(slug, apiModelId));
  cat.models.push(inferred);
  return inferred;
}

const postedPricingKeys = new Set<string>();

function pricingKey(pricingVersion: string, modelSlug: string): string {
  return `${pricingVersion}\0${modelSlug}`;
}

export async function ensurePricing(
  cat: Catalog,
  pricingVersion: string,
  modelSlug: string,
  apiModelId: string,
  family: string,
  deps: RegisterDeps,
): Promise<CatalogPricingEntry> {
  const existing = cat.pricing.find(
    (p) => p.pricing_version === pricingVersion && p.model_slug === modelSlug,
  );
  // Same drift-defense as ensureModel: replay the YAML row through the
  // admin upsert so D1 reflects local state. Idempotent server-side.
  if (existing) {
    if (!postedPricingKeys.has(pricingKey(pricingVersion, modelSlug))) {
      await postAdmin(deps, "/api/v1/admin/catalog/pricing", { ...existing });
      postedPricingKeys.add(pricingKey(pricingVersion, modelSlug));
    }
    return existing;
  }

  let rates: PricingRates | null = await fetchPricingFromSources(
    sourcesForFamily(family),
    modelSlug,
    apiModelId,
  );

  if (!rates) {
    if (!deps.interactive) {
      throw new Error(
        `pricing for '${modelSlug}' not available from any API source; run interactively to enter manually`,
      );
    }
    console.log(
      `[WARN] No API source has pricing for '${modelSlug}'. Enter manually (per-million-tokens USD):`,
    );
    const input = await NumPrompt.prompt({ message: "input_per_mtoken" });
    const output = await NumPrompt.prompt({ message: "output_per_mtoken" });
    const cacheRead = await NumPrompt.prompt({
      message: "cache_read_per_mtoken (0 if N/A)",
      default: 0,
    });
    const cacheWrite = await NumPrompt.prompt({
      message: "cache_write_per_mtoken (0 if N/A)",
      default: 0,
    });
    rates = {
      input_per_mtoken: input,
      output_per_mtoken: output,
      cache_read_per_mtoken: cacheRead,
      cache_write_per_mtoken: cacheWrite,
      source: "manual",
      fetched_at: new Date().toISOString(),
    };
  } else if (deps.interactive) {
    console.log(`[INFO] Fetched pricing from ${rates.source}:`);
    console.log(
      `       input=${rates.input_per_mtoken}/Mt output=${rates.output_per_mtoken}/Mt`,
    );
    const ok = await Confirm.prompt({
      message: "Accept and write?",
      default: true,
    });
    if (!ok) {
      throw new Error(`aborted: pricing for '${modelSlug}' not accepted`);
    }
  }

  const entry: CatalogPricingEntry = {
    pricing_version: pricingVersion,
    model_slug: modelSlug,
    effective_from: new Date().toISOString(),
    ...rates,
  };
  await appendPricing(`${deps.catalogDir}/pricing.yml`, entry);
  await postAdmin(deps, "/api/v1/admin/catalog/pricing", { ...entry });
  postedPricingKeys.add(pricingKey(pricingVersion, modelSlug));
  cat.pricing.push(entry);
  return entry;
}

// Process-local cache of task-set hashes already POSTed in this run. Skips
// redundant admin calls when the ingest CLI loops over multiple variants /
// files that share the same `task_sets.hash`. Cleared on process exit.
const postedTaskSetHashes = new Set<string>();

export async function ensureTaskSet(
  _cat: Catalog,
  hash: string,
  taskCount: number,
  deps: RegisterDeps,
): Promise<void> {
  if (postedTaskSetHashes.has(hash)) return;
  await postAdmin(deps, "/api/v1/admin/catalog/task-sets", {
    hash,
    created_at: new Date().toISOString(),
    task_count: taskCount,
  });
  postedTaskSetHashes.add(hash);
}

/** Test hook — resets all in-process upsert dedup caches. */
export function _resetEnsureTaskSetCache(): void {
  postedTaskSetHashes.clear();
  postedModelKeys.clear();
  postedPricingKeys.clear();
}

async function postAdmin(
  deps: RegisterDeps,
  path: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (deps.config.adminKeyId == null) {
    throw new Error("admin key not configured; needed for catalog writes");
  }
  const sig = await signPayload(
    payload,
    deps.adminPrivateKey,
    deps.config.adminKeyId,
  );
  const body = { version: 1, signature: sig, payload };
  const resp = await postWithRetry(`${deps.config.url}${path}`, body, {
    maxAttempts: 5,
  });
  if (resp.status !== 200) {
    throw new Error(
      `admin ${path} failed: ${resp.status} ${await resp.text()}`,
    );
  }
}

function inferFamily(slug: string): string {
  const parts = slug.split("/");
  const prefix = parts[0] ?? slug;
  if (prefix === "anthropic") return "claude";
  if (prefix === "openai") return "gpt";
  if (prefix === "google" || prefix === "gemini") return "gemini";
  // openrouter routes to an underlying vendor's family (e.g.,
  // openrouter/deepseek/deepseek-v4-pro → deepseek).
  if (prefix === "openrouter" && parts.length >= 2 && parts[1]) return parts[1];
  return prefix;
}

function inferDisplayName(slug: string): string {
  const name = slug.split("/").pop() ?? slug;
  return name
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
