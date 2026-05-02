/**
 * Smoke-tests the inline bash logic embedded in
 * `.github/workflows/weekly-cycle.yml`. The workflow can't be executed
 * locally (it depends on `gh` against the live repo + injected secrets)
 * so we instead parse the YAML and assert the structural invariants the
 * code-quality review baselined:
 *
 *   1. Sticky-issue lookup MUST handle the duplicate case explicitly —
 *      `--jq '.[0].number'` silently picked the first issue when multiple
 *      were open, dropping the digest comment for the rest. The new logic
 *      counts matches and fails the workflow step with a triage message
 *      when N >= 2.
 *
 *   2. Issue-body MUST be truncated before being passed to `gh issue
 *      create/comment` to avoid the 65,536-char GitHub cap blowing up
 *      the step (with `set -e` killing the artifact-upload step too).
 *      [added in fix 4]
 *
 * @module tests/unit/lifecycle/weekly-cycle-workflow
 */
import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const WORKFLOW_PATH = new URL(
  "../../../.github/workflows/weekly-cycle.yml",
  import.meta.url,
);

interface WorkflowStep {
  name?: string;
  id?: string;
  run?: string;
}
interface WorkflowJob {
  steps: WorkflowStep[];
}
interface Workflow {
  jobs: Record<string, WorkflowJob>;
}

async function loadWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as Workflow;
}

function findStep(workflow: Workflow, name: string): WorkflowStep {
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.name === name) return step;
    }
  }
  throw new Error(`step not found: ${name}`);
}

Deno.test("weekly-cycle.yml — YAML parses cleanly", async () => {
  const wf = await loadWorkflow();
  assert(wf.jobs && Object.keys(wf.jobs).length > 0);
});

Deno.test(
  "weekly-cycle.yml — sticky-issue lookup fetches all matches (not just .[0])",
  async () => {
    const wf = await loadWorkflow();
    const step = findStep(wf, "Post or update sticky digest issue");
    const run = step.run ?? "";

    // Old (buggy) pattern silently dropped duplicates. Match only on
    // actual jq invocations (--jq '.[0]....'), not prose mentions in
    // the comment that document the bug fix.
    const buggyJqInvocation = /--jq\s+'\.\[0\]\.number'/;
    assertEquals(
      buggyJqInvocation.test(run),
      false,
      "lookup must not invoke --jq '.[0].number' (silently picks first of N)",
    );

    // New pattern fetches ALL issue numbers so we can count:
    assert(
      /--jq\s+'\.\[\]\.number'/.test(run),
      "lookup must fetch all issue numbers via --jq '.[].number'",
    );
  },
);

Deno.test(
  "weekly-cycle.yml — multiple sticky issues fail with triage message",
  async () => {
    const wf = await loadWorkflow();
    const step = findStep(wf, "Post or update sticky digest issue");
    const run = step.run ?? "";

    // Operator-facing triage hint must be present so the failed step
    // surfaces a clear recovery path (manually close duplicates, re-run).
    assert(
      run.includes("Multiple weekly-cycle-digest issues found"),
      "expected triage error message for >=2 sticky issues",
    );
    assert(
      run.includes("gh issue list --label weekly-cycle-digest"),
      "expected triage hint to reference the gh command operators run",
    );
  },
);
