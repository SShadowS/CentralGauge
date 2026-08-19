# Dashboard Plan 3 — Scoped Prereq Binder + Save As Wrong Answer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the author, per model response, exactly which prereq fields and
procedures it touched — and flag names that exist in no prereq — then let a
model's genuine mistake be promoted straight into the draft as `naive/`.

**Architecture:** Four pure AL-analysis modules under `src/al/` (prereq index,
record bindings, member references, tiered binder) that never touch disk or the
network, plus two dashboard modules that do the I/O (`prereq-sources.ts` loads a
draft's prereq chain, `promote-naive.ts` writes the wrong answer). The analysis
is deliberately conservative: the tree-sitter grammar gives no name resolution,
so only variables provably bound to a *prereq* table are analysed and every
verdict is tiered so a wrong guess renders as a soft label, never a confident
accusation.

**Tech Stack:** Deno 2.x, TypeScript with `exactOptionalPropertyTypes`,
tree-sitter-al 4.0.1 (vendored wasm) via `web-tree-sitter`, plain `.js`/`.css`
for the dashboard UI (no build step).

**Spec:** `docs/superpowers/specs/2026-08-09-task-authoring-dashboard-design.md`
(revision 2) — §5 "The prereq rail, scoped to what each response touched" and
§8 "Save as the wrong answer". Read both before starting.

## Global Constraints

- Run `deno check <changed-files>`, `deno lint <changed-dirs>`, `deno fmt <changed-files>` after every change. Scope to files you touched — the repo has CRLF/LF drift and a directory-wide `deno fmt` rewrites dozens of unrelated files. Do NOT `deno fmt` anything under `src/dashboard/ui/`.
- Run `deno lint` on the exact files you commit, at the state you commit them, immediately before claiming it passed.
- Use the repo's mapped import aliases (`@std/...`), never raw `jsr:` specifiers.
- Tests run via `deno test --allow-all`, never bare `deno test`. Do NOT use `--parallel`.
- **Baseline: 1026 passed / 3117 steps / 0 failed** on `deno test --allow-all --ignore=tests/unit/container tests/unit/`. Report the actual figure; a DECREASE is a problem, an increase is expected.
- `exactOptionalPropertyTypes` is on: spread optional fields conditionally (`...(x !== undefined ? { x } : {})`), never assign `undefined`.
- Import order: standard library (`@std/...`), then type imports, then implementations, then relative.
- **`src/dashboard/server.ts` must never import** `cli/commands/bench*`, `cli/commands/ingest-command.ts`, `src/ingest/**`, or `src/config/config.ts`. `tests/unit/dashboard/ingest-safety.test.ts` enforces this; re-run the grep after touching that file.
- No test may call a real model, touch a BC container, or spawn `docker`. **Containers are unavailable during this plan** — nothing here needs them.
- Never `git add -A`. The tree carries unrelated untracked files. Run `git show --stat <sha>` after committing and paste it in your report.
- The dashboard UI serves an explicit three-entry allowlist; never map `url.pathname` onto a file path.

## Grammar facts (verified against the vendored parser — do not re-derive)

Probed directly from `vendor/tree-sitter-al/tree-sitter-al.wasm` while writing
this plan. Trust these; they are not guesses.

**Prereq table structure:**
- `table_declaration` — the object. Name is its `quoted_identifier` (or `identifier`).
- `fields_section` → `fields_body` → `field_declaration`.
- A `field_declaration`'s named children are, in order: `field_keyword`, `integer` (the id), `quoted_identifier` **or** `identifier` (the field name), `type_specification`, `declaration_body`.
- Table procedures are `procedure` nodes, same shape as anywhere else.

**Response structure:**
- `procedure` → optional `parameter_list`, optional `var_section`, `code_block` → `statement_block`.
- `parameter_list` → `parameter` → `identifier` + `type_specification`.
- `var_section` → `var_body` → `variable_declaration` → `identifier` + `type_specification`.
- A Record-typed `type_specification` contains a `record_type`, whose `quoted_identifier`/`identifier` is the table name.
- Global variables: `var_section` directly under the object's `declaration_body`.
- `X.Y := v` parses as `assignment_statement` whose first named child is a `member_expression`.
- `X.Y(args)` parses as `call_expression` → `member_expression` + `argument_list`.
- `member_expression` is the `X.Y` node in both cases.

---

## File structure

| File | Responsibility |
|---|---|
| `src/al/prereq-index.ts` | Parse prereq AL sources into `{table -> {fields, procedures}}`. Pure; no disk. |
| `src/al/record-bindings.ts` | Per-procedure, scope-correct map of variable name -> Record table name. Pure. |
| `src/al/member-refs.ts` | Every `X.Y` reference with the syntactic position that decides its tier. Pure. |
| `src/al/prereq-binder.ts` | Combines the three above into tiered findings. Pure; the only module that decides a tier. |
| `src/dashboard/prereq-sources.ts` | Disk: load a draft's `prereq/` plus its chained dependencies. |
| `src/dashboard/promote-naive.ts` | Disk: write a response into `naive/` as one file per object (spec §8). |
| `src/dashboard/server.ts` (modify) | Wire the binder into run results; add the promote route. |
| `src/dashboard/ui/app.js` (modify) | Render the scoped rail and the promote action. |

Splitting note: §5 and §8 are independent features and could be two plans. They
are kept together because the spec pairs them as "Plan 3 — depth" and they share
one UI surface. Tasks 1-7 are §5; tasks 8-9 are §8. Stopping after task 7 leaves
working, shippable software.

---

### Task 1: Prereq index

**Files:**
- Create: `src/al/prereq-index.ts`
- Test: `tests/unit/al/prereq-index.test.ts`

**Interfaces:**
- Consumes: `parseAlObjects`, `AlObject` from `src/al/object-parser.ts`; `normalizeName` from `src/al/object-identity.ts`
- Produces:

```typescript
export interface PrereqTable {
  /** Table name exactly as written, for display. */
  name: string;
  /** Field names as written, in declaration order. */
  fields: string[];
  /** Procedure names as written, in declaration order. */
  procedures: string[];
}
export interface PrereqIndex {
  /** Keyed by normalizeName(table name). */
  tables: Map<string, PrereqTable>;
  /** True when any source failed to parse; the caller degrades to a file listing. */
  hasError: boolean;
}
export function buildPrereqIndex(sources: string[]): Promise<PrereqIndex>;
export function lookupField(index: PrereqIndex, table: string, member: string): boolean;
export function lookupProcedure(index: PrereqIndex, table: string, member: string): boolean;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/al/prereq-index.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import {
  buildPrereqIndex,
  lookupField,
  lookupProcedure,
} from "../../../src/al/prereq-index.ts";

const TABLE = `table 69001 "Product Category"
{
    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; "Description"; Text[100]) { }
        field(3; Active; Boolean) { }
    }

    procedure Recalculate()
    begin
    end;
}`;

describe("al/prereq-index", () => {
  it("indexes fields and procedures of a prereq table", async () => {
    const idx = await buildPrereqIndex([TABLE]);
    const t = idx.tables.get("product category");
    assertEquals(t?.name, "Product Category");
    assertEquals(t?.fields, ["Code", "Description", "Active"]);
    assertEquals(t?.procedures, ["Recalculate"]);
    assertEquals(idx.hasError, false);
  });

  it("looks up members case- and quote-insensitively", async () => {
    const idx = await buildPrereqIndex([TABLE]);
    assertEquals(lookupField(idx, '"Product Category"', '"Code"'), true);
    assertEquals(lookupField(idx, "PRODUCT CATEGORY", "code"), true);
    assertEquals(lookupField(idx, "Product Category", "Nope"), false);
    assertEquals(lookupProcedure(idx, "Product Category", "recalculate"), true);
    assertEquals(lookupProcedure(idx, "Product Category", "Code"), false);
  });

  it("reports a parse failure instead of a silently empty index", async () => {
    const idx = await buildPrereqIndex(["table 1 {{{ broken"]);
    assertEquals(idx.hasError, true);
  });

  it("merges several sources, chained prereqs included", async () => {
    const other =
      `table 69002 "CG Related" { fields { field(1; "Ref"; Code[10]) { } } }`;
    const idx = await buildPrereqIndex([TABLE, other]);
    assertEquals(idx.tables.size, 2);
    assertEquals(lookupField(idx, "CG Related", "Ref"), true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/al/prereq-index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/al/prereq-index.ts`. Parse each source with `parseAlObjects`; for
every object whose `kind` is `table` or `tableextension`, re-parse its `source`
with a tree-sitter parser (load the grammar the way `src/al/trap-signature.ts`
does — copy that lazy-init pattern, do not invent a second one) and walk it:

- **Fields:** find every `field_declaration`. Its named children are
  `field_keyword`, `integer` (the id), then the name as either
  `quoted_identifier` or `identifier`, then `type_specification`. Take the first
  `quoted_identifier`/`identifier` child that appears **after** the `integer`,
  and strip surrounding quotes.
- **Procedures:** find every `procedure` node; its name is its first direct
  `identifier` child.
- Do **not** recurse into a `procedure` body when collecting fields.

Key `tables` by `normalizeName(tableName)`. Set `hasError: true` when
`parseAlObjects` reports `hasError` for any source, or when a re-parse yields a
tree whose `rootNode.hasError` is true. `lookupField` and `lookupProcedure`
normalize both the table name and the member name (strip surrounding quotes,
lowercase) before comparing.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/al/prereq-index.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/al/prereq-index.ts tests/unit/al/prereq-index.test.ts
deno lint src/al/prereq-index.ts tests/unit/al/prereq-index.test.ts
deno check src/al/prereq-index.ts
git add src/al/prereq-index.ts tests/unit/al/prereq-index.test.ts
git commit -m "feat(al): index prereq tables by field and procedure"
```

---

### Task 2: Scoped record bindings

**Files:**
- Create: `src/al/record-bindings.ts`
- Test: `tests/unit/al/record-bindings.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (loads the grammar itself)
- Produces:

```typescript
export interface ProcedureBindings {
  /** Display name of the procedure or trigger. */
  procedureName: string;
  /** Lowercased variable name -> table name as written. */
  bindings: Map<string, string>;
}
export function collectRecordBindings(source: string): Promise<ProcedureBindings[]>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/al/record-bindings.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import { collectRecordBindings } from "../../../src/al/record-bindings.ts";

const SRC = `codeunit 70054 "CG Agent"
{
    var
        Shared: Record "CG Quote";
        NotARecord: Integer;

    procedure First(var Line: Record "CG Quote"; Pct: Decimal)
    var
        Local: Record "CG Related";
    begin
    end;

    procedure Second()
    var
        Shared: Record "CG Other";
    begin
    end;
}`;

describe("al/record-bindings", () => {
  it("binds parameters and locals, and inherits globals", async () => {
    const procs = await collectRecordBindings(SRC);
    const first = procs.find((p) => p.procedureName === "First");
    assertEquals(first?.bindings.get("line"), "CG Quote");
    assertEquals(first?.bindings.get("local"), "CG Related");
    assertEquals(first?.bindings.get("shared"), "CG Quote");
  });

  it("ignores non-Record variables entirely", async () => {
    const procs = await collectRecordBindings(SRC);
    const first = procs.find((p) => p.procedureName === "First");
    assertEquals(first?.bindings.has("pct"), false);
    assertEquals(first?.bindings.has("notarecord"), false);
  });

  it("lets a local shadow a global of a different table", async () => {
    const procs = await collectRecordBindings(SRC);
    const second = procs.find((p) => p.procedureName === "Second");
    assertEquals(second?.bindings.get("shared"), "CG Other");
  });

  it("returns an empty list when the source does not parse", async () => {
    assertEquals((await collectRecordBindings("codeunit {{{")).length, 0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/al/record-bindings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Walk the tree once. Collect **globals** first: a `var_section` whose ancestor
chain reaches the object's `declaration_body` without passing through a
`procedure` or `trigger_declaration`. Then for each member (`procedure` or
`trigger_declaration`) build its map by inserting globals first, then its
`parameter_list` entries, then its own `var_section` entries — later writes
shadow earlier ones, which is exactly the scoping rule the third test pins.

For a `parameter` or `variable_declaration`: include it **only if** its
`type_specification` contains a `record_type`. The bound table name is that
`record_type`'s `quoted_identifier`/`identifier` with surrounding quotes
stripped. A single `variable_declaration` may declare several names sharing one
type — bind **every** `identifier` child, not just the first.

Key `bindings` by the lowercased variable name. Return `[]` when the parse
throws or the tree has `rootNode.hasError`.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/al/record-bindings.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/al/record-bindings.ts tests/unit/al/record-bindings.test.ts
deno lint src/al/record-bindings.ts tests/unit/al/record-bindings.test.ts
deno check src/al/record-bindings.ts
git add src/al/record-bindings.ts tests/unit/al/record-bindings.test.ts
git commit -m "feat(al): scope-correct Record bindings per procedure

A local shadowing a global of a different table would otherwise mis-bind and
turn a correct field reference into a false accusation."
```

---

### Task 3: Member references with position

**Files:**
- Create: `src/al/member-refs.ts`
- Test: `tests/unit/al/member-refs.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:

```typescript
/** Where an `X.Y` reference appears, which is what decides its tier. */
export type RefPosition = "assignment-target" | "curated-method-arg" | "call" | "other";

export interface MemberRef {
  /** Display name of the enclosing procedure or trigger. */
  procedureName: string;
  /** The `X` in `X.Y`, lowercased. */
  variable: string;
  /** The `Y` in `X.Y`, as written. */
  member: string;
  position: RefPosition;
  /** 1-based line within the parsed source, for the UI to point at. */
  line: number;
}

/** Methods whose first argument is a field name (spec §5). */
export const FIELD_NAME_METHODS: readonly string[];

export function collectMemberRefs(source: string): Promise<MemberRef[]>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/al/member-refs.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import { collectMemberRefs, FIELD_NAME_METHODS } from "../../../src/al/member-refs.ts";

const SRC = `codeunit 70054 "CG Agent"
{
    procedure Apply(var Line: Record "CG Quote")
    begin
        Line."Unit Price" := 10;
        Line.Validate("Line Discount %", 5);
        Line.SetRange(Status, 1);
        Line.Modify(true);
    end;
}`;

describe("al/member-refs", () => {
  it("classifies an assignment target", async () => {
    const refs = await collectMemberRefs(SRC);
    const r = refs.find((x) => x.member === "Unit Price");
    assertEquals(r?.position, "assignment-target");
    assertEquals(r?.variable, "line");
    assertEquals(r?.procedureName, "Apply");
  });

  it("classifies a field-name argument of a curated method", async () => {
    const refs = await collectMemberRefs(SRC);
    assertEquals(
      refs.find((x) => x.member === "Line Discount %")?.position,
      "curated-method-arg",
    );
    assertEquals(
      refs.find((x) => x.member === "Status")?.position,
      "curated-method-arg",
    );
  });

  it("classifies an ordinary method call as a call", async () => {
    const refs = await collectMemberRefs(SRC);
    assertEquals(refs.find((x) => x.member === "Modify")?.position, "call");
  });

  it("carries the curated method set the spec names", () => {
    for (
      const m of [
        "Validate",
        "SetRange",
        "SetFilter",
        "TestField",
        "CalcFields",
        "CalcSums",
        "FieldError",
        "GetRangeMin",
        "GetRangeMax",
      ]
    ) {
      assertEquals(FIELD_NAME_METHODS.includes(m), true, `missing ${m}`);
    }
  });

  it("returns an empty list when the source does not parse", async () => {
    assertEquals((await collectMemberRefs("codeunit {{{")).length, 0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/al/member-refs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
export const FIELD_NAME_METHODS: readonly string[] = [
  "Validate",
  "SetRange",
  "SetFilter",
  "TestField",
  "CalcFields",
  "CalcSums",
  "FieldError",
  "GetRangeMin",
  "GetRangeMax",
];
```

Walk each `procedure` / `trigger_declaration` body. Three cases:

1. **`assignment_statement`** whose first named child is a `member_expression`:
   emit `position: "assignment-target"` for that `X.Y`. The spec's reasoning is
   that `Y` cannot be a procedure in assignment-target position, so an unknown
   `Y` is provably not a field.
2. **`call_expression`** whose `member_expression`'s member is in
   `FIELD_NAME_METHODS`: emit one ref **per identifier-shaped argument** in its
   `argument_list`, with `variable` taken from the call's own `X` and
   `position: "curated-method-arg"`. Only `identifier` and `quoted_identifier`
   arguments count — a `string_literal`, `integer` or nested expression is not a
   field name. Do **not** also emit the method name itself.
3. **Any other `call_expression`** on a `member_expression`: emit the method
   name with `position: "call"`.

`variable` is the `member_expression`'s object part, lowercased; `member` is its
property part with surrounding quotes stripped.

**Both parts may be `quoted_identifier`, not just `identifier`.** Probed against
the vendored grammar: `Line."Unit Price" := 1` yields a `member_expression`
whose children are `identifier="Line"` and `quoted_identifier="\"Unit Price\""`,
and the whole thing parses with `hasError: false`. Match **either** node type at
both positions and strip surrounding quotes.

This is not hypothetical pedantry — the identical omission shipped twice in this
plan already. Task 2 matched `identifier` only and silently dropped every quoted
variable, parameter and procedure name; Task 1 did the same for quoted table
procedure names. Both were caught after the fact. Do not make it three. `line` is
`node.startPosition.row + 1`. Return `[]` on parse failure or
`rootNode.hasError`.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/al/member-refs.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/al/member-refs.ts tests/unit/al/member-refs.test.ts
deno lint src/al/member-refs.ts tests/unit/al/member-refs.test.ts
deno check src/al/member-refs.ts
git add src/al/member-refs.ts tests/unit/al/member-refs.test.ts
git commit -m "feat(al): collect X.Y references with the position that tiers them"
```

---

### Task 4: The tiered binder

**Files:**
- Create: `src/al/prereq-binder.ts`
- Test: `tests/unit/al/prereq-binder.test.ts`

**Interfaces:**
- Consumes: `PrereqIndex`, `lookupField`, `lookupProcedure` (Task 1); `collectRecordBindings` (Task 2); `collectMemberRefs`, `MemberRef` (Task 3)
- Produces:

```typescript
/** Confidence tier, per spec §5. Never render a soft label as an accusation. */
export type BinderTier = "hard" | "soft" | "known";

export interface BinderFinding {
  procedureName: string;
  /** Table the variable was bound to, as written. */
  table: string;
  /** The referenced member, as written. */
  member: string;
  tier: BinderTier;
  line: number;
}

export interface BinderResult {
  /** Only references to variables bound to a PREREQ table. */
  findings: BinderFinding[];
  /** True when analysis could not run; caller degrades to the static listing. */
  degraded: boolean;
}

export function bindResponseToPrereqs(
  responseSource: string,
  index: PrereqIndex,
): Promise<BinderResult>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/al/prereq-binder.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import { buildPrereqIndex } from "../../../src/al/prereq-index.ts";
import { bindResponseToPrereqs } from "../../../src/al/prereq-binder.ts";

const PREREQ = `table 69001 "CG Quote"
{
    fields
    {
        field(1; "Unit Price"; Decimal) { }
        field(2; Status; Integer) { }
    }
    procedure Recalculate() begin end;
}`;

async function bind(src: string) {
  return await bindResponseToPrereqs(src, await buildPrereqIndex([PREREQ]));
}

const wrap = (body: string) =>
  `codeunit 70054 "A"
{
    procedure P(var Line: Record "CG Quote")
    begin
${body}
    end;
}`;

describe("al/prereq-binder", () => {
  it("hard-flags an unknown assignment target", async () => {
    const r = await bind(wrap(`        Line.Discount := 1;`));
    const f = r.findings.find((x) => x.member === "Discount");
    assertEquals(f?.tier, "hard");
    assertEquals(f?.table, "CG Quote");
  });

  it("hard-flags an unknown field argument of a curated method", async () => {
    const r = await bind(wrap(`        Line.Validate(Discount, 1);`));
    assertEquals(r.findings.find((x) => x.member === "Discount")?.tier, "hard");
  });

  it("marks a known field as known, not as a finding to fear", async () => {
    const r = await bind(wrap(`        Line."Unit Price" := 1;`));
    assertEquals(r.findings.find((x) => x.member === "Unit Price")?.tier, "known");
  });

  it("soft-labels an unknown member in call position", async () => {
    const r = await bind(wrap(`        Line.Refresh();`));
    assertEquals(r.findings.find((x) => x.member === "Refresh")?.tier, "soft");
  });

  it("treats a declared table procedure as known", async () => {
    const r = await bind(wrap(`        Line.Recalculate();`));
    assertEquals(
      r.findings.find((x) => x.member === "Recalculate")?.tier,
      "known",
    );
  });

  it("never analyses a variable not bound to a prereq table", async () => {
    const src = `codeunit 70054 "A"
{
    procedure P(var Cust: Record Customer)
    begin
        Cust.MadeUpField := 1;
    end;
}`;
    const r = await bind(src);
    assertEquals(r.findings.length, 0);
  });

  it("degrades instead of guessing when the response does not parse", async () => {
    const r = await bind("codeunit {{{");
    assertEquals(r.degraded, true);
    assertEquals(r.findings.length, 0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/al/prereq-binder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Run `collectRecordBindings` and `collectMemberRefs` on the response. For each
ref, look up its `variable` in the bindings of the **same** procedure.

**The join key is `procedureName`, and both sides must render it identically —
quotes stripped.** `record-bindings.ts:230` returns `unquote(nameNode.text)`
and Task 3 was instructed to match that. If the two ever diverge, the join
yields zero findings for every quoted-named procedure: no error, no crash, the
binder just quietly stops flagging inside those members. Assert this in a test
with a `procedure "My Proc"()` containing a hard-flag reference, so a future
change to either side fails loudly instead of silently narrowing coverage. Skip the
ref entirely when the variable is unbound, or bound to a table absent from the
index — that is the spec's "Untracked" tier and it is why base-app records,
`RecordRef` and unresolvable bindings can never false-flag.

Then tier it:

- `assignment-target` or `curated-method-arg`: `known` if `lookupField` hits,
  otherwise **`hard`**.
- `call`: `known` if `lookupProcedure` **or** `lookupField` hits, otherwise
  **`soft`** — the member may be a Record built-in the index cannot know, so a
  stale built-in list produces a soft mislabel rather than a false accusation.
- `other`: skip.

Set `degraded: true` (and return no findings) when the index has `hasError`, or
when `collectRecordBindings` returns `[]` for a non-empty source.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/al/prereq-binder.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/al/prereq-binder.ts tests/unit/al/prereq-binder.test.ts
deno lint src/al/prereq-binder.ts tests/unit/al/prereq-binder.test.ts
deno check src/al/prereq-binder.ts
git add src/al/prereq-binder.ts tests/unit/al/prereq-binder.test.ts
git commit -m "feat(al): tier prereq member references so a guess is never an accusation

Only variables provably bound to a prereq table are analysed; everything else
is untracked by design, so base-app records can never false-flag."
```

---

### Task 5: Load a draft's prereq chain from disk

**Files:**
- Create: `src/dashboard/prereq-sources.ts`
- Test: `tests/unit/dashboard/prereq-sources.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. (An earlier draft of this plan listed
  `hasTaskPrefix` here; that was wrong and contradicted Step 3. The oracle-side
  `<id>.`-prefix convention applies to `correct/`, NOT to `prereq/` — read every
  `.al` in a prereq directory unconditionally.)
- Produces:

```typescript
export interface PrereqSources {
  /** Raw AL text of the draft's own prereq/ plus every chained dependency. */
  sources: string[];
  /** Filenames actually read, in load order, for the static-listing fallback. */
  files: string[];
}
export function loadPrereqSources(
  draftDir: string,
  dependenciesRoot: string,
): Promise<PrereqSources>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/prereq-sources.test.ts`:

```typescript
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { loadPrereqSources } from "../../../src/dashboard/prereq-sources.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

describe("dashboard/prereq-sources", () => {
  let root: string;
  beforeEach(async () => {
    root = await createTempDir("prereq-sources-test");
  });
  afterEach(async () => {
    await cleanupTempDir(root);
  });

  it("returns nothing when the draft has no prereq directory", async () => {
    const draft = join(root, "CG-AL-X054");
    await ensureDir(draft);
    const r = await loadPrereqSources(draft, join(root, "deps"));
    assertEquals(r.sources.length, 0);
    assertEquals(r.files.length, 0);
  });

  it("reads the draft's own prereq AL, sorted", async () => {
    const draft = join(root, "CG-AL-X054");
    await ensureDir(join(draft, "prereq"));
    await Deno.writeTextFile(join(draft, "prereq", "B.Table.al"), "table 2 B { }");
    await Deno.writeTextFile(join(draft, "prereq", "A.Table.al"), "table 1 A { }");
    await Deno.writeTextFile(join(draft, "prereq", "app.json"), "{}");
    const r = await loadPrereqSources(draft, join(root, "deps"));
    assertEquals(r.files, ["A.Table.al", "B.Table.al"]);
    assertEquals(r.sources.length, 2);
  });

  it("follows a chained dependency by app id", async () => {
    const draft = join(root, "CG-AL-X054");
    await ensureDir(join(draft, "prereq"));
    await Deno.writeTextFile(
      join(draft, "prereq", "app.json"),
      JSON.stringify({
        id: "a1b2c3d4-0a54-0000-0000-000000000001",
        dependencies: [{ id: "a1b2c3d4-0ff0-0000-0000-000000000022" }],
      }),
    );
    await Deno.writeTextFile(join(draft, "prereq", "Own.Table.al"), "table 1 Own { }");

    const dep = join(root, "deps", "CG-AL-H022");
    await ensureDir(dep);
    await Deno.writeTextFile(
      join(dep, "app.json"),
      JSON.stringify({ id: "a1b2c3d4-0ff0-0000-0000-000000000022" }),
    );
    await Deno.writeTextFile(join(dep, "Chained.Table.al"), "table 9 Chained { }");

    const r = await loadPrereqSources(draft, join(root, "deps"));
    assertEquals(r.files.includes("Chained.Table.al"), true);
    assertEquals(r.sources.length, 2);
  });

  it("does not loop forever on a circular dependency", async () => {
    const draft = join(root, "CG-AL-X054");
    await ensureDir(join(draft, "prereq"));
    await Deno.writeTextFile(
      join(draft, "prereq", "app.json"),
      JSON.stringify({ id: "id-a", dependencies: [{ id: "id-b" }] }),
    );
    const depB = join(root, "deps", "B");
    await ensureDir(depB);
    await Deno.writeTextFile(
      join(depB, "app.json"),
      JSON.stringify({ id: "id-b", dependencies: [{ id: "id-a" }] }),
    );
    await Deno.writeTextFile(join(depB, "B.Table.al"), "table 2 B { }");
    const r = await loadPrereqSources(draft, join(root, "deps"));
    assertEquals(r.files, ["B.Table.al"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/dashboard/prereq-sources.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Read `<draftDir>/prereq/*.al`, sorted by filename, skipping any file for which
`hasTaskPrefix(<draft id>, name)` is true is **not** required here — prereq
directories have no oracle-side convention — so read every `.al`.

Then read `<draftDir>/prereq/app.json`; for each entry in its `dependencies`
array, scan `dependenciesRoot`'s immediate subdirectories for an `app.json`
whose `id` matches (case-insensitively), and recurse into that directory the
same way. Track visited app ids in a `Set` and skip an id already seen — that is
what the circular-dependency test pins.

**An unresolvable dependency id is normal and must be skipped silently, not
treated as an error or a missing prereq.** Verified against the committed tree:
of 68 prereqs, exactly two declare `dependencies`, and they differ in kind —

```
CG-AL-H024 -> ["a1b2c3d4-0ff0-0000-0000-000000000022"]   resolvable (CG-AL-H022's prereq)
CG-AL-X047 -> ["437dbf0e-...", "f3552374-..."]           NOT resolvable locally
```

X047's ids are not the repo's `a1b2c3d4-*` prereq convention — they are
platform/base-app dependencies that have no directory under
`tests/al/dependencies/` and never will. A resolver that logs, throws, or
reports them as missing would produce noise on a perfectly healthy draft. Add a
test: a prereq declaring one resolvable and one unknown dependency id loads the
resolvable one and ignores the other without error.

A missing `prereq/`, a missing or unparseable `app.json`, and an unreadable file
all yield `[]` rather than throwing: an author mid-edit is an ordinary state,
and this feeds a read-only rail.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/dashboard/prereq-sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/dashboard/prereq-sources.ts tests/unit/dashboard/prereq-sources.test.ts
deno lint src/dashboard/prereq-sources.ts tests/unit/dashboard/prereq-sources.test.ts
deno check src/dashboard/prereq-sources.ts
git add src/dashboard/prereq-sources.ts tests/unit/dashboard/prereq-sources.test.ts
git commit -m "feat(dashboard): load a draft's prereq chain, cycles included"
```

---

### Task 6: Wire the binder into run results

**Files:**
- Modify: `src/dashboard/run-manager.ts`
- Modify: `src/dashboard/server.ts`
- Test: `tests/unit/dashboard/run-manager.test.ts` (extend)

**Interfaces:**
- Consumes: `bindResponseToPrereqs`, `BinderResult` (Task 4); `buildPrereqIndex` (Task 1); `loadPrereqSources` (Task 5)
- Produces: `ModelResponse.prereqBinding?: BinderResult`, and `runQuick` gaining `prereqSources: string[]`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/dashboard/run-manager.test.ts`:

```typescript
it("attaches tiered prereq findings to each response", async () => {
  const PREREQ = `table 69001 "CG Quote"
{
    fields { field(1; "Unit Price"; Decimal) { } }
}`;
  const CODE = `codeunit 70054 "A"
{
    procedure P(var Line: Record "CG Quote")
    begin
        Line.Discount := 1;
    end;
}`;
  const run = await runQuick({
    draft: {
      id: "CG-AL-X054",
      dir,
      dirName: "CG-AL-X054",
      description: "Write a codeunit that applies a discount.",
      hasPrereq: true,
      prereqFiles: [],
    },
    models: ["m"],
    correctSources: [CODE],
    naiveSources: [],
    prereqSources: [PREREQ],
    call: () =>
      Promise.resolve({
        content: `BEGIN-CODE\n${CODE}\nEND-CODE`,
        finishReason: "stop" as const,
      }),
  });
  const finding = run.responses[0]?.prereqBinding?.findings.find(
    (f) => f.member === "Discount",
  );
  assertEquals(finding?.tier, "hard");
});

it("leaves the binding undefined when a draft has no prereq", async () => {
  const CODE = `codeunit 70054 "A" { procedure P() begin end; }`;
  const run = await runQuick({
    draft: {
      id: "CG-AL-X054",
      dir,
      dirName: "CG-AL-X054",
      description: "Write a codeunit that applies a discount.",
      hasPrereq: false,
      prereqFiles: [],
    },
    models: ["m"],
    correctSources: [CODE],
    naiveSources: [],
    prereqSources: [],
    call: () =>
      Promise.resolve({
        content: `BEGIN-CODE\n${CODE}\nEND-CODE`,
        finishReason: "stop" as const,
      }),
  });
  assertEquals(run.responses[0]?.prereqBinding, undefined);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/dashboard/run-manager.test.ts`
Expected: FAIL — `prereqSources` is not a known property.

- [ ] **Step 3: Implement**

**`runQuick` no longer takes a `prompt`.** Its current signature is
`{draft, models, correctSources, naiveSources, call, renderer?}` — the prompt is
now rendered inside `runQuick` from `draft.description` through the bench's own
attempt-1 template (`buildGenerationPrompt`), because accepting a
client-supplied prompt meant every model was asked the empty string. Do not
reintroduce one. `DraftSummary` correspondingly requires `description`, and
carries `promptTemplate?`, `maxAttempts?` and `prompts?` for template fidelity.

Add `prereqSources: string[]` to `runQuick`'s options. Build the index **once**
per run (not per model) via `buildPrereqIndex`. When `prereqSources` is empty,
skip binding entirely and leave `prereqBinding` absent — spread it
conditionally, per `exactOptionalPropertyTypes`. Otherwise call
`bindResponseToPrereqs(resolution.cleanedCode, index)` per response and attach
the result.

An errored model response (the `runOneModel` catch path) gets no binding: there
is no code to analyse.

In `server.ts`, call `loadPrereqSources(draft.dir, "tests/al/dependencies")` in
the `POST /api/run` handler and pass the result's `sources` through. Keep the
dependencies root a plain constant in `server.ts`; do **not** reach for the
config module, which the ingest-safety test forbids.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/dashboard/run-manager.test.ts`
Then re-run the import-graph guard:

```bash
deno info --json src/dashboard/server.ts | jq -r '.modules[].specifier' | grep -icE "cli/commands/bench|cli/commands/ingest|/src/ingest/|src/config/config.ts"
```

Expected: PASS, and the grep returns `0`.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/dashboard/run-manager.ts src/dashboard/server.ts tests/unit/dashboard/run-manager.test.ts
deno lint src/dashboard tests/unit/dashboard
deno check src/dashboard/run-manager.ts src/dashboard/server.ts
git add src/dashboard/run-manager.ts src/dashboard/server.ts tests/unit/dashboard/run-manager.test.ts
git commit -m "feat(dashboard): attach tiered prereq findings to each response"
```

---

### Task 7: The scoped prereq rail

**Files:**
- Modify: `src/dashboard/ui/app.js`
- Modify: `src/dashboard/ui/style.css`
- Test: `tests/unit/dashboard/authoring-ui.test.ts` (extend)

**Interfaces:**
- Consumes: `ModelResponse.prereqBinding` (Task 6)
- Produces: nothing consumed by later tasks

**The vocabulary is a contract.** Use these exact strings; the existing
`tests/unit/dashboard/vocabulary.test.ts` greps `app.js` for them.

| Tier | Label |
|---|---|
| `hard` | **Made up this field** |
| `soft` | **Unknown member** |
| `known` | (no label — render the name plainly) |
| binder degraded | **Couldn't check the prereq** |

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/dashboard/authoring-ui.test.ts`, following the existing
data-URL-module + DOM-stub pattern already in that file:

```typescript
it("labels a hard finding as a made-up field", async () => {
  const ui = await loadUi();
  const html = ui.renderPrereqRail({
    degraded: false,
    findings: [
      { procedureName: "P", table: "CG Quote", member: "Discount", tier: "hard", line: 5 },
      { procedureName: "P", table: "CG Quote", member: "Unit Price", tier: "known", line: 6 },
    ],
  }));
  assertStringIncludes(rail, "Made up this field");
  assertStringIncludes(rail, "Discount");
  assertStringIncludes(rail, "Unit Price");
});

it("labels a soft finding without accusing", async () => {
  const ui = await loadUi();
  const html = ui.renderPrereqRail({
    degraded: false,
    findings: [
      { procedureName: "P", table: "CG Quote", member: "Refresh", tier: "soft", line: 7 },
    ],
  }));
  assertStringIncludes(rail, "Unknown member");
  assertEquals(rail.includes("Made up this field"), false);
});

it("says it could not check rather than showing an empty rail", async () => {
  const ui = await loadUi();
  const rail = allText(ui.renderPrereqRail({ degraded: true, findings: [] }));
  assertStringIncludes(rail, "Couldn't check the prereq");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/dashboard/authoring-ui.test.ts`
Expected: FAIL — `renderPrereqRail` is not exported.

- [ ] **Step 3: Implement**

Add `renderPrereqRail(binding)` to `app.js` as a **plain function declaration
with NO `export` keyword.** `index.html:65` loads the file as
`<script src="/app.js"></script>` — a classic script, not a module — so an
`export` statement there is a syntax error in the browser and the page dies.

The file exposes nothing; the test harness does the exposing. `loadUi()`
(`tests/unit/dashboard/authoring-ui.test.ts:102`) reads the source, appends an
`export { ... }` line, and imports the result as a `data:` module. So to make
your function testable you must ALSO add its name to that appended list and to
the `Ui` interface above it. Follow `buildColumnHeader`'s precedent exactly.

Return a DOM node built with the file's existing `el()` helper, not an HTML
string — the harness's assertions read nodes via `allText(node)`. Render, under
the existing **Already exists** (prereq) heading:

- When `binding` is absent: keep today's static file listing untouched.
- When `binding.degraded`: the single line **Couldn't check the prereq**, plus
  the static listing beneath it — the spec's stated fallback.
- Otherwise: group findings by `table`, then by `procedureName`, listing each
  `member` with its line number. A `hard` finding carries **Made up this field**,
  a `soft` one **Unknown member**, a `known` one no label at all.

Order findings `hard`, then `soft`, then `known`, so the actionable ones are at
the top of the rail rather than buried under correct references.

Style the two labels distinctly in `style.css`, reusing the existing cell-state
colours rather than introducing new ones.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/dashboard/authoring-ui.test.ts`
Then: `deno test --allow-all tests/unit/dashboard/vocabulary.test.ts`
Expected: both PASS. The vocabulary test proves the new labels match the
contract and that no rejected wording crept in.

- [ ] **Step 5: Verify by hand**

Start `deno task start workbench serve`, open the printed URL, select a draft
that has a `prereq/`, ask one model with `--preset quick-test` (the `mock`
provider, which costs nothing), and confirm the rail lists what the response
touched. Report what you actually saw, not what you expect.

- [ ] **Step 6: Format, lint, commit**

```bash
deno lint tests/unit/dashboard
git add src/dashboard/ui/app.js src/dashboard/ui/style.css tests/unit/dashboard/authoring-ui.test.ts
git commit -m "feat(dashboard): scope the prereq rail to what each response touched

Catches a hallucinated field before a compile does, and keeps it distinct from
falling for the trap, which is what makes calibration judgeable."
```

---

### Task 8: Promote a response into naive/

**Files:**
- Create: `src/dashboard/promote-naive.ts`
- Test: `tests/unit/dashboard/promote-naive.test.ts`

**Interfaces:**
- Consumes: `parseAlObjects`, `AlObject` (`src/al/object-parser.ts`); `hasTaskPrefix` (`src/workbench/oracle-files.ts`)
- Produces:

```typescript
export interface PromoteResult {
  /** Filenames written into naive/, in write order. */
  written: string[];
  /** Files deleted because promotion REPLACES rather than merges. */
  removed: string[];
}
export class PromoteRefusal extends Error {}

export function promoteAsNaive(opts: {
  draftDir: string;
  taskId: string;
  /** resolveCandidate's cleanedCode — never the raw response. */
  code: string;
  model: string;
  attempt: number;
  timestamp: string;
}): Promise<PromoteResult>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/promote-naive.test.ts`:

```typescript
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { promoteAsNaive } from "../../../src/dashboard/promote-naive.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

const BASE = {
  taskId: "CG-AL-X054",
  model: "anthropic/claude-opus-4-8",
  attempt: 1,
  timestamp: "2026-08-18T10:00:00.000Z",
};

describe("dashboard/promote-naive", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await createTempDir("promote-naive-test");
    await ensureDir(join(dir, "naive"));
    await Deno.writeTextFile(join(dir, "naive", "app.json"), "{}");
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("writes one file per top-level object", async () => {
    const code = `codeunit 70054 "CG Agent" { }
table 70055 "CG Thing" { }`;
    const r = await promoteAsNaive({ ...BASE, draftDir: dir, code });
    assertEquals(r.written.sort(), ["CG Agent.Codeunit.al", "CG Thing.Table.al"]);
  });

  it("stamps provenance as a comment header", async () => {
    const code = `codeunit 70054 "CG Agent" { }`;
    await promoteAsNaive({ ...BASE, draftDir: dir, code });
    const text = await Deno.readTextFile(join(dir, "naive", "CG Agent.Codeunit.al"));
    assertStringIncludes(text, "anthropic/claude-opus-4-8");
    assertStringIncludes(text, "2026-08-18T10:00:00.000Z");
  });

  it("replaces existing AL rather than merging, and keeps app.json", async () => {
    await Deno.writeTextFile(join(dir, "naive", "Stale.Codeunit.al"), "codeunit 1 S { }");
    const r = await promoteAsNaive({
      ...BASE,
      draftDir: dir,
      code: `codeunit 70054 "CG Agent" { }`,
    });
    assertEquals(r.removed, ["Stale.Codeunit.al"]);
    assertEquals(await Deno.stat(join(dir, "naive", "app.json")).then(() => true), true);
  });

  it("sanitises characters invalid in a filename", async () => {
    const code = `codeunit 70054 "CG/Agent: v2" { }`;
    const r = await promoteAsNaive({ ...BASE, draftDir: dir, code });
    assertEquals(r.written[0]?.includes("/"), false);
    assertEquals(r.written[0]?.includes(":"), false);
  });

  it("refuses a name that would collide with the reserved task-id prefix", async () => {
    const code = `codeunit 70054 "CG-AL-X054.Helper" { }`;
    await assertRejects(
      () => promoteAsNaive({ ...BASE, draftDir: dir, code }),
      Error,
      "reserved",
    );
  });

  it("refuses two objects of one type sanitising to the same name", async () => {
    const code = `codeunit 70054 "CG:Agent" { }
codeunit 70055 "CG/Agent" { }`;
    await assertRejects(
      () => promoteAsNaive({ ...BASE, draftDir: dir, code }),
      Error,
      "collide",
    );
  });

  it("refuses when nothing extractable was produced", async () => {
    await assertRejects(
      () => promoteAsNaive({ ...BASE, draftDir: dir, code: "I cannot help." }),
      Error,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/dashboard/promote-naive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Parse `code` with `parseAlObjects`. Refuse (throw `PromoteRefusal`) when it
yields no objects — that is the spec's "disabled when nothing extractable was
produced", enforced server-side rather than trusted to the UI.

Filename per object: `<SanitizedName>.<Type>.al`.

`AlObject.kind` is lowercase and `AlObject.name` already unquoted — verified
against the shipped parser (`codeunit`, `table`, `enum`, `pageextension`).
Capitalising the first letter is right for the simple kinds, but **wrong for
compound ones**: the committed tree uses `.TableExt.al`, not
`.Tableextension.al`. Counted across `tests/al/dependencies/`: 73 `.Table.al`,
24 `.Codeunit.al`, 3 `.Enum.al`, 1 `.TableExt.al`, 1 `.Page.al`.

So: map the compound kinds explicitly — `tableextension` -> `TableExt`,
`pageextension` -> `PageExt`, `enumextension` -> `EnumExt` — and fall back to
first-letter capitalisation for everything else. The fallback is what handles
the 100-of-103 simple cases and any kind the grammar gains later; the map only
exists because AL's own naming is not a pure capitalisation of the keyword.

This is cosmetic to the compiler, which reads content and ignores filenames.
It matters because the author browses `naive/` beside `correct/` and
`prereq/`, and an odd name there reads as a bug in the tool. Sanitise the name by stripping
surrounding quotes, replacing every character invalid in a Windows filename
(`< > : " / \ | ? *` and control characters) with `-`, then collapsing runs of
`-`. Refuse if the sanitised name starts with `<taskId>.` case-insensitively —
use `hasTaskPrefix`, so the reserved-prefix rule has one definition. Refuse if
two objects produce the same filename; that is invalid-but-emittable model
output and a silent overwrite would change the next probe verdict.

Promotion **replaces**: delete every existing `*.al` in `naive/` first, keep
`app.json` and any non-AL file. Report the deletions in `removed`.

Prepend a provenance header comment carrying model, attempt and timestamp.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/dashboard/promote-naive.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/dashboard/promote-naive.ts tests/unit/dashboard/promote-naive.test.ts
deno lint src/dashboard/promote-naive.ts tests/unit/dashboard/promote-naive.test.ts
deno check src/dashboard/promote-naive.ts
git add src/dashboard/promote-naive.ts tests/unit/dashboard/promote-naive.test.ts
git commit -m "feat(dashboard): promote a response into naive/ as one file per object

A model's genuine mistake is a more authentic wrong answer than an invented
one. Replaces rather than merges, because a stale object silently changes the
next probe verdict."
```

---

### Task 9: Promote route and UI action

**Files:**
- Modify: `src/dashboard/server.ts`
- Modify: `src/dashboard/ui/app.js`
- Test: `tests/unit/dashboard/authoring-server.test.ts` (extend)

**Interfaces:**
- Consumes: `promoteAsNaive`, `PromoteRefusal` (Task 8)
- Produces: `POST /api/promote-naive`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/dashboard/authoring-server.test.ts`:

```typescript
it("rejects a promote request naming an unknown draft", async () => {
  const res = await createHandler(deps)(
    new Request("http://localhost/api/promote-naive", {
      method: "POST",
      body: JSON.stringify({ draftDir: "nope", code: "codeunit 1 A { }", model: "m", attempt: 1 }),
    }),
  );
  assertEquals(res.status, 400);
});

it("rejects a promote request with no code", async () => {
  const res = await createHandler(deps)(
    new Request("http://localhost/api/promote-naive", {
      method: "POST",
      body: JSON.stringify({ draftDir: "/tmp/nope/CG-AL-X054", code: "", model: "m", attempt: 1 }),
    }),
  );
  assertEquals(res.status, 400);
});

it("refuses a foreign origin on the promote route", async () => {
  const res = await createHandler(deps)(
    new Request("http://localhost/api/promote-naive", {
      method: "POST",
      headers: { Origin: "http://evil.example" },
      body: JSON.stringify({ draftDir: "/tmp/nope/CG-AL-X054", code: "codeunit 1 A { }", model: "m", attempt: 1 }),
    }),
  );
  assertEquals(res.status, 403);
});
```

The literal `"/tmp/nope/CG-AL-X054"` above is the `dir` the existing `deps`
fixture's `listDrafts` already returns (`authoring-server.test.ts:50`) — reuse
it rather than introducing a second fixture.

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/dashboard/authoring-server.test.ts`
Expected: FAIL — the route 404s.

- [ ] **Step 3: Implement**

Add `POST /api/promote-naive` to `createHandler`, validated exactly like
`/api/run`: resolve `draftDir` against the listed drafts by `d.dir` (never by
`id` — two drafts can share an id), and 400 on an unknown directory or empty
code.

**Do NOT add a per-route Origin check.** `isSameOriginRequest` already runs at
the top of the handler, before routing and before the static files
(`server.ts:262-272`), so your route inherits it the moment it exists — a
foreign-origin request is refused whatever it asked for. Adding a second check
would be dead code implying the global one does not cover you.

The 403 test below is still worth writing: it pins that the NEW route is
actually covered by that global guard, which is a property of routing order
rather than of your route, and would break silently if someone later moved the
guard below the router. A `PromoteRefusal`
becomes a 400 carrying its message, so the author sees *why* rather than a
generic failure. Any other error is a 500.

In `app.js`, add a **Use as wrong answer** (naive/) action to the cell detail
panel, enabled only when that response has extractable code. On success show the
written filenames; on a 400 show the refusal message verbatim — the refusals are
the interesting part.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/dashboard/authoring-server.test.ts`
Then re-run the import-graph guard and confirm it returns `0`.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/dashboard/server.ts tests/unit/dashboard/authoring-server.test.ts
deno lint src/dashboard tests/unit/dashboard
deno check src/dashboard/server.ts
git add src/dashboard/server.ts src/dashboard/ui/app.js tests/unit/dashboard/authoring-server.test.ts
git commit -m "feat(dashboard): route and action for save-as-wrong-answer"
```

---

### Task 10: Pin the grammar shapes this plan depends on

**Files:**
- Create: `tests/unit/al/grammar-shape.test.ts`

**Why:** `vendor/tree-sitter-al` was bumped 2.5.1 -> 4.0.1 on 2026-08-12, so the
grammar is a moving dependency, not a fixed one. Plan 1 already pins the `_body`
wrapper node-type set, but that test cannot see the three shapes THIS plan
relies on. If a future bump changes any of them the binder does not crash — it
quietly stops flagging, which is the failure mode hardest to notice and the one
this whole plan exists to prevent.

The three shapes, each verified against the currently vendored wasm while this
plan was written:

1. A `field_declaration`'s named children are ordered `field_keyword`,
   `integer`, then the name (`quoted_identifier` or `identifier`), then
   `type_specification`. Task 1 reads the name **by position after the integer**.
2. A `member_expression` has exactly two identifier-ish children: the object
   then the property. Task 3 splits `X.Y` on that.
3. An `argument_list` distinguishes `identifier` / `quoted_identifier` from
   `integer` / `boolean`. Task 3 counts only the former as field names.

- [ ] **Step 1: Write the test**

Create `tests/unit/al/grammar-shape.test.ts`. Load the vendored grammar the same
way the other modules do, parse the fixture below, and assert each shape.
Failure messages must name which shape broke and say that the vendored grammar
may have changed — a bare "expected 2, got 3" would send the next reader hunting
in the wrong file.

```typescript
const FIXTURE = `table 69001 "T"
{
    fields
    {
        field(1; "Quoted Name"; Code[20]) { }
        field(2; Unquoted; Boolean) { }
    }
}
codeunit 70001 "C"
{
    procedure P(var Line: Record "T")
    begin
        Line.SetRange(Unquoted, 1);
        Line.Validate("Quoted Name", true);
    end;
}`;
```

**The three bullets below are the complete required set, and each must be its
own assertion** — not one combined check, and not a subset. The fixture above
is only the input; unlike other tasks in this plan there is no verbatim test
block here, so this list IS the specification.

Assert:
- The first `field_declaration`'s named children start `field_keyword`,
  `integer`, `quoted_identifier`; the second's third child is `identifier`.
- Every `member_expression` in the fixture has exactly 2 named children, both
  identifier-ish.
- `SetRange`'s `argument_list` children are `identifier` then `integer`;
  `Validate`'s are `quoted_identifier` then `boolean`.

- [ ] **Step 2: Prove it can fail**

Temporarily change one assertion to the wrong node type, confirm the test fails
and that the message names the shape, then restore it. Report both outputs. Do
not commit the temporary change.

- [ ] **Step 3: Format, lint, commit**

```bash
deno fmt tests/unit/al/grammar-shape.test.ts
deno lint tests/unit/al/grammar-shape.test.ts
git add tests/unit/al/grammar-shape.test.ts
git commit -m "test(al): pin the grammar shapes the prereq binder reads

The vendored grammar is a moving dependency. If a bump changes one of these
shapes the binder does not crash, it silently stops flagging - so the shapes
get a named failure instead."
```

---

### Task 11: Documentation

**Files:**
- Modify: `docs/task-authoring-guide.md`
- Modify: `docs/cli/commands.md`

- [ ] **Step 1: Extend the authoring guide**

In the step 4b block added by plan 1, describe the scoped rail: it lists what
each response referenced from `prereq/`, flags a name that exists in no prereq
as **Made up this field**, and labels an unresolvable one **Unknown member**
rather than accusing. State plainly that a hallucinated field is a *different*
failure from falling for the trap, and that telling them apart is what makes
calibration judgeable.

Document what actually shipped, which is more than the brief above originally
described: the rail heading **names the model whose references it is showing**
(`Already exists (prereq) — as referenced by <model>`), and **clicking any cell
in a model's column moves the rail onto that model** — the same click that opens
the detail panel. Before any cell is clicked it shows the first response,
labelled. Say this explicitly: on a multi-model run an unlabelled rail would
read as describing the whole run, and an author comparing four models needs to
know which one invented the field.

Also record the two states that are not findings: **Nothing from prereq/
referenced** when the analysis ran and found nothing, and **Couldn't check the
prereq** when it could not run at all. Those mean opposite things to an author —
the first says the response is clean, the second says go look at your draft.

Add a short paragraph on **Use as wrong answer** (naive/): a model's genuine
mistake is a more authentic wrong answer than an invented one; promotion
replaces `naive/`'s AL rather than merging, and refuses rather than overwriting
when two objects would collide.

- [ ] **Step 2: Extend the CLI reference**

In the `workbench` section's "What the screen shows" table, add **all four** new
labels with one-line meanings: **Made up this field**, **Unknown member**,
**Nothing from prereq/ referenced**, and **Couldn't check the prereq**. All four
are pinned by `tests/unit/dashboard/vocabulary.test.ts`, so the table and the UI
cannot drift apart silently — keep them identical.

- [ ] **Step 3: Commit**

```bash
git add docs/task-authoring-guide.md docs/cli/commands.md
git commit -m "docs: scoped prereq rail and save-as-wrong-answer"
```

---

## Done when

- The rail lists only what the selected response referenced, grouped by table.
- A field absent from every prereq shows **Made up this field**; an unresolvable
  member shows **Unknown member**; a base-app record never appears at all.
- A parse failure shows **Couldn't check the prereq** and the static listing.
- A response can be promoted into `naive/` as one file per object, with
  provenance, replacing prior AL and refusing on collision or reserved prefix.
- The suite is green with no decrease from 1026 passed / 3117 steps / 0 failed.
- `tests/unit/dashboard/ingest-safety.test.ts` still passes.

## Deliberately not in this plan

Escalation and the bench-lock check (plan 2). Findings 10 and 11 from plan 1's
final review — the in-cell id-mismatch badge and the left rail's `vscode://`
deep links — stay with plan 2, which reshapes the same surfaces.
