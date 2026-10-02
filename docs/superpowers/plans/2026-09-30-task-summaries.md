# Task Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a short human-readable summary on each task page, kept outside the task-set hash, with a CI audit that makes drift from the model prompt impossible to miss.

**Architecture:** A pure parser in the repo-root `shared/` module (used by both runtimes) reads `site/catalog/task-summaries.md`. A Deno audit script compares each entry's `description_sha` with a SHA-256 of the task YAML's `description` and enforces a shrink-only baseline. The site bundles the file at build time with Vite `?raw`, adds `summary` to the task API, and the panel renders it above a collapsed "Exact model prompt".

**Tech Stack:** Deno 2 (audit, `@std/yaml`, `@std/fs`), SvelteKit 5 on Cloudflare Workers (site), vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-task-summaries-design.md`

## Global Constraints

- `tasks/**/*.yml` and `tests/al/**` are NOT edited by this plan (they are in the task-set hash).
- Summary body: 1 to 5 sentences, at most 600 characters.
- `description_sha` is 64 lowercase hex: SHA-256 of the UTF-8 `description` string exactly as `loadTaskManifest` (`src/tasks/loader.ts`) returns it.
- Summaries describe what a task covers, never which object/procedure/line is defective, what the defect is, the platform behaviour a trap relies on, or any hint the prompt withholds.
- No D1 table, no migration, no admin endpoint, no sync step.
- A task without a summary renders exactly as today.
- Do NOT run `deno fmt` on `site/` files (prettier owns them). Scope `deno fmt`/`deno check` to changed root files.
- No em dash characters in any file.
- Work on branch `feat/task-summaries` from local `master`.

## Review Focus

1. The summaries file saved with CRLF line endings (Windows checkout) must parse identically to LF. Task 1 tests it.
2. A `###` sub-heading or a line starting `##x` inside a summary body must not start a new entry; only `## <id>` does. Task 1 tests it.
3. A folded YAML description (`>-`, the style every task uses) must hash the parsed string, not the raw YAML text. Task 2 tests it through a fixture YAML.
4. A baselined task that later gets a summary but stays on the baseline must fail the audit (the ratchet). Task 2 tests it.
5. A summary entry whose body is empty or over 600 characters must fail the audit, not render a blank or huge block. Tasks 1 and 2 test it.

---

### Task 1: Shared summaries parser

**Files:**
- Create: `shared/task-summaries.ts`
- Create: `site/src/lib/shared/task-summaries.ts` (re-export)
- Test: `tests/unit/shared/task-summaries.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TaskSummaryEntry { id: string; descriptionSha: string; body: string }
  export interface TaskSummariesParse { entries: TaskSummaryEntry[]; errors: string[] }
  export const SUMMARY_MAX_CHARS = 600;
  export function parseTaskSummaries(markdown: string): TaskSummariesParse;
  ```

- [ ] **Step 1: Write the failing test**

`tests/unit/shared/task-summaries.test.ts`:

```ts
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
      `CG-AL-E003: summary body is ${SUMMARY_MAX_CHARS + 1} characters (max ${SUMMARY_MAX_CHARS})`,
      "CG-AL-E004: duplicate entry",
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test --allow-all tests/unit/shared/task-summaries.test.ts`
Expected: FAIL (module `shared/task-summaries.ts` not found).

- [ ] **Step 3: Implement**

`shared/task-summaries.ts`:

```ts
/**
 * Parser for site/catalog/task-summaries.md: human-readable task summaries
 * kept outside the task-set hash. Shared by the Deno audit
 * (scripts/audit-task-summaries.ts) and the site (bundled via Vite ?raw).
 * Pure string handling, no runtime-specific imports.
 * Spec: docs/superpowers/specs/2026-09-30-task-summaries-design.md
 */

export interface TaskSummaryEntry {
  id: string;
  descriptionSha: string;
  body: string;
}

export interface TaskSummariesParse {
  entries: TaskSummaryEntry[];
  errors: string[];
}

export const SUMMARY_MAX_CHARS = 600;

const HEADER = /^## (\S+)\s*$/;
const SHA_LINE = /^description_sha: ([0-9a-f]{64})\s*$/;

export function parseTaskSummaries(markdown: string): TaskSummariesParse {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: Array<{ id: string; lines: string[] }> = [];
  for (const line of lines) {
    const m = HEADER.exec(line);
    if (m) blocks.push({ id: m[1], lines: [] });
    else if (blocks.length > 0) blocks[blocks.length - 1].lines.push(line);
  }

  const entries: TaskSummaryEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if (seen.has(b.id)) {
      errors.push(`${b.id}: duplicate entry`);
      continue;
    }
    seen.add(b.id);
    const first = b.lines.findIndex((l) => l.trim() !== "");
    const sha = first === -1 ? null : SHA_LINE.exec(b.lines[first]);
    if (!sha) {
      errors.push(
        `${b.id}: first line after the header must be 'description_sha: <64 lowercase hex>'`,
      );
      continue;
    }
    const body = b.lines.slice(first + 1).join("\n").trim();
    if (body === "") {
      errors.push(`${b.id}: summary body is empty`);
      continue;
    }
    if (body.length > SUMMARY_MAX_CHARS) {
      errors.push(
        `${b.id}: summary body is ${body.length} characters (max ${SUMMARY_MAX_CHARS})`,
      );
      continue;
    }
    entries.push({ id: b.id, descriptionSha: sha[1], body });
  }
  return { entries, errors };
}
```

`site/src/lib/shared/task-summaries.ts` (same re-export pattern as `site/src/lib/shared/canonical.ts`):

```ts
export {
  parseTaskSummaries,
  SUMMARY_MAX_CHARS,
  type TaskSummaryEntry,
  type TaskSummariesParse,
} from "../../../../shared/task-summaries.ts";
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/shared/task-summaries.test.ts`
Expected: PASS (3 steps).
Then: `deno check shared/task-summaries.ts tests/unit/shared/task-summaries.test.ts && deno lint shared tests/unit/shared && deno fmt shared/task-summaries.ts tests/unit/shared/task-summaries.test.ts`

- [ ] **Step 5: Commit**

```bash
git add shared/task-summaries.ts site/src/lib/shared/task-summaries.ts tests/unit/shared/task-summaries.test.ts
git commit -m "feat(shared): task summaries parser"
```

---

### Task 2: Audit script, catalog files, CI

**Files:**
- Create: `scripts/audit-task-summaries.ts`
- Create: `site/catalog/task-summaries.md`
- Create: `site/catalog/task-summaries.baseline.txt`
- Modify: `deno.json` (tasks block, beside `"taxonomy-audit"` at line 34)
- Modify: `.github/workflows/ci.yml` (after the "Run taxonomy-audit" step, line 20-21)
- Test: `tests/unit/scripts/audit-task-summaries.test.ts`

**Interfaces:**
- Consumes: `parseTaskSummaries`, `TaskSummariesParse` (Task 1); `loadTaskManifest(path): Promise<TaskManifest>` from `src/tasks/loader.ts`.
- Produces:
  ```ts
  export async function sha256Hex(text: string): Promise<string>;
  export function parseBaseline(text: string): string[];
  export interface AuditInput {
    tasks: Array<{ id: string; descriptionSha: string }>;
    summaries: TaskSummariesParse;
    baseline: string[];
  }
  export function auditSummaries(input: AuditInput): string[]; // failure lines, empty = pass
  ```
- CLI: `deno task summary-audit` (audit), `--print-sha <task id>`, `--print-baseline` (ids of tasks without a summary, sorted, one per line).

- [ ] **Step 1: Write the failing test**

`tests/unit/scripts/audit-task-summaries.test.ts`:

```ts
import { assertEquals } from "@std/assert";
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
        "  \"Widget\" with two fields.",
        "expected:",
        "  compile: true",
        "metrics: [compile_pass]",
      ].join("\n"),
    );
    const m = await loadTaskManifest(path);
    assertEquals(m.description, 'Create a table called "Widget" with two fields.');
    assertEquals(await sha256Hex(m.description), await sha256Hex('Create a table called "Widget" with two fields.'));
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
      auditSummaries({ tasks, summaries: parseTaskSummaries(entry("CG-AL-E001")), baseline: [] }),
      ["CG-AL-E002: no summary; add one to site/catalog/task-summaries.md"],
    );
  });

  await t.step("fails on a stale description_sha and names the current one", () => {
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
  });

  await t.step("fails on an entry for a task that does not exist", () => {
    assertEquals(
      auditSummaries({
        tasks,
        summaries: parseTaskSummaries(entry("CG-AL-E001") + entry("CG-AL-E404")),
        baseline: ["CG-AL-E002"],
      }),
      ["CG-AL-E404: summary for a task that does not exist; remove the entry"],
    );
  });

  await t.step("baseline ratchet: summarised or unknown ids must leave the baseline", () => {
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
  });

  await t.step("parser errors are audit failures", () => {
    assertEquals(
      auditSummaries({
        tasks,
        summaries: parseTaskSummaries("## CG-AL-E001\ndescription_sha: nope\nx\n"),
        baseline: ["CG-AL-E002"],
      }),
      [
        "CG-AL-E001: first line after the header must be 'description_sha: <64 lowercase hex>'",
        "CG-AL-E001: no summary; add one to site/catalog/task-summaries.md",
      ],
    );
  });
});
```

Before relying on the fixture YAML, open `src/tasks/interfaces.ts` and adjust the fixture's fields so `parseTaskManifest` accepts it (the schema is the authority; keep the folded `description: >-` block exactly).

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/scripts/audit-task-summaries.test.ts`
Expected: FAIL (module `scripts/audit-task-summaries.ts` not found).

- [ ] **Step 3: Implement**

`scripts/audit-task-summaries.ts`:

```ts
/**
 * summary-audit: keeps site/catalog/task-summaries.md in step with the task
 * YAML descriptions it summarises. See
 * docs/superpowers/specs/2026-09-30-task-summaries-design.md.
 *
 *   deno task summary-audit                   audit (CI)
 *   deno task summary-audit --print-sha <id>  current description_sha
 *   deno task summary-audit --print-baseline  ids with no summary
 */
import { expandGlob } from "@std/fs";
import {
  parseTaskSummaries,
  type TaskSummariesParse,
} from "../shared/task-summaries.ts";
import { loadTaskManifest } from "../src/tasks/loader.ts";

const SUMMARIES = "site/catalog/task-summaries.md";
const BASELINE = "site/catalog/task-summaries.baseline.txt";

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseBaseline(text: string): string[] {
  return text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

export interface AuditInput {
  tasks: Array<{ id: string; descriptionSha: string }>;
  summaries: TaskSummariesParse;
  baseline: string[];
}

export function auditSummaries(input: AuditInput): string[] {
  const failures = [...input.summaries.errors];
  const taskSha = new Map(input.tasks.map((t) => [t.id, t.descriptionSha]));
  const summarised = new Map(input.summaries.entries.map((e) => [e.id, e.descriptionSha]));
  const baseline = new Set(input.baseline);

  for (const t of input.tasks) {
    const sha = summarised.get(t.id);
    if (sha === undefined) {
      if (!baseline.has(t.id)) {
        failures.push(`${t.id}: no summary; add one to ${SUMMARIES}`);
      }
    } else if (sha !== t.descriptionSha) {
      failures.push(
        `${t.id}: description changed; re-read the summary, update it if needed, then set description_sha to ${t.descriptionSha}`,
      );
    }
  }
  for (const id of summarised.keys()) {
    if (!taskSha.has(id)) {
      failures.push(`${id}: summary for a task that does not exist; remove the entry`);
    }
  }
  for (const id of input.baseline) {
    if (summarised.has(id)) {
      failures.push(`${id}: has a summary; remove it from ${BASELINE}`);
    } else if (!taskSha.has(id)) {
      failures.push(`${id}: baselined but no such task; remove it from ${BASELINE}`);
    }
  }
  return failures;
}

async function loadTasks(): Promise<Array<{ id: string; descriptionSha: string }>> {
  const out: Array<{ id: string; descriptionSha: string }> = [];
  for await (const f of expandGlob("tasks/**/*.yml")) {
    if (!f.isFile) continue;
    const m = await loadTaskManifest(f.path);
    out.push({ id: m.id, descriptionSha: await sha256Hex(m.description) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function readOr(path: string, fallback: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return fallback;
    throw e;
  }
}

if (import.meta.main) {
  const tasks = await loadTasks();
  const summaries = parseTaskSummaries(await readOr(SUMMARIES, ""));
  const printSha = Deno.args.indexOf("--print-sha");
  if (printSha !== -1) {
    const id = Deno.args[printSha + 1];
    const t = tasks.find((x) => x.id === id);
    if (!t) {
      console.error(`No task ${id}`);
      Deno.exit(1);
    }
    console.log(t.descriptionSha);
    Deno.exit(0);
  }
  if (Deno.args.includes("--print-baseline")) {
    const done = new Set(summaries.entries.map((e) => e.id));
    for (const t of tasks) if (!done.has(t.id)) console.log(t.id);
    Deno.exit(0);
  }
  const baseline = parseBaseline(await readOr(BASELINE, ""));
  const failures = auditSummaries({ tasks, summaries, baseline });
  if (failures.length > 0) {
    for (const f of failures) console.error(`[FAIL] ${f}`);
    Deno.exit(1);
  }
  console.log(
    `[OK] summary-audit: ${summaries.entries.length} summarised, ${baseline.length} baselined, ${tasks.length} tasks`,
  );
}
```

`deno.json` tasks block, after `"taxonomy-audit"`:

```json
    "summary-audit": "deno run --allow-read scripts/audit-task-summaries.ts",
```

`.github/workflows/ci.yml`, after the taxonomy-audit step:

```yaml
      - name: Run summary-audit
        run: deno task summary-audit
```

`site/catalog/task-summaries.md` (pilot entry; the X185 body must follow the Global Constraints content rules):

```markdown
# Task summaries

Human-readable summaries shown on the site's task pages, above the exact model
prompt. They are outside the task-set hash, so editing them never forces a
re-bench. Rules: docs/superpowers/specs/2026-09-30-task-summaries-design.md.
Get a task's description_sha with `deno task summary-audit --print-sha <id>`.

## CG-AL-X185
description_sha: <paste the output of: deno task summary-audit --print-sha CG-AL-X185>

A composite diagnose task over four independent parts of one application: a
wire-format converter for an external service, a nightly legacy-amount import,
a travel-allowance calculator, and a cross-company meter-reading consolidator.
The report gives only one vague symptom, and the model must restore every
stated contract.
```

Generate the baseline. First replace the X185 placeholder with the real hash from `--print-sha` (an entry with a malformed sha line is skipped by the parser, so X185 would otherwise land on the baseline), then:

```bash
{ echo "# Existing tasks without a summary. Shrink-only: remove ids as they get summaries. Never add new tasks here."; deno run --allow-read scripts/audit-task-summaries.ts --print-baseline; } > site/catalog/task-summaries.baseline.txt
```

- [ ] **Step 4: Run to verify it passes, then run the real audit**

Run: `deno test --allow-all tests/unit/scripts/audit-task-summaries.test.ts`
Expected: PASS.
Run: `deno task summary-audit`
Expected: `[OK] summary-audit: 1 summarised, 231 baselined, 232 tasks` (the counts must add up to the task count; 232 at the time of writing).
Then: `deno check scripts/audit-task-summaries.ts tests/unit/scripts/audit-task-summaries.test.ts && deno lint scripts tests/unit/scripts && deno fmt scripts/audit-task-summaries.ts tests/unit/scripts/audit-task-summaries.test.ts`

- [ ] **Step 5: Commit**

```bash
git add scripts/audit-task-summaries.ts tests/unit/scripts/audit-task-summaries.test.ts site/catalog/task-summaries.md site/catalog/task-summaries.baseline.txt deno.json .github/workflows/ci.yml
git commit -m "feat(audit): summary-audit keeps task summaries in step with descriptions"
```

---

### Task 3: Site: `summary` in the task API and panel

**Files:**
- Create: `site/src/lib/server/task-summaries.ts`
- Modify: `site/src/lib/shared/api-types.ts:896-904` (`TaskDetail`)
- Modify: `site/src/routes/api/v1/tasks/[...id]/+server.ts:76-83` (response object)
- Modify: `site/src/lib/components/domain/TaskDetailPanel.svelte:44-49`
- Test: `site/tests/api/tasks.test.ts`, `site/src/lib/components/domain/TaskDetailPanel.test.svelte.ts`

**Interfaces:**
- Consumes: `parseTaskSummaries` via `$lib/shared/task-summaries` (Task 1); `site/catalog/task-summaries.md` with the CG-AL-X185 entry (Task 2).
- Produces: `taskSummary(id: string): string | null`; `TaskDetail.summary: string | null`.

- [ ] **Step 1: Write the failing tests**

In `site/tests/api/tasks.test.ts`, read the file first and reuse its seeding helpers. Add a test that seeds a current-set task with id `CG-AL-X185` and one with another id (for example `CG-AL-E001`), then:

```ts
import { taskSummary } from "../../src/lib/server/task-summaries";

it("returns the catalog summary for a summarised task and null otherwise", async () => {
  const x = await (await SELF.fetch("https://x/api/v1/tasks/CG-AL-X185")).json() as { summary: string | null };
  expect(x.summary).toBe(taskSummary("CG-AL-X185"));
  expect(x.summary).not.toBeNull();
  const e = await (await SELF.fetch("https://x/api/v1/tasks/CG-AL-E001")).json() as { summary: string | null };
  expect(e.summary).toBeNull();
});
```

In `TaskDetailPanel.test.svelte.ts` (the fixture `t` at the top gains `summary: null`), add:

```ts
it("shows the summary and folds the exact prompt when a summary exists", () => {
  render(TaskDetailPanel, { props: { task: { ...t, summary: "Human summary." } } });
  expect(screen.getByText("Human summary.")).toBeTruthy();
  const details = document.querySelector("details.prompt");
  expect(details).not.toBeNull();
  expect(details!.hasAttribute("open")).toBe(false);
  expect(details!.querySelector("summary")!.textContent).toContain("Exact model prompt");
  expect(details!.textContent).toContain("Test description");
});

it("renders the description as today when there is no summary", () => {
  render(TaskDetailPanel, { props: { task: t } });
  expect(document.querySelector("details.prompt")).toBeNull();
  expect(screen.getByText("Test description")).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify they fail**

Run (from `site/`): `npx vitest run --config vitest.unit.config.ts src/lib/components/domain/TaskDetailPanel.test.svelte.ts`
Expected: FAIL (no `details.prompt`).
Run: `npm run build && npx vitest run tests/api/tasks.test.ts`
Expected: FAIL (`summary` undefined / module not found).

- [ ] **Step 3: Implement**

`site/src/lib/server/task-summaries.ts`:

```ts
/**
 * Human-readable task summaries, bundled at build time from
 * site/catalog/task-summaries.md (Vite ?raw, same pattern as the changelog in
 * routes/api/v1/summary/+server.ts). Outside the task-set hash; a redeploy
 * publishes edits. Malformed entries are skipped here and fail
 * `deno task summary-audit` in CI.
 */
import summariesMarkdown from "../../../catalog/task-summaries.md?raw";
import { parseTaskSummaries } from "$lib/shared/task-summaries";

const SUMMARIES: Map<string, string> = new Map(
  parseTaskSummaries(summariesMarkdown).entries.map((e) => [e.id, e.body]),
);

export function taskSummary(id: string): string | null {
  return SUMMARIES.get(id) ?? null;
}
```

`api-types.ts`, in `TaskDetail` after `manifest`:

```ts
  /** Human-readable summary from site/catalog/task-summaries.md; null when the task has none. Not the model prompt. */
  summary: string | null;
```

Task route: import `taskSummary` from `$lib/server/task-summaries` and add `summary: taskSummary(task.id),` after `manifest,` in the `cachedJson` body. (`cachedJson` is ETag-based with `private, max-age=60`, not an epoch-keyed named cache, so no `CACHE_VERSION` bump is needed. Confirm this by reading `site/src/lib/server/cache.ts` before skipping the bump.)

`TaskDetailPanel.svelte`: replace the `{#if manifest.description}` section (lines 44-49) with:

```svelte
{#if task.summary}
  <section class="desc">
    <h2>Summary</h2>
    <div class="body"><MarkdownRenderer source={task.summary} /></div>
    {#if manifest.description}
      <details class="prompt">
        <summary>Exact model prompt</summary>
        <div class="body"><MarkdownRenderer source={reflowDescription(manifest.description)} /></div>
      </details>
    {/if}
  </section>
{:else if manifest.description}
  <section class="desc">
    <h2>Description</h2>
    <div class="body"><MarkdownRenderer source={reflowDescription(manifest.description)} /></div>
  </section>
{/if}
```

Add to the component `<style>`, reusing existing tokens:

```css
  .prompt { margin-top: var(--space-4); }
  .prompt summary { cursor: pointer; color: var(--text-muted); font-size: var(--text-sm); }
```

Fix every other `TaskDetail` object literal `npm run check` flags by adding `summary: null`.

- [ ] **Step 4: Run to verify they pass**

Run (from `site/`): `npm run check`, then `npx vitest run --config vitest.unit.config.ts`, then `npm run build && npm run test:main`.
Expected: 0 check errors; all pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/task-summaries.ts site/src/lib/shared/api-types.ts "site/src/routes/api/v1/tasks/[...id]/+server.ts" site/src/lib/components/domain/TaskDetailPanel.svelte site/src/lib/components/domain/TaskDetailPanel.test.svelte.ts site/tests/api/tasks.test.ts
git commit -m "feat(site): task page shows the human summary above the exact model prompt"
```

(Also add any other file you touched for `summary: null`.)

---

### Task 4: Authoring requirement

**Files:**
- Modify: `CLAUDE.md` (section "Writing Task Specifications (YAML)"). NOTE: the owner has an uncommitted edit in this file; stage ONLY your hunk with `git add -p CLAUDE.md`, or stop and report if the hunks cannot be separated.
- Modify: `.claude/commands/create-task.md`
- Modify: `.claude/skills/extract-trap-task/SKILL.md`
- Modify (local only, untracked by design): `.claude/agents/al-test-auditor.md`

- [ ] **Step 1: Edit**

`CLAUDE.md`, add a subsection at the end of "Writing Task Specifications (YAML)":

```markdown
### Every Task Needs a Human Summary

The `description` is the model prompt and is hashed; the site shows a separate
human summary from `site/catalog/task-summaries.md`. Every new task needs an entry:

- `## <task id>`, then `description_sha: <hash>` from
  `deno task summary-audit --print-sha <task id>`, then 1 to 5 plain sentences
  (max 600 characters).
- Say what the task covers (kind, objects, what is asked). Never name the defect,
  its location, the platform behaviour a trap relies on, or any hint the prompt
  withholds. The site is public.
- Never add a new task to `site/catalog/task-summaries.baseline.txt`.
- Editing a description makes `deno task summary-audit` fail until the summary is
  re-read and its `description_sha` updated.
```

`.claude/commands/create-task.md` and `.claude/skills/extract-trap-task/SKILL.md`: in each, at the step where the task YAML and test are finalised (before commit), add a step: "Write the task's summary entry in `site/catalog/task-summaries.md` per CLAUDE.md 'Every Task Needs a Human Summary', then run `deno task summary-audit` and confirm it passes."

`.claude/agents/al-test-auditor.md`: add to its checklist: "Check the task's entry in `site/catalog/task-summaries.md` exists and does not reveal the defect, its location, the platform behaviour a trap relies on, or anything the description withholds."

- [ ] **Step 2: Verify**

Run: `deno task summary-audit` (still passes) and `git diff --stat` (only the intended files; `.claude/agents/` does not appear because it is gitignored).

- [ ] **Step 3: Commit**

```bash
git add -p CLAUDE.md
git add .claude/commands/create-task.md .claude/skills/extract-trap-task/SKILL.md
git commit -m "docs: new tasks require a human summary (summary-audit)"
```

---

### Task 5: Verify and hand off

- [ ] **Step 1:** From repo root: `deno task summary-audit`, `deno test --allow-all tests/unit/shared/task-summaries.test.ts tests/unit/scripts/audit-task-summaries.test.ts`.
- [ ] **Step 2:** From `site/`: `npm run check && npm run build && npm run test:main && npm run test:build`.
- [ ] **Step 3:** Dispatch the `worker-pitfall-reviewer` agent on `git diff master...feat/task-summaries -- site`.
- [ ] **Step 4:** Show the owner the X185 pilot summary text for review against the content rules. Merge and deploy (`cd site && npm run deploy`, no migration) only on the owner's explicit go.
- [ ] **Step 5:** After deploy: `curl -s https://ai.sshadows.dk/api/v1/tasks/CG-AL-X185 | jq .summary` returns the pilot text; `/tasks/CG-AL-X185` shows the summary with the prompt collapsed; `/tasks/CG-AL-E001` looks as before.

Backfill (the composites first) is follow-up content work in batches, each removing its ids from the baseline, outside this plan.
