#!/usr/bin/env bash
# Per-campaign watcher (H-89 version of jobs\W2-12\watch.sh). Memory tiers moved to hostwatch.sh;
# this one keeps (1) the RAM floor as a last line, (2) a stop when every pool container is
# quarantined, (3) cost logging every STEP executions. It writes only its own stop, <P>.watch
# (stops.sh), so it never skips because another stop exists. Exits on the run log's exit line.
# usage: WATCH_DIR=<campaign dir> watch.sh <experiment id> <run log> [pool containers]
EXP=$1; LOG=$2; POOL=${3:-Cronus281}
J=${WATCH_DIR:-/h/cg-coord/jobs/W2-12}  # holds the run's STOP prefix, watch.log and cost.log
P=$J/STOP
. "$(dirname "$0")/stops.sh"
R='/h/cg-coord/jobs/M8-16a/results/harness'
FLOOR=4; STEP=5; next=$STEP
cid() { for f in "$R"/campaigns/*.json; do [ "$(jq -r '.experiment.id' "$f")" = "$EXP" ] && jq -r .id "$f"; done | tail -1; }
since() { tail -n +"$(grep -n '^=== \[' "$LOG" | tail -1 | cut -d: -f1)" "$LOG"; }
cost() {
  cat "$R/executions/$1"/*.json 2>/dev/null | jq -s -c '
    def usd: .telemetry.cost_usd // ([.telemetry.raw_usage.modelUsage[]?.costUSD] | add) // 0;
    {n: length, spent: ((map(usd) | add // 0) * 100 | round / 100),
     by_arm: (group_by(.arm) | map({(.[0].arm): {n: length, usd: ((map(usd) | add) * 100 | round / 100)}}) | add),
     terminations: (group_by(.termination) | map({(.[0].termination): length}) | add)}'
}
while true; do
  free=$(powershell -NoProfile -Command "[string]::Format([cultureinfo]::InvariantCulture,'{0:F1}',(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB)" | tr -d '\r')
  if [[ "$free" =~ ^[0-9]+(\.[0-9]+)?$ ]] && awk -v f="$free" -v m="$FLOOR" 'BEGIN { exit !(f < m) }'; then
    stop_write "$P" watch "RAM floor: free $free GB < $FLOOR GB" &&
      echo "[watch] $(date -u +%FT%TZ) $P.watch written (free RAM $free GB)" | tee -a "$J/watch.log"
  fi
  # Standing grant 1: stop when every container of the pool is quarantined (cells after that only burn subscription).
  q=$(jq -r 'select(.state=="quarantined").container' /h/cg-coord/harness-quarantine/*.json 2>/dev/null |
    sort -u | grep -cxF -f <(tr ' ' '\n' <<< "$POOL"))
  if [ "$q" -eq "$(echo $POOL | wc -w)" ]; then
    stop_write "$P" watch "every pool container quarantined ($POOL)" &&
      echo "[watch] $(date -u +%FT%TZ) $P.watch written (every pool container quarantined: $POOL)" | tee -a "$J/watch.log"
  fi
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
  sleep 60
done
