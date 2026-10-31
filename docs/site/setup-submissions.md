# Setup submissions: owner runbook

> How to turn on, review and retire the public "submit a setup" feature.
> Anyone can submit an agent setup (instructions file, roles, a zip, and
> optionally a short-lived API key) at `/submit`. Submissions land in a review
> queue at `/admin/submissions`. Nothing is ranked automatically.

## What a submission holds

One row in D1 `setup_submissions` (migration `0025`) plus one zip in R2 under
`setup-submissions/<id>.zip`.

| Field                  | Notes                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `agent_tool`           | One of `claude-code`, `codex`, `pi`, `opencode`, `cursor`, `antigravity`.               |
| `instructions_md`      | The `CLAUDE.md` or `AGENTS.md` text, UTF-8, at most 200 KiB.                            |
| `roles_json`, `flow`   | Up to 12 roles (role, model, effort) and a free-text flow of at most 4000 characters.   |
| zip                    | At most 10 MiB, checked for a zip header. Stored in R2, with its SHA-256 in the row.    |
| key                    | Optional. Sealed with AES-GCM before it is stored. Must expire within 7 days.           |
| `visibility`           | `public` or `private`.                                                                  |
| `status`               | `new`, then `approved` or `rejected`.                                                   |

Limits: 5 submissions per IP per day, and a Turnstile check on every
submission. The IP is stored only as an HMAC-SHA-256 keyed from
`SUBMISSION_KEY_SECRET`, and an IPv6 address counts by its /64 prefix. The
Turnstile token travels in the `cf-turnstile-response` request header and is
checked before the body is read. Text caps: base model 200 characters, each
role's name, model and effort 100, a key 4096, and an edit request body
16 KiB. The submitter gets an edit link
(`/submit/edit/<id>#<token>`) that shows status, changes visibility and
replaces the key. Only a hash of the token is stored.

## Deploy order

`npm run deploy` does not apply D1 migrations, and a new worker that expects
missing tables fails. Order matters.

1. Apply the migrations. Migration `0024_setups.sql` is not applied in prod yet
   either, and `0025` has a foreign key to the `setups` table, so both must go
   in, in order. From `site/`:

   ```bash
   npx wrangler d1 migrations apply centralgauge --remote
   ```

   This applies every pending migration in numeric order, so `0024` runs before
   `0025`. If it complains that a table already exists, see the
   `d1_migrations` note in `.claude/rules/site-ingest.md`.

2. Create the Turnstile widget in the Cloudflare dashboard (Turnstile, Add
   widget) for hostname `ai.sshadows.dk`. Copy the site key and the secret key.

3. Put the real site key in `site/wrangler.toml`. It is public, so it is a
   normal var. The committed value is Cloudflare's always-pass test key:

   ```toml
   TURNSTILE_SITE_KEY = "<real site key>"
   ```

4. Set the two secrets. They are secrets, not `[vars]` entries, because a
   baked-in var would shadow the secret.

   ```bash
   cd site
   npx wrangler secret put TURNSTILE_SECRET_KEY
   openssl rand -base64 32          # prints the value to paste below
   npx wrangler secret put SUBMISSION_KEY_SECRET
   ```

   `SUBMISSION_KEY_SECRET` must be the base64 of exactly 32 random bytes. Any
   other length is rejected as "not configured". Keep a copy somewhere safe
   (see "Rotating the secret").

5. Add the submission paths to Cloudflare Access. In the Cloudflare
   dashboard, open Zero Trust, Access, Applications, then the
   `CentralGauge Admin Lifecycle` application (see `operations.md`, "Admin
   lifecycle UI access"). Under the application domain, add two more path
   entries next to the lifecycle ones:
   - `/admin/submissions*`
   - `/api/v1/admin/setup-submissions/*`

   Do this on every hostname the application lists (the custom domain and
   the workers.dev one). Without the second path the pages load but their
   API calls return 401. Verify in a fresh incognito window that
   `/admin/submissions` redirects to the Access login.

6. Deploy:

   ```bash
   cd site && npm run deploy
   ```

The admin pages' server-side loaders reach the admin API the same way the
lifecycle review page (`/admin/lifecycle/review`) does: SvelteKit's server
fetch carries the browser's Cloudflare Access cookie to `/api/v1/admin/...`. Before relying on the
submissions pages, confirm that the lifecycle review page works in prod. If it
does not, the submissions pages fail the same way, and the fix belongs to the
shared Access setup, not to this feature.

Until both secrets exist, `POST /api/v1/setup-submissions` answers
`503 submissions_unavailable`. The form is visible but cannot submit.

## Review flow

Admin pages use the same Cloudflare Access gate as the lifecycle UI (see
`operations.md`, "Admin lifecycle UI access"). The admin API also accepts a
signed CLI request. Its Ed25519 signature covers
`canonicalJSON({ payload, path, signed_at })`, where `path` is the request
path, so a signature made for one route or one time cannot be replayed on
another.

1. Open `/admin/submissions`. The filter row switches between `new` (the
   default), `approved`, `rejected` and `all`. The list shows up to 200 rows,
   newest first, with tool, base model, description, visibility, whether a key
   is stored and its expiry, and the zip size.
2. Click an id for the detail page. It shows the metadata, roles, flow, the
   rendered instructions file, the zip SHA-256 and any previous review note.
3. Download the zip with "Download zip" and inspect it by hand. The server
   never unpacks or scans it.
4. If the submitter gave a key and you need it for a run, press "Reveal key".
   The key appears on the page only, with a copy button, and is cleared when
   you leave. Every reveal writes a `submission.key_revealed` audit row with
   your actor and the submission id. The audit row is written first, so a
   failed audit means no reveal.
5. Enter an optional note (up to 2000 characters) and press Approve or Reject.
   Both write a `submission.reviewed` audit row.
   - Reject also deletes the stored key at once. A rejected submission can no
     longer accept a new key (`409 submission_closed`).
   - Approve keeps the key and does not rank anything.
6. "Delete key" removes the sealed key at any time and writes a
   `submission.key_deleted` audit row. It is safe to repeat.

Nothing deletes keys automatically when `key_expires_on` passes. Delete the key
yourself once the run is done.

## After approval: the manual step

Turning a zip into a run config is the owner's job. Read the zip and the
instructions, build the run config by hand, and run the bench yourself. Linking
a submission to a ranked setup (the `setup_id` column) and deleting the key when
its run finishes are planned for a later change. Until then, use "Delete key".

## Purging a spam submission

Rejecting keeps the row and the zip. To remove a spam submission entirely,
delete the row and its zip. From `site/`, with `<id>` the submission id:

```bash
npx wrangler d1 execute centralgauge --remote \
  --command "SELECT id, zip_key FROM setup_submissions WHERE id = '<id>'"
npx wrangler r2 object delete centralgauge-blobs/setup-submissions/<id>.zip --remote
npx wrangler d1 execute centralgauge --remote \
  --command "DELETE FROM setup_submissions WHERE id = '<id>'"
```

Check that the `SELECT` shows the expected `zip_key` before deleting. The
audit rows stay, which is intended. A purged row no longer counts toward its
IP's daily limit.

## Rotating `SUBMISSION_KEY_SECRET`

Stored keys can only be opened with the secret that sealed them. After a
rotation, "Reveal key" fails on every old row with a 500 "Key could not be
decrypted". So:

1. Delete every stored key first (use "Delete key" on each submission with a
   key, or reject the submission).
2. Run `wrangler secret put SUBMISSION_KEY_SECRET` with the new value.

The IP hashes are keyed from the same secret, so a rotation also resets every
IP's daily count.

Submitters who still want their setup run must add a key again through their
edit link.

## Errors you may see

| Status and code                        | Meaning                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `503 submissions_unavailable`          | A secret is missing or `SUBMISSION_KEY_SECRET` is not 32 bytes.      |
| `403 captcha_failed`                   | Turnstile token missing or rejected, or the Turnstile call failed.   |
| `429 submission_limit`                 | More than 5 submissions from one IP hash in 24 hours.                |
| `413 payload_too_large`                | Body or zip over the limits above.                                   |
| `400 invalid_submission`               | Field errors, a bad instructions file, or a non-zip attachment.      |
| `409 submission_closed`                | A key was added to a rejected submission.                            |
| `404 not_found` (edit link)            | Wrong id or token. The two cases are not distinguished.              |
| `404 no_key` / `404 zip_missing`       | Admin reveal with no stored key, or the R2 object is gone.           |

## Audit events

Query them from the `admin_audit` table in D1 (`details_json` holds the details).

| Event                       | Written when                         | Details                                         |
| --------------------------- | ------------------------------------ | ----------------------------------------------- |
| `submission.key_revealed`   | A key is revealed                    | `actor`, `submission_id`                        |
| `submission.key_deleted`    | A key is deleted from the admin API  | `actor`, `submission_id`                        |
| `submission.reviewed`       | Approve or reject                    | `actor`, `submission_id`, `status`, `key_deleted` |

## Source map

- Public API: `site/src/routes/api/v1/setup-submissions/**`
- Admin API: `site/src/routes/api/v1/admin/setup-submissions/**`
- Review UI: `site/src/routes/admin/submissions/**`
- Logic: `site/src/lib/server/setup-submissions.ts`, `submission-crypto.ts`,
  `turnstile.ts`; limits in `site/src/lib/shared/setup-submission.ts`
