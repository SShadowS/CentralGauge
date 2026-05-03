import { walk } from "jsr:@std/fs@^1.0.0/walk";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { join, relative } from "jsr:@std/path@^1.0.0";

/**
 * Compute a deterministic content hash that defines a task_set snapshot.
 *
 * Scope (relative to projectRoot):
 *   - tasks/**\/*.yml                  (manifests)
 *   - tests/al/**                      (test codeunits, prereq apps,
 *                                       support files — RDLC, layouts, etc.)
 *
 * Excluded (build artifacts, regenerable from source):
 *   - any directory named ".alpackages" or "output"
 *   - files matching *.app  (compiled AL output)
 *   - files matching cache_*.json  (alpackages cache manifests)
 *
 * Framing (binary-safe):
 *   For each file, compute its SHA-256 separately, then feed
 *     u32-be(pathLen) || pathBytes || file_sha256(32 bytes)
 *   into the outer SHA-256. Per-file digests are fixed length, so framing
 *   cannot be ambiguated by file content (unlike the previous NUL-delimited
 *   concat which could collide on binary support files).
 */
export async function computeTaskSetHash(projectRoot: string): Promise<string> {
  // tasks/ is the canonical project marker — its absence means we're not
  // inside a CentralGauge checkout. tests/al/ is optional (test harnesses
  // and minimal repos may omit it).
  await Deno.stat(join(projectRoot, "tasks"));
  const tasksFiles = await collectFiles(
    projectRoot,
    "tasks",
    (rel) => rel.endsWith(".yml"),
  );
  const alFiles = await collectFiles(
    projectRoot,
    "tests/al",
    () => true,
  );
  const all = [...tasksFiles, ...alFiles].sort((a, b) =>
    a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
  );

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const { rel, digest } of all) {
    const pathBytes = enc.encode(rel);
    const lenBuf = new Uint8Array(4);
    new DataView(lenBuf.buffer).setUint32(0, pathBytes.length, false);
    chunks.push(lenBuf);
    chunks.push(pathBytes);
    chunks.push(digest);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const concat = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    concat.set(c, o);
    o += c.length;
  }
  const outer = await crypto.subtle.digest("SHA-256", concat);
  return encodeHex(new Uint8Array(outer));
}

/**
 * Resolve the `"current"` sentinel used by status/digest/cycle commands.
 * Returns the freshly-computed hash for the local working tree, falling
 * back to the literal `"current"` string only when the project layout is
 * missing (e.g. running from outside a CentralGauge checkout). Other I/O
 * errors propagate so operators don't silently query the wrong task_set.
 */
export async function resolveCurrentTaskSetHash(
  projectRoot: string = Deno.cwd(),
): Promise<string> {
  try {
    return await computeTaskSetHash(projectRoot);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return "current";
    throw err;
  }
}

interface FileEntry {
  /** POSIX-normalised path relative to projectRoot. */
  rel: string;
  /** SHA-256 of file content (32 bytes). */
  digest: Uint8Array;
}

const SKIP_DIR_RE = /(^|[\\/])(\.alpackages|output)([\\/]|$)/;
const SKIP_FILE_RE = /(\.app|^cache_.*\.json)$/;

async function collectFiles(
  projectRoot: string,
  subdir: string,
  includeFile: (relUnderSubdir: string) => boolean,
): Promise<FileEntry[]> {
  const dir = join(projectRoot, subdir);
  const out: FileEntry[] = [];
  let it: AsyncIterableIterator<{ path: string; isFile: boolean }> | undefined;
  try {
    it = walk(dir, {
      includeDirs: false,
      skip: [SKIP_DIR_RE],
    }) as AsyncIterableIterator<{ path: string; isFile: boolean }>;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return out;
    throw err;
  }
  try {
    for await (const e of it) {
      const relFromRoot = relative(projectRoot, e.path).replaceAll("\\", "/");
      const relUnderSubdir = relative(dir, e.path).replaceAll("\\", "/");
      const basename = relUnderSubdir.split("/").pop() ?? "";
      if (SKIP_FILE_RE.test(basename)) continue;
      if (!includeFile(relUnderSubdir)) continue;
      const bytes = await Deno.readFile(e.path);
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      out.push({ rel: relFromRoot, digest });
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return out;
    throw err;
  }
  return out;
}
