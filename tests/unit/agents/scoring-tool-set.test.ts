/**
 * al_verify is diagnostic-only for the non-sandbox scorer (M1/M2 follow-up).
 *
 * al_verify takes a MODEL-CHOSEN testFile, so an agent could stage a trivial
 * always-pass test and call al_verify instead of al_verify_task; the resulting
 * pass is structurally genuine, so structured-only scoring can't reject it. It
 * must therefore never be a scoring input — only al_verify_task (which resolves
 * the real benchmark test from the task YAML) and al_compile (server-run compile
 * verdict) score. Sandbox M1 already made al_verify diagnostic-only.
 */

import { assertEquals } from "@std/assert";
import { isScoringGenericTool } from "../../../src/agents/executor.ts";

Deno.test("isScoringGenericTool", async (t) => {
  await t.step("al_verify_task scores (real benchmark test)", () => {
    assertEquals(isScoringGenericTool("al_verify_task"), true);
  });

  await t.step("al_compile scores (server-run compile verdict)", () => {
    assertEquals(isScoringGenericTool("al_compile"), true);
  });

  await t.step("al_verify does NOT score (model-chosen testFile)", () => {
    assertEquals(isScoringGenericTool("al_verify"), false);
  });

  await t.step("al_container_status does NOT score", () => {
    assertEquals(isScoringGenericTool("al_container_status"), false);
  });
});
