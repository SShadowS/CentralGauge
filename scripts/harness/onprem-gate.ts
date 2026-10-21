/**
 * H-38 Q2 gate (design 8.4): the shipped-tree guard of the `onprem_ref` rule
 * against the real symbol lock, fallback active. Not in test:harness:fast;
 * run as `deno task test:harness:onprem-gate [--symbol-store DIR]` (default
 * results/harness/symbols). A missing store, a missing package or a loader
 * error FAILS, never skips.
 *
 * Contexts, every one through productionPolicyViolations and
 * testPolicyViolations as a judge would: the refapp; per task the staged
 * pristine (refapp + overlay/), and the pristine with correct/, every
 * naive/<n>/, every fixture/<f>/ applied, every mutants/<m>/ over pristine +
 * correct (Test paths excluded, as verdict.ts); oracle/ and reference-tests/
 * as Test text. The task and variant directories enumerated must equal the
 * git-tracked ones. Output: lock digest, scanned .al counts, the index build
 * time and the full onprem_ref hit list; pass = zero hits.
 */

import { parseArgs } from "@std/cli/parse-args";
import { fromFileUrl, join, resolve } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import { lockDigestOf } from "../../src/harness/bc-lane.ts";
import { safeCopyTree } from "../../src/harness/fsutil.ts";
import { listTree } from "../../src/harness/hash.ts";
import { loadSymbolsLock } from "../../src/harness/identity.ts";
import { loadOnPremIndex } from "../../src/harness/onprem-symbols.ts";
import { applyOverlay, readAppGraph } from "../../src/harness/staging.ts";
import { loadTask } from "../../src/harness/task.ts";
import {
  productionPolicyViolations,
  TEST_APP,
  testPolicyViolations,
} from "../../src/harness/verdict-workspace.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const VARIANT_KINDS = ["naive", "mutants", "fixture"] as const;

async function dirs(path: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(path)) {
      if (e.isDirectory) out.push(e.name);
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return out.sort();
}

/** The git-tracked directories `harness-tasks/tasks/<id>[/<kind>/<name>]` (the shipped tree). */
async function tracked(): Promise<string[]> {
  const out = await new Deno.Command("git", {
    args: ["ls-files", "harness-tasks/tasks"],
    cwd: ROOT,
    stdout: "piped",
  }).output();
  assert(out.success, "git ls-files failed");
  return new TextDecoder().decode(out.stdout).split("\n").filter(Boolean);
}

/** The .al files of `dir` (relative, `/`-separated) under an optional top folder. */
async function alFiles(
  dir: string,
  under?: string,
): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const e of await listTree(dir, "task")) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    if (under && !e.path.startsWith(`${under}/`)) continue;
    const rel = under ? e.path.slice(under.length + 1) : e.path;
    out.push([rel, await Deno.readTextFile(join(dir, ...e.path.split("/")))]);
  }
  return out;
}

Deno.test("H-38 Q2 gate (8.4): the shipped tree has no onprem_ref hit against the real symbol lock, fallback active", async () => {
  const args = parseArgs(Deno.args, { string: ["symbol-store"] });
  const store = resolve(
    ROOT,
    args["symbol-store"] ?? "results/harness/symbols",
  );
  const packages = await loadSymbolsLock(ROOT);
  assert(packages, "no symbols lock");
  const lock = { store, packages };
  const digest = await lockDigestOf(lock);
  const t0 = performance.now();
  const index = await loadOnPremIndex(lock);
  const buildMs = Math.round(performance.now() - t0);
  // The two acceptance members (design 8) are in the real index.
  const ism = index.objects.get("codeunit")?.get("isolated storage management");
  assert(ism?.ids.has(1293) && ism.members.has("get"), "codeunit 1293 Get");
  const rs = index.objects.get("table")?.get("report selections");
  assert(
    rs?.ids.has(77) && rs.members.has("gethtmlreportforcust"),
    "table 77 GetHtmlReportForCust",
  );

  const tmp = await Deno.makeTempDir({ prefix: "cg-onprem-gate-" });
  const hits: string[] = [];
  let scanned = 0;
  let contexts = 0;
  const scan = async (
    label: string,
    dir: string,
    allow?: Parameters<typeof productionPolicyViolations>[2],
  ) => {
    contexts++;
    const apps = await readAppGraph(dir);
    const prod = await productionPolicyViolations(dir, apps, allow, index);
    const test = await alFiles(dir, TEST_APP);
    scanned += (await alFiles(dir)).length;
    const vs = [...prod, ...testPolicyViolations(test, index)];
    for (const v of vs) {
      if (v.startsWith("onprem_ref: ")) hits.push(`${label}: ${v}`);
    }
  };
  const scanText = async (label: string, dir: string) => {
    contexts++;
    const files = await alFiles(dir);
    scanned += files.length;
    for (const v of testPolicyViolations(files, index)) {
      if (v.startsWith("onprem_ref: ")) hits.push(`${label}: ${v}`);
    }
  };
  try {
    const refapp = join(ROOT, "harness-tasks", "refapp");
    await scan("refapp", refapp);
    const tasksDir = join(ROOT, "harness-tasks", "tasks");
    const ids = (await dirs(tasksDir)).filter((d) => !d.startsWith("."));
    const git = await tracked();
    const gitIds = [...new Set(git.map((p) => p.split("/")[2]!))].sort();
    assertEquals(ids, gitIds, "task directories differ from the tracked tree");
    const counts: Record<string, number> = {
      correct: 0,
      oracle: 0,
      "reference-tests": 0,
    };
    for (const k of VARIANT_KINDS) counts[k] = 0;
    for (const id of ids) {
      const task = await loadTask(join(tasksDir, id));
      const allow = task.task.production_allow;
      const pristine = join(tmp, id, "pristine");
      await safeCopyTree(refapp, pristine);
      await applyOverlay(join(task.dir, "overlay"), pristine);
      await scan(`${id} pristine`, pristine, allow);
      const variant = async (
        label: string,
        from: string,
        overlay: string,
        exclude?: (rel: string) => boolean,
      ) => {
        const ws = join(tmp, id, label.replaceAll("/", "_"));
        await safeCopyTree(from, ws);
        await applyOverlay(overlay, ws, exclude ? { exclude } : {});
        await scan(`${id} ${label}`, ws, allow);
        return ws;
      };
      let reference = pristine;
      if ((await dirs(task.dir)).includes("correct")) {
        counts["correct"]!++;
        reference = await variant(
          "correct",
          pristine,
          join(task.dir, "correct"),
        );
      }
      for (const kind of VARIANT_KINDS) {
        const names = await dirs(join(task.dir, kind));
        const want = [
          ...new Set(
            git.filter((p) =>
              p.startsWith(`harness-tasks/tasks/${id}/${kind}/`)
            )
              .map((p) => p.split("/")[4]!),
          ),
        ].sort();
        assertEquals(
          names,
          want,
          `${id}/${kind} differs from the tracked tree`,
        );
        for (const n of names) {
          counts[kind]!++;
          if (kind === "mutants") {
            const testPath = (rel: string) =>
              rel === TEST_APP || rel.startsWith(`${TEST_APP}/`);
            await variant(
              `mutants/${n}`,
              reference,
              join(task.dir, kind, n),
              testPath,
            );
          } else {
            await variant(`${kind}/${n}`, pristine, join(task.dir, kind, n));
          }
        }
      }
      for (const kind of ["oracle", "reference-tests"]) {
        if (!(await dirs(task.dir)).includes(kind)) continue;
        counts[kind]!++;
        await scanText(`${id} ${kind}`, join(task.dir, kind));
      }
    }
    console.log(
      JSON.stringify(
        {
          lock_digest: digest,
          lock_packages: packages.length,
          index_build_ms: buildMs,
          indexed_onprem_names: index.names.size,
          tasks: ids.length,
          variant_dirs: counts,
          contexts,
          scanned_al_files: scanned,
          hits: hits.length,
        },
        null,
        2,
      ),
    );
    for (const h of hits) console.log(h);
    assertEquals(
      hits.length,
      0,
      `${hits.length} onprem_ref hit(s) in the shipped tree`,
    );
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});
