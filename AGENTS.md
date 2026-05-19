# Agent guide — Fantasy402 / f402-openapi

## Dashboard contract harness

Machine-checkable contracts live under `dashboard/harness/`. Run from `dashboard/`:

```bash
npm run harness:verify       # sync-check + harness tests + checkJs (CI)
npm run test:harness:ci      # CI mode: snapshot drift fails with diff (no auto-update)
npm run test:harness         # 63+ contract tests
npm run test:harness:update  # approve snapshots + performance baseline
npm run harness:sync-check   # metadata vs code (llms.txt, manifests, _worker.js)
npm run harness:report       # console summary + harness/harness-report.json
npm run harness:watch        # re-run sync + tests on file changes
npm test                     # harness + view/link tests
```

## When you change…

| Change | Also update |
|--------|-------------|
| Dashboard API route | `dashboard/harness/metadata/dashboard-api-routes.json`, `dashboard/js/constants.js`, `llms.txt` |
| Public `/api` path | `public-routes.json`, `PUBLIC_API_PATHS`, `dashboard/_worker.js` `isPublicWorkerPath` |
| Sidebar view | `view-routes.json`, `index.html` panel + `data-view` |
| Shared query shape | `schemas.js` + `workers/.../schemas.ts`, `schema-bindings.json`, run `test:harness:update` |
| CSS component | `components.manifest.json`, `dashboard.css` import |

## Live data (no mocks)

Dashboard and Worker use **D1 / R2 / live upstream** — not client-side mocks. Seed via Worker ingest or archives before expecting non-empty views.

## Docs

- Operator context: `llms.txt`
- Harness detail: `dashboard/harness/README.md`
- Ingestion pitfalls: `.cursor/rules/f402-dev-review.mdc`
