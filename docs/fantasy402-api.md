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

## Publication

Publish `openapi.secured.examples.yaml` and `site/**` to the internal developer portal. Use `openapi.secured.slim.yaml` for generated clients.
