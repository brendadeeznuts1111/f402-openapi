# Fantasy402 Live Dashboard

Zero-build monitoring UI for the ingestion Worker. Deployed on Cloudflare Pages with an API proxy to the Worker origin.

## URLs

| Environment | URL |
|-------------|-----|
| Production | https://fantasy402-dashboard-5q6.pages.dev |
| Worker API (direct) | https://fantasy402-ingestion.utahj4754.workers.dev |

The dashboard calls `/api/*` on the Pages origin; `dashboard/_worker.js` forwards those requests to the Worker with `INGESTION_TRIGGER_TOKEN` injected server-side.

## Views (v3.2)

| View | Purpose |
|------|---------|
| **Overview** | Stat cards, volume chart, live wager ticker (SSE), agent table, event timeline |
| **Analytics** | Traffic, **route latency** (from latest ingestion run), type distribution, agent volume, JSON viewer |
| **Logs** | Filterable event timeline, agent log table, system health log |
| **Settings** | Theme (dark/light/auto), API refresh interval, notifications, config import/export |
| **Endpoints** | Worker route manifest, zone filters, ingestion health, trigger ingest / refresh auth |

## Source layout

```
dashboard/
├── index.html          # Markup only (~350 lines)
├── js/app.js           # Entry: navigation, init, event wiring
├── js/views/           # overview, analytics, logs, settings, endpoints
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
| `GET /bet-ticker-wagers` | Ticker, charts, logs |
| `GET /performance` | Agent tables |
| `GET /live-wagers` | SSE wager stream (Durable Object) |
| `GET /endpoint-status` | Sidebar health, latency chart, system log (`routeLatency` from latest run) |
| `GET /endpoints` | Endpoints view manifest |
| `POST /ingest/local` | Endpoints quick action |
| `POST /refresh-auth` | Endpoints quick action |

`GET /endpoint-status` returns:

- `latestRun` — most recent ingestion run
- `recentFailures` — failures in the last 24 hours
- `routeLatency` — per-route `avg_duration_ms` / `max_duration_ms` from `api_snapshots` for the latest run (Analytics latency tab)

Trigger an ingestion run (`POST /trigger` or dashboard **Trigger Ingestion**) before expecting latency data.

## Local development

```bash
cd dashboard
npx wrangler pages dev . --binding INGESTION_TRIGGER_TOKEN=your_token_here
```

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

Redeploy the Worker when adding new API fields (e.g. `routeLatency` on `/endpoint-status`).

## Related docs

- Worker operator guide: `workers/fantasy402-ingestion/README.md` (Live Dashboard section)
- Secured upstream API contract: `docs/fantasy402-api.md`
- OpenAPI Pages portal: `docs/cloudflare-pages.md`
