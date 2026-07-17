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
import {
  syncCatalogToAdmin,
  type SyncItemResult,
} from "../../src/ingest/catalog/sync.ts";

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

  const printItem = (r: SyncItemResult) => {
    const tag = r.ok ? colors.green(`[${r.status}]`) : colors.red(
      `[${r.status}]`,
    );
    console.log(`${tag} ${r.kind} ${r.key}`);
  };

  const result = await syncCatalogToAdmin(cat, config, adminPriv, {
    onItem: printItem,
  });
  if (result.retried) {
    console.log(
      colors.yellow(
        "[RETRY] some row(s) hit the admin API rate limit; retried once after honoring Retry-After",
      ),
    );
  }
  if (!result.ok) {
    const failed = result.items.filter((r) => !r.ok);
    console.log(
      colors.red(
        `[FAIL] ${failed.length}/${result.items.length} row(s) still failing: ${
          failed.map((r) => `${r.kind}:${r.key}=${r.status}`).join(", ")
        }`,
      ),
    );
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
