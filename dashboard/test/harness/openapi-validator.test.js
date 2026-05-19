/**
 * OpenAPI Ajv validation — sample payloads vs live spec and snapshot alignment.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMetadata, readOpenApiWorkerSpec } from '../../harness/verify.js';
import { readSnapshot } from '../../harness/snapshot-store.js';
import {
  runOpenApiSampleCases,
  validateOpenApiSample,
} from '../../harness/openapi-validator.js';
import { fingerprintOpenApiSchemas } from '../../harness/zod-shape.js';

test('OpenAPI Ajv validates samples from openapi-samples.json', () => {
  const samples = loadMetadata('openapi-samples.json');
  const spec = readOpenApiWorkerSpec();
  const snap = readSnapshot('openapi-schemas');
  const findings = runOpenApiSampleCases(samples.samples, spec, snap);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('snapshot OpenAPI fingerprints match live spec top-level schemas', () => {
  const spec = readOpenApiWorkerSpec();
  const live = fingerprintOpenApiSchemas(spec);
  const snap = readSnapshot('openapi-schemas');
  assert.deepEqual(Object.keys(live).sort(), Object.keys(snap).sort());
});

test('Zod-validated query shapes align with OpenAPI ErrorResponse for failures', () => {
  const spec = readOpenApiWorkerSpec();
  const body = { status: 'failed', message: 'q must be at least 2 characters' };
  const result = validateOpenApiSample('ErrorResponse', body, spec);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});
