/**
 * Turn open GitHub issues into coord tasks.
 *
 * - An epic titled `[epic] c02: ...` becomes milestone `C02`; it is not a task.
 * - A child titled `c02.4: ...` becomes task `C02-04`. Its `Depends on: 2, 3`
 *   line (child numbers within the epic) becomes deps `C02-02, C02-03`;
 *   `Depends on: nothing` means no deps.
 * - Any other issue becomes `GH-<number>` with no deps.
 * - A child whose `Depends on:` line is missing or unparseable is skipped and
 *   reported, never guessed.
 */
import type { TaskHeader } from "./coord.ts";

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  url: string;
}

export interface PlannedTask {
  header: TaskHeader & { issue: number };
  body: string;
}

export interface ImportPlan {
  tasks: PlannedTask[];
  milestones: Record<string, { title: string; issue: number }>;
  skipped: { issue: number; reason: string }[];
}

const EPIC_RE = /^\[epic\]\s*(c\d+)\s*:\s*(.+)$/i;
const CHILD_RE = /^(c\d+)\.(\d+)\s*:/i;
const DEPENDS_RE = /depends on:\s*([^\n.]*)/i;

export function planImport(issues: GhIssue[], lane: string): ImportPlan {
  const plan: ImportPlan = { tasks: [], milestones: {}, skipped: [] };
  for (const i of [...issues].sort((a, b) => a.number - b.number)) {
    const epic = i.title.match(EPIC_RE);
    if (epic) {
      plan.milestones[epic[1]!.toUpperCase()] = {
        title: epic[2]!.trim(),
        issue: i.number,
      };
      continue;
    }
    const child = i.title.match(CHILD_RE);
    let id: string;
    let deps: string[] = [];
    if (child) {
      const prefix = child[1]!.toUpperCase();
      id = `${prefix}-${child[2]!.padStart(2, "0")}`;
      const dep = i.body.match(DEPENDS_RE)?.[1]?.trim();
      if (dep === undefined) {
        plan.skipped.push({
          issue: i.number,
          reason: `no "Depends on:" line in child ${id}`,
        });
        continue;
      }
      if (!/^(nothing|none)$/i.test(dep)) {
        const nums = dep.split(/\s*,\s*/);
        if (!nums.every((n) => /^\d+$/.test(n))) {
          plan.skipped.push({
            issue: i.number,
            reason: `cannot parse "Depends on: ${dep}"`,
          });
          continue;
        }
        deps = nums.map((n) => `${prefix}-${n.padStart(2, "0")}`);
      }
    } else {
      id = `GH-${String(i.number).padStart(2, "0")}`;
    }
    plan.tasks.push({
      header: { id, lane, deps, issue: i.number },
      body: `# ${i.title}\n\nGitHub issue #${i.number}: ${i.url}\n` +
        `Close it with the integrated commit when this task is accepted.\n\n${i.body.trim()}`,
    });
  }
  return plan;
}

/** Read open issues via the gh CLI (arguments passed as an array, never a shell string). */
export async function fetchOpenIssues(repo: string): Promise<GhIssue[]> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`bad repo: ${repo}`);
  }
  const out = await new Deno.Command("gh", {
    args: [
      "issue",
      "list",
      "-R",
      repo,
      "--state",
      "open",
      "--limit",
      "500",
      "--json",
      "number,title,body,url",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (out.code !== 0) {
    throw new Error(
      `gh issue list failed: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
  return JSON.parse(new TextDecoder().decode(out.stdout)) as GhIssue[];
}
