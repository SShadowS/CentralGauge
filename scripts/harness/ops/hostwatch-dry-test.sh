#!/usr/bin/env bash
# H-89 dry test: hostwatch.sh, watch.sh and stops.sh against dummy targets in a scratch dir, with fed
# readings (HW_FEED), a fake clock (HW_STEP) and fake powershell/awk on PATH where a case needs them.
# No real campaign, gate, registry or STOP path is touched. usage: hostwatch-dry-test.sh [work dir]
# Exit 0 when every check passes.
H=$(cd "$(dirname "$0")" && pwd)
. "$H/stops.sh"
W=${1:-$(mktemp -d)}; command -v cygpath > /dev/null && W=$(cygpath -u "$W"); mkdir -p "$W"
pass=0; fail=0
check() { local d=$1; shift; if "$@"; then pass=$((pass + 1)); echo "[OK]   $d"; else fail=$((fail + 1)); echo "[FAIL] $d"; fi; }
has() { local f; for f; do [ -f "$f" ] || return 1; done; }
hasnt() { local f; for f; do [ ! -e "$f" ] || return 1; done; }
active() { [ -n "$(active_stops "$1")" ]; }
inactive() { [ -z "$(active_stops "$1")" ]; }
logged() { grep -q -- "$2" "$1" 2> /dev/null; }
eq() { [ "$1" = "$2" ]; }
none() { inactive "$D/A/STOP" && inactive "$D/B/STOP" && inactive "$D/G/STOP-gates-Cronus999"; }

# Fake tools: powershell answering "30.0" (watch.sh RAM read), a hanging powershell, a failing awk.
mkdir -p "$W/bin-ok" "$W/bin-hang" "$W/bin-awkfail"
printf '#!/usr/bin/env bash\necho 30.0\n' > "$W/bin-ok/powershell"
printf '#!/usr/bin/env bash\nsleep 600\n' > "$W/bin-hang/powershell"
printf '#!/usr/bin/env bash\nexit 2\n' > "$W/bin-awkfail/awk"
chmod +x "$W"/bin-*/*

# A fresh case dir with three dummy targets: campaign A (priority 1), campaign B (2), gate pool G (1).
setup() {
  D=$W/$1; rm -rf "$D"; mkdir -p "$D/A" "$D/B" "$D/G"
  printf '# target priority\n%s 1\n%s 2\n%s 1\n' "$D/A/STOP" "$D/B/STOP" "$D/G/STOP-gates-Cronus999" > "$D/targets.tsv"
}
hw() { HW_DIR=$D HW_REG=${REG:-$D/targets.tsv} HW_FEED=$D/feed HW_INTERVAL=${IV:-0} HW_STEP=${STEP:-60} bash "$H/hostwatch.sh"; }
feed() { printf '%s\n' "$@" > "$D/feed"; HW_ITER=$# hw > "$D/out" 2>&1; }

echo "== thresholds"
setup normal; feed "30.0 25.0 7.00" "29.5 24.0 7.10" "30.1 26.0 7.05"
check "normal readings write no stop" none
check "normal readings are logged with a verdict" eq "$(grep -c 'verdict=OK' "$D/hostwatch.log")" 3
check "hostwatch refreshes its heartbeat" has "$D/heartbeat"
setup low-commit; feed "30.0 5.5 7.00"
check "commit 5.5 GB: host-low on lowest priority (A, G)" has "$D/A/STOP.host-low" "$D/G/STOP-gates-Cronus999.host-low"
check "commit 5.5 GB: B (priority 2) untouched, no host-all" inactive "$D/B/STOP"
check "commit 5.5 GB: no host-all" hasnt "$D/A/STOP.host-all"
setup low-free; feed "7.5 25.0 7.00"
check "free 7.5 GB: host-low on A and G only" has "$D/A/STOP.host-low" "$D/G/STOP-gates-Cronus999.host-low"
check "free 7.5 GB: not on B" hasnt "$D/B/STOP.host-low"
setup all-commit; feed "30.0 2.5 7.00"
check "commit 2.5 GB: host-all reaches every target" has "$D/A/STOP.host-all" "$D/B/STOP.host-all" "$D/G/STOP-gates-Cronus999.host-all"
setup all-free; feed "3.5 25.0 7.00"
check "free 3.5 GB: host-all reaches every target" has "$D/A/STOP.host-all" "$D/B/STOP.host-all" "$D/G/STOP-gates-Cronus999.host-all"
setup np-rise; feed "30.0 25.0 7.00" "30.0 25.0 7.60" "30.0 25.0 8.20" "30.0 25.0 8.60"
check "nonpaged 7.0 -> 8.6 GB: host-low" has "$D/A/STOP.host-low"
setup np-small; feed "30.0 25.0 7.00" "30.0 25.0 7.80" "30.0 25.0 8.40"
check "nonpaged 7.0 -> 8.4 GB (1.4 GB): no stop" none
setup repeat; feed "30.0 5.5 7.00" "30.0 5.4 7.00"
check "a stop is written once: 2 ALERTs (A, G), not 4" eq "$(grep -c ALERT "$D/hostwatch.log")" 2

echo "== bad readings are stalls, timed from the last good reading (fake clock 60 s per reading)"
setup comma; feed "11,9 5,0 7,0" "30.0 25.0 7.00"
check "one comma-decimal reading (60 s): logged as bad, no stop" logged "$D/hostwatch.log" "bad reading (rc 0, '11,9 5,0 7,0')"
check "one comma-decimal reading (60 s): no stop" none
setup unparsed-stall; feed "11,9 5,0 7,0" "garbage"
check "2 unparsed readings (120 s > 90 s): host-low" has "$D/A/STOP.host-low"
setup stall-low; feed STALL STALL
check "no answer for 120 s (> 90 s): host-low, not host-all" has "$D/A/STOP.host-low"
check "no answer for 120 s: no host-all" hasnt "$D/A/STOP.host-all"
setup stall-180; feed STALL STALL STALL
check "no answer for exactly 180 s: still host-low only" hasnt "$D/A/STOP.host-all"
setup stall-all; feed STALL STALL STALL STALL
check "no answer for 240 s (> 180 s): host-all reaches every target" has "$D/A/STOP.host-all" "$D/B/STOP.host-all" "$D/G/STOP-gates-Cronus999.host-all"
setup stall-reset; feed STALL "30.0 25.0 7.00" STALL
check "a good reading resets the stall clock: no stop" none

echo "== fail-safe comparisons"
setup awk-fail; printf '30.0 25.0 7.00\n' > "$D/feed"
PATH="$W/bin-awkfail:$PATH" HW_ITER=1 hw > "$D/out" 2>&1
check "awk fails on a normal reading: host-low (no clean verdict)" has "$D/A/STOP.host-low"
check "awk failure is logged" logged "$D/hostwatch.log" "no clean verdict"

echo "== registry"
for c in missing empty comments nonnumeric nopriority; do
  setup "reg-$c"; printf '30.0 25.0 7.00\n' > "$D/feed"
  case $c in
    missing) rm "$D/targets.tsv" ;;
    empty) : > "$D/targets.tsv" ;;
    comments) printf '# none\n   # indented\n\n' > "$D/targets.tsv" ;;
    nonnumeric) printf '%s 1\n%s bogus\n' "$D/A/STOP" "$D/B/STOP" > "$D/targets.tsv" ;;
    nopriority) printf '%s\n' "$D/A/STOP" > "$D/targets.tsv" ;;
  esac
  HW_ITER=1 hw > "$D/out" 2>&1; rc=$?
  check "registry $c: refuses to start (exit 2, loud)" eq "$rc $(grep -c 'refuses to start' "$D/out")" "2 1"
  check "registry $c: wrote no heartbeat" hasnt "$D/heartbeat"
done
setup reg-forms
printf '  # indented comment\r\n%s 1\r\n\t%s   2' "$D/A dir/STOP" "$D/B/STOP" > "$D/targets.tsv"; mkdir -p "$D/A dir"
printf '30.0 2.5 7.00\n' > "$D/feed"; HW_ITER=1 hw > "$D/out" 2>&1
check "indented comment, CRLF, tab, spaces in a prefix, no final newline: all targets hit" has "$D/A dir/STOP.host-all" "$D/B/STOP.host-all"
setup reg-midrun; printf '%s\n' "30.0 25.0 7.00" "30.0 25.0 7.00" "30.0 5.5 7.00" > "$D/feed"
HW_ITER=3 IV=2 hw > "$D/out" 2>&1 &
pid=$!; i=0; until [ -f "$D/heartbeat" ] || [ $i -gt 100 ]; do sleep 0.1; i=$((i + 1)); done
printf 'garbage\n' > "$D/targets.tsv"; wait $pid
check "registry turns malformed while running: ALERT logged" logged "$D/hostwatch.log" "ALERT registry malformed, keeping the last good copy"
check "registry turns malformed while running: the last good copy still gets the stop" has "$D/A/STOP.host-low" "$D/G/STOP-gates-Cronus999.host-low"

echo "== lock"
setup lock-live; printf '30.0 25.0 7.00\n%.0s' $(seq 1 600) > "$D/feed"
HW_INTERVAL=1 HW_DIR=$D HW_REG=$D/targets.tsv HW_FEED=$D/feed bash "$H/hostwatch.sh" > /dev/null 2>&1 &
first=$!; i=0; until [ -s "$D/lock/owner" ] || [ $i -gt 100 ]; do sleep 0.1; i=$((i + 1)); done
HW_ITER=1 hw > "$D/out" 2>&1; rc=$?
check "second instance refuses while the first is alive (exit 3)" eq "$rc $(grep -c 'already runs' "$D/out")" "3 1"
touch "$D/STOP-hostwatch"; wait $first
check "STOP-hostwatch: host-low written to the lowest-priority targets first" has "$D/A/STOP.host-low" "$D/G/STOP-gates-Cronus999.host-low"
check "STOP-hostwatch: watcher exits and frees its lock" hasnt "$D/lock"
setup lock-noowner; mkdir "$D/lock"; printf '30.0 25.0 7.00\n' > "$D/feed"
HW_ITER=1 hw > "$D/out" 2>&1; rc=$?
check "lock without an owner file is not taken over (exit 3, after 10 s)" eq "$rc $(grep -c 'no owner after 10 s' "$D/hostwatch.log")" "3 1"
check "lock without an owner file: the lock is left alone" [ -d "$D/lock" ]
check "lock without an owner file: no monitoring started" hasnt "$D/heartbeat"
setup lock-dead; mkdir "$D/lock"; echo "999999 1" > "$D/lock/owner"; printf '30.0 25.0 7.00\n' > "$D/feed"
HW_ITER=1 hw > "$D/out" 2>&1; rc=$?
check "lock of a dead pid is taken over" eq "$rc $(grep -c 'took over from dead owner' "$D/hostwatch.log")" "0 1"
setup lock-reused; mkdir "$D/lock"; echo "$$ 1" > "$D/lock/owner"; printf '30.0 25.0 7.00\n' > "$D/feed"
HW_ITER=1 hw > "$D/out" 2>&1; rc=$?
check "lock of a live pid with another start time (reused pid) is taken over" eq "$rc $(grep -c 'took over from dead owner' "$D/hostwatch.log")" "0 1"

echo "== watch.sh (fake powershell, empty results and quarantine dirs)"
wsetup() {
  setup "$1"; mkdir -p "$D/res/campaigns" "$D/q"; echo "=== [test]" > "$D/run.log"
  date -u +%FT%TZ > "$D/heartbeat"
}
w() { WATCH_DIR=$D/A WATCH_HB=$D/heartbeat WATCH_REG=$D/targets.tsv WATCH_RESULTS=$D/res WATCH_QDIR=$D/q \
  WATCH_ITER=${WI:-1} WATCH_INTERVAL=0 bash "$H/watch.sh" dummy "$D/run.log" Cronus999 > "$D/wout" 2>&1; }
wsetup w-fresh; PATH="$W/bin-ok:$PATH" w
check "fresh heartbeat, registered, RAM fine: no P.watch" hasnt "$D/A/STOP.watch"
wsetup w-stale; touch -d '-200 seconds' "$D/heartbeat"; PATH="$W/bin-ok:$PATH" w
check "dead hostwatch (heartbeat 200 s old): P.watch within one loop" has "$D/A/STOP.watch"
check "dead hostwatch: reason logged" logged "$D/A/watch.log" "heartbeat 2[0-9][0-9]s old"
wsetup w-missing; rm "$D/heartbeat"; PATH="$W/bin-ok:$PATH" w
check "heartbeat missing while the registry lists P: P.watch" has "$D/A/STOP.watch"
wsetup w-unlisted; printf '%s 2\n' "$D/B/STOP" > "$D/targets.tsv"; PATH="$W/bin-ok:$PATH" w
check "P not in the hostwatch registry: P.watch" has "$D/A/STOP.watch"
wsetup w-hang; s=$(date +%s); PATH="$W/bin-hang:$PATH" WATCH_PS_TIMEOUT=2 WATCH_STALL=1 w; e=$(( $(date +%s) - s ))
check "hanging powershell is cut by the timeout (loop took ${e}s < 20 s)" [ $e -lt 20 ]
check "hanging powershell: counted as a stall, P.watch written" has "$D/A/STOP.watch"
wsetup w-single; PATH="$W/bin-ok:$PATH" WI=0 WATCH_INTERVAL=1 WATCH_DIR=$D/A WATCH_HB=$D/heartbeat WATCH_REG=$D/targets.tsv \
  WATCH_RESULTS=$D/res WATCH_QDIR=$D/q bash "$H/watch.sh" dummy "$D/run.log" Cronus999 > /dev/null 2>&1 &
first=$!; i=0; until [ -s "$D/A/watch.lock/owner" ] || [ $i -gt 100 ]; do sleep 0.1; i=$((i + 1)); done
PATH="$W/bin-ok:$PATH" w; rc=$?
check "second watch.sh for the same campaign refuses (exit 3)" eq "$rc" 3
echo "exit 0" >> "$D/run.log"; wait $first
check "watch.sh exits on the run's exit line and frees its lock" hasnt "$D/A/watch.lock"

echo "== stops.sh"
setup names
touch "$D/A/STOP.foo"
check "unknown P.foo is active: a resume chain refuses" active "$D/A/STOP"
rm "$D/A/STOP.foo"; touch "$D/A/STOP.cleared-20261112T1312Z" "$D/A/STOP.CLEARED-20261111T0000Z"
check "archived P.cleared-* (any case) are not active" inactive "$D/A/STOP"
touch "$D/A/STOP.WATCH"
check "case-insensitive: STOP.WATCH is active" active "$D/A/STOP"
check "Windows backslash prefix finds the same stop" active "$(cygpath -w "$D/A/STOP")"
rm "$D/A/STOP.WATCH"; touch "$D/A/STOP.false-20261111T1647Z"
check "any other suffix (legacy .false-*) is active until archived as .cleared-*" active "$D/A/STOP"
rm "$D/A/STOP.false-20261111T1647Z"
setup planned; echo "planned pause" > "$D/A/STOP"; stop_write "$D/A/STOP" planned "add container"
feed "30.0 5.5 7.00"
check "planned stop present: host-low still written" has "$D/A/STOP.host-low"
mv "$D/A/STOP" "$D/A/STOP.cleared-1"; mv "$D/A/STOP.planned" "$D/A/STOP.cleared-2"
check "resume chain refuses: host-low still active after the planned stops are archived" active "$D/A/STOP"
mapfile -t S < <(stop_args 'X\STOP')
check "stop_args gives the run one --stop-file per writer name" eq "${S[*]}" '--stop-file X\STOP --stop-file X\STOP.watch --stop-file X\STOP.host-low --stop-file X\STOP.host-all --stop-file X\STOP.planned'
setup race; ok=0
for i in $(seq 1 8); do (stop_write "$D/A/STOP" host-low "writer $i" && echo won >> "$D/won") & done; wait
check "8 concurrent stop_write calls: exactly one creates the file" eq "$(wc -l < "$D/won")" 1

echo "== real PowerShell timeout boundary (no CIM, Start-Sleep only)"
s=$(date +%s); timeout -k 5 3 powershell -NoProfile -Command 'Start-Sleep 120' > /dev/null 2>&1; rc=$?; e=$(( $(date +%s) - s ))
check "timeout -k 5 3 powershell Start-Sleep 120: rc 124 within 15 s (rc $rc, ${e}s)" [ $rc = 124 -a $e -lt 15 ]

echo "dry test: $pass passed, $fail failed (work dir $W)"
[ $fail = 0 ]
