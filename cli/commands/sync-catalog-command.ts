/**
 * Sync-catalog command: reconcile site/catalog/*.yml with the production
 * D1 catalog tables by POSTing each entry through the signed admin API.
 * @module cli/commands/sync-catalog
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { readCatalog } from "../../src/ingest/catalog/read.ts";
import { loadIngestConfig, readPrivateKey } from "../../src/ingest/config.ts";
import { signPayload } from "../../src/ingest/sign.ts";
import { postWithRetry } from "../../src/ingest/client.ts";

interface SyncCatalogOptions {
  apply: boolean;
}

async function handleSyncCatalog(options: SyncCatalogOptions): Promise<void> {
  const cwd = Deno.cwd();
  const config = await loadIngestConfig(cwd, {});
  if (config.adminKeyId == null || !config.adminKeyPath) {
    throw new Error(
      "admin_key_id + admin_key_path required in .centralgauge.yml for sync",
    );
  }
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
    .action(handleSyncCatalog);
}
