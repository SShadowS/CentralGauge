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
import { basename, dirname } from "@std/path";
import {
  parseTaskSummaries,
  type TaskSummariesParse,
} from "../shared/task-summaries.ts";
import { loadTaskManifest } from "../src/tasks/loader.ts";

const SUMMARIES = "site/catalog/task-summaries.md";
const HX_SUMMARIES = "site/catalog/hx-task-summaries.md";
const BASELINE = "site/catalog/task-summaries.baseline.txt";

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
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
  const summarised = new Map(
    input.summaries.entries.map((e) => [e.id, e.descriptionSha]),
  );
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
      failures.push(
        `${id}: summary for a task that does not exist; remove the entry`,
      );
    }
  }
  for (const id of input.baseline) {
    if (summarised.has(id)) {
      failures.push(`${id}: has a summary; remove it from ${BASELINE}`);
    } else if (!taskSha.has(id)) {
      failures.push(
        `${id}: baselined but no such task; remove it from ${BASELINE}`,
      );
    }
  }
  return failures;
}

/**
 * HX (setups) tasks: same sha / length / duplicate rules, but no baseline. A
 * task without a summary is allowed; its page shows "No summary yet."
 */
export function auditHxSummaries(
  input: Pick<AuditInput, "tasks" | "summaries">,
): string[] {
  const failures = [...input.summaries.errors];
  const taskSha = new Map(input.tasks.map((t) => [t.id, t.descriptionSha]));
  for (const e of input.summaries.entries) {
    const sha = taskSha.get(e.id);
    if (sha === undefined) {
      failures.push(
        `${e.id}: summary for a task that does not exist; remove the entry`,
      );
    } else if (sha !== e.descriptionSha) {
      failures.push(
        `${e.id}: description changed; re-read the summary, update it if needed, then set description_sha to ${sha}`,
      );
    }
  }
  return failures;
}

/** HX description_sha is sha256 of the exact prompt.md text. */
export async function loadHxTasks(): Promise<
  Array<{ id: string; descriptionSha: string }>
> {
  const out: Array<{ id: string; descriptionSha: string }> = [];
  for await (const f of expandGlob("harness-tasks/tasks/*/prompt.md")) {
    if (!f.isFile) continue;
    out.push({
      id: basename(dirname(f.path)),
      descriptionSha: await sha256Hex(await Deno.readTextFile(f.path)),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function loadTasks(): Promise<
  Array<{ id: string; descriptionSha: string }>
> {
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
  const hxTasks = await loadHxTasks();
  const summaries = parseTaskSummaries(await readOr(SUMMARIES, ""));
  const hxSummaries = parseTaskSummaries(await readOr(HX_SUMMARIES, ""));
  const printSha = Deno.args.indexOf("--print-sha");
  if (printSha !== -1) {
    const id = Deno.args[printSha + 1];
    const t = [...tasks, ...hxTasks].find((x) => x.id === id);
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
  const failures = [
    ...auditSummaries({ tasks, summaries, baseline }),
    ...auditHxSummaries({ tasks: hxTasks, summaries: hxSummaries }).map((f) =>
      `${f} (${HX_SUMMARIES})`
    ),
  ];
  if (failures.length > 0) {
    for (const f of failures) console.error(`[FAIL] ${f}`);
    Deno.exit(1);
  }
  console.log(
    `[OK] summary-audit: ${summaries.entries.length} summarised, ${baseline.length} baselined, ${tasks.length} tasks; ${hxSummaries.entries.length} of ${hxTasks.length} HX tasks summarised`,
  );
}
