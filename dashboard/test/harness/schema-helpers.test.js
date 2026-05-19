/**
 * Schema helper behavior — parsing, validation errors, query serialization, defaults.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as dashboardSchemas from '../../js/lib/schemas.js';
import {
  emptyToUndefined,
  parseOrThrow,
  parseSafe,
  searchCustomersQuerySchema,
} from '../../js/lib/schemas.js';
import {
  buildSearchCustomersQuery,
  buildPendingWagersQuery,
  buildCustomerProfilePath,
} from '../../js/lib/query-builders.js';
import {
  formatZodIssues,
  validationErrorBody,
  parseSearchParams,
} from '../../../tools/lib/f402-schemas.mjs';
import {
  loadMetadata,
  runDashboardZodCases,
  verifySchemaHelperRoundTrip,
  verifyValidationErrorShape,
} from '../../harness/verify.js';

test('emptyToUndefined and parseOrThrow behavior', () => {
  const cases = loadMetadata('zod-cases.json');
  const findings = runDashboardZodCases(cases, dashboardSchemas, { emptyToUndefined });
  assert.deepEqual(findings, [], findings.join('\n'));

  assert.throws(() => parseOrThrow(searchCustomersQuerySchema, { q: 'x' }, 'test'), /at least 2/);
  const safe = parseSafe(searchCustomersQuerySchema, { q: 'ab' });
  assert.equal(safe.success, true);
});

test('validationErrorBody returns stable API shape', () => {
  const bad = searchCustomersQuerySchema.safeParse({ q: 'a' });
  assert.equal(bad.success, false);
  if (bad.success) return;
  const findings = verifyValidationErrorShape(bad.error, validationErrorBody);
  assert.deepEqual(findings, [], findings.join('\n'));
  const issues = formatZodIssues(bad.error);
  assert.ok(issues.every((i) => i.path && i.message && i.code));
});

test('query builders serialize to worker-valid query strings', () => {
  const searchQs = buildSearchCustomersQuery('GX195', 10);
  assert.match(searchQs, /^q=GX195/);
  assert.match(searchQs, /limit=10/);

  const pendingQs = buildPendingWagersQuery({ date: '2026-05-17', wager_type: 'S' });
  const params = new URLSearchParams(pendingQs);
  assert.equal(params.get('date'), '2026-05-17');
  assert.equal(params.get('wager_type'), 'S');

  const profilePath = buildCustomerProfilePath('GX195', {
    analysis: { start: '2026-05-01', end: '2026-05-17' },
  });
  assert.match(profilePath, /^\/customer-profile\?/);
  assert.match(profilePath, /customer_id=GX195/);
  assert.match(profilePath, /live=1/);
});

test('dashboard parseOrThrow and worker parseSearchParams agree on search query', () => {
  const findings = verifySchemaHelperRoundTrip({
    parseOrThrow,
    buildSearchCustomersQuery,
    searchSchema: searchCustomersQuerySchema,
    parseSearchParams,
  });
  assert.deepEqual(findings, [], findings.join('\n'));
});
