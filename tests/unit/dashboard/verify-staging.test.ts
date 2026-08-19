import { assert, assertEquals } from "@std/assert";
import { exists as pathExists } from "@std/fs";
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

        assert(
          await pathExists(join(draftDir, "prereq", "app.json")),
          "cleanup must not touch the draft's prereq/",
        );
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

      assert(
        await pathExists(join(draftDir, "correct", "CG-AL-X003.Test.al")),
        "cleanup must not delete the draft's oracle",
      );
      assert(
        await pathExists(draftDir),
        "cleanup must not delete the draft directory itself",
      );
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step("cleanup is idempotent", async () => {
    const draftDir = await Deno.makeTempDir({ prefix: "cg-stage-" });
    try {
      await Deno.mkdir(join(draftDir, "correct"), { recursive: true });
      await Deno.writeTextFile(
        join(draftDir, "correct", "CG-AL-X005.Test.al"),
        "x",
      );
      const staged = await stageResponse({
        draftDir,
        taskId: "CG-AL-X005",
        code: "table 70001 A { }",
      });
      await staged.cleanup();
      await staged.cleanup();
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

  // The defect this pins: `handleAlVerify` copies `projectDir`'s AL files
  // into its verify directory and THEN copies every `<id>.`-prefixed file
  // out of `correct/` on top of them (`copyCompanionTestFiles`, later write
  // wins). `stageResponse` writes the response to `<id>.al`, and
  // `"CG-AL-X006.al".startsWith("CG-AL-X006.")` is true — so without this
  // refusal the author's own reference solution would silently replace
  // every model's candidate and each column would read "Passed first try"
  // for code that was never compiled.
  await t.step(
    "refuses a draft whose correct/ holds a bare <id>.al",
    async () => {
      const draftDir = await Deno.makeTempDir({ prefix: "cg-stage-" });
      try {
        await Deno.mkdir(join(draftDir, "correct"), { recursive: true });
        await Deno.writeTextFile(
          join(draftDir, "correct", "CG-AL-X006.Test.al"),
          "codeunit 80006 T { }",
        );
        await Deno.writeTextFile(
          join(draftDir, "correct", "CG-AL-X006.al"),
          "table 70001 A { }",
        );

        let threw = false;
        let name = "";
        let message = "";
        try {
          await stageResponse({
            draftDir,
            taskId: "CG-AL-X006",
            code: "table 70001 A { }",
          });
        } catch (error) {
          threw = true;
          name = error instanceof Error ? error.name : "";
          message = error instanceof Error ? error.message : String(error);
        }

        assertEquals(
          threw,
          true,
          "staging a draft that would overwrite the candidate must refuse",
        );
        assertEquals(name, "OracleFileError", `got: ${name}: ${message}`);
        assert(
          message.includes("CG-AL-X006.al"),
          `error should name the offending file, got: ${message}`,
        );
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );

  // The other half of the same guard: a legitimate oracle-side companion
  // carries the same reserved prefix and MUST still stage. A refusal broad
  // enough to catch the bare `<id>.al` above but that also rejected
  // `<id>.Mock.al` would make every mock-using draft unverifiable.
  await t.step(
    "stages a draft with a legitimate <id>.Mock.al companion",
    async () => {
      const draftDir = await Deno.makeTempDir({ prefix: "cg-stage-" });
      try {
        await Deno.mkdir(join(draftDir, "correct"), { recursive: true });
        await Deno.writeTextFile(
          join(draftDir, "correct", "CG-AL-X007.Test.al"),
          "codeunit 80007 T { }",
        );
        await Deno.writeTextFile(
          join(draftDir, "correct", "CG-AL-X007.Mock.al"),
          "codeunit 80008 M { }",
        );

        const staged = await stageResponse({
          draftDir,
          taskId: "CG-AL-X007",
          code: "table 70001 A { }",
        });
        try {
          assertEquals(
            staged.testFile,
            join(draftDir, "correct", "CG-AL-X007.Test.al"),
          );
        } finally {
          await staged.cleanup();
        }
      } finally {
        await Deno.remove(draftDir, { recursive: true });
      }
    },
  );
});
