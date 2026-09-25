// Ops driver for M1-27. Usage (container leased, no bench live):
//   DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/harness/app-sync-probe.ts <container> <outDir> [refapp-rev]
import { basename, join, resolve } from "@std/path";
import { setupContainers } from "../../cli/commands/bench/container-setup.ts";
import type { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
import { ConfigManager } from "../../src/config/config.ts";
import { allocatedContainer } from "../../src/harness/allocation.ts";
import {
  loadLedger,
  saveLedger,
  trustedHarnessAppIds,
} from "../../src/harness/bc-apps.ts";
import {
  BcLane,
  deploy,
  prepareApps,
  runTests,
} from "../../src/harness/bc-lane.ts";
import { safeCopyTree, validatedDest } from "../../src/harness/fsutil.ts";
import { isTaskBuildArtifact } from "../../src/harness/hash.ts";
import { loadSymbolsLock, REFAPP_PATH } from "../../src/harness/identity.ts";
import { readAppGraph, TAR_BINARY } from "../../src/harness/staging.ts";
import {
  TEST_APP,
  testCodeunits,
} from "../../src/harness/verdict-workspace.ts";
import { acquireBenchLock } from "../../src/utils/bench-lock.ts";

// Positional arguments only; flags (--list-only, --keep) are read separately.
const [containerArg, outArg, rev = "refapp-v1-rc1"] = Deno.args.filter((a) =>
  !a.startsWith("--")
);
if (!containerArg || !outArg) {
  throw new Error(
    "usage: app-sync-probe.ts <container> <outDir> [refapp-rev] [--list-only | --keep]",
  );
}
const listOnly = Deno.args.includes("--list-only");
/** Leave the apps of the last step installed (M1-27 Step 3 observes them afterwards). */
const keep = Deno.args.includes("--keep");
// Allowlist from the owner's allocation (coord root allocation.json), fail closed.
const container = await allocatedContainer(containerArg);
const release = acquireBenchLock("results", {
  command: `app-sync-probe ${container}`,
});
let bc: BcContainerProvider | null = null;
try {
  const outDir = await validatedDest(resolve(outArg));
  const packages = await loadSymbolsLock(".");
  if (!packages) throw new Error("no symbols lock; run M1-26 first");
  const lock = { store: resolve("results/harness/symbols"), packages };
  const cfg = await ConfigManager.loadConfig();
  bc = (await setupContainers([container], "bccontainer", cfg.container ?? {}))
    .containerProvider as BcContainerProvider;
  const lane = new BcLane(bc, [container]);
  // The shared ledger scope (M1-15): the probe empties it for this container because it prenukes.
  // trustedRoots gets the exported pristine refapp below (the allowlist source, M1-15).
  const ctx = {
    ledgerRoot: resolve("results/harness/bc-ledger"),
    trustedRoots: [] as string[],
  };
  const log = (step: string, data: Record<string, unknown>) =>
    console.log(
      JSON.stringify({ step, at: new Date().toISOString(), ...data }),
    );
  const listed = async () =>
    (await bc!.listHarnessApps(container)).map((a) =>
      `${a.name}@${a.version}${a.installed ? "" : " (not installed)"}`
    ).sort();
  const exportRefapp = async (to: string) => {
    const tar = join(outDir, `refapp-${crypto.randomUUID().slice(0, 8)}.tar`);
    const x = join(outDir, `x-${crypto.randomUUID().slice(0, 8)}`);
    await Deno.mkdir(x);
    // As stageRefappTask (M1-13): raw blobs, pinned tar, relative archive path.
    for (
      const [cmd, args, cwd] of [["git", [
        "-c",
        "core.autocrlf=false",
        "archive",
        "--format=tar",
        "-o",
        tar,
        rev,
        REFAPP_PATH,
      ], undefined], [
        TAR_BINARY,
        ["-xf", `../${basename(tar)}`, "--strip-components=2"],
        x,
      ]] as const
    ) {
      const r = await new Deno.Command(cmd, {
        args: [...args],
        ...(cwd ? { cwd } : {}),
      }).output();
      if (!r.success) {
        throw new Error(`${cmd} failed: ${new TextDecoder().decode(r.stderr)}`);
      }
    }
    await safeCopyTree(x, to, { skip: isTaskBuildArtifact });
    return to;
  };
  const touchFirstAl = async (dir: string, app: string) => {
    for await (const e of Deno.readDir(join(dir, app, "src"))) {
      if (e.name.endsWith(".al")) {
        return await Deno.writeTextFile(
          join(dir, app, "src", e.name),
          "\n// probe\n",
          { append: true },
        );
      }
    }
  };
  const step = async (
    name: string,
    pristine: string,
    candidateDir: string,
    changed: string[],
  ) => {
    const prep = await prepareApps(lane, {
      pristine,
      pristineApps: await readAppGraph(pristine),
      candidateDir,
      candidateApps: await readAppGraph(candidateDir),
      changed,
      workDir: join(outDir, name),
      lock,
    });
    const before = await listed();
    const deployed = await deploy(bc!, container, prep.wanted, ctx);
    const units = (await testCodeunits(join(candidateDir, TEST_APP))).filter((
      t,
    ) => !t.testPage);
    const tests = await runTests(
      bc!,
      container,
      units.map((u) => ({
        codeunit: u.codeunit,
        procedures: null,
        target: "candidate",
      })),
    );
    log(name, {
      before,
      after: await listed(),
      candidates: prep.candidateIds,
      compile_ms: prep.compile_ms,
      per_app_compiles: prep.per_app_compiles,
      deployed,
      codeunits: units.map((u) => u.codeunit),
      rows: tests.rows,
      test_ms: tests.test_ms,
    });
    return prep;
  };
  if (listOnly) {
    // Read-only observation: no prenuke, no publish, no cleanup (M1-27 Step 3).
    // No Deno.exit here: the finally must release the bench lock and dispose.
    const all = await bc.listHarnessApps(container);
    log("list-only", { apps: all });
  } else {
    const pristine = await exportRefapp(join(outDir, "pristine"));
    ctx.trustedRoots.push(pristine);
    await bc.prenukeCentralGaugeApps([container]);
    await saveLedger(ctx.ledgerRoot, container, {});
    log("prenuke", { after: await listed() });
    await step("a-fresh", pristine, pristine, []);
    const rental = await exportRefapp(join(outDir, "rental-changed"));
    await touchFirstAl(rental, "Rental");
    const b = await step("b-rental-changed", pristine, rental, ["Rental"]);
    const stale = await exportRefapp(join(outDir, "core-stale"));
    await touchFirstAl(stale, "Core");
    await step("c-stale-core", stale, stale, []);
    await bc.syncHarnessApps(container, {
      removeIds: [...b.candidateIds].reverse(),
      publish: [],
      allow: await trustedHarnessAppIds(
        ctx.trustedRoots,
        await loadLedger(ctx.ledgerRoot, container),
      ),
    });
    log("d-cleanup", { after: await listed() });
    await bc.prenukeCentralGaugeApps([container]);
    await step("e-after-bench-prenuke", pristine, pristine, []);
  }
} finally {
  if (!listOnly && !keep) {
    try {
      await bc?.prenukeCentralGaugeApps([container]);
      await saveLedger(resolve("results/harness/bc-ledger"), container, {});
    } catch { /* reported by the next step's listing */ }
  }
  await bc?.dispose();
  await release();
}
