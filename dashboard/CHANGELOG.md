# Changelog

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
