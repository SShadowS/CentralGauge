# Egress verify without elevation (M1-34b)

Problem: `collectEgressState` (src/harness/egress.ts COLLECT_PS) fails non-elevated at
`Get-NetFirewallPortFilter -All` (M1-34 run 001 step 6), so every placed/enforced open needs
admin, but campaigns run in lane-ops, non-elevated. Evidence: `H:\cg-coord\tasks\M1-34b\research\`
(t02 = every read, t07 = bulk association + timing, t08 = end-to-end, t09/t10 = netsh/registry).
All reads below ran on this host at Medium integrity, IsAdmin False, WinPS 5.1 and pwsh 7, against
the live `cg-harness-egress` group (256 rules on vEthernet ifIndex 98).

| Read in COLLECT_PS | Non-elevated? | Non-elevated alternative | Tested | Equivalence |
|---|---|---|---|---|
| `Get-NetIPInterface -AddressFamily IPv4` | yes | (unchanged) | t02 | same |
| `Get-NetFirewallRule -PolicyStore ActiveStore -Group` | yes | (unchanged) | t01 | same |
| `Get-NetFirewallPortFilter -All -PolicyStore ActiveStore` | NO (Access denied) | `$rules \| Get-NetFirewallPortFilter` | t07/t08 | same cmdlet, same ActiveStore objects, keyed by InstanceID as today |
| `Get-NetFirewallAddressFilter -All` | NO | `$rules \| Get-NetFirewallAddressFilter` | t07/t08 | same |
| `Get-NetFirewallInterfaceFilter -All` | NO | `$rules \| Get-NetFirewallInterfaceFilter` | t07/t08 | same |
| `Get-NetFirewallApplicationFilter -All` / `ServiceFilter -All` | yes | pipe too, for symmetry | t02/t07 | same |
| (InterfaceTypeFilter -All, not used) | NO | pipe works | t07 | same |
| `Get-NetFirewallRule -Enabled True -Action Block` (foreign) | yes | (unchanged) | t02 | same |
| `Get-NetFirewallProfile -PolicyStore ActiveStore` | yes | (unchanged) | t02 | same |
| `Get-NetIPAddress -IPAddress <gw>` | yes | (unchanged) | t02/t04 | same |
| `Get-HnsNetwork` | NO (E_ACCESSDENIED; also hnsdiag, Get-VMSwitch) | HNS VolatileStore registry value `HKLM\...\hns\State\HostComputeNetwork\VolatileStore\Network\<hnsid>` (owner SYSTEM, Users ReadKey) | t05/t06/t08 | Name, Type `internal`, Subnet present, but an undocumented binary blob, and HNS's own persisted copy, not a live service query |
| rejected: CIM class enumeration `MSFT_NetProtocolPortFilter` (also with `-Filter`) | NO | `Get-CimAssociatedInstance` from the rule works | t02 | same as the pipe |
| rejected: `netsh advfirewall firewall show rule ... verbose` | yes | | t09 | NOT equivalent: no interface binding (only InterfaceTypes) |
| rejected: registry `FirewallPolicy\FirewallRules` | yes | | t10 | PersistentStore only (1108 vs 1111 active), no GPO/dynamic rules; has IF GUID |

Finding: only the class-wide `-All` enumerations are denied. Reading the same filter objects by
association from the group's rule instances is allowed. t08 fed a candidate non-elevated collector
(pipe filters + HNS registry blob) into the UNCHANGED `collectEgressState` + `verifyEgressState`
with docker's live network and the M1-34 marker: 0 problems, 256 rules, 5.5 s.

## Option (a): fully non-elevated live verify
- Replace the five `By-Id (Get-NetFirewall*Filter -All ...)` lines with `By-Id ($rules | Get-...)`
  (guard `$rules.Count -eq 0`). Firewall assurance is unchanged: same store, same fields, live.
- HNS: parse the VolatileStore blob fail-closed (exactly one value named the docker hnsid; exactly one
  Name/Type/AddressPrefix; Name must equal docker `windowsshim.networkname` = docker Id = the
  adapter alias suffix). Any format drift throws, so verify refuses (safe), never passes silently.
- Lost vs `Get-HnsNetwork`: the HNS read is HNS's persisted runtime state, not the service's answer;
  a Windows update may change the blob format (fails closed). Tampering needs admin (key ACL), the
  same trust boundary as option (b). If the blob proves too brittle, the fallback is docker-only
  (driver `internal`, hnsid, networkname) + the alias tie: loses the independent HNS type/subnet check.
- Association being allowed while `-All` is denied is observed provider behaviour, not documented;
  a future lock-down also fails closed.

## Option (b): SYSTEM scheduled-task snapshot
- Owner-installed task (SYSTEM, every 1 min, the Task Scheduler minimum) runs today's COLLECT_PS
  and atomically writes `C:\ProgramData\cg-harness\egress-state.json` with `collected_at`.
- Dir: inheritance off, owner Administrators, ACL SYSTEM+Administrators full, Users read. Required:
  `C:\ProgramData` grants Users "Write" (create folder) + CREATOR OWNER, so a non-admin can squat
  the dir first; verify must check dir AND file owner is SYSTEM/Administrators, protected DACL, and
  no write ACE for any other principal, else refuse.
- Verify refuses if `now - collected_at > 180 s` (1 min period, ~5 s run, tolerates 2 missed runs),
  or snapshot hnsid/network id/interface index differ from live docker + `Get-NetIPAddress`.
- Lost vs a live read: a TOCTOU window up to 180 s (a rule deleted/disabled after the snapshot is
  not seen; the network-id/ifIndex tie only catches recreation); trust moves to the task definition
  and its script path (both must be admin-only writable); admins can forge the file (as they can
  the firewall). Plus operational cost: install/uninstall, a SYSTEM job every minute forever.

## Recommendation: (a)
It keeps a live read with the same firewall assurance as today, needs no install, no standing
SYSTEM job, no ACL-squatting surface, and no freshness window. The one weakening (HNS from its
registry state instead of the HNS API) is bounded by fail-closed parsing and the docker/alias
cross-check, and is admin-tamper-only like (b). Choose (b) (bound 180 s) only if the orchestrator
rules the HNS registry read unacceptable AND docker-only HNS evidence is insufficient.
