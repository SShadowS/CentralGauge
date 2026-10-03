/**
 * M4-17a prep: every frozen harness task (harness-tasks/tasks/HX-*), staged
 * at its own refapp rev, builds its mutant_kill reference and mutant verdict
 * workspaces with dropShippedTests on, without a fail-closed error and
 * without a dangling reference to a dropped shipped test codeunit. Static
 * only (no AL compile): lane-ops compiles the real builds with
 * `harness judge-fixture` on a container.
 *
 * The task's own reference is used: reference-tests/ for test-authoring
 * (HX-002), correct/ for the others (which never build without the shipped
 * tests, but their shipped Test apps are checked for drop safety all the
 * same). One [Test] is also appended to every shipped test codeunit, so the
 * extraction into generated codeunits is exercised at every rev.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { exists, safeCopyTree } from "../../../src/harness/fsutil.ts";
import {
  loadSymbolsLock,
  resolveRefapp,
} from "../../../src/harness/identity.ts";
import { applyOverlay, stageRefappTask } from "../../../src/harness/staging.ts";
import { loadTask } from "../../../src/harness/task.ts";
import {
  addedTestCodeunits,
  buildVerdictWorkspace,
  stripAlNoise,
  TEST_APP,
  testCodeunits,
} from "../../../src/harness/verdict-workspace.ts";

const ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const TASKS = join(ROOT, "harness-tasks", "tasks");
const tmp = async () => await Deno.realPath(await Deno.makeTempDir());
const isTestPath = (rel: string) =>
  rel === TEST_APP || rel.startsWith(`${TEST_APP}/`);

async function alFiles(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(join(dir, rel))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory) out.push(...await alFiles(dir, r));
    else if (e.name.toLowerCase().endsWith(".al")) out.push(r);
  }
  return out.sort();
}

/** Lowercased identifiers (quoted or bare) and integer literals of code, comments and strings excluded. */
function refs(src: string): Set<string> {
  return new Set(
    [...stripAlNoise(src).matchAll(/"([^"\n]*)"|([A-Za-z_]\w*)|(\d+)/g)]
      .map((m) => (m[1] ?? m[2] ?? m[3]!).toLowerCase()),
  );
}

// The v1 frozen set only: v2 candidates (HX-007 onward) pin refapp-v2 tags.
const ids: string[] = [];
for await (const e of Deno.readDir(TASKS)) {
  if (!e.isDirectory || !/^HX-\d+$/.test(e.name)) continue;
  const { task } = await loadTask(join(TASKS, e.name));
  if (task.refapp_version.startsWith("refapp-v1")) ids.push(e.name);
}
ids.sort();

Deno.test("frozen tasks: the set is HX-001..HX-006", () => {
  assertEquals(ids, [
    "HX-001",
    "HX-002",
    "HX-003",
    "HX-004",
    "HX-005",
    "HX-006",
  ]);
});

for (const id of ids) {
  Deno.test(`frozen task ${id}: mutant_kill builds without the shipped tests are sound`, async () => {
    const task = await loadTask(join(TASKS, id));
    const t = task.task;
    const staged = await stageRefappTask({
      repoRoot: ROOT,
      task,
      refapp: await resolveRefapp(ROOT, t.refapp_version),
      // No symbol packages are restored: nothing is compiled here.
      symbols: [],
      symbolStore: await tmp(),
      out: join(await tmp(), "stage"),
    });
    const pristine = staged.pristine;
    const symbolIds = new Set(
      (await loadSymbolsLock(ROOT))!.map((p) => p.app_id.toLowerCase()),
    );
    const shippedTests = await testCodeunits(join(pristine, TEST_APP));
    assert(shippedTests.length > 0, `${id}: shipped test codeunits`);

    // The agent artifact: the task's reference plus one added [Test] per shipped test codeunit.
    const artifact = await tmp();
    await safeCopyTree(pristine, artifact);
    const testAuthoring = t.kind === "test-authoring";
    await applyOverlay(
      join(task.dir, testAuthoring ? "reference-tests" : "correct"),
      artifact,
    );
    for (const s of shippedTests) {
      const p = join(artifact, TEST_APP, ...s.file.split("/"));
      await Deno.writeTextFile(
        p,
        (await Deno.readTextFile(p)).replace(
          /}\s*$/,
          `\n    [Test]\n    procedure AddedProbe${s.codeunit}()\n    begin\n        Message('probe ${s.codeunit}');\n    end;\n}\n`,
        ),
      );
    }

    // Production: the reference (correct/ over the staged code), then a mutant.
    const reference = await tmp();
    await safeCopyTree(pristine, reference);
    await applyOverlay(join(task.dir, "correct"), reference, {
      exclude: isTestPath,
    });
    let mutant = pristine; // mutant 0: the staged production
    if (t.mutants.length > 0) {
      mutant = await tmp();
      await safeCopyTree(reference, mutant);
      await applyOverlay(join(task.dir, "mutants", t.mutants[0]!), mutant, {
        exclude: isTestPath,
      });
    }

    const dropped = new Map<string, string>(); // lowercased name or id -> label
    for (const s of shippedTests) {
      const src = stripAlNoise(
        await Deno.readTextFile(join(pristine, TEST_APP, ...s.file.split("/"))),
      );
      const name = new RegExp(
        `codeunit\\s+${s.codeunit}\\s+(?:"([^"\\n]+)"|(\\w+))`,
        "i",
      ).exec(src)!;
      dropped.set((name[1] ?? name[2]!).toLowerCase(), `${s.codeunit}`);
      dropped.set(String(s.codeunit), `${s.codeunit}`);
    }

    for (
      const [label, productionFrom] of [["reference", reference], [
        "mutant",
        mutant,
      ]] as const
    ) {
      const v = await buildVerdictWorkspace({
        pristine,
        artifact,
        out: join(await tmp(), label),
        productionFrom,
        symbolIds,
        dropShippedTests: true,
      });
      const where = `${id} ${label}`;
      assertEquals([v.violations, v.notes, v.excluded], [[], [], []], where);
      const testDir = join(v.dir, TEST_APP);
      for (const s of shippedTests) {
        assertEquals(
          await exists(join(testDir, ...s.file.split("/"))),
          false,
          `${where}: shipped ${s.file} is dropped`,
        );
      }
      // Dropped files hold only shipped test codeunits (else the build
      // fails closed), so a kept file needing a dropped object would name
      // or number one of them.
      for (const f of await alFiles(testDir)) {
        const hit = [...refs(await Deno.readTextFile(join(testDir, f)))]
          .find((r) => dropped.has(r));
        assertEquals(
          hit,
          undefined,
          `${where}: ${f} references a dropped codeunit`,
        );
      }
      const found = await addedTestCodeunits(
        join(pristine, TEST_APP),
        testDir,
        new Set(v.excluded),
      );
      const generated = found.filter((x) => x.file.startsWith("CGExtracted/"));
      assertEquals(
        generated.map((x) => x.procedures).sort(),
        shippedTests.map((s) => [`AddedProbe${s.codeunit}`]).sort(),
        `${where}: one generated codeunit per shipped test codeunit`,
      );
      if (testAuthoring) {
        assert(
          found.some((x) =>
            !x.file.startsWith("CGExtracted/") && x.procedures.length > 0
          ),
          `${where}: the reference-tests suite is discovered`,
        );
      }
    }
  });
}
