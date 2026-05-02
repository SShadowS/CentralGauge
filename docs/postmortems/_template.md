# Postmortem template

> Use for any user-visible incident on the site.
> Filename: `YYYY-MM-DD-<short-slug>.md` (e.g., `2026-05-12-sse-fanout-loop.md`)

## Summary

One-paragraph plain-English description. Who was affected, for how long,
what they saw.

## Impact

| Metric                 | Value               |
| ---------------------- | ------------------- |
| Duration               | <X minutes / hours> |
| Affected routes        | <list>              |
| Affected user fraction | <%>                 |
| Data loss / corruption | yes / no            |
| Signed-payload tamper  | yes / no            |

## Timeline (UTC)

- `HH:MM` — Trigger event (e.g., deploy, schema change, dependency update)
- `HH:MM` — First report / observed alert
- `HH:MM` — Diagnosis confirmed
- `HH:MM` — Mitigation applied (flag flip / rollback / etc.)
- `HH:MM` — Verified resolved
- `HH:MM` — All-clear posted

## Root cause

What broke and why. One paragraph. Be specific — not "race condition" but
"two `$effect` blocks both opened EventSource without cleanup, leaking
sockets after rapid navigation". Include code references (filename:line).

## Fix

What changed and where. Link to the PR. Note any compensating tests added.

## Action items

| Action                             | Owner  | Due        |
| ---------------------------------- | ------ | ---------- |
| Add invariant test                 | <name> | YYYY-MM-DD |
| Document hazard in CONTRIBUTING.md | <name> | YYYY-MM-DD |
| Update operations runbook          | <name> | YYYY-MM-DD |

## What went well

- (Add 1-3 bullets)

## What went poorly

- (Add 1-3 bullets)

## Where we got lucky

- (Add 0-2 bullets)
