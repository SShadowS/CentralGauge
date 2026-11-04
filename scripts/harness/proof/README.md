# H-35 proof scripts

These are proof-only controls for the H-35 defence layers (design-r5 2.5 and 6.5).

Lane-ops runs them on one scratch container under its coord lease. Their records go to `$CG_COORD_ROOT/tasks/H-35/proof/controls`, never to a campaign store, which refuses proof provenance.

| Script | What it proves |
| --- | --- |
| `run-controls.ts` | The seeded-state controls in `PROOF_CONTROLS` (`lib.ts`): a write leaves state behind, then reads show what the reset cleared or what L4 detected. |
| `run-sandbox-probe.ts` + `sandbox-probe.ps1` | The agent sandbox reaches no denied root (canary probe in the real image). |
| `run-server-mounts.ts` | Two records. `access-server-mounts`: the BC container's mounts against the denied roots. `access-shared-artifacts` (H-55): no package or link in `C:\Run\my`, and no CentralGauge-owned app under the BCH root that any mount shows the container. |

## Disclosure

**H-35: L4 mechanism-tested, not fixture-proven.**

The four hostile controls of the design-r5 2.5 proof-only column are dropped by the owner ruling of 2026-11-03 (`decisions/2026-11-03-h35-owner-rulings.md`, ruling 2). They are not written, stubbed or rerouted:

| Dropped control | Layer it would prove | Expected disposition |
| --- | --- | --- |
| `file-packageid` | L4 | detected |
| `http-exfil` | L2 | blocked |
| `server-path` | L4 | detected |
| `background-task` | reset | cleared |

The L2 and L4 runner paths in `lib.ts` remain tested with fakes (`tests/unit/harness/proof.test.ts`). The seeded `seed-server-file` control exercises L4 on a real container. No hostile fixture proves any of these layers.
