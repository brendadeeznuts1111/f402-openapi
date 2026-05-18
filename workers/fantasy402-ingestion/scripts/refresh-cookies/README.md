# Refresh Cookies Script

A standalone Node.js script that uses Puppeteer with stealth plugins to solve the Cloudflare challenge on `fantasy402.com`, extract the `cf_clearance` and `__cf_bm` cookies, and push them to the Fantasy402 Worker’s `/update-cookies` endpoint.

## Setup

```bash
cd workers/fantasy402-ingestion/scripts/refresh-cookies
npm install
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REFRESH_COOKIES_WORKER_URL` | Yes | Worker base URL, e.g. `https://fantasy402-ingestion.your-subdomain.workers.dev` |
| `INGESTION_TRIGGER_TOKEN` | Yes | Bearer token used to authenticate with `/update-cookies` |
| `TARGET_URL` | No | Defaults to `https://fantasy402.com` |
| `MAX_RETRIES` | No | Number of extra navigation retries if the challenge doesn’t resolve. Defaults to `1` |

## Run Manually

```bash
export REFRESH_COOKIES_WORKER_URL="https://fantasy402-ingestion.your-subdomain.workers.dev"
export INGESTION_TRIGGER_TOKEN="your-token"
node refresh-cookies.js
```

### With 1Password CLI

If you store secrets in 1Password (e.g., in a `[DEV]` vault under an item named `Fantasy402 Worker`):

```bash
export INGESTION_TRIGGER_TOKEN=$(op item get "Fantasy402 Worker" --vault=DEV --field=INGESTION_TRIGGER_TOKEN --reveal)
export REFRESH_COOKIES_WORKER_URL=$(op item get "Fantasy402 Worker" --vault=DEV --field=REFRESH_COOKIES_WORKER_URL)
node refresh-cookies.js
```

> **Note:** The `--reveal` flag is required for password fields; without it, `op item get` returns placeholder text and the Worker will reject the token as invalid.

## macOS Scheduling (launchd)

Copy `com.fantasy402.refresh-cookies.plist` to `~/Library/LaunchAgents/`, update the paths and env vars inside, then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.fantasy402.refresh-cookies.plist
```

## VPS Scheduling (cron)

Add to your crontab:

```cron
*/15 * * * * cd /path/to/refresh-cookies && INGESTION_TRIGGER_TOKEN=your-token REFRESH_COOKIES_WORKER_URL=https://... node refresh-cookies.js >> /var/log/refresh-cookies.log 2>&1
```
