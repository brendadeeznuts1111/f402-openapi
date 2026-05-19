# Changelog

## v3.6.0 — Chart a11y, server aggregates, upstream manifest

### Added
- **`GET /chart-aggregates`** — Server-side hourly volume/traffic, type mix, top agents (replaces client bucketing of 100 rows)
- **`GET /upstream-endpoints`** — All 86 routes from `upstream-endpoints.json` with `configured`, `contentType`, and `operationId`
- **Accessible chart data tables** — Screen-reader-only tabular fallbacks (`#volumeChartData`, etc.) via `chart-data.js`
- **Vendored Chart.js** — `vendor/chart.umd.min.js` with CDN fallback in `chart-wrapper.js`
- **Endpoints view** — Worker API / Upstream Fantasy402 tabs; zone filter includes `upstream`, `data`, `worker`

### Changed
- Overview & Analytics charts use `/chart-aggregates?hours=24`
- Ticker & Logs empty states use `renderEmptyState()`

## v3.5.0 — Design system depth

### Added
- **Token expansion** — shadows, focus ring, chart grid/fill, sidebar widths, typography weights, `--elevated-bg`
- **`css/components/utilities.css`** — `.ds-stack`, `.ds-cluster`, `.ds-sr-only`, `.ds-chart-live`, `prefers-reduced-motion` globals
- **`TOKENS.md`** — token reference for authors
- **JS primitives** — `readDesignToken`, `chartFillColor`, `renderEmptyState`, `renderChartLegend`, `getZoneBadgeClass`
- **HTML chart legend** — `#typeChartLegend` on Analytics distribution tab
- **`aria-live`** region `#chartLiveStatus` for chart load announcements
- **Keyboard nav** — Arrow/Home/End on Analytics chart tabs

### Changed
- **Badges** — `color-mix` on semantic tokens (light/dark aware)
- **Buttons** — focus/disabled states, `--ghost` variant, canonical spacing
- **Zone badges** — light theme overrides via `color-mix`
- **Tabs** — canonical border/focus tokens
- **Cards / stat cards** — `--radius-md`, `--shadow-*`, `--elevated-bg`

## v3.4.1 — UI audit remediations

### Fixed
- **Hour bucketing mismatch** — Overview and Analytics traffic charts now share `bucketWagersByHour()` (datetime keys)
- **`chartType` setting ignored** — Volume chart respects line / bar / area (`area` → line + fill)
- **Appearance save** — `saveAppearance()` re-renders charts via `onChartsThemeChange()`
- **Latency chart DOM** — Empty state uses `showChartMessage` without destroying canvas/registry
- **Analytics errors** — Per-chart `showChartError`; CDN load failures show user-visible message
- **Chart dataset colors** — `getChartColors()` reads CSS tokens (light/dark aware)

### Added
- `ResizeObserver` on `.ds-chart-plot` via `initChartPlotResizeObserver()` (CHANGELOG v3.3 claim now accurate)
- Design tokens `--radius-sm/md/lg`, `--surface`
- `dashboard/AUDIT.md` — design system, charts, a11y, and doc drift report

### Changed
- Log/settings tabs use `.ds-tab-content.ds-active` (same as analytics chart tabs)
- Analytics tabs: WAI-ARIA `role="tab"`, `aria-selected`, `tabpanel`

## v3.4.0 — Canonical chart frames

### Changed
- All charts in `index.html` use `.ds-chart-plot` + `.ds-chart-plot__frame` + `canvas` (documented in `README.md`)
- `chart.css` — framed layout without global `!important`; legacy fallback via `:not(:has(.ds-chart-plot__frame))`

## v3.3.0 — Chart sizing audit

### Fixed
- **Charts growing unbounded** — removed `canvas.height = parent.clientHeight * 2` feedback loop; fixed-height `.ds-chart-plot` wrappers
- **Distribution / latency charts not rendering** — render only when tab is visible; fixed visibility check (CSS class vs inline `display`)
- **Theme toggle resetting analytics tab** — preserve active chart tab across re-renders
- **Doughnut scale warnings** — omit Cartesian `scales` for radial chart types

### Added
- `ResizeObserver` on chart plot containers; `resizeAllCharts()` on sidebar toggle and window resize
- `.ds-view` / `.ds-view--active` — single visible view; avoids hidden panels affecting layout

### Changed
- Chart markup: `.ds-chart-plot` wrappers in `index.html`; removed duplicate `.ds-card` on chart containers

## v3.2.0 — Modular views + route latency

### Added
- **View modules** under `js/views/` (overview, analytics, logs, settings, endpoints) with `js/app.js` entry
- **Shared modules**: `dom.js`, `format.js` (uses `DateFormatter` / `NumberFormatter`), `ui.js`, `charts.js`, `theme.js`, `ticker.js`
- **CSS bundle** `css/dashboard.css` — single `@import` chain replaces 22 `<link>` tags
- **`routeLatency`** on `GET /endpoint-status` — avg/max `duration_ms` per route from latest ingestion run
- Analytics **Latency tab** charts real Worker timing data

### Changed
- `index.html` inline script removed (~930 lines) → `js/app.js`

## v3.1.0 — Design system polish

### Added
- **Unified token palette**: Legacy `--bg`/`--card` aliases map to v2.2 semantic tokens; cards use `--secondary-bg` / `--border-ds`
- **`CHART_COLORS` / `WAGER_TYPE_CHART_COLORS`** in `constants.js` — single source for Chart.js datasets
- **Inter + JetBrains Mono** via Google Fonts
- **Endpoints** view documented (5th nav item); `.ds-zone-badge--data` zone badge
- Badge/timeline **CSS aliases** (`--warn`/`--ok`, wager type names) so JS class names resolve correctly

### Changed
- **Settings → runtime**: Theme (`auto`/`light`/`dark`) and refresh interval now drive `applyTheme()` and `AutoRefreshManager`
- **Latency tab**: Placeholder instead of mock latency data until Worker exposes timings
- **`tag()`**: Wager types `S`/`P`/`M`/`L` map to correct badge classes (no double-escape)
- **`ChartWrapper`**: Reads `--primary-text` / `--secondary-bg` from computed CSS variables

### Fixed
- Cookie health badge (`ds-badge--warn`), timeline dots (`ok`/`warn`), ticker wager badges

## v3.0.0 — Dashboard v3: 4 Views, Charts, Settings

### Added
- **4 views**: Overview (6 stat cards + volume chart + timeline), Analytics (traffic/latency/distribution charts + JSON viewer), Logs (filterable timeline + agent/system logs), Settings (general/API/appearance/data tabs)
- **Chart.js integration**: `ChartWrapper` loads from CDN, auto-detects light/dark theme colors
- **SortableTable**: Click-to-sort with string/number/date types and formatter functions
- **JsonViewer**: Syntax-highlighted JSON with key/string/number/boolean/null color coding
- **SettingsManager**: `localStorage`-backed persistent settings with change listeners and import/export
- **Dropzone**: Drag-and-drop + click-to-upload for JSON config import with validation
- **Stat card grid**: 6-card responsive layout (desktop 6 → tablet 3 → mobile 2 columns)
- **Timeline component**: Vertical event feed with colored status dots (success/error/warning/info)
- **Loading skeletons** for all chart canvases (shown until Chart.js is ready)
- **7 pitfall fixes**: CSS prefix audit, MutationObserver focus trap, form validation classes, WeakMap audit, tab visibility, date rounding, empty modal fallback
- **XSS prevention**: `escapeHtml()` utility used in all user-data renderers
- **Input validation**: Settings save validates API base, refresh interval, max items ranges
- **Debounced filter**: Ticker min amount input debounced at 300ms
- **System log**: Now fetches real `endpoint-status` data instead of hardcoded HTML
- **Chart cleanup**: `destroyAllCharts()` on view switch and theme toggle prevents memory leaks

### Changed
- index.html: Full ESM `<script type="module">` with imports from all JS modules
- Sidebar updated from Monitor/Agents/Scans/Alerts to Overview/Analytics/Logs/Settings
- All `onclick` attributes replaced with `addEventListener` (module scope)
- Event delegation for all dynamic content via `[data-action]` attribute
- ModalFactory focus trap uses MutationObserver instead of per-keypress re-query

### Fixed
- Dropzone: Replaced broken DragEvent+DataTransfer dispatch with direct file input handler
- XSS: All user-facing `innerHTML` now escapes `&<>"'` via `escapeHtml()`
- Settings: Input validation prevents invalid refresh intervals or max items
- Charts: Destroyed on view switch to prevent stale canvas references
- System log: Uses real endpoint-status data instead of hardcoded placeholder

## v2.2 — Design System Extraction

### Added
- CSS extracted into `design-system.css` + 17 component stylesheets
- ESM module architecture: api-client, websocket-client, design-system, store, status-poller, utils
- WagerSocket: SSE client with exponential backoff (max 10 retries), since-aware reconnection
- PollingFallback: Dedup-aware polling with tickerItems reference
- DataStore: TTL-cached fetch-through store with EventEmitter
- StatusPoller: 30s endpoint health polling for sidebar zone indicators
- Worker endpoints: GET /endpoints (28-route manifest), GET /endpoint-status (health)
