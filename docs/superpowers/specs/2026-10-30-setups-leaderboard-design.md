# Setups leaderboard: ranking agent setups on the public site

Date: 2026-10-30. Status: design written from the brainstorm with the owner; awaiting owner approval.

## Intent

CentralGauge today ranks models: one model, one prompt, compile and test. The harness bench now runs whole agent
setups (an agent tool such as Claude Code, with its models, instruction files, skills, MCP servers and hooks) on a
different task set (the HX tasks in `harness-tasks/tasks/`), with repeats. Those numbers mean something different and
cannot share a table or chart with the model leaderboard.

The site gets a second ranked section, **Setups**. It is a ranking site for people's agent setups. Two audiences:

- BC developers choosing an agent setup.
- People checking how well their own setup fares against others.

Both want to pick two setups and compare them. People submit their own setups; the owner runs them.

## Goals

- Rank setups on the current HX task set by score, with price per solved task beside it.
- Let anyone open a setup and see everything that makes it up, and compare any two setups.
- Let people submit setups through a structured, private form.
- Keep history: old task sets and older agent-tool versions stay browsable.

## Non-goals

- Changing the Models section. It stays as it is, in its own section.
- Running submissions automatically. The owner triggers every run by hand.
- Notifying submitters about status (not for now).
- A network proxy to meter model calls. Usage comes from each tool's own output (see Cost).

## Anti-goal

Misleading numbers, especially cost compared unfairly across tools. Where a number is incomplete or approximate, the
site says so on that tool's pages. It never hides the gap and never mixes in a tool's own dollar figure.

## Site structure

Top navigation: Models (unchanged) | Setups (new) | Tasks | Submit a setup.

### Setups ranking page

- Ranks only setups that have results on the **current** HX task set.
- Columns: Rank, Description, Agent (the tool), Score, Price per solved task.
- A checkbox on each row; ticking two enables "Compare".
- Chart: a value map (score against price per solved task), the same idea as the Models section's value-map scatter,
  with the frontier of setups nothing beats on both axes marked.
- Private setups are hidden from the table and chart by default and shown with a toggle.
- A link to the archive of earlier task sets.

### Setup detail page

Opened by clicking a row. It shows:

- Agents and roles: each agent's model and effort (main, implementer, explorer, background model, and so on).
- Flow: how the roles hand work to each other, as the submitter describes it.
- Instructions: the CLAUDE.md or AGENTS.md file and any rules files.
- Skills, MCP servers, hooks and plugins, and tool settings.
- Results: score, price per solved task, per-task pass rate over repeats, cost and time.
- The agent tool version it was run on, and a history of earlier versions with their numbers.
- Whether it depends on a submitter-supplied key (see Submissions).
- The known issues for its agent tool's cost numbers (see Cost).

**Private setups** show the structure: tool, models and roles, and the names of skills and MCP servers. They do not show
file contents or the zip.

### Compare page

Builder's call, settled in the brainstorm by Claude:

- Ingredients of the two setups side by side, differences highlighted.
- Score and price side by side.
- Task grid for the two setups: one column per HX task, each cell coloured by pass rate over repeats, so tasks only one
  of them solves stand out. Environment-blocked cells are a separate colour.
- Score spread across repeats: each setup's score with a bar from worst to best repeat, so a lead that is only luck is
  visible.

### Archive

- When the task set changes, the previous set's ranking is archived with its task set and stays browsable.
- Only the current set is ranked.

### HX task pages

- Public pages for HX tasks, showing **only the human summary**, never the prompt or the code.
- The pages note that the full tasks are public on GitHub, so this lowers the chance of the tasks leaking into model
  training but does not prevent it.
- HX summaries follow the same rules as model-task summaries in `site/catalog/task-summaries.md`: what the task covers,
  never the defect, its location or any hint the prompt withholds.

## Scoring

- **Score** = pass rate across all HX tasks in the current set, averaged over repeats.
- Cells blocked by the environment or by infrastructure (env-blocked, harness crash, setup failed) are excluded from the
  score and shown separately, as the harness report already does.
- **Price per solved task** = model cost per solved task.
- Claude's call: the site publishes the harness report's per-arm numbers exactly as computed (`armSummary` in
  `src/harness/stats.ts`, eligibility in `src/harness/report.ts`), so the site and the report never disagree. That means
  per-task means first, then averaged, and the report's cost cohort. An arm is a setup.
- Claude's call: only a complete report is ranked. A `provisional` or `repeat_cut` report is held back until complete.
- Claude's call: the owner promotes a task set to current, as the Models side does with `task_sets.is_current`. Adding
  HX tasks during build-up does not archive anything until the owner promotes the new set.

## Cost

Only model calls cost money. Every agent tool reports token usage in its own output, so usage is read from there. Tokens
are priced with **one price list**, the same catalog the Models section uses (`site/catalog/`, via
`src/harness/pricing.ts`). A tool's own dollar figure is never used.

Every tool gets a price. What each tool's output covers differs; each gap is recorded as a **known issue** on that tool
and shown on its setups' detail pages. Findings from the 2026-10-30 research (VERIFIED from source, docs or a local
run unless marked):

| Tool | Usage source | Known issue |
|---|---|---|
| Claude Code | `-p --output-format json`, `modelUsage` per model (includes subagents). Not top-level `usage`, which excludes subagents. | Open bugs leave a few calls out: a retried failed stream counts only the retry; model-switch and auto-mode classifier calls are not counted. |
| Codex CLI | `exec --json`, `turn.completed.usage` (cumulative run total) | No model id, so all tokens are priced at the main model's rate. Subagent and background-compaction coverage UNCONFIRMED. |
| Pi | `--mode json`, `message_end.message.usage` per call with model; compaction and cache-warming recorded | Subagents exist only via extensions; their usage UNCONFIRMED. |
| OpenCode | `run --format json`, `step_finish.part.tokens` per step | Subagent sessions, title generation and compaction are not counted, so cost is understated when they run. |
| Cursor CLI | `-p --output-format json`, final `usage` (undocumented field) | No model id, no reasoning tokens; coverage of subagents and background calls unknown. Cost is approximate. |
| Antigravity | `--output-format json` `usage`; per-step in stream-json | No model id, no cache-write tokens; how thinking tokens relate to output is unclear; subagent coverage undocumented. Cost is approximate. |

Pricing rules the builder must follow:

- Do not double-count reasoning tokens: Pi already includes them in `output`; OpenCode reports them separately.
- Where a tool gives no model id, price at the setup's base model, and say so in the known issue.
- Claude's call: a model with no catalog price (for example a model only reachable through a subscription login) gets
  no price. The setup is still ranked on score, shows "price not available" with the reason, and is left off the value
  map. The owner can add a catalog entry later.
- A paid external service a setup depends on (for example a search API behind an MCP server) is outside our price.
  That is shown as a known issue on that setup.

The harness has adapters for Claude Code and Pi today (`src/harness/adapters/`). Owner decision: support for another
tool (adapter, container image, usage reader as above) is built **on demand**, when the first submission needs it. The
form accepts all six tools; a submission for an unsupported tool waits until that support exists. The plans cover
Claude Code and Pi only, and each new tool is its own later plan.

## Submissions

### Form

A private form on the site. Required fields:

- Agent tool: Claude Code, Codex, Pi, OpenCode, Cursor or Antigravity.
- Base model.
- Instructions file: CLAUDE.md or AGENTS.md, whichever fits the tool.
- Description: the one line shown in the ranking.
- Visibility: public (default once ranked) or private.

Everything else comes as **one zip** in the tool's normal project layout (for example `.claude/` with skills, agents,
rules and settings). A submission with only the required fields is a plain setup.

Claude's calls on the rest of the form:

- Optional fields: a roles table (role, model, effort) and a free-text flow description. The detail page shows these.
  Where the zip's own config also names models, the run's recorded usage is what the results show.
- On submit, the submitter gets a secret edit link. It is the only way to send a fresh key or change visibility later.
  No accounts.
- The public upload is protected: Turnstile captcha, rate limit and a zip size cap.

### Keys

- Setups that need no key are preferred.
- If an MCP server or similar needs a key, the submitter supplies it in a separate secret field, never inside the zip,
  and the key should expire at most 7 days after submission.
- Keys are stored encrypted, apart from the zip, and deleted when the run finishes. (Claude's call.)
- Such setups are labelled on their detail page.

### Review and runs

- Submissions land on an admin-only review page. The owner looks at the zip before triggering a run, since it is
  untrusted code.
- Owner decision: the owner translates each approved zip into a harness run config **by hand** (including any MCP
  image and network allowlist entries it needs). The build covers storing submissions, review and publishing, not
  automatic zip-to-run translation or changes to the harness egress rules.
- The owner triggers runs manually, on the owner's backend: containers on an isolated VLAN with internet access and no
  local network.
- Model API costs are paid by the owner or a sponsor. Which account pays never affects scores.
- No status notifications to submitters for now.

## Lifecycle

- **New task set:** setups without keys are rerun by the owner, so the new ranking starts full. Setups that need a key
  move to the archive until the submitter sends a fresh key.
- **New agent-tool version:** a rerun updates the same setup. The ranking shows the latest version; the detail page
  keeps earlier versions and their numbers.

## Publishing results

Claude's call: results reach the site only when the owner publishes them. After a run, the owner reviews it and pushes
it with an explicit command. Nothing ingests automatically. Prod ingest, D1 migrations and deploys stay owner-only, and
migrations go before the deploy as usual.

## Build order

One design, three plans, built in this order:

1. **Setups section on the site:** ranking, detail, compare, archive, HX task pages.
2. **Submission form and admin review page.**
3. **From backend runs to the site:** reading usage (Claude Code and Pi), pricing, publishing.

Later, one plan per additional agent tool, when a submission needs it.

## Left to the builder

- Database schema, API shape and page layout.
- How the zip and keys are stored (encrypted, apart from each other).
- How a setup's ingredients are read out of the zip for the detail and compare pages.
- Chart styling, consistent with the existing Models value map.
- The command that publishes a reviewed run.
