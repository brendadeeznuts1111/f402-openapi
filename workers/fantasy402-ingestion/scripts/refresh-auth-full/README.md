# refresh-auth-full

Headless Puppeteer login, `sessionStorage` harvest, and `POST /refresh-auth` for unattended VPS auth.

## Setup

```bash
cd workers/fantasy402-ingestion/scripts/refresh-auth-full
npm install
```

From the worker package root you can also run `npm run auth:refresh-full` (uses repo `tsx`).

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `FANTASY402_USERNAME` or `FANTASY402_CUSTOMER_ID` | Yes | Login customer ID |
| `FANTASY402_PASSWORD` | Yes | Login password |
| `INGESTION_TRIGGER_TOKEN` | Yes | Bearer for `/refresh-auth` |
| `WORKER_ORIGIN` | No | Worker or local proxy URL for `POST /refresh-auth` |
| `FANTASY402_WORKER_UPSTREAM` | No | Real Worker when `WORKER_ORIGIN` is the local proxy |
| `MAX_RETRIES` | No | Extra CF navigation retries (default `1`) |

## Outputs

- `fantasy402/browser-auth.json` — used by `ingest:local-batch` / `ingest:browser`
- `fantasy402/.auth-refresh-state.json` — `lastSuccessAt`, `jwtExp` for local `/auth/health`

Passwords are **not** written to disk (only JWT + CF cookies in `browser-auth.json`).

## Risks

- Datacenter/VPS IPs may fail Cloudflare more often than a home browser; run ingest on the **same host** as this script.
- Replaces CF-only `refresh-cookies` when scheduled together — use one cron, not both.

## VPS cron

See `deploy/systemd/fantasy402-auth-refresh.timer` or:

```cron
*/15 * * * * cd /path/to/workers/fantasy402-ingestion && npm run auth:refresh-full >> /var/log/fantasy402/auth-refresh.log 2>&1
```
