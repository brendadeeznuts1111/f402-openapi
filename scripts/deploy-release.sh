#!/usr/bin/env bash
# Full release: validate worker, apply D1 migrations, deploy Worker + Pages, align tokens.
#
# Usage (from repo root):
#   ./scripts/deploy-release.sh              # deploy worker + dashboard
#   ./scripts/deploy-release.sh --worker-only
#   ./scripts/deploy-release.sh --skip-migrate
#   SKIP_PAGES_SECRETS=1 ./scripts/deploy-release.sh   # skip Pages secret put
#   SKIP_WORKER_TOKEN_SYNC=1 ./scripts/deploy-release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER="$ROOT/workers/fantasy402-ingestion"
DASHBOARD="$ROOT/dashboard"

WORKER_ONLY=0
SKIP_MIGRATE=0
for arg in "$@"; do
  case "$arg" in
    --worker-only) WORKER_ONLY=1 ;;
    --skip-migrate) SKIP_MIGRATE=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

echo "==> Worker tests + contract validation"
cd "$WORKER"
npm test
npm run validate:upstream-contract
npm run validate:openapi
npm run validate:runtime-auth

if [[ "$SKIP_MIGRATE" != "1" ]]; then
  echo "==> D1 migrations (remote)"
  npm run migrate:remote
fi

if [[ "${SKIP_WORKER_TOKEN_SYNC:-}" != "1" ]] && [[ -f "$WORKER/.archive-auth-token" ]]; then
  echo "==> Sync INGESTION_TRIGGER_TOKEN to Worker (from .archive-auth-token)"
  "$WORKER/scripts/sync-production-token.sh"
fi

echo "==> Deploy Worker"
npm run deploy

if [[ "$WORKER_ONLY" == "1" ]]; then
  echo "Done (worker only)."
  exit 0
fi

echo "==> Dashboard dev-vars check"
cd "$DASHBOARD"
npm run sync:dev-vars:check

if [[ "${SKIP_PAGES_SECRETS:-}" != "1" ]]; then
  echo "==> Pages INGESTION_TRIGGER_TOKEN (production + preview)"
  "$DASHBOARD/scripts/set-pages-secrets.sh"
fi

echo "==> Deploy Pages dashboard"
npm run deploy

echo "==> Post-deploy smoke (optional)"
cd "$WORKER"
if npm run smoke:remote 2>/dev/null; then
  echo "Smoke OK"
else
  echo "Smoke skipped or failed — check worker/README.md" >&2
fi

echo "Release complete."
echo "  Worker:  https://fantasy402-ingestion.utahj4754.workers.dev"
echo "  Dashboard: https://fantasy402-dashboard-5q6.pages.dev"
echo "  Local dev: cd dashboard && npm run dev:local  (requires wrangler dev --remote on :8789)"
