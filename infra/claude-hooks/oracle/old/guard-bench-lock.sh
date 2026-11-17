#!/usr/bin/env bash
# PreToolUse(Bash): refuse container-touching test runs while a bench is live.
#
# tests/unit/container/ publishes and unpublishes apps on the real Cronus
# containers. Running it during a bench corrupts that bench's BC NST PSSession
# and stalls the run (CLAUDE.md). Liveness comes from the heartbeat marker
# written by `bench` (src/utils/bench-lock.ts): a fresh mtime means a live
# bench, and a crashed bench's marker ages out on its own.
#
# Escape hatch: passing --ignore=tests/unit/container is always allowed.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

CMD=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$CMD" ] || exit 0

# Explicitly excluding the dangerous directory is always fine.
printf '%s' "$CMD" | grep -qF -- '--ignore=tests/unit/container' && exit 0

# Which invocations can reach tests/unit/container/?
#   - the deno tasks that run whole suites
#   - any path that targets tests/unit/ as a whole, or tests/unit/container
# A narrower path (tests/unit/utils/foo.test.ts) cannot, so it is left alone.
DANGEROUS=0
printf '%s' "$CMD" |
  grep -qE 'deno task test(:unit|:integration|:e2e|:watch|:status)?([[:space:]]|$)' &&
  DANGEROUS=1
printf '%s' "$CMD" | grep -qE 'tests/unit/container' && DANGEROUS=1
printf '%s' "$CMD" | grep -qE 'tests/unit/?([[:space:]]|$)' && DANGEROUS=1

[ "$DANGEROUS" -eq 1 ] || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-.}"
LOCK="$ROOT/results/.bench-running.json"

# -mmin -2 mirrors DEFAULT_STALE_AFTER_MS (120s) in src/utils/bench-lock.ts.
if [ -f "$LOCK" ] && [ -n "$(find "$LOCK" -mmin -2 2>/dev/null)" ]; then
  WHO=$(jq -r '"pid \(.pid), started \(.startedAt): \(.command)"' "$LOCK" 2>/dev/null) ||
    WHO="unknown run"
  jq -n --arg who "$WHO" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: ("A bench is live right now (" + $who + "). tests/unit/container/ publishes and unpublishes on the real Cronus containers and will corrupt that run. Safe alternative: deno test --allow-all --ignore=tests/unit/container tests/unit/ - or wait for the bench to finish.")
    }
  }'
fi

exit 0
