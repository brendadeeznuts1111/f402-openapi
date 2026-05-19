# Fantasy402 Ingestion Pipeline & Live Dashboard – System Design

## 1. Overview
A serverless ingestion pipeline that extracts real‑time wager data from the Fantasy402 API,
stores it in Cloudflare D1, and exposes a live monitoring dashboard with Server‑Sent Events (SSE).
All components run on Cloudflare’s edge: Workers, Durable Objects, D1, and Pages.

> **Visual reference:** Run `./endpoint_frontend_wiring_ansi_v2.sh` in a true‑color terminal for a color‑coded ANSI wiring diagram of all components and their data flows.

---

## 2. System Architecture

```mermaid
flowchart TB
    subgraph UPSTREAM[Upstream Fantasy402 API]
        U1[86 Endpoints<br/>fantasy402.com]
    end

    subgraph WORKER[Cloudflare Worker (fantasy402-ingestion)]
        direction TB
        subgraph INGEST[Ingestion Engine]
            CRON[Cron Trigger<br/>5 min adaptive]
            BATCH[POST /ingest/batch]
            LOCAL[POST /ingest/local<br/>(browser JWT)]
        end
        subgraph RESILIENCE[Resilience Layer]
            CB[Circuit Breaker<br/>per endpoint<br/>auto half‑open]
            IDEMP[Idempotency Key<br/>SHA-256<br/>INSERT OR IGNORE]
            ZOD[Zod Validation<br/>versioned schemas]
        end
        subgraph QUERY[Query Endpoints]
            Q1[GET /summary]
            Q2[GET /performance]
            Q3[GET /bet-ticker-wagers]
            Q4[GET /graded-wagers]
            Q5[GET /prop-wagers]
            Q6[GET /position-data]
            Q7[GET /authorizations]
            Q8[GET /health]
            Q9[POST /replay]
        end
        subgraph ALERT_API[Alert Endpoints]
            AR_CRUD[CRUD /alert-rules]
            AL_GET[GET /alert-log]
        end
        subgraph AUTH[Auth & Admin]
            REFRESH[POST /refresh-auth]
            ADMIN_AUTH[Admin Agent Only<br/>alert-rule management]
        end
        subgraph REAL_TIME[Real-time Layer]
            DO[Durable Object<br/>LiveWagerBroadcaster<br/>SSE over HTTP]
            SSE[SSE Stream (HTTP)<br/>/live-wagers<br/>text/event-stream]
            BROADCAST[POST /broadcast<br/>(internal)]
        end
    end

    subgraph PAGES[Cloudflare Pages]
        PROXY[Pages Function Proxy<br/>inject Bearer token<br/>CORS + Rate Limit]
        DASHBOARD[Dashboard index.html v3]
        subgraph VIEWS[4 Views — ESM Modules]
            subgraph OVERVIEW[Overview]
                STATS[6 Stat Cards<br/>volume/agents/PNL/types]
                VOL_CHART[VolumeTrendChart<br/>Chart.js line]
                TICKER[LiveWagerTicker<br/>WagerSocket SSE]
                AGENT_TABLE[SortableAgentTable<br/>click to sort]
                TIMELINE[EventTimeline<br/>wagers + alerts]
            end
            subgraph ANALYTICS[Analytics]
                TRAFFIC[TrafficChart bar]
                LATENCY[LatencyChart line]
                TYPE_CHART[TypeDistribution doughnut]
                AGENT_CHART[AgentVolumeChart bar]
                JSON_VIEW[JsonViewer raw response]
            end
            subgraph LOGS_VIEW[Logs]
                EVENTS[Filterable Event Log]
                AGENT_LOG[Sortable Agent Log Table]
                SYS_LOG[System Log / run history]
            end
            subgraph SETTINGS[Settings]
                GENERAL[General tabs<br/>theme/notifications/sound]
                API_CFG[API config<br/>base URL/interval/items]
                DATA_MGMT[Data Management<br/>dropzone import/export]
            end
        end
        TOAST[Toast Container]
        CONN[Connection Status<br/>SSE/Polling indicator]
        LAST_UPDATE[Last Update Time]
    end

    subgraph DATA[Data Layer]
        D1[(D1 Database<br/>with covering indexes<br/>ingestion_log, alert_rules, alert_log)]
        R2[(R2 Archive<br/>Parquet dumps<br/>>24h data)]
        KV[(KV<br/>Session Cache<br/>SESSION_KV)]
    end

    %% Ingestion flow
    U1 --> CRON
    U1 --> LOCAL
    U1 --> BATCH
    CRON & LOCAL & BATCH --> CB
    CB --> IDEMP
    IDEMP --> ZOD
    ZOD --> D1
    ZOD --> BROADCAST
    BROADCAST --> DO
    DO --> SSE
    D1 --> Q1 & Q2 & Q3 & Q4 & Q5 & Q6 & Q7 & Q8 & Q9
    D1 --> AR_CRUD & AL_GET
    Q9 --> R2
    R2 --> D1

    %% Query endpoints to dashboard
    PROXY --> Q1 & Q2 & Q3 & Q4 & Q5 & Q6 & Q7 & Q8
    PROXY --> AR_CRUD & AL_GET
    PROXY --> SSE
    PROXY --> REFRESH

    %% Dashboard internal wiring
    DASHBOARD --> VIEWS
    STATS --> Q1
    TICKER --> SSE & Q3
    AGENT_TABLE & AGENT_LOG --> Q2
    TIMELINE & EVENTS --> Q3 & AL_GET
    TRAFFIC & TYPE_CHART & AGENT_CHART --> Q3
    JSON_VIEW --> Q1
    SYS_LOG --> ENDPOINT_STATUS[GET /endpoint-status]
    DATA_MGMT --> SETTINGS_MANAGER[SettingsManager localStorage]
    TOAST & CONN & LAST_UPDATE --> TICKER
```

### ANSI Color Zone Legend

| Zone | ANSI Code | Hex Colors | Usage |
|------|-----------|------------|-------|
| 🟦 Worker/Pages | `48;5;17` / `38;5;255` | bg:`#1E3A5F` fg:`#FFFFFF` | Containers, borders |
| 🟧 Ingestion | `48;5;52` / `38;5;208` | bg:`#2D1B0E` fg:`#FF6B35` | Cron, batch, circuit breaker |
| 🟩 Query/Frontend | `48;5;22` / `38;5;84` | bg:`#0E2D1B` fg:`#00FF88` | API endpoints, UI components |
| 🟨 Auth/State | `48;5;58` / `38;5;220` | bg:`#2D2D0E` fg:`#FFD700` | Token injection, rate limits, fallback |
| 🟪 Durable Object | `48;5;53` / `38;5;213` | bg:`#1E0E2D` fg:`#DA70D6` | SSE, hibernation, broadcast |
| 🟫 Data Layer | `48;5;94` / `38;5;180` | bg:`#2D1E0E` fg:`#CD853F` | D1, R2, KV stores |
| ⬆️ Upstream | `48;5;17` / `38;5;64` | bg:`#0E0E2D` fg:`#6B8E23` | Fantasy402 API |
| 🍪 Cookie Automation | `48;5;52` / `38;5;196` | bg:`#2D0E0E` fg:`#FF4444` | Puppeteer, Cloudflare challenge |
| 🌐 Networking/Scanner | `48;5;17` / `38;5;39` | bg:`#0E1E3A` fg:`#00BFFF` | URL scanner, security analysis |

## 3. Full Wiring Matrix (v2.0)

| # | Endpoint | Method | Auth | Rate Limit | Dashboard Component | Refresh/Trigger | Data Flow | Notes |
|---|----------|--------|------|------------|--------------------|----------------|-----------|-------|
| 1 | `/ingest/local` | POST | Bearer | 10/min | (Pipeline) | Manual browser JWT | Browser JWT → CB → IDEMP → ZOD → D1 → DO3 | Local browser ingest |
| 2 | `/ingest/batch` | POST | Bearer | 5/min | (Pipeline) | Runner scripts | Batch → CB → IDEMP → ZOD → D1 → DO3 | Bulk runner scripts |
| 3 | `/refresh-auth` | POST | Bearer | 1/min | (Auth subsystem) | On 401 or cron | Rotates upstream token | Auto + manual trigger |
| 4 | `/live-wagers` | GET | Public (CORS) | N/A | **LiveWagerTicker** (primary) | Persistent SSE | SSE over HTTP → addWagerToTicker() | Fallback on failure |
| 5 | `/broadcast` | POST | Internal | N/A | (DO internal) | Event-driven | Worker → DO → all SSE clients | Internal only |
| 6 | `/bet-ticker-wagers` | GET | Bearer | 60/min | **LiveWagerTicker** (fallback) | 5s interval | `?since=` cursor for dedup | Polling fallback |
| 7 | `/summary` | GET | Bearer | 20/min | **SummaryCards** (4 KPIs) | 15s | Daily rollup from D1 | Cached in DO for 5s |
| 8 | `/performance` | GET | Bearer | 30/min | **AgentPerformanceTable** | 15s | `?agent_id=` filter | Sortable columns |
| 9 | `/graded-wagers` | GET | Bearer | 60/min | **GradedWagersTable** | 10s | `?result=W/L/P` filter | Filterable by result |
| 10 | `/prop-wagers` | GET | Bearer | 60/min | **PropWagersPanel** | 15s | `?sport_id=` filter | Future sport views |
| 11 | `/position-data` | GET | Bearer | 30/min | **PositionDataGrid** | 30s | Sport-level exposure | Heatmap data |
| 12 | `/authorizations` | GET | Bearer | 30/min | **AuthorizationsGrid** | 30s | Permission matrix | Card-style agents |
| 13 | `/health` | GET | Public | N/A | **ConnectionStatus** | On error/manual | Worker+D1+DO+upstream status | Public health check |
| 14 | `/replay` | POST | Bearer | 1/min | Admin action (button) | Manual | R2 → D1 backfill | Recovery trigger |
| 15 | `/alert-rules` | CRUD | Bearer+Admin | 20/min | **AlertRulesForm** + **AlertRulesList** | On CRUD | Threshold config CRUD | Admin only (BILLY666) |
| 16 | `/alert-log` | GET | Bearer | 30/min | **AlertLogViewer** | 30s | Filterable history | Breach audit trail |

### 3.1 Critical Real‑Time Path (SSE)

```text
[Dashboard] EventSource connect → Pages Proxy → Worker /live-wagers
→ DO accepts SSE connection → sends :ok heartbeat
→ Client subscribes with filters
→ Worker ingestion inserts wager → POST /broadcast to DO
→ DO iterates all SSE connections → writes data: {...}\n\n
→ Dashboard onmessage → addWagerToTicker() + checkThresholds()
→ Toast + Browser Notification if breached.
```

### 3.2 Fallback Polling Path (if SSE blocked)

```text
SSE error → ConnectionStatus = "error" → after 10s:
startPollingFallback() → fetch /bet-ticker-wagers?since=... (5s)
→ new wagers → addWagerToTicker() (idempotent via id check)
→ ConnectionStatus = "connected" (amber if polling)
```

---

## 4. Backend (Worker)

### 4.1 Endpoints

| Route | Method | Description | Auth |
|-------|--------|-------------|------|
| `/ingest/local` | POST | Accepts local browser ingest payload (Zod validated) | `INGESTION_TRIGGER_TOKEN` |
| `/refresh-auth` | POST | Refreshes server‑side auth token | `INGESTION_TRIGGER_TOKEN` |
| `/bet-ticker-wagers` | GET | Query live wagers | `INGESTION_TRIGGER_TOKEN` |
| `/graded-wagers` | GET | Query graded results | `INGESTION_TRIGGER_TOKEN` |
| `/prop-wagers` | GET | Query prop wagers | `INGESTION_TRIGGER_TOKEN` |
| `/position-data` | GET | Query sport‑level position data | `INGESTION_TRIGGER_TOKEN` |
| `/performance` | GET | Agent performance metrics | `INGESTION_TRIGGER_TOKEN` |
| `/authorizations` | GET | Agent authorization permissions | `INGESTION_TRIGGER_TOKEN` |
| `/summary` | GET | Aggregated daily KPIs | `INGESTION_TRIGGER_TOKEN` |
| `/live-wagers` | GET | SSE stream (Durable Object) | Public (CORS allowed) |
| `/alert-rules` | GET/POST/PATCH/DELETE | Manage alert rules | `INGESTION_TRIGGER_TOKEN` |
| `/alert-log` | GET | View alert breach history | `INGESTION_TRIGGER_TOKEN` |

All routes (except SSE) require `Authorization: Bearer <INGESTION_TRIGGER_TOKEN>`.  
The token is never exposed to the dashboard client; the Pages proxy injects it.

### 4.2 Durable Object: `LiveWagerBroadcaster`
- **Purpose:** Maintain persistent SSE connections with dashboards, push new wagers instantly.
- **Lifecycle:** One global instance (`idFromName("global")`), auto‑created on first request.
- **API:**
  - `GET` → Opens SSE stream, returns `:ok` heartbeat, waits for messages.
  - `POST` (internal) → Receives wager object, broadcasts to all active sessions.
- **Resilience:** Dead sessions removed on write failure; no stale connections accumulate.
- **Message format:** `data: <JSON>\n\n` (generic; the dashboard uses the default `onmessage` handler).

### 4.3 Ingestion Engine
- **Cron trigger:** Runs every 5 minutes, fetches all 86 configured endpoints, maps and stores results.
- **Local browser ingest:** Triggered by `POST /ingest/local` with a JSON payload from the browser script.
- **Data flow:**
  1. Fetch upstream (cron uses server auth; local uses browser JWT).
  2. Pass through Zod schema (validates structure, types, enums).
  3. Map raw response → D1 row format (handles API quirks: lowercase `list`, nested objects).
  4. Store in D1 (batch inserts for performance).
  5. Call `notifyLiveWager()` for each new wager (triggers DO broadcast).

### 4.4 Zod Validation
- All request/response bodies validated with Zod schemas (`src/schemas.ts`).
- Inferred TypeScript types exported for frontend consumption.
- Schemas include: `localIngestSchema`, `refreshAuthSchema`, `wagerQuerySchema`, `performanceQuerySchema`, `authorizationsQuerySchema`, `paginationSchema`.
- D1 results also validated on retrieval to prevent schema drift.

---

## 5. Database (D1)

### 5.1 Tables

#### `bet_ticker_wagers`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto‑increment |
| login | TEXT | Agent/customer login |
| wager_type | TEXT | S(Straight), P(Parlay), M(Moneyline), L(Live) |
| amount_wagered | INTEGER | Amount in cents |
| captured_at | TEXT | ISO timestamp |

#### `graded_wagers` *(migration 0011)*
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | |
| login | TEXT | |
| amount_wagered | INTEGER | |
| net_amount | INTEGER | Profit/loss in cents |
| result | TEXT | W(Win), L(Loss), P(Push) |
| grade_date_time | TEXT | |

#### `prop_wagers` *(0012)*
Same structure as `bet_ticker_wagers` for prop bet events.

#### `agent_position_data` *(0013)*
| Column | Type | Description |
|--------|------|-------------|
| sport_id | TEXT | |
| sport_name | TEXT | |
| total_wagered | INTEGER | |
| total_to_win | INTEGER | |
| wager_count | INTEGER | |

#### `alert_rules` *(planned)*
| Column | Type |
|--------|------|
| id | INTEGER PRIMARY KEY |
| metric | TEXT (wager_amount, agent_volume, etc.) |
| operator | TEXT (gt, gte, lt, lte) |
| threshold | INTEGER |
| severity | TEXT (info, warning, critical) |
| agent_id | TEXT (* or specific) |
| enabled | BOOLEAN |

#### `alert_log` *(planned)*
| Column | Type |
|--------|------|
| id | INTEGER PRIMARY KEY |
| rule_id | INTEGER |
| agent_id | TEXT |
| metric | TEXT |
| actual_value | INTEGER |
| threshold | INTEGER |
| severity | TEXT |
| created_at | TEXT |

---

## 6. Dashboard (Frontend)

### 6.1 Technology
- **Single HTML file** (`dashboard/index.html`) — zero build step.
- **No frameworks** — Vanilla JS, CSS Grid, Custom Properties.
- **Deployed on Cloudflare Pages** with a **Pages Function** (`_worker.js`) as API proxy.
- **Design System** — Extracted into `css/design-system.css` + `css/components/*.css` (17 component stylesheets). Loaded via `<link>` tags.
- **Naming Convention** — BEM (Block__Element--Modifier), e.g. `.ds-modal__content`, `.ds-badge--error`. No `ds-` prefix — all classes are design-system native and scoped by component file.
- **Shared Constants** — `js/constants.js` holds canonical `ZONE_COLORS`, `ENDPOINT_ZONE_MAP`, and `REFRESH_INTERVALS`. Single source of truth for both Worker and Dashboard.

### 6.1.1 File Structure

```
dashboard/
├── index.html                 # Main entry (zero build step, ESM modules)
├── _worker.js                 # Pages Function proxy (injects Bearer token)
├── wrangler.toml              # Pages deployment config
├── css/
│   ├── design-system.css      # Tokens, reset, utilities, animations, theme, sidebar
│   └── components/
│       ├── card.css           # Card component
│       ├── table.css          # Table component
│       ├── badge.css          # Badge component
│       ├── button.css         # Button component
│       ├── toast.css          # Toast notifications
│       ├── conn-status.css    # Connection status indicator
│       ├── skeleton.css       # Skeleton loaders
│       ├── filters.css        # Filter bar
│       ├── error-state.css    # Zone-colored inline errors
│       ├── tabs.css           # Tab navigation
│       ├── form.css           # Form inputs + rule rows + validation states
│       ├── ticker.css         # Ticker item layout
│       ├── modal.css          # Modal overlay + focus trap
│       ├── chart.css          # Chart.js canvas container
│       ├── dropdown.css       # Dropdown menus
│       ├── tooltip.css        # Tooltip on hover
│       ├── stat-card.css      # 6-card responsive stat grid
│       ├── timeline.css       # Vertical timeline with status dots
│       ├── json-viewer.css    # Syntax-highlighted JSON viewer
│       ├── empty-state.css    # Empty state placeholder
│       └── dropzone.css       # Drag-and-drop file upload
└── js/
    ├── constants.js           # ZONE_COLORS, ENDPOINT_ZONE_MAP, REFRESH_INTERVALS
    ├── design-system.js       # ComponentFactory, getZoneColor, getRefreshInterval, getZoneName
    ├── api-client.js          # api/Post/Patch/Delete with dedup, cache, bust, global error handler
    ├── websocket-client.js    # WagerSocket (SSE) + PollingFallback
    ├── store.js               # DataStore (TTL cache + EventEmitter)
    ├── status-poller.js       # StatusPoller (endpoint health polling)
    ├── chart-wrapper.js       # Chart.js wrapper (CDN loader, theme-aware)
    ├── sortable-table.js      # Click-to-sort table with formatters
    ├── json-viewer.js         # Syntax-highlighted JSON viewer
    ├── settings-manager.js    # localStorage-backed settings with import/export
    └── utils.js               # DateFormatter, NumberFormatter, Exporter, LazyLoader, AutoRefreshManager, ModalFactory
```

### 6.2 Dashboard Components

| Component | View | Description | Data Source |
|-----------|------|-------------|-------------|
| **Connection Status** | — | SSE/polling indicator (green dot / red dot) | SSE open/error events |
| **Last Update Time** | — | Timestamp of most recent ticker update | ticker push |
| **Sidebar** | — | Left nav with view switching + zone status indicators | `StatusPoller` via `GET /endpoint-status` (30s) |
| **StatCards (6)** | Overview | Live wagers, graded, volume, agents, PNL, wager types | `GET /summary` (15s) |
| **VolumeTrendChart** | Overview | Line chart of wager volume over time | `GET /bet-ticker-wagers` (via render) |
| **LiveWagerTicker** | Overview | Scrollable live wager feed, filterable by type + min amount | `WagerSocket` SSE + `PollingFallback` (5s) |
| **SortableAgentTable** | Overview | Click-to-sort agent metrics with currency formatter | `GET /performance` (15s) |
| **EventTimeline** | Overview | Recent events (wagers + alerts) in vertical timeline | `bet-ticker-wagers` + `alert-log` |
| **TrafficChart** | Analytics | Bar chart of wagers per hour | `GET /bet-ticker-wagers` (via render) |
| **LatencyChart** | Analytics | Line chart of endpoint latency (mock data) | Static sample data |
| **TypeDistributionChart** | Analytics | Doughnut chart of wager type mix | `GET /bet-ticker-wagers` (via render) |
| **AgentVolumeChart** | Analytics | Bar chart of top 5 agents by volume | `GET /bet-ticker-wagers` (via render) |
| **JsonViewer** | Analytics | Syntax-highlighted raw API response viewer | `GET /summary` (via render) |
| **EventLogTimeline** | Logs | Filterable event timeline (all/ok/error/warn) | `bet-ticker-wagers` + `alert-log` |
| **AgentLogTable** | Logs | Sortable full agent list | `GET /performance` (via render) |
| **SystemLog** | Logs | Ingestion run history + endpoint failures | `StatusPoller` + `GET /endpoint-status` |
| **GeneralSettings** | Settings | Theme, notifications, sound toggles | `SettingsManager` (localStorage) |
| **ApiSettings** | Settings | API base URL, refresh interval, max ticker items | `SettingsManager` (localStorage) |
| **AppearanceSettings** | Settings | Chart type, log level | `SettingsManager` (localStorage) |
| **DataManagement** | Settings | Config import via dropzone, export, clear cache | `SettingsManager` + `DataStore` |
| **ConfigViewer** | Settings | Live JSON preview of current settings | `SettingsManager.getAll()` |
| **Toast Container** | — | Threshold alert toasts + browser notifications | Client-side `checkThresholds()` |
| **Skeleton Loader** | — | Shimmer placeholder for cards/tables/ticker/charts | CSS `skeleton` class |
| **ErrorState** | — | Zone-colored inline error display | `renderErrorState(msg, endpoint)` |
| **ThemeToggle** | — | Light/dark mode switcher with `localStorage` persistence | `[data-theme="light"]` override |
| **SidebarStatus** | — | Zone health dots (ok/degraded/error) per subsystem | `StatusPoller` → zone derivation |
| **Modal** | — | Overlay dialog with MutationObserver focus trap, Escape, body scroll lock | `ModalFactory` |
| **Dropzone** | Settings | Drag-and-drop JSON config import with validation | `SettingsManager` |

### 6.3 Real‑time Ticker Flow
1. On page load, `connectSSE()` creates an `EventSource` to `/api/live-wagers`.
2. The Durable Object sends `:ok\n\n` (heartbeat) and keeps the connection open.
3. When a wager is ingested, the Worker POSTs to the DO, which writes `data: {...}\n\n` to all sessions.
4. The `onmessage` handler parses the JSON and calls `addWagerToTicker(wager)`.
5. `addWagerToTicker` prepends to an in‑memory array (max 100), updates `tickerSince`, re‑renders the ticker list, checks client‑side thresholds.
6. If SSE fails (no `open` event after 10s), `startPollingFallback()` kicks in, polling `/bet-ticker-wagers` every 5 seconds with a `since` parameter.
7. On `EventSource` error, connection status indicator turns red; fallback continues.

### 6.4 Data Refresh (Static Queries)
- `loadSummary()` — every 15s (`getRefreshInterval('/summary')`)
- `loadAgents()` — every 15s (`getRefreshInterval('/performance')`)
- `loadGraded()` — every 10s (`getRefreshInterval('/graded-wagers')`)
- `loadAuth()` — every 30s (`getRefreshInterval('/authorizations')`)

**Tab visibility optimization:** When `document.hidden` becomes `true`, all polling `setInterval` timers are cleared. When the tab becomes visible again, data is immediately refreshed and timers restart. SSE connection remains alive in the background. This reduces Worker load when the dashboard is not actively viewed.

### 6.4.1 DataStore Layer

A `DataStore` (`js/store.js`) sits between views and the API client:

```
View → DataStore.fetch(key, fetcherFn, ttlMs) → api() → response
                                                    ↕
                                            DataStore (TTL cache)
                                            EventEmitter (on/off)
```

- **TTL caching** — cached entries expire after `ttlMs`. Enables cross-view data sharing without re-fetch.
- **In-flight deduplication** — concurrent `fetch(key)` calls share the same promise.
- **EventEmitter** — `.on(key, fn)` notifies listeners when data changes or is invalidated.
- **Cache invalidation** — `.invalidate(key)` / `.invalidateAll()` for manual bust on mutation.

The low-level dedup in `api-client.js` still operates for same-second duplicate requests. DataStore adds a higher-level cache that persists across tab switches.

### 6.4.2 Global Error Handler

`api-client.js` exports `setGlobalErrorHandler(fn)`. The dashboard wires it to display `.ds-toast-item` notifications on any API error:

```javascript
setGlobalErrorHandler((err, path) => {
  showAlert(`${path}: ${err.message}`, 'error');
});
```

### 6.4.3 Zone Color Deterministic Mapping
Every component derives its accent color from its endpoint's zone via `getZoneColor(endpoint)` in `constants.js`:

| Endpoint Prefix | Zone | Accent Color |
|-----------------|------|--------------|
| `/ingest` | Ingestion | `#FF6B35` |
| `/bet-ticker`, `/performance`, `/graded`, `/authorizations` | Query | `#00FF88` |
| `/alert-rules`, `/alert-log`, `/health`, `/diagnostics`, `/runs` | Auth | `#FFD700` |
| `/live-wagers`, `/broadcast` | Durable Object | `#DA70D6` |
| `/scans`, `/scanner` | Network | `#00BFFF` |
| `/update-cookies` | Cookie | `#FF4444` |
| default | Worker | `#FFFFFF` |

### 6.5 Client‑Side Alerting
- Hardcoded thresholds: `maxWager: 50000` ($500), `maxLossPerAgent: 100000` ($1,000).
- Each new wager passed to `checkThresholds()` — if breached, a toast appears and, if permissions granted, a browser `Notification` is shown.
- Planned: server‑side rules via `alert_rules` table; would replace hardcoded checks with rule evaluation.

### 6.6 Accessibility
- **Tabs** use `<button>` elements with `role="tab"`, `aria-selected`, `aria-controls`, and keyboard-focusable styling.
- **Focus indicators** — `:focus-visible` outline uses `var(--info)` (`#00BFFF`) with 2px offset on all interactive elements.
- **Theme toggle** has `aria-label="Toggle light/dark theme"` and `title` tooltip.
- **Skeleton loaders** provide visual loading state without requiring ARIA live regions (content replaces skeletons atomically).

### 6.7 JS Modules

#### `js/utils.js` — Formatters, exporters, lifecycle

| Utility | Purpose | Edge Cases Handled |
|---------|---------|-------------------|
| `DateFormatter.relative(iso)` | Human-readable relative time | Future dates, null returns `""` |
| `DateFormatter.format(iso, opts)` | Absolute date/time | `{date, time}` options; null safe |
| `NumberFormatter.currency(n)` | `$1,234.56` | Negative, null safe |
| `NumberFormatter.percentage(n, decimals)` | `45.5%` | Negative, null safe |
| `NumberFormatter.compact(n)` | `1.2K`, `3.4M` | Null safe |
| `Exporter.csv(rows, filename)` | Browser CSV download | RFC 4180 quote escaping |
| `Exporter.json(data, filename)` | Browser JSON download | `WeakSet` circular reference detection |
| `LazyLoader.observe(el, cb)` | IntersectionObserver wrapper | Auto-unobserve, WeakMap for GC |
| `AutoRefreshManager` | setInterval registry | `pause()`/`resume()` for visibility changes |
| `ModalFactory.create/open/close/destroy` | Modal dialog | Focus trap, Escape, body scroll lock |

#### `js/store.js` — DataStore

| Method | Purpose |
|--------|---------|
| `store.get(key)` | Returns cached data or `undefined` if expired |
| `store.set(key, data, ttl)` | Stores data with TTL |
| `store.invalidate(key)` | Deletes cache entry + emits change |
| `store.fetch(key, fetcher, ttl)` | Cache-through fetch with in-flight dedup |
| `store.on(key, fn)` / `store.off(key, fn)` | Subscribe to changes for a key |

#### `js/status-poller.js` — StatusPoller

| Member | Purpose |
|--------|---------|
| `statusPoller.start()` | Begins polling `GET /endpoint-status` every 30s |
| `statusPoller.onUpdate` | Callback receives `{ worker, zones, recentFailures, timestamp }` |
| `statusPoller.status` | Snapshot of last known status |

### 6.8 Phase 2 Considerations

| Feature | Status | Notes |
|---------|--------|-------|
| **Virtual scrolling** | Planned | Agent table at 50K rows needs virtualized rendering (e.g. `@tanstack/react-virtual` or native `IntersectionObserver` chunking) or server-side cursor pagination. Current `limit=50` is a stopgap. |
| **Status tooltip detail** | Planned | When a zone dot turns red, show tooltip with failing endpoint name + last error message on hover. |
| **Push notifications** | Planned | Web push or webhook integration for critical alerts. |
| **Multi-tenant dashboard** | Possible | Per-agent views with login. |

### 6.9 Z-Index Hierarchy
```
1000  --z-toast        Toast notifications
2000  --z-modal-backdrop  Modal overlay
3000  --z-modal        Modal content card
4000  --z-dropdown     Dropdown menus
5000  --z-tooltip      Hover tooltips
```

### 6.10 State Management
- `tickerItems` — array of wager objects, newest first (capped at `MAX_TICKER_ITEMS`).
- `tickerSince` — ISO string of latest wager (for SSE since param + polling cursor).
- `WagerSocket` — manages SSE connection lifecycle, reconnect tracking, `since`-aware reconnection.
- `PollingFallback` — dedup-aware polling fallback with `tickerItems` reference for duplicate prevention.
- `DataStore` — TTL-cached fetch-through store for summary, performance, authorizations (cross-view).
- `SettingsManager` — `localStorage`-backed persistent settings with `onChange` listeners.
- `StatusPoller` — 30s interval health polling, zone derivation, sidebar status update.
- Filter states read from DOM inputs at render time (debounced at 300ms for ticker min amount).

---

## 7. Security & Authentication

### 7.1 Worker API
- All query/ingest endpoints require `Authorization: Bearer <INGESTION_TRIGGER_TOKEN>`.
- The token is set as a Cloudflare secret and never exposed in the dashboard.

### 7.2 Dashboard Proxy
- The Pages Function `_worker.js` intercepts all `/api/*` requests.
- It adds the `Authorization` header using the secret bound as an environment variable.
- The dashboard SPA never sees or sends the token.

### 7.3 CORS
- The SSE endpoint (`/live-wagers`) sets `Access-Control-Allow-Origin: *` to allow the dashboard (any origin) to connect. In production, restrict to the dashboard domain.

---

## 8. Deployment

### 8.1 Worker
- `wrangler deploy` from `workers/fantasy402-ingestion`.
- D1 migrations applied via `wrangler d1 execute`.
- Durable Object class automatically deployed.

### 8.2 Dashboard
- `wrangler pages deploy dashboard` (or `wrangler pages deploy .` inside `dashboard/`).
- Secret `INGESTION_TRIGGER_TOKEN` uploaded via `wrangler pages secret put`.

### 8.3 Continuous Integration
- Typecheck (`tsc --noEmit`), tests (`vitest`), and migration checks run before merge.
- All 92+ tests must pass.

---

## 9. Error Handling & Resilience

- **Worker:** Zod returns 400 with detailed issues on invalid input; D1 errors return 500 and are logged.
- **DO:** Handles client disconnects gracefully; dead sessions cleaned on next broadcast.
- **Dashboard:** SSE errors trigger polling fallback; API errors rendered as zone-colored `.ds-error-state` components (query → green, auth → yellow, network → blue, DO → purple); `usd()` and `fmt()` handle `null` data.
- **Data:** D1 results validated with Zod after retrieval to catch schema drift.

---

## 10. Future Enhancements

| Feature | Status |
|--------|--------|
| Server‑side alert rules (D1 + cron) | Planned |
| Historical charts (position data, prop wagers) | Planned |
| User authentication for dashboard (Cloudflare Access) | Planned |
| Mobile‑optimised layout (touch controls, swipe tabs) | Planned |
| Push notifications via webhooks/email | Planned |
| Multi‑sport dashboards (per‑sport views) | Possible |
| Admin panel for rule configuration | Possible |
| Dashboard v3 — 4 views (Overview, Analytics, Logs, Settings) | **Done** |
| Chart.js integration (volume, traffic, latency, distribution) | **Done** |
| Sortable tables, JSON viewer, settings manager | **Done** |
| Config import/export via dropzone | **Done** |
| 7 pitfall fixes (XSS, charts, validation, focus trap) | **Done** |
| ESM module architecture (5+ modules) | **Done** |
| Design system v2.2 (extracted CSS, constants, theme) | **Done** |
| Skeleton loaders + error states | **Done** |
| Request deduplication & caching | **Done** |

---

## 11. Constraints
- No build step for the dashboard (static deployment).
- No runtime dependencies in the dashboard (pure JS).
- Worker egress to fantasy402.com blocked by WAF → all ingestion must use local browser JWT or cron (which uses a different network path).
- Durable Object concurrency limited to ~100 simultaneous SSE connections (acceptable for internal monitoring).
- JWT auth for browser ingest expires; requires manual copy from logged‑in session.

---

*Document version: 3.0 – v3 dashboard with 4 views (Overview, Analytics, Logs, Settings), Chart.js integration, SortableTable, JsonViewer, SettingsManager, 7 pitfall fixes. Updated 2026-05-19.*

---

## 12. Implementation Log

### 2026-05-18 — P0: Idempotency Keys
- **Migration 0016** applied: `idempotency_key TEXT` column + UNIQUE index on `bet_ticker_wagers`, `graded_wagers`, `prop_wagers`.
- **Key formula:** `{table}:{agent_id}:{wager_number}` — deterministic, no crypto needed.
- **Store functions** changed from `INSERT INTO` → `INSERT OR IGNORE INTO` across all three wager tables.
- **Covering indexes** added: `(login, captured_at DESC)` on all three wager tables for dashboard query performance.
- **Types:** `BetTickerWagerRecord`, `GradedWagerRecord`, `PropWagerRecord` now include `idempotencyKey: string`.

### 2026-05-18 — P2: Ingestion Log
- Skipped — `endpoint_failures` table (migration 0002) already tracks per-endpoint failures per run. No redundant `ingestion_log` needed.

### 2026-05-18 — P3: Circuit Breaker
- **Implementation:** KV-backed (`SESSION_KV`), no migration needed.
- **Threshold:** 3 consecutive failures within 120s → circuit opens (endpoint skipped).
- **Auto-reset:** On first success, circuit resets. KV entries expire after 600s.
- **Scope:** Cron ingestion path only (`runIngestion`). Local ingest path skips circuit breaker (user-initiated, should always attempt).
- **Functions:** `shouldCircuitBreak(endpoint, env)` → `recordCircuitStatus(endpoint, success, env)`.

### 2026-05-18 — P4: WebSocket Migration
- Deferred — Pages `_worker.js` proxy can't transparently forward WebSocket upgrades. SSE works for current ~100 concurrent connections.
- Will revisit when Pages Functions natively support WebSocket upgrade pass-through or when dashboard DAU exceeds 50.

### 2026-05-19 — P7: Dashboard v3 — 4 Views, Charts, Sortable Tables, Settings
- **4-view layout**: Overview (6 stat cards + line chart + timeline + sortable agent table), Analytics (multi-tab charts + JSON viewer), Logs (filterable timeline + agent/system logs), Settings (4 tabs with modals, dropzone, config viewer).
- **Chart.js integration**: `ChartWrapper` loads Chart.js from CDN, auto-detects light/dark theme for colors. Used in Overview (volume trend), Analytics (traffic, latency, distribution).
- **SortableTable**: Click headers to sort by string/number/date. Formatter functions for display (e.g., currency).
- **JsonViewer**: Syntax-highlighted JSON with key/string/number/boolean/null color coding.
- **SettingsManager**: `localStorage`-backed settings with defaults, change listeners, import/export.
- **Dropzone**: File drag-and-drop + click-to-upload for JSON config import.
- **Timeline component**: Vertical timeline with colored status dots (success/error/warning/info) for event feeds.
- **Stat cards**: 6-card responsive grid (6→3→2 columns) with icons, values, labels.
- **7 Pitfalls fixed**:
  1. CSS prefix consistency — verified all classes use `ds-` prefix.
  2. ModalFactory focus trap — replaced DOM re-querying with `MutationObserver` for dynamic content.
  3. Empty modal fallback — `tabindex="-1"` on modal container when no focusable children (already present, verified cleanup on close).
  4. CSS validation classes — added `.ds-form-group--valid/invalid`, `.ds-form-input--valid/invalid`, `.ds-form-error`.
  5. WeakMap audit — LazyLoader's `WeakMap` verified safe (no strong references).
  6. Tab visibility — `AutoRefreshManager.pause()` on `document.hidden`, re-register on visible (StatusPoller also pauses).
  7. Date rounding — `DateFormatter` uses explicit `Math.floor` strategy, documented in comments.
- **storeTTL(refreshMs)** — TTL set to 65% of refresh interval so cache expires before next refresh, preventing stale data.
- **WagerSocket max reconnect** — capped at 10 attempts, emits `'failed'` status instead of infinite retry.
- **New CSS components**: `stat-card.css`, `timeline.css`, `json-viewer.css`, `dropzone.css`.
- **New JS modules**: `chart-wrapper.js`, `sortable-table.js`, `json-viewer.js`, `settings-manager.js`.

### 2026-05-18 — P6: ESM Module Architecture + Sidebar + Store + StatusPoller
- **ESM migration**: All JS files converted to ES modules with `export`. `index.html` uses `<script type="module">` with imports from all modules. Backward-compat globals set on `window` for non-module usage.
- **Modules created**: `design-system.js` (ComponentFactory + re-exports), `api-client.js` (dedup + TTL cache + bust-on-mutation + `setGlobalErrorHandler`), `websocket-client.js` (WagerSocket + PollingFallback), `store.js` (DataStore), `status-poller.js` (StatusPoller).
- **api-client.js enhancements**: Cache busts on POST/PATCH/DELETE. `setGlobalErrorHandler(fn)` wires all API errors to dashboard toasts. Mock mode on localhost with realistic mock data.
- **WebSocket client**: `WagerSocket` tracks `since` parameter across reconnections (exponential backoff 1s→30s). `PollingFallback` dedup-aware with `tickerItems` reference.
- **DataStore**: TTL cache with EventEmitter pattern. `fetch(key, fetcher, ttl)` provides cache-through semantics. In-flight dedup per key. Used for summary, performance, and authorizations data.
- **StatusPoller**: Polls `GET /endpoint-status` every 30s, derives per-zone health from failure data, updates sidebar indicators via `onUpdate` callback.
- **Sidebar layout**: Left nav with 4 views (Monitor, Agents, Scans, Alerts). Zone health dots at bottom. Collapses to top nav on mobile (<768px). Styles in `design-system.css` (`.ds-layout`, `.ds-sidebar`, `.ds-sidebar__item`, `.ds-sidebar__status`).
- **Event delegation**: All dynamic content (toggle/delete rule buttons, dismiss toasts) handled via single `document click` listener with `[data-action]` attribute. No `onclick` in HTML.
- **Worker endpoints**: `/endpoints` returns 28-route manifest. `/endpoint-status` returns latest ingestion run + 24h failure history.

### 2026-05-18 — P5: Design System v2.2 Extraction
- **CSS extracted** from inline `<style>` block into `css/design-system.css` (tokens, reset, utilities, animations, theme overrides) + 17 component stylesheets under `css/components/`.
- **Canonical constants** created in `js/constants.js`: `ZONE_COLORS`, `ENDPOINT_ZONE_MAP`, `REFRESH_INTERVALS` with helpers `getZoneColor()`, `getRefreshInterval()`, `getZone()`.
- **Theme switcher** added: `initTheme()` reads `localStorage.getItem("f402-theme")`, falls back to `prefers-color-scheme`. `[data-theme="light"]` overrides all surface, text, and semantic colors.
- **Skeleton loaders** replaced all `<div class="ds-loading">Loading...</div>` placeholders with shimmer-animated `.ds-skeleton` bars.
- **Error boundary component** `.ds-error-state` with zone-colored left border (query → green, auth → yellow, network → blue, DO → purple). All `catch` blocks use `renderErrorState(msg, endpoint)`.
- **Request deduplication + caching** via `fetchWithDedupe()`: in-flight promises reused by key; GET responses cached at `0.8 × refreshInterval`; mutations bypass cache.
- **Animation tokens** added: `--transition-fast: 0.15s ease`, `--transition-normal: 0.3s ease`.
- **Refresh intervals** now sourced from `constants.js` instead of hardcoded values in `setInterval()` calls.
- **Z-index hierarchy** standardized with CSS custom properties: `--z-toast: 1000`, `--z-modal-backdrop: 2000`, `--z-modal: 3000`, `--z-dropdown: 4000`, `--z-tooltip: 5000`.
- **Modal component** (`css/components/modal.css` + `ModalFactory` in `utils.js`): focus trapping, Escape to close, body scroll lock, focus restoration on close.
- **Chart container** (`css/components/chart.css`): responsive canvas wrapper with legend foundation for future chart libraries.
- **Dropdown + Tooltip** components added as CSS-only foundations.
- **JS utilities** (`js/utils.js`):
  - `DateFormatter.relative()` — handles past/future, singular/plural ("1 minute ago" / "2 minutes ago"), "Just now" for < 60s.
  - `NumberFormatter` — currency, percentage (negative support), compact (1.2K, 3.4M).
  - `Exporter.csv()` — RFC 4180 compliant quote escaping. `Exporter.json()` — `WeakSet`-based circular reference detection (replaces cycles with `"[Circular]"`).
  - `LazyLoader` — `WeakMap`-backed (elements GC-able even if not explicitly unobserved). `disconnect()` cleans up observer.
  - `ModalFactory` — focus trap re-queries DOM on every Tab (handles dynamically injected content), falls back to `modal.focus()` when no focusable children exist, restores focus on close, body scroll lock.
