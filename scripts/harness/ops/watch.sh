#!/usr/bin/env bash
# Per-campaign watcher (H-89 version of jobs\W2-12\watch.sh). The memory tiers live in hostwatch.sh;
# this one writes only its own stop, P.watch (P = $WATCH_DIR/STOP, stops.sh), when:
#   - free RAM is under the 4 GB floor, or there has been no good RAM reading for more than 90 s
#     (PowerShell timeout, empty or unparsed answer);
#   - the hostwatch heartbeat is older than 180 s or missing (a dead hostwatch), or the hostwatch
#     registry does not list P or cannot be read (nothing would stop this campaign);
#   - every pool container is quarantined.
# It also logs cost every STEP executions and exits on the run log's exit line. One watcher per
# campaign: a second one for the same WATCH_DIR refuses (lock $WATCH_DIR/watch.lock).
# usage: WATCH_DIR=<campaign dir> watch.sh <experiment id> <run log> [pool containers]
# Test hooks: WATCH_HB, WATCH_REG (hostwatch heartbeat and registry), WATCH_RESULTS, WATCH_QDIR,
# WATCH_INTERVAL, WATCH_ITER (loops, 0 = until the exit line), WATCH_PS_TIMEOUT (default 45),
# WATCH_STALL (default 90).
export LC_ALL=C
EXP=$1; LOG=$2; POOL=${3:-Cronus281}
J=${WATCH_DIR:-/h/cg-coord/jobs/W2-12}  # holds the run's STOP prefix, watch.log and cost.log
P=$J/STOP
. "$(dirname "$0")/stops.sh"
R=${WATCH_RESULTS:-/h/cg-coord/jobs/M8-16a/results/harness}
QD=${WATCH_QDIR:-/h/cg-coord/harness-quarantine}
HB=${WATCH_HB:-/h/cg-coord/jobs/W2-10/hostwatch/heartbeat}
HREG=${WATCH_REG:-/h/cg-coord/jobs/W2-10/hostwatch/targets.tsv}
INTERVAL=${WATCH_INTERVAL:-60}; ITER=${WATCH_ITER:-0}; PST=${WATCH_PS_TIMEOUT:-45}
FLOOR=4; STALL=${WATCH_STALL:-90}; HB_MAX=180; STEP=5; next=$STEP
note() { echo "[watch] $(date -u +%FT%TZ) $*" | tee -a "$J/watch.log"; }
stop() { stop_write "$P" watch "$1" && note "$P.watch written ($1)"; }

lock_take "$J/watch.lock" 2>> "$J/watch.log" || { echo "watch.sh: another watcher holds $J/watch.lock" >&2; exit 3; }
trap 'lock_release "$J/watch.lock"' EXIT

cid() { for f in "$R"/campaigns/*.json; do [ "$(jq -r '.experiment.id' "$f")" = "$EXP" ] && jq -r .id "$f"; done 2> /dev/null | tail -1; }
since() { tail -n +"$(grep -n '^=== \[' "$LOG" | tail -1 | cut -d: -f1)" "$LOG"; }
cost() {
  cat "$R/executions/$1"/*.json 2>/dev/null | jq -s -c '
    def usd: .telemetry.cost_usd // ([.telemetry.raw_usage.modelUsage[]?.costUSD] | add) // 0;
    {n: length, spent: ((map(usd) | add // 0) * 100 | round / 100),
     by_arm: (group_by(.arm) | map({(.[0].arm): {n: length, usd: ((map(usd) | add) * 100 | round / 100)}}) | add),
     terminations: (group_by(.termination) | map({(.[0].termination): length}) | add)}'
}
registered() { # is P listed in the hostwatch registry (case-insensitive, slash form)?
  local i me; me=$(stop_path "$P"); parse_reg "$HREG" 2> /dev/null || return 1
  shopt -s nocasematch
  for i in "${TGT_P[@]}"; do [[ "$i" == "$me" ]] && { shopt -u nocasematch; return 0; }; done
  shopt -u nocasematch; return 1
}

last_good=$(date +%s); k=0
while true; do
  k=$((k + 1))
  free=$(timeout -k 10 "$PST" powershell -NoProfile -Command "[string]::Format([cultureinfo]::InvariantCulture,'{0:F1}',(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB)" | tr -d '\r')
  t=$(date +%s)  # after the read, so a hung read counts toward the stall age
  if [[ "$free" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    last_good=$t
    v=$(awk -v f="$free" -v m="$FLOOR" 'BEGIN { print (f < m) ? "LOW" : "OK" }')
    [ "$v" = OK ] || stop "free RAM $free GB, floor $FLOOR GB (verdict '${v:-none}')"
  else
    note "bad RAM reading '$free', $((t - last_good))s since the last good one"
    [ $((t - last_good)) -gt $STALL ] && stop "no good RAM reading for $((t - last_good))s"
  fi
  if [ -f "$HB" ]; then
    age=$((t - $(stat -c %Y "$HB" 2> /dev/null || echo 0)))
    [ $age -gt $HB_MAX ] && stop "hostwatch heartbeat ${age}s old ($HB)"
  else
    stop "hostwatch heartbeat missing ($HB)"
  fi
  registered || stop "not listed in the hostwatch registry $HREG (or it cannot be read)"
  # Standing grant 1: stop when every container of the pool is quarantined (cells after that only burn subscription).
  q=$(jq -r 'select(.state=="quarantined").container' "$QD"/*.json 2>/dev/null |
    sort -u | grep -cxF -f <(tr ' ' '\n' <<< "$POOL"))
  [ "$q" -eq "$(echo $POOL | wc -w)" ] && stop "every pool container quarantined ($POOL)"
  c=$(cid)
  if [ -n "$c" ]; then
    n=$(ls "$R/executions/$c"/*.json 2>/dev/null | wc -l)
    if [ "$n" -ge "$next" ]; then
      echo "[cost] $(date -u +%FT%TZ) $EXP $c free=${free}GB $(cost "$c")" | tee -a "$J/cost.log"
      next=$(( (n / STEP + 1) * STEP ))
    fi
  fi
  if [ -f "$LOG" ] && since | grep -q '^exit '; then
    [ -n "$c" ] && echo "[cost] $(date -u +%FT%TZ) final $EXP $c $(cost "$c") $(since | grep '^exit ')" | tee -a "$J/cost.log"
    exit 0
  fi
  [ "$ITER" -gt 0 ] && [ $k -ge "$ITER" ] && exit 0
  sleep "$INTERVAL"
done
