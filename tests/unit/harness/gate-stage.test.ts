import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { layers } from "../../../scripts/harness/gate-core.ts";
import {
  checkTask,
  exportSource,
  stageWorkspace,
  testManifestIn,
} from "../../../scripts/harness/gate-stage.ts";
import { loadTask } from "../../../src/harness/task.ts";
import {
  TEST_CU,
  tmp,
  write,
  writeRefapp,
  writeTask,
} from "./gate-fixtures.ts";

const git = (cwd: string, ...args: string[]) =>
  new Deno.Command("git", { args, cwd, stdout: "null", stderr: "null" })
    .output();
async function commitAll(root: string, tag?: string) {
  await git(root, "add", "-A");
  await git(
    root,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "-m",
    "x",
  );
  if (tag) await git(root, "tag", tag);
}

Deno.test("stageWorkspace: precedence, build output skipped, bad layers refused", async () => {
  const root = await tmp();
  const refapp = join(root, "refapp");
  await writeRefapp(refapp);
  await write(refapp, "Core/.alpackages/x.app", "bin");
  const task = join(root, "task");
  await write(task, "overlay/Core/src/A.al", "bug");
  await write(task, "correct/Core/src/A.al", "fix");
  await write(task, "correct/Core/src/B.al", "new");
  const out = join(root, "out");
  await stageWorkspace(refapp, layers(task, { kind: "correct" }, false), out);
  assertEquals(await Deno.readTextFile(join(out, "Core/src/A.al")), "fix");
  assertEquals(await Deno.readTextFile(join(out, "Core/src/B.al")), "new");
  await assertRejects(() => Deno.stat(join(out, "Core/.alpackages/x.app")));
  await write(task, "naive/bad/Elsewhere/x.al", "x");
  await assertRejects(
    () =>
      stageWorkspace(
        refapp,
        layers(task, { kind: "naive", name: "bad" }, false),
        join(root, "o2"),
      ),
    Error,
    "module folder",
  );
  await write(task, "naive/empty/Core/src/A.al", "");
  await assertRejects(
    () =>
      stageWorkspace(
        refapp,
        layers(task, { kind: "naive", name: "empty" }, false),
        join(root, "o3"),
      ),
    Error,
    "deletion",
  );
  await Deno.remove(join(refapp, "Reporting"), { recursive: true });
  await assertRejects(
    () => stageWorkspace(refapp, [], join(root, "o4")),
    Error,
    "Reporting",
  );
});

Deno.test("stageWorkspace: candidate layer cannot replace a shipped test", async () => {
  const root = await tmp();
  const refapp = join(root, "refapp");
  await writeRefapp(refapp);
  const cand = join(root, "ws");
  await write(cand, "Test/src/V.al", "always passes");
  await write(cand, "Test/src/New.al", TEST_CU(80200, "Mine"));
  await write(cand, "Core/src/A.al", "agent change");
  await write(cand, "Core/notes.txt", "ignored");
  const out = join(root, "out");
  await stageWorkspace(refapp, [{ path: cand, mode: "candidate" }], out);
  assertStringIncludes(
    await Deno.readTextFile(join(out, "Test/src/V.al")),
    "Visible",
  );
  assertStringIncludes(
    await Deno.readTextFile(join(out, "Test/src/New.al")),
    "Mine",
  );
  assertEquals(
    await Deno.readTextFile(join(out, "Core/src/A.al")),
    "agent change",
  );
  await assertRejects(() => Deno.stat(join(out, "Core/notes.txt")));
  const out2 = join(root, "out2");
  await stageWorkspace(refapp, [{ path: cand, mode: "candidate-tests" }], out2);
  assertStringIncludes(
    await Deno.readTextFile(join(out2, "Core/src/A.al")),
    "codeunit 70000",
  );
});

Deno.test("testManifestIn: [Test] procedures per codeunit", async () => {
  const root = await tmp();
  await write(root, "Test/src/T.al", TEST_CU(80100, "One"));
  await write(root, "Test/src/L.al", 'codeunit 80101 "L"\n{\n}\n');
  assertEquals(await testManifestIn(root), [{
    codeunit: 80100,
    procedures: ["One"],
  }]);
});

Deno.test("checkTask: clean fixture has no problems", async () => {
  const root = await tmp();
  const dir = await writeTask(
    root,
    "HX-001",
    "# Bug\nThe vehicle is not blocked.\n",
  );
  const { problems } = await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  );
  assertEquals(problems, []);
});

Deno.test("checkTask: every static rule fires", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "Make Hidden pass.\n");
  await write(
    dir,
    "oracle/src/P.al",
    'codeunit 80001 "P"\n{\n    Subtype = Test;\n}\n',
  );
  await write(dir, "correct/Test/src/V.al", TEST_CU(80010, "Visible"));
  await write(dir, "naive/x/Core/src/Z.al", "");
  await Deno.remove(join(dir, "naive/y"), { recursive: true });
  await write(
    dir,
    "oracle/app.json",
    JSON.stringify({
      id: "c6a1e000-0000-4000-8001-000000000009",
      name: "Wrong",
      publisher: "CentralGauge",
      idRanges: [{ from: 85000, to: 85099 }],
      dependencies: [{ name: "CGR Test" }],
    }),
  );
  const all = (await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  ))
    .problems.join("\n");
  for (
    const needle of [
      "hidden name Hidden",
      "object id 80001 outside Oracle",
      "TestPermissions",
      "no [Test] procedure",
      "at least two",
      "must not touch Test/",
      "deletion",
      "oracle/app.json: id",
      "oracle/app.json: name",
      "dependency CGR Test",
    ]
  ) assertStringIncludes(all, needle);
});

Deno.test("check refuses a test suite that replaces Test/app.json", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-002", "# Task\n");
  const yml = join(dir, "task.yml");
  await Deno.writeTextFile(
    yml,
    (await Deno.readTextFile(yml))
      .replace("kind: bugfix", "kind: test-authoring")
      .replace("fail_to_pass]", "mutant_kill]")
      .replace(/fail_to_pass:\n[\s\S]*$/, ""),
  );
  await write(dir, "reference-tests/Test/app.json", "{}");
  await write(dir, "reference-tests/Test/src/R.al", TEST_CU(80100, "Ref"));
  const all = (await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  ))
    .problems.join("\n");
  assertStringIncludes(
    all,
    "reference-tests/Test/app.json: replaces a shipped test",
  );
});

Deno.test("drift: replaced file is a problem, other change a warning", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "# Bug\n");
  await git(root, "init", "-q");
  await commitAll(root, "refapp-v1-rc1");
  const refapp = join(root, "harness-tasks/refapp");
  await write(
    refapp,
    "Core/src/A.al",
    'codeunit 70000 "A"\n{\n    // slice\n}\n',
  );
  await write(refapp, "Fleet/src/N.al", 'codeunit 70150 "N"\n{\n}\n');
  const r = await checkTask(await loadTask(dir), refapp, root);
  assert(
    r.problems.some((p) =>
      p.includes("Core/src/A.al") && p.includes("refapp-v1-rc1")
    ),
    r.problems.join("; "),
  );
  assert(r.warnings.some((w) => w.includes("re-gate")), r.warnings.join("; "));
});

Deno.test("exportSource ignores working tree changes", async () => {
  const root = await tmp();
  await writeTask(root, "HX-001", "# Bug\n");
  await git(root, "init", "-q");
  await commitAll(root, "refapp-v1-rc1");
  await write(join(root, "harness-tasks/refapp"), "Core/src/A.al", "dirty");
  const out = await tmp();
  const src = await exportSource(root, "refapp-v1-rc1", "HX-001", out);
  assertStringIncludes(
    await Deno.readTextFile(join(src.refappDir, "Core/src/A.al")),
    "codeunit 70000",
  );
  assertEquals(src.commit.length, 40);
  assertEquals(src.refappTree.length, 40);
  assert(await loadTask(src.taskDir));
});
