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

## Files

### CSS Components (21 files)
`css/design-system.css` + `css/components/` — badge, button, card, chart, conn-status, dropdown, dropzone, empty-state, error-state, filters, form, json-viewer, modal, skeleton, stat-card, table, tabs, ticker, timeline, toast, tooltip

### JS Modules (11 files)
| Module | Exports | Purpose |
|--------|---------|---------|
| `constants.js` | `ZONE_COLORS`, `ENDPOINT_ZONE_MAP`, `REFRESH_INTERVALS`, `getZoneColor()`, `getRefreshInterval()`, `getZone()` | Canonical constants for zones, endpoints, refresh timing |
| `design-system.js` | `ComponentFactory`, `getZoneColor`, `getRefreshInterval`, `getZoneName` | Re-exports + descriptor factories |
| `api-client.js` | `api`, `apiPost`, `apiPatch`, `apiDelete`, `setGlobalErrorHandler` | Fetch wrapper with dedup, TTL cache, bust-on-mutation, error handler |
| `websocket-client.js` | `WagerSocket`, `PollingFallback` | SSE with exponential backoff (max 10 retries), since-aware reconnect |
| `store.js` | `DataStore` | TTL cache + EventEmitter + fetch-through dedup |
| `status-poller.js` | `StatusPoller` | Polls `/endpoint-status`, derives per-zone health |
| `chart-wrapper.js` | `ChartWrapper` | Chart.js CDN loader with theme-aware defaults |
| `sortable-table.js` | `SortableTable` | Click-to-sort with string/number/date and formatters |
| `json-viewer.js` | `JsonViewer` | Syntax-highlighted JSON with XSS-safe escaping |
| `settings-manager.js` | `SettingsManager` | localStorage-backed settings with import/export |
| `utils.js` | `DateFormatter`, `NumberFormatter`, `Exporter`, `LazyLoader`, `AutoRefreshManager`, `ModalFactory` | Formatters, lifecycle, modals |

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
