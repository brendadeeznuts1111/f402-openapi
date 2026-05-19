#!/usr/bin/env bash
# Install macOS launchd jobs for local proxy + auth refresh + ingest batch (proxy mode).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAUNCHD_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT/logs"
ENV_FILE="${FANTASY402_ENV_FILE:-$ROOT/.env.auth-stack}"
BUN_BIN="${BUN_BIN:-$(command -v bun)}"
NPX_BIN="${NPX_BIN:-$(command -v npx)}"
PROXY_PORT="${LOCAL_INGEST_PROXY_PORT:-8791}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Use deploy/systemd/install.sh on Linux."
  exit 1
fi

mkdir -p "$LOG_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Copy deploy/systemd/ingestion.env.example to $ENV_FILE and set secrets."
  cp "$LAUNCHD_DIR/../systemd/ingestion.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

install_plist() {
  local src="$1"
  local label="$2"
  local dest="$HOME/Library/LaunchAgents/$label.plist"
  sed \
    -e "s|__WORKDIR__|$ROOT|g" \
    -e "s|__BUN__|$BUN_BIN|g" \
    -e "s|__NPX__|$NPX_BIN|g" \
    -e "s|__LOGDIR__|$LOG_DIR|g" \
    "$src" > "$dest"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$dest"
  launchctl enable "gui/$(id -u)/$label"
  echo "Installed $label"
}

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a
export WORKER_ORIGIN="${WORKER_ORIGIN:-http://127.0.0.1:$PROXY_PORT}"

install_plist "$LAUNCHD_DIR/com.fantasy402.local-proxy.plist" "com.fantasy402.local-proxy"
install_plist "$LAUNCHD_DIR/com.fantasy402.auth-refresh.plist" "com.fantasy402.auth-refresh"
bash "$ROOT/scripts/install-ingest-cron.sh"

echo ""
echo "Auth stack on macOS:"
echo "  Proxy:  http://127.0.0.1:$PROXY_PORT"
echo "  Status: npm run auth:stack-status"
echo "  Logs:   $LOG_DIR/"
