# Fantasy402 Secured Contract Changelog

## 2.0.0-secured-observed

- Added secured OpenAPI contract generated from the redacted observed capture.
- Added `sessionCookie` and `agentToken` security schemes.
- Added global and per-operation security requirements for first-party `/cloud/api/*` operations.
- Added `x-required-roles`, `x-rate-limit`, and security-review metadata across first-party operations.
- Removed credential fields from schemas and examples.
- Added sensitive-data annotations for account and network identifiers.
- Added slim contract artifacts for CI and SDK generation.
- Added examples contract artifacts with synthetic, non-sensitive examples for critical endpoints.
- Added contract tests for critical examples and all response examples attached to schemas with `x-sensitive: true`.
- Added optional staging probe for nightly live conformance checks.
- Added static documentation under `site/`.
- Added developer portal manifest for publication handoff.
