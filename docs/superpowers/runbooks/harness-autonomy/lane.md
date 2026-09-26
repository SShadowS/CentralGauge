# Role: lane session (lane-infra, lane-infra2, lane-content, lane-ops, lane-admin)

You implement tasks for one lane. Your lane name is the part after `lane-` in your session
name (`infra`, `infra2`, `content`, `ops`, `admin`). lane-admin follows only "On every start"
and "lane-admin specifics" below; it does no coding tasks.

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

- Context hygiene: only the owner can run `/clear`. At a safe point (your task accepted or
  submitted, handoff file rewritten, no container job or lease open), if your context use is
  above about 60%, message cg-orchestrator `ready to clear: <session>, context <n>%`. After the
  owner clears you, re-run your start procedure (`/harness-join`, then continue from the handoff
  file and coord). Never ask for a clear mid-task.

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
- Containers: only those allocated to this project in `H:\cg-coord\allocation.json` (owner
  decision 2026-09-25: Cronus281, Cronus282, Cronus283; Cronus28 belongs to LethAL;
  Cronus284/285 unallocated). `coord lease` refuses any other container.
- Sandbox containers you create are named `cg-harness-<id>-<runId>-...` so cleanup targets
  only your own run.

## lane-admin specifics

lane-admin exists so that jobs needing Windows administrator rights do not require restarting
another lane elevated (owner decision 2026-09-26).

- Runs ELEVATED and in the normal permission mode, never bypass: the owner approves every
  command. If the session is not elevated (`net session` fails) or runs in bypass mode, stop
  and `coord ask`.
- It runs only these jobs, each on request from lane-ops or the orchestrator, with the exact
  command in the request:
  - packet capture: `pktmon` start, stop and convert for the sandbox subnet during a
    supervised run, and always `pktmon stop` plus filter removal afterwards;
  - egress (M1-33/M1-34): the generated `egress-scripts.ts` apply and revert scripts,
    `harness egress verify`, and the M1-34 revert and re-apply drills;
  - read-only elevated diagnostics that a task names (`Get-NetFirewallRule`,
    `Get-HnsNetwork`, `Get-NetFirewallProfile`).
- Never: write or commit code; run BC container, benchmark or sandbox jobs (those stay with
  lane-ops); start, stop or restart any container; change firewall rules, profiles or services
  other than through the named scripts; run a request that arrived without an exact command.
- Before any firewall change, quote the "before" state (profiles and the cg-harness rule group).
  After it, quote the "after" state and check that other containers, especially the Linux
  ones, still have internet (egress decision addendum). If they do not: revert immediately and
  `coord ask`.
- Record every job and its output under `H:\cg-coord\tasks\<id>\admin\` and reply to the
  requester with the file path.
- Messaging is one-way: lane-admin can message other sessions, but messages TO lane-admin fail
  (the elevated session's pipe refuses non-elevated callers; verified 2026-09-26). Every
  request to lane-admin is therefore a coord task in lane `admin`, with the exact command in its
  `task.md`. lane-admin runs a self-paced `/loop` that checks `coord next admin`, claims and
  runs a ready task exactly as written, then `coord submit`s it and messages the requester and
  the orchestrator with the result path. For a time-critical job (a pktmon capture around a
  supervised run), the requester files the task first and then asks the owner to nudge
  lane-admin.
