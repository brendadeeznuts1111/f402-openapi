#!/usr/bin/env bash
# Install Fantasy402 systemd units on Linux VPS.
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer is for Linux (systemd). On macOS use: npm run ingest:install-cron"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UNIT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_DEST="${FANTASY402_ENV_FILE:-/etc/fantasy402/ingestion.env}"
RUN_USER="${SUDO_USER:-${USER}}"
BUN_BIN="${BUN_BIN:-$(command -v bun)}"
NPX_BIN="${NPX_BIN:-$(command -v npx)}"

if [[ -z "$BUN_BIN" ]]; then
  echo "bun not found in PATH. Install Bun or set BUN_BIN."
  exit 1
fi
if [[ -z "$NPX_BIN" ]]; then
  echo "npx not found in PATH. Install Node/npm or set NPX_BIN."
  exit 1
fi

if [[ ! -f "$ENV_DEST" ]]; then
  echo "Creating $ENV_DEST from example (edit before production use)."
  sudo mkdir -p "$(dirname "$ENV_DEST")"
  sudo cp "$UNIT_DIR/ingestion.env.example" "$ENV_DEST"
  sudo chmod 600 "$ENV_DEST"
  echo "Edit $ENV_DEST with INGESTION_TRIGGER_TOKEN, FANTASY402_USERNAME, FANTASY402_PASSWORD."
fi

for unit in fantasy402-local-proxy.service fantasy402-auth-refresh.service fantasy402-auth-refresh.timer fantasy402-ingest-batch.service fantasy402-ingest-batch.timer; do
  sed \
    -e "s|%WORKDIR%|$ROOT|g" \
    -e "s|%BUN%|$BUN_BIN|g" \
    -e "s|%NPX%|$NPX_BIN|g" \
    -e "s|%i|$RUN_USER|g" \
    "$UNIT_DIR/$unit" | sudo tee "/etc/systemd/system/$unit" > /dev/null
done

sudo mkdir -p /var/log/fantasy402
sudo chown "$RUN_USER:$RUN_USER" /var/log/fantasy402 2>/dev/null || sudo chmod 1777 /var/log/fantasy402

sudo systemctl daemon-reload
sudo systemctl enable fantasy402-local-proxy.service
sudo systemctl enable fantasy402-auth-refresh.timer
sudo systemctl enable fantasy402-ingest-batch.timer
sudo systemctl restart fantasy402-local-proxy.service

echo "Installed systemd units for user $RUN_USER"
echo "  systemctl status fantasy402-local-proxy"
echo "  systemctl list-timers 'fantasy402-*'"
echo "  curl -s http://127.0.0.1:8791/auth/health | jq ."
