#!/usr/bin/env bash
# Set manifest-declared Cloudflare Pages secrets (production + preview).
# Run from repo root or dashboard/:  ./scripts/set-pages-secrets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST="$ROOT/dashboard/public/manifest.json"
TOKEN_FILE="${INGESTION_TRIGGER_TOKEN_FILE:-$ROOT/workers/fantasy402-ingestion/.archive-auth-token}"
PROJECT="${PAGES_PROJECT:-fantasy402-dashboard}"
ENVS="${PAGES_ENVS:-production preview}"

manifest_secrets() {
  node -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const secrets = manifest.cloudflare?.pages_projects?.dashboard?.secrets ?? [];
    for (const secret of secrets) console.log(secret);
  ' "$MANIFEST"
}

read_secret() {
  local name="$1"
  local file_var="${name}_FILE"
  local explicit="${!name:-}"
  local explicit_file="${!file_var:-}"

  if [[ -n "$explicit" ]]; then
    printf '%s' "$explicit"
    return 0
  fi

  if [[ -n "$explicit_file" && -f "$explicit_file" ]]; then
    cat "$explicit_file"
    return 0
  fi

  if [[ "$name" == "INGESTION_TRIGGER_TOKEN" && "${USE_LOCAL_TOKEN_FILE:-}" != "1" ]] && command -v op >/dev/null 2>&1; then
    echo "Reading INGESTION_TRIGGER_TOKEN from 1Password (Fantasy402 Worker)..." >&2
    op item get "Fantasy402 Worker" --vault=DEV --field=INGESTION_TRIGGER_TOKEN --reveal
    return 0
  fi

  if [[ "$name" == "INGESTION_TRIGGER_TOKEN" && -f "$TOKEN_FILE" ]]; then
    cat "$TOKEN_FILE"
    return 0
  fi

  echo "Missing value for Pages secret: $name" >&2
  echo "Set $name, ${name}_FILE, or add a supported resolver in scripts/set-pages-secrets.sh." >&2
  if [[ "$name" == "INGESTION_TRIGGER_TOKEN" ]]; then
    echo "For INGESTION_TRIGGER_TOKEN, you can also create $TOKEN_FILE, install 1Password CLI (op), or set USE_LOCAL_TOKEN_FILE=1." >&2
  fi
  exit 1
}

# CLOUDFLARE_API_TOKEN from env often lacks Pages secret permissions; OAuth works.
unset CLOUDFLARE_API_TOKEN

put_secret() {
  local env="$1"
  local secret="$2"
  echo "Setting $secret ($env) on Pages project $PROJECT..."
  read_secret "$secret" | wrangler pages secret put "$secret" \
    --project-name="$PROJECT" \
    --env="$env"
}

SECRETS=()
while IFS= read -r secret; do
  [[ -n "$secret" ]] && SECRETS+=("$secret")
done < <(manifest_secrets)
if [[ "${#SECRETS[@]}" -eq 0 ]]; then
  echo "No Pages secrets declared in $MANIFEST" >&2
  exit 1
fi

if [[ "${1:-}" == "--dry-run" || "${DRY_RUN:-}" == "1" ]]; then
  echo "Pages project: $PROJECT"
  echo "Pages envs: $ENVS"
  printf 'Pages secrets:'
  for secret in "${SECRETS[@]}"; do
    printf ' %s' "$secret"
  done
  printf '\n'
  exit 0
fi

for env in $ENVS; do
  for secret in "${SECRETS[@]}"; do
    put_secret "$env" "$secret"
  done
done

echo "Done. Redeploy so new deployments bind secrets: cd dashboard && npm run deploy"
