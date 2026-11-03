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

const GUID_OURS = "f5517651-3947-45a1-896c-6e2d88427bde";
const GUID_MIXED = "9c1d0000-3947-45a1-896c-6e2d88427bde";

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
    `Extensions/Cronus281/${GUID_OURS}/CentralGauge_CGR Integration_1.0.0.0.app`,
  );
  await put(bch, `Extensions/Cronus281/${GUID_MIXED}/CentralGauge_A_1.app`);
  // Not ours: kept.
  await put(bch, `Extensions/Cronus281/${GUID_MIXED}/Continia_B_1.app`);
  await put(
    bch,
    "compiler/CentralGauge-Cronus281/symbols/Microsoft_Base Application_28.4.app",
  );
  await put(bch, "compiler/LethAL-bc1/output/x/y.app");
  await put(bch, "compiler-cache-15ff3c5d109b/symbols/lethal-control.app");
  await put(bch, "Extensions/Cronus281/my/1a2b3c4d_Continia_Core_1.0.app");
  await put(bch, "Extensions/Cronus281/my/Microsoft_License.bclicense");
  // Sol r1 #4: a container name does not make a foreign app ours.
  await put(bch, "Extensions/TestContainer/my/12345678_Continia_Core.app");
  await put(bch, "Extensions/bc1/my/0af543cf_CentralGauge_X_1.app");
  return { bch, coord, bench };
}

const rel = (root: string, p: string) =>
  p.slice(root.length + 1).replaceAll("\\", "/");
const OURS_281 = [
  `Extensions/Cronus281/${GUID_MIXED}/CentralGauge_A_1.app`,
  `Extensions/Cronus281/${GUID_OURS}/CentralGauge_CGR Integration_1.0.0.0.app`,
  "Extensions/Cronus281/my/ba4ed73e_CentralGauge_CGR Test_1.0.0.0.app",
  "compiler/CentralGauge-Cronus281/output/CGR_Test_1a2b3c4d/CentralGauge_CGR Test_1.0.0.0.app",
  "compiler/CentralGauge-Cronus281/output/T_9f8e7d6c/x.app",
];
const exists = async (p: string) => !!(await Deno.stat(p).catch(() => null));
const lease = (w: { coord: string }, c: string, n: string, token: string) =>
  put(
    w.coord,
    `leases/${c}/${n}/lease.json`,
    JSON.stringify({ lane: "lane-ops", token, at: "x" }),
  );

Deno.test("H-55 sweep: lists only CentralGauge-owned files, by file, never foreign apps or other products' folders", async () => {
  const w = await world();
  const plan = await planSweep({
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    containers: ["Cronus281", "TestContainer"],
  });
  assertEquals(plan.refused, null);
  assertEquals(plan.items.map((i) => rel(w.bch, i.path)).sort(), OURS_281);
  // Listing removes nothing.
  assert(await exists(join(w.bch, OURS_281[4]!)));
});

Deno.test("H-55 sweep: listing skips a container under someone's live lease, and every container when the lease state is unreadable", async () => {
  const w = await world();
  await lease(w, "Cronus281", "031", "theirs");
  const opts = {
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    containers: ["Cronus281"],
  };
  const plan = await planSweep(opts);
  assertEquals(plan.items, []);
  assert(plan.skipped.some((s) => s.container === "Cronus281"));
  await put(w.coord, "leases/Cronus281/031/release.json", "{}");
  assertEquals((await planSweep(opts)).items.length, OURS_281.length);
  await Deno.remove(join(w.coord, "coord.json"));
  assertEquals((await planSweep(opts)).items, []);
});

Deno.test("H-55 sweep: a fresh bench marker refuses the plan, and apply cannot take the bench lock", async () => {
  const w = await world();
  await lease(w, "Cronus281", "031", "mine");
  const leases = new Map([["Cronus281", "mine"]]);
  const plan = await planSweep({
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    containers: ["Cronus281"],
    coordLeases: leases,
  });
  await Deno.writeTextFile(
    join(w.bench, ".bench-running.json"),
    JSON.stringify({ pid: 1, token: "b" }),
  );
  assert(
    (await planSweep({
      bchRoot: w.bch,
      coordRoot: w.coord,
      benchDirs: [w.bench],
      containers: ["Cronus281"],
    })).refused,
  );
  await assertRejects(() =>
    applySweep(plan.items, {
      coordRoot: w.coord,
      benchDirs: [w.bench],
      coordLeases: leases,
    })
  );
  assert(await exists(join(w.bch, OURS_281[4]!)));
});

Deno.test("H-55 sweep apply: only containers whose lease this caller holds; files one by one; emptied dirs only; foreign files and their dirs stay", async () => {
  const w = await world();
  // Free (unleased) container: listed, but apply needs the caller's lease.
  const free = await planSweep({
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    containers: ["Cronus281"],
  });
  const opts = {
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    coordLeases: new Map([["Cronus281", "mine"]]),
  };
  const none = await applySweep(free.items, opts);
  assertEquals(none.removed, []);
  await lease(w, "Cronus281", "031", "mine");
  // Sol r1 #3: a foreign app lands in our staging dir after the plan.
  await put(w.bch, `Extensions/Cronus281/${GUID_OURS}/Continia_Late_1.app`);
  const done = await applySweep(free.items, opts);
  assertEquals(done.removed.length, OURS_281.length);
  for (const p of OURS_281) assert(!(await exists(join(w.bch, p))), p);
  for (
    const p of [
      `Extensions/Cronus281/${GUID_OURS}/Continia_Late_1.app`,
      `Extensions/Cronus281/${GUID_MIXED}/Continia_B_1.app`,
      "Extensions/Cronus281/my/1a2b3c4d_Continia_Core_1.0.app",
      "Extensions/Cronus281/my/Microsoft_License.bclicense",
      "compiler/CentralGauge-Cronus281/symbols/Microsoft_Base Application_28.4.app",
      "Extensions/TestContainer/my/12345678_Continia_Core.app",
    ]
  ) assert(await exists(join(w.bch, p)), p);
  // Emptied output dirs go; the output folder itself stays.
  assert(
    !(await exists(
      join(w.bch, "compiler/CentralGauge-Cronus281/output/T_9f8e7d6c"),
    )),
  );
  assert(await exists(join(w.bch, "compiler/CentralGauge-Cronus281/output")));
  // The bench lock was taken and released.
  assert(!(await exists(join(w.bench, ".bench-running.json"))));
});

Deno.test("H-55 sweep apply: a lease another lane takes after the plan keeps its files", async () => {
  const w = await world();
  await lease(w, "Cronus281", "031", "mine");
  const opts = {
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    coordLeases: new Map([["Cronus281", "mine"]]),
  };
  const plan = await planSweep({ ...opts, containers: ["Cronus281"] });
  assertEquals(plan.items.length, OURS_281.length);
  await put(w.coord, "leases/Cronus281/031/release.json", "{}");
  await lease(w, "Cronus281", "032", "theirs");
  const done = await applySweep(plan.items, opts);
  assertEquals(done.removed, []);
  for (const p of OURS_281) assert(await exists(join(w.bch, p)), p);
});

Deno.test("H-55 sweep apply (Sol r2 #2): a bench that reclaims the lock mid-apply stops every further deletion", async () => {
  const w = await world();
  await lease(w, "Cronus281", "031", "mine");
  const opts = {
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    coordLeases: new Map([["Cronus281", "mine"]]),
  };
  const plan = await planSweep({ ...opts, containers: ["Cronus281"] });
  const marker = join(w.bench, ".bench-running.json");
  // The marker changes hands while apply walks its list.
  const items = Object.assign([...plan.items], {
    *[Symbol.iterator]() {
      Deno.writeTextFileSync(
        marker,
        JSON.stringify({ pid: 2, token: "a-bench", command: "bench" }),
      );
      yield* plan.items;
    },
  });
  await assertRejects(() => applySweep(items, opts), Error, "lock lost");
  for (const p of OURS_281) assert(await exists(join(w.bch, p)), p);
  // The bench's marker is not ours to release.
  assert(await exists(marker));
});

Deno.test("H-55 server check (Sol r2 #3): a junction-backed BCH root is matched against the mount's canonical source", async () => {
  const w = await world();
  const via = join(await testTempDir(), "BcContainerHelper");
  try {
    await Deno.symlink(w.bch, via, { type: "junction" });
  } catch (err) {
    console.warn(`[SKIP] no junction here: ${err}`);
    return;
  }
  const shown = await visibleArtifacts(
    [{ Source: await Deno.realPath(via), Destination: "c:\\x" }],
    via,
  );
  assertEquals(shown.length, OURS_281.length + 1);
});

Deno.test("H-55 sweep (Sol r1 #1): a link anywhere on the way, an ancestor included, is never followed", async () => {
  const w = await world();
  const outside = await testTempDir();
  await put(outside, "inner/foreign.app");
  const out = join(w.bch, "compiler", "CentralGauge-Cronus282", "output");
  await Deno.mkdir(join(out, ".."), { recursive: true });
  try {
    await Deno.symlink(outside, out, { type: "junction" });
    await Deno.symlink(
      outside,
      join(w.bch, "compiler/CentralGauge-Cronus281/output/link_00000000"),
      { type: "junction" },
    );
  } catch (err) {
    console.warn(`[SKIP] no junction here: ${err}`);
    return;
  }
  await lease(w, "Cronus282", "001", "mine");
  const opts = {
    bchRoot: w.bch,
    coordRoot: w.coord,
    benchDirs: [w.bench],
    coordLeases: new Map([["Cronus282", "mine"]]),
  };
  const plan = await planSweep({
    ...opts,
    containers: ["Cronus281", "Cronus282"],
  });
  assert(!plan.items.some((i) => i.path.includes("link_00000000")));
  assert(!plan.items.some((i) => i.container === "Cronus282"));
  // Even a hand-made item through the linked ancestor is refused.
  const done = await applySweep([{
    path: join(out, "inner", "foreign.app"),
    container: "Cronus282",
    kind: "compiler-output",
    root: w.bch,
  }], opts);
  assertEquals(done.removed, []);
  assert(await exists(join(outside, "inner", "foreign.app")));
});

Deno.test("H-55 server check: judge artifacts visible through a container's mounts are their own finding, by file, also inside a mixed staging dir", async () => {
  const w = await world();
  const all = await visibleArtifacts(
    [{ Source: w.bch, Destination: "c:\\programdata\\bccontainerhelper" }],
    w.bch,
  );
  assertEquals(
    all.map((i) => rel(w.bch, i.path)).sort(),
    [...OURS_281, "Extensions/bc1/my/0af543cf_CentralGauge_X_1.app"].sort(),
  );
  const own = await visibleArtifacts(
    [{
      Source: join(w.bch, "Extensions", "Cronus281", "my"),
      Destination: "c:\\run\\my",
    }],
    w.bch,
  );
  assertEquals(own.map((i) => rel(w.bch, i.path)), [
    "Extensions/Cronus281/my/ba4ed73e_CentralGauge_CGR Test_1.0.0.0.app",
  ]);
  assertEquals(
    await visibleArtifacts(
      [{ Source: await testTempDir(), Destination: "c:\\dl" }],
      w.bch,
    ),
    [],
  );
});
