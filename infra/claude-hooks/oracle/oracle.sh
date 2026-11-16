#!/usr/bin/env bash
# H-108 oracle: the OLD hook scripts (old/) decide, the NEW ones (candidate/)
# must decide the same. Runs in a temp CLAUDE_PROJECT_DIR; touches nothing
# else. Writes oracle-table.md and exits 1 on any difference.
#   PreToolUse: commands x bench-lock state (fresh, stale, missing) x site
#   build state (missing, fresh, stale). Old effective decision = the most
#   restrictive of the three old hooks (deny > ask > none, the documented
#   precedence). The new output must equal the old one exactly when one old
#   hook spoke, and carry both reasons when two asked.
#   PostToolUse fmt: paths x file states; output and the file's bytes after.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
OLD="$HERE/old"
# NEW_HOOKS overrides the candidate (the mutation check points it at a broken copy).
NEW="${NEW_HOOKS:-$HERE/../hooks}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
P="$TMP/CentralGauge"
mkdir -p "$P/results" "$P/site/migrations" "$P/site/src/routes" "$P/site/.svelte-kit/output/server"
touch -d '2026-01-01 00:00' "$P/site/migrations/0001_a.sql"
touch -d '2026-01-02 00:00' "$P/site/migrations/0002_b.sql"
OUT="$HERE/oracle-table.md"
FAIL=0

cmds=(
  'ls -la'
  'grep -r test src'
  'deno test --allow-all --ignore=tests/unit/container tests/unit/'
  'deno test --allow-all tests/unit/utils/foo.test.ts'
  'deno test --allow-all tests/unit/'
  'deno test tests/unit'
  'deno test tests/unit/container/x.test.ts'
  'deno task test:unit'
  'deno task test'
  'deno task test:unit:no-container'
  'deno task test:unit > log.txt 2>&1'
  'wrangler deploy'
  'npm run deploy'
  'cd site && npm run deploy'
  'npx wrangler deploy --env production'
  'wrangler d1 migrations apply centralgauge --remote'
  'wrangler dev'
  'cd site && npx vitest run'
  'npm test'
  'cd site && npm run test'
  'cd site && npm run build && npx vitest run'
  'cd site && npm run test:e2e'
  'deno task test:unit && cd site && npm run deploy'
  'cd site && npm run deploy && npx vitest run'
  $'echo start\nwrangler deploy'
  $'wrangler\ndeploy'
  $'deno task test:unit\necho done'
  'echo "deploy notes" > x.txt'
  'cd site; npm run deploy'
  'deno test --ignore=tests\unit\container tests/unit/'
)
# Ruling 1: backslashes read as slashes. These rows may differ from the old
# hooks, but only toward a stricter decision (none < ask < deny).
bscmds=(
  'deno test --allow-all tests\unit\'
  'deno test --allow-all tests\unit'
  'deno test tests\unit\container\x.test.ts'
  'deno test --ignore=tests\unit\container tests\unit\'
  'deno test --allow-all tests\unit\utils\foo.test.ts'
  'cd site\ && npm run deploy'
)
rank() { case $1 in deny) echo 2 ;; ask) echo 1 ;; *) echo 0 ;; esac; }

decision() { # stdin: zero or more hook JSON objects; prints deny|ask|none
  jq -rs 'map(.hookSpecificOutput.permissionDecision) as $d |
    if ($d | index("deny")) then "deny" elif ($d | index("ask")) then "ask" else "none" end'
}

run_old() { # $1 = stdin text
  local s
  for s in guard-bench-lock guard-deploy-order guard-stale-site-build; do
    printf '%s' "$1" | CLAUDE_PROJECT_DIR="$P" bash "$OLD/$s.sh"
  done
}
run_new() { printf '%s' "$1" | CLAUDE_PROJECT_DIR="$P" bash "$NEW/guard.sh"; }

set_lock() {
  rm -f "$P/results/.bench-running.json"
  case $1 in
    fresh) echo '{"pid":1,"startedAt":"now","command":"bench x"}' >"$P/results/.bench-running.json" ;;
    stale) echo '{"pid":1,"startedAt":"then","command":"bench x"}' >"$P/results/.bench-running.json"
      touch -d '10 minutes ago' "$P/results/.bench-running.json" ;;
  esac
}
set_site() {
  local stamp="$P/site/.svelte-kit/output/server/index.js" src="$P/site/src/routes/page.ts"
  rm -f "$stamp"
  echo x >"$src"
  case $1 in
    fresh) touch -d '5 minutes ago' "$src"; echo x >"$stamp" ;;
    stale) touch -d '5 minutes ago' "$stamp"; touch "$src" ;;
  esac
}

compare() { # $1 label, $2 stdin, $3 "bs" = may only move stricter
  local o n od nd ok=yes
  o=$(run_old "$2")
  n=$(run_new "$2")
  od=$(printf '%s' "$o" | decision)
  nd=$(printf '%s' "$n" | decision)
  if [ "${3:-}" = bs ] && [ "$od" != "$nd" ]; then
    if [ "$(rank "$nd")" -gt "$(rank "$od")" ]; then ok=stricter; else ok=no; fi
    [ $ok = no ] && FAIL=1
    printf '| %s | %s | %s | %s |\n' "$1" "$od" "$nd" "$ok" >>"$OUT"
    return
  fi
  [ "$od" = "$nd" ] || ok=no
  local k
  k=$(printf '%s' "$o" | jq -s length)
  if [ "$k" = 1 ]; then
    [ "$(printf '%s' "$o" | jq -cS .)" = "$(printf '%s' "$n" | jq -cS .)" ] || ok=no
  elif [ "$k" -ge 2 ] && [ "$od" = ask ]; then
    [ "$(printf '%s' "$o" | jq -rs 'map(.hookSpecificOutput.permissionDecisionReason)|join("\n\n")')" = \
      "$(printf '%s' "$n" | jq -r .hookSpecificOutput.permissionDecisionReason)" ] || ok=no
  elif [ "$k" -ge 2 ]; then
    # A deny: the new output is the old deny, alone.
    [ "$(printf '%s' "$o" | jq -cS 'select(.hookSpecificOutput.permissionDecision=="deny")')" = \
      "$(printf '%s' "$n" | jq -cS .)" ] || ok=no
  else
    [ -z "$n" ] || ok=no
  fi
  [ $ok = yes ] || FAIL=1
  printf '| %s | %s | %s | %s |\n' "$1" "$od" "$nd" "$ok" >>"$OUT"
}

{
  echo "# H-108 oracle: old hooks against the new guard"
  echo
  echo "Generated by oracle.sh on $(date -u +%Y-%m-%dT%H:%MZ). \`old\` is the most restrictive decision of the three old PreToolUse hooks; \`same\` also requires the identical output (or both reasons, for two asks)."
  echo
  echo "## PreToolUse guard"
  echo
  echo "| command / lock / site build | old | new | same |"
  echo "| --- | --- | --- | --- |"
} >"$OUT"

for lock in fresh stale missing; do
  for site in missing fresh stale; do
    set_lock $lock
    set_site $site
    for c in "${cmds[@]}"; do
      label=$(printf '%s' "$c" | sed 's/|/\\|/g' | tr '\n' '⏎')
      compare "\`$label\` / $lock / $site" "$(jq -nc --arg c "$c" '{tool_name:"Bash",tool_input:{command:$c}}')"
    done
    for c in "${bscmds[@]}"; do
      compare "backslash \`$c\` / $lock / $site" "$(jq -nc --arg c "$c" '{tool_name:"PowerShell",tool_input:{command:$c}}')" bs
    done
  done
done
set_lock fresh
set_site stale
compare "PowerShell tool_name, \`deno task test:unit\` / fresh / stale" \
  "$(jq -nc '{tool_name:"PowerShell",tool_input:{command:"deno task test:unit"}}')"
compare "malformed: truncated JSON with test:unit / fresh / stale" '{"tool_input":{"command":"deno task test:unit"'
compare "malformed: not JSON, deploy / fresh / stale" 'npm run deploy'
compare "malformed: empty stdin / fresh / stale" ''
compare "no tool_input / fresh / stale" '{"tool_name":"Bash"}'

# PostToolUse fmt: run old and new on twin copies, compare output and bytes.
{
  echo
  echo "## PostToolUse deno-fmt-check"
  echo
  echo "| file_path | old output | new output | file after | same |"
  echo "| --- | --- | --- | --- | --- |"
} >>"$OUT"
W=$(cygpath -w "$P")
fmtcase() { # $1 label, $2 relpath under P (or abs), $3 content ('' = no file), $4 path style
  local ok=yes rel=$2 ob nb oo no path
  for side in old new; do
    rm -rf "$P/fmt"
    mkdir -p "$P/fmt" "$P/site/fmt" "$TMP/CentralGauge-wt/fmt"
    if [ -n "$3" ]; then printf '%s' "$3" >"$rel"; fi
    case $4 in
      win) path=$(cygpath -w "$rel") ;;
      *) path=$rel ;;
    esac
    local json
    json=$(jq -nc --arg f "$path" '{tool_name:"Edit",tool_input:{file_path:$f,old_string:"a",new_string:"b"}}')
    local hook="$OLD/deno-fmt-check.sh"
    [ $side = new ] && hook="$NEW/deno-fmt-check.sh"
    local res
    res=$(printf '%s' "$json" | CLAUDE_PROJECT_DIR="$W" bash "$hook")
    local bytes=""
    [ -f "$rel" ] && bytes=$(sha256sum <"$rel" | cut -c1-12)
    if [ $side = old ]; then oo=$res ob=$bytes; else no=$res nb=$bytes; fi
    rm -f "$rel"
  done
  [ "$oo" = "$no" ] && [ "$ob" = "$nb" ] || ok=no
  [ $ok = yes ] || FAIL=1
  local od=none nd=none
  [ -n "$oo" ] && od="context ($(printf '%s' "$oo" | jq -r .hookSpecificOutput.additionalContext | grep -o 'TS[0-9]*' | head -1))"
  [ -n "$no" ] && nd="context ($(printf '%s' "$no" | jq -r .hookSpecificOutput.additionalContext | grep -o 'TS[0-9]*' | head -1))"
  printf '| %s | %s | %s | %s | %s |\n' "$1" "$od" "$nd" "${ob:-n/a}" "$ok" >>"$OUT"
}
UGLY=$'export const   x:number=1\n'
BAD=$'export const x: number = "no";\n'
fmtcase 'README.md (non-.ts)' "$P/fmt/README.md" 'x' win
fmtcase 'a.ts, backslash path, needs fmt' "$P/fmt/a.ts" "$UGLY" win
fmtcase 'a.ts, forward-slash path, needs fmt' "$P/fmt/a.ts" "$UGLY" posix
fmtcase 'a.ts, type error' "$P/fmt/a.ts" "$BAD" win
fmtcase 'missing .ts' "$P/fmt/none.ts" '' win
fmtcase 'site/ .ts (skipped)' "$P/site/fmt/a.ts" "$UGLY" win
fmtcase 'CentralGauge-wt sibling prefix (skipped)' "$TMP/CentralGauge-wt/fmt/a.ts" "$UGLY" win
fmtcase 'a.md whose content holds .ts"' "$P/fmt/a.md" 'see "x.ts"' win

{
  echo "## fmt: malformed stdin"
  echo
} >>"$OUT"
for side in old new; do
  hook="$OLD/deno-fmt-check.sh"
  [ $side = new ] && hook="$NEW/deno-fmt-check.sh"
  r=$(printf '%s' '{"tool_input":{"file_path":"a.ts"' | CLAUDE_PROJECT_DIR="$W" bash "$hook"; echo "rc=$?")
  echo "- $side: \`$r\`" >>"$OUT"
done

rows=$(grep -c '^| .* | \(yes\|no\|stricter\) |$' "$OUT")
bad=$(grep -c '| no |$' "$OUT")
stricter=$(grep -c '| stricter |$' "$OUT")
printf '\n%s rows, %s different, %s backslash rows moved stricter (listed above as `stricter`).\n' "$rows" "$bad" "$stricter" | tee -a "$OUT"
exit $FAIL
