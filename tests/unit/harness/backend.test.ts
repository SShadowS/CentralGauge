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
import {
  type CopyLimits,
  DEFAULT_COPY_LIMITS,
  exists,
} from "../../../src/harness/fsutil.ts";
import { stub } from "@std/testing/mock";
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
  /** Resolves when the fake compile op starts (pins "revoke during the op"). */
  entered: Promise<void>;
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

async function setup(
  opts: { revokeGraceMs?: number } = {},
): Promise<Setup> {
  const root = await tmp();
  const seen: string[] = [];
  const gate: Setup["gate"] = { wait: null };
  const failWith: Setup["failWith"] = { err: null };
  let enter!: () => void;
  const entered = new Promise<void>((r) => (enter = r));
  const ops: BackendOps = {
    async compile(ctx, apps) {
      seen.push(ctx.snapshot);
      enter();
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
    bodyTimeoutMs: 100,
    revokeGraceMs: opts.revokeGraceMs ?? 50,
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
    entered,
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
  // Pinned ordering (as M1-19a): the second request lands while the first op
  // runs, and the grace outlasts any load, so the revoke can only drain.
  const s = await setup({ revokeGraceMs: 60_000 });
  let open!: () => void;
  s.gate.wait = new Promise<void>((r) => (open = r));
  const first = s.backend.handle(
    req("/v1/compile", s.tokenA, '{"apps":["Core"]}'),
  );
  await s.entered;
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
  // Pinned ordering: the revoke lands while the op runs. A fixed sleep let a
  // slow snapshot (full-suite load) outlast it, so the revoke cancelled
  // before the op started: 503, the other legitimate ordering (M1-19a).
  await s.entered;
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

Deno.test("production ops: a revoke past the grace cancels before any further BC mutation", async () => {
  const s = await setup();
  let releaseCompile!: () => void;
  const gate = new Promise<void>((r) => (releaseCompile = r));
  const bc = new FakeBc(() => result({ A: true }));
  let compiling!: () => void;
  const inCompile = new Promise<void>((r) => (compiling = r));
  bc.onCompile = () => {
    compiling();
    return gate;
  };
  const exec = "00000000-0000-4000-8000-00000000e004";
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend4"),
    ops: defaultBackendOps(new BcLane(bc, ["C1"])),
    allowedHosts: ["127.0.0.1"],
    revokeGraceMs: 100,
  });
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl4.jsonl"));
  const pending = b.handle(req("/v1/test", tok, "{}", exec));
  // Pinned ordering: the revoke lands during the first compile. A fixed sleep
  // let a slow snapshot outlast sleep + grace, so the abort landed before any
  // compile (M1-19a).
  await inCompile;
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
    requestDeadlineMs: 40,
  });
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl5.jsonl"));
  assertEquals((await b.handle(req("/v1/test", tok, "{}", exec))).status, 503);
  assertEquals(bc.syncs, []);
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
  // The op is really running before the revoke, never a fixed sleep: under
  // load the request can still be before admission (its token digest), and a
  // revoke then finds nothing in flight and drains at once (M1-19c).
  let entered!: () => void;
  const running = new Promise<void>((r) => (entered = r));
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend8"),
    ops: {
      compile: () => {
        entered();
        return new Promise(() => {});
      },
      test: () => new Promise(() => {}),
    },
    allowedHosts: ["127.0.0.1"],
    revokeGraceMs: 10,
  });
  const exec = "00000000-0000-4000-8000-00000000e008";
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl8.jsonl"));
  void b.handle(req("/v1/compile", tok, '{"apps":["Core"]}', exec));
  await running;
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
  "cg-al.ps1: exit code per response status (agent-caused 4xx and the retryable 409 are 1, infra is 2, 401 is 3)",
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
        [409, '{"error":"workspace changed during snapshot; retry"}', 1],
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

Deno.test("backend: a revoke that lands during the snapshot cancels before the operation starts (503, op never runs)", async () => {
  const s = await setup();
  let release!: () => void;
  const scanning = new Promise<void>((r) => (release = r));
  let scanned!: () => void;
  const inScan = new Promise<void>((r) => (scanned = r));
  let opRan = false;
  const b = new Backend({
    scanReparsePoints: async () => {
      scanned();
      await scanning; // the snapshot is still in progress when the revoke aborts
      return { ancestors: [], entries: [], seen: 0, capped: false };
    },
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend11"),
    ops: {
      compile: () => {
        opRan = true;
        return Promise.resolve({ body: {}, log: { outcome: "ok" } });
      },
      test: () => Promise.resolve({ body: {}, log: { outcome: "ok" } }),
    },
    allowedHosts: ["127.0.0.1"],
    revokeGraceMs: 10,
  });
  const exec = "00000000-0000-4000-8000-00000000e00d";
  const tok = await grantFor(b, s.root, exec, join(s.root, "hld.jsonl"));
  const pending = b.handle(req("/v1/compile", tok, '{"apps":["Core"]}', exec));
  await inScan;
  const revoking = b.revoke(exec);
  await new Promise((r) => setTimeout(r, 30)); // past the first grace: the signal is aborted
  release();
  await revoking; // whether it drained depends on the grace; the ordering is what is pinned
  assertEquals((await pending).status, 503);
  assertEquals(opRan, false);
});

/** A backend over one granted workspace whose reparse-scan seam runs `during` before each copy. */
async function snapshotBackend(
  during: (ws: string, ctl: { revoke(): Promise<boolean> }) => Promise<void>,
  opts: { copyLimits?: CopyLimits; revokeGraceMs?: number } = {},
) {
  const s = await setup();
  let scans = 0;
  const seen: string[] = [];
  const exec = "00000000-0000-4000-8000-00000000e0b1";
  const b = new Backend({
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend-snap"),
    ops: {
      compile: (ctx) => {
        seen.push(ctx.snapshot);
        return Promise.resolve({ body: {}, log: { outcome: "ok" } });
      },
      test: () => Promise.resolve({ body: {}, log: { outcome: "ok" } }),
    },
    allowedHosts: ["127.0.0.1"],
    ...(opts.copyLimits ? { copyLimits: opts.copyLimits } : {}),
    ...(opts.revokeGraceMs !== undefined
      ? { revokeGraceMs: opts.revokeGraceMs }
      : {}),
    scanReparsePoints: async () => {
      scans++;
      await during(join(s.root, "work", exec, "workspace"), {
        revoke: () => b.revoke(exec),
      });
      return { ancestors: [], entries: [], seen: 1, capped: false };
    },
  });
  const hostLog = join(s.root, "hl-snap.jsonl");
  const tok = await grantFor(b, s.root, exec, hostLog);
  const send = () =>
    b.handle(req("/v1/compile", tok, '{"apps":["Core"]}', exec));
  const ws = join(s.root, "work", exec, "workspace");
  return { s, b, send, seen, hostLog, ws, scans: () => scans };
}

Deno.test("backend: a stable workspace compiles from a snapshot with no pause call made", async () => {
  const t = await snapshotBackend(() => Promise.resolve());
  assertEquals((await t.send()).status, 200);
  assertEquals([t.seen.length, t.scans()], [1, 1]);
  assertEquals(
    t.s.docker.paused,
    [],
    "no docker pause (Hyper-V cannot pause with a RW mount)",
  );
});

Deno.test("backend: a writer changing a file during the copy gives a retryable 409 after 2 internal retries", async () => {
  let n = 0;
  const t = await snapshotBackend(async (ws) => {
    await Deno.writeTextFile(join(ws, "Core", "src", "Churn.al"), `// ${++n}`);
  });
  const r = await t.send();
  const body = await r.json();
  assertEquals(r.status, 409);
  assertStringIncludes(body.error, "workspace changed during snapshot");
  assertEquals(body.retryable, true);
  assertEquals(t.scans(), 3, "one attempt and two internal retries");
  assertEquals(t.seen.length, 0, "no build from an unstable snapshot");
  const [line] = await readHostLog(t.hostLog);
  assertEquals([line!.status, line!.outcome], [409, "rejected"]);
});

Deno.test("backend: churn that settles within the retries still compiles", async () => {
  let n = 0;
  const t = await snapshotBackend(async (ws) => {
    if (++n === 1) {
      await Deno.writeTextFile(join(ws, "Core", "src", "Once.al"), "// x");
    }
  });
  assertEquals((await t.send()).status, 200);
  assertEquals([t.scans(), t.seen.length], [2, 1]);
});

Deno.test("backend: an I/O error during the snapshot is infra (503), not the agent's fault", async () => {
  const t = await snapshotBackend(() =>
    Promise.reject(
      new Deno.errors.PermissionDenied("Access is denied. (os error 5)"),
    )
  );
  const r = await t.send();
  assertEquals(r.status, 503);
  assertEquals(t.seen.length, 0);
});

Deno.test("backend: a revoke during the last attempt is a cancellation (503), never the churn 409", async () => {
  let n = 0;
  let revoking: Promise<boolean> | null = null;
  const t = await snapshotBackend(async (ws, ctl) => {
    await Deno.writeTextFile(join(ws, "Core", "src", "Churn.al"), `// ${++n}`);
    if (n === 3) {
      revoking = ctl.revoke();
      await new Promise((r) => setTimeout(r, 60)); // past the 10 ms grace: aborted
    }
  }, { revokeGraceMs: 10 });
  const r = await t.send();
  assertEquals([r.status, t.scans()], [503, 3]);
  await revoking;
});

Deno.test("backend: the snapshot digest enforces the copy limits while reading: an oversized file is 422, never read whole", async () => {
  const limits = { ...DEFAULT_COPY_LIMITS, maxBytes: 4096 };
  const t = await snapshotBackend(() => Promise.resolve(), {
    copyLimits: limits,
  });
  const big = join(t.ws, "Core", "src", "Big.al");
  await Deno.writeTextFile(big, "x".repeat(64 * 1024));
  const whole: string[] = [];
  const readFile = Deno.readFile;
  const spy = stub(Deno, "readFile", (path, o) => {
    whole.push(String(path));
    return readFile(path, o);
  });
  try {
    const r = await t.send();
    assertEquals(r.status, 422);
  } finally {
    spy.restore();
  }
  assertEquals(whole.filter((p) => p.endsWith("Big.al")), []);
});

Deno.test("production ops: a test after a compile of the same workspace rebuilds nothing", async () => {
  const s = await setup();
  const bc = new FakeBc(() => result({ A: true }));
  const exec = "00000000-0000-4000-8000-00000000e0c1";
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend-reuse"),
    ops: defaultBackendOps(new BcLane(bc, ["C1"])),
    allowedHosts: ["127.0.0.1"],
  });
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl-reuse.jsonl"));
  assertEquals(
    (await b.handle(req("/v1/compile", tok, '{"apps":[]}', exec))).status,
    200,
  );
  const compiled = bc.compiles.length;
  assert(compiled > 0);
  const r = await b.handle(req("/v1/test", tok, "{}", exec));
  assertEquals(r.status, 200);
  assertEquals(bc.compiles.length, compiled, "test reused the unchanged build");
  const lines = await readHostLog(join(s.root, "hl-reuse.jsonl"));
  assertEquals(lines.at(-1)!.per_app_compiles, 0);
});

Deno.test("backend: a BOM app.json in the workspace compiles (no violation, no invalid JSON)", async () => {
  const s = await setup();
  const bc = new FakeBc(() => result({ A: true }));
  const exec = "00000000-0000-4000-8000-00000000e0d1";
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend-bom"),
    ops: defaultBackendOps(new BcLane(bc, ["C1"])),
    allowedHosts: ["127.0.0.1"],
  });
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl-bom.jsonl"));
  const p = join(s.root, "work", exec, "workspace", "Core", "app.json");
  await Deno.writeTextFile(p, "\uFEFF" + await Deno.readTextFile(p));
  const r = await b.handle(req("/v1/compile", tok, '{"apps":["Core"]}', exec));
  const body = await r.json();
  assertEquals([r.status, body.ok, body.violations], [200, true, undefined]);
});

Deno.test({
  name:
    "cg-al.ps1 via powershell -File: --version is 0 with the version line; operations send the same requests; usage stays 64 (M1-28c)",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const seen: [string, unknown][] = [];
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      async (r) => {
        seen.push([new URL(r.url).pathname, await r.json()]);
        return new Response('{"ok":true}', {
          headers: { "content-type": "application/json" },
        });
      },
    );
    const secrets = await tmp();
    await Deno.writeTextFile(join(secrets, "backend-token"), "t".repeat(32));
    const run = async (...args: string[]) => {
      const o = await new Deno.Command("powershell", {
        args: [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "harness/images/base/cg-al.ps1",
          ...args,
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
      return { code: o.code, out: new TextDecoder().decode(o.stdout).trim() };
    };
    try {
      assertEquals(await run("--version"), {
        code: 0,
        out: '{"cg_al":"1"}',
      });
      assertEquals(seen, [], "--version sends no request");
      for (
        const bad of [[], ["--"], ["-version"], ["bogus"], ["test", "abc"]]
      ) {
        assertEquals((await run(...bad)).code, 64, JSON.stringify(bad));
      }
      assertEquals(seen, []);
      assertEquals((await run("compile", "Fleet Rental Core", "Test")).code, 0);
      assertEquals((await run("compile")).code, 0);
      assertEquals((await run("test", "80010", "80011")).code, 0);
      assertEquals((await run("symbols")).code, 0);
      assertEquals(seen, [
        ["/v1/compile", { apps: ["Fleet Rental Core", "Test"] }],
        ["/v1/compile", { apps: [] }],
        ["/v1/test", { codeunits: [80010, 80011] }],
        ["/v1/symbols", {}],
      ]);
    } finally {
      await server.shutdown();
    }
  },
});
