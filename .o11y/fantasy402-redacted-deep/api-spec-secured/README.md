# Fantasy402 Secured OpenAPI Contract

This directory contains a security-hardened OpenAPI contract derived from the observed browser-to-api capture.

## Artifacts

- `openapi.secured.json` / `openapi.secured.yaml`: full secured contract retaining observed schemas and scrubbed examples.
- `openapi.secured.slim.json` / `openapi.secured.slim.yaml`: CI/codegen-friendly contract with bulky examples and sample-derived large enums removed.
- `openapi.secured.examples.json` / `openapi.secured.examples.yaml`: slim contract plus small synthetic examples for critical docs and mock-server paths.
- `developer-portal-manifest.json`: portal-ready publication metadata pointing client teams to the safe examples spec.
- `site/index.html`: static HTML documentation generated from `openapi.secured.examples.json`.
- `security-enhancement-report.md`: summary of applied hardening.
- `remediation-closeout.md`: team-facing remediation summary and remaining manual-review items.
- `CHANGELOG.md`: secured contract changelog.

## Rebuild

```bash
node tools/build-fantasy402-secured-contract.cjs
```

The rebuild command:

1. Generates the full and slim secured contracts.
2. Generates the minimal examples contract.
3. Validates internal `$ref`s and required security metadata.
4. Lints slim and examples contracts for security invariants.
5. Contract-tests critical synthetic examples against their schemas.
6. Generates static documentation under `site/`.

## Publishing

Publish `openapi.secured.examples.yaml` as the safe developer-portal reference. It contains the same security contract as the slim spec plus a small set of synthetic examples for docs and mock servers.

Use `openapi.secured.slim.yaml` for client generation and CI linting when examples are not needed.

The `developer-portal-manifest.json` file records the intended portal title, visibility, owner tags, recommended spec, codegen spec, and security invariants for whichever internal portal or registry consumes the artifact.

The GitHub Actions workflow uploads `openapi.secured.examples.yaml`, `developer-portal-manifest.json`, `security-enhancement-report.md`, and `site/**` as artifacts. Connect that artifact set to the internal portal deployment job when the portal target is available.

The `Fantasy402 Secured Docs Pages` workflow can build the same static docs and optionally deploy them to GitHub Pages when manually run with `deploy=true`.

The `Fantasy402 Cloudflare Pages` workflow can build the same static docs and optionally deploy them to Cloudflare Pages when manually run with `deploy=true`. The default Cloudflare Pages project is `fantasy402-docs`; it requires the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Nightly Staging Probe

The workflow runs nightly. It always runs offline validation and examples contract tests.

It also runs `tools/test-fantasy402-staging-contract.mjs` when `FANTASY402_STAGING_BASE_URL` is configured as a repository secret. Optional auth secrets:

- `FANTASY402_STAGING_AUTHORIZATION`
- `FANTASY402_STAGING_COOKIE`

The staging probe checks allowed status codes and verifies live JSON responses do not include forbidden credential fields.

## Security Invariants

- First-party `/cloud/api/*` operations must declare authentication.
- First-party operations must include `x-required-roles`, `x-rate-limit`, and a `429` response.
- Credential fields such as `Password`, `password`, `pass`, `PasswordF`, `PayoutPassword`, and `PlaceWagerPassword` are forbidden.
- Account identifiers and network identifiers must be annotated with `x-sensitive`.
- `Manager/getWebLog` remains deprecated until a narrowed audit-log replacement exists.
- `Report/getTicketDetailPrint` remains manual-review until a valid backend method is observed.
- Critical examples for `Pending`, `getPlayers`, `getAgentBilling`, and `getEnterTransactions` must validate against their schemas.
- Every response example whose schema contains `x-sensitive: true` must stay redacted or synthetic.
