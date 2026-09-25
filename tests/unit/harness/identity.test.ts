import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import {
  AGENT_VISIBLE_FIELDS,
  agentVisibleMetadata,
  loadSymbolsLock,
  resolveRefapp,
  taskSetIdentity,
} from "../../../src/harness/identity.ts";
import { listTree } from "../../../src/harness/hash.ts";
import { loadTaskSet } from "../../../src/harness/task.ts";

const TASK = (id: string) =>
  `id: ${id}
refapp_version: refapp-v1
kind: bugfix
prompt: prompt.md
touches: [Rental]
source: refapp
scorers: [build, fail_to_pass]
fail_to_pass:
  depends_on: [Rental]
  tests:
    - { codeunit: 85001, procedures: [DamageBlocksCheckout] }
`;

async function write(root: string, rel: string, text: string) {
  await Deno.mkdir(join(root, rel, ".."), { recursive: true });
  await Deno.writeTextFile(join(root, rel), text);
}

async function git(root: string, ...args: string[]) {
  const out = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
}

/** Temp repo with a tagged refapp and two tasks. */
async function fixtureRepo(): Promise<string> {
  const root = await Deno.makeTempDir();
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "t@example.com");
  await git(root, "config", "user.name", "t");
  await git(root, "config", "core.autocrlf", "false");
  await write(root, "harness-tasks/refapp/Core/app.json", "{}\n");
  await write(root, "harness-tasks/refapp/Core/src/A.al", "codeunit 70000\n");
  await git(root, "add", ".");
  await git(root, "commit", "-q", "-m", "refapp");
  await git(root, "tag", "refapp-v1");
  for (const id of ["HX-001", "HX-002"]) {
    await write(root, `harness-tasks/tasks/${id}/task.yml`, TASK(id));
    await write(root, `harness-tasks/tasks/${id}/prompt.md`, "Fix it.");
    await write(root, `harness-tasks/tasks/${id}/oracle/T.al`, "codeunit");
    await write(root, `harness-tasks/tasks/${id}/naive/a/X.al`, "wrong");
  }
  return root;
}

async function identity(root: string) {
  const tasks = await loadTaskSet(join(root, "harness-tasks", "tasks"));
  return await taskSetIdentity(root, tasks, []);
}

async function retag(root: string, message: string) {
  await git(root, "add", "-A", "-f", "harness-tasks/refapp");
  await git(root, "commit", "-q", "--allow-empty", "-m", message);
  await git(root, "tag", "-f", "refapp-v1");
}

Deno.test("resolveRefapp: matches a checked-out listTree; unknown tag fails loudly", async () => {
  const root = await fixtureRepo();
  const ref = await resolveRefapp(root, "refapp-v1");
  assertEquals(ref.commit.length, 40);
  assertEquals(
    ref.files,
    await listTree(join(root, "harness-tasks", "refapp"), "task"),
  );
  await assertRejects(
    () => resolveRefapp(root, "refapp-v9"),
    ValidationError,
    "does not resolve",
  );
});

Deno.test("identity: a new commit with identical refapp content changes nothing", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await retag(root, "unrelated");
  const after = await identity(root);
  assertNotEquals(
    after.tasks[0]!.refapp_commit,
    before.tasks[0]!.refapp_commit,
  );
  assertEquals(after.identity, before.identity);
});

Deno.test("identity: tracked build artifacts in the refapp are excluded", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(root, "harness-tasks/refapp/Core/output/Core.app", "bin");
  await write(root, "harness-tasks/refapp/.alpackages/System.app", "bin");
  await retag(root, "build output committed by mistake");
  assertEquals((await identity(root)).identity, before.identity);
});

Deno.test("identity: a refapp source change moves every visible hash only", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(root, "harness-tasks/refapp/Core/app.json", '{"v":2}\n');
  await retag(root, "refapp v2");
  const after = await identity(root);
  for (const i of [0, 1]) {
    assertNotEquals(after.tasks[i]!.visible, before.tasks[i]!.visible);
    assertEquals(after.tasks[i]!.oracle, before.tasks[i]!.oracle);
  }
});

Deno.test("identity: oracle edit moves only that task's oracle hash", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(root, "harness-tasks/tasks/HX-001/oracle/T.al", "codeunit v2");
  const after = await identity(root);
  assertEquals(after.tasks[0]!.visible, before.tasks[0]!.visible);
  assertNotEquals(after.tasks[0]!.oracle, before.tasks[0]!.oracle);
  assertEquals(after.tasks[1], before.tasks[1]);
  assertNotEquals(after.identity, before.identity);
});

Deno.test("identity: prompt or overlay edit moves only the visible hash", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(root, "harness-tasks/tasks/HX-001/overlay/Rental/B.al", "bug");
  const after = await identity(root);
  assertNotEquals(after.tasks[0]!.visible, before.tasks[0]!.visible);
  assertEquals(after.tasks[0]!.oracle, before.tasks[0]!.oracle);
});

Deno.test("identity: metadata and naive/ edits move nothing", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(
    root,
    "harness-tasks/tasks/HX-001/task.yml",
    TASK("HX-001").replace(
      "touches: [Rental]",
      "touches: [Rental, Fleet]\ncoupling: [events]",
    ),
  );
  await write(root, "harness-tasks/tasks/HX-001/naive/a/X.al", "other");
  assertEquals(await identity(root), before);
});

Deno.test("identity: adding a task keeps the other entries", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(root, "harness-tasks/tasks/HX-003/task.yml", TASK("HX-003"));
  await write(root, "harness-tasks/tasks/HX-003/prompt.md", "New.");
  await write(root, "harness-tasks/tasks/HX-003/oracle/T.al", "c");
  const after = await identity(root);
  assertEquals(after.tasks.slice(0, 2), before.tasks);
  assertEquals(after.tasks.length, 3);
});

Deno.test("identity: no symbols lock means provisional and a different hash", async () => {
  const root = await fixtureRepo();
  const tasks = await loadTaskSet(join(root, "harness-tasks", "tasks"));
  const withSymbols = await taskSetIdentity(root, tasks, []);
  const without = await taskSetIdentity(root, tasks, null);
  assertEquals([withSymbols.provisional, without.provisional], [false, true]);
  assertNotEquals(without.identity, withSymbols.identity);
});

Deno.test("agentVisibleMetadata: exactly the whitelist, kind is not visible", async () => {
  const root = await fixtureRepo();
  const [t] = await loadTaskSet(join(root, "harness-tasks", "tasks"));
  const meta = agentVisibleMetadata(t!.task);
  assertEquals(Object.keys(meta).sort(), [...AGENT_VISIBLE_FIELDS].sort());
  assertEquals("kind" in meta, false);
});

const pkg = (app_id: string, name: string) => ({
  app_id,
  name,
  publisher: "Microsoft",
  version: "28.0.0.0",
  file: `Microsoft_${name}_28.0.0.0.app`,
  sha256: "a".repeat(64),
});
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

Deno.test("loadSymbolsLock: absent is null, packages sorted by app_id", async () => {
  const root = await Deno.makeTempDir();
  assertEquals(await loadSymbolsLock(root), null);
  await write(
    root,
    "harness-tasks/symbols.lock.json",
    JSON.stringify({ v: 1, packages: [pkg(B, "System"), pkg(A, "Base")] }),
  );
  assertEquals((await loadSymbolsLock(root))!.map((p) => p.app_id), [A, B]);
});

Deno.test("loadSymbolsLock: duplicates, bad digests, unknown version and bad JSON fail loudly", async () => {
  const cases = [
    JSON.stringify({ v: 1, packages: [pkg(A, "X"), pkg(A, "Y")] }),
    JSON.stringify({
      v: 1,
      packages: [{ ...pkg(A, "X"), sha256: "A".repeat(64) }],
    }),
    JSON.stringify({ v: 2, packages: [pkg(A, "X")] }),
    "{ not json",
  ];
  for (const text of cases) {
    const root = await Deno.makeTempDir();
    await write(root, "harness-tasks/symbols.lock.json", text);
    await assertRejects(
      () => loadSymbolsLock(root),
      ValidationError,
      "symbols.lock.json",
    );
  }
});

Deno.test("loadSymbolsLock: app_ids differing only in case are duplicates", async () => {
  const root = await Deno.makeTempDir();
  await write(
    root,
    "harness-tasks/symbols.lock.json",
    JSON.stringify({
      v: 1,
      packages: [pkg(A, "X"), pkg(A.toUpperCase(), "Y")],
    }),
  );
  await assertRejects(
    () => loadSymbolsLock(root),
    ValidationError,
    "symbols.lock.json",
  );
});

Deno.test("resolveRefapp: a missing refapp blob fails loudly", async () => {
  const root = await fixtureRepo();
  const out = await new Deno.Command("git", {
    args: ["rev-parse", "refapp-v1:harness-tasks/refapp/Core/src/A.al"],
    cwd: root,
  }).output();
  const sha = new TextDecoder().decode(out.stdout).trim();
  await Deno.remove(
    join(root, ".git", "objects", sha.slice(0, 2), sha.slice(2)),
  );
  await assertRejects(
    () => resolveRefapp(root, "refapp-v1"),
    ValidationError,
    "Core/src/A.al",
  );
});
