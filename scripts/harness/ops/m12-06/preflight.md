# M12-06 preflight (lane-ops, run 001, 2026-11-17T23:20Z to 2026-11-18T01:25Z)

Plan: `docs/superpowers/plans/2026-11-17-harness-v2-m12-campaign.md` section "Task M12-06" (master fe8c3ab1).
Decisions: `decisions/2026-11-17-egress-grant-m12.md` (BC egress), `decisions/2026-11-18-m12-concurrency-and-sandbox-egress.md` (sandbox egress, D-4), `decisions/2026-11-17-wuauserv-lineage-v3.md` (D-5 (c)), `decisions/2026-11-18-m12-credential-limit-and-pool.md` (limit 5,000, D-3).
Evidence files: `H:\cg-coord\tasks\M12-06\` (`preflight-containers.ps1` and `.log`, `identity.ts`, `egress-verify.txt`).

Summary: every step is `[OK]`. Three steps carry plan-text deviations that the orchestrator ruled on (2026-11-18): Step 2 (image tag), Step 3 (satisfied by M12-09) and Step 4 (lineage v3).

## Deviations (orchestrator rulings 2026-11-18)

1. **Step 2, image tag.** The plan names `2.1.282-r3`, but no image with that tag exists. The r3 build is `centralgauge/harness-claude-code:2.1.302-r3` (alias `latest-r3`), as recorded in `m9\gates.md:100` and `m9\gate1\evidence-r3.md` (version ruling `decisions\2026-10-17-r3-claude-code-2.1.302.md`).
2. **Step 3, model check.** `models anthropic/claude-sonnet-5 --check` needs an API key. Harness cells use the subscription secrets directories instead, so there is no key-backed check. Step 3 is satisfied by the M12-09 smoke run.
3. **Step 4, lineage.** The plan names `golden-o09-v2` and `2552e6986e78`. D-5 option (c) moved the pool to `golden-o09-v3` (`b9ba30b0855c`), as H-112 and H-112b record.
4. **Credential-run limit.** The plan does not mention it. At this preflight the ledger had 1,898 lines against the old limit of 3,000, short of what M12 needs. The owner raised the limit to 5,000 (decision above), and H-115 is merged at master 76c5589b. The campaign checkout was moved to 76c5589b after Steps 2 to 10 had been measured. The diff from fe8c3ab1 touches only `src/harness/credential-budget.ts` and two unit tests, so no other step is affected.

## Step 1: Run checkout [OK]

`git worktree add --detach H:\cg-coord\jobs\M12-run fe8c3ab1`, then `git switch --detach 76c5589b` after H-115 merged. `deno install` was needed in the fresh checkout. `deno.lock` and `node_modules` are gitignored, so the tree stays clean.

```
76c5589b
dirty=0
tasks=43 missing=0 diff-lines=0          # git diff 2fb244fe HEAD -- harness-tasks/refapp + harness-tasks/tasks/<43 ids>
d7f54648bb2fd4ed957d125abbe1c46664c937ac  # harness-v2-prereg-a == 2026-10-17-harness-v2-prereg-a.md tag_object
e2d80245d7317cc63af31e15ed80aab918702911  # harness-v2-prereg-b == 2026-11-17-harness-v2-prereg-b.md tag_object
export const CREDENTIAL_RUN_LIMIT = 5000;
```

The 43 ids are the `confirmatory` and `held_out` entries of the freeze record `task-set.json` (n 39 + 4).

## Step 2: Image [OK, deviation 1]

```
docker image inspect centralgauge/harness-claude-code:2.1.302-r3 --format '{{.Id}} {{revision}} {{lsp.al}}'
sha256:0a8746462fc8d62f2ea104d844b5fb43b2c9e12080608b81ab5e94ddfaf46f36 3 al-lsp@2 3be4e87b7ec98506b295f2ead137ba14cc754057ffbc539286d9b74a9b0dcb28
(latest-r3: same id and labels)
```

The id equals the M9-17 record (`m9\gates.md:100`). Arm configs:

```
cc-v2-plain         | harness_version: "latest" | image_revision: "3" | main: anthropic/claude-sonnet-5
cc-v2-plain-lsp     | harness_version: "latest" | image_revision: "3" | main: anthropic/claude-sonnet-5
cc-v2-realistic     | harness_version: "latest" | image_revision: "3" | main: anthropic/claude-sonnet-5
cc-v2-realistic-lsp | harness_version: "latest" | image_revision: "3" | main: anthropic/claude-sonnet-5
```

The M12-08 dry run must show all four arms resolving to `0a874646...`.

## Step 3: Model [satisfied by M12-09, deviation 2]

```
[MCP] Warning: No credentials found in environment. Using defaults.
   [DENIED] anthropic/claude-sonnet-5 (3ms)
Summary: 0 accessible, 1 denied out of 1 checked
```

The checkout has no API key. Inspecting `.env` is blocked by the safety hook, and no workaround was attempted.

## Step 4: Lineage and baselines [OK, deviation 3]

No bench live: neither `results\.bench-running.json` (campaign checkout, main checkout) is younger than 2 min.

```
deno task start harness env check --lineage 'infra\harness-reset\lineages\golden-o09-v3.json' --containers 'Cronus281,Cronus282,Cronus283' --symbol-store 'H:\cg-coord\jobs\M8-16a\results\harness\symbols' --results-dir 'H:\cg-coord\results\harness' --unverified-bc-egress-ok '<BC grant text>'
environment: lineage golden-o09-v3
  [OK] Cronus281 env_fp b9ba30b0855c (baseline 2026-11-17T22:26:05.194Z)
  [OK] Cronus282 env_fp b9ba30b0855c (baseline 2026-11-17T22:29:33.390Z)
  [OK] Cronus283 env_fp b9ba30b0855c (baseline 2026-11-17T22:31:30.670Z)
  [WARN] NST egress NOT enforced (--unverified-bc-egress-ok): owner grant decisions/2026-11-17-egress-grant-m12.md: M12 setup, smoke and confirmatory campaign, no ingest, NST egress unenforced in golden-o09-v3 (disclosed)
rc 0 (2026-11-18T01:19:35Z)
```

There is one admissible env_fp. `H:\cg-coord\harness-quarantine` holds 0 records for Cronus281-283. The D-4 pool is all three of Cronus281-283, so there is no spare left to check.

## Step 5: Compiler identity [OK]

The DLL path is the M11-17b / H-100 one:
`C:\ProgramData\BcContainerHelper-Cronus<N>\compiler\CentralGauge-Cronus<N>\compiler\extension\bin\win32\Microsoft.Dynamics.Nav.CodeAnalysis.dll`.
`lineage.backend` in `al-lsp.json` reads `{"version":"17.0.40.3339","sha256":"5fbb36d53974f301ae9cc13a0da35829ca726facb702a36b681f75766a697ce9"}`.

```
Cronus281 5fbb36d53974f301ae9cc13a0da35829ca726facb702a36b681f75766a697ce9
Cronus282 5fbb36d53974f301ae9cc13a0da35829ca726facb702a36b681f75766a697ce9   (recreated 2026-11-17, checked again)
Cronus283 5fbb36d53974f301ae9cc13a0da35829ca726facb702a36b681f75766a697ce9
markers (all three): https://bcartifacts-exdbf9fwegejdqak.b02.azurefd.net/sandbox/28.4.53241.53758/dk | 6.1.14 | 15ff3c5d109b
```

Identity comes from `identity.ts` (`BcContainerProvider.harnessCompilerIdentity` from the campaign checkout's source):

```
Cronus281	https://bcartifacts-exdbf9fwegejdqak.b02.azurefd.net/sandbox/28.4.53241.53758/dk|bccontainerhelper 6.1.14
Cronus282	https://bcartifacts-exdbf9fwegejdqak.b02.azurefd.net/sandbox/28.4.53241.53758/dk|bccontainerhelper 6.1.14
Cronus283	https://bcartifacts-exdbf9fwegejdqak.b02.azurefd.net/sandbox/28.4.53241.53758/dk|bccontainerhelper 6.1.14
```

All three equal the pre-registered `compiler_identity`.

## Step 6: Accounts [OK; D-3 is set in the decision file, M12-08 fixes it in the launch kit]

The preflight found these candidate labels (directory names only; no value was read or printed):

```
secrets           exists=True replace_me_files=0   -> label max
secrets-MaxPriv2  exists=True replace_me_files=0   -> label maxpriv2
secrets-MaxPriv   exists=True replace_me_files=0   -> label maxpriv
secrets-Work      exists (excluded: Work account, never in the pool)
(no MAXWork directory)
```

The D-3 pool (owner, 2026-11-18T00:50Z) is `max`, `maxpriv` and `maxpriv2`, with no `work` and no reserve label on resume.

Ledger state:

```
ledger writable=True (append-open test)
ledger lines=1898; last line 2026-11-14T14:36:13.550Z lane ops task HX-168 (no reservation in flight;
the ledger lock is an OS lock held only for the duration of one append)
limit 5000 (H-115, 76c5589b) -> 3102 left; M12 needs about 1,575 (decision file)
```

The owner is to be asked for the current usage headroom of each label. The lane does not read it, and the orchestrator holds this question.

## Step 7: Leases and holders [OK]

```
Cronus281 holder: null
Cronus282 holder: null
Cronus283 holder: null
coord doctor: [OK] no issues
allocation.json: "harness-bench-2026-10": Cronus28, Cronus281, Cronus282, Cronus283, Cronus284, Cronus285
bch-roots.json: {"migrated": ["Cronus285", "Cronus281", "Cronus283", "Cronus282"]}
```

The holders were checked before the preflight's own leases were taken, and those leases were released at the end (log).

## Step 8: RAM and disk [OK]

Starts were made under ops leases, each only at 18 GB free or more (`preflight-containers.log`):

```
Cronus282 start, free before 49.5 GB -> up, free 45.1 GB
Cronus281 start, free before 45.0 GB -> up, free 41.5 GB
Cronus283 start, free before 41.5 GB -> up, free 33.6 GB (60 s after up)
all three up: 33.6 GB free (>= 14 GB after the last start; >= 18 GB at each start)
after stop: 49.4 GB free
```

These readings were taken with the owner's desktop as it was at 01:19Z. They are not a measurement of the run-time budget, which M12-09 Step 7b measures.

Disk:

```
docker root: C:\ProgramData\Docker  -> drive C: free 238.6 GB (>= 100)
H: free 1,070.6 GB (>= 200)
```

## Step 9: Watchers [OK]

`H:\cg-coord\daemons.tsv` at 2026-11-17T23:45Z: every registered pid was alive.

```
53448  memlog.ps1    ops           alive
63100  poollog.ps1   orchestrator  alive (max 48 h from 2026-11-16T12:44Z)
51032  hostwatch.ps1 ops           alive; jobs\W2-10\hostwatch\heartbeat age 60 s (< 180)
```

Kernel pool start value (2026-11-17T23:46Z, `pooltags2.ps1`): nonpaged 6.82 GB, paged 8.79 GB. Top tags:

```
Tag     NPMB   NPOut     PMB    POut
cxbm 2086,60   81920    0,00       0
FMfn    0,00      11 1627,60 3541704
NtfF    0,00       0  819,20  516229
MmSt    0,00       0  753,60  668129
File  750,00 1966735    0,00       0
Ntff    0,00      36  551,10  410417
```

`hostwatch-dry-test.ps1 -SkipChurn`: `pass 127 fail 0`, rc 0.

## Step 10: Egress [OK: consistent with D-2]

`deno task start harness egress verify` exits rc 1. The full output (262 lines) is in `egress-verify.txt`:

```
[FAIL] network cg-harness-sandbox is missing
[FAIL] hns network behind cg-harness-sandbox is not the internal network of the plan
[FAIL] gateway adapter prefix does not match the sandbox subnet
[FAIL] extra rule cg-harness-egress-tcp in cg-harness-egress
[FAIL] extra rule cg-harness-egress-proto-0 .. -255 in cg-harness-egress   (256 lines)
[FAIL] foreign block rule is effective: Unity 6000.6.9f1 Editor [{B3943646-D5E3-4FCF-AF60-E325512AC938}, Inbound, PersistentStore]
```

Enforced egress is not in place, which matches D-2. Both sides run unverified: the BC side under `--unverified-bc-egress-ok` and `decisions/2026-11-17-egress-grant-m12.md`, the sandbox side under `--unverified-egress-ok` and `decisions/2026-11-18-m12-concurrency-and-sandbox-egress.md`, and both are disclosed. The Unity inbound block rule belongs to the owner and is left alone.

## Note for M12-08 (launch kit): container readiness probe

Containers logged "Ready for connections!" about 25 s after `docker start`. Even so, a long-lived pwsh process probing `http://<c>/BC/?tenant=default` with `Invoke-WebRequest` twice saw nothing from Cronus282 for 30 minutes, and later saw nothing from Cronus281 for 10 minutes. Over the same periods, a fresh process got `302` at once. Cronus283, probed with `curl.exe` from a long-lived process, took about 10 minutes to be seen. The cause is not established: the hosts-file entries were correct when checked. The working pattern was to probe from a fresh process. The launch kit's start step should not treat a stalled in-process probe as a container fault before it has checked from a fresh process.
