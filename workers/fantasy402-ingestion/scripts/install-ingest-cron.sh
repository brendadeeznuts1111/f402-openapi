#!/usr/bin/env bash
# Install a launchd job to run local ingest batches every 5 minutes (machine must stay on).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.fantasy402.ingest-local.plist"
LOG_DIR="$ROOT/logs"
INTERVAL="${F402_INGEST_INTERVAL_SEC:-300}"
PROXY_PORT="${LOCAL_INGEST_PROXY_PORT:-8791}"
WORKER_ORIGIN="${WORKER_ORIGIN:-http://127.0.0.1:$PROXY_PORT}"

mkdir -p "$LOG_DIR"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.fantasy402.ingest-local</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(which bun)</string>
    <string>scripts/ingest-local-batch.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WORKER_ORIGIN</key>
    <string>$WORKER_ORIGIN</string>
  </dict>
  <key>StartInterval</key>
  <integer>$INTERVAL</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/ingest-local.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/ingest-local.err.log</string>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/com.fantasy402.ingest-local" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/com.fantasy402.ingest-local"
echo "Installed launchd job: com.fantasy402.ingest-local (every ${INTERVAL}s)"
echo "WORKER_ORIGIN=$WORKER_ORIGIN (Bearer optional when local proxy is running)"
echo "Full macOS stack: bash deploy/launchd/install-mac-auth-stack.sh"
echo "Logs: $LOG_DIR/ingest-local.log"
echo "Uninstall: launchctl bootout gui/$(id -u)/com.fantasy402.ingest-local && rm $PLIST"
