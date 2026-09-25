import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { basename, isAbsolute, join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import { exists } from "../../../src/harness/fsutil.ts";
import { hashFile } from "../../../src/harness/hash.ts";
import {
  agentVisibleMetadata,
  loadSymbolsLock,
  resolveRefapp,
} from "../../../src/harness/identity.ts";
import {
  applyOverlay,
  readAppGraph,
  stageRefappTask,
  TAR_BINARY,
  TASK_SOURCES,
} from "../../../src/harness/staging.ts";
import {
  altoolReader,
  buildSymbolsLock,
  lockMicrosoftSymbols,
} from "../../../src/harness/symbols.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { createCommandMock } from "../../utils/command-mock.ts";
import { appJson, git, IDS, makeRefappRepo, write } from "./refapp-fixture.ts";

async function stage(repo: Awaited<ReturnType<typeof makeRefappRepo>>) {
  const task = await loadTask(join(repo.tasksDir, "HX-001"));
  const refapp = await resolveRefapp(repo.root, "refapp-v1");
  return {
    task,
    staged: await stageRefappTask({
      repoRoot: repo.root,
      task,
      refapp,
      symbols: repo.symbols,
      symbolStore: repo.symbolStore,
      out: join(await Deno.realPath(await Deno.makeTempDir()), "stage"),
    }),
  };
}

Deno.test("stageRefappTask: refapp at the commit, overlay, deletions, symbols, C:\\task", async () => {
  const repo = await makeRefappRepo();
  const { task, staged: s } = await stage(repo);
  assertEquals(TASK_SOURCES.refapp, stageRefappTask);
  assertEquals(s.apps.map((a) => a.folder), ["Core", "Rental", "Test"]);
  assertEquals(s.apps[2]!.depends, ["Core", "Rental"]);
  assertEquals(s.apps[2]!.external, [IDS.assert]);
  assertStringIncludes(
    await Deno.readTextFile(join(s.workspace, "Rental/src/Rental.Codeunit.al")),
    "BUG",
  );
  assert(!await exists(join(s.workspace, "Rental/src/Old.Codeunit.al")));
  assert(!await exists(join(s.workspace, "Core/Core.app")));
  assert(!await exists(join(s.workspace, ".delete")));
  assertEquals(
    await Deno.readTextFile(
      join(s.workspace, ".alpackages", "Microsoft_Library Assert_28.0.0.0.app"),
    ),
    "assert-symbols",
  );
  assertEquals(
    await Deno.readTextFile(join(s.taskDir, "prompt.md")),
    "Rental price is wrong.",
  );
  assert(await exists(join(s.taskDir, "shots", "screen.png")));
  assertEquals(
    JSON.parse(await Deno.readTextFile(join(s.taskDir, "task.json"))),
    JSON.parse(JSON.stringify(agentVisibleMetadata(task.task))),
  );
  assertEquals(
    await Deno.readTextFile(join(s.pristine, "Rental/src/Rental.Codeunit.al")),
    await Deno.readTextFile(join(s.workspace, "Rental/src/Rental.Codeunit.al")),
  );
  assertEquals((await loadSymbolsLock(repo.root))!.length, 1);
});

Deno.test("applyOverlay: merges into a populated workspace; a linked destination or a case alias is refused", async () => {
  const tmp = async () => await Deno.realPath(await Deno.makeTempDir());
  const ws = await tmp();
  await write(ws, "Rental/src/Rental.al", "old");
  await write(ws, "Core/src/Core.al", "core");
  const ov = await tmp();
  await write(ov, "Rental/src/Rental.al", "new");
  await write(ov, "Rental/src/Added.al", "added");
  await write(ov, "Fresh/src/F.al", "fresh");
  await write(ov, ".delete", "Core/src/Core.al\n");
  await applyOverlay(ov, ws);
  assertEquals(
    await Deno.readTextFile(join(ws, "Rental", "src", "Rental.al")),
    "new",
  );
  assert(
    await exists(join(ws, "Rental", "src", "Added.al")) &&
      await exists(join(ws, "Fresh", "src", "F.al")),
  );
  assert(!await exists(join(ws, "Core", "src", "Core.al")));
  const outside = await tmp();
  await Deno.symlink(outside, join(ws, "Linked"), {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
  const ov2 = await tmp();
  await write(ov2, "Linked/x.al", "x");
  await assertRejects(() => applyOverlay(ov2, ws), ValidationError);
  assert(!await exists(join(outside, "x.al")));
  if (Deno.build.os === "windows") {
    const ov3 = await tmp();
    await write(ov3, "Rental/src/rental.al", "alias");
    await assertRejects(() => applyOverlay(ov3, ws), ValidationError, "case");
  }
});

Deno.test("stageRefappTask: a symbol store entry that does not match the lock is refused", async () => {
  const repo = await makeRefappRepo();
  await Deno.writeTextFile(
    join(repo.symbolStore, `${repo.symbols[0]!.sha256}.app`),
    "tampered",
  );
  await assertRejects(() => stage(repo), ValidationError, "does not match");
});

Deno.test("stageRefappTask: a .delete entry that escapes or is missing is refused", async () => {
  for (const line of ["../outside.al", "Rental/src/Nope.al"]) {
    const repo = await makeRefappRepo();
    await write(repo.tasksDir, "HX-001/overlay/.delete", `${line}\n`);
    await assertRejects(() => stage(repo), ValidationError, ".delete");
  }
});

Deno.test("readAppGraph: topological with name tie-break; a cycle is loud", async () => {
  const ws = await Deno.realPath(await Deno.makeTempDir());
  const a = "c6a1e000-0000-4000-8000-0000000000a1";
  const b = "c6a1e000-0000-4000-8000-0000000000b1";
  const c = "c6a1e000-0000-4000-8000-0000000000c1";
  await write(ws, "Zeta/app.json", appJson(a, "Z", [70000, 70009], []));
  await write(
    ws,
    "Alpha/app.json",
    appJson(b, "A", [70010, 70019], [{ id: a, name: "Z" }]),
  );
  await write(ws, "Beta/app.json", appJson(c, "B", [70020, 70029], []));
  await write(ws, ".alpackages/x.app", "bin");
  assertEquals((await readAppGraph(ws)).map((x) => x.folder), [
    "Beta",
    "Zeta",
    "Alpha",
  ]);
  await write(
    ws,
    "Zeta/app.json",
    appJson(a, "Z", [70000, 70009], [{ id: b, name: "A" }]),
  );
  await assertRejects(() => readAppGraph(ws), ValidationError, "cycle");
});

Deno.test("buildSymbolsLock: digest store, lower-case ids, sorted by app id", async () => {
  const from = await Deno.realPath(await Deno.makeTempDir());
  const store = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(from, "Microsoft_System_28.0.0.0.app"), "sys");
  await Deno.writeTextFile(
    join(from, "Microsoft_Base Application_28.0.0.0.app"),
    "base",
  );
  await Deno.writeTextFile(join(from, "readme.txt"), "ignored");
  const ids: Record<string, string> = {
    "Microsoft_System_28.0.0.0.app": "8874ED3A-0643-4247-9CED-7A7002F7135D",
    "Microsoft_Base Application_28.0.0.0.app":
      "437dbf0e-84ff-417a-965d-ed2bb9650972",
  };
  const lock = await buildSymbolsLock(from, store, (p) => {
    const file = p.split(/[/\\]/).pop()!;
    return Promise.resolve({
      id: ids[file]!,
      name: file.split("_")[1]!,
      publisher: "Microsoft",
      version: "28.0.0.0",
    });
  });
  assertEquals(lock.packages.map((p) => p.app_id), [
    "437dbf0e-84ff-417a-965d-ed2bb9650972",
    "8874ed3a-0643-4247-9ced-7a7002f7135d",
  ]);
  const sys = lock.packages[1]!;
  assertEquals(sys.sha256, await hashFile(from, join(from, sys.file)));
  assert(await exists(join(store, `${sys.sha256}.app`)));
});

Deno.test("altoolReader: parses GetPackageManifest JSON; a failing altool is loud", async () => {
  const mock = createCommandMock();
  mock.mockCommandOnce({
    command: "altool.exe",
    argsContain: ["GetPackageManifest"],
  }, {
    code: 0,
    stdout: JSON.stringify({
      id: "437DBF0E-84FF-417A-965D-ED2BB9650972",
      name: "Base Application",
      publisher: "Microsoft",
      version: "28.4.53241.53758",
      platform: "28.0.0.0",
    }),
    stderr: "",
  });
  mock.mockCommandOnce({
    command: "altool.exe",
    argsContain: ["GetPackageManifest"],
  }, {
    code: 1,
    stdout: "",
    stderr: "boom",
  });
  mock.install();
  try {
    const read = altoolReader("altool.exe");
    assertEquals(
      (await read("x.app")).id,
      "437dbf0e-84ff-417a-965d-ed2bb9650972",
    );
    await assertRejects(() => read("y.app"), ValidationError, "boom");
  } finally {
    mock.restore();
  }
});

Deno.test("applyOverlay: .delete never reaches through a link, the root or an excluded path", async () => {
  const tmp = async () => await Deno.realPath(await Deno.makeTempDir());
  const ws = await tmp();
  await write(ws, "Rental/src/Rental.al", "r");
  await write(ws, "Test/a.al", "t");
  const outside = await tmp();
  await write(outside, "secret.txt", "host");
  await Deno.symlink(outside, join(ws, "J"), {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
  const exclude = (rel: string) => rel === "Test" || rel.startsWith("Test/");
  const lines = [
    "J/secret.txt",
    "J",
    ".",
    "Rental/..",
    "Rental/../Test",
    "./Test/a.al",
    ...(Deno.build.os === "windows"
      ? ["test/a.al", "rental/src/Rental.al"]
      : []),
  ];
  for (const line of lines) {
    const ov = await tmp();
    await write(ov, ".delete", `${line}\n`);
    await applyOverlay(ov, ws, { exclude }).catch(() => {});
    assert(await exists(join(outside, "secret.txt")), line);
    assert(await exists(join(ws, "Test", "a.al")), line);
    assert(await exists(join(ws, "Rental", "src", "Rental.al")), line);
  }
  for (const line of ["J/secret.txt", ".", "Rental/..", "J"]) {
    const ov = await tmp();
    await write(ov, ".delete", `${line}\n`);
    await assertRejects(
      () => applyOverlay(ov, ws),
      ValidationError,
      ".delete",
      line,
    );
  }
});

Deno.test("stageRefappTask: text files are staged byte-exact under core.autocrlf=true", async () => {
  const repo = await makeRefappRepo();
  await git(repo.root, "config", "core.autocrlf", "true");
  await write(
    repo.root,
    "harness-tasks/refapp/Rental/Translations/Rental.xlf",
    "a\nb\n",
  );
  await write(repo.root, "harness-tasks/refapp/.gitignore", "x\ny\n");
  await git(repo.root, "add", ".");
  await git(repo.root, "commit", "-q", "-m", "xlf");
  await git(repo.root, "tag", "-f", "refapp-v1");
  const { staged } = await stage(repo);
  assertEquals(
    await Deno.readTextFile(
      join(staged.workspace, "Rental", "Translations", "Rental.xlf"),
    ),
    "a\nb\n",
  );
});

Deno.test("stageRefappTask: a failed staging leaves nothing behind; a retry into the same out works", async () => {
  const repo = await makeRefappRepo();
  const store = join(repo.symbolStore, `${repo.symbols[0]!.sha256}.app`);
  const good = await Deno.readFile(store);
  await Deno.writeTextFile(store, "tampered");
  const out = join(await Deno.realPath(await Deno.makeTempDir()), "stage");
  const o = {
    repoRoot: repo.root,
    task: await loadTask(join(repo.tasksDir, "HX-001")),
    refapp: await resolveRefapp(repo.root, "refapp-v1"),
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    out,
  };
  await assertRejects(
    () => stageRefappTask(o),
    ValidationError,
    "does not match",
  );
  assertEquals([...Deno.readDirSync(out)], []);
  await Deno.writeFile(store, good);
  assertEquals((await stageRefappTask(o)).apps.length, 3);
});

Deno.test("readAppGraph: two apps with the same id are refused", async () => {
  const ws = await Deno.realPath(await Deno.makeTempDir());
  await write(
    ws,
    "Rental/app.json",
    appJson(IDS.rental, "CGR Rental", [70200, 70299], []),
  );
  await write(
    ws,
    "Rental2/app.json",
    appJson(IDS.rental.toUpperCase(), "CGR Rental 2", [70300, 70399], []),
  );
  await assertRejects(() => readAppGraph(ws), ValidationError, "same app id");
});

Deno.test("stageRefappTask: overlay entries the visible hash excludes are refused", async () => {
  for (
    const rel of [".alpackages/extra.app", "Rental/Output/x.al", "Rental/x.APP"]
  ) {
    const repo = await makeRefappRepo();
    await write(repo.tasksDir, `HX-001/overlay/${rel}`, "bin");
    await assertRejects(
      () => stage(repo),
      ValidationError,
      "build artifact",
      rel,
    );
  }
});

Deno.test("stageRefappTask: an overlay may not write or delete anything under Test/", async () => {
  const edits: [string, string][] = [
    ["HX-001/overlay/Test/src/Shipped.Test.al", "codeunit 80010 X {}"],
    ["HX-001/overlay/.delete", "Test/src/Shipped.Test.al\n"],
    ["HX-001/overlay/test/src/New.Test.al", "codeunit 80011 Y {}"],
  ];
  for (const [rel, text] of edits) {
    const repo = await makeRefappRepo();
    await write(repo.tasksDir, rel, text);
    await assertRejects(
      () => stage(repo),
      ValidationError,
      "shipped test",
      rel,
    );
  }
  const repo = await makeRefappRepo();
  const { staged } = await stage(repo);
  assertStringIncludes(
    await Deno.readTextFile(
      join(staged.pristine, "Test", "src", "Shipped.Test.al"),
    ),
    "procedure ShippedPasses()",
  );
});

Deno.test("stageRefappTask: symbols are verified on the copy, every staging", async () => {
  const repo = await makeRefappRepo();
  await stage(repo);
  await Deno.writeTextFile(
    join(repo.symbolStore, `${repo.symbols[0]!.sha256}.app`),
    "swapped",
  );
  await assertRejects(() => stage(repo), ValidationError, "does not match");
});

Deno.test("stageRefappTask: pre-existing content in out is never deleted", async () => {
  const repo = await makeRefappRepo();
  const out = join(await Deno.realPath(await Deno.makeTempDir()), "stage");
  await write(out, "workspace/keep.al", "mine");
  await assertRejects(
    async () =>
      stageRefappTask({
        repoRoot: repo.root,
        task: await loadTask(join(repo.tasksDir, "HX-001")),
        refapp: await resolveRefapp(repo.root, "refapp-v1"),
        symbols: repo.symbols,
        symbolStore: repo.symbolStore,
        out,
      }),
    ValidationError,
    "already exists",
  );
  assertEquals(
    await Deno.readTextFile(join(out, "workspace", "keep.al")),
    "mine",
  );
});

Deno.test("TAR_BINARY is an absolute, pinned path", () => {
  assert(isAbsolute(TAR_BINARY), TAR_BINARY);
  if (Deno.build.os === "windows") {
    assertEquals(TAR_BINARY.toLowerCase(), "c:\\windows\\system32\\tar.exe");
  }
});

Deno.test("stageRefappTask: a permitted empty out/workspace is emptied back on failure; the retry works", async () => {
  const repo = await makeRefappRepo();
  const out = join(await Deno.realPath(await Deno.makeTempDir()), "stage");
  await Deno.mkdir(join(out, "workspace"), { recursive: true });
  const store = join(repo.symbolStore, `${repo.symbols[0]!.sha256}.app`);
  const good = await Deno.readFile(store);
  await Deno.writeTextFile(store, "tampered");
  const o = {
    repoRoot: repo.root,
    task: await loadTask(join(repo.tasksDir, "HX-001")),
    refapp: await resolveRefapp(repo.root, "refapp-v1"),
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    out,
  };
  await assertRejects(
    () => stageRefappTask(o),
    ValidationError,
    "does not match",
  );
  assertEquals([...Deno.readDirSync(join(out, "workspace"))], []);
  await Deno.writeFile(store, good);
  assertEquals((await stageRefappTask(o)).apps.length, 3);
});

Deno.test("stageRefappTask: shipped tests are compared by raw bytes (CRLF vs LF is a difference)", async () => {
  const repo = await makeRefappRepo();
  // An eol attribute makes git archive write CRLF; listTree normalizes that away.
  await write(repo.root, ".gitattributes", "*.al text eol=crlf\n");
  await git(repo.root, "add", ".");
  await git(repo.root, "commit", "-q", "-m", "eol");
  await git(repo.root, "tag", "-f", "refapp-v1");
  await assertRejects(
    () => stage(repo),
    ValidationError,
    "shipped tests differ",
  );
});

Deno.test("lockMicrosoftSymbols: locks Microsoft apps only, reports the rest, refuses none", async () => {
  const from = await Deno.realPath(await Deno.makeTempDir());
  const store = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(from, "Microsoft_System_28.0.0.0.app"), "sys");
  await Deno.writeTextFile(
    join(from, "CentralGauge_CG-AL-H028 Prereq_1.0.0.0.app"),
    "cg",
  );
  const manifests: Record<
    string,
    { id: string; name: string; publisher: string }
  > = {
    "Microsoft_System_28.0.0.0.app": {
      id: "8874ed3a-0643-4247-9ced-7a7002f7135d",
      name: "System",
      publisher: "Microsoft",
    },
    "CentralGauge_CG-AL-H028 Prereq_1.0.0.0.app": {
      id: "a1b2c3d4-0028-0000-0000-000000000028",
      name: "CG-AL-H028 Prereq",
      publisher: "CentralGauge",
    },
  };
  const read = (p: string) =>
    Promise.resolve({ ...manifests[basename(p)]!, version: "28.0.0.0" });
  const r = await lockMicrosoftSymbols(from, store, read);
  assertEquals(r.lock.packages.map((p) => p.name), ["System"]);
  assertEquals(r.excluded.map((e) => [e.file, e.publisher]), [
    ["CentralGauge_CG-AL-H028 Prereq_1.0.0.0.app", "CentralGauge"],
  ]);
  assertEquals(
    [...Deno.readDirSync(store)].length,
    1,
    "excluded apps are not stored",
  );
  await Deno.remove(join(from, "Microsoft_System_28.0.0.0.app"));
  await assertRejects(
    async () =>
      lockMicrosoftSymbols(
        from,
        await Deno.realPath(await Deno.makeTempDir()),
        read,
      ),
    ValidationError,
    "Microsoft",
  );
});
