/**
 * Snapshot a harness results root with a fail-closed secret scan (M6-03).
 * Usage:
 *   deno run --allow-all scripts/harness/freeze-archive.ts pack <resultsRoot> <outDir> --secret-file <f>... [--meta k=v]...
 *   deno run --allow-all scripts/harness/freeze-archive.ts verify <outDir>
 *   deno run --allow-all scripts/harness/freeze-archive.ts bind <outDir> <file>...
 * Exit: 0 clean, 1 secret hit or verify problem, 2 operational failure.
 *
 * The scan covers the secret values on disk plus the key patterns; it is not
 * proof that every historical credential value is absent.
 */

import { parseArgs } from "@std/cli/parse-args";
import { walk } from "@std/fs/walk";
import { basename, dirname, join, relative, resolve } from "@std/path";
import * as colors from "@std/fmt/colors";

/** Unreadable secret file or tree, existing outDir, a link: exit 2. */
export class OperationalError extends Error {}

const PATTERNS = [
  "sk-or-v1-[A-Za-z0-9]{20,}",
  "sk-ant-oat01-[A-Za-z0-9_-]{20,}",
];
const SUMS = "SHA256SUMS";
const FREEZE = "freeze.json";
const DERIVED = "derived.json";

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const posix = (p: string) => p.replaceAll("\\", "/");

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

async function readSecrets(secretFiles: string[]) {
  const out: { name: string; value: Uint8Array }[] = [];
  for (const f of secretFiles) {
    let text: string;
    try {
      text = await Deno.readTextFile(f);
    } catch {
      throw new OperationalError(`cannot read secret file: ${basename(f)}`);
    }
    const value = text.trim();
    if (value === "") {
      throw new OperationalError(`empty secret file: ${basename(f)}`);
    }
    out.push({ name: basename(f), value: new TextEncoder().encode(value) });
  }
  return out;
}

export async function pack(
  resultsRoot: string,
  outDir: string,
  opts: { meta: Record<string, string>; secretFiles: string[] },
): Promise<{ files: number; sumsSha256: string }> {
  const secrets = await readSecrets(opts.secretFiles);
  try {
    await Deno.lstat(outDir);
    throw new OperationalError(`outDir exists: ${outDir}`);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const list = await files(resultsRoot);
  await Deno.mkdir(dirname(outDir), { recursive: true });
  await Deno.mkdir(outDir);
  try {
    const res = join(outDir, "results");
    const latin1 = new TextDecoder("latin1");
    const hits: string[] = [];
    const sums: string[] = [];
    for (const rel of list) {
      const dest = join(res, rel);
      await Deno.mkdir(dirname(dest), { recursive: true });
      await Deno.copyFile(join(resultsRoot, rel), dest);
      const bytes = await Deno.readFile(dest);
      for (const s of secrets) {
        if (contains(bytes, s.value)) hits.push(`${rel} (${s.name})`);
      }
      const text = latin1.decode(bytes);
      for (const p of PATTERNS) {
        if (new RegExp(p).test(text)) hits.push(`${rel} (pattern ${p})`);
      }
      sums.push(`${await sha256(bytes)}  ${rel}`);
    }
    if (hits.length > 0) {
      throw new Error(`secret found in archived files: ${hits.join(", ")}`);
    }
    const sumsBytes = new TextEncoder().encode(sums.join("\n") + "\n");
    await Deno.writeFile(join(outDir, SUMS), sumsBytes);
    const sumsSha256 = await sha256(sumsBytes);
    const freeze = {
      v: 1,
      created_at: new Date().toISOString(),
      files: list.length,
      sums_sha256: sumsSha256,
      meta: opts.meta,
      scan: { secret_files: secrets.length, patterns: PATTERNS, hits: 0 },
    };
    await Deno.writeTextFile(
      join(outDir, FREEZE),
      JSON.stringify(freeze, null, 2) + "\n",
    );
    return { files: list.length, sumsSha256 };
  } catch (e) {
    await Deno.remove(outDir, { recursive: true });
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

export async function verify(outDir: string): Promise<string[]> {
  const problems: string[] = [];
  const freeze = await readJson<{ sums_sha256: string }>(join(outDir, FREEZE));
  if (!freeze) return [`missing: ${FREEZE}`];
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
  const freeze = await readJson<{ sums_sha256: string }>(join(outDir, FREEZE));
  if (!freeze) throw new OperationalError(`missing: ${join(outDir, FREEZE)}`);
  const derived = await readJson<Derived>(join(outDir, DERIVED)) ??
    { v: 1, sums_sha256: freeze.sums_sha256, files: [] };
  if (derived.sums_sha256 !== freeze.sums_sha256) {
    throw new Error(`${DERIVED} is bound to another snapshot`);
  }
  for (const p of paths.map((x) => resolve(x))) {
    const hash = await sha256(await Deno.readFile(p));
    const prior = derived.files.find((f) => f.path === p);
    if (prior?.sha256 === hash) continue;
    if (prior) throw new Error(`already bound with another hash: ${p}`);
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
  const a = parseArgs(Deno.args, {
    string: ["secret-file", "meta"],
    collect: ["secret-file", "meta"],
  });
  const [cmd, dir = "", ...rest] = a._.map(String);
  try {
    if (cmd === "pack" && rest.length === 1) {
      if ((a["secret-file"] as string[]).length === 0) {
        throw new OperationalError("pack needs at least one --secret-file");
      }
      const meta: Record<string, string> = {};
      for (const kv of a.meta as string[]) {
        const i = kv.indexOf("=");
        if (i < 1) throw new OperationalError(`bad --meta: ${kv}`);
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
    console.log(`${colors.red("[FAIL]")} ${(e as Error).message}`);
    Deno.exit(e instanceof OperationalError ? 2 : 1);
  }
}
