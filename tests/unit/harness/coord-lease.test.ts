import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import {
  coordLeaseBlock,
  drainBlock,
  laneBlocked,
} from "../../../src/harness/coord-lease.ts";
import { FakeBc } from "./fake-bc.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const tmp = async () => await Deno.realPath(await testTempDir());

/** A coord root as coord.ts lays it out: coord.json plus leases/ (under machineRoot when set). */
async function coord(o: { machineRoot?: string } = {}) {
  const root = await tmp();
  await Deno.writeTextFile(
    join(root, "coord.json"),
    JSON.stringify({
      protocol: 1,
      campaign: "h41",
      ...(o.machineRoot ? { machineRoot: o.machineRoot } : {}),
      createdAt: new Date().toISOString(),
    }),
  );
  await Deno.mkdir(join(o.machineRoot ?? root, "leases"), { recursive: true });
  return root;
}

/** leases/<c>/<attempt>/lease.json (and release.json when released). */
async function lease(
  machine: string,
  c: string,
  attempt: string,
  rec: { lane: string; token: string } | string,
  released = false,
) {
  const dir = join(machine, "leases", c, attempt);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "lease.json"),
    typeof rec === "string" ? rec : JSON.stringify({ ...rec, at: 1 }),
  );
  if (released) {
    await Deno.writeTextFile(
      join(dir, "release.json"),
      JSON.stringify({ at: 2 }),
    );
  }
}

const none = new Map<string, string>();

Deno.test("H-41 F8: a coord lease held by another lane, or by the same lane under another token, is refused; only the exact container=token pair is this run's", async () => {
  const root = await coord();
  await lease(root, "Cronus284", "001", { lane: "lane-ops", token: "t-ops" });
  await lease(root, "Cronus281", "001", { lane: "lane-infra", token: "t-old" });
  await lease(root, "Cronus282", "001", { lane: "lane-infra", token: "t-run" });
  const own = new Map([["Cronus281", "t-run"], ["Cronus282", "t-run"]]);
  assertStringIncludes(
    coordLeaseBlock(root, own, "Cronus284")!,
    "lane-ops",
  );
  assertStringIncludes(
    coordLeaseBlock(root, own, "Cronus281")!,
    "lane-infra",
    "a matching lane alone never authorizes",
  );
  assertEquals(coordLeaseBlock(root, own, "Cronus282"), null);
  // the token is per container: t-run for Cronus282 does not cover Cronus284
  assert(
    coordLeaseBlock(root, new Map([["Cronus282", "t-ops"]]), "Cronus284"),
  );
});

Deno.test("H-41 F8: the last NNN attempt decides; release.json frees it; a missing per-container dir is free; other names are ignored", async () => {
  const root = await coord();
  assertEquals(coordLeaseBlock(root, none, "Cronus281"), null, "no dir: free");
  await lease(root, "Cronus281", "001", { lane: "x", token: "a" });
  await lease(root, "Cronus281", "002", { lane: "x", token: "b" }, true);
  await Deno.mkdir(join(root, "leases", "Cronus281", "0003"));
  await Deno.mkdir(join(root, "leases", "Cronus281", "tmp"));
  assertEquals(coordLeaseBlock(root, none, "Cronus281"), null, "002 released");
  await lease(root, "Cronus281", "003", { lane: "x", token: "c" });
  assert(coordLeaseBlock(root, none, "Cronus281"), "003 held");
  await Deno.mkdir(join(root, "leases", "Cronus282"));
  assertEquals(coordLeaseBlock(root, none, "Cronus282"), null, "no attempt");
});

Deno.test("H-41 F8: an unreadable lease.json (missing or corrupt), even with release.json, is refused", async () => {
  const root = await coord();
  await lease(root, "Cronus281", "001", "{not json", true);
  assertStringIncludes(
    coordLeaseBlock(root, none, "Cronus281")!,
    "unreadable",
  );
  await Deno.mkdir(join(root, "leases", "Cronus282", "001"), {
    recursive: true,
  });
  assertStringIncludes(
    coordLeaseBlock(root, none, "Cronus282")!,
    "unreadable",
  );
});

Deno.test("H-41 F8: a missing leases root, a missing or unparseable coord.json, or a bad container name fail closed", async () => {
  const root = await coord();
  await Deno.remove(join(root, "leases"));
  assertStringIncludes(coordLeaseBlock(root, none, "Cronus281")!, "leases");
  const bare = await tmp();
  await Deno.mkdir(join(bare, "leases"));
  assertStringIncludes(coordLeaseBlock(bare, none, "Cronus281")!, "coord.json");
  await Deno.writeTextFile(join(bare, "coord.json"), "{");
  assertStringIncludes(coordLeaseBlock(bare, none, "Cronus281")!, "coord.json");
  const ok = await coord();
  assert(coordLeaseBlock(ok, none, "../Cronus281"));
});

Deno.test("H-41 F8: the leases live under coord.json's machineRoot, not the coord root", async () => {
  const machine = await tmp();
  const root = await coord({ machineRoot: machine });
  await Deno.mkdir(join(root, "leases", "Cronus281", "001"), {
    recursive: true,
  }); // ignored: not the machine root
  assertEquals(coordLeaseBlock(root, none, "Cronus281"), null);
  await lease(machine, "Cronus281", "001", { lane: "lane-ops", token: "t" });
  assert(coordLeaseBlock(root, none, "Cronus281"));
});

Deno.test("H-41 (6): drainBlock: <resultsDir>/drain-<container>, case-insensitive; no marker or no results dir is not blocked", async () => {
  const results = await tmp();
  assertEquals(drainBlock(results, "Cronus281"), null);
  assertEquals(drainBlock(join(results, "missing"), "Cronus281"), null);
  await Deno.writeTextFile(join(results, "Drain-CRONUS281"), "");
  assertStringIncludes(drainBlock(results, "cronus281")!, "drain");
  assertEquals(drainBlock(results, "Cronus282"), null);
});

Deno.test("H-41 F8: a fixed lane ignores drain markers but refuses a foreign coord lease; a pooled lane refuses both", async () => {
  const root = await coord();
  const results = await tmp();
  await Deno.writeTextFile(join(results, "drain-C1"), "");
  const ctx = { taskId: "t", variantId: "v", attemptNumber: 1 };
  const route = async (lane: BcLane) =>
    (await lane.exclusive(ctx, (c) => Promise.resolve(c))).result;
  const fixed = new BcLane(new FakeBc(), ["C1", "C2"], {
    blocked: laneBlocked({ coordRoot: root, own: none }),
  });
  assertEquals(await route(fixed), "C1", "the drain marker is ignored");
  const pooled = new BcLane(new FakeBc(), ["C1", "C2"], {
    pool: { reconcile: () => Promise.resolve({}) },
    blocked: laneBlocked({ coordRoot: root, own: none, drainDir: results }),
  });
  assertEquals(await route(pooled), "C2", "drained");
  await lease(root, "C1", "001", { lane: "lane-ops", token: "t" });
  await Deno.remove(join(results, "drain-C1"));
  for (let k = 0; k < 2; k++) {
    assertEquals(await route(fixed), "C2", "a foreign coord lease");
    assertEquals(await route(pooled), "C2", "a foreign coord lease");
  }
});
