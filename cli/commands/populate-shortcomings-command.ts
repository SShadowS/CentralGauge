/**
 * populate-shortcomings command: upload curated model shortcomings to
 * production via `/api/v1/shortcomings/batch`.
 *
 * Why this exists: P7 E1/E4 surfaces (`/limitations`, model detail
 * Shortcomings section) render off the `shortcomings` + `shortcoming_occurrences`
 * tables, but production has 0 rows because the bench's verify pipeline never
 * pushed historical entries. `model-shortcomings/*.json` files were curated
 * locally; this command back-fills them.
 *
 * Flow:
 *   1. Walk `model-shortcomings/*.json` (configurable via `--shortcomings-dir`).
 *   2. Map each JSON's `model` field to a production slug (vendor-prefixed).
 *   3. For each shortcoming entry:
 *      - Compute SHA-256(incorrectPattern) for `incorrect_pattern_sha256`.
 *      - Resolve `result_id` per `affectedTasks` by querying production D1
 *        through `npx wrangler d1 execute --remote`. Skip occurrences where
 *        no matching result row exists for the model.
 *   4. Group by model; signed POST to `/api/v1/shortcomings/batch` per model.
 *
 * The endpoint requires `verifier` scope (or higher). Admin keys satisfy it
 * via the `hasScope` rank check in `signature.ts` (admin > verifier > ingest),
 * so we read the verifier key path with admin-key fallback.
 *
 * @module cli/commands/populate-shortcomings
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import type { ModelShortcomingsFile } from "../../src/verify/types.ts";
import type { IngestCliFlags } from "../../src/ingest/config.ts";
import {
  loadAdminConfig,
  loadIngestConfig,
  readPrivateKey,
} from "../../src/ingest/config.ts";
import { signPayload } from "../../src/ingest/sign.ts";
import { postWithRetry } from "../../src/ingest/client.ts";

interface PopulateShortcomingsOptions {
  url?: string;
  keyPath?: string;
  keyId?: number;
  machineId?: string;
  shortcomingsDir?: string;
  only?: string;
  dryRun?: boolean;
  d1Database?: string;
  /**
   * Override the `analyzer_model` field included in the top-level batch
   * payload. The endpoint forwards this into concept.created /
   * concept.aliased event payloads. Defaults to `claude-opus-4-6`.
   */
  analyzerModel?: string;
}

interface BatchOccurrence {
  result_id: number;
  task_id: string;
  error_code: string | null;
}

interface BatchShortcoming {
  al_concept: string;
  concept: string;
  description: string;
  correct_pattern: string;
  incorrect_pattern_sha256: string;
  error_codes: string[];
  occurrences: BatchOccurrence[];
  /**
   * D-prompt: registry-shaped concept slug the analyzer proposed. Endpoint
   * resolves this to a concept_id via the three-tier resolver. Legacy JSON
   * files (predating Phase D) lack this field — those entries pass through
   * with `concept_id` left NULL.
   */
  concept_slug_proposed: string | null;
  concept_slug_existing_match: string | null;
  similarity_score: number | null;
}

interface BatchPayload {
  model_slug: string;
  shortcomings: BatchShortcoming[];
  /** Tagged into the analysis.completed lifecycle event payload. */
  analyzer_model: string;
}

/**
 * Pass-through after Phase B2 migrated all JSON `model` fields to
 * vendor-prefixed production slugs. Retained as a function (not inlined) so
 * future invariant checks (e.g. slug-format validation) have a single home.
 *
 * Returns null only when the input doesn't match the expected slug shape
 * (vendor/model or vendor/family/model). Old hardcoded prefix table deleted —
 * see strategic plan Phase B Task B4.
 */
export function mapToProductionSlug(jsonModel: string): string | null {
  if (!jsonModel.includes("/")) return null;
  return jsonModel;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return encodeHex(new Uint8Array(digest));
}

/**
 * Read `account_id` from `site/wrangler.toml`. Single source of truth that
 * wrangler itself reads for `--remote` calls; saves callers from setting
 * `CLOUDFLARE_ACCOUNT_ID` separately when the value is already declared.
 */
async function readAccountIdFromWranglerToml(
  siteDir: string,
): Promise<string | null> {
  try {
    const toml = await Deno.readTextFile(`${siteDir}/wrangler.toml`);
    const match = toml.match(/^\s*account_id\s*=\s*["']([^"']+)["']/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Run a wrangler D1 query against the production database and return the
 * parsed JSON result rows. Mirrors `scripts/seed-admin-key.ts` shell-out
 * pattern. Wrangler must be installed in `site/`.
 */
async function queryD1(
  siteDir: string,
  dbName: string,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ??
    await readAccountIdFromWranglerToml(siteDir);
  if (!accountId) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID not set and not found in site/wrangler.toml",
    );
  }
  const cmd = new Deno.Command("npx", {
    args: [
      "wrangler",
      "d1",
      "execute",
      dbName,
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    cwd: siteDir,
    stdout: "piped",
    stderr: "piped",
    env: { CLOUDFLARE_ACCOUNT_ID: accountId },
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    const err = new TextDecoder().decode(stderr);
    const outText = new TextDecoder().decode(stdout);
    throw new Error(
      `wrangler d1 execute failed (code ${code}):\n[stderr]\n${err}\n[stdout]\n${outText}`,
    );
  }
  const out = new TextDecoder().decode(stdout);
  // wrangler emits warnings before the JSON; locate the JSON array.
  const jsonStart = out.indexOf("[");
  if (jsonStart === -1) {
    throw new Error(`wrangler output missing JSON array: ${out.slice(0, 200)}`);
  }
  const parsed = JSON.parse(out.slice(jsonStart)) as Array<{
    results?: Array<Record<string, unknown>>;
    success?: boolean;
  }>;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("wrangler returned empty result envelope");
  }
  const first = parsed[0];
  if (!first) return [];
  return first.results ?? [];
}

/**
 * For a single (model_slug, task_id) pair, return all matching result rows
 * from production D1, ordered by run start time descending. The latest
 * matching run's result is used as the canonical occurrence target.
 */
async function fetchResultIdsForTask(
  siteDir: string,
  dbName: string,
  modelSlug: string,
  taskId: string,
): Promise<Array<{ result_id: number; run_id: string; attempt: number }>> {
  // Single-quote escape: model slugs and task IDs are tightly constrained
  // by application validators (slug regex, task ID prefix), so quote
  // injection is not a realistic risk; still escape defensively.
  const safeSlug = modelSlug.replace(/'/g, "''");
  const safeTask = taskId.replace(/'/g, "''");
  const sql = `SELECT r.id AS result_id, r.run_id, r.attempt ` +
    `FROM results r ` +
    `JOIN runs ON runs.id = r.run_id ` +
    `JOIN models m ON m.id = runs.model_id ` +
    `WHERE m.slug = '${safeSlug}' AND r.task_id = '${safeTask}' ` +
    `ORDER BY runs.started_at DESC, r.attempt DESC`;
  const rows = await queryD1(siteDir, dbName, sql);
  return rows.map((row) => ({
    result_id: row["result_id"] as number,
    run_id: row["run_id"] as string,
    attempt: row["attempt"] as number,
  }));
}

async function buildBatchPayload(
  file: ModelShortcomingsFile,
  modelSlug: string,
  siteDir: string,
  dbName: string,
  analyzerModel: string,
): Promise<{ payload: BatchPayload; skipped: string[] }> {
  const shortcomings: BatchShortcoming[] = [];
  const skipped: string[] = [];

  // Cache result_id lookups per task to avoid duplicate D1 queries when
  // multiple shortcomings reference the same task.
  const resultIdCache = new Map<
    string,
    Array<{ result_id: number; run_id: string; attempt: number }>
  >();

  for (const entry of file.shortcomings) {
    // Endpoint validation rejects empty correct_pattern / incorrect_pattern.
    // Skip parse-failure entries that have empty patterns — they carry no
    // useful curated data anyway.
    if (!entry.correctPattern || !entry.incorrectPattern) {
      skipped.push(
        `${entry.concept}: skipped (empty correctPattern/incorrectPattern)`,
      );
      continue;
    }

    const occurrences: BatchOccurrence[] = [];
    for (const taskId of entry.affectedTasks) {
      let rows = resultIdCache.get(taskId);
      if (!rows) {
        rows = await fetchResultIdsForTask(siteDir, dbName, modelSlug, taskId);
        resultIdCache.set(taskId, rows);
      }
      if (rows.length === 0) {
        skipped.push(
          `${entry.concept}/${taskId}: no result row in prod for ${modelSlug}`,
        );
        continue;
      }
      // Use the latest result for this task. Endpoint dedupes via
      // INSERT OR IGNORE on (shortcoming_id, result_id), so re-running is safe.
      const row = rows[0];
      if (!row) continue;
      occurrences.push({
        result_id: row.result_id,
        task_id: taskId,
        error_code: entry.errorCodes[0] ?? null,
      });
    }

    // Endpoint accepts entries with empty occurrences (validates `array or
    // absent`), so even when all task lookups fail we still upsert the
    // shortcoming text. UI shows the entry without per-result links.
    //
    // D-prompt: pass the registry-shaped fields through. Legacy JSON files
    // (predating Phase D) have these as undefined → null → endpoint logs a
    // deprecation warning and leaves concept_id NULL until D-data backfill.
    shortcomings.push({
      al_concept: entry.alConcept,
      concept: entry.concept,
      description: entry.description,
      correct_pattern: entry.correctPattern,
      incorrect_pattern_sha256: await sha256Hex(entry.incorrectPattern),
      error_codes: entry.errorCodes,
      occurrences,
      concept_slug_proposed: entry.concept_slug_proposed ?? null,
      concept_slug_existing_match: entry.concept_slug_existing_match ?? null,
      similarity_score: entry.similarity_score ?? null,
    });
  }

  return {
    payload: {
      model_slug: modelSlug,
      shortcomings,
      analyzer_model: analyzerModel,
    },
    skipped,
  };
}

async function readShortcomingsFile(
  path: string,
): Promise<ModelShortcomingsFile> {
  const text = await Deno.readTextFile(path);
  const parsed = JSON.parse(text) as ModelShortcomingsFile;
  if (!parsed.model || !Array.isArray(parsed.shortcomings)) {
    throw new Error(
      `${path}: invalid file (missing 'model' or 'shortcomings')`,
    );
  }
  return parsed;
}

async function listShortcomingsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      out.push(`${dir}/${entry.name}`);
    }
  }
  out.sort();
  return out;
}

async function handlePopulateShortcomings(
  options: PopulateShortcomingsOptions,
): Promise<void> {
  const flags: IngestCliFlags = {};
  if (options.url !== undefined) flags.url = options.url;
  if (options.keyPath !== undefined) flags.keyPath = options.keyPath;
  if (options.keyId !== undefined) flags.keyId = options.keyId;
  if (options.machineId !== undefined) flags.machineId = options.machineId;

  const cwd = Deno.cwd();
  // Endpoint requires `verifier` scope. Admin satisfies via hasScope
  // hierarchy (admin > verifier > ingest); ingest does not. Try admin
  // first; fall back to ingest with a warning so a misconfigured
  // operator gets a clear error from the server rather than silent
  // skip.
  let url: string;
  let keyPath: string;
  let keyId: number;
  try {
    const admin = await loadAdminConfig(cwd, flags);
    url = admin.url;
    keyPath = admin.adminKeyPath;
    keyId = admin.adminKeyId;
  } catch {
    const ingest = await loadIngestConfig(cwd, flags);
    url = ingest.url;
    keyPath = ingest.keyPath;
    keyId = ingest.keyId;
    console.log(
      colors.yellow(
        `[WARN] no admin key configured; using ingest key id=${keyId}. ` +
          `If endpoint rejects with insufficient_scope, configure ` +
          `admin_key_path/admin_key_id in ~/.centralgauge.yml.`,
      ),
    );
  }
  const dirArg = options.shortcomingsDir ?? "./model-shortcomings";
  const shortcomingsDir = dirArg.startsWith("/") || /^[A-Za-z]:/.test(dirArg)
    ? dirArg
    : `${cwd}/${dirArg}`;
  const dbName = options.d1Database ?? "centralgauge";
  const siteDir = `${cwd}/site`;

  console.log(colors.gray(`[INFO] shortcomings dir: ${shortcomingsDir}`));
  console.log(colors.gray(`[INFO] ingest URL: ${url}`));
  console.log(colors.gray(`[INFO] D1 database: ${dbName} (via ${siteDir})`));

  const files = await listShortcomingsFiles(shortcomingsDir);
  console.log(colors.gray(`[INFO] discovered ${files.length} JSON files`));

  let totalUploaded = 0;
  let totalOccurrences = 0;
  let totalModels = 0;
  const modelSummaries: Array<
    { file: string; slug: string; entries: number; occurrences: number }
  > = [];
  const skippedFiles: string[] = [];
  const allSkipped: string[] = [];

  for (const filePath of files) {
    const file = await readShortcomingsFile(filePath);
    const slug = mapToProductionSlug(file.model);
    if (!slug) {
      skippedFiles.push(
        `${filePath}: no production slug mapping for '${file.model}'`,
      );
      continue;
    }
    if (options.only && file.model !== options.only && slug !== options.only) {
      continue;
    }

    console.log(colors.cyan(`\n[FILE] ${filePath}`));
    console.log(
      colors.gray(`        json model: ${file.model} → prod slug: ${slug}`),
    );

    const analyzerModel = options.analyzerModel ?? "claude-opus-4-6";
    const { payload, skipped } = await buildBatchPayload(
      file,
      slug,
      siteDir,
      dbName,
      analyzerModel,
    );
    allSkipped.push(...skipped.map((s) => `${file.model}: ${s}`));
    const occCount = payload.shortcomings.reduce(
      (sum, s) => sum + s.occurrences.length,
      0,
    );

    if (skipped.length > 0) {
      console.log(
        colors.yellow(
          `[WARN] ${skipped.length} skipped occurrences (no matching result_id)`,
        ),
      );
      for (const s of skipped) console.log(colors.gray(`        - ${s}`));
    }

    if (options.dryRun) {
      console.log(
        colors.yellow(
          `[DRY] payload: ${payload.shortcomings.length} shortcomings, ${occCount} occurrences`,
        ),
      );
      console.log(JSON.stringify(payload, null, 2));
      modelSummaries.push({
        file: filePath,
        slug,
        entries: payload.shortcomings.length,
        occurrences: occCount,
      });
      continue;
    }

    if (payload.shortcomings.length === 0) {
      console.log(
        colors.yellow(`[WARN] no shortcomings to upload for ${slug}, skipping`),
      );
      continue;
    }

    const privKey = await readPrivateKey(keyPath);
    const signature = await signPayload(
      payload as unknown as Record<string, unknown>,
      privKey,
      keyId,
    );
    const body = { payload, signature };

    const resp = await postWithRetry(
      `${url}/api/v1/shortcomings/batch`,
      body,
      { maxAttempts: 3 },
    );
    const respText = await resp.text();
    let respJson: unknown = null;
    try {
      respJson = JSON.parse(respText);
    } catch { /* keep raw */ }

    const tag = resp.ok
      ? colors.green(`[${resp.status}]`)
      : colors.red(`[${resp.status}]`);
    console.log(
      `${tag} POST /api/v1/shortcomings/batch ${
        typeof respJson === "object" && respJson !== null
          ? JSON.stringify(respJson)
          : respText
      }`,
    );

    if (!resp.ok) {
      Deno.exit(1);
    }

    const okJson = (respJson ?? {}) as {
      upserted?: number;
      occurrences?: number;
    };
    totalUploaded += okJson.upserted ?? 0;
    totalOccurrences += okJson.occurrences ?? 0;
    totalModels += 1;
    modelSummaries.push({
      file: filePath,
      slug,
      entries: okJson.upserted ?? payload.shortcomings.length,
      occurrences: okJson.occurrences ?? occCount,
    });
  }

  console.log(colors.cyan(`\n[SUMMARY]`));
  for (const s of modelSummaries) {
    console.log(
      colors.gray(
        `  ${s.slug}: ${s.entries} shortcomings, ${s.occurrences} occurrences`,
      ),
    );
  }
  if (skippedFiles.length > 0) {
    console.log(colors.yellow(`\n[SKIPPED FILES]`));
    for (const s of skippedFiles) console.log(colors.gray(`  - ${s}`));
  }
  if (options.dryRun) {
    console.log(colors.yellow(`\n[DRY RUN] no POSTs made`));
    return;
  }
  console.log(
    colors.green(
      `\n[OK] uploaded ${totalUploaded} shortcomings, ${totalOccurrences} occurrences across ${totalModels} models`,
    ),
  );
}

export function registerPopulateShortcomingsCommand(cli: Command): void {
  cli
    .command(
      "populate-shortcomings",
      "Upload curated shortcomings from model-shortcomings/*.json to production",
    )
    .option("--url <url:string>", "Override ingest URL")
    .option("--key-path <path:string>", "Override verifier/admin key path")
    .option("--key-id <id:number>", "Override key id")
    .option("--machine-id <id:string>", "Override machine id")
    .option(
      "--shortcomings-dir <dir:string>",
      "Directory of model-shortcomings/*.json files (default: ./model-shortcomings)",
    )
    .option(
      "--only <model:string>",
      "Filter to a single model (matches JSON 'model' field or production slug)",
    )
    .option(
      "--d1-database <name:string>",
      "D1 database name for result_id lookups via wrangler (default: centralgauge)",
    )
    .option(
      "--dry-run",
      "Build payloads and print without POSTing",
      { default: false },
    )
    .option(
      "--analyzer-model <id:string>",
      "Analyzer model id forwarded to concept.created/concept.aliased event payloads (default: claude-opus-4-6)",
    )
    .example(
      "Upload all model files",
      "centralgauge populate-shortcomings",
    )
    .example(
      "Upload one model only",
      "centralgauge populate-shortcomings --only claude-opus-4-6",
    )
    .example(
      "Preview without writing",
      "centralgauge populate-shortcomings --only claude-opus-4-6 --dry-run",
    )
    .action(handlePopulateShortcomings);
}
