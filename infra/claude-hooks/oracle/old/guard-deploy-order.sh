#!/usr/bin/env bash
# PreToolUse(Bash): enforce the site deploy ORDER.
#
# `npm run deploy` is bare `wrangler deploy` and does NOT apply D1 migrations.
# Deploying a worker whose SQL references a column added by an unapplied
# migration 500s every request — this already happened once with
# 0011_family_open_weight.sql and the leaderboard query on mf.open_weight.
#
# Required order (CLAUDE.md):
#   1. wrangler d1 migrations apply <db> --remote
#   2. centralgauge sync-catalog --apply      (backfill the new column)
#   3. bump the leaderboard cache _cv if the response shape changed
#   4. cd site && npm run deploy
#
# This asks rather than denies: the operator confirms 1-3 are done.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

CMD=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$CMD" ] || exit 0

# Only the worker deploy. `wrangler d1 migrations apply` and `wrangler dev` are
# not deploys and must pass straight through.
printf '%s' "$CMD" | grep -qE '(wrangler[[:space:]]+deploy|npm[[:space:]]+run[[:space:]]+deploy)' || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-.}"
PENDING=""
if [ -d "$ROOT/site/migrations" ]; then
  # Migrations added or modified since the last deploy stamp are the usual
  # trigger; listing the newest few gives the operator something concrete.
  PENDING=$(ls -1t "$ROOT/site/migrations"/*.sql 2>/dev/null | head -3 |
    xargs -r -n1 basename | tr '\n' ' ')
fi

jq -n --arg pending "$PENDING" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: ("Deploy order check. Migrations MUST be applied before the worker deploy or the leaderboard 500s on every request.\n  1. wrangler d1 migrations apply <db> --remote\n  2. centralgauge sync-catalog --apply\n  3. bump the leaderboard cache _cv if the response shape changed\n  4. cd site && npm run deploy\nNewest migration files: " + (if $pending == "" then "(none found)" else $pending end) + "\nConfirm steps 1-3 are done.")
  }
}'

exit 0
