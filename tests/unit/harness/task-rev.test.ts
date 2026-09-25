import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { loadTaskAt } from "../../../src/harness/task-rev.ts";
import { git, makeRefappRepo, write } from "./refapp-fixture.ts";

Deno.test("loadTaskAt: a tag yields the task as committed, with commit and tree; no rev is the working tree", async () => {
  const repo = await makeRefappRepo();
  await git(repo.root, "add", ".");
  await git(repo.root, "commit", "-q", "-m", "tasks");
  await git(repo.root, "tag", "refapp-v1-rc1");
  await write(
    repo.root,
    "harness-tasks/tasks/HX-001/correct/Rental/src/Rental.Codeunit.al",
    "// edited after the tag\n",
  );
  const at = await loadTaskAt(
    repo.root,
    "HX-001",
    "refapp-v1-rc1",
    await Deno.realPath(await Deno.makeTempDir()),
  );
  assertEquals(at.commit!.length, 40);
  assertEquals(at.tree!.length, 40);
  assertStringIncludes(
    await Deno.readTextFile(
      join(at.task.dir, "correct", "Rental", "src", "Rental.Codeunit.al"),
    ),
    "FIXED",
  );
  const wt = await loadTaskAt(
    repo.root,
    "HX-001",
    null,
    await Deno.realPath(await Deno.makeTempDir()),
  );
  assertEquals([wt.commit, wt.tree], [null, null]);
  // Production passes a directory that does not exist yet (harness cell --rev).
  const fresh = join(
    await Deno.realPath(await Deno.makeTempDir()),
    "work",
    "task-new",
  );
  assertEquals(
    (await loadTaskAt(repo.root, "HX-001", "refapp-v1-rc1", fresh)).commit,
    at.commit,
  );
  assertStringIncludes(
    await Deno.readTextFile(
      join(wt.task.dir, "correct", "Rental", "src", "Rental.Codeunit.al"),
    ),
    "edited after the tag",
  );
});
