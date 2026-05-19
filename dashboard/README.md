# Fantasy402 Dashboard v3

Zero-build-step live monitoring dashboard for the Fantasy402 ingestion pipeline. Served via Cloudflare Pages.

## Quick Start

```bash
# Deploy Worker
cd workers/fantasy402-ingestion && npm run deploy

# Pages API proxy needs INGESTION_TRIGGER_TOKEN (production + preview)
cd dashboard && ./scripts/set-pages-secrets.sh && npm run deploy
```

If the dashboard shows **500 / missing token** on `/api/*`, run `set-pages-secrets.sh` then redeploy.

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
| `constants.js` | `ZONE_COLORS`, `getChartColors()`, `ENDPOINT_ZONE_MAP`, refresh intervals |
| `design-system.js` | Re-exports + `ComponentFactory` |
| `api-client.js` | Fetch wrapper with dedup, TTL cache, global error handler |
| `websocket-client.js` | `WagerSocket`, `PollingFallback` (SSE + polling fallback) |
| `store.js` | `DataStore` — TTL cache + pub/sub |
| `status-poller.js` | Polls `/endpoint-status` (includes `routeLatency`) |
| `chart-wrapper.js` | Chart.js CDN loader, theme-aware scales |
| `chart-dom.js` | Plot/frame/canvas markup, loading/empty/error overlays |
| `charts.js` | Named chart registry, `ResizeObserver` on plots |
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

## Charts (canonical markup)

Every chart uses the **framed pattern** so Chart.js cannot expand the card layout. Do not put `<canvas>` directly under `.ds-chart-container`.

```html
<div class="ds-chart-container">
  <div class="ds-chart-title">Volume Trend</div>
  <div class="ds-chart-plot ds-chart-plot--lg">
    <div id="volumeChartWrap"><!-- skeleton / empty / error --></div>
    <div class="ds-chart-plot__frame">
      <canvas id="volumeChart" class="ds-chart-canvas" hidden aria-label="Volume trend chart"></canvas>
    </div>
  </div>
</div>
```

Plot heights: `--sm` 200px, `--md` 240px, `--lg` 320px (see `css/components/chart.css`). `chart-dom.js` repairs legacy markup at runtime; CSS `:not(:has(.ds-chart-plot__frame))` is a fallback only.

Wager charts use **`GET /chart-aggregates?hours=24`** (server-side SQL buckets). Settings → Appearance → **Chart type** applies to the Overview volume chart only (`line` / `bar` / `area`).

**Offline charts:** Chart.js is vendored at `vendor/chart.umd.min.js` (loads before CDN). Each chart has a screen-reader data table (`#volumeChartData`, etc.).

**Upstream catalog:** Endpoints view → **Upstream Fantasy402** tab calls `GET /upstream-endpoints`.

Full audit report: `AUDIT.md`. Token reference: `TOKENS.md`.

## Naming

BEM convention: `.ds-block__element--modifier`. All classes use `ds-` prefix.
