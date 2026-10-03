import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import { checkScenario } from "../../../scripts/harness/stub-anthropic.mjs";

const PROBE = resolve("harness/images/claude-code/lsp/lsp-probe.mjs");
const FAKE = resolve("tests/fixtures/harness/lsp/fake-al-ls.mjs");
const ROOT_VAR = "$" + "{CLAUDE_PLUGIN_ROOT}";
const FILE = "Core\\src\\LeaseMath.Codeunit.al";
const FILE2 = "Core\\src\\LeaseFee.Codeunit.al";
const LINE = "exit(1 + Months / 100);";
const LINE2 = "exit(25);";
const WINDOWS = Deno.build.os === "windows";

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
    assert(Date.now() - t0 < 20_000);
  },
});

Deno.test({
  name:
    "lsp-probe: a hung cleanup command is cut by its own deadline, so the timeout (2) still lands near the bound",
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
    assertEquals(r.code, 2, r.stderr);
    assert(
      Date.now() - t0 < 20_000,
      `took ${Date.now() - t0} ms: ${r.stderr}`,
    );
  },
});

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
    await assertSurvivorKilled(
      (m) => ({ FAKE_ORPHAN: m, FAKE_MALFORMED: "1" }),
      "malformed frame",
    );
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
      CG_LSP_TIMEOUT_MS: "20000",
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
      CG_LSP_TIMEOUT_MS: "20000",
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
        { op: "hold", ms: 500 }, // FILE's publish lands before the next edit
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
    ], { CG_LSP_TIMEOUT_MS: "20000" });
    assertEquals(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assertEquals(out.steps[3].result[0].code, "AL0118");
  },
});

Deno.test({
  name:
    "lsp-probe script: an unversioned publish followed by a versioned one still fails the step (6)",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, ["--script", await steps(s, EDIT_CYCLE)], {
      FAKE_NOVERSION_FIRST: "1",
      CG_LSP_TIMEOUT_MS: "20000",
    });
    assertEquals(r.code, 6, r.stderr);
    const out = JSON.parse(r.stdout);
    assertEquals(out.steps[1].ok, false);
    assertStringIncludes(out.steps[1].why, "no document version");
  },
});

Deno.test({
  name:
    "lsp-probe script: diagnostics without a document version are not provable: the step fails (6), never a pass after settling",
  ignore: !WINDOWS,
  async fn() {
    const s = await setup();
    const r = await probe(s, ["--script", await steps(s, EDIT_CYCLE)], {
      FAKE_STALE: "1",
      FAKE_NOVERSION: "1",
      CG_LSP_TIMEOUT_MS: "20000",
    });
    assertEquals(r.code, 6, r.stderr);
    const out = JSON.parse(r.stdout);
    assertEquals(out.ok, false);
    assertEquals(out.steps[1].ok, false);
    assertStringIncludes(out.steps[1].why, "no document version");
    assertEquals(out.steps[3].ok, false);
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
