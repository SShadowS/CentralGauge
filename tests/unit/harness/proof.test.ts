import { assert, assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { BcLane, type LockedSymbols } from "../../../src/harness/bc-lane.ts";
import { hashFile } from "../../../src/harness/hash.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import type { ResetMechanism } from "../../../src/harness/reset.ts";
import {
  HTTP_BLOCKED_TEXT,
  PROOF_CONTROLS,
  PROOF_POLICY,
  type ProofControl,
  proofRoot,
  runControl,
  writeProofRecord,
} from "../../../scripts/harness/proof/lib.ts";
import { FakeBc, OK_RESET, result, type TestScript } from "./fake-bc.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const REPO = fromFileUrl(new URL("../../../", import.meta.url));
const tmp = async () => await Deno.realPath(await testTempDir());

async function lock(): Promise<LockedSymbols> {
  const store = await tmp();
  await Deno.writeTextFile(join(store, "s.app"), "assert-symbols");
  const sha256 = await hashFile(store, join(store, "s.app"));
  await Deno.rename(join(store, "s.app"), join(store, `${sha256}.app`));
  return {
    store,
    packages: [{
      app_id: IDS.assert,
      name: "Library Assert",
      publisher: "Microsoft",
      version: "28.0.0.0",
      file: "Microsoft_Library Assert_28.0.0.0.app",
      sha256,
    }],
  };
}

/** A fixture step: one production app plus a Test app (codeunit `cu`). */
async function stepWs(dir: string, cu: number) {
  await write(
    dir,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  await write(dir, "Core/src/C.al", `codeunit 70000 "CGR Core"\n{\n}\n`);
  await write(
    dir,
    "Test/app.json",
    appJson(IDS.test, "CGR Test", [80000, 84999], [
      { id: IDS.core, name: "CGR Core" },
      { id: IDS.assert, name: "Library Assert" },
    ]),
  );
  await write(
    dir,
    "Test/src/T.al",
    `codeunit ${cu} "T"\n{\n    Subtype = Test;\n}\n`,
  );
}

/** A repo root holding one fixture for `c`: write (80010) and read (80020) steps. */
async function repoWith(c: ProofControl, read = true): Promise<string> {
  const repo = await tmp();
  const dir = join(repo, c.dir);
  await stepWs(join(dir, "write"), 80010);
  if (read) await stepWs(join(dir, "read"), 80020);
  await write(
    dir,
    "proof.json",
    JSON.stringify({
      write: {
        tests: [{ codeunit: 80010, procedures: ["Seed"], target: "candidate" }],
      },
      ...(read
        ? {
          read: {
            tests: [{
              codeunit: 80020,
              procedures: ["Gone"],
              target: "candidate",
            }],
          },
        }
        : {}),
    }),
  );
  return repo;
}

/** OK_RESET plus an fsDigest: capture n on a container is `caps(n)`. */
function digesting(caps: (n: number) => string[]): ResetMechanism {
  let n = 0;
  return {
    ...OK_RESET,
    fsDigest: () => {
      const lines = caps(n++);
      return Promise.resolve([...lines, `T|${lines.length}`]);
    },
  };
}
const F = (p: string, h: string) => `F|${h.repeat(64)}|4|32|1|6161|${p}`;

async function env(script: TestScript, reset: ResetMechanism = OK_RESET) {
  const bc = new FakeBc(script);
  const lane = new BcLane(bc, ["C1", "C2"]);
  return { bc, lane, lock: await lock(), ledgerRoot: await tmp(), reset };
}

const control = (name: string) => PROOF_CONTROLS.find((c) => c.name === name)!;

Deno.test("H-35c: the controls match design-r5 2.5 (hostile, proof-only column) and 6.5 (seeded state)", () => {
  assertEquals(
    PROOF_CONTROLS.map((c) => [c.name, c.kind, c.layer, c.expect]),
    [
      ["file-packageid", "hostile", "L4", "detected"],
      ["http-exfil", "hostile", "L2", "blocked"],
      ["server-path", "hostile", "L4", "detected"],
      ["background-task", "hostile", "reset", "cleared"],
      ["seed-isolated-storage", "seeded", "reset", "cleared"],
      ["seed-job-queue", "seeded", "reset", "cleared"],
      ["seed-scheduled-task", "seeded", "reset", "cleared"],
      ["seed-global-app", "seeded", "reset", "cleared"],
      ["seed-server-file", "seeded", "L4", "detected"],
    ],
  );
  assertEquals(PROOF_POLICY.target, "OnPrem");
});

Deno.test("H-35c: a hostile fixture that is not written reports fixture_missing (owner route) and never passes", async () => {
  const e = await env(() => result({}));
  for (const c of PROOF_CONTROLS.filter((c) => c.kind === "hostile")) {
    const o = await runControl(e, c, await tmp(), await tmp());
    assertEquals([o.observed, o.pass], ["fixture_missing", false]);
    assert(o.detail.includes("owner"));
  }
  assertEquals(e.bc.syncs.length, 0, "nothing deployed");
});

Deno.test("H-35c: L4 control: an OnPrem write that leaves a server file is detected, its container quarantined, no read and no reroute", async () => {
  const c = control("seed-server-file");
  const targets: (string | undefined)[] = [];
  const e = await env(
    (_cu, deployed) => {
      for (const a of deployed.values()) targets.push(a.target);
      return result({ Seed: true });
    },
    digesting((n) =>
      n === 0
        ? [F("C:/W/a.txt", "a")]
        : [F("C:/W/a.txt", "a"), F("C:/W/cg.txt", "b")]
    ),
  );
  const o = await runControl(e, c, await repoWith(c, false), await tmp());
  assertEquals([o.observed, o.pass], ["detected", true]);
  assertEquals(o.fs_diff, ["C:/W/cg.txt"]);
  assert(o.container && e.lane.quarantined.has(o.container));
  assertEquals(e.lane.quarantined.size, 1, "no reroute to the other container");
  // The proof build compiled every fixture app OnPrem (ban and Cloud off).
  assertEquals(targets, ["OnPrem", "OnPrem"]);
});

Deno.test("H-35c: L4 control: an unobservable capture (errors, no diff) is infra, never detected; a diff that misses the fixture's `detect` path is not_detected", async () => {
  const c = control("seed-server-file");
  // The capture right after the reset fails: deployAndTest throws HostDirtyError with errors only.
  const blind = await env(
    () => result({ Seed: true }),
    {
      ...OK_RESET,
      fsDigest: () => Promise.reject(new Error("walk failed")),
    },
  );
  const o = await runControl(blind, c, await repoWith(c, false), await tmp());
  assertEquals([o.observed, o.pass], ["infra", false], o.detail);
  // A difference elsewhere is not the fixture's file.
  const repo = await repoWith(c, false);
  const spec = join(repo, c.dir, "proof.json");
  const s = JSON.parse(await Deno.readTextFile(spec));
  s.write.detect = String.raw`[\\/]cg-proof-seed\.txt$`;
  await Deno.writeTextFile(spec, JSON.stringify(s));
  const other = await env(
    () => result({ Seed: true }),
    digesting((n) => n === 0 ? [F("C:/W/a.txt", "a")] : [F("C:/W/a.txt", "b")]),
  );
  const p = await runControl(other, c, repo, await tmp());
  assertEquals([p.observed, p.pass], ["not_detected", false], p.detail);
  const hit = await env(
    () => result({ Seed: true }),
    digesting((n) =>
      n === 0
        ? [F("C:/W/a.txt", "a")]
        : [F("C:/W/a.txt", "a"), F("C:/W/T/cg-proof-seed.txt", "b")]
    ),
  );
  const q = await runControl(hit, c, repo, await tmp());
  assertEquals([q.observed, q.pass], ["detected", true], q.detail);
});

Deno.test("H-35c: L4 control: a clean write is not_detected and fails the control", async () => {
  const c = control("seed-server-file");
  const e = await env(
    () => result({ Seed: true }),
    digesting(() => [F("C:/W/a.txt", "a")]),
  );
  const o = await runControl(e, c, await repoWith(c, false), await tmp());
  assertEquals([o.observed, o.pass], ["not_detected", false], o.detail);
  assertEquals(e.lane.quarantined.size, 0);
});

Deno.test("H-35c: L2 control: the NST's blocked-request text in the write's messages is blocked; without it, not_blocked", async () => {
  const c: ProofControl = { ...control("http-exfil"), dir: "fx/http" };
  const blocked = await env(() =>
    result({ Seed: `Error: ${HTTP_BLOCKED_TEXT}.` })
  );
  const o = await runControl(blocked, c, await repoWith(c, false), await tmp());
  assertEquals([o.observed, o.pass], ["blocked", true]);
  const open = await env(() => result({ Seed: "Assert failed" }));
  const p = await runControl(open, c, await repoWith(c, false), await tmp());
  assertEquals([p.observed, p.pass], ["not_blocked", false]);
});

Deno.test("H-35c (design-r5 6.5): reset control: the write seeds; a read after the ordinary cleanup alone still finds it; a read after the reset, on the same container, finds nothing (cleared) or something (leaked)", async () => {
  const c = control("seed-job-queue");
  const routed: string[] = [];
  const events: string[] = [];
  /** `reads`: the Gone outcome of the read without, then with, the reset. */
  const run = async (
    reads: [true | string, true | string],
    seed: true | string = true,
  ) => {
    let read = 0;
    const reset: ResetMechanism = {
      ...OK_RESET,
      reset: (container) => {
        events.push("reset");
        return OK_RESET.reset(container);
      },
    };
    const e = await env((cu, _d, container) => {
      routed.push(container);
      events.push(`${cu}`);
      return cu === 80010
        ? result({ Seed: seed })
        : result({ Gone: reads[read++]! });
    }, reset);
    return await runControl(e, c, await repoWith(c), await tmp());
  };
  // The read's own assertion (Assert.IsFalse) failing: the state is there.
  const STILL = "Assert.IsFalse failed. job queue entry still there";
  const ok = await run([STILL, true]);
  assertEquals([ok.observed, ok.pass], ["cleared", true], ok.detail);
  // write after a reset; the contrast read with no reset; the read after one
  assertEquals(events.splice(0), ["reset", "80010", "80020", "reset", "80020"]);
  assertEquals(
    new Set(routed.splice(0)).size,
    1,
    "every step on one container",
  );
  // Gone already after the ordinary cleanup: the seed proves nothing.
  const weak = await run([true, true]);
  assertEquals([weak.observed, weak.pass], ["not_persisted", false]);
  const leak = await run([STILL, STILL]);
  assertEquals([leak.observed, leak.pass], ["leaked", false]);
  const infra = await run([STILL, true], "could not seed");
  assertEquals([infra.observed, infra.pass], ["infra", false]);
  // Sol r1 #4: a contrast read that crashed (not its assertion) proves no
  // persistence, so a clean read after the reset proves nothing either.
  const crash = await run(["Object reference not set", true]);
  assertEquals([crash.observed, crash.pass], ["infra", false], crash.detail);
  // A leak must be the assertion too; a crash after the reset is infra.
  const crash2 = await run([STILL, "Object reference not set"]);
  assertEquals([crash2.observed, crash2.pass], ["infra", false]);
});

Deno.test("H-35c (design-r5 6.5 global app): a write step's `leave` ids stay published past its cleanup; the rest is removed", async () => {
  const c = control("seed-global-app");
  const repo = await repoWith(c);
  const spec = join(repo, c.dir, "proof.json");
  const s = JSON.parse(await Deno.readTextFile(spec));
  s.write.leave = [IDS.core];
  await Deno.writeTextFile(spec, JSON.stringify(s));
  // Sol r1 #5: the production inventory check would call the left app dirt
  // and quarantine before the reads; the write that leaves apps skips it.
  const verified: number[] = [];
  const e = await env(
    (cu) =>
      cu === 80010 ? result({ Seed: true }) : result({
        Gone: e.bc.syncs.length > 4
          ? true
          : "Assert.IsTrue failed. still published",
      }),
    {
      ...OK_RESET,
      verifyClean: (container) => {
        verified.push(e.bc.syncs.length);
        return Promise.resolve({ container, ok: true, diff: [], error: null });
      },
    },
  );
  const o = await runControl(e, c, repo, await tmp());
  // The write's cleanup (the 2nd sync) removed the Test app only.
  assertEquals(e.bc.syncs[1]!.removeIds, [IDS.test]);
  assertEquals(verified.length, 1, "only the read after the reset verifies");
  assert(verified[0]! > 2, "never after the write's cleanup");
  assertEquals([o.observed, o.pass], ["cleared", true], o.detail);
});

Deno.test("H-35c: every seeded fixture in the repo is well formed: steps parse, named test procedures exist, reset controls read, leave ids are write apps, app ids unique per fixture, all OnPrem CentralGauge apps", async () => {
  const owner = new Map<string, string>();
  for (const c of PROOF_CONTROLS.filter((c) => c.kind === "seeded")) {
    const dir = join(REPO, c.dir);
    const spec = JSON.parse(await Deno.readTextFile(join(dir, "proof.json")));
    assertEquals(spec.read !== undefined, c.layer === "reset", c.name);
    // An L4 detection must be the fixture's own file, not noise.
    assertEquals(typeof spec.write.detect === "string", c.layer === "L4");
    for (const s of ["write", "read"] as const) {
      if (!spec[s]) continue;
      const apps = await readAppGraph(join(dir, s));
      assert(apps.length > 0, `${c.name}/${s}`);
      for (const a of apps) {
        assertEquals(a.publisher, "CentralGauge");
        const raw = JSON.parse(
          await Deno.readTextFile(join(dir, s, a.folder, "app.json")),
        );
        assertEquals(raw.target, "OnPrem", `${c.name}/${s}/${a.folder}`);
        const prev = owner.get(a.id);
        assert(!prev || prev === c.name, `${a.id} in ${prev} and ${c.name}`);
        owner.set(a.id, c.name);
      }
      let al = "";
      for (const a of apps) {
        for await (const f of Deno.readDir(join(dir, s, a.folder, "src"))) {
          al += await Deno.readTextFile(join(dir, s, a.folder, "src", f.name));
        }
      }
      for (const t of spec[s].tests) {
        assert(
          al.includes(`codeunit ${t.codeunit} `),
          `${c.name}/${s} ${t.codeunit}`,
        );
        for (const p of t.procedures) {
          assert(al.includes(`procedure ${p}()`), `${c.name}/${s} ${p}`);
        }
      }
      for (const id of spec[s].leave ?? []) {
        assert(apps.some((a) => a.id === id), `${c.name}: leave ${id}`);
      }
    }
  }
});

Deno.test("H-35c: proof records are written once and only under <coord>/tasks/H-35/proof, with proof provenance", async () => {
  const coord = await tmp();
  const root = proofRoot(coord);
  const rec = {
    v: 1 as const,
    provenance: { proof: true as const, harness_commit: null },
    at: "2026-11-03T10:00:00.000Z",
    outcome: {
      control: "seed-job-queue",
      layer: "reset" as const,
      expect: "cleared" as const,
      observed: "cleared" as const,
      pass: true,
      container: "C1",
      fs_diff: [],
      detail: "",
    },
  };
  const f = await writeProofRecord(root, rec);
  assert(f.startsWith(join(root, "controls")));
  await assertRejects(() => writeProofRecord(root, rec));
  await assertRejects(
    () => writeProofRecord(join(coord, "results", "harness"), rec),
    Error,
    "tasks/H-35/proof",
  );
  await assertRejects(() =>
    writeProofRecord(root, {
      ...rec,
      provenance: { proof: false, harness_commit: null } as never,
    })
  );
});

Deno.test("H-35c (design-r3 11.3): the proof builder is never a CLI or judging option: nothing under src/ or cli/ imports scripts/harness/proof", async () => {
  const hits: string[] = [];
  const walk = async (d: string) => {
    for await (const e of Deno.readDir(d)) {
      const p = join(d, e.name);
      if (e.isDirectory) await walk(p);
      else if (/\.ts$/.test(e.name)) {
        // An import specifier (static or dynamic), not a comment naming it.
        const src = await Deno.readTextFile(p);
        if (/["'][^"'\n]*harness\/proof\/[^"'\n]*["']/.test(src)) {
          hits.push(p);
        }
      }
    }
  };
  await walk(join(REPO, "src"));
  await walk(join(REPO, "cli"));
  assertEquals(hits, []);
});
