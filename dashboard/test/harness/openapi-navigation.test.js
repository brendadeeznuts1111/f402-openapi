/**
 * Navigation tabs with openApiOperationId must exist in openapi.worker.json.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readOpenApiWorkerSpec } from '../../harness/verify.js';
import {
  verifyNavigationOpenApiOperations,
  verifyNavigationWorkerPaths,
  collectOpenApiOperationIds,
} from '../../harness/navigation-verify.js';
import { SIDEBAR_CONFIG } from '../../js/lib/navigation-config.js';
import { parseWorkerApiManifest, readWorkerIndexSource } from '../../harness/verify.js';

test('navigation openApiOperationId values exist in worker OpenAPI', () => {
  const spec = readOpenApiWorkerSpec();
  const findings = verifyNavigationOpenApiOperations(SIDEBAR_CONFIG, spec);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('navigation workerApiPath values exist in WORKER_API_ROUTES', () => {
  const worker = parseWorkerApiManifest(readWorkerIndexSource());
  const findings = verifyNavigationWorkerPaths(SIDEBAR_CONFIG, worker.routes);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('each TAB_PATH is unique and under /dashboard/', () => {
  const paths = SIDEBAR_CONFIG.groups.flatMap((g) => g.items.map((i) => i.path));
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.every((p) => p.startsWith('/dashboard/')));
});

test('documented OpenAPI operationIds are non-empty set', () => {
  const ids = collectOpenApiOperationIds(readOpenApiWorkerSpec());
  assert.ok(ids.size >= 10);
});
