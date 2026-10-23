import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  HOSTILE_FIXTURES,
  mockAdapter,
  resolveVariant,
} from "../../../src/harness/adapters/mock.ts";
import { HarnessConfigSchema } from "../../../src/harness/config.ts";
import { parse as parseYaml } from "@std/yaml";
import { runCell } from "../../../src/harness/execution.ts";
import { safeCopyTree } from "../../../src/harness/fsutil.ts";
import { loadSymbolsLock } from "../../../src/harness/identity.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import type { LoadedTask } from "../../../src/harness/task.ts";
import {
  alObjects,
  buildVerdictWorkspace,
  validateApps,
} from "../../../src/harness/verdict-workspace.ts";
import { cellFor, makeEnv, mockImageBehavior } from "./runtime-fixture.ts";
import { NO_ONPREM } from "./onprem-fixture.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const manifest = {
  v: 1 as const,
  refapp_version: "refapp-v1",
  tasks: {
    "HX-001": {
      rev: "refapp-v1-rc1",
      positive: "correct" as const,
      naive: ["a"],
    },
    "HX-002": {
      rev: "refapp-v1-rc2",
      positive: "reference-tests" as const,
      naive: ["weak", "crashy"],
    },
  },
};

Deno.test("resolveVariant: positive per task kind; named naive only from the manifest", () => {
  assertEquals(
    resolveVariant("HX-001", { variant: "positive" }, manifest),
    "correct",
  );
  assertEquals(
    resolveVariant("HX-002", { variant: "positive" }, manifest),
    "reference-tests",
  );
  assertEquals(
    resolveVariant("HX-002", { variant: "naive:crashy" }, manifest),
    "naive/crashy",
  );
  assertThrows(
    () => resolveVariant("HX-002", { variant: "naive:missing" }, manifest),
    ConfigurationError,
    "missing",
  );
  assertThrows(
    () => resolveVariant("HX-002", { variant: "naive" }, manifest),
    ConfigurationError,
    "name",
  );
  assertThrows(
    () => resolveVariant("HX-009", { variant: "positive" }, manifest),
    ConfigurationError,
    "HX-009",
  );
});

Deno.test("mock configs may have empty models; real configs may not", () => {
  HarnessConfigSchema.parse({
    id: "m",
    harness: "mock",
    harness_version: "1",
    models: {},
    settings: {},
    limits: { timeout_min: 5, max_budget_usd: 1 },
  });
  assertThrows(() =>
    HarnessConfigSchema.parse({
      id: "c",
      harness: "claude-code",
      harness_version: "2.1.282",
      models: {},
      settings: {},
      limits: { timeout_min: 5, max_budget_usd: 1 },
    })
  );
});

Deno.test("mock arms: positive passes, a named naive fails, unattended without egress enforcement", async () => {
  await using t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  const pos = await runCell(t.env, await cellFor(t, "mock-positive"));
  assertEquals(
    (await t.env.store.judgments(pos.executions[0]!.id))[0]!.verdict,
    "pass",
  );
  const neg = await runCell(t.env, await cellFor(t, "mock-naive-a"));
  assertEquals(
    (await t.env.store.judgments(neg.executions[0]!.id))[0]!.verdict,
    "fail",
  );
  assertEquals(mockAdapter.credentialBearing, false);
});

Deno.test("mock arms: crash before work is retried once when unattended; usage limit pauses", async () => {
  await using t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  const crash = await runCell(t.env, await cellFor(t, "mock-crash"));
  assertEquals(crash.executions.map((e) => e.run_kind), [
    "planned",
    "auto_retry",
  ]);
  const usage = await runCell(t.env, await cellFor(t, "mock-usage"));
  assertEquals(usage.executions[0]!.termination, "usage_limited");
});

Deno.test("the variant is copied into the config dir, never into C:\\task", async () => {
  await using t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await runCell(t.env, await cellFor(t, "mock-positive"));
  const call = t.docker.runs[0]!;
  await assertRejects(() =>
    Deno.stat(join(call.mounts.get("C:\\task")!.src, "correct"))
  );
});

Deno.test("mock arms: crash after work is judged, not retried", async () => {
  await using t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  const r = await runCell(t.env, await cellFor(t, "mock-crash-after-work"));
  assertEquals(
    r.executions.map((e) => [e.termination, e.did_work]),
    [["harness_crash", true]],
  );
  assertEquals(
    (await t.env.store.judgments(r.executions[0]!.id))[0]!.verdict,
    "pass",
  );
});

Deno.test("mock arms: no qualification manifest, or an unlisted variant, is refused before anything runs", async () => {
  await using t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  const cell = await cellFor(t, "mock-positive");
  await assertRejects(
    () => runCell({ ...t.env, qualifyManifest: null }, cell),
    ConfigurationError,
    "qualification manifest",
  );
  await assertRejects(
    () =>
      runCell({
        ...t.env,
        qualifyManifest: {
          ...manifest,
          tasks: { "HX-002": manifest.tasks["HX-002"] },
        },
      }, cell),
    ConfigurationError,
    "HX-001",
  );
  assertEquals(t.docker.runs.length, 0);
});

async function runMockPs1(
  settings: Record<string, unknown>,
  extraEnv: Record<string, string> = {},
) {
  const root = await Deno.realPath(await testTempDir());
  const config = join(root, "config");
  const ws = join(root, "ws");
  await Deno.mkdir(join(config, "variant", "Rental", "src"), {
    recursive: true,
  });
  await Deno.mkdir(join(ws, "Rental", "src"), { recursive: true });
  await Deno.writeTextFile(join(ws, "Rental", "app.json"), "{}");
  await Deno.writeTextFile(join(ws, "Rental", "src", "Old.al"), "old");
  await Deno.writeTextFile(
    join(config, "variant", "Rental", "src", "New.al"),
    "new",
  );
  await Deno.writeTextFile(
    join(config, "variant", ".delete"),
    "# removed\r\nRental/src/Old.al\r\n",
  );
  await Deno.writeTextFile(
    join(config, "settings.json"),
    JSON.stringify({ settings }),
  );
  const secrets = join(root, "secrets");
  await Deno.mkdir(secrets);
  await Deno.writeTextFile(join(secrets, "ready"), "");
  const out = await new Deno.Command("pwsh", {
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      fromFileUrl(
        new URL("../../../harness/images/mock/mock.ps1", import.meta.url),
      ),
    ],
    env: {
      CG_MOCK_CONFIG: config,
      CG_MOCK_WORKSPACE: ws,
      CG_MOCK_SECRETS: secrets,
      ...extraEnv,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const lines = new TextDecoder().decode(out.stdout).split(/\r?\n/).filter(
    Boolean,
  ).map((l) => JSON.parse(l) as { type: string });
  return { ws, code: out.code, types: lines.map((l) => l.type), lines };
}

Deno.test({
  name:
    "mock.ps1: applies the variant with .delete semantics; hostile-app plants a .app",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const a = await runMockPs1({ mode: "apply" });
    assertEquals([a.code, a.types], [0, [
      "mock_init",
      "mock_apply",
      "mock_done",
    ]]);
    assertEquals(
      await Deno.readTextFile(join(a.ws, "Rental", "src", "New.al")),
      "new",
    );
    await assertRejects(() => Deno.stat(join(a.ws, "Rental", "src", "Old.al")));
    await assertRejects(() => Deno.stat(join(a.ws, ".delete")));
    const h = await runMockPs1({ mode: "hostile-app" });
    assertEquals(h.code, 0);
    await Deno.stat(join(h.ws, "Rental", "Rental.app"));
  },
});

// H-35 Phase 3: the subscriber-repair variants (design.md 9 item 4).
const SUBSCRIBER_REPAIR = {
  "subscriber-repair-reset-state": "FailBeforePost",
  "subscriber-repair-delete-row": "DropBatchSummaryRow",
  "subscriber-repair-is-handled": "LogErrorText",
};

Deno.test("hostile fixtures: agent-range ids that pass the verdict-workspace id checks and collide with no refapp or oracle object", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const taken = new Set(
    (await alObjects(join(root, "harness-tasks"))).map((o) => o.id),
  );
  // H-35 Phase 3: an edit of a shipped refapp file keeps that file's object.
  const shipped = new Map(
    (await alObjects(join(root, "harness-tasks", "refapp"))).map((
      o,
    ) => [o.file, o.id]),
  );
  const symbols = await loadSymbolsLock(root);
  const symbolIds = new Set(
    (symbols ?? []).map((s) => s.app_id.toLowerCase()),
  );
  for (
    const name of [
      "leave-state",
      "detect-state",
      ...Object.keys(SUBSCRIBER_REPAIR),
    ]
  ) {
    const fixture = join(root, HOSTILE_FIXTURES, name);
    for (const o of await alObjects(fixture)) {
      if (shipped.has(o.file)) {
        assertEquals(o.id, shipped.get(o.file), `${name}: ${o.file}`);
        continue;
      }
      assertEquals(taken.has(o.id), false, `${name}: ${o.id} is already used`);
    }
    const ws = await Deno.realPath(await testTempDir());
    await safeCopyTree(join(root, "harness-tasks", "refapp"), join(ws, "w"));
    await safeCopyTree(fixture, join(ws, "f"));
    for (const o of await alObjects(join(ws, "f"))) {
      const dst = join(ws, "w", ...o.file.split("/"));
      await Deno.mkdir(join(dst, ".."), { recursive: true });
      await Deno.copyFile(join(ws, "f", ...o.file.split("/")), dst);
    }
    const apps = await readAppGraph(join(ws, "w"));
    assertEquals(
      await validateApps(join(ws, "w"), apps, apps, symbolIds),
      [],
      name,
    );
  }
});

Deno.test("subscriber-repair fixtures: G holds the pristine 80090 (no repair subscriber), A holds the agent's 80090 and its test, and neither build has a violation", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const refapp = join(root, "harness-tasks", "refapp");
  const lib = join("Test", "src", "TestLibrary.Codeunit.al");
  const pristineLib = await Deno.readTextFile(join(refapp, lib));
  const symbolIds = new Set(
    ((await loadSymbolsLock(root)) ?? []).map((s) => s.app_id.toLowerCase()),
  );
  for (const [name, subscriber] of Object.entries(SUBSCRIBER_REPAIR)) {
    const fixture = join(root, HOSTILE_FIXTURES, name);
    const added = (await alObjects(fixture)).filter((o) =>
      o.file.startsWith("Test/") &&
      o.file !== "Test/src/TestLibrary.Codeunit.al"
    );
    assertEquals(added.length, 1, name);
    const ws = await Deno.realPath(await testTempDir());
    await safeCopyTree(refapp, join(ws, "pristine"));
    await safeCopyTree(refapp, join(ws, "artifact"));
    for (const o of await alObjects(fixture)) {
      const rel = o.file.split("/");
      await Deno.mkdir(join(ws, "artifact", ...rel, ".."), { recursive: true });
      await Deno.copyFile(join(fixture, ...rel), join(ws, "artifact", ...rel));
    }
    const build = (out: string, o: Record<string, boolean>) =>
      buildVerdictWorkspace({
        pristine: join(ws, "pristine"),
        artifact: join(ws, "artifact"),
        out: join(ws, out),
        symbolIds,
        onPrem: NO_ONPREM,
        ...o,
      });
    const g = await build("g", { rawTest: true });
    const a = await build("a", { dropShippedTests: true });
    assertEquals([g.violations, a.violations], [[], []], name);
    assertEquals([a.excluded, a.creditExcluded], [[], 0], name);
    const gLib = await Deno.readTextFile(join(g.dir, lib));
    assertEquals(gLib, pristineLib, `${name}: G's 80090 is pristine`);
    assert(!gLib.includes(subscriber), name);
    await assertRejects(() =>
      Deno.stat(join(g.dir, ...added[0]!.file.split("/")))
    );
    assert(
      (await Deno.readTextFile(join(a.dir, lib))).includes(subscriber),
      name,
    );
    await Deno.stat(join(a.dir, ...added[0]!.file.split("/")));
    // Production (the regression) is the agent's in both builds.
    for (const o of await alObjects(join(fixture, "Rental"))) {
      const rel = ["Rental", ...o.file.split("/")];
      const want = await Deno.readTextFile(join(fixture, ...rel));
      assertEquals(await Deno.readTextFile(join(g.dir, ...rel)), want, name);
      assertEquals(await Deno.readTextFile(join(a.dir, ...rel)), want, name);
    }
  }
});

// H-35 Phase 3: replay:<absolute dir> (the G byte-identity proof input).
const replayCopies = (variant: string) =>
  mockAdapter.configCopies!({
    settings: { mode: "apply", variant },
    task: {} as LoadedTask,
    repoRoot: "C:\\unused",
    qualify: null,
  });

Deno.test("mock replay: an absolute dir is copied as the variant; a relative one is refused", async () => {
  const dir = await Deno.realPath(await testTempDir());
  await Deno.mkdir(join(dir, "Rental", "src"), { recursive: true });
  await Deno.writeTextFile(join(dir, "Rental", "src", "A.al"), "a");
  assertEquals(replayCopies(`replay:${dir}`), [{ src: dir, dst: "variant" }]);
  for (const rel of ["replay:rel/dir", "replay:", "replay:C:rel"]) {
    assertThrows(() => replayCopies(rel), ConfigurationError, "absolute", rel);
  }
});

Deno.test("mock replay: anything that writes or deletes under the Test app (any case or Windows alias), or a freeze marker, is refused", async () => {
  const make = async (files: Record<string, string>) => {
    const dir = await Deno.realPath(await testTempDir());
    for (const [rel, text] of Object.entries(files)) {
      await Deno.mkdir(join(dir, rel, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, rel), text);
    }
    return dir;
  };
  const ok = { "Rental/src/A.al": "a" };
  for (
    const bad of [
      { "Test/src/X.al": "x" },
      { "test/src/X.al": "x" },
      { "TEST~1/src/X.al": "x" },
      { ".cg-freeze-violations.txt": "x" },
      { ".delete": "Test/src/BatchPostTests.Codeunit.al\n" },
      { ".delete": "# c\r\n./test\\src\\X.al\r\n" },
      { ".delete": "Test./src/X.al\n" },
      { ".delete": "Test /src/X.al\n" },
      { ".delete": "Test\n" },
    ]
  ) {
    const dir = await make({ ...ok, ...bad });
    assertThrows(
      () => replayCopies(`replay:${dir}`),
      ConfigurationError,
      "Test",
      JSON.stringify(bad),
    );
  }
  // A production .delete stays allowed.
  const dir = await make({ ...ok, ".delete": "Rental/src/Old.al\n" });
  assertEquals(replayCopies(`replay:${dir}`).length, 1);
});

Deno.test("mock replay: the run applies the replay dir; the shipped Test app stays pristine; a refused dir runs nothing", async () => {
  await using t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  const dir = await Deno.realPath(await testTempDir());
  await Deno.mkdir(join(dir, "Rental", "src"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "Rental", "src", "Rental.Codeunit.al"),
    'codeunit 70200 "CGR Rental"\n{\n    procedure Price(): Integer\n    begin\n        exit(10); // REPLAYED\n    end;\n}\n',
  );
  const config = (id: string, d: string) =>
    Deno.writeTextFile(
      join(t.harnessRoot, "configs", `${id}.yml`),
      `id: ${id}\nharness: mock\nharness_version: "2"\nmodels: {}\nsettings: ${
        JSON.stringify({ mode: "apply", variant: `replay:${d}` })
      }\nlimits: { timeout_min: 5, max_budget_usd: 1 }\n`,
    );
  await config("mock-replay", dir);
  const r = await runCell(t.env, await cellFor(t, "mock-replay"));
  const art = await t.env.store.artifact(r.executions[0]!.id);
  assert(art);
  const frozen = join(t.env.resultsRoot, art.stored_path);
  assert(
    (await Deno.readTextFile(
      join(frozen, "Rental", "src", "Rental.Codeunit.al"),
    ))
      .includes("REPLAYED"),
  );
  const shippedTest = join(
    "harness-tasks",
    "refapp",
    "Test",
    "src",
    "Shipped.Test.al",
  );
  assertEquals(
    await Deno.readTextFile(join(frozen, "Test", "src", "Shipped.Test.al")),
    await Deno.readTextFile(join(t.repo.root, shippedTest)),
  );
  const runs = t.docker.runs.length;
  await Deno.mkdir(join(dir, "Test", "src"), { recursive: true });
  await Deno.writeTextFile(join(dir, "Test", "src", "X.al"), "x");
  await config("mock-replay-bad", dir);
  await assertRejects(
    async () => runCell(t.env, await cellFor(t, "mock-replay-bad")),
    ConfigurationError,
    "Test",
  );
  assertEquals(t.docker.runs.length, runs);
});

Deno.test({
  name:
    "mock.ps1 hostile-case-alias: two distinct case-alias files; a failed fsutil, or no distinct case-alias files, is mock_error and a non-zero exit",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const bin = await Deno.realPath(await testTempDir());
    const failing = join(bin, "fsutil-fails.cmd");
    await Deno.writeTextFile(failing, "@exit /b 1\r\n");
    const noop = join(bin, "fsutil-noop.cmd");
    await Deno.writeTextFile(noop, "@exit /b 0\r\n");
    for (const fsutil of [failing, noop]) {
      const r = await runMockPs1({ mode: "hostile-case-alias" }, {
        CG_MOCK_FSUTIL: fsutil,
      });
      assertEquals(r.code !== 0, true, fsutil);
      assertEquals(r.types.includes("mock_error"), true, fsutil);
      assertEquals(r.types.includes("mock_done"), false, fsutil);
    }
    // The real fsutil (the per-directory case flag works on this host): two distinct files.
    const ok = await runMockPs1({ mode: "hostile-case-alias" });
    assertEquals([ok.code, ok.types.includes("mock_case_alias")], [0, true]);
    const names = [...Deno.readDirSync(join(ok.ws, "case-alias"))].map((e) =>
      e.name
    ).sort();
    assertEquals(names, ["A.txt", "a.txt"]);
  },
});

Deno.test("hostile edit-tests and app rows use a naive variant, so a fail proves the defense", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  for (const id of ["mock-hostile-edit-tests", "mock-hostile-app"]) {
    const c = HarnessConfigSchema.parse(
      parseYaml(
        await Deno.readTextFile(join(root, "harness", "configs", `${id}.yml`)),
      ),
    );
    assertEquals(c.settings["variant"], "naive:lock-table", id);
    assertEquals(c.settings["mode"], id.replace("mock-", ""), id);
  }
});

Deno.test({
  name:
    "mock.ps1 hostile-junction: a junction readable in container and host is created and verified; a failure is mock_error",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const ok = await runMockPs1({ mode: "hostile-junction" });
    assertEquals([ok.code, ok.types.includes("mock_junction")], [0, true]);
    assertEquals((await Deno.lstat(join(ok.ws, "host-link"))).isSymlink, true);
    const bad = await runMockPs1({ mode: "hostile-junction" }, {
      CG_MOCK_JUNCTION_TARGET: "C:\\cg-no-such-target-dir",
    });
    assertEquals(bad.code !== 0, true);
    assertEquals(bad.types.includes("mock_error"), true);
    assertEquals(bad.types.includes("mock_done"), false);
  },
});

Deno.test("mock.ps1 (H-01): waits for the runner's ready before reading its config or emitting anything; no admin guard of its own", async () => {
  const text = await Deno.readTextFile(
    fromFileUrl(
      new URL("../../../harness/images/mock/mock.ps1", import.meta.url),
    ),
  );
  const wait = text.indexOf("(Join-Path $Secrets 'ready')");
  assert(wait > 0);
  assert(
    wait < text.indexOf("Get-Content (Join-Path $Config 'settings.json')"),
  );
  assert(wait < text.indexOf("Emit 'mock_init'"));
  assert(!text.includes("cg-nonadmin"));
});

Deno.test({
  name:
    "mock.ps1: reports version 2, the harness_version of every repo mock config (H-01 run 004)",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const a = await runMockPs1({ mode: "apply" });
    const init = a.lines.find((l) => l.type === "mock_init") as
      | { version?: string }
      | undefined;
    assertEquals(init?.version, "2");
    for await (const e of Deno.readDir("harness/configs")) {
      if (!e.name.startsWith("mock-")) continue;
      const text = await Deno.readTextFile(join("harness/configs", e.name));
      assert(text.includes('harness_version: "2"'), e.name);
    }
  },
});
