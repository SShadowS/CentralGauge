#!/usr/bin/env bash
# M12-11 Step 2: the blinded progress projection (the allow-list). Prints only these keys, never the unprojected JSON,
# pass_cells, fail_cells or a per-arm cost. `load` is H-114b's pooled block (never split by arm; absent until an
# execution records one). Runs from jobs\M12-run at the campaign commit (records from 0936645c carry `load`).
# usage: progress.sh <experiment: cc-v2-smoke|cc-v2-factorial> <campaign id>
exp=$1; cid=$2
case $exp in cc-v2-smoke|cc-v2-factorial) ;; *) echo "experiment: cc-v2-smoke|cc-v2-factorial"; exit 2 ;; esac
[ -n "$cid" ] || { echo "campaign id needed"; exit 2; }
cd /h/cg-coord/jobs/M12-run || exit 3
set -o pipefail
deno task -q start harness progress "$exp" --campaign "$cid" --results-dir 'H:\cg-coord\results\harness' --json |
  jq -f /h/cg-coord/tasks/M12-08/progress.jq
