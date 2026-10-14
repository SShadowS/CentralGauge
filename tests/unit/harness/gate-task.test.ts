import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import type { ALProject, TestResult } from "../../../src/container/types.ts";
import { ContainerError } from "../../../src/errors.ts";
import type { GateBc } from "../../../scripts/harness/gate-task.ts";
import { runGate, runVariant } from "../../../scripts/harness/gate-task.ts";
import { summarize } from "../../../scripts/harness/gate-core.ts";
import { parseCompilationErrors } from "../../../src/container/bc-output-parsers.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { tmp, writeTask } from "./gate-fixtures.ts";

function mockBc(o: {
  failCompile?: string;
  compileOut?: { codes: string[]; detail: string };
  failPublish?: string;
  publishError?: string;
  soapThrows?: boolean;
  emptyResults?: boolean;
  prenukeThrowsAfter?: number;
  seen?: string[];
  ran?: number[];
  /** H-05: prenuke / clean / publish calls, in order. */
  events?: string[];
  cleanThrows?: boolean;
  /** H-05 run 002: publish rejects like publishApp: generic message, raw output. */
  publishRaw?: string;
}): GateBc {
  let prenukes = 0;
  return {
    cleanData: (apps) => {
      o.events?.push(`clean ${apps.map((a) => a.name).join(",")}`);
      return o.cleanThrows
        ? Promise.reject(new Error("SYNC_CLEAN_FAILED"))
        : Promise.resolve();
    },
    prenuke: (owned = []) => {
      o.events?.push(
        owned.length > 0
          ? `prenuke ${owned.map((a) => a.name).join(",")}`
          : "prenuke",
      );
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
        return {
          ok: false,
          ...(o.compileOut ?? { codes: ["AL0118"], detail: "AL0118 missing" }),
        };
      }
      const artifact = join(p.path, "out.app");
      await Deno.writeTextFile(artifact, "x");
      return { ok: true, codes: [], detail: "", artifact };
    },
    publish: (a: string) => {
      o.events?.push("publish");
      if (o.publishRaw !== undefined) {
        return Promise.reject(
          new ContainerError("Publish failed", "C1", "publish", {
            rawOutput: o.publishRaw,
          }),
        );
      }
      return a.includes(`${o.failPublish}`) && o.failPublish
        ? Promise.reject(new Error(o.publishError ?? "publish failed"))
        : Promise.resolve();
    },
    runTests: (codeunit: number): Promise<TestResult> => {
      o.ran?.push(codeunit);
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

Deno.test("runVariant (H-05): after the prenuke and before any publish, the staged CGR apps' kept data is cleaned", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const events: string[] = [];
  const r = await runVariant(
    mockBc({ events }),
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  assertEquals(r.infra, undefined);
  // Run 002: the prenuke gets the same owned list (trusted id + exact name).
  const owned = events[1]!.slice("clean ".length);
  assertEquals(events[0], `prenuke ${owned}`);
  assert(events[1]!.startsWith("clean "), events.join(" | "));
  const names = events[1]!.slice("clean ".length).split(",");
  for (
    const n of ["CGR Core", "CGR Fleet", "CGR Rental", "CGR Oracle HX-001"]
  ) {
    assert(names.includes(n), `${n} not cleaned: ${names}`);
  }
  // Only CentralGauge apps of the harness bands (the trusted allowlist).
  assert(
    names.every((n) => n.startsWith("CGR ") || n.includes("Oracle")),
    names.join(),
  );
  assertEquals(events.slice(2).every((e) => e === "publish"), true);
});

Deno.test("runVariant (H-05 run 002): a refused publish keeps the redacted raw output (CG_SCRIPT_THREW + the BC refusal) in the report", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const secret = "sk-ant-api03-" + "x".repeat(30);
  const r = await runVariant(
    mockBc({
      // Session noise that would match PUBLISH_COLLISION ("already exists")
      // plus a [CG-PIN] line carrying host details, around the BC refusal.
      publishRaw:
        `[CG-PIN] host=H user=me PSModulePath=C:\\Users\\me\\x\nWARN: folder already exists\nCG_SCRIPT_THREW: Cannot install the extension CGR Core by CentralGauge 1.0.0.0 because a newer version 1.0.25913.28211 was already installed. ${secret}`,
    }),
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  const failed = r.builds.find((b) => b.stage === "publish" && !b.ok)!;
  // The decision text stays the error message; the raw output is evidence.
  assertEquals(failed.detail, "Publish failed");
  const raw = failed.raw ?? "";
  assertStringIncludes(raw, "CG_SCRIPT_THREW");
  assertStringIncludes(
    raw,
    "a newer version 1.0.25913.28211 was already installed",
  );
  assertEquals(raw.includes(secret), false, raw);
  assertEquals(raw.includes("[CG-PIN]"), false, raw);
  // Noise in the raw output never turns an infra publish into a collision.
  assertEquals(summarize(loaded.task, r).infra, true);
});

Deno.test("runVariant (H-05): a failed data clean is infra; nothing is published", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const events: string[] = [];
  const r = await runVariant(
    mockBc({ events, cleanThrows: true }),
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  assertStringIncludes(r.infra ?? "", "SYNC_CLEAN_FAILED");
  assertEquals(events.includes("publish"), false);
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
  // H-05 run 002: a task without fail_to_pass has no oracle folder.
  await Deno.remove(join(source.taskDir, "oracle"), { recursive: true });
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
  assertEquals(r.infra, undefined);
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

// M8-01c: a compile failure with no real AL code (OOM / pipe death) is infra, never scored.
for (
  const compileOut of [
    { codes: [], detail: "Compilation failed (errors=0, warnings=0)" },
    {
      codes: ["AL0000"],
      detail: "AL0000 No process is on the other end of the pipe",
    },
  ]
) {
  Deno.test(`runGate: infra-shaped compile failure is infra/rerun (${compileOut.detail.slice(0, 30)})`, async () => {
    const { loaded, source, tmpRoot } = await fixture();
    const bc = mockBc({ failCompile: "Fleet", compileOut });
    const r = await runVariant(
      bc,
      loaded.task,
      source,
      { kind: "correct" },
      1,
      tmpRoot,
    );
    assert(r.infra?.startsWith("compile infra: Fleet:"), r.infra);
    assert(summarize(loaded.task, r).infra);
    const { file, code } = await runGate({
      bc,
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
      report.reasons.some((x: string) => x.includes("infra, rerun")),
      report.reasons.join("; "),
    );
  });
}

Deno.test("runVariant: a compile failure with a real AL code stays a scored build failure", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const r = await runVariant(
    mockBc({ failCompile: "Fleet" }),
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  assertEquals(r.infra, undefined);
  assertEquals(r.builds.at(-1)?.codes, ["AL0118"]);
  assertEquals(summarize(loaded.task, r).infra, false);
});

Deno.test("runVariant: a real AL code wins over an infra-looking detail", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const r = await runVariant(
    mockBc({
      failCompile: "Fleet",
      compileOut: {
        codes: ["AL0118"],
        detail: "AL0118 The name 'Pipeline' does not exist; no pipe here",
      },
    }),
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  assertEquals(r.infra, undefined);
  assertEquals(r.builds.at(-1)?.codes, ["AL0118"]);
  assertEquals(summarize(loaded.task, r).infra, false);
});

// M8-01c run 002: CompileOut built from raw output by the real parser, as containerBc does.
function parsedCompile(raw: string) {
  const errors = parseCompilationErrors(raw);
  return {
    codes: errors.map((e) => e.code),
    detail: errors.map((e) => `${e.code} ${e.message}`).join("; "),
  };
}

Deno.test("runVariant: parser-synthesized AL0000 from a pre-ALC failure stays scored", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const compileOut = parsedCompile("ERROR:Unable to locate system symbols");
  assertEquals(compileOut.codes, ["AL0000"]);
  const r = await runVariant(
    mockBc({ failCompile: "Fleet", compileOut }),
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  assertEquals(r.infra, undefined);
  assertEquals(r.builds.at(-1)?.codes, ["AL0000"]);
  assertEquals(summarize(loaded.task, r).infra, false);
});

Deno.test("runVariant: parser-synthesized AL0000 pipe death is infra", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const compileOut = parsedCompile(
    "ERROR:No process is on the other end of the pipe. (0xE9)",
  );
  assertEquals(compileOut.codes, ["AL0000"]);
  const r = await runVariant(
    mockBc({ failCompile: "Fleet", compileOut }),
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  assert(r.infra?.startsWith("compile infra: Fleet:"), r.infra);
});

Deno.test("runVariant: an Oracle compile infra fault skips all test execution", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const ran: number[] = [];
  const r = await runVariant(
    mockBc({
      failCompile: "Oracle",
      compileOut: { codes: [], detail: "Compilation failed (errors=0)" },
      ran,
    }),
    loaded.task,
    source,
    { kind: "correct" },
    1,
    tmpRoot,
  );
  assert(r.infra?.startsWith("compile infra: Oracle:"), r.infra);
  assertEquals(ran, []);
  assertEquals(r.tests, []);
});
