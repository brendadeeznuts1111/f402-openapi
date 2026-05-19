/**
 * Auto-generated valid/invalid fixtures from Zod JSON Schema (reduces manual test data).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as dashboardSchemas from '../../js/lib/schemas.js';
import { loadMetadata } from '../../harness/verify.js';
import {
  generateSchemaFixtures,
  runGeneratedFixtureTests,
} from '../../harness/zod-fixtures.js';
import {
  pendingWagersQuerySchema,
  searchCustomersQuerySchema,
  transactionsLiveQuerySchema,
  agentPerformanceLiveQuerySchema,
  customerProfileQuerySchema,
} from '../../../tools/lib/f402-schemas.mjs';

test('generated fixtures for schema-bindings dashboard schemas', () => {
  const bindings = loadMetadata('schema-bindings.json').bindings;
  const findings = [];
  for (const b of bindings) {
    const schema = dashboardSchemas[b.dashboardSchema];
    if (!schema) {
      findings.push(`missing ${b.dashboardSchema}`);
      continue;
    }
    const fixtures = generateSchemaFixtures(schema, b.dashboardSchema);
    findings.push(...runGeneratedFixtureTests(schema, fixtures));
  }
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('generated fixtures for schema-bindings worker schemas', () => {
  const bindings = loadMetadata('schema-bindings.json').bindings;
  const workerMap = {
    searchCustomersQuerySchema,
    pendingWagersQuerySchema,
    transactionsLiveQuerySchema,
    agentPerformanceLiveQuerySchema,
    customerProfileQuerySchema,
  };
  const findings = [];
  for (const b of bindings) {
    const schema = workerMap[b.workerSchema];
    if (!schema) continue;
    const fixtures = generateSchemaFixtures(schema, b.workerSchema);
    findings.push(...runGeneratedFixtureTests(schema, fixtures));
  }
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('generated valid fixture round-trips binding samples on dashboard schemas', () => {
  const bindings = loadMetadata('schema-bindings.json').bindings;
  for (const b of bindings) {
    const schema = dashboardSchemas[b.dashboardSchema];
    const raw = b.sampleDashboard ?? b.sampleQuery;
    if (!raw) continue;
    const input = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => {
        const n = Number(v);
        return [k, Number.isFinite(n) && String(n) === String(v) ? n : v];
      }),
    );
    const r = schema.safeParse(input);
    assert.equal(r.success, true, `${b.id} binding sample should parse on dashboard schema`);
  }
});
