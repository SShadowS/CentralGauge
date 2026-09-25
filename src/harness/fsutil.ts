/**
 * Hostile-artifact containment (spec 1a sections 5 and 7; M1-02 carryover;
 * M0-05 TOCTOU). Callers copy a quiescent source (paused or removed
 * sandbox); the checks below also detect a concurrent writer:
 * - roots: absolute, not drive-relative, canonical spelling;
 * - entries: plain file or directory with a known identity, realPath equal
 *   to join(canonicalParent, name), case-ambiguous siblings refused;
 * - ancestors: identity recorded on entry and re-checked before each open;
 * - files: handle identity equal to the pre-open lstat; bytes counted;
 * - destinations: new or empty, created under a validated parent;
 * - reparse points: one FILE_ATTRIBUTE_REPARSE_POINT scan per freeze
 *   (Windows), entries and ancestors, whatever the tag;
 * - counts: every listed name counts toward maxEntries; violations capped;
 * - redaction: byte-wise on a private copy, never on the live tree.
 */

import { basename, dirname, isAbsolute, join, resolve } from "@std/path";
import { ValidationError } from "../errors.ts";
import { hashTree, isTaskBuildArtifact } from "./hash.ts";

export const FREEZE_VIOLATIONS_FILE = ".cg-freeze-violations.txt";
export const MAX_SCAN_BYTES = 64 * 1024 * 1024;

export interface SecretValue {
  name: string;
  value: string;
}

export interface CopyLimits {
  maxFiles: number;
  maxBytes: number;
  maxDirs: number;
  maxDepth: number;
  /** Every listed name: files, directories, links, skipped and refused entries. */
  maxEntries: number;
}

/** ponytail: fixed limits; make them config when a real task needs more. */
export const DEFAULT_COPY_LIMITS: CopyLimits = {
  maxFiles: 20_000,
  maxBytes: 512 * 1024 * 1024,
  maxDirs: 5_000,
  maxDepth: 24,
  maxEntries: 25_000,
};

export class CopyLimitError extends ValidationError {
  constructor(message: string) {
    super(message, [message]);
    this.name = "CopyLimitError";
  }
}

const DRIVE_RELATIVE = /^[A-Za-z]:(?![\\/])/;
const upperDrive = (p: string) =>
  p.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

/** The exact canonical path of an existing plain directory, or a ValidationError. */
export async function validatedDir(p: string): Promise<string> {
  if (DRIVE_RELATIVE.test(p)) {
    throw new ValidationError(`refusing a drive-relative path: ${p}`, [p]);
  }
  if (!isAbsolute(p)) {
    throw new ValidationError(`refusing a relative path: ${p}`, [p]);
  }
  const abs = upperDrive(resolve(p));
  const real = upperDrive(await Deno.realPath(abs));
  if (real !== abs) {
    throw new ValidationError(
      `refusing a path whose canonical form differs (link, junction, short name or case): ${p} -> ${real}`,
      [p],
    );
  }
  const st = await Deno.lstat(real);
  if (st.isSymlink || !st.isDirectory) {
    throw new ValidationError(`not a plain directory: ${real}`, [real]);
  }
  return real;
}

/** Validate or create a destination directory; ancestors are validated first. */
export async function validatedDest(p: string): Promise<string> {
  if (DRIVE_RELATIVE.test(p) || !isAbsolute(p)) {
    throw new ValidationError(
      `refusing a relative or drive-relative destination: ${p}`,
      [p],
    );
  }
  const abs = upperDrive(resolve(p));
  if (await exists(abs)) return await validatedDir(abs);
  const parent = dirname(abs);
  if (parent === abs) throw new ValidationError(`no such root: ${abs}`, [abs]);
  const created = join(await validatedDest(parent), basename(abs));
  await Deno.mkdir(created);
  return await validatedDir(created);
}

export interface CopyReport {
  files: number;
  bytes: number;
  dirs: number;
  /** Links and special or redirected entries: never copied. */
  refused: string[];
  /** Names that differ only by case from a sibling: never copied. */
  ambiguous: string[];
}

export interface CopyOptions {
  /** Directory paths end with "/", so a `.alpackages/` rule skips the directory itself. */
  skip?: (rel: string, isDir: boolean) => boolean;
  limits?: CopyLimits;
  /** Test seams. */
  beforeOpen?: (rel: string) => Promise<void>;
  afterList?: (rel: string) => Promise<void>;
  listDir?: (dirAbs: string) => Promise<string[]>;
  /** Relative paths refused whatever lstat says (the reparse attribute scan). */
  refuse?: ReadonlySet<string>;
}

/**
 * Sibling names that could alias on some filesystem: an over-approximation.
 * Two names collide when their NFC or NFD forms match under toLowerCase() or
 * toUpperCase() ("straße"/"STRASSE", final and medial sigma). Over-refusing
 * is acceptable; missing a collision is not.
 */
function collidingNames(names: string[]): Set<string> {
  const byKey = new Map<string, Set<string>>();
  for (const n of names) {
    for (const f of ["NFC", "NFD"]) {
      const m = n.normalize(f);
      for (const k of [`l:${m.toLowerCase()}`, `u:${m.toUpperCase()}`]) {
        byKey.set(k, (byKey.get(k) ?? new Set()).add(n));
      }
    }
  }
  const out = new Set<string>();
  for (const group of byKey.values()) {
    if (group.size > 1) { for (const n of group) out.add(n); }
  }
  return out;
}

interface DirId {
  path: string;
  ino: number;
  dev: number;
}

async function listNames(dirAbs: string): Promise<string[]> {
  const names: string[] = [];
  for await (const e of Deno.readDir(dirAbs)) names.push(e.name);
  return names;
}

/** ponytail: O(depth) re-check per file; fine for workspace depths (limit 24). */
async function checkChain(chain: DirId[]): Promise<void> {
  for (const c of chain) {
    const s = await Deno.lstat(c.path);
    if (
      s.isSymlink || !s.isDirectory || s.ino !== c.ino || s.dev !== c.dev ||
      upperDrive(await Deno.realPath(c.path)) !== c.path
    ) {
      throw new ValidationError(
        `directory changed identity during the copy: ${c.path}`,
        [c.path],
      );
    }
  }
}

export async function safeCopyTree(
  src: string,
  dst: string,
  opts: CopyOptions = {},
): Promise<CopyReport & { src: string; dst: string }> {
  const limits = opts.limits ?? DEFAULT_COPY_LIMITS;
  const root = await validatedDir(src);
  const out = await validatedDest(dst);
  for await (const _ of Deno.readDir(out)) {
    throw new ValidationError(`destination is not empty: ${out}`, [out]);
  }
  const rootSt = await Deno.lstat(root);
  if (rootSt.ino === null || rootSt.dev === null) {
    throw new ValidationError(
      `cannot verify directory identity on this filesystem: ${root}`,
      [root],
    );
  }
  const r: CopyReport = {
    files: 0,
    bytes: 0,
    dirs: 0,
    refused: [],
    ambiguous: [],
  };
  const buf = new Uint8Array(64 * 1024);
  let entries = 0;

  const walk = async (
    dirAbs: string,
    rel: string,
    depth: number,
    chain: DirId[],
  ): Promise<void> => {
    if (depth > limits.maxDepth) {
      throw new CopyLimitError(`${root}: deeper than ${limits.maxDepth}`);
    }
    const tooMany = () =>
      new CopyLimitError(`${root}: more than ${limits.maxEntries} entries`);
    let names: string[] = [];
    if (opts.listDir) {
      names = await opts.listDir(dirAbs);
      entries += names.length;
      if (entries > limits.maxEntries) throw tooMany();
    } else {
      // Counted while reading: a huge directory is refused before it is buffered.
      for await (const e of Deno.readDir(dirAbs)) {
        if (++entries > limits.maxEntries) throw tooMany();
        names.push(e.name);
      }
    }
    await opts.afterList?.(rel);
    const colliding = collidingNames(names);
    for (const name of [...names].sort()) {
      const r1 = rel ? `${rel}/${name}` : name;
      if (colliding.has(name)) {
        r.ambiguous.push(r1);
        continue;
      }
      if (opts.refuse?.has(r1)) {
        r.refused.push(r1);
        continue;
      }
      const p = join(dirAbs, name);
      const st = await Deno.lstat(p).catch(() => null);
      if (!st || st.isSymlink || (!st.isFile && !st.isDirectory)) {
        r.refused.push(r1);
        continue;
      }
      if (upperDrive(await Deno.realPath(p)) !== p) {
        r.refused.push(r1);
        continue;
      }
      if (st.ino === null || st.dev === null) {
        throw new ValidationError(
          `cannot verify identity on this filesystem: ${p}`,
          [p],
        );
      }
      if (opts.skip?.(st.isDirectory ? `${r1}/` : r1, st.isDirectory)) {
        continue;
      }
      const target = join(out, ...r1.split("/"));
      if (st.isDirectory) {
        if (++r.dirs > limits.maxDirs) {
          throw new CopyLimitError(
            `${root}: more than ${limits.maxDirs} directories`,
          );
        }
        await Deno.mkdir(target);
        await walk(p, r1, depth + 1, [...chain, {
          path: p,
          ino: st.ino,
          dev: st.dev,
        }]);
        continue;
      }
      if (++r.files > limits.maxFiles) {
        throw new CopyLimitError(`${root}: more than ${limits.maxFiles} files`);
      }
      await opts.beforeOpen?.(r1);
      await checkChain(chain);
      const f = await Deno.open(p, { read: true });
      try {
        const hs = await f.stat();
        if (!hs.isFile || hs.ino !== st.ino || hs.dev !== st.dev) {
          throw new ValidationError(
            `file changed identity between check and open: ${r1}`,
            [r1],
          );
        }
        const w = await Deno.open(target, { write: true, createNew: true });
        try {
          for (;;) {
            const n = await f.read(buf);
            if (n === null) break;
            r.bytes += n;
            if (r.bytes > limits.maxBytes) {
              throw new CopyLimitError(
                `${root}: more than ${limits.maxBytes} bytes`,
              );
            }
            let off = 0;
            while (off < n) off += await w.write(buf.subarray(off, n));
          }
        } finally {
          w.close();
        }
      } finally {
        f.close();
      }
    }
  };
  await walk(root, "", 0, [{ path: root, ino: rootSt.ino, dev: rootSt.dev }]);
  return { ...r, src: root, dst: out };
}

const utf16le = (s: string) => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 * i] = c & 0xff;
    out[2 * i + 1] = c >> 8;
  }
  return out;
};

function replaceAll(
  data: Uint8Array,
  needle: Uint8Array,
  repl: Uint8Array,
): { out: Uint8Array; count: number } {
  const parts: Uint8Array[] = [];
  let count = 0;
  let from = 0;
  let i = 0;
  // ponytail: naive scan; secrets are short and files are bounded by MAX_SCAN_BYTES.
  while (i + needle.length <= data.length) {
    let k = 0;
    while (k < needle.length && data[i + k] === needle[k]) k++;
    if (k === needle.length) {
      parts.push(data.subarray(from, i), repl);
      count++;
      i += needle.length;
      from = i;
    } else i++;
  }
  if (count === 0) return { out: data, count };
  parts.push(data.subarray(from));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return { out, count };
}

/** Replace every secret (UTF-8 and UTF-16LE forms), longest first. */
export function redactBytes(
  data: Uint8Array,
  secrets: SecretValue[],
): { out: Uint8Array; count: number } {
  const enc = new TextEncoder();
  let out = data;
  let count = 0;
  for (
    const s of [...secrets].filter((x) => x.value.length > 0).sort((a, b) =>
      b.value.length - a.value.length
    )
  ) {
    const mark = `[REDACTED:${s.name}]`;
    for (
      const [needle, repl] of [[enc.encode(s.value), enc.encode(mark)], [
        utf16le(s.value),
        utf16le(mark),
      ]]
    ) {
      const r = replaceAll(out, needle!, repl!);
      out = r.out;
      count += r.count;
    }
  }
  return { out, count };
}

/** Redact a private tree in place; files larger than maxScanBytes are removed and reported. */
export async function redactTree(
  dir: string,
  secrets: SecretValue[],
  maxScanBytes = MAX_SCAN_BYTES,
): Promise<{ count: number; violations: string[] }> {
  const root = await validatedDir(dir);
  let count = 0;
  const violations: string[] = [];
  const visit = async (d: string, rel: string): Promise<void> => {
    for (const name of (await listNames(d)).sort()) {
      const p = join(d, name);
      const r1 = rel ? `${rel}/${name}` : name;
      const st = await Deno.lstat(p);
      if (st.isDirectory) await visit(p, r1);
      else if (st.size > maxScanBytes) {
        await Deno.remove(p);
        violations.push(
          `file larger than ${maxScanBytes} bytes cannot be scanned for secrets: ${r1}`,
        );
      } else {
        const r = redactBytes(await Deno.readFile(p), secrets);
        if (r.count > 0) {
          count += r.count;
          await Deno.writeFile(p, r.out);
        }
      }
    }
  };
  await visit(root, "");
  return { count, violations };
}

/** Replace every secret in a string, longest first. */
function redactString(text: string, secrets: SecretValue[]): string {
  let out = text;
  for (
    const x of [...secrets].filter((y) => y.value.length > 0).sort((a, b) =>
      b.value.length - a.value.length
    )
  ) {
    out = out.replaceAll(x.value, `[REDACTED:${x.name}]`);
  }
  return out;
}

/** Remove entries of a private tree whose name contains a secret; report them with the name redacted. */
async function dropSecretNames(
  dir: string,
  secrets: SecretValue[],
): Promise<string[]> {
  const out: string[] = [];
  const visit = async (d: string, rel: string): Promise<void> => {
    for (const name of await listNames(d)) {
      const r1 = rel ? `${rel}/${name}` : name;
      const p = join(d, name);
      // The whole relative path, in both separator spellings: a secret that
      // contains a separator can be spread over several path components.
      const hit = [r1, r1.replaceAll("/", "\\")].find((q) =>
        secrets.some((x) => x.value.length > 0 && q.includes(x.value))
      );
      if (hit !== undefined) {
        await Deno.remove(p, { recursive: true });
        out.push(`name contains a secret: ${redactString(hit, secrets)}`);
      } else if ((await Deno.lstat(p)).isDirectory) await visit(p, r1);
    }
  };
  await visit(dir, "");
  return out;
}

export interface FreezeInput {
  resultsRoot: string;
  /** Harness-private area outside results/ (M1-22 privateRoot). */
  privateRoot: string;
  /** Quiescent: the sandbox is confirmed gone. */
  workspace: string;
  secrets: SecretValue[];
  limits?: CopyLimits;
  maxScanBytes?: number;
}

export interface Frozen {
  workspace_hash: string;
  /** Relative to resultsRoot, e.g. workspaces/<hash>. */
  stored_path: string;
  violations: string[];
  redactions: number;
}

/**
 * Freeze: private copy (build artifacts dropped, D10) -> byte-wise redaction
 * -> violations marker (hashed, fails the build scorer, spec 1a section 7)
 * -> hash -> publish under results/harness/workspaces/<hash>.
 */
export async function freezeWorkspace(i: FreezeInput): Promise<Frozen> {
  try {
    return await freezeInner(i);
  } catch (err) {
    // Error texts name untrusted paths; a caller may log or persist them.
    const r = (t: string) => redactString(t, i.secrets);
    if (err instanceof CopyLimitError) throw new CopyLimitError(r(err.message));
    if (err instanceof ValidationError) {
      throw new ValidationError(
        r(err.message),
        err.errors.map(r),
        err.warnings.map(r),
      );
    }
    throw new Error(
      r(err instanceof Error ? `${err.name}: ${err.message}` : String(err)),
    );
  }
}

/** Upper bound for the violations marker (MAX_VIOLATIONS lines of at most MAX_VIOLATION_CHARS). */
const MARKER_OVERHEAD_BYTES = 1024 * 1024;

/**
 * Limits for the publish copy of the private scratch: the freeze limits plus
 * what the harness itself adds (the marker file, and redaction markers that
 * can be longer than the secret they replace). Bounded, never Infinity.
 */
function publishLimits(
  limits: CopyLimits,
  secrets: SecretValue[],
  redactions: number,
): CopyLimits {
  const enc = new TextEncoder();
  const growth = Math.max(
    0,
    ...secrets.map((x) => {
      const mark = `[REDACTED:${x.name}]`;
      return Math.max(
        enc.encode(mark).length - enc.encode(x.value).length,
        2 * (mark.length - x.value.length),
      );
    }),
  );
  return {
    maxFiles: limits.maxFiles + 1,
    maxBytes: limits.maxBytes + redactions * growth + MARKER_OVERHEAD_BYTES,
    maxDirs: limits.maxDirs,
    maxDepth: limits.maxDepth,
    maxEntries: limits.maxEntries + 1,
  };
}

/** Violations kept in the marker and the returned list; the rest are counted. */
export const MAX_VIOLATIONS = 100;
const MAX_VIOLATION_CHARS = 1000;

/** Redact first, then truncate: truncating first could leave half a secret. */
function capViolations(violations: string[], secrets: SecretValue[]): string[] {
  const out = violations.slice(0, MAX_VIOLATIONS).map((v) =>
    redactString(v, secrets).slice(0, MAX_VIOLATION_CHARS)
  );
  const more = violations.length - MAX_VIOLATIONS;
  if (more > 0) out.push(`and ${more} more`);
  return out;
}

export interface ReparseScan {
  /** Reparse points above or at the root (full paths). */
  ancestors: string[];
  /** Reparse points inside the root, relative with "/". */
  entries: string[];
  /** Entries enumerated; stops at maxEntries + 1. */
  seen: number;
  /** True when the scan stopped at the entry cap: the tree is refused. */
  capped: boolean;
}

// One line per finding, emitted while enumerating; the enumeration stops the
// moment the running count exceeds the cap, so work never grows past it.
const REPARSE_SCAN_PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$max = [int64]$env:CG_SCAN_MAX
$item = Get-Item -LiteralPath $env:CG_SCAN_ROOT -Force
"R $($item.FullName)"
$p = $item
while ($p) {
  if ($p.Attributes -band [IO.FileAttributes]::ReparsePoint) { "A $($p.FullName)" }
  $p = $p.Parent
}
$n = 0
Get-ChildItem -LiteralPath $item.FullName -Recurse -Force | ForEach-Object {
  $n++
  if ($n -gt $max) { "CAP $n"; exit 0 }
  if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { "E $($_.FullName)" }
}
"N $n"
`;

/**
 * One FILE_ATTRIBUTE_REPARSE_POINT scan of a tree and its ancestors (Windows).
 * The attribute, not the tag, decides: non-redirecting tags that realPath
 * resolves to themselves are caught here; isSymlink and realPath stay as the
 * second layer. The scan stops once more than maxEntries entries are seen.
 * Any scan failure is an error (fail closed). Elsewhere symlinks are the only
 * link kind and lstat catches them, so the scan is empty.
 */
export async function scanReparsePoints(
  root: string,
  maxEntries: number = DEFAULT_COPY_LIMITS.maxEntries,
): Promise<ReparseScan> {
  if (Deno.build.os !== "windows") {
    return { ancestors: [], entries: [], seen: 0, capped: false };
  }
  const out = await new Deno.Command("pwsh", {
    args: ["-NoProfile", "-NonInteractive", "-Command", REPARSE_SCAN_PS],
    env: { CG_SCAN_ROOT: root, CG_SCAN_MAX: String(maxEntries) },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new ValidationError(`reparse point scan failed: ${root}`, [
      new TextDecoder().decode(out.stderr).trim(),
    ]);
  }
  const s: ReparseScan = {
    ancestors: [],
    entries: [],
    seen: -1,
    capped: false,
  };
  let prefix = "";
  for (const line of new TextDecoder().decode(out.stdout).split(/\r?\n/)) {
    const [tag, rest] = [
      line.slice(0, line.indexOf(" ")),
      line.slice(line.indexOf(" ") + 1),
    ];
    if (tag === "R") prefix = rest.replace(/\\$/, "") + "\\";
    else if (tag === "A") s.ancestors.push(rest);
    else if (tag === "E") {
      if (!prefix || !rest.startsWith(prefix)) {
        throw new ValidationError(
          `reparse scan returned a path outside ${root}`,
          [rest],
        );
      }
      s.entries.push(rest.slice(prefix.length).replaceAll("\\", "/"));
    } else if (tag === "N" || tag === "CAP") {
      s.seen = Number(rest);
      s.capped = tag === "CAP";
    }
  }
  if (!prefix || s.seen < 0) {
    throw new ValidationError(`reparse point scan gave no result: ${root}`, [
      root,
    ]);
  }
  return s;
}

async function freezeInner(i: FreezeInput): Promise<Frozen> {
  const limits = i.limits ?? DEFAULT_COPY_LIMITS;
  const scratch = join(
    await validatedDest(join(i.privateRoot, "freeze")),
    crypto.randomUUID(),
  );
  const base = await validatedDest(join(i.resultsRoot, "workspaces"));
  const tmpDir = join(base, `.tmp-${crypto.randomUUID()}`);
  try {
    const violations: string[] = [];
    const ws = await validatedDir(i.workspace);
    const scan = await scanReparsePoints(ws, limits.maxEntries);
    if (scan.ancestors.length > 0) {
      throw new ValidationError(
        `reparse point at or above the workspace: ${scan.ancestors.join(", ")}`,
        scan.ancestors,
      );
    }
    try {
      if (scan.capped) {
        throw new CopyLimitError(
          `${ws}: more than ${limits.maxEntries} entries`,
        );
      }
      const r = await safeCopyTree(ws, scratch, {
        skip: isTaskBuildArtifact,
        limits,
        refuse: new Set(scan.entries),
      });
      violations.push(
        ...r.refused.map((p) => `link, reparse point or special file: ${p}`),
      );
      violations.push(...r.ambiguous.map((p) => `case-ambiguous name: ${p}`));
    } catch (err) {
      if (!(err instanceof CopyLimitError)) throw err;
      await Deno.remove(scratch, { recursive: true }).catch(() => {});
      await validatedDest(scratch);
      violations.push(`size limit: ${err.message}`);
    }
    const red = await redactTree(
      scratch,
      i.secrets,
      i.maxScanBytes ?? MAX_SCAN_BYTES,
    );
    violations.push(...red.violations);
    violations.push(...await dropSecretNames(scratch, i.secrets));
    // Violations are built from untrusted names: redact them before they are
    // written, hashed or returned to a caller that may persist them.
    const redacted = capViolations(violations, i.secrets);
    if (redacted.length > 0) {
      await Deno.writeTextFile(
        join(scratch, FREEZE_VIOLATIONS_FILE),
        redacted.join("\n") + "\n",
      );
    }
    const workspace_hash = await hashTree(scratch, "task");
    const stored_path = `workspaces/${workspace_hash}`;
    // ponytail: exists-then-rename; the bench lock makes the runner the only writer.
    if (!await exists(join(base, workspace_hash))) {
      await safeCopyTree(scratch, tmpDir, {
        limits: publishLimits(limits, i.secrets, red.count),
      });
      await Deno.rename(tmpDir, join(base, workspace_hash));
    }
    return {
      workspace_hash,
      stored_path,
      violations: redacted,
      redactions: red.count,
    };
  } finally {
    await Deno.remove(scratch, { recursive: true }).catch(() => {});
    await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
  }
}

export async function sweepWorkspaceTemp(
  resultsRoot: string,
  privateRoot: string,
): Promise<number> {
  let removed = 0;
  const sweep = async (dir: string, match: (name: string) => boolean) => {
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!match(e.name)) continue;
        await Deno.remove(join(dir, e.name), { recursive: true });
        removed++;
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  };
  await sweep(join(resultsRoot, "workspaces"), (n) => n.startsWith(".tmp-"));
  await sweep(join(privateRoot, "freeze"), () => true);
  return removed;
}
