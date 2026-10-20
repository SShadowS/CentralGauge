import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { Command } from "@cliffy/command";
import { stripAnsiCode } from "@std/fmt/colors";
import { join, resolve } from "@std/path";
import { stub } from "@std/testing/mock";
import {
  type CellCliOptions,
  cellGate,
  harnessCell,
  harnessEgressVerify,
  harnessImagesBuild,
  harnessJudgeFixture,
  harnessJudgePending,
  harnessMeasure,
  harnessPairing,
  harnessQualify,
  harnessRejudge,
  harnessReport,
  harnessRun,
  harnessSymbolsLock,
  parseRerunCell,
  publicationLockDir,
  registerHarnessCommand,
  validateHarness,
} from "../../../../cli/commands/harness-command.ts";
import {
  backendAddress,
  baselineCreate,
  EGRESS_MARKER,
  egressMode,
  envCheck,
  type EnvDeps,
  type EnvOptions,
  openHarnessEnv,
  openPlanEnv,
  recoverContainer,
  type ResetFor,
  resolveEgress,
} from "../../../../cli/commands/harness-env.ts";
import {
  claimRecord,
  findRecords,
  type NewRecord,
  recordFile,
} from "../../../../src/harness/quarantine.ts";
import {
  BACKEND_PORT,
  cellEgressProblems,
  type EgressState,
  firewallPlan,
  preflightExpect,
  PROXY_PORT,
  realEgressRuntime,
  RECORDED_HOSTS_PATH,
  SANDBOX_NETWORK,
} from "../../../../src/harness/egress.ts";
import {
  PROXY_ISOLATION,
  startSharedEgressProxy,
} from "../../../../src/harness/egress-proxy.ts";
import { claudeCodeAdapter } from "../../../../src/harness/adapters/claude-code.ts";
import { loadSymbolsLock } from "../../../../src/harness/identity.ts";
import {
  AL_LSP_DEF,
  AL_LSP_RESOLVED,
  AL_LSP_SHIPPED,
  AL_TOOLS_DEF,
  BASE_IMAGE,
  CLAUDE_CODE_RESOLVED,
  FROZEN_IMAGE_TAGS,
  imageTag,
  lspLabel,
  mcpLabel,
} from "../../../../src/harness/images.ts";
import {
  loadCampaignData,
  runCampaign,
} from "../../../../src/harness/campaign.ts";
import { buildReport, renderReport } from "../../../../src/harness/report.ts";
import { writeVerdictLog } from "../../../../src/harness/verdict.ts";
import { sha256Hex } from "../../../../src/harness/hash.ts";
import {
  type ExecutionRecord,
  type JudgmentRecord,
  scorerFingerprint,
  verdictOf,
} from "../../../../src/harness/records.ts";
import {
  measureFingerprint,
  readMeasureRecord,
  writeMeasureRecord,
} from "../../../../src/harness/measures.ts";
import {
  currentScorerFingerprint,
  SCORER_SUITE,
} from "../../../../src/harness/verdict.ts";
import { oracleHash } from "../../../../src/harness/identity.ts";
import { loadTask } from "../../../../src/harness/task.ts";
import {
  acquireBenchLock,
  BenchLockHeldError,
  benchLockPath,
  readBenchLock,
} from "../../../../src/utils/bench-lock.ts";
import { FakeBc, OK_RESET } from "../../harness/fake-bc.ts";
import { lockDigestOf } from "../../../../src/harness/bc-lane.ts";
import {
  createBaseline,
  readInstanceManifest,
  renderEnvCheck,
} from "../../../../src/harness/environment.ts";
import { lineageCompat, loadLineage } from "../../../../src/harness/lineage.ts";
import {
  type FsDiffEntry,
  goldenReset,
} from "../../../../src/harness/reset.ts";
import {
  ADMIN_GROUPS_CSV,
  CC_MAIN_URL,
  CC_REL,
  ccFetch,
  ccLabels,
  ccRel,
  ccResolvedJson,
  ccWinUrl,
  FakeDocker,
  LSP_REL,
  lspReleaseLabels,
  lspResolvedJson,
} from "../../harness/fake-docker.ts";
import { runQualificationProbe } from "../../../../src/harness/egress-probe.ts";
import { holdExclusive } from "../../harness/hold-file.ts";
import {
  namespaceOwner,
  READY_FILE,
  realDocker,
} from "../../../../src/harness/sandbox.ts";
import { __setContextListerForTests } from "../../../../src/container/docker-context.ts";
import { createCommandMock } from "../../../utils/command-mock.ts";
import {
  CATALOG,
  ccBehavior,
  fakeEgress,
  makeEnv,
  mockImageBehavior,
  probeLines,
  type TestEnv,
} from "../../harness/runtime-fixture.ts";
import {
  CentralGaugeError,
  ConfigurationError,
  ContainerError,
  ValidationError,
} from "../../../../src/errors.ts";
import { exists } from "../../../../src/harness/fsutil.ts";
import { loadPairing } from "../../../../src/harness/judgment-report.ts";
import { RecordStore } from "../../../../src/harness/records.ts";
import {
  campaign,
  CAMPAIGN_ID,
  execution,
  judgment,
  storeDescriptor,
} from "../../harness/fixtures.ts";

async function write(root: string, rel: string, text: string) {
  await Deno.mkdir(join(root, rel, ".."), { recursive: true });
  await Deno.writeTextFile(join(root, rel), text);
}

async function git(root: string, ...args: string[]) {
  const out = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
}

async function repo(ids = ["HX-001"]): Promise<string> {
  const root = await testTempDir();
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "t@example.com");
  await git(root, "config", "user.name", "t");
  await write(root, "harness-tasks/refapp/Core/app.json", "{}");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "refapp");
  await git(root, "tag", "refapp-v1");
  for (const id of ids) {
    await write(
      root,
      `harness-tasks/tasks/${id}/task.yml`,
      `id: ${id}
refapp_version: refapp-v1
kind: bugfix
prompt: prompt.md
source: refapp
scorers: [build, fail_to_pass]
fail_to_pass:
  depends_on: [Rental]
  tests:
    - { codeunit: 85001, procedures: [A] }
`,
    );
    await write(root, `harness-tasks/tasks/${id}/prompt.md`, "Fix it.");
    await write(root, `harness-tasks/tasks/${id}/oracle/T.al`, "x");
  }
  await write(
    root,
    "site/catalog/models.yml",
    "- slug: anthropic/model-a\n  api_model_id: model-a\n",
  );
  return root;
}

const CONFIG = (id: string, model = "anthropic/model-a", extra = "") =>
  `id: ${id}
harness: claude-code
harness_version: 2.1.282
models: { main: ${model} }
limits: { timeout_min: 30, max_budget_usd: 5 }
${extra}`;

/** Variant b differs from baseline a in skills only (vary: [skills]). */
const SKILLS = "components: { skills: skills }\n";

async function arms(root: string) {
  await write(root, "harness/skills/s.md", "skill");
  await write(root, "harness/configs/a.yml", CONFIG("a"));
  await write(root, "harness/configs/b.yml", CONFIG("b", undefined, SKILLS));
}

const EXPERIMENT = `id: x
hypothesis: h
primary_metric: cost_per_solved_task
baseline: a
variants: [b]
vary: [skills]
tasks: "harness-tasks/tasks/*"
`;

Deno.test("validateHarness: tasks, experiments and catalog; says it is static", async () => {
  const root = await repo();
  await arms(root);
  await write(root, "harness/experiments/x.yml", EXPERIMENT);
  const lines = (await validateHarness(root)).map(stripAnsiCode);
  assertStringIncludes(lines[0]!, "[OK] 1 tasks");
  assertStringIncludes(lines[0]!, "provisional");
  assertStringIncludes(lines[1]!, "[OK] experiment x (2 arms)");
  assertStringIncludes(lines[2]!, "Static checks only");
});

Deno.test("validateHarness: broken experiment or unknown model fails loudly", async () => {
  const root = await repo();
  await write(root, "harness/experiments/x.yml", "id: x\nhypothesis: h\n");
  await assertRejects(() => validateHarness(root), ValidationError, "x.yml");
  await write(root, "harness/experiments/x.yml", EXPERIMENT);
  await write(root, "harness/configs/a.yml", CONFIG("a"));
  await write(root, "harness/configs/b.yml", CONFIG("b", "anthropic/model-zz"));
  await assertRejects(
    () => validateHarness(root),
    ConfigurationError,
    "b.models.main: anthropic/model-zz",
  );
});

async function storeWithOneCell(): Promise<string> {
  const dir = await testTempDir();
  const store = new RecordStore(dir);
  const c = await campaign();
  await store.writeCampaign(c);
  const e = execution(c);
  await store.writeExecution(e);
  await store.writeJudgment(judgment(c, e, true));
  return dir;
}

const OPTS = {
  resamples: 10,
  seed: 1,
  judging: "campaign" as const,
  root: ".",
};

Deno.test("harnessReport: newest campaign from the store, loud when none, bad options refused", async () => {
  const empty = await testTempDir();
  await assertRejects(
    () => harnessReport("skills-vs-plain", { resultsDir: empty, ...OPTS }),
    CentralGaugeError,
    "No campaign",
  );
  const dir = await storeWithOneCell();
  const r = await harnessReport("skills-vs-plain", {
    resultsDir: dir,
    ...OPTS,
  });
  assertEquals(r.campaign.id, CAMPAIGN_ID);
  assertEquals(r.arms[0]!.scored_cells, 1);
  // The report path always loads traces: coverage[].trace is present, never null.
  assertEquals(r.coverage.every((c) => c.trace !== null), true);
  assertEquals(r.trace_invalid, []);
  await assertRejects(
    () =>
      harnessReport("skills-vs-plain", {
        resultsDir: dir,
        ...OPTS,
        resamples: 0,
      }),
    ValidationError,
    "resamples",
  );
});

Deno.test("harnessReport: --judging current needs every campaign task, then uses the working tree's oracles", async () => {
  const dir = await storeWithOneCell();
  const partial = await repo(["HX-001"]);
  await assertRejects(
    () =>
      harnessReport("skills-vs-plain", {
        resultsDir: dir,
        ...OPTS,
        judging: "current",
        root: partial,
      }),
    ValidationError,
    "no oracle for HX-002",
  );
  const root = await repo(["HX-001", "HX-002"]);
  const r = await harnessReport("skills-vs-plain", {
    resultsDir: dir,
    ...OPTS,
    judging: "current",
    root,
  });
  assertEquals(r.judging.source, "current");
  // The stored judgment was made against the campaign's oracle, not these.
  assertEquals(r.judging.tasks_with_other_oracle, ["HX-001", "HX-002"]);
  assertEquals(r.arms[0]!.scored_cells, 0);
  assertEquals(r.arms[0]!.pending_cells, 1);
});

Deno.test("CLI: `harness report --json` parses through cliffy and prints the JSON report", async () => {
  const dir = await storeWithOneCell();
  const cli = new Command().name("centralgauge");
  registerHarnessCommand(cli);
  const printed: string[] = [];
  const log = stub(console, "log", (...args: unknown[]) => {
    printed.push(args.join(" "));
  });
  try {
    await cli.parse([
      "harness",
      "report",
      "skills-vs-plain",
      "--results-dir",
      dir,
      "--json",
      "--resamples",
      "25",
      "--seed",
      "4",
      "--judging",
      "campaign",
    ]);
  } finally {
    log.restore();
  }
  const report = JSON.parse(printed.join("\n"));
  assertEquals(report.campaign.id, CAMPAIGN_ID);
  assertEquals(report.comparisons[0].resamples, 25);
  assertEquals(report.comparisons[0].seed, 4);
  assertEquals(report.judging.source, "campaign");
  assertEquals(report.repeats, { planned: 1, reported: 1 });
});

Deno.test("CLI: `harness report --repeats` reaches buildReport; above the plan is refused", async () => {
  const dir = await storeWithOneCell();
  await assertRejects(
    () =>
      harnessReport("skills-vs-plain", {
        resultsDir: dir,
        ...OPTS,
        repeats: 2,
      }),
    ValidationError,
    "repeats",
  );
  const cli = new Command().name("centralgauge");
  registerHarnessCommand(cli);
  const printed: string[] = [];
  const log = stub(console, "log", (...args: unknown[]) => {
    printed.push(args.join(" "));
  });
  try {
    await cli.parse([
      "harness",
      "report",
      "skills-vs-plain",
      "--results-dir",
      dir,
      "--json",
      "--resamples",
      "25",
      "--repeats",
      "1",
      "--judging",
      "campaign",
    ]);
  } finally {
    log.restore();
  }
  assertEquals(JSON.parse(printed.join("\n")).repeats, {
    planned: 1,
    reported: 1,
  });
});

Deno.test("CLI: `harness --help` lists validate and report", async () => {
  const cli = new Command().name("centralgauge").noExit();
  registerHarnessCommand(cli);
  const printed: string[] = [];
  const log = stub(console, "log", (...args: unknown[]) => {
    printed.push(args.join(" "));
  });
  try {
    await cli.parse(["harness", "--help"]);
  } finally {
    log.restore();
  }
  const text = stripAnsiCode(printed.join("\n"));
  assertStringIncludes(text, "validate");
  assertStringIncludes(text, "report");
});

// Added in M1-10 review hardening: every problem listed, explicit judging
// context, exit codes, determinism.

Deno.test("validateHarness: lists every problem, not only the first", async () => {
  const root = await repo();
  await write(root, "harness/experiments/x.yml", "id: x\nhypothesis: h\n");
  await write(root, "harness/experiments/y.yml", "id: y\n");
  await write(root, "harness/experiments/z.yaml", EXPERIMENT);
  const err = await assertRejects(
    () => validateHarness(root),
    ValidationError,
    "3 problems",
  );
  assertStringIncludes(err.message, "x.yml");
  assertStringIncludes(err.message, "y.yml");
  assertStringIncludes(err.message, "z.yaml: not an experiment file");
});

Deno.test("validateHarness: a missing task dir is a problem that names it, experiments still checked", async () => {
  const root = await testTempDir();
  await write(root, "harness/experiments/x.yml", "id: x\n");
  const err = await assertRejects(
    () => validateHarness(root),
    ValidationError,
    "3 problems",
  );
  assertStringIncludes(err.message, join("harness-tasks", "tasks"));
  assertStringIncludes(err.message, "x.yml");
  // No site/catalog in this root: the catalog is still read and reported.
  assertStringIncludes(err.message, "catalog missing, empty or not a list");
});

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const log = stub(console, "log", (...a: unknown[]) => {
    out.push(a.join(" "));
  });
  const error = stub(console, "error", (...a: unknown[]) => {
    err.push(a.join(" "));
  });
  return {
    out,
    err,
    restore() {
      log.restore();
      error.restore();
    },
  };
}

Deno.test("CLI: `harness validate` failure prints [FAIL] with every problem and exits 1", async () => {
  const root = await repo();
  await write(root, "harness/experiments/x.yml", "id: x\n");
  await write(root, "harness/experiments/y.yml", "id: y\n");
  const cli = new Command().name("centralgauge");
  registerHarnessCommand(cli);
  const c = capture();
  try {
    await cli.parse(["harness", "validate", "--root", root]);
    assertEquals(Deno.exitCode, 1);
  } finally {
    c.restore();
    Deno.exitCode = 0;
  }
  const text = stripAnsiCode(c.err.join("\n"));
  assertStringIncludes(text, "[FAIL]");
  assertStringIncludes(text, "x.yml");
  assertStringIncludes(text, "y.yml");
});

Deno.test("CLI: `harness report` requires --judging and prints the context", async () => {
  const dir = await storeWithOneCell();
  const bare = new Command().name("centralgauge").noExit();
  registerHarnessCommand(bare);
  const c0 = capture();
  try {
    await assertRejects(
      () =>
        bare.parse([
          "harness",
          "report",
          "skills-vs-plain",
          "--results-dir",
          dir,
        ]),
      Error,
      "judging",
    );
  } finally {
    c0.restore();
  }
  const cli = new Command().name("centralgauge");
  registerHarnessCommand(cli);
  const c = capture();
  try {
    await cli.parse([
      "harness",
      "report",
      "skills-vs-plain",
      "--results-dir",
      dir,
      "--judging",
      "campaign",
      "--resamples",
      "10",
    ]);
  } finally {
    c.restore();
  }
  assertStringIncludes(
    stripAnsiCode(c.out.join("\n")),
    "Judged with campaign oracles",
  );
});

Deno.test("CLI: `harness report` refuses inconsistent records with exit 1", async () => {
  const dir = await storeWithOneCell();
  const c0 = await campaign();
  // A second planned execution for the same cell: inconsistent.
  const e = execution(c0);
  await new RecordStore(dir).writeExecution({
    ...e,
    id: "00000000-0000-4000-8000-0000000000ff",
  });
  const cli = new Command().name("centralgauge");
  registerHarnessCommand(cli);
  const c = capture();
  try {
    await cli.parse([
      "harness",
      "report",
      "skills-vs-plain",
      "--results-dir",
      dir,
      "--judging",
      "campaign",
      "--json",
    ]);
    assertEquals(Deno.exitCode, 1);
  } finally {
    c.restore();
    Deno.exitCode = 0;
  }
  assertEquals(c.out, []);
  assertStringIncludes(stripAnsiCode(c.err.join("\n")), "Inconsistent records");
});

Deno.test("harnessReport: JSON is byte-identical across runs", async () => {
  const dir = await storeWithOneCell();
  const a = await harnessReport("skills-vs-plain", {
    resultsDir: dir,
    ...OPTS,
  });
  const b = await harnessReport("skills-vs-plain", {
    resultsDir: dir,
    ...OPTS,
  });
  assertEquals(JSON.stringify(a, null, 2), JSON.stringify(b, null, 2));
});

// Coordinator review of M1-10: vary, tasks pattern, file-named model
// problems, unused configs, catalog always read.

Deno.test("validateHarness: a variant differing outside vary is a problem naming the file and field", async () => {
  const root = await repo();
  await arms(root);
  await write(
    root,
    "harness/configs/b.yml",
    CONFIG("b", undefined, SKILLS).replace(
      "timeout_min: 30",
      "timeout_min: 60",
    ),
  );
  await write(root, "harness/experiments/x.yml", EXPERIMENT);
  const err = await assertRejects(() => validateHarness(root), Error);
  assertStringIncludes(err.message, "x.yml");
  assertStringIncludes(err.message, "b differs from baseline a in limits");
});

Deno.test("validateHarness: a variant identical to the baseline in every vary field is a problem", async () => {
  const root = await repo();
  await arms(root);
  await write(root, "harness/configs/b.yml", CONFIG("b"));
  await write(root, "harness/experiments/x.yml", EXPERIMENT);
  const err = await assertRejects(() => validateHarness(root), Error);
  assertStringIncludes(err.message, "x.yml");
  assertStringIncludes(err.message, "b equals baseline a in every vary field");
});

Deno.test("validateHarness: a tasks pattern matching no task is a problem naming the file", async () => {
  const root = await repo();
  await arms(root);
  await write(
    root,
    "harness/experiments/x.yml",
    EXPERIMENT.replace("harness-tasks/tasks/*", "harness-tasks/tasks/ZZ-*"),
  );
  const err = await assertRejects(() => validateHarness(root), Error);
  assertStringIncludes(err.message, "x.yml");
  assertStringIncludes(err.message, "harness-tasks/tasks/ZZ-* matches no task");
});

Deno.test("validateHarness: two experiments sharing a bad config give lines naming each experiment", async () => {
  const root = await repo();
  await arms(root);
  await write(
    root,
    "harness/configs/b.yml",
    CONFIG("b", "anthropic/model-zz", SKILLS),
  );
  await write(root, "harness/experiments/x.yml", EXPERIMENT);
  await write(
    root,
    "harness/experiments/y.yml",
    EXPERIMENT.replace("id: x", "id: y"),
  );
  const err = await assertRejects(() => validateHarness(root), Error);
  const lines = err.message.split("\n").filter((l) =>
    l.includes("b.models.main: anthropic/model-zz")
  );
  assertEquals(lines.length, 3);
  assertStringIncludes(lines.find((l) => l.includes("x.yml"))!, "x.yml");
  assertStringIncludes(lines.find((l) => l.includes("y.yml"))!, "y.yml");
  assertStringIncludes(lines.find((l) => l.includes("b.yml"))!, "b.yml");
});

Deno.test("validateHarness: configs no experiment uses are loaded and catalog-checked", async () => {
  const root = await repo();
  await write(root, "harness/configs/c.yml", CONFIG("c", "anthropic/model-zz"));
  await write(root, "harness/configs/notes.txt", "x");
  const err = await assertRejects(
    () => validateHarness(root),
    ValidationError,
    "2 problems",
  );
  assertStringIncludes(err.message, "c.yml");
  assertStringIncludes(err.message, "c.models.main: anthropic/model-zz");
  assertStringIncludes(err.message, "notes.txt: not a config file");
});

Deno.test("validateHarness: the catalog is read even with no experiments", async () => {
  const root = await repo();
  await write(root, "site/catalog/models.yml", "");
  await assertRejects(
    () => validateHarness(root),
    ConfigurationError,
    "catalog missing, empty or not a list",
  );
});

// ---- M1-24: cell, judge-fixture, images build, symbols lock ----

/**
 * H-35 run 004 #4: the golden-o09-v2 lineage with an nst_config section, in a
 * temp dir with its sidecars (until lane-ops' v2 carries the section).
 */
async function v2Lineage(): Promise<string> {
  const src = resolve("infra/harness-reset/lineages");
  const dir = await Deno.realPath(await testTempDir());
  const j = JSON.parse(
    await Deno.readTextFile(join(src, "golden-o09-v2.json")),
  );
  j.nst_config ??= {
    digest_version: 1,
    path:
      "C:\\Program Files\\Microsoft Dynamics NAV\\280\\Service\\CustomSettings.config",
    exclude_keys: ["PublicWebBaseUrl"],
    sha256: "e".repeat(64),
    keys: 251,
  };
  for (const f of [j.inventory.path, j.content_root.path]) {
    await Deno.copyFile(join(src, f), join(dir, f));
  }
  await Deno.writeTextFile(join(dir, "golden-o09-v2.json"), JSON.stringify(j));
  return join(dir, "golden-o09-v2.json");
}

/**
 * The production mechanism with nothing reaching a container: its reset is
 * faked and its live NST config digest equals the lineage's.
 */
const testResetFor: ResetFor = (lineagePath, lineage) => ({
  ...goldenReset({
    repoRoot: ".",
    lineagePath,
    lineage,
    dockerEnv: {},
    spawn: () =>
      Promise.resolve({
        code: 0,
        stdout: `NST_CONFIG ${lineage.nst_config?.sha256 ?? ""}`,
      }),
  }),
  reset: OK_RESET.reset,
});

/** H-35 run 004 Sol r1 H5: a fake Docker container id, one per (case-insensitive) name. */
const fakeId = (c: string) =>
  [...new TextEncoder().encode(c.toLowerCase())]
    .map((b) => b.toString(16).padStart(2, "0")).join("").padEnd(64, "0")
    .slice(0, 64);

/** H-35 run 004 Sol r2 N1: plant a record as another owner would (create-new, its own token). */
async function plantRecord(
  dir: string,
  r: Omit<NewRecord, "token" | "host"> & { token?: string },
  o: { recover?: boolean } = {},
): Promise<string> {
  const token = r.token ?? crypto.randomUUID();
  assert(await claimRecord(dir, { host: "OTHER", ...r, token }, o));
  return token;
}

function deps(
  order: string[],
  lock?: () => never,
  verify: () => Promise<string[]> = () =>
    Promise.resolve(["not implemented (M1-33)"]),
): EnvDeps {
  const docker = new FakeDocker();
  docker.owned = ["cg-harness-dead-beef"];
  // H-35 run 004 #3: never the real coord root (absent until a test writes).
  const quarantineDir = join(trackTempDir(Deno.makeTempDirSync()), "q");
  const listOwned = docker.listOwned.bind(docker);
  docker.listOwned = (o) => {
    // M10-08c run 003: the fake lists every owner alike; the bare hostname
    // (the read-only legacy probe, not a sweep) owns nothing here.
    if (o === "HOST1") return Promise.resolve([]);
    order.push("sweep");
    return listOwned(o);
  };
  return {
    // The campaign allocation (coord allocation.json) is its own seam; every container here is allocated.
    allocated: (c) => Promise.resolve(c),
    acquireLock: (dir, o) => {
      // M10-08c: the private root's lock is the real one (its exclusivity is under test).
      if (o.command.endsWith("(private root)")) return acquireBenchLock(dir, o);
      if (lock) lock();
      order.push("lock");
      return () => {
        order.push("release");
        return Promise.resolve();
      };
    },
    docker: () => docker,
    setup: (names) => {
      order.push("setup");
      return Promise.resolve({
        bc: new FakeBc(),
        names,
        dispose: () => Promise.resolve(),
      });
    },
    inspect: () => new FakeBc(),
    quarantineDir: () => quarantineDir,
    containerId: (c) => Promise.resolve(fakeId(c)),
    resetFor: testResetFor,
    resolveHost: () => {
      order.push("host");
      return Promise.resolve("127.0.0.1");
    },
    owner: () => "HOST1",
    health: (names) => {
      order.push(`health:${names.join(",")}`);
      return { getState: () => ({ containers: [] }), record: () => {} };
    },
    verifyEgress: verify,
  };
}

const envOpts = (t: TestEnv, containers = ["Cronus281"]) => ({
  repoRoot: t.repo.root,
  resultsDir: t.env.resultsRoot,
  containers,
  backendPort: 0,
  secretsSource: t.env.secretsSource,
  symbolStore: t.repo.symbolStore,
  privateRoot: t.env.privateRoot,
  credentialLedger: t.env.credentialLedger,
  command: "test",
  supervised: true,
});

const cellOpts = (
  t: TestEnv,
  over: Partial<CellCliOptions> & { manifest?: string | null } = {},
): CellCliOptions & { manifest: string | null } => ({
  root: t.repo.root,
  resultsDir: t.env.resultsRoot,
  containers: ["Cronus281"],
  backendPort: 0,
  secretsDir: t.env.secretsSource,
  symbolStore: t.repo.symbolStore,
  privateDir: t.env.privateRoot,
  credentialLedger: t.env.credentialLedger,
  supervised: true,
  repeat: 1,
  rev: null,
  manifest: null,
  ...over,
});

const opener = (t: TestEnv) => () =>
  Promise.resolve({ env: t.env, close: () => Promise.resolve() });
const noInterrupt = () => () => {};

/** harness cell reads the model catalog under <root>/site/catalog (the fixture repo has none). */
async function writeCatalog(t: TestEnv) {
  await write(
    t.repo.root,
    "site/catalog/models.yml",
    "- slug: anthropic/claude-sonnet-5\n  api_model_id: claude-sonnet-5\n  family: claude\n  display_name: S5\n",
  );
  await write(t.repo.root, "site/catalog/pricing.yml", "[]\n");
  await write(t.repo.root, "site/catalog/model-families.yml", "[]\n");
}

Deno.test("openHarnessEnv: refused containers first, then lock, sweep, containers, health monitor, backend, recovery; release last", async () => {
  await using t = await makeEnv();
  const order: string[] = [];
  await assertRejects(
    () => openHarnessEnv(envOpts(t, ["Cronus281", "Cronus28"]), deps(order)),
    ConfigurationError,
    "Cronus28",
  );
  await assertRejects(
    () => openHarnessEnv(envOpts(t, ["cronus284"]), deps(order)),
    ConfigurationError,
    "Cronus284",
  );
  assertEquals(order, []);
  const h = await openHarnessEnv(envOpts(t), deps(order));
  assertEquals(
    h.env.deploy.ledgerRoot,
    join(t.repo.root, "results", "harness", "bc-ledger"),
    "one ledger scope for every caller",
  );
  await h.close();
  // The second sweep is recoverInterrupted's own (it sweeps before recovering).
  assertEquals(order, [
    "lock",
    "sweep",
    "setup",
    "health:Cronus281",
    "host",
    "sweep",
    "release",
  ]);
});

Deno.test("openHarnessEnv: a container outside the campaign allocation is refused before the lock", async () => {
  await using t = await makeEnv();
  const order: string[] = [];
  const d = deps(order);
  d.allocated = (c) =>
    c === "Cronus281"
      ? Promise.resolve(c)
      : Promise.reject(new ValidationError(`${c} is not allocated`, [c]));
  await assertRejects(
    () => openHarnessEnv(envOpts(t, ["Cronus281", "Cronus285"]), d),
    ValidationError,
    "Cronus285",
  );
  assertEquals(order, []);
});

Deno.test("openHarnessEnv: a task without an oracle app does not stop the start; the removal allowlist is never env-wide", async () => {
  await using t = await makeEnv();
  await write(
    t.repo.tasksDir,
    "HX-002/task.yml",
    "id: HX-002\nrefapp_version: refapp-v1\nkind: test-authoring\nprompt: prompt.md\nsource: refapp\nscorers: [build, mutant_kill]\n",
  );
  await write(t.repo.tasksDir, "HX-002/prompt.md", "x");
  await write(t.repo.tasksDir, "HX-002/correct/Rental/src/R.al", "x");
  const h = await openHarnessEnv(envOpts(t), deps([]));
  // Owned ids come from each grant's and judgment's trusted roots (M1-16), never from the env.
  // H-35 S3: the env also carries the judges' reset mechanism (no allowlist).
  assertEquals(Object.keys(h.env.deploy), ["ledgerRoot", "reset"]);
  await h.close();
});

Deno.test("openHarnessEnv: a held bench lock stops before any docker call", async () => {
  await using t = await makeEnv();
  const order: string[] = [];
  const held = () => {
    throw new BenchLockHeldError(null, "results/.bench-running.json");
  };
  await assertRejects(
    () => openHarnessEnv(envOpts(t), deps(order, held)),
    BenchLockHeldError,
  );
  assertEquals(order, []);
});

Deno.test("resolveEgress: no marker is not enforced; a marker that fails verification stops; only verified authorized counts", async () => {
  // Review item 3: an authorized marker counts only with its complete evidence.
  const root = join(await authorizedRoot(), "results", "harness");
  const authorized = await Deno.readTextFile(join(root, EGRESS_MARKER));
  await Deno.remove(join(root, EGRESS_MARKER));
  assertEquals(await resolveEgress(root, () => Promise.resolve([])), false);
  await Deno.writeTextFile(join(root, EGRESS_MARKER), authorized);
  await assertRejects(
    () =>
      resolveEgress(
        root,
        () => Promise.resolve(["rule cg-harness-egress-tcp disabled"]),
      ),
    ConfigurationError,
    "disabled",
  );
  assertEquals(await resolveEgress(root, () => Promise.resolve([])), true);
  await Deno.writeTextFile(
    join(root, EGRESS_MARKER),
    JSON.stringify({ v: 1, state: "qualified" }),
  );
  assertEquals(await resolveEgress(root, () => Promise.resolve([])), false);
});

Deno.test("cellGate: credential-bearing arms need enforcement, or --supervised at a terminal; others run unattended", () => {
  const mock = { ...claudeCodeAdapter, credentialBearing: false };
  cellGate(mock, { supervised: false, egressEnforced: false }, () => false);
  cellGate(
    claudeCodeAdapter,
    { supervised: false, egressEnforced: true },
    () => false,
  );
  cellGate(
    claudeCodeAdapter,
    { supervised: true, egressEnforced: false },
    () => true,
  );
  assertThrows(
    () =>
      cellGate(
        claudeCodeAdapter,
        { supervised: false, egressEnforced: false },
        () => true,
      ),
    ConfigurationError,
    "--supervised",
  );
  assertThrows(
    () =>
      cellGate(
        claudeCodeAdapter,
        { supervised: true, egressEnforced: false },
        () => false,
      ),
    ConfigurationError,
    "terminal",
  );
});

Deno.test("harnessCell: a mock arm runs unattended with the variant from --qualify-manifest", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.docker.behavior = mockImageBehavior();
  const manifest = join(t.env.privateRoot, "qualify-manifest.json");
  await Deno.writeTextFile(
    manifest,
    JSON.stringify({
      v: 1,
      refapp_version: "refapp-v1",
      tasks: {
        "HX-001": { rev: "refapp-v1", positive: "correct", naive: ["b"] },
      },
    }),
  );
  const open = () =>
    Promise.resolve({
      env: { ...t.env, supervised: false, qualifyManifest: null },
      close: () => Promise.resolve(),
    });
  const o = cellOpts(t, { supervised: false, qualifyManifest: manifest });
  const r = await harnessCell(
    "mock-positive",
    "HX-001",
    o,
    open,
    () => false,
    noInterrupt,
  );
  assertEquals(
    (await t.env.store.judgments(r.executions[0]!.id))[0]!.verdict,
    "pass",
  );
  // The manifest from the option is the one used: naive:a is not listed in it.
  await assertRejects(
    () =>
      harnessCell("mock-naive-a", "HX-001", o, open, () => false, noInterrupt),
    ConfigurationError,
    "naive variant a is not listed",
  );
});

Deno.test("harnessCell: one supervised cell; the reservation lands in the shared ledger", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const r = await harnessCell(
    "cc-sonnet-plain",
    "HX-001",
    cellOpts(t),
    opener(t),
    () => true,
    noInterrupt,
  );
  assertEquals([r.executions.length, r.executions[0]!.termination], [
    1,
    "completed",
  ]);
  assertEquals(
    (await Deno.readTextFile(t.env.credentialLedger!)).trim().split("\n")
      .length,
    1,
  );
});

Deno.test("harnessCell: Ctrl+C stops the sandbox at once and the attempt is recorded", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  let fire: () => void = () => {};
  t.docker.behavior = async (call, io) => {
    await ccBehavior(
      join(t.repo.tasksDir, "HX-001"),
      "correct",
      (await probeLines()).slice(0, 12),
    )(call, io);
    fire();
    await io.killed;
    return 137;
  };
  const r = await harnessCell(
    "cc-sonnet-plain",
    "HX-001",
    cellOpts(t),
    opener(t),
    () => true,
    (cb) => {
      fire = cb;
      return () => {};
    },
  );
  assertEquals(r.executions[0]!.termination, "harness_crash");
  assertEquals(t.docker.kills.length, 1);
});

Deno.test("harnessJudgeFixture: complete judgment and provenance persisted; variants and revisions follow the manifest", async () => {
  await using t = await makeEnv();
  await git(t.repo.root, "add", ".");
  await git(t.repo.root, "commit", "-q", "-m", "tasks");
  await git(t.repo.root, "tag", "refapp-v1-rc1");
  const manifest = join(t.env.privateRoot, "qualify-manifest.json");
  await Deno.writeTextFile(
    manifest,
    JSON.stringify({
      v: 1,
      refapp_version: "refapp-v1",
      tasks: {
        "HX-001": { rev: "refapp-v1-rc1", positive: "correct", naive: ["a"] },
      },
    }),
  );
  const o = cellOpts(t, { rev: "refapp-v1-rc1", manifest });
  const pass = await harnessJudgeFixture("HX-001", "correct", o, opener(t));
  assertEquals(pass.verdict, "pass");
  const dir = join(t.env.resultsRoot, "fixtures", "HX-001", "correct", pass.id);
  const saved = JSON.parse(
    await Deno.readTextFile(join(dir, "judgment.json")),
  );
  assertEquals(saved.scorers.map((s: { name: string }) => s.name), [
    "build",
    "pass_to_pass",
    "fail_to_pass",
    "agent_tests",
  ]);
  const prov = JSON.parse(
    await Deno.readTextFile(join(dir, "provenance.json")),
  );
  assertEquals([
    prov.task_id,
    prov.variant,
    prov.rev,
    prov.task_commit.length,
    prov.task_tree.length,
  ], ["HX-001", "correct", "refapp-v1-rc1", 40, 40]);
  assertEquals(prov.workspace_hash, pass.workspace_hash);
  assertEquals(
    (await harnessJudgeFixture("HX-001", "naive/a", o, opener(t))).verdict,
    "fail",
  );
  await assertRejects(
    () => harnessJudgeFixture("HX-001", "naive/zz", o, opener(t)),
    ConfigurationError,
    "not listed",
  );
  await assertRejects(
    () =>
      harnessJudgeFixture("HX-001", "correct", { ...o, rev: null }, opener(t)),
    ConfigurationError,
    "refapp-v1-rc1",
  );
  await assertRejects(
    () =>
      harnessJudgeFixture(
        "HX-001",
        "naive/../oracle",
        { ...o, manifest: null },
        opener(t),
      ),
    ConfigurationError,
    "variant",
  );
  assertEquals(
    await t.env.store.executions("11111111-2222-4333-8444-555555555555"),
    [],
    "fixtures never create executions",
  );
});

Deno.test("harnessImagesBuild: base needs a digest pin; the harness build gets the base and is verified by layers", async () => {
  const root = await Deno.realPath(await testTempDir());
  const docker = new FakeDocker();
  await assertRejects(
    () => harnessImagesBuild("base", { root }, docker),
    ConfigurationError,
    "pins.json",
  );
  await Deno.mkdir(join(root, "harness", "images"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "harness", "images", "pins.json"),
    JSON.stringify({
      servercore: "mcr.microsoft.com/windows/servercore:ltsc2025",
    }),
  );
  await assertRejects(
    () => harnessImagesBuild("base", { root }, docker),
    ConfigurationError,
    "@sha256:",
  );
  const pin = `mcr.microsoft.com/windows/servercore@sha256:${"e".repeat(64)}`;
  await Deno.writeTextFile(
    join(root, "harness", "images", "pins.json"),
    JSON.stringify({ servercore: pin }),
  );
  await assertRejects(
    () => harnessImagesBuild("base", { root }, docker),
    ConfigurationError,
    "al-tools-tools.json",
  );
  assertEquals(docker.builds.length, 0, "no build without the MCP label");
  await Deno.mkdir(join(root, "harness", "images", "base"), {
    recursive: true,
  });
  await Deno.copyFile(
    AL_TOOLS_DEF,
    join(root, "harness", "images", "base", "al-tools-tools.json"),
  );
  await assertRejects(
    () =>
      harnessImagesBuild("claude-code", { root, version: "2.1.282" }, docker),
    ConfigurationError,
    "base",
  );
  const baseId = `sha256:${"b".repeat(64)}`;
  const [mk, mv] = await mcpLabel(root);
  // Each base build starts with no base tag (an existing tag is refused);
  // the build produces it.
  const baseBuildsTo = (labels: Record<string, string>) => {
    docker.tags.delete(BASE_IMAGE);
    docker.buildResults.set(BASE_IMAGE, {
      id: baseId,
      labels,
      layers: ["l1", "l2"],
    });
  };
  baseBuildsTo({});
  await assertRejects(
    () => harnessImagesBuild("base", { root }, docker),
    ConfigurationError,
    `${BASE_IMAGE}: label ${mk}`,
  );
  docker.builds.length = 0;
  baseBuildsTo({ [mk]: `${mv.split(" ")[0]} ${"0".repeat(64)}` });
  await assertRejects(
    () => harnessImagesBuild("base", { root }, docker),
    ConfigurationError,
    `${BASE_IMAGE}: label ${mk}`,
  );
  docker.builds.length = 0;
  baseBuildsTo({ [mk]: mv });
  const bf = await harnessImagesBuild("base", { root }, docker);
  assertEquals(bf, {
    digest: baseId,
    base_digest: pin,
    harness: "base",
    version: "2",
    revision: null,
    mcp: {
      "al-tools": {
        version: mv.split(" ")[0]!,
        tool_schema_hash: mv.split(" ")[1]!,
      },
    },
  });
  assertStringIncludes(docker.builds[0]!.join(" "), `SERVERCORE=${pin}`);
  const baseArgs = docker.builds[0]!;
  const li = baseArgs.indexOf(`${mk}=${mv}`);
  assert(
    li > 0 && baseArgs[li - 1] === "--label" && li < baseArgs.indexOf("-t"),
    `base build labels al-tools before -t: ${baseArgs.join(" ")}`,
  );
  // H-03: claude-code builds resolve their version; the generic build path
  // (an explicit --version) is shown on the pi harness.
  const labels = {
    "centralgauge.harness": "pi",
    "centralgauge.harness.version": "0.87.1",
    "centralgauge.harness.base_digest": baseId,
  };
  // H-01 run 005: the changed Dockerfile builds under the r2 tag, never the frozen 0.87.1.
  docker.buildResults.set("centralgauge/harness-pi:0.87.1-r2", {
    id: `sha256:${"c".repeat(64)}`,
    labels: { ...labels, "centralgauge.harness.revision": "2" },
    layers: ["l1", "l2", "l3"],
  });
  const f = await harnessImagesBuild(
    "pi",
    { root, version: "0.87.1", revision: "2" },
    docker,
  );
  const args = docker.builds[1]!.join(" ");
  assertStringIncludes(
    args,
    `BASE=${baseId}`,
    "the inspected immutable id, never the tag",
  );
  assertStringIncludes(args, `centralgauge.harness.base_digest=${baseId}`);
  assertEquals(f.digest, `sha256:${"c".repeat(64)}`);
  // A new tag (an existing one is refused) whose layers miss the base's.
  docker.buildResults.set("centralgauge/harness-pi:0.87.2", {
    id: `sha256:${"d".repeat(64)}`,
    labels: { ...labels, "centralgauge.harness.version": "0.87.2" },
    layers: ["x1", "l3"],
  });
  await assertRejects(
    () => harnessImagesBuild("pi", { root, version: "0.87.2" }, docker),
    ConfigurationError,
    "layers",
  );
});

Deno.test("harnessSymbolsLock: writes a strict lock the identity accepts", async () => {
  const root = await Deno.realPath(await testTempDir());
  const from = await Deno.realPath(await testTempDir());
  await Deno.writeTextFile(
    join(from, "Microsoft_System_28.0.0.0.app"),
    "sys",
  );
  const n = await harnessSymbolsLock(
    { root, from, store: join(root, "store") },
    () =>
      Promise.resolve({
        id: "8874ed3a-0643-4247-9ced-7a7002f7135d",
        name: "System",
        publisher: "Microsoft",
        version: "28.0.0.0",
      }),
  );
  assertEquals([n, (await loadSymbolsLock(root))!.length], [1, 1]);
});

Deno.test("harnessImagesBuild: a base tag that moves between inspect and build cannot change the base", async () => {
  const root = await Deno.realPath(await testTempDir());
  const docker = new FakeDocker();
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1", "l2"]);
  // H-01 run 005: the r2 tag (0.87.1 itself is frozen and never built).
  // H-03: on pi, since claude-code builds resolve their version.
  const tag = "centralgauge/harness-pi:0.87.1-r2";
  docker.build = (args) => {
    docker.builds.push(args);
    // Someone rebuilds the base tag while this build runs.
    docker.addImage(BASE_IMAGE, `sha256:${"9".repeat(64)}`, {}, ["m1"]);
    docker.addImage(tag, `sha256:${"c".repeat(64)}`, {
      "centralgauge.harness": "pi",
      "centralgauge.harness.version": "0.87.1",
      "centralgauge.harness.base_digest": baseId,
      "centralgauge.harness.revision": "2",
    }, ["l1", "l2", "l3"]);
    return Promise.resolve(0);
  };
  const f = await harnessImagesBuild(
    "pi",
    { root, version: "0.87.1", revision: "2" },
    docker,
  );
  const args = docker.builds[0]!.join(" ");
  assertStringIncludes(args, `BASE=${baseId}`);
  assertEquals(args.includes(`BASE=${BASE_IMAGE}`), false);
  assertEquals(f.base_digest, baseId);
});

// ---- M1-24b: run, rejudge, qualify ----

async function mockExperiment(t: TestEnv, id = "contract") {
  await write(
    t.harnessRoot,
    `experiments/${id}.yml`,
    `id: ${id}
hypothesis: Mock contract.
primary_metric: pass_rate
baseline: mock-positive
variants: [mock-naive-a]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: 1
`,
  );
}

const runOpts = (t: TestEnv, over: Record<string, unknown> = {}) => ({
  ...cellOpts(t, { supervised: false }),
  dryRun: false,
  concurrency: 1,
  maxPauseMin: 0,
  yes: true,
  ...over,
});

function planDeps(
  t: TestEnv,
  order: string[],
  verify?: () => Promise<string[]>,
) {
  return { ...deps(order, undefined, verify), docker: () => t.docker };
}

Deno.test("run --dry-run prints the plan without a lock", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  await mockExperiment(t);
  const order: string[] = [];
  const lines: string[] = [];
  const log = stub(console, "log", (...a: unknown[]) => {
    lines.push(a.join(" "));
  });
  try {
    const s = await harnessRun(
      "contract",
      runOpts(t, { dryRun: true }),
      () => Promise.reject(new Error("a dry run opens no environment")),
      (eo) => openPlanEnv(eo, planDeps(t, order)),
    );
    assertEquals([s.planned, s.ran], [2, 0]);
  } finally {
    log.restore();
  }
  assertEquals(order.includes("lock"), false);
  assertStringIncludes(stripAnsiCode(lines.join("\n")), "HX-001#1:");
  assertEquals(t.docker.runs.length, 0);
});

Deno.test("run refuses a credential-bearing arm unless the verified state is authorized; a marker failing verification stops", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  await write(
    t.harnessRoot,
    "configs/cc-sonnet-effort.yml",
    `id: cc-sonnet-effort
harness: claude-code
harness_version: "2.1.282"
models: { main: anthropic/claude-sonnet-5 }
settings: { effort: high }
components: { instructions: bundles/env/instructions }
limits: { timeout_min: 30, max_budget_usd: 5 }
`,
  );
  await write(
    t.harnessRoot,
    "experiments/cc.yml",
    `id: cc
hypothesis: Effort.
primary_metric: pass_rate
baseline: cc-sonnet-plain
variants: [cc-sonnet-effort]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: 1
`,
  );
  const o = runOpts(t, { dryRun: true });
  const noEnv = () => Promise.reject(new Error("no environment"));
  const shared = join(t.repo.root, "results", "harness");
  await assertRejects(
    () => harnessRun("cc", o, noEnv, (eo) => openPlanEnv(eo, planDeps(t, []))),
    ConfigurationError,
    "egress",
  );
  // M1-33 run 002: an authorized marker counts only with its complete evidence.
  await authorizedRoot(t.repo.root);
  assert((await Deno.stat(join(shared, EGRESS_MARKER))).isFile);
  await assertRejects(
    () =>
      harnessRun(
        "cc",
        o,
        noEnv,
        (eo) =>
          openPlanEnv(
            eo,
            planDeps(t, [], () => Promise.resolve(["proxy not running"])),
          ),
      ),
    ConfigurationError,
    "proxy not running",
  );
  const s = await harnessRun(
    "cc",
    o,
    noEnv,
    (eo) => openPlanEnv(eo, planDeps(t, [], () => Promise.resolve([]))),
  );
  assertEquals(s.planned, 2);
});

Deno.test("H-13: run --unverified-egress-ok passes the egress refusal (dry run too); a blank reason or an enforced marker is refused", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  await write(
    t.harnessRoot,
    "configs/cc-sonnet-effort.yml",
    `id: cc-sonnet-effort
harness: claude-code
harness_version: "2.1.282"
models: { main: anthropic/claude-sonnet-5 }
settings: { effort: high }
components: { instructions: bundles/env/instructions }
limits: { timeout_min: 30, max_budget_usd: 5 }
`,
  );
  await write(
    t.harnessRoot,
    "experiments/cc.yml",
    `id: cc
hypothesis: Effort.
primary_metric: pass_rate
baseline: cc-sonnet-plain
variants: [cc-sonnet-effort]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: 1
`,
  );
  const noEnv = () => Promise.reject(new Error("no environment"));
  const planner = (eo: Parameters<typeof openPlanEnv>[0]) =>
    openPlanEnv(eo, planDeps(t, [], () => Promise.resolve([])));
  for (const reason of ["", "  "]) {
    await assertRejects(
      () =>
        harnessRun(
          "cc",
          runOpts(t, { dryRun: true, unverifiedEgressReason: reason }),
          noEnv,
          () => Promise.reject(new Error("refused before planning")),
        ),
      ConfigurationError,
      "--unverified-egress-ok needs a non-empty reason",
    );
  }
  const s = await harnessRun(
    "cc",
    runOpts(t, { dryRun: true, unverifiedEgressReason: "P-01 pilot" }),
    noEnv,
    planner,
  );
  assertEquals(s.planned, 2);
  await authorizedRoot(t.repo.root);
  await assertRejects(
    () =>
      harnessRun(
        "cc",
        runOpts(t, { dryRun: true, unverifiedEgressReason: "P-01 pilot" }),
        noEnv,
        planner,
      ),
    ConfigurationError,
    "enforced",
  );
});

Deno.test("H-13: `harness run --unverified-egress-ok <reason>` records the override on the campaign and its executions; absent, nothing is recorded", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await mockExperiment(t);
  const cli = new Command().name("centralgauge").noExit();
  registerHarnessCommand(cli, opener(t));
  const flags = [
    "--secrets-dir",
    t.env.privateRoot,
    "--private-dir",
    t.env.privateRoot,
  ];
  const cwd = Deno.cwd();
  const c = capture();
  try {
    Deno.chdir(t.repo.root);
    await cli.parse([
      "harness",
      "run",
      "contract",
      "--unverified-egress-ok",
      "P-01 pilot",
      ...flags,
    ]);
    assertEquals(Deno.exitCode ?? 0, 0, c.out.join("\n"));
  } finally {
    Deno.chdir(cwd);
    c.restore();
    Deno.exitCode = 0;
  }
  const want = { egress_enforced: false, reason: "P-01 pilot" };
  const [campaign] = await t.env.store.campaigns("contract");
  assertEquals(campaign!.egress_override, want);
  const es = await t.env.store.executions(campaign!.id);
  assertEquals(es.length, 2);
  for (const e of es) assertEquals(e.egress_override, want);
});

Deno.test("qualify judges every manifest variant at its rev and indexes judgment, provenance, expected and actual verdicts", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await git(t.repo.root, "add", ".");
  await git(t.repo.root, "commit", "-q", "-m", "tasks");
  await git(t.repo.root, "tag", "refapp-v1-rc1");
  const manifest = join(t.env.privateRoot, "qualify-manifest.json");
  await Deno.writeTextFile(
    manifest,
    JSON.stringify({
      v: 1,
      refapp_version: "refapp-v1",
      tasks: {
        "HX-001": { rev: "refapp-v1-rc1", positive: "correct", naive: ["a"] },
      },
    }),
  );
  const index = await harnessQualify(
    { ...cellOpts(t, { supervised: false }), manifest },
    opener(t),
  );
  const saved = JSON.parse(await Deno.readTextFile(index.path));
  assertEquals(saved, index.data);
  const bytes = await Deno.readFile(manifest);
  const sha = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ).map((b) => b.toString(16).padStart(2, "0")).join("");
  assertEquals(
    index.path,
    join(t.env.resultsRoot, "qualify", sha, "index.json"),
  );
  const rows = saved.entries.map((
    e: {
      task: string;
      variant: string;
      verdict: string;
      expected: string;
      mock_cell: { verdict: string };
    },
  ) => [e.task, e.variant, e.verdict, e.expected, e.mock_cell.verdict]);
  assertEquals(rows, [
    ["HX-001", "correct", "pass", "pass", "pass"],
    ["HX-001", "naive/a", "fail", "fail", "fail"],
  ]);
  const naive = saved.entries[1];
  assertStringIncludes(naive.reasons.join(" "), "FixWorks");
  assertEquals(naive.targets, ["candidate"]);
  for (const e of saved.entries) {
    const j = JSON.parse(
      await Deno.readTextFile(join(t.repo.root, e.judgment_path)),
    );
    const p = JSON.parse(
      await Deno.readTextFile(join(t.repo.root, e.provenance_path)),
    );
    assertEquals([j.verdict, p.rev, p.variant], [
      e.verdict,
      "refapp-v1-rc1",
      e.variant,
    ]);
  }
});

/**
 * H-35: a judgment as a pre-H-35 harness wrote it: v1, a suite that really
 * shipped (default the H-30 one), no policy, provenance or scorer state, no
 * agent_tests, the v1 verdict.
 */
async function asLegacy(
  j: JudgmentRecord,
  versions: Record<string, string> = {
    build: "3",
    pass_to_pass: "5",
    fail_to_pass: "3",
    mutant_kill: "5",
  },
): Promise<JudgmentRecord> {
  const { policy: _p, provenance: _q, ...rest } = j;
  const scorers = j.scorers.filter((s) => s.name !== "agent_tests").map((
    { state: _s, ...s },
  ) => s);
  return {
    ...rest,
    v: 1,
    scorers,
    verdict: verdictOf(scorers),
    scorer_versions: versions,
    scorer_fingerprint: await scorerFingerprint(versions),
  };
}

async function staleJudgment(t: TestEnv, executionId: string) {
  const [j] = await t.env.store.judgments(executionId);
  await t.env.store.writeJudgment({
    ...await asLegacy(j!),
    id: crypto.randomUUID(),
    // Newer than the original judgment, older than any rejudge that follows.
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  });
}

async function campaignWithStaleJudgment(t: TestEnv) {
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await mockExperiment(t);
  await runCampaign(t.env, "contract", {
    dryRun: false,
    concurrency: 1,
    maxPauseMs: 0,
  }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const es = await t.env.store.executions(c.id);
  await staleJudgment(t, es[0]!.id);
  return { c, es };
}

Deno.test("rejudge adds one judgment per execution whose scorer fingerprint is not current, and none on a second call", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { es } = await campaignWithStaleJudgment(t);
  const count = async () =>
    (await Promise.all(es.map((e) => t.env.store.judgments(e.id)))).map((
      js,
    ) => js.length);
  assertEquals(await count(), [2, 1]);
  const first = await harnessRejudge("contract", runOpts(t), opener(t));
  assertEquals(first.rejudged, 1);
  assertEquals(await count(), [3, 1]);
  const again = await harnessRejudge("contract", runOpts(t), opener(t));
  assertEquals([again.rejudged, await count()], [0, [3, 1]]);
});

/**
 * n newer, non-forced, infra-unscored copies of the execution's first
 * judgment; the first `old` of them (the oldest) under a stale scorer suite.
 */
async function unscoredJudgments(
  t: TestEnv,
  executionId: string,
  n: number,
  old = 0,
) {
  const [j] = await t.env.store.judgments(executionId);
  for (let i = 0; i < n; i++) {
    const at = new Date(Date.now() + i).toISOString();
    // The oldest `old` under a legacy suite (H-35: as a pre-H-35 harness
    // wrote them), the rest under the current one.
    const base = i < old ? await asLegacy(j!) : j!;
    await t.env.store.writeJudgment({
      ...base,
      id: crypto.randomUUID(),
      // A v2 judgment's unscored scorer carries its state (H-35 S2.1).
      scorers: base.scorers.map((s) => ({
        ...s,
        passed: null,
        ...(s.state ? { state: "unscored" as const } : {}),
      })),
      verdict: "unscored",
      started_at: at,
      ended_at: at,
    });
  }
}

Deno.test("rejudge (H-04b b): unscored judgments count toward the budget only under the current scorer suite", async () => {
  // [unscored judgments, of them under an old suite, executions due]
  for (const [n, old, due] of [[3, 3, 1], [3, 1, 1]] as const) {
    await using t = await makeEnv();
    await writeCatalog(t);
    t.env.supervised = false;
    t.docker.behavior = mockImageBehavior();
    await mockExperiment(t);
    await runCampaign(t.env, "contract", {
      dryRun: false,
      concurrency: 1,
      maxPauseMs: 0,
    }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
    const c = (await t.env.store.campaigns("contract"))[0]!;
    const es = await t.env.store.executions(c.id);
    assertEquals(
      (await t.env.store.judgments(es[0]!.id))[0]!.scorer_fingerprint,
      await currentScorerFingerprint(),
    );
    await unscoredJudgments(t, es[0]!.id, n, old);
    const r = await harnessRejudge("contract", runOpts(t), opener(t));
    assertEquals(r.rejudged, due, `${n} unscored, ${old} old`);
  }
});

Deno.test("rejudge --force (H-04b run 003): after a --rerun of a budget-terminal cell, --force admits the rerun the report counts and refuses the planned execution", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await mockExperiment(t);
  const run = (extra: Record<string, unknown> = {}) =>
    runCampaign(t.env, "contract", {
      dryRun: false,
      concurrency: 1,
      maxPauseMs: 0,
      ...extra,
    }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
  await run();
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const p = (await t.env.store.executions(c.id))[0]!;
  await unscoredJudgments(t, p.id, 3);
  const block = c.blocks[p.block]!;
  await run({
    rerun: { task: block.task_id, repeat: block.repeat, arm: p.arm },
  });
  const m = (await t.env.store.executions(c.id)).find((x) =>
    x.run_kind === "manual_rerun"
  )!;
  // The rerun's verdict hit infra too: it is pending, so the cell counts it
  // only when the planned one is budget-terminal (current scorer passed).
  await unscoredJudgments(t, m.id, 1);
  const force = (e: string, replaces: string) =>
    approved(e, (basis) =>
      harnessRejudge(
        "contract",
        runOpts(t, {
          campaign: c.id,
          execution: e,
          force: true,
          reason: OOM_REASON,
          replaces,
          basis,
        }),
        opener(t),
      ));
  const latest = async (e: string) =>
    (await t.env.store.judgments(e)).sort((a, b) =>
      a.ended_at.localeCompare(b.ended_at)
    ).at(-1)!.id;
  await assertRejects(
    async () => await force(p.id, await latest(p.id)),
    ConfigurationError,
    `execution ${p.id} is not the one its cell counts (${m.id})`,
  );
  assertEquals(
    (await force(m.id, await latest(m.id))).rejudged,
    1,
  );
});

Deno.test("harnessReport (H-04b b): a cell is terminal on the budget only under the current scorer suite", async () => {
  for (const current of [true, false]) {
    const dir = await testTempDir();
    const store = new RecordStore(dir);
    // H-35 S2.5: a v2 judgment's task preimage is stored (the report checks).
    const c = await campaign({
      oracles: { "HX-001": await storeDescriptor(dir, "HX-001", ["build"]) },
    });
    await store.writeCampaign(c);
    const e = execution(c);
    await store.writeExecution(e);
    // Under the current suite a judgment is v2 (H-35 S2.1).
    const suite = current
      ? {
        v: 2 as const,
        scorer_versions: SCORER_SUITE,
        scorer_fingerprint: await currentScorerFingerprint(),
        // H-35 S2.5: the effective set of a change task under this suite.
        scorers: ["build", "agent_tests"].map((name) => ({
          name,
          passed: null,
          state: "unscored" as const,
          tests: [],
        })),
        policy: { passed: true, violations: [] },
        provenance: {
          harness_commit: null,
          production_manifest: null,
          env_fp: null,
        },
      }
      : {};
    for (let i = 0; i < 3; i++) {
      await store.writeJudgment(judgment(c, e, null, suite));
    }
    const r = await harnessReport("skills-vs-plain", {
      resultsDir: dir,
      ...OPTS,
    });
    const cell = r.cells.find((x) => x.used_execution === e.id)!;
    assertEquals(
      [cell.status, cell.reason],
      current
        ? ["unscored", "verdict infra: rejudge budget 3 exhausted"]
        : ["pending", undefined],
    );
  }
});

Deno.test("rejudge (H-04b): an execution with 2 non-forced unscored judgments is due; with 3 it hit the rejudge budget and is not", async () => {
  for (const [n, due] of [[2, 1], [3, 0]] as const) {
    await using t = await makeEnv();
    await writeCatalog(t);
    t.env.supervised = false;
    t.docker.behavior = mockImageBehavior();
    await mockExperiment(t);
    await runCampaign(t.env, "contract", {
      dryRun: false,
      concurrency: 1,
      maxPauseMs: 0,
    }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
    const c = (await t.env.store.campaigns("contract"))[0]!;
    const es = await t.env.store.executions(c.id);
    await unscoredJudgments(t, es[0]!.id, n);
    const r = await harnessRejudge("contract", runOpts(t), opener(t));
    assertEquals(r.rejudged, due, `${n} unscored judgments`);
  }
});

/** A two-cell mock campaign, judged, with the frozen analysis files in the harness root. */
async function measurableCampaign() {
  const t = await makeEnv();
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await mockExperiment(t);
  await runCampaign(t.env, "contract", {
    dryRun: false,
    concurrency: 1,
    maxPauseMs: 0,
  }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const es = await t.env.store.executions(c.id);
  assertEquals(es.length, 2);
  const repoAnalysis = new URL(
    "../../../../harness/analysis/",
    import.meta.url,
  );
  for (
    const rel of [
      "final-code.ruleset.json",
      "canary/app.json",
      "canary/expect.json",
      "canary/src/Canary.Codeunit.al",
      "canary/src/Canary.Page.al",
    ]
  ) {
    const dst = join(t.env.harnessRoot, "analysis", rel);
    await Deno.mkdir(join(dst, ".."), { recursive: true });
    await Deno.copyFile(new URL(rel, repoAnalysis), dst);
  }
  const judgmentOf = async (id: string) =>
    (await t.env.store.judgments(id))[0]!;
  const records = async (judgment: string) => {
    const out: string[] = [];
    try {
      for await (
        const e of Deno.readDir(join(t.env.resultsRoot, "measures", judgment))
      ) out.push(e.name);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    return out;
  };
  return { t, es, judgmentOf, records };
}

Deno.test("measure (M11-07 run 002): refused when a task's visible inputs drifted from the execution's", async () => {
  const { t, es, judgmentOf, records } = await measurableCampaign();
  await Deno.writeTextFile(
    join(t.repo.tasksDir, "HX-001", "prompt.md"),
    "An edited prompt.",
  );
  await assertRejects(
    () => harnessMeasure("contract", runOpts(t, { yes: true }), opener(t)),
    ConfigurationError,
    "visible",
  );
  for (const e of es) {
    assertEquals(await records((await judgmentOf(e.id)).id), []);
  }
});

Deno.test("measure (M11-07 run 002): refused when the current oracle (measures/ included) differs from the judgment's", async () => {
  const { t, es, judgmentOf, records } = await measurableCampaign();
  // A measures file added after the campaign changes the oracle hash.
  await Deno.mkdir(join(t.repo.tasksDir, "HX-001", "measures"));
  await Deno.writeTextFile(
    join(t.repo.tasksDir, "HX-001", "measures", "measures.yml"),
    "v: 1\n",
  );
  await assertRejects(
    () => harnessMeasure("contract", runOpts(t, { yes: true }), opener(t)),
    ConfigurationError,
    "oracle",
  );
  for (const e of es) {
    assertEquals(await records((await judgmentOf(e.id)).id), []);
  }
});

Deno.test("measure (M11-07 run 002): a canary infra error leaves final code missing in every cell, and the other measures proceed", async () => {
  const { t, es, judgmentOf } = await measurableCampaign();
  for (const c of t.env.lane.containers) t.bc.broken.add(c);
  const r = await harnessMeasure(
    "contract",
    runOpts(t, { yes: true }),
    opener(t),
  );
  assertEquals(r.measured, 2);
  for (const e of es) {
    const j = await judgmentOf(e.id);
    const rec = await readMeasureRecord(
      t.env.resultsRoot,
      j.id,
      await measureFingerprint(),
    );
    assertEquals(rec!.final_code.status, "missing");
    assertStringIncludes(
      rec!.final_code.status === "missing" ? rec!.final_code.reason : "",
      "infra",
    );
    assertEquals(rec!.analyzers, null);
    // Independent of the analyzers: partial credit and reuse still recorded.
    assertEquals(rec!.partial_credit.status, "not_applicable");
    assertEquals(rec!.reuse.status, "not_applicable");
  }
});

Deno.test("measure (M11-07): two scored cells, one already measured under the current fingerprint: one new record", async () => {
  const { t, es } = await measurableCampaign();
  const [j0] = await t.env.store.judgments(es[0]!.id);
  const [j1] = await t.env.store.judgments(es[1]!.id);
  const art = await t.env.store.artifact(es[0]!.id);
  await writeMeasureRecord(t.env.resultsRoot, {
    v: 1,
    judgment_id: j0!.id,
    execution_id: es[0]!.id,
    task_id: es[0]!.task_id,
    workspace_hash: art!.workspace_hash,
    oracle_hash: j0!.task_oracle_hash,
    measure_fingerprint: await measureFingerprint(),
    analyzers: null,
    final_code: { status: "missing", reason: "already measured" },
    reuse: { status: "not_applicable", reason: "no measures file" },
    partial_credit: { status: "not_applicable", reason: "no frozen weights" },
  });
  const files = async (judgment: string) => {
    const out: string[] = [];
    try {
      for await (
        const e of Deno.readDir(
          join(t.env.resultsRoot, "measures", judgment),
        )
      ) out.push(e.name);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    return out;
  };
  assertEquals((await files(j1!.id)).length, 0);
  const r = await harnessMeasure(
    "contract",
    runOpts(t, { yes: true }),
    opener(t),
  );
  assertEquals(r.measured, 1);
  assertEquals(await files(j1!.id), [`${await measureFingerprint()}.json`]);
  assertEquals((await files(j0!.id)).length, 1);
  // Everything measured: a second call measures nothing.
  assertEquals(
    (await harnessMeasure("contract", runOpts(t, { yes: true }), opener(t)))
      .measured,
    0,
  );
});

Deno.test("rejudge (M4-17a): a judgment from before the mutant_kill 3 bump is rejudged with the current suite on the original artifact, task and oracle", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await mockExperiment(t);
  await runCampaign(t.env, "contract", {
    dryRun: false,
    concurrency: 1,
    maxPauseMs: 0,
  }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const e = (await t.env.store.executions(c.id))[0]!;
  const [orig] = await t.env.store.judgments(e.id);
  // The suite as recorded before M4-17a (the second suite that shipped).
  await t.env.store.writeJudgment({
    ...await asLegacy(orig!, {
      build: "1",
      pass_to_pass: "1",
      fail_to_pass: "1",
      mutant_kill: "2",
    }),
    id: crypto.randomUUID(),
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  });
  assertEquals(
    (await harnessRejudge("contract", runOpts(t), opener(t))).rejudged,
    1,
  );
  const js = await t.env.store.judgments(e.id);
  const latest = js.reduce((a, b) => a.started_at >= b.started_at ? a : b);
  assertEquals(latest.scorer_versions, SCORER_SUITE);
  // 5 since H-30 (helper merge, shipped wins); 6 since H-35 (helper as written).
  assertEquals(latest.scorer_versions["mutant_kill"], "6");
  assertEquals(latest.scorer_fingerprint, await currentScorerFingerprint());
  assertEquals(
    [
      latest.execution_id,
      latest.workspace_hash,
      latest.task_id,
      latest.task_oracle_hash,
    ],
    [
      e.id,
      (await t.env.store.artifact(e.id))!.workspace_hash,
      orig!.task_id,
      orig!.task_oracle_hash,
    ],
  );
  assertEquals(latest.workspace_hash, orig!.workspace_hash);
});

Deno.test("rejudge refuses when the restaged visible inputs differ", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { es } = await campaignWithStaleJudgment(t);
  await Deno.writeTextFile(
    join(t.repo.tasksDir, "HX-001", "prompt.md"),
    "An edited prompt.",
  );
  await assertRejects(
    () => harnessRejudge("contract", runOpts(t), opener(t)),
    ConfigurationError,
    "visible",
  );
  assertEquals((await t.env.store.judgments(es[0]!.id)).length, 2);
});

Deno.test("rejudge asks for confirmation unless --yes", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { es } = await campaignWithStaleJudgment(t);
  const asked: string[] = [];
  const no = (q: string) => {
    asked.push(q);
    return false;
  };
  const r = await harnessRejudge(
    "contract",
    runOpts(t, { yes: false }),
    opener(t),
    no,
  );
  assertEquals([r.rejudged, asked.length], [0, 1]);
  assertStringIncludes(asked[0]!, "current oracle");
  assertEquals((await t.env.store.judgments(es[0]!.id)).length, 2);
  const yes = await harnessRejudge(
    "contract",
    runOpts(t, { yes: true }),
    opener(t),
    () => {
      throw new Error("--yes must not ask");
    },
  );
  assertEquals(yes.rejudged, 1);
});

Deno.test("images build lists the resulting digest and labels", async () => {
  const root = await Deno.realPath(await testTempDir());
  const docker = new FakeDocker();
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1"]);
  // H-01 run 005: mock:2 (mock:1 is frozen and never built).
  docker.buildResults.set("centralgauge/harness-mock:2", {
    id: `sha256:${"c".repeat(64)}`,
    labels: {
      "centralgauge.harness": "mock",
      "centralgauge.harness.version": "2",
      "centralgauge.harness.base_digest": baseId,
    },
    layers: ["l1", "l2"],
  });
  const lines: string[] = [];
  const log = stub(console, "log", (...a: unknown[]) => {
    lines.push(a.join(" "));
  });
  try {
    await harnessImagesBuild("mock", { root, version: "2" }, docker);
  } finally {
    log.restore();
  }
  const out = stripAnsiCode(lines.join("\n"));
  assertStringIncludes(out, `sha256:${"c".repeat(64)}`);
  assertStringIncludes(out, "centralgauge.harness=mock");
  assertStringIncludes(out, "centralgauge.harness.version=2");
  assertStringIncludes(out, `centralgauge.harness.base_digest=${baseId}`);
});

Deno.test("rejudge: an oracle-only change makes every judged execution due, judged against the new oracle", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await mockExperiment(t);
  await runCampaign(t.env, "contract", {
    dryRun: false,
    concurrency: 1,
    maxPauseMs: 0,
  }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const es = await t.env.store.executions(c.id);
  assertEquals(
    (await harnessRejudge("contract", runOpts(t), opener(t))).rejudged,
    0,
    "current scorers and oracle: nothing due",
  );
  const oracle = join(
    t.repo.tasksDir,
    "HX-001",
    "oracle",
    "src",
    "Oracle.Test.al",
  );
  await Deno.writeTextFile(
    oracle,
    (await Deno.readTextFile(oracle)) + "// oracle fix\n",
  );
  const r = await harnessRejudge("contract", runOpts(t), opener(t));
  assertEquals(r.rejudged, 2);
  const now = await oracleHash(
    await loadTask(join(t.repo.tasksDir, "HX-001")),
  );
  for (const e of es) {
    const js = await t.env.store.judgments(e.id);
    assertEquals(js.length, 2);
    assert(js.some((j) => j.task_oracle_hash === now), e.id);
  }
  assertEquals(
    (await harnessRejudge("contract", runOpts(t), opener(t))).rejudged,
    0,
  );
});

Deno.test("harnessReport: efficiency and slices read the store's published host and verdict logs", async () => {
  const dir = await storeWithOneCell();
  const store = new RecordStore(dir);
  const c = (await store.campaigns("skills-vs-plain"))[0]!;
  const [e] = await store.executions(c.id);
  const [j] = await store.judgments(e!.id);
  await write(
    dir,
    `runs/${e!.id}/host-log.jsonl`,
    JSON.stringify({
      v: 1,
      request: crypto.randomUUID(),
      execution: e!.id,
      op: "compile",
      status: 200,
      outcome: "ok",
      at: "2026-10-01T10:00:00.000Z",
      spans: {},
      apps_compiled: ["Core"],
      per_app_compiles: 1,
      diagnostics: 0,
      tests_run: 0,
      tests_failed: 0,
      container: "C1",
      retries: 0,
    }) + "\n",
  );
  await write(
    dir,
    `verdicts/${j!.id}.json`,
    JSON.stringify({ spans: { total_ms: 42, queue_ms: 7 } }),
  );
  const r = await harnessReport("skills-vs-plain", {
    resultsDir: dir,
    ...OPTS,
  });
  const eff = r.efficiency.find((x) => x.arm === e!.arm)!;
  assertEquals(
    [eff.backend_requests, eff.logical_builds, eff.verdict_ms_median],
    [1, 1, 42],
  );
  assert(r.slices.length > 0);
});

Deno.test("openHarnessEnv: the lane comes from CG_LANE, never a placeholder", async () => {
  await using t = await makeEnv();
  const prev = Deno.env.get("CG_LANE");
  try {
    Deno.env.set("CG_LANE", "lane-ops");
    const h = await openHarnessEnv(envOpts(t), deps([]));
    assertEquals(h.env.lane_id, "lane-ops");
    await h.close();
    Deno.env.delete("CG_LANE");
    const u = await openHarnessEnv(envOpts(t), deps([]));
    assertEquals(u.env.lane_id, "", "unset: the reservation refuses it");
    await u.close();
  } finally {
    if (prev === undefined) Deno.env.delete("CG_LANE");
    else Deno.env.set("CG_LANE", prev);
  }
});

// M2-08: stub-provider cells from the CLI.

/** An opener that honours the command's records root (the stub cell picks <results>/stub-cells). */
const rootedOpener = (t: TestEnv) => (o: { resultsDir: string }) =>
  Promise.resolve({
    env: {
      ...t.env,
      resultsRoot: o.resultsDir,
      store: new RecordStore(o.resultsDir),
    },
    close: () => Promise.resolve(),
  });

async function scenarioFile(t: TestEnv): Promise<string> {
  const p = join(t.env.privateRoot, "scenario.json");
  await Deno.writeTextFile(p, JSON.stringify({ steps: [] }));
  return p;
}

Deno.test("harnessCell: --image is refused without --stub-provider", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  await assertRejects(
    () =>
      harnessCell(
        "cc-sonnet-plain",
        "HX-001",
        cellOpts(t, { image: `sha256:${"d".repeat(64)}` }),
        opener(t),
        () => true,
        noInterrupt,
      ),
    ConfigurationError,
    "--stub-provider",
  );
  assertEquals(t.docker.runs, []);
});

Deno.test("harnessCell: a stub cell needs no supervision, records under <results>/stub-cells, is never judged", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const results = join(t.repo.root, "results", "harness");
  const mounted: string[] = [];
  const inner = t.docker.behavior;
  t.docker.behavior = async (call, io) => {
    const dir = call.mounts.get("C:\\cg-stub")!.src;
    mounted.push(
      await Deno.readTextFile(join(dir, "scenario.json")),
      String((await Deno.stat(join(dir, "stub-anthropic.mjs"))).isFile),
    );
    return await inner(call, io);
  };
  const r = await harnessCell(
    "cc-sonnet-plain",
    "HX-001",
    cellOpts(t, {
      resultsDir: results,
      supervised: false,
      stubProvider: await scenarioFile(t),
    }),
    rootedOpener(t),
    () => false,
    noInterrupt,
  );
  const e = r.executions[0]!;
  const store = new RecordStore(join(results, "stub-cells"));
  assertEquals((await store.executions(e.campaign_id)).length, 1);
  assertEquals(await store.judgments(e.id), []);
  const call = t.docker.runs.at(-1)!;
  assertEquals(call.env.get("ANTHROPIC_BASE_URL"), "http://127.0.0.1:3400");
  assertEquals(mounted, [JSON.stringify({ steps: [] }), "true"]);
  // The stub dir is removed after the cell; the attempt persisted its mode.
  const gone = await Deno.stat(call.mounts.get("C:\\cg-stub")!.src).then(
    () => false,
    () => true,
  );
  assertEquals(gone, true);
});

Deno.test("harnessCell: a malformed stub scenario is refused before anything runs", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const bad = join(t.env.privateRoot, "bad.json");
  await Deno.writeTextFile(bad, JSON.stringify({ steps: "no" }));
  await assertRejects(
    () =>
      harnessCell(
        "cc-sonnet-plain",
        "HX-001",
        cellOpts(t, {
          resultsDir: join(t.repo.root, "results", "harness"),
          stubProvider: bad,
        }),
        rootedOpener(t),
        () => true,
        noInterrupt,
      ),
    ConfigurationError,
    "scenario",
  );
  assertEquals(t.docker.runs, []);
});

// M1-33: egress mode, backend placement and `harness egress verify`.

Deno.test("egressMode: qualified places, authorized enforces; an unknown or unreadable marker stops", async () => {
  const root = await Deno.realPath(await testTempDir());
  const ok = () => Promise.resolve([]);
  const mark = (v: unknown) =>
    Deno.writeTextFile(join(root, EGRESS_MARKER), JSON.stringify(v));
  assertEquals(await egressMode(root, ok), "off");
  await mark({ v: 1, state: "candidate" });
  assertEquals(await egressMode(root, ok), "off");
  await mark({ v: 1, state: "qualified" });
  assertEquals(await egressMode(root, ok), "placed");
  let seen = "";
  await egressMode(root, (p) => {
    seen = p;
    return ok();
  });
  assertEquals(seen, join(root, EGRESS_MARKER));
  // Review item 3: a bare authorized marker is not authorized (the complete one: see below).
  await mark({ v: 1, state: "authorized" });
  await assertRejects(
    () => egressMode(root, ok),
    ConfigurationError,
    "not authorized",
  );
  await mark({ v: 1, state: "authorised" });
  await assertRejects(
    () => egressMode(root, ok),
    ConfigurationError,
    "authorised",
  );
  await Deno.writeTextFile(join(root, EGRESS_MARKER), "{");
  await assertRejects(
    () => egressMode(root, ok),
    ConfigurationError,
    EGRESS_MARKER,
  );
});

Deno.test("backendAddress: placed sandboxes reach the backend on the gateway only", async () => {
  const nat = () => Promise.resolve("172.20.0.1");
  assertEquals(
    await backendAddress("off", { backendPort: 3210 }, nat),
    { host: "172.20.0.1", port: 3210 },
  );
  for (const mode of ["placed", "enforced"] as const) {
    assertEquals(
      await backendAddress(mode, { backendPort: 3210 }, nat),
      { host: SANDBOX_NETWORK.gateway, port: 3210 },
    );
    await assertRejects(
      () =>
        backendAddress(
          mode,
          { backendHost: "0.0.0.0", backendPort: 3210 },
          nat,
        ),
      ConfigurationError,
      "0.0.0.0",
    );
    await assertRejects(
      () => backendAddress(mode, { backendPort: 3211 }, nat),
      ConfigurationError,
      "3211",
    );
  }
});

function egressState(): EgressState {
  return {
    network: {
      id: "net9",
      driver: "internal",
      subnet: SANDBOX_NETWORK.subnet,
      gateway: SANDBOX_NETWORK.gateway,
      hnsId: "hns9",
      networkName: "x",
    },
    hns: {
      id: "hns9",
      name: "x",
      type: "Internal",
      subnet: SANDBOX_NETWORK.subnet,
    },
    gatewayAdapter: { index: 42, alias: "vEthernet (x)", prefix: 24 },
    profiles: ["Domain", "Private", "Public"].map((name) => ({
      name,
      enabled: true,
      inbound: "Allow",
      outbound: "Allow",
    })),
    groupRules: firewallPlan(42),
    foreignBlockRules: [],
    marker: null,
  };
}

/** A collector over egressState() that reads the marker file like the real one. */
function markerAwareCollector(mutate: (s: EgressState) => void = () => {}) {
  return async (markerPath: string): Promise<EgressState> => {
    const s = egressState();
    mutate(s);
    try {
      const m = JSON.parse(await Deno.readTextFile(markerPath));
      s.marker = {
        state: m.state,
        networkId: m.network_id,
        interfaceIndex: m.interface_index,
      };
    } catch { /* no marker */ }
    return s;
  };
}

Deno.test("harness egress verify: problems fail; without --mark the marker is part of the verification", async () => {
  const root = await Deno.realPath(await testTempDir());
  const marker = join(root, "results", "harness", EGRESS_MARKER);
  const p = await harnessEgressVerify(
    { root, mark: "candidate" },
    markerAwareCollector((s) => (s.foreignBlockRules = ["x"])),
  );
  assertStringIncludes(p.join("\n"), "foreign block");
  await assertRejects(() => Deno.stat(marker), Deno.errors.NotFound);
  assertEquals(
    await harnessEgressVerify(
      { root, mark: "candidate" },
      markerAwareCollector(),
    ),
    [],
  );
  assertStringIncludes(
    (await harnessEgressVerify(
      { root },
      markerAwareCollector((s) => (s.network!.id = "net10")),
    )).join("\n"),
    "recreated",
  );
});

Deno.test("harness egress verify --mark: ordered states, no skip, no downgrade, no overwrite", async () => {
  const root = await Deno.realPath(await testTempDir());
  const c = markerAwareCollector();
  const refused = async (
    o: Parameters<typeof harnessEgressVerify>[0],
    word: string,
  ) => assertStringIncludes((await harnessEgressVerify(o, c)).join("\n"), word);
  await refused({ root, mark: "qualified" }, "candidate first");
  await refused({ root, mark: "authorized" }, "candidate first");
  assertEquals(await harnessEgressVerify({ root, mark: "candidate" }, c), []);
  await refused({ root, mark: "candidate" }, "already candidate");
  await refused({ root, mark: "authorized" }, "qualified first");
});

Deno.test("harness egress verify --mark (M1-33d review): the marker carries proxy_isolation = PROXY_ISOLATION", async () => {
  const root = await Deno.realPath(await testTempDir());
  assertEquals(
    await harnessEgressVerify(
      { root, mark: "candidate" },
      markerAwareCollector(),
    ),
    [],
  );
  const m = JSON.parse(
    await Deno.readTextFile(join(root, "results", "harness", EGRESS_MARKER)),
  );
  assertEquals(m.proxy_isolation, PROXY_ISOLATION);
});

async function probeEvidence(
  root: string,
  over: Record<string, unknown> = {},
  lines = Object.entries(preflightExpect(["api.anthropic.com"])).map((
    [probe, ok],
  ) => ({ probe, ok })),
): Promise<string> {
  const path = join(root, `probe-${crypto.randomUUID()}.json`);
  await Deno.writeTextFile(
    path,
    JSON.stringify({
      v: 1,
      at: new Date().toISOString(),
      network_id: "net9",
      interface_index: 42,
      hosts: ["api.anthropic.com"],
      lines,
      ...over,
    }),
  );
  return path;
}

Deno.test("harness egress verify --mark qualified: needs passing in-sandbox probe evidence for the current network", async () => {
  const root = await Deno.realPath(await testTempDir());
  const c = markerAwareCollector();
  assertEquals(await harnessEgressVerify({ root, mark: "candidate" }, c), []);
  const q = (probe?: string) =>
    harnessEgressVerify({
      root,
      mark: "qualified",
      ...(probe ? { probeEvidence: probe } : {}),
    }, c);
  assertStringIncludes((await q()).join("\n"), "probe evidence");
  assertStringIncludes(
    (await q(await probeEvidence(root, { network_id: "net8" }))).join("\n"),
    "network",
  );
  assertStringIncludes(
    (await q(
      await probeEvidence(
        root,
        {},
        Object.entries(preflightExpect(["api.anthropic.com"])).map((
          [probe, ok],
        ) => ({ probe, ok: probe === "gw-smb-445" ? true : ok })),
      ),
    )).join("\n"),
    "gw-smb-445",
  );
  assertStringIncludes(
    (await q(await probeEvidence(root, { hosts: [] }))).join("\n"),
    "api.anthropic.com",
  );
  assertEquals(await q(await probeEvidence(root)), []);
  const m = JSON.parse(
    await Deno.readTextFile(join(root, "results", "harness", EGRESS_MARKER)),
  );
  assertEquals([m.state, m.network_id, m.interface_index], [
    "qualified",
    "net9",
    42,
  ]);
  assertStringIncludes(
    (await harnessEgressVerify({ root, mark: "candidate" }, c)).join("\n"),
    "downgrade",
  );
});

Deno.test("harness egress verify --mark authorized: needs recorded rotation, recorded OAuth hosts and a later enforced supervised Claude cell", async () => {
  const root = await Deno.realPath(await testTempDir());
  const c = markerAwareCollector();
  assertEquals(await harnessEgressVerify({ root, mark: "candidate" }, c), []);
  assertEquals(
    await harnessEgressVerify({
      root,
      mark: "qualified",
      probeEvidence: await probeEvidence(root),
    }, c),
    [],
  );
  const past = (min: number) =>
    new Date(Date.now() + min * 60_000).toISOString();
  const rotation = join(root, "rotation.json");
  const writeRotation = (names: string[], at = past(1)) =>
    Deno.writeTextFile(
      rotation,
      JSON.stringify({
        v: 1,
        credentials: names.map((name) => ({
          name,
          revoked_at: at,
          created_at: at,
        })),
      }),
    );
  const cells = join(root, "results", "harness", "cells");
  const writeCell = async (
    id: string,
    o: {
      harness?: string;
      termination?: string;
      started?: string;
      log?: string;
    },
  ) => {
    await Deno.mkdir(join(cells, "executions", "camp1"), { recursive: true });
    await Deno.writeTextFile(
      join(cells, "executions", "camp1", `${id}.json`),
      JSON.stringify({
        id,
        manifest: {
          harness: o.harness ?? "claude-code",
          provider_routes: { main: "anthropic:first-party-oauth" },
        },
        termination: o.termination ?? "completed",
        started_at: o.started ?? past(2),
      }),
    );
    await Deno.mkdir(join(cells, "runs", id), { recursive: true });
    await Deno.writeTextFile(
      join(cells, "runs", id, "record-mode.json"),
      JSON.stringify({
        v: 1,
        execution_id: id,
        record_mode: true,
        supervised: true,
        credential_bearing: true,
        harness: o.harness ?? "claude-code",
        termination: o.termination ?? "completed",
      }),
    );
    if (o.log !== undefined) {
      await Deno.writeTextFile(join(cells, "runs", id, "egress.jsonl"), o.log);
    }
  };
  // M1-34e: the record-mode preflight's own lines, then agent traffic.
  const allow = jsonl(tagged());
  const deny = jsonl([{
    at: "2026-09-27T08:35:00.000Z",
    decision: "deny",
    target: "evil.test:443",
    reason: "host not allowed",
    phase: "agent",
  }]);
  const a = (o: { rotation?: string; cell?: string; evidence?: string }) =>
    harnessEgressVerify({ root, mark: "authorized", ...o }, c);
  const full = { rotation, cell: "cell-ok", evidence: "M1-34/001" };
  await writeCell("cell-ok", { log: allow });
  await writeRotation(["claude-oauth", "openrouter"]);
  const { rotation: _r, ...noRotation } = full;
  assertStringIncludes((await a(noRotation)).join("\n"), "rotation");
  assertStringIncludes(
    (await a({ ...full, evidence: "" })).join("\n"),
    "evidence",
  );
  // Step 11 records the OAuth hosts before authorization.
  assertStringIncludes((await a(full)).join("\n"), RECORDED_HOSTS_PATH);
  await Deno.mkdir(join(root, "harness", "egress"), { recursive: true });
  await Deno.writeTextFile(
    join(root, ...RECORDED_HOSTS_PATH.split("/")),
    JSON.stringify({
      v: 1,
      source: "record mode execution cell-ok",
      routes: { "anthropic:first-party-oauth": ["oauth.example.test"] },
    }),
  );
  await writeRotation(["claude-oauth"]);
  assertStringIncludes((await a(full)).join("\n"), "openrouter");
  await writeRotation(["claude-oauth", "openrouter"], past(3));
  assertStringIncludes((await a(full)).join("\n"), "after the rotation");
  await writeRotation(["claude-oauth", "openrouter"]);
  assertStringIncludes((await a({ ...full, cell: "nope" })).join("\n"), "nope");
  await writeCell("cell-pi", { harness: "pi", log: allow });
  assertStringIncludes(
    (await a({ ...full, cell: "cell-pi" })).join("\n"),
    "claude-code",
  );
  await writeCell("cell-deny", { log: allow + deny });
  assertStringIncludes(
    (await a({ ...full, cell: "cell-deny" })).join("\n"),
    "deny",
  );
  await writeCell("cell-nolog", {});
  assertStringIncludes(
    (await a({ ...full, cell: "cell-nolog" })).join("\n"),
    "egress.jsonl",
  );
  await writeCell("cell-crash", { termination: "harness_crash", log: allow });
  assertStringIncludes(
    (await a({ ...full, cell: "cell-crash" })).join("\n"),
    "completed",
  );
  await writeCell("cell-early", { started: past(-60), log: allow });
  assertStringIncludes(
    (await a({ ...full, cell: "cell-early" })).join("\n"),
    "qualified",
  );
  assertEquals(await a(full), []);
  const m = JSON.parse(
    await Deno.readTextFile(join(root, "results", "harness", EGRESS_MARKER)),
  );
  assertEquals(
    [
      m.state,
      m.evidence,
      m.network,
      m.network_id,
      m.interface_index,
      m.proxy_allowlist,
    ],
    ["authorized", "M1-34/001", SANDBOX_NETWORK.name, "net9", 42, [
      "api.anthropic.com",
      "oauth.example.test",
      "openrouter.ai",
    ]],
  );
  assert(typeof m.verified_at === "string");
  assertStringIncludes((await a(full)).join("\n"), "already authorized");
  assertStringIncludes(
    (await harnessEgressVerify({
      root,
      mark: "qualified",
      probeEvidence: await probeEvidence(root),
    }, c)).join("\n"),
    "downgrade",
  );
});

// Review item 1: the qualification bootstrap runs in the candidate state.

Deno.test("qualification bootstrap: a candidate marker places the probe only; the probe's evidence allows marking qualified; nothing is released before it passes", async () => {
  for (const passing of [true, false]) {
    await using t = await makeEnv();
    const root = t.env.privateRoot; // any fresh dir works as the repo root here
    const shared = join(root, "results", "harness");
    const markerPath = join(shared, EGRESS_MARKER);
    const collect = markerAwareCollector();
    assertEquals(
      await harnessEgressVerify({ root, mark: "candidate" }, collect),
      [],
    );
    const ok = () => Promise.resolve([]);
    assertEquals(await egressMode(shared, ok), "off", "cells stay off");
    assertEquals(await egressMode(shared, ok, { probe: true }), "placed");
    const eg = fakeEgress();
    if (!passing) {
      eg.lines = (ls) =>
        ls.map((l) => l.probe === "gw-smb-445" ? { ...l, ok: true } : l);
    }
    let atProbe: string[] = [];
    eg.onProbe = (sandbox) => {
      const dir = t.docker.runs.find((r) => r.name === sandbox)!.mounts.get(
        "C:\\cg-secrets",
      )!.src;
      atProbe = [...Deno.readDirSync(dir)].map((e) => e.name);
      return Promise.resolve();
    };
    t.docker.waitForReady = true;
    let atStart: string[] = [];
    t.docker.behavior = (call) => {
      atStart = [
        ...Deno.readDirSync(call.mounts.get("C:\\cg-secrets")!.src),
      ].map((e) => e.name).sort();
      return Promise.resolve(0);
    };
    const out = join(root, "probe-out");
    await Deno.mkdir(out, { recursive: true });
    const r = await runQualificationProbe({
      docker: t.docker,
      egress: eg,
      custody: {
        privateRoot: t.env.privateRoot,
        owner: t.env.owner,
        ...(t.env.secretAcl ?? {}),
      },
      token: "backend-token-0123456789abcdef",
      revoke: () => t.env.backend.revoke("exec-probe-1"),
      spec: {
        name: "cg-harness-probe-1",
        owner: t.env.owner,
        executionId: "exec-probe-1",
        imageId: `sha256:${"c".repeat(64)}`,
        workspace: out,
        taskDir: out,
        configDir: out,
        extraMounts: [],
        env: { CG_BACKEND_URL: "http://172.30.60.1:3210" },
        timeoutMs: 60_000,
        killGraceMs: 50,
        opTimeoutMs: 100,
        maxCaptureBytes: 1024 * 1024,
        rawLog: join(out, "probe.jsonl"),
        stderrLog: join(out, "stderr.txt"),
      },
      probeCommand: ["powershell", "-File", "C:\\config\\cg-al-probe.ps1"],
      out,
      collect: () => collect(markerPath),
    });
    assertEquals(atProbe, [], "empty mount during the preflight");
    const call = t.docker.runs[0]!;
    assertEquals(call.network, SANDBOX_NETWORK.name);
    assertEquals(eg.proxyHosts, ["api.anthropic.com"]);
    const q = await harnessEgressVerify({
      root,
      mark: "qualified",
      probeEvidence: r.evidence,
    }, collect);
    if (passing) {
      assertEquals(r.problems, []);
      assertEquals(atStart, ["backend-token", READY_FILE]);
      assertEquals(q, []);
    } else {
      assertStringIncludes(r.problems.join("\n"), "gw-smb-445");
      assertEquals(t.docker.readySeen, false, "no token, no ready");
      assertStringIncludes(q.join("\n"), "gw-smb-445");
    }
  }
});

// M9-01a: an extra credential (the Claude Code OAuth token) is released only
// after the preflight passes, beside the backend token; a probe mount can be
// read-write; the proxy log stays in out/.

Deno.test("qualification probe: extra secrets are released only after a passed preflight; a readWrite mount is not readonly (M9-01a)", async () => {
  for (const passing of [true, false]) {
    await using t = await makeEnv();
    const root = t.env.privateRoot;
    const markerPath = join(root, "results", "harness", EGRESS_MARKER);
    const collect = markerAwareCollector();
    assertEquals(
      await harnessEgressVerify({ root, mark: "candidate" }, collect),
      [],
    );
    const eg = fakeEgress();
    if (!passing) {
      eg.lines = (ls) =>
        ls.map((l) => l.probe === "gw-smb-445" ? { ...l, ok: true } : l);
    }
    let atProbe: string[] = [];
    eg.onProbe = (sandbox) => {
      const dir = t.docker.runs.find((r) => r.name === sandbox)!.mounts.get(
        "C:\\cg-secrets",
      )!.src;
      atProbe = [...Deno.readDirSync(dir)].map((e) => e.name);
      return Promise.resolve();
    };
    t.docker.waitForReady = true;
    let atStart: string[] = [];
    t.docker.behavior = (call) => {
      atStart = [
        ...Deno.readDirSync(call.mounts.get("C:\\cg-secrets")!.src),
      ].map((e) => e.name).sort();
      return Promise.resolve(0);
    };
    const out = join(root, "probe-out");
    const probeDir = join(root, "probe-mount");
    await Deno.mkdir(out, { recursive: true });
    await Deno.mkdir(probeDir, { recursive: true });
    const r = await runQualificationProbe({
      docker: t.docker,
      egress: eg,
      custody: {
        privateRoot: t.env.privateRoot,
        owner: t.env.owner,
        ...(t.env.secretAcl ?? {}),
      },
      token: "backend-token-0123456789abcdef",
      releaseAfterPreflight: [{
        name: "claude-oauth-token",
        value: "oauth-token-fedcba9876543210",
      }],
      revoke: () => t.env.backend.revoke("exec-probe-2"),
      spec: {
        name: "cg-harness-probe-2",
        owner: t.env.owner,
        executionId: "exec-probe-2",
        imageId: `sha256:${"c".repeat(64)}`,
        workspace: out,
        taskDir: out,
        configDir: out,
        extraMounts: [{ src: probeDir, dst: "C:\\probe", readWrite: true }],
        env: { CG_BACKEND_URL: "http://172.30.60.1:3210" },
        timeoutMs: 60_000,
        killGraceMs: 50,
        opTimeoutMs: 100,
        maxCaptureBytes: 1024 * 1024,
        rawLog: join(out, "probe.jsonl"),
        stderrLog: join(out, "stderr.txt"),
      },
      probeCommand: ["powershell", "-File", "C:\\probe\\spike.ps1"],
      out,
      collect: () => collect(markerPath),
    });
    assertEquals(atProbe, [], "empty mount during the preflight");
    const call = t.docker.runs[0]!;
    assertEquals(call.mounts.get("C:\\probe"), {
      src: probeDir,
      readonly: false,
    });
    assertEquals(call.mounts.get("C:\\cg-secrets")!.readonly, true);
    if (passing) {
      assertEquals(r.problems, []);
      assertEquals(atStart, [
        "backend-token",
        "claude-oauth-token",
        READY_FILE,
      ]);
    } else {
      assertStringIncludes(r.problems.join("\n"), "gw-smb-445");
      assertEquals(t.docker.readySeen, false, "no token, no ready");
      assertEquals(atStart.includes("claude-oauth-token"), false);
    }
  }
});

Deno.test("qualification probe: released secret values printed by the sandbox are scrubbed from the retained captures (M9-01a run 002)", async () => {
  await using t = await makeEnv();
  const root = t.env.privateRoot;
  const markerPath = join(root, "results", "harness", EGRESS_MARKER);
  const collect = markerAwareCollector();
  assertEquals(
    await harnessEgressVerify({ root, mark: "candidate" }, collect),
    [],
  );
  const token = "backend-token-0123456789abcdef";
  const oauth = "oauth-token-fedcba9876543210";
  t.docker.waitForReady = true;
  t.docker.behavior = async (_call, io) => {
    await io.stdout(`leak ${oauth} and ${token} end`);
    return 0;
  };
  const out = join(root, "probe-out");
  await Deno.mkdir(out, { recursive: true });
  const r = await runQualificationProbe({
    docker: t.docker,
    egress: fakeEgress(),
    custody: {
      privateRoot: t.env.privateRoot,
      owner: t.env.owner,
      ...(t.env.secretAcl ?? {}),
    },
    token,
    releaseAfterPreflight: [{ name: "claude-oauth-token", value: oauth }],
    revoke: () => t.env.backend.revoke("exec-probe-3"),
    spec: {
      name: "cg-harness-probe-3",
      owner: t.env.owner,
      executionId: "exec-probe-3",
      imageId: `sha256:${"c".repeat(64)}`,
      workspace: out,
      taskDir: out,
      configDir: out,
      extraMounts: [],
      env: { CG_BACKEND_URL: "http://172.30.60.1:3210" },
      timeoutMs: 60_000,
      killGraceMs: 50,
      opTimeoutMs: 100,
      maxCaptureBytes: 1024 * 1024,
      rawLog: join(out, "probe.jsonl"),
      stderrLog: join(out, "stderr.txt"),
    },
    probeCommand: ["powershell", "-File", "C:\\probe\\spike.ps1"],
    out,
    collect: () => collect(markerPath),
  });
  assertEquals(r.problems, []);
  const raw = await Deno.readTextFile(join(out, "probe.jsonl"));
  assertStringIncludes(raw, "leak ");
  assertStringIncludes(raw, " end");
  assertEquals(raw.includes(oauth), false, "oauth value scrubbed");
  assertEquals(raw.includes(token), false, "backend token scrubbed");
});

Deno.test("qualification probe: an injected scrub failure fails the probe closed (M9-01a run 003)", async () => {
  const t = await makeEnv();
  const root = t.env.privateRoot;
  const markerPath = join(root, "results", "harness", EGRESS_MARKER);
  const collect = markerAwareCollector();
  assertEquals(
    await harnessEgressVerify({ root, mark: "candidate" }, collect),
    [],
  );
  t.docker.waitForReady = true;
  t.docker.behavior = () => Promise.resolve(0);
  const out = join(root, "probe-out");
  await Deno.mkdir(out, { recursive: true });
  let scrubbed: string[] = [];
  await assertRejects(
    () =>
      runQualificationProbe({
        docker: t.docker,
        egress: fakeEgress(),
        custody: {
          privateRoot: t.env.privateRoot,
          owner: t.env.owner,
          ...(t.env.secretAcl ?? {}),
        },
        token: "backend-token-0123456789abcdef",
        releaseAfterPreflight: [{
          name: "claude-oauth-token",
          value: "oauth-token-fedcba9876543210",
        }],
        revoke: () => t.env.backend.revoke("exec-probe-4"),
        scrub: (paths) => {
          scrubbed = paths;
          return Promise.resolve("injected: file locked");
        },
        spec: {
          name: "cg-harness-probe-4",
          owner: t.env.owner,
          executionId: "exec-probe-4",
          imageId: `sha256:${"c".repeat(64)}`,
          workspace: out,
          taskDir: out,
          configDir: out,
          extraMounts: [],
          env: { CG_BACKEND_URL: "http://172.30.60.1:3210" },
          timeoutMs: 60_000,
          killGraceMs: 50,
          opTimeoutMs: 100,
          maxCaptureBytes: 1024 * 1024,
          rawLog: join(out, "probe.jsonl"),
          stderrLog: join(out, "stderr.txt"),
        },
        probeCommand: ["powershell", "-File", "C:\\probe\\spike.ps1"],
        out,
        collect: () => collect(markerPath),
      }),
    Error,
    "capture scrub failed: injected: file locked",
  );
  assertEquals(scrubbed, [
    join(out, "probe.jsonl"),
    join(out, "stderr.txt"),
    join(out, "egress.jsonl"),
  ]);
});

// M3-08: the route-aware probe proxies and probes exactly the hosts it is given.

Deno.test("qualification probe: hosts override the default route host (M3-08 --route)", async () => {
  const t = await makeEnv();
  const root = t.env.privateRoot;
  const markerPath = join(root, "results", "harness", EGRESS_MARKER);
  const eg = fakeEgress();
  t.docker.waitForReady = true;
  t.docker.behavior = () => Promise.resolve(0);
  const out = join(root, "probe-out");
  await Deno.mkdir(out, { recursive: true });
  const r = await runQualificationProbe({
    docker: t.docker,
    egress: eg,
    custody: {
      privateRoot: t.env.privateRoot,
      owner: t.env.owner,
      ...(t.env.secretAcl ?? {}),
    },
    token: "backend-token-0123456789abcdef",
    revoke: () => t.env.backend.revoke("exec-probe-2"),
    spec: {
      name: "cg-harness-probe-2",
      owner: t.env.owner,
      executionId: "exec-probe-2",
      imageId: `sha256:${"c".repeat(64)}`,
      workspace: out,
      taskDir: out,
      configDir: out,
      extraMounts: [],
      env: { CG_BACKEND_URL: "http://172.30.60.1:3210" },
      timeoutMs: 60_000,
      killGraceMs: 50,
      opTimeoutMs: 100,
      maxCaptureBytes: 1024 * 1024,
      rawLog: join(out, "probe.jsonl"),
      stderrLog: join(out, "stderr.txt"),
    },
    probeCommand: ["powershell", "-File", "C:\\config\\cg-al-probe.ps1"],
    out,
    hosts: ["openrouter.ai"],
    collect: () => markerAwareCollector()(markerPath),
  });
  assertEquals(r.problems, []);
  assertEquals(eg.proxyHosts, ["openrouter.ai"]);
  assertEquals(eg.probedHosts, ["openrouter.ai"]);
  const ev = JSON.parse(await Deno.readTextFile(r.evidence));
  assertEquals(ev.hosts, ["openrouter.ai"]);
  assert(
    ev.lines.some((l: { probe: string }) =>
      l.probe === "proxy-allow-openrouter.ai"
    ),
  );
  assert(
    !ev.lines.some((l: { probe: string }) =>
      l.probe.includes("api.anthropic.com")
    ),
  );
});

// H-01: the probe sandbox gets the harness privilege check before its preflight and token.

Deno.test("qualification probe (H-01): the privilege check runs before the preflight; a failure releases nothing and is a problem", async () => {
  for (const healthy of [true, false]) {
    const t = await makeEnv();
    const root = t.env.privateRoot;
    const markerPath = join(root, "results", "harness", EGRESS_MARKER);
    const eg = fakeEgress();
    t.docker.behavior = () => Promise.resolve(0);
    if (!healthy) {
      t.docker.execAnswer = { code: 0, stdout: ADMIN_GROUPS_CSV, stderr: "" };
    }
    const exec = t.docker.exec.bind(t.docker);
    t.docker.exec = (name, user, argv) => {
      eg.events.push("privilege");
      return exec(name, user, argv);
    };
    const out = join(root, "probe-out");
    await Deno.mkdir(out, { recursive: true });
    const r = await runQualificationProbe({
      docker: t.docker,
      egress: eg,
      custody: {
        privateRoot: t.env.privateRoot,
        owner: t.env.owner,
        ...(t.env.secretAcl ?? {}),
      },
      token: "backend-token-0123456789abcdef",
      revoke: () => t.env.backend.revoke("exec-probe-3"),
      spec: {
        name: "cg-harness-probe-3",
        owner: t.env.owner,
        executionId: "exec-probe-3",
        imageId: `sha256:${"c".repeat(64)}`,
        workspace: out,
        taskDir: out,
        configDir: out,
        extraMounts: [],
        env: { CG_BACKEND_URL: "http://172.30.60.1:3210" },
        timeoutMs: 60_000,
        killGraceMs: 50,
        opTimeoutMs: 100,
        maxCaptureBytes: 1024 * 1024,
        rawLog: join(out, "probe.jsonl"),
        stderrLog: join(out, "stderr.txt"),
      },
      probeCommand: ["powershell", "-File", "C:\\config\\cg-al-probe.ps1"],
      out,
      collect: () => markerAwareCollector()(markerPath),
    });
    assertEquals(t.docker.privilegeCalls[0]!.secrets, [], "empty mount");
    if (healthy) {
      assertEquals(r.problems, []);
      assert(
        eg.events.indexOf("privilege") < eg.events.indexOf("probe"),
        eg.events.join(","),
      );
      assert(t.docker.readySeen);
    } else {
      assertStringIncludes(
        r.problems.join("\n"),
        "sandbox privilege check failed",
      );
      assertStringIncludes(r.problems.join("\n"), "S-1-5-32-544");
      assert(!eg.events.includes("probe"), eg.events.join(","));
      assertEquals(t.docker.readySeen, false, "no token, no ready");
      assertEquals(t.docker.secretsAtKill, []);
    }
  }
});

// Review item 3: an authorized marker carries, and every read rechecks, its evidence.

/** A repo root taken through candidate, qualified and authorized with complete evidence. */
async function authorizedRoot(at?: string): Promise<string> {
  const root = at ?? await Deno.realPath(await testTempDir());
  const c = markerAwareCollector();
  assertEquals(await harnessEgressVerify({ root, mark: "candidate" }, c), []);
  assertEquals(
    await harnessEgressVerify({
      root,
      mark: "qualified",
      probeEvidence: await probeEvidence(root),
    }, c),
    [],
  );
  const soon = new Date(Date.now() + 60_000).toISOString();
  const later = new Date(Date.now() + 120_000).toISOString();
  const rotation = join(root, "rotation.json");
  await Deno.writeTextFile(
    rotation,
    JSON.stringify({
      v: 1,
      credentials: ["claude-oauth", "openrouter"].map((name) => ({
        name,
        revoked_at: soon,
        created_at: soon,
      })),
    }),
  );
  await Deno.mkdir(join(root, "harness", "egress"), { recursive: true });
  await Deno.writeTextFile(
    join(root, ...RECORDED_HOSTS_PATH.split("/")),
    JSON.stringify({
      v: 1,
      source: "record mode execution cell-ok",
      routes: { "anthropic:first-party-oauth": ["oauth.example.test"] },
    }),
  );
  const cells = join(root, "results", "harness", "cells");
  await Deno.mkdir(join(cells, "executions", "camp1"), { recursive: true });
  await Deno.writeTextFile(
    join(cells, "executions", "camp1", "cell-ok.json"),
    JSON.stringify({
      id: "cell-ok",
      manifest: {
        harness: "claude-code",
        provider_routes: { main: "anthropic:first-party-oauth" },
      },
      termination: "completed",
      started_at: later,
    }),
  );
  await Deno.mkdir(join(cells, "runs", "cell-ok"), { recursive: true });
  await Deno.writeTextFile(
    join(cells, "runs", "cell-ok", "record-mode.json"),
    JSON.stringify({
      v: 1,
      execution_id: "cell-ok",
      record_mode: true,
      supervised: true,
      credential_bearing: true,
      harness: "claude-code",
      termination: "completed",
    }),
  );
  await Deno.writeTextFile(
    join(cells, "runs", "cell-ok", "egress.jsonl"),
    // M1-34e: the exact untagged log of Step 11 cell 9d68887a authorizes.
    jsonl(CELL_9D68887A),
  );
  assertEquals(
    await harnessEgressVerify({
      root,
      mark: "authorized",
      rotation,
      cell: "cell-ok",
      evidence: "M1-34/001",
    }, c),
    [],
  );
  return root;
}

Deno.test("authorized marker (review item 3): carries the evidence; a minimal or stale marker is not authorized (fail closed)", async () => {
  const root = await authorizedRoot();
  const shared = join(root, "results", "harness");
  const markerPath = join(shared, EGRESS_MARKER);
  const ok = () => Promise.resolve([]);
  const m = JSON.parse(await Deno.readTextFile(markerPath));
  for (
    const k of [
      "probe_evidence",
      "probe_evidence_sha256",
      "recorded_hosts_sha256",
      "cell",
      "allowlist_sha256",
    ]
  ) {
    assert(typeof m[k] === "string" && m[k] !== "", k);
  }
  assertEquals(m.rotation_done, true);
  assertEquals(await egressMode(shared, ok), "enforced");
  assertEquals(await harnessEgressVerify({ root }, markerAwareCollector()), []);
  const full = await Deno.readTextFile(markerPath);
  // A minimal authorized marker enables nothing.
  await Deno.writeTextFile(
    markerPath,
    JSON.stringify({
      v: 1,
      state: "authorized",
      network_id: "net9",
      interface_index: 42,
    }),
  );
  await assertRejects(
    () => egressMode(shared, ok),
    ConfigurationError,
    "not authorized",
  );
  for (const k of ["rotation_done", "cell", "allowlist_sha256"]) {
    const partial = { ...m };
    delete partial[k];
    await Deno.writeTextFile(markerPath, JSON.stringify(partial));
    await assertRejects(() => egressMode(shared, ok), ConfigurationError, k);
  }
  await Deno.writeTextFile(markerPath, full);
  // A stale recorded-hosts file: its hash no longer matches.
  const recorded = join(root, ...RECORDED_HOSTS_PATH.split("/"));
  const text = await Deno.readTextFile(recorded);
  await Deno.writeTextFile(
    recorded,
    text.replace("oauth.example.test", "other.example.test"),
  );
  await assertRejects(
    () => egressMode(shared, ok),
    ConfigurationError,
    "recorded_hosts_sha256",
  );
  assertStringIncludes(
    (await harnessEgressVerify({ root }, markerAwareCollector())).join("\n"),
    "recorded_hosts_sha256",
  );
  await Deno.writeTextFile(recorded, text);
  // Changed probe evidence, or a removed cell, is not authorized either.
  await Deno.writeTextFile(m.probe_evidence, "{}");
  await assertRejects(
    () => egressMode(shared, ok),
    ConfigurationError,
    "probe_evidence_sha256",
  );
});

Deno.test("run --concurrency > 1 is refused before any environment opens while the egress marker places sandboxes (M1-33c)", async () => {
  const t = await makeEnv();
  await writeCatalog(t);
  await mockExperiment(t);
  const shared = join(t.repo.root, "results", "harness");
  await Deno.mkdir(shared, { recursive: true });
  const never = () => Promise.reject(new Error("no environment may open"));
  for (const state of ["qualified", "authorized"]) {
    await Deno.writeTextFile(
      join(shared, EGRESS_MARKER),
      JSON.stringify({ v: 1, state }),
    );
    for (const dryRun of [false, true]) {
      await assertRejects(
        () =>
          harnessRun(
            "contract",
            runOpts(t, { concurrency: 2, dryRun }),
            never,
            never,
          ),
        ConfigurationError,
        "--concurrency",
        `${state} dryRun=${dryRun}`,
      );
    }
  }
  // Concurrency 1 on a placing marker, and concurrency 2 with no marker, still plan.
  const planner = (eo: Parameters<typeof openPlanEnv>[0]) =>
    openPlanEnv(eo, planDeps(t, [], () => Promise.resolve([])));
  await Deno.writeTextFile(
    join(shared, EGRESS_MARKER),
    JSON.stringify({ v: 1, state: "qualified" }),
  );
  assertEquals(
    (await harnessRun("contract", runOpts(t, { dryRun: true }), never, planner))
      .planned,
    2,
  );
  await Deno.remove(join(shared, EGRESS_MARKER));
  assertEquals(
    (await harnessRun(
      "contract",
      runOpts(t, { dryRun: true, concurrency: 2 }),
      never,
      planner,
    )).planned,
    2,
  );
});

Deno.test("run --concurrency > 1: an unknown, malformed or unreadable marker is refused as placing (fail closed; M1-33c review)", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  await mockExperiment(t);
  const shared = join(t.repo.root, "results", "harness");
  await Deno.mkdir(shared, { recursive: true });
  const marker = join(shared, EGRESS_MARKER);
  const never = () => Promise.reject(new Error("no environment may open"));
  const refused = async (what: string) =>
    await assertRejects(
      () =>
        harnessRun(
          "contract",
          runOpts(t, { concurrency: 2, dryRun: true }),
          never,
          never,
        ),
      ConfigurationError,
      "--concurrency",
      what,
    );
  await Deno.writeTextFile(marker, JSON.stringify({ v: 1, state: "bogus" }));
  await refused("unknown state");
  await Deno.writeTextFile(marker, "{not json");
  await refused("malformed");
  await Deno.remove(marker);
  await Deno.mkdir(marker); // present but unreadable as a file
  await refused("unreadable");
});

Deno.test("openHarnessEnv: with concurrency > 1 the marker is rechecked under the lock, before any sweep (M1-33c review: TOCTOU)", async () => {
  await using t = await makeEnv();
  const shared = join(t.repo.root, "results", "harness");
  await Deno.mkdir(shared, { recursive: true });
  // The marker became placing after harness run's up-front check.
  await Deno.writeTextFile(
    join(shared, EGRESS_MARKER),
    JSON.stringify({ v: 1, state: "qualified" }),
  );
  const order: string[] = [];
  await assertRejects(
    () => openHarnessEnv({ ...envOpts(t), concurrency: 2 }, deps(order)),
    ConfigurationError,
    "--concurrency",
  );
  assertEquals(order, ["lock", "release"]);
});

Deno.test("openHarnessEnv: the effective egress mode is computed under the lock, before any sweep (M1-33c review round 2)", async () => {
  await using t = await makeEnv();
  const shared = join(t.repo.root, "results", "harness");
  await Deno.mkdir(shared, { recursive: true });
  await Deno.writeTextFile(
    join(shared, EGRESS_MARKER),
    JSON.stringify({ v: 1, state: "qualified" }),
  );
  const order: string[] = [];
  const verify = () => {
    order.push("verify");
    return Promise.resolve(["rule cg-harness-egress-tcp missing"]);
  };
  await assertRejects(
    () => openHarnessEnv(envOpts(t), deps(order, undefined, verify)),
    ConfigurationError,
    "verification failed",
  );
  assertEquals(order, ["lock", "verify", "release"]);
});

Deno.test("openHarnessEnv (M1-33d review): a shared proxy that cannot bind stops the start naming the gateway and port, before the backend and any cell; the runtime gets the concurrency", async () => {
  await using t = await makeEnv();
  const shared = join(t.repo.root, "results", "harness");
  await Deno.mkdir(shared, { recursive: true });
  await Deno.writeTextFile(
    join(shared, EGRESS_MARKER),
    JSON.stringify({ v: 1, state: "qualified" }),
  );
  const order: string[] = [];
  const seen: { concurrency?: number }[] = [];
  const d: EnvDeps = {
    ...deps(order, undefined, () => Promise.resolve([])),
    egressRuntime: (eo) => {
      order.push("egress runtime");
      seen.push(eo);
      return realEgressRuntime({
        ...eo,
        shared: (so) =>
          startSharedEgressProxy({
            ...so,
            listen: () => {
              throw new Deno.errors.AddrInUse("Address already in use");
            },
          }),
      });
    },
  };
  await assertRejects(
    () => openHarnessEnv({ ...envOpts(t), backendPort: BACKEND_PORT }, d),
    ConfigurationError,
    `${SANDBOX_NETWORK.gateway}:${PROXY_PORT}`,
  );
  assertEquals(seen.map((x) => x.concurrency), [1]);
  assertEquals(order.slice(-2), ["egress runtime", "release"]);
});

const isolationCases: [unknown, string][] = [
  [undefined, "proxy_isolation missing"],
  [1, "proxy_isolation 1"],
  [3, "proxy_isolation 3"],
  [2.5, "proxy_isolation 2.5"],
  ["2", 'proxy_isolation "2"'],
];
const markerWith = (state: string, v: unknown) =>
  JSON.stringify({
    v: 1,
    state,
    ...(v !== undefined ? { proxy_isolation: v } : {}),
  });

Deno.test("run --concurrency > 1 (M1-33e): the up-front check names a marker proxy_isolation other than exactly PROXY_ISOLATION, before any environment opens; it is refused unless every placed-concurrency condition holds (M7-01)", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  await mockExperiment(t);
  const shared = join(t.repo.root, "results", "harness");
  await Deno.mkdir(shared, { recursive: true });
  const never = () => Promise.reject(new Error("no environment may open"));
  const refused = async (marker: string) => {
    await Deno.writeTextFile(join(shared, EGRESS_MARKER), marker);
    return (await assertRejects(
      () =>
        harnessRun(
          "contract",
          runOpts(t, { concurrency: 2 }),
          never,
          never,
        ),
      ConfigurationError,
      "--concurrency",
    )).message;
  };
  for (const [v, named] of isolationCases) {
    for (const state of ["qualified", "authorized"]) {
      assertStringIncludes(await refused(markerWith(state, v)), named, state);
    }
  }
  assertStringIncludes(await refused("{not json"), "proxy_isolation missing");
  const ok = await refused(markerWith("qualified", PROXY_ISOLATION));
  assertEquals(ok.includes("proxy_isolation"), false, ok);
});

Deno.test("openHarnessEnv concurrency > 1 (M1-33e): the proxy_isolation gate runs under the lock, before any sweep, at both refusal points; it is refused unless every placed-concurrency condition holds (M7-01)", async () => {
  await using t = await makeEnv();
  const shared = join(t.repo.root, "results", "harness");
  await Deno.mkdir(shared, { recursive: true });
  const refused = async (marker: string, probe = false) => {
    await Deno.writeTextFile(join(shared, EGRESS_MARKER), marker);
    const order: string[] = [];
    const msg = (await assertRejects(
      () =>
        openHarnessEnv(
          { ...envOpts(t), concurrency: 2, ...(probe ? { probe } : {}) },
          deps(order, undefined, () => Promise.resolve([])),
        ),
      ConfigurationError,
      "--concurrency",
    )).message;
    assertEquals(order, ["lock", "release"], marker);
    return msg;
  };
  for (const [v, named] of isolationCases) {
    assertStringIncludes(await refused(markerWith("qualified", v)), named);
    // A candidate places only the probe: the second (effective mode) point.
    assertStringIncludes(
      await refused(markerWith("candidate", v), true),
      named,
    );
  }
  for (const probe of [false, true]) {
    const state = probe ? "candidate" : "qualified";
    const ok = await refused(markerWith(state, PROXY_ISOLATION), probe);
    assertEquals(ok.includes("proxy_isolation"), false, ok);
  }
});

Deno.test("openHarnessEnv close (M1-33e): proxy listener closed, the existing registration revoked, in-flight tunnels ended, no registration after close, a second close is a no-op; env.proxyIsolation is fixed under the lock", async () => {
  await using t = await makeEnv();
  const shared = join(t.repo.root, "results", "harness");
  await Deno.mkdir(shared, { recursive: true });
  await Deno.writeTextFile(
    join(shared, EGRESS_MARKER),
    markerWith("qualified", PROXY_ISOLATION),
  );
  const upstream = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const held: Deno.Conn[] = [];
  (async () => {
    for await (const c of upstream) held.push(c);
  })();
  const source = "172.30.60.5";
  const order: string[] = [];
  const seen: { proxyIsolation?: unknown }[] = [];
  let proxyPort = 0;
  // A resolve held open on the registration's signal: only revoke aborts it.
  const resolving = Promise.withResolvers<void>();
  let revoked = false;
  const d: EnvDeps = {
    ...deps(order, undefined, () => Promise.resolve([])),
    egressRuntime: (eo) => {
      seen.push(eo);
      return realEgressRuntime({
        ...eo,
        shared: (so) => {
          const p = startSharedEgressProxy({
            ...so,
            hostname: "127.0.0.1",
            port: 0,
            allowedHosts: ["127.0.0.1"],
            resolve: (host, signal) =>
              host === "slow.example.test"
                ? new Promise((res) => {
                  signal?.addEventListener("abort", () => {
                    revoked = true;
                    res([]);
                  });
                  resolving.resolve();
                })
                : Promise.resolve(["93.184.216.34"]),
            dial: () =>
              Deno.connect({
                hostname: "127.0.0.1",
                port: (upstream.addr as Deno.NetAddr).port,
              }),
            authDelayMs: 0,
            sourceOf: () => source,
          });
          proxyPort = p.port;
          return p;
        },
      });
    },
    // The backend binds the sandbox gateway, absent on a test host.
    serveBackend: () => ({
      url: `http://${SANDBOX_NETWORK.gateway}:${BACKEND_PORT}`,
      shutdown: () => {
        order.push("backend down");
        return Promise.resolve();
      },
    }),
  };
  const h = await openHarnessEnv(
    { ...envOpts(t), backendPort: BACKEND_PORT },
    d,
  );
  try {
    assertEquals(h.env.proxyIsolation, PROXY_ISOLATION);
    assertEquals(seen.map((x) => x.proxyIsolation), [PROXY_ISOLATION]);
    const { credential, reg } = h.env.egress!.register({
      allow: ["example.test", "slow.example.test"],
      log: () => Promise.resolve(),
      source,
    });
    const connect = async (target: string) => {
      const c = await Deno.connect({ hostname: "127.0.0.1", port: proxyPort });
      await c.write(
        new TextEncoder().encode(
          `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: Basic ${
            btoa(`${credential.user}:${credential.pass}`)
          }\r\n\r\n`,
        ),
      );
      return c;
    };
    // An in-flight tunnel through the shared proxy, and a pending resolve.
    const tunnel = await connect("example.test:443");
    const buf = new Uint8Array(512);
    const n = await tunnel.read(buf);
    assertStringIncludes(
      new TextDecoder().decode(buf.subarray(0, n ?? 0)),
      " 200 ",
    );
    const pending = await connect("slow.example.test:443");
    await resolving.promise;
    assertEquals(revoked, false);
    await h.close();
    // The existing registration was revoked: its signal aborted its pending resolve.
    assertEquals(revoked, true);
    try {
      pending.close();
    } catch { /* closed */ }
    // In-flight tunnel ended.
    assertEquals(await tunnel.read(buf).catch(() => null), null);
    try {
      tunnel.close();
    } catch { /* closed */ }
    // Listener closed: a new connection is refused.
    await assertRejects(() =>
      Deno.connect({ hostname: "127.0.0.1", port: proxyPort })
    );
    // No registration is issued after close.
    assertThrows(
      () =>
        h.env.egress!.register({
          allow: [],
          log: () => {},
          source: "172.30.60.6",
        }),
      Error,
      "shut down",
    );
    await reg.unregister();
    // A second close is a no-op.
    await h.close();
    assertEquals(order.filter((x) => x === "release").length, 1);
    assertEquals(order.filter((x) => x === "backend down").length, 1);
  } finally {
    await h.close();
    upstream.close();
    for (const c of held) {
      try {
        c.close();
      } catch { /* closed */ }
    }
  }
});

// ---- M5-03: --stop-file and --campaign on run and rejudge ----

const UNKNOWN_CAMPAIGN = "00000000-0000-0000-0000-000000000000";

Deno.test("harnessRun forwards two --stop-file values and --campaign into runCampaign", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await mockExperiment(t);
  const absent = join(t.repo.root, "pause.json");
  const stop = join(t.repo.root, "stop-contract.json");
  await Deno.writeTextFile(stop, "{}");
  const c = capture();
  try {
    const s = await harnessRun(
      "contract",
      runOpts(t, { stopFiles: [absent, stop] }),
      opener(t),
    );
    assertEquals([s.ran, s.stopped, t.docker.runs.length], [0, true, 0]);
    assertStringIncludes(
      stripAnsiCode(c.out.join("\n")),
      `[PAUSE] stop file ${stop} present; resume with: centralgauge harness run contract --campaign ${s.campaignId}`,
    );
    await assertRejects(
      () =>
        harnessRun(
          "contract",
          runOpts(t, { campaign: UNKNOWN_CAMPAIGN }),
          opener(t),
        ),
      ConfigurationError,
      `no campaign ${UNKNOWN_CAMPAIGN}`,
    );
    await Deno.remove(stop);
    const r = await harnessRun(
      "contract",
      runOpts(t, { stopFiles: [absent, stop], campaign: s.campaignId }),
      opener(t),
    );
    assertEquals([r.campaignId, r.stopped, r.ran], [s.campaignId, false, 2]);
  } finally {
    c.restore();
  }
});

/** Two campaigns of one experiment: the older one holds a stale judgment. */
async function twoCampaigns(t: TestEnv) {
  const { c: older, es } = await campaignWithStaleJudgment(t);
  const file = join(t.harnessRoot, "experiments", "contract.yml");
  await Deno.writeTextFile(
    file,
    (await Deno.readTextFile(file)).replace(
      "Mock contract.",
      "Mock contract, second campaign.",
    ),
  );
  await runCampaign(t.env, "contract", {
    dryRun: false,
    concurrency: 1,
    maxPauseMs: 0,
  }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
  const newer = (await t.env.store.campaigns("contract"))[0]!;
  assert(newer.id !== older.id, "a second campaign is the newest");
  const newerExec = (await t.env.store.executions(newer.id))[0]!.id;
  return { older, olderExec: es[0]!.id, newer, newerExec };
}

Deno.test("rejudge --campaign: the named campaign although a newer one exists; an execution outside it or an unknown id is refused", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { older, olderExec, newerExec } = await twoCampaigns(t);
  // Without --campaign the newest campaign is used.
  await assertRejects(
    () =>
      harnessRejudge(
        "contract",
        runOpts(t, { execution: olderExec }),
        opener(t),
      ),
    ConfigurationError,
    "is not in campaign",
  );
  const r = await harnessRejudge(
    "contract",
    runOpts(t, { campaign: older.id, execution: olderExec }),
    opener(t),
  );
  assertEquals([r.campaignId, r.rejudged], [older.id, 1]);
  const judgments = (await t.env.store.judgments(olderExec)).length;
  await assertRejects(
    () =>
      harnessRejudge(
        "contract",
        runOpts(t, { campaign: older.id, execution: newerExec }),
        opener(t),
      ),
    ConfigurationError,
    `execution ${newerExec} is not in campaign ${older.id}`,
  );
  await assertRejects(
    () =>
      harnessRejudge(
        "contract",
        runOpts(t, { campaign: UNKNOWN_CAMPAIGN }),
        opener(t),
      ),
    ConfigurationError,
    `no campaign ${UNKNOWN_CAMPAIGN}`,
  );
  assertEquals((await t.env.store.judgments(olderExec)).length, judgments);
  assertEquals((await t.env.store.judgments(newerExec)).length, 1);
});

Deno.test("CLI: `harness run` collects repeated --stop-file and --campaign; `harness rejudge` parses and forwards --campaign", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { older, olderExec, newer } = await twoCampaigns(t);
  const absent = join(t.repo.root, "pause.json");
  const stop = join(t.repo.root, "stop-contract.json");
  await Deno.writeTextFile(stop, "{}");
  const cli = new Command().name("centralgauge").noExit();
  registerHarnessCommand(cli, opener(t));
  const flags = [
    "--secrets-dir",
    t.env.privateRoot,
    "--private-dir",
    t.env.privateRoot,
  ];
  const codes: (number | undefined)[] = [];
  const parse = async (args: string[]) => {
    await cli.parse(["harness", ...args, ...flags]);
    codes.push(Deno.exitCode);
    Deno.exitCode = 0;
  };
  const runs = t.docker.runs.length;
  const cwd = Deno.cwd();
  const c = capture();
  try {
    Deno.chdir(t.repo.root);
    const run = ["run", "contract", "--stop-file", absent, "--stop-file", stop];
    await parse([...run, "--campaign", newer.id]);
    // The older campaign no longer matches the experiment: the pin refuses it.
    await parse([...run, "--campaign", older.id]);
    await parse([
      "rejudge",
      "contract",
      "--campaign",
      older.id,
      "--execution",
      olderExec,
      "--yes",
    ]);
    await parse([
      "rejudge",
      "contract",
      "--campaign",
      UNKNOWN_CAMPAIGN,
      "--yes",
    ]);
  } finally {
    Deno.chdir(cwd);
    c.restore();
    Deno.exitCode = 0;
  }
  const out = stripAnsiCode(c.out.join("\n"));
  const err = stripAnsiCode(c.err.join("\n"));
  assertEquals(codes, [0, 1, 0, 1]);
  assertEquals(t.docker.runs.length, runs, "the stop file ran no cell");
  assertStringIncludes(
    out,
    `[PAUSE] stop file ${stop} present; resume with: centralgauge harness run contract --campaign ${newer.id}`,
  );
  assertStringIncludes(err, "experiment_hash");
  assertStringIncludes(out, `[OK] ${olderExec}:`);
  assertStringIncludes(err, `no campaign ${UNKNOWN_CAMPAIGN}`);
});

Deno.test("--campaign refusals come before the environment opens: no lock, sweep, recovery or docker call (M5-03 review)", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { older, olderExec, newerExec } = await twoCampaigns(t);
  const order: string[] = [];
  const recording = (eo: Parameters<typeof openHarnessEnv>[0]) => {
    order.push("open");
    return openHarnessEnv(eo, deps(order));
  };
  const runs = t.docker.runs.length;
  const executions = (await t.env.store.executions(older.id)).length;
  await assertRejects(
    () =>
      harnessRejudge(
        "contract",
        runOpts(t, { campaign: UNKNOWN_CAMPAIGN }),
        recording,
      ),
    ConfigurationError,
    `no campaign ${UNKNOWN_CAMPAIGN} for experiment contract`,
  );
  await assertRejects(
    () =>
      harnessRejudge(
        "contract",
        runOpts(t, { campaign: older.id, execution: newerExec }),
        recording,
      ),
    ConfigurationError,
    `execution ${newerExec} is not in campaign ${older.id}`,
  );
  // Without --campaign, --execution is checked against the newest campaign.
  await assertRejects(
    () =>
      harnessRejudge(
        "contract",
        runOpts(t, { execution: olderExec }),
        recording,
      ),
    ConfigurationError,
    "is not in campaign",
  );
  await assertRejects(
    () =>
      harnessRun(
        "contract",
        runOpts(t, { campaign: UNKNOWN_CAMPAIGN }),
        recording,
      ),
    ConfigurationError,
    `no campaign ${UNKNOWN_CAMPAIGN} for experiment contract`,
  );
  // The older campaign's experiment_hash differs from the current experiment.
  await assertRejects(
    () =>
      harnessRun(
        "contract",
        runOpts(t, { campaign: older.id }),
        recording,
      ),
    ConfigurationError,
    `campaign ${older.id} does not match the current experiment: experiment_hash differ`,
  );
  assertEquals(order, []);
  assertEquals(t.docker.runs.length, runs);
  assertEquals((await t.env.store.executions(older.id)).length, executions);
});

// ---- M5-04: --rerun on run ----

Deno.test("parseRerunCell refuses a repeat that is not a safe positive integer", () => {
  assertEquals(parseRerunCell("HX-001:3:mock-crash"), {
    task: "HX-001",
    repeat: 3,
    arm: "mock-crash",
  });
  assertEquals(
    parseRerunCell(`HX-001:${Number.MAX_SAFE_INTEGER}:a`).repeat,
    Number.MAX_SAFE_INTEGER,
  );
  for (
    const repeat of [
      "0",
      "-1",
      "1.5",
      "NaN",
      "Infinity",
      "1e3",
      String(2 ** 53),
      "9".repeat(400),
    ]
  ) {
    assertThrows(
      () => parseRerunCell(`HX-001:${repeat}:mock-crash`),
      ValidationError,
      "<task:repeat:arm>",
      repeat,
    );
  }
});

Deno.test("CLI: `harness run --rerun HX-001:1:mock-crash` reruns that cell; HX-001:x:arm and HX-001:1 are refused by the parser", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await write(
    t.harnessRoot,
    "experiments/crashy.yml",
    `id: crashy
hypothesis: Mock contract.
primary_metric: pass_rate
baseline: mock-positive
variants: [mock-crash]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: 1
`,
  );
  const cli = new Command().name("centralgauge").noExit();
  registerHarnessCommand(cli, opener(t));
  const flags = [
    "--secrets-dir",
    t.env.privateRoot,
    "--private-dir",
    t.env.privateRoot,
  ];
  const cwd = Deno.cwd();
  const c = capture();
  const codes: (number | undefined)[] = [];
  try {
    Deno.chdir(t.repo.root);
    for (const args of [[], ["--rerun", "HX-001:1:mock-crash"]]) {
      await cli.parse(["harness", "run", "crashy", ...args, ...flags]);
      codes.push(Deno.exitCode);
      Deno.exitCode = 0;
    }
    const runs = t.docker.runs.length;
    for (const bad of ["HX-001:x:arm", "HX-001:1"]) {
      await assertRejects(
        () => cli.parse(["harness", "run", "crashy", "--rerun", bad, ...flags]),
        Error,
        "<task:repeat:arm>",
      );
    }
    assertEquals(
      t.docker.runs.length,
      runs,
      "the parser refused before any run",
    );
  } finally {
    Deno.chdir(cwd);
    c.restore();
    Deno.exitCode = 0;
  }
  assertEquals(codes, [0, 0]);
  const camp = (await t.env.store.campaigns("crashy"))[0]!;
  const crash = (await t.env.store.executions(camp.id))
    .filter((e) => e.arm === "mock-crash")
    .sort((a, b) => a.attempt - b.attempt);
  assertEquals(crash.map((e) => [e.attempt, e.run_kind]), [
    [1, "planned"],
    [2, "auto_retry"],
    [3, "manual_rerun"],
    [4, "auto_retry"],
  ]);
});

// M1-34e: authorization judges the agent phase; the record-mode preflight's
// own proxy lines must be exactly the expected ones.

/** The egress.jsonl of Step 11 cell 9d68887a (M1-34 run 001): host, decision, time and reason only. */
const CELL_9D68887A = [
  ["2026-09-27T08:34:28.797Z", "allow", "example.com:443", "allowed"],
  ["2026-09-27T08:34:28.804Z", "deny", "1.1.1.1:443", "ip literal"],
  ["2026-09-27T08:34:28.975Z", "allow", "api.anthropic.com:443", "allowed"],
  ["2026-09-27T08:34:33.486Z", "allow", "api.anthropic.com:443", "allowed"],
  ["2026-09-27T08:34:33.487Z", "allow", "api.anthropic.com:443", "allowed"],
  ["2026-09-27T08:34:34.462Z", "allow", "api.anthropic.com:443", "allowed"],
].map(([at, decision, target, reason]) => ({ at, decision, target, reason }));
const OAUTH_ROUTES = ["anthropic:first-party-oauth"];
type LogLine = Record<string, unknown>;
const jsonl = (ls: LogLine[]) =>
  ls.map((l) => JSON.stringify(l)).join("\n") + "\n";
/** The 9d68887a shape tagged: the first three lines are the preflight. */
const tagged = (ls: LogLine[] = CELL_9D68887A) =>
  ls.map((l, i) => ({ ...l, phase: i < 3 ? "preflight" : "agent" }));
const cellLog = (ls: LogLine[], routes = OAUTH_ROUTES) =>
  cellEgressProblems(jsonl(ls), routes).join("\n");

Deno.test("cellEgressProblems (M1-34e): the 9d68887a shape authorizes, legacy and tagged", () => {
  assertEquals(cellEgressProblems(jsonl(CELL_9D68887A), OAUTH_ROUTES), []);
  assertEquals(cellEgressProblems(jsonl(tagged()), OAUTH_ROUTES), []);
  // The expected hosts come from the cell's routes: an openrouter cell expects its own probe.
  const openrouter = [
    ...CELL_9D68887A.slice(0, 2),
    { ...CELL_9D68887A[2]!, target: "openrouter.ai:443" },
    { ...CELL_9D68887A[3]!, target: "openrouter.ai:443" },
  ];
  assertEquals(
    cellEgressProblems(jsonl(openrouter), ["openrouter:api-key"]),
    [],
  );
  assertStringIncludes(cellLog(openrouter), "api.anthropic.com:443");
});

Deno.test("cellEgressProblems (M1-34e): tagged logs refuse an agent deny and any preflight line that is not exactly expected", () => {
  const t = tagged();
  const deny = { ...t[4]!, decision: "deny", target: "evil.test:443" };
  // An agent-phase deny.
  assertStringIncludes(cellLog([...t, deny]), "agent-phase deny");
  // An unexpected preflight deny, and a mismatched expected decision.
  assertStringIncludes(
    cellLog([...t.slice(0, 3), { ...deny, phase: "preflight" }, ...t.slice(3)]),
    "preflight",
  );
  assertStringIncludes(
    cellLog([{ ...t[0]!, decision: "deny" }, ...t.slice(1)]),
    "example.com:443",
  );
  // A missing and a duplicate expected preflight line.
  assertStringIncludes(
    cellLog([t[0]!, t[1]!, ...t.slice(3)]),
    "api.anthropic.com:443",
  );
  assertStringIncludes(
    cellLog([t[0]!, t[1]!, t[1]!, ...t.slice(2)]),
    "1.1.1.1:443",
  );
  // A preflight line after the agent phase began.
  assertStringIncludes(
    cellLog([t[0]!, t[2]!, t[3]!, t[1]!, ...t.slice(4)]),
    "after",
  );
  // No agent line at all.
  assertStringIncludes(cellLog(t.slice(0, 3)), "agent");
});

Deno.test("cellEgressProblems (M1-34e): legacy untagged logs need the exact preflight as the leading lines", () => {
  const l = CELL_9D68887A;
  const deny = { ...l[4]!, decision: "deny", target: "evil.test:443" };
  // A deny interleaved after an agent line.
  assertStringIncludes(
    cellLog([...l.slice(0, 4), deny, ...l.slice(4)]),
    "agent-phase deny evil.test:443",
  );
  // The expected deny again, after the preflight.
  assertStringIncludes(
    cellLog([...l.slice(0, 4), { ...l[1]!, at: l[3]!.at }, ...l.slice(4)]),
    "agent-phase deny 1.1.1.1:443",
  );
  // A missing expected preflight line.
  assertStringIncludes(cellLog(l.slice(1)), "example.com:443");
  assertStringIncludes(cellLog([l[0]!, ...l.slice(2)]), "1.1.1.1:443");
  // No agent line.
  assertStringIncludes(cellLog(l.slice(0, 3)), "agent");
  // Out of time order.
  assertStringIncludes(cellLog([l[1]!, l[0]!, ...l.slice(2)]), "time order");
});

Deno.test("cellEgressProblems (M1-34e): fail closed on mixed tagging, unknown values and malformed lines", () => {
  const t = tagged();
  // Mixed tagging.
  assertStringIncludes(
    cellLog([...t.slice(0, 3), ...CELL_9D68887A.slice(3)]),
    "mixes tagged and untagged",
  );
  // Unknown phase and decision values.
  assertStringIncludes(
    cellLog([...t, { ...t[3]!, phase: "setup" }]),
    "malformed",
  );
  assertStringIncludes(
    cellLog([{ ...t[0]!, phase: "setup" }, ...t.slice(1)]),
    "malformed",
  );
  assertStringIncludes(
    cellLog([...t, { ...t[3]!, decision: "maybe" }]),
    "malformed",
  );
  assertStringIncludes(
    cellLog([...CELL_9D68887A, { ...CELL_9D68887A[3]!, decision: "maybe" }]),
    "malformed",
  );
  // Malformed lines: not JSON, no target, an unknown field.
  assertStringIncludes(
    cellEgressProblems(jsonl(t) + "{not json\n", OAUTH_ROUTES).join("\n"),
    "malformed",
  );
  const noTarget: LogLine = { ...t[3]! };
  delete noTarget["target"];
  assertStringIncludes(cellLog([...t, noTarget]), "malformed");
  assertStringIncludes(cellLog([...t, { ...t[3]!, extra: 1 }]), "malformed");
  // An empty log.
  assertStringIncludes(
    cellEgressProblems("", OAUTH_ROUTES).join("\n"),
    "agent",
  );
});

// M5-08a run 002: the probe cuts its credentials first, then tears the
// sandbox down, and never pulls the secrets from under a running sandbox.

/** A real grant at the env's backend, so a test can see the token refused (401). */
async function probeGrant(
  t: Awaited<ReturnType<typeof makeEnv>>,
  id: string,
): Promise<string> {
  const ws = join(t.env.privateRoot, "work", `probe-${id}`);
  await Deno.mkdir(ws, { recursive: true });
  return await t.env.backend.grant({
    executionId: id,
    sandbox: `cg-harness-probe-${id}`,
    workspace: ws,
    pristine: ws,
    trusted: [],
    symbols: [],
    lock: { store: ws, packages: [] },
    deploy: { ledgerRoot: ws, trustedRoots: [ws] },
    hostLog: join(ws, "host-log.jsonl"),
  }, 60_000);
}

/** Whether the backend still accepts this token (401 once revoked). */
async function probeTokenValid(
  t: Awaited<ReturnType<typeof makeEnv>>,
  id: string,
  token: string,
) {
  const r = await t.env.backend.handle(
    new Request("http://backend/v1/compile", {
      method: "POST",
      headers: {
        "x-cg-execution": id,
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: "{",
    }),
  );
  await r.body?.cancel();
  return r.status !== 401;
}

async function probeWith(
  t: Awaited<ReturnType<typeof makeEnv>>,
  eg: ReturnType<typeof fakeEgress>,
  name: string,
  o: { token?: string; revoke?: () => Promise<unknown> } = {},
) {
  const out = join(t.env.privateRoot, `probe-out-${name}`);
  await Deno.mkdir(out, { recursive: true });
  const id = `exec-probe-${name}`;
  return await runQualificationProbe({
    docker: t.docker,
    egress: eg,
    custody: {
      privateRoot: t.env.privateRoot,
      owner: t.env.owner,
      ...(t.env.secretAcl ?? {}),
    },
    token: o.token ?? "backend-token-0123456789abcdef",
    revoke: o.revoke ?? (() => {
      eg.events.push("revoke");
      return t.env.backend.revoke(id);
    }),
    spec: {
      name: `cg-harness-probe-${name}`,
      owner: t.env.owner,
      executionId: id,
      imageId: `sha256:${"c".repeat(64)}`,
      workspace: out,
      taskDir: out,
      configDir: out,
      extraMounts: [],
      env: { CG_BACKEND_URL: "http://172.30.60.1:3210" },
      timeoutMs: 60_000,
      killGraceMs: 50,
      opTimeoutMs: 100,
      maxCaptureBytes: 1024 * 1024,
      rawLog: join(out, "probe.jsonl"),
      stderrLog: join(out, "stderr.txt"),
    },
    probeCommand: ["powershell", "-File", "C:\\config\\cg-al-probe.ps1"],
    out,
    collect: () =>
      markerAwareCollector()(
        join(t.env.privateRoot, "results", "harness", EGRESS_MARKER),
      ),
  });
}

Deno.test("qualification probe (M5-08a): a stuck rm -f runs only after the token is revoked and the proxy is down; secrets kept; fail closed", async () => {
  await using t = await makeEnv();
  const eg = fakeEgress();
  t.docker.waitForReady = true;
  let secrets = "";
  t.docker.behavior = (call) => {
    secrets = call.mounts.get("C:\\cg-secrets")!.src;
    t.docker.lingering.add(call.name);
    return Promise.resolve(0);
  };
  // M5-08b: a real grant, so the cutoff is the backend refusing the token.
  const id = "exec-probe-stuck";
  const token = await probeGrant(t, id);
  assert(await probeTokenValid(t, id, token), "valid before the teardown");
  const rm = t.docker.rm.bind(t.docker);
  t.docker.rm = async (n) => {
    eg.events.push(
      `rm; token ${await probeTokenValid(t, id, token) ? "valid" : "401"}`,
    );
    return await rm(n);
  };
  await assertRejects(
    () => probeWith(t, eg, "stuck", { token }),
    ContainerError,
    "teardown not confirmed",
  );
  const cut = Math.max(
    eg.events.indexOf("revoke"),
    eg.events.indexOf("proxy down"),
  );
  assert(cut >= 0, eg.events.join(","));
  assertEquals(eg.events.slice(cut + 1), Array(5).fill("rm; token 401"));
  assertEquals(await probeTokenValid(t, id, token), false);
  assert(await exists(secrets), "never pulled from under a live sandbox");
  t.docker.lingering.clear();
  await Deno.remove(secrets, { recursive: true });
});

Deno.test({
  name:
    "qualification probe (M5-08a): a held secrets dir (os error 32) after the sandbox is gone fails closed with the reason",
  ignore: Deno.build.os !== "windows",
  async fn() {
    await using t = await makeEnv();
    const eg = fakeEgress();
    t.docker.waitForReady = true;
    let release: (() => Promise<void>) | null = null;
    let secrets = "";
    t.docker.behavior = async (call) => {
      secrets = call.mounts.get("C:\\cg-secrets")!.src;
      release = await holdExclusive(join(secrets, "backend-token"));
      return 0;
    };
    try {
      const err = await assertRejects(
        () => probeWith(t, eg, "held"),
        ContainerError,
        "teardown not confirmed",
      );
      assertStringIncludes(err.message, "os error 32");
      assert(eg.events.includes("revoke"));
    } finally {
      await (release as (() => Promise<void>) | null)?.();
    }
    await Deno.remove(secrets, { recursive: true });
  },
});

Deno.test("qualification probe (M5-08a): a failed token write while the sandbox runs keeps the secrets until the sandbox is gone; the write error is not masked", async () => {
  await using t = await makeEnv();
  const eg = fakeEgress();
  // The planted file must exist before the token write: this image code does
  // not wait for ready (the H-01 fixture default waits, like the entrypoints).
  t.docker.waitForReady = false;
  let secrets = "";
  const seen: string[] = [];
  t.docker.behavior = async (call, io) => {
    secrets = call.mounts.get("C:\\cg-secrets")!.src;
    // Makes the probe's createNew token write fail (AlreadyExists).
    await Deno.writeTextFile(join(secrets, "backend-token"), "planted");
    await io.killed;
    return 137;
  };
  const rm = t.docker.rm.bind(t.docker);
  t.docker.rm = async (n) => {
    seen.push(`rm; secrets ${await exists(secrets)}`);
    return await rm(n);
  };
  await assertRejects(
    () => probeWith(t, eg, "write"),
    Deno.errors.AlreadyExists,
  );
  assert(seen.length > 0 && seen.every((x) => x === "rm; secrets true"));
  assert(!await exists(secrets), "removed after the sandbox is gone");
  assert(eg.events.includes("revoke") && eg.events.includes("proxy down"));
});

for (
  const [how, revoke] of [
    ["throws", () => {
      throw new Error("revoke exploded");
    }],
    ["rejects", () => Promise.reject(new Error("revoke exploded"))],
  ] as [string, () => Promise<unknown>][]
) {
  Deno.test(`qualification probe (M5-08b): a revoke that ${how} is reported, still shuts the proxy and tears the sandbox down, and fails closed`, async () => {
    await using t = await makeEnv();
    const eg = fakeEgress();
    t.docker.waitForReady = true;
    let secrets = "";
    t.docker.behavior = (call) => {
      secrets = call.mounts.get("C:\\cg-secrets")!.src;
      return Promise.resolve(0);
    };
    const err = await assertRejects(
      () => probeWith(t, eg, `revoke-${how}`, { revoke }),
      ContainerError,
      "backend token revoke failed: revoke exploded",
    );
    assertStringIncludes(err.message, "teardown not confirmed");
    assert(eg.events.includes("proxy down"), eg.events.join(","));
    assert(t.docker.removed.length > 0, "the sandbox was torn down");
    assert(secrets !== "" && !await exists(secrets), "secrets removed");
  });
}

// ---- H-01 run 004: image_revision ----

Deno.test("harnessImagesBuild: --revision adds the revision label and the -r tag; without it the frozen tag and no revision label", async () => {
  const root = await Deno.realPath(await testTempDir());
  const docker = new FakeDocker();
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1", "l2"]);
  // H-03: the explicit --version path, on pi (claude-code builds resolve).
  const labels = {
    "centralgauge.harness": "pi",
    "centralgauge.harness.version": "0.87.1",
    "centralgauge.harness.base_digest": baseId,
  };
  const r2 = "centralgauge/harness-pi:0.87.1-r2";
  docker.buildResults.set(r2, {
    id: `sha256:${"c".repeat(64)}`,
    labels: { ...labels, "centralgauge.harness.revision": "2" },
    layers: ["l1", "l2", "l3"],
  });
  const log = stub(console, "log", () => {});
  let f;
  try {
    f = await harnessImagesBuild(
      "pi",
      { root, version: "0.87.1", revision: "2" },
      docker,
    );
  } finally {
    log.restore();
  }
  const args = docker.builds[0]!;
  const li = args.indexOf("centralgauge.harness.revision=2");
  assert(li > 0 && args[li - 1] === "--label", args.join(" "));
  assertEquals(args[args.indexOf("-t") + 1], r2);
  assertEquals(f.revision, "2");

  // No --revision: a NEW version gets the plain <version> tag, no revision label.
  const plainTag = "centralgauge/harness-mock:3";
  docker.buildResults.set(plainTag, {
    id: `sha256:${"d".repeat(64)}`,
    labels: {
      "centralgauge.harness": "mock",
      "centralgauge.harness.version": "3",
      "centralgauge.harness.base_digest": baseId,
    },
    layers: ["l1", "l2", "l3"],
  });
  const log2 = stub(console, "log", () => {});
  try {
    f = await harnessImagesBuild("mock", { root, version: "3" }, docker);
  } finally {
    log2.restore();
  }
  const plain = docker.builds[1]!;
  assertEquals(plain[plain.indexOf("-t") + 1], plainTag);
  assertEquals(
    plain.some((a) => a.startsWith("centralgauge.harness.revision")),
    false,
  );
  assertEquals(f.revision, null);

  // A label that did not land on the image is refused, as is a bad shape.
  docker.buildResults.set("centralgauge/harness-pi:0.87.1-r3", {
    id: `sha256:${"e".repeat(64)}`,
    labels,
    layers: ["l1", "l2", "l3"],
  });
  await assertRejects(
    () =>
      harnessImagesBuild(
        "pi",
        { root, version: "0.87.1", revision: "3" },
        docker,
      ),
    ConfigurationError,
    "revision",
  );
  const n = docker.builds.length;
  for (const bad of ["", "r2", "0"]) {
    await assertRejects(
      () =>
        harnessImagesBuild(
          "pi",
          { root, version: "0.87.1", revision: bad },
          docker,
        ),
      ConfigurationError,
      "revision",
    );
  }
  assertEquals(docker.builds.length, n, "a bad revision builds nothing");
});

Deno.test("CLI: `harness images build --help` lists --revision", async () => {
  const cli = new Command().name("centralgauge").noExit();
  registerHarnessCommand(cli);
  const printed: string[] = [];
  const log = stub(console, "log", (...args: unknown[]) => {
    printed.push(args.join(" "));
  });
  try {
    await cli.parse(["harness", "images", "build", "--help"]);
  } finally {
    log.restore();
  }
  assertStringIncludes(stripAnsiCode(printed.join("\n")), "--revision");
});

// C-03: a judgment corrupted by host memory starvation (execution 3e75f789:
// "build failed: Test (no diagnostics)", 0 tests) is current, so only a
// forced single-execution rejudge with a recorded reason replaces it.

const OOM_REASON = "host OOM during the verdict build (execution 3e75f789)";

/** A campaign whose mock-positive execution carries a newer, current OOM-style fail. */
async function campaignWithOomJudgment(t: TestEnv) {
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await mockExperiment(t);
  await runCampaign(t.env, "contract", {
    dryRun: false,
    concurrency: 1,
    maxPauseMs: 0,
  }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const e = (await t.env.store.executions(c.id)).find((x) =>
    x.arm === "mock-positive"
  )!;
  const [j] = await t.env.store.judgments(e.id);
  assertEquals(j!.verdict, "pass");
  // Run 002: the OOM signature is recorded (0 tests, a build note, no diagnostics).
  const oom = {
    ...j!,
    id: crypto.randomUUID(),
    scorers: j!.scorers.map((s, i) => ({
      ...s,
      passed: i === 0 ? false : s.passed,
      tests: [],
    })),
    verdict: "fail" as const,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  };
  await writeOomLog(t, oom.id, e.id);
  await t.env.store.writeJudgment(oom);
  return { c, e, original: j!, oom };
}

/** The verdict side file of an OOM-starved build (execution 3e75f789's). */
async function writeOomLog(
  t: TestEnv,
  judgmentId: string,
  executionId: string,
) {
  await writeVerdictLog(t.env.resultsRoot, {
    v: 1,
    judgment_id: judgmentId,
    execution_id: executionId,
    violations: [],
    diagnostics: [],
    test_messages: [],
    notes: ["build failed: Test (no diagnostics)"],
    spans: {
      reconstruct_ms: 0,
      compile_ms: 0,
      queue_ms: 0,
      provisioning_ms: 0,
      candidate_publish_ms: 0,
      test_ms: 0,
      total_ms: 0,
    },
    containers: [],
    infra_retries: [],
    per_app_compiles: 0,
    error: null,
  });
}

Deno.test("rejudge --force (C-03): refused without --execution, without a non-blank --reason, and --reason without --force; before the environment opens", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e } = await campaignWithOomJudgment(t);
  const never = () => {
    throw new Error("the environment must not open");
  };
  const refused = async (over: Record<string, unknown>, msg: string) =>
    await assertRejects(
      () => harnessRejudge("contract", runOpts(t, over), never),
      ConfigurationError,
      msg,
    );
  await refused(
    { campaign: c.id, force: true, reason: OOM_REASON },
    "--force needs exactly one --execution",
  );
  await refused(
    { campaign: c.id, execution: e.id, force: true },
    "--force needs a non-blank --reason",
  );
  await refused(
    { campaign: c.id, execution: e.id, force: true, reason: "  \t " },
    "--force needs a non-blank --reason",
  );
  await refused(
    { campaign: c.id, execution: e.id, reason: OOM_REASON },
    "--reason is only for --force",
  );
  // Run 002: --force names the judgment it replaces; --replaces and --basis need --force.
  await refused(
    { campaign: c.id, execution: e.id, force: true, reason: OOM_REASON },
    "--force needs --replaces",
  );
  await refused(
    { campaign: c.id, execution: e.id, replaces: crypto.randomUUID() },
    "--replaces is only for --force",
  );
  await refused(
    { campaign: c.id, execution: e.id, basis: "x.md" },
    "--basis is only for --force",
  );
  assertEquals((await t.env.store.judgments(e.id)).length, 2);
});

Deno.test("rejudge --force (C-03): a non-judgeable execution is refused", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await write(
    t.harnessRoot,
    "experiments/crashy.yml",
    `id: crashy
hypothesis: Mock contract.
primary_metric: pass_rate
baseline: mock-positive
variants: [mock-crash]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: 1
`,
  );
  await runCampaign(t.env, "crashy", {
    dryRun: false,
    concurrency: 1,
    maxPauseMs: 0,
  }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
  const c = (await t.env.store.campaigns("crashy"))[0]!;
  const crash = (await t.env.store.executions(c.id)).find((x) =>
    x.arm === "mock-crash"
  )!;
  await assertRejects(
    () =>
      approved(crash.id, (basis) =>
        harnessRejudge(
          "crashy",
          runOpts(t, {
            campaign: c.id,
            execution: crash.id,
            force: true,
            reason: OOM_REASON,
            replaces: crypto.randomUUID(),
            basis,
          }),
          opener(t),
        )),
    ConfigurationError,
    `execution ${crash.id} is not judgeable`,
  );
  assertEquals((await t.env.store.judgments(crash.id)).length, 0);
});

Deno.test("rejudge --force (C-03): a current judgment gets a second judgment that is latest, carries the reason; the old one stays; the report counts the new verdict", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, original, oom } = await campaignWithOomJudgment(t);
  const load = async () =>
    buildReport(await loadCampaignData(t.env.store, c), {
      resamples: 10,
      seed: 1,
    });
  const cellOf = (r: Awaited<ReturnType<typeof load>>) =>
    r.cells.find((x) => x.used_execution === e.id)!;
  const before = cellOf(await load());
  assertEquals([before.pass, before.judgment_id], [false, oom.id]);
  // The OOM judgment is current: an unforced rejudge has nothing due.
  assertEquals(
    (await harnessRejudge(
      "contract",
      runOpts(t, { campaign: c.id, execution: e.id }),
      opener(t),
    )).rejudged,
    0,
  );
  const r = await approved(e.id, (basis) =>
    harnessRejudge(
      "contract",
      runOpts(t, {
        campaign: c.id,
        execution: e.id,
        force: true,
        reason: OOM_REASON,
        replaces: oom.id,
        basis,
      }),
      opener(t),
    ));
  const basis = await approvedBasis(e.id);
  assertEquals([r.campaignId, r.rejudged], [c.id, 1]);
  const js = await t.env.store.judgments(e.id);
  assertEquals(js.length, 3, "both earlier judgments stay as evidence");
  const ids = js.map((j) => j.id);
  assert(ids.includes(original.id) && ids.includes(oom.id));
  const forced = js.find((j) => j.id !== original.id && j.id !== oom.id)!;
  assertEquals([forced.verdict, forced.forced], ["pass", {
    reason: OOM_REASON,
    replaces: oom.id,
    basis,
  }]);
  assertEquals(original.forced, undefined);
  const report = await load();
  const after = cellOf(report);
  assertEquals([after.status, after.pass, after.judgment_id], [
    "scored",
    true,
    forced.id,
  ]);
  assertEquals(after.forced_rejudges, [{
    judgment_id: forced.id,
    execution_id: e.id,
    reason: OOM_REASON,
    replaces: oom.id,
    basis,
  }]);
  assertEquals(
    report.arms.find((a) => a.arm === "mock-positive")!.scored_cells,
    1,
  );
  const text = stripAnsiCode(renderReport(report));
  assertStringIncludes(text, "Forced rejudges (every one, counted or not):");
  assertStringIncludes(
    text,
    `HX-001 r1 mock-positive: judgment ${forced.id} (counted) replaces ${oom.id}, basis decision approved.md (sha256 ${basis.sha256}; ${APPROVAL}): ${OOM_REASON}`,
  );
});

Deno.test("CLI (C-03): `harness rejudge --force --reason` parses and forwards both", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, oom } = await campaignWithOomJudgment(t);
  const cli = new Command().name("centralgauge").noExit();
  registerHarnessCommand(cli, opener(t));
  const cwd = Deno.cwd();
  const out = capture();
  try {
    Deno.chdir(t.repo.root);
    await approved(e.id, (basis) =>
      cli.parse([
        "harness",
        "rejudge",
        "contract",
        "--campaign",
        c.id,
        "--execution",
        e.id,
        "--force",
        "--reason",
        OOM_REASON,
        "--replaces",
        oom.id,
        "--basis",
        basis,
        "--yes",
        "--secrets-dir",
        t.env.privateRoot,
        "--private-dir",
        t.env.privateRoot,
      ]));
    assertEquals(Deno.exitCode, 0);
  } finally {
    Deno.chdir(cwd);
    out.restore();
    Deno.exitCode = 0;
  }
  const js = await t.env.store.judgments(e.id);
  assertEquals(
    js.filter((j) =>
      j.forced?.reason === OOM_REASON && j.forced.replaces === oom.id &&
      j.forced.basis.path === "approved.md"
    ).length,
    1,
  );
  assertStringIncludes(stripAnsiCode(out.out.join("\n")), `[OK] ${e.id}:`);
});

Deno.test("rejudge --force (C-03 run 002): a forced judgment the report would not select (clock skew) is refused before anything is written", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, oom } = await campaignWithOomJudgment(t);
  // A judgment stamped by a clock ahead of this one stays newest by ended_at.
  const skewed = {
    ...oom,
    id: crypto.randomUUID(),
    started_at: "2999-01-01T00:00:00.000Z",
    ended_at: "2999-01-01T00:00:00.000Z",
  };
  await writeOomLog(t, skewed.id, e.id);
  await t.env.store.writeJudgment(skewed);
  const verdicts = async () => {
    const out: string[] = [];
    for await (const f of Deno.readDir(join(t.env.resultsRoot, "verdicts"))) {
      out.push(f.name);
    }
    return out.sort();
  };
  const logsBefore = await verdicts();
  await assertRejects(
    () =>
      approved(e.id, (basis) =>
        harnessRejudge(
          "contract",
          runOpts(t, {
            campaign: c.id,
            execution: e.id,
            force: true,
            reason: OOM_REASON,
            replaces: skewed.id,
            basis,
          }),
          opener(t),
        )),
    ConfigurationError,
    "would not be the judgment the report selects",
  );
  // Nothing written: no judgment and no verdict side file.
  assertEquals((await t.env.store.judgments(e.id)).length, 3);
  assertEquals(await verdicts(), logsBefore);
  const report = await buildReport(await loadCampaignData(t.env.store, c), {
    resamples: 10,
    seed: 1,
  });
  const cell = report.cells.find((x) => x.used_execution === e.id)!;
  assertEquals([cell.judgment_id, cell.forced_rejudges], [
    skewed.id,
    undefined,
  ]);
});

Deno.test("rejudge --force (C-03 review): refused before writing when the task's current oracle differs from the campaign's", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, oom } = await campaignWithOomJudgment(t);
  const oracle = join(
    t.repo.tasksDir,
    "HX-001",
    "oracle",
    "src",
    "Oracle.Test.al",
  );
  await Deno.writeTextFile(
    oracle,
    (await Deno.readTextFile(oracle)) + "// oracle fix\n",
  );
  await assertRejects(
    () =>
      approved(e.id, (basis) =>
        harnessRejudge(
          "contract",
          runOpts(t, {
            campaign: c.id,
            execution: e.id,
            force: true,
            reason: OOM_REASON,
            replaces: oom.id,
            basis,
          }),
          opener(t),
          () => {
            throw new Error("refused before asking");
          },
        )),
    ConfigurationError,
    "would not be counted by the report",
  );
  assertEquals((await t.env.store.judgments(e.id)).length, 2);
});

Deno.test("rejudge --force (C-03 review): a multi-line --reason is refused before the environment opens", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e } = await campaignWithOomJudgment(t);
  for (const reason of ["one\ntwo", "one\rtwo", "one\r\n"]) {
    await assertRejects(
      () =>
        harnessRejudge(
          "contract",
          runOpts(t, {
            campaign: c.id,
            execution: e.id,
            force: true,
            reason,
            replaces: crypto.randomUUID(),
          }),
          () => {
            throw new Error("the environment must not open");
          },
        ),
      ConfigurationError,
      "--reason must be a single line",
    );
  }
  assertEquals((await t.env.store.judgments(e.id)).length, 2);
});

Deno.test("rejudge --force (C-03 review): the confirmation prompt echoes the scrubbed reason", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, oom } = await campaignWithOomJudgment(t);
  const asked: string[] = [];
  await approved(e.id, (basis) =>
    harnessRejudge(
      "contract",
      runOpts(t, {
        campaign: c.id,
        execution: e.id,
        force: true,
        reason: `OOM, dump in ${t.env.privateRoot}`,
        replaces: oom.id,
        basis,
        yes: false,
      }),
      opener(t),
      (q) => {
        asked.push(q);
        return false;
      },
    ));
  assertEquals(asked.length, 1);
  assertStringIncludes(asked[0]!, "forced: OOM, dump in ");
  assert(!asked[0]!.includes(t.env.privateRoot), asked[0]);
});

Deno.test("CLI (C-03 review): `harness rejudge --force` with --execution twice is rejected by parsing", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e } = await campaignWithOomJudgment(t);
  const cli = new Command().name("centralgauge").noExit();
  registerHarnessCommand(cli, opener(t));
  const cwd = Deno.cwd();
  const out = capture();
  try {
    Deno.chdir(t.repo.root);
    await assertRejects(
      () =>
        cli.parse([
          "harness",
          "rejudge",
          "contract",
          "--campaign",
          c.id,
          "--execution",
          e.id,
          "--execution",
          e.id,
          "--force",
          "--reason",
          OOM_REASON,
          "--replaces",
          crypto.randomUUID(),
          "--yes",
          "--secrets-dir",
          t.env.privateRoot,
          "--private-dir",
          t.env.privateRoot,
        ]),
      Error,
      'Option "--execution" can only occur once',
    );
  } finally {
    Deno.chdir(cwd);
    out.restore();
    Deno.exitCode = 0;
  }
  assertEquals((await t.env.store.judgments(e.id)).length, 2);
});

// C-03 run 002 (review C-03-001): no cherry-picking. One forced rejudge per
// execution, replacing the judgment the report uses, which must carry a
// recorded infra basis (its verdict log's signature or an owner decision).

/** Forced rejudge of `e` in `c` with the OOM reason; `over` adds or replaces options. */
const forceOpts = (
  t: TestEnv,
  c: { id: string },
  e: { id: string },
  over: Record<string, unknown>,
) =>
  runOpts(t, {
    campaign: c.id,
    execution: e.id,
    force: true,
    reason: OOM_REASON,
    ...over,
  });

Deno.test("rejudge --force (C-03 run 002): a second forced rejudge of the same execution is refused, whichever judgment it names", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, oom } = await campaignWithOomJudgment(t);
  await approved(e.id, (basis) =>
    harnessRejudge(
      "contract",
      forceOpts(t, c, e, { replaces: oom.id, basis }),
      opener(t),
    ));
  const js = await t.env.store.judgments(e.id);
  const first = js.find((j) => j.forced)!;
  // The forced one fails too (say a flaky host): no retry until it passes.
  for (const replaces of [first.id, oom.id]) {
    await assertRejects(
      () =>
        approvedRejudge(
          e.id,
          forceOpts(t, c, e, { replaces }),
          opener(t),
          () => {
            throw new Error("refused before asking");
          },
        ),
      ConfigurationError,
      `already has forced judgment ${first.id}`,
    );
  }
  assertEquals((await t.env.store.judgments(e.id)).length, 3);
});

Deno.test("rejudge --force (C-03 run 002): --replaces must name the judgment the report uses for the execution", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, original } = await campaignWithOomJudgment(t);
  for (const replaces of [original.id, crypto.randomUUID()]) {
    await assertRejects(
      () =>
        approvedRejudge(
          e.id,
          forceOpts(t, c, e, { replaces }),
          opener(t),
          () => {
            throw new Error("refused before asking");
          },
        ),
      ConfigurationError,
      `--replaces ${replaces} is not the judgment the report uses`,
    );
  }
  assertEquals((await t.env.store.judgments(e.id)).length, 2);
});

Deno.test("rejudge --force (C-03 run 002): a replaced judgment without an infra signature needs --basis, a file under $CG_COORD_ROOT/decisions", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, oom } = await campaignWithOomJudgment(t);
  // A plain FAIL with a test result and no verdict side file: no signature.
  const plain = {
    ...oom,
    id: crypto.randomUUID(),
    scorers: oom.scorers.map((s, i) =>
      i === 0
        ? {
          ...s,
          tests: [{
            codeunit: 50100,
            procedure: "T",
            target: "candidate",
            outcome: "fail" as const,
            failure: "assertion" as const,
          }],
        }
        : s
    ),
    // Just after the OOM judgment, so it is the one the report uses.
    started_at: new Date(Date.parse(oom.ended_at) + 1).toISOString(),
    ended_at: new Date(Date.parse(oom.ended_at) + 1).toISOString(),
  };
  await t.env.store.writeJudgment(plain);
  const never = () => {
    throw new Error("refused before asking");
  };
  await assertRejects(
    () =>
      harnessRejudge(
        "contract",
        forceOpts(t, c, e, { replaces: plain.id }),
        opener(t),
        never,
      ),
    ConfigurationError,
    "--force needs --basis",
  );
  const root = await testTempDir({ prefix: "coord-" });
  await Deno.mkdir(join(root, "decisions"));
  const decision = join(root, "decisions", "2026-09-28-c03-forced.md");
  await Deno.writeTextFile(decision, approvalText(e.id));
  await Deno.writeTextFile(join(root, "outside.md"), "not a decision\n");
  const prior = Deno.env.get("CG_COORD_ROOT");
  const refused = async (basis: string, msg: string) =>
    await assertRejects(
      () =>
        harnessRejudge(
          "contract",
          forceOpts(t, c, e, { replaces: plain.id, basis }),
          () => {
            throw new Error("the environment must not open");
          },
        ),
      ConfigurationError,
      msg,
    );
  try {
    Deno.env.delete("CG_COORD_ROOT");
    await refused(decision, "--basis needs CG_COORD_ROOT");
    Deno.env.set("CG_COORD_ROOT", root);
    await refused(
      join(root, "decisions", "..", "outside.md"),
      "is not inside",
    );
    await refused(
      join(root, "decisions", "missing.md"),
      "not an existing file",
    );
    await refused(join(root, "decisions"), "not an existing file");
    assertEquals((await t.env.store.judgments(e.id)).length, 3);
    await harnessRejudge(
      "contract",
      forceOpts(t, c, e, { replaces: plain.id, basis: decision }),
      opener(t),
    );
  } finally {
    if (prior === undefined) Deno.env.delete("CG_COORD_ROOT");
    else Deno.env.set("CG_COORD_ROOT", prior);
    await Deno.remove(root, { recursive: true });
  }
  const forced = (await t.env.store.judgments(e.id)).find((j) => j.forced)!;
  assertEquals(forced.forced, {
    reason: OOM_REASON,
    replaces: plain.id,
    basis: {
      kind: "decision",
      path: "2026-09-28-c03-forced.md",
      sha256: await sha256Hex(new TextEncoder().encode(approvalText(e.id))),
      approval: APPROVAL,
    },
  });
});

// C-03 run 003 (review of e8038b3b): the decision basis is pinned by hash and
// names the execution; a relative --basis is under $CG_COORD_ROOT/decisions;
// only the execution a cell counts can be force-rejudged.

/** Runs `f` with CG_COORD_ROOT at a fresh coord root holding `decisions`. */
async function withCoordRoot(
  decisions: Record<string, string>,
  f: (root: string) => Promise<void>,
) {
  const root = await testTempDir({ prefix: "coord-" });
  await Deno.mkdir(join(root, "decisions"));
  for (const [name, text] of Object.entries(decisions)) {
    await Deno.writeTextFile(join(root, "decisions", name), text);
  }
  const prior = Deno.env.get("CG_COORD_ROOT");
  try {
    Deno.env.set("CG_COORD_ROOT", root);
    await f(root);
  } finally {
    if (prior === undefined) Deno.env.delete("CG_COORD_ROOT");
    else Deno.env.set("CG_COORD_ROOT", prior);
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("rejudge --force (C-03 run 003): a relative --basis is under the decisions dir, must name the execution, and is recorded with its sha256", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, oom } = await campaignWithOomJudgment(t);
  const good = approvalText(e.id);
  await withCoordRoot({
    "other.md": approvalText("3e75f789"),
    "c03.md": good,
  }, async () => {
    // The decision must name this execution.
    await assertRejects(
      () =>
        harnessRejudge(
          "contract",
          forceOpts(t, c, e, { replaces: oom.id, basis: "other.md" }),
          () => {
            throw new Error("the environment must not open");
          },
        ),
      ConfigurationError,
      `does not name execution ${e.id}`,
    );
    // Relative to decisions/, not the working directory.
    await harnessRejudge(
      "contract",
      forceOpts(t, c, e, { replaces: oom.id, basis: "c03.md" }),
      opener(t),
    );
  });
  const forced = (await t.env.store.judgments(e.id)).find((j) => j.forced)!;
  assertEquals(forced.forced!.basis, {
    kind: "decision",
    path: "c03.md",
    sha256: await sha256Hex(new TextEncoder().encode(good)),
    approval: APPROVAL,
  });
});

Deno.test("rejudge --force (C-03 run 003): an execution its cell does not count is refused", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, oom } = await campaignWithOomJudgment(t);
  // A manual rerun beside the scored planned result: judged, never counted.
  const rerun = {
    ...e,
    id: crypto.randomUUID(),
    attempt: 2,
    run_kind: "manual_rerun" as const,
    retry_of: null,
  };
  await t.env.store.writeExecution(rerun);
  await t.env.store.writeArtifact({
    ...(await t.env.store.artifact(e.id))!,
    execution_id: rerun.id,
  });
  const rerunOom = { ...oom, id: crypto.randomUUID(), execution_id: rerun.id };
  await writeOomLog(t, rerunOom.id, rerun.id);
  await t.env.store.writeJudgment(rerunOom);
  await assertRejects(
    () =>
      approvedRejudge(
        rerun.id,
        forceOpts(t, c, rerun, { replaces: rerunOom.id }),
        opener(t),
        () => {
          throw new Error("refused before asking");
        },
      ),
    ConfigurationError,
    `execution ${rerun.id} is not the one its cell counts (${e.id})`,
  );
  assertEquals((await t.env.store.judgments(rerun.id)).length, 1);
});

// C-03 run 003 (review C-03-002): --basis is always required and must carry
// an OWNER-APPROVED line; the infra signature is a printed diagnostic only.

const APPROVAL =
  "OWNER-APPROVED: force-rejudge the OOM-starved verdict (2026-09-28T12:00:00Z)";

/** An owner-approved decision naming execution `id`. */
const approvalText = (id: string) =>
  `# Decision\n${APPROVAL}\nExecution ${id}: verdict build starved of host memory.\n`;

/** Runs `f` with CG_COORD_ROOT at a fresh root whose decisions/approved.md approves `id`. */
async function approved<T>(
  id: string,
  f: (basis: string) => Promise<T>,
): Promise<T> {
  let out: T | undefined;
  await withCoordRoot({ "approved.md": approvalText(id) }, async (root) => {
    out = await f(join(root, "decisions", "approved.md"));
  });
  return out as T;
}

/** The basis a forced judgment records for approved(id). */
const approvedBasis = async (id: string) => ({
  kind: "decision" as const,
  path: "approved.md",
  sha256: await sha256Hex(new TextEncoder().encode(approvalText(id))),
  approval: APPROVAL,
});

/** harnessRejudge of "contract" with `opts` plus an approved --basis for `id`. */
const approvedRejudge = (
  id: string,
  opts: ReturnType<typeof forceOpts>,
  open: Parameters<typeof harnessRejudge>[2],
  ask?: (q: string) => boolean,
) =>
  approved(
    id,
    (basis) => harnessRejudge("contract", { ...opts, basis }, open, ask),
  );

Deno.test("rejudge --force (C-03 run 003): --basis is required even when the replaced judgment matches the infra signature", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, oom } = await campaignWithOomJudgment(t);
  await assertRejects(
    () =>
      harnessRejudge(
        "contract",
        forceOpts(t, c, e, { replaces: oom.id }),
        () => {
          throw new Error("the environment must not open");
        },
      ),
    ConfigurationError,
    "--force needs --basis",
  );
  assertEquals((await t.env.store.judgments(e.id)).length, 2);
});

Deno.test("rejudge --force (C-03 run 003): the basis needs an OWNER-APPROVED line with words and an ISO time", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, oom } = await campaignWithOomJudgment(t);
  const named = `Execution ${e.id}.\n`;
  const bad = {
    "none.md": `Owner approved this.\n${named}`,
    "blank.md": `OWNER-APPROVED:  (2026-09-28T12:00:00Z)\n${named}`,
    "empty.md": `OWNER-APPROVED: (2026-09-28T12:00:00Z)\n${named}`,
    "word-time.md": `OWNER-APPROVED: yes (yesterday)\n${named}`,
    "bad-date.md": `OWNER-APPROVED: yes (2026-13-45T12:00:00Z)\n${named}`,
    "no-time.md": `OWNER-APPROVED: yes\n${named}`,
    "indented.md": `  OWNER-APPROVED: yes (2026-09-28T12:00:00Z)\n${named}`,
    "lower.md": `owner-approved: yes (2026-09-28T12:00:00Z)\n${named}`,
  };
  await withCoordRoot(bad, async () => {
    for (const name of Object.keys(bad)) {
      await assertRejects(
        () =>
          harnessRejudge(
            "contract",
            forceOpts(t, c, e, { replaces: oom.id, basis: name }),
            () => {
              throw new Error("the environment must not open");
            },
          ),
        ConfigurationError,
        "has no OWNER-APPROVED",
        name,
      );
    }
  });
  assertEquals((await t.env.store.judgments(e.id)).length, 2);
  // A valid one (offset time, words with parentheses) is accepted and recorded.
  const line =
    "OWNER-APPROVED: ok (host OOM) per Torben (2026-09-28T14:00:00+02:00)";
  const text = `${line}\n${named}`;
  const out = capture();
  try {
    await withCoordRoot({ "ok.md": text }, () =>
      harnessRejudge(
        "contract",
        forceOpts(t, c, e, { replaces: oom.id, basis: "ok.md" }),
        opener(t),
      ).then(() => {}));
  } finally {
    out.restore();
  }
  const forced = (await t.env.store.judgments(e.id)).find((j) => j.forced)!;
  assertEquals(forced.forced!.basis, {
    kind: "decision",
    path: "ok.md",
    sha256: await sha256Hex(new TextEncoder().encode(text)),
    approval: line,
  });
  // The signature is printed as a diagnostic, never as authority.
  assertStringIncludes(
    stripAnsiCode(out.out.join("\n")),
    `[info] replaced judgment ${oom.id} matches infra signature: build_failed_no_diagnostics_no_tests (diagnostic only)`,
  );
});

Deno.test("rejudge --force (C-03 run 003): a replaced judgment without an infra signature prints so and is still accepted on an owner approval", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  const { c, e, oom } = await campaignWithOomJudgment(t);
  // A plain FAIL with no verdict side file: no signature.
  const plain = {
    ...oom,
    id: crypto.randomUUID(),
    started_at: new Date(Date.parse(oom.ended_at) + 1).toISOString(),
    ended_at: new Date(Date.parse(oom.ended_at) + 1).toISOString(),
  };
  await t.env.store.writeJudgment(plain);
  const out = capture();
  try {
    await approvedRejudge(
      e.id,
      forceOpts(t, c, e, { replaces: plain.id }),
      opener(t),
    );
  } finally {
    out.restore();
  }
  assertStringIncludes(
    stripAnsiCode(out.out.join("\n")),
    `[info] replaced judgment ${plain.id}: no infra signature (diagnostic only)`,
  );
  const forced = (await t.env.store.judgments(e.id)).find((j) => j.forced)!;
  assertEquals(forced.forced!.basis, await approvedBasis(e.id));
});

// ---- H-01 run 004 review: an existing tag is never rebuilt ----

Deno.test("harnessImagesBuild: an existing tag (frozen, revised or base) is refused before any build", async () => {
  const root = await Deno.realPath(await testTempDir());
  await Deno.mkdir(join(root, "harness", "images", "base"), {
    recursive: true,
  });
  await Deno.writeTextFile(
    join(root, "harness", "images", "pins.json"),
    JSON.stringify({
      servercore: `mcr.microsoft.com/windows/servercore@sha256:${
        "e".repeat(64)
      }`,
    }),
  );
  await Deno.copyFile(
    AL_TOOLS_DEF,
    join(root, "harness", "images", "base", "al-tools-tools.json"),
  );
  const docker = new FakeDocker();
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1"]);
  for (
    const [tag, harness, version, revision] of [
      ["centralgauge/harness-mock:1", "mock", "1", undefined],
      ["centralgauge/harness-claude-code:2.1.282", "claude-code", "2.1.282"],
      [
        "centralgauge/harness-claude-code:2.1.282-r2",
        "claude-code",
        "2.1.282",
        "2",
      ],
      ["centralgauge/harness-pi:0.87.1", "pi", "0.87.1"],
    ] as [string, string, string, string?][]
  ) {
    docker.addImage(tag, `sha256:${"c".repeat(64)}`, {}, ["l1", "l2"]);
    const err = await assertRejects(
      () =>
        harnessImagesBuild(harness, {
          root,
          version,
          ...(revision ? { revision } : {}),
        }, docker),
      ConfigurationError,
      // H-01 run 005: a frozen tag is refused as frozen before the local check.
      revision ? `${tag} already exists` : `${tag} is a frozen tag`,
    );
    assertStringIncludes(err.message, "--version");
  }
  // The base too: base:2 exists here, so it is not rebuilt.
  await assertRejects(
    () => harnessImagesBuild("base", { root }, docker),
    ConfigurationError,
    `${BASE_IMAGE} already exists`,
  );
  assertEquals(docker.builds, [], "no build call for an existing tag");
});

Deno.test("BASE_IMAGE is base:2; base:1 is frozen", () => {
  assertEquals(BASE_IMAGE, "centralgauge/harness-base:2");
});

// ---- H-01 run 005 (review H-01-004 P1): frozen tags are reserved in code ----

Deno.test("harnessImagesBuild: a frozen tag is refused on a clean host (not present locally), before any build", async () => {
  const root = await Deno.realPath(await testTempDir());
  const docker = new FakeDocker(); // clean host: no image at all
  docker.addImage(BASE_IMAGE, `sha256:${"b".repeat(64)}`, {}, ["l1"]);
  for (
    const [tag, harness, version] of [
      ["centralgauge/harness-mock:1", "mock", "1"],
      ["centralgauge/harness-claude-code:2.1.282", "claude-code", "2.1.282"],
      ["centralgauge/harness-pi:0.87.1", "pi", "0.87.1"],
    ] as [string, string, string][]
  ) {
    assertEquals(await docker.inspectImage(tag), null, tag);
    assert(FROZEN_IMAGE_TAGS.includes(tag), tag);
    await assertRejects(
      () => harnessImagesBuild(harness, { root, version }, docker),
      ConfigurationError,
      `${tag} is a frozen tag`,
    );
  }
  assertEquals(docker.builds, [], "no build call for a frozen tag");
  assertEquals(FROZEN_IMAGE_TAGS, [
    "centralgauge/harness-base:1",
    "centralgauge/harness-mock:1",
    "centralgauge/harness-claude-code:2.1.282",
    "centralgauge/harness-pi:0.87.1",
  ]);
  assert(!FROZEN_IMAGE_TAGS.includes(BASE_IMAGE));
  // Resolution for old records is unchanged: no revision is the frozen tag.
  assertEquals(
    imageTag("claude-code", "2.1.282"),
    "centralgauge/harness-claude-code:2.1.282",
  );
});

// ---- M11-11: `harness report` of a pre-registered campaign ----

import { stringify } from "@std/yaml";
import {
  ExperimentSchema,
  loadExperiment,
} from "../../../../src/harness/config.ts";
import { hashFile } from "../../../../src/harness/hash.ts";
import {
  PreregSchema,
  protocolSha,
  verifyPrereg,
} from "../../../../src/harness/prereg.ts";
import { experimentHash } from "../../../../src/harness/records.ts";
import { telemetry } from "../../harness/fixtures.ts";

const RP_REL = "preregistration/skills-vs-plain.yml";
const RP_CONTRAST = {
  id: "C1",
  name: "skills against plain",
  baseline: "plain",
  variant: "skills",
};
const RP_A = {
  v: 1,
  experiment: "skills-vs-plain",
  protocol: {
    arms: ["plain", "skills"],
    contrasts: [RP_CONTRAST],
    interaction: null,
  },
  approval: "OWNER-APPROVED: stage A (2026-10-21T12:00:00Z)",
  population: "The two fixture tasks.",
  primary_metric: "cost_per_solved_task",
  confirmatory: true,
  family: ["C1"],
  alpha: 0.05,
  test: {
    sides: "two",
    p_value: "bootstrap-t",
    adjustment: "holm",
    direction: "sign_of_delta",
  },
  intervals: {
    reported: "per_contrast_unadjusted",
    beside: "bonferroni_same_draws",
  },
  bootstrap: { unit: "task", resamples: 1000, seed: 1, level: 0.95 },
  zero_solve: { rule: "suppress_any_undefined" },
  missing_pairs: "per_contrast_matched",
  held_out: {
    count: 1,
    rule: "one task held out",
    seal: "harness-v2-screen-start",
    tasks: ["HX-002"],
    in_family: false,
  },
  measures: {
    fingerprint: "f".repeat(64),
    unknown_symbol_codes: ["AL0118"],
    ruleset_sha256: "d".repeat(64),
    canary_codes: ["AA0137"],
    workflow_execution: "used_execution",
    effort_execution: "every_attempt",
  },
  exploratory_metrics: ["pass_rate"],
  simulation: { script_sha256: "1".repeat(64), args: { sims: 10 } },
  design_rule: "the frozen rule",
  stage_a: null,
  experiment_hash: null,
  selection: null,
  design: null,
  power_simulation: null,
  compiler_identity: null,
  stage_b_approval: null,
  amendments: [],
};

async function gitOut(root: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout).trim();
}

/**
 * A git repo holding the stage-A file (tagged harness-v2-prereg-a) and the
 * frozen stage-B file (tagged harness-v2-prereg-b), both decision files, and
 * a results store with the campaign bound to them, HX-001 selected and
 * HX-002 held out, every cell passing (plain $2, skills $1).
 */
async function preregReportEnv(
  metric: "cost_per_solved_task" | "pass_rate" = "cost_per_solved_task",
) {
  const root = await testTempDir();
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "t@example.com");
  await git(root, "config", "user.name", "t");
  await git(root, "config", "core.autocrlf", "false");
  const approved = await protocolSha(PreregSchema.parse(RP_A));
  await write(root, `harness/${RP_REL}`, stringify(RP_A));
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "stage A");
  await git(
    root,
    "tag",
    "-a",
    "harness-v2-prereg-a",
    "-m",
    `protocol_sha256: ${approved}`,
  );
  const experiment = ExperimentSchema.parse({
    id: "skills-vs-plain",
    hypothesis: "Skills cut cost per solved task.",
    primary_metric: metric,
    baseline: "plain",
    variants: ["skills"],
    vary: ["skills"],
    tasks: "harness-tasks/tasks/*",
    repeats: 1,
    contrasts: [RP_CONTRAST],
    preregistration: RP_REL,
  });
  const c0 = await campaign({ experiment });
  const selPath = "harness-tasks/v2/selection.json";
  await write(
    root,
    selPath,
    JSON.stringify({
      v: 1,
      status: "ok",
      held_out: ["HX-002"],
      selection: { n: 1, selected: ["HX-001"] },
    }),
  );
  const simPath = `harness/preregistration/skills-vs-plain.sim-b.json`;
  await write(
    root,
    simPath,
    JSON.stringify({
      ...RP_A.simulation,
      zero_solve: RP_A.zero_solve,
      decision: { design: { tasks: 1, repeats: 1 } },
    }),
  );
  const selSha = await hashFile(root, join(root, selPath));
  const text = stringify({
    ...RP_A,
    stage_a: { sha256: approved },
    experiment_hash: await experimentHash(experiment),
    selection: {
      path: selPath,
      sha256: selSha,
      selected: ["HX-001"],
      held_out: ["HX-002"],
    },
    design: { tasks: 1, repeats: 1 },
    power_simulation: {
      inputs: [{ path: selPath, sha256: selSha }],
      output: {
        path: simPath,
        sha256: await hashFile(root, join(root, simPath)),
      },
    },
    compiler_identity: "artifact|bccontainerhelper 6.1.14",
    stage_b_approval: "OWNER-APPROVED: stage B (2026-10-29T12:00:00Z)",
  });
  await write(root, `harness/${RP_REL}`, text);
  const bSha = await sha256Hex(new TextEncoder().encode(text));
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "stage B");
  await git(
    root,
    "tag",
    "-a",
    "harness-v2-prereg-b",
    "-m",
    `stage_b_sha256: ${bSha}`,
  );
  const decisions = await testTempDir();
  const decisionA = join(decisions, "decision-a.md");
  await Deno.writeTextFile(
    decisionA,
    `protocol_sha256: ${approved}\nfile_sha256: ${
      "f".repeat(64)
    }\ntag: harness-v2-prereg-a\ntag_object: ${await gitOut(
      root,
      "rev-parse",
      "harness-v2-prereg-a",
    )}\nOWNER-APPROVED: stage A (2026-10-24T12:00:00Z)\n`,
  );
  const decisionB = join(decisions, "decision-b.md");
  await Deno.writeTextFile(
    decisionB,
    `stage_b_sha256: ${bSha}\ntag: harness-v2-prereg-b\ntag_object: ${await gitOut(
      root,
      "rev-parse",
      "harness-v2-prereg-b",
    )}\nOWNER-APPROVED: stage B (2026-11-06T12:00:00Z)\n`,
  );
  const v = await verifyPrereg(
    root,
    join(root, "harness"),
    experiment,
    c0.experiment_hash,
    c0.task_set.tasks.map((t) => t.id),
    decisionA,
    decisionB,
  );
  assertEquals(
    v.problems,
    metric === "pass_rate"
      ? [
        "experiment primary_metric pass_rate does not match the pre-registration's primary_metric cost_per_solved_task",
      ]
      : [],
  );
  const c = {
    ...c0,
    preregistration: {
      path: RP_REL,
      sha256: v.sha256,
      protocol_sha256: v.protocol_sha256,
      decision_sha256: v.decision_sha256,
      stage_b_decision_sha256: v.stage_b_decision_sha256,
    },
  };
  const results = await testTempDir();
  const store = new RecordStore(results);
  await store.writeCampaign(c);
  for (const arm of ["plain", "skills"]) {
    for (const task of ["HX-001", "HX-002"]) {
      const e = execution(c, { arm, task }, {
        telemetry: telemetry(arm === "plain" ? 2 : 1),
      });
      await store.writeExecution(e);
      await store.writeJudgment(judgment(c, e, true));
    }
  }
  const opts = {
    resultsDir: results,
    resamples: 10,
    seed: 1,
    judging: "campaign" as const,
    root,
    preregDecision: decisionA,
    preregBDecision: decisionB,
  };
  return { root, results, decisionA, decisionB, opts };
}

Deno.test("harnessReport (M11-11): a pre-registered campaign reports C1 over the selected task, held-out apart", async () => {
  const p = await preregReportEnv();
  const r = await harnessReport("skills-vs-plain", p.opts);
  const k = r.confirmatory;
  assert(k && !("withheld" in k));
  assertEquals(k.tasks, ["HX-001"]);
  assertEquals(k.held_out.tasks, ["HX-002"]);
  assertEquals(k.bootstrap.resamples, 1000);
  assertEquals(k.results.map((x) => [x.id, x.confirmatory, x.delta]), [
    ["C1", true, -1],
  ]);
  assert(r.comparisons.every((x) => x.label === "exploratory"));
});

Deno.test("harnessReport (M11-11): both decision files are required with a preregistration", async () => {
  const p = await preregReportEnv();
  for (
    const [drop, flag] of [
      ["preregDecision", "--prereg-decision"],
      ["preregBDecision", "--prereg-b-decision"],
    ] as const
  ) {
    await assertRejects(
      () => harnessReport("skills-vs-plain", { ...p.opts, [drop]: undefined }),
      ConfigurationError,
      flag,
    );
  }
});

Deno.test("harnessReport (M11-11): an edited pre-registration or decision file is refused", async () => {
  const p = await preregReportEnv();
  const file = join(p.root, "harness", RP_REL);
  for (const path of [file, p.decisionA, p.decisionB]) {
    const original = await Deno.readTextFile(path);
    // Still parseable with the same anchor lines: only the bytes differ.
    await Deno.writeTextFile(path, `# edited\n${original}`);
    await assertRejects(
      () => harnessReport("skills-vs-plain", p.opts),
      ConfigurationError,
      "preregistration changed",
    );
    await Deno.writeTextFile(path, original);
  }
  await harnessReport("skills-vs-plain", p.opts);
});

Deno.test("CLI: `harness report` takes --prereg-decision and --prereg-b-decision", async () => {
  const p = await preregReportEnv();
  const cli = new Command().name("centralgauge");
  registerHarnessCommand(cli);
  const printed: string[] = [];
  const log = stub(console, "log", (...args: unknown[]) => {
    printed.push(args.join(" "));
  });
  try {
    await cli.parse([
      "harness",
      "report",
      "skills-vs-plain",
      "--results-dir",
      p.results,
      "--root",
      p.root,
      "--prereg-decision",
      p.decisionA,
      "--prereg-b-decision",
      p.decisionB,
      "--json",
      "--judging",
      "campaign",
    ]);
  } finally {
    log.restore();
  }
  const report = JSON.parse(printed.join("\n"));
  assertEquals(report.confirmatory.tasks, ["HX-001"]);
  assertEquals(report.confirmatory.results[0].id, "C1");
});

Deno.test("harnessImagesBuild: claude-code carries the LSP label from al-lsp.json; the built image must show it", async () => {
  const root = await Deno.realPath(await testTempDir());
  const docker = new FakeDocker();
  await Deno.mkdir(join(root, "harness", "images", "claude-code", "lsp"), {
    recursive: true,
  });
  await Deno.copyFile(AL_LSP_DEF, join(root, AL_LSP_DEF));
  const [lk, lv] = (await lspLabel(root))!;
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1"]);
  // H-03: the resolved Claude Code version names the tag; the alias rides along.
  const tag = imageTag("claude-code", CC_REL.version, "3");
  const alias = imageTag("claude-code", "latest", "3");
  const id = `sha256:${"c".repeat(64)}`;
  const labels = {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.base_digest": baseId,
    "centralgauge.harness.revision": "3",
    ...ccLabels(),
  };
  // An existing tag is refused: each build starts with no tag and produces it.
  docker.buildResults.set(tag, { id, labels, layers: ["l1", "l2"] });
  docker.shipFile(id, CLAUDE_CODE_RESOLVED, ccResolvedJson());
  const o = {
    root,
    revision: "3",
    publishLockDir: join(root, "publish-lock"),
  };
  // M10-10 fixture: the GitHub API is injected (never called for real); the
  // built image carries the release labels and resolved file.
  await assertRejects(
    () => harnessImagesBuild("claude-code", o, docker, ccFetch()),
    ConfigurationError,
    `label ${lk} did not land`,
  );
  const args = docker.builds.at(-1)!;
  const i = args.indexOf(`${lk}=${lv}`);
  // H-03 run 002: a claude-code build is untagged (--iidfile), tagged after.
  assert(i > 0 && args[i - 1] === "--label" && i < args.indexOf("--iidfile"));
  docker.tags.delete(tag);
  docker.tags.delete(alias);
  docker.buildResults.set(tag, {
    id,
    labels: { ...labels, [lk]: lv, ...lspReleaseLabels() },
    layers: ["l1", "l2"],
  });
  docker.shipFile(id, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
  docker.shipFile(id, AL_LSP_RESOLVED, lspResolvedJson());
  assertEquals(
    (await harnessImagesBuild("claude-code", o, docker, ccFetch())).lsp
      ?.["al"]
      ?.tool_schema_hash,
    lv.split(" ")[1],
  );
});

Deno.test("harnessCell: a stub cell's --image is the image runtimeFacts reads (dev-tag LSP proofs)", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  await Deno.mkdir(
    join(t.repo.root, "harness", "images", "claude-code", "lsp"),
    { recursive: true },
  );
  await Deno.copyFile(AL_LSP_DEF, join(t.repo.root, AL_LSP_DEF));
  await Deno.writeTextFile(
    join(t.repo.root, "harness", "configs", "cc-dev-lsp.yml"),
    'id: cc-dev-lsp\nharness: claude-code\nharness_version: "2.1.282"\nimage_revision: "2"\nmodels: { main: anthropic/claude-sonnet-5 }\nsettings: {}\ncomponents: { lsp: [al] }\nlimits: { timeout_min: 30, max_budget_usd: 5 }\n',
  );
  const dev = `sha256:${"7".repeat(64)}`;
  const [lk, lv] = (await lspLabel(t.repo.root))!;
  t.docker.addImage(dev, dev, {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.version": "2.1.282",
    "centralgauge.harness.base_digest": `sha256:${"b".repeat(64)}`,
    "centralgauge.harness.revision": "2",
    [lk]: lv,
    ...lspReleaseLabels(), // M10-10 fixture
  });
  t.docker.shipFile(dev, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
  t.docker.shipFile(dev, AL_LSP_RESOLVED, lspResolvedJson());
  const results = join(t.repo.root, "results", "harness");
  const base = {
    resultsDir: results,
    supervised: false,
    stubProvider: await scenarioFile(t),
  };
  // The config's own tag has no LSP label: without --image the arm is refused.
  await assertRejects(
    () =>
      harnessCell(
        "cc-dev-lsp",
        "HX-001",
        cellOpts(t, base),
        rootedOpener(t),
        () => false,
        noInterrupt,
      ),
    ConfigurationError,
  );
  const r = await harnessCell(
    "cc-dev-lsp",
    "HX-001",
    cellOpts(t, { ...base, image: dev }),
    rootedOpener(t),
    () => false,
    noInterrupt,
  );
  assertEquals(r.executions.length, 1);
});

Deno.test("runCampaign: an LSP arm resolves when the image label matches the repo definition and is refused when it does not", async () => {
  await using t = await makeEnv();
  t.env.supervised = false;
  await Deno.mkdir(
    join(t.repo.root, "harness", "images", "claude-code", "lsp"),
    { recursive: true },
  );
  await Deno.copyFile(AL_LSP_DEF, join(t.repo.root, AL_LSP_DEF));
  for (
    const [id, variant] of [["mock-lsp-a", "positive"], [
      "mock-lsp-b",
      "naive:a",
    ]]
  ) {
    await write(
      t.harnessRoot,
      `configs/${id}.yml`,
      `id: ${id}\nharness: mock\nharness_version: "2"\nmodels: {}\nsettings: { mode: apply, variant: "${variant}" }\ncomponents: { lsp: [al] }\nlimits: { timeout_min: 5, max_budget_usd: 1 }\n`,
    );
  }
  await write(
    t.harnessRoot,
    "experiments/lsp.yml",
    `id: lsp\nhypothesis: LSP arm.\nprimary_metric: pass_rate\nbaseline: mock-lsp-a\nvariants: [mock-lsp-b]\nvary: [settings]\ntasks: "harness-tasks/tasks/*"\nrepeats: 1\n`,
  );
  const [lk, lv] = (await lspLabel(t.repo.root))!;
  const mockImage = (label: string) =>
    t.docker.addImage(imageTag("mock", "2"), `sha256:${"a".repeat(64)}`, {
      "centralgauge.harness": "mock",
      "centralgauge.harness.version": "2",
      "centralgauge.harness.base_digest": `sha256:${"b".repeat(64)}`,
      [lk]: label,
    });
  const run = () =>
    runCampaign(
      t.env,
      "lsp",
      { dryRun: true, concurrency: 1, maxPauseMs: 0 },
      { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG },
    );
  mockImage(lv);
  assertEquals((await run()).planned, 2);
  mockImage(`${lv.split(" ")[0]} ${"e".repeat(64)}`);
  await assertRejects(run, ConfigurationError, "differs from image");
  // A version-only difference (correct hash) is refused too.
  mockImage(`al-lsp@999 ${lv.split(" ")[1]}`);
  await assertRejects(run, ConfigurationError, "al-lsp@999");
});

Deno.test("harnessCell: a stub cell's --image whose LSP label has the right hash but a wrong version is refused", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  await Deno.mkdir(
    join(t.repo.root, "harness", "images", "claude-code", "lsp"),
    { recursive: true },
  );
  await Deno.copyFile(AL_LSP_DEF, join(t.repo.root, AL_LSP_DEF));
  await Deno.writeTextFile(
    join(t.repo.root, "harness", "configs", "cc-dev-lsp.yml"),
    'id: cc-dev-lsp\nharness: claude-code\nharness_version: "2.1.282"\nimage_revision: "2"\nmodels: { main: anthropic/claude-sonnet-5 }\nsettings: {}\ncomponents: { lsp: [al] }\nlimits: { timeout_min: 30, max_budget_usd: 5 }\n',
  );
  const dev = `sha256:${"7".repeat(64)}`;
  const [lk, lv] = (await lspLabel(t.repo.root))!;
  t.docker.addImage(dev, dev, {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.version": "2.1.282",
    "centralgauge.harness.base_digest": `sha256:${"b".repeat(64)}`,
    "centralgauge.harness.revision": "2",
    [lk]: `al-lsp@999 ${lv.split(" ")[1]}`,
  });
  t.docker.shipFile(dev, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
  await assertRejects(
    async () =>
      await harnessCell(
        "cc-dev-lsp",
        "HX-001",
        cellOpts(t, {
          resultsDir: join(t.repo.root, "results", "harness"),
          supervised: false,
          stubProvider: await scenarioFile(t),
          image: dev,
        }),
        rootedOpener(t),
        () => false,
        noInterrupt,
      ),
    ConfigurationError,
    "al-lsp@999",
  );
});

// M7-01: the CLI runs the same placedConcurrencyProblem gate as runCampaign.
Deno.test("run --concurrency 2 (M7-01): the up-front gate allows an authorized marker with exact proxy_isolation, and names every other failing condition before any environment opens", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  await mockExperiment(t);
  const shared = join(t.repo.root, "results", "harness");
  await Deno.mkdir(shared, { recursive: true });
  const never = () => Promise.reject(new Error("no environment may open"));
  const run = (concurrency: number, marker: string) =>
    Deno.writeTextFile(join(shared, EGRESS_MARKER), marker).then(() =>
      harnessRun("contract", runOpts(t, { concurrency }), never, never)
    );
  const authorized = markerWith("authorized", PROXY_ISOLATION);
  // Allowed: it gets as far as opening the environment (which the test refuses).
  const opened = await assertRejects(
    () => run(2, authorized),
    Error,
    "no environment may open",
  );
  assertEquals(opened instanceof ConfigurationError, false);
  const refused = async (concurrency: number, marker: string) =>
    (await assertRejects(
      () => run(concurrency, marker),
      ConfigurationError,
      "--concurrency",
    )).message;
  assertStringIncludes(
    await refused(3, authorized),
    "exceeds the placed maximum 2",
  );
  assertStringIncludes(
    await refused(2, markerWith("qualified", PROXY_ISOLATION)),
    "not enforced",
  );
  assertStringIncludes(
    await refused(2, markerWith("authorized", 1)),
    "proxy_isolation 1",
  );
  // An arm on the frozen mock image (version 1, no revision) is refused.
  for (
    const [id, variant] of [["mock-positive", "positive"], [
      "mock-naive-a",
      "naive:a",
    ]]
  ) {
    await write(
      t.harnessRoot,
      `configs/${id}.yml`,
      `id: ${id}\nharness: mock\nharness_version: "1"\nmodels: {}\nsettings: { mode: apply, variant: "${variant}" }\nlimits: { timeout_min: 5, max_budget_usd: 1 }\n`,
    );
  }
  assertStringIncludes(await refused(2, authorized), "arm mock-");
});

Deno.test("openHarnessEnv concurrency 2 (M7-01): the same gate runs under the lock, before any sweep", async () => {
  await using t = await makeEnv();
  const shared = join(t.repo.root, "results", "harness");
  await Deno.mkdir(shared, { recursive: true });
  const refused = async (marker: string, concurrency: number) => {
    await Deno.writeTextFile(join(shared, EGRESS_MARKER), marker);
    const order: string[] = [];
    const msg = (await assertRejects(
      () =>
        openHarnessEnv(
          { ...envOpts(t), concurrency },
          deps(order, undefined, () => Promise.resolve([])),
        ),
      ConfigurationError,
      "--concurrency",
    )).message;
    assertEquals(order, ["lock", "release"], marker);
    return msg;
  };
  assertStringIncludes(
    await refused(markerWith("qualified", PROXY_ISOLATION), 2),
    "not enforced",
  );
  assertStringIncludes(
    await refused(markerWith("authorized", PROXY_ISOLATION), 3),
    "exceeds the placed maximum 2",
  );
});

import { HarnessConfigSchema } from "../../../../src/harness/config.ts";
const armOf = (harness: string, version: string, revision?: string) =>
  HarnessConfigSchema.parse({
    id: `${harness}-arm`,
    harness,
    harness_version: version,
    ...(revision ? { image_revision: revision } : {}),
    models: harness === "mock" ? {} : { main: "anthropic/claude-sonnet-5" },
    limits: { timeout_min: 5, max_budget_usd: 1 },
  });

Deno.test("openHarnessEnv concurrency 2 (M7-01 review): the full gate, arms included, runs under the lock before any sweep; absent configs fail closed; an authorized marker that fails host verification still stops the start", async () => {
  await using t = await makeEnv();
  const shared = join(t.repo.root, "results", "harness");
  await Deno.mkdir(shared, { recursive: true });
  await Deno.writeTextFile(
    join(shared, EGRESS_MARKER),
    markerWith("authorized", PROXY_ISOLATION),
  );
  const refused = async (configs: ReturnType<typeof armOf>[] | undefined) => {
    const order: string[] = [];
    const msg = (await assertRejects(
      () =>
        openHarnessEnv(
          {
            ...envOpts(t),
            concurrency: 2,
            ...(configs ? { configs } : {}),
          },
          deps(order, undefined, () => Promise.resolve([])),
        ),
      ConfigurationError,
    )).message;
    assertEquals(order, ["lock", "release"], msg);
    return msg;
  };
  // A frozen-image arm: refused by the arm check, naming the arm.
  assertStringIncludes(
    await refused([armOf("claude-code", "2.1.282")]),
    "arm claude-code-arm",
  );
  // No configs at all: fail closed.
  assertStringIncludes(await refused(undefined), "arm images unknown");
  // Every condition holds: the up-front gate passes, then the marker's own
  // evidence (absent here) fails host verification, still before any sweep.
  assertStringIncludes(
    await refused([armOf("mock", "2")]),
    "not authorized, refusing to run",
  );
});

Deno.test("run --dry-run --concurrency 2 (M7-01 run 002): the plan environment carries the verified gate inputs, so a valid dry run and a resume plan, and unmet conditions still refuse", async () => {
  await using t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await writeCatalog(t);
  await mockExperiment(t);
  const never = () =>
    Promise.reject(new Error("a dry run opens no environment"));
  const quiet = stub(console, "log", () => {});
  try {
    const shared = join(t.repo.root, "results", "harness");
    await authorizedRoot(t.repo.root);
    const markerPath = join(shared, EGRESS_MARKER);
    const marked = JSON.parse(await Deno.readTextFile(markerPath));
    const setMarker = (patch: Record<string, unknown>) =>
      Deno.writeTextFile(markerPath, JSON.stringify({ ...marked, ...patch }));
    const planner = (verify: () => Promise<string[]>) =>
    (
      eo: Parameters<typeof openPlanEnv>[0],
    ) => openPlanEnv(eo, planDeps(t, [], verify));
    const verified = (): Promise<string[]> => Promise.resolve([]);
    const dry = (
      over: Record<string, unknown>,
      verify = verified,
    ) =>
      harnessRun(
        "contract",
        runOpts(t, { dryRun: true, concurrency: 2, ...over }),
        never,
        planner(verify),
      );
    await setMarker({ proxy_isolation: PROXY_ISOLATION });
    // New campaign, every condition met, planned before it exists: no id.
    const planned = await dry({});
    assertEquals([planned.planned, planned.campaignId], [2, null]);
    // A first campaign at concurrency 1, to resume below.
    const first = await harnessRun("contract", runOpts(t), opener(t));
    const resumed = await dry({ campaign: first.campaignId });
    assertEquals(resumed.campaignId, first.campaignId);
    // Wrong or missing proxy_isolation, N=3, not enforced, unverifiable.
    await setMarker({ proxy_isolation: 1 });
    await assertRejects(() => dry({}), ConfigurationError, "proxy_isolation 1");
    await setMarker({ proxy_isolation: PROXY_ISOLATION });
    await assertRejects(
      () => dry({ concurrency: 3 }),
      ConfigurationError,
      "exceeds the placed maximum 2",
    );
    await assertRejects(
      () => dry({}, () => Promise.resolve(["proxy not running"])),
      ConfigurationError,
    );
    await setMarker({ state: "qualified" });
    await assertRejects(
      () => dry({ campaign: first.campaignId }),
      ConfigurationError,
      "not enforced",
    );
  } finally {
    quiet.restore();
  }
});

Deno.test("CLI: `harness report` refuses an experiment whose primary_metric differs from the preregistration's (M11-10c)", async () => {
  const p = await preregReportEnv("pass_rate");
  const cli = new Command().name("centralgauge");
  registerHarnessCommand(cli);
  const c = capture();
  try {
    await cli.parse([
      "harness",
      "report",
      "skills-vs-plain",
      "--results-dir",
      p.results,
      "--root",
      p.root,
      "--prereg-decision",
      p.decisionA,
      "--prereg-b-decision",
      p.decisionB,
      "--json",
      "--judging",
      "campaign",
    ]);
    assertEquals(Deno.exitCode, 1);
  } finally {
    c.restore();
    Deno.exitCode = 0;
  }
  assertStringIncludes(
    stripAnsiCode(c.err.join("\n")),
    "experiment primary_metric pass_rate does not match the pre-registration's primary_metric cost_per_solved_task",
  );
});

Deno.test("CLI: `harness run` refuses a campaign start whose experiment primary_metric differs from the preregistration's (M11-10c)", async () => {
  await using t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await writeCatalog(t);
  const rel = "preregistration/prereg.yml";
  const contrast = {
    id: "C1",
    name: "naive against positive",
    baseline: "mock-positive",
    variant: "mock-naive-a",
  };
  await write(
    t.harnessRoot,
    "experiments/prereg.yml",
    `id: prereg
hypothesis: Mock contract.
primary_metric: pass_rate
baseline: mock-positive
variants: [mock-naive-a]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: 1
contrasts:
  - ${JSON.stringify(contrast)}
preregistration: ${rel}
`,
  );
  const stageA = {
    ...RP_A,
    experiment: "prereg",
    protocol: {
      arms: ["mock-positive", "mock-naive-a"],
      contrasts: [contrast],
      interaction: null,
    },
    held_out: { ...RP_A.held_out, count: 0, tasks: [] },
  };
  const approved = await protocolSha(PreregSchema.parse(stageA));
  const commitTag = async (tag: string, line: string) => {
    await git(t.repo.root, "add", "harness", "harness-tasks");
    await git(t.repo.root, "commit", "-q", "-m", tag);
    await git(t.repo.root, "tag", "-a", tag, "-m", line);
    return await gitOut(t.repo.root, "rev-parse", tag);
  };
  await write(t.harnessRoot, rel, stringify(stageA));
  const tagA = await commitTag(
    "harness-v2-prereg-a",
    `protocol_sha256: ${approved}`,
  );
  const selPath = "harness-tasks/v2/selection.json";
  await write(
    t.repo.root,
    selPath,
    JSON.stringify({
      v: 1,
      status: "ok",
      held_out: [],
      selection: { n: 1, selected: ["HX-001"] },
    }),
  );
  const simPath = "harness/preregistration/prereg.sim-b.json";
  await write(
    t.repo.root,
    simPath,
    JSON.stringify({
      ...stageA.simulation,
      zero_solve: stageA.zero_solve,
      decision: { design: { tasks: 1, repeats: 1 } },
    }),
  );
  const selSha = await hashFile(t.repo.root, join(t.repo.root, selPath));
  const { experiment } = await loadExperiment(t.harnessRoot, "prereg");
  const text = stringify({
    ...stageA,
    stage_a: { sha256: approved },
    experiment_hash: await experimentHash(experiment),
    selection: {
      path: selPath,
      sha256: selSha,
      selected: ["HX-001"],
      held_out: [],
    },
    design: { tasks: 1, repeats: 1 },
    power_simulation: {
      inputs: [{ path: selPath, sha256: selSha }],
      output: {
        path: simPath,
        sha256: await hashFile(t.repo.root, join(t.repo.root, simPath)),
      },
    },
    compiler_identity: "artifact|bccontainerhelper 6.1.14",
    stage_b_approval: "OWNER-APPROVED: stage B (2026-10-29T12:00:00Z)",
  });
  await write(t.harnessRoot, rel, text);
  const bSha = await sha256Hex(new TextEncoder().encode(text));
  const tagB = await commitTag(
    "harness-v2-prereg-b",
    `stage_b_sha256: ${bSha}`,
  );
  const decisions = await testTempDir();
  const decisionA = join(decisions, "decision-a.md");
  await Deno.writeTextFile(
    decisionA,
    `protocol_sha256: ${approved}\nfile_sha256: ${
      "f".repeat(64)
    }\ntag: harness-v2-prereg-a\ntag_object: ${tagA}\nOWNER-APPROVED: stage A (2026-10-24T12:00:00Z)\n`,
  );
  const decisionB = join(decisions, "decision-b.md");
  await Deno.writeTextFile(
    decisionB,
    `stage_b_sha256: ${bSha}\ntag: harness-v2-prereg-b\ntag_object: ${tagB}\nOWNER-APPROVED: stage B (2026-11-06T12:00:00Z)\n`,
  );
  const cli = new Command().name("centralgauge").noExit();
  registerHarnessCommand(cli, opener(t));
  const runs = t.docker.runs.length;
  const cwd = Deno.cwd();
  const c = capture();
  try {
    Deno.chdir(t.repo.root);
    await cli.parse([
      "harness",
      "run",
      "prereg",
      "--prereg-decision",
      decisionA,
      "--prereg-b-decision",
      decisionB,
      "--secrets-dir",
      t.env.privateRoot,
      "--private-dir",
      t.env.privateRoot,
    ]);
    assertEquals(Deno.exitCode, 1);
  } finally {
    Deno.chdir(cwd);
    c.restore();
    Deno.exitCode = 0;
  }
  assertStringIncludes(
    stripAnsiCode(c.err.join("\n")),
    "experiment primary_metric pass_rate does not match the pre-registration's primary_metric cost_per_solved_task",
  );
  assertEquals(await t.env.store.campaigns("prereg"), []);
  assertEquals(t.docker.runs.length, runs);
});

Deno.test("harnessReport (M11-12): a pre-registered campaign reads measure records of the pre-registered fingerprint, not the current one", async () => {
  const p = await preregReportEnv();
  const store = new RecordStore(p.results);
  const c = (await store.campaigns("skills-vs-plain"))[0]!;
  const e = (await store.executions(c.id)).find((x) =>
    x.arm === "plain" && x.task_id === "HX-001"
  )!;
  const [j] = await store.judgments(e.id);
  // The pre-registration pins "f"x64, which is not the current fingerprint.
  assertEquals((await measureFingerprint()) === "f".repeat(64), false);
  await writeMeasureRecord(p.results, {
    v: 1,
    judgment_id: j!.id,
    execution_id: e.id,
    task_id: e.task_id,
    workspace_hash: e.workspace_hash!,
    oracle_hash: j!.task_oracle_hash,
    measure_fingerprint: "f".repeat(64),
    analyzers: null,
    final_code: {
      status: "ok",
      value: {
        errors: 2,
        warnings: null,
        start_errors: 0,
        start_warnings: 0,
        new_warnings: null,
        new_warning_codes: {},
        complete: false,
        incomplete_apps: [],
      },
    },
    reuse: { status: "not_applicable", reason: "test" },
    partial_credit: { status: "not_applicable", reason: "test" },
  });
  const r = await harnessReport("skills-vs-plain", p.opts);
  const row = r.exploratory!.arms.find((x) =>
    x.arm === "plain" && x.metric === "final_errors"
  )!;
  assertEquals([row.value, row.cells], [2, 1]);
});

// M10-08c: concurrent environments on one host (another worktree or lane, its
// own private root) never sweep each other's sandboxes; a second environment
// on the same private root is refused by the root's lock before any sweep; a
// restart on the root recovers its predecessor's leftovers under the same owner.
Deno.test("openHarnessEnv (M10-08c): one namespace owner per private root; its lock refuses a second environment before any sweep; a restart sweeps the same owner", async () => {
  await using t = await makeEnv();
  await using other = await makeEnv();
  const owners: string[] = [];
  const track = (order: string[]) => {
    const d = deps(order);
    const docker = d.docker();
    const listOwned = docker.listOwned.bind(docker);
    docker.listOwned = (o) => {
      owners.push(o);
      return listOwned(o);
    };
    return d;
  };
  const own = namespaceOwner("HOST1", t.env.privateRoot);
  const a = await openHarnessEnv(envOpts(t), track([]));
  assertEquals(a.env.owner, own);
  // M10-08c run 003 item 1: first the read-only legacy probe of the bare hostname.
  assertEquals(
    owners,
    ["HOST1", own, own],
    "startup and recovery sweep a's owner",
  );
  const b = await openHarnessEnv(envOpts(other), track([]));
  assert(b.env.owner !== own && b.env.owner.startsWith("HOST1-"));
  assertEquals(
    owners.slice(3),
    ["HOST1", b.env.owner, b.env.owner],
    "b sweeps only b's",
  );
  const order: string[] = [];
  await assertRejects(
    () => openHarnessEnv(envOpts(t), track(order)),
    BenchLockHeldError,
  );
  assertEquals(order, ["lock", "release"], "refused before any sweep");
  await b.close();
  await a.close();
  const restart: string[] = [];
  const r = await openHarnessEnv(envOpts(t), track(restart));
  assertEquals(r.env.owner, own, "a restart keeps the owner");
  assertEquals(owners.slice(6), ["HOST1", own, own]);
  await r.close();
});

// M10-08c review 1: the private root's lock is taken before both temp sweeps,
// so a refused second environment never deletes the live one's freeze dir.
Deno.test("openHarnessEnv (M10-08c review 1): a refused second environment on the same private root sweeps nothing of the live one's", async () => {
  await using t = await makeEnv();
  const a = await openHarnessEnv(envOpts(t), deps([]));
  try {
    const frozen = join(t.env.privateRoot, "freeze", "x");
    const temp = join(t.env.resultsRoot, "workspaces", ".tmp-live");
    await Deno.mkdir(frozen, { recursive: true });
    await Deno.mkdir(temp, { recursive: true });
    await assertRejects(
      () => openHarnessEnv(envOpts(t), deps([])),
      BenchLockHeldError,
    );
    assert(await exists(frozen), "the live environment's freeze survives");
    assert(
      await exists(temp),
      "the live environment's workspace temp survives",
    );
  } finally {
    await a.close();
  }
});

// M10-08c review 5: the private root's lock goes through the injected seam.
Deno.test("openHarnessEnv (M10-08c review 5): both locks come from deps.acquireLock, the repo's first, then the private root's", async () => {
  await using t = await makeEnv();
  const d = deps([]);
  const dirs: string[] = [];
  const acquire = d.acquireLock;
  d.acquireLock = (dir, o) => {
    dirs.push(dir);
    return acquire(dir, o);
  };
  const h = await openHarnessEnv(envOpts(t), d);
  await h.close();
  assertEquals(dirs, [join(t.repo.root, "results"), t.env.privateRoot]);
});

// M10-08c review 6 / O3: the refusal names the --private-dir and the holder's pid.
Deno.test("openHarnessEnv (M10-08c review 6, O3): a second environment on the same private root is refused naming --private-dir and the holder pid", async () => {
  await using t = await makeEnv();
  const a = await openHarnessEnv(envOpts(t), deps([]));
  try {
    const err = await assertRejects(
      () => openHarnessEnv(envOpts(t), deps([])),
      BenchLockHeldError,
    );
    assertStringIncludes(err.message, `--private-dir ${t.env.privateRoot}`);
    assertStringIncludes(err.message, `pid ${Deno.pid}`);
  } finally {
    await a.close();
  }
});

// O2: the private root's lock is released on a normal close; a crashed
// holder's marker (no heartbeat) is reclaimable after 120 s, never before.
Deno.test("openHarnessEnv (M10-08c O2): the private root's lock is released on close; a crashed holder's lock is reclaimed only after 120 s", async () => {
  await using t = await makeEnv();
  const marker = benchLockPath(t.env.privateRoot);
  const a = await openHarnessEnv(envOpts(t), deps([]));
  assert(await exists(marker), "held while open");
  await a.close();
  assert(!await exists(marker), "released on close");
  const crashed = (ageMs: number) => {
    Deno.writeTextFileSync(
      marker,
      JSON.stringify({
        pid: 424242,
        startedAt: "2026-10-13T00:00:00.000Z",
        heartbeatAt: "2026-10-13T00:00:00.000Z",
        command: "crashed",
        token: "crashed-token",
      }),
    );
    const at = new Date(Date.now() - ageMs);
    Deno.utimeSync(marker, at, at);
  };
  crashed(60_000);
  const err = await assertRejects(
    () => openHarnessEnv(envOpts(t), deps([])),
    BenchLockHeldError,
  );
  assertStringIncludes(err.message, "pid 424242");
  crashed(121_000);
  const r = await openHarnessEnv(envOpts(t), deps([]));
  assertEquals(r.env.namespaceLost?.(), false, "reclaimed: ours now");
  await r.close();
});

// M10-08c review 4: a suspended environment whose lock another process
// reclaimed (no heartbeat for 120 s) learns it before its next cell.
Deno.test("openHarnessEnv (M10-08c review 4): env.namespaceLost turns true once another process holds the private root's lock; close leaves that holder's marker", async () => {
  await using t = await makeEnv();
  const h = await openHarnessEnv(envOpts(t), deps([]));
  assertEquals(h.env.namespaceLost?.(), false);
  const marker = benchLockPath(t.env.privateRoot);
  Deno.writeTextFileSync(
    marker,
    JSON.stringify({
      pid: 1,
      startedAt: "",
      heartbeatAt: "",
      command: "reclaimer",
      token: "reclaimer-token",
    }),
  );
  assertEquals(h.env.namespaceLost?.(), true);
  await h.close();
  assert(await exists(marker), "the new holder's marker stays");
});

// M10-08c review 2: an older harness labeled its sandboxes with the bare
// hostname. Under the private root's lock, those whose execution is one of
// this root's intents are removed and confirmed gone before any intent is
// recovered; a failed removal stops the start with the intent untouched.
Deno.test("openHarnessEnv (M10-08c review 2): legacy bare-hostname sandboxes of this root's intents are removed and confirmed gone before recovery; others are left alone", async () => {
  const legacy = "cg-harness-11111111-aaaaaaaa";
  const foreign = "cg-harness-22222222-bbbbbbbb";
  const read = "cg-harness-read-abcdef012345";
  const setup = async () => {
    const t = await makeEnv();
    const d = deps([]);
    const docker = d.docker() as FakeDocker;
    docker.owned = [legacy, foreign, read];
    docker.containers.set(legacy, "exec-legacy");
    docker.containers.set(foreign, "exec-foreign");
    // M10-08c run 002 item 2: proven dead (exited); a running one refuses the start.
    docker.exited.add(legacy);
    const lists: string[] = [];
    docker.listOwned = (o) => {
      lists.push(o);
      return Promise.resolve(o === "HOST1" ? [...docker.owned] : []);
    };
    const intent = join(t.env.privateRoot, "intents", "exec-legacy.json");
    await Deno.mkdir(join(t.env.privateRoot, "intents"), { recursive: true });
    // Review 546e8337 P2-b (strict): only a finalized intent's legacy
    // sandbox is removed automatically.
    await Deno.writeTextFile(
      intent,
      JSON.stringify({
        v: 2,
        execution_id: "exec-legacy",
        phase: "published",
        results_root: t.env.resultsRoot,
      }),
    );
    return { t, d, docker, intent, lists };
  };
  // M10-08c run 003 item 1: automatic legacy removal is gone by design: the
  // start refuses naming every bare-hostname sandbox; nothing is removed.
  const ok = await setup();
  const refused = await assertRejects(
    () => openHarnessEnv(envOpts(ok.t), ok.d),
    ConfigurationError,
    legacy,
  );
  assertStringIncludes(refused.message, foreign);
  assertEquals(ok.docker.removed, []);
  assert(ok.lists.includes("HOST1"), "the bare hostname is listed");
  assert(await ok.docker.state(legacy), "the legacy sandbox stays");
  assert(await ok.docker.state(foreign), "another root's legacy sandbox stays");
  assert(await ok.docker.state(read), "read containers are the build's");
  assert(await exists(ok.intent), "the intent is never recovered");

  const stuck = await setup();
  stuck.docker.rmFails.add(legacy);
  await assertRejects(
    () => openHarnessEnv(envOpts(stuck.t), stuck.d),
    ConfigurationError,
    legacy,
  );
  assert(await exists(stuck.intent), "never recovered while it may run");
});

// M10-08c review 7: concurrent `images build` runs read under their own
// owner; a build sweeps only bare-hostname (legacy) read leftovers.
Deno.test("harnessImagesBuild (M10-08c review 7): each build reads under its own owner; the sweep lists only the bare hostname", async () => {
  const root = await Deno.realPath(await testTempDir());
  const docker = new FakeDocker();
  await Deno.mkdir(join(root, "harness", "images", "claude-code", "lsp"), {
    recursive: true,
  });
  await Deno.copyFile(AL_LSP_DEF, join(root, AL_LSP_DEF));
  const [lk, lv] = (await lspLabel(root))!;
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1"]);
  const lists: string[] = [];
  docker.listOwned = (o) => {
    lists.push(o);
    return Promise.resolve([]);
  };
  const owners: string[][] = [];
  for (const version of ["2.1.290", "2.1.291"]) {
    const id = `sha256:${version === "2.1.290" ? "c" : "d"}`.padEnd(71, "0");
    // H-03: the registry resolves the version; one dev revision per build.
    const b = ccBuild(docker, root, id, {
      "centralgauge.harness": "claude-code",
      "centralgauge.harness.base_digest": baseId,
      [lk]: lv,
      ...lspReleaseLabels(), // M10-10 fixture
    }, { version, revision: `3-dev-${version.replaceAll(".", "-")}` });
    docker.shipFile(id, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
    docker.shipFile(id, AL_LSP_RESOLVED, lspResolvedJson());
    const before = docker.reads.length;
    await harnessImagesBuild("claude-code", b.opts, docker, b.fetch);
    owners.push([...new Set(docker.reads.slice(before).map((r) => r.owner))]);
  }
  const host = Deno.hostname();
  assertEquals(owners.map((o) => o.length), [1, 1], "one owner per build");
  for (const [o] of owners) assert(o!.startsWith(`${host}-build-`), o);
  assert(owners[0]![0] !== owners[1]![0], "builds never share an owner");
  assertEquals(lists, [host, host]);
});

// M10-08c run 002 item 1: ownership holds through every destructive step of
// the start. The private root's lock is reclaimed by another process (its
// marker carries another token) right after acquisition, during the opening,
// or right before the first removal: nothing is swept, nothing removed.
Deno.test("openHarnessEnv (M10-08c run 002 item 1): the token it acquired is the one checked; a lock lost right after acquisition, during opening or right before a removal sweeps nothing", async () => {
  const reclaim = (root: string) =>
    Deno.writeTextFileSync(
      benchLockPath(root),
      JSON.stringify({
        pid: 1,
        startedAt: "",
        heartbeatAt: "",
        command: "reclaimer",
        token: "reclaimer-token",
      }),
    );
  for (const when of ["acquired", "opening", "removal"] as const) {
    await using t = await makeEnv();
    const d = deps([]);
    const docker = d.docker() as FakeDocker;
    const acquire = d.acquireLock;
    d.acquireLock = (dir, o) => {
      const held = acquire(dir, o);
      if (when === "acquired" && dir === t.env.privateRoot) reclaim(dir);
      return held;
    };
    if (when === "opening") {
      d.docker = () => (reclaim(t.env.privateRoot), docker);
    }
    if (when === "removal") {
      // Review 546e8337 P3-1: an owned sandbox, so the reclaim lands at
      // removeConfirmed's per-removal hold (not a later step's).
      docker.owned = ["cg-harness-dead-beef"];
      const list = docker.listOwned.bind(docker);
      // Run 003: not at the bare hostname's (read-only) legacy probe.
      docker.listOwned = (
        o,
      ) => (o !== "HOST1" && reclaim(t.env.privateRoot), list(o));
    }
    const frozen = join(t.env.privateRoot, "freeze", "x");
    await Deno.mkdir(frozen, { recursive: true });
    await assertRejects(
      () => openHarnessEnv(envOpts(t), d),
      ConfigurationError,
      "lock",
    );
    assertEquals(docker.removed, [], `${when}: nothing removed`);
    if (when === "acquired") {
      assert(await exists(frozen), "acquired: no temp sweep either");
    }
    assertEquals(
      readBenchLock(t.env.privateRoot)?.token,
      "reclaimer-token",
      `${when}: the new holder's marker stays`,
    );
  }
});

// M10-08c run 002 item 2: base runners take only the repo lock, so a running
// legacy (bare-hostname) sandbox of this root's intents may be live: the start
// is refused naming it, the private dir and the one-shot cleanup. Proven dead
// (exited, or its intent finalized as published) it is removed.
Deno.test("openHarnessEnv (M10-08c run 002 item 2): a running legacy sandbox of this root refuses the start and is never removed; exited or finalized ones are removed", async () => {
  const legacy = "cg-harness-11111111-aaaaaaaa";
  const setup = async (o: { exited?: boolean; published?: boolean }) => {
    const t = await makeEnv();
    const d = deps([]);
    const docker = d.docker() as FakeDocker;
    docker.owned = [legacy];
    docker.containers.set(legacy, "exec-legacy");
    if (o.exited) docker.exited.add(legacy);
    docker.listOwned = (owner) =>
      Promise.resolve(owner === "HOST1" ? [...docker.owned] : []);
    const intent = join(t.env.privateRoot, "intents", "exec-legacy.json");
    await Deno.mkdir(join(t.env.privateRoot, "intents"), { recursive: true });
    await Deno.writeTextFile(
      intent,
      o.published
        ? JSON.stringify({
          v: 2,
          execution_id: "exec-legacy",
          phase: "published",
          results_root: t.env.resultsRoot,
        })
        : "not json",
    );
    return { t, d, docker, intent };
  };
  const live = await setup({});
  const err = await assertRejects(
    () => openHarnessEnv(envOpts(live.t), live.d),
    ConfigurationError,
    legacy,
  );
  assertStringIncludes(err.message, live.t.env.privateRoot);
  assertStringIncludes(err.message, `docker rm -f ${legacy}`);
  assertEquals(
    live.docker.removed,
    [],
    "a live legacy sandbox is never removed",
  );
  assert(await exists(live.intent), "its intent is never recovered");
  // M10-08c run 003 item 1: no automatic legacy removal: a finalized intent's
  // legacy sandbox (exited or not) refuses too; nothing removed or recovered.
  for (const o of [{ exited: true, published: true }, { published: true }]) {
    const dead = await setup(o);
    await assertRejects(
      () => openHarnessEnv(envOpts(dead.t), dead.d),
      ConfigurationError,
      legacy,
    );
    assertEquals(dead.docker.removed, [], JSON.stringify(o));
    assert(await exists(dead.intent), `${JSON.stringify(o)}: never recovered`);
  }
});

// M10-08c run 002 item 4: legacy custody dirs (cg-harness-secrets-<host>.*)
// of this private root go only once this root's legacy sandboxes are
// confirmed gone; another owner's dirs are never touched.
Deno.test("openHarnessEnv (M10-08c run 002 item 4): this root's legacy custody dirs are removed only after its legacy sandboxes are confirmed gone", async () => {
  const legacy = "cg-harness-11111111-aaaaaaaa";
  const setup = async (o: { running?: boolean; rmFails?: boolean }) => {
    const t = await makeEnv();
    const d = deps([]);
    const docker = d.docker() as FakeDocker;
    docker.owned = [legacy];
    docker.containers.set(legacy, "exec-legacy");
    if (!o.running) docker.exited.add(legacy);
    if (o.rmFails) docker.rmFails.add(legacy);
    docker.listOwned = (owner) =>
      Promise.resolve(owner === "HOST1" ? [...docker.owned] : []);
    await Deno.mkdir(join(t.env.privateRoot, "intents"), { recursive: true });
    // Review 546e8337 P2-b (strict): a removable (not running) legacy
    // sandbox's intent is finalized; the running one's is not.
    await Deno.writeTextFile(
      join(t.env.privateRoot, "intents", "exec-legacy.json"),
      o.running ? "not json" : JSON.stringify({
        v: 2,
        execution_id: "exec-legacy",
        phase: "published",
        results_root: t.env.resultsRoot,
      }),
    );
    const secrets = join(t.env.privateRoot, "secrets");
    const mine = join(secrets, "cg-harness-secrets-HOST1.legacy-0001");
    const other = join(secrets, "cg-harness-secrets-HOST2.other-0001");
    for (const dir of [mine, other]) {
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(
        join(dir, "anthropic-key"),
        "sk-ant-planted-secret-0123456789",
      );
    }
    return { t, d, docker, mine, other };
  };
  // M10-08c run 003 item 1: legacy custody is never removed automatically:
  // the start refuses naming it; nothing is removed.
  const gone = await setup({});
  const refused = await assertRejects(
    () => openHarnessEnv(envOpts(gone.t), gone.d),
    ConfigurationError,
    legacy,
  );
  assertStringIncludes(refused.message, gone.mine);
  assertEquals(gone.docker.removed, []);
  assert(
    await exists(join(gone.mine, "anthropic-key")),
    "this root's legacy custody is kept",
  );
  assert(
    await exists(join(gone.other, "anthropic-key")),
    "another owner's custody is never touched",
  );
  const live = await setup({ running: true });
  await assertRejects(
    () => openHarnessEnv(envOpts(live.t), live.d),
    ConfigurationError,
    legacy,
  );
  assert(
    await exists(join(live.mine, "anthropic-key")),
    "kept while its sandbox may run",
  );
  const stuck = await setup({ rmFails: true });
  await assertRejects(
    () => openHarnessEnv(envOpts(stuck.t), stuck.d),
    ConfigurationError,
    legacy,
  );
  assert(
    await exists(join(stuck.mine, "anthropic-key")),
    "kept while its sandbox is not confirmed gone",
  );
});

// M10-08c run 002 item 6: each build reads under its own namespace, held by
// a lock under <root>/results/harness/image-builds; the next build sweeps the
// read containers of namespaces whose lock is stale (a crashed build) and
// leaves a live build's alone.
Deno.test("harnessImagesBuild (M10-08c run 002 item 6): a crashed build's read container is swept by the next build; a live build's is kept", async () => {
  const root = await Deno.realPath(await testTempDir());
  const docker = new FakeDocker();
  await Deno.mkdir(join(root, "harness", "images", "claude-code", "lsp"), {
    recursive: true,
  });
  await Deno.copyFile(AL_LSP_DEF, join(root, AL_LSP_DEF));
  const [lk, lv] = (await lspLabel(root))!;
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1"]);
  const id = `sha256:${"c".repeat(64)}`;
  // H-03: the registry resolves the version.
  const b = ccBuild(docker, root, id, {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.base_digest": baseId,
    [lk]: lv,
    ...lspReleaseLabels(), // M10-10 fixture
  });
  docker.shipFile(id, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
  docker.shipFile(id, AL_LSP_RESOLVED, lspResolvedJson());
  const host = Deno.hostname();
  const builds = join(root, "results", "harness", "image-builds");
  const dead = `${host}-build-dead0000`;
  const live = `${host}-build-live0000`;
  for (const [owner, ageMs] of [[dead, 121_000], [live, 0]] as const) {
    await Deno.mkdir(join(builds, owner), { recursive: true });
    const marker = benchLockPath(join(builds, owner));
    Deno.writeTextFileSync(
      marker,
      JSON.stringify({
        pid: 424242,
        startedAt: "",
        heartbeatAt: "",
        command: "harness images build",
        token: `${owner}-token`,
      }),
    );
    const at = new Date(Date.now() - ageMs);
    Deno.utimeSync(marker, at, at);
  }
  const deadRead = "cg-harness-read-dead00000000";
  const liveRead = "cg-harness-read-live00000000";
  docker.listOwned = (o) =>
    Promise.resolve(o === dead ? [deadRead] : o === live ? [liveRead] : []);
  await harnessImagesBuild("claude-code", b.opts, docker, b.fetch);
  assert(
    docker.removed.includes(deadRead),
    "the crashed build's read is swept",
  );
  assert(!docker.removed.includes(liveRead), "a live build's read is kept");
  assertEquals(
    [...Deno.readDirSync(builds)].map((e) => e.name),
    [live],
    "the dead namespace and this build's own are gone; the live one stays",
  );
});

// M10-08c run 002 item 7: a second environment in the same checkout meets the
// repository lock first; through the real lock its refusal names
// --private-dir and the holder's pid.
Deno.test("openHarnessEnv (M10-08c run 002 item 7): a second environment in the same checkout is refused by the real repository lock naming --private-dir and the holder pid", async () => {
  await using t = await makeEnv();
  const real = () => {
    const d = deps([]);
    d.acquireLock = (dir, o) => acquireBenchLock(dir, o);
    return d;
  };
  const a = await openHarnessEnv(envOpts(t), real());
  try {
    const err = await assertRejects(
      () => openHarnessEnv(envOpts(t), real()),
      BenchLockHeldError,
    );
    assertStringIncludes(err.message, join(t.repo.root, "results"));
    assertStringIncludes(err.message, "--private-dir");
    assertStringIncludes(err.message, `pid ${Deno.pid}`);
  } finally {
    await a.close();
  }
});

// Review 546e8337 P3-3: a concurrent build may remove a namespace dir first
// (this build's own after its release, or a dead one both builds swept):
// NotFound on that remove is ignored; any other remove error still throws.
Deno.test("harnessImagesBuild (review 546e8337 P3-3): a namespace dir removed concurrently is not an error; other remove errors are", async () => {
  const setup = async () => {
    const root = await Deno.realPath(await testTempDir());
    const docker = new FakeDocker();
    await Deno.mkdir(join(root, "harness", "images", "claude-code", "lsp"), {
      recursive: true,
    });
    await Deno.copyFile(AL_LSP_DEF, join(root, AL_LSP_DEF));
    const [lk, lv] = (await lspLabel(root))!;
    const baseId = `sha256:${"b".repeat(64)}`;
    docker.addImage(BASE_IMAGE, baseId, {}, ["l1"]);
    const id = `sha256:${"c".repeat(64)}`;
    // H-03: the registry resolves the version.
    const b = ccBuild(docker, root, id, {
      "centralgauge.harness": "claude-code",
      "centralgauge.harness.base_digest": baseId,
      [lk]: lv,
      ...lspReleaseLabels(), // M10-10 fixture
    });
    docker.shipFile(id, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
    docker.shipFile(id, AL_LSP_RESOLVED, lspResolvedJson());
    const builds = join(root, "results", "harness", "image-builds");
    const dead = join(builds, `${Deno.hostname()}-build-dead0000`);
    await Deno.mkdir(dead, { recursive: true });
    return { root, docker, builds, dead, b };
  };
  const real = Deno.remove;
  // Another build wins the remove of every namespace dir: gone, then ours.
  const raced = await setup();
  const removed: string[] = [];
  const race = stub(
    Deno,
    "remove",
    async (path: string | URL, o?: Deno.RemoveOptions) => {
      if (String(path).startsWith(raced.builds)) {
        removed.push(String(path));
        await real(path, o);
      }
      return real(path, o);
    },
  );
  try {
    await harnessImagesBuild(
      "claude-code",
      raced.b.opts,
      raced.docker,
      raced.b.fetch,
    );
  } finally {
    race.restore();
  }
  assert(removed.includes(raced.dead), "the dead namespace's remove raced");
  assertEquals(removed.length, 2, "and this build's own namespace's");
  assertEquals([...Deno.readDirSync(raced.builds)], []);
  // Any other failure of that remove is not swallowed.
  const denied = await setup();
  const deny = stub(
    Deno,
    "remove",
    (path: string | URL, o?: Deno.RemoveOptions) =>
      String(path).startsWith(denied.builds)
        ? Promise.reject(new Deno.errors.PermissionDenied("access denied"))
        : real(path, o),
  );
  try {
    await assertRejects(
      () =>
        harnessImagesBuild(
          "claude-code",
          denied.b.opts,
          denied.docker,
          denied.b.fetch,
        ),
      Deno.errors.PermissionDenied,
    );
  } finally {
    deny.restore();
  }
});

/** A bare-hostname (legacy) sandbox of this root's intent exec-legacy. */
async function legacyRoot(o: { exited?: boolean; published?: boolean }) {
  const legacy = "cg-harness-11111111-aaaaaaaa";
  const t = await makeEnv();
  const d = deps([]);
  const docker = d.docker() as FakeDocker;
  docker.owned = [legacy];
  docker.containers.set(legacy, "exec-legacy");
  if (o.exited) docker.exited.add(legacy);
  docker.listOwned = (owner) =>
    Promise.resolve(owner === "HOST1" ? [...docker.owned] : []);
  const intent = join(t.env.privateRoot, "intents", "exec-legacy.json");
  await Deno.mkdir(join(t.env.privateRoot, "intents"), { recursive: true });
  // Unpublished: unreadable here (any phase but published counts the same).
  await Deno.writeTextFile(
    intent,
    o.published
      ? JSON.stringify({
        v: 2,
        execution_id: "exec-legacy",
        phase: "published",
        results_root: t.env.resultsRoot,
      })
      : "not json",
  );
  return { legacy, t, d, docker, intent };
}

// Review 546e8337 P2-a: the live-legacy refusal comes before ANY sweep: a
// legacy runner sharing the root keeps its freeze scratch and temp records.
Deno.test("openHarnessEnv (review 546e8337 P2-a): a live legacy sandbox refuses before any sweep; freeze scratch and temp records survive", async () => {
  const { legacy, t, d, docker, intent } = await legacyRoot({});
  const frozen = join(t.env.privateRoot, "freeze", "x");
  await Deno.mkdir(frozen, { recursive: true });
  const temp = join(t.env.resultsRoot, "campaigns", "c.json.tmp-0001");
  await Deno.mkdir(join(t.env.resultsRoot, "campaigns"), { recursive: true });
  await Deno.writeTextFile(temp, "{}");
  const err = await assertRejects(
    () => openHarnessEnv(envOpts(t), d),
    ConfigurationError,
    legacy,
  );
  assertStringIncludes(err.message, "nothing removed");
  assert(await exists(frozen), "the legacy runner's freeze scratch survives");
  assert(await exists(temp), "its temp record survives");
  assertEquals(docker.removed, []);
  assert(await exists(intent));
});

// Review 546e8337 P2-b (strict): a legacy runner may still be scoring after
// its container exited, so an exited legacy sandbox whose intent is not
// published refuses too; only a finalized intent's is removed automatically.
Deno.test("openHarnessEnv (review 546e8337 P2-b): an exited legacy sandbox with an unpublished intent refuses; nothing destroyed", async () => {
  const { legacy, t, d, docker, intent } = await legacyRoot({ exited: true });
  const secrets = join(
    t.env.privateRoot,
    "secrets",
    "cg-harness-secrets-HOST1.legacy-0001",
  );
  await Deno.mkdir(secrets, { recursive: true });
  await Deno.writeTextFile(
    join(secrets, "anthropic-key"),
    "sk-ant-planted-secret-0123456789",
  );
  const err = await assertRejects(
    () => openHarnessEnv(envOpts(t), d),
    ConfigurationError,
    legacy,
  );
  assertStringIncludes(err.message, `docker rm -f ${legacy}`);
  assertStringIncludes(err.message, t.env.privateRoot);
  assertEquals(docker.removed, [], "never removed");
  assert(await docker.state(legacy), "the legacy sandbox stays");
  assert(await exists(intent), "its intent is never recovered");
  assert(
    !await exists(join(t.env.privateRoot, "broken")),
    "recovery never touched it",
  );
  assert(await exists(join(secrets, "anthropic-key")), "custody kept");
  // M10-08c run 003 item 1: a finalized one refuses too; nothing removed.
  const done = await legacyRoot({ exited: true, published: true });
  await assertRejects(
    () => openHarnessEnv(envOpts(done.t), done.d),
    ConfigurationError,
    done.legacy,
  );
  assertEquals(done.docker.removed, [], "a finalized one stays too");
});

// M10-08c run 003 item 1: no automatic legacy migration. Any bare-hostname
// sandbox (running or exited), any legacy-format intent or any legacy custody
// dir of this root refuses the opening before any sweep, with one message
// naming every item and the one-time manual migration; nothing is removed.
Deno.test("openHarnessEnv (M10-08c run 003 item 1): a legacy intent, exited or running legacy container, or legacy custody dir refuses before any sweep; nothing removed", async () => {
  const legacy = "cg-harness-11111111-aaaaaaaa";
  for (
    const kind of ["intent", "exited", "running", "secret", "all"] as const
  ) {
    const t = await makeEnv();
    const d = deps([]);
    const docker = d.docker() as FakeDocker;
    docker.owned = [];
    docker.listOwned = (owner) =>
      Promise.resolve(owner === "HOST1" ? [...docker.owned] : []);
    const frozen = join(t.env.privateRoot, "freeze", "x");
    await Deno.mkdir(frozen, { recursive: true });
    const named: string[] = [];
    const intent = join(t.env.privateRoot, "intents", "exec-legacy.json");
    const withIntent = kind === "intent" || kind === "all";
    const withContainer = kind === "exited" || kind === "running" ||
      kind === "all";
    const withSecret = kind === "secret" || kind === "all";
    if (withIntent) {
      // An older harness's intent: no namespace field.
      await Deno.mkdir(join(t.env.privateRoot, "intents"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        intent,
        JSON.stringify({
          v: 2,
          execution_id: "exec-legacy",
          phase: "released",
          results_root: t.env.resultsRoot,
          sandbox: legacy,
        }),
      );
      named.push(intent);
    }
    if (withContainer) {
      docker.owned = [legacy];
      docker.containers.set(legacy, "exec-legacy");
      if (kind === "exited") docker.exited.add(legacy);
      named.push(legacy);
    }
    const secret = join(
      t.env.privateRoot,
      "secrets",
      "cg-harness-secrets-HOST1.legacy-0001",
    );
    if (withSecret) {
      await Deno.mkdir(secret, { recursive: true });
      await Deno.writeTextFile(
        join(secret, "anthropic-key"),
        "sk-ant-planted-secret-0123456789",
      );
      named.push(secret);
    }
    const err = await assertRejects(
      () => openHarnessEnv(envOpts(t), d),
      ConfigurationError,
      "legacy",
    );
    for (const n of named) assertStringIncludes(err.message, n, kind);
    assertStringIncludes(err.message, "stop every harness process", kind);
    if (withContainer) {
      assertStringIncludes(
        err.message,
        `DOCKER_CONTEXT=desktop-windows docker rm -f ${legacy}`,
        kind,
      );
      assert(await docker.state(legacy), `${kind}: the container survives`);
    }
    assertEquals(docker.removed, [], `${kind}: nothing removed`);
    if (withIntent) {
      assert(await exists(intent), `${kind}: the intent survives`);
      assert(
        !await exists(join(t.env.privateRoot, "broken")),
        `${kind}: never quarantined`,
      );
    }
    if (withSecret) {
      assert(
        await exists(join(secret, "anthropic-key")),
        `${kind}: the custody survives`,
      );
    }
    assert(await exists(frozen), `${kind}: refused before any sweep`);
  }
});

// M10-08c run 003 item 2: the acquired token is checked again between the two
// temp sweeps: lost during the first, the second never runs.
Deno.test("openHarnessEnv (M10-08c run 003 item 2): a lock lost between the two temp sweeps stops before the second", async () => {
  await using t = await makeEnv();
  const d = deps([]);
  const temp = join(t.env.resultsRoot, "workspaces", ".tmp-live");
  await Deno.mkdir(temp, { recursive: true });
  const real = RecordStore.prototype.sweepTemp;
  const s = stub(
    RecordStore.prototype,
    "sweepTemp",
    function (this: RecordStore) {
      Deno.writeTextFileSync(
        benchLockPath(t.env.privateRoot),
        JSON.stringify({
          pid: 1,
          startedAt: "",
          heartbeatAt: "",
          command: "reclaimer",
          token: "reclaimer-token",
        }),
      );
      return real.call(this);
    },
  );
  try {
    await assertRejects(
      () => openHarnessEnv(envOpts(t), d),
      ConfigurationError,
      "lock",
    );
  } finally {
    s.restore();
  }
  assert(await exists(temp), "the second temp sweep never ran");
  assertEquals((d.docker() as FakeDocker).removed, []);
  assertEquals(readBenchLock(t.env.privateRoot)?.token, "reclaimer-token");
});

// M10-08c run 003 item 3: the read container's final `docker rm -f` failed
// after a successful capture: the read reports it and the build keeps its
// namespace (lock dir) so the next build's sweep finds the container.
Deno.test("harnessImagesBuild (M10-08c run 003 item 3): a successful capture whose docker rm -f failed is reported; the build namespace stays discoverable", async () => {
  const root = await Deno.realPath(await testTempDir());
  const docker = new FakeDocker();
  await Deno.mkdir(join(root, "harness", "images", "claude-code", "lsp"), {
    recursive: true,
  });
  await Deno.copyFile(AL_LSP_DEF, join(root, AL_LSP_DEF));
  const [lk, lv] = (await lspLabel(root))!;
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1"]);
  const id = `sha256:${"c".repeat(64)}`;
  // H-03: the registry resolves the version.
  const b = ccBuild(docker, root, id, {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.base_digest": baseId,
    [lk]: lv,
  });
  // `docker cp` lands the file here: the capture itself succeeds.
  const capture = await testTempDir();
  await Deno.writeTextFile(
    join(capture, AL_LSP_SHIPPED.replace(/\\/g, "/").split("/").pop()!),
    await Deno.readTextFile(AL_LSP_DEF),
  );
  const owners: string[] = [];
  docker.readImageFile = (image, path, owner) => {
    owners.push(owner);
    return realDocker().readImageFile(image, path, owner);
  };
  const mock = createCommandMock();
  mock.mockCommand(
    { command: "docker", argsContain: ["rm -f cg-harness-read-"] },
    { code: 1, stdout: "", stderr: "Error response from daemon: busy" },
  );
  mock.install();
  __setContextListerForTests(() => ["desktop-windows"]);
  const realTemp = Deno.makeTempDir;
  const tmp = stub(
    Deno,
    "makeTempDir",
    (o?: Deno.MakeTempOptions) =>
      o?.prefix === "cg-read-" ? Promise.resolve(capture) : realTemp(o),
  );
  try {
    await assertRejects(
      () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
      ContainerError,
      "cg-harness-read-",
    );
  } finally {
    tmp.restore();
    mock.restore();
    __setContextListerForTests(undefined);
  }
  assertEquals(owners.length, 1, "one read");
  assert(
    mock.getCallsFor("docker").some((c) =>
      c.args.join(" ").startsWith("rm -f cg-harness-read-")
    ),
    "the read container's removal was attempted",
  );
  const builds = join(root, "results", "harness", "image-builds");
  assert(
    await exists(join(builds, owners[0]!)),
    "the namespace stays for the next build's sweep",
  );
});

// M10-08c run 003 item 1: an older build may be reading under the bare
// hostname right now: its read container is never removed (a warning names it).
Deno.test("harnessImagesBuild (M10-08c run 003 item 1): a bare-hostname read container survives a build", async () => {
  const root = await Deno.realPath(await testTempDir());
  const docker = new FakeDocker();
  await Deno.mkdir(join(root, "harness", "images", "claude-code", "lsp"), {
    recursive: true,
  });
  await Deno.copyFile(AL_LSP_DEF, join(root, AL_LSP_DEF));
  const [lk, lv] = (await lspLabel(root))!;
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1"]);
  const id = `sha256:${"c".repeat(64)}`;
  // H-03: the registry resolves the version.
  const b = ccBuild(docker, root, id, {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.base_digest": baseId,
    [lk]: lv,
    ...lspReleaseLabels(), // M10-10 fixture
  });
  docker.shipFile(id, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
  docker.shipFile(id, AL_LSP_RESOLVED, lspResolvedJson());
  const legacyRead = "cg-harness-read-legacy00000";
  docker.owned = [legacyRead];
  docker.listOwned = (o) =>
    Promise.resolve(o === Deno.hostname() ? [...docker.owned] : []);
  await harnessImagesBuild("claude-code", b.opts, docker, b.fetch);
  assertEquals(docker.removed, [], "no legacy read container removed");
  assert(await docker.state(legacyRead), "the older build's read survives");
});

// Review M10-08c P2-2: the legacy refusal also names the existing per-id
// private paths of each legacy intent (read-only: all survive).
Deno.test("openHarnessEnv (M10-08c P2-2): a legacy intent's refusal names its existing per-id private paths; all survive", async () => {
  await using t = await makeEnv();
  const d = deps([]);
  const root = t.env.privateRoot;
  await Deno.mkdir(join(root, "intents"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "intents", "exec-legacy.json"),
    JSON.stringify({ v: 2, execution_id: "exec-legacy", phase: "released" }),
  );
  const planted = [
    join(root, "custody", "exec-legacy.json"),
    join(root, "redaction", "exec-legacy.json"),
  ];
  const dirs = ["work", "pending", "quarantine", "taskcopy"].map((x) =>
    join(root, x, "exec-legacy")
  );
  for (const f of planted) {
    await Deno.mkdir(join(f, ".."), { recursive: true });
    await Deno.writeTextFile(f, "{}");
  }
  for (const x of dirs) await Deno.mkdir(x, { recursive: true });
  const err = await assertRejects(
    () => openHarnessEnv(envOpts(t), d),
    ConfigurationError,
    "legacy",
  );
  const all = [...planted, ...dirs];
  for (const n of all) assertStringIncludes(err.message, n);
  assert(
    !err.message.includes(join(root, "redaction", "exec-legacy.stub.json")),
    "only paths that exist are named",
  );
  for (const n of all) assert(await exists(n), `${n} survives`);
});

Deno.test("harnessImagesBuild (M10-10): claude-code resolves the newest LSP release once and passes tag, URL and digest as build args and labels; a failed resolution builds nothing", async () => {
  const root = await Deno.realPath(await testTempDir());
  const docker = new FakeDocker();
  await Deno.mkdir(join(root, "harness", "images", "claude-code", "lsp"), {
    recursive: true,
  });
  await Deno.copyFile(AL_LSP_DEF, join(root, AL_LSP_DEF));
  const [lk, lv] = (await lspLabel(root))!;
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1"]);
  // H-03: the Claude Code version is resolved too (its own tests); this one is about the LSP release.
  const tag = imageTag("claude-code", CC_REL.version, "3");
  const alias = imageTag("claude-code", "latest", "3");
  const labels = {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.base_digest": baseId,
    "centralgauge.harness.revision": "3",
    [lk]: lv,
    ...ccLabels(),
  };
  const o = {
    root,
    revision: "3",
    publishLockDir: join(root, "publish-lock"),
  };
  const GITHUB =
    "https://api.github.com/repos/SShadowS/al-lsp-for-agents/releases/latest";
  await assertRejects(
    () =>
      harnessImagesBuild(
        "claude-code",
        o,
        docker,
        ccFetch({ status: { [GITHUB]: 500 } }),
      ),
    ConfigurationError,
    "HTTP 500",
  );
  assertEquals(docker.builds.length, 0, "no build without a resolved release");

  const id = `sha256:${"c".repeat(64)}`;
  docker.buildResults.set(tag, {
    id,
    labels: { ...labels, ...lspReleaseLabels() },
    layers: ["l1", "l2"],
  });
  docker.shipFile(id, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
  docker.shipFile(id, AL_LSP_RESOLVED, lspResolvedJson());
  docker.shipFile(id, CLAUDE_CODE_RESOLVED, ccResolvedJson());
  const calls: { url: string }[] = [];
  const f = await harnessImagesBuild(
    "claude-code",
    o,
    docker,
    ccFetch({ calls }),
  );
  assertEquals(
    calls.filter((c) => c.url === GITHUB).length,
    1,
    "resolved once",
  );
  const args = docker.builds.at(-1)!;
  for (
    const [flag, value] of [
      ["--build-arg", `LSP_RELEASE=${LSP_REL.tag}`],
      ["--build-arg", `LSP_WRAPPER_URL=${LSP_REL.url}`],
      ["--build-arg", `LSP_WRAPPER_SHA256=${LSP_REL.sha256}`],
      ["--label", `centralgauge.lsp.al.release=${LSP_REL.tag}`],
      [
        "--label",
        `centralgauge.lsp.al.asset=${LSP_REL.asset} sha256:${LSP_REL.sha256}`,
      ],
      ["--label", "centralgauge.lsp.al.dependency_source=embedded"],
    ]
  ) {
    const i = args.indexOf(value!);
    assert(
      i > 0 && args[i - 1] === flag && i < args.indexOf("--iidfile"),
      `${flag} ${value}`,
    );
  }
  assertEquals(
    [f.lsp?.["al"]?.release, f.lsp?.["al"]?.asset],
    [LSP_REL.tag, `${LSP_REL.asset} sha256:${LSP_REL.sha256}`],
  );

  // Release labels that did not land on the built image are refused.
  docker.tags.delete(tag);
  docker.tags.delete(alias);
  const id2 = `sha256:${"d".repeat(64)}`;
  docker.buildResults.set(tag, { id: id2, labels, layers: ["l1", "l2"] });
  docker.shipFile(id2, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
  docker.shipFile(id2, AL_LSP_RESOLVED, lspResolvedJson());
  docker.shipFile(id2, CLAUDE_CODE_RESOLVED, ccResolvedJson());
  await assertRejects(
    () => harnessImagesBuild("claude-code", o, docker, ccFetch()),
    ConfigurationError,
    "centralgauge.lsp.al.release",
  );
});

// ---- H-03: claude-code builds resolve the newest Claude Code ----

/** A claude-code build now resolves its version: the options, the fetch, and the image the build produces (both tags). */
function ccBuild(
  docker: FakeDocker,
  root: string,
  id: string,
  labels: Record<string, string>,
  o: { version?: string; revision?: string } = {},
) {
  const revision = o.revision ?? "3-dev-T";
  const rel = ccRel(o.version ?? CC_REL.version);
  docker.buildResults.set(imageTag("claude-code", rel.version, revision), {
    id,
    labels: {
      ...labels,
      "centralgauge.harness.revision": revision,
      ...ccLabels(rel),
    },
    layers: ["l1", "l2"],
  });
  docker.shipFile(id, CLAUDE_CODE_RESOLVED, ccResolvedJson({}, rel));
  return {
    opts: { root, revision, publishLockDir: join(root, "publish-lock") },
    fetch: ccFetch({ version: rel.version }),
  };
}

async function ccRoot() {
  const root = await Deno.realPath(await testTempDir());
  const docker = new FakeDocker();
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1"]);
  return { root, docker, baseId };
}

Deno.test("harnessImagesBuild (H-03): claude-code resolves the newest release, builds both tags in one build with the package labels, reads them back and prints the freeze record", async () => {
  const { root, docker, baseId } = await ccRoot();
  const id = `sha256:${"c".repeat(64)}`;
  const b = ccBuild(docker, root, id, {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.base_digest": baseId,
  }, { revision: "3" });
  const calls: { url: string }[] = [];
  const printed: string[] = [];
  const log = stub(console, "log", (...a: unknown[]) => {
    printed.push(a.map(String).join(" "));
  });
  let f;
  try {
    f = await harnessImagesBuild(
      "claude-code",
      b.opts,
      docker,
      ccFetch({ calls }),
    );
  } finally {
    log.restore();
  }
  assertEquals(calls.map((c) => c.url), [CC_MAIN_URL, ccWinUrl()]);
  assertEquals(docker.builds.length, 1, "one build");
  const args = docker.builds[0]!;
  // H-03 run 002: the build itself publishes no tag (--iidfile); both tags
  // land afterwards on the one id it captured.
  assert(!args.includes("-t") && args.includes("--iidfile"), "untagged build");
  assertEquals(docker.tagCalls, [
    [id, "centralgauge/harness-claude-code:2.1.296-r3"],
    [id, "centralgauge/harness-claude-code:latest-r3"],
  ]);
  for (
    const [flag, value] of [
      ["--build-arg", `CLAUDE_CODE_VERSION=${CC_REL.version}`],
      ["--build-arg", `CLAUDE_CODE_INTEGRITY=${CC_REL.main.integrity}`],
      [
        "--build-arg",
        `CLAUDE_CODE_WIN_INTEGRITY=${CC_REL.win32_x64.integrity}`,
      ],
      ...Object.entries(ccLabels()).map(([k, v]) => ["--label", `${k}=${v}`]),
    ]
  ) {
    const i = args.indexOf(value!);
    assert(
      i > 0 && args[i - 1] === flag && i < args.indexOf("--iidfile"),
      value,
    );
  }
  assertEquals(
    args.filter((a) => a.startsWith("centralgauge.harness.version=")),
    [`centralgauge.harness.version=${CC_REL.version}`],
  );
  assertEquals(f.version, CC_REL.version);
  assertEquals(f.package?.integrity.main, CC_REL.main.integrity);
  const out = printed.join("\n");
  assertStringIncludes(
    out,
    `Claude Code ${CC_REL.version} (npm latest): @anthropic-ai/claude-code ${CC_REL.main.integrity} + @anthropic-ai/claude-code-win32-x64 ${CC_REL.win32_x64.integrity}`,
  );
  assertStringIncludes(out, "freeze record");
  assertStringIncludes(out, `"digest":"${id}"`);
  assert(
    !await exists(join(root, "publish-lock", ".bench-running.json")),
    "the publication lock is released",
  );
});

Deno.test("harnessImagesBuild (H-03): --version is refused for claude-code (an existing or frozen tag first); the revision must be 3 or later", async () => {
  const { root, docker } = await ccRoot();
  const lock = join(root, "publish-lock");
  const calls: { url: string }[] = [];
  const fetch = ccFetch({ calls });
  await assertRejects(
    () =>
      harnessImagesBuild(
        "claude-code",
        { root, version: "2.1.296", revision: "3", publishLockDir: lock },
        docker,
        fetch,
      ),
    ConfigurationError,
    "--version 2.1.296 is refused",
  );
  for (const revision of [undefined, "1", "2", "2-dev-H-03"]) {
    await assertRejects(
      () =>
        harnessImagesBuild(
          "claude-code",
          { root, publishLockDir: lock, ...(revision ? { revision } : {}) },
          docker,
          fetch,
        ),
      ConfigurationError,
      "--revision 3 or later",
      String(revision),
    );
  }
  assertEquals([calls, docker.builds], [[], []], "nothing resolved or built");
});

Deno.test("harnessImagesBuild (H-03): either existing tag, a held publication lock or a recorded (frozen) revision refuses before any build", async () => {
  const { root, docker, baseId } = await ccRoot();
  const id = `sha256:${"c".repeat(64)}`;
  const b = ccBuild(docker, root, id, {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.base_digest": baseId,
  }, { revision: "3" });
  for (
    const tag of [
      "centralgauge/harness-claude-code:2.1.296-r3",
      "centralgauge/harness-claude-code:latest-r3",
    ]
  ) {
    docker.addImage(tag, `sha256:${"9".repeat(64)}`, {}, ["l1"]);
    await assertRejects(
      () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
      ConfigurationError,
      `${tag} already exists`,
    );
    docker.tags.delete(tag);
  }
  // Another build on this host holds the publication lock: refused, not waited.
  const held = acquireBenchLock(b.opts.publishLockDir, {
    command: "other build",
  });
  try {
    await assertRejects(
      () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
      BenchLockHeldError,
    );
  } finally {
    await held();
  }
  // A recorded revision is never built again, present locally or not.
  const calls: { url: string }[] = [];
  await assertRejects(
    () =>
      harnessImagesBuild(
        "claude-code",
        {
          ...b.opts,
          frozen: {
            "3": {
              version: "2.1.290",
              digest: `sha256:${"7".repeat(64)}`,
              integrity: {
                main: CC_REL.main.integrity,
                win32_x64: CC_REL.win32_x64.integrity,
              },
            },
          },
        },
        docker,
        ccFetch({ calls }),
      ),
    ConfigurationError,
    "claude-code revision 3 is frozen",
  );
  assertEquals(calls, [], "refused before resolution");
  assertEquals(docker.builds, [], "no build");
});

Deno.test("harnessImagesBuild (H-03): the read-back must match this build's resolution: alias on the same id, version, package, shipped resolved file", async () => {
  const cases: [string, (d: FakeDocker, id: string) => void, string][] = [
    ["alias elsewhere", (d) => {
      const realBuild = d.build.bind(d);
      d.build = async (args) => {
        const code = await realBuild(args);
        // H-03 run 002: a real image (docker never holds a dangling tag).
        d.addImage(
          "centralgauge/harness-claude-code:latest-r3",
          `sha256:${"9".repeat(64)}`,
          {},
          ["l1"],
        );
        return code;
      };
    }, "latest-r3"],
    ["version", (d, id) => {
      const r = d.buildResults.get(
        "centralgauge/harness-claude-code:2.1.296-r3",
      )!;
      d.buildResults.set("centralgauge/harness-claude-code:2.1.296-r3", {
        ...r,
        labels: { ...r.labels, ...ccLabels(ccRel("2.1.295")) },
      });
      d.shipFile(
        id,
        CLAUDE_CODE_RESOLVED,
        ccResolvedJson({}, ccRel("2.1.295")),
      );
    }, "2.1.295"],
    ["no package", (d) => {
      const r = d.buildResults.get(
        "centralgauge/harness-claude-code:2.1.296-r3",
      )!;
      const labels = { ...r.labels };
      delete labels["centralgauge.harness.track"];
      delete labels["centralgauge.harness.package"];
      d.buildResults.set("centralgauge/harness-claude-code:2.1.296-r3", {
        ...r,
        labels,
      });
    }, "centralgauge.harness.package"],
    ["resolved file", (d, id) => {
      d.shipFile(
        id,
        CLAUDE_CODE_RESOLVED,
        ccResolvedJson({ version: "2.1.295" }),
      );
    }, "claude-code-resolved.json"],
  ];
  for (const [name, tamper, msg] of cases) {
    const { root, docker, baseId } = await ccRoot();
    const id = `sha256:${"c".repeat(64)}`;
    const b = ccBuild(docker, root, id, {
      "centralgauge.harness": "claude-code",
      "centralgauge.harness.base_digest": baseId,
    }, { revision: "3" });
    tamper(docker, id);
    const log = stub(console, "log", () => {});
    try {
      const err = await assertRejects(
        () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
        ConfigurationError,
        undefined,
        name,
      );
      assertStringIncludes(err.message, msg, name);
    } finally {
      log.restore();
    }
    assert(
      !await exists(join(b.opts.publishLockDir, ".bench-running.json")),
      `${name}: the publication lock is released on failure`,
    );
  }
});

Deno.test("harnessImagesBuild (H-03): a failed read-back removes both tags this build created", async () => {
  const resolvedTag = "centralgauge/harness-claude-code:2.1.296-r3";
  const aliasTag = "centralgauge/harness-claude-code:latest-r3";
  for (const name of ["alias elsewhere", "version"]) {
    const { root, docker, baseId } = await ccRoot();
    const id = `sha256:${"c".repeat(64)}`;
    const b = ccBuild(docker, root, id, {
      "centralgauge.harness": "claude-code",
      "centralgauge.harness.base_digest": baseId,
    }, { revision: "3" });
    if (name === "alias elsewhere") {
      const realBuild = docker.build.bind(docker);
      docker.build = async (args) => {
        const code = await realBuild(args);
        // H-03 run 002: a real image (docker never holds a dangling tag).
        docker.addImage(aliasTag, `sha256:${"9".repeat(64)}`, {}, ["l1"]);
        return code;
      };
    } else {
      const r = docker.buildResults.get(resolvedTag)!;
      docker.buildResults.set(resolvedTag, {
        ...r,
        labels: { ...r.labels, ...ccLabels(ccRel("2.1.295")) },
      });
      docker.shipFile(
        id,
        CLAUDE_CODE_RESOLVED,
        ccResolvedJson({}, ccRel("2.1.295")),
      );
    }
    const log = stub(console, "log", () => {});
    try {
      await assertRejects(
        () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
        ConfigurationError,
        undefined,
        name,
      );
    } finally {
      log.restore();
    }
    assertEquals(await docker.inspectImage(resolvedTag), null, name);
    // H-03 run 002 item 4: a tag naming another image is not this build's to
    // remove (it is never tagged over either).
    if (name === "alias elsewhere") {
      assertEquals(docker.tags.get(aliasTag), `sha256:${"9".repeat(64)}`);
    } else {
      assertEquals(await docker.inspectImage(aliasTag), null, name);
    }
  }
});

Deno.test("harnessImagesBuild (H-03): --version with the named resolved tag already present refuses as an existing tag, before the --version refusal", async () => {
  const { root, docker } = await ccRoot();
  docker.addImage(
    "centralgauge/harness-claude-code:2.1.296-r3",
    `sha256:${"9".repeat(64)}`,
    {},
    ["l1"],
  );
  const calls: { url: string }[] = [];
  const err = await assertRejects(
    () =>
      harnessImagesBuild(
        "claude-code",
        {
          root,
          version: "2.1.296",
          revision: "3",
          publishLockDir: join(root, "publish-lock"),
        },
        docker,
        ccFetch({ calls }),
      ),
    ConfigurationError,
    "centralgauge/harness-claude-code:2.1.296-r3 already exists",
  );
  assert(!err.message.includes("is refused"), err.message);
  assertEquals([calls, docker.builds], [[], []], "nothing resolved or built");
});

Deno.test("harnessImagesBuild (H-03): a held publication lock refuses before any registry fetch or docker build", async () => {
  const { root, docker, baseId } = await ccRoot();
  const b = ccBuild(docker, root, `sha256:${"c".repeat(64)}`, {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.base_digest": baseId,
  }, { revision: "3" });
  const calls: { url: string }[] = [];
  const held = acquireBenchLock(b.opts.publishLockDir, {
    command: "other build",
  });
  try {
    await assertRejects(
      () =>
        harnessImagesBuild("claude-code", b.opts, docker, ccFetch({ calls })),
      BenchLockHeldError,
    );
  } finally {
    await held();
  }
  assertEquals(calls, [], "no registry fetch");
  assertEquals(docker.builds, [], "no docker build");
});

// ---- H-03 run 002: fenced, daemon-wide, id-verified, transactional publication ----

const CC_TAG = "centralgauge/harness-claude-code:2.1.296-r3";
const CC_ALIAS = "centralgauge/harness-claude-code:latest-r3";

/** Another build reclaimed the (stale) reservation: the marker now carries its token. */
async function reclaimReservation(dir: string) {
  const now = new Date().toISOString();
  await Deno.writeTextFile(
    benchLockPath(dir),
    JSON.stringify({
      pid: 1,
      startedAt: now,
      heartbeatAt: now,
      command: "other build",
      token: "other-token",
    }),
  );
}

/** Runs fn once, the moment both final tags first name `id` (after the build or after a docker tag). */
function onPublished(
  docker: FakeDocker,
  id: string,
  fn: () => void | Promise<void>,
) {
  let fired = false;
  const check = async () => {
    if (
      !fired && docker.tags.get(CC_TAG) === id &&
      docker.tags.get(CC_ALIAS) === id
    ) {
      fired = true;
      await fn();
    }
  };
  const build = docker.build.bind(docker);
  docker.build = async (args) => {
    const code = await build(args);
    await check();
    return code;
  };
  const tag = docker.tag.bind(docker);
  docker.tag = async (src, ref) => {
    const code = await tag(src, ref);
    await check();
    return code;
  };
}

async function ccPublication(o: { lsp?: boolean } = {}) {
  const { root, docker, baseId } = await ccRoot();
  const id = `sha256:${"c".repeat(64)}`;
  const labels: Record<string, string> = {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.base_digest": baseId,
  };
  if (o.lsp) {
    await Deno.mkdir(join(root, "harness", "images", "claude-code", "lsp"), {
      recursive: true,
    });
    await Deno.copyFile(AL_LSP_DEF, join(root, AL_LSP_DEF));
  }
  const b = ccBuild(docker, root, id, labels, { revision: "3" });
  return { root, docker, baseId, id, b };
}

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const log = stub(console, "log", () => {});
  const warn = stub(console, "warn", () => {});
  try {
    return await fn();
  } finally {
    log.restore();
    warn.restore();
  }
}

Deno.test("harnessImagesBuild (H-03 run 002): a reservation taken over during the build publishes nothing and removes nothing", async () => {
  const { docker, id, b } = await ccPublication();
  const build = docker.build.bind(docker);
  docker.build = async (args) => {
    const code = await build(args);
    // The build completes after another build reclaimed the reservation.
    await reclaimReservation(b.opts.publishLockDir);
    return code;
  };
  const err = await quietly(() =>
    assertRejects(
      () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
      ConfigurationError,
    )
  );
  assertStringIncludes(err.message, "reservation");
  assertStringIncludes(err.message, id, "the untagged image is named");
  assertEquals(docker.tags.has(CC_TAG), false, "no tag published");
  assertEquals(docker.tags.has(CC_ALIAS), false, "no alias published");
  assertEquals(docker.untags, [], "nothing removed");
  assertEquals(
    readBenchLock(b.opts.publishLockDir)?.token,
    "other-token",
    "the new holder's reservation is left alone",
  );
});

Deno.test("harnessImagesBuild (H-03 run 002): a reservation taken over between the two tags publishes no second tag and removes nothing", async () => {
  const { docker, id, b } = await ccPublication();
  const tag = docker.tag.bind(docker);
  let n = 0;
  docker.tag = async (src, ref) => {
    const code = await tag(src, ref);
    if (++n === 1) await reclaimReservation(b.opts.publishLockDir);
    return code;
  };
  const err = await quietly(() =>
    assertRejects(
      () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
      ConfigurationError,
    )
  );
  assertStringIncludes(err.message, "reservation");
  assertEquals(docker.tagCalls, [[id, CC_TAG]], "the second tag never ran");
  assertEquals(docker.tags.has(CC_ALIAS), false, "no alias published");
  assertEquals(docker.untags, [], "nothing removed after the takeover");
  assertEquals(docker.tags.get(CC_TAG), id, "left for the operator");
  assertEquals(readBenchLock(b.opts.publishLockDir)?.token, "other-token");
});

Deno.test("harnessImagesBuild (H-03 run 002): a reservation taken over before the cleanup of a rejected image removes nothing", async () => {
  const { docker, id, b } = await ccPublication();
  // A read-back failure (another version than resolved) ...
  const r = docker.buildResults.get(CC_TAG)!;
  docker.buildResults.set(CC_TAG, {
    ...r,
    labels: { ...r.labels, ...ccLabels(ccRel("2.1.295")) },
  });
  docker.shipFile(
    id,
    CLAUDE_CODE_RESOLVED,
    ccResolvedJson({}, ccRel("2.1.295")),
  );
  // ... with the reservation reclaimed while this build reads the image.
  const read = docker.readImageFile.bind(docker);
  docker.readImageFile = async (image, path, owner) => {
    await reclaimReservation(b.opts.publishLockDir);
    return await read(image, path, owner);
  };
  await quietly(() =>
    assertRejects(
      () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
      ConfigurationError,
    )
  );
  assertEquals(docker.untags, [], "no tag removed without the reservation");
  assertEquals(docker.tags.get(CC_TAG), id);
  assertEquals(docker.tags.get(CC_ALIAS), id);
  assertEquals(readBenchLock(b.opts.publishLockDir)?.token, "other-token");
});

Deno.test("harnessImagesBuild (H-03 run 002): two users' environments against one Docker daemon share one machine-wide reservation", async () => {
  const { root, docker, b } = await ccPublication();
  const programData = join(root, "ProgramData");
  // The shared root already exists (its ACL is set when it is created).
  await Deno.mkdir(join(programData, "centralgauge", "image-locks"), {
    recursive: true,
  });
  const keys = [
    "ProgramData",
    "LOCALAPPDATA",
    "USERPROFILE",
    "CENTRALGAUGE_DOCKER_CONTEXT",
  ];
  const saved = keys.map((k) => [k, Deno.env.get(k)] as const);
  const asUser = (name: string) => {
    Deno.env.set("USERPROFILE", join(root, "Users", name));
    Deno.env.set("LOCALAPPDATA", join(root, "Users", name, "AppData", "Local"));
  };
  Deno.env.set("ProgramData", programData);
  Deno.env.set("CENTRALGAUGE_DOCKER_CONTEXT", "desktop-windows");
  __setContextListerForTests(undefined);
  // No publishLockDir: the default reservation.
  const opts = { root, revision: "3" };
  let inBuild!: () => void;
  const building = new Promise<void>((r) => (inBuild = r));
  let finish!: () => void;
  const gate = new Promise<void>((r) => (finish = r));
  const build = docker.build.bind(docker);
  docker.build = async (args) => {
    inBuild();
    await gate;
    return await build(args);
  };
  try {
    asUser("alice");
    const alice = quietly(() =>
      harnessImagesBuild("claude-code", opts, docker, b.fetch)
    );
    await building;
    asUser("bob");
    const bobDocker = new FakeDocker();
    bobDocker.addImage(BASE_IMAGE, `sha256:${"b".repeat(64)}`, {}, ["l1"]);
    await assertRejects(
      () => harnessImagesBuild("claude-code", opts, bobDocker, b.fetch),
      BenchLockHeldError,
    );
    assertEquals(bobDocker.builds, [], "bob builds nothing");
    assert(
      await exists(
        benchLockPath(
          join(
            programData,
            "centralgauge",
            "image-locks",
            "desktop-windows",
            "claude-code",
          ),
        ),
      ),
      "the reservation is under ProgramData, keyed by the Docker context",
    );
    finish();
    await alice;
  } finally {
    finish();
    for (const [k, v] of saved) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
    __setContextListerForTests(undefined);
  }
});

Deno.test("harnessImagesBuild (H-03 run 002): both tags retargeted together to another image with matching labels are refused (read back against the build's own id)", async () => {
  const { docker, baseId, id, b } = await ccPublication();
  const other = `sha256:${"e".repeat(64)}`;
  const r = docker.buildResults.get(CC_TAG)!;
  onPublished(docker, id, () => {
    docker.addImage(CC_TAG, other, r.labels, ["l1", "l9"]);
    docker.tags.set(CC_ALIAS, other);
  });
  docker.shipFile(other, CLAUDE_CODE_RESOLVED, ccResolvedJson());
  const err = await quietly(() =>
    assertRejects(
      () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
      ConfigurationError,
    )
  );
  assertStringIncludes(err.message, id, "named against this build's id");
  assertEquals(docker.tags.get(CC_TAG), other, "another image's tag is kept");
  assertEquals(docker.tags.get(CC_ALIAS), other);
  assert(baseId !== other);
});

for (
  const [name, tamper, msg] of [
    ["base layers", (d: FakeDocker) => {
      const r = d.buildResults.get(CC_TAG)!;
      d.buildResults.set(CC_TAG, { ...r, layers: ["x1", "x2"] });
    }, "was not built on base"],
    ["shipped file", (d: FakeDocker, id: string) => {
      d.shipFile(
        id,
        CLAUDE_CODE_RESOLVED,
        ccResolvedJson({ version: "2.1.295" }),
      );
    }, "claude-code-resolved.json"],
    ["revision", (d: FakeDocker) => {
      const r = d.buildResults.get(CC_TAG)!;
      // The build is named by its revision label; the result lands with another.
      const fake = d.build.bind(d);
      d.build = async (args) => {
        const code = await fake(args);
        const img = d.images.get(r.id) as {
          Config: { Labels: Record<string, string> };
        };
        img.Config.Labels = {
          ...img.Config.Labels,
          "centralgauge.harness.revision": "4",
        };
        return code;
      };
    }, "centralgauge.harness.revision is 4"],
    ["LSP", () => {}, "did not land"],
  ] as const
) {
  Deno.test(`harnessImagesBuild (H-03 run 002): a ${name} failure after publication removes both final tags`, async () => {
    const { docker, id, b } = await ccPublication({ lsp: name === "LSP" });
    tamper(docker, id);
    const err = await quietly(() =>
      assertRejects(
        () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
        ConfigurationError,
      )
    );
    assertStringIncludes(err.message, msg);
    assertEquals(docker.tags.has(CC_TAG), false, `${name}: ${CC_TAG}`);
    assertEquals(docker.tags.has(CC_ALIAS), false, `${name}: ${CC_ALIAS}`);
    assert(
      !await exists(benchLockPath(b.opts.publishLockDir)),
      "the reservation is released afterwards",
    );
  });
}

Deno.test("harnessImagesBuild (H-03 run 002): a read-back failure removes this build's tags under the reservation, never another image's", async () => {
  const { docker, id, b } = await ccPublication();
  const foreign = `sha256:${"9".repeat(64)}`;
  docker.addImage("centralgauge/other:x", foreign, {}, ["l1"]);
  onPublished(docker, id, () => {
    docker.tags.set(CC_ALIAS, foreign);
  });
  const held: (string | undefined)[] = [];
  const untag = docker.untag.bind(docker);
  docker.untag = async (ref) => {
    held.push(readBenchLock(b.opts.publishLockDir)?.token);
    return await untag(ref);
  };
  const err = await quietly(() =>
    assertRejects(
      () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
      ConfigurationError,
    )
  );
  assertStringIncludes(err.message, "latest-r3");
  assertEquals(docker.untags, [CC_TAG], "only the tag naming this build");
  assertEquals(
    docker.tags.get(CC_ALIAS),
    foreign,
    "another image's alias kept",
  );
  assert(
    held.length === 1 && held[0] !== undefined && held[0] !== "other-token",
    `removed while this build held the reservation: ${held}`,
  );
});

Deno.test("harnessImagesBuild (H-03 run 002): the cleanup attempts both tags when the first removal fails, and the original failure is reported", async () => {
  const { docker, id, b } = await ccPublication();
  const r = docker.buildResults.get(CC_TAG)!;
  docker.buildResults.set(CC_TAG, {
    ...r,
    labels: { ...r.labels, ...ccLabels(ccRel("2.1.295")) },
  });
  docker.shipFile(
    id,
    CLAUDE_CODE_RESOLVED,
    ccResolvedJson({}, ccRel("2.1.295")),
  );
  const untag = docker.untag.bind(docker);
  docker.untag = async (ref) => {
    if (ref === CC_TAG) throw new Error("rmi failed");
    return await untag(ref);
  };
  const err = await quietly(() =>
    assertRejects(
      () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
      ConfigurationError,
    )
  );
  assertStringIncludes(err.message, "2.1.295");
  assertEquals(docker.tags.has(CC_ALIAS), false, "the alias is still removed");
});

Deno.test({
  name:
    "publicationLockDir (H-03 run 002): ProgramData, keyed by the Docker context; the root is shared with BUILTIN\\Users (inherited Modify) when created",
  ignore: Deno.build.os !== "windows",
  fn: async () => {
    const pd = await Deno.realPath(await testTempDir());
    const root = join(pd, "centralgauge", "image-locks");
    const saved = Deno.env.get("CENTRALGAUGE_DOCKER_CONTEXT");
    Deno.env.set("CENTRALGAUGE_DOCKER_CONTEXT", "desktop-windows");
    __setContextListerForTests(undefined);
    try {
      const calls: string[][] = [];
      const ok = (args: string[]) => {
        calls.push(args);
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      };
      assertEquals(
        await publicationLockDir(pd, ok),
        join(root, "desktop-windows", "claude-code"),
      );
      assertEquals(calls, [[root, "/grant", "*S-1-5-32-545:(OI)(CI)M"]]);
      await publicationLockDir(pd, ok);
      assertEquals(calls.length, 1, "an existing root is not re-granted");
      // A failed grant leaves no unshared root behind.
      await Deno.remove(root);
      await assertRejects(
        () =>
          publicationLockDir(
            pd,
            () => Promise.resolve({ code: 5, stdout: "", stderr: "denied" }),
          ),
        ConfigurationError,
        "denied",
      );
      assertEquals(await exists(root), false);
      await assertRejects(
        () => publicationLockDir("", ok),
        ConfigurationError,
        "ProgramData is not set",
      );
    } finally {
      if (saved === undefined) {
        Deno.env.delete("CENTRALGAUGE_DOCKER_CONTEXT");
      } else Deno.env.set("CENTRALGAUGE_DOCKER_CONTEXT", saved);
      __setContextListerForTests(undefined);
    }
  },
});

import { clearPublicationReservation } from "../../../../cli/commands/harness-command.ts";
import { testTempDir, trackTempDir } from "../../../utils/temp-dir.ts";

/** A reservation whose holder stopped heartbeating an hour ago (crashed or suspended). */
async function staleReservation(dir: string) {
  await Deno.mkdir(dir, { recursive: true });
  await reclaimReservation(dir);
  const old = new Date(Date.now() - 3_600_000);
  await Deno.utime(benchLockPath(dir), old, old);
}

Deno.test("harnessImagesBuild (H-03 run 003): a stale publication reservation is never taken over: a second build is refused and builds nothing", async () => {
  const { docker, b } = await ccPublication();
  await staleReservation(b.opts.publishLockDir);
  const err = await quietly(() =>
    assertRejects(
      () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
      BenchLockHeldError,
    )
  );
  assertStringIncludes(err.message, "pid 1");
  assertEquals(docker.builds, [], "nothing built");
  assertEquals(docker.tagCalls, [], "nothing tagged");
  assertEquals(
    readBenchLock(b.opts.publishLockDir)?.token,
    "other-token",
    "the stale holder's reservation is left in place",
  );
});

Deno.test("clearPublicationReservation (H-03 run 003): the manual clear names the holder, refuses a wrong or live holder, is logged, and frees the next build", async () => {
  const { docker, b } = await ccPublication();
  const dir = b.opts.publishLockDir;
  // A live (heartbeating) holder is never cleared.
  await Deno.mkdir(dir, { recursive: true });
  await reclaimReservation(dir);
  await assertRejects(
    () =>
      quietly(() =>
        clearPublicationReservation({ dir, holder: "other-token" })
      ),
    ConfigurationError,
    "heartbeat",
  );
  await staleReservation(dir);
  await assertRejects(
    () => quietly(() => clearPublicationReservation({ dir, holder: "wrong" })),
    ConfigurationError,
    "other-token",
  );
  assertEquals(readBenchLock(dir)?.token, "other-token", "kept on refusal");
  const logged: string[] = [];
  const log = stub(console, "log", (...a: unknown[]) => {
    logged.push(a.join(" "));
  });
  try {
    await clearPublicationReservation({ dir, holder: "other-token" });
  } finally {
    log.restore();
  }
  assertEquals(await exists(benchLockPath(dir)), false, "cleared");
  assert(
    logged.some((l) => l.includes("other-token") && l.includes("pid 1")),
    `the clear is printed with its holder: ${logged}`,
  );
  const lines = (await Deno.readTextFile(join(dir, "clears.jsonl"))).trim()
    .split("\n");
  assertEquals(lines.length, 1);
  const rec = JSON.parse(lines[0]!);
  assertEquals(rec.holder.token, "other-token");
  assertEquals(rec.holder.pid, 1);
  assertEquals(typeof rec.at, "string");
  // Nothing left to clear.
  await assertRejects(
    () =>
      quietly(() =>
        clearPublicationReservation({ dir, holder: "other-token" })
      ),
    ConfigurationError,
    "no publication reservation",
  );
  await quietly(() =>
    harnessImagesBuild("claude-code", b.opts, docker, b.fetch)
  );
  assertEquals(docker.tags.has(CC_TAG), true, "the next build publishes");
});

Deno.test("harnessImagesBuild (H-03 run 003): a non-zero docker rmi is a failed removal: both removals attempted, the failure reported in the leftover-tag warning", async () => {
  const { docker, id, b } = await ccPublication();
  const r = docker.buildResults.get(CC_TAG)!;
  docker.buildResults.set(CC_TAG, {
    ...r,
    labels: { ...r.labels, ...ccLabels(ccRel("2.1.295")) },
  });
  docker.shipFile(
    id,
    CLAUDE_CODE_RESOLVED,
    ccResolvedJson({}, ccRel("2.1.295")),
  );
  // The real wrapper's contract: docker rmi's exit code, never a throw.
  docker.untagCodes.set(CC_TAG, 1);
  const warned: string[] = [];
  const log = stub(console, "log", () => {});
  const warn = stub(console, "warn", (...a: unknown[]) => {
    warned.push(a.join(" "));
  });
  try {
    await assertRejects(
      () => harnessImagesBuild("claude-code", b.opts, docker, b.fetch),
      ConfigurationError,
      "2.1.295",
    );
  } finally {
    log.restore();
    warn.restore();
  }
  assertEquals(docker.untags, [CC_TAG, CC_ALIAS], "both removals attempted");
  assertEquals(docker.tags.get(CC_TAG), id, "the failed removal keeps its tag");
  assertEquals(docker.tags.has(CC_ALIAS), false);
  const w = warned.find((l) => l.includes("keeps tag"));
  assert(w, `a leftover-tag warning: ${warned}`);
  assertStringIncludes(w, `${CC_TAG} (docker rmi exit 1)`);
  assert(!w.includes(CC_ALIAS), "the removed alias is not named");
});

// ---- H-09: judging decoupled from agent slots ----

Deno.test("registerHarnessCommand (H-09): run takes --judge-containers and --judge-concurrency, cell --defer-judging; judge-pending exists", () => {
  const cli = new Command();
  registerHarnessCommand(cli);
  const harness = cli.getCommand("harness")!;
  const has = (cmd: string, opt: string) =>
    harness.getCommand(cmd)?.getOption(opt) !== undefined;
  assert(has("run", "judge-containers"));
  assert(has("run", "judge-concurrency"));
  assert(has("cell", "defer-judging"));
  assert(has("judge-pending", "judge-concurrency"));
  assert(has("judge-pending", "containers"));
});

Deno.test("openHarnessEnv (H-09): judge containers get their own lane; overlapping, refused or unallocated ones are refused before the lock", async () => {
  await using t = await makeEnv();
  const order: string[] = [];
  const judged = (agents: string[], judges: string[]) => ({
    ...envOpts(t, agents),
    judgeContainers: judges,
  });
  await assertRejects(
    () => openHarnessEnv(judged(["Cronus281"], ["cronus281"]), deps(order)),
    ConfigurationError,
    "judge",
  );
  await assertRejects(
    () => openHarnessEnv(judged(["Cronus281"], ["Cronus28"]), deps(order)),
    ConfigurationError,
    "Cronus28",
  );
  const d = deps(order);
  d.allocated = (c) =>
    c === "Cronus281"
      ? Promise.resolve(c)
      : Promise.reject(new ValidationError(`${c} is not allocated`, [c]));
  await assertRejects(
    () => openHarnessEnv(judged(["Cronus281"], ["Cronus283"]), d),
    ValidationError,
    "Cronus283",
  );
  assertEquals(order, []);
  const h = await openHarnessEnv(
    judged(["Cronus281", "Cronus282"], ["Cronus283"]),
    deps(order),
  );
  try {
    assertEquals(h.env.lane.containers, ["Cronus281", "Cronus282"]);
    assertEquals(h.env.judgeLane?.containers, ["Cronus283"]);
  } finally {
    await h.close();
  }
  assertEquals(order.filter((x) => x === "setup").length, 1);
  assert(order.includes("health:Cronus281,Cronus282,Cronus283"), `${order}`);
});

Deno.test("harnessRun (H-09): --judge-containers reaches the environment and --judge-concurrency the campaign", async () => {
  const t = await makeEnv();
  await writeCatalog(t);
  await mockExperiment(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  const seen: EnvOptions[] = [];
  const open = (eo: EnvOptions) => {
    seen.push(eo);
    return Promise.resolve({ env: t.env, close: () => Promise.resolve() });
  };
  await assertRejects(
    () =>
      harnessRun(
        "contract",
        runOpts(t, { judgeContainers: ["Cronus283"], judgeConcurrency: 0 }),
        open,
      ),
    ConfigurationError,
    "judge concurrency",
  );
  assertEquals(seen.map((eo) => eo.judgeContainers), [["Cronus283"]]);
});

Deno.test("harnessCell --defer-judging (H-09): the cell is recorded unjudged; judge-pending judges it once, as the inline cell would", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.docker.behavior = mockImageBehavior();
  const open = () =>
    Promise.resolve({
      env: { ...t.env, supervised: false },
      close: () => Promise.resolve(),
    });
  const o = cellOpts(t, { supervised: false });
  const inline = await harnessCell(
    "mock-positive",
    "HX-001",
    o,
    open,
    () => false,
    noInterrupt,
  );
  const ref = (await t.env.store.judgments(inline.executions[0]!.id))[0]!;
  const r = await harnessCell(
    "mock-positive",
    "HX-001",
    { ...o, deferJudging: true },
    open,
    () => false,
    noInterrupt,
  );
  const e = r.executions[0]!;
  assertEquals(await t.env.store.judgments(e.id), []);
  assertEquals(await harnessJudgePending(o, open), 1);
  const js = await t.env.store.judgments(e.id);
  assertEquals(js.map((j) => [j.verdict, j.task_oracle_hash]), [
    [ref.verdict, ref.task_oracle_hash],
  ]);
  assertEquals(await harnessJudgePending(o, open), 0, "judged once");
});

Deno.test("harness judge-pending (H-09 run 002): --judge-concurrency below 1 is refused before the environment opens", async () => {
  const t = await makeEnv();
  let opened = 0;
  const open = () => {
    opened++;
    return Promise.resolve({ env: t.env, close: () => Promise.resolve() });
  };
  for (const judgeConcurrency of [0, -1, 1.5]) {
    await assertRejects(
      () => harnessJudgePending({ ...cellOpts(t), judgeConcurrency }, open),
      ConfigurationError,
      "judge concurrency",
    );
  }
  assertEquals(opened, 0);
});

Deno.test("harness judge-pending (H-09 run 002): a later failure drains the queued judgments before the environment closes", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.docker.behavior = mockImageBehavior();
  let judgedAtClose = -1;
  let good: ExecutionRecord | null = null;
  const open = () =>
    Promise.resolve({
      env: { ...t.env, supervised: false },
      close: async () => {
        if (good) {
          judgedAtClose = (await t.env.store.judgments(good.id)).length;
        }
      },
    });
  const o = { ...cellOpts(t, { supervised: false }), deferJudging: true };
  good = (await harnessCell(
    "mock-positive",
    "HX-001",
    o,
    open,
    () => false,
    noInterrupt,
  )).executions[0]!;
  // A later owed execution whose task no longer exists: loading it throws.
  await t.env.store.writeExecution({
    ...good,
    id: crypto.randomUUID(),
    task_id: "HX-404",
    started_at: new Date(Date.parse(good.started_at) + 1000).toISOString(),
  });
  judgedAtClose = -1;
  await assertRejects(() => harnessJudgePending(o, open));
  assertEquals(judgedAtClose, 1, "the queued judgment finished before close");
});

Deno.test("harness judge-pending (H-09 review): a refused execution is warned and skipped; the others are judged", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.docker.behavior = mockImageBehavior();
  const open = () =>
    Promise.resolve({
      env: { ...t.env, supervised: false },
      close: () => Promise.resolve(),
    });
  const o = { ...cellOpts(t, { supervised: false }), deferJudging: true };
  const cell = async () =>
    (await harnessCell(
      "mock-positive",
      "HX-001",
      o,
      open,
      () => false,
      noInterrupt,
    )).executions[0]!;
  const bad = await cell();
  const good = await cell();
  const side = join(t.env.resultsRoot, "runs", bad.id, "sandbox.json");
  const json = JSON.parse(await Deno.readTextFile(side));
  await Deno.writeTextFile(
    side,
    JSON.stringify({ ...json, pristine_hash: "0".repeat(64) }),
  );
  const lines: string[] = [];
  const log = stub(console, "log", (...a: unknown[]) => {
    lines.push(a.join(" "));
  });
  let n: number;
  try {
    n = await harnessJudgePending(o, open);
  } finally {
    log.restore();
  }
  assertEquals(n, 1);
  assertEquals(await t.env.store.judgments(bad.id), []);
  assertEquals((await t.env.store.judgments(good.id)).length, 1);
  assert(
    lines.some((l) => l.includes(bad.id) && l.includes("not judged")),
    lines.join("\n"),
  );
});

Deno.test("H-15: run --ignore-usage-reset with a blank reason is refused before planning or any environment", async () => {
  await using t = await makeEnv();
  for (const reason of ["", "  "]) {
    for (const dryRun of [true, false]) {
      await assertRejects(
        () =>
          harnessRun(
            "cc",
            runOpts(t, { dryRun, ignoreUsageReset: reason }),
            () => Promise.reject(new Error("refused before the environment")),
            () => Promise.reject(new Error("refused before planning")),
          ),
        ConfigurationError,
        "--ignore-usage-reset needs a non-empty reason",
      );
    }
  }
});

Deno.test("H-16 (Sol r2): close holds the locks until a backend request revoke gave up on has drained, so no successor recovers state it still uses", async () => {
  await using t = await makeEnv();
  const order: string[] = [];
  const h = await openHarnessEnv(
    { ...envOpts(t), backendPort: BACKEND_PORT },
    {
      ...deps(order),
      serveBackend: () => ({
        url: `http://${SANDBOX_NETWORK.gateway}:${BACKEND_PORT}`,
        shutdown: () => Promise.resolve(),
      }),
    },
  );
  let drain!: () => void;
  const late = new Promise<void>((r) => (drain = r));
  const idle = stub(h.env.backend, "idle", () => late);
  try {
    const closing = h.close();
    await new Promise((r) => setTimeout(r, 200));
    assertEquals(order.includes("release"), false, order.join(","));
    drain();
    await closing;
    assertEquals(order.filter((x) => x === "release").length, 1);
  } finally {
    idle.restore();
    await h.close();
  }
});

// ---- H-24: campaign rejudge spreads its judging over every lane container ----

/** A 3-container lane, a 6-execution campaign (2 arms x 3 repeats) and every judgment stale. */
async function h24Campaign() {
  const { BcLane } = await import("../../../../src/harness/bc-lane.ts");
  const t = await makeEnv();
  t.env.lane = new BcLane(t.bc, ["C1", "C2", "C3"]);
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await mockExperiment(t);
  await write(
    t.harnessRoot,
    "experiments/contract.yml",
    (await Deno.readTextFile(join(t.harnessRoot, "experiments/contract.yml")))
      .replace("repeats: 1", "repeats: 3"),
  );
  await runCampaign(t.env, "contract", {
    dryRun: false,
    concurrency: 1,
    maxPauseMs: 0,
  }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const es = await t.env.store.executions(c.id);
  for (const e of es) await staleJudgment(t, e.id);
  // Exclusive judging jobs in flight, the most seen at once, and per container.
  const lane = t.env.lane;
  const original = lane.exclusive.bind(lane);
  const seen = { active: 0, max: 0, containers: new Set<string>() };
  lane.exclusive = ((ctx, fn, signal, opts) =>
    original(
      ctx,
      async (container: string) => {
        seen.active++;
        seen.max = Math.max(seen.max, seen.active);
        seen.containers.add(container);
        try {
          await new Promise((r) => setTimeout(r, 30));
          return await fn(container);
        } finally {
          seen.active--;
        }
      },
      signal,
      opts,
    )) as typeof lane.exclusive;
  const counts = async () =>
    (await Promise.all(es.map((e) => t.env.store.judgments(e.id)))).map((js) =>
      js.length
    );
  return { t, es, seen, counts };
}

Deno.test("rejudge (H-24): N executions over 3 containers are all judged exactly once, in parallel", async () => {
  const { t, es, seen, counts } = await h24Campaign();
  assertEquals(es.length, 6);
  assertEquals(await counts(), [2, 2, 2, 2, 2, 2]);
  const r = await harnessRejudge("contract", runOpts(t), opener(t));
  assertEquals(r.rejudged, 6);
  assertEquals(await counts(), [3, 3, 3, 3, 3, 3]);
  assert(seen.max > 1, `judging ran one at a time (max ${seen.max})`);
  assert(seen.max <= 3, `more judgings than containers at once: ${seen.max}`);
  assertEquals([...seen.containers].sort(), ["C1", "C2", "C3"]);
  const again = await harnessRejudge("contract", runOpts(t), opener(t));
  assertEquals([again.rejudged, await counts()], [0, [3, 3, 3, 3, 3, 3]]);
});

Deno.test("rejudge (H-24): an infra fault on one container is rerouted; no judgment is lost or duplicated", async () => {
  const { t, seen, counts } = await h24Campaign();
  t.bc.broken.add("C2");
  const r = await harnessRejudge("contract", runOpts(t), opener(t));
  assertEquals(r.rejudged, 6);
  assertEquals(await counts(), [3, 3, 3, 3, 3, 3]);
  assert(seen.max > 1, `judging ran one at a time (max ${seen.max})`);
});

Deno.test("rejudge (H-24): a failing execution stops the rejudge without losing or duplicating the others; a resume judges only what is not current", async () => {
  const { t, es, counts } = await h24Campaign();
  // One execution's artifact record is unreadable: its judging throws.
  const bad = es[3]!;
  const art = join(t.env.resultsRoot, "artifacts", `${bad.id}.json`);
  const kept = await Deno.readTextFile(art);
  await Deno.remove(art);
  await assertRejects(() => harnessRejudge("contract", runOpts(t), opener(t)));
  const after = await counts();
  assert(
    after.every((n) => n === 2 || n === 3),
    `a judgment was duplicated: ${after}`,
  );
  assertEquals(after[3], 2, "the failing execution has no new judgment");
  await Deno.writeTextFile(art, kept);
  const r = await harnessRejudge("contract", runOpts(t), opener(t));
  assertEquals(r.rejudged, after.filter((n) => n === 2).length);
  assertEquals(await counts(), [3, 3, 3, 3, 3, 3]);
});

Deno.test("rejudge (H-24 review): after a failure the env closes only once every running judging has ended, and no queued judging starts after it", async () => {
  const { t, es, seen } = await h24Campaign();
  // The first execution's artifact read fails, but only once two other
  // judgings hold their container: the failure lands while they run.
  // (The first read is the campaign load before any judging starts.)
  const store = t.env.store;
  const read = store.artifact.bind(store);
  let reads = 0;
  store.artifact = async (id: string) => {
    if (id !== es[0]!.id || ++reads === 1) return await read(id);
    const until = Date.now() + 5_000;
    while (seen.active < 2 && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2));
    }
    throw new Error(`injected artifact read failure (active ${seen.active})`);
  };
  let closed = false;
  let activeAtClose = -1;
  let startedAfterClose = 0;
  const lane = t.env.lane;
  const counted = lane.exclusive.bind(lane);
  lane.exclusive = ((ctx, fn, signal, opts) => {
    if (closed) startedAfterClose++;
    return counted(ctx, fn, signal, opts);
  }) as typeof lane.exclusive;
  const open = () =>
    Promise.resolve({
      env: t.env,
      close: () => {
        closed = true;
        activeAtClose = seen.active;
        return Promise.resolve();
      },
    });
  await assertRejects(() => harnessRejudge("contract", runOpts(t), open));
  assert(closed, "the env was closed");
  assertEquals(activeAtClose, 0, "a judging was still running at close");
  await new Promise((r) => setTimeout(r, 100));
  assertEquals(startedAfterClose, 0, "a queued judging started after close");
});

// ---- H-35 S1.7 (design-r4 3.1): two build caches, never crossed ----

Deno.test("H-35: the env opens a judge and an agent build cache: judging and the agent backend never see each other's builds, and neither reads the old shared cache", async () => {
  const { buildCacheDir, dirBuildCache } = await import(
    "../../../../src/harness/bc-lane.ts"
  );
  await using t = await makeEnv();
  const o = envOpts(t);
  const pkg = join(o.privateRoot, "pkg.app");
  await Deno.mkdir(o.privateRoot, { recursive: true });
  await Deno.writeTextFile(pkg, "pkg");
  // A build the single H-27 cache holds from before the split.
  await dirBuildCache(join(o.privateRoot, "build-cache")).put("old", pkg);
  const h = await openHarnessEnv(o, deps([]));
  try {
    const judge = h.env.buildCache;
    const agent = h.env.backend["o"].buildCache;
    if (!judge || !agent) throw new Error("the env opens both build caches");
    await judge.put("judge-key", pkg);
    await agent.put("agent-key", pkg);
    assertEquals(await agent.get("judge-key"), null);
    assertEquals(await judge.get("agent-key"), null);
    assertEquals(await judge.get("old"), null);
    assertEquals(await agent.get("old"), null);
    assert(
      (await judge.get("judge-key"))!.startsWith(
        buildCacheDir(o.privateRoot, "judge"),
      ),
    );
    assert(
      (await agent.get("agent-key"))!.startsWith(
        buildCacheDir(o.privateRoot, "agent"),
      ),
    );
    assert(
      buildCacheDir(o.privateRoot, "judge") !==
        buildCacheDir(o.privateRoot, "agent"),
    );
  } finally {
    await h.close();
  }
});

Deno.test("H-35 S2.3: judging stores the task preimage under the judgment's oracle hash", async () => {
  await using t = await makeEnv();
  await git(t.repo.root, "add", ".");
  await git(t.repo.root, "commit", "-q", "-m", "tasks");
  await git(t.repo.root, "tag", "refapp-v1-rc1");
  const manifest = join(t.env.privateRoot, "qualify-manifest.json");
  await Deno.writeTextFile(
    manifest,
    JSON.stringify({
      v: 1,
      refapp_version: "refapp-v1",
      tasks: {
        "HX-001": { rev: "refapp-v1-rc1", positive: "correct", naive: ["a"] },
      },
    }),
  );
  const o = cellOpts(t, { rev: "refapp-v1-rc1", manifest });
  const pass = await harnessJudgeFixture("HX-001", "correct", o, opener(t));
  const { loadOracleDescriptor } = await import(
    "../../../../src/harness/task-oracle.ts"
  );
  const d = await loadOracleDescriptor(
    t.env.resultsRoot,
    pass.task_oracle_hash,
  );
  assert(d !== "unknown");
  assertEquals(d.kind, "bugfix");
});

Deno.test("rejudge (H-35 S2.5): freezes the pairing of every due execution with an old judgment before judging, and appends each new judgment", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await mockExperiment(t);
  await runCampaign(t.env, "contract", {
    dryRun: false,
    concurrency: 1,
    maxPauseMs: 0,
  }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const e = (await t.env.store.executions(c.id))[0]!;
  await unscoredJudgments(t, e.id, 1);
  const before = await t.env.store.judgments(e.id);
  const old = before.reduce((a, b) => (b.ended_at > a.ended_at ? b : a));
  const r = await harnessRejudge("contract", runOpts(t), opener(t));
  assertEquals(r.rejudged, 1);
  const dir = join(t.env.resultsRoot, "pairings");
  const frozen = [];
  for await (const f of Deno.readDir(dir)) {
    if (f.name.endsWith(".json")) frozen.push(f.name.slice(0, -5));
  }
  assertEquals(frozen.length, 1);
  const { pairing, completions } = await loadPairing(
    t.env.resultsRoot,
    frozen[0]!,
  );
  assertEquals(pairing.cohort.campaign, c.id);
  assertEquals(
    pairing.cells.map((x) => [x.execution_id, x.old_judgment_id]),
    [[e.id, old.id]],
  );
  const after = await t.env.store.judgments(e.id);
  assertEquals(completions.length, 1);
  assertEquals(completions[0]!.execution_id, e.id);
  assert(after.some((j) => j.id === completions[0]!.new_judgment_id));
  assert(!before.some((j) => j.id === completions[0]!.new_judgment_id));
  // `harness pairing` reconciles it: one completed pair, nothing pending.
  const report = await harnessPairing(frozen[0]!, t.env.resultsRoot);
  assertEquals([report.pairs, report.pending, report.missing], [1, [], []]);
  assertEquals(report.cells[0]!.old, "unscored");
  assert(report.cells[0]!.flags.includes("infra"));
});

Deno.test("H-35 orch Sol r1 #6: a campaign judgment records the env's harness commit in its provenance", async () => {
  await using t = await makeEnv();
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await mockExperiment(t);
  await runCampaign(t.env, "contract", {
    dryRun: false,
    concurrency: 1,
    maxPauseMs: 0,
  }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const e = (await t.env.store.executions(c.id))[0]!;
  const [j] = await t.env.store.judgments(e.id);
  assertEquals(j!.provenance?.harness_commit, t.env.harnessCommit);
  assertEquals(t.env.harnessCommit, "f".repeat(40));
});

Deno.test("H-35 S3.2 openHarnessEnv: --lineage gives judging the golden reset; without it judging refuses; a bad lineage stops the start", async () => {
  await using t = await makeEnv();
  // H-35 S3: v2 carries every section admission needs; its NST egress is
  // unenforced, so the run declares it.
  const lineage = await v2Lineage();
  const bcEgressOverride = "no NST firewall rule in the image";
  const bare = await openHarnessEnv(envOpts(t), deps([]));
  assertEquals(bare.env.deploy.reset.id, "unconfigured");
  // H-35 S3.4: no instance manifest yet, so the lineage run is refused.
  await bare.close();
  await assertRejects(
    () =>
      openHarnessEnv({ ...envOpts(t), lineage, bcEgressOverride }, deps([])),
    ConfigurationError,
    "no instance manifest",
  );
  // `harness baseline create` for each container (its reset faked here).
  const l = await loadLineage(lineage);
  const again = await openHarnessEnv(envOpts(t), deps([]));
  for (const c of again.env.lane.containers) {
    await createBaseline(
      again.env.lane.bc,
      {
        ...OK_RESET,
        id: "golden-restore",
        compat: { lineage: lineageCompat(l) },
      },
      c,
      {
        resultsRoot: join(t.repo.root, "results", "harness"),
        lineageId: l.id,
        lockDigest: await lockDigestOf({
          store: again.env.symbolStore,
          packages: again.env.symbols,
        }),
      },
    );
  }
  await again.close();
  // admitted, but the unenforced egress needs the run's declaration
  await assertRejects(
    () => openHarnessEnv({ ...envOpts(t), lineage }, deps([])),
    ConfigurationError,
    "--unverified-bc-egress-ok",
  );
  const h = await openHarnessEnv(
    { ...envOpts(t), lineage, bcEgressOverride },
    deps([]),
  );
  assertEquals(
    [h.env.deploy.reset.id, h.env.deploy.reset.policyVersion],
    ["golden-restore", 2],
  );
  assertEquals(h.env.deploy.bcEgress, {
    mode: "unenforced",
    override: bcEgressOverride,
  });
  await h.close();
  await assertRejects(
    () =>
      openHarnessEnv(
        { ...envOpts(t), lineage: join(t.repo.root, "missing.json") },
        deps([]),
      ),
    ConfigurationError,
    "reset lineage",
  );
});

Deno.test("H-35 Sol S3 r3: a dry run's plan env checks the lineage's NST egress as admission does and carries the override", async () => {
  await using t = await makeEnv();
  const lineage = resolve("infra/harness-reset/lineages/golden-o09-v2.json");
  await assertRejects(
    () => openPlanEnv({ ...envOpts(t), lineage }, planDeps(t, [])),
    ConfigurationError,
    "--unverified-bc-egress-ok",
  );
  const p = await openPlanEnv(
    { ...envOpts(t), lineage, bcEgressOverride: "r" },
    planDeps(t, []),
  );
  assertEquals(p.bcEgress, { mode: "unenforced", override: "r" });
  assertEquals(
    (await openPlanEnv(envOpts(t), planDeps(t, []))).bcEgress,
    undefined,
  );
});

Deno.test("H-35 S3.4 baselineCreate and envCheck: a created baseline makes the container admissible for its lineage; a container without one is not", async () => {
  await using t = await makeEnv();
  const lineage = await v2Lineage();
  const l = await loadLineage(lineage);
  // the production mechanism with its reset faked (every admission section)
  const fake = () => testResetFor(lineage, l);
  const o = {
    repoRoot: t.repo.root,
    containers: ["Cronus281"],
    lineage,
    symbolStore: t.repo.symbolStore,
    bcEgressOverride: "no NST firewall rule in the image",
  };
  const before = await envCheck(o, deps([]), fake);
  assertEquals(before.admissible, false);
  const made = await baselineCreate(o, deps([]), fake);
  assertEquals(made.map((m) => [m.container, m.lineage_id]), [[
    "Cronus281",
    "golden-o09-v2",
  ]]);
  const after = await envCheck(o, deps([]), fake);
  assert(after.admissible, renderEnvCheck(after));
  assertEquals(after.rows[0]!.env_fp, made[0]!.env_fp);
});

/** A FakeBc whose every method call is recorded by name. */
function recordingBc(calls: string[]): FakeBc {
  return new Proxy(new FakeBc(), {
    get(target, p, receiver) {
      const v = Reflect.get(target, p, receiver);
      return typeof v === "function"
        ? (...a: unknown[]) => {
          calls.push(String(p));
          return v.apply(target, a);
        }
        : v;
    },
  });
}

/** The v2 lineage's mechanism with its reset, inventory check and fsDigest faked. */
async function fakedGolden(
  calls: string[],
  step = { reset: true, verify: true, fs: true },
) {
  const lineage = await v2Lineage();
  const l = await loadLineage(lineage);
  const roots = l.fs!.roots;
  const clean = [...roots.map((r) => `D|16|0|${r}`), `T|${roots.length}`];
  const mechanism = () => ({
    ...testResetFor(lineage, l),
    reset: async (c: string) => {
      calls.push("reset");
      const r = await OK_RESET.reset(c);
      return step.reset
        ? r
        : { ...r, ok: false, failed_step: "restore", error: "boom" };
    },
    verifyClean: (c: string) => {
      calls.push("verifyClean");
      return Promise.resolve({
        container: c,
        ok: step.verify,
        diff: step.verify ? [] : ["+ app planted"],
        error: step.verify ? null : "inventory differs",
      });
    },
    fsDigest: () => {
      calls.push("fsDigest");
      return Promise.resolve(
        step.fs ? clean : [...clean.slice(0, -1), "E|C:\\Run\\my|denied"],
      );
    },
  });
  return { lineage, step, mechanism };
}

Deno.test("H-35 run 004 #2 envCheck is read-only: no setupContainers (prenuke, warmup), no lock, no reset; the bc is asked for its compiler identity only", async () => {
  await using t = await makeEnv();
  const calls: string[] = [];
  const order: string[] = [];
  const { lineage, mechanism } = await fakedGolden(calls);
  const d: EnvDeps = {
    ...deps(order),
    setup: () => {
      calls.push("setup");
      throw new Error("env check must not run setupContainers");
    },
    inspect: () => recordingBc(calls),
  };
  const c = await envCheck(
    {
      repoRoot: t.repo.root,
      containers: ["Cronus281"],
      lineage,
      symbolStore: t.repo.symbolStore,
      bcEgressOverride: "r",
    },
    d,
    mechanism,
  );
  assertEquals(c.rows.map((r) => [r.container, r.why]), [[
    "Cronus281",
    "no instance manifest",
  ]]);
  assertEquals(calls, ["harnessCompilerIdentity"]);
  assertEquals(order, []);
});

Deno.test("H-35 run 004 #3 a persisted quarantine: env check reports the container not admissible and a new environment refuses it before setup; harness recover clears it only after reset, inventory check and fsDigest all pass", async () => {
  await using t = await makeEnv();
  const calls: string[] = [];
  const order: string[] = [];
  const qDir = join(await testTempDir(), "q");
  const { lineage, step, mechanism } = await fakedGolden(calls);
  const d: EnvDeps = {
    ...deps(order),
    quarantineDir: () => qDir,
    setup: () => {
      calls.push("setup");
      throw new Error("a quarantined container must not be set up");
    },
  };
  const o = {
    repoRoot: t.repo.root,
    containers: ["Cronus281"],
    lineage,
    symbolStore: t.repo.symbolStore,
    bcEgressOverride: "no NST firewall rule in the image",
  };
  const resultsRoot = join(t.repo.root, "results", "harness");
  await baselineCreate(o, d, mechanism);
  assert((await envCheck(o, d, mechanism)).admissible);
  // an earlier environment quarantined it (another spelling of the name);
  // Sol r2 N4: a non-filesystem cause with a clean L4 after-capture
  const key = { name: "Cronus281", id: fakeId("Cronus281") };
  const reason = "reset of Cronus281 failed at restore: boom";
  await plantRecord(qDir, {
    state: "quarantined",
    container: "CRONUS281",
    id: key.id,
    reason,
    by: "test",
    pid: 1,
    fs_diff: [],
    fs_captured: true,
  });
  const c = await envCheck(o, d, mechanism);
  assertEquals(c.admissible, false);
  assertStringIncludes(c.rows[0]!.why!, `quarantined (${reason})`);
  await assertRejects(
    () => openHarnessEnv({ ...envOpts(t), lineage }, d),
    ConfigurationError,
    "quarantined container(s)",
  );
  assert(!calls.includes("setup"));
  // every failing step keeps the record and leaves no manifest
  for (const k of ["reset", "verify", "fs"] as const) {
    step[k] = false;
    await assertRejects(() => recoverContainer(o, d, mechanism));
    step[k] = true;
    assertEquals((await findRecords(qDir, key)).length, 1, `${k} failed`);
    assertEquals(await readInstanceManifest(resultsRoot, "Cronus281"), null);
  }
  calls.length = 0;
  order.length = 0;
  const m = await recoverContainer(o, d, mechanism);
  assertEquals(calls, ["reset", "verifyClean", "fsDigest"]);
  assertEquals(order, ["lock", "release"]);
  assertEquals(await findRecords(qDir, key), []);
  assertEquals(
    (await readInstanceManifest(resultsRoot, "Cronus281"))?.env_fp,
    m.env_fp,
  );
  assert((await envCheck(o, d, mechanism)).admissible);
  // H-35 run 004 Sol r1 H4: a crashed environment's in-use record refuses
  // the same way. Sol r2 N2/N4: recover refuses it while it may be live
  // (no --abandon, or another token), and with its token it still refuses:
  // no filesystem evidence, the container must be recreated
  const live = await plantRecord(qDir, {
    id: key.id,
    container: "Cronus281",
    state: "in_use",
    by: "HOST9 x",
    pid: 9,
  });
  const u = await envCheck(o, d, mechanism);
  assertStringIncludes(u.rows[0]!.why!, "in use by HOST9 x");
  calls.length = 0;
  for (const abandon of [null, crypto.randomUUID()]) {
    await assertRejects(
      () => recoverContainer({ ...o, abandon }, d, mechanism),
      ConfigurationError,
      `a live environment may hold it; if it is gone, pass --abandon ${live}`,
    );
  }
  await assertRejects(
    () => recoverContainer({ ...o, abandon: live }, d, mechanism),
    ConfigurationError,
    "no trustworthy filesystem evidence: the container must be recreated (lane-ops)",
  );
  assertEquals(calls, [], "every refusal comes before the reset");
  assertEquals(
    (await findRecords(qDir, key)).map((f) => f.record?.token),
    [live],
    "kept; recover's own claim is gone",
  );
});

Deno.test("H-35 run 004 Sol r1 H4 in-use records: written once per container (agent and judge lanes) before setup, deleted on a normal close, left while unclosed (a crash) and refusing every other environment", async () => {
  await using t = await makeEnv();
  await using other = await makeEnv();
  const qDir = join(await testTempDir(), "q");
  const states: string[] = [];
  const d = (): EnvDeps => {
    const x = deps([]);
    return {
      ...x,
      quarantineDir: () => qDir,
      setup: async (names) => {
        for (const n of names) {
          for (const f of await findRecords(qDir, { name: n, id: fakeId(n) })) {
            states.push(`${n}:${f.record?.state}`);
          }
        }
        return x.setup(names);
      },
    };
  };
  const key = (n: string) => ({ name: n, id: fakeId(n) });
  const two = { ...envOpts(t), judgeContainers: ["Cronus282"] };
  const h = await openHarnessEnv(two, d());
  assertEquals(states, ["Cronus281:in_use", "Cronus282:in_use"]);
  const files: string[] = [];
  for await (const e of Deno.readDir(qDir)) files.push(e.name);
  assertEquals(
    files.sort(),
    [fakeId("Cronus281"), fakeId("Cronus282")].map((i) => `${i}.json`).sort(),
  );
  // unclosed (as after a crash): the record stands and refuses another environment
  await assertRejects(
    () => openHarnessEnv(envOpts(other), d()),
    ConfigurationError,
    "Cronus281 (in use by HOST1 test (pid",
  );
  await h.close();
  assertEquals(await findRecords(qDir, key("Cronus281")), []);
  assertEquals(await findRecords(qDir, key("Cronus282")), []);
  // H-35 run 004 Sol r2 N3: a failed setup (it may have changed the
  // container) keeps the claim, loudly
  const bad = d();
  bad.setup = () => Promise.reject(new Error("setup failed"));
  const logged: string[] = [];
  const err = stub(
    console,
    "error",
    (...a: unknown[]) => void logged.push(a.join(" ")),
  );
  try {
    await assertRejects(
      () => openHarnessEnv(envOpts(t), bad),
      Error,
      "setup failed",
    );
  } finally {
    err.restore();
  }
  assertEquals(
    (await findRecords(qDir, key("Cronus281"))).map((f) => f.record?.state),
    ["in_use"],
  );
  assertStringIncludes(
    logged.join("\n"),
    "in-use record of Cronus281 kept",
  );
  assertStringIncludes(logged.join("\n"), "setup failed after it may have");
  await Deno.remove(recordFile(qDir, fakeId("Cronus281")));
  // a refusal before setup (another container held) releases this run's claims
  const k282 = await plantRecord(qDir, {
    state: "in_use",
    container: "Cronus282",
    id: fakeId("Cronus282"),
    by: "HOST2 run",
    pid: 2,
  });
  await assertRejects(
    () => openHarnessEnv(envOpts(t, ["Cronus281", "Cronus282"]), d()),
    ConfigurationError,
    "Cronus282 (in use by HOST2 run",
  );
  assertEquals(await findRecords(qDir, key("Cronus281")), []);
  assertEquals(
    (await findRecords(qDir, key("Cronus282"))).map((f) => f.record?.token),
    [k282],
  );
  await Deno.remove(recordFile(qDir, fakeId("Cronus282")));
  // an in-use record that cannot be written (a directory on its path) stops
  // the start before setup
  const squat = join(qDir, `${fakeId("Cronus281")}.json`);
  await Deno.mkdir(squat);
  states.length = 0;
  await assertRejects(
    () => openHarnessEnv(envOpts(t), d()),
    ConfigurationError,
    "in-use record",
  );
  assertEquals(states, []);
  await Deno.remove(squat);
});

Deno.test("H-35 run 004 Sol r1 H4 quarantine at close: a quarantined container keeps its record; one whose quarantine write failed keeps its in-use record; both refuse the next environment", async () => {
  await using t = await makeEnv();
  const qDir = join(await testTempDir(), "q");
  const d = (): EnvDeps => ({ ...deps([]), quarantineDir: () => qDir });
  const h = await openHarnessEnv(envOpts(t, ["Cronus281", "Cronus285"]), d());
  await h.env.lane.quarantine("Cronus281", "cleanup failed");
  const logged: string[] = [];
  const err = stub(
    console,
    "error",
    (...a: unknown[]) => void logged.push(a.join(" ")),
  );
  const rename = stub(
    Deno,
    "rename",
    () => Promise.reject(new Error("disk full")),
  );
  try {
    await h.env.lane.quarantine("Cronus285", "reset failed");
  } finally {
    rename.restore();
    err.restore();
  }
  assertStringIncludes(
    logged.join("\n"),
    "[FAIL] quarantine of Cronus285 NOT persisted",
  );
  await h.close();
  const a = await findRecords(qDir, {
    name: "Cronus281",
    id: fakeId("Cronus281"),
  });
  const b = await findRecords(qDir, {
    name: "Cronus285",
    id: fakeId("Cronus285"),
  });
  assertEquals(
    [
      a.map((f) => [f.record?.state, f.record?.reason]),
      b.map((f) => f.record?.state),
    ],
    [[["quarantined", "cleanup failed"]], ["in_use"]],
  );
  const e = await assertRejects(
    () => openHarnessEnv(envOpts(t, ["Cronus281", "Cronus285"]), d()),
    ConfigurationError,
    "quarantined container(s)",
  );
  assertStringIncludes(e.message, "Cronus281 (quarantined (cleanup failed))");
  assertStringIncludes(e.message, "Cronus285 (in use by HOST1 test");
});

Deno.test("H-35 run 004 Sol r1 H5 physical identity: a renamed container (same Docker id) and a replacement under the old name are both refused at env open and env check; an unreadable id refuses", async () => {
  await using t = await makeEnv();
  const qDir = join(await testTempDir(), "q");
  const calls: string[] = [];
  const { lineage, mechanism } = await fakedGolden(calls);
  const ids = new Map<string, string>([["cronus285", fakeId("Cronus281")]]);
  const d: EnvDeps = {
    ...deps([]),
    quarantineDir: () => qDir,
    containerId: (c) =>
      c === "Cronus283"
        ? Promise.reject(new Error("no such container"))
        : Promise.resolve(ids.get(c.toLowerCase()) ?? fakeId(c)),
  };
  await plantRecord(qDir, {
    state: "quarantined",
    container: "Cronus281",
    id: fakeId("Cronus281"),
    reason: "L4 dirty",
    by: "test",
    pid: 1,
  });
  const o = (c: string) => ({
    repoRoot: t.repo.root,
    containers: [c],
    lineage,
    symbolStore: t.repo.symbolStore,
    bcEgressOverride: "r",
  });
  // Cronus281 renamed to Cronus285: same id
  await assertRejects(
    () => openHarnessEnv(envOpts(t, ["Cronus285"]), d),
    ConfigurationError,
    "Cronus285 (quarantined (L4 dirty))",
  );
  assertStringIncludes(
    (await envCheck(o("Cronus285"), d, mechanism)).rows[0]!.why!,
    "quarantined (L4 dirty)",
  );
  // a new container under the old name: still refused until recover
  ids.set("cronus281", "f".repeat(64));
  await assertRejects(
    () => openHarnessEnv(envOpts(t), d),
    ConfigurationError,
    "Cronus281 (quarantined (L4 dirty))",
  );
  assertStringIncludes(
    (await envCheck(o("Cronus281"), d, mechanism)).rows[0]!.why!,
    "quarantined (L4 dirty)",
  );
  // no id: fail closed
  await assertRejects(
    () => openHarnessEnv(envOpts(t, ["Cronus283"]), d),
    ConfigurationError,
    "Cronus283 (container id unknown: no such container)",
  );
  const c = await envCheck(o("Cronus283"), d, mechanism);
  assertEquals(c.admissible, false);
  assertStringIncludes(c.rows[0]!.why!, "container id unknown");
  await assertRejects(
    () => recoverContainer(o("Cronus283"), d, mechanism),
    Error,
    "no such container",
  );
  assert(!calls.includes("reset"), "recover stops before its reset");
});

Deno.test("H-35 run 004 Sol r1 H6 recover: a recorded L4 diff must be remediated in the recovery capture (an added file absent, a changed one exactly its before line); otherwise the quarantine stays", async () => {
  await using t = await makeEnv();
  const qDir = join(await testTempDir(), "q");
  const calls: string[] = [];
  const { lineage, mechanism } = await fakedGolden(calls);
  const roots = (await loadLineage(lineage)).fs!.roots;
  let extra: string[] = [];
  const mech: ResetFor = () => ({
    ...mechanism(),
    fsDigest: () => {
      const lines = [...roots.map((r) => `D|16|0|${r}`), ...extra];
      return Promise.resolve([...lines, `T|${lines.length}`]);
    },
  });
  const d: EnvDeps = { ...deps([]), quarantineDir: () => qDir };
  const F = (p: string, h: string) => `F|${h.repeat(64)}|2|1|1|6262|${p}`;
  const flag = `${roots[0]}\\flag.txt`, cfg = `${roots[0]}\\app.config`;
  const key = { name: "Cronus281", id: fakeId("Cronus281") };
  await plantRecord(qDir, {
    id: key.id,
    container: "Cronus281",
    state: "quarantined",
    reason: "L4",
    by: "test",
    pid: 1,
    fs_diff: [
      { path: flag, before: null, after: F(flag, "b") },
      { path: cfg, before: F(cfg, "a"), after: F(cfg, "c") },
    ],
    fs_captured: true,
  });
  const o = {
    repoRoot: t.repo.root,
    containers: ["Cronus281"],
    lineage,
    symbolStore: t.repo.symbolStore,
    bcEgressOverride: "r",
  };
  const resultsRoot = join(t.repo.root, "results", "harness");
  const cases: [string[], string][] = [
    // the planted file survived the reset (another spelling of its path)
    [[F(flag.toUpperCase(), "b"), F(cfg, "a")], flag],
    // the changed file was not restored
    [[F(cfg, "c")], cfg],
    // nor is a removed before-line restored by its absence
    [[], cfg],
  ];
  for (const [lines, path] of cases) {
    extra = lines;
    const e = await assertRejects(
      () => recoverContainer(o, d, mech),
      ContainerError,
    );
    assertStringIncludes(e.message, "contamination not remediated");
    assertStringIncludes(e.message, path);
    assertStringIncludes(e.message, "recreate the container or remove them");
    assertEquals((await findRecords(qDir, key)).length, 1);
    assertEquals(await readInstanceManifest(resultsRoot, "Cronus281"), null);
  }
  extra = [F(cfg, "a")];
  await recoverContainer(o, d, mech);
  assertEquals(await findRecords(qDir, key), []);
  assert(await readInstanceManifest(resultsRoot, "Cronus281"));
});

/** Captures console.error while fn runs. */
async function errorsOf(fn: () => Promise<unknown>): Promise<string> {
  const logged: string[] = [];
  const s = stub(
    console,
    "error",
    (...a: unknown[]) => void logged.push(a.join(" ")),
  );
  try {
    await fn();
  } finally {
    s.restore();
  }
  return logged.join("\n");
}

Deno.test("H-35 run 004 Sol r2 N1 exclusive claims: two environments racing for one container, one starts and the other is refused; a lane quarantine after another owner took the record does not overwrite it, and close leaves it", async () => {
  await using a = await makeEnv();
  await using b = await makeEnv();
  const qDir = join(await testTempDir(), "q");
  const d = (): EnvDeps => ({ ...deps([]), quarantineDir: () => qDir });
  const r = await Promise.allSettled([
    openHarnessEnv(envOpts(a), d()),
    openHarnessEnv(envOpts(b), d()),
  ]);
  const won = r.flatMap((x) => x.status === "fulfilled" ? [x.value] : []);
  const lost = r.flatMap((x) => x.status === "rejected" ? [x.reason] : []);
  assertEquals([won.length, lost.length], [1, 1]);
  assert(lost[0] instanceof ConfigurationError);
  assertStringIncludes(lost[0].message, "quarantined container(s)");
  assertStringIncludes(lost[0].message, "Cronus281 (");
  const h = won[0]!;
  const key = { name: "Cronus281", id: fakeId("Cronus281") };
  // recovered (abandoned) and claimed by another environment meanwhile
  await Deno.remove(recordFile(qDir, key.id));
  const other = await plantRecord(qDir, {
    state: "in_use",
    container: "Cronus281",
    id: key.id,
    by: "HOST2 run",
    pid: 2,
  });
  const logs = await errorsOf(() =>
    h.env.lane.quarantine(
      "Cronus281",
      "L4 on Cronus281: 0 error(s), 1 difference(s): x",
      [],
    )
  );
  assertStringIncludes(logs, "[FAIL] quarantine of Cronus281 NOT persisted");
  assertStringIncludes(logs, "not overwritten");
  assert(h.env.lane.quarantined.has("Cronus281"), "kept in memory");
  await h.close();
  assertEquals(
    (await findRecords(qDir, key)).map((
      f,
    ) => [f.record?.token, f.record?.state]),
    [[other, "in_use"]],
  );
});

Deno.test("H-35 run 004 Sol r2 N2 recover: a record of another physical container (same name, other id) is not deleted and recover refuses; a concurrent recover's claim refuses unless abandoned by its token", async () => {
  await using t = await makeEnv();
  const qDir = join(await testTempDir(), "q");
  const calls: string[] = [];
  const { lineage, mechanism } = await fakedGolden(calls);
  const ids = new Map<string, string>([["cronus281", "f".repeat(64)]]);
  const d: EnvDeps = {
    ...deps([]),
    quarantineDir: () => qDir,
    containerId: (c) => Promise.resolve(ids.get(c.toLowerCase()) ?? fakeId(c)),
  };
  const o = {
    repoRoot: t.repo.root,
    containers: ["Cronus281"],
    lineage,
    symbolStore: t.repo.symbolStore,
    bcEgressOverride: "r",
  };
  const key = { name: "Cronus281", id: fakeId("Cronus281") };
  await plantRecord(qDir, {
    state: "quarantined",
    container: "Cronus281",
    id: key.id,
    reason: "reset of Cronus281 failed at restore: x",
    by: "test",
    pid: 1,
    fs_diff: [],
    fs_captured: true,
  });
  // A was renamed away, B now carries the name: verifying B never clears A
  await assertRejects(
    () => recoverContainer(o, d, mechanism),
    ConfigurationError,
    `record of another physical container ${key.id}`,
  );
  assertEquals(calls, []);
  assertEquals((await findRecords(qDir, key)).length, 1);
  const files = async () => {
    const out: string[] = [];
    for await (const e of Deno.readDir(qDir)) out.push(e.name);
    return out.sort();
  };
  assertEquals(await files(), [`${key.id}.json`], "recover's claim released");
  // A itself (same id again), while another recover claims it
  ids.delete("cronus281");
  const r = await plantRecord(qDir, {
    state: "in_use",
    container: "Cronus281",
    id: key.id,
    by: "HOST2 harness recover",
    pid: 3,
  }, { recover: true });
  for (const abandon of [null, crypto.randomUUID()]) {
    await assertRejects(
      () => recoverContainer({ ...o, abandon }, d, mechanism),
      ConfigurationError,
      "another recover claims it",
    );
  }
  assertEquals(calls, []);
  await recoverContainer({ ...o, abandon: r }, d, mechanism);
  assertEquals(await findRecords(qDir, key), []);
  assertEquals(await files(), []);
  // --abandon naming no record refuses
  await assertRejects(
    () =>
      recoverContainer({ ...o, abandon: crypto.randomUUID() }, d, mechanism),
    ConfigurationError,
    "names no record",
  );
});

Deno.test("H-35 run 004 Sol r2 N3 close: a failing closer keeps the in-use record; an in-flight lane operation delays its release", async () => {
  await using t = await makeEnv();
  const qDir = join(await testTempDir(), "q");
  const key = { name: "Cronus281", id: fakeId("Cronus281") };
  const failing: EnvDeps = {
    ...deps([]),
    quarantineDir: () => qDir,
    setup: (names) =>
      Promise.resolve({
        bc: new FakeBc(),
        names,
        dispose: () => Promise.reject(new Error("dispose failed")),
      }),
  };
  const h = await openHarnessEnv(envOpts(t), failing);
  const logs = await errorsOf(() => h.close());
  assertEquals(
    (await findRecords(qDir, key)).map((f) => f.record?.state),
    ["in_use"],
  );
  assertStringIncludes(logs, "in-use record of Cronus281 kept");
  assertStringIncludes(logs, "teardown failed: dispose failed");
  await Deno.remove(recordFile(qDir, key.id));
  const h2 = await openHarnessEnv(envOpts(t), {
    ...deps([]),
    quarantineDir: () => qDir,
  });
  let finish!: () => void;
  let started!: () => void;
  const running = new Promise<void>((r) => (started = r));
  const op = h2.env.lane.exclusive(
    { taskId: "t", variantId: "v", attemptNumber: 1 },
    () =>
      new Promise<void>((r) => {
        finish = r;
        started();
      }),
  );
  await running;
  const closed = h2.close();
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(
    (await findRecords(qDir, key)).length,
    1,
    "held while the operation runs",
  );
  finish();
  await op;
  await closed;
  assertEquals(await findRecords(qDir, key), []);
});

Deno.test("H-35 addendum 6 recover: a recorded file the recovery lineage's platform cache tolerates (hash-named) is dropped and the container clears; a right-shaped file whose name is not its hash keeps the quarantine", async () => {
  await using t = await makeEnv();
  const qDir = join(await testTempDir(), "q");
  const { lineage, mechanism } = await fakedGolden([]);
  const roots = (await loadLineage(lineage)).fs!.roots;
  const base = roots[0]!;
  const HASH =
    "0A53123EBB10012CF7AB9309302824D90E158BB785A7763F235C616DD829ADF0";
  const path = `${base}\\metadata\\3\\0A\\${HASH}.app`;
  const fLine = (sha: string) => `F|${sha}|1|32|1|4e41|${path}`;
  let present: string[] = [];
  const mech: ResetFor = () => ({
    ...mechanism(),
    fsCaches: [{
      base,
      files: String.raw`^metadata\\3\\([0-9A-F]{2})\\\1[0-9A-F]{62}\.app$`,
      dirs: String.raw`^metadata(\\3(\\[0-9A-F]{2})?)?$`,
      magic: "4e41",
      nameIsSha256: true,
    }, {
      base,
      files: String.raw`^(?!)$`,
      dirs: String.raw`^tx$`,
      dirTimeOnly: true,
    }],
    fsDigest: () => {
      const lines = [...roots.map((r) => `D|16|0|${r}`), ...present];
      return Promise.resolve([...lines, `T|${lines.length}`]);
    },
  });
  const d: EnvDeps = { ...deps([]), quarantineDir: () => qDir };
  const key = { name: "Cronus281", id: fakeId("Cronus281") };
  const o = {
    repoRoot: t.repo.root,
    containers: ["Cronus281"],
    lineage,
    symbolStore: t.repo.symbolStore,
    bcEgressOverride: "r",
  };
  const plantAll = async (fs_diff: FsDiffEntry[], now: string[]) => {
    await Deno.remove(recordFile(qDir, key.id)).catch(() => {});
    await plantRecord(qDir, {
      id: key.id,
      container: "Cronus281",
      state: "quarantined",
      reason: "L4 on Cronus281: 0 error(s), 1 difference(s)",
      by: "test",
      pid: 1,
      fs_diff,
      fs_captured: true,
    });
    present = now;
  };
  // the cache file survives the reset, as on the containers
  const plant = (sha: string) =>
    plantAll([{ path, before: null, after: fLine(sha) }], [fLine(sha)]);
  const refused = async (what: string, includes: string) => {
    const e = await assertRejects(
      () => recoverContainer(o, d, mech),
      ContainerError,
    );
    assertStringIncludes(e.message, includes, what);
    assertEquals((await findRecords(qDir, key)).length, 1, what);
  };
  // a right-shaped file whose name is not its content hash: kept, refused
  await plant("a".repeat(64));
  await refused("misnamed", "contamination not remediated");
  // orch r005c HIGH (a): recorded hash-named, but its CURRENT content differs
  await plantAll(
    [{ path, before: null, after: fLine(HASH.toLowerCase()) }],
    [fLine("b".repeat(64))],
  );
  await refused("changed content", "contamination not remediated");
  // self-check 2: same content, but the current spelling is outside the
  // (uppercase) shape: judged by the current path, refused
  const lower = `${base}\\metadata\\3\\0a\\${HASH.toLowerCase()}.app`;
  await plantAll(
    [{ path, before: null, after: fLine(HASH.toLowerCase()) }],
    [`F|${HASH.toLowerCase()}|1|32|1|4e41|${lower}`],
  );
  await refused("current spelling", "contamination not remediated");
  // (b) the path now under a reparse point: unobservable, refused (recreate)
  await plantAll(
    [{ path, before: null, after: fLine(HASH.toLowerCase()) }],
    [`L|1040|0|${base}\\metadata|D:\\elsewhere`],
  );
  await refused("reparse cover", "not observable");
  // (b) a recorded cache-shaped path outside the recovery roots: refused
  const outside = `C:\\Elsewhere\\metadata\\3\\0A\\${HASH}.app`;
  await plantAll(
    [{ path: outside, before: null, after: fLine(HASH.toLowerCase()) }],
    [],
  );
  await refused("outside the roots", "not observable");
  // folder-only negative: the folder now has other attributes
  const tx = `${base}\\tx`;
  await plantAll(
    [{ path: tx, before: `D|16|1|${tx}`, after: `D|16|9|${tx}` }],
    [`D|18|9|${tx}`],
  );
  await refused(
    "folder-only, attributes changed",
    "contamination not remediated",
  );
  // folder-only positive: only its time moved, still so now
  await plantAll(
    [{ path: tx, before: `D|16|1|${tx}`, after: `D|16|9|${tx}` }],
    [`D|16|12|${tx}`],
  );
  await recoverContainer(o, d, mech);
  assertEquals(await findRecords(qDir, key), []);
  // the hash-named cache file, unchanged now: dropped, the container clears
  await plant(HASH.toLowerCase());
  await recoverContainer(o, d, mech);
  assertEquals(await findRecords(qDir, key), []);
});

Deno.test("H-35 run 004 Sol r2 N4/N5 recover: no clean after-capture, a recorded path outside the capture's roots, or one below a reparse point (L line): recover refuses (recreate) and keeps the record", async () => {
  await using t = await makeEnv();
  const qDir = join(await testTempDir(), "q");
  const calls: string[] = [];
  const { lineage, mechanism } = await fakedGolden(calls);
  const roots = (await loadLineage(lineage)).fs!.roots;
  let extra: string[] = [];
  const mech: ResetFor = () => ({
    ...mechanism(),
    fsDigest: () => {
      const lines = [...roots.map((r) => `D|16|0|${r}`), ...extra];
      return Promise.resolve([...lines, `T|${lines.length}`]);
    },
  });
  const d: EnvDeps = { ...deps([]), quarantineDir: () => qDir };
  const key = { name: "Cronus281", id: fakeId("Cronus281") };
  const o = {
    repoRoot: t.repo.root,
    containers: ["Cronus281"],
    lineage,
    symbolStore: t.repo.symbolStore,
    bcEgressOverride: "r",
  };
  const RECREATE =
    "no trustworthy filesystem evidence: the container must be recreated (lane-ops)";
  const plant = async (
    path: string | null,
    o2: { captured?: boolean } = {},
  ) => {
    await Deno.remove(recordFile(qDir, key.id)).catch(() => {});
    await plantRecord(qDir, {
      id: key.id,
      container: "Cronus281",
      state: "quarantined",
      reason: path === null
        ? "reset of Cronus281 failed at restore: boom"
        : "L4 on Cronus281: 0 error(s), 1 difference(s)",
      by: "test",
      pid: 1,
      fs_diff: path === null ? [] : [{ path, before: null, after: "x" }],
      fs_captured: o2.captured ?? true,
    });
  };
  // N4: a reset failure whose quarantine had no clean after-capture
  await plant(null, { captured: false });
  await assertRejects(
    () => recoverContainer(o, d, mech),
    ConfigurationError,
    RECREATE,
  );
  assertEquals(calls, [], "refused before the reset");
  // N5
  const link = `${roots[0]}\\lnk`;
  const cases: [string, string[]][] = [
    ["C:\\Elsewhere\\flag.txt", []],
    // a sibling sharing the root's prefix is not under it
    [`${roots[0]}x\\flag.txt`, []],
    [`${link}\\flag.txt`, [`L|0|0|${link}|D:\\target`]],
    // orch r004 N5 residual: a named stream on the reparse entry itself
    [`${link}:hid`, [`L|0|0|${link}|D:\\target`]],
    // and on an entry below it
    [`${link}\\f.txt:hid`, [`L|0|0|${link}|D:\\target`]],
    // an extended-path stream outside the roots stays outside (drive colon)
    ["\\\\?\\C:\\Elsewhere\\f.txt:hid", []],
  ];
  for (const [path, lines] of cases) {
    await plant(path);
    extra = lines;
    const e = await assertRejects(
      () => recoverContainer(o, d, mech),
      ContainerError,
    );
    assertStringIncludes(e.message, RECREATE);
    assertStringIncludes(e.message, `recorded path ${path} not observable`);
    assertEquals((await findRecords(qDir, key)).length, 1);
  }
  // the same path absent and observable (no link): cleared
  await plant(`${link}\\flag.txt`);
  extra = [];
  await recoverContainer(o, d, mech);
  assertEquals(await findRecords(qDir, key), []);
  // a stream on an observable entry, now absent: cleared (owner under a root)
  await plant(`${roots[0]}\\f.txt:hid`);
  await recoverContainer(o, d, mech);
  assertEquals(await findRecords(qDir, key), []);
});
