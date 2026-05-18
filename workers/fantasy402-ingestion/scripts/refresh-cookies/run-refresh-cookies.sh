#!/bin/zsh
# run-refresh-cookies.sh
# Wrapper script that loads secrets and runs the cookie refresh.
# Tries 1Password CLI first (for manual runs), falls back to a local .env file (for launchd).

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Try 1Password CLI first (works when user is signed in manually)
if op account list >/dev/null 2>&1; then
  export INGESTION_TRIGGER_TOKEN=$(op item get "Fantasy402 Worker" --vault=DEV --field=INGESTION_TRIGGER_TOKEN --reveal)
  export REFRESH_COOKIES_WORKER_URL=$(op item get "Fantasy402 Worker" --vault=DEV --field=REFRESH_COOKIES_WORKER_URL)
else
  # Fall back to local .env file for launchd / cron automation
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    source "$SCRIPT_DIR/.env"
  else
    echo "[ERROR] 1Password CLI not signed in and no .env file found." >&2
    echo "        Create .env by running: ./generate-env.sh" >&2
    exit 1
  fi
fi

exec /opt/homebrew/bin/node refresh-cookies.js
