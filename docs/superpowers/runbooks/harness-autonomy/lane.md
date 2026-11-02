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
6. Tell the orchestrator you are alive, always, also after a `/clear` or a resume:
   send `cg-orchestrator` the message `online: lane-<lane> (fresh session), state: <doing
   <id> run <runId> | idle>`. Without it the orchestrator keeps waiting on your old session.

## Doing a task

1. `git merge master` (skip if already up to date). Then check line endings:
   `git ls-files --eol | grep "w/crlf.*eol=lf"`. Each file it lists is CRLF on disk although
   `.gitattributes` wants LF (a checkout made before the attribute existed; a merge does not
   rewrite it). Rewrite each from the index with `git show :<path> > <path>` (same content;
   `git checkout --` is hook-blocked), then confirm `git diff -- <path>` is empty. Image
   builds hash these files and fail on CRLF.
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
8. Before submit: run the self-check in "Review rounds and suites" item 5 and attach its
   output path to your submit note.
   Commit on your branch. `coord submit <id> <runId> <token> <sha> <branch>`. Message
   cg-orchestrator: `submitted <id> run <runId> commit <sha>`.
9. Rewrite your handoff file. Wait for `accepted` or `rejected`, or take the next task if one
   is ready and does not depend on the submitted one.

## Review rounds and suites (owner 2026-10-20, decisions\2026-10-20-loop-speedups.md)

1. During fix rounds run the targeted test files, then `deno task test:harness:fast`. Never
   the serial full suite inside a round.
2. Start Sol on the fix diff as soon as the fix is committed, and run the suite at the same
   time. Do not wait for one before starting the other.
3. The serial full suite runs once, on the submit candidate: after Sol's READY, with no fix
   pending. Never start it on an intermediate commit. If it is killed, re-run only the failed
   or unfinished `test-fast` chunks, not the whole suite.
4. Severity rubric from round 1: a fail-closed false positive (a check that refuses something
   legitimate, visibly) is MEDIUM, unless a corpus scan hits it. A bypass, a wrong score or a
   silent pass stays HIGH. After two rounds in a row with no HIGH, submit and list the open
   MEDIUM items in the submit note. For HX task oracles (orchestrator ruling 2026-11-02, C-15): a
   finding is HIGH only when a plausible fix of the stated symptom passes while breaking the
   contract. A wrong fix that reaches full credit only by breaking or caching shipped code the fix
   does not touch is an adversarial fix: MEDIUM, listed in the submit note.
5. Self-check before submit: run the orchestrator's review yourself. Use `pi_ask` with
   `gpt-6.1-sol` against the frozen design, the decisions that apply, and the task's reject
   file if there is one. Ask whether the submit conforms. Save the answer under
   `H:\cg-coord\tasks\<id>\` and fix what it finds first. For a resubmit after a reject, also
   say for each item of the reject file where it is fixed. The orchestrator then reviews the
   fix diff, not a fresh full round.
6. A submit note may not contain "decisions the design does not state". A mechanism the
   design leaves open (for example how a scanner resolves symbols) goes back to the
   orchestrator as a design question (`coord ask`) before you build on it.

## Mined HX tasks (owner 2026-11-02)

HX tasks built from real merged PRs follow these four rules on top of the gate. The goal is a
task a frontier model fails on attempt 1, not a realistic ticket that every model passes. Read
`docs/reasoning-suite/LESSONS.md` before a batch.

1. **Selection filter.** Applied at the shortlist and in the binding review, before any build.
   Delete the draft prompt's Expected bullets. Reject the candidate if the shipped code plus the
   Observed sentence still determine the fix, or if every planned naive is "skipped one stated
   bullet". The fix must depend on at least one measured BC fact (decisions or premise-probe
   results) that is neither present in the shipped overlay nor implied by the prompt. The
   review verdict carries a field `frontier-catcher: yes|no`; "no" is a reject, unless the
   batch books at most one filler task and says so.
2. **Mechanism not in the overlay.** The design brief's "Shipped code" section must not already
   contain what the fix needs. A brief whose correct diff mostly moves or copies shipped code
   (an existing check chain lifted into a predicate, a loop already routed through the right
   record) is rejected before any build.
3. **Contract, not diagnosis.** The prompt has one Observed symptom as the desk saw it, and an
   Expected section that states the business contract in two or three sentences. No bullet per
   branch, and no reproduction that isolates the failing step. A review finding of the kind
   "requirement not stated in the prompt" is resolved by moving that scenario to pass_to_pass,
   dropping it, or dropping the candidate. It is never resolved by adding a sentence that names
   the branch. The Sol self-check rubric gets a fourth class, **TOO EASY**: the prompt or the
   overlay gives away the branch or the mechanism the trap lives in. A TOO EASY finding blocks
   submit like a HIGH.
4. **Frontier gate.** After the container gate PASSes and before the Sol self-check and merge,
   the task gets one frontier attempt: an Opus-class agent on the harness agent path, from the
   prompt and the overlay only. Ask lane-ops for it like a gate job. An attempt-1 pass means the
   task does not ship: it goes to the filler pool (if the batch books one) or is dropped. Budget
   about three builds per shipped task.

**Breadth class (owner 2026-11-02).** A breadth task is graded on coverage, not on one withheld
fact: a new kind of thing (an asset type, a document type) must reach every place the app
silently assumes the existing kinds. It is exempt from rule 1 (no measured BC fact is needed,
and the `frontier-catcher: yes` requirement does not apply) and from rule 4's ship condition
(the frontier attempt still runs and records partial credit, but an attempt-1 pass does not
block shipping). It may merge once (a) holds; it stays in the breadth pool only if (b) holds:

- (a) the hidden checks spread partial credit: every functional area has one or more
  independently scored fail_to_pass procedures, and every planned incomplete naive lands at a
  distinct, non-zero score below 1.0 in the gate;
- (b) a setup comparison, run by lane-ops after merge at equal limits, separates the arms: with at
  least three repeats per arm, the mean partial credit of two arms differs by more than the
  larger of the two arms' sample standard deviations. If it does not, the orchestrator retires the task to the filler pool.

A breadth task is never counted as a frontier-catcher. Rule 2 applies with one boundary: the
overlay may plant working code for the existing kinds (that is where the touchpoints live), and
the correct diff may extend those planted sites, but the design states the template floor (the
score from extending planted sites alone), and the difficulty must rest on touchpoints that no
single keyword finds and that no planted site points at. Rule 3 applies to a feature ticket as:
state the request and the business differences of the new kind, plus the API seams the oracle
needs; never name a touchpoint, a procedure to change, or the number of places involved.

For hard tasks, prefer assembling over inventing: combine two or three gated single-trap tasks
(Commit-family donors first) into one overlay with one symptom. That is the only route with
measured frontier failures so far (LESSONS.md, composite sections).

Before submitting any HX task, run `deno test --allow-all tests/unit/harness/realistic-bundle.test.ts`.
It refuses, as a whole word in the bundle, every object and procedure name of six characters or
more from any task's AL files and every oracle procedure in a task.yml (bar a short list of BC
trigger names), so a generic
name (a procedure called `Suggest`, `Validate`, `Process`) breaks master once the realistic
bundle uses that word. Rename the task's identifier to something specific; never edit the
bundle (it is hashed into the realistic arms) or the guard.

## Context size

You cannot run `/clear` or `/compact` yourself; only the owner can. Every turn re-sends your
whole context, so keep it small: let subagents do the reading and implementing and keep only
their conclusions. After you submit a task and rewrite your handoff file, you are ready to be
cleared; the owner's dashboard shows "ready to /clear" for a session with over 400k context and
nothing in flight. After a clear, run your start procedure again.

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
- A harness run started outside the main checkout passes `--results-dir` naming the shared
  results root (`U:\Git\CentralGauge\results\harness`): the egress marker, baselines and
  bc-ledger are read there (H-49).
- A credential-bearing run passes `--lane <your lane>` (or sets `CG_LANE`); without either
  the credential reservation refuses it (H-49).
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
- One harness process per `--private-dir` (M10-08c, owner 2026-10-13). Every `harness`
  command that runs at the same time as another one on this host gets its own
  `--private-dir`; the default directory is shared by every worktree. A second process on the
  same root is refused. Accepted residual: a process suspended for more than 120 s between
  its lock check and the next destructive step (docker call or file write/removal) can act
  after another process reclaimed the root; this rule keeps that from happening. If the
  harness refuses to open because of legacy state, follow the one-time migration it prints
  (no harness process running) and tell the orchestrator.

## lane-admin specifics

lane-admin exists so that jobs needing Windows administrator rights do not require restarting
another lane elevated (owner decision 2026-09-26).

- Runs ELEVATED, in auto mode or the normal permission mode, never bypass (owner decision
  2026-09-26: auto mode is allowed; the job list below is the limit, not per-command
  approval). If the session is not elevated (`net session` fails) or runs in bypass mode,
  stop and `coord ask`. Do not ask the owner to leave auto mode.
- It runs only these jobs, each on request from lane-ops or the orchestrator, with the exact
  command in the request:
  - packet capture: `pktmon` start, stop and convert for the sandbox subnet during a
    supervised run, and always `pktmon stop` plus filter removal afterwards;
  - egress (M1-33/M1-34): the generated `egress-scripts.ts` apply and revert scripts,
    `harness egress verify`, and the M1-34 revert and re-apply drills;
  - read-only elevated diagnostics that a task names (`Get-NetFirewallRule`,
    `Get-HnsNetwork`, `Get-NetFirewallProfile`);
  - restart of the network services `SharedAccess` (ICS, the WSL NAT) and `WinNat`, with the
    service status recorded before and after, followed by the internet check (below);
  - any other elevated job whose `task.md` is marked `OWNER-APPROVED` by cg-orchestrator
    (owner decision 2026-09-26). Run it as written without asking; the marker is the owner's
    approval.
- Run every task on this list without asking the owner. Ask only when a task is off the list
  and not marked `OWNER-APPROVED`, or when a check below fails.
- Never, even when marked: write or commit code; run BC container, benchmark or sandbox jobs
  (those stay with lane-ops); start, stop or restart any container, Docker, or HNS; run in
  bypass mode; run a request that arrived without an exact command.
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
