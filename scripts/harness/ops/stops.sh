# Named STOP files and watcher locks (H-89). Source this file; it defines no commands of its own.
#
# A stop target is a path prefix P: a campaign's stop file (tasks\<id>\STOP) or a gate pool's
# (jobs\W2-12\STOP-gates-<container>). Windows (backslash) prefixes are accepted everywhere.
#
# Active stops: P itself and every P.<anything>, compared case-insensitively (NTFS), except the
# archive form P.cleared-<UTC stamp>. To clear a stop, rename it to P.cleared-<stamp>; never delete
# it. A resume chain refuses while active_stops prints anything, so an unknown P.foo also blocks a
# resume.
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
#   mapfile -t STOPS < <(stop_args "$T\\STOP"); deno task start harness run ... "${STOPS[@]}"
stop_args() {
  local n
  printf '%s\n' --stop-file "$1"
  for n in "${STOP_NAMES[@]}"; do printf '%s\n' --stop-file "$1.$n"; done
}

# Every active stop of target P, one path per line (empty when none).
active_stops() {
  local p d b f n
  p=$(stop_path "$1"); d=$(dirname "$p"); b=$(basename "$p")
  [ -d "$d" ] || return 0
  shopt -s nullglob nocaseglob nocasematch
  for f in "$d"/*; do
    n=${f##*/}
    [ -f "$f" ] || continue
    if [[ "$n" == "$b" ]] || { [[ "$n" == "$b".* ]] && [[ "$n" != "$b".cleared-* ]]; }; then echo "$f"; fi
  done
  shopt -u nullglob nocaseglob nocasematch
  return 0
}

# Write P.<name> with a reason, atomically and once (noclobber: exclusive create). Returns 0 only
# when this call created the file.
stop_write() {
  local p; p=$(stop_path "$1")
  (set -C; echo "$2 $(date -u +%FT%TZ): $3" > "$p.$2") 2> /dev/null
}

# Hostwatch registry -> TGT_P[] / TGT_N[] (prefix in slash form, priority). Returns non-zero with
# the reason on stderr when the file is missing, has no targets, or has a malformed line.
parse_reg() {
  local line ln=0 p n
  TGT_P=(); TGT_N=()
  [ -f "$1" ] || { echo "registry $1 missing" >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    ln=$((ln + 1)); line=${line%$'\r'}
    line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    case "$line" in '' | '#'*) continue ;; esac
    n=${line##*[[:space:]]}; p="${line%[[:space:]]*}"; p="${p%"${p##*[![:space:]]}"}"
    [[ "$n" =~ ^[0-9]+$ ]] && [ -n "$p" ] && [ "$p" != "$line" ] ||
      { echo "registry $1 line $ln malformed: '$line' (want '<stop prefix> <integer priority>')" >&2; return 1; }
    TGT_P+=("$(stop_path "$p")"); TGT_N+=("$n")
  done < "$1"
  [ ${#TGT_P[@]} -gt 0 ] || { echo "registry $1 has no targets" >&2; return 1; }
}

# Watcher lock: an atomic mkdir holding "pid starttime" (from /proc). It is taken over only when the
# recorded process is verifiably gone: no such pid, or that pid now has another start time. A lock
# without an owner file is never taken over: lock_take waits up to 10 s for the owner to write it,
# then fails. Takeover renames the old lock aside (atomic, so only one taker wins), then retries.
# usage: lock_take <dir> || exit 3; trap 'lock_release <dir>' EXIT
proc_start() { local f; read -r -a f < "/proc/$1/stat" 2> /dev/null || return 1; echo "${f[21]}"; }
LOCK_ME=""
lock_take() {
  local L=$1 i o pid st now
  LOCK_ME="$$ $(proc_start $$)"
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
    now=$(proc_start "$pid") && [ "$now" = "$st" ] && { echo "lock: held by live pid $pid" >&2; return 3; }
    mv "$L" "$L.stale-$$" 2> /dev/null && { echo "lock: took over from dead owner '$o'" >&2; rm -rf "$L.stale-$$"; }
  done
  echo "lock: could not take $L" >&2; return 1
}
lock_release() { [ "$(cat "$1/owner" 2> /dev/null)" = "$LOCK_ME" ] && rm -rf "$1"; return 0; }
