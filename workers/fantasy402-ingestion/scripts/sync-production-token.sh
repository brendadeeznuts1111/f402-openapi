#!/usr/bin/env bash
# Align deployed Worker INGESTION_TRIGGER_TOKEN with .archive-auth-token (Pages uses the same value).
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN_FILE="${INGESTION_TRIGGER_TOKEN_FILE:-./.archive-auth-token}"
if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Missing $TOKEN_FILE — create it or set INGESTION_TRIGGER_TOKEN_FILE" >&2
  exit 1
fi
echo "Uploading INGESTION_TRIGGER_TOKEN from $TOKEN_FILE ($(wc -c < "$TOKEN_FILE" | tr -d ' ') bytes)..."
wrangler secret put INGESTION_TRIGGER_TOKEN < "$TOKEN_FILE"
echo "Worker secret updated. Run dashboard/scripts/set-pages-secrets.sh to match Pages."
