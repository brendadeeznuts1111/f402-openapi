# Fantasy402 Dashboard v3

Zero-build-step live monitoring dashboard for the Fantasy402 ingestion pipeline. Served via Cloudflare Pages.

## Quick Start

```bash
# Deploy Worker
cd workers/fantasy402-ingestion && wrangler deploy

# Deploy Dashboard
cd dashboard && wrangler pages deploy . --project-name=fantasy402-dashboard
```

## Views

| View | Components |
|------|------------|
| **Overview** | 6 stat cards (live wagers, graded, volume, agents, PNL, types), volume trend chart (Chart.js), live wager ticker (SSE), sortable agent table, event timeline |
| **Analytics** | Traffic bar chart, latency line chart, type distribution doughnut, agent volume bar chart, raw API JSON viewer |
| **Logs** | Filterable event timeline (all/ok/error/warn), sortable agent log table, system health log (run history + failures) |
| **Settings** | General (theme, notifications, sound), API (base URL, refresh interval), Appearance (chart type, log level), Data (dropzone import, export, clear cache) |
| **Endpoints** | Route manifest table with zone/method filters, zone badges, quick actions (ingest, refresh auth), cookie health |

## Files

### CSS
`css/dashboard.css` — bundled `@import` of `design-system.css` + 21 component stylesheets under `css/components/`

### JS Modules
| Module | Purpose |
|--------|---------|
| `app.js` | Entry point — wiring, navigation, init |
| `views/overview.js` | Stat cards, volume chart, agent table, event timeline |
| `views/analytics.js` | Traffic/latency/distribution charts, JSON viewer |
| `views/logs.js` | Event timeline, agent log table, system log |
| `views/settings.js` | Settings tabs, dropzone import, export |
| `views/endpoints.js` | Route manifest, ingestion health, quick actions |
| `dom.js`, `format.js`, `ui.js`, `charts.js`, `theme.js`, `ticker.js` | Shared helpers |
| `constants.js` | `ZONE_COLORS`, `CHART_COLORS`, `ENDPOINT_ZONE_MAP`, refresh intervals |
| `design-system.js` | Re-exports + `ComponentFactory` |
| `api-client.js` | Fetch wrapper with dedup, TTL cache, global error handler |
| `websocket-client.js` | `WagerSocket`, `PollingFallback` (SSE + polling fallback) |
| `store.js` | `DataStore` — TTL cache + pub/sub |
| `status-poller.js` | Polls `/endpoint-status` (includes `routeLatency`) |
| `chart-wrapper.js` | Chart.js CDN loader, theme-aware scales |
| `sortable-table.js` | Click-to-sort tables |
| `json-viewer.js` | Syntax-highlighted JSON |
| `settings-manager.js` | `localStorage` settings + import/export |
| `utils.js` | `DateFormatter`, `NumberFormatter`, `AutoRefreshManager`, etc. |

Operator guide: `../docs/dashboard.md`. Design reference: `DESIGN.md`.

## Architecture

```
Browser → Cloudflare Pages (index.html + _worker.js proxy)
          │
          ├── /api/* → Worker (ingestion + query + alerts)
          │   └── /live-wagers → Durable Object (SSE stream)
          │
          └── / (static assets) → Pages CDN
```

## Naming

BEM convention: `.ds-block__element--modifier`. All classes use `ds-` prefix.
