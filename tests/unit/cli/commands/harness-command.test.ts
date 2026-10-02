import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { Command } from "@cliffy/command";
import { stripAnsiCode } from "@std/fmt/colors";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import {
  type CellCliOptions,
  cellGate,
  harnessCell,
  harnessEgressVerify,
  harnessImagesBuild,
  harnessJudgeFixture,
  harnessQualify,
  harnessRejudge,
  harnessReport,
  harnessRun,
  harnessSymbolsLock,
  parseRerunCell,
  registerHarnessCommand,
  validateHarness,
} from "../../../../cli/commands/harness-command.ts";
import {
  backendAddress,
  EGRESS_MARKER,
  egressMode,
  type EnvDeps,
  openHarnessEnv,
  openPlanEnv,
  resolveEgress,
} from "../../../../cli/commands/harness-env.ts";
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
  AL_TOOLS_DEF,
  BASE_IMAGE,
  mcpLabel,
} from "../../../../src/harness/images.ts";
import {
  loadCampaignData,
  runCampaign,
} from "../../../../src/harness/campaign.ts";
import { buildReport, renderReport } from "../../../../src/harness/report.ts";
import { writeVerdictLog } from "../../../../src/harness/verdict.ts";
import { sha256Hex } from "../../../../src/harness/hash.ts";
import { scorerFingerprint } from "../../../../src/harness/records.ts";
import {
  currentScorerFingerprint,
  SCORER_SUITE,
} from "../../../../src/harness/verdict.ts";
import { oracleHash } from "../../../../src/harness/identity.ts";
import { loadTask } from "../../../../src/harness/task.ts";
import { BenchLockHeldError } from "../../../../src/utils/bench-lock.ts";
import { FakeBc } from "../../harness/fake-bc.ts";
import { ADMIN_GROUPS_CSV, FakeDocker } from "../../harness/fake-docker.ts";
import { runQualificationProbe } from "../../../../src/harness/egress-probe.ts";
import { holdExclusive } from "../../harness/hold-file.ts";
import { READY_FILE } from "../../../../src/harness/sandbox.ts";
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
import { RecordStore } from "../../../../src/harness/records.ts";
import {
  campaign,
  CAMPAIGN_ID,
  execution,
  judgment,
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
  const root = await Deno.makeTempDir();
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
  const dir = await Deno.makeTempDir();
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
  const empty = await Deno.makeTempDir();
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
  const root = await Deno.makeTempDir();
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

function deps(
  order: string[],
  lock?: () => never,
  verify: () => Promise<string[]> = () =>
    Promise.resolve(["not implemented (M1-33)"]),
): EnvDeps {
  const docker = new FakeDocker();
  docker.owned = ["cg-harness-dead-beef"];
  const listOwned = docker.listOwned.bind(docker);
  docker.listOwned = (o) => {
    order.push("sweep");
    return listOwned(o);
  };
  return {
    // The campaign allocation (coord allocation.json) is its own seam; every container here is allocated.
    allocated: (c) => Promise.resolve(c),
    acquireLock: () => {
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
  await write(
    t.repo.tasksDir,
    "HX-002/task.yml",
    "id: HX-002\nrefapp_version: refapp-v1\nkind: test-authoring\nprompt: prompt.md\nsource: refapp\nscorers: [build, mutant_kill]\n",
  );
  await write(t.repo.tasksDir, "HX-002/prompt.md", "x");
  await write(t.repo.tasksDir, "HX-002/correct/Rental/src/R.al", "x");
  const h = await openHarnessEnv(envOpts(t), deps([]));
  // Owned ids come from each grant's and judgment's trusted roots (M1-16), never from the env.
  assertEquals(Object.keys(h.env.deploy), ["ledgerRoot"]);
  await h.close();
});

Deno.test("openHarnessEnv: a held bench lock stops before any docker call", async () => {
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const root = await Deno.realPath(await Deno.makeTempDir());
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
  const labels = {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.version": "2.1.282",
    "centralgauge.harness.base_digest": baseId,
  };
  docker.buildResults.set("centralgauge/harness-claude-code:2.1.282", {
    id: `sha256:${"c".repeat(64)}`,
    labels,
    layers: ["l1", "l2", "l3"],
  });
  const f = await harnessImagesBuild(
    "claude-code",
    { root, version: "2.1.282" },
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
  docker.buildResults.set("centralgauge/harness-claude-code:2.1.283", {
    id: `sha256:${"d".repeat(64)}`,
    labels: { ...labels, "centralgauge.harness.version": "2.1.283" },
    layers: ["x1", "l3"],
  });
  await assertRejects(
    () =>
      harnessImagesBuild("claude-code", { root, version: "2.1.283" }, docker),
    ConfigurationError,
    "layers",
  );
});

Deno.test("harnessSymbolsLock: writes a strict lock the identity accepts", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir());
  const from = await Deno.realPath(await Deno.makeTempDir());
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
  const root = await Deno.realPath(await Deno.makeTempDir());
  const docker = new FakeDocker();
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1", "l2"]);
  const tag = "centralgauge/harness-claude-code:2.1.282";
  docker.build = (args) => {
    docker.builds.push(args);
    // Someone rebuilds the base tag while this build runs.
    docker.addImage(BASE_IMAGE, `sha256:${"9".repeat(64)}`, {}, ["m1"]);
    docker.addImage(tag, `sha256:${"c".repeat(64)}`, {
      "centralgauge.harness": "claude-code",
      "centralgauge.harness.version": "2.1.282",
      "centralgauge.harness.base_digest": baseId,
    }, ["l1", "l2", "l3"]);
    return Promise.resolve(0);
  };
  const f = await harnessImagesBuild(
    "claude-code",
    { root, version: "2.1.282" },
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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

Deno.test("qualify judges every manifest variant at its rev and indexes judgment, provenance, expected and actual verdicts", async () => {
  const t = await makeEnv();
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

async function staleJudgment(t: TestEnv, executionId: string) {
  const [j] = await t.env.store.judgments(executionId);
  const versions = { ...j!.scorer_versions, build: "0-stale" };
  await t.env.store.writeJudgment({
    ...j!,
    id: crypto.randomUUID(),
    scorer_versions: versions,
    scorer_fingerprint: await scorerFingerprint(versions),
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
  const t = await makeEnv();
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

Deno.test("rejudge (M4-17a): a judgment from before the mutant_kill 3 bump is rejudged with the current suite on the original artifact, task and oracle", async () => {
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
  const e = (await t.env.store.executions(c.id))[0]!;
  const [orig] = await t.env.store.judgments(e.id);
  // The suite as recorded before M4-17a.
  const before = {
    ...orig!.scorer_versions,
    mutant_kill: "2",
    pass_to_pass: "1",
  };
  await t.env.store.writeJudgment({
    ...orig!,
    id: crypto.randomUUID(),
    scorer_versions: before,
    scorer_fingerprint: await scorerFingerprint(before),
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
  assertEquals(latest.scorer_versions["mutant_kill"], "3");
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const root = await Deno.realPath(await Deno.makeTempDir());
  const docker = new FakeDocker();
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1"]);
  docker.buildResults.set("centralgauge/harness-mock:1", {
    id: `sha256:${"c".repeat(64)}`,
    labels: {
      "centralgauge.harness": "mock",
      "centralgauge.harness.version": "1",
      "centralgauge.harness.base_digest": baseId,
    },
    layers: ["l1", "l2"],
  });
  const lines: string[] = [];
  const log = stub(console, "log", (...a: unknown[]) => {
    lines.push(a.join(" "));
  });
  try {
    await harnessImagesBuild("mock", { root, version: "1" }, docker);
  } finally {
    log.restore();
  }
  const out = stripAnsiCode(lines.join("\n"));
  assertStringIncludes(out, `sha256:${"c".repeat(64)}`);
  assertStringIncludes(out, "centralgauge.harness=mock");
  assertStringIncludes(out, "centralgauge.harness.version=1");
  assertStringIncludes(out, `centralgauge.harness.base_digest=${baseId}`);
});

Deno.test("rejudge: an oracle-only change makes every judged execution due, judged against the new oracle", async () => {
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const root = await Deno.realPath(await Deno.makeTempDir());
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
  const root = await Deno.realPath(await Deno.makeTempDir());
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
  const root = await Deno.realPath(await Deno.makeTempDir());
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
  const root = await Deno.realPath(await Deno.makeTempDir());
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
  const root = await Deno.realPath(await Deno.makeTempDir());
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
  const root = await Deno.realPath(await Deno.makeTempDir());
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
    const t = await makeEnv();
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
  const root = at ?? await Deno.realPath(await Deno.makeTempDir());
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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

Deno.test("run --concurrency > 1 (M1-33e): the up-front check names a marker proxy_isolation other than exactly PROXY_ISOLATION, before any environment opens; the refusal still stands", async () => {
  const t = await makeEnv();
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

Deno.test("openHarnessEnv concurrency > 1 (M1-33e): the proxy_isolation gate runs under the lock, before any sweep, at both refusal points; the refusal still stands", async () => {
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
    const t = await makeEnv();
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
  const t = await makeEnv();
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
    const t = await makeEnv();
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
  const root = await Deno.realPath(await Deno.makeTempDir());
  const docker = new FakeDocker();
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1", "l2"]);
  const labels = {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.version": "2.1.282",
    "centralgauge.harness.base_digest": baseId,
  };
  const r2 = "centralgauge/harness-claude-code:2.1.282-r2";
  docker.buildResults.set(r2, {
    id: `sha256:${"c".repeat(64)}`,
    labels: { ...labels, "centralgauge.harness.revision": "2" },
    layers: ["l1", "l2", "l3"],
  });
  const log = stub(console, "log", () => {});
  let f;
  try {
    f = await harnessImagesBuild(
      "claude-code",
      { root, version: "2.1.282", revision: "2" },
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
  docker.buildResults.set("centralgauge/harness-claude-code:2.1.282-r3", {
    id: `sha256:${"e".repeat(64)}`,
    labels,
    layers: ["l1", "l2", "l3"],
  });
  await assertRejects(
    () =>
      harnessImagesBuild(
        "claude-code",
        { root, version: "2.1.282", revision: "3" },
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
          "claude-code",
          { root, version: "2.1.282", revision: bad },
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const root = await Deno.makeTempDir({ prefix: "coord-" });
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
  const root = await Deno.makeTempDir({ prefix: "coord-" });
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const root = await Deno.realPath(await Deno.makeTempDir());
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
      `${tag} already exists`,
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
