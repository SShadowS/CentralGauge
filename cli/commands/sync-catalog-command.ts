/**
 * Sync-catalog command: reconcile site/catalog/*.yml with the production
 * D1 catalog tables by POSTing each entry through the signed admin API.
 * @module cli/commands/sync-catalog
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import type { IngestCliFlags } from "../../src/ingest/config.ts";
import { readCatalog } from "../../src/ingest/catalog/read.ts";
import { loadAdminConfig, readPrivateKey } from "../../src/ingest/config.ts";
import { signPayload } from "../../src/ingest/sign.ts";
import { postWithRetry } from "../../src/ingest/client.ts";

interface SyncCatalogOptions {
  apply: boolean;
  url?: string;
  keyPath?: string;
  keyId?: number;
  machineId?: string;
  adminKeyPath?: string;
  adminKeyId?: number;
}

async function handleSyncCatalog(options: SyncCatalogOptions): Promise<void> {
  const flags: IngestCliFlags = {};
  if (options.url !== undefined) flags.url = options.url;
  if (options.keyPath !== undefined) flags.keyPath = options.keyPath;
  if (options.keyId !== undefined) flags.keyId = options.keyId;
  if (options.machineId !== undefined) flags.machineId = options.machineId;
  if (options.adminKeyPath !== undefined) {
    flags.adminKeyPath = options.adminKeyPath;
  }
  if (options.adminKeyId !== undefined) flags.adminKeyId = options.adminKeyId;

  const cwd = Deno.cwd();
  const config = await loadAdminConfig(cwd, flags);
  const adminPriv = await readPrivateKey(config.adminKeyPath);
  const cat = await readCatalog(`${cwd}/site/catalog`);

  console.log(
    colors.gray(
      `[INFO] ${cat.models.length} models, ${cat.pricing.length} pricing rows, ${cat.families.length} families`,
    ),
  );

  if (!options.apply) {
    console.log(colors.yellow("[DRY] use --apply to write"));
    return;
  }

  if (cat.families.length > 0) {
    console.log(
      colors.gray(
        `[SKIP] ${cat.families.length} families (seeded via D1 SQL at deploy time)`,
      ),
    );
  }

  for (const m of cat.models) {
    const payload = m as unknown as Record<string, unknown>;
    const sig = await signPayload(payload, adminPriv, config.adminKeyId);
    const resp = await postWithRetry(
      `${config.url}/api/v1/admin/catalog/models`,
      { version: 1, signature: sig, payload },
    );
    const tag = resp.ok ? colors.green(`[${resp.status}]`) : colors.red(
      `[${resp.status}]`,
    );
    console.log(`${tag} model ${m.slug}`);
  }

  for (const p of cat.pricing) {
    const payload = p as unknown as Record<string, unknown>;
    const sig = await signPayload(payload, adminPriv, config.adminKeyId);
    const resp = await postWithRetry(
      `${config.url}/api/v1/admin/catalog/pricing`,
      { version: 1, signature: sig, payload },
    );
    const tag = resp.ok ? colors.green(`[${resp.status}]`) : colors.red(
      `[${resp.status}]`,
    );
    console.log(`${tag} pricing ${p.pricing_version} / ${p.model_slug}`);
  }
}

export function registerSyncCatalogCommand(cli: Command): void {
  cli
    .command(
      "sync-catalog",
      "Reconcile site/catalog/*.yml with the production D1 catalog tables",
    )
    .option("--url <url:string>", "Override ingest URL")
    .option("--key-path <path:string>", "Override ingest key path")
    .option("--key-id <id:number>", "Override ingest key id")
    .option("--machine-id <id:string>", "Override machine id")
    .option(
      "--admin-key-path <path:string>",
      "Admin key path for catalog writes",
    )
    .option("--admin-key-id <id:number>", "Admin key id for catalog writes")
    .option(
      "--apply",
      "Actually POST catalog entries (default is dry-run)",
      { default: false },
    )
    .example(
      "Preview sync (no writes)",
      "centralgauge sync-catalog",
    )
    .example(
      "Apply catalog to production",
      "centralgauge sync-catalog --apply",
    )
    .example(
      "Apply with explicit admin key",
      "centralgauge sync-catalog --apply --admin-key-path ~/.cg/admin.key --admin-key-id 2",
    )
    .action(handleSyncCatalog);
}
