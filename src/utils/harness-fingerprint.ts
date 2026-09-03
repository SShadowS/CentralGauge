/**
 * Harness fingerprint computation for replay integrity checking.
 *
 * A harness fingerprint is a SHA-256 digest of files that can change the
 * verdict for every task at once. Changes to these files invalidate all
 * cached task replays, so a single harness change doesn't leave stale data
 * behind.
 */

import { join } from "@std/path";

/**
 * Harness inputs that decide what a candidate app declares and depends on. A
 * change to any of these can flip a verdict for every task at once, which is
 * exactly the failure mode a per-task probe cannot see.
 */
export const HARNESS_INPUTS = [
  "src/constants.ts",
  "src/parallel/compile-queue.ts",
  "src/tasks/executor-v2.ts",
  "src/tasks/candidate-guard.ts",
  "scripts/trap-probe.ts",
  "mcp/al-tools-server.ts",
] as const;

/**
 * Compute a stable fingerprint of harness inputs.
 *
 * Per-file framing (path + length + content) so a rename, or a byte moving
 * between files, cannot produce a colliding digest.
 *
 * Line endings are NORMALISED to LF before hashing. This repo has documented
 * CRLF/LF drift (CLAUDE.md warns that `deno fmt` over a directory rewrites
 * dozens of unrelated files), and `git checkout` of an LF working file writes
 * CRLF back. Hashing raw bytes therefore invalidated every task on every
 * line-ending churn — measured while building this: reverting an unrelated
 * edit moved the fingerprint and dropped two green tasks to stale. A gate
 * that cries wolf gets ignored, and CRLF cannot change a compile verdict.
 *
 * @param root Working directory for resolving file paths. Defaults to ".".
 * @returns Promise resolving to a 64-character hex SHA-256 digest.
 */
export async function harnessFingerprint(root = "."): Promise<string> {
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const p of [...HARNESS_INPUTS].sort()) {
    let text: string;
    try {
      text = await Deno.readTextFile(join(root, p));
    } catch {
      continue;
    }
    const bytes = enc.encode(text.split("\r\n").join("\n"));
    parts.push(enc.encode(`${p}:${bytes.byteLength}:`));
    parts.push(bytes);
  }
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}
