# Provisioning

One-time setup for the production Cloudflare environment.

```bash
cd site
./scripts/provision.sh production
```

This creates the D1 database, KV namespace, and R2 bucket, then patches
`wrangler.toml` with the generated IDs.

Run migrations after provisioning:

```bash
npx wrangler d1 migrations apply centralgauge
```
