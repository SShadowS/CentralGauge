import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { Command } from "@cliffy/command";
import { stripAnsiCode } from "@std/fmt/colors";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import {
  harnessReport,
  registerHarnessCommand,
  validateHarness,
} from "../../../../cli/commands/harness-command.ts";
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
