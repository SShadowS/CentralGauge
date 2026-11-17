#!/usr/bin/env bash
# M8-21 Step 3: freeze qualification at 2fb244fe on Cronus281 (ops lease, heartbeat in jobs\W2-10).
# Grant: decisions\2026-11-15-egress-grant-m8-21-qualify.md. Graceful stop: create <private-dir>\STOP.
L='H:\cg-coord\jobs\W2-10'
t=$(jq -r .token "$L\\lease-281.json") || exit 3
cd /h/cg-coord/jobs/W2-05-gates || exit 3
[ -z "$(git status --porcelain)" ] || { echo "W2-05-gates not clean"; exit 3; }
echo "START $(date -u +%FT%TZ) HEAD $(git rev-parse --short HEAD)"
DOCKER_CONTEXT=desktop-windows CG_LANE=ops deno task start harness qualify \
  --manifest 'H:\cg-coord\m8\freeze-m8-21\qualify-manifest-front.json' \
  --containers Cronus281 \
  --coord-lease "Cronus281=$t" \
  --lineage 'infra\harness-reset\lineages\golden-o09-v2.json' \
  --unverified-bc-egress-ok 'owner grant decisions/2026-11-15-egress-grant-m8-21-qualify.md: M8-21 freeze qualification, no models, no ingest, NST egress unenforced in golden-o09-v2 (disclosed)' \
  --results-dir 'H:\cg-coord\results\harness' \
  --symbol-store 'H:\cg-coord\jobs\M8-16a\results\harness\symbols' \
  --private-dir 'H:\cg-coord\m8\freeze-m8-21\private' \
  --backend-port 3241 \
  --secrets-dir 'H:\cg-coord\m8\freeze-m8-21\secrets-empty' \
  --credential-ledger 'H:\cg-coord\ledgers\credential-runs.jsonl' \
  --lane ops
rc=$?
echo "EXIT $rc $(date -u +%FT%TZ)"
exit $rc
