/**
 * One execution (spec 1a section 5 items 1-6) and one cell (section 8).
 * Live path: gate -> stage (private) -> pin image -> config -> grant ->
 * intent -> secrets + custody -> docker run (quarantine) -> revoke (drain)
 * -> delete secrets mount -> confirmed termination -> draft -> publish.
 * Recovery resumes from the intent or the draft; every step is idempotent.
 *
 * Private state (work, quarantine, custody, pending, intents, task
 * snapshots) lives under env.privateRoot, never under results/; results/
 * receives only redacted, finished files.
 */

import { createHash } from "node:crypto";
import { dirname, join, resolve, SEPARATOR } from "@std/path";
import type { PricingBook } from "./pricing.ts";
import type { RefappRef, SymbolPackage } from "./identity.ts";
import type { ResolvedManifest } from "./manifest.ts";
import type {
  Block,
  ExecutionRecord,
  JudgmentRecord,
  RunKind,
} from "./records.ts";
import type { QualifyManifest } from "./qualify.ts";
import type { LoadedTask } from "./task.ts";
import {
  ConfigurationError,
  ContainerError,
  ValidationError,
} from "../errors.ts";
import {
  incompleteTelemetry,
  observedMismatch,
  type ParsedRun,
  requestedComponents,
} from "./adapter.ts";
import { adapterFor } from "./adapters/mod.ts";
import {
  inventoried,
  INVENTORY_KEYS,
  strings,
} from "./adapters/claude-code.ts";
import { piConfigInvalid } from "./adapters/pi.ts";
import type { Backend, HostLogLine } from "./backend.ts";
import type { BcLane, DeployContext } from "./bc-lane.ts";
import { reserveCredentialRun } from "./credential-budget.ts";
import {
  type EgressLogLine,
  type EgressRuntime,
  evaluatePreflight,
  hostsForRoutes,
  PLACED_ENV,
  preflightExpect,
  PROXY_PORT,
  proxyCredentialForms,
  RECORD_MODE_FILE,
  RECORDED_HOSTS_PATH,
  recordedHostsJson,
  SANDBOX_NETWORK,
  sandboxSource,
} from "./egress.ts";
import type { Registration, RegistrationFailure } from "./egress-proxy.ts";
import {
  exists,
  freezeWorkspace,
  safeCopyTree,
  type scanReparsePoints,
  validatedDir,
} from "./fsutil.ts";
import { hashFile, hashJson, hashTree } from "./hash.ts";
import { imageFacts } from "./images.ts";
import { taskSetIdentity } from "./identity.ts";
import { forTask } from "./manifest.ts";
import {
  ExecutionRecordSchema,
  JudgmentRecordSchema,
  outcomePolicy,
  RecordStore,
  retryProblem,
} from "./records.ts";
import {
  bounded,
  checkSandboxPrivilege,
  createSecretsDir,
  type DockerCli,
  type IcaclsRunner,
  MIN_SECRET_LENGTH,
  OP_TIMEOUT_MS,
  publishRedacted,
  readSecretValues,
  READY_FILE,
  redactText,
  restrictPath,
  runSandbox,
  sandboxName,
  type SandboxResult,
  type SecretValue,
  stagePiConfig,
  sweepOwnedSandboxes,
  sweepStaleSecrets,
  teardownSandbox,
  writeSecretFiles,
} from "./sandbox.ts";
import { readAppGraph, type StagedWorkspace, TASK_SOURCES } from "./staging.ts";
import { selectJudgment } from "./outcome.ts";
import { currentScorerFingerprint, judge, writeVerdictLog } from "./verdict.ts";
import {
  type AnalyzersSchema,
  canaryCheck,
  type FinalCode,
  finalCode,
  finalCodeCounts,
  type FinalCounts,
  loadTaskMeasures,
  type Measure,
  measureFingerprint,
  type MeasureRecord,
  missing,
  na,
  ok,
  partialCredit,
  reuseCheck,
  type ReuseSchema,
  writeMeasureRecord,
} from "./measures.ts";
import { buildVerdictWorkspace } from "./verdict-workspace.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import {
  InfraRetriesExhaustedError,
  NoEligibleContainersError,
} from "../parallel/errors.ts";
import type { z } from "zod";

export type PublishStep =
  | "draft"
  | "run"
  | "execution"
  | "artifact"
  | "judgment";

export interface HarnessEnv {
  repoRoot: string;
  harnessRoot: string;
  /** results/harness: finished, redacted files only. */
  resultsRoot: string;
  /** Private state (work, quarantine, custody, pending, intents), never under results/. */
  privateRoot: string;
  store: RecordStore;
  lane: BcLane;
  backend: Backend;
  backendUrl: string;
  docker: DockerCli;
  owner: string;
  symbols: SymbolPackage[];
  symbolStore: string;
  secretsSource: string;
  /** Windows custody ACL seam (tests inject icacls); defaults to the real icacls and user. */
  secretAcl?: { icacls: IcaclsRunner; user: string };
  /** Drive type of the private root ("Fixed" is the only local type accepted); tests inject it. */
  driveType?: (path: string) => Promise<string>;
  /** Test seam for the freeze's reparse attribute scan (default: the real pwsh scan). */
  scanReparsePoints?: typeof scanReparsePoints;
  /** The per-container BC ledger; trusted roots are set per grant and judgment, never here. */
  deploy: Pick<DeployContext, "ledgerRoot">;
  pricing(at: Date): Promise<PricingBook>;
  /** Started by a human at a terminal; no automatic retries. */
  supervised: boolean;
  /** True only when M1-24 confirmed the verified enforcement state at start (M1-33, M1-34). */
  egressEnforced: boolean;
  /**
   * OAuth host record mode (M1-34 Step 11): the supervised Claude Code cell
   * in the qualified state whose proxy allows any DNS name on 443 and whose
   * allowed CONNECT hosts become harness/egress/recorded-hosts.json.
   */
  recordOAuthHosts?: boolean;
  /**
   * Set when the verified marker is qualified or authorized (M1-33): every
   * sandbox goes on the internal network. A normal cell also runs behind the
   * execution's proxy, and its secrets and ready are written only after the
   * in-sandbox preflight. A stub cell gets no proxy, preflight or egress
   * record (it joins only to reach the gateway-bound backend). Unset: the
   * default network. Required when egressEnforced.
   */
  egress?: EgressRuntime;
  /**
   * The marker's proxy_isolation read under the lock when the environment
   * opened placed (M1-33e), fixed for the life of the environment: runCampaign
   * gates concurrency on it and each cell's verify() requires the same value.
   */
  proxyIsolation?: unknown;
  /** Shared cross-lane reservation ledger for supervised credential-bearing runs. */
  credentialLedger: string | null;
  /** Coordination lane name recorded with a reservation. */
  lane_id: string;
  /** Qualification manifest (--qualify-manifest): names the variants mock arms apply (M1-35). */
  qualifyManifest?: QualifyManifest | null;
  /** Operator interrupt (Ctrl+C, M1-24). */
  stop?: AbortSignal;
  now?: () => Date;
  timeoutMsFor?: (minutes: number) => number;
  killGraceMs?: number;
  opTimeoutMs?: number;
  /** Test seam: the inventory wait deadline (default PREFLIGHT_TIMEOUT_MS, 180 s). */
  inventoryTimeoutMs?: number;
  maxCaptureBytes?: number;
  /**
   * Stub-provider cell (M2-08): a dir holding stub-anthropic.mjs and
   * scenario.json. Read only when an attempt starts; everything later reads
   * the attempt's persisted mode.
   */
  stubProvider?: { dir: string; imageOverride?: string } | undefined;
  /** Test seams: crash after a publication step, before the draft, or inside cleanup. */
  hooks?: {
    /** The intent was written in the prepared phase (nothing released yet). */
    prepared?(id: string): Promise<void>;
    after?(step: PublishStep): Promise<void>;
    beforeDraft?(): Promise<void>;
    afterPublished?(): Promise<void>;
  };
}

/** In-container stub (M2-04) on this port; non-secret env only. */
const STUB_PORT = 3400;
const STUB_ENV: Record<string, string> = {
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  // Carried M2-04 risks: a scripted 5xx ends in a fatal exit, not a timeout
  // kill (default 10 retries, backoff to 32 s); ToolSearch stays on with a
  // non-Anthropic base URL.
  CLAUDE_CODE_MAX_RETRIES: "2",
  ENABLE_TOOL_SEARCH: "true",
};
export const STUB_COMMAND = [
  "powershell",
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  // The stub server outlives the entry and keeps `docker run` attached, so the
  // finally stops it on every path, the listen failure included (M3-07b).
  [
    `$stub = Start-Process -PassThru -NoNewWindow 'C:\\Program Files\\nodejs\\node.exe' -ArgumentList 'C:\\cg-stub\\stub-anthropic.mjs','C:\\cg-stub\\scenario.json',(Join-Path $env:TEMP 'cg-stub.jsonl'),'${STUB_PORT}'`,
    "$rc = 1",
    `try { $up = $false; for ($i = 0; $i -lt 100 -and -not $up; $i++) { try { (New-Object Net.Sockets.TcpClient('127.0.0.1', ${STUB_PORT})).Close(); $up = $true } catch { Start-Sleep -Milliseconds 200 } }; ` +
    "if (-not $up) { [Console]::Error.WriteLine('CG_STUB stub did not listen'); $rc = 2 } else { & C:\\run.ps1; $rc = $LASTEXITCODE } } " +
    "finally { Get-Content (Join-Path $env:TEMP 'cg-stub.jsonl') -ErrorAction SilentlyContinue | ForEach-Object { [Console]::Error.WriteLine('CG_STUB ' + $_) }; Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue }",
    "exit $rc",
  ].join("; "),
];

/**
 * The override image: same harness (label) and same image revision as the
 * arm (whose revision runtimeFacts tied to config.image_revision), recorded
 * with its own base digest.
 */
async function overrideImage(
  env: HarnessEnv,
  id: string,
  arm: Pick<ResolvedManifest, "harness" | "image">,
): Promise<ResolvedManifest["image"]> {
  const harness = arm.harness;
  const want = arm.image.revision ?? null;
  // imageFacts: labels, immutable id and the shipped MCP definition (M2-09).
  const f = await bounded(
    imageFacts(env.docker, id, env.owner),
    env.opTimeoutMs ?? OP_TIMEOUT_MS,
    "docker image inspect",
  );
  if (f.digest !== id) {
    throw new ConfigurationError(`--image ${id} resolves to ${f.digest}`);
  }
  if (f.harness !== harness) {
    throw new ConfigurationError(
      `--image ${id} is a ${f.harness} image, not ${harness}`,
    );
  }
  if (f.revision !== want) {
    const say = (r: string | null) =>
      r === null ? "no revision" : `revision ${r}`;
    throw new ConfigurationError(
      `--image ${id} has ${say(f.revision)}, the arm wants ${say(want)}`,
    );
  }
  return {
    digest: f.digest,
    base_digest: f.base_digest,
    ...(f.revision === null ? {} : { revision: f.revision }),
  };
}

/** Stub cells publish only under results/harness/stub-cells (never beside real campaigns). */
function checkStubRoot(resultsRoot: string): void {
  if (
    !/[\\/]results[\\/]harness[\\/]stub-cells(?:[\\/]|$)/i.test(
      resolve(resultsRoot),
    )
  ) {
    throw new ConfigurationError(
      `a stub-provider cell publishes only under results/harness/stub-cells, not ${resultsRoot}`,
    );
  }
}

/** A dummy (never a credential) for every credential file of the arm. */
async function dummySecrets(
  dir: string,
  files: readonly string[],
): Promise<string> {
  await Deno.mkdir(dir, { recursive: true });
  for (const f of files) {
    await Deno.writeTextFile(
      join(dir, f),
      "stub-dummy-credential-".padEnd(40, "0"),
    );
  }
  return dir;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface CellRef {
  campaignId: string;
  block: Block;
  orderInBlock: number;
  arm: string;
  armManifest: ResolvedManifest;
  armManifestHash: string;
  task: LoadedTask;
  taskVisibleHash: string;
  oracleHash: string;
  refapp: RefappRef;
}

export interface AttemptRef {
  attempt: number;
  runKind: RunKind;
  retryOf: string | null;
}

interface Intent {
  v: 2;
  execution_id: string;
  /** prepared: nothing released; released: custody written, sandbox may start; published: records written. */
  phase: "prepared" | "released" | "published";
  /** The results root of the command that started the attempt (recovery publishes there). */
  results_root: string;
  cell: Omit<CellRef, "task"> & { task_dir: string };
  /** Private snapshot of the task directory at run start (folder named by the task id). */
  task_snapshot: string;
  /** The effective execution manifest (forTask), never re-derived. */
  manifest: ResolvedManifest;
  at: AttemptRef;
  started_at: string;
  /** The pricing book loaded at run start: recovery prices with it. */
  pricing: PricingBook;
  sandbox: string;
  workspace: string;
  pristine_hash: string;
  /** Absent before M2-08: normal. */
  mode?: AttemptMode;
  stub?: StubProvenance | null;
}

type AttemptMode = "normal" | "stub";
interface StubProvenance {
  scenario_sha256: string;
  image_override: string | null;
}

interface Draft {
  v: 1;
  /** Absent before M2-08: normal. */
  mode?: AttemptMode;
  stub?: StubProvenance | null;
  execution: ExecutionRecord;
  artifact: { workspace_hash: string; stored_path: string } | null;
  usage_reset_at: string | null;
}

export function privatePaths(env: HarnessEnv, id: string) {
  const p = env.privateRoot;
  return {
    work: join(p, "work", id),
    quarantine: join(p, "quarantine", id),
    custody: join(p, "custody", `${id}.json`),
    pending: join(p, "pending", id),
    intent: join(p, "intents", `${id}.json`),
    taskCopy: join(p, "taskcopy", id),
    /** Salted hashes of the custody secrets: kept after publication so a rejudge still redacts. */
    keys: join(p, "redaction", `${id}.json`),
    /** Private stub marker, kept after publication beside the keys: judging never trusts results/ alone. */
    stubMarker: join(p, "redaction", `${id}.stub.json`),
    raw: join(p, "quarantine", id, "raw.jsonl"),
    stderr: join(p, "quarantine", id, "stderr.txt"),
    host: join(p, "quarantine", id, "host-log.jsonl"),
    trace: join(p, "quarantine", id, "trace.jsonl"),
    /** Every proxy decision of this execution (M1-33). */
    egress: join(p, "quarantine", id, "egress.jsonl"),
    /** The parsed in-sandbox preflight probe lines, pass or fail (M3-09a). */
    preflight: join(p, "quarantine", id, "preflight.jsonl"),
  };
}

const msg = (err: unknown) => err instanceof Error ? err.message : String(err);

/** Temp write, sync, rename: a power loss never leaves a short file under the final name. */
async function writeAtomic(path: string, text: string) {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    const f = await Deno.open(tmp, { write: true, createNew: true });
    try {
      const bytes = new TextEncoder().encode(text);
      for (let off = 0; off < bytes.length;) {
        off += await f.write(bytes.subarray(off));
      }
      await f.sync();
    } finally {
      f.close();
    }
    await Deno.rename(tmp, path);
  } catch (err) {
    await Deno.remove(tmp).catch(() => {});
    throw err;
  }
}

/** Remove `.tmp-` leftovers of writeAtomic in a private dir (custody temps hold plaintext secrets). */
async function removeTemps(dir: string, prefix = ""): Promise<void> {
  let names: string[];
  try {
    names = [...Deno.readDirSync(dir)].filter((e) =>
      e.isFile && e.name.startsWith(prefix) && e.name.includes(".tmp-")
    ).map((e) => e.name);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    throw err;
  }
  for (const n of names) {
    await Deno.remove(join(dir, n)).catch((err) => {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    });
  }
}

/** Move an unreadable private file to privateRoot/broken for the operator; recovery continues. */
async function quarantineFile(
  env: HarnessEnv,
  path: string,
  name: string,
  why: string,
): Promise<void> {
  const dest = join(env.privateRoot, "broken", name);
  await Deno.mkdir(join(dest, ".."), { recursive: true });
  await Deno.rename(path, dest);
  console.warn(`[WARN] recovery: ${why}; moved ${path} to ${dest}`);
}

/** A private JSON file: missing is null, anything else unreadable names the file. */
async function readJson<T>(path: string): Promise<T | null> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw new ValidationError(`cannot read ${path}: ${msg(err)}`, [path]);
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new ValidationError(`invalid JSON in ${path}: ${msg(err)}`, [path]);
  }
}

/**
 * Redact every string (keys and values) before serializing: redacting the
 * serialized text would miss a secret that JSON escapes (a quote or a
 * backslash in it).
 */
function redactDeep(v: unknown, secrets: SecretValue[]): unknown {
  return mapStrings(v, (x) => redactText(x, secrets).text);
}

function mapStrings(v: unknown, f: (s: string) => string): unknown {
  if (typeof v === "string") return f(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f));
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [f(k), mapStrings(x, f)]),
    );
  }
  return v;
}

/**
 * A custody secret as a salted hash: judge output (BC test messages the
 * agent's code can assemble at runtime) is redacted with it, including on a
 * rejudge after the custody plaintext is deleted. Kept private.
 */
interface RedactionKey {
  name: string;
  length: number;
  salt: string;
  sha256: string;
}

const saltedHash = (salt: string, s: string) =>
  createHash("sha256").update(salt).update(s, "utf8").digest("hex");

function redactionKeys(secrets: SecretValue[]): RedactionKey[] {
  return secrets.map((s) => {
    const salt = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    return {
      name: s.name,
      length: s.value.length,
      salt,
      sha256: saltedHash(salt, s.value),
    };
  });
}

/**
 * Replace every window of a string whose salted hash matches a key, longest
 * key first. ponytail: one hash per position per key; fine for verdict-log
 * sizes, a rolling prefilter if logs ever reach many megabytes.
 */
function redactByKeys(text: string, keys: RedactionKey[]): string {
  let out = text;
  for (const k of [...keys].sort((a, b) => b.length - a.length)) {
    if (k.length === 0 || out.length < k.length) continue;
    let acc = "";
    let last = 0;
    for (let i = 0; i + k.length <= out.length;) {
      if (saltedHash(k.salt, out.slice(i, i + k.length)) === k.sha256) {
        acc += `${out.slice(last, i)}[REDACTED:${k.name}]`;
        i += k.length;
        last = i;
      } else i++;
    }
    out = acc + out.slice(last);
  }
  return out;
}

async function readRedactionKeys(
  env: HarnessEnv,
  id: string,
): Promise<RedactionKey[]> {
  const path = privatePaths(env, id).keys;
  const keys = await readJson<RedactionKey[]>(path);
  if (
    !Array.isArray(keys) ||
    !keys.every((k) =>
      typeof k?.name === "string" && Number.isSafeInteger(k.length) &&
      typeof k.salt === "string" && /^[0-9a-f]{64}$/.test(k.sha256)
    )
  ) {
    throw new ValidationError(
      `redaction keys ${path} for execution ${id} are missing or invalid; refusing to judge (nothing could be redacted)`,
      [path],
    );
  }
  return keys;
}

/**
 * C-03 run 002: why a forced judgment of `e` may not be written, else null.
 * At most one forced judgment per execution; `replaces` must be the judgment
 * the report selects on `oracle` (the campaign's); with `candidate`, the new
 * judgment must become the selected one (else clock skew keeps the old).
 */
export function forcedRefusal(
  e: ExecutionRecord,
  existing: JudgmentRecord[],
  oracle: string,
  replaces: string,
  candidate?: JudgmentRecord,
): string | null {
  const prior = existing.find((j) => j.execution_id === e.id && j.forced);
  if (prior) {
    return `execution ${e.id} already has forced judgment ${prior.id} (at most one forced rejudge per execution)`;
  }
  const used = selectJudgment(e, existing, oracle);
  if (used?.id !== replaces) {
    return `--replaces ${replaces} is not the judgment the report uses for execution ${e.id} (${
      used?.id ?? "none"
    })`;
  }
  if (
    candidate &&
    selectJudgment(e, [...existing, candidate], oracle)?.id !== candidate.id
  ) {
    return `forced judgment ${candidate.id} would not be the judgment the report selects for execution ${e.id} (an existing judgment on that oracle has a later ended_at; clock skew?)`;
  }
  return null;
}

/** C-03 review: a forced rejudge's reason as the judgment will record it (scrubbed). */
export async function scrubForcedReason(
  env: HarnessEnv,
  id: string,
  reason: string,
): Promise<string> {
  return scrubJudgeOutput(reason, await readRedactionKeys(env, id), env);
}

/** Judge output: custody secrets (by salted hash) and private paths scrubbed from every string. */
function scrubJudgeOutput<T>(v: T, keys: RedactionKey[], env: HarnessEnv): T {
  const paths = privatePathValues(env);
  return mapStrings(
    v,
    (x) => redactText(redactByKeys(x, keys), paths).text,
  ) as T;
}

const DRIVE_TYPE_PS = "[System.IO.DriveInfo]::new($env:CG_DRIVE).DriveType";
const driveTypes = new Map<string, string>();

/** Windows drive type (Fixed, Network, Removable, ...), one bounded Windows PowerShell call per drive. */
async function realDriveType(path: string): Promise<string> {
  // ponytail: POSIX network mounts are not detected; add a statfs check if a non-Windows host runs sandboxes.
  if (Deno.build.os !== "windows") return "Fixed";
  const drive = path.slice(0, 3).toUpperCase();
  const known = driveTypes.get(drive);
  if (known) return known;
  const exe = `${
    Deno.env.get("SystemRoot") ?? "C:\\Windows"
  }\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const out = await new Deno.Command(exe, {
    args: ["-NoProfile", "-NonInteractive", "-Command", DRIVE_TYPE_PS],
    env: { CG_DRIVE: drive },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(OP_TIMEOUT_MS),
  }).output().catch((err) => {
    throw new ConfigurationError(
      `cannot determine the drive type of ${drive}: ${msg(err)}`,
    );
  });
  const type = new TextDecoder().decode(out.stdout).trim();
  if (!out.success || type === "") {
    throw new ConfigurationError(
      `cannot determine the drive type of ${drive}: ${
        new TextDecoder().decode(out.stderr).trim()
      }`,
    );
  }
  driveTypes.set(drive, type);
  return type;
}

/**
 * The private root holds secret custody: canonical, local (no UNC path, a
 * fixed drive), disjoint from results/ and from the repo worktree. Checked
 * before anything is reserved or written.
 */
async function validatePrivateRoot(env: HarnessEnv): Promise<void> {
  const r = env.privateRoot;
  if (/^[\\/]{2}/.test(r)) {
    throw new ConfigurationError(
      `privateRoot ${r} is a UNC path; it must be on a local drive`,
    );
  }
  let canon: string;
  try {
    canon = await validatedDir(r);
  } catch (err) {
    throw new ConfigurationError(
      `privateRoot ${r} is not a canonical local directory (${msg(err)})`,
    );
  }
  const type = await (env.driveType ?? realDriveType)(canon);
  if (type !== "Fixed") {
    throw new ConfigurationError(
      `privateRoot ${canon} is on a ${type} drive; a network, removable or unknown drive is refused`,
    );
  }
  const fold = (x: string) => Deno.build.os === "windows" ? x.toLowerCase() : x;
  for (
    const [other, what] of [
      [env.resultsRoot, "results root"],
      [env.repoRoot, "repo worktree"],
    ] as const
  ) {
    const o = await Deno.realPath(resolve(other)).catch(() => resolve(other));
    const [a, b] = [fold(canon), fold(o)];
    if (a === b || a.startsWith(b + SEPARATOR) || b.startsWith(a + SEPARATOR)) {
      throw new ConfigurationError(
        `privateRoot ${canon} overlaps the ${what} ${o}; they must be disjoint`,
      );
    }
  }
}

/** Operator secret files as the adapter declares them: present and long enough (preflight, nothing released). */
async function checkOperatorSecrets(
  source: string,
  files: readonly string[],
): Promise<void> {
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
    if (v.length < MIN_SECRET_LENGTH) {
      throw new ConfigurationError(
        `secret ${f} is shorter than ${MIN_SECRET_LENGTH} characters`,
      );
    }
  }
}

/**
 * A private temp file for secret-bearing or secret-derived content: its
 * directory is restricted and verified owner-only first (nothing else can
 * be put in it by another account), then the temp file is created empty and
 * restricted and verified, all before any content is written.
 */
async function restrictedTemp(env: HarnessEnv, path: string): Promise<string> {
  const acl = env.secretAcl ?? {};
  const dir = dirname(path);
  await Deno.mkdir(dir, { recursive: true });
  await restrictPath(dir, acl, "dir");
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  (await Deno.open(tmp, { write: true, createNew: true, mode: 0o600 })).close();
  try {
    await restrictPath(tmp, acl, "file");
  } catch (err) {
    await Deno.remove(tmp).catch(() => {});
    throw err;
  }
  return tmp;
}

/** Write into a restricted temp file, sync, rename (the ACL moves with the file). */
async function commitTemp(tmp: string, path: string, text: string) {
  try {
    const f = await Deno.open(tmp, { write: true, truncate: true });
    try {
      const bytes = new TextEncoder().encode(text);
      for (let off = 0; off < bytes.length;) {
        off += await f.write(bytes.subarray(off));
      }
      await f.sync();
    } finally {
      f.close();
    }
    await Deno.rename(tmp, path);
  } catch (err) {
    await Deno.remove(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Absolute private paths (plain, forward-slash and JSON-escaped spellings)
 * are scrubbed from everything published, like secrets.
 */
function privatePathValues(env: HarnessEnv): SecretValue[] {
  const r = env.privateRoot;
  return [
    ...new Set([r, r.replaceAll("\\", "/"), JSON.stringify(r).slice(1, -1)]),
  ].map((value) => ({ name: "private-path", value }));
}

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp)$/i;

/** Spec 1b section 6: whether image attachments reached the model. */
export function imageAttachments(
  attachments: string[],
  support: boolean | null,
): ExecutionRecord["image_attachments"] {
  if (!attachments.some((a) => IMAGE_EXT.test(a))) return "none";
  return support === true
    ? "delivered"
    : support === false
    ? "unsupported"
    : "unknown";
}

/**
 * C:\config: settings.json, manifest.json and bundle copies. Each component
 * is copied first and its copy hashed, so what is mounted is what was
 * verified; any changed component (file or directory) is refused.
 */
export async function writeConfigDir(
  harnessRoot: string,
  dir: string,
  m: ResolvedManifest,
): Promise<void> {
  await Deno.mkdir(join(dir, "bundle"), { recursive: true });
  const parts: [string, { path: string; hash: string }][] = [];
  for (const k of ["instructions", "skills", "agents", "hooks"] as const) {
    const c = m[k];
    if (c !== null) parts.push([k, c]);
  }
  m.plugins.forEach((p, i) => parts.push([`plugins/${i}`, p]));
  for (const [name, c] of parts) {
    const src = join(harnessRoot, c.path);
    const dst = join(dir, "bundle", ...name.split("/"));
    const st = await Deno.lstat(src);
    let now: string;
    if (st.isSymlink) {
      throw new ConfigurationError(`component ${name} (${c.path}) is a link`);
    }
    // Part 1 rule: a directory hashes as its bundle tree, a file as hashJson({ file: sha256 }).
    if (st.isDirectory) {
      await safeCopyTree(src, dst);
      now = await hashTree(dst, "bundle");
    } else {
      await Deno.mkdir(dst, { recursive: true });
      const file = join(dst, c.path.split("/").pop()!);
      await Deno.copyFile(src, file);
      now = await hashJson({ file: await hashFile(dst, file) });
    }
    if (now !== c.hash) {
      throw new ConfigurationError(
        `component ${name} (${c.path}) changed since the campaign was created`,
      );
    }
  }
  await Deno.writeTextFile(
    join(dir, "settings.json"),
    JSON.stringify(
      {
        harness: m.harness,
        harness_version: m.harness_version,
        models: m.models,
        settings: m.settings.native,
        limits: m.limits,
        toolchain: m.toolchain,
      },
      null,
      2,
    ) + "\n",
  );
  await Deno.writeTextFile(
    join(dir, "manifest.json"),
    JSON.stringify(m, null, 2) + "\n",
  );
}

/** Nothing ran: exact zero cost. */
function notStarted(exitCode: number | null): ParsedRun {
  return {
    telemetry: {
      harness_version: null,
      cost_usd: 0,
      cost_source: "estimated",
      pricing_snapshot: "none: the harness did not start",
      reported_cost_usd: null,
      per_model: [],
      turns: null,
      compactions: null,
      wall_ms: null,
      exit_code: exitCode,
      stop_reason: null,
      refusal_detected: null,
      raw_usage: null,
    },
    observed: { harness_version: null, models: null, loaded_components: null },
    unobservable: [],
    didWork: false,
    termination: null,
    usageResetAt: null,
    imageSupport: null,
    traceEvents: 0,
  };
}

/** The harness ran but its log was refused (contradictory records): everything unknown. */
function unparsed(exitCode: number | null, m: ResolvedManifest): ParsedRun {
  const p = notStarted(exitCode);
  return {
    ...p,
    telemetry: {
      ...p.telemetry,
      cost_usd: null,
      cost_source: null,
      pricing_snapshot: null,
    },
    unobservable: requestedComponents(m),
  };
}

/** raw_usage.stream_problems of an adapter parse (M1-32), [] when absent. */
function streamProblems(raw: unknown): string[] {
  const p = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)["stream_problems"]
    : undefined;
  return Array.isArray(p) ? p.map(String) : [];
}

/** Backend host log, tolerant of a line cut by a crash: bad lines are counted, never fatal. */
async function hostLog(
  path: string,
): Promise<{ lines: HostLogLine[]; bad: number[] }> {
  let text = "";
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw new ValidationError(`cannot read host log ${path}: ${msg(err)}`, [
        path,
      ]);
    }
  }
  const lines: HostLogLine[] = [];
  const bad: number[] = [];
  for (const [i, l] of text.split(/\r?\n/).entries()) {
    if (l.trim() === "") continue;
    try {
      lines.push(JSON.parse(l) as HostLogLine);
    } catch {
      bad.push(i + 1);
    }
  }
  return { lines, bad };
}

async function stage(
  env: HarnessEnv,
  cell: CellRef,
  out: string,
): Promise<StagedWorkspace> {
  return await TASK_SOURCES[cell.task.task.source]({
    repoRoot: env.repoRoot,
    task: cell.task,
    refapp: cell.refapp,
    symbols: env.symbols,
    symbolStore: env.symbolStore,
    out,
  });
}

/**
 * Strict: a released attempt must have its exact redaction set (round 3 B3).
 * Missing or unreadable stops recovery (intent kept); present but not a
 * valid redaction set (a short write, corruption) is "corrupt".
 */
async function readCustody(path: string): Promise<SecretValue[] | "corrupt"> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    throw new ContainerError(
      `secret custody ${path} is unavailable (${
        msg(err)
      }); refusing to publish, intent kept`,
      "custody",
      "stop",
    );
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return "corrupt";
  }
  const ok = Array.isArray(v) && v.length > 0 &&
    v.every((x) =>
      x !== null && typeof x === "object" &&
      typeof (x as SecretValue).name === "string" &&
      typeof (x as SecretValue).value === "string" &&
      (x as SecretValue).value.length > 0
    );
  return ok ? v as SecretValue[] : "corrupt";
}

interface DraftInput {
  id: string;
  cell: CellRef;
  at: AttemptRef;
  started_at: string;
  manifest: ResolvedManifest;
  workspace: string;
  pristineHash: string;
  sandbox: SandboxResult;
  setupError: string | null;
  pricing: PricingBook;
  interrupted: boolean;
  /** The exact secrets released to this attempt ([] only when nothing was released). */
  secrets: SecretValue[];
  /** The attempt's persisted mode (intent), never the current command's. */
  mode: AttemptMode;
  stub: StubProvenance | null;
  /** egress_preflight_failed, egress_violation, egress_log_failed or egress_proxy_failed (M1-33, M1-33d); privilege_check_failed (H-01); pi_config_staging_failed (H-01 run 005). */
  egressStop?: string | null;
  /** The component inventory refused the arm before any credential was released: nothing paid, cost exactly 0. */
  preStart?: boolean;
}

/** Everything after the container is confirmed gone: freeze, parse, stage redacted files, save the draft. */
async function buildDraft(env: HarnessEnv, f: DraftInput): Promise<Draft> {
  const now = env.now ?? (() => new Date());
  const adapter = adapterFor(f.manifest.harness);
  const p = privatePaths(env, f.id);
  const secrets = f.secrets;
  /** Secrets and private paths: what may never reach results/. */
  const scrub = [...secrets, ...privatePathValues(env)];
  const started = f.sandbox.started;
  const frozen = started && await exists(f.workspace)
    ? await freezeWorkspace({
      resultsRoot: env.resultsRoot,
      privateRoot: env.privateRoot,
      workspace: f.workspace,
      secrets,
      ...(env.scanReparsePoints
        ? { scanReparsePoints: env.scanReparsePoints }
        : {}),
    })
    : null;
  let parseError: string | null = null;
  let parsed: ParsedRun;
  if (!started) parsed = notStarted(f.sandbox.exitCode);
  else {
    try {
      parsed = await adapter.parse({
        rawLog: p.raw,
        stderrLog: p.stderr,
        exitCode: f.sandbox.exitCode,
        manifest: f.manifest,
        pricing: f.pricing,
        traceOut: p.trace,
      });
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      parseError = err.message;
      parsed = unparsed(f.sandbox.exitCode, f.manifest);
    }
  }
  // M1-32 ruling: stream problems with no usable result expose infra; with
  // a usable result they make the cost unprovable.
  const problems = started ? streamProblems(parsed.telemetry.raw_usage) : [];
  let telemetry = f.preStart
    ? notStarted(f.sandbox.exitCode).telemetry
    : parsed.telemetry;
  if (!f.preStart && parsed.termination !== null && problems.length > 0) {
    telemetry = {
      ...telemetry,
      cost_usd: null,
      cost_source: null,
      pricing_snapshot: null,
    };
  }
  const host = await hostLog(p.host);
  const infraReasons = [
    ...(parsed.termination === null && problems.length > 0
      ? [
        `no usable result record; non-JSON harness stdout or other stream problems: ${
          problems.join("; ")
        }`,
      ]
      : []),
    ...(parseError ? [`harness log refused: ${parseError}`] : []),
    ...(host.bad.length > 0
      ? [`host log lines unreadable: ${host.bad.join(", ")}`]
      : []),
  ];
  const check = started
    ? observedMismatch(f.manifest, parsed.observed, parsed.unobservable)
    : { mismatch: null, unverified: [] };
  // Spec v2 gate 1: an arm whose components the adapter could not prove is never
  // judged. The inventory problem is the root cause, so it outranks the derived
  // "requested components did not load" mismatch.
  const inventory = started ? parsed.inventoryProblems ?? [] : [];
  const mismatch = inventory.length > 0
    ? `component inventory: ${inventory.join("; ")}`
    : check.mismatch;
  const stopReason = f.egressStop
    ? f.egressStop
    : f.sandbox.interrupted
    ? "operator_interrupt"
    : f.sandbox.overflow
    ? "capture_overflow"
    : f.interrupted
    ? "runner_interrupted"
    : null;
  // H-01u: pi that ignored its staged settings (pi_config_invalid) is never a
  // valid cell, whatever stop reason, timeout or recovery would say instead.
  // Run 003: decided from stderr itself as well, so a stream the adapter's
  // parser refuses (its problems then lost) cannot drop the verdict.
  const configInvalid =
    problems.some((x) => x.startsWith("pi_config_invalid: ")) ||
    (started && f.manifest.harness === "pi" &&
      await piConfigInvalid(p.stderr) !== null);
  const termination: ExecutionRecord["termination"] =
    !started || f.setupError !== null || mismatch !== null ||
      configInvalid
      ? "setup_failed"
      : stopReason !== null || parseError !== null
      ? "harness_crash"
      : parsed.termination === "usage_limited"
      ? "usage_limited"
      : f.sandbox.timedOut
      ? "timeout"
      : f.sandbox.startError !== null
      ? "harness_crash"
      : parsed.termination ??
        (f.sandbox.exitCode === 0 ? "completed" : "harness_crash");
  const did_work = parsed.didWork || host.lines.length > 0 ||
    (frozen !== null && frozen.workspace_hash !== f.pristineHash);
  const runDir = join(p.pending, "run");
  await Deno.remove(runDir, { recursive: true }).catch(() => {});
  await Deno.mkdir(runDir, { recursive: true }); // a setup failure has no captures but still writes its side file
  const published = await publishRedacted([
    { src: p.raw, dest: join(runDir, "raw.jsonl") },
    { src: p.stderr, dest: join(runDir, "stderr.txt") },
    { src: p.host, dest: join(runDir, "host-log.jsonl") },
    { src: p.trace, dest: join(runDir, "trace.jsonl") },
    { src: p.egress, dest: join(runDir, "egress.jsonl") },
    { src: p.preflight, dest: join(runDir, "preflight.jsonl") },
  ], scrub);
  const side = redactDeep({
    v: 1,
    sandbox: f.sandbox,
    setup_error: f.setupError ?? mismatch,
    unverified: check.unverified,
    stop_reason: stopReason,
    infra_reason: infraReasons.length > 0 ? infraReasons.join("; ") : null,
    stream_problems: problems,
    usage_reset_at: parsed.usageResetAt,
    redactions: published.count,
    redactions_by_file: published.byFile,
    workspace_redactions: frozen?.redactions ?? 0,
    pricing_book_at: f.pricing.at,
    pristine_hash: f.pristineHash,
    freeze_violations: frozen?.violations ?? [],
    ...(f.stub
      ? { stub_provider: { scenario_sha256: f.stub.scenario_sha256 } }
      : {}),
  }, scrub);
  await Deno.writeTextFile(
    join(runDir, "sandbox.json"),
    JSON.stringify(side, null, 2) + "\n",
  );
  const runRel = `runs/${f.id}`;
  const record = {
    v: 2,
    id: f.id,
    campaign_id: f.cell.campaignId,
    block: f.cell.block.index,
    order_in_block: f.cell.orderInBlock,
    arm: f.cell.arm,
    task_id: f.cell.task.task.id,
    task_visible_hash: f.cell.taskVisibleHash,
    repeat: f.cell.block.repeat,
    attempt: f.at.attempt,
    run_kind: f.at.runKind,
    retry_of: f.at.retryOf,
    started_at: f.started_at,
    ended_at: now().toISOString(),
    arm_manifest_hash: f.cell.armManifestHash,
    manifest: f.manifest,
    observed: parsed.observed,
    termination,
    did_work,
    validity: {
      incomplete_telemetry: started && !f.preStart
        ? incompleteTelemetry(adapter.declared, telemetry)
        : [],
      incomplete_observed: check.unverified.length > 0
        ? ["loaded_components"]
        : [],
      infra_exposed: host.lines.some((l) => l.outcome === "infra") ||
        infraReasons.length > 0,
    },
    image_attachments: imageAttachments(
      f.cell.task.task.attachments,
      parsed.imageSupport,
    ),
    telemetry,
    trace_path: parsed.traceEvents > 0 ? `${runRel}/trace.jsonl` : null,
    host_log_path: await exists(p.host) ? `${runRel}/host-log.jsonl` : null,
    raw_log_path: await exists(p.raw) ? `${runRel}/raw.jsonl` : null,
    container_assignments: [
      ...new Set(
        host.lines.map((l) => l.container).filter((c): c is string => !!c),
      ),
    ],
    workspace_hash: frozen?.workspace_hash ?? null,
  };
  const draft: Draft = {
    v: 1,
    mode: f.mode,
    stub: f.stub,
    execution: ExecutionRecordSchema.parse(redactDeep(record, scrub)),
    artifact: frozen
      ? {
        workspace_hash: frozen.workspace_hash,
        stored_path: frozen.stored_path,
      }
      : null,
    usage_reset_at: parsed.usageResetAt,
  };
  await env.hooks?.beforeDraft?.();
  await writeAtomic(join(p.pending, "draft.json"), JSON.stringify(draft));
  await env.hooks?.after?.("draft");
  return draft;
}

/** Idempotent publication of a saved draft, step by step; judging only when the task is unchanged. */
async function publishDraft(
  env: HarnessEnv,
  cell: CellRef,
  draft: Draft,
  pristine: string | null,
  taskUnchanged: boolean,
) {
  const now = env.now ?? (() => new Date());
  const e = draft.execution;
  const p = privatePaths(env, e.id);
  const mode = draft.mode ?? "normal";
  if (mode === "stub") checkStubRoot(env.resultsRoot);
  const runs = join(env.resultsRoot, "runs");
  if (!await exists(join(runs, e.id))) {
    await Deno.mkdir(runs, { recursive: true });
    // A crash inside an earlier copy left a temp name: remove it first.
    for (const x of [...Deno.readDirSync(runs)]) {
      if (x.name.startsWith(`.tmp-${e.id}-`)) {
        await Deno.remove(join(runs, x.name), { recursive: true });
      }
    }
    const tmp = join(runs, `.tmp-${e.id}-${crypto.randomUUID().slice(0, 8)}`);
    await safeCopyTree(join(p.pending, "run"), tmp);
    await Deno.rename(tmp, join(runs, e.id));
  }
  await env.hooks?.after?.("run");
  if (!(await env.store.executions(e.campaign_id)).some((x) => x.id === e.id)) {
    await env.store.writeExecution(e);
  }
  await env.hooks?.after?.("execution");
  if (draft.artifact && !await env.store.artifact(e.id)) {
    await env.store.writeArtifact({
      v: 1,
      execution_id: e.id,
      ...draft.artifact,
      created_at: now().toISOString(),
    });
  }
  await env.hooks?.after?.("artifact");
  const policy = outcomePolicy(e.termination, e.did_work);
  const fp = await currentScorerFingerprint();
  const judged = (await env.store.judgments(e.id)).some((j) =>
    j.scorer_fingerprint === fp
  );
  if (
    policy.judge && mode === "normal" && e.workspace_hash !== null &&
    !judged && taskUnchanged
  ) {
    const out = join(p.work, `restage-${crypto.randomUUID().slice(0, 8)}`);
    try {
      await judgeExecution(
        env,
        cell,
        e,
        pristine ?? (await stage(env, cell, out)).pristine,
      );
    } finally {
      await Deno.remove(out, { recursive: true }).catch(() => {});
    }
  }
  await env.hooks?.after?.("judgment");
  await finishCleanup(env, e.id);
}

/** Completion protocol: mark published, delete private state, delete the intent last. */
async function finishCleanup(env: HarnessEnv, id: string) {
  const p = privatePaths(env, id);
  const intent = await readJson<Intent>(p.intent);
  if (intent && intent.phase !== "published") {
    await writeAtomic(
      p.intent,
      JSON.stringify({ ...intent, phase: "published" }, null, 2),
    );
  }
  await env.hooks?.afterPublished?.();
  for (const d of [p.work, p.quarantine, p.pending, p.taskCopy]) {
    await Deno.remove(d, { recursive: true }).catch((err) => {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    });
  }
  await removeTemps(join(env.privateRoot, "custody"), `${id}.json`);
  await removeTemps(join(env.privateRoot, "redaction"), `${id}.json`);
  for (const f of [p.custody, p.intent]) {
    await Deno.remove(f).catch((err) => {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    });
  }
}

/** An attempt refused before any secret was released: remove its private state. */
async function discardAttempt(env: HarnessEnv, id: string): Promise<void> {
  const p = privatePaths(env, id);
  for (const d of [p.work, p.quarantine, p.pending, p.taskCopy]) {
    await Deno.remove(d, { recursive: true }).catch((err) => {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    });
  }
  await removeTemps(join(env.privateRoot, "custody"), `${id}.json`);
  await removeTemps(join(env.privateRoot, "redaction"), `${id}.json`);
  await Deno.remove(p.intent).catch((err) => {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  });
}

export async function runExecution(
  env: HarnessEnv,
  cell: CellRef,
  at: AttemptRef,
): Promise<{ execution: ExecutionRecord; usageResetAt: string | null }> {
  const adapter = adapterFor(cell.armManifest.harness);
  if (!adapter.enforcesBudget) {
    throw new ConfigurationError(
      `${cell.arm}: the ${adapter.harness} adapter cannot enforce max_budget_usd; refusing the arm`,
    );
  }
  if (env.stop?.aborted) {
    throw new ConfigurationError(
      `${cell.arm}: stopped by the operator before the start; nothing reserved or run`,
    );
  }
  // The mode is decided here, once, and persisted in the intent (review R4).
  const stubProvider = env.stubProvider ?? null;
  const mode: AttemptMode = stubProvider ? "stub" : "normal";
  if (stubProvider) checkStubRoot(env.resultsRoot);
  // A stub cell does not consult the egress state (M2-08): it releases no
  // credential and its Messages API runs inside the sandbox.
  if (mode === "normal" && env.egressEnforced && !env.egress) {
    throw new ConfigurationError(
      `${cell.arm}: egress enforcement is set but no egress runtime is configured; refusing (fail closed)`,
    );
  }
  const record = env.recordOAuthHosts === true;
  const recordedPath = join(env.repoRoot, ...RECORDED_HOSTS_PATH.split("/"));
  if (record) {
    const why = mode === "stub"
      ? "a stub cell releases no credential and is never placed"
      : !env.egress
      ? "the egress marker must be qualified (sandboxes placed)"
      : env.egressEnforced
      ? "the marker is already authorized"
      : !env.supervised
      ? "it runs only supervised (harness cell --supervised)"
      : adapter.harness !== "claude-code" || !adapter.credentialBearing
      ? `it needs a credential-bearing Claude Code arm, not ${adapter.harness}`
      : !env.credentialLedger
      ? "it runs inside the shared credential ledger (CG_CREDENTIAL_LEDGER)"
      : await exists(recordedPath)
      ? `${RECORDED_HOSTS_PATH} exists (remove it explicitly to record again)`
      : null;
    if (why) {
      throw new ConfigurationError(`${cell.arm}: record mode refused: ${why}`);
    }
  }
  if (mode === "normal" && adapter.credentialBearing && !env.egressEnforced) {
    if (!env.supervised) {
      throw new ConfigurationError(
        `${cell.arm}: credential-bearing arms run only supervised (harness cell --supervised) until egress enforcement is verified (M1-33/M1-34)`,
      );
    }
    if (!env.credentialLedger) {
      throw new ConfigurationError(
        "no shared credential-run ledger configured (CG_CREDENTIAL_LEDGER): refusing a credential-bearing run",
      );
    }
  }
  // Ruling (b): a reserved slot stays counted, so every predictable failure
  // comes first; the reservation is the last step before secrets are released.
  const needsSlot = mode === "normal" && adapter.credentialBearing &&
    !env.egressEnforced;
  const stub: StubProvenance | null = stubProvider
    ? {
      scenario_sha256: await sha256Hex(
        await Deno.readFile(join(stubProvider.dir, "scenario.json")),
      ),
      image_override: stubProvider.imageOverride ?? null,
    }
    : null;
  await validatePrivateRoot(env);
  const now = env.now ?? (() => new Date());
  const id = crypto.randomUUID();
  const started_at = now().toISOString();
  const pricing = await env.pricing(now()); // loaded once; stored in the intent
  const base = forTask(cell.armManifest, cell.task.task.limits);
  // A drift drill runs another image of the same harness; the manifest
  // records the id and base digest of the image it ran.
  const manifest = stub?.image_override
    ? {
      ...base,
      image: await overrideImage(env, stub.image_override, base),
    }
    : base;
  const p = privatePaths(env, id);
  await Deno.mkdir(p.quarantine, { recursive: true });
  // Immutable task snapshot for recovery; the folder keeps the task id (loadTask checks it).
  const snapshot = join(p.taskCopy, cell.task.task.id);
  await safeCopyTree(cell.task.dir, snapshot);
  // Resolved before the intent: a refused variant reserves and runs nothing.
  const copies = adapter.configCopies?.({
    settings: manifest.settings.native,
    task: { ...cell.task, dir: snapshot },
    repoRoot: env.repoRoot,
    qualify: env.qualifyManifest ?? null,
  }) ?? [];
  const staged = await stage(env, cell, p.work);
  const pristineHash = await hashTree(staged.pristine, "task");
  const name = sandboxName(cell.campaignId, id);
  const opMs = env.opTimeoutMs ?? OP_TIMEOUT_MS;
  const { task: _t, ...rest } = cell;
  const intent: Intent = {
    v: 2,
    execution_id: id,
    phase: "prepared",
    results_root: env.resultsRoot,
    cell: { ...rest, task_dir: cell.task.dir },
    task_snapshot: snapshot,
    manifest,
    at,
    started_at,
    pricing,
    sandbox: name,
    workspace: staged.workspace,
    pristine_hash: pristineHash,
    mode,
    stub,
  };
  await writeAtomic(p.intent, JSON.stringify(intent, null, 2));
  if (stub) await writeAtomic(p.stubMarker, JSON.stringify(stub));
  await env.hooks?.prepared?.(id);

  let setupError: string | null = null;
  /** M5-08a: what the teardown could not confirm (container or secrets). */
  let teardownProblems: string[] = [];
  let sandbox: SandboxResult = {
    exitCode: null,
    started: false,
    startError: null,
    timedOut: false,
    interrupted: false,
    overflow: false,
    confirmedGone: true,
    cleanup: "ok",
    wall_ms: 0,
  };
  let secrets: SecretValue[] = [];
  let drained = true;
  let refusal: unknown = null;
  // M1-33: placed runs (qualified or authorized marker) sit on the internal
  // network behind the environment's shared proxy, registered per execution
  // (M1-33d); secrets and ready follow the authenticated preflight. A stub cell is never placed (M2-08: egress not consulted; its
  // dummy credential and ready follow the privilege check, H-01), though
  // it still joins the internal network when an egress runtime exists.
  const eg = stub ? null : env.egress ?? null;
  /** Set for any egress failure: recorded as setup_failed, then the campaign stops. */
  let egressFailure: string | null = null;
  /** H-01: the harness's privilege check on the running sandbox failed (setup_failed, campaign stops). */
  let privilegeFailure: string | null = null;
  /** M9-05: the component inventory refused the arm before any release (setup_failed, cost 0, no campaign stop). */
  let inventoryRefused: string | null = null;
  let egressStop: string | null = null;
  const egressFail = (m: string) => {
    egressFailure = m;
    return new ConfigurationError(m);
  };
  /** Preflight passed and credentials released: a proxy deny from now on is a violation. */
  let armed = false;
  let violation: string | null = null;
  let egressLogError: string | null = null;
  // Egress stops (preflight failure, violation, failed release) end the
  // sandbox like an operator interrupt, recorded under their own stop reason.
  const egressAbort = new AbortController();
  const stop = env.stop
    ? AbortSignal.any([env.stop, egressAbort.signal])
    : egressAbort.signal;
  /** Record mode: the hosts of allowed CONNECTs after the release (never the preflight's). */
  const recordedHosts = new Set<string>();
  const onEgressLog = (l: EgressLogLine) => {
    if (record && armed && l.decision === "allow") {
      recordedHosts.add(l.target.replace(/:443$/, ""));
    }
    // Stop first: a failing log write never delays or swallows a violation.
    if (armed && l.decision === "deny" && egressStop === null) {
      egressStop = "egress_violation";
      violation = `${l.target} (${l.reason})`;
      egressAbort.abort(new Error(`egress violation: ${violation}`));
    }
    try {
      // M1-34e: the phase from the same flag, so authorization can tell the
      // preflight's own probes from the agent's traffic.
      const phase = armed ? "agent" : "preflight";
      Deno.writeTextFileSync(p.egress, JSON.stringify({ ...l, phase }) + "\n", {
        append: true,
      });
    } catch (err) {
      egressLogError ??= msg(err);
      // The proxy awaits this sink: the throw fails the registration
      // (egress_log_failed) and the decision is never answered unlogged.
      throw err;
    }
  };
  /** The shared proxy failed this registration (its log, or the whole proxy): stop the sandbox. */
  const onRegFailure = (f: RegistrationFailure) => {
    if (egressStop !== null) return;
    egressStop = f;
    egressAbort.abort(new Error(`egress registration failed: ${f}`));
  };
  const proxyAt = `${SANDBOX_NETWORK.gateway}:${PROXY_PORT}`;
  let reg: Registration | null = null;
  try {
    // By immutable id: retagging never substitutes or invalidates the pinned image.
    const img = await bounded(
      env.docker.inspectImage(manifest.image.digest),
      opMs,
      "docker image inspect",
    ) as { Id?: string } | null;
    if (img?.Id !== manifest.image.digest) {
      throw new ConfigurationError(
        `image ${manifest.image.digest} pinned by the campaign is no longer present`,
      );
    }
    const configDir = join(p.work, "config");
    await writeConfigDir(env.harnessRoot, configDir, manifest);
    for (const c of copies) {
      const dst = join(configDir, ...c.dst.split("/"));
      if ((await Deno.stat(c.src)).isDirectory) await safeCopyTree(c.src, dst);
      else await Deno.copyFile(c.src, dst);
    }
    const extraMounts = await adapter.extraMounts(
      manifest.settings.native,
      cell.task.dir,
      env.repoRoot,
    );
    const timeoutMs = (env.timeoutMsFor ?? ((m) => m * 60_000))(
      manifest.limits.timeout_min,
    );
    // A stub cell releases no credential: every credential file is a dummy.
    const secretsSource = stub
      ? await dummySecrets(join(p.work, "stub-secrets"), adapter.secretFiles)
      : env.secretsSource;
    await checkOperatorSecrets(secretsSource, adapter.secretFiles);
    // Predictable egress checks come before the grant and the reservation.
    let hosts: string[] = [];
    let expect: Record<string, boolean> = {};
    if (eg) {
      try {
        hosts = hostsForRoutes(
          Object.values(manifest.provider_routes),
          eg.recordedHosts,
          { record },
        );
        expect = preflightExpect(hosts, { record, auth: true });
      } catch (err) {
        throw egressFail(`egress route policy: ${msg(err)}`);
      }
      const backendHost = URL.canParse(env.backendUrl)
        ? new URL(env.backendUrl).hostname
        : env.backendUrl;
      if (backendHost !== SANDBOX_NETWORK.gateway) {
        throw egressFail(
          `egress: the backend (${env.backendUrl}) must be on the sandbox gateway ${SANDBOX_NETWORK.gateway}`,
        );
      }
      let hp: string[];
      try {
        hp = await bounded(eg.verify(), 3 * opMs, "egress host verification");
      } catch (err) {
        throw egressFail(`egress host verification failed: ${msg(err)}`);
      }
      if (hp.length > 0) {
        throw egressFail(`egress host verification failed: ${hp.join("; ")}`);
      }
      if (eg.proxyFailed) {
        egressStop = "egress_proxy_failed";
        throw egressFail(
          `egress proxy on ${proxyAt} has failed (every registration is revoked)`,
        );
      }
    }
    // Both restricted before the reservation: an ACL failure is predictable.
    const custodyTmp = await restrictedTemp(env, p.custody);
    const keysTmp = await restrictedTemp(env, p.keys);
    const token = await env.backend.grant({
      executionId: id,
      sandbox: name,
      workspace: staged.workspace,
      pristine: staged.pristine,
      trusted: staged.apps,
      symbols: env.symbols,
      lock: { store: env.symbolStore, packages: env.symbols },
      deploy: {
        ledgerRoot: env.deploy.ledgerRoot,
        trustedRoots: [staged.pristine],
      },
      hostLog: p.host,
    }, timeoutMs + 5 * 60_000);
    let secretsDir: string | null = null;
    /** The started run until it is awaited (M5-08a: teardown stops it first). */
    let pending: Promise<SandboxResult> | null = null;
    let settledRun: SandboxResult | null = null;
    try {
      const values = await readSecretValues(
        secretsSource,
        adapter.secretFiles,
        token,
      );
      if (eg) {
        // The environment's shared proxy (M1-33d) and the backend listen on
        // the gateway only.
        let lp: string[];
        try {
          lp = await bounded(eg.listeners(), opMs, "egress listener check");
        } catch (err) {
          throw egressFail(`egress listener check failed: ${msg(err)}`);
        }
        if (lp.length > 0) {
          throw egressFail(
            `egress: proxy or backend not listening on the gateway only: ${
              lp.join("; ")
            }`,
          );
        }
      }
      if (needsSlot) {
        try {
          await reserveCredentialRun(
            env.credentialLedger,
            {
              lane: env.lane_id,
              task: cell.task.task.id,
              config: cell.arm,
              purpose: "supervised dev run",
            },
            undefined,
            env.stop ? { signal: env.stop } : {},
          );
        } catch (err) {
          refusal = err;
          throw err;
        }
      }
      const dir = await createSecretsDir({
        privateRoot: env.privateRoot,
        owner: env.owner,
        ...(env.secretAcl ?? {}),
      });
      secretsDir = dir;
      let custodyNext: string | null = custodyTmp;
      let keysNext: string | null = keysTmp;
      /** Custody and its redaction keys hold exactly these secrets (restricted temp, sync, rename). */
      const commitCustody = async (s: SecretValue[]) => {
        secrets = s;
        await commitTemp(
          custodyNext ?? await restrictedTemp(env, p.custody),
          p.custody,
          JSON.stringify(s),
        );
        custodyNext = null;
        await commitTemp(
          keysNext ?? await restrictedTemp(env, p.keys),
          p.keys,
          JSON.stringify(redactionKeys(s)),
        );
        keysNext = null;
      };
      /** Placed: every form of the proxy credential, in custody before the file is written. */
      let credForms: SecretValue[] = [];
      /** Secret files, custody, keys, the released phase, then ready (empty, never custody) last. */
      const release = async () => {
        await writeSecretFiles(dir, values);
        await commitCustody([...values, ...credForms]);
        await writeAtomic(
          p.intent,
          JSON.stringify({ ...intent, phase: "released" }, null, 2),
        );
        await Deno.writeTextFile(join(dir, READY_FILE), "");
      };
      // Every kind starts with an empty mount: nothing is released before
      // the harness's privilege check on the running sandbox (H-01); placed
      // runs then also wait for the preflight (M1-33 A3).
      const running = pending = runSandbox(
        env.docker,
        {
          name,
          owner: env.owner,
          executionId: id,
          imageId: manifest.image.digest,
          workspace: staged.workspace,
          taskDir: staged.taskDir,
          configDir,
          secretsDir: dir,
          extraMounts: stubProvider
            ? [...extraMounts, { src: stubProvider.dir, dst: "C:\\cg-stub" }]
            : extraMounts,
          env: {
            CG_BACKEND_URL: env.backendUrl,
            CG_EXECUTION_ID: id,
            ...(eg ? PLACED_ENV : {}),
            ...(stub ? STUB_ENV : {}),
          },
          // A stub is never placed, but with an egress runtime the backend
          // sits on the sandbox gateway, so it joins the internal network
          // (no outbound route) without proxy, preflight or record mode.
          ...(env.egress ? { network: SANDBOX_NETWORK.name } : {}),
          ...(stub ? { command: STUB_COMMAND } : {}),
          timeoutMs,
          killGraceMs: env.killGraceMs ?? 60_000,
          opTimeoutMs: opMs,
          maxCaptureBytes: env.maxCaptureBytes ?? 256 * 1024 * 1024,
          rawLog: p.raw,
          stderrLog: p.stderr,
        },
        values.map((v) => v.value),
        stop,
      );
      let preflightError: string | null = null;
      let releaseError: unknown = null;
      let privilegeError: string | null = null;
      let privilegeStop = "privilege_check_failed";
      // H-01: before any credential (the proxy credential included), while
      // only trusted image code runs (every entrypoint waits for ready): the
      // harness's own check, never the entrypoint's output. Fails closed.
      // H-01 run 005: then a pi sandbox (stub cells too: STUB_COMMAND runs
      // the image's run.ps1) gets its config staged admin-owned, still before
      // anything is released; a failure is handled like the check's.
      let setupStep = "sandbox privilege check";
      // Spec v2 gate 1 (M9-05): an inventoried image proves its components
      // before anything is released, the proxy credential included.
      const inv = manifest.harness === "claude-code" &&
        inventoried(manifest.image.revision);
      let runEnded = false;
      running.then(() => (runEnded = true), () => (runEnded = true));
      /**
       * A run that ended on its own before it was seen running (run.ps1's exit 5).
       * Downgraded only when a cg_inventory refusal is proven; every other
       * privilege failure stops the campaign (M9-05 run 003, security).
       */
      let endedEarly: string | null = null;
      let seenRunning = false;
      try {
        await waitRunning(env.docker, name, running, opMs);
        seenRunning = true;
        await checkSandboxPrivilege(env.docker, name, opMs);
        if (manifest.harness === "pi") {
          setupStep = "pi config staging";
          await stagePiConfig(env.docker, name, opMs);
        }
      } catch (err) {
        if (!stop.aborted) {
          const m = `${setupStep} failed: ${msg(err)}`;
          if (inv && runEnded && !seenRunning) {
            endedEarly = m;
          } else {
            privilegeError = m;
            privilegeStop = setupStep === "pi config staging"
              ? "pi_config_staging_failed"
              : "privilege_check_failed";
            egressAbort.abort(new Error(privilegeError));
          }
        }
      }
      if (inv && privilegeError === null && !stop.aborted) {
        // Fail closed: only a parsed ok record lets the run continue; a
        // refusal, a missing record (run ended, timeout) or a malformed one
        // releases nothing and is a pre-start refusal (never a campaign stop).
        const refused = await inventoryRefusal(
          p,
          adapter,
          manifest,
          () => runEnded || stop.aborted,
          env.inventoryTimeoutMs ?? PREFLIGHT_TIMEOUT_MS,
        );
        if (stop.aborted) {
          // The operator's interrupt already stops the run.
        } else if (
          refused !== null && (endedEarly === null || refused.provenRefusal)
        ) {
          inventoryRefused = `component inventory: ${
            refused.problems.join("; ")
          }`;
          egressStop = "component_inventory_refused";
          egressAbort.abort(new Error(inventoryRefused));
        } else if (endedEarly !== null) {
          // An early end without a proven refusal (inventory ok, missing or
          // malformed) is the privilege check's failure: the campaign stops.
          privilegeError = endedEarly;
          egressAbort.abort(new Error(privilegeError));
        }
      }
      if (eg && !stop.aborted) {
        // M1-33d (review M1-33c-003 Part B): the sandbox runs with an empty
        // mount; its verified address is registered; only the proxy
        // credential is written; the authenticated preflight; then the
        // provider secrets and ready.
        try {
          const source = await sandboxAddress(env.docker, name, id, opMs);
          if (eg.proxyFailed) {
            throw new Error(`egress proxy on ${proxyAt} has failed`);
          }
          const r = eg.register({
            allow: hosts,
            log: onEgressLog,
            source,
            onFailure: onRegFailure,
            ...(record ? { record: true } : {}),
          });
          reg = r.reg;
          credForms = proxyCredentialForms(r.credential);
          await commitCustody(credForms);
          await writeSecretFiles(dir, [credForms[0]!]);
          const lines = await bounded(
            eg.probe(name, hosts),
            PREFLIGHT_TIMEOUT_MS,
            "egress preflight",
          );
          await Deno.writeTextFile(
            p.preflight,
            lines.map((l) => JSON.stringify(l) + "\n").join(""),
          );
          const problems = evaluatePreflight(lines, expect);
          if (problems.length > 0) throw new Error(problems.join("; "));
          const now = await sandboxAddress(env.docker, name, id, opMs);
          if (now !== source) {
            throw new Error(
              `${name} changed its address from ${source} to ${now} after the registration`,
            );
          }
          // M1-33d review: the host and marker are read again right before
          // provider secrets and ready; any change since the first read refuses.
          const again = await bounded(
            eg.verify(),
            3 * opMs,
            "egress host verification before release",
          );
          if (again.length > 0) {
            throw new Error(
              `egress host verification before release failed: ${
                again.join("; ")
              }`,
            );
          }
        } catch (err) {
          // An operator interrupt already stops the run; nothing was
          // released and it is not an egress failure.
          if (!stop.aborted) preflightError = msg(err);
        }
        const failed = reg?.failure ??
          (eg.proxyFailed ? "egress_proxy_failed" : null);
        if (failed !== null) onRegFailure(failed);
        else if (preflightError !== null) {
          egressStop = "egress_preflight_failed";
          egressAbort.abort(
            new Error(`egress preflight failed: ${preflightError}`),
          );
        }
      }
      if (!stop.aborted) {
        try {
          await release();
          armed = true;
        } catch (err) {
          releaseError = err;
          egressAbort.abort(new Error(`release failed: ${msg(err)}`));
        }
      }
      sandbox = settledRun = await running;
      if (releaseError !== null) throw releaseError;
      // Pre-start refusal: setup_failed, never judged, never a campaign stop.
      if (inventoryRefused !== null) {
        throw new ConfigurationError(inventoryRefused);
      }
      // A sandbox that never started ran nothing: the start-failure rules apply.
      if (privilegeError !== null && sandbox.started) {
        egressStop = privilegeStop;
        privilegeFailure = privilegeError;
        throw new ConfigurationError(privilegeError);
      }
      // I4 (design section 5): a placed execution is recorded as anything
      // but setup_failed only while its registration and the proxy are intact.
      if (eg && egressStop === null) {
        egressStop = reg?.failure ??
          (eg.proxyFailed ? "egress_proxy_failed" : null);
      }
      // A violation is infra (setup_failed: never judged, never retried) and stops the campaign.
      const logNote = egressLogError === null
        ? ""
        : `; egress log write failed: ${egressLogError}`;
      if (egressStop === "egress_violation") {
        throw egressFail(`egress violation: ${violation}${logNote}`);
      }
      if (egressStop === "egress_proxy_failed") {
        throw egressFail(`egress proxy on ${proxyAt} failed${logNote}`);
      }
      if (egressStop === "egress_log_failed" || egressLogError !== null) {
        egressStop = "egress_log_failed";
        throw egressFail(
          `egress log write failed: ${
            egressLogError ?? "the registration's log failed"
          }`,
        );
      }
      if (preflightError !== null) {
        throw egressFail(`egress preflight failed: ${preflightError}`);
      }
    } finally {
      // M5-08a: credentials are cut first, while the sandbox may still run:
      // the run is aborted, the backend token revoked (the grant goes at
      // once; the drain is awaited below) and the proxy credential
      // unregistered. Then the bounded teardown: the sandbox confirmed gone
      // before the secrets it mounts are removed. A teardown failure never
      // replaces the error in flight (the caller fails closed below).
      const abortRun = () =>
        egressAbort.abort(new Error("execution ended before its sandbox"));
      if (pending && !settledRun) abortRun();
      const revoking = env.backend.revoke(id); // spec 1a section 5 item 6: revoke (and drain) before freeze
      if (reg) {
        await bounded(reg.unregister(), opMs, "egress unregister").catch(
          (err) => console.warn(`[WARN] ${msg(err)}`),
        );
      }
      const down = await teardownSandbox({
        docker: env.docker,
        name,
        executionId: id,
        opTimeoutMs: opMs,
        run: pending,
        abort: abortRun,
        settled: settledRun,
        secretsDir,
      });
      if (down.sandbox) sandbox = down.sandbox;
      if (!down.gone || down.secretsLeft) {
        teardownProblems = down.problems;
        if (sandbox.confirmedGone && !down.gone) {
          sandbox = { ...sandbox, confirmedGone: false };
        }
      }
      drained = await revoking;
    }
  } catch (err) {
    if (err === refusal) {
      // Refused before any secret: no execution, no private state left.
      await discardAttempt(env, id);
      throw err;
    }
    if (
      !(err instanceof ConfigurationError) && !(err instanceof ValidationError)
    ) {
      if (teardownProblems.length > 0) {
        // Fail closed and loud: the intent stays; the next start sweeps the
        // container first, then the secrets, then recovers the execution.
        console.error(
          `[FAIL] sandbox ${name} teardown not confirmed (${
            teardownProblems.join("; ")
          }); intent kept for recovery`,
        );
      }
      throw err;
    }
    setupError = err.message;
  }
  if (!sandbox.confirmedGone || !drained || teardownProblems.length > 0) {
    throw new ContainerError(
      `termination not confirmed for ${name} (${
        [sandbox.cleanup, ...teardownProblems].join("; ")
      }${
        drained ? "" : "; backend request did not drain"
      }); nothing frozen, intent kept; resolve and restart (recovery finalizes it)`,
      name,
      "stop",
    );
  }
  const draft = await buildDraft(env, {
    id,
    cell,
    at,
    started_at,
    manifest,
    workspace: staged.workspace,
    pristineHash,
    sandbox,
    setupError,
    pricing,
    interrupted: false,
    secrets,
    mode,
    stub,
    egressStop,
    preStart: inventoryRefused !== null,
  });
  await publishDraft(env, cell, draft, staged.pristine, true);
  if (privilegeFailure !== null) {
    // Infra, never scored; a retry would repeat it: the campaign stops here.
    throw new ContainerError(
      `${privilegeFailure}; execution ${id} recorded as setup_failed (no credential released); stopping`,
      name,
      "setup",
    );
  }
  if (egressFailure !== null) {
    // Infra, never scored; no retry repeats it: the campaign stops here.
    throw new ContainerError(
      `${egressFailure}; execution ${id} recorded as setup_failed (no credential released); stopping`,
      name,
      "setup",
    );
  }
  if (record) {
    if (
      draft.execution.termination !== "completed" || recordedHosts.size === 0
    ) {
      throw new ContainerError(
        `record mode: execution ${id} ended ${draft.execution.termination} with ${recordedHosts.size} recorded hosts; ${RECORDED_HOSTS_PATH} not written`,
        name,
        "setup",
      );
    }
    await writeAtomic(
      join(env.resultsRoot, "runs", id, RECORD_MODE_FILE),
      JSON.stringify(
        {
          v: 1,
          execution_id: id,
          record_mode: true,
          supervised: env.supervised,
          credential_bearing: adapter.credentialBearing,
          harness: adapter.harness,
          termination: draft.execution.termination,
        },
        null,
        2,
      ) + "\n",
    );
    await writeAtomic(
      recordedPath,
      recordedHostsJson([...recordedHosts], `record mode execution ${id}`),
    );
  }
  return { execution: draft.execution, usageResetAt: draft.usage_reset_at };
}

/** Covers waiting for the sandbox to run plus the in-sandbox probe script. */
const PREFLIGHT_TIMEOUT_MS = 180_000;

/** The running sandbox is this execution's, and its one internal-network address (M1-33d). */
async function sandboxAddress(
  docker: DockerCli,
  name: string,
  id: string,
  opMs: number,
): Promise<string> {
  const st = await bounded(docker.state(name), opMs, `docker inspect ${name}`);
  if (st?.execution !== id) {
    throw new Error(
      `${name} belongs to execution ${st?.execution ?? "(none)"}, not ${id}`,
    );
  }
  return sandboxSource(
    await bounded(docker.networks(name), opMs, `docker inspect ${name}`),
  );
}

/**
 * M9-05: wait for run.ps1's cg_inventory line in the raw log (the run ends or
 * PREFLIGHT_TIMEOUT_MS passes first: fail closed), then let the adapter's own
 * parser judge it. null: the inventory is proven (or the operator stopped the
 * run); otherwise the adapter's problems, which refuse the arm before release.
 * provenRefusal: exactly one record, a JSON cg_inventory with ok false and
 * non-empty problems (the image itself refused; not a missing or odd record).
 */
async function inventoryRefusal(
  p: ReturnType<typeof privatePaths>,
  adapter: ReturnType<typeof adapterFor>,
  manifest: ResolvedManifest,
  over: () => boolean,
  waitMs: number,
): Promise<{ problems: string[]; provenRefusal: boolean } | null> {
  const deadline = performance.now() + waitMs;
  /** Every complete line whose DECODED JSON type is cg_inventory (as the adapter counts; M9-05b run 002). */
  const records = async () => {
    const text = await Deno.readTextFile(p.raw).catch(() => "");
    // Complete lines only: the last one may still be mid-write.
    return text.split("\n").slice(0, -1).filter((l) => {
      try {
        return JSON.parse(l)?.type === "cg_inventory";
      } catch {
        return false;
      }
    });
  };
  while (
    (await records()).length === 0 && !over() &&
    performance.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const lines = await records();
  // The record, only when exactly one exists and it has the adapter's strict
  // shape (same keys, v 1, boolean ok, string lists) with ok false and problems.
  let refusalRecord: string[] | null = null;
  if (lines.length === 1) {
    try {
      const r = JSON.parse(lines[0]!);
      if (
        r?.type === "cg_inventory" &&
        Object.keys(r).sort().join() === INVENTORY_KEYS && r.v === 1 &&
        r.ok === false && strings(r.installed) && strings(r.problems) &&
        r.problems.length > 0
      ) {
        refusalRecord = r.problems;
      }
    } catch {
      refusalRecord = null;
    }
  }
  // A run that ended (or timed out) without a record is named by the parse below.
  try {
    const parsed = await adapter.parse({
      rawLog: p.raw,
      stderrLog: p.stderr,
      exitCode: null,
      manifest,
      pricing: { at: "", models: {} },
      traceOut: p.trace,
    });
    const problems = parsed.inventoryProblems ?? [];
    // The proof is exactly one decoded record of the strict shape (above); the
    // adapter's problems being precisely the record's own is an extra check.
    const provenRefusal = refusalRecord !== null &&
      problems.length === refusalRecord.length &&
      problems.every((x, i) => x === refusalRecord![i]);
    return problems.length > 0 ? { problems, provenRefusal } : null;
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    return {
      problems: [`inventory not provable: ${err.message}`],
      provenRefusal: false,
    };
  }
}

/** Wait (bounded) until the sandbox runs; a run that settles first fails the wait. */
export async function waitRunning(
  docker: DockerCli,
  name: string,
  running: Promise<unknown>,
  opMs: number,
): Promise<void> {
  let settled = false;
  running.then(() => (settled = true), () => (settled = true));
  const deadline = performance.now() + PREFLIGHT_TIMEOUT_MS;
  for (;;) {
    if (settled) throw new Error(`${name} ended before it was seen running`);
    const st = await bounded(
      docker.state(name),
      opMs,
      `docker inspect ${name}`,
    );
    if (st?.running) return;
    if (performance.now() > deadline) {
      throw new Error(
        `${name} not running ${PREFLIGHT_TIMEOUT_MS} ms after the start`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function judgeExecution(
  env: HarnessEnv,
  cell: CellRef,
  e: ExecutionRecord,
  pristine: string,
  oracleHash = cell.oracleHash,
  forced?: JudgmentRecord["forced"],
): Promise<JudgmentRecord> {
  // Fail closed: judging needs proof the run was not scripted. The published
  // side file must be readable and the private marker (kept after
  // publication) must not say stub; either marker refuses.
  const sidePath = join(env.resultsRoot, "runs", e.id, "sandbox.json");
  const side = await readJson<{ stub_provider?: unknown }>(sidePath).catch(
    () => null,
  );
  if (side === null || typeof side !== "object") {
    throw new ConfigurationError(
      `execution ${e.id}: ${sidePath} is missing or unreadable; refusing to judge (the run's mode cannot be proven)`,
    );
  }
  if (
    side.stub_provider !== undefined ||
    await exists(privatePaths(env, e.id).stubMarker)
  ) {
    throw new ConfigurationError(
      `execution ${e.id} is a stub-provider run (scripted model): never judged`,
    );
  }
  const art = await env.store.artifact(e.id);
  if (!art) {
    throw new ValidationError(`no artifact for execution ${e.id}`, [e.id]);
  }
  // Before judging: no key set means nothing could be redacted (fail closed).
  const keys = await readRedactionKeys(env, e.id);
  const workDir = join(
    env.privateRoot,
    "judge",
    `${e.id}-${crypto.randomUUID().slice(0, 8)}`,
  );
  try {
    const raw = await judge(env.lane, {
      executionId: e.id,
      workspaceHash: art.workspace_hash,
      task: cell.task,
      oracleHash,
      pristine,
      artifact: join(env.resultsRoot, art.stored_path),
      symbolIds: new Set(env.symbols.map((s) => s.app_id.toLowerCase())),
      workDir,
      lock: { store: env.symbolStore, packages: env.symbols },
      deploy: env.deploy,
    }, env.now);
    // Every judge output is published through the custody redaction (the
    // agent's code can assemble a secret at runtime in a test message).
    const log = scrubJudgeOutput(raw.log, keys, env);
    const judgment = JudgmentRecordSchema.parse(
      scrubJudgeOutput(
        forced ? { ...raw.judgment, forced } : raw.judgment,
        keys,
        env,
      ),
    );
    // C-03 run 002: checked against the store right before writing, so a
    // refused forced judgment (a second one, a stale --replaces, or clock
    // skew keeping an older judgment selected) leaves nothing behind.
    if (judgment.forced) {
      const why = forcedRefusal(
        e,
        await env.store.judgments(e.id),
        oracleHash,
        judgment.forced.replaces,
        judgment,
      );
      if (why) throw new ConfigurationError(`${why}: nothing written`);
    }
    // The side file first: a crash between the two leaves an orphan log, never a judgment without its log.
    await writeVerdictLog(env.resultsRoot, log);
    await env.store.writeJudgment(judgment);
    return judgment;
  } finally {
    await Deno.remove(workDir, { recursive: true }).catch(() => {});
  }
}

/** Judge a stored execution again: restage the task, never re-run the agent. */
export async function rejudgeExecution(
  env: HarnessEnv,
  cell: CellRef,
  e: ExecutionRecord,
  oracleHash: string,
  forced?: JudgmentRecord["forced"],
): Promise<JudgmentRecord> {
  const out = join(
    env.privateRoot,
    "work",
    `rejudge-${e.id}-${crypto.randomUUID().slice(0, 8)}`,
  );
  try {
    return await judgeExecution(
      env,
      cell,
      e,
      (await stage(env, cell, out)).pristine,
      oracleHash,
      forced,
    );
  } finally {
    await Deno.remove(out, { recursive: true }).catch(() => {});
  }
}

const RULESET = join("analysis", "final-code.ruleset.json");
const CANARY = join("analysis", "canary");

/** One measuring call: the start counts per task and the canary result are computed once. */
export interface MeasureRun {
  startCache: Map<string, FinalCounts>;
  analyzers: Measure<z.output<typeof AnalyzersSchema>> | null;
}

async function analyzersOf(env: HarnessEnv, run: MeasureRun, workDir: string) {
  if (run.analyzers) return run.analyzers;
  const rulesetFile = join(env.harnessRoot, RULESET);
  const analysis = { codeCop: true, uiCop: true, rulesetFile };
  const expected = (JSON.parse(
    await Deno.readTextFile(join(env.harnessRoot, CANARY, "expect.json")),
  ) as { codes: string[] }).codes;
  const c = await canaryCheck(env.lane, {
    canaryDir: join(env.harnessRoot, CANARY),
    lock: { store: env.symbolStore, packages: env.symbols },
    outDir: join(workDir, "canary"),
    analysis,
    expected,
  });
  run.analyzers = c.ok
    ? ok({
      compiler: c.compiler,
      ruleset_sha256: await hashFile(env.harnessRoot, rulesetFile),
      canary_codes: c.codes,
    })
    : missing(
      `analyzer canary failed: expected ${expected.join(",")}, got ${
        c.codes.join(",") || "none"
      }`,
    );
  return run.analyzers;
}

/** The exploratory measures (M11) of one judged workspace; never touches the judgment. */
export async function measureWorkspace(
  env: HarnessEnv,
  x: {
    task: LoadedTask;
    pristine: string;
    artifact: string;
    workspaceHash: string;
    oracleHash: string;
    judgment: JudgmentRecord;
    executionId: string;
  },
  run: MeasureRun,
  workDir: string,
): Promise<MeasureRecord> {
  const measures = await loadTaskMeasures(x.task);
  const lock = { store: env.symbolStore, packages: env.symbols };
  const symbolIds = new Set(env.symbols.map((s) => s.app_id.toLowerCase()));
  const analysis = {
    codeCop: true,
    uiCop: true,
    rulesetFile: join(env.harnessRoot, RULESET),
  };
  const infraSafe = async <T>(
    f: () => Promise<Measure<T>>,
  ): Promise<Measure<T>> => {
    try {
      return await f();
    } catch (err) {
      if (
        err instanceof InfraRetriesExhaustedError ||
        err instanceof NoEligibleContainersError || isInfraError(err)
      ) {
        return missing(
          `infra: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }
  };
  // An infra error in the canary is cached as missing for the whole run:
  // final code is missing, the independent measures still proceed.
  const az = run.analyzers ??
    (run.analyzers = await infraSafe(() => analyzersOf(env, run, workDir)));
  const final_code = az.status !== "ok"
    ? missing<FinalCode>(
      az.status === "missing" ? az.reason : "analyzers unavailable",
    )
    : await infraSafe(async () => {
      const vw = await buildVerdictWorkspace({
        pristine: x.pristine,
        artifact: x.artifact,
        out: join(workDir, "final"),
        symbolIds,
      });
      if (vw.violations.length > 0) {
        return missing<FinalCode>(
          `workspace violations: ${vw.violations.length}`,
        );
      }
      let start = run.startCache.get(x.task.task.id);
      if (!start) {
        start = await finalCodeCounts(env.lane, {
          dir: x.pristine,
          apps: await readAppGraph(x.pristine),
          lock,
          outDir: join(workDir, "start-build"),
          analysis,
        });
        run.startCache.set(x.task.task.id, start);
      }
      const end = await finalCodeCounts(env.lane, {
        dir: vw.dir,
        apps: vw.apps,
        lock,
        outDir: join(workDir, "final-build"),
        analysis,
      });
      return finalCode(start, end);
    });
  const reuse = !measures
    ? na<z.output<typeof ReuseSchema>>("no measures file")
    : await infraSafe(() =>
      reuseCheck(env.lane, {
        task: x.task,
        measures,
        judgment: x.judgment,
        judge: {
          workspaceHash: x.workspaceHash,
          oracleHash: x.oracleHash,
          pristine: x.pristine,
          symbolIds,
          lock,
          deploy: env.deploy,
        },
        artifact: x.artifact,
        workDir: join(workDir, "reuse"),
      })
    );
  return {
    v: 1,
    judgment_id: x.judgment.id,
    execution_id: x.executionId,
    task_id: x.task.task.id,
    workspace_hash: x.workspaceHash,
    oracle_hash: x.judgment.task_oracle_hash,
    measure_fingerprint: await measureFingerprint(),
    analyzers: az.status === "ok" ? az.value : null,
    final_code,
    reuse,
    partial_credit: partialCredit(x.task.task, measures, x.judgment),
  };
}

/** Exploratory measures of one judged execution (M11); never re-runs the agent, never touches the judgment. */
export async function measureExecution(
  env: HarnessEnv,
  cell: CellRef,
  e: ExecutionRecord,
  j: JudgmentRecord,
  run: MeasureRun,
): Promise<MeasureRecord> {
  const art = await env.store.artifact(e.id);
  if (!art) {
    throw new ValidationError(`no artifact for execution ${e.id}`, [e.id]);
  }
  const out = join(
    env.privateRoot,
    "work",
    `measure-${e.id}-${crypto.randomUUID().slice(0, 8)}`,
  );
  try {
    const pristine = (await stage(env, cell, out)).pristine;
    const rec = await measureWorkspace(
      env,
      {
        task: cell.task,
        pristine,
        artifact: join(env.resultsRoot, art.stored_path),
        workspaceHash: art.workspace_hash,
        oracleHash: j.task_oracle_hash,
        judgment: j,
        executionId: e.id,
      },
      run,
      join(out, "m"),
    );
    await writeMeasureRecord(env.resultsRoot, rec);
    return rec;
  } finally {
    await Deno.remove(out, { recursive: true }).catch(() => {});
  }
}

export interface CellResult {
  executions: ExecutionRecord[];
  /** Reset time (or "unknown") when a usage limit paused the cell. */
  pause: string | null;
  /** Why an automatic retry the policy allows was not started (supervised mode). */
  withheld: string | null;
  /** Why no further automatic retry is allowed (Part 1 retryProblem, or an operator interrupt). */
  stopped: string | null;
}

/** One cell: run, judge per policy, automatic retries decided by ancestry (never in supervised mode). */
export async function runCell(
  env: HarnessEnv,
  cell: CellRef,
  first: AttemptRef = { attempt: 1, runKind: "planned", retryOf: null },
  prior: ExecutionRecord[] = [],
): Promise<CellResult> {
  const bad = (why: string): never => {
    throw new ConfigurationError(
      `${cell.arm} ${cell.task.task.id}: refusing attempt ${first.attempt} (${first.runKind}): ${why}`,
    );
  };
  if (
    first.runKind === "planned" &&
    (first.attempt !== 1 || first.retryOf !== null)
  ) {
    bad("a planned execution is attempt 1 with no retry_of");
  }
  if (
    first.runKind === "manual_rerun" &&
    (first.attempt < 2 || first.retryOf !== null)
  ) {
    bad("a manual rerun has attempt >= 2 and no retry_of");
  }
  if (first.runKind === "auto_retry") {
    const parent = prior.find((x) => x.id === first.retryOf) ??
      bad(`its parent execution ${first.retryOf} is not in prior`);
    if (first.attempt !== parent.attempt + 1) {
      bad(`an automatic retry is attempt parent + 1 (${parent.attempt + 1})`);
    }
    const problem = retryProblem(
      parent,
      {
        ...parent,
        id: "(requested retry)",
        attempt: first.attempt,
        run_kind: "auto_retry",
        retry_of: parent.id,
      },
      prior.find((x) => x.id === parent.retry_of),
    );
    if (problem) bad(problem);
  }
  const executions: ExecutionRecord[] = [];
  let at = first;
  for (;;) {
    const { execution: e, usageResetAt } = await runExecution(env, cell, at);
    executions.push(e);
    const policy = outcomePolicy(e.termination, e.did_work);
    if (policy.retry === "after_usage_reset") {
      return {
        executions,
        pause: usageResetAt ?? "unknown",
        withheld: null,
        stopped: null,
      };
    }
    if (policy.retry === "none") {
      return { executions, pause: null, withheld: null, stopped: null };
    }
    if (env.stop?.aborted) {
      return {
        executions,
        pause: null,
        withheld: null,
        stopped: "operator interrupt: no automatic retry",
      };
    }
    const all = [...prior, ...executions];
    const grandparent = all.find((x) => x.id === e.retry_of);
    // Part 1: an automatic retry is its parent's attempt + 1 (integrity checks it).
    const next: AttemptRef = {
      attempt: e.attempt + 1,
      runKind: "auto_retry",
      retryOf: e.id,
    };
    const candidate = {
      ...e,
      id: "(next automatic retry)",
      attempt: next.attempt,
      run_kind: next.runKind,
      retry_of: e.id,
    };
    const problem = retryProblem(e, candidate, grandparent);
    if (problem) {
      return { executions, pause: null, withheld: null, stopped: problem };
    }
    if (env.supervised) {
      return {
        executions,
        pause: null,
        withheld:
          `automatic retry after ${e.termination} withheld in supervised mode`,
        stopped: null,
      };
    }
    at = next;
  }
}

/**
 * Startup: remove this owner's leftover sandboxes, then its stale secret
 * custody dirs (M1-20 handoff: the mounts are released first), then complete
 * every attempt a killed runner left behind (review gate 5, round 2 item 3,
 * round 3 B3).
 */
export async function recoverInterrupted(
  env: HarnessEnv,
  loadTaskFn: (dir: string) => Promise<LoadedTask>,
): Promise<ExecutionRecord[]> {
  const opMs = env.opTimeoutMs ?? OP_TIMEOUT_MS;
  await sweepOwnedSandboxes(env.docker, env.owner, opMs);
  await sweepStaleSecrets(env.privateRoot, env.owner);
  // Temp files of an interrupted writeAtomic are never needed (the final
  // name is renamed into place), and a custody temp holds plaintext secrets.
  await removeTemps(join(env.privateRoot, "custody"));
  await removeTemps(join(env.privateRoot, "redaction"));
  const dir = join(env.privateRoot, "intents");
  await removeTemps(dir);
  const recovered: ExecutionRecord[] = [];
  let names: string[] = [];
  try {
    names = [...Deno.readDirSync(dir)]
      .filter((e) =>
        e.isFile && e.name.endsWith(".json") && !e.name.includes(".tmp-")
      )
      .map((e) => e.name).sort();
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  for (const n of names) {
    let intent: Intent | null;
    try {
      intent = await readJson<Intent>(join(dir, n));
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      await quarantineFile(
        env,
        join(dir, n),
        n,
        `unreadable intent (${err.message})`,
      );
      continue;
    }
    if (!intent) continue; // removed meanwhile by a finished cleanup
    const id = intent.execution_id;
    // Publish into the store of the command that started the attempt, whatever command recovers it.
    const own: HarnessEnv = {
      ...env,
      resultsRoot: intent.results_root,
      store: new RecordStore(intent.results_root),
    };
    if (intent.phase === "published") {
      await finishCleanup(own, id);
      continue;
    }
    const p = privatePaths(own, id);
    const { task_dir, ...rest } = intent.cell;
    // The task comes from the private snapshot: a deleted or edited task never blocks or relabels recovery.
    const cell: CellRef = {
      ...rest,
      task: await loadTaskFn(intent.task_snapshot),
    };
    const current = await loadTaskFn(task_dir).catch(() => null);
    const ids = current
      ? await taskSetIdentity(env.repoRoot, [current], env.symbols).catch(() =>
        null
      )
      : null;
    const taskUnchanged = ids !== null &&
      ids.tasks[0]!.visible === cell.taskVisibleHash &&
      ids.tasks[0]!.oracle === cell.oracleHash;
    const draftPath = join(p.pending, "draft.json");
    let draft: Draft | null;
    try {
      draft = await readJson<Draft>(draftPath);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      // The draft is derived state: set it aside and build it again.
      await quarantineFile(
        env,
        draftPath,
        `${id}.draft-${crypto.randomUUID().slice(0, 8)}.json`,
        `unreadable draft (${err.message})`,
      );
      draft = null;
    }
    if (!draft) {
      const st = () =>
        bounded(
          env.docker.state(intent.sandbox),
          opMs,
          `docker inspect ${intent.sandbox}`,
        );
      if (await st() !== null) {
        await bounded(
          env.docker.rm(intent.sandbox),
          opMs,
          `docker rm -f ${intent.sandbox}`,
        );
        if (await st() !== null) {
          throw new ContainerError(
            `recovery: ${intent.sandbox} still exists; intent kept`,
            intent.sandbox,
            "stop",
          );
        }
      }
      const released = intent.phase === "released";
      let secrets: SecretValue[] = [];
      // M1-33d: a placed attempt holds the proxy credential in custody
      // before its provider secrets (still phase prepared).
      if (released || await exists(p.custody)) {
        const c = await readCustody(p.custody);
        if (c === "corrupt") {
          // Nothing can be redacted, so nothing is published; the attempt waits for the operator.
          await quarantineFile(
            env,
            join(dir, n),
            n,
            `custody ${p.custody} is not a valid redaction set; attempt ${id} not published (its private state is kept)`,
          );
          continue;
        }
        secrets = c;
        // A crash between the custody and the key file: derive the keys again.
        if (!await exists(p.keys)) {
          await commitTemp(
            await restrictedTemp(own, p.keys),
            p.keys,
            JSON.stringify(redactionKeys(secrets)),
          );
        }
      }
      const why = "interrupted before any secret was released";
      draft = await buildDraft(own, {
        id,
        cell,
        at: intent.at,
        started_at: intent.started_at,
        manifest: intent.manifest,
        workspace: intent.workspace,
        pristineHash: intent.pristine_hash,
        sandbox: {
          exitCode: null,
          started: released,
          startError: released ? null : why,
          timedOut: false,
          interrupted: false,
          overflow: false,
          confirmedGone: true,
          cleanup: "ok",
          wall_ms: 0,
        },
        setupError: released ? null : why,
        pricing: intent.pricing,
        interrupted: true,
        secrets,
        mode: intent.mode ?? "normal",
        stub: intent.stub ?? null,
      });
    }
    await publishDraft(own, cell, draft, null, taskUnchanged);
    if (!taskUnchanged) {
      console.warn(
        `[WARN] ${id}: task files changed or unavailable since the attempt; recorded, not judged (use harness rejudge)`,
      );
    }
    recovered.push(draft.execution);
  }
  return recovered;
}
