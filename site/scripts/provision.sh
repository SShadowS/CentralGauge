#!/usr/bin/env bash
# Provisions Cloudflare resources and writes their IDs into wrangler.toml.
# Run once per environment (production, preview).
set -euo pipefail

cd "$(dirname "$0")/.."

ENV="${1:-production}"

if [[ "$ENV" == "production" ]]; then
  DB_NAME="centralgauge"
  KV_NAME="centralgauge-cache"
  R2_NAME="centralgauge-blobs"
  DB_PLACEHOLDER="PLACEHOLDER_D1_ID"
  KV_PLACEHOLDER="PLACEHOLDER_KV_ID"
elif [[ "$ENV" == "preview" ]]; then
  DB_NAME="centralgauge-preview"
  KV_NAME="centralgauge-cache-preview"
  R2_NAME="centralgauge-blobs-preview"
  DB_PLACEHOLDER="PLACEHOLDER_PREVIEW_D1_ID"
  KV_PLACEHOLDER="PLACEHOLDER_PREVIEW_KV_ID"
else
  echo "Usage: $0 [production|preview]"
  exit 1
fi

echo "Creating D1 database: $DB_NAME"
D1_OUT=$(npx wrangler d1 create "$DB_NAME" 2>&1 || true)
D1_ID=$(echo "$D1_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)

echo "Creating KV namespace: $KV_NAME"
KV_OUT=$(npx wrangler kv namespace create "$KV_NAME" 2>&1 || true)
KV_ID=$(echo "$KV_OUT" | grep -oE 'id = "[0-9a-f]{32}"' | cut -d'"' -f2)

echo "Creating R2 bucket: $R2_NAME"
npx wrangler r2 bucket create "$R2_NAME" || true

echo "Patching wrangler.toml"
sed -i.bak "s/$DB_PLACEHOLDER/$D1_ID/" wrangler.toml
sed -i.bak "s/$KV_PLACEHOLDER/$KV_ID/" wrangler.toml
rm -f wrangler.toml.bak

echo "Done. D1_ID=$D1_ID KV_ID=$KV_ID"
