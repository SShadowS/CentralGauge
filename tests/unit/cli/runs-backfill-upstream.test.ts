// tests/unit/cli/runs-backfill-upstream.test.ts
//
// `centralgauge runs backfill-upstream <runId>` (spec 2026-09-11 D6, Task
// 15): read a finished batch run's stored responses and post one entry per
// attempt to the admin endpoint. Sync runs keep no raw response on disk, so
// a missing batch directory is an operator error, not an empty backfill.
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  type BackfillDeps,
  handleBackfillUpstream,
} from "../../../cli/commands/runs-command.ts";
import type { UpstreamBackfillEntry } from "../../../src/ingest/upstream-backfill.ts";
import { stripAnsi } from "../../../cli/tui/bench-tui.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

interface Recorder {
  out: string[];
  err: string[];
  exits: number[];
  posted: Array<{ runId: string; results: UpstreamBackfillEntry[] }>;
}

function depsFor(
  rec: Recorder,
  collected: Awaited<ReturnType<BackfillDeps["collect"]>>,
  postResult: Awaited<ReturnType<BackfillDeps["post"]>> = {
    status: 200,
    ok: true,
    updated: 1,
  },
): BackfillDeps {
  return {
    collect: () => Promise.resolve(collected),
    post: (_config, _key, req) => {
      rec.posted.push({ runId: req.runId, results: req.results });
      return Promise.resolve(postResult);
    },
    loadConfig: () =>
      Promise.resolve({
        url: "https://x",
        adminKeyPath: "/nope",
        adminKeyId: 7,
      }),
    readKey: () => Promise.resolve(new Uint8Array(32).fill(3)),
    log: (line) => rec.out.push(line),
    error: (line) => rec.err.push(line),
    exit: (code) => {
      rec.exits.push(code);
    },
  };
}

function recorder(): Recorder {
  return { out: [], err: [], exits: [], posted: [] };
}

/** A batch run directory is recognised by its `state.json`. */
async function makeRunDir(resultsDir: string, runId: string): Promise<void> {
  const dir = join(resultsDir, "batch", runId);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "state.json"),
    JSON.stringify({ tasks: {} }),
  );
}

const COLLECTED = {
  entries: [
    { task_id: "easy/t1", attempt: 1 as const, served_upstream: "Google" },
  ],
  skipped: [
    { task_id: "easy/t1", attempt: 2 as const, why: "no provider field" },
    { task_id: "easy/t2", attempt: 1 as const, why: "no response file" },
  ],
};

Deno.test("backfill-upstream posts the collected attempts and reports the skips", async () => {
  const resultsDir = await createTempDir("backfill-cmd");
  try {
    await makeRunDir(resultsDir, "r1");
    const rec = recorder();
    await handleBackfillUpstream(
      "r1",
      { resultsDir },
      depsFor(rec, COLLECTED),
    );
    assertEquals(rec.exits, []);
    assertEquals(rec.posted.length, 1);
    assertEquals(rec.posted[0]?.runId, "r1");
    assertEquals(rec.posted[0]?.results, COLLECTED.entries);
    const ok = rec.out.find((l) => l.includes("[OK]"));
    assertEquals(
      ok === undefined ? undefined : stripAnsi(ok),
      "[OK] run r1: 1 attempt updated, 2 skipped",
    );
    // Every skip is named, so an operator can tell a missing response from a
    // response the provider never labelled.
    assertEquals(
      rec.out.filter((l) => l.includes("skip ")).map((l) =>
        stripAnsi(l).trim()
      ),
      [
        "skip easy/t1 attempt 2: no provider field",
        "skip easy/t2 attempt 1: no response file",
      ],
    );
  } finally {
    await cleanupTempDir(resultsDir);
  }
});

Deno.test("backfill-upstream fails when there is no batch run directory", async () => {
  const resultsDir = await createTempDir("backfill-cmd-missing");
  try {
    const rec = recorder();
    await handleBackfillUpstream(
      "r9",
      { resultsDir },
      depsFor(rec, COLLECTED),
    );
    assertEquals(rec.exits, [1]);
    assertEquals(rec.posted, []);
    const fail = stripAnsi(rec.err[0] ?? "");
    assertEquals(
      fail,
      `[FAIL] No batch run directory at ${
        join(resultsDir, "batch", "r9")
      }; sync runs have no stored responses to backfill from`,
    );
  } finally {
    await cleanupTempDir(resultsDir);
  }
});

Deno.test("backfill-upstream --dry-run prints the entries and posts nothing", async () => {
  const resultsDir = await createTempDir("backfill-cmd-dry");
  try {
    await makeRunDir(resultsDir, "r1");
    const rec = recorder();
    await handleBackfillUpstream(
      "r1",
      { resultsDir, dryRun: true },
      depsFor(rec, COLLECTED),
    );
    assertEquals(rec.posted, []);
    assertEquals(rec.exits, []);
    const plain = rec.out.map((l) => stripAnsi(l).trim());
    assertEquals(plain.includes("easy/t1 attempt 1: Google"), true);
    assertEquals(
      plain.includes("[DRY-RUN] 1 attempt would be posted, 2 skipped"),
      true,
    );
  } finally {
    await cleanupTempDir(resultsDir);
  }
});

Deno.test("backfill-upstream exits 1 when the endpoint refuses", async () => {
  const resultsDir = await createTempDir("backfill-cmd-refuse");
  try {
    await makeRunDir(resultsDir, "r1");
    const rec = recorder();
    await handleBackfillUpstream(
      "r1",
      { resultsDir },
      depsFor(rec, COLLECTED, {
        status: 409,
        ok: false,
        code: "already_set",
        message: "already recorded",
      }),
    );
    assertEquals(rec.exits, [1]);
    assertEquals(
      stripAnsi(rec.err[0] ?? ""),
      "[FAIL] backfill-upstream r1: 409 already_set - already recorded",
    );
  } finally {
    await cleanupTempDir(resultsDir);
  }
});

Deno.test("backfill-upstream posts nothing when the run yielded no entries", async () => {
  const resultsDir = await createTempDir("backfill-cmd-empty");
  try {
    await makeRunDir(resultsDir, "r1");
    const rec = recorder();
    await handleBackfillUpstream(
      "r1",
      { resultsDir },
      depsFor(rec, {
        entries: [],
        skipped: [{ task_id: "easy/t1", attempt: 1, why: "no provider field" }],
      }),
    );
    assertEquals(rec.posted, []);
    assertEquals(rec.exits, []);
    const plain = rec.out.map((l) => stripAnsi(l).trim());
    assertEquals(
      plain.includes(
        "[OK] run r1: nothing to backfill, 1 skipped",
      ),
      true,
    );
  } finally {
    await cleanupTempDir(resultsDir);
  }
});

Deno.test("backfill-upstream names the file when the run state cannot be read", async () => {
  const resultsDir = await createTempDir("backfill-cmd-corrupt");
  try {
    await makeRunDir(resultsDir, "r1");
    const rec = recorder();
    const deps = depsFor(rec, COLLECTED);
    deps.collect = () =>
      Promise.reject(new SyntaxError("Unexpected end of JSON input"));
    await handleBackfillUpstream("r1", { resultsDir }, deps);
    assertEquals(rec.exits, [1]);
    assertEquals(rec.posted, []);
    assertEquals(
      stripAnsi(rec.err[0] ?? ""),
      `[FAIL] could not read ${
        join(resultsDir, "batch", "r1")
      }: Unexpected end of JSON input`,
    );
  } finally {
    await cleanupTempDir(resultsDir);
  }
});
