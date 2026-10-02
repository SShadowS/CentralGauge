import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import {
  abandon,
  accept,
  addTask,
  answer,
  ask,
  checkpoint,
  claim,
  CoordError,
  doctor,
  heartbeat,
  initRoot,
  lease,
  leaseHolder,
  next,
  openQuestions,
  overview,
  pause,
  pauseState,
  reject,
  release,
  resume,
  stale,
  status,
  submit,
  sweep,
  sweepText,
  taskState,
  why,
} from "../../../scripts/coord/coord.ts";

async function freshRoot(): Promise<string> {
  const base = await Deno.makeTempDir({ prefix: "coord-test-" });
  const root = join(base, "coord");
  await initRoot(root, "test-campaign");
  return root;
}

async function seed(root: string) {
  await addTask(root, { id: "M0-01", lane: "content", deps: [] }, "skeleton");
  await addTask(root, { id: "M0-02", lane: "ops", deps: ["M0-01"] }, "timing");
  await addTask(root, { id: "M0-03", lane: "ops", deps: ["M0-02"] }, "later");
}

Deno.test("coord: init refuses an existing root and open refuses a missing one", async () => {
  const root = await freshRoot();
  await assertRejects(() => initRoot(root, "again"), CoordError);
  await assertRejects(() => status(join(root, "nope")), CoordError);
});

Deno.test("coord: task ids and lanes are validated", async () => {
  const root = await freshRoot();
  await assertRejects(
    () => addTask(root, { id: "../x", lane: "ops", deps: [] }, ""),
    CoordError,
  );
  await assertRejects(
    () => addTask(root, { id: "M0-01", lane: "bad lane", deps: [] }, ""),
    CoordError,
  );
  await addTask(root, { id: "M0-01", lane: "ops", deps: [] }, "");
  await assertRejects(
    () => addTask(root, { id: "M0-01", lane: "ops", deps: [] }, ""),
    CoordError,
  );
});

Deno.test("coord: next only offers tasks whose deps are accepted", async () => {
  const root = await freshRoot();
  await seed(root);
  assertEquals((await next(root, "content")).map((t) => t.id), ["M0-01"]);
  assertEquals((await next(root, "ops")).map((t) => t.id), []);

  const run = await claim(root, "M0-01", "content");
  await submit(root, "M0-01", run.runId, run.token, "abc123", "lane-content");
  assertEquals((await taskState(root, "M0-01")).state, "review");
  assertEquals(
    (await next(root, "ops")).map((t) => t.id),
    [],
    "submitted is not accepted",
  );

  await accept(root, "M0-01", run.runId, "def456");
  assertEquals((await taskState(root, "M0-01")).state, "accepted");
  assertEquals((await next(root, "ops")).map((t) => t.id), ["M0-02"]);
});

Deno.test("coord: claim refuses wrong lane, unmet deps and a second claim", async () => {
  const root = await freshRoot();
  await seed(root);
  await assertRejects(() => claim(root, "M0-01", "ops"), CoordError, "lane");
  await assertRejects(() => claim(root, "M0-02", "ops"), CoordError, "deps");
  await claim(root, "M0-01", "content");
  await assertRejects(
    () => claim(root, "M0-01", "content"),
    CoordError,
    "doing",
  );
});

Deno.test("coord: concurrent claims produce exactly one winner", async () => {
  const root = await freshRoot();
  await seed(root);
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => claim(root, "M0-01", "content")),
  );
  assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
});

Deno.test("coord: mutations require the run token", async () => {
  const root = await freshRoot();
  await seed(root);
  const run = await claim(root, "M0-01", "content");
  await assertRejects(
    () => checkpoint(root, "M0-01", run.runId, "wrong", "coding"),
    CoordError,
    "token",
  );
  await assertRejects(
    () => submit(root, "M0-01", run.runId, "wrong", "c", "b"),
    CoordError,
    "token",
  );
  await checkpoint(root, "M0-01", run.runId, run.token, "coding", {
    wait: "container",
  });
  const st = await taskState(root, "M0-01");
  assertEquals(st.state, "doing");
  assertEquals(st.checkpoint?.phase, "coding");
  assertEquals(st.checkpoint?.wait, "container");
});

Deno.test("coord: a run has one terminal record", async () => {
  const root = await freshRoot();
  await seed(root);
  const run = await claim(root, "M0-01", "content");
  await submit(root, "M0-01", run.runId, run.token, "c", "b");
  await assertRejects(
    () => submit(root, "M0-01", run.runId, run.token, "c2", "b"),
    CoordError,
  );
  await assertRejects(
    () => abandon(root, "M0-01", run.runId, "late"),
    CoordError,
  );
});

Deno.test("coord: reject and abandon return the task for a new attempt with history kept", async () => {
  const root = await freshRoot();
  await seed(root);
  const r1 = await claim(root, "M0-01", "content");
  await submit(root, "M0-01", r1.runId, r1.token, "c1", "b");
  await reject(root, "M0-01", r1.runId, "tests missing");
  assertEquals((await taskState(root, "M0-01")).state, "todo");

  const r2 = await claim(root, "M0-01", "content");
  assert(r2.runId !== r1.runId);
  await abandon(root, "M0-01", r2.runId, "session died");
  const r3 = await claim(root, "M0-01", "content");
  assertEquals((await taskState(root, "M0-01")).attempts, 3);
  assertEquals(r3.runId, "003");
  await assertRejects(
    () => accept(root, "M0-01", r1.runId, "x"),
    CoordError,
    "latest",
  );
});

Deno.test("coord: a run dir without claim.json is unknown, not todo", async () => {
  const root = await freshRoot();
  await seed(root);
  await Deno.mkdir(join(root, "tasks", "M0-01", "runs", "001"), {
    recursive: true,
  });
  assertEquals((await taskState(root, "M0-01")).state, "unknown");
  await assertRejects(
    () => claim(root, "M0-01", "content"),
    CoordError,
    "unknown",
  );
  const issues = await doctor(root);
  assert(issues.some((i) => i.includes("M0-01") && i.includes("claim.json")));
});

Deno.test("coord: why traces unmet deps to the root cause and open questions", async () => {
  const root = await freshRoot();
  await seed(root);
  const run = await claim(root, "M0-01", "content");
  const q = await ask(root, "Cronus281 is stopped, please start it", {
    task: "M0-01",
    from: "lane-content",
  });
  const reasons = await why(root, "M0-03");
  assert(reasons.some((r) => r.includes("M0-02") && r.includes("todo")));
  assert(
    reasons.some((r) =>
      r.includes("M0-01") && r.includes("doing") && r.includes("content")
    ),
  );
  assert(reasons.some((r) => r.includes(q)));
  assertEquals((await openQuestions(root)).length, 1);
  await answer(root, q, "started");
  assertEquals((await openQuestions(root)).length, 0);
  await assertRejects(() => answer(root, q, "again"), CoordError);
  assert(run.runId === "001");
});

Deno.test("coord: doctor finds missing deps and cycles", async () => {
  const root = await freshRoot();
  await addTask(root, { id: "A-01", lane: "ops", deps: ["A-02"] }, "");
  await addTask(root, { id: "A-02", lane: "ops", deps: ["A-01"] }, "");
  await addTask(root, { id: "A-03", lane: "ops", deps: ["A-99"] }, "");
  const issues = await doctor(root);
  assert(issues.some((i) => i.includes("cycle")));
  assert(issues.some((i) => i.includes("A-99")));
});

Deno.test("coord: container lease is exclusive, token-checked and never auto-transferred", async () => {
  const root = await freshRoot();
  const l = await lease(root, "Cronus281", "ops");
  await assertRejects(
    () => lease(root, "Cronus281", "content"),
    CoordError,
    "held",
  );
  await assertRejects(
    () => release(root, "Cronus281", "wrong"),
    CoordError,
    "token",
  );
  await heartbeat(root, "Cronus281", l.token);

  const later = Date.now() + 60 * 60 * 1000;
  const report = await stale(root, { now: later });
  assert(report.some((r) => r.includes("Cronus281")));
  await assertRejects(
    () => lease(root, "Cronus281", "content"),
    CoordError,
    "held",
  );

  await release(root, "Cronus281", l.token);
  assertEquals(await leaseHolder(root, "Cronus281"), null);
  const l2 = await lease(root, "Cronus281", "content");
  assertEquals((await leaseHolder(root, "Cronus281"))?.lane, "content");
  assert(l2.token !== l.token);
});

Deno.test("coord: concurrent leases produce exactly one holder", async () => {
  const root = await freshRoot();
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) => lease(root, "Cronus282", `lane${i}`)),
  );
  assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
});

Deno.test("coord: stale reports a claimed run with no recent checkpoint", async () => {
  const root = await freshRoot();
  await seed(root);
  await claim(root, "M0-01", "content");
  assertEquals((await stale(root)).length, 0);
  const report = await stale(root, { now: Date.now() + 20 * 60 * 1000 });
  assert(report.some((r) => r.includes("M0-01")));
});

Deno.test("coord: a run waiting on something gets the longer stale threshold", async () => {
  const root = await freshRoot();
  await seed(root);
  const run = await claim(root, "M0-01", "content");
  await checkpoint(root, "M0-01", run.runId, run.token, "skeleton", {
    wait: "process",
  });
  const at = (min: number) => stale(root, { now: Date.now() + min * 60000 });
  assertEquals(await at(20), [], "a waiting run at 20 min is not stale");
  assert(
    (await at(250)).some((r) => r.includes("M0-01")),
    "a waiting run at 250 min is stale",
  );
  await checkpoint(root, "M0-01", run.runId, run.token, "green");
  assert(
    (await at(20)).some((r) => r.includes("M0-01")),
    "a run that stopped waiting is stale at 20 min again",
  );
});

Deno.test("coord: claim race across separate processes has one winner", async () => {
  const root = await freshRoot();
  await seed(root);
  const script = new URL("../../../scripts/coord/coord.ts", import.meta.url)
    .pathname
    .replace(/^\/([A-Za-z]:)/, "$1");
  const procs = Array.from(
    { length: 6 },
    () =>
      new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", script, "claim", "M0-01", "content"],
        env: { CG_COORD_ROOT: root },
        stdout: "null",
        stderr: "null",
      }).output(),
  );
  const codes = (await Promise.all(procs)).map((o) => o.code);
  assertEquals(codes.filter((c) => c === 0).length, 1, `exit codes: ${codes}`);
  assertEquals((await taskState(root, "M0-01")).state, "doing");
});

Deno.test("coord: CLI keeps a numeric-looking run id as a string", async () => {
  const root = await freshRoot();
  await seed(root);
  const { runId, token } = await claim(root, "M0-01", "content");
  const script = new URL("../../../scripts/coord/coord.ts", import.meta.url)
    .pathname
    .replace(/^\/([A-Za-z]:)/, "$1");
  const out = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      script,
      "checkpoint",
      "M0-01",
      runId,
      token,
      "started",
    ],
    env: { CG_COORD_ROOT: root },
  }).output();
  assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
});

Deno.test("coord: pause blocks new claims and leases, drains, and resumes", async () => {
  const root = await freshRoot();
  await seed(root);
  const run = await claim(root, "M0-01", "content");
  const l = await lease(root, "Cronus28", "ops");

  await pause(root, "owner needs the machine");
  await assertRejects(() => pause(root, "again"), CoordError, "already paused");
  await assertRejects(
    () => lease(root, "Cronus281", "ops"),
    CoordError,
    "paused",
  );
  assertEquals(await next(root, "ops"), []);

  const cp = await checkpoint(root, "M0-01", run.runId, run.token, "red", {
    wait: "paused",
  });
  assertEquals(cp.paused, true);

  let st = await pauseState(root);
  assertEquals(st.paused, true);
  assertEquals(st.drained, false, "a held lease means not drained");
  assertEquals(st.leases.map((x) => x.container), ["Cronus28"]);

  await release(root, "Cronus28", l.token);
  st = await pauseState(root);
  assertEquals(st.drained, true);

  const later = Date.now() + 60 * 60 * 1000;
  assertEquals(
    await stale(root, { now: later }),
    [],
    "runs are not stale while paused",
  );

  await resume(root);
  await assertRejects(() => resume(root), CoordError, "not paused");
  assertEquals((await pauseState(root)).paused, false);
  assertEquals(
    (await checkpoint(root, "M0-01", run.runId, run.token, "green")).paused,
    false,
  );
  await lease(root, "Cronus281", "ops");
});

Deno.test("coord: claim is refused while paused", async () => {
  const root = await freshRoot();
  await seed(root);
  await pause(root, "x");
  await assertRejects(
    () => claim(root, "M0-01", "content"),
    CoordError,
    "paused",
  );
  await resume(root);
  await pause(root, "second pause keeps history");
  await resume(root);
  const hist = [];
  for await (const e of Deno.readDir(join(root, "pauses"))) hist.push(e.name);
  assertEquals(hist.length, 2);
});

Deno.test("coord: overview summarizes milestones, active work, questions and pause", async () => {
  const root = await freshRoot();
  await seed(root);
  await Deno.writeTextFile(
    join(root, "milestones.json"),
    JSON.stringify({ M0: { title: "Spike", due: "2026-09-29" } }),
  );
  const run = await claim(root, "M0-01", "content");
  await checkpoint(root, "M0-01", run.runId, run.token, "red", {
    wait: "container",
  });
  await ask(root, "Cronus281 is stopped", {
    task: "M0-01",
    from: "lane-content",
  });
  await pause(root, "owner lunch");
  const text = await overview(root);
  assertStringIncludes(text, "PAUSED");
  assertStringIncludes(text, "owner lunch");
  assertStringIncludes(text, "M0");
  assertStringIncludes(text, "Spike");
  assertStringIncludes(text, "2026-09-29");
  assertStringIncludes(text, "0/3 accepted");
  assertStringIncludes(text, "M0-01");
  assertStringIncludes(text, "wait=container");
  assertStringIncludes(text, "Cronus281 is stopped");
});

Deno.test("coord: overview names the agent waiting for the owner", async () => {
  const root = await freshRoot();
  await seed(root);
  const run = await claim(root, "M0-01", "content");
  await checkpoint(root, "M0-01", run.runId, run.token, "blocked", {
    wait: "owner",
    note: "needs Cronus281 started",
  });
  await ask(root, "Secrets missing", { task: "M0-03", from: "lane-ops" });
  const text = await overview(root);
  assertStringIncludes(text, "Waiting for you (2)");
  assertStringIncludes(text, "lane-ops");
  assertStringIncludes(text, "Secrets missing");
  assertStringIncludes(text, "content");
  assertStringIncludes(text, "needs Cronus281 started");
});

Deno.test("coord: two roots sharing a machine root share leases and pause", async () => {
  const base = await Deno.makeTempDir({ prefix: "coord-machine-" });
  const a = join(base, "a");
  const b = join(base, "b");
  await initRoot(a, "project-a");
  await initRoot(b, "project-b", { machineRoot: a });
  await addTask(b, { id: "L-01", lane: "code", deps: [] }, "x");

  const la = await lease(a, "Cronus281", "ops");
  await assertRejects(() => lease(b, "Cronus281", "code"), CoordError, "held");
  assertEquals((await pauseState(b)).leases.map((l) => l.container), [
    "Cronus281",
  ]);
  await release(a, "Cronus281", la.token);
  const lb = await lease(b, "Cronus281", "code");
  assertEquals(
    (await leaseHolder(a, "Cronus281"))?.lane,
    "code",
    "project A sees project B's lease",
  );
  await release(b, "Cronus281", lb.token);

  await pause(a, "owner needs the machine");
  await assertRejects(() => claim(b, "L-01", "code"), CoordError, "paused");
  assertEquals((await pauseState(b)).paused, true);
  await resume(b);
  assertEquals((await pauseState(a)).paused, false);
});

Deno.test("coord: init refuses a machine root that does not exist", async () => {
  const base = await Deno.makeTempDir({ prefix: "coord-machine-" });
  await assertRejects(
    () =>
      initRoot(join(base, "b"), "b", { machineRoot: join(base, "missing") }),
    CoordError,
    "machine root",
  );
});

Deno.test("coord: lease race across separate processes has one holder", async () => {
  const root = await freshRoot();
  const script = new URL("../../../scripts/coord/coord.ts", import.meta.url)
    .pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    );
  const procs = Array.from(
    { length: 6 },
    (_, i) =>
      new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", script, "lease", "Cronus283", `lane${i}`],
        env: { CG_COORD_ROOT: root },
        stdout: "null",
        stderr: "null",
      }).output(),
  );
  const codes = (await Promise.all(procs)).map((o) => o.code);
  assertEquals(codes.filter((c) => c === 0).length, 1, `exit codes: ${codes}`);
});

Deno.test("coord: allocation.json in the machine root limits leases per project, live", async () => {
  const base = await Deno.makeTempDir({ prefix: "coord-alloc-" });
  const a = join(base, "a");
  const b = join(base, "b");
  await initRoot(a, "project-a");
  await initRoot(b, "project-b", { machineRoot: a });
  // No allocation file: anyone may lease (backward compatible).
  const free = await lease(b, "Cronus284", "code");
  await release(b, "Cronus284", free.token);

  await Deno.writeTextFile(
    join(a, "allocation.json"),
    JSON.stringify({
      "project-a": ["Cronus281", "Cronus282"],
      "project-b": ["Cronus28"],
    }),
  );
  await assertRejects(
    () => lease(b, "Cronus281", "code"),
    CoordError,
    "allocated to project-a",
  );
  await assertRejects(
    () => lease(a, "Cronus28", "ops"),
    CoordError,
    "allocated to project-b",
  );
  await assertRejects(
    () => lease(a, "Cronus284", "ops"),
    CoordError,
    "not allocated",
  );
  const ok = await lease(b, "Cronus28", "code");
  await release(b, "Cronus28", ok.token);

  // Editing the file takes effect on the next lease.
  await Deno.writeTextFile(
    join(a, "allocation.json"),
    JSON.stringify({
      "project-a": ["Cronus281", "Cronus282", "Cronus284"],
      "project-b": ["Cronus28"],
    }),
  );
  const now = await lease(a, "Cronus284", "ops");
  assertEquals(now.attempt, "002");
});

// ---------- sweep ----------

const coordScript = new URL("../../../scripts/coord/coord.ts", import.meta.url)
  .pathname.replace(/^\/([A-Za-z]:)/, "$1");

Deno.test("coord sweep: pause state and drain", async () => {
  const root = await freshRoot();
  await seed(root);
  assertEquals((await sweep(root)).pause.paused, false);
  const l = await lease(root, "Cronus281", "ops");
  await pause(root, "owner lunch");
  let s = await sweep(root);
  assertEquals(s.pause.paused, true);
  assertEquals(s.pause.reason, "owner lunch");
  assertEquals(s.pause.drained, false);
  await release(root, "Cronus281", l.token);
  s = await sweep(root);
  assertEquals(s.pause.drained, true);
});

Deno.test("coord sweep: held leases with lane and age", async () => {
  const root = await freshRoot();
  await lease(root, "Cronus281", "ops");
  const free = await lease(root, "Cronus282", "ops");
  await release(root, "Cronus282", free.token);
  const s = await sweep(root, { now: Date.now() + 30 * 60000 });
  assertEquals(s.leases.map((l) => [l.container, l.lane]), [
    ["Cronus281", "ops"],
  ]);
  assertEquals(s.leases[0]?.ageMin, 30);
});

Deno.test("coord sweep: open questions with id and first line", async () => {
  const root = await freshRoot();
  const q = await ask(root, "Cronus281 is stopped\nmore detail", {
    from: "lane-ops",
  });
  const done = await ask(root, "answered one");
  await answer(root, done, "ok");
  const s = await sweep(root);
  assertEquals(s.questions, [{ id: q, firstLine: "Cronus281 is stopped" }]);
});

Deno.test("coord sweep: stale runs", async () => {
  const root = await freshRoot();
  await seed(root);
  await claim(root, "M0-01", "content");
  assertEquals((await sweep(root)).stale, []);
  const s = await sweep(root, { now: Date.now() + 20 * 60000 });
  assertEquals(s.stale.length, 1);
  assertStringIncludes(s.stale[0] ?? "", "M0-01");
});

Deno.test("coord sweep: every non-accepted task with lane, run, phase, wait and checkpoint age", async () => {
  const root = await freshRoot();
  await seed(root);
  const r = await claim(root, "M0-01", "content");
  await checkpoint(root, "M0-01", r.runId, r.token, "red", { wait: "owner" });
  const s = await sweep(root, { now: Date.now() + 5 * 60000 });
  assertEquals(s.tasks.map((t) => t.id), ["M0-01", "M0-02", "M0-03"]);
  const t = s.tasks[0];
  assertEquals(t?.lane, "content");
  assertEquals(t?.state, "doing");
  assertEquals(t?.run, "001");
  assertEquals(t?.phase, "red");
  assertEquals(t?.wait, "owner");
  assertEquals(t?.checkpointAgeMin, 5);
  assertEquals(s.tasks[1]?.checkpointAgeMin, null);

  await submit(root, "M0-01", r.runId, r.token, "c", "b");
  await accept(root, "M0-01", r.runId, "sha");
  assertEquals((await sweep(root)).tasks.map((x) => x.id), ["M0-02", "M0-03"]);
});

Deno.test("coord sweep: next only for lanes with no doing task", async () => {
  const root = await freshRoot();
  await seed(root);
  await addTask(root, { id: "M0-04", lane: "content", deps: [] }, "x");
  await addTask(root, { id: "M0-05", lane: "docs", deps: [] }, "y");
  await claim(root, "M0-01", "content");
  const s = await sweep(root);
  assertEquals(s.next, { docs: ["M0-05"], ops: [] });
});

Deno.test("coord sweep: text output has every section", async () => {
  const root = await freshRoot();
  await seed(root);
  await claim(root, "M0-01", "content");
  await lease(root, "Cronus281", "ops");
  await ask(root, "Secrets missing", { task: "M0-03" });
  const text = sweepText(await sweep(root));
  for (
    const s of [
      "Pause: running",
      "Leases (1)",
      "Cronus281",
      "Questions (1)",
      "Secrets missing",
      "Stale (0)",
      "Tasks (3)",
      "M0-01",
      "Next",
    ]
  ) assertStringIncludes(text, s);
});

Deno.test("coord sweep: a corrupt checkpoint, lease or question is an error naming the file", async () => {
  const root = await freshRoot();
  await seed(root);
  const r = await claim(root, "M0-01", "content");
  const cp = join(root, "tasks", "M0-01", "runs", r.runId, "checkpoint.json");
  await Deno.writeTextFile(cp, "{");
  await assertRejects(() => sweep(root), CoordError, "checkpoint.json");
  await Deno.writeTextFile(cp, JSON.stringify({ phase: "x", at: 1 }));

  const lr = join(root, "leases", "Cronus281", "001");
  await Deno.mkdir(lr, { recursive: true });
  await Deno.writeTextFile(join(lr, "lease.json"), "{");
  await assertRejects(() => sweep(root), CoordError, "lease.json");
  await Deno.remove(join(root, "leases", "Cronus281"), { recursive: true });

  await Deno.writeTextFile(
    join(root, "questions", "q-20261003T000000-deadbeef.md"),
    "---\nid: [unclosed\n---\n\ntext\n",
  );
  await assertRejects(
    () => sweep(root),
    CoordError,
    "q-20261003T000000-deadbeef.md",
  );
  await Deno.remove(join(root, "questions", "q-20261003T000000-deadbeef.md"));

  const taskMd = join(root, "tasks", "M0-02", "task.md");
  const header = await Deno.readTextFile(taskMd);
  await Deno.writeTextFile(taskMd, "---\nid: [unclosed\n---\n\ntext\n");
  await assertRejects(() => sweep(root), CoordError, "task.md");
  await Deno.writeTextFile(taskMd, header);

  await pause(root, "x");
  const meta = JSON.parse(
    await Deno.readTextFile(join(root, "coord.json")),
  ) as { machineRoot?: string };
  await Deno.writeTextFile(join(meta.machineRoot ?? root, "pause.json"), "{");
  await assertRejects(() => sweep(root), CoordError, "pause.json");
});

Deno.test("coord sweep: while paused an empty next reads (paused), not (none ready)", async () => {
  const root = await freshRoot();
  await seed(root);
  await pause(root, "owner needs the machine");
  const text = sweepText(await sweep(root));
  assertStringIncludes(text, "(paused)");
  assert(!text.includes("(none ready)"));
});

Deno.test("coord sweep: CLI exits non-zero on a read error and prints JSON with --json", async () => {
  const root = await freshRoot();
  await seed(root);
  const run = (...args: string[]) =>
    new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-all", coordScript, ...args],
      env: { CG_COORD_ROOT: root },
    }).output();
  const ok = await run("sweep", "--json");
  assertEquals(ok.code, 0, new TextDecoder().decode(ok.stderr));
  const data = JSON.parse(new TextDecoder().decode(ok.stdout));
  assertEquals(Object.keys(data).sort(), [
    "leases",
    "next",
    "pause",
    "questions",
    "stale",
    "tasks",
  ]);

  const r = await claim(root, "M0-01", "content");
  await Deno.writeTextFile(
    join(root, "tasks", "M0-01", "runs", r.runId, "checkpoint.json"),
    "{",
  );
  const bad = await run("sweep");
  assert(bad.code !== 0);
  assertEquals(new TextDecoder().decode(bad.stdout), "");
  assertStringIncludes(new TextDecoder().decode(bad.stderr), "checkpoint.json");
});
