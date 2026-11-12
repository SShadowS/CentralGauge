#!/usr/bin/env bash
# H-89 dry test: hostwatch.sh and stops.sh against dummy targets in a temp dir, with fed readings
# (HW_FEED), so no real campaign, gate or STOP path is touched. usage: hostwatch-dry-test.sh [work dir]
# Exit 0 when every check passes.
H=$(cd "$(dirname "$0")" && pwd)
. "$H/stops.sh"
W=${1:-$(mktemp -d)}; command -v cygpath > /dev/null && W=$(cygpath -u "$W"); mkdir -p "$W"
pass=0; fail=0
check() { if eval "$2"; then pass=$((pass + 1)); echo "[OK]   $1"; else fail=$((fail + 1)); echo "[FAIL] $1"; fi; }

# A fresh case dir with three dummy targets: campaign A (priority 1), campaign B (2), gate pool G (1).
setup() {
  D=$W/$1; rm -rf "$D"; mkdir -p "$D/A" "$D/B" "$D/G"
  printf '# target priority\n%s 1\n%s 2\n%s 1\n' "$D/A/STOP" "$D/B/STOP" "$D/G/STOP-gates-Cronus999" > "$D/targets.tsv"
}
feed() { printf '%s\n' "$@" > "$D/feed"; HW_DIR=$D HW_REG=$D/targets.tsv HW_FEED=$D/feed HW_INTERVAL=0 HW_ITER=$# bash "$H/hostwatch.sh"; }
none() { [ -z "$(active_stops "$D/A/STOP")$(active_stops "$D/B/STOP")$(active_stops "$D/G/STOP-gates-Cronus999")" ]; }

setup normal; feed "30.0 25.0 7.00" "29.5 24.0 7.10" "30.1 26.0 7.05"
check "normal readings write no stop" none
check "normal readings are logged" "[ \$(grep -c 'commit_headroom=' $D/hostwatch.log) = 3 ]"

setup comma; feed "11,9 5,0 7,0" "30.0 25.0 7.00"
check "comma-decimal reading is skipped, no stop" none
check "comma-decimal reading is logged as unparsed" "grep -q \"unparsed '11,9 5,0 7,0'\" $D/hostwatch.log"

setup low-commit; feed "30.0 5.5 7.00"
check "commit 5.5 GB: host-low on lowest priority (A, G)" "[ -f $D/A/STOP.host-low ] && [ -f $D/G/STOP-gates-Cronus999.host-low ]"
check "commit 5.5 GB: higher priority B untouched" "[ -z \"\$(active_stops $D/B/STOP)\" ]"
check "commit 5.5 GB: no host-all" "[ ! -f $D/A/STOP.host-all ]"

setup low-free; feed "7.5 25.0 7.00"
check "free 7.5 GB: host-low on A and G only" "[ -f $D/A/STOP.host-low ] && [ -f $D/G/STOP-gates-Cronus999.host-low ] && [ ! -f $D/B/STOP.host-low ]"

setup all-commit; feed "30.0 2.5 7.00"
check "commit 2.5 GB: host-all reaches every target (A, B, G)" "[ -f $D/A/STOP.host-all ] && [ -f $D/B/STOP.host-all ] && [ -f $D/G/STOP-gates-Cronus999.host-all ]"

setup all-free; feed "3.5 25.0 7.00"
check "free 3.5 GB: host-all reaches every target" "[ -f $D/A/STOP.host-all ] && [ -f $D/B/STOP.host-all ] && [ -f $D/G/STOP-gates-Cronus999.host-all ]"

setup np-rise; feed "30.0 25.0 7.00" "30.0 25.0 7.60" "30.0 25.0 8.20" "30.0 25.0 8.60"
check "nonpaged 7.0 -> 8.6 GB: host-low" "[ -f $D/A/STOP.host-low ] && [ ! -f $D/B/STOP.host-low ]"
setup np-small; feed "30.0 25.0 7.00" "30.0 25.0 7.80" "30.0 25.0 8.40"
check "nonpaged 7.0 -> 8.4 GB (1.4 GB): no stop" none

setup stall-2; feed STALL STALL
check "2 stalled readings: host-low" "[ -f $D/A/STOP.host-low ] && [ ! -f $D/A/STOP.host-all ]"
setup stall-1; feed STALL "30.0 25.0 7.00" STALL
check "stalls not in a row: no stop" none
setup stall-5; feed STALL STALL STALL STALL STALL
check "5 stalled readings: host-all reaches every target" "[ -f $D/A/STOP.host-all ] && [ -f $D/B/STOP.host-all ] && [ -f $D/G/STOP-gates-Cronus999.host-all ]"

# A planned pause must not swallow an alert, and a resume chain must refuse after its own stop is gone.
setup planned; echo "planned pause" > "$D/A/STOP"; stop_write "$D/A/STOP" planned "add container"
feed "30.0 5.5 7.00"
check "planned stop present: host-low still written" "[ -f $D/A/STOP.host-low ]"
rm "$D/A/STOP" "$D/A/STOP.planned"
check "resume chain refuses: host-low still active after the planned stops are cleared" "[ -n \"\$(active_stops $D/A/STOP)\" ]"

setup archived; touch "$D/A/STOP.cleared-20261112T1312Z" "$D/A/STOP.false-20261111T1647Z"
check "archived (dated) stops are not active" "[ -z \"\$(active_stops $D/A/STOP)\" ]"
touch "$D/A/STOP.watch"
check "a named stop is active" "[ \"\$(active_stops $D/A/STOP)\" = $D/A/STOP.watch ]"

mapfile -t S < <(stop_args 'X\STOP')
check "stop_args gives the run one --stop-file per active name" "[ \"\${S[*]}\" = '--stop-file X\STOP --stop-file X\STOP.watch --stop-file X\STOP.host-low --stop-file X\STOP.host-all --stop-file X\STOP.planned' ]"

setup repeat; feed "30.0 5.5 7.00" "30.0 5.4 7.00"
check "a stop is written once, one ALERT" "[ \$(grep -c ALERT $D/hostwatch.log) = 2 ]"

# Single instance: a second hostwatch refuses while the first runs; STOP-hostwatch ends the first.
setup single; printf '30.0 25.0 7.00\n%.0s' $(seq 1 600) > "$D/feed"
HW_DIR=$D HW_REG=$D/targets.tsv HW_FEED=$D/feed HW_INTERVAL=1 bash "$H/hostwatch.sh" &
first=$!; i=0; until [ -f "$D/lock/pid" ] || [ $i -gt 50 ]; do sleep 0.1; i=$((i + 1)); done
HW_DIR=$D HW_REG=$D/targets.tsv HW_FEED=$D/feed HW_INTERVAL=1 HW_ITER=1 bash "$H/hostwatch.sh" > "$D/second.out"; rc=$?
check "second instance refuses (exit 3)" "[ $rc = 3 ] && grep -q 'already runs' $D/second.out"
touch "$D/STOP-hostwatch"; wait $first
check "STOP-hostwatch ends the watcher and frees the lock" "[ ! -d $D/lock ]"

echo "dry test: $pass passed, $fail failed (work dir $W)"
[ $fail = 0 ]
