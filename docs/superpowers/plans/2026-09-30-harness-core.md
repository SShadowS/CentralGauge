# Harness Bench Core, Part 1 (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the parts of Harness Bench M1 that do not depend on the M0 spike findings: task.yml loading, hashing and comparability identities, immutable records, the primary-metric statistics and a console + JSON report, so lane-infra can start on 2026-09-30 while M0-08 is still open.

**Architecture:** A new `src/harness/` module of small pure files (one responsibility each), plus one Cliffy command group `centralgauge harness` with `validate` and `report`. Everything is file-in, file-out: YAML under `harness-tasks/` and `harness/`, JSON records under `results/harness/`. Nothing in this part starts a process other than `git rev-parse`, and nothing touches Docker or a BC container.

**Tech Stack:** Deno + TypeScript, Zod 4 (`npm:zod@^4.4.3`), `@std/yaml`, `@std/fs`, `@std/path`, `@std/fmt/colors`, Cliffy `@cliffy/command@1.2.1`, git on PATH.

**Spec:** `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (1a) and `docs/superpowers/specs/2026-09-24-harness-refapp-design.md` (1b). Reviewer input: `.panel/harness-spec-review-gpt6astra.md`. Style and roadmap: `docs/superpowers/plans/2026-09-24-harness-bench-spike.md`.

## Global Constraints

- No container, Docker or BC operation in any task. Every test in this plan runs without a container, so it is safe while a bench is live (it never touches `tests/unit/container`).
- Run tests as `deno test --allow-all <file>`. Never `--parallel`. Do not run the full `deno task test:unit` while a bench is live (`find results/.bench-running.json -mmin -2` prints a path).
- After each task: `deno check`, `deno lint`, `deno fmt` on the files that task touched only (CRLF/LF drift makes directory-wide fmt rewrite unrelated files). Never `deno fmt` under `site/`.
- Zod 4 idioms: `z.strictObject` (unknown keys are errors, spec 1b section 6), `z.iso.datetime()`, `z.uuid()`, `ctx.addIssue({ code: "custom", ... })`. `exactOptionalPropertyTypes` is on: an optional field that may receive `undefined` is typed `x?: T | undefined`.
- Import order (CLAUDE.md): `@std/...`, then third-party (`zod`, `@cliffy/...`), then project type imports, then project implementation imports, then relative imports.
- Console output uses `@std/fmt/colors` with `[OK]` / `[FAIL]` tags, never emoji.
- Model ids are never hardcoded in code. Test fixtures use the placeholder `anthropic/model-a`.
- ID bands (spec 1b section 4): visible tests 80000-84999, hidden oracles 85000-89999, 75000-79999 reserved.
- Records are immutable (spec 1a section 6): write-once files, a second write of the same record is an error.
- Hashing rules carry a version (spec 1a section 4). `HASH_RULES_VERSION = "hr1"`. Any change to what is hashed, or how, bumps it and updates the golden values in `tests/unit/harness/hash.test.ts` in the same commit.
- Every YAML or JSON load validates with Zod and fails with a `ValidationError` naming the file. A silent load failure is a bug (CLAUDE.md, Benchmark Tasks).
- No em dash in any committed text.
- Window: M1 runs 2026-09-30 to 10-08. This part is about 3 days for one lane (lane-infra); Part 2 starts after M0-08.
- After the last task, run `graphify update .` (CLAUDE.md, graphify).

## Review Focus

1. **A task.yml with a typo'd key, a duplicate key or a quoted number loads anyway.** Expected: `ValidationError` naming the file and the field; a task-set load lists every broken task, not only the first. Pinned in M1-01 (`rejects unknown key`, `duplicate key`, `a string where a number belongs`, `reports every broken task at once`).
2. **A Windows checkout (CRLF) and a Linux checkout (LF) of the same refapp or task give different hashes,** so the same task looks like two tasks. Expected: identical hashes. Pinned in M1-02 (`golden value, CRLF-invariant`).
3. **An oracle fix makes old executions look like they saw different inputs,** or `touches`/`coupling` edits force a re-bench. Expected: oracle edits move only the oracle hash, metadata moves nothing. Pinned in M1-04 (`oracle edit moves only the oracle hash`, `metadata and naive/ edits move nothing`), and M1-08 (`rejudge wins`).
4. **An arm that solved nothing reports `$Infinity` or `$0` per solved task,** or a CI that includes zero reads as "equal". Expected: `n/a`, and "not distinguishable". Pinned in M1-06 (`no solved task gives null`, `identical arms are not distinguishable`) and M1-09 (`never says equal`, `no solved task shows n/a`).
5. **A resumed or re-run command overwrites an existing record.** Expected: `ValidationError` "record is immutable". Pinned in M1-07 (`round trip, write-once`).

## Reuse

Reused as-is:
- `shared/canonical.ts` `canonicalJSON`: sorted keys, rejects `undefined` and non-finite numbers. The base of every harness hash.
- `src/ingest/catalog/task-set-hash.ts` `TEXT_EXTENSIONS`: which files get CRLF normalization, so harness and leaderboard hashing agree on "text".
- `src/errors.ts` `ValidationError`, `ConfigurationError`, `CentralGaugeError`.
- `cli/commands/report/stats-calculator.ts` `percentile` (linear interpolation, numpy default) for bootstrap interval ends.
- `jsr:@std/encoding@^1.0.5/hex` `encodeHex`, as `task-set-hash.ts` already imports it.
- The `safeParse` plus issue-list error shape of `src/tasks/interfaces.ts` `parseTaskManifest`.

Deliberately not reused:
- `computeTaskSetHash`: scoped to `tasks/` and `tests/al/`, strips `provenance:` blocks, and any change to it moves the leaderboard `task_sets.hash`. Its `collectFiles` is private and coupled to those rules.
- `src/stats/hasher.ts`: truncates to 16 hex chars and serves report-db diagnostics.
- `src/utils/harness-fingerprint.ts` `hashFiles`: text-only reads, no skip rules, no reparse-point refusal.
- `wilsonInterval` and `costPerPass`: pooled over executions; spec 1a section 9 requires task-level inference with equal task weights.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/harness/yaml.ts` | read YAML + Zod, loud errors | M1-01 |
| `src/harness/task.ts` | task.yml schema, `loadTask`, `loadTaskSet` | M1-01 |
| `src/harness/hash.ts` | `HASH_RULES_VERSION`, `hashJson`, `hashFile`, `listTree`, `hashTree` | M1-02 |
| `src/harness/config.ts` | harness config and experiment schemas, loaders, `effectiveLimits` | M1-03 |
| `src/harness/identity.ts` | refapp resolution, visible and oracle hashes, task-set identity, symbols lock | M1-04 |
| `src/harness/manifest.ts` | resolved manifest, component hashes, `vary` enforcement | M1-05 |
| `src/harness/stats.ts` | cells, cost per solved task, pass rate, pass^k, paired task bootstrap | M1-06 |
| `src/harness/records.ts` | execution, artifact, judgment, campaign schemas, `planBlocks`, `RecordStore` | M1-07 |
| `src/harness/outcome.ts` | termination rules, records to cells | M1-08 |
| `src/harness/report.ts` | `buildReport` (JSON shape), `renderReport` (console) | M1-09 |
| `cli/commands/harness-command.ts` | `harness validate`, `harness report` | M1-10 |
| `tests/unit/harness/*.test.ts`, `tests/unit/harness/fixtures.ts` | unit tests and record builders | all |

On-disk layout this part defines (spec 1a section 3):

```
harness-tasks/
  refapp/                         git-tagged versions (refapp-v1 ...)
  tasks/HX-001/task.yml ...       spec 1b section 5
  symbols.lock.json               .alpackages manifest (written in Part 2)
harness/
  configs/<id>.yml
  experiments/<id>.yml
  bundles/<name>/...
results/harness/                  gitignored via results/
  campaigns/<campaign-id>.json
  executions/<campaign-id>/<execution-id>.json
  artifacts/<artifact-hash>.json
  judgments/<artifact-hash>/<judgment-id>.json
```

## Decisions argued from the spec

- **Execution = attempt.** Spec 1a section 6 puts "repeat index, attempt number" on the execution record, and section 8 says a rerun adds an execution. So there is no separate attempt record: a cell is (campaign, task, repeat, arm) and holds 1..n executions.
- **Termination, verdict and validity are separate fields** (D18, section 8). Verdict lives on the judgment, termination and validity on the execution; `outcomePolicy` maps termination to judge/retry exactly as the section 8 bullets say.
- **Every attempt's spend counts** (section 9 item 2, D18): a cell's cost is the sum of all its executions' `telemetry.cost_usd`, including setup failures and retries.
- **Primary metric exclusion is per cell** (section 5 metrics contract): a cell whose cost is unknown (`null`, never 0, D8) is left out of cost per solved task and counted. It still counts for pass rate.
- **Task-level inference, equal task weight** (section 9): per task and arm, mean pass and mean cost over eligible repeats; cost per solved task = sum of per-task mean cost / sum of per-task mean pass. Arms are compared with a paired bootstrap that resamples tasks and keeps each task's repeats together. A CI that contains zero prints "not distinguishable", never "equal".
- **Visible vs oracle hash** (section 6, 1b section 7): visible = prompt, attachments, refapp tree, overlay, symbols, agent-visible fields (`id`, `source`, `limits`); oracle = oracle/, mutants/, correct/, `kind`, `scorers`, `pass_to_pass`, `fail_to_pass`, `mutants`. `touches`, `coupling`, `contamination`, `naive/` are in neither.
- **Refapp identity is the git tree id** of `harness-tasks/refapp` at the resolved commit (1b section 5: tags resolve to an immutable commit). The tree id is content-addressed, so it is the "resolved refapp commit's source" hash without re-walking files.
- **Manifest identity excludes the config name** (section 4: "the manifest hash is the config identity"): two configs with identical content are the same arm.
- **Runtime facts are inputs.** Image digest, backend version, MCP/LSP versions and tool-schema hashes, and provider routes come from Part 2; `resolveManifest` takes them as a `RuntimeFacts` argument and refuses a named MCP/LSP with no facts.
- **Observed-manifest checks wait for Part 2** (section 4, end-of-run completion): what a harness reports as "loaded" is a spike finding.

---

### Task M1-01: task.yml schema and loader

Spec 1b section 6 (schema, "unknown keys are an error"), section 4 (ID bands), section 5 (folder layout), 1a section 7 (test-authoring needs `correct/`). Cross-field rules pin the scorer contract so a malformed task fails at load, not mid-campaign.

**Deps:** none.

**Files:**
- Create: `src/harness/yaml.ts`
- Create: `src/harness/task.ts`
- Test: `tests/unit/harness/task.test.ts`

**Interfaces:**
- Produces: `readYaml<T extends z.ZodType>(path: string, schema: T): Promise<z.output<T>>`; `HarnessTaskSchema`, `type HarnessTask`, `TaskLimitsSchema`, `MODULES`, `SCORERS`, `TASK_KINDS`; `interface LoadedTask { task: HarnessTask; dir: string }`; `loadTask(dir: string): Promise<LoadedTask>`; `loadTaskSet(tasksDir: string): Promise<LoadedTask[]>` (sorted by id).

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/task.test.ts`:

```typescript
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { loadTask, loadTaskSet } from "../../../src/harness/task.ts";
import { ValidationError } from "../../../src/errors.ts";

const VALID = `id: HX-001
refapp_version: refapp-v1
kind: feature
prompt: prompt.md
touches: [Rental, Fleet]
coupling: [events]
source: refapp
scorers: [build, pass_to_pass, fail_to_pass]
pass_to_pass:
  - { codeunit: 80010, procedures: [RentalCheckoutPostsLedger] }
fail_to_pass:
  depends_on: [Rental, Fleet]
  tests:
    - { codeunit: 85001, procedures: [DamageBlocksCheckout] }
limits: { timeout_min: 20 }
`;

async function makeTask(
  root: string,
  id: string,
  yml: string,
  files: string[] = ["prompt.md", "oracle/x.al"],
): Promise<string> {
  const dir = join(root, id);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, "task.yml"), yml);
  for (const f of files) {
    await Deno.mkdir(join(dir, f, ".."), { recursive: true });
    await Deno.writeTextFile(join(dir, f), "x");
  }
  return dir;
}

Deno.test("loadTask: valid task gets defaults", async () => {
  const root = await Deno.makeTempDir();
  const { task } = await loadTask(await makeTask(root, "HX-001", VALID));
  assertEquals(task.attachments, []);
  assertEquals(task.mutants, []);
  assertEquals(task.contamination, null);
  assertEquals(task.limits, { timeout_min: 20 });
});

const BAD: Array<[string, string, string]> = [
  ["unknown key", VALID + "hint: be careful\n", "hint"],
  ["duplicate key", VALID + "kind: bugfix\n", "duplicated key"],
  ["empty file", "", "(root)"],
  [
    "oracle codeunit in visible band",
    VALID.replace("85001", "80001"),
    "fail_to_pass.tests.0.codeunit",
  ],
  [
    "visible test in reserved band",
    VALID.replace("80010", "75010"),
    "pass_to_pass.0.codeunit",
  ],
  [
    "missing build scorer",
    VALID.replace("[build, pass_to_pass", "[pass_to_pass"),
    "build scorer is required",
  ],
  [
    "fail_to_pass scorer without block",
    VALID.replace(/fail_to_pass:\n[\s\S]*?DamageBlocksCheckout\] }\n/, ""),
    "go together",
  ],
  [
    "mutant_kill on a feature",
    VALID.replace("fail_to_pass]", "fail_to_pass, mutant_kill]"),
    "test-authoring only",
  ],
  [
    "git source (interface only in 1a)",
    VALID.replace("source: refapp", "source: git"),
    "source",
  ],
  [
    "path escaping the task folder",
    VALID.replace("prompt: prompt.md", "prompt: ../x.md"),
    "relative path",
  ],
  [
    "a string where a number belongs",
    VALID.replace("timeout_min: 20", 'timeout_min: "20"'),
    "limits.timeout_min",
  ],
];

for (const [name, yml, needle] of BAD) {
  Deno.test(`loadTask: rejects ${name}`, async () => {
    const root = await Deno.makeTempDir();
    const err = await assertRejects(
      async () => await loadTask(await makeTask(root, "HX-001", yml)),
      ValidationError,
    );
    assertStringIncludes(err.message, needle);
  });
}

Deno.test("loadTask: id must match folder, files must exist", async () => {
  const root = await Deno.makeTempDir();
  const dir = await makeTask(root, "HX-002", VALID, []);
  const err = await assertRejects(() => loadTask(dir), ValidationError);
  assertStringIncludes(err.message, "does not match folder HX-002");
  assertStringIncludes(err.message, "prompt not found");
  assertStringIncludes(err.message, "oracle/ folder");
});

Deno.test("loadTask: test-authoring needs correct/ and its mutant folders", async () => {
  const root = await Deno.makeTempDir();
  const yml = `id: HX-003
refapp_version: refapp-v1
kind: test-authoring
prompt: prompt.md
source: refapp
scorers: [build, mutant_kill]
mutants: [off-by-one]
`;
  const dir = await makeTask(root, "HX-003", yml, ["prompt.md"]);
  const err = await assertRejects(() => loadTask(dir), ValidationError);
  assertStringIncludes(err.message, "correct/ folder");
  assertStringIncludes(err.message, "mutants/off-by-one");
});

Deno.test("loadTaskSet: sorted, and reports every broken task at once", async () => {
  const root = await Deno.makeTempDir();
  await makeTask(root, "HX-002", VALID.replace("HX-001", "HX-002"));
  await makeTask(root, "HX-001", VALID);
  assertEquals(
    (await loadTaskSet(root)).map((t) => t.task.id),
    ["HX-001", "HX-002"],
  );
  await makeTask(root, "HX-003", VALID.replace("HX-001", "HX-003") + "x: 1\n");
  await makeTask(root, "HX-004", "id: [");
  const err = await assertRejects(() => loadTaskSet(root), ValidationError);
  assertEquals(err.errors.length, 2);
});

Deno.test("loadTaskSet: empty folder is an error", async () => {
  await assertRejects(
    async () => await loadTaskSet(await Deno.makeTempDir()),
    ValidationError,
    "No tasks found",
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/task.test.ts`
Expected: FAIL, `Module not found ".../src/harness/task.ts"`.

- [ ] **Step 3: Implement**

`src/harness/yaml.ts`:

```typescript
import { parse } from "@std/yaml";
import { basename } from "@std/path";
import type { z } from "zod";
import { ValidationError } from "../errors.ts";

/**
 * Read a YAML file and validate it with a Zod schema. Every failure (missing
 * file, YAML syntax, duplicate key, schema issue) throws a ValidationError
 * that names the file, so a bad file can never load silently.
 */
export async function readYaml<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = parse(await Deno.readTextFile(path));
  } catch (err) {
    const msg = err instanceof Error
      ? err.message.split("\n")[0]!
      : String(err);
    throw new ValidationError(`${path}: ${msg}`, [msg]);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues.map((i) =>
      `${i.path.join(".") || "(root)"}: ${i.message}`
    );
    throw new ValidationError(
      `Invalid ${basename(path)} at ${path}:\n  ${errors.join("\n  ")}`,
      errors,
    );
  }
  return result.data;
}
```

`src/harness/task.ts`:

```typescript
/**
 * Harness task.yml schema and loader (spec 1b sections 4-6, spec 1a section 7).
 * Unknown keys are an error; cross-field rules and file existence are checked
 * at load, and a task set load reports every broken task at once.
 */

import { isAbsolute, join, normalize } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { readYaml } from "./yaml.ts";

export const MODULES = [
  "Core",
  "Fleet",
  "Rental",
  "Leasing",
  "Integration",
  "Reporting",
  "Test",
] as const;
export const SCORERS = [
  "build",
  "pass_to_pass",
  "fail_to_pass",
  "mutant_kill",
] as const;
export const TASK_KINDS = [
  "feature",
  "bugfix",
  "refactor",
  "test-authoring",
] as const;

/** Spec 1b section 4: visible tests 80000-84999, hidden oracles 85000-89999. */
const VISIBLE_TEST_BAND = [80000, 84999] as const;
const ORACLE_BAND = [85000, 89999] as const;

const relPath = z.string().min(1).refine(
  (p) =>
    !isAbsolute(p) &&
    !normalize(p).replaceAll("\\", "/").split("/").includes(".."),
  "must be a relative path inside the task folder",
);

const testRef = (band: readonly [number, number]) =>
  z.strictObject({
    codeunit: z.number().int().min(band[0]).max(band[1]),
    procedures: z.array(z.string().min(1)).min(1),
  });

export const TaskLimitsSchema = z.strictObject({
  timeout_min: z.number().int().positive().optional(),
  max_budget_usd: z.number().positive().optional(),
});

export const HarnessTaskSchema = z.strictObject({
  id: z.string().regex(/^HX-\d{3}$/, "must look like HX-001"),
  refapp_version: z.string().min(1),
  kind: z.enum(TASK_KINDS),
  prompt: relPath,
  touches: z.array(z.enum(MODULES)).default([]),
  coupling: z.array(z.string().min(1)).default([]),
  source: z.literal("refapp"),
  attachments: z.array(relPath).default([]),
  scorers: z.array(z.enum(SCORERS)).min(1),
  pass_to_pass: z.array(testRef(VISIBLE_TEST_BAND)).default([]),
  fail_to_pass: z.strictObject({
    depends_on: z.array(z.enum(MODULES)).min(1),
    tests: z.array(testRef(ORACLE_BAND)).min(1),
  }).nullable().default(null),
  mutants: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/)).default([]),
  contamination: z.null().default(null),
  limits: TaskLimitsSchema.default({}),
}).superRefine((t, ctx) => {
  const has = (s: (typeof SCORERS)[number]) => t.scorers.includes(s);
  const issue = (message: string, path: string[]) =>
    ctx.addIssue({ code: "custom", message, path });
  if (new Set(t.scorers).size !== t.scorers.length) {
    issue("duplicate scorer", ["scorers"]);
  }
  if (!has("build")) issue("build scorer is required", ["scorers"]);
  if (has("pass_to_pass") !== t.pass_to_pass.length > 0) {
    issue("pass_to_pass scorer and pass_to_pass tests go together", [
      "pass_to_pass",
    ]);
  }
  if (has("fail_to_pass") !== (t.fail_to_pass !== null)) {
    issue("fail_to_pass scorer and fail_to_pass block go together", [
      "fail_to_pass",
    ]);
  }
  const testAuthoring = t.kind === "test-authoring";
  if (has("mutant_kill") !== testAuthoring) {
    issue("mutant_kill is the scorer for kind test-authoring only", [
      "scorers",
    ]);
  }
  if (!testAuthoring && t.mutants.length > 0) {
    issue("mutants are for kind test-authoring only", ["mutants"]);
  }
});

export type HarnessTask = z.output<typeof HarnessTaskSchema>;

export interface LoadedTask {
  task: HarnessTask;
  /** Task folder, e.g. <repo>/harness-tasks/tasks/HX-001. */
  dir: string;
}

async function isKind(p: string, kind: "file" | "dir"): Promise<boolean> {
  try {
    const s = await Deno.stat(p);
    return kind === "file" ? s.isFile : s.isDirectory;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

/** Load and validate one task folder. Throws ValidationError listing all problems. */
export async function loadTask(dir: string): Promise<LoadedTask> {
  const ymlPath = join(dir, "task.yml");
  const task = await readYaml(ymlPath, HarnessTaskSchema);
  const errors: string[] = [];
  const folder = dir.replaceAll("\\", "/").split("/").pop();
  if (task.id !== folder) {
    errors.push(`id ${task.id} does not match folder ${folder}`);
  }
  if (!await isKind(join(dir, task.prompt), "file")) {
    errors.push(`prompt not found: ${task.prompt}`);
  }
  for (const a of task.attachments) {
    if (!await isKind(join(dir, a), "file")) {
      errors.push(`attachment not found: ${a}`);
    }
  }
  if (task.fail_to_pass && !await isKind(join(dir, "oracle"), "dir")) {
    errors.push("fail_to_pass needs an oracle/ folder");
  }
  if (
    task.kind === "test-authoring" && !await isKind(join(dir, "correct"), "dir")
  ) {
    errors.push("test-authoring needs a correct/ folder (mutant_kill input)");
  }
  for (const m of task.mutants) {
    if (!await isKind(join(dir, "mutants", m), "dir")) {
      errors.push(`mutant folder not found: mutants/${m}`);
    }
  }
  if (errors.length > 0) {
    throw new ValidationError(
      `Invalid task at ${ymlPath}:\n  ${errors.join("\n  ")}`,
      errors,
    );
  }
  return { task, dir };
}

/**
 * Load every <tasksDir>/<id>/task.yml, sorted by id. Collects the errors of
 * all broken tasks into one ValidationError. An empty set is an error too.
 */
export async function loadTaskSet(tasksDir: string): Promise<LoadedTask[]> {
  const loaded: LoadedTask[] = [];
  const errors: string[] = [];
  for await (const e of Deno.readDir(tasksDir)) {
    if (!e.isDirectory || e.name.startsWith(".")) continue;
    try {
      loaded.push(await loadTask(join(tasksDir, e.name)));
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      errors.push(err.message);
    }
  }
  if (errors.length > 0) {
    throw new ValidationError(
      `${errors.length} invalid task(s) in ${tasksDir}:\n${errors.join("\n")}`,
      errors,
    );
  }
  if (loaded.length === 0) {
    throw new ValidationError(`No tasks found in ${tasksDir}`, [
      "empty task set",
    ]);
  }
  return loaded.sort((a, b) => a.task.id.localeCompare(b.task.id));
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/task.test.ts`
Expected: `ok | 16 passed | 0 failed`.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/yaml.ts src/harness/task.ts tests/unit/harness/task.test.ts
deno lint src/harness/yaml.ts src/harness/task.ts tests/unit/harness/task.test.ts
deno fmt src/harness/yaml.ts src/harness/task.ts tests/unit/harness/task.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/yaml.ts src/harness/task.ts tests/unit/harness/task.test.ts
git commit -m "feat(harness): task.yml schema and loud loader"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/task.test.ts` prints `ok | 16 passed | 0 failed`.

---

### Task M1-02: hashing primitives with versioned rules

Spec 1a section 4 ("hashing rules carry a version number"), section 7 item 4 (refuse symlinks, junctions, reparse points), section 11 ("manifest and hash canonicalization with a fixture (versioned rules)"). The golden values below were computed from this exact code; they change only with a rules bump.

**Deps:** none (can run in parallel with M1-01).

**Files:**
- Create: `src/harness/hash.ts`
- Test: `tests/unit/harness/hash.test.ts`

**Interfaces:**
- Produces: `HASH_RULES_VERSION = "hr1"`; `hashJson(value: unknown): Promise<string>` (64 hex); `hashFile(path: string): Promise<string>`; `interface TreeEntry { path: string; sha256: string }`; `listTree(dir: string, opts?: { optional?: boolean }): Promise<TreeEntry[]>`; `hashTree(dir: string, opts?: { optional?: boolean }): Promise<string>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/hash.test.ts`:

```typescript
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  HASH_RULES_VERSION,
  hashJson,
  hashTree,
  listTree,
} from "../../../src/harness/hash.ts";
import { ValidationError } from "../../../src/errors.ts";

async function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, ...rel.split("/"));
    await Deno.mkdir(join(p, ".."), { recursive: true });
    await Deno.writeTextFile(p, text);
  }
}

Deno.test("hashJson: golden value pins rules hr1", async () => {
  assertEquals(HASH_RULES_VERSION, "hr1");
  assertEquals(
    await hashJson({ b: [true, null, "x"], a: 1 }),
    "b93bfb4cd226bb75b69866d163145c6bbe6e71eae8eb09e6079cf8b54747ea2a",
  );
});

Deno.test("hashJson: key order does not matter, values do", async () => {
  assertEquals(await hashJson({ a: 1, b: 2 }), await hashJson({ b: 2, a: 1 }));
  assertNotEquals(await hashJson({ a: 1 }), await hashJson({ a: 2 }));
});

Deno.test("hashTree: golden value, CRLF-invariant, skips build and tool state", async () => {
  const crlf = await Deno.makeTempDir();
  const lf = await Deno.makeTempDir();
  await writeTree(crlf, {
    "Core/src/A.Codeunit.al": "line1\r\nline2\r\n",
    "notes.txt": "hi",
    ".vscode/settings.json": "{}",
    ".alpackages/x.app": "bin",
    "Core/output/Core.app": "bin",
    "Core/Core.app": "bin",
  });
  await writeTree(lf, {
    "Core/src/A.Codeunit.al": "line1\nline2\n",
    "notes.txt": "hi",
  });
  assertEquals(
    (await listTree(crlf)).map((e) => e.path),
    ["Core/src/A.Codeunit.al", "notes.txt"],
  );
  assertEquals(await hashTree(crlf), await hashTree(lf));
  assertEquals(
    await hashTree(lf),
    "5b704c5851b3d0ee3bf7547a05484a7eaee6fd8f55d2bb23a2c10fcc4c593546",
  );
});

Deno.test("hashTree: missing dir throws unless optional", async () => {
  const root = await Deno.makeTempDir();
  await assertRejects(() => hashTree(join(root, "nope")), Deno.errors.NotFound);
  assertEquals(
    await hashTree(join(root, "nope"), { optional: true }),
    await hashJson({ tree: [] }),
  );
});

Deno.test("hashTree: refuses a symlink or junction", async () => {
  const root = await Deno.makeTempDir();
  const target = await Deno.makeTempDir();
  await writeTree(root, { "a.al": "x" });
  try {
    await Deno.symlink(target, join(root, "link"), { type: "junction" });
  } catch {
    await Deno.symlink(target, join(root, "link"), { type: "dir" });
  }
  await assertRejects(() => hashTree(root), ValidationError, "reparse point");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/hash.test.ts`
Expected: FAIL, `Module not found ".../src/harness/hash.ts"`.

- [ ] **Step 3: Implement**

`src/harness/hash.ts`:

```typescript
/**
 * Harness Bench hashing rules (spec 1a sections 4 and 6).
 *
 * Every harness identity (task visible-input hash, oracle hash, task-set
 * identity, resolved manifest hash, component hash, artifact hash) goes
 * through hashJson, which prefixes HASH_RULES_VERSION. Bump the version on
 * ANY change to what is hashed or how, so a rule change can never collide
 * with an old hash (spec 1a section 4).
 */

import { walk } from "@std/fs/walk";
import { join, relative } from "@std/path";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { canonicalJSON } from "../../shared/canonical.ts";
import { ValidationError } from "../errors.ts";
import { TEXT_EXTENSIONS } from "../ingest/catalog/task-set-hash.ts";

export const HASH_RULES_VERSION = "hr1";

const enc = new TextEncoder();

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return encodeHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

/** SHA-256 hex of `cg-harness:<rules>\n` + canonicalJSON(value). */
export function hashJson(value: unknown): Promise<string> {
  return sha256Hex(
    enc.encode(`cg-harness:${HASH_RULES_VERSION}\n${canonicalJSON(value)}`),
  );
}

/** Build output and tool state, never content. Dot segments are skipped separately. */
const SKIP_FILE_RE = /(\.app|^rad\.json|^Thumbs\.db)$/i;
const SKIP_DIR_SEGMENTS = new Set(["output"]);

function isText(rel: string): boolean {
  const dot = rel.lastIndexOf(".");
  return dot !== -1 && TEXT_EXTENSIONS.includes(rel.slice(dot).toLowerCase());
}

/** Per-file SHA-256 hex; CRLF is normalized to LF for text extensions only. */
export async function hashFile(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  if (!isText(path)) return sha256Hex(bytes);
  const text = new TextDecoder().decode(bytes).replaceAll("\r\n", "\n");
  return sha256Hex(enc.encode(text));
}

export interface TreeEntry {
  path: string;
  sha256: string;
}

/**
 * Sorted (posix path, sha256) list of a directory's content files.
 * Skips dot segments (covers .alpackages, .vscode), `output/`, `*.app`,
 * rad.json, Thumbs.db. Refuses symlinks, junctions and other reparse points
 * (spec 1a section 7 item 4). Missing dir: throws NotFound unless optional.
 */
export async function listTree(
  dir: string,
  opts: { optional?: boolean } = {},
): Promise<TreeEntry[]> {
  try {
    await Deno.stat(dir);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound && opts.optional) return [];
    throw err;
  }
  const out: TreeEntry[] = [];
  for await (const e of walk(dir, { followSymlinks: false })) {
    const rel = relative(dir, e.path).replaceAll("\\", "/");
    if (rel === "") continue;
    const segs = rel.split("/");
    if (segs.some((s) => s.startsWith(".") || SKIP_DIR_SEGMENTS.has(s))) {
      continue;
    }
    if (e.isSymlink) {
      throw new ValidationError(`refusing link or reparse point: ${rel}`, [
        rel,
      ]);
    }
    if (!e.isFile || SKIP_FILE_RE.test(segs[segs.length - 1]!)) continue;
    out.push({ path: rel, sha256: await hashFile(join(dir, rel)) });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Content hash of a directory tree (empty list when optional and missing). */
export async function hashTree(
  dir: string,
  opts: { optional?: boolean } = {},
): Promise<string> {
  return hashJson({ tree: await listTree(dir, opts) });
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/hash.test.ts`
Expected: `ok | 5 passed | 0 failed`. If a golden value differs, the implementation deviates from the plan; fix the code, do not edit the golden value.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/hash.ts tests/unit/harness/hash.test.ts
deno lint src/harness/hash.ts tests/unit/harness/hash.test.ts
deno fmt src/harness/hash.ts tests/unit/harness/hash.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/hash.ts tests/unit/harness/hash.test.ts
git commit -m "feat(harness): versioned hashing rules with golden fixtures"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/hash.test.ts` prints `ok | 5 passed | 0 failed`.

---

### Task M1-03: harness config and experiment schemas

Spec 1a section 4 (config shape; "task limits override config limits only to be stricter"), section 6 (experiment: `hypothesis` and `primary_metric` required, `vary`, `repeats` default 3 per D7), D19 (one declared primary metric).

**Deps:** M1-01 (`readYaml`, `HarnessTask`).

**Files:**
- Create: `src/harness/config.ts`
- Test: `tests/unit/harness/config.test.ts`

**Interfaces:**
- Consumes: `readYaml` (M1-01), `type HarnessTask` (M1-01).
- Produces: `HarnessConfigSchema`, `type HarnessConfig`, `ComponentsSchema`, `LimitsSchema`, `type Limits`; `VARY_KEYS`, `type VaryKey`; `PRIMARY_METRICS = ["cost_per_solved_task", "pass_rate"]`, `type PrimaryMetric`; `ExperimentSchema`, `type Experiment`; `loadConfig(harnessRoot: string, id: string): Promise<HarnessConfig>`; `interface LoadedExperiment { experiment: Experiment; configs: HarnessConfig[] }` (baseline first); `loadExperiment(harnessRoot: string, id: string): Promise<LoadedExperiment>`; `effectiveLimits(config: Limits, task: HarnessTask["limits"]): Limits`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/config.test.ts`:

```typescript
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  effectiveLimits,
  loadConfig,
  loadExperiment,
} from "../../../src/harness/config.ts";

const CONFIG = (id: string, extra = "") =>
  `id: ${id}
harness: claude-code
harness_version: 2.1.282
models:
  main: anthropic/model-a
components:
  skills: bundles/al-skills/skills
  mcp: [al-tools]
limits: { timeout_min: 30, max_budget_usd: 5 }
${extra}`;

const EXPERIMENT = `id: skills-vs-plain
hypothesis: Skills cut cost per solved task.
primary_metric: cost_per_solved_task
baseline: cc-plain
variants: [cc-skills]
vary: [skills]
tasks: "harness-tasks/tasks/*"
`;

async function harnessRoot(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(join(root, "bundles", "al-skills", "skills"), {
    recursive: true,
  });
  for (const [rel, text] of Object.entries(files)) {
    await Deno.mkdir(join(root, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(root, rel), text);
  }
  return root;
}

Deno.test("loadConfig: defaults for unlisted components", async () => {
  const root = await harnessRoot({ "configs/cc-a.yml": CONFIG("cc-a") });
  const c = await loadConfig(root, "cc-a");
  assertEquals(c.components.instructions, null);
  assertEquals(c.components.plugins, []);
  assertEquals(c.components.mcp, ["al-tools"]);
  assertEquals(c.settings, {});
});

Deno.test("loadConfig: rejects unknown component, bad model id, id mismatch, missing bundle", async () => {
  const cases: Array<[string, string, string]> = [
    [CONFIG("cc-a").replace("mcp:", "mcps:"), "mcps", "ValidationError"],
    [
      CONFIG("cc-a").replace("anthropic/model-a", "model-a"),
      "provider/model",
      "ValidationError",
    ],
    [CONFIG("cc-b"), "does not match file name", "ValidationError"],
    [
      CONFIG("cc-a").replace("al-skills/skills", "nope"),
      "not found",
      "ConfigurationError",
    ],
    [
      CONFIG("cc-a").replace(
        "limits: { timeout_min: 30, max_budget_usd: 5 }",
        "",
      ),
      "limits",
      "ValidationError",
    ],
  ];
  for (const [yml, needle, cls] of cases) {
    const root = await harnessRoot({ "configs/cc-a.yml": yml });
    const err = await assertRejects(() => loadConfig(root, "cc-a"));
    assertEquals((err as Error).name, cls);
    assertStringIncludes((err as Error).message, needle);
  }
});

Deno.test("loadExperiment: loads baseline then variants, repeats defaults to 3", async () => {
  const root = await harnessRoot({
    "configs/cc-plain.yml": CONFIG("cc-plain"),
    "configs/cc-skills.yml": CONFIG("cc-skills"),
    "experiments/skills-vs-plain.yml": EXPERIMENT,
  });
  const { experiment, configs } = await loadExperiment(root, "skills-vs-plain");
  assertEquals(experiment.repeats, 3);
  assertEquals(configs.map((c) => c.id), ["cc-plain", "cc-skills"]);
});

Deno.test("loadExperiment: rejects missing hypothesis, unknown vary key, baseline listed as variant, missing config", async () => {
  const cases: Array<[string, string]> = [
    [
      EXPERIMENT.replace("Skills cut cost per solved task.", '"  "'),
      "hypothesis",
    ],
    [EXPERIMENT.replace("vary: [skills]", "vary: [skill]"), "vary"],
    [EXPERIMENT.replace("[cc-skills]", "[cc-skills, cc-plain]"), "distinct"],
    [EXPERIMENT.replace("[cc-skills]", "[cc-missing]"), "cc-missing"],
  ];
  for (const [yml, needle] of cases) {
    const root = await harnessRoot({
      "configs/cc-plain.yml": CONFIG("cc-plain"),
      "configs/cc-skills.yml": CONFIG("cc-skills"),
      "experiments/skills-vs-plain.yml": yml,
    });
    const err = await assertRejects(() =>
      loadExperiment(root, "skills-vs-plain")
    );
    assertStringIncludes((err as Error).message, needle);
  }
});

Deno.test("effectiveLimits: task can only tighten", () => {
  const config = { timeout_min: 30, max_budget_usd: 5 };
  assertEquals(effectiveLimits(config, {}), config);
  assertEquals(effectiveLimits(config, { timeout_min: 20 }), {
    timeout_min: 20,
    max_budget_usd: 5,
  });
  assertEquals(
    effectiveLimits(config, { timeout_min: 60, max_budget_usd: 2 }),
    { timeout_min: 30, max_budget_usd: 2 },
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/config.test.ts`
Expected: FAIL, `Module not found ".../src/harness/config.ts"`.

- [ ] **Step 3: Implement**

`src/harness/config.ts`:

```typescript
/**
 * Harness config (spec 1a section 4) and experiment (section 6) schemas and
 * loaders. Paths inside a config are relative to the harness/ root.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ConfigurationError, ValidationError } from "../errors.ts";
import type { HarnessTask } from "./task.ts";
import { readYaml } from "./yaml.ts";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase slug");
const bundlePath = z.string().min(1).nullable().default(null);

export const ComponentsSchema = z.strictObject({
  instructions: bundlePath,
  skills: bundlePath,
  agents: bundlePath,
  hooks: bundlePath,
  plugins: z.array(z.string().min(1)).default([]),
  mcp: z.array(slug).default([]),
  lsp: z.array(slug).default([]),
  toolchain: z.array(z.string().regex(/^[a-z0-9-]+@[\w.-]+$/, "name@version"))
    .default([]),
});

export const LimitsSchema = z.strictObject({
  timeout_min: z.number().int().positive(),
  max_budget_usd: z.number().positive(),
});

export const HarnessConfigSchema = z.strictObject({
  id: slug,
  harness: slug,
  harness_version: z.string().min(1),
  models: z.record(
    z.string().min(1),
    z.string().regex(/^[a-z0-9-]+\/\S+$/, "provider/model"),
  ).refine((m) => Object.keys(m).length > 0, "at least one model"),
  settings: z.record(z.string(), z.unknown()).default({}),
  components: ComponentsSchema.default(ComponentsSchema.parse({})),
  limits: LimitsSchema,
});
export type HarnessConfig = z.output<typeof HarnessConfigSchema>;
export type Limits = z.output<typeof LimitsSchema>;

/** Names an experiment may list under `vary` (spec 1a section 6, D15). */
export const VARY_KEYS = [
  "harness",
  "harness_version",
  "models",
  "settings",
  "limits",
  "instructions",
  "skills",
  "agents",
  "hooks",
  "plugins",
  "mcp",
  "lsp",
  "toolchain",
] as const;
export type VaryKey = (typeof VARY_KEYS)[number];

export const PRIMARY_METRICS = ["cost_per_solved_task", "pass_rate"] as const;
export type PrimaryMetric = (typeof PRIMARY_METRICS)[number];

export const ExperimentSchema = z.strictObject({
  id: slug,
  hypothesis: z.string().trim().min(1),
  primary_metric: z.enum(PRIMARY_METRICS),
  baseline: slug,
  variants: z.array(slug).min(1),
  vary: z.array(z.enum(VARY_KEYS)).min(1),
  tasks: z.string().min(1),
  repeats: z.number().int().positive().default(3),
}).superRefine((e, ctx) => {
  const arms = [e.baseline, ...e.variants];
  if (new Set(arms).size !== arms.length) {
    ctx.addIssue({
      code: "custom",
      message: "baseline and variants must be distinct",
      path: ["variants"],
    });
  }
});
export type Experiment = z.output<typeof ExperimentSchema>;

function assertIdMatchesFile(id: string, expected: string, path: string) {
  if (id !== expected) {
    throw new ValidationError(`${path}: id ${id} does not match file name`, [
      `id ${id} != ${expected}`,
    ]);
  }
}

/** Load harness/configs/<id>.yml and check that bundle paths exist. */
export async function loadConfig(
  harnessRoot: string,
  id: string,
): Promise<HarnessConfig> {
  const path = join(harnessRoot, "configs", `${id}.yml`);
  const config = await readYaml(path, HarnessConfigSchema);
  assertIdMatchesFile(config.id, id, path);
  const c = config.components;
  const paths = [c.instructions, c.skills, c.agents, c.hooks, ...c.plugins]
    .filter((p): p is string => p !== null);
  const missing: string[] = [];
  for (const p of paths) {
    try {
      await Deno.stat(join(harnessRoot, p));
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      missing.push(p);
    }
  }
  if (missing.length > 0) {
    throw new ConfigurationError(
      `${path}: component path(s) not found: ${missing.join(", ")}`,
      path,
    );
  }
  return config;
}

export interface LoadedExperiment {
  experiment: Experiment;
  /** Baseline first, then variants in declared order. */
  configs: HarnessConfig[];
}

/** Load harness/experiments/<id>.yml plus every config it names. */
export async function loadExperiment(
  harnessRoot: string,
  id: string,
): Promise<LoadedExperiment> {
  const path = join(harnessRoot, "experiments", `${id}.yml`);
  const experiment = await readYaml(path, ExperimentSchema);
  assertIdMatchesFile(experiment.id, id, path);
  const configs: HarnessConfig[] = [];
  for (const arm of [experiment.baseline, ...experiment.variants]) {
    configs.push(await loadConfig(harnessRoot, arm));
  }
  return { experiment, configs };
}

/** Task limits may only tighten config limits (spec 1a section 4). */
export function effectiveLimits(
  config: Limits,
  task: HarnessTask["limits"],
): Limits {
  return {
    timeout_min: Math.min(config.timeout_min, task.timeout_min ?? Infinity),
    max_budget_usd: Math.min(
      config.max_budget_usd,
      task.max_budget_usd ?? Infinity,
    ),
  };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/config.test.ts`
Expected: `ok | 5 passed | 0 failed`.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/config.ts tests/unit/harness/config.test.ts
deno lint src/harness/config.ts tests/unit/harness/config.test.ts
deno fmt src/harness/config.ts tests/unit/harness/config.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/config.ts tests/unit/harness/config.test.ts
git commit -m "feat(harness): config and experiment schemas, limit precedence"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/config.test.ts` prints `ok | 5 passed | 0 failed`.

---

### Task M1-04: task identity and task-set identity

Spec 1a section 6 (two hashes per task; task-set identity is a sorted manifest of per-task (id, visible, oracle), so adding a task does not invalidate others) and 1b section 7 (what goes in each hash; `naive/` in neither; `touches`/`coupling` never force a re-bench). The symbols manifest is an input: until `harness-tasks/symbols.lock.json` exists (Part 2 staging writes it), the identity is marked `provisional` and M1-07 refuses to build a campaign on it.

**Deps:** M1-01, M1-02.

**Files:**
- Create: `src/harness/identity.ts`
- Test: `tests/unit/harness/identity.test.ts`

**Interfaces:**
- Consumes: `LoadedTask`, `loadTaskSet` (M1-01); `hashJson`, `hashFile`, `hashTree` (M1-02).
- Produces: `REFAPP_PATH = "harness-tasks/refapp"`; `interface RefappRef { version; commit; tree }`; `resolveRefapp(repoRoot: string, version: string): Promise<RefappRef>`; `type SymbolEntry = { name; publisher; version; sha256 }`; `SYMBOLS_LOCK_PATH`; `loadSymbolsLock(repoRoot: string): Promise<SymbolEntry[] | null>`; `visibleInputHash(t: LoadedTask, refapp: RefappRef, symbols: SymbolEntry[] | null): Promise<string>`; `oracleHash(t: LoadedTask): Promise<string>`; `TaskIdentitySchema`, `type TaskIdentity = { id; refapp_commit; visible; oracle }`; `TaskSetIdentitySchema`, `type TaskSetIdentity = { identity; provisional; tasks: TaskIdentity[] }`; `taskSetIdentity(repoRoot: string, tasks: LoadedTask[], symbols: SymbolEntry[] | null): Promise<TaskSetIdentity>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/identity.test.ts` (builds a throwaway git repo in a temp dir; needs git on PATH):

```typescript
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  loadSymbolsLock,
  resolveRefapp,
  taskSetIdentity,
} from "../../../src/harness/identity.ts";
import { loadTaskSet } from "../../../src/harness/task.ts";
import { ValidationError } from "../../../src/errors.ts";

const TASK = (id: string) =>
  `id: ${id}
refapp_version: refapp-v1
kind: bugfix
prompt: prompt.md
touches: [Rental]
source: refapp
scorers: [build, fail_to_pass]
fail_to_pass:
  depends_on: [Rental]
  tests:
    - { codeunit: 85001, procedures: [DamageBlocksCheckout] }
`;

async function write(root: string, rel: string, text: string) {
  await Deno.mkdir(join(root, rel, ".."), { recursive: true });
  await Deno.writeTextFile(join(root, rel), text);
}

async function git(root: string, ...args: string[]) {
  const out = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
}

/** Temp repo with a tagged refapp and two tasks. */
async function fixtureRepo(): Promise<string> {
  const root = await Deno.makeTempDir();
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "t@example.com");
  await git(root, "config", "user.name", "t");
  await write(root, "harness-tasks/refapp/Core/app.json", "{}");
  await git(root, "add", ".");
  await git(root, "commit", "-q", "-m", "refapp");
  await git(root, "tag", "refapp-v1");
  for (const id of ["HX-001", "HX-002"]) {
    await write(root, `harness-tasks/tasks/${id}/task.yml`, TASK(id));
    await write(root, `harness-tasks/tasks/${id}/prompt.md`, "Fix it.");
    await write(root, `harness-tasks/tasks/${id}/oracle/T.al`, "codeunit");
    await write(root, `harness-tasks/tasks/${id}/naive/a/X.al`, "wrong");
  }
  return root;
}

async function identity(root: string) {
  const tasks = await loadTaskSet(join(root, "harness-tasks", "tasks"));
  return await taskSetIdentity(root, tasks, []);
}

Deno.test("resolveRefapp: tag resolves to commit and tree; unknown tag fails loudly", async () => {
  const root = await fixtureRepo();
  const ref = await resolveRefapp(root, "refapp-v1");
  assertEquals(ref.commit.length, 40);
  assertEquals(ref.tree.length, 40);
  await assertRejects(
    () => resolveRefapp(root, "refapp-v9"),
    ValidationError,
    "does not resolve",
  );
});

Deno.test("identity: oracle edit moves only the oracle hash", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(root, "harness-tasks/tasks/HX-001/oracle/T.al", "codeunit v2");
  const after = await identity(root);
  assertEquals(after.tasks[0]!.visible, before.tasks[0]!.visible);
  assertNotEquals(after.tasks[0]!.oracle, before.tasks[0]!.oracle);
  assertEquals(after.tasks[1], before.tasks[1]);
  assertNotEquals(after.identity, before.identity);
});

Deno.test("identity: prompt or overlay edit moves only the visible hash", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(root, "harness-tasks/tasks/HX-001/overlay/Rental/B.al", "bug");
  const after = await identity(root);
  assertNotEquals(after.tasks[0]!.visible, before.tasks[0]!.visible);
  assertEquals(after.tasks[0]!.oracle, before.tasks[0]!.oracle);
});

Deno.test("identity: metadata and naive/ edits move nothing", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(
    root,
    "harness-tasks/tasks/HX-001/task.yml",
    TASK("HX-001").replace(
      "touches: [Rental]",
      "touches: [Rental, Fleet]\ncoupling: [events]",
    ),
  );
  await write(root, "harness-tasks/tasks/HX-001/naive/a/X.al", "other");
  assertEquals(await identity(root), before);
});

Deno.test("identity: adding a task keeps the other entries", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(root, "harness-tasks/tasks/HX-003/task.yml", TASK("HX-003"));
  await write(root, "harness-tasks/tasks/HX-003/prompt.md", "New.");
  await write(root, "harness-tasks/tasks/HX-003/oracle/T.al", "c");
  const after = await identity(root);
  assertEquals(after.tasks.slice(0, 2), before.tasks);
  assertEquals(after.tasks.length, 3);
});

Deno.test("identity: a refapp change moves every visible hash", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(root, "harness-tasks/refapp/Core/app.json", '{"v":2}');
  await git(root, "commit", "-qam", "refapp v2");
  await git(root, "tag", "-f", "refapp-v1");
  const after = await identity(root);
  for (const i of [0, 1]) {
    assertNotEquals(after.tasks[i]!.visible, before.tasks[i]!.visible);
    assertEquals(after.tasks[i]!.oracle, before.tasks[i]!.oracle);
  }
});

Deno.test("identity: no symbols manifest means provisional and a different hash", async () => {
  const root = await fixtureRepo();
  const tasks = await loadTaskSet(join(root, "harness-tasks", "tasks"));
  const withSymbols = await taskSetIdentity(root, tasks, []);
  const without = await taskSetIdentity(root, tasks, null);
  assertEquals(withSymbols.provisional, false);
  assertEquals(without.provisional, true);
  assertNotEquals(without.identity, withSymbols.identity);
});

Deno.test("loadSymbolsLock: null when absent, sorted when present, loud when malformed", async () => {
  const root = await Deno.makeTempDir();
  assertEquals(await loadSymbolsLock(root), null);
  const entry = (name: string) => ({
    name,
    publisher: "Microsoft",
    version: "28.0.0.0",
    sha256: "a".repeat(64),
  });
  await write(
    root,
    "harness-tasks/symbols.lock.json",
    JSON.stringify([entry("System"), entry("Base Application")]),
  );
  assertEquals((await loadSymbolsLock(root))!.map((s) => s.name), [
    "Base Application",
    "System",
  ]);
  await write(
    root,
    "harness-tasks/symbols.lock.json",
    JSON.stringify([{ name: "System" }]),
  );
  await assertRejects(() => loadSymbolsLock(root), ValidationError);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/identity.test.ts`
Expected: FAIL, `Module not found ".../src/harness/identity.ts"`.

- [ ] **Step 3: Implement**

`src/harness/identity.ts`:

```typescript
/**
 * Task identity (spec 1a section 6, spec 1b section 7): each task has a
 * visible-input hash (what the agent sees) and an oracle hash (what judges
 * it). The task-set identity is the hash of the sorted per-task manifest, so
 * adding a task never re-keys the executions of the others.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { hashFile, hashJson, hashTree } from "./hash.ts";
import type { LoadedTask } from "./task.ts";

/** Path of the refapp inside the repo; tags and commits resolve against it. */
export const REFAPP_PATH = "harness-tasks/refapp";

export interface RefappRef {
  version: string;
  commit: string;
  /** Git tree id of REFAPP_PATH at `commit`: content-addressed. */
  tree: string;
}

async function git(repoRoot: string, args: string[]): Promise<string | null> {
  const out = await new Deno.Command("git", {
    args,
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return out.success ? new TextDecoder().decode(out.stdout).trim() : null;
}

/** Resolve a refapp tag or commit to an immutable commit and refapp tree id. */
export async function resolveRefapp(
  repoRoot: string,
  version: string,
): Promise<RefappRef> {
  const commit = await git(repoRoot, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${version}^{commit}`,
  ]);
  if (!commit) {
    throw new ValidationError(`refapp_version ${version} does not resolve`, [
      version,
    ]);
  }
  const tree = await git(repoRoot, ["rev-parse", `${commit}:${REFAPP_PATH}`]);
  if (!tree) {
    throw new ValidationError(`${REFAPP_PATH} missing at ${version}`, [
      version,
    ]);
  }
  return { version, commit, tree };
}

const SymbolEntrySchema = z.strictObject({
  name: z.string().min(1),
  publisher: z.string().min(1),
  version: z.string().min(1),
  sha256: z.string().length(64),
});
/** One pre-seeded `.alpackages` entry. The lock file is produced in Part 2. */
export type SymbolEntry = z.output<typeof SymbolEntrySchema>;

export const SYMBOLS_LOCK_PATH = "harness-tasks/symbols.lock.json";

/** Read the symbols lock; null when it does not exist yet (provisional). */
export async function loadSymbolsLock(
  repoRoot: string,
): Promise<SymbolEntry[] | null> {
  const path = join(repoRoot, SYMBOLS_LOCK_PATH);
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  const result = z.array(SymbolEntrySchema).safeParse(JSON.parse(text));
  if (!result.success) {
    const errors = result.error.issues.map((i) =>
      `${i.path.join(".")}: ${i.message}`
    );
    throw new ValidationError(`Invalid ${path}`, errors);
  }
  return [...result.data].sort((a, b) =>
    `${a.publisher}/${a.name}`.localeCompare(`${b.publisher}/${b.name}`)
  );
}

/**
 * Visible-input hash: prompt, attachments, refapp tree (includes shipped
 * Test\ sources), overlay/, symbols manifest, agent-visible task.yml fields.
 * `symbols: null` means no symbols manifest yet; the result is provisional.
 */
export async function visibleInputHash(
  t: LoadedTask,
  refapp: RefappRef,
  symbols: SymbolEntry[] | null,
): Promise<string> {
  const { task, dir } = t;
  const attachments = [];
  for (const a of [...task.attachments].sort()) {
    attachments.push({ path: a, sha256: await hashFile(join(dir, a)) });
  }
  return hashJson({
    part: "visible",
    id: task.id,
    source: task.source,
    refapp_tree: refapp.tree,
    prompt: await hashFile(join(dir, task.prompt)),
    attachments,
    overlay: await hashTree(join(dir, "overlay"), { optional: true }),
    symbols,
    limits: task.limits,
  });
}

/**
 * Oracle hash: oracle/, mutants/, correct/ (a runtime input for
 * mutant_kill), and the scorer fields of task.yml. naive/ is in neither hash.
 */
export async function oracleHash(t: LoadedTask): Promise<string> {
  const { task, dir } = t;
  return hashJson({
    part: "oracle",
    id: task.id,
    kind: task.kind,
    scorers: task.scorers,
    pass_to_pass: task.pass_to_pass,
    fail_to_pass: task.fail_to_pass,
    mutants: task.mutants,
    oracle: await hashTree(join(dir, "oracle"), { optional: true }),
    mutants_tree: await hashTree(join(dir, "mutants"), { optional: true }),
    correct: await hashTree(join(dir, "correct"), { optional: true }),
  });
}

export const TaskIdentitySchema = z.strictObject({
  id: z.string(),
  refapp_commit: z.string(),
  visible: z.string().length(64),
  oracle: z.string().length(64),
});
export type TaskIdentity = z.output<typeof TaskIdentitySchema>;

export const TaskSetIdentitySchema = z.strictObject({
  identity: z.string().length(64),
  /** True while no symbols manifest exists; the runner refuses it (Part 2). */
  provisional: z.boolean(),
  tasks: z.array(TaskIdentitySchema),
});
export type TaskSetIdentity = z.output<typeof TaskSetIdentitySchema>;

/** Hash every task and build the sorted task-set manifest. */
export async function taskSetIdentity(
  repoRoot: string,
  tasks: LoadedTask[],
  symbols: SymbolEntry[] | null,
): Promise<TaskSetIdentity> {
  const refs = new Map<string, RefappRef>();
  const entries: TaskIdentity[] = [];
  for (const t of tasks) {
    const v = t.task.refapp_version;
    if (!refs.has(v)) refs.set(v, await resolveRefapp(repoRoot, v));
    const refapp = refs.get(v)!;
    entries.push({
      id: t.task.id,
      refapp_commit: refapp.commit,
      visible: await visibleInputHash(t, refapp, symbols),
      oracle: await oracleHash(t),
    });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return {
    identity: await hashJson({ part: "task-set", tasks: entries }),
    provisional: symbols === null,
    tasks: entries,
  };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/identity.test.ts`
Expected: `ok | 8 passed | 0 failed`.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/identity.ts tests/unit/harness/identity.test.ts
deno lint src/harness/identity.ts tests/unit/harness/identity.test.ts
deno fmt src/harness/identity.ts tests/unit/harness/identity.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/identity.ts tests/unit/harness/identity.test.ts
git commit -m "feat(harness): visible and oracle task hashes, task-set identity"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/identity.test.ts` prints `ok | 8 passed | 0 failed`.

---

### Task M1-05: resolved manifest, component hashes, vary enforcement

Spec 1a section 4 (resolved execution manifest; per-component hashes; config identity), section 6 and D15 (runner refuses arms that differ outside `vary`), section 11 ("`vary` enforcement: arms whose resolved manifests differ outside `vary` are refused"). Derived keys: the image digest may differ only when `harness`, `harness_version` or `toolchain` is varied; provider routes only with `models`; the backend version never (D12: arms share one backend).

**Deps:** M1-02, M1-03.

**Files:**
- Create: `src/harness/manifest.ts`
- Test: `tests/unit/harness/manifest.test.ts`

**Interfaces:**
- Consumes: `HarnessConfig`, `HarnessConfigSchema`, `VaryKey` (M1-03); `HASH_RULES_VERSION`, `hashFile`, `hashJson`, `hashTree` (M1-02).
- Produces: `ResolvedManifestSchema`, `type ResolvedManifest`; `interface RuntimeFacts { image_digest: string; backend_version: string; servers: Record<string, { version: string; tool_schema_hash: string }>; provider_routes: Record<string, string> }`; `resolveManifest(harnessRoot: string, config: HarnessConfig, facts: RuntimeFacts): Promise<ResolvedManifest>`; `MANIFEST_KEYS`, `type ManifestKey`; `componentHashes(m): Promise<Record<ManifestKey, string>>`; `manifestHash(m): Promise<string>`; `diffManifests(a, b): Promise<ManifestKey[]>`; `allowedDiffs(vary): Set<ManifestKey>`; `assertVaryHolds(baseline, variant, vary): Promise<void>` (throws `ConfigurationError`).

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/manifest.test.ts`:

```typescript
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  type HarnessConfig,
  HarnessConfigSchema,
} from "../../../src/harness/config.ts";
import {
  assertVaryHolds,
  diffManifests,
  manifestHash,
  resolveManifest,
  type RuntimeFacts,
} from "../../../src/harness/manifest.ts";

const FACTS: RuntimeFacts = {
  image_digest: "sha256:img1",
  backend_version: "cg-al-backend@1",
  servers: { "al-tools": { version: "1.0.0", tool_schema_hash: "s1" } },
  provider_routes: {},
};

async function root(): Promise<string> {
  const r = await Deno.makeTempDir();
  for (
    const [rel, text] of Object.entries({
      "bundles/al/skills/objid/SKILL.md": "Allocate object ids.",
      "bundles/al/instructions/AGENTS.md": "Rules.",
      "bundles/al/nudge.md": "Consider your skills.",
    })
  ) {
    await Deno.mkdir(join(r, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(r, rel), text);
  }
  return r;
}

function config(
  id: string,
  components: Record<string, unknown> = {},
): HarnessConfig {
  return HarnessConfigSchema.parse({
    id,
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/model-a" },
    components,
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
}

Deno.test("manifestHash: config name is not identity, content is", async () => {
  const r = await root();
  const a = await resolveManifest(r, config("cc-a"), FACTS);
  const b = await resolveManifest(r, config("cc-b"), FACTS);
  assertEquals(await manifestHash(a), await manifestHash(b));
  const c = await resolveManifest(
    r,
    config("cc-c", { skills: "bundles/al/skills" }),
    FACTS,
  );
  assertNotEquals(await manifestHash(a), await manifestHash(c));
});

Deno.test("resolveManifest: a skill file edit changes only the skills hash", async () => {
  const r = await root();
  const cfg = config("cc-a", {
    skills: "bundles/al/skills",
    instructions: "bundles/al/nudge.md",
  });
  const before = await resolveManifest(r, cfg, FACTS);
  await Deno.writeTextFile(
    join(r, "bundles/al/skills/objid/SKILL.md"),
    "Changed.",
  );
  const after = await resolveManifest(r, cfg, FACTS);
  assertEquals(await diffManifests(before, after), ["skills"]);
});

Deno.test("resolveManifest: named MCP without runtime facts is refused", async () => {
  const r = await root();
  await assertRejects(
    () => resolveManifest(r, config("cc-a", { mcp: ["other"] }), FACTS),
    ConfigurationError,
    "other",
  );
});

Deno.test("assertVaryHolds: difference inside vary passes, outside is refused", async () => {
  const r = await root();
  const base = await resolveManifest(r, config("plain"), FACTS);
  const skills = await resolveManifest(
    r,
    config("skills", { skills: "bundles/al/skills" }),
    FACTS,
  );
  await assertVaryHolds(base, skills, ["skills"]);
  const both = await resolveManifest(
    r,
    config("both", { skills: "bundles/al/skills", mcp: ["al-tools"] }),
    FACTS,
  );
  await assertRejects(
    () => assertVaryHolds(base, both, ["skills"]),
    ConfigurationError,
    "outside vary [skills]: mcp",
  );
  await assertVaryHolds(base, both, ["skills", "mcp"]);
});

Deno.test("assertVaryHolds: MCP server version bump counts as an mcp difference", async () => {
  const r = await root();
  const cfg = config("x", { mcp: ["al-tools"] });
  const a = await resolveManifest(r, cfg, FACTS);
  const b = await resolveManifest(r, cfg, {
    ...FACTS,
    servers: { "al-tools": { version: "1.0.1", tool_schema_hash: "s1" } },
  });
  assertEquals(await diffManifests(a, b), ["mcp"]);
  await assertRejects(
    () => assertVaryHolds(a, b, ["skills"]),
    ConfigurationError,
  );
});

Deno.test("assertVaryHolds: image follows harness_version, backend never varies", async () => {
  const r = await root();
  const a = await resolveManifest(r, config("a"), FACTS);
  const b = await resolveManifest(
    r,
    { ...config("b"), harness_version: "2.1.300" },
    { ...FACTS, image_digest: "sha256:img2" },
  );
  await assertVaryHolds(a, b, ["harness_version"]);
  await assertRejects(
    () => assertVaryHolds(a, b, ["skills"]),
    ConfigurationError,
  );
  const c = await resolveManifest(r, config("c"), {
    ...FACTS,
    backend_version: "cg-al-backend@2",
  });
  await assertRejects(
    () => assertVaryHolds(a, c, ["harness", "models", "skills", "mcp"]),
    ConfigurationError,
    "backend_version",
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/manifest.test.ts`
Expected: FAIL, `Module not found ".../src/harness/manifest.ts"`.

- [ ] **Step 3: Implement**

`src/harness/manifest.ts`:

```typescript
/**
 * Resolved execution manifest (spec 1a section 4) and `vary` enforcement
 * (section 6, D15). The manifest hash is the config identity; each
 * component has its own hash so a report can show exactly what differs.
 *
 * Runtime facts (image digest, backend version, MCP/LSP server versions and
 * tool-schema hashes, provider routes) are inputs here; Part 2 collects them.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ConfigurationError } from "../errors.ts";
import type { HarnessConfig, VaryKey } from "./config.ts";
import { HASH_RULES_VERSION, hashFile, hashJson, hashTree } from "./hash.ts";

const Sha = z.string().length(64);
const PathComponent = z.strictObject({ path: z.string(), hash: Sha });
const Server = z.strictObject({
  name: z.string(),
  version: z.string(),
  tool_schema_hash: z.string(),
});

export const ResolvedManifestSchema = z.strictObject({
  v: z.literal(1),
  rules: z.string(),
  config_id: z.string(),
  harness: z.string(),
  harness_version: z.string(),
  models: z.record(z.string(), z.string()),
  settings: z.record(z.string(), z.unknown()),
  limits: z.strictObject({
    timeout_min: z.number(),
    max_budget_usd: z.number(),
  }),
  instructions: PathComponent.nullable(),
  skills: PathComponent.nullable(),
  agents: PathComponent.nullable(),
  hooks: PathComponent.nullable(),
  plugins: z.array(PathComponent),
  mcp: z.array(Server),
  lsp: z.array(Server),
  toolchain: z.array(z.string()),
  image_digest: z.string().min(1),
  backend_version: z.string().min(1),
  provider_routes: z.record(z.string(), z.string()),
});
export type ResolvedManifest = z.output<typeof ResolvedManifestSchema>;

export interface RuntimeFacts {
  image_digest: string;
  backend_version: string;
  servers: Record<string, { version: string; tool_schema_hash: string }>;
  provider_routes: Record<string, string>;
}

async function pathComponent(harnessRoot: string, rel: string) {
  const abs = join(harnessRoot, rel);
  const stat = await Deno.stat(abs);
  const hash = stat.isDirectory
    ? await hashTree(abs)
    : await hashJson({ file: await hashFile(abs) });
  return { path: rel, hash };
}

function servers(names: string[], facts: RuntimeFacts, kind: string) {
  return names.map((name) => {
    const f = facts.servers[name];
    if (!f) {
      throw new ConfigurationError(
        `${kind} component ${name} has no runtime facts (version, tool schema)`,
      );
    }
    return { name, ...f };
  });
}

/** Resolve a config plus runtime facts into a manifest. */
export async function resolveManifest(
  harnessRoot: string,
  config: HarnessConfig,
  facts: RuntimeFacts,
): Promise<ResolvedManifest> {
  const c = config.components;
  const opt = (p: string | null) =>
    p === null ? Promise.resolve(null) : pathComponent(harnessRoot, p);
  const plugins = [];
  for (const p of [...c.plugins].sort()) {
    plugins.push(await pathComponent(harnessRoot, p));
  }
  return ResolvedManifestSchema.parse({
    v: 1,
    rules: HASH_RULES_VERSION,
    config_id: config.id,
    harness: config.harness,
    harness_version: config.harness_version,
    models: config.models,
    settings: config.settings,
    limits: config.limits,
    instructions: await opt(c.instructions),
    skills: await opt(c.skills),
    agents: await opt(c.agents),
    hooks: await opt(c.hooks),
    plugins,
    mcp: servers([...c.mcp].sort(), facts, "mcp"),
    lsp: servers([...c.lsp].sort(), facts, "lsp"),
    toolchain: [...c.toolchain].sort(),
    image_digest: facts.image_digest,
    backend_version: facts.backend_version,
    provider_routes: facts.provider_routes,
  });
}

/** Manifest keys that get their own component hash. */
export const MANIFEST_KEYS = [
  "harness",
  "harness_version",
  "models",
  "settings",
  "limits",
  "instructions",
  "skills",
  "agents",
  "hooks",
  "plugins",
  "mcp",
  "lsp",
  "toolchain",
  "image_digest",
  "backend_version",
  "provider_routes",
] as const;
export type ManifestKey = (typeof MANIFEST_KEYS)[number];

export async function componentHashes(
  m: ResolvedManifest,
): Promise<Record<ManifestKey, string>> {
  const out = {} as Record<ManifestKey, string>;
  for (const k of MANIFEST_KEYS) out[k] = await hashJson({ [k]: m[k] });
  return out;
}

/** Config identity: every field except the config's own name. */
export function manifestHash(m: ResolvedManifest): Promise<string> {
  const { config_id: _name, ...rest } = m;
  return hashJson({ manifest: rest });
}

/** Keys whose component hashes differ, in MANIFEST_KEYS order. */
export async function diffManifests(
  a: ResolvedManifest,
  b: ResolvedManifest,
): Promise<ManifestKey[]> {
  const [ha, hb] = [await componentHashes(a), await componentHashes(b)];
  return MANIFEST_KEYS.filter((k) => ha[k] !== hb[k]);
}

/**
 * Keys a vary list permits to differ. Derived keys follow their cause: the
 * image changes with harness, harness_version or toolchain; provider routes
 * change with models. backend_version is never allowed to differ.
 */
export function allowedDiffs(vary: readonly VaryKey[]): Set<ManifestKey> {
  const allowed = new Set<ManifestKey>(vary);
  if (
    vary.some((k) => ["harness", "harness_version", "toolchain"].includes(k))
  ) {
    allowed.add("image_digest");
  }
  if (vary.includes("models")) allowed.add("provider_routes");
  return allowed;
}

/** Refuse a variant whose manifest differs from the baseline outside `vary`. */
export async function assertVaryHolds(
  baseline: ResolvedManifest,
  variant: ResolvedManifest,
  vary: readonly VaryKey[],
): Promise<void> {
  const allowed = allowedDiffs(vary);
  const bad = (await diffManifests(baseline, variant)).filter((k) =>
    !allowed.has(k)
  );
  if (bad.length > 0) {
    throw new ConfigurationError(
      `${variant.config_id} differs from ${baseline.config_id} outside vary [${
        vary.join(", ")
      }]: ${bad.join(", ")}`,
    );
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/manifest.test.ts`
Expected: `ok | 6 passed | 0 failed`.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/manifest.ts tests/unit/harness/manifest.test.ts
deno lint src/harness/manifest.ts tests/unit/harness/manifest.test.ts
deno fmt src/harness/manifest.ts tests/unit/harness/manifest.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/manifest.ts tests/unit/harness/manifest.test.ts
git commit -m "feat(harness): resolved manifest, component diff, vary enforcement"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/manifest.test.ts` prints `ok | 6 passed | 0 failed`.

---

### Task M1-06: statistics for the primary metric

Spec 1a section 1 (primary metric: total spend over all executions divided by passing executions), section 9 (task is the unit; per-task arm means; paired task-level bootstrap keeping repeats together; equal task weight; "not distinguishable", never "equal"; pass rate as mean of per-repeat pass rates; pass^k), D8 (unknown is null, never 0). The bootstrap is seeded so a report is reproducible; the seed goes into the JSON.

**Deps:** M1-03 (`PrimaryMetric` type only).

**Files:**
- Create: `src/harness/stats.ts`
- Test: `tests/unit/harness/stats.test.ts`

**Interfaces:**
- Consumes: `type PrimaryMetric` (M1-03); `percentile` from `cli/commands/report/stats-calculator.ts`.
- Produces: `interface Cell { task: string; arm: string; repeat: number; pass: boolean | null; cost_usd: number | null }`; `mulberry32(seed: number): () => number`; `interface ArmSummary { arm; tasks; cells; unscored_cells; cost_incomplete_cells; cost_per_solved_task: number | null; pass_rate: number | null; pass_k: number | null; pass_k_tasks }`; `armSummary(cells: Cell[], arm: string, k: number): ArmSummary`; `interface Comparison { metric; baseline; variant; tasks; tasks_dropped; delta: number | null; ci: [number, number] | null; level; undefined_share; distinguishable: boolean | null; resamples; seed }`; `interface BootstrapOptions { resamples?: number; seed?: number; level?: number }`; `compareArms(cells, baseline, variant, metric, opts?): Comparison`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/stats.test.ts`:

```typescript
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  armSummary,
  type Cell,
  compareArms,
  mulberry32,
} from "../../../src/harness/stats.ts";

function cells(
  arm: string,
  task: string,
  rows: Array<[boolean | null, number | null]>,
): Cell[] {
  return rows.map(([pass, cost_usd], i) => ({
    task,
    arm,
    repeat: i + 1,
    pass,
    cost_usd,
  }));
}

Deno.test("mulberry32: deterministic per seed", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const xs = [a(), a(), a()];
  assertEquals(xs, [b(), b(), b()]);
  assert(xs.every((x) => x >= 0 && x < 1));
  assert(mulberry32(43)() !== xs[0]);
});

Deno.test("armSummary: cost per solved task, pass rate, pass^k", () => {
  const cs = [
    ...cells("A", "t1", [[true, 1], [false, 1], [true, 1]]),
    ...cells("A", "t2", [[true, 2], [true, 2], [true, 2]]),
  ];
  const s = armSummary(cs, "A", 3);
  // (1 + 2) / (2/3 + 1) = 1.8
  assertAlmostEquals(s.cost_per_solved_task!, 1.8, 1e-12);
  assertAlmostEquals(s.pass_rate!, (2 / 3 + 1) / 2, 1e-12);
  assertEquals(s.pass_k, 0.5);
  assertEquals(s.tasks, 2);
  assertEquals(s.cells, 6);
});

Deno.test("armSummary: every task has equal weight", () => {
  const cs = [
    ...cells("A", "t1", [[true, 10]]),
    ...cells("A", "t2", [[true, 1], [true, 1], [true, 1]]),
  ];
  // per-task means 10 and 1 -> 11 / 2, not the pooled 13 / 4
  assertEquals(armSummary(cs, "A", 3).cost_per_solved_task, 5.5);
});

Deno.test("armSummary: failed attempts' spend counts, unknown cost and unscored are counted not guessed", () => {
  const cs = [
    ...cells("A", "t1", [[true, 3], [false, 3], [true, null], [null, 1]]),
  ];
  const s = armSummary(cs, "A", 4);
  // cost uses the two cells with known cost: mean 3 / pass 0.5 = 6
  assertEquals(s.cost_per_solved_task, 6);
  assertAlmostEquals(s.pass_rate!, 2 / 3, 1e-12);
  assertEquals(s.cost_incomplete_cells, 1);
  assertEquals(s.unscored_cells, 1);
  assertEquals(s.pass_k, null);
});

Deno.test("armSummary: no solved task gives null, not Infinity or 0", () => {
  const s = armSummary(cells("A", "t1", [[false, 2], [false, 2]]), "A", 2);
  assertEquals(s.cost_per_solved_task, null);
  assertEquals(s.pass_rate, 0);
});

function twoArms(variantCost: number): Cell[] {
  const out: Cell[] = [];
  for (let t = 1; t <= 8; t++) {
    const pass: Array<[boolean, number]> = [[true, 2], [t % 2 === 0, 2], [
      true,
      2,
    ]];
    out.push(...cells("base", `t${t}`, pass));
    out.push(
      ...cells(
        "var",
        `t${t}`,
        pass.map(([p]) => [p, variantCost] as [boolean, number]),
      ),
    );
  }
  return out;
}

Deno.test("compareArms: cheaper on every task is distinguishable and reproducible", () => {
  const cs = twoArms(1);
  const r1 = compareArms(cs, "base", "var", "cost_per_solved_task", {
    seed: 7,
    resamples: 500,
  });
  const r2 = compareArms(cs, "base", "var", "cost_per_solved_task", {
    seed: 7,
    resamples: 500,
  });
  assertEquals(r1, r2);
  assert(r1.delta! < 0);
  assert(r1.ci![1] < 0);
  assertEquals(r1.distinguishable, true);
  assertEquals(r1.tasks, 8);
});

Deno.test("compareArms: identical arms are not distinguishable", () => {
  const r = compareArms(twoArms(2), "base", "var", "cost_per_solved_task", {
    resamples: 200,
  });
  assertEquals(r.delta, 0);
  assertEquals(r.ci, [0, 0]);
  assertEquals(r.distinguishable, false);
});

Deno.test("compareArms: pass_rate metric and dropped tasks", () => {
  const cs = [
    ...cells("base", "t1", [[true, 1], [false, 1]]),
    ...cells("var", "t1", [[true, 1], [true, 1]]),
    ...cells("var", "t2", [[true, 1]]),
  ];
  const r = compareArms(cs, "base", "var", "pass_rate", { resamples: 100 });
  assertEquals(r.delta, 0.5);
  assertEquals(r.tasks, 1);
  assertEquals(r.tasks_dropped, 1);
});

Deno.test("compareArms: undefined resamples are counted, not dropped silently", () => {
  const cs = [
    ...cells("base", "t1", [[true, 1]]),
    ...cells("var", "t1", [[true, 1]]),
    ...cells("base", "t2", [[true, 1]]),
    ...cells("var", "t2", [[false, 1]]),
  ];
  const r = compareArms(cs, "base", "var", "cost_per_solved_task", {
    resamples: 400,
    seed: 3,
  });
  // resamples drawing t2 twice leave the variant with no solved task
  assert(r.undefined_share > 0 && r.undefined_share < 1);
  assertEquals(r.delta, 1);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/stats.test.ts`
Expected: FAIL, `Module not found ".../src/harness/stats.ts"`.

- [ ] **Step 3: Implement**

`src/harness/stats.ts`:

```typescript
/**
 * Harness Bench statistics (spec 1a section 9). Tasks are the unit: per task,
 * each arm's mean over its repeats; arms compared over tasks with a paired
 * task-level bootstrap (resample tasks, keep each task's repeats together).
 * Every task has equal weight.
 */

import { percentile } from "../../cli/commands/report/stats-calculator.ts";
import type { PrimaryMetric } from "./config.ts";

/** One (task, repeat, arm) cell. Cost sums every attempt of the cell. */
export interface Cell {
  task: string;
  arm: string;
  repeat: number;
  /** null = unscored (never judged). */
  pass: boolean | null;
  /** null = primary metric incomplete for this cell (spec 1a section 5). */
  cost_usd: number | null;
}

/** Deterministic PRNG so a report's CI is reproducible from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TaskMean {
  pass: number;
  cost: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Per-task means for one arm. `forCost` keeps only cells eligible for the
 * cost metric (judged and cost known); otherwise judged cells only.
 */
function taskMeans(
  cells: Cell[],
  arm: string,
  forCost: boolean,
): Map<string, TaskMean> {
  const byTask = new Map<string, Cell[]>();
  for (const c of cells) {
    if (c.arm !== arm || c.pass === null) continue;
    if (forCost && c.cost_usd === null) continue;
    byTask.set(c.task, [...(byTask.get(c.task) ?? []), c]);
  }
  const out = new Map<string, TaskMean>();
  for (const [task, cs] of byTask) {
    out.set(task, {
      pass: mean(cs.map((c) => (c.pass ? 1 : 0))),
      cost: forCost ? mean(cs.map((c) => c.cost_usd!)) : 0,
    });
  }
  return out;
}

function statistic(
  metric: PrimaryMetric,
  means: TaskMean[],
): number | null {
  if (metric === "pass_rate") return mean(means.map((m) => m.pass));
  const solved = means.reduce((a, m) => a + m.pass, 0);
  return solved === 0 ? null : means.reduce((a, m) => a + m.cost, 0) / solved;
}

export interface ArmSummary {
  arm: string;
  tasks: number;
  cells: number;
  unscored_cells: number;
  /** Judged cells left out of the cost metric (cost unknown). */
  cost_incomplete_cells: number;
  cost_per_solved_task: number | null;
  pass_rate: number | null;
  /** Share of tasks passing all k repeats, over tasks with k judged repeats. */
  pass_k: number | null;
  pass_k_tasks: number;
}

export function armSummary(cells: Cell[], arm: string, k: number): ArmSummary {
  const mine = cells.filter((c) => c.arm === arm);
  const judged = taskMeans(cells, arm, false);
  const costed = taskMeans(cells, arm, true);
  const perTask = new Map<string, boolean[]>();
  for (const c of mine) {
    if (c.pass === null) continue;
    perTask.set(c.task, [...(perTask.get(c.task) ?? []), c.pass]);
  }
  const full = [...perTask.values()].filter((ps) => ps.length === k);
  return {
    arm,
    tasks: new Set(mine.map((c) => c.task)).size,
    cells: mine.length,
    unscored_cells: mine.filter((c) => c.pass === null).length,
    cost_incomplete_cells:
      mine.filter((c) => c.pass !== null && c.cost_usd === null).length,
    cost_per_solved_task: costed.size === 0
      ? null
      : statistic("cost_per_solved_task", [...costed.values()]),
    pass_rate: judged.size === 0
      ? null
      : statistic("pass_rate", [...judged.values()]),
    pass_k: full.length === 0
      ? null
      : full.filter((ps) => ps.every(Boolean)).length / full.length,
    pass_k_tasks: full.length,
  };
}

export interface Comparison {
  metric: PrimaryMetric;
  baseline: string;
  variant: string;
  /** Tasks with data in both arms; the bootstrap unit. */
  tasks: number;
  /** Tasks present in only one arm, left out of the comparison. */
  tasks_dropped: number;
  /** variant minus baseline; null when undefined (no solved task). */
  delta: number | null;
  ci: [number, number] | null;
  level: number;
  /** Share of resamples where the delta was undefined. */
  undefined_share: number;
  /** false = "not distinguishable" (CI includes zero). Never "equal". */
  distinguishable: boolean | null;
  resamples: number;
  seed: number;
}

export interface BootstrapOptions {
  resamples?: number;
  seed?: number;
  level?: number;
}

/** Paired task-level bootstrap of variant minus baseline. */
export function compareArms(
  cells: Cell[],
  baseline: string,
  variant: string,
  metric: PrimaryMetric,
  opts: BootstrapOptions = {},
): Comparison {
  const resamples = opts.resamples ?? 2000;
  const seed = opts.seed ?? 1;
  const level = opts.level ?? 0.95;
  const forCost = metric === "cost_per_solved_task";
  const b = taskMeans(cells, baseline, forCost);
  const v = taskMeans(cells, variant, forCost);
  const tasks = [...b.keys()].filter((t) => v.has(t)).sort();
  const allTasks = new Set([...b.keys(), ...v.keys()]);
  const delta = (sample: string[]): number | null => {
    const sb = statistic(metric, sample.map((t) => b.get(t)!));
    const sv = statistic(metric, sample.map((t) => v.get(t)!));
    return sb === null || sv === null ? null : sv - sb;
  };
  const base = {
    metric,
    baseline,
    variant,
    tasks: tasks.length,
    tasks_dropped: allTasks.size - tasks.length,
    level,
    resamples,
    seed,
  };
  if (tasks.length === 0) {
    return {
      ...base,
      delta: null,
      ci: null,
      undefined_share: 1,
      distinguishable: null,
    };
  }
  const rand = mulberry32(seed);
  const deltas: number[] = [];
  let undefinedCount = 0;
  for (let i = 0; i < resamples; i++) {
    const sample = tasks.map(() => tasks[Math.floor(rand() * tasks.length)]!);
    const d = delta(sample);
    if (d === null) undefinedCount++;
    else deltas.push(d);
  }
  const alpha = (1 - level) / 2;
  const ci: [number, number] | null = deltas.length === 0
    ? null
    : [percentile(deltas, alpha), percentile(deltas, 1 - alpha)];
  return {
    ...base,
    delta: delta(tasks),
    ci,
    undefined_share: undefinedCount / resamples,
    distinguishable: ci === null ? null : !(ci[0] <= 0 && 0 <= ci[1]),
  };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/stats.test.ts`
Expected: `ok | 9 passed | 0 failed`.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/stats.ts tests/unit/harness/stats.test.ts
deno lint src/harness/stats.ts tests/unit/harness/stats.test.ts
deno fmt src/harness/stats.ts tests/unit/harness/stats.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/stats.ts tests/unit/harness/stats.test.ts
git commit -m "feat(harness): cost per solved task with paired task bootstrap"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/stats.test.ts` prints `ok | 9 passed | 0 failed`.

---

### Task M1-07: records, campaign plan and the record store

Spec 1a section 6 (execution, artifact, judgment records; campaign with randomized, recorded arm order inside (task, repeat) blocks, D17; immutable JSON under `results/harness/`), section 5 (telemetry fields, all nullable, D8), section 8 (termination, verdict, validity values; per-procedure results; "zero tests after publish is infra, not a fail"). Blocks are repeat-major so a partial campaign covers every task once before any second repeat (section 6 staged runs).

**Deps:** M1-03, M1-04, M1-05, M1-06.

**Files:**
- Create: `src/harness/records.ts`
- Create: `tests/unit/harness/fixtures.ts` (record builders reused by M1-08, M1-09, M1-10)
- Test: `tests/unit/harness/records.test.ts`

**Interfaces:**
- Consumes: `ExperimentSchema` (M1-03), `TaskSetIdentitySchema` (M1-04), `ResolvedManifestSchema` (M1-05), `mulberry32` (M1-06).
- Produces: `TERMINATIONS`, `VERDICTS`, `VALIDITY_FLAGS`; `TelemetrySchema`/`Telemetry`; `ExecutionRecordSchema`/`ExecutionRecord`; `ArtifactRecordSchema`/`ArtifactRecord`; `JudgmentRecordSchema`/`JudgmentRecord`; `BlockSchema`/`Block`; `CampaignRecordSchema`/`CampaignRecord`; `planBlocks(taskIds: string[], repeats: number, arms: string[], seed: number): Block[]`; `class RecordStore { constructor(root: string); writeCampaign; writeExecution; writeArtifact; writeJudgment; campaigns(experimentId): Promise<CampaignRecord[]> (newest first); executions(campaignId): Promise<ExecutionRecord[]>; judgments(artifactHash): Promise<JudgmentRecord[]> (oldest first) }`. Fixtures: `H`, `CAMPAIGN_ID`, `manifest`, `telemetry`, `campaign`, `execution`, `judgment`.

- [ ] **Step 1: Write the fixtures and the failing test**

`tests/unit/harness/fixtures.ts`:

```typescript
/** Record builders for harness unit tests. Override any field per test. */

import { ExperimentSchema } from "../../../src/harness/config.ts";
import {
  type ResolvedManifest,
  ResolvedManifestSchema,
} from "../../../src/harness/manifest.ts";
import type {
  CampaignRecord,
  ExecutionRecord,
  JudgmentRecord,
  Telemetry,
} from "../../../src/harness/records.ts";

export const H = (c: string) => c.repeat(64);
export const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000001";

export function manifest(
  config_id: string,
  over: Partial<ResolvedManifest> = {},
): ResolvedManifest {
  return ResolvedManifestSchema.parse({
    v: 1,
    rules: "hr1",
    config_id,
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/model-a" },
    settings: {},
    limits: { timeout_min: 30, max_budget_usd: 5 },
    instructions: null,
    skills: null,
    agents: null,
    hooks: null,
    plugins: [],
    mcp: [],
    lsp: [],
    toolchain: [],
    image_digest: "sha256:img",
    backend_version: "b1",
    provider_routes: {},
    ...over,
  });
}

export function telemetry(cost_usd: number | null): Telemetry {
  return {
    harness_version: "2.1.282",
    cost_usd,
    cost_source: cost_usd === null ? null : "estimated",
    pricing_snapshot: cost_usd === null ? null : "2026-09-30",
    reported_cost_usd: null,
    per_model: [],
    turns: null,
    compactions: null,
    wall_ms: null,
    exit_code: 0,
    stop_reason: null,
    refusal_detected: null,
    raw_usage: null,
  };
}

export function campaign(over: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    v: 1,
    id: CAMPAIGN_ID,
    experiment: ExperimentSchema.parse({
      id: "skills-vs-plain",
      hypothesis: "Skills cut cost per solved task.",
      primary_metric: "cost_per_solved_task",
      baseline: "plain",
      variants: ["skills"],
      vary: ["skills"],
      tasks: "harness-tasks/tasks/*",
      repeats: 1,
    }),
    experiment_hash: H("e"),
    created_at: "2026-10-01T10:00:00.000Z",
    seed: 1,
    reuse_history: false,
    task_set: {
      identity: H("t"),
      provisional: false,
      tasks: [
        {
          id: "HX-001",
          refapp_commit: "c".repeat(40),
          visible: H("1"),
          oracle: H("2"),
        },
        {
          id: "HX-002",
          refapp_commit: "c".repeat(40),
          visible: H("3"),
          oracle: H("4"),
        },
      ],
    },
    arms: [
      {
        config_id: "plain",
        manifest_hash: H("a"),
        manifest: manifest("plain"),
      },
      {
        config_id: "skills",
        manifest_hash: H("b"),
        manifest: manifest("skills", {
          skills: { path: "bundles/s", hash: H("5") },
        }),
      },
    ],
    blocks: [
      { index: 0, task_id: "HX-001", repeat: 1, order: ["skills", "plain"] },
      { index: 1, task_id: "HX-002", repeat: 1, order: ["plain", "skills"] },
    ],
    ...over,
  };
}

let seq = 0;
export function execution(
  over: Partial<ExecutionRecord> = {},
): ExecutionRecord {
  seq++;
  return {
    v: 1,
    id: `00000000-0000-4000-9000-${String(seq).padStart(12, "0")}`,
    campaign_id: CAMPAIGN_ID,
    block: 0,
    order_in_block: 0,
    arm: "plain",
    task_id: "HX-001",
    task_visible_hash: H("1"),
    repeat: 1,
    attempt: 1,
    started_at: "2026-10-01T10:01:00.000Z",
    ended_at: "2026-10-01T10:11:00.000Z",
    manifest: manifest("plain"),
    manifest_hash: H("a"),
    observed: { harness_version: null, models: null, loaded_components: null },
    termination: "completed",
    did_work: true,
    validity: [],
    telemetry: telemetry(1),
    trace_path: null,
    host_log_path: null,
    raw_log_path: null,
    container_assignments: ["Cronus281"],
    artifact_hash: H(String(seq % 10)),
    ...over,
  };
}

export function judgment(
  artifact_hash: string,
  execution_id: string,
  passed: boolean | null,
  over: Partial<JudgmentRecord> = {},
): JudgmentRecord {
  seq++;
  return {
    v: 1,
    id: `00000000-0000-4000-a000-${String(seq).padStart(12, "0")}`,
    artifact_hash,
    execution_id,
    task_id: "HX-001",
    task_oracle_hash: H("2"),
    scorer_versions: { build: "1" },
    scorers: [{ name: "build", passed, tests: [] }],
    verdict: passed === null ? "unscored" : passed ? "pass" : "fail",
    verdict_container: "Cronus282",
    started_at: "2026-10-01T10:12:00.000Z",
    ended_at: "2026-10-01T10:14:00.000Z",
    ...over,
  };
}
```

`tests/unit/harness/records.test.ts`:

```typescript
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { ValidationError } from "../../../src/errors.ts";
import {
  CampaignRecordSchema,
  ExecutionRecordSchema,
  JudgmentRecordSchema,
  planBlocks,
  RecordStore,
} from "../../../src/harness/records.ts";
import { campaign, CAMPAIGN_ID, execution, judgment } from "./fixtures.ts";

Deno.test("planBlocks: repeat-major, every block a permutation, seeded", () => {
  const arms = ["a", "b", "c"];
  const blocks = planBlocks(["HX-002", "HX-001"], 2, arms, 5);
  assertEquals(
    blocks.map((b) => `${b.repeat}:${b.task_id}`),
    ["1:HX-001", "1:HX-002", "2:HX-001", "2:HX-002"],
  );
  for (const b of blocks) assertEquals([...b.order].sort(), arms);
  assertEquals(planBlocks(["HX-001", "HX-002"], 2, arms, 5), blocks);
  const orders = new Set(
    planBlocks(["t1", "t2", "t3", "t4", "t5", "t6"], 3, arms, 5).map((b) =>
      b.order.join()
    ),
  );
  assert(orders.size > 1, "order must actually vary between blocks");
});

Deno.test("schemas: fixtures are valid", () => {
  CampaignRecordSchema.parse(campaign());
  const e = execution();
  ExecutionRecordSchema.parse(e);
  JudgmentRecordSchema.parse(judgment(e.artifact_hash!, e.id, true));
});

Deno.test("schemas: loud on bad records", () => {
  assertThrows(() => ExecutionRecordSchema.parse({ ...execution(), extra: 1 }));
  assertThrows(() =>
    ExecutionRecordSchema.parse({ ...execution(), termination: "crashed" })
  );
  assertThrows(() =>
    ExecutionRecordSchema.parse({
      ...execution(),
      validity: ["infra_exposed", "infra_exposed"],
    })
  );
  const e = execution();
  assertThrows(() =>
    JudgmentRecordSchema.parse({
      ...judgment(e.artifact_hash!, e.id, false),
      verdict: "pass",
    })
  );
  assertThrows(() =>
    CampaignRecordSchema.parse(
      campaign({ task_set: { ...campaign().task_set, provisional: true } }),
    )
  );
  assertThrows(() =>
    CampaignRecordSchema.parse(
      campaign({
        blocks: [{
          index: 0,
          task_id: "HX-001",
          repeat: 1,
          order: ["plain", "plain"],
        }],
      }),
    )
  );
});

Deno.test("RecordStore: round trip, write-once, newest campaign first", async () => {
  const store = new RecordStore(await Deno.makeTempDir());
  const c = campaign();
  await store.writeCampaign(c);
  await store.writeCampaign(
    campaign({
      id: "00000000-0000-4000-8000-000000000002",
      created_at: "2026-10-02T00:00:00.000Z",
    }),
  );
  assertEquals(
    (await store.campaigns("skills-vs-plain")).map((x) => x.id),
    ["00000000-0000-4000-8000-000000000002", CAMPAIGN_ID],
  );
  const e = execution();
  await store.writeExecution(e);
  assertEquals(await store.executions(CAMPAIGN_ID), [e]);
  await assertRejects(
    () => store.writeExecution(e),
    ValidationError,
    "immutable",
  );
  const j1 = judgment(e.artifact_hash!, e.id, null);
  const j2 = judgment(e.artifact_hash!, e.id, true, {
    ended_at: "2026-10-03T00:00:00.000Z",
  });
  await store.writeJudgment(j2);
  await store.writeJudgment(j1);
  assertEquals((await store.judgments(e.artifact_hash!)).map((j) => j.id), [
    j1.id,
    j2.id,
  ]);
  assertEquals(
    await store.executions("00000000-0000-4000-8000-00000000dead"),
    [],
  );
});

Deno.test("RecordStore: a hand-edited record fails on read", async () => {
  const root = await Deno.makeTempDir();
  const store = new RecordStore(root);
  const e = execution();
  await store.writeExecution(e);
  const path = `${root}/executions/${CAMPAIGN_ID}/${e.id}.json`;
  const text = await Deno.readTextFile(path);
  await Deno.writeTextFile(path, text.replace('"completed"', '"done"'));
  await assertRejects(
    () => store.executions(CAMPAIGN_ID),
    ValidationError,
    "termination",
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/records.test.ts`
Expected: FAIL, `Module not found ".../src/harness/records.ts"`.

- [ ] **Step 3: Implement**

`src/harness/records.ts`:

```typescript
/**
 * Harness Bench records (spec 1a sections 6 and 8): immutable JSON under
 * results/harness/. An execution is one attempt of one (task, repeat, arm)
 * cell; a rerun adds an execution, a rejudge adds a judgment.
 *
 * Layout:
 *   campaigns/<campaign-id>.json
 *   executions/<campaign-id>/<execution-id>.json
 *   artifacts/<artifact-hash>.json
 *   judgments/<artifact-hash>/<judgment-id>.json
 */

import { join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { ExperimentSchema } from "./config.ts";
import { TaskSetIdentitySchema } from "./identity.ts";
import { ResolvedManifestSchema } from "./manifest.ts";
import { mulberry32 } from "./stats.ts";

const Sha = z.string().length(64);
const Iso = z.iso.datetime();
const n = z.number().nonnegative().nullable();

export const TERMINATIONS = [
  "completed",
  "timeout",
  "budget_exhausted",
  "refusal",
  "usage_limited",
  "harness_crash",
  "setup_failed",
] as const;
export const VERDICTS = ["pass", "fail", "unscored"] as const;
export const VALIDITY_FLAGS = [
  "incomplete_telemetry",
  "infra_exposed",
] as const;

/** Run totals from the harness (spec 1a section 5). Every field nullable. */
export const TelemetrySchema = z.strictObject({
  harness_version: z.string().nullable(),
  /** List-price cost from reported tokens (the primary-metric input). */
  cost_usd: n,
  cost_source: z.enum(["reported", "estimated"]).nullable(),
  pricing_snapshot: z.string().nullable(),
  /** The harness's own reported cost, kept for cross-checking. */
  reported_cost_usd: n,
  per_model: z.array(z.strictObject({
    model: z.string(),
    requests: n,
    tokens_in_uncached: n,
    tokens_cache_read: n,
    tokens_cache_write: n,
    tokens_out: n,
    tokens_reasoning: n,
    cost_usd: n,
  })),
  turns: n,
  compactions: n,
  wall_ms: n,
  exit_code: z.number().int().nullable(),
  stop_reason: z.string().nullable(),
  refusal_detected: z.boolean().nullable(),
  raw_usage: z.unknown(),
});
export type Telemetry = z.output<typeof TelemetrySchema>;

export const ExecutionRecordSchema = z.strictObject({
  v: z.literal(1),
  id: z.uuid(),
  campaign_id: z.uuid(),
  block: z.number().int().nonnegative(),
  order_in_block: z.number().int().nonnegative(),
  arm: z.string(),
  task_id: z.string(),
  task_visible_hash: Sha,
  repeat: z.number().int().positive(),
  attempt: z.number().int().positive(),
  started_at: Iso,
  ended_at: Iso,
  manifest: ResolvedManifestSchema,
  manifest_hash: Sha,
  /** What actually ran; filled by the adapter (Part 2). */
  observed: z.strictObject({
    harness_version: z.string().nullable(),
    models: z.array(z.string()).nullable(),
    loaded_components: z.array(z.string()).nullable(),
  }),
  termination: z.enum(TERMINATIONS),
  /** Whether the agent changed the workspace before stopping. */
  did_work: z.boolean(),
  /** Empty = complete. */
  validity: z.array(z.enum(VALIDITY_FLAGS)),
  telemetry: TelemetrySchema,
  trace_path: z.string().nullable(),
  host_log_path: z.string().nullable(),
  raw_log_path: z.string().nullable(),
  container_assignments: z.array(z.string()),
  artifact_hash: Sha.nullable(),
}).refine((e) => new Set(e.validity).size === e.validity.length, {
  message: "duplicate validity flag",
  path: ["validity"],
});
export type ExecutionRecord = z.output<typeof ExecutionRecordSchema>;

export const ArtifactRecordSchema = z.strictObject({
  v: z.literal(1),
  hash: Sha,
  execution_id: z.uuid(),
  stored_path: z.string().min(1),
  created_at: Iso,
});
export type ArtifactRecord = z.output<typeof ArtifactRecordSchema>;

export const JudgmentRecordSchema = z.strictObject({
  v: z.literal(1),
  id: z.uuid(),
  artifact_hash: Sha,
  execution_id: z.uuid(),
  task_id: z.string(),
  task_oracle_hash: Sha,
  scorer_versions: z.record(z.string(), z.string()),
  scorers: z.array(z.strictObject({
    name: z.string(),
    /** null = infra fault, not a fail (GH #13 rule). */
    passed: z.boolean().nullable(),
    tests: z.array(z.strictObject({
      codeunit: z.number().int(),
      procedure: z.string(),
      outcome: z.enum(["pass", "fail", "error", "not_run"]),
    })),
  })).min(1),
  verdict: z.enum(VERDICTS),
  verdict_container: z.string().nullable(),
  started_at: Iso,
  ended_at: Iso,
}).refine((j) => {
  const expected = j.scorers.some((s) => s.passed === null)
    ? "unscored"
    : j.scorers.every((s) => s.passed)
    ? "pass"
    : "fail";
  return j.verdict === expected;
}, { message: "verdict disagrees with scorer results", path: ["verdict"] });
export type JudgmentRecord = z.output<typeof JudgmentRecordSchema>;

export const BlockSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  task_id: z.string(),
  repeat: z.number().int().positive(),
  order: z.array(z.string()).min(1),
});
export type Block = z.output<typeof BlockSchema>;

export const CampaignRecordSchema = z.strictObject({
  v: z.literal(1),
  id: z.uuid(),
  experiment: ExperimentSchema,
  experiment_hash: Sha,
  created_at: Iso,
  seed: z.number().int().nonnegative(),
  reuse_history: z.boolean(),
  task_set: TaskSetIdentitySchema,
  arms: z.array(z.strictObject({
    config_id: z.string(),
    manifest_hash: Sha,
    manifest: ResolvedManifestSchema,
  })).min(2),
  blocks: z.array(BlockSchema).min(1),
}).superRefine((c, ctx) => {
  if (c.task_set.provisional) {
    ctx.addIssue({
      code: "custom",
      message: "campaign needs a non-provisional task set (symbols manifest)",
      path: ["task_set"],
    });
  }
  const arms = c.arms.map((a) => a.config_id).sort().join(",");
  c.blocks.forEach((b, i) => {
    if ([...b.order].sort().join(",") !== arms) {
      ctx.addIssue({
        code: "custom",
        message: "block order must be a permutation of the arms",
        path: ["blocks", i, "order"],
      });
    }
  });
});
export type CampaignRecord = z.output<typeof CampaignRecordSchema>;

/**
 * One block per (task, repeat), repeat-major so a partial campaign covers
 * every task at repeat 1 first. Arm order inside a block is a seeded
 * Fisher-Yates shuffle (spec 1a section 6, D17).
 */
export function planBlocks(
  taskIds: string[],
  repeats: number,
  arms: string[],
  seed: number,
): Block[] {
  const rand = mulberry32(seed);
  const blocks: Block[] = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const task_id of [...taskIds].sort()) {
      const order = [...arms];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      blocks.push({ index: blocks.length, task_id, repeat, order });
    }
  }
  return blocks;
}

async function writeOnce(path: string, value: unknown): Promise<void> {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  try {
    await Deno.writeTextFile(path, JSON.stringify(value, null, 2) + "\n", {
      createNew: true,
    });
  } catch (err) {
    if (err instanceof Deno.errors.AlreadyExists) {
      throw new ValidationError(
        `record is immutable, already exists: ${path}`,
        [
          path,
        ],
      );
    }
    throw err;
  }
}

async function readRecord<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.output<T>> {
  const result = schema.safeParse(JSON.parse(await Deno.readTextFile(path)));
  if (!result.success) {
    const errors = result.error.issues.map((i) =>
      `${i.path.join(".") || "(root)"}: ${i.message}`
    );
    throw new ValidationError(
      `Invalid record ${path}:\n  ${errors.join("\n  ")}`,
      errors,
    );
  }
  return result.data;
}

async function readAll<T extends z.ZodType>(
  dir: string,
  schema: T,
): Promise<z.output<T>[]> {
  const out: z.output<T>[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith(".json")) {
        out.push(await readRecord(join(dir, e.name), schema));
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return out;
    throw err;
  }
  return out;
}

/** Validating, write-once record store rooted at results/harness. */
export class RecordStore {
  constructor(readonly root: string) {}

  writeCampaign(c: CampaignRecord): Promise<void> {
    return writeOnce(
      join(this.root, "campaigns", `${c.id}.json`),
      CampaignRecordSchema.parse(c),
    );
  }

  writeExecution(e: ExecutionRecord): Promise<void> {
    return writeOnce(
      join(this.root, "executions", e.campaign_id, `${e.id}.json`),
      ExecutionRecordSchema.parse(e),
    );
  }

  writeArtifact(a: ArtifactRecord): Promise<void> {
    return writeOnce(
      join(this.root, "artifacts", `${a.hash}.json`),
      ArtifactRecordSchema.parse(a),
    );
  }

  writeJudgment(j: JudgmentRecord): Promise<void> {
    return writeOnce(
      join(this.root, "judgments", j.artifact_hash, `${j.id}.json`),
      JudgmentRecordSchema.parse(j),
    );
  }

  /** Campaigns of one experiment, newest first. */
  async campaigns(experimentId: string): Promise<CampaignRecord[]> {
    const all = await readAll(
      join(this.root, "campaigns"),
      CampaignRecordSchema,
    );
    return all.filter((c) => c.experiment.id === experimentId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  executions(campaignId: string): Promise<ExecutionRecord[]> {
    return readAll(
      join(this.root, "executions", campaignId),
      ExecutionRecordSchema,
    );
  }

  /** Judgments of one artifact, oldest first. */
  async judgments(artifactHash: string): Promise<JudgmentRecord[]> {
    const all = await readAll(
      join(this.root, "judgments", artifactHash),
      JudgmentRecordSchema,
    );
    return all.sort((a, b) => a.ended_at.localeCompare(b.ended_at));
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/records.test.ts`
Expected: `ok | 5 passed | 0 failed`.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/records.ts tests/unit/harness/records.test.ts tests/unit/harness/fixtures.ts
deno lint src/harness/records.ts tests/unit/harness/records.test.ts tests/unit/harness/fixtures.ts
deno fmt src/harness/records.ts tests/unit/harness/records.test.ts tests/unit/harness/fixtures.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/records.ts tests/unit/harness/records.test.ts tests/unit/harness/fixtures.ts
git commit -m "feat(harness): immutable records, seeded campaign blocks, record store"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/records.test.ts` prints `ok | 5 passed | 0 failed`.

---

### Task M1-08: termination rules and records-to-cells

Spec 1a section 8: `timeout`, `budget_exhausted` and `refusal` are judged; `harness_crash` is judged only after the agent did work; `harness_crash` before work and `setup_failed` get one automatic retry; `usage_limited` is unscored, pauses the campaign and retries the cell; rejudging adds a judgment (newest wins), rerunning adds an execution (final attempt wins); every attempt's cost stays in the cell.

**Deps:** M1-06, M1-07.

**Files:**
- Create: `src/harness/outcome.ts`
- Test: `tests/unit/harness/outcome.test.ts`

**Interfaces:**
- Consumes: `CampaignRecord`, `ExecutionRecord`, `JudgmentRecord`, `TERMINATIONS` (M1-07); `Cell` (M1-06).
- Produces: `type Termination`; `interface OutcomePolicy { judge: boolean; retry: "none" | "once" | "after_usage_reset" }`; `outcomePolicy(termination: Termination, didWork: boolean): OutcomePolicy`; `cellsFromRecords(campaign: CampaignRecord, executions: ExecutionRecord[], judgments: Map<string, JudgmentRecord[]>): Cell[]` (one cell per planned block x arm).

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/outcome.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import {
  cellsFromRecords,
  outcomePolicy,
} from "../../../src/harness/outcome.ts";
import type { JudgmentRecord } from "../../../src/harness/records.ts";
import { campaign, execution, H, judgment, telemetry } from "./fixtures.ts";

Deno.test("outcomePolicy: spec 1a section 8 table", () => {
  const judged = { judge: true, retry: "none" };
  assertEquals(outcomePolicy("completed", true), judged);
  assertEquals(outcomePolicy("timeout", true), judged);
  assertEquals(outcomePolicy("budget_exhausted", false), judged);
  assertEquals(outcomePolicy("refusal", false), judged);
  assertEquals(outcomePolicy("harness_crash", true), judged);
  assertEquals(outcomePolicy("harness_crash", false), {
    judge: false,
    retry: "once",
  });
  assertEquals(outcomePolicy("setup_failed", false), {
    judge: false,
    retry: "once",
  });
  assertEquals(outcomePolicy("usage_limited", true), {
    judge: false,
    retry: "after_usage_reset",
  });
});

function index(js: JudgmentRecord[]): Map<string, JudgmentRecord[]> {
  const m = new Map<string, JudgmentRecord[]>();
  for (const j of js) {
    m.set(j.artifact_hash, [...(m.get(j.artifact_hash) ?? []), j]);
  }
  return m;
}

Deno.test("cellsFromRecords: every planned cell appears, unrun cells are unscored", () => {
  const cells = cellsFromRecords(campaign(), [], new Map());
  assertEquals(cells.length, 4);
  assertEquals(
    cells.every((c) => c.pass === null && c.cost_usd === null),
    true,
  );
});

Deno.test("cellsFromRecords: retry spend counts, verdict from the final attempt", () => {
  const first = execution({
    termination: "setup_failed",
    did_work: false,
    artifact_hash: null,
    telemetry: telemetry(0.25),
  });
  const second = execution({
    attempt: 2,
    artifact_hash: H("7"),
    telemetry: telemetry(1),
  });
  const cells = cellsFromRecords(
    campaign(),
    [first, second],
    index([judgment(H("7"), second.id, true)]),
  );
  const cell = cells.find((c) => c.task === "HX-001" && c.arm === "plain")!;
  assertEquals(cell, {
    task: "HX-001",
    arm: "plain",
    repeat: 1,
    pass: true,
    cost_usd: 1.25,
  });
});

Deno.test("cellsFromRecords: rejudge wins, unknown cost stays null", () => {
  const e = execution({ artifact_hash: H("8"), telemetry: telemetry(null) });
  const old = judgment(H("8"), e.id, false);
  const rejudged = judgment(H("8"), e.id, true, {
    ended_at: "2026-10-05T00:00:00.000Z",
  });
  const cell = cellsFromRecords(campaign(), [e], index([rejudged, old]))
    .find((c) => c.task === "HX-001" && c.arm === "plain")!;
  assertEquals(cell.pass, true);
  assertEquals(cell.cost_usd, null);
});

Deno.test("cellsFromRecords: usage_limited and unscored verdicts are not failures", () => {
  const limited = execution({
    termination: "usage_limited",
    artifact_hash: H("9"),
  });
  const infra = execution({ arm: "skills", artifact_hash: H("6") });
  const cells = cellsFromRecords(
    campaign(),
    [limited, infra],
    index([
      judgment(H("9"), limited.id, false),
      judgment(H("6"), infra.id, null),
    ]),
  );
  const hx1 = cells.filter((c) => c.task === "HX-001");
  assertEquals(hx1.map((c) => c.pass), [null, null]);
  assertEquals(hx1.map((c) => c.cost_usd), [1, 1]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/outcome.test.ts`
Expected: FAIL, `Module not found ".../src/harness/outcome.ts"`.

- [ ] **Step 3: Implement**

`src/harness/outcome.ts`:

```typescript
/**
 * Termination rules (spec 1a section 8) and the join from immutable records
 * to per-cell results for the statistics.
 */

import type {
  CampaignRecord,
  ExecutionRecord,
  JudgmentRecord,
  TERMINATIONS,
} from "./records.ts";
import type { Cell } from "./stats.ts";

export type Termination = (typeof TERMINATIONS)[number];

export interface OutcomePolicy {
  /** Send the artifact to the verdict pipeline. false = unscored. */
  judge: boolean;
  /** once: one automatic retry. after_usage_reset: pause, then retry the cell. */
  retry: "none" | "once" | "after_usage_reset";
}

export function outcomePolicy(
  termination: Termination,
  didWork: boolean,
): OutcomePolicy {
  switch (termination) {
    case "completed":
    case "timeout":
    case "budget_exhausted":
    case "refusal":
      return { judge: true, retry: "none" };
    case "harness_crash":
      return didWork
        ? { judge: true, retry: "none" }
        : { judge: false, retry: "once" };
    case "setup_failed":
      return { judge: false, retry: "once" };
    case "usage_limited":
      return { judge: false, retry: "after_usage_reset" };
  }
}

/**
 * One Cell per planned (block, arm). Cost sums every attempt (failed and
 * retried ones included); null if any attempt's cost is unknown. Pass comes
 * from the newest judgment of the final attempt's artifact; an unjudgeable
 * final attempt, a missing judgment or an unscored verdict give null.
 */
export function cellsFromRecords(
  campaign: CampaignRecord,
  executions: ExecutionRecord[],
  judgments: Map<string, JudgmentRecord[]>,
): Cell[] {
  const key = (task: string, repeat: number, arm: string) =>
    `${task}\u0000${repeat}\u0000${arm}`;
  const byCell = new Map<string, ExecutionRecord[]>();
  for (const e of executions) {
    if (e.campaign_id !== campaign.id) continue;
    const k = key(e.task_id, e.repeat, e.arm);
    byCell.set(k, [...(byCell.get(k) ?? []), e]);
  }
  const cells: Cell[] = [];
  for (const b of campaign.blocks) {
    for (const arm of b.order) {
      const attempts = byCell.get(key(b.task_id, b.repeat, arm)) ?? [];
      const cell: Cell = {
        task: b.task_id,
        arm,
        repeat: b.repeat,
        pass: null,
        cost_usd: null,
      };
      if (attempts.length > 0) {
        const costs = attempts.map((e) => e.telemetry.cost_usd);
        cell.cost_usd = costs.includes(null)
          ? null
          : (costs as number[]).reduce((a, c) => a + c, 0);
        const final = attempts.reduce((
          a,
          e,
        ) => (e.attempt > a.attempt ? e : a));
        if (
          outcomePolicy(final.termination, final.did_work).judge &&
          final.artifact_hash !== null
        ) {
          const js = judgments.get(final.artifact_hash) ?? [];
          const latest = js.reduce<JudgmentRecord | null>(
            (a, j) => (a === null || j.ended_at > a.ended_at ? j : a),
            null,
          );
          if (latest && latest.verdict !== "unscored") {
            cell.pass = latest.verdict === "pass";
          }
        }
      }
      cells.push(cell);
    }
  }
  return cells;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/outcome.test.ts`
Expected: `ok | 5 passed | 0 failed`.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/outcome.ts tests/unit/harness/outcome.test.ts
deno lint src/harness/outcome.ts tests/unit/harness/outcome.test.ts
deno fmt src/harness/outcome.ts tests/unit/harness/outcome.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/outcome.ts tests/unit/harness/outcome.test.ts
git commit -m "feat(harness): termination rules and records-to-cells join"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/outcome.test.ts` prints `ok | 5 passed | 0 failed`.

---

### Task M1-09: report skeleton (console + JSON)

Spec 1a section 9: header (hypothesis, primary metric, component diff baseline to each variant, campaign, coverage judged/planned, incomplete-telemetry and infra-exposed counts per arm), primary (cost per solved task per arm and delta with CI, next to pass rate and its delta), outcome (pass rate, pass^k, per-task flip table). Non-primary metrics are labelled exploratory. "Output: console and JSON in 1a." Efficiency and slices are Part 2.

**Deps:** M1-05, M1-06, M1-07, M1-08.

**Files:**
- Create: `src/harness/report.ts`
- Test: `tests/unit/harness/report.test.ts`

**Interfaces:**
- Consumes: `diffManifests`, `ManifestKey` (M1-05); `armSummary`, `compareArms`, `ArmSummary`, `Comparison`, `BootstrapOptions` (M1-06); record types (M1-07); `cellsFromRecords` (M1-08).
- Produces: `interface ArmCoverage`; `interface HarnessReport { v: 1; experiment; campaign; coverage: ArmCoverage[]; diffs: { variant; differing: ManifestKey[] }[]; arms: ArmSummary[]; comparisons: (Comparison & { primary: boolean })[]; flips: { task; pass_rate: Record<string, number | null> }[] }`; `buildReport(campaign, executions, judgments, opts?: BootstrapOptions): Promise<HarnessReport>`; `renderReport(r: HarnessReport): string`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/report.test.ts`:

```typescript
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import { buildReport, renderReport } from "../../../src/harness/report.ts";
import type {
  ExecutionRecord,
  JudgmentRecord,
} from "../../../src/harness/records.ts";
import { campaign, execution, H, judgment, telemetry } from "./fixtures.ts";

/** plain: passes HX-001 only at $2 each; skills: passes both at $1 each. */
function records(): {
  es: ExecutionRecord[];
  js: Map<string, JudgmentRecord[]>;
} {
  const rows: Array<[string, string, boolean, number, string]> = [
    ["plain", "HX-001", true, 2, "1"],
    ["plain", "HX-002", false, 2, "2"],
    ["skills", "HX-001", true, 1, "3"],
    ["skills", "HX-002", true, 1, "4"],
  ];
  const es: ExecutionRecord[] = [];
  const js = new Map<string, JudgmentRecord[]>();
  for (const [arm, task, pass, cost, h] of rows) {
    const e = execution({
      arm,
      task_id: task,
      artifact_hash: H(h),
      telemetry: telemetry(cost),
      validity: arm === "skills" && task === "HX-002" ? ["infra_exposed"] : [],
    });
    es.push(e);
    js.set(H(h), [judgment(H(h), e.id, pass, { task_id: task })]);
  }
  return { es, js };
}

Deno.test("buildReport: header, coverage, primary and outcome numbers", async () => {
  const { es, js } = records();
  const r = await buildReport(campaign(), es, js, { resamples: 200, seed: 1 });
  assertEquals(r.experiment.primary_metric, "cost_per_solved_task");
  assertEquals(r.diffs, [{ variant: "skills", differing: ["skills"] }]);
  assertEquals(
    r.coverage.map((
      c,
    ) => [c.arm, c.judged_cells, c.planned_cells, c.infra_exposed]),
    [
      ["plain", 2, 2, 0],
      ["skills", 2, 2, 1],
    ],
  );
  // plain: (2 + 2) / (1 + 0) = 4; skills: (1 + 1) / 2 = 1
  assertEquals(r.arms.map((a) => a.cost_per_solved_task), [4, 1]);
  assertEquals(r.arms.map((a) => a.pass_rate), [0.5, 1]);
  const [primary, secondary] = r.comparisons;
  assertEquals([primary!.metric, primary!.primary, primary!.delta], [
    "cost_per_solved_task",
    true,
    -3,
  ]);
  assertEquals([secondary!.metric, secondary!.primary, secondary!.delta], [
    "pass_rate",
    false,
    0.5,
  ]);
  assertEquals(r.flips, [{
    task: "HX-002",
    pass_rate: { plain: 0, skills: 1 },
  }]);
});

Deno.test("buildReport: JSON round-trips", async () => {
  const { es, js } = records();
  const r = await buildReport(campaign(), es, js, { resamples: 50 });
  assertEquals(JSON.parse(JSON.stringify(r)), r);
});

Deno.test("renderReport: hypothesis first, never says equal, exploratory labelled", async () => {
  const { es, js } = records();
  const text = stripAnsiCode(
    renderReport(await buildReport(campaign(), es, js, { resamples: 200 })),
  );
  assert(text.indexOf("Hypothesis:") < text.indexOf("Primary\n"));
  assertStringIncludes(text, "Diff plain -> skills: skills");
  assertStringIncludes(text, "[exploratory]");
  assertStringIncludes(text, "infra exposed 1");
  assert(!/\bequal\b/i.test(text), "report must never claim arms are equal");
});

Deno.test("renderReport: no solved task shows n/a", async () => {
  const e = execution({ artifact_hash: H("5") });
  const js = new Map([[H("5"), [judgment(H("5"), e.id, false)]]]);
  const text = stripAnsiCode(
    renderReport(await buildReport(campaign(), [e], js, { resamples: 20 })),
  );
  assertStringIncludes(text, "cost per solved task n/a");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/report.test.ts`
Expected: FAIL, `Module not found ".../src/harness/report.ts"`.

- [ ] **Step 3: Implement**

`src/harness/report.ts`:

```typescript
/**
 * Harness report skeleton (spec 1a section 9): header, primary, outcome.
 * Efficiency and slices come in Part 2 with telemetry and traces.
 */

import * as colors from "@std/fmt/colors";
import type { PrimaryMetric } from "./config.ts";
import { diffManifests, type ManifestKey } from "./manifest.ts";
import { cellsFromRecords } from "./outcome.ts";
import type {
  CampaignRecord,
  ExecutionRecord,
  JudgmentRecord,
} from "./records.ts";
import {
  type ArmSummary,
  armSummary,
  type BootstrapOptions,
  compareArms,
  type Comparison,
} from "./stats.ts";

export interface ArmCoverage {
  arm: string;
  planned_cells: number;
  judged_cells: number;
  executions: number;
  incomplete_telemetry: number;
  infra_exposed: number;
}

export interface HarnessReport {
  v: 1;
  experiment: {
    id: string;
    hypothesis: string;
    primary_metric: PrimaryMetric;
    baseline: string;
    variants: string[];
  };
  campaign: {
    id: string;
    created_at: string;
    reuse_history: boolean;
    task_set_identity: string;
    tasks: number;
  };
  coverage: ArmCoverage[];
  diffs: Array<{ variant: string; differing: ManifestKey[] }>;
  arms: ArmSummary[];
  /** The declared primary metric first, the other one exploratory. */
  comparisons: Array<Comparison & { primary: boolean }>;
  flips: Array<{ task: string; pass_rate: Record<string, number | null> }>;
}

export async function buildReport(
  campaign: CampaignRecord,
  executions: ExecutionRecord[],
  judgments: Map<string, JudgmentRecord[]>,
  opts: BootstrapOptions = {},
): Promise<HarnessReport> {
  const exp = campaign.experiment;
  const arms = [exp.baseline, ...exp.variants];
  const cells = cellsFromRecords(campaign, executions, judgments);
  const mine = executions.filter((e) => e.campaign_id === campaign.id);
  const baseManifest = campaign.arms.find((a) => a.config_id === exp.baseline)!
    .manifest;
  const diffs = [];
  for (const variant of exp.variants) {
    const m = campaign.arms.find((a) => a.config_id === variant)!.manifest;
    diffs.push({ variant, differing: await diffManifests(baseManifest, m) });
  }
  const metrics: PrimaryMetric[] = exp.primary_metric === "pass_rate"
    ? ["pass_rate", "cost_per_solved_task"]
    : ["cost_per_solved_task", "pass_rate"];
  const comparisons = exp.variants.flatMap((variant) =>
    metrics.map((metric) => ({
      ...compareArms(cells, exp.baseline, variant, metric, opts),
      primary: metric === exp.primary_metric,
    }))
  );
  const rate = (task: string, arm: string) => {
    const ps = cells.filter((c) =>
      c.task === task && c.arm === arm && c.pass !== null
    );
    return ps.length === 0 ? null : ps.filter((c) => c.pass).length / ps.length;
  };
  const flips = campaign.task_set.tasks
    .map((t) => ({
      task: t.id,
      pass_rate: Object.fromEntries(arms.map((a) => [a, rate(t.id, a)])),
    }))
    .filter((f) => new Set(Object.values(f.pass_rate)).size > 1);
  return {
    v: 1,
    experiment: {
      id: exp.id,
      hypothesis: exp.hypothesis,
      primary_metric: exp.primary_metric,
      baseline: exp.baseline,
      variants: exp.variants,
    },
    campaign: {
      id: campaign.id,
      created_at: campaign.created_at,
      reuse_history: campaign.reuse_history,
      task_set_identity: campaign.task_set.identity,
      tasks: campaign.task_set.tasks.length,
    },
    coverage: arms.map((arm) => {
      const es = mine.filter((e) => e.arm === arm);
      return {
        arm,
        planned_cells: campaign.blocks.length,
        judged_cells: cells.filter((c) => c.arm === arm && c.pass !== null)
          .length,
        executions: es.length,
        incomplete_telemetry: es.filter((e) =>
          e.validity.includes("incomplete_telemetry")
        ).length,
        infra_exposed:
          es.filter((e) => e.validity.includes("infra_exposed")).length,
      };
    }),
    diffs,
    arms: arms.map((arm) => armSummary(cells, arm, exp.repeats)),
    comparisons,
    flips,
  };
}

const usd = (x: number | null) => (x === null ? "n/a" : `$${x.toFixed(3)}`);
const pct = (x: number | null) =>
  x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;

function fmtDelta(c: Comparison): string {
  const f = c.metric === "pass_rate"
    ? (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pp`
    : (x: number) => `${x >= 0 ? "+" : "-"}$${Math.abs(x).toFixed(3)}`;
  if (c.delta === null || c.ci === null) return "n/a (no solved task)";
  const verdict = c.distinguishable
    ? colors.green("distinguishable")
    : colors.yellow("not distinguishable");
  const undef = c.undefined_share > 0
    ? `, undefined in ${pct(c.undefined_share)} of resamples`
    : "";
  return `${f(c.delta)} [${f(c.ci[0])}, ${
    f(c.ci[1])
  }] ${verdict} (${c.tasks} tasks${undef})`;
}

export function renderReport(r: HarnessReport): string {
  const out: string[] = [];
  const h = (s: string) => out.push("", colors.bold(s));
  out.push(colors.bold(`Harness report: ${r.experiment.id}`));
  out.push(`Hypothesis: ${r.experiment.hypothesis}`);
  out.push(`Primary metric: ${r.experiment.primary_metric}`);
  out.push(
    `Campaign ${r.campaign.id} (${r.campaign.created_at}), task set ${
      r.campaign.task_set_identity.slice(0, 12)
    }, ${r.campaign.tasks} tasks${
      r.campaign.reuse_history ? colors.yellow(", REUSES HISTORY") : ""
    }`,
  );
  for (const d of r.diffs) {
    out.push(
      `Diff ${r.experiment.baseline} -> ${d.variant}: ${
        d.differing.join(", ") || "none"
      }`,
    );
  }
  h("Coverage");
  for (const c of r.coverage) {
    out.push(
      `  ${c.arm}: judged ${c.judged_cells}/${c.planned_cells} cells, ${c.executions} executions, incomplete telemetry ${c.incomplete_telemetry}, infra exposed ${c.infra_exposed}`,
    );
  }
  h("Primary");
  for (const a of r.arms) {
    out.push(
      `  ${a.arm}: cost per solved task ${
        usd(a.cost_per_solved_task)
      }, pass rate ${
        pct(a.pass_rate)
      } (${a.tasks} tasks, ${a.cells} cells, ${a.cost_incomplete_cells} without cost)`,
    );
  }
  for (const c of r.comparisons) {
    const label = c.primary ? "" : colors.dim(" [exploratory]");
    out.push(
      `  ${c.variant} vs ${c.baseline}, ${c.metric}: ${fmtDelta(c)}${label}`,
    );
  }
  h("Outcome");
  for (const a of r.arms) {
    out.push(
      `  ${a.arm}: pass rate ${pct(a.pass_rate)}, pass^k ${
        pct(a.pass_k)
      } over ${a.pass_k_tasks} tasks`,
    );
  }
  if (r.flips.length > 0) {
    out.push("  Flips (per-task pass rate):");
    for (const f of r.flips) {
      out.push(
        `    ${f.task}: ${
          Object.entries(f.pass_rate).map(([a, v]) => `${a} ${pct(v)}`).join(
            ", ",
          )
        }`,
      );
    }
  }
  return out.join("\n");
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/report.test.ts`
Expected: `ok | 4 passed | 0 failed`.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/report.ts tests/unit/harness/report.test.ts
deno lint src/harness/report.ts tests/unit/harness/report.test.ts
deno fmt src/harness/report.ts tests/unit/harness/report.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/report.ts tests/unit/harness/report.test.ts
git commit -m "feat(harness): report skeleton, primary metric and outcome"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/report.test.ts` prints `ok | 4 passed | 0 failed`.

---

### Task M1-10: `centralgauge harness validate` and `harness report`

Spec 1a section 10 (CLI, Cliffy, `--no-X` rule) and section 9 (`harness report <experiment>`). `validate` is the loud gate lane-content (M4) runs after authoring a task: it loads every task, the symbols lock and every experiment with its configs, and prints the task-set identity. `run`, `cell`, `rejudge` and `images build` are Part 2. No `--no-X` option is added here.

**Deps:** M1-01, M1-03, M1-04, M1-07, M1-09.

**Files:**
- Create: `cli/commands/harness-command.ts`
- Modify: `cli/commands/mod.ts` (one export line, alphabetical, before `registerIngestCommand`)
- Modify: `cli/centralgauge.ts` (import list and one registration call)
- Test: `tests/unit/cli/commands/harness-command.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `validateHarness(repoRoot: string): Promise<string[]>`; `interface ReportOptions { resultsDir: string; campaign?: string | undefined; resamples: number; seed: number }`; `harnessReport(experimentId: string, opts: ReportOptions): Promise<HarnessReport>`; `registerHarnessCommand(cli: Command): void`.

- [ ] **Step 1: Write the failing test**

`tests/unit/cli/commands/harness-command.test.ts`:

```typescript
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import { join } from "@std/path";
import {
  harnessReport,
  validateHarness,
} from "../../../../cli/commands/harness-command.ts";
import { CentralGaugeError, ValidationError } from "../../../../src/errors.ts";
import { RecordStore } from "../../../../src/harness/records.ts";
import {
  campaign,
  CAMPAIGN_ID,
  execution,
  H,
  judgment,
} from "../../harness/fixtures.ts";

async function write(root: string, rel: string, text: string) {
  await Deno.mkdir(join(root, rel, ".."), { recursive: true });
  await Deno.writeTextFile(join(root, rel), text);
}

async function git(root: string, ...args: string[]) {
  const out = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
}

async function repo(): Promise<string> {
  const root = await Deno.makeTempDir();
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "t@example.com");
  await git(root, "config", "user.name", "t");
  await write(root, "harness-tasks/refapp/Core/app.json", "{}");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "refapp");
  await git(root, "tag", "refapp-v1");
  await write(
    root,
    "harness-tasks/tasks/HX-001/task.yml",
    `id: HX-001
refapp_version: refapp-v1
kind: bugfix
prompt: prompt.md
source: refapp
scorers: [build, fail_to_pass]
fail_to_pass:
  depends_on: [Rental]
  tests:
    - { codeunit: 85001, procedures: [A] }
`,
  );
  await write(root, "harness-tasks/tasks/HX-001/prompt.md", "Fix it.");
  await write(root, "harness-tasks/tasks/HX-001/oracle/T.al", "x");
  return root;
}

Deno.test("validateHarness: reports task count and provisional identity", async () => {
  const root = await repo();
  const lines = (await validateHarness(root)).map(stripAnsiCode);
  assertEquals(lines.length, 1);
  assertStringIncludes(lines[0]!, "[OK] 1 tasks");
  assertStringIncludes(lines[0]!, "provisional");
});

Deno.test("validateHarness: a broken experiment fails loudly", async () => {
  const root = await repo();
  await write(root, "harness/experiments/x.yml", "id: x\nhypothesis: h\n");
  await assertRejects(() => validateHarness(root), ValidationError, "x.yml");
});

Deno.test("harnessReport: newest campaign from the store, loud when none", async () => {
  const dir = await Deno.makeTempDir();
  await assertRejects(
    () =>
      harnessReport("skills-vs-plain", {
        resultsDir: dir,
        resamples: 10,
        seed: 1,
      }),
    CentralGaugeError,
    "No campaign",
  );
  const store = new RecordStore(dir);
  await store.writeCampaign(campaign());
  const e = execution({ artifact_hash: H("1") });
  await store.writeExecution(e);
  await store.writeJudgment(judgment(H("1"), e.id, true));
  const r = await harnessReport("skills-vs-plain", {
    resultsDir: dir,
    resamples: 10,
    seed: 1,
  });
  assertEquals(r.campaign.id, CAMPAIGN_ID);
  assertEquals(r.coverage[0]!.judged_cells, 1);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/cli/commands/harness-command.test.ts`
Expected: FAIL, `Module not found ".../cli/commands/harness-command.ts"`.

- [ ] **Step 3: Implement the command**

`cli/commands/harness-command.ts`:

```typescript
/**
 * `centralgauge harness` (spec 1a section 10). Part 1: `validate` and
 * `report`. `run`, `cell`, `rejudge` and `images build` come in Part 2.
 *
 * @module cli/commands/harness
 */
import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import { CentralGaugeError } from "../../src/errors.ts";
import { loadExperiment } from "../../src/harness/config.ts";
import {
  loadSymbolsLock,
  taskSetIdentity,
} from "../../src/harness/identity.ts";
import type { JudgmentRecord } from "../../src/harness/records.ts";
import { RecordStore } from "../../src/harness/records.ts";
import {
  buildReport,
  type HarnessReport,
  renderReport,
} from "../../src/harness/report.ts";
import { loadTaskSet } from "../../src/harness/task.ts";

/** Validate every task, the symbols lock and every experiment. Throws on the first broken file set. */
export async function validateHarness(repoRoot: string): Promise<string[]> {
  const lines: string[] = [];
  const tasks = await loadTaskSet(join(repoRoot, "harness-tasks", "tasks"));
  const symbols = await loadSymbolsLock(repoRoot);
  const ids = await taskSetIdentity(repoRoot, tasks, symbols);
  lines.push(
    `${colors.green("[OK]")} ${tasks.length} tasks, task set ${
      ids.identity.slice(0, 12)
    }${
      ids.provisional ? colors.yellow(" (provisional: no symbols lock)") : ""
    }`,
  );
  const expDir = join(repoRoot, "harness", "experiments");
  const names: string[] = [];
  try {
    for await (const e of Deno.readDir(expDir)) {
      if (e.isFile && e.name.endsWith(".yml")) names.push(e.name.slice(0, -4));
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  for (const name of names.sort()) {
    const { configs } = await loadExperiment(join(repoRoot, "harness"), name);
    lines.push(
      `${colors.green("[OK]")} experiment ${name} (${configs.length} arms)`,
    );
  }
  return lines;
}

export interface ReportOptions {
  resultsDir: string;
  campaign?: string | undefined;
  resamples: number;
  seed: number;
}

/** Build the report for an experiment's newest (or named) campaign. */
export async function harnessReport(
  experimentId: string,
  opts: ReportOptions,
): Promise<HarnessReport> {
  const store = new RecordStore(opts.resultsDir);
  const campaigns = await store.campaigns(experimentId);
  const campaign = opts.campaign
    ? campaigns.find((c) => c.id === opts.campaign)
    : campaigns[0];
  if (!campaign) {
    throw new CentralGaugeError(
      `No campaign${
        opts.campaign ? ` ${opts.campaign}` : ""
      } for experiment ${experimentId} in ${opts.resultsDir}`,
      "HARNESS_NO_CAMPAIGN",
    );
  }
  const executions = await store.executions(campaign.id);
  const judgments = new Map<string, JudgmentRecord[]>();
  for (const e of executions) {
    if (e.artifact_hash && !judgments.has(e.artifact_hash)) {
      judgments.set(e.artifact_hash, await store.judgments(e.artifact_hash));
    }
  }
  return buildReport(campaign, executions, judgments, {
    resamples: opts.resamples,
    seed: opts.seed,
  });
}

async function fail(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    if (!(err instanceof CentralGaugeError)) throw err;
    console.error(`${colors.red("[FAIL]")} ${err.message}`);
    Deno.exit(1);
  }
}

export function registerHarnessCommand(cli: Command): void {
  const parent = new Command().description(
    "Harness Bench: benchmark agent harness configs (spec 1a).",
  );

  parent
    .command(
      "validate",
      "Validate harness tasks, symbols lock and experiments; print the task-set identity",
    )
    .option("--root <dir:string>", "Repository root", { default: "." })
    .action((opts) =>
      fail(async () => {
        for (const line of await validateHarness(opts.root)) console.log(line);
      })
    );

  parent
    .command(
      "report <experiment:string>",
      "Report primary metric and outcome for an experiment's campaign",
    )
    .option("--results-dir <dir:string>", "Harness records root", {
      default: "results/harness",
    })
    .option("--campaign <id:string>", "Campaign id (default: newest)")
    .option("--json", "Print the report as JSON")
    .option("--resamples <n:integer>", "Bootstrap resamples", {
      default: 2000,
    })
    .option("--seed <n:integer>", "Bootstrap seed", { default: 1 })
    .action((opts, experiment: string) =>
      fail(async () => {
        const report = await harnessReport(experiment, {
          resultsDir: opts.resultsDir,
          campaign: opts.campaign,
          resamples: opts.resamples,
          seed: opts.seed,
        });
        console.log(
          opts.json ? JSON.stringify(report, null, 2) : renderReport(report),
        );
      })
    );

  // deno-lint-ignore no-explicit-any
  (cli as any).command("harness", parent);
}
```

- [ ] **Step 4: Register it**

In `cli/commands/mod.ts`, add before the `registerIngestCommand` export:

```typescript
export { registerHarnessCommand } from "./harness-command.ts";
```

In `cli/centralgauge.ts`, add `registerHarnessCommand,` to the `./commands/mod.ts` import list (between `registerDoctorCommand,` and `registerIngestCommand,`), and after `registerRunsCommand(cliAny);` add:

```typescript
registerHarnessCommand(cliAny);
```

- [ ] **Step 5: Run it and see it pass**

Run: `deno test --allow-all tests/unit/cli/commands/harness-command.test.ts`
Expected: `ok | 3 passed | 0 failed`.

Run: `deno task start harness --help`
Expected: lists `validate` and `report <experiment>`.

- [ ] **Step 6: Check, lint, format**

```bash
deno check cli/centralgauge.ts tests/unit/cli/commands/harness-command.test.ts
deno lint cli/commands/harness-command.ts cli/commands/mod.ts cli/centralgauge.ts tests/unit/cli/commands/harness-command.test.ts
deno fmt cli/commands/harness-command.ts cli/commands/mod.ts cli/centralgauge.ts tests/unit/cli/commands/harness-command.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add cli/commands/harness-command.ts cli/commands/mod.ts cli/centralgauge.ts tests/unit/cli/commands/harness-command.test.ts
git commit -m "feat(harness): harness validate and harness report commands"
```

**Acceptance:** `deno test --allow-all tests/unit/cli/commands/harness-command.test.ts` prints `ok | 3 passed | 0 failed`, and `deno task start harness --help` lists both subcommands.

---

## Integration check (orchestrator)

After M1-10 merges:

```bash
deno test --allow-all tests/unit/harness/ tests/unit/cli/commands/harness-command.test.ts
deno check cli/centralgauge.ts
deno lint src/harness/ cli/commands/harness-command.ts tests/unit/harness/
deno task start harness validate
graphify update .
```

Expected: `ok | 66 passed | 0 failed`; check and lint clean. `harness validate` on the real repo fails loudly until M4 lands a first task and tags `refapp-v1` (no `harness-tasks/tasks/` yet, or `refapp_version refapp-v1 does not resolve`); that failure is the loader working, not a bug.

## Part 2, after M0-08 (not in this plan)

Written from `docs/superpowers/specs/2026-09-29-harness-spikes-findings.md` once M0-08 is accepted:

- **Sandbox runtime / container runner** (1a section 5): `docker run` of the harness image, mounts, hard-kill capture, timeout, `acquireBenchLock`, cleanup in `finally`, orphan sweep.
- **Staging** (1a section 5 item 1, D16): refapp snapshot at the resolved commit + overlay + `Test\` + pre-seeded `.alpackages`, the `git` source interface, and writing `harness-tasks/symbols.lock.json` (ends `provisional`).
- **Verdict workspace + BC compile/test** (1a section 7): reconstruction, validation (app ids, dependency graph, object ranges, reparse points), scorers `build`, `pass_to_pass`, `fail_to_pass`, `mutant_kill`, rejudge on another container.
- **Backend** (`cg-al` compile/test/symbols, scoped per-execution token, host call log, `CompileQueuePool` sharing, D12).
- **Mock harness image** and the hostile contract tests (1a section 11).
- **Campaign runner**: `harness run` / `cell` / `rejudge` / `images build`, resume, `--sample`, `--repeats`, `--reuse-history`, cost estimate before a run, usage-limit pause, runtime facts collection for `resolveManifest`, observed-manifest check (`setup_failed` on a missing component or version mismatch), `did_work` detection.
- **Telemetry and trace parsing** per harness (metrics contract, token normalization, list-price estimate with pricing snapshot, `incomplete_telemetry`), call categorization (rules, Laya, opt-in Jev), secret redaction.
- **Report sections** Efficiency (including time to first green build as a censored share, and the both-pass descriptive table) and Slices by `kind` and `coupling`.

Carryover requirements that Part 2 must meet (from `H:\cg-coord\decisions\2026-09-25-accept-M0-03.md`, hard requirements):

1. No secret in any argv. Pass secrets by env or file only.
2. The runner creates the container and opens capture files inside `try`, checks the exit status of `docker rm -f`, and at startup removes leftover `cg-harness-*` containers it owns (name prefix plus label).
3. Secrets are not mounted into the agent-readable filesystem, or the threat model (1a section 1) states why they must be. This contradicts the current section 5 item 2 `C:\cg-secrets` mount and must be resolved in the Part 2 plan or a spec update.

Also from `H:\cg-coord\decisions\2026-09-25-accept-M0-01.md`: `deno task id-audit` (`scripts/id-audit.ts`) has no band rule for `harness-tasks/`. Add one: `harness-tasks/refapp/<module>` in 70000-74999, `harness-tasks/refapp/Test` and task overlays under `Test\` in 80000-84999, `harness-tasks/tasks/*/oracle` and `mutants` in 85000-89999, nothing in 75000-79999 (1b section 4).

## Open questions

1. **Validity as a set.** Spec 1a section 8 lists `validity` as one field with three values, but one execution can be both `incomplete_telemetry` and `infra_exposed`. This plan stores `validity: ("incomplete_telemetry" | "infra_exposed")[]`, empty meaning `complete`. Confirm or pick a precedence.
2. **Cost-per-solved aggregation.** Implemented as sum of per-task mean cost over sum of per-task pass rate (equal task weight, section 9). The alternative, mean of per-task ratios, is undefined for any unsolved task. Confirm.
3. **Asymmetric exclusion.** Per-cell exclusion of unknown cost (section 5) can drop cells from one arm only, which the reviewer warned about (finding 11). Keep per-cell, or drop the whole (task, repeat) block from the primary comparison?
4. **`kind` in the oracle hash.** 1b section 7 does not say whether `kind` is agent-visible. It drives the scorer boundary, so it is hashed as oracle. Which task.yml fields reach `C:\task` is a Part 2 staging decision; if `kind` is shown to the agent it must move to the visible hash (rules bump).
5. **Allowed primary metrics.** D19 says "default", not "only". This plan allows `cost_per_solved_task` and `pass_rate`. More (tokens, wall time) need telemetry and wait for Part 2.
6. **Model id validation.** Configs check the `provider/model` shape only. CLAUDE.md says ids come from the catalog; should `validate` check `site/catalog/models.yml`, and in which id form?
7. **`coupling` vocabulary.** Free strings for now. Should it be an enum from the 1b section 3 matrix (events, internal, interface, queries, facade, ishandled)?
8. **Derived vary keys.** Image digest may differ only when `harness`, `harness_version` or `toolchain` is varied; provider routes only with `models`; backend version never. Confirm, especially whether a bundle change can ever change the image.
9. **Symbols lock.** Format `[{name, publisher, version, sha256}]` at `harness-tasks/symbols.lock.json`, produced by Part 2 staging. Until then identities are `provisional` and a campaign refuses them.
10. **Block order.** Repeat-major (every task at repeat 1 before repeat 2), matching the staged-run advice in section 6. The spec does not fix it.
