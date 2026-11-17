#!/usr/bin/env bash
# PreToolUse(Bash): catch site tests running against a stale build.
#
# site/ vitest runs against the built .svelte-kit/output bundle, NOT src. After
# editing site/src/**, skipping `npm run build` means debugging code that is no
# longer on disk (CLAUDE.md). This compares the build stamp against the newest
# source file and asks before running tests on a stale bundle.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

CMD=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$CMD" ] || exit 0

# Test invocations only. A command that builds first is already correct.
printf '%s' "$CMD" | grep -qE '(vitest|npm[[:space:]]+(run[[:space:]]+)?test)' || exit 0
printf '%s' "$CMD" | grep -qE 'npm[[:space:]]+run[[:space:]]+build' && exit 0
# Playwright e2e drives a real server, not the vitest bundle.
printf '%s' "$CMD" | grep -qE 'test:e2e' && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-.}"
STAMP="$ROOT/site/.svelte-kit/output/server/index.js"

if [ ! -f "$STAMP" ]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "site/.svelte-kit/output is missing - vitest runs against the built bundle, not src. Run `cd site && npm run build` first."
    }
  }'
  exit 0
fi

NEWER=$(find "$ROOT/site/src" -type f -newer "$STAMP" -print 2>/dev/null | head -5)
if [ -n "$NEWER" ]; then
  LIST=$(printf '%s\n' "$NEWER" | sed "s|^$ROOT/||" | tr '\n' ' ')
  jq -n --arg list "$LIST" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: ("Stale site build: vitest runs against .svelte-kit/output, and these sources are newer than the last build - " + $list + "\nRun `cd site && npm run build` first, or you will be debugging stale code.")
    }
  }'
fi

exit 0
