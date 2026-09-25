#!/bin/bash
# SPIKE (throwaway): harness bench M1-31 egress feasibility
# usage: egress-run.sh <label> <proxyUrl|none> <entry...>
label=$1; proxy=$2; shift 2
envs=()
if [ "$proxy" != none ]; then envs=(-e "HTTPS_PROXY=$proxy" -e "HTTP_PROXY=$proxy" -e "NO_PROXY=" ); fi
envs+=("${EXTRA_ENV[@]}")
start=$(date +%s)
DOCKER_CONTEXT=desktop-windows timeout 240 docker run --rm --name "cg-harness-egress-$label" "${envs[@]}" \
  --mount 'type=bind,src=H:\Temp3\harness-spike\ws-egress,dst=C:\workspace' \
  --mount 'type=bind,src=H:\Temp3\harness-spike\egress-task,dst=C:\task,readonly' \
  --mount 'type=bind,src=H:\Temp3\harness-spike\secrets,dst=C:\cg-secrets,readonly' \
  centralgauge/harness-spike:windows powershell -File "$@" > "/h/Temp3/harness-spike/M1-31-$label.out" 2>&1
code=$?
echo "$label exit=$code secs=$(( $(date +%s) - start ))"
DOCKER_CONTEXT=desktop-windows docker rm -f "cg-harness-egress-$label" >/dev/null 2>&1
