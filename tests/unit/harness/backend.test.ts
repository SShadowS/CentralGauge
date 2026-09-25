import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import {
  ConfigurationError,
  ContainerError,
  ValidationError,
} from "../../../src/errors.ts";
import {
  Backend,
  type BackendGrant,
  type BackendOps,
  defaultBackendOps,
  readHostLog,
  resolveBackendHost,
  timingSafeEqual,
} from "../../../src/harness/backend.ts";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { exists } from "../../../src/harness/fsutil.ts";
import { FakeDocker } from "./fake-docker.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import { createCommandMock } from "../../utils/command-mock.ts";
import { FakeBc, result } from "./fake-bc.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const EXEC_A = "00000000-0000-4000-8000-00000000e001";
const EXEC_B = "00000000-0000-4000-8000-00000000e002";
const tmp = async () => await Deno.realPath(await Deno.makeTempDir());
/** The real reparse scan (pwsh, about a second) is covered in fsutil.test.ts; here it is a no-op seam. */
const NO_SCAN = () =>
  Promise.resolve({ ancestors: [], entries: [], seen: 0, capped: false });

interface Setup {
  root: string;
  wsA: string;
  hostLog: string;
  backend: Backend;
  tokenA: string;
  tokenB: string;
  seen: string[];
  clock: { t: number };
  gate: { wait: Promise<void> | null };
  failWith: { err: Error | null };
  docker: FakeDocker;
}

async function workspace(root: string, exec: string): Promise<string> {
  const ws = join(root, "work", exec, "workspace");
  await write(
    ws,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  await write(ws, "Core/src/C.al", `codeunit 70000 "CGR Core"\n{\n}\n`);
  await write(
    ws,
    "Test/app.json",
    appJson(IDS.test, "CGR Test", [80000, 84999], [{
      id: IDS.core,
      name: "CGR Core",
    }]),
  );
  await write(
    ws,
    "Test/src/T.al",
    `codeunit 80010 "T"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure A()\n    begin\n    end;\n}\n`,
  );
  return ws;
}

async function grantFor(
  b: Backend,
  root: string,
  exec: string,
  hostLog: string,
): Promise<string> {
  const ws = await workspace(root, exec);
  const g: BackendGrant = {
    executionId: exec,
    sandbox: `cg-harness-test-${exec.slice(-4)}`,
    workspace: ws,
    pristine: ws,
    trusted: await readAppGraph(ws),
    symbols: [{
      app_id: IDS.assert,
      name: "Library Assert",
      publisher: "Microsoft",
      version: "28.0.0.0",
      file: "a.app",
      sha256: "0".repeat(64),
    }],
    lock: { store: root, packages: [] },
    deploy: { ledgerRoot: root, trustedRoots: [ws] },
    hostLog,
  };
  return await b.grant(g, 60_000);
}

async function setup(): Promise<Setup> {
  const root = await tmp();
  const seen: string[] = [];
  const gate: Setup["gate"] = { wait: null };
  const failWith: Setup["failWith"] = { err: null };
  const ops: BackendOps = {
    async compile(ctx, apps) {
      seen.push(ctx.snapshot);
      if (gate.wait) {
        await Promise.race([
          gate.wait,
          new Promise((_, rej) =>
            ctx.signal.addEventListener("abort", () => rej(ctx.signal.reason))
          ),
        ]);
      }
      if (failWith.err) throw failWith.err;
      return {
        body: {
          apps: apps.map((a) => ({ app: a, ok: true, diagnostics: [] })),
        },
        log: {
          outcome: "ok",
          apps_compiled: apps,
          per_app_compiles: apps.length,
          spans: { compile_ms: 1 },
        },
      };
    },
    test: () =>
      Promise.resolve({ body: { tests: [] }, log: { outcome: "ok" } }),
  };
  const clock = { t: 1_000 };
  const hostLog = join(root, "host-log.jsonl");
  const docker = new FakeDocker();
  const backend = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(root, "work")],
    workRoot: join(root, "backend"),
    ops,
    allowedHosts: ["127.0.0.1"],
    now: () => clock.t,
    docker,
    opTimeoutMs: 100,
    bodyTimeoutMs: 100,
    revokeGraceMs: 50,
  });
  await Deno.mkdir(join(root, "work"), { recursive: true });
  const tokenA = await grantFor(backend, root, EXEC_A, hostLog);
  const tokenB = await grantFor(
    backend,
    root,
    EXEC_B,
    join(root, "host-log-b.jsonl"),
  );
  return {
    root,
    wsA: join(root, "work", EXEC_A, "workspace"),
    hostLog,
    backend,
    tokenA,
    tokenB,
    seen,
    clock,
    gate,
    failWith,
    docker,
  };
}

function req(
  path: string,
  token: string | null,
  body: BodyInit | null,
  exec = EXEC_A,
  method = "POST",
  headers: Record<string, string> = {},
) {
  const h: Record<string, string> = {
    "x-cg-execution": exec,
    "content-type": "application/json",
    ...headers,
  };
  if (token !== null) h["authorization"] = `Bearer ${token}`;
  return new Request(`http://backend${path}`, {
    method,
    headers: h,
    ...(method === "POST" && body !== null ? { body } : {}),
  });
}

Deno.test("backend: missing, wrong, crossed, expired and revoked tokens are 401", async () => {
  const s = await setup();
  assertEquals(
    (await s.backend.handle(req("/v1/compile", null, "{}"))).status,
    401,
  );
  assertEquals(
    (await s.backend.handle(req("/v1/compile", "nope", "{}"))).status,
    401,
  );
  assertEquals(
    (await s.backend.handle(req("/v1/compile", s.tokenA, "{}", EXEC_B))).status,
    401,
    "A's token on B's grant",
  );
  assertEquals(
    (await s.backend.handle(req("/v1/compile", s.tokenB, "{}", EXEC_B))).status,
    200,
  );
  s.clock.t += 61_000;
  assertEquals(
    (await s.backend.handle(req("/v1/compile", s.tokenA, "{}"))).status,
    401,
  );
  s.clock.t -= 61_000;
  await s.backend.revoke(EXEC_A);
  assertEquals(
    (await s.backend.handle(req("/v1/compile", s.tokenA, "{}"))).status,
    401,
  );
});

Deno.test("backend: only compile, test and symbols exist", async () => {
  const s = await setup();
  for (
    const p of [
      "/v1/oracle",
      "/v1/apps",
      "/v1/workspaces",
      "/v1/compile/../oracle",
    ]
  ) {
    assertEquals(
      (await s.backend.handle(req(p, s.tokenA, "{}"))).status,
      404,
      p,
    );
  }
  assertEquals(
    (await s.backend.handle(req("/v1/compile", s.tokenA, null, EXEC_A, "GET")))
      .status,
    404,
  );
});

Deno.test("backend: malformed JSON, unknown fields, unknown apps and hidden codeunits are 400", async () => {
  const s = await setup();
  const bad = [
    ["/v1/compile", "{"],
    ["/v1/compile", '{"apps":["Core"],"path":"C:\\\\"}'],
    ["/v1/compile", '{"apps":["..\\\\x"]}'],
    ["/v1/compile", '{"apps":["Rental"]}'],
    ["/v1/test", '{"codeunits":[85001]}'],
    ["/v1/test", '{"codeunits":[80013]}'],
    ["/v1/test", '{"codeunits":[84950]}'],
  ];
  for (const [p, body] of bad) {
    assertEquals(
      (await s.backend.handle(req(p!, s.tokenA, body!))).status,
      400,
      body,
    );
  }
  assert((await readHostLog(s.hostLog)).every((l) => l.outcome === "rejected"));
  assertEquals(s.seen, []);
});

Deno.test("backend: a streamed oversize body without length is 413; a truncated stream is 400", async () => {
  const s = await setup();
  let chunks = 0;
  const big = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(new TextEncoder().encode("x".repeat(16_384)));
      if (++chunks > 8) c.close();
    },
  });
  assertEquals(
    (await s.backend.handle(req("/v1/compile", s.tokenA, big))).status,
    413,
  );
  const truncated = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"apps":["Co'));
      c.close();
    },
  });
  assertEquals(
    (await s.backend.handle(req("/v1/compile", s.tokenA, truncated))).status,
    400,
  );
});

Deno.test("backend: a second concurrent request is 429; revoke waits for the in-flight request", async () => {
  const s = await setup();
  let open!: () => void;
  s.gate.wait = new Promise<void>((r) => (open = r));
  const first = s.backend.handle(
    req("/v1/compile", s.tokenA, '{"apps":["Core"]}'),
  );
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(
    (await s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}')))
      .status,
    429,
  );
  let drained: boolean | null = null;
  const rev = s.backend.revoke(EXEC_A).then((d) => (drained = d));
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(drained, null, "revoke must wait for the in-flight request");
  open();
  assertEquals((await first).status, 200);
  await rev;
  assertEquals(drained, true);
});

Deno.test("backend: revoke aborts an operation that outlives the grace and still returns", async () => {
  const s = await setup();
  s.gate.wait = new Promise<void>(() => {}); // never opens: only the abort ends it
  const first = s.backend.handle(
    req("/v1/compile", s.tokenA, '{"apps":["Core"]}'),
  );
  await new Promise((r) => setTimeout(r, 20));
  const t0 = performance.now();
  assertEquals(
    await s.backend.revoke(EXEC_A),
    true,
    "aborted within the second grace",
  );
  assert(performance.now() - t0 < 1_000);
  assertEquals((await first).status, 500);
});

Deno.test("backend: a revoke during the token check never admits the request", async () => {
  const s = await setup();
  const pending = s.backend.handle(
    req("/v1/compile", s.tokenA, '{"apps":["Core"]}'),
  );
  await s.backend.revoke(EXEC_A); // runs while handle awaits the digest
  assertEquals((await pending).status, 401);
  assertEquals(s.seen, []);
});

Deno.test("backend: a stalled body is 408 within the deadline", async () => {
  const s = await setup();
  const stalled = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"apps":'));
    },
  });
  const t0 = performance.now();
  assertEquals(
    (await s.backend.handle(req("/v1/compile", s.tokenA, stalled))).status,
    408,
  );
  assert(performance.now() - t0 < 1_000);
});

Deno.test("backend: a failed unpause is a 503 infra fault and stops the execution through onFault", async () => {
  const root = await tmp();
  await Deno.mkdir(join(root, "work"), { recursive: true });
  const docker = new FakeDocker();
  docker.unpause = () => Promise.resolve(1);
  const faults: string[] = [];
  const ops: BackendOps = {
    compile: () => Promise.resolve({ body: {}, log: { outcome: "ok" } }),
    test: () => Promise.resolve({ body: {}, log: { outcome: "ok" } }),
  };
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(root, "work")],
    workRoot: join(root, "backend"),
    ops,
    allowedHosts: ["127.0.0.1"],
    docker,
    opTimeoutMs: 100,
  });
  const ws = await workspace(root, EXEC_A);
  const tok = await b.grant({
    executionId: EXEC_A,
    sandbox: "cg-harness-x",
    onFault: (r) => faults.push(r),
    workspace: ws,
    pristine: ws,
    trusted: await readAppGraph(ws),
    symbols: [],
    lock: { store: root, packages: [] },
    deploy: { ledgerRoot: root, trustedRoots: [ws] },
    hostLog: join(root, "hl.jsonl"),
  }, 60_000);
  assertEquals(
    (await b.handle(req("/v1/compile", tok, '{"apps":["Core"]}'))).status,
    503,
  );
  assertStringIncludes(faults.join("\n"), "unpause");
});

Deno.test("production ops: a revoke past the grace cancels before any further BC mutation", async () => {
  const s = await setup();
  let releaseCompile!: () => void;
  const gate = new Promise<void>((r) => (releaseCompile = r));
  const bc = new FakeBc(() => result({ A: true }));
  bc.onCompile = () => gate;
  const exec = "00000000-0000-4000-8000-00000000e004";
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend4"),
    ops: defaultBackendOps(new BcLane(bc, ["C1"])),
    allowedHosts: ["127.0.0.1"],
    docker: new FakeDocker(),
    revokeGraceMs: 100,
  });
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl4.jsonl"));
  const pending = b.handle(req("/v1/test", tok, "{}", exec));
  await new Promise((r) => setTimeout(r, 30));
  const revoking = b.revoke(exec);
  await new Promise((r) => setTimeout(r, 150)); // past the first grace: the signal is aborted
  releaseCompile();
  assertEquals(await revoking, true);
  assert([500, 503].includes((await pending).status));
  assertEquals(
    bc.compiles.length,
    1,
    "no further app compiled after the abort",
  );
  assertEquals(bc.syncs, [], "no publish after the abort");
});

Deno.test("production ops: a request past its deadline is refused before any publish", async () => {
  const s = await setup();
  const bc = new FakeBc(() => result({ A: true }));
  bc.onCompile = () => new Promise((r) => setTimeout(r, 80));
  const exec = "00000000-0000-4000-8000-00000000e005";
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend5"),
    ops: defaultBackendOps(new BcLane(bc, ["C1"])),
    allowedHosts: ["127.0.0.1"],
    docker: new FakeDocker(),
    requestDeadlineMs: 40,
  });
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl5.jsonl"));
  assertEquals((await b.handle(req("/v1/test", tok, "{}", exec))).status, 503);
  assertEquals(bc.syncs, []);
});

Deno.test("backend: the snapshot is taken with the sandbox paused; a failed pause is 503 and copies nothing", async () => {
  const s = await setup();
  assertEquals(
    (await s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}')))
      .status,
    200,
  );
  assertEquals(s.docker.paused, [`cg-harness-test-e001`]);
  s.docker.pause = () => Promise.resolve(1);
  assertEquals(
    (await s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}')))
      .status,
    503,
  );
  assertEquals(s.seen.length, 1);
});

Deno.test("backend: compile runs on a snapshot, logs monotonic spans, cleans up", async () => {
  const s = await setup();
  const r = await s.backend.handle(
    req("/v1/compile", s.tokenA, '{"apps":["Core"]}'),
  );
  const body = await r.json();
  assertEquals([r.status, body.request, body.ok], [200, "br_1", true]);
  assert(!s.seen[0]!.startsWith(s.wsA));
  assert(!await exists(s.seen[0]!));
  const [line] = await readHostLog(s.hostLog);
  assertEquals(
    [line!.request, line!.op, line!.outcome, line!.per_app_compiles],
    ["br_1", "compile", "ok", 1],
  );
  for (const k of ["snapshot_ms", "compile_ms", "total_ms"]) {
    assert(line!.spans[k]! >= 0, k);
  }
});

Deno.test("backend: a changed app id is refused before any BC call", async () => {
  const s = await setup();
  await write(
    s.wsA,
    "Core/app.json",
    appJson(
      "11111111-2222-4333-8444-555555555555",
      "CGR Core",
      [70000, 70099],
      [],
    ),
  );
  const r = await s.backend.handle(
    req("/v1/compile", s.tokenA, '{"apps":["Core"]}'),
  );
  const body = await r.json();
  assertEquals([r.status, body.ok], [200, false]);
  assertStringIncludes(body.violations.join("\n"), "Core: id changed");
  assertEquals(s.seen, []);
});

Deno.test("backend: links in the workspace are not followed", async () => {
  const s = await setup();
  const target = await tmp();
  await Deno.writeTextFile(join(target, "secret.txt"), "host");
  await Deno.symlink(target, join(s.wsA, "Core", "hostlink"), {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
  const body = await (await s.backend.handle(
    req("/v1/compile", s.tokenA, '{"apps":["Core"]}'),
  )).json();
  assertEquals(body.ignored_links, ["Core/hostlink"]);
});

Deno.test("backend: an infra fault is a 503 tool error and marks the host log", async () => {
  const s = await setup();
  s.failWith.err = new ContainerError("SOAP timeout", "Cronus281", "test");
  const r = await s.backend.handle(
    req("/v1/compile", s.tokenA, '{"apps":["Core"]}'),
  );
  assertEquals(r.status, 503);
  assertStringIncludes((await r.json()).infra, "SOAP timeout");
  assertEquals((await readHostLog(s.hostLog))[0]!.outcome, "infra");
});

Deno.test("backend: symbols lists the locked packages", async () => {
  const s = await setup();
  const body = await (await s.backend.handle(req("/v1/symbols", s.tokenA, "")))
    .json();
  assertEquals(body.packages, [{
    name: "Library Assert",
    publisher: "Microsoft",
    version: "28.0.0.0",
  }]);
});

Deno.test("backend: grant refuses roots outside the approved roots, link roots and non-canonical spellings", async () => {
  const s = await setup();
  const outside = await tmp();
  const g = (workspace: string): BackendGrant => ({
    executionId: "00000000-0000-4000-8000-00000000e009", // a fresh id: this test is about roots
    sandbox: null,
    workspace,
    pristine: workspace,
    trusted: [],
    symbols: [],
    lock: { store: s.root, packages: [] },
    deploy: { ledgerRoot: s.root, trustedRoots: [workspace] },
    hostLog: s.hostLog,
  });
  await assertRejects(
    () => s.backend.grant(g(outside), 1000),
    ValidationError,
    "approved roots",
  );
  const link = join(s.root, "work", "link");
  await Deno.symlink(outside, link, {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
  await assertRejects(() => s.backend.grant(g(link), 1000), ValidationError);
  if (Deno.build.os === "windows") {
    await assertRejects(
      () => s.backend.grant(g(s.wsA.toUpperCase()), 1000),
      ValidationError,
    );
  }
});

Deno.test("backend: serve refuses wildcard and non-allowed addresses", async () => {
  const s = await setup();
  for (const h of ["0.0.0.0", "::", "", "192.168.1.10"]) {
    assertThrows(() => s.backend.serve(h, 0), ConfigurationError);
  }
});

Deno.test("defaultBackendOps: a fixture-band codeunit is refused before any BC call; visible tests run", async () => {
  const s = await setup();
  const bc = new FakeBc((cu) =>
    cu === 80010 ? result({ A: true }) : result({ X: true })
  );
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend2"),
    ops: defaultBackendOps(new BcLane(bc, ["C1"])),
    allowedHosts: ["127.0.0.1"],
    docker: new FakeDocker(),
  });
  const exec = "00000000-0000-4000-8000-00000000e003";
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl3.jsonl"));
  const ws3 = join(s.root, "work", exec, "workspace");
  await write(
    ws3,
    "Test/src/Fixture.al",
    `codeunit 84950 "F"\n{\n    Subtype = Test;\n}\n`,
  );
  const refused = await (await b.handle(req("/v1/test", tok, "{}", exec)))
    .json();
  assertEquals(refused.ok, false);
  assertStringIncludes(refused.violations.join("\n"), "harness fixture band");
  assertEquals(bc.tests, []);
  await Deno.remove(join(ws3, "Test/src/Fixture.al"));
  const ran = await (await b.handle(req("/v1/test", tok, "{}", exec))).json();
  assertEquals(ran.tests.map((t: { codeunit: number }) => t.codeunit), [80010]);
  assertEquals(bc.tests.map((t) => t.codeunit), [80010]);
});

Deno.test("timingSafeEqual and resolveBackendHost", async () => {
  const a = new Uint8Array([1, 2, 3]);
  assertEquals([
    timingSafeEqual(a, new Uint8Array([1, 2, 3])),
    timingSafeEqual(a, new Uint8Array([1, 2, 4])),
    timingSafeEqual(a, new Uint8Array([1, 2])),
  ], [true, false, false]);
  const mock = createCommandMock();
  mock.mockCommandOnce({
    command: "docker",
    argsContain: ["network", "inspect", "nat"],
  }, { code: 0, stdout: "172.23.64.1\n", stderr: "" });
  mock.mockCommandOnce({
    command: "docker",
    argsContain: ["network", "inspect", "nat"],
  }, { code: 1, stdout: "", stderr: "Error: No such network: nat" });
  mock.install();
  try {
    assertEquals(await resolveBackendHost(), "172.23.64.1");
    await assertRejects(() => resolveBackendHost(), ConfigurationError, "nat");
  } finally {
    mock.restore();
  }
});

Deno.test({
  name:
    "cg-al.ps1: round trip with the token from a file; Stopwatch script time reported",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const s = await setup();
    const server = s.backend.serve("127.0.0.1", 0);
    const secrets = await tmp();
    try {
      const run = async (token: string, ...args: string[]) => {
        await Deno.writeTextFile(join(secrets, "backend-token"), token);
        const out = await new Deno.Command("powershell", {
          args: [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            "harness/images/base/cg-al.ps1",
            ...args,
          ],
          env: {
            CG_BACKEND_URL: server.url,
            CG_EXECUTION_ID: EXEC_A,
            CG_SECRETS_DIR: secrets,
          },
          stdout: "piped",
          stderr: "piped",
        }).output();
        return {
          code: out.code,
          json: JSON.parse(new TextDecoder().decode(out.stdout).trim() || "{}"),
        };
      };
      const ok = await run(s.tokenA, "compile", "Core");
      assertEquals([ok.code, ok.json.result.request], [0, "br_1"]);
      assert(ok.json.client.script_ms >= 0);
      assertEquals(
        (await run("wrong-token-0123456789", "compile", "Core")).code,
        3,
      );
      assertEquals((await run(s.tokenA, "bogus")).code, 64);
    } finally {
      await server.shutdown();
    }
  },
});

Deno.test("backend: a test codeunit that is not a discovered runnable test is 400 before any BC call", async () => {
  const s = await setup();
  await write(
    s.wsA,
    "Test/src/NoTests.al",
    `codeunit 80020 "NoTests"\n{\n    Subtype = Test;\n}\n`,
  );
  await write(s.wsA, "Test/src/Helper.al", `codeunit 80021 "Helper"\n{\n}\n`);
  for (const cu of [80050, 80020, 80021]) {
    const r = await s.backend.handle(
      req("/v1/test", s.tokenA, `{"codeunits":[${cu}]}`),
    );
    assertEquals(r.status, 400, String(cu));
  }
  assertEquals(s.seen, []);
  assertEquals(
    (await s.backend.handle(req("/v1/test", s.tokenA, '{"codeunits":[80010]}')))
      .status,
    200,
  );
});

Deno.test("defaultBackendOps: discovery skips test codeunits without [Test] procedures", async () => {
  const s = await setup();
  const bc = new FakeBc((cu) =>
    cu === 80010 ? result({ A: true }) : result({})
  );
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend6"),
    ops: defaultBackendOps(new BcLane(bc, ["C1"])),
    allowedHosts: ["127.0.0.1"],
    docker: new FakeDocker(),
  });
  const exec = "00000000-0000-4000-8000-00000000e006";
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl6.jsonl"));
  await write(
    join(s.root, "work", exec, "workspace"),
    "Test/src/NoTests.al",
    `codeunit 80020 "NoTests"\n{\n    Subtype = Test;\n}\n`,
  );
  const r = await b.handle(req("/v1/test", tok, "{}", exec));
  assertEquals(r.status, 200);
  assertEquals(bc.tests.map((t) => t.codeunit), [80010]);
});

Deno.test("backend: errors returned to the agent carry no host paths; an oversized workspace is 422", async () => {
  const s = await setup();
  s.failWith.err = new Error(`boom at ${join(s.wsA, "Core", "x.al")}`);
  const r = await s.backend.handle(
    req("/v1/compile", s.tokenA, '{"apps":["Core"]}'),
  );
  assertEquals(r.status, 500);
  const text = await r.text();
  assert(
    !text.includes(s.root) && !text.includes(s.root.replaceAll("\\", "\\\\")),
    text,
  );
  assertStringIncludes(
    (await readHostLog(s.hostLog)).at(-1)!.message!,
    s.wsA,
    "the host log keeps it",
  );
  s.failWith.err = null;
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend7"),
    ops: {
      compile: () => Promise.reject(new Error("unreachable")),
      test: () => Promise.reject(new Error("unreachable")),
    },
    allowedHosts: ["127.0.0.1"],
    copyLimits: {
      maxFiles: 2,
      maxBytes: 1_000_000,
      maxDirs: 100,
      maxDepth: 24,
      maxEntries: 1000,
    },
  });
  const exec = "00000000-0000-4000-8000-00000000e007";
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl7.jsonl"));
  const big = await b.handle(
    req("/v1/compile", tok, '{"apps":["Core"]}', exec),
  );
  assertEquals(big.status, 422);
  assert(!(await big.text()).includes(s.root.replaceAll("\\", "\\\\")));
});

Deno.test("backend: a live or still-draining execution id cannot be granted again", async () => {
  const s = await setup();
  await assertRejects(
    () => grantFor(s.backend, s.root, EXEC_A, s.hostLog),
    ValidationError,
    "already",
  );
  s.gate.wait = new Promise<void>(() => {});
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend8"),
    ops: {
      compile: () => new Promise(() => {}),
      test: () => new Promise(() => {}),
    },
    allowedHosts: ["127.0.0.1"],
    revokeGraceMs: 10,
  });
  const exec = "00000000-0000-4000-8000-00000000e008";
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl8.jsonl"));
  void b.handle(req("/v1/compile", tok, '{"apps":["Core"]}', exec));
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(await b.revoke(exec), false, "never drains");
  await assertRejects(
    () => grantFor(b, s.root, exec, join(s.root, "hl8.jsonl")),
    ValidationError,
    "still draining",
  );
});

Deno.test("backend: every rejection gets its own request id in the host log", async () => {
  const s = await setup();
  await s.backend.handle(req("/v1/compile", s.tokenA, "{"));
  await s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Nope"]}'));
  const ids = (await readHostLog(s.hostLog)).map((l) => l.request);
  assertEquals(new Set(ids).size, ids.length);
});

Deno.test({
  name: "cg-al.ps1: a usage error is 64 and a missing token file is 2, never 1",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const s = await setup();
    const server = s.backend.serve("127.0.0.1", 0);
    const secrets = await tmp();
    try {
      const run = async (...args: string[]) =>
        (await new Deno.Command("powershell", {
          args: [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            "harness/images/base/cg-al.ps1",
            ...args,
          ],
          env: {
            CG_BACKEND_URL: server.url,
            CG_EXECUTION_ID: EXEC_A,
            CG_SECRETS_DIR: secrets,
          },
          stdout: "piped",
          stderr: "piped",
        }).output()).code;
      assertEquals(await run("test", "80010"), 2, "no token file");
      await Deno.writeTextFile(join(secrets, "backend-token"), s.tokenA);
      assertEquals(await run("test", "abc"), 64);
    } finally {
      await server.shutdown();
    }
  },
});

Deno.test("backend: the snapshot runs the reparse attribute scan; a scanned reparse entry is refused, not copied", async () => {
  const s = await setup();
  const seen: string[] = [];
  const b = new Backend({
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend9"),
    ops: {
      compile: async (ctx) => {
        seen.push(ctx.snapshot);
        return {
          body: {
            present: await exists(join(ctx.snapshot, "Core", "src", "C.al")),
          },
          log: { outcome: "ok" },
        };
      },
      test: () => Promise.resolve({ body: {}, log: { outcome: "ok" } }),
    },
    allowedHosts: ["127.0.0.1"],
    docker: new FakeDocker(),
    scanReparsePoints: () =>
      Promise.resolve({
        ancestors: [],
        entries: ["Core/src/C.al"],
        seen: 5,
        capped: false,
      }),
  });
  const exec = "00000000-0000-4000-8000-00000000e00a";
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl9.jsonl"));
  const body =
    await (await b.handle(req("/v1/compile", tok, '{"apps":["Core"]}', exec)))
      .json();
  assertEquals(body.present, false);
  assertEquals(body.ignored_links, ["Core/src/C.al"]);
});

Deno.test("backend: a grant during an in-flight drain is refused; concurrent grants of one id admit exactly one", async () => {
  const s = await setup();
  s.gate.wait = new Promise<void>(() => {});
  const first = s.backend.handle(
    req("/v1/compile", s.tokenA, '{"apps":["Core"]}'),
  );
  await new Promise((r) => setTimeout(r, 20));
  const revoking = s.backend.revoke(EXEC_A);
  await assertRejects(
    () => grantFor(s.backend, s.root, EXEC_A, s.hostLog),
    ValidationError,
  );
  await revoking;
  await first;
  const exec = "00000000-0000-4000-8000-00000000e00b";
  const both = await Promise.allSettled([
    grantFor(s.backend, s.root, exec, join(s.root, "hlb.jsonl")),
    grantFor(s.backend, s.root, exec, join(s.root, "hlb.jsonl")),
  ]);
  assertEquals(both.filter((x) => x.status === "fulfilled").length, 1);
});

Deno.test("backend: UNC paths, backend roots and host paths in any agent-facing body are scrubbed", async () => {
  const s = await setup();
  const leak = [
    join(s.root, "backend10", "x", "C.al"),
    join(s.root, "backend10", "x").replaceAll("\\", "/"),
    "\\\\fileserver\\share\\secret\\x.al",
    "C:/Users/someone/AppData/x.al",
  ];
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend10"),
    ops: {
      compile: () =>
        Promise.resolve({
          body: {
            apps: [{
              app: "Core",
              ok: false,
              diagnostics: leak.map((m) => ({ message: `error at ${m}` })),
            }],
          },
          log: { outcome: "failed" },
        }),
      test: () =>
        Promise.resolve({
          body: { messages: leak.map((m) => ({ message: m })) },
          log: { outcome: "failed" },
        }),
    },
    allowedHosts: ["127.0.0.1"],
  });
  const exec = "00000000-0000-4000-8000-00000000e00c";
  const tok = await grantFor(b, s.root, exec, join(s.root, "hlc.jsonl"));
  for (const path of ["/v1/compile", "/v1/test"]) {
    const text = await (await b.handle(
      req(
        path,
        tok,
        path === "/v1/compile" ? '{"apps":["Core"]}' : "{}",
        exec,
      ),
    )).text();
    for (const l of leak) {
      assert(
        !text.includes(l) &&
          !text.includes(JSON.stringify(l).slice(1, -1)),
        `${path}: ${l}`,
      );
    }
    assertStringIncludes(text, "<host path>");
  }
});

Deno.test(
  "cg-al.ps1: exit code per response status (agent-caused 4xx are 1, infra is 2, 401 is 3)",
  {
    ignore: Deno.build.os !== "windows",
  },
  async () => {
    let status = 200;
    let body = '{"ok":true}';
    const server = Deno.serve({
      hostname: "127.0.0.1",
      port: 0,
      onListen: () => {},
    }, () =>
      new Response(body, {
        status,
        headers: { "content-type": "application/json" },
      }));
    const secrets = await tmp();
    await Deno.writeTextFile(join(secrets, "backend-token"), "t".repeat(32));
    try {
      const cases: [number, string, number][] = [
        [200, '{"ok":true}', 0],
        [200, '{"ok":false}', 1],
        [400, '{"error":"x"}', 1],
        [413, '{"error":"x"}', 1],
        [422, '{"error":"x"}', 1],
        [429, '{"error":"x"}', 1],
        [401, '{"error":"x"}', 3],
        [408, '{"error":"x"}', 2],
        [500, '{"error":"x"}', 2],
        [503, '{"infra":"x"}', 2],
      ];
      for (const [s, b, want] of cases) {
        status = s;
        body = b;
        const out = await new Deno.Command("powershell", {
          args: [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            "harness/images/base/cg-al.ps1",
            "compile",
            "Core",
          ],
          env: {
            CG_BACKEND_URL: `http://127.0.0.1:${
              (server.addr as Deno.NetAddr).port
            }`,
            CG_EXECUTION_ID: EXEC_A,
            CG_SECRETS_DIR: secrets,
          },
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(out.code, want, `status ${s}`);
      }
    } finally {
      await server.shutdown();
    }
  },
);
