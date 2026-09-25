/**
 * Harness Bench hashing rules (spec 1a sections 4 and 6).
 *
 * Every harness identity (task visible-input hash, oracle hash, task-set
 * identity, resolved manifest hash, component hash, workspace hash) goes
 * through hashJson, which prefixes HASH_RULES_VERSION. Bump the version on
 * ANY change to what is hashed or how, so a rule change can never collide
 * with an old hash (spec 1a section 4).
 *
 * Tree hashing has explicit domains. `bundle` hashes every file (a hidden
 * plugin manifest is behavior). `task` drops only the build artifacts spec 1b
 * section 7 names: `.alpackages/`, `output/`, `*.app`.
 *
 * Link refusal covers what Deno reports as a symlink (symlinks and junctions
 * on Windows), for the root and every entry, before any skip rule. This is
 * an identity helper, not the hostile-artifact copy boundary: the Part 2
 * verdict workspace copy must enforce its own reparse-point policy.
 */

import { walk } from "@std/fs/walk";
import { relative } from "@std/path";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { canonicalJSON } from "../../shared/canonical.ts";
import { ValidationError } from "../errors.ts";
import { TEXT_EXTENSIONS } from "../ingest/catalog/task-set-hash.ts";

export const HASH_RULES_VERSION = "hr1";

export type TreeDomain = "bundle" | "task";

const enc = new TextEncoder();

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return encodeHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

/** SHA-256 hex of `cg-harness:<rules>\n` + canonicalJSON(value). */
export function hashJson(value: unknown): Promise<string> {
  return sha256Hex(
    enc.encode(`cg-harness:${HASH_RULES_VERSION}\n${canonicalJSON(value)}`),
  );
}

function isText(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot !== -1 &&
    TEXT_EXTENSIONS.includes(path.slice(dot).toLowerCase());
}

async function refuseLink(path: string, label: string): Promise<void> {
  if ((await Deno.lstat(path)).isSymlink) {
    throw new ValidationError(`refusing link or reparse point: ${label}`, [
      label,
    ]);
  }
}

/**
 * Per-file SHA-256 hex. CRLF becomes LF for text extensions only; other
 * bytes are hashed as-is. Refuses a link.
 */
export async function hashFile(path: string): Promise<string> {
  await refuseLink(path, path);
  return hashContent(path, await Deno.readFile(path));
}

/** The content rule of hashFile for bytes that are not on disk (git blobs). */
export function hashContent(
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  if (!isText(path)) return sha256Hex(bytes);
  const text = new TextDecoder().decode(bytes).replaceAll("\r\n", "\n");
  return sha256Hex(enc.encode(text));
}

/** True when a `task`-domain path is a spec 1b section 7 build artifact. */
export function isTaskBuildArtifact(rel: string): boolean {
  const segs = rel.split("/");
  return segs.some((s) => s === ".alpackages" || s === "output") ||
    /\.app$/i.test(segs[segs.length - 1]!);
}

export interface TreeEntry {
  path: string;
  sha256: string;
}

/**
 * Sorted (posix path, sha256) list of a directory's files under a domain.
 * Missing dir: throws NotFound unless `optional`.
 */
export async function listTree(
  dir: string,
  domain: TreeDomain,
  opts: { optional?: boolean } = {},
): Promise<TreeEntry[]> {
  try {
    await refuseLink(dir, dir);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound && opts.optional) return [];
    throw err;
  }
  const out: TreeEntry[] = [];
  for await (const e of walk(dir, { followSymlinks: false })) {
    const rel = relative(dir, e.path).replaceAll("\\", "/");
    if (rel === "") continue;
    if (e.isSymlink) {
      throw new ValidationError(`refusing link or reparse point: ${rel}`, [
        rel,
      ]);
    }
    if (!e.isFile) continue;
    if (domain === "task" && isTaskBuildArtifact(rel)) continue;
    out.push({ path: rel, sha256: await hashFile(e.path) });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Content hash of a directory tree (hash of an empty list when optional and missing). */
export async function hashTree(
  dir: string,
  domain: TreeDomain,
  opts: { optional?: boolean } = {},
): Promise<string> {
  return hashJson({ domain, tree: await listTree(dir, domain, opts) });
}
