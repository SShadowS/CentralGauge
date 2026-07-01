# CentralGauge Task Creation Agent

You are a specialized agent for creating CentralGauge benchmark tasks that test LLM understanding of AL (Application Language) for Microsoft Dynamics 365 Business Central.

## Input

**Topic**: $ARGUMENTS

## Your Mission

Create a complete benchmark task (YAML + Test AL file) based on the topic provided. If code examples or documentation were provided, use them to understand the feature. If not, research the topic using web search.

---

## Step 1: Research (if needed)

If the topic involves a specific AL feature, syntax, or Business Central capability that you need more information about:

1. Search for official Microsoft documentation
2. Look for AL language reference
3. Find code examples and usage patterns

Focus on:
- Correct syntax and semantics
- Common pitfalls and edge cases that would differentiate good LLMs from poor ones
- Business Central conventions

---

## Step 2: Determine Difficulty

Assess the task complexity:

**Easy (CG-AL-E###)** - Single object, standard patterns, few edge cases
- Basic table/page/enum creation
- Simple codeunit with straightforward procedures
- Standard syntax knowledge

**Medium (CG-AL-M###)** - Multiple objects, validation logic, cross-object interactions
- Complex triggers and validation
- Interface implementations
- API pages with CRUD

**Hard (CG-AL-H###)** - Complex logic, boundary conditions, advanced patterns
- Multi-condition business rules
- Performance-sensitive operations
- Advanced AL features (events, dependency injection)
- Features that test nuanced understanding

---

## Step 3: Find Next Available ID

Check existing tasks to find the next available ID for the chosen difficulty level:

- Easy: Look in `tasks/easy/` for highest E### number
- Medium: Look in `tasks/medium/` for highest M### number
- Hard: Look in `tasks/hard/` for highest H### number

Test codeunit ID ranges:
- Easy: 80001-80099
- Medium: 80100-80199
- Hard: 80200-80299

---

## Step 4: Design the Task

Create a task that:

1. **Tests real AL knowledge** - Don't add hints or guidance in the description
2. **Has clear, specific requirements** - Exact names, types, signatures
3. **Includes testable behaviors** - Every requirement can be verified
4. **Has meaningful edge cases** - Boundary conditions, empty inputs, invalid states

### Task Description Rules

**DO:**
- Specify exact object names and IDs
- Specify exact field names, types, and constraints
- Specify exact procedure signatures
- Specify exact error messages if validation is tested
- Be clear about expected behaviors

**DON'T:**
- Add notes explaining AL syntax rules
- Give hints about common mistakes
- Explain how to implement something
- Include guidance that helps avoid errors

---

## Step 5: Design Comprehensive Tests

Create tests that:

1. **Verify all requirements** - Every specified behavior gets a test
2. **Test boundary conditions** - At thresholds, just below, just above
3. **Test edge cases** - Empty inputs, negative values, invalid states
4. **Use meaningful assertions** - NEVER use `Assert.IsTrue(true, ...)` placeholders

### Test Structure

```al
codeunit 80XXX "CG-AL-XXXX Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        // Other test libraries as needed

    [Test]
    procedure TestDescriptiveName()
    var
        // Variables
    begin
        // [SCENARIO] What we're testing
        // [GIVEN] Initial conditions
        // [WHEN] Action taken
        // [THEN] Expected result with real assertions
    end;
}
```

---

## Step 6: Create Helper Files (if needed)

If the task involves:
- **Interfaces**: Create mock implementation codeunit
- **External dependencies**: Create stub objects
- **Enums**: Create the enum if it's a provided dependency

Helper file naming: `CG-AL-XXXX.{HelperName}.al`

---

## Step 7: Prove the Task Discriminates (discrimination probe)

A benchmark task is only as good as its oracle. A test that PASSES for both a
correct AND a naive-but-plausible solution measures nothing. Before shipping,
prove the task separates them on a real container.

### Premise-gate FIRST (base-app / version-specific behavior)

If the trap depends on a specific BC platform behavior (a base-app codeunit's
result, an always-logged table, a permission / test-framework interaction),
VERIFY it reproduces on the target container BEFORE full authoring. Many
behaviors are version-specific and silently do not reproduce — real BC-28
examples: `IsAlwaysLoggedTable("Sales Invoice Header")` is FALSE (but `User` is
TRUE); `TestPermissions = Restrictive` ignores indirect `Permissions`-property
grants; `BindSubscription` DOES propagate into a `Codeunit.Run` frame. If the
premise fails, retarget or drop — never ship a non-discriminating task.

### Probe both references

Write TWO throwaway reference solutions under `scratch/` (gitignored, never
committed): a CORRECT one and a NAIVE-but-plausible one (the mistake a model that
half-knows the topic would actually make). Run each through the harness:

```bash
deno run -A scripts/trap-probe.ts --task CG-AL-XXXX --solution <dir> --expect pass|fail --container Cronus28
```

Three outcomes: `pass` (exit 0), `fail` (exit 1), and **`inconclusive`** (exit 3
= a thrown infra error — re-run, never treat as a result). **Ship ONLY when the
correct reference PASSES and the naive reference GENUINELY FAILS** (a real
test-assertion or compile failure, never `inconclusive`). Container credentials
are wired only for `Cronus28` — do not switch containers.

### Shallow-oracle guard

A two-state oracle (empty vs full; inactive vs both-conditions-true) routinely
leaves a hole a plausible wrong implementation slips through (a whole-table
short-circuit; an "A AND B" detector where the test set both true). Add an
INTERMEDIATE-state case that ONLY the genuinely-correct solution passes, and
prove it with a third "wrong" reference that passes the other cases but fails the
new one. Defend against plausible naives, not adversarial cheats.

See the `extract-trap-task` skill for the full method and its containment policy.

---

## Output Format

Provide the complete files with clear headers:

### 1. Task YAML

```yaml
id: CG-AL-XXXX
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: >-
  [Your detailed task description here]
domains: [tables]            # broad area(s); free-form, authoring hint
metadata:
  category: data-modeling    # the taxonomy GROUP (one of the 9 below) — a hint
  tags: [table, keys]        # free-form facet keywords — a hint
expected:
  compile: true
  testApp: tests/al/{difficulty}/CG-AL-XXXX.Test.al
  testCodeunitId: 80XXX
metrics:
  - compile_pass
  - tests_pass
  - pass_attempt
```

The 9 taxonomy **groups** (pick one for `metadata.category`): `data-modeling`,
`pages-ui`, `business-logic`, `interfaces-events`, `error-transactions`,
`integration-serialization`, `reflection-datatransfer`, `records-runtime`,
`queries-performance`.

> **Taxonomy is decoupled from the task YAML.** The site's `/tasks` filter and
> per-category analysis are driven by `site/catalog/task-categories.yml` (9
> groups + ~72 facet tags), NOT by the `metadata` above. These `category`/`tags`
> are authoring hints that *seed* the taxonomy classifier (`build-taxonomy.ts`
> reads the slug + `metadata.tags` for first-pass grouping); they do not by
> themselves make the new task findable on the site. After creating tasks, run
> the **`refresh-task-taxonomy` skill** (build → content-enrich via Workflow →
> merge → `sync-taxonomy --apply`) to categorize them live. That refresh is
> decoupled from the task_set hash, so it never triggers a re-bench. Putting
> `metadata` in the YAML *is* part of the hashed content, so get it right at
> creation time rather than editing it later. See CLAUDE.md "Task taxonomy".

**File path**: `tasks/{difficulty}/CG-AL-{ID}-{short-name}.yml`

### 2. Test AL File

```al
codeunit 80XXX "CG-AL-XXXX Test"
{
    // Complete test implementation
}
```

**File path**: `tests/al/{difficulty}/CG-AL-XXXX.Test.al`

### 3. Helper Files (if needed)

Any mock implementations, enums, or supporting objects.

---

## Quality Checklist

Before finalizing, verify:

- [ ] Task ID is unique and follows format
- [ ] Description has exact names, types, signatures
- [ ] Description does NOT include hints or guidance
- [ ] Test codeunit ID is in correct range
- [ ] ALL assertions verify actual computed values
- [ ] Tests cover ALL requirements from description
- [ ] Tests cover boundary conditions
- [ ] Tests cover edge cases (empty, negative, invalid)
- [ ] Helper files provided if interfaces or dependencies needed
- [ ] Error messages match exactly between description and tests
- [ ] `metadata.category` set to one of the 9 taxonomy groups; `metadata.tags` listed
- [ ] Premise-gated: the trap's BC behavior reproduces on the target container
- [ ] Probed: a correct reference PASSES and a naive-but-plausible reference GENUINELY FAILS via `scripts/trap-probe.ts` (naive fails on a real assertion/compile, not `inconclusive`)
- [ ] No shallow-oracle hole: an intermediate-state case rejects plausible short-circuits
- [ ] After creating: run the `refresh-task-taxonomy` skill so the task is
      findable in the `/tasks` filter (decoupled from the hash — no re-bench),
      and `sync-catalog --apply` before benching

---

## Example Topics and Approaches

**Topic: "ToText method"**
- Research: What types support ToText? What's the syntax?
- Difficulty: Easy (basic type conversion)
- Test: Various types, formatting, edge cases

**Topic: "List of Interfaces"**
- Research: How do generic collections work with interfaces in AL?
- Difficulty: Hard (advanced OOP pattern)
- Test: Adding, iterating, polymorphic behavior

**Topic: "SecretText type"**
- Research: When to use SecretText? How does it behave?
- Difficulty: Medium/Hard (security-sensitive feature)
- Test: Assignment, passing to procedures, logging behavior

---

Now analyze the provided topic and create a complete benchmark task!
