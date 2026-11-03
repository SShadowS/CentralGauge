/**
 * H-54: the job-worktree results guard and `harness archive`.
 */
import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { dirname, join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  archiveResults,
  resultsDirCheck,
} from "../../../src/harness/results-root.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

async function put(path: string, text: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, text);
}

const exists = async (p: string) => {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
};

/** A coord root with jobs/<name> registered as a git worktree. */
async function coord(): Promise<
  { root: string; jobs: string; worktree: (name: string) => Promise<string> }
> {
  const root = await testTempDir({ prefix: "h54-coord-" });
  const jobs = join(root, "jobs");
  const gitdirs = join(root, "repo.git", "worktrees");
  return {
    root,
    jobs,
    worktree: async (name) => {
      const wt = join(jobs, name);
      await Deno.mkdir(join(gitdirs, name), { recursive: true });
      await put(join(wt, ".git"), `gitdir: ${join(gitdirs, name)}\n`);
      return wt;
    },
  };
}

/** A small finished record root. */
async function records(root: string, campaign = "c1"): Promise<void> {
  await put(
    join(root, "campaigns", `${campaign}.json`),
    `{"id":"${campaign}"}`,
  );
  await put(join(root, "executions", campaign, "e1.json"), '{"e":1}');
  await put(join(root, "runs", "r1.json"), '{"r":1}');
  await put(join(root, "cells", "executions", "x", "e9.json"), '{"cell":1}');
}

Deno.test("H-54 guard: a new results dir inside a job worktree is refused", async () => {
  const c = await coord();
  const wt = await c.worktree("P-09");
  const check = resultsDirCheck(join(wt, "results", "harness-m5"), c.jobs);
  assert(check?.refuse);
  assert(check.refuse.includes(wt));
  assert(check.refuse.includes("--results-dir"));
});

Deno.test("H-54 guard: an existing records root inside a job worktree only warns", async () => {
  const c = await coord();
  const wt = await c.worktree("M8-16a");
  const dir = join(wt, "results", "harness");
  await records(dir);
  const check = resultsDirCheck(dir, c.jobs);
  assertFalse(check?.refuse);
  assert(check?.warn?.includes("harness archive"));
  // a cells root (executions, no campaigns) is an existing root too
  assertFalse(resultsDirCheck(join(dir, "cells"), c.jobs)?.refuse);
});

Deno.test("H-54 guard: removed worktrees, stale .git files and dirs outside jobs pass", async () => {
  const c = await coord();
  // a job dir that is no longer a worktree (no .git)
  assertEquals(
    resultsDirCheck(join(c.jobs, "Q-09", "results", "harness"), c.jobs),
    null,
  );
  // a .git file whose gitdir is gone: not a registered worktree
  await put(join(c.jobs, "C-08", ".git"), `gitdir: ${join(c.root, "gone")}\n`);
  assertEquals(
    resultsDirCheck(join(c.jobs, "C-08", "results", "harness"), c.jobs),
    null,
  );
  // outside jobs
  assertEquals(
    resultsDirCheck(join(c.root, "results", "harness"), c.jobs),
    null,
  );
});

Deno.test("H-54 archive: copies records, skips machine state, verifies by hash, idempotent", async () => {
  const c = await coord();
  const wt = await c.worktree("P-02");
  const from = join(wt, "results", "harness");
  const to = join(c.root, "results", "harness");
  await records(from);
  for (
    const skip of [
      "symbols/a.app",
      "baselines/b.json",
      "bc-ledger/l.json",
      "egress-host.jsonl",
      "egress-verified.json",
      "egress-verified.json.superseded-by-recreate",
      ".bench-running.json",
      "claims/e1/.bench-running.json",
      "runs/r2.json.tmp-abc",
    ]
  ) {
    await put(join(from, skip), "machine state");
  }
  // a stale marker (a crashed or finished run) is skipped, not "live"
  const old = new Date(Date.now() - 3_600_000);
  await Deno.utime(join(from, ".bench-running.json"), old, old);
  const r1 = await archiveResults({ from, to, coordRoot: c.root });
  assertEquals(r1.copied, 4);
  assertEquals(r1.present, 0);
  assertEquals(r1.verified, 4);
  assertEquals(r1.skipped, [
    "baselines",
    "bc-ledger",
    "egress-host.jsonl",
    "egress-verified.json",
    "egress-verified.json.superseded-by-recreate",
    "symbols",
  ]);
  assertEquals(
    await Deno.readTextFile(join(to, "cells", "executions", "x", "e9.json")),
    '{"cell":1}',
  );
  assertFalse(await exists(join(to, "symbols")));
  assertFalse(await exists(join(to, ".bench-running.json")));
  assertFalse(await exists(join(to, "claims")));
  assertFalse(await exists(join(to, "runs", "r2.json.tmp-abc")));
  const r2 = await archiveResults({ from, to, coordRoot: c.root });
  assertEquals([r2.copied, r2.present, r2.verified], [0, 4, 4]);
  // a second root merges into the same shared root
  const other = join(await c.worktree("R-07-branch"), "results", "harness");
  await put(join(other, "campaigns", "c2.json"), '{"id":"c2"}');
  const r3 = await archiveResults({ from: other, to, coordRoot: c.root });
  assertEquals([r3.copied, r3.present], [1, 0]);
});

Deno.test("H-54 archive: a same-path file with other content refuses and copies nothing", async () => {
  const c = await coord();
  const from = join(await c.worktree("P-02"), "results", "harness");
  const to = join(c.root, "results", "harness");
  await records(from);
  await put(join(to, "runs", "r1.json"), '{"r":"different"}');
  const e = await assertRejects(
    () => archiveResults({ from, to, coordRoot: c.root }),
    ConfigurationError,
  );
  assert(e.message.includes(join("runs", "r1.json")));
  assertFalse(await exists(join(to, "campaigns")));
  assertEquals(
    await Deno.readTextFile(join(to, "runs", "r1.json")),
    '{"r":"different"}',
  );
});

Deno.test("H-54 archive: a coord-task copy is refused unless allowed", async () => {
  const c = await coord();
  const from = join(c.root, "tasks", "H-35", "proof", "results");
  const to = join(c.root, "results", "harness");
  await records(from);
  const e = await assertRejects(
    () => archiveResults({ from, to, coordRoot: c.root }),
    ConfigurationError,
  );
  assert(e.message.includes("--allow-coord-copy"));
  assertFalse(await exists(to));
  const r = await archiveResults({
    from,
    to,
    coordRoot: c.root,
    allowCoordCopy: true,
  });
  assertEquals(r.copied, 4);
});

Deno.test("H-54 archive: refuses a non-records source, overlapping roots and a job-worktree destination", async () => {
  const c = await coord();
  const wt = await c.worktree("P-02");
  const from = join(wt, "results", "harness");
  await records(from);
  const empty = join(c.root, "empty");
  await Deno.mkdir(empty);
  for (
    const [f, t] of [
      [empty, join(c.root, "shared")],
      [from, from],
      [from, join(from, "archive")],
      [join(c.root, "shared2"), join(c.root, "shared2", "x")],
      [from, join(await c.worktree("H-99"), "results", "harness")],
    ] as [string, string][]
  ) {
    await assertRejects(
      () => archiveResults({ from: f, to: t, coordRoot: c.root }),
      ConfigurationError,
    );
  }
});

Deno.test("H-54 archive: a source under a live bench marker is refused", async () => {
  const c = await coord();
  const wt = await c.worktree("M8-16a");
  const from = join(wt, "results", "harness");
  await records(from);
  await put(join(wt, "results", ".bench-running.json"), '{"pid":1}');
  const e = await assertRejects(
    () =>
      archiveResults({
        from,
        to: join(c.root, "results", "harness"),
        coordRoot: c.root,
      }),
    ConfigurationError,
  );
  assert(e.message.includes("live"));
});
