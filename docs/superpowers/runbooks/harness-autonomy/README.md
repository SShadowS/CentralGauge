# Harness Bench autonomous run: protocol

Four Claude Code sessions build Harness Bench between 2026-09-25 and 2026-10-16. This file
is the protocol every session follows. Read `launch-contract.md` first; it holds the dates,
permissions and approval rules.

- Specs: `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (1a),
  `docs/superpowers/specs/2026-09-24-harness-refapp-design.md` (1b)
- First plan: `docs/superpowers/plans/2026-09-24-harness-bench-spike.md` (M0 + roadmap)
- Reviews that shaped this: `.panel/harness-spec-review-gpt6astra.md`,
  `.panel/harness-autonomy-review-gpt6astra.md`

## Sessions

| Session | Worktree | Branch | Does | Never does |
| --- | --- | --- | --- | --- |
| `cg-orchestrator` | `U:\Git\CentralGauge` (main checkout) | `master` | writes plans and `task.md` files, reviews, merges, pushes, decides, asks the owner | writes product code, oracles or reference solutions, resolves merge conflicts by writing code, runs container jobs, loosens a safety control, approves its own work |
| `lane-infra` | `U:\Git\CentralGauge-wt\lane-infra` | `harness/lane-infra` | M1 to M3 code (TDD, subagents) | touches containers directly (asks lane-ops), edits specs or plans |
| `lane-content` | `U:\Git\CentralGauge-wt\lane-content` | `harness/lane-content` | refapp and task authoring (M0-01, M4) | touches containers directly (asks lane-ops), edits specs or plans |
| `lane-ops` | `U:\Git\CentralGauge-wt\lane-ops` | `harness/lane-ops` | every container operation: spike measurements, gate runs for other lanes, campaigns | edits product code beyond spike scripts, starts or restarts BC containers |

`.claude/settings.json`, `.claude/settings.local.json`, `.claude/hooks/` and
`.claude/agents/` are gitignored, so each lane worktree holds a local copy (made
2026-09-24). After a hook changes in the main checkout, copy it into the three worktrees
again. Worktrees that Claude Code creates itself (`claude --worktree`, subagents with
`isolation: worktree`) get these files automatically through `.worktreeinclude`.

lane-ops is the only session that runs anything touching a BC container, including unit
tests under `tests/unit/container/`, `bench`, `trap-probe`, and spike scripts. The global
bench lock and its hook only see each checkout's own `results/`, so they do not protect
lanes from each other: the lease plus this rule does.

## Coordination root

`CG_COORD_ROOT=H:\cg-coord` (outside every worktree). Command:

```
deno run --allow-all U:\Git\CentralGauge\scripts\coord\coord.ts <command> ...
```

Below, `coord` means that command. Always run it from the main checkout's copy, so every
session uses the same version.

On startup every session runs `coord doctor` and stops with `coord ask` if it reports an
issue or if `H:\cg-coord\coord.json` is missing. Never run `coord init` except the one time
in the start sheet.

### Task lifecycle

```
todo --claim--> doing --submit--> review --accept--> accepted
                  |                  \--reject--> todo (new run)
                  \--fail / abandon--> todo (new run)
```

- `coord next <lane>`: tasks ready for that lane (all deps accepted).
- `coord claim <id> <lane>` returns `{runId, token}`. Write both to your lane handoff file
  at once. The token is required for every later mutation of that run.
- `coord checkpoint <id> <runId> <token> <phase> [--wait container|review|owner|usage|process] [--note "..."]`:
  call it right after claiming (phase `started`), at every phase change, and at least every
  15 minutes of work. No checkpoint for 15 minutes shows up in `coord stale`.
- `coord submit <id> <runId> <token> <commit> <branch>` when the work is committed on your
  branch and its tests pass. Then send the orchestrator a doorbell message.
- `coord fail <id> <runId> <token> "<reason>"` when you give up on this attempt.
- Orchestrator only: `accept <id> <runId> <integratedSha>` after the merge to master,
  `reject <id> <runId> "<reason>"`, `abandon <id> <runId> "<reason>"` for a run whose owner
  is gone.
- Dependencies unlock only on `accepted`, which means merged into master.

### Queries

- `coord status [--lane X] [--json]`, `coord why <id>`, `coord next <lane>`,
  `coord questions`, `coord stale`, `coord holder <container>`, `coord doctor`.
- Queries read only headers and status records. Never read every task folder by hand.

### Container leases (lane-ops only)

- `coord lease <container> ops` returns `{attempt, token}`. `coord heartbeat <container> <token>`
  every 5 minutes while held. `coord release <container> <token>` when done.
- Container overview (read-only, allowed for agents): `pwsh -File U:\Git\CentralGauge\scripts\coord\containers.ps1 status`.
  Its `start` and `stop` actions are for the owner only.
- Before leasing, check the container is up: `DOCKER_CONTEXT=desktop-windows docker inspect -f "{{.State.Running}}" <container>`.
  Not `true`: do not start it. `coord ask "<container> is stopped" --task <id> --from lane-ops`,
  checkpoint with `--wait owner`, move to other work.
- A stale lease is never taken over. It becomes a question for the owner.
- Hold a lease only while a container operation runs, not while waiting for review.

### Questions and decisions

- `coord ask "<text>" [--task <id>] --from <session>` writes a question for the owner. The
  orchestrator push-notifies the owner. `coord answer <qid> "<text>"` closes it (owner or
  orchestrator relaying the owner's words).
- Only the orchestrator writes `H:\cg-coord\decisions\`.

## Messages

SendMessage is a doorbell only. State lives in `coord` and in git. Messages that exist:

- lane to orchestrator: `submitted <id> run <runId> commit <sha>`, `blocked <id>: see coord why`,
  `need container job: <what> for <id>` (to lane-ops, copy the orchestrator).
- orchestrator to lane: `accepted <id>`, `rejected <id>: <reason file path>`,
  `master moved to <sha>: merge it`, `protocol: re-read README.md and launch-contract.md`.

A restarted session has lost everything said in chat. The orchestrator re-sends the protocol
line to every lane when it starts, and each lane re-reads the files.

## Git

- Each lane commits only in its own worktree, on its own branch. Never write into another
  checkout.
- Fresh worktrees start from local `master`. After `master moved`, run `git merge master` in
  your worktree before the next task.
- Integration (orchestrator): for a submitted commit, build the merge of that commit onto
  current `master` in the main checkout, run the checks listed in the task's acceptance
  section on that exact tree, commit the merge, `git push origin master`, then
  `coord accept` with the merge SHA. A conflict goes back to the lane (`coord reject`).
- Commit messages end with the attribution lines required by the session.

## Reviews (orchestrator)

1. Freeze inputs: write the relevant files with `git show <sha>:<path>` into
   `H:\cg-coord\reviews\<id>-<runId>\` and pass those absolute paths.
2. `pi_ask` with `model: gpt-5.6-sol` (milestone plans: `gpt-6-astra`), `require_evidence`
   left on, `output_file` inside the same review folder.
3. No file reads, timeout or unreadable files: not reviewed, retry once, then `coord ask`.
4. Separate questions for design, implementation correctness, and oracle quality.
5. At most 2 rounds. Record the verdict and the decision in `decisions/`.

## Restarting after a usage limit or crash

- Resume with `claude --resume <session-name>`, then send: `Resume. Re-read
  docs/superpowers/runbooks/harness-autonomy/README.md and launch-contract.md, then your
  role file, then run coord doctor and coord status --lane <lane>.`
- A lane that finds its own run in `doing` continues it with the token from its handoff file.
  If the handoff file lacks the token, it asks the orchestrator to `abandon` and reclaims.
- Side effects first recorded, then done: write the intended container job, commit, or
  merge into the run's checkpoint note before starting it, so a restart can check whether it
  happened before repeating it.

## Handoff files

Each session keeps `H:\cg-coord\handoff\<session>.md`, rewritten (not appended) after every
task: current task, runId, token, branch, last commit, what is running, next step. The
orchestrator's handoff is an index, never the only record of a decision.

## Watchdog

`scripts/coord/watchdog.ps1` runs every 15 minutes via Task Scheduler (start sheet). It runs
`coord stale` and `coord questions` and shows the owner a Windows message when either is
non-empty. It never changes state and never resumes a session.
