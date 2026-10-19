/**
 * H-35 (design-r4 4, design-r3 6.1): the task preimage store. Per oracle
 * hash, results/harness/task-oracle/<hash>.json holds the exact object
 * oracleHash hashed (`rule` oracleHash@1). It is written once, verified on
 * every read (it must hash to its name), and recovered from git history for
 * an oracle hash the harness never stored. The descriptor derived from it is
 * what judgments are validated against, never the task as it is today.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { exists } from "./fsutil.ts";
import { hashJson } from "./hash.ts";
import { oraclePreimage } from "./identity.ts";
import { loadTaskAt } from "./task-rev.ts";
import type { HarnessTask, LoadedTask } from "./task.ts";

const RULE = "oracleHash@1";

const TaskOracleSchema = z.strictObject({
  rule: z.literal(RULE),
  preimage: z.record(z.string(), z.unknown()),
  /** The commit a preimage was rebuilt from (design-r4 4, historical loading). */
  recovered_from: z.string().optional(),
});

/** The oracle side of one task version, as judgments are validated against it. */
export interface OracleDescriptor {
  kind: HarnessTask["kind"];
  scorers: string[];
  pass_to_pass: HarnessTask["pass_to_pass"];
  fail_to_pass: HarnessTask["fail_to_pass"];
  mutants: string[];
  production_allow: HarnessTask["production_allow"] | null;
  /** null: stored when first seen; a commit: rebuilt from history. */
  recovered_from: string | null;
}

const fileOf = (resultsRoot: string, hash: string) =>
  join(resultsRoot, "task-oracle", `${hash}.json`);

/**
 * Stores a task's preimage under its oracle hash unless already there (write
 * once; an existing file is left untouched). Returns the hash.
 */
export async function storeOraclePreimage(
  resultsRoot: string,
  task: LoadedTask,
  recoveredFrom?: string,
): Promise<string> {
  const preimage = await oraclePreimage(task);
  const hash = await hashJson(preimage);
  const file = fileOf(resultsRoot, hash);
  if (await exists(file)) return hash;
  await Deno.mkdir(join(resultsRoot, "task-oracle"), { recursive: true });
  const rec = {
    rule: RULE,
    preimage,
    ...(recoveredFrom ? { recovered_from: recoveredFrom } : {}),
  };
  try {
    await Deno.writeTextFile(file, JSON.stringify(rec, null, 2), {
      createNew: true,
    });
  } catch (err) {
    // A concurrent writer stored it first: the same content by construction.
    if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
  }
  return hash;
}

/**
 * The descriptor of an oracle hash: from the store (verified), else rebuilt
 * from git history when `history` is given (then stored), else "unknown"
 * (judgments on it report as legacy_unknown_task).
 */
export async function loadOracleDescriptor(
  resultsRoot: string,
  hash: string,
  history?: { repoRoot: string; taskId: string; workDir: string },
): Promise<OracleDescriptor | "unknown"> {
  const file = fileOf(resultsRoot, hash);
  if (!await exists(file)) {
    if (!history) return "unknown";
    const commit = await recover(resultsRoot, hash, history);
    if (commit === null) return "unknown";
  }
  const rec = TaskOracleSchema.parse(JSON.parse(await Deno.readTextFile(file)));
  if (await hashJson(rec.preimage) !== hash) {
    throw new ValidationError(
      `task-oracle/${hash}.json does not hash to its name (a store defect)`,
      [file],
    );
  }
  const p = rec.preimage as Record<string, unknown>;
  return {
    kind: p["kind"] as OracleDescriptor["kind"],
    scorers: p["scorers"] as string[],
    pass_to_pass: p["pass_to_pass"] as OracleDescriptor["pass_to_pass"],
    fail_to_pass: p["fail_to_pass"] as OracleDescriptor["fail_to_pass"],
    mutants: p["mutants"] as string[],
    production_allow:
      (p["production_allow"] ?? null) as OracleDescriptor["production_allow"],
    recovered_from: rec.recovered_from ?? null,
  };
}

/** The commit whose task version hashes to `hash`, stored; or null. */
async function recover(
  resultsRoot: string,
  hash: string,
  h: { repoRoot: string; taskId: string; workDir: string },
): Promise<string | null> {
  const out = await new Deno.Command("git", {
    args: ["log", "--format=%H", "--", `harness-tasks/tasks/${h.taskId}`],
    cwd: h.repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) return null;
  const commits = new TextDecoder().decode(out.stdout).split("\n")
    .map((c) => c.trim()).filter(Boolean);
  for (const commit of commits) {
    let at;
    try {
      at = await loadTaskAt(
        h.repoRoot,
        h.taskId,
        commit,
        join(h.workDir, commit.slice(0, 12)),
      );
    } catch {
      continue; // a version that does not load cannot be the one judged
    }
    if (await hashJson(await oraclePreimage(at.task)) === hash) {
      await storeOraclePreimage(resultsRoot, at.task, commit);
      return commit;
    }
  }
  return null;
}
