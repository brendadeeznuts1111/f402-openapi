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
| Typed navigation (24 tabs) | `js/lib/navigation-config.js`, `navigation-schemas.js`, `public/manifest.json`, `llms.txt` TAB_PATHS, run `test:harness:update` |
| Shared query shape | `schemas.js` + `workers/.../schemas.ts`, `schema-bindings.json`, run `test:harness:update` |
| CSS component | `components.manifest.json`, `dashboard.css` import |

## Live data (no mocks)

Dashboard and Worker use **D1 / R2 / live upstream** — not client-side mocks. Seed via Worker ingest or archives before expecting non-empty views.

## Dashboard navigation (7 groups, 24 tabs)

Source of truth: `dashboard/js/lib/navigation-config.js` (`SIDEBAR_CONFIG`, `TAB_PATHS`, `PATH_TO_TAB`, `GROUP_TABS`). Zod: `navigation-schemas.js`. PWA manifest mirrors `GROUP_TABS` under `public/manifest.json` → `navigation.groupTabs`.

| Group | Tab ids |
|-------|---------|
| overview | overview, analytics, logs |
| operations | endpoints, pending, activity, alerts |
| customers | customers, customer-profile, agent-performance |
| data | data-graded, data-props, data-positions, data-players |
| finance | transactions, weekly-figures, authorizations |
| ingestion | ingest-catalog, ingest-runs, ingest-local, upstream |
| system | settings, diagnostics, health |

Helpers: `getTabPath`, `getTabGroup`, `isValidTabId` — invalid input returns `{ ok: false, error }` (Zod-shaped). Harness: `npm run harness:sync-check` validates manifest, llms.txt paths, OpenAPI `operationId`s, and worker routes.

## Docs

- Operator context: `llms.txt`
- Harness detail: `dashboard/harness/README.md`
- Ingestion pitfalls: `.cursor/rules/f402-dev-review.mdc`
