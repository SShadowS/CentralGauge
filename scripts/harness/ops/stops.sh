# Named STOP files (H-89). Source this file; it defines no commands of its own.
#
# A stop target is a path prefix P: a campaign's stop file (tasks\<id>\STOP) or a gate pool's
# (jobs\W2-12\STOP-gates-<container>). Active stops are P itself (written by hand or by the
# orchestrator) and P.<name> for each writer below. Each writer owns its own name, so a writer
# never skips because some other stop already exists, and clearing one stop never clears another.
# Archived stops keep a date in the suffix (P.cleared-20261112T1312Z) and are not active.
#
#   watch     per-campaign watcher (scripts/harness/ops/watch.sh): RAM floor, pool quarantined
#   host-low  hostwatch.sh, lowest-priority targets
#   host-all  hostwatch.sh, every target
#   planned   a planned pause (a chain that pauses a run on purpose)
STOP_NAMES=(watch host-low host-all planned)

# The --stop-file arguments for a harness run, one per line:
#   mapfile -t STOPS < <(stop_args "$T\\STOP"); deno task start harness run ... "${STOPS[@]}"
stop_args() {
  local n
  printf '%s\n' --stop-file "$1"
  for n in "${STOP_NAMES[@]}"; do printf '%s\n' --stop-file "$1.$n"; done
}

# Every active stop of target P, one path per line. A resume chain refuses while this prints
# anything: [ -z "$(active_stops "$P")" ] || { echo "refused: $(active_stops "$P" | tr '\n' ' ')"; exit 3; }
active_stops() {
  local f b=${1##*/}
  for f in "$1" "$1".*; do
    [ -f "$f" ] && [[ "${f##*/}" =~ ^"$b"(\.[a-z-]+)?$ ]] && echo "$f"
  done
  return 0
}

# Write P.<name> with a reason, once. Returns 0 only when it wrote the file now.
stop_write() {
  [ -f "$1.$2" ] && return 1
  echo "$2 $(date -u +%FT%TZ): $3" > "$1.$2"
}
