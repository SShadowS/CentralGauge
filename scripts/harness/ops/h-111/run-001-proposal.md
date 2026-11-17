# H-111 run 001 proposal: Windows Update (wuauserv) and the L4 quarantine (lane ops)

2026-11-17. Proposal only: nothing was changed on any container, service, lineage, L4 rule or code. The owner
decides (L4 and guard changes are owner-only).

## 1. Measurements (Cronus281, read-only, ops lease attempt 224, 22:02-22:09Z)

`measure-wu.ps1` ran inside the container through `docker exec ... -EncodedCommand`, so nothing was copied in.
Output: `measure-281.txt`.

| Item | Value |
| --- | --- |
| wuauserv | start Manual, trigger start on GROUP POLICY (machine and user policy present); running 2 min after the container started (22:04:06Z) |
| UsoSvc (Update Orchestrator) | Auto (delayed start), no triggers; starts with the container and starts wuauserv |
| WaaSMedicSvc | Disabled, stopped; its PerformRemediation task is Disabled |
| TrustedInstaller (Modules Installer), BITS, DoSvc | Manual, stopped; TrustedInstaller runs about 2-3 min after most wuauserv starts |
| Update policy | `HKLM\...\WindowsUpdate\AU` AUOptions = 3 (download automatically, notify to install) |
| C:\Windows\Temp | the directory's last-write time is 2026-09-16T06:30:08Z (unchanged since the image); one file, silconfig.log, rewritten at each container start |
| C:\Windows\SoftwareDistribution | Download last written 2026-11-16T22:26Z, ReportingEvents.log 22:32Z (not an L4 root) |

wuauserv starts in the System log since 2026-11-14 (7036 "entered the running state"): 11-14 22:12Z, 11-15 22:12Z,
11-16 22:12Z, 11-17 06:22Z and 22:04Z (container start), plus the Update Orchestrator at every container start and
several times a day. That is at least one start a day, near 22:12Z, plus one per container start. In 2026-09 the
log also shows "The start type of the Windows Update service was changed from disabled to demand start" (09-16
06:10:51Z): something re-enabled a disabled wuauserv in the image's history.

On Cronus281 none of these starts moved `C:\Windows\Temp`'s own timestamp. On Cronus282 at 2026-11-17 02:53:59.87Z
one did (wuauserv entered running at 02:54:00Z): a file was created and removed there
(`H:\cg-coord\tasks\M8-21\ops\quarantine-282-20261117.md`). So a trip needs a wuauserv start that creates and
deletes a temp file, during a deployment's L4 window. It is rare (one trip in about 3 container-days of M8-21
qualify) but certain to recur over a multi-day campaign.

## 2. Trip mechanism

- The lineage `golden-o09-v2` declares `C:\Windows\Temp` as an L4 root (`fs.roots`).
- fs-digest captures each directory as `D|<attributes>|<last-write ticks>|<path>`; the parser is
  `src/harness/reset.ts:608` (`D: /^D\|(?<attrs>\d+)\|\d+\|(?<p>[^|]+)$/`). The ticks are part of the line.
- `fsDiff` compares the before and after lines per path and reports any change as a difference unless a platform
  cache tolerates it or it is the empty NST user TEMP: `src/harness/reset.ts:970-976`. A directory whose only change
  is its last-write time (a file created and deleted inside) is a difference.
- A difference makes `HostDirtyError` (`src/harness/reset.ts:166-181`, "L4 on <c>: 0 error(s), 1 difference(s)"),
  a QuarantiningError: the lane quarantines the container and reroutes.
- `harness recover` then requires every recorded difference to be undone (`unremediated`,
  `cli/commands/harness-env.ts:1275-1280`, "contamination not remediated ... recreate the container or remove them").
  The golden restore resets the database, not a directory timestamp, so recover always fails closed for this case.
  The only way back today is an owner-approved recreate.
- env_fp includes the whole lineage (`src/harness/lineage.ts:220` `lineageCompat`, used by `envFpOf`,
  `src/harness/environment.ts:19-31`), so any lineage change, fs rules included, gives a new env_fp.

## 3. Options

| Option | What changes | New lineage / env_fp | Risk | Blast radius | M12 freeze |
| --- | --- | --- | --- | --- | --- |
| (a) Disable wuauserv and UsoSvc (and their triggers) in the golden image | image rebuild, lineage file, re-baseline every container | yes, both | Windows can re-enable it (seen 2026-09-16 "disabled to demand start"); a patched image drifts from the current one | every container; new golden and baselines | must land before M12 binds its environment; earlier results not comparable by env_fp |
| (b) Disable wuauserv and UsoSvc at container start, outside the lineage (`sc.exe config ... start= disabled`, triggers deleted) by an ops or harness step | ops script or harness code (container start) | no | an unrecorded OS change to every container; re-enable risk as in (a); a harness code path that edits container services | all containers, silently | env_fp unchanged, so it must be written up as a campaign deviation; the owner must accept a service change the lineage does not record |
| (c) Narrow L4 for this one path: tolerate a time-only change of the `C:\Windows\Temp` directory itself (same attributes, same spelling), while any file or folder created, changed or left in it stays a difference | lineage `fs` data only: one `fs.exclude` entry `{disposition: "platform_cache", base: "C:\Windows", dirs: "^Temp$", files: <any anchored pattern; under dir_time_only no file is ever tolerated>, dir_time_only: true, reason}` (schema `src/harness/lineage.ts:125-147`). The existing tolerance code already handles it (`reset.ts:657-668`, `:757-766`), and recover honours it through `cacheStillTolerated` (`harness-env.ts:1271`) | yes, a new lineage id and env_fp (lineage is hashed); re-baseline | narrowest: only the directory's own timestamp is ignored; content in Temp still trips L4 | the lineage file plus one re-baseline per container; no image or service change | needs the owner's L4 approval and a lineage bump before M12 binds; then one baseline per container |
| (d) Accept and plan recreates | nothing; a runbook entry: on a C:\Windows\Temp-only quarantine, stop the container's lane, recreate with the owner's go, baseline, re-admit | no | each trip costs one container for the recreate and baseline (M8-21: about 15 min of work plus about 4 h until an owner go was available); its in-flight cell is infra and rerouted | one container per trip | no change; trips become deviations; with about 103 h on 3 containers (H-110), expect about one trip per campaign |

## 4. Recommendation

**(c), if it can land before the M12 environment is bound; otherwise (d) for M12 and (c) right after.**

(c) is the smallest change that removes the false positive without blinding L4. It changes data, not code. It uses
the already-reviewed `dirTimeOnly` platform_cache rule (H-35 addendum 6). It still fails closed on any file
content in `C:\Windows\Temp`, and it keeps `harness recover` consistent with the check. Its cost is a new lineage id
and env_fp and one re-baseline per container, so it belongs before the M12 freeze, not inside it. (a) and (b) change
the OS under the harness, are known to be reverted by Windows, and (b) does so without the lineage recording it.
(d) is safe and needs nothing, but every trip needs the owner for a recreate.

Open for the owner and orchestrator: whether the M12 binding already pins `golden-o09-v2` or its env_fp (that
decides between "(c) now" and "(d) for M12").

## Files

`measure-wu.ps1`, `measure-281.txt` (copies; live in `H:\cg-coord\tasks\H-111\`).
