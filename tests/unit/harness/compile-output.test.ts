/**
 * H-55: compiled apps (judge Test, oracle, candidate) never linger on the
 * BcContainerHelper shared folder every BC container mounts. Mock-only: no
 * container, no pwsh, no write under C:\ProgramData.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const BCH = "c:\\programdata\\bccontainerhelper";

/** The provider's shared folders redirected to temp dirs; pwsh faked. */
class TestProvider extends BcContainerProvider {
  constructor(private readonly shared: string) {
    super();
  }
  protected override harnessSharedFolder(): string {
    return this.shared;
  }
}

async function compileOnce(answer: (outDir: string) => string) {
  const shared = await testTempDir();
  const compiler = await testTempDir();
  const project = await testTempDir();
  const p = new TestProvider(shared);
  let outDir = "";
  Object.assign(p, {
    getOrCreateCompilerFolder: () => Promise.resolve(compiler),
    getOrCreateCompilePool: () => null,
    executePowerShell: async (script: string) => {
      const m = /-appOutputFolder "([^"]+)"/.exec(script);
      outDir = m![1]!.replaceAll("\\\\", "\\");
      const out = answer(outDir);
      // The compiler writes its package into the folder it was given.
      if (out.includes("APP_FILE:")) {
        await Deno.writeTextFile(join(outDir, "P_T_1.0.0.0.app"), "app");
      }
      return { output: out, exitCode: 0 };
    },
  });
  const r = await p.compileProject("TestContainer", {
    path: project,
    appJson: { name: "T", publisher: "P", version: "1.0.0.0" },
    sourceFiles: [],
    testFiles: [],
  });
  return { r, outDir, compiler };
}

Deno.test("H-55 compileProject: the output folder is private (outside the BCH shared folder and the compiler folder) and the caller owns it", async () => {
  const { r, outDir, compiler } = await compileOnce((d) =>
    `COMPILE_SUCCESS\nAPP_FILE:${d}\\P_T_1.0.0.0.app`
  );
  const lower = outDir.toLowerCase();
  assert(!lower.startsWith(BCH), outDir);
  assert(!lower.startsWith(compiler.toLowerCase()), outDir);
  assertEquals(r.success, true);
  assert(r.outputDir, "a successful compile hands its output dir over");
  assert(lower.startsWith(r.outputDir!.toLowerCase()));
  assert(await Deno.stat(r.artifactPath!));
  await Deno.remove(r.outputDir!, { recursive: true });
});

Deno.test("H-55 compileProject: a failed compile removes its own output folder and hands none over", async () => {
  const { r, outDir } = await compileOnce(() =>
    "error AL0001: x\nCOMPILE_FAILED"
  );
  assertEquals(r.success, false);
  assertEquals(r.outputDir, undefined);
  assertEquals(await Deno.stat(outDir).catch(() => null), null);
});

Deno.test("H-55 compileProject: a thrown compile removes its own output folder", async () => {
  const shared = await testTempDir();
  const p = new TestProvider(shared);
  let outDir = "";
  Object.assign(p, {
    getOrCreateCompilerFolder: () => Promise.resolve(shared),
    getOrCreateCompilePool: () => null,
    executePowerShell: (script: string) => {
      outDir = /-appOutputFolder "([^"]+)"/.exec(script)![1]!
        .replaceAll("\\\\", "\\");
      return Promise.reject(new Error("pwsh died"));
    },
  });
  const r = await p.compileProject("TestContainer", {
    path: await testTempDir(),
    appJson: { name: "T" },
    sourceFiles: [],
    testFiles: [],
  });
  assertEquals(r.success, false);
  assert(outDir);
  assertEquals(await Deno.stat(outDir).catch(() => null), null);
});

Deno.test("H-55 runTests without an app: the implicit compile's output dir goes even when the test run throws", async () => {
  const p = new TestProvider(await testTempDir());
  const out = await Deno.makeTempDir({ prefix: "cg-compile-test-" });
  await Deno.writeTextFile(join(out, "P_T_1.0.0.0.app"), "app");
  Object.assign(p, {
    compileProject: () =>
      Promise.resolve({
        success: true,
        errors: [],
        warnings: [],
        output: "",
        duration: 1,
        artifactPath: join(out, "P_T_1.0.0.0.app"),
        outputDir: out,
      }),
    runTestsWithApp: () => Promise.reject(new Error("session lost")),
  });
  const project = await testTempDir();
  await assertRejects(() =>
    p.runTests("TestContainer", {
      path: project,
      appJson: {},
      sourceFiles: [],
      testFiles: [],
    })
  );
  assertEquals(await Deno.stat(out).catch(() => null), null);
});

Deno.test("H-55 publishApp: the copy in the container's shared folder is removed even when the publish throws", async () => {
  const shared = await testTempDir();
  const src = join(await testTempDir(), "P_T_1.0.0.0.app");
  await Deno.writeTextFile(src, "app");
  const p = new TestProvider(shared);
  let staged: string[] = [];
  Object.assign(p, {
    runScriptThroughSession: async () => {
      for await (const e of Deno.readDir(shared)) staged.push(e.name);
      throw new Error("session lost");
    },
  });
  await assertRejects(() => p.publishApp("TestContainer", src));
  assertEquals(staged.length, 1, "staged in the shared folder for the call");
  staged = [];
  for await (const e of Deno.readDir(shared)) staged.push(e.name);
  assertEquals(staged, []);
});
