# Auth stack runbook (unattended VPS / local ingest)

Operator guide for headless auth refresh, local Bearer proxy, and browser-origin ingestion.

## Architecture

See [automation-architecture.md](./automation-architecture.md) for **why** the VPS / dashboard / manager planes must not compete, policy knobs, and timer split (conditional refresh vs smart ingest cycle).

```text
┌─────────────────┐     Bearer inject      ┌──────────────────┐     HTTPS      ┌─────────────────┐
│ ingest CLI      │ ─────────────────────► │ local-ingest-proxy│ ─────────────► │ Cloudflare Worker│
│ (no token env)  │   WORKER_ORIGIN=:8791  │ 127.0.0.1:8791    │                │ fantasy402-ingest │
└────────┬────────┘                        └────────▲─────────┘                └────────▲────────┘
         │                                           │                                    │
         │ fantasy402.com (local IP)                 │ auth:refresh-full                  │ AUTH_CACHE KV
         ▼                                           │ (Puppeteer)                        │
┌─────────────────┐                        ┌────────┴─────────┐                ┌────────┴────────┐
│ Upstream API    │                        │ browser-auth.json │                │ GET /auth/health  │
│ (Manager/*)     │                        │ .auth-refresh-state│               │ (public)          │
└─────────────────┘                        └──────────────────┘                └──────────────────┘
```

## Prerequisites

| Secret / file | Purpose |
|---------------|---------|
| `INGESTION_TRIGGER_TOKEN` | Proxy + Worker protected routes (`.archive-auth-token` ok) |
| `FANTASY402_USERNAME` / `FANTASY402_PASSWORD` | Puppeteer login |
| `FANTASY402_WORKER_UPSTREAM` | Real Worker URL (proxy upstream target) |
| `WORKER_ORIGIN=http://127.0.0.1:8791` | CLI targets local proxy |

## Quick commands

```bash
cd workers/fantasy402-ingestion

# Dev (two terminals)
npm run dev:ingest-stack          # T1: proxy
export WORKER_ORIGIN=http://127.0.0.1:8791
npm run auth:check-stack          # T2: validate
npm run auth:refresh-full
npm run ingest:local-batch

# One-shot cycle
npm run ingest:unattended-cycle

# macOS production stack
cp deploy/systemd/ingestion.env.example .env.auth-stack  # edit
npm run ingest:install-mac-stack

# Linux VPS
sudo bash deploy/systemd/install.sh
```

## Health checks

| Endpoint / command | Meaning |
|--------------------|---------|
| `GET http://127.0.0.1:8791/auth/health` | Local JWT files + worker probe |
| `GET https://…workers.dev/auth/health` | Worker KV overlay + ingestion readiness |
| `npm run auth:preflight` | Exit 0 only when ready |
| `npm run auth:stack-status` | Human dump (policy, cycle state, files) |
| `npm run auth:monitor` | Exit 1 if preflight fails or failure streak ≥ threshold |
| `npm run auth:monitor -- --alert` | Same + webhook if `F402_ALERT_WEBHOOK_URL` set |

### Alert webhook

Set in `ingestion.env`:

```bash
F402_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
F402_ALERT_FAILURE_THRESHOLD=3
F402_ALERT_COOLDOWN_MS=3600000
F402_ALERT_WEBHOOK_STYLE=slack   # slack | discord | raw
```

Alerts fire automatically from `ingest:unattended-cycle` after repeated failures. Optional external ping: cron `auth:monitor -- --alert` every 15m.

## Failure playbook

| Symptom | Check | Fix |
|---------|-------|-----|
| `proxy unreachable` | `curl http://127.0.0.1:8791/` | `systemctl start fantasy402-local-proxy` or `npm run ingest:proxy` |
| `worker /auth/health not found` | Deployed Worker version | `npm run deploy` in worker package |
| `local JWT expired` | `fantasy402/browser-auth.json` | `npm run auth:refresh-full` |
| `worker auth blocked` | `curl …/auth/health` JSON `blocker` | Refresh auth; confirm CF cookies + bearer in overlay |
| Puppeteer login fail | `fantasy402/.auth-refresh-failure.png` | CF challenge on VPS IP; run on same host as ingest |
| Ingest 401 | Proxy token missing | Set token in env file used by proxy service only |

## Dashboard

Endpoints tab shows **Worker auth ready/blocked** from `GET /api/auth/health`. Use **Probe worker auth** to refresh. VPS operators still use CLI; dashboard does not run Puppeteer.

## Related

- [ingestion-errors.md](../ingestion-errors.md)
- [dashboard.md](../dashboard.md)
- [workers/fantasy402-ingestion/README.md](../../workers/fantasy402-ingestion/README.md)
