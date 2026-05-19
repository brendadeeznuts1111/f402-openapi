# Agent Guidance

This repo contains the `fantasy402-ingestion` Cloudflare Worker. Keep changes scoped to ingestion, archive readback, URL Scanner verdict capture, schema contracts, and the component test harness unless the user asks for a broader project change.

## Component Test Harness

- Prefer `test/harness.ts` for isolated tests instead of creating per-test fake Cloudflare bindings.
- `createComponentHarness()` returns Worker bindings plus helpers for authorized and anonymous requests.
- `MemoryKVNamespace`, `MemoryD1Database`, and `MemoryR2Bucket` are the canonical system views for tests.
- Use `harness.systemView()` to assert state changes across KV, D1, R2, env configuration, and component wiring.
- Use `withFetchMock()` for external dependencies. Restore global fetch through that helper so tests remain isolated.

## Schema And Contracts

- Put shared route models, endpoint keys, validation rules, archive constants, and small pure schema helpers in `src/schema.ts`.
- Export every route-facing Zod schema through `routeSchemas` in `src/schema.ts`.
- Keep `openapi.worker.json`, `src/schema.ts`, tests, and route responses consistent.
- Keep `public/llm.txt` and `manifest.json` schema lists synchronized with `routeSchemas`.
- Current route schemas are `AgentHealthResponse`, `AgentInput`, `AgentOutput`, `ArchiveListResponse`, `ArchiveObjectSummary`, `ErrorResponse`, `HealthResponse`, `ScanListResponse`, `ScanTriggerRequest`, `ScanTriggerResponse`, `ScanVerdict`, `SettingsSchema`, and `TriggerResponse`.
- Snapshot drift in `test/__snapshots__/` should fail by default. Refresh with `UPDATE_SNAPSHOTS=1 npm test` only after intentionally changing OpenAPI or Zod schema shape.
- Run `npm run validate:openapi` after changing routes or response shapes.
- Keep `manifest.json` current when entry points, bindings, public docs, contracts, or verification commands change.

## Runtime Wiring

- `src/index.ts` owns Worker route wiring, scheduled handlers, D1 writes, R2 archive readback, alerts, and ingestion orchestration.
- `src/url-scanner.ts` owns Cloudflare URL Scanner integration and should not reach around the Worker harness for tests.
- Cloudflare bindings are `SESSION_KV`, `ANALYTICS_DB`, and `RAW_ARCHIVE`.
- Protected routes must use `INGESTION_TRIGGER_TOKEN` bearer auth.

## Verification

Run focused checks before handing work back:

```bash
npm run typecheck
npm test
npm run validate:openapi
```

Run full `npm run verify` for release-bound changes.

## Security

- Never commit secrets, real cookies, bearer tokens, `.env`, `.dev.vars`, or generated secret payloads.
- Preserve credential redaction before R2 archival.
- Keep archive listing and object reads constrained to the `fantasy402/` prefix.
- Do not weaken Content Security Policy on `/archive/viewer` without a specific reason.
