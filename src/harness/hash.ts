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
 * on Windows), at a tree root and every component below it (for hashFile:
 * from its root down to the file), before any skip rule. Nothing above the
 * root is inspected. This is an identity helper, not the
 * hostile-artifact copy boundary: the Part 2 verdict workspace copy must
 * enforce its own reparse-point policy.
 */

import { walk } from "@std/fs/walk";
import { isAbsolute, join, relative, resolve, SEPARATOR } from "@std/path";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { canonicalJSON } from "../../shared/canonical.ts";
import { ValidationError } from "../errors.ts";
import { TEXT_EXTENSIONS } from "../ingest/catalog/task-set-hash.ts";

export const HASH_RULES_VERSION = "hr2";

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

/**
 * Extensionless task-format control files that are text (hr2): the overlay
 * `.delete` list (staging DELETE_LIST). An autocrlf checkout rewrites them.
 */
export const TEXT_FILE_NAMES: readonly string[] = [".delete"];

function isText(path: string): boolean {
  const name = path.slice(
    Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1,
  );
  if (TEXT_FILE_NAMES.includes(name.toLowerCase())) return true;
  const dot = name.lastIndexOf(".");
  return dot !== -1 &&
    TEXT_EXTENSIONS.includes(name.slice(dot).toLowerCase());
}

/**
 * Refuses a link at `root` and at every component from `root` down to `path`
 * (like M1-01 probe()). Nothing above `root` is inspected, so a junction or
 * mapped drive above the repo is fine. `path` outside `root` is refused.
 */
async function refuseLink(root: string, path: string): Promise<void> {
  const absRoot = resolve(root);
  const rel = relative(absRoot, resolve(path));
  if (rel === ".." || rel.startsWith(`..${SEPARATOR}`) || isAbsolute(rel)) {
    throw new ValidationError(`refusing path outside ${absRoot}: ${path}`, [
      path,
    ]);
  }
  let p = absRoot;
  const parts = rel.split(SEPARATOR).filter((x) => x !== "");
  for (const next of [absRoot, ...parts.map((x) => (p = join(p, x)))]) {
    if ((await Deno.lstat(next)).isSymlink) {
      throw new ValidationError(`refusing link or reparse point: ${next}`, [
        next,
      ]);
    }
  }
}

/**
 * A walked relative path in posix form. "\" is a separator only on Windows;
 * elsewhere it is a filename character that would alias a directory, so it
 * is refused.
 */
export function posixRel(rel: string, os: typeof Deno.build.os): string {
  if (os === "windows") return rel.replaceAll("\\", "/");
  if (rel.includes("\\")) {
    throw new ValidationError(`refusing backslash in file name: ${rel}`, [rel]);
  }
  return rel;
}

/**
 * Per-file SHA-256 hex. CRLF becomes LF for text extensions and
 * TEXT_FILE_NAMES only; other
 * bytes are hashed as-is. `root` is the tree or task directory the file
 * belongs to: a link from `root` down to the file, or a file outside `root`,
 * is refused.
 */
export async function hashFile(root: string, path: string): Promise<string> {
  await refuseLink(root, path);
  return hashContent(path, await Deno.readFile(path));
}

/** The content rule of hashFile for bytes that are not on disk (git blobs). */
export function hashContent(
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  if (!isText(path)) return sha256Hex(bytes);
  // Byte-level CRLF -> LF: no decode round trip, so a BOM and malformed
  // UTF-8 survive as-is.
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) continue;
    out[n++] = bytes[i]!;
  }
  return sha256Hex(out.slice(0, n));
}

/**
 * True when a `task`-domain file path is a spec 1b section 7 build artifact:
 * under a `.alpackages/` or `output/` directory, or a `*.app` file. A regular
 * file named `output` is content.
 */
export function isTaskBuildArtifact(rel: string): boolean {
  const segs = rel.split("/");
  const dirs = segs.slice(0, -1);
  return dirs.some((s) => s === ".alpackages" || s === "output") ||
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
    const rel = posixRel(relative(dir, e.path), Deno.build.os);
    if (rel === "") continue;
    if (e.isSymlink) {
      throw new ValidationError(`refusing link or reparse point: ${rel}`, [
        rel,
      ]);
    }
    if (!e.isFile) continue;
    if (domain === "task" && isTaskBuildArtifact(rel)) continue;
    // The root was checked by refuseLink; entries by the walk.
    const bytes = await Deno.readFile(e.path);
    out.push({ path: rel, sha256: await hashContent(e.path, bytes) });
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
