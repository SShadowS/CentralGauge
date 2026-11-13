#!/usr/bin/env bash
# W2-11 gates, one task per `gates` call so a stop or the RAM floor stops the batch between tasks.
# H-76: --lineage on every call. H-89: any active stop of jobs\W2-12\STOP-gates-<container> (stops.sh:
# the file itself or any STOP-gates-<container>.* except .cleared-*) stops the batch, e.g. hostwatch's
# host-all. H-89b (fail-safe, same checks as watch.sh): before each task the batch writes
# STOP-gates-<container>.watch and stops when the hostwatch heartbeat is stale (> 180 s), missing or
# in the future, when the gate prefix is not in the hostwatch registry, when the RAM read fails
# (PowerShell status, timeout, unparsed answer) or is under the floor, or when the comparison gives
# no clean verdict. The stops are checked again right before the task starts.
# usage: gates-on.sh <container> <lease-file> <rev> <task>...
# Test hooks: GATES_J (stop/log dir), GATES_HB, GATES_REG, GATES_QDIR, GATES_WORKDIR,
# GATES_TASK_CMD (runs instead of gate-task.ts, gets the task id), GATES_PS_TIMEOUT (default 45).
set -o pipefail
export LC_ALL=C
C=$1; LF=$2; REV=$3; shift 3
. "$(dirname "$0")/stops.sh"
J=${GATES_J:-/h/cg-coord/jobs/W2-12}
HB=${GATES_HB:-/h/cg-coord/jobs/W2-10/hostwatch/heartbeat}
HREG=${GATES_REG:-/h/cg-coord/jobs/W2-10/hostwatch/targets.tsv}
QD=${GATES_QDIR:-/h/cg-coord/harness-quarantine}
PST=${GATES_PS_TIMEOUT:-45}
LOG="$J/gates-$C.log"
STOPF="$J/STOP-gates-$C"
FLOOR=4
T=$(jq -r .token "$LF") || exit 3
# One batch per container (stops.sh lock).
lock_take "$J/gates-$C.lock" 2>> "$LOG" || { echo "gates-on: another batch holds $J/gates-$C.lock" >&2; exit 3; }
trap 'lock_release "$J/gates-$C.lock"' EXIT
cd "${GATES_WORKDIR:-/h/cg-coord/jobs/W2-05-gates}" || exit 3
echo "=== [$(date -u +%FT%TZ)] gates on $C rev $REV: $*" >> "$LOG"
halt() { # <reason>: write the batch's own named stop and log it
  stop_write "$STOPF" watch "$1"; [ $? = 2 ] && echo "[stop] $(date -u +%FT%TZ) could not write $STOPF.watch" >> "$LOG"
  echo "[stop] $(date -u +%FT%TZ) $1, not starting $2" >> "$LOG"
}
n=0
for t in "$@"; do
  s=$(active_stops "$STOPF" | tr '\n' ' ')
  [ -n "$s" ] && { echo "[stop] $(date -u +%FT%TZ) $s, not starting $t" >> "$LOG"; break; }
  r=$(hb_check "$HB"); [ -n "$r" ] && { halt "$r" "$t"; break; }
  reg_lists "$HREG" "$STOPF" || { halt "gate prefix $STOPF not listed in the hostwatch registry $HREG (or it cannot be read)" "$t"; break; }
  free=$(timeout -k 10 "$PST" powershell -NoProfile -Command "[string]::Format([cultureinfo]::InvariantCulture,'{0:F1}',(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB)" | tr -d '\r'); prc=$?
  [ $prc = 0 ] && [[ "$free" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { halt "RAM read failed (rc $prc, '$free')" "$t"; break; }
  v=$(awk -v f="$free" -v m="$FLOOR" 'BEGIN { print (f < m) ? "LOW" : "OK" }'); vrc=$?
  [ $vrc = 0 ] && [ "$v" = OK ] || { halt "free RAM $free GB, floor $FLOOR GB (verdict '${v:-none}', awk rc $vrc)" "$t"; break; }
  if jq -e --arg c "$C" 'select(.state=="quarantined" and .container==$c)' "$QD"/*.json > /dev/null 2>&1; then
    echo "[stop] $(date -u +%FT%TZ) $C quarantined, not starting $t" >> "$LOG"; break
  fi
  # Stops written, or the heartbeat going stale, while the checks above ran (the RAM read can take
  # up to 55 s) still count: both are checked again at the launch decision.
  s=$(active_stops "$STOPF" | tr '\n' ' ')
  [ -n "$s" ] && { echo "[stop] $(date -u +%FT%TZ) $s, not starting $t" >> "$LOG"; break; }
  r=$(hb_check "$HB"); [ -n "$r" ] && { halt "$r (at launch)" "$t"; break; }
  echo "--- [$(date -u +%FT%TZ)] $t (free ${free} GB)" >> "$LOG"
  if [ -n "${GATES_TASK_CMD:-}" ]; then
    "$GATES_TASK_CMD" "$t" >> "$LOG" 2>&1
  else
    DOCKER_CONTEXT=desktop-windows CG_LANE=ops deno run --allow-all scripts/harness/gate-task.ts gates "$t" \
      --containers "$C" --coord-lease "$C=$T" --rev "$REV" \
      --lineage 'infra\harness-reset\lineages\golden-o09-v2.json' >> "$LOG" 2>&1
  fi
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
