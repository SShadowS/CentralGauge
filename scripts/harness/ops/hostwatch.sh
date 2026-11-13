#!/usr/bin/env bash
# H-89 host watcher: one instance per host, for every running campaign and gate pool. Replaces the
# stopgaps jobs\W2-10\commit-watch.sh, allstop-watch.sh and np-pool-watch.sh.
#
# Fail-safe: when it cannot tell that memory is fine, it acts as if memory is low.
# Every INTERVAL s it reads free RAM, commit headroom (FreeVirtualMemory) and nonpaged pool in
# invariant culture, logs them, refreshes $DIR/heartbeat, and writes named stops (stops.sh):
#   host-low  to the lowest-priority targets: commit < 6 GB, free < 8 GB, nonpaged pool more than
#             1.5 GB above its low over the last 15 readings, no good reading for more than 90 s
#             (a timeout, an empty or unparsed answer, a failed fork all count), or a comparison
#             that gives no clean verdict (awk or fork failure)
#   host-all  to every target: commit < 3 GB, free < 4 GB, or no good reading for more than 180 s
# Nothing is ever removed: a stop stays until someone archives it on the orchestrator's go.
# Each campaign's watch.sh writes P.watch when this heartbeat is older than 180 s or missing, so a
# dead hostwatch also stops the runs.
#
# Registry (HW_REG, default $DIR/targets.tsv): one target per line, "<stop prefix> <priority>":
# the priority is the last field (an integer, lower = stopped first), so a prefix may contain
# spaces; blank lines and lines starting with "#" (after leading blanks) are ignored; CRLF and a
# last line without a newline are accepted. Hostwatch refuses to start on a missing, empty or
# malformed registry. If it turns malformed while running, the last good copy stays in use and an
# ALERT is logged.
#
# Start detached (Start-Process bash.exe <this script>) so the Claude Code reaper cannot end it.
# Stop: create $DIR/STOP-hostwatch; it writes host-low to the lowest-priority targets first, then
# exits. A second instance refuses while the first is alive (stops.sh lock_take).
# Test hooks: HW_DIR, HW_REG, HW_INTERVAL, HW_ITER (readings, 0 = forever), HW_FEED (file with one
# "free commit np" line per reading, "STALL" = no answer), HW_STEP (fake clock: seconds per
# reading), HW_PS_TIMEOUT (default 45), HW_STALL_LOW / HW_STALL_ALL (default 90 / 180).
# H-89b: the stall age uses a monotonic clock (/proc/uptime, seconds since boot), never the wall
# clock, so a backward clock jump cannot hide a stall. A stop that cannot be written is retried
# once, then logged as an ALERT and written to every other target as well.
set -uo pipefail
export LC_ALL=C
. "$(dirname "$0")/stops.sh"
DIR=${HW_DIR:-/h/cg-coord/jobs/W2-10/hostwatch}; REG=${HW_REG:-$DIR/targets.tsv}; LOG=$DIR/hostwatch.log
INTERVAL=${HW_INTERVAL:-60}; ITER=${HW_ITER:-0}; PST=${HW_PS_TIMEOUT:-45}
LOW_COMMIT=6 LOW_FREE=8 ALL_COMMIT=3 ALL_FREE=4 NP_RISE=1.5 NP_WINDOW=15
STALL_LOW=${HW_STALL_LOW:-90} STALL_ALL=${HW_STALL_ALL:-180}
mkdir -p "$DIR" || exit 2
say() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

# One checked parse at startup (H-89b item 6): what is validated is what gets stored.
if ! parse_reg "$REG" 2> "$DIR/reg.err"; then
  err=$(cat "$DIR/reg.err"); echo "hostwatch refuses to start: $err" >&2; say "REFUSED to start: $err"; exit 2
fi
GOOD_P=("${TGT_P[@]}"); GOOD_N=("${TGT_N[@]}"); reg_ok=1

lock_take "$DIR/lock" 2>> "$LOG"; rc=$?
[ $rc = 0 ] || { echo "hostwatch: lock not taken (see $LOG)" >&2; [ $rc = 3 ] && echo "hostwatch already runs" >&2; exit 3; }
trap 'lock_release "$DIR/lock"' EXIT
say "started (pid $$), ${#GOOD_P[@]} targets"

k=0
# Monotonic seconds: /proc/uptime (Cygwin/MSYS: time since boot), falling back to bash's SECONDS.
# HW_STEP replaces it with a fake clock of k * HW_STEP seconds (dry tests).
now() {
  if [ -n "${HW_STEP:-}" ]; then echo $((k * HW_STEP)); return; fi
  local u; read -r u _ < /proc/uptime 2> /dev/null && [[ "$u" =~ ^[0-9]+ ]] && { echo "${BASH_REMATCH[0]}"; return; }
  echo "$SECONDS"
}
read_mem() {
  if [ -n "${HW_FEED:-}" ]; then
    local l; l=$(sed -n "${k}p" "$HW_FEED")
    [ -n "$l" ] && [ "$l" != STALL ] && echo "$l"
    return
  fi
  timeout -k 10 "$PST" powershell -NoProfile -Command '$o=Get-CimInstance Win32_OperatingSystem; $np=(Get-CimInstance Win32_PerfRawData_PerfOS_Memory).PoolNonpagedBytes; [string]::Format([cultureinfo]::InvariantCulture,"{0:F1} {1:F1} {2:F2}",$o.FreePhysicalMemory/1MB,$o.FreeVirtualMemory/1MB,$np/1GB)' | tr -d '\r'
}

hit() { # <host-low|host-all> <why>: write it into the matching targets of the last good registry
  local i min="" rc failed=()
  for i in "${!GOOD_N[@]}"; do [ -z "$min" ] || [ "${GOOD_N[$i]}" -lt "$min" ] && min=${GOOD_N[$i]}; done
  for i in "${!GOOD_P[@]}"; do
    [ "$1" = host-low ] && [ "${GOOD_N[$i]}" != "$min" ] && continue
    stop_write "${GOOD_P[$i]}" "$1" "$2"; rc=$?
    if [ $rc = 2 ]; then sleep 1; stop_write "${GOOD_P[$i]}" "$1" "$2"; rc=$?; fi
    case $rc in
      0) say "ALERT $1 -> ${GOOD_P[$i]}.$1 ($2)" ;;
      2) say "ALERT stop write FAILED twice: ${GOOD_P[$i]}.$1 ($2)"; failed+=("$i") ;;
    esac
  done
  # A target that could not be stopped: the same stop goes to every other target too (H-89b item 4).
  if [ ${#failed[@]} -gt 0 ]; then
    for i in "${!GOOD_P[@]}"; do
      [[ " ${failed[*]} " == *" $i "* ]] && continue
      stop_write "${GOOD_P[$i]}" "$1" "escalated: a stop write to another target failed; $2" &&
        say "ALERT $1 -> ${GOOD_P[$i]}.$1 (escalated after a failed write)"
    done
  fi
  return 0
}

num='[0-9]+(\.[0-9]+)?'
nps=(); last_good=$(now)
while :; do
  k=$((k + 1))
  if [ -f "$DIR/STOP-hostwatch" ]; then
    hit host-low "hostwatch stopping (STOP-hostwatch)"; say "stopping on STOP-hostwatch"; exit 0
  fi
  if parse_reg "$REG" 2> "$DIR/reg.err"; then
    GOOD_P=("${TGT_P[@]}"); GOOD_N=("${TGT_N[@]}"); [ $reg_ok = 1 ] || say "registry valid again"; reg_ok=1
  elif [ $reg_ok = 1 ]; then
    reg_ok=0; say "ALERT registry malformed, keeping the last good copy: $(cat "$DIR/reg.err")"
  fi
  out=$(read_mem); rc=$?
  t=$(now)  # after the read, so a hung read counts toward the stall age; monotonic, see now()
  if [ $rc = 0 ] && [[ "$out" =~ ^$num\ $num\ $num$ ]]; then
    read -r FREE COMMIT NP <<< "$out"
    last_good=$t; nps+=("$NP"); [ ${#nps[@]} -gt $NP_WINDOW ] && nps=("${nps[@]: -$NP_WINDOW}")
    v=$(awk -v f="$FREE" -v c="$COMMIT" -v n="$NP" -v w="${nps[*]}" -v ac=$ALL_COMMIT -v af=$ALL_FREE \
      -v lc=$LOW_COMMIT -v lf=$LOW_FREE -v r=$NP_RISE 'BEGIN {
        k = split(w, a, " "); lo = a[1]; for (i = 2; i <= k; i++) if (a[i] + 0 < lo + 0) lo = a[i]
        if (c < ac || f < af) print "ALL", lo; else if (c < lc || f < lf || n - lo > r) print "LOW", lo; else print "OK", lo }')
    vrc=$?
    read -r verdict lo <<< "$v"
    say "free=$FREE commit_headroom=$COMMIT np=$NP np_low=${lo:-?} verdict=${verdict:-none}"
    why="free $FREE GB, commit headroom $COMMIT GB, nonpaged ${lo:-?} -> $NP GB"
    if [ $vrc != 0 ] || [ -z "$verdict" ]; then hit host-low "no clean verdict (awk rc $vrc): $why"
    elif [ "$verdict" = ALL ]; then hit host-all "$why"
    elif [ "$verdict" = LOW ]; then hit host-low "$why"
    elif [ "$verdict" != OK ]; then hit host-low "unexpected verdict '$verdict': $why"; fi
  else
    age=$((t - last_good))
    say "bad reading (rc $rc, '$out'), ${age}s since the last good one"
    if [ $age -gt $STALL_ALL ]; then hit host-all "no good reading for ${age}s"
    elif [ $age -gt $STALL_LOW ]; then hit host-low "no good reading for ${age}s"; fi
  fi
  date -u +%FT%TZ > "$DIR/heartbeat" || say "ALERT heartbeat write failed"
  [ "$ITER" -gt 0 ] && [ $k -ge "$ITER" ] && break
  sleep "$INTERVAL"
done
