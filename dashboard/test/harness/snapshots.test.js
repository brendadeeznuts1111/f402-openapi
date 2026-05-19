/**
 * Snapshot tests — OpenAPI component shapes and Zod JSON Schema fingerprints.
 * Approve drift: npm run test:harness:update
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as dashboardSchemas from '../../js/lib/schemas.js';
import {
  assertMatchesSnapshot,
  readSnapshot,
} from '../../harness/snapshot-store.js';
import {
  fingerprintOpenApiSchemas,
  fingerprintSchemaMap,
} from '../../harness/zod-shape.js';
import { readOpenApiWorkerSpec } from '../../harness/verify.js';
import {
  pendingWagersQuerySchema,
  searchCustomersQuerySchema,
  transactionsLiveQuerySchema,
  agentPerformanceLiveQuerySchema,
  customerProfileQuerySchema,
  customerProfileSeedSchema,
  chartAggregatesSchema,
  localIngestSchema,
  updateCookiesSchema,
} from '../../../tools/lib/f402-schemas.mjs';

const workerBindingSchemas = {
  searchCustomersQuerySchema,
  pendingWagersQuerySchema,
  transactionsLiveQuerySchema,
  agentPerformanceLiveQuerySchema,
  customerProfileQuerySchema,
  customerProfileSeedSchema,
  chartAggregatesSchema,
  localIngestSchema,
  updateCookiesSchema,
};

test('OpenAPI components.schemas snapshot', () => {
  const spec = readOpenApiWorkerSpec();
  const fingerprint = fingerprintOpenApiSchemas(spec);
  assertMatchesSnapshot('openapi-schemas', fingerprint);
  const snap = readSnapshot('openapi-schemas');
  assert.ok(Object.keys(snap).length >= 40, 'expected substantial OpenAPI schema set');
});

test('dashboard Zod schema fingerprints snapshot', () => {
  const fingerprint = fingerprintSchemaMap(dashboardSchemas);
  assertMatchesSnapshot('dashboard-zod-schemas', fingerprint);
});

test('worker binding Zod schema fingerprints snapshot', () => {
  const fingerprint = fingerprintSchemaMap(workerBindingSchemas);
  assertMatchesSnapshot('worker-zod-schemas', fingerprint);
});

test('OpenAPI snapshot schema names are PascalCase', () => {
  const snap = readSnapshot('openapi-schemas');
  for (const name of Object.keys(snap)) {
    assert.match(name, /^[A-Z][A-Za-z0-9]*$/, `OpenAPI schema name: ${name}`);
  }
});
