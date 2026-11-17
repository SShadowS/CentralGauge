#!/usr/bin/env bash
# PreToolUse(Bash|PowerShell): one guard for three rules (H-108). It replaces
# guard-bench-lock.sh, guard-deploy-order.sh and guard-stale-site-build.sh with
# the same decisions, and forks nothing unless the command can match a rule.
#
#   bench lock  DENY  container-touching test runs while a bench is live.
#               tests/unit/container/ publishes on the real Cronus containers
#               and corrupts a live bench's NST PSSession (CLAUDE.md). A fresh
#               results/.bench-running.json (younger than 2 min, the 120 s
#               DEFAULT_STALE_AFTER_MS in src/utils/bench-lock.ts) means live.
#               --ignore=tests/unit/container is always allowed.
#   deploy      ASK   `wrangler deploy` / `npm run deploy`: migrations must be
#               applied before the worker deploy, or the leaderboard 500s.
#               `wrangler d1 migrations apply` and `wrangler dev` pass.
#   stale site  ASK   vitest runs against site/.svelte-kit/output, not src; ask
#               when the bundle is missing or older than site/src.
#
# Matching keeps grep -E's line semantics: a pattern matches when any line of
# the command matches it (anyline), with backslashes read as slashes (the one
# deliberate change, H-108 ruling 1). Malformed input fails open, as before.
set -uo pipefail
# The exec form starts bash.exe without a login shell: put Git's tools first,
# or `find` is C:\Windows\System32\find.exe and the lock check fails open.
PATH="/usr/bin:/mingw64/bin:$PATH"

IFS= read -r -d '' RAW || true
# Early exit, builtins only: every rule needs "test" or "deploy" in the
# command, and JSON never escapes a letter, so the raw input must contain one.
case "$RAW" in
  *test* | *deploy*) ;;
  *) exit 0 ;;
esac

command -v jq >/dev/null 2>&1 || exit 0
CMD=$(jq -r '.tool_input.command // empty' <<<"$RAW" 2>/dev/null) || exit 0
[ -n "$CMD" ] || exit 0
# Patterns match with `\` read as `/` (PowerShell writes tests\unit\container),
# so a backslash path can only move a decision toward deny or ask. The
# --ignore escape below reads the raw command: a backslash form is no escape.
mapfile -t LINES <<<"${CMD//\\//}"

anyline() {
  local l
  for l in "${LINES[@]}"; do
    [[ $l =~ $1 ]] && return 0
  done
  return 1
}

ROOT="${CLAUDE_PROJECT_DIR:-.}"

bench_lock() {
  [[ $CMD == *--ignore=tests/unit/container* ]] && return 0
  anyline 'deno task test(:unit|:integration|:e2e|:watch|:status)?([[:space:]]|$)' ||
    anyline 'tests/unit/container' ||
    anyline 'tests/unit/?([[:space:]]|$)' || return 0
  local lock="$ROOT/results/.bench-running.json" who
  [ -f "$lock" ] && [ -n "$(find "$lock" -mmin -2 2>/dev/null)" ] || return 0
  who=$(jq -r '"pid \(.pid), started \(.startedAt): \(.command)"' "$lock" 2>/dev/null) ||
    who="unknown run"
  jq -n --arg who "$who" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: ("A bench is live right now (" + $who + "). tests/unit/container/ publishes and unpublishes on the real Cronus containers and will corrupt that run. Safe alternative: deno test --allow-all --ignore=tests/unit/container tests/unit/ - or wait for the bench to finish.")
    }
  }'
}

deploy_order() {
  anyline '(wrangler[[:space:]]+deploy|npm[[:space:]]+run[[:space:]]+deploy)' || return 0
  local pending=""
  if [ -d "$ROOT/site/migrations" ]; then
    pending=$(ls -1t "$ROOT/site/migrations"/*.sql 2>/dev/null | head -3 |
      xargs -r -n1 basename | tr '\n' ' ')
  fi
  jq -n --arg pending "$pending" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: ("Deploy order check. Migrations MUST be applied before the worker deploy or the leaderboard 500s on every request.\n  1. wrangler d1 migrations apply <db> --remote\n  2. centralgauge sync-catalog --apply\n  3. bump the leaderboard cache _cv if the response shape changed\n  4. cd site && npm run deploy\nNewest migration files: " + (if $pending == "" then "(none found)" else $pending end) + "\nConfirm steps 1-3 are done.")
    }
  }'
}

stale_site() {
  anyline '(vitest|npm[[:space:]]+(run[[:space:]]+)?test)' || return 0
  anyline 'npm[[:space:]]+run[[:space:]]+build' && return 0
  anyline 'test:e2e' && return 0
  local stamp="$ROOT/site/.svelte-kit/output/server/index.js" newer list
  if [ ! -f "$stamp" ]; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "site/.svelte-kit/output is missing - vitest runs against the built bundle, not src. Run `cd site && npm run build` first."
      }
    }'
    return 0
  fi
  newer=$(find "$ROOT/site/src" -type f -newer "$stamp" -print 2>/dev/null | head -5)
  [ -n "$newer" ] || return 0
  list=$(printf '%s\n' "$newer" | sed "s|^$ROOT/||" | tr '\n' ' ')
  jq -n --arg list "$list" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: ("Stale site build: vitest runs against .svelte-kit/output, and these sources are newer than the last build - " + $list + "\nRun `cd site && npm run build` first, or you will be debugging stale code.")
    }
  }'
}

# A deny stands alone, as the old hooks' combined decision did; two asks
# become one ask with both reasons.
DENY=$(bench_lock)
if [ -n "$DENY" ]; then
  printf '%s\n' "$DENY"
  exit 0
fi
ASK1=$(deploy_order)
ASK2=$(stale_site)
if [ -n "$ASK1" ] && [ -n "$ASK2" ]; then
  printf '%s\n%s\n' "$ASK1" "$ASK2" | jq -s '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: (map(.hookSpecificOutput.permissionDecisionReason) | join("\n\n"))
    }
  }'
elif [ -n "$ASK1$ASK2" ]; then
  printf '%s\n' "$ASK1$ASK2"
fi
exit 0
