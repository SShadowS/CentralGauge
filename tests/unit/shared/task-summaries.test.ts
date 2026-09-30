import { assertEquals } from "@std/assert";
import {
  parseTaskSummaries,
  SUMMARY_MAX_CHARS,
} from "../../../shared/task-summaries.ts";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

Deno.test("parseTaskSummaries", async (t) => {
  await t.step("parses entries and ignores the preamble", () => {
    const md = [
      "# Task summaries",
      "",
      "Intro text.",
      "",
      "## CG-AL-X185",
      `description_sha: ${SHA_A}`,
      "",
      "Four parts of one app.",
      "### Not a new entry",
      "Still X185.",
      "",
      "## CG-AL-E001",
      `description_sha: ${SHA_B}`,
      "A table task.",
    ].join("\n");
    const r = parseTaskSummaries(md);
    assertEquals(r.errors, []);
    assertEquals(r.entries, [
      {
        id: "CG-AL-X185",
        descriptionSha: SHA_A,
        body: "Four parts of one app.\n### Not a new entry\nStill X185.",
      },
      { id: "CG-AL-E001", descriptionSha: SHA_B, body: "A table task." },
    ]);
  });

  await t.step("CRLF parses the same as LF", () => {
    const lf = `## CG-AL-E001\ndescription_sha: ${SHA_A}\nBody.\n`;
    assertEquals(
      parseTaskSummaries(lf.replaceAll("\n", "\r\n")),
      parseTaskSummaries(lf),
    );
  });

  await t.step("reports malformed entries and skips them", () => {
    const md = [
      "## CG-AL-E001",
      "description_sha: nothex",
      "Body.",
      "## CG-AL-E002",
      `description_sha: ${SHA_A}`,
      "",
      "## CG-AL-E003",
      `description_sha: ${SHA_A}`,
      "x".repeat(SUMMARY_MAX_CHARS + 1),
      "## CG-AL-E004",
      `description_sha: ${SHA_A}`,
      "Fine.",
      "## CG-AL-E004",
      `description_sha: ${SHA_B}`,
      "Duplicate.",
    ].join("\n");
    const r = parseTaskSummaries(md);
    assertEquals(r.entries.map((e) => e.id), ["CG-AL-E004"]);
    assertEquals(r.errors, [
      "CG-AL-E001: first line after the header must be 'description_sha: <64 lowercase hex>'",
      "CG-AL-E002: summary body is empty",
      `CG-AL-E003: summary body is ${
        SUMMARY_MAX_CHARS + 1
      } characters (max ${SUMMARY_MAX_CHARS})`,
      "CG-AL-E004: duplicate entry",
    ]);
  });
});
