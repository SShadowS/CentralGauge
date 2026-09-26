/**
 * A complete HarnessEnv over FakeBc + FakeDocker + a temp refapp repo, with
 * the real Claude Code adapter. No docker, no container, no harness binary:
 * git (the refapp repo) and System32 tar (staging) are the only processes.
 */

import { fromFileUrl, join } from "@std/path";
import type { PricingBook } from "../../../src/harness/pricing.ts";
import type { QualifyManifest } from "../../../src/harness/qualify.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import { Backend, defaultBackendOps } from "../../../src/harness/backend.ts";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { loadConfig } from "../../../src/harness/config.ts";
import type { CellRef, HarnessEnv } from "../../../src/harness/execution.ts";
import type {
  EgressLogLine,
  EgressRuntime,
  ProbeLine,
} from "../../../src/harness/egress.ts";
import type {
  ProxyCredential,
  RegisterOptions,
  RegistrationFailure,
} from "../../../src/harness/egress-proxy.ts";
import {
  preflightExpect,
  SANDBOX_NETWORK,
} from "../../../src/harness/egress.ts";
import {
  resolveRefapp,
  taskSetIdentity,
} from "../../../src/harness/identity.ts";
import {
  imageFacts,
  imageTag,
  runtimeFacts,
} from "../../../src/harness/images.ts";
import {
  manifestHash,
  resolveManifest,
} from "../../../src/harness/manifest.ts";
import { RecordStore } from "../../../src/harness/records.ts";
import { applyOverlay } from "../../../src/harness/staging.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { deployedSource, FakeBc, result } from "./fake-bc.ts";
import { FakeDocker, type RunBehavior } from "./fake-docker.ts";
import { makeRefappRepo, type RefappRepo, write } from "./refapp-fixture.ts";
import { tempDir } from "./temp-dirs.ts";

export const SECRET_OAUTH = "sk-ant-oat01-fixture-0123456789abcdefXYZ";
const PROBE = "tests/fixtures/harness/claude-code/probe.jsonl";
/** Stands in for the probe's own init: same session (M1-32b run 002 prices only a session-proven log). */
export const INIT = JSON.stringify({
  type: "system",
  subtype: "init",
  session_id: "1ae7bb8f-04b6-4431-b315-c3a36ef73f35",
  claude_code_version: "2.1.282",
  skills: [],
  mcp_servers: [],
});
export const BOOK: PricingBook = {
  at: "2026-10-05T00:00:00.000Z",
  models: {
    "claude-sonnet-5": {
      slug: "anthropic/claude-sonnet-5",
      pricing_version: "2026-09-25",
      input: 2,
      output: 10,
      cache_read: 0.2,
      cache_write_5m: 2.5,
      cache_write_1h: 4,
      cache_write_1h_derived: true,
    },
  },
};
export const PROBE_COST =
  (10 * 2 + 120646 * 0.2 + 22276 * 2.5 + 6792 * 4 + 2181 * 10) / 1e6;
export const IMAGE_ID = `sha256:${"c".repeat(64)}`;
export const CATALOG = {
  models: [{
    slug: "anthropic/claude-sonnet-5",
    api_model_id: "claude-sonnet-5",
    family: "claude",
    display_name: "S5",
  }],
  pricing: [],
  families: [],
};

/** The reparse scan runs pwsh (covered in fsutil.test.ts); the backend's seam skips it here. */
const NO_SCAN = () =>
  Promise.resolve({ ancestors: [], entries: [], seen: 0, capped: false });

/** An icacls stand-in whose listing is exactly the private grant (Windows custody path). */
const ACL_USER = "HOST\\runner";
function fakeIcacls(args: string[]) {
  if (args.length > 1) {
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  }
  const dir = args[0]!;
  const pad = " ".repeat(dir.length + 1);
  // A directory lists inheritable entries, a file plain ones.
  const f = Deno.statSync(dir).isDirectory ? "(OI)(CI)" : "";
  return Promise.resolve({
    code: 0,
    stdout: `${dir} NT AUTHORITY\\SYSTEM:${f}(F)\n${pad}${ACL_USER}:${f}(F)\n` +
      `\nSuccessfully processed 1 files; Failed processing 0 files\r\n`,
    stderr: "",
  });
}

export function verdictBc(): FakeBc {
  return new FakeBc((cu, deployed) => {
    const rental = deployedSource(deployed, "CGR Rental");
    if (cu === 80010) return result({ ShippedPasses: true });
    if (cu === 85000) {
      return result({
        FixWorks: rental.includes("exit(10)")
          ? true
          : "Assert.AreEqual failed. Expected:<10>",
      });
    }
    return result({});
  });
}

/** The probe log after a fixture init line (the probe's own init lists skills and MCP servers this arm does not request). */
export async function probeLines(): Promise<string[]> {
  return (await Deno.readTextFile(PROBE)).split(/\r?\n/).filter(Boolean)
    .slice(1);
}

export function ccBehavior(
  taskDir: string,
  solution: "correct" | "naive/a" | null,
  lines?: string[],
): RunBehavior {
  return async (call, io) => {
    if (solution) {
      await applyOverlay(
        join(taskDir, solution),
        call.mounts.get("C:\\workspace")!.src,
      );
    }
    for (const l of [INIT, ...(lines ?? await probeLines())]) {
      await io.stdout(l);
    }
    return 0;
  };
}

export const MOCK_IMAGE_ID = `sha256:${"a".repeat(64)}`;

/** Mock arms (M1-35): the settings.json `settings` of each mock config. */
const MOCK_ARMS: Record<string, Record<string, unknown>> = {
  "mock-positive": { mode: "apply", variant: "positive" },
  "mock-naive-a": { mode: "apply", variant: "naive:a" },
  "mock-crash": { mode: "crash" },
  "mock-crash-after-work": { mode: "crash-after-work", variant: "positive" },
  "mock-usage": { mode: "usage-limit" },
};

/** The per-task qualification manifest mock arms resolve variants from (M1-24 schema). */
export const QUALIFY: QualifyManifest = {
  v: 1,
  refapp_version: "refapp-v1",
  tasks: { "HX-001": { rev: "refapp-v1", positive: "correct", naive: ["a"] } },
};

const MOCK_PS1 = fromFileUrl(
  new URL("../../../harness/images/mock/mock.ps1", import.meta.url),
);

/**
 * The mock image for FakeDocker: runs the real mock.ps1 in local pwsh with
 * the container paths redirected to the mounted host folders.
 */
export function mockImageBehavior(): RunBehavior {
  return async (call, io) => {
    const child = new Deno.Command("pwsh", {
      args: ["-NoProfile", "-NonInteractive", "-File", MOCK_PS1],
      env: {
        CG_MOCK_CONFIG: call.mounts.get("C:\\config")!.src,
        CG_MOCK_WORKSPACE: call.mounts.get("C:\\workspace")!.src,
      },
      stdout: "piped",
      stderr: "null",
    }).spawn();
    io.killed.then(() => {
      try {
        child.kill();
      } catch { /* already exited */ }
    });
    let buf = "";
    for await (
      const chunk of child.stdout.pipeThrough(new TextDecoderStream())
    ) {
      buf += chunk;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop()!;
      for (const l of parts) if (l.trim()) await io.stdout(l.trim());
    }
    if (buf.trim()) await io.stdout(buf.trim());
    return (await child.status).code;
  };
}

export interface TestEnv {
  env: HarnessEnv;
  repo: RefappRepo;
  docker: FakeDocker;
  bc: FakeBc;
  harnessRoot: string;
}

export async function makeEnv(opts: { bc?: FakeBc } = {}): Promise<TestEnv> {
  const repo = await makeRefappRepo();
  const harnessRoot = join(repo.root, "harness");
  await write(
    harnessRoot,
    "configs/cc-sonnet-plain.yml",
    `id: cc-sonnet-plain
harness: claude-code
harness_version: "2.1.282"
models: { main: anthropic/claude-sonnet-5 }
settings: {}
components: { instructions: bundles/env/instructions }
limits: { timeout_min: 30, max_budget_usd: 5 }
`,
  );
  await write(
    harnessRoot,
    "bundles/env/instructions/CLAUDE.md",
    "Environment facts.\n",
  );
  for (const [id, settings] of Object.entries(MOCK_ARMS)) {
    await write(
      harnessRoot,
      `configs/${id}.yml`,
      `id: ${id}
harness: mock
harness_version: "1"
models: {}
settings: ${JSON.stringify(settings)}
limits: { timeout_min: 5, max_budget_usd: 1 }
`,
    );
  }
  const docker = new FakeDocker();
  docker.addImage(imageTag("claude-code", "2.1.282"), IMAGE_ID, {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.version": "2.1.282",
    "centralgauge.harness.base_digest": `sha256:${"b".repeat(64)}`,
  });
  docker.addImage(imageTag("mock", "1"), MOCK_IMAGE_ID, {
    "centralgauge.harness": "mock",
    "centralgauge.harness.version": "1",
    "centralgauge.harness.base_digest": `sha256:${"b".repeat(64)}`,
  });
  docker.behavior = ccBehavior(join(repo.tasksDir, "HX-001"), "correct");
  const bc = opts.bc ?? verdictBc();
  const lane = new BcLane(bc, ["C1"]);
  const resultsRoot = join(repo.root, "results", "harness");
  await Deno.mkdir(resultsRoot, { recursive: true });
  const privateRoot = await Deno.realPath(
    await tempDir({ prefix: "cg-private-" }),
  );
  await Deno.mkdir(join(privateRoot, "work"), { recursive: true });
  const secretsSource = await Deno.realPath(await tempDir());
  await Deno.writeTextFile(
    join(secretsSource, "claude-oauth-token"),
    SECRET_OAUTH,
  );
  const env: HarnessEnv = {
    repoRoot: repo.root,
    harnessRoot,
    resultsRoot,
    privateRoot,
    store: new RecordStore(resultsRoot),
    lane,
    backend: new Backend({
      approvedRoots: [join(privateRoot, "work")],
      workRoot: join(privateRoot, "backend"),
      ops: defaultBackendOps(lane),
      allowedHosts: ["127.0.0.1"],
      revokeGraceMs: 100,
      scanReparsePoints: NO_SCAN,
    }),
    backendUrl: "http://127.0.0.1:9",
    docker,
    owner: "HOST1",
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    secretsSource,
    secretAcl: { icacls: fakeIcacls, user: ACL_USER },
    driveType: () => Promise.resolve("Fixed"),
    scanReparsePoints: NO_SCAN,
    deploy: { ledgerRoot: join(privateRoot, "bc-ledger") },
    pricing: () => Promise.resolve(BOOK),
    supervised: true,
    egressEnforced: false,
    credentialLedger: join(privateRoot, "credential-runs.jsonl"),
    lane_id: "lane-test",
    qualifyManifest: QUALIFY,
    killGraceMs: 50,
    opTimeoutMs: 100,
  };
  return { env, repo, docker, bc, harnessRoot };
}

export async function cellFor(
  t: TestEnv,
  configId = "cc-sonnet-plain",
  taskId = "HX-001",
): Promise<CellRef> {
  const config = await loadConfig(t.harnessRoot, configId);
  const facts = runtimeFacts(
    config,
    await imageFacts(
      t.docker,
      imageTag(config.harness, config.harness_version),
      "HOST1",
    ),
    adapterFor(config.harness),
    CATALOG,
  );
  const armManifest = await resolveManifest(t.harnessRoot, config, facts);
  const task = await loadTask(join(t.repo.tasksDir, taskId));
  const ids = await taskSetIdentity(t.repo.root, [task], t.repo.symbols);
  return {
    campaignId: "11111111-2222-4333-8444-555555555555",
    block: { index: 0, task_id: taskId, repeat: 1, order: [configId] },
    orderInBlock: 0,
    arm: configId,
    armManifest,
    armManifestHash: await manifestHash(armManifest),
    task,
    taskVisibleHash: ids.tasks[0]!.visible,
    oracleHash: ids.tasks[0]!.oracle,
    refapp: await resolveRefapp(t.repo.root, task.task.refapp_version),
  };
}

/** An in-memory egress runtime (M1-33): every call is an event; the probe passes unless told otherwise. */
export interface FakeEgress extends EgressRuntime {
  events: string[];
  verifyProblems: string[];
  listenerProblems: string[];
  /** The proxy allowlist, record flag and log of the last execution. */
  proxyHosts: string[] | null;
  proxyRecord: boolean;
  log: ((l: EgressLogLine) => void) | null;
  /** Probe hosts of the last execution. */
  probedHosts: string[] | null;
  /** Rewrites the (passing) probe lines. */
  lines: (ok: ProbeLine[]) => ProbeLine[];
  /** Runs inside the probe (the sandbox is up, nothing released yet). */
  onProbe: (sandbox: string) => Promise<void>;
  /** The live registration (M1-33d shared proxy); null before and after. */
  registered: RegisterOptions | null;
  /** The last registration's credential. */
  credential: ProxyCredential | null;
  /** Every source ever registered. */
  sources: string[];
  /** The registration's failure (reg.failed / reg.failure). */
  regFailure: RegistrationFailure | null;
  /** Thrown by register (a duplicate source, a failed proxy). */
  registerError: Error | null;
  proxyFailed: boolean;
  /** Fail the live registration like the proxy does: set it, then its onFailure. */
  failReg(f: RegistrationFailure): void;
}

const hex = (n: number) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

/** Passing probe lines; with auth, every CONNECT probe carries its status. */
export function passingLines(
  hosts: string[],
  o: { record?: boolean; auth?: boolean } = {},
): ProbeLine[] {
  return Object.entries(preflightExpect(hosts, o)).map(([probe, ok]) =>
    o.auth && probe.startsWith("proxy-")
      ? { probe, ok, status: probe === "proxy-no-auth" ? 407 : ok ? 200 : 403 }
      : { probe, ok }
  );
}

export const RECORDED_OAUTH = "oauth.example.test";

export function fakeEgress(): FakeEgress {
  const eg: FakeEgress = {
    events: [],
    verifyProblems: [],
    listenerProblems: [],
    proxyHosts: null,
    proxyRecord: false,
    log: null,
    probedHosts: null,
    lines: (ok) => ok,
    onProbe: () => Promise.resolve(),
    registered: null,
    credential: null,
    sources: [],
    regFailure: null,
    registerError: null,
    proxyFailed: false,
    failReg(f) {
      if (eg.regFailure) return;
      eg.regFailure = f;
      eg.registered?.onFailure?.(f);
    },
    register(o) {
      eg.events.push("register");
      if (eg.registerError) throw eg.registerError;
      eg.registered = o;
      eg.sources.push(o.source);
      eg.proxyHosts = o.allow;
      eg.proxyRecord = o.record === true;
      // Like the proxy: a log that throws or rejects fails the registration.
      eg.log = (l) => {
        try {
          const r = o.log(l);
          if (r instanceof Promise) {
            r.catch(() => eg.failReg("egress_log_failed"));
          }
        } catch {
          eg.failReg("egress_log_failed");
        }
      };
      const credential = {
        user: hex(16),
        pass: btoa(String.fromCharCode(
          ...crypto.getRandomValues(new Uint8Array(32)),
        )).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""),
      };
      eg.credential = credential;
      return {
        credential,
        reg: {
          source: o.source,
          get failed() {
            return eg.regFailure !== null;
          },
          get failure() {
            return eg.regFailure;
          },
          unregister: () => {
            eg.events.push("unregister");
            eg.registered = null;
            return Promise.resolve();
          },
        },
      };
    },
    shutdown: () => Promise.resolve(),
    recordedHosts: { "anthropic:first-party-oauth": [RECORDED_OAUTH] },
    verify() {
      eg.events.push("verify");
      return Promise.resolve([...eg.verifyProblems]);
    },
    listeners() {
      eg.events.push("listeners");
      return Promise.resolve([...eg.listenerProblems]);
    },
    startProxy(o) {
      eg.events.push("proxy");
      eg.proxyHosts = o.allowedHosts;
      eg.proxyRecord = o.record === true;
      eg.log = o.log;
      return Promise.resolve({
        shutdown: () => {
          eg.events.push("proxy down");
          return Promise.resolve();
        },
      });
    },
    async probe(sandbox, hosts) {
      eg.events.push("probe");
      eg.probedHosts = hosts;
      // The real preflight's deny probes produce proxy denies: never a violation.
      eg.log?.({
        at: new Date().toISOString(),
        decision: "deny",
        target: "example.com:443",
        reason: "host not allowed",
      });
      await eg.onProbe(sandbox);
      // A registered cell runs the authenticated preflight; the
      // qualification probe (startProxy) the credentialless one.
      return eg.lines(
        passingLines(hosts, {
          record: eg.proxyRecord,
          auth: eg.registered !== null,
        }),
      );
    },
  };
  return eg;
}

/** Verified enforcement: the internal network, the proxy and the preflight (entrypoints wait for ready). */
export function enforce(t: TestEnv, eg: FakeEgress = fakeEgress()): FakeEgress {
  t.env.egressEnforced = true;
  t.env.egress = eg;
  t.env.backendUrl = `http://${SANDBOX_NETWORK.gateway}:3210`;
  t.docker.waitForReady = true;
  return eg;
}
