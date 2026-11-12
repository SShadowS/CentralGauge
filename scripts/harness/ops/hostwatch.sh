#!/usr/bin/env bash
# H-89 host watcher: one instance per host, for every running campaign and gate pool. Replaces the
# stopgaps jobs\W2-10\commit-watch.sh, allstop-watch.sh and np-pool-watch.sh.
#
# Every INTERVAL s it reads free RAM, commit headroom (FreeVirtualMemory) and nonpaged pool in
# invariant culture, logs them, and writes named stops (stops.sh) into the targets in the registry:
#   host-low  to the lowest-priority targets: commit < 6 GB, free < 8 GB, nonpaged pool more than
#             1.5 GB above its low over the last 15 readings, or 2 stalled readings in a row
#   host-all  to every target: commit < 3 GB, free < 4 GB, or 5 stalled readings in a row
# A stalled reading (no answer within 45 s) counts as unsafe, not as silence. A reading that does
# not parse (e.g. a comma decimal) is logged and skipped. Nothing is ever removed: a stop stays
# until someone clears it on the orchestrator's go.
#
# Registry (HW_REG, default $DIR/targets.tsv): one target per line, "<stop prefix> <priority>",
# lower priority = stopped first; "#" lines are comments. Edit it when a campaign starts or ends.
#
# Start detached (Start-Process bash.exe <this script>) so the Claude Code reaper cannot end it.
# Stop: create $DIR/STOP-hostwatch. A second instance refuses while the first is alive.
# Test hooks: HW_DIR, HW_REG, HW_INTERVAL, HW_ITER (readings, 0 = forever),
# HW_FEED (file with one "free commit np" line per reading, "STALL" = no answer).
set -uo pipefail
. "$(dirname "$0")/stops.sh"
DIR=${HW_DIR:-/h/cg-coord/jobs/W2-10/hostwatch}; REG=${HW_REG:-$DIR/targets.tsv}; LOG=$DIR/hostwatch.log
INTERVAL=${HW_INTERVAL:-60}; ITER=${HW_ITER:-0}
LOW_COMMIT=6 LOW_FREE=8 ALL_COMMIT=3 ALL_FREE=4 NP_RISE=1.5 NP_WINDOW=15 STALL_LOW=2 STALL_ALL=5
mkdir -p "$DIR"
say() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

if ! mkdir "$DIR/lock" 2> /dev/null; then
  old=$(cat "$DIR/lock/pid" 2> /dev/null)
  if [ -n "$old" ] && kill -0 "$old" 2> /dev/null; then echo "hostwatch already runs (pid $old)"; exit 3; fi
  say "stale lock (pid ${old:-?}) taken over"
fi
echo $$ > "$DIR/lock/pid"
trap 'rm -rf "$DIR/lock"' EXIT

k=0
read_mem() {
  if [ -n "${HW_FEED:-}" ]; then
    local l; l=$(sed -n "${k}p" "$HW_FEED")
    [ -n "$l" ] && [ "$l" != STALL ] && echo "$l"
    return
  fi
  timeout 45 powershell -NoProfile -Command '$o=Get-CimInstance Win32_OperatingSystem; $np=(Get-CimInstance Win32_PerfRawData_PerfOS_Memory).PoolNonpagedBytes; [string]::Format([cultureinfo]::InvariantCulture,"{0:F1} {1:F1} {2:F2}",$o.FreePhysicalMemory/1MB,$o.FreeVirtualMemory/1MB,$np/1GB)' | tr -d '\r'
}

hit() { # <tier name> <why>: write it into the matching targets
  local min p prio
  min=$(awk '!/^#/ && NF >= 2 { print $2 }' "$REG" 2> /dev/null | sort -n | head -1)
  while read -r p prio _; do
    case "$p" in '' | '#'*) continue ;; esac
    [ "$1" = host-low ] && [ "$prio" != "$min" ] && continue
    stop_write "$p" "$1" "$2" && say "ALERT $1 -> $p.$1 ($2)"
  done < "$REG"
}

num='[0-9]+(\.[0-9]+)?'
fails=0; nps=()
while [ ! -f "$DIR/STOP-hostwatch" ]; do
  k=$((k + 1))
  if out=$(read_mem) && [ -n "$out" ]; then
    if [[ "$out" =~ ^$num\ $num\ $num$ ]]; then
      read -r FREE COMMIT NP <<< "$out"
      fails=0; nps+=("$NP"); [ ${#nps[@]} -gt $NP_WINDOW ] && nps=("${nps[@]: -$NP_WINDOW}")
      lo=$(printf '%s\n' "${nps[@]}" | sort -g | head -1)
      say "free=$FREE commit_headroom=$COMMIT np=$NP np_low=$lo"
      why="free $FREE GB, commit headroom $COMMIT GB, nonpaged $lo -> $NP GB"
      if awk -v f="$FREE" -v c="$COMMIT" -v ac=$ALL_COMMIT -v af=$ALL_FREE 'BEGIN { exit !(c < ac || f < af) }'; then
        hit host-all "$why"
      elif awk -v f="$FREE" -v c="$COMMIT" -v n="$NP" -v l="$lo" -v lc=$LOW_COMMIT -v lf=$LOW_FREE -v r=$NP_RISE \
        'BEGIN { exit !(c < lc || f < lf || n - l > r) }'; then
        hit host-low "$why"
      fi
    else
      say "unparsed '$out' (skipped)"
    fi
  else
    fails=$((fails + 1))
    say "stalled reading ($fails in a row)"
    if [ $fails -ge $STALL_ALL ]; then hit host-all "$fails stalled readings"
    elif [ $fails -ge $STALL_LOW ]; then hit host-low "$fails stalled readings"; fi
  fi
  [ "$ITER" -gt 0 ] && [ $k -ge "$ITER" ] && break
  sleep "$INTERVAL"
done
