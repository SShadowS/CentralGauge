/**
 * Harness fingerprint computation for replay integrity checking.
 *
 * A harness fingerprint is a SHA-256 digest of files that can change the
 * verdict for every task at once. Changes to these files invalidate all
 * cached task replays, so a single harness change doesn't leave stale data
 * behind.
 */

import { join, relative } from "@std/path";
import { walk } from "@std/fs/walk";

/** The list before batch mode (2026-08). Kept only for the one-time gold-ci adoption check. */
export const LEGACY_HARNESS_INPUTS_2026_08 = [
  "src/constants.ts",
  "src/parallel/compile-queue.ts",
  "src/tasks/executor-v2.ts",
  "src/tasks/candidate-guard.ts",
  "scripts/trap-probe.ts",
  "mcp/al-tools-server.ts",
] as const;

/**
 * Harness inputs that decide what a candidate app declares and depends on. A
 * change to any of these can flip a verdict for every task at once, which is
 * exactly the failure mode a per-task probe cannot see. A directory entry
 * means every `.ts` file under it.
 */
export const HARNESS_INPUTS = [
  ...LEGACY_HARNESS_INPUTS_2026_08,
  "src/parallel/shared",
  "src/parallel/infra-retry.ts",
  "src/llm/prompt-building.ts",
  "src/tasks/object-overlay.ts",
  "src/llm/candidate-resolution.ts",
  "src/parallel/llm-work-pool.ts",
] as const;

/**
 * Expand directory entries in `paths` to their sorted `.ts` files (posix
 * separators, relative to `root`). A file entry, or a path that does not
 * exist under `root`, passes through unchanged so `hashFiles`' `missing`
 * policy still applies to it.
 *
 * @param paths File or directory paths, relative to `root`.
 * @param root Directory the paths are resolved against.
 * @returns Promise resolving to the sorted, expanded path list.
 */
export async function expandInputs(
  paths: readonly string[],
  root: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    let info: Deno.FileInfo;
    try {
      info = await Deno.stat(join(root, p));
    } catch {
      out.push(p);
      continue;
    }
    if (!info.isDirectory) {
      out.push(p);
      continue;
    }
    for await (
      const entry of walk(join(root, p), { includeDirs: false, exts: [".ts"] })
    ) {
      out.push(relative(root, entry.path).replaceAll("\\", "/"));
    }
  }
  return out.sort();
}

/**
 * Compute a stable SHA-256 digest over a set of files.
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
 * @param paths File paths, relative to `root`. Hashed in sorted order so
 *   caller-supplied ordering never affects the digest.
 * @param root Directory the paths are resolved against.
 * @param opts.missing How to treat a path that doesn't exist under `root`:
 *   `"skip"` (default) silently omits it from the digest — the right choice
 *   for a task-input set where absence (no prereq app, no companions) is
 *   normal. `"throw"` fails loudly instead — the right choice for a fixed
 *   list of committed files where a missing one means the fingerprint would
 *   otherwise silently narrow and stop covering what it claims to cover.
 * @returns Promise resolving to a 64-character hex SHA-256 digest.
 */
export async function hashFiles(
  paths: readonly string[],
  root: string,
  opts?: { missing?: "skip" | "throw" },
): Promise<string> {
  const onMissing = opts?.missing ?? "skip";
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  const expanded = await expandInputs(paths, root);
  for (const p of expanded) {
    let text: string;
    try {
      text = await Deno.readTextFile(join(root, p));
    } catch (err) {
      if (onMissing === "throw") {
        throw new Error(`hashFiles: missing input "${p}" under "${root}"`, {
          cause: err,
        });
      }
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

/**
 * Compute a stable fingerprint of the harness inputs.
 *
 * Every input in {@link HARNESS_INPUTS} is a committed file, so a missing one
 * means something is badly wrong with the checkout — fail loudly rather than
 * silently hash a narrower set than the name promises.
 *
 * @param root Working directory for resolving file paths. Defaults to ".".
 * @returns Promise resolving to a 64-character hex SHA-256 digest.
 */
export function harnessFingerprint(root = "."): Promise<string> {
  return hashFiles(HARNESS_INPUTS, root, { missing: "throw" });
}
