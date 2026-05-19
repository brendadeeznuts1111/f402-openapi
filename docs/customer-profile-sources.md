# Customer profile data sources

The Fantasy402 dashboard **Customers** view loads `GET /customer-profile`. Every response includes a `sources` object that documents where each block of data came from and when it was last updated.

## `sources` shape

```json
{
  "blocks": [ /* ProfileBlockStatus[] */ ],
  "schedules": {
    "workerIngestion": "...",
    "authRefresh": "Worker */5 cron",
    "alertEvaluation": "Worker */2 cron",
    "urlScan": "Worker every 6 hours",
    "dashboardProfile": "30s while Customers profile open (live blocks)",
    "dailyProfileWarmup": "Worker 06:00 UTC daily (when enabled)"
  },
  "facetKeys": ["getInfoPlayer", "getCryptoInfo", "getMail", "getTeaserProfile"]
}
```

### `ProfileBlockStatus`

| Field | Meaning |
|-------|---------|
| `id` | Block key (`player`, `getInfoPlayer`, `getPerformancePlayer`, `web_logs`, …) |
| `label` | Human label for the UI |
| `activeSource` | `live`, `seeded`, `failed`, or `none` |
| `kind` | `seeded`, `live`, or `hybrid` |
| `ingestKey` | Upstream Manager operation name |
| `schedule` | How this block is normally refreshed |
| `seeded` | D1 snapshot metadata (`capturedAt`, `snapshotId`, `d1Table`) when present |
| `live` | Live fetch metadata (`fetchedAt`, `ok`, `error`, `upstreamStatus`) when attempted |

### `activeSource` values

| Value | Meaning |
|-------|---------|
| `live` | Current data from a successful upstream call on this profile load |
| `seeded` | Data from D1 (`player_agents`, `customer_accounts`, `customer_profile_facets`, `web_logs`) |
| `failed` | Live upstream was called but failed (auth, HTTP error, etc.) — see `live.error` |
| `none` | No seeded row and no successful live response |

**Hybrid blocks** (`getInfoPlayer`, `account`) prefer **live** when auth works; otherwise they fall back to **seeded** D1 facets.

## D1 tables (seeded)

| Block | Table | Ingest endpoint |
|-------|--------|-----------------|
| Player identity | `player_agents` | `getPlayers` / `getListAgenstByAgent` |
| Account (owner) | `customer_accounts` | `getAccountInfoOwner` |
| Info / crypto / mail / teaser | `customer_profile_facets` | `getInfoPlayer`, `getCryptoInfo`, `getMail`, `getTeaserProfile` |
| Web activity | `web_logs` | `getWebLog` (by login) |

## Live-only blocks

These are **not** written to profile facets; they are fetched on each profile load (with a ~45s worker KV cache for performance and analysis):

- `getPerformancePlayer` — sport breakdown for selected period
- `getReportPlayerAnalysis` — graded wagers for date range

## Manual seed for one customer

**Dashboard:** Customers → open profile → **Seed D1 facets** (calls worker).

**API:**

```http
POST /customer-profile/seed
Content-Type: application/json

{ "customer_id": "GX195", "login": "GX195" }
```

Requires worker auth (same as other dashboard routes). Fetches `getInfoPlayer`, `getCryptoInfo`, `getMail`, `getTeaserProfile` upstream and upserts `customer_profile_facets`.

## Auth refresh

If `activeSource` is `failed` with session or 403 errors, refresh worker auth:

- Dashboard **Endpoints → Refresh auth**, or
- `POST /refresh-auth` / `bun run auth:refresh-full` locally

## Worker schedules

| Cron | Job |
|------|-----|
| `*/5` | JWT / session refresh |
| `*/2` | Alert evaluation |
| `*/15` | Full ingestion catalog (skipped when `FANTASY402_WORKER_TRIGGER_MODE=skip`) |
| `0 */6` | URL scanner |
| `0 6 * * *` | Daily profile warmup: `getPlayers` + seed facets for recently active logins |

## Query parameters (`GET /customer-profile`)

| Param | Default | Notes |
|-------|---------|--------|
| `customer_id` | required | |
| `live` | `1` | Set `0` for D1-only (no upstream) |
| `period` | `0` | Performance week |
| `start_date` / `end_date` | last 14 days | Analysis range |
| `report_type` / `line_type` | `2` | Analysis filters |
