/**
 * H-44 group 1 (design-final sections 3-6): the v3 execution record's
 * redaction_anchor, the private root's own redaction bundle, write-once
 * linking, acquisition-scoped temp reclamation, the own-root key loader and
 * the D4 legacy-campaign refusal. Numbers in test names are the design's
 * section 7 test numbers.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { walk } from "@std/fs";
import { join } from "@std/path";
import { ConfigurationError, ValidationError } from "../../../src/errors.ts";
import type { CellRef, HarnessEnv } from "../../../src/harness/execution.ts";
import type { ExecutionRecord } from "../../../src/harness/records.ts";
import {
  judgmentOwed,
  linkTemp,
  privatePaths,
  publishJudgment,
  reclaimTemps,
  recoverInterrupted,
  rejudgeExecution,
  runCell,
  scrubForcedReason,
} from "../../../src/harness/execution.ts";
import {
  loadCampaignData,
  runCampaign,
  type RunOptions,
} from "../../../src/harness/campaign.ts";
import { validateCampaignRecords } from "../../../src/harness/integrity.ts";
import { buildReport } from "../../../src/harness/report.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { custodyEnv, fsSpy } from "./custody-fixture.ts";
import { FakeBc, result } from "./fake-bc.ts";
import { write } from "./refapp-fixture.ts";
import {
  CATALOG,
  cellFor,
  makeEnv,
  mockImageBehavior,
  SECRET_OAUTH,
  type TestEnv,
} from "./runtime-fixture.ts";

const exists = (p: string) => Deno.stat(p).then(() => true, () => false);

const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

const R1_PREFIX =
  "are missing or invalid; refusing to judge (nothing could be redacted)";
const R1_TAIL =
  "Judging in another process: pass --key-custody <dir> to both the publishing and the judging process";
const R6 = "does not match the record's redaction_anchor";
const STUB = "is a stub-provider run (scripted model): never judged";

/** Every file under a root, as latin1 text, for secret scans. */
async function allBytes(root: string): Promise<string> {
  let out = "";
  for await (const e of walk(root, { includeDirs: false })) {
    out += new TextDecoder("latin1").decode(
      await Deno.readFile(e.path).catch(() => new Uint8Array()),
    );
  }
  return out;
}

/** Lane judgings started (each compute takes the lane once per scorer run). */
function countJudgings(t: TestEnv) {
  const lane = t.env.lane;
  const real = lane.exclusive.bind(lane);
  const n = { calls: 0 };
  lane.exclusive = ((...a: Parameters<typeof lane.exclusive>) => {
    n.calls++;
    return real(...a);
  }) as typeof lane.exclusive;
  return n;
}

/** A verdict container whose oracle failure message carries the attempt's secrets. */
function leakingBc(secrets: () => string[]): FakeBc {
  return new FakeBc((cu) => {
    if (cu === 80010) return result({ ShippedPasses: true });
    if (cu === 85000) {
      return result({
        FixWorks: `Assert.AreEqual failed. Expected:<${secrets().join("|")}>`,
      });
    }
    return result({});
  });
}

/** An env whose judge output leaks the oauth secret and the backend token. */
async function leakEnv() {
  let token = "";
  const t = await makeEnv({ bc: leakingBc(() => [SECRET_OAUTH, token]) });
  const inner = t.docker.behavior;
  t.docker.behavior = async (call, io) => {
    token = (await Deno.readTextFile(
      join(call.mounts.get("C:\\cg-secrets")!.src, "backend-token"),
    )).trim();
    return await inner(call, io);
  };
  return { t, token: () => token };
}

async function assertRedacted(t: TestEnv, token: string) {
  const published = await allBytes(t.env.resultsRoot);
  assert(token.length === 64);
  assert(!published.includes(SECRET_OAUTH), "oauth in a published file");
  assert(!published.includes(token), "backend token in a published file");
  for (const l of Deno.readDirSync(join(t.env.resultsRoot, "verdicts"))) {
    const text = await Deno.readTextFile(
      join(t.env.resultsRoot, "verdicts", l.name),
    );
    assertStringIncludes(text, "[REDACTED:claude-oauth-token]");
    assertStringIncludes(text, "[REDACTED:backend-token]");
  }
}

/** A judged live run (the successful control every negative starts from). */
async function judgedRun(t: TestEnv) {
  const cell = await cellFor(t);
  const e = (await runCell(t.env, cell)).executions[0]!;
  assertEquals((await t.env.store.judgments(e.id)).length, 1, "control judged");
  return { cell, e, p: privatePaths(t.env, e.id) };
}

const verdictCount = (t: TestEnv) =>
  [...Deno.readDirSync(join(t.env.resultsRoot, "verdicts"))].length;

/** A rejudge refused with `text`: no lane call, no judgment, no verdict log. */
async function refusesJudging(
  t: TestEnv,
  cell: CellRef,
  e: ExecutionRecord,
  text: string,
  not?: string,
) {
  const before = (await t.env.store.judgments(e.id)).length;
  const logs = verdictCount(t);
  const n = countJudgings(t);
  const err = await assertRejects(() =>
    rejudgeExecution(t.env, cell, e, cell.oracleHash)
  );
  assertStringIncludes((err as Error).message, text);
  if (not) {
    assert(!(err as Error).message.includes(not), (err as Error).message);
  }
  assertEquals(n.calls, 0, "no lane call");
  assertEquals((await t.env.store.judgments(e.id)).length, before);
  assertEquals(verdictCount(t), logs, "no verdict log");
  return (err as Error).message;
}

const intents = (t: TestEnv) => {
  try {
    return [...Deno.readDirSync(join(t.env.privateRoot, "intents"))]
      .map((x) => x.name).filter((n) => !n.includes(".tmp-"));
  } catch {
    return [];
  }
};

const intentPath = (t: TestEnv) =>
  join(t.env.privateRoot, "intents", intents(t)[0]!);

// ---- 20 and 4: the v3 record and its own bundle ----

Deno.test("H-44 (20): a live run writes a v3 record whose redaction_anchor is the sha256 of the own bundle's exact bytes (id, null stub, the key file's keys); the judgment version stays the scorer suite's; no bundle byte reaches results/", async () => {
  const { t, token } = await leakEnv();
  await using _t = t;
  const { e, p } = await judgedRun(t);
  assertEquals(e.v, 3);
  const bytes = await Deno.readFile(p.bundle);
  assertEquals(e.redaction_anchor, await sha256(bytes));
  const keys = JSON.parse(await Deno.readTextFile(p.keys));
  assertEquals(
    new TextDecoder().decode(bytes),
    JSON.stringify({ v: 1, execution_id: e.id, stub: null, keys }),
  );
  assert(keys.length > 0);
  const [j] = await t.env.store.judgments(e.id);
  assertEquals(j!.v, 2, "the h38 suite's judgment version");
  await assertRedacted(t, token());
  const published = await allBytes(t.env.resultsRoot);
  for (const k of keys) {
    assert(!published.includes(k.salt), "a salt under results/");
    assert(!published.includes(k.sha256), "a key hash under results/");
  }
});

// ---- 5 and 6: hash and parser cases, own root ----

Deno.test("H-44 (5): another execution's authentic bundle, an edited anchor and an edited bundle each refuse R6", async () => {
  await using t = await makeEnv();
  const { cell, e, p } = await judgedRun(t);
  const other = (await runCell(t.env, cell)).executions[0]!;
  const original = await Deno.readFile(p.bundle);
  await Deno.writeFile(
    p.bundle,
    await Deno.readFile(privatePaths(t.env, other.id).bundle),
  );
  await refusesJudging(t, cell, e, R6);
  await Deno.writeFile(p.bundle, original);
  await refusesJudging(t, cell, { ...e, redaction_anchor: "0".repeat(64) }, R6);
  const edited = new TextDecoder().decode(original).replace(
    /"salt":"([0-9a-f])/,
    (_m, c) => `"salt":"${c === "0" ? "1" : "0"}`,
  );
  assert(edited !== new TextDecoder().decode(original));
  await Deno.writeTextFile(p.bundle, edited);
  await refusesJudging(t, cell, e, R6);
  // Restored: judging works again (the refusals were the bundle's).
  await Deno.writeFile(p.bundle, original);
  await publishJudgment(
    t.env,
    e,
    cell.oracleHash,
    await rejudgeExecution(t.env, cell, e, cell.oracleHash),
  );
  assertEquals((await t.env.store.judgments(e.id)).length, 2);
});

Deno.test("H-44 (6): malformed own bundles whose anchor matches refuse with their own reason, never R6; an unreadable or mismatched own bundle refuses; none falls back to an authorized, working <K> (zero accesses there)", async () => {
  await using t = await custodyEnv();
  const { cell, e, p } = await judgedRun(t);
  // H-44 (M3) control: with the own bundle gone, the authorized <K> judges.
  const own = await Deno.readFile(p.bundle);
  await Deno.remove(p.bundle);
  const viaK = countJudgings(t);
  await rejudgeExecution(t.env, cell, e, cell.oracleHash);
  assert(viaK.calls > 0, "control: judged through <K>");
  await Deno.writeFile(p.bundle, own);
  using spy = fsSpy(t.custody);
  const good = JSON.parse(await Deno.readTextFile(p.bundle));
  // A mismatched own bundle (the anchor is the authentic K copy's): R6 on the own path.
  await Deno.writeTextFile(
    p.bundle,
    JSON.stringify({
      ...good,
      keys: good.keys.map((k: { name: string }, i: number) =>
        i === 0 ? { ...k, name: "renamed" } : k
      ),
    }),
  );
  await refusesJudging(
    t,
    cell,
    e,
    `redaction bundle ${p.bundle} for execution ${e.id} ${R6}`,
  );
  const cases: [string, string, string][] = [
    ["malformed JSON", '{"v":1,"execution_id":', "not JSON"],
    [
      "wrong id",
      JSON.stringify({ ...good, execution_id: crypto.randomUUID() }),
      "names execution",
    ],
    ["v 2", JSON.stringify({ ...good, v: 2 }), "bundle version 2"],
    ["empty keys", JSON.stringify({ ...good, keys: [] }), "no keys"],
    ["extra property", JSON.stringify({ ...good, extra: 1 }), "extra"],
    [
      "missing stub",
      JSON.stringify({ v: 1, execution_id: e.id, keys: good.keys }),
      "stub",
    ],
    [
      "malformed stub",
      JSON.stringify({ ...good, stub: { scenario_sha256: 5 } }),
      "stub",
    ],
  ];
  for (const [name, text, why] of cases) {
    const bytes = new TextEncoder().encode(text);
    await Deno.writeFile(p.bundle, bytes);
    const m = await refusesJudging(
      t,
      cell,
      { ...e, redaction_anchor: await sha256(bytes) },
      `redaction bundle ${p.bundle} for execution ${e.id} is invalid (`,
      R6,
    );
    assertStringIncludes(m, why, name);
  }
  // A directory where the bundle file should be: unreadable, no fallback to the key file.
  await Deno.remove(p.bundle);
  await Deno.mkdir(p.bundle);
  await refusesJudging(t, cell, e, "cannot be read or are malformed", R6);
  assertEquals(spy.hits, [], "zero accesses under <K>");
  assertEquals(t.env.keyCustody, t.custody, "authorized throughout");
});

// ---- 7: sticky stub vetoes (a, b; c with the own bundle) ----

Deno.test("H-44 (7): each stub veto alone refuses an eligible execution with zero lane calls: (a) the own marker, (b) a public stub_provider, (c, own root) an authentic stub bundle", async () => {
  await using t = await makeEnv();
  const { cell, e, p } = await judgedRun(t);
  // (a) the private marker only.
  await Deno.writeTextFile(
    p.stubMarker,
    JSON.stringify({ scenario_sha256: "a".repeat(64), image_override: null }),
  );
  await refusesJudging(t, cell, e, STUB);
  await Deno.remove(p.stubMarker);
  // (b) the public side file only.
  const side = join(t.env.resultsRoot, "runs", e.id, "sandbox.json");
  const original = await Deno.readTextFile(side);
  await Deno.writeTextFile(
    side,
    JSON.stringify({
      ...JSON.parse(original),
      stub_provider: { scenario_sha256: "a".repeat(64) },
    }),
  );
  await refusesJudging(t, cell, e, STUB);
  await Deno.writeTextFile(side, original);
  // (c) the bundle's stub only, with a matching anchor.
  const good = JSON.parse(await Deno.readTextFile(p.bundle));
  const bytes = new TextEncoder().encode(JSON.stringify({
    ...good,
    stub: { scenario_sha256: "a".repeat(64), image_override: null },
  }));
  await Deno.writeFile(p.bundle, bytes);
  const stubbed = { ...e, redaction_anchor: await sha256(bytes) };
  assert(!await exists(p.stubMarker));
  await refusesJudging(t, cell, stubbed, STUB);
  assertEquals(
    await judgmentOwed(t.env, stubbed),
    false,
    "a stub bundle is never owed",
  );
});

Deno.test("H-44 (7): an owed execution whose own bundle attests a stub is not owed; an invalid bundle stays owed", async () => {
  await using t = await makeEnv();
  let later: ExecutionRecord | null = null;
  t.env.judgeLater = (_c, e) => void (later = e);
  await runCell(t.env, await cellFor(t));
  delete t.env.judgeLater;
  const e = later as ExecutionRecord | null;
  if (!e) throw new Error("the cell's judging was not deferred");
  assertEquals(await judgmentOwed(t.env, e), true, "control: owed");
  const p = privatePaths(t.env, e.id);
  const good = JSON.parse(await Deno.readTextFile(p.bundle));
  const bytes = new TextEncoder().encode(JSON.stringify({
    ...good,
    stub: { scenario_sha256: "a".repeat(64), image_override: null },
  }));
  await Deno.writeFile(p.bundle, bytes);
  assertEquals(
    await judgmentOwed(t.env, { ...e, redaction_anchor: await sha256(bytes) }),
    false,
    "an authentic stub bundle",
  );
  assertEquals(
    await judgmentOwed(t.env, e),
    true,
    "a mismatched bundle stays owed",
  );
});

// ---- 9: downgrade and R7 ----

Deno.test("H-44 (9): a v3 record rewritten to v2 refuses as downgraded (its own bundle exists); a null anchor refuses R7", async () => {
  await using t = await makeEnv();
  const { cell, e } = await judgedRun(t);
  const { redaction_anchor: _a, ...rest } = e;
  await refusesJudging(t, cell, { ...rest, v: 2 }, "a downgraded record");
  await refusesJudging(
    t,
    cell,
    { ...e, redaction_anchor: null },
    "with a null redaction_anchor (no secret was released): never judged",
  );
});

// ---- 21: own-root parts ----

Deno.test("H-44 (21): scrubForcedReason redacts with the record's own bundle and refuses R1 (H-41 prefix, new tail) without it; a malformed or unreadable legacy key file refuses with no fallback, also to an authorized, working <K>", async () => {
  await using t = await custodyEnv();
  const { cell, e, p } = await judgedRun(t);
  // Published with --key-custody (<K> holds the bundle); the R1 cases run without the flag.
  delete t.env.keyCustody;
  assertEquals(
    await scrubForcedReason(t.env, e, `infra: ${SECRET_OAUTH} leaked`),
    "infra: [REDACTED:claude-oauth-token] leaked",
  );
  const bundle = await Deno.readFile(p.bundle);
  await Deno.remove(p.bundle);
  const err = await assertRejects(
    () => scrubForcedReason(t.env, e, "infra"),
    ValidationError,
  );
  assertStringIncludes(
    err.message,
    `redaction keys ${p.bundle} for execution ${e.id} ${R1_PREFIX}. ${R1_TAIL}`,
  );
  await refusesJudging(t, cell, e, `${R1_PREFIX}. ${R1_TAIL}`);
  // H-44 (M3) control: authorized, the same root judges e through <K>.
  t.env.keyCustody = t.custody;
  const viaK = countJudgings(t);
  await rejudgeExecution(t.env, cell, e, cell.oracleHash);
  assert(viaK.calls > 0, "control: judged through <K>");
  using spy = fsSpy(t.custody);
  // A legacy (v2) record of this root: its key file is the source; malformed refuses.
  const { redaction_anchor: _a, ...rest } = e;
  const legacy: ExecutionRecord = { ...rest, v: 2 };
  assertEquals(
    await scrubForcedReason(t.env, legacy, SECRET_OAUTH),
    "[REDACTED:claude-oauth-token]",
    "a genuine v2 record redacts from its key file",
  );
  await Deno.writeTextFile(p.keys, '[{"name":');
  await refusesJudging(t, cell, legacy, "cannot be read or are malformed");
  await assertRejects(
    () => scrubForcedReason(t.env, legacy, "infra"),
    ValidationError,
    "cannot be read or are malformed",
  );
  // Unreadable (a directory where the key file should be).
  await Deno.remove(p.keys);
  await Deno.mkdir(p.keys);
  await refusesJudging(t, cell, legacy, "cannot be read or are malformed");
  await Deno.remove(p.keys);
  await Deno.writeTextFile(p.keys, "[]");
  await refusesJudging(t, cell, legacy, "are an empty set");
  assertEquals(spy.hits, [], "a legacy record never touches <K>");
  // The R1 message below is the unauthorized one.
  delete t.env.keyCustody;
  await Deno.remove(p.keys);
  await refusesJudging(
    t,
    cell,
    legacy,
    `redaction keys ${p.keys} for execution ${e.id} ${R1_PREFIX}. ${R1_TAIL}`,
  );
  // The own bundle back: no fallback from a legacy record to it either.
  await Deno.writeFile(p.bundle, bundle);
  await refusesJudging(t, cell, legacy, "a downgraded record");
});

// ---- 10: write-once of the own bundle ----

Deno.test("H-44 (10): linkTemp: concurrent identical writers both succeed with one file; conflicting writers: one wins, the other refuses; no temp is left", async () => {
  await using t = await makeEnv();
  const dir = join(t.env.privateRoot, "redaction");
  const id = crypto.randomUUID();
  const a = new TextEncoder().encode('{"a":1}');
  const b = new TextEncoder().encode('{"b":2}');
  const same = join(dir, `${id}.same.json`);
  await Promise.all([
    linkTemp(t.env, same, a, id),
    linkTemp(t.env, same, a, id),
  ]);
  assertEquals(await Deno.readFile(same), a);
  const clash = join(dir, `${id}.clash.json`);
  const r = await Promise.allSettled([
    linkTemp(t.env, clash, a, id),
    linkTemp(t.env, clash, b, id),
  ]);
  const won = r.findIndex((x) => x.status === "fulfilled");
  const lost = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
  assert(won >= 0 && lost, JSON.stringify(r.map((x) => x.status)));
  assertStringIncludes(lost.reason.message, "already exists with other bytes");
  assertEquals(await Deno.readFile(clash), won === 0 ? a : b);
  assertEquals(
    [...Deno.readDirSync(dir)].map((x) => x.name).filter((n) =>
      n.includes(".tmp-")
    ),
    [],
  );
});

Deno.test("H-44 (10): a crash right after the bundle link: recovery meets the existing bundle and reuses its bytes (the original salts); one anchor-matching bundle", async () => {
  await using t = await makeEnv();
  const cell = await cellFor(t);
  t.env.hooks = {
    after: (s) =>
      s === "bundle"
        ? Promise.reject(new Error("runner killed"))
        : Promise.resolve(),
  };
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  t.env.hooks = {};
  const id = intents(t)[0]!.replace(".json", "");
  const p = privatePaths(t.env, id);
  const linked = await Deno.readFile(p.bundle);
  const keys = await Deno.readTextFile(p.keys);
  const [e] = await recoverInterrupted(t.env, loadTask);
  assertEquals(e!.id, id);
  assertEquals(
    await Deno.readFile(p.bundle),
    linked,
    "the bundle bytes unchanged",
  );
  assertEquals(await Deno.readTextFile(p.keys), keys, "the salts unchanged");
  assertEquals(e!.redaction_anchor, await sha256(linked));
  assertEquals((await t.env.store.judgments(id)).length, 1);
});

Deno.test("H-44 (10): an existing own bundle that differs from the key file refuses the rebuild; nothing published, the intent kept", async () => {
  await using t = await makeEnv();
  const cell = await cellFor(t);
  t.env.hooks = {
    after: (s) =>
      s === "bundle"
        ? Promise.reject(new Error("runner killed"))
        : Promise.resolve(),
  };
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  t.env.hooks = {};
  const id = intents(t)[0]!.replace(".json", "");
  const p = privatePaths(t.env, id);
  const b = JSON.parse(await Deno.readTextFile(p.bundle));
  b.keys[0].salt = b.keys[0].salt.replace(
    /^./,
    (c: string) => c === "0" ? "1" : "0",
  );
  await Deno.writeTextFile(p.bundle, JSON.stringify(b));
  await assertRejects(
    () => recoverInterrupted(t.env, loadTask),
    ConfigurationError,
    "does not match its key file",
  );
  assertEquals(await t.env.store.executions(cell.campaignId), []);
  assertEquals(intents(t), [`${id}.json`]);
});

// ---- 16: temps and acquisitions ----

Deno.test("H-44 (16): every restricted temp is named <final>.tmp-<acquisition>-<uuid>", async () => {
  await using t = await makeEnv();
  const seen: string[] = [];
  t.env.hooks = {
    beforeLink: (what) => {
      if (what === "bundle") {
        for (const d of ["custody", "redaction"]) {
          for (const x of Deno.readDirSync(join(t.env.privateRoot, d))) {
            if (x.name.includes(".tmp-")) seen.push(x.name);
          }
        }
      }
      return Promise.resolve();
    },
  };
  await runCell(t.env, await cellFor(t));
  assert(seen.length > 0);
  for (const n of seen) {
    assert(
      new RegExp(
        `\\.json\\.tmp-${t.env.acquisition}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
      ).test(n),
      n,
    );
  }
});

/** A temp a writer of acquisition `acq` (null: a pre-H-44 binary) left beside `final`. */
function plantTemp(dir: string, final: string, acq: string | null) {
  const name = `${final}.tmp-${acq ? `${acq}-` : ""}${crypto.randomUUID()}`;
  Deno.writeTextFileSync(join(dir, name), "x");
  return name;
}

const names = (dir: string) =>
  [...Deno.readDirSync(dir)].map((x) => x.name).sort();

Deno.test("H-44 (16): reclaimTemps removes only predecessors' temps (another acquisition's or a token-less pre-H-44 one, of any id), never this acquisition's", async () => {
  await using t = await makeEnv();
  const dir = join(t.env.privateRoot, "redaction");
  await Deno.mkdir(dir, { recursive: true });
  const [x, y] = [crypto.randomUUID(), crypto.randomUUID()];
  const mine = plantTemp(dir, `${x}.bundle.json`, t.env.acquisition);
  const other = plantTemp(dir, `${y}.bundle.json`, crypto.randomUUID());
  const old = plantTemp(dir, `${y}.json`, null);
  const keep = `${x}.json`;
  Deno.writeTextFileSync(join(dir, keep), "[]");
  await reclaimTemps(t.env, dir);
  assertEquals(names(dir), [keep, mine].sort());
  assert(!names(dir).includes(other) && !names(dir).includes(old));
  // A prefix limits the candidates to one id.
  const otherX = plantTemp(dir, `${x}.json`, crypto.randomUUID());
  const otherY = plantTemp(dir, `${y}.json`, crypto.randomUUID());
  await reclaimTemps(t.env, dir, `${x}.`);
  assertEquals(names(dir), [keep, mine, otherY].sort());
  assert(!names(dir).includes(otherX));
});

Deno.test("H-44 (16) M1: a reclaimer paused after enumerating, whose lock is taken over, deletes nothing; the successor's temp created meanwhile survives and links", async () => {
  await using t = await makeEnv();
  const dir = join(t.env.privateRoot, "redaction");
  await Deno.mkdir(dir, { recursive: true });
  const id = crypto.randomUUID();
  const planted = [
    plantTemp(dir, `${id}.bundle.json`, null),
    plantTemp(dir, `${id}.json`, crypto.randomUUID()),
  ];
  let lost = false;
  const b: HarnessEnv = {
    ...t.env,
    acquisition: crypto.randomUUID(),
    namespaceLost: () => false,
    hooks: {},
  };
  const final = join(dir, `${id}.late.json`);
  let linking: Promise<void> | null = null;
  let release = () => {};
  const gate = new Promise<void>((r) => release = r);
  const a: HarnessEnv = {
    ...t.env,
    namespaceLost: () => lost,
    hooks: {
      reclaim: (step, list) => {
        if (step !== "listed") return Promise.resolve();
        assertEquals(
          [...list].sort(),
          [...planted].sort(),
          "a non-empty candidate list",
        );
        // B takes over and starts a write, paused before its link.
        lost = true;
        b.hooks = { beforeLink: () => gate };
        linking = linkTemp(b, final, new TextEncoder().encode("{}"), id);
        return new Promise((r) => setTimeout(r, 50));
      },
    },
  };
  await assertRejects(
    () => reclaimTemps(a, dir),
    ConfigurationError,
    "was taken over",
  );
  for (const n of planted) assert(names(dir).includes(n), `${n} deleted`);
  const bTemp = names(dir).filter((n) => n.includes(`.tmp-${b.acquisition}-`));
  assertEquals(bTemp.length, 1, "B's temp exists while A ran");
  release();
  await linking;
  assertEquals(await Deno.readTextFile(final), "{}", "B's link succeeded");
});

Deno.test("H-44 (16) M1 variant: a reclaimer of two candidates losing its lock after the first's passing check deletes only that one and refuses before the second; a temp the successor created later survives (no re-enumeration)", async () => {
  await using t = await makeEnv();
  const dir = join(t.env.privateRoot, "redaction");
  await Deno.mkdir(dir, { recursive: true });
  const id = crypto.randomUUID();
  const planted = [
    plantTemp(dir, `${id}.json`, null),
    plantTemp(dir, `${id}.bundle.json`, crypto.randomUUID()),
  ];
  let lost = false;
  const succ = crypto.randomUUID();
  let late = "";
  const checked: string[] = [];
  const a: HarnessEnv = {
    ...t.env,
    namespaceLost: () => lost,
    hooks: {
      reclaim: (step, list) => {
        if (step === "listed") {
          assertEquals([...list].sort(), [...planted].sort(), "two candidates");
        }
        if (step === "checked") {
          checked.push(...list);
          // The first passed its check; the lock is taken over before the second's.
          lost = true;
          late = plantTemp(dir, `${id}.late.json`, succ);
        }
        return Promise.resolve();
      },
    },
  };
  await assertRejects(
    () => reclaimTemps(a, dir),
    ConfigurationError,
    "was taken over",
  );
  assertEquals(checked.length, 1, "only the first candidate passed a check");
  const [first] = checked;
  const second = planted.find((n) => n !== first)!;
  assert(!names(dir).includes(first!), "the checked candidate is removed");
  assert(names(dir).includes(second), "the second candidate is kept");
  assert(
    late !== "" && names(dir).includes(late),
    "the successor's later temp survives",
  );
});

Deno.test("H-44 (16): a writer paused before its bundle link whose lock was taken over throws lock-lost and publishes nothing; the successor's recovery publishes one anchor-matching bundle", async () => {
  await using t = await makeEnv();
  const cell = await cellFor(t);
  let lost = false;
  const b: HarnessEnv = {
    ...t.env,
    acquisition: crypto.randomUUID(),
    namespaceLost: () => false,
    hooks: {},
  };
  let recovered: ExecutionRecord[] = [];
  t.env.namespaceLost = () => lost;
  t.env.hooks = {
    beforeLink: async (what) => {
      if (what !== "bundle") return;
      lost = true;
      recovered = await recoverInterrupted(b, loadTask);
    },
  };
  const err = await assertRejects(
    () => runCell(t.env, cell),
    ConfigurationError,
  );
  assertStringIncludes(
    err.message,
    `lock on private root ${t.env.privateRoot} was taken over: `,
  );
  assertStringIncludes(err.message, "not published");
  assertEquals(recovered.length, 1, "B recovered and published the execution");
  const [e] = await t.env.store.executions(cell.campaignId);
  assertEquals(e!.id, recovered[0]!.id);
  const p = privatePaths(t.env, e!.id);
  assertEquals(
    e!.redaction_anchor,
    await sha256(await Deno.readFile(p.bundle)),
  );
  assertEquals(
    names(join(t.env.privateRoot, "redaction")).filter((n) =>
      n.startsWith(`${e!.id}.bundle.json`)
    ),
    [`${e!.id}.bundle.json`],
    "one bundle, no temp",
  );
  assert(!await exists(join(p.pending, "draft.json")), "A wrote no draft");
});

// ---- 17: no-key cases ----

Deno.test("H-44 (17): a setup failure before any release and a recovered prepared attempt record a null anchor and write no bundle; neither is judged", async () => {
  await using t = await makeEnv();
  const cell = await cellFor(t);
  await Deno.remove(join(t.env.secretAccounts[0]!.dir, "claude-oauth-token"));
  const e = (await runCell(t.env, cell)).executions[0]!;
  assertEquals([e.termination, e.v, e.redaction_anchor], [
    "setup_failed",
    3,
    null,
  ]);
  assert(!await exists(privatePaths(t.env, e.id).bundle));
  await using t2 = await makeEnv();
  t2.env.hooks = { prepared: () => Promise.reject(new Error("runner killed")) };
  await assertRejects(
    async () => runCell(t2.env, await cellFor(t2)),
    Error,
    "runner killed",
  );
  t2.env.hooks = {};
  const [r] = await recoverInterrupted(t2.env, loadTask);
  assertEquals([r!.v, r!.redaction_anchor], [3, null]);
  assert(!await exists(privatePaths(t2.env, r!.id).bundle));
  assertEquals(await t2.env.store.judgments(r!.id), []);
});

Deno.test("H-44 (17): secrets released but the key file missing at the draft: the build throws, nothing is published and the intent is kept", async () => {
  await using t = await makeEnv();
  const cell = await cellFor(t);
  const inner = t.docker.behavior;
  t.docker.behavior = async (call, io) => {
    const id = intents(t)[0]!.replace(".json", "");
    await Deno.remove(privatePaths(t.env, id).keys);
    return await inner(call, io);
  };
  await assertRejects(
    () => runCell(t.env, cell),
    ConfigurationError,
    "secrets were released but its redaction keys",
  );
  assertEquals(await t.env.store.executions(cell.campaignId), []);
  assertEquals(intents(t).length, 1, "intent kept");
});

// ---- 18: recovery and record_v ----

Deno.test("H-44 (18): a released pre-H-44 intent (no record_v) with no draft recovers to v2: keys derived, no bundle, judged and redacted from the key file", async () => {
  const { t, token } = await leakEnv();
  await using _t = t;
  const cell = await cellFor(t);
  t.env.hooks = {
    beforeDraft: () => Promise.reject(new Error("runner killed")),
  };
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  t.env.hooks = {};
  const i = JSON.parse(await Deno.readTextFile(intentPath(t)));
  assertEquals(i.record_v, 3, "a new intent carries record_v 3");
  delete i.record_v;
  await Deno.writeTextFile(intentPath(t), JSON.stringify(i));
  // Pre-H-44 recovery derives a missing key file from custody.
  await Deno.remove(privatePaths(t.env, i.execution_id).keys);
  const [e] = await recoverInterrupted(t.env, loadTask);
  assertEquals(e!.v, 2);
  assert(!("redaction_anchor" in e!));
  const p = privatePaths(t.env, e!.id);
  assert(await exists(p.keys), "keys derived");
  assert(!await exists(p.bundle), "no bundle");
  const [j] = await t.env.store.judgments(e!.id);
  assert(j, "judged");
  await assertRedacted(t, token());
  assertEquals(intents(t), []);
});

Deno.test("H-44 (18): a saved v2 draft publishes as v2", async () => {
  await using t = await makeEnv();
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
  const draftPath = join(privatePaths(t.env, id).pending, "draft.json");
  const d = JSON.parse(await Deno.readTextFile(draftPath));
  assertEquals(d.execution.v, 3);
  d.execution.v = 2;
  delete d.execution.redaction_anchor;
  await Deno.writeTextFile(draftPath, JSON.stringify(d));
  await Deno.remove(privatePaths(t.env, id).bundle);
  const [e] = await recoverInterrupted(t.env, loadTask);
  assertEquals([e!.id, e!.v], [id, 2]);
  assertEquals((await t.env.store.executions(cell.campaignId))[0]!.v, 2);
});

Deno.test('H-44 (18): an intent with record_v 4 or "3" refuses recovery; nothing published, the intent kept', async () => {
  for (const bad of [4, "3"]) {
    await using t = await makeEnv();
    const cell = await cellFor(t);
    t.env.hooks = {
      beforeDraft: () => Promise.reject(new Error("runner killed")),
    };
    await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
    t.env.hooks = {};
    const path = intentPath(t);
    const i = JSON.parse(await Deno.readTextFile(path));
    await Deno.writeTextFile(path, JSON.stringify({ ...i, record_v: bad }));
    await assertRejects(
      () => recoverInterrupted(t.env, loadTask),
      ConfigurationError,
      `intent ${i.execution_id} has unsupported record_v ${
        JSON.stringify(bad)
      }; kept`,
    );
    assertEquals(await t.env.store.executions(cell.campaignId), []);
    assertEquals(intents(t), [`${i.execution_id}.json`]);
  }
});

// ---- 19: D4, legacy campaigns ----

async function experiment(t: TestEnv, id: string) {
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

const opts = (over: Partial<RunOptions> = {}): RunOptions => ({
  dryRun: false,
  concurrency: 1,
  seed: 7,
  maxPauseMs: 0,
  ...over,
});

const io = () => ({
  log: () => {},
  sleep: () => Promise.resolve(),
  catalog: CATALOG,
});

Deno.test("H-44 (19, D4): a campaign with an execution recorded before H-44 refuses a run and a --rerun before binding, any intent or any sandbox; its legacy execution still rejudges for real (redacted); report and integrity pass; a fresh campaign runs v3", async () => {
  let token = "";
  const t = await makeEnv({ bc: leakingBc(() => [token]) });
  await using _t = t;
  t.env.supervised = false;
  const mock = mockImageBehavior();
  t.docker.behavior = async (call, io) => {
    token = (await Deno.readTextFile(
      join(call.mounts.get("C:\\cg-secrets")!.src, "backend-token"),
    )).trim();
    return await mock(call, io);
  };
  await experiment(t, "legacy");
  // A pre-H-44 binary's attempt: killed before its draft, its intent without record_v.
  t.env.hooks = {
    beforeDraft: () => Promise.reject(new Error("runner killed")),
  };
  await assertRejects(
    () => runCampaign(t.env, "legacy", opts(), io()),
    Error,
    "runner killed",
  );
  t.env.hooks = {};
  const i = JSON.parse(await Deno.readTextFile(intentPath(t)));
  delete i.record_v;
  await Deno.writeTextFile(intentPath(t), JSON.stringify(i));
  let binds = 0;
  t.env.bindCampaign = () => {
    binds++;
    return Promise.resolve();
  };
  const runs = t.docker.runs.length;
  const d4 = (c: string) =>
    `campaign ${c} has executions recorded before H-44; new executions cannot join it. Start a fresh campaign under a new experiment id or a new --results-dir; existing results stay as they are`;
  // The run recovers the legacy attempt (v2), then refuses before binding.
  const [c] = await t.env.store.campaigns("legacy");
  await assertRejects(
    () => runCampaign(t.env, "legacy", opts(), io()),
    ConfigurationError,
    d4(c!.id),
  );
  const [legacy] = await t.env.store.executions(c!.id);
  assertEquals(legacy!.v, 2, "recovered as v2");
  await assertRejects(
    () =>
      runCampaign(
        t.env,
        "legacy",
        opts({ rerun: { task: "HX-001", repeat: 1, arm: legacy!.arm } }),
        io(),
      ),
    ConfigurationError,
    d4(c!.id),
  );
  assertEquals([binds, t.docker.runs.length, intents(t)], [0, runs, []]);
  assertEquals((await t.env.store.executions(c!.id)).length, 1, "nothing new");
  // Rejudge of the legacy execution: real judgment work, redacted.
  const cell = await cellFor(t, legacy!.arm);
  const n = countJudgings(t);
  const before = (await t.env.store.judgments(legacy!.id)).length;
  const j = await publishJudgment(
    t.env,
    legacy!,
    cell.oracleHash,
    await rejudgeExecution(
      t.env,
      { ...cell, campaignId: c!.id },
      legacy!,
      cell.oracleHash,
    ),
  );
  assert(n.calls >= 1, "lane calls");
  assertEquals((await t.env.store.judgments(legacy!.id)).length, before + 1);
  const log = await Deno.readTextFile(
    join(t.env.resultsRoot, "verdicts", `${j.id}.json`),
  );
  assert(token.length === 64 && !log.includes(token), "verdict redacted");
  assertStringIncludes(log, "[REDACTED:backend-token]");
  const data = await loadCampaignData(t.env.store, c!);
  await validateCampaignRecords(data);
  await buildReport(data, { resamples: 50, seed: 1 });
  // A fresh campaign under a new experiment id runs and records v3.
  await experiment(t, "fresh");
  const s = await runCampaign(t.env, "fresh", opts(), io());
  assertEquals(s.ran, 2);
  const [f] = await t.env.store.campaigns("fresh");
  const fresh = await loadCampaignData(t.env.store, f!);
  assertEquals(fresh.executions.map((e) => e.v), [3, 3]);
  assert(fresh.executions.every((e) => typeof e.redaction_anchor === "string"));
  assert(fresh.judgments.every((x) => x.v === 2));
  await validateCampaignRecords(fresh);
});
