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
  type EgressState,
  firewallPlan,
  preflightExpect,
  RECORDED_HOSTS_PATH,
  SANDBOX_NETWORK,
} from "../../../../src/harness/egress.ts";
import { claudeCodeAdapter } from "../../../../src/harness/adapters/claude-code.ts";
import { loadSymbolsLock } from "../../../../src/harness/identity.ts";
import {
  AL_TOOLS_DEF,
  BASE_IMAGE,
  mcpLabel,
} from "../../../../src/harness/images.ts";
import { runCampaign } from "../../../../src/harness/campaign.ts";
import { scorerFingerprint } from "../../../../src/harness/records.ts";
import { oracleHash } from "../../../../src/harness/identity.ts";
import { loadTask } from "../../../../src/harness/task.ts";
import { BenchLockHeldError } from "../../../../src/utils/bench-lock.ts";
import { FakeBc } from "../../harness/fake-bc.ts";
import { FakeDocker } from "../../harness/fake-docker.ts";
import { runQualificationProbe } from "../../../../src/harness/egress-probe.ts";
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
  ValidationError,
} from "../../../../src/errors.ts";
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
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1", "l2"]);
  await assertRejects(
    () => harnessImagesBuild("base", { root }, docker),
    ConfigurationError,
    `${BASE_IMAGE}: label ${mk}`,
  );
  docker.builds.length = 0;
  docker.addImage(BASE_IMAGE, baseId, {
    [mk]: `${mv.split(" ")[0]} ${"0".repeat(64)}`,
  }, ["l1", "l2"]);
  await assertRejects(
    () => harnessImagesBuild("base", { root }, docker),
    ConfigurationError,
    `${BASE_IMAGE}: label ${mk}`,
  );
  docker.builds.length = 0;
  docker.addImage(BASE_IMAGE, baseId, { [mk]: mv }, ["l1", "l2"]);
  const bf = await harnessImagesBuild("base", { root }, docker);
  assertEquals(bf, {
    digest: baseId,
    base_digest: pin,
    harness: "base",
    version: "1",
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
  docker.addImage(
    "centralgauge/harness-claude-code:2.1.282",
    `sha256:${"c".repeat(64)}`,
    labels,
    ["l1", "l2", "l3"],
  );
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
  docker.addImage(
    "centralgauge/harness-claude-code:2.1.282",
    `sha256:${"d".repeat(64)}`,
    labels,
    ["x1", "l3"],
  );
  await assertRejects(
    () =>
      harnessImagesBuild("claude-code", { root, version: "2.1.282" }, docker),
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
  docker.addImage(
    "centralgauge/harness-mock:1",
    `sha256:${"c".repeat(64)}`,
    {
      "centralgauge.harness": "mock",
      "centralgauge.harness.version": "1",
      "centralgauge.harness.base_digest": baseId,
    },
    ["l1", "l2"],
  );
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
        manifest: { harness: o.harness ?? "claude-code" },
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
  const allow =
    JSON.stringify({ decision: "allow", target: "api.anthropic.com:443" }) +
    "\n";
  const deny = JSON.stringify({ decision: "deny", target: "evil.test:443" }) +
    "\n";
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
      manifest: { harness: "claude-code" },
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
    JSON.stringify({ decision: "allow", target: "api.anthropic.com:443" }) +
      "\n",
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
