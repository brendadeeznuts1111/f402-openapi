# Fantasy402 Cloudflare Pages Deployment

Cloudflare Pages is the preferred external hosting target for the static Fantasy402 OpenAPI portal.

## Source Artifacts

- Safe portal spec: `.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.examples.yaml`
- Static site output: `.o11y/fantasy402-redacted-deep/api-spec-secured/site`
- Portal entrypoint: `.o11y/fantasy402-redacted-deep/api-spec-secured/site/index.html`
- Portal manifest: `.o11y/fantasy402-redacted-deep/api-spec-secured/developer-portal-manifest.json`

The static site is generated from `openapi.secured.examples.json`, which is built from the safe examples contract. Raw traces and full forensic reports must not be published.

## GitHub Actions Deployment

Use the `Fantasy402 Cloudflare Pages` workflow.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Default Pages project:

- `fantasy402-docs`

The workflow always rebuilds and contract-tests the secured examples spec. It only deploys when manually run with `deploy=true`.

## Direct Deployment

For an operator with Cloudflare access:

```bash
node tools/build-fantasy402-secured-contract.cjs
npx wrangler pages deploy .o11y/fantasy402-redacted-deep/api-spec-secured/site --project-name fantasy402-docs
```

Before deploying, verify the authenticated Cloudflare account:

```bash
npx wrangler whoami
```

## Publication Rules

- Publish `site/**` and `openapi.secured.examples.yaml` only.
- Do not publish raw browser traces, source HTML reports, cookies, session captures, or the full forensic `openapi.secured.json` / `.yaml`.
- Keep `remediation-closeout.md` and `security-enhancement-report.md` available to security and compliance teams through restricted internal channels.
