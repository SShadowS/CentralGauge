#!/usr/bin/env bash
# PostToolUse(Edit|Write): format and type-check exactly the file that changed.
#
# CLAUDE.md requires fmt/check to be SCOPED to touched files: the repo has
# CRLF/LF drift, so a repo-wide `deno fmt` rewrites dozens of unrelated files.
# `site/` is excluded entirely because `deno fmt` there fights site's own
# prettier config.
#
# Non-blocking: type errors come back as additionalContext, not a hard failure,
# so a mid-refactor edit that references a not-yet-written file does not stall
# the turn.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

FILE=$(jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[ -n "$FILE" ] || exit 0
[ -f "$FILE" ] || exit 0

case "$FILE" in
  *.ts) ;;
  *) exit 0 ;;
esac

# Claude Code hands back native Windows paths here, so normalise the separators
# before any path matching. Without this the site/ skip below silently misses
# `U:\Git\CentralGauge\site\src\...` and deno fmt trashes site's prettier style.
NORM=${FILE//\\//}

# Only files inside this checkout. A session here can edit other repos (a Bun
# repo got its tabs rewritten once); deno fmt must never run on those.
# Compare lowercase with forward slashes and a trailing slash, so a sibling
# like CentralGauge-wt/ does not match CentralGauge/ as a prefix.
canon() {
  local p=${1//\\//}
  p=$(printf '%s' "$p" | tr '[:upper:]' '[:lower:]')
  case "$p" in
    /[a-z]/*) p="${p:1:1}:${p:2}" ;;  # /u/git/... -> u:/git/...
  esac
  printf '%s' "${p%/}"
}
ROOT=${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}
[ -n "$ROOT" ] || exit 0
case "$(canon "$FILE")/" in
  "$(canon "$ROOT")"/*) ;;
  *) exit 0 ;;
esac

# site/ has its own toolchain (prettier + svelte-check); never touch it here.
case "$NORM" in
  */site/*|site/*) exit 0 ;;
esac

deno fmt "$FILE" >/dev/null 2>&1

if ! OUT=$(deno check "$FILE" 2>&1); then
  # Strip ANSI colour codes and the download noise deno emits on a cold cache.
  MSG=$(printf '%s\n' "$OUT" |
    sed 's/\x1b\[[0-9;]*m//g' | grep -v 'Download ' | tail -40)
  jq -n --arg msg "deno check failed for $FILE:
$MSG" \
    '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$msg}}'
fi

exit 0
