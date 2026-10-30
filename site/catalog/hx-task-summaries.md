# HX task summaries

Human-readable summaries shown on the site's setup task pages (/hx-tasks/<id>).
The page never shows the prompt itself. A task without an entry shows "No
summary yet.". Same format and rules as task-summaries.md, except there is no
baseline file: a missing entry is allowed.
Get a task's description_sha with `deno task summary-audit --print-sha <id>`;
for HX tasks it is the sha256 of harness-tasks/tasks/<id>/prompt.md.
