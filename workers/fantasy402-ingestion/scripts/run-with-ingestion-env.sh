#!/usr/bin/env bash
# Source operator env file then exec the real command (systemd / launchd wrapper).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${FANTASY402_ENV_FILE:-/etc/fantasy402/ingestion.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
elif [[ -f "$ROOT/.env.auth-stack" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT/.env.auth-stack"
  set +a
fi
exec "$@"
