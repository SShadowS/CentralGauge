/**
 * H-54: the job-worktree results guard and `harness archive`.
 */
import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { dirname, join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  type ArchiveOptions,
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

const old = new Date(Date.now() - 3_600_000);

/** A coord root with jobs/<name> registered as a git worktree. */
async function coord() {
  const root = await testTempDir({ prefix: "h54-coord-" });
  const jobs = join(root, "jobs");
  const gitdirs = join(root, "repo.git", "worktrees");
  return {
    root,
    jobs,
    worktree: async (name: string) => {
      const wt = join(jobs, name);
      await Deno.mkdir(join(gitdirs, name), { recursive: true });
      await put(join(wt, ".git"), `gitdir: ${join(gitdirs, name)}\n`);
      return wt;
    },
    /** archive with no quiet window (test files are fresh) */
    archive: (o: Omit<ArchiveOptions, "coordRoot">) =>
      archiveResults({ quietMs: 0, coordRoot: root, ...o }),
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

async function refused(
  p: Promise<unknown>,
  why: string,
): Promise<void> {
  const e = await assertRejects(() => p, ConfigurationError);
  assert(e.message.includes(why), `"${e.message}" lacks "${why}"`);
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
  const cells = resultsDirCheck(join(dir, "cells"), c.jobs);
  assertFalse(cells?.refuse);
  assert(cells?.warn);
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

Deno.test("H-54 guard: a relative gitdir and a junction into a job worktree are both seen", async () => {
  const c = await coord();
  const wt = join(c.jobs, "R-01");
  await Deno.mkdir(join(c.root, "repo.git", "worktrees", "R-01"), {
    recursive: true,
  });
  await put(join(wt, ".git"), "gitdir: ../../repo.git/worktrees/R-01\n");
  assert(resultsDirCheck(join(wt, "results", "harness"), c.jobs)?.refuse);
  const alias = join(c.root, "alias");
  await Deno.symlink(wt, alias, { type: "junction" });
  assert(resultsDirCheck(join(alias, "results", "harness"), c.jobs)?.refuse);
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
      ".bench-running.json.guard",
      "claims/e1/.bench-running.json",
      "runs/r2.json.tmp-0a1b2c3d-1111-2222-3333-444455556666",
      "workspaces/.tmp-0a1b2c3d-1111-2222-3333-444455556666/f.txt",
      // a nested root's machine state is skipped too (any case)
      "cells/Symbols/a.app",
      "cells/bc-ledger/l.json",
    ]
  ) {
    await put(join(from, skip), "machine state");
  }
  // frozen agent files are content: copied whatever their names
  await put(join(from, "workspaces", "h1", "notes.tmp-final.txt"), "kept");
  await put(join(from, "workspaces", "h1", "symbols", "x.al"), "kept");
  await Deno.mkdir(join(from, "workspaces", "h1", "empty"), {
    recursive: true,
  });
  // stale markers (a crashed or finished run) are skipped, not "live"
  for (const m of [".bench-running.json", "claims/e1/.bench-running.json"]) {
    await Deno.utime(join(from, m), old, old);
  }
  const r1 = await c.archive({ from, to });
  assertEquals([r1.copied, r1.present, r1.verified], [6, 0, 6]);
  assertEquals(r1.skipped, [
    "baselines",
    "bc-ledger",
    join("cells", "Symbols"),
    join("cells", "bc-ledger"),
    "egress-host.jsonl",
    "egress-verified.json",
    "egress-verified.json.superseded-by-recreate",
    "symbols",
  ]);
  assertEquals(
    await Deno.readTextFile(join(to, "cells", "executions", "x", "e9.json")),
    '{"cell":1}',
  );
  assertEquals(
    await Deno.readTextFile(
      join(to, "workspaces", "h1", "notes.tmp-final.txt"),
    ),
    "kept",
  );
  assert(await exists(join(to, "workspaces", "h1", "symbols", "x.al")));
  assert((await Deno.stat(join(to, "workspaces", "h1", "empty"))).isDirectory);
  for (
    const gone of [
      "symbols",
      ".bench-running.json",
      ".bench-running.json.guard",
      join("claims", "e1", ".bench-running.json"),
      join("runs", "r2.json.tmp-0a1b2c3d-1111-2222-3333-444455556666"),
      join("workspaces", ".tmp-0a1b2c3d-1111-2222-3333-444455556666"),
      join("cells", "Symbols"),
    ]
  ) {
    assertFalse(await exists(join(to, gone)), gone);
  }
  const r2 = await c.archive({ from, to });
  assertEquals([r2.copied, r2.present, r2.verified], [0, 6, 6]);
  // a second root merges into the same shared root
  const other = join(await c.worktree("R-07-branch"), "results", "harness");
  await put(join(other, "campaigns", "c2.json"), '{"id":"c2"}');
  const r3 = await c.archive({ from: other, to });
  assertEquals([r3.copied, r3.present], [1, 0]);
});

Deno.test("H-54 archive: a same-path file with other content refuses and copies nothing", async () => {
  const c = await coord();
  const from = join(await c.worktree("P-02"), "results", "harness");
  const to = join(c.root, "results", "harness");
  await records(from);
  await put(join(to, "runs", "r1.json"), '{"r":"different"}');
  await refused(c.archive({ from, to }), join("runs", "r1.json"));
  assertFalse(await exists(join(to, "campaigns")));
  assertEquals(
    await Deno.readTextFile(join(to, "runs", "r1.json")),
    '{"r":"different"}',
  );
});

Deno.test("H-54 archive: a coord-task copy and a non-job source are refused unless allowed", async () => {
  const c = await coord();
  const to = join(c.root, "results", "harness");
  const copy = join(c.root, "tasks", "H-35", "proof", "results");
  await records(copy);
  await refused(c.archive({ from: copy, to }), "--allow-coord-copy");
  // a junction outside tasks pointing at the copy is the same copy
  const alias = join(c.root, "copy-alias");
  await Deno.symlink(copy, alias, { type: "junction" });
  await refused(
    c.archive({ from: alias, to, allowNonJobSource: true }),
    "--allow-coord-copy",
  );
  assertFalse(await exists(to));
  assertEquals(
    (await c.archive({ from: copy, to, allowCoordCopy: true })).copied,
    4,
  );
  const lane = join(c.root, "lane-ops", "results", "harness");
  await records(lane, "c3");
  await refused(c.archive({ from: lane, to }), "--allow-non-job-source");
  assertEquals(
    (await c.archive({ from: lane, to, allowNonJobSource: true })).copied,
    2, // campaign c3 and its execution; runs/r1 and the cell are identical
  );
});

Deno.test("H-54 archive: refuses a non-records source, overlapping roots and a job-worktree destination", async () => {
  const c = await coord();
  const wt = await c.worktree("P-02");
  const from = join(wt, "results", "harness");
  await records(from);
  const empty = join(c.jobs, "empty");
  await put(join(empty, "campaigns"), "a file, not a dir");
  await refused(
    c.archive({ from: empty, to: join(c.root, "shared") }),
    "not a harness results root",
  );
  await refused(c.archive({ from, to: from }), "overlap");
  await refused(c.archive({ from, to: join(from, "archive") }), "overlap");
  const other = join(await c.worktree("H-99"), "results", "harness");
  await refused(c.archive({ from, to: other }), "inside job worktree");
  // a junction outside jobs into a job worktree is that worktree
  const alias = join(c.root, "dest-alias");
  await Deno.symlink(join(c.jobs, "H-99"), alias, { type: "junction" });
  await refused(
    c.archive({ from, to: join(alias, "results", "harness") }),
    "inside job worktree",
  );
  assertFalse(await exists(join(c.jobs, "H-99", "results")));
});

Deno.test("H-54 archive: live markers above or inside the source refuse", async () => {
  const c = await coord();
  const wt = await c.worktree("M8-16a");
  const from = join(wt, "results", "harness");
  const to = join(c.root, "results", "harness");
  await records(from);
  // the checkout's marker two levels above a nested cells root
  await put(join(wt, "results", ".bench-running.json"), '{"pid":1}');
  await refused(c.archive({ from: join(from, "cells"), to }), "live");
  await Deno.remove(join(wt, "results", ".bench-running.json"));
  await put(join(from, "cells", ".bench-running.json"), '{"pid":1}');
  await refused(c.archive({ from, to }), "live");
  assertFalse(await exists(to));
});

Deno.test("H-54 archive: a recently written source refuses (quiet window)", async () => {
  const c = await coord();
  const from = join(await c.worktree("P-02"), "results", "harness");
  await records(from);
  await refused(
    archiveResults({
      from,
      to: join(c.root, "results", "harness"),
      coordRoot: c.root,
    }),
    "changed in the last 10 min",
  );
});

Deno.test("H-54 archive: a source that changes during the archive is not clean", async () => {
  const c = await coord();
  const from = join(await c.worktree("P-02"), "results", "harness");
  const to = join(c.root, "results", "harness");
  await records(from);
  await refused(
    c.archive({
      from,
      to,
      afterCopy: () => put(join(from, "runs", "late.json"), "{}"),
    }),
    "changed during the archive",
  );
  // once quiet, the next run completes it
  const r = await c.archive({ from, to });
  assertEquals([r.copied, r.present], [1, 4]);
  // a dir-only change (a new empty dir) is a change too
  await refused(
    c.archive({
      from,
      to,
      afterCopy: () =>
        Deno.mkdir(join(from, "workspaces", "h9", "empty"), {
          recursive: true,
        }),
    }),
    "changed during the archive",
  );
});

Deno.test("H-54 archive: a link or junction below the destination refuses, nothing written through it", async () => {
  const c = await coord();
  const from = join(await c.worktree("P-02"), "results", "harness");
  await records(from);
  const live = join(await c.worktree("M8-16a"), "results", "harness", "runs");
  await Deno.mkdir(live, { recursive: true });
  const to = join(c.root, "results", "harness");
  await Deno.mkdir(to, { recursive: true });
  await Deno.symlink(live, join(to, "runs"), { type: "junction" });
  await refused(c.archive({ from, to }), "runs");
  assertEquals([...Deno.readDirSync(live)], []);
  assertFalse(await exists(join(to, "campaigns")));
});

Deno.test("H-54 archive: fixture workspaces are frozen content too", async () => {
  const c = await coord();
  const from = join(await c.worktree("P-02"), "results", "harness");
  const to = join(c.root, "results", "harness");
  await records(from);
  const ws = join("fixtures", "workspaces", "h2");
  await put(join(from, ws, "notes.tmp-deadbeef"), "agent file");
  await put(join(from, ws, ".bench-running.json"), "agent file");
  // the store's own publish temp is still skipped
  await put(
    join(
      from,
      "fixtures",
      "workspaces",
      ".tmp-0a1b2c3d-1111-2222-3333-444455556666",
      "x",
    ),
    "temp",
  );
  const r = await c.archive({ from, to });
  assertEquals(r.copied, 6);
  assertEquals(
    await Deno.readTextFile(join(to, ws, "notes.tmp-deadbeef")),
    "agent file",
  );
  assert(await exists(join(to, ws, ".bench-running.json")));
});

Deno.test("H-54 archive: junction-backed tasks and jobs dirs keep their meaning", async () => {
  const c = await coord();
  const elsewhere = await testTempDir({ prefix: "h54-elsewhere-" });
  // <coord>/tasks is a junction; the copy is named by its physical path
  const physical = join(elsewhere, "tasks");
  await records(join(physical, "H-35", "results"));
  await Deno.symlink(physical, join(c.root, "tasks"), { type: "junction" });
  const to = join(c.root, "results", "harness");
  await refused(
    c.archive({
      from: join(physical, "H-35", "results"),
      to,
      allowNonJobSource: true,
    }),
    "--allow-coord-copy",
  );
  // <coord>/jobs is a junction: a job root needs no override
  const jobsReal = join(elsewhere, "jobs");
  await Deno.mkdir(jobsReal);
  await Deno.symlink(jobsReal, c.jobs, { type: "junction" });
  const from = join(await c.worktree("P-02"), "results", "harness");
  await records(from);
  assertEquals((await c.archive({ from, to })).copied, 4);
});

Deno.test("H-54 guard: a job worktree whose name starts with '..' is still inside jobs", async () => {
  const c = await coord();
  const wt = await c.worktree("..scratch");
  assert(resultsDirCheck(join(wt, "results", "harness"), c.jobs)?.refuse);
});
