/**
 * H-35 S2.3 (design-r4 4, design-r3 6.1): the task preimage store. The
 * exact object oracleHash hashes is stored once per oracle hash, verified on
 * every read, and recovered from git history when it was never stored.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import { hashJson } from "../../../src/harness/hash.ts";
import { oracleHash, oraclePreimage } from "../../../src/harness/identity.ts";
import { loadTask } from "../../../src/harness/task.ts";
import {
  loadOracleDescriptor,
  storeOraclePreimage,
} from "../../../src/harness/task-oracle.ts";
import { git, makeRefappRepo, write } from "./refapp-fixture.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const tmp = async () => await Deno.realPath(await testTempDir());

Deno.test("H-35 S2.3: the stored preimage is exactly what oracleHash hashes", async () => {
  await using repo = await makeRefappRepo();
  const task = await loadTask(join(repo.tasksDir, "HX-001"));
  assertEquals(
    await hashJson(await oraclePreimage(task)),
    await oracleHash(task),
  );
});

Deno.test("H-35 S2.3: a preimage is stored once and read back verified, as a descriptor", async () => {
  await using repo = await makeRefappRepo();
  const results = await tmp();
  const task = await loadTask(join(repo.tasksDir, "HX-001"));
  const hash = await storeOraclePreimage(results, task);
  assertEquals(hash, await oracleHash(task));
  // A second store of the same task is a no-op, never a rewrite.
  const file = join(results, "task-oracle", `${hash}.json`);
  const before = await Deno.readTextFile(file);
  await storeOraclePreimage(results, task);
  assertEquals(await Deno.readTextFile(file), before);
  const d = await loadOracleDescriptor(results, hash);
  assert(d !== "unknown");
  assertEquals(d.kind, "bugfix");
  assertEquals(d.scorers, ["build", "pass_to_pass", "fail_to_pass"]);
  assertEquals(d.recovered_from, null);
});

Deno.test("H-35 S2.3: a stored preimage that no longer hashes to its name is refused (a store defect)", async () => {
  await using repo = await makeRefappRepo();
  const results = await tmp();
  const task = await loadTask(join(repo.tasksDir, "HX-001"));
  const hash = await storeOraclePreimage(results, task);
  const file = join(results, "task-oracle", `${hash}.json`);
  const rec = JSON.parse(await Deno.readTextFile(file));
  rec.preimage.scorers = ["build"];
  await Deno.writeTextFile(file, JSON.stringify(rec));
  await assertRejects(
    () => loadOracleDescriptor(results, hash),
    ValidationError,
    "does not hash to",
  );
});

Deno.test("H-35 S2.3: an oracle hash never stored is recovered from git history (and stored with its commit); one in no commit is unknown", async () => {
  await using repo = await makeRefappRepo();
  const results = await tmp();
  await git(repo.root, "add", "harness-tasks/tasks");
  await git(repo.root, "commit", "-q", "-m", "tasks v1");
  const first = new TextDecoder().decode(
    (await new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      cwd: repo.root,
      stdout: "piped",
    }).output()).stdout,
  );
  const old = await oracleHash(await loadTask(join(repo.tasksDir, "HX-001")));
  const oracleFile = join(
    repo.tasksDir,
    "HX-001",
    "oracle",
    "src",
    "Oracle.Test.al",
  );
  await Deno.writeTextFile(
    oracleFile,
    (await Deno.readTextFile(oracleFile)) + "\n// v2\n",
  );
  await git(repo.root, "add", "harness-tasks/tasks");
  await git(repo.root, "commit", "-q", "-m", "tasks v2");
  const d = await loadOracleDescriptor(results, old, {
    repoRoot: repo.root,
    taskId: "HX-001",
    workDir: await tmp(),
  });
  assert(d !== "unknown");
  assertEquals(d.recovered_from, String(first).trim());
  // Stored now: the next read needs no history.
  const again = await loadOracleDescriptor(results, old);
  assert(again !== "unknown");
  assertEquals(again.recovered_from, String(first).trim());
  assertEquals(
    await loadOracleDescriptor(results, "0".repeat(64), {
      repoRoot: repo.root,
      taskId: "HX-001",
      workDir: await tmp(),
    }),
    "unknown",
  );
});

Deno.test("H-35 S2.3: the descriptor carries production_allow when the task declares it", async () => {
  await using repo = await makeRefappRepo();
  const results = await tmp();
  const yml = join(repo.tasksDir, "HX-001", "task.yml");
  await write(
    join(repo.tasksDir, "HX-001"),
    "task.yml",
    (await Deno.readTextFile(yml)) +
      'production_allow:\n  objects: ["table:130450"]\n',
  );
  const task = await loadTask(join(repo.tasksDir, "HX-001"));
  const hash = await storeOraclePreimage(results, task);
  const d = await loadOracleDescriptor(results, hash);
  assert(d !== "unknown");
  assertEquals(d.production_allow, { objects: ["table:130450"] });
});
