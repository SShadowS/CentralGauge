import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { walk } from "@std/fs";
import { join } from "@std/path";
import { ConfigurationError, ContainerError } from "../../../src/errors.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import { ExperimentSchema } from "../../../src/harness/config.ts";
import {
  type CellRef,
  privatePaths,
  type PublishStep,
  recoverInterrupted,
  rejudgeExecution,
  runCell,
} from "../../../src/harness/execution.ts";
import { taskSetIdentity } from "../../../src/harness/identity.ts";
import { validateCampaignRecords } from "../../../src/harness/integrity.ts";
import {
  type ArtifactRecord,
  type CampaignRecord,
  type ExecutionRecord,
  ExecutionRecordSchema,
  experimentHash,
  type JudgmentRecord,
  planBlocks,
  RecordStore,
} from "../../../src/harness/records.ts";
import { SECRETS_DIR_PREFIX } from "../../../src/harness/sandbox.ts";
import { loadTask } from "../../../src/harness/task.ts";
import {
  ccBehavior,
  cellFor,
  IMAGE_ID,
  INIT,
  makeEnv,
  PROBE_COST,
  probeLines,
  SECRET_OAUTH,
  type TestEnv,
} from "./runtime-fixture.ts";
import { write } from "./refapp-fixture.ts";
import { FakeBc, result } from "./fake-bc.ts";

const U16 = (s: string) =>
  String.fromCharCode(
    ...new Uint8Array(
      new Uint16Array([...s].map((c) => c.charCodeAt(0))).buffer,
    ),
  );

async function tokenOf(call: { mounts: Map<string, { src: string }> }) {
  return (await Deno.readTextFile(
    join(call.mounts.get("C:\\cg-secrets")!.src, "backend-token"),
  )).trim();
}

/** Every file under a root, as latin1 text (byte-faithful), for secret scans. */
async function allBytes(root: string): Promise<string> {
  let out = "";
  for await (const e of walk(root, { includeDirs: false })) {
    out += new TextDecoder("latin1").decode(
      await Deno.readFile(e.path).catch(() => new Uint8Array()),
    );
  }
  return out;
}
const leaks = (text: string, secret: string) =>
  text.includes(secret) || text.includes(U16(secret));
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);
const sideOf = async (t: TestEnv, id: string) =>
  JSON.parse(
    await Deno.readTextFile(
      join(t.env.resultsRoot, "runs", id, "sandbox.json"),
    ),
  );

Deno.test("runCell: Claude Code solves HX-001; TTL-priced cost; no secret in argv; private state cleaned up", async () => {
  const t = await makeEnv();
  let token = "";
  let workspaceMount = "";
  let secretsMount = "";
  const inner = t.docker.behavior;
  t.docker.behavior = async (call, io) => {
    token = await tokenOf(call);
    workspaceMount = call.mounts.get("C:\\workspace")!.src;
    secretsMount = call.mounts.get("C:\\cg-secrets")!.src;
    return await inner(call, io);
  };
  const r = await runCell(t.env, await cellFor(t));
  assertEquals([r.pause, r.withheld, r.executions.length], [null, null, 1]);
  const e = ExecutionRecordSchema.parse(r.executions[0]);
  assertEquals([e.termination, e.did_work, e.run_kind, e.attempt], [
    "completed",
    true,
    "planned",
    1,
  ]);
  assertAlmostEquals(e.telemetry.cost_usd!, PROBE_COST, 1e-12);
  assertEquals(e.validity, {
    incomplete_telemetry: [],
    incomplete_observed: ["loaded_components"],
    infra_exposed: false,
  });
  assert(
    workspaceMount.startsWith(t.env.privateRoot),
    "the mutable workspace is private, never under results/",
  );
  // M1-20 handoff: the secrets mount is custody under privateRoot.
  assert(
    secretsMount.startsWith(join(t.env.privateRoot, "secrets")) &&
      secretsMount.includes(`${SECRETS_DIR_PREFIX}HOST1.`),
    secretsMount,
  );
  assert(!await exists(secretsMount), "secrets mount deleted after the run");
  const args = t.docker.runs[0]!.args.join(" ");
  assert(
    token.length === 64 && !args.includes(token) &&
      !args.includes(SECRET_OAUTH),
  );
  assertEquals([t.docker.runs[0]!.image, t.docker.runs[0]!.isolation], [
    IMAGE_ID,
    "hyperv",
  ]);
  const res = await t.env.backend.handle(
    new Request("http://b/v1/symbols", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-cg-execution": e.id },
      body: "{}",
    }),
  );
  assertEquals(res.status, 401, "token revoked before freeze");
  assertEquals((await t.env.store.judgments(e.id))[0]!.verdict, "pass");
  assertEquals(
    (await t.env.store.artifact(e.id))!.workspace_hash,
    e.workspace_hash,
  );
  assert(
    (await Deno.readTextFile(join(t.env.resultsRoot, e.trace_path!)))
      .includes("tool_call"),
  );
  const p = privatePaths(t.env, e.id);
  for (const d of [p.work, p.quarantine, p.custody, p.pending, p.intent]) {
    assert(!await exists(d), d);
  }
});

Deno.test("runCell: a naive solution is judged a fail", async () => {
  const t = await makeEnv();
  t.docker.behavior = ccBehavior(join(t.repo.tasksDir, "HX-001"), "naive/a");
  const r = await runCell(t.env, await cellFor(t));
  assertEquals(
    (await t.env.store.judgments(r.executions[0]!.id))[0]!.verdict,
    "fail",
  );
});

Deno.test("credential gate: refused without supervision or enforcement; supervised runs reserve in the shared ledger first", async () => {
  const t = await makeEnv();
  t.env.supervised = false;
  await assertRejects(
    async () => runCell(t.env, await cellFor(t)),
    ConfigurationError,
    "egress",
  );
  t.env.supervised = true;
  t.env.credentialLedger = null;
  await assertRejects(
    async () => runCell(t.env, await cellFor(t)),
    ConfigurationError,
    "ledger",
  );
  t.env.credentialLedger = join(t.env.privateRoot, "shared.jsonl");
  await Deno.writeTextFile(
    t.env.credentialLedger,
    '{"lane":"M4-17"}\n'.repeat(5),
  );
  await assertRejects(
    async () => runCell(t.env, await cellFor(t)),
    ConfigurationError,
    "5 supervised",
  );
  assertEquals(t.docker.runs, [], "no docker call before the reservation");
  t.env.egressEnforced = true;
  assertEquals(
    (await runCell(t.env, await cellFor(t))).executions.length,
    1,
    "verified enforcement needs no reservation",
  );
});

Deno.test("an adapter that cannot enforce the budget is refused", async () => {
  const t = await makeEnv();
  const a = adapterFor("claude-code");
  a.enforcesBudget = false;
  try {
    await assertRejects(
      async () => runCell(t.env, await cellFor(t)),
      ConfigurationError,
      "budget",
    );
    assertEquals(t.docker.runs, []);
  } finally {
    a.enforcesBudget = true;
  }
});

Deno.test("retries follow ancestry: supervised withholds; usage-limit then setup-failure may retry once more, never twice", async () => {
  const crash = [JSON.stringify({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    modelUsage: {},
  })];
  const t = await makeEnv();
  const cell = await cellFor(t);
  t.docker.behavior = async (_c, io) => {
    for (const l of [INIT, ...crash]) await io.stdout(l);
    return 1;
  };
  const s = await runCell(t.env, cell);
  assertEquals(s.executions.map((e) => [e.termination, e.did_work]), [[
    "harness_crash",
    false,
  ]]);
  assertStringIncludes(s.withheld!, "supervised");
  t.env.supervised = false;
  t.env.egressEnforced = true;
  const u = await runCell(t.env, cell);
  assertEquals(u.executions.map((e) => [e.run_kind, e.attempt]), [[
    "planned",
    1,
  ], ["auto_retry", 2]]);
  assertEquals(u.executions[1]!.retry_of, u.executions[0]!.id);
  // A usage-limited planned attempt, then its retry fails setup twice: one more retry after the first, none after the second.
  const limited = {
    ...u.executions[0]!,
    id: crypto.randomUUID(),
    termination: "usage_limited" as const,
    did_work: false,
  };
  t.docker.images.delete(IMAGE_ID);
  const chain = await runCell(t.env, cell, {
    attempt: 2,
    runKind: "auto_retry",
    retryOf: limited.id,
  }, [limited]);
  assertEquals(chain.executions.map((e) => [e.termination, e.attempt]), [[
    "setup_failed",
    2,
  ], ["setup_failed", 3]]);
  assertEquals(chain.executions[1]!.retry_of, chain.executions[0]!.id);
  assertStringIncludes(chain.stopped!, "one retry was used");
});

Deno.test("runCell: timeout kills the sandbox; the workspace is judged; cost is unknown, never a lower bound", async () => {
  const t = await makeEnv();
  t.env.timeoutMsFor = () => 50;
  const lines = (await probeLines()).slice(0, 12);
  t.docker.behavior = async (call, io) => {
    await ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct", lines)(
      call,
      io,
    );
    await io.killed;
    return 137;
  };
  const e = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals([e.termination, e.telemetry.cost_usd], ["timeout", null]);
  assert(e.validity.incomplete_telemetry.includes("cost_usd"));
  assertEquals((await t.env.store.judgments(e.id))[0]!.verdict, "pass");
});

Deno.test("a failure after the spawn is unknown cost, not zero; a failure before it is exact zero", async () => {
  const t = await makeEnv();
  t.docker.failAfterStart = new Error("capture pipe broke");
  const after = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals([after.termination, after.telemetry.cost_usd], [
    "harness_crash",
    null,
  ]);
  assert(after.validity.incomplete_telemetry.includes("cost_usd"));
  const t2 = await makeEnv();
  t2.docker.runError = new Error("open raw.jsonl: access denied");
  const before = (await runCell(t2.env, await cellFor(t2))).executions[0]!;
  assertEquals([before.termination, before.telemetry.cost_usd], [
    "setup_failed",
    0,
  ]);
});

Deno.test("images: retagging never invalidates a pinned image; a removed pinned image is setup_failed and never runs", async () => {
  const t = await makeEnv();
  const cell = await cellFor(t);
  t.docker.addImage(
    "centralgauge/harness-claude-code:2.1.282",
    `sha256:${"d".repeat(64)}`,
    {},
  );
  assertEquals(
    (await runCell(t.env, cell)).executions[0]!.termination,
    "completed",
  );
  assertEquals(t.docker.runs[0]!.image, IMAGE_ID);
  t.docker.images.delete(IMAGE_ID);
  const r = await runCell(t.env, cell);
  assertEquals([
    r.executions[0]!.termination,
    r.executions[0]!.telemetry.cost_usd,
    t.docker.runs.length,
  ], ["setup_failed", 0, 1]);
});

Deno.test("runCell: a usage limit pauses, is not judged, and persists the reset time", async () => {
  const t = await makeEnv();
  t.docker.behavior = async (_c, io) => {
    for (
      const l of [
        INIT,
        JSON.stringify({
          type: "rate_limit_event",
          rate_limit_info: { status: "rejected", resetsAt: 1790643600 },
        }),
        JSON.stringify({
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          api_error_status: 429,
          modelUsage: {},
        }),
      ]
    ) await io.stdout(l);
    return 1;
  };
  const r = await runCell(t.env, await cellFor(t));
  const reset = new Date(1790643600 * 1000).toISOString();
  assertEquals([r.executions[0]!.termination, r.pause], [
    "usage_limited",
    reset,
  ]);
  assertEquals(await t.env.store.judgments(r.executions[0]!.id), []);
  assertEquals((await sideOf(t, r.executions[0]!.id)).usage_reset_at, reset);
});

Deno.test("runCell: an observed version mismatch is setup_failed", async () => {
  const t = await makeEnv();
  t.docker.behavior = async (_c, io) => {
    await io.stdout(INIT.replace("2.1.282", "2.1.300"));
    return 0;
  };
  const r = await runCell(t.env, await cellFor(t));
  assertEquals(r.executions[0]!.termination, "setup_failed");
  assertStringIncludes(
    (await sideOf(t, r.executions[0]!.id)).setup_error,
    "2.1.300",
  );
});

Deno.test("unconfirmed termination: nothing is frozen or published; recovery finalizes once the container is gone", async () => {
  const t = await makeEnv();
  const cell = await cellFor(t);
  t.docker.behavior = async (call, io) => {
    t.docker.lingering.add(call.name);
    return await ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct")(
      call,
      io,
    );
  };
  await assertRejects(
    () => runCell(t.env, cell),
    ContainerError,
    "termination not confirmed",
  );
  assertEquals(await t.env.store.executions(cell.campaignId), []);
  assert(
    !await exists(join(t.env.resultsRoot, "workspaces")) ||
      [...Deno.readDirSync(join(t.env.resultsRoot, "workspaces"))].length === 0,
  );
  // Still there: recovery refuses (fail closed) and keeps the intent.
  await assertRejects(
    () => recoverInterrupted(t.env, loadTask),
    ContainerError,
    "still exists",
  );
  assertEquals(await t.env.store.executions(cell.campaignId), []);
  t.docker.lingering.clear();
  const [e] = await recoverInterrupted(t.env, loadTask);
  assertEquals([e!.termination, e!.did_work], ["harness_crash", true]);
  assertEquals((await t.env.store.judgments(e!.id))[0]!.verdict, "pass");
});

Deno.test("every published surface is redacted (UTF-8 and UTF-16): logs, stderr, trace, side file, record, workspace", async () => {
  const t = await makeEnv();
  let token = "";
  t.docker.behavior = async (call, io) => {
    token = await tokenOf(call);
    const ws = call.mounts.get("C:\\workspace")!.src;
    await Deno.writeTextFile(join(ws, "leak.txt"), `x${SECRET_OAUTH}y${token}`);
    await Deno.writeFile(
      join(ws, "leak16.txt"),
      new Uint8Array(
        new Uint16Array([...SECRET_OAUTH].map((c) => c.charCodeAt(0))).buffer,
      ),
    );
    await io.stdout(INIT);
    await io.stdout(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: `${SECRET_OAUTH}/${token}` }],
        },
      }),
    );
    for (const l of await probeLines()) await io.stdout(l);
    return 0;
  };
  const r = await runCell(t.env, await cellFor(t));
  const published = await allBytes(t.env.resultsRoot);
  assert(!leaks(published, SECRET_OAUTH) && !leaks(published, token));
  const side = await sideOf(t, r.executions[0]!.id);
  assertEquals([side.redactions, side.workspace_redactions], [2, 3]);
  assert(!await exists(privatePaths(t.env, r.executions[0]!.id).custody));
});

Deno.test("recovery: an interrupted attempt keeps its spend at the original prices and is redacted with the custody secrets", async () => {
  const t = await makeEnv();
  t.docker.behavior = async (call, io) => {
    const token = await tokenOf(call);
    await ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct")(call, io);
    // A known record type: an unknown one is a stream problem, which makes the cost incomplete (M1-32 ruling).
    await io.stdout(
      JSON.stringify({
        type: "system",
        subtype: "leak",
        token,
        oauth: SECRET_OAUTH,
      }),
    );
    return 0;
  };
  t.env.hooks = {
    beforeDraft: () => Promise.reject(new Error("runner killed")),
  };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  assertEquals(await t.env.store.executions(cell.campaignId), []);
  assert(
    !leaks(await allBytes(t.env.resultsRoot), SECRET_OAUTH),
    "a crashed run leaves no unredacted log under results",
  );
  // Prices changed and the operator rotated the credential file since the attempt.
  t.env.pricing = () => Promise.resolve({ at: "x", models: {} });
  await Deno.writeTextFile(
    join(t.env.secretsSource, "claude-oauth-token"),
    "rotated-0123456789abcdef",
  );
  t.env.hooks = {};
  const [e] = await recoverInterrupted(t.env, loadTask);
  assertEquals([e!.termination, e!.did_work], ["harness_crash", true]);
  assertAlmostEquals(e!.telemetry.cost_usd!, PROBE_COST, 1e-12);
  const raw = await Deno.readTextFile(
    join(t.env.resultsRoot, e!.raw_log_path!),
  );
  assertStringIncludes(raw, "[REDACTED:backend-token]");
  assertStringIncludes(raw, "[REDACTED:claude-oauth-token]");
  assert(!leaks(await allBytes(t.env.resultsRoot), SECRET_OAUTH));
  assertEquals((await t.env.store.judgments(e!.id))[0]!.verdict, "pass");
  assertEquals(
    await recoverInterrupted(t.env, loadTask),
    [],
    "recovery is idempotent",
  );
});

Deno.test("recovery: publishes into the original results root, from the stored manifest and task snapshot, even after the task was deleted or its limits changed", async () => {
  const t = await makeEnv();
  const cellsRoot = join(t.env.resultsRoot, "cells");
  const cellsEnv = {
    ...t.env,
    resultsRoot: cellsRoot,
    store: new RecordStore(cellsRoot),
  };
  cellsEnv.hooks = {
    beforeDraft: () => Promise.reject(new Error("runner killed")),
  };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(cellsEnv, cell), Error, "runner killed");
  await write(
    t.repo.tasksDir,
    "HX-001/task.yml",
    (await Deno.readTextFile(join(t.repo.tasksDir, "HX-001", "task.yml")))
      .replace("timeout_min: 20", "timeout_min: 5"),
  );
  await Deno.rename(
    join(t.repo.tasksDir, "HX-001"),
    join(t.repo.tasksDir, "HX-001-moved"),
  );
  const [e] = await recoverInterrupted(t.env, loadTask); // a different command's env: results/harness
  assertEquals(
    await t.env.store.executions(cell.campaignId),
    [],
    "nothing lands in the other command's store",
  );
  const stored = await cellsEnv.store.executions(cell.campaignId);
  assertEquals(stored.map((x) => x.id), [e!.id]);
  assertEquals(
    stored[0]!.manifest.limits.timeout_min,
    20,
    "the original effective limits, not the edited ones",
  );
  assertEquals(
    await cellsEnv.store.judgments(e!.id),
    [],
    "task unavailable: recorded, not judged",
  );
});

Deno.test("recovery: custody missing after release stops (fail closed) and keeps the intent", async () => {
  const t = await makeEnv();
  t.env.hooks = {
    beforeDraft: () => Promise.reject(new Error("runner killed")),
  };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  const intentFile =
    [...Deno.readDirSync(join(t.env.privateRoot, "intents"))][0]!.name;
  const id = intentFile.replace(".json", "");
  await Deno.remove(privatePaths(t.env, id).custody);
  t.env.hooks = {};
  await assertRejects(
    () => recoverInterrupted(t.env, loadTask),
    ContainerError,
    "custody",
  );
  assert(await exists(privatePaths(t.env, id).intent), "intent kept");
  assertEquals(await t.env.store.executions(cell.campaignId), []);
});

Deno.test("a setup failure with no captures still writes its draft and publishes", async () => {
  const t = await makeEnv();
  const cell = await cellFor(t);
  t.docker.images.delete(IMAGE_ID);
  const e = (await runCell(t.env, cell)).executions[0]!;
  assertEquals([e.termination, e.telemetry.cost_usd], ["setup_failed", 0]);
  assert(await exists(join(t.env.resultsRoot, "runs", e.id, "sandbox.json")));
});

Deno.test("recovery: an interruption inside cleanup only repeats the cleanup", async () => {
  const t = await makeEnv();
  t.env.hooks = {
    afterPublished: () => Promise.reject(new Error("runner killed")),
  };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  t.env.hooks = {};
  assertEquals(await recoverInterrupted(t.env, loadTask), []);
  const [e] = await t.env.store.executions(cell.campaignId);
  assertEquals((await t.env.store.judgments(e!.id)).length, 1);
  assertEquals([...Deno.readDirSync(join(t.env.privateRoot, "intents"))], []);
});

for (
  const step of [
    "draft",
    "run",
    "execution",
    "artifact",
    "judgment",
  ] as PublishStep[]
) {
  Deno.test(`recovery: a crash after the ${step} step completes exactly once`, async () => {
    const t = await makeEnv();
    t.env.hooks = {
      after: (s) =>
        s === step
          ? Promise.reject(new Error("runner killed"))
          : Promise.resolve(),
    };
    const cell = await cellFor(t);
    await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
    t.env.hooks = {};
    await recoverInterrupted(t.env, loadTask);
    const execs = await t.env.store.executions(cell.campaignId);
    assertEquals(execs.length, 1);
    assert((await t.env.store.artifact(execs[0]!.id)) !== null);
    assertEquals((await t.env.store.judgments(execs[0]!.id)).length, 1);
    assert(
      await exists(join(t.env.resultsRoot, "runs", execs[0]!.id, "raw.jsonl")),
    );
    const p = privatePaths(t.env, execs[0]!.id);
    for (const d of [p.pending, p.custody, p.intent]) {
      assert(!await exists(d), d);
    }
    // No temp copy of the run directory is left behind.
    assertEquals(
      [...Deno.readDirSync(join(t.env.resultsRoot, "runs"))].map((x) => x.name),
      [execs[0]!.id],
    );
  });
}

Deno.test("recovery: a task changed since the attempt is recorded but not judged", async () => {
  const t = await makeEnv();
  t.env.hooks = {
    after: (s) =>
      s === "draft"
        ? Promise.reject(new Error("runner killed"))
        : Promise.resolve(),
  };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  await write(
    t.repo.tasksDir,
    "HX-001/oracle/src/Extra.Test.al",
    "// changed oracle\n",
  );
  t.env.hooks = {};
  await recoverInterrupted(t.env, loadTask);
  const [e] = await t.env.store.executions(cell.campaignId);
  assertEquals(await t.env.store.judgments(e!.id), []);
});

Deno.test("operator interrupt stops the sandbox; the attempt is recorded and judged as work done", async () => {
  const t = await makeEnv();
  const stop = new AbortController();
  t.env.stop = stop.signal;
  t.docker.behavior = async (call, io) => {
    await ccBehavior(
      join(t.repo.tasksDir, "HX-001"),
      "correct",
      (await probeLines()).slice(0, 12),
    )(call, io);
    stop.abort();
    await io.killed;
    return 137;
  };
  const e = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals([e.termination, e.telemetry.cost_usd], ["harness_crash", null]);
  assertEquals((await sideOf(t, e.id)).stop_reason, "operator_interrupt");
  assertEquals((await t.env.store.judgments(e.id))[0]!.verdict, "pass");
});

Deno.test("operator interrupt: no automatic retry starts after it", async () => {
  const t = await makeEnv();
  t.env.supervised = false;
  t.env.egressEnforced = true;
  const stop = new AbortController();
  t.env.stop = stop.signal;
  t.docker.behavior = async (_c, io) => {
    await io.stdout(INIT);
    stop.abort();
    await io.killed;
    return 137;
  };
  const r = await runCell(t.env, await cellFor(t));
  assertEquals(r.executions.map((e) => [e.termination, e.did_work]), [[
    "harness_crash",
    false,
  ]]);
  assertStringIncludes(r.stopped!, "operator interrupt");
  assertEquals(t.docker.runs.length, 1);
});

Deno.test("stream problems (M1-32 ruling): no usable result is infra exposed with the non-JSON line numbers", async () => {
  const t = await makeEnv();
  const lines = (await probeLines()).slice(0, 12);
  t.docker.behavior = async (call, io) => {
    await ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct", [])(call, io);
    await io.stdout("WARNING: not json");
    for (const l of lines) await io.stdout(l);
    await io.stdout("{truncated");
    return 0;
  };
  const e = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals(e.validity.infra_exposed, true);
  assertEquals(e.telemetry.cost_usd, null);
  const side = await sideOf(t, e.id);
  assertStringIncludes(side.infra_reason, "non-JSON harness stdout");
  assertStringIncludes(side.infra_reason, "line 2");
  assertStringIncludes(side.infra_reason, `line ${lines.length + 3}`);
  assert(!side.infra_reason.includes("WARNING"), "no line content is stored");
});

Deno.test("stream problems (M1-32 ruling): a usable result with stream problems has incomplete cost", async () => {
  const t = await makeEnv();
  t.docker.behavior = async (call, io) => {
    await ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct")(call, io);
    await io.stdout(JSON.stringify({ type: "mystery" }));
    return 0;
  };
  const e = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals(e.termination, "completed");
  assertEquals(
    [
      e.telemetry.cost_usd,
      e.telemetry.cost_source,
      e.telemetry.pricing_snapshot,
    ],
    [null, null, null],
  );
  assert(e.validity.incomplete_telemetry.includes("cost_usd"));
  assertEquals(e.validity.infra_exposed, false);
  assertStringIncludes(
    (await sideOf(t, e.id)).stream_problems.join("\n"),
    "unknown record type mystery",
  );
  assertEquals((await t.env.store.judgments(e.id))[0]!.verdict, "pass");
});

Deno.test("recovery start (M1-20 handoff): leftover sandboxes are removed first, then this owner's stale secrets", async () => {
  const t = await makeEnv();
  const base = join(t.env.privateRoot, "secrets");
  const mine = join(base, `${SECRETS_DIR_PREFIX}HOST1.${crypto.randomUUID()}`);
  const other = join(base, `${SECRETS_DIR_PREFIX}HOST2.${crypto.randomUUID()}`);
  for (const d of [mine, other]) {
    await Deno.mkdir(d, { recursive: true });
    await Deno.writeTextFile(join(d, "backend-token"), "x".repeat(64));
  }
  const leftover = "cg-harness-11111111-00000000-0000-4000-8000-000000000009";
  t.docker.owned.push(leftover);
  const secretsAtRm: boolean[] = [];
  const rm = t.docker.rm.bind(t.docker);
  t.docker.rm = async (name) => {
    secretsAtRm.push(await exists(mine));
    return await rm(name);
  };
  assertEquals(await recoverInterrupted(t.env, loadTask), []);
  assertEquals(t.docker.removed, [leftover]);
  assertEquals(
    secretsAtRm,
    [true],
    "sandboxes first, while the mount source still exists",
  );
  assert(!await exists(mine));
  assert(await exists(other), "another owner's custody is untouched");
});

Deno.test("records of a campaign pass ExecutionRecordSchema and validateCampaignRecords (ancestry, limits, artifacts, judgments)", async () => {
  const t = await makeEnv();
  await write(
    t.harnessRoot,
    "bundles/alt/instructions/CLAUDE.md",
    "Other facts.\n",
  );
  await write(
    t.harnessRoot,
    "configs/cc-sonnet-alt.yml",
    (await Deno.readTextFile(
      join(t.harnessRoot, "configs", "cc-sonnet-plain.yml"),
    ))
      .replace("id: cc-sonnet-plain", "id: cc-sonnet-alt")
      .replace("bundles/env/instructions", "bundles/alt/instructions"),
  );
  const plain = await cellFor(t);
  const alt = await cellFor(t, "cc-sonnet-alt");
  const experiment = ExperimentSchema.parse({
    id: "instructions",
    hypothesis: "Other instructions change nothing.",
    primary_metric: "cost_per_solved_task",
    baseline: "cc-sonnet-plain",
    variants: ["cc-sonnet-alt"],
    vary: ["instructions"],
    tasks: "harness-tasks/tasks/*",
    repeats: 1,
  });
  const task_set = await taskSetIdentity(
    t.repo.root,
    [plain.task],
    t.repo.symbols,
  );
  const blocks = planBlocks(
    ["HX-001"],
    1,
    ["cc-sonnet-plain", "cc-sonnet-alt"],
    7,
  );
  const campaign: CampaignRecord = {
    v: 1,
    id: plain.campaignId,
    experiment,
    experiment_hash: await experimentHash(experiment),
    created_at: "2026-10-01T10:00:00.000Z",
    seed: 7,
    reuse: [],
    task_set,
    tasks_meta: [{
      id: "HX-001",
      kind: "bugfix",
      coupling: [],
      limits: plain.task.task.limits,
    }],
    arms: [
      {
        config_id: "cc-sonnet-plain",
        manifest_hash: plain.armManifestHash,
        manifest: plain.armManifest,
      },
      {
        config_id: "cc-sonnet-alt",
        manifest_hash: alt.armManifestHash,
        manifest: alt.armManifest,
      },
    ],
    blocks,
  };
  await t.env.store.writeCampaign(campaign);
  t.env.supervised = false;
  t.env.egressEnforced = true;
  const place = (c: CellRef): CellRef => ({
    ...c,
    block: blocks[0]!,
    orderInBlock: blocks[0]!.order.indexOf(c.arm),
  });
  // plain: a crash without work, then its automatic retry (also a crash): a two-member chain.
  t.docker.behavior = async (_c, io) => {
    await io.stdout(INIT);
    await io.stdout(
      JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        modelUsage: {},
      }),
    );
    return 1;
  };
  const a = await runCell(t.env, place(plain));
  assertEquals(a.executions.length, 2);
  t.docker.behavior = ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct");
  const b = await runCell(t.env, place(alt));
  const executions: ExecutionRecord[] = await t.env.store.executions(
    campaign.id,
  );
  assertEquals(executions.length, 3);
  for (const e of executions) {
    ExecutionRecordSchema.parse(e);
    assertEquals(e.v, 2);
  }
  const artifacts: ArtifactRecord[] = [];
  const judgments: JudgmentRecord[] = [];
  for (const e of executions) {
    const art = await t.env.store.artifact(e.id);
    if (art) artifacts.push(art);
    judgments.push(...await t.env.store.judgments(e.id));
  }
  assertEquals(judgments.map((j) => j.execution_id), [b.executions[0]!.id]);
  await validateCampaignRecords({ campaign, executions, artifacts, judgments });
});

Deno.test("a refused harness log (two result records) is still recorded: harness_crash, infra exposed, cost unknown", async () => {
  const t = await makeEnv();
  const result = (await probeLines()).at(-1)!;
  t.docker.behavior = async (call, io) => {
    await ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct")(call, io);
    await io.stdout(result);
    return 0;
  };
  const e = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals(
    [e.termination, e.telemetry.cost_usd, e.validity.infra_exposed],
    [
      "harness_crash",
      null,
      true,
    ],
  );
  assertStringIncludes(
    (await sideOf(t, e.id)).infra_reason,
    "2 result records",
  );
  const published = await allBytes(t.env.resultsRoot);
  for (const s of privateSpellings(t.env.privateRoot)) {
    assert(!published.includes(s), `private path published: ${s}`);
  }
  assertEquals((await t.env.store.judgments(e.id))[0]!.verdict, "pass");
});

/** Absolute private paths in any spelling a published file could carry. */
function privateSpellings(root: string): string[] {
  return [root, root.replaceAll("\\", "/"), JSON.stringify(root).slice(1, -1)];
}
const intentIds = (t: TestEnv) =>
  [...Deno.readDirSync(join(t.env.privateRoot, "intents"))].map((e) =>
    e.name.replace(".json", "")
  );

Deno.test("custody temp files (plaintext secrets) are removed by cleanup and by recovery", async () => {
  const t = await makeEnv();
  const custodyDir = join(t.env.privateRoot, "custody");
  let planted = "";
  t.env.hooks = {
    afterPublished: async () => {
      const [id] = intentIds(t);
      planted = join(custodyDir, `${id}.json.tmp-${crypto.randomUUID()}`);
      await Deno.writeTextFile(planted, SECRET_OAUTH);
    },
  };
  await runCell(t.env, await cellFor(t));
  assert(
    planted !== "" && !await exists(planted),
    "the attempt's temp custody",
  );
  t.env.hooks = {};
  // A crash between the temp write and its rename, attempt long gone.
  const stray = join(
    custodyDir,
    `${crypto.randomUUID()}.json.tmp-${crypto.randomUUID()}`,
  );
  await Deno.writeTextFile(stray, SECRET_OAUTH);
  assertEquals(await recoverInterrupted(t.env, loadTask), []);
  assert(!await exists(stray));
});

Deno.test("recovery: a zero-length intent is quarantined and reported; the other attempts still recover", async () => {
  const t = await makeEnv();
  t.env.hooks = {
    beforeDraft: () => Promise.reject(new Error("runner killed")),
  };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  t.env.hooks = {};
  const broken = crypto.randomUUID();
  await Deno.writeTextFile(
    join(t.env.privateRoot, "intents", `${broken}.json`),
    "",
  );
  const recovered = await recoverInterrupted(t.env, loadTask);
  assertEquals(recovered.length, 1);
  assertEquals(intentIds(t), []);
  assert(await exists(join(t.env.privateRoot, "broken", `${broken}.json`)));
});

Deno.test("recovery: a zero-length draft is rebuilt, published once", async () => {
  const t = await makeEnv();
  t.env.hooks = {
    after: (s) =>
      s === "draft"
        ? Promise.reject(new Error("runner killed"))
        : Promise.resolve(),
  };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  t.env.hooks = {};
  const [id] = intentIds(t);
  await Deno.writeTextFile(
    join(privatePaths(t.env, id!).pending, "draft.json"),
    "",
  );
  const [e] = await recoverInterrupted(t.env, loadTask);
  assertEquals(e!.id, id);
  assertEquals((await t.env.store.executions(cell.campaignId)).length, 1);
  assertEquals((await t.env.store.judgments(id!)).length, 1);
});

Deno.test("recovery: an unreadable custody is quarantined (nothing published), never a permanent block", async () => {
  const t = await makeEnv();
  t.env.hooks = {
    beforeDraft: () => Promise.reject(new Error("runner killed")),
  };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  t.env.hooks = {};
  const [id] = intentIds(t);
  await Deno.writeTextFile(privatePaths(t.env, id!).custody, "");
  assertEquals(await recoverInterrupted(t.env, loadTask), []);
  assertEquals(await t.env.store.executions(cell.campaignId), []);
  assertEquals(intentIds(t), []);
  assert(await exists(join(t.env.privateRoot, "broken", `${id}.json`)));
  assertEquals(
    await recoverInterrupted(t.env, loadTask),
    [],
    "no longer blocks",
  );
});

Deno.test("no absolute private path reaches a published file (missing raw log in recovery)", async () => {
  const t = await makeEnv();
  t.env.hooks = {
    beforeDraft: () => Promise.reject(new Error("runner killed")),
  };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  t.env.hooks = {};
  const [id] = intentIds(t);
  await Deno.remove(privatePaths(t.env, id!).raw);
  const [e] = await recoverInterrupted(t.env, loadTask);
  const side = await sideOf(t, e!.id);
  assertStringIncludes(side.infra_reason, "raw.jsonl: raw log missing");
  assert(!side.infra_reason.includes("quarantine"), "the file name only");
  const published = await allBytes(t.env.resultsRoot);
  for (const s of privateSpellings(t.env.privateRoot)) {
    assert(!published.includes(s), `private path published: ${s}`);
  }
});

Deno.test("an operator stop before the start reserves no credential run and starts nothing", async () => {
  const t = await makeEnv();
  const stop = new AbortController();
  stop.abort();
  t.env.stop = stop.signal;
  await assertRejects(
    async () => runCell(t.env, await cellFor(t)),
    ConfigurationError,
    "stopped",
  );
  assert(!await exists(t.env.credentialLedger!), "no slot reserved");
  assertEquals(t.docker.runs, []);
});

Deno.test("runCell: an automatic retry needs its parent in prior, at attempt parent + 1", async () => {
  const t = await makeEnv();
  t.env.supervised = false;
  t.env.egressEnforced = true;
  const cell = await cellFor(t);
  await assertRejects(
    () =>
      runCell(t.env, cell, {
        attempt: 2,
        runKind: "auto_retry",
        retryOf: crypto.randomUUID(),
      }),
    ConfigurationError,
    "parent",
  );
  t.docker.images.delete(IMAGE_ID);
  const [parent] = (await runCell(t.env, cell)).executions;
  await assertRejects(
    () =>
      runCell(t.env, cell, {
        attempt: 5,
        runKind: "auto_retry",
        retryOf: parent!.id,
      }, [parent!]),
    ConfigurationError,
    "attempt",
  );
  assertEquals(t.docker.runs, []);
});

/** A verdict container whose oracle failure message is built at runtime from the attempt's secrets. */
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

async function judgeLeakEnv() {
  let token = "";
  const t = await makeEnv({ bc: leakingBc(() => [SECRET_OAUTH, token]) });
  const inner = t.docker.behavior;
  t.docker.behavior = async (call, io) => {
    token = await tokenOf(call);
    return await inner(call, io);
  };
  return { t, token: () => token };
}

async function assertJudgeOutputRedacted(t: TestEnv, token: string) {
  const published = await allBytes(t.env.resultsRoot);
  assert(token.length === 64);
  assert(!leaks(published, SECRET_OAUTH), "oauth in a published file");
  assert(!leaks(published, token), "backend token in a published file");
  const logs = [...Deno.readDirSync(join(t.env.resultsRoot, "verdicts"))];
  assert(logs.length > 0);
  for (const l of logs) {
    const text = await Deno.readTextFile(
      join(t.env.resultsRoot, "verdicts", l.name),
    );
    assertStringIncludes(text, "[REDACTED:claude-oauth-token]");
    assertStringIncludes(text, "[REDACTED:backend-token]");
  }
}

Deno.test("judge output is redacted with the custody secrets: live run", async () => {
  const { t, token } = await judgeLeakEnv();
  const e = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals((await t.env.store.judgments(e.id))[0]!.verdict, "fail");
  await assertJudgeOutputRedacted(t, token());
});

Deno.test("judge output is redacted with the custody secrets: recovery and rejudge", async () => {
  const { t, token } = await judgeLeakEnv();
  t.env.hooks = {
    after: (s) =>
      s === "artifact"
        ? Promise.reject(new Error("runner killed"))
        : Promise.resolve(),
  };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  t.env.hooks = {};
  const [e] = await recoverInterrupted(t.env, loadTask);
  assertEquals((await t.env.store.judgments(e!.id)).length, 1);
  await assertJudgeOutputRedacted(t, token());
  // After publication the custody plaintext is gone; a rejudge still redacts.
  assert(!await exists(privatePaths(t.env, e!.id).custody));
  await rejudgeExecution(t.env, cell, e!, cell.oracleHash);
  assertEquals((await t.env.store.judgments(e!.id)).length, 2);
  await assertJudgeOutputRedacted(t, token());
});

Deno.test("privateRoot is validated before any secret: under results/, under the worktree, UNC or a network drive is refused", async () => {
  const cases: [string, (t: TestEnv) => Promise<void>][] = [
    ["results", async (t) => {
      const p = join(t.env.resultsRoot, "private");
      await Deno.mkdir(p);
      t.env.privateRoot = p;
    }],
    ["worktree", async (t) => {
      const p = join(t.repo.root, "private");
      await Deno.mkdir(p);
      t.env.privateRoot = p;
    }],
    ["UNC", (t) => {
      t.env.privateRoot = "\\\\server\\share\\cg-private";
      return Promise.resolve();
    }],
    ["network", (t) => {
      t.env.driveType = () => Promise.resolve("Network");
      return Promise.resolve();
    }],
  ];
  for (const [want, setup] of cases) {
    const t = await makeEnv();
    const ledger = t.env.credentialLedger!;
    await setup(t);
    await assertRejects(
      async () => runCell(t.env, await cellFor(t)),
      ConfigurationError,
      want,
    );
    assert(!await exists(ledger), `${want}: no slot reserved`);
    assertEquals(t.docker.runs, [], want);
  }
});

Deno.test({
  name:
    "custody: the temp file gets the verified owner-only ACL before any content is written",
  ignore: Deno.build.os !== "windows",
}, async () => {
  const t = await makeEnv();
  const acl = t.env.secretAcl!;
  const seen: { args: string[]; size: number | null }[] = [];
  t.env.secretAcl = {
    user: acl.user,
    icacls: async (args) => {
      const size = await Deno.stat(args[0]!).then((s) => s.size, () => null);
      seen.push({ args, size });
      return await acl.icacls(args);
    },
  };
  t.env.hooks = {
    beforeDraft: () => Promise.reject(new Error("runner killed")),
  };
  await assertRejects(
    async () => runCell(t.env, await cellFor(t)),
    Error,
    "runner killed",
  );
  const custody = seen.filter((s) =>
    /[\\/]custody[\\/][0-9a-f-]+\.json\.tmp-/.test(s.args[0]!)
  );
  assertEquals(custody.map((s) => [s.args.length > 1, s.size]), [
    [true, 0],
    [false, 0],
  ], "grant, then verify, both on the empty temp file");
  const [id] = intentIds(t);
  assert(
    (await Deno.readTextFile(privatePaths(t.env, id!).custody)).includes(
      "backend-token",
    ),
  );
});

Deno.test("preflight failures (missing image, missing operator secret) reserve no credential run", async () => {
  const t = await makeEnv();
  const cell = await cellFor(t);
  t.docker.images.delete(IMAGE_ID);
  assertEquals(
    (await runCell(t.env, cell)).executions[0]!.termination,
    "setup_failed",
  );
  assert(!await exists(t.env.credentialLedger!), "image: no slot reserved");
  const t2 = await makeEnv();
  await Deno.remove(join(t2.env.secretsSource, "claude-oauth-token"));
  const e = (await runCell(t2.env, await cellFor(t2))).executions[0]!;
  assertEquals(e.termination, "setup_failed");
  assert(!await exists(t2.env.credentialLedger!), "secret: no slot reserved");
  assertEquals(t2.docker.runs, []);
});

/** Records each icacls call with the target's state; `failVerify` makes the listing of matching paths wrong. */
function aclSpy(
  t: TestEnv,
  failVerify: (path: string) => boolean = () => false,
) {
  const acl = t.env.secretAcl!;
  const seen: {
    path: string;
    grant: boolean;
    size: number | null;
    entries: string[];
  }[] = [];
  t.env.secretAcl = {
    user: acl.user,
    icacls: async (args) => {
      const path = args[0]!;
      const st = await Deno.stat(path).catch(() => null);
      seen.push({
        path,
        grant: args.length > 1,
        size: st?.isFile ? st.size : null,
        entries: st?.isDirectory
          ? [...Deno.readDirSync(path)].map((e) => e.name)
          : [],
      });
      if (args.length === 1 && failVerify(path)) {
        return {
          code: 0,
          stdout:
            `${path} Everyone:(F)\n\nSuccessfully processed 1 files; Failed processing 0 files\r\n`,
          stderr: "",
        };
      }
      return await acl.icacls(args);
    },
  };
  return seen;
}

Deno.test({
  name:
    "custody and key files: their directories are restricted and verified before any temp file goes in; each temp file before its first write",
  ignore: Deno.build.os !== "windows",
}, async () => {
  const t = await makeEnv();
  const seen = aclSpy(t);
  t.env.hooks = {
    beforeDraft: () => Promise.reject(new Error("runner killed")),
  };
  await assertRejects(
    async () => runCell(t.env, await cellFor(t)),
    Error,
    "runner killed",
  );
  for (const sub of ["custody", "redaction"]) {
    const dir = join(t.env.privateRoot, sub);
    const dirCalls = seen.filter((s) => s.path === dir);
    assertEquals(dirCalls.map((s) => [s.grant, s.entries]), [[true, []], [
      false,
      [],
    ]], `${sub} dir: grant, verify, still empty`);
    const tmp = seen.filter((s) =>
      s.path.startsWith(dir + "\\") && s.path.includes(".json.tmp-")
    );
    assertEquals(
      tmp.map((s) => [s.grant, s.size]),
      [[true, 0], [false, 0]],
      `${sub} temp: grant, verify, before the first write`,
    );
    assert(
      seen.indexOf(dirCalls[1]!) < seen.indexOf(tmp[0]!),
      `${sub}: the directory is verified first`,
    );
  }
  const [id] = intentIds(t);
  assert(
    (await Deno.readTextFile(privatePaths(t.env, id!).keys)).includes("sha256"),
  );
});

Deno.test({
  name:
    "a key file whose ACL does not verify is never written (and nothing is reserved or run)",
  ignore: Deno.build.os !== "windows",
}, async () => {
  const t = await makeEnv();
  aclSpy(t, (p) => p.includes(".json.tmp-") && p.includes("\\redaction\\"));
  const e = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals(e.termination, "setup_failed");
  assertEquals([...Deno.readDirSync(join(t.env.privateRoot, "redaction"))], []);
  assert(!await exists(t.env.credentialLedger!), "no slot reserved");
  assertEquals(t.docker.runs, []);
});

Deno.test({
  name: "an unverified custody directory refuses before any secret is written",
  ignore: Deno.build.os !== "windows",
}, async () => {
  const t = await makeEnv();
  const custodyDir = join(t.env.privateRoot, "custody");
  aclSpy(t, (p) => p === custodyDir);
  const e = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals(e.termination, "setup_failed");
  assertEquals(
    [...Deno.readDirSync(custodyDir)],
    [],
    "no custody temp or file",
  );
  assert(
    !await exists(join(t.env.privateRoot, "secrets")) ||
      [...Deno.readDirSync(join(t.env.privateRoot, "secrets"))].length === 0,
    "no secrets released",
  );
  assert(!await exists(t.env.credentialLedger!), "no slot reserved");
  assertEquals(t.docker.runs, []);
});
