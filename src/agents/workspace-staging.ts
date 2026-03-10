/**
 * Workspace Staging for Agent Execution
 *
 * Stages agent context files (.claude/ and CLAUDE.md) into the task
 * working directory using symlinks where possible, with copy fallback.
 * Provides automatic cleanup after execution.
 */

import { exists } from "@std/fs";
import { join } from "@std/path";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("agent:workspace");

/**
 * Result of staging agent workspace files.
 */
export interface StagedWorkspace {
  /** Paths that were staged (for tracking) */
  stagedPaths: string[];
  /** Backup paths mapped to their original paths */
  backedUpPaths: Array<{ backup: string; original: string }>;
  /** Remove all staged files and restore backups */
  cleanup(): Promise<void>;
}

/**
 * Stage agent context files into the target working directory.
 *
 * - `.claude/` directory: junction symlink (works without admin on Windows)
 * - `CLAUDE.md`: file symlink with copy fallback
 *
 * @param sourceDir - Directory containing agent's .claude/ and CLAUDE.md
 * @param targetDir - Task working directory to stage into
 */
export async function stageAgentWorkspace(
  sourceDir: string,
  targetDir: string,
): Promise<StagedWorkspace> {
  const stagedPaths: string[] = [];
  const backedUpPaths: Array<{ backup: string; original: string }> = [];

  // Stage .claude/ directory
  const claudeDirSource = join(sourceDir, ".claude");
  const claudeDirTarget = join(targetDir, ".claude");

  if (await exists(claudeDirSource)) {
    if (await exists(claudeDirTarget)) {
      const backupPath = join(targetDir, ".claude.bak");
      try {
        await Deno.remove(backupPath, { recursive: true });
      } catch {
        // Backup didn't exist
      }
      await Deno.rename(claudeDirTarget, backupPath);
      backedUpPaths.push({ backup: backupPath, original: claudeDirTarget });
      log.debug("Backed up existing .claude/", { backupPath });
    }
    try {
      await Deno.symlink(claudeDirSource, claudeDirTarget, {
        type: "junction",
      });
      stagedPaths.push(claudeDirTarget);
      log.debug("Staged .claude/ via junction", {
        source: claudeDirSource,
      });
    } catch {
      // Junction failed — fall back to copy
      await copyDir(claudeDirSource, claudeDirTarget);
      stagedPaths.push(claudeDirTarget);
      log.debug("Staged .claude/ via copy (junction failed)");
    }
  }

  // Stage CLAUDE.md
  const claudeMdSource = join(sourceDir, "CLAUDE.md");
  const claudeMdTarget = join(targetDir, "CLAUDE.md");

  if (await exists(claudeMdSource)) {
    if (await exists(claudeMdTarget)) {
      const backupPath = join(targetDir, "CLAUDE.md.bak");
      try {
        await Deno.remove(backupPath);
      } catch {
        // Backup didn't exist
      }
      await Deno.rename(claudeMdTarget, backupPath);
      backedUpPaths.push({ backup: backupPath, original: claudeMdTarget });
    }
    try {
      await Deno.symlink(claudeMdSource, claudeMdTarget, { type: "file" });
      stagedPaths.push(claudeMdTarget);
      log.debug("Staged CLAUDE.md via symlink");
    } catch {
      // File symlink needs Developer Mode on Windows — fall back to copy
      await Deno.copyFile(claudeMdSource, claudeMdTarget);
      stagedPaths.push(claudeMdTarget);
      log.debug("Staged CLAUDE.md via copy (symlink failed)");
    }
  }

  return {
    stagedPaths,
    backedUpPaths,
    async cleanup(): Promise<void> {
      for (const path of stagedPaths) {
        try {
          await Deno.remove(path, { recursive: true });
        } catch {
          // Already cleaned up
        }
      }
      for (const { backup, original } of backedUpPaths) {
        try {
          await Deno.rename(backup, original);
        } catch {
          // Backup may have been removed
        }
      }
    },
  };
}

/** Recursively copy a directory */
async function copyDir(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}
