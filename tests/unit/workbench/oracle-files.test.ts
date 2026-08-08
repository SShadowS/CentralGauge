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
  type OracleFileSet,
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
    // Each name has an explicit expected outcome. The copier
    // (copyCompanionTestFiles) and classifier must agree on all names it
    // handles. If companionPredicateMatches returns true, the name must be
    // either refused or included in the classification. If it returns false,
    // the classifier must ignore it (not refuse it).
    interface TestCase {
      name: string;
      // "oracle" = must be set.oracle
      // "companion" = must be in set.companions
      // "refused" = must throw OracleFileError
      // "ignored" = must not be refused, and not be in oracle/companions
      expected: "oracle" | "companion" | "refused" | "ignored";
    }

    const cases: TestCase[] = [
      { name: `${ID}.Test.al`, expected: "oracle" },
      { name: `${ID}.MockThing.al`, expected: "companion" },
      { name: `${ID}.al`, expected: "refused" },
      { name: `${ID}.Spy.al`, expected: "companion" },
      { name: "DayClose.Codeunit.al", expected: "ignored" },
      { name: "Other.al", expected: "ignored" },
      { name: `${ID}Extra.al`, expected: "ignored" },
      { name: `${ID}.Test.txt`, expected: "ignored" },
    ];

    for (const { name, expected } of cases) {
      it(`expects ${name} to be ${expected}`, async () => {
        if (name !== `${ID}.Test.al`) {
          await Deno.writeTextFile(
            join(draftDir, "correct", name),
            'codeunit 88888 "X" { }',
          );
        }

        let set: OracleFileSet | null = null;
        let error: OracleFileError | null = null;
        try {
          set = await classifyOracleFiles({ id: ID, draftDir });
        } catch (e) {
          if (!(e instanceof OracleFileError)) throw e;
          error = e;
        }

        if (expected === "oracle") {
          assertEquals(set?.oracle, name, `${name} should be the oracle`);
        } else if (expected === "companion") {
          assertEquals(
            set?.companions.includes(name),
            true,
            `${name} should be in companions`,
          );
        } else if (expected === "refused") {
          assertEquals(error !== null, true, `${name} should be refused`);
        } else if (expected === "ignored") {
          assertEquals(
            set?.oracle === name || set?.companions.includes(name),
            false,
            `${name} should be ignored (not oracle, not companion)`,
          );
          assertEquals(
            error,
            null,
            `${name} should not throw an error`,
          );
        }

        // Verify companionPredicateMatches is consistent: if it matches,
        // the name must be either refused or in the classification.
        const copierMatches = companionPredicateMatches(ID, name);
        if (copierMatches) {
          const isClassified = set?.oracle === name ||
            set?.companions.includes(name);
          const isRefused = error !== null;
          assertEquals(
            isClassified || isRefused,
            true,
            `copier matched ${name} but it was neither classified nor refused`,
          );
        }
      });
    }
  });
});
