/**
 * Zod parse performance — baseline comparison (fail if >15% slower).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as dashboardSchemas from '../../js/lib/schemas.js';
import { loadMetadata } from '../../harness/verify.js';
import {
  stableBenchmarkSchemaParse,
  readPerformanceBaseline,
  comparePerformanceToBaseline,
  REGRESSION_THRESHOLD,
} from '../../harness/performance-benchmark.js';
import {
  searchCustomersQuerySchema,
  pendingWagersQuerySchema,
} from '../../../tools/lib/f402-schemas.mjs';

const DASHBOARD_INPUTS = {
  searchCustomersQuerySchema: { q: 'GX195', limit: 25 },
  pendingWagersFiltersSchema: { date: '2026-05-17', customer_id: '0' },
  transactionsLiveFiltersSchema: {
    type: 'player',
    start_date: '2026-05-01',
    end_date: '2026-05-17',
  },
  customerNavSchema: { customerId: 'GX195' },
};

const WORKER_INPUTS = {
  searchCustomersQuerySchema: { q: 'GX195', limit: '25' },
  pendingWagersQuerySchema: { date: '2026-05-17', limit: '50' },
};

function collectBenchmarks() {
  const results = {};
  for (const [name, input] of Object.entries(DASHBOARD_INPUTS)) {
    const schema = dashboardSchemas[name];
    if (!schema) continue;
    results[`dashboard.${name}`] = stableBenchmarkSchemaParse(schema, input);
  }
  results['worker.searchCustomersQuerySchema'] = stableBenchmarkSchemaParse(
    searchCustomersQuerySchema,
    WORKER_INPUTS.searchCustomersQuerySchema,
  );
  results['worker.pendingWagersQuerySchema'] = stableBenchmarkSchemaParse(
    pendingWagersQuerySchema,
    WORKER_INPUTS.pendingWagersQuerySchema,
  );
  return results;
}

test('Zod schema parse performance within baseline threshold', () => {
  const baseline = readPerformanceBaseline();
  assert.ok(baseline, 'missing performance-baseline.json — run npm run test:harness:update');
  const current = collectBenchmarks();
  const findings = comparePerformanceToBaseline(current, baseline, REGRESSION_THRESHOLD);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('performance baseline documents threshold', () => {
  const baseline = readPerformanceBaseline();
  assert.ok(baseline);
  assert.equal(baseline.threshold, REGRESSION_THRESHOLD);
  assert.ok(Object.keys(baseline.schemas).length >= 4);
});
