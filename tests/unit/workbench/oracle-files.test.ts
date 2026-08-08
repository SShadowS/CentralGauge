/**
 * Unit tests for oracle-side file classification.
 *
 * SAFETY: every fixture lives under `Deno.makeTempDir()`. Nothing here may
 * read or write the real `scratch/` tree.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import {
  classifyOracleFiles,
  companionPredicateMatches,
  OracleFileError,
} from "../../../src/workbench/oracle-files.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

const ID = "CG-AL-X053";

describe("workbench/oracle-files", () => {
  let base: string;
  let draftDir: string;

  beforeEach(async () => {
    base = await createTempDir("workbench-oracle-files-test");
    draftDir = join(base, ID);
    await ensureDir(join(draftDir, "correct"));
    await ensureDir(join(draftDir, "naive"));
    await Deno.writeTextFile(
      join(draftDir, "correct", `${ID}.Test.al`),
      'codeunit 88805 "X Test" { }',
    );
  });

  afterEach(async () => {
    await cleanupTempDir(base);
  });

  it("classifies a bare draft as oracle-only", async () => {
    const set = await classifyOracleFiles({ id: ID, draftDir });
    assertEquals(set.oracle, `${ID}.Test.al`);
    assertEquals(set.companions, []);
  });

  it("classifies a companion mock as oracle-side", async () => {
    await Deno.writeTextFile(
      join(draftDir, "correct", `${ID}.MockThing.al`),
      'codeunit 88806 "X Mock" { }',
    );
    const set = await classifyOracleFiles({ id: ID, draftDir });
    assertEquals(set.companions, [`${ID}.MockThing.al`]);
  });

  it("ignores an unprefixed solution file", async () => {
    await Deno.writeTextFile(
      join(draftDir, "correct", "DayClose.Codeunit.al"),
      'codeunit 70001 "Day Close" { }',
    );
    const set = await classifyOracleFiles({ id: ID, draftDir });
    assertEquals(set.companions, []);
  });

  it("refuses a bare <id>.al in correct/", async () => {
    await Deno.writeTextFile(
      join(draftDir, "correct", `${ID}.al`),
      'codeunit 70001 "Day Close" { }',
    );
    const error = await assertRejects(
      () => classifyOracleFiles({ id: ID, draftDir }),
      OracleFileError,
    );
    assertStringIncludes(error.message, "overwrite");
  });

  it("refuses a case-mismatched bare id.al in correct/", async () => {
    await Deno.writeTextFile(
      join(draftDir, "correct", "cg-al-x053.al"),
      'codeunit 70001 "Day Close" { }',
    );
    await assertRejects(
      () => classifyOracleFiles({ id: ID, draftDir }),
      OracleFileError,
    );
  });

  it("refuses any <id>.*.al in naive/", async () => {
    await Deno.writeTextFile(
      join(draftDir, "naive", `${ID}.MockThing.al`),
      'codeunit 88806 "X Mock" { }',
    );
    const error = await assertRejects(
      () => classifyOracleFiles({ id: ID, draftDir }),
      OracleFileError,
    );
    assertStringIncludes(error.message, "naive/");
  });

  it("refuses a case-mismatched <id>.*.al in naive/", async () => {
    await Deno.writeTextFile(
      join(draftDir, "naive", "cg-al-x053.Mock.al"),
      'codeunit 88806 "X Mock" { }',
    );
    await assertRejects(
      () => classifyOracleFiles({ id: ID, draftDir }),
      OracleFileError,
    );
  });

  it("refuses when correct/ has no oracle at all", async () => {
    await Deno.remove(join(draftDir, "correct", `${ID}.Test.al`));
    await assertRejects(
      () => classifyOracleFiles({ id: ID, draftDir }),
      OracleFileError,
    );
  });

  describe("anti-drift invariant", () => {
    // Every name copyCompanionTestFiles would match in correct/ must be
    // classified by classifyOracleFiles - accepted as a companion, or
    // refused. A name that neither matcher agrees on is the exact failure
    // the shared-list design exists to prevent.
    const names = [
      `${ID}.Test.al`,
      `${ID}.MockThing.al`,
      `${ID}.al`,
      `${ID}.Spy.al`,
      "DayClose.Codeunit.al",
      "Other.al",
      `${ID}Extra.al`,
      `${ID}.Test.txt`,
    ];

    for (const name of names) {
      it(`agrees on ${name}`, async () => {
        if (name !== `${ID}.Test.al`) {
          await Deno.writeTextFile(
            join(draftDir, "correct", name),
            'codeunit 88888 "X" { }',
          );
        }
        const copierMatches = companionPredicateMatches(ID, name);

        let classified: string[] | "refused";
        try {
          const set = await classifyOracleFiles({ id: ID, draftDir });
          classified = [set.oracle, ...set.companions];
        } catch (error) {
          if (!(error instanceof OracleFileError)) throw error;
          classified = "refused";
        }

        if (copierMatches) {
          const known = classified === "refused" ||
            classified.includes(name);
          assertEquals(
            known,
            true,
            `${name} is copied by copyCompanionTestFiles but neither ` +
              `classified nor refused by classifyOracleFiles`,
          );
        }
      });
    }
  });
});
