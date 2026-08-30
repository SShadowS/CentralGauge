import { assertEquals } from "@std/assert";
import type { CompilationError } from "../../../src/container/types.ts";
import {
  classifyCompileFailure,
  computeOmissionStats,
  type OmissionTaskView,
  renderOmissionBlock,
} from "../../../src/stats/omission.ts";

function err(code: string): CompilationError {
  return {
    code,
    message: `${code} message`,
    file: "CG-AL-X001.al",
    line: 1,
    column: 1,
    severity: "error",
  };
}

function compiled(success: boolean, codes: string[] = []) {
  return {
    success,
    errors: codes.map(err),
    warnings: [],
    output: "",
    duration: 1,
  };
}

Deno.test("classifyCompileFailure", async (t) => {
  await t.step("all-omission diagnostics classify as omission", () => {
    assertEquals(classifyCompileFailure([err("AL0185")]), "omission");
    assertEquals(
      classifyCompileFailure([err("AL0132"), err("AL0185")]),
      "omission",
    );
  });

  await t.step("AL0000 is a cascade and never decides on its own", () => {
    // AL0000 alongside omission codes must not demote the verdict...
    assertEquals(
      classifyCompileFailure([err("AL0132"), err("AL0000")]),
      "omission",
    );
    // ...and alone it is not evidence of omission.
    assertEquals(classifyCompileFailure([err("AL0000")]), "al_knowledge");
  });

  await t.step("omission alongside a real diagnostic is held out", () => {
    // An AL0185 can be a cascade of the syntax error: the file that failed to
    // parse took its objects with it. Claiming these inflated the artifact
    // share from 33% to 53% on the three-model panel.
    assertEquals(
      classifyCompileFailure([err("AL0104"), err("AL0185")]),
      "mixed",
    );
  });

  await t.step("everything else is a real AL capability failure", () => {
    assertEquals(classifyCompileFailure([err("AL0104")]), "al_knowledge");
    assertEquals(classifyCompileFailure([]), "al_knowledge");
  });
});

Deno.test("computeOmissionStats", async (t) => {
  await t.step("counts the lost-repair pattern", () => {
    const tasks: OmissionTaskView[] = [{
      success: false,
      attempts: [
        { compilationResult: compiled(true), failedAssertions: true },
        {
          compilationResult: compiled(false, ["AL0132"]),
          failedAssertions: false,
        },
      ],
    }];
    const s = computeOmissionStats(tasks);
    assertEquals(s.behaviouralFirstAttempts, 1);
    assertEquals(s.lostRepairs, 1);
    assertEquals(s.omissionAttempts, 1);
    assertEquals(s.omissionFailedTasks, 1);
    assertEquals(s.failedTasks, 1);
  });

  await t.step("a behavioural repair failure is not a lost repair", () => {
    const s = computeOmissionStats([{
      success: false,
      attempts: [
        { compilationResult: compiled(true), failedAssertions: true },
        { compilationResult: compiled(true), failedAssertions: true },
      ],
    }]);
    assertEquals(s.behaviouralFirstAttempts, 1);
    assertEquals(s.lostRepairs, 0);
    assertEquals(s.omissionFailedTasks, 0);
  });

  await t.step(
    "mixed attempts are tracked but never scored as omission",
    () => {
      const s = computeOmissionStats([{
        success: false,
        attempts: [{
          compilationResult: compiled(false, ["AL0104", "AL0185"]),
          failedAssertions: false,
        }],
      }]);
      assertEquals(s.mixedAttempts, 1);
      assertEquals(s.omissionAttempts, 0);
      assertEquals(s.omissionFailedTasks, 0);
    },
  );

  await t.step("a passing task contributes no failure counts", () => {
    const s = computeOmissionStats([{
      success: true,
      attempts: [{
        compilationResult: compiled(true),
        failedAssertions: false,
      }],
    }]);
    assertEquals(s.failedTasks, 0);
    assertEquals(s.compiledAttempts, 1);
    assertEquals(s.omissionAttempts, 0);
  });

  await t.step("attempts that never reached the compiler are skipped", () => {
    const s = computeOmissionStats([{
      success: false,
      attempts: [{ compilationResult: undefined, failedAssertions: false }],
    }]);
    assertEquals(s.compiledAttempts, 0);
    assertEquals(s.failedTasks, 1);
    assertEquals(s.omissionFailedTasks, 0);
  });
});

Deno.test("renderOmissionBlock", async (t) => {
  await t.step("emits nothing on a clean run", () => {
    const s = computeOmissionStats([{
      success: true,
      attempts: [{
        compilationResult: compiled(true),
        failedAssertions: false,
      }],
    }]);
    assertEquals(renderOmissionBlock(s), []);
  });

  await t.step("reports rate and lost repairs when omission occurred", () => {
    const s = computeOmissionStats([{
      success: false,
      attempts: [
        { compilationResult: compiled(true), failedAssertions: true },
        {
          compilationResult: compiled(false, ["AL0185"]),
          failedAssertions: false,
        },
      ],
    }]);
    const lines = renderOmissionBlock(s);
    assertEquals(lines[0], "# Omission");
    const body = lines.join("\n");
    assertEquals(body.includes("omission_attempts: 1/2"), true);
    assertEquals(
      body.includes("omission_rate: 100.0% of 1 failed tasks"),
      true,
    );
    assertEquals(body.includes("lost_repairs: 1/1"), true);
  });
});
