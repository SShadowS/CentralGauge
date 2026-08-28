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

const TASKS_STARTER_PREFIX = "starter/";

/**
 * True for a path relative to `tasks/` that lives under `tasks/starter/**`
 * — the per-task starter-code tree for "diagnose" benchmark tasks (see
 * `src/tasks/starter-code.ts`).
 *
 * Only files under this prefix get the widened {@link TEXT_EXTENSIONS}
 * treatment in {@link computeTaskSetHash}; everywhere else under `tasks/`
 * keeps the original `.yml`-only rule. Without this scoping, dropping a
 * `README.md` or notes file anywhere under `tasks/` would silently move
 * `task_sets.hash` and force a re-bench for content that isn't a manifest
 * or starter code.
 */
function isUnderTasksStarter(relUnderTasks: string): boolean {
  return relUnderTasks.startsWith(TASKS_STARTER_PREFIX);
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
 *   - tasks/**\/*.yml                  (manifests)
 *   - tasks/starter/<id>/** matching {@link TEXT_EXTENSIONS}, case-insensitive
 *                                       (starter code for "diagnose" tasks —
 *                                       see {@link isUnderTasksStarter})
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
 *   - non-.yml files anywhere under tasks/** OUTSIDE tasks/starter/ (e.g. a
 *     README dropped into tasks/ — deliberately narrow so it can't silently
 *     move the hash and force a re-bench)
 *   - files under tasks/starter/** whose extension is not in TEXT_EXTENSIONS
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
    (rel) => {
      if (rel.endsWith(".yml")) return true;
      if (!isUnderTasksStarter(rel)) return false;
      const basename = rel.split("/").pop() ?? "";
      return isTextExtension(basename);
    },
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
/**
 * Strip a task manifest's `provenance:` block before hashing.
 *
 * Provenance records who authored a task, when, and the contamination canary.
 * None of it reaches a model: the rendered prompt is built from `description`
 * and the template, so a top-level `provenance:` key is invisible at eval time
 * while remaining visible to anyone scraping the repo — which is exactly what a
 * canary must be.
 *
 * It therefore must not move `task_sets.hash`. Stamping provenance across 200+
 * manifests would otherwise invalidate every published score for metadata that
 * cannot change a single verdict, and the same reasoning is already applied to
 * `tests/al/app.json` (editor-only) and to non-`.yml` files under `tasks/` —
 * see {@link isUnderTasksStarter}'s note about a stray README forcing a
 * re-bench.
 *
 * Excision is line-based on purpose. A YAML round-trip through a parser would
 * reorder keys and reformat scalars, changing the digest for reasons unrelated
 * to content; slicing from a column-0 `provenance:` to the next column-0 key
 * leaves every other byte exactly as authored.
 */
/** A column-0 `provenance:` key on its own line. Multiline so it can gate raw text. */
const PROVENANCE_KEY_RE = /^provenance:[ \t]*\r?$/m;

function stripProvenanceBlock(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^provenance:\s*$/.test(l));
  if (start < 0) return text;
  let end = start + 1;
  // A block member is indented or blank; the block ends at the next line that
  // starts in column 0 with content.
  while (
    end < lines.length && (lines[end]!.trim() === "" || /^\s/.test(lines[end]!))
  ) {
    end++;
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

function normalizeForHash(
  basename: string,
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  if (!isTextExtension(basename)) return bytes;
  const raw = new TextDecoder().decode(bytes);
  const hadCrlf = raw.includes("\r\n");
  const hadProvenance = basename.endsWith(".yml") &&
    PROVENANCE_KEY_RE.test(raw);
  if (!hadCrlf && !hadProvenance) return bytes;
  // CRLF -> LF FIRST, then excise. stripProvenanceBlock is line-based and
  // splits on "\n", so against CRLF text every line still carries a trailing
  // "\r" — including the blank line that precedes the block. Slicing the block
  // out then leaves that orphan "\r" as the file's last byte, which the later
  // "\r\n" -> "\n" pass cannot see (there is no "\n" after it). That moved
  // task_sets.hash on exactly the 49 CRLF manifests when provenance was first
  // stamped; the order below is the fix, not an incidental tidy-up.
  let text = hadCrlf ? raw.replaceAll("\r\n", "\n") : raw;
  if (hadProvenance) text = stripProvenanceBlock(text);
  return new TextEncoder().encode(text);
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
