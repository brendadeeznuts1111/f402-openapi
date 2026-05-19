import assert from 'node:assert/strict';
import test from 'node:test';
import { agentLink, customerLink, wagerLink } from '../js/lib/link-components.js';
import { buildPendingWagersQuery, buildSearchCustomersQuery } from '../js/lib/query-builders.js';
import { pendingWagersFiltersSchema } from '../js/lib/schemas.js';

test('customerLink renders navigable button', () => {
  const html = customerLink({ customerId: 'GX195', login: 'GX195', label: 'GX195' });
  assert.match(html, /data-f402-nav="customer"/);
  assert.match(html, /data-customer-id="GX195"/);
  assert.match(html, /class="ds-link"/);
});

test('agentLink rejects invalid ids', () => {
  const html = agentLink('bad id!');
  assert.equal(html.includes('data-f402-nav'), false);
});

test('wagerLink includes ticket attribute', () => {
  const html = wagerLink({ ticketNumber: 12345, login: 'P1' });
  assert.match(html, /data-f402-nav="wager"/);
  assert.match(html, /data-ticket="12345"/);
});

test('buildSearchCustomersQuery rejects short q', () => {
  assert.throws(() => buildSearchCustomersQuery('x'), /q must be at least 2/);
});

test('buildPendingWagersQuery validates wager_type', () => {
  assert.throws(
    () => buildPendingWagersQuery({ wager_type: 'X', date: '2026-05-17' }),
    /wager_type/,
  );
});

test('pendingWagersFiltersSchema accepts defaults', () => {
  const r = pendingWagersFiltersSchema.safeParse({ date: '2026-05-17' });
  assert.equal(r.success, true);
});
