#!/usr/bin/env bash
# M12-08 launch kit: the M12 smoke (cc-v2-smoke) and the confirmatory campaign (cc-v2-factorial). Copy of
# tasks\M8-18b\run.sh. Checkout jobs\M12-run at the campaign commit, clean; results root H:\cg-coord\results\harness;
# lineage golden-o09-v3 (D-5 (c), env_fp b9ba30b0855c); pool Cronus281-283 (D-4). H-89: one --stop-file per named
# stop (stop_args on tasks\M12-08\STOP-<experiment>); the campaign watcher's own stop file is <prefix dir>\watch.STOP.
# Egress (D-2): BC side decisions\2026-11-17-egress-grant-m12.md, sandbox side
# decisions\2026-11-18-m12-concurrency-and-sandbox-egress.md, exact reason texts. Accounts (D-3):
# decisions\2026-11-18-m12-credential-limit-and-pool.md: max, maxpriv, maxpriv2; never Work; no label added on a resume.
# Concurrency (D-4): CONC=fixed (default) runs 3 blocks at once; CONC=dynamic is the H-114b form, bounds 2..4, admission
# at 30 GiB free (its flags exist only once H-114b is merged and the campaign commit moves to it; until then the
# harness refuses them as unknown options).
# Container starts are not this script's job: leases are taken before (jobs\W2-10\lease-<n>.json). A start probe is
# made from a fresh process before a start is declared failed (M12-06 finding).
# usage: [CONC=fixed|dynamic] run.sh <experiment: cc-v2-smoke|cc-v2-factorial> <mode: dry|full|resume> [campaign id]
exp=$1; mode=$2; cid=$3
CAMPAIGN_COMMIT=82f30dac   # orchestrator-named campaign commit (master with M12-02, H-115, M12-03b); change only on its word
T='H:\cg-coord\tasks\M12-08'
W=/h/cg-coord/jobs/M12-run
POOL='281 282 283'
CONC=${CONC:-fixed}
case $exp in cc-v2-smoke|cc-v2-factorial) ;; *) echo "experiment: cc-v2-smoke|cc-v2-factorial"; exit 2 ;; esac
case $mode in
  dry|full) [ -z "$cid" ] || { echo "mode $mode takes no campaign id"; exit 2; } ;;
  resume) [ -n "$cid" ] || { echo "mode resume needs the campaign id"; exit 2; } ;;
  *) echo "mode: dry|full|resume"; exit 2 ;;
esac
case $CONC in
  fixed) conc_args=(--concurrency 3) ;;
  dynamic) conc_args=(--concurrency 2 --concurrency-max 4 --admit-free-gib 30) ;;   # H-114b flag names: confirm when it lands
  *) echo "CONC: fixed|dynamic"; exit 2 ;;
esac
P="$T\\STOP-$exp"
. "$W/scripts/harness/ops/stops.sh" || exit 3
mapfile -t STOPS < <(stop_args "$P")
[ ${#STOPS[@]} = $((2 * (1 + ${#STOP_NAMES[@]}))) ] || { echo "stop_args failed"; exit 3; }
containers=""
leases=()
for c in $POOL; do
  containers="${containers:+$containers,}Cronus$c"
  if [ "$mode" != dry ]; then
    t=$(jq -r .token "H:\\cg-coord\\jobs\\W2-10\\lease-$c.json") && [ -n "$t" ] && [ "$t" != null ] || { echo "no ops lease for Cronus$c"; exit 3; }
    leases+=(--coord-lease "Cronus$c=$t")
  fi
done
env_args=(
  --results-dir 'H:\cg-coord\results\harness'
  --private-dir "H:\\cg-coord\\m12\\private-$exp"
  --containers "$containers"
  --backend-port 3270
  --secrets-dir 'max=H:\Temp3\harness-spike\secrets'
  --secrets-dir 'maxpriv=H:\Temp3\harness-spike\secrets-MaxPriv'
  --secrets-dir 'maxpriv2=H:\Temp3\harness-spike\secrets-MaxPriv2'
  --lineage 'infra\harness-reset\lineages\golden-o09-v3.json'
  --unverified-bc-egress-ok 'owner grant decisions/2026-11-17-egress-grant-m12.md: M12 setup, smoke and confirmatory campaign, no ingest, NST egress unenforced in golden-o09-v3 (disclosed)'
  --symbol-store 'H:\cg-coord\jobs\M8-16a\results\harness\symbols'
  --credential-ledger 'H:\cg-coord\ledgers\credential-runs.jsonl')
run_args=(
  --unverified-egress-ok 'owner grant decisions/2026-11-18-m12-concurrency-and-sandbox-egress.md: M12 smoke and confirmatory campaign, sandbox egress unverified as in screening (disclosed), no ingest'
  "${conc_args[@]}"
  "${STOPS[@]}")
[ "$exp" = cc-v2-factorial ] && run_args+=(
  --prereg-decision 'H:\cg-coord\decisions\2026-10-17-harness-v2-prereg-a.md'
  --prereg-b-decision 'H:\cg-coord\decisions\2026-11-17-harness-v2-prereg-b.md')
case $mode in
  dry) args=(harness run "$exp" "${env_args[@]}" "${run_args[@]}" --dry-run) ;;
  full) args=(harness run "$exp" "${env_args[@]}" "${run_args[@]}" "${leases[@]}" --max-pause-min 120) ;;
  resume) args=(harness run "$exp" "${env_args[@]}" "${run_args[@]}" "${leases[@]}" --max-pause-min 120 --campaign "$cid") ;;
esac
if [ "$mode" != dry ]; then
  stops_clear "$P" || { echo "refused: active stops: $(active_stops "$P" | tr '\n' ' ')"; exit 3; }
  if [ "$mode" = full ] && [ "$exp" = cc-v2-factorial ]; then
    shopt -s nullglob; recs=(/h/cg-coord/results/harness/campaigns/*.json); shopt -u nullglob
    [ ${#recs[@]} -eq 0 ] || ! grep -lq '"cc-v2-factorial"' "${recs[@]}" ||
      { echo "refused: a cc-v2-factorial campaign record exists; use resume"; exit 3; }
  fi
fi
cd "$W" || exit 3
[ -z "$(git status --porcelain)" ] || { echo "M12-run not clean"; exit 3; }
head=$(git rev-parse HEAD) && [ "${head#"$CAMPAIGN_COMMIT"}" != "$head" ] || { echo "M12-run HEAD $head is not the campaign commit $CAMPAIGN_COMMIT"; exit 3; }
echo "START $(date -u +%FT%TZ) $exp $mode CONC=$CONC HEAD $(git rev-parse --short HEAD)"
CG_LANE=ops deno task start "${args[@]}"
rc=$?
echo "EXIT $rc $(date -u +%FT%TZ)"
exit $rc
