# Taxonomy v2, Plan A: pipeline, catalog and ingest capture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the schema-version-2 taxonomy catalog from the task manifests by deterministic rules, validate it in CI, make the sync CLI speak version 2, and make the bench's ingest envelope carry the run-time facts the spec says cannot be backfilled.

**Architecture:** One pure TypeScript module (`site/src/lib/shared/taxonomy-schema.ts`) owns the catalog types, validation, normalization and digest, and is imported by both the Deno pipeline and (in Plan B) the Worker. The pipeline under `.claude/skills/refresh-task-taxonomy/pipeline/` is rewritten around format rules read from manifest fields, an alias table for surface tags, and composite derivation by donor union. The bench-to-ingest mapping in `cli/commands/bench/ingest-assembly.ts` and the envelope in `src/ingest/envelope.ts` gain the per-attempt and per-run capture fields; the current Worker ignores unknown fields, so this ships before Plan B.

**Tech Stack:** Deno 2 + TypeScript (pipeline, CLI, tests via `deno test`), `jsr:@std/yaml`, `jsr:@std/fs/walk`, Web Crypto (`crypto.subtle`) for digests, vitest for the one site-side test of the shared module.

**Spec:** `docs/superpowers/specs/2026-09-02-taxonomy-v2-design.md` (revision 4). Sections implemented here: 4.1 to 4.5, 5.5, 8.1 (release 1 steps 1 and the ingest half of 3).

## Global Constraints

- Never edit any file under `tasks/` or `tests/al/` (spec 3). The pipeline reads manifests; it does not write them.
- Slugs match `^[a-z0-9]+(-[a-z0-9]+)*$` (spec 4.4).
- Format rules and compatibility matrix exactly as spec 4.1; known cohorts are `ado-trap-2026` and `reasoning-100`; known templates are `code-gen.md`, `diagnose.md`, `diagnose-objects.md`, `diagnose-contract.md`. Anything else fails validation.
- Families: `mechanism`, `invariant`, `surface`, `environment` (spec 4.2). Retired slugs: `diagnose`, `composite`, `multi-defect`, `minimal-symptom`, any `defect-sites-N`, `calculations`.
- Composite derivation: `derived_facets` = union over donors of mechanism, invariant, surface and environment facets; `min_bc_version` = max over donors; `local_facets` disjoint from derived (spec 4.3). Donors must be `diagnose-single` tasks in the same set, 4 to 8, distinct, not self.
- Digest = SHA-256 of canonical JSON (keys sorted at every depth, no whitespace) of `{schema_version, task_set_hash, normalized}` (spec 5.2).
- Pipeline output is byte-deterministic on unchanged input (spec 4.5).
- Run `deno check <file>`, `deno lint <dir>`, `deno fmt <file>` on every TypeScript file you touch (CLAUDE.md). Do not run `deno fmt` on `site/`.
- Tests run with `deno test --allow-all <path>`; never bare `deno test`. The Worker's shared-module test runs with `cd site && npx vitest run --config vitest.unit.config.ts <path>`.
- Commit after every task with a message ending in `Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK`.

---

## File map

| File | Responsibility |
| --- | --- |
| `site/src/lib/shared/taxonomy-schema.ts` (create) | Catalog v2 types, `validateCatalog`, `normalizeCatalog`, `canonicalJson`, `catalogDigest`, vocabulary constants |
| `site/src/lib/shared/taxonomy-graph.ts` (create) | Task-donor graph components, effective count, largest share |
| `site/src/lib/shared/fixtures/taxonomy-golden.json` (create) | Golden digest vectors shared by Deno and vitest |
| `site/src/lib/shared/taxonomy-schema.test.ts` (create) | vitest side of the golden vectors |
| `.claude/skills/refresh-task-taxonomy/pipeline/format-rules.ts` (create) | `deriveFormat` and the compatibility matrix |
| `.claude/skills/refresh-task-taxonomy/pipeline/aliases.ts` (create) | Surface alias table, retired slugs |
| `.claude/skills/refresh-task-taxonomy/pipeline/catalog-yaml.ts` (create) | Deterministic YAML emitter and parser for catalog v2 |
| `.claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts` (rewrite) | Manifests to draft catalog |
| `.claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts` (rewrite) | Enrichment merge and composite derivation |
| `.claude/skills/refresh-task-taxonomy/pipeline/validate-taxonomy.ts` (create) | Validator CLI, exit 1 on failure |
| `.claude/skills/refresh-task-taxonomy/pipeline/expected-counts.json` (create) | Per-format expected counts |
| `.claude/skills/refresh-task-taxonomy/pipeline/enrich-task-tags.workflow.js` (modify) | Mechanism and invariant vocabulary |
| `.claude/skills/refresh-task-taxonomy/pipeline/graph-fixture.ts` (create) | Writes `docs/reasoning-suite/taxonomy-graph-fixture.json` |
| `cli/commands/sync-taxonomy-command.ts` (modify) | Version-2 payload, digest, explicit hash |
| `src/utils/harness-fingerprint.ts` (create) | `HARNESS_INPUTS`, `harnessFingerprint()` moved from gold-ci |
| `scripts/gold-ci.ts` (modify) | Import the shared fingerprint |
| `src/llm/prompt-building.ts` (modify) | Export `RETRY_PATH_VERSION` |
| `src/ingest/capture.ts` (create) | Termination-kind derivation, test vector, environment manifest, invocation snapshot |
| `src/ingest/mod.ts`, `src/ingest/envelope.ts`, `site/src/lib/shared/types.ts` (modify) | Envelope fields |
| `cli/commands/bench/ingest-assembly.ts` (modify) | Per-attempt capture in `attemptToItem` |
| `deno.json` (modify) | `taxonomy-audit` task |
| `.github/workflows/*.yml` (modify) | Run `taxonomy-audit` beside `id-audit` |
| `.claude/skills/refresh-task-taxonomy/SKILL.md`, `CLAUDE.md` (modify) | Procedure and notes |
| Tests | `tests/unit/taxonomy/*.test.ts`, `tests/unit/ingest/capture.test.ts`, `tests/unit/ingest/envelope_test.ts` (extend), `tests/unit/cli/commands/sync-taxonomy.test.ts` |

---

### Task 1: Shared schema module - types, canonical JSON, digest

**Files:**
- Create: `site/src/lib/shared/taxonomy-schema.ts`
- Create: `site/src/lib/shared/fixtures/taxonomy-golden.json`
- Test: `tests/unit/taxonomy/schema-digest.test.ts`

**Interfaces:**
- Produces: `FormatSlug`, `FamilySlug`, `CatalogV2`, `SingleTaskEntry`, `CompositeTaskEntry`, `NormalizedCatalog`, `canonicalJson(value): string`, `catalogDigest(n: NormalizedCatalog): Promise<string>`, `SLUG_RE`, `FORMATS`, `FAMILIES`, `KNOWN_COHORTS`, `KNOWN_TEMPLATES`, `RETIRED_SLUGS`, `MECHANISM_VOCAB`, `INVARIANT_VOCAB`, `ENVIRONMENT_VOCAB`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/taxonomy/schema-digest.test.ts
import { assertEquals, assertThrows } from "@std/assert";
import {
  canonicalJson,
  catalogDigest,
  type NormalizedCatalog,
} from "../../../site/src/lib/shared/taxonomy-schema.ts";

const golden = JSON.parse(
  await Deno.readTextFile("site/src/lib/shared/fixtures/taxonomy-golden.json"),
) as { name: string; normalized: NormalizedCatalog; canonical: string; digest: string }[];

Deno.test("canonicalJson sorts keys at every depth and emits no whitespace", () => {
  const out = canonicalJson({ b: [{ z: 1, a: "é" }], a: null });
  assertEquals(out, '{"a":null,"b":[{"a":"é","z":1}]}');
});

Deno.test("canonicalJson rejects undefined and non-finite numbers", () => {
  assertThrows(() => canonicalJson({ a: undefined }));
  assertThrows(() => canonicalJson({ a: Number.NaN }));
});

Deno.test("golden vectors reproduce byte for byte", async () => {
  for (const g of golden) {
    assertEquals(canonicalJson(g.normalized), g.canonical, g.name);
    assertEquals(await catalogDigest(g.normalized), g.digest, g.name);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/taxonomy/schema-digest.test.ts`
Expected: FAIL with `Module not found` for `taxonomy-schema.ts`.

- [ ] **Step 3: Write the module**

```ts
// site/src/lib/shared/taxonomy-schema.ts
// Pure module: no runtime imports, no Deno or Node globals beyond Web Crypto
// and TextEncoder. Imported by the Deno pipeline, the CLI and the Worker.

export const FORMATS = [
  "build-from-spec",
  "runtime-trap",
  "diagnose-single",
  "diagnose-composite",
] as const;
export type FormatSlug = typeof FORMATS[number];

export const FAMILIES = ["mechanism", "invariant", "surface", "environment"] as const;
export type FamilySlug = typeof FAMILIES[number];

export const KNOWN_COHORTS = ["ado-trap-2026", "reasoning-100"] as const;
export const KNOWN_TEMPLATES = [
  "code-gen.md",
  "diagnose.md",
  "diagnose-objects.md",
  "diagnose-contract.md",
] as const;
export const DIAGNOSE_TEMPLATES = ["diagnose.md", "diagnose-objects.md", "diagnose-contract.md"] as const;
export const COMPOSITE_TEMPLATES = ["diagnose-objects.md", "diagnose-contract.md"] as const;

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const RETIRED_SLUGS = new Set([
  "diagnose", "composite", "multi-defect", "minimal-symptom", "calculations",
]);
export const isRetiredSlug = (s: string): boolean =>
  RETIRED_SLUGS.has(s) || /^defect-sites-\d+$/.test(s);

export const MECHANISM_VOCAB = [
  "tryfunction-write-rollback", "commit-scope", "error-flow",
  "filter-key-semantics", "filter-group-state", "temporary-record",
  "xrec-trigger-state", "event-binding", "event-order", "validation-trigger",
  "decimal-precision", "culture-format-roundtrip", "serialization-encoding",
  "company-scope", "permission-check", "flowfield-sift", "sql-cost-scaling",
  "single-instance-state", "recordref-reflection", "upgrade-datatransfer",
  "record-locking-concurrency",
] as const;
export const INVARIANT_VOCAB = [
  "largest-remainder-allocation", "reversal-conservation", "exact-total",
  "inclusive-boundary", "idempotent-rebuild", "company-isolation",
  "roundtrip-fidelity", "bounded-sql-cost",
] as const;
export const ENVIRONMENT_VOCAB = ["multi-company", "culture-sensitive", "test-permissions"] as const;

export interface CatalogGroup { slug: FormatSlug; name: string; description: string }
export interface CatalogFamily { slug: FamilySlug; name: string; description: string }
export interface CatalogTag {
  slug: string; family: FamilySlug; name: string; description: string;
  hidden_by_default?: boolean;
}
export interface CatalogAlias { from: string; to: string; note?: string }
export interface CatalogOverride { task: string; group: FormatSlug; rule: string; reason: string }
export interface SingleTaskEntry {
  group: Exclude<FormatSlug, "diagnose-composite">;
  facets: string[];
  min_bc_version: number;
}
export interface CompositeTaskEntry {
  group: "diagnose-composite";
  donors: string[];
  derived_facets: string[];
  local_facets: string[];
  min_bc_version: number;
}
export type TaskEntry = SingleTaskEntry | CompositeTaskEntry;
export interface CatalogV2 {
  schema_version: 2;
  groups: CatalogGroup[];
  families: CatalogFamily[];
  tags: CatalogTag[];
  aliases: CatalogAlias[];
  overrides: CatalogOverride[];
  tasks: Record<string, TaskEntry>;
}

export type FacetOrigin = "direct" | "derived" | "local";
export interface NormalizedTask {
  group: FormatSlug;
  facets: { slug: string; origin: FacetOrigin }[]; // sorted by slug
  donors: string[];                                 // ordinal order, [] for singles
  min_bc_version: number;
}
export interface NormalizedCatalog {
  schema_version: 2;
  task_set_hash: string;
  groups: CatalogGroup[];    // sorted by slug
  families: CatalogFamily[]; // sorted by slug
  tags: CatalogTag[];        // sorted by slug, hidden_by_default always present
  tasks: Record<string, NormalizedTask>; // keys sorted
}

export function isComposite(e: TaskEntry): e is CompositeTaskEntry {
  return e.group === "diagnose-composite";
}

/** Canonical JSON: keys sorted at every depth, no whitespace, NFC strings. */
export function canonicalJson(value: unknown): string {
  const ser = (v: unknown): string => {
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(v);
    }
    if (typeof v === "string") return JSON.stringify(v.normalize("NFC"));
    if (Array.isArray(v)) return "[" + v.map(ser).join(",") + "]";
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      const parts: string[] = [];
      for (const k of keys) {
        if (o[k] === undefined) throw new Error(`canonicalJson: undefined at "${k}"`);
        parts.push(JSON.stringify(k) + ":" + ser(o[k]));
      }
      return "{" + parts.join(",") + "}";
    }
    throw new Error(`canonicalJson: unsupported type ${typeof v}`);
  };
  return ser(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function catalogDigest(n: NormalizedCatalog): Promise<string> {
  return sha256Hex(canonicalJson(n));
}
```

- [ ] **Step 4: Create the golden fixture**

Write `site/src/lib/shared/fixtures/taxonomy-golden.json` with two entries: one single-only catalog and one with a composite, computed once with a throwaway Deno script and pasted verbatim. Generate with:

```bash
deno eval --allow-read '
import { canonicalJson, catalogDigest } from "./site/src/lib/shared/taxonomy-schema.ts";
const n = {
  schema_version: 2, task_set_hash: "a".repeat(64),
  groups: [{ slug: "diagnose-single", name: "Single-defect diagnose", description: "d" }],
  families: [{ slug: "mechanism", name: "Mechanism", description: "d" }],
  tags: [{ slug: "tryfunction-write-rollback", family: "mechanism", name: "TryFunction write rollback", description: "d", hidden_by_default: false }],
  tasks: { "CG-AL-X076": { group: "diagnose-single", facets: [{ slug: "tryfunction-write-rollback", origin: "direct" }], donors: [], min_bc_version: 17 } },
};
console.log(JSON.stringify([{ name: "single", normalized: n, canonical: canonicalJson(n), digest: await catalogDigest(n) }], null, 2));
'
```

Add a second entry `composite` with a `diagnose-composite` task whose `donors` is `["CG-AL-X076"]` and whose facets carry `origin: "derived"`, and a third entry `unicode` whose tag description contains `"é"` written as `é` (decomposed) to prove NFC normalization changes the bytes. Paste all three into the fixture.

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/taxonomy/schema-digest.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Type-check, lint, commit**

```bash
deno check site/src/lib/shared/taxonomy-schema.ts tests/unit/taxonomy/schema-digest.test.ts
deno lint tests/unit/taxonomy
git add site/src/lib/shared/taxonomy-schema.ts site/src/lib/shared/fixtures/taxonomy-golden.json tests/unit/taxonomy/schema-digest.test.ts
git commit -m "feat(taxonomy): shared catalog v2 types, canonical JSON and digest with golden vectors"
```

---

### Task 2: Shared schema module - validation and normalization

**Files:**
- Modify: `site/src/lib/shared/taxonomy-schema.ts`
- Test: `tests/unit/taxonomy/schema-validate.test.ts`

**Interfaces:**
- Produces: `ValidationIssue { code: string; where: string; message: string }`, `validateCatalog(c: unknown): ValidationIssue[]`, `normalizeCatalog(c: CatalogV2, taskSetHash: string): NormalizedCatalog`.
- Consumes: Task 1 types.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/taxonomy/schema-validate.test.ts
import { assertEquals } from "@std/assert";
import {
  type CatalogV2, normalizeCatalog, validateCatalog,
} from "../../../site/src/lib/shared/taxonomy-schema.ts";

function base(): CatalogV2 {
  return {
    schema_version: 2,
    groups: [
      { slug: "diagnose-single", name: "Single-defect diagnose", description: "d" },
      { slug: "diagnose-composite", name: "Composite diagnose", description: "d" },
    ],
    families: [
      { slug: "mechanism", name: "Mechanism", description: "d" },
      { slug: "surface", name: "AL surface", description: "d" },
    ],
    tags: [
      { slug: "tryfunction-write-rollback", family: "mechanism", name: "n", description: "d" },
      { slug: "codeunit", family: "surface", name: "n", description: "d", hidden_by_default: true },
      { slug: "table", family: "surface", name: "n", description: "d" },
    ],
    aliases: [{ from: "try-function", to: "tryfunction-write-rollback" }],
    overrides: [],
    tasks: {
      "CG-AL-X076": { group: "diagnose-single", facets: ["tryfunction-write-rollback", "codeunit"], min_bc_version: 17 },
      "CG-AL-X079": { group: "diagnose-single", facets: ["table"], min_bc_version: 16 },
      "CG-AL-X999": {
        group: "diagnose-composite",
        donors: ["CG-AL-X076", "CG-AL-X079", "CG-AL-X076A", "CG-AL-X079A"],
        derived_facets: ["codeunit", "table", "tryfunction-write-rollback"],
        local_facets: [],
        min_bc_version: 17,
      },
      "CG-AL-X076A": { group: "diagnose-single", facets: ["codeunit"], min_bc_version: 15 },
      "CG-AL-X079A": { group: "diagnose-single", facets: ["table"], min_bc_version: 15 },
    },
  };
}
const codes = (c: unknown) => validateCatalog(c).map((i) => i.code).sort();

Deno.test("a well-formed catalog has no issues", () => assertEquals(codes(base()), []));

Deno.test("unknown facet, bad slug, retired slug, missing description are reported", () => {
  const c = base();
  (c.tasks["CG-AL-X079"] as { facets: string[] }).facets.push("nope");
  c.tags.push({ slug: "Bad Slug", family: "surface", name: "n", description: "d" });
  c.tags.push({ slug: "calculations", family: "surface", name: "n", description: "d" });
  c.groups[0].description = "";
  const got = codes(c);
  for (const want of ["unknown_facet", "bad_slug", "retired_slug", "missing_description"]) {
    assertEquals(got.includes(want), true, want);
  }
});

Deno.test("composite rules: donor count, self donor, composite donor, derived mismatch, local overlap, version max", () => {
  const c = base();
  const comp = c.tasks["CG-AL-X999"] as Extract<CatalogV2["tasks"][string], { donors: string[] }>;
  comp.donors = ["CG-AL-X076", "CG-AL-X999", "CG-AL-X079"];      // self + only 3
  comp.derived_facets = ["codeunit"];                             // mismatch
  comp.local_facets = ["codeunit"];                               // overlap
  comp.min_bc_version = 16;                                       // max is 17
  const got = codes(c);
  for (const want of ["donor_count", "self_donor", "derived_mismatch", "local_overlap", "version_not_max"]) {
    assertEquals(got.includes(want), true, want);
  }
});

Deno.test("donors present iff composite", () => {
  const c = base();
  (c.tasks["CG-AL-X076"] as unknown as { donors: string[] }).donors = ["CG-AL-X079"];
  assertEquals(codes(c).includes("donors_on_single"), true);
});

Deno.test("normalize sorts keys, facets and vocab and stamps origins", () => {
  const n = normalizeCatalog(base(), "b".repeat(64));
  assertEquals(Object.keys(n.tasks), ["CG-AL-X076", "CG-AL-X076A", "CG-AL-X079", "CG-AL-X079A", "CG-AL-X999"]);
  assertEquals(n.tasks["CG-AL-X076"].facets, [
    { slug: "codeunit", origin: "direct" },
    { slug: "tryfunction-write-rollback", origin: "direct" },
  ]);
  assertEquals(n.tasks["CG-AL-X999"].facets.every((f) => f.origin === "derived"), true);
  assertEquals(n.tasks["CG-AL-X999"].donors, ["CG-AL-X076", "CG-AL-X079", "CG-AL-X076A", "CG-AL-X079A"]);
  assertEquals(n.tags.every((t) => typeof t.hidden_by_default === "boolean"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/taxonomy/schema-validate.test.ts`
Expected: FAIL, `validateCatalog` is not exported.

- [ ] **Step 3: Implement validation and normalization**

Append to `site/src/lib/shared/taxonomy-schema.ts`:

```ts
export interface ValidationIssue { code: string; where: string; message: string }

const VALID_GROUPS = new Set<string>(FORMATS);
const VALID_FAMILIES = new Set<string>(FAMILIES);

export function validateCatalog(c: unknown): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const issue = (code: string, where: string, message: string) => out.push({ code, where, message });
  if (!c || typeof c !== "object") return [{ code: "not_object", where: "$", message: "catalog is not an object" }];
  const cat = c as Partial<CatalogV2>;
  if (cat.schema_version !== 2) issue("bad_schema_version", "schema_version", "expected 2");
  const groups = cat.groups ?? [], families = cat.families ?? [], tags = cat.tags ?? [];
  const aliases = cat.aliases ?? [], overrides = cat.overrides ?? [], tasks = cat.tasks ?? {};

  const groupSlugs = new Set<string>();
  for (const g of groups) {
    if (!VALID_GROUPS.has(g.slug)) issue("unknown_group", `groups.${g.slug}`, "not a format slug");
    if (groupSlugs.has(g.slug)) issue("duplicate_slug", `groups.${g.slug}`, "duplicate");
    groupSlugs.add(g.slug);
    if (!g.name || !g.description) issue("missing_description", `groups.${g.slug}`, "name and description required");
  }
  const familySlugs = new Set<string>();
  for (const f of families) {
    if (!VALID_FAMILIES.has(f.slug)) issue("unknown_family", `families.${f.slug}`, "not a family slug");
    if (familySlugs.has(f.slug)) issue("duplicate_slug", `families.${f.slug}`, "duplicate");
    familySlugs.add(f.slug);
    if (!f.name || !f.description) issue("missing_description", `families.${f.slug}`, "name and description required");
  }
  const tagFamily = new Map<string, FamilySlug>();
  for (const t of tags) {
    if (!SLUG_RE.test(t.slug)) issue("bad_slug", `tags.${t.slug}`, "slug syntax");
    if (isRetiredSlug(t.slug)) issue("retired_slug", `tags.${t.slug}`, "retired from the facet namespace");
    if (!familySlugs.has(t.family)) issue("unknown_family", `tags.${t.slug}`, `family ${t.family} not declared`);
    if (tagFamily.has(t.slug)) issue("duplicate_slug", `tags.${t.slug}`, "duplicate");
    tagFamily.set(t.slug, t.family);
    if (!t.name || !t.description) issue("missing_description", `tags.${t.slug}`, "name and description required");
  }
  for (const a of aliases) {
    if (!tagFamily.has(a.to)) issue("alias_target_missing", `aliases.${a.from}`, `${a.to} is not a tag`);
  }
  for (const o of overrides) {
    if (!tasks[o.task]) issue("override_unknown_task", `overrides.${o.task}`, "no such task");
    if (!o.rule || !o.reason) issue("override_unjustified", `overrides.${o.task}`, "rule and reason required");
  }
  for (const [id, e] of Object.entries(tasks)) {
    const where = `tasks.${id}`;
    if (!groupSlugs.has(e.group)) issue("unknown_group", where, `group ${e.group} not declared`);
    if (typeof e.min_bc_version !== "number" || !Number.isInteger(e.min_bc_version)) {
      issue("missing_min_bc_version", where, "min_bc_version must be an integer");
    }
    const hasDonors = "donors" in e && Array.isArray((e as CompositeTaskEntry).donors) && (e as CompositeTaskEntry).donors.length > 0;
    if (isComposite(e)) {
      if (!hasDonors) issue("composite_without_donors", where, "composite needs donors");
      const donors = e.donors ?? [];
      if (donors.length < 4 || donors.length > 8) issue("donor_count", where, `expected 4..8 donors, got ${donors.length}`);
      if (new Set(donors).size !== donors.length) issue("duplicate_donor", where, "donors must be distinct");
      if (donors.includes(id)) issue("self_donor", where, "a task cannot donate to itself");
      const derived = new Set<string>();
      let maxVersion = -Infinity;
      for (const d of donors) {
        const donor = tasks[d];
        if (!donor) { issue("unresolved_donor", where, `${d} not in catalog`); continue; }
        if (donor.group !== "diagnose-single") issue("donor_not_single", where, `${d} is ${donor.group}`);
        for (const f of (donor as SingleTaskEntry).facets ?? []) derived.add(f);
        maxVersion = Math.max(maxVersion, donor.min_bc_version);
      }
      const want = [...derived].sort();
      const got = [...(e.derived_facets ?? [])].sort();
      if (JSON.stringify(want) !== JSON.stringify(got)) issue("derived_mismatch", where, `derived_facets must equal the donor union ${JSON.stringify(want)}`);
      for (const f of e.local_facets ?? []) {
        if (derived.has(f)) issue("local_overlap", where, `${f} is already derived`);
      }
      if (Number.isFinite(maxVersion) && e.min_bc_version !== maxVersion) {
        issue("version_not_max", where, `min_bc_version must be ${maxVersion}`);
      }
      for (const f of [...(e.derived_facets ?? []), ...(e.local_facets ?? [])]) {
        if (!tagFamily.has(f)) issue("unknown_facet", where, `${f} is not a tag`);
      }
    } else {
      if (hasDonors) issue("donors_on_single", where, "only composites carry donors");
      if ("derived_facets" in e || "local_facets" in e) issue("wrong_entry_form", where, "singles use facets");
      for (const f of (e as SingleTaskEntry).facets ?? []) {
        if (!tagFamily.has(f)) issue("unknown_facet", where, `${f} is not a tag`);
      }
    }
  }
  return out;
}

export function normalizeCatalog(c: CatalogV2, taskSetHash: string): NormalizedCatalog {
  const bySlug = <T extends { slug: string }>(xs: T[]) => [...xs].sort((a, b) => a.slug.localeCompare(b.slug));
  const tasks: Record<string, NormalizedTask> = {};
  for (const id of Object.keys(c.tasks).sort()) {
    const e = c.tasks[id];
    const facets: { slug: string; origin: FacetOrigin }[] = isComposite(e)
      ? [
        ...e.derived_facets.map((slug) => ({ slug, origin: "derived" as const })),
        ...e.local_facets.map((slug) => ({ slug, origin: "local" as const })),
      ]
      : e.facets.map((slug) => ({ slug, origin: "direct" as const }));
    facets.sort((a, b) => a.slug.localeCompare(b.slug));
    tasks[id] = { group: e.group, facets, donors: isComposite(e) ? [...e.donors] : [], min_bc_version: e.min_bc_version };
  }
  return {
    schema_version: 2,
    task_set_hash: taskSetHash,
    groups: bySlug(c.groups).map((g) => ({ slug: g.slug, name: g.name, description: g.description })),
    families: bySlug(c.families).map((f) => ({ slug: f.slug, name: f.name, description: f.description })),
    tags: bySlug(c.tags).map((t) => ({
      slug: t.slug, family: t.family, name: t.name, description: t.description,
      hidden_by_default: t.hidden_by_default === true,
    })),
    tasks,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-all tests/unit/taxonomy/`
Expected: PASS, both files.

- [ ] **Step 5: Add the vitest side of the golden vectors**

```ts
// site/src/lib/shared/taxonomy-schema.test.ts
import { describe, expect, it } from "vitest";
import golden from "./fixtures/taxonomy-golden.json";
import { canonicalJson, catalogDigest, validateCatalog } from "./taxonomy-schema";

describe("taxonomy-schema golden vectors", () => {
  it("reproduces canonical bytes and digests under Node", async () => {
    for (const g of golden as { name: string; normalized: never; canonical: string; digest: string }[]) {
      expect(canonicalJson(g.normalized), g.name).toBe(g.canonical);
      expect(await catalogDigest(g.normalized), g.name).toBe(g.digest);
    }
  });
  it("validateCatalog rejects a non-object", () => {
    expect(validateCatalog(null)[0].code).toBe("not_object");
  });
});
```

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/shared/taxonomy-schema.test.ts`
Expected: PASS. If `resolveJsonModule` is not enabled in `site/tsconfig.json`, import the fixture with `import { readFileSync } from "node:fs"` and `JSON.parse` instead.

- [ ] **Step 6: Commit**

```bash
deno check site/src/lib/shared/taxonomy-schema.ts && deno lint tests/unit/taxonomy
git add site/src/lib/shared/taxonomy-schema.ts site/src/lib/shared/taxonomy-schema.test.ts tests/unit/taxonomy/schema-validate.test.ts
git commit -m "feat(taxonomy): catalog v2 validation and normalization, shared by Deno and the Worker"
```

---

### Task 3: Task-donor graph module and the published fixture

**Files:**
- Create: `site/src/lib/shared/taxonomy-graph.ts`
- Create: `.claude/skills/refresh-task-taxonomy/pipeline/graph-fixture.ts`
- Test: `tests/unit/taxonomy/graph.test.ts`

**Interfaces:**
- Produces: `buildComponents(tasks: { id: string; donors: string[] }[]): GraphComponents` with `componentOf: Map<string, number>`, `sizes: number[]`, and `sliceStats(g: GraphComponents, sliceIds: string[]): { task_count, donor_count, component_count, effective_components, largest_component_share }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/taxonomy/graph.test.ts
import { assertEquals } from "@std/assert";
import { buildComponents, sliceStats } from "../../../site/src/lib/shared/taxonomy-graph.ts";

const tasks = [
  { id: "S1", donors: [] }, { id: "S2", donors: [] }, { id: "S3", donors: [] }, { id: "S4", donors: [] },
  { id: "C1", donors: ["S1", "S2"] }, { id: "C2", donors: ["S2", "S3"] },
];

Deno.test("composites and their donors share a component; untouched singles are their own", () => {
  const g = buildComponents(tasks);
  const c = (id: string) => g.componentOf.get(id);
  assertEquals(c("S1"), c("C1")); assertEquals(c("C1"), c("C2")); assertEquals(c("C2"), c("S3"));
  assertEquals(c("S4") !== c("S1"), true);
  assertEquals(g.sizes.slice().sort((a, b) => b - a), [5, 1]);
});

Deno.test("slice stats restrict components to the slice and count donors", () => {
  const g = buildComponents(tasks);
  const s = sliceStats(g, ["C1", "C2"]);                // composite slice
  assertEquals(s.task_count, 2); assertEquals(s.component_count, 1);
  assertEquals(s.donor_count, 3); assertEquals(s.largest_component_share, 1);
  const singles = sliceStats(g, ["S1", "S2", "S3", "S4"]);
  assertEquals(singles.component_count, 4);            // donor edges lead outside the slice
  assertEquals(singles.effective_components, 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/taxonomy/graph.test.ts` - FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// site/src/lib/shared/taxonomy-graph.ts
export interface GraphComponents {
  componentOf: Map<string, number>;
  sizes: number[];              // indexed by component id
  donorsOf: Map<string, string[]>;
}

export function buildComponents(tasks: { id: string; donors: string[] }[]): GraphComponents {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let y = x;
    while (parent.get(y) !== r) { const n = parent.get(y)!; parent.set(y, r); y = n; }
    return r;
  };
  const donorsOf = new Map<string, string[]>();
  for (const t of tasks) { parent.set(t.id, t.id); donorsOf.set(t.id, [...t.donors]); }
  for (const t of tasks) {
    for (const d of t.donors) {
      if (!parent.has(d)) continue;                     // donor outside the set: no edge
      parent.set(find(d), find(t.id));
    }
  }
  const roots = new Map<string, number>();
  const componentOf = new Map<string, number>();
  const sizes: number[] = [];
  for (const t of [...tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    const r = find(t.id);
    if (!roots.has(r)) { roots.set(r, sizes.length); sizes.push(0); }
    const cid = roots.get(r)!;
    componentOf.set(t.id, cid);
    sizes[cid]++;
  }
  return { componentOf, sizes, donorsOf };
}

export interface SliceStats {
  task_count: number; donor_count: number; component_count: number;
  effective_components: number; largest_component_share: number;
}

/** Components intersected with the slice; a donor edge that leaves the slice does not connect. */
export function sliceStats(g: GraphComponents, sliceIds: string[]): SliceStats {
  const inSlice = new Set(sliceIds);
  const sub = buildComponents(sliceIds.map((id) => ({
    id, donors: (g.donorsOf.get(id) ?? []).filter((d) => inSlice.has(d)),
  })));
  // Two slice members that share a donor OUTSIDE the slice are still connected through it.
  const byOutsideDonor = new Map<string, string[]>();
  for (const id of sliceIds) {
    for (const d of g.donorsOf.get(id) ?? []) {
      if (inSlice.has(d)) continue;
      byOutsideDonor.set(d, [...(byOutsideDonor.get(d) ?? []), id]);
    }
  }
  const merged = buildComponents(sliceIds.map((id) => {
    const viaOutside: string[] = [];
    for (const [, members] of byOutsideDonor) if (members.includes(id)) viaOutside.push(...members.filter((m) => m !== id));
    return { id, donors: [...new Set([...(g.donorsOf.get(id) ?? []).filter((d) => inSlice.has(d)), ...viaOutside])] };
  }));
  void sub;
  const sizes = merged.sizes;
  const n = sliceIds.length;
  const sumSq = sizes.reduce((s, x) => s + x * x, 0);
  const donors = new Set<string>();
  for (const id of sliceIds) for (const d of g.donorsOf.get(id) ?? []) donors.add(d);
  return {
    task_count: n,
    donor_count: donors.size,
    component_count: sizes.length,
    effective_components: sumSq === 0 ? 0 : (n * n) / sumSq,
    largest_component_share: n === 0 ? 0 : Math.max(...sizes) / n,
  };
}
```

Note the second `buildComponents` call is the one that counts: two composites in a slice that share a donor sitting outside the slice are still one component, because the shared defect is what creates the dependence. Remove the unused `sub` variable once the tests pass; it is there only to make the intent visible during review.

- [ ] **Step 4: Run tests**

Run: `deno test --allow-all tests/unit/taxonomy/graph.test.ts` - PASS.

- [ ] **Step 5: Fixture writer**

```ts
// .claude/skills/refresh-task-taxonomy/pipeline/graph-fixture.ts
// Usage: deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/graph-fixture.ts
import { parse } from "jsr:@std/yaml";
import { buildComponents, sliceStats } from "../../../../site/src/lib/shared/taxonomy-graph.ts";
import type { CatalogV2 } from "../../../../site/src/lib/shared/taxonomy-schema.ts";

const cat = parse(await Deno.readTextFile("site/catalog/task-categories.yml")) as CatalogV2;
const tasks = Object.entries(cat.tasks).map(([id, e]) => ({ id, donors: "donors" in e ? e.donors : [] }));
const g = buildComponents(tasks);
const byGroup = (slug: string) => Object.entries(cat.tasks).filter(([, e]) => e.group === slug).map(([id]) => id);
const fixture = {
  generated_from: "site/catalog/task-categories.yml",
  components: Object.fromEntries([...g.componentOf].sort()),
  sizes: g.sizes,
  slices: {
    all: sliceStats(g, tasks.map((t) => t.id)),
    "build-from-spec": sliceStats(g, byGroup("build-from-spec")),
    "runtime-trap": sliceStats(g, byGroup("runtime-trap")),
    "diagnose-single": sliceStats(g, byGroup("diagnose-single")),
    "diagnose-composite": sliceStats(g, byGroup("diagnose-composite")),
  },
};
await Deno.writeTextFile("docs/reasoning-suite/taxonomy-graph-fixture.json", JSON.stringify(fixture, null, 1) + "\n");
console.log(fixture.slices);
```

The fixture is regenerated in Task 9 once the v2 catalog exists.

- [ ] **Step 6: Commit**

```bash
deno check site/src/lib/shared/taxonomy-graph.ts .claude/skills/refresh-task-taxonomy/pipeline/graph-fixture.ts
git add site/src/lib/shared/taxonomy-graph.ts .claude/skills/refresh-task-taxonomy/pipeline/graph-fixture.ts tests/unit/taxonomy/graph.test.ts
git commit -m "feat(taxonomy): task-donor graph components, slice stats and fixture writer"
```

---

### Task 4: Format rules and the compatibility matrix

**Files:**
- Create: `.claude/skills/refresh-task-taxonomy/pipeline/format-rules.ts`
- Create: `tests/fixtures/taxonomy/manifests/` (four minimal YAML manifests)
- Test: `tests/unit/taxonomy/format-rules.test.ts`

**Interfaces:**
- Produces: `deriveFormat(m: ManifestFacts): { group: FormatSlug | null; violations: string[] }` where `ManifestFacts = { id: string; prompt_template: string; cohort?: string; donors: string[]; hasStarter: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/taxonomy/format-rules.test.ts
import { assertEquals } from "@std/assert";
import { deriveFormat } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/format-rules.ts";

const f = (over: Partial<Parameters<typeof deriveFormat>[0]>) =>
  deriveFormat({ id: "T", prompt_template: "code-gen.md", donors: [], hasStarter: false, ...over });

Deno.test("the four formats derive from manifest fields", () => {
  assertEquals(f({}).group, "build-from-spec");
  assertEquals(f({ cohort: "ado-trap-2026" }).group, "runtime-trap");
  assertEquals(f({ prompt_template: "diagnose.md", cohort: "reasoning-100", hasStarter: true }).group, "diagnose-single");
  assertEquals(f({ prompt_template: "diagnose-objects.md", cohort: "reasoning-100", hasStarter: true, donors: ["A", "B", "C", "D"] }).group, "diagnose-composite");
});

Deno.test("rule order: donors win over template, template wins over cohort", () => {
  assertEquals(f({ prompt_template: "diagnose.md", cohort: "ado-trap-2026", hasStarter: true }).group, "diagnose-single");
});

Deno.test("matrix violations are reported, never degraded", () => {
  assertEquals(f({ prompt_template: "weird.md" }).violations, ["unknown_template"]);
  assertEquals(f({ cohort: "typo-2026" }).violations, ["unknown_cohort"]);
  assertEquals(f({ prompt_template: "diagnose.md", cohort: "reasoning-100", hasStarter: false }).violations, ["starter_required"]);
  assertEquals(f({ cohort: "ado-trap-2026", hasStarter: true }).violations, ["starter_forbidden"]);
  assertEquals(f({ prompt_template: "diagnose.md", cohort: "reasoning-100", hasStarter: true, donors: ["A", "B", "C", "D"] }).violations, ["composite_template"]);
  assertEquals(f({ prompt_template: "code-gen.md", cohort: "reasoning-100" }).violations, ["cohort_mismatch"]);
});
```

- [ ] **Step 2: Run test to verify it fails** - FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// .claude/skills/refresh-task-taxonomy/pipeline/format-rules.ts
import {
  COMPOSITE_TEMPLATES, DIAGNOSE_TEMPLATES, type FormatSlug, KNOWN_COHORTS, KNOWN_TEMPLATES,
} from "../../../../site/src/lib/shared/taxonomy-schema.ts";

export interface ManifestFacts {
  id: string;
  prompt_template: string;
  cohort?: string;
  donors: string[];
  hasStarter: boolean;
}

export function deriveFormat(m: ManifestFacts): { group: FormatSlug | null; violations: string[] } {
  const v: string[] = [];
  const known = (KNOWN_TEMPLATES as readonly string[]).includes(m.prompt_template);
  if (!known) v.push("unknown_template");
  if (m.cohort !== undefined && !(KNOWN_COHORTS as readonly string[]).includes(m.cohort)) v.push("unknown_cohort");
  if (v.length) return { group: null, violations: v };

  const isDiagnose = (DIAGNOSE_TEMPLATES as readonly string[]).includes(m.prompt_template);
  let group: FormatSlug;
  if (m.donors.length > 0) group = "diagnose-composite";
  else if (isDiagnose) group = "diagnose-single";
  else if (m.cohort === "ado-trap-2026") group = "runtime-trap";
  else group = "build-from-spec";

  // Compatibility matrix (spec 4.1).
  switch (group) {
    case "diagnose-composite":
      if (!(COMPOSITE_TEMPLATES as readonly string[]).includes(m.prompt_template)) v.push("composite_template");
      if (m.cohort !== "reasoning-100") v.push("cohort_mismatch");
      if (m.donors.length < 4 || m.donors.length > 8) v.push("donor_count");
      if (!m.hasStarter) v.push("starter_required");
      break;
    case "diagnose-single":
      if (m.cohort !== "reasoning-100" && m.cohort !== "ado-trap-2026") v.push("cohort_mismatch");
      if (!m.hasStarter) v.push("starter_required");
      break;
    case "runtime-trap":
      if (m.prompt_template !== "code-gen.md") v.push("template_mismatch");
      if (m.hasStarter) v.push("starter_forbidden");
      break;
    case "build-from-spec":
      if (m.cohort !== undefined) v.push("cohort_mismatch");
      if (m.hasStarter) v.push("starter_forbidden");
      break;
  }
  return { group, violations: v };
}
```

- [ ] **Step 4: Run tests** - PASS.

- [ ] **Step 5: Manifest fixtures**

Create four files under `tests/fixtures/taxonomy/manifests/` mirroring real manifests, one per format, e.g. `CG-AL-H001.yml` (`prompt_template: code-gen.md`, no cohort, `metadata.tags: [table, calculations, rounding]`), `CG-AL-X001.yml` (`cohort: ado-trap-2026`, tags `[event-subscriber, try-function]`), `CG-AL-X076.yml` (`prompt_template: diagnose.md`, `cohort: reasoning-100`), `CG-AL-X283.yml` (`prompt_template: diagnose-objects.md`, `cohort: reasoning-100`, `metadata.donors: [CG-AL-X076, ...]` with eight donors). Also create empty starter marker directories `tests/fixtures/taxonomy/starter/CG-AL-X076/` and `.../CG-AL-X283/` containing a `.keep` file. These feed Tasks 5 and 6.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/refresh-task-taxonomy/pipeline/format-rules.ts tests/unit/taxonomy/format-rules.test.ts tests/fixtures/taxonomy
git commit -m "feat(taxonomy): format rules and compatibility matrix from manifest fields"
```

---

### Task 5: Alias table, YAML codec and the build step

**Files:**
- Create: `.claude/skills/refresh-task-taxonomy/pipeline/aliases.ts`
- Create: `.claude/skills/refresh-task-taxonomy/pipeline/catalog-yaml.ts`
- Rewrite: `.claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts`
- Test: `tests/unit/taxonomy/build.test.ts`

**Interfaces:**
- Produces: `SURFACE_ALIASES: Record<string, string | null>` (raw tag to surface slug, `null` = drop), `SURFACE_TAGS: CatalogTag[]`, `emitCatalogYaml(c: CatalogV2): string`, `parseCatalogYaml(text: string): CatalogV2`, `buildDraft(opts: { tasksDir: string; starterDir: string; previous?: CatalogV2 }): Promise<{ catalog: CatalogV2; violations: Record<string, string[]> }>`.
- Consumes: Tasks 1, 2, 4.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/taxonomy/build.test.ts
import { assertEquals } from "@std/assert";
import { buildDraft } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts";
import { emitCatalogYaml, parseCatalogYaml } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/catalog-yaml.ts";

const opts = { tasksDir: "tests/fixtures/taxonomy/manifests", starterDir: "tests/fixtures/taxonomy/starter" };

Deno.test("build assigns one format per fixture and maps raw tags through the alias table", async () => {
  const { catalog, violations } = await buildDraft(opts);
  assertEquals(violations, {});
  assertEquals(catalog.tasks["CG-AL-H001"].group, "build-from-spec");
  assertEquals(catalog.tasks["CG-AL-X001"].group, "runtime-trap");
  assertEquals(catalog.tasks["CG-AL-X076"].group, "diagnose-single");
  assertEquals(catalog.tasks["CG-AL-X283"].group, "diagnose-composite");
  // "calculations" is retired, "rounding" is not a surface: both dropped; "table" survives.
  assertEquals((catalog.tasks["CG-AL-H001"] as { facets: string[] }).facets, ["table"]);
  // try-function is a mechanism alias, so it leaves the surface facets of X001.
  assertEquals((catalog.tasks["CG-AL-X001"] as { facets: string[] }).facets.includes("try-function"), false);
});

Deno.test("YAML round-trips and is byte-deterministic", async () => {
  const { catalog } = await buildDraft(opts);
  const text = emitCatalogYaml(catalog);
  assertEquals(emitCatalogYaml(parseCatalogYaml(text)), text);
});
```

- [ ] **Step 2: Run test to verify it fails** - FAIL, modules not found.

- [ ] **Step 3: Alias table**

```ts
// .claude/skills/refresh-task-taxonomy/pipeline/aliases.ts
import type { CatalogTag } from "../../../../site/src/lib/shared/taxonomy-schema.ts";

/** raw manifest tag (lower-case) -> surface slug; null drops it; missing = drop too. */
export const SURFACE_ALIASES: Record<string, string | null> = {
  "table": "table", "tableextension": "table-extension", "table-extension": "table-extension",
  "enum": "enum", "enum-extension": "enum-extension", "interface": "interface",
  "page": "page", "api-page": "page", "pageextension": "page-extension", "page-extension": "page-extension",
  "pagecustomization": "page-customization", "customization": "page-customization",
  "report": "report", "dataset": "report", "query": "query", "query-object": "query", "xmlport": "xml",
  "codeunit": "codeunit", "permissionset": "permissionset",
  "flowfield": "flowfield", "calcformula": "flowfield", "flowfilter": "flowfilter",
  "sift": "sift-keys", "sift-keys": "sift-keys", "keys": "keys", "table-relation": "table-relation",
  "recordref": "recordref", "fieldref": "fieldref", "keyref": "fieldref", "variant": "variant", "datatransfer": "datatransfer",
  "event-subscriber": "event-subscriber", "eventsubscriber": "event-subscriber",
  "event-publisher": "event-publisher", "integration-event": "event-publisher", "business-event": "business-event",
  "errorinfo": "error-info", "collectible-errors": "collectible-errors",
  "json": "json", "xml": "xml", "http": "http", "httpclient": "http", "web-service": "web-service", "secrettext": "secrettext",
  "base64": "base64", "text-builder": "text-builder", "guid": "guid", "string-formatting": "string-formatting",
  "temporary-table": "temporary-table", "single-instance": "single-instance", "singleinstance": "single-instance",
  "install": "install", "upgrade-tag": "upgrade-tag", "test-codeunit": "test-codeunit", "test-page": "test-page",
  "factbox": "factbox", "system-part": "system-part", "systempart": "system-part", "page-action": "page-action",
  // mechanism-shaped raw tags: not surfaces, handled by enrichment; drop here.
  "try-function": null, "tryfunction": null, "transaction": null, "rollback": null, "commitbehavior": null,
  "rounding": null, "numeric-precision": null, "decimal-precision": null, "locking": null, "locktimeoutduration": null,
  "xrec": null, "filter-group": null, "filter": null, "permissions": null, "namespace": null,
  // retired / noise
  "calculations": null, "collections": null, "list": null, "generics": null, "codeunit-self-reference": null,
  "v15": null, "v16": null, "v17": null,   // become min_bc_version
};

const surfaceSlugs = [...new Set(Object.values(SURFACE_ALIASES).filter((v): v is string => v !== null))].sort();
const HIDDEN = new Set(["codeunit", "table", "page", "keys"]);
export const SURFACE_TAGS: CatalogTag[] = surfaceSlugs.map((slug) => ({
  slug, family: "surface",
  name: slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "),
  description: `A ${slug.replace(/-/g, " ")} is created, extended or exercised.`,
  ...(HIDDEN.has(slug) ? { hidden_by_default: true } : {}),
}));

/** min_bc_version from the raw version tags; 15 when none is present. */
export function minVersionFromTags(raw: string[]): number {
  const vs = raw.map((t) => /^v(1[5-9]|2\d)$/.exec(t.toLowerCase())?.[1]).filter((x): x is string => !!x).map(Number);
  return vs.length ? Math.max(...vs) : 15;
}
```

- [ ] **Step 4: YAML codec**

```ts
// .claude/skills/refresh-task-taxonomy/pipeline/catalog-yaml.ts
import { parse } from "jsr:@std/yaml";
import { type CatalogV2, isComposite } from "../../../../site/src/lib/shared/taxonomy-schema.ts";

const q = (s: string) => JSON.stringify(s);
const list = (xs: string[]) => `[${xs.join(", ")}]`;

/** Deterministic emitter: fixed section order, vocab sorted by slug, tasks sorted by id. */
export function emitCatalogYaml(c: CatalogV2): string {
  const bySlug = <T extends { slug: string }>(xs: T[]) => [...xs].sort((a, b) => a.slug.localeCompare(b.slug));
  let o = "# Task taxonomy, schema version 2. Authoritative for the SITE only.\n";
  o += "# NOT part of the task_set hash: editing this file and re-syncing never\n";
  o += "# invalidates a benchmark. Generated by the refresh-task-taxonomy pipeline;\n";
  o += "# hand-edit only the mechanism/invariant facets and the overrides.\n";
  o += "schema_version: 2\n\ngroups:\n";
  for (const g of bySlug(c.groups)) o += `  - slug: ${g.slug}\n    name: ${q(g.name)}\n    description: ${q(g.description)}\n`;
  o += "\nfamilies:\n";
  for (const f of bySlug(c.families)) o += `  - slug: ${f.slug}\n    name: ${q(f.name)}\n    description: ${q(f.description)}\n`;
  o += "\ntags:\n";
  for (const t of bySlug(c.tags)) {
    o += `  - slug: ${t.slug}\n    family: ${t.family}\n    name: ${q(t.name)}\n    description: ${q(t.description)}\n`;
    if (t.hidden_by_default) o += `    hidden_by_default: true\n`;
  }
  o += "\naliases:\n";
  for (const a of [...c.aliases].sort((x, y) => x.from.localeCompare(y.from))) {
    o += `  - { from: ${a.from}, to: ${a.to}${a.note ? `, note: ${q(a.note)}` : ""} }\n`;
  }
  o += "\noverrides:\n";
  if (c.overrides.length === 0) o += "  []\n";
  for (const ov of [...c.overrides].sort((x, y) => x.task.localeCompare(y.task))) {
    o += `  - { task: ${ov.task}, group: ${ov.group}, rule: ${q(ov.rule)}, reason: ${q(ov.reason)} }\n`;
  }
  o += "\ntasks:\n";
  for (const id of Object.keys(c.tasks).sort()) {
    const e = c.tasks[id];
    if (isComposite(e)) {
      o += `  ${id}:\n    group: ${e.group}\n    donors: ${list(e.donors)}\n    derived_facets: ${list(e.derived_facets)}\n    local_facets: ${list(e.local_facets)}\n    min_bc_version: ${e.min_bc_version}\n`;
    } else {
      o += `  ${id}:\n    group: ${e.group}\n    facets: ${list(e.facets)}\n    min_bc_version: ${e.min_bc_version}\n`;
    }
  }
  return o;
}

export function parseCatalogYaml(text: string): CatalogV2 {
  const doc = parse(text) as CatalogV2;
  doc.aliases ??= []; doc.overrides ??= [];
  for (const e of Object.values(doc.tasks)) {
    if (isComposite(e)) { e.derived_facets ??= []; e.local_facets ??= []; }
  }
  return doc;
}
```

- [ ] **Step 5: Rewrite build-taxonomy.ts**

Replace the whole file:

```ts
// .claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts
// Step 1 of the refresh: manifests -> draft catalog v2 (groups by rule,
// surface facets by alias table, min_bc_version, donors; mechanism and
// invariant facets are filled by the enrichment workflow and merge step).
// Usage: deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts [--out path]
import { parse } from "jsr:@std/yaml";
import { walk } from "jsr:@std/fs/walk";
import { exists } from "jsr:@std/fs/exists";
import {
  type CatalogV2, FAMILIES, FORMATS, type TaskEntry,
} from "../../../../site/src/lib/shared/taxonomy-schema.ts";
import { deriveFormat } from "./format-rules.ts";
import { minVersionFromTags, SURFACE_ALIASES, SURFACE_TAGS } from "./aliases.ts";
import { emitCatalogYaml, parseCatalogYaml } from "./catalog-yaml.ts";

const GROUP_TEXT: Record<string, [string, string]> = {
  "build-from-spec": ["Build from spec", "Write new AL objects from a behavioural specification."],
  "runtime-trap": ["Runtime trap", "Implement a compact requirement whose natural solution meets a Business Central runtime semantic."],
  "diagnose-single": ["Single-defect diagnose", "Repair a complete application with one planted defect, given a symptom."],
  "diagnose-composite": ["Composite diagnose", "Repair one application assembled from several donor applications with every defect live and no per-module symptom."],
};
const FAMILY_TEXT: Record<string, [string, string]> = {
  mechanism: ["Mechanism", "A Business Central runtime or language semantic the task turns on."],
  invariant: ["Invariant", "A domain contract the oracle grades independent of mechanism."],
  surface: ["AL surface", "AL objects and APIs the task touches."],
  environment: ["Environment", "Execution requirements: company scope, culture, permissions."],
};

interface Manifest { id?: string; prompt_template?: string; metadata?: { cohort?: string; donors?: string[]; tags?: string[] } }

export async function buildDraft(opts: { tasksDir: string; starterDir: string; previous?: CatalogV2 }) {
  const tasks: Record<string, TaskEntry> = {};
  const violations: Record<string, string[]> = {};
  for await (const e of walk(opts.tasksDir, { exts: [".yml"], includeDirs: false })) {
    const doc = parse(await Deno.readTextFile(e.path)) as Manifest;
    if (!doc.id) continue;
    const donors = doc.metadata?.donors ?? [];
    const hasStarter = await exists(`${opts.starterDir}/${doc.id}`);
    const { group, violations: v } = deriveFormat({
      id: doc.id, prompt_template: doc.prompt_template ?? "", cohort: doc.metadata?.cohort, donors, hasStarter,
    });
    if (v.length || !group) { violations[doc.id] = v; continue; }
    const raw = (doc.metadata?.tags ?? []).map((t) => t.toLowerCase());
    const surface = [...new Set(raw.map((t) => SURFACE_ALIASES[t] ?? null).filter((x): x is string => x !== null))].sort();
    const prev = opts.previous?.tasks[doc.id];
    const keep = prev && !("donors" in prev) ? prev.facets.filter((f) => !SURFACE_TAGS.some((s) => s.slug === f)) : [];
    const min_bc_version = minVersionFromTags(raw);
    if (group === "diagnose-composite") {
      tasks[doc.id] = { group, donors, derived_facets: [], local_facets: [], min_bc_version };
    } else {
      tasks[doc.id] = { group, facets: [...new Set([...surface, ...keep])].sort(), min_bc_version };
    }
  }
  const catalog: CatalogV2 = {
    schema_version: 2,
    groups: FORMATS.map((slug) => ({ slug, name: GROUP_TEXT[slug][0], description: GROUP_TEXT[slug][1] })),
    families: FAMILIES.map((slug) => ({ slug, name: FAMILY_TEXT[slug][0], description: FAMILY_TEXT[slug][1] })),
    tags: [...SURFACE_TAGS, ...(opts.previous?.tags.filter((t) => t.family !== "surface") ?? [])],
    aliases: Object.entries(SURFACE_ALIASES).filter(([k, v]) => v !== null && v !== k).map(([from, to]) => ({ from, to: to as string })),
    overrides: opts.previous?.overrides ?? [],
    tasks,
  };
  return { catalog, violations };
}

if (import.meta.main) {
  const out = Deno.args.includes("--out") ? Deno.args[Deno.args.indexOf("--out") + 1] : "site/catalog/task-categories.yml";
  let previous: CatalogV2 | undefined;
  try {
    const prev = parseCatalogYaml(await Deno.readTextFile(out));
    if (prev.schema_version === 2) previous = prev;   // keep mechanism/invariant facets and overrides across runs
  } catch { /* first run */ }
  const { catalog, violations } = await buildDraft({ tasksDir: "tasks", starterDir: "tasks/starter", previous });
  if (Object.keys(violations).length) {
    console.error("format rule violations:"); for (const [id, v] of Object.entries(violations)) console.error(`  ${id}: ${v.join(", ")}`);
    Deno.exit(1);
  }
  await Deno.writeTextFile(out, emitCatalogYaml(catalog));
  const counts: Record<string, number> = {};
  for (const e of Object.values(catalog.tasks)) counts[e.group] = (counts[e.group] ?? 0) + 1;
  console.log(`wrote ${out}`, counts);
}
```

Note the `previous` catalog is consulted so re-running the build after enrichment keeps mechanism, invariant and environment facets (which the alias table cannot produce) and the overrides. Derived facets of composites are recomputed by the merge step (Task 6).

- [ ] **Step 6: Run tests** - `deno test --allow-all tests/unit/taxonomy/build.test.ts` - PASS.

- [ ] **Step 7: Commit**

```bash
deno check .claude/skills/refresh-task-taxonomy/pipeline/*.ts
git add .claude/skills/refresh-task-taxonomy/pipeline/aliases.ts .claude/skills/refresh-task-taxonomy/pipeline/catalog-yaml.ts .claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts tests/unit/taxonomy/build.test.ts
git commit -m "feat(taxonomy): build step - format rules, surface alias table, deterministic catalog v2 YAML"
```

---

### Task 6: Merge step - enrichment merge and composite derivation

**Files:**
- Rewrite: `.claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts`
- Modify: `.claude/skills/refresh-task-taxonomy/pipeline/enrich-task-tags.workflow.js`
- Test: `tests/unit/taxonomy/merge.test.ts`

**Interfaces:**
- Produces: `mergeEnrichment(catalog: CatalogV2, enriched: Record<string, string[]>): CatalogV2` (adds mechanism, invariant and environment facets to singles, then derives every composite), `deriveComposites(catalog: CatalogV2): CatalogV2`.
- Consumes: Task 1 vocab constants, Task 5 codec.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/taxonomy/merge.test.ts
import { assertEquals } from "@std/assert";
import { buildDraft } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts";
import { mergeEnrichment } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts";
import { validateCatalog } from "../../../site/src/lib/shared/taxonomy-schema.ts";

const opts = { tasksDir: "tests/fixtures/taxonomy/manifests", starterDir: "tests/fixtures/taxonomy/starter" };

Deno.test("enrichment adds vocabulary facets to singles and composites derive the union", async () => {
  const { catalog } = await buildDraft(opts);
  // give every donor of X283 a facet so the union is observable
  const enriched: Record<string, string[]> = { "CG-AL-X076": ["tryfunction-write-rollback", "multi-company"], "CG-AL-H001": ["inclusive-boundary"] };
  for (const d of (catalog.tasks["CG-AL-X283"] as { donors: string[] }).donors) enriched[d] ??= ["exact-total"];
  const merged = mergeEnrichment(catalog, enriched);
  const x076 = merged.tasks["CG-AL-X076"] as { facets: string[] };
  assertEquals(x076.facets.includes("tryfunction-write-rollback"), true);
  assertEquals(x076.facets.includes("multi-company"), true);
  const comp = merged.tasks["CG-AL-X283"] as { derived_facets: string[]; min_bc_version: number };
  assertEquals(comp.derived_facets.includes("tryfunction-write-rollback"), true);
  assertEquals(comp.derived_facets.includes("exact-total"), true);
  assertEquals(merged.tags.some((t) => t.slug === "tryfunction-write-rollback" && t.family === "mechanism"), true);
  assertEquals(validateCatalog(merged).filter((i) => i.code !== "unresolved_donor" && i.code !== "donor_not_single"), []);
});

Deno.test("unknown enrichment slugs are refused, not silently dropped", async () => {
  const { catalog } = await buildDraft(opts);
  let threw = false;
  try { mergeEnrichment(catalog, { "CG-AL-X076": ["made-up"] }); } catch { threw = true; }
  assertEquals(threw, true);
});
```

(The fixture's eight donors of X283 do not all exist as fixture manifests, hence the two filtered codes in the first test; the real catalog has no such gap and Task 7's validator does not filter.)

- [ ] **Step 2: Run test to verify it fails** - FAIL.

- [ ] **Step 3: Rewrite merge-taxonomy.ts**

```ts
// .claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts
// Step 3 of the refresh: fold the enrichment workflow's mechanism/invariant/
// environment facets into the draft, then derive every composite.
// Usage: deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts [--enriched path] [--catalog path]
import {
  type CatalogTag, type CatalogV2, ENVIRONMENT_VOCAB, INVARIANT_VOCAB, isComposite, MECHANISM_VOCAB,
} from "../../../../site/src/lib/shared/taxonomy-schema.ts";
import { emitCatalogYaml, parseCatalogYaml } from "./catalog-yaml.ts";

const VOCAB_FAMILY = new Map<string, "mechanism" | "invariant" | "environment">([
  ...MECHANISM_VOCAB.map((s) => [s, "mechanism"] as const),
  ...INVARIANT_VOCAB.map((s) => [s, "invariant"] as const),
  ...ENVIRONMENT_VOCAB.map((s) => [s, "environment"] as const),
]);
const titleOf = (slug: string) => slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export function deriveComposites(c: CatalogV2): CatalogV2 {
  for (const e of Object.values(c.tasks)) {
    if (!isComposite(e)) continue;
    const union = new Set<string>();
    let max = 15;
    for (const d of e.donors) {
      const donor = c.tasks[d];
      if (!donor || isComposite(donor)) continue;      // the validator reports these
      for (const f of donor.facets) union.add(f);
      max = Math.max(max, donor.min_bc_version);
    }
    e.derived_facets = [...union].sort();
    e.local_facets = e.local_facets.filter((f) => !union.has(f)).sort();
    e.min_bc_version = max;
  }
  return c;
}

export function mergeEnrichment(catalog: CatalogV2, enriched: Record<string, string[]>): CatalogV2 {
  const c: CatalogV2 = structuredClone(catalog);
  const have = new Set(c.tags.map((t) => t.slug));
  for (const [id, slugs] of Object.entries(enriched)) {
    const e = c.tasks[id];
    if (!e || isComposite(e)) continue;                 // composites never take enrichment directly
    for (const s of slugs) {
      const fam = VOCAB_FAMILY.get(s);
      if (!fam) throw new Error(`enrichment for ${id} uses "${s}", not in the mechanism/invariant/environment vocabulary`);
      if (!have.has(s)) {
        const tag: CatalogTag = { slug: s, family: fam, name: titleOf(s), description: `${titleOf(s)} (${fam}).` };
        c.tags.push(tag); have.add(s);
      }
      if (!e.facets.includes(s)) e.facets.push(s);
    }
    e.facets.sort();
  }
  return deriveComposites(c);
}

if (import.meta.main) {
  const arg = (k: string, d: string) => Deno.args.includes(k) ? Deno.args[Deno.args.indexOf(k) + 1] : d;
  const catalogPath = arg("--catalog", "site/catalog/task-categories.yml");
  const enrichedPath = arg("--enriched", ".claude/skills/refresh-task-taxonomy/pipeline/enriched-tags.json");
  const catalog = parseCatalogYaml(await Deno.readTextFile(catalogPath));
  const enriched = JSON.parse(await Deno.readTextFile(enrichedPath)) as Record<string, string[]>;
  const merged = mergeEnrichment(catalog, enriched);
  await Deno.writeTextFile(catalogPath, emitCatalogYaml(merged));
  const n = Object.values(merged.tasks).filter((e) => !isComposite(e) && e.facets.some((f) => VOCAB_FAMILY.has(f))).length;
  console.log(`merged; ${n} singles carry a mechanism/invariant/environment facet; ${merged.tags.length} tags`);
}
```

Hand-written descriptions for the mechanism and invariant tags replace the generated `${titleOf(s)} (${fam}).` placeholder during the review in Task 9; the validator only requires a non-empty description.

- [ ] **Step 4: Update the enrichment workflow vocabulary**

In `enrich-task-tags.workflow.js` replace the `VOCAB` array with the three vocabularies (copy the slugs from `taxonomy-schema.ts` verbatim; a test in Step 6 asserts they match), update `description` to say all formats, and change the prompt sentence "assign every facet a BC dev would plausibly search by" to:

```
ASSIGN ONLY mechanism, invariant and environment facets: which Business Central runtime semantic the task turns on, which domain contract the hidden tests grade, and which execution requirement applies. Do NOT assign object-type surfaces (tables, pages, codeunits): those come from the manifest. A build-from-spec task grades invariants (boundaries, exact totals) as much as a diagnose task does; tag it the same way.
```

- [ ] **Step 5: Run tests** - PASS.

- [ ] **Step 6: Vocabulary parity test**

Append to `tests/unit/taxonomy/merge.test.ts`:

```ts
Deno.test("the enrichment workflow's VOCAB equals the shared vocabulary", async () => {
  const js = await Deno.readTextFile(".claude/skills/refresh-task-taxonomy/pipeline/enrich-task-tags.workflow.js");
  const m = /const VOCAB = \[([\s\S]*?)\];/.exec(js);
  const inJs = [...(m?.[1] ?? "").matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]).sort();
  const { MECHANISM_VOCAB, INVARIANT_VOCAB, ENVIRONMENT_VOCAB } = await import("../../../site/src/lib/shared/taxonomy-schema.ts");
  assertEquals(inJs, [...MECHANISM_VOCAB, ...INVARIANT_VOCAB, ...ENVIRONMENT_VOCAB].sort());
});
```

Run: `deno test --allow-all tests/unit/taxonomy/merge.test.ts` - PASS.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts .claude/skills/refresh-task-taxonomy/pipeline/enrich-task-tags.workflow.js tests/unit/taxonomy/merge.test.ts
git commit -m "feat(taxonomy): merge step - vocabulary enrichment and composite derivation by donor union"
```

---

### Task 7: Validator CLI, expected counts, CI wiring

**Files:**
- Create: `.claude/skills/refresh-task-taxonomy/pipeline/validate-taxonomy.ts`
- Create: `.claude/skills/refresh-task-taxonomy/pipeline/expected-counts.json`
- Modify: `deno.json` (add `taxonomy-audit` task)
- Modify: the workflow file that runs `deno task id-audit` (find with `grep -rn "id-audit" .github/workflows`; if none runs it, add a step to `.github/workflows/ci.yml` next to the unit tests)
- Test: `tests/unit/taxonomy/validate.test.ts`

**Interfaces:**
- Produces: `validateRepo(opts: { catalogPath; tasksDir; starterDir; expectedCountsPath }): Promise<{ issues: ValidationIssue[]; counts: Record<string, number> }>`; process exit 1 when `issues.length > 0`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/taxonomy/validate.test.ts
import { assertEquals } from "@std/assert";
import { validateRepo } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/validate-taxonomy.ts";
import { buildDraft } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts";
import { emitCatalogYaml } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/catalog-yaml.ts";

const opts = { tasksDir: "tests/fixtures/taxonomy/manifests", starterDir: "tests/fixtures/taxonomy/starter" };

async function tmpCatalog(mutate?: (text: string) => string): Promise<string> {
  const { catalog } = await buildDraft(opts);
  const dir = await Deno.makeTempDir();
  const text = emitCatalogYaml(catalog);
  await Deno.writeTextFile(`${dir}/cat.yml`, mutate ? mutate(text) : text);
  await Deno.writeTextFile(`${dir}/counts.json`, JSON.stringify({ "build-from-spec": 1, "runtime-trap": 1, "diagnose-single": 1, "diagnose-composite": 1 }));
  return dir;
}

Deno.test("a manifest missing from the catalog, and a catalog task missing from the manifests, are reported", async () => {
  const dir = await tmpCatalog((t) => t.replace(/  CG-AL-H001:[\s\S]*?min_bc_version: \d+\n/, ""));
  const { issues } = await validateRepo({ catalogPath: `${dir}/cat.yml`, ...opts, expectedCountsPath: `${dir}/counts.json` });
  assertEquals(issues.some((i) => i.code === "task_not_in_catalog"), true);
});

Deno.test("expected per-format counts are asserted", async () => {
  const dir = await tmpCatalog();
  await Deno.writeTextFile(`${dir}/counts.json`, JSON.stringify({ "build-from-spec": 7 }));
  const { issues } = await validateRepo({ catalogPath: `${dir}/cat.yml`, ...opts, expectedCountsPath: `${dir}/counts.json` });
  assertEquals(issues.some((i) => i.code === "count_mismatch"), true);
});
```

- [ ] **Step 2: Run test to verify it fails** - FAIL.

- [ ] **Step 3: Implement**

```ts
// .claude/skills/refresh-task-taxonomy/pipeline/validate-taxonomy.ts
// Exit 1 on any issue. Run by `deno task taxonomy-audit` and CI.
import { parse } from "jsr:@std/yaml";
import { walk } from "jsr:@std/fs/walk";
import { exists } from "jsr:@std/fs/exists";
import { validateCatalog, type ValidationIssue } from "../../../../site/src/lib/shared/taxonomy-schema.ts";
import { deriveFormat } from "./format-rules.ts";
import { parseCatalogYaml } from "./catalog-yaml.ts";

export async function validateRepo(o: { catalogPath: string; tasksDir: string; starterDir: string; expectedCountsPath: string }) {
  const issues: ValidationIssue[] = [];
  const catalog = parseCatalogYaml(await Deno.readTextFile(o.catalogPath));
  issues.push(...validateCatalog(catalog));

  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  for await (const e of walk(o.tasksDir, { exts: [".yml"], includeDirs: false })) {
    const doc = parse(await Deno.readTextFile(e.path)) as { id?: string; prompt_template?: string; metadata?: { cohort?: string; donors?: string[] } };
    if (!doc.id) continue;
    seen.add(doc.id);
    const { group, violations } = deriveFormat({
      id: doc.id, prompt_template: doc.prompt_template ?? "", cohort: doc.metadata?.cohort,
      donors: doc.metadata?.donors ?? [], hasStarter: await exists(`${o.starterDir}/${doc.id}`),
    });
    for (const v of violations) issues.push({ code: `manifest_${v}`, where: doc.id, message: `format rule violation: ${v}` });
    const entry = catalog.tasks[doc.id];
    const override = catalog.overrides.find((x) => x.task === doc.id);
    const want = override?.group ?? group;
    if (!entry) issues.push({ code: "task_not_in_catalog", where: doc.id, message: "manifest has no catalog entry" });
    else if (want && entry.group !== want) issues.push({ code: "group_mismatch", where: doc.id, message: `catalog says ${entry.group}, rules say ${want}` });
    if (want) counts[want] = (counts[want] ?? 0) + 1;
  }
  for (const id of Object.keys(catalog.tasks)) {
    if (!seen.has(id)) issues.push({ code: "catalog_task_without_manifest", where: id, message: "no manifest under tasks/" });
  }
  const expected = JSON.parse(await Deno.readTextFile(o.expectedCountsPath)) as Record<string, number>;
  for (const [g, n] of Object.entries(expected)) {
    if ((counts[g] ?? 0) !== n) issues.push({ code: "count_mismatch", where: g, message: `expected ${n}, found ${counts[g] ?? 0}` });
  }
  return { issues, counts };
}

if (import.meta.main) {
  const { issues, counts } = await validateRepo({
    catalogPath: "site/catalog/task-categories.yml", tasksDir: "tasks", starterDir: "tasks/starter",
    expectedCountsPath: ".claude/skills/refresh-task-taxonomy/pipeline/expected-counts.json",
  });
  console.log("per-format counts", counts);
  if (issues.length) {
    for (const i of issues) console.error(`[${i.code}] ${i.where}: ${i.message}`);
    console.error(`${issues.length} taxonomy issue(s)`);
    Deno.exit(1);
  }
  console.log("[OK] taxonomy valid");
}
```

Create `expected-counts.json` with the census the spec records: `{"build-from-spec": 110, "runtime-trap": 49, "diagnose-single": 110, "diagnose-composite": 29}`. Confirm the build-from-spec number against the real run in Task 9 (spec 4.1 gives 159 `code-gen.md` manifests minus 49 traps = 110) and adjust the file if the run shows otherwise, recording why in the commit message.

Add to `deno.json` tasks: `"taxonomy-audit": "deno run --allow-read .claude/skills/refresh-task-taxonomy/pipeline/validate-taxonomy.ts"`. Add a CI step running `deno task taxonomy-audit` immediately after the step that runs `deno task id-audit` (or after unit tests if no such step exists).

- [ ] **Step 4: Run tests** - PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/refresh-task-taxonomy/pipeline/validate-taxonomy.ts .claude/skills/refresh-task-taxonomy/pipeline/expected-counts.json deno.json .github/workflows tests/unit/taxonomy/validate.test.ts
git commit -m "feat(taxonomy): validator CLI with compatibility matrix and expected counts, wired into CI"
```

---

### Task 8: sync-taxonomy speaks version 2

**Files:**
- Modify: `cli/commands/sync-taxonomy-command.ts`
- Test: `tests/unit/cli/commands/sync-taxonomy.test.ts`

**Interfaces:**
- Produces: exported `buildV2Payload(catalog: CatalogV2, hash: string): Promise<{ payload: V2Payload; digest: string }>` where `V2Payload = { version: 2; hash: string; groups; families; tags; aliases; overrides; tasks }` (tasks in catalog form, not normalized; the server normalizes) and `readCatalogFile(path): Promise<{ schema_version: 1 | 2; raw: unknown }>`.
- Consumes: Task 1, 2 (`validateCatalog`, `normalizeCatalog`, `catalogDigest`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/cli/commands/sync-taxonomy.test.ts
import { assertEquals, assertRejects } from "@std/assert";
import { buildV2Payload, readCatalogFile } from "../../../../cli/commands/sync-taxonomy-command.ts";
import { parseCatalogYaml } from "../../../../.claude/skills/refresh-task-taxonomy/pipeline/catalog-yaml.ts";
import { buildDraft } from "../../../../.claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts";
import { emitCatalogYaml } from "../../../../.claude/skills/refresh-task-taxonomy/pipeline/catalog-yaml.ts";
import { catalogDigest, normalizeCatalog } from "../../../../site/src/lib/shared/taxonomy-schema.ts";

Deno.test("readCatalogFile reports schema_version and refuses unknown versions", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/v3.yml`, "schema_version: 3\n");
  await assertRejects(() => readCatalogFile(`${dir}/v3.yml`), Error, "schema_version 3");
  await Deno.writeTextFile(`${dir}/v1.yml`, "groups: []\ntags: []\ntasks: {}\n");
  assertEquals((await readCatalogFile(`${dir}/v1.yml`)).schema_version, 1);
});

Deno.test("v2 payload carries the hash and the digest of the normalized catalog", async () => {
  const { catalog } = await buildDraft({ tasksDir: "tests/fixtures/taxonomy/manifests", starterDir: "tests/fixtures/taxonomy/starter" });
  const parsed = parseCatalogYaml(emitCatalogYaml(catalog));
  const hash = "c".repeat(64);
  const { payload, digest } = await buildV2Payload(parsed, hash);
  assertEquals(payload.version, 2);
  assertEquals(payload.hash, hash);
  assertEquals(digest, await catalogDigest(normalizeCatalog(parsed, hash)));
});
```

- [ ] **Step 2: Run test to verify it fails** - FAIL.

- [ ] **Step 3: Implement**

In `sync-taxonomy-command.ts` add the imports and exported helpers, and change the apply path:

```ts
import { parse as parseYaml } from "jsr:@std/yaml@^1.1.0";
import {
  type CatalogV2, catalogDigest, normalizeCatalog, validateCatalog,
} from "../../site/src/lib/shared/taxonomy-schema.ts";

export interface V2Payload {
  version: 2; hash: string;
  groups: CatalogV2["groups"]; families: CatalogV2["families"]; tags: CatalogV2["tags"];
  aliases: CatalogV2["aliases"]; overrides: CatalogV2["overrides"]; tasks: CatalogV2["tasks"];
}

export async function readCatalogFile(path: string): Promise<{ schema_version: 1 | 2; raw: unknown }> {
  const raw = parseYaml(await Deno.readTextFile(path)) as { schema_version?: number } | null;
  if (!raw || typeof raw !== "object") throw new Error(`${path} is not a YAML object`);
  const v = raw.schema_version ?? 1;
  if (v !== 1 && v !== 2) throw new Error(`${path}: schema_version ${v} is not supported by this CLI; upgrade centralgauge`);
  return { schema_version: v, raw };
}

export async function buildV2Payload(catalog: CatalogV2, hash: string): Promise<{ payload: V2Payload; digest: string }> {
  const issues = validateCatalog(catalog);
  if (issues.length) throw new Error(`catalog invalid: ${issues.map((i) => `[${i.code}] ${i.where}`).join("; ")}`);
  const digest = await catalogDigest(normalizeCatalog(catalog, hash));
  return {
    payload: {
      version: 2, hash, groups: catalog.groups, families: catalog.families, tags: catalog.tags,
      aliases: catalog.aliases ?? [], overrides: catalog.overrides ?? [], tasks: catalog.tasks,
    },
    digest,
  };
}
```

In `handleSyncTaxonomy`: after reading the file with `readCatalogFile`, branch on `schema_version`. For version 1 keep the existing behaviour untouched. For version 2:

```ts
if (schema_version === 2) {
  if (options.apply && !options.hash) {
    console.error(colors.red("[FAIL] --apply with a schema_version 2 catalog requires --hash <64-hex> (no auto-discovery; see spec 5.2)"));
    Deno.exit(1);
  }
  const hash = options.hash ?? "0".repeat(64);            // dry run only
  const { payload, digest } = await buildV2Payload(raw as CatalogV2, hash);
  console.log(colors.gray(`[INFO] schema 2: ${payload.groups.length} groups, ${payload.families.length} families, ${payload.tags.length} tags, ${Object.keys(payload.tasks).length} tasks; hash ${hash}; digest ${digest}`));
  if (!options.apply) { console.log(colors.yellow("[DRY] pass --apply --hash <hash> to POST")); return; }
  const config = await loadAdminConfig(cwd, flags);
  const adminPriv = await readPrivateKey(config.adminKeyPath);
  const sig = await signPayload(payload as unknown as Record<string, unknown>, adminPriv, config.adminKeyId);
  const resp = await postWithRetry(`${config.url}/api/v1/admin/catalog/task-taxonomy`, { version: 2, signature: sig, payload }, { maxAttempts: 3 });
  const body = await resp.text();
  console.log(`${resp.ok ? colors.green(`[${resp.status}]`) : colors.red(`[${resp.status}]`)} ${body}`);
  console.log(colors.gray(`[INFO] expected server digest ${digest}`));
  if (!resp.ok) Deno.exit(1);
  return;
}
```

Also add the `--allow-non-current` flag to the command definition (passed through in the payload as `allow_non_current: true`; the server side is Plan B).

- [ ] **Step 4: Run tests** - PASS. Also run the existing `tests/unit/cli/commands/*.test.ts` to confirm nothing else broke.

- [ ] **Step 5: Commit**

```bash
deno check cli/commands/sync-taxonomy-command.ts
git add cli/commands/sync-taxonomy-command.ts tests/unit/cli/commands/sync-taxonomy.test.ts
git commit -m "feat(cli): sync-taxonomy emits version-2 payloads with digest and requires an explicit hash to apply"
```

---

### Task 9: Generate catalog v2 for the repository and review the analytic facets

This task is operational; its acceptance is the validator and the counts.

**Files:**
- Modify: `site/catalog/task-categories.yml` (replaced by the v2 file)
- Create: `docs/reasoning-suite/taxonomy-graph-fixture.json`
- Modify: `.claude/skills/refresh-task-taxonomy/SKILL.md` (procedure)

- [ ] **Step 1: Build the draft**

```bash
deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts
```

Expected: no format-rule violations; counts printed. If a manifest violates the matrix, do not edit it; add a justified entry to `overrides:` only if the task is genuinely an exception, otherwise fix the pipeline and note it.

- [ ] **Step 2: Run the enrichment workflow over every task**

Follow `.claude/skills/refresh-task-taxonomy/SKILL.md` step 2 with the updated workflow, passing all manifest paths (all formats). Save its `taskTags` to `.claude/skills/refresh-task-taxonomy/pipeline/enriched-tags.json`. Inspect `vocabGaps`; if a gap recurs on three or more tasks, decide with the owner whether to add it to the vocabulary (a code change in `taxonomy-schema.ts` plus the workflow list), never ad hoc.

- [ ] **Step 3: Merge and validate**

```bash
deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts
deno task taxonomy-audit
```

Expected: `[OK] taxonomy valid` and counts `{ build-from-spec: 110, runtime-trap: 49, diagnose-single: 110, diagnose-composite: 29 }` (adjust `expected-counts.json` only if the real census differs and say why in the commit).

- [ ] **Step 4: Hand review of mechanism and invariant facets**

Review every `diagnose-single` and `runtime-trap` task's mechanism and invariant facets against its manifest and oracle (this is the analytic core; spec 4.2). Use the survival table as a sanity check: X076 must carry `tryfunction-write-rollback`, X074 `filter-key-semantics`, X140 `largest-remainder-allocation`, X170 `reversal-conservation`, X114 `inclusive-boundary`. Replace the generated tag descriptions of mechanism and invariant tags with one-sentence definitions. Re-run the merge (composites re-derive) and the audit after edits.

- [ ] **Step 5: Determinism and fixture**

```bash
cp site/catalog/task-categories.yml /tmp/cat-a.yml
deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts
deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts
cmp /tmp/cat-a.yml site/catalog/task-categories.yml && echo deterministic
deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/graph-fixture.ts
```

Expected: `deterministic`; the fixture reports one 80-task component and the slice numbers in spec 6.4 (composite slice 1 component, single-defect 110, all 219).

- [ ] **Step 6: Update SKILL.md**

Rewrite the procedure section of `.claude/skills/refresh-task-taxonomy/SKILL.md` to the five commands above, state that the catalog is schema version 2, that `metadata.category` in task files is frozen and ignored, and that a new batch must run build, enrichment for the new tasks only, merge, audit before promotion.

- [ ] **Step 7: Commit**

```bash
git add site/catalog/task-categories.yml docs/reasoning-suite/taxonomy-graph-fixture.json .claude/skills/refresh-task-taxonomy/SKILL.md .claude/skills/refresh-task-taxonomy/pipeline/enriched-tags.json .claude/skills/refresh-task-taxonomy/pipeline/expected-counts.json
git commit -m "feat(taxonomy): catalog v2 for all 298 tasks, reviewed analytic facets, published graph fixture"
```

---

### Task 10: Harness fingerprint and retry-path version as library code

**Files:**
- Create: `src/utils/harness-fingerprint.ts`
- Modify: `scripts/gold-ci.ts` (import instead of local copy)
- Modify: `src/llm/prompt-building.ts` (export `RETRY_PATH_VERSION`)
- Test: `tests/unit/utils/harness-fingerprint.test.ts`

**Interfaces:**
- Produces: `HARNESS_INPUTS: readonly string[]`, `harnessFingerprint(root = "."): Promise<string>` (64-hex; the same per-file framing and LF normalization gold-ci uses), `RETRY_PATH_VERSION = "rp2-overlay-2026-09-01"`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/utils/harness-fingerprint.test.ts
import { assertEquals, assertMatch } from "@std/assert";
import { HARNESS_INPUTS, harnessFingerprint } from "../../../src/utils/harness-fingerprint.ts";

Deno.test("fingerprint is 64 hex and stable across CRLF/LF", async () => {
  const a = await harnessFingerprint(".");
  assertMatch(a, /^[0-9a-f]{64}$/);
  const dir = await Deno.makeTempDir();
  for (const p of HARNESS_INPUTS) {
    await Deno.mkdir(`${dir}/${p.split("/").slice(0, -1).join("/")}`, { recursive: true });
    await Deno.writeTextFile(`${dir}/${p}`, (await Deno.readTextFile(p)).replace(/\r?\n/g, "\r\n"));
  }
  assertEquals(await harnessFingerprint(dir), a);
});
```

- [ ] **Step 2: Run test to verify it fails** - FAIL.

- [ ] **Step 3: Implement by moving the code**

Move `HARNESS_INPUTS` and `sha256Of` from `scripts/gold-ci.ts` (lines 57-64 and 85 onward) into `src/utils/harness-fingerprint.ts` as `export const HARNESS_INPUTS` and `export async function harnessFingerprint(root = ".")` (prefix each path with `root`), keeping the per-file framing and LF normalization exactly. In `gold-ci.ts` replace the local definitions with `import { HARNESS_INPUTS, harnessFingerprint } from "../src/utils/harness-fingerprint.ts";` and call `harnessFingerprint()` where `sha256Of(HARNESS_INPUTS)` was called. In `src/llm/prompt-building.ts` add `export const RETRY_PATH_VERSION = "rp2-overlay-2026-09-01";` next to `FIX_PROMPT_PREVIOUS_CODE_CAP` with a comment naming the 2026-09-01 retry fix.

- [ ] **Step 4: Run tests and gold-ci check**

```bash
deno test --allow-all tests/unit/utils/harness-fingerprint.test.ts
deno run --allow-all scripts/gold-ci.ts --check | tail -3
```

Expected: PASS; gold-ci prints the same fingerprint as before the refactor (`0634e0ee1c1c` prefix as of 2026-09-02) and 273 trusted.

- [ ] **Step 5: Commit**

```bash
git add src/utils/harness-fingerprint.ts scripts/gold-ci.ts src/llm/prompt-building.ts tests/unit/utils/harness-fingerprint.test.ts
git commit -m "refactor: harness fingerprint as library code; export the retry-path version"
```

---

### Task 11: Per-attempt capture in the ingest envelope

**Files:**
- Create: `src/ingest/capture.ts`
- Modify: `src/ingest/mod.ts` (`BenchResultItem`), `site/src/lib/shared/types.ts` (`ResultInput`), `cli/commands/bench/ingest-assembly.ts` (`attemptToItem`)
- Test: `tests/unit/ingest/capture.test.ts`

**Interfaces:**
- Produces: `TerminationKind = "response" | "provider_error" | "cap_reached" | "refusal" | "infra_exhausted" | "cancelled"`, `terminationKind(a: ExecutionAttempt): TerminationKind`, `testVector(a: ExecutionAttempt, taskId: string): Promise<{ id: string; name: string; passed: boolean }[]>` (id = first 16 hex of sha256(`${taskId}\n${name}`)), `sha256Hex(text)` re-exported from the shared module.
- New optional `ResultInput` fields: `test_vector`, `termination_kind`, `provider_finish_reason`, `cap_reached`, `infra_retries`, `infra_exhaustion_reason`, `fallback_chain`, `prompt_sha256`, `candidate_sha256`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/ingest/capture.test.ts
import { assertEquals } from "@std/assert";
import { terminationKind, testVector } from "../../../src/ingest/capture.ts";
import { createMockExecutionAttempt, createMockLLMResponse } from "../../utils/test-helpers.ts";

Deno.test("termination kind follows finish reason, refusal and infra state", () => {
  const ok = createMockExecutionAttempt({ llmResponse: createMockLLMResponse({ finishReason: "stop" }) });
  assertEquals(terminationKind(ok), "response");
  const cap = createMockExecutionAttempt({ llmResponse: createMockLLMResponse({ finishReason: "length" }) });
  assertEquals(terminationKind(cap), "cap_reached");
  const err = createMockExecutionAttempt({ llmResponse: createMockLLMResponse({ finishReason: "error" }) });
  assertEquals(terminationKind(err), "provider_error");
  const refused = createMockExecutionAttempt({ llmResponse: createMockLLMResponse({ finishReason: "content_filter", refusal: { category: "cyber", recovered: false } }) });
  assertEquals(terminationKind(refused), "refusal");
  const infra = createMockExecutionAttempt({ infraRetryExhaustionReason: "budget_exhausted" } as never);
  assertEquals(terminationKind(infra), "infra_exhausted");
});

Deno.test("test vector carries stable ids in oracle order", async () => {
  const a = createMockExecutionAttempt({
    testResult: { success: false, totalTests: 2, passedTests: 1, failedTests: 1, duration: 1, output: "",
      results: [{ name: "X076_ParseAmountAcceptsZero", passed: true, duration: 1 }, { name: "X140_ZeroWeight", passed: false, duration: 1 }] },
  });
  const v = await testVector(a, "CG-AL-X283");
  assertEquals(v.map((x) => x.name), ["X076_ParseAmountAcceptsZero", "X140_ZeroWeight"]);
  assertEquals(v[0].id.length, 16);
  assertEquals(v[0].id, (await testVector(a, "CG-AL-X283"))[0].id);
  assertEquals(v[0].id !== (await testVector(a, "CG-AL-X999"))[0].id, true);
});
```

Check `tests/utils/test-helpers.ts` exports `createMockExecutionAttempt` and `createMockLLMResponse` (they exist per `.claude/rules/testing-patterns.md`); if `createMockLLMResponse` does not accept `finishReason`, extend the factory's `Partial<LLMResponse>` override.

- [ ] **Step 2: Run test to verify it fails** - FAIL.

- [ ] **Step 3: Implement capture.ts**

```ts
// src/ingest/capture.ts
import type { ExecutionAttempt } from "../tasks/interfaces.ts";
import { sha256Hex } from "../../site/src/lib/shared/taxonomy-schema.ts";

export type TerminationKind = "response" | "provider_error" | "cap_reached" | "refusal" | "infra_exhausted" | "cancelled";

export function terminationKind(a: ExecutionAttempt): TerminationKind {
  const infra = (a as { infraRetryExhaustionReason?: string }).infraRetryExhaustionReason;
  if (infra) return "infra_exhausted";
  const r = a.llmResponse;
  if (r.refusal && !r.refusal.recovered) return "refusal";
  switch (r.finishReason) {
    case "length": return "cap_reached";
    case "error": return "provider_error";
    case "content_filter": return "refusal";
    default: return "response";
  }
}

export async function testVector(a: ExecutionAttempt, taskId: string) {
  const out: { id: string; name: string; passed: boolean }[] = [];
  for (const t of a.testResult?.results ?? []) {
    out.push({ id: (await sha256Hex(`${taskId}\n${t.name}`)).slice(0, 16), name: t.name, passed: t.passed });
  }
  return out;
}

export async function optionalSha(text: string | undefined): Promise<string | undefined> {
  return text === undefined ? undefined : await sha256Hex(text);
}
export { sha256Hex };
```

- [ ] **Step 4: Extend the item and input types**

In `src/ingest/mod.ts` `BenchResultItem` and in `site/src/lib/shared/types.ts` `ResultInput` add (all optional, documented as "absent on CLIs predating 2026-09"):

```ts
  test_vector?: { id: string; name: string; passed: boolean }[];
  termination_kind?: "response" | "provider_error" | "cap_reached" | "refusal" | "infra_exhausted" | "cancelled";
  provider_finish_reason?: string;
  cap_reached?: boolean;
  infra_retries?: number;
  infra_exhaustion_reason?: string | null;
  fallback_chain?: string[];
  prompt_sha256?: string;
  candidate_sha256?: string;
```

- [ ] **Step 5: Populate in attemptToItem**

`attemptToItem` becomes `async` (its caller in `assembleBenchResultsForVariant` awaits it; update that call site) and adds, before `return`:

```ts
  const vector = await testVector(a, taskId);
  const infraRetries = (a as { infraRetries?: unknown[] }).infraRetries?.length ?? 0;
  const exhaustion = (a as { infraRetryExhaustionReason?: string }).infraRetryExhaustionReason ?? null;
```

and in the returned object:

```ts
    test_vector: vector,
    termination_kind: terminationKind(a),
    provider_finish_reason: a.llmResponse.finishReason,
    cap_reached: a.llmResponse.finishReason === "length",
    infra_retries: infraRetries,
    infra_exhaustion_reason: exhaustion,
    fallback_chain: a.llmResponse.servedModel ? [a.llmResponse.model, a.llmResponse.servedModel] : [a.llmResponse.model],
    prompt_sha256: await sha256Hex(a.prompt),
    candidate_sha256: await optionalSha(a.candidateCode ?? a.extractedCode),
```

Extend `tests/unit/ingest/ingest-assembly-identity.test.ts` (or add `ingest-assembly-capture.test.ts`) with one assertion that an assembled item carries `termination_kind: "response"`, a `test_vector` of the attempt's test count, and 64-hex `prompt_sha256`.

- [ ] **Step 6: Run tests**

```bash
deno test --allow-all tests/unit/ingest/
```

Expected: PASS, including `envelope_test.ts` unchanged (the envelope passes results through as-is).

- [ ] **Step 7: Commit**

```bash
deno check src/ingest/capture.ts cli/commands/bench/ingest-assembly.ts src/ingest/mod.ts
git add src/ingest/capture.ts src/ingest/mod.ts site/src/lib/shared/types.ts cli/commands/bench/ingest-assembly.ts tests/unit/ingest
git commit -m "feat(ingest): per-attempt capture - test vector, termination kind, cap, infra, fallback chain, prompt and candidate digests"
```

---

### Task 12: Per-run capture - environment manifest and invocation snapshot

**Files:**
- Modify: `src/ingest/capture.ts` (add `buildEnvironmentManifest`, `invocationSnapshot`)
- Modify: `src/ingest/envelope.ts` (`BuildPayloadInput` and `buildPayload`)
- Modify: `src/ingest/mod.ts` (`BenchResults` fields and `payloadInput` assembly; upload the manifest as a blob)
- Modify: `cli/commands/bench/ingest-assembly.ts` (`AssembleOptions` gains the run-level facts; `assembleBenchResultsForVariant` threads them)
- Modify: the bench command that calls `assembleBenchResultsForVariant` (find with `grep -rn "assembleBenchResultsForVariant" cli`) to collect the facts once per run
- Test: `tests/unit/ingest/envelope_test.ts` (extend), `tests/unit/ingest/capture-run.test.ts`

**Interfaces:**
- Produces: `EnvironmentManifest { bc_artifact: string | null; container_image_digest: string | null; bcch_version: string; test_runner: "soap" | "legacy"; host_os: string; centralgauge_sha: string | null; dirty_tree: boolean; harness_fingerprint: string; retry_path_version: string; prompt_policy_version: string; prompt_template_digest: string; culture: string | null }`, `buildEnvironmentManifest(opts: { containerName: string; cwd: string; inspect?: typeof inspectContainer }): Promise<EnvironmentManifest>`, `invocationSnapshot(cfg: { provider: string; model: string; apiModelId: string; baseUrl?: string; maxTokens?: number; temperature?: number; reasoning?: unknown }): Record<string, unknown>`.
- New payload fields written by `buildPayload`: `harness_fingerprint`, `retry_path_version`, `environment_sha256`, `bc_artifact`, `container_image_digest`, `bcch_version`, `test_runner`, `prompt_template_digest`, `invocation`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/ingest/capture-run.test.ts
import { assertEquals, assertMatch } from "@std/assert";
import { buildEnvironmentManifest, invocationSnapshot } from "../../../src/ingest/capture.ts";

Deno.test("environment manifest reads the pinned BCH version, the runner knob and the harness fingerprint", async () => {
  const fakeInspect = () => Promise.resolve({ imageDigest: "sha256:abc", artifactUrl: "https://bcartifacts/onprem/28.4/w1?sv=1", env: {} } as never);
  Deno.env.set("CENTRALGAUGE_SOAP_TEST_RUNNER", "0");
  const m = await buildEnvironmentManifest({ containerName: "Cronus28", cwd: ".", inspect: fakeInspect });
  Deno.env.delete("CENTRALGAUGE_SOAP_TEST_RUNNER");
  assertEquals(m.bcch_version, "6.1.14");
  assertEquals(m.test_runner, "legacy");
  assertEquals(m.bc_artifact, "https://bcartifacts/onprem/28.4/w1");   // query string stripped
  assertEquals(m.container_image_digest, "sha256:abc");
  assertMatch(m.harness_fingerprint, /^[0-9a-f]{64}$/);
  assertMatch(m.prompt_template_digest, /^[0-9a-f]{64}$/);
});

Deno.test("invocation snapshot never carries secrets and keeps the host only", () => {
  const s = invocationSnapshot({ provider: "openrouter", model: "z-ai/glm-5.3", apiModelId: "z-ai/glm-5.3", baseUrl: "https://openrouter.ai/api/v1?key=SECRET", maxTokens: 64000 });
  assertEquals(s.endpoint_host, "openrouter.ai");
  assertEquals(JSON.stringify(s).includes("SECRET"), false);
});
```

Extend `tests/unit/ingest/envelope_test.ts`:

```ts
Deno.test("buildPayload carries the run-level capture when supplied", () => {
  const p = buildPayload({
    runId: "r", taskSetHash: "h".repeat(64), model: { slug: "s", api_model_id: "m", family_slug: "f" },
    settings: {}, machineId: "mc", startedAt: "t0", completedAt: "t1", pricingVersion: "2026-09-03", results: [],
    harnessFingerprint: "a".repeat(64), retryPathVersion: "rp2-overlay-2026-09-01", environmentSha256: "b".repeat(64),
    environment: { bc_artifact: "u", container_image_digest: "d", bcch_version: "6.1.14", test_runner: "soap", prompt_template_digest: "c".repeat(64) },
    invocation: { provider: "anthropic" },
  });
  assertEquals(p["harness_fingerprint"], "a".repeat(64));
  assertEquals(p["test_runner"], "soap");
  assertEquals((p["invocation"] as { provider: string }).provider, "anthropic");
});
```

- [ ] **Step 2: Run tests to verify they fail** - FAIL.

- [ ] **Step 3: Implement**

Append to `src/ingest/capture.ts`:

```ts
import { BCCH_PINNED_VERSION } from "../container/bcch-config.ts";
import { inspectContainer } from "../container/docker-inspect.ts";
import { harnessFingerprint } from "../utils/harness-fingerprint.ts";
import { RETRY_PATH_VERSION } from "../llm/prompt-building.ts";
import { PROMPT_POLICY_VERSION } from "./catalog/task-set-hash.ts";

export interface EnvironmentManifest {
  bc_artifact: string | null; container_image_digest: string | null; bcch_version: string;
  test_runner: "soap" | "legacy"; host_os: string; centralgauge_sha: string | null; dirty_tree: boolean;
  harness_fingerprint: string; retry_path_version: string; prompt_policy_version: string;
  prompt_template_digest: string; culture: string | null;
}

async function gitFacts(cwd: string): Promise<{ sha: string | null; dirty: boolean }> {
  try {
    const sha = new TextDecoder().decode((await new Deno.Command("git", { args: ["rev-parse", "HEAD"], cwd }).output()).stdout).trim();
    const st = new TextDecoder().decode((await new Deno.Command("git", { args: ["status", "--porcelain"], cwd }).output()).stdout);
    return { sha: sha || null, dirty: st.trim().length > 0 };
  } catch { return { sha: null, dirty: false }; }
}

export async function promptTemplateDigest(cwd: string): Promise<string> {
  const names = ["code-gen.md", "diagnose.md", "diagnose-objects.md", "diagnose-contract.md", "bugfix.md"];
  let all = "";
  for (const n of names) {
    try { all += `${n}\n${(await Deno.readTextFile(`${cwd}/templates/${n}`)).replace(/\r\n/g, "\n")}\n`; } catch { all += `${n}\n<missing>\n`; }
  }
  return sha256Hex(all);
}

export async function buildEnvironmentManifest(opts: {
  containerName: string; cwd: string; inspect?: typeof inspectContainer;
}): Promise<EnvironmentManifest> {
  const inspect = opts.inspect ?? inspectContainer;
  let artifact: string | null = null, image: string | null = null;
  try {
    const i = await inspect(opts.containerName) as { imageDigest?: string; artifactUrl?: string } | undefined;
    image = i?.imageDigest ?? null;
    artifact = i?.artifactUrl ? i.artifactUrl.split("?")[0] : null;
  } catch { /* container facts are best effort */ }
  const git = await gitFacts(opts.cwd);
  return {
    bc_artifact: artifact, container_image_digest: image, bcch_version: BCCH_PINNED_VERSION,
    test_runner: Deno.env.get("CENTRALGAUGE_SOAP_TEST_RUNNER") === "0" ? "legacy" : "soap",
    host_os: `${Deno.build.os}-${Deno.build.arch}`, centralgauge_sha: git.sha, dirty_tree: git.dirty,
    harness_fingerprint: await harnessFingerprint(opts.cwd), retry_path_version: RETRY_PATH_VERSION,
    prompt_policy_version: PROMPT_POLICY_VERSION, prompt_template_digest: await promptTemplateDigest(opts.cwd),
    culture: Deno.env.get("CENTRALGAUGE_BC_CULTURE") ?? null,
  };
}

export function invocationSnapshot(cfg: {
  provider: string; model: string; apiModelId: string; baseUrl?: string; maxTokens?: number; temperature?: number; reasoning?: unknown;
}): Record<string, unknown> {
  let host: string | null = null;
  try { host = cfg.baseUrl ? new URL(cfg.baseUrl).host : null; } catch { host = null; }
  return {
    provider: cfg.provider, requested_model: cfg.model, api_model_id: cfg.apiModelId, endpoint_host: host,
    max_tokens: cfg.maxTokens ?? null, temperature: cfg.temperature ?? null,
    reasoning: cfg.reasoning === undefined ? null : JSON.parse(JSON.stringify(cfg.reasoning)),
  };
}
```

`ContainerInspection` (`src/container/docker-inspect.ts:6-19`) today exposes `artifactUrl: string | undefined` and `running: boolean` only. Add `imageDigest: string | undefined` to the interface and to `parseInspectJson` (read `[0].Image` from the `docker inspect` JSON, which is the `sha256:...` image id), with a unit test in `tests/unit/container/docker-inspect.test.ts` next to the existing parse tests. The fake in the test above then returns `{ artifactUrl, running: true, imageDigest }`.

In `src/ingest/envelope.ts` extend `BuildPayloadInput` with optional `harnessFingerprint`, `retryPathVersion`, `environmentSha256`, `environment: { bc_artifact, container_image_digest, bcch_version, test_runner, prompt_template_digest }`, `invocation: Record<string, unknown>`, and in `buildPayload` copy each present field to the snake_case payload key listed in the interface block above.

In `src/ingest/mod.ts`: add the same optional fields to `BenchResults`; in `ingestRun`, when `br.environment` is present, serialize the full manifest with `canonicalJSON`, compute its sha256, upload it with `uploadBlob` alongside the transcript blobs, and set `environmentSha256` on `payloadInput`; copy the other fields through.

In `cli/commands/bench/ingest-assembly.ts`: extend `AssembleOptions` with `environment?: EnvironmentManifest` and `invocation?: Record<string, unknown>`, and set `br.environment`, `br.invocation`, `br.harnessFingerprint = environment.harness_fingerprint`, `br.retryPathVersion = environment.retry_path_version` when supplied. Both callers pass the new facts: `cli/commands/bench-command.ts` (around line 943) builds the manifest once per run with `buildEnvironmentManifest({ containerName: <first container of the run>, cwd })` and the snapshot from the resolved LLM config for the variant; `cli/commands/ingest-command.ts` (around line 187, the replay path) rebuilds the manifest the same way and logs that the environment was captured at replay time, not at bench time (the results file's `ingest` block carries `centralgauge_sha` from bench time, which stays authoritative).

- [ ] **Step 4: Run tests**

```bash
deno test --allow-all tests/unit/ingest/ tests/unit/cli/
```

Expected: PASS.

- [ ] **Step 5: End-to-end dry run**

Run one dry-run bench to a results file and assemble without posting: `deno task start bench --llms mock --tasks tasks/hard/CG-AL-X076-*.yml --no-ingest --no-dashboard` (the mock adapter is registered in `src/llm/registry.ts`), then `deno task start ingest <results-file> --dry-run` if the ingest command offers it, otherwise inspect the results file's `ingest` block. Expected: the assembled payload shows `test_vector`, `termination_kind` and `harness_fingerprint`.

- [ ] **Step 6: Commit**

```bash
deno check src/ingest/*.ts cli/commands/bench/ingest-assembly.ts
git add src/ingest src/ingest/envelope.ts cli/commands/bench tests/unit/ingest
git commit -m "feat(ingest): per-run capture - environment manifest blob, harness fingerprint, retry-path version, invocation snapshot"
```

---

### Task 13: Documentation and handoff to Plan B

**Files:**
- Modify: `CLAUDE.md` (the "Task taxonomy" note: schema version 2, format groups, `taxonomy-audit`, `metadata.category` frozen, sync requires `--hash`)
- Modify: `docs/reasoning-suite/PLAN.md` (progress-log row)
- Modify: `docs/superpowers/specs/2026-09-02-taxonomy-v2-design.md` section 8 release 1 step 1 checkbox note: "done in Plan A"

- [ ] **Step 1: Edit the three documents** (plain prose, no code).

- [ ] **Step 2: Full local verification**

```bash
deno test --allow-all --ignore=tests/unit/container tests/unit/
deno task taxonomy-audit
deno task id-audit
deno run --allow-all scripts/gold-ci.ts --check | tail -3
cd site && npx vitest run --config vitest.unit.config.ts src/lib/shared/taxonomy-schema.test.ts
```

Expected: all green; gold-ci fingerprint unchanged from before Task 10 (the harness inputs did not change, only where the hash function lives).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/reasoning-suite/PLAN.md docs/superpowers/specs/2026-09-02-taxonomy-v2-design.md
git commit -m "docs: taxonomy v2 pipeline and ingest capture shipped (Plan A); Plan B takes the site"
```

Plan B (`2026-09-03-taxonomy-v2-plan-b-site-release1.md`) consumes: the shared modules from Tasks 1 to 3, the version-2 payload shape from Task 8, and the envelope fields from Tasks 11 and 12.
