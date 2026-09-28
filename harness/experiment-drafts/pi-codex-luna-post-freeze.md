# H-02 post-freeze plan: pi + GPT-6 Luna on the ChatGPT subscription

Owner and ops steps after the 2026-10-16 data freeze. Nothing here runs before it.

## What merging changes (per-route authorization, H-02 run 002)

Merging H-02 adds the route `openai-codex:oauth`. It is authorized on its own, never
through the M1-34 marker:

- The authorized marker keeps covering exactly the routes it covered on master
  (`anthropic:first-party-oauth`, `openrouter:api-key`). Its allowlist and hashes span only
  those routes, and the Step 11 recording (`harness/egress/recorded-hosts.json`) is never
  rewritten, so an existing authorized marker keeps verifying after the merge. Claude and
  pi-openrouter arms keep running; there is no outage and no marker rebuild.
- The codex route records into its own file,
  `harness/egress/recorded-hosts.openai-codex_oauth.json`, and needs its own route
  authorization in the marker (`routes_authorized`). Until then only codex arms refuse
  (`provider route openai-codex:oauth needs the hosts ... authorized for its route`).
- Every marker read (each environment open and each release) rechecks the route
  authorization; if it stops verifying (a changed recording, a changed record-mode cell),
  only codex arms refuse.

It also changes the pi image contents (`harness/images/pi/run.ps1`, `cg-budget.ts`), so the
pi image must be rebuilt. The frozen campaign images and checkout are never touched. A
codex run on an old pi image fails closed (the old guard wants the openrouter key file).

## Steps

1. **Integrate** (orchestrator): merge the H-02 branch after the freeze, with no campaign or
   cell in flight (a precaution, not a requirement of the design). Then confirm the existing
   marker still verifies: `harness egress verify` reports no problem.
2. **Rebuild the pi image** (ops): `harness images build pi --version 0.87.1`, then the usual
   layer verification. Record the new image id.
3. **Create and protect the credential** (owner, host terminal):
   - Log in on the host: run `pi`, then `/login`, choose OpenAI (ChatGPT Plus/Pro).
   - Refresh to a long validity right before use:
     `pi auth print-bearer-token --provider openai-codex --min-expiry 60m > $null`
     (it prints the token; the redirect discards it).
   - Write `H:\Temp3\harness-spike\secrets\openai-codex-auth` as a pi auth.json holding
     exactly one entry: `{"openai-codex": {"type":"oauth","access":...,"refresh":...,"expires":...,"accountId":...}}`,
     copied from `~/.pi/agent/auth.json`. Never commit it, never pass it in argv.
   - **Host ACLs, both copies** (`%USERPROFILE%\.pi\agent\auth.json` and the secrets file).
     Verify before, restrict, verify after; never widen. In an elevated-or-owner PowerShell,
     for each `$f` of the two paths:
     ```powershell
     icacls $f                                   # before: note every entry
     icacls $f /inheritance:r /grant:r "${env:USERDOMAIN}\${env:USERNAME}:(F)" "*S-1-5-18:(F)"
     icacls $f                                   # after: list every remaining principal
     icacls $f /remove:g "<principal>"           # once per principal other than the two
     icacls $f                                   # re-check: exactly the owner account and SYSTEM
     ```
     `/inheritance:r` removes the inherited entries and `/grant:r` replaces the explicit
     entries of the two named principals only (the owner account, and SYSTEM by its SID
     `*S-1-5-18`, which is locale-safe). Explicit entries of any other principal survive both:
     for each one the "after" listing shows (for example `BUILTIN\Users` or
     `BUILTIN\Administrators`), run `icacls $f /remove:g "<principal>"`, then list again
     until only the owner account and SYSTEM remain. The only grants are to the owner account
     and SYSTEM; never grant any other principal (never widen). If any other principal
     remains, stop and fix it before any run. Repeat the check whenever pi rewrites
     `auth.json` (a refresh keeps the file, but check it).
   - Every run refuses (`setup_failed`, before any reservation) when the token expires
     before `timeout_min + 15` minutes. Repeat the refresh and copy before each session.
     In-sandbox refresh is impossible by design: the host releases the sandbox copy with
     `refresh: ""` (the refresh token never enters the sandbox; pi uses the access token
     alone while it is valid), the guard refuses a token that does not outlive
     `timeout_min + 5` minutes, and a recording holding an `auth*.openai.com` host is refused.
4. **Rotate the codex credential** (owner). A rotation record alone is not a rotation:
   - First note when the old access token expires, printing only the date, never a token.
     Run this before `/logout` (which deletes the local entry), once for each copy (the pi
     copy and the secrets file), and keep the later date:
     ```powershell
     deno eval "const e = JSON.parse(Deno.readTextFileSync(Deno.args[0]))['openai-codex']; console.log(new Date(e.expires).toISOString())" "$env:USERPROFILE\.pi\agent\auth.json"
     deno eval "const e = JSON.parse(Deno.readTextFileSync(Deno.args[0]))['openai-codex']; console.log(new Date(e.expires).toISOString())" "H:\Temp3\harness-spike\secrets\openai-codex-auth"
     ```
   - Revoke the old refresh session: in the OpenAI account settings (Security, sessions or
     devices) sign out the old pi/Codex session, so its refresh token stops working; then in
     pi run `/logout` (it only deletes the local credential, it does not revoke anything).
   - Log in again (`pi`, then `/login`), refresh and copy as in step 3, and redo the ACL
     steps on both copies (a fresh login rewrites `auth.json`).
   - The old ACCESS token is not proven dead by any login check: `pi auth check --provider
     openai-codex` (pi 0.87.1) reports only whether the current credential is usable, and a
     revoked session can leave an already issued access token valid until its `expires`.
     So wait until the noted date has passed; only then is the old credential dead. (A
     request with the old token that must fail would also prove it, but that handles a
     token; the wait does not.)
   - Then write the rotation record for the route, with `revoked_at` set to that noted
     `expires` instant (when the old access token stopped working) and `created_at` to the
     new login time: `{"v":1,"credentials":[{"name":"openai-codex","revoked_at":...,"created_at":...}]}`
     (names and times, never values). The route authorization needs the `openai-codex`
     entry, re-reads the record at every check, and requires the record-mode cell to start
     after the later of the two instants, so no cell can be counted before the old token died.
5. **Record the hosts** (owner terminal, supervised, `harness cell --supervised` needs a TTY):
   - The marker stays `authorized`: a later route records under it, only in its own sandbox.
   - Run one supervised record-mode cell:
     `harness cell harness/configs/pi-gpt6-luna-codex.yml <task> --supervised --record-oauth-hosts`.
     It writes `harness/egress/recorded-hosts.openai-codex_oauth.json` (source = this
     execution); the Claude recording is untouched. It refuses if that file exists.
   - Review the recorded hosts (expected `chatgpt.com`; a recording holding an
     `auth*.openai.com` host is refused outright and writes nothing), then commit the file
     with its evidence.
6. **Authorize the route** (ops/owner):
   `harness egress verify --authorize-route openai-codex:oauth --cell <the step 5 execution id>
   --rotation <step 4 record> --evidence <H-02/nnn>`.
   It needs the marker to verify for its own routes, never changes the marker's own fields,
   and refuses to overwrite an existing route authorization. The record-mode cell is checked
   with the same code as the M1-34 Claude cell: its record-mode facts (supervised,
   credential-bearing pi) and the recording's source naming it; `openai-codex:oauth` in its
   manifest; completed; started after the marker's authorization and after the rotation; its
   `egress.jsonl` with the preflight lines exact (M1-34e) and the agent phase allow-only on
   the recorded hosts. Every marker read and every release repeats these checks and also
   validates the route entry itself: exactly its fields, keyed by its own route, non-blank
   evidence, the rotation record re-read with its `openai-codex` instant equal to the stored
   `rotated_at`, and `verified_at` not in the future and after the marker's authorization,
   the rotation and the cell's start. Any defect refuses codex arms only.
7. **First cell** (ops): one enforced cell of `pi-gpt6-luna-codex` on a known task. Check:
   - provider `openai-codex` in the stream; the budget guard armed;
   - the access-token expiry against the cell timeout: before the cell, `expires` in the
     secrets file (epoch ms) is later than now plus `timeout_min + 15` minutes, and the cell
     did not end `setup_failed` for expiry; after it, no refresh happened (the record holds no
     `auth*.openai.com` connection, and `expires` in the secrets file is unchanged);
   - the reported and the estimated cost: the record's `reported_cost_usd` (pi's list-price
     sum) and `cost_usd` (our catalog list-price estimate) are both set and agree within a
     cent; the subscription cash cost is 0;
   - no credential in the published files (a grep for the start of the access token finds
     nothing; redactions show as `[REDACTED:openai-codex-auth]`).
8. **Experiment** (owner decision): move `harness/experiment-drafts/pi-codex-luna.yml` into
   `harness/experiments/`, run the `--sample 1` dry run, then the campaign. Cost reporting:
   the record carries the list-price estimate; the subscription cash cost is 0 and paid spend
   (`decisions/spend.md`) does not change.

## Open owner questions

- Automated use of the ChatGPT subscription carries a terms-of-service and fair-use risk
  (review H-02-001 finding 5); the owner decides whether to run the experiment at all.
- `vary: [models, settings]` in the draft: `vary: [models]` alone is refused because provider
  and model id live in native settings. Accept, or derive those keys from the model slug.
- `openai-codex/gpt-6-luna` is a new site catalog row. It reaches the site only with a
  `sync-catalog --apply` (owner only); decide whether the site should show it at all.
