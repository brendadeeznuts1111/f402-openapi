# Fantasy402 OpenAPI And Ingestion

This repository contains the hardened Fantasy402 OpenAPI contract, generated static documentation, and the Cloudflare Worker used for read-only ingestion, R2 archival, URL scanning, and operator diagnostics.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `.o11y/fantasy402-redacted-deep/api-spec-secured/` | Secured OpenAPI artifacts, safe examples spec, slim spec, static docs, portal manifest, and remediation reports. |
| `tools/` | Contract build, lint, repair, static-docs, and contract-test scripts. |
| `workers/fantasy402-ingestion/` | Cloudflare Worker for Fantasy402 ingestion, R2 archives, D1 analytics, scan verdicts, alerts, and operator routes. |
| `.github/workflows/` | CI workflows for secured contract validation, Cloudflare Pages docs, and Worker validation/deployment. |
| `docs/` | Operator docs for the API contract and Cloudflare Pages publication. |
| `llms.txt` | Compact AI-agent discovery map for the repo, specs, docs, and safety constraints. |

Do not publish or commit raw browser traces, live cookies, bearer tokens, local auth captures, or failure archives. The Worker subdirectory has its own `.gitignore` for local auth files.

## Safe Contract Artifacts

Use these as the source of truth:

- Developer reference: `.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.examples.yaml`
- Codegen reference: `.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.slim.yaml`
- Static portal: `.o11y/fantasy402-redacted-deep/api-spec-secured/site/index.html`
- Static machine-readable aliases: `/openapi.json` and `/openapi.yaml` via the generated Cloudflare Pages `_redirects` file
- AI-agent discovery: `.o11y/fantasy402-redacted-deep/api-spec-secured/site/llms.txt` and root `llms.txt`
- Portal manifest: `.o11y/fantasy402-redacted-deep/api-spec-secured/developer-portal-manifest.json`

The examples contract is intentionally safe for client teams. It keeps request/response structure, security annotations, role metadata, rate limits, and redacted examples without carrying raw trace data.

Error responses document `application/problem+json` alongside observed legacy JSON shapes where available. Rate-limited responses include `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

## Prerequisites

- Node.js 22 or newer
- npm
- Wrangler 4.x for Cloudflare deployment
- GitHub CLI for publishing PRs
- Cloudflare account access for optional Pages/Worker deployment

Cloudflare context used by this project:

| Name | Value |
| --- | --- |
| Account ID | `7a470541a704caaf91e71efccc78fd36` |
| Zone ID | `a3b7ba4bb62cb1b177b04b8675250674` |
| Worker | `fantasy402-ingestion` |
| Worker URL | `https://fantasy402-ingestion.utahj4754.workers.dev` |
| Docs Pages project | `fantasy402-docs` |

## Fresh Clone Setup

Install Worker dependencies:

```bash
cd workers/fantasy402-ingestion
npm ci
```

Run the full Worker verification:

```bash
npm run verify
```

Build and validate the secured OpenAPI contract from the repository root:

```bash
node tools/build-fantasy402-secured-contract.cjs
```

Open the static docs locally:

```bash
open .o11y/fantasy402-redacted-deep/api-spec-secured/site/index.html
```

## Worker Runtime Setup

The Worker requires these Cloudflare bindings:

| Binding | Type | Purpose |
| --- | --- | --- |
| `SESSION_KV` | KV | Legacy session/cache bookkeeping. |
| `AUTH_CACHE` | KV | Runtime browser/app auth overlay populated by `/refresh-auth`, `authenticateCustomer`, and `renewToken`. |
| `ANALYTICS_DB` | D1 | Ingestion runs, snapshots, failures, scan verdicts, network summaries, and alert events. |
| `RAW_ARCHIVE` | R2 | Raw success/failure archives, scanner artifacts, screenshots, HAR files, and alert payloads. |

Configured production resources are documented in `workers/fantasy402-ingestion/wrangler.toml`.

Required secrets:

- `FANTASY402_USERNAME`
- `FANTASY402_PASSWORD`
- `FANTASY402_AGENT_ID`
- `CLOUDFLARE_API_TOKEN`
- `INGESTION_TRIGGER_TOKEN` or legacy `ARCHIVE_AUTH_TOKEN`

Recommended runtime auth inputs:

- `FANTASY402_AUTHORIZATION`
- `FANTASY402_CF_CLEARANCE`
- `FANTASY402_CF_BM`
- `FANTASY402_BROWSER_HEADERS_JSON`
- `FANTASY402_SESSION_COOKIE` only when browser traffic includes a non-Cloudflare app session cookie

`cf_clearance` and `__cf_bm` remain the Cloudflare WAF/challenge layer. Production ingestion also needs the upstream application session cookie, such as `ASP.NET_SessionId`, when Fantasy402 requires it. The Worker can manage app-level auth with `authenticateCustomer` and `renewToken` once it can reach the upstream application.

## Local Auth And Ingestion Checks

From `workers/fantasy402-ingestion`:

```bash
npm run auth:check
npm run ingest:dry-run
```

`ingest:dry-run` does not call Fantasy402. It validates the configured endpoint request shapes and prints sanitized fields such as `bodyKeys`, `hasRRO`, `hasAgentID`, `hasAgentOwner`, `hasCustomerID`, cookie names, and browser header count.

To import a successful browser request copied as cURL:

```bash
pbpaste | npm run auth:import-curl -- -
npm run auth:check
```

The generated `fantasy402/browser-auth.json` is ignored and must not be committed.

To unblock production after a browser session expires, copy a successful authenticated Fantasy402 `/cloud/api/*` request as cURL and run:

```bash
pbpaste | INGESTION_TRIGGER_TOKEN="$(cat .archive-auth-token)" npm run ingest:unblock -- -
```

`ingest:unblock` imports the browser auth, rejects captures without an app session cookie such as `ASP.NET_SessionId`, refreshes `/refresh-auth`, requires `/diagnostics` to be ready, triggers ingestion, then prints sanitized `/runs/endpoints` evidence.

## Deploy

Validate before deploy:

```bash
cd workers/fantasy402-ingestion
npm run verify
npm run validate:deploy-config
```

Apply D1 migrations:

```bash
npm run migrate:remote
```

Deploy the Worker:

```bash
npm run deploy
```

Deploy the docs portal through GitHub Actions or directly:

```bash
node tools/build-fantasy402-secured-contract.cjs
npx wrangler pages deploy .o11y/fantasy402-redacted-deep/api-spec-secured/site --project-name fantasy402-docs
```

## Protected Operator Routes

All protected routes require `Authorization: Bearer <INGESTION_TRIGGER_TOKEN>` or the legacy `ARCHIVE_AUTH_TOKEN` fallback.

Common routes:

- `GET /diagnostics`
- `POST /refresh-auth`
- `POST /trigger`
- `POST /ingest/local`
- `GET /archive`
- `GET /archive/object`
- `GET /scans`
- `POST /scans/trigger`
- `GET /alerts/summary`

The operator viewer is served at `/archive/viewer` and does not persist the bearer token.

## Validation Matrix

From `workers/fantasy402-ingestion`:

```bash
npm run typecheck
npm run test
npm run validate:openapi
npm run validate:upstream-contract
npm run validate:runtime-auth
npm run verify
```

From repository root:

```bash
node tools/build-fantasy402-secured-contract.cjs
node tools/test-fantasy402-examples-contract.mjs .o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.examples.json
```

## Security Rules

- Never commit `workers/fantasy402-ingestion/.archive-auth-token`.
- Never commit `workers/fantasy402-ingestion/fantasy402/browser-auth.json`.
- Never commit `workers/fantasy402-ingestion/fantasy402/last-failure.json`.
- Do not paste live bearer tokens, Cloudflare tokens, or cookies into docs, tests, OpenAPI examples, or PR comments.
- Use redacted examples only.
- Keep raw trace artifacts and original HTML reports in restricted storage, not in the public developer portal.

## More Documentation

- API contract guide: `docs/fantasy402-api.md`
- Cloudflare Pages guide: `docs/cloudflare-pages.md`
- Worker-specific guide: `workers/fantasy402-ingestion/README.md`
