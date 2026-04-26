#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run
/**
 * seed-admin-key.ts
 *
 * Seed a machine key directly into a D1 database via
 * `npx wrangler d1 execute --remote`.
 *
 * Intended for bootstrapping a fresh environment. Once at least one admin
 * key exists, rotate and add new keys via POST /api/v1/admin/keys (signed
 * by the existing admin key) instead.
 *
 * Usage:
 *   deno run -A scripts/seed-admin-key.ts \
 *     <db-name> <machine-id> <public-key-base64> \
 *     [--scope admin|ingest|verifier] [--env production]
 *
 * Example:
 *   deno run -A scripts/seed-admin-key.ts \
 *     centralgauge prod-ingest RBu0...PUg= \
 *     --scope ingest --env production
 *
 * Security notes:
 *   - The operator-supplied <machine-id> is forwarded verbatim into the
 *     SQL string, but validated against a positive allowlist
 *     (A-Z a-z 0-9 . _ -) so the INSERT statement cannot be corrupted.
 *   - Scope is whitelisted against the three server-side values.
 *   - The public key is encoded as a hex BLOB literal (`x'...'`), which D1
 *     accepts and which is immune to quote-escaping issues.
 *   - `--remote` is always passed to wrangler. For local D1 testing, run
 *     `wrangler d1 execute ... --local` manually.
 */

import { decodeBase64 } from "jsr:@std/encoding@^1.0.5/base64";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";

type Scope = "admin" | "ingest" | "verifier";

interface CliArgs {
  dbName: string;
  machineId: string;
  pubB64: string;
  scope: Scope;
  env: string | null;
}

function usage(): never {
  console.error(
    "usage: seed-admin-key.ts <db-name> <machine-id> <public-key-base64> " +
      "[--scope admin|ingest|verifier] [--env production]",
  );
  Deno.exit(2);
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let scope: Scope = "admin";
  let env: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scope") {
      const v = argv[++i];
      if (v !== "admin" && v !== "ingest" && v !== "verifier") {
        console.error(`[FAIL] --scope must be admin|ingest|verifier (got '${v}')`);
        Deno.exit(2);
      }
      scope = v;
    } else if (arg === "--env") {
      env = argv[++i] ?? usage();
    } else if (arg.startsWith("--")) {
      console.error(`[FAIL] unknown flag '${arg}'`);
      usage();
    } else {
      positional.push(arg);
    }
  }

  const [dbName, machineId, pubB64] = positional;
  if (!dbName || !machineId || !pubB64) usage();
  return { dbName, machineId, pubB64, scope, env };
}

function validateMachineId(machineId: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(machineId)) {
    console.error("machine_id must be 1-128 chars, only A-Z a-z 0-9 . _ -");
    Deno.exit(2);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(Deno.args);
  validateMachineId(args.machineId);

  let pubBytes: Uint8Array;
  try {
    pubBytes = decodeBase64(args.pubB64);
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
    `VALUES ('${args.machineId}', x'${hex}', '${args.scope}', '${createdAt}');`;

  console.error(
    `[INFO] seeding ${args.scope} key into D1 database '${args.dbName}'` +
      (args.env ? ` (env=${args.env})` : ""),
  );
  console.error(`[INFO] machine_id = ${args.machineId}`);
  console.error(`[INFO] public key = ${args.pubB64} (32 bytes)`);

  const wranglerArgs = [
    "wrangler",
    "d1",
    "execute",
    args.dbName,
    "--remote",
    "--command",
    sql,
  ];
  if (args.env) {
    wranglerArgs.push("--env", args.env);
  }

  const cmd = new Deno.Command("npx", {
    args: wranglerArgs,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();
  if (code === 0) {
    console.error(`[OK] ${args.scope} key seeded successfully`);
  } else {
    console.error(`[FAIL] wrangler exited with code ${code}`);
  }
  return code;
}

if (import.meta.main) {
  Deno.exit(await main());
}
