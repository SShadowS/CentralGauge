import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { HarnessInstalledApp } from "../../../src/container/types.ts";
import {
  applySync,
  appStamps,
  BENCH_CANDIDATE_APP_ID,
  candidateFolders,
  invalidate,
  type Ledger,
  planAppSync,
  prereqVersion,
  trustedHarnessAppIds,
  type WantedApp,
} from "../../../src/harness/bc-apps.ts";
import type { StagedApp } from "../../../src/harness/staging.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const id = (n: number) => `c6a1e000-0000-4000-8000-00000000000${n}`;
const app = (folder: string, n: number, depends: string[] = []): StagedApp => ({
  folder,
  id: id(n),
  name: `CGR ${folder}`,
  publisher: "CentralGauge",
  version: "1.0.0.0",
  idRanges: [],
  depends,
  external: [],
});
const APPS = [
  app("Core", 1),
  app("Fleet", 2, ["Core"]),
  app("Integration", 5, ["Core"]),
  app("Leasing", 4, ["Core"]),
  app("Rental", 3, ["Core", "Fleet"]),
  app("Reporting", 6, ["Fleet", "Leasing", "Rental"]),
  app("Test", 7, [
    "Core",
    "Fleet",
    "Integration",
    "Leasing",
    "Rental",
    "Reporting",
  ]),
];
const STAMP = (n: number) => String(n).padStart(64, "a");
const PV = (n: number) => prereqVersion("1.0.0.0", STAMP(n));

function wanted(candidates: string[]): WantedApp[] {
  const byFolder = new Map(APPS.map((a) => [a.folder, a]));
  return APPS.map((a, i) => {
    const role = candidates.includes(a.folder)
      ? "candidate" as const
      : "prereq" as const;
    return {
      id: a.id,
      name: a.name,
      publisher: a.publisher,
      stamp: STAMP(i),
      version: role === "prereq" ? PV(i) : "1.0.0.0",
      file: `${a.folder}.app`,
      role,
      depends: a.depends.map((d) => byFolder.get(d)!.id),
    };
  });
}
const inst = (
  n: number,
  version: string,
  installed = true,
  name = `x${n}`,
): HarnessInstalledApp => ({
  id: id(n),
  name,
  publisher: "CentralGauge",
  version,
  installed,
});
/** Ledger and listing for "these prerequisites are installed and current". */
function current(
  folders: string[],
): { installed: HarnessInstalledApp[]; ledger: Ledger } {
  const w = wanted([]);
  const installed: HarnessInstalledApp[] = [];
  const ledger: Ledger = {};
  for (const f of folders) {
    const x = w.find((y) => y.name === `CGR ${f}`)!;
    installed.push({
      id: x.id,
      name: x.name,
      publisher: "CentralGauge",
      version: x.version,
      installed: true,
    });
    ledger[x.id] = { version: x.version, stamp: x.stamp };
  }
  return { installed, ledger };
}
const OWNED = new Set([BENCH_CANDIDATE_APP_ID]);

Deno.test("candidateFolders: changed apps, their dependents and Test", () => {
  assertEquals(candidateFolders(APPS, []), ["Test"]);
  assertEquals(candidateFolders(APPS, ["Rental"]), [
    "Rental",
    "Reporting",
    "Test",
  ]);
  assertEquals(candidateFolders(APPS, ["Core"]), APPS.map((a) => a.folder));
});

Deno.test("prereqVersion: above the pristine version, deterministic, 16-bit safe", () => {
  const v = prereqVersion("1.2.3.4", "f".repeat(64));
  const [ma, mi, bu, re] = v.split(".").map(Number);
  assertEquals([ma, mi], [1, 2]);
  assert(bu! > 3 && bu! <= 3 + 30000 && re! < 30000);
  assertEquals(v, prereqVersion("1.2.3.4", "f".repeat(64)));
  assertNotEquals(
    prereqVersion("1.0.0.0", "1".repeat(64)),
    prereqVersion("1.0.0.0", "2".repeat(64)),
  );
});

Deno.test("planAppSync: a fresh container removes wanted ids (no-ops) and publishes all in order", () => {
  const plan = planAppSync([], wanted(["Test"]), {}, OWNED);
  assertEquals(plan.remove, [...APPS].reverse().map((a) => a.id));
  assertEquals(
    plan.publish.map((w) => w.file),
    APPS.map((a) => `${a.folder}.app`),
  );
});

Deno.test("planAppSync: refapp dependency apps stay installed", () => {
  const { installed, ledger } = current([
    "Core",
    "Fleet",
    "Integration",
    "Leasing",
  ]);
  installed.push(inst(3, "1.0.0.0"), inst(6, "1.0.0.0"), inst(7, "1.0.0.0"));
  const plan = planAppSync(
    installed,
    wanted(["Rental", "Reporting", "Test"]),
    ledger,
    OWNED,
  );
  assertEquals(plan.remove, [id(7), id(6), id(3)]);
  assertEquals(plan.publish.map((w) => w.file), [
    "Rental.app",
    "Reporting.app",
    "Test.app",
  ]);
});

Deno.test("planAppSync: a ledger stamp mismatch refreshes the prerequisite and its dependents", () => {
  const { installed, ledger } = current([
    "Core",
    "Fleet",
    "Integration",
    "Leasing",
    "Rental",
    "Reporting",
  ]);
  ledger[id(1)] = { version: ledger[id(1)]!.version, stamp: "0".repeat(64) };
  const plan = planAppSync(installed, wanted(["Test"]), ledger, OWNED);
  assertEquals(plan.remove, [id(7), id(6), id(3), id(4), id(5), id(2), id(1)]);
  assertEquals(plan.publish.length, 7);
});

Deno.test("planAppSync: unowned CentralGauge apps are preserved; owned leftovers go", () => {
  const { installed, ledger } = current([
    "Core",
    "Fleet",
    "Integration",
    "Leasing",
    "Rental",
    "Reporting",
  ]);
  installed.push(
    {
      id: BENCH_CANDIDATE_APP_ID,
      name: "CentralGauge_CG-AL-E001_1",
      publisher: "CentralGauge",
      version: "1.0.0.0",
      installed: true,
    },
    {
      id: "00000000-0000-4000-8000-00000000aaaa",
      name: "Someone Else's App",
      publisher: "CentralGauge",
      version: "1.0.0.0",
      installed: true,
    },
    {
      id: "00000000-0000-4000-8000-00000000cccc",
      name: "Continia Core",
      publisher: "Continia",
      version: "1.0.0.0",
      installed: true,
    },
  );
  const plan = planAppSync(installed, wanted(["Test"]), ledger, OWNED);
  assertEquals(plan.remove, [BENCH_CANDIDATE_APP_ID, id(7)]);
});

Deno.test("planAppSync: duplicate or uninstalled versions are not kept", () => {
  const a = current([
    "Core",
    "Fleet",
    "Integration",
    "Leasing",
    "Rental",
    "Reporting",
  ]);
  a.installed.push(inst(1, "1.0.1.1", false));
  assert(
    planAppSync(a.installed, wanted(["Test"]), a.ledger, OWNED).remove.includes(
      id(1),
    ),
  );
  const b = current([
    "Core",
    "Fleet",
    "Integration",
    "Leasing",
    "Rental",
    "Reporting",
  ]);
  b.installed[0] = { ...b.installed[0]!, installed: false };
  assert(
    planAppSync(b.installed, wanted(["Test"]), b.ledger, OWNED).remove.includes(
      id(1),
    ),
  );
});

Deno.test("applySync: removed ids leave the ledger, published ids enter it", () => {
  const w = wanted(["Test"]);
  const plan = planAppSync(
    [],
    w,
    { [id(9)]: { version: "1", stamp: "x" } },
    OWNED,
  );
  const next = applySync({ [id(9)]: { version: "1", stamp: "x" } }, {
    remove: [id(9), ...plan.remove],
    publish: plan.publish,
  }, {
    removed: [id(9)],
    warnings: [],
    removeIncomplete: [],
    published: plan.publish.map((_, index) => ({ index, ms: 1 })),
    failed: null,
    done: true,
    output: "",
  });
  assertEquals(Object.keys(next).length, 7);
  assertEquals(next[id(1)]!.stamp, w[0]!.stamp);
});

Deno.test("appStamps: a dependency change moves dependents, not the other way", async () => {
  const ws = await Deno.realPath(await Deno.makeTempDir());
  await write(
    ws,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  await write(
    ws,
    "Rental/app.json",
    appJson(IDS.rental, "CGR Rental", [70200, 70299], [{
      id: IDS.core,
      name: "CGR Core",
    }]),
  );
  const apps: StagedApp[] = [{ ...app("Core", 1), id: IDS.core }, {
    ...app("Rental", 3, ["Core"]),
    id: IDS.rental,
  }];
  const a = await appStamps(ws, apps, "build-1");
  await write(ws, "Rental/src/R.al", "x");
  const b = await appStamps(ws, apps, "build-1");
  assertEquals(b.get("Core"), a.get("Core"));
  assertNotEquals(b.get("Rental"), a.get("Rental"));
  await write(ws, "Core/src/C.al", "y");
  const c = await appStamps(ws, apps, "build-1");
  assertNotEquals(c.get("Rental"), b.get("Rental"));
});

Deno.test("appStamps: a changed symbols lock or compiler identity moves every stamp", async () => {
  const ws = await Deno.realPath(await Deno.makeTempDir());
  await write(
    ws,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  const apps: StagedApp[] = [{ ...app("Core", 1), id: IDS.core }];
  assertNotEquals(
    (await appStamps(ws, apps, "lock-a|compiler-1")).get("Core"),
    (await appStamps(ws, apps, "lock-b|compiler-1")).get("Core"),
  );
  assertNotEquals(
    (await appStamps(ws, apps, "lock-a|compiler-1")).get("Core"),
    (await appStamps(ws, apps, "lock-a|compiler-2")).get("Core"),
  );
});

Deno.test("invalidate: every id the sync touches leaves the ledger before the mutation", () => {
  const w = wanted(["Test"]);
  const ledger: Ledger = Object.fromEntries(
    w.map((x) => [x.id, { version: x.version, stamp: x.stamp }]),
  );
  const next = invalidate(ledger, [id(7), id(3)]);
  assertEquals(Object.keys(next).length, 5);
  assert(!(id(7) in next) && !(id(3) in next));
  assertEquals(Object.keys(ledger).length, 7, "input unchanged");
});

Deno.test("trustedHarnessAppIds: staged harness manifests and named ledger entries only", async () => {
  const staged = await Deno.realPath(await Deno.makeTempDir());
  await write(
    staged,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  await write(
    staged,
    "Test/app.json",
    appJson(IDS.test, "CGR Test", [80000, 84999], []),
  );
  const prereqId = "a1b2c3d4-0028-0000-0000-000000000028";
  await write(
    staged,
    "Prereq/app.json",
    appJson(prereqId, "CG-AL-H028 Prereq", [69000, 69099], []),
  );
  const foreign = JSON.parse(
    appJson("00000000-0000-4000-8000-00000000cccc", "Continia Core", [
      70000,
      70099,
    ], []),
  );
  foreign.publisher = "Continia";
  await write(staged, "Foreign/app.json", JSON.stringify(foreign));
  const oracle = await Deno.realPath(await Deno.makeTempDir());
  await write(
    oracle,
    "app.json",
    appJson(IDS.oracle, "CGR Oracle HX-001", [85000, 85099], []),
  );
  const ledger: Ledger = {
    [IDS.rental]: { version: "1.0.5.5", stamp: "s", name: "CGR Rental" },
    "00000000-0000-4000-8000-00000000dddd": { version: "1.0.0.0", stamp: "s" },
  };
  const t = await trustedHarnessAppIds([staged, oracle], ledger);
  const matches = (id: string, name: string) =>
    new RegExp(t.get(id) ?? "(?!)").test(name);
  assert(matches(IDS.core, "CGR Core") && !matches(IDS.core, "CGR Core2"));
  assert(
    matches(IDS.test, "CGR Test") && matches(IDS.oracle, "CGR Oracle HX-001"),
  );
  assert(matches(IDS.rental, "CGR Rental"));
  assert(!t.has(prereqId), "a bench prerequisite is never trusted");
  assert(
    !t.has("00000000-0000-4000-8000-00000000cccc"),
    "a foreign publisher is never trusted",
  );
  assert(
    !t.has("00000000-0000-4000-8000-00000000dddd"),
    "a ledger entry without a name is not trusted",
  );
  assert(
    !t.has(BENCH_CANDIDATE_APP_ID),
    "the bench candidate belongs to the bench, never a harness removal",
  );
});

Deno.test("applySync: ledger entries carry the app name", () => {
  const w = wanted(["Test"]);
  const plan = planAppSync([], w, {}, OWNED);
  const next = applySync({}, plan, {
    removed: [],
    warnings: [],
    removeIncomplete: [],
    published: plan.publish.map((_, index) => ({ index, ms: 1 })),
    failed: null,
    done: true,
    output: "",
  });
  assertEquals(next[id(1)]!.name, "CGR Core");
});
