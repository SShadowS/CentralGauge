# Task summaries

Human-readable summaries shown on the site's task pages, above the exact model
prompt. They are outside the task-set hash, so editing them never forces a
re-bench. Rules: docs/superpowers/specs/2026-09-30-task-summaries-design.md.
Get a task's description_sha with `deno task summary-audit --print-sha <id>`.

## CG-AL-X185
description_sha: 1dc7824eba664cdc31361dd19ba5276386fcf0fe49533051d0b08bf67ab2f785

A composite diagnose task over four independent parts of one application: a
wire-format converter for an external service, a nightly legacy-amount import,
a travel-allowance calculator, and a cross-company meter-reading consolidator.
The report gives only one vague symptom, and the model must restore every
stated contract.
