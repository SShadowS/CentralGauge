#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net=jsr.io,registry.npmjs.org
/**
 * generate-machine-key.ts
 *
 * Generate a fresh Ed25519 keypair for a CentralGauge machine.
 *
 * Writes:
 *   <outPath>      32 raw bytes of the private key (mode 0o600)
 *   <outPath>.pub  base64-encoded public key + newline (mode 0o644)
 *
 * Default outPath:
 *   $HOME/.centralgauge/keys/ingest.ed25519
 *   (Windows: %USERPROFILE%\.centralgauge\keys\ingest.ed25519 if HOME unset)
 *
 * Usage:
 *   deno run -A scripts/generate-machine-key.ts [outPath]
 *
 * After running, register the public key with the API by calling
 *   POST /api/v1/admin/keys
 * (signed with an existing admin key) — or for the very first key, seed
 * directly via scripts/seed-admin-key.ts.
 */

import * as ed from "npm:@noble/ed25519@2.1.0";
import { encodeBase64 } from "jsr:@std/encoding@^1.0.5/base64";
import { dirname, join } from "jsr:@std/path@^1.1.4";
import { ensureDir } from "jsr:@std/fs@^1.0.23";

function defaultOutPath(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) {
    throw new Error(
      "neither HOME nor USERPROFILE env var set; pass an explicit outPath",
    );
  }
  return join(home, ".centralgauge", "keys", "ingest.ed25519");
}

async function main(): Promise<void> {
  const outPath = Deno.args[0] ?? defaultOutPath();
  const pubPath = `${outPath}.pub`;

  await ensureDir(dirname(outPath));

  // Generate keypair. @noble/ed25519 v2 is sync-friendly via getPublicKeyAsync.
  const privateKey = ed.utils.randomPrivateKey(); // 32 bytes
  const publicKey = await ed.getPublicKeyAsync(privateKey); // 32 bytes
  const publicKeyB64 = encodeBase64(publicKey);

  // Write private key — 32 raw bytes — with strict perms.
  await Deno.writeFile(outPath, privateKey, { mode: 0o600 });
  // Best-effort tighten on Windows where chmod is a no-op.
  try {
    await Deno.chmod(outPath, 0o600);
  } catch { /* Windows: not supported */ }

  // Write public key (base64 + newline).
  await Deno.writeTextFile(pubPath, `${publicKeyB64}\n`);

  console.log(`[OK] private key written to ${outPath} (mode 0o600, 32 bytes)`);
  console.log(`[OK] public key  written to ${pubPath}`);
  console.log(``);
  console.log(`Public key (base64): ${publicKeyB64}`);
  console.log(``);
  console.log(`Register this key by calling the admin API, e.g.:`);
  console.log(
    `  centralgauge admin register-key --machine-id <id> --scope ingest --pub-file "${pubPath}"`,
  );
  console.log(``);
  console.log(
    `Or, for the very first admin key, seed it directly into D1 with:`,
  );
  console.log(
    `  deno run -A scripts/seed-admin-key.ts <db-name> <machine-id> ${publicKeyB64}`,
  );
}

if (import.meta.main) {
  await main();
}
