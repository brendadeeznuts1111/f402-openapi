#!/usr/bin/env bash
# Set INGESTION_TRIGGER_TOKEN on Cloudflare Pages (production + preview).
# Run from repo root or dashboard/:  ./scripts/set-pages-secrets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOKEN_FILE="${INGESTION_TRIGGER_TOKEN_FILE:-$ROOT/workers/fantasy402-ingestion/.archive-auth-token}"
PROJECT="${PAGES_PROJECT:-fantasy402-dashboard}"

read_token() {
  if [[ -f "$TOKEN_FILE" ]]; then
    cat "$TOKEN_FILE"
    return 0
  fi
  if command -v op >/dev/null 2>&1; then
    echo "Reading INGESTION_TRIGGER_TOKEN from 1Password (Fantasy402 Worker)..." >&2
    op item get "Fantasy402 Worker" --vault=DEV --field=INGESTION_TRIGGER_TOKEN --reveal
    return 0
  fi
  echo "Missing token file: $TOKEN_FILE" >&2
  echo "Set INGESTION_TRIGGER_TOKEN_FILE, create .archive-auth-token, or install 1Password CLI (op)." >&2
  exit 1
}

# CLOUDFLARE_API_TOKEN from env often lacks Pages secret permissions; OAuth works.
unset CLOUDFLARE_API_TOKEN

put_secret() {
  local env="$1"
  echo "Setting INGESTION_TRIGGER_TOKEN ($env) on Pages project $PROJECT..."
  read_token | wrangler pages secret put INGESTION_TRIGGER_TOKEN \
    --project-name="$PROJECT" \
    --env="$env"
}

put_secret production
put_secret preview

echo "Done. Redeploy so new deployments bind secrets: cd dashboard && npm run deploy"
