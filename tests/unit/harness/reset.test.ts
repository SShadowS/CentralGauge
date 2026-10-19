import { assert, assertEquals, assertRejects } from "@std/assert";
import { ConfigurationError, ContainerError } from "../../../src/errors.ts";
import { loadLineage } from "../../../src/harness/lineage.ts";
import {
  commandReset,
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
