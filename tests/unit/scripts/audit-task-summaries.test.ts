import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  auditSummaries,
  parseBaseline,
  sha256Hex,
} from "../../../scripts/audit-task-summaries.ts";
import { loadTaskManifest } from "../../../src/tasks/loader.ts";
import { parseTaskSummaries } from "../../../shared/task-summaries.ts";

const S = "c".repeat(64);
const entry = (id: string, sha = S) =>
  `## ${id}\ndescription_sha: ${sha}\nA summary.\n`;

Deno.test("sha256Hex matches the standard vector", async () => {
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

Deno.test("sha is taken over the parsed folded description, not raw YAML", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "CG-AL-E999.yml");
    await Deno.writeTextFile(
      path,
      [
        "id: CG-AL-E999",
        "prompt_template: code-gen.md",
        "fix_template: bugfix.md",
        "max_attempts: 2",
        "description: >-",
        "  Create a table called",
        '  "Widget" with two fields.',
        "expected:",
        "  compile: true",
        "metrics: [compile_pass]",
        "domains: [tables]",
      ].join("\n"),
    );
    const m = await loadTaskManifest(path);
    const folded = 'Create a table called "Widget" with two fields.';
    assertEquals(m.description, folded);
    assertEquals(await sha256Hex(m.description), await sha256Hex(folded));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("parseBaseline skips comments and blanks", () => {
  assertEquals(parseBaseline("# note\r\nCG-AL-E001\n\n  CG-AL-E002  \n"), [
    "CG-AL-E001",
    "CG-AL-E002",
  ]);
});

Deno.test("auditSummaries", async (t) => {
  const tasks = [
    { id: "CG-AL-E001", descriptionSha: S },
    { id: "CG-AL-E002", descriptionSha: S },
  ];

  await t.step("passes when every task is summarised or baselined", () => {
    assertEquals(
      auditSummaries({
        tasks,
        summaries: parseTaskSummaries(entry("CG-AL-E001")),
        baseline: ["CG-AL-E002"],
      }),
      [],
    );
  });

  await t.step("fails on a task neither summarised nor baselined", () => {
    assertEquals(
      auditSummaries({
        tasks,
        summaries: parseTaskSummaries(entry("CG-AL-E001")),
        baseline: [],
      }),
      ["CG-AL-E002: no summary; add one to site/catalog/task-summaries.md"],
    );
  });

  await t.step(
    "fails on a stale description_sha and names the current one",
    () => {
      const stale = "d".repeat(64);
      assertEquals(
        auditSummaries({
          tasks,
          summaries: parseTaskSummaries(entry("CG-AL-E001", stale)),
          baseline: ["CG-AL-E002"],
        }),
        [
          `CG-AL-E001: description changed; re-read the summary, update it if needed, then set description_sha to ${S}`,
        ],
      );
    },
  );

  await t.step("fails on an entry for a task that does not exist", () => {
    assertEquals(
      auditSummaries({
        tasks,
        summaries: parseTaskSummaries(
          entry("CG-AL-E001") + entry("CG-AL-E404"),
        ),
        baseline: ["CG-AL-E002"],
      }),
      ["CG-AL-E404: summary for a task that does not exist; remove the entry"],
    );
  });

  await t.step(
    "baseline ratchet: summarised or unknown ids must leave the baseline",
    () => {
      assertEquals(
        auditSummaries({
          tasks,
          summaries: parseTaskSummaries(entry("CG-AL-E001")),
          baseline: ["CG-AL-E001", "CG-AL-E002", "CG-AL-E404"],
        }),
        [
          "CG-AL-E001: has a summary; remove it from site/catalog/task-summaries.baseline.txt",
          "CG-AL-E404: baselined but no such task; remove it from site/catalog/task-summaries.baseline.txt",
        ],
      );
    },
  );

  await t.step("parser errors are audit failures", () => {
    assertEquals(
      auditSummaries({
        tasks,
        summaries: parseTaskSummaries(
          "## CG-AL-E001\ndescription_sha: nope\nx\n",
        ),
        baseline: ["CG-AL-E002"],
      }),
      [
        "CG-AL-E001: first line after the header must be 'description_sha: <64 lowercase hex>'",
        "CG-AL-E001: no summary; add one to site/catalog/task-summaries.md",
      ],
    );
  });
});

Deno.test("baseline never grows", async () => {
  // This number may only go down. New tasks need a summary, not a baseline line.
  const ids = parseBaseline(
    await Deno.readTextFile("site/catalog/task-summaries.baseline.txt"),
  );
  assert(ids.length <= 231, `baseline has ${ids.length} ids (max 231)`);
});
