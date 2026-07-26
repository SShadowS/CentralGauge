# Prereq Apps for Task Dependencies

## Overview

Some benchmark tasks require pre-existing AL objects (tables, enums, interfaces) that the model should not create. For example, a page creation task needs an existing table to reference. Prereq apps provide these dependencies.

## Convention

Prereq apps are auto-detected by convention - no YAML changes needed:

```
tests/al/dependencies/{task-id}/
  app.json              # App manifest with static UUID
  {ObjectName}.{Type}.al  # AL object files
```

Example for CG-AL-E002:

```
tests/al/dependencies/CG-AL-E002/
  app.json
  ProductCategory.Table.al
```

## App.json Template

```json
{
  "id": "a1b2c3d4-{task-suffix}-0000-0000-000000000001",
  "name": "CG-AL-{ID} Prereq",
  "publisher": "CentralGauge",
  "version": "1.0.0.0",
  "platform": "27.0.0.0",
  "application": "27.0.0.0",
  "idRanges": [{ "from": 69000, "to": 69099 }],
  "runtime": "16.0",
  "features": ["NoImplicitWith"]
}
```

**App ID Convention:** Static UUIDs per task using pattern `a1b2c3d4-{segment}-0000-0000-{tail}`.

**`{segment}` must be four HEX digits.** `0-9` and `a-f` only. The task
letter is usually not one: `e002` happens to be valid hex, but `h022`,
`m034` and `x053` are not, and an AL app whose `app.json` carries an invalid
GUID fails to compile. Copying the shape of the `E002` line below onto an
`H`/`M`/`X` task is the mistake this section exists to prevent.

Real values from the committed tree:

| Task | App id | Note |
| --- | --- | --- |
| E002 | `a1b2c3d4-e002-0000-0000-000000000001` | `e002` is valid hex - a coincidence, not the rule |
| H022 | `a1b2c3d4-0ff0-0000-0000-000000000022` | 17 prereqs share `0ff0` and differ in the tail |
| H023 | `a1b2c3d4-0ff1-0000-0000-000000000023` | |
| X052 | `a1b2c3d4-0a52-0000-0000-000000000001` | X-series convention, below |

**X-series (ado-trap-2026 trap tasks):** `CG-AL-X<NN>` uses segment `0a<NN>`
with the tail fixed at `...0001` - `CG-AL-X052` -> `a1b2c3d4-0a52-0000-0000-000000000001`.
Verified against every committed X-series prereq. `centralgauge task new
--with-prereq` generates exactly this (`derivePrereqSuffix` in
`src/workbench/scaffold.ts`), so hand-derive it only when writing a prereq
outside the workbench. The two-digit segment caps the convention at `X099`;
scaffolding refuses `X100+` rather than emit a mis-sized segment, so extend
the convention deliberately when that day comes.

When hand-writing a prereq for a NEW task, check the id is unused:

```bash
grep -rh '"id"' tests/al/dependencies/*/app.json | sort
```

## ID Range Convention

To avoid conflicts between prereqs, generated code, and tests:

| Range       | Purpose                    |
| ----------- | -------------------------- |
| 69000-69999 | Prereq app objects         |
| 70000-79999 | Generated code (benchmark) |
| 80000-89999 | Test codeunits             |

## How It Works

When `al_verify` runs:

1. **Detection**: Extracts task ID from test file path (e.g., `CG-AL-E002.Test.al` → `CG-AL-E002`)
2. **Lookup**: Checks for prereq at `tests/al/dependencies/{task-id}/`. A caller may
   override this ONE lookup with an explicit directory (`handleAlVerify`'s `prereqDir`,
   reached via `scripts/trap-probe.ts --prereq-dir`) — that is how an unpromoted
   workbench draft compiles against the prereq still sitting in `scratch/<id>/prereq/`.
   Chained dependencies still resolve by app id under `tests/al/dependencies/`.
   The `al_verify` MCP tool does NOT expose it: a sandboxed agent must not be able to
   name a host directory to compile and publish.
3. **Compile**: If found, compiles prereq app first
4. **Inject**: Adds prereq as dependency in benchmark app's `app.json`
5. **Publish**: Publishes prereq before benchmark app during test execution

```
┌────────────────────────────────────┐    depends on    ┌─────────────────┐
│  Generated Code + Test Codeunit    │ ───────────────► │   Prereq App    │
│  (70001 page + 80002 test)         │                  │ (69001 table)   │
└────────────────────────────────────┘                  └─────────────────┘
```

## When to Use Prereq Apps

Use prereqs when a task should test a specific skill without requiring the model to create dependencies:

| Task Type                | Prereq Contains      |
| ------------------------ | -------------------- |
| Page creation            | Table definition     |
| Table extension          | Base table           |
| Interface implementation | Interface definition |
| Event subscriber         | Publisher codeunit   |

## Task Description Updates

When using a prereq, update the task YAML to clarify the object exists:

```yaml
# Before (ambiguous)
description: >-
  Create a page based on a table called "Product Category"...

# After (clear)
description: >-
  Create a page based on the existing "Product Category" table (ID 69001)...
```

## Chained Prereq Dependencies

Prereq apps can depend on other prereq apps. Add a `dependencies` array in app.json:

```json
{
  "id": "a1b2c3d4-h023-0000-0000-000000000001",
  "name": "CG-AL-H023 Prereq",
  "dependencies": [
    {
      "id": "a1b2c3d4-h022-0000-0000-000000000001",
      "name": "CG-AL-H022 Prereq",
      "publisher": "CentralGauge",
      "version": "1.0.0.0"
    }
  ]
}
```

The system resolves prereq dependencies recursively and publishes them in correct order:

```
┌──────────────────────────────┐
│  Generated Code + Test       │
│  (depends on H023 prereq)    │
└──────────────┬───────────────┘
               │ depends on
               ▼
┌──────────────────────────────┐
│  H023 Prereq                 │
│  (CG Related Record)         │
└──────────────┬───────────────┘
               │ depends on
               ▼
┌──────────────────────────────┐
│  H022 Prereq                 │
│  (CG Test Record)            │
└──────────────────────────────┘
```

Publishing order: H022 → H023 → Benchmark App

## Files Involved

- `mcp/al-tools-server.ts`: Detection, compilation, dependency injection
- `src/container/bc-container-provider.ts`: Prereq publishing in test script
- `tests/al/dependencies/{task-id}/`: Prereq app files
