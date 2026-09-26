/**
 * Sandbox runtime (spec 1a sections 5 and 8; M0-03 carryover a-b; secrets
 * accepted-risk and egress decisions). One `docker run` per execution, by
 * immutable image id, Hyper-V isolation, capture into a private quarantine.
 * Every docker verb is bounded; termination is confirmed (run settled,
 * container absent) before anyone may touch the workspace.
 */

import { basename, dirname, join } from "@std/path";
import { dockerContextEnv } from "../container/docker-context.ts";
import {
  CentralGaugeError,
  ConfigurationError,
  ContainerError,
} from "../errors.ts";
import { buildBindMountArg } from "../sandbox/windows-provider.ts";
import { redactBytes, type SecretValue, validatedDest } from "./fsutil.ts";
import { redactPatterns, redactPatternText } from "./redact-patterns.ts";

export type { SecretValue } from "./fsutil.ts";

export const SANDBOX_PREFIX = "cg-harness-";
export const OWNER_LABEL = "centralgauge.harness.owner";
export const EXECUTION_LABEL = "centralgauge.harness.execution";
export const MIN_SECRET_LENGTH = 16;
export const OP_TIMEOUT_MS = 60_000;
export const MAX_CAPTURE_BYTES = 256 * 1024 * 1024;

export interface Capture {
  stdoutPath: string;
  stderrPath: string;
  /** stdout plus stderr; bytes beyond it are dropped and onOverflow fires once. */
  maxBytes: number;
  onStarted(): void;
  onOverflow(): void;
  /** Abandon the run: kill the docker client and close both captures (bounded). */
  abort?: AbortSignal;
}

export interface DockerCli {
  run(args: string[], c: Capture): Promise<number>;
  kill(name: string): Promise<number>;
  rm(name: string): Promise<{ code: number; stderr: string }>;
  pause(name: string): Promise<number>;
  unpause(name: string): Promise<number>;
  /** null when no such container exists; execution is its EXECUTION_LABEL. */
  state(
    name: string,
  ): Promise<{ running: boolean; execution: string | null } | null>;
  listOwned(owner: string): Promise<string[]>;
  inspectImage(ref: string): Promise<unknown | null>;
  build(args: string[]): Promise<number>;
  /**
   * A file the image ships, read without starting it (docker create, then
   * docker cp from the stopped container); null when it cannot be read.
   */
  readImageFile(
    image: string,
    path: string,
    owner: string,
  ): Promise<string | null>;
}

/** Inherited variables the docker CLI (and icacls) may see; nothing else is passed. */
export const DOCKER_ENV_ALLOWLIST = [
  "PATH",
  "SystemRoot",
  "windir",
  "ComSpec",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
] as const;

/** A cleared-env replacement: the allowlist plus the pinned Docker context. */
function dockerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of DOCKER_ENV_ALLOWLIST) {
    const v = Deno.env.get(k);
    if (v !== undefined) env[k] = v;
  }
  return { ...env, ...dockerContextEnv() };
}

/** Resolve p or throw a ContainerError after ms. */
export async function bounded<T>(
  p: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((
        _,
        rej,
      ) => (t = setTimeout(
        () =>
          rej(
            new ContainerError(
              `${what} timed out after ${ms} ms`,
              "docker",
              "stop",
            ),
          ),
        ms,
      ))),
    ]);
  } finally {
    clearTimeout(t);
  }
}

export function realDocker(opTimeoutMs = OP_TIMEOUT_MS): DockerCli {
  const dec = new TextDecoder();
  const out = async (args: string[]) => {
    try {
      const r = await new Deno.Command("docker", {
        args,
        clearEnv: true,
        env: dockerEnv(),
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(opTimeoutMs),
      }).output();
      return {
        code: r.code,
        stdout: dec.decode(r.stdout),
        stderr: dec.decode(r.stderr),
      };
    } catch (err) {
      return {
        code: -1,
        stdout: "",
        stderr: `docker ${args[0]} failed or timed out: ${
          err instanceof Error ? err.message : err
        }`,
      };
    }
  };
  return {
    async run(args, c) {
      // Both capture files are opened before the spawn; a failure closes what was opened.
      const o = await Deno.open(c.stdoutPath, { write: true, createNew: true });
      let e: Deno.FsFile;
      try {
        e = await Deno.open(c.stderrPath, { write: true, createNew: true });
      } catch (err) {
        o.close();
        throw err;
      }
      let child: Deno.ChildProcess;
      try {
        child = new Deno.Command("docker", {
          args,
          clearEnv: true,
          env: dockerEnv(),
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
        }).spawn();
      } catch (err) {
        o.close();
        e.close();
        throw err;
      }
      c.onStarted();
      const signal = c.abort;
      const name = args[args.indexOf("--name") + 1] ?? "docker";
      // After an abort: kill the client, and give the pipes and the process
      // opTimeoutMs to settle; then close the captures ourselves.
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, rej) => {
        const arm = () => {
          try {
            child.kill();
          } catch { /* already exited */ }
          deadlineTimer = setTimeout(() => {
            for (const f of [o, e]) {
              try {
                f.close();
              } catch { /* closed by its pipe */ }
            }
            rej(
              new ContainerError(
                `docker run ${name}: the client did not settle ${opTimeoutMs} ms after abort`,
                name,
                "stop",
              ),
            );
          }, opTimeoutMs);
        };
        if (signal?.aborted) arm();
        else signal?.addEventListener("abort", arm, { once: true });
      });
      deadline.catch(() => {});
      let total = 0;
      let overflowed = false;
      const cap = () =>
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctl) {
            // After the first dropped chunk nothing more is kept: the capture is a prefix.
            if (overflowed || total + chunk.length > c.maxBytes) {
              if (!overflowed) {
                overflowed = true;
                c.onOverflow();
              }
              return; // keep draining so the process never blocks on a full pipe
            }
            total += chunk.length;
            ctl.enqueue(chunk);
          },
        });
      const opts = signal ? { signal } : {};
      try {
        // allSettled: run() settles only once both capture files are closed.
        const piped = await Promise.race([
          Promise.allSettled([
            child.stdout.pipeThrough(cap()).pipeTo(o.writable, opts),
            child.stderr.pipeThrough(cap()).pipeTo(e.writable, opts),
          ]),
          deadline,
        ]);
        if (signal?.aborted) {
          await Promise.race([child.status, deadline]);
          throw new ContainerError(
            `docker run ${name}: abandoned (client killed)`,
            name,
            "stop",
          );
        }
        const failed = piped.find((p) => p.status === "rejected");
        if (failed) throw failed.reason;
        return (await Promise.race([child.status, deadline])).code;
      } finally {
        clearTimeout(deadlineTimer);
      }
    },
    kill: async (name) => (await out(["kill", name])).code,
    rm: async (name) => {
      const r = await out(["rm", "-f", name]);
      return { code: r.code, stderr: r.stderr };
    },
    pause: async (name) => (await out(["pause", name])).code,
    unpause: async (name) => (await out(["unpause", name])).code,
    state: async (name) => {
      const r = await out([
        "inspect",
        "--format",
        `{{.State.Running}}|{{index .Config.Labels "${EXECUTION_LABEL}"}}`,
        name,
      ]);
      if (r.code === 0) {
        const [running, execution] = r.stdout.trim().split("|");
        return { running: running === "true", execution: execution || null };
      }
      if (/no such (object|container)/i.test(r.stderr)) return null;
      throw new ContainerError(
        `docker inspect ${name}: ${r.stderr.trim()}`,
        name,
        "stop",
      );
    },
    listOwned: async (owner) => {
      const r = await out([
        "ps",
        "-a",
        "--filter",
        `label=${OWNER_LABEL}=${owner}`,
        "--format",
        "{{.Names}}",
      ]);
      if (r.code !== 0) {
        throw new ContainerError(
          `docker ps failed: ${r.stderr.trim()}`,
          "docker",
          "setup",
        );
      }
      return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter((n) =>
        n.startsWith(SANDBOX_PREFIX)
      );
    },
    inspectImage: async (ref) => {
      const r = await out(["image", "inspect", ref]);
      return r.code === 0
        ? (JSON.parse(r.stdout) as unknown[])[0] ?? null
        : null;
    },
    readImageFile: async (image, path, owner) => {
      const args = imageReadCreateArgs(image, owner);
      const name = args[args.indexOf("--name") + 1]!;
      const dir = await Deno.makeTempDir({ prefix: "cg-read-" });
      try {
        if ((await out(args)).code !== 0) {
          return null;
        }
        if ((await out(["cp", `${name}:${path}`, dir])).code !== 0) {
          return null;
        }
        return await Deno.readTextFile(
          join(dir, basename(path.replace(/\\/g, "/"))),
        );
      } catch {
        return null;
      } finally {
        await out(["rm", "-f", name]);
        await Deno.remove(dir, { recursive: true }).catch(() => {});
      }
    },
    build: async (args) =>
      (await new Deno.Command("docker", {
        args,
        clearEnv: true,
        env: dockerEnv(),
        stdout: "inherit",
        stderr: "inherit",
      }).output())
        .code,
  };
}

/**
 * The throwaway container that reads a file from an image (never started):
 * named cg-harness-read-* and owner-labelled like a sandbox, so a crash
 * between create and rm is removed by sweepOwnedSandboxes (launch contract).
 */
export function imageReadCreateArgs(image: string, owner: string): string[] {
  return [
    "create",
    "--name",
    `${SANDBOX_PREFIX}read-${crypto.randomUUID().slice(0, 12)}`,
    "--label",
    `${OWNER_LABEL}=${owner}`,
    image,
  ];
}

/** The full execution id keeps names collision-free; the campaign prefix is a hint. */
export function sandboxName(campaignId: string, executionId: string): string {
  return `${SANDBOX_PREFIX}${campaignId.slice(0, 8)}-${executionId}`;
}

export interface SandboxSpec {
  name: string;
  owner: string;
  executionId: string;
  /** Immutable image id (sha256:...), never a tag. */
  imageId: string;
  workspace: string;
  taskDir: string;
  configDir: string;
  secretsDir: string;
  extraMounts: { src: string; dst: string }[];
  /** Non-secret env only. */
  env: Record<string, string>;
  /** Docker network (M1-33's internal network when egress is enforced). */
  network?: string;
  /** Overrides the image's CMD (ops probes only). */
  command?: string[];
  timeoutMs: number;
  /** How long to wait for docker run to return after kill / rm -f. */
  killGraceMs: number;
  /** Deadline for each short docker verb. */
  opTimeoutMs: number;
  maxCaptureBytes: number;
  /** Quarantine paths (private, never under results/). */
  rawLog: string;
  stderrLog: string;
}

export function buildRunArgs(s: SandboxSpec): string[] {
  if (!/^sha256:[0-9a-f]{64}$/.test(s.imageId)) {
    throw new ConfigurationError(
      `sandbox image must be an immutable id (sha256:...), got ${s.imageId}`,
    );
  }
  const m = (
    src: string,
    dst: string,
    ro: boolean,
  ) => ["--mount", buildBindMountArg(src, dst, ro)];
  return [
    "run",
    "--name",
    s.name,
    "--isolation",
    "hyperv",
    ...(s.network ? ["--network", s.network] : []),
    "--label",
    `${OWNER_LABEL}=${s.owner}`,
    "--label",
    `${EXECUTION_LABEL}=${s.executionId}`,
    ...m(s.workspace, "C:\\workspace", false),
    ...m(s.taskDir, "C:\\task", true),
    ...m(s.configDir, "C:\\config", true),
    ...m(s.secretsDir, "C:\\cg-secrets", true),
    ...s.extraMounts.flatMap((x) => m(x.src, x.dst, true)),
    ...Object.entries(s.env).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .flatMap((
        [k, v],
      ) => ["-e", `${k}=${v}`]),
    s.imageId,
    ...(s.command ?? []),
  ];
}

export interface SandboxResult {
  exitCode: number | null;
  /** The docker process was spawned: money may have been spent. */
  started: boolean;
  startError: string | null;
  timedOut: boolean;
  interrupted: boolean;
  overflow: boolean;
  /** docker run settled (captures closed) and the container no longer exists. */
  confirmedGone: boolean;
  cleanup: "ok" | string;
  wall_ms: number;
}

async function settle<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<"timeout">((r) => (t = setTimeout(() => r("timeout"), ms))),
    ]);
  } finally {
    clearTimeout(t);
  }
}

export async function runSandbox(
  docker: DockerCli,
  spec: SandboxSpec,
  secretValues: string[],
  stop?: AbortSignal,
): Promise<SandboxResult> {
  const args = buildRunArgs(spec);
  if (
    secretValues.some((v) => v.length > 0 && args.some((a) => a.includes(v)))
  ) {
    throw new ConfigurationError(
      `refusing docker run: a secret value appears in argv or env (${spec.name})`,
    );
  }
  const t0 = performance.now();
  const r: SandboxResult = {
    exitCode: null,
    started: false,
    startError: null,
    timedOut: false,
    interrupted: false,
    overflow: false,
    confirmedGone: false,
    cleanup: "ok",
    wall_ms: 0,
  };
  const problems: string[] = [];
  const op = async <T>(p: Promise<T>, what: string): Promise<T | null> => {
    try {
      return await bounded(p, spec.opTimeoutMs, what);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
      return null;
    }
  };
  let settled = false;
  let running: Promise<number> | undefined;
  const abandon = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestStop!: () => void;
  const stopped = new Promise<void>((res) => (requestStop = res));
  const onAbort = () => {
    r.interrupted = true;
    requestStop();
  };
  // Kill and rm only a container this execution created (never another
  // execution's container that holds the same name).
  const ours = async (): Promise<boolean> => {
    const st = await op(docker.state(spec.name), `docker inspect ${spec.name}`);
    if (st && st.execution !== spec.executionId) {
      problems.push(
        `container ${spec.name} belongs to execution ${st.execution}; left untouched`,
      );
    }
    return st?.execution === spec.executionId;
  };
  const rmOurs = async () => {
    if (!await ours()) return;
    const rm = await op(docker.rm(spec.name), `docker rm -f ${spec.name}`);
    if (rm && rm.code !== 0 && !/no such container/i.test(rm.stderr)) {
      problems.push(
        `docker rm -f ${spec.name} exited ${rm.code}: ${rm.stderr.trim()}`,
      );
    }
  };
  try {
    timer = setTimeout(() => {
      r.timedOut = true;
      requestStop();
    }, spec.timeoutMs);
    if (stop?.aborted) onAbort();
    stop?.addEventListener("abort", onAbort, { once: true });
    // An interrupt before the start never starts a (possibly paid) sandbox.
    if (!r.interrupted) {
      running = docker.run(args, {
        stdoutPath: spec.rawLog,
        stderrPath: spec.stderrLog,
        maxBytes: spec.maxCaptureBytes,
        onStarted: () => (r.started = true),
        onOverflow: () => {
          r.overflow = true;
          requestStop();
        },
        abort: abandon.signal,
      }).finally(() => (settled = true));
      const first = await Promise.race([
        running.then((c) => ({ c })),
        stopped.then(() => null),
      ]);
      if (first) r.exitCode = first.c;
      else {
        // Stop: kill (bounded); a failed or hung kill goes straight to rm -f,
        // a kill that does not end the run gets rm -f after the grace.
        const k = await ours()
          ? await op(docker.kill(spec.name), `docker kill ${spec.name}`)
          : null;
        let res: number | "timeout" = "timeout";
        if (k === 0) res = await settle(running, spec.killGraceMs);
        if (res === "timeout") {
          await rmOurs();
          res = await settle(running, spec.killGraceMs);
        }
        if (res !== "timeout") r.exitCode = res;
      }
    }
  } catch (err) {
    r.startError = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
    stop?.removeEventListener("abort", onAbort);
    if (running && !settled) {
      // Abandon the docker client; realDocker bounds its own settlement.
      abandon.abort();
      await settle(running.catch(() => 0), spec.killGraceMs + spec.opTimeoutMs);
      problems.push(
        settled
          ? `docker run for ${spec.name} did not return after kill and rm -f; client killed`
          : `container ${spec.name} did not stop after kill, rm -f and abort`,
      );
    }
    await rmOurs();
    let gone = false;
    try {
      const st = await bounded(
        docker.state(spec.name),
        spec.opTimeoutMs,
        `docker inspect ${spec.name}`,
      );
      // Another (labeled) execution's container under this name means ours never existed.
      gone = st === null ||
        (st.execution !== null && st.execution !== spec.executionId);
      if (!gone) {
        problems.push(`container ${spec.name} still exists after rm -f`);
      }
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
    // A run that never settled (even one pending before its start) is never gone.
    r.confirmedGone = (running === undefined || settled) && gone;
    if (problems.length > 0) r.cleanup = [...new Set(problems)].join("; ");
  }
  r.wall_ms = performance.now() - t0;
  return r;
}

export async function sweepOwnedSandboxes(
  docker: DockerCli,
  owner: string,
  opTimeoutMs = OP_TIMEOUT_MS,
): Promise<string[]> {
  const names = await bounded(
    docker.listOwned(owner),
    opTimeoutMs,
    "docker ps",
  );
  // The owner label is filtered by docker; the prefix is re-checked here, so
  // a container needs both to be touched.
  const ours = names.filter((n) => n.startsWith(SANDBOX_PREFIX));
  const failed: string[] = [];
  for (const n of ours) {
    try {
      const r = await bounded(docker.rm(n), opTimeoutMs, `docker rm -f ${n}`);
      if (r.code !== 0 && !/no such container/i.test(r.stderr)) {
        failed.push(`${n}: ${r.stderr.trim()}`);
      } else if (
        await bounded(docker.state(n), opTimeoutMs, `docker inspect ${n}`)
      ) {
        failed.push(`${n}: still exists after rm -f`);
      }
    } catch (err) {
      failed.push(`${n}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (failed.length > 0) {
    throw new ContainerError(
      `could not remove leftover sandboxes: ${failed.join("; ")}`,
      failed[0]!.split(":")[0]!,
      "setup",
    );
  }
  return ours;
}

export const SECRETS_DIR_PREFIX = "cg-harness-secrets-";
/** Empty marker in the secrets mount; every entrypoint waits for it before starting. Never a secret. */
export const READY_FILE = "ready";

export type IcaclsRunner = (
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Where custody dirs live and whose they are (`<prefix><owner>.<uuid>`). */
export interface SecretCustody {
  /** Harness-private root (M1-22 privateRoot), never under results/. */
  privateRoot: string;
  owner: string;
  /** Windows: the icacls runner (tests inject one) and the account to grant. */
  icacls?: IcaclsRunner;
  user?: string;
}

const system32 = (exe: string) =>
  `${Deno.env.get("SystemRoot") ?? "C:\\Windows"}\\System32\\${exe}`;

async function runTool(exe: string, args: string[]) {
  const r = await new Deno.Command(system32(exe), {
    args,
    clearEnv: true,
    env: dockerEnv(),
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(OP_TIMEOUT_MS),
  }).output();
  const dec = new TextDecoder();
  return {
    code: r.code,
    stdout: dec.decode(r.stdout),
    stderr: dec.decode(r.stderr),
  };
}

/** DOMAIN\\user of this process: USERDOMAIN and USERNAME, else whoami. */
async function currentUser(): Promise<string> {
  const d = Deno.env.get("USERDOMAIN");
  const u = Deno.env.get("USERNAME");
  if (d && u) return `${d}\\${u}`;
  const r = await runTool("whoami.exe", []);
  const who = r.stdout.trim();
  if (r.code !== 0 || !/^[^\\\s]+\\[^\\\s]+$/.test(who)) {
    throw new ConfigurationError(
      `cannot resolve the current user: ${who || r.stderr.trim()}`,
    );
  }
  return who;
}

/**
 * Parse `icacls <dir>` strictly: the listing is for dir, the summary reports
 * one file and no failure, and the entries are exactly SYSTEM and user with
 * full control, object and container inherit, none inherited.
 */
export function aclIsPrivate(
  listing: string,
  dir: string,
  user: string,
  /** "(oi)(ci)" for a directory (inherited by its files), "" for a file. */
  inherit = "(oi)(ci)",
): boolean {
  const lines = listing.split(/\r?\n/);
  const end = lines.indexOf("");
  if (end < 1 || !lines[0]!.startsWith(`${dir} `)) return false;
  const summary = lines.slice(end + 1).filter((l) => l.trim() !== "");
  if (
    summary.length !== 1 ||
    summary[0]!.trim() !==
      "Successfully processed 1 files; Failed processing 0 files"
  ) return false;
  const entries = [lines[0]!.slice(dir.length + 1), ...lines.slice(1, end)].map(
    (l) => l.trim().toLowerCase(),
  );
  const want = [
    `nt authority\\system:${inherit}(f)`,
    `${user.toLowerCase()}:${inherit}(f)`,
  ];
  return entries.length === 2 && want.every((w) => entries.includes(w));
}

/** Restrict a new custody dir to this user (and SYSTEM), verified, before any secret is written. */
function restrictDir(dir: string, custody: SecretCustody): Promise<void> {
  return restrictPath(dir, custody, "dir");
}

/**
 * Restrict a new, still empty custody dir or file to this user (and
 * SYSTEM) with no inherited entries, verified strictly, before any secret is
 * written into it.
 */
export async function restrictPath(
  path: string,
  custody: Pick<SecretCustody, "icacls" | "user">,
  kind: "dir" | "file",
): Promise<void> {
  if (Deno.build.os !== "windows") {
    await Deno.chmod(path, kind === "dir" ? 0o700 : 0o600);
    return;
  }
  const flags = kind === "dir" ? "(OI)(CI)" : "";
  const what = kind === "dir" ? "secrets dir" : "secrets file";
  const icacls = custody.icacls ??
    ((args: string[]) => runTool("icacls.exe", args));
  const user = custody.user ?? await currentUser();
  const grant = await icacls([
    path,
    "/inheritance:r",
    "/grant:r",
    `${user}:${flags}F`,
    `SYSTEM:${flags}F`,
  ]);
  if (grant.code !== 0) {
    throw new ConfigurationError(
      `could not set the ACL of ${what} ${path}: icacls exited ${grant.code}: ${grant.stderr.trim()}`,
    );
  }
  const listing = await icacls([path]);
  if (
    listing.code !== 0 ||
    !aclIsPrivate(listing.stdout, path, user, flags.toLowerCase())
  ) {
    throw new ConfigurationError(
      `refusing ${what} ${path}: its ACL is not exactly ${user} and SYSTEM: ${listing.stdout.trim()}`,
    );
  }
}

const ownerPrefix = (owner: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(owner)) {
    throw new ConfigurationError(`bad sandbox owner: ${owner}`);
  }
  return `${SECRETS_DIR_PREFIX}${owner}.`;
};

export async function prepareSecrets(
  source: string,
  files: readonly string[],
  backendToken: string,
  custody: SecretCustody,
): Promise<{ dir: string; values: SecretValue[] }> {
  const base = await validatedDest(join(custody.privateRoot, "secrets"));
  const dir = join(base, `${ownerPrefix(custody.owner)}${crypto.randomUUID()}`);
  await Deno.mkdir(dir, { mode: 0o700 });
  try {
    await restrictDir(dir, custody);
    const values: SecretValue[] = [];
    const add = async (name: string, value: string) => {
      if (value.length < MIN_SECRET_LENGTH) {
        throw new ConfigurationError(
          `secret ${name} is shorter than ${MIN_SECRET_LENGTH} characters`,
        );
      }
      await Deno.writeTextFile(join(dir, name), value, {
        createNew: true,
        mode: 0o600,
      });
      values.push({ name, value });
    };
    for (const f of files) {
      if (!/^[A-Za-z0-9._-]+$/.test(f) || f.startsWith(".")) {
        throw new ConfigurationError(`bad secret file name: ${f}`);
      }
      let v: string;
      try {
        v = (await Deno.readTextFile(join(source, f))).trim();
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          throw new ConfigurationError(
            `harness secret ${f} not found in ${source}`,
          );
        }
        throw err;
      }
      await add(f, v);
    }
    await add("backend-token", backendToken);
    return { dir, values };
  } catch (err) {
    try {
      await removeSecrets(dir);
    } catch (rmErr) {
      throw new CentralGaugeError(
        `${err instanceof Error ? err.message : err}; and then: ${
          (rmErr as Error).message
        }`,
        "SECRETS_CLEANUP_ERROR",
        { dir },
      );
    }
    throw err;
  }
}

/**
 * Remove a custody dir; already gone is fine. A failure (for example a
 * bind mount still held by a container that is not confirmed gone) is
 * retried briefly, then reported with the dir; sweepStaleSecrets at the
 * next start retries after the container sweep.
 */
export async function removeSecrets(
  dir: string,
  attempts = 3,
  delayMs = 200,
): Promise<void> {
  for (let i = 1;; i++) {
    try {
      await Deno.remove(dir, { recursive: true });
      return;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return;
      if (i >= attempts) {
        throw new CentralGaugeError(
          `could not remove secrets dir ${dir}: ${(err as Error).message}`,
          "SECRETS_CLEANUP_ERROR",
          { dir },
        );
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** Startup sweep: remove this owner's custody dirs left by a crash. Run after sweepOwnedSandboxes. */
export async function sweepStaleSecrets(
  privateRoot: string,
  owner: string,
): Promise<string[]> {
  const prefix = ownerPrefix(owner);
  const base = join(privateRoot, "secrets");
  const names: string[] = [];
  try {
    for await (const e of Deno.readDir(base)) {
      if (e.isDirectory && e.name.startsWith(prefix)) names.push(e.name);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  for (const n of names) await removeSecrets(join(base, n));
  return names;
}

/** Replace every exact secret value in a string, longest first. */
export function redactText(
  text: string,
  secrets: SecretValue[],
): { text: string; count: number } {
  let count = 0;
  let next = text;
  for (
    const s of [...secrets].sort((a, b) => b.value.length - a.value.length)
  ) {
    if (s.value.length === 0) continue;
    count += next.split(s.value).length - 1;
    next = next.replaceAll(s.value, `[REDACTED:${s.name}]`);
  }
  const p = redactPatternText(next);
  return { text: p.text, count: count + p.count };
}

const utf16le = (v: string) => {
  const out = new Uint8Array(v.length * 2);
  for (let i = 0; i < v.length; i++) {
    out[2 * i] = v.charCodeAt(i) & 0xff;
    out[2 * i + 1] = v.charCodeAt(i) >> 8;
  }
  return out;
};

/**
 * A capture cut by the byte cap or a kill can end inside a secret, and exact
 * redaction misses that prefix. The longest trailing proper prefix of any
 * secret (UTF-8 or UTF-16LE) is replaced by its marker.
 * ponytail: may over-redact a last byte that happens to start a secret.
 */
function redactCutTail(
  data: Uint8Array,
  secrets: SecretValue[],
): { out: Uint8Array; count: number } {
  const enc = new TextEncoder();
  let best: { k: number; mark: Uint8Array } | null = null;
  for (const s of secrets) {
    if (s.value.length === 0) continue;
    const mark = `[REDACTED:${s.name}]`;
    for (
      const [needle, m] of [[enc.encode(s.value), enc.encode(mark)], [
        utf16le(s.value),
        utf16le(mark),
      ]] as const
    ) {
      for (
        let k = Math.min(needle.length - 1, data.length);
        k > (best?.k ?? 0);
        k--
      ) {
        const tail = data.subarray(data.length - k);
        if (tail.every((b, i) => b === needle[i])) {
          best = { k, mark: m };
          break;
        }
      }
    }
  }
  if (!best) return { out: data, count: 0 };
  const out = new Uint8Array(data.length - best.k + best.mark.length);
  out.set(data.subarray(0, data.length - best.k));
  out.set(best.mark, data.length - best.k);
  return { out, count: 1 };
}

/** Copy quarantined files to fresh destinations, byte-wise redacted. Missing sources are skipped. */
export async function publishRedacted(
  files: { src: string; dest: string }[],
  secrets: SecretValue[],
): Promise<number> {
  let count = 0;
  for (const f of files) {
    let data: Uint8Array;
    try {
      data = await Deno.readFile(f.src);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) continue;
      throw err;
    }
    const r = redactBytes(data, secrets);
    const t = redactCutTail(r.out, secrets);
    // Token patterns after the exact custody secrets (M2-02).
    const p = redactPatterns(t.out);
    count += r.count + t.count + p.count;
    await Deno.mkdir(dirname(f.dest), { recursive: true });
    await Deno.writeFile(f.dest, p.out, { createNew: true });
  }
  return count;
}
