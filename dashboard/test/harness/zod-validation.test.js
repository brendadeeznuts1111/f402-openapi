/**
 * Zod validation — types, refinements, transforms, defaults, edge cases (data-driven).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as dashboardSchemas from '../../js/lib/schemas.js';
import {
  loadMetadata,
  runDashboardZodCases,
  runWorkerZodCases,
} from '../../harness/verify.js';
import {
  customerProfileQuerySchema,
  customerProfileSeedSchema,
  agentPerformanceLiveQuerySchema,
  chartAggregatesSchema,
  localIngestSchema,
  pendingWagersQuerySchema,
  searchCustomersQuerySchema,
  parseSearchParams,
} from '../../../tools/lib/f402-schemas.mjs';

const workerSchemas = {
  customerProfileQuerySchema,
  customerProfileSeedSchema,
  agentPerformanceLiveQuerySchema,
  chartAggregatesSchema,
  localIngestSchema,
  pendingWagersQuerySchema,
  searchCustomersQuerySchema,
};

test('dashboard Zod cases from zod-cases.json', () => {
  const cases = loadMetadata('zod-cases.json');
  const findings = runDashboardZodCases(cases, dashboardSchemas, {
    emptyToUndefined: dashboardSchemas.emptyToUndefined,
  });
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('worker Zod cases from zod-cases.json', () => {
  const cases = loadMetadata('zod-cases.json');
  const findings = runWorkerZodCases(cases, workerSchemas, parseSearchParams);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('pendingWagersFiltersSchema (dashboard) defaults customer_id; worker leaves optional', () => {
  const dash = dashboardSchemas.pendingWagersFiltersSchema.safeParse({ date: '2026-05-17' });
  assert.equal(dash.success, true);
  if (dash.success) {
    assert.equal(dash.data.customer_id, '0');
    assert.equal(dash.data.limit, 200);
  }

  const worker = parseSearchParams(
    pendingWagersQuerySchema,
    new URLSearchParams({ date: '2026-05-17' }),
  );
  assert.equal(worker.ok, true);
  if (worker.ok) {
    assert.equal(worker.data.customer_id, undefined);
    assert.equal(worker.data.limit, 200);
  }
});

test('customerProfileQuerySchema transforms live flag', () => {
  for (const [raw, want] of [
    ['1', true],
    ['0', false],
    ['false', false],
    ['no', false],
  ]) {
    const result = parseSearchParams(
      customerProfileQuerySchema,
      new URLSearchParams({ customer_id: 'GX195', live: raw }),
    );
    assert.equal(result.ok, true, `live=${raw}`);
    if (result.ok) assert.equal(result.data.wantLive, want, `live=${raw}`);
  }
});

test('agentPerformanceLiveQuerySchema uppercases type and free_play', () => {
  const result = parseSearchParams(
    agentPerformanceLiveQuerySchema,
    new URLSearchParams({ type: 'cps', free_play: 'y' }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.type, 'CPS');
  assert.equal(result.data.free_play, 'Y');
});

test('localIngestSchema enforces results array bounds', () => {
  const tooMany = {
    results: Array.from({ length: 26 }, () => ({
      endpointKey: 'getBetTicker',
      httpStatus: 200,
      data: {},
    })),
  };
  assert.equal(localIngestSchema.safeParse(tooMany).success, false);
});
