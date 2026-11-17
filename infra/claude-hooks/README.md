# Claude Code hooks (H-108)

The source of the hooks every checkout installs into its untracked `.claude/`. On this host each git-bash process leaks about one kernel token, so the hooks exit on a builtin `case` before they fork anything.

| File | Installs as |
| --- | --- |
| `hooks/guard.sh` | `.claude/hooks/guard.sh`, PreToolUse `Bash\|PowerShell`: the bench-lock deny, the deploy-order ask and the stale-site-build ask |
| `hooks/deno-fmt-check.sh` | `.claude/hooks/deno-fmt-check.sh`, PostToolUse `Edit\|Write` |
| `settings-hooks.json` | the `hooks` value of `.claude/settings.json` (exec form, so no shell) |

Install (each session needs the owner's go, per decisions/2026-11-16-h-108-low-churn-hooks.md):
1. Copy the two scripts.
2. Set `.claude/settings.json` to `{"hooks": <settings-hooks.json>}`.
3. Delete `guard-bench-lock.sh`, `guard-deploy-order.sh` and `guard-stale-site-build.sh`.
4. Start a new session, then check that `echo deno task test:unit` is denied while `results/.bench-running.json` is fresh.

Rollback: `oracle/old/` holds the previous scripts and hooks block.

`oracle/oracle.sh` runs the old hooks against these ones in a temp project dir and writes `oracle/oracle-table.md`. One run starts about 13k git-bash processes, so run it only when a hook changes. `oracle/count-procs-h108.ps1` counts the processes each hook invocation starts.
