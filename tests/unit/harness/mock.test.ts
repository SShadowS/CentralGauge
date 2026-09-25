import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  HOSTILE_FIXTURES,
  mockAdapter,
  resolveVariant,
} from "../../../src/harness/adapters/mock.ts";
import { HarnessConfigSchema } from "../../../src/harness/config.ts";
import { runCell } from "../../../src/harness/execution.ts";
import { safeCopyTree } from "../../../src/harness/fsutil.ts";
import { loadSymbolsLock } from "../../../src/harness/identity.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import {
  alObjects,
  validateApps,
} from "../../../src/harness/verdict-workspace.ts";
import { cellFor, makeEnv, mockImageBehavior } from "./runtime-fixture.ts";

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
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await runCell(t.env, await cellFor(t, "mock-positive"));
  const call = t.docker.runs[0]!;
  await assertRejects(() =>
    Deno.stat(join(call.mounts.get("C:\\task")!.src, "correct"))
  );
});

Deno.test("mock arms: crash after work is judged, not retried", async () => {
  const t = await makeEnv();
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
  const t = await makeEnv();
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
  const root = await Deno.realPath(await Deno.makeTempDir());
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
  const out = await new Deno.Command("pwsh", {
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      fromFileUrl(
        new URL("../../../harness/images/mock/mock.ps1", import.meta.url),
      ),
    ],
    env: { CG_MOCK_CONFIG: config, CG_MOCK_WORKSPACE: ws, ...extraEnv },
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

Deno.test("hostile fixtures: agent-range ids that pass the verdict-workspace id checks and collide with no refapp or oracle object", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const taken = new Set(
    (await alObjects(join(root, "harness-tasks"))).map((o) => o.id),
  );
  const symbols = await loadSymbolsLock(root);
  const symbolIds = new Set(
    (symbols ?? []).map((s) => s.app_id.toLowerCase()),
  );
  for (const name of ["leave-state", "detect-state"]) {
    const fixture = join(root, HOSTILE_FIXTURES, name);
    for (const o of await alObjects(fixture)) {
      assertEquals(taken.has(o.id), false, `${name}: ${o.id} is already used`);
    }
    const ws = await Deno.realPath(await Deno.makeTempDir());
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

Deno.test({
  name:
    "mock.ps1 hostile-case-alias: two distinct case-alias files; a failed fsutil, or no distinct case-alias files, is mock_error and a non-zero exit",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const bin = await Deno.realPath(await Deno.makeTempDir());
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
