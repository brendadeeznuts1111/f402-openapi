# Fantasy402 Secured API Contract

Use the secured examples OpenAPI contract as the single source of truth for client teams:

- Developer/docs reference: `.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.examples.yaml`
- SDK/codegen reference: `.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.slim.yaml`
- Static docs: `.o11y/fantasy402-redacted-deep/api-spec-secured/site/index.html`
- Portal metadata: `.o11y/fantasy402-redacted-deep/api-spec-secured/developer-portal-manifest.json`
- Remediation evidence: `.o11y/fantasy402-redacted-deep/api-spec-secured/remediation-closeout.md`

Do not use raw `.o11y` trace captures, observed HTML pages, or the original generated API report as developer references. Those files may contain sensitive operational data and must stay in restricted storage.

## Validation

Run:

```bash
node tools/build-fantasy402-secured-contract.cjs
```

The build validates:

- Internal OpenAPI `$ref` resolution.
- First-party auth, role, and rate-limit metadata.
- Absence of forbidden credential fields.
- Security lint findings.
- Critical examples and sensitive-schema examples.
- Static documentation generation.

## Static Portal

The generated HTML portal includes:

- Copy buttons for rendered code blocks.
- Role filters for `ROLE_AGENT`, `ROLE_MASTER`, and `ROLE_SUB_AGENT` operation rows.
- A rate-limit calculator based on each operation's `x-rate-limit` metadata.
- A sandboxed Worker operator test panel for safe `/health`, `/diagnostics`, scan, and alert-summary requests.
- A collapsible schema section for every component schema, including sensitive-field markers, validation constraints, and operation cross-references.

The secured spec version is `2026-05-17-slim-v1.2`, with `x-api-state: observed`, `x-last-captured: 2026-05-08`, and `x-next-review: 2026-06-08`.

## Publication

Publish `openapi.secured.examples.yaml` and `site/**` to the internal developer portal. Use `openapi.secured.slim.yaml` for generated clients.

Cloudflare Pages deployment is documented in `docs/cloudflare-pages.md`. The repository workflow builds the static portal from the examples spec and can deploy it to the `fantasy402-docs` Pages project when the Cloudflare secrets are configured.

## Live Dashboard

The ingestion Worker exposes an operational API (`workers/fantasy402-ingestion/openapi.worker.json`) consumed by the live dashboard on Cloudflare Pages (`fantasy402-dashboard`). See `docs/dashboard.md` for views, deployment, and the `/endpoint-status` + `routeLatency` contract used by the Analytics latency chart.
