# Fantasy402 Ingestion Worker

Cloudflare Worker for scheduled ingestion from the secured Fantasy402 read-only API surface into D1, with raw responses archived to R2.

## Bindings

- `SESSION_KV`: cached authenticated session cookie.
- `AUTH_CACHE`: short-lived browser-derived auth overlay used by `/refresh-auth`.
- `ANALYTICS_DB`: D1 database for run metadata, raw snapshot pointers, and normalized metrics.
- `RAW_ARCHIVE`: R2 bucket for raw JSON response and failure archives.

Endpoint calls retry up to three times for transient upstream failures. Final endpoint failures are written to the `endpoint_failures` D1 table and archived to R2 for operator review.

R2 objects use date-partitioned keys:

```text
fantasy402/{endpoint}/{YYYY-MM-DD}/{uuid}.json
fantasy402/{endpoint}/failures/{YYYY-MM-DD}/{uuid}.json
fantasy402/scans/{YYYY-MM-DD}/{scan_id}.json
fantasy402/screenshots/{scan_id}_{resolution}.png
fantasy402/hars/{scan_id}.har
fantasy402/alerts/{alert_type}/{YYYY-MM-DD}/{uuid}.json
```

Archive objects are written with JSON content type, `Cache-Control: no-store`, rich custom metadata, and the `InfrequentAccess` storage class. D1 stores the R2 key, ETag, size, and storage class for queryable observability.

The Worker also runs a Cloudflare URL Scanner check for `https://fantasy402.com` every six hours. Scan JSON, screenshots, and HAR files are archived to R2, and the latest verdicts are queryable from D1.

## Required Secrets

Production uses Cloudflare account-level Secrets Store bindings, configured in `wrangler.toml` with store ID `ebb0809bc1ba45b0b1b081282c6a7bcc`:

- `FANTASY402_USERNAME`
- `FANTASY402_PASSWORD`
- `FANTASY402_AGENT_ID`
- `CLOUDFLARE_API_TOKEN`

Set `INGESTION_TRIGGER_TOKEN` as a regular Worker secret, or use `ARCHIVE_AUTH_TOKEN` as a fallback alias for existing deployments.

Optional:

- `FANTASY402_CUSTOMER_ID`
- `FANTASY402_SESSION_COOKIE`
- `FANTASY402_CF_CLEARANCE`
- `FANTASY402_CF_BM`
- `FANTASY402_AUTHORIZATION`
- `FANTASY402_USER_AGENT`
- `FANTASY402_REFERER`
- `FANTASY402_BROWSER_HEADERS_JSON`
- `ALERT_WEBHOOK_URL`

`CLOUDFLARE_API_TOKEN` is only for Cloudflare API calls used by the URL Scanner integration. Verify a fresh token before storing it:

```bash
export CLOUDFLARE_API_TOKEN="..."
npm run verify:cf-token
```

The verification command calls the account-scoped Cloudflare endpoint, `GET /accounts/{account_id}/tokens/verify`, and checks URL Scanner access without printing the token.

If username/password login is blocked by the upstream site, set browser-derived auth from a successful request instead of relying on fallback login. The observed login controller uses `POST /cloud/api/System/authenticateCustomer`, and authenticated API calls primarily carry `Authorization: Bearer <token>` plus Cloudflare cookies. The Worker skips fallback login whenever `FANTASY402_AUTHORIZATION` is configured.

When fallback login is possible, the Worker mirrors the browser form: uppercase `customerID` and `password`, `multiaccount=1`, `response_type=code`, `domain=fantasy402.com`, `redirect_uri=fantasy402.com`, `operation=authenticateCustomer`, and `RRO=1`. It extracts the returned bearer token and any `Set-Cookie` app session, stores them in `AUTH_CACHE`, and uses `/cloud/api/System/renewToken` to refresh near-expired cached credentials before ingestion calls.

Some browser-observed calls also require `Authorization: Bearer <token>` plus Cloudflare clearance cookies. Store the bearer value in `FANTASY402_AUTHORIZATION`, the application/session cookie in `FANTASY402_SESSION_COOKIE`, and Cloudflare cookies in `FANTASY402_CF_CLEARANCE` / `FANTASY402_CF_BM`. The Worker composes the outbound `Cookie` header and adds browser-shaped `Origin`, `Referer`, `User-Agent`, `X-Requested-With`, `Sec-*`, and `Priority` headers for upstream calls.

For exact replay of safe browser fingerprint headers from a successful request, set `FANTASY402_BROWSER_HEADERS_JSON` to a JSON object containing only browser metadata headers such as `accept`, `accept-language`, `origin`, `referer`, `user-agent`, `sec-ch-ua`, `sec-fetch-site`, `priority`, and `x-requested-with`. The Worker intentionally ignores `cookie`, `authorization`, `content-type`, `host`, and `content-length` in that JSON so auth and endpoint encoding remain controlled by the ingestion code.

## Environment Matrix

The Worker exposes only presence/absence in `/diagnostics`; never put secret values in logs, OpenAPI artifacts, or docs.

| Name | Kind | Source | Required | Used for |
| --- | --- | --- | --- | --- |
| `SESSION_KV` | Binding | KV namespace | Yes | Session cache and refresh bookkeeping |
| `AUTH_CACHE` | Binding | KV namespace | Yes | Runtime browser auth overlay populated by protected `/refresh-auth` |
| `ANALYTICS_DB` | Binding | D1 database | Yes | Runs, snapshots, failures, scan verdicts, network summaries, alerts |
| `RAW_ARCHIVE` | Binding | R2 bucket | Yes | Raw success/failure archives, scan artifacts, screenshots, HAR files |
| `ENVIRONMENT` | Var | `wrangler.toml` | Yes | Runtime environment label |
| `WORKER_NAME` | Var | `wrangler.toml` | Yes | Deployment identity and diagnostics |
| `CLOUDFLARE_ACCOUNT_ID` | Var | `wrangler.toml` | Yes | URL Scanner account scope |
| `CLOUDFLARE_ZONE_ID` | Var | `wrangler.toml` | Yes | Zone identity for operator context |
| `FANTASY402_BASE_URL` | Var | `wrangler.toml` | Yes | Upstream Fantasy402 origin |
| `FANTASY402_AUTH_STATE` | Var/constant | Code or `wrangler.toml` | No | Static auth flow value for `state`, observed as `true` |
| `FANTASY402_AUTH_MULTIACCOUNT` | Var/constant | Code or `wrangler.toml` | No | Static auth flow value for `multiaccount`, observed as `1` |
| `FANTASY402_AUTH_RESPONSE_TYPE` | Var/constant | Code or `wrangler.toml` | No | Static auth flow value for `response_type`, observed as `code` |
| `FANTASY402_AUTH_DOMAIN` | Var/constant | Code or `wrangler.toml` | No | Static auth flow value for `domain`, observed as `fantasy402.com` |
| `FANTASY402_AUTH_REDIRECT_URI` | Var/constant | Code or `wrangler.toml` | No | Static auth flow value for `redirect_uri`, observed as `fantasy402.com` |
| `FANTASY402_AUTH_OPERATION` | Constant | Code | No | Static auth flow discriminator, always `authenticateCustomer` |
| `FANTASY402_AUTH_RRO` | Var/constant | Code or `wrangler.toml` | No | Static auth flow value for `RRO`, observed as `1` |
| `FANTASY402_INGESTION_ENDPOINTS` | Var | `wrangler.toml` | Yes | Comma-separated read-only ingestion endpoint keys |
| `FANTASY402_ALLOWED_SCAN_HOSTS` | Var | `wrangler.toml` | Yes | URL Scanner host allowlist |
| `FANTASY402_REFERER` | Var/secret | `wrangler.toml` or secret | Recommended | Browser-compatible upstream `Referer` |
| `FANTASY402_USER_AGENT` | Var/secret | `wrangler.toml` or secret | Recommended | Browser-compatible upstream `User-Agent` |
| `FANTASY402_USERNAME` | Secret | Secrets Store | Yes | Fallback login attempt |
| `FANTASY402_PASSWORD` | Secret | Secrets Store | Yes | Fallback login attempt only |
| `FANTASY402_AGENT_ID` | Secret | Secrets Store | Yes | Agent-scoped read-only request bodies |
| `CLOUDFLARE_API_TOKEN` | Secret | Secrets Store | Yes | Cloudflare URL Scanner API |
| `FANTASY402_SESSION_COOKIE` | Secret | Secrets Store | Recommended | Optional browser-observed non-Cloudflare application cookie, if one is present in a successful browser request |
| `FANTASY402_AUTHORIZATION` | Secret | Worker secret | Recommended | Browser-observed bearer token |
| `FANTASY402_CF_CLEARANCE` | Secret | Secrets Store | Recommended | Cloudflare `cf_clearance` cookie |
| `FANTASY402_CF_BM` | Secret | Secrets Store | Recommended | Cloudflare `__cf_bm` cookie |
| `FANTASY402_BROWSER_HEADERS_JSON` | Secret | Secrets Store | Recommended | Allowlisted observed browser metadata headers |
| `FANTASY402_CUSTOMER_ID` | Secret | Worker secret or Secrets Store | Optional | Customer-scoped endpoints |
| `INGESTION_TRIGGER_TOKEN` | Secret | Worker secret | Recommended | Preferred operator bearer token |
| `ARCHIVE_AUTH_TOKEN` | Secret | Worker secret | Fallback | Fallback operator bearer token |
| `ALERT_WEBHOOK_URL` | Secret | Worker secret or Secrets Store | Optional | External alert delivery |

## Local Setup

```bash
npm install
npm run verify
npm run migrate:local
npm run dev
```

To test the deployed Worker through a local viewer/proxy without `wrangler dev`:

```bash
WORKER_ORIGIN="https://fantasy402-ingestion.utahj4754.workers.dev" npm run viewer:proxy
```

Then open `http://127.0.0.1:8790/archive/viewer`. The proxy forwards `/archive`, `/archive/object`, `/scans`, `/diagnostics`, and `/health` to the deployed Worker origin.

To smoke-test the deployed Worker directly:

```bash
npm run smoke:remote
INGESTION_TRIGGER_TOKEN="..." npm run smoke:remote
```

Without a token, the smoke test verifies public health/viewer routes and confirms protected routes return `401`. With a token, it also checks authenticated diagnostics and archive listing.

Cron triggers are active for ingestion and URL Scanner checks. Check capacity or re-apply schedules with:

```bash
npm run cron:status
npm run cron:enable
```

`cron:enable` applies the intended ingestion schedules (`*/15 * * * *` and `0 */6 * * *`) only if the account has enough free trigger capacity. Use `npm run cron:disable` to remove this Worker's schedules without touching other Workers.

Manual ingestion is protected:

```bash
curl -X POST -H "Authorization: Bearer $INGESTION_TRIGGER_TOKEN" http://localhost:8787/trigger
```

Archive readback is protected by the same token:

```bash
curl -H "Authorization: Bearer $INGESTION_TRIGGER_TOKEN" "http://localhost:8787/archive?prefix=fantasy402/getAgentPerformance&limit=25"
curl -H "Authorization: Bearer $INGESTION_TRIGGER_TOKEN" "http://localhost:8787/archive/object?key=fantasy402/getAgentPerformance/2026-05-17/example.json"
```

The Worker also serves a lightweight operator viewer at `/archive/viewer`. The viewer does not embed or persist the token; paste the bearer token into the page to call the protected archive APIs.
The viewer also includes a protected **Scan Now** control for manual URL Scanner runs, plus scan summaries, scan evidence previews, diagnostics, and alert testing.

URL Scanner network policy alerts are enabled for unexpected hosts, new third-party hosts, and failed HTTP requests. Configure the allowlist with `FANTASY402_ALLOWED_SCAN_HOSTS`; it defaults to `fantasy402.com,www.fantasy402.com` in `wrangler.toml`.
Each alert event is stored in D1 and the full alert payload is archived to R2. The alert list returns `r2_key` for fresh events so operators can retrieve the exact evidence payload through `/archive/object`.
Use `POST /alerts/policy-test` to create synthetic `url-scan-unexpected-hosts`, `url-scan-new-third-party`, and `url-scan-failed-requests` events without running an external scan.

URL Scanner verdict readback and manual scans use the same bearer token:

```bash
curl -H "Authorization: Bearer $INGESTION_TRIGGER_TOKEN" "http://localhost:8787/scans?limit=20"
curl -H "Authorization: Bearer $INGESTION_TRIGGER_TOKEN" \
  "http://localhost:8787/scans/screenshot?scanId=00000000-0000-4000-8000-000000000000" \
  --output scan-screenshot.png
curl -H "Authorization: Bearer $INGESTION_TRIGGER_TOKEN" \
  "http://localhost:8787/scans/har?scanId=00000000-0000-4000-8000-000000000000" \
  --output scan.har
curl -H "Authorization: Bearer $INGESTION_TRIGGER_TOKEN" \
  "http://localhost:8787/scans/network-summary?scanId=00000000-0000-4000-8000-000000000000"
curl -H "Authorization: Bearer $INGESTION_TRIGGER_TOKEN" \
  "http://localhost:8787/scans/network-diff?baseScanId=00000000-0000-4000-8000-000000000000&compareScanId=00000000-0000-4000-8000-000000000001"
curl -X POST -H "Authorization: Bearer $INGESTION_TRIGGER_TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://fantasy402.com"}' http://localhost:8787/scans/trigger
curl -H "Authorization: Bearer $INGESTION_TRIGGER_TOKEN" \
  "http://localhost:8787/alerts/summary?days=7&severity=warning"
```

`POST /trigger-scan` is also supported as a compatibility alias for `/scans/trigger`.

## Deployment

Cloudflare context:

- Account ID: `7a470541a704caaf91e71efccc78fd36`
- Zone ID: `a3b7ba4bb62cb1b177b04b8675250674`

Create Cloudflare resources, replace the placeholder binding IDs in `wrangler.toml`, set secrets, apply migrations, then deploy:

```bash
npm run bootstrap:cloudflare
npm run bootstrap:cloudflare:apply
wrangler secret put INGESTION_TRIGGER_TOKEN
npm run migrate:remote
npm run deploy
```

Before a production deploy, run:

```bash
npm run validate:deploy-config
```

This intentionally fails while `wrangler.toml` still contains placeholder KV or D1 IDs.

The default endpoint list is configured in `FANTASY402_INGESTION_ENDPOINTS` and only includes read-shaped operations from the hardened OpenAPI contract. The production default is `getAccountInfoOwner`, which matches the observed authenticated manager browser request and does not require `FANTASY402_CUSTOMER_ID`.

Some discovered browser-to-api operations use different body encodings. The Worker sends form-encoded bodies for the common Manager/Report endpoints and JSON for `Manager/getPending`, matching `openapi.secured.examples.json`.

For default form-encoded ingestion endpoints, the Worker always sends the browser-observed routing tuple together: `RRO=1`, `agentID=<FANTASY402_AGENT_ID>`, `agentOwner=<FANTASY402_AGENT_ID>`, and `operation=<endpoint operation>`. `RRO` is a static non-sensitive request flag and is intentionally kept in code, not Secrets Store.

### Upstream Auth And Cookie Assembly

Fantasy402 accepts browser-shaped authenticated requests. The Worker therefore builds upstream auth from two layers:

| Layer | Source | Precedence | Notes |
| --- | --- | --- | --- |
| Runtime overlay | `AUTH_CACHE`, populated by `POST /refresh-auth` | First | Fast rotation path for browser-derived `authorization`, `sessionCookie`, Cloudflare cookies, and browser metadata headers. |
| App-auth cache | `AUTH_CACHE`, populated by `authenticateCustomer` / `renewToken` | Second | Self-managed app bearer token and app session when the upstream login path is reachable from the Worker. |
| Configured fallback | Secrets Store / Worker secrets | Third | Stable fallback values such as `FANTASY402_SESSION_COOKIE`, `FANTASY402_AUTHORIZATION`, `FANTASY402_CF_CLEARANCE`, and `FANTASY402_CF_BM`. |

Cookie assembly is intentionally conservative. For every upstream Fantasy402 API call, the Worker:

1. Adds `FANTASY402_SESSION_COOKIE` when set.
2. Adds the current session cookie returned by login or `/refresh-auth` when it is not already present.
3. Adds `cf_clearance` from `FANTASY402_CF_CLEARANCE` when it is not already present.
4. Adds `__cf_bm` from `FANTASY402_CF_BM` when it is not already present.
5. Deduplicates by cookie name, not by raw string prefix.

The expected upstream `Cookie` shape is:

```text
app_session=<redacted>; cf_clearance=<redacted>; __cf_bm=<redacted>
```

The observed browser flow can use bearer auth plus Cloudflare cookies without a separate non-Cloudflare application cookie; production ingestion accepts bearer auth plus Cloudflare cookies. Include `sessionCookie` only when a successful browser request actually carries an app cookie; diagnostics reports only cookie names and booleans, never values.

The complete allowed upstream endpoint catalog is tracked in `upstream-endpoints.json`. Run `npm run validate:upstream-contract` after changing ingestion endpoints; it verifies each path against the secured examples spec and checks auth, role, rate-limit annotations, and redaction of every example value mapped to an `x-sensitive: true` schema field.

The secured static docs include an `Operation Request Parameters` section generated from `openapi.secured.examples.json`. The validator fails if any non-GET upstream operation loses its request body schema or required parameter list.

## Worker API Contract

The Worker's own operational API is documented in `openapi.worker.json`.

- `GET /health` is unauthenticated and returns runtime health.
- `POST /refresh-auth` requires `Authorization: Bearer <INGESTION_TRIGGER_TOKEN>` and writes short-lived browser-derived upstream auth to `AUTH_CACHE` without echoing secret values.
- `POST /ingest/local` requires the same bearer token and stores locally fetched Fantasy402 responses into R2/D1 without upstream Worker fetches.
- `POST /trigger` requires `Authorization: Bearer <INGESTION_TRIGGER_TOKEN>`.
- `GET /runs?limit=<n>` lists recent ingestion runs (D1) including success/failure totals.
- `GET /runs/endpoints?runId=<uuid>` lists per-endpoint snapshots and failures for a run, including `trace_id` and `duration_ms` when available.
- `GET /scans` lists recent URL Scanner verdicts and requires the same bearer token.
- `GET /scans/screenshot?scanId=<uuid>` streams the archived scan screenshot from R2 with no-store cache headers.
- `GET /scans/har?scanId=<uuid>` streams the archived HAR network evidence from R2 with no-store cache headers.
- `GET /scans/network-summary?scanId=<uuid>` returns derived HAR counts by host/status/method plus failed, slowest, and largest requests.
- `GET /scans/network-diff?baseScanId=<uuid>&compareScanId=<uuid>` compares two network summaries and reports host/status/method/MIME deltas.
- `POST /scans/trigger` runs a protected manual URL scan.
- `POST /trigger-scan` is a compatibility alias for manual URL scans.
- `GET /alerts/summary?days=<n>&severity=<level>&type=<alert_type>` returns filtered totals, daily buckets, and top affected scans.
- `POST /alerts/policy-test` creates synthetic network-policy alerts and archives their full payloads to R2.

`CLOUDFLARE_ACCOUNT_ID` is configured as a plain Worker variable in `wrangler.toml`, not a secret. `ARCHIVE_AUTH_TOKEN` is accepted only as a compatibility alias for protected operator routes; use `INGESTION_TRIGGER_TOKEN` for new deployments.

Use `/refresh-auth` when a browser session rotates and you need the Worker to use fresh upstream credentials without running `wrangler secret put`:

```bash
curl -X POST "https://fantasy402-ingestion.utahj4754.workers.dev/refresh-auth" \
  -H "Authorization: Bearer $INGESTION_TRIGGER_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "authorization": "Bearer <redacted-browser-jwt>",
    "sessionCookie": "app_session=<redacted-app-cookie-if-present>",
    "cfClearance": "<redacted-cf-clearance>",
    "cfBm": "<redacted-cf-bm>",
    "browserHeaders": {
      "accept": "*/*",
      "accept-language": "en-US,en;q=0.9",
      "origin": "https://fantasy402.com",
      "referer": "https://fantasy402.com/manager.html",
      "user-agent": "Mozilla/5.0 (...) Chrome/... Safari/...",
      "x-requested-with": "XMLHttpRequest"
    },
    "expiresInSeconds": 3600
  }'
```

The cached overlay takes precedence over configured Fantasy402 auth secrets and expires automatically. Production ingestion accepts bearer auth plus Cloudflare cookies; if `sessionCookie` is provided it must contain a non-Cloudflare application cookie rather than only `cf_clearance` or `__cf_bm`. The endpoint returns only accepted field names plus expiry metadata.

When pasting a full browser `Cookie` header, send it as `cookieHeader`; `/refresh-auth` extracts any application session cookie into `sessionCookie` and the Cloudflare cookies into their dedicated fields without echoing values. If diagnostics reports `upstreamAuthShape.ingestionReadiness.status = "blocked"`, refresh the browser request so it includes bearer authorization plus both Cloudflare cookies.

For the production unblock path from the browser machine, copy a successful authenticated Fantasy402 `/cloud/api/*` request as cURL and run:

```bash
pbpaste | INGESTION_TRIGGER_TOKEN="$(cat .archive-auth-token)" npm run ingest:unblock -- -
```

`ingest:unblock` imports the browser auth to the ignored local auth file, rejects captures without `authorization`, `cf_clearance`, `__cf_bm`, and browser headers, refreshes the Worker auth overlay, requires `/diagnostics` to report ingestion-ready, triggers `POST /trigger`, and prints sanitized `/runs/endpoints` evidence with trace IDs, durations, and R2 keys. It never prints bearer or cookie values.

For a local-browser upload run instead, create a local untracked auth file from the template:

```bash
cp fantasy402/browser-auth.example.json fantasy402/browser-auth.json
```

Paste the current browser-derived values into `fantasy402/browser-auth.json`, then run:

```bash
INGESTION_TRIGGER_TOKEN="..." npm run ingest:browser
```

The script posts the auth overlay to `/refresh-auth`, uses the local machine for the Fantasy402 fetches, uploads the already-fetched responses to `POST /ingest/local`, then prints a sanitized summary. It does not solve browser challenges or persist secret values in the repo; `fantasy402/browser-auth.json` is ignored by git.

`/ingest/local` is storage-only: it archives the supplied response bodies to R2 and records D1 snapshots without making upstream calls from Cloudflare. Use it when Worker egress is blocked by the upstream edge.

You can also generate `fantasy402/browser-auth.json` from a browser Network request copied as cURL:

```bash
# Option A: save the copied curl into this ignored local file first:
$EDITOR fantasy402/browser-request.curl

npm run auth:import-curl
INGESTION_TRIGGER_TOKEN="$(cat .archive-auth-token)" npm run ingest:browser
```

On macOS, if `fantasy402/browser-request.curl` does not exist, `npm run auth:import-curl` will try to read the copied cURL from the clipboard via `pbpaste`. You can also pipe directly:

```bash
pbpaste | npm run auth:import-curl -- -
```

Use a successful authenticated `/cloud/api/*` request from the browser. The importer extracts only the local auth/header fields needed by the ingestion script.

For the fastest refresh path from a copied browser request:

```bash
pbpaste | INGESTION_TRIGGER_TOKEN="$(cat .archive-auth-token)" npm run ingest:curl -- -
```

Use `ingest:unblock` instead when you want the Worker to refresh auth, verify diagnostics, trigger production ingestion, and read back `/runs/endpoints` in one command.

The pipeline now hard-fails before `/refresh-auth` if the copied request is missing bearer authorization or either Cloudflare cookie, so a bad capture cannot silently refresh the Worker into an unusable state.

The local ingestion path requires the bearer token and Cloudflare cookies. Include a non-Cloudflare application cookie as `sessionCookie` only if the browser request has one:

```json
{
  "sessionCookie": "app_session=<redacted-app-cookie>"
}
```

If the copied cURL contains `authorization`, `cf_clearance`, `__cf_bm`, and browser headers, it is ingestion-ready even when no app session cookie is present. Otherwise, capture a fresh successful authenticated `/cloud/api/*` request.

Check the local auth file without printing any secret values:

```bash
npm run auth:check
```

Dry-run the configured endpoint request shapes without calling Fantasy402:

```bash
npm run ingest:dry-run
```

The dry-run prints one sanitized entry per endpoint with `bodyKeys`, `hasRRO`, `hasAgentID`, `hasAgentOwner`, `hasCustomerID`, and auth booleans such as `hasSessionCookie`, `hasCfClearance`, and `hasCfBm`. It exits non-zero for missing required bearer/Cloudflare auth or if a customer-scoped endpoint lacks `customerId`.

Or run the full local flow from the copied cURL in one step:

```bash
INGESTION_TRIGGER_TOKEN="$(cat .archive-auth-token)" npm run ingest:curl
```

With no `fantasy402/browser-request.curl` file present, `ingest:curl` imports from the macOS clipboard if the clipboard contains a copied cURL command. The explicit alias is:

```bash
INGESTION_TRIGGER_TOKEN="$(cat .archive-auth-token)" npm run ingest:clipboard
```

To force stdin:

```bash
pbpaste | INGESTION_TRIGGER_TOKEN="$(cat .archive-auth-token)" npm run ingest:curl -- -
```

Run `npm run validate:openapi` before publishing API docs for this Worker.
