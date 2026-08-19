import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { stageResponse } from "../../../src/dashboard/verify-staging.ts";

Deno.test("verify-staging", async (t) => {
  await t.step(
    "writes the candidate as one file named for the task",
    async () => {
      const draftDir = await Deno.makeTempDir({ prefix: "cg-stage-" });
      try {
        await Deno.mkdir(join(draftDir, "correct"), { recursive: true });
        await Deno.writeTextFile(
          join(draftDir, "correct", "CG-AL-X001.Test.al"),
          "codeunit 80001 T { }",
        );

        const staged = await stageResponse({
          draftDir,
          taskId: "CG-AL-X001",
          code: 'table 70001 "A" { }\ntable 70002 "B" { }',
        });
        try {
          const written = await Deno.readTextFile(
            join(staged.projectDir, "CG-AL-X001.al"),
          );
          assert(written.includes("70001"));
          assert(written.includes("70002"), "both objects in ONE file");
          assertEquals(
            staged.testFile,
            join(draftDir, "correct", "CG-AL-X001.Test.al"),
          );
          assertEquals(staged.prereqDir, undefined, "no prereq/ in this draft");
        } finally {
          await staged.cleanup();
        }
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step(
    "points prereqDir at the draft's prereq when present",
    async () => {
      const draftDir = await Deno.makeTempDir({ prefix: "cg-stage-" });
      try {
        await Deno.mkdir(join(draftDir, "correct"), { recursive: true });
        await Deno.writeTextFile(
          join(draftDir, "correct", "CG-AL-X002.Test.al"),
          "x",
        );
        await Deno.mkdir(join(draftDir, "prereq"), { recursive: true });
        await Deno.writeTextFile(join(draftDir, "prereq", "app.json"), "{}");

        const staged = await stageResponse({
          draftDir,
          taskId: "CG-AL-X002",
          code: "table 70001 A { }",
        });
        try {
          assertEquals(staged.prereqDir, join(draftDir, "prereq"));
        } finally {
          await staged.cleanup();
        }
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  await t.step("cleanup removes the staged directory", async () => {
    const draftDir = await Deno.makeTempDir({ prefix: "cg-stage-" });
    try {
      await Deno.mkdir(join(draftDir, "correct"), { recursive: true });
      await Deno.writeTextFile(
        join(draftDir, "correct", "CG-AL-X003.Test.al"),
        "x",
      );
      const staged = await stageResponse({
        draftDir,
        taskId: "CG-AL-X003",
        code: "table 70001 A { }",
      });
      const dir = staged.projectDir;
      await staged.cleanup();
      let exists = true;
      try {
        await Deno.stat(dir);
      } catch {
        exists = false;
      }
      assertEquals(exists, false);
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step("refuses when the oracle is missing", async () => {
    const draftDir = await Deno.makeTempDir({ prefix: "cg-stage-" });
    try {
      let threw = false;
      let message = "";
      try {
        await stageResponse({ draftDir, taskId: "CG-AL-X004", code: "x" });
      } catch (error) {
        threw = true;
        message = error instanceof Error ? error.message : String(error);
      }
      assertEquals(threw, true, "no oracle means nothing can be verified");
      assert(
        message.includes("CG-AL-X004") ||
          message.includes("CG-AL-X004.Test.al"),
        `error should name the missing oracle, got: ${message}`,
      );
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });
});
