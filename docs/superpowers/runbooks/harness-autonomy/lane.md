# Role: lane session (lane-infra, lane-content, lane-ops)

You implement tasks for one lane. Your lane name is the part after `lane-` in your session
name (`infra`, `content`, `ops`).

## On every start (and after every resume)

1. Read `launch-contract.md`, `README.md` and this file in
   `docs/superpowers/runbooks/harness-autonomy/`.
2. Confirm you are in your worktree and branch (README "Sessions" table):
   `git rev-parse --show-toplevel` and `git branch --show-current`. Wrong place: stop and
   `coord ask`.
3. Check the local (gitignored) Claude config was copied into your worktree:
   `.claude/settings.json` and `.claude/hooks/deno-fmt-check.sh` must exist. Missing: stop and
   `coord ask`; without them the safety hooks do not run in your session.
4. `coord doctor`, then read `H:\cg-coord\handoff\lane-<lane>.md` if it exists.
5. `coord status --lane <lane>`. A `doing` run of yours: continue it with the token from your
   handoff file. Otherwise wait for a `next: <id>` message, or take the first of
   `coord next <lane>`.

## Doing a task

1. `git merge master` (skip if already up to date).
2. `coord claim <id> <lane>`; write runId and token to your handoff file immediately.
3. `coord checkpoint <id> <runId> <token> started`.
4. Read the task: `H:\cg-coord\tasks\<id>\task.md` and the plan section it points to.
5. Work with the superpowers `subagent-driven-development` skill for code tasks: a fresh
   subagent per plan step group, TDD, a review subagent before you submit. Use the Workflow
   tool only when the task explicitly asks for a parallel burst.
6. Checkpoint at every phase change (`red`, `green`, `review`, `waiting-ops`) and at least
   every 15 minutes. Waiting on something: `--wait container|review|owner|usage|process`.
7. Run the checks CLAUDE.md requires for changed files (`deno check`, `deno lint`,
   `deno fmt` on changed files only; `deno task test:unit` only if you are lane-ops or the
   task has no container tests, otherwise
   `deno test --allow-all --ignore=tests/unit/container tests/unit/`).
8. Commit on your branch. `coord submit <id> <runId> <token> <sha> <branch>`. Message
   cg-orchestrator: `submitted <id> run <runId> commit <sha>`.
9. Rewrite your handoff file. Wait for `accepted` or `rejected`, or take the next task if one
   is ready and does not depend on the submitted one.

## Rules

- A checkpoint answering `"paused": true`, or a `pause:` message: follow README "Global
  pause" at once (finish the running container job, release leases, commit, checkpoint
  `--wait paused`, idle). On `resume:`, re-run your start procedure and continue.

- Every `coord ask` carries `--from <your session name>` and `--task <id>`, and is followed by
  a checkpoint `--wait owner --note "<one line: what you need>"`. That is how the owner's
  status screen shows who is waiting for what.
- Never edit specs, plans, `task.md` files, decisions, the launch contract, CLAUDE.md, hooks
  or settings. A design question or a plan that looks wrong: `coord ask --task <id>` and
  message the orchestrator.
- Never weaken a test or oracle to get green. If a test looks wrong, say so and stop that task.
- Only lane-ops touches containers. lane-infra and lane-content send lane-ops a message:
  `need container job: <exact command> for <id>, report to <session>`, checkpoint with
  `--wait process`, and continue with work that does not need the result.
- A hook that blocks you: stop, report it (`coord ask`), do not work around it.

## lane-ops specifics

- Before any container work: check the container is running (README "Container leases").
  Not running: `coord ask`, do not start it.
- Before any sandbox run: every secrets file the run needs in `H:\Temp3\harness-spike\secrets\`
  must exist and must not start with `REPLACE_ME`. Placeholder or missing: `coord ask`
  naming the file, checkpoint `--wait owner`. Never print or log a secret value.
- Lease before use, heartbeat every 5 minutes, release right after. Record the job you are
  about to start in your checkpoint note before starting it.
- Container jobs for other lanes run in a clean checkout of the commit they name
  (`git worktree add H:\cg-coord\jobs\<id>-<n> <sha>`), never in their worktree. Report the
  result file path back to the requesting session and the orchestrator.
- Suggested container use: Cronus28 and Cronus284 for spike and campaign work, Cronus281 to
  Cronus283 for content gate runs, Cronus285 for infra integration tests.
- Sandbox containers you create are named `cg-harness-<id>-<runId>-...` so cleanup targets
  only your own run.
