import { assertEquals } from "@std/assert";
import { runBenchStep } from "../../../../src/lifecycle/steps/bench-step.ts";
import { cleanupTempDir, createTempDir } from "../../../utils/test-helpers.ts";

const isWindows = Deno.build.os === "windows";

Deno.test("bench-step writes bench.completed when results file is present", async () => {
  const tmp = await createTempDir("cycle-bench-step");
  try {
    await Deno.mkdir(`${tmp}/results`, { recursive: true });
    const fixture = {
      schemaVersion: "1.0",
      results: [
        { taskId: "CG-AL-E001", attempts: [{ ok: true }, { ok: false }] },
        { taskId: "CG-AL-E002", attempts: [{ ok: true }] },
      ],
    };
    // Mock-bench command writes the fixture results file. The temp dir is the
    // cwd of the spawned process, so write a relative path inside it. We use
    // bash on both platforms because git-bash ships on the Windows dev box and
    // CI runners (cmd's quoting rules make embedded JSON painful).
    const fixturePath = `${tmp}/results/run.json`;
    await Deno.writeTextFile(`${tmp}/.fixture.json`, JSON.stringify(fixture));
    const writeFixture = isWindows
      ? [
        "bash",
        "-c",
        `cp "$(cygpath -u '${tmp}/.fixture.json')" "$(cygpath -u '${fixturePath}')"`,
      ]
      : ["bash", "-c", `cp "${tmp}/.fixture.json" "${fixturePath}"`];
    const result = await runBenchStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        cwd: tmp,
      },
      { benchCmd: writeFixture },
    );
    assertEquals(result.success, true);
    assertEquals(result.eventType, "bench.completed");
    assertEquals(result.payload["runs_count"], 1);
    assertEquals(result.payload["tasks_count"], 2);
    assertEquals(result.payload["results_count"], 3);
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("bench-step writes bench.failed on non-zero exit", async () => {
  const tmp = await createTempDir("cycle-bench-step-fail");
  try {
    const fail = isWindows
      ? ["cmd", "/c", "exit", "1"]
      : ["bash", "-c", "exit 1"];
    const result = await runBenchStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        cwd: tmp,
      },
      { benchCmd: fail },
    );
    assertEquals(result.success, false);
    assertEquals(result.eventType, "bench.failed");
    assertEquals(result.payload["error_code"], "bench_nonzero_exit");
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("bench-step writes bench.failed when results file missing", async () => {
  const tmp = await createTempDir("cycle-bench-step-noresults");
  try {
    // Mock-bench command exits 0 but writes no results file.
    const noop = isWindows
      ? ["cmd", "/c", "exit", "0"]
      : ["bash", "-c", "true"];
    const result = await runBenchStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        cwd: tmp,
      },
      { benchCmd: noop },
    );
    assertEquals(result.success, false);
    assertEquals(result.eventType, "bench.failed");
    assertEquals(result.payload["error_code"], "results_file_missing");
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("bench-step writes bench.skipped on dry-run", async () => {
  const result = await runBenchStep({
    modelSlug: "anthropic/claude-opus-4-7",
    taskSetHash: "current",
    lockToken: "tok-1",
    envelope: {},
    toolVersions: {},
    analyzerModel: "anthropic/claude-opus-4-6",
    dryRun: true,
    cwd: ".",
  });
  assertEquals(result.success, true);
  assertEquals(result.eventType, "bench.skipped");
  assertEquals(result.payload["reason"], "dry_run");
});
