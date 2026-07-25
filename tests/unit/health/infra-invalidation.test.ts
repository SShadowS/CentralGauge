/**
 * Unit tests for the shared infra-invalidation predicate (T2).
 */

import { assertEquals } from "@std/assert";
import { isInfraInvalidatedAttempt } from "../../../src/health/infra-invalidation.ts";

Deno.test("isInfraInvalidatedAttempt", async (t) => {
  await t.step("true when infraRetryExhausted is set", () => {
    assertEquals(
      isInfraInvalidatedAttempt({
        infraRetryExhausted: true,
        failureReasons: ["Tests failed"],
      }),
      true,
    );
  });

  await t.step("true when a quarantined marker is present", () => {
    assertEquals(
      isInfraInvalidatedAttempt({
        quarantined: {
          quarantined: true,
          forcedByAlertId: "alert-1",
          originContainer: "Cronus28",
          classificationReason: "container_quarantined",
        },
        failureReasons: ["Tests failed"],
      }),
      true,
    );
  });

  await t.step(
    "true when infraSynthesized is set, even without the legacy prefix",
    () => {
      // Proves the structural flag is checked on its own, not just riding
      // along with a failureReasons string that would also match the legacy
      // prefix check below.
      assertEquals(
        isInfraInvalidatedAttempt({
          infraSynthesized: true,
          failureReasons: ["SQL Server connection lost"],
        }),
        true,
      );
    },
  );

  await t.step(
    "true via the legacy prefix fallback when infraSynthesized is absent",
    () => {
      // Result files written before commit a133e6e7 carry no infraSynthesized
      // flag; `centralgauge ingest <file>` still replays them, so this path
      // must keep working on its own.
      assertEquals(
        isInfraInvalidatedAttempt({
          failureReasons: ["Infra error: PSSession lost"],
        }),
        true,
      );
    },
  );

  await t.step("false for a normal model failure", () => {
    assertEquals(
      isInfraInvalidatedAttempt({
        failureReasons: ["Compilation failed: AL0118"],
      }),
      false,
    );
  });

  await t.step("false when the infra reason is not FIRST", () => {
    assertEquals(
      isInfraInvalidatedAttempt({
        failureReasons: ["Compilation failed", "Infra error: later"],
      }),
      false,
    );
  });

  await t.step("false for an empty attempt", () => {
    assertEquals(isInfraInvalidatedAttempt({}), false);
  });
});
