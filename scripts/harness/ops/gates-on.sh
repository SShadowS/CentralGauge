#!/usr/bin/env bash
# W2-11 gates, one task per `gates` call so a stop or the RAM floor stops the batch between tasks.
# H-76: --lineage on every call. H-89: any active stop of jobs\W2-12\STOP-gates-<container> (stops.sh:
# the file itself or a named STOP-gates-<container>.<writer>) stops the batch, e.g. hostwatch's host-all.
# usage: gates-on.sh <container> <lease-file> <rev> <task>...
C=$1; LF=$2; REV=$3; shift 3
. "$(dirname "$0")/stops.sh"
J='/h/cg-coord/jobs/W2-12'
LOG="$J/gates-$C.log"
STOPF="$J/STOP-gates-$C"
FLOOR=4
T=$(jq -r .token "$LF") || exit 3
cd /h/cg-coord/jobs/W2-05-gates || exit 3
echo "=== [$(date -u +%FT%TZ)] gates on $C rev $REV: $*" >> "$LOG"
n=0
for t in "$@"; do
  s=$(active_stops "$STOPF" | tr '\n' ' ')
  [ -n "$s" ] && { echo "[stop] $(date -u +%FT%TZ) $s, not starting $t" >> "$LOG"; break; }
  free=$(powershell -NoProfile -Command "[string]::Format([cultureinfo]::InvariantCulture,'{0:F1}',(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB)" | tr -d '\r')
  if ! [[ "$free" =~ ^[0-9]+(\.[0-9]+)?$ ]] || awk -v f="$free" -v m="$FLOOR" 'BEGIN { exit !(f < m) }'; then
    echo "[stop] $(date -u +%FT%TZ) free RAM '$free' GB < $FLOOR or unreadable, not starting $t" >> "$LOG"; break
  fi
  if jq -e --arg c "$C" 'select(.state=="quarantined" and .container==$c)' /h/cg-coord/harness-quarantine/*.json > /dev/null 2>&1; then
    echo "[stop] $(date -u +%FT%TZ) $C quarantined, not starting $t" >> "$LOG"; break
  fi
  echo "--- [$(date -u +%FT%TZ)] $t (free ${free} GB)" >> "$LOG"
  DOCKER_CONTEXT=desktop-windows CG_LANE=ops deno run --allow-all scripts/harness/gate-task.ts gates "$t" \
    --containers "$C" --coord-lease "$C=$T" --rev "$REV" \
    --lineage 'infra\harness-reset\lineages\golden-o09-v2.json' >> "$LOG" 2>&1
  rc=$?
  echo "$t exit $rc" >> "$LOG"
  # GATES_RESTART_EVERY=N: restart the container after every N clean tasks (a gate batch never restarts the NST; 282 hit the 8 GiB cap at 3.5 h on 11-09).
  n=$((n+1))
  if [ -n "$GATES_RESTART_EVERY" ] && [ "$rc" = 0 ] && [ $((n % GATES_RESTART_EVERY)) -eq 0 ] && [ "$n" -lt "$#" ]; then
    echo "[restart] $(date -u +%FT%TZ) $C after $n tasks" >> "$LOG"
    DOCKER_CONTEXT=desktop-windows docker restart "$C" >> "$LOG" 2>&1
    sleep 20
    until [ "$(DOCKER_CONTEXT=desktop-windows docker inspect -f '{{.State.Health.Status}}' "$C")" = healthy ]; do sleep 5; done
    echo "[restart] $(date -u +%FT%TZ) $C healthy" >> "$LOG"
  fi
done
echo "batch done" >> "$LOG"
