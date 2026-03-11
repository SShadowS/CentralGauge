/**
 * Workspace Staging for Agent Execution
 *
 * Stages all files and directories from an agent's workspace into the task
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
 * Stage all files and directories from sourceDir into targetDir.
 *
 * Directories are linked via junction symlink (copy fallback).
 * Files are linked via file symlink (copy fallback).
 * Existing entries in targetDir are backed up with .bak suffix.
 *
 * @param sourceDir - Agent workspace directory containing config files
 * @param targetDir - Task working directory to stage into
 */
export async function stageAgentWorkspace(
  sourceDir: string,
  targetDir: string,
): Promise<StagedWorkspace> {
  const stagedPaths: string[] = [];
  const backedUpPaths: Array<{ backup: string; original: string }> = [];

  if (!await exists(sourceDir)) {
    return { stagedPaths, backedUpPaths, async cleanup() {} };
  }

  for await (const entry of Deno.readDir(sourceDir)) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    // Backup existing entry if present
    if (await exists(targetPath)) {
      const backupPath = join(targetDir, `${entry.name}.bak`);
      try {
        await Deno.remove(backupPath, { recursive: true });
      } catch {
        // Backup didn't exist
      }
      await Deno.rename(targetPath, backupPath);
      backedUpPaths.push({ backup: backupPath, original: targetPath });
      log.debug("Backed up existing entry", { name: entry.name });
    }

    if (entry.isDirectory) {
      // Directories: junction symlink with copy fallback
      try {
        await Deno.symlink(sourcePath, targetPath, { type: "junction" });
        stagedPaths.push(targetPath);
        log.debug("Staged directory via junction", { name: entry.name });
      } catch {
        await copyDir(sourcePath, targetPath);
        stagedPaths.push(targetPath);
        log.debug("Staged directory via copy (junction failed)", {
          name: entry.name,
        });
      }
    } else {
      // Files: file symlink with copy fallback
      try {
        await Deno.symlink(sourcePath, targetPath, { type: "file" });
        stagedPaths.push(targetPath);
        log.debug("Staged file via symlink", { name: entry.name });
      } catch {
        await Deno.copyFile(sourcePath, targetPath);
        stagedPaths.push(targetPath);
        log.debug("Staged file via copy (symlink failed)", {
          name: entry.name,
        });
      }
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
