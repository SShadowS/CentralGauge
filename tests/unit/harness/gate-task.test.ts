import { assert, assertEquals } from "@std/assert";
import { basename, join } from "@std/path";
import type { ALProject, TestResult } from "../../../src/container/types.ts";
import type { GateBc } from "../../../scripts/harness/gate-task.ts";
import { runGate, runVariant } from "../../../scripts/harness/gate-task.ts";
import { summarize } from "../../../scripts/harness/gate-core.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { tmp, writeTask } from "./gate-fixtures.ts";

function mockBc(o: {
  failCompile?: string;
  failPublish?: string;
  publishError?: string;
  soapThrows?: boolean;
  emptyResults?: boolean;
  prenukeThrowsAfter?: number;
  seen?: string[];
}): GateBc {
  let prenukes = 0;
  return {
    prenuke: () => {
      prenukes++;
      if (
        o.prenukeThrowsAfter !== undefined && prenukes > o.prenukeThrowsAfter
      ) {
        return Promise.reject(new Error("prenuke failed"));
      }
      return Promise.resolve();
    },
    compile: async (p: ALProject) => {
      o.seen?.push(p.path);
      if (basename(p.path) === o.failCompile) {
        return { ok: false, codes: ["AL0118"], detail: "AL0118 missing" };
      }
      const artifact = join(p.path, "out.app");
      await Deno.writeTextFile(artifact, "x");
      return { ok: true, codes: [], detail: "", artifact };
    },
    publish: (a: string) =>
      a.includes(`${o.failPublish}`) && o.failPublish
        ? Promise.reject(new Error(o.publishError ?? "publish failed"))
        : Promise.resolve(),
    runTests: (codeunit: number): Promise<TestResult> => {
      if (o.soapThrows) return Promise.reject(new Error("SOAP timeout"));
      if (o.emptyResults) {
        return Promise.resolve({
          success: true,
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          duration: 1,
          results: [],
          output: "",
        });
      }
      const name = codeunit === 80010 ? "Visible" : "Hidden";
      return Promise.resolve({
        success: true,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        duration: 1,
        results: [{ name, passed: true, duration: 1 }],
        output: "",
      });
    },
    dispose: () => Promise.resolve(),
  };
}

async function fixture() {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "# Bug\n");
  const loaded = await loadTask(dir);
  const source = {
    commit: "c".repeat(40),
    root,
    refappDir: join(root, "harness-tasks/refapp"),
    refappTree: "r".repeat(40),
    taskDir: dir,
    taskTree: "t".repeat(40),
  };
  const tmpRoot = await tmp();
  return { root, loaded, source, tmpRoot };
}

Deno.test("runVariant: compile failure stops the chain and is a compile step", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const r = await runVariant(
    mockBc({ failCompile: "Fleet" }),
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  assertEquals(r.builds.map((b) => `${b.app}:${b.stage}:${b.ok}`), [
    "Core:publish:true",
    "Fleet:compile:false",
  ]);
  assertEquals(r.builds[1]!.codes, ["AL0118"]);
  assertEquals(r.tests, []);
});

Deno.test("runVariant: oracle publish failure is recorded as publish", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const r = await runVariant(
    mockBc({ failPublish: "Oracle" }),
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  assertEquals(r.builds.at(-1), {
    app: "Oracle",
    stage: "publish",
    ok: false,
    codes: [],
    detail: "publish failed",
  });
});

Deno.test("runVariant: temp dirs live under the tmp root and are removed", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const seen: string[] = [];
  await runVariant(
    mockBc({ seen }),
    loaded.task,
    source,
    { kind: "baseline" },
    1,
    tmpRoot,
  );
  assert(
    seen.length > 0 && seen.every((p) => p.startsWith(tmpRoot)),
    seen.join(", "),
  );
  assertEquals([...Deno.readDirSync(tmpRoot)].length, 0);
});

Deno.test("runGate: SOAP failure is infra and the report survives a failing cleanup", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const outDir = await tmp();
  const { file, code } = await runGate({
    bc: mockBc({ soapThrows: true, prenukeThrowsAfter: 1 }),
    loaded,
    source,
    container: "Mock",
    outDir,
    tmpRoot,
    tagTree: null,
  });
  assertEquals(code, 3);
  const report = JSON.parse(await Deno.readTextFile(file));
  assertEquals(report.promoted, false);
  assertEquals(report.tag_status, "pending");
  assert(report.reasons.some((x: string) => x.includes("infra")));
  assert(String(report.cleanup_error).includes("prenuke failed"));
});

Deno.test("runVariant: candidate test-authoring counts only added codeunits", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const yml = join(source.taskDir, "task.yml");
  await Deno.writeTextFile(
    yml,
    (await Deno.readTextFile(yml))
      .replace("kind: bugfix", "kind: test-authoring")
      .replace("fail_to_pass]", "mutant_kill]")
      .replace(/fail_to_pass:\n[\s\S]*$/, ""),
  );
  const ta = (await loadTask(source.taskDir)).task;
  const ws = await tmp();
  await writeTask(ws, "HX-009", "x"); // any refapp copy; only Test/ below matters
  const cand = join(ws, "harness-tasks/refapp");
  await Deno.writeTextFile(
    join(cand, "Test/src/New.al"),
    'codeunit 80200 "New"\n{\n    Subtype = Test;\n    TestPermissions = Disabled;\n\n    [Test]\n    procedure Mine()\n    begin\n    end;\n}\n',
  );
  const r = await runVariant(
    mockBc({}),
    ta,
    source,
    { kind: "candidate", dir: cand, mutant: null },
    1,
    tmpRoot,
  );
  assertEquals(r.own, [{ codeunit: 80200, procedures: ["Mine"] }]);
  assertEquals(loaded.task.id, "HX-001");
});

Deno.test("runVariant: zero results from a codeunit is infra", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const r = await runVariant(
    mockBc({ emptyResults: true }),
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  assert(r.infra?.includes("zero results"), r.infra);
});

Deno.test("runGate: a staging exception still cleans up and writes an infra report", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  await Deno.remove(join(source.refappDir, "Reporting"), { recursive: true });
  const { file, code } = await runGate({
    bc: mockBc({}),
    loaded,
    source,
    container: "Mock",
    outDir: await tmp(),
    tmpRoot,
    tagTree: null,
  });
  assertEquals(code, 3);
  const report = JSON.parse(await Deno.readTextFile(file));
  assert(
    report.reasons.some((x: string) => x.includes("refapp module missing")),
  );
});

Deno.test("runGate: tag mismatch blocks promotion", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const { file } = await runGate({
    bc: mockBc({}),
    loaded,
    source,
    container: "Mock",
    outDir: await tmp(),
    tmpRoot,
    tagTree: "x".repeat(40),
  });
  const report = JSON.parse(await Deno.readTextFile(file));
  assertEquals(report.tag_status, "mismatch");
  assertEquals(report.promoted, false);
});

// Orchestrator ruling (M4-01b): a staged variant whose objects collide on
// publish is a candidate build failure, never infra.
for (
  const msg of [
    "The object Codeunit 70100 already exists in another extension",
    "The name 'CGR Vehicle' is already declared by another extension",
  ]
) {
  Deno.test(`runGate: publish collision is a build failure, not infra (${msg.slice(0, 30)})`, async () => {
    const { loaded, source, tmpRoot } = await fixture();
    const bc = mockBc({ failPublish: "Fleet", publishError: msg });
    const r = await runVariant(
      bc,
      loaded.task,
      source,
      { kind: "correct" },
      1,
      tmpRoot,
    );
    assertEquals(r.builds.at(-1), {
      app: "Fleet",
      stage: "publish",
      ok: false,
      codes: [],
      detail: msg,
    });
    assertEquals(r.infra, undefined);
    assertEquals(summarize(loaded.task, r).infra, false);
    const { file, code } = await runGate({
      bc,
      loaded,
      source,
      container: "Mock",
      outDir: await tmp(),
      tmpRoot,
      tagTree: null,
    });
    assertEquals(code, 1);
    const report = JSON.parse(await Deno.readTextFile(file));
    assertEquals(report.promoted, false);
    assertEquals(report.matrix_complete, true);
    assert(
      !report.reasons.some((x: string) => x.includes("infra")),
      report.reasons.join("; "),
    );
  });
}

// Orchestrator ruling (M4-01c review, a): the BCH unpublish race also produces
// "same App ID and Version", so it stays infra (exit 3, retryable).
Deno.test("runGate: 'same App ID and Version' on publish stays infra", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const msg =
    "An application with the same App ID and Version is already published";
  const bc = mockBc({ failPublish: "Fleet", publishError: msg });
  const r = await runVariant(
    bc,
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  assertEquals(r.builds.at(-1)?.detail, msg);
  assert(summarize(loaded.task, r).infra);
  const { code } = await runGate({
    bc,
    loaded,
    source,
    container: "Mock",
    outDir: await tmp(),
    tmpRoot,
    tagTree: null,
  });
  assertEquals(code, 3);
});

Deno.test("runVariant: a non-collision publish failure stays infra", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const r = await runVariant(
    mockBc({ failPublish: "Fleet" }),
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  assertEquals(r.builds.at(-1)?.stage, "publish");
  assert(summarize(loaded.task, r).infra);
});
