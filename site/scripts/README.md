# Provisioning

One-time setup per Cloudflare environment.

```bash
cd site
./scripts/provision.sh production
./scripts/provision.sh preview
```

This creates the D1 database, KV namespace, and R2 bucket, then patches
`wrangler.toml` with the generated IDs.

Run migrations after provisioning:

```bash
npx wrangler d1 migrations apply centralgauge
npx wrangler d1 migrations apply centralgauge-preview --env preview
```
