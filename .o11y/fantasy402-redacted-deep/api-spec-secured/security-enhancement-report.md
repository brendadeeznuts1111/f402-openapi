# Fantasy402 Secured OpenAPI Enhancement Report

- Source: `.o11y/fantasy402-redacted-deep/api-spec/openapi.json`
- JSON output: `.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.json`
- YAML output: `.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.yaml`
- Slim JSON output: `.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.slim.json`
- Slim YAML output: `.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.slim.yaml`
- Examples JSON output: `.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.examples.json`
- Examples YAML output: `.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.examples.yaml`
- First-party API paths hardened: `89`
- Credential field names removed: `yes`

## Applied Enhancements

- Added `sessionCookie` and `agentToken` security schemes.
- Added global security requirements and per-operation role metadata through `x-required-roles`.
- Added reusable agent/customer/date schemas and parameter definitions.
- Added form-encoded request schemas for common POST operations and a stricter `PendingRequest` contract.
- Replaced `Report/Pending` response/error contracts with explicit success, 400, 403, and 429 schemas.
- Added rate-limit headers and `x-rate-limit` metadata to first-party API operations.
- Deprecated `Manager/getWebLog` and `Report/getTicketDetailPrint` with security/manual-review annotations.
- Removed credential fields named `Password`, `password`, `pass`, `PasswordF`, `PayoutPassword`, and `PlaceWagerPassword` from schemas/examples.
- Annotated account identifiers and IP-like fields with `x-sensitive` privacy metadata.
- Emitted slim CI/codegen artifacts without bulky observed examples or sample-derived large enums.
- Emitted examples artifacts with small synthetic examples for critical docs and mock-server paths.
