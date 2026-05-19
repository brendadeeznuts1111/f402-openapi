import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentPerfQueryString,
  columnsForAgentPerfType,
  parseCustomerFromPerfRow,
  formatAgentPerfMeta,
} from '../js/lib/agent-performance-helpers.js';
import {
  defaultAnalysisDates,
  buildAnalysisQueryParams,
  buildCustomerProfilePath,
  sourceBadgeKind,
  pickPerformanceColumns,
  getInfoFromProfileData,
} from '../js/lib/customers-view-helpers.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('buildAgentPerfQueryString encodes type and dates', () => {
  const qs = buildAgentPerfQueryString({
    type: 'CPS',
    freePlay: 'N',
    start: '2026-05-01',
    end: '2026-05-19',
  });
  assert.match(qs, /type=CPS/);
  assert.match(qs, /free_play=N/);
  assert.match(qs, /start_date=2026-05-01/);
  assert.match(qs, /end=2026-05-19/);
});

test('columnsForAgentPerfType selects sport columns for CPS', () => {
  assert.equal(columnsForAgentPerfType('CPS', {}), 'sport');
  assert.equal(columnsForAgentPerfType('CP', { login: 'x' }), 'customer');
});

test('parseCustomerFromPerfRow strips password suffix', () => {
  const { customerId, login } = parseCustomerFromPerfRow({
    customer_id: 'CC1041',
    login: 'CC1041 (pw:seas)',
  });
  assert.equal(customerId, 'CC1041');
  assert.equal(login, 'CC1041');
});

test('formatAgentPerfMeta includes cache hint', () => {
  const s = formatAgentPerfMeta({ type: 'CP', type_label: 'Customer Performance', total: 3, cached: true, fetched_at: 'x' });
  assert.match(s, /cached/);
  assert.match(s, /3 rows/);
});

test('defaultAnalysisDates spans 14 days', () => {
  const { start, end } = defaultAnalysisDates(new Date('2026-05-19T12:00:00Z'));
  assert.equal(end, '2026-05-19');
  assert.equal(start, '2026-05-05');
});

test('buildCustomerProfilePath includes analysis params', () => {
  const path = buildCustomerProfilePath('GX195', {
    login: 'GX195',
    period: 0,
    analysis: { start: '2026-05-01', end: '2026-05-19', reportType: 2, lineType: 2 },
  });
  assert.match(path, /customer_id=GX195/);
  assert.match(path, /login=GX195/);
  assert.match(path, /start_date=2026-05-01/);
});

test('sourceBadgeKind covers failed state', () => {
  assert.equal(sourceBadgeKind('failed'), 'failed');
  assert.equal(sourceBadgeKind('live', true), 'live-cached');
});

test('getInfoFromProfileData prefers live getInfoPlayer', () => {
  const { source, data } = getInfoFromProfileData({
    live: { getInfoPlayer: { ok: true, data: { Login: 'A' }, balance: {} } },
    facets: { getInfoPlayer: { INFO: { data: { Login: 'B' } } } },
  });
  assert.equal(source, 'live');
  assert.equal(data.Login, 'A');
});

test('customers view HTML contains required element ids', () => {
  const html = readFileSync(join(import.meta.dirname, '../index.html'), 'utf8');
  const required = [
    'view-customers',
    'agentPerfType',
    'agentPerfTable',
    'agentPerfLoadBtn',
    'customerSearchInput',
    'customerSearchResults',
    'customerProfileCard',
    'customerProfileSourcesBody',
    'customerProfileWebLogs',
    'customerProfileSeedBtn',
    'customerProfileRefreshBtn',
    'customerProfileAnalysisStart',
    'customerProfilePerformanceTable',
    'view-pending',
    'pendingWagersTable',
    'pendingApplyBtn',
  ];
  for (const id of required) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
});
