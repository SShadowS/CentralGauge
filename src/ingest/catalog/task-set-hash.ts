import { walk } from "jsr:@std/fs@^1.0.0/walk";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { join, relative } from "jsr:@std/path@^1.0.0";

/**
 * True for the `app.json` files that exist ONLY to make VS Code treat a
 * directory as an AL project: `tests/al/app.json` and
 * `tests/al/<difficulty>/app.json`.
 *
 * These are editor configuration, not test content, and they are excluded
 * from the task-set hash so adding or retuning an AL project never forces a
 * re-bench.
 *
 * `tests/al/dependencies/<id>/app.json` is deliberately NOT covered. A prereq
 * manifest carries the app GUID, id ranges and dependency chain — it changes
 * what gets compiled and published, which makes it test content. Excluding it
 * would let a prereq chain edit pass without invalidating the task set, which
 * is exactly the silent drift this hash exists to catch.
 *
 * Path-aware by necessity: `SKIP_FILE_RE` is tested against basenames only
 * (see `collectFiles`), so it cannot distinguish these cases.
 */
export function isEditorOnlyAppJson(relUnderTestsAl: string): boolean {
  if (relUnderTestsAl === "app.json") return true;
  return /^(easy|medium|hard)\/app\.json$/.test(relUnderTestsAl);
}

/**
 * Version tag for the prompt-construction policy used when assembling
 * "diagnose" task prompts (starter code + task description -> LLM prompt).
 *
 * Fed into {@link computeTaskSetHash} as its own framed entry, so bumping
 * this string moves `task_sets.hash` even when no file on disk changed —
 * required because prompt construction logic lives in code, not in a hashed
 * file, and a changed prompt must never share a hash with scores produced
 * under the old prompt. Bump it on every change to how a diagnose prompt is
 * built from `tasks/starter/<id>/**`.
 */
export const PROMPT_POLICY_VERSION = "pp1-diagnose-2026-08-23";

/**
 * Compute a deterministic content hash that defines a task_set snapshot.
 *
 * Scope (relative to projectRoot):
 *   - tasks/**\/* matching {@link TEXT_EXTENSIONS}  (manifests, and starter
 *                                       code for "diagnose" tasks under
 *                                       tasks/starter/<id>/**, e.g. .al files)
 *   - tests/al/**                      (test codeunits, prereq apps,
 *                                       support files — RDLC, layouts, etc.)
 *   - the literal {@link PROMPT_POLICY_VERSION} string (not file content —
 *                                       see "Framing" below)
 *
 * Excluded (build artifacts, regenerable from source):
 *   - any path segment starting with "." (editor/tool state — see collectFiles)
 *   - any directory named ".alpackages" or "output"
 *   - files matching *.app  (compiled AL output)
 *   - files matching cache_*.json  (alpackages cache manifests)
 *   - rad.json and Thumbs.db  (dot-less editor/OS droppings — see SKIP_FILE_RE)
 *   - tests/al/app.json and tests/al/<difficulty>/app.json (editor configuration)
 *   - files under tasks/** whose extension is not in TEXT_EXTENSIONS
 *
 * Framing (binary-safe):
 *   For each file, compute its SHA-256 separately, then feed
 *     u32-be(pathLen) || pathBytes || file_sha256(32 bytes)
 *   into the outer SHA-256. Per-file digests are fixed length, so framing
 *   cannot be ambiguated by file content (unlike the previous NUL-delimited
 *   concat which could collide on binary support files).
 *
 *   The prompt-policy version is fed FIRST, as its own frame, before any
 *   file frames:
 *     u32-be(labelLen) || labelBytes
 *   where labelBytes = utf8("policy:" + policyVersion). There is no
 *   trailing content-digest section for this frame — unlike a file frame,
 *   the "content" (the version string) is already fully and unambiguously
 *   encoded inside the length-prefixed label itself, so a separate digest
 *   would be redundant. Feeding it first means every prompt-policy bump
 *   moves the hash regardless of what files exist on disk.
 */
export async function computeTaskSetHash(
  projectRoot: string,
  policyVersion: string = PROMPT_POLICY_VERSION,
): Promise<string> {
  // tasks/ is the canonical project marker — its absence means we're not
  // inside a CentralGauge checkout. tests/al/ is optional (test harnesses
  // and minimal repos may omit it).
  await Deno.stat(join(projectRoot, "tasks"));
  const tasksFiles = await collectFiles(
    projectRoot,
    "tasks",
    (rel) => TEXT_EXTENSIONS.some((ext) => rel.endsWith(ext)),
  );
  const alFiles = await collectFiles(
    projectRoot,
    "tests/al",
    (rel) => !isEditorOnlyAppJson(rel),
  );
  const all = [...tasksFiles, ...alFiles].sort((a, b) =>
    a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
  );

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];

  // Policy-version frame — see "Framing" in the doc comment above.
  const policyLabelBytes = enc.encode(`policy:${policyVersion}`);
  const policyLenBuf = new Uint8Array(4);
  new DataView(policyLenBuf.buffer).setUint32(
    0,
    policyLabelBytes.length,
    false,
  );
  chunks.push(policyLenBuf);
  chunks.push(policyLabelBytes);

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
  /** SHA-256 of file content (32 bytes), after text normalization if applicable. */
  digest: Uint8Array;
}

const SKIP_DIR_RE = /(^|[\\/])(\.alpackages|output)([\\/]|$)/;

/**
 * Basenames that are never task content.
 *
 * - `*.app` — compiled AL output.
 * - `cache_*.json` — alpackages cache manifests.
 * - `rad.json` — the AL extension's Rapid Application Development state,
 *   written into an AL project root by a RAD publish. NO dot segment, so
 *   {@link hasDotSegment} does not catch it, and it is gitignored — the exact
 *   invisible-drift combination that skip exists to prevent, one door along.
 * - `Thumbs.db` — Windows Explorer writes it into any directory it renders
 *   image thumbnails for, which includes `tests/al/support-files/`. Same
 *   shape: no dot segment, globally gitignored.
 *
 * The rule for adding here: gitignored (so `git status` cannot warn) AND
 * incapable of being real task content. Both halves matter — excluding
 * something an author might legitimately ship as a support file would drop it
 * from the hash silently, which is the same class of bug pointing the other
 * way.
 */
const SKIP_FILE_RE = /(\.app|^cache_.*\.json|^rad\.json|^Thumbs\.db)$/;

/**
 * True when any segment of `relUnderSubdir` starts with a dot — the file is
 * editor or tool state, never task content.
 *
 * `tests/al/<difficulty>` is an AL project root, so the AL Language extension
 * and AL Test Runner deposit `.altestrunner/`, `.vscode/` and friends there
 * while an oracle is being authored. `.altestrunner/` is globally gitignored
 * (`.gitignore`), which is exactly what makes it dangerous here: it never
 * shows up in `git status`, so without this skip it would move
 * `task_sets.hash` silently on the authoring machine and every bench run
 * would record a hash no clean checkout can reproduce.
 *
 * Same rule `assertVerdictIsFresh` applies in `src/workbench/promote.ts` for
 * the same reason, on the draft-side copy of these directories.
 *
 * Segment-wise, not a prefix test on the whole path: a dot only means "tool
 * state" when it starts a path SEGMENT. This also subsumes `.alpackages`,
 * which `SKIP_DIR_RE` still covers independently so that regex stays a
 * standalone statement of the build-artifact rule.
 */
function hasDotSegment(relUnderSubdir: string): boolean {
  return relUnderSubdir.split("/").some((seg) => seg.startsWith("."));
}

/**
 * File extensions whose content is CRLF/LF-normalized before hashing.
 * Restricted to genuinely text formats — a Windows vs. Unix checkout of the
 * same logical content must hash identically for these. Binary formats
 * (.app, .docx, etc.) are hashed RAW: normalizing arbitrary bytes based on a
 * `\r\n` substring match would corrupt binary-safe framing and could even
 * make two DIFFERENT binaries collide.
 */
export const TEXT_EXTENSIONS: readonly string[] = [
  ".yml",
  ".yaml",
  ".al",
  ".json",
  ".xml",
  ".rdlc",
  ".md",
  ".txt",
];

function isTextExtension(basename: string): boolean {
  const dot = basename.lastIndexOf(".");
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.includes(basename.slice(dot).toLowerCase());
}

/** Normalize CRLF -> LF for text extensions only; binary content passes through untouched. */
function normalizeForHash(
  basename: string,
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  if (!isTextExtension(basename)) return bytes;
  const text = new TextDecoder().decode(bytes);
  if (!text.includes("\r\n")) return bytes;
  return new TextEncoder().encode(text.replaceAll("\r\n", "\n"));
}

async function collectFiles(
  projectRoot: string,
  subdir: string,
  includeFile: (relUnderSubdir: string) => boolean,
): Promise<FileEntry[]> {
  const dir = join(projectRoot, subdir);
  const out: FileEntry[] = [];
  let it: AsyncIterableIterator<{ path: string; isFile: boolean }> | undefined;
  try {
    // No `skip` option here: @std/fs walk tests skip regexes against each
    // entry's full (root-inclusive) path. If the checkout itself sits under
    // a directory literally named "output" (e.g. `C:\tmp\output\repo`), that
    // would make every entry match and skip the ENTIRE walk. Instead we
    // filter below using paths relative to `dir`, so only actual
    // `.alpackages`/`output` segments INSIDE the task tree are excluded.
    it = walk(dir, {
      includeDirs: false,
    }) as AsyncIterableIterator<{ path: string; isFile: boolean }>;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return out;
    throw err;
  }
  try {
    for await (const e of it) {
      const relFromRoot = relative(projectRoot, e.path).replaceAll("\\", "/");
      const relUnderSubdir = relative(dir, e.path).replaceAll("\\", "/");
      if (SKIP_DIR_RE.test(relUnderSubdir)) continue;
      if (hasDotSegment(relUnderSubdir)) continue;
      const basename = relUnderSubdir.split("/").pop() ?? "";
      if (SKIP_FILE_RE.test(basename)) continue;
      if (!includeFile(relUnderSubdir)) continue;
      const bytes = await Deno.readFile(e.path);
      const normalized = normalizeForHash(basename, bytes);
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", normalized),
      );
      out.push({ rel: relFromRoot, digest });
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return out;
    throw err;
  }
  return out;
}
