/**
 * Snapshot a harness results root with a fail-closed secret scan (M6-03).
 * Usage:
 *   deno run --allow-all scripts/harness/freeze-archive.ts pack <resultsRoot> <outDir> --secret-file <f>... [--meta k=v]...
 *   deno run --allow-all scripts/harness/freeze-archive.ts verify <outDir>
 *   deno run --allow-all scripts/harness/freeze-archive.ts bind <outDir> <file>...
 * Exit: 0 clean, 1 secret hit, verify problem or bind conflict, 2 any
 * operational or unexpected failure.
 *
 * Secret files hold one value per line (trimmed, blank lines skipped, each at
 * least 8 characters). Each value is searched in file contents and archive
 * paths as UTF-8, UTF-16LE, standard and URL-safe base64 (all three byte
 * alignments) and percent-encoding. Values are never printed or written.
 * The scan covers the secret values on disk plus the key patterns; it is not
 * proof that every historical credential value is absent.
 *
 * Publish is atomic: the archive is built in a sibling temp dir, freeze.json
 * is written last, files are fsynced, and the temp dir is renamed to outDir.
 */

import { createHash } from "node:crypto";
import { parseArgs } from "@std/cli/parse-args";
import { walk } from "@std/fs/walk";
import { basename, dirname, join, relative, resolve } from "@std/path";
import * as colors from "@std/fmt/colors";
import { utf16le } from "../../src/harness/fsutil.ts";

/** Everything that is not a finding: I/O, bad input, a link. Exit 2. */
export class OperationalError extends Error {}
/** A secret hit or a bind conflict. Exit 1. */
export class FindingError extends Error {}

const PATTERNS = [
  "sk-or-v1-[A-Za-z0-9]{20,}",
  "sk-ant-oat01-[A-Za-z0-9_-]{20,}",
];
const SUMS = "SHA256SUMS";
const FREEZE = "freeze.json";
const DERIVED = "derived.json";
const MIN_SECRET = 8;
const CHUNK = 1 << 20;

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const posix = (p: string) => p.replaceAll("\\", "/");
const enc = new TextEncoder();
const latin1 = new TextDecoder("latin1");

function contains(hay: Uint8Array, needle: Uint8Array): boolean {
  const first = needle[0];
  if (first === undefined) return false;
  let i = hay.indexOf(first);
  while (i !== -1 && i + needle.length <= hay.length) {
    let j = 1;
    while (j < needle.length && hay[i + j] === needle[j]) j++;
    if (j === needle.length) return true;
    i = hay.indexOf(first, i + 1);
  }
  return false;
}

/** Relative posix paths of every file under root; any link refuses. */
async function files(root: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const e of walk(root, { followSymlinks: false })) {
      const rel = posix(relative(root, e.path));
      if (e.isSymlink) {
        throw new OperationalError(`link or reparse point refused: ${rel}`);
      }
      if (e.isFile) out.push(rel);
    }
  } catch (e) {
    if (e instanceof OperationalError) throw e;
    throw new OperationalError(
      `cannot read tree ${root}: ${(e as Error).message}`,
    );
  }
  return out.sort();
}

/**
 * Base64 of v at byte offset k mod 3, keeping only the characters that
 * depend on v alone (those shared with a neighbouring byte are dropped).
 */
function base64Aligned(v: Uint8Array, k: number): string {
  const n = v.length + k;
  const b = new Uint8Array(n);
  b.set(v, k);
  return btoa(String.fromCharCode(...b)).slice(
    [0, 2, 3][k],
    Math.floor((8 * n) / 6),
  );
}

type Secret = { name: string; forms: string[]; needles: Uint8Array[] };

/** UTF-8, UTF-16LE, base64 (std and URL-safe, 3 alignments), percent-encoded. */
function secretForms(
  value: string,
): { forms: string[]; needles: Uint8Array[] } {
  const u8 = enc.encode(value);
  const forms = new Set<string>([value]);
  for (const k of [0, 1, 2]) {
    const b = base64Aligned(u8, k);
    forms.add(b);
    forms.add(b.replaceAll("+", "-").replaceAll("/", "_"));
  }
  const pct = encodeURIComponent(value);
  forms.add(pct);
  forms.add(pct.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()));
  return {
    forms: [...forms],
    needles: [...[...forms].map((f) => enc.encode(f)), utf16le(value)],
  };
}

function hitSecrets(bytes: Uint8Array, secrets: Secret[]): Secret[] {
  return secrets.filter((s) => s.needles.some((n) => contains(bytes, n)));
}

function hitPatterns(bytes: Uint8Array): string[] {
  const text = latin1.decode(bytes);
  return PATTERNS.filter((p) => new RegExp(p).test(text));
}

async function readSecrets(secretFiles: string[]): Promise<Secret[]> {
  const out: Secret[] = [];
  for (const f of secretFiles) {
    const name = basename(f);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        await Deno.readFile(f),
      );
    } catch {
      throw new OperationalError(`cannot read secret file: ${name}`);
    }
    const values = text.split(/\r?\n/).map((l) => l.trim()).filter((l) =>
      l !== ""
    );
    if (values.length === 0) {
      throw new OperationalError(`empty secret file (no values): ${name}`);
    }
    values.forEach((v, i) => {
      if (v.startsWith("REPLACE_ME")) {
        throw new OperationalError(`placeholder secret file: ${name}`);
      }
      if (v.length < MIN_SECRET) {
        throw new OperationalError(
          `value on non-blank line ${
            i + 1
          } of ${name} is shorter than ${MIN_SECRET} characters`,
        );
      }
    });
    for (const v of values) out.push({ name, ...secretForms(v) });
  }
  // A secret file name that holds a value is not printed either.
  for (const s of out) {
    if (hitSecrets(enc.encode(s.name), out).length > 0) {
      s.name = "<secret file name withheld>";
    }
  }
  return out;
}

/** Replace every searched form of every value in a message. */
function scrub(msg: string, secrets: Secret[]): string {
  let out = msg;
  const forms = secrets.flatMap((s) => s.forms).sort((a, b) =>
    b.length - a.length
  );
  for (const f of forms) out = out.replaceAll(f, "<withheld>");
  return out;
}

async function writeSynced(p: string, bytes: Uint8Array): Promise<void> {
  const f = await Deno.open(p, { write: true, createNew: true });
  try {
    let off = 0;
    while (off < bytes.length) off += await f.write(bytes.subarray(off));
    await f.sync();
  } finally {
    f.close();
  }
}

/**
 * Hash and scan one archived file in chunks, then fsync it. The carry-over
 * between windows is at least the longest needle, so a hit across a chunk
 * boundary is still seen.
 */
async function scanFile(
  p: string,
  secrets: Secret[],
  chunkSize: number,
  overlap: number,
): Promise<{ sha: string; hits: Set<string> }> {
  const hash = createHash("sha256");
  const hits = new Set<string>();
  const f = await Deno.open(p, { read: true, write: true });
  try {
    const buf = new Uint8Array(chunkSize);
    let carry = new Uint8Array(0);
    for (;;) {
      const n = await f.read(buf);
      if (n === null) break;
      const data = buf.subarray(0, n);
      hash.update(data);
      const win = new Uint8Array(carry.length + n);
      win.set(carry);
      win.set(data, carry.length);
      for (const s of hitSecrets(win, secrets)) hits.add(s.name);
      for (const pat of hitPatterns(win)) hits.add(`pattern ${pat}`);
      carry = win.slice(Math.max(0, win.length - overlap));
    }
    await f.sync();
  } finally {
    f.close();
  }
  return { sha: hash.digest("hex"), hits };
}

type PackOpts = {
  meta: Record<string, string>;
  secretFiles: string[];
  /** Scan chunk size in bytes; tests use a tiny one. */
  chunkSize?: number;
  /** Test hook: runs after freeze.json is written, before the rename. */
  onBeforeRename?: () => void | Promise<void>;
};

export async function pack(
  resultsRoot: string,
  outDir: string,
  opts: PackOpts,
): Promise<{ files: number; sumsSha256: string }> {
  const secrets = await readSecrets(opts.secretFiles);
  try {
    return await packScanned(resultsRoot, outDir, secrets, opts);
  } catch (e) {
    // I/O messages carry paths; a path can hold a value.
    const msg = scrub((e as Error).message, secrets);
    throw e instanceof FindingError
      ? new FindingError(msg)
      : new OperationalError(msg);
  }
}

async function packScanned(
  resultsRoot: string,
  outDir: string,
  secrets: Secret[],
  opts: PackOpts,
): Promise<{ files: number; sumsSha256: string }> {
  const meta = enc.encode(Object.entries(opts.meta).flat().join("\n"));
  if (hitSecrets(meta, secrets).length > 0 || hitPatterns(meta).length > 0) {
    throw new FindingError("secret found in --meta (withheld)");
  }
  try {
    await Deno.lstat(outDir);
    throw new OperationalError(`outDir exists: ${outDir}`);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const list = await files(resultsRoot);
  const chunkSize = opts.chunkSize ?? CHUNK;
  const overlap = Math.max(
    64, // longer than the patterns' shortest match
    ...secrets.flatMap((s) => s.needles.map((n) => n.length)),
  );
  await Deno.mkdir(dirname(outDir), { recursive: true });
  const tmp = join(
    dirname(outDir),
    `.${basename(outDir)}.tmp-${crypto.randomUUID().slice(0, 8)}`,
  );
  await Deno.mkdir(tmp);
  try {
    const hits: string[] = [];
    const sums: string[] = [];
    for (const rel of list) {
      const dest = join(tmp, "results", rel);
      await Deno.mkdir(dirname(dest), { recursive: true });
      await Deno.copyFile(join(resultsRoot, rel), dest);
      const relBytes = enc.encode(rel);
      const pathHits = [
        ...hitSecrets(relBytes, secrets).map((s) => s.name),
        ...hitPatterns(relBytes).map((p) => `pattern ${p}`),
      ];
      const shown = pathHits.length > 0 ? "<path withheld>" : rel;
      const r = await scanFile(dest, secrets, chunkSize, overlap);
      for (const h of new Set([...pathHits, ...r.hits])) {
        hits.push(`${shown} (${h})`);
      }
      sums.push(`${r.sha}  ${rel}`);
    }
    if (hits.length > 0) {
      throw new FindingError(
        `secret found in archived files: ${hits.join(", ")}`,
      );
    }
    const sumsBytes = enc.encode(sums.join("\n") + "\n");
    await writeSynced(join(tmp, SUMS), sumsBytes);
    const sumsSha256 = await sha256(sumsBytes);
    const freeze = {
      v: 1,
      created_at: new Date().toISOString(),
      files: list.length,
      sums_sha256: sumsSha256,
      meta: opts.meta,
      scan: {
        secret_files: opts.secretFiles.length,
        patterns: PATTERNS,
        hits: 0,
      },
    };
    await writeSynced(
      join(tmp, FREEZE),
      enc.encode(JSON.stringify(freeze, null, 2) + "\n"),
    );
    await opts.onBeforeRename?.();
    await Deno.rename(tmp, outDir);
    return { files: list.length, sumsSha256 };
  } catch (e) {
    try {
      await Deno.remove(tmp, { recursive: true });
    } catch {
      throw new OperationalError(
        `${(e as Error).message}; cleanup failed, leftover: ${tmp}`,
      );
    }
    throw e;
  }
}

type Derived = {
  v: 1;
  sums_sha256: string;
  files: { path: string; sha256: string; bound_at: string }[];
};

async function readJson<T>(p: string): Promise<T | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(p)) as T;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined;
    throw e;
  }
}

/** freeze.json as pack writes it, or a problem string. */
async function readFreeze(
  outDir: string,
): Promise<{ sums_sha256: string; files: number } | string> {
  let text: string;
  try {
    text = await Deno.readTextFile(join(outDir, FREEZE));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return `missing: ${FREEZE}`;
    throw e;
  }
  try {
    const f = JSON.parse(text);
    if (
      f?.v === 1 && typeof f.created_at === "string" &&
      Number.isInteger(f.files) && /^[0-9a-f]{64}$/.test(f.sums_sha256) &&
      typeof f.meta === "object" && f.scan?.hits === 0
    ) return f;
  } catch { /* falls through */ }
  return `incomplete ${FREEZE}`;
}

export async function verify(outDir: string): Promise<string[]> {
  const problems: string[] = [];
  const freeze = await readFreeze(outDir);
  if (typeof freeze === "string") return [freeze];
  let sumsBytes: Uint8Array;
  try {
    sumsBytes = await Deno.readFile(join(outDir, SUMS));
  } catch {
    return [`missing: ${SUMS}`];
  }
  if (await sha256(sumsBytes) !== freeze.sums_sha256) {
    problems.push(`${SUMS} does not match freeze.json`);
  }
  const expected = new Map<string, string>();
  for (const line of new TextDecoder().decode(sumsBytes).split("\n")) {
    if (line === "") continue;
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (m?.[1] && m[2]) expected.set(m[2], m[1]);
    else problems.push(`malformed ${SUMS} line`);
  }
  let actual: string[] = [];
  try {
    actual = await files(join(outDir, "results"));
  } catch (e) {
    problems.push((e as Error).message);
  }
  for (const rel of actual) {
    const want = expected.get(rel);
    if (want === undefined) problems.push(`extra: ${rel}`);
    else if (
      await sha256(await Deno.readFile(join(outDir, "results", rel))) !== want
    ) problems.push(`changed: ${rel}`);
  }
  const seen = new Set(actual);
  for (const rel of expected.keys()) {
    if (!seen.has(rel)) problems.push(`missing: ${rel}`);
  }
  const derived = await readJson<Derived>(join(outDir, DERIVED));
  if (derived) {
    if (derived.sums_sha256 !== freeze.sums_sha256) {
      problems.push(`${DERIVED} is bound to another snapshot`);
    }
    for (const f of derived.files) {
      let bytes: Uint8Array;
      try {
        bytes = await Deno.readFile(f.path);
      } catch {
        problems.push(`bound file missing: ${f.path}`);
        continue;
      }
      if (await sha256(bytes) !== f.sha256) {
        problems.push(`bound file changed: ${f.path}`);
      }
    }
  }
  return problems;
}

/** Append-only: same hash is a no-op, another hash for a bound path refuses. */
export async function bind(outDir: string, paths: string[]): Promise<void> {
  const freeze = await readFreeze(outDir);
  if (typeof freeze === "string") {
    throw new OperationalError(`${freeze} in ${outDir}`);
  }
  const derived = await readJson<Derived>(join(outDir, DERIVED)) ??
    { v: 1, sums_sha256: freeze.sums_sha256, files: [] };
  if (derived.sums_sha256 !== freeze.sums_sha256) {
    throw new FindingError(`${DERIVED} is bound to another snapshot`);
  }
  for (const p of paths.map((x) => resolve(x))) {
    const hash = await sha256(await Deno.readFile(p));
    const prior = derived.files.find((f) => f.path === p);
    if (prior?.sha256 === hash) continue;
    if (prior) throw new FindingError(`already bound with another hash: ${p}`);
    derived.files.push({
      path: p,
      sha256: hash,
      bound_at: new Date().toISOString(),
    });
  }
  await Deno.writeTextFile(
    join(outDir, DERIVED),
    JSON.stringify(derived, null, 2) + "\n",
  );
}

if (import.meta.main) {
  try {
    const a = parseArgs(Deno.args, {
      string: ["secret-file", "meta"],
      collect: ["secret-file", "meta"],
    });
    const [cmd, dir = "", ...rest] = a._.map(String);
    if (cmd === "pack" && rest.length === 1) {
      if ((a["secret-file"] as string[]).length === 0) {
        throw new OperationalError("pack needs at least one --secret-file");
      }
      const meta: Record<string, string> = {};
      for (const kv of a.meta as string[]) {
        const i = kv.indexOf("=");
        if (i < 1) throw new OperationalError("bad --meta (want k=v)");
        meta[kv.slice(0, i)] = kv.slice(i + 1);
      }
      const r = await pack(dir, rest[0]!, {
        meta,
        secretFiles: a["secret-file"] as string[],
      });
      console.log(
        `${
          colors.green("[OK]")
        } packed ${r.files} files; sums_sha256 ${r.sumsSha256}; scanned ${
          (a["secret-file"] as string[]).length
        } secret files, 0 hits`,
      );
    } else if (cmd === "verify" && dir && rest.length === 0) {
      const p = await verify(dir);
      if (p.length > 0) {
        for (const x of p) console.log(`${colors.red("[FAIL]")} ${x}`);
        Deno.exit(1);
      }
      console.log(`${colors.green("[OK]")} ${dir} verified`);
    } else if (cmd === "bind" && dir && rest.length >= 1) {
      await bind(dir, rest);
      console.log(`${colors.green("[OK]")} bound ${rest.length} files`);
    } else {
      console.error(
        "usage: freeze-archive.ts pack <root> <outDir> --secret-file <f>... [--meta k=v]... | verify <outDir> | bind <outDir> <file>...",
      );
      Deno.exit(2);
    }
  } catch (e) {
    console.log(`${colors.red("[FAIL]")} ${(e as Error)?.message ?? e}`);
    Deno.exit(e instanceof FindingError ? 1 : 2);
  }
}
