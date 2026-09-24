# Start sheet: 2026-09-25 13:00 CET (Max x20 account)

Everything below is for the owner. About 15 minutes.

## 1. Preflight (before 13:00)

1. **Secrets** in `H:\Temp3\harness-spike\secrets\`, one line each, no trailing text:
   - `claude-oauth-token`: Team account token, from `claude setup-token` run while logged in
     to the Team account
   - `openrouter-api-key`: for pi arms and the pi smoke test
   Then answer the open question: `coord answer <qid> "secrets in place"` (see `coord questions`).
2. **Coordination root env var** (once, new terminals pick it up):
   `setx CG_COORD_ROOT H:\cg-coord`
3. **Max account config has the same tooling as this one.** In a Max-account terminal:
   - `pi` registered with the OpenAI (ChatGPT) subscription, so reviews bill there and not to
     Copilot:
     `claude mcp add pi -s user -e PI_MCP_PROVIDER=openai-codex -- bun run U:/Git/pi-mcp/src/pi-server.ts`
     (if `pi` already exists there: `claude mcp remove pi -s user` first). Check with
     `claude mcp get pi` that the env var is shown, and in a session `pi_models` lists
     `openai-codex` rows including `gpt-5.6-sol` and `gpt-6-astra`.
   - `/plugin` shows `superpowers` enabled (plans use `writing-plans` and
     `subagent-driven-development`)
   - your global `CLAUDE.md` rules (Git Bash, no `2>nul`, no destructive git) are present in
     that config dir
   If any is missing, copy it over from `C:\Users\SShadowS\.claude-work` before starting.
4. **Same permission mode in all four sessions.** A session in a different mode holds
   cross-session messages for manual approval, which stalls the doorbells.
5. **Watchdog** (Task Scheduler, runs as you so `U:` and `H:` are mapped and the message
   reaches your desktop):
   ```
   schtasks /Create /SC MINUTE /MO 15 /TN "HarnessBenchWatchdog" /TR "pwsh -NoProfile -File U:\Git\CentralGauge\scripts\coord\watchdog.ps1" /RL LIMITED /F
   ```
   Test it once: `schtasks /Run /TN "HarnessBenchWatchdog"`. You should get a message
   listing the open question.
6. **Containers**: `pwsh -File U:\Git\CentralGauge\scripts\coord\containers.ps1 status -Web`
   shows state, lease holder and web login per container. Start the ones you want in play with
   `... containers.ps1 start` (all six) or `start -Names Cronus281,Cronus282`; `stop` refuses a
   container a lane is leasing unless `-Force`. Agents never start or stop them.

## 2. Start the four sessions (Max account, one terminal each)

| Terminal | Directory | Command |
| --- | --- | --- |
| 1 | `U:\Git\CentralGauge` | `claude -n cg-orchestrator` |
| 2 | `U:\Git\CentralGauge-wt\lane-infra` | `claude -n lane-infra` |
| 3 | `U:\Git\CentralGauge-wt\lane-content` | `claude -n lane-content` |
| 4 | `U:\Git\CentralGauge-wt\lane-ops` | `claude -n lane-ops` |

Shortcut: in any of the four directories, start `claude` and type `/harness-join`. It works out the role from the directory, checks nobody holds it, and tells you the `/rename` to run.

Or by hand. First message in terminals 2 to 4 (replace `<lane>`):

```
You are lane-<lane>. Read docs/superpowers/runbooks/harness-autonomy/lane.md and follow it, starting with its "On every start" section.
```

Then terminal 1:

```
/loop You are cg-orchestrator. Follow docs/superpowers/runbooks/harness-autonomy/orchestrator.md: run its start procedure if you have not done so in this session, then do one sweep.
```

## 3. During the run

- Questions reach you through the watchdog message and the orchestrator's push
  notifications. Answer in the orchestrator session, or with
  `coord answer <qid> "<text>"`.
- A session stopped on the usage limit: when the window resets, `claude --resume <name>`
  and send `Resume. Follow the "On every start" section of your role file.`
  (`orchestrator.md` for cg-orchestrator, `lane.md` for lanes). The orchestrator re-sends the
  protocol to the lanes itself.
- Status at any time, no LLM needed:
  `pwsh -File U:\Git\CentralGauge\scripts\coord\status.ps1` (one snapshot) or `... status.ps1 -Watch 30`
  (live, refreshes every 30 s). It shows milestones with progress and due dates, what is
  running, waiting for review, ready, blocked and why, open questions, leases, the pause
  state and anything stale. Details: `coord why <id>`, `coord status --lane <lane>`, where
  `coord` is `deno run --allow-all U:\Git\CentralGauge\scripts\coord\coord.ts`.
- Pause everything (you need the machine):
  `pwsh -File U:\Git\CentralGauge\scripts\coord\containers.ps1 pause -Reason "<why>"`.
  It sets the pause, waits until running container jobs finish and every lease is released
  (up to 90 minutes, `-TimeoutMin` changes it), then stops the containers that were running
  and remembers them. Lanes notice within about 15 minutes; tell the orchestrator "pause"
  to make it immediate. `-NoStop` pauses the work but leaves the containers running.
- Resume: `pwsh -File U:\Git\CentralGauge\scripts\coord\containers.ps1 resume`. It starts
  the remembered containers, waits for the BC login page, clears the pause. The
  orchestrator wakes the lanes on its next sweep (at most 30 minutes); tell it "resume" to
  do it now.

## 4. Not done by agents (yours)

Starting or restarting BC containers, production deploy, catalog sync, ingest, abandoning
the three stale batch runs from 2026-09-11 (`4a914cb8`, `6d28a4b1`, `8dc8e7e3`).
