import {
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
  harnessImagesBuild,
  harnessJudgeFixture,
  harnessReport,
  harnessSymbolsLock,
  registerHarnessCommand,
  validateHarness,
} from "../../../../cli/commands/harness-command.ts";
import {
  EGRESS_MARKER,
  type EnvDeps,
  openHarnessEnv,
  resolveEgress,
} from "../../../../cli/commands/harness-env.ts";
import { claudeCodeAdapter } from "../../../../src/harness/adapters/claude-code.ts";
import { loadSymbolsLock } from "../../../../src/harness/identity.ts";
import { BASE_IMAGE } from "../../../../src/harness/images.ts";
import { BenchLockHeldError } from "../../../../src/utils/bench-lock.ts";
import { FakeBc } from "../../harness/fake-bc.ts";
import { FakeDocker } from "../../harness/fake-docker.ts";
import {
  ccBehavior,
  makeEnv,
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
  const root = await Deno.realPath(await Deno.makeTempDir());
  assertEquals(await resolveEgress(root, () => Promise.resolve([])), false);
  await Deno.writeTextFile(
    join(root, EGRESS_MARKER),
    JSON.stringify({ v: 1, state: "authorized" }),
  );
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
    () =>
      harnessImagesBuild("claude-code", { root, version: "2.1.282" }, docker),
    ConfigurationError,
    "base",
  );
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1", "l2"]);
  await harnessImagesBuild("base", { root }, docker);
  assertStringIncludes(docker.builds[0]!.join(" "), `SERVERCORE=${pin}`);
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
  assertStringIncludes(args, `BASE=${BASE_IMAGE}`);
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
