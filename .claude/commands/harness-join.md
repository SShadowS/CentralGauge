# Join the Harness Bench autonomous run

You are joining the Harness Bench build as one of four sessions. Work out which one, then
start it. Runbook: `docs/superpowers/runbooks/harness-autonomy/` in the main checkout
`U:\Git\CentralGauge`.

## 1. Your role comes from your directory

Run `git rev-parse --show-toplevel` and map it:

| Top level | Role | Session name |
| --- | --- | --- |
| `U:/Git/CentralGauge` | orchestrator | `cg-orchestrator` |
| `U:/Git/CentralGauge-wt/lane-infra` | lane infra | `lane-infra` |
| `U:/Git/CentralGauge-wt/lane-content` | lane content | `lane-content` |
| `U:/Git/CentralGauge-wt/lane-ops` | lane ops | `lane-ops` |

Anything else: say that this directory has no role and stop.

## 2. Check the role is free

Call `ListAgents`. Note which of the four session names are live, and this session's own
name (the first line of the result).

- Your role's name is already held by ANOTHER live session: do not take it. Tell the user
  which roles are missing and, for each, the directory to start a session in (table above),
  then stop.
- This session already has the name: skip to step 4.
- Otherwise continue.

## 3. Get the name

You cannot rename yourself. Tell the user exactly this, then wait for them to confirm:

> I am `<session name>`. Please run `/rename <session name>` so the other sessions can reach me.

After they confirm, call `ListAgents` again and check the first line shows the new name.

## 4. Start the role

Also report which of the other three roles are still missing, with their directories.

- orchestrator: read `docs/superpowers/runbooks/harness-autonomy/orchestrator.md` and follow
  it. Its loop runs under `/loop`, so tell the user to start it with:
  `/loop You are cg-orchestrator. Follow docs/superpowers/runbooks/harness-autonomy/orchestrator.md: run its start procedure if you have not done so in this session, then do one sweep.`
  and stop until they do.
- lane: read `docs/superpowers/runbooks/harness-autonomy/lane.md` and follow it, starting with
  its "On every start" section.
