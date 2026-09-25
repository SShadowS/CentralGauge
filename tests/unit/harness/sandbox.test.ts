import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { __setContextListerForTests } from "../../../src/container/docker-context.ts";
import { ConfigurationError, ContainerError } from "../../../src/errors.ts";
import { exists, validatedDir } from "../../../src/harness/fsutil.ts";
import {
  buildRunArgs,
  EXECUTION_LABEL,
  OWNER_LABEL,
  prepareSecrets,
  publishRedacted,
  realDocker,
  redactText,
  removeSecrets,
  runSandbox,
  sandboxName,
  type SandboxSpec,
  sweepOwnedSandboxes,
  sweepStaleSecrets,
} from "../../../src/harness/sandbox.ts";
import { createCommandMock } from "../../utils/command-mock.ts";
import { FakeDocker, parseRunArgs } from "./fake-docker.ts";

const TOKEN = "tok-0123456789abcdef";
const tmp = async () =>
  await validatedDir(await Deno.realPath(await Deno.makeTempDir()));

async function spec(over: Partial<SandboxSpec> = {}): Promise<SandboxSpec> {
  const q = await tmp();
  return {
    name: sandboxName(
      "11111111-2222-4333-8444-555555555555",
      "aaaaaaaa-0000-4000-8000-000000000001",
    ),
    owner: "HOST1",
    executionId: "aaaaaaaa-0000-4000-8000-000000000001",
    imageId: "sha256:" + "a".repeat(64),
    workspace: "C:\\h\\work space\\ws",
    taskDir: "C:\\h\\task",
    configDir: "C:\\h\\config",
    secretsDir: "C:\\h\\secrets",
    extraMounts: [],
    env: {
      CG_EXECUTION_ID: "aaaaaaaa-0000-4000-8000-000000000001",
      CG_BACKEND_URL: "http://172.23.64.1:3210",
    },
    timeoutMs: 60_000,
    killGraceMs: 50,
    opTimeoutMs: 50,
    maxCaptureBytes: 1024 * 1024,
    rawLog: join(q, "raw.jsonl"),
    stderrLog: join(q, "stderr.txt"),
    ...over,
  };
}

const quick = { sanitizeResources: false, sanitizeOps: false };

Deno.test("buildRunArgs: owned name and labels, Hyper-V isolation, exact mounts, image by id, optional network and command", async () => {
  const s = await spec({
    extraMounts: [{ src: "C:\\h\\sol", dst: "C:\\mock\\variant" }],
  });
  assertEquals(
    s.name,
    "cg-harness-11111111-aaaaaaaa-0000-4000-8000-000000000001",
  );
  const call = parseRunArgs(buildRunArgs(s));
  assertEquals(
    [call.labels.get(OWNER_LABEL), call.labels.get(EXECUTION_LABEL)],
    [
      "HOST1",
      s.executionId,
    ],
  );
  assertEquals([call.isolation, call.network, call.image, call.command], [
    "hyperv",
    null,
    s.imageId,
    [],
  ]);
  assertEquals([...call.mounts.entries()].map(([d, m]) => [d, m.readonly]), [
    ["C:\\workspace", false],
    ["C:\\task", true],
    ["C:\\config", true],
    ["C:\\cg-secrets", true],
    ["C:\\mock\\variant", true],
  ]);
  const n = parseRunArgs(
    buildRunArgs({
      ...s,
      network: "cg-harness-sandbox",
      command: ["powershell", "-File", "C:\\config\\p.ps1"],
    }),
  );
  assertEquals([n.network, n.command.length], ["cg-harness-sandbox", 3]);
  assertThrows(
    () => buildRunArgs({ ...s, workspace: "C:\\a,b" }),
    Error,
    "commas",
  );
  assertThrows(
    () =>
      buildRunArgs({
        ...s,
        imageId: "centralgauge/harness-claude-code:2.1.282",
      }),
    ConfigurationError,
    "immutable",
  );
});

Deno.test("runSandbox: a secret in argv or env is refused before docker run", async () => {
  const d = new FakeDocker();
  await assertRejects(
    async () => runSandbox(d, await spec({ env: { LEAK: TOKEN } }), [TOKEN]),
    ConfigurationError,
    "secret",
  );
  await assertRejects(
    async () =>
      runSandbox(d, await spec({ workspace: `C:\\${TOKEN}` }), [TOKEN]),
    ConfigurationError,
  );
  assertEquals(d.runs, []);
});

Deno.test("runSandbox: every run is Hyper-V isolated; secrets reach it only through the read-only mount", async () => {
  const d = new FakeDocker();
  const s = await spec();
  await runSandbox(d, s, [TOKEN]);
  const call = d.runs[0]!;
  assertEquals(call.isolation, "hyperv");
  assertEquals(call.mounts.get("C:\\cg-secrets"), {
    src: s.secretsDir,
    readonly: true,
  });
  assert(!call.args.some((a) => a.includes(TOKEN)));
});

Deno.test("runSandbox: timeout kills; complete lines captured; termination confirmed", async () => {
  const d = new FakeDocker();
  d.behavior = async (_c, io) => {
    await io.stdout('{"type":"a"}');
    await io.stdout('{"type":"b"}');
    await io.killed;
    return 137;
  };
  const s = await spec({ timeoutMs: 30 });
  const r = await runSandbox(d, s, []);
  assertEquals(
    [r.timedOut, r.exitCode, r.started, r.confirmedGone, r.cleanup],
    [
      true,
      137,
      true,
      true,
      "ok",
    ],
  );
  assertEquals(d.kills, [s.name]);
  assertEquals(
    (await Deno.readTextFile(s.rawLog)).trim().split("\n").map((l) =>
      JSON.parse(l).type
    ),
    ["a", "b"],
  );
});

Deno.test({
  name:
    "runSandbox: a failed kill falls through to rm -f; a wedged run is bounded and not confirmed gone",
  ...quick,
}, async () => {
  const d = new FakeDocker();
  d.killFails = true;
  d.behavior = async (_c, io) => {
    await io.killed;
    return 137;
  };
  const s = await spec({ timeoutMs: 20, killGraceMs: 5_000 });
  const t1 = performance.now();
  const r = await runSandbox(d, s, []);
  assertEquals([r.timedOut, r.confirmedGone], [true, true]);
  // rm -f follows the failed kill at once, not after the kill grace.
  assert(performance.now() - t1 < 1_000);
  assertEquals([d.kills, d.removed], [[s.name], [s.name]]);
  const w = new FakeDocker();
  w.wedged = true;
  const t0 = performance.now();
  const rw = await runSandbox(
    w,
    await spec({ timeoutMs: 20, killGraceMs: 30 }),
    [],
  );
  assert(performance.now() - t0 < 2_000);
  assertEquals([rw.exitCode, rw.confirmedGone], [null, false]);
  assertStringIncludes(rw.cleanup, "did not stop");
  assertEquals(w.lastCapture?.abort?.aborted, true);
});

Deno.test({
  name:
    "runSandbox: kill and rm that never answer are bounded; termination is not confirmed",
  ...quick,
}, async () => {
  const d = new FakeDocker();
  d.killHangs = true;
  d.rmHangs = true;
  d.behavior = async (_c, io) => {
    await io.killed;
    return 137;
  };
  const t0 = performance.now();
  const r = await runSandbox(
    d,
    await spec({ timeoutMs: 20, killGraceMs: 30, opTimeoutMs: 30 }),
    [],
  );
  assert(performance.now() - t0 < 2_000);
  assertEquals(r.confirmedGone, false);
  assertStringIncludes(r.cleanup, "timed out");
});

Deno.test("runSandbox: operator interrupt stops the sandbox at once and is recorded", async () => {
  const d = new FakeDocker();
  d.behavior = async (_c, io) => {
    await io.killed;
    return 137;
  };
  const stop = new AbortController();
  const p = runSandbox(d, await spec(), [], stop.signal);
  setTimeout(() => stop.abort(), 10);
  const r = await p;
  assertEquals([r.interrupted, r.timedOut, r.confirmedGone], [
    true,
    false,
    true,
  ]);
});

Deno.test("runSandbox: an interrupt before the start never starts the sandbox", async () => {
  const d = new FakeDocker();
  const stop = new AbortController();
  stop.abort();
  const r = await runSandbox(d, await spec(), [], stop.signal);
  assertEquals(d.runs, []);
  assertEquals([r.interrupted, r.started, r.confirmedGone, r.exitCode], [
    true,
    false,
    true,
    null,
  ]);
});

Deno.test("runSandbox: capture overflow kills the sandbox; the log stays bounded", async () => {
  const d = new FakeDocker();
  d.behavior = async (_c, io) => {
    for (let i = 0; i < 1000; i++) await io.stdout("x".repeat(100));
    await io.killed;
    return 137;
  };
  const s = await spec({ maxCaptureBytes: 1000 });
  const r = await runSandbox(d, s, []);
  assertEquals([r.overflow, r.confirmedGone], [true, true]);
  assert((await Deno.stat(s.rawLog)).size <= 1000);
});

Deno.test("runSandbox: a failure before the spawn is not started; after the spawn it is started and the container is still removed", async () => {
  const d = new FakeDocker();
  d.runError = new Error("open raw.jsonl: access denied");
  const s = await spec();
  const r = await runSandbox(d, s, []);
  assertEquals([r.started, r.confirmedGone, r.cleanup], [false, true, "ok"]);
  assertStringIncludes(r.startError!, "access denied");
  const d2 = new FakeDocker();
  d2.failAfterStart = new Error("pipe broken");
  const s2 = await spec();
  const r2 = await runSandbox(d2, s2, []);
  assertEquals([r2.started, r2.startError], [true, "pipe broken"]);
  assertEquals(d2.removed, [s2.name]);
  assertEquals([r2.confirmedGone, r2.cleanup], [true, "ok"]);
});

Deno.test("runSandbox: rm failure or a lingering container means not confirmed gone", async () => {
  const d = new FakeDocker();
  const s = await spec();
  d.rmFails.add(s.name);
  const r = await runSandbox(d, s, []);
  assertEquals(r.confirmedGone, false);
  assertStringIncludes(r.cleanup, "docker rm -f");
  assertStringIncludes(r.cleanup, s.name);
  const d2 = new FakeDocker();
  const s2 = await spec();
  d2.lingering.add(s2.name);
  const r2 = await runSandbox(d2, s2, []);
  assertEquals(r2.confirmedGone, false);
  assertStringIncludes(r2.cleanup, s2.name);
});

Deno.test("realDocker.run: a capture file that cannot be opened fails before any spawn and leaks no handle", async () => {
  const q = await tmp();
  const c = (o: string, e: string) => ({
    stdoutPath: o,
    stderrPath: e,
    maxBytes: 1024,
    onStarted: () => {},
    onOverflow: () => {},
  });
  await assertRejects(() =>
    realDocker().run(
      ["run"],
      c(join(q, "missing-dir", "raw.jsonl"), join(q, "err.txt")),
    )
  );
  await assertRejects(() =>
    realDocker().run(
      ["run"],
      c(join(q, "raw.jsonl"), join(q, "missing-dir", "err.txt")),
    )
  );
  await Deno.remove(join(q, "raw.jsonl")); // succeeds only if the handle was closed
});

/** A spawnable fake Deno.Command whose output streams the test drives. */
function installSpawnFake(
  stdout: ReadableStream<Uint8Array>,
  stderr: ReadableStream<Uint8Array>,
  status: Promise<{ code: number }>,
  kills: string[] = [],
  seen: Deno.CommandOptions[] = [],
): () => void {
  const original = Object.getOwnPropertyDescriptor(Deno, "Command")!;
  __setContextListerForTests(() => ["desktop-windows"]);
  const Fake = function (_cmd: string, opts: Deno.CommandOptions) {
    seen.push(opts);
    return {
      spawn: () => ({
        stdout,
        stderr,
        status,
        kill: () => kills.push("kill"),
      }),
    };
  };
  Object.defineProperty(Deno, "Command", { value: Fake, configurable: true });
  return () => {
    Object.defineProperty(Deno, "Command", original);
    __setContextListerForTests(undefined);
  };
}

Deno.test({
  name:
    "realDocker.run: settles only after both captures are closed, even when one fails",
  ...quick,
}, async () => {
  const q = await tmp();
  let closeErr!: () => void;
  const stderr = new ReadableStream<Uint8Array>({
    start(ctl) {
      closeErr = () => ctl.close();
    },
  });
  const stdout = new ReadableStream<Uint8Array>({
    start(ctl) {
      ctl.error(new Error("stdout pipe broken"));
    },
  });
  const restore = installSpawnFake(
    stdout,
    stderr,
    Promise.resolve({ code: 1 }),
  );
  try {
    let settled = false;
    const p = realDocker().run(["run"], {
      stdoutPath: join(q, "raw.jsonl"),
      stderrPath: join(q, "err.txt"),
      maxBytes: 1024,
      onStarted: () => {},
      onOverflow: () => {},
    }).then(() => null, (e: Error) => e).finally(() => (settled = true));
    await new Promise((r) => setTimeout(r, 30));
    assertEquals(settled, false);
    closeErr();
    assertStringIncludes(String((await p)?.message), "stdout pipe broken");
  } finally {
    restore();
  }
});

Deno.test("realDocker.run: after an overflow no later bytes are captured", async () => {
  const q = await tmp();
  const chunk = (n: number) => new Uint8Array(n).fill(0x78);
  const stdout = new ReadableStream<Uint8Array>({
    start(ctl) {
      for (const n of [600, 600, 10]) ctl.enqueue(chunk(n));
      ctl.close();
    },
  });
  const stderr = new ReadableStream<Uint8Array>({
    start(ctl) {
      ctl.close();
    },
  });
  const restore = installSpawnFake(
    stdout,
    stderr,
    Promise.resolve({ code: 0 }),
  );
  try {
    let overflows = 0;
    const code = await realDocker().run(["run"], {
      stdoutPath: join(q, "raw.jsonl"),
      stderrPath: join(q, "err.txt"),
      maxBytes: 1000,
      onStarted: () => {},
      onOverflow: () => overflows++,
    });
    assertEquals([code, overflows], [0, 1]);
    assertEquals((await Deno.stat(join(q, "raw.jsonl"))).size, 600);
  } finally {
    restore();
  }
});

Deno.test("realDocker.listOwned: label filter, prefix filter, context pinned", async () => {
  if (Deno.build.os === "windows") {
    __setContextListerForTests(() => ["desktop-windows", "default"]);
  }
  const mock = createCommandMock();
  mock.mockCommandOnce({ command: "docker", argsContain: ["ps", "-a"] }, {
    code: 0,
    stdout:
      "cg-harness-aaaaaaaa-11111111\ncg-harnessX-lookalike\nother-cg-harness-1\n\n",
    stderr: "",
  });
  mock.install();
  try {
    assertEquals(await realDocker().listOwned("HOST1"), [
      "cg-harness-aaaaaaaa-11111111",
    ]);
    const call = mock.getCallsFor("docker")[0]!;
    assert(call.args.includes(`label=${OWNER_LABEL}=HOST1`));
    if (Deno.build.os === "windows") {
      assertEquals(call.options?.env?.["DOCKER_CONTEXT"], "desktop-windows");
    }
  } finally {
    mock.restore();
    __setContextListerForTests(undefined);
  }
});

Deno.test({
  name:
    "sweep removes only owned containers, is bounded, and fails loudly when one survives",
  ...quick,
}, async () => {
  const d = new FakeDocker();
  d.owned = ["cg-harness-aaaaaaaa-11111111", "cg-harness-bbbbbbbb-22222222"];
  assertEquals(await sweepOwnedSandboxes(d, "HOST1", 50), d.owned);
  d.rmFails.add("cg-harness-bbbbbbbb-22222222");
  await assertRejects(
    () => sweepOwnedSandboxes(d, "HOST1", 50),
    ContainerError,
    "bbbbbbbb",
  );
  const h = new FakeDocker();
  h.owned = ["cg-harness-cccccccc-33333333"];
  h.rmHangs = true;
  await assertRejects(
    () => sweepOwnedSandboxes(h, "HOST1", 30),
    ContainerError,
    "timed out",
  );
});

Deno.test("sweep never touches a labeled container without the prefix; a survivor after rm fails loudly", async () => {
  const d = new FakeDocker();
  d.owned = ["cg-harness-aaaaaaaa-11111111", "someone-elses-container"];
  assertEquals(await sweepOwnedSandboxes(d, "HOST1", 50), [
    "cg-harness-aaaaaaaa-11111111",
  ]);
  assertEquals(d.removed, ["cg-harness-aaaaaaaa-11111111"]);
  const l = new FakeDocker();
  l.owned = ["cg-harness-dddddddd-44444444"];
  l.lingering.add("cg-harness-dddddddd-44444444");
  await assertRejects(
    () => sweepOwnedSandboxes(l, "HOST1", 50),
    ContainerError,
    "cg-harness-dddddddd-44444444",
  );
});

Deno.test("prepareSecrets: declared files plus the token; short or missing secrets are refused", async () => {
  const src = await tmp();
  await Deno.writeTextFile(
    join(src, "claude-oauth-token"),
    "oauth-0123456789abcdef\n",
  );
  await Deno.writeTextFile(join(src, "short"), "abc");
  const root = await tmp();
  const custody = {
    privateRoot: root,
    owner: "HOST1",
    ...fakeIcacls(USER),
  };
  const s = await prepareSecrets(src, ["claude-oauth-token"], TOKEN, custody);
  assertEquals([...Deno.readDirSync(s.dir)].map((e) => e.name).sort(), [
    "backend-token",
    "claude-oauth-token",
  ]);
  await assertRejects(
    () => prepareSecrets(src, ["short"], TOKEN, custody),
    ConfigurationError,
    "16",
  );
  await assertRejects(
    () => prepareSecrets(src, ["missing"], TOKEN, custody),
    ConfigurationError,
    "missing",
  );
  await assertRejects(
    () => prepareSecrets(src, ["..\\x"], TOKEN, custody),
    ConfigurationError,
  );
  // Custody lives under the private root; refused calls leave nothing behind.
  assert(s.dir.startsWith(join(root, "secrets", "cg-harness-secrets-HOST1.")));
  assertEquals(
    [...Deno.readDirSync(join(root, "secrets"))].map((e) =>
      join(root, "secrets", e.name)
    ),
    [s.dir],
  );
  await removeSecrets(s.dir);
  assert(!await exists(s.dir));
});

Deno.test("redaction is longest-first and complete; publishing is byte-safe and reads the quarantine", async () => {
  const secrets = [
    { name: "short-prefix", value: "abcdefghijklmnop" },
    { name: "long", value: "abcdefghijklmnopqrstuvwx" },
  ];
  const r = redactText(
    "x abcdefghijklmnopqrstuvwx y abcdefghijklmnop",
    secrets,
  );
  assertEquals([r.text, r.count], [
    "x [REDACTED:long] y [REDACTED:short-prefix]",
    2,
  ]);
  const q = await tmp();
  const pub = await tmp();
  const u16 = new Uint8Array(
    new Uint16Array([...TOKEN].map((c) => c.charCodeAt(0))).buffer,
  );
  await Deno.writeFile(
    join(q, "raw.jsonl"),
    new Uint8Array([
      ...new TextEncoder().encode(`{"t":"${TOKEN}"}\n`),
      ...u16,
    ]),
  );
  const n = await publishRedacted(
    [{ src: join(q, "raw.jsonl"), dest: join(pub, "raw.jsonl") }, {
      src: join(q, "none.txt"),
      dest: join(pub, "none.txt"),
    }],
    [{ name: "backend-token", value: TOKEN }],
  );
  assertEquals(n, 2);
  assert(!(await Deno.readTextFile(join(pub, "raw.jsonl"))).includes(TOKEN));
  assert(!await exists(join(pub, "none.txt")));
});

Deno.test("publishing redacts a secret cut off at the end of a capped or killed capture", async () => {
  const q = await tmp();
  const pub = await tmp();
  const cut = TOKEN.slice(0, 11);
  const u16 = (s: string) =>
    new Uint8Array(new Uint16Array([...s].map((c) => c.charCodeAt(0))).buffer);
  await Deno.writeTextFile(join(q, "a.jsonl"), `{"t":"ok"}\n{"t":"${cut}`);
  await Deno.writeFile(join(q, "b.txt"), u16(`line\r\nkey=${cut}`));
  const n = await publishRedacted(
    [
      { src: join(q, "a.jsonl"), dest: join(pub, "a.jsonl") },
      { src: join(q, "b.txt"), dest: join(pub, "b.txt") },
    ],
    [{ name: "backend-token", value: TOKEN }],
  );
  assertEquals(n, 2);
  assertEquals(
    await Deno.readTextFile(join(pub, "a.jsonl")),
    `{"t":"ok"}\n{"t":"[REDACTED:backend-token]`,
  );
  const b = await Deno.readFile(join(pub, "b.txt"));
  assert(!new TextDecoder("utf-16le").decode(b).includes(cut));
});

Deno.test("buildRunArgs: env order is by code unit, not locale", async () => {
  const call = parseRunArgs(
    buildRunArgs(await spec({ env: { a: "1", B: "2", _c: "3" } })),
  );
  assertEquals([...call.env.keys()], ["B", "_c", "a"]);
});

Deno.test("runSandbox: a name held by another execution is never killed or removed", async () => {
  const d = new FakeDocker();
  const s = await spec({ timeoutMs: 20 });
  d.containers.set(s.name, "bbbbbbbb-0000-4000-8000-000000000002");
  const r = await runSandbox(d, s, []);
  assertEquals([r.exitCode, d.kills, d.removed], [125, [], []]);
  assertEquals(
    d.containers.get(s.name),
    "bbbbbbbb-0000-4000-8000-000000000002",
  );
  assertStringIncludes(r.cleanup, "bbbbbbbb-0000-4000-8000-000000000002");
});

Deno.test("realDocker.state: reads the execution label; absent is null", async () => {
  if (Deno.build.os === "windows") {
    __setContextListerForTests(() => ["desktop-windows"]);
  }
  const mock = createCommandMock();
  mock.mockCommandOnce({ command: "docker", argsContain: ["inspect"] }, {
    code: 0,
    stdout: "true|aaaaaaaa-0000-4000-8000-000000000001\n",
    stderr: "",
  });
  mock.mockCommandOnce({ command: "docker", argsContain: ["inspect"] }, {
    code: 1,
    stdout: "",
    stderr: "Error: No such object: x",
  });
  mock.install();
  try {
    assertEquals(await realDocker().state("x"), {
      running: true,
      execution: "aaaaaaaa-0000-4000-8000-000000000001",
    });
    assertEquals(await realDocker().state("x"), null);
    assertStringIncludes(
      mock.getCallsFor("docker")[0]!.args.join(" "),
      EXECUTION_LABEL,
    );
  } finally {
    mock.restore();
    __setContextListerForTests(undefined);
  }
});

Deno.test({
  name:
    "realDocker.run: an abort kills the client, cancels both pipes and settles within the bound",
  ...quick,
}, async () => {
  const q = await tmp();
  const cancelled: string[] = [];
  // Sources that never end, and whose cancel never completes (worst case).
  const hung = (tag: string) =>
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled.push(tag);
        return new Promise(() => {});
      },
    });
  const kills: string[] = [];
  const restore = installSpawnFake(
    hung("out"),
    hung("err"),
    new Promise(() => {}),
    kills,
  );
  try {
    const abort = new AbortController();
    const t0 = performance.now();
    const p = realDocker(50).run(["run", "--name", "cg-harness-x"], {
      stdoutPath: join(q, "raw.jsonl"),
      stderrPath: join(q, "err.txt"),
      maxBytes: 1024,
      onStarted: () => {},
      onOverflow: () => {},
      abort: abort.signal,
    }).then(() => null, (e: Error) => e);
    setTimeout(() => abort.abort(), 10);
    const err = await p;
    assert(performance.now() - t0 < 1_000);
    assertStringIncludes(String(err?.message), "cg-harness-x");
    assertEquals([kills, cancelled.sort()], [["kill"], ["err", "out"]]);
    await Deno.remove(join(q, "raw.jsonl")); // closed
    await Deno.remove(join(q, "err.txt"));
  } finally {
    restore();
  }
});

/** Replace Deno.remove for one test (getter-only in Deno 2.8, like Command). */
function stubRemove(fn: typeof Deno.remove): () => void {
  const original = Object.getOwnPropertyDescriptor(Deno, "remove")!;
  Object.defineProperty(Deno, "remove", { value: fn, configurable: true });
  return () => Object.defineProperty(Deno, "remove", original);
}

Deno.test("removeSecrets: a failed removal is reported with the dir; prepareSecrets reports a failed cleanup", async () => {
  const root = await tmp();
  const src = await tmp();
  await Deno.writeTextFile(join(src, "short"), "abc");
  const restore = stubRemove(() =>
    Promise.reject(new Deno.errors.Busy("used by another process"))
  );
  try {
    await assertRejects(
      () => removeSecrets(join(root, "cg-harness-secrets-HOST1.x")),
      Error,
      "cg-harness-secrets-HOST1.x",
    );
    const err = await assertRejects(() =>
      prepareSecrets(src, ["short"], TOKEN, {
        privateRoot: root,
        owner: "HOST1",
        ...fakeIcacls(USER),
      })
    );
    assertStringIncludes((err as Error).message, "16");
    assertStringIncludes((err as Error).message, join(root, "secrets"));
  } finally {
    restore();
  }
  await removeSecrets(join(root, "no-such-dir")); // already gone is fine
});

Deno.test("sweepStaleSecrets: removes only this owner's custody dirs", async () => {
  const root = await tmp();
  const base = join(root, "secrets");
  for (
    const n of [
      "cg-harness-secrets-HOST1.a",
      "cg-harness-secrets-HOST1.b",
      "cg-harness-secrets-HOST12.c",
      "cg-harness-secrets-HOST2.d",
      "unrelated",
    ]
  ) {
    await Deno.mkdir(join(base, n), { recursive: true });
    await Deno.writeTextFile(join(base, n, "backend-token"), TOKEN);
  }
  assertEquals((await sweepStaleSecrets(root, "HOST1")).sort(), [
    "cg-harness-secrets-HOST1.a",
    "cg-harness-secrets-HOST1.b",
  ]);
  assertEquals([...Deno.readDirSync(base)].map((e) => e.name).sort(), [
    "cg-harness-secrets-HOST12.c",
    "cg-harness-secrets-HOST2.d",
    "unrelated",
  ]);
  assertEquals(await sweepStaleSecrets(await tmp(), "HOST1"), []);
});

Deno.test({
  name:
    "runSandbox: a run still pending before its start is not confirmed gone until it settles",
  ...quick,
}, async () => {
  const d = new FakeDocker();
  d.startGate = new Promise(() => {});
  const t0 = performance.now();
  const r = await runSandbox(
    d,
    await spec({ timeoutMs: 20, killGraceMs: 20, opTimeoutMs: 20 }),
    [],
  );
  assert(performance.now() - t0 < 2_000);
  assertEquals([r.started, r.confirmedGone], [false, false]);
  assertStringIncludes(r.cleanup, "did not stop");
  // Settling inside the bounded wait confirms it, and the late container is removed.
  const l = new FakeDocker();
  let open!: () => void;
  l.startGate = new Promise((res) => (open = res));
  const s = await spec({ timeoutMs: 20, killGraceMs: 50 });
  setTimeout(() => open(), 40);
  const rl = await runSandbox(l, s, []);
  assertEquals([rl.started, rl.confirmedGone, l.removed], [true, true, [
    s.name,
  ]]);
});

const DOCKER_ENV_KEYS = [
  "PATH",
  "SystemRoot",
  "windir",
  "ComSpec",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
];

Deno.test("realDocker: the docker CLI gets a cleared env holding only the allowlist", async () => {
  const leak = "leak-0123456789abcdef-secret";
  Deno.env.set("CG_TEST_SANDBOX_LEAK", leak);
  const check = (o: Deno.CommandOptions | undefined) => {
    assertEquals(o?.clearEnv, true);
    const env = o?.env ?? {};
    assert(!Object.values(env).includes(leak));
    assert(Object.keys(env).every((k) => DOCKER_ENV_KEYS.includes(k)));
    assertEquals(env["PATH"], Deno.env.get("PATH"));
    if (Deno.build.os === "windows") {
      assertEquals(env["DOCKER_CONTEXT"], "desktop-windows");
    }
  };
  __setContextListerForTests(() => ["desktop-windows"]);
  const mock = createCommandMock();
  mock.mockCommand({ command: "docker" }, { code: 0, stdout: "", stderr: "" });
  mock.install();
  try {
    await realDocker().kill("x");
    check(mock.getCallsFor("docker")[0]!.options);
  } finally {
    mock.restore();
  }
  const q = await tmp();
  const done = () =>
    new ReadableStream<Uint8Array>({
      start(ctl) {
        ctl.close();
      },
    });
  const seen: Deno.CommandOptions[] = [];
  const restore = installSpawnFake(
    done(),
    done(),
    Promise.resolve({ code: 0 }),
    [],
    seen,
  );
  try {
    await realDocker().run(["run"], {
      stdoutPath: join(q, "raw.jsonl"),
      stderrPath: join(q, "err.txt"),
      maxBytes: 1024,
      onStarted: () => {},
      onOverflow: () => {},
    });
    check(seen[0]);
  } finally {
    restore();
    Deno.env.delete("CG_TEST_SANDBOX_LEAK");
  }
});

const USER = "HOST\\runner";
const aclListing = (dir: string, entries: string[], failed = 0) =>
  `${dir} ${entries[0]}\n` +
  entries.slice(1).map((e) => `${" ".repeat(dir.length + 1)}${e}\n`).join("") +
  `\nSuccessfully processed ${
    1 - failed
  } files; Failed processing ${failed} files\r\n`;
const GOOD = ["NT AUTHORITY\\SYSTEM:(OI)(CI)(F)", `${USER}:(OI)(CI)(F)`];

/** A recording icacls runner; `verify` shapes the listing (default: exactly the grant). */
function fakeIcacls(
  user: string,
  verify: (dir: string) => string = (dir) => aclListing(dir, GOOD),
  grantCode = 0,
) {
  const calls: string[][] = [];
  const icacls = (args: string[]) => {
    calls.push(args);
    return Promise.resolve(
      args.length === 1
        ? { code: 0, stdout: verify(args[0]!), stderr: "" }
        : { code: grantCode, stdout: "", stderr: grantCode ? "denied" : "" },
    );
  };
  return { icacls, user, calls };
}

Deno.test({
  name:
    "prepareSecrets: the custody dir ACL is granted then verified before any secret is written",
  ignore: Deno.build.os !== "windows",
}, async () => {
  const root = await tmp();
  const src = await tmp();
  await Deno.writeTextFile(join(src, "claude-oauth-token"), TOKEN + "x");
  const acl = fakeIcacls(USER);
  const s = await prepareSecrets(src, ["claude-oauth-token"], TOKEN, {
    privateRoot: root,
    owner: "HOST1",
    ...acl,
  });
  assertEquals(acl.calls, [
    [
      s.dir,
      "/inheritance:r",
      "/grant:r",
      `${USER}:(OI)(CI)F`,
      "SYSTEM:(OI)(CI)F",
    ],
    [s.dir],
  ]);
  await removeSecrets(s.dir);
});

Deno.test({
  name:
    "prepareSecrets: a failed grant or any unexpected ACL entry refuses with no secret written",
  ignore: Deno.build.os !== "windows",
}, async () => {
  const src = await tmp();
  await Deno.writeTextFile(join(src, "claude-oauth-token"), TOKEN + "x");
  const cases: [string, ReturnType<typeof fakeIcacls>][] = [
    ["grant fails", fakeIcacls(USER, undefined, 5)],
    [
      "inherited entry",
      fakeIcacls(
        USER,
        (d) =>
          aclListing(d, [...GOOD, "BUILTIN\\Administrators:(I)(OI)(CI)(F)"]),
      ),
    ],
    [
      "extra principal",
      fakeIcacls(
        USER,
        (d) => aclListing(d, [...GOOD, "Everyone:(OI)(CI)(R)"]),
      ),
    ],
    [
      "inherited grant",
      fakeIcacls(USER, (d) =>
        aclListing(d, [
          "NT AUTHORITY\\SYSTEM:(I)(OI)(CI)(F)",
          `${USER}:(OI)(CI)(F)`,
        ])),
    ],
    [
      "missing SYSTEM",
      fakeIcacls(USER, (d) => aclListing(d, [`${USER}:(OI)(CI)(F)`])),
    ],
    [
      "other user",
      fakeIcacls(USER, (d) =>
        aclListing(d, [
          "NT AUTHORITY\\SYSTEM:(OI)(CI)(F)",
          "HOST\\other:(OI)(CI)(F)",
        ])),
    ],
    [
      "weaker right",
      fakeIcacls(USER, (d) =>
        aclListing(d, [
          "NT AUTHORITY\\SYSTEM:(OI)(CI)(F)",
          `${USER}:(OI)(CI)(M)`,
        ])),
    ],
    ["failed listing", fakeIcacls(USER, (d) => aclListing(d, GOOD, 1))],
    ["other path", fakeIcacls(USER, () => aclListing("C:\\elsewhere", GOOD))],
  ];
  for (const [what, acl] of cases) {
    const root = await tmp();
    await assertRejects(
      () =>
        prepareSecrets(src, ["claude-oauth-token"], TOKEN, {
          privateRoot: root,
          owner: "HOST1",
          ...acl,
        }),
      ConfigurationError,
      "ACL",
      what,
    );
    assertEquals(
      [...Deno.readDirSync(join(root, "secrets"))].length,
      0,
      `${what}: nothing may stay behind`,
    );
    assertEquals(acl.calls.length, what === "grant fails" ? 1 : 2, what);
  }
});

Deno.test({
  name: "prepareSecrets: POSIX custody is 0700 with 0600 files",
  ignore: Deno.build.os === "windows",
}, async () => {
  const root = await tmp();
  const src = await tmp();
  await Deno.writeTextFile(join(src, "claude-oauth-token"), TOKEN + "x");
  const s = await prepareSecrets(src, ["claude-oauth-token"], TOKEN, {
    privateRoot: root,
    owner: "HOST1",
  });
  assertEquals((await Deno.stat(s.dir)).mode! & 0o777, 0o700);
  for (const f of ["claude-oauth-token", "backend-token"]) {
    assertEquals((await Deno.stat(join(s.dir, f))).mode! & 0o777, 0o600);
  }
  await removeSecrets(s.dir);
});
