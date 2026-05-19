# Dashboard contract harness

Machine-checkable contracts between the dashboard, Pages proxy, Worker manifest, Zod schemas, OpenAPI components, and design-system CSS.

## Metadata (`metadata/`)

| File | Purpose |
|------|---------|
| `public-routes.json` | Paths that must not require `INGESTION_TRIGGER_TOKEN` on `/api/*` |
| `dashboard-api-routes.json` | Routes the dashboard calls; zone + refresh must match `constants.js` |
| `schema-bindings.json` | Dashboard ↔ worker Zod pairs + required OpenAPI `components.schemas` names |
| `components.manifest.json` | CSS component files imported by `dashboard.css` |

## Test suite (`dashboard/test/harness/`)

| File | Verifies |
|------|----------|
| `route-isolation.test.js` | Sidebar ↔ panels ↔ view modules; no sibling view imports; public vs protected paths |
| `schema-helpers.test.js` | `emptyToUndefined`, `parseOrThrow`, `validationErrorBody`, query builder serialization |
| `zod-validation.test.js` | Data-driven cases in `zod-cases.json` + worker/dashboard edge cases |
| `openapi-schema-names.test.js` | PascalCase names, closed objects, `$ref` resolution, required DTOs |
| `metadata-files.test.js` | `llms.txt`, harness manifests, `openapi.worker.json` structure |
| `metadata-sync.test.js` | `llms.txt` routes/artifacts, view modules, schema exports vs manifests |
| `snapshots.test.js` | OpenAPI + Zod fingerprint snapshots (approve with `test:harness:update`) |
| `error-paths.test.js` | `schema-registry.json` malformed cases + helper error shapes |
| `zod-fixtures.test.js` | Auto-generated valid/invalid fixtures from `z.toJSONSchema` |
| `harness-self.test.js` | Strict `checkJs` compile + no circular harness imports |
| `../harness-contract.test.js` | Cross-layer integration smoke (constants ↔ worker manifest) |

```bash
cd dashboard
npm run test:harness          # all harness tests
npm run test:harness:update   # regenerate snapshots after intentional schema changes
npm run harness:sync-check    # CLI metadata drift check (exit 1 on failure)
npm test                      # harness + view + link tests
```

### Snapshots (`harness/snapshots/`)

- `openapi-schemas.snap.json` — normalized OpenAPI `components.schemas`
- `dashboard-zod-schemas.snap.json` — JSON Schema fingerprints for `schemas.js`
- `worker-zod-schemas.snap.json` — binding worker schemas

Do not edit by hand. Run `npm run test:harness:update` when shapes change on purpose.

## Verification API (`verify.js`)

Import helpers from `../harness/verify.js` when adding new metadata-driven checks.

When adding a dashboard API route, update `dashboard-api-routes.json`, `ENDPOINT_ZONE_MAP`, and `REFRESH_INTERVALS` together. When adding a shared query shape, extend `schema-bindings.json` and both `schemas.ts` / `schemas.js`.
