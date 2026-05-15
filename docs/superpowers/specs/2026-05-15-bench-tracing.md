# Bench tracing: complete waterfall, every code block + iteration

**Status:** v2 — incorporates gpt-5.5 review. Pre-implementation. Companion to `BenchBattleplan.md` Phase 2 troubleshooting.

## v1 → v2 changes (from gpt-5.5 review)

| v1 (rejected)                                      | v2 (this doc)                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Default artifact = NDJSON                          | Default = valid Chrome Trace JSON object (`{ "traceEvents": [...] }`). NDJSON is an optional internal journal, never the drag-drop artifact. |
| `Write-Output "[TRACE] ..."` for pwsh emission     | `[Console]::Out.WriteLine(...)` — bypasses pwsh success-stream pipeline so wrapped command return values aren't corrupted. |
| One ambiguous `CG_TRACE_BENCH_START_MICROS` env    | Two origins captured at tracer init: `originPerfMicros` (TS monotonic) + `originUnixMicros` (wall-clock). PS receives `CG_TRACE_BENCH_START_UNIX_MICROS` only. |
| "Branchless, zero-allocation hot path" claim       | Weakened to "no clock reads, no I/O, no buffer alloc, no pwsh helper injection" when disabled. |
| `[hashtable]$args` param name                       | `[hashtable]$TraceArgs` — avoids shadowing pwsh automatic variable.            |
| Slot lifecycle implicit                            | Explicit `slot.create`/`acquire`/`release`/`recycle` + `pwsh-session.first-command`/`reuse` spans + instants. |
| Single `slot-wait` span                            | Two distinct waits: `container-slot-wait` AND `pwsh-session-wait`.             |
| SOAP traced only at `fetch` boundary               | `soap-test-total` envelope wraps build-envelope → fetch → read body → parse → result. |
| Legacy path not explicitly traced                  | Symmetric `test.legacy.*` spans for visual A/B compare with `test.soap.*`.     |
| Redaction in open questions                        | Mandatory core requirement. All free-form `args` strings go through `redactSensitive` + 200-char cap. |
| `tid` as string                                    | `tid` is numeric; tracer maps lane names to ids and emits `thread_name` metadata. |
| `--trace <path>` mixed enable+path                 | `--trace` (enable, default path) + `--trace-file <path>` (override) + `--no-trace`. |

## Goal

Make every interesting span of a CentralGauge bench run visible on a single
zoomable timeline — host-side TS spans, per-container PowerShell session
slot activity, individual `bccontainerhelper` cmdlet calls, SOAP HTTP
requests, queue waits, retries — so questions like

- "is the warm slot actually warm?",
- "where does the mystery 7-25 min/task go on the SOAP path?",
- "is `Get-BcContainerAppInfo` paying first-cmdlet cost every script?",
- "is queue wait or BC op the bottleneck?"

become **data lookups** instead of speculation. Drag-and-drop into
[ui.perfetto.dev](https://ui.perfetto.dev) and answer in seconds.

## Non-goals

- Distributed tracing / OTLP / Jaeger — single-host bench, no cross-process trace context propagation needed.
- Always-on production tracing. The tracer is off by default; zero overhead when disabled.
- Sampling profilers / flame graphs. We want explicit spans for code blocks we control, not CPU sampling.
- Replacing or augmenting `benchmark-results-*.json`. Trace is a separate concern.
- Wall-clock accuracy below ~1 ms. Microsecond timestamps are nominal; we measure milliseconds.
- Cross-bench comparison built into the viewer. Future tooling can merge two traces; this spec stays scoped to one bench.

## Format

**Chrome Trace Event Format** (a.k.a. catapult). Reasons:

- Standard since V8/Chromium/Skia/Android Studio profilers. Stable.
- Free, browser-native viewer at `ui.perfetto.dev` (and the older `chrome://tracing`).
- Drag-drop, zoom, multi-lane (one per logical "thread"), search, query language ("SQL on traces").
- Scales to millions of events; gzip-friendly.
- Both Deno/TS and PowerShell can emit it trivially as JSON lines.

Reference: <https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU>.

### File format

The **drag-drop artifact** is a single valid Chrome Trace JSON document:

```json
{
  "traceEvents": [
    { "ph": "M", "name": "process_name", "pid": 0, "args": { "name": "centralgauge-bench" } },
    { "ph": "M", "name": "thread_name", "pid": 0, "tid": 1, "args": { "name": "orchestrator" } },
    { "ph": "M", "name": "thread_name", "pid": 0, "tid": 100, "args": { "name": "Cronus281 (slot)" } },
    { "ph": "M", "name": "thread_name", "pid": 0, "tid": 101, "args": { "name": "Cronus281 (pwsh cmdlets)" } },
    { "name": "publishApp", "cat": "container,publish", "ph": "X", "ts": 1742031400, "dur": 11401000, "pid": 0, "tid": 100, "args": { "taskId": "CG-AL-E001", "model": "openai/gpt-5.5", "attempt": 1 } }
  ],
  "displayTimeUnit": "ms"
}
```

Wrapped form (`{ "traceEvents": [...] }`) preferred over bare array — Perfetto and `chrome://tracing` accept both, but the wrapped form supports `displayTimeUnit` and `metadata`.

**NDJSON is optional internal-journal output only**, controlled by `--trace-journal <path>` separately. The default `--trace` output is always a valid Chrome Trace JSON file. NDJSON is never the drag-drop artifact.

### Event shape

```json
{
  "name": "publishApp",
  "cat": "container,publish",
  "ph": "X",
  "ts": 1742031400,
  "dur": 11401000,
  "pid": 0,
  "tid": 100,
  "args": {
    "taskId": "CG-AL-E001",
    "model": "openai/gpt-5.5",
    "attempt": 1,
    "container": "Cronus281",
    "ok": true
  }
}
```

- `ts` and `dur` are **microseconds since bench start (monotonic-derived)** — eliminates wall-clock jumps mid-run.
- `ph` (phase):
  - `X` (complete) — preferred for finished spans, carries `dur`.
  - `B`/`E` — begin/end pairs, used when span end is unknown at start.
  - `i` (instant) — point events (queue enqueue, retry-fired, error marker).
  - `b`/`n`/`e` (async) — for spans that may overlap on the same `tid` (rare; reserved for SOAP-on-different-lane patterns).
  - `M` (metadata) — `thread_name`, `process_name` to label lanes.
- `pid` — `0` = bench. Reserved for future sub-roles.
- `tid` — **numeric**. Tracer maps lane names internally; numeric ids are universally importer-safe. Convention:
  - `1` = orchestrator
  - `2` = compile-queue
  - `3` = llm-pool
  - `4` = soap-async
  - `100 + i*10` = `Cronus28{i}` slot lane
  - `101 + i*10` = `Cronus28{i}` pwsh-cmdlets sub-lane
  - `102 + i*10` = `Cronus28{i}` soap sub-lane
- `cat` — comma-separated categories so users can filter (`container`, `publish`, `cleanup`, `soap`, `llm`, `compile`, `queue`, `slot`, `pwsh`, `bcch`).
- `args` — stable schema (see Event arg schema below). All free-form strings go through `redactSensitive` + 200-char cap before emission.

### Event arg schema (stable common fields)

Not every event carries every field, but when present these names are stable:

| Field          | Type    | Notes                                          |
| -------------- | ------- | ---------------------------------------------- |
| `taskId`       | string  | e.g. `"CG-AL-E001"`                            |
| `model`        | string  | full slug, e.g. `"anthropic/claude-opus-4-6"`  |
| `attempt`      | number  | 1-based                                        |
| `container`    | string  | e.g. `"Cronus281"`                             |
| `slotId`       | string  | `<container>-<seq>` per session lifecycle      |
| `sessionId`    | string  | distinct from slotId if slot rebuilds session  |
| `path`         | string  | `"soap"` \| `"legacy"`                         |
| `scriptLabel`  | string  | `"cleanup"` \| `"publish"` \| `"compile"` \| `"test"` |
| `wasWarm`      | boolean | session reuse flag                             |
| `ok`           | boolean | true if span body completed normally           |
| `errorType`    | string  | class name on throw                            |
| `errorMessage` | string  | redacted, 200-char cap                         |
| `httpStatus`   | number  | SOAP responses                                 |
| `totalTests`   | number  | SOAP result count                              |
| `retry`        | number  | retry index (0 = first try)                    |

## Architecture

Three components:

### 1. TS-side `Tracer` (`src/tracing/tracer.ts`)

- Single instance per bench. Lazy-initialized on first `tracer.start*` if `CENTRALGAUGE_TRACE_FILE` (or CLI `--trace`) is set.
- Buffers events in memory; flushes on shutdown via `Deno.addSignalListener("SIGINT", ...)` (best-effort on Windows; hard kill loses buffered tail) and an explicit `await tracer.close()` from the bench teardown.
- **Writes a single valid Chrome Trace JSON document on close**: `{ "traceEvents": [...], "displayTimeUnit": "ms" }`. Periodic flushes (every 1 s or 1000 events) rewrite the full valid JSON to disk atomically (`Deno.writeTextFile(tmp); Deno.rename(tmp, final)`) so the on-disk file is always valid Chrome JSON even mid-run. Tiny event count (~1200/bench) makes the rewrite-on-flush approach cheap.
- Optional `--trace-journal <path>` writes a parallel NDJSON journal for tailing during the run. NDJSON is never the drag-drop artifact.
- **Time base — two origins captured at init**:
  ```ts
  this.originPerfMicros = performance.now() * 1000;   // monotonic, no DST/NTP jumps
  this.originUnixMicros = Date.now() * 1000;           // wall-clock anchor for pwsh-side
  ```
  TS event `ts = (performance.now() * 1000) - originPerfMicros`. Monotonic, immune to mid-run clock adjustment.
  PowerShell receives the env var `CG_TRACE_BENCH_START_UNIX_MICROS = originUnixMicros` only. PS computes `ts = (DateTimeOffset.UtcNow.ToUnixTimeMicroseconds() ?? UtcNow.ToUnixTimeMilliseconds() * 1000) - $env:CG_TRACE_BENCH_START_UNIX_MICROS`. Stopwatch covers `dur`. Visual alignment expected within a few ms on a single Windows host; not guaranteed if Windows time sync adjusts mid-run (rare in a benchsmall window). Stopwatch-derived `dur` is unaffected by wall-clock jumps.

#### API

```ts
import { tracer } from "../tracing/tracer.ts";

// Span helper — preferred. Auto-closes even on throw.
await tracer.span("publishApp", { tid: "Cronus281", cat: ["container", "publish"], args: { taskId, model } }, async () => {
  await this.runScriptThroughSession(name, script);
});

// Manual start/end for cases where the close site differs from start site.
const span = tracer.start("queue-wait", { tid: "Cronus281", cat: ["queue"] });
try { ... } finally { span.end({ args: { reason: "container-busy" } }); }

// Point event.
tracer.instant("infra-retry-fired", { tid: "Cronus281", cat: ["infra"], args: { fromContainer, toContainer } });

// Async begin/end (when the span spans threads / has out-of-order end).
const id = tracer.beginAsync("soap-call", { tid: "soap", cat: ["soap"], args: { container, codeunit } });
// ...
tracer.endAsync(id, { args: { httpStatus, totalTests } });
```

#### Off-by-default contract

When disabled (`--no-trace` or env unset):

- **No** clock reads in `tracer.span*` / `tracer.start*`.
- **No** trace buffer allocation.
- **No** JSON serialization.
- **No** file I/O.
- **No** PowerShell helper injection — scripts emit zero `[TRACE]` lines.
- **No** stdout `[TRACE]` parsing in `runScriptThroughSession`.

Honest caveats (not eliminable without API redesign):

- Call sites still allocate the options object literal (`{ tid, cat, args }`) and async closure when calling `tracer.span()`. For a few-thousand-event bench this is irrelevant.
- The `if (this.enabled)` check happens once per span call. Sub-microsecond.

If a future hot-path call site is measurably affected, the caller should guard explicitly:

```ts
if (tracer.enabled) {
  await tracer.span("hot", { tid, cat, args: { ... } }, body);
} else {
  await body();
}
```

But this complication is not needed for v1; all v1 spans are at coarse workflow boundaries (LLM calls, container ops, HTTP), not CPU-tight loops.

### 2. PowerShell-side emission

PowerShell scripts that run BCH cmdlets emit trace events as `[TRACE]` lines on stdout. TS-side parses them out of script output.

#### Emit helper (injected at top of every relevant script, only when tracing enabled)

```powershell
# Origin propagated from TS as Unix wall-clock microseconds.
$global:CGTraceUnixOrigin = $env:CG_TRACE_BENCH_START_UNIX_MICROS
$global:CGTraceTid        = [int]$env:CG_TRACE_TID  # numeric lane id; 0 = disabled

function CG-Trace {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]      $Name,
        [Parameter(Mandatory)] [scriptblock] $Body,
        [hashtable]                          $TraceArgs = @{}
    )
    if (-not $global:CGTraceUnixOrigin -or $global:CGTraceTid -eq 0) {
        # Off-mode: just run the body and return its output transparently.
        return & $Body
    }

    # Capture origin-relative start before running body. ToUnixTimeMicroseconds()
    # added in .NET 7+; fall back to milliseconds × 1000 on older runtimes.
    $nowMicros = if ([DateTimeOffset].GetMethod('ToUnixTimeMicroseconds')) {
        [DateTimeOffset]::UtcNow.ToUnixTimeMicroseconds()
    } else {
        [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() * 1000
    }
    $tsMicros = $nowMicros - $global:CGTraceUnixOrigin
    $sw       = [System.Diagnostics.Stopwatch]::StartNew()
    $ok       = $true
    $errType  = $null
    $errMsg   = $null

    try {
        # PRESERVE body output exactly. Body's success stream flows back to caller.
        # Do NOT use `Write-Output` for trace lines (would contaminate this stream).
        & $Body
    } catch {
        $ok      = $false
        $errType = $_.Exception.GetType().FullName
        $errMsg  = $_.Exception.Message
        if ($errMsg.Length -gt 200) { $errMsg = $errMsg.Substring(0, 200) }
        throw   # rethrow ORIGINAL exception unchanged
    } finally {
        # Best-effort trace emission; failures inside finally must not mask
        # the body's exception (the `throw` above already preserved it).
        try {
            $durMicros = [long]($sw.ElapsedTicks * 1000000 / [System.Diagnostics.Stopwatch]::Frequency)
            $finalArgs = @{} + $TraceArgs
            $finalArgs['ok'] = $ok
            if (-not $ok) {
                $finalArgs['errorType']    = $errType
                $finalArgs['errorMessage'] = $errMsg
            }
            $event = @{
                name = $Name
                ph   = 'X'
                ts   = [long]$tsMicros
                dur  = $durMicros
                pid  = 0
                tid  = $global:CGTraceTid
                cat  = 'pwsh,bcch'
                args = $finalArgs
            } | ConvertTo-Json -Compress -Depth 5

            # Use [Console]::Out.WriteLine — bypasses the PowerShell pipeline so
            # the caller's `$result = CG-Trace ... { ... }` is unaffected.
            # Write-Output WOULD inject "[TRACE] ..." into the success stream.
            [Console]::Out.WriteLine("[TRACE] $event")
        } catch {
            # Trace emission failed — log to stderr (so caller can decide whether
            # to surface) but never re-throw or affect the original outcome.
            [Console]::Error.WriteLine("[TRACE-EMIT-ERROR] $($_.Exception.Message)")
        }
    }
}

# Usage:
$apps = CG-Trace -Name "Get-BcContainerAppInfo" -TraceArgs @{ container = $containerName } -Body {
    Get-BcContainerAppInfo -containerName $containerName
}
# $apps now holds the cmdlet's result unchanged.
```

#### Constraints

- **Tracing-disabled mode injects nothing.** When `CG_TRACE_BENCH_START_UNIX_MICROS` is unset, TS does NOT inject the `CG-Trace` function definition into BCH scripts. Scripts are byte-identical to current production.
- Wrap **only** operations we want lanes for. Initial targets: `Get-BcContainerAppInfo`, `Unpublish-BcContainerApp`, `Publish-BcContainerApp`, `Invoke-ScriptInBcContainer` (outer call only), `Run-TestsInBcContainer`.
- `[Console]::Out.WriteLine(...)` writes to host stdout outside the pwsh pipeline — wrapped command return values are preserved exactly.
- Body exceptions are re-thrown unchanged; trace emission is best-effort and runs in a nested try/catch so a serialization failure can't mask the original error.
- Trace lines on stderr (`[TRACE-EMIT-ERROR]`) signal trace machinery is broken — non-fatal to the bench.

### 3. Merger / writer

TS-side reads script stdout, extracts `[TRACE] ...` lines, parses the JSON object, and forwards to the same `tracer` buffer as host-side spans. This means:

- PowerShell-emitted events land on the per-container pwsh-cmdlets sub-lane (`tid=101`, `103`, … per the numeric scheme above) right alongside TS-emitted spans on the container's slot lane (`tid=100`, `102`, …) in the same trace file.
- Single output: `results/<run>/trace.json` (valid Chrome Trace JSON). Optional `results/<run>/trace.ndjson` if `--trace-journal` requested.
- A tiny CLI wrapper `centralgauge trace open <file>` prints "drag this file to https://ui.perfetto.dev" (and on Windows, can `Start-Process` the URL). No bundled viewer.

## Coverage plan

These are the **minimum spans** for Phase 2 / 3 troubleshooting. Ship one at a time.

### Bench-level

- `bench` (root, `tid=orchestrator`) — start to end of the whole run.
- `bench.setup` — container warmup, compiler folder, harness publish.
- `bench.teardown` — finalize, write outputs.

### Per-task

- `task` (one per (task, model, attempt) tuple, `tid=<container>`) — wraps everything for one task. Carries `args: { taskId, model, attempt, container }`.
- Sub-spans:
  - `llm-request` (cat=`llm`) — LLM call. `args.path=anthropic|openai|...`.
  - `compile` (cat=`compile`)
  - `prereq-publish` (cat=`container,prereq`) — if applicable.
  - `cleanup` (cat=`container,cleanup`) — `cleanupStaleCandidates` call.
  - `publish-app` (cat=`container,publish`) — `publishApp` call.
  - `container-slot-wait` (cat=`queue,slot`) — time from task request to per-container slot acquire (queue depth contention).
  - `pwsh-session-wait` (cat=`pwsh,session`) — time from slot acquire to inside-session ready (mutex contention within the slot).
  - **SOAP-path test spans (symmetric)**:
    - `test.soap.total` (cat=`soap,test`) — wraps everything below.
    - `test.soap.build-envelope` — XML build, auth string.
    - `test.soap.http` (cat=`soap,http`) — `fetch` start → response received.
    - `test.soap.read-body` — `await response.text()`.
    - `test.soap.parse` — XML/JSON parse to `TestResult`.
  - **Legacy-path test spans (symmetric)**:
    - `test.legacy.total` (cat=`legacy,test`) — wraps everything below.
    - `test.legacy.run-tests-in-bc-container` — the BCH wrapper call.
    - `test.legacy.parse` — output → `TestResult` conversion.
  - Fallback marker: instant `soap-fallback-to-legacy` with `args: { reason, errorType }` whenever SOAP fork errors and legacy path runs.

### Per-script (host side)

- `runScriptThroughSession` (cat=`pwsh,slot`, `tid=<container slot>`) — wraps a single slot.runScript() call. `args: { scriptLabel: "cleanup" | "publish" | "compile" | "test", slotId, sessionId, wasWarm }`.

### Slot + pwsh-session lifecycle (answers "is the slot actually warm?")

- `slot.create` (cat=`slot`, instant) — fired when a new `ContainerSessionSlot` is constructed. `args: { slotId, container }`.
- `slot.acquire` (cat=`slot`) — wraps the lock acquisition. Same lifetime as a `runScript` call.
- `slot.release` (instant) — fired on lock release.
- `slot.recycle` (cat=`slot`, instant) — fired when the slot recycles its pwsh process (every N calls).
- `pwsh-session.create` (cat=`pwsh,session`) — wraps the spawn + bootstrap of a new pwsh process. `args: { sessionId }`.
- `pwsh-session.first-command` (cat=`pwsh,session`, instant) — fires once per session, on the first script that hits it. Lets us see "cold first-call" cost directly.
- `pwsh-session.reuse` (cat=`pwsh,session`, instant) — every subsequent script. `args: { sessionId, invocationCounter }`.
- `pwsh-session.reset` (cat=`pwsh,session`, instant) — if the session is killed/respawned mid-bench.

### Per-cmdlet (pwsh side)

- `Get-BcContainerAppInfo`, `Unpublish-BcContainerApp`, `Publish-BcContainerApp`, `Invoke-ScriptInBcContainer`, `Run-TestsInBcContainer` (cat=`bcch`, `tid=<container>-pwsh`).
- Wrap inside the existing scripts via `CG-Trace -name ...`.

### Async

- `soap-call` (cat=`soap`, `tid=soap-<container>`) — HTTP request. Begin on `fetch`, end on response. `args: { url, codeunit, httpStatus, totalTests }`.

### Instants

- `infra-retry-fired`, `soap-fallback-to-legacy`, `slot-recycled`, `harness-republished` — point events to mark interesting transitions.

### Metadata events

Emit at startup:

```json
{ "name": "process_name", "ph": "M", "pid": 0, "args": { "name": "centralgauge-bench" } }
{ "name": "thread_name", "ph": "M", "pid": 0, "tid": "Cronus281", "args": { "name": "Cronus281 (slot)" } }
{ "name": "thread_name", "ph": "M", "pid": 0, "tid": "Cronus281-pwsh", "args": { "name": "Cronus281 (pwsh cmdlets)" } }
```

So Perfetto labels lanes nicely.

## Performance budget

Tracer must not perturb the thing it measures.

- Off (no `CENTRALGAUGE_TRACE_FILE`): zero allocations, zero clock reads in the hot path. Tested by spot-asserting `tracer.span` returns the original function without wrapping when disabled.
- On: ~1 µs per `span()` host-side, ~10 µs per `CG-Trace` pwsh-side (PowerShell `Stopwatch` + `ConvertTo-Json`). For a bench of 60 tasks × ~20 wrapped cmdlets = ~1200 events / bench → trivial.
- Output: ~250 bytes/event. 1200 events = ~300 KB. Bench-level trace stays under 1 MB unbatched. No streaming/compression needed for now.
- The buffer flushes to disk every 1 s OR every 1000 events OR on close. Reasonable for the bench's pace.

## Failure modes

- **Body throws inside `CG-Trace`** → original exception propagates unchanged (re-thrown from the `catch`); trace event still emitted on `finally` with `ok=false` + `errorType` + redacted `errorMessage`.
- **Trace emission throws inside `finally`** → caught + written to stderr as `[TRACE-EMIT-ERROR] ...`; original body exception still propagates. Trace emission MUST NEVER mask the body's exception.
- **PowerShell `Write-Output` would corrupt the pipeline** → forbidden in the helper. Use `[Console]::Out.WriteLine` so the wrapped command's return value flows through unmodified.
- **Script crashes pwsh before any `[TRACE]` line** → host-side `runScriptThroughSession` emits a synthetic `pwsh-session.reset` instant + `script-crash` instant with `args: { exitCode, scriptLabel }`.
- **Malformed `[TRACE]` line** (truncated JSON, non-UTF8, line happens to start with `[TRACE]` from a model that wrote it) → parser MUST strictly accept only lines matching `/^\[TRACE\] \{/`. JSON parse failures are emitted as `trace-parse-error` instants with `args: { reason, sample }` (sample capped 200 chars); bench continues.
- **Bench killed mid-run (SIGINT)** → tracer's signal handler attempts to flush the in-memory buffer to disk. Best-effort on Windows (SIGINT semantics differ from Unix). Periodic flushes (1 s or 1000 events) make sure the on-disk file is always valid Chrome Trace JSON regardless. Hard `taskkill` may lose buffered tail since the last flush.
- **Trace file disk write fails** → log warning once, set `tracer.enabled=false` for the rest of the run, continue. Never abort the bench.
- **Args contain credentials / generated code / error blobs** → mandatory redaction: every string arg goes through `redactSensitive()` (already in `src/container/`) and is capped at 200 chars. Non-string args (numbers, booleans) pass through.
- **Non-serializable args** (circular ref, BigInt, Function) → `JSON.stringify` fails → trace event is emitted with `args: { _serializationFailed: true }` placeholder; warning emitted once.
- **Negative or huge `ts`** (clock jump, wrong env origin) → kept as-is in the trace (do NOT silently clamp); a `trace-clock-anomaly` instant is emitted with `args: { observedTs, expectedRangeMicros }` so the time-base bug is visible in the viewer rather than papered over.
- **Two benches share `CG_TRACE_BENCH_START_UNIX_MICROS` env** (only happens with weird forks) → trace will have non-zero base; viewer still works but lanes may appear offset.
- **Trace overhead becomes measurable** → reduce wrapped-cmdlet list. If pwsh-side `CG-Trace` overhead is >5% of any span, drop wrapping for that cmdlet.

## CLI surface

New flags on `centralgauge bench`:

```
--trace                       # enable tracing; default output path = $output_dir/trace.json
--trace-file <path>           # override output path (implies --trace)
--trace-journal <path>        # ALSO write NDJSON journal alongside (debug-only; not the drag-drop artifact)
--no-trace                    # disable even if CENTRALGAUGE_TRACE_FILE is set
```

Env var precedence (highest first):
1. CLI flags (`--no-trace` > `--trace-file` > `--trace`)
2. `CENTRALGAUGE_TRACE_FILE` — explicit path, also enables tracing
3. unset → disabled

A new subcommand for convenience:

```
centralgauge trace open <file>
```

Prints the file path and a clickable line:

```
Drag-drop into https://ui.perfetto.dev or run:
  start https://ui.perfetto.dev
```

(No bundled viewer. Perfetto's online viewer is officially supported and runs offline once cached.)

## Testing plan

Unit tests in `tests/unit/tracing/`:

1. `tracer.test.ts`:
   - off-by-default: `tracer.span` runs body and returns its value without writing.
   - basic span: emits one `X` event with `name`, `ts`, `dur`, `tid`, `args`.
   - span throws: emits the `X` event AND propagates the throw.
   - async begin/end: matched IDs, correct phase letters.
   - signal handler: SIGINT flush emits all buffered events.
   - parser: `[TRACE]` line extraction from script output handles JSON with embedded quotes.
2. `pwsh-helper.test.ts`:
   - bash-driven test that runs a tiny pwsh script with `CG-Trace`, asserts the `[TRACE]` line shape on stdout.
3. Integration test (Windows-only, opt-in): run `cleanupStaleCandidates` against Cronus281 with tracer enabled, assert the trace file contains the expected span hierarchy (`task → cleanup → runScriptThroughSession → Get-BcContainerAppInfo`).

## Roll-out

Two-phase ship inside this conversation:

**Phase A (minimal): host-side tracer + critical TS spans.**
- `src/tracing/tracer.ts` — full impl with the off-by-default contract documented above.
- Spans: `bench`, `bench.setup`, `bench.teardown`, `task`, `llm-request`, `compile`, `prereq-publish`, `cleanup`, `publish-app`, `container-slot-wait`, `pwsh-session-wait`, `runScriptThroughSession`, `test.soap.total`, `test.soap.http`, `test.soap.parse`, `test.legacy.total`, `test.legacy.run-tests-in-bc-container`, `test.legacy.parse`.
- Slot lifecycle: `slot.create` / `slot.acquire` / `slot.release` / `slot.recycle` + `pwsh-session.create` / `first-command` / `reuse` / `reset` instants.
- Instants: `soap-fallback-to-legacy`, `infra-retry-fired`, `script-crash`, `trace-parse-error`, `trace-clock-anomaly`.
- One unit test file `tests/unit/tracing/tracer.test.ts`.
- Wire `--trace` / `--trace-file` / `--no-trace` CLI flags.
- Re-run mini bench with `--trace`; drop `trace.json` into ui.perfetto.dev.

Phase A alone exposes: container-slot-wait vs pwsh-session-wait vs script-execution time vs SOAP-fetch vs legacy-cmdlet time, plus slot warm/cold state.

**Phase B: pwsh-side `CG-Trace` + cmdlet wrapping.**
- Inject the helper (only when tracing enabled) into `buildCleanupStaleCandidatesScript`, `publishApp` script, `buildTestScript`.
- Wrap `Get-BcContainerAppInfo`, `Unpublish-BcContainerApp`, `Publish-BcContainerApp`, `Invoke-ScriptInBcContainer` (outer), `Run-TestsInBcContainer`.
- Parser `src/tracing/parse-trace-lines.ts` extracts `[TRACE]` lines from script stdout. Strict `/^\[TRACE\] \{/` regex; parse failures emit `trace-parse-error` instants.
- Unit test for the parser.
- Re-run; per-cmdlet sub-lane bars appear under each container's pwsh sub-lane.

If Phase A's data already pinpoints the bottleneck, Phase B may be skipped or scoped down.

## Decisions made (moved out of "open questions" after gpt-5.5 review)

| Question | Decision |
| -------- | -------- |
| Trace artifact format | Default: single valid Chrome Trace JSON document (`{ "traceEvents": [...] }`). NDJSON exists only as optional `--trace-journal` debug output. |
| pid/tid type | Numeric. Tracer maps lane names to numeric ids and emits `M/thread_name` metadata for friendly labels. |
| Time origin | Two origins captured at tracer init: `originPerfMicros` (TS monotonic from `performance.now()`) and `originUnixMicros` (wall-clock from `Date.now()`). PowerShell receives the env var `CG_TRACE_BENCH_START_UNIX_MICROS = originUnixMicros` only. |
| Redaction | Mandatory. All free-form string args go through `redactSensitive` + 200-char cap before emission. |
| PowerShell emission channel | `[Console]::Out.WriteLine` — NEVER `Write-Output`. Preserves the wrapped command's success-stream return value. |
| Off-mode pwsh helper | TS does NOT inject `CG-Trace` into BCH scripts at all when tracing is disabled. Scripts are byte-identical to current production. |
| Periodic flush format | Each flush rewrites the full valid Chrome Trace JSON file atomically (`writeTextFile(tmp); rename(tmp, final)`). On-disk file always valid mid-run. |

## Open questions (still undecided)

1. Per-LLM-token streaming events (each chunk as an instant)? Useful for slow-model debugging but ~10× the event volume. **Tentative: default off**, behind `CG_TRACE_LLM_STREAM=1`.
2. SQLite/Perfetto-proto output for offline queries? **Defer** — JSON is enough now; `perfetto_trace_processor` can convert later.
3. Auto-open ui.perfetto.dev when `--trace --open` is passed? **Tentative: no** in v1. `centralgauge trace open <file>` is a separate explicit step.
4. Should `slot.acquire` / `pwsh-session-wait` be the SAME span (since the slot's lock acquisition IS the session wait) or separate? Currently spec'd as separate. May collapse to one after Phase A reveals which view is more useful.
5. Should the SOAP HTTP call be on its own async lane (`tid=soap-<container>`) or inline on the container's slot lane? Currently spec'd as the latter (inline); revisit if SOAP overlaps interestingly with other operations.

## File layout

```
src/tracing/
  tracer.ts            # main module
  pwsh-trace-helper.ps1  # raw text injected into BCH scripts
  parse-trace-lines.ts # extracts [TRACE] from script stdout
tests/unit/tracing/
  tracer.test.ts
  parse-trace-lines.test.ts
docs/superpowers/specs/
  2026-05-15-bench-tracing.md  # this file
```

## Done-criteria

**Phase A:**

- [ ] `--trace` (no path) produces `$output_dir/trace.json` as a single valid Chrome Trace JSON document (`{ "traceEvents": [...] }`).
- [ ] `--trace-file <path>` writes to the explicit path; periodic atomic rewrites keep the on-disk file valid mid-run.
- [ ] Drag-drop into [ui.perfetto.dev](https://ui.perfetto.dev) renders a multi-lane timeline with named lanes (`orchestrator`, `Cronus281 (slot)`, `Cronus281 (pwsh cmdlets)`, …).
- [ ] `task` spans appear with correct nesting of `llm-request` / `compile` / `cleanup` / `publish-app` / `test.*` children.
- [ ] `container-slot-wait` and `pwsh-session-wait` spans are visible and answer "is queue or session contention the bottleneck?".
- [ ] `slot.create` / `slot.acquire` / `slot.recycle` + `pwsh-session.first-command` / `reuse` instants visible, answering "is the slot warm?".
- [ ] `soap-fallback-to-legacy` instants present whenever a fallback occurs.
- [ ] `--no-trace` (or env unset) produces zero trace file, zero `[TRACE]` lines on stdout, zero `tracer.*` clock reads.
- [ ] Phase A unit test `tests/unit/tracing/tracer.test.ts` covers: off-by-default contract, complete `X` spans, begin/end pairs, async begin/end, instant events, span throws still emits with `ok=false`, periodic flush produces valid Chrome JSON, signal-handler flush is best-effort.
- [ ] `deno task test:unit` green.

**Phase B:**

- [ ] When tracing enabled, BCH scripts inject the `CG-Trace` helper before any wrapped cmdlet.
- [ ] When tracing disabled, BCH scripts are byte-identical to current production (verified by snapshot test of script output).
- [ ] PowerShell helper uses `[Console]::Out.WriteLine` — wrapped cmdlets' return values are preserved exactly (verified by Windows-only integration test running `$apps = CG-Trace ... { Get-BcContainerAppInfo }` and asserting `$apps` is an array of app-info objects, NOT mixed with strings).
- [ ] Per-cmdlet sub-lane bars appear in Perfetto for `Get-BcContainerAppInfo`, `Unpublish-BcContainerApp`, `Publish-BcContainerApp`, `Run-TestsInBcContainer`.
- [ ] Body exceptions propagate unchanged through the helper (verified by unit test of the pwsh function).
- [ ] Parser `tests/unit/tracing/parse-trace-lines.test.ts` covers: strict `[TRACE] {...}` matching, JSON parse failure → instant event, multiple events per script invocation, interleaved with normal stdout.
- [ ] `deno task test:unit` green.
