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
        DASHBOARD[Dashboard index.html]
        subgraph TABS[Tabs]
            subgraph MONITOR[Monitor Tab]
                SUM[SummaryCards<br/>Live/Graded/TopAgents/TopSport]
                TICKER[LiveWagerTicker<br/>filter type/min]
                AGENT_TABLE[AgentPerformanceTable]
                GRADED_TABLE[GradedWagersTable]
                AUTH_GRID[AuthorizationsGrid]
            end
            subgraph ALERTS_TAB[Alerts Tab]
                RULES_FORM[AlertRulesForm]
                RULES_LIST[AlertRulesList]
                LOG_VIEWER[AlertLogViewer]
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
    DASHBOARD --> TABS
    TABS --> MONITOR & ALERTS_TAB
    SUM --> Q1
    TICKER --> SSE & Q3
    AGENT_TABLE --> Q2
    GRADED_TABLE --> Q4
    AUTH_GRID --> Q7
    RULES_FORM --> AR_CRUD
    RULES_LIST --> AR_CRUD
    LOG_VIEWER --> AL_GET
    TOAST --> TICKER & RULES_FORM
    CONN --> SSE & Q3
    LAST_UPDATE --> TICKER
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

### 6.2 Dashboard Components

| Component | Tab | Description | Data Source |
|-----------|-----|-------------|-------------|
| **Connection Status** | — | SSE/polling indicator (green dot / red dot) | SSE open/error events |
| **Last Update Time** | — | Timestamp of most recent ticker update | ticker push |
| **SummaryCards** | Monitor | 4 KPI cards: live wager count, volume, top agents, top sport | `GET /summary` (15s) |
| **LiveWagerTicker** | Monitor | Scrollable live wager feed, filterable by type + min amount | `GET /live-wagers` SSE + `GET /bet-ticker-wagers` fallback (5s) |
| **AgentPerformanceTable** | Monitor | Agent metrics, sortable by volume/win% | `GET /performance` (15s) |
| **GradedWagersTable** | Monitor | Graded results, filterable by result/agent | `GET /graded-wagers` (10s) |
| **AuthorizationsGrid** | Monitor | Card-style agent permission list | `GET /authorizations` (30s) |
| **AlertRulesForm** | Alerts | Create new alert rules | `POST /alert-rules` |
| **AlertRulesList** | Alerts | Existing rules with toggle/delete | `GET /alert-rules`, `DELETE /alert-rules`, `PATCH /alert-rules` |
| **AlertLogViewer** | Alerts | Breach history, filterable | `GET /alert-log` |
| **Toast Container** | — | Threshold alert toasts + browser notifications | Client-side `checkThresholds()` |

### 6.3 Real‑time Ticker Flow
1. On page load, `connectSSE()` creates an `EventSource` to `/api/live-wagers`.
2. The Durable Object sends `:ok\n\n` (heartbeat) and keeps the connection open.
3. When a wager is ingested, the Worker POSTs to the DO, which writes `data: {...}\n\n` to all sessions.
4. The `onmessage` handler parses the JSON and calls `addWagerToTicker(wager)`.
5. `addWagerToTicker` prepends to an in‑memory array (max 100), updates `tickerSince`, re‑renders the ticker list, checks client‑side thresholds.
6. If SSE fails (no `open` event after 10s), `startPollingFallback()` kicks in, polling `/bet-ticker-wagers` every 5 seconds with a `since` parameter.
7. On `EventSource` error, connection status indicator turns red; fallback continues.

### 6.4 Data Refresh (Static Queries)
- `loadSummary()` — every 15s
- `loadAgents()` — every 15s
- `loadGraded()` — every 10s
- `loadAuth()` — every 30s

All use `fetch(API + path)` and render directly into DOM.

### 6.5 Client‑Side Alerting
- Hardcoded thresholds: `maxWager: 50000` ($500), `maxLossPerAgent: 100000` ($1,000).
- Each new wager passed to `checkThresholds()` — if breached, a toast appears and, if permissions granted, a browser `Notification` is shown.
- Planned: server‑side rules via `alert_rules` table; would replace hardcoded checks with rule evaluation.

### 6.6 State Management (in‑memory)
- `tickerItems` — array of wager objects, newest first.
- `tickerSince` — ISO string of latest wager (for polling).
- `sseSource` / `tickerTimer` — references to SSE connection and polling interval.
- Filter states read from DOM inputs at render time.

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
- **Dashboard:** SSE errors trigger polling fallback; API errors shown inline; `usd()` and `fmt()` handle `null` data.
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

---

## 11. Constraints
- No build step for the dashboard (static deployment).
- No runtime dependencies in the dashboard (pure JS).
- Worker egress to fantasy402.com blocked by WAF → all ingestion must use local browser JWT or cron (which uses a different network path).
- Durable Object concurrency limited to ~100 simultaneous SSE connections (acceptable for internal monitoring).
- JWT auth for browser ingest expires; requires manual copy from logged‑in session.

---

*Document version: 2.0 – covers v2.0 wiring map, SSE over HTTP, circuit breaker, idempotency, covering indexes, R2 archive, health/replay endpoints. Updated 2026-05-18.*

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
