#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run
/**
 * seed-admin-key.ts
 *
 * Seed the very first admin key directly into a D1 database via
 * `npx wrangler d1 execute --remote`.
 *
 * Once at least one admin key exists you should NEVER run this script again.
 * Use POST /api/v1/admin/keys (signed by an existing admin key) instead.
 *
 * Usage:
 *   deno run -A scripts/seed-admin-key.ts <db-name> <machine-id> <public-key-base64>
 *
 * Example:
 *   deno run -A scripts/seed-admin-key.ts \
 *     centralgauge \
 *     ops-laptop \
 *     RBu0...PUg=
 *
 * Security notes:
 *   - The script forwards the operator-supplied <machine-id> verbatim into the
 *     SQL string. Because the only callers are repo maintainers running this
 *     locally to bootstrap a fresh D1 database, that surface is acceptable —
 *     but we still validate that machine_id contains no SQL meta-characters
 *     (single quotes, backslashes, newlines, NULs) to prevent accidental
 *     corruption of the INSERT statement.
 *   - The public key is encoded as a hex BLOB literal (`x'...'`), which D1
 *     accepts and which is not subject to quote-escaping.
 *   - Run this against PRODUCTION (`--remote`) — if you want a local seed,
 *     change `--remote` to `--local` by editing this script.
 */

import { decodeBase64 } from "jsr:@std/encoding@^1.0.5/base64";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";

function usage(): never {
  console.error(
    "usage: seed-admin-key.ts <db-name> <machine-id> <public-key-base64>",
  );
  Deno.exit(2);
}

function validateMachineId(machineId: string): void {
  if (machineId.length === 0 || machineId.length > 128) {
    throw new Error("machine-id must be 1..128 chars");
  }
  // Disallow anything that could break the SQL string literal we build below.
  if (/['"`\\\r\n\0;]/.test(machineId)) {
    throw new Error(
      "machine-id contains forbidden characters (quotes, backslashes, newlines, NULs, semicolons)",
    );
  }
}

async function main(): Promise<number> {
  const [dbName, machineId, pubB64] = Deno.args;
  if (!dbName || !machineId || !pubB64) usage();

  validateMachineId(machineId);

  let pubBytes: Uint8Array;
  try {
    pubBytes = decodeBase64(pubB64);
  } catch (err) {
    console.error(
      `[FAIL] public-key-base64 is not valid base64: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 2;
  }
  if (pubBytes.length !== 32) {
    console.error(
      `[FAIL] public key must decode to exactly 32 bytes (got ${pubBytes.length})`,
    );
    return 2;
  }

  const hex = encodeHex(pubBytes);
  const createdAt = new Date().toISOString();
  const sql =
    `INSERT INTO machine_keys(machine_id, public_key, scope, created_at) ` +
    `VALUES ('${machineId}', x'${hex}', 'admin', '${createdAt}');`;

  console.error(`[INFO] seeding admin key into D1 database '${dbName}'`);
  console.error(`[INFO] machine_id = ${machineId}`);
  console.error(`[INFO] public key = ${pubB64} (32 bytes)`);
  console.error(`[INFO] running: npx wrangler d1 execute ${dbName} --remote --command "<sql>"`);

  const cmd = new Deno.Command("npx", {
    args: [
      "wrangler",
      "d1",
      "execute",
      dbName,
      "--remote",
      "--command",
      sql,
    ],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();
  if (code === 0) {
    console.error(`[OK] admin key seeded successfully`);
  } else {
    console.error(`[FAIL] wrangler exited with code ${code}`);
  }
  return code;
}

if (import.meta.main) {
  Deno.exit(await main());
}
