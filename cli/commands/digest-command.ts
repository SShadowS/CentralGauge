/**
 * `centralgauge lifecycle digest` — weekly lifecycle activity report.
 *
 * Plan G / G3 — Reads lifecycle events + family diffs + pending-review
 * queue across the configured `--since` window and renders a markdown or
 * JSON digest. Plan G's `.github/workflows/weekly-cycle.yml` pipes the
 * markdown into a sticky GitHub issue tagged `weekly-cycle-digest`.
 *
 * Architecture:
 *
 *   1. Discover models via the public `GET /api/v1/models` endpoint (same
 *      pattern as `lifecycle status` — keeps the two commands consistent
 *      on what "every model" means).
 *   2. Resolve `--task-set current` to the same hash the `cycle` /
 *      `status` commands resolve to via `computeTaskSetHash(cwd/tasks)`.
 *   3. Hand off to `fetchDigestInputs` from `src/lifecycle/digest.ts`
 *      which fans out the per-model `queryEvents` calls + family-diff +
 *      review-queue fetches.
 *   4. Render via `generateDigest` (pure function, fixture-tested).
 *
 * Auth: Admin scope. Fail-fast on missing `adminKeyPath` /
 * `adminKeyId` in `.centralgauge.yml` — matching the pattern in
 * `cluster-review` and `status`.
 *
 * @module cli/commands/digest
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { z } from "zod";
import { CentralGaugeError } from "../../src/errors.ts";
import {
  type IngestCliFlags,
  loadAdminConfig,
  readPrivateKey,
} from "../../src/ingest/config.ts";
import { resolveCurrentTaskSetHash } from "../../src/ingest/catalog/task-set-hash.ts";
import {
  fetchDigestInputs,
  generateDigest,
} from "../../src/lifecycle/digest.ts";

interface DigestFlags {
  since: string;
  format: string;
  taskSet: string;
  url?: string;
  keyPath?: string;
  keyId?: number;
  machineId?: string;
  adminKeyPath?: string;
  adminKeyId?: number;
}

/**
 * Defensive shape for the public `GET /api/v1/models` response. Same
 * pattern as `cli/commands/status-command.ts` — zod-validated at the
 * seam so a future schema rename surfaces as a clean error rather than
 * a cryptic `TypeError`.
 */
const ModelsListResponseSchema = z.object({
  data: z.array(z.object({ slug: z.string() })),
});

async function listAllModels(siteUrl: string): Promise<string[]> {
  const resp = await fetch(`${siteUrl}/api/v1/models`);
  if (!resp.ok) {
    throw new Error(
      `failed to list models: HTTP ${resp.status} ${resp.statusText}`,
    );
  }
  const rawBody = await resp.json();
  const parsed = ModelsListResponseSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new CentralGaugeError(
      `invalid_models_response: GET ${siteUrl}/api/v1/models did not match ` +
        `the expected shape ({ data: [{ slug: string }] }). ` +
        `Issues: ${JSON.stringify(parsed.error.issues)}`,
      "INVALID_MODELS_RESPONSE",
      { url: `${siteUrl}/api/v1/models`, issues: parsed.error.issues },
    );
  }
  return parsed.data.data.map((m) => m.slug);
}

/**
 * `--since` accepts compact durations: `7d`, `24h`. Anything else raises
 * a CLI error. Tested in `tests/unit/lifecycle/digest-duration.test.ts`.
 */
export function parseDuration(s: string): number {
  const m = /^(\d+)([dh])$/.exec(s);
  if (!m) {
    throw new Error(
      `Invalid --since duration: "${s}" (expected e.g. "7d" or "24h")`,
    );
  }
  const n = parseInt(m[1] ?? "0", 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `Invalid --since duration: "${s}" must be a positive integer`,
    );
  }
  return m[2] === "d" ? n * 86_400_000 : n * 3_600_000;
}

async function resolveTaskSetHash(taskSetFlag: string): Promise<string> {
  if (taskSetFlag !== "current") return taskSetFlag;
  return await resolveCurrentTaskSetHash();
}

async function handleDigest(flags: DigestFlags): Promise<void> {
  if (flags.format !== "markdown" && flags.format !== "json") {
    throw new Error(
      `--format must be 'markdown' or 'json', got: ${flags.format}`,
    );
  }
  const cliFlags: IngestCliFlags = {};
  if (flags.url !== undefined) cliFlags.url = flags.url;
  if (flags.keyPath !== undefined) cliFlags.keyPath = flags.keyPath;
  if (flags.keyId !== undefined) cliFlags.keyId = flags.keyId;
  if (flags.machineId !== undefined) cliFlags.machineId = flags.machineId;
  if (flags.adminKeyPath !== undefined) {
    cliFlags.adminKeyPath = flags.adminKeyPath;
  }
  if (flags.adminKeyId !== undefined) cliFlags.adminKeyId = flags.adminKeyId;

  const config = await loadAdminConfig(Deno.cwd(), cliFlags);
  const adminPriv = await readPrivateKey(config.adminKeyPath);
  const adminKeyId = config.adminKeyId;
  const sinceMs = Date.now() - parseDuration(flags.since);
  const taskSetHash = await resolveTaskSetHash(flags.taskSet);
  const models = await listAllModels(config.url);

  const inputs = await fetchDigestInputs({
    siteUrl: config.url,
    sinceMs,
    privateKey: adminPriv,
    keyId: adminKeyId,
    models,
    taskSetHash,
  });

  const out = await generateDigest({
    ...inputs,
    format: flags.format as "markdown" | "json",
  });
  console.log(out);
}

export function registerDigestSubcommand(parent: Command): void {
  parent.command(
    "digest",
    new Command()
      .description(
        "Generate a lifecycle activity digest (markdown for the sticky GH issue, JSON for jq pipelines)",
      )
      .option(
        "--since <duration:string>",
        "Time window — e.g. '7d', '24h'",
        { default: "7d" },
      )
      .option(
        "--format <format:string>",
        "Output format: 'markdown' (default) or 'json'",
        { default: "markdown" },
      )
      .option(
        "--task-set <hashOrCurrent:string>",
        "Task set hash or 'current' (default)",
        { default: "current" },
      )
      .option("--url <url:string>", "Override ingest URL")
      .option("--key-path <path:string>", "Path to ingest signing key")
      .option("--key-id <id:number>", "Ingest key id")
      .option("--machine-id <id:string>", "Machine id override")
      .option("--admin-key-path <path:string>", "Path to admin signing key")
      .option("--admin-key-id <id:number>", "Admin key id")
      .example(
        "Default 7-day markdown digest",
        "centralgauge lifecycle digest",
      )
      .example(
        "JSON for jq pipelines",
        "centralgauge lifecycle digest --since 7d --format json | jq '.review_queue.pending_count'",
      )
      .example(
        "24-hour quick check",
        "centralgauge lifecycle digest --since 24h",
      )
      .action(async (flags) => {
        const typedFlags = flags as unknown as DigestFlags;
        try {
          await handleDigest(typedFlags);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`${colors.red("[FAIL]")} ${message}`);
          Deno.exit(1);
        }
      }),
  );
}
