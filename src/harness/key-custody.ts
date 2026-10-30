/**
 * H-44 (design-final 5.1): the key custody probe. A custody dir, its
 * immediate parent and at most one bundle, nothing recursive; every failure
 * refuses (fail closed: no partial result, no safe default).
 */

import { basename, dirname, join } from "@std/path";
import { z } from "zod";
import { ConfigurationError } from "../errors.ts";
import { validatedDir } from "./fsutil.ts";

/** One bounded command execution of the probe (the test seam); returns or throws. */
export type ProbeRunner = (
  paths: readonly string[],
  signal: AbortSignal,
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface ProbeOptions {
  /**
   * Replaces only the command execution; parsing and evaluation always run
   * (on any host, an injected runner's output is evaluated as Windows').
   */
  runner?: ProbeRunner;
  timeoutMs: number;
}

// One object per requested path. Arrays are [object[]] and -InputObject keeps
// a single-element array an array; depth 8 covers top/results/rules (5 levels).
const CUSTODY_PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Remove-TypeData System.Array -ErrorAction Ignore
$sidType = [Security.Principal.SecurityIdentifier]
$results = [object[]]@()
foreach ($p in ($env:CG_PATHS -split "\`n")) {
  $isDir = [IO.Directory]::Exists($p)
  $item = if ($isDir) { [IO.DirectoryInfo]::new($p) } else { [IO.FileInfo]::new($p) }
  if (-not $item.Exists) { throw "not found: $p" }
  $up = if ($isDir) { $item.Parent } else { $item.Directory }
  $ancestors = [object[]]@()
  while ($up) {
    $ancestors += [bool]($up.Attributes -band [IO.FileAttributes]::ReparsePoint)
    $up = $up.Parent
  }
  $acl = $item.GetAccessControl()
  $rules = [object[]]@()
  foreach ($r in $acl.GetAccessRules($true, $true, $sidType)) {
    $rules += [pscustomobject]@{
      sid = $r.IdentityReference.Value
      rights = [int64]$r.FileSystemRights
      deny = ($r.AccessControlType -eq 'Deny')
      inheritOnly = [bool]($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)
    }
  }
  $results += [pscustomobject]@{
    req = $p
    dir = $isDir
    reparse = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
    ancestors = $ancestors
    owner = $acl.GetOwner($sidType).Value
    protected = [bool]$acl.AreAccessRulesProtected
    rules = $rules
  }
}
$out = [pscustomobject]@{
  user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  results = $results
}
ConvertTo-Json -InputObject $out -Compress -Depth 8
`;

/** The real command: absolute-path Windows PowerShell, paths in CG_PATHS, bounded by `signal`. */
export const realProbeRunner: ProbeRunner = async (paths, signal) => {
  const ps = `${
    Deno.env.get("SystemRoot") ?? "C:\\Windows"
  }\\System32\\WindowsPowerShell\\v1.0`;
  const out = await new Deno.Command(`${ps}\\powershell.exe`, {
    args: ["-NoProfile", "-NonInteractive", "-Command", CUSTODY_PS],
    // A pwsh 7 parent's PSModulePath breaks Windows PowerShell's own modules.
    env: { CG_PATHS: paths.join("\n"), PSModulePath: `${ps}\\Modules` },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal,
  }).output();
  const text = (b: Uint8Array) =>
    new TextDecoder("utf-8", { fatal: true }).decode(b);
  return { code: out.code, stdout: text(out.stdout), stderr: text(out.stderr) };
};

const Sid = z.string().regex(/^S-1-\d+(-\d+)+$/);
const ProbeOutput = z.strictObject({
  user: Sid,
  results: z.array(z.strictObject({
    req: z.string(),
    dir: z.boolean(),
    reparse: z.boolean(),
    ancestors: z.array(z.boolean()),
    owner: Sid,
    protected: z.boolean(),
    rules: z.array(z.strictObject({
      sid: Sid,
      rights: z.number().refine(Number.isSafeInteger, "not a safe integer"),
      deny: z.boolean(),
      inheritOnly: z.boolean(),
    })),
  })),
});
type Fact = z.output<typeof ProbeOutput>["results"][number];

const SYSTEM = "S-1-5-18";
const ADMINISTRATORS = "S-1-5-32-544";
const FULL_CONTROL = 0x1f01ff;
/** Write data, append, write EA, delete child, write attributes, DELETE, WRITE_DAC, WRITE_OWNER, GENERIC_ALL, GENERIC_WRITE. */
const PARENT_WRITE = 0x500d0156;

const msg = (err: unknown) => err instanceof Error ? err.message : String(err);
const hex = (n: number) => `0x${(n >>> 0).toString(16)}`;

/** The command's stdout within `timeoutMs`; any failure is a probe error. */
async function runProbe(
  runner: ProbeRunner,
  paths: readonly string[],
  timeoutMs: number,
): Promise<string> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new Error(`timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  let out: Awaited<ReturnType<ProbeRunner>>;
  try {
    const run = runner(paths, ac.signal);
    run.catch(() => {}); // settles after a timeout that already refused
    out = await Promise.race([run, timeout]);
  } catch (err) {
    throw new Error(`probe command failed: ${msg(err)}`);
  } finally {
    clearTimeout(timer);
  }
  if (out.code !== 0) {
    throw new Error(
      `probe command exited ${out.code}: ${out.stderr.trim().slice(0, 300)}`,
    );
  }
  if (out.stdout.trim() === "") throw new Error("probe printed nothing");
  return out.stdout;
}

/** Strict parse: exactly one result per requested path (by req) and nothing else. */
function parseProbe(stdout: string, paths: readonly string[]) {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error("probe output is not JSON");
  }
  const r = ProbeOutput.safeParse(raw);
  if (!r.success) {
    throw new Error(
      `probe output is malformed (${
        r.error.issues.map((i) =>
          `${i.path.join(".") || "output"}: ${i.message}`
        ).join("; ")
      })`,
    );
  }
  const byReq = new Map<string, Fact>();
  for (const f of r.data.results) {
    if (!paths.includes(f.req) || byReq.has(f.req)) {
      throw new Error(
        `probe output has an unrequested or repeated result ${f.req}`,
      );
    }
    byReq.set(f.req, f);
  }
  for (const p of paths) {
    if (!byReq.has(p)) throw new Error(`probe output has no result for ${p}`);
  }
  return { user: r.data.user, byReq };
}

/** Windows evaluation; null when protected. */
function windowsProblem(
  user: string,
  byReq: Map<string, Fact>,
  roles: [string, "dir" | "parent" | "bundle"][],
): string | null {
  const trusted = new Set([user, SYSTEM, ADMINISTRATORS]);
  for (const [path, role] of roles) {
    const f = byReq.get(path)!;
    if (f.reparse || f.ancestors.some(Boolean)) {
      return `${path} is or lies under a reparse point`;
    }
    if (!trusted.has(f.owner)) {
      return `${path} is owned by ${f.owner}, not a trusted principal`;
    }
    if (role === "parent") {
      // Inherit-only rules do not apply to the parent itself (the dir's DACL
      // is protected); a Deny never excuses an unsafe Allow.
      for (const r of f.rules) {
        if (r.deny || r.inheritOnly || trusted.has(r.sid)) continue;
        if ((r.rights & PARENT_WRITE) !== 0) {
          return `parent ${path} grants ${r.sid} write rights ${
            hex(r.rights & PARENT_WRITE)
          }`;
        }
      }
      continue;
    }
    if (f.dir !== (role === "dir")) {
      return `${path} is not a ${role === "dir" ? "directory" : "file"}`;
    }
    if (!f.protected) return `${path} inherits its ACL (not protected)`;
    for (const r of f.rules) {
      if (r.deny) return `${path} has a Deny rule for ${r.sid}`;
      if (r.inheritOnly) return `${path} has an inherit-only rule for ${r.sid}`;
      if (r.sid !== user && r.sid !== SYSTEM) return `${path} grants ${r.sid}`;
      if ((r.rights & FULL_CONTROL) !== FULL_CONTROL) {
        return `${path}: ${r.sid} lacks FullControl`;
      }
    }
    const sids = f.rules.map((r) => r.sid).sort();
    if (sids.join(",") !== [user, SYSTEM].sort().join(",")) {
      return `${path} is not exactly the user's and SYSTEM's (${
        sids.join(", ")
      })`;
    }
  }
  return null;
}

/** What the POSIX evaluation reads of one lstat. */
export type PosixFact = Pick<
  Deno.FileInfo,
  "uid" | "mode" | "isSymlink" | "isDirectory" | "isFile"
>;

/** POSIX evaluation of lstat facts; null when protected. */
export function posixProblem(
  f: { dir: PosixFact; parent: PosixFact; bundle: PosixFact | null },
  uid: number,
): string | null {
  const roles: [string, PosixFact][] = [
    ["dir", f.dir],
    ["parent", f.parent],
    ...(f.bundle ? [["bundle", f.bundle] as [string, PosixFact]] : []),
  ];
  for (const [role, s] of roles) {
    const mode = (s.mode ?? 0) & 0o7777;
    if (s.isSymlink) return `the ${role} is a symlink`;
    if (role === "parent") {
      if (s.uid !== uid && s.uid !== 0) {
        return `the parent is owned by uid ${s.uid}`;
      }
      if ((mode & 0o022) !== 0 && (mode & 0o1000) === 0) {
        return `the parent is group or other writable (mode ${
          mode.toString(8)
        }) and not sticky`;
      }
      continue;
    }
    const want = role === "dir" ? 0o700 : 0o600;
    if (role === "dir" ? !s.isDirectory : !s.isFile) {
      return `the ${role} is not a plain ${
        role === "dir" ? "directory" : "file"
      }`;
    }
    if (s.uid !== uid) return `the ${role} is owned by uid ${s.uid}`;
    if (mode !== want) {
      return `the ${role} has mode ${mode.toString(8)}, not ${
        want.toString(8)
      }`;
    }
  }
  return null;
}

/**
 * Refuses (ConfigurationError, the reason) unless the custody dir, its
 * immediate parent and `bundle` (a file directly in dir) are protected:
 * trusted owners, an exact private DACL (Windows) or mode (POSIX) on the dir
 * and bundle, no unsafe write grant on the parent, no reparse point or link.
 * Only their metadata is read.
 */
export async function probeCustody(
  dir: string,
  bundle: string | null,
  o: ProbeOptions,
): Promise<void> {
  const parent = dirname(dir);
  const paths = [dir, parent, ...(bundle ? [bundle] : [])];
  let problem: string | null;
  try {
    if (o.runner || Deno.build.os === "windows") {
      const out = await runProbe(
        o.runner ?? realProbeRunner,
        paths,
        o.timeoutMs,
      );
      const { user, byReq } = parseProbe(out, paths);
      problem = windowsProblem(user, byReq, [
        [dir, "dir"],
        [parent, "parent"],
        ...(bundle ? [[bundle, "bundle"] as [string, "bundle"]] : []),
      ]);
    } else {
      problem = posixProblem({
        dir: await Deno.lstat(dir),
        parent: await Deno.lstat(parent),
        bundle: bundle ? await Deno.lstat(bundle) : null,
      }, Deno.uid()!);
    }
    // Links: a canonical plain dir (validatedDir throws otherwise), the
    // bundle a plain file directly in it.
    if (!problem) {
      const canon = await validatedDir(dir);
      if (bundle) {
        const st = await Deno.lstat(bundle);
        const real = (await Deno.realPath(bundle)).replace(
          /^[a-z]:/,
          (d) => d.toUpperCase(),
        );
        if (
          st.isSymlink || !st.isFile || real !== join(canon, basename(bundle))
        ) {
          problem = `${bundle} is not a plain file in ${dir}`;
        }
      }
    }
  } catch (err) {
    problem = msg(err);
  }
  if (problem) throw new ConfigurationError(problem);
}
