#!/usr/bin/env bash
# H-89 dry test: hostwatch.sh, watch.sh and stops.sh against dummy targets in a scratch dir, with fed
# readings (HW_FEED), a fake clock (HW_STEP) and fake powershell/awk on PATH where a case needs them.
# No real campaign, gate, registry or STOP path is touched. usage: hostwatch-dry-test.sh [work dir]
# Exit 0 when every check passes.
H=$(cd "$(dirname "$0")" && pwd); command -v cygpath > /dev/null && H=$(cygpath -u "$H")
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
mkdir -p "$W/bin-ok" "$W/bin-hang" "$W/bin-awkfail" "$W/bin-numhang" "$W/bin-datejump"
printf '#!/usr/bin/env bash\necho 30.0\n' > "$W/bin-ok/powershell"
printf '#!/usr/bin/env bash\nsleep 600\n' > "$W/bin-hang/powershell"
printf '#!/usr/bin/env bash\nexit 2\n' > "$W/bin-awkfail/awk"
# H-89b: numeric answer, then a hang (timeout rc 124 with numeric stdout); a wall clock that jumps
# back 1000 s on every `date +%s` call (other date calls pass through).
printf '#!/usr/bin/env bash\necho 30.0\nsleep 600\n' > "$W/bin-numhang/powershell"
# Self-check r1: an awk that prints OK and then fails; a powershell that answers after 3 s.
mkdir -p "$W/bin-awkok" "$W/bin-slow"
printf '#!/usr/bin/env bash\necho OK\nexit 2\n' > "$W/bin-awkok/awk"
printf '#!/usr/bin/env bash\nsleep 3\necho 30.0\n' > "$W/bin-slow/powershell"
printf '#!/usr/bin/env bash\nif [ "$1" = +%%s ]; then f=%s/datejump.n; n=$(cat "$f" 2>/dev/null || echo 0); echo $((n+1)) > "$f"; echo $((2000000000 - n * 1000)); else exec /usr/bin/date "$@"; fi\n' "$W" > "$W/bin-datejump/date"
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

echo "== H-89b item 2: time, not count (feed steps of 30 s and 90 s tell them apart)"
setup step30-3; STEP=30 feed STALL STALL STALL
check "30 s steps, 3 stalls = 90 s (not > 90): no stop (counting would have stopped at 2)" none
setup step30-4; STEP=30 feed STALL STALL STALL STALL
check "30 s steps, 4 stalls = 120 s: host-low" has "$D/A/STOP.host-low"
check "30 s steps, 4 stalls = 120 s: not host-all" hasnt "$D/A/STOP.host-all"
setup step90-2; STEP=90 feed STALL STALL
check "90 s steps, 2 stalls = 180 s (not > 180): host-low present" has "$D/A/STOP.host-low"
check "90 s steps, 2 stalls = 180 s: no host-all" hasnt "$D/A/STOP.host-all"
setup step90-3; STEP=90 feed STALL STALL STALL
check "90 s steps, 3 stalls = 270 s: host-all (counting needed 5)" has "$D/A/STOP.host-all" "$D/B/STOP.host-all"

echo "== H-89b item 2: a backward wall-clock jump cannot hide a stall (real monotonic clock, fake date)"
setup clockjump; printf 'STALL\n%.0s' 1 2 3 4 > "$D/feed"
PATH="$W/bin-datejump:$PATH" HW_DIR=$D HW_REG=$D/targets.tsv HW_FEED=$D/feed HW_INTERVAL=1 HW_ITER=4 \
  HW_STALL_LOW=2 HW_STALL_ALL=100 bash "$H/hostwatch.sh" > "$D/out" 2>&1
check "wall clock jumping back 1000 s per call, 4 stalls 1 s apart: host-low still written" has "$D/A/STOP.host-low"
setup hb-future; date -u > "$D/heartbeat"; touch -d '+10 minutes' "$D/heartbeat"
check "a heartbeat 10 min in the future (clock moved back) is unsafe" [ -n "$(hb_check "$D/heartbeat")" ]
date -u > "$D/heartbeat"
check "a fresh heartbeat is safe" [ -z "$(hb_check "$D/heartbeat")" ]

echo "== H-89b item 3: lock takeover"
setup lock-race; mkdir "$D/lock"; echo "999999 1" > "$D/lock/owner"
printf '#!/usr/bin/env bash\n. "%s/stops.sh"\nlock_take "%s/lock" 2>> "%s/race.err" && { echo "won $$" >> "%s/won"; sleep 4; lock_release "%s/lock"; }\n' "$H" "$D" "$D" "$D" "$D" > "$D/taker.sh"
for i in 1 2 3 4; do bash "$D/taker.sh" & done; wait
check "4 separate processes take one dead owner's lock: exactly one owner" eq "$(wc -l < "$D/won" 2> /dev/null)" 1
check "takeover ticket released afterwards" hasnt "$D/lock.takeover"
setup lock-ticket; mkdir "$D/lock" "$D/lock.takeover"; echo "999999 1" > "$D/lock/owner"
(. "$H/stops.sh"; lock_take "$D/lock" 2> "$D/t.err"); rc=$?
check "a stale takeover ticket blocks takeover visibly (exit 3, lock untouched)" eq "$rc $(cat "$D/lock/owner")" "3 999999 1"
check "proc_state of a missing pid is dead" eq "$(proc_state 999999 1)" dead
check "proc_state of this shell with its own start time is live" eq "$(proc_state $$ "$(proc_start $$)")" live

echo "== H-89b item 4: a failed stop write is retried, logged and escalated"
setup write-fail; printf '%s 1\n%s 2\n' "$D/gone/STOP" "$D/B/STOP" > "$D/targets.tsv"
feed "30.0 5.5 7.00"
check "target dir missing: ALERT 'stop write FAILED twice' logged" logged "$D/hostwatch.log" "stop write FAILED twice"
check "the failed host-low goes to every other target too (B, priority 2)" has "$D/B/STOP.host-low"
setup write-fail-all; printf '%s 1\n%s 2\n' "$D/gone/STOP" "$D/gone2/STOP" > "$D/targets.tsv"
feed "30.0 5.5 7.00"
check "escalated write also fails: ALERT 'escalated stop write FAILED twice'" logged "$D/hostwatch.log" "escalated stop write FAILED twice"
check "a stop that could not be delivered anywhere: heartbeat not refreshed" hasnt "$D/heartbeat"

echo "== self-check r1: clock going backwards, awk OK-then-fail, priorities"
setup clock-back; printf '%s\n' 100 50 > "$D/now"; printf 'STALL\nSTALL\n' > "$D/feed"
HW_DIR=$D HW_REG=$D/targets.tsv HW_FEED=$D/feed HW_NOW_FEED=$D/now HW_INTERVAL=0 HW_ITER=2 bash "$H/hostwatch.sh" > "$D/out" 2>&1
check "stall clock goes back (100 -> 50) during a stall: host-low" has "$D/A/STOP.host-low"
setup clock-partial-back; printf '%s\n' 100 180 150 > "$D/now"; printf '30.0 25.0 7.00\nSTALL\nSTALL\n' > "$D/feed"
HW_DIR=$D HW_REG=$D/targets.tsv HW_FEED=$D/feed HW_NOW_FEED=$D/now HW_MIN_STEP=60 HW_INTERVAL=0 HW_ITER=3 bash "$H/hostwatch.sh" > "$D/out" 2>&1
check "clock steps back but stays above last_good (100, 180, 150): the bad-reading floor (2 x 60 s) still gives host-low" has "$D/A/STOP.host-low"
setup awk-okfail; printf '30.0 25.0 7.00\n' > "$D/feed"
PATH="$W/bin-awkok:$PATH" HW_ITER=1 hw > "$D/out" 2>&1
check "hostwatch: awk prints OK then exits 2: host-low" has "$D/A/STOP.host-low"
setup prio-big; printf '%s 1000000\n%s 0000001\n' "$D/B/STOP" "$D/A/STOP" > "$D/targets.tsv"; printf '30.0 5.5 7.00\n' > "$D/feed"
HW_ITER=1 hw > "$D/out" 2>&1; rc=$?
check "priorities 1000000 and 0000001 are accepted (exit 0)" eq "$rc" 0
check "0000001 is the lowest priority: A gets host-low, B does not" eq "$(test -f "$D/A/STOP.host-low" && echo A)$(test -f "$D/B/STOP.host-low" && echo B)" A

echo "== H-89b item 5: active_stops is fail-safe"
check "missing stops directory: reported as active (unknown)" active "$W/no-such-dir/STOP"
setup newname; touch "$D/A/STOP.emergency_2"
check "unknown P.emergency_2 (digits, underscore: the old regex missed it) is active" active "$D/A/STOP"

echo "== H-89b item 7: a real resume chain refuses"
setup chain
printf '#!/usr/bin/env bash\n. "%s/stops.sh"\ns=$(active_stops "$1")\n[ -z "$s" ] || { echo "refused: $s"; exit 3; }\ntouch "$2"\n' "$H" > "$D/chain.sh"
touch "$D/A/STOP.host-low"; bash "$D/chain.sh" "$D/A/STOP" "$D/started" > "$D/chain.out"; rc=$?
check "chain refuses while STOP.host-low is active (exit 3, nothing started)" eq "$rc $(test -e "$D/started" && echo started || echo no)" "3 no"
mv "$D/A/STOP.host-low" "$D/A/STOP.cleared-20261113T0900Z"; bash "$D/chain.sh" "$D/A/STOP" "$D/started" > "$D/chain.out"; rc=$?
check "chain starts once the stop is archived (exit 0, started)" eq "$rc $(test -e "$D/started" && echo started || echo no)" "0 started"

echo "== H-89b item 1: gates-on.sh fail-safe (fake powershell, fake gate task, dummy dirs)"
gsetup() {
  setup "$1"; mkdir -p "$D/q" "$D/wd"; echo '{"token":"dummy"}' > "$D/lease.json"
  printf '%s 1\n' "$D/G/STOP-gates-Cronus999" > "$D/targets.tsv"; date -u > "$D/heartbeat"
  printf '#!/usr/bin/env bash\necho "ran $1" >> %s/ran\n' "$D" > "$D/task.sh"; chmod +x "$D/task.sh"
}
g() { GATES_J=$D/G GATES_HB=$D/heartbeat GATES_REG=$D/targets.tsv GATES_QDIR=$D/q GATES_WORKDIR=$D/wd \
  GATES_TASK_CMD=$D/task.sh GATES_PS_TIMEOUT=${PT:-45} bash "$H/gates-on.sh" Cronus999 "$D/lease.json" deadbeef HX-T1 > "$D/gout" 2>&1; }
gsetup g-ok; PATH="$W/bin-ok:$PATH" g
check "gates: fresh heartbeat, registered, RAM fine: the task runs" eq "$(cat "$D/ran" 2> /dev/null)" "ran HX-T1"
gsetup g-stale; touch -d '-200 seconds' "$D/heartbeat"; PATH="$W/bin-ok:$PATH" g
check "gates: heartbeat 200 s old: STOP-gates.watch, task not run" has "$D/G/STOP-gates-Cronus999.watch"
check "gates: heartbeat 200 s old: task not run" hasnt "$D/ran"
gsetup g-nohb; rm "$D/heartbeat"; PATH="$W/bin-ok:$PATH" g
check "gates: heartbeat missing: STOP-gates.watch, task not run" has "$D/G/STOP-gates-Cronus999.watch"
gsetup g-unlisted; printf '%s 1\n' "$D/A/STOP" > "$D/targets.tsv"; PATH="$W/bin-ok:$PATH" g
check "gates: prefix not in the registry: STOP-gates.watch, task not run" has "$D/G/STOP-gates-Cronus999.watch"
check "gates: prefix not in the registry: task not run" hasnt "$D/ran"
gsetup g-awk; PATH="$W/bin-awkfail:$W/bin-ok:$PATH" g
check "gates: awk fails on a valid reading: STOP-gates.watch, task not run" has "$D/G/STOP-gates-Cronus999.watch"
check "gates: awk fails: task not run" hasnt "$D/ran"
gsetup g-numhang; PATH="$W/bin-numhang:$PATH" PT=2 g
check "gates: numeric answer then timeout (rc 124): STOP-gates.watch, task not run" has "$D/G/STOP-gates-Cronus999.watch"
gsetup g-stop; touch "$D/G/STOP-gates-Cronus999.host-all"; PATH="$W/bin-ok:$PATH" g
check "gates: an active host-all stop: task not run" hasnt "$D/ran"
gsetup g-awkok; PATH="$W/bin-awkok:$W/bin-ok:$PATH" g
check "gates: awk prints OK then exits 2: STOP-gates.watch, task not run" has "$D/G/STOP-gates-Cronus999.watch"
check "gates: awk prints OK then exits 2: task not run" hasnt "$D/ran"
gsetup g-hblaunch; touch -d '-179 seconds' "$D/heartbeat"; PATH="$W/bin-slow:$PATH" g
check "gates: heartbeat 179 s old at the first check, stale after a 3 s RAM read: halted at launch" logged "$D/G/gates-Cronus999.log" "(at launch)"
check "gates: stale at launch: task not run" hasnt "$D/ran"

echo "dry test: $pass passed, $fail failed (work dir $W)"
[ $fail = 0 ]
