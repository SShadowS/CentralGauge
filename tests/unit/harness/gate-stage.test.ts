import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join, relative } from "@std/path";
import { layers, objectIds } from "../../../scripts/harness/gate-core.ts";
import {
  checkTask,
  exportSource,
  GATE_TMP,
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

// Review fixes (run 001 adversarial review).

Deno.test("exportSource and stageWorkspace refuse a non-empty output dir", async () => {
  const root = await tmp();
  await writeTask(root, "HX-001", "# Bug\n");
  await git(root, "init", "-q");
  await commitAll(root);
  const out = await tmp();
  await write(out, "harness-tasks/tasks/HX-001/naive/z/Core/src/A.al", "stale");
  await assertRejects(
    () => exportSource(root, "HEAD", "HX-001", out),
    Error,
    "not empty",
  );
  const stage = await tmp();
  await write(stage, "Test/src/Stale.al", "stale");
  await assertRejects(
    () => stageWorkspace(join(root, "harness-tasks/refapp"), [], stage),
    Error,
    "not empty",
  );
});

Deno.test("exportSource: relative out, no line-ending conversion, no index left behind", async () => {
  const root = await tmp();
  await writeTask(root, "HX-001", "# Bug\n");
  await git(root, "init", "-q");
  await commitAll(root);
  await git(root, "config", "core.autocrlf", "true");
  await Deno.writeTextFile(join(root, ".gitattributes"), "* text eol=crlf\n");
  const out = await tmp();
  const rel = relative(Deno.cwd(), out);
  const src = await exportSource(root, "HEAD", "HX-001", rel);
  const bytes = await Deno.readTextFile(join(src.refappDir, "Core/src/A.al"));
  assert(!bytes.includes("\r"), "exported bytes must be the committed blob");
  await assertRejects(() => Deno.stat(join(out, ".gate-index")));
  await assertRejects(
    async () => exportSource(root, "no-such-rev", "HX-001", await tmp()),
    Error,
    "does not resolve",
  );
});

Deno.test("stageWorkspace: build output skipped case-insensitively", async () => {
  const root = await tmp();
  const refapp = join(root, "refapp");
  await writeRefapp(refapp);
  await write(refapp, "Core/Output/x.txt", "bin");
  const out = join(root, "out");
  await stageWorkspace(refapp, [], out);
  await assertRejects(() => Deno.stat(join(out, "Core/Output/x.txt")));
});

Deno.test("stageWorkspace: a task layer other than overlay cannot replace a shipped test", async () => {
  const root = await tmp();
  const refapp = join(root, "refapp");
  await writeRefapp(refapp);
  const task = join(root, "task");
  await write(task, "reference-tests/Test/SRC/v.al", "always passes");
  await assertRejects(
    () =>
      stageWorkspace(
        refapp,
        layers(
          task,
          { kind: "tests", suite: "reference-tests", mutant: "m0" },
          true,
        ),
        join(root, "out"),
      ),
    Error,
    "shipped test",
  );
  await write(task, "overlay/Test/src/V.al", TEST_CU(80010, "Visible"));
  await Deno.remove(join(task, "reference-tests"), { recursive: true });
  await write(task, "reference-tests/Test/src/R.al", TEST_CU(80100, "Ref"));
  await stageWorkspace(
    refapp,
    layers(
      task,
      { kind: "tests", suite: "reference-tests", mutant: "m0" },
      true,
    ),
    join(root, "out2"),
  );
});

async function testAuthoringTask(root: string): Promise<string> {
  const dir = await writeTask(root, "HX-002", "# Task\n");
  const yml = join(dir, "task.yml");
  await Deno.writeTextFile(
    yml,
    (await Deno.readTextFile(yml))
      .replace("kind: bugfix", "kind: test-authoring")
      .replace("fail_to_pass]", "mutant_kill]")
      .replace(/fail_to_pass:\n[\s\S]*$/, ""),
  );
  await write(dir, "reference-tests/Test/src/R.al", TEST_CU(80100, "Ref"));
  return dir;
}

Deno.test("checkTask: case-variant path still replaces a shipped test", async () => {
  const root = await tmp();
  const dir = await testAuthoringTask(root);
  await write(dir, "reference-tests/Test/SRC/v.al", TEST_CU(80010, "Visible"));
  const all = (await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  ))
    .problems.join("\n");
  assert(
    /reference-tests\/Test\/src\/v\.al: replaces a shipped test/i.test(all),
    all,
  );
});

Deno.test("checkTask: hidden names are matched literally, case-insensitively, codeunit names included", async () => {
  const root = await tmp();
  const dir = await writeTask(
    root,
    "HX-001",
    "Look at t85000 and make hidden pass.\n",
  );
  const all = (await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  ))
    .problems.join("\n");
  assertStringIncludes(all, "hidden name Hidden");
  assertStringIncludes(all, "hidden name T85000");
  const yml = join(dir, "task.yml");
  await Deno.writeTextFile(
    yml,
    (await Deno.readTextFile(yml)).replace("[Hidden]", '["Hid(den"]'),
  );
  await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  );
});

Deno.test("checkTask: missing oracle app.json or idRanges is a problem, not a crash", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "# Bug\n");
  await write(
    dir,
    "oracle/app.json",
    JSON.stringify({
      id: "c6a1e000-0000-4000-8001-000000000001",
      name: "CGR Oracle HX-001",
      publisher: "CentralGauge",
      dependencies: [],
    }),
  );
  let all = (await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  ))
    .problems.join("\n");
  assertStringIncludes(all, "oracle/app.json: idRanges");
  await Deno.remove(join(dir, "oracle/app.json"));
  all = (await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  ))
    .problems.join("\n");
  assertStringIncludes(all, "oracle/app.json: missing");
});

Deno.test("drift against a revision: renames count, working tree ignored", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "# Bug\n");
  await git(root, "init", "-q");
  await commitAll(root, "refapp-v1-rc1");
  const refapp = join(root, "harness-tasks/refapp");
  await git(
    root,
    "mv",
    "harness-tasks/refapp/Core/src/A.al",
    "harness-tasks/refapp/Core/src/B.al",
  );
  await commitAll(root);
  await write(refapp, "Fleet/src/Dirty.al", 'codeunit 70150 "N"\n{\n}\n');
  const r = await checkTask(await loadTask(dir), refapp, root, { rev: "HEAD" });
  assert(
    r.problems.some((p) => p.includes("Core/src/A.al")),
    r.problems.join("; "),
  );
  assert(
    r.warnings.some((w) => w.includes("(2 files)")),
    r.warnings.join("; "),
  );
  await assertRejects(
    async () =>
      checkTask(await loadTask(dir), refapp, root, { rev: "no-such-rev" }),
    Error,
  );
});

// Run 002 review fixes.

async function gitOut(cwd: string, ...args: string[]): Promise<string> {
  const r = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "null",
  })
    .output();
  return new TextDecoder().decode(r.stdout);
}

Deno.test("exportSource writes blob bytes even with committed eol attributes", async () => {
  const root = await tmp();
  await writeTask(root, "HX-001", "# Bug\n");
  await Deno.writeTextFile(
    join(root, ".gitattributes"),
    "*.al text eol=crlf\n",
  );
  await git(root, "init", "-q");
  await commitAll(root);
  const src = await exportSource(root, "HEAD", "HX-001", await tmp());
  const blob = await gitOut(
    root,
    "cat-file",
    "blob",
    "HEAD:harness-tasks/refapp/Core/src/A.al",
  );
  assertEquals(
    await Deno.readTextFile(join(src.refappDir, "Core/src/A.al")),
    blob,
  );
  assert(!blob.includes("\r"));
});

Deno.test("exportSource refuses links, submodules and case-colliding paths", async () => {
  for (
    const [mode, path] of [
      ["120000", "harness-tasks/refapp/Core/src/L.al"],
      ["160000", "harness-tasks/refapp/Core/sub"],
      ["100644", "harness-tasks/refapp/Core/src/a.al"],
    ]
  ) {
    const root = await tmp();
    await writeTask(root, "HX-001", "# Bug\n");
    await git(root, "init", "-q");
    await commitAll(root);
    const sha = mode === "160000"
      ? (await gitOut(root, "rev-parse", "HEAD")).trim()
      : (await gitOut(
        root,
        "rev-parse",
        "HEAD:harness-tasks/refapp/Core/src/A.al",
      )).trim();
    await git(
      root,
      "update-index",
      "--add",
      "--cacheinfo",
      `${mode},${sha},${path}`,
    );
    await git(
      root,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "-m",
      "y",
    );
    await assertRejects(
      async () => exportSource(root, "HEAD", "HX-001", await tmp()),
      Error,
      mode === "100644" ? "case" : "link or submodule",
    );
  }
});

Deno.test("exportSource and stageWorkspace refuse output outside the gate tmp root", async () => {
  const outside = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => exportSource(".", "HEAD", "HX-001", outside),
      Error,
      GATE_TMP,
    );
    const root = await tmp();
    await writeRefapp(join(root, "refapp"));
    await assertRejects(
      () => stageWorkspace(join(root, "refapp"), [], join(outside, "o")),
      Error,
      GATE_TMP,
    );
  } finally {
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("stageWorkspace refuses a zero-byte candidate file", async () => {
  const root = await tmp();
  const refapp = join(root, "refapp");
  await writeRefapp(refapp);
  const cand = join(root, "ws");
  await write(cand, "Core/src/A.al", "");
  await assertRejects(
    () =>
      stageWorkspace(
        refapp,
        [{ path: cand, mode: "candidate" }],
        join(root, "o1"),
      ),
    Error,
    "deletion",
  );
  await Deno.remove(cand, { recursive: true });
  await write(cand, "Test/src/V.al", "");
  await assertRejects(
    () =>
      stageWorkspace(
        refapp,
        [{ path: cand, mode: "candidate-tests" }],
        join(root, "o2"),
      ),
    Error,
    "deletion",
  );
});

Deno.test("checkTask: oracle objects and idRanges stay in the task's own band", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-002", "# Bug\n");
  let r = await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  );
  assertEquals(r.problems, []);
  await write(dir, "oracle/src/P.al", TEST_CU(85000, "Other"));
  await write(
    dir,
    "oracle/app.json",
    JSON.stringify({
      id: "c6a1e000-0000-4000-8001-000000000002",
      name: "CGR Oracle HX-002",
      publisher: "CentralGauge",
      idRanges: [{ from: 85000, to: 85199 }],
      dependencies: [],
    }),
  );
  r = await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  );
  const all = r.problems.join("\n");
  assertStringIncludes(all, "object id 85000 outside Oracle range 85100-85199");
  assertStringIncludes(all, "oracle/app.json: idRanges outside 85100-85199");
});

Deno.test("objectIds: comments, strings and tight spacing", () => {
  assertEquals(objectIds('/*x*/codeunit 90000 "X"\n{\n}\n'), [90000]);
  assertEquals(objectIds('codeunit 80013"X"\n{\n}\n'), [80013]);
  assertEquals(
    objectIds('// codeunit 70001 "Y"\n/* codeunit 70002 "Z" */\n'),
    [],
  );
});

Deno.test("testManifestIn: every test codeunit of a file, comments ignored", async () => {
  const root = await tmp();
  await write(
    root,
    "Test/src/Two.al",
    TEST_CU(80100, "One") +
      'codeunit 80101 "U"\n{\n    Subtype = Test;\n    TestPermissions = Disabled;\n\n    // [Test]\n    // procedure Ghost()\n    [Test]\n    procedure Two()\n    begin\n    end;\n}\n',
  );
  assertEquals(await testManifestIn(root), [
    { codeunit: 80100, procedures: ["One"] },
    { codeunit: 80101, procedures: ["Two"] },
  ]);
});

Deno.test("checkTask: per-codeunit rules, comment evasion and constant assertions", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "Uses the Second Oracle.\n");
  await write(
    dir,
    "oracle/src/More.al",
    "codeunit 85001 \"Second Oracle\"\n{\n    Subtype = Test;\n    // TestPermissions = Disabled;\n\n    [Test]\n    procedure A()\n    begin\n        Assert . IsTrue ( TRUE , 'x');\n        Assert.AreEqual(5, 5, 'x');\n        Assert.AreEqual('a', 'a', 'x');\n        Assert.AreEqual('a', 'b', 'x');\n    end;\n}\n",
  );
  const all = (await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  ))
    .problems.join("\n");
  assertStringIncludes(
    all,
    "oracle/src/More.al: codeunit 85001 without TestPermissions = Disabled",
  );
  assertStringIncludes(all, "hidden name Second Oracle");
  const placeholders = all.split("\n").filter((p) =>
    p.includes("placeholder assertion")
  );
  assertEquals(placeholders.length, 3, placeholders.join("; "));
});

// Run 002 second review: parser and export holes.

Deno.test("objectIds: lone CR ends a line comment; objects after a brace; no var types", () => {
  assertEquals(objectIds('// hi\rcodeunit 90000 "X"\r{\r}\r'), [90000]);
  assertEquals(
    objectIds('codeunit 85000 "A" { } codeunit 90000 "B" { }\n'),
    [85000, 90000],
  );
  assertEquals(
    objectIds(
      'codeunit 70000 "A"\n{\n    var\n        C: Codeunit 70001;\n}\n',
    ),
    [70000],
  );
});

Deno.test("checkTask: UTF-16 and NUL files are problems, not silently skipped", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "# Bug\n");
  const utf16 = new Uint8Array([
    0xff,
    0xfe,
    ...Array.from(new TextEncoder().encode('codeunit 90000 "X"'))
      .flatMap((b) => [b, 0]),
  ]);
  await Deno.writeFile(join(dir, "correct/Core/src/W.al"), utf16);
  const all = (await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  ))
    .problems.join("\n");
  assertStringIncludes(all, "correct/Core/src/W.al: not UTF-8 text");
});

Deno.test("checkTask: comment-only layer file counts as a deletion; idRanges need from and to", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "# Bug\n");
  await write(dir, "naive/x/Core/src/A.al", "// gone\n");
  await write(
    dir,
    "oracle/app.json",
    JSON.stringify({
      id: "c6a1e000-0000-4000-8001-000000000001",
      name: "CGR Oracle HX-001",
      publisher: "CentralGauge",
      idRanges: [{ from: 85000 }],
      dependencies: [],
    }),
  );
  const all = (await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  ))
    .problems.join("\n");
  assertStringIncludes(
    all,
    "naive/x/Core/src/A.al: no AL content; deletion is not supported",
  );
  assertStringIncludes(
    all,
    "oracle/app.json: idRanges entry needs integer from <= to",
  );
});

Deno.test("stageWorkspace refuses a comment-only candidate file", async () => {
  const root = await tmp();
  const refapp = join(root, "refapp");
  await writeRefapp(refapp);
  const cand = join(root, "ws");
  await write(cand, "Core/src/A.al", "/* gone */\n");
  await assertRejects(
    () =>
      stageWorkspace(
        refapp,
        [{ path: cand, mode: "candidate" }],
        join(root, "o"),
      ),
    Error,
    "deletion",
  );
});

async function gitIn(
  cwd: string,
  input: string | Uint8Array,
  ...args: string[]
): Promise<string> {
  const child = new Deno.Command("git", {
    args,
    cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(
    typeof input === "string" ? new TextEncoder().encode(input) : input,
  );
  await w.close();
  return new TextDecoder().decode((await child.output()).stdout).trim();
}

/** Add a blob (or tree) at `parts` under `tree` with mktree, bypassing path checks. */
async function graft(
  root: string,
  tree: string,
  parts: string[],
  blob: string,
  kind: "blob" | "tree" = "blob",
): Promise<string> {
  const entries = tree === ""
    ? []
    : (await gitOut(root, "ls-tree", "-z", tree)).split("\0").filter(Boolean);
  const [head, ...rest] = parts as [string, ...string[]];
  const same = entries.find((e) => e.split("\t")[1] === head);
  const line = rest.length === 0
    ? `${kind === "blob" ? "100644" : "040000"} ${kind} ${blob}\t${head}`
    : `040000 tree ${await graft(
      root,
      same?.split(" ")[2]?.split("\t")[0] ?? "",
      rest,
      blob,
      kind,
    )}\t${head}`;
  const kept = entries.filter((e) => e.split("\t")[1] !== head);
  return await gitIn(root, [...kept, line].join("\0") + "\0", "mktree", "-z");
}

async function commitEntry(path: string): Promise<string> {
  const root = await tmp();
  await writeTask(root, "HX-001", "# Bug\n");
  await git(root, "init", "-q");
  await commitAll(root);
  const blob =
    (await gitOut(root, "rev-parse", "HEAD:harness-tasks/refapp/Core/src/A.al"))
      .trim();
  const tree = await graft(
    root,
    (await gitOut(root, "rev-parse", "HEAD^{tree}")).trim(),
    path.split("/"),
    blob,
  );
  const commit = await gitIn(
    root,
    "y",
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit-tree",
    tree,
    "-p",
    "HEAD",
  );
  await git(root, "update-ref", "HEAD", commit);
  return root;
}

Deno.test("exportSource refuses unsafe path parts and case-colliding folders", async () => {
  for (
    const [path, needle] of [
      ["harness-tasks/refapp/Core/src/..\\..\\x.al", "unsafe path"],
      ["harness-tasks/refapp/Core/src/NUL.al", "unsafe path"],
      ["harness-tasks/refapp/Core/src/x.al.", "unsafe path"],
      ["harness-tasks/refapp/core/src/B.al", "differ only in case"],
    ]
  ) {
    const root = await commitEntry(path!);
    await assertRejects(
      async () => exportSource(root, "HEAD", "HX-001", await tmp()),
      Error,
      needle,
    );
  }
});

Deno.test("exportSource ignores git replace objects", async () => {
  const root = await tmp();
  await writeTask(root, "HX-001", "# Bug\n");
  await git(root, "init", "-q");
  await commitAll(root);
  const orig =
    (await gitOut(root, "rev-parse", "HEAD:harness-tasks/refapp/Core/src/A.al"))
      .trim();
  await Deno.writeTextFile(join(root, "evil.txt"), "evil");
  const evil = (await gitOut(root, "hash-object", "-w", "evil.txt")).trim();
  await git(root, "replace", orig, evil);
  const src = await exportSource(root, "HEAD", "HX-001", await tmp());
  assertStringIncludes(
    await Deno.readTextFile(join(src.refappDir, "Core/src/A.al")),
    "codeunit 70000",
  );
});

Deno.test("output dir through a junction out of GATE_TMP is refused", async () => {
  if (Deno.build.os !== "windows") return;
  const outside = await Deno.makeTempDir();
  const link = join(await tmp(), "j");
  try {
    await Deno.symlink(outside, link, { type: "junction" });
    const root = await tmp();
    await writeRefapp(join(root, "refapp"));
    await assertRejects(
      () => stageWorkspace(join(root, "refapp"), [], join(link, "o")),
      Error,
      GATE_TMP,
    );
  } finally {
    await Deno.remove(link).catch(() => {});
    await Deno.remove(outside, { recursive: true });
  }
});

// Run 003 fixes.

Deno.test("run 003 fix 1: .AL files are checked like .al", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "# Bug\n");
  await write(
    dir,
    "correct/Core/src/Foo.AL",
    'codeunit 70050 "Foo"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure P()\n    begin\n    end;\n}\n',
  );
  const all = (await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  ))
    .problems.join("\n");
  assertStringIncludes(
    all,
    "correct/Core/src/Foo.AL: codeunit 70050 without TestPermissions",
  );
  const tests = await tmp();
  await write(tests, "Test/src/Upper.AL", TEST_CU(80100, "Up"));
  assertEquals(await testManifestIn(tests), [{
    codeunit: 80100,
    procedures: ["Up"],
  }]);
  const refapp = join(root, "harness-tasks/refapp");
  const cand = join(root, "ws");
  await write(cand, "Core/src/New.AL", 'codeunit 70001 "New"\n{\n}\n');
  const out = join(root, "out");
  await stageWorkspace(refapp, [{ path: cand, mode: "candidate" }], out);
  assertStringIncludes(
    await Deno.readTextFile(join(out, "Core/src/New.AL")),
    "70001",
  );
});

Deno.test("run 003 fix 2: preprocessor directives are refused in task files", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "# Bug\n");
  await write(
    dir,
    "oracle/src/O.al",
    'codeunit 85000 "T85000"\n{\n    Subtype = Test;\n#if NEVER\n    TestPermissions = Disabled;\n#endif\n    #region Tests\n    [Test]\n    procedure Hidden()\n    begin\n    end;\n    #endregion\n}\n',
  );
  const all = (await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  ))
    .problems.join("\n");
  assertStringIncludes(all, "oracle/src/O.al: preprocessor directive #if");
  assertStringIncludes(all, "oracle/src/O.al: preprocessor directive #endif");
  assert(!all.includes("#region"), all);
});

Deno.test("run 003 fix 3: exportSource refuses a path that is not valid UTF-8", async () => {
  const root = await tmp();
  await writeTask(root, "HX-001", "# Bug\n");
  await git(root, "init", "-q");
  await commitAll(root);
  const blob =
    (await gitOut(root, "rev-parse", "HEAD:harness-tasks/refapp/Core/src/A.al"))
      .trim();
  const enc = new TextEncoder();
  const leaf = await gitIn(
    root,
    new Uint8Array([
      ...enc.encode(`100644 blob ${blob}\t`),
      0xff,
      ...enc.encode(".al"),
      0,
    ]),
    "mktree",
    "-z",
  );
  const tree = await graft(
    root,
    (await gitOut(root, "rev-parse", "HEAD^{tree}")).trim(),
    ["harness-tasks", "refapp", "Core", "bad"],
    leaf,
    "tree",
  );
  const commit = await gitIn(
    root,
    "y",
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit-tree",
    tree,
    "-p",
    "HEAD",
  );
  await git(root, "update-ref", "HEAD", commit);
  await assertRejects(
    async () => exportSource(root, "HEAD", "HX-001", await tmp()),
    Error,
    "not valid UTF-8",
  );
});
