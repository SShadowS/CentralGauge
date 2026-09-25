/** Load a task from an immutable git revision (round 2 item 11). */

import { basename, join } from "@std/path";
import { ValidationError } from "../errors.ts";
import { TAR_BINARY } from "./staging.ts";
import { type LoadedTask, loadTask } from "./task.ts";

export interface TaskAt {
  task: LoadedTask;
  /** Resolved commit, or null for the working tree. */
  commit: string | null;
  /** Tree id of harness-tasks/tasks/<id> at that commit (M4's TASK TREE), or null. */
  tree: string | null;
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args,
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new ValidationError(
      `git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr).trim()}`,
      args,
    );
  }
  return new TextDecoder().decode(out.stdout).trim();
}

export async function loadTaskAt(
  repoRoot: string,
  taskId: string,
  rev: string | null,
  outDir: string,
): Promise<TaskAt> {
  if (!/^HX-\d{3}$/.test(taskId)) {
    throw new ValidationError(`not a task id: ${taskId}`, [taskId]);
  }
  const rel = `harness-tasks/tasks/${taskId}`;
  if (rev === null) {
    return {
      task: await loadTask(join(repoRoot, rel)),
      commit: null,
      tree: null,
    };
  }
  const commit = await git(repoRoot, [
    "rev-parse",
    "--verify",
    `${rev}^{commit}`,
  ]);
  const tree = await git(repoRoot, ["rev-parse", `${commit}:${rel}`]);
  await Deno.mkdir(outDir, { recursive: true });
  const tar = join(outDir, `${taskId}-${commit.slice(0, 12)}.tar`);
  // Raw blobs (as stageRefappTask): the revision's bytes, never autocrlf-converted.
  await git(repoRoot, [
    "-c",
    "core.autocrlf=false",
    "archive",
    "--format=tar",
    "-o",
    tar,
    commit,
    rel,
  ]);
  // The pinned System32 tar with a relative name (a PATH tar may read "C:" as a host).
  const out = await new Deno.Command(TAR_BINARY, {
    args: ["-xf", basename(tar)],
    cwd: outDir,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new ValidationError(
      `tar: ${new TextDecoder().decode(out.stderr).trim()}`,
      [tar],
    );
  }
  return {
    task: await loadTask(join(outDir, ...rel.split("/"))),
    commit,
    tree,
  };
}
