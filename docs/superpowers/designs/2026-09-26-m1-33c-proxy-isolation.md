# M1-33c: per-execution egress proxy isolation (design, round 3, final)

Status: proposal for review. No isolation code until accepted. Rulings:
`H:\cg-coord\decisions\2026-09-26-m1-33c-step1.md`, reviews `M1-33c-001` and `M1-33c-002`.
Source-IP attribution is out of scope. Addresses are used below only for resource quotas, never to
decide whose traffic it is.

## 0. Threat model

- Adversary: the agent in one placed sandbox. It is admin in its own container, knows its own proxy
  credential, and can open any number of TCP connections to `172.30.60.1:3128` and send any bytes.
  It cannot read another sandbox's mounts, processes or credential, and it has no Docker daemon.
- Must hold: (I1) no execution's traffic is attributed to, allowlisted for, or charged to another
  execution; (I2) no credential appears in any published record; (I3) one sandbox cannot stop
  another sandbox's authenticated connections from being admitted (starvation, section 4);
  (I4) any proxy or log failure ends the affected executions as `setup_failed` with an egress stop,
  never as a successful execution.
- Not in scope: a malicious host, and a compromised HNS switch.

## 1. Why one shared, authenticating proxy

The host firewall allows only TCP 3128 and 3210 from `172.30.60.0/24` to the gateway
(`blockedTcpRanges`). A port per execution needs new elevated rules and a re-verified marker. So
there is one proxy per placed environment, started in `openHarnessEnv` next to the backend, the same
model the backend already uses. Concurrency 1 uses the same path.

## 2. Registration, credential, authentication

- `proxy.register({ allow, log, record })` returns `{ credential, reg }`. The credential has
  `user = <16 random bytes hex>` (a registration id) and `pass = <32 random bytes base64url>`; the
  whole `user:pass` is the secret. Registry: `Map<sha256(user:pass), Registration>`, so at most one
  active registration matches.
- `handle()` order: read the bounded head (pre-auth pool, section 4), then authenticate, and only
  then parse the target, check the allowlist, resolve and dial. Authentication means decoding
  `Proxy-Authorization: Basic`, hashing the whole decoded string, and looking up the map. (The
  digest lookup is the check; no second compare is claimed as extra secrecy.)
- Missing, malformed, unknown and revoked credentials all get the same response: `407`,
  `Proxy-Authenticate: Basic realm="cg"`, an identical body and the same minimum delay. The reason
  goes only to the host log. An unauthenticated request never reaches DNS, dial or the allowlist; a
  test uses a resolver and a dialer that throw.
- Immediately before writing `200`, the proxy checks that `reg` is still active. If not, it closes
  the dialed socket and sends the uniform `407`.
- `unregister()` deletes the map entry (admission blocked at once), then aborts `reg`'s signal, which
  cancels pending resolves and dials. It closes tracked tunnels, and it resolves when they are closed
  or force-closed after a bound.

## 3. Preflight ordering (B1)

Today `eg.probe()` (`egress-check.ps1` via `docker exec`) runs before `release()` writes the secret
files and `ready`, and both `run.ps1` wait for `ready`. The new order per cell:

1. `register()`. Then write only `C:\cg-secrets\proxy-credential` (secret ACL and custody, and in
   `secretValues`). There are no provider secrets and no `ready` yet, so the agent entrypoint is
   still waiting.
2. Preflight: `egress-check.ps1` reads `C:\cg-secrets\proxy-credential` itself (never in the `docker
   exec` argv) and sends `Proxy-Authorization` on its CONNECT probes. `evaluatePreflight` changes:
   - an allowed-host CONNECT must get `200` with the credential;
   - a disallowed-host CONNECT must get the policy deny (`403`, with the reason in that
     registration's log) with the credential;
   - one extra CONNECT without a credential must get `407`;
   - any `407` on an authenticated probe fails the preflight. A `407` is never counted as a blocked
     negative, so it can never pass the allowlist proof.
3. Only after a passing preflight: `release()` writes the provider secrets, then `ready`. A failed
   preflight is `setup_failed` with egress stop `egress_preflight_failed` (as today), and no
   provider secret is written.
4. `run.ps1` (claude-code and pi), after `ready`, reads the credential file and sets `HTTPS_PROXY`
   and `HTTP_PROXY = http://user:pass@172.30.60.1:3128` in its own process. `docker -e` keeps only
   `NO_PROXY`, so the credential is in neither the docker argv nor `docker inspect`. A missing proxy
   fails closed: the firewall blocks direct egress.

## 4. Admission and starvation (B2)

Two separate pools, so pre-auth pressure never consumes authenticated capacity:

- Pre-auth pool, keyed by source address, as a quota only. At accept, a source that is not the
  internal-network address of a currently registered placed sandbox (recorded at `register()` from
  `docker inspect` of that sandbox) is closed at once, without reading. Each registered source may
  hold at most 4 sockets that are still before authentication, under the existing head deadline and
  size cap. The 5th from that source is closed with `503`; other sources are unaffected. The global
  pre-auth total is therefore at most `4 x N` and cannot be exhausted by one source.
- Post-auth pool, per registration: at most `MAX_CONNECTIONS` (64) tunnels. A registration at its cap
  gets `503` and no other registration is affected.
- Why (I3) holds: an authenticated client from sandbox B needs only B's own pre-auth quota, which
  only B consumes. Sandbox A flooding (4 sockets per source, any number of sockets) fills A's quota
  only. The starvation test: A holds its 4 pre-auth sockets open plus 60 idle connects, and B still
  authenticates and gets `200`. It also covers 4 attacker sources with 4 sockets each.
- The assumption this rests on: a sandbox cannot send from another sandbox's address and complete a
  TCP handshake. That is the HNS internal switch's port binding, not our code. Lane-ops proof P2
  (section 9): a sandbox that sets a sibling's IP on its interface cannot complete a handshake to
  the gateway. If P2 fails, (I3) cannot be claimed, and the step-1 refusal stays for concurrency > 1.

## 5. Failures (B3, I4)

These use the existing `TERMINATIONS` (`setup_failed`) and the egress stop reasons
(`ExecutionDraft.egressStop`):

- Registration log write fails: the proxy awaits `reg.log(line)` before sending `200` (and before
  `403`). On a rejection it closes the client socket without a success status, marks `reg.failed`,
  and revokes the registration. The execution ends `setup_failed`, egress stop `egress_log_failed`.
  A decision is never swallowed and a `200` is never sent unlogged.
- Host log write or listener failure: the proxy enters `failed`. Every registration is revoked and
  every running placed execution ends `setup_failed`, egress stop `egress_proxy_failed`.
- A violation (a deny after release) ends that execution `setup_failed`, egress stop
  `egress_violation`, as today.
- Before any placed execution is recorded as anything other than `setup_failed`, `runCell` checks
  `reg.failed === false` and that the proxy is not in `failed`. A late failure turns the draft into
  `setup_failed` with the matching egress stop.
- Campaign behavior on any of these: `runCampaign` starts no new block (today's stop, via the thrown
  `ContainerError`). Other running cells whose registrations are intact run to their natural end
  and are recorded normally. On `egress_proxy_failed`, every running cell ends `setup_failed` as
  above. The campaign then stops with the first failure's message, and resume works as today.

## 6. Version gating: exact match

- `egress-proxy.ts` exports `PROXY_ISOLATION = 2`. `harness egress verify --mark` writes
  `proxy_isolation: PROXY_ISOLATION`.
- `--concurrency > 1` requires `marker.proxy_isolation === PROXY_ISOLATION`, an exact match. Lower,
  higher, missing and non-integer values are all refused. There is no forward compatibility: a
  future version defines its own rule when it changes the constant. Concurrency 1 ignores the field.
- Checked at: (1) the `harness run` up-front check; (2) under the lock in `openHarnessEnv`, with the
  value fixed into `env.proxyIsolation`; (3) `runCampaign` against `env`; (4) the existing per-cell
  `eg.verify()` before release, which re-reads the marker and requires the same value as (2), else
  `setup_failed` with egress stop `egress_preflight_failed`.

## 7. Redaction on every publication path (I2)

Redaction keys gain every form of the credential:
- `pass`, `user:pass` and `base64(user:pass)`;
- the percent-encoded userinfo;
- the full proxy URL, plain and percent-encoded.

Tests run each form through each publication path, with a fake sandbox that prints every form to
stdout and stderr and writes it into its side outputs. After publishing, a byte search of the whole
published tree finds none of the forms:
- `raw.jsonl` and `trace.jsonl`;
- `stderr.txt` and `sandbox.json`;
- side records;
- the verdict and judgment logs;
- `egress.jsonl` and the host log, which never contain headers;
- recovery: `recoverInterrupted` from a custody file that holds the credential publishes a clean
  record. The custody file itself stays private, as today.

## 8. Order of work after acceptance

(a) `egress-proxy.ts`: registry, auth, uniform failures, the recheck, unregister, the two pools,
awaited logging, the `failed` state. TDD, including the starvation and throwing-resolver tests.
(b) The preflight phase: credential file first, `egress-check.ps1` auth, the new `evaluatePreflight`
rules. (c) Custody, `run.ps1`, redaction keys, and the publication-path tests. (d) env-level start
and per-cell register/unregister with the section 5 endings. (e) The marker field plus the four
checks. (f) Lane-ops proofs P1 and P2. (g) Lift the refusal for exact-version markers.

## 9. Lane-ops proofs before lifting the refusal

- P1: `claude-code 2.1.282` and `pi 0.87.1`, placed, with a registered credential and no provider
  credential. The host log (auth present or absent per CONNECT, never the value) shows every CONNECT
  authenticated, both in the preflight window (everything before the first model request) and at
  runtime.
- P2: the section 4 switch assumption.

Either proof failing keeps the step-1 refusal.
