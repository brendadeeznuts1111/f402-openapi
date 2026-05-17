# Fantasy402 Ingestion Worker

Cloudflare Worker for scheduled ingestion from the secured Fantasy402 read-only API surface into D1, with raw responses archived to R2.

## Bindings

- `SESSION_KV`: cached authenticated session cookie.
- `ANALYTICS_DB`: D1 database for run metadata, raw snapshot pointers, and normalized metrics.
- `RAW_ARCHIVE`: R2 bucket for raw JSON response and failure archives.

Endpoint calls retry up to three times for transient upstream failures. Final endpoint failures are written to the `endpoint_failures` D1 table and archived to R2 for operator review.

R2 objects use date-partitioned keys:

```text
fantasy402/{endpoint}/{YYYY-MM-DD}/{uuid}.json
fantasy402/{endpoint}/failures/{YYYY-MM-DD}/{uuid}.json
```

Archive objects are written with JSON content type, `Cache-Control: no-store`, rich custom metadata, and the `InfrequentAccess` storage class. D1 stores the R2 key, ETag, size, and storage class for queryable observability.

## Required Secrets

Set these with `wrangler secret put`:

- `FANTASY402_USERNAME`
- `FANTASY402_PASSWORD`
- `FANTASY402_AGENT_ID`
- `INGESTION_TRIGGER_TOKEN`

Optional:

- `FANTASY402_CUSTOMER_ID`
- `ALERT_WEBHOOK_URL`

## Local Setup

```bash
npm install
npm run verify
npm run migrate:local
npm run dev
```

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

## Deployment

Cloudflare context:

- Account ID: `7a470541a704caaf91e71efccc78fd36`
- Zone ID: `a3b7ba4bb62cb1b177b04b8675250674`

Create Cloudflare resources, replace the placeholder binding IDs in `wrangler.toml`, set secrets, apply migrations, then deploy:

```bash
npm run bootstrap:cloudflare
npm run bootstrap:cloudflare:apply
wrangler secret put FANTASY402_USERNAME
wrangler secret put FANTASY402_PASSWORD
wrangler secret put FANTASY402_AGENT_ID
wrangler secret put INGESTION_TRIGGER_TOKEN
npm run migrate:remote
npm run deploy
```

Before a production deploy, run:

```bash
npm run validate:deploy-config
```

This intentionally fails while `wrangler.toml` still contains placeholder KV or D1 IDs.

The default endpoint list is configured in `FANTASY402_INGESTION_ENDPOINTS` and only includes read-shaped operations from the hardened OpenAPI contract.

The complete allowed upstream endpoint catalog is tracked in `upstream-endpoints.json`. Run `npm run validate:upstream-contract` after changing ingestion endpoints; it verifies each path against the secured examples spec and checks auth, role, and rate-limit annotations.

## Worker API Contract

The Worker's own operational API is documented in `openapi.worker.json`.

- `GET /health` is unauthenticated and returns runtime health.
- `POST /trigger` requires `Authorization: Bearer <INGESTION_TRIGGER_TOKEN>`.

Run `npm run validate:openapi` before publishing API docs for this Worker.
