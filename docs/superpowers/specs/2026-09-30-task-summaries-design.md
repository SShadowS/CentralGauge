# Human-readable task summaries

Date: 2026-09-30. Status: awaiting owner review.

## Problem

A task's `description` in `tasks/**/*.yml` is the model prompt: prompt templates
insert it verbatim (`templates/diagnose-objects.md:13` has `{{description}}`). The
site's task page renders that same text (`TaskDetailPanel.svelte:47`). For
composite and minimal-symptom tasks the prompt is deliberately dense and opaque
(CG-AL-X185 is one paragraph covering four subsystems), so a human visitor
cannot tell what the task is about.

The description cannot be rewritten for readability: `tasks/**/*.yml` is inside
the task-set hash, so any edit creates a new task set and forces a full re-bench,
and it would also change what the models are asked.

## Goals

1. Every task page can show a short, plain-English summary written for humans.
2. The model prompt is unchanged and stays visible on the page, verbatim.
3. A summary can never silently drift from the description it summarises.
4. New tasks ship with a summary; authoring without one fails CI.
5. A summary never reveals a task's answer.

Non-goals: rewriting any existing description; any change to the task-set hash,
prompts, scoring or ingest.

## Decisions

| ID | Decision |
| -- | -------- |
| S1 | Summaries live in one file outside the hash scope: `site/catalog/task-summaries.md`. |
| S2 | Each entry records `description_sha`, the SHA-256 (hex) of the task's `description` string exactly as parsed from its YAML. |
| S3 | A Deno audit (`deno task summary-audit`) fails CI on a missing summary, a stale `description_sha`, an entry for a task that does not exist, or a stale baseline entry. |
| S4 | Existing tasks without a summary are listed in `site/catalog/task-summaries.baseline.txt`. The baseline only shrinks: the audit fails if a baselined task has a summary, and every task NOT on the baseline must have one. New tasks are never added to it. |
| S5 | The site bundles the summaries file at build time (Vite `?raw`, the same pattern as `site/src/lib/server/changelog.ts`). No D1 table, no migration, no admin endpoint, no sync step. A redeploy publishes changes. |
| S6 | The task page shows the summary first, then the verbatim description inside a collapsed `<details>` titled "Exact model prompt". A task without a summary renders exactly as today. |
| S7 | Summaries describe what a task covers, never what is wrong or how to fix it (rules below). This is an authoring rule enforced by review; the audit cannot check it. |

## File format

Markdown, because summaries are prose and the audit and site can parse it without a
YAML dependency:

```markdown
# Task summaries

Human-readable summaries shown on the site's task pages. See
docs/superpowers/specs/2026-09-30-task-summaries-design.md for the rules.

## CG-AL-X185
description_sha: <64 lowercase hex, from summary-audit --print-sha CG-AL-X185>

Four independent parts of one application: a wire-format converter for an
external service, a nightly legacy-amount import, a travel-allowance calculator,
and a cross-company meter-reading consolidator. The report gives only one vague
symptom. The model must find and fix every place where the stated contracts no
longer hold.
```

- Entry header: `## <task id>`, exactly one per task, ids unique.
- First non-empty line after the header: `description_sha: <64 lowercase hex>`.
- The rest, up to the next `##`, is the summary body (markdown, 1 to 5 sentences,
  at most 600 characters).
- Text before the first `##` is ignored.

Baseline file: one task id per line, `#` comments allowed, sorted.

## Summary content rules (S7)

A summary may state:
- the kind of task (build from spec, runtime trap, diagnose, composite) and its
  difficulty;
- which objects or subsystems it touches, in plain words;
- what the model is asked to deliver, at the level the prompt already states it.

A summary must not state:
- which object, procedure or line is defective, or what the defect is;
- the BC platform behaviour a trap relies on;
- any hint the prompt deliberately withholds (for example, where a
  minimal-symptom task's fault starts).

Rule of thumb: a model shown the summary instead of the prompt learns nothing that
helps it pass. The site is public and summaries may reach future training data.

## Audit (`deno task summary-audit`)

- Script: `scripts/audit-task-summaries.ts` (Deno, `--allow-read`), wired in
  `deno.json` and in `.github/workflows/ci.yml` next to `taxonomy-audit`.
- It reads every `tasks/**/*.yml` with the same loader the bench uses (so
  `description` is parsed identically), the summaries file and the baseline.
- Failures, each printed with the task id and the fix:
  1. A task neither summarised nor baselined: "add a summary".
  2. `description_sha` mismatch: "description changed; re-read the summary, update
     it if needed, then set description_sha to <current>".
  3. A summary entry whose id matches no task: "remove the entry".
  4. A baselined id that also has a summary, or that matches no task: "remove it
     from the baseline".
  5. A malformed entry (missing or malformed sha line, duplicate id, body empty or
     over 600 characters).
- Flag `--print-sha <task id>` prints the current `description_sha`, so authors
  never hash by hand.
- Exit 0 prints a one-line count: summarised, baselined, total.

## Site

- `site/src/lib/server/task-summaries.ts` parses the bundled file into
  `Map<taskId, { summary: string }>` (the sha is audit-only and not exposed).
- `/api/v1/tasks/[...id]` adds `summary: string | null` to its response. The task
  list endpoint is unchanged.
- `TaskDetailPanel.svelte`: when `summary` is present, render it through the
  existing `MarkdownRenderer`, then the description inside
  `<details><summary>Exact model prompt</summary>...</details>`. When absent,
  render as today.
- The task response shape changes, so bump `CACHE_VERSION` if the task endpoint's
  response is cached under it (check at implementation; bump only if it is).

## Authoring requirement

- `CLAUDE.md`, "Writing Task Specifications (YAML)": add a rule that every new
  task needs a summary entry in `site/catalog/task-summaries.md`, following the
  content rules, with `description_sha` from `deno task summary-audit --print-sha
  <id>`.
- `create-task` and `extract-trap-task` skills: add the summary step before the
  task is committed.
- The `al-test-auditor` agent checks the summary against the S7 content rules when
  it audits a task.

## Rollout

1. Ship the audit, the empty-but-valid summaries file, a baseline containing every
   current task id, the site change and the authoring rules. CI is green; nothing
   is visible yet.
2. Backfill in batches, composites first (43 tasks tagged `composite`), then other
   long descriptions. Each batch removes its ids from the baseline and is reviewed
   by the owner before merge.
3. Deploy after each batch (no migration).

## Testing

- Audit: unit tests over fixture directories for each failure class, the
  `--print-sha` output, and the pass case.
- Parser: unit test over a sample file (header, sha line, body, preamble ignored,
  duplicate id rejected).
- Site: API test that a summarised task returns `summary` and an unsummarised one
  returns `null`; component test that the panel renders the summary plus the
  collapsed prompt, and today's layout without a summary.

## Out of scope

- Rewriting descriptions.
- Automatic leak detection (S7 stays a review rule).
- Summaries on the task list page.
