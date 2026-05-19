# Fantasy402 ingestion errors — taxonomy and diagnostics

This document maps what you see in the dashboard, Worker API, D1, and R2 to root causes and fixes.

## Where errors are recorded

| Layer | What gets logged | Zod validated? |
|-------|------------------|----------------|
| **Worker POST bodies** | `localIngestSchema`, `refreshAuthSchema`, `updateCookiesSchema`, query schemas in `src/schemas.ts` | **Yes** — 400 + `issues[]` on invalid input |
| **Live wager DO** | `broadcastWagerSchema` in `live-wager-broadcaster.ts` | **Yes** |
| **Upstream Fantasy402 responses** | Not Zod-validated; stored as JSON snapshots or failure archives | **No** — schema varies per endpoint |
| **Dashboard client** | `ApiError` with `status`, `code`, `message`, optional `hint` | **No** — parses Worker JSON errors only |
| **Worker `/trigger` skips** | Console `endpoint ingestion skipped` + run `error_message` JSON `{ skipped, note }` | N/A |
| **Worker `/trigger` failures** | D1 `endpoint_failures` + R2 `fantasy402/{endpoint}/failures/…json` | N/A |
| **Local upload** | D1 `api_snapshots` on success; run row in `ingestion_runs` | Upload payload Zod-validated |

## Error codes (explicit)

Use `GET /ingest/catalog-status` → `blockers[]` and `failureBreakdown24h[]`:

| Code | Meaning | Typical evidence | Fix |
|------|---------|------------------|-----|
| `AUTH_JWT_EXPIRED` | Bearer token past `exp` | `GET /auth/health` or `/diagnostics` → `authorizationExpiry.status: expired`; `/refresh-auth` returns 400 | `npm run auth:refresh-full` (VPS) or paste fresh DevTools capture from `fantasy402.com` |
| `AUTH_NOT_READY` | Missing/expired bearer or CF cookies | `GET /auth/health` → `ingestionReadiness.status: blocked` | `auth:refresh-full`, capture sync, or CF-only refresh (insufficient without JWT) |

### Unattended stack diagnostics

```bash
npm run auth:stack-status          # proxy, files, combined health JSON
npm run auth:preflight             # exit 1 if not ready
npm run auth:preflight -- --refresh  # run auth:refresh-full on failure
F402_AUTO_REFRESH_AUTH=1 npm run ingest:local-batch
```

Local proxy health (`http://127.0.0.1:8791/auth/health`) merges **local** JWT/file state with **worker** `GET /auth/health`. Worker must be deployed for `workerProbe: ok`.
| `CATALOG_INCOMPLETE` | Routes configured but no D1 snapshot | `pendingCount > 0` on `/ingest/catalog-status` | Local/browser ingest (`ingest:local-all` or manager auto-runner) |
| `WORKER_TRIGGER_403` | Worker cron hit upstream 403 | R2 failure body `error code: 1106`; run shows `12 skipped` | **Expected** — use local ingest, not `/trigger` |
| `UPSTREAM_403_IP_OR_PERMISSION` | Same as above in D1 failures | `Fantasy402 API error HTTP 403 on {key}` | Browser same-origin fetch |
| `UPSTREAM_401_UNAUTHORIZED` | Bad/expired auth at upstream | HTTP 401 in failure archive | Refresh JWT |
| `UPSTREAM_429_RATE_LIMIT` | Rate limited | HTTP 429 | Retry later |
| `CUSTOMER_ID_MISSING` | Player `customerID` not resolved | Plan shows `requiresCustomerIdResolution` | Ensure `getPlayers` runs first (auto-prefixed in plan) |
| `CIRCUIT_BREAKER_OPEN` | 3 consecutive failures on endpoint | Worker log `circuit breaker open` | Wait 120s or fix upstream auth |

## Run outcomes (why “success” can look like failure)

Worker `/trigger` with all endpoints **skipped** (403):

- D1 run `status`: `success` (because `endpoints_failed === 0`)
- `error_message`: `{"skipped":12,"note":"All endpoints skipped (upstream 403/404 from Worker IP …)"}`
- Dashboard should show **Run skipped** (not green success)

Local ingest upload:

- `202` when all items archived; cursor advances when `endpointsSucceeded > 0`
- `500` when every item fails validation/archive

## R2 failure archive shape

Path: `fantasy402/{endpointKey}/failures/{date}/{uuid}.json`

```json
{
  "error": "Fantasy402 API error HTTP 403 on getBetTicker",
  "upstream": {
    "status": 403,
    "responseBody": "error code: 1106",
    "request": { "hasAuthorization": true, "hasCfClearance": true, "cookieNames": ["cf_clearance", "__cf_bm"] }
  }
}
```

Cloudflare **1106** = request blocked (Worker egress IP ≠ browser IP for `cf_clearance`).

## Zod validation examples

**Invalid local ingest** → 400:

```json
{ "status": "failed", "message": "Invalid payload", "issues": […] }
```

**Expired JWT on refresh** → 400:

```json
{ "status": "failed", "message": "authorization JWT expired at 2026-05-19T06:04:02.000Z" }
```

## Diagnostic API checklist

1. `GET /diagnostics` — bindings, `upstreamAuthShape`, `ingestionReadiness`
2. `GET /ingest/catalog-status` — `onlineCount`, `pendingCount`, `blockers`, `failureBreakdown24h`
3. `GET /endpoint-status` — `latestRun`, `recentFailures` (historical 24h), `routeLatency`
4. `GET /archive/object?key=…` — full failure JSON for a specific endpoint

## Current production pattern (May 2026)

- **23/86 online** — partial local ingest succeeded for manager batch routes
- **63 pending** — never successfully ingested via browser path
- **JWT expired** — blocks automation until fresh capture
- **Historical “failures”** in Endpoints health — mostly Worker `/trigger` 403s; routes like `getBetTicker` can still be **online** via local ingest
