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

/**
 * "ok", "missing", or "link" (links and junctions are never task content).
 * Every component between the task folder and the target is checked, so a
 * file reached through a linked ancestor folder is a link too.
 */
async function probe(
  dir: string,
  rel: string,
  kind: "file" | "dir",
): Promise<"ok" | "missing" | "link"> {
  const parts = normalize(rel).replaceAll("\\", "/").split("/")
    .filter((p) => p !== "" && p !== ".");
  let p = dir;
  try {
    for (const [i, part] of parts.entries()) {
      p = join(p, part);
      const s = await Deno.lstat(p);
      if (s.isSymlink) return "link";
      if (i < parts.length - 1 && !s.isDirectory) return "missing";
      if (i === parts.length - 1) {
        return (kind === "file" ? s.isFile : s.isDirectory) ? "ok" : "missing";
      }
    }
    return "missing";
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
    const r = await probe(dir, rel, kind);
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
