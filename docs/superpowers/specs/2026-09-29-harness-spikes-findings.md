# Harness Bench M0 spike findings (2026-09-29)

Plan: `docs/superpowers/plans/2026-09-24-harness-bench-spike.md`. Spec: `2026-09-24-harness-bench-design.md` (1a).
All runs 2026-09-25 on Cronus28 (BC 28.4.53241.53758). Logs and results under `H:\Temp3\harness-spike\`; orchestrator
decisions under `H:\cg-coord\decisions\`; reviews under `H:\cg-coord\reviews\`.

## 1. Multi-app timing (Task 2, M0-02)

Script `scripts/spikes/harness/multiapp-timing.ts` (commit 93d72595). Raw JSON
`H:\Temp3\harness-spike\multiapp-2026-09-25T12-09-21-334Z.json`, log `M0-02-run3.log`, summary `M0-02-results.md`.
3 runs per set, all 6 runs succeed; every run starts with `prenukeCentralGaugeApps` and no run hit "same App ID and Version".

Median per app, 7-app set (ms):

| App | compile | publish |
| --- | --- | --- |
| Core | 3548 | 6380 |
| Fleet | 3712 | 6381 |
| Rental | 4215 | 6172 |
| Leasing | 4310 | 6196 |
| Integration | 4459 | 6177 |
| Reporting | 4457 | 6166 |
| Test | 4358 | 6256 |

- 3-app total (compile + publish): 35.2 / 29.7 / 30.0 s, median 30.0 s.
- 7-app total incl. test: 75.1 / 73.2 / 72.7 s, median 73.2 s.
- Test execution (SOAP runner, 5 tests): 117 / 89 / 154 ms, 5/5 passed in every 7-app run.
- Ratio 7-app / single-candidate `prepare-candidate` span (14.6 s): 73.2 / 14.6 = 5.0x.
- Publish is ~60% of the 7-app time, compile ~40%. Each app compiles against the earlier apps' `.app` files copied
  into `.alpackages` (no symbol download).
- First Core compile + publish of a session: 8.4 s + 15.1 s (`M0-02-run1.log`), warm-up.

Caveats (review `H:\cg-coord\reviews\M0-02-001\review-gpt56sol.md`, decision `2026-09-25-accept-M0-02.md`):
publish is `publishApp` (BCH wrapper, serial), not the dev-endpoint path of `prepareCandidateApp`; test time is direct
`runTestsViaSoap`, not the full `runTests()` lifecycle; totals are operation sums, not wall time, and exclude prenuke,
staging, dependency copying and cleanup. The 5.0x ratio is not a production scaling factor. The 14.6 s denominator is
from CLAUDE.md, not this JSON.

## 2. Dependency graph (Tasks 1-2, M0-01, M0-01a, M0-02)

- Graph as committed (`harness-tasks/refapp/*/app.json`): Core; Fleet, Integration, Leasing -> Core;
  Rental -> Core, Fleet; Reporting -> Rental, Leasing, Fleet; Test -> all six + Library Assert. All 7 apps compile and
  publish in dependency order (`M0-02-run1c.log`, raw JSON above).
- Change 1, test codeunit: the skeleton test codeunit lacked `TestPermissions = Disabled`; 3 of 5 tests failed with
  "Sorry, the current permissions prevented the action. (TableData 70100 CGR Vehicle Insert: CGR Test)"
  (`M0-02-run1c.log`). Fixed by M0-01a (commit a9d17cba, integrated c00255d2, decision `2026-09-25-accept-M0-01a.md`),
  then 5/5 (`M0-02-run1d.log`).
- Change 2, test path: `provider.runTests()` cannot run the multi-app Test app. It publishes through
  `prepareCandidateApp`, whose cleanup uninstalls and unpublishes every app with Publisher "CentralGauge" whose Name is
  not like `*Prereq*`. For the refapp that removes all six CGR apps Test depends on, and the Test publish fails with
  "Candidate publish failed (unclassified)" (`M0-02-run1.log`). The spike publishes Test with `publishApp` and calls
  `runTestsViaSoap` directly.
- `BcContainerProvider` defaults to admin/admin unless `setCredentials()` is called; the spike sets them explicitly.
- id audit: follow-up for M1, `id-audit` has no band rule for `harness-tasks/` (decision `2026-09-25-accept-M0-01.md`).
  Manual check on the merge tree: 5-digit numbers only 70000-70599, 80000-80099 and the km literal 15000.

## 3. Harness capture (Task 3, M0-03)

Results `M0-03-results.md`, build log `build-M0-03.log`, commit cee3b656, decision `2026-09-25-accept-M0-03.md`.

- Image `centralgauge/harness-spike:windows`: claude 2.1.282, pi 0.87.1, node v22.19.0. Deviation: node 22.19.0, not
  the planned 22.12.0 (pi 0.87.1 engines require >= 22.19.0).
- Claude smoke: model claude-sonnet-5, exit 0, 11.5 s wall, `hello.txt` created, final `type:result` success,
  init `apiKeySource: "none"` (OAuth token path), reported cost 0.0489 USD.
  Log `claude-2026-09-25T11-38-38-342Z.jsonl`.
- pi smoke: openrouter `google/gemini-3.8-flash`, exit 0, 10.9 s wall, `hello.txt` created, ends `type:agent_settled`,
  OpenRouter spend ~0.0012 USD. Log `pi-2026-09-25T11-38-57-140Z.jsonl`.
- Hard kill (`--kill-after-s 25`, long.md): both exit -1 (docker kill). Both `.jsonl` files end in a complete JSON line:
  claude 19 lines, last type `user`, 5 files written (`claude-2026-09-25T11-39-16-130Z.jsonl`); pi 73 lines, last type
  `tool_execution_update`, 0 files written (`pi-2026-09-25T11-39-41-637Z.jsonl`). pi spent the 25 s exploring its
  environment (`set | grep PI_`, grepping its own install docs).
- Orphan check: `docker ps -a --filter name=cg-harness-spike` empty after the kill runs.
- Secret scan: neither secret value appears in any captured `.jsonl` or `.stderr.txt`.
- Review round 1 rejected (pi API key in argv, container removal not guaranteed for pre-`try` errors or a killed
  runner); round 2 accepted with carryover because both are the plan's own prescribed code
  (`H:\cg-coord\reviews\M0-03-001\review-gpt56sol*.md`). Carryover in section 8. The results do not record a pre-run
  bench-live check.

## 4. Log shapes (Task 4, M0-04)

Source: corrected table `H:\cg-coord\tasks\M0-04\runs\002\notes.md` (supersedes `M0-04-results.md`), commit 765e4c46,
decision `2026-09-25-accept-M0-04.md`. Raw logs `claude-2026-09-25T12-00-22-223Z.jsonl`,
`pi-2026-09-25T12-01-21-101Z.jsonl`; fixtures `tests/fixtures/harness/claude-code/probe.jsonl`,
`tests/fixtures/harness/pi/probe.jsonl`. Both runs exit 0, all 5 probe steps answered.

Commands: Claude `claude -p <prompt> --output-format stream-json --verbose --model claude-sonnet-5
--dangerously-skip-permissions --mcp-config C:\workspace\mcp.json` (token exported as `CLAUDE_CODE_OAUTH_TOKEN`);
pi `pi --mode json --no-session -a --provider openrouter --model google/gemini-3.8-flash --api-key <key> <prompt>`.

| | Claude Code 2.1.282 | pi 0.87.1 |
| --- | --- | --- |
| Tool call | `assistant.message.content[]` `{type:"tool_use", id, name, input}`, one record per call | Count from `tool_execution_start {toolCallId, toolName, args}` only; the call repeats in `message_update` `toolcall_end`, `message_end`, `turn_end`, `agent_end` |
| Tool error | `user.message.content[]` `{type:"tool_result", tool_use_id, is_error:true, content}` | `tool_execution_end` `isError: true`, `result` holds output |
| Skill invocation | Yes, `tool_use` name `Skill`; `system/init.skills` lists project skills | No dedicated event; seen as `read` of `.pi\skills\fleet-notes\SKILL.md` |
| MCP call | Yes, `tool_use` name `mcp__al-tools__al_compile`; `system/init.mcp_servers` status `connected` | No native MCP in pi 0.87.1; tools only via extensions (`pi.registerTool()`, `docs/extensions.md`); package copy `H:\Temp3\harness-spike\pi-0.87.1-pkg\` |
| Sub-agent | Yes, `tool_use` name `Agent`, inner records carry `parent_tool_use_id`; `system/task_*` records; `result.subagent_stats` | None (no sub-agent tool) |
| Retry / compaction | Not seen | Not seen (`agent_end.willRetry` false) |
| Usage keys, per message | `assistant.message.usage`: input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cache_creation{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}, service_tier, inference_geo | `message_end` `message.usage`: input, output, cacheRead, cacheWrite, totalTokens, cost{input, output, cacheRead, cacheWrite, total}, `reasoning` when present |
| Usage keys, final | `result.usage`: input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens_details{thinking_tokens}, server_tool_use{web_search_requests, web_fetch_requests}, service_tier, cache_creation{ephemeral_1h_input_tokens, ephemeral_5m_input_tokens}, inference_geo, iterations[]{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cache_creation{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}, type}, speed. Run totals on `result`: duration_ms, duration_api_ms, num_turns, total_cost_usd, stop_reason, terminal_reason; per model `result.modelUsage.<model>` incl. costUSD, costBasis | No run-level total; sum `message.usage` over assistant `message_end` only (`turn_end`, `agent_end` repeat and double count) |
| Cost reported | `result.total_cost_usd` (0.1288 in the probe) and `modelUsage.<model>.costUSD`, `costBasis: "list"` | Per message `message.usage.cost.total` (USD, pi's openrouter pricing); no run total |
| Project skills non-interactive | Yes | Yes with `-a` (`--approve`, trusts project-local resources, `docs/cli.md`) |
| Rate limit | `rate_limit_event.rate_limit_info` incl. `unifiedWindows.five_hour`, `seven_day` | None reported (OpenRouter) |
| Final record | `type:"result"` | `type:"agent_settled"` after `agent_end` |

- Not established by the fixture: that the OAuth token belongs to the Team account (rests on the secrets file), and
  whether `total_cost_usd` is billed.
- Team account reading at ~12:00Z: seven_day 0.79 (status `allowed_warning`, resets 2026-09-29 01:00Z), five_hour 0.08.
  Same seven_day 0.79 at 12:20Z (`M0-07-job.log`).
- The `system/task_progress` and `task_notification` `usage` (`total_tokens`, `tool_uses`, `duration_ms`) is sub-agent
  usage, not the run.

## 5. Backend round trip (Task 5, M0-05)

Results `M0-05-results.md`, logs `M0-05-client.log`, `M0-05-backend.log`, `M0-05-negative.log`, commit 7473fe49,
decision `2026-09-25-accept-M0-05.md`. Backend `scripts/spikes/harness/backend-spike.ts` on host :3200, workspace
`ws-cgal` (refapp Core), compiling on Cronus28. Token read in the sandbox from the read-only `C:\cg-secrets` mount.

| # | success | backendMs | compilerMs | clientMs |
| --- | --- | --- | --- | --- |
| 1 | true | 8304 | 8301 | 9533 |
| 2 | true | 4402 | 4400 | 5482 |
| 3 | true | 3456 | 3454 | 4347 |

- Median backendMs 4402, median clientMs 5482. Client overhead 891-1229 ms per call (shim PowerShell start,
  `Invoke-RestMethod`, `host.docker.internal` hop). First call pays compiler warm-up.
- Negative checks: no Authorization header 401; app `..\x` 400; app `C:\Windows` 400 (both rejected by the name
  allowlist before path resolution, so the containment branch is not exercised); wrong bearer token 401. Malformed JSON
  was not tested.
- The compiled `.app` is not written into the workspace; the sandbox sees only the JSON verdict.
- Backend token was passed on the backend's argv; backend bound `0.0.0.0`; `Date.now()` timing (review
  `H:\cg-coord\reviews\M0-05-001\review-gpt56sol.md`). Carryover in section 8.

## 6. AL Tools NuGet (Task 6, M0-06)

Results `M0-06-results.md`, logs `M0-06-core.log`, `M0-06-fleet.log`, `build-M0-06*.log`, commit 8af56b8f,
decision `2026-09-25-accept-M0-06.md`. Result: positive.

- Package `Microsoft.Dynamics.BusinessCentral.Development.Tools` 18.0.41.62505 (DotnetTool), command `al`, entry point
  `altool.dll`, targets net8.0 and net10.0. Also ships `almcp.dll` + `ModelContextProtocol.dll` (presence only, not run).
- Image `centralgauge/harness-spike-nuget:windows` (`scripts/spikes/harness/image/Dockerfile.nuget.windows`), .NET 8 in
  `C:\dotnet`. Deviation: `DOTNET_ROOT=C:\dotnet` is required; without it every `al` call fails in 0.03 s with
  "Failed to resolve hostfxr.dll [not found]. Error code: 0x80008083".
- Symbols: 263 apps, 400 MB, from `C:\ProgramData\BcContainerHelper\compiler-cache-15ff3c5d109b\symbols\` (BC
  28.4.53241.53758) copied into `<ws>\.alpackages`.
- Command: `al compile /project:C:\workspace\<App> /out:C:\workspace\<App>\out.app
  /packagecachepath:C:\workspace\.alpackages` in `docker run --rm --network none`.

| Compile | run 1 (s) | run 2 (s) | out.app |
| --- | --- | --- | --- |
| Core (5 files) | 9.43 | 8.39 | True |
| Fleet (4 files, against Core `out.app`) | 9.84 | 10.01 | True |

- Each run is a fresh container (includes .NET start and loading 400 MB of symbols). Backend path for comparison
  (section 5): 3.5-4.4 s warm, 8.3 s cold.
- The Dockerfile has no default for `AL_TOOLS_ID`/`AL_TOOLS_VERSION`; base image not digest-pinned; `-Channel 8.0` is
  not an exact version; no package hash recorded (review `H:\cg-coord\reviews\M0-06-001\review-gpt56sol.md`).

## 7. Classification (Task 7, M0-07)

Run 001 (commit eb3e8598) was rejected for missing blind-label evidence (`H:\cg-coord\reviews\M0-07-001\reject-reason.md`).
Run 002 (commit 27454f69, integrated 207545f6) is accepted (`H:\cg-coord\decisions\2026-09-25-accept-M0-07.md`).
Evidence `H:\Temp3\harness-spike\M0-07\`: `input-logs.txt` (10 raw logs), `calls.jsonl` (45 calls), `calls-blind.jsonl`
(index, harness, tool, input only), `labels-blind.csv`, `score.txt`, `rules-coverage.txt`, `M0-07-results.md`, run 001
evidence in `run001\` (incl. `laya.jsonl`).

- Extraction: Claude = assistant `message.content[]` `tool_use`; pi = `tool_execution_start` only.
- Labeling: a fresh subagent with no history read only `calls-blind.jsonl` (no rule category). The blind labels are
  identical to the run 001 labels on all 45 rows.
- Rules (`scripts/spikes/harness/classify-rules.ts`, scored by `score-calls.ts` against `labels-blind.csv`):

| Scope | Coverage | Accuracy on covered |
| --- | --- | --- |
| All | 27/45 | 27/27 |
| Claude Code | 13/27 | 13/13 |
| pi | 14/18 | 14/14 |

- Unclassified, Claude Code (14): Skill x3, Agent x3, ToolSearch x3, `cg-al --version` x3, PowerShell
  `Set-Content ...; Get-ChildItem` (label edit), PowerShell `(Get-ChildItem ...).Count` (label search).
  Unclassified, pi (4): `cg-al --version` x3, `set | grep PI_` (label other).
- Caveat: coverage differs by harness (13/27 vs 14/18), so M0 category totals must not be used to rank harness behavior.
  Skill use lands in different categories per harness (Claude `Skill` tool, pi `read` of a `SKILL.md` path).
- Laya: PyPI `laya` 0.3.20 (github.com/NandhaKishorM/laya), Python 3.13.14 venv `H:\Temp3\harness-spike\laya-venv`,
  torch 2.14.0+cpu. Checkpoint `Router()` default -> HF `convaiinnovations/laya` (ModernBERT-large, 421M, 512 ctx).
  Invocation `router.predict(json.dumps({"tool","command"}), {"category": {"type":"choice", "instructions": ...,
  "criteria": {<9 categories>}}})`, probability = `answers.category.probabilities[choice]`.
- Laya accuracy on the 18-call residue (run 001, labels identical to the blind labels): 11/18 overall; at p >= 0.8:
  3/10 correct; below 0.8 (would be `unclassified`): 8/18. `cg-al --version` -> compile at p 0.91-0.92 (all 6 wrong);
  `set | grep PI_` -> search at p 0.86 (wrong). Only 7 distinct inputs, so anecdotal.
- Laya latency (CPU, warm): median 159 ms, p95 185 ms.
- Decision: Laya cut (`H:\cg-coord\decisions\2026-09-25-cut-laya.md`, launch contract cut order item 1). Call
  categorization is rules only, post-hoc, secondary metric.
- CARRYOVER to M2 rule categorization (`accept-M0-07.md`): Skill, Agent, ToolSearch handling; `cg-al` version and
  unknown operations as `other`; parenthesized and compound PowerShell commands; cross-harness skill-use semantics
  (Claude `Skill` vs pi `SKILL.md` read); per-harness coverage and unclassified counts in the report; exact or
  token-aware MCP tool-part mappings (the run 001 review found `mcp__test-server__read_file` -> test, and MCP publish
  recognized while shell `cg-al publish` is not).

## 8. Decisions for M1 to M4

Plan decision rules:

- 7-app total > 10 min: does not fire (median 73.2 s, operation sum, section 1). M1 is not forced to publish only
  changed apps or to one execution per container by this rule.
- pi has no MCP: fires (section 4). MCP arms are Claude Code only for the talk; pi arms compare skills, instructions and
  models.
- A harness reports no cost: does not fire. Claude reports `result.total_cost_usd` with `costBasis: "list"`; pi reports
  per-message `usage.cost.total` with no run total. The spec's cost basis (estimated from tokens, `cost_source:
  estimated`, reported cost kept for cross-check) stands.
- NuGet compile fails offline: does not fire (section 6). The `toolchain` component is not deferred.
- Laya accuracy at p >= 0.8 below 90%: fires (3/10). M2 ships rules only and marks
  the residue `unclassified`; Laya is cut (`cut-laya.md`).

Spec assumptions confirmed or broken:

- Broken: `prepareCandidateApp` cleanup removes refapp dependency apps. The M1 verdict workspace must scope cleanup to
  candidate app ids (not rename apps to `*Prereq*`), define persistent prerequisite app ids, refresh stale prerequisite
  versions, and decide whether provisioning counts in verdict latency (`accept-M0-02.md`).
- Broken (fixed): refapp test codeunit needs `TestPermissions = Disabled` (M0-01a, c00255d2).
- Confirmed: acyclic 7-app graph incl. Rental -> Fleet compiles, publishes and tests 5/5.
- Confirmed: hard kill leaves a complete last JSON line for both harnesses; no orphan containers.
- Confirmed: pi loads project skills non-interactively with `-a`.
- Broken for pi: MCP is extension-only (`pi.registerTool()`), no native support.
- Rules only (M0-07 run 002, blind labels): coverage 27/45, accuracy 27/27; Claude Code 13/27, pi 14/18.
  Coverage differs by harness, so M0 category totals must not rank harnesses.
- Partly: skill invocation is a `Skill` tool_use in Claude; in pi only a `read` of a `SKILL.md` path.
- Not observed: retry and compaction records for either harness; fixtures lack them (carry to M2/M3 parser plans, with
  redactor coverage beyond exact secrets, `accept-M0-04.md`).
- Parser rules: pi counts calls from `tool_execution_start`, usage from assistant `message_end`; Claude must not sum
  repeated assistant chunk usage.
- Campaign sizing: Team account seven_day utilization 0.79 on 2026-09-25, resets 2026-09-29 01:00 UTC.
- Image: node 22.19.0 (pi 0.87.1 engines), not 22.12.0.
- Toolchain: AL Tools 18.0.41.62505 compiles offline; `DOTNET_ROOT=C:\dotnet` required. M3 carryover
  (`accept-M0-06.md`): symbols are a versioned input (proven only against BC 28.4.53241.53758); record BC build, symbol
  provenance, compiler version and hashes together; pin package version in the Dockerfile, digest-pin the base image,
  exact .NET version, package hash; probe `almcp.dll` before relying on it; mount a shared read-only symbol dir instead
  of copying 400 MB per workspace.
- Backend: compile dominates latency (backendMs vs compilerMs differ by 2-3 ms); `.app` is not handed back to the
  workspace, so an M1 backend that should return artifacts must copy them.
- Production sandbox, hard requirements (`accept-M0-03.md`): (a) no secret in any argv, pass via env or file;
  (b) runner creates the container and opens capture files inside `try`, checks `docker rm -f` exit status, and at
  startup removes leftover `cg-harness-*` containers it owns (prefix + label); (c) secrets not mounted into the
  agent-readable filesystem, or the threat model states why they must be.
- Production backend, hard requirements (`accept-M0-05.md`): per-sandbox short-lived scoped tokens read from a secret
  file, timing-safe compare of fixed-length digests; canonical path resolution, reparse-point escape refusal, opaque
  workspace ids mapped to approved roots, TOCTOU and resource limits; bind to a container-facing interface only,
  firewall or local authenticated proxy; malformed JSON returns 400; latency on a monotonic clock, separating process
  startup, transport, queue and compile.
- M1 metric rules (owner, `2026-09-25-m1-metric-rules.md`): cost per solved task = sum over tasks of per-task mean cost
  (every attempt counted) / sum of per-task pass rates, equal task weight; matched-pair exclusions; automatic infra-retry
  chain counts its final attempt, manual reruns never silently replace a scored result; CI suppressed when any bootstrap
  resample is undefined.
- id-audit has no band rule for `harness-tasks/` (M1 follow-up, `accept-M0-01.md`).
- Paid API spend to date USD 0.034 of a 150 cap (`spend.md`).
