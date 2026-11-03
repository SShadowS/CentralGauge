import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { testTempDir } from "../../utils/temp-dir.ts";
import {
  applySweep,
  planSweep,
  visibleArtifacts,
} from "../../../scripts/harness/sweep-shared.ts";

async function put(root: string, rel: string, text = "x") {
  const p = join(root, ...rel.split("/"));
  await Deno.mkdir(join(p, ".."), { recursive: true });
  await Deno.writeTextFile(p, text);
  return p;
}

/** A BCH root, a coord root with an empty leases dir, a bench dir. */
async function world() {
  const bch = await testTempDir();
  const coord = await testTempDir();
  await Deno.writeTextFile(join(coord, "coord.json"), "{}");
  await Deno.mkdir(join(coord, "leases"));
  const bench = await testTempDir();
  // Ours.
  await put(
    bch,
    "compiler/CentralGauge-Cronus281/output/CGR_Test_1a2b3c4d/CentralGauge_CGR Test_1.0.0.0.app",
  );
  await put(bch, "compiler/CentralGauge-Cronus281/output/T_9f8e7d6c/x.app");
  await put(
    bch,
    "Extensions/Cronus281/my/ba4ed73e_CentralGauge_CGR Test_1.0.0.0.app",
  );
  await put(
    bch,
    "Extensions/Cronus281/f5517651-3947-45a1-896c-6e2d88427bde/CentralGauge_CGR Integration_1.0.0.0.app",
  );
  await put(bch, "Extensions/TestContainer/my/0af543cf_TestApp.app");
  // Not ours: kept.
  await put(
    bch,
    "compiler/CentralGauge-Cronus281/symbols/Microsoft_Base Application_28.4.app",
  );
  await put(bch, "compiler/LethAL-bc1/output/x/y.app");
  await put(bch, "compiler-cache-15ff3c5d109b/symbols/lethal-control.app");
  await put(bch, "Extensions/Cronus281/my/1a2b3c4d_Continia_Core_1.0.app");
  await put(bch, "Extensions/Cronus281/my/Microsoft_License.bclicense");
  await put(
    bch,
    "Extensions/Cronus281/9c1d0000-3947-45a1-896c-6e2d88427bde/CentralGauge_A_1.app",
  );
  await put(
    bch,
    "Extensions/Cronus281/9c1d0000-3947-45a1-896c-6e2d88427bde/Continia_B_1.app",
  );
  await put(bch, "Extensions/bc1/my/0af543cf_CentralGauge_X_1.app");
  return { bch, coord, bench };
}

const rel = (root: string, p: string) =>
  p.slice(root.length + 1).replaceAll("\\", "/");

Deno.test("H-55 sweep: lists only CentralGauge-owned outputs and staged apps, never foreign apps or other products' folders", async () => {
  const w = await world();
  const plan = await planSweep({
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    containers: ["Cronus281", "TestContainer"],
  });
  assertEquals(plan.refused, null);
  assertEquals(plan.items.map((i) => rel(w.bch, i.path)).sort(), [
    "Extensions/Cronus281/f5517651-3947-45a1-896c-6e2d88427bde",
    "Extensions/Cronus281/my/ba4ed73e_CentralGauge_CGR Test_1.0.0.0.app",
    "Extensions/TestContainer/my/0af543cf_TestApp.app",
    "compiler/CentralGauge-Cronus281/output/CGR_Test_1a2b3c4d",
    "compiler/CentralGauge-Cronus281/output/T_9f8e7d6c",
  ]);
  // Listing removes nothing.
  assert(
    await Deno.stat(
      join(w.bch, "compiler/CentralGauge-Cronus281/output/T_9f8e7d6c"),
    ),
  );
});

Deno.test("H-55 sweep: a container under a live coord lease is skipped; an unreadable lease skips it too", async () => {
  const w = await world();
  await put(
    w.coord,
    "leases/Cronus281/031/lease.json",
    JSON.stringify({ lane: "lane-ops", token: "t", at: "x" }),
  );
  const plan = await planSweep({
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    containers: ["Cronus281", "TestContainer"],
  });
  assertEquals(
    plan.items.map((i) => i.container),
    ["TestContainer"],
  );
  assert(plan.skipped.some((s) => s.container === "Cronus281"));
  // Released: swept again.
  await put(w.coord, "leases/Cronus281/031/release.json", "{}");
  const again = await planSweep({
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    containers: ["Cronus281"],
  });
  assertEquals(again.items.length, 4);
  // No coord.json: every container is skipped (fail closed).
  await Deno.remove(join(w.coord, "coord.json"));
  const blind = await planSweep({
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    containers: ["Cronus281"],
  });
  assertEquals(blind.items, []);
});

Deno.test("H-55 sweep: a fresh bench marker refuses the whole sweep; apply refuses too", async () => {
  const w = await world();
  await Deno.writeTextFile(join(w.bench, ".bench-running.json"), "{}");
  const plan = await planSweep({
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    containers: ["Cronus281"],
  });
  assert(plan.refused);
  assertEquals(plan.items, []);
  await assertRejects(() =>
    applySweep(
      [{
        path: join(w.bch, "compiler/CentralGauge-Cronus281/output/T_9f8e7d6c"),
        container: "Cronus281",
        kind: "compiler-output",
      }],
      { benchDirs: [w.bench], coordRoot: w.coord },
    )
  );
});

Deno.test("H-55 sweep: apply removes exactly the listed items and re-checks the lease per item", async () => {
  const w = await world();
  const opts = {
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    containers: ["Cronus281", "TestContainer"],
  };
  const plan = await planSweep(opts);
  // A lease taken between plan and apply keeps Cronus281's items.
  await put(
    w.coord,
    "leases/Cronus281/032/lease.json",
    JSON.stringify({ lane: "lane-ops", token: "t", at: "x" }),
  );
  const done = await applySweep(plan.items, opts);
  assertEquals(done.removed.map((i) => i.container), ["TestContainer"]);
  assertEquals(done.skipped.length, 4);
  assertEquals(
    await Deno.stat(
      join(w.bch, "Extensions/TestContainer/my/0af543cf_TestApp.app"),
    )
      .catch(() => null),
    null,
  );
  assert(
    await Deno.stat(
      join(w.bch, "compiler/CentralGauge-Cronus281/output/T_9f8e7d6c"),
    ),
  );
  // Foreign files are untouched.
  assert(
    await Deno.stat(
      join(w.bch, "Extensions/Cronus281/my/1a2b3c4d_Continia_Core_1.0.app"),
    ),
  );
});

Deno.test("H-55 sweep: a link is never followed or removed", async () => {
  const w = await world();
  const target = await testTempDir();
  await put(target, "keep.app");
  try {
    await Deno.symlink(
      target,
      join(w.bch, "compiler/CentralGauge-Cronus281/output/link_00000000"),
      { type: "junction" },
    );
  } catch (err) {
    console.warn(`[SKIP] no junction here: ${err}`);
    return;
  }
  const plan = await planSweep({
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    containers: ["Cronus281"],
  });
  assert(!plan.items.some((i) => i.path.includes("link_00000000")));
  assert(await Deno.stat(join(target, "keep.app")));
});

Deno.test("H-55 server check: judge artifacts visible through a container's mounts are their own finding; the BCH-root mount shows every container's, the own my folder only its own", async () => {
  const w = await world();
  const all = await visibleArtifacts(
    [{ Source: w.bch, Destination: "c:\programdata\bccontainerhelper" }],
    w.bch,
  );
  assertEquals(
    all.map((i) => rel(w.bch, i.path)).sort(),
    [
      "Extensions/Cronus281/f5517651-3947-45a1-896c-6e2d88427bde",
      "Extensions/Cronus281/my/ba4ed73e_CentralGauge_CGR Test_1.0.0.0.app",
      "Extensions/TestContainer/my/0af543cf_TestApp.app",
      "Extensions/bc1/my/0af543cf_CentralGauge_X_1.app",
      "compiler/CentralGauge-Cronus281/output/CGR_Test_1a2b3c4d",
      "compiler/CentralGauge-Cronus281/output/T_9f8e7d6c",
    ],
  );
  const own = await visibleArtifacts(
    [{
      Source: join(w.bch, "Extensions", "Cronus281", "my"),
      Destination: "c:\run\my",
    }],
    w.bch,
  );
  assertEquals(own.map((i) => rel(w.bch, i.path)), [
    "Extensions/Cronus281/my/ba4ed73e_CentralGauge_CGR Test_1.0.0.0.app",
  ]);
  assertEquals(
    await visibleArtifacts(
      [{ Source: await testTempDir(), Destination: "c:\dl" }],
      w.bch,
    ),
    [],
  );
});
