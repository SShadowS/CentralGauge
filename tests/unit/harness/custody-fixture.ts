/**
 * H-44 (design-final 5.1, 7): key custody fixtures. Crafted probe output
 * (the runner seam replaces only the command; the real parser and
 * evaluator run on it) and a test-owned custody dir.
 */

import { join } from "@std/path";
import type { ProbeRunner } from "../../../src/harness/key-custody.ts";
import type { FakeBc } from "./fake-bc.ts";
import { makeEnv, type TestEnv } from "./runtime-fixture.ts";

export const USER_SID = "S-1-5-21-1111-2222-3333-1001";
export const SYSTEM_SID = "S-1-5-18";
export const ADMINS_SID = "S-1-5-32-544";
export const USERS_SID = "S-1-5-32-545";
export const FULL = 0x1f01ff;

export interface Rule {
  sid: string;
  rights: number;
  deny: boolean;
  inheritOnly: boolean;
}

export interface Fact {
  req: string;
  dir: boolean;
  reparse: boolean;
  ancestors: boolean[];
  owner: string;
  protected: boolean;
  rules: Rule[];
}

export interface Facts {
  user: string;
  results: Fact[];
}

export const rule = (
  sid: string,
  rights = FULL,
  o: Partial<Rule> = {},
): Rule => ({ sid, rights, deny: false, inheritOnly: false, ...o });

const isDir = (p: string) => {
  try {
    return Deno.statSync(p).isDirectory;
  } catch {
    return false;
  }
};

/** What a protected custody dir, its parent and a bundle report: owner-only, no reparse point. */
export function safeFacts(paths: readonly string[]): Facts {
  return {
    user: USER_SID,
    results: paths.map((req) => ({
      req,
      dir: isDir(req),
      reparse: false,
      ancestors: [false, false],
      owner: USER_SID,
      protected: true,
      rules: [rule(USER_SID), rule(SYSTEM_SID)],
    })),
  };
}

/**
 * A runner printing safeFacts of the requested paths, after `edit` (which
 * may change them); every call's paths are recorded in `calls`.
 */
export function factsRunner(
  edit?: (f: Facts, paths: readonly string[]) => void,
  calls: string[][] = [],
): ProbeRunner {
  return (paths) => {
    calls.push([...paths]);
    const f = safeFacts(paths);
    edit?.(f, paths);
    return Promise.resolve({ code: 0, stdout: JSON.stringify(f), stderr: "" });
  };
}

/** The fact of `path` in crafted output. */
export const factOf = (f: Facts, path: string) =>
  f.results.find((r) => r.req === path)!;

/** A custody dir `<parent>/k` (mode 0700), both test-owned; disposal removes the parent. */
export async function custodyDir(): Promise<
  { dir: string; parent: string } & AsyncDisposable
> {
  const parent = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "cg-h44-custody-" }),
  );
  const dir = join(parent, "k");
  await Deno.mkdir(dir);
  if (Deno.build.os !== "windows") {
    await Deno.chmod(parent, 0o700);
    await Deno.chmod(dir, 0o700);
  }
  return {
    dir,
    parent,
    async [Symbol.asyncDispose]() {
      await Deno.remove(parent, { recursive: true }).catch((err) =>
        console.warn(`[temp-dir] could not remove ${parent}: ${err}`)
      );
    },
  };
}

const FS_OPS = [
  "readFile",
  "readTextFile",
  "open",
  "lstat",
  "stat",
  "realPath",
  "readFileSync",
  "readTextFileSync",
  "openSync",
  "lstatSync",
  "statSync",
  "realPathSync",
] as const;
const READS = new Set(["readFile", "readTextFile", "open"]);

/** Every Deno fs call (and which) on a path under `root` while in scope. */
export function fsSpy(root: string) {
  const hits: { op: string; path: string }[] = [];
  const d = Deno as unknown as Record<string, (...a: unknown[]) => unknown>;
  const saved = FS_OPS.map((op) => [op, d[op]!] as const);
  const fold = (p: string) => Deno.build.os === "windows" ? p.toLowerCase() : p;
  for (const [op, real] of saved) {
    Object.defineProperty(Deno, op, {
      configurable: true,
      writable: true,
      value: (...a: unknown[]) => {
        const p = String(a[0]);
        if (fold(p).startsWith(fold(root))) hits.push({ op, path: p });
        return real.apply(Deno, a);
      },
    });
  }
  return {
    hits,
    reads: () => hits.filter((h) => READS.has(h.op)),
    [Symbol.dispose]() {
      for (const [op, real] of saved) {
        Object.defineProperty(Deno, op, {
          configurable: true,
          writable: true,
          value: real,
        });
      }
    },
  };
}

/** makeEnv publishing with `--key-custody` (a custodyDir) through crafted safe probe output. */
export async function custodyEnv(
  o: { bc?: FakeBc } = {},
): Promise<TestEnv & { custody: string }> {
  const t = await makeEnv(o);
  const k = await custodyDir();
  t.env.keyCustody = k.dir;
  t.env.probeRunner = factsRunner();
  return {
    ...t,
    custody: k.dir,
    async [Symbol.asyncDispose]() {
      await t[Symbol.asyncDispose]();
      await k[Symbol.asyncDispose]();
    },
  };
}
