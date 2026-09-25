# Launch contract: Harness Bench autonomous run

Agreed with the owner on 2026-09-24. Every session reads this on startup. Where a rule
here and a prompt disagree, this file wins. Missing permission means wait, never assume.

## Dates

| Date | Gate |
| --- | --- |
| 2026-09-25 13:00 CET | Start, all sessions on the Max x20 account |
| 2026-09-29 | M0 spike done, findings written, M1 to M4 plans reviewed and loaded into `coord` |
| 2026-10-02 | One task end to end: refapp, Claude Code in the sandbox, trusted verdict, cost in the records |
| 2026-10-09 | 6 tasks qualified and frozen, Claude Code and pi adapters working, report computes the primary metric |
| 2026-10-10 to 10-13 | Campaigns: Claude Code MCP/skill arms, Claude Code vs pi head-to-head |
| 2026-10-14 to 10-15 | Rerun allowance, analysis, archive of raw data |
| 2026-10-16 | Data freeze. Handoff to the owner: numbers, charts, caveats for the slides |

A gate slipping by more than one day goes to the owner.

## Cut order (orchestrator may apply in this order without asking)

1. Laya / Jev call classification (rules only)
2. AL Tools NuGet `toolchain` component
3. Secondary report sections beyond the primary metric and outcome
4. Refapp breadth beyond the 6 tasks

Needs the owner: dropping pi, fewer than 6 tasks, changing the primary metric.

## Approvals

- Reviews run through `pi_ask` on the owner's OpenAI (ChatGPT) subscription
  (`PI_MCP_PROVIDER=openai-codex`). If `pi_models` shows only `github-copilot` rows, the
  registration is wrong: `coord ask`, do not review on Copilot silently.
- Plans, designs and decisions: orchestrator plus GPT-6 Sol via `pi_ask` (model id
  `gpt-6-sol`), up to 2 review rounds. GPT-6 Astra (`gpt-6-astra`) only for milestone
  plans (M1 to M4).
- A review binds to a commit SHA and absolute paths of frozen files (`git show <sha>:<path>`
  written to a file). `require_evidence` stays on. An answer with no file reads, a timeout, or
  unreadable files means NOT reviewed.
- After 2 rounds with an unresolved objection: `coord ask`, do not relabel the objection.
- Every decision is written to `<coord>/decisions/<date>-<slug>.md`: question, inputs (SHA),
  reviewer verdict (raw file path), decision, reason.

## Authorized

- Local commits in lane worktrees. Orchestrator merges to `master` and pushes to `origin`.
  Lanes never push.
- Create and remove disposable sandbox containers named `cg-harness-*`.
- Build images tagged `centralgauge/harness-*`.
- Use only the BC containers allocated to this project in `H:\cg-coord\allocation.json` (owner
  decision 2026-09-25: `Cronus281`, `Cronus282`, `Cronus283`), through leases (lane-ops only).
  `Cronus28` belongs to LethAL; `Cronus284`/`Cronus285` are unallocated until the owner
  allocates them.
- Sandbox Claude Code runs authenticate with the Team account OAuth token
  (`<secrets>/claude-oauth-token`), so the builders (Max) and the benchmarked runs (Team)
  draw on different usage.
- Paid API spend (non-subscription providers, for example OpenRouter for pi arms): hard stop
  at USD 150 total. Track it in `<coord>/decisions/spend.md`.
- Campaigns start without asking, after a `--sample 1` dry run whose cost estimate fits the
  remaining paid budget.

## Forbidden without the owner

- Starting, stopping, restarting, recreating or removing any BC container. A stopped container:
  `coord ask`, move on to other work.
- Production deploy (`wrangler deploy`, `npm run deploy`), `sync-catalog --apply`, any ingest
  to the site (`bench` must run with `--no-ingest`), D1 migrations.
- Editing or weakening tests or oracles to make something pass. Changing safety hooks, hook
  settings, permission settings or `CLAUDE.md`.
- Force pushes, history rewrites, deleting branches that are not your own lane branch.
- `git reset --hard`, `git checkout .`, `git clean` outside your own worktree.
- Outputs outside the repo, the coord root and `H:\Temp3\harness-spike\`.

## Always reported to the owner (`coord ask` + push notification)

Gate slips over a day, spend at 80 percent of the cap, a scope cut beyond the cut order, an
oracle or test that looks wrong, a lease or run with an uncertain owner, a security concern,
an unresolved reviewer objection, a hook blocking needed work.
