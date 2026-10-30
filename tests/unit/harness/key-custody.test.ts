/**
 * H-44 group 2 (design-final 5.1-5.3, 7): key custody. The probe (crafted
 * output through the runner seam, the real parser and evaluator; the real
 * Windows command in 13), admission, export at publication and import at
 * judging. Numbers in test names are the design's section 7 test numbers;
 * test 1 (two processes) is in pool-subprocess.test.ts.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { walk } from "@std/fs";
import { dirname, join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import type {
  CellRef,
  CustodyEnv,
  HarnessEnv,
} from "../../../src/harness/execution.ts";
import type { ProbeRunner } from "../../../src/harness/key-custody.ts";
import type { ExecutionRecord } from "../../../src/harness/records.ts";
import {
  admitKeyCustody,
  judgmentOwed,
  privatePaths,
  publishJudgment,
  recoverInterrupted,
  rejudgeExecution,
  runCell,
  scrubForcedReason,
} from "../../../src/harness/execution.ts";
import {
  posixProblem,
  probeCustody,
  realProbeRunner,
} from "../../../src/harness/key-custody.ts";
import { restrictPath } from "../../../src/harness/sandbox.ts";
import { loadTask } from "../../../src/harness/task.ts";
import {
  type EnvDeps,
  openHarnessEnv,
} from "../../../cli/commands/harness-env.ts";
import { acquireBenchLock } from "../../../src/utils/bench-lock.ts";
import {
  custodyDir,
  custodyEnv,
  factOf,
  type Facts,
  factsRunner,
  rule,
  safeFacts,
  USERS_SID,
} from "./custody-fixture.ts";
import { FakeBc, result } from "./fake-bc.ts";
import { FakeDocker } from "./fake-docker.ts";
import { noOnPrem } from "./onprem-fixture.ts";
import {
  cellFor,
  makeEnv,
  SECRET_OAUTH,
  type TestEnv,
} from "./runtime-fixture.ts";

const isWindows = Deno.build.os === "windows";

const exists = (p: string) => Deno.lstat(p).then(() => true, () => false);

const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

const R1 =
  "are missing or invalid; refusing to judge (nothing could be redacted). Judging in another process: pass --key-custody <dir> to both the publishing and the judging process";
const STUB = "is a stub-provider run (scripted model): never judged";

/** A verdict container whose oracle failure message carries the attempt's oauth secret. */
const leakingBc = () =>
  new FakeBc((cu) => {
    if (cu === 80010) return result({ ShippedPasses: true });
    if (cu === 85000) {
      return result({
        FixWorks: `Assert.AreEqual failed. Expected:<${SECRET_OAUTH}>`,
      });
    }
    return result({});
  });

/** A judged live run published with --key-custody (the control every negative starts from). */
async function judgedRun(t: TestEnv) {
  const cell = await cellFor(t);
  const e = (await runCell(t.env, cell)).executions[0]!;
  assertEquals((await t.env.store.judgments(e.id)).length, 1, "control judged");
  return { cell, e, p: privatePaths(t.env, e.id) };
}

/**
 * B: a judging process over the same results with an empty private root
 * of its own (no redaction/, no marker); `keyCustody` its flag.
 */
async function judgeB(
  t: TestEnv,
  keyCustody: string | null,
  over: Partial<HarnessEnv> = {},
): Promise<HarnessEnv & AsyncDisposable> {
  const privateRoot = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "cg-h44-b-" }),
  );
  const { keyCustody: _k, ...rest } = t.env;
  return {
    ...rest,
    privateRoot,
    deploy: { ...t.env.deploy, ledgerRoot: join(privateRoot, "bc-ledger") },
    ...(keyCustody ? { keyCustody } : {}),
    ...over,
    async [Symbol.asyncDispose]() {
      await Deno.remove(privateRoot, { recursive: true }).catch(() => {});
    },
  };
}

function countJudgings(env: HarnessEnv) {
  const lane = env.lane;
  const real = lane.exclusive.bind(lane);
  const n = { calls: 0 };
  lane.exclusive = ((...a: Parameters<typeof lane.exclusive>) => {
    n.calls++;
    return real(...a);
  }) as typeof lane.exclusive;
  return {
    n,
    [Symbol.dispose]() {
      lane.exclusive = real;
    },
  };
}

const verdictCount = (t: TestEnv) =>
  [...Deno.readDirSync(join(t.env.resultsRoot, "verdicts"))].length;

/** A rejudge in `env` refused with `text`: no lane call, no judgment, no verdict log. */
async function refusesJudging(
  t: TestEnv,
  env: HarnessEnv,
  cell: CellRef,
  e: ExecutionRecord,
  text: string,
) {
  const before = (await t.env.store.judgments(e.id)).length;
  const logs = verdictCount(t);
  using c = countJudgings(env);
  const err = await assertRejects(() =>
    rejudgeExecution(env, cell, e, cell.oracleHash)
  );
  assertStringIncludes((err as Error).message, text);
  assertEquals(c.n.calls, 0, "no lane call");
  assertEquals((await t.env.store.judgments(e.id)).length, before);
  assertEquals(verdictCount(t), logs, "no verdict log");
  return (err as Error).message;
}

/** A rejudge in `env`, published: its verdict log carries the redaction, never the secret. */
async function judgesRedacted(
  t: TestEnv,
  env: HarnessEnv,
  cell: CellRef,
  e: ExecutionRecord,
) {
  const j = await publishJudgment(
    env,
    e,
    cell.oracleHash,
    await rejudgeExecution(env, cell, e, cell.oracleHash),
  );
  const log = await Deno.readTextFile(
    join(t.env.resultsRoot, "verdicts", `${j.id}.json`),
  );
  assert(!log.includes(SECRET_OAUTH), "the secret in a verdict log");
  assertStringIncludes(log, "[REDACTED:claude-oauth-token]");
  return j;
}

const FS_OPS = [
  "readFile",
  "readTextFile",
  "open",
  "lstat",
  "stat",
  "realPath",
  "readFileSync",
  "readTextFileSync",
  "openSync",
  "lstatSync",
  "statSync",
  "realPathSync",
] as const;
const READS = new Set(["readFile", "readTextFile", "open"]);

/** Every Deno fs call (and which) on a path under `root` while in scope. */
function fsSpy(root: string) {
  const hits: { op: string; path: string }[] = [];
  const d = Deno as unknown as Record<string, (...a: unknown[]) => unknown>;
  const saved = FS_OPS.map((op) => [op, d[op]!] as const);
  const fold = (p: string) => isWindows ? p.toLowerCase() : p;
  for (const [op, real] of saved) {
    Object.defineProperty(Deno, op, {
      configurable: true,
      writable: true,
      value: (...a: unknown[]) => {
        const p = String(a[0]);
        if (fold(p).startsWith(fold(root))) hits.push({ op, path: p });
        return real.apply(Deno, a);
      },
    });
  }
  return {
    hits,
    reads: () => hits.filter((h) => READS.has(h.op)),
    [Symbol.dispose]() {
      for (const [op, real] of saved) {
        Object.defineProperty(Deno, op, {
          configurable: true,
          writable: true,
          value: real,
        });
      }
    },
  };
}

/** console.warn lines while in scope. */
function warnings() {
  const lines: string[] = [];
  const real = console.warn;
  console.warn = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  return {
    lines,
    [Symbol.dispose]() {
      console.warn = real;
    },
  };
}

const entries = (dir: string) => [...Deno.readDirSync(dir)].map((x) => x.name);

/** The salts, key hashes and own bundle bytes of `e` appear nowhere under results/. */
async function nothingUnderResults(t: TestEnv, e: ExecutionRecord) {
  const p = privatePaths(t.env, e.id);
  const bundle = await Deno.readTextFile(p.bundle);
  const keys = JSON.parse(await Deno.readTextFile(p.keys)) as {
    salt: string;
    sha256: string;
  }[];
  let published = "";
  for await (const x of walk(t.env.resultsRoot, { includeDirs: false })) {
    published += new TextDecoder("latin1").decode(await Deno.readFile(x.path));
  }
  assert(!published.includes(bundle), "the bundle under results/");
  for (const k of keys) {
    assert(!published.includes(k.salt), "a salt under results/");
    assert(!published.includes(k.sha256), "a key hash under results/");
  }
}

const intents = (t: TestEnv) => {
  try {
    return [...Deno.readDirSync(join(t.env.privateRoot, "intents"))]
      .map((x) => x.name).filter((n) => !n.includes(".tmp-"));
  } catch {
    return [];
  }
};

/** A cell killed right before its draft (released, nothing published); its intent. */
async function killedBeforeDraft(t: TestEnv) {
  const cell = await cellFor(t);
  t.env.hooks = {
    beforeDraft: () => Promise.reject(new Error("runner killed")),
  };
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  t.env.hooks = {};
  const path = join(t.env.privateRoot, "intents", intents(t)[0]!);
  return { cell, path, intent: JSON.parse(await Deno.readTextFile(path)) };
}

// ---- 21: the publisher side ----

Deno.test("H-44 (21): a publisher without --key-custody records no custody in its intent and exports nothing; with it, the intent names <K> and <K>/<id>.json holds the own bundle's exact bytes", async () => {
  await using k = await custodyDir();
  {
    await using t = await makeEnv();
    t.env.probeRunner = factsRunner();
    let intent: Record<string, unknown> = {};
    t.env.hooks = {
      prepared: async (id) => {
        intent = JSON.parse(
          await Deno.readTextFile(privatePaths(t.env, id).intent),
        );
      },
    };
    await judgedRun(t);
    assert(!("key_custody" in intent), "no custody in the intent");
    assertEquals(entries(k.dir), [], "nothing exported");
  }
  await using t = await custodyEnv();
  let intent: Record<string, unknown> = {};
  t.env.hooks = {
    prepared: async (id) => {
      intent = JSON.parse(
        await Deno.readTextFile(privatePaths(t.env, id).intent),
      );
    },
  };
  const { e, p } = await judgedRun(t);
  assertEquals(intent["key_custody"], t.custody);
  assertEquals(entries(t.custody), [`${e.id}.json`], "one file, no temp");
  assertEquals(
    await Deno.readFile(join(t.custody, `${e.id}.json`)),
    await Deno.readFile(p.bundle),
  );
});

Deno.test("H-44 (21): scrubForcedReason redacts through <K> in a root without the bundle and refuses R1 without the flag", async () => {
  await using t = await custodyEnv();
  const { e } = await judgedRun(t);
  await using b = await judgeB(t, t.custody);
  assertEquals(
    await scrubForcedReason(b, e, `infra: ${SECRET_OAUTH} leaked`),
    "infra: [REDACTED:claude-oauth-token] leaked",
  );
  await using none = await judgeB(t, null);
  using spy = fsSpy(t.custody);
  const err = await assertRejects(() => scrubForcedReason(none, e, "infra"));
  assertStringIncludes((err as Error).message, R1);
  assertEquals(spy.hits, [], "K never touched");
});

// ---- 2: authorization ----

Deno.test("H-44 (2): a judge with --key-custody and an empty private root judges, redacted; the identical judge without it refuses R1 and never touches <K>", async () => {
  await using t = await custodyEnv({ bc: leakingBc() });
  const { cell, e } = await judgedRun(t);
  await using b = await judgeB(t, t.custody);
  await judgesRedacted(t, b, cell, e);
  assert(!await exists(join(b.privateRoot, "redaction")), "B stays empty");
  await using none = await judgeB(t, null);
  using spy = fsSpy(t.custody);
  const m = await refusesJudging(t, none, cell, e, R1);
  assertStringIncludes(m, privatePaths(none, e.id).bundle);
  assertEquals(spy.hits, [], "zero opens under K");
  assertEquals(
    await judgmentOwed(none, { ...e }),
    false,
    "already judged: not owed",
  );
});

// ---- 3: nothing under results/ ----

Deno.test("H-44 (3): after a normal and a recovered publish with --key-custody no salt, key hash or bundle byte is under results/; both bundles are in <K>", async () => {
  await using t = await custodyEnv();
  const { e } = await judgedRun(t);
  const { intent } = await killedBeforeDraft(t);
  const [r] = await recoverInterrupted(t.env, loadTask);
  assertEquals(r!.id, intent.execution_id);
  assertEquals(
    entries(t.custody).sort(),
    [`${e.id}.json`, `${r!.id}.json`].sort(),
  );
  await nothingUnderResults(t, e);
  await nothingUnderResults(t, r!);
});

Deno.test("H-44 (3): a custody dir inside or aliasing results/ (or the repo or the private root) is refused at admission, and none is created", async () => {
  await using t = await makeEnv();
  t.env.probeRunner = factsRunner();
  await using k = await custodyDir();
  assertEquals(await admitKeyCustody(t.env, k.dir, false), k.dir, "control");
  const inside = join(t.env.resultsRoot, "k");
  await assertRejects(
    () => admitKeyCustody(t.env, inside, true),
    ConfigurationError,
    "overlaps the results root",
  );
  assert(!await exists(inside), "nothing created under results/");
  await Deno.mkdir(inside);
  await assertRejects(
    () => admitKeyCustody(t.env, inside, false),
    ConfigurationError,
    "overlaps the results root",
  );
  await assertRejects(
    () => admitKeyCustody(t.env, t.env.resultsRoot, false),
    ConfigurationError,
    "overlaps the results root",
  );
  await assertRejects(
    () => admitKeyCustody(t.env, join(t.env.privateRoot, "k"), true),
    ConfigurationError,
    "overlaps the private root",
  );
  assert(!await exists(join(t.env.privateRoot, "k")));
  const alias = join(k.parent, "alias");
  await Deno.symlink(
    t.env.resultsRoot,
    alias,
    isWindows ? { type: "junction" } : undefined,
  );
  await assertRejects(
    () => admitKeyCustody(t.env, alias, false),
    ConfigurationError,
    "canonical",
  );
  await Deno.remove(alias);
});

Deno.test("H-44 (3): a recovery whose intent names the original results root as custody skips the export with a warning, writes no byte there and publishes", async () => {
  await using t = await custodyEnv();
  const { cell, path, intent } = await killedBeforeDraft(t);
  await Deno.writeTextFile(
    path,
    JSON.stringify({ ...intent, key_custody: intent.results_root }),
  );
  const before = entries(t.env.resultsRoot);
  using w = warnings();
  const [r] = await recoverInterrupted(t.env, loadTask);
  assertEquals(r!.id, intent.execution_id);
  const line = w.lines.find((l) => l.includes("key custody"));
  assert(line, w.lines.join("\n"));
  assertStringIncludes(
    line,
    `[WARN] ${r!.id}: key custody ${intent.results_root} refused (`,
  );
  assertStringIncludes(line, "); not exported");
  assertEquals(
    entries(t.env.resultsRoot).filter((n) => !before.includes(n)).filter((
      n,
    ) => n.startsWith(r!.id)),
    [],
    "no byte in that custody",
  );
  assertEquals(entries(t.custody), [], "nothing elsewhere either");
  assertEquals(
    (await t.env.store.executions(cell.campaignId)).map((x) => x.id),
    [r!.id],
    "published",
  );
});

// ---- 4: byte identity ----

/** A computed judgment's bytes, per-run values (ids, times, spans) aside. */
function perRun(v: unknown): string {
  const o = v as { judgment: { id: string }; log: unknown };
  let s = JSON.stringify(v, null, 2).replaceAll(o.judgment.id, "<id>");
  s = s.replace(/"(started_at|ended_at)": "[^"]*"/g, `"$1": "<at>"`);
  return s.replace(
    /"spans": \{[^}]*\}/g,
    (m) => m.replace(/": -?[0-9.e+-]+/g, `": "<ms>"`),
  );
}

Deno.test("H-44 (4): judging through <K> and through the own root compute equal bytes", async () => {
  await using t = await custodyEnv({ bc: leakingBc() });
  const { cell, e } = await judgedRun(t);
  const own = await rejudgeExecution(t.env, cell, e, cell.oracleHash);
  await using b = await judgeB(t, t.custody);
  const viaK = await rejudgeExecution(b, cell, e, cell.oracleHash);
  assertStringIncludes(
    JSON.stringify(own.log),
    "[REDACTED:claude-oauth-token]",
  );
  assertEquals(perRun(viaK), perRun(own));
});

// ---- 7(c), 8, legacy: import refusals ----

Deno.test("H-44 (7c): an authentic stub bundle through <K> alone (no marker, no stub_provider) refuses with zero lane calls and is never owed", async () => {
  await using t = await custodyEnv({ bc: leakingBc() });
  const { cell, e } = await judgedRun(t);
  await using b = await judgeB(t, t.custody);
  await judgesRedacted(t, b, cell, e);
  // Seen unjudged, the authentic bundle through K is owed (the control).
  const store = b.store;
  b.store = Object.create(store, {
    judgments: { value: () => Promise.resolve([]) },
  });
  assertEquals(await judgmentOwed(b, e), true, "control: owed");
  b.store = store;
  const kb = join(t.custody, `${e.id}.json`);
  const good = JSON.parse(await Deno.readTextFile(kb));
  const bytes = new TextEncoder().encode(JSON.stringify({
    ...good,
    stub: { scenario_sha256: "a".repeat(64), image_override: null },
  }));
  await Deno.writeFile(kb, bytes);
  const stubbed = { ...e, redaction_anchor: await sha256(bytes) };
  assert(!await exists(privatePaths(b, e.id).stubMarker));
  const side = JSON.parse(
    await Deno.readTextFile(
      join(t.env.resultsRoot, "runs", e.id, "sandbox.json"),
    ),
  );
  assert(!("stub_provider" in side), "no public stub_provider");
  await refusesJudging(t, b, cell, stubbed, STUB);
  // Seen unjudged again: the stub bundle alone makes it not owed.
  b.store = Object.create(store, {
    judgments: { value: () => Promise.resolve([]) },
  });
  assertEquals(await judgmentOwed(b, stubbed), false, "a stub: not owed");
  b.store = store;
});

Deno.test("H-44 (8): --key-custody without the execution's bundle in <K> refuses R3 naming <K>/<id>.json exactly", async () => {
  await using t = await custodyEnv({ bc: leakingBc() });
  const { cell, e } = await judgedRun(t);
  await using b = await judgeB(t, t.custody);
  await judgesRedacted(t, b, cell, e);
  const kb = join(t.custody, `${e.id}.json`);
  await Deno.remove(kb);
  using spy = fsSpy(t.custody);
  await refusesJudging(
    t,
    b,
    cell,
    e,
    `redaction bundle ${kb} for execution ${e.id} is not in key custody ${t.custody}; refusing to judge`,
  );
  assertEquals(spy.reads(), [], "nothing read under K");
});

Deno.test("H-44 (9, R8): a legacy (v2) record without its key file refuses through --key-custody as published before H-44", async () => {
  await using t = await custodyEnv();
  const { cell, e } = await judgedRun(t);
  const { redaction_anchor: _a, ...rest } = e;
  const legacy: ExecutionRecord = { ...rest, v: 2 };
  await using b = await judgeB(t, t.custody);
  using spy = fsSpy(t.custody);
  await refusesJudging(
    t,
    b,
    cell,
    legacy,
    `execution ${e.id} was published before H-44 (record v2): no redaction anchor; judge it in its publishing private root or copy redaction/${e.id}.json there`,
  );
  assertEquals(spy.hits, [], "K never touched");
});

// ---- export refusals that are not skips ----

Deno.test("H-44 (export): an own bundle that no longer matches the anchor throws at publication; nothing published, the intent kept, nothing in <K>", async () => {
  await using t = await custodyEnv();
  const cell = await cellFor(t);
  t.env.hooks = {
    after: (s) =>
      s === "draft"
        ? Promise.reject(new Error("runner killed"))
        : Promise.resolve(),
  };
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  t.env.hooks = {};
  const id = intents(t)[0]!.replace(".json", "");
  const p = privatePaths(t.env, id);
  const b = JSON.parse(await Deno.readTextFile(p.bundle));
  b.keys[0].name = "renamed";
  await Deno.writeTextFile(p.bundle, JSON.stringify(b));
  await assertRejects(
    () => recoverInterrupted(t.env, loadTask),
    ConfigurationError,
    `own redaction bundle ${p.bundle} does not match`,
  );
  assertEquals(await t.env.store.executions(cell.campaignId), []);
  assertEquals(intents(t), [`${id}.json`]);
  assertEquals(entries(t.custody), []);
});

Deno.test("H-44 (export): a lock lost at the custody link propagates out of publication (no skip): the run never reaches results/", async () => {
  await using t = await custodyEnv();
  const cell = await cellFor(t);
  let lost = false;
  let links = 0;
  t.env.namespaceLost = () => lost;
  t.env.hooks = {
    beforeLink: (what) => {
      // The own bundle first, then the custody export.
      if (what === "bundle" && ++links === 2) lost = true;
      return Promise.resolve();
    },
  };
  using w = warnings();
  const err = await assertRejects(() => runCell(t.env, cell));
  assertStringIncludes((err as Error).message, "was taken over");
  assertEquals(links, 2);
  assert(!w.lines.some((l) => l.includes("not exported")), "not a skip");
  assertEquals(await t.env.store.executions(cell.campaignId), []);
  assertEquals(entries(join(t.env.resultsRoot)).includes("runs"), false);
});

// ---- 11: the evaluator (crafted output, the real parser and evaluator) ----

/** A custody dir with one bundle; probe it with crafted facts edited by `edit`. */
async function probeWith(
  edit: (f: Facts, at: { dir: string; parent: string; bundle: string }) => void,
) {
  await using k = await custodyDir();
  const bundle = join(k.dir, "x.json");
  await Deno.writeTextFile(bundle, "{}");
  const at = { dir: k.dir, parent: k.parent, bundle };
  return await probeCustody(k.dir, bundle, {
    runner: factsRunner((f) => edit(f, at)),
    timeoutMs: 5_000,
  }).then(() => null, (err: Error) => err);
}

async function refused(
  name: string,
  edit: Parameters<typeof probeWith>[0],
  text: string,
) {
  const err = await probeWith(edit);
  assert(err, `${name}: accepted`);
  assert(err instanceof ConfigurationError, `${name}: ${err}`);
  assertStringIncludes(err.message, text, name);
}

async function accepted(name: string, edit: Parameters<typeof probeWith>[0]) {
  assertEquals(await probeWith(edit), null, name);
}

Deno.test("H-44 (11): the evaluator refuses untrusted owners, each parent write bit granted to Users, Deny and inherit-only rules on the dir and bundle, an ancestor reparse point and a bundle link; read-only and inherit-only parent rules are accepted", async () => {
  await accepted("control", () => {});
  for (const role of ["dir", "parent", "bundle"] as const) {
    await refused(
      `untrusted owner of the ${role}`,
      (f, at) => factOf(f, at[role]).owner = USERS_SID,
      `owned by ${USERS_SID}`,
    );
  }
  for (
    const bit of [
      0x2,
      0x4,
      0x10,
      0x40,
      0x100,
      0x10000,
      0x40000,
      0x80000,
      0x10000000,
      0x40000000,
    ]
  ) {
    await refused(
      `Users 0x${bit.toString(16)} on the parent`,
      (f, at) => factOf(f, at.parent).rules.push(rule(USERS_SID, bit)),
      `grants ${USERS_SID} write rights 0x${bit.toString(16)}`,
    );
  }
  await accepted(
    "read-only Users on the parent",
    (f, at) => factOf(f, at.parent).rules.push(rule(USERS_SID, 0x1200a9)),
  );
  await accepted(
    "inherit-only Users FullControl on the parent",
    (f, at) =>
      factOf(f, at.parent).rules.push(
        rule(USERS_SID, 0x1f01ff, { inheritOnly: true }),
      ),
  );
  await refused(
    "unsafe Users Allow plus a Users Deny on the parent",
    (f, at) =>
      factOf(f, at.parent).rules.push(
        rule(USERS_SID, 0x2),
        rule(USERS_SID, 0x1f01ff, { deny: true }),
      ),
    `grants ${USERS_SID} write rights 0x2`,
  );
  for (const role of ["dir", "bundle"] as const) {
    await refused(
      `extra Deny on the ${role}`,
      (f, at) =>
        factOf(f, at[role]).rules.push(
          rule(USERS_SID, 0x1200a9, { deny: true }),
        ),
      `has a Deny rule for ${USERS_SID}`,
    );
    await refused(
      `extra Allow on the ${role}`,
      (f, at) => factOf(f, at[role]).rules.push(rule(USERS_SID, 0x1200a9)),
      `grants ${USERS_SID}`,
    );
    await refused(
      `${role} not protected`,
      (f, at) => factOf(f, at[role]).protected = false,
      "inherits its ACL",
    );
  }
  await refused(
    "inherit-only extra rule on the dir",
    (f, at) =>
      factOf(f, at.dir).rules.push(rule(USERS_SID, 0x1f01ff, {
        inheritOnly: true,
      })),
    `has an inherit-only rule for ${USERS_SID}`,
  );
  await refused(
    "no FullControl for the user",
    (f, at) => factOf(f, at.dir).rules[0]!.rights = 0x1200a9,
    "lacks FullControl",
  );
  await refused(
    "ancestor reparse point",
    (f, at) => factOf(f, at.dir).ancestors = [false, true],
    "reparse point",
  );
  await refused(
    "bundle reparse point",
    (f, at) => factOf(f, at.bundle).reparse = true,
    "reparse point",
  );
});

Deno.test("H-44 (11): a bundle that is a symlink is refused by the link checks", async () => {
  await using k = await custodyDir();
  const target = join(k.parent, "t.json");
  await Deno.writeTextFile(target, "{}");
  const bundle = join(k.dir, "x.json");
  try {
    await Deno.symlink(target, bundle, { type: "file" });
  } catch (err) {
    // ponytail: no symlink privilege on this Windows host; the reparse fact case above covers it.
    if (isWindows) {
      console.warn(`[SKIP] symlink not creatable: ${err}`);
      return;
    }
    throw err;
  }
  const err = await probeCustody(k.dir, bundle, {
    runner: factsRunner(),
    timeoutMs: 5_000,
  }).then(() => null, (e: Error) => e);
  assert(err instanceof ConfigurationError, String(err));
  assertStringIncludes(err.message, "not a plain file");
});

const st = (uid: number, mode: number, kind: "dir" | "file" = "dir") => ({
  uid,
  mode,
  isSymlink: false,
  isDirectory: kind === "dir",
  isFile: kind === "file",
});

Deno.test("H-44 (11, POSIX evaluator): a 0755 parent of another uid, a 0750 dir and a 0777 non-sticky parent are refused; a root-owned sticky 01777 parent is accepted", () => {
  const me = 1000;
  const ok = {
    dir: st(me, 0o40700),
    parent: st(me, 0o40755),
    bundle: st(me, 0o100600, "file"),
  };
  assertEquals(posixProblem(ok, me), null, "control");
  assertEquals(
    posixProblem({ ...ok, parent: st(0, 0o41777) }, me),
    null,
    "sticky root-owned parent",
  );
  assertStringIncludes(
    posixProblem({ ...ok, parent: st(4242, 0o40755) }, me)!,
    "owned by uid 4242",
  );
  assertStringIncludes(
    posixProblem({ ...ok, dir: st(me, 0o40750) }, me)!,
    "mode 750",
  );
  assertStringIncludes(
    posixProblem({ ...ok, parent: st(me, 0o40777) }, me)!,
    "group or other writable",
  );
  assertStringIncludes(
    posixProblem({ ...ok, bundle: st(me, 0o100640, "file") }, me)!,
    "mode 640",
  );
  assertStringIncludes(
    posixProblem({ ...ok, bundle: { ...ok.bundle, isSymlink: true } }, me)!,
    "symlink",
  );
});

// ---- 12: the command boundary ----

const FAULTS: [string, (good: string) => ProbeRunner][] = [
  ["timeout", () => () => new Promise(() => {})],
  ["launch throw", () => () => Promise.reject(new Error("spawn failed"))],
  [
    "non-zero exit",
    (good) => () => Promise.resolve({ code: 1, stdout: good, stderr: "boom" }),
  ],
  [
    "empty stdout",
    () => () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
  ],
  [
    "truncated JSON",
    (good) => () =>
      Promise.resolve({ code: 0, stdout: good.slice(0, -7), stderr: "" }),
  ],
];

/** The crafted-output faults, built from the paths each call requests. */
const SHAPES: [string, (f: Facts, paths: readonly string[]) => void][] = [
  ["rule object for an array", (f) => {
    (f.results[0] as unknown as { rules: unknown }).rules = f.results[0]!
      .rules[0];
  }],
  ["missing result", (f) => void f.results.pop()],
  ["extra result", (f) => {
    f.results.push({ ...f.results[0]!, req: `${f.results[0]!.req}-other` });
  }],
];

function faultRunners(): [string, ProbeRunner][] {
  return [
    ...FAULTS.map(([n, mk]): [string, ProbeRunner] => [
      n,
      (paths, signal) => mk(JSON.stringify(safeFacts(paths)))(paths, signal),
    ]),
    ...SHAPES.map(([n, edit]): [string, ProbeRunner] => [n, factsRunner(edit)]),
  ];
}

Deno.test("H-44 (12): each command-boundary fault refuses admission (fatal)", async () => {
  await using t = await makeEnv();
  await using k = await custodyDir();
  t.env.probeRunner = factsRunner();
  assertEquals(await admitKeyCustody(t.env, k.dir, false), k.dir, "control");
  for (const [name, runner] of faultRunners()) {
    t.env.probeRunner = runner;
    const err = await assertRejects(
      () => admitKeyCustody(t.env, k.dir, false),
      ConfigurationError,
      `key custody ${k.dir} refused: `,
    );
    assertStringIncludes(err.message, "probe", name);
  }
});

Deno.test("H-44 (12): each command-boundary fault refuses an import before any key byte under <K> is read", async () => {
  await using t = await custodyEnv({ bc: leakingBc() });
  const { cell, e } = await judgedRun(t);
  await using b = await judgeB(t, t.custody);
  await judgesRedacted(t, b, cell, e);
  for (const [name, runner] of faultRunners()) {
    b.probeRunner = runner;
    using spy = fsSpy(t.custody);
    const m = await refusesJudging(
      t,
      b,
      cell,
      e,
      `key custody ${t.custody} for execution ${e.id} refused (`,
    );
    assertStringIncludes(m, "probe", name);
    assertEquals(spy.reads(), [], `${name}: a read under K`);
  }
});

Deno.test("H-44 (12): each command-boundary fault skips the export with a warning, zero bytes in <K>, and publication completes", async () => {
  await using t = await custodyEnv();
  await judgedRun(t);
  const before = entries(t.custody);
  assertEquals(before.length, 1, "control exported");
  for (const [name, runner] of faultRunners()) {
    t.env.probeRunner = runner;
    using w = warnings();
    const cell = await cellFor(t);
    const e = (await runCell(t.env, cell)).executions[0]!;
    assert(
      (await t.env.store.executions(cell.campaignId)).some((x) =>
        x.id === e.id
      ),
      `${name}: published`,
    );
    assert(
      w.lines.some((l) =>
        l.includes(`[WARN] ${e.id}: key custody ${t.custody} refused (`) &&
        l.includes("); not exported")
      ),
      `${name}: ${w.lines.join("\n")}`,
    );
    assertEquals(entries(t.custody), before, `${name}: a byte in K`);
  }
});

// ---- 13: the real probe ----

const icacls = async (...args: string[]) => {
  const out = await new Deno.Command("icacls.exe", { args, stdout: "piped" })
    .output();
  assert(out.success, `icacls ${args.join(" ")}`);
};

/** Locations disjoint from a test-owned custody dir, for admission. */
async function otherRoots(): Promise<CustodyEnv & AsyncDisposable> {
  const base = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "cg-h44-roots-" }),
  );
  for (const d of ["results", "repo", "private"]) {
    await Deno.mkdir(join(base, d));
  }
  return {
    resultsRoot: join(base, "results"),
    repoRoot: join(base, "repo"),
    privateRoot: join(base, "private"),
    opTimeoutMs: 60_000,
    async [Symbol.asyncDispose]() {
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

Deno.test({
  name:
    "H-44 (13): the real Windows probe admits a restrictPath custody dir; a parent WRITE_DAC grant to Users and a Users Deny on the dir each refuse",
  ignore: !isWindows,
  fn: async () => {
    await using k = await custodyDir();
    await using env = await otherRoots();
    await restrictPath(k.dir, {}, "dir");
    let runs = 0;
    const counted: ProbeRunner = (p, s) => {
      runs++;
      return realProbeRunner(p, s);
    };
    const admit = () =>
      admitKeyCustody({ ...env, probeRunner: counted }, k.dir, false);
    assertEquals(await admit(), k.dir, "admitted");
    assertEquals(runs, 1, "the real command ran");
    await icacls(k.parent, "/grant", `*${USERS_SID}:(WDAC)`);
    try {
      await assertRejects(
        admit,
        ConfigurationError,
        `grants ${USERS_SID} write rights 0x40000`,
      );
    } finally {
      await icacls(k.parent, "/remove:g", `*${USERS_SID}`);
    }
    assertEquals(await admit(), k.dir, "admitted again");
    await icacls(k.dir, "/deny", `*${USERS_SID}:(R)`);
    try {
      await assertRejects(
        admit,
        ConfigurationError,
        `has a Deny rule for ${USERS_SID}`,
      );
    } finally {
      await icacls(k.dir, "/remove:d", `*${USERS_SID}`);
    }
    assertEquals(runs, 4, "every case reached the real command");
  },
});

Deno.test({
  name:
    "H-44 (13, POSIX twin): the real lstat probe admits a 0700 custody dir; a 0777 non-sticky parent refuses",
  ignore: isWindows,
  fn: async () => {
    await using k = await custodyDir();
    await using env = await otherRoots();
    assertEquals(await admitKeyCustody(env, k.dir, false), k.dir);
    await Deno.chmod(k.parent, 0o777);
    await assertRejects(
      () => admitKeyCustody(env, k.dir, false),
      ConfigurationError,
      "group or other writable",
    );
  },
});

// ---- 14: admission vs export ----

/** openHarnessEnv deps with fakes for every container and the real locks. */
function envDeps(coordRoot: string, probeRunner: ProbeRunner): EnvDeps {
  return {
    allocated: (c) => Promise.resolve(c),
    acquireLock: (dir, o) => acquireBenchLock(dir, o),
    docker: () => new FakeDocker(),
    setup: (names) =>
      Promise.resolve({
        bc: new FakeBc(),
        names,
        dispose: () => Promise.resolve(),
      }),
    inspect: () => new FakeBc(),
    quarantineDir: () => join(coordRoot, "q"),
    coordRoot: () => coordRoot,
    allocatedAll: () => Promise.resolve([]),
    running: () => Promise.resolve(true),
    containerId: () => Promise.resolve("0".repeat(64)),
    resolveHost: () => Promise.resolve("127.0.0.1"),
    owner: () => "HOST1",
    health: () => ({ getState: () => ({ containers: [] }), record: () => {} }),
    verifyEgress: () => Promise.resolve(["not implemented (M1-33)"]),
    admitOnPrem: (l) => noOnPrem(l),
    probeRunner,
  };
}

Deno.test("H-44 (14): an unprotected custody dir makes openHarnessEnv throw for a publisher and for a judge; the same fault after admission only warns at export and publication completes", async () => {
  await using t = await makeEnv();
  await using k = await custodyDir();
  const coordRoot = join(k.parent, "coord");
  await Deno.mkdir(join(coordRoot, "leases"), { recursive: true });
  await Deno.writeTextFile(
    join(coordRoot, "coord.json"),
    JSON.stringify({ campaign: "harness-test" }),
  );
  const unprotected = factsRunner((f) => factOf(f, k.dir).protected = false);
  const options = (judgeOnly: boolean) => ({
    repoRoot: t.repo.root,
    resultsDir: t.env.resultsRoot,
    containers: ["C1"],
    backendPort: 0,
    secretAccounts: t.env.secretAccounts,
    symbolStore: t.repo.symbolStore,
    privateRoot: t.env.privateRoot,
    credentialLedger: null,
    command: "h44 test",
    supervised: false,
    keyCustody: k.dir,
    judgeOnly,
  });
  // The control: admitted, the environment carries the canonical dir.
  const h = await openHarnessEnv(
    options(false),
    envDeps(coordRoot, factsRunner()),
  );
  try {
    assertEquals(h.env.keyCustody, k.dir);
  } finally {
    await h.close();
  }
  for (const judgeOnly of [false, true]) {
    await assertRejects(
      () => openHarnessEnv(options(judgeOnly), envDeps(coordRoot, unprotected)),
      ConfigurationError,
      `key custody ${k.dir} refused: `,
    );
  }
  // A judge never creates the dir; a publisher does.
  const missing = join(k.parent, "new");
  await assertRejects(
    () =>
      openHarnessEnv(
        { ...options(true), keyCustody: missing },
        envDeps(coordRoot, factsRunner()),
      ),
    ConfigurationError,
    "does not exist",
  );
  assert(!await exists(missing));
  // After admission: the same fault only skips the export.
  t.env.keyCustody = k.dir;
  t.env.probeRunner = factsRunner();
  await judgedRun(t);
  assertEquals(entries(k.dir).length, 1, "control exported");
  t.env.probeRunner = unprotected;
  using w = warnings();
  const { e } = await judgedRun(t);
  assert(
    w.lines.some((l) =>
      l.includes(`[WARN] ${e.id}: key custody ${k.dir} refused (`)
    ),
    w.lines.join("\n"),
  );
  assertEquals(entries(k.dir).length, 1, "nothing more in K");
});

// ---- 15: a large store ----

Deno.test("H-44 (15): a custody dir of 30,000 unrelated entries and a reparse point: admission, export and import succeed; the runner only ever gets the dir, its parent and one bundle", async () => {
  await using t = await custodyEnv({ bc: leakingBc() });
  const calls: string[][] = [];
  const runner = factsRunner(undefined, calls);
  t.env.probeRunner = runner;
  for (let i = 0; i < 30_000; i++) {
    Deno.writeFileSync(
      join(t.custody, `unrelated-${i}.json`),
      new Uint8Array(),
    );
  }
  const target = await Deno.makeTempDir({ prefix: "cg-h44-target-" });
  try {
    await Deno.symlink(
      target,
      join(t.custody, "link"),
      isWindows ? { type: "junction" } : undefined,
    );
    assertEquals(await admitKeyCustody(t.env, t.custody, false), t.custody);
    const { cell, e } = await judgedRun(t);
    await using b = await judgeB(t, t.custody, { probeRunner: runner });
    await judgesRedacted(t, b, cell, e);
    const parent = dirname(t.custody);
    const bundle = join(t.custody, `${e.id}.json`);
    assertEquals(calls, [
      [t.custody, parent],
      [t.custody, parent],
      [t.custody, parent, bundle],
    ]);
  } finally {
    await Deno.remove(join(t.custody, "link")).catch(() => {});
    await Deno.remove(target, { recursive: true });
  }
});

// ---- 18: recovery exports to the intent's dir ----

Deno.test("H-44 (18): a recovery with the flag omitted, or changed, exports to the custody dir the intent names", async () => {
  for (const changed of [false, true]) {
    await using t = await custodyEnv();
    await using other = await custodyDir();
    const { intent } = await killedBeforeDraft(t);
    assertEquals(intent.key_custody, t.custody);
    if (changed) t.env.keyCustody = other.dir;
    else delete t.env.keyCustody;
    const [r] = await recoverInterrupted(t.env, loadTask);
    assertEquals(entries(t.custody), [`${r!.id}.json`], `changed ${changed}`);
    assertEquals(entries(other.dir), []);
    assertEquals(
      await Deno.readFile(join(t.custody, `${r!.id}.json`)),
      await Deno.readFile(privatePaths(t.env, r!.id).bundle),
    );
  }
});
