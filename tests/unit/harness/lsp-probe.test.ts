import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import { checkScenario } from "../../../scripts/harness/stub-anthropic.mjs";
import { Buffer } from "node:buffer";
import {
  fileTimeBounds,
  headerBytes,
  MAX_HEADER_BYTES,
} from "../../../harness/images/claude-code/lsp/lsp-probe-lib.mjs";

// M10-01b run 002/003: clock bounds and fragmented header limits, through the
// probe's pure helper library (the probe itself is only ever run, never
// imported).
const FT = (ms: number, us = 0) =>
  (BigInt(ms) + 11644473600000n) * 10000n + BigInt(us) * 10n;

Deno.test("fileTimeBounds: a child created at T+0.6 ms with the death read at T+0.9 ms stays under the upper bound; the lower bound is never late", () => {
  const T = 1_760_000_000_000;
  const created = FT(T, 600);
  const read = Math.floor(T + 0.9); // Date.now() at T+0.9 ms reads T
  assert(FT(read) < created, "a plain millisecond reading excludes the child");
  const b = fileTimeBounds(read);
  assert(created <= b.high, `upper bound ${b.high} below child ${created}`);
  assert(FT(T, 999) < b.high, "the whole millisecond is under the bound");
  assertEquals(b.low, FT(T), "lower bound is the floor, never later");
});

Deno.test("headerBytes: a header of exactly the limit is judged the same however its terminator is fragmented; one byte over is refused", () => {
  const first = "Content-Length: 2\r\nX-Pad: ";
  const block = first + "a".repeat(MAX_HEADER_BYTES - first.length);
  assertEquals(block.length, MAX_HEADER_BYTES);
  const n = (s: string) => headerBytes(Buffer.from(s, "latin1"));
  for (const tail of ["", "\r", "\r\n", "\r\n\r", "\r\n\r\n", "\r\n\r\n{}"]) {
    assertEquals(n(block + tail), MAX_HEADER_BYTES, JSON.stringify(tail));
  }
  for (const tail of ["", "\r", "\r\n", "\r\n\r", "\r\n\r\n{}"]) {
    assert(n(block + "a" + tail) > MAX_HEADER_BYTES, JSON.stringify(tail));
  }
});

const PROBE = resolve("harness/images/claude-code/lsp/lsp-probe.mjs");
const FAKE = resolve("tests/fixtures/harness/lsp/fake-al-ls.mjs");
const ROOT_VAR = "$" + "{CLAUDE_PLUGIN_ROOT}";
const FILE = "Core\\src\\LeaseMath.Codeunit.al";
const FILE2 = "Core\\src\\LeaseFee.Codeunit.al";
const LINE = "exit(1 + Months / 100);";
const LINE2 = "exit(25);";
const WINDOWS = Deno.build.os === "windows";
// Probe timeout for runs expected to finish (not to time out): host load under
// the full suite stretched a 14 s run past a 20 s timeout.
const LOAD_TIMEOUT_MS = "60000";

async function setup(withApp = true) {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const plugin = join(dir, "plugin");
  const ws = join(dir, "workspace");
  await Deno.mkdir(plugin, { recursive: true });
  await Deno.mkdir(join(ws, "Core", "src"), { recursive: true });
  if (withApp) await Deno.writeTextFile(join(ws, "Core", "app.json"), "{}");
  await Deno.writeTextFile(
    join(ws, ...FILE.split("\\")),
    'codeunit 70002 "CGR Lease Math"\n{\n    internal procedure RateFactor(Months: Integer): Decimal\n    begin\n        exit(1 + Months / 100);\n    end;\n}\n',
  );
  await Deno.writeTextFile(
    join(ws, ...FILE2.split("\\")),
    'codeunit 70003 "CGR Lease Fee"\n{\n    internal procedure Fee(): Decimal\n    begin\n        exit(25);\n    end;\n}\n',
  );
  await Deno.writeTextFile(
    join(plugin, ".lsp.json"),
    JSON.stringify({
      al: {
        command: Deno.execPath(),
        args: ["run", "-A", FAKE, ROOT_VAR],
        transport: "stdio",
        env: { HTTPS_PROXY: "", HTTP_PROXY: "" },
      },
    }),
  );
  return { dir, plugin, ws };
}

async function probe(
  s: { plugin: string; ws: string },
  args: string[],
  env: Record<string, string> = {},
) {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", PROBE, ...args],
    env: {
      CG_LSP_PLUGIN: s.plugin,
      CG_LSP_WORKSPACE: s.ws,
      CG_LSP_SHUTDOWN_MS: "1500",
      HTTPS_PROXY: "http://proxy.invalid:3128",
      HTTP_PROXY: "http://proxy.invalid:3128",
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const t = new TextDecoder();
  return {
    code: out.code,
    stdout: t.decode(out.stdout),
    stderr: t.decode(out.stderr),
  };
}

async function steps(s: { dir: string }, list: unknown[]) {
  const p = join(s.dir, `steps-${crypto.randomUUID()}.json`);
  await Deno.writeTextFile(p, JSON.stringify(list));
  return p;
}

const EDIT_CYCLE = [
  { op: "edit", file: FILE, find: LINE, replace: `Foo := 1; ${LINE}` },
  {
    op: "diagnostics",
    file: FILE,
    code: "AL0118",
    present: true,
    settleMs: 600,
  },
  { op: "edit", file: FILE, find: `Foo := 1; ${LINE}`, replace: LINE },
  {
    op: "diagnostics",
    file: FILE,
    code: "AL0118",
    present: false,
    settleMs: 600,
  },
];

/** Live processes whose command line contains marker (CIM), the inspector itself excluded. */
async function withMarker(marker: string): Promise<number> {
  const out = await new Deno.Command("powershell", {
    args: [
      "-NoProfile",
      "-Command",
      `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${marker}*' }).Count`,
    ],
    stdout: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout).trim();
  assertEquals(out.code, 0, "the CIM inspector ran");
  assert(/^\d+$/.test(text), `the CIM inspector printed a count: [${text}]`);
  return Number(text);
}

/** A preflight whose fake leaves a marked process behind must exit 3 (stderr has expect) and leave none alive. */
async function assertSurvivorKilled(
  env: (marker: string) => Record<string, string>,
  expect: string,
) {
  const marker = `cg-m10-orphan-${crypto.randomUUID()}`;
  const r = await probe(await setup(), ["--preflight"], env(marker));
  assertEquals(r.code, 3, r.stderr);
  assertStringIncludes(r.stderr, expect);
  assertEquals(await withMarker(marker), 0, "the probe killed the survivor");
}

Deno.test({
  name: "lsp-probe preflight: documentSymbol answered; stderr only; clean exit",
  ignore: !WINDOWS,
  async fn() {
    const r = await probe(await setup(), ["--preflight"]);
    assertEquals([r.code, r.stdout], [0, ""], r.stderr);
    assertStringIncludes(r.stderr, "[OK] lsp-probe preflight: 2 symbols");
  },
});

Deno.test({
  name:
    "lsp-probe (M10-01b run 003): run under node and deno, through another path spelling or a junction, it still does real work (never a silent exit 0)",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const node = await new Deno.Command("node", { args: ["--version"] })
      .output().then((o) => o.success, () => false);
    const runners: [string, string[]][] = [[Deno.execPath(), ["run", "-A"]]];
    if (node) runners.push(["node", []]);
    // Node picks the module format from the extension case-sensitively, so
    // only the directory part changes case.
    const base = "lsp-probe.mjs";
    const dir = PROBE.slice(0, -base.length - 1);
    const upper = join(dir.toUpperCase(), base);
    // A junction to the probe's folder (no admin needed): node resolves the
    // main module through it, which made run 002's lexical isMain false and
    // the probe exit 0 with no session.
    const link = join(s.dir, "probe-link");
    const mk = await new Deno.Command("cmd", {
      args: ["/c", "mklink", "/J", link, dir],
      stdout: "null",
      stderr: "piped",
    }).output();
    assert(mk.success, new TextDecoder().decode(mk.stderr));
    try {
      for (const [cmd, pre] of runners) {
        for (const script of [PROBE, upper, join(link, base)]) {
          const out = await new Deno.Command(cmd, {
            args: [...pre, script, "--preflight"],
            env: {
              CG_LSP_PLUGIN: s.plugin,
              CG_LSP_WORKSPACE: s.ws,
              CG_LSP_SHUTDOWN_MS: "1500",
            },
            stdout: "piped",
            stderr: "piped",
          }).output();
          const err = new TextDecoder().decode(out.stderr);
          assertEquals(out.code, 0, `${cmd} ${script}: ${err}`);
          assertStringIncludes(
            err,
            "[OK] lsp-probe preflight: 2 symbols",
            `${cmd} ${script}`,
          );
        }
      }
    } finally {
      // rmdir removes the junction itself, never the probe folder behind it.
      await new Deno.Command("cmd", { args: ["/c", "rmdir", link] }).output();
    }
  },
});

Deno.test({
  name:
    "lsp-probe preflight: no symbols or an early death is a server failure (3)",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const empty = await probe(s, ["--preflight"], { FAKE_EMPTY: "1" });
    assertEquals(empty.code, 3);
    assertStringIncludes(empty.stderr, "returned no symbols");
    assertEquals((await probe(s, ["--preflight"], { FAKE_DIE: "1" })).code, 3);
  },
});

Deno.test({
  name: "lsp-probe preflight: a hanging server is a timeout (2) near the bound",
  ignore: !WINDOWS,
  async fn() {
    const t0 = Date.now();
    const r = await probe(await setup(), ["--preflight"], {
      FAKE_HANG: "1",
      CG_LSP_TIMEOUT_MS: "1500",
    });
    assertEquals(r.code, 2);
    // Still far under an unbounded hang, but not a tight timing bound: under
    // host load this run took 25 s (3 s alone) against a 1.5 s probe timeout.
    assert(Date.now() - t0 < 60_000);
  },
});

Deno.test({
  name:
    "lsp-probe: a hung cleanup command is cut by its own deadline; the unverified cleanup is a failure (3) near the bound",
  ignore: !WINDOWS,
  async fn() {
    const t0 = Date.now();
    const r = await probe(await setup(), ["--preflight"], {
      FAKE_HANG: "1",
      CG_LSP_TIMEOUT_MS: "1500",
      CG_LSP_CMD_MS: "1500",
      // Test-only: the CIM process table command hangs for 60 s.
      CG_LSP_TEST_TABLE_CMD: JSON.stringify([
        Deno.execPath(),
        "eval",
        "setTimeout(() => {}, 60000)",
      ]),
    });
    assertEquals(r.code, 3, r.stderr);
    assertStringIncludes(r.stderr, "cleanup incomplete: process table");
    assert(
      Date.now() - t0 < 20_000,
      `took ${Date.now() - t0} ms: ${r.stderr}`,
    );
  },
});

Deno.test({
  name:
    "lsp-probe: an unreadable process table makes cleanup incomplete (3), never success",
  ignore: !WINDOWS,
  async fn() {
    const r = await probe(await setup(), ["--preflight"], {
      CG_LSP_TEST_TABLE_CMD: JSON.stringify([
        Deno.execPath(),
        "eval",
        "Deno.exit(1)",
      ]),
    });
    assertEquals(r.code, 3, r.stderr);
    assertStringIncludes(r.stderr, "cleanup incomplete: process table");
  },
});

Deno.test({
  name:
    "lsp-probe: a process whose pid is targeted with another creation time is never killed (identity-bound kill)",
  ignore: !WINDOWS,
  async fn() {
    const bystander = new Deno.Command(Deno.execPath(), {
      args: ["eval", "setTimeout(() => {}, 60000)"],
      stdout: "null",
      stderr: "null",
    }).spawn();
    try {
      // Test-only: a stale target with this pid but a wrong creation time, as
      // if the pid had been reused since the probe recorded it.
      const r = await probe(await setup(), ["--preflight"], {
        FAKE_IGNORE_EXIT: "1",
        CG_LSP_TEST_EXTRA_KILL: JSON.stringify([
          { pid: bystander.pid, created: "1" },
        ]),
      });
      assertEquals(r.code, 3, r.stderr);
      assertStringIncludes(r.stderr, `pid ${bystander.pid}: mismatch`);
      const alive = await Promise.race([
        bystander.status.then(() => false),
        new Promise<boolean>((res) => setTimeout(() => res(true), 500)),
      ]);
      assert(alive, "the bystander is still alive");
    } finally {
      try {
        bystander.kill("SIGKILL");
      } catch { /* gone */ }
      await bystander.status;
    }
  },
});

Deno.test({
  name:
    "lsp-probe: a server whose death cannot be confirmed by identity is cleanup incomplete (3)",
  ignore: !WINDOWS,
  async fn() {
    const r = await probe(await setup(), ["--preflight"], {
      FAKE_HANG: "1",
      CG_LSP_TIMEOUT_MS: "1500",
      // Test-only: the server's recorded creation time is wrong.
      CG_LSP_TEST_ROOT_CREATED: "1",
    });
    assertEquals(r.code, 3, r.stderr);
    assertStringIncludes(r.stderr, "cleanup incomplete: server pid");
    assertStringIncludes(r.stderr, "not confirmed dead");
  },
});

Deno.test({
  name:
    "lsp-probe: a child the server started after the last snapshot is found by the post-kill sweep and killed",
  ignore: !WINDOWS,
  async fn() {
    const marker = `cg-m10-orphan-${crypto.randomUUID()}`;
    const s = await setup();
    const gate = join(s.dir, "gate");
    const r = await probe(s, ["--preflight"], {
      FAKE_IGNORE_EXIT: "1",
      FAKE_LATE_ORPHAN: marker,
      FAKE_GATE: gate,
      // Test-only: no snapshot right before the kill, so only the sweep
      // after the server's confirmed death can see the late child.
      CG_LSP_TEST_SKIP_PREKILL_SNAPSHOT: "1",
    });
    assertEquals(r.code, 3, r.stderr);
    const pid = (await Deno.readTextFile(`${gate}.pid`)).trim();
    assert(/^\d+$/.test(pid), "the fake recorded the late child");
    // "killed" means it was found alive with a matching identity.
    assertStringIncludes(r.stderr, `pid ${pid}: killed`);
    assertEquals(await withMarker(marker), 0, "the probe killed the child");
  },
});

Deno.test({
  name:
    "lsp-probe: a child started during a clean shutdown is found by the final sweep and killed, never exit 0",
  ignore: !WINDOWS,
  async fn() {
    const marker = `cg-m10-orphan-${crypto.randomUUID()}`;
    const s = await setup();
    const gate = join(s.dir, "gate");
    const r = await probe(s, ["--preflight"], {
      FAKE_LATE_ORPHAN: marker,
      FAKE_GATE: gate,
    });
    assertEquals(r.code, 3, r.stderr);
    const pid = (await Deno.readTextFile(`${gate}.pid`)).trim();
    assert(/^\d+$/.test(pid), "the fake recorded the late child");
    assertStringIncludes(r.stderr, `pid ${pid}: killed`);
    assertEquals(await withMarker(marker), 0, "the probe killed the child");
  },
});

Deno.test({
  name:
    "lsp-probe: CG_LSP_CMD_MS and CG_LSP_TIMEOUT_MS must be finite and positive, else a configuration error (4)",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    for (const v of ["0", "-5", "abc", "Infinity"]) {
      const r = await probe(s, ["--preflight"], { CG_LSP_CMD_MS: v });
      assertEquals(r.code, 4, `CG_LSP_CMD_MS=${v}: ${r.stderr}`);
      assertStringIncludes(r.stderr, "CG_LSP_CMD_MS");
    }
    const t = await probe(s, ["--preflight"], { CG_LSP_TIMEOUT_MS: "0" });
    assertEquals(t.code, 4, t.stderr);
  },
});

const BAD_HEADERS: [string, string][] = [
  ["a prefixed field name", "X-Content-Length: 2"],
  ["a non-numeric length", "Content-Length: 2junk"],
  ["duplicate conflicting lengths", "Content-Length: 2|Content-Length: 3"],
  ["an oversized length", "Content-Length: 99999999999"],
  // A complete block (terminator included) over MAX_HEADER_BYTES (8192).
  ["an oversized header block", `X-Pad: ${"a".repeat(9000)}|Content-Length: 2`],
  // "Content-Length: 2\n" then the CRLF CRLF terminator: a bare LF.
  ["a bare LF line end", "Content-Length: 2%0A"],
  ["a control character in a header value", "X-Note: a%01b|Content-Length: 2"],
];
for (const [label, header] of BAD_HEADERS) {
  Deno.test({
    name:
      `lsp-probe: a frame header with ${label} is a protocol failure (3), not a timeout`,
    ignore: !WINDOWS,
    async fn() {
      const r = await probe(await setup(), ["--preflight"], {
        FAKE_FRAME: header,
        CG_LSP_TIMEOUT_MS: LOAD_TIMEOUT_MS,
      });
      assertEquals(r.code, 3, r.stderr);
      assertStringIncludes(r.stderr, "frame header");
    },
  });
}

Deno.test({
  name: "lsp-probe: a server that ignores exit is killed and fails cleanup (3)",
  ignore: !WINDOWS,
  async fn() {
    const r = await probe(await setup(), ["--preflight"], {
      FAKE_IGNORE_EXIT: "1",
    });
    assertEquals(r.code, 3);
    assertStringIncludes(r.stderr, "did not exit");
  },
});

Deno.test({
  name:
    "lsp-probe: an orphaned grandchild that survives shutdown fails cleanup (3) and is killed",
  ignore: !WINDOWS,
  async fn() {
    await assertSurvivorKilled(
      (m) => ({ FAKE_ORPHAN: m }),
      "survived shutdown",
    );
  },
});

Deno.test({
  name:
    "lsp-probe: a grandchild whose short-lived parent exited is still tracked, fails cleanup (3) and is killed",
  ignore: !WINDOWS,
  async fn() {
    await assertSurvivorKilled(
      (m) => ({ FAKE_INTERMEDIATE: m }),
      "survived shutdown",
    );
  },
});

Deno.test({
  name:
    "lsp-probe: a malformed frame is a server failure (3) that still kills the tree",
  ignore: !WINDOWS,
  async fn() {
    const marker = `cg-m10-orphan-${crypto.randomUUID()}`;
    const s = await setup();
    const gate = join(s.dir, "gate");
    // The fake starts the marked child, writes gate.pid, and sends the bad
    // frame only once gate.go exists: the child is observed live first.
    const run = probe(s, ["--preflight"], {
      FAKE_ORPHAN: marker,
      FAKE_MALFORMED: "1",
      FAKE_GATE: gate,
    });
    for (let i = 0; i < 300; i++) {
      try {
        await Deno.stat(`${gate}.pid`);
        break;
      } catch {
        await new Promise((res) => setTimeout(res, 100));
      }
    }
    assertEquals(await withMarker(marker), 1, "the marked child is live");
    await Deno.writeTextFile(`${gate}.go`, "");
    const r = await run;
    assertEquals(r.code, 3, r.stderr);
    assertStringIncludes(r.stderr, "malformed frame");
    assertEquals(await withMarker(marker), 0, "the probe killed the child");
  },
});

Deno.test({
  name:
    "lsp-probe: missing .lsp.json or no app.json is a configuration error (4)",
  ignore: !WINDOWS,
  async fn() {
    assertEquals((await probe(await setup(false), ["--preflight"])).code, 4);
    const s = await setup();
    await Deno.remove(join(s.plugin, ".lsp.json"));
    assertEquals((await probe(s, ["--preflight"])).code, 4);
  },
});

Deno.test({
  name:
    "lsp-probe script: expectations pass; .lsp.json env wins; plugin root substituted; diagnostics follow edits",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, [
      "--script",
      await steps(s, [
        {
          op: "symbols",
          file: FILE,
          expect: { names: ["CGR Lease Math", "RateFactor"] },
        },
        {
          op: "hover",
          file: FILE,
          line: 2,
          character: 23,
          expect: {
            contains: ["proxy=[]", "http=[]", `root=[${s.plugin}]`],
          },
        },
        {
          op: "references",
          file: FILE,
          line: 2,
          character: 23,
          expect: { locations: ["Core/src/LeaseMath.Codeunit.al:3"] },
        },
        { op: "wsymbols", query: "CG Canary", expect: { none: true } },
        ...EDIT_CYCLE,
      ]),
    ]);
    assertEquals(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assertEquals(out.ok, true);
    assertEquals(out.steps[5].result[0].code, "AL0118");
    assertEquals(out.steps[7].result, []);
  },
});

Deno.test({
  name:
    "lsp-probe script: a wrong answer is an assertion failure (6), reported per step",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, [
      "--script",
      await steps(s, [
        { op: "symbols", file: FILE, expect: { names: ["LeaseTotal"] } },
        {
          op: "references",
          file: FILE,
          line: 2,
          character: 23,
          expect: { locations: ["Leasing/src/LeaseMgt.Codeunit.al:11"] },
        },
        {
          op: "hover",
          file: FILE,
          line: 2,
          character: 23,
          expect: { contains: ["Library Assert"] },
        },
      ]),
    ]);
    assertEquals(r.code, 6);
    const out = JSON.parse(r.stdout);
    assertEquals(out.steps.map((x: { ok: boolean }) => x.ok), [
      false,
      false,
      false,
    ]);
    assertStringIncludes(out.steps[0].why, "LeaseTotal");
  },
});

Deno.test({
  name: "lsp-probe script: stale diagnostics of an older version are ignored",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, ["--script", await steps(s, EDIT_CYCLE)], {
      FAKE_STALE: "1",
      CG_LSP_TIMEOUT_MS: LOAD_TIMEOUT_MS,
    });
    assertEquals(r.code, 0, r.stderr);
  },
});

Deno.test({
  name:
    "lsp-probe script: unrelated notifications during the settle window do not keep a diagnostics step from settling",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, ["--script", await steps(s, EDIT_CYCLE)], {
      FAKE_CHATTER: "1",
      CG_LSP_TIMEOUT_MS: LOAD_TIMEOUT_MS,
    });
    assertEquals(r.code, 0, r.stderr);
  },
});

Deno.test({
  name:
    "lsp-probe script: edit versions are per file; an edit of another file does not hide the first file's diagnostics",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, [
      "--script",
      await steps(s, [
        EDIT_CYCLE[0],
        // FILE's counted publish already lands inside its edit step (after
        // the documentSymbol response); the hold only spaces the edits.
        { op: "hold", ms: 500 },
        { op: "edit", file: FILE2, find: LINE2, replace: "exit(30);" },
        EDIT_CYCLE[1],
        {
          op: "diagnostics",
          file: FILE2,
          code: "AL0118",
          present: false,
          settleMs: 300,
        },
      ]),
    ], { CG_LSP_TIMEOUT_MS: LOAD_TIMEOUT_MS });
    assertEquals(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assertEquals(out.steps[3].result[0].code, "AL0118");
  },
});

const ALIAS = "core/SRC/leasemath.codeunit.AL";

Deno.test({
  name:
    "lsp-probe script: a differently cased or separated name is the same document: it keeps the edit's version gate",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, [
      "--script",
      await steps(s, [
        EDIT_CYCLE[0],
        { ...EDIT_CYCLE[1], file: ALIAS },
      ]),
    ], { CG_LSP_TIMEOUT_MS: LOAD_TIMEOUT_MS });
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).steps[1].result[0].code, "AL0118");
  },
});

Deno.test({
  name:
    "lsp-probe script: an aliased name never lets pre-edit clean diagnostics pass present:false (timeout, not a pass)",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, [
      "--script",
      await steps(s, [
        EDIT_CYCLE[0],
        { ...EDIT_CYCLE[3], file: ALIAS, settleMs: 300 },
      ]),
    ], { CG_LSP_TIMEOUT_MS: "6000" });
    assertEquals(r.code, 2, r.stderr);
  },
});

Deno.test({
  name:
    "lsp-probe script: after the documentSymbol response, an unversioned publish then a versioned one passes (0)",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, ["--script", await steps(s, EDIT_CYCLE)], {
      FAKE_NOVERSION_FIRST: "1",
      CG_LSP_TIMEOUT_MS: LOAD_TIMEOUT_MS,
    });
    assertEquals(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assertEquals(out.steps.map((x: { ok: boolean }) => x.ok), [
      true,
      true,
      true,
      true,
    ]);
    assertEquals(out.steps[1].result[0].code, "AL0118");
    assertEquals(out.steps[3].result, []);
  },
});

Deno.test({
  name:
    "lsp-probe script: an unversioned stale republish after the response cannot be told apart: timeout (2), never a pass",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    // FAKE_STALE republishes the previous (clean) text, unversioned, right
    // behind the post-documentSymbol publish: it replaces the AL0118 publish
    // inside the settle window, so present:true never settles, whatever the
    // timing (the stale-after-response residual in lsp-probe.mjs).
    const r = await probe(s, ["--script", await steps(s, EDIT_CYCLE)], {
      FAKE_STALE: "1",
      FAKE_NOVERSION: "1",
      CG_LSP_TIMEOUT_MS: "20000",
    });
    assertEquals(r.code, 2, r.stderr);
    assertStringIncludes(r.stderr, "no result within");
    assertEquals(r.stdout, "", "no step result is reported, so none as ok");
  },
});

Deno.test("arm-lsp stub scenario: valid for the stub and drives the S1 LSP operations", async () => {
  const s = JSON.parse(
    await Deno.readTextFile("scripts/harness/stub-scenarios/arm-lsp.json"),
  );
  checkScenario(s);
  const ops = s.steps.flatMap((
    st: { content: { name?: string; input?: { operation?: string } }[] },
  ) => st.content)
    .filter((b: { name?: string }) => b.name === "LSP")
    .map((b: { input?: { operation?: string } }) => b.input?.operation);
  assertEquals(ops, ["documentSymbol", "hover", "findReferences"]);
});

// M10-01c: the AL LS publishes without a document version, so an edit is
// gated by order: didChange, then documentSymbol on the file; only publishes
// for that file after the documentSymbol response count.
Deno.test({
  name:
    "lsp-probe script (M10-01c): a publish before the documentSymbol response is ignored, even with the expected code (timeout, not a pass)",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, [
      "--script",
      await steps(s, EDIT_CYCLE.slice(0, 2)),
    ], {
      FAKE_PRE_ONLY: "1",
      // Room for the version-gated pass this replaces (about 9 s under load),
      // so the 2 comes from the gate, not a tight bound.
      CG_LSP_TIMEOUT_MS: "20000",
    });
    assertEquals(r.code, 2, r.stderr);
    assertStringIncludes(r.stderr, "no result within");
  },
});

Deno.test({
  name:
    "lsp-probe script (M10-01c): a publish after the documentSymbol response settles the step",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, ["--script", await steps(s, EDIT_CYCLE)], {
      FAKE_POST_ONLY: "1",
      CG_LSP_TIMEOUT_MS: LOAD_TIMEOUT_MS,
    });
    assertEquals(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assertEquals(out.steps[1].result[0].code, "AL0118");
    assertEquals(out.steps[3].result, []);
  },
});

Deno.test({
  name:
    "lsp-probe script (M10-01c): a server that publishes no version passes through the ordering gate",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, ["--script", await steps(s, EDIT_CYCLE)], {
      FAKE_NOVERSION: "1",
      CG_LSP_TIMEOUT_MS: LOAD_TIMEOUT_MS,
    });
    assertEquals(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assertEquals(out.steps[1].result[0].code, "AL0118");
    assertEquals(out.steps[3].result, []);
  },
});

Deno.test({
  name:
    "lsp-probe script (M10-01c): an edit to a file of a non-active project publishes only after documentSymbol activates it",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const other = "Other\\src\\OtherFee.Codeunit.al";
    await Deno.mkdir(join(s.ws, "Other", "src"), { recursive: true });
    await Deno.writeTextFile(join(s.ws, "Other", "app.json"), "{}");
    await Deno.writeTextFile(
      join(s.ws, ...other.split("\\")),
      'codeunit 70004 "CGR Other Fee"\n{\n    internal procedure Fee(): Decimal\n    begin\n        exit(25);\n    end;\n}\n',
    );
    const r = await probe(s, [
      "--script",
      await steps(s, [
        { op: "symbols", file: FILE }, // Core is the active project
        { op: "edit", file: other, find: LINE2, replace: `Foo := 1; ${LINE2}` },
        {
          op: "diagnostics",
          file: other,
          code: "AL0118",
          present: true,
          settleMs: 300,
        },
      ]),
    ], { FAKE_ACTIVE_PROJECT: "1", CG_LSP_TIMEOUT_MS: LOAD_TIMEOUT_MS });
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).steps[2].result[0].code, "AL0118");
  },
});

Deno.test({
  name:
    "lsp-probe script (M10-01c): a second edit of the same file waits until the first settles (one didChange in flight)",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    // FAKE_INFLIGHT republishes FILE for 5 s after each documentSymbol and
    // exits 9 (server failure, 3) on a didChange of FILE inside that window.
    const r = await probe(s, [
      "--script",
      await steps(s, [
        EDIT_CYCLE[0],
        { op: "edit", file: FILE, find: "Foo := 1;", replace: "Foo := 2;" },
        { ...EDIT_CYCLE[1], settleMs: 300 },
      ]),
    ], { FAKE_INFLIGHT: "1", CG_LSP_TIMEOUT_MS: LOAD_TIMEOUT_MS });
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).steps[2].result[0].code, "AL0118");
  },
});

Deno.test({
  name:
    "lsp-probe script (M10-01c run 002): after the documentSymbol response, a publish of a future version is ignored; an empty one never passes present:false (timeout)",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    // The edit leaves FILE at version 2 with AL0118; FAKE_FUTURE answers the
    // documentSymbol with only an empty publish of version 3.
    const r = await probe(s, [
      "--script",
      await steps(s, [EDIT_CYCLE[0], { ...EDIT_CYCLE[3], settleMs: 300 }]),
    ], {
      FAKE_FUTURE: "1",
      // Room for the >= gate's pass this replaces, so the 2 is the gate's.
      CG_LSP_TIMEOUT_MS: "20000",
    });
    assertEquals(r.code, 2, r.stderr);
    assertStringIncludes(r.stderr, "no result within");
    assertEquals(r.stdout, "", "no step result is reported, so none as ok");
  },
});
