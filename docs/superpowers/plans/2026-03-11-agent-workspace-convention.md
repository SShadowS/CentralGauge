# Agent Workspace Convention Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-discover agent companion folders and generalize workspace staging so each agent's full workbench is staged into task directories.

**Architecture:** Two changes: (1) `loadAgentConfigs()` detects companion folders by filename stem and sets `workingDir`, (2) `stageAgentWorkspace()` iterates all source directory entries instead of hardcoding `.claude/` + `CLAUDE.md`. Both use existing symlink/copy patterns.

**Tech Stack:** Deno/TypeScript

**Spec:** `docs/superpowers/specs/2026-03-11-agent-workspace-convention-design.md`

---

## File Structure

| File                                          | Action  | Purpose                                           |
| --------------------------------------------- | ------- | ------------------------------------------------- |
| `src/agents/workspace-staging.ts`             | Rewrite | Generalize to stage all directory contents        |
| `src/agents/loader.ts`                        | Modify  | Auto-detect companion folder and set `workingDir` |
| `tests/unit/agents/workspace-staging.test.ts` | Modify  | Add tests for arbitrary file/dir staging          |
| `tests/unit/agents/loader.test.ts`            | Modify  | Add tests for companion folder detection          |

---

## Chunk 1: Generalize Workspace Staging

### Task 1: Stage arbitrary files

**Files:**

- Modify: `tests/unit/agents/workspace-staging.test.ts`
- Modify: `src/agents/workspace-staging.ts`

- [ ] **Step 1: Write failing test for staging arbitrary files**

In `tests/unit/agents/workspace-staging.test.ts`, add a new test step inside the existing `Deno.test("stageAgentWorkspace", ...)` block, after the "returns empty staged when no files exist" step:

```typescript
await t.step("stages all files from source directory", async () => {
  const sourceDir = await createTempDir("stage-all-src");
  const targetDir = await createTempDir("stage-all-tgt");

  try {
    // Create various files in source
    await Deno.writeTextFile(`${sourceDir}/CLAUDE.md`, "# Rules");
    await Deno.writeTextFile(`${sourceDir}/AGENTS.md`, "# Agent Info");
    await Deno.writeTextFile(
      `${sourceDir}/.mcp.json`,
      '{"mcpServers":{}}',
    );

    const staged = await stageAgentWorkspace(sourceDir, targetDir);

    // All files should be staged
    assertEquals(await exists(`${targetDir}/CLAUDE.md`), true);
    assertEquals(await exists(`${targetDir}/AGENTS.md`), true);
    assertEquals(await exists(`${targetDir}/.mcp.json`), true);

    // Verify content
    assertEquals(
      await Deno.readTextFile(`${targetDir}/AGENTS.md`),
      "# Agent Info",
    );
    assertEquals(
      await Deno.readTextFile(`${targetDir}/.mcp.json`),
      '{"mcpServers":{}}',
    );

    // Cleanup removes all
    await staged.cleanup();
    assertEquals(await exists(`${targetDir}/CLAUDE.md`), false);
    assertEquals(await exists(`${targetDir}/AGENTS.md`), false);
    assertEquals(await exists(`${targetDir}/.mcp.json`), false);
  } finally {
    await cleanupTempDir(sourceDir);
    await cleanupTempDir(targetDir);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno task test:unit -- --filter "stageAgentWorkspace"`
Expected: FAIL — `AGENTS.md` and `.mcp.json` not found in target (current code only stages `.claude/` and `CLAUDE.md`)

- [ ] **Step 3: Write failing test for staging arbitrary directories**

Add another step after the previous one:

```typescript
await t.step("stages directories from source", async () => {
  const sourceDir = await createTempDir("stage-dirs-src");
  const targetDir = await createTempDir("stage-dirs-tgt");

  try {
    // Create a .tools directory with a script
    await Deno.mkdir(`${sourceDir}/.tools`, { recursive: true });
    await Deno.writeTextFile(
      `${sourceDir}/.tools/my-linter.sh`,
      "#!/bin/bash\necho lint",
    );

    const staged = await stageAgentWorkspace(sourceDir, targetDir);

    assertEquals(await exists(`${targetDir}/.tools`), true);
    assertEquals(await exists(`${targetDir}/.tools/my-linter.sh`), true);
    assertEquals(
      await Deno.readTextFile(`${targetDir}/.tools/my-linter.sh`),
      "#!/bin/bash\necho lint",
    );

    await staged.cleanup();
    assertEquals(await exists(`${targetDir}/.tools`), false);
  } finally {
    await cleanupTempDir(sourceDir);
    await cleanupTempDir(targetDir);
  }
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `deno task test:unit -- --filter "stageAgentWorkspace"`
Expected: FAIL — `.tools/` not staged

- [ ] **Step 5: Rewrite `stageAgentWorkspace` to iterate all entries**

Replace the entire body of `stageAgentWorkspace` in `src/agents/workspace-staging.ts` with a generalized loop. The full new file content:

```typescript
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `deno task test:unit -- --filter "stageAgentWorkspace"`
Expected: PASS — all steps pass including the new ones

- [ ] **Step 7: Commit**

```bash
git add src/agents/workspace-staging.ts tests/unit/agents/workspace-staging.test.ts
git commit -m "feat: generalize workspace staging to all directory entries"
```

---

## Chunk 2: Companion Folder Detection in Loader

### Task 2: Auto-detect companion folders

**Files:**

- Modify: `tests/unit/agents/loader.test.ts`
- Modify: `src/agents/loader.ts`

- [ ] **Step 1: Write failing test for companion folder detection**

In `tests/unit/agents/loader.test.ts`, add a new `describe` block inside the existing `"Agent Loader"` describe. The file uses `describe`/`it` from `@std/testing/bdd` and has a shared `tempDir` with `beforeEach`/`afterEach`. Add after the `"loadAgentConfig"` describe block:

```typescript
describe("loadAgentConfigs companion folder", () => {
  it("should set workingDir when companion folder exists", async () => {
    // Create agent YAML
    const configPath = join(tempDir, "my-agent.yml");
    await Deno.writeTextFile(
      configPath,
      `id: my-agent\nname: My Agent\nmodel: test\nmaxTurns: 10\nallowedTools:\n  - Read\n`,
    );

    // Create companion folder
    const companionDir = join(tempDir, "my-agent");
    await Deno.mkdir(companionDir, { recursive: true });
    await Deno.writeTextFile(
      join(companionDir, "CLAUDE.md"),
      "# My Agent Rules",
    );

    const configs = await loadAgentConfigs(tempDir);
    const config = configs.get("my-agent");

    assertExists(config);
    assertExists(config!.workingDir);
    // Should be an absolute path ending with the companion folder
    assertEquals(config!.workingDir!.endsWith("my-agent"), true);
  });

  it("should not set workingDir when no companion folder exists", async () => {
    const configPath = join(tempDir, "solo-agent.yml");
    await Deno.writeTextFile(
      configPath,
      `id: solo-agent\nname: Solo\nmodel: test\nmaxTurns: 10\nallowedTools:\n  - Read\n`,
    );

    const configs = await loadAgentConfigs(tempDir);
    const config = configs.get("solo-agent");

    assertExists(config);
    assertEquals(config!.workingDir, undefined);
  });

  it("should use filename stem not config.id for companion folder", async () => {
    // YAML filename is "custom-name.yml" but config id is "different-id"
    const configPath = join(tempDir, "custom-name.yml");
    await Deno.writeTextFile(
      configPath,
      `id: different-id\nname: Custom\nmodel: test\nmaxTurns: 10\nallowedTools:\n  - Read\n`,
    );

    // Companion folder matches filename stem, NOT config.id
    const companionDir = join(tempDir, "custom-name");
    await Deno.mkdir(companionDir, { recursive: true });
    await Deno.writeTextFile(
      join(companionDir, "CLAUDE.md"),
      "# Custom Rules",
    );

    // Should NOT have a folder named "different-id"
    const configs = await loadAgentConfigs(tempDir);
    const config = configs.get("different-id");

    assertExists(config);
    assertExists(config!.workingDir);
    // workingDir should end with "custom-name" (filename stem), not "different-id"
    assertEquals(config!.workingDir!.endsWith("custom-name"), true);
  });

  it("should override explicit workingDir with companion folder", async () => {
    const configPath = join(tempDir, "override-agent.yml");
    await Deno.writeTextFile(
      configPath,
      `id: override-agent\nname: Override\nmodel: test\nmaxTurns: 10\nworkingDir: some/other/path\nallowedTools:\n  - Read\n`,
    );

    // Create companion folder
    const companionDir = join(tempDir, "override-agent");
    await Deno.mkdir(companionDir, { recursive: true });

    const configs = await loadAgentConfigs(tempDir);
    const config = configs.get("override-agent");

    assertExists(config);
    // Convention folder should win over explicit workingDir
    assertEquals(config!.workingDir!.endsWith("override-agent"), true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno task test:unit -- --filter "companion folder"`
Expected: FAIL — `workingDir` is undefined (no companion folder detection yet)

- [ ] **Step 3: Implement companion folder detection in `loadAgentConfigs`**

In `src/agents/loader.ts`, modify the `loadAgentConfigs` function. Add `resolve` to the imports from `@std/path`:

Change the import line:

```typescript
import { basename, extname, resolve } from "@std/path";
```

Then update the function body to check for companion folders after loading each config:

```typescript
export async function loadAgentConfigs(
  directory: string,
): Promise<Map<string, AgentConfig>> {
  const configs = new Map<string, AgentConfig>();

  if (!await exists(directory)) {
    return configs;
  }

  for await (
    const entry of walk(directory, {
      maxDepth: 1,
      exts: [".yml", ".yaml"],
      includeFiles: true,
      includeDirs: false,
    })
  ) {
    try {
      const config = await loadAgentConfig(entry.path);

      // Convention: check for companion folder derived from filename
      const stem = basename(entry.path, extname(entry.path));
      const companionDir = resolve(directory, stem);
      try {
        const stat = await Deno.stat(companionDir);
        if (stat.isDirectory) {
          if (config.workingDir) {
            log.warn(
              "Companion folder overrides explicit workingDir",
              {
                agentId: config.id,
                companionDir,
                workingDir: config.workingDir,
              },
            );
          }
          config.workingDir = companionDir;
        }
      } catch {
        // Companion directory doesn't exist — no-op
      }

      configs.set(config.id, config);
    } catch (error) {
      log.warn("Failed to load agent config", {
        path: entry.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return configs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno task test:unit -- --filter "companion folder"`
Expected: PASS

- [ ] **Step 5: Run full unit test suite**

Run: `deno task test:unit`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/agents/loader.ts tests/unit/agents/loader.test.ts
git commit -m "feat: auto-detect agent companion folders in loader"
```

---

## Chunk 3: Verification & Cleanup

### Task 3: Full verification

- [ ] **Step 1: Run deno check on modified files**

Run: `deno check src/agents/workspace-staging.ts src/agents/loader.ts`
Expected: No errors

- [ ] **Step 2: Run linter**

Run: `deno lint`
Expected: No lint errors

- [ ] **Step 3: Run formatter**

Run: `deno fmt`
Expected: Formatted

- [ ] **Step 4: Run full unit test suite**

Run: `deno task test:unit`
Expected: All tests pass

- [ ] **Step 5: Commit if any formatting changes**

```bash
git add src/agents/workspace-staging.ts src/agents/loader.ts tests/unit/agents/workspace-staging.test.ts tests/unit/agents/loader.test.ts
git commit -m "chore: format agent workspace convention files"
```
