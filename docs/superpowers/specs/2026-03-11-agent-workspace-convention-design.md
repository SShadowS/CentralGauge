# Agent Workspace Convention Design

## Goal

Establish a convention where each agent has a companion folder (`agents/{id}/`) containing its complete workbench — rules, skills, MCP config, custom tools — that gets automatically staged into the task working directory. This enables A/B testing of agent configurations by benchmarking the workbench, not the task.

## Scope

- Convention-based auto-discovery of agent folders
- Generalize workspace staging to copy all folder contents (not a hardcoded list)
- Backward compatible with explicit `workingDir` in agent YAML

## Folder Convention

Each agent YAML at `agents/{id}.yml` can have a companion folder at `agents/{id}/`:

```
agents/
  my-agent.yml              # Agent config (model, maxTurns, limits, etc.)
  my-agent/                  # Agent workbench (auto-discovered)
    ├── CLAUDE.md            # Project-level instructions
    ├── AGENTS.md            # Agent-specific instructions
    ├── .claude/             # Claude Code config
    │   ├── rules/           # Coding rules
    │   ├── commands/        # Custom commands
    │   ├── skills/          # Skills
    │   └── settings.json    # Tool permissions, preferences
    ├── .mcp.json            # MCP server config
    └── .tools/              # Scripts the agent can invoke via Bash
        └── my-linter.sh
```

**Important principle:** The agent folder contains only things that define _how_ the agent works (its toolbox). Never task content. The task YAML defines _what_ to solve and is identical across agents. The benchmark measures the workbench, not the problem.

## Resolution Order

The companion folder is derived from the **YAML filename** (not `config.id`), since `config.id` may differ from the filename. For `agents/foo.yml`, the companion folder is `agents/foo/`.

When resolving an agent's `workingDir`:

1. If companion folder `{dir}/{stem}/` exists → use it (resolved to absolute path)
2. Else if `workingDir` is set in YAML → use it (backward compat, may be relative)
3. Else → no staging (current default behavior)

When both the convention folder and explicit `workingDir` exist, the convention folder wins and a warning is logged.

## Convention Folder Detection

Detection happens at **load time** in `loadAgentConfigs()` (`src/agents/loader.ts`), not during resolution. This is because:

- `loadAgentConfigs()` iterates YAML files in the directory and has access to the file path
- `resolveAgentInheritance()` is a pure function operating on in-memory configs — no filesystem access

After loading each config from `entry.path`:

1. Derive `stem` from filename: `basename(entry.path, extname(entry.path))` → e.g., `"foo"` from `"foo.yml"`
2. Check if `join(directory, stem)` exists as a directory
3. If it does, set `config.workingDir` to the resolved absolute path
4. If `config.workingDir` was already set from YAML, log a warning and override

## Staging Behavior

### Current

`stageAgentWorkspace` stages exactly two items with hardcoded logic:

- `.claude/` → junction symlink (copy fallback)
- `CLAUDE.md` → file symlink (copy fallback)

### New

`stageAgentWorkspace` iterates all entries in the source directory:

- **Directories** (`.claude/`, `.tools/`, etc.) → junction symlink, copy fallback
- **Files** (`CLAUDE.md`, `AGENTS.md`, `.mcp.json`, etc.) → file symlink, copy fallback

Same backup/restore pattern as today — existing files in the target get `.bak` suffix, restored on cleanup.

**Edge cases:**

- **Empty agent folder**: Valid. Iterates zero entries, stages nothing. Intentional no-op workbench.
- **Name collisions with task content**: The agent writes task files (`.al`, `app.json`) _after_ staging. Agent-written content naturally overwrites staged content. The convention is to never put task-related files in the agent folder.
- **Nested symlinks in source**: `Deno.readDir()` enumerates entries regardless of type. If the source contains symlinks, they're staged the same way (as files or directories). No special handling needed.

### Signature

```typescript
stageAgentWorkspace(sourceDir: string, targetDir: string): Promise<StagedWorkspace>
```

No signature change. The `StagedWorkspace` interface (with `stagedPaths`, `backedUpPaths`, `cleanup()`) stays the same.

### Cleanup

Unchanged. `staged.cleanup()` is called in the executor's `finally` block. It removes staged symlinks/copies and restores `.bak` backups.

## Backward Compatibility

- `with-skills.yml` (`workingDir: agents/al-project`) → no `agents/with-skills/` folder exists, falls through to explicit `workingDir`. Works as-is.
- `config-a.yml` / `config-b.yml` (`workingDir: test-configs/config-a`) → no convention folder, falls through. Works as-is.
- `default.yml` (no `workingDir`) → no convention folder today, no staging. Can add `agents/default/` later to give it a workbench.
- Existing `agents/al-project/` directory is not affected — it's only used by agents that explicitly set `workingDir: agents/al-project`. Convention lookup uses the filename stem, not directory names that happen to exist.

## Changes

| File                              | Change                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/agents/workspace-staging.ts` | Generalize to iterate all entries in source directory instead of hardcoded `.claude/` + `CLAUDE.md`                            |
| `src/agents/loader.ts`            | In `loadAgentConfigs()`, after loading each config, check for companion folder derived from filename stem and set `workingDir` |

No new files. No changes to `executor.ts`, `types.ts`, `registry.ts`, agent YAML schema, or task execution.
