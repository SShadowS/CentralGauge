import { assertEquals, assertRejects } from "@std/assert";
import { ContainerError } from "../../../src/errors.ts";
import {
  commandReset,
  parseResetOutput,
  ResetFailedError,
} from "../../../src/harness/reset.ts";

const MECH = { id: "golden-restore", policyVersion: 1 };

Deno.test("H-35 S3 parseResetOutput: RESET_OK with exit 0 is a reset, phases timed", () => {
  const r = parseResetOutput("C1", MECH, {
    code: 0,
    stdout: [
      "noise",
      "RESET_STEP snapshot_guard 12",
      "RESET_STEP restore 3100",
      "RESET_OK",
    ].join("\r\n"),
  });
  assertEquals(r, {
    container: "C1",
    mechanism: "golden-restore",
    policy_version: 1,
    ok: true,
    failed_step: null,
    error: null,
    phases_ms: { snapshot_guard: 12, restore: 3100 },
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
    run: (c) =>
      Promise.resolve({ code: 0, stdout: `RESET_STEP x 1\nRESET_OK ${c}` }),
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
