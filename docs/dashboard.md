# Fantasy402 Live Dashboard

Zero-build monitoring UI for the ingestion Worker. Deployed on Cloudflare Pages with an API proxy to the Worker origin.

## URLs

| Environment | URL |
|-------------|-----|
| Production | https://fantasy402-dashboard-5q6.pages.dev |
| Worker API (direct) | https://fantasy402-ingestion.utahj4754.workers.dev |

The dashboard calls `/api/*` on the Pages origin; `dashboard/_worker.js` forwards those requests to the Worker with `INGESTION_TRIGGER_TOKEN` injected server-side.

## Views (9)

| View | Purpose |
|------|---------|
| **Overview** | Stat cards, volume chart (type from Settings), live wager ticker (SSE), agent table, event timeline |
| **Analytics** | Traffic, **route latency** (from latest ingestion run), type distribution, agent volume, JSON viewer |
| **Logs** | Filterable event timeline, agent log table, system health log |
| **Settings** | Theme (dark/light/auto), chart type (volume), API refresh interval, notifications, config import/export |
| **Endpoints** | Worker route manifest, zone filters, ingestion health, browser capture sync, local/console ingest, auth status |
| **Data** | Graded wagers, prop wagers, positions, authorizations, players (D1 query tables) |
| **Alerts** | Alert events, summary, rule management |
| **Activity** | Per-login web log + wager timeline (`GET /customer-activity`, player search POST) |
| **Customers** | Agent weekly figure lite, player search (`player_agents`), per-customer profile facets from D1 |

Charts aggregate the latest **100** wagers client-side (`GET /bet-ticker-wagers?limit=100`) unless noted. See `dashboard/AUDIT.md` for audit details and verification steps.

## Source layout

```
dashboard/
├── index.html          # Markup only (~350 lines)
├── js/app.js           # Entry: navigation, init, event wiring
├── js/views/           # overview, analytics, logs, settings, endpoints, data, alerts, customers
├── js/dom.js           # $, escapeHtml, debounce
├── js/format.js        # fmt, usd, ago (utils.js formatters)
├── js/ui.js            # Toasts, breadcrumbs, tabs, drawer
├── css/dashboard.css   # Single @import bundle (design-system + components)
├── _worker.js          # Pages Function API proxy
└── wrangler.toml
```

Detailed design notes: `dashboard/DESIGN.md`. Changelog: `dashboard/CHANGELOG.md`.

## Key API routes (via `/api` proxy)

| Route | Used by |
|-------|---------|
| `GET /summary` | Overview stat cards |
| `GET /chart-aggregates` | Overview volume chart, Analytics traffic/type/agent charts |
| `GET /upstream-endpoints` | Endpoints view (Upstream Fantasy402 tab; full catalog + `configured`, `online`, `lastSnapshotAt`, `customerIdSource`) |
| `GET /bet-ticker-wagers` | Ticker, logs, event timelines |
| `GET /performance` | Agent tables |
| `GET /live-wagers` | SSE wager stream (Durable Object) |
| `GET /endpoint-status` | Sidebar health, latency chart, system log (`routeLatency` from latest run) |
| `GET /endpoints` | Endpoints view manifest |
| `GET /ingest/catalog-status` | Catalog online/pending counts, batches remaining, auth blocker |
| `GET /ingest/local/plan` | Local ingest batch specs (path, body, content-type) |
| `POST /ingest/local` | Upload browser-fetched snapshots; optional `advanceCursor` |
| `POST /ingestion/advance-cursor` | Rotate batch cursor after local uploads |
| `POST /refresh-auth` | Endpoints quick action |
| `GET /search-customers?q=` | Customers search (player_agents) |
| `GET /customer-profile?customer_id=` | Customer profile facets + account snapshot |
| `GET /weekly-figures` | Latest agent weekly figure lite rows |
| `GET /customer-activity?login=` | Web logs + wagers for a player login |
| `POST /customer-activity-search` | Player search for activity monitor |

`GET /endpoint-status` returns:

- `latestRun` — most recent ingestion run
- `recentFailures` — failures in the last 24 hours
- `routeLatency` — per-route `avg_duration_ms` / `max_duration_ms` from `api_snapshots` for the latest run (Analytics latency tab)

Trigger an ingestion run before expecting latency data. Worker `/trigger` skips IP-bound upstream routes (403); use **local ingest** instead:

1. **From your machine:** `cd workers/fantasy402-ingestion && npm run ingest:local-batch` (or `ingest:local-all` for full catalog — ~8 batches of 12)
2. **From Pages dashboard:** Endpoints → **Install auto-runner** → paste in DevTools on `fantasy402.com/manager.html` (same-origin fetch; required because CORS blocks Pages → fantasy402.com)
3. **Customer-scoped routes** (`getPending`, `Pending`, `getCommunicationMessages`): plan auto-prepends `getPlayers`; clients fetch it first to cache player `customerID` before other customer endpoints

The auto-runner fetches fantasy402.com same-origin, uploads via `/api/ingest/local`, and advances the batch cursor. Full catalog needs **ceil(86/12) = 8** successful batches (or leave auto-runner on 5‑min interval).

**Online vs configured:** `configured` means the route is in the ingestion rotation. **`online`** means at least one successful snapshot exists in D1 (`api_snapshots`). Worker cron alone rarely marks routes online (403 skips); local ingest does.

## Local development

```bash
cd dashboard
npm run sync:dev-vars:all   # writes dashboard/.dev.vars + merges worker/.dev.vars
npm run dev                 # Pages on :8788; proxies to production Worker (archive token)

# Local ingestion worker (wrangler dev --remote on :8789):
npm run dev:local           # syncs dev-token + http://127.0.0.1:8789 upstream
```

`predev` runs `sync-dev-vars.mjs` automatically. Production proxy needs `INGESTION_TRIGGER_TOKEN` to match the deployed Worker secret (`.archive-auth-token` or 1Password). If `/api/summary` returns 401, use `npm run dev:local` or update the Worker secret / token file.

Open the served URL (typically `http://localhost:8788`). Static assets and `/api/*` proxy run together.

## Deployment

```bash
cd dashboard
npx wrangler pages deploy . --project-name=fantasy402-dashboard
```

Set the Pages secret on **both** production and preview (branch deploys use preview secrets):

```bash
cd dashboard
./scripts/set-pages-secrets.sh
# or: npm run secrets:all   # pipes from ../workers/fantasy402-ingestion/.archive-auth-token
npm run deploy
```

If `wrangler` fails with API token auth errors, run without `CLOUDFLARE_API_TOKEN` in the environment so Wrangler uses OAuth (`unset CLOUDFLARE_API_TOKEN`).

Without this secret, protected `/api/*` routes return **500** with `code: MISSING_PAGES_TOKEN`. Public routes **`/api/health`** and **`/api/live-wagers`** (SSE) work without the secret so live wagers and health checks still function.

**Preview vs production:** Each `*.pages.dev` deployment hash is tied to the build that created it. After changing Pages secrets, **redeploy** (`npm run deploy`). Old hashes (e.g. `b6972826…`) keep the old proxy env and keep failing. Prefer **https://fantasy402-dashboard-5q6.pages.dev** (production) or the branch alias. Preview env needs the same token as the Worker; `./scripts/set-pages-secrets.sh` can read it from 1Password when `.archive-auth-token` is absent.

**1Password console noise:** `webauthn-listeners.js: Cannot overwrite navigator.credentials…` is from the 1Password browser extension, not this dashboard — safe to ignore.

Redeploy the Worker when adding new API fields (e.g. `routeLatency` on `/endpoint-status`).

## Worker auth health (Endpoints tab)

The Endpoints view loads public `GET /api/auth/health` (Worker `GET /auth/health`). **Ingestion Health** includes a worker-auth timeline row; **auth status** badges show stored capture vs worker readiness. **Probe worker auth** re-fetches health; **Copy VPS setup** copies the local proxy + refresh CLI block. When auth is blocked, the UI suggests `npm run auth:refresh-full` and `npm run auth:preflight -- --refresh` in `workers/fantasy402-ingestion/`.

## Related docs

- Worker operator guide: `workers/fantasy402-ingestion/README.md` (Live Dashboard section)
- **Ingestion error taxonomy:** `docs/ingestion-errors.md`
- Secured upstream API contract: `docs/fantasy402-api.md`
- OpenAPI Pages portal: `docs/cloudflare-pages.md`
