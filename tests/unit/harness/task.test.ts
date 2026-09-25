import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { loadTask, loadTaskSet } from "../../../src/harness/task.ts";
import { ValidationError } from "../../../src/errors.ts";

const VALID = `id: HX-001
refapp_version: refapp-v1
kind: feature
prompt: prompt.md
touches: [Rental, Fleet]
coupling: [events]
source: refapp
scorers: [build, pass_to_pass, fail_to_pass]
pass_to_pass:
  - { codeunit: 80010, procedures: [RentalCheckoutPostsLedger] }
fail_to_pass:
  depends_on: [Rental, Fleet]
  tests:
    - { codeunit: 85001, procedures: [DamageBlocksCheckout] }
limits: { timeout_min: 20 }
`;

async function makeTask(
  root: string,
  id: string,
  yml: string,
  files: string[] = ["prompt.md", "oracle/x.al"],
): Promise<string> {
  const dir = join(root, id);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, "task.yml"), yml);
  for (const f of files) {
    await Deno.mkdir(join(dir, f, ".."), { recursive: true });
    await Deno.writeTextFile(join(dir, f), "x");
  }
  return dir;
}

Deno.test("loadTask: valid task gets defaults", async () => {
  const root = await Deno.makeTempDir();
  const { task } = await loadTask(await makeTask(root, "HX-001", VALID));
  assertEquals(task.attachments, []);
  assertEquals(task.mutants, []);
  assertEquals(task.contamination, null);
  assertEquals(task.limits, { timeout_min: 20 });
});

const BAD: Array<[string, string, string]> = [
  ["unknown key", VALID + "hint: be careful\n", "hint"],
  ["duplicate key", VALID + "kind: bugfix\n", "duplicated key"],
  ["empty file", "", "(root)"],
  [
    "oracle codeunit in visible band",
    VALID.replace("85001", "80001"),
    "fail_to_pass.tests.0.codeunit",
  ],
  [
    "visible test in reserved band",
    VALID.replace("80010", "75010"),
    "pass_to_pass.0.codeunit",
  ],
  [
    "missing build scorer",
    VALID.replace("[build, pass_to_pass", "[pass_to_pass"),
    "build scorer is required",
  ],
  [
    "fail_to_pass scorer without block",
    VALID.replace(/fail_to_pass:\n[\s\S]*?DamageBlocksCheckout\] }\n/, ""),
    "go together",
  ],
  [
    "mutant_kill on a feature",
    VALID.replace("fail_to_pass]", "fail_to_pass, mutant_kill]"),
    "test-authoring only",
  ],
  [
    "git source (interface only in 1a)",
    VALID.replace("source: refapp", "source: git"),
    "source",
  ],
  [
    "path escaping the task folder",
    VALID.replace("prompt: prompt.md", "prompt: ../x.md"),
    "relative path",
  ],
  [
    "backslash traversal",
    VALID.replace("prompt: prompt.md", String.raw`prompt: 'sub\..\..\x.md'`),
    "relative path",
  ],
  [
    "absolute attachment path",
    VALID.replace(
      "source: refapp",
      "source: refapp\nattachments: [/etc/x.png]",
    ),
    "relative path",
  ],
  [
    "a string where a number belongs",
    VALID.replace("timeout_min: 20", 'timeout_min: "20"'),
    "limits.timeout_min",
  ],
];

for (const [name, yml, needle] of BAD) {
  Deno.test(`loadTask: rejects ${name}`, async () => {
    const root = await Deno.makeTempDir();
    const err = await assertRejects(
      async () => await loadTask(await makeTask(root, "HX-001", yml)),
      ValidationError,
    );
    assertStringIncludes(err.message, needle);
  });
}

Deno.test("loadTask: coupling tags are normalized", async () => {
  const root = await Deno.makeTempDir();
  const yml = VALID.replace(
    "coupling: [events]",
    "coupling: [' Events', events, Interface]",
  );
  const { task } = await loadTask(await makeTask(root, "HX-001", yml));
  assertEquals(task.coupling, ["events", "interface"]);
});

Deno.test("loadTask: a linked oracle folder or attachment is refused", async () => {
  const root = await Deno.makeTempDir();
  const outside = await Deno.makeTempDir();
  const yml = VALID.replace(
    "source: refapp",
    "source: refapp\nattachments: [shots]",
  );
  const dir = await makeTask(root, "HX-001", yml, ["prompt.md"]);
  const type = Deno.build.os === "windows" ? "junction" : "dir";
  await Deno.symlink(outside, join(dir, "oracle"), { type });
  await Deno.symlink(outside, join(dir, "shots"), { type });
  const err = await assertRejects(() => loadTask(dir), ValidationError);
  assertStringIncludes(err.message, "oracle/ folder is a link");
  assertStringIncludes(err.message, "attachment is a link: shots");
});

Deno.test("loadTask: id must match folder, files must exist", async () => {
  const root = await Deno.makeTempDir();
  const dir = await makeTask(root, "HX-002", VALID, []);
  const err = await assertRejects(() => loadTask(dir), ValidationError);
  assertStringIncludes(err.message, "does not match folder HX-002");
  assertStringIncludes(err.message, "prompt not found");
  assertStringIncludes(err.message, "oracle/ folder");
});

Deno.test("loadTask: test-authoring needs correct/ and its mutant folders", async () => {
  const root = await Deno.makeTempDir();
  const yml = `id: HX-003
refapp_version: refapp-v1
kind: test-authoring
prompt: prompt.md
source: refapp
scorers: [build, mutant_kill]
mutants: [off-by-one]
`;
  const dir = await makeTask(root, "HX-003", yml, ["prompt.md"]);
  const err = await assertRejects(() => loadTask(dir), ValidationError);
  assertStringIncludes(err.message, "correct/ folder");
  assertStringIncludes(err.message, "mutants/off-by-one");
});

Deno.test("loadTaskSet: sorted, and reports every broken task at once", async () => {
  const root = await Deno.makeTempDir();
  await makeTask(root, "HX-002", VALID.replace("HX-001", "HX-002"));
  await makeTask(root, "HX-001", VALID);
  assertEquals(
    (await loadTaskSet(root)).map((t) => t.task.id),
    ["HX-001", "HX-002"],
  );
  await makeTask(root, "HX-003", VALID.replace("HX-001", "HX-003") + "x: 1\n");
  await makeTask(root, "HX-004", "id: [");
  const err = await assertRejects(() => loadTaskSet(root), ValidationError);
  assertEquals(err.errors.length, 2);
});

Deno.test("loadTaskSet: empty folder is an error", async () => {
  await assertRejects(
    async () => await loadTaskSet(await Deno.makeTempDir()),
    ValidationError,
    "No tasks found",
  );
});

Deno.test("loadTask: a path under a linked ancestor folder is refused", async () => {
  const root = await Deno.makeTempDir();
  const outside = await Deno.makeTempDir();
  await Deno.writeTextFile(join(outside, "a.png"), "x");
  const yml = VALID.replace(
    "source: refapp",
    "source: refapp\nattachments: [shots/a.png]",
  );
  const dir = await makeTask(root, "HX-001", yml);
  const type = Deno.build.os === "windows" ? "junction" : "dir";
  await Deno.symlink(outside, join(dir, "shots"), { type });
  const err = await assertRejects(() => loadTask(dir), ValidationError);
  assertStringIncludes(err.message, "attachment is a link: shots/a.png");
});
