/**
 * Error-path tests — malformed inputs, refinements, helper error shapes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as dashboardSchemas from '../../js/lib/schemas.js';
import { parseOrThrow } from '../../js/lib/schemas.js';
import {
  loadMetadata,
  runSchemaRegistryDashboardCases,
  runSchemaRegistryWorkerCases,
  verifyValidationErrorShape,
} from '../../harness/verify.js';
import {
  formatZodIssues,
  validationErrorBody,
  parseSearchParams,
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

const workerSchemas = {
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

test('schema-registry.json dashboard error cases', () => {
  const registry = loadMetadata('schema-registry.json');
  const findings = runSchemaRegistryDashboardCases(registry, dashboardSchemas);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('schema-registry.json worker error cases', () => {
  const registry = loadMetadata('schema-registry.json');
  const findings = runSchemaRegistryWorkerCases(registry, workerSchemas, parseSearchParams);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('parseOrThrow throws with label prefix on invalid input', () => {
  assert.throws(
    () => parseOrThrow(searchCustomersQuerySchema, { q: 'x' }, 'search'),
    /search:/,
  );
});

test('parseSearchParams returns ok:false with ZodError (not throw)', () => {
  const result = parseSearchParams(
    searchCustomersQuerySchema,
    new URLSearchParams({ q: 'a' }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error.issues.length > 0);
});

test('validationErrorBody and formatZodIssues stable on registry failures', () => {
  const bad = searchCustomersQuerySchema.safeParse({ q: 'a' });
  assert.equal(bad.success, false);
  if (bad.success) return;

  const shapeFindings = verifyValidationErrorShape(bad.error, validationErrorBody);
  assert.deepEqual(shapeFindings, [], shapeFindings.join('\n'));

  const issues = formatZodIssues(bad.error);
  assert.ok(issues.every((i) => i.path && i.message && i.code));
  const body = validationErrorBody(bad.error);
  assert.equal(body.code, 'VALIDATION_ERROR');
  assert.equal(body.status, 'failed');
});

test('navigation helpers return predictable errors for invalid input', async () => {
  const { getTabPath, getTabGroup, isValidTabId } = await import('../../js/lib/navigation-config.js');
  assert.equal(getTabPath(undefined).ok, false);
  assert.equal(getTabPath('fake').ok, false);
  assert.equal(getTabGroup('invalid-tab').ok, false);
  assert.equal(isValidTabId('fake'), false);
  assert.equal(isValidTabId('overview'), true);
});

test('zod-cases.json invalid paths still enforced', () => {
  const cases = loadMetadata('zod-cases.json');
  for (const c of cases.dashboardSchemas ?? []) {
    if (!c.invalid) continue;
    const schema = dashboardSchemas[c.schema];
    const r = schema.safeParse(c.invalid);
    assert.equal(r.success, false, `${c.id} should fail validation`);
  }
});
