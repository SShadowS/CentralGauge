/**
 * H-41 (design-final 12): the commit protocol across real processes. Each
 * test starts at most two children of pool-driver.ts at once, each over its
 * own repoRoot copy and private dir (their own bench and private-root
 * locks), sharing the results dir, quarantine dir and coord root. The
 * in-process versions of these cases stay in execution.test.ts and
 * harness-command.test.ts.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import type { ComputedJudgment } from "../../../src/harness/execution.ts";
import type {
  ExecutionRecord,
  JudgmentRecord,
} from "../../../src/harness/records.ts";
import { runCampaign } from "../../../src/harness/campaign.ts";
import {
  fencePath,
  pinPath,
  rejudgeExecution,
  runCell,
} from "../../../src/harness/execution.ts";
import { exists } from "../../../src/harness/fsutil.ts";
import { rejudgeBudgetExhausted } from "../../../src/harness/outcome.ts";
import {
  JudgmentRecordSchema,
  publishOnce,
  scorerFingerprint,
  verdictOf,
} from "../../../src/harness/records.ts";
import { currentScorerFingerprint } from "../../../src/harness/verdict.ts";
import { benchLockPath } from "../../../src/utils/bench-lock.ts";
import {
  barrierFile,
  type DriverArgs,
  type DriverResult,
  type Scenario,
  STALE_MS,
} from "./pool-driver.ts";
import { FP, OTHER_FP } from "./pool-fixture.ts";
import { write } from "./refapp-fixture.ts";
import {
  CATALOG,
  cellFor,
  makeEnv,
  mockImageBehavior,
  type TestEnv,
} from "./runtime-fixture.ts";

const DRIVER = fromFileUrl(new URL("./pool-driver.ts", import.meta.url));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Child {
  name: string;
  proc: Deno.ChildProcess;
  done: boolean;
  status: Promise<Deno.CommandStatus>;
  stdout: Promise<string>;
  stderr: Promise<string>;
}

/**
 * The shared dirs of one test and its children. Disposal kills (by handle)
 * and awaits every child still running, then removes only its own dirs.
 */
class World implements AsyncDisposable {
  private readonly dirs: string[] = [];
  private readonly children: Child[] = [];

  private constructor(
    readonly t: TestEnv,
    readonly root: string,
  ) {
    this.dirs.push(root);
  }

  static async open(t: TestEnv): Promise<World> {
    const w = new World(
      t,
      await Deno.realPath(await Deno.makeTempDir({ prefix: "cg-h41-world-" })),
    );
    await Deno.mkdir(w.barriers);
    await Deno.mkdir(w.quarantineDir);
    // A coord root with no lease held (coord leases fail closed).
    await Deno.mkdir(join(w.coordRoot, "leases"), { recursive: true });
    await Deno.writeTextFile(
      join(w.coordRoot, "coord.json"),
      JSON.stringify({ campaign: "harness-test" }),
    );
    return w;
  }

  get barriers() {
    return join(this.root, "barriers");
  }
  get quarantineDir() {
    return join(this.root, "q");
  }
  get coordRoot() {
    return join(this.root, "coord");
  }

  /** A child over a copy of the fixture repo (no results) and its own private dir. */
  async spawn(
    name: string,
    scenario: Scenario,
    o: Partial<DriverArgs> = {},
  ): Promise<Child> {
    const repoRoot = await Deno.realPath(
      await Deno.makeTempDir({ prefix: `cg-h41-${name}-repo-` }),
    );
    this.dirs.push(repoRoot);
    for await (const x of Deno.readDir(this.t.repo.root)) {
      if (x.name === "results") continue;
      await copy(join(this.t.repo.root, x.name), join(repoRoot, x.name));
    }
    const privateRoot = await Deno.realPath(
      await Deno.makeTempDir({ prefix: `cg-h41-${name}-private-` }),
    );
    this.dirs.push(privateRoot);
    // Judging redacts with the execution's keys, read from the judge's own
    // private root: every judge of these executions carries a copy.
    const keys = join(this.t.env.privateRoot, "redaction");
    if (await exists(keys)) await copy(keys, join(privateRoot, "redaction"));
    const args: DriverArgs = {
      name,
      scenario,
      barriers: this.barriers,
      pauses: [],
      repoRoot,
      resultsDir: this.t.env.resultsRoot,
      privateRoot,
      secretsSource: this.t.env.secretsSource,
      symbolStore: this.t.repo.symbolStore,
      quarantineDir: this.quarantineDir,
      coordRoot: this.coordRoot,
      containers: ["C1"],
      ...o,
    };
    const file = join(this.root, `args-${name}.json`);
    await Deno.writeTextFile(file, JSON.stringify(args));
    const proc = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-all", DRIVER, file],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const child: Child = {
      name,
      proc,
      done: false,
      status: proc.status.then((s) => {
        child.done = true;
        return s;
      }),
      stdout: new Response(proc.stdout).text(),
      stderr: new Response(proc.stderr).text(),
    };
    this.children.push(child);
    return child;
  }

  /** Resolves once `c` waits at `point`; throws if it exited first. */
  async at(c: Child, point: string, ms = 60_000): Promise<void> {
    const f = barrierFile(this.barriers, c.name, point, "at");
    const end = Date.now() + ms;
    while (!await exists(f)) {
      if (c.done) {
        throw new Error(
          `${c.name} exited before ${point}:\n${await this.tail(c)}`,
        );
      }
      if (Date.now() > end) throw new Error(`${c.name} never at ${point}`);
      await delay(20);
    }
  }

  go(c: Child, point: string): void {
    Deno.writeTextFileSync(barrierFile(this.barriers, c.name, point, "go"), "");
  }

  /** The child's RESULT line and its stdout, once it exited. */
  async result(c: Child): Promise<DriverResult & { out: string }> {
    const [s, out] = await Promise.all([c.status, c.stdout]);
    const line = out.split(/\r?\n/).findLast((l) => l.startsWith("RESULT "));
    if (!line) {
      throw new Error(
        `${c.name}: exit ${s.code}, no RESULT\n${await this.tail(c)}`,
      );
    }
    const r = JSON.parse(line.slice("RESULT ".length)) as DriverResult;
    assert(r.ok, `${c.name} failed: ${r.error}\n${await this.tail(c)}`);
    return { ...r, out };
  }

  /** Kill a child by its own handle and wait for it. */
  async kill(c: Child): Promise<void> {
    c.proc.kill("SIGKILL");
    await c.status;
  }

  private async tail(c: Child) {
    const [out, err] = await Promise.all([c.stdout, c.stderr]);
    return `${out.slice(-4000)}\n${err.slice(-4000)}`;
  }

  async [Symbol.asyncDispose]() {
    for (const c of this.children) {
      if (!c.done) {
        try {
          c.proc.kill("SIGKILL");
        } catch { /* exited meanwhile */ }
      }
      await c.status;
      await Promise.allSettled([c.stdout, c.stderr]);
    }
    for (const d of this.dirs) {
      try {
        await Deno.remove(d, { recursive: true });
      } catch (err) {
        console.warn(`[temp-dir] could not remove ${d}: ${err}`);
      }
    }
  }
}

// ---- fixtures (as harness-command.test.ts builds them) ----

async function writeCatalog(t: TestEnv) {
  await write(
    t.repo.root,
    "site/catalog/models.yml",
    "- slug: anthropic/claude-sonnet-5\n  api_model_id: claude-sonnet-5\n  family: claude\n  display_name: S5\n",
  );
  await write(t.repo.root, "site/catalog/pricing.yml", "[]\n");
  await write(t.repo.root, "site/catalog/model-families.yml", "[]\n");
}

/** The mock contract campaign (2 arms x `repeats`), run in this process. */
async function mockCampaign(t: TestEnv, repeats = 1) {
  await writeCatalog(t);
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await write(
    t.harnessRoot,
    "experiments/contract.yml",
    `id: contract
hypothesis: Mock contract.
primary_metric: pass_rate
baseline: mock-positive
variants: [mock-naive-a]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: ${repeats}
`,
  );
  await runCampaign(t.env, "contract", {
    dryRun: false,
    concurrency: 1,
    maxPauseMs: 0,
  }, { log: () => {}, sleep: () => Promise.resolve(), catalog: CATALOG });
  const c = (await t.env.store.campaigns("contract"))[0]!;
  return { c, es: await t.env.store.executions(c.id) };
}

/** A judgment as a pre-H-35 harness wrote it (an old scorer suite: due). */
async function staleJudgment(t: TestEnv, id: string) {
  const [j] = await t.env.store.judgments(id);
  const { policy: _p, provenance: _q, ...rest } = j!;
  const versions = {
    build: "3",
    pass_to_pass: "5",
    fail_to_pass: "3",
    mutant_kill: "5",
  };
  const scorers = j!.scorers.filter((s) => s.name !== "agent_tests").map((
    { state: _s, ...s },
  ) => s);
  await t.env.store.writeJudgment({
    ...rest,
    v: 1,
    scorers,
    verdict: verdictOf(scorers),
    scorer_versions: versions,
    scorer_fingerprint: await scorerFingerprint(versions),
    id: crypto.randomUUID(),
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  } as JudgmentRecord);
}

/** n newer infra-unscored copies of the execution's first judgment (current suite). */
async function unscoredJudgments(t: TestEnv, id: string, n: number) {
  const [j] = await t.env.store.judgments(id);
  for (let i = 0; i < n; i++) {
    const at = new Date(Date.now() + i).toISOString();
    await t.env.store.writeJudgment({
      ...j!,
      id: crypto.randomUUID(),
      scorers: j!.scorers.map((s) => ({
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

/** A published execution whose judging was deferred (owed, never judged). */
async function owedExecution(t: TestEnv): Promise<ExecutionRecord> {
  let later: ExecutionRecord | null = null;
  t.env.judgeLater = (_c, e) => void (later = e);
  await runCell(t.env, await cellFor(t));
  delete t.env.judgeLater;
  if (!later) throw new Error("the cell's judging was not deferred");
  return later;
}

/** A judged execution and a computed rejudgment of it (nothing written). */
async function judgedWithRejudgment(t: TestEnv) {
  const cell = await cellFor(t);
  const e = (await runCell(t.env, cell)).executions[0]!;
  return {
    e,
    c: await rejudgeExecution(t.env, cell, e, cell.oracleHash),
  };
}

/** Generation g's fence as a committer that died before materializing leaves it. */
async function plantFence(
  t: TestEnv,
  e: ExecutionRecord,
  g: number,
  c: ComputedJudgment,
) {
  await publishOnce(fencePath(t.env.resultsRoot, e.id, g), {
    v: 1,
    execution_id: e.id,
    generation: g,
    judgment: c.judgment,
    log: c.log,
    token: "planted",
    pid: 1,
    host: "PLANTED",
  });
}

const claimsDir = (t: TestEnv, id: string) =>
  join(t.env.resultsRoot, "claims", id);

const names = (dir: string) => {
  try {
    return [...Deno.readDirSync(dir)].map((x) => x.name).sort();
  } catch {
    return [];
  }
};

const fencesOf = (t: TestEnv, id: string) =>
  names(claimsDir(t, id)).filter((n) => /^fence-\d+\.json$/.test(n));

const fenceOf = (t: TestEnv, id: string, g: number) =>
  JSON.parse(Deno.readTextFileSync(fencePath(t.env.resultsRoot, id, g))) as {
    judgment: JudgmentRecord;
    log: { judgment_id: string };
    pid: number;
  };

const judgmentIds = async (t: TestEnv, id: string) =>
  (await t.env.store.judgments(id)).map((j) => j.id).sort();

const logPath = (t: TestEnv, judgmentId: string) =>
  join(t.env.resultsRoot, "verdicts", `${judgmentId}.json`);

const judgmentPath = (t: TestEnv, j: JudgmentRecord) =>
  join(t.env.resultsRoot, "judgments", j.execution_id, `${j.id}.json`);

/** What materialize writes: the fence's bytes of each file. */
const bytes = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/** The planted or committed claim of `id` has had no heartbeat for longer than STALE_MS. */
async function stale(t: TestEnv, id: string) {
  const p = benchLockPath(claimsDir(t, id));
  const end = Date.now() + 30_000;
  for (;;) {
    const at = (await Deno.stat(p)).mtime!.getTime();
    if (Date.now() - at > STALE_MS + 500) return;
    if (Date.now() > end) throw new Error(`claim ${p} never went stale`);
    await delay(100);
  }
}

/** No claim left behind, and no temp in the claim dir. */
const settled = (t: TestEnv, id: string) =>
  names(claimsDir(t, id)).filter((n) =>
    n === ".bench-running.json" || n.includes(".tmp-")
  );

// ---- Task 4 ----

Deno.test("H-41 Task 4 (two processes): two rejudges on disjoint containers over one campaign commit one fence and one judgment per W, each on its own containers; the rejudged counts add up", async () => {
  await using t = await makeEnv();
  const { es } = await mockCampaign(t, 3);
  assertEquals(es.length, 6);
  for (const e of es) await staleJudgment(t, e.id);
  const before = new Map<string, string[]>();
  for (const e of es) before.set(e.id, await judgmentIds(t, e.id));
  await using w = await World.open(t);
  const pauses = ["asked"];
  const a = await w.spawn("a", "rejudge", {
    containers: ["C1", "C2"],
    pauses,
    slowMs: 30,
  });
  const b = await w.spawn("b", "rejudge", {
    containers: ["C3", "C4"],
    pauses,
    slowMs: 30,
  });
  await w.at(a, "asked");
  await w.at(b, "asked");
  w.go(a, "asked");
  w.go(b, "asked");
  const ra = await w.result(a);
  const rb = await w.result(b);
  assertEquals(ra.rejudged! + rb.rejudged!, 6, `${ra.rejudged}+${rb.rejudged}`);
  const by = new Map([[ra.pid, ["C1", "C2"]], [rb.pid, ["C3", "C4"]]]);
  const committed = new Map([[ra.pid, 0], [rb.pid, 0]]);
  for (const e of es) {
    assertEquals(fencesOf(t, e.id), ["fence-0.json", "fence-1.json"], e.id);
    const f = fenceOf(t, e.id, 1);
    const now = await judgmentIds(t, e.id);
    assertEquals(
      now,
      [...before.get(e.id)!, f.judgment.id].sort(),
      `${e.id}: exactly the fence's judgment is new`,
    );
    assert(await exists(logPath(t, f.judgment.id)), "its verdict log");
    const own = by.get(f.pid);
    assert(own, `fence-1 of ${e.id} by an unknown pid ${f.pid}`);
    assert(
      own.includes(f.judgment.verdict_container!),
      `judged on ${f.judgment.verdict_container}, not the committer's ${own}`,
    );
    committed.set(f.pid, committed.get(f.pid)! + 1);
    assertEquals(settled(t, e.id), [], e.id);
  }
  assertEquals(
    [committed.get(ra.pid), committed.get(rb.pid)],
    [ra.rejudged, rb.rejudged],
    "each child's count is its fences",
  );
});

// ---- Task 5: stale takeover ----

Deno.test("H-41 Task 5 (a, two processes): simultaneous takers over one pre-aged foreign claim on X: exactly one fence and one judgment for X; one of them computes", async () => {
  await using t = await makeEnv();
  const { es } = await mockCampaign(t);
  const x = es[0]!;
  await staleJudgment(t, x.id);
  const before = await judgmentIds(t, x.id);
  // A foreign holder whose heartbeat stopped a minute ago.
  await Deno.mkdir(claimsDir(t, x.id), { recursive: true });
  const claim = benchLockPath(claimsDir(t, x.id));
  await Deno.writeTextFile(
    claim,
    JSON.stringify({
      pid: 1,
      startedAt: "",
      heartbeatAt: "",
      command: "judge",
      token: "foreign",
    }),
  );
  const old = new Date(Date.now() - 60_000);
  await Deno.utime(claim, old, old);
  await using w = await World.open(t);
  const a = await w.spawn("a", "rejudge", {
    containers: ["C1"],
    pauses: ["asked"],
  });
  const b = await w.spawn("b", "rejudge", {
    containers: ["C2"],
    pauses: ["asked"],
  });
  await w.at(a, "asked");
  await w.at(b, "asked");
  w.go(a, "asked");
  w.go(b, "asked");
  const ra = await w.result(a);
  const rb = await w.result(b);
  assertEquals(ra.rejudged! + rb.rejudged!, 1);
  assertEquals(
    [ra, rb].filter((r) => r.computes > 0).length,
    1,
    `computes ${ra.computes}, ${rb.computes}`,
  );
  assertEquals(fencesOf(t, x.id), ["fence-0.json", "fence-1.json"]);
  const f = fenceOf(t, x.id, 1);
  assertEquals(await judgmentIds(t, x.id), [...before, f.judgment.id].sort());
  assertEquals(f.pid, ra.rejudged === 1 ? ra.pid : rb.pid);
  assertEquals(settled(t, x.id), []);
});

Deno.test("H-41 Task 5 (b, two processes): a suspended holder (heartbeat frozen, paused before its fence link) is taken over; on resume its link fails and it drops: it computed, one judgment in all", async () => {
  await using t = await makeEnv();
  const { es } = await mockCampaign(t);
  const x = es[0]!;
  await staleJudgment(t, x.id);
  const before = await judgmentIds(t, x.id);
  await using w = await World.open(t);
  const a = await w.spawn("a", "rejudge", {
    containers: ["C1"],
    pauses: ["beforeLink:fence"],
    frozen: true,
  });
  await w.at(a, "beforeLink:fence");
  await stale(t, x.id);
  const b = await w.spawn("b", "rejudge", { containers: ["C2"] });
  const rb = await w.result(b);
  assertEquals(rb.rejudged, 1);
  assert(rb.computes > 0, "the taker computed");
  assertEquals(fencesOf(t, x.id), ["fence-0.json", "fence-1.json"]);
  assertEquals(fenceOf(t, x.id, 1).pid, rb.pid);
  w.go(a, "beforeLink:fence");
  const ra = await w.result(a);
  assertEquals(ra.rejudged, 0);
  assert(ra.computes > 0, "the suspended holder had computed");
  assert(
    ra.out.split("\n").some((l) =>
      l.includes("[SKIP]") && l.includes(x.id) &&
      l.includes("committed it first")
    ),
    ra.out,
  );
  assertEquals(fencesOf(t, x.id), ["fence-0.json", "fence-1.json"]);
  assertEquals(
    await judgmentIds(t, x.id),
    [...before, fenceOf(t, x.id, 1).judgment.id].sort(),
  );
  assertEquals(settled(t, x.id), []);
});

Deno.test("H-41 Task 5 (c, two processes): a holder paused after its fence: the other process materializes it without computing; the resumed holder writes identical bytes; one judgment", async () => {
  await using t = await makeEnv();
  const { es } = await mockCampaign(t);
  const x = es[0]!;
  await staleJudgment(t, x.id);
  const before = await judgmentIds(t, x.id);
  await using w = await World.open(t);
  const a = await w.spawn("a", "rejudge", {
    containers: ["C1"],
    pauses: ["afterFence"],
    frozen: true,
  });
  await w.at(a, "afterFence");
  const f = fenceOf(t, x.id, 1);
  assertEquals(f.pid, a.proc.pid);
  assertEquals(await judgmentIds(t, x.id), before, "not materialized yet");
  await stale(t, x.id);
  const b = await w.spawn("b", "rejudge", { containers: ["C2"] });
  const rb = await w.result(b);
  assertEquals([rb.rejudged, rb.computes], [0, 0]);
  assertEquals(await judgmentIds(t, x.id), [...before, f.judgment.id].sort());
  const written = [
    await Deno.readTextFile(logPath(t, f.judgment.id)),
    await Deno.readTextFile(judgmentPath(t, f.judgment)),
  ];
  assertEquals(written, [
    bytes(f.log),
    bytes(JudgmentRecordSchema.parse(f.judgment)),
  ]);
  w.go(a, "afterFence");
  const ra = await w.result(a);
  assertEquals(ra.rejudged, 1, "identical bytes are success");
  assert(ra.computes > 0);
  assertEquals(fencesOf(t, x.id), ["fence-0.json", "fence-1.json"]);
  assertEquals(await judgmentIds(t, x.id), [...before, f.judgment.id].sort());
  assertEquals([
    await Deno.readTextFile(logPath(t, f.judgment.id)),
    await Deno.readTextFile(judgmentPath(t, f.judgment)),
  ], written);
  assertEquals(settled(t, x.id), []);
});

// ---- N1 ----

Deno.test("H-41 N1 (two processes): B open before A commits fence-0; A stalls after its fence; B acquires with the head advanced: B materializes fence-0 and does not compute; one judgment", async () => {
  await using t = await makeEnv();
  const x = await owedExecution(t);
  assertEquals(await judgmentIds(t, x.id), []);
  await using w = await World.open(t);
  const b = await w.spawn("b", "judge-pending", {
    containers: ["C2"],
    pauses: ["opened"],
  });
  await w.at(b, "opened");
  const a = await w.spawn("a", "judge-pending", {
    containers: ["C1"],
    pauses: ["afterFence"],
    frozen: true,
  });
  await w.at(a, "afterFence");
  assertEquals(fencesOf(t, x.id), ["fence-0.json"]);
  const f = fenceOf(t, x.id, 0);
  assertEquals(await judgmentIds(t, x.id), [], "fence-0 not materialized");
  await stale(t, x.id);
  w.go(b, "opened");
  const rb = await w.result(b);
  assertEquals([rb.judged, rb.computes], [0, 0]);
  assertEquals(await judgmentIds(t, x.id), [f.judgment.id]);
  w.go(a, "afterFence");
  const ra = await w.result(a);
  assertEquals(ra.judged, 1);
  assert(ra.computes > 0);
  assertEquals(fencesOf(t, x.id), ["fence-0.json"]);
  assertEquals(await judgmentIds(t, x.id), [f.judgment.id]);
  assertEquals(settled(t, x.id), []);
});

Deno.test("H-41 N1 budget boundary (two processes): two unscored judgments; B's due list is made, then A commits a third (unscored) and stalls before materializing; B does not compute and the budget is exhausted once reconciled", async () => {
  await using t = await makeEnv();
  const { es } = await mockCampaign(t);
  const x = es[0]!;
  await unscoredJudgments(t, x.id, 2);
  const [j0] = await t.env.store.judgments(x.id);
  const oracle = j0!.task_oracle_hash;
  const current = await currentScorerFingerprint();
  assert(
    !rejudgeBudgetExhausted(
      x,
      await t.env.store.judgments(x.id),
      oracle,
      current,
    ),
  );
  const before = await judgmentIds(t, x.id);
  await using w = await World.open(t);
  const b = await w.spawn("b", "rejudge", {
    containers: ["C3"],
    pauses: ["asked"],
  });
  await w.at(b, "asked");
  const a = await w.spawn("a", "rejudge", {
    containers: ["C1", "C2"],
    pauses: ["afterFence"],
    frozen: true,
    unscored: true,
  });
  await w.at(a, "afterFence");
  const f = fenceOf(t, x.id, 1);
  assertEquals(f.judgment.verdict, "unscored");
  assertEquals(await judgmentIds(t, x.id), before, "not materialized yet");
  await stale(t, x.id);
  w.go(b, "asked");
  const rb = await w.result(b);
  assertEquals([rb.rejudged, rb.computes], [0, 0]);
  const js = await t.env.store.judgments(x.id);
  assertEquals(js.map((j) => j.id).sort(), [...before, f.judgment.id].sort());
  assert(rejudgeBudgetExhausted(x, js, oracle, current), "three unscored");
  w.go(a, "afterFence");
  const ra = await w.result(a);
  assertEquals(ra.rejudged, 1);
  assertEquals(fencesOf(t, x.id), ["fence-0.json", "fence-1.json"]);
  assertEquals(await judgmentIds(t, x.id), [...before, f.judgment.id].sort());
  assertEquals(settled(t, x.id), []);
});

// ---- materialization ----

Deno.test("H-41 materialization (two processes): both materialize one fence at once (each read its judgment missing): both succeed; one log, one judgment, the fence's bytes, no temp left", async () => {
  await using t = await makeEnv();
  const { e, c } = await judgedWithRejudgment(t);
  await using w = await World.open(t);
  const o = {
    pauses: ["opened", "listed"],
    listed: e.id,
    recover: true,
  };
  const a = await w.spawn("a", "open", { ...o, containers: ["C1"] });
  const b = await w.spawn("b", "open", { ...o, containers: ["C2"] });
  await w.at(a, "opened");
  await w.at(b, "opened");
  await plantFence(t, e, 1, c);
  w.go(a, "opened");
  w.go(b, "opened");
  await w.at(a, "listed");
  await w.at(b, "listed");
  w.go(a, "listed");
  w.go(b, "listed");
  const ra = await w.result(a);
  const rb = await w.result(b);
  assertEquals([ra.recovered, rb.recovered], [1, 1], "both materialized");
  assertEquals([ra.computes, rb.computes], [0, 0]);
  const verdicts = names(join(t.env.resultsRoot, "verdicts"));
  assertEquals(verdicts.filter((n) => n.startsWith(c.judgment.id)), [
    `${c.judgment.id}.json`,
  ]);
  assertEquals(verdicts.filter((n) => n.includes(".tmp-")), []);
  assertEquals(
    names(join(t.env.resultsRoot, "judgments", e.id)).filter((n) =>
      n.startsWith(c.judgment.id) || n.includes(".tmp-")
    ),
    [`${c.judgment.id}.json`],
  );
  assertEquals([
    await Deno.readTextFile(logPath(t, c.judgment.id)),
    await Deno.readTextFile(judgmentPath(t, c.judgment)),
  ], [bytes(c.log), bytes(JudgmentRecordSchema.parse(c.judgment))]);
  assertEquals((await t.env.store.judgments(e.id)).length, 2);
});

Deno.test("H-41 materialization (two processes): a process killed after its log temp and before the link leaves no final name; a fresh process recovers the fence with no compute", async () => {
  await using t = await makeEnv();
  const { e, c } = await judgedWithRejudgment(t);
  await using w = await World.open(t);
  const k = await w.spawn("k", "open", {
    containers: ["C1"],
    pauses: ["opened", "beforeLink:log"],
    recover: true,
  });
  await w.at(k, "opened");
  await plantFence(t, e, 1, c);
  w.go(k, "opened");
  await w.at(k, "beforeLink:log");
  const verdicts = join(t.env.resultsRoot, "verdicts");
  const temps = names(verdicts).filter((n) =>
    n.startsWith(`${c.judgment.id}.json.tmp-`)
  );
  assertEquals(temps.length, 1, "the log temp is written");
  assert(!await exists(logPath(t, c.judgment.id)), "no final log yet");
  await w.kill(k);
  assert(!await exists(logPath(t, c.judgment.id)), "killed before the link");
  const fresh = await w.spawn("fresh", "open", { containers: ["C2"] });
  const r = await w.result(fresh);
  assertEquals(r.computes, 0);
  assertEquals([
    await Deno.readTextFile(logPath(t, c.judgment.id)),
    await Deno.readTextFile(judgmentPath(t, c.judgment)),
  ], [bytes(c.log), bytes(JudgmentRecordSchema.parse(c.judgment))]);
  assertEquals((await t.env.store.judgments(e.id)).length, 2);
  // The dead process's temp is young: the fresh start's sweep kept it.
  assertEquals(
    names(verdicts).filter((n) => n.startsWith(`${c.judgment.id}.json.tmp-`)),
    temps,
  );
});

// ---- Task 7 / F6 ----

Deno.test("H-41 Task 7 / F6 (two processes): two lineages with different env_fps, both past the history check at the pin barrier: exactly one pin; the loser admits nothing and commits nothing", async () => {
  await using t = await makeEnv();
  const { e, c } = await judgedWithRejudgment(t);
  const before = await judgmentIds(t, e.id);
  const fp = (v: string): ComputedJudgment => ({
    log: { ...c.log, judgment_id: `${c.judgment.id.slice(0, -1)}${v}` },
    judgment: {
      ...c.judgment,
      id: `${c.judgment.id.slice(0, -1)}${v}`,
      provenance: {
        ...c.judgment.provenance!,
        env_fp: v === "a" ? FP : OTHER_FP,
      },
    },
  });
  await using w = await World.open(t);
  const file = (v: string) => join(w.root, `computed-${v}.json`);
  for (const v of ["a", "b"]) {
    await Deno.writeTextFile(file(v), JSON.stringify(fp(v)));
  }
  const o = (v: string) => ({
    containers: [v === "a" ? "J1" : "J2"],
    pauses: ["beforeLink:pin", "committing"],
    campaign: e.campaign_id,
    execution: e.id,
    computed: file(v),
    lineage: `lineage-${v}`,
    envFp: v === "a" ? FP : OTHER_FP,
  });
  const a = await w.spawn("a", "pin", o("a"));
  const b = await w.spawn("b", "pin", o("b"));
  await w.at(a, "beforeLink:pin");
  await w.at(b, "beforeLink:pin");
  // Both inspected the history and wrote their pin temp; neither linked.
  const pins = names(join(t.env.resultsRoot, "env-pins"));
  assertEquals(pins.filter((n) => !n.includes(".tmp-")), [], "no pin yet");
  assertEquals(pins.length, 2, "both pin temps");
  w.go(a, "beforeLink:pin");
  w.go(b, "beforeLink:pin");
  // Both admissions are decided; then the winner commits, then the loser.
  await w.at(a, "committing");
  await w.at(b, "committing");
  assertEquals(names(join(t.env.resultsRoot, "env-pins")), [
    `${e.campaign_id}.json`,
  ]);
  const pin = JSON.parse(
    await Deno.readTextFile(pinPath(t.env.resultsRoot, e.campaign_id)),
  );
  const [first, second, v] = pin.env_fp === FP ? [a, b, "a"] : [b, a, "b"];
  w.go(first, "committing");
  const win = await w.result(first);
  w.go(second, "committing");
  const lose = await w.result(second);
  assertEquals([pin.lineage_id, pin.by.pid], [`lineage-${v}`, win.pid]);
  assertEquals([win.members, win.committed], [[v === "a" ? "J1" : "J2"], true]);
  assertEquals([lose.members, lose.committed, lose.dropped], [
    [],
    false,
    undefined,
  ]);
  // Refused at commit step 7 (definitive), not merely dropped.
  assertStringIncludes(lose.error!, "pinned");
  assertStringIncludes(lose.error!, "nothing written");
  assertEquals(fencesOf(t, e.id), ["fence-0.json", "fence-1.json"]);
  const f = fenceOf(t, e.id, 1);
  assertEquals([f.pid, f.judgment.provenance?.env_fp], [win.pid, pin.env_fp]);
  assertEquals(await judgmentIds(t, e.id), [...before, f.judgment.id].sort());
  assertEquals(
    names(join(t.env.resultsRoot, "verdicts")).filter((n) =>
      n.startsWith(fp("a").judgment.id) || n.startsWith(fp("b").judgment.id)
    ),
    [`${f.judgment.id}.json`],
    "no verdict log of the loser",
  );
});

// ---- F10 ----

Deno.test("H-41 F10 (two processes): env B starts while A is paused between its fence temp and its link: B's start sweep removes nothing younger than the bound; A then commits once", async () => {
  await using t = await makeEnv();
  const x = await owedExecution(t);
  await using w = await World.open(t);
  const a = await w.spawn("a", "judge-pending", {
    containers: ["C1"],
    pauses: ["beforeLink:fence"],
  });
  await w.at(a, "beforeLink:fence");
  const temps = names(claimsDir(t, x.id)).filter((n) =>
    n.startsWith("fence-0.json.tmp-")
  );
  assertEquals(temps.length, 1, "A's fence temp");
  const b = await w.spawn("b", "open", { containers: ["C2"] });
  const rb = await w.result(b);
  assertEquals(rb.computes, 0);
  assertEquals(
    names(claimsDir(t, x.id)).filter((n) => n.includes(".tmp-")),
    temps,
    "B's sweep kept the young temp",
  );
  w.go(a, "beforeLink:fence");
  const ra = await w.result(a);
  assertEquals(ra.judged, 1);
  assertEquals(fencesOf(t, x.id), ["fence-0.json"]);
  assertEquals(await judgmentIds(t, x.id), [fenceOf(t, x.id, 0).judgment.id]);
  assertEquals(settled(t, x.id), []);
});
