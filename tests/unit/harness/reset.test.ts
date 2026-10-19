import { assert, assertEquals, assertRejects } from "@std/assert";
import { ConfigurationError, ContainerError } from "../../../src/errors.ts";
import { loadLineage } from "../../../src/harness/lineage.ts";
import {
  commandReset,
  fsDiff,
  goldenReset,
  parseResetOutput,
  parseVerifyOutput,
  RESET_PHASES,
  ResetFailedError,
} from "../../../src/harness/reset.ts";

const MECH = { id: "golden-restore", policyVersion: 1 };

Deno.test("H-35 S3 parseResetOutput: RESET_OK with exit 0 is a reset, phases timed", () => {
  const r = parseResetOutput("C1", MECH, {
    code: 0,
    // Sol r2 #1: every agreed phase, in order; other lines are noise.
    stdout: ["noise", ...FULL, "RESET_OK"].join("\r\n"),
  });
  assertEquals(r, {
    container: "C1",
    mechanism: "golden-restore",
    policy_version: 1,
    ok: true,
    failed_step: null,
    error: null,
    phases_ms: Object.fromEntries(RESET_PHASES.map((p, i) => [p, i + 1])),
  });
});

Deno.test("H-35 S3 parseResetOutput: the snapshot guard's refusal, a missing marker, RESET_OK with a failing exit and both markers are failures", () => {
  const guard = parseResetOutput("C1", MECH, {
    code: 2,
    stdout:
      "RESET_STEP snapshot_guard 9\nRESET_FAILED snapshot_guard snapshot CRONUS_snap of CRONUS exists",
  });
  assertEquals(
    [guard.ok, guard.failed_step, guard.error],
    [false, "snapshot_guard", "snapshot CRONUS_snap of CRONUS exists"],
  );
  const none = parseResetOutput("C1", MECH, { code: 0, stdout: "x" });
  assertEquals([none.ok, none.failed_step], [false, "protocol"]);
  const exit = parseResetOutput("C1", MECH, { code: 1, stdout: "RESET_OK" });
  assertEquals([exit.ok, exit.failed_step], [false, "protocol"]);
  const both = parseResetOutput("C1", MECH, {
    code: 0,
    stdout: "RESET_FAILED runner_verify no answer\nRESET_OK",
  });
  assertEquals([both.ok, both.failed_step], [false, "runner_verify"]);
});

Deno.test("H-35 S3 commandReset: a failed reset is a ResetFailedError (a ContainerError, so infra), carrying its record", async () => {
  const m = commandReset({
    ...MECH,
    run: () =>
      Promise.resolve({
        code: 2,
        stdout: "RESET_FAILED snapshot_guard snapshot exists",
      }),
  });
  const ok = commandReset({
    ...MECH,
    run: () =>
      Promise.resolve({ code: 0, stdout: [...FULL, "RESET_OK"].join("\n") }),
  });
  assertEquals((await ok.reset("C2")).ok, true);
  const r = await m.reset("C1");
  assertEquals(r.failed_step, "snapshot_guard");
  const err = new ResetFailedError(r);
  assertEquals(err instanceof ContainerError, true);
  assertEquals(err.record, r);
  await assertRejects(
    () => Promise.reject(err),
    ContainerError,
    "reset of C1 failed at snapshot_guard: snapshot exists",
  );
});

// ---- H-35 run 002 Sol r2 ----

const FULL = RESET_PHASES.map((p, i) => `RESET_STEP ${p} ${i + 1}`);

Deno.test("H-35 Sol r2 #1: success needs every agreed phase once, in order, and exactly one bare RESET_OK", () => {
  const ok = parseResetOutput("C1", MECH, {
    code: 0,
    stdout: [...FULL, "RESET_OK"].join("\n"),
  });
  assertEquals(ok.ok, true);
  assertEquals(Object.keys(ok.phases_ms), [...RESET_PHASES]);
  const bad = (lines: string[]) =>
    parseResetOutput("C1", MECH, { code: 0, stdout: lines.join("\n") });
  for (
    const lines of [
      ["RESET_STEP restore 1", "RESET_OK"], // phases missing
      [...FULL, "RESET_OK", "RESET_OK"], // duplicated marker
      [...FULL, "RESET_OK C1"], // trailing text
      [...FULL.slice(1), FULL[0]!, "RESET_OK"], // out of order
      [...FULL, FULL.at(-1)!, "RESET_OK"], // a phase twice
      [...FULL, "RESET_STEP extra 1", "RESET_OK"], // an unknown phase
    ]
  ) {
    const r = bad(lines);
    assertEquals([r.ok, r.failed_step], [false, "protocol"], lines.join("|"));
  }
  // A failure needs its one marker too.
  const twice = bad([
    "RESET_FAILED restore a",
    "RESET_FAILED start b",
  ]);
  assertEquals([twice.ok, twice.failed_step], [false, "protocol"]);
});

Deno.test("H-35 Sol r2 #3: a reset command that throws is a recorded reset failure (command), never an unrecorded error; a ConfigurationError still refuses", async () => {
  const m = commandReset({
    ...MECH,
    run: (c) =>
      Promise.reject(new ContainerError("pwsh session died", c, "setup")),
  });
  const r = await m.reset("C1");
  assertEquals([r.ok, r.failed_step], [false, "command"]);
  assertEquals(r.error, "pwsh session died");
  const refusing = commandReset({
    ...MECH,
    run: () => Promise.reject(new ConfigurationError("no lineage")),
  });
  await assertRejects(() => refusing.reset("C1"), ConfigurationError);
});

Deno.test("H-35 Sol r3 #1: a combined phase name or RESET_OK before the phases is a protocol failure", () => {
  for (
    const lines of [
      [`RESET_STEP ${RESET_PHASES.join(",")} 1`, "RESET_OK"],
      ["RESET_OK", ...FULL],
    ]
  ) {
    const r = parseResetOutput("C1", MECH, {
      code: 0,
      stdout: lines.join("\n"),
    });
    assertEquals([r.ok, r.failed_step], [false, "protocol"], lines.join("|"));
  }
});

// ---- H-35 run 002 orchestrator Sol r1 ----

Deno.test("H-35 orch Sol r1 #1: any malformed reserved-marker line is a protocol failure, whatever follows", () => {
  for (
    const bad of [
      "RESET_FAILED",
      "RESET_FAILED snapshot_guard",
      "RESET_FAILEDx y z",
      "RESET_STEP restore",
      "RESET_STEP restore 1.5",
      "RESET_STEPrestore 1",
      "RESET_OKAY",
    ]
  ) {
    const r = parseResetOutput("C1", MECH, {
      code: 0,
      stdout: [...FULL, bad, "RESET_OK"].join("\n"),
    });
    assertEquals([r.ok, r.failed_step], [false, "protocol"], bad);
  }
});

// ---- H-35 S3: the post-cleanup inventory check protocol ----

Deno.test("H-35 S3 parseVerifyOutput: VERIFY_OK with exit 0 is clean; VERIFY_DIRTY carries its diff lines; anything else is a failed check", () => {
  assertEquals(
    parseVerifyOutput("C1", { code: 0, stdout: "noise\r\nVERIFY_OK" }),
    { container: "C1", ok: true, diff: [], error: null },
  );
  const dirty = parseVerifyOutput("C1", {
    code: 1,
    stdout: "VERIFY_DIFF + P|abc\nVERIFY_DIFF - I|def\nVERIFY_DIRTY 2",
  });
  assertEquals(dirty.ok, false);
  assertEquals(dirty.diff, ["+ P|abc", "- I|def"]);
  assertEquals(dirty.error, "inventory differs from the baseline (2 lines)");
  for (
    const [stdout, code, why] of [
      ["VERIFY_FAILED sqlcmd timed out", 1, "sqlcmd timed out"],
      ["", 0, "protocol"],
      ["VERIFY_OK", 1, "protocol"],
      ["VERIFY_OK\nVERIFY_OK", 0, "protocol"],
      ["VERIFY_DIFF + x\nVERIFY_OK", 0, "protocol"], // a diff with OK
      ["VERIFY_DIFF + x\nVERIFY_DIRTY 2", 1, "protocol"], // count mismatch
      ["VERIFY_DIRTY", 1, "protocol"], // malformed marker
      ["VERIFY_OK\nVERIFY_FAILED x", 1, "protocol"],
    ] as const
  ) {
    const r = parseVerifyOutput("C1", { code, stdout });
    assertEquals(r.ok, false, stdout);
    assert(r.error!.includes(why), `${stdout}: ${r.error}`);
  }
});

Deno.test("H-35 S3 goldenReset.verifyClean runs verify-clean.ps1 with the lineage; a spawn that throws is a failed check, not a throw", async () => {
  const calls: string[][] = [];
  const m = goldenReset({
    repoRoot: "R",
    lineagePath: "L.json",
    lineage: await loadLineage(
      "infra/harness-reset/lineages/golden-o09-v1.json",
    ),
    dockerEnv: { DOCKER_CONTEXT: "desktop-windows" },
    spawn: (_cmd, args) => {
      calls.push(args);
      return args.includes("C2")
        ? Promise.reject(new Error("spawn died"))
        : Promise.resolve({ code: 0, stdout: "VERIFY_OK" });
    },
  });
  assertEquals((await m.verifyClean!("C1")).ok, true);
  assert(calls[0]!.some((a) => a.endsWith("verify-clean.ps1")));
  assertEquals(calls[0]!.slice(-4), ["-Container", "C1", "-Lineage", "L.json"]);
  const bad = await m.verifyClean!("C2");
  assertEquals([bad.ok, bad.error], [false, "spawn died"]);
});

// ---- H-35 S3 L4: fsDigest diff (decisions/2026-10-20-h-35-l4-scope.md) ----

/** Windows paths written with "/" for readability. */
const w = (s: string) => s.replaceAll("/", "\\");
const F = (p: string, h = "a".repeat(64), t = 1) => `F|${h}|4|32|${t}|${w(p)}`;
/** A complete capture: its lines, then the `T|<n>` marker fs-capture.ps1 ends with. */
const cap = (...lines: string[]) => [...lines, `T|${lines.length}`];

Deno.test("H-35 S3 L4 fsDiff: new, changed (content or metadata only) and removed entries, keyed by path and stream; identical digests are clean", () => {
  const before = cap(
    w("D|16|5|C:/W"),
    F("C:/W/a.txt"),
    F("C:/W/b.txt"),
    w("S|" + "c".repeat(64) + "|3|C:/W:hid"),
  );
  assertEquals(fsDiff(before, before, [], [w("C:/W")]), {
    diff: [],
    errors: [],
  });
  const after = cap(
    w("D|16|5|C:/W"),
    F("C:/W/a.txt", "a".repeat(64), 2), // mtime only
    F("C:/W/new.txt"),
    w("S|" + "d".repeat(64) + "|3|C:/W:hid"), // directory ADS content
  );
  const r = fsDiff(before, after, [], [w("C:/W")]);
  assertEquals(r.errors, []);
  assertEquals(
    r.diff.map((d) => [d.path, d.before !== null, d.after !== null]),
    [
      [w("C:/W:hid"), true, true],
      [w("C:/W/a.txt"), true, true],
      [w("C:/W/b.txt"), true, false],
      [w("C:/W/new.txt"), false, true],
    ],
  );
});

Deno.test("H-35 S3 L4 fsDiff: exclusions match case-insensitively with * as any run (subtree); E lines on either side and unparsable lines are errors (fail closed)", () => {
  const before = cap(F("C:/W/Logs/x.log"));
  const after = cap(
    F("C:/W/logs/x.log", "b".repeat(64)),
    F("C:/W/logs/y/z.log"),
  );
  assertEquals(fsDiff(before, after, [w("c:/w/LOGS/*")]).diff, []);
  assertEquals(fsDiff(before, after, [w("C:/W/logs/*.txt")]).diff.length, 2);
  const e = fsDiff(
    cap(w("E|C:/W/a|access denied")),
    cap(
      "garbage",
      "E|(nst)|not quiescent: 1",
    ),
    [],
  );
  assertEquals(e.errors, [
    w("before: C:/W/a: access denied"),
    "after: unparsable line garbage",
    "after: (nst): not quiescent: 1",
  ]);
});

Deno.test("H-35 Sol S3 r1 #5: a capture without its T| marker, with a wrong count, malformed fields, a duplicate key, or a declared root it does not cover is an error (fail closed); empty captures never compare clean", () => {
  const ok = cap(w("D|16|5|C:/W"), F("C:/W/a.txt"));
  const errs = (after: string[], roots = [w("C:/W")]) =>
    fsDiff(ok, after, [], roots).errors;
  assertEquals(errs(ok), []);
  assert(errs([])[0]!.includes("no T| marker"), "empty capture");
  assert(errs(ok.slice(0, -1))[0]!.includes("no T| marker"), "missing marker");
  assert(
    errs([w("D|16|5|C:/W"), F("C:/W/a.txt"), "T|5"])[0]!.includes("count"),
  );
  assert(
    errs([...ok.slice(0, -1), "T|2", "T|2"])[0]!.includes("T| marker"),
    "two markers",
  );
  for (
    const bad of [
      w("F|||||C:/W/f"),
      w("F|xyz|4|32|1|C:/W/f"),
      w("S|" + "a".repeat(64) + "|-1|C:/W:s"),
      w("D|x|5|C:/W/d"),
    ]
  ) {
    assert(
      errs(cap(w("D|16|5|C:/W"), F("C:/W/a.txt"), bad))[0]!.includes(
        "unparsable",
      ),
      bad,
    );
  }
  // a changed record followed by the original for the same path
  assert(
    errs(
      cap(w("D|16|5|C:/W"), F("C:/W/a.txt", "b".repeat(64)), F("C:/W/a.txt")),
    )
      .some((e) => e.includes("twice")),
  );
  // a declared root with no entry (neither D nor L nor E)
  assert(
    errs(ok, [w("C:/W"), w("C:/X")]).some((e) => e.includes("C:\\X")),
  );
  assertEquals(fsDiff([], [], []).errors.length > 0, true);
  // Sol S3 r2: an F or S record for the root path does not cover it
  for (
    const only of [
      w(`S|${"a".repeat(64)}|1|C:/W`),
      F("C:/W"),
    ]
  ) {
    const x = cap(only);
    assert(
      fsDiff(x, x, [], [w("C:/W")]).errors.some((e) =>
        e.includes("declared root")
      ),
      only,
    );
  }
});
