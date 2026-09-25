# Harness Bench Core, Part 1 (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the parts of Harness Bench M1 that do not depend on the M0 spike findings: task.yml loading, hashing and comparability identities, immutable records with cross-record validation, the primary-metric statistics and a console + JSON report, so lane-infra can start on 2026-09-30 while M0-08 is still open.

**Architecture:** A new `src/harness/` module of small pure files (one responsibility each), plus one Cliffy command group `centralgauge harness` with `validate` and `report`. Everything is file-in, file-out: YAML under `harness-tasks/` and `harness/`, JSON records under `results/harness/`. Nothing in this part starts a process other than `git`, and nothing touches Docker or a BC container.

**Tech Stack:** Deno + TypeScript, Zod 4 (`npm:zod@^4.4.3`), `@std/yaml`, `@std/fs`, `@std/path`, `@std/fmt/colors`, `@std/testing/mock`, Cliffy `@cliffy/command@1.2.1`, git on PATH.

**Spec:** `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (1a) and `docs/superpowers/specs/2026-09-24-harness-refapp-design.md` (1b). Owner rules: `H:\cg-coord\decisions\2026-09-25-m1-metric-rules.md`. Review this revision answers: `H:\cg-coord\reviews\M1-00-001\review-gpt6astra.md` (ACCEPT-WITH-CHANGES). Earlier reviewer input: `.panel/harness-spec-review-gpt6astra.md`. Style and roadmap: `docs/superpowers/plans/2026-09-24-harness-bench-spike.md`.

**Revision 2 (2026-09-25).** Applies the six must-change items and the per-task acceptance table of the M1-00-001 review, and builds in the owner rules. All code below was re-run in a scratch copy of the repo: 109 tests pass, `deno check` and `deno lint` are clean, and the three golden hashes were confirmed independently with Python. M1-07 is split into M1-07 (records and store) and M1-07b (cross-record validation).

## Global Constraints

- No container, Docker or BC operation in any task. Every test in this plan runs without a container, so it is safe while a bench is live (it never touches `tests/unit/container`).
- Run tests as `deno test --allow-all <file>`. Never `--parallel`. Do not run the full `deno task test:unit` while a bench is live (`find results/.bench-running.json -mmin -2` prints a path).
- After each task: `deno check`, `deno lint`, `deno fmt` on the files that task touched only (CRLF/LF drift makes directory-wide fmt rewrite unrelated files). Never `deno fmt` under `site/`.
- Zod 4 idioms: `z.strictObject` (unknown keys are errors, spec 1b section 6), `z.iso.datetime()`, `z.uuid()`, `ctx.addIssue({ code: "custom", ... })`. `exactOptionalPropertyTypes` is on: an optional field that may receive `undefined` is typed `x?: T | undefined`.
- Import order (CLAUDE.md): `@std/...`, then third-party (`zod`, `@cliffy/...`), then project type imports, then project implementation imports, then relative imports.
- Console output uses `@std/fmt/colors` with `[OK]` / `[FAIL]` tags, never emoji.
- Model ids are never hardcoded in code. Test fixtures use the placeholder `anthropic/model-a` with a test catalog.
- ID bands (spec 1b section 4): visible tests 80000-84999, hidden oracles 85000-89999, 75000-79999 reserved.
- Records are immutable (spec 1a section 6): crash-safe write-once publication; a second write of the same record is an error.
- Hashing rules carry a version (spec 1a section 4). `HASH_RULES_VERSION = "hr1"`. Any change to what is hashed, or how, bumps it and updates the golden values in `hash.test.ts` and `manifest.test.ts` in the same commit. Manifests under other rules are never compared.
- Every YAML or JSON load validates with Zod and fails with a `ValidationError` naming the file, including malformed JSON. A silent load failure is a bug (CLAUDE.md, Benchmark Tasks).
- Fixtures are contracts: record fixtures are built with the real hash functions and must pass `validateCampaignRecords`. Never hand-write a hash where an integrity check should succeed.
- Acceptance per task = its focused test file passes, plus `deno check`, `deno lint` and `deno fmt --check` clean on the task's files, plus the focused tests of earlier tasks it modifies. Exact test counts are informational, not acceptance.
- No em dash in any committed text.
- Window: M1 runs 2026-09-30 to 10-08. This part is 11 tasks, estimated 4 days for one lane (re-estimated from 3 after the review added the integrity, provenance and statistics edge cases); Part 2 starts after M0-08.
- After the last task, run `graphify update .` (CLAUDE.md, graphify).

## Owner rules built into this plan

From `H:\cg-coord\decisions\2026-09-25-m1-metric-rules.md`:

1. **Cost per solved task** = sum over tasks of per-task mean spend, counting the spend of every attempt (scored or not, including usage-limited and exhausted setup retries), divided by the sum of per-task pass rates. Equal task weight. Pending spend is disclosed; the headline is marked provisional while cells are pending. (M1-06, M1-09)
2. **Matched pairs.** A baseline-variant comparison uses only (task, repeat) cells eligible in both arms; each arm's raw spend and exclusions are reported separately. (M1-06, M1-09)
3. **Reruns.** An automatic infra-retry chain resolves by its final attempt. A manual rerun is a separate execution and never replaces a scored result; the report states which execution was used. (M1-07, M1-08, M1-09)
4. **Sparse bootstrap.** When any resample is undefined (zero solves), the CI and the distinguishable verdict are suppressed and the undefined share is reported. (M1-06, M1-09)
5. Validity is independent flags, empty meaning complete, with metric-specific reasons. (M1-07)
6. `kind` stays in the oracle hash; an agent-visible metadata whitelist is defined. (M1-04)
7. Primary metrics are `cost_per_solved_task` (the recommended default) and `pass_rate`, always declared explicitly. (M1-03)
8. Model ids are validated against the catalog through the existing reader. (M1-03, M1-10)
9. `coupling` stays free strings, normalized. (M1-01)
10. Derived `vary` defaults approved; image provenance recorded; rule-version mismatch rejected. (M1-05)
11. Symbols lock is provisional-until-present, with a versioned, strict format. (M1-04)
12. Block order is repeat-major with a seeded arm order within each block. (M1-07)

## Review Focus

1. **Spend disappears from the headline** because a cell never got a verdict (exhausted setup retry, usage-limit pause). Expected: its spend counts. Pinned in M1-06 (`spend of an unscored cell counts`) and M1-08 (`exhausted automatic retry is terminally unscored, spend kept`).
2. **A rejudge of one execution changes another's result** because both produced identical workspace bytes, or a judgment against a different oracle is picked up. Expected: judgments are selected per execution, task, workspace and judging oracle. Pinned in M1-07 (`identical workspaces keep separate artifacts and judgments`) and M1-08 (`judgments are selected by execution, task, workspace and oracle`).
3. **Sparse solves produce a confident "distinguishable".** Expected: CI suppressed with the undefined share. Pinned in M1-06 (`any undefined resample suppresses CI and verdict`) and M1-09 (`sparse solves suppress the CI and say why`).
4. **Validly shaped records from different inputs enter one comparison** (wrong visible hash, wrong arm manifest, duplicate attempts, foreign campaign). Expected: the report refuses before computing. Pinned in M1-07b and M1-09 (`inconsistent records are refused`).
5. **A hidden bundle file or tracked build output changes behavior without changing identity, or vice versa.** Expected: bundles hash every file; task content drops only build artifacts; a new commit with identical refapp content changes nothing. Pinned in M1-02, M1-04 and M1-05.

## Reuse

Reused as-is:
- `shared/canonical.ts` `canonicalJSON`: sorted keys, rejects `undefined` and non-finite numbers. The base of every harness hash.
- `src/ingest/catalog/task-set-hash.ts` `TEXT_EXTENSIONS`: which files get CRLF normalization.
- `src/ingest/catalog/read.ts` `readCatalog(dir)`: the existing catalog reader, used for model id membership. It takes an explicit directory, unlike the cwd-probing `ModelCatalog` singleton in `src/llm/model-catalog.ts`.
- `src/errors.ts` `ValidationError`, `ConfigurationError`, `CentralGaugeError`.
- `cli/commands/report/stats-calculator.ts` `percentile` (linear interpolation, numpy default) for bootstrap interval ends.
- `jsr:@std/encoding@^1.0.5/hex` `encodeHex`, as `task-set-hash.ts` already imports it; `@std/testing/mock` `stub` for CLI output capture.
- The `safeParse` plus issue-list error shape of `src/tasks/interfaces.ts` `parseTaskManifest`.

Deliberately not reused:
- `computeTaskSetHash`: scoped to `tasks/` and `tests/al/`, strips `provenance:` blocks, and any change to it moves the leaderboard `task_sets.hash`. Its `collectFiles` is private and coupled to those rules.
- `src/stats/hasher.ts`: truncates to 16 hex chars and serves report-db diagnostics.
- `src/utils/harness-fingerprint.ts` `hashFiles`: text-only reads, no skip rules, no link refusal.
- `wilsonInterval` and `costPerPass`: pooled over executions; spec 1a section 9 and the owner rules require task-level inference over matched pairs.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/harness/yaml.ts` | read YAML + Zod, loud errors | M1-01 |
| `src/harness/task.ts` | task.yml schema, link policy, `loadTask`, `loadTaskSet` | M1-01 |
| `src/harness/hash.ts` | `HASH_RULES_VERSION`, `hashJson`, `hashFile`, `hashContent`, domain-aware `listTree` / `hashTree` | M1-02 |
| `src/harness/config.ts` | config and experiment schemas, loaders, catalog check, `effectiveLimits` | M1-03 |
| `src/harness/identity.ts` | canonical refapp source, visible and oracle hashes, metadata whitelist, symbols lock, task-set identity | M1-04 |
| `src/harness/manifest.ts` | arm template and execution manifests, component hashes, `vary` enforcement, arm membership | M1-05 |
| `src/harness/stats.ts` | cells, cost per solved task, pass rate, pass^k, matched-pair bootstrap | M1-06 |
| `src/harness/records.ts` | execution, artifact association, judgment, campaign schemas, `planBlocks`, crash-safe `RecordStore` | M1-07 |
| `src/harness/integrity.ts` | `validateCampaignRecords` across records and stored hashes | M1-07b |
| `src/harness/outcome.ts` | termination rules, judging context, judgment selection, records to cells | M1-08 |
| `src/harness/report.ts` | `buildReport` (JSON shape), `renderReport` (console) | M1-09 |
| `cli/commands/harness-command.ts` | `harness validate`, `harness report` | M1-10 |
| `tests/unit/harness/*.test.ts`, `tests/unit/harness/fixtures.ts` | unit tests and consistent record builders | all |

On-disk layout this part defines (spec 1a section 3):

```
harness-tasks/
  refapp/                         git-tagged versions (refapp-v1 ...)
  tasks/HX-001/task.yml ...       spec 1b section 5
  symbols.lock.json               {v: 1, packages: [...]}, written in Part 2
harness/
  configs/<id>.yml
  experiments/<id>.yml
  bundles/<name>/...
results/harness/                  gitignored via results/
  campaigns/<campaign-id>.json
  executions/<campaign-id>/<execution-id>.json
  artifacts/<execution-id>.json   association: execution -> workspace hash
  workspaces/<workspace-hash>/    content-addressed copy (written in Part 2)
  judgments/<execution-id>/<judgment-id>.json
```

## Contracts frozen now for Part 2

Part 2 implements the producers; the shapes below do not change without a rules or schema version bump.

- **Resolved inputs** (M1-05). `RuntimeFacts = { native_settings, image: { digest, base_digest }, backend_version, servers: { name: { version, tool_schema_hash } }, provider_routes: { slot: route } }`. Every model slot needs a route. The campaign stores the arm **template** (config limits); each execution stores `forTask(template, task.limits)` plus `arm_manifest_hash`. Path components carry `{ path, hash, files[] }` so a diff can name the file.
- **Refapp source** (M1-04). The canonical refapp content is every tracked file under `harness-tasks/refapp` at the resolved commit except build artifacts, hashed with the same content rule as `listTree(dir, "task")`. Part 2 staging copies exactly those paths from that commit; `resolveRefapp(...).files` equals `listTree` of a checkout (tested).
- **Agent-visible metadata** (M1-04). `AGENT_VISIBLE_FIELDS = ["id", "attachments", "limits"]` is what staging writes to `C:\task`. Anything added there is hashed as visible (and also as oracle if it is an oracle input).
- **Symbols lock** (M1-04). `{ v: 1, packages: [{ app_id, name, publisher, version, file, sha256 }] }`, unique `app_id`, lower-case hex digests, sorted by `app_id` on load.
- **Execution** (M1-07). `run_kind: planned | auto_retry | manual_rerun`, `retry_of`, unique `attempt` per cell; `did_work` means the agent took any action (model request, tool call, file read or edit, build attempt); `validity: { incomplete_telemetry: string[], infra_exposed: boolean }`; `image_attachments: none | delivered | unsupported | unknown`; `telemetry.cost_usd` only with `cost_source: "estimated"` and a pricing snapshot, the harness's own figure in `reported_cost_usd`; `workspace_hash`.
- **Artifact and workspace** (M1-07). One association per execution; the workspace copy is content-addressed and may be shared.
- **Judgment** (M1-07). Keyed by execution; per-procedure results carry `target: candidate | reference | mutant:<name>` and `failure: assertion | compile | runtime_error | infra | null`.
- **Campaign** (M1-07). Full immutable plan (every task x repeat); staged runs (`--sample`, first repeat, remaining repeats) execute subsets of it and never rewrite it. `reuse: [{ campaign_id, execution_id }]` references historical executions explicitly; `tasks_meta` carries `kind` and `coupling` for slices.
- **Judging context** (M1-08). Report and rejudge name the oracle per task explicitly (`campaign` or `current`); the report prints which.

---

### Task M1-01: task.yml schema and loader

Spec 1b section 6 (schema, "unknown keys are an error"), section 4 (ID bands), section 5 (folder layout), 1a section 7 (test-authoring needs `correct/`; no links). Cross-field rules pin the scorer contract so a malformed task fails at load, not mid-campaign. This is static validation, not the authoring gate of 1b section 8 (that needs containers, Part 2). `coupling` is normalized (owner rule 9).

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
    "backslash traversal",
    VALID.replace("prompt: prompt.md", String.raw`prompt: 'sub\..\..\x.md'`),
    "relative path",
  ],
  [
    "absolute attachment path",
    VALID.replace(
      "source: refapp",
      "source: refapp\nattachments: [/etc/x.png]",
    ),
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

Deno.test("loadTask: coupling tags are normalized", async () => {
  const root = await Deno.makeTempDir();
  const yml = VALID.replace(
    "coupling: [events]",
    "coupling: [' Events', events, Interface]",
  );
  const { task } = await loadTask(await makeTask(root, "HX-001", yml));
  assertEquals(task.coupling, ["events", "interface"]);
});

Deno.test("loadTask: a linked oracle folder or attachment is refused", async () => {
  const root = await Deno.makeTempDir();
  const outside = await Deno.makeTempDir();
  const yml = VALID.replace(
    "source: refapp",
    "source: refapp\nattachments: [shots]",
  );
  const dir = await makeTask(root, "HX-001", yml, ["prompt.md"]);
  const type = Deno.build.os === "windows" ? "junction" : "dir";
  await Deno.symlink(outside, join(dir, "oracle"), { type });
  await Deno.symlink(outside, join(dir, "shots"), { type });
  const err = await assertRejects(() => loadTask(dir), ValidationError);
  assertStringIncludes(err.message, "oracle/ folder is a link");
  assertStringIncludes(err.message, "attachment is a link: shots");
});

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
 * Unknown keys are an error; cross-field rules, file existence and the link
 * policy are checked at load, and a task set load reports every broken task
 * at once.
 *
 * This is static validation only. It is NOT the authoring gate of spec 1b
 * section 8 (correct passes, naive fails, green baseline), which needs
 * containers and runs in Part 2.
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
  /** Free tags, normalized: trimmed, lower-case, deduplicated, sorted. */
  coupling: z.array(z.string().trim().toLowerCase().min(1)).default([])
    .transform((xs) => [...new Set(xs)].sort()),
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

/** "ok", "missing", or "link" (links and junctions are never task content). */
async function probe(
  p: string,
  kind: "file" | "dir",
): Promise<"ok" | "missing" | "link"> {
  try {
    const s = await Deno.lstat(p);
    if (s.isSymlink) return "link";
    return (kind === "file" ? s.isFile : s.isDirectory) ? "ok" : "missing";
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return "missing";
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
  const need = async (rel: string, kind: "file" | "dir", what: string) => {
    const r = await probe(join(dir, rel), kind);
    if (r === "link") errors.push(`${what} is a link: ${rel}`);
    if (r === "missing") errors.push(`${what} not found: ${rel}`);
  };
  await need(task.prompt, "file", "prompt");
  for (const a of task.attachments) await need(a, "file", "attachment");
  if (task.fail_to_pass) {
    await need("oracle", "dir", "fail_to_pass oracle/ folder");
  }
  if (task.kind === "test-authoring") {
    await need("correct", "dir", "test-authoring correct/ folder");
  }
  for (const m of task.mutants) {
    await need(`mutants/${m}`, "dir", "mutant folder");
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
Expected: all tests pass (20 at the time of writing, including the parameterized rejects).

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

**Acceptance:** `deno test --allow-all tests/unit/harness/task.test.ts` exits 0, and `deno check` / `deno lint` / `deno fmt --check` are clean on the three files.

---

### Task M1-02: hashing primitives with versioned rules and domains

Spec 1a section 4 ("hashing rules carry a version number"), section 7 item 4 (refuse links), section 11 (canonicalization with a fixture), 1b section 7 (which build artifacts are excluded). Two domains: `bundle` hashes every file (a hidden plugin manifest is behavior), `task` drops only `.alpackages/`, `output/`, `*.app`. Link refusal covers the root, every entry before any skip rule, and direct `hashFile` calls. It covers what Deno reports as a symlink (symlinks and junctions); it is an identity helper, not the hostile-artifact copy boundary, which Part 2 builds with its own reparse-point policy. The golden values were computed from this code and confirmed independently with Python.

**Deps:** none (can run in parallel with M1-01).

**Files:**
- Create: `src/harness/hash.ts`
- Test: `tests/unit/harness/hash.test.ts`

**Interfaces:**
- Produces: `HASH_RULES_VERSION = "hr1"`; `type TreeDomain = "bundle" | "task"`; `hashJson(value: unknown): Promise<string>` (64 hex); `hashFile(path: string): Promise<string>`; `hashContent(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<string>`; `isTaskBuildArtifact(rel: string): boolean`; `interface TreeEntry { path: string; sha256: string }`; `listTree(dir, domain, opts?: { optional?: boolean }): Promise<TreeEntry[]>`; `hashTree(dir, domain, opts?): Promise<string>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/hash.test.ts`:

```typescript
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import {
  HASH_RULES_VERSION,
  hashFile,
  hashJson,
  hashTree,
  listTree,
} from "../../../src/harness/hash.ts";

async function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, ...rel.split("/"));
    await Deno.mkdir(join(p, ".."), { recursive: true });
    await Deno.writeTextFile(p, text);
  }
}

/** Directory link: a junction on Windows, a symlink elsewhere. */
async function linkDir(target: string, path: string) {
  await Deno.symlink(target, path, {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
}

Deno.test("hashJson: golden value pins rules hr1", async () => {
  assertEquals(HASH_RULES_VERSION, "hr1");
  assertEquals(
    await hashJson({ b: [true, null, "x"], a: 1 }),
    "b93bfb4cd226bb75b69866d163145c6bbe6e71eae8eb09e6079cf8b54747ea2a",
  );
});

Deno.test("hashJson: key order does not matter, values and types do", async () => {
  assertEquals(await hashJson({ a: 1, b: 2 }), await hashJson({ b: 2, a: 1 }));
  assertNotEquals(await hashJson({ a: 1 }), await hashJson({ a: 2 }));
  assertNotEquals(await hashJson({ a: 1 }), await hashJson({ a: "1" }));
  assertNotEquals(await hashJson([1, 2]), await hashJson([2, 1]));
});

Deno.test("hashTree task domain: golden, CRLF-invariant, drops only build artifacts", async () => {
  const crlf = await Deno.makeTempDir();
  const lf = await Deno.makeTempDir();
  await writeTree(crlf, {
    "Core/src/A.Codeunit.al": "line1\r\nline2\r\n",
    ".vscode/settings.json": "{}",
    ".alpackages/x.app": "bin",
    "Core/output/Core.app": "bin",
    "Core/Core.app": "bin",
  });
  await writeTree(lf, {
    "Core/src/A.Codeunit.al": "line1\nline2\n",
    ".vscode/settings.json": "{}",
  });
  assertEquals(
    (await listTree(crlf, "task")).map((e) => e.path),
    [".vscode/settings.json", "Core/src/A.Codeunit.al"],
  );
  assertEquals(await hashTree(crlf, "task"), await hashTree(lf, "task"));
  assertEquals(
    await hashTree(lf, "task"),
    "188dc9078eb86ea57ad930412e661ebe2a2323ab1ea3bc7b633d5e0b902cb677",
  );
});

Deno.test("hashTree bundle domain: every file counts, dotfiles included", async () => {
  const root = await Deno.makeTempDir();
  await writeTree(root, { "SKILL.md": "x", ".plugin/manifest.json": "{}" });
  const before = await hashTree(root, "bundle");
  assertEquals((await listTree(root, "bundle")).length, 2);
  await Deno.writeTextFile(join(root, ".plugin", "manifest.json"), '{"a":1}');
  assertNotEquals(await hashTree(root, "bundle"), before);
  await writeTree(root, { "out/x.app": "bin" });
  assertEquals((await listTree(root, "bundle")).length, 3);
});

Deno.test("hashFile: binary bytes are preserved, text CRLF is normalized", async () => {
  const root = await Deno.makeTempDir();
  await Deno.writeFile(join(root, "a.bin"), new Uint8Array([13, 10, 65]));
  await Deno.writeFile(join(root, "b.bin"), new Uint8Array([10, 65]));
  await Deno.writeTextFile(join(root, "a.al"), "x\r\n");
  await Deno.writeTextFile(join(root, "b.al"), "x\n");
  assertNotEquals(
    await hashFile(join(root, "a.bin")),
    await hashFile(join(root, "b.bin")),
  );
  assertEquals(
    await hashFile(join(root, "a.al")),
    await hashFile(join(root, "b.al")),
  );
});

Deno.test("hashTree: missing dir throws unless optional", async () => {
  const root = await Deno.makeTempDir();
  await assertRejects(
    () => hashTree(join(root, "nope"), "task"),
    Deno.errors.NotFound,
  );
  assertEquals(
    await hashTree(join(root, "nope"), "task", { optional: true }),
    await hashJson({ domain: "task", tree: [] }),
  );
});

Deno.test("links: refused as root, as entry, inside a skipped folder, and by hashFile", async () => {
  const target = await Deno.makeTempDir();
  await writeTree(target, { "t.al": "x" });

  const root = await Deno.makeTempDir();
  await writeTree(root, { "a.al": "x" });
  await linkDir(target, join(root, "link"));
  await assertRejects(() => hashTree(root, "task"), ValidationError, "link");

  const skipped = await Deno.makeTempDir();
  await Deno.mkdir(join(skipped, "output"));
  await linkDir(target, join(skipped, "output", "inner"));
  await assertRejects(() => hashTree(skipped, "task"), ValidationError, "link");

  const parent = await Deno.makeTempDir();
  await linkDir(target, join(parent, "rootlink"));
  await assertRejects(
    () => hashTree(join(parent, "rootlink"), "bundle"),
    ValidationError,
    "link",
  );

  // A direct hashFile call on a link is refused too (a junction here, since
  // file symlinks need Developer Mode on Windows).
  await assertRejects(
    () => hashFile(join(parent, "rootlink")),
    ValidationError,
    "link",
  );
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
 * identity, resolved manifest hash, component hash, workspace hash) goes
 * through hashJson, which prefixes HASH_RULES_VERSION. Bump the version on
 * ANY change to what is hashed or how, so a rule change can never collide
 * with an old hash (spec 1a section 4).
 *
 * Tree hashing has explicit domains. `bundle` hashes every file (a hidden
 * plugin manifest is behavior). `task` drops only the build artifacts spec 1b
 * section 7 names: `.alpackages/`, `output/`, `*.app`.
 *
 * Link refusal covers what Deno reports as a symlink (symlinks and junctions
 * on Windows), for the root and every entry, before any skip rule. This is
 * an identity helper, not the hostile-artifact copy boundary: the Part 2
 * verdict workspace copy must enforce its own reparse-point policy.
 */

import { walk } from "@std/fs/walk";
import { relative } from "@std/path";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { canonicalJSON } from "../../shared/canonical.ts";
import { ValidationError } from "../errors.ts";
import { TEXT_EXTENSIONS } from "../ingest/catalog/task-set-hash.ts";

export const HASH_RULES_VERSION = "hr1";

export type TreeDomain = "bundle" | "task";

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

function isText(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot !== -1 &&
    TEXT_EXTENSIONS.includes(path.slice(dot).toLowerCase());
}

async function refuseLink(path: string, label: string): Promise<void> {
  if ((await Deno.lstat(path)).isSymlink) {
    throw new ValidationError(`refusing link or reparse point: ${label}`, [
      label,
    ]);
  }
}

/**
 * Per-file SHA-256 hex. CRLF becomes LF for text extensions only; other
 * bytes are hashed as-is. Refuses a link.
 */
export async function hashFile(path: string): Promise<string> {
  await refuseLink(path, path);
  return hashContent(path, await Deno.readFile(path));
}

/** The content rule of hashFile for bytes that are not on disk (git blobs). */
export function hashContent(
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  if (!isText(path)) return sha256Hex(bytes);
  const text = new TextDecoder().decode(bytes).replaceAll("\r\n", "\n");
  return sha256Hex(enc.encode(text));
}

/** True when a `task`-domain path is a spec 1b section 7 build artifact. */
export function isTaskBuildArtifact(rel: string): boolean {
  const segs = rel.split("/");
  return segs.some((s) => s === ".alpackages" || s === "output") ||
    /\.app$/i.test(segs[segs.length - 1]!);
}

export interface TreeEntry {
  path: string;
  sha256: string;
}

/**
 * Sorted (posix path, sha256) list of a directory's files under a domain.
 * Missing dir: throws NotFound unless `optional`.
 */
export async function listTree(
  dir: string,
  domain: TreeDomain,
  opts: { optional?: boolean } = {},
): Promise<TreeEntry[]> {
  try {
    await refuseLink(dir, dir);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound && opts.optional) return [];
    throw err;
  }
  const out: TreeEntry[] = [];
  for await (const e of walk(dir, { followSymlinks: false })) {
    const rel = relative(dir, e.path).replaceAll("\\", "/");
    if (rel === "") continue;
    if (e.isSymlink) {
      throw new ValidationError(`refusing link or reparse point: ${rel}`, [
        rel,
      ]);
    }
    if (!e.isFile) continue;
    if (domain === "task" && isTaskBuildArtifact(rel)) continue;
    out.push({ path: rel, sha256: await hashFile(e.path) });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Content hash of a directory tree (hash of an empty list when optional and missing). */
export async function hashTree(
  dir: string,
  domain: TreeDomain,
  opts: { optional?: boolean } = {},
): Promise<string> {
  return hashJson({ domain, tree: await listTree(dir, domain, opts) });
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/hash.test.ts`
Expected: all tests pass. If a golden value differs, the implementation deviates from the plan; fix the code, do not edit the golden value.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/hash.ts tests/unit/harness/hash.test.ts
deno lint src/harness/hash.ts tests/unit/harness/hash.test.ts
deno fmt src/harness/hash.ts tests/unit/harness/hash.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/hash.ts tests/unit/harness/hash.test.ts
git commit -m "feat(harness): versioned hashing rules with domains and golden fixtures"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/hash.test.ts` exits 0 with both golden values unchanged, and check / lint / fmt --check are clean on the two files.

---

### Task M1-03: harness config and experiment schemas

Spec 1a section 4 (config shape; "task limits override config limits only to be stricter"; "model ids come from the catalog"), section 6 (experiment: `hypothesis` and `primary_metric` required, `vary`, `repeats` default 3 per D7), D19 and owner rule 7 (one explicitly declared primary metric: `cost_per_solved_task` or `pass_rate`), owner rule 8 (catalog membership via the existing reader). Limit ownership: config limits belong to the arm template; `effectiveLimits` feeds each execution manifest (M1-05 `forTask`).

**Deps:** M1-01 (`readYaml`, `HarnessTask`).

**Files:**
- Create: `src/harness/config.ts`
- Test: `tests/unit/harness/config.test.ts`

**Interfaces:**
- Consumes: `readYaml`, `type HarnessTask` (M1-01); `readCatalog` from `src/ingest/catalog/read.ts`.
- Produces: `HarnessConfigSchema`, `type HarnessConfig`, `ComponentsSchema`, `LimitsSchema`, `type Limits`; `VARY_KEYS`, `type VaryKey`; `PRIMARY_METRICS`, `type PrimaryMetric`; `ExperimentSchema`, `type Experiment`; `loadConfig(harnessRoot, id): Promise<HarnessConfig>`; `interface LoadedExperiment { experiment: Experiment; configs: HarnessConfig[] }` (baseline first); `loadExperiment(harnessRoot, id): Promise<LoadedExperiment>`; `checkModelsInCatalog(configs: HarnessConfig[], catalogDir: string): Promise<void>`; `effectiveLimits(config: Limits, task: HarnessTask["limits"]): Limits`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/config.test.ts`:

```typescript
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  checkModelsInCatalog,
  effectiveLimits,
  loadConfig,
  loadExperiment,
} from "../../../src/harness/config.ts";
import { ConfigurationError } from "../../../src/errors.ts";

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

Deno.test("checkModelsInCatalog: known slugs pass, unknown or missing catalog fail", async () => {
  const root = await harnessRoot({
    "configs/cc-a.yml": CONFIG("cc-a"),
    "catalog/models.yml":
      "- slug: anthropic/model-a\n  api_model_id: model-a\n",
  });
  const config = await loadConfig(root, "cc-a");
  await checkModelsInCatalog([config], join(root, "catalog"));
  const other = { ...config, models: { main: "anthropic/model-z" } };
  await assertRejects(
    () => checkModelsInCatalog([other], join(root, "catalog")),
    ConfigurationError,
    "cc-a.models.main: anthropic/model-z",
  );
  await assertRejects(
    () => checkModelsInCatalog([config], join(root, "nope")),
    ConfigurationError,
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
import { readCatalog } from "../ingest/catalog/read.ts";
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

/**
 * Every model id must be a catalog slug (CLAUDE.md: ids come from the
 * catalog). Reuses the ingest catalog reader; a missing catalog means every
 * id is unknown, which fails loudly.
 */
export async function checkModelsInCatalog(
  configs: HarnessConfig[],
  catalogDir: string,
): Promise<void> {
  const known = new Set(
    (await readCatalog(catalogDir)).models.map((m) => m.slug),
  );
  const unknown = configs.flatMap((c) =>
    Object.entries(c.models)
      .filter(([, id]) => !known.has(id))
      .map(([slot, id]) => `${c.id}.models.${slot}: ${id}`)
  );
  if (unknown.length > 0) {
    throw new ConfigurationError(
      `Model ids not in ${catalogDir}/models.yml:\n  ${unknown.join("\n  ")}`,
      catalogDir,
    );
  }
}

/**
 * Task limits may only tighten config limits (spec 1a section 4). Ownership:
 * config limits are part of the arm template (campaign arm manifest); the
 * result of this function goes into each execution's manifest (M1-05
 * `forTask`), so a task override never changes arm identity.
 */
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
Expected: all tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/config.ts tests/unit/harness/config.test.ts
deno lint src/harness/config.ts tests/unit/harness/config.test.ts
deno fmt src/harness/config.ts tests/unit/harness/config.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/config.ts tests/unit/harness/config.test.ts
git commit -m "feat(harness): config and experiment schemas, catalog check, limit precedence"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/config.test.ts` exits 0, and check / lint / fmt --check are clean on the two files.

---

### Task M1-04: task identity and task-set identity

Spec 1a section 6 (two hashes per task; task-set identity is a sorted manifest of per-task (id, visible, oracle)) and 1b sections 5 and 7 (refapp tags resolve to an immutable commit; what goes in each hash; `naive/` in neither; build artifacts excluded; `touches`/`coupling` never force a re-bench). Review must-change 5: the task-set identity hashes only the (id, visible, oracle) projection, so a new commit with identical content changes nothing; the refapp identity is a canonical source manifest read from git with the same content rule as `listTree`, so tracked build output is excluded and CRLF storage does not matter. Owner rule 6: `kind` stays oracle-side and the agent-visible whitelist is fixed. Owner rule 11: strict, versioned symbols lock, provisional until present.

**Deps:** M1-01, M1-02.

**Files:**
- Create: `src/harness/identity.ts`
- Test: `tests/unit/harness/identity.test.ts`

**Interfaces:**
- Consumes: `LoadedTask`, `HarnessTask`, `loadTaskSet` (M1-01); `hashJson`, `hashFile`, `hashContent`, `hashTree`, `listTree`, `isTaskBuildArtifact`, `TreeEntry` (M1-02).
- Produces: `REFAPP_PATH`; `interface RefappRef { version; commit; source_hash; files: TreeEntry[] }`; `resolveRefapp(repoRoot, version): Promise<RefappRef>`; `SymbolsLockSchema`, `type SymbolPackage`; `SYMBOLS_LOCK_PATH`; `loadSymbolsLock(repoRoot): Promise<SymbolPackage[] | null>`; `AGENT_VISIBLE_FIELDS`; `agentVisibleMetadata(task)`; `visibleInputHash(t, refapp, symbols): Promise<string>`; `oracleHash(t): Promise<string>`; `TaskIdentitySchema`/`TaskIdentity = { id; refapp_commit; visible; oracle }`; `TaskSetIdentitySchema`/`TaskSetIdentity = { identity; provisional; tasks }`; `taskSetHash(tasks: TaskIdentity[]): Promise<string>`; `taskSetIdentity(repoRoot, tasks, symbols): Promise<TaskSetIdentity>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/identity.test.ts` (builds throwaway git repos in temp dirs; needs git on PATH):

```typescript
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import {
  AGENT_VISIBLE_FIELDS,
  agentVisibleMetadata,
  loadSymbolsLock,
  resolveRefapp,
  taskSetIdentity,
} from "../../../src/harness/identity.ts";
import { listTree } from "../../../src/harness/hash.ts";
import { loadTaskSet } from "../../../src/harness/task.ts";

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
  await git(root, "config", "core.autocrlf", "false");
  await write(root, "harness-tasks/refapp/Core/app.json", "{}\n");
  await write(root, "harness-tasks/refapp/Core/src/A.al", "codeunit 70000\n");
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

async function retag(root: string, message: string) {
  await git(root, "add", "-A", "-f", "harness-tasks/refapp");
  await git(root, "commit", "-q", "--allow-empty", "-m", message);
  await git(root, "tag", "-f", "refapp-v1");
}

Deno.test("resolveRefapp: matches a checked-out listTree; unknown tag fails loudly", async () => {
  const root = await fixtureRepo();
  const ref = await resolveRefapp(root, "refapp-v1");
  assertEquals(ref.commit.length, 40);
  assertEquals(
    ref.files,
    await listTree(join(root, "harness-tasks", "refapp"), "task"),
  );
  await assertRejects(
    () => resolveRefapp(root, "refapp-v9"),
    ValidationError,
    "does not resolve",
  );
});

Deno.test("identity: a new commit with identical refapp content changes nothing", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await retag(root, "unrelated");
  const after = await identity(root);
  assertNotEquals(
    after.tasks[0]!.refapp_commit,
    before.tasks[0]!.refapp_commit,
  );
  assertEquals(after.identity, before.identity);
});

Deno.test("identity: tracked build artifacts in the refapp are excluded", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(root, "harness-tasks/refapp/Core/output/Core.app", "bin");
  await write(root, "harness-tasks/refapp/.alpackages/System.app", "bin");
  await retag(root, "build output committed by mistake");
  assertEquals((await identity(root)).identity, before.identity);
});

Deno.test("identity: a refapp source change moves every visible hash only", async () => {
  const root = await fixtureRepo();
  const before = await identity(root);
  await write(root, "harness-tasks/refapp/Core/app.json", '{"v":2}\n');
  await retag(root, "refapp v2");
  const after = await identity(root);
  for (const i of [0, 1]) {
    assertNotEquals(after.tasks[i]!.visible, before.tasks[i]!.visible);
    assertEquals(after.tasks[i]!.oracle, before.tasks[i]!.oracle);
  }
});

Deno.test("identity: oracle edit moves only that task's oracle hash", async () => {
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

Deno.test("identity: no symbols lock means provisional and a different hash", async () => {
  const root = await fixtureRepo();
  const tasks = await loadTaskSet(join(root, "harness-tasks", "tasks"));
  const withSymbols = await taskSetIdentity(root, tasks, []);
  const without = await taskSetIdentity(root, tasks, null);
  assertEquals([withSymbols.provisional, without.provisional], [false, true]);
  assertNotEquals(without.identity, withSymbols.identity);
});

Deno.test("agentVisibleMetadata: exactly the whitelist, kind is not visible", async () => {
  const root = await fixtureRepo();
  const [t] = await loadTaskSet(join(root, "harness-tasks", "tasks"));
  const meta = agentVisibleMetadata(t!.task);
  assertEquals(Object.keys(meta).sort(), [...AGENT_VISIBLE_FIELDS].sort());
  assertEquals("kind" in meta, false);
});

const pkg = (app_id: string, name: string) => ({
  app_id,
  name,
  publisher: "Microsoft",
  version: "28.0.0.0",
  file: `Microsoft_${name}_28.0.0.0.app`,
  sha256: "a".repeat(64),
});
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

Deno.test("loadSymbolsLock: absent is null, packages sorted by app_id", async () => {
  const root = await Deno.makeTempDir();
  assertEquals(await loadSymbolsLock(root), null);
  await write(
    root,
    "harness-tasks/symbols.lock.json",
    JSON.stringify({ v: 1, packages: [pkg(B, "System"), pkg(A, "Base")] }),
  );
  assertEquals((await loadSymbolsLock(root))!.map((p) => p.app_id), [A, B]);
});

Deno.test("loadSymbolsLock: duplicates, bad digests, unknown version and bad JSON fail loudly", async () => {
  const cases = [
    JSON.stringify({ v: 1, packages: [pkg(A, "X"), pkg(A, "Y")] }),
    JSON.stringify({
      v: 1,
      packages: [{ ...pkg(A, "X"), sha256: "A".repeat(64) }],
    }),
    JSON.stringify({ v: 2, packages: [pkg(A, "X")] }),
    "{ not json",
  ];
  for (const text of cases) {
    const root = await Deno.makeTempDir();
    await write(root, "harness-tasks/symbols.lock.json", text);
    await assertRejects(
      () => loadSymbolsLock(root),
      ValidationError,
      "symbols.lock.json",
    );
  }
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
 * it). The task-set identity hashes only the sorted (id, visible, oracle)
 * projection, so adding a task never re-keys the others and a new commit
 * with identical content changes nothing.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import {
  hashContent,
  hashFile,
  hashJson,
  hashTree,
  isTaskBuildArtifact,
  type TreeEntry,
} from "./hash.ts";
import type { HarnessTask, LoadedTask } from "./task.ts";

/** Path of the refapp inside the repo; tags and commits resolve against it. */
export const REFAPP_PATH = "harness-tasks/refapp";

export interface RefappRef {
  version: string;
  /** Provenance only; not part of any hash. */
  commit: string;
  /** Hash of the canonical refapp source manifest (see refappSource). */
  source_hash: string;
  files: TreeEntry[];
}

async function git(
  repoRoot: string,
  args: string[],
  stdin?: Uint8Array,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const child = new Deno.Command("git", {
    args,
    cwd: repoRoot,
    stdin: stdin ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (stdin) {
    const w = child.stdin.getWriter();
    await w.write(stdin);
    await w.close();
  }
  const out = await child.output();
  return out.success ? out.stdout : null;
}

const text = (b: Uint8Array) => new TextDecoder().decode(b).trim();

/**
 * Canonical refapp source at a commit: every tracked file under REFAPP_PATH
 * except spec 1b section 7 build artifacts, hashed with the same content
 * rule as `listTree(dir, "task")` (CRLF to LF for text). Symlinks and
 * submodules in the tree are refused. Part 2 staging copies exactly these
 * paths from this commit, so a staged copy re-hashes to the same list.
 */
async function refappSource(
  repoRoot: string,
  commit: string,
): Promise<TreeEntry[]> {
  const ls = await git(repoRoot, [
    "ls-tree",
    "-r",
    "-z",
    commit,
    "--",
    `${REFAPP_PATH}/`,
  ]);
  if (!ls) throw new ValidationError(`git ls-tree failed at ${commit}`, []);
  const blobs: Array<{ rel: string; sha: string }> = [];
  for (const rec of new TextDecoder().decode(ls).split("\0")) {
    if (rec === "") continue;
    const [meta, path] = rec.split("\t") as [string, string];
    const [mode, , sha] = meta.split(" ") as [string, string, string];
    const rel = path.slice(REFAPP_PATH.length + 1);
    if (mode === "120000" || mode === "160000") {
      throw new ValidationError(`refapp contains a link or submodule: ${rel}`, [
        rel,
      ]);
    }
    if (!isTaskBuildArtifact(rel)) blobs.push({ rel, sha });
  }
  if (blobs.length === 0) return [];
  const batch = await git(
    repoRoot,
    ["cat-file", "--batch"],
    new TextEncoder().encode(blobs.map((b) => b.sha).join("\n") + "\n"),
  );
  if (!batch) throw new ValidationError("git cat-file failed", []);
  const out: TreeEntry[] = [];
  let at = 0;
  for (const b of blobs) {
    const nl = batch.indexOf(10, at);
    const size = Number(text(batch.subarray(at, nl)).split(" ")[2]);
    const content = batch.slice(nl + 1, nl + 1 + size);
    at = nl + 1 + size + 1;
    out.push({ path: b.rel, sha256: await hashContent(b.rel, content) });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Resolve a refapp tag or commit to an immutable commit and source hash. */
export async function resolveRefapp(
  repoRoot: string,
  version: string,
): Promise<RefappRef> {
  const out = await git(repoRoot, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${version}^{commit}`,
  ]);
  if (!out) {
    throw new ValidationError(`refapp_version ${version} does not resolve`, [
      version,
    ]);
  }
  const commit = text(out);
  const files = await refappSource(repoRoot, commit);
  if (files.length === 0) {
    throw new ValidationError(`${REFAPP_PATH} is empty at ${version}`, [
      version,
    ]);
  }
  return {
    version,
    commit,
    source_hash: await hashJson({ part: "refapp", files }),
    files,
  };
}

const SymbolPackageSchema = z.strictObject({
  app_id: z.uuid(),
  name: z.string().min(1),
  publisher: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  /** File name under the restored `.alpackages`, to locate and verify it. */
  file: z.string().regex(/^[^\\/]+\.app$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export const SymbolsLockSchema = z.strictObject({
  v: z.literal(1),
  packages: z.array(SymbolPackageSchema).min(1),
}).superRefine((l, ctx) => {
  const seen = new Set<string>();
  l.packages.forEach((p, i) => {
    if (seen.has(p.app_id)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate app_id ${p.app_id}`,
        path: ["packages", i, "app_id"],
      });
    }
    seen.add(p.app_id);
  });
});
export type SymbolPackage = z.output<typeof SymbolPackageSchema>;

export const SYMBOLS_LOCK_PATH = "harness-tasks/symbols.lock.json";

/**
 * Read the symbols lock; null when it does not exist yet (identities are
 * then provisional). Packages come back sorted by app_id.
 */
export async function loadSymbolsLock(
  repoRoot: string,
): Promise<SymbolPackage[] | null> {
  const path = join(repoRoot, SYMBOLS_LOCK_PATH);
  let raw: unknown;
  try {
    raw = JSON.parse(await Deno.readTextFile(path));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`${path}: ${msg}`, [msg]);
  }
  const result = SymbolsLockSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues.map((i) =>
      `${i.path.join(".") || "(root)"}: ${i.message}`
    );
    throw new ValidationError(
      `Invalid ${path}:\n  ${errors.join("\n  ")}`,
      errors,
    );
  }
  return [...result.data.packages].sort((a, b) =>
    a.app_id.localeCompare(b.app_id)
  );
}

/**
 * The only task.yml fields the agent may see (written to C:\task by Part 2
 * staging). `kind`, scorers and test lists are oracle-side; `touches`,
 * `coupling`, `contamination` are analysis metadata. If a field is ever
 * added here that is also an oracle input, it is hashed in both identities.
 */
export const AGENT_VISIBLE_FIELDS = ["id", "attachments", "limits"] as const;

export function agentVisibleMetadata(task: HarnessTask) {
  return {
    id: task.id,
    attachments: [...task.attachments].sort(),
    limits: task.limits,
  };
}

/**
 * Visible-input hash: prompt, attachments, canonical refapp source (includes
 * shipped Test\ sources), overlay/, symbols lock, agent-visible metadata.
 * `symbols: null` means no lock yet; the result is provisional.
 */
export async function visibleInputHash(
  t: LoadedTask,
  refapp: RefappRef,
  symbols: SymbolPackage[] | null,
): Promise<string> {
  const { task, dir } = t;
  const attachments = [];
  for (const a of [...task.attachments].sort()) {
    attachments.push({ path: a, sha256: await hashFile(join(dir, a)) });
  }
  return hashJson({
    part: "visible",
    source: task.source,
    refapp: refapp.source_hash,
    prompt: await hashFile(join(dir, task.prompt)),
    attachments,
    overlay: await hashTree(join(dir, "overlay"), "task", { optional: true }),
    symbols,
    metadata: agentVisibleMetadata(task),
  });
}

/**
 * Oracle hash: oracle/, mutants/, correct/ (a runtime input for
 * mutant_kill), and the scorer fields of task.yml. naive/ is in neither hash.
 */
export async function oracleHash(t: LoadedTask): Promise<string> {
  const { task, dir } = t;
  const tree = (d: string) =>
    hashTree(join(dir, d), "task", { optional: true });
  return hashJson({
    part: "oracle",
    id: task.id,
    kind: task.kind,
    scorers: task.scorers,
    pass_to_pass: task.pass_to_pass,
    fail_to_pass: task.fail_to_pass,
    mutants: task.mutants,
    oracle: await tree("oracle"),
    mutants_tree: await tree("mutants"),
    correct: await tree("correct"),
  });
}

export const TaskIdentitySchema = z.strictObject({
  id: z.string(),
  /** Provenance only; not hashed into the task-set identity. */
  refapp_commit: z.string(),
  visible: z.string().length(64),
  oracle: z.string().length(64),
});
export type TaskIdentity = z.output<typeof TaskIdentitySchema>;

export const TaskSetIdentitySchema = z.strictObject({
  identity: z.string().length(64),
  /** True while no symbols lock exists; campaigns refuse it (M1-07). */
  provisional: z.boolean(),
  tasks: z.array(TaskIdentitySchema),
});
export type TaskSetIdentity = z.output<typeof TaskSetIdentitySchema>;

/** Identity over the sorted (id, visible, oracle) projection only. */
export function taskSetHash(tasks: TaskIdentity[]): Promise<string> {
  const projection = [...tasks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, visible, oracle }) => ({ id, visible, oracle }));
  return hashJson({ part: "task-set", tasks: projection });
}

/** Hash every task and build the sorted task-set manifest. */
export async function taskSetIdentity(
  repoRoot: string,
  tasks: LoadedTask[],
  symbols: SymbolPackage[] | null,
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
    identity: await taskSetHash(entries),
    provisional: symbols === null,
    tasks: entries,
  };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/identity.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/identity.ts tests/unit/harness/identity.test.ts
deno lint src/harness/identity.ts tests/unit/harness/identity.test.ts
deno fmt src/harness/identity.ts tests/unit/harness/identity.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/identity.ts tests/unit/harness/identity.test.ts
git commit -m "feat(harness): visible and oracle task hashes, canonical refapp source, task-set identity"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/identity.test.ts` exits 0, and check / lint / fmt --check are clean on the two files.

---

### Task M1-05: resolved manifest, component hashes, vary enforcement

Spec 1a section 4 (resolved execution manifest: native settings as written, component contents, MCP versions and tool-schema hashes, model routing and provider route, image digest, backend version, limits; per-component hashes; config identity), section 6 and D15 (`vary`), section 11 (`vary` enforcement test). Review must-change 5 and 6: manifests under other hashing rules are refused before any comparison; every model slot needs a provider route; native settings and image provenance (digest and base digest) are recorded; the arm template and the task-effective execution manifest are separate, so a stricter task limit never changes arm identity. Owner rule 10: image differs only with `harness`, `harness_version` or `toolchain`; provider routes only with `models`; backend never.

**Deps:** M1-02, M1-03.

**Files:**
- Create: `src/harness/manifest.ts`
- Test: `tests/unit/harness/manifest.test.ts`

**Interfaces:**
- Consumes: `HarnessConfig`, `HarnessConfigSchema`, `Limits`, `VaryKey`, `effectiveLimits` (M1-03); `HASH_RULES_VERSION`, `hashFile`, `hashJson`, `hashTree`, `listTree` (M1-02); `HarnessTask` (M1-01).
- Produces: `ResolvedManifestSchema`, `type ResolvedManifest`; `interface RuntimeFacts`; `resolveManifest(harnessRoot, config, facts): Promise<ResolvedManifest>` (arm template); `forTask(template, taskLimits): ResolvedManifest`; `MANIFEST_KEYS`, `type ManifestKey`; `componentHashes(m)`; `manifestHash(m)`; `diffManifests(a, b): Promise<ManifestKey[]>` (refuses other rules); `allowedDiffs(vary)`; `assertVaryHolds(baseline, variant, vary)`; `armMismatch(template, execution): Promise<string[]>`.

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
  armMismatch,
  assertVaryHolds,
  diffManifests,
  forTask,
  manifestHash,
  ResolvedManifestSchema,
  resolveManifest,
  type RuntimeFacts,
} from "../../../src/harness/manifest.ts";

const FACTS: RuntimeFacts = {
  native_settings: { model: "model-a", effort: "high" },
  image: { digest: "sha256:img1", base_digest: "sha256:base1" },
  backend_version: "cg-al-backend@1",
  servers: { "al-tools": { version: "1.0.0", tool_schema_hash: "s1" } },
  provider_routes: { main: "anthropic" },
};

async function root(): Promise<string> {
  const r = await Deno.makeTempDir();
  for (
    const [rel, text] of Object.entries({
      "bundles/al/skills/objid/SKILL.md": "Allocate object ids.",
      "bundles/al/skills/.hidden/manifest.json": "{}",
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

Deno.test("manifestHash: golden resolved manifest", async () => {
  const m = ResolvedManifestSchema.parse({
    v: 1,
    rules: "hr1",
    config_id: "golden",
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/model-a" },
    settings: { requested: { reasoning: "high" }, native: { effort: "high" } },
    limits: { timeout_min: 30, max_budget_usd: 5 },
    instructions: null,
    skills: null,
    agents: null,
    hooks: null,
    plugins: [],
    mcp: [{ name: "al-tools", version: "1.0.0", tool_schema_hash: "s1" }],
    lsp: [],
    toolchain: [],
    image: { digest: "sha256:img1", base_digest: "sha256:base1" },
    backend_version: "b1",
    provider_routes: { main: "anthropic" },
  });
  assertEquals(
    await manifestHash(m),
    "6ae14d261de04f54c09e5e9d8585ad15a3537c757e9cb5f7dcb07e7b08cfdf40",
  );
});

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

Deno.test("resolveManifest: a hidden bundle file edit changes only the skills hash", async () => {
  const r = await root();
  const cfg = config("cc-a", {
    skills: "bundles/al/skills",
    instructions: "bundles/al/nudge.md",
  });
  const before = await resolveManifest(r, cfg, FACTS);
  await Deno.writeTextFile(
    join(r, "bundles/al/skills/.hidden/manifest.json"),
    '{"hook":true}',
  );
  const after = await resolveManifest(r, cfg, FACTS);
  assertEquals(await diffManifests(before, after), ["skills"]);
});

Deno.test("resolveManifest: native settings are part of settings identity", async () => {
  const r = await root();
  const a = await resolveManifest(r, config("a"), FACTS);
  const b = await resolveManifest(r, config("a"), {
    ...FACTS,
    native_settings: { model: "model-a", effort: "low" },
  });
  assertEquals(await diffManifests(a, b), ["settings"]);
});

Deno.test("resolveManifest: missing MCP facts or provider route is refused", async () => {
  const r = await root();
  await assertRejects(
    () => resolveManifest(r, config("cc-a", { mcp: ["other"] }), FACTS),
    ConfigurationError,
    "other",
  );
  await assertRejects(
    () => resolveManifest(r, config("cc-a"), { ...FACTS, provider_routes: {} }),
    ConfigurationError,
    "no provider route for model slot(s) main",
  );
});

Deno.test("assertVaryHolds: inside vary passes, outside is refused", async () => {
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
    { ...FACTS, image: { digest: "sha256:img2", base_digest: "sha256:base1" } },
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

Deno.test("assertVaryHolds: a manifest under other hashing rules is refused", async () => {
  const r = await root();
  const a = await resolveManifest(r, config("a"), FACTS);
  const old = { ...a, config_id: "old", rules: "hr0" };
  await assertRejects(
    () => assertVaryHolds(a, old, ["skills"]),
    ConfigurationError,
    "rules hr0",
  );
});

Deno.test("forTask: task limits tighten the execution, not the arm", async () => {
  const r = await root();
  const template = await resolveManifest(r, config("a"), FACTS);
  const exec = forTask(template, { timeout_min: 20 });
  assertEquals(exec.limits, { timeout_min: 20, max_budget_usd: 5 });
  assertEquals(template.limits.timeout_min, 30);
  assertEquals(await armMismatch(template, exec), []);
  const looser = { ...exec, limits: { timeout_min: 60, max_budget_usd: 5 } };
  assertEquals(await armMismatch(template, looser), [
    "limits are looser than the arm template",
  ]);
  const other = await resolveManifest(
    r,
    config("a", { skills: "bundles/al/skills" }),
    FACTS,
  );
  assertEquals(await armMismatch(template, other), [
    "component skills differs from the arm",
  ]);
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
 * Two levels: the campaign stores an arm TEMPLATE (config limits); each
 * execution stores the template with task-effective limits (`forTask`), so a
 * stricter task limit never changes arm identity.
 *
 * Runtime facts (native settings as written into the container, image and
 * base image digests, backend version, MCP/LSP versions and tool-schema
 * hashes, provider route per model slot) are inputs; Part 2 collects them.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ConfigurationError } from "../errors.ts";
import type { HarnessConfig, Limits, VaryKey } from "./config.ts";
import { effectiveLimits } from "./config.ts";
import {
  HASH_RULES_VERSION,
  hashFile,
  hashJson,
  hashTree,
  listTree,
} from "./hash.ts";
import type { HarnessTask } from "./task.ts";

const Sha = z.string().length(64);
const PathComponent = z.strictObject({
  path: z.string(),
  hash: Sha,
  /** Per-file snapshot, so a diff can name the file (durable content ref). */
  files: z.array(z.strictObject({ path: z.string(), sha256: Sha })),
});
const Server = z.strictObject({
  name: z.string(),
  version: z.string().min(1),
  tool_schema_hash: z.string().min(1),
});

export const ResolvedManifestSchema = z.strictObject({
  v: z.literal(1),
  rules: z.string(),
  config_id: z.string(),
  harness: z.string(),
  harness_version: z.string(),
  models: z.record(z.string(), z.string()),
  settings: z.strictObject({
    requested: z.record(z.string(), z.unknown()),
    /** Native harness settings exactly as written into the container. */
    native: z.record(z.string(), z.unknown()),
  }),
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
  image: z.strictObject({
    digest: z.string().min(1),
    base_digest: z.string().min(1),
  }),
  backend_version: z.string().min(1),
  /** Provider route per model slot; every slot in `models` has one. */
  provider_routes: z.record(z.string(), z.string().min(1)),
}).refine(
  (m) =>
    Object.keys(m.models).sort().join() ===
      Object.keys(m.provider_routes).sort().join(),
  { message: "provider_routes must cover exactly the model slots" },
);
export type ResolvedManifest = z.output<typeof ResolvedManifestSchema>;

export interface RuntimeFacts {
  native_settings: Record<string, unknown>;
  image: { digest: string; base_digest: string };
  backend_version: string;
  servers: Record<string, { version: string; tool_schema_hash: string }>;
  provider_routes: Record<string, string>;
}

async function pathComponent(harnessRoot: string, rel: string) {
  const abs = join(harnessRoot, rel);
  if ((await Deno.lstat(abs)).isDirectory) {
    return {
      path: rel,
      hash: await hashTree(abs, "bundle"),
      files: await listTree(abs, "bundle"),
    };
  }
  const sha256 = await hashFile(abs);
  const files = [{ path: rel.split("/").pop()!, sha256 }];
  return { path: rel, hash: await hashJson({ file: sha256 }), files };
}

function servers(names: string[], facts: RuntimeFacts, kind: string) {
  return [...names].sort().map((name) => {
    const f = facts.servers[name];
    if (!f) {
      throw new ConfigurationError(
        `${kind} component ${name} has no runtime facts (version, tool schema)`,
      );
    }
    return { name, ...f };
  });
}

/** Resolve a config plus runtime facts into an arm template. */
export async function resolveManifest(
  harnessRoot: string,
  config: HarnessConfig,
  facts: RuntimeFacts,
): Promise<ResolvedManifest> {
  const missingRoutes = Object.keys(config.models).filter((slot) =>
    !facts.provider_routes[slot]
  );
  if (missingRoutes.length > 0) {
    throw new ConfigurationError(
      `${config.id}: no provider route for model slot(s) ${
        missingRoutes.join(", ")
      }`,
    );
  }
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
    settings: { requested: config.settings, native: facts.native_settings },
    limits: config.limits,
    instructions: await opt(c.instructions),
    skills: await opt(c.skills),
    agents: await opt(c.agents),
    hooks: await opt(c.hooks),
    plugins,
    mcp: servers(c.mcp, facts, "mcp"),
    lsp: servers(c.lsp, facts, "lsp"),
    toolchain: [...c.toolchain].sort(),
    image: facts.image,
    backend_version: facts.backend_version,
    provider_routes: Object.fromEntries(
      Object.keys(config.models).map((s) => [s, facts.provider_routes[s]!]),
    ),
  });
}

/** The execution manifest: the arm template with task-effective limits. */
export function forTask(
  template: ResolvedManifest,
  taskLimits: HarnessTask["limits"],
): ResolvedManifest {
  return { ...template, limits: effectiveLimits(template.limits, taskLimits) };
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
  "image",
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

function assertComparable(a: ResolvedManifest, b: ResolvedManifest): void {
  for (const m of [a, b]) {
    if (m.v !== 1 || m.rules !== HASH_RULES_VERSION) {
      throw new ConfigurationError(
        `${m.config_id}: manifest v${m.v} rules ${m.rules} is not comparable under ${HASH_RULES_VERSION}; re-resolve it`,
      );
    }
  }
}

/** Keys whose component hashes differ, in MANIFEST_KEYS order. */
export async function diffManifests(
  a: ResolvedManifest,
  b: ResolvedManifest,
): Promise<ManifestKey[]> {
  assertComparable(a, b);
  const [ha, hb] = [await componentHashes(a), await componentHashes(b)];
  return MANIFEST_KEYS.filter((k) => ha[k] !== hb[k]);
}

/**
 * Keys a vary list permits to differ. The image follows harness,
 * harness_version or toolchain (bundles are mounted, not baked); provider
 * routes follow models. backend_version never differs.
 */
export function allowedDiffs(vary: readonly VaryKey[]): Set<ManifestKey> {
  const allowed = new Set<ManifestKey>(vary);
  if (
    vary.some((k) => ["harness", "harness_version", "toolchain"].includes(k))
  ) {
    allowed.add("image");
  }
  if (vary.includes("models")) allowed.add("provider_routes");
  return allowed;
}

/** Refuse a variant whose template differs from the baseline outside `vary`. */
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

/**
 * Problems that stop an execution manifest from belonging to an arm: any
 * component other than limits differs, or a limit is looser than the
 * template. Empty = belongs.
 */
export async function armMismatch(
  template: ResolvedManifest,
  execution: ResolvedManifest,
): Promise<string[]> {
  const diffs = (await diffManifests(template, execution))
    .filter((k) => k !== "limits");
  const problems = diffs.map((k) => `component ${k} differs from the arm`);
  const t: Limits = template.limits;
  const e: Limits = execution.limits;
  if (e.timeout_min > t.timeout_min || e.max_budget_usd > t.max_budget_usd) {
    problems.push("limits are looser than the arm template");
  }
  return problems;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/manifest.test.ts`
Expected: all tests pass with the golden manifest hash unchanged.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/manifest.ts tests/unit/harness/manifest.test.ts
deno lint src/harness/manifest.ts tests/unit/harness/manifest.test.ts
deno fmt src/harness/manifest.ts tests/unit/harness/manifest.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/manifest.ts tests/unit/harness/manifest.test.ts
git commit -m "feat(harness): resolved manifests, component diff, vary and rules enforcement"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/manifest.test.ts` exits 0 with the golden hash unchanged, and check / lint / fmt --check are clean on the two files.

---

### Task M1-06: statistics for the primary metric

Spec 1a section 1 (primary metric counts every execution's spend), section 9 (task is the unit; equal task weight; paired task-level bootstrap; "not distinguishable", never "equal"; pass rate; pass^k), D8 (unknown is null, never 0). Owner rules 1, 2 and 4, and review must-changes 1 and 2:

- A cell is `unrun`, `pending`, `scored` or `unscored` (terminal). Its spend sums every attempt.
- The cost headline uses terminal cells with known spend: per task, mean spend over those cells divided into the sum of per-task pass rates over the scored ones. Unscored terminal spend counts; pending spend is reported separately and makes the result provisional.
- Pass rate uses scored cells only. pass^k needs every distinct repeat 1..k scored.
- Comparisons use matched (task, repeat) pairs eligible in both arms; each exclusion is counted per arm and reason (`unrun`, `pending`, `unscored`, `unknown_spend`, `missing`).
- Any undefined resample suppresses the CI and the verdict. Resamples must be a positive integer, the level strictly between 0 and 1, the seed a non-negative integer.

**Deps:** M1-03 (`PrimaryMetric` type).

**Files:**
- Create: `src/harness/stats.ts`
- Test: `tests/unit/harness/stats.test.ts`

**Interfaces:**
- Consumes: `type PrimaryMetric` (M1-03); `percentile` from `cli/commands/report/stats-calculator.ts`.
- Produces: `type CellStatus`; `interface Cell { task; arm; repeat; status; pass: boolean | null; spend_usd: number | null; attempts: number }`; `type ExclusionReason`; `mulberry32(seed)`; `checkCells(cells)`; `interface ArmSummary` (planned / attempted / scored / unscored / pending / unrun counts, `unknown_spend_cells`, `total_spend_usd`, `pending_spend_usd`, `cost_per_solved_task`, `pass_rate`, `pass_k`, `pass_k_tasks`, `provisional`); `armSummary(cells, arm, k)`; `interface Comparison` (`pairs`, `tasks`, `tasks_dropped`, `excluded`, `delta`, `ci`, `level`, `undefined_share`, `distinguishable`, `resamples`, `seed`, `provisional`); `interface BootstrapOptions`; `checkBootstrapOptions(opts)`; `compareArms(cells, baseline, variant, metric, opts?)`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/stats.test.ts`:

```typescript
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { ValidationError } from "../../../src/errors.ts";
import {
  armSummary,
  type Cell,
  type CellStatus,
  compareArms,
  mulberry32,
} from "../../../src/harness/stats.ts";

type Row = [CellStatus | boolean, number | null];

/** true/false = scored pass/fail; a status string = that status. */
function cells(arm: string, task: string, rows: Row[]): Cell[] {
  return rows.map(([s, spend], i) => ({
    task,
    arm,
    repeat: i + 1,
    status: typeof s === "boolean" ? "scored" : s,
    pass: typeof s === "boolean" ? s : null,
    spend_usd: s === "unrun" ? 0 : spend,
    attempts: s === "unrun" ? 0 : 1,
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
  assertEquals([s.pass_k, s.pass_k_tasks], [0.5, 2]);
  assertEquals(s.provisional, false);
});

Deno.test("armSummary: every task has equal weight", () => {
  const cs = [
    ...cells("A", "t1", [[true, 10]]),
    ...cells("A", "t2", [[true, 1], [true, 1], [true, 1]]),
  ];
  // per-task means 10 and 1 -> 11 / 2, not the pooled 13 / 4
  assertEquals(armSummary(cs, "A", 3).cost_per_solved_task, 5.5);
});

Deno.test("armSummary: spend of an unscored cell counts (owner rule 1)", () => {
  // $1 solved cell plus a $9 cell whose setup retries were exhausted.
  const cs = cells("A", "t1", [[true, 1], ["unscored", 9]]);
  const s = armSummary(cs, "A", 2);
  // mean spend (1 + 9) / 2 = 5; pass rate over scored cells = 1 -> $5, not $1
  assertEquals(s.cost_per_solved_task, 5);
  assertEquals(s.total_spend_usd, 10);
  assertEquals(s.unscored_cells, 1);
});

Deno.test("armSummary: pending spend is disclosed, not in the headline, and marks it provisional", () => {
  const cs = cells("A", "t1", [[true, 2], ["pending", 7], ["unrun", null]]);
  const s = armSummary(cs, "A", 3);
  assertEquals(s.cost_per_solved_task, 2);
  assertEquals(s.pending_spend_usd, 7);
  assertEquals(s.total_spend_usd, 9);
  assertEquals([s.pending_cells, s.unrun_cells, s.attempted_cells], [1, 1, 2]);
  assertEquals(s.provisional, true);
});

Deno.test("armSummary: unknown spend leaves the cost metric but not the pass rate", () => {
  const cs = cells("A", "t1", [[true, 3], [false, 3], [true, null]]);
  const s = armSummary(cs, "A", 3);
  assertEquals(s.cost_per_solved_task, 6);
  assertAlmostEquals(s.pass_rate!, 2 / 3, 1e-12);
  assertEquals(s.unknown_spend_cells, 1);
});

Deno.test("armSummary: no solved task gives null, not Infinity or 0", () => {
  const s = armSummary(cells("A", "t1", [[false, 2], [false, 2]]), "A", 2);
  assertEquals(s.cost_per_solved_task, null);
  assertEquals(s.pass_rate, 0);
});

Deno.test("cells: duplicate repeats and pass/status mismatch are refused", () => {
  const dup = [
    ...cells("A", "t1", [[true, 1]]),
    ...cells("A", "t1", [[true, 1]]),
  ];
  assertThrows(
    () => armSummary(dup, "A", 1),
    ValidationError,
    "duplicate cell",
  );
  const bad: Cell[] = [{
    task: "t1",
    arm: "A",
    repeat: 1,
    status: "pending",
    pass: true,
    spend_usd: 1,
    attempts: 1,
  }];
  assertThrows(
    () => armSummary(bad, "A", 1),
    ValidationError,
    "pass must be set",
  );
});

Deno.test("armSummary: pass^k needs every distinct repeat 1..k scored", () => {
  const cs = [
    ...cells("A", "t1", [[true, 1], [true, 1], ["pending", 1]]),
    ...cells("A", "t2", [[true, 1], [true, 1], [true, 1]]),
  ];
  assertEquals(armSummary(cs, "A", 3).pass_k_tasks, 1);
});

function twoArms(variantCost: number): Cell[] {
  const out: Cell[] = [];
  for (let t = 1; t <= 8; t++) {
    const rows: Row[] = [[true, 2], [t % 2 === 0, 2], [true, 2]];
    out.push(...cells("base", `t${t}`, rows));
    out.push(
      ...cells("var", `t${t}`, rows.map(([p]) => [p, variantCost] as Row)),
    );
  }
  return out;
}

Deno.test("compareArms: cheaper on every task is distinguishable and reproducible", () => {
  const cs = twoArms(1);
  const opts = { seed: 7, resamples: 500 };
  const r1 = compareArms(cs, "base", "var", "cost_per_solved_task", opts);
  assertEquals(
    r1,
    compareArms(cs, "base", "var", "cost_per_solved_task", opts),
  );
  assert(r1.delta! < 0);
  assert(r1.ci![1] < 0);
  assertEquals([r1.distinguishable, r1.tasks, r1.pairs], [true, 8, 24]);
});

Deno.test("compareArms: identical arms are not distinguishable", () => {
  const r = compareArms(twoArms(2), "base", "var", "cost_per_solved_task", {
    resamples: 200,
  });
  assertEquals([r.delta, r.ci, r.distinguishable], [0, [0, 0], false]);
});

Deno.test("compareArms: matched pairs only, exclusions counted per arm and reason (owner rule 2)", () => {
  const cs = [
    ...cells("base", "t1", [[true, 1], [false, 1], [true, null]]),
    ...cells("var", "t1", [[true, 1], ["pending", 4], [true, 1]]),
    ...cells("var", "t2", [[true, 1]]),
  ];
  const r = compareArms(cs, "base", "var", "cost_per_solved_task", {
    resamples: 50,
  });
  assertEquals(r.pairs, 1);
  assertEquals(r.excluded, {
    baseline: { unknown_spend: 1, missing: 1 },
    variant: { pending: 1 },
  });
  assertEquals([r.tasks, r.tasks_dropped], [1, 1]);
  assertEquals(r.provisional, true);
});

Deno.test("compareArms: pass_rate metric", () => {
  const cs = [
    ...cells("base", "t1", [[true, 1], [false, 1]]),
    ...cells("var", "t1", [[true, 1], [true, 1]]),
  ];
  const r = compareArms(cs, "base", "var", "pass_rate", { resamples: 100 });
  assertEquals(r.delta, 0.5);
});

Deno.test("compareArms: any undefined resample suppresses CI and verdict (owner rule 4)", () => {
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
  assert(r.undefined_share > 0 && r.undefined_share < 1);
  assertEquals([r.ci, r.distinguishable], [null, null]);
  assertEquals(r.delta, 1);
});

Deno.test("compareArms: invalid bootstrap options are refused", () => {
  const cs = twoArms(1);
  for (
    const opts of [{ resamples: 0 }, { resamples: 2.5 }, { level: 1 }, {
      level: 0,
    }, { seed: -1 }]
  ) {
    assertThrows(
      () => compareArms(cs, "base", "var", "pass_rate", opts),
      ValidationError,
    );
  }
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/stats.test.ts`
Expected: FAIL, `Module not found ".../src/harness/stats.ts"`.

- [ ] **Step 3: Implement**

`src/harness/stats.ts`:

```typescript
/**
 * Harness Bench statistics (spec 1a section 9, owner rules
 * H:\cg-coord\decisions\2026-09-25-m1-metric-rules.md).
 *
 * - Cost per solved task = sum over tasks of per-task mean spend (spend of
 *   EVERY attempt of a cell, scored or not) / sum over tasks of per-task pass
 *   rate. Equal task weight. Only terminal cells (scored or terminally
 *   unscored) enter the headline; pending spend is disclosed and the headline
 *   is provisional while any cell is pending or unrun.
 * - A baseline-variant comparison uses matched (task, repeat) pairs eligible
 *   in both arms; exclusions are counted per arm and reason.
 * - Paired task-level bootstrap. If any resample is undefined (no solve), the
 *   CI and the distinguishable verdict are suppressed.
 */

import { percentile } from "../../cli/commands/report/stats-calculator.ts";
import { ValidationError } from "../errors.ts";
import type { PrimaryMetric } from "./config.ts";

/**
 * unrun: no execution yet. pending: attempts exist but the cell is not
 * final (retry due, usage-limit pause, verdict missing or infra-unscored).
 * scored: final verdict pass or fail. unscored: terminally unscored
 * (automatic retry exhausted).
 */
export type CellStatus = "unrun" | "pending" | "scored" | "unscored";

/** One planned (task, repeat, arm) cell. */
export interface Cell {
  task: string;
  arm: string;
  repeat: number;
  status: CellStatus;
  /** Non-null exactly when status is "scored". */
  pass: boolean | null;
  /** Sum over every attempt; null when any attempt's cost is unknown. */
  spend_usd: number | null;
  attempts: number;
}

export type ExclusionReason = CellStatus | "unknown_spend" | "missing";

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

const key = (task: string, repeat: number) => `${task}\u0000${repeat}`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Reject duplicate cells and pass/status mismatches. */
export function checkCells(cells: Cell[]): void {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const c of cells) {
    const k = `${c.arm}/${c.task}/${c.repeat}`;
    if (seen.has(k)) errors.push(`duplicate cell ${k}`);
    seen.add(k);
    if ((c.pass !== null) !== (c.status === "scored")) {
      errors.push(`cell ${k}: pass must be set exactly when scored`);
    }
  }
  if (errors.length > 0) {
    throw new ValidationError(
      `Invalid cells:\n  ${errors.join("\n  ")}`,
      errors,
    );
  }
}

/** Why a cell cannot enter a metric; null = eligible. */
function ineligible(c: Cell, metric: PrimaryMetric): ExclusionReason | null {
  if (c.status === "unrun" || c.status === "pending") return c.status;
  if (metric === "pass_rate") return c.status === "scored" ? null : "unscored";
  return c.spend_usd === null ? "unknown_spend" : null;
}

interface TaskStat {
  spend: number;
  solved: number;
}

/** Per-task means over eligible cells (see module comment). */
function taskStats(
  cells: Cell[],
  metric: PrimaryMetric,
): Map<string, TaskStat> {
  const byTask = new Map<string, Cell[]>();
  for (const c of cells) {
    if (ineligible(c, metric) !== null) continue;
    byTask.set(c.task, [...(byTask.get(c.task) ?? []), c]);
  }
  const out = new Map<string, TaskStat>();
  for (const [task, cs] of byTask) {
    const scored = cs.filter((c) => c.status === "scored");
    out.set(task, {
      spend: metric === "pass_rate" ? 0 : mean(cs.map((c) => c.spend_usd!)),
      solved: scored.length === 0
        ? 0
        : scored.filter((c) => c.pass).length / scored.length,
    });
  }
  return out;
}

function statistic(metric: PrimaryMetric, stats: TaskStat[]): number | null {
  if (stats.length === 0) return null;
  if (metric === "pass_rate") return mean(stats.map((s) => s.solved));
  const solved = sum(stats.map((s) => s.solved));
  return solved === 0 ? null : sum(stats.map((s) => s.spend)) / solved;
}

export interface ArmSummary {
  arm: string;
  planned_cells: number;
  attempted_cells: number;
  scored_cells: number;
  unscored_cells: number;
  pending_cells: number;
  unrun_cells: number;
  /** Terminal cells left out of the cost metric (an attempt's cost unknown). */
  unknown_spend_cells: number;
  /** Known spend of every attempt in every cell, raw. */
  total_spend_usd: number;
  /** Known spend of pending cells (not yet in the headline). */
  pending_spend_usd: number;
  cost_per_solved_task: number | null;
  pass_rate: number | null;
  /** Share of tasks passing all k distinct repeats, over tasks with all k scored. */
  pass_k: number | null;
  pass_k_tasks: number;
  /** True while any cell is pending or unrun. */
  provisional: boolean;
}

export function armSummary(cells: Cell[], arm: string, k: number): ArmSummary {
  checkCells(cells);
  const mine = cells.filter((c) => c.arm === arm);
  const count = (s: CellStatus) => mine.filter((c) => c.status === s).length;
  const known = (cs: Cell[]) => sum(cs.map((c) => c.spend_usd ?? 0));
  const repeatsByTask = new Map<string, Map<number, boolean>>();
  for (const c of mine) {
    if (c.status !== "scored") continue;
    const m = repeatsByTask.get(c.task) ?? new Map<number, boolean>();
    m.set(c.repeat, c.pass!);
    repeatsByTask.set(c.task, m);
  }
  const full = [...repeatsByTask.values()].filter((m) =>
    m.size === k && Array.from({ length: k }, (_, i) => i + 1)
      .every((r) => m.has(r))
  );
  return {
    arm,
    planned_cells: mine.length,
    attempted_cells: mine.filter((c) => c.attempts > 0).length,
    scored_cells: count("scored"),
    unscored_cells: count("unscored"),
    pending_cells: count("pending"),
    unrun_cells: count("unrun"),
    unknown_spend_cells:
      mine.filter((c) =>
        (c.status === "scored" || c.status === "unscored") &&
        c.spend_usd === null
      ).length,
    total_spend_usd: known(mine),
    pending_spend_usd: known(mine.filter((c) => c.status === "pending")),
    cost_per_solved_task: statistic("cost_per_solved_task", [
      ...taskStats(mine, "cost_per_solved_task").values(),
    ]),
    pass_rate: statistic("pass_rate", [
      ...taskStats(mine, "pass_rate").values(),
    ]),
    pass_k: full.length === 0
      ? null
      : full.filter((m) => [...m.values()].every(Boolean)).length /
        full.length,
    pass_k_tasks: full.length,
    provisional: count("pending") + count("unrun") > 0,
  };
}

export interface Comparison {
  metric: PrimaryMetric;
  baseline: string;
  variant: string;
  /** Matched (task, repeat) pairs eligible in both arms. */
  pairs: number;
  /** Tasks with at least one matched pair; the bootstrap unit. */
  tasks: number;
  /** Tasks planned but without any matched pair. */
  tasks_dropped: number;
  /** Unmatched pairs by the reason each arm's cell was ineligible. */
  excluded: {
    baseline: Partial<Record<ExclusionReason, number>>;
    variant: Partial<Record<ExclusionReason, number>>;
  };
  /** variant minus baseline over matched pairs; null when undefined. */
  delta: number | null;
  /** Suppressed (null) when any resample is undefined. */
  ci: [number, number] | null;
  level: number;
  undefined_share: number;
  /** false = "not distinguishable" (CI includes zero). null = suppressed. */
  distinguishable: boolean | null;
  resamples: number;
  seed: number;
  provisional: boolean;
}

export interface BootstrapOptions {
  resamples?: number;
  seed?: number;
  level?: number;
}

export function checkBootstrapOptions(opts: BootstrapOptions): void {
  const errors: string[] = [];
  const { resamples = 2000, seed = 1, level = 0.95 } = opts;
  if (!Number.isInteger(resamples) || resamples < 1) {
    errors.push(`resamples must be a positive integer, got ${resamples}`);
  }
  if (!Number.isInteger(seed) || seed < 0) {
    errors.push(`seed must be a non-negative integer, got ${seed}`);
  }
  if (!(level > 0 && level < 1)) {
    errors.push(`level must be between 0 and 1, got ${level}`);
  }
  if (errors.length > 0) {
    throw new ValidationError(errors.join("; "), errors);
  }
}

/** Paired task-level bootstrap of variant minus baseline over matched pairs. */
export function compareArms(
  cells: Cell[],
  baseline: string,
  variant: string,
  metric: PrimaryMetric,
  opts: BootstrapOptions = {},
): Comparison {
  checkCells(cells);
  checkBootstrapOptions(opts);
  const resamples = opts.resamples ?? 2000;
  const seed = opts.seed ?? 1;
  const level = opts.level ?? 0.95;
  const arm = (name: string) =>
    new Map(
      cells.filter((c) => c.arm === name).map((
        c,
      ) => [key(c.task, c.repeat), c]),
    );
  const b = arm(baseline);
  const v = arm(variant);
  const excluded: Comparison["excluded"] = { baseline: {}, variant: {} };
  const matchedB: Cell[] = [];
  const matchedV: Cell[] = [];
  const allTasks = new Set<string>();
  for (const k of new Set([...b.keys(), ...v.keys()])) {
    const cb = b.get(k);
    const cv = v.get(k);
    allTasks.add((cb ?? cv)!.task);
    const rb = cb ? ineligible(cb, metric) : "missing";
    const rv = cv ? ineligible(cv, metric) : "missing";
    if (rb === null && rv === null) {
      matchedB.push(cb!);
      matchedV.push(cv!);
      continue;
    }
    if (rb) excluded.baseline[rb] = (excluded.baseline[rb] ?? 0) + 1;
    if (rv) excluded.variant[rv] = (excluded.variant[rv] ?? 0) + 1;
  }
  const sb = taskStats(matchedB, metric);
  const sv = taskStats(matchedV, metric);
  const tasks = [...sb.keys()].sort();
  const delta = (sample: string[]): number | null => {
    const xb = statistic(metric, sample.map((t) => sb.get(t)!));
    const xv = statistic(metric, sample.map((t) => sv.get(t)!));
    return xb === null || xv === null ? null : xv - xb;
  };
  const provisional = cells.some((c) =>
    (c.arm === baseline || c.arm === variant) &&
    (c.status === "pending" || c.status === "unrun")
  );
  const base = {
    metric,
    baseline,
    variant,
    pairs: matchedB.length,
    tasks: tasks.length,
    tasks_dropped: allTasks.size - tasks.length,
    excluded,
    level,
    resamples,
    seed,
    provisional,
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
  for (let i = 0; i < resamples; i++) {
    const d = delta(tasks.map(() => tasks[Math.floor(rand() * tasks.length)]!));
    if (d !== null) deltas.push(d);
  }
  const undefinedShare = (resamples - deltas.length) / resamples;
  const alpha = (1 - level) / 2;
  const ci: [number, number] | null = undefinedShare > 0
    ? null
    : [percentile(deltas, alpha), percentile(deltas, 1 - alpha)];
  return {
    ...base,
    delta: delta(tasks),
    ci,
    undefined_share: undefinedShare,
    distinguishable: ci === null ? null : !(ci[0] <= 0 && 0 <= ci[1]),
  };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/stats.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/stats.ts tests/unit/harness/stats.test.ts
deno lint src/harness/stats.ts tests/unit/harness/stats.test.ts
deno fmt src/harness/stats.ts tests/unit/harness/stats.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/stats.ts tests/unit/harness/stats.test.ts
git commit -m "feat(harness): all-attempt cost per solved task, matched-pair bootstrap"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/stats.test.ts` exits 0, and check / lint / fmt --check are clean on the two files.

---

### Task M1-07: records, campaign plan and the record store

Spec 1a section 6 (execution, artifact, judgment records; randomized, recorded arm order within blocks, D17; immutable JSON), section 5 (telemetry, all nullable, D8; cost basis decided 2026-09-24), section 7 (per-procedure results; test-authoring targets), section 8 (termination, verdict, validity). Review must-changes 3, 4 and 6 and owner rules 3, 5 and 12:

- Artifacts are per-execution associations (`artifacts/<execution-id>.json`) to a content-addressed workspace; judgments are stored per execution. Identical bytes from two executions no longer collide.
- `telemetry.cost_usd` must be the estimated list price with a pricing snapshot; the harness's own number goes to `reported_cost_usd`.
- Validity is `{ incomplete_telemetry: fields[], infra_exposed }`.
- `run_kind` and `retry_of` separate automatic retry chains from manual reruns.
- The campaign schema enforces the arm set, unique and complete (task, repeat) coverage, block indices and permutations, `tasks_meta`, and explicit `reuse` references.
- Publication is crash-safe (temp file, hard link with no replace, remove temp); malformed JSON is a `ValidationError` naming the file.

**Deps:** M1-01 (`TASK_KINDS`), M1-02, M1-03, M1-04, M1-05, M1-06.

**Files:**
- Create: `src/harness/records.ts`
- Create: `tests/unit/harness/fixtures.ts` (consistent builders reused by M1-07b, M1-08, M1-09, M1-10)
- Test: `tests/unit/harness/records.test.ts`

**Interfaces:**
- Consumes: `ExperimentSchema`, `Experiment` (M1-03); `hashJson` (M1-02); `TaskSetIdentitySchema`, `taskSetHash` (M1-04, fixtures); `ResolvedManifestSchema`, `manifestHash` (M1-05); `mulberry32` (M1-06); `TASK_KINDS` (M1-01).
- Produces: `TERMINATIONS`, `VERDICTS`, `RUN_KINDS`; `TelemetrySchema`/`Telemetry`; `ValiditySchema`; `ExecutionRecordSchema`/`ExecutionRecord`; `ArtifactRecordSchema`/`ArtifactRecord`; `TestResultSchema`; `JudgmentRecordSchema`/`JudgmentRecord`; `BlockSchema`/`Block`; `CampaignRecordSchema`/`CampaignRecord`; `experimentHash(e)`; `planBlocks(taskIds, repeats, arms, seed)`; `class RecordStore { writeCampaign; writeExecution; writeArtifact; writeJudgment; campaigns(experimentId) (newest first); executions(campaignId); artifact(executionId); judgments(executionId); sweepTemp() }`. Fixtures: `H`, `CAMPAIGN_ID`, `manifest`, `telemetry`, `campaign(opts)` (async), `execution(c, sel, over)`, `judgment(c, e, passed, over)`.

- [ ] **Step 1: Write the fixtures and the failing test**

`tests/unit/harness/fixtures.ts`:

```typescript
/**
 * Consistent record builders for harness unit tests. Every stored hash is
 * computed with the real functions, so a fixture passes
 * validateCampaignRecords unless a test deliberately breaks it.
 */

import { ExperimentSchema } from "../../../src/harness/config.ts";
import { taskSetHash } from "../../../src/harness/identity.ts";
import {
  manifestHash,
  type ResolvedManifest,
  ResolvedManifestSchema,
} from "../../../src/harness/manifest.ts";
import {
  type CampaignRecord,
  type ExecutionRecord,
  experimentHash,
  type JudgmentRecord,
  planBlocks,
  type Telemetry,
} from "../../../src/harness/records.ts";

export const H = (c: string) => c.repeat(64);
export const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000001";
const TASK_HASHES: Record<string, [string, string]> = {
  "HX-001": [H("1"), H("2")],
  "HX-002": [H("3"), H("4")],
};

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
    settings: { requested: {}, native: {} },
    limits: { timeout_min: 30, max_budget_usd: 5 },
    instructions: null,
    skills: null,
    agents: null,
    hooks: null,
    plugins: [],
    mcp: [],
    lsp: [],
    toolchain: [],
    image: { digest: "sha256:img", base_digest: "sha256:base" },
    backend_version: "b1",
    provider_routes: { main: "anthropic" },
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

/** plain vs skills over HX-001 and HX-002. */
export async function campaign(
  opts: { repeats?: number; id?: string; created_at?: string } = {},
): Promise<CampaignRecord> {
  const repeats = opts.repeats ?? 1;
  const experiment = ExperimentSchema.parse({
    id: "skills-vs-plain",
    hypothesis: "Skills cut cost per solved task.",
    primary_metric: "cost_per_solved_task",
    baseline: "plain",
    variants: ["skills"],
    vary: ["skills"],
    tasks: "harness-tasks/tasks/*",
    repeats,
  });
  const tasks = Object.entries(TASK_HASHES).map(([id, [visible, oracle]]) => ({
    id,
    refapp_commit: "c".repeat(40),
    visible,
    oracle,
  }));
  const plain = manifest("plain");
  const skills = manifest("skills", {
    skills: { path: "bundles/s", hash: H("5"), files: [] },
  });
  return {
    v: 1,
    id: opts.id ?? CAMPAIGN_ID,
    experiment,
    experiment_hash: await experimentHash(experiment),
    created_at: opts.created_at ?? "2026-10-01T10:00:00.000Z",
    seed: 1,
    reuse: [],
    task_set: {
      identity: await taskSetHash(tasks),
      provisional: false,
      tasks,
    },
    tasks_meta: tasks.map((t) => ({
      id: t.id,
      kind: "bugfix" as const,
      coupling: ["events"],
    })),
    arms: [
      {
        config_id: "plain",
        manifest_hash: await manifestHash(plain),
        manifest: plain,
      },
      {
        config_id: "skills",
        manifest_hash: await manifestHash(skills),
        manifest: skills,
      },
    ],
    blocks: planBlocks(
      Object.keys(TASK_HASHES),
      repeats,
      ["plain", "skills"],
      1,
    ),
  };
}

let seq = 0;
const next = () => (++seq).toString(16).padStart(12, "0");

export interface CellSel {
  task?: string;
  repeat?: number;
  arm?: string;
  attempt?: number;
  run_kind?: ExecutionRecord["run_kind"];
  retry_of?: string | null;
}

/** An execution placed consistently in campaign `c`. */
export function execution(
  c: CampaignRecord,
  sel: CellSel = {},
  over: Partial<ExecutionRecord> = {},
): ExecutionRecord {
  const task = sel.task ?? "HX-001";
  const repeat = sel.repeat ?? 1;
  const armId = sel.arm ?? "plain";
  const block = c.blocks.find((b) =>
    b.task_id === task && b.repeat === repeat
  )!;
  const arm = c.arms.find((a) => a.config_id === armId)!;
  const n = next();
  return {
    v: 1,
    id: `00000000-0000-4000-9000-${n}`,
    campaign_id: c.id,
    block: block.index,
    order_in_block: block.order.indexOf(armId),
    arm: armId,
    task_id: task,
    task_visible_hash: c.task_set.tasks.find((t) => t.id === task)!.visible,
    repeat,
    attempt: sel.attempt ?? 1,
    run_kind: sel.run_kind ?? "planned",
    retry_of: sel.retry_of ?? null,
    started_at: "2026-10-01T10:01:00.000Z",
    ended_at: "2026-10-01T10:11:00.000Z",
    arm_manifest_hash: arm.manifest_hash,
    manifest: arm.manifest,
    observed: { harness_version: null, models: null, loaded_components: null },
    termination: "completed",
    did_work: true,
    validity: { incomplete_telemetry: [], infra_exposed: false },
    image_attachments: "none",
    telemetry: telemetry(1),
    trace_path: null,
    host_log_path: null,
    raw_log_path: null,
    container_assignments: ["Cronus281"],
    workspace_hash: n.padStart(64, "0"),
    ...over,
  };
}

/** A judgment of execution `e` against the campaign's oracle for its task. */
export function judgment(
  c: CampaignRecord,
  e: ExecutionRecord,
  passed: boolean | null,
  over: Partial<JudgmentRecord> = {},
): JudgmentRecord {
  return {
    v: 1,
    id: `00000000-0000-4000-a000-${next()}`,
    execution_id: e.id,
    workspace_hash: e.workspace_hash!,
    task_id: e.task_id,
    task_oracle_hash: c.task_set.tasks.find((t) => t.id === e.task_id)!.oracle,
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
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import {
  CampaignRecordSchema,
  ExecutionRecordSchema,
  JudgmentRecordSchema,
  planBlocks,
  RecordStore,
} from "../../../src/harness/records.ts";
import {
  campaign,
  CAMPAIGN_ID,
  execution,
  judgment,
  telemetry,
} from "./fixtures.ts";

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

Deno.test("schemas: fixtures are valid", async () => {
  const c = await campaign({ repeats: 2 });
  CampaignRecordSchema.parse(c);
  const e = execution(c);
  ExecutionRecordSchema.parse(e);
  JudgmentRecordSchema.parse(judgment(c, e, true));
});

Deno.test("execution schema: loud on bad records", async () => {
  const c = await campaign();
  const e = execution(c);
  const bad: Array<[string, unknown]> = [
    ["unknown key", { ...e, extra: 1 }],
    ["unknown termination", { ...e, termination: "crashed" }],
    ["reported cost as primary", {
      ...e,
      telemetry: { ...telemetry(1), cost_source: "reported" },
    }],
    ["cost without pricing snapshot", {
      ...e,
      telemetry: { ...telemetry(1), pricing_snapshot: null },
    }],
    ["duplicate validity field", {
      ...e,
      validity: {
        incomplete_telemetry: ["turns", "turns"],
        infra_exposed: false,
      },
    }],
    ["planned attempt 2", { ...e, attempt: 2 }],
    ["auto_retry without parent", { ...e, attempt: 2, run_kind: "auto_retry" }],
  ];
  for (const [name, value] of bad) {
    assertThrows(
      () => ExecutionRecordSchema.parse(value),
      Error,
      undefined,
      name,
    );
  }
});

Deno.test("judgment schema: verdict must agree, failures must be classified", async () => {
  const c = await campaign();
  const j = judgment(c, execution(c), false);
  assertThrows(() => JudgmentRecordSchema.parse({ ...j, verdict: "pass" }));
  const test = (t: Record<string, unknown>) =>
    JudgmentRecordSchema.parse({
      ...j,
      scorers: [{ name: "mutant_kill", passed: false, tests: [t] }],
    });
  test({
    codeunit: 80001,
    procedure: "P",
    target: "mutant:0",
    outcome: "fail",
    failure: "assertion",
  });
  assertThrows(() =>
    test({
      codeunit: 80001,
      procedure: "P",
      target: "mutant:0",
      outcome: "fail",
      failure: null,
    })
  );
  assertThrows(() =>
    test({
      codeunit: 80001,
      procedure: "P",
      target: "other",
      outcome: "pass",
      failure: null,
    })
  );
});

Deno.test("campaign schema: coverage, uniqueness and arm set are enforced", async () => {
  const c = await campaign({ repeats: 2 });
  const cases: Array<[string, unknown, string]> = [
    [
      "provisional",
      { ...c, task_set: { ...c.task_set, provisional: true } },
      "provisional",
    ],
    ["duplicate block", {
      ...c,
      blocks: [...c.blocks.slice(0, -1), {
        ...c.blocks[0]!,
        index: c.blocks.length - 1,
      }],
    }, "duplicate block"],
    ["missing block", { ...c, blocks: c.blocks.slice(0, -1) }, "exactly once"],
    ["arm not in experiment", {
      ...c,
      arms: [c.arms[0]!, { ...c.arms[1]!, config_id: "other" }],
    }, "baseline and variants"],
    ["repeated arm in order", {
      ...c,
      blocks: c.blocks.map((b) => ({ ...b, order: ["plain", "plain"] })),
    }, "permutation"],
  ];
  for (const [name, value, needle] of cases) {
    const r = CampaignRecordSchema.safeParse(value);
    assert(!r.success, name);
    assert(r.error.issues.some((i) => i.message.includes(needle)), name);
  }
});

Deno.test("RecordStore: round trip, write-once, newest campaign first", async () => {
  const store = new RecordStore(await Deno.makeTempDir());
  const c = await campaign();
  await store.writeCampaign(c);
  await store.writeCampaign(
    await campaign({
      id: "00000000-0000-4000-8000-000000000002",
      created_at: "2026-10-02T00:00:00.000Z",
    }),
  );
  assertEquals(
    (await store.campaigns("skills-vs-plain")).map((x) => x.id),
    ["00000000-0000-4000-8000-000000000002", CAMPAIGN_ID],
  );
  const e = execution(c);
  await store.writeExecution(e);
  assertEquals(await store.executions(CAMPAIGN_ID), [e]);
  await assertRejects(
    () => store.writeExecution(e),
    ValidationError,
    "immutable",
  );
  assertEquals(
    await store.executions("00000000-0000-4000-8000-00000000dead"),
    [],
  );
});

Deno.test("RecordStore: two executions with identical workspaces keep separate artifacts and judgments", async () => {
  const store = new RecordStore(await Deno.makeTempDir());
  const c = await campaign();
  const same = "f".repeat(64);
  const e1 = execution(c, { arm: "plain" }, { workspace_hash: same });
  const e2 = execution(c, { arm: "skills" }, { workspace_hash: same });
  for (const e of [e1, e2]) {
    await store.writeArtifact({
      v: 1,
      execution_id: e.id,
      workspace_hash: same,
      stored_path: `workspaces/${same}`,
      created_at: "2026-10-01T10:12:00.000Z",
    });
  }
  await store.writeJudgment(judgment(c, e1, true));
  await store.writeJudgment(judgment(c, e2, false));
  assertEquals((await store.artifact(e2.id))!.execution_id, e2.id);
  assertEquals((await store.judgments(e1.id)).map((j) => j.verdict), ["pass"]);
  assertEquals((await store.judgments(e2.id)).map((j) => j.verdict), ["fail"]);
  assertEquals(
    await store.artifact("00000000-0000-4000-9000-00000000dead"),
    null,
  );
});

Deno.test("RecordStore: hand-edited or truncated records fail with the file name", async () => {
  const root = await Deno.makeTempDir();
  const store = new RecordStore(root);
  const c = await campaign();
  const e = execution(c);
  await store.writeExecution(e);
  const path = join(root, "executions", CAMPAIGN_ID, `${e.id}.json`);
  const text = await Deno.readTextFile(path);
  await Deno.writeTextFile(path, text.replace('"completed"', '"done"'));
  await assertRejects(
    () => store.executions(CAMPAIGN_ID),
    ValidationError,
    "termination",
  );
  await Deno.writeTextFile(path, text.slice(0, 40));
  await assertRejects(
    () => store.executions(CAMPAIGN_ID),
    ValidationError,
    `${e.id}.json`,
  );
});

Deno.test("RecordStore: an interrupted publish leaves only a temp file, which reads ignore and sweep removes", async () => {
  const root = await Deno.makeTempDir();
  const store = new RecordStore(root);
  const c = await campaign();
  const e = execution(c);
  const dir = join(root, "executions", CAMPAIGN_ID);
  await Deno.mkdir(dir, { recursive: true });
  // What a crash between the temp write and the link leaves behind.
  await Deno.writeTextFile(join(dir, `${e.id}.json.tmp-crash`), '{"v":1,');
  assertEquals(await store.executions(CAMPAIGN_ID), []);
  await store.writeExecution(e);
  assertEquals(await store.executions(CAMPAIGN_ID), [e]);
  assertEquals(await store.sweepTemp(), 1);
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
 *   artifacts/<execution-id>.json          association: execution -> workspace
 *   workspaces/<workspace-hash>/           content-addressed copy (Part 2)
 *   judgments/<execution-id>/<judgment-id>.json
 *
 * Identical workspace bytes from two executions share one workspace copy but
 * have two artifact associations and separate judgments, so a rejudge of one
 * execution never changes another's result.
 *
 * Publication is crash-safe: write `<name>.tmp-<uuid>`, hard-link it to the
 * final name (fails if it exists: no replace), remove the temp file. A crash
 * leaves at most a temp file, which readers ignore and `sweepTemp` removes.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { type Experiment, ExperimentSchema } from "./config.ts";
import { hashJson } from "./hash.ts";
import { TaskSetIdentitySchema } from "./identity.ts";
import { ResolvedManifestSchema } from "./manifest.ts";
import { mulberry32 } from "./stats.ts";
import { TASK_KINDS } from "./task.ts";

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
export const RUN_KINDS = ["planned", "auto_retry", "manual_rerun"] as const;

/**
 * Run totals from the harness (spec 1a section 5). Every field nullable.
 * `cost_usd` is the primary-metric input and must be the list-price estimate
 * from reported tokens (decided 2026-09-24): a non-null value needs
 * cost_source "estimated" and a pricing snapshot. A harness's own figure goes
 * in `reported_cost_usd` only.
 */
export const TelemetrySchema = z.strictObject({
  harness_version: z.string().nullable(),
  cost_usd: n,
  cost_source: z.literal("estimated").nullable(),
  pricing_snapshot: z.string().min(1).nullable(),
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
}).refine(
  (t) =>
    t.cost_usd === null ||
    (t.cost_source === "estimated" && t.pricing_snapshot !== null),
  {
    message: "cost_usd needs cost_source estimated and a pricing_snapshot",
    path: ["cost_usd"],
  },
);
export type Telemetry = z.output<typeof TelemetrySchema>;

/**
 * Independent validity flags; both empty/false means complete. The field
 * list names which declared metrics are missing (metrics contract, spec 1a
 * section 5), so a missing `turns` never looks like a missing primary cost.
 */
export const ValiditySchema = z.strictObject({
  incomplete_telemetry: z.array(z.string().min(1)),
  infra_exposed: z.boolean(),
}).refine((v) =>
  new Set(v.incomplete_telemetry).size ===
    v.incomplete_telemetry.length, {
  message: "duplicate field",
  path: ["incomplete_telemetry"],
});

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
  /** Unique per cell: planned = 1, auto retry = parent + 1, manual = next. */
  attempt: z.number().int().positive(),
  run_kind: z.enum(RUN_KINDS),
  /** The execution an automatic retry retries; null otherwise. */
  retry_of: z.uuid().nullable(),
  started_at: Iso,
  ended_at: Iso,
  /** Hash of the campaign arm template this execution belongs to. */
  arm_manifest_hash: Sha,
  /** The execution manifest: arm template with task-effective limits. */
  manifest: ResolvedManifestSchema,
  /** What actually ran; filled by the adapter (Part 2). */
  observed: z.strictObject({
    harness_version: z.string().nullable(),
    models: z.array(z.string()).nullable(),
    loaded_components: z.array(z.string()).nullable(),
  }),
  termination: z.enum(TERMINATIONS),
  /**
   * The agent acted before stopping: any model request, tool call, file
   * read or edit, or build attempt. Not "changed the workspace".
   */
  did_work: z.boolean(),
  validity: ValiditySchema,
  /** Spec 1b section 6: whether image attachments reached the model. */
  image_attachments: z.enum(["none", "delivered", "unsupported", "unknown"]),
  telemetry: TelemetrySchema,
  trace_path: z.string().nullable(),
  host_log_path: z.string().nullable(),
  raw_log_path: z.string().nullable(),
  container_assignments: z.array(z.string()),
  /** Hash of the frozen workspace; null when nothing was frozen. */
  workspace_hash: Sha.nullable(),
}).superRefine((e, ctx) => {
  const bad = (message: string) =>
    ctx.addIssue({ code: "custom", message, path: ["run_kind"] });
  if (e.run_kind === "planned" && (e.attempt !== 1 || e.retry_of !== null)) {
    bad("planned execution is attempt 1 with no retry_of");
  }
  if (e.run_kind === "auto_retry" && (e.attempt < 2 || e.retry_of === null)) {
    bad("auto_retry needs retry_of and attempt >= 2");
  }
  if (e.run_kind === "manual_rerun" && (e.attempt < 2 || e.retry_of !== null)) {
    bad("manual_rerun has attempt >= 2 and no retry_of");
  }
});
export type ExecutionRecord = z.output<typeof ExecutionRecordSchema>;

export const ArtifactRecordSchema = z.strictObject({
  v: z.literal(1),
  execution_id: z.uuid(),
  workspace_hash: Sha,
  /** Content-addressed copy, e.g. workspaces/<workspace_hash>. */
  stored_path: z.string().min(1),
  created_at: Iso,
});
export type ArtifactRecord = z.output<typeof ArtifactRecordSchema>;

export const TestResultSchema = z.strictObject({
  codeunit: z.number().int(),
  procedure: z.string(),
  /** What the procedure ran against (spec 1a section 7, test-authoring). */
  target: z.string().regex(/^(candidate|reference|mutant:[A-Za-z0-9_-]+)$/),
  outcome: z.enum(["pass", "fail", "error", "not_run"]),
  /** Why it did not pass; a compile error or infra fault is not a kill. */
  failure: z.enum(["assertion", "compile", "runtime_error", "infra"])
    .nullable(),
}).refine((t) => (t.outcome === "pass") === (t.failure === null), {
  message: "failure is set exactly when the outcome is not pass",
  path: ["failure"],
});

export const JudgmentRecordSchema = z.strictObject({
  v: z.literal(1),
  id: z.uuid(),
  execution_id: z.uuid(),
  workspace_hash: Sha,
  task_id: z.string(),
  task_oracle_hash: Sha,
  scorer_versions: z.record(z.string(), z.string()),
  scorers: z.array(z.strictObject({
    name: z.string(),
    /** null = infra fault, not a fail (GH #13 rule). */
    passed: z.boolean().nullable(),
    tests: z.array(TestResultSchema),
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
  /** Historical executions reused on explicit request (--reuse-history). */
  reuse: z.array(z.strictObject({
    campaign_id: z.uuid(),
    execution_id: z.uuid(),
  })),
  task_set: TaskSetIdentitySchema,
  /** Analysis metadata for report slices; not part of any hash. */
  tasks_meta: z.array(z.strictObject({
    id: z.string(),
    kind: z.enum(TASK_KINDS),
    coupling: z.array(z.string()),
  })),
  arms: z.array(z.strictObject({
    config_id: z.string(),
    manifest_hash: Sha,
    manifest: ResolvedManifestSchema,
  })).min(2),
  /** The full plan (every task x repeat). Staged runs execute subsets of it. */
  blocks: z.array(BlockSchema).min(1),
}).superRefine((c, ctx) => {
  const issue = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: "custom", message, path });
  if (c.task_set.provisional) {
    issue("campaign needs a non-provisional task set (symbols lock)", [
      "task_set",
    ]);
  }
  const armIds = c.arms.map((a) => a.config_id);
  const declared = [c.experiment.baseline, ...c.experiment.variants];
  if ([...armIds].sort().join() !== [...declared].sort().join()) {
    issue("arms must be exactly the experiment's baseline and variants", [
      "arms",
    ]);
  }
  c.arms.forEach((a, i) => {
    if (a.manifest.config_id !== a.config_id) {
      issue("arm manifest belongs to another config", ["arms", i]);
    }
  });
  const taskIds = c.task_set.tasks.map((t) => t.id).sort();
  if (c.tasks_meta.map((t) => t.id).sort().join() !== taskIds.join()) {
    issue("tasks_meta must list exactly the task-set tasks", ["tasks_meta"]);
  }
  const want = new Set(
    taskIds.flatMap((t) =>
      Array.from({ length: c.experiment.repeats }, (_, r) => `${t}#${r + 1}`)
    ),
  );
  const seen = new Set<string>();
  const arms = [...armIds].sort().join();
  c.blocks.forEach((b, i) => {
    const k = `${b.task_id}#${b.repeat}`;
    if (b.index !== i) {
      issue("block index must equal its position", ["blocks", i]);
    }
    if (seen.has(k)) issue(`duplicate block ${k}`, ["blocks", i]);
    if (!want.has(k)) {
      issue(`block ${k} is not in task set x repeats`, ["blocks", i]);
    }
    seen.add(k);
    if ([...b.order].sort().join() !== arms) {
      issue("block order must be a permutation of the arms", [
        "blocks",
        i,
        "order",
      ]);
    }
  });
  if (seen.size !== want.size) {
    issue("blocks must cover every task x repeat exactly once", ["blocks"]);
  }
});
export type CampaignRecord = z.output<typeof CampaignRecordSchema>;

/** The stored experiment_hash of a campaign. */
export function experimentHash(e: Experiment): Promise<string> {
  return hashJson({ experiment: e });
}

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

const TMP = ".tmp-";

async function publishOnce(path: string, value: unknown): Promise<void> {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}${TMP}${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmp, JSON.stringify(value, null, 2) + "\n", {
    createNew: true,
  });
  try {
    await Deno.link(tmp, path);
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
  } finally {
    await Deno.remove(tmp);
  }
}

async function readRecord<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await Deno.readTextFile(path));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Invalid record ${path}: ${msg}`, [msg]);
  }
  const result = schema.safeParse(raw);
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
    return publishOnce(
      join(this.root, "campaigns", `${c.id}.json`),
      CampaignRecordSchema.parse(c),
    );
  }

  writeExecution(e: ExecutionRecord): Promise<void> {
    return publishOnce(
      join(this.root, "executions", e.campaign_id, `${e.id}.json`),
      ExecutionRecordSchema.parse(e),
    );
  }

  writeArtifact(a: ArtifactRecord): Promise<void> {
    return publishOnce(
      join(this.root, "artifacts", `${a.execution_id}.json`),
      ArtifactRecordSchema.parse(a),
    );
  }

  writeJudgment(j: JudgmentRecord): Promise<void> {
    return publishOnce(
      join(this.root, "judgments", j.execution_id, `${j.id}.json`),
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

  /** The artifact association of one execution, or null. */
  async artifact(executionId: string): Promise<ArtifactRecord | null> {
    try {
      return await readRecord(
        join(this.root, "artifacts", `${executionId}.json`),
        ArtifactRecordSchema,
      );
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  }

  judgments(executionId: string): Promise<JudgmentRecord[]> {
    return readAll(
      join(this.root, "judgments", executionId),
      JudgmentRecordSchema,
    );
  }

  /** Remove temp files left by an interrupted publish. Returns the count. */
  async sweepTemp(): Promise<number> {
    let removed = 0;
    const walkDir = async (dir: string): Promise<void> => {
      try {
        for await (const e of Deno.readDir(dir)) {
          const p = join(dir, e.name);
          if (e.isDirectory) await walkDir(p);
          else if (e.name.includes(TMP)) {
            await Deno.remove(p);
            removed++;
          }
        }
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      }
    };
    await walkDir(this.root);
    return removed;
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/records.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/records.ts tests/unit/harness/records.test.ts tests/unit/harness/fixtures.ts
deno lint src/harness/records.ts tests/unit/harness/records.test.ts tests/unit/harness/fixtures.ts
deno fmt src/harness/records.ts tests/unit/harness/records.test.ts tests/unit/harness/fixtures.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/records.ts tests/unit/harness/records.test.ts tests/unit/harness/fixtures.ts
git commit -m "feat(harness): immutable records, per-execution artifacts, crash-safe store"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/records.test.ts` exits 0, and check / lint / fmt --check are clean on the three files.

---

### Task M1-07b: cross-record validation

Review must-change 4: shapes are validated in M1-07, relationships here. `validateCampaignRecords` recomputes the campaign's stored hashes (experiment, task set projection, each arm manifest), re-checks `vary` between the stored arms, and checks every execution against the campaign (block, position in the block order, visible-input hash, arm template hash, arm membership of the task-effective manifest, unique attempts, `retry_of` chain, foreign campaign only when listed in `reuse`), every artifact association and every judgment against its execution (task, workspace). It collects every problem into one `ValidationError`. M1-09 calls it before computing any number; Part 2's runner calls it before resuming a campaign.

**Deps:** M1-04, M1-05, M1-07.

**Files:**
- Create: `src/harness/integrity.ts`
- Test: `tests/unit/harness/integrity.test.ts`

**Interfaces:**
- Consumes: `taskSetHash` (M1-04); `armMismatch`, `assertVaryHolds`, `manifestHash` (M1-05); record types and `experimentHash` (M1-07).
- Produces: `interface CampaignRecords { campaign; executions; artifacts; judgments }`; `validateCampaignRecords(r: CampaignRecords): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/integrity.test.ts`:

```typescript
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ValidationError } from "../../../src/errors.ts";
import {
  type CampaignRecords,
  validateCampaignRecords,
} from "../../../src/harness/integrity.ts";
import { manifestHash } from "../../../src/harness/manifest.ts";
import { campaign, execution, H, judgment, manifest } from "./fixtures.ts";

async function scenario(): Promise<CampaignRecords> {
  const c = await campaign();
  const first = execution(c, { arm: "plain" }, {
    termination: "setup_failed",
    did_work: false,
    workspace_hash: null,
  });
  const retry = execution(c, {
    arm: "plain",
    attempt: 2,
    run_kind: "auto_retry",
    retry_of: first.id,
  });
  const other = execution(c, { task: "HX-002", arm: "skills" });
  return {
    campaign: c,
    executions: [first, retry, other],
    artifacts: [{
      v: 1,
      execution_id: retry.id,
      workspace_hash: retry.workspace_hash!,
      stored_path: `workspaces/${retry.workspace_hash}`,
      created_at: "2026-10-01T10:12:00.000Z",
    }],
    judgments: [judgment(c, retry, true), judgment(c, other, false)],
  };
}

async function problems(r: CampaignRecords): Promise<string[]> {
  try {
    await validateCampaignRecords(r);
    return [];
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    return err.errors;
  }
}

Deno.test("validateCampaignRecords: a consistent campaign passes", async () => {
  assertEquals(await problems(await scenario()), []);
});

Deno.test("validateCampaignRecords: tampered stored hashes are caught", async () => {
  const r = await scenario();
  const c = r.campaign;
  const broken = {
    ...c,
    experiment_hash: H("0"),
    task_set: { ...c.task_set, identity: H("0") },
    arms: [{ ...c.arms[0]!, manifest_hash: H("0") }, c.arms[1]!],
  };
  const p = await problems({ ...r, campaign: broken });
  assertEquals(p.length >= 3, true);
  assertStringIncludes(p.join("\n"), "experiment_hash");
  assertStringIncludes(p.join("\n"), "task_set.identity");
  assertStringIncludes(p.join("\n"), "arm plain: manifest_hash");
});

Deno.test("validateCampaignRecords: a variant outside vary is caught", async () => {
  const r = await scenario();
  const m = manifest("skills", {
    skills: { path: "bundles/s", hash: H("5"), files: [] },
    mcp: [{ name: "al-tools", version: "1", tool_schema_hash: "s" }],
  });
  const arms = [r.campaign.arms[0]!, {
    config_id: "skills",
    manifest: m,
    manifest_hash: await manifestHash(m),
  }];
  const p = await problems({ ...r, campaign: { ...r.campaign, arms } });
  assertStringIncludes(p.join("\n"), "outside vary [skills]: mcp");
});

Deno.test("validateCampaignRecords: executions that do not belong are caught", async () => {
  const r = await scenario();
  const [first, retry, other] = r.executions as [
    typeof r.executions[0],
    typeof r.executions[0],
    typeof r.executions[0],
  ];
  const cases: Array<[string, typeof first]> = [
    ["visible-input hash", { ...other, task_visible_hash: H("9") }],
    ["is not at position", {
      ...other,
      order_in_block: 1 - other.order_in_block,
    }],
    ["is not (HX-002, 1)", { ...other, block: first.block }],
    ["not in reuse", {
      ...other,
      campaign_id: "00000000-0000-4000-8000-0000000000ff",
    }],
    ["arm_manifest_hash", { ...other, arm_manifest_hash: H("0") }],
    ["looser than the arm", {
      ...other,
      manifest: {
        ...other.manifest,
        limits: { timeout_min: 99, max_budget_usd: 5 },
      },
    }],
  ];
  for (const [needle, bad] of cases) {
    const p = await problems({
      ...r,
      executions: [first, retry, bad],
      judgments: r.judgments.filter((j) => j.execution_id !== other.id),
    });
    assertStringIncludes(p.join("\n"), needle);
  }
  const dup = { ...retry, id: "00000000-0000-4000-9000-0000000000ff" };
  assertStringIncludes(
    (await problems({ ...r, executions: [...r.executions, dup] })).join("\n"),
    "duplicate attempt 2",
  );
  const orphan = { ...retry, retry_of: other.id };
  assertStringIncludes(
    (await problems({
      ...r,
      executions: [first, orphan, other],
      judgments: [],
    }))
      .join("\n"),
    "retry_of is not the previous attempt",
  );
});

Deno.test("validateCampaignRecords: judgments and artifacts must match their execution", async () => {
  const r = await scenario();
  const [j1, j2] = r.judgments as [
    typeof r.judgments[0],
    typeof r.judgments[0],
  ];
  const p = await problems({
    ...r,
    judgments: [{ ...j1, task_id: "HX-002" }, {
      ...j2,
      workspace_hash: H("7"),
    }],
    artifacts: [{ ...r.artifacts[0]!, workspace_hash: H("8") }],
  });
  const text = p.join("\n");
  assertStringIncludes(text, "task HX-002 != HX-001");
  assertStringIncludes(text, "judged a different workspace");
  assertStringIncludes(text, "workspace hash differs");
});

Deno.test("validateCampaignRecords: throws one ValidationError", async () => {
  const r = await scenario();
  await assertRejects(
    () =>
      validateCampaignRecords({
        ...r,
        campaign: { ...r.campaign, experiment_hash: H("0") },
      }),
    ValidationError,
    "Inconsistent records",
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/integrity.test.ts`
Expected: FAIL, `Module not found ".../src/harness/integrity.ts"`.

- [ ] **Step 3: Implement**

`src/harness/integrity.ts`:

```typescript
/**
 * Cross-record validation (spec 1a sections 4 and 6). Zod checks each
 * record's shape; this checks that records agree with each other and with
 * their stored hashes before anything is reported or executed. Every problem
 * is collected; one ValidationError lists them all.
 */

import { ConfigurationError, ValidationError } from "../errors.ts";
import { taskSetHash } from "./identity.ts";
import { armMismatch, assertVaryHolds, manifestHash } from "./manifest.ts";
import {
  type ArtifactRecord,
  type CampaignRecord,
  type ExecutionRecord,
  experimentHash,
  type JudgmentRecord,
} from "./records.ts";

export interface CampaignRecords {
  campaign: CampaignRecord;
  executions: ExecutionRecord[];
  artifacts: ArtifactRecord[];
  judgments: JudgmentRecord[];
}

async function campaignProblems(c: CampaignRecord): Promise<string[]> {
  const out: string[] = [];
  if (c.experiment_hash !== await experimentHash(c.experiment)) {
    out.push("campaign experiment_hash does not match its experiment");
  }
  if (c.task_set.identity !== await taskSetHash(c.task_set.tasks)) {
    out.push("campaign task_set.identity does not match its tasks");
  }
  for (const a of c.arms) {
    if (a.manifest_hash !== await manifestHash(a.manifest)) {
      out.push(`arm ${a.config_id}: manifest_hash does not match its manifest`);
    }
  }
  const base = c.arms.find((a) => a.config_id === c.experiment.baseline);
  for (const a of c.arms) {
    if (!base || a === base) continue;
    try {
      await assertVaryHolds(base.manifest, a.manifest, c.experiment.vary);
    } catch (err) {
      if (!(err instanceof ConfigurationError)) throw err;
      out.push(`arm ${a.config_id}: ${err.message}`);
    }
  }
  return out;
}

async function executionProblems(
  c: CampaignRecord,
  executions: ExecutionRecord[],
): Promise<string[]> {
  const out: string[] = [];
  const reused = new Set(c.reuse.map((r) => r.execution_id));
  const visible = new Map(c.task_set.tasks.map((t) => [t.id, t.visible]));
  const arms = new Map(c.arms.map((a) => [a.config_id, a]));
  const byId = new Map(executions.map((e) => [e.id, e]));
  const attempts = new Set<string>();
  for (const e of executions) {
    const at = `execution ${e.id}`;
    if (e.campaign_id !== c.id && !reused.has(e.id)) {
      out.push(
        `${at}: belongs to campaign ${e.campaign_id} and is not in reuse`,
      );
    }
    const block = c.blocks[e.block];
    if (!block || block.task_id !== e.task_id || block.repeat !== e.repeat) {
      out.push(`${at}: block ${e.block} is not (${e.task_id}, ${e.repeat})`);
    } else if (block.order[e.order_in_block] !== e.arm) {
      out.push(`${at}: arm ${e.arm} is not at position ${e.order_in_block}`);
    }
    if (visible.get(e.task_id) !== e.task_visible_hash) {
      out.push(`${at}: visible-input hash differs from the task set`);
    }
    const arm = arms.get(e.arm);
    if (!arm) {
      out.push(`${at}: unknown arm ${e.arm}`);
    } else {
      if (arm.manifest_hash !== e.arm_manifest_hash) {
        out.push(`${at}: arm_manifest_hash differs from the campaign arm`);
      }
      for (const p of await armMismatch(arm.manifest, e.manifest)) {
        out.push(`${at}: ${p}`);
      }
    }
    const cell = `${e.task_id}/${e.repeat}/${e.arm}`;
    if (attempts.has(`${cell}#${e.attempt}`)) {
      out.push(`${at}: duplicate attempt ${e.attempt} for ${cell}`);
    }
    attempts.add(`${cell}#${e.attempt}`);
    if (e.retry_of !== null) {
      const parent = byId.get(e.retry_of);
      if (
        !parent ||
        `${parent.task_id}/${parent.repeat}/${parent.arm}` !== cell ||
        parent.attempt + 1 !== e.attempt
      ) {
        out.push(`${at}: retry_of is not the previous attempt of ${cell}`);
      }
    }
  }
  return out;
}

/** Throws one ValidationError listing every inconsistency. */
export async function validateCampaignRecords(
  r: CampaignRecords,
): Promise<void> {
  const problems = [
    ...await campaignProblems(r.campaign),
    ...await executionProblems(r.campaign, r.executions),
  ];
  const byId = new Map(r.executions.map((e) => [e.id, e]));
  for (const a of r.artifacts) {
    const e = byId.get(a.execution_id);
    if (!e) problems.push(`artifact for unknown execution ${a.execution_id}`);
    else if (e.workspace_hash !== a.workspace_hash) {
      problems.push(`artifact ${a.execution_id}: workspace hash differs`);
    }
  }
  for (const j of r.judgments) {
    const e = byId.get(j.execution_id);
    if (!e) {
      problems.push(`judgment ${j.id}: unknown execution ${j.execution_id}`);
      continue;
    }
    if (j.task_id !== e.task_id) {
      problems.push(`judgment ${j.id}: task ${j.task_id} != ${e.task_id}`);
    }
    if (j.workspace_hash !== e.workspace_hash) {
      problems.push(`judgment ${j.id}: judged a different workspace`);
    }
  }
  if (problems.length > 0) {
    throw new ValidationError(
      `Inconsistent records for campaign ${r.campaign.id}:\n  ${
        problems.join("\n  ")
      }`,
      problems,
    );
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/integrity.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/integrity.ts tests/unit/harness/integrity.test.ts
deno lint src/harness/integrity.ts tests/unit/harness/integrity.test.ts
deno fmt src/harness/integrity.ts tests/unit/harness/integrity.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/integrity.ts tests/unit/harness/integrity.test.ts
git commit -m "feat(harness): cross-record validation of campaigns"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/integrity.test.ts` exits 0, `deno test --allow-all tests/unit/harness/records.test.ts` still exits 0, and check / lint / fmt --check are clean on the two files.

---

### Task M1-08: termination rules, judgment selection and records-to-cells

Spec 1a section 8: `timeout`, `budget_exhausted` and `refusal` are judged; `harness_crash` is judged when the agent took any action (`did_work`, including read-only work); `harness_crash` before any action and `setup_failed` get one automatic retry; `usage_limited` is unscored, pauses and retries; a verdict-side infra fault is rejudged, never re-run. Review must-change 3 and owner rule 3:

- Judgments are selected in an explicit judging context: same execution, task and workspace, and the context's oracle for the task; newest `ended_at` wins, ties by the larger judgment id.
- The automatic chain (planned + auto_retry) resolves by its final attempt; an exhausted automatic retry is terminally `unscored`.
- A manual rerun never replaces a scored chain result; it is used only when the chain has none, and the cell records `used_execution` and `used_kind`.
- Every attempt's spend, chain and manual, stays in the cell.

**Deps:** M1-06, M1-07.

**Files:**
- Create: `src/harness/outcome.ts`
- Test: `tests/unit/harness/outcome.test.ts`

**Interfaces:**
- Consumes: record types, `TERMINATIONS`, `RUN_KINDS` (M1-07); `Cell`, `CellStatus` (M1-06).
- Produces: `type Termination`, `type RunKind`; `interface OutcomePolicy`; `outcomePolicy(termination, didWork)`; `interface JudgingContext { source: "campaign" | "current"; oracle: Map<string, string> }`; `campaignJudging(c)`; `selectJudgment(e, judgments, oracle)`; `interface CellRecord extends Cell { used_execution; used_kind; judgment_id; oracle_hash; manual_reruns }`; `cellsFromRecords(campaign, executions, judgmentsByExecution: Map<string, JudgmentRecord[]>, judging?)`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/outcome.test.ts`:

```typescript
import { assertEquals, assertThrows } from "@std/assert";
import { ValidationError } from "../../../src/errors.ts";
import {
  type CellRecord,
  cellsFromRecords,
  outcomePolicy,
} from "../../../src/harness/outcome.ts";
import type {
  CampaignRecord,
  ExecutionRecord,
  JudgmentRecord,
} from "../../../src/harness/records.ts";
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
    m.set(j.execution_id, [...(m.get(j.execution_id) ?? []), j]);
  }
  return m;
}

function cellOf(
  c: CampaignRecord,
  es: ExecutionRecord[],
  js: JudgmentRecord[],
  task = "HX-001",
  arm = "plain",
): CellRecord {
  return cellsFromRecords(c, es, index(js)).find((x) =>
    x.task === task && x.arm === arm
  )!;
}

Deno.test("cellsFromRecords: every planned cell appears, unrun cells have no spend", async () => {
  const cells = cellsFromRecords(await campaign(), [], new Map());
  assertEquals(cells.length, 4);
  assertEquals(
    cells.every((c) => c.status === "unrun" && c.spend_usd === 0),
    true,
  );
});

Deno.test("cellsFromRecords: retry chain resolves by final attempt, every attempt's spend counts", async () => {
  const c = await campaign();
  const first = execution(c, {}, {
    termination: "setup_failed",
    did_work: false,
    workspace_hash: null,
    telemetry: telemetry(0.25),
  });
  const second = execution(c, {
    attempt: 2,
    run_kind: "auto_retry",
    retry_of: first.id,
  });
  const cell = cellOf(c, [first, second], [judgment(c, second, true)]);
  assertEquals(
    [cell.status, cell.pass, cell.spend_usd, cell.used_execution],
    ["scored", true, 1.25, second.id],
  );
});

Deno.test("cellsFromRecords: exhausted automatic retry is terminally unscored, spend kept", async () => {
  const c = await campaign();
  const crash = {
    termination: "setup_failed" as const,
    did_work: false,
    workspace_hash: null,
  };
  const first = execution(c, {}, { ...crash, telemetry: telemetry(2) });
  const retry = execution(
    c,
    { attempt: 2, run_kind: "auto_retry", retry_of: first.id },
    { ...crash, telemetry: telemetry(3) },
  );
  assertEquals(cellOf(c, [first], []).status, "pending");
  const cell = cellOf(c, [first, retry], []);
  assertEquals([cell.status, cell.pass, cell.spend_usd], ["unscored", null, 5]);
});

Deno.test("cellsFromRecords: usage limit, missing verdict and verdict-side infra stay pending", async () => {
  const c = await campaign();
  const limited = execution(c, {}, { termination: "usage_limited" });
  assertEquals(cellOf(c, [limited], []).status, "pending");
  const done = execution(c);
  assertEquals(cellOf(c, [done], []).status, "pending");
  assertEquals(cellOf(c, [done], [judgment(c, done, null)]).status, "pending");
});

Deno.test("cellsFromRecords: a crash after read-only work is judged, not retried", async () => {
  const c = await campaign();
  const e = execution(c, {}, { termination: "harness_crash", did_work: true });
  assertEquals(cellOf(c, [e], [judgment(c, e, false)]).pass, false);
});

Deno.test("cellsFromRecords: judgments are selected by execution, task, workspace and oracle", async () => {
  const c = await campaign();
  const e = execution(c);
  const oracle = c.task_set.tasks[0]!.oracle;
  const newerOtherOracle = judgment(c, e, false, {
    task_oracle_hash: H("e"),
    ended_at: "2026-10-09T00:00:00.000Z",
  });
  const otherTask = judgment(c, e, false, {
    task_id: "HX-002",
    ended_at: "2026-10-08T00:00:00.000Z",
  });
  const otherWorkspace = judgment(c, e, false, {
    workspace_hash: H("d"),
    ended_at: "2026-10-08T00:00:00.000Z",
  });
  const ok = judgment(c, e, true);
  const cell = cellOf(c, [e], [
    newerOtherOracle,
    otherTask,
    otherWorkspace,
    ok,
  ]);
  assertEquals([cell.pass, cell.judgment_id, cell.oracle_hash], [
    true,
    ok.id,
    oracle,
  ]);

  // A rejudge against a fixed oracle is used only in that judging context.
  const current = {
    source: "current" as const,
    oracle: new Map([["HX-001", H("e")], ["HX-002", H("4")]]),
  };
  const rejudged = cellsFromRecords(
    c,
    [e],
    index([newerOtherOracle, ok]),
    current,
  )
    .find((x) => x.task === "HX-001" && x.arm === "plain")!;
  assertEquals([rejudged.pass, rejudged.oracle_hash], [false, H("e")]);
});

Deno.test("cellsFromRecords: same-oracle rejudge wins; equal timestamps break by id", async () => {
  const c = await campaign();
  const e = execution(c);
  const old = judgment(c, e, false);
  const newer = judgment(c, e, true, { ended_at: "2026-10-05T00:00:00.000Z" });
  assertEquals(cellOf(c, [e], [newer, old]).judgment_id, newer.id);
  const tieA = judgment(c, e, false, {
    id: "00000000-0000-4000-a000-00000000000a",
  });
  const tieB = judgment(c, e, true, {
    id: "00000000-0000-4000-a000-00000000000b",
  });
  assertEquals(cellOf(c, [e], [tieB, tieA]).judgment_id, tieB.id);
  assertEquals(cellOf(c, [e], [tieA, tieB]).judgment_id, tieB.id);
});

Deno.test("cellsFromRecords: a manual rerun never replaces a scored result, but fills an unscored one", async () => {
  const c = await campaign();
  const planned = execution(c);
  const manual = execution(c, { attempt: 2, run_kind: "manual_rerun" }, {
    telemetry: telemetry(4),
  });
  const keep = cellOf(c, [planned, manual], [
    judgment(c, planned, false),
    judgment(c, manual, true),
  ]);
  assertEquals([
    keep.pass,
    keep.used_execution,
    keep.spend_usd,
    keep.manual_reruns,
  ], [false, planned.id, 5, 1]);

  const limited = execution(c, {}, { termination: "usage_limited" });
  const fill = execution(c, { attempt: 2, run_kind: "manual_rerun" });
  const filled = cellOf(c, [limited, fill], [judgment(c, fill, true)]);
  assertEquals([filled.status, filled.used_kind, filled.used_execution], [
    "scored",
    "manual_rerun",
    fill.id,
  ]);
});

Deno.test("cellsFromRecords: duplicate attempt numbers are refused", async () => {
  const c = await campaign();
  assertThrows(
    () => cellsFromRecords(c, [execution(c), execution(c)], new Map()),
    ValidationError,
    "duplicate attempt",
  );
});

Deno.test("cellsFromRecords: an unknown attempt cost makes the cell spend unknown", async () => {
  const c = await campaign();
  const e = execution(c, {}, { telemetry: telemetry(null) });
  assertEquals(cellOf(c, [e], [judgment(c, e, true)]).spend_usd, null);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/outcome.test.ts`
Expected: FAIL, `Module not found ".../src/harness/outcome.ts"`.

- [ ] **Step 3: Implement**

`src/harness/outcome.ts`:

```typescript
/**
 * Termination rules (spec 1a section 8), judgment selection and the join
 * from immutable records to per-cell results (owner rules
 * H:\cg-coord\decisions\2026-09-25-m1-metric-rules.md).
 *
 * - An automatic retry chain (planned + auto_retry) resolves by its final
 *   attempt.
 * - A manual rerun never replaces a scored chain result. It is used only when
 *   the chain has no scored result, and the cell records which execution was
 *   used.
 * - Every attempt's spend (chain and manual) stays in the cell.
 * - Judgments are selected in an explicit judging context: same execution,
 *   same task, same workspace, and the context's oracle hash for the task.
 *   Newest `ended_at` wins, ties broken by the larger judgment id.
 */

import { ValidationError } from "../errors.ts";
import type {
  CampaignRecord,
  ExecutionRecord,
  JudgmentRecord,
  RUN_KINDS,
  TERMINATIONS,
} from "./records.ts";
import type { Cell, CellStatus } from "./stats.ts";

export type Termination = (typeof TERMINATIONS)[number];
export type RunKind = (typeof RUN_KINDS)[number];

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

/** Which oracle each task is judged against. */
export interface JudgingContext {
  source: "campaign" | "current";
  oracle: Map<string, string>;
}

export function campaignJudging(c: CampaignRecord): JudgingContext {
  return {
    source: "campaign",
    oracle: new Map(c.task_set.tasks.map((t) => [t.id, t.oracle])),
  };
}

export function selectJudgment(
  e: ExecutionRecord,
  judgments: JudgmentRecord[],
  oracle: string | undefined,
): JudgmentRecord | null {
  let best: JudgmentRecord | null = null;
  for (const j of judgments) {
    if (
      j.execution_id !== e.id || j.task_id !== e.task_id ||
      j.workspace_hash !== e.workspace_hash || j.task_oracle_hash !== oracle
    ) continue;
    if (
      best === null || j.ended_at > best.ended_at ||
      (j.ended_at === best.ended_at && j.id > best.id)
    ) best = j;
  }
  return best;
}

/** A Cell plus the provenance the report shows. */
export interface CellRecord extends Cell {
  used_execution: string | null;
  used_kind: RunKind | null;
  judgment_id: string | null;
  oracle_hash: string | null;
  manual_reruns: number;
}

interface Resolved {
  status: CellStatus;
  pass: boolean | null;
  judgment: JudgmentRecord | null;
}

function resolve(
  e: ExecutionRecord,
  judgments: JudgmentRecord[],
  oracle: string | undefined,
): Resolved {
  const policy = outcomePolicy(e.termination, e.did_work);
  if (policy.judge) {
    const j = selectJudgment(e, judgments, oracle);
    if (j && j.verdict !== "unscored") {
      return { status: "scored", pass: j.verdict === "pass", judgment: j };
    }
    // No compatible verdict yet, or a verdict-side infra fault awaiting a
    // rejudge on another container (spec 1a section 8).
    return { status: "pending", pass: null, judgment: j };
  }
  if (policy.retry === "once" && e.run_kind === "auto_retry") {
    return { status: "unscored", pass: null, judgment: null };
  }
  return { status: "pending", pass: null, judgment: null };
}

/** One CellRecord per planned (block, arm). */
export function cellsFromRecords(
  campaign: CampaignRecord,
  executions: ExecutionRecord[],
  judgments: Map<string, JudgmentRecord[]>,
  judging: JudgingContext = campaignJudging(campaign),
): CellRecord[] {
  const reused = new Set(campaign.reuse.map((r) => r.execution_id));
  const key = (task: string, repeat: number, arm: string) =>
    `${task}\u0000${repeat}\u0000${arm}`;
  const byCell = new Map<string, ExecutionRecord[]>();
  for (const e of executions) {
    if (e.campaign_id !== campaign.id && !reused.has(e.id)) continue;
    const k = key(e.task_id, e.repeat, e.arm);
    byCell.set(k, [...(byCell.get(k) ?? []), e]);
  }
  const cells: CellRecord[] = [];
  for (const b of campaign.blocks) {
    for (const arm of b.order) {
      const all = byCell.get(key(b.task_id, b.repeat, arm)) ?? [];
      if (new Set(all.map((e) => e.attempt)).size !== all.length) {
        throw new ValidationError(
          `duplicate attempt numbers in cell ${b.task_id}/${b.repeat}/${arm}`,
          [`${b.task_id}/${b.repeat}/${arm}`],
        );
      }
      const oracle = judging.oracle.get(b.task_id);
      const js = (e: ExecutionRecord) => judgments.get(e.id) ?? [];
      const costs = all.map((e) => e.telemetry.cost_usd);
      const cell: CellRecord = {
        task: b.task_id,
        arm,
        repeat: b.repeat,
        status: "unrun",
        pass: null,
        spend_usd: costs.includes(null)
          ? null
          : (costs as number[]).reduce((a, c) => a + c, 0),
        attempts: all.length,
        used_execution: null,
        used_kind: null,
        judgment_id: null,
        oracle_hash: null,
        manual_reruns: all.filter((e) => e.run_kind === "manual_rerun").length,
      };
      const byAttempt = (xs: ExecutionRecord[]) =>
        [...xs].sort((x, y) => y.attempt - x.attempt);
      const chain = byAttempt(all.filter((e) => e.run_kind !== "manual_rerun"));
      const manual = byAttempt(
        all.filter((e) => e.run_kind === "manual_rerun"),
      );
      const use = (e: ExecutionRecord, r: Resolved) => {
        cell.status = r.status;
        cell.pass = r.pass;
        cell.used_execution = e.id;
        cell.used_kind = e.run_kind;
        cell.judgment_id = r.judgment?.id ?? null;
        cell.oracle_hash = r.judgment?.task_oracle_hash ?? null;
      };
      if (chain[0]) use(chain[0], resolve(chain[0], js(chain[0]), oracle));
      if (cell.status !== "scored") {
        for (const m of manual) {
          const r = resolve(m, js(m), oracle);
          if (r.status === "scored") {
            use(m, r);
            break;
          }
        }
      }
      if (cell.status === "unrun" && all.length > 0) cell.status = "pending";
      cells.push(cell);
    }
  }
  return cells;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/outcome.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/outcome.ts tests/unit/harness/outcome.test.ts
deno lint src/harness/outcome.ts tests/unit/harness/outcome.test.ts
deno fmt src/harness/outcome.ts tests/unit/harness/outcome.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/outcome.ts tests/unit/harness/outcome.test.ts
git commit -m "feat(harness): termination rules, judging context, records-to-cells"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/outcome.test.ts` exits 0, and check / lint / fmt --check are clean on the two files.

---

### Task M1-09: report skeleton (console + JSON)

Spec 1a section 9: header (hypothesis, primary metric, component diff baseline to each variant, campaign, coverage, incomplete-telemetry and infra-exposed counts per arm), primary (cost per solved task per arm and delta with CI, next to pass rate and its delta), outcome (pass rate, pass^k, per-task flip table). Non-primary metrics are labelled exploratory. Review must-change 6 and the M1-09 acceptance row: records are validated first (M1-07b); the report shows planned / attempted / scored / unscored / pending / unrun counts, raw and pending spend, the provisional marker, the matched-pair cohort with exclusion reasons, the judging context and which tasks use another oracle, and, in JSON, every cell's execution and judgment. Efficiency and slices are Part 2 (`tasks_meta` already carries `kind` and `coupling`).

**Deps:** M1-04, M1-05, M1-06, M1-07b, M1-08.

**Files:**
- Create: `src/harness/report.ts`
- Test: `tests/unit/harness/report.test.ts`

**Interfaces:**
- Consumes: `taskSetHash` (M1-04); `diffManifests`, `ManifestKey` (M1-05); `armSummary`, `compareArms`, `ArmSummary`, `Comparison`, `BootstrapOptions` (M1-06); `CampaignRecords`, `validateCampaignRecords` (M1-07b); `campaignJudging`, `cellsFromRecords`, `CellRecord`, `JudgingContext` (M1-08).
- Produces: `interface ArmCoverage`; `interface HarnessReport { v: 1; experiment; campaign; judging; provisional; coverage; diffs; arms; comparisons; flips; cells }`; `interface ReportOptions extends BootstrapOptions { judging?: JudgingContext }`; `buildReport(records: CampaignRecords, opts?): Promise<HarnessReport>`; `renderReport(r): string`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/report.test.ts`:

```typescript
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import { ValidationError } from "../../../src/errors.ts";
import type { CampaignRecords } from "../../../src/harness/integrity.ts";
import { buildReport, renderReport } from "../../../src/harness/report.ts";
import { campaign, execution, H, judgment, telemetry } from "./fixtures.ts";

/**
 * plain passes HX-001 only at $2 per cell; skills passes both at $1 per cell
 * and is infra-exposed on HX-002.
 */
async function records(): Promise<CampaignRecords> {
  const c = await campaign();
  const rows: Array<[string, string, boolean, number]> = [
    ["plain", "HX-001", true, 2],
    ["plain", "HX-002", false, 2],
    ["skills", "HX-001", true, 1],
    ["skills", "HX-002", true, 1],
  ];
  const executions = [];
  const judgments = [];
  for (const [arm, task, pass, cost] of rows) {
    const e = execution(c, { arm, task }, {
      telemetry: telemetry(cost),
      validity: {
        incomplete_telemetry: arm === "plain" ? ["turns"] : [],
        infra_exposed: arm === "skills" && task === "HX-002",
      },
    });
    executions.push(e);
    judgments.push(judgment(c, e, pass));
  }
  return { campaign: c, executions, artifacts: [], judgments };
}

Deno.test("buildReport: header, coverage, primary and outcome numbers", async () => {
  const r = await buildReport(await records(), { resamples: 200, seed: 1 });
  assertEquals(r.experiment.primary_metric, "cost_per_solved_task");
  assertEquals(r.diffs, [{ variant: "skills", differing: ["skills"] }]);
  assertEquals(r.provisional, false);
  assertEquals(
    r.coverage.map((c) => [c.arm, c.infra_exposed, c.incomplete_telemetry]),
    [["plain", 0, { turns: 2 }], ["skills", 1, {}]],
  );
  // plain: (2 + 2) / (1 + 0) = 4; skills: (1 + 1) / 2 = 1
  assertEquals(r.arms.map((a) => a.cost_per_solved_task), [4, 1]);
  assertEquals(r.arms.map((a) => a.total_spend_usd), [4, 2]);
  const [primary, secondary] = r.comparisons;
  assertEquals(
    [primary!.metric, primary!.primary, primary!.delta, primary!.pairs],
    ["cost_per_solved_task", true, -3, 2],
  );
  assertEquals([secondary!.metric, secondary!.primary], ["pass_rate", false]);
  assertEquals(r.flips, [{
    task: "HX-002",
    kind: "bugfix",
    coupling: ["events"],
    pass_rate: { plain: 0, skills: 1 },
  }]);
  assertEquals(r.judging.source, "campaign");
  assertEquals(r.judging.identity, r.campaign.task_set_identity);
  assert(
    r.cells.every((c) => c.judgment_id !== null && c.used_execution !== null),
  );
});

Deno.test("buildReport: pending cells make it provisional and are reported as exclusions", async () => {
  const base = await records();
  const pendingId = base.executions[1]!.id; // plain HX-002
  const r = await buildReport(
    {
      ...base,
      judgments: base.judgments.filter((j) => j.execution_id !== pendingId),
    },
    { resamples: 50 },
  );
  assertEquals(r.provisional, true);
  assertEquals(r.arms[0]!.pending_cells, 1);
  assertEquals(r.arms[0]!.pending_spend_usd, 2);
  assertEquals(r.comparisons[0]!.excluded.baseline, { pending: 1 });
  assertEquals(r.comparisons[0]!.pairs, 1);
});

Deno.test("buildReport: inconsistent records are refused before any number is computed", async () => {
  const base = await records();
  await assertRejects(
    () =>
      buildReport({
        ...base,
        executions: [
          { ...base.executions[0]!, task_visible_hash: H("9") },
          ...base.executions.slice(1),
        ],
      }),
    ValidationError,
    "visible-input hash",
  );
});

Deno.test("buildReport: JSON round-trips", async () => {
  const r = await buildReport(await records(), { resamples: 50 });
  assertEquals(JSON.parse(JSON.stringify(r)), r);
});

Deno.test("renderReport: hypothesis first, never says equal, exploratory and exclusions shown", async () => {
  const text = stripAnsiCode(
    renderReport(await buildReport(await records(), { resamples: 200 })),
  );
  assert(text.indexOf("Hypothesis:") < text.indexOf("Primary\n"));
  assertStringIncludes(text, "Diff plain -> skills: skills");
  assertStringIncludes(text, "[exploratory]");
  assertStringIncludes(text, "infra exposed 1");
  assertStringIncludes(text, "incomplete telemetry: turns 2");
  assertStringIncludes(text, "Judged with campaign oracles");
  assertStringIncludes(text, "excluded: plain none; skills none");
  assert(!/\bequal\b/i.test(text), "report must never claim arms are equal");
});

Deno.test("renderReport: sparse solves suppress the CI and say why", async () => {
  const text = stripAnsiCode(
    renderReport(
      await buildReport(await records(), { resamples: 400, seed: 3 }),
    ),
  );
  // plain solves only HX-001, so resamples drawing HX-002 twice have no solve.
  assertStringIncludes(text, "CI suppressed");
});

Deno.test("renderReport: no solved task shows n/a", async () => {
  const c = await campaign();
  const e = execution(c);
  const text = stripAnsiCode(renderReport(
    await buildReport({
      campaign: c,
      executions: [e],
      artifacts: [],
      judgments: [judgment(c, e, false)],
    }, { resamples: 20 }),
  ));
  assertStringIncludes(text, "cost per solved task n/a");
  assertStringIncludes(text, "PROVISIONAL");
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
 *
 * The report runs only on records that pass validateCampaignRecords, states
 * the judging context (which oracle per task), shows planned / attempted /
 * scored counts, raw and pending spend, the matched-pair cohort with
 * exclusion reasons, and which execution and judgment every cell used.
 */

import * as colors from "@std/fmt/colors";
import type { PrimaryMetric } from "./config.ts";
import { taskSetHash } from "./identity.ts";
import { type CampaignRecords, validateCampaignRecords } from "./integrity.ts";
import { diffManifests, type ManifestKey } from "./manifest.ts";
import {
  campaignJudging,
  type CellRecord,
  cellsFromRecords,
  type JudgingContext,
} from "./outcome.ts";
import type { JudgmentRecord } from "./records.ts";
import {
  type ArmSummary,
  armSummary,
  type BootstrapOptions,
  compareArms,
  type Comparison,
} from "./stats.ts";

export interface ArmCoverage {
  arm: string;
  executions: number;
  manual_reruns: number;
  infra_exposed: number;
  /** Executions per missing declared telemetry field. */
  incomplete_telemetry: Record<string, number>;
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
    reused_executions: number;
    task_set_identity: string;
    tasks: number;
  };
  judging: {
    source: JudgingContext["source"];
    /** Task-set identity with the judging oracles substituted. */
    identity: string;
    tasks_with_other_oracle: string[];
  };
  provisional: boolean;
  coverage: ArmCoverage[];
  diffs: Array<{ variant: string; differing: ManifestKey[] }>;
  arms: ArmSummary[];
  /** The declared primary metric first, the other one exploratory. */
  comparisons: Array<Comparison & { primary: boolean }>;
  flips: Array<{
    task: string;
    kind: string;
    coupling: string[];
    pass_rate: Record<string, number | null>;
  }>;
  cells: CellRecord[];
}

export interface ReportOptions extends BootstrapOptions {
  judging?: JudgingContext;
}

export async function buildReport(
  records: CampaignRecords,
  opts: ReportOptions = {},
): Promise<HarnessReport> {
  await validateCampaignRecords(records);
  const { campaign, executions } = records;
  const exp = campaign.experiment;
  const arms = [exp.baseline, ...exp.variants];
  const judging = opts.judging ?? campaignJudging(campaign);
  const byExecution = new Map<string, JudgmentRecord[]>();
  for (const j of records.judgments) {
    byExecution.set(j.execution_id, [
      ...(byExecution.get(j.execution_id) ?? []),
      j,
    ]);
  }
  const cells = cellsFromRecords(campaign, executions, byExecution, judging);
  const judgedTasks = campaign.task_set.tasks.map((t) => ({
    ...t,
    oracle: judging.oracle.get(t.id) ?? t.oracle,
  }));
  const manifestOf = (id: string) =>
    campaign.arms.find((a) => a.config_id === id)!.manifest;
  const diffs = [];
  for (const variant of exp.variants) {
    diffs.push({
      variant,
      differing: await diffManifests(
        manifestOf(exp.baseline),
        manifestOf(variant),
      ),
    });
  }
  const metrics: PrimaryMetric[] = exp.primary_metric === "pass_rate"
    ? ["pass_rate", "cost_per_solved_task"]
    : ["cost_per_solved_task", "pass_rate"];
  const bootstrap = {
    ...(opts.resamples !== undefined ? { resamples: opts.resamples } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.level !== undefined ? { level: opts.level } : {}),
  };
  const comparisons = exp.variants.flatMap((variant) =>
    metrics.map((metric) => ({
      ...compareArms(cells, exp.baseline, variant, metric, bootstrap),
      primary: metric === exp.primary_metric,
    }))
  );
  const summaries = arms.map((arm) => armSummary(cells, arm, exp.repeats));
  const rate = (task: string, arm: string) => {
    const ps = cells.filter((c) =>
      c.task === task && c.arm === arm && c.status === "scored"
    );
    return ps.length === 0 ? null : ps.filter((c) => c.pass).length / ps.length;
  };
  const meta = new Map(campaign.tasks_meta.map((t) => [t.id, t]));
  const flips = campaign.task_set.tasks
    .map((t) => ({
      task: t.id,
      kind: meta.get(t.id)!.kind,
      coupling: meta.get(t.id)!.coupling,
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
      reused_executions: campaign.reuse.length,
      task_set_identity: campaign.task_set.identity,
      tasks: campaign.task_set.tasks.length,
    },
    judging: {
      source: judging.source,
      identity: await taskSetHash(judgedTasks),
      tasks_with_other_oracle: judgedTasks
        .filter((t, i) => t.oracle !== campaign.task_set.tasks[i]!.oracle)
        .map((t) => t.id),
    },
    provisional: summaries.some((s) => s.provisional),
    coverage: arms.map((arm) => {
      const es = executions.filter((e) => e.arm === arm);
      const fields: Record<string, number> = {};
      for (const e of es) {
        for (const f of e.validity.incomplete_telemetry) {
          fields[f] = (fields[f] ?? 0) + 1;
        }
      }
      return {
        arm,
        executions: es.length,
        manual_reruns: es.filter((e) => e.run_kind === "manual_rerun").length,
        infra_exposed: es.filter((e) => e.validity.infra_exposed).length,
        incomplete_telemetry: fields,
      };
    }),
    diffs,
    arms: summaries,
    comparisons,
    flips,
    cells,
  };
}

const usd = (x: number | null) => (x === null ? "n/a" : `$${x.toFixed(3)}`);
const pct = (x: number | null) =>
  x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
const reasons = (r: Record<string, number | undefined>) =>
  Object.entries(r).map(([k, v]) => `${k} ${v}`).join(", ") || "none";

function fmtDelta(c: Comparison): string {
  const f = c.metric === "pass_rate"
    ? (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pp`
    : (x: number) => `${x >= 0 ? "+" : "-"}$${Math.abs(x).toFixed(3)}`;
  if (c.delta === null) return "n/a (no solved task in the matched pairs)";
  const cohort = `${c.pairs} matched pairs over ${c.tasks} tasks`;
  if (c.ci === null) {
    return `${f(c.delta)}, CI suppressed: ${
      pct(c.undefined_share)
    } of resamples had no solve (${cohort})`;
  }
  const verdict = c.distinguishable
    ? colors.green("distinguishable")
    : colors.yellow("not distinguishable");
  return `${f(c.delta)} [${f(c.ci[0])}, ${f(c.ci[1])}] ${verdict} (${cohort})`;
}

export function renderReport(r: HarnessReport): string {
  const out: string[] = [];
  const h = (s: string) => out.push("", colors.bold(s));
  out.push(colors.bold(`Harness report: ${r.experiment.id}`));
  if (r.provisional) {
    out.push(colors.yellow("PROVISIONAL: cells are still pending or unrun"));
  }
  out.push(`Hypothesis: ${r.experiment.hypothesis}`);
  out.push(`Primary metric: ${r.experiment.primary_metric}`);
  out.push(
    `Campaign ${r.campaign.id} (${r.campaign.created_at}), task set ${
      r.campaign.task_set_identity.slice(0, 12)
    }, ${r.campaign.tasks} tasks${
      r.campaign.reused_executions > 0
        ? colors.yellow(`, REUSES ${r.campaign.reused_executions} executions`)
        : ""
    }`,
  );
  out.push(
    `Judged with ${r.judging.source} oracles (${
      r.judging.identity.slice(0, 12)
    })${
      r.judging.tasks_with_other_oracle.length > 0
        ? `, changed for ${r.judging.tasks_with_other_oracle.join(", ")}`
        : ""
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
  for (const a of r.arms) {
    const c = r.coverage.find((x) => x.arm === a.arm)!;
    out.push(
      `  ${a.arm}: planned ${a.planned_cells}, attempted ${a.attempted_cells}, scored ${a.scored_cells}, unscored ${a.unscored_cells}, pending ${a.pending_cells}, unrun ${a.unrun_cells}; ${c.executions} executions (${c.manual_reruns} manual reruns), infra exposed ${c.infra_exposed}, incomplete telemetry: ${
        reasons(c.incomplete_telemetry)
      }`,
    );
  }
  h("Primary");
  for (const a of r.arms) {
    out.push(
      `  ${a.arm}: cost per solved task ${
        usd(a.cost_per_solved_task)
      }, pass rate ${pct(a.pass_rate)}; spend ${
        usd(a.total_spend_usd)
      } (pending ${
        usd(a.pending_spend_usd)
      }, ${a.unknown_spend_cells} cells with unknown cost)`,
    );
  }
  for (const c of r.comparisons) {
    const label = c.primary ? "" : colors.dim(" [exploratory]");
    out.push(
      `  ${c.variant} vs ${c.baseline}, ${c.metric}: ${fmtDelta(c)}${label}`,
    );
    out.push(
      `    excluded: ${c.baseline} ${
        reasons(c.excluded.baseline)
      }; ${c.variant} ${reasons(c.excluded.variant)}`,
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
        `    ${f.task} (${f.kind}): ${
          Object.entries(f.pass_rate).map(([a, v]) => `${a} ${pct(v)}`).join(
            ", ",
          )
        }`,
      );
    }
  }
  const manual = r.cells.filter((c) => c.used_kind === "manual_rerun");
  if (manual.length > 0) {
    out.push("  Cells scored from a manual rerun:");
    for (const c of manual) {
      out.push(
        `    ${c.task} r${c.repeat} ${c.arm}: execution ${c.used_execution}`,
      );
    }
  }
  return out.join("\n");
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/report.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/report.ts tests/unit/harness/report.test.ts
deno lint src/harness/report.ts tests/unit/harness/report.test.ts
deno fmt src/harness/report.ts tests/unit/harness/report.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/report.ts tests/unit/harness/report.test.ts
git commit -m "feat(harness): report skeleton with cohort and judging provenance"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/report.test.ts` exits 0, and check / lint / fmt --check are clean on the two files.

---

### Task M1-10: `centralgauge harness validate` and `harness report`

Spec 1a section 10 (CLI, Cliffy, `--no-X` rule) and section 9 (`harness report <experiment>`). `validate` is the static gate lane-content (M4) runs after authoring: it loads every task, the symbols lock and every experiment with its configs, checks model ids against `site/catalog`, prints the task-set identity, and says plainly that it ran no authoring gate, compile or runtime comparability check. `report` reads a campaign, validates it, and supports `--judging campaign|current` (current = the working tree's oracles, for use after an oracle fix and rejudge). No `--no-X` option is added. `run`, `cell`, `rejudge` and `images build` are Part 2. Tests go through real Cliffy parsing for `--json` output and `--help`.

**Deps:** M1-01, M1-03, M1-04, M1-07, M1-08, M1-09.

**Files:**
- Create: `cli/commands/harness-command.ts`
- Modify: `cli/commands/mod.ts` (one export line, alphabetical, before `registerIngestCommand`)
- Modify: `cli/centralgauge.ts` (import list and one registration call)
- Test: `tests/unit/cli/commands/harness-command.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `validateHarness(repoRoot: string): Promise<string[]>`; `interface ReportOptions { resultsDir; campaign?: string | undefined; resamples; seed; judging: "campaign" | "current"; root }`; `harnessReport(experimentId, opts): Promise<HarnessReport>`; `registerHarnessCommand(cli: Command): void`.

- [ ] **Step 1: Write the failing test**

`tests/unit/cli/commands/harness-command.test.ts`:

```typescript
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { Command } from "@cliffy/command";
import { stripAnsiCode } from "@std/fmt/colors";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import {
  harnessReport,
  registerHarnessCommand,
  validateHarness,
} from "../../../../cli/commands/harness-command.ts";
import {
  CentralGaugeError,
  ConfigurationError,
  ValidationError,
} from "../../../../src/errors.ts";
import { RecordStore } from "../../../../src/harness/records.ts";
import {
  campaign,
  CAMPAIGN_ID,
  execution,
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
  await write(
    root,
    "site/catalog/models.yml",
    "- slug: anthropic/model-a\n  api_model_id: model-a\n",
  );
  return root;
}

const CONFIG = (id: string, model = "anthropic/model-a") =>
  `id: ${id}
harness: claude-code
harness_version: 2.1.282
models: { main: ${model} }
limits: { timeout_min: 30, max_budget_usd: 5 }
`;

const EXPERIMENT = `id: x
hypothesis: h
primary_metric: cost_per_solved_task
baseline: a
variants: [b]
vary: [skills]
tasks: "harness-tasks/tasks/*"
`;

Deno.test("validateHarness: tasks, experiments and catalog; says it is static", async () => {
  const root = await repo();
  await write(root, "harness/configs/a.yml", CONFIG("a"));
  await write(root, "harness/configs/b.yml", CONFIG("b"));
  await write(root, "harness/experiments/x.yml", EXPERIMENT);
  const lines = (await validateHarness(root)).map(stripAnsiCode);
  assertStringIncludes(lines[0]!, "[OK] 1 tasks");
  assertStringIncludes(lines[0]!, "provisional");
  assertStringIncludes(lines[1]!, "[OK] experiment x (2 arms)");
  assertStringIncludes(lines[2]!, "Static checks only");
});

Deno.test("validateHarness: broken experiment or unknown model fails loudly", async () => {
  const root = await repo();
  await write(root, "harness/experiments/x.yml", "id: x\nhypothesis: h\n");
  await assertRejects(() => validateHarness(root), ValidationError, "x.yml");
  await write(root, "harness/experiments/x.yml", EXPERIMENT);
  await write(root, "harness/configs/a.yml", CONFIG("a"));
  await write(root, "harness/configs/b.yml", CONFIG("b", "anthropic/model-zz"));
  await assertRejects(
    () => validateHarness(root),
    ConfigurationError,
    "b.models.main: anthropic/model-zz",
  );
});

async function storeWithOneCell(): Promise<string> {
  const dir = await Deno.makeTempDir();
  const store = new RecordStore(dir);
  const c = await campaign();
  await store.writeCampaign(c);
  const e = execution(c);
  await store.writeExecution(e);
  await store.writeJudgment(judgment(c, e, true));
  return dir;
}

const OPTS = {
  resamples: 10,
  seed: 1,
  judging: "campaign" as const,
  root: ".",
};

Deno.test("harnessReport: newest campaign from the store, loud when none, bad options refused", async () => {
  const empty = await Deno.makeTempDir();
  await assertRejects(
    () => harnessReport("skills-vs-plain", { resultsDir: empty, ...OPTS }),
    CentralGaugeError,
    "No campaign",
  );
  const dir = await storeWithOneCell();
  const r = await harnessReport("skills-vs-plain", {
    resultsDir: dir,
    ...OPTS,
  });
  assertEquals(r.campaign.id, CAMPAIGN_ID);
  assertEquals(r.arms[0]!.scored_cells, 1);
  await assertRejects(
    () =>
      harnessReport("skills-vs-plain", {
        resultsDir: dir,
        ...OPTS,
        resamples: 0,
      }),
    ValidationError,
    "resamples",
  );
});

Deno.test("harnessReport: --judging current uses the working tree's oracles", async () => {
  const dir = await storeWithOneCell();
  const root = await repo();
  const r = await harnessReport("skills-vs-plain", {
    resultsDir: dir,
    ...OPTS,
    judging: "current",
    root,
  });
  assertEquals(r.judging.source, "current");
  // The stored judgment was made against the campaign's oracle, not this one.
  assertEquals(r.judging.tasks_with_other_oracle, ["HX-001"]);
  assertEquals(r.arms[0]!.scored_cells, 0);
  assertEquals(r.arms[0]!.pending_cells, 1);
});

Deno.test("CLI: `harness report --json` parses through cliffy and prints the JSON report", async () => {
  const dir = await storeWithOneCell();
  const cli = new Command().name("centralgauge");
  registerHarnessCommand(cli);
  const printed: string[] = [];
  const log = stub(console, "log", (...args: unknown[]) => {
    printed.push(args.join(" "));
  });
  try {
    await cli.parse([
      "harness",
      "report",
      "skills-vs-plain",
      "--results-dir",
      dir,
      "--json",
      "--resamples",
      "25",
      "--seed",
      "4",
    ]);
  } finally {
    log.restore();
  }
  const report = JSON.parse(printed.join("\n"));
  assertEquals(report.campaign.id, CAMPAIGN_ID);
  assertEquals(report.comparisons[0].resamples, 25);
  assertEquals(report.comparisons[0].seed, 4);
  assertEquals(report.judging.source, "campaign");
});

Deno.test("CLI: `harness --help` lists validate and report", async () => {
  const cli = new Command().name("centralgauge").noExit();
  registerHarnessCommand(cli);
  const printed: string[] = [];
  const log = stub(console, "log", (...args: unknown[]) => {
    printed.push(args.join(" "));
  });
  try {
    await cli.parse(["harness", "--help"]);
  } finally {
    log.restore();
  }
  const text = stripAnsiCode(printed.join("\n"));
  assertStringIncludes(text, "validate");
  assertStringIncludes(text, "report");
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
import { Command, EnumType } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import { CentralGaugeError } from "../../src/errors.ts";
import {
  checkModelsInCatalog,
  loadExperiment,
} from "../../src/harness/config.ts";
import {
  loadSymbolsLock,
  taskSetIdentity,
} from "../../src/harness/identity.ts";
import type { JudgingContext } from "../../src/harness/outcome.ts";
import {
  type ArtifactRecord,
  type JudgmentRecord,
  RecordStore,
} from "../../src/harness/records.ts";
import {
  buildReport,
  type HarnessReport,
  renderReport,
} from "../../src/harness/report.ts";
import { loadTaskSet } from "../../src/harness/task.ts";

async function experimentIds(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith(".yml")) names.push(e.name.slice(0, -4));
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return names.sort();
}

/**
 * Static validation: task.yml schemas and files, the symbols lock, task
 * hashes, experiments with their configs, and model ids against the catalog.
 * It does not run authoring gates, compile anything, or check runtime
 * comparability (image, MCP versions); those need Part 2.
 */
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
  for (
    const name of await experimentIds(join(repoRoot, "harness", "experiments"))
  ) {
    const { configs } = await loadExperiment(join(repoRoot, "harness"), name);
    await checkModelsInCatalog(configs, join(repoRoot, "site", "catalog"));
    lines.push(
      `${colors.green("[OK]")} experiment ${name} (${configs.length} arms)`,
    );
  }
  lines.push(
    colors.dim(
      "Static checks only: no authoring gate, compile or runtime comparability.",
    ),
  );
  return lines;
}

export interface ReportOptions {
  resultsDir: string;
  campaign?: string | undefined;
  resamples: number;
  seed: number;
  /** "current" judges with the oracles of the working tree under `root`. */
  judging: "campaign" | "current";
  root: string;
}

async function currentJudging(root: string): Promise<JudgingContext> {
  const tasks = await loadTaskSet(join(root, "harness-tasks", "tasks"));
  const ids = await taskSetIdentity(root, tasks, await loadSymbolsLock(root));
  return {
    source: "current",
    oracle: new Map(ids.tasks.map((t) => [t.id, t.oracle])),
  };
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
  const artifacts: ArtifactRecord[] = [];
  const judgments: JudgmentRecord[] = [];
  for (const e of executions) {
    const a = await store.artifact(e.id);
    if (a) artifacts.push(a);
    judgments.push(...await store.judgments(e.id));
  }
  return buildReport({ campaign, executions, artifacts, judgments }, {
    resamples: opts.resamples,
    seed: opts.seed,
    ...(opts.judging === "current"
      ? { judging: await currentJudging(opts.root) }
      : {}),
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
      "Static validation of harness tasks, symbols lock, experiments and model ids (no containers)",
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
    .type("judging", new EnumType(["campaign", "current"]))
    .option("--results-dir <dir:string>", "Harness records root", {
      default: "results/harness",
    })
    .option("--campaign <id:string>", "Campaign id (default: newest)")
    .option("--json", "Print the report as JSON")
    .option("--resamples <n:integer>", "Bootstrap resamples", {
      default: 2000,
    })
    .option("--seed <n:integer>", "Bootstrap seed", { default: 1 })
    .option(
      "--judging <source:judging>",
      "Oracles to judge with: the campaign's, or the working tree's (after an oracle fix and rejudge)",
      { default: "campaign" as const },
    )
    .option("--root <dir:string>", "Repository root for --judging current", {
      default: ".",
    })
    .action((opts, experiment: string) =>
      fail(async () => {
        const report = await harnessReport(experiment, {
          resultsDir: opts.resultsDir,
          campaign: opts.campaign,
          resamples: opts.resamples,
          seed: opts.seed,
          judging: opts.judging,
          root: opts.root,
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
Expected: all tests pass.

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

**Acceptance:** `deno test --allow-all tests/unit/cli/commands/harness-command.test.ts` exits 0, `deno task start harness --help` lists both subcommands, and check / lint / fmt --check are clean on the four files.

---

## Integration gate (orchestrator)

After M1-10 merges, on the merge tree. Every command must succeed; this gate uses only test fixtures and temp repos:

```bash
deno test --allow-all tests/unit/harness/ tests/unit/cli/commands/harness-command.test.ts
deno check cli/centralgauge.ts src/harness/ tests/unit/harness/
deno lint src/harness/ cli/commands/harness-command.ts tests/unit/harness/ tests/unit/cli/commands/harness-command.test.ts
deno fmt --check src/harness/ tests/unit/harness/ cli/commands/harness-command.ts tests/unit/cli/commands/harness-command.test.ts
deno task start harness --help
graphify update .
```

Expected: all tests pass (109 at the time of writing), check, lint and fmt clean, help lists `validate` and `report`.

## Expected-failure check on the real repository (informational, not a gate)

`deno task start harness validate` on the real repo is expected to FAIL until M4 lands a first task and tags `refapp-v1`: with no `harness-tasks/tasks/` it fails with NotFound, and with tasks but no tag it fails with `refapp_version refapp-v1 does not resolve`. Record the output in the integration notes; a failure here is the loader working, not a regression. Once M4 has a task and a tag, the same command must print `[OK] ... (provisional: no symbols lock)` until Part 2 writes the lock.

## Part 2, after M0-08 (not in this plan)

Written from `docs/superpowers/specs/2026-09-29-harness-spikes-findings.md` once M0-08 is accepted. Part 2 produces the frozen contracts above; it does not redefine them.

- **Sandbox runtime / container runner** (1a section 5): `docker run` of the harness image, mounts, hard-kill capture, timeout, `acquireBenchLock`, cleanup in `finally`, orphan sweep; `did_work` and `image_attachments` detection.
- **Staging** (1a section 5 item 1, D16): refapp source copied exactly as `resolveRefapp(...).files` describes, overlay, `Test\`, pre-seeded `.alpackages`, `C:\task` metadata from `agentVisibleMetadata`, the `git` source interface, and writing `harness-tasks/symbols.lock.json` (ends `provisional`).
- **Verdict workspace + BC compile/test** (1a section 7): reconstruction, validation (app ids, dependency graph, object ranges), the hostile-artifact copy boundary with its own reparse-point policy (not `listTree`), scorers `build`, `pass_to_pass`, `fail_to_pass`, `mutant_kill` producing `target` and `failure` per procedure, rejudge on another container.
- **Backend** (`cg-al` compile/test/symbols, scoped per-execution token, host call log, `CompileQueuePool` sharing, D12).
- **Mock harness image** and the hostile contract tests (1a section 11).
- **Campaign runner**: `harness run` / `cell` / `rejudge` / `images build`, resume (calls `validateCampaignRecords` first), staged runs over the immutable plan, `--reuse-history` writing `reuse` references, cost estimate before a run, usage-limit pause, runtime facts collection for `resolveManifest`, observed-manifest check (`setup_failed` on a missing component or version mismatch), `sweepTemp` at startup.
- **Telemetry and trace parsing** per harness (metrics contract filling `validity.incomplete_telemetry`, token normalization, list-price estimate with pricing snapshot), call categorization (rules, Laya, opt-in Jev), secret redaction.
- **Report sections** Efficiency (including time to first green build as a censored share, and the both-pass descriptive table) and Slices by `kind` and `coupling`.

Carryover requirements that Part 2 must meet and must list as acceptance criteria (from `H:\cg-coord\decisions\2026-09-25-accept-M0-03.md`):

1. No secret in any argv. Pass secrets by env or file only.
2. The runner creates the container and opens capture files inside `try`, checks the exit status of `docker rm -f`, and at startup removes leftover `cg-harness-*` containers it owns (name prefix plus label).
3. Secrets are not mounted into the agent-readable filesystem, or the threat model (1a section 1) states why they must be. This contradicts the current section 5 item 2 `C:\cg-secrets` mount and must be resolved in the Part 2 plan or a spec update.

Also from `H:\cg-coord\decisions\2026-09-25-accept-M0-01.md`: `deno task id-audit` (`scripts/id-audit.ts`) has no band rule for `harness-tasks/`. Add one: `harness-tasks/refapp/<module>` in 70000-74999, `harness-tasks/refapp/Test` and task overlays under `Test\` in 80000-84999, `harness-tasks/tasks/*/oracle` and `mutants` in 85000-89999, nothing in 75000-79999 (1b section 4).

## Open questions

The ten questions of the first draft are decided (owner rules above). What is left, with the reason it is open:

1. **Scorer-version policy for judgment selection.** Selection matches execution, task, workspace and oracle, and accepts any scorer versions. Whether a newer scorer version should supersede, or be required, depends on how the Part 2 verdict pipeline versions scorers. Open until that pipeline exists.
2. **Manual rerun spend.** This plan counts a manual rerun's spend in its cell (reading owner rule 1, "every attempt"), even when the rerun is not the execution used. The owner rules say reruns are separate and never replace a scored result, but not whose spend they carry. Confirm.
3. **Pending spend in the headline.** Pending cells' spend is disclosed and marks the headline provisional but is not in the headline until the cell is terminal, so the headline and the matched-pair comparison use the same cells. Rule 1 says "disclosed", not "included". Confirm.
4. **Terminally unscored cells in the pass rate.** An exhausted retry cell counts its spend in cost per solved task (a spend with no solve) but is excluded from the pass rate rather than counted as a fail, because spec 1a section 8 says unscored is never a model failure. Confirm.
