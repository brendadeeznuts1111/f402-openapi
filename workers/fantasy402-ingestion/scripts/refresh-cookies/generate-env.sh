#!/bin/zsh
# generate-env.sh
# Generates a local .env file from 1Password for use by launchd / cron.
# Run this manually while signed into 1Password.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if ! op account list >/dev/null 2>&1; then
  echo "[ERROR] 1Password CLI not signed in. Run: eval \$(op signin)" >&2
  exit 1
fi

TOKEN=$(op item get "Fantasy402 Worker" --vault=DEV --field=INGESTION_TRIGGER_TOKEN --reveal)
URL=$(op item get "Fantasy402 Worker" --vault=DEV --field=REFRESH_COOKIES_WORKER_URL)

cat > "$SCRIPT_DIR/.env" <<EOF
export INGESTION_TRIGGER_TOKEN=$TOKEN
export REFRESH_COOKIES_WORKER_URL=$URL
EOF

chmod 600 "$SCRIPT_DIR/.env"
echo "Created .env with restricted permissions (600)."
echo "You can now run via launchd or cron without 1Password CLI being signed in."
