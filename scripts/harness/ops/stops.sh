# Named STOP files and watcher locks (H-89). Source this file; it defines no commands of its own.
#
# A stop target is a path prefix P: a campaign's stop file (tasks\<id>\STOP) or a gate pool's
# (jobs\W2-12\STOP-gates-<container>). Windows (backslash) prefixes are accepted everywhere.
#
# Active stops: P itself and every P.<anything>, compared case-insensitively (NTFS), except the
# archive form P.cleared-<UTC stamp>. To clear a stop, rename it to P.cleared-<stamp>; never delete
# it. A resume chain refuses unless stops_clear P succeeds (active_stops printed exactly CLEAR), so
# an unknown P.foo, an unreadable directory or a failed fork also blocks a resume.
#
# Writers use only the fixed names below, which are exactly what stop_args hands a running harness
# run (one --stop-file each). A P.<other> written by hand does not stop a run that is already
# going; it only blocks resumes.
#   watch     per-campaign watcher (watch.sh): RAM floor, no good reading for 90 s, hostwatch
#             heartbeat stale or missing, pool quarantined
#   host-low  hostwatch.sh, lowest-priority targets
#   host-all  hostwatch.sh, every target
#   planned   a planned pause (a chain that pauses a run on purpose)
STOP_NAMES=(watch host-low host-all planned)

# MSYS slash form of a path (Windows backslash paths included).
stop_path() {
  case "$1" in *\\*) cygpath -u "$1" ;; *) printf '%s\n' "$1" ;; esac
}

# The --stop-file arguments for a harness run, one per line:
#   mapfile -t STOPS < <(stop_args "$T\\STOP")
#   [ ${#STOPS[@]} = $((2 * (1 + ${#STOP_NAMES[@]}))) ] || { echo "stop_args failed"; exit 3; }   # a failed
#   process substitution leaves STOPS empty while mapfile succeeds, so check the count before launching
#   deno task start harness run ... "${STOPS[@]}"
stop_args() {
  local n
  printf '%s\n' --stop-file "$1"
  for n in "${STOP_NAMES[@]}"; do printf '%s\n' --stop-file "$1.$n"; done
}

# Every active stop of target P, one path per line, or exactly "CLEAR" when there is none (H-89b
# run 002: a sentinel, so empty output, e.g. from a failed fork or substitution, never reads as
# clear). When P cannot be resolved, or its directory is missing or unreadable, it prints
# "<P> (unknown: ...)", which is not CLEAR either. Callers decide with stops_clear, never on
# "output is empty".
active_stops() {
  local p d b f n found=0
  p=$(stop_path "$1") && [ -n "$p" ] || { echo "$1 (unknown: path not resolvable)"; return 0; }
  d=${p%/*}; b=${p##*/}; [ "$d" = "$p" ] && d=.; [ -z "$d" ] && d=/
  [ -d "$d" ] && [ -r "$d" ] && [ -x "$d" ] || { echo "$p (unknown: directory missing or unreadable)"; return 0; }
  shopt -s nullglob nocaseglob nocasematch
  for f in "$d"/*; do
    n=${f##*/}
    [ -f "$f" ] || continue
    if [[ "$n" == "$b" ]] || { [[ "$n" == "$b".* ]] && [[ "$n" != "$b".cleared-* ]]; }; then echo "$f"; found=1; fi
  done
  shopt -u nullglob nocaseglob nocasematch
  [ $found = 1 ] || echo CLEAR
  return 0
}

# 0 only when active_stops P ran successfully and printed exactly CLEAR. Anything else (a stop, an
# unknown, empty output, a failed substitution) is "not clear". Every resume chain and gate uses it:
#   stops_clear "$P" || { echo "refused: $(active_stops "$P" | tr '\n' ' ')"; exit 3; }
stops_clear() { local o; o=$(active_stops "$1") && [ "$o" = CLEAR ]; }

# Write P.<name> with a reason, atomically and once (noclobber: exclusive create). Returns 0 when this
# call created the file, 1 when it already existed, 2 when it could not be written (H-89b item 4: a
# failed delivery is told apart from an existing stop, so the caller can retry and escalate).
stop_write() {
  local p; p=$(stop_path "$1") && [ -n "$p" ] || return 2
  [ -e "$p.$2" ] && return 1
  (set -C; echo "$2 $(date -u +%FT%TZ): $3" > "$p.$2") 2> /dev/null && return 0
  [ -e "$p.$2" ] && return 1
  return 2
}

# Hostwatch registry -> TGT_P[] / TGT_N[] (prefix in slash form, priority). Returns non-zero with
# the reason on stderr when the file is missing, has no targets, or has a malformed line.
parse_reg() {
  local line ln=0 p n q
  TGT_P=(); TGT_N=()
  [ -f "$1" ] || { echo "registry $1 missing" >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    ln=$((ln + 1)); line=${line%$'\r'}
    line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    case "$line" in '' | '#'*) continue ;; esac
    n=${line##*[[:space:]]}; p="${line%[[:space:]]*}"; p="${p%"${p##*[![:space:]]}"}"
    [[ "$n" =~ ^0*([0-9]{1,9})$ ]] && [ -n "$p" ] && [ "$p" != "$line" ] ||
      { echo "registry $1 line $ln malformed: '$line' (want '<stop prefix> <integer priority, at most 9 digits after leading zeros>')" >&2; return 1; }
    n=$((10#${BASH_REMATCH[1]}))  # 01 and 1 are the same priority
    q=$(stop_path "$p") && [ -n "$q" ] || { echo "registry $1 line $ln: prefix '$p' could not be resolved" >&2; return 1; }
    TGT_P+=("$q"); TGT_N+=("$n")
  done < "$1"
  [ ${#TGT_P[@]} -gt 0 ] || { echo "registry $1 has no targets" >&2; return 1; }
}

# Hostwatch liveness, for every consumer (watch.sh, gates-on.sh): prints exactly "OK" when the
# heartbeat is trustworthy, otherwise why not (H-89b run 002: a sentinel, so empty output from a
# failed fork never reads as fresh). Unsafe: missing, unreadable, older than <max> s (default 180),
# more than 60 s in the future (a clock moved back after it was written), or a failed `stat`/`date`.
# Callers decide with hb_ok, never on "output is empty".
hb_check() {
  local hb=$1 max=${2:-180} m now age
  [ -f "$hb" ] || { echo "hostwatch heartbeat missing ($hb)"; return 0; }
  [ -s "$hb" ] || { echo "hostwatch heartbeat empty ($hb; a failed write?)"; return 0; }
  m=$(stat -c %Y "$hb" 2> /dev/null) && [[ "$m" =~ ^[0-9]+$ ]] || { echo "hostwatch heartbeat unreadable ($hb)"; return 0; }
  now=$(date +%s) && [[ "$now" =~ ^[0-9]+$ ]] || { echo "clock unreadable while checking $hb"; return 0; }
  age=$((now - m))
  [ $age -gt "$max" ] && { echo "hostwatch heartbeat ${age}s old ($hb)"; return 0; }
  [ $age -lt -60 ] && { echo "hostwatch heartbeat $((-age))s in the future ($hb; clock moved?)"; return 0; }
  echo OK
}

# 0 only when hb_check ran successfully and printed exactly OK; HB_WHY holds its text either way.
hb_ok() { HB_WHY=$(hb_check "$@") && [ "$HB_WHY" = OK ] || { HB_WHY=${HB_WHY:-"heartbeat check failed (no output)"}; return 1; }; }

# Quarantined containers among <names...> in quarantine dir <qdir>: prints the count, or "ERR" when
# the records cannot be read (a failed jq or fork is never "none quarantined").
quarantined_count() {
  local qd=$1 n files; shift
  shopt -s nullglob; files=("$qd"/*.json); shopt -u nullglob
  [ -d "$qd" ] || { echo ERR; return 0; }
  [ ${#files[@]} -eq 0 ] && { echo 0; return 0; }
  n=$(jq -s --arg c "$*" '($c | split(" ")) as $want | [.[] | select(.state=="quarantined") | .container] | unique | map(select(. as $x | $want | index($x))) | length' "${files[@]}" 2> /dev/null) &&
    [[ "$n" =~ ^[0-9]+$ ]] && { echo "$n"; return 0; }
  echo ERR
}

# Is prefix P listed in the hostwatch registry? 0 yes, 1 no or the registry cannot be read.
reg_lists() {
  local i me; me=$(stop_path "$2") && [ -n "$me" ] || return 1; parse_reg "$1" 2> /dev/null || return 1
  shopt -s nocasematch
  for i in "${TGT_P[@]}"; do [[ "$i" == "$me" ]] && { shopt -u nocasematch; return 0; }; done
  shopt -u nocasematch; return 1
}

# Watcher lock: an atomic mkdir holding "pid starttime" (from /proc). It is taken over only when the
# recorded process is verifiably gone: no /proc entry for that pid, or the pid now has another start
# time. A /proc entry that exists but cannot be read means "unknown": no takeover (H-89b item 3). A
# lock without an owner file is never taken over: lock_take waits up to 10 s for the owner to write
# it, then fails. Takeover is serialised by a ticket (<dir>.takeover, atomic mkdir): the holder
# re-reads the owner and moves the lock aside only if it is still the dead owner it inspected, then
# retries the plain mkdir, which only one process can win. So two takers end with one owner.
# usage: lock_take <dir> || exit 3; trap 'lock_release <dir>' EXIT
proc_state() { # <pid> <start>: prints dead | live | unknown (an empty recorded start is unknown)
  local f
  [[ "$1" =~ ^[0-9]+$ ]] && [ -n "$2" ] || { echo unknown; return; }
  [ -e "/proc/$1" ] || { echo dead; return; }
  read -r -a f < "/proc/$1/stat" 2> /dev/null && [ -n "${f[21]:-}" ] || { echo unknown; return; }
  [ "${f[21]}" = "$2" ] && echo live || echo dead
}
proc_start() { local f; read -r -a f < "/proc/$1/stat" 2> /dev/null && [ -n "${f[21]:-}" ] || return 1; echo "${f[21]}"; }
LOCK_ME=""
lock_take() {
  local L=$1 i o pid st state side me
  # Our own identity must be known, or a later taker could not tell us from a dead owner.
  me=$(proc_start $$) && [ -n "$me" ] || { echo "lock: cannot read our own start time; not taking $L" >&2; return 1; }
  LOCK_ME="$$ $me"
  for i in 1 2 3; do
    if mkdir "$L" 2> /dev/null; then
      echo "$LOCK_ME" > "$L/owner" && return 0
      rm -rf "$L"; echo "lock: cannot write $L/owner" >&2; return 1
    fi
    [ -d "$L" ] || { echo "lock: cannot create $L" >&2; return 1; }
    for _ in $(seq 1 20); do [ -s "$L/owner" ] && break; sleep 0.5; done
    o=$(cat "$L/owner" 2> /dev/null)
    [ -n "$o" ] || { echo "lock: $L has no owner after 10 s; not taking it over" >&2; return 1; }
    read -r pid st <<< "$o"
    # Take over only on an explicit "dead" (H-89b run 002): an empty or failed result is unknown.
    state=$(proc_state "$pid" "$st") || state=unknown
    case "$state" in
      dead) ;;
      live) echo "lock: held by live pid $pid" >&2; return 3 ;;
      *) echo "lock: owner pid $pid state unknown ('$state'); not taking it over" >&2; return 1 ;;
    esac
    # Only the holder of the takeover ticket (an atomic mkdir) may move the lock, and it re-checks the
    # owner while holding it, so a lock that another taker already replaced is never moved. A ticket
    # left by a taker that died blocks further takeovers visibly (fail-closed): remove it by hand.
    mkdir "$L.takeover" 2> /dev/null ||
      { echo "lock: another takeover of $L is in progress (or a stale $L.takeover; remove it by hand)" >&2; return 3; }
    if [ "$(cat "$L/owner" 2> /dev/null)" = "$o" ]; then
      side="$L.stale-$$-$i"
      mv -T "$L" "$side" 2> /dev/null && { echo "lock: took over from dead owner '$o'" >&2; rm -rf "$side"; }
    fi
    rmdir "$L.takeover" 2> /dev/null
  done
  echo "lock: could not take $L" >&2; return 1
}
lock_release() { [ "$(cat "$1/owner" 2> /dev/null)" = "$LOCK_ME" ] && rm -rf "$1"; return 0; }
