/**
 * H-35 S3 (design-r3 2, r4 2, r5 3; owner rulings 2026-10-19 "Tenancy
 * REVISED" and "Base state"): the reset before every judge deployment,
 * behind one interface so the mechanism stays pluggable. The production
 * mechanism restores the golden set (lane-ops' reset script); a failed reset
 * is infra and the lane quarantines the container.
 *
 * Script protocol (agreed with lane-ops): one `RESET_STEP <name> <ms>` line
 * per phase (snapshot_guard first, ..., runner_verify, postconditions), then
 * exactly one of `RESET_OK` or `RESET_FAILED <step> <reason>`; exit 0 only
 * with RESET_OK. Anything else is a `protocol` failure.
 */

import { join } from "@std/path";
import { type Lineage, lineageCompat } from "./lineage.ts";
import { ConfigurationError, ContainerError } from "../errors.ts";

/** The agreed phases, in order (lane-ops' reset-golden.ps1); all of them make a success. */
export const RESET_PHASES = [
  "snapshot_guard",
  "quiesce",
  "verify_sha",
  "stop",
  "restore",
  "start",
  "healthy",
  "runner_verify",
  "postconditions",
] as const;

export interface ResetRecord {
  container: string;
  mechanism: string;
  policy_version: number;
  ok: boolean;
  /** The failed step (e.g. snapshot_guard, restore, runner_verify), else null. */
  failed_step: string | null;
  error: string | null;
  phases_ms: Record<string, number>;
}

export interface ResetMechanism {
  readonly id: string;
  readonly policyVersion: number;
  /** H-35 S3.3: the lineage's compatibility identity (env_fp), when it has one. */
  readonly compat?: Readonly<Record<string, unknown>>;
  reset(container: string): Promise<ResetRecord>;
  /**
   * H-35 S3 (design-r4 2): after a judge deployment's cleanup, the inventory
   * at both scopes must equal the lineage's baseline. Never throws: a check
   * that could not run is a failed record.
   */
  verifyClean?(container: string): Promise<VerifyRecord>;
  /**
   * H-35 S3 L4 (decisions/2026-10-20-h-35-l4-scope.md): one fsDigest(W)
   * capture (fs-digest.ps1 lines), taken right after the reset and again
   * after the cleanup. A throw fails closed like an error line.
   */
  fsDigest?(container: string): Promise<string[]>;
  /** L4 exclusions (the lineage's dispositions), as Windows wildcards. */
  readonly fsExclude?: readonly string[];
  /** L4: the declared roots every capture must cover (the lineage's fs.roots). */
  readonly fsRoots?: readonly string[];
  /** H-35 S3 L2b: the lineage's NST outbound firewall state (absent: not recorded). */
  readonly bcEgress?: "enforced" | "unenforced";
  /** H-35 S3: the content root every restore is verified against (absent: none). */
  readonly contentRoot?: string;
}

/** One L4 check of a deployment (the verdict log's `fs_checks[]`). */
export interface FsCheckRecord {
  container: string;
  ok: boolean;
  diff: FsDiffEntry[];
  errors: string[];
}

/**
 * Infra that leaves the container in an unknown or unsafe state: the lane
 * quarantines it (never reused without recovery) and reroutes.
 */
export class QuarantiningError extends ContainerError {}

/**
 * L4 found a difference or could not observe: the host is dirty. Infra, so
 * the judgment's rows from this deployment are never scored here; the lane
 * quarantines the container and reroutes.
 */
export class HostDirtyError extends QuarantiningError {
  constructor(readonly record: FsCheckRecord) {
    const what = [
      ...record.errors,
      ...record.diff.slice(0, 5).map((d) => d.path),
    ];
    super(
      `L4 on ${record.container}: ${record.errors.length} error(s), ${record.diff.length} difference(s): ${
        what.join("; ").slice(0, 400)
      }`,
      record.container,
      "health",
    );
    this.name = "HostDirtyError";
  }
}

/** One post-cleanup inventory check (the verdict log's `verifies[]`). */
export interface VerifyRecord {
  container: string;
  ok: boolean;
  /** `+ <line>` present now, not in the baseline; `- <line>` the reverse. */
  diff: string[];
  error: string | null;
}

/**
 * verify-clean.ps1 protocol: `VERIFY_DIFF <+|-> <line>` per difference, then
 * exactly one of `VERIFY_OK` (exit 0, no diff), `VERIFY_DIRTY <n>` (n = the
 * diff lines) or `VERIFY_FAILED <reason>`. Anything else is a failed check.
 */
export function parseVerifyOutput(
  container: string,
  out: { code: number; stdout: string },
): VerifyRecord {
  const diff: string[] = [];
  const ends: string[] = [];
  let dirtyN = -1;
  let failed: string | null = null;
  const bad: string[] = [];
  for (const raw of out.stdout.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.startsWith("VERIFY_")) continue;
    const d = /^VERIFY_DIFF ([+-] \S.*)$/.exec(line);
    const dirty = /^VERIFY_DIRTY (\d+)$/.exec(line);
    const f = /^VERIFY_FAILED (\S.*)$/.exec(line);
    if (d) diff.push(d[1]!);
    else if (line === "VERIFY_OK") ends.push("ok");
    else if (dirty) (ends.push("dirty"), dirtyN = Number(dirty[1]));
    else if (f) (ends.push("failed"), failed = f[1]!.trim());
    else bad.push(line);
  }
  const fail = (error: string): VerifyRecord => ({
    container,
    ok: false,
    diff,
    error,
  });
  const protocol = (why: string) => fail(`protocol: ${why} (exit ${out.code})`);
  if (bad.length > 0) return protocol(`malformed ${bad[0]!.slice(0, 200)}`);
  if (ends.length !== 1) return protocol(`${ends.length} end markers`);
  if (ends[0] === "failed") return fail(failed!);
  if (ends[0] === "dirty") {
    if (dirtyN !== diff.length || diff.length === 0) {
      return protocol(`VERIFY_DIRTY ${dirtyN} with ${diff.length} diff lines`);
    }
    return fail(
      `inventory differs from the baseline (${diff.length} line${
        diff.length === 1 ? "" : "s"
      })`,
    );
  }
  if (out.code !== 0 || diff.length > 0) {
    return protocol("VERIFY_OK with a diff or a failing exit");
  }
  return { container, ok: true, diff, error: null };
}

/**
 * H-35 S3 L2a (design-r5 2.2): an agent extension's Allow HttpClient
 * Requests did not read back false. Infra; quarantined.
 */
export class HttpBlockFailedError extends QuarantiningError {
  constructor(container: string, appId: string, readback: string) {
    super(
      `HttpClient block of ${appId} on ${container} read back '${
        readback.slice(0, 100)
      }', want allow=false`,
      container,
      "publish",
    );
    this.name = "HttpBlockFailedError";
  }
}

/** A reset that did not complete: infra; the lane quarantines the container. */
export class ResetFailedError extends QuarantiningError {
  constructor(readonly record: ResetRecord) {
    super(
      `reset of ${record.container} failed at ${record.failed_step}: ${record.error}`,
      record.container,
      "setup",
    );
    this.name = "ResetFailedError";
  }
}

export function parseResetOutput(
  container: string,
  m: { id: string; policyVersion: number },
  out: { code: number; stdout: string },
): ResetRecord {
  const phases_ms: Record<string, number> = {};
  const seen: string[] = [];
  let oks = 0;
  // Run 002 Sol r3 #1: no phase may follow the success marker.
  let stepAfterOk = false;
  const failed: { step: string; reason: string }[] = [];
  // Orch Sol r1 #1: every line in the reserved RESET_ namespace must be one
  // well-formed marker; any other such line is a protocol failure.
  const malformed: string[] = [];
  for (const raw of out.stdout.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.startsWith("RESET_")) continue;
    // A phase name is one identifier (Sol r3 #1).
    const step = /^RESET_STEP ([a-z_]+) (\d+)$/.exec(line);
    const f = /^RESET_FAILED ([a-z_]+) (\S.*)$/.exec(line);
    if (step) {
      if (oks > 0) stepAfterOk = true;
      seen.push(step[1]!);
      phases_ms[step[1]!] = Number(step[2]);
    } else if (f) failed.push({ step: f[1]!, reason: f[2]!.trim() });
    // Run 002 Sol r2 #1: a success marker is exactly the bare line.
    else if (line === "RESET_OK") oks++;
    else malformed.push(line);
  }
  const base = {
    container,
    mechanism: m.id,
    policy_version: m.policyVersion,
    phases_ms,
  };
  const protocol = (why: string): ResetRecord => ({
    ...base,
    ok: false,
    failed_step: "protocol",
    error: `${why} (exit ${out.code})`,
  });
  if (malformed.length > 0) {
    return protocol(`malformed marker line: ${malformed[0]!.slice(0, 200)}`);
  }
  if (failed.length > 1) return protocol("more than one RESET_FAILED");
  if (failed.length === 1) {
    return {
      ...base,
      ok: false,
      failed_step: failed[0]!.step,
      error: failed[0]!.reason,
    };
  }
  if (oks !== 1 || out.code !== 0) {
    return protocol("not exactly one bare RESET_OK with exit 0");
  }
  if (stepAfterOk) return protocol("a phase after RESET_OK");
  // Sol r2 #1: success means every agreed phase ran, once each, in order.
  if (
    seen.length !== RESET_PHASES.length ||
    seen.some((p, i) => p !== RESET_PHASES[i])
  ) {
    return protocol(
      `phases ${seen.join(",") || "(none)"}, want ${RESET_PHASES.join(",")}`,
    );
  }
  return { ...base, ok: true, failed_step: null, error: null };
}

/**
 * The judging environment's mechanism until a reset lineage is configured:
 * judging refuses (a configuration error, never infra, so nothing is
 * quarantined or rerouted). No judge deployment without a reset.
 */
export const UNCONFIGURED_RESET: ResetMechanism = {
  id: "unconfigured",
  policyVersion: 0,
  reset: () =>
    Promise.reject(
      new ConfigurationError(
        "judging needs a reset lineage (H-35 S3): no judge deployment without a reset",
      ),
    ),
};

/** A mechanism that runs a reset command per container and parses its output. */
export function commandReset(o: {
  id: string;
  policyVersion: number;
  run: (container: string) => Promise<{ code: number; stdout: string }>;
}): ResetMechanism {
  return {
    id: o.id,
    policyVersion: o.policyVersion,
    reset: async (container) => {
      let out;
      try {
        out = await o.run(container);
      } catch (err) {
        // A refusal stays a refusal; anything else is a recorded failure
        // (run 002 Sol r2 #3), so the lane quarantines the container.
        if (err instanceof ConfigurationError) throw err;
        return failedReset(container, o, "command", err);
      }
      return parseResetOutput(container, o, out);
    },
  };
}

/** A reset that threw, as a failed record (never an unrecorded error). */
export function failedReset(
  container: string,
  m: { id: string; policyVersion: number },
  step: string,
  err: unknown,
): ResetRecord {
  return {
    container,
    mechanism: m.id,
    policy_version: m.policyVersion,
    ok: false,
    failed_step: step,
    error: err instanceof Error ? err.message : String(err),
    phases_ms: {},
  };
}

/** lane-ops' reset script (O-09), relative to the repository root. */
export const RESET_SCRIPT = ["infra", "harness-reset", "reset-golden.ps1"];
/** The post-cleanup inventory check against the same lineage. */
export const VERIFY_SCRIPT = ["infra", "harness-reset", "verify-clean.ps1"];
/** One L4 fsDigest(W) capture over the lineage's fs roots. */
export const FS_SCRIPT = ["infra", "harness-reset", "fs-capture.ps1"];
/** Longer than the script's own 10 min health limit; then the reset failed. */
const RESET_TIMEOUT_MS = 20 * 60_000;

export type Spawn = (
  cmd: string,
  args: string[],
  env: Record<string, string>,
) => Promise<{ code: number; stdout: string }>;

const spawnProcess: Spawn = async (cmd, args, env) => {
  const out = await new Deno.Command(cmd, {
    args,
    env,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(RESET_TIMEOUT_MS),
  }).output();
  return { code: out.code, stdout: new TextDecoder().decode(out.stdout) };
};

/**
 * H-35 S3.2: the production mechanism. Host pwsh runs lane-ops'
 * reset-golden.ps1 against one container with the lineage file; the script
 * restores the lineage's golden.bak and proves the result (its markers are
 * parsed strictly, parseResetOutput). `dockerEnv` pins the Windows docker
 * context (dockerContextEnv).
 */
export function goldenReset(o: {
  repoRoot: string;
  lineagePath: string;
  lineage: Lineage;
  dockerEnv: Record<string, string>;
  spawn?: Spawn;
}): ResetMechanism {
  const spawn = o.spawn ?? spawnProcess;
  const run = (script: string[], container: string) =>
    spawn("pwsh", [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join(o.repoRoot, ...script),
      "-Container",
      container,
      "-Lineage",
      o.lineagePath,
    ], o.dockerEnv);
  const fs = o.lineage.fs;
  return {
    ...commandReset({
      id: "golden-restore",
      policyVersion: o.lineage.reset_policy_version,
      run: (container) => run(RESET_SCRIPT, container),
    }),
    // H-35 S3.3: the lineage's identity enters every deployment's env_fp.
    compat: { lineage: lineageCompat(o.lineage) },
    ...(o.lineage.egress ? { bcEgress: o.lineage.egress.mode } : {}),
    ...(o.lineage.content_root
      ? { contentRoot: o.lineage.content_root.root }
      : {}),
    // H-35 S3 L4: only with the lineage's fs section (admission refuses one without).
    ...(fs
      ? {
        fsExclude: fs.exclude.map((e) => e.pattern),
        fsRoots: fs.roots,
        fsDigest: async (container: string) => {
          const out = await run(FS_SCRIPT, container);
          const lines = out.stdout.split(/\r?\n/).filter((l) => l !== "");
          return out.code === 0
            ? lines
            : [...lines, `E|(fs-capture)|exit ${out.code}`];
        },
      }
      : {}),
    verifyClean: async (container) => {
      try {
        return parseVerifyOutput(
          container,
          await run(VERIFY_SCRIPT, container),
        );
      } catch (err) {
        return {
          container,
          ok: false,
          diff: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

/** One L4 difference: the digest line before and after (null: absent). */
export interface FsDiffEntry {
  path: string;
  before: string | null;
  after: string | null;
}

/**
 * The entry's key (path, or path:stream) of a well-formed fs-digest.ps1 line;
 * null when the kind is unknown or a field is malformed (Sol S3 r1 #5).
 */
const FS_LINE: Record<string, RegExp> = {
  D: /^D\|\d+\|\d+\|([^|]+)$/,
  F: /^F\|[0-9a-f]{64}\|\d+\|\d+\|\d+\|([^|]+)$/,
  S: /^S\|[0-9a-f]{64}\|\d+\|([^|]+)$/,
  L: /^L\|\d+\|\d+\|([^|]+)\|[^|]*$/,
};
function fsKey(line: string): string | null {
  return FS_LINE[line[0] ?? ""]?.exec(line)?.[1] ?? null;
}

/** A Windows wildcard (case-insensitive; `*` any run, subtrees included). */
function wildcard(pattern: string): RegExp {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll(
    "*",
    ".*",
  );
  return new RegExp(`^${esc}$`, "i");
}

/**
 * H-35 S3 L4 (decisions/2026-10-20-h-35-l4-scope.md): compare two
 * fsDigest(W) captures. Any difference in an entry's line (content, size,
 * attributes, last-write time, a stream, a link target) outside the
 * exclusions is a difference; E lines and unparsable lines on either side are
 * errors, and an error fails closed like a difference. Sol S3 r1 #5: each
 * capture must end with exactly one `T|<n>` (n = its other lines), hold no
 * entry twice, and cover every declared root (a D, L or E line for it).
 */
export function fsDiff(
  before: readonly string[],
  after: readonly string[],
  exclude: readonly string[],
  roots: readonly string[] = [],
): { diff: FsDiffEntry[]; errors: string[] } {
  const errors: string[] = [];
  const res = exclude.map(wildcard);
  const index = (side: string, raw: readonly string[]) => {
    const m = new Map<string, string>();
    const lines = raw.map((l) => l.trimEnd()).filter((l) => l !== "");
    const marks = lines.filter((l) => l.startsWith("T|"));
    const entries = lines.filter((l) => !l.startsWith("T|"));
    if (marks.length !== 1 || lines.at(-1) !== marks[0]) {
      errors.push(
        `${side}: no T| marker as the last line (incomplete capture)`,
      );
    } else if (marks[0] !== `T|${entries.length}`) {
      errors.push(
        `${side}: ${marks[0]} does not match the count ${entries.length}`,
      );
    }
    const seen = new Set<string>();
    for (const line of entries) {
      if (line.startsWith("E|")) {
        const [, p, ...why] = line.split("|");
        errors.push(`${side}: ${p}: ${why.join("|")}`);
        seen.add((p ?? "").toLowerCase());
        continue;
      }
      const k = fsKey(line);
      if (k === null) {
        errors.push(`${side}: unparsable line ${line}`);
        continue;
      }
      // NTFS paths are case-insensitive: one entry; a case-only rename
      // still differs in its line.
      const key = k.toLowerCase();
      if (seen.has(key)) errors.push(`${side}: ${k} appears twice`);
      seen.add(key);
      if (!res.some((r) => r.test(k))) m.set(key, line);
    }
    for (const r of roots) {
      if (!seen.has(r.toLowerCase())) {
        errors.push(`${side}: declared root ${r} has no entry`);
      }
    }
    return m;
  };
  const b = index("before", before), a = index("after", after);
  const diff: FsDiffEntry[] = [];
  for (const k of [...new Set([...b.keys(), ...a.keys()])].sort()) {
    const x = b.get(k) ?? null, y = a.get(k) ?? null;
    if (x !== y) diff.push({ path: fsKey((y ?? x)!)!, before: x, after: y });
  }
  return { diff, errors };
}
