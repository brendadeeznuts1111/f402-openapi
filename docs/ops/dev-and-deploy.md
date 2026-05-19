# Dev environment and release deploy

## Prerequisites

- Node 20+ and Bun (for local ingest scripts)
- `wrangler` logged in (`wrangler whoami`)
- Repo secrets in `workers/fantasy402-ingestion/.dev.vars` and repo-root `.dev.vars` (credentials)
- `workers/fantasy402-ingestion/.archive-auth-token` — production `INGESTION_TRIGGER_TOKEN` (same value on Worker + Pages)

## Stable local dev

### 1. Ingestion Worker (D1 remote)

```bash
cd workers/fantasy402-ingestion
npm run migrate:local    # optional local D1
wrangler dev --remote --port 8789
```

Uses `INGESTION_TRIGGER_TOKEN=dev-token-replace-me` from `.dev.vars` for **local** wrangler only.

### 2. Dashboard (Pages dev)

```bash
cd dashboard
npm run sync:dev-vars:all   # merge credentials + write dashboard/.dev.vars
npm run dev:local           # http://localhost:8788 — proxies to :8789
```

| Command | Upstream | Token |
|---------|----------|--------|
| `npm run dev:local` | `http://127.0.0.1:8789` | `dev-token-replace-me` |
| `npm run dev` | Production Worker URL | `.archive-auth-token` |

### 3. Verify before commit

```bash
cd workers/fantasy402-ingestion
npm test
npm run validate:upstream-contract
npm run validate:openapi
npm run validate:runtime-auth

cd dashboard
npm run sync:dev-vars:check
```

## Production deploy

From repo root:

```bash
chmod +x scripts/deploy-release.sh workers/fantasy402-ingestion/scripts/sync-production-token.sh
./scripts/deploy-release.sh
```

Steps performed:

1. Worker tests + contract validators
2. `wrangler d1 migrations apply fantasy402-analytics --remote`
3. Sync `INGESTION_TRIGGER_TOKEN` to Worker from `.archive-auth-token`
4. `wrangler deploy` (ingestion Worker)
5. `set-pages-secrets.sh` (production + preview)
6. `wrangler pages deploy` (dashboard)

Options:

- `--worker-only` — skip Pages
- `--skip-migrate` — skip D1 apply
- `SKIP_PAGES_SECRETS=1` — skip Pages secret put
- `SKIP_WORKER_TOKEN_SYNC=1` — skip Worker token sync

## Token alignment (fix 401 on `/api/*`)

Production Pages proxy and Worker must share the **same** `INGESTION_TRIGGER_TOKEN`:

```bash
# Worker
cd workers/fantasy402-ingestion
./scripts/sync-production-token.sh

# Pages (production + preview)
cd dashboard
./scripts/set-pages-secrets.sh

# Redeploy dashboard after secret change
npm run deploy
```

## URLs

| Service | URL |
|---------|-----|
| Dashboard | https://fantasy402-dashboard-5q6.pages.dev |
| Worker API | https://fantasy402-ingestion.utahj4754.workers.dev |
