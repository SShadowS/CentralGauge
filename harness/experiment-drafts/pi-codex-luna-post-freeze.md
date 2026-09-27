# H-02 post-freeze plan: pi + GPT-6 Luna on the ChatGPT subscription

Owner and ops steps after the 2026-10-16 data freeze. Nothing here runs before it.

## Why this waits for the freeze

Merging H-02 adds the route `openai-codex:oauth` to `ROUTE_HOSTS` and `RECORDED_ROUTES`.
The authorized egress allowlist is computed over every route, and this route has no
recording yet. From the merge onward, until step 6 is done:

- every enforced run is refused (Claude arms and pi-openrouter arms too), with
  `allowlist_sha256: cannot recompute (provider route openai-codex:oauth needs the hosts ...)`;
- `harness egress verify authorized` fails the same way.

It also changes the pi image contents (`harness/images/pi/run.ps1`, `cg-budget.ts`), so the
pi image must be rebuilt. The frozen campaign images and checkout are never touched. A
codex run on an old pi image fails closed (the old guard wants the openrouter key file).

## Steps

1. **Integrate** (orchestrator): merge the H-02 branch after the freeze, with no campaign or
   cell in flight.
2. **Rebuild the pi image** (ops): `harness images build pi --version 0.87.1`, then the usual
   layer verification. Record the new image id.
3. **Create the credential** (owner, host terminal):
   - Log in once on the host: `pi auth` (or `/login` in pi), choose OpenAI (ChatGPT Plus/Pro).
   - Refresh to a long validity right before use:
     `pi auth print-bearer-token --provider openai-codex --min-expiry 60m`
     (prints the token; do not paste it anywhere).
   - Write `H:\Temp3\harness-spike\secrets\openai-codex-auth` as a pi auth.json holding
     exactly one entry: `{"openai-codex": {"type":"oauth","access":...,"refresh":...,"expires":...,"accountId":...}}`,
     copied from `~/.pi/agent/auth.json`. Never commit it, never pass it in argv.
   - Every run refuses (`setup_failed`, before any reservation) when the token expires
     before `timeout_min + 15` minutes. Repeat the refresh and copy before each session.
     In-sandbox refresh is impossible by design: the host releases the sandbox copy with
     `refresh: ""` (the refresh token never enters the sandbox; pi uses the access token
     alone while it is valid), the guard refuses a token that does not outlive
     `timeout_min + 5` minutes, and a recording holding an `auth*.openai.com` host is refused.
4. **Rotation record** (owner): the next authorization requires a rotation record with
   entries `claude-oauth`, `openrouter` and `openai-codex` (names and times, never values).
5. **Record the hosts** (owner terminal, supervised, `harness cell --supervised` needs a TTY):
   - The marker must be `qualified`, not `authorized`. Remove the authorized marker
     explicitly, then `harness egress verify --mark candidate`, then `--mark qualified`
     (needs fresh `backend-probe.ts --enforced` probe evidence).
   - Run one supervised record-mode cell:
     `harness cell harness/configs/pi-gpt6-luna-codex.yml <task> --supervised --record-oauth-hosts`.
     This adds `openai-codex:oauth` hosts to `harness/egress/recorded-hosts.json` beside the
     existing Claude recording. The file becomes v2: `sources` holds each route's own
     record-mode execution (the committed v1 file loads as is and is rewritten as v2). It
     refuses if the route is already recorded. The cell must start after the rotation (step 4).
   - Review the recorded hosts (expected `chatgpt.com`; a recording holding an
     `auth*.openai.com` host is refused outright and writes nothing), then commit the file
     with its evidence.
6. **Re-authorize** (ops/owner): `harness egress verify --mark authorized --evidence <M1-34/nnn>
   --rotation <record> --cell <a clean enforced Claude cell started after the rotation>`.
   The recording file changed, so the marker hash changes; the old marker cannot be reused.
   Authorization also checks the codex recording cell named by its route's source:
   supervised, credential-bearing pi on `openai-codex:oauth`, completed, started after the
   qualified marker and after the rotation. Every later marker read rechecks it.
7. **First cell** (ops): one enforced cell of `pi-gpt6-luna-codex` on a known task. Check:
   provider `openai-codex` in the stream, the list-price estimate in the record, the budget
   guard armed, and no credential in the published files (a grep for the start of the access
   token finds nothing; redactions show as `[REDACTED:openai-codex-auth...]`).
8. **Experiment** (owner decision): move `harness/experiment-drafts/pi-codex-luna.yml` into
   `harness/experiments/`, run the `--sample 1` dry run, then the campaign. Cost reporting:
   the record carries the list-price estimate; the subscription cash cost is 0 and paid spend
   (`decisions/spend.md`) does not change.

## Open owner questions

- `vary: [models, settings]` in the draft: `vary: [models]` alone is refused because provider
  and model id live in native settings. Accept, or derive those keys from the model slug.
- `openai-codex/gpt-6-luna` is a new site catalog row. It reaches the site only with a
  `sync-catalog --apply` (owner only); decide whether the site should show it at all.
